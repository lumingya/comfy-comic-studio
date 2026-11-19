"""Host-owned extension preferences share the SDK data owner's physical directory."""

from __future__ import annotations

from pathlib import Path

from .private_store import MAX_PRIVATE_JSON, PrivateStore, regular_path, validate_json

MAX_PREFERENCES_JSON = MAX_PRIVATE_JSON


def extension_preferences_dir(data_dir: Path, identifier: str) -> Path:
    return PrivateStore(data_dir, "extension", identifier).directory()


def preferences_path(data_dir: Path, identifier: str) -> Path:
    return PrivateStore(data_dir, "extension", identifier).file("preferences.json")


def preferences_exist(data_dir: Path, identifier: str) -> bool:
    return any(
        regular_path(path, directory=False)
        for path in PrivateStore(data_dir, "extension", identifier).sources("preferences.json")
    )


def validate_preferences(raw: bytes) -> dict:
    return validate_json(raw, limit=MAX_PREFERENCES_JSON)


def load_preferences(data_dir: Path, identifier: str) -> dict:
    return PrivateStore(data_dir, "extension", identifier).load_json(limit=MAX_PREFERENCES_JSON)


def save_preferences(data_dir: Path, identifier: str, value: dict) -> None:
    PrivateStore(data_dir, "extension", identifier).write_json(value, limit=MAX_PREFERENCES_JSON)
