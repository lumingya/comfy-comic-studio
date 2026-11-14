"""HTTP API v1 for the React front end (``/api/...``) plus the job event WebSocket.

``create_app(ctx)`` never touches the network or starts ComfyUI work by itself; pass an
:class:`~mio_server.context.AppContext` built however you like (tests use ``memory=True``).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath

from fastapi import Depends, FastAPI, Request, WebSocketException
from fastapi.requests import HTTPConnection
from fastapi.responses import FileResponse, JSONResponse

from .. import llm as L
from ..bundle import BundleError
from ..comfy.bindings import BindingError
from ..context import AppContext
from ..extensions.manifest import digest
from ..jobs import JobConflict, JobError, JobNotFound
from ..pipeline.assistant import AssistantError
from ..pipeline.render import RenderError
from ..registry import RegistryError
from ..storage import Conflict, NotFound
from ..update import UpdateError
from . import (
    access,
    album,
    canvas,
    extensions,
    jobs,
    library,
    manual,
    motion,
    production,
    series,
    system,
    update,
    workshop,
)
from .guard import LocalGuard, env_hosts
from .v2 import build_v2

API_VERSION = "1"
WEB_DIST = Path(__file__).resolve().parents[3] / "web" / "dist"

ERRORS: list[tuple[type[Exception], int, str]] = [
    (NotFound, 404, "not_found"),
    (JobNotFound, 404, "not_found"),
    (RegistryError, 404, "not_found"),
    (Conflict, 409, "conflict"),
    (JobConflict, 409, "conflict"),
    (L.LLMError, 502, "upstream"),
    (RenderError, 400, "invalid"),
    (AssistantError, 400, "invalid"),
    (BundleError, 400, "invalid"),
    (BindingError, 400, "invalid"),
    (JobError, 400, "invalid"),
    (UpdateError, 400, "invalid"),
    (ValueError, 400, "invalid"),
]


def create_app(ctx: AppContext | None = None, *, serve_web: bool = True) -> FastAPI:
    owned = ctx is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        if owned:
            app.state.ctx.close()

    app = FastAPI(title="Mio v3 API", version=API_VERSION, lifespan=lifespan)
    app.state.ctx = ctx or AppContext.create()
    # /api has no login: refuse cross-site writes and DNS-rebound hosts (see guard.py).
    app.add_middleware(LocalGuard, allowed=env_hosts())

    for exc_type, code, kind in ERRORS:
        app.add_exception_handler(exc_type, _handler(code, kind))

    @app.get("/healthz")
    def healthz() -> dict:
        from ..storage import SCHEMA_VERSION

        return {"ok": True, "schema": SCHEMA_VERSION, "api": API_VERSION}

    for module in (
        series,
        production,
        canvas,
        library,
        jobs,
        system,
        extensions,
        album,
        motion,
        workshop,
    ):
        app.include_router(module.router, prefix="/api")
    app.include_router(access.tokens, prefix="/api")
    app.include_router(access.hooks, prefix="/api")
    app.include_router(update.router, prefix="/api")
    app.mount("/api/v2", build_v2(app.state.ctx, ERRORS))
    _mount_extensions(app)
    app.include_router(manual.router)  # the bundled current handbook, before the SPA fallback

    if serve_web and (WEB_DIST / "index.html").exists():
        _mount_web(app)
    return app


def _mount_extensions(app: FastAPI) -> None:
    """Routes declared by loaded extensions live under ``/api/ext/<id>`` (fixed at start-up)."""
    manager = app.state.ctx.extensions
    if manager is None:
        return
    for ext_id, router in manager.routers():
        loaded = manager.loaded[ext_id]
        pinned = manager.ctx.settings().extensions[ext_id].digest
        app.include_router(
            router,
            prefix=f"/api/ext/{ext_id}",
            dependencies=[Depends(_extension_guard(manager, ext_id, loaded, pinned))],
        )
        manager.mounted.add(ext_id)


def _extension_guard(manager, ext_id, loaded, pinned):
    """A route belongs to one reviewed activation, never to a later load of the same id."""

    def require_active(conn: HTTPConnection) -> None:
        state = manager.ctx.settings().extensions.get(ext_id)
        active = (
            manager.loaded.get(ext_id) is loaded
            and state is not None
            and state.enabled
            and state.digest == pinned
        )
        if active:
            try:
                active = digest(loaded.api.folder) == pinned
            except OSError:
                active = False
        if not active:
            if conn.scope["type"] == "websocket":
                raise WebSocketException(code=1008, reason="extension is not active")
            raise NotFound(f"扩展未启用、内容已变动或需要重启：{ext_id}")

    return require_active


def _handler(code: int, kind: str):
    async def handle(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=code, content={"detail": str(exc), "kind": kind})

    return handle


def _mount_web(app: FastAPI) -> None:
    """Serve the built React app (``web/dist``) with SPA fallback."""

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        root = WEB_DIST.resolve()
        target = (root / path).resolve()
        if path and target.is_file() and root in target.parents:
            # Vite emits content-hashed names under assets/, safe to cache forever.
            immutable = path.startswith("assets/")
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} if immutable else {}
            return FileResponse(target, headers=headers)
        # Unknown API routes and missing files must not masquerade as the SPA shell.
        if path == "api" or path.startswith("api/") or PurePosixPath(path).suffix:
            return JSONResponse(
                status_code=404, content={"detail": "Not Found", "kind": "not_found"}
            )
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})
