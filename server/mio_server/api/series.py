"""Series, episodes (paged), panels and takes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field

from ..models import (
    Episode,
    EpisodeCreate,
    EpisodePatch,
    Panel,
    Series,
    SeriesCreate,
    SeriesPatch,
    TakeStatus,
)
from ..pipeline import assistant as A
from ..pipeline.compiler import preview as prompt_preview
from ..pipeline.refs import select_references
from ..storage import NotFound
from .deps import Ctx

router = APIRouter(tags=["series"])


class PanelCreate(BaseModel):
    panel: dict[str, Any] = Field(default_factory=dict)
    after: str | None = Field(
        default=None, description="Insert after this panel; null = at the end"
    )


class PanelPatch(BaseModel):
    changes: dict[str, Any]
    revision: int | None = None


class Reorder(BaseModel):
    order: list[str]
    revision: int | None = None


class GenerateEpisode(BaseModel):
    sentence: str
    title: str | None = None


# ------------------------------------------------------------------ series
@router.get("/series", response_model=list[Series])
def list_series(ctx: Ctx, deleted: bool = False) -> list[Series]:
    return ctx.store.list_series(deleted=deleted)


@router.post("/series", response_model=Series, status_code=status.HTTP_201_CREATED)
def create_series(ctx: Ctx, payload: SeriesCreate) -> Series:
    return ctx.store.create_series(Series(title=payload.title, subtitle=payload.subtitle))


@router.get("/series/{series_id}", response_model=Series)
def get_series(ctx: Ctx, series_id: str) -> Series:
    return ctx.store.get_series(series_id)


@router.patch("/series/{series_id}", response_model=Series)
def patch_series(ctx: Ctx, series_id: str, payload: SeriesPatch) -> Series:
    changes = payload.model_dump(exclude_unset=True)

    def apply(series: Series) -> None:
        for key in changes:
            setattr(series, key, getattr(payload, key))

    return ctx.store.update_series(series_id, apply)


@router.delete("/series/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
def trash_series(ctx: Ctx, series_id: str) -> None:
    ctx.trash.delete_series(series_id)


@router.post("/series/{series_id}/restore", response_model=Series)
def restore_series(ctx: Ctx, series_id: str) -> Series:
    ctx.trash.restore_series(series_id)
    return ctx.store.get_series(series_id)


# ---------------------------------------------------------------- episodes
@router.get("/series/{series_id}/episodes")
def list_episodes(
    ctx: Ctx, series_id: str, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)
) -> dict:
    items, total = ctx.store.episode_summaries(series_id, offset, limit)
    return {"items": items, "total": total, "offset": offset, "limit": limit}


@router.post(
    "/series/{series_id}/episodes", response_model=Episode, status_code=status.HTTP_201_CREATED
)
def create_episode(ctx: Ctx, series_id: str, payload: EpisodeCreate) -> Episode:
    ctx.store.get_series(series_id)
    order = payload.order if payload.order is not None else ctx.store.next_episode_order(series_id)
    episode = Episode(
        series_id=series_id, title=payload.title, order=order, synopsis=payload.synopsis
    )
    return ctx.store.create_episode(episode)


@router.post(
    "/series/{series_id}/episodes/generate",
    response_model=Episode,
    status_code=status.HTTP_201_CREATED,
)
def generate_episode(ctx: Ctx, series_id: str, payload: GenerateEpisode) -> Episode:
    """One sentence → script via the LLM.  New characters / scenes are added to the bible."""
    series = ctx.store.get_series(series_id)
    bible, episode = A.generate_episode(
        series, payload.sentence, ctx.llm_factory(), ctx.store.next_episode_order(series_id)
    )

    def merge(s: Series) -> None:
        known_c = {c.id for c in s.bible.characters}
        known_l = {x.id for x in s.bible.locations}
        s.bible.characters += [c for c in bible.characters if c.id not in known_c]
        s.bible.locations += [x for x in bible.locations if x.id not in known_l]
        if not s.bible.styles:
            s.bible.styles = bible.styles

    ctx.store.update_series(series_id, merge)
    if payload.title:
        episode.title = payload.title
    return ctx.store.create_episode(episode)


@router.get("/episodes/{episode_id}", response_model=Episode)
def get_episode(ctx: Ctx, episode_id: str) -> Episode:
    return ctx.store.get_episode(episode_id)


@router.patch("/episodes/{episode_id}", response_model=Episode)
def patch_episode(ctx: Ctx, episode_id: str, payload: EpisodePatch) -> Episode:
    changes = payload.model_dump(exclude_unset=True, exclude={"revision"})

    def apply(ep: Episode) -> None:
        for key in changes:
            setattr(ep, key, getattr(payload, key))

    return ctx.store.update_episode(episode_id, apply, expected_revision=payload.revision)


@router.delete("/episodes/{episode_id}", status_code=status.HTTP_204_NO_CONTENT)
def trash_episode(ctx: Ctx, episode_id: str) -> None:
    ctx.trash.delete_episode(episode_id)


@router.post("/episodes/{episode_id}/restore")
def restore_episode(ctx: Ctx, episode_id: str) -> dict:
    return ctx.trash.restore_episode(episode_id)


# ------------------------------------------------------------------ panels
def _sequence(ep: Episode, ids: list[str]) -> None:
    by_id = {p.id: p for p in ep.panels}
    for i, pid in enumerate(ids):
        by_id[pid].order = i
    ep.panels = [by_id[pid] for pid in ids]


@router.post("/episodes/{episode_id}/panels", response_model=Episode, status_code=201)
def add_panel(ctx: Ctx, episode_id: str, payload: PanelCreate) -> Episode:
    def apply(ep: Episode) -> None:
        panel = Panel.model_validate({**payload.panel, "order": 0})
        ids = [p.id for p in ep.ordered_panels()]
        if panel.id in ids:
            raise ValueError(f"panel id already exists: {panel.id}")
        pos = ids.index(payload.after) + 1 if payload.after in ids else len(ids)
        ep.panels.append(panel)
        _sequence(ep, ids[:pos] + [panel.id] + ids[pos:])

    return ctx.store.update_episode(episode_id, apply)


@router.patch("/episodes/{episode_id}/panels/{panel_id}", response_model=Episode)
def patch_panel(ctx: Ctx, episode_id: str, panel_id: str, payload: PanelPatch) -> Episode:
    def apply(ep: Episode) -> None:
        panel = ep.panel(panel_id)
        if panel is None:
            raise NotFound(f"panel not found: {panel_id}")
        data = {**panel.model_dump(), **payload.changes, "id": panel.id, "order": panel.order}
        if isinstance(payload.changes.get("overrides"), dict):
            data["overrides"] = {**panel.overrides.model_dump(), **payload.changes["overrides"]}
        ep.panels[ep.panels.index(panel)] = Panel.model_validate(data)

    return ctx.store.update_episode(episode_id, apply, expected_revision=payload.revision)


@router.delete("/episodes/{episode_id}/panels/{panel_id}", response_model=Episode)
def delete_panel(ctx: Ctx, episode_id: str, panel_id: str) -> Episode:
    """Removes the panel; its takes stay in the episode (orphaned takes are hidden, not lost)."""

    def apply(ep: Episode) -> None:
        if ep.panel(panel_id) is None:
            raise NotFound(f"panel not found: {panel_id}")
        _sequence(ep, [p.id for p in ep.ordered_panels() if p.id != panel_id])

    return ctx.store.update_episode(episode_id, apply)


@router.post("/episodes/{episode_id}/panels/reorder", response_model=Episode)
def reorder_panels(ctx: Ctx, episode_id: str, payload: Reorder) -> Episode:
    def apply(ep: Episode) -> None:
        if sorted(payload.order) != sorted(p.id for p in ep.panels):
            raise ValueError("order must list every panel exactly once")
        _sequence(ep, payload.order)

    return ctx.store.update_episode(episode_id, apply, expected_revision=payload.revision)


@router.post("/episodes/{episode_id}/panels/{panel_id}/duplicate", response_model=Episode)
def duplicate_panel(ctx: Ctx, episode_id: str, panel_id: str) -> Episode:
    def apply(ep: Episode) -> None:
        src = ep.panel(panel_id)
        if src is None:
            raise NotFound(f"panel not found: {panel_id}")
        copy = Panel.model_validate({**src.model_dump(exclude={"id"}), "locked": False})
        ids = [p.id for p in ep.ordered_panels()]
        ep.panels.append(copy)
        pos = ids.index(panel_id) + 1
        _sequence(ep, ids[:pos] + [copy.id] + ids[pos:])

    return ctx.store.update_episode(episode_id, apply)


@router.get("/episodes/{episode_id}/panels/{panel_id}/prompt")
def panel_prompt(ctx: Ctx, episode_id: str, panel_id: str, variant_id: str | None = None) -> dict:
    """Compiled prompt in both dialects plus the automatically chosen reference images."""
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    panel = ep.panel(panel_id)
    if panel is None:
        raise NotFound(f"panel not found: {panel_id}")
    variant = next((v for v in series.variants if v.id == variant_id), None)
    refs = [r.to_json() for r in select_references(series.bible, panel)]
    return {**prompt_preview(series, ep, panel, variant), "references": refs}


# ------------------------------------------------------------------- takes
def _set_status(ctx, episode_id: str, take_id: str, status_: TakeStatus) -> Episode:
    def apply(ep: Episode) -> None:
        take = ep.take(take_id)
        if take is None:
            raise NotFound(f"take not found: {take_id}")
        if status_ == TakeStatus.adopted:
            for t in ep.takes:
                same = t.panel_id == take.panel_id and t.variant_id == take.variant_id
                if same and t.status == TakeStatus.adopted:
                    t.status = TakeStatus.candidate
            take.parameter_snapshot = {**take.parameter_snapshot, "adopted_by": "user"}
        take.status = status_

    return ctx.store.update_episode(episode_id, apply)


@router.post("/episodes/{episode_id}/takes/{take_id}/adopt", response_model=Episode)
def adopt_take(ctx: Ctx, episode_id: str, take_id: str) -> Episode:
    return _set_status(ctx, episode_id, take_id, TakeStatus.adopted)


@router.post("/episodes/{episode_id}/takes/{take_id}/reject", response_model=Episode)
def reject_take(ctx: Ctx, episode_id: str, take_id: str) -> Episode:
    return _set_status(ctx, episode_id, take_id, TakeStatus.rejected)


@router.post("/episodes/{episode_id}/takes/{take_id}/restore", response_model=Episode)
def restore_take(ctx: Ctx, episode_id: str, take_id: str) -> Episode:
    return _set_status(ctx, episode_id, take_id, TakeStatus.candidate)
