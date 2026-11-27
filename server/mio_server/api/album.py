"""Album templates (secondary output): list / import / delete, and HTML album export."""

from __future__ import annotations

from typing import Literal

from fastapi import Response, status
from pydantic import BaseModel, Field

from ..album import media as M
from ..album import templates as T
from ..storage import NotFound
from .deps import Ctx
from .library import binary_responses
from .operations import Router as APIRouter

router = APIRouter(tags=["album"])


class AlbumExport(BaseModel):
    episode_ids: list[str] = Field(min_length=1, max_length=50)
    template_id: str = "export-monograph"
    template: dict | None = Field(
        default=None,
        description="An unsaved template draft (模板工作室 live preview); validated like an import "
        "and used instead of ``template_id``",
    )
    variant_id: str | None = None
    lettered: bool = Field(
        default=True,
        description="Preserve a saved canvas as complete full-width composition parts; "
        "without a saved composition, or when false, use complete adopted originals",
    )
    show_captions: bool = True
    deduplicate_captions: bool = Field(
        default=False, description="Omit dialogue lines already fully visible in a lettered panel"
    )
    show_prompts: bool = False
    include_source_data: bool = Field(
        default=False,
        description="Include captions and compiled positive prompts for reimporting the exported "
        "reading projection; independent of visible captions/prompts. Use a .mio.zip source file "
        "to preserve the complete editable project.",
    )
    theme_color: str = ""
    border: int = Field(default=0, ge=0, le=8)
    signature: str = Field(default="", max_length=120)
    title: str = Field(default="", max_length=120)
    max_width: int = Field(
        default=1400, ge=320, le=4000, description="Only used by the ``preview`` image profile"
    )
    image_profile: M.Profile = Field(
        default="preview",
        description="图片处理: auto / clean (无损清洗) / publish (轻量发布) / archive (无损归档); "
        "preview = fast in-app preview encoding",
    )


class PortableExport(BaseModel):
    episode_ids: list[str] = Field(min_length=1, max_length=50)
    format: Literal["zip", "pdf"] = "zip"
    variant_id: str | None = None
    lettered: bool = Field(
        default=True,
        description="Preserve complete saved canvas composition; without one, or when false, "
        "export complete adopted originals without additional framing",
    )
    show_captions: bool = Field(
        default=True, description="ZIP reader captions only; PDF contains one image per page"
    )
    deduplicate_captions: bool = Field(
        default=False, description="Omit dialogue lines already fully visible in a lettered panel"
    )
    title: str = Field(default="", max_length=120)
    image_profile: M.Profile = "auto"


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


@router.post(
    "/export/album",
    response_class=Response,
    responses=binary_responses("text/html"),
)
def export_album(ctx: Ctx, body: AlbumExport) -> Response:
    """Self-contained offline HTML album from an immutable document snapshot."""
    return ctx.exports.response("album", body.model_dump())


@router.post(
    "/export/portable",
    response_class=Response,
    responses=binary_responses("application/zip", "application/pdf"),
)
def export_portable(ctx: Ctx, body: PortableExport) -> Response:
    """Write panel images to a ZIP or PDF without retaining every decoded page."""
    return ctx.exports.response("portable", body.model_dump())
