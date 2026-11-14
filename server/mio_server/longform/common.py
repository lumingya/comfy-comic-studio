"""Shared snapshot and reference checks. These functions never write or call a model."""

import hashlib
import json

from ..models import Episode, Series
from ..storage import Conflict


def check_revision(episode: Episode, expected: int) -> None:
    if episode.revision != expected:
        raise Conflict(
            f"episode {episode.id} changed (revision {episode.revision}, expected {expected})"
        )


def head(series: Series, episodes: list[Episode]) -> str:
    payload = [series.model_dump(mode="json"), [e.model_dump(mode="json") for e in episodes]]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def snapshot(store, series_id: str) -> tuple[Series, list[Episode]]:
    return store.get_series(series_id), store.list_episodes(series_id)


def check_references(ep: Episode) -> None:
    """Orphaned recovery takes are allowed; dangling pointers are never silently discarded."""
    panels = {p.id for p in ep.panels}
    takes = {t.id for t in ep.takes}
    layers = {layer.id for layer in ep.strip.lettering}
    if len(takes) != len(ep.takes) or len(layers) != len(ep.strip.lettering):
        raise ValueError("duplicate take or lettering id")
    for take in ep.takes:
        if take.parent_take_id and take.parent_take_id not in takes:
            raise ValueError(f"missing parent take: {take.parent_take_id}")
    for panel in ep.panels:
        for control in panel.controls:
            if control.source == "take" and control.take_id not in takes:
                raise ValueError(f"missing control take: {control.take_id}")
    if (set(ep.strip.panel_boxes) | set(ep.strip.crops)) - panels:
        raise ValueError("canvas refers to a missing panel")
    for layer in ep.strip.lettering:
        if (layer.panel_id and layer.panel_id not in panels) or (
            layer.bridge_to and layer.bridge_to not in panels
        ):
            raise ValueError(f"lettering {layer.id} refers to a missing panel")


def sequence(ep: Episode, panels) -> None:
    ep.panels = []
    for index, panel in enumerate(panels):
        panel.order = index
        ep.panels.append(panel)


def check_locked(ep: Episode, selected: set[str], include_locked: bool) -> None:
    if include_locked:
        return
    if any(p.locked and p.id in selected for p in ep.panels) or any(
        layer.locked and (layer.panel_id in selected or layer.bridge_to in selected)
        for layer in ep.strip.lettering
    ):
        raise Conflict("selection contains locked panels or lettering; set include_locked to edit")
