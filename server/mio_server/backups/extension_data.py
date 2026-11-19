"""Portable extension settings: bounded JSON data, no package code or executable paths."""

import hashlib
import re
from pathlib import Path

from ..private_store import (
    IDENTIFIER,
    MAX_PRIVATE_JSON,
    RESERVED_IDS,
    PrivateStore,
    encode_json,
    read_bytes_file,
    validate_json,
)
from ..private_store import atomic_json as atomic_json
from ..private_store import regular_path as regular_path
from ..private_store import validate_identifier as validate_identifier
from ..private_store import validate_tree as validate_tree

MAX_EXTENSION_JSON = MAX_PRIVATE_JSON
EXTENSION_ID = IDENTIFIER
RESERVED = RESERVED_IDS
EXTENSION_PATH = re.compile(r"extensions_data/([a-z0-9][a-z0-9_-]{1,47})/settings\.json")
# The shared atomic writer uses mkstemp(prefix=".write-") and an eight-character suffix.
ATOMIC_TEMP = re.compile(r"\.write-[a-z0-9_]{8}")


def allowed_extension_path(name: str) -> bool:
    match = EXTENSION_PATH.fullmatch(name)
    if match is None:
        return False
    try:
        validate_identifier(match[1])
    except ValueError:
        return False
    return True


def _settings_root(workspace: Path) -> Path:
    # Validate before resolve() so an ancestor junction cannot become a trusted root.
    root = Path(workspace).absolute() / "extensions_data"
    regular_path(root, directory=True)
    return root.resolve()


def extension_data_dir(workspace: Path, identifier: str) -> Path:
    return PrivateStore(workspace, "extension", identifier).directory()


def validate_settings(raw: bytes, *, include_credentials: bool = True) -> dict:
    return validate_json(raw, limit=MAX_EXTENSION_JSON, include_credentials=include_credentials)


def _read(path: Path, *, include_credentials: bool = True) -> tuple[bytes, dict]:
    raw = read_bytes_file(path, limit=MAX_EXTENSION_JSON)
    return raw, validate_settings(raw, include_credentials=include_credentials)


def settings_files(workspace: Path, *, include_credentials: bool = True):
    """Yield one validated file at a time; never hold an entire settings directory in memory."""
    root = _settings_root(workspace)
    if not root.exists():
        return
    for folder in sorted(root.iterdir()):
        folder = extension_data_dir(workspace, folder.name)
        # Only SDK settings are copied generically, including data retained after uninstall.
        # Private data belongs to a reviewed package's backup participant.
        for child in folder.iterdir():
            regular_path(child)
        path = folder / "settings.json"
        if not path.exists():
            continue
        name = f"extensions_data/{folder.name}/settings.json"
        raw, _ = _read(path, include_credentials=include_credentials)
        yield name, raw


def with_extension_head(database_head: str, workspace: Path) -> str:
    digest = hashlib.sha256(b"mio.workspace.head.v2\0" + database_head.encode("ascii"))
    for name, raw in settings_files(workspace):
        digest.update(b"\0" + name.encode("utf-8") + b"\0" + hashlib.sha256(raw).digest())
    return digest.hexdigest()


def copy_settings(
    source: Path, target: Path, *, include_credentials: bool, byte_budget: int
) -> int:
    total = 0
    for name, raw in settings_files(source, include_credentials=include_credentials):
        total += len(raw)
        if total > byte_budget:
            raise ValueError("workspace exceeds the archive size limit")
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    return total


def load_settings(workspace: Path, identifier: str) -> dict:
    path = extension_data_dir(workspace, identifier) / "settings.json"
    regular_path(path)
    return _read(path)[1] if path.exists() else {}


def settings_exist(workspace: Path, identifier: str) -> bool:
    path = extension_data_dir(workspace, identifier) / "settings.json"
    regular_path(path)
    return path.is_file()


def save_settings(workspace: Path, identifier: str, value: dict) -> None:
    # Preserve the SDK's atomic_json seam while freezing caller-owned mutable input.
    raw = encode_json(value, limit=MAX_EXTENSION_JSON)
    validated = validate_settings(raw)
    path = extension_data_dir(workspace, identifier) / "settings.json"
    regular_path(path)
    atomic_json(path, validated)
