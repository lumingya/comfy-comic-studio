"""Content-addressed asset files: ``<root>/<sha[:2]>/<sha>.<ext>``, metadata in SQLite."""

from __future__ import annotations

import errno
import hashlib
import io
import os
import re
import stat
import threading
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from .fs_paths import regular_path_metadata
from .render_models import Asset
from .storage import NotFound, SQLiteStore

MIME_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/json": "json",
    "application/octet-stream": "bin",
}
PIL_MIME = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}


def sniff(data: bytes) -> tuple[str, int | None, int | None]:
    try:
        with Image.open(io.BytesIO(data)) as im:
            return PIL_MIME.get(im.format or "", "application/octet-stream"), im.width, im.height
    except (UnidentifiedImageError, OSError):
        if data[:1] in (b"{", b"["):
            return "application/json", None, None
        return "application/octet-stream", None, None


class AssetStore:
    def __init__(self, root: str | Path, store: SQLiteStore):
        self.root = Path(root)
        self.store = store
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.retained_results = lambda: set()

    def path(self, asset: Asset | str) -> Path:
        if isinstance(asset, str):
            asset = self.store.get_asset(asset)
        return self.root / asset.id[:2] / f"{asset.id}.{MIME_EXT.get(asset.mime, 'bin')}"

    @staticmethod
    def describe(data: bytes, source: str = "", filename: str = "") -> Asset:
        """Compute a publication manifest without writing bytes or metadata."""
        digest = hashlib.sha256(data).hexdigest()
        mime, width, height = sniff(data)
        return Asset(
            id=digest,
            mime=mime,
            size=len(data),
            width=width,
            height=height,
            source=source,
            filename=filename[:200],
        )

    @staticmethod
    def manifest(raw) -> Asset:
        asset = Asset.model_validate(raw)
        if (
            not re.fullmatch(r"[0-9a-f]{64}", asset.id)
            or asset.mime not in MIME_EXT
            or asset.size < 0
        ):
            raise ValueError("invalid result artifact manifest")
        return asset

    def _safe_path(self, asset: Asset) -> Path:
        target = self.path(asset)
        regular_path_metadata(self.root, directory=True)
        metadata = regular_path_metadata(target, directory=False, missing=True)
        if metadata and metadata.st_nlink != 1:
            raise ValueError("result artifact file must not be a hard link")
        return target

    def _verify(self, asset: Asset, *, decode=True) -> bool:
        target = self._safe_path(asset)
        if not target.exists():
            staging = target.with_name(f".{target.name}.publishing")
            metadata = regular_path_metadata(staging, directory=False, missing=True)
            if metadata and metadata.st_nlink != 1:
                raise ValueError("result staging file must not be a hard link")
            if not staging.exists() or not self._matches(staging, asset, decode=decode):
                return False
            os.replace(staging, target)
            _sync_directory(target.parent)
        if not self._matches(target, asset, decode=decode):
            raise ValueError("result artifact hash or size does not match its manifest")
        return True

    @staticmethod
    def _matches(target: Path, asset: Asset, *, decode=True) -> bool:
        digest = hashlib.sha256()
        size = 0
        with target.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
        if size != asset.size or digest.hexdigest() != asset.id:
            return False
        try:
            with Image.open(target) as image:
                if decode:
                    if image.width * image.height > (Image.MAX_IMAGE_PIXELS or 89_478_485):
                        raise ValueError("result image exceeds the decoding pixel limit")
                    image.load()
                actual = (
                    PIL_MIME.get(image.format or "", "application/octet-stream"),
                    image.width,
                    image.height,
                )
        except (UnidentifiedImageError, OSError):
            with target.open("rb") as source:
                mime = (
                    "application/json"
                    if source.read(1) in (b"{", b"[")
                    else "application/octet-stream"
                )
            actual = (mime, None, None)
        if actual != (asset.mime, asset.width, asset.height):
            raise ValueError("result artifact media metadata does not match its bytes")
        return True

    def _register(self, asset: Asset) -> Asset:
        saved = self.store.put_asset(asset)
        if any(
            getattr(saved, key) != getattr(asset, key)
            for key in ("mime", "size", "width", "height")
        ):
            raise ValueError("existing result artifact metadata does not match its manifest")
        return saved

    def publish(self, raw, data: bytes, *, validate_image=True) -> Asset:
        """Publish only the bytes described by a previously recorded task intent."""
        asset = self.manifest(raw)
        actual = self.describe(data)
        if any(
            getattr(actual, key) != getattr(asset, key)
            for key in ("id", "mime", "size", "width", "height")
        ):
            raise ValueError("result bytes do not match their publication manifest")
        target = self._safe_path(asset)
        with self._lock:
            if not self._verify(asset, decode=validate_image):
                self._write(target, data)
            self._verify(asset, decode=validate_image)
            return self._register(asset)

    def restore(self, raw) -> bool:
        """Validate saved local bytes and repair interrupted metadata registration."""
        asset = self.manifest(raw)
        with self._lock:
            if not self._verify(asset):
                return False
            self._register(asset)
            return True

    def publication_status(self, raw) -> dict:
        asset = self.manifest(raw)
        target = self._safe_path(asset)
        staging = target.with_name(f".{target.name}.publishing")
        regular_path_metadata(staging, directory=False, missing=True)
        saved = target if target.exists() else staging
        return {
            "asset_id": asset.id,
            "location": "published"
            if target.exists()
            else "staging"
            if staging.exists()
            else "missing",
            "saved_bytes": saved.stat().st_size if saved.exists() else 0,
            "expected_bytes": asset.size,
        }

    def put(self, data: bytes, source: str = "", filename: str = "") -> Asset:
        return self.publish(self.describe(data, source, filename), data, validate_image=False)

    @staticmethod
    def _write(target: Path, data: bytes) -> None:
        regular_path_metadata(target, directory=False, missing=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = target.with_name(f".{target.name}.publishing")
        regular_path_metadata(staging, directory=False, missing=True)
        flags = os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(staging, flags | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            descriptor = os.open(staging, flags)
        try:
            opened = os.fstat(descriptor)
            current = regular_path_metadata(staging, directory=False)
            if (
                not stat.S_ISREG(opened.st_mode)
                or opened.st_nlink != 1
                or (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino)
            ):
                raise ValueError("result staging file must be a single owned regular file")
            os.ftruncate(descriptor, 0)
            with os.fdopen(descriptor, "wb", closefd=False) as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
        finally:
            os.close(descriptor)
        _sync_directory(target.parent)
        _sync_directory(target.parent.parent)
        try:
            os.replace(staging, target)
        except PermissionError:
            if not target.exists():
                raise
        _sync_directory(target.parent)
        _sync_directory(target.parent.parent)

    def read(self, asset_id: str) -> bytes:
        path = self.path(asset_id)
        if not path.exists():
            raise NotFound(f"asset file missing: {asset_id}")
        return path.read_bytes()

    def exists(self, asset_id: str) -> bool:
        try:
            return self.path(asset_id).exists()
        except NotFound:
            return False

    def collect_garbage(self, referenced: set[str]) -> list[str]:
        """Remove assets nobody references (after the trash is emptied)."""
        removed = []
        with self._lock:
            retained = self.retained_results()
            registered = self.store.asset_ids()
            for asset_id in sorted(registered - referenced - retained):
                target = self._safe_path(self.manifest(self.store.get_asset(asset_id)))
                try:
                    target.unlink(missing_ok=True)
                finally:
                    self.store.forget_asset(asset_id)
                    removed.append(asset_id)
            # Failed writes can leave files before metadata registration. Only an explicit
            # GC may remove these, after the last journal owner has been deleted. The same
            # lock excludes publish/restore while ownership and metadata are checked.
            protected = registered | referenced | retained
            regular_path_metadata(self.root, directory=True)
            extensions = "|".join(sorted(set(MIME_EXT.values())))
            pattern = re.compile(rf"\.([0-9a-f]{{64}})\.({extensions})\.publishing")
            for directory in sorted(self.root.iterdir()):
                if not re.fullmatch(r"[0-9a-f]{2}", directory.name):
                    continue
                regular_path_metadata(directory, directory=True)
                for staging in sorted(directory.iterdir()):
                    match = pattern.fullmatch(staging.name)
                    if not match:
                        continue
                    asset_id = match[1]
                    if asset_id[:2] != directory.name or asset_id in protected:
                        continue
                    metadata = regular_path_metadata(staging, directory=False)
                    if metadata.st_nlink != 1:
                        raise ValueError("result staging file must not be a hard link")
                    staging.unlink()
                    if asset_id not in removed:
                        removed.append(asset_id)
        return removed


def _sync_directory(directory: Path) -> bool:
    """Persist renames where supported; Windows has no directory fsync here."""
    if os.name == "nt":
        return False
    descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        try:
            os.fsync(descriptor)
        except OSError as exc:
            if exc.errno not in (errno.EINVAL, errno.ENOTSUP, errno.EBADF):
                raise
            return False
    finally:
        os.close(descriptor)
    return True
