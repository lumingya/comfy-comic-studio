"""Independent, data-only theme packages."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
import shutil
import stat
import tempfile
import threading
import zipfile
from pathlib import Path, PurePosixPath

from .theme_media import (
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
MAX_PACKAGE = 128 * 1024 * 1024
MAX_FILE = 100 * 1024 * 1024
MAX_METADATA = 2 * 1024 * 1024
MAX_SCRIPT = 1024 * 1024
MAX_FILES = 64
BUILTIN_ROOT = Path(__file__).resolve().parents[2] / "themes"
RESERVED_IDS = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}


class ThemePackageError(ValueError):
    pass


def _regular_path(path: Path, *, directory: bool, missing: bool = False) -> bool:
    """Check without following Windows junctions, symbolic links or special files."""
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        if missing:
            if path.resolve() != path.absolute():
                raise ThemePackageError("主题路径不能包含链接或重解析点") from None
            return False
        raise ThemePackageError("主题路径不存在") from None
    if (
        stat.S_ISLNK(metadata.st_mode)
        or getattr(metadata, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        or not (stat.S_ISDIR(metadata.st_mode) if directory else stat.S_ISREG(metadata.st_mode))
        or path.resolve() != path.absolute()
    ):
        raise ThemePackageError("主题路径不能包含链接、重解析点或特殊文件")
    return True


def allowed_package_path(name: str) -> bool:
    return name in PACKAGE_FILES or asset_parts(name) is not None


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
    files: dict[str, bytes], *, file_names: set[str] | None = None
) -> tuple[dict, Theme]:
    names = set(files) if file_names is None else file_names
    if not {MANIFEST, THEME_FILE} <= names or any(not allowed_package_path(name) for name in names):
        raise ThemePackageError("主题包必须只包含清单、theme.json、说明及已声明资源")
    if len(names) > MAX_FILES or sum(map(len, files.values())) > MAX_PACKAGE:
        raise ThemePackageError("主题包解压后超过 128 MB 或文件过多")
    if any(len(data) > MAX_FILE for data in files.values()):
        raise ThemePackageError("单个主题文件超过 100 MB")
    if any(
        len(files[name]) > MAX_METADATA
        for name in (MANIFEST, THEME_FILE, README, STYLE)
        if name in files
    ):
        raise ThemePackageError("主题清单或说明超过 2 MB")
    if len(files.get(SCRIPT, b"")) > MAX_SCRIPT:
        raise ThemePackageError("主题脚本超过 1 MB")
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
        name for name in (theme.script_file, theme.style_file) if name
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
    for name, data in files.items():
        if asset_parts(name) and not valid_media(name, data):
            raise ThemePackageError(f"主题资源内容与文件格式不匹配或文件已损坏：{name}")
    if theme.background and theme.background.file not in names:
        raise ThemePackageError("主题声明的背景资源不存在")
    return manifest, theme


def _read_folder(
    folder: Path, *, read_resources: bool = True
) -> tuple[dict, Theme, dict[str, bytes]]:
    paths = _folder_files(folder)
    sizes = {name: path.stat().st_size for name, path in paths}
    if sum(sizes.values()) > MAX_PACKAGE or any(size > MAX_FILE for size in sizes.values()):
        raise ThemePackageError("主题包解压后超过 128 MB")
    files = {}
    for name, path in paths:
        if not read_resources and asset_parts(name):
            with path.open("rb") as source:
                files[name] = source.read(64 * 1024 if name.lower().endswith(".png") else 12)
        else:
            files[name] = path.read_bytes()
    manifest, theme = _validated_files(files, file_names=set(sizes))
    if folder.name != manifest["id"]:
        raise ThemePackageError("主题清单 ID 与文件夹名称不一致")
    return manifest, theme, files


def _unpack(data: bytes) -> tuple[dict, Theme, dict[str, bytes]]:
    if not data or len(data) > MAX_PACKAGE:
        raise ThemePackageError("主题 ZIP 为空或超过 128 MB")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_FILES + 3:
                raise ThemePackageError("主题 ZIP 文件过多")
            names: list[tuple[zipfile.ZipInfo, tuple[str, ...]]] = []
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
                if stat.S_ISLNK(mode) or (kind and not info.is_dir() and not stat.S_ISREG(mode)):
                    raise ThemePackageError("主题 ZIP 不支持链接或特殊文件")
                if info.is_dir():
                    directories.add("/".join(parts))
                    continue
                if info.file_size > MAX_FILE:
                    raise ThemePackageError("单个主题文件超过 100 MB")
                key = "/".join(parts).casefold()
                if key in seen:
                    raise ThemePackageError("主题 ZIP 包含重复文件")
                seen.add(key)
                names.append((info, parts))
            if not names:
                raise ThemePackageError("主题 ZIP 不包含文件")
            if sum(info.file_size for info, _ in names) > MAX_PACKAGE:
                raise ThemePackageError("主题包解压后超过 128 MB")
            roots = {parts[0] for _, parts in names}
            has_folder = len(roots) == 1 and all(
                len(parts) >= 2
                and allowed_package_path("/".join(parts[1:]))
                and parts[0] not in PACKAGE_FILES
                and parts[0] != "assets"
                for _, parts in names
            )
            root = next(iter(roots)) if has_folder else ""
            files: dict[str, bytes] = {}
            for info, parts in names:
                relative = parts[1:] if has_folder else parts
                normalized = "/".join(relative)
                if not allowed_package_path(normalized):
                    raise ThemePackageError("主题 ZIP 包含不支持的路径或文件")
                files[normalized] = archive.read(info)
            expected_directories = set()
            for name in files:
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
            if normalized_directories - allowed_directories:
                raise ThemePackageError("主题 ZIP 包含不支持的目录")
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise ThemePackageError("无法读取主题 ZIP") from exc
    manifest, theme = _validated_files(files)
    if has_folder and next(iter(roots)) != manifest["id"]:
        raise ThemePackageError("主题清单 ID 与 ZIP 文件夹名称不一致")
    return manifest, theme, files


def package_theme(theme: Theme, resources: dict[str, bytes] | None = None) -> tuple[str, bytes]:
    """Package validated theme data and referenced assets without executing its script."""
    resources = resources or {}
    document = theme.model_dump(mode="json", exclude={"created_at"})
    document["tokens"] = resolved(theme)
    document.pop("id", None)
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    resource_ids = {
        name: hashlib.sha256(data).hexdigest() for name, data in sorted(resources.items())
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
    files.update(resources)
    _validated_files(
        {
            name: content if isinstance(content, bytes) else content.encode("utf-8")
            for name, content in files.items()
        }
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(
                f"{package_id}/{name}",
                content if isinstance(content, bytes) else content.encode("utf-8"),
                compress_type=zipfile.ZIP_STORED
                if name.startswith("assets/")
                else zipfile.ZIP_DEFLATED,
            )
    payload = output.getvalue()
    if len(payload) > MAX_PACKAGE:
        raise ThemePackageError("主题 ZIP 超过 128 MB")
    return package_id, payload


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
                    manifest, theme, _ = _read_folder(folder, read_resources=False)
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
        _, theme, files = _unpack(data)
        return self._install(theme, files)

    def install_folder(self, files: list[tuple[str, bytes]]) -> dict:
        normalized: dict[str, bytes] = {}
        roots: set[str] = set()
        seen: set[str] = set()
        flat = False
        for raw_name, data in files:
            name = raw_name.replace("\\", "/")
            raw_parts = name.split("/")
            path = PurePosixPath(name)
            if (
                not name
                or ":" in name
                or path.is_absolute()
                or any(p in {"", ".", ".."} for p in raw_parts)
            ):
                raise ThemePackageError("主题文件夹包含不安全路径")
            parts = path.parts
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
            if not isinstance(data, bytes):
                raise ThemePackageError("主题文件读取失败")
            normalized[name] = data
            seen.add(key)
            if len(normalized) > MAX_FILES or sum(map(len, normalized.values())) > MAX_PACKAGE:
                raise ThemePackageError("主题文件夹超过 128 MB 或文件过多")
        if len(roots) > 1 or (roots and flat):
            raise ThemePackageError("上传文件必须来自同一个主题文件夹")
        _, theme = _validated_files(normalized)
        if roots and next(iter(roots)) != theme.id:
            raise ThemePackageError("主题清单 ID 与文件夹名称不一致")
        return self._install(theme, normalized)

    def _install(self, theme: Theme, files: dict[str, bytes]) -> dict:
        with self._lock:
            if any(item.id == theme.id for item in self.ctx.registry.all("theme")):
                raise ThemePackageError(f"主题 ID 已被占用：{theme.id}")
            _regular_path(self.root, directory=True, missing=True)
            self.root.mkdir(parents=True, exist_ok=True)
            _regular_path(self.root, directory=True)
            target = self.root / theme.id
            if _regular_path(target, directory=True, missing=True):
                raise ThemePackageError(f"主题文件夹已存在：{theme.id}")
            temporary = Path(tempfile.mkdtemp(prefix=".theme-", dir=self.root))
            installed = False
            try:
                for name, data in files.items():
                    path = temporary / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with path.open("xb") as output:
                        output.write(data)
                        output.flush()
                        os.fsync(output.fileno())
                _regular_path(self.root, directory=True)
                _folder_entries(temporary)
                if _regular_path(target, directory=True, missing=True):
                    raise ThemePackageError(f"主题文件夹已存在：{theme.id}")
                temporary.replace(target)
                installed = True
                self.ctx.registry.register(
                    "theme", theme.id, theme, source="theme-package", title=theme.name
                )
                self._installed[theme.id] = target
            except BaseException:
                # A changed root or a replacement link must never turn rollback into an
                # external recursive delete. Leave suspicious files for manual recovery.
                try:
                    _regular_path(self.root, directory=True)
                    leftover = target if installed else temporary
                    if leftover.exists():
                        _folder_entries(leftover)
                        shutil.rmtree(leftover, ignore_errors=True)
                except (OSError, ThemePackageError):
                    log.warning("theme rollback left an unsafe path untouched: %s", theme.id)
                raise
            return to_json(theme, "theme-package")

    def remove(self, theme_id: str) -> None:
        with self._lock:
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
            shutil.rmtree(folder)
            self._installed.pop(theme_id, None)
            self.ctx.registry.unregister("theme", theme_id)
