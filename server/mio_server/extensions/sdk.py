"""The object an extension's ``activate(mio)`` receives.

Stable surface: :meth:`contribute`, :meth:`hook`, :attr:`router`, :meth:`load_settings` /
:meth:`save_settings`, :attr:`log`.  Everything registered through it is tagged with the extension's
source, so disabling the extension removes it again.

``mio.internal`` is the escape hatch (ROADMAP §2.4): the whole :class:`AppContext` — every store and
service.  It is explicitly **unstable** and may break between versions, but nothing is off limits.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter

from ..auth import SCOPES


class ExtensionAPI:
    def __init__(self, ext_id: str, folder: Path, ctx):
        self.id = ext_id
        self.source = f"ext:{ext_id}"
        self.folder = folder
        self._ctx = ctx
        self._router: APIRouter | None = None
        self._settings_path = ctx.data_dir / "extension-data" / f"{ext_id}.json"
        self.log = logging.getLogger(f"mio.ext.{ext_id}")

    # ------------------------------------------------------------ registry
    def contribute(self, point: str, id: str, value: Any, *, title: str = "", **meta):
        """Register a contribution at an extension point (see ``GET /api/registry``)."""
        return self._ctx.registry.register(
            point, id, value, source=self.source, title=title or id, **meta
        )

    def hook(self, name: str, fn: Callable | None = None, *, priority: int = 100):
        """Add a domain hook handler; usable directly or as ``@mio.hook("prompt.compiled")``."""

        def add(handler: Callable) -> Callable:
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

        New routes need a restart. Use :meth:`route` to declare a narrower v2 scope.
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
        try:
            return json.loads(self._settings_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def save_settings(self, data: dict) -> None:
        self._settings_path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(data, ensure_ascii=False, indent=2)
        self._settings_path.write_text(text, encoding="utf-8")

    # --------------------------------------------------------- escape hatch
    @property
    def internal(self):
        """Unstable: the application context itself (stores, services, job engine)."""
        return self._ctx
