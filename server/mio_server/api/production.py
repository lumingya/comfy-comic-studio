"""Rendering, editing, QA, the strip canvas, exports and the script assistant."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import Query, Response
from pydantic import BaseModel, Field

from ..models import Strip
from ..pipeline import assistant as A
from ..pipeline import episode_strip as ES
from ..pipeline import export as X
from ..pipeline import strip as SP
from ..storage import NotFound
from .deps import Ctx
from .library import ASSET_RESPONSES, EXPORT_RESPONSES, binary_responses
from .operations import Router as APIRouter

router = APIRouter(tags=["production"])


class RenderRequest(BaseModel):
    panel_ids: list[str] | None = None
    profile_id: str | None = None
    candidates: int | None = Field(default=None, ge=1, le=16)
    variant_ids: list[str | None] | None = None
    idempotency_key: str | None = None
    qa: bool = False
    adopt_first: bool = Field(
        default=False,
        description="Adopt the first image of each panel that has no adopted image yet "
        "(the queue's one-click flow: images go straight into the album).",
    )
    adopt_replace: bool = Field(
        default=False,
        description="Adopt the first new image of each panel even if the panel already has one "
        "(the queue's 单幕重跑: the rerun replaces the album image; the old one stays a candidate).",
    )


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
    layout_id: str = "strip.default"
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
        adopt_first=body.adopt_first,
        adopt_replace=body.adopt_replace,
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
def layout_strip(
    ctx: Ctx, episode_id: str, body: LayoutRequest, base_revision: int | None = Query(None, ge=0)
) -> Strip:
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    images, faces = _adopted_images(ctx, ep, body.variant_id)
    if not images:
        raise ValueError("还没有采用任何一格的图片")
    strip, _ = ctx.registry.get("layout", body.layout_id)(
        series, ep, images, faces, relayout_lettering=body.relayout_lettering
    )
    strip = Strip.model_validate(strip)
    if body.relayout_lettering:
        layers = ctx.hooks.filter("strip.lettering", strip.lettering, series=series, episode=ep)
        if isinstance(layers, list):
            strip.lettering = layers
    ctx.store.update_episode(
        episode_id, lambda e: setattr(e, "strip", strip), expected_revision=base_revision
    )
    return strip


@router.put("/episodes/{episode_id}/strip", response_model=Strip)
def save_strip(
    ctx: Ctx, episode_id: str, strip: Strip, base_revision: int | None = Query(None, ge=0)
) -> Strip:
    """Hand edits from the canvas (moved / resized lettering, crops, boxes)."""
    ep = ctx.store.get_episode(episode_id)
    known = {p.id for p in ep.panels}
    unknown = (set(strip.panel_boxes) | set(strip.crops)) - known
    if unknown:
        raise ValueError(f"未知的格：{', '.join(sorted(unknown))}")
    strip.height = SP.content_height(strip)
    ctx.store.update_episode(
        episode_id, lambda e: setattr(e, "strip", strip), expected_revision=base_revision
    )
    return strip


@router.get(
    "/episodes/{episode_id}/strip.png",
    response_class=Response,
    responses=binary_responses("image/png"),
)
def strip_png(
    ctx: Ctx,
    episode_id: str,
    variant_id: str | None = None,
    width: int = Query(default=0, ge=0, le=4000),
) -> Response:
    return ctx.exports.response(
        "strip",
        {"episode_id": episode_id, "fmt": "long", "variant_id": variant_id, "preview_width": width},
    )


@router.get(
    "/episodes/{episode_id}/export",
    response_class=Response,
    responses=EXPORT_RESPONSES,
)
def export(
    ctx: Ctx,
    episode_id: str,
    fmt: str = "slices",
    preset: str = "webtoon",
    variant_id: str | None = None,
    quality: int | None = Query(
        default=None, ge=0, le=100, description="0 = lossless PNG; else JPEG / WebP quality"
    ),
) -> Response:
    return ctx.exports.response(
        "strip",
        {
            "episode_id": episode_id,
            "fmt": fmt,
            "preset": preset,
            "variant_id": variant_id,
            "quality": quality,
        },
    )


@router.get("/export/formats")
def export_formats(ctx: Ctx) -> list[dict]:
    return [
        {"id": c.id, "title": c.title, "interface": c.meta.get("interface"), "source": c.source}
        for c in ctx.registry.all("exporter")
    ]


@router.get("/episodes/{episode_id}/slices")
def slice_plan(
    ctx: Ctx, episode_id: str, preset: str = "webtoon", variant_id: str | None = None
) -> dict:
    """Where a platform preset would cut the strip — drives the slice preview in the reader."""
    from ..pipeline.file_export import plan_slices
    from ..pipeline.regions import prepare_snapshot

    p = X.preset(ctx.registry.get("slice_preset", preset))
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    with prepare_snapshot(ctx, series, ep, variant_id) as snapshot:
        width, height, ranges = plan_slices(snapshot.strip, p)
        return {
            "preset": p.id,
            "width": width,
            "height": height,
            "heights": [b - a for a, b in ranges],
            "format": p.fmt,
            "quality": p.quality,
        }


@router.get("/export/presets")
def export_presets(ctx: Ctx) -> list[dict]:
    return [
        {
            "id": p.id,
            "label": p.label,
            "width": p.width,
            "max_height": p.max_height,
            "format": p.fmt,
            "quality": p.quality,
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


@router.get(
    "/episodes/{episode_id}/takes/{take_id}/image",
    response_class=Response,
    responses=ASSET_RESPONSES,
)
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
