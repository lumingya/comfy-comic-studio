"""Bounded ZIP extraction shared by byte and disk theme imports."""

from __future__ import annotations

import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from . import theme_package_validation as validation
from .theme_package_validation import (
    PACKAGE_FILES,
    ThemePackageError,
    _folder_files,
    _is_user_wallpapers_path,
    _read_folder,
    _validate_file_sizes,
    allowed_package_path,
)
from .themes import Theme


def _unpack(data: bytes) -> tuple[dict, Theme, dict[str, bytes]]:
    if not data or len(data) > validation.MAX_PACKAGE:
        raise ThemePackageError("主题 ZIP 为空或超过 10 GiB")
    # The byte adapter deliberately shares the disk importer's sole authority.
    # Only callers requesting the legacy in-memory result materialize resource bytes.
    with tempfile.TemporaryDirectory(prefix="mio-theme-bytes-") as temporary:
        root = Path(temporary)
        archive = root / "package.zip"
        archive.write_bytes(data)
        folder = root / "package"
        folder.mkdir()
        manifest, theme = _extract_zip_to_folder(archive, folder)
        return manifest, theme, {name: path.read_bytes() for name, path in _folder_files(folder)}


def _extract_zip_to_folder(archive_path: Path, folder: Path) -> tuple[dict, Theme]:
    if not archive_path.is_file() or archive_path.stat().st_size > validation.MAX_PACKAGE:
        raise ThemePackageError("主题 ZIP 为空或超过 10 GiB")
    try:
        with zipfile.ZipFile(archive_path) as archive:
            infos = archive.infolist()
            if len(infos) > validation.MAX_FILES + 3:
                raise ThemePackageError("主题 ZIP 文件过多")
            entries: list[tuple[zipfile.ZipInfo, tuple[str, ...]]] = []
            directories: set[str] = set()
            seen: set[str] = set()
            for info in infos:
                name = info.filename
                if "\\" in name or ":" in name:
                    raise ThemePackageError("主题 ZIP 包含不安全路径")
                raw_parts = name.removesuffix("/").split("/")
                path = PurePosixPath(name)
                parts = path.parts
                if path.is_absolute() or not parts or any(p in {"", ".", ".."} for p in raw_parts):
                    raise ThemePackageError("主题 ZIP 包含不安全路径")
                mode = info.external_attr >> 16
                kind = stat.S_IFMT(mode)
                if (
                    stat.S_ISLNK(mode)
                    or (kind and not info.is_dir() and not stat.S_ISREG(mode))
                    or info.flag_bits & 1
                ):
                    raise ThemePackageError("主题 ZIP 不支持链接、特殊文件或加密条目")
                if info.is_dir():
                    directories.add("/".join(parts))
                    continue
                if info.file_size > validation.MAX_FILE:
                    raise ThemePackageError("单个主题文件超过 10 GiB")
                key = "/".join(parts).casefold()
                if key in seen:
                    raise ThemePackageError("主题 ZIP 包含重复文件")
                seen.add(key)
                entries.append((info, parts))
            if not entries:
                raise ThemePackageError("主题 ZIP 不包含文件")
            if sum(info.file_size for info, _ in entries) > validation.MAX_PACKAGE:
                raise ThemePackageError("主题包解压后超过 10 GiB")
            roots = {parts[0] for _, parts in entries}
            has_folder = len(roots) == 1 and all(
                len(parts) >= 2
                and (
                    _is_user_wallpapers_path(parts[1:]) or allowed_package_path("/".join(parts[1:]))
                )
                and parts[0] not in PACKAGE_FILES
                and parts[0] != "assets"
                for _, parts in entries
            )
            root = next(iter(roots)) if has_folder else ""
            names = [
                (info, parts)
                for info, parts in entries
                if not _is_user_wallpapers_path(parts[1:] if has_folder else parts)
            ]
            if not names:
                raise ThemePackageError("主题 ZIP 不包含文件")
            normalized_names: set[str] = set()
            normalized_seen: set[str] = set()
            normalized_entries = []
            for info, parts in names:
                relative = parts[1:] if has_folder else parts
                normalized = "/".join(relative)
                if not allowed_package_path(normalized):
                    raise ThemePackageError("主题 ZIP 包含不支持的路径或文件")
                if normalized.casefold() in normalized_seen:
                    raise ThemePackageError("主题 ZIP 包含重复文件")
                normalized_seen.add(normalized.casefold())
                normalized_names.add(normalized)
                normalized_entries.append((info, relative, normalized))
            sizes = {normalized: info.file_size for info, _, normalized in normalized_entries}
            _validate_file_sizes(set(sizes), sizes)
            for info, relative, _ in normalized_entries:
                target = folder.joinpath(*relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                copied = 0
                with archive.open(info) as source, target.open("xb") as output:
                    while chunk := source.read(validation.COPY_CHUNK_SIZE):
                        copied += len(chunk)
                        if copied > info.file_size or copied > validation.MAX_FILE:
                            raise ThemePackageError("主题 ZIP 条目超过声明大小")
                        output.write(chunk)
                if copied != info.file_size:
                    raise ThemePackageError("主题 ZIP 条目大小与声明不一致")
            expected_directories = set()
            for name in normalized_names:
                parts = name.split("/")
                for depth in range(1, len(parts)):
                    directory = "/".join(parts[:depth])
                    if directory == "assets" or directory.startswith("assets/"):
                        expected_directories.add(directory)
            allowed_directories = expected_directories | ({root} if has_folder else set())
            normalized_directories = {
                "/".join(PurePosixPath(name).parts[1:] if has_folder else PurePosixPath(name).parts)
                for name in directories
                if not has_folder or name != root
            }
            normalized_directories = {
                name
                for name in normalized_directories
                if not _is_user_wallpapers_path(tuple(name.split("/")), directory=True)
            }
            if normalized_directories - allowed_directories:
                raise ThemePackageError("主题 ZIP 包含不支持的目录")
    except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError) as exc:
        raise ThemePackageError("无法读取主题 ZIP") from exc
    manifest, theme, _ = _read_folder(folder, enforce_folder_name=False)
    if has_folder and root != manifest["id"]:
        raise ThemePackageError("主题清单 ID 与 ZIP 文件夹名称不一致")
    return manifest, theme
