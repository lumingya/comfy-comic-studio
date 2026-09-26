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
    SeriesCard,
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


class PanelBatch(BaseModel):
    """Same ``changes`` applied to several panels in one revision (``overrides`` is merged)."""

    panel_ids: list[str]
    changes: dict[str, Any]
    # Text to add after each panel's own value (comma-joined) instead of replacing it;
    # keys are override fields such as ``append_prompt`` / ``negative_prompt``.
    append_text: dict[str, str] = Field(default_factory=dict)
    revision: int | None = None


class PanelIds(BaseModel):
    panel_ids: list[str]


class PanelImport(BaseModel):
    """Panels exported from this or another episode; ids are re-issued, order follows the list."""

    panels: list[dict[str, Any]]
    after: str | None = None


class PanelRestore(BaseModel):
    revision: int


class GenerateEpisode(BaseModel):
    sentence: str
    title: str | None = None


# ------------------------------------------------------------------ series
@router.get("/series", response_model=list[SeriesCard])
def list_series(ctx: Ctx, deleted: bool = False) -> list[SeriesCard]:
    stats = ctx.store.series_stats()
    cards = []
    for series in ctx.store.list_series(deleted=deleted):
        count, cover = stats.get(series.id, (0, None))
        cards.append(SeriesCard(**series.model_dump(), episode_count=count, cover_asset_id=cover))
    return cards


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
    filtered = ctx.hooks.filter(
        "script.generated",
        episode,
        series=ctx.store.get_series(series_id),
        sentence=payload.sentence,
    )
    if isinstance(filtered, Episode):
        episode = filtered
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


def _merged(panel: Panel, changes: dict[str, Any]) -> Panel:
    """``changes`` over ``panel``; id / order never change, ``overrides`` merges key by key."""
    data = {**panel.model_dump(), **changes, "id": panel.id, "order": panel.order}
    if isinstance(changes.get("overrides"), dict):
        data["overrides"] = {**panel.overrides.model_dump(), **changes["overrides"]}
    return Panel.model_validate(data)


@router.patch("/episodes/{episode_id}/panels/{panel_id}", response_model=Episode)
def patch_panel(ctx: Ctx, episode_id: str, panel_id: str, payload: PanelPatch) -> Episode:
    def apply(ep: Episode) -> None:
        panel = ep.panel(panel_id)
        if panel is None:
            raise NotFound(f"panel not found: {panel_id}")
        ep.panels[ep.panels.index(panel)] = _merged(panel, payload.changes)

    return ctx.store.update_episode(episode_id, apply, expected_revision=payload.revision)


@router.post("/episodes/{episode_id}/panels/batch", response_model=Episode)
def patch_panels(ctx: Ctx, episode_id: str, payload: PanelBatch) -> Episode:
    """Batch edit: one revision, every listed panel gets the same changes."""

    def apply(ep: Episode) -> None:
        wanted = set(payload.panel_ids)
        missing = wanted - {p.id for p in ep.panels}
        if missing:
            raise NotFound(f"panel not found: {sorted(missing)[0]}")

        def edit(panel: Panel) -> Panel:
            changes = dict(payload.changes)
            if payload.append_text:
                current = panel.overrides.model_dump()
                joined = {
                    key: ", ".join(x for x in (str(current.get(key) or ""), text) if x)
                    for key, text in payload.append_text.items()
                }
                overrides = changes.get("overrides")
                changes["overrides"] = {
                    **(overrides if isinstance(overrides, dict) else {}),
                    **joined,
                }
            return _merged(panel, changes)

        ep.panels = [edit(p) if p.id in wanted else p for p in ep.panels]

    return ctx.store.update_episode(episode_id, apply, expected_revision=payload.revision)


