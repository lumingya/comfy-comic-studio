"""HTTP API v1 for the React front end (``/api/...``) plus the job event WebSocket.

``create_app(ctx)`` never touches the network or starts ComfyUI work by itself; pass an
:class:`~mio_server.context.AppContext` built however you like (tests use ``memory=True``).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from .. import llm as L
from ..bundle import BundleError
from ..comfy.bindings import BindingError
from ..context import AppContext
from ..jobs import JobConflict, JobError, JobNotFound
from ..pipeline.assistant import AssistantError
from ..pipeline.render import RenderError
from ..registry import RegistryError
from ..storage import Conflict, NotFound
from . import jobs, library, production, series, system

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

    for exc_type, code, kind in ERRORS:
        app.add_exception_handler(exc_type, _handler(code, kind))

    @app.get("/healthz")
    def healthz() -> dict:
        from ..storage import SCHEMA_VERSION

        return {"ok": True, "schema": SCHEMA_VERSION, "api": API_VERSION}

    for module in (series, production, library, jobs, system):
        app.include_router(module.router, prefix="/api")

    if serve_web and (WEB_DIST / "index.html").exists():
        _mount_web(app)
    return app


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
