"""Episode copying and reordering, reusing the panel reference transformation."""

from ..models import Episode, new_id, now_iso
from ..storage import Conflict
from .common import check_locked, check_references, check_revision, sequence
from .models import EpisodeCopy, EpisodeCopyResult, EpisodeReorder
from .panels import clone_selection


def copy_episode(ctx, episode_id: str, command: EpisodeCopy) -> EpisodeCopyResult:
    with ctx.store.tx():
        source = ctx.store.get_episode(episode_id)
        check_revision(source, command.revision)
        selected = {panel.id for panel in source.panels}
        check_locked(source, selected, command.include_locked)
        if not command.include_locked and any(layer.locked for layer in source.strip.lettering):
            raise Conflict("episode contains locked lettering; set include_locked to copy")
        parts = clone_selection(source, selected, fresh_ids=True, include_global=True)
        panels, takes, layers, pmap, tmap, lmap, _, _ = parts
        result = source.model_copy(deep=True)
        result.id = new_id("episode")
        result.title = command.title or f"{source.title} (copy)"
        result.order = ctx.store.next_episode_order(source.series_id)
        result.revision = 0
        result.created_at = result.updated_at = now_iso()
        sequence(result, panels)
        result.takes = takes
        result.strip.panel_boxes = {pmap[k]: v for k, v in source.strip.panel_boxes.items()}
        result.strip.crops = {pmap[k]: v for k, v in source.strip.crops.items()}
        result.strip.lettering = layers
        check_references(result)
        ctx.store.create_episode(Episode.model_validate(result.model_dump()))
        return EpisodeCopyResult(
            episode=result,
            panel_ids=pmap,
            take_ids=tmap,
            lettering_ids=lmap,
            notes=[
                "Copied current panels, their takes, and the complete canvas with fresh IDs.",
                "Orphaned recovery takes and historical snapshots remain in the source episode.",
            ],
        )


def reorder_episodes(ctx, series_id: str, command: EpisodeReorder) -> list[Episode]:
    # Including the series owner protects extension jobs; each episode protects render jobs.
    with ctx.engine.operation_guard([series_id, *command.order]), ctx.store.tx() as db:
        episodes = ctx.store.list_episodes(series_id)
        by_id = {ep.id: ep for ep in episodes}
        if len(command.order) != len(set(command.order)) or set(command.order) != set(by_id):
            raise ValueError("order must list every active episode exactly once")
        if set(command.revisions) != set(by_id):
            raise ValueError("revisions must include every active episode exactly once")
        changed = []
        for index, eid in enumerate(command.order):
            episode = by_id[eid]
            check_revision(episode, command.revisions[eid])
            if episode.order != index:
                check_locked(episode, {p.id for p in episode.panels}, command.include_locked)
                episode.order = index
                changed.append(episode)
        # Park only the indexed sort keys, never the document/history. The outer transaction
        # and store lock keep this private; save_episode records exactly one real revision.
        for index, episode in enumerate(changed):
            db.execute(
                "UPDATE episodes SET episode_order = ? WHERE id = ?", (-index - 1, episode.id)
            )
        for episode in changed:
            ctx.store.save_episode(episode)
        return [by_id[eid] for eid in command.order]
