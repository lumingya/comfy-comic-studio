"""Rendering, editing, QA, the strip canvas, exports and the script assistant."""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from ..models import Strip
from ..pipeline import assistant as A
from ..pipeline import episode_strip as ES
from ..pipeline import export as X
from ..pipeline import strip as SP
from ..storage import NotFound
from .deps import Ctx

router = APIRouter(tags=["production"])


class RenderRequest(BaseModel):
    panel_ids: list[str] | None = None
    profile_id: str | None = None
    candidates: int | None = Field(default=None, ge=1, le=16)
    variant_ids: list[str | None] | None = None
    idempotency_key: str | None = None
    qa: bool = False


class FinalizeRequest(BaseModel):
    take_ids: list[str] | None = None
    profile_id: str | None = None
    idempotency_key: str | None = None


class EditRequest(BaseModel):
    take_id: str
    kind: Literal["inpaint", "outpaint", "edit"]
    params: dict[str, Any] = Field(default_factory=dict)
    profile_id: str | None = None
    idempotency_key: str | None = None


class QARequest(BaseModel):
    take_ids: list[str] | None = None
    votes: int | None = Field(default=None, ge=1, le=7)
    auto_adopt: bool | None = None
    idempotency_key: str | None = None


class LayoutRequest(BaseModel):
    relayout_lettering: bool = True
    variant_id: str | None = None


class ProposeRequest(BaseModel):
    instruction: str


class ApplyRequest(BaseModel):
    ops: list[dict[str, Any]]
    accepted: list[str]
    base_revision: int


# ------------------------------------------------------------------ render
@router.post("/episodes/{episode_id}/render")
def render(ctx: Ctx, episode_id: str, body: RenderRequest) -> dict:
    return ctx.render.render(
        episode_id,
        body.panel_ids,
        body.profile_id,
        body.candidates,
        body.variant_ids,
        idempotency_key=body.idempotency_key,
        qa=body.qa,
    )


@router.post("/episodes/{episode_id}/finalize")
def finalize(ctx: Ctx, episode_id: str, body: FinalizeRequest) -> dict:
    return ctx.render.finalize(
        episode_id, body.take_ids, body.profile_id, idempotency_key=body.idempotency_key
    )


@router.post("/episodes/{episode_id}/edit")
def edit(ctx: Ctx, episode_id: str, body: EditRequest) -> dict:
    return ctx.render.edit(
        episode_id,
        body.take_id,
        body.kind,
        body.params,
        body.profile_id,
        idempotency_key=body.idempotency_key,
    )


@router.post("/episodes/{episode_id}/qa")
def qa(ctx: Ctx, episode_id: str, body: QARequest) -> dict:
    cfg = ctx.settings().qa
    return ctx.qa.submit(
        episode_id,
        body.take_ids,
        votes=body.votes or cfg.votes,
        faces=cfg.faces,
        auto_adopt=cfg.auto_adopt if body.auto_adopt is None else body.auto_adopt,
        idempotency_key=body.idempotency_key,
    )


# ------------------------------------------------------------------- strip
_adopted_images = ES.adopted_images
_render_strip = ES.render_episode_strip


@router.post("/episodes/{episode_id}/strip/layout", response_model=Strip)
def layout_strip(ctx: Ctx, episode_id: str, body: LayoutRequest) -> Strip:
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    images, faces = _adopted_images(ctx, ep, body.variant_id)
    if not images:
        raise ValueError("还没有采用任何一格的图片")
    strip, _ = SP.layout(series, ep, images, faces, relayout_lettering=body.relayout_lettering)
    if body.relayout_lettering:
        layers = ctx.hooks.filter("strip.lettering", strip.lettering, series=series, episode=ep)
        if isinstance(layers, list):
            strip.lettering = layers
    ctx.store.update_episode(episode_id, lambda e: setattr(e, "strip", strip))
    return strip


@router.put("/episodes/{episode_id}/strip", response_model=Strip)
def save_strip(ctx: Ctx, episode_id: str, strip: Strip) -> Strip:
    """Hand edits from the canvas (moved / resized lettering, crops, boxes)."""
    ep = ctx.store.get_episode(episode_id)
    known = {p.id for p in ep.panels}
    unknown = (set(strip.panel_boxes) | set(strip.crops)) - known
    if unknown:
        raise ValueError(f"未知的格：{', '.join(sorted(unknown))}")
    ctx.store.update_episode(episode_id, lambda e: setattr(e, "strip", strip))
    return strip


@router.get("/episodes/{episode_id}/strip.png")
def strip_png(ctx: Ctx, episode_id: str, variant_id: str | None = None, width: int = 0) -> Response:
    _, _, _, image = _render_strip(ctx, episode_id, variant_id)
    return Response(X.long_image(image, "PNG", width), media_type="image/png")


@router.get("/episodes/{episode_id}/export")
def export(
    ctx: Ctx,
    episode_id: str,
    fmt: Literal["slices", "long", "pdf", "html"] = "slices",
    preset: str = "webtoon",
    variant_id: str | None = None,
) -> Response:
    slice_preset = ctx.registry.get("slice_preset", preset)
    series, ep, strip, image = _render_strip(ctx, episode_id, variant_id)
    data, mime, filename = X.export(
        image,
        strip,
        fmt,
        preset_id=slice_preset,
        title=f"{series.title}_{ep.title}",
        subtitle=ep.title,
    )
    ctx.hooks.action(
        "episode.exported",
        {"episode_id": episode_id, "fmt": fmt, "bytes": len(data), "filename": filename},
    )
    disposition = f"attachment; filename*=UTF-8''{quote(filename)}"
    return Response(data, media_type=mime, headers={"Content-Disposition": disposition})


@router.get("/export/presets")
def export_presets(ctx: Ctx) -> list[dict]:
    return [
        {
            "id": p.id,
            "label": p.label,
            "width": p.width,
            "max_height": p.max_height,
            "format": p.fmt,
        }
        for p in (c.value for c in ctx.registry.all("slice_preset"))
    ]


# --------------------------------------------------------------- assistant
@router.post("/episodes/{episode_id}/assistant/propose")
def propose(ctx: Ctx, episode_id: str, body: ProposeRequest) -> dict:
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    return A.propose(series, ep, body.instruction, ctx.llm_factory())


@router.post("/episodes/{episode_id}/assistant/apply")
def apply(ctx: Ctx, episode_id: str, body: ApplyRequest) -> dict:
    return A.apply(ctx.store, episode_id, body.ops, body.accepted, body.base_revision)


@router.get("/episodes/{episode_id}/takes/{take_id}/image")
def take_image(ctx: Ctx, episode_id: str, take_id: str) -> Response:
    take = ctx.store.get_episode(episode_id).take(take_id)
    if take is None:
        raise NotFound(f"take not found: {take_id}")
    asset = ctx.store.get_asset(take.asset_id)
    return Response(
        ctx.assets.read(asset.id),
        media_type=asset.mime,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
