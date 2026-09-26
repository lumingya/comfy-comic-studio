"""Album templates (secondary output): list / import / delete, and HTML album export."""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field

from ..album import templates as T
from ..album.build import episode_book
from ..album.render import AlbumOptions, render_album
from ..storage import NotFound
from .deps import Ctx

router = APIRouter(tags=["album"])


class AlbumExport(BaseModel):
    episode_ids: list[str] = Field(min_length=1, max_length=50)
    template_id: str = "export-paper"
    variant_id: str | None = None
    lettered: bool = Field(default=True, description="Crop panels from the lettered strip")
    show_captions: bool = True
    show_prompts: bool = False
    theme_color: str = ""
    border: int = Field(default=0, ge=0, le=8)
    signature: str = Field(default="", max_length=120)
    title: str = Field(default="", max_length=120)
    max_width: int = Field(default=1400, ge=320, le=4000)


def _find(ctx, template_id: str):
    item = next((c for c in ctx.registry.all("album_template") if c.id == template_id), None)
    if item is None:
        raise NotFound(f"画册模板不存在：{template_id}")
    return item


@router.get("/album-templates")
def list_templates(ctx: Ctx) -> list[dict]:
    return [T.summary(c.value, c.source) for c in ctx.registry.all("album_template")]


@router.get("/album-templates/{template_id}")
def get_template(ctx: Ctx, template_id: str) -> dict:
    return _find(ctx, template_id).value.model_dump(exclude={"name"})


@router.post("/album-templates", status_code=status.HTTP_201_CREATED)
def import_template(ctx: Ctx, body: dict) -> dict:
    """Import a template file (the legacy ``formatVersion: 1`` format works unchanged)."""
    tpl = T.parse_template(body)
    existing = next((c for c in ctx.registry.all("album_template") if c.id == tpl.id), None)
    if existing and existing.source != "user":
        raise ValueError(f"模板 id 已被占用：{tpl.id}")
    ctx.store.put_doc(tpl)
    ctx.registry.register(
        "album_template", tpl.id, tpl, source="user", title=tpl.title, replace=True
    )
    return T.summary(tpl, "user")


@router.delete("/album-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(ctx: Ctx, template_id: str) -> None:
    if _find(ctx, template_id).source != "user":
        raise ValueError("只能删除自己导入的模板")
    ctx.store.delete_doc("album_template", template_id)
    ctx.registry.unregister("album_template", template_id)


@router.post("/export/album")
def export_album(ctx: Ctx, body: AlbumExport) -> Response:
    """Self-contained offline HTML album; one book per episode."""
    tpl = _find(ctx, body.template_id).value
    books = [
        episode_book(
            ctx, eid, variant_id=body.variant_id, lettered=body.lettered, max_width=body.max_width
        )
        for eid in body.episode_ids
    ]
    html = render_album(
        tpl,
        books,
        AlbumOptions(
            show_captions=body.show_captions,
            show_prompts=body.show_prompts,
            border=body.border,
            signature=body.signature,
            theme_color=body.theme_color,
            collection_title=body.title,
        ),
    )
    data = html.encode("utf-8")
    base = body.title or (books[0].title if len(books) == 1 else f"画册合集_{len(books)}话")
    filename = f"{base}_{tpl.id}.html"
    for eid in body.episode_ids:
        ctx.hooks.action(
            "episode.exported",
            {"episode_id": eid, "fmt": "album", "bytes": len(data), "filename": filename},
        )
    return Response(
        data,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
