"""Core-owned private state: one identity, filesystem and bounded-data contract.

Package code never belongs here. New writes use canonical owner directories; known legacy
locations are read-only fallbacks, not migration targets. Callers serialize multi-file
operations with the job engine operation barrier, also used by workspace snapshots.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import stat
import tempfile
from pathlib import Path, PurePosixPath

MAX_PRIVATE_JSON = 1024 * 1024
MAX_JSON_DEPTH = 64
MAX_WALLPAPER_BYTES = 64 * 1024 * 1024
MAX_WALLPAPER_RECORD = 16 * 1024
IDENTIFIER = re.compile(r"[a-z0-9][a-z0-9_-]{1,47}")
WALLPAPER_ID = re.compile(r"wallpaper_[a-f0-9]{32}\Z")
RESERVED_IDS = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}


def validate_identifier(identifier: str) -> None:
    if (
        not isinstance(identifier, str)
        or not IDENTIFIER.fullmatch(identifier)
        or identifier in RESERVED_IDS
    ):
        raise ValueError("invalid private data identifier")


def _node(path: Path, *, directory: bool | None, missing: bool) -> bool:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        if missing:
            return False
        raise ValueError("private data path does not exist") from None
    if stat.S_ISLNK(metadata.st_mode) or getattr(metadata, "st_file_attributes", 0) & getattr(
        stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400
    ):
        raise ValueError("private data must not contain links or reparse points")
    is_directory = stat.S_ISDIR(metadata.st_mode)
    if not (is_directory or stat.S_ISREG(metadata.st_mode)):
        raise ValueError("private data requires regular files and directories")
    if directory is not None and directory != is_directory:
        raise ValueError("private data path has the wrong file or directory type")
    return True


def regular_path(
    path: Path,
    *,
    directory: bool | None = None,
    missing: bool = True,
    root: Path | None = None,
) -> bool:
    """Check every existing component, including junctions on any ancestor on Windows.

    This does not claim to defeat a malicious same-user process racing filesystem calls.
    It deliberately checks before resolving, so resolve() cannot conceal a redirect.
    """
    path = Path(path).absolute()
    for parent in reversed(path.parents):
        _node(parent, directory=True, missing=True)
    exists = _node(path, directory=directory, missing=missing)
    if root is not None:
        root = Path(root).absolute()
        regular_path(root, directory=True)
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("private data path escaped its owner directory")
    return exists


def validate_tree(root: Path) -> None:
    """Validate every descendant before an explicitly authorized owner-data deletion."""
    root = Path(root)
    if not regular_path(root, directory=True):
        return
    pending = [root]
    while pending:
        for path in pending.pop().iterdir():
            regular_path(path, root=root)
            if path.is_dir():
                pending.append(path)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("private JSON contains duplicate keys")
        result[key] = value
    return result


def _constant(_value):
    raise ValueError("private JSON contains a non-JSON numeric value")


def _finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("private JSON contains a non-finite numeric value")
    return number


def validate_json(
    raw: bytes, *, limit: int = MAX_PRIVATE_JSON, include_credentials: bool = True
) -> dict:
    if len(raw) > limit:
        raise ValueError("private JSON exceeds its size limit (1 MiB by default)")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_pairs,
            parse_constant=_constant,
            parse_float=_finite_float,
        )
        if not isinstance(value, dict):
            raise ValueError("private JSON requires a top-level object")
        pending = [(value, 0)]
        while pending:
            current, depth = pending.pop()
            if depth > MAX_JSON_DEPTH:
                raise ValueError("private JSON nesting is too deep")
            if isinstance(current, dict):
                for key, child in current.items():
                    key.encode("utf-8")
                    pending.append((child, depth + 1))
            elif isinstance(current, list):
                pending.extend((child, depth + 1) for child in current)
            elif isinstance(current, str):
                current.encode("utf-8")
        if not include_credentials:
            # Keep storage usable before the backup package is initialized at startup.
            from .backups.privacy import has_embedded_secret

            if has_embedded_secret(value):
                raise ValueError(
                    "private JSON contains embedded credentials; remove them or explicitly include credentials"
                )
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        if isinstance(exc, ValueError) and "embedded credentials" in str(exc):
            raise
        raise ValueError("private data must be bounded, strict UTF-8 JSON objects") from exc
    return value


def encode_json(value: dict, *, limit: int = MAX_PRIVATE_JSON) -> bytes:
    """Freeze and validate the exact bytes that will be committed, not a mutable caller value."""
    try:
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError) as exc:
        raise ValueError("private data must be JSON-compatible") from exc
    validate_json(raw, limit=limit)
    return raw


def read_json_file(
    path: Path, *, limit: int = MAX_PRIVATE_JSON, include_credentials: bool = True
) -> dict:
    return validate_json(
        read_bytes_file(path, limit=limit), limit=limit, include_credentials=include_credentials
    )


def read_bytes_file(path: Path, *, limit: int = MAX_PRIVATE_JSON) -> bytes:
    regular_path(path, directory=False, missing=False)
    if path.stat().st_size > limit:
        raise ValueError("private JSON exceeds its size limit (1 MiB by default)")
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("private JSON exceeds its size limit (1 MiB by default)")
    return raw


def _mkdir(path: Path) -> None:
    regular_path(path, directory=True)
    path.mkdir(parents=True, exist_ok=True)
    regular_path(path, directory=True, missing=False)


def atomic_write(path: Path, raw: bytes) -> None:
    """Commit a byte snapshot with a same-directory file and clean up every normal failure."""
    path = Path(path)
    regular_path(path, directory=False)
    _mkdir(path.parent)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        regular_path(temporary, directory=False, missing=False)
        regular_path(path, directory=False)
        os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        # Do not follow a replaced parent to clean an unrelated file.
        regular_path(temporary, directory=False)
        temporary.unlink(missing_ok=True)


def atomic_json(path: Path, value: dict) -> None:
    """Thin JSON adapter for the SDK's existing patch/test boundary."""
    atomic_write(path, encode_json(value))


