"""Discover, install, enable and load extensions from ``<data>/extensions/``.

Safety model:

* Nothing runs or registers until the user enables it, and enabling pins the folder digest.  A
  changed file ⇒ status ``changed`` ⇒ not loaded until enabled again (the user re-reviews).
* ``MIO_SAFE_MODE=1`` skips loading every extension (recovery from a broken one).
* A failing ``activate`` is contained: its contributions are rolled back and the status is
  ``error`` with the message.
"""

from __future__ import annotations

import importlib.util
import io
import json
import logging
import os
import shutil
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from pydantic import ValidationError

from .manifest import MANIFEST, Manifest, ManifestError, digest, inside, read_manifest
from .sdk import ExtensionAPI

log = logging.getLogger("mio.extensions")

MAX_ZIP = 50 * 1024 * 1024
MAX_ENTRIES = 2000


class ExtensionError(ValueError):
    pass


@dataclass
class Loaded:
    api: ExtensionAPI
    module: object | None = None


@dataclass
class Info:
    id: str
    folder: Path
    manifest: Manifest | None
    digest: str
    status: str  # disabled | active | changed | error | invalid
    error: str = ""
    restart_required: bool = False
    contributions: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        m = self.manifest
        return {
            "id": self.id,
            "name": m.name if m else self.id,
            "version": m.version if m else "",
            "description": m.description if m else "",
            "author": m.author if m else "",
            "homepage": m.homepage if m else "",
            "runs_code": bool(m and m.runs_code),
            "has_python": bool(m and m.main),
            "panels": [p.model_dump() for p in m.contributes.panels] if m else [],
            "digest": self.digest,
            "status": self.status,
            "error": self.error,
            "restart_required": self.restart_required,
            "contributions": self.contributions,
        }


