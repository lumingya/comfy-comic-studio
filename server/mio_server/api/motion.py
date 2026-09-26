"""Dynamic comic: the per-panel camera / timing plan and the offline motion-comic export."""

from __future__ import annotations

from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from ..motion.export import MotionOptions, episode_motion, render_motion
from ..motion.plan import MOVES, plan_episode
from .deps import Ctx

router = APIRouter(tags=["motion"])


class MotionExport(BaseModel):
    episode_id: str
    variant_id: str | None = None
    aspect: Literal["portrait", "landscape"] = "portrait"
    lettered: bool = Field(default=True, description="Crop panels from the lettered strip")
    subtitles: bool = Field(default=False, description="Subtitles on at start (toggle in player)")
    voice: bool = Field(default=True, description="Read lines aloud with browser speech")
    lang: str = Field(default="zh-CN", pattern=r"^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$")
    max_width: int = Field(default=1280, ge=320, le=3000)


@router.get("/episodes/{episode_id}/motion-plan")
def motion_plan(ctx: Ctx, episode_id: str, variant_id: str | None = None) -> dict:
    """Resolved move and hold for every panel (``Panel.motion`` overrides, else automatic)."""
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    shots = plan_episode(series, ep.ordered_panels())
    for shot in shots:
        shot["has_image"] = ep.adopted(shot["panel_id"], variant_id) is not None
    playable = [s for s in shots if s["has_image"]]
    return {
        "moves": list(MOVES),
        "shots": shots,
        "total_seconds": round(sum(s["hold"] for s in playable), 1),
    }


@router.post("/export/motion")
def export_motion(ctx: Ctx, body: MotionExport) -> Response:
    """Self-contained offline motion-comic player (one HTML file, no network needed)."""
    opts = MotionOptions(
        aspect=body.aspect,
        lettered=body.lettered,
        subtitles=body.subtitles,
        voice=body.voice,
        lang=body.lang,
        max_width=body.max_width,
    )
    timeline = episode_motion(ctx, body.episode_id, body.variant_id, opts)
    data = render_motion(timeline, opts).encode("utf-8")
    filename = f"{timeline['series']}_{timeline['title']}_动态漫.html"
    ctx.hooks.action(
        "episode.exported",
        {"episode_id": body.episode_id, "fmt": "motion", "bytes": len(data), "filename": filename},
    )
    return Response(
        data,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
