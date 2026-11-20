"""Independent, data-only theme packages."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import shutil
import stat
import tempfile
import threading
import zipfile
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterable

from .fs_paths import regular_path_metadata
from .theme_media import (
    _skip_string,
    _strip_comments,
    asset_parts,
    is_asset_directory,
    valid_media,
    validate_stylesheet,
)
from .themes import Theme, parse_theme, resolved, to_json

log = logging.getLogger("mio.themes")

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
_CARD_ID_MARKER = "self"
BUILTIN_ROOT = Path(__file__).resolve().parents[2] / "themes"
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


def _unpack(data: bytes) -> tuple[dict, Theme, dict[str, bytes]]:
    if not data or len(data) > MAX_PACKAGE:
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
    if not archive_path.is_file() or archive_path.stat().st_size > MAX_PACKAGE:
        raise ThemePackageError("主题 ZIP 为空或超过 10 GiB")
    try:
        with zipfile.ZipFile(archive_path) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_FILES + 3:
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
                if info.file_size > MAX_FILE:
                    raise ThemePackageError("单个主题文件超过 10 GiB")
                key = "/".join(parts).casefold()
                if key in seen:
                    raise ThemePackageError("主题 ZIP 包含重复文件")
                seen.add(key)
                entries.append((info, parts))
            if not entries:
                raise ThemePackageError("主题 ZIP 不包含文件")
            if sum(info.file_size for info, _ in entries) > MAX_PACKAGE:
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
                    while chunk := source.read(COPY_CHUNK_SIZE):
                        copied += len(chunk)
                        if copied > info.file_size or copied > MAX_FILE:
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


def _rebase_card_stylesheet(data: bytes, old_id: str, new_id: str) -> bytes:
    """Rebind literal card scopes in rule selectors, never in declaration values."""
    try:
        source = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ThemePackageError("theme.css 不是有效 UTF-8") from exc
    prefix = '.theme-card[data-theme-id="'
    replacement = new_id
    edits: list[tuple[int, int]] = []

    def skip_comment(cursor: int) -> int:
        end = source.find("*/", cursor + 2)
        if end < 0:
            raise ThemePackageError("theme.css contains an unterminated comment")
        return end + 2

    def selector(start: int, end: int) -> None:
        cursor = start
        while cursor < end:
            if source.startswith("/*", cursor):
                cursor = skip_comment(cursor)
            elif source[cursor] in "\"'":
                cursor = _skip_string(source, cursor)
            elif source[cursor] == ".":
                # Comments may split selector tokens. Match their logical spelling,
                # but replace only the quoted identity and retain every comment.
                probe = cursor
                for expected in prefix:
                    while source.startswith("/*", probe):
                        probe = skip_comment(probe)
                    if probe >= end or source[probe] != expected:
                        break
                    probe += 1
                else:
                    identity_start = probe
                    identity_end = probe + len(old_id)
                    if source.startswith(old_id + '"', probe):
                        probe = identity_end + 1
                        while source.startswith("/*", probe):
                            probe = skip_comment(probe)
                        if probe < end and source[probe] == "]":
                            edits.append((identity_start, identity_end))
                            cursor = probe + 1
                            continue
                cursor += 1
            else:
                cursor += 1

    cursor = start = parentheses = brackets = 0
    skipped_blocks: list[bool] = []
    while cursor < len(source):
        char = source[cursor]
        if source.startswith("/*", cursor):
            cursor = skip_comment(cursor)
            continue
        if char in "\"'":
            cursor = _skip_string(source, cursor)
            continue
        if char == "(":
            parentheses += 1
        elif char == ")":
            parentheses -= 1
        elif char == "[":
            brackets += 1
        elif char == "]":
            brackets -= 1
        elif parentheses == 0 and brackets == 0:
            if char == "{":
                header = _strip_comments(source[start:cursor]).lstrip()
                # Custom properties can contain arbitrary balanced token blocks.
                skipped = bool(skipped_blocks and skipped_blocks[-1]) or bool(
                    re.match(r"--[A-Za-z0-9_-]+\s*:", header)
                )
                if not skipped and (
                    not header.startswith("@")
                    or re.match(r"@(?:scope|supports)\b", header, re.IGNORECASE)
                ):
                    selector(start, cursor)
                skipped_blocks.append(skipped)
                start = cursor + 1
            elif char in ";}":
                if char == "}" and skipped_blocks:
                    skipped_blocks.pop()
                start = cursor + 1
        cursor += 1

    parts: list[str] = []
    previous = 0
    for start, end in edits:
        parts.extend((source[previous:start], replacement))
        previous = end
    parts.append(source[previous:])
    return "".join(parts).encode("utf-8")


def _resource_identity(name: str, data: bytes, theme_id: str) -> bytes:
    # Re-exporting an already rebound card must retain the same content-derived ID.
    return _rebase_card_stylesheet(data, theme_id, _CARD_ID_MARKER) if name == STYLE else data


def package_theme(theme: Theme, resources: dict[str, bytes] | None = None) -> tuple[str, bytes]:
    """Package validated theme data and referenced assets without executing its script."""
    resources = resources or {}
    document = theme.model_dump(mode="json", exclude={"created_at"})
    document["tokens"] = resolved(theme)
    document.pop("id", None)
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    resource_ids = {
        name: hashlib.sha256(_resource_identity(name, data, theme.id)).hexdigest()
        for name, data in sorted(resources.items())
    }
    canonical += json.dumps(resource_ids, sort_keys=True, separators=(",", ":"))
    package_id = "theme-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    document["id"] = package_id
    manifest = {
        "id": package_id,
        "name": theme.name,
        "version": "1.0.0",
        "author": theme.author,
        "description": "",
        "theme_file": THEME_FILE,
    }
    readme = (
        f"# {theme.name}\n\n"
        "这是独立主题包，包含界面令牌和已声明资源；主题脚本只在隔离沙箱中运行。"
        "可在「设置 → 外观与阅读」导入 ZIP，然后选择主题。\n"
    )
    files = {
        MANIFEST: json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        THEME_FILE: json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        README: readme,
    }
    files.update(
        {
            name: _rebase_card_stylesheet(data, theme.id, "self") if name == STYLE else data
            for name, data in resources.items()
        }
    )
    _validated_files(
        {
            name: content if isinstance(content, bytes) else content.encode("utf-8")
            for name, content in files.items()
        }
    )
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(
                f"{package_id}/{name}",
                content if isinstance(content, bytes) else content.encode("utf-8"),
                compress_type=zipfile.ZIP_STORED
                if name.startswith("assets/")
                else zipfile.ZIP_DEFLATED,
            )
    result = payload.getvalue()
    if len(result) > MAX_PACKAGE:
        raise ThemePackageError("主题 ZIP 超过 10 GiB")
    return package_id, result


def package_theme_to_file(theme: Theme, resources: dict[str, Path], destination: Path) -> str:
    """Write a validated theme ZIP while streaming resource files from disk."""
    document = theme.model_dump(mode="json", exclude={"created_at"})
    document["tokens"] = resolved(theme)
    document.pop("id", None)
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    sizes: dict[str, int] = {}
    samples: dict[str, bytes] = {}
    resource_hashes = {}
    total_size = 0
    for name, path in resources.items():
        if not allowed_package_path(name) or not path.is_file():
            raise ThemePackageError("主题包包含不支持或不存在的资源")
        size = path.stat().st_size
        total_size += size
        if size > MAX_FILE or total_size > MAX_PACKAGE:
            raise ThemePackageError("主题包超过 10 GiB")
        sizes[name] = size
        digest = hashlib.sha256()
        with path.open("rb") as source:
            sample_size = (
                MAX_METADATA
                if name == STYLE
                else MAX_SCRIPT
                if name == SCRIPT
                else MAX_SETTINGS_PAGE
                if SETTINGS_PAGE_NAME.fullmatch(name)
                else 64 * 1024
                if name.lower().endswith(".png")
                else 12
            )
            samples[name] = source.read(sample_size)
            source.seek(0)
            while chunk := source.read(COPY_CHUNK_SIZE):
                digest.update(chunk)
        resource_hashes[name] = digest.hexdigest()
        if name == STYLE and (
            len(samples[name]) != size
            or hashlib.sha256(samples[name]).hexdigest() != resource_hashes[name]
        ):
            raise ThemePackageError("主题样式在导出期间发生变化或超过大小限制")
    identity_hashes = {
        name: hashlib.sha256(_resource_identity(name, samples[name], theme.id)).hexdigest()
        if name == STYLE
        else digest
        for name, digest in resource_hashes.items()
    }
    canonical += json.dumps(identity_hashes, sort_keys=True, separators=(",", ":"))
    package_id = "theme-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    document["id"] = package_id
    overrides = (
        {STYLE: _rebase_card_stylesheet(samples[STYLE], theme.id, "self")}
        if STYLE in samples
        else {}
    )
    source_sizes = dict(sizes)
    files = {
        MANIFEST: json.dumps(
            {
                "id": package_id,
                "name": theme.name,
                "version": "1.0.0",
                "author": theme.author,
                "description": "",
                "theme_file": THEME_FILE,
            },
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")
        + b"\n",
        THEME_FILE: json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8") + b"\n",
        README: (
            f"# {theme.name}\n\n"
            "这是独立主题包，包含界面令牌和已声明资源；主题脚本只在隔离沙箱中运行。"
            "可在「设置 → 外观与阅读」导入 ZIP，然后选择主题。\n"
        ).encode("utf-8"),
        **samples,
        **overrides,
    }
    sizes.update({name: len(files[name]) for name in (MANIFEST, THEME_FILE, README)})
    sizes.update({name: len(data) for name, data in overrides.items()})
    _validated_files(files, file_names=set(sizes), file_sizes=sizes)
    try:
        with zipfile.ZipFile(
            destination, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True
        ) as archive:
            for name, data in files.items():
                if name in resources:
                    continue
                archive.writestr(
                    f"{package_id}/{name}",
                    data,
                    compress_type=(
                        zipfile.ZIP_STORED if name.startswith("assets/") else zipfile.ZIP_DEFLATED
                    ),
                )
            for name, path in resources.items():
                info = zipfile.ZipInfo(f"{package_id}/{name}")
                info.compress_type = (
                    zipfile.ZIP_STORED if name.startswith("assets/") else zipfile.ZIP_DEFLATED
                )
                with archive.open(info, "w", force_zip64=True) as target, path.open("rb") as source:
                    digest = hashlib.sha256()
                    copied = 0
                    if name in overrides:
                        target.write(overrides[name])
                    while chunk := source.read(COPY_CHUNK_SIZE):
                        copied += len(chunk)
                        digest.update(chunk)
                        if name not in overrides:
                            target.write(chunk)
                    if copied != source_sizes[name] or digest.hexdigest() != resource_hashes[name]:
                        raise ThemePackageError("主题资源在导出期间发生变化")
        if destination.stat().st_size > MAX_PACKAGE:
            raise ThemePackageError("主题 ZIP 超过 10 GiB")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return package_id


class ThemePackageManager:
    def __init__(self, ctx, bundled_root: Path | None = None, root: Path | None = None):
        self.ctx = ctx
        self.bundled_root = Path(bundled_root or BUILTIN_ROOT)
        self.root = Path(root or ctx.data_dir / "themes")
        self._installed: dict[str, Path] = {}
        self._lock = threading.RLock()

    def load_all(self) -> None:
        """Register package themes; user JSON and extensions are layered by the caller later."""
        for source, root in (("builtin", self.bundled_root), ("theme-package", self.root)):
            try:
                if not _regular_path(root, directory=True, missing=True):
                    continue
                folders = sorted(root.iterdir())
            except (OSError, ThemePackageError) as exc:
                log.warning("skip invalid theme root %s: %s", root, exc)
                continue
            for folder in folders:
                try:
                    manifest, theme, _ = _read_folder(folder)
                    if manifest["id"] != folder.name:
                        raise ThemePackageError("主题清单 ID 与文件夹名称不一致")
                    if any(item.id == theme.id for item in self.ctx.registry.all("theme")):
                        raise ThemePackageError(f"主题 ID 已被占用：{theme.id}")
                    self.ctx.registry.register(
                        "theme", theme.id, theme, source=source, title=theme.name
                    )
                    if source == "theme-package":
                        self._installed[theme.id] = folder
                except (OSError, ThemePackageError) as exc:
                    log.warning("skip invalid theme package %s: %s", folder, exc)

    def install_package(self, data: bytes) -> dict:
        """Compatibility helper for callers that already hold a ZIP in memory."""
        if not data or len(data) > MAX_PACKAGE:
            raise ThemePackageError("主题 ZIP 为空或超过 10 GiB")
        with tempfile.TemporaryDirectory(prefix="mio-theme-package-") as temporary:
            archive = Path(temporary) / "theme.zip"
            archive.write_bytes(data)
            return self.install_package_path(archive)

    def install_package_path(self, archive: Path) -> dict:
        """Install a theme ZIP with bounded-memory extraction to a staging folder."""
        with self._lock:
            _regular_path(self.root, directory=True, missing=True)
            self.root.mkdir(parents=True, exist_ok=True)
            _regular_path(self.root, directory=True)
            staging = Path(tempfile.mkdtemp(prefix=".theme-", dir=self.root))
            try:
                _, theme = _extract_zip_to_folder(Path(archive), staging)
                return self._publish(theme, staging)
            except BaseException:
                self._discard_staging(staging)
                raise

    def install_folder(self, files: list[tuple[str, bytes]]) -> dict:
        return self.install_folder_streams((name, io.BytesIO(data)) for name, data in files)

    def install_folder_streams(self, files: Iterable[tuple[str, BinaryIO]]) -> dict:
        """Install selected files directly from their upload streams."""
        with self._lock:
            uploads = []
            for upload in files:
                if len(uploads) >= MAX_FILES:
                    raise ThemePackageError("主题文件过多")
                uploads.append(upload)
            raw_names = {raw_name.replace("\\", "/") for raw_name, _ in uploads}
            flat_package = {MANIFEST, THEME_FILE}.issubset(raw_names)
            _regular_path(self.root, directory=True, missing=True)
            self.root.mkdir(parents=True, exist_ok=True)
            _regular_path(self.root, directory=True)
            staging = Path(tempfile.mkdtemp(prefix=".theme-", dir=self.root))
            roots: set[str] = set()
            seen: set[str] = set()
            flat = False
            total = 0
            count = 0
            try:
                for raw_name, source in uploads:
                    name = raw_name.replace("\\", "/")
                    raw_parts = name.split("/")
                    path = PurePosixPath(name)
                    if (
                        not name
                        or ":" in name
                        or path.is_absolute()
                        or any(part in {"", ".", ".."} for part in raw_parts)
                    ):
                        raise ThemePackageError("主题文件夹包含不安全路径")
                    parts = path.parts
                    if len(parts) >= 3 and parts[0] != "assets" and parts[1] == USER_WALLPAPERS:
                        roots.add(parts[0])
                        continue
                    if flat_package and len(parts) >= 2 and parts[0] == USER_WALLPAPERS:
                        continue
                    if len(parts) == 1:
                        flat = True
                    elif parts[0] == "assets":
                        name = "/".join(parts)
                    elif len(parts) == 2:
                        roots.add(parts[0])
                        name = parts[1]
                    elif len(parts) >= 3 and parts[1] == "assets":
                        roots.add(parts[0])
                        name = "/".join(parts[1:])
                    else:
                        raise ThemePackageError("请选择直接包含 mio-theme.json 的主题文件夹")
                    key = name.casefold()
                    if not allowed_package_path(name) or key in seen:
                        raise ThemePackageError("主题文件夹包含重复或不支持的文件")
                    count += 1
                    if count > MAX_FILES:
                        raise ThemePackageError("主题文件过多")
                    seen.add(key)
                    target = staging / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    size = 0
                    with target.open("xb") as output:
                        while chunk := source.read(COPY_CHUNK_SIZE):
                            size += len(chunk)
                            total += len(chunk)
                            if size > MAX_FILE or total > MAX_PACKAGE:
                                raise ThemePackageError("主题文件夹超过 10 GiB")
                            output.write(chunk)
                if not count:
                    raise ThemePackageError("主题文件夹不包含文件")
                if len(roots) > 1 or (roots and flat):
                    raise ThemePackageError("上传文件必须来自同一个主题文件夹")
                manifest, theme, _ = _read_folder(staging, enforce_folder_name=False)
                if roots and next(iter(roots)) != manifest["id"]:
                    raise ThemePackageError("主题清单 ID 与文件夹名称不一致")
                return self._publish(theme, staging)
            except BaseException:
                self._discard_staging(staging)
                raise

    def _install(self, theme: Theme, files: dict[str, bytes]) -> dict:
        with self._lock:
            _regular_path(self.root, directory=True, missing=True)
            self.root.mkdir(parents=True, exist_ok=True)
            _regular_path(self.root, directory=True)
            temporary = Path(tempfile.mkdtemp(prefix=".theme-", dir=self.root))
            try:
                for name, data in files.items():
                    path = temporary / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                _, installed_theme, _ = _read_folder(temporary, enforce_folder_name=False)
                if installed_theme.id != theme.id:
                    raise ThemePackageError("主题清单与 theme.json 的 ID 不一致")
                return self._publish(theme, temporary)
            except BaseException:
                self._discard_staging(temporary)
                raise

    def _publish(self, theme: Theme, staging: Path) -> dict:
        from .backups.ui_data import wallpaper_container

        if any(item.id == theme.id for item in self.ctx.registry.all("theme")):
            raise ThemePackageError(f"主题 ID 已被占用：{theme.id}")
        _regular_path(self.root, directory=True)
        target = self.root / theme.id
        retained = _regular_path(target, directory=True, missing=True)
        if retained and not wallpaper_container(target):
            raise ThemePackageError(f"主题文件夹已存在：{theme.id}")
        _folder_files(staging)
        _regular_path(self.root, directory=True)
        if _regular_path(target, directory=True, missing=True) and not (
            retained and wallpaper_container(target)
        ):
            raise ThemePackageError(f"主题文件夹已存在：{theme.id}")
        # A legacy private-only container survives uninstall. Publish only package
        # entries into it; never move, overwrite or delete the retained media.
        moved: list[str] = []
        if retained:
            try:
                for path in staging.iterdir():
                    path.replace(target / path.name)
                    moved.append(path.name)
            except BaseException:
                for name in reversed(moved):
                    (target / name).replace(staging / name)
                raise
        else:
            staging.replace(target)
        try:
            self.ctx.registry.register(
                "theme", theme.id, theme, source="theme-package", title=theme.name
            )
        except BaseException:
            if retained:
                for name in reversed(moved):
                    (target / name).replace(staging / name)
            else:
                self._discard_staging(target)
            raise
        if retained:
            staging.rmdir()
        self._installed[theme.id] = target
        return to_json(theme, "theme-package")

    def _discard_staging(self, folder: Path) -> None:
        try:
            _regular_path(self.root, directory=True)
            if folder.absolute().parent == self.root.absolute() and folder.exists():
                _folder_files(folder)
                shutil.rmtree(folder, ignore_errors=True)
        except (OSError, ThemePackageError):
            log.warning("theme rollback left an unsafe path untouched: %s", folder)

    def remove(self, theme_id: str, *, delete_data: bool = False) -> None:
        from .backups.extension_data import validate_tree
        from .private_store import PrivateStore

        with self.ctx.engine.hold_operation(), self._lock:
            folder = self._installed.get(theme_id)
            if folder is None:
                raise ThemePackageError("只能删除用户安装的独立主题包")
            _regular_path(self.root, directory=True)
            if folder.absolute().parent != self.root.absolute():
                raise ThemePackageError("主题路径无效，未删除")
            if not _regular_path(folder, directory=True, missing=True):
                self._installed.pop(theme_id, None)
                raise ThemePackageError("主题文件夹不存在")
            _folder_entries(folder)
            private_data = tuple(
                dict.fromkeys(PrivateStore(self.ctx.data_dir, "theme", theme_id).sources())
            )
            if delete_data:
                for path in private_data:
                    validate_tree(path)
            for path in folder.iterdir():
                if path.name == USER_WALLPAPERS:
                    continue
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            if delete_data:
                for path in private_data:
                    if path.exists():
                        shutil.rmtree(path)
            if not any(folder.iterdir()):
                folder.rmdir()
            self._installed.pop(theme_id, None)
            self.ctx.registry.unregister("theme", theme_id)
