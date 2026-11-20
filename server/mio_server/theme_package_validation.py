"""Validate inert theme manifests, media and local package trees."""

from __future__ import annotations

import json
import re
import stat
from pathlib import Path

from .fs_paths import regular_path_metadata
from .theme_media import asset_parts, is_asset_directory, valid_media, validate_stylesheet
from .themes import Theme, parse_theme

MANIFEST = "mio-theme.json"
THEME_FILE = "theme.json"
README = "README.md"
SCRIPT = "theme.js"
STYLE = "theme.css"
PACKAGE_FILES = {MANIFEST, THEME_FILE, README, SCRIPT, STYLE}
MAX_PACKAGE = 10 * 1024**3
MAX_FILE = 10 * 1024**3
MAX_METADATA = 2 * 1024 * 1024
MAX_SCRIPT = 1024 * 1024
MAX_SETTINGS_PAGE = 2 * 1024 * 1024
MAX_FILES = 64
COPY_CHUNK_SIZE = 1024 * 1024
RESERVED_IDS = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
SETTINGS_PAGE_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}\.html$")
USER_WALLPAPERS = "user_wallpapers"


def _is_user_wallpapers_path(parts: tuple[str, ...] | list[str], *, directory=False) -> bool:
    return bool(parts and parts[0] == USER_WALLPAPERS and (directory or len(parts) > 1))


class ThemePackageError(ValueError):
    pass


def _regular_path(path: Path, *, directory: bool, missing: bool = False) -> bool:
    """Check without following Windows junctions, symbolic links or special files."""
    try:
        return regular_path_metadata(path, directory=directory, missing=missing) is not None
    except (OSError, ValueError) as exc:
        raise ThemePackageError("主题路径不能包含链接、重解析点或特殊文件") from exc


def allowed_package_path(name: str) -> bool:
    return (
        name in PACKAGE_FILES
        or SETTINGS_PAGE_NAME.fullmatch(name) is not None
        or asset_parts(name) is not None
    )


def _folder_files(folder: Path) -> list[tuple[str, Path]]:
    _regular_path(folder, directory=True)
    pending = [(folder, "")]
    files: list[tuple[str, Path]] = []
    directories = 0
    while pending:
        parent, relative = pending.pop()
        for child in parent.iterdir():
            name = f"{relative}/{child.name}" if relative else child.name
            metadata = child.lstat()
            is_directory = stat.S_ISDIR(metadata.st_mode)
            _regular_path(child, directory=is_directory)
            if is_directory:
                if not relative and child.name == "user_wallpapers":
                    continue
                directories += 1
                if not is_asset_directory(name) or directories > MAX_FILES:
                    raise ThemePackageError("主题文件夹包含不支持的目录")
                pending.append((child, name))
            else:
                if not allowed_package_path(name):
                    raise ThemePackageError("主题文件夹包含不支持的文件")
                files.append((name, child))
                if len(files) > MAX_FILES:
                    raise ThemePackageError("主题文件过多")
    return files


def _folder_entries(folder: Path) -> list[Path]:
    return [path for _, path in _folder_files(folder)]


def _validate_manifest(raw: bytes) -> dict:
    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ThemePackageError("主题清单不是有效 UTF-8 JSON") from exc
    fields = {"id", "name", "version", "author", "description", "theme_file"}
    if not isinstance(manifest, dict) or set(manifest) != fields:
        raise ThemePackageError("主题清单字段不正确")
    if (
        not isinstance(manifest["id"], str)
        or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,47}", manifest["id"])
        or manifest["id"] in RESERVED_IDS
    ):
        raise ThemePackageError("主题清单 ID 无效")
    for key, limit in (("name", 60), ("version", 100), ("author", 200), ("description", 1000)):
        value = manifest[key]
        if not isinstance(value, str) or len(value) > limit:
            raise ThemePackageError(f"主题清单的 {key} 无效")
    if not manifest["name"] or not manifest["version"]:
        raise ThemePackageError("主题名称和版本不能为空")
    if manifest["theme_file"] != THEME_FILE:
        raise ThemePackageError("主题清单只能引用 theme.json")
    return manifest


