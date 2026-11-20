"""Core-owned UI preferences and wallpapers, separate from portable package exports."""

import re
import shutil
from pathlib import Path

from ..private_store import (
    MAX_PRIVATE_JSON,
    MAX_WALLPAPER_BYTES,
    MAX_WALLPAPER_RECORD,
    read_json_file,
    regular_path,
    validate_identifier,
    validate_media_file,
    validate_wallpaper_record,
)

MAX_WALLPAPER = MAX_WALLPAPER_BYTES
PREFERENCES = re.compile(
    r"(?:extensions_data|extension_data|theme_data)/([a-z0-9][a-z0-9_-]{1,47})/preferences\.json"
)
WALLPAPER = re.compile(
    r"(?:themes/([a-z0-9][a-z0-9_-]{1,47})/user_wallpapers|"
    r"theme_data/([a-z0-9][a-z0-9_-]{1,47})/wallpapers)/"
    r"(wallpaper_[a-f0-9]{32})\.(json|jpg|jpeg|png|gif|webp|avif|mp4|webm|ogv)"
)
TEMPORARY = re.compile(r"\.(?:write|theme-write|wallpaper)-[a-z0-9_]{8}")


def allowed_path(name: str) -> bool:
    match = PREFERENCES.fullmatch(name) or WALLPAPER.fullmatch(name)
    if match is None:
        return False
    try:
        validate_identifier(match[1] or match[2])
    except ValueError:
        return False
    return True


def size_limit(name: str) -> int:
    if not allowed_path(name):
        raise ValueError("unrecognized UI data path")
    if PREFERENCES.fullmatch(name):
        return MAX_PRIVATE_JSON
    return MAX_WALLPAPER_RECORD if name.endswith(".json") else MAX_WALLPAPER


def _directory(path: Path) -> bool:
    regular_path(path)
    if not path.exists():
        return False
    if not path.is_dir():
        raise ValueError("UI data requires regular local directories")
    return True


def _file(path: Path, limit: int) -> None:
    regular_path(path)
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError("UI data file is missing, invalid or exceeds its size limit")


def _json(path: Path, limit: int, *, include_credentials: bool = True) -> dict:
    return read_json_file(path, limit=limit, include_credentials=include_credentials)


def wallpaper_container(folder: Path) -> bool:
    """Only this exact private-data container may lack a portable theme manifest."""
    validate_identifier(folder.name)
    if not _directory(folder):
        return False
    children = list(folder.iterdir())
    return len(children) == 1 and children[0].name == "user_wallpapers" and _directory(children[0])


def _preferences(workspace: Path, area: str, *, include_credentials: bool):
    root = workspace / area
    if not _directory(root):
        return
    for folder in sorted(root.iterdir()):
        validate_identifier(folder.name)
        if not _directory(folder):
            continue
        for path in sorted(folder.iterdir()):
            regular_path(path)
            if TEMPORARY.fullmatch(path.name) and path.is_file():
                continue
            if area == "extensions_data" and path.name != "preferences.json":
                # SDK settings and participant-owned business data have their own catalog.
                continue
            if area == "theme_data" and path.name == "wallpapers" and path.is_dir():
                continue
            if path.name != "preferences.json":
                raise ValueError("UI preferences contain an unsupported file")
            _json(path, MAX_PRIVATE_JSON, include_credentials=include_credentials)
            yield path.relative_to(workspace).as_posix(), path


def _wallpapers(workspace: Path, area: str, child: str):
    root = workspace / area
    if not _directory(root):
        return
    for theme in sorted(root.iterdir()):
        validate_identifier(theme.name)
        if not _directory(theme):
            continue
        folder = theme / child
        if not _directory(folder):
            continue
        files = {}
        for path in sorted(folder.iterdir()):
            regular_path(path)
            if TEMPORARY.fullmatch(path.name) and path.is_file():
                continue
            name = path.relative_to(workspace).as_posix()
            if not allowed_path(name):
                raise ValueError("user wallpapers contain an unsupported file")
            _file(path, size_limit(name))
            files[path.name] = path
        used = set()
        for name, metadata in files.items():
            if not name.endswith(".json"):
                continue
            identifier = metadata.stem
            record = validate_wallpaper_record(_json(metadata, MAX_WALLPAPER_RECORD), identifier)
            suffix = record["suffix"]
            media_name = f"{identifier}.{suffix}"
            media = files.get(media_name)
            if media is None:
                raise ValueError("wallpaper media is missing")
            validate_media_file(media, suffix, limit=MAX_WALLPAPER)
            used.update((name, media_name))
            yield metadata.relative_to(workspace).as_posix(), metadata
            yield media.relative_to(workspace).as_posix(), media
        if used != files.keys():
            raise ValueError("wallpapers require matching metadata and media files")


def data_files(workspace: Path, *, include_credentials: bool = True):
    workspace = workspace.absolute()
    regular_path(workspace, directory=True)
    for area in ("extensions_data", "extension_data", "theme_data"):
        yield from _preferences(workspace, area, include_credentials=include_credentials)
    yield from _wallpapers(workspace, "theme_data", "wallpapers")
    yield from _wallpapers(workspace, "themes", "user_wallpapers")


def copy_data(source: Path, target: Path, *, include_credentials: bool, byte_budget: int) -> int:
    total = 0
    for name, path in data_files(source, include_credentials=include_credentials):
        size = path.stat().st_size
        if total + size > byte_budget:
            raise ValueError("workspace exceeds the archive size limit")
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        if destination.stat().st_size != size:
            raise ValueError("UI data file changed while creating the backup")
        total += size
    return total
