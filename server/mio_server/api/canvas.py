"""Strip-comic craft: automatic pacing, SFX presets and per-panel composition previews."""

from __future__ import annotations

from typing import Literal

from fastapi import Query, Response
from pydantic import BaseModel, ConfigDict, Field

from ..models import Episode, LetterStyle, PanelWidth, Strip
from ..pipeline import canvas_assist as CA
from ..pipeline import composition as CP
from ..pipeline import pacing as PC
from ..pipeline import readability as RD
from ..pipeline.compiler import canvas_size
from ..pipeline.reading import ReadingPreview
from ..storage import Conflict, NotFound
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["canvas"])


@router.get("/episodes/{episode_id}/reading", response_model=ReadingPreview)
def reading_preview(
    ctx: Ctx,
    episode_id: str,
    variant_id: str | None = None,
    width: int = Query(1600, ge=64, le=3200),
) -> ReadingPreview:
    """Read composited geometry and expanded captions without saving layout or calling models."""
    return ctx.reading.get(ctx, episode_id, variant_id, width).preview


@router.get(
    "/episodes/{episode_id}/panels/{panel_id}/image",
    response_class=Response,
    responses={200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}},
)
def reading_panel_image(
    ctx: Ctx,
    episode_id: str,
    panel_id: str,
    variant_id: str | None = None,
    width: int = Query(
        1600, ge=64, le=3200, description="Maximum preview width; may be reduced to fit memory"
    ),
) -> Response:
    """Adopted panel with saved framing and lettering; full-strip whitespace is outside its crop."""
    data = ctx.reading.image(ctx, episode_id, panel_id, variant_id, width)
    return Response(data, media_type="image/png", headers={"Cache-Control": "no-cache"})


class PacingChanges(BaseModel):
    model_config = ConfigDict(extra="forbid")

    width_mode: PanelWidth | None = None
    aspect_ratio: str | None = None
    gap_after: int | None = Field(default=None, ge=0, le=1200)
    transition_background: str | None = None
    inset_align: Literal["left", "center", "right"] | None = None


class PacingSuggestion(BaseModel):
    panel_id: str
    order: int
    changes: PacingChanges
    reasons: list[str] = Field(default_factory=list)


class PacingPreview(BaseModel):
    revision: int
    suggestions: list[PacingSuggestion]


class PacingPatch(BaseModel):
    panel_id: str
    changes: PacingChanges


class PacingApply(BaseModel):
    base_revision: int
    patches: list[PacingPatch]


@router.get("/lettering/sfx-presets", response_model=dict[str, LetterStyle])
def sfx_presets(ctx: Ctx) -> dict[str, LetterStyle]:
    """Built-in presets plus those contributed by extensions (registry point ``sfx_preset``)."""
    return {c.id: c.value for c in ctx.registry.all("sfx_preset")}


@router.post("/episodes/{episode_id}/pacing/suggest", response_model=PacingPreview)
def pacing_suggest(ctx: Ctx, episode_id: str, preset: PC.PacingPreset = "auto") -> PacingPreview:
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    return PacingPreview(revision=ep.revision, suggestions=PC.suggest(series, ep, preset))


class LetteringAvoidRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_revision: int = Field(ge=0)
    strip: Strip
    layer_ids: list[str] = Field(min_length=1, max_length=64)


class LetteringAvoidPreview(BaseModel):
    revision: int
    strip: Strip
    unresolved: list[str]


@router.post("/episodes/{episode_id}/strip/avoid-lettering", response_model=LetteringAvoidPreview)
def avoid_lettering(
    ctx: Ctx, episode_id: str, body: LetteringAvoidRequest
) -> LetteringAvoidPreview:
    """Preview selected bubble moves without writing the work or invoking image models."""
    with ctx.store.lock:
        ep = ctx.store.get_episode(episode_id)
        if ep.revision != body.base_revision:
            raise Conflict("Episode changed; reload before placing lettering")
        sizes = {}
        for panel_id in body.strip.panel_boxes:
            take = ep.adopted(panel_id)
            if take:
                asset = ctx.store.get_asset(take.asset_id)
                sizes[panel_id] = (asset.width or 1, asset.height or 1)
    strip, unresolved = CA.avoid_lettering(ep, body.strip, body.layer_ids, sizes)
    return LetteringAvoidPreview(revision=ep.revision, strip=strip, unresolved=unresolved)


@router.post("/episodes/{episode_id}/pacing/apply", response_model=Episode)
def pacing_apply(ctx: Ctx, episode_id: str, body: PacingApply) -> Episode:
    patches = [
        {"panel_id": p.panel_id, "changes": p.changes.model_dump(exclude_none=True, mode="json")}
        for p in body.patches
    ]
    return PC.apply(ctx.store, episode_id, patches, body.base_revision)


@router.get("/episodes/{episode_id}/strip/report")
def strip_report(ctx: Ctx, episode_id: str, variant_id: str | None = None) -> dict:
    """Readability check of the saved strip (missing lines, faces covered, overlaps …)."""
    with ctx.store.lock:
        ep = ctx.store.get_episode(episode_id)
        series = ctx.store.get_series(ep.series_id)
    faces = {}
    for panel in ep.ordered_panels():
        take = ep.adopted(panel.id, variant_id)
        if take is not None:
            faces[panel.id] = [
                {"box": list(f.box), "character": f.character_id} for f in take.faces
            ]
    return RD.report(series, ep, ep.strip, faces)


class CompositionRegion(BaseModel):
    character_id: str
    name: str
    box: tuple[float, float, float, float]
    prompt: str


class CompositionPreview(BaseModel):
    width: int
    height: int
    regions: list[CompositionRegion]
    pose_asset_id: str | None = None
    warnings: list[str] = Field(default_factory=list)


@router.post(
    "/episodes/{episode_id}/panels/{panel_id}/composition", response_model=CompositionPreview
)
def composition_preview(
    ctx: Ctx, episode_id: str, panel_id: str, dialect: Literal["tags", "natural"] = "tags"
) -> CompositionPreview:
    """Regions, regional prompts and the auto pose skeleton exactly as a render would use them."""
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    panel = ep.panel(panel_id)
    if panel is None:
        raise NotFound(f"panel not found: {panel_id}")
    width, height = canvas_size(panel)
    width, height = panel.overrides.width or width, panel.overrides.height or height
    warnings = []
    if len(panel.characters) < 2:
        warnings.append("分区多角色需要至少两个角色")
    regions = []
    for i, region in enumerate(CP.regions(panel)):
        ch = series.bible.character(region["character_id"])
        regions.append(
            CompositionRegion(
                character_id=region["character_id"],
                name=ch.name if ch else region["character_id"],
                box=region["box"],
                prompt=CP.region_prompt(series, panel, i, dialect),
            )
        )
    pose = CP.pose_image(panel, width, height)
    pose_id = ctx.assets.put(CP.png_bytes(pose), source="pose:auto").id if pose else None
    if pose is None:
        warnings.append("没有人物或是大特写：无法自动生成姿势骨架")
    return CompositionPreview(
        width=width, height=height, regions=regions, pose_asset_id=pose_id, warnings=warnings
    )
