"""创作工坊: the workshop (storyboards + presets) and 装配 (assembling an album)."""

from __future__ import annotations

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from .. import workshop as W
from ..models import Episode, Series
from .deps import Ctx

router = APIRouter(tags=["workshop"])


class AssembleRequest(BaseModel):
    storyboard_id: str
    preset_ids: list[str] = Field(default_factory=list)
    title: str = Field(default="", max_length=120)
    profile_id: str | None = None


class CloneRequest(BaseModel):
    title: str = Field(default="", max_length=120)


class Assembled(BaseModel):
    series: Series
    episode: Episode


@router.get("/workshop", response_model=Series)
def get_workshop(ctx: Ctx) -> Series:
    """The hidden workshop series: its episodes are the storyboards, ``presets`` the presets.
    Created (seeded from the legacy ``data/``) on first use."""
    return W.ensure_workshop(ctx.store, getattr(ctx, "legacy_root", None))


@router.post("/workshop/assemble", response_model=Assembled, status_code=status.HTTP_201_CREATED)
def assemble(ctx: Ctx, body: AssembleRequest) -> Assembled:
    """Storyboard + presets → a new album waiting in the queue.  Makes no model call; start it
    with ``POST /episodes/{id}/render``."""
    W.ensure_workshop(ctx.store, getattr(ctx, "legacy_root", None))
    series, episode = W.assemble(
        ctx.store, body.storyboard_id, body.preset_ids, body.title, body.profile_id
    )
    return Assembled(series=series, episode=episode)


@router.post(
    "/workshop/tasks/{series_id}/clone",
    response_model=Assembled,
    status_code=status.HTTP_201_CREATED,
)
def clone_task(ctx: Ctx, series_id: str, body: CloneRequest | None = None) -> Assembled:
    """装配队列「克隆」: a new standby album with the same frames, presets and profile (no images)."""
    series, episode = W.clone_task(ctx.store, series_id, body.title if body else "")
    return Assembled(series=series, episode=episode)
