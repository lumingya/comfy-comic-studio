"""Extensions (install / review / enable), domain hooks, and UI themes."""

from __future__ import annotations

import hashlib
import mimetypes
import os
import re
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from fastapi import Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, JsonValue
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from .. import themes as TH
from ..backups.extension_data import load_settings, save_settings, settings_exist
from ..extension_preferences import (
    MAX_PREFERENCES_JSON,
    load_preferences,
    preferences_exist,
    save_preferences,
    validate_preferences,
)
from ..extensions.manager import MAX_ENTRIES, MAX_ZIP, ExtensionError
from ..extensions.manifest import ManifestError, digest, inside
from ..extensions.panel_bridge import (
    PanelBridgeRequest,
    PanelBridgeResponse,
    active_panel,
    dispatch_panel,
)
from ..storage import NotFound
from ..theme_media import MAX_THEME_SCRIPT_BYTES, image_may_animate
from .deps import Ctx
from .library import BINARY_BODY
from .operations import Router as APIRouter
from .uploads import multipart_uploads

router = APIRouter(tags=["extensions"])

PANEL_TYPES = {".html", ".js", ".css", ".json", ".png", ".svg", ".webp", ".jpg", ".woff2"}
WORKSPACE_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
)
WORKSPACE_BRIDGE_JS = r"""(() => {
  const session = new URLSearchParams(location.hash.slice(1)).get('mio-session');
  if (!session) return;
  const movedHandlers = new Set();
  const globalHandlers = new Map();
  const send = (type, payload = {}) =>
    parent.postMessage({ type, session, ...payload }, location.origin);
  const isHostMessage = (event) =>
    event.source === parent && event.origin === location.origin &&
    event.data && event.data.session === session;
  window.addEventListener('message', async (event) => {
    if (!isHostMessage(event)) return;
    const message = event.data;
    if (message.type === 'mio:workspace:moved') {
      for (const handler of movedHandlers) handler(message.position);
      return;
    }
    if (message.type !== 'mio:workspace:event' || message.eventId == null) return;
    const globalEvent = message.event;
    if (!globalEvent || typeof globalEvent.type !== 'string') return;
    let action = 'continue';
    for (const handler of globalHandlers.get(globalEvent.type) || []) {
      try {
        const result = await handler(globalEvent);
        if (result === 'stop_propagation' || (result && result.stop_propagation)) {
          action = 'stop_propagation';
          break;
        }
        if (result === true || result === 'handled' || (result && result.handled)) {
          action = 'handled';
          break;
        }
      } catch {}
    }
    send('mio:workspace:event-result', { eventId: message.eventId, action });
  });
  const bridge = Object.freeze({
    resize(width, height) {
      if (Number.isFinite(width) && Number.isFinite(height))
        send('mio:workspace:resize', { width, height });
    },
    setClickThrough(enabled) {
      if (typeof enabled === 'boolean') send('mio:workspace:click-through', { enabled });
    },
    onMoved(handler) {
      if (typeof handler !== 'function') return () => {};
      movedHandlers.add(handler);
      return () => movedHandlers.delete(handler);
    },
    onGlobalEvent(type, handler) {
      if (typeof type !== 'string' || !type || typeof handler !== 'function') return () => {};
      let handlers = globalHandlers.get(type);
      if (!handlers) {
        handlers = new Set();
        globalHandlers.set(type, handlers);
        send('mio:workspace:listen', { event: type, enabled: true });
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
        if (!handlers.size) {
          globalHandlers.delete(type);
          send('mio:workspace:listen', { event: type, enabled: false });
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
  send('mio:workspace:ready');
})();"""


class EnableRequest(BaseModel):
    digest: str


def _mgr(ctx):
    return ctx.extensions


# -------------------------------------------------------------- extensions
@router.get("/extensions")
def list_extensions(ctx: Ctx) -> dict:
    return {
        "items": [i.to_json() for i in _mgr(ctx).list()],
        "hooks": ctx.hooks.describe(),
        "safe_mode": os.environ.get("MIO_SAFE_MODE") == "1",
    }


