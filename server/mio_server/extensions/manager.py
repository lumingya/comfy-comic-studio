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
from functools import wraps
from pathlib import Path, PurePosixPath

from pydantic import ValidationError

from ..hooks import HOOKS
from ..jobs.operations import operation_serialized
from ..jobs.types import JobConflict
from .manifest import MANIFEST, Manifest, ManifestError, digest, inside, read_manifest
from .sdk import ExtensionAPI

log = logging.getLogger("mio.extensions")

MAX_ZIP = 50 * 1024 * 1024
MAX_ENTRIES = 2000
BUILTIN_ROOT = Path(__file__).resolve().parents[3] / "extensions"


class ExtensionError(ValueError):
    pass


def catalog_transition(fn):
    """Publish a whole lifecycle change, without holding a lock while extension code runs.

    Lifecycle callers already hold the engine operation lock. The registry lock only makes
    this marker atomic with HTTP wrapper snapshots; requests reject an incomplete catalog.
    """

    @wraps(fn)
    def changing(self, *args, **kwargs):
        with self.ctx.registry._lock:
            self._catalog_transitions += 1
        try:
            return fn(self, *args, **kwargs)
        finally:
            with self.ctx.registry._lock:
                self._catalog_transitions -= 1

    return changing


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
    builtin: bool = False

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
            "builtin": self.builtin,
        }


