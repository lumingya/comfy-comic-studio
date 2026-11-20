"""Pure, explicitly selected lettering placement over saved canvas geometry.

The normal bubble placer proposes a position; exact existing dimensions, cropped face boxes
and every other lettering layer then act as hard constraints. Nothing is persisted here.
"""

from __future__ import annotations

import math

from ..imaging import crop_box
from ..models import Episode, Strip
from . import layout as LY
from . import strip as SP


def _validate(episode: Episode, strip: Strip, layer_ids: list[str]) -> None:
    known = {panel.id for panel in episode.panels}
    if strip.height > 10_000_000 or any(
        abs(value) > 10_000_000 for box in strip.panel_boxes.values() for value in box
    ):
        raise ValueError("Canvas geometry is outside the supported range")
    if (set(strip.panel_boxes) | set(strip.crops)) - known:
        raise ValueError("Canvas contains unknown panels")
    if len(strip.lettering) > 512 or len(layer_ids) > 64:
        raise ValueError("Select at most 64 of at most 512 lettering layers")
    ids = [layer.id for layer in strip.lettering]
    if len(set(ids)) != len(ids) or len(set(layer_ids)) != len(layer_ids):
        raise ValueError("Lettering identifiers must be unique")
    if not layer_ids or set(layer_ids) - set(ids):
        raise ValueError("Select existing lettering layers")
    for layer in strip.lettering:
        values = [*layer.box, *(layer.tail_to or ())]
        if not all(math.isfinite(v) and abs(v) <= 10_000_000 for v in values):
            raise ValueError("Lettering coordinates must be finite canvas pixels")
        if layer.box[2] <= layer.box[0] or layer.box[3] <= layer.box[1]:
            raise ValueError("Lettering boxes must have positive dimensions")
        if layer.panel_id is not None and layer.panel_id not in known:
            raise ValueError("Lettering references an unknown panel")
        if layer.font_size is not None and not 1 <= layer.font_size <= 512:
            raise ValueError("Lettering font size is outside the supported range")
        if len(layer.text) > 10000:
            raise ValueError("Lettering text is too long")


def _faces(episode: Episode, strip: Strip, image_sizes: dict) -> tuple[dict, list]:
    by_panel, absolute = {}, []
    for panel_id, box in strip.panel_boxes.items():
        take = episode.adopted(panel_id)
        if take is None:
            continue
        width, height = image_sizes.get(panel_id, (take.width or 1, take.height or 1))
        if width <= 0 or height <= 0:
            raise ValueError("Invalid adopted image dimensions")
        crop = strip.crops.get(panel_id)
        if crop is None:
            raw = crop_box((width, height), (box[2] - box[0]) / (box[3] - box[1]))
            crop = raw[0] / width, raw[1] / height, raw[2] / width, raw[3] / height
        cx0, cy0, cx1, cy1 = crop
        if cx1 <= cx0 or cy1 <= cy0:
            raise ValueError("Image crop must have positive dimensions")
        for face in take.faces:
            if not all(math.isfinite(v) and 0 <= v <= 1 for v in face.box):
                raise ValueError("Face boxes must be finite normalized coordinates")
            x0, y0, x1, y1 = face.box
            if x1 <= x0 or y1 <= y0:
                raise ValueError("Face boxes must have positive dimensions")
            x0, x1 = max(x0, cx0), min(x1, cx1)
            y0, y1 = max(y0, cy0), min(y1, cy1)
            if x1 <= x0 or y1 <= y0:
                continue
            normalized = (
                (x0 - cx0) / (cx1 - cx0),
                (y0 - cy0) / (cy1 - cy0),
                (x1 - cx0) / (cx1 - cx0),
                (y1 - cy0) / (cy1 - cy0),
            )
            by_panel.setdefault(panel_id, []).append(
                {"box": normalized, "character": face.character_id}
            )
            absolute.append(
                tuple(
                    offset + value * span + padding
                    for value, offset, span, padding in zip(
                        normalized,
                        (box[0], box[1], box[0], box[1]),
                        (box[2] - box[0], box[3] - box[1]) * 2,
                        (-4, -4, 4, 4),
                        strict=True,
                    )
                )
            )
    return by_panel, absolute


def avoid_lettering(
    episode: Episode, strip: Strip, layer_ids: list[str], image_sizes: dict | None = None
) -> tuple[Strip, list[str]]:
    """Move only selected speech/thought layers; keep unresolved and unselected layers verbatim."""
    _validate(episode, strip, layer_ids)
    output = strip.model_copy(deep=True)
    by_panel, faces = _faces(episode, strip, image_sizes or {})
    occupied = {layer.id: layer.box for layer in strip.lettering}
    selected = set(layer_ids)
    unresolved = []
    for layer in output.lettering:
        if layer.id not in selected:
            continue
        panel = strip.panel_boxes.get(layer.panel_id or "")
        if panel is None or layer.bridge_to or layer.kind not in ("speech", "thought"):
            unresolved.append(layer.id)
            continue
        obstacles = [box for key, box in occupied.items() if key != layer.id] + faces
        width, height = layer.box[2] - layer.box[0], layer.box[3] - layer.box[1]

        def safe(box):
            return (
                0 <= box[0] < box[2] <= strip.width
                and 0 <= box[1] < box[3] <= strip.height
                and panel[0] <= box[0]
                and box[2] <= panel[2]
                and panel[1] <= box[1]
                and box[3] <= panel[3]
                and not any(LY._overlap(box, other) > 0 for other in obstacles)
            )

        if safe(layer.box):
            continue
        style = LY.Style(width=strip.width, font_size=layer.font_size or 27)
        proposal = LY.place_bubbles(
            layer.panel_id,
            panel,
            [
                {
                    "kind": layer.kind.value,
                    "text": layer.text,
                    "speaker": layer.speaker_id,
                    "vertical": layer.vertical,
                }
            ],
            by_panel.get(layer.panel_id, []),
            None,
            style,
            SP._fonts(style),
            list(occupied.values()),
            0,
            strip.width,
            rtl=layer.vertical,
        )[0]
        left, top = panel[0], panel[1]
        right, bottom = panel[2] - width, panel[3] - height
        if right < left or bottom < top:
            unresolved.append(layer.id)
            continue
        candidates = [(proposal.box[0], proposal.box[1])]
        candidates.extend(
            (left + (right - left) * x / 16, top + (bottom - top) * y / 16)
            for y in range(17)
            for x in range(17)
        )
        candidates.sort(key=lambda p: (p[0] - proposal.box[0]) ** 2 + (p[1] - proposal.box[1]) ** 2)
        placed = next(
            (
                (x, y, x + width, y + height)
                for x, y in candidates
                if safe((x, y, x + width, y + height))
            ),
            None,
        )
        if placed is None:
            unresolved.append(layer.id)
            continue
        dx, dy = placed[0] - layer.box[0], placed[1] - layer.box[1]
        layer.box = placed
        if layer.tail_to:
            layer.tail_to = layer.tail_to[0] + dx, layer.tail_to[1] + dy
        occupied[layer.id] = placed
    return output, unresolved
