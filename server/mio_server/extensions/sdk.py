"""The object an extension's ``activate(mio)`` receives.

Stable surface: :meth:`contribute`, :meth:`hook`, :attr:`router`, :meth:`load_settings` /
:meth:`save_settings`, :attr:`log`.  Everything registered through it is tagged with the extension's
source, so disabling the extension removes it again.

``mio.internal`` is the escape hatch (ROADMAP §2.4): the whole :class:`AppContext` — every store and
service.  It is explicitly **unstable** and may break between versions, but nothing is off limits.
"""

from __future__ import annotations

import logging
import secrets
import threading
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter

from ..auth import SCOPES
from ..jobs import ItemSpec
from ..jobs.operations import operation_serialized
from ..jobs.types import JobConflict
from ..pipeline.providers import validate_cloud_adapter_metadata
from .protocol import MAX_CONCURRENT


class ExtensionAPI:
    def __init__(self, ext_id: str, folder: Path, ctx, *, digest: str = ""):
        self.id = ext_id
        self.source = f"ext:{ext_id}"
        self.folder = folder
        self.activation_id = secrets.token_urlsafe(24)
        self._panel_slots = threading.BoundedSemaphore(MAX_CONCURRENT)
        self._ctx = ctx
        self.engine = ctx.engine
        self.digest = digest
        self._enabled = True
        self._services = []
        self._router: APIRouter | None = None
        self.log = logging.getLogger(f"mio.ext.{ext_id}")

    # ------------------------------------------------------------ registry
    @property
    def active(self):
        return self._enabled

    @property
    def data_dir(self):
        from ..backups.extension_data import extension_data_dir

        return extension_data_dir(self._ctx.data_dir, self.id)

    @property
    def host_app(self):
        return self._ctx.host_app

    def service(self, value):
        """Register an owned runtime service; disable closes it before removal."""
        self._ctx.extension_services[self.id] = value
        self._services.append(value)
        return value

    def stop_services(self):
        for value in reversed(self._services):
            close = getattr(value, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    self.log.exception("extension service close failed")
            if self._ctx.extension_services.get(self.id) is value and not getattr(
                value, "busy", False
            ):
                self._ctx.extension_services.pop(self.id, None)
        self._services.clear()

    @operation_serialized
    def contribute(self, point: str, id: str, value: Any, *, title: str = "", **meta):
        """Register a contribution at an extension point (see ``GET /api/registry``)."""
        if not self._enabled:
            raise JobConflict("this extension activation is no longer enabled")
        if point == "job_executor":
            return self.job_executor(id, value, title=title, **meta)
        if "digest" in meta and meta["digest"] != self.digest:
            raise ValueError("extension contributions use their reviewed package digest")
        meta["digest"] = self.digest
        meta.setdefault("contract", 1)
        adapter_methods = {
            "comfy_output_adapter": ("freeze", "collect"),
            "comfy_state_adapter": ("capture", "push", "change", "validate"),
            "workflow_slot_adapter": ("inspect", "write"),
        }
        if methods := adapter_methods.get(point):
            if meta["contract"] != 1 or any(not callable(getattr(value, m, None)) for m in methods):
                raise ValueError("invalid Comfy adapter contract")
        if point == "cloud_adapter":
            if not callable(value):
                raise ValueError("cloud_adapter must be a channel factory")
            if meta["contract"] != 1:
                raise ValueError("unsupported cloud_adapter contract version")
            descriptor = validate_cloud_adapter_metadata(meta)
            meta = {"digest": self.digest, "contract": 1, **descriptor}
        replace = bool(meta.pop("replace", False))
        if replace:
            self.engine.ensure_executor_source_idle(self.source)
        contribution = self._ctx.registry.register(
            point,
            id,
            value,
            source=self.source,
            title=title or id,
            replace=replace,
            **meta,
        )
        if not self.engine.catalog_loading:
            self.engine.refresh_executor_jobs()
        return contribution

    @operation_serialized
    def job_executor(self, kind, executor, *, resources=("local",), replace=False, title=""):
        """Register executable jobs under this reviewed package's persistent identity."""
        if not self._enabled:
            raise JobConflict("this extension activation is no longer enabled")
        return self.engine.register(
            kind,
            executor,
            source=self.source,
            digest=self.digest,
            resources=resources,
            replace=replace,
            title=title,
        )

    @operation_serialized
    def submit_job(
        self,
        kind: str,
        items: list[ItemSpec],
        snapshot: dict | None = None,
        *,
        owner: str = "",
        title: str = "",
        idempotency_key: str | None = None,
    ):
        """Submit this activation's currently selected executor; routes choose their scope.

        Use a typed extension route with ``scope='render'``. Declare the work/episode being
        changed as owner; an empty owner conservatively blocks all workspace management.
        """
        binding = self.engine.current_executor(kind)
        if (
            not self._enabled
            or not binding
            or binding.ref.source != self.source
            or binding.ref.digest != self.digest
        ):
            raise JobConflict("this extension's executor is disabled or overridden")
        return self.engine.submit(
            kind, items, snapshot, owner=owner, title=title, idempotency_key=idempotency_key
        )

    def hook(self, name: str, fn: Callable | None = None, *, priority: int = 0):
        """Add a domain hook handler; usable directly or as ``@mio.hook("prompt.compiled")``."""

        def add(handler: Callable) -> Callable:
            with self.engine.hold_operation():
                if not self._enabled:
                    raise JobConflict("this extension activation is no longer enabled")
                self._ctx.registry.hooks.add(name, handler, priority=priority, source=self.source)
            return handler

        return add(fn) if fn is not None else add

    def operation(self, id: str):
        """Wrap a typed HTTP operation, e.g. ``POST /episodes/{episode_id}/render``.

        The handler receives ``next`` and the validated endpoint arguments. It may
        ``await next(**changed_arguments)`` once, or return a replacement result. Newest
        wrappers run outermost; disabling this source restores the previous chain.
        """

        def add(handler):
            self.contribute("operation", id, handler, replace=True)
            return handler

        return add

    # --------------------------------------------------------------- routes
    @property
    def router(self) -> APIRouter:
        """Mounted locally and at ``/api/v2/ext/<id>``; v2 defaults to admin scope.

        Enable and disable update routes immediately. Use :meth:`route` for a narrower v2 scope.
        """
        if self._router is None:
            self._router = APIRouter(tags=[f"ext:{self.id}"])
        return self._router

    def route(self, method: str, path: str, *, scope: str = "admin", **kwargs):
        """Register a normal typed FastAPI route with an explicit v2 permission."""
        if scope not in SCOPES:
            raise ValueError(f"unknown API scope: {scope}")
        extra = {**kwargs.pop("openapi_extra", {}), "x-mio-scope": scope}
        return self.router.api_route(path, methods=[method.upper()], openapi_extra=extra, **kwargs)

    # ------------------------------------------------------------- settings
    def load_settings(self) -> dict:
        from ..backups.extension_data import load_settings

        with self.engine.hold_operation():
            return load_settings(self._ctx.data_dir, self.id)

    def save_settings(self, data: dict) -> None:
        from ..backups.extension_data import save_settings

        with self.engine.hold_operation():
            save_settings(self._ctx.data_dir, self.id, data)

    # --------------------------------------------------------- escape hatch
    @property
    def internal(self):
        """Unstable: the application context itself (stores, services, job engine)."""
        return self._ctx
