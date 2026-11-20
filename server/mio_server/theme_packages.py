"""Theme package lifecycle and stable imports for package consumers.

Validation, archive I/O and portable export live in focused internal modules.
This module owns registration, atomic publication, rollback and removal.
"""

from __future__ import annotations

import io
import logging
import shutil
import tempfile
import threading
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterable

from . import theme_package_validation as validation
from .theme_package_archive import _extract_zip_to_folder as _extract_zip_to_folder
from .theme_package_archive import _unpack as _unpack
from .theme_package_export import _rebase_card_stylesheet as _rebase_card_stylesheet
from .theme_package_export import _resource_identity as _resource_identity
from .theme_package_export import package_theme as package_theme
from .theme_package_export import package_theme_to_file as package_theme_to_file
from .theme_package_validation import (
    COPY_CHUNK_SIZE as COPY_CHUNK_SIZE,
)
from .theme_package_validation import (
    MANIFEST as MANIFEST,
)
from .theme_package_validation import (
    MAX_FILE as MAX_FILE,
)
from .theme_package_validation import (
    MAX_FILES as MAX_FILES,
)
from .theme_package_validation import (
    MAX_METADATA as MAX_METADATA,
)
from .theme_package_validation import (
    MAX_PACKAGE as MAX_PACKAGE,
)
from .theme_package_validation import (
    MAX_SCRIPT as MAX_SCRIPT,
)
from .theme_package_validation import (
    MAX_SETTINGS_PAGE as MAX_SETTINGS_PAGE,
)
from .theme_package_validation import (
    PACKAGE_FILES as PACKAGE_FILES,
)
from .theme_package_validation import (
    README as README,
)
from .theme_package_validation import (
    RESERVED_IDS as RESERVED_IDS,
)
from .theme_package_validation import (
    SCRIPT as SCRIPT,
)
from .theme_package_validation import (
    SETTINGS_PAGE_NAME as SETTINGS_PAGE_NAME,
)
from .theme_package_validation import (
    STYLE as STYLE,
)
from .theme_package_validation import (
    THEME_FILE as THEME_FILE,
)
from .theme_package_validation import (
    USER_WALLPAPERS as USER_WALLPAPERS,
)
from .theme_package_validation import (
    ThemePackageError as ThemePackageError,
)
from .theme_package_validation import (
    _folder_entries as _folder_entries,
)
from .theme_package_validation import (
    _folder_files as _folder_files,
)
from .theme_package_validation import (
    _is_user_wallpapers_path as _is_user_wallpapers_path,
)
from .theme_package_validation import (
    _read_folder as _read_folder,
)
from .theme_package_validation import (
    _regular_path as _regular_path,
)
from .theme_package_validation import (
    _validate_file_sizes as _validate_file_sizes,
)
from .theme_package_validation import (
    _validate_manifest as _validate_manifest,
)
from .theme_package_validation import (
    _validated_files as _validated_files,
)
from .theme_package_validation import (
    allowed_package_path as allowed_package_path,
)
from .themes import Theme, to_json

log = logging.getLogger("mio.themes")
BUILTIN_ROOT = Path(__file__).resolve().parents[2] / "themes"


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
        if not data or len(data) > validation.MAX_PACKAGE:
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
                if len(uploads) >= validation.MAX_FILES:
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
                    if count > validation.MAX_FILES:
                        raise ThemePackageError("主题文件过多")
                    seen.add(key)
                    target = staging / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    size = 0
                    with target.open("xb") as output:
                        while chunk := source.read(validation.COPY_CHUNK_SIZE):
                            size += len(chunk)
                            total += len(chunk)
                            if size > validation.MAX_FILE or total > validation.MAX_PACKAGE:
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
