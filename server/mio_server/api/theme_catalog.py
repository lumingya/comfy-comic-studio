"""Theme catalog: shared local and v2 routes."""

from __future__ import annotations

import hashlib
from urllib.parse import quote

from fastapi import status

from .. import themes as TH
from ..storage import NotFound
from ..theme_media import MAX_THEME_SCRIPT_BYTES, describe_media, media_type
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["extensions"])


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
                "animated": theme.background.kind == "image",
                "mime_type": media_type(theme.background.file),
            }
            try:
                from .theme_packages import _theme_file

                image_path = _theme_file(ctx, theme.id, theme.background.file)
                item["background"].update(
                    describe_media(image_path, theme.background.kind, item["background"]["url"])
                )
            except (NotFound, OSError, ValueError):
                pass
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