class ExtensionManager:
    def __init__(self, ctx, root: Path | None = None):
        self.ctx = ctx
        self.engine = ctx.engine
        self.root = Path(root or ctx.data_dir / "extensions")
        self.loaded: dict[str, Loaded] = {}
        self.errors: dict[str, str] = {}
        self.mounted: set[str] = set()  # extensions whose router is part of the running app
        self._catalog_transitions = 0
        self.apps = []

    def operation_layers(self, operation: str):
        """Capture only committed wrappers, or fail fast while activation is incomplete."""
        with self.ctx.registry._lock:
            if self._catalog_transitions:
                raise JobConflict("extension catalog is changing; retry after activation finishes")
            return self.ctx.registry.layers("operation", operation)

    # ------------------------------------------------------------ discovery
    def _state(self, ext_id: str):
        return self.ctx.settings().extensions.get(ext_id)

    def info(self, ext_id: str) -> Info:
        builtin = not (self.root / ext_id / MANIFEST).is_file()
        folder = (BUILTIN_ROOT if builtin else self.root) / ext_id
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
        restart = False
        return Info(
            ext_id,
            folder,
            manifest,
            current,
            status,
            self.errors.get(ext_id, ""),
            restart,
            contributions,
            builtin,
        )

    def list(self) -> list[Info]:
        identifiers = {
            p.name
            for root in (BUILTIN_ROOT, self.root)
            if root.is_dir()
            for p in root.iterdir()
            if p.is_dir() and (p / MANIFEST).is_file()
        }
        return [self.info(identifier) for identifier in sorted(identifiers)]

    # --------------------------------------------------------------- state
    def _save_state(self, ext_id: str, enabled: bool, pinned: str) -> None:
        from ..models import now_iso
        from ..settings import ExtensionState

        settings = self.ctx.settings()
        settings.extensions[ext_id] = ExtensionState(enabled=enabled, digest=pinned)
        settings.updated_at = now_iso()
        self.ctx.store.put_doc(settings)

    @operation_serialized
    @catalog_transition
    def enable(self, ext_id: str, expected_digest: str) -> Info:
        """Enable exactly the reviewed content: ``expected_digest`` must match the folder."""
        info = self.info(ext_id)
        if info.status == "invalid":
            raise ExtensionError(info.error)
        if expected_digest != info.digest:
            raise ExtensionError("扩展内容与确认时不一致，请刷新后重新确认")
        if ext_id in self.loaded:
            self.engine.ensure_executor_source_idle(f"ext:{ext_id}")
        previous = self._state(ext_id)
        self._save_state(ext_id, True, info.digest)
        try:
            success = self.load(ext_id)
        except Exception:
            self._restore_state(ext_id, previous)
            raise
        if not success:
            self._restore_state(ext_id, previous)
        else:
            from .trust import remember_package

            remember_package(self.ctx.data_dir, info.folder, info.digest)
        return self.info(ext_id)

    def _restore_state(self, ext_id, previous):
        """An activation error must not change the previous reviewed state."""
        settings = self.ctx.settings()
        if previous is None:
            settings.extensions.pop(ext_id, None)
        else:
            settings.extensions[ext_id] = previous
        self.ctx.store.put_doc(settings)

    @operation_serialized
    @catalog_transition
    def disable(self, ext_id: str) -> Info:
        self.info(ext_id)  # existence check
        self.unload(ext_id)
        self._save_state(ext_id, False, "")
        self.errors.pop(ext_id, None)
        return self.info(ext_id)

    @operation_serialized
    @catalog_transition
    def remove(self, ext_id: str) -> None:
        if self.info(ext_id).builtin:
            raise ExtensionError("内置扩展可以关闭，不能卸载")
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
            if (
                state.enabled
                and not (self.root / ext_id / MANIFEST).is_file()
                and (BUILTIN_ROOT / ext_id / MANIFEST).is_file()
            ):
                self._save_state(ext_id, True, self.info(ext_id).digest)
                self.load(ext_id)
            elif state.enabled and (self.root / ext_id / MANIFEST).is_file():
                self.load(ext_id)

    @operation_serialized
    @catalog_transition
    def load(self, ext_id: str) -> bool:
        previous_service = self.ctx.extension_services.get(ext_id)
        if previous_service is not None and getattr(previous_service, "busy", False):
            raise JobConflict("扩展的上次请求尚未结束，请稍后再启用")
        info = self.info(ext_id)
        state = self._state(ext_id)
        if not (state and state.enabled) or info.manifest is None or state.digest != info.digest:
            return False
        source = f"ext:{ext_id}"
        previous = self.loaded.get(ext_id)
        if previous:
            self.engine.ensure_executor_source_idle(source)
        snapshot = self._snapshot_source(source)
        module_name = f"mio_ext_{ext_id}"
        previous_modules = {
            name: value
            for name, value in list(sys.modules.items())
            if name == module_name or name.startswith(module_name + ".")
        }
        for name in previous_modules:
            sys.modules.pop(name, None)
        api = ExtensionAPI(ext_id, info.folder, self.ctx, digest=info.digest)
        self.errors.pop(ext_id, None)
        loading = self.engine.catalog_loading
        self.engine.catalog_loading = True
        if previous:
            previous.api._enabled = False
        self.ctx.registry.unregister_source(source)
        try:
            # Also prevent stale package helper bytecode from defeating the reviewed digest.
            for cached in info.folder.rglob("*.pyc"):
                if "__pycache__" in cached.relative_to(info.folder).parts:
                    cached.unlink()
            self._declarative(api, info.manifest)
            module = self._run_main(api, info.manifest) if info.manifest.main else None
            if digest(info.folder) != info.digest:
                raise ExtensionError("extension files changed during activation")
        except Exception as exc:  # contain every failure: roll back what was registered
            api._enabled = False
            api.stop_services()
            self._restore_source(source, snapshot)
            if previous:
                previous.api._enabled = True
            if previous_service is not None:
                self.ctx.extension_services[ext_id] = previous_service
            for name in list(sys.modules):
                if name == module_name or name.startswith(module_name + "."):
                    sys.modules.pop(name, None)
            sys.modules.update(previous_modules)
            self.errors[ext_id] = f"{type(exc).__name__}: {exc}"
            log.exception("extension %s failed to load", ext_id)
            return False
        finally:
            self.engine.catalog_loading = loading
            self.engine.refresh_executor_jobs()
        if previous:
            self._deactivate(ext_id, previous)
        self.mounted.discard(ext_id)
        self.loaded[ext_id] = Loaded(api, module)
        self.refresh_routes()
        return True

    @operation_serialized
    @catalog_transition
    def unload(self, ext_id: str) -> None:
        self.engine.ensure_executor_source_idle(f"ext:{ext_id}")
        self.mounted.discard(ext_id)
        loaded = self.loaded.pop(ext_id, None)
        if not loaded:
            return
        loaded.api._enabled = False
        self._deactivate(ext_id, loaded)
        self.ctx.registry.unregister_source(loaded.api.source)
        self.refresh_routes()
        self.engine.refresh_executor_jobs()
        name = f"mio_ext_{ext_id}"
        for key in list(sys.modules):
            if key == name or key.startswith(name + "."):
                sys.modules.pop(key, None)

    @staticmethod
    def _deactivate(ext_id: str, loaded: Loaded) -> None:
        loaded.api.stop_services()
        deactivate = getattr(loaded.module, "deactivate", None)
        if callable(deactivate):
            try:
                deactivate()
            except Exception:
                log.exception("extension %s deactivate failed", ext_id)

    def _snapshot_source(self, source):
        """Preserve contribution objects and their original fallback order for rollback."""
        registry = self.ctx.registry
        with registry._lock:
            contributions = [
                (point, key, index, item)
                for point, items in registry._layers.items()
                for key, layers in items.items()
                for index, item in enumerate(layers)
                if item.source == source
            ]
        handlers = [
            (name, index, handler)
            for name in HOOKS
            for index, handler in enumerate(registry.hooks.handlers(name))
            if handler.source == source
        ]
        return contributions, handlers

    def _restore_source(self, source, snapshot):
        registry = self.ctx.registry
        registry.unregister_source(source)
        contributions, handlers = snapshot
        with registry._lock:
            for point, key, index, item in contributions:
                layers = registry._layers[point].setdefault(key, [])
                layers.insert(index, item)
                registry._items[point][key] = layers[-1]
        with registry.hooks._lock:
            for name, index, handler in handlers:
                registry.hooks._handlers.setdefault(name, []).insert(index, handler)
        registry.emit("registry.changed", {"source": source, "restored": True})

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
        spec = importlib.util.spec_from_file_location(
            name, path, submodule_search_locations=[str(path.parent)]
        )
        if spec is None or spec.loader is None:
            raise ExtensionError(f"无法加载 {manifest.main}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            # Timestamp-based bytecode caches may describe different reviewed bytes after a
            # same-second, same-length edit. Compile the entry point we actually hashed.
            exec(compile(path.read_bytes(), str(path), "exec"), module.__dict__)
            activate = getattr(module, "activate", None)
            if not callable(activate):
                raise ExtensionError(f"{manifest.main} 缺少 activate(mio) 函数")
            activate(api)
        except BaseException:
            sys.modules.pop(name, None)
            raise
        return module

    def routers(self):
        """``(ext_id, router)`` of loaded extensions with dynamically mounted routes."""
        for ext_id, loaded in self.loaded.items():
            if loaded.api._router is not None:
                yield ext_id, loaded.api._router

    def refresh_routes(self):
        from ..api.extension_routes import refresh_extensions

        for app, prefix, authenticate in self.apps:
            refresh_extensions(app, prefix=prefix, authenticate=authenticate)

    def close(self):
        for loaded in list(self.loaded.values()):
            loaded.api._enabled = False
            loaded.api.stop_services()

    # ------------------------------------------------------------- install
    @operation_serialized
    @catalog_transition
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
        if target.exists() or manifest.id in self.loaded:
            self.engine.ensure_executor_source_idle(f"ext:{manifest.id}")
        total = sum(zf.getinfo(n).file_size for n in names)
        if total > 4 * MAX_ZIP:
            raise ExtensionError("扩展包解压后过大")
        staging = self.root / f".staging-{manifest.id}"
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        try:
            for n in names:
                rel = n[len(prefix) :].replace("\\", "/")
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
        if manifest.id in self.loaded:
            self.unload(manifest.id)
        if target.exists():
            shutil.rmtree(target)
        staging.rename(target)
        self._save_state(manifest.id, False, "")
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