@router.post("/episodes/{episode_id}/panels/batch-delete", response_model=Episode)
def delete_panels(ctx: Ctx, episode_id: str, payload: PanelIds) -> Episode:
    def apply(ep: Episode) -> None:
        wanted = set(payload.panel_ids)
        _sequence(ep, [p.id for p in ep.ordered_panels() if p.id not in wanted])

    return ctx.store.update_episode(episode_id, apply)


@router.post("/episodes/{episode_id}/panels/import", response_model=Episode, status_code=201)
def import_panels(ctx: Ctx, episode_id: str, payload: PanelImport) -> Episode:
    def apply(ep: Episode) -> None:
        ids = [p.id for p in ep.ordered_panels()]
        pos = ids.index(payload.after) + 1 if payload.after in ids else len(ids)
        fresh = [
            Panel.model_validate({**{k: v for k, v in raw.items() if k != "id"}, "order": 0})
            for raw in payload.panels
        ]
        ep.panels.extend(fresh)
        _sequence(ep, ids[:pos] + [p.id for p in fresh] + ids[pos:])

    return ctx.store.update_episode(episode_id, apply)


@router.get("/episodes/{episode_id}/panels/{panel_id}/history")
def panel_history(ctx: Ctx, episode_id: str, panel_id: str) -> list[dict]:
    """Earlier saved versions of one panel (newest first, unchanged saves collapsed)."""
    ctx.store.get_episode(episode_id)
    out: list[dict] = []
    last: str | None = None
    for revision, created_at, snapshot in ctx.store.episode_snapshots(episode_id):
        panel = snapshot.panel(panel_id)
        if panel is None:
            continue
        fingerprint = panel.model_dump_json(exclude={"order"})
        if fingerprint == last:
            out[-1]["revision"] = revision  # same content: report the oldest revision it held
            continue
        last = fingerprint
        out.append(
            {
                "revision": revision,
                "created_at": created_at,
                "shot": panel.shot,
                "description": panel.description,
                "prompt": panel.overrides.append_prompt,
                "dialogue": panel.dialogues[0].text if panel.dialogues else "",
                "panel": panel.model_dump(),
            }
        )
    return out


@router.post("/episodes/{episode_id}/panels/{panel_id}/restore", response_model=Episode)
def restore_panel(ctx: Ctx, episode_id: str, panel_id: str, payload: PanelRestore) -> Episode:
    """Put the panel back to how it was at ``revision`` (position and id stay)."""
    older = next(
        (s for r, _, s in ctx.store.episode_snapshots(episode_id) if r == payload.revision), None
    )
    then = older.panel(panel_id) if older else None
    if then is None:
        raise NotFound(f"no saved version {payload.revision} of panel {panel_id}")

    def apply(ep: Episode) -> None:
        panel = ep.panel(panel_id)
        if panel is None:
            raise NotFound(f"panel not found: {panel_id}")
        ep.panels[ep.panels.index(panel)] = _merged(panel, then.model_dump(exclude={"id", "order"}))

    return ctx.store.update_episode(episode_id, apply)


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

    episode = ctx.store.update_episode(episode_id, apply)
    ctx.hooks.action(
        "take.status", {"episode_id": episode_id, "take_id": take_id, "status": status_.value}
    )
    return episode


@router.post("/episodes/{episode_id}/takes/{take_id}/adopt", response_model=Episode)
def adopt_take(ctx: Ctx, episode_id: str, take_id: str) -> Episode:
    return _set_status(ctx, episode_id, take_id, TakeStatus.adopted)


@router.post("/episodes/{episode_id}/takes/{take_id}/reject", response_model=Episode)
def reject_take(ctx: Ctx, episode_id: str, take_id: str) -> Episode:
    return _set_status(ctx, episode_id, take_id, TakeStatus.rejected)


@router.post("/episodes/{episode_id}/takes/{take_id}/restore", response_model=Episode)
def restore_take(ctx: Ctx, episode_id: str, take_id: str) -> Episode:
    return _set_status(ctx, episode_id, take_id, TakeStatus.candidate)
