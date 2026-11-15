"""Bounded JSON requests from a reviewed sandbox panel to existing typed HTTP routes.

No URL, header or credential comes from the frame. Dispatch goes through the same ASGI app,
including FastAPI dependencies, validation, operation wrappers and v2 bearer authorization.
"""

from __future__ import annotations

import asyncio
import json
import re
from urllib.parse import quote

import httpx
from fastapi import HTTPException, Request
from pydantic import Field, JsonValue
from starlette.routing import compile_path

from ..auth import required_scope
from ..models import StrictModel
from ..storage import NotFound
from .manifest import PanelSpec, digest, read_manifest

MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_CONCURRENT = 4


class PanelResponseRejected(Exception):
    def __init__(self, status: int, detail: str):
        self.status, self.detail = status, detail


class PanelContext(StrictModel):
    episode_id: str | None = Field(default=None, max_length=160)
    series_id: str | None = Field(default=None, max_length=160)


class PanelBridgeRequest(StrictModel):
    activation: str = Field(min_length=1, max_length=100)
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    request_id: str = Field(min_length=1, max_length=48)
    path_params: dict[str, str] = Field(default_factory=dict, max_length=20)
    query: dict[str, str | int | float | bool | list[str]] = Field(
        default_factory=dict, max_length=40
    )
    body: JsonValue = None
    context: PanelContext = Field(default_factory=PanelContext)


class PanelBridgeResponse(StrictModel):
    status: int
    data: JsonValue = None


def active_panel(ctx, ext_id: str, panel_id: str, body=None) -> tuple[PanelSpec, object, str]:
    manager = ctx.extensions
    loaded = manager.loaded.get(ext_id)
    state = ctx.settings().extensions.get(ext_id)
    if loaded is None or state is None or not state.enabled:
        raise NotFound("extension panel is not active")
    if body and (body.activation != loaded.api.activation_id or body.digest != state.digest):
        raise NotFound("extension activation changed; reopen the panel")
    try:
        current = digest(loaded.api.folder)
        manifest = read_manifest(loaded.api.folder)
    except (OSError, ValueError):
        raise NotFound("extension content is unavailable") from None
    if current != state.digest or manifest.id != ext_id:
        raise NotFound("extension content changed; review and enable it again")
    panel = next((p for p in manifest.contributes.panels if p.id == panel_id), None)
    if panel is None:
        raise NotFound("extension panel does not exist")
    return panel, loaded, current


def _target(app, ext_id: str, spec):
    """Find a declaration by exact logical template, never by a caller-supplied URL."""
    if spec.path.startswith("/extension-panels/"):
        raise HTTPException(403, "panel bridge recursion is not allowed")
    own_route = spec.path.startswith(f"/ext/{ext_id}/")
    if spec.path.startswith("/ext/") and not own_route:
        raise HTTPException(403, "a panel may only call its own extension routes")
    for mounted_path, operations in app.openapi().get("paths", {}).items():
        extra = operations.get(spec.method.lower())
        if extra is None:
            continue
        logical = extra.get("x-mio-operation")
        path = (
            mounted_path.removeprefix("/api") if mounted_path.startswith("/api/") else mounted_path
        )
        if (own_route and path == spec.path) or logical == f"{spec.method} {spec.path}":
            scope = (
                extra.get("x-mio-scope", "admin")
                if own_route
                else required_scope(spec.method, spec.path)
            )
            if spec.scope != scope:
                raise HTTPException(403, "panel request scope does not match the target operation")
            return mounted_path
    raise HTTPException(403, "panel request does not match an available typed API operation")


def _path(template: str, params: dict[str, str]) -> str:
    names = set(re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", template))
    if set(params) != names:
        raise HTTPException(422, "path parameters must exactly match the declared template")
    path = template
    for name, value in params.items():
        if not value or value in (".", "..") or any(c in value for c in "/\\%?#\x00"):
            raise HTTPException(422, "path parameters must be individual path segments")
        path = path.replace("{" + name + "}", quote(value, safe=""))
    return path


def _context(ctx, context: PanelContext):
    if context.series_id:
        ctx.store.get_series(context.series_id)
    if context.episode_id:
        episode = ctx.store.get_episode(context.episode_id)
        if context.series_id and episode.series_id != context.series_id:
            raise HTTPException(422, "panel context episode does not belong to the work")


async def dispatch_panel(
    ctx, request: Request, ext_id: str, panel_id: str, body: PanelBridgeRequest
):
    if len(body.model_dump_json().encode("utf-8")) > MAX_REQUEST_BYTES:
        raise HTTPException(413, "panel request exceeds 64 KiB")
    panel, loaded, _ = active_panel(ctx, ext_id, panel_id, body)
    spec = next((item for item in panel.requests if item.id == body.request_id), None)
    if spec is None:
        raise HTTPException(403, "request was not declared by this panel")
    template = _target(request.app, ext_id, spec)
    path = _path(template, body.path_params)
    # A concrete parameter must not accidentally select an earlier static route.
    for candidate, operations in request.app.openapi().get("paths", {}).items():
        if candidate != template and spec.method.lower() in operations:
            pattern, _, _ = compile_path(candidate)
            if pattern.fullmatch(path):
                raise HTTPException(403, "path also resolves to a different API operation")
    _context(ctx, body.context)
    if not loaded.api._panel_slots.acquire(blocking=False):
        raise HTTPException(429, "panel request concurrency limit reached")
    total = 0

    async def bounded_app(scope, receive, send):
        async def bounded_send(message):
            nonlocal total
            if message["type"] == "http.response.start":
                headers = dict(message.get("headers", []))
                content_type = headers.get(b"content-type", b"").split(b";", 1)[0]
                if message["status"] != 204 and content_type != b"application/json":
                    raise PanelResponseRejected(415, "panel bridge accepts JSON responses only")
                if 300 <= message["status"] < 400:
                    raise PanelResponseRejected(415, "panel bridge does not follow redirects")
            if message["type"] == "http.response.body":
                total += len(message.get("body", b""))
                if total > MAX_RESPONSE_BYTES:
                    raise PanelResponseRejected(413, "panel response exceeds 1 MiB")
            await send(message)

        await request.app(scope, receive, bounded_send)

    # Forward only the caller's credential. The local UI has no bearer; the v2 app runs its
    # normal token dependency again for the actual target scope. No cookies or response headers.
    headers = {}
    if request.headers.get("authorization"):
        headers["authorization"] = request.headers["authorization"]
    try:
        transport = httpx.ASGITransport(app=bounded_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            async with asyncio.timeout(30):
                response = await client.request(
                    spec.method,
                    path,
                    params=body.query,
                    json=body.body,
                    headers=headers,
                    follow_redirects=False,
                )
        return PanelBridgeResponse(
            status=response.status_code, data=response.json() if response.content else None
        )
    except TimeoutError:
        raise HTTPException(
            504, "panel request timed out; check the operation before retrying"
        ) from None
    except PanelResponseRejected as exc:
        raise HTTPException(exc.status, exc.detail) from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(415, "panel response is not valid JSON") from None
    finally:
        loaded.api._panel_slots.release()
