"""``/api/v2``: the open API for bots, scripts and other apps.

It is the same domain API as the UI's ``/api`` (same routers, models and error format
``{detail, kind}``), generated from the domain model rather than hand-written, so every feature
the UI has is reachable.  The differences:

* every route needs a bearer token (:mod:`mio_server.auth`) with the right scope;
* token management and extensions are not exposed at all;
* its own OpenAPI document lives at ``/api/v2/openapi.json`` and drives the generated clients
  (``clients/python/mio_client.py``).
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, Request, WebSocketException
from fastapi.requests import HTTPConnection
from fastapi.responses import JSONResponse

from .. import __version__
from ..auth import SCOPES, ApiToken, AuthError
from . import access, album, canvas, jobs, library, production, series, system

V2_VERSION = "2.0"
ROUTERS = (series, production, canvas, library, jobs, album, system)
# operationId = route function name (= generated client method); generic names get context.
RENAMES = {
    "render": "render_episode",
    "finalize": "finalize_episode",
    "edit": "edit_take",
    "qa": "qa_episode",
    "export": "export_episode",
    "propose": "assistant_propose",
    "apply": "assistant_apply",
    "pause": "pause_job",
    "resume": "resume_job",
    "cancel": "cancel_job",
    "retry": "retry_job",
    "resolve": "resolve_job_item",
    "purge": "purge_trash",
    "expire": "expire_trash",
    "registry": "get_registry",
    "list_templates": "list_album_templates",
    "import_template": "import_album_template",
    "get_template": "get_album_template",
    "delete_template": "delete_album_template",
}


def token_of(conn: HTTPConnection) -> ApiToken:
    header = conn.headers.get("authorization", "")
    raw = header[7:].strip() if header.lower().startswith("bearer ") else ""
    websocket = conn.scope["type"] == "websocket"
    if not raw and websocket:  # browsers cannot set headers on WebSockets
        raw = conn.query_params.get("access_token", "")
    path, root = conn.scope["path"], conn.scope.get("root_path", "")
    if root and path.startswith(root):
        path = path[len(root) :]
    try:
        return conn.app.state.ctx.tokens.verify(
            raw, "WS" if websocket else conn.scope["method"], path
        )
    except AuthError as exc:
        if websocket:
            raise WebSocketException(code=1008, reason=str(exc)) from None
        raise


def build_v2(ctx, errors) -> FastAPI:
    app = FastAPI(
        title="Mio API",
        version=V2_VERSION,
        generate_unique_id_function=lambda route: RENAMES.get(route.name, route.name),
        description=(
            "Open API of Mio Comic Studio. Authenticate with `Authorization: Bearer mio_…` "
            "(create tokens in Settings → API). Scopes: read, write, render, admin."
        ),
    )
    app.state.ctx = ctx
    for exc_type, code, kind in errors:
        app.add_exception_handler(exc_type, _handler(code, kind))
    app.add_exception_handler(AuthError, _auth_handler)

    @app.get("/meta", tags=["meta"])
    def meta() -> dict:
        """Unauthenticated: API and server version (connectivity check)."""
        return {"api": V2_VERSION, "server": __version__, "scopes": list(SCOPES)}

    @app.get("/whoami", tags=["meta"])
    def whoami(token: ApiToken = Depends(token_of)) -> dict:
        return {"id": token.id, "name": token.name, "scopes": token.scopes}

    guard = [Depends(token_of)]
    for module in ROUTERS:
        app.include_router(module.router, dependencies=guard)
    app.include_router(access.hooks, dependencies=guard)
    app.openapi = lambda: _openapi(app)
    return app


def _openapi(app: FastAPI) -> dict:
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi

    schema = get_openapi(
        title=app.title, version=app.version, description=app.description, routes=app.routes
    )
    schema.setdefault("components", {})["securitySchemes"] = {
        "bearer": {"type": "http", "scheme": "bearer", "bearerFormat": "mio_<id>_<secret>"}
    }
    for path, ops in schema.get("paths", {}).items():
        if path == "/meta":
            continue
        for op in ops.values():
            op["security"] = [{"bearer": []}]
    app.openapi_schema = schema
    return schema


def _handler(code: int, kind: str):
    async def handle(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=code, content={"detail": str(exc), "kind": kind})

    return handle


async def _auth_handler(request: Request, exc: AuthError) -> JSONResponse:
    kind = "unauthorized" if exc.status == 401 else "forbidden"
    headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else None
    return JSONResponse(
        status_code=exc.status, content={"detail": str(exc), "kind": kind}, headers=headers
    )
