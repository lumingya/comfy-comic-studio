"""Extension surfaces: shared local and v2 routes."""

from __future__ import annotations

import json
import mimetypes
import re
from pathlib import PurePosixPath
from urllib.parse import quote

from fastapi import Request, Response
from fastapi.responses import FileResponse

from ..extensions.manifest import ManifestError, digest, inside
from ..extensions.panel_bridge import (
    PanelBridgeRequest,
    PanelBridgeResponse,
    active_panel,
    dispatch_panel,
)
from ..extensions.protocol import client_constants
from ..storage import NotFound
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["extensions"])

PANEL_TYPES = {".html", ".js", ".css", ".json", ".png", ".svg", ".webp", ".jpg", ".woff2"}
WORKSPACE_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
)
WORKSPACE_BRIDGE_JS = r"""(() => {
  const protocol = __MIO_WORKSPACE_PROTOCOL__;
  const session = new URLSearchParams(location.hash.slice(1)).get('mio-session');
  if (!session) return;
  const movedHandlers = new Set();
  const lifecycleHandlers = new Set();
  const globalHandlers = new Map();
  const send = (type, payload = {}) =>
    parent.postMessage({ type, session, ...payload }, location.origin);
  const isHostMessage = (event) =>
    event.source === parent && event.origin === location.origin &&
    event.data && event.data.session === session;
  window.addEventListener('message', async (event) => {
    if (!isHostMessage(event)) return;
    const message = event.data;
    if (message.type === protocol.types.context) {
      for (const type of globalHandlers.keys())
        send(protocol.types.listen, { event: type, enabled: true });
      return;
    }
    if (message.type === protocol.types.lifecycle &&
        Object.values(protocol.lifecycle).includes(message.state)) {
      for (const handler of lifecycleHandlers) {
        try { handler(message.state); } catch {}
      }
      return;
    }
    if (message.type === protocol.types.moved) {
      for (const handler of movedHandlers) handler(message.position);
      return;
    }
    if (message.type !== protocol.types.event || message.eventId == null) return;
    const globalEvent = message.event;
    if (!globalEvent || typeof globalEvent.type !== 'string') return;
    let action = protocol.decisions.continue_;
    for (const handler of globalHandlers.get(globalEvent.type) || []) {
      try {
        const result = await handler(globalEvent);
        if (result === protocol.decisions.stopPropagation || (result && result.stop_propagation)) {
          action = protocol.decisions.stopPropagation;
          break;
        }
        if (result === true || result === protocol.decisions.handled || (result && result.handled)) {
          action = protocol.decisions.handled;
          break;
        }
      } catch {}
    }
    send(protocol.types.eventResult, { eventId: message.eventId, action });
  });
  const bridge = Object.freeze({
    resize(width, height) {
      if (Number.isFinite(width) && Number.isFinite(height))
        send(protocol.types.resize, { width, height });
    },
    setClickThrough(enabled) {
      if (typeof enabled === 'boolean') send(protocol.types.clickThrough, { enabled });
    },
    onMoved(handler) {
      if (typeof handler !== 'function') return () => {};
      movedHandlers.add(handler);
      return () => movedHandlers.delete(handler);
    },
    onLifecycle(handler) {
      if (typeof handler !== 'function') return () => {};
      lifecycleHandlers.add(handler);
      return () => lifecycleHandlers.delete(handler);
    },
    onGlobalEvent(type, handler) {
      if (typeof type !== 'string' || !type || typeof handler !== 'function') return () => {};
      let handlers = globalHandlers.get(type);
      if (!handlers) {
        handlers = new Set();
        globalHandlers.set(type, handlers);
        send(protocol.types.listen, { event: type, enabled: true });
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
        if (!handlers.size) {
          globalHandlers.delete(type);
          send(protocol.types.listen, { event: type, enabled: false });
        }
      };
    },
  });
  Object.defineProperty(window, 'bridge', {
    configurable: false,
    enumerable: true,
    value: bridge,
    writable: false,
  });
  send(protocol.types.ready);
})();""".replace("__MIO_WORKSPACE_PROTOCOL__", json.dumps(client_constants()["workspace"]))


@router.get("/extension-surfaces")
def extension_surfaces(ctx: Ctx) -> dict:
    items = []
    manager = ctx.extensions
    reviewed = {
        identifier: manager.reviewed_info(identifier) for identifier in list(manager.loaded)
    }
    for contribution in ctx.registry.all("workspace_surface"):
        identifier = contribution.source.removeprefix("ext:")
        info = reviewed.get(identifier)
        if info is None:
            continue
        if info.manifest is None or info.manifest.workspace is None:
            continue
        loaded = manager.loaded.get(identifier)
        if loaded is None or loaded.api.digest != info.digest:
            continue
        value = contribution.value() if callable(contribution.value) else contribution.value
        entry = value.get("entry", info.manifest.workspace.entry)
        if entry != info.manifest.workspace.entry:
            continue
        items.append(
            {
                "extension_id": identifier,
                "activation": loaded.api.activation_id,
                "digest": loaded.api.digest,
                "id": contribution.id,
                "title": value.get("title", info.manifest.workspace.title),
                "mode": "page" if value.get("mode") == "page" else "floating",
                "url": f"/api/extensions/{identifier}/workspace/{entry}",
            }
        )
    for identifier, info in reviewed.items():
        if info is None or info.manifest is None:
            continue
        loaded = manager.loaded.get(identifier)
        if loaded is None or loaded.api.digest != info.digest:
            continue
        for surface in info.manifest.contributes.floating_surfaces:
            entry = quote(surface.entry, safe="/")
            items.append(
                {
                    "extension_id": identifier,
                    "activation": loaded.api.activation_id,
                    "digest": loaded.api.digest,
                    "id": surface.id,
                    "title": surface.title,
                    "mode": "floating",
                    "url": f"/api/extensions/{identifier}/workspace/{entry}",
                    "priority": surface.priority,
                    "global": surface.global_,
                    "transparent": surface.transparent,
                    "default_position": (
                        surface.default_position.model_dump()
                        if hasattr(surface.default_position, "model_dump")
                        else surface.default_position
                    ),
                }
            )
    return {"items": sorted(items, key=lambda item: item.get("priority", 0), reverse=True)}


