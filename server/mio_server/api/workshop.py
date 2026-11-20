"""创作工坊: the workshop (storyboards + presets) and 装配 (assembling an album)."""

from __future__ import annotations

from fastapi import Query, status
from pydantic import BaseModel, Field

from .. import workshop as W
from ..assembly import AssemblyPreview
from ..comfy.slot_adapters import installed
from ..models import (
    Episode,
    GenerationOptions,
    Panel,
    Preset,
    PresetBinding,
    PresetEntry,
    PresetGroup,
    Series,
    WorkshopQueue,
)
from ..slot_models import TaskLoRASelection, TaskSlotOverrides, task_slots
from ..storage import Conflict, NotFound
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["workshop"])


class AssembleRequest(BaseModel):
    storyboard_id: str
    preset_ids: list[str] = Field(default_factory=list)
    title: str = Field(default="", max_length=120)
    profile_id: str | None = None
    generation: GenerationOptions | None = None
    loras: list[TaskLoRASelection] = Field(default_factory=list, max_length=128)
    slot_overrides: TaskSlotOverrides | None = None
    variables: dict[str, str] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)


class PreviewRequest(BaseModel):
    preset_ids: list[str] = Field(min_length=1)
    prompt: str = Field(min_length=1, max_length=8000)
    title: str = Field(default="", max_length=120)
    profile_id: str | None = None
    generation: GenerationOptions | None = None
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)


class CloneRequest(BaseModel):
    title: str = Field(default="", max_length=120)


class Assembled(BaseModel):
    series: Series
    episode: Episode


class StoryboardCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    synopsis: str = Field(default="", max_length=8000)
    base_prompt: str = Field(default="", max_length=8000)
    panels: list[Panel] = Field(default_factory=list, max_length=2000)


class StoryboardPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    synopsis: str | None = Field(default=None, max_length=8000)
    base_prompt: str | None = Field(default=None, max_length=8000)
    panels: list[Panel] | None = Field(default=None, max_length=2000)


class PresetPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    groups: list[PresetGroup] | None = Field(default=None, max_length=128)
    entries: list[PresetEntry] | None = Field(default=None, max_length=2000)
    bindings: list[PresetBinding] | None = Field(default=None, max_length=2000)


class StoryboardList(BaseModel):
    items: list["StoryboardSummary"]
    total: int
    offset: int
    limit: int


class StoryboardSummary(BaseModel):
    id: str
    series_id: str
    title: str
    order: int
    revision: int
    panel_count: int
    adopted_count: int
    cover_asset_id: str | None
    created_at: str
    updated_at: str


def _workshop(ctx: Ctx) -> Series:
    return W.ensure_workshop(ctx.store, getattr(ctx, "legacy_root", None))


def _storyboard(ctx: Ctx, storyboard_id: str) -> Episode:
    workshop = _workshop(ctx)
    episode = ctx.store.get_episode(storyboard_id)
    if episode.series_id != workshop.id:
        raise NotFound(f"workshop storyboard not found: {storyboard_id}")
    return episode


@router.get("/workshop/storyboards", response_model=StoryboardList)
def list_storyboards(
    ctx: Ctx, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)
) -> StoryboardList:
    workshop = _workshop(ctx)
    items, total = ctx.store.episode_summaries(workshop.id, offset, limit)
    return StoryboardList(items=items, total=total, offset=offset, limit=limit)


@router.get("/workshop/storyboards/{storyboard_id}", response_model=Episode)
def get_storyboard(ctx: Ctx, storyboard_id: str) -> Episode:
    return _storyboard(ctx, storyboard_id)


@router.post("/workshop/storyboards", response_model=Episode, status_code=status.HTTP_201_CREATED)
def create_storyboard(ctx: Ctx, body: StoryboardCreate) -> Episode:
    workshop = _workshop(ctx)
    panels = [panel.model_copy(update={"order": index}) for index, panel in enumerate(body.panels)]
    with ctx.store.lock:
        return ctx.store.create_episode(
            Episode(
                series_id=workshop.id,
                title=body.title,
                order=ctx.store.next_episode_order(workshop.id),
                synopsis=body.synopsis,
                base_prompt=body.base_prompt,
                panels=panels,
            )
        )


@router.patch("/workshop/storyboards/{storyboard_id}", response_model=Episode)
def patch_storyboard(ctx: Ctx, storyboard_id: str, body: StoryboardPatch) -> Episode:
    episode = _storyboard(ctx, storyboard_id)
    changes = body.model_dump(exclude_unset=True)
    if "panels" in changes and changes["panels"] is not None:
        changes["panels"] = [
            panel.model_copy(update={"order": index})
            for index, panel in enumerate(body.panels or [])
        ]
        remaining = {panel.id for panel in changes["panels"]}
        if any(take.panel_id not in remaining for take in episode.takes):
            raise Conflict("不能移除已有出图结果的分幕")
    updated = Episode.model_validate({**episode.model_dump(), **changes})
    return ctx.store.save_episode(updated, expected_revision=episode.revision)


