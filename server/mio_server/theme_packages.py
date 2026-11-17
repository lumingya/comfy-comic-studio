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

from .themes import Theme, parse_theme, resolved, to_json

log = logging.getLogger("mio.themes")

MANIFEST = "mio-theme.json"
THEME_FILE = "theme.json"
README = "README.md"
PACKAGE_FILES = {MANIFEST, THEME_FILE, README}
MAX_PACKAGE = 5 * 1024 * 1024
MAX_FILE = 2 * 1024 * 1024
MAX_FILES = 3
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


def _folder_entries(folder: Path) -> list[Path]:
    _regular_path(folder, directory=True)
    files = list(folder.iterdir())
    for child in files:
        if child.name not in PACKAGE_FILES:
            raise ThemePackageError("主题文件夹包含不支持的文件")
        _regular_path(child, directory=False)
    return files


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


def _validated_files(files: dict[str, bytes]) -> tuple[dict, Theme]:
    if set(files) not in ({MANIFEST, THEME_FILE}, PACKAGE_FILES):
        raise ThemePackageError("主题包必须只包含清单、theme.json 和可选 README.md")
    if len(files) > MAX_FILES or sum(map(len, files.values())) > MAX_PACKAGE:
        raise ThemePackageError("主题包超过大小限制")
    if any(len(data) > MAX_FILE for data in files.values()):
        raise ThemePackageError("主题文件超过 2 MB")
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
    if README in files:
        try:
            files[README].decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ThemePackageError("README.md 不是有效 UTF-8") from exc
    return manifest, theme


def _read_folder(folder: Path) -> tuple[dict, Theme, dict[str, bytes]]:
    files: dict[str, bytes] = {}
    for child in _folder_entries(folder):
        if child.stat().st_size > MAX_FILE:
            raise ThemePackageError("主题文件超过 2 MB")
        files[child.name] = child.read_bytes()
    manifest, theme = _validated_files(files)
    if folder.name != manifest["id"]:
        raise ThemePackageError("主题清单 ID 与文件夹名称不一致")
    return manifest, theme, files


def _unpack(data: bytes) -> tuple[dict, Theme, dict[str, bytes]]:
    if not data or len(data) > MAX_PACKAGE:
        raise ThemePackageError("主题 ZIP 为空或超过 5 MB")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_FILES + 1:
                raise ThemePackageError("主题 ZIP 文件过多")
            names: list[tuple[zipfile.ZipInfo, tuple[str, ...]]] = []
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
                    continue
                if info.file_size > MAX_FILE:
                    raise ThemePackageError("主题文件超过 2 MB")
                key = "/".join(parts).casefold()
                if key in seen:
                    raise ThemePackageError("主题 ZIP 包含重复文件")
                seen.add(key)
                names.append((info, parts))
            if not names:
                raise ThemePackageError("主题 ZIP 不包含文件")
            roots = {parts[0] for _, parts in names}
            has_folder = len(roots) == 1 and all(len(parts) == 2 for _, parts in names)
            files: dict[str, bytes] = {}
            for info, parts in names:
                relative = parts[1:] if has_folder else parts
                if len(relative) != 1 or relative[0] not in PACKAGE_FILES:
                    raise ThemePackageError("主题 ZIP 包含不支持的路径或文件")
                files[relative[0]] = archive.read(info)
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise ThemePackageError("无法读取主题 ZIP") from exc
    manifest, theme = _validated_files(files)
    if has_folder and next(iter(roots)) != manifest["id"]:
        raise ThemePackageError("主题清单 ID 与 ZIP 文件夹名称不一致")
    return manifest, theme, files


def package_theme(theme: Theme) -> tuple[str, bytes]:
    """Return a data-only copy, with an identity based on its palette and metadata."""
    document = {
        "name": theme.name,
        "mode": theme.mode,
        "author": theme.author,
        "tokens": resolved(theme),
    }
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    package_id = "theme-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
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
        "这是独立主题包，只包含经过校验的界面令牌，不包含扩展代码。"
        "可在「设置 → 外观与阅读」导入 ZIP，然后选择主题。\n"
    )
    files = {
        MANIFEST: json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        THEME_FILE: json.dumps({"id": package_id, **document}, ensure_ascii=False, indent=2) + "\n",
        README: readme,
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(f"{package_id}/{name}", content.encode("utf-8"))
    return package_id, output.getvalue()


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
        _, theme, files = _unpack(data)
        return self._install(theme, files)

    def install_folder(self, files: list[tuple[str, bytes]]) -> dict:
        normalized: dict[str, bytes] = {}
        roots: set[str] = set()
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
            if len(path.parts) == 2:
                roots.add(path.parts[0])
                name = path.parts[1]
            elif len(path.parts) == 1:
                flat = True
            else:
                raise ThemePackageError("请选择直接包含 mio-theme.json 的主题文件夹")
            if name not in PACKAGE_FILES or name in normalized:
                raise ThemePackageError("主题文件夹包含重复或不支持的文件")
            if not isinstance(data, bytes):
                raise ThemePackageError("主题文件读取失败")
            normalized[name] = data
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
