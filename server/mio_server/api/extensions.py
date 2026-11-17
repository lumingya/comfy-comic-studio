"""Extensions (install / review / enable), domain hooks, and UI themes."""

from __future__ import annotations

import io
import mimetypes
import os
import zipfile
from email import policy
from email.parser import BytesParser
from pathlib import PurePosixPath

from fastapi import Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, JsonValue

from .. import themes as TH
from ..backups.extension_data import load_settings, save_settings, settings_exist
from ..extensions.manager import ExtensionError
from ..extensions.manifest import ManifestError, inside
from ..extensions.panel_bridge import (
    PanelBridgeRequest,
    PanelBridgeResponse,
    active_panel,
    dispatch_panel,
)
from ..storage import NotFound
from .deps import Ctx
from .library import BINARY_BODY, read_body
from .operations import Router as APIRouter

router = APIRouter(tags=["extensions"])

PANEL_TYPES = {".html", ".js", ".css", ".json", ".png", ".svg", ".webp", ".jpg", ".woff2"}


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
    data = await read_body(request, 50 * 1024 * 1024, "扩展包超过 50 MB")
    return _mgr(ctx).install(data, replace=replace).to_json()


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
    raw = await read_body(request, 51 * 1024 * 1024, "扩展包超过 50 MB")
    envelope = BytesParser(policy=policy.default).parsebytes(
        ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode("ascii") + raw
    )
    buffer = io.BytesIO()
    total = count = 0
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in envelope.iter_parts():
            if item.get_param("name", header="content-disposition") != "files":
                continue
            name = (item.get_filename() or "").replace("\\", "/")
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
            data = item.get_payload(decode=True) or b""
            total += len(data)
            count += 1
            if total > 50 * 1024 * 1024 or count > 2000:
                raise ValueError("扩展文件夹过大")
            archive.writestr(name, data)
    return _mgr(ctx).install(buffer.getvalue(), replace=replace).to_json()


@router.get("/extension-surfaces")
def extension_surfaces(ctx: Ctx) -> dict:
    items = []
    for contribution in ctx.registry.all("workspace_surface"):
        identifier = contribution.source.removeprefix("ext:")
        loaded = ctx.extensions.loaded.get(identifier)
        if loaded is None:
            continue
        info = ctx.extensions.info(identifier)
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
    return {"items": items}


@router.get("/extensions/{ext_id}/workspace/{path:path}")
def extension_workspace(ctx: Ctx, ext_id: str, path: str):
    loaded = ctx.extensions.loaded.get(ext_id)
    info = ctx.extensions.info(ext_id)
    if loaded is None or info.manifest is None or info.manifest.workspace is None:
        raise NotFound("扩展工作区未启用")
    from ..extensions.manifest import digest

    if digest(info.folder) != loaded.api.digest:
        raise NotFound("扩展内容已改变，请重新启用")
    root = PurePosixPath(info.manifest.workspace.entry).parent
    relative = PurePosixPath(path)
    if not relative.is_relative_to(root):
        raise NotFound("扩展页面不存在")
    file = inside(info.folder, path)
    if not file.is_file() or file.suffix.lower() not in PANEL_TYPES | {".html", ".map"}:
        raise NotFound("扩展页面不存在")
    return FileResponse(
        file,
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
        },
    )


@router.post("/extensions/{ext_id}/disable")
def disable_extension(ctx: Ctx, ext_id: str) -> dict:
    return _mgr(ctx).disable(ext_id).to_json()


@router.delete("/extensions/{ext_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_extension(ctx: Ctx, ext_id: str) -> None:
    _mgr(ctx).remove(ext_id)


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
                    "requests": [item.model_dump() for item in p.requests],
                }
            )
    return out


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
    return Response(target.read_bytes(), media_type=mime, headers={"Content-Security-Policy": csp})


# ------------------------------------------------------------------ themes
@router.get("/themes")
def list_themes(ctx: Ctx) -> list[dict]:
    return [TH.to_json(c.value, c.source) for c in ctx.registry.all("theme")]


@router.post("/themes", status_code=status.HTTP_201_CREATED)
def import_theme(ctx: Ctx, body: dict) -> dict:
    """Import a theme file (JSON).  Built-in and extension ids cannot be overwritten."""
    theme = TH.parse_theme(body)
    existing = next((c for c in ctx.registry.all("theme") if c.id == theme.id), None)
    if existing and existing.source != "user":
        raise ValueError(f"主题 id 已被占用：{theme.id}")
    ctx.store.put_doc(theme)
    ctx.registry.register("theme", theme.id, theme, source="user", title=theme.name, replace=True)
    return TH.to_json(theme, "user")


@router.delete("/themes/{theme_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_theme(ctx: Ctx, theme_id: str) -> None:
    existing = next((c for c in ctx.registry.all("theme") if c.id == theme_id), None)
    if existing is None:
        raise NotFound(f"主题不存在：{theme_id}")
    if existing.source != "user":
        raise ValueError("只能删除自己导入的主题")
    ctx.store.delete_doc("theme", theme_id)
    ctx.registry.unregister("theme", theme_id)
