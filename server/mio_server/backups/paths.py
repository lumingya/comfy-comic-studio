"""All recovery paths are derived from a workspace and generated identifiers."""

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

from ..storage import NotFound

ID = re.compile(r"^(?:backup|restore)_[a-f0-9]{12}$")


def recovery_root(data_dir: Path) -> Path:
    workspace = data_dir.resolve()
    return workspace.parent / f".{workspace.name}.mio-recovery"


def safe_child(root: Path, identifier: str) -> Path:
    if not ID.fullmatch(identifier):
        raise NotFound("backup or restore plan not found")
    target = root / identifier
    if (
        root.is_symlink()
        or target.is_symlink()
        or not target.resolve().is_relative_to(root.resolve())
    ):
        raise ValueError("recovery path is not a regular local path")
    return target


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, filename = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    temporary = Path(filename)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def sync_directory(path: Path) -> None:
    if os.name != "nt":
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise NotFound("backup or restore plan not found") from None
