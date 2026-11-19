"""Bounded, isolated JSON preferences for each extension."""

from __future__ import annotations

import json
import math
from pathlib import Path

from .backups.extension_data import regular_path, validate_identifier
from .backups.paths import atomic_json

MAX_PREFERENCES_JSON = 1024 * 1024


def extension_preferences_dir(data_dir: Path, identifier: str) -> Path:
    validate_identifier(identifier)
    root = Path(data_dir).resolve() / "extension_data"
    regular_path(root)
    if root.resolve() != root or (root.exists() and not root.is_dir()):
        raise ValueError("extension preferences require a regular local directory")
    folder = root / identifier
    regular_path(folder)
    if folder.resolve() != folder or (folder.exists() and not folder.is_dir()):
        raise ValueError("extension preferences require a regular local directory")
    return folder


def preferences_path(data_dir: Path, identifier: str) -> Path:
    path = extension_preferences_dir(data_dir, identifier) / "preferences.json"
    regular_path(path)
    return path


def preferences_exist(data_dir: Path, identifier: str) -> bool:
    path = preferences_path(data_dir, identifier)
    if not path.exists():
        return False
    if not path.is_file():
        raise ValueError("extension preferences require a regular JSON file")
    return True


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("extension preferences contain duplicate JSON keys")
        result[key] = value
    return result


def _constant(_value):
    raise ValueError("extension preferences contain a non-JSON numeric value")


def _float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("extension preferences contain a non-finite numeric value")
    return number


def validate_preferences(raw: bytes) -> dict:
    if len(raw) > MAX_PREFERENCES_JSON:
        raise ValueError("extension preferences exceed 1 MiB")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_pairs,
            parse_constant=_constant,
            parse_float=_float,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise ValueError("extension preferences must be valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("extension preferences require a top-level JSON object")
    return value


def load_preferences(data_dir: Path, identifier: str) -> dict:
    path = preferences_path(data_dir, identifier)
    if not path.exists():
        return {}
    if not path.is_file():
        raise ValueError("extension preferences require a regular JSON file")
    if path.stat().st_size > MAX_PREFERENCES_JSON:
        raise ValueError("extension preferences exceed 1 MiB")
    with path.open("rb") as stream:
        raw = stream.read(MAX_PREFERENCES_JSON + 1)
    return validate_preferences(raw)


def save_preferences(data_dir: Path, identifier: str, value: dict) -> None:
    try:
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValueError("extension preferences must be JSON-compatible") from exc
    validated = validate_preferences(raw)
    path = preferences_path(data_dir, identifier)
    atomic_json(path, validated)
