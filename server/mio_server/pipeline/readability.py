"""Readability report for a laid-out strip (ROADMAP §5: bubbles never cover faces, readable).

Checks, all geometric and cheap enough to run after every layout:

* ``missing``      – dialogue lines without a lettering layer;
* ``face_hits``    – bubbles covering more than 5 % of their area with a detected face;
* ``overlaps``     – pairs of lettering layers that overlap each other;
* ``order``        – consecutive bubbles of a panel that read backwards (next one clearly above);
* ``outside``      – layers leaving the strip;
* ``cut``          – layers a slice boundary would cut through.
"""

from __future__ import annotations

from ..models import DialogueKind, Episode, Strip
from . import layout as LY
from . import strip as SP

FACE_LIMIT = 0.05


def _face_boxes(panel_box, faces: list[dict]) -> list[tuple]:
    x0, y0, x1, y1 = panel_box
    w, h = x1 - x0, y1 - y0
    return [
        (x0 + f["box"][0] * w, y0 + f["box"][1] * h, x0 + f["box"][2] * w, y0 + f["box"][3] * h)
        for f in faces
        if not f.get("estimated")
    ]


def report(
    episode: Episode, strip: Strip, faces: dict | None = None, slice_height: int = 1280
) -> dict:
    faces = faces or {}
    layers = strip.lettering
    placed = {}
    for layer in layers:
        placed.setdefault((layer.panel_id, layer.text), 0)
        placed[(layer.panel_id, layer.text)] += 1
    missing = []
    for panel in episode.ordered_panels():
        if panel.id not in strip.panel_boxes:
            continue
        for d in panel.dialogues:
            key = (panel.id, d.text)
            if placed.get(key, 0) > 0:
                placed[key] -= 1
            else:
                missing.append({"panel_id": panel.id, "text": d.text})
    face_hits, overlaps, order, outside = [], [], [], []
    for i, layer in enumerate(layers):
        box = layer.box
        area = LY._area(box) or 1
        pbox = strip.panel_boxes.get(layer.panel_id or "")
        if pbox and layer.kind != DialogueKind.sfx:
            hit = sum(LY._overlap(box, f) for f in _face_boxes(pbox, faces.get(layer.panel_id, [])))
            if hit / area > FACE_LIMIT:
                face_hits.append({"layer_id": layer.id, "ratio": round(hit / area, 3)})
        for other in layers[i + 1 :]:
            if LY._overlap(box, other.box) > 0.02 * min(area, LY._area(other.box) or 1):
                overlaps.append([layer.id, other.id])
        if box[0] < 0 or box[2] > strip.width or box[1] < 0 or box[3] > strip.height:
            outside.append(layer.id)
    by_panel: dict[str, list] = {}
    for layer in layers:
        if layer.kind in (DialogueKind.speech, DialogueKind.thought, DialogueKind.narration):
            by_panel.setdefault(layer.panel_id or "", []).append(layer)
    for group in by_panel.values():
        for a, b in zip(group, group[1:]):
            if (b.box[1] + b.box[3]) / 2 < a.box[1] - 4:  # next bubble entirely above the start
                order.append([a.id, b.id])
    cuts = SP.cut_points(strip, slice_height)
    cut = [l.id for l in layers if any(l.box[1] < y < l.box[3] for y in cuts)]
    problems = len(missing) + len(face_hits) + len(overlaps) + len(order) + len(outside) + len(cut)
    return {
        "panels": len(strip.panel_boxes),
        "layers": len(layers),
        "missing": missing,
        "face_hits": face_hits,
        "overlaps": overlaps,
        "order": order,
        "outside": outside,
        "cut": cut,
        "problems": problems,
        "readable": problems == 0,
    }