@router.post("/extensions", status_code=status.HTTP_201_CREATED, openapi_extra=BINARY_BODY)
async def install_extension(ctx: Ctx, request: Request, replace: bool = False) -> dict:
    """Raw body = zipped extension folder.  Installed disabled; review, then enable."""
    size = 0
    with tempfile.TemporaryDirectory(prefix="mio-extension-upload-") as temporary:
        archive = Path(temporary) / "extension.zip"
        with archive.open("wb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_ZIP:
                    raise ValueError("扩展包超过 50 MB")
                output.write(chunk)
        if size == 0:
            raise ValueError("请求体为空")
        installed = await run_in_threadpool(_mgr(ctx).install_path, archive, replace)
        return installed.to_json()


@router.post("/extensions/{ext_id}/enable")
def enable_extension(ctx: Ctx, ext_id: str, body: EnableRequest) -> dict:
    """Enable exactly the reviewed content (``digest`` from the listing)."""
    return _mgr(ctx).enable(ext_id, body.digest).to_json()


@router.post("/extensions/folder", status_code=201)
async def install_extension_folder(ctx: Ctx, request: Request, replace: bool = False) -> dict:
    """Import a portable extension directory; files are reviewed before activation."""
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data;") or any(
        c in content_type for c in "\r\n"
    ):
        raise ValueError("请上传扩展文件夹")
    uploads = await multipart_uploads(
        request,
        max_files=MAX_ENTRIES,
        max_file_bytes=MAX_ZIP,
        max_body_bytes=MAX_ZIP + 1024 * 1024,
    )
    try:
        with tempfile.TemporaryDirectory(prefix="mio-extension-folder-") as temporary:
            archive = Path(temporary) / "extension.zip"
            total = count = 0
            names = set()
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
                for field, item in uploads:
                    if field != "files":
                        continue
                    if not isinstance(item, UploadFile):
                        raise ValueError("请上传扩展文件夹")
                    name = (item.filename or "").replace("\\", "/")
                    path = PurePosixPath(name)
                    if not name or path.is_absolute() or ".." in path.parts or ":" in name:
                        raise ValueError("文件夹包含不安全的路径")
                    if any(
                        part
                        in {
                            "node_modules",
                            ".git",
                            "__pycache__",
                            ".venv",
                            ".cache",
                            ".pytest_cache",
                            ".ruff_cache",
                        }
                        or part.startswith(".env")
                        for part in path.parts
                    ):
                        continue
                    if name in names:
                        raise ValueError("文件夹包含重复路径")
                    names.add(name)
                    count += 1
                    if count > MAX_ENTRIES:
                        raise ValueError("扩展文件夹过大")
                    with output.open(name, "w", force_zip64=True) as destination:
                        while chunk := await item.read(1024 * 1024):
                            total += len(chunk)
                            if total > MAX_ZIP:
                                raise ValueError("扩展文件夹过大")
                            destination.write(chunk)
            installed = await run_in_threadpool(_mgr(ctx).install_path, archive, replace)
            return installed.to_json()
    finally:
        for _, upload in uploads:
            await upload.close()