@router.get("/workshop/presets", response_model=list[Preset])
def list_presets(ctx: Ctx) -> list[Preset]:
    return _workshop(ctx).presets


@router.get("/workshop/presets/{preset_id}", response_model=Preset)
def get_preset(ctx: Ctx, preset_id: str) -> Preset:
    preset = next((item for item in _workshop(ctx).presets if item.id == preset_id), None)
    if preset is None:
        raise NotFound(f"workshop preset not found: {preset_id}")
    return preset


@router.post("/workshop/presets", response_model=Preset, status_code=status.HTTP_201_CREATED)
def create_preset(ctx: Ctx, body: Preset) -> Preset:
    workshop = _workshop(ctx)

    def add(series):
        if any(item.id == body.id for item in series.presets):
            raise Conflict("预设 ID 已存在")
        series.presets.append(body)

    ctx.store.update_series(workshop.id, add)
    return body


@router.patch("/workshop/presets/{preset_id}", response_model=Preset)
def patch_preset(ctx: Ctx, preset_id: str, body: PresetPatch) -> Preset:
    workshop = _workshop(ctx)
    if not any(item.id == preset_id for item in workshop.presets):
        raise NotFound(f"workshop preset not found: {preset_id}")
    changes = body.model_dump(exclude_unset=True)
    updated = None

    def replace(series):
        nonlocal updated
        for index, item in enumerate(series.presets):
            if item.id == preset_id:
                updated = Preset.model_validate({**item.model_dump(), **changes, "id": preset_id})
                series.presets[index] = updated
                return
        raise Conflict("预设已被同时删除，请刷新后重试")

    ctx.store.update_series(workshop.id, replace)
    assert updated is not None
    return updated


@router.get("/workshop", response_model=Series)
def get_workshop(ctx: Ctx) -> Series:
    """The hidden workshop series: its episodes are the storyboards, ``presets`` the presets.
    Created (seeded from the legacy ``data/``) on first use."""
    return W.ensure_workshop(ctx.store, getattr(ctx, "legacy_root", None))


@router.post("/workshop/assemble", response_model=Assembled, status_code=status.HTTP_201_CREATED)
def assemble(ctx: Ctx, body: AssembleRequest) -> Assembled:
    """Storyboard + presets → a new album waiting in the queue.  Makes no model call; start it
    with ``POST /episodes/{id}/render``."""
    series, episode = W.assemble(
        ctx.store,
        body.storyboard_id,
        body.preset_ids,
        body.title,
        body.profile_id,
        body.variables,
        body.idempotency_key,
        body.generation,
        slot_overrides=task_slots(body.slot_overrides, body.loras),
        slot_adapters=installed(ctx.registry),
    )
    ctx.queue.track(series.id)
    return Assembled(series=series, episode=episode)


@router.post("/workshop/assemble/preview", response_model=AssemblyPreview)
def preview_assembly(ctx: Ctx, body: AssembleRequest) -> AssemblyPreview:
    """Inspect final prompts, reader dialogue and variable provenance without creating an album."""
    return W.assembly_preview(
        ctx.store,
        body.storyboard_id,
        body.preset_ids,
        body.title,
        body.profile_id,
        body.variables,
        body.generation,
        slot_overrides=task_slots(body.slot_overrides, body.loras),
        slot_adapters=installed(ctx.registry),
    )


@router.post("/workshop/preview", response_model=Assembled, status_code=status.HTTP_201_CREATED)
def preview_preset(ctx: Ctx, body: PreviewRequest) -> Assembled:
    """预设工坊「独立试绘」: one prompt + presets → a one-frame album waiting in the queue (no
    storyboard, no model call).  Start it with ``POST /episodes/{id}/render``."""
    W.ensure_workshop(ctx.store, getattr(ctx, "legacy_root", None))
    series, episode = W.preview(
        ctx.store,
        body.preset_ids,
        body.prompt,
        body.title,
        body.profile_id,
        generation=body.generation,
        idempotency_key=body.idempotency_key,
    )
    ctx.queue.track(series.id)
    return Assembled(series=series, episode=episode)


@router.post(
    "/workshop/tasks/{series_id}/clone",
    response_model=Assembled,
    status_code=status.HTTP_201_CREATED,
)
def clone_task(ctx: Ctx, series_id: str, body: CloneRequest | None = None) -> Assembled:
    """装配队列「克隆」: a new standby album with the same frames, presets and profile (no images)."""
    series, episode = W.clone_task(ctx.store, series_id, body.title if body else "")
    ctx.queue.track(series.id)
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
