"""创作工坊: the workshop (storyboards + presets) and 装配 (assembling an album)."""

from __future__ import annotations

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from .. import workshop as W
from ..models import Episode, Series, WorkshopQueue
from .deps import Ctx

router = APIRouter(tags=["workshop"])


class AssembleRequest(BaseModel):
    storyboard_id: str
    preset_ids: list[str] = Field(default_factory=list)
    title: str = Field(default="", max_length=120)
    profile_id: str | None = None


class PreviewRequest(BaseModel):
    preset_ids: list[str] = Field(min_length=1)
    prompt: str = Field(min_length=1, max_length=8000)
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


@router.post("/workshop/preview", response_model=Assembled, status_code=status.HTTP_201_CREATED)
def preview_preset(ctx: Ctx, body: PreviewRequest) -> Assembled:
    """预设工坊「独立试绘」: one prompt + presets → a one-frame album waiting in the queue (no
    storyboard, no model call).  Start it with ``POST /episodes/{id}/render``."""
    W.ensure_workshop(ctx.store, getattr(ctx, "legacy_root", None))
    series, episode = W.preview(
        ctx.store, body.preset_ids, body.prompt, body.title, body.profile_id
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


# ------------------------------------------------------------------ 装配队列
class QueueStatus(WorkshopQueue):
    """The queue state plus what the page needs to explain it."""

    fault: str | None = Field(default=None, description="Storage warning (low disk space).")
    auto_concurrency: int = Field(description="Panels per album when no default is set.")


class QueueAlbums(BaseModel):
    album_ids: list[str] = Field(default_factory=list, max_length=2000)


class QueueAlbum(BaseModel):
    album_id: str


class QueueSettings(BaseModel):
    concurrency: int | None = Field(default=None, ge=1, le=128)


def _status(ctx, q: WorkshopQueue | None = None) -> QueueStatus:
    q = q or ctx.queue.state()
    return QueueStatus(
        **q.model_dump(), fault=ctx.queue.fault(), auto_concurrency=ctx.render.auto_window()
    )


@router.get("/workshop/queue", response_model=QueueStatus)
def get_queue(ctx: Ctx) -> QueueStatus:
    """装配队列: card order, the sequential lane, the default concurrency and storage warnings."""
    return _status(ctx, ctx.queue.advance())


@router.post("/workshop/queue/start", response_model=QueueStatus)
def start_queue(ctx: Ctx, body: QueueAlbums) -> QueueStatus:
    """按顺序开始生成: the albums start one after another (each renders its missing panels)."""
    return _status(ctx, ctx.queue.start(body.album_ids))


@router.post("/workshop/queue/remove", response_model=QueueStatus)
def remove_from_queue(ctx: Ctx, body: QueueAlbum) -> QueueStatus:
    """移出队列: the album stops waiting in the lane; jobs already started are not touched."""
    return _status(ctx, ctx.queue.remove(body.album_id))


@router.post("/workshop/queue/pause", response_model=QueueStatus)
def pause_queue(ctx: Ctx) -> QueueStatus:
    """Hold the lane (全局暂停 also pauses the running jobs, through the job API)."""
    return _status(ctx, ctx.queue.hold(True))


@router.post("/workshop/queue/resume", response_model=QueueStatus)
def resume_queue(ctx: Ctx) -> QueueStatus:
    return _status(ctx, ctx.queue.hold(False))


@router.post("/workshop/queue/clear", response_model=QueueStatus)
def clear_queue(ctx: Ctx) -> QueueStatus:
    """停止全部: empty the lane (running jobs are stopped through the job API)."""
    return _status(ctx, ctx.queue.clear())


@router.put("/workshop/queue/order", response_model=QueueStatus)
def order_queue(ctx: Ctx, body: QueueAlbums) -> QueueStatus:
    """Drag to reorder the task cards; the lane follows the new order."""
    return _status(ctx, ctx.queue.set_order(body.album_ids))


@router.patch("/workshop/queue", response_model=QueueStatus)
def patch_queue(ctx: Ctx, body: QueueSettings) -> QueueStatus:
    """默认并发: panels per album for albums without their own setting (None = automatic)."""
    return _status(ctx, ctx.queue.set_concurrency(body.concurrency))