def validate_wallpaper_record(record: dict, identifier: str) -> dict:
    from .theme_media import MEDIA_FORMATS

    if not isinstance(identifier, str) or not WALLPAPER_ID.fullmatch(identifier):
        raise ValueError("invalid wallpaper identifier")
    if not isinstance(record, dict) or set(record) != {"id", "filename", "kind", "suffix"}:
        raise ValueError("invalid wallpaper metadata")
    filename, kind, suffix = record["filename"], record["kind"], record["suffix"]
    if (
        record["id"] != identifier
        or not isinstance(filename, str)
        or not filename
        or len(filename) > 255
        or filename != filename.strip(" .")
        or any(ord(c) < 32 or 127 <= ord(c) < 160 or c in "/\\" for c in filename)
        or not isinstance(kind, str)
        or kind not in MEDIA_FORMATS
        or not isinstance(suffix, str)
        or suffix not in MEDIA_FORMATS[kind]
        or PurePosixPath(filename).suffix.lower() != f".{suffix}"
    ):
        raise ValueError("invalid wallpaper metadata")
    return record


def validate_media_file(path: Path, suffix: str, *, limit: int = MAX_WALLPAPER_BYTES) -> None:
    """Validate a bounded header, not a media decode or whole-file read."""
    from .theme_media import MAX_IMAGE_ANIMATION_PROBE, valid_media

    regular_path(path, directory=False, missing=False)
    size = path.stat().st_size
    if not 0 < size <= limit:
        raise ValueError("private media is empty or exceeds its size limit")
    with path.open("rb") as stream:
        header = stream.read(MAX_IMAGE_ANIMATION_PROBE)
    if not valid_media(f"assets/media.{suffix}", header):
        raise ValueError("private media signature does not match its type")


class PrivateStore:
    """One logical private owner, with explicit canonical and legacy physical sources."""

    def __init__(self, workspace: Path, kind: str, identifier: str):
        validate_identifier(identifier)
        if kind not in {"extension", "theme"}:
            raise ValueError("invalid private owner kind")
        workspace = Path(workspace).absolute()
        regular_path(workspace, directory=True)
        self.workspace = workspace.resolve()
        self.kind = kind
        self.identifier = identifier
        self.root = (
            self.workspace
            / ("extensions_data" if kind == "extension" else "theme_data")
            / identifier
        )
        regular_path(self.root, directory=True)

    @staticmethod
    def _parts(parts: tuple[str, ...]) -> None:
        if any(
            not isinstance(part, str)
            or not part
            or part in {".", ".."}
            or any(char in part for char in "/\\:\0")
            or part != part.strip(" .")
            for part in parts
        ):
            raise ValueError("invalid private data relative path")

    def directory(self, *parts: str, create: bool = False) -> Path:
        self._parts(parts)
        path = self.root.joinpath(*parts)
        regular_path(path, directory=True, root=self.workspace)
        if create:
            _mkdir(path)
        return path

    def file(self, *parts: str, missing: bool = True) -> Path:
        if not parts:
            raise ValueError("private file needs a relative name")
        self._parts(parts)
        path = self.root.joinpath(*parts)
        regular_path(path, directory=False, missing=missing, root=self.workspace)
        return path

    def sources(self, *parts: str) -> tuple[Path, ...]:
        self._parts(parts)
        canonical = self.root.joinpath(*parts)
        paths = [canonical]
        if self.kind == "extension" and parts in {(), ("preferences.json",)}:
            paths.append(self.workspace.joinpath("extension_data", self.identifier, *parts))
        elif self.kind == "theme" and (not parts or parts[0] == "wallpapers"):
            paths.append(
                self.workspace.joinpath(
                    "themes", self.identifier, "user_wallpapers", *(parts[1:] if parts else ())
                )
            )
        directory = True if not parts or parts == ("wallpapers",) else None
        for path in paths:
            regular_path(path, directory=directory, root=self.workspace)
        return tuple(paths)

    def load_json(
        self,
        name: str = "preferences.json",
        *,
        limit: int = MAX_PRIVATE_JSON,
        include_credentials: bool = True,
    ) -> dict:
        for path in self.sources(name):
            if regular_path(path, directory=False):
                return read_json_file(path, limit=limit, include_credentials=include_credentials)
        return {}

    def write_json(
        self, value: dict, name: str = "preferences.json", *, limit: int = MAX_PRIVATE_JSON
    ) -> None:
        raw = encode_json(value, limit=limit)
        atomic_write(self.file(name), raw)

    @staticmethod
    def revision(value: dict) -> str:
        return hashlib.sha256(encode_json(value)).hexdigest()
