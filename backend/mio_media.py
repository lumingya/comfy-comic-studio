"""Bounded streaming ingest, immutable linking, and disk-backed thumbnail cache."""

import hashlib
import io
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
from backend.mio_library import LibraryError, image_type, sync_dir

LIMIT = 50 * 1024 * 1024
_locks = [threading.Lock() for _ in range(32)]
_decode_slot = threading.Semaphore(1)
_cache_lock = threading.Lock()
THUMB_CACHE_BYTES = 256 * 1024 * 1024
THUMB_CACHE_FILES = 2048


def prune_thumbnails(folder, keep):
    """Only disposable thumbnails are evicted; source images are never touched."""
    with _cache_lock:
        now = time.time()
        for pattern in (".thumb-*", ".media-*"):
            for temp_file in folder.glob(pattern):
                try:
                    stat = temp_file.stat()
                    if now - stat.st_mtime > 600:
                        temp_file.unlink(missing_ok=True)
                except OSError:
                    continue
        entries = []
        for file in folder.glob("*.webp"):
            try:
                stat = file.stat()
                entries.append((stat.st_mtime_ns, stat.st_size, file))
            except FileNotFoundError:
                continue
        total = sum(size for _, size, _ in entries)
        count = len(entries)
        for _, size, file in sorted(entries):
            if total <= THUMB_CACHE_BYTES and count <= THUMB_CACHE_FILES:
                break
            if file == keep:
                continue
            try:
                file.unlink(missing_ok=True)
            except OSError:
                continue
            total -= size
            count -= 1


def link_asset(source, target):
    source, target = Path(source), Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return
    try:
        os.link(source, target)
    except FileExistsError:
        pass
    except OSError:
        fd, name = tempfile.mkstemp(dir=target.parent, prefix=".media-")
        os.close(fd)
        try:
            shutil.copyfile(source, name)
            with open(name, "rb") as handle:
                os.fsync(handle.fileno())
            try:
                os.replace(name, target)
            except (PermissionError, FileExistsError, OSError):
                if target.exists():
                    return
                raise
        finally:
            Path(name).unlink(missing_ok=True)
    sync_dir(target.parent)


class MediaStore:
    def __init__(self, root):
        self.root = Path(root)

    def ingest(self, stream):
        folder = self.root / "assets/images"
        folder.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=folder, prefix=".ingest-")
        total = 0
        sha = hashlib.sha256()
        header = b""
        try:
            with os.fdopen(fd, "wb") as out:
                while True:
                    chunk = stream.read(256 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > LIMIT:
                        raise LibraryError("图片超过 50 MiB", 413)
                    if len(header) < 4096:
                        header += chunk[: 4096 - len(header)]
                    sha.update(chunk)
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            # Passive SVG needs validation of the entire document, not just the header.
            probe = (
                Path(name).read_bytes()
                if header.lstrip().startswith((b"<svg", b"<?xml"))
                else header
            )
            mime, extension = image_type(probe)
            identity = sha.hexdigest() + extension
            target = folder / identity
            link_asset(name, target)
            return {
                "url": "/images/assets/" + identity,
                "mime": mime,
                "bytes": total,
            }
        finally:
            Path(name).unlink(missing_ok=True)

    def put(self, raw):
        return self.ingest(io.BytesIO(raw))

    def thumbnail(self, source, size):
        match = re.fullmatch(r"(\d{1,4})x(\d{1,4})", size or "")
        if not match:
            raise LibraryError("缩略图尺寸格式必须为 宽x高", 400)
        source = Path(source)
        w, h = map(int, match.groups())
        if not (16 <= w <= 1024 and 16 <= h <= 1024):
            raise LibraryError("缩略图尺寸范围为 16–1024", 400)
        if source.suffix == ".svg":
            if source.stat().st_size > 1024 * 1024:
                raise LibraryError("SVG 缩略预览超过 1 MiB", 413)
            image_type(source.read_bytes())
            return source
        w, h = map(int, match.groups())
        if not (16 <= w <= 1024 and 16 <= h <= 1024):
            raise LibraryError("缩略图尺寸范围为 16–1024", 400)
        # Quantization limits the number of generated variants per immutable source.
        w, h = ((n + 63) // 64 * 64 for n in (w, h))
        source = Path(source)
        stat = source.stat()
        identity = hashlib.sha256(
            f"{source.resolve()}:{stat.st_size}:{stat.st_mtime_ns}:{w}x{h}:v1".encode()
        ).hexdigest()
        target = self.root / "runtime/thumbnails" / f"{identity}.webp"
        with _locks[int(identity[:2], 16) % len(_locks)]:
            if not target.exists():
                with _decode_slot:
                    from PIL import Image, ImageOps

                    target.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        with Image.open(source) as original:
                            if original.width * original.height > 100_000_000:
                                raise LibraryError("图片像素数过大", 413)
                            original.draft("RGB", (w, h))
                            image = ImageOps.exif_transpose(original)
                            image.thumbnail((w, h))
                            image = image.convert(
                                "RGBA" if "A" in image.getbands() else "RGB"
                            )
                            fd, name = tempfile.mkstemp(
                                dir=target.parent, prefix=".thumb-"
                            )
                            os.close(fd)
                            try:
                                image.save(name, "WEBP", quality=78)
                                os.replace(name, target)
                            finally:
                                Path(name).unlink(missing_ok=True)
                    except (OSError, ValueError, Image.DecompressionBombError) as exc:
                        raise LibraryError("无法生成此图片的缩略图", 422) from exc
                prune_thumbnails(target.parent, target)
            try:
                os.utime(target, None)
            except FileNotFoundError:
                pass
        return target


def immutable_name(source):
    source = Path(source)
    if source.stat().st_size > LIMIT:
        raise LibraryError("图片超过 50 MiB 上限", 413)
    # A user-supplied hex filename is not proof of content identity.
    sha = hashlib.sha256()
    with source.open("rb") as stream:
        header = stream.read(4096)
        sha.update(header)
        for chunk in iter(lambda: stream.read(256 * 1024), b""):
            sha.update(chunk)
    _, extension = image_type(
        source.read_bytes() if source.suffix == ".svg" else header
    )
    return sha.hexdigest() + extension
