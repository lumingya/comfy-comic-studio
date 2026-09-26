"""Content-addressed asset files: ``<root>/<sha[:2]>/<sha>.<ext>``, metadata in SQLite."""

from __future__ import annotations

import hashlib
import io
import os
import tempfile
from pathlib import Path

from PIL import Image, UnidentifiedImageError

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

    def path(self, asset: Asset | str) -> Path:
        if isinstance(asset, str):
            asset = self.store.get_asset(asset)
        return self.root / asset.id[:2] / f"{asset.id}.{MIME_EXT.get(asset.mime, 'bin')}"

    def put(self, data: bytes, source: str = "", filename: str = "") -> Asset:
        digest = hashlib.sha256(data).hexdigest()
        mime, width, height = sniff(data)
        asset = Asset(
            id=digest,
            mime=mime,
            size=len(data),
            width=width,
            height=height,
            source=source,
            filename=filename[:200],
        )
        target = self.path(asset)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".tmp-")
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, target)
        return self.store.put_asset(asset)

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
        for asset_id in sorted(self.store.asset_ids() - referenced):
            try:
                self.path(asset_id).unlink(missing_ok=True)
            finally:
                self.store.forget_asset(asset_id)
                removed.append(asset_id)
        return removed