def _validated_files(
    files: dict[str, bytes],
    *,
    file_names: set[str] | None = None,
    file_sizes: dict[str, int] | None = None,
) -> tuple[dict, Theme]:
    names = set(files) if file_names is None else file_names
    sizes = file_sizes or {name: len(data) for name, data in files.items()}
    _validate_file_sizes(names, sizes)
    if not {MANIFEST, THEME_FILE} <= names or any(not allowed_package_path(name) for name in names):
        raise ThemePackageError("主题包必须只包含清单、theme.json、说明及已声明资源")
    manifest = _validate_manifest(files[MANIFEST])
    try:
        document = json.loads(files[THEME_FILE].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ThemePackageError("theme.json 不是有效 UTF-8 JSON") from exc
    try:
        theme = parse_theme(document)
    except ValueError as exc:
        raise ThemePackageError(str(exc)) from exc
    if theme.id != manifest["id"] or theme.name != manifest["name"]:
        raise ThemePackageError("主题清单与 theme.json 的 ID 或名称不一致")
    asset_names = {name for name in names if asset_parts(name)}
    if names - asset_names - {MANIFEST, THEME_FILE, README} != {
        name for name in (theme.script_file, theme.style_file, theme.settings_page) if name
    }:
        raise ThemePackageError("主题资源与 theme.json 中的声明不一致")
    if README in files:
        try:
            files[README].decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ThemePackageError("README.md 不是有效 UTF-8") from exc
    if SCRIPT in names:
        try:
            files[SCRIPT].decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ThemePackageError("theme.js 不是有效 UTF-8") from exc
    if theme.settings_page:
        try:
            files[theme.settings_page].decode("utf-8")
        except KeyError:
            raise ThemePackageError("主题设置页面不存在") from None
        except UnicodeDecodeError as exc:
            raise ThemePackageError("主题设置页面不是有效 UTF-8") from exc
    if theme.style_file:
        try:
            stylesheet = files[theme.style_file].decode("utf-8")
        except KeyError:
            raise ThemePackageError("主题声明的 theme.css 不存在") from None
        except UnicodeDecodeError as exc:
            raise ThemePackageError("theme.css 不是有效 UTF-8") from exc
        try:
            references = validate_stylesheet(
                stylesheet, {name for name in names if asset_parts(name)}
            )
        except ValueError as exc:
            raise ThemePackageError(str(exc)) from exc
        if asset_names - references - ({theme.background.file} if theme.background else set()):
            raise ThemePackageError("主题包包含未被主题引用的资源")
    elif asset_names - ({theme.background.file} if theme.background else set()):
        raise ThemePackageError("主题资源必须由背景或 theme.css 声明")
    for name in names:
        if asset_parts(name) and not valid_media(name, files.get(name, b"")):
            raise ThemePackageError(f"主题资源内容与文件格式不匹配或文件已损坏：{name}")
    if theme.background and theme.background.file not in names:
        raise ThemePackageError("主题声明的背景资源不存在")
    return manifest, theme


def _validate_file_sizes(names: set[str], sizes: dict[str, int]) -> None:
    if not {MANIFEST, THEME_FILE} <= names or any(not allowed_package_path(name) for name in names):
        raise ThemePackageError("主题包必须只包含清单、theme.json、说明及已声明资源")
    if (
        set(sizes) != names
        or len(names) > MAX_FILES
        or sum(sizes.values()) > MAX_PACKAGE
        or any(size < 0 or size > MAX_FILE for size in sizes.values())
    ):
        raise ThemePackageError("主题包超过 10 GiB 或文件过多")
    if any(
        sizes[name] > MAX_METADATA
        for name in (MANIFEST, THEME_FILE, README, STYLE)
        if name in names
    ):
        raise ThemePackageError("主题清单或说明超过 2 MB")
    if any(sizes[name] > MAX_SETTINGS_PAGE for name in names if SETTINGS_PAGE_NAME.fullmatch(name)):
        raise ThemePackageError("主题设置页面超过 2 MB")
    if sizes.get(SCRIPT, 0) > MAX_SCRIPT:
        raise ThemePackageError("主题脚本超过 1 MB")


def _read_folder(
    folder: Path, *, enforce_folder_name: bool = True
) -> tuple[dict, Theme, dict[str, bytes]]:
    paths = _folder_files(folder)
    sizes = {name: path.stat().st_size for name, path in paths}
    _validate_file_sizes(set(sizes), sizes)
    files = {}
    for name, path in paths:
        if asset_parts(name):
            with path.open("rb") as source:
                files[name] = source.read(64 * 1024 if name.lower().endswith(".png") else 12)
        else:
            files[name] = path.read_bytes()
    manifest, theme = _validated_files(files, file_names=set(sizes), file_sizes=sizes)
    if enforce_folder_name and folder.name != manifest["id"]:
        raise ThemePackageError("主题清单 ID 与文件夹名称不一致")
    return manifest, theme, files
