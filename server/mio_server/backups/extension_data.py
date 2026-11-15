"""Portable extension settings: bounded JSON data, no package code or executable paths."""

import hashlib
import json
import math
import re
import stat
from pathlib import Path

from .paths import atomic_json
from .privacy import has_embedded_secret

MAX_EXTENSION_JSON = 1024 * 1024
# Keep the same extension ID syntax as extensions.manifest, without importing the SDK loader.
EXTENSION_PATH = re.compile(r"extension-data/[a-z0-9][a-z0-9_-]{1,47}\.json")
# paths.atomic_json uses tempfile.mkstemp(prefix=".write-") with an eight-character suffix.
ATOMIC_TEMP = re.compile(r"\.write-[a-z0-9_]{8}")
RESERVED = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}


def allowed_extension_path(name: str) -> bool:
    return EXTENSION_PATH.fullmatch(name) is not None and Path(name).stem not in RESERVED


def regular_path(path: Path):
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return
    if (
        stat.S_ISLNK(metadata.st_mode)
        or getattr(metadata, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    ):
        raise ValueError("extension settings must not contain links or reparse points")
    if not (stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode)):
        raise ValueError("extension settings require regular files and directories")


def _settings_root(workspace: Path) -> Path:
    workspace = workspace.resolve()
    root = workspace / "extension-data"
    regular_path(root)
    if root.resolve() != root or (root.exists() and not root.is_dir()):
        raise ValueError("extension settings directory is not a regular local directory")
    return root


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("extension settings contain duplicate JSON keys")
        result[key] = value
    return result


def _constant(value):
    raise ValueError("extension settings contain a non-JSON numeric value")


def _float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("extension settings contain a non-finite numeric value")
    return number


def validate_settings(raw: bytes, *, include_credentials: bool = True) -> dict:
    if len(raw) > MAX_EXTENSION_JSON:
        raise ValueError("extension settings file exceeds 1 MiB")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_pairs,
            parse_constant=_constant,
            parse_float=_float,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError("extension settings must be valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("extension settings require a top-level JSON object")
    try:
        secret = not include_credentials and has_embedded_secret(value)
    except RecursionError as exc:
        raise ValueError("extension settings JSON nesting is too deep") from exc
    if secret:
        raise ValueError(
            "extension settings contain embedded credentials; remove them or explicitly include credentials"
        )
    return value


def _read(path: Path, *, include_credentials: bool = True) -> tuple[bytes, dict]:
    regular_path(path)
    if not path.is_file():
        raise ValueError("extension settings require regular JSON files")
    if path.stat().st_size > MAX_EXTENSION_JSON:
        raise ValueError("extension settings file exceeds 1 MiB")
    with path.open("rb") as stream:
        raw = stream.read(MAX_EXTENSION_JSON + 1)
    return raw, validate_settings(raw, include_credentials=include_credentials)


def settings_files(workspace: Path, *, include_credentials: bool = True):
    """Yield one validated file at a time; never hold an entire settings directory in memory."""
    root = _settings_root(workspace)
    if not root.exists():
        return
    for path in sorted(root.iterdir()):
        regular_path(path)
        if ATOMIC_TEMP.fullmatch(path.name):
            if not path.is_file():
                raise ValueError("extension settings temporary path must be a regular file")
            # A killed writer may leave an incomplete temporary. Only committed .json files
            # belong to the workspace head or backup; never read or export the leftover bytes.
            continue
        name = f"extension-data/{path.name}"
        if not allowed_extension_path(name):
            raise ValueError("extension settings contain an unsupported filename")
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
    name = f"extension-data/{identifier}.json"
    if not allowed_extension_path(name):
        raise ValueError("invalid extension settings identifier")
    path = _settings_root(workspace) / f"{identifier}.json"
    regular_path(path)
    return _read(path)[1] if path.exists() else {}


def settings_exist(workspace: Path, identifier: str) -> bool:
    if not allowed_extension_path(f"extension-data/{identifier}.json"):
        raise ValueError("invalid extension settings identifier")
    path = _settings_root(workspace) / f"{identifier}.json"
    regular_path(path)
    return path.is_file()


def save_settings(workspace: Path, identifier: str, value: dict) -> None:
    name = f"extension-data/{identifier}.json"
    if not allowed_extension_path(name):
        raise ValueError("invalid extension settings identifier")
    # These formatting options match paths.atomic_json; the byte boundary is regression-tested.
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
    validated = validate_settings(raw)
    path = _settings_root(workspace) / f"{identifier}.json"
    regular_path(path)
    atomic_json(path, validated)
