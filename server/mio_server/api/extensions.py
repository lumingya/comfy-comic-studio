"""Extensions (install / review / enable), domain hooks, and UI themes."""

from __future__ import annotations

import mimetypes
import os

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel

from .. import themes as TH
from ..extensions.manifest import ManifestError, inside
from ..storage import NotFound
from .deps import Ctx
from .library import read_body

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


@router.post("/extensions", status_code=status.HTTP_201_CREATED)
async def install_extension(ctx: Ctx, request: Request, replace: bool = False) -> dict:
    """Raw body = zipped extension folder.  Installed disabled; review, then enable."""
    data = await read_body(request, 50 * 1024 * 1024, "扩展包超过 50 MB")
    return _mgr(ctx).install(data, replace=replace).to_json()


@router.post("/extensions/{ext_id}/enable")
def enable_extension(ctx: Ctx, ext_id: str, body: EnableRequest) -> dict:
    """Enable exactly the reviewed content (``digest`` from the listing)."""
    return _mgr(ctx).enable(ext_id, body.digest).to_json()


@router.post("/extensions/{ext_id}/disable")
def disable_extension(ctx: Ctx, ext_id: str) -> dict:
    return _mgr(ctx).disable(ext_id).to_json()


@router.delete("/extensions/{ext_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_extension(ctx: Ctx, ext_id: str) -> None:
    _mgr(ctx).remove(ext_id)


@router.get("/extension-panels")
def extension_panels(ctx: Ctx) -> list[dict]:
    """UI panels of active extensions; the web app shows them in sandboxed iframes."""
    out = []
    for info in _mgr(ctx).list():
        if info.status != "active" or info.manifest is None:
            continue
        for p in info.manifest.contributes.panels:
            out.append(
                {
                    "extension": info.id,
                    "id": p.id,
                    "slot": p.slot,
                    "title": p.title,
                    "url": f"/api/extensions/{info.id}/files/{p.entry}",
                }
            )
    return out


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