@router.get("/extension-surfaces")
def extension_surfaces(ctx: Ctx) -> dict:
    items = []
    manager = _mgr(ctx)
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
        value = contribution.value() if callable(contribution.value) else contribution.value
        entry = value.get("entry", info.manifest.workspace.entry)
        if entry != info.manifest.workspace.entry:
            continue
        items.append(
            {
                "extension_id": identifier,
                "id": contribution.id,
                "title": value.get("title", info.manifest.workspace.title),
                "mode": "page" if value.get("mode") == "page" else "floating",
                "url": f"/api/extensions/{identifier}/workspace/{entry}",
            }
        )
    for identifier, info in reviewed.items():
        if info is None or info.manifest is None:
            continue
        for surface in info.manifest.contributes.floating_surfaces:
            entry = quote(surface.entry, safe="/")
            items.append(
                {
                    "extension_id": identifier,
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


@router.post("/extensions/{ext_id}/disable")
def disable_extension(ctx: Ctx, ext_id: str) -> dict:
    return _mgr(ctx).disable(ext_id).to_json()


@router.delete("/extensions/{ext_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_extension(ctx: Ctx, ext_id: str, delete_data: bool = False) -> None:
    _mgr(ctx).remove(ext_id, delete_data=delete_data)


def _settings_target(ctx, ext_id: str):
    # Data can outlive an uninstalled package. Never create arbitrary names through this API.
    if settings_exist(ctx.data_dir, ext_id):
        return
    try:
        info = _mgr(ctx).info(ext_id)
    except ExtensionError:
        raise NotFound("extension or retained settings not found") from None
    if info.manifest is None:
        raise NotFound("extension manifest is invalid")


@router.get("/extensions/{ext_id}/settings", response_model=dict[str, JsonValue])
def get_extension_settings(ctx: Ctx, ext_id: str) -> dict[str, JsonValue]:
    """Read bounded JSON settings without activating or executing an extension."""
    with ctx.engine.hold_operation():
        _settings_target(ctx, ext_id)
        return load_settings(ctx.data_dir, ext_id)


@router.put("/extensions/{ext_id}/settings", response_model=dict[str, JsonValue])
def put_extension_settings(
    ctx: Ctx, ext_id: str, body: dict[str, JsonValue]
) -> dict[str, JsonValue]:
    """Atomically replace extension settings; the same storage contract is used by its SDK."""
    with ctx.engine.hold_operation():
        _settings_target(ctx, ext_id)
        save_settings(ctx.data_dir, ext_id, body)
        return load_settings(ctx.data_dir, ext_id)


def _preferences_target(ctx: Ctx, ext_id: str) -> None:
    if preferences_exist(ctx.data_dir, ext_id):
        return
    try:
        info = _mgr(ctx).info(ext_id)
    except ExtensionError:
        raise NotFound("extension or retained preferences not found") from None
    if info.manifest is None:
        raise NotFound("extension manifest is invalid")


@router.get("/ext/{ext_id}/preferences", response_model=dict[str, JsonValue])
def get_extension_preferences(ctx: Ctx, ext_id: str) -> dict[str, JsonValue]:
    with ctx.engine.hold_operation():
        _preferences_target(ctx, ext_id)
        return load_preferences(ctx.data_dir, ext_id)


@router.put(
    "/ext/{ext_id}/preferences",
    response_model=dict[str, JsonValue],
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        },
    },
)
async def put_extension_preferences(
    ctx: Ctx, ext_id: str, request: Request
) -> dict[str, JsonValue]:
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_PREFERENCES_JSON:
            raise ValueError("extension preferences exceed 1 MiB")
        raw.extend(chunk)

    def replace_preferences() -> dict[str, JsonValue]:
        body = validate_preferences(raw)
        with ctx.engine.hold_operation():
            _preferences_target(ctx, ext_id)
            save_preferences(ctx.data_dir, ext_id, body)
        return body

    return await run_in_threadpool(replace_preferences)


@router.get("/extension-panels")
def extension_panels(ctx: Ctx) -> list[dict]:
    """UI panels of active extensions; the web app shows them in sandboxed iframes."""
    out = []
    for info in _mgr(ctx).list():
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
    info = _mgr(ctx).info(ext_id)
    if info.status != "active":
        raise NotFound(f"扩展未启用：{ext_id}")
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
        "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'"
    )
    return FileResponse(target, media_type=mime, headers={"Content-Security-Policy": csp})


# ------------------------------------------------------------------ themes
@router.get("/themes")
def list_themes(ctx: Ctx) -> list[dict]:
    result = []
    for contribution in ctx.registry.all("theme"):
        theme = contribution.value
        item = TH.to_json(theme, contribution.source)
        if theme.background:
            encoded = "/".join(
                quote(part, safe="") for part in theme.background.file.split("/")[1:]
            )
            item["background"] = {
                "kind": theme.background.kind,
                "url": f"/api/themes/{quote(theme.id, safe='')}/assets/{encoded}",
                "opacity": theme.background.opacity,
            }
            if theme.background.kind == "image":
                try:
                    from .theme_packages import _theme_file

                    image_path = _theme_file(ctx, theme.id, theme.background.file)
                    with image_path.open("rb") as image:
                        item["background"]["animated"] = image_may_animate(
                            theme.background.file, image.read(256 * 1024)
                        )
                except (NotFound, OSError, ValueError):
                    item["background"]["animated"] = True
        if theme.style_file:
            item["style_url"] = f"/api/themes/{quote(theme.id, safe='')}/style"
        if theme.script_file:
            try:
                from .theme_packages import _theme_file

                script_path = _theme_file(ctx, theme.id, theme.script_file)
                if script_path.stat().st_size > MAX_THEME_SCRIPT_BYTES:
                    raise ValueError("theme.js exceeds 1 MB")
                item["script_url"] = f"/api/themes/{quote(theme.id, safe='')}/script"
                item["script_digest"] = hashlib.sha256(script_path.read_bytes()).hexdigest()
            except (NotFound, OSError, ValueError):
                pass
        result.append(item)
    return result


@router.post("/themes", status_code=status.HTTP_201_CREATED)
def import_theme(ctx: Ctx, body: dict) -> dict:
    """Import a theme JSON document. Built-in, package and extension IDs cannot be overwritten."""
    theme = TH.parse_theme(body)
    if theme.background or theme.style_file or theme.script_file:
        raise ValueError("含媒体、样式或脚本的主题必须通过主题包或文件夹导入")
    existing = next((c for c in ctx.registry.all("theme") if c.id == theme.id), None)
    if existing and existing.source != "user":
        raise ValueError(f"主题 id 已被占用：{theme.id}")
    ctx.store.put_doc(theme)
    ctx.registry.register("theme", theme.id, theme, source="user", title=theme.name, replace=True)
    return TH.to_json(theme, "user")