def _reviewed_workspace(ctx: Ctx, ext_id: str):
    loaded = ctx.extensions.loaded.get(ext_id)
    info = ctx.extensions.info(ext_id)
    if loaded is None or info.manifest is None:
        raise NotFound("扩展工作区未启用")
    if digest(info.folder) != loaded.api.digest:
        raise NotFound("扩展内容已改变，请重新启用")
    return info


@router.get("/extensions/{ext_id}/workspace-bridge.js", include_in_schema=False)
def extension_workspace_bridge(ctx: Ctx, ext_id: str) -> Response:
    info = _reviewed_workspace(ctx, ext_id)
    if info.manifest.workspace is None and not info.manifest.contributes.floating_surfaces:
        raise NotFound("扩展工作区未启用")
    return Response(
        WORKSPACE_BRIDGE_JS,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": WORKSPACE_CSP,
        },
    )


@router.get("/extensions/{ext_id}/workspace/{path:path}")
def extension_workspace(ctx: Ctx, ext_id: str, path: str) -> Response:
    info = _reviewed_workspace(ctx, ext_id)
    roots = []
    if info.manifest.workspace is not None:
        roots.append(PurePosixPath(info.manifest.workspace.entry).parent)
    roots.extend(
        PurePosixPath(surface.entry).parent
        for surface in info.manifest.contributes.floating_surfaces
    )
    relative = PurePosixPath(path)
    if not any(relative.is_relative_to(root) for root in roots):
        raise NotFound("扩展页面不存在")
    file = inside(info.folder, path)
    if not file.is_file() or file.suffix.lower() not in PANEL_TYPES | {".html", ".map"}:
        raise NotFound("扩展页面不存在")
    headers = {
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": WORKSPACE_CSP,
    }
    if file.suffix.lower() != ".html":
        return FileResponse(file, headers=headers)

    bridge_tag = (
        f'<script src="/api/extensions/{quote(ext_id, safe="")}/workspace-bridge.js"></script>'
    ).encode()
    content = file.read_bytes()
    if bridge_tag not in content:
        head = re.search(rb"<head\b[^>]*>", content, flags=re.IGNORECASE)
        script = re.search(rb"<script\b", content, flags=re.IGNORECASE)
        doctype = re.search(rb"<!doctype\b[^>]*>", content, flags=re.IGNORECASE)
        if script is not None:
            index = script.start()
        elif head is not None:
            index = head.end()
        else:
            index = doctype.end() if doctype else 0
        content = content[:index] + bridge_tag + content[index:]
    return Response(content, media_type="text/html", headers=headers)


@router.get("/extension-panels")
def extension_panels(ctx: Ctx) -> list[dict]:
    """UI panels of active extensions; the web app shows them in sandboxed iframes."""
    out = []
    for info in ctx.extensions.list():
        if info.status != "active" or info.manifest is None:
            continue
        for p in info.manifest.contributes.panels:
            try:
                _, loaded, pinned = active_panel(ctx, info.id, p.id)
            except NotFound:
                continue
            out.append(
                {
                    "extension": info.id,
                    "id": p.id,
                    "slot": p.slot,
                    "title": p.title,
                    "url": f"/api/extensions/{info.id}/files/{p.entry}",
                    "activation": loaded.api.activation_id,
                    "digest": pinned,
                    "priority": p.priority,
                    "requests": [item.model_dump() for item in p.requests],
                    "subscriptions": p.subscriptions,
                }
            )
    return sorted(out, key=lambda panel: panel["priority"], reverse=True)


@router.post("/extension-panels/{ext_id}/{panel_id}/requests")
async def panel_request(
    ctx: Ctx, request: Request, ext_id: str, panel_id: str, body: PanelBridgeRequest
) -> PanelBridgeResponse:
    """Call only a reviewed panel's declared operation; target validation and scope still apply."""
    return await dispatch_panel(ctx, request, ext_id, panel_id, body)


@router.get("/extensions/{ext_id}/files/{path:path}", include_in_schema=False)
def extension_file(ctx: Ctx, ext_id: str, path: str) -> Response:
    info = ctx.extensions.info(ext_id)
    if info.status != "active":
        raise NotFound(f"扩展未启用：{ext_id}")
    loaded = ctx.extensions.loaded.get(ext_id)
    if loaded is None or loaded.api.digest != info.digest:
        raise NotFound("扩展内容已改变，请重新审阅并启用")
    try:
        target = inside(info.folder, path)
    except ManifestError as exc:
        raise NotFound(str(exc)) from None
    if not target.is_file() or target.suffix.lower() not in PANEL_TYPES:
        raise NotFound(f"文件不存在：{path}")
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    # Panels run in a sandboxed iframe without same-origin; this CSP keeps them from loading
    # anything remote even if opened directly.
    csp = (
        "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; frame-src 'none'; "
        "style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; "
        "frame-ancestors 'self'"
    )
    return FileResponse(target, media_type=mime, headers={"Content-Security-Policy": csp})
