"""Atomic cross-episode transfers, preserving artwork, references and manual whitespace."""

from contextlib import nullcontext
from math import ceil

from ..models import Episode, new_id
from ..storage import Conflict, NotFound
from .common import check_locked, check_references, check_revision, sequence
from .models import PanelTransfer, TransferResult


def _bridges(source, selected, *, moving, break_bridges, include_global=False):
    """Return explicit disconnections; the caller mutates only its private snapshot."""
    ordered = source.ordered_panels()
    outgoing, incoming, layers = [], [], []
    for index, panel in enumerate(ordered):
        next_id = ordered[index + 1].id if index + 1 < len(ordered) else None
        if (panel.id in selected) != (next_id in selected):
            if any(d.bridge for d in panel.dialogues):
                (outgoing if panel.id in selected else incoming).append(panel.id)
    for layer in source.strip.lettering:
        owned = layer.panel_id in selected or (include_global and layer.panel_id is None)
        if layer.bridge_to and owned != (layer.bridge_to in selected):
            if moving or layer.panel_id in selected:
                layers.append(layer.id)
    if (outgoing or (moving and incoming) or layers) and not break_bridges:
        raise Conflict("selection splits cross-panel bubbles; select both panels or break_bridges")
    return outgoing, incoming if moving else [], layers


def _closure(source, selected, *, moving):
    takes = {take.id for take in source.takes if take.panel_id in selected}
    for take in source.takes:
        if take.id in takes and take.parent_take_id and take.parent_take_id not in takes:
            raise Conflict("selected take depends on a parent outside the selected panels")
        if moving and take.id not in takes and take.parent_take_id in takes:
            raise Conflict("a remaining take depends on a selected take")
    for panel in source.panels:
        for control in panel.controls:
            if control.source != "take":
                continue
            if panel.id in selected and control.take_id not in takes:
                raise Conflict("selected control depends on a take outside the selected panels")
            if moving and panel.id not in selected and control.take_id in takes:
                raise Conflict("a remaining panel control depends on a selected take")
    return takes


def clone_selection(source, selected, *, fresh_ids, break_bridges=False, include_global=False):
    """Pure clone shared by panel transfer and episode duplication."""
    check_references(source)
    take_set = _closure(source, selected, moving=not fresh_ids)
    outgoing, incoming, split_layers = _bridges(
        source,
        selected,
        moving=not fresh_ids,
        break_bridges=break_bridges,
        include_global=include_global,
    )
    panels = [p.model_copy(deep=True) for p in source.ordered_panels() if p.id in selected]
    takes = [t.model_copy(deep=True) for t in source.takes if t.id in take_set]
    layers = [
        layer.model_copy(deep=True)
        for layer in source.strip.lettering
        if layer.panel_id in selected or (include_global and layer.panel_id is None)
    ]
    panel_map = {p.id: new_id("panel") if fresh_ids else p.id for p in panels}
    take_map = {t.id: new_id("take") if fresh_ids else t.id for t in takes}
    layer_map = {layer.id: new_id("letter") if fresh_ids else layer.id for layer in layers}
    for panel in panels:
        if panel.id in outgoing:
            for dialogue in panel.dialogues:
                dialogue.bridge = False
        panel.id = panel_map[panel.id]
        for control in panel.controls:
            if control.source == "take":
                control.take_id = take_map[control.take_id]
    for take in takes:
        take.id, take.panel_id = take_map[take.id], panel_map[take.panel_id]
        if take.parent_take_id:
            take.parent_take_id = take_map[take.parent_take_id]
        if fresh_ids:
            # The immutable snapshot still documents provenance; a copy is not a job result.
            take.job_id = None
    for layer in layers:
        if layer.id in split_layers:
            layer.bridge_to = None
        layer.id = layer_map[layer.id]
        if layer.panel_id:
            layer.panel_id = panel_map[layer.panel_id]
        if layer.bridge_to:
            layer.bridge_to = panel_map[layer.bridge_to]
    return panels, takes, layers, panel_map, take_map, layer_map, incoming, split_layers


def _offset_box(box, offset):
    return box[0], box[1] + offset, box[2], box[3] + offset


