"""Strip-comic craft: automatic pacing, SFX presets and per-panel composition previews."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ..models import Episode, LetterStyle, PanelWidth
from ..pipeline import composition as CP
from ..pipeline import lettering as LT
from ..pipeline import pacing as PC
from ..pipeline import readability as RD
from ..pipeline.compiler import canvas_size
from ..storage import NotFound
from .deps import Ctx

router = APIRouter(tags=["canvas"])


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
def sfx_presets() -> dict[str, LetterStyle]:
    return {name: LT.preset_style(name) for name in LT.SFX_PRESETS}


@router.post("/episodes/{episode_id}/pacing/suggest", response_model=PacingPreview)
def pacing_suggest(ctx: Ctx, episode_id: str) -> PacingPreview:
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    return PacingPreview(revision=ep.revision, suggestions=PC.suggest(series, ep))


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
    ep = ctx.store.get_episode(episode_id)
    faces = {}
    for panel in ep.ordered_panels():
        take = ep.adopted(panel.id, variant_id)
        if take is not None:
            faces[panel.id] = [
                {"box": list(f.box), "character": f.character_id} for f in take.faces
            ]
    return RD.report(ep, ep.strip, faces)


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