class ExtensionManager:
    def __init__(self, ctx, root: Path | None = None):
        self.ctx = ctx
        self.root = Path(root or ctx.data_dir / "extensions")
        self.loaded: dict[str, Loaded] = {}
        self.errors: dict[str, str] = {}
        self.mounted: set[str] = set()  # extensions whose router is part of the running app

    # ------------------------------------------------------------ discovery
    def _state(self, ext_id: str):
        return self.ctx.settings().extensions.get(ext_id)

    def info(self, ext_id: str) -> Info:
        folder = self.root / ext_id
        if not (folder / MANIFEST).is_file():
            raise ExtensionError(f"扩展不存在：{ext_id}")
        try:
            manifest = read_manifest(folder)
            if manifest.id != ext_id:
                raise ManifestError(f"清单 id（{manifest.id}）与目录名（{ext_id}）不一致")
        except ManifestError as exc:
            return Info(ext_id, folder, None, "", "invalid", str(exc))
        current = digest(folder)
        state = self._state(ext_id)
        if ext_id in self.loaded:
            status = "active"
        elif ext_id in self.errors:
            status = "error"
        elif state and state.enabled and state.digest != current:
            status = "changed"
        else:
            status = "disabled"
        loaded = self.loaded.get(ext_id)
        contributions = []
        if loaded:
            desc = self.ctx.registry.describe()
            source = loaded.api.source
            contributions = [
                f"{point}:{item['id']}"
                for point, items in desc.items()
                for item in items
                if item["source"] == source
            ]
        restart = bool(loaded and loaded.api._router is not None and ext_id not in self.mounted)
        return Info(
            ext_id,
            folder,
            manifest,
            current,
            status,
            self.errors.get(ext_id, ""),
            restart,
            contributions,
        )

    def list(self) -> list[Info]:
        if not self.root.is_dir():
            return []
        return [
            self.info(p.name)
            for p in sorted(self.root.iterdir())
            if p.is_dir() and (p / MANIFEST).is_file()
        ]

    # --------------------------------------------------------------- state
    def _save_state(self, ext_id: str, enabled: bool, pinned: str) -> None:
        from ..models import now_iso
        from ..settings import ExtensionState

        settings = self.ctx.settings()
        settings.extensions[ext_id] = ExtensionState(enabled=enabled, digest=pinned)
        settings.updated_at = now_iso()
        self.ctx.store.put_doc(settings)

    def enable(self, ext_id: str, expected_digest: str) -> Info:
        """Enable exactly the reviewed content: ``expected_digest`` must match the folder."""
        info = self.info(ext_id)
        if info.status == "invalid":
            raise ExtensionError(info.error)
        if expected_digest != info.digest:
            raise ExtensionError("扩展内容与确认时不一致，请刷新后重新确认")
        self.unload(ext_id)
        self._save_state(ext_id, True, info.digest)
        self.load(ext_id)
        return self.info(ext_id)

    def disable(self, ext_id: str) -> Info:
        self.info(ext_id)  # existence check
        self.unload(ext_id)
        self._save_state(ext_id, False, "")
        self.errors.pop(ext_id, None)
        return self.info(ext_id)

    def remove(self, ext_id: str) -> None:
        self.disable(ext_id)
        shutil.rmtree(self.root / ext_id)
        settings = self.ctx.settings()
        settings.extensions.pop(ext_id, None)
        self.ctx.store.put_doc(settings)

    # ------------------------------------------------------------- loading
    def load_all(self) -> None:
        if os.environ.get("MIO_SAFE_MODE") == "1":
            log.warning("MIO_SAFE_MODE=1: extensions are not loaded")
            return
        for ext_id, state in self.ctx.settings().extensions.items():
            if state.enabled and (self.root / ext_id / MANIFEST).is_file():
                self.load(ext_id)

    def load(self, ext_id: str) -> bool:
        info = self.info(ext_id)
        state = self._state(ext_id)
        if not (state and state.enabled) or info.manifest is None or state.digest != info.digest:
            return False
        api = ExtensionAPI(ext_id, info.folder, self.ctx)
        self.errors.pop(ext_id, None)
        try:
            self._declarative(api, info.manifest)
            module = self._run_main(api, info.manifest) if info.manifest.main else None
        except Exception as exc:  # contain every failure: roll back what was registered
            self.ctx.registry.unregister_source(api.source)
            self.errors[ext_id] = f"{type(exc).__name__}: {exc}"
            log.exception("extension %s failed to load", ext_id)
            return False
        self.loaded[ext_id] = Loaded(api, module)
        return True

    def unload(self, ext_id: str) -> None:
        loaded = self.loaded.pop(ext_id, None)
        if not loaded:
            return
        deactivate = getattr(loaded.module, "deactivate", None)
        if callable(deactivate):
            try:
                deactivate()
            except Exception:
                log.exception("extension %s deactivate failed", ext_id)
        self.ctx.registry.unregister_source(loaded.api.source)
        sys.modules.pop(f"mio_ext_{ext_id}", None)

    def _declarative(self, api: ExtensionAPI, manifest: Manifest) -> None:
        from ..album.templates import parse_template
        from ..models import LetterStyle
        from ..pipeline.export import SlicePreset
        from ..themes import parse_theme

        c = manifest.contributes
        for rel in c.themes:
            theme = parse_theme(_json(inside(api.folder, rel)))
            api.contribute("theme", theme.id, theme, title=theme.name)
        for rel in c.album_templates:
            tpl = parse_template(_json(inside(api.folder, rel)))
            api.contribute("album_template", tpl.id, tpl, title=tpl.title)
        for name, style in c.sfx_presets.items():
            try:
                value = LetterStyle.model_validate({**style, "preset": name})
            except ValidationError as exc:
                raise ExtensionError(f"拟声字预设 {name}：{exc.errors()[0]['msg']}") from None
            api.contribute("sfx_preset", name, value, title=name)
        for spec in c.slice_presets:
            preset = SlicePreset(**spec.model_dump())
            api.contribute("slice_preset", spec.id, preset, title=spec.label)

    def _run_main(self, api: ExtensionAPI, manifest: Manifest):
        path = inside(api.folder, manifest.main or "")
        name = f"mio_ext_{api.id}"
        package = path.name == "__init__.py"
        spec = importlib.util.spec_from_file_location(
            name, path, submodule_search_locations=[str(path.parent)] if package else None
        )
        if spec is None or spec.loader is None:
            raise ExtensionError(f"无法加载 {manifest.main}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
            activate = getattr(module, "activate", None)
            if not callable(activate):
                raise ExtensionError(f"{manifest.main} 缺少 activate(mio) 函数")
            activate(api)
        except BaseException:
            sys.modules.pop(name, None)
            raise
        return module

    def routers(self):
        """``(ext_id, router)`` of loaded extensions that declared routes (mounted at start-up)."""
        for ext_id, loaded in self.loaded.items():
            if loaded.api._router is not None:
                yield ext_id, loaded.api._router

    # ------------------------------------------------------------- install
    def install(self, data: bytes, replace: bool = False) -> Info:
        """Install a zipped extension (manifest at the root or in one top-level folder)."""
        if len(data) > MAX_ZIP:
            raise ExtensionError("扩展包超过 50 MB")
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise ExtensionError("不是合法的 zip 文件") from None
        names = [n for n in zf.namelist() if not n.endswith("/")]
        if len(names) > MAX_ENTRIES:
            raise ExtensionError("扩展包文件过多")
        prefix = _common_prefix(names)
        if prefix + MANIFEST not in names:
            raise ExtensionError(f"扩展包里没有 {MANIFEST}")
        try:
            manifest = Manifest.model_validate(json.loads(zf.read(prefix + MANIFEST)))
        except (ValueError, ValidationError) as exc:
            raise ExtensionError(f"{MANIFEST} 不合法：{exc}") from None
        target = self.root / manifest.id
        if target.exists() and not replace:
            raise ExtensionError(f"扩展 {manifest.id} 已存在")
        total = sum(zf.getinfo(n).file_size for n in names)
        if total > 4 * MAX_ZIP:
            raise ExtensionError("扩展包解压后过大")
        staging = self.root / f".staging-{manifest.id}"
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        try:
            for n in names:
                rel = n[len(prefix) :]
                parts = PurePosixPath(rel).parts
                if not rel or rel.startswith("/") or ".." in parts or ":" in rel:
                    raise ExtensionError(f"不安全的路径：{n}")
                dest = staging / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(zf.read(n))
            read_manifest(staging)
        except (ExtensionError, ManifestError):
            shutil.rmtree(staging, ignore_errors=True)
            raise
        if target.exists():
            self.unload(manifest.id)
            shutil.rmtree(target)
        staging.rename(target)
        return self.info(manifest.id)


def _json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ExtensionError(f"读取 {path.name} 失败：{exc}") from None


def _common_prefix(names: list[str]) -> str:
    tops = {n.split("/", 1)[0] for n in names}
    if len(tops) == 1 and all("/" in n for n in names):
        return next(iter(tops)) + "/"
    return ""