def append_layout(source, target, layers, panel_map):
    boxes = {panel_map[k]: box for k, box in source.strip.panel_boxes.items() if k in panel_map}
    geometry = [*boxes.values(), *(layer.box for layer in layers)]
    if geometry and source.strip.width != target.strip.width:
        raise Conflict("canvas widths differ; matching widths are required to preserve layout")
    offset = 0
    if geometry:
        existing = [*target.strip.panel_boxes.values(), *(x.box for x in target.strip.lettering)]
        bottom = max([target.strip.height, *(box[3] for box in existing)], default=0)
        offset = bottom + target.strip.margin - min(box[1] for box in geometry)
        boxes = {key: _offset_box(box, offset) for key, box in boxes.items()}
        for layer in layers:
            layer.box = _offset_box(layer.box, offset)
            if layer.tail_to:
                layer.tail_to = (layer.tail_to[0], layer.tail_to[1] + offset)
        target.strip.height = max(
            target.strip.height,
            ceil(max(box[3] for box in geometry) + offset + target.strip.margin),
        )
    target.strip.panel_boxes.update(boxes)
    target.strip.crops.update(
        {panel_map[key]: box for key, box in source.strip.crops.items() if key in panel_map}
    )
    target.strip.lettering.extend(layers)
    if boxes:
        target.strip.manual = target.strip.manual or source.strip.manual
    return offset


def transfer_panels(ctx, series_id: str, command: PanelTransfer) -> TransferResult:
    if command.source_episode_id == command.target_episode_id:
        raise ValueError("use the existing panel reorder/duplicate API within one episode")
    selected = set(command.panel_ids)
    if len(selected) != len(command.panel_ids):
        raise ValueError("panel_ids must be unique")
    moving = command.mode == "move"
    owners = [series_id, command.source_episode_id, command.target_episode_id]
    guard = ctx.engine.operation_guard(owners) if moving else nullcontext()
    with guard, ctx.store.tx():
        source = ctx.store.get_episode(command.source_episode_id)
        target = ctx.store.get_episode(command.target_episode_id)
        if source.series_id != series_id or target.series_id != series_id:
            raise ValueError("cross-series transfers are not supported")
        ctx.store.get_series(series_id)
        check_revision(source, command.source_revision)
        check_revision(target, command.target_revision)
        missing = selected - {panel.id for panel in source.panels}
        if missing:
            raise NotFound(f"panel not found: {sorted(missing)[0]}")
        check_locked(source, selected, command.include_locked)
        check_references(target)
        parts = clone_selection(
            source, selected, fresh_ids=not moving, break_bridges=command.break_bridges
        )
        panels, takes, layers, pmap, tmap, lmap, incoming, split_layers = parts
        if set(pmap.values()) & {p.id for p in target.panels}:
            raise Conflict("target already contains a selected panel id")
        if set(tmap.values()) & {t.id for t in target.takes}:
            raise Conflict("target already contains a selected take id")
        if set(lmap.values()) & {layer.id for layer in target.strip.lettering}:
            raise Conflict("target already contains a selected lettering id")
        offset = append_layout(source, target, layers, pmap)
        sequence(target, [*target.ordered_panels(), *panels])
        target.takes.extend(takes)
        notes = [
            "Panels appended in source order; use panel reorder to change reading order.",
            "Transferred geometry is translated below the target canvas; crops and spacing remain.",
        ]
        if moving:
            # Clearing an incoming bridge changes its owner too, so its lock must be honored.
            check_locked(source, set(incoming), command.include_locked)
            if not command.include_locked and any(
                layer.locked and layer.id in split_layers for layer in source.strip.lettering
            ):
                raise Conflict("disconnecting the bridge would change locked lettering")
            for panel in source.panels:
                if panel.id in incoming:
                    for dialogue in panel.dialogues:
                        dialogue.bridge = False
            source.strip.lettering = [
                layer for layer in source.strip.lettering if layer.panel_id not in selected
            ]
            for layer in source.strip.lettering:
                if layer.id in split_layers:
                    layer.bridge_to = None
            source.strip.panel_boxes = {
                key: box for key, box in source.strip.panel_boxes.items() if key not in selected
            }
            source.strip.crops = {
                key: box for key, box in source.strip.crops.items() if key not in selected
            }
            sequence(source, [p for p in source.ordered_panels() if p.id not in selected])
            source.takes = [take for take in source.takes if take.id not in tmap]
            check_references(source)
            source = ctx.store.save_episode(Episode.model_validate(source.model_dump()))
            notes.append("Source canvas height and remaining artwork positions are unchanged.")
        if (
            split_layers
            or incoming
            or any(d.bridge for p in source.panels if p.id in selected for d in p.dialogues)
        ):
            if command.break_bridges:
                notes.append("Bubbles crossing the selection boundary were disconnected.")
        check_references(target)
        target = ctx.store.save_episode(Episode.model_validate(target.model_dump()))
        return TransferResult(
            source=source,
            target=target,
            panel_ids=pmap,
            take_ids=tmap,
            lettering_ids=lmap,
            layout_offset_y=offset,
            notes=notes,
        )
