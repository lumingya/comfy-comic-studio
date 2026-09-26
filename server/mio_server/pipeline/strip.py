"""Strip canvas for v3 episodes: layout, lettering and rendering.

Layout honours each panel's strip attributes (width mode, aspect ratio, gap after, transition
background) and keeps hand-edited geometry: panels with a box in a ``manual`` strip keep it, and
``locked`` lettering layers are never regenerated.  Bubble placement reuses the spike's
face-avoiding placer (``layout.place_bubbles``); drawing reuses ``layout.draw_bubble``.
"""

from __future__ import annotations

from PIL import Image, ImageDraw

from ..models import DialogueKind, Episode, LetteringLayer, PanelWidth, Series, Strip, parse_ratio
from . import layout as LY

TITLE_SPACE = 170
END_SPACE = 220


def _crop(im: Image.Image, ratio: float, crop: tuple | None) -> Image.Image:
    if crop:
        x1, y1, x2, y2 = crop
        return im.crop(
            (
                round(x1 * im.width),
                round(y1 * im.height),
                round(x2 * im.width),
                round(y2 * im.height),
            )
        )
    from ..imaging import crop_box

    return im.crop(crop_box(im.size, ratio))


def _fonts(style: LY.Style) -> dict:
    return {
        "text": LY.load_font(style.font_path, style.font_size),
        "caption": LY.load_font(style.bold_path or style.font_path, style.caption_size),
        "title": LY.load_font(style.bold_path or style.font_path, style.title_size),
        "sfx": LY.load_font(style.bold_path or style.font_path, style.font_size + 16),
    }


def panel_geometry(
    episode: Episode, strip: Strip, present: set[str], title: bool = True
) -> tuple[dict, int]:
    """Boxes (x0, y0, x1, y1) in strip pixels for every panel that has an image."""
    W, m = strip.width, strip.margin
    y = TITLE_SPACE if title else m
    boxes = {}
    for panel in episode.ordered_panels():
        if panel.id not in present:
            continue
        if strip.manual and panel.id in strip.panel_boxes:
            box = tuple(round(v) for v in strip.panel_boxes[panel.id])
            boxes[panel.id] = box
            y = max(y, box[3] + panel.gap_after)
            continue
        if panel.width_mode in (PanelWidth.full, PanelWidth.bleed):
            x0, x1 = 0, W
        elif panel.width_mode == PanelWidth.inset:
            x0, x1 = m * 3, W - m * 3
        else:  # frameless
            x0, x1 = m, W - m
        h = round((x1 - x0) / parse_ratio(panel.aspect_ratio))
        boxes[panel.id] = (x0, y, x1, y + h)
        y += h + (
            0 if panel.width_mode == PanelWidth.bleed and panel.gap_after == 0 else panel.gap_after
        )
    return boxes, y + END_SPACE


def _paint_background(draw: ImageDraw.ImageDraw, spec: str, box: tuple[int, int, int, int]) -> None:
    """``#rrggbb`` solid, or ``#top>#bottom`` vertical gradient; ``transparent`` = strip colour."""
    if not spec or spec == "transparent":
        return
    x0, y0, x1, y1 = box
    if ">" in spec:
        a, b = (Image.new("RGB", (1, 1), c.strip()).getpixel((0, 0)) for c in spec.split(">", 1))
        span = max(1, y1 - y0)
        for i in range(span):
            t = i / span
            draw.line(
                [(x0, y0 + i), (x1, y0 + i)],
                fill=tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3)),
            )
    else:
        draw.rectangle(box, fill=spec)


def auto_lettering(
    series: Series,
    episode: Episode,
    strip: Strip,
    boxes: dict,
    scaled: dict,
    faces: dict[str, list[dict]],
    style: LY.Style,
) -> list[LetteringLayer]:
    fonts = _fonts(style)
    kept = [l for l in strip.lettering if l.locked]
    occupied = [tuple(l.box) for l in kept]
    locked_panels = {l.panel_id for l in kept}
    out = list(kept)
    prev_bottom, prev_loc = TITLE_SPACE - style.gutter, None
    names = {loc.id: loc.name for loc in series.bible.locations}
    for panel in episode.ordered_panels():
        box = boxes.get(panel.id)
        if box is None:
            continue
        specs = []
        if panel.location_id and panel.location_id != prev_loc and names.get(panel.location_id):
            specs.append({"kind": "caption", "text": names[panel.location_id], "speaker": None})
        for d in panel.dialogues:
            specs.append(
                {
                    "kind": d.kind.value,
                    "text": d.text,
                    "speaker": None if d.kind == DialogueKind.narration else d.speaker_id,
                }
            )
        if specs and panel.id not in locked_panels:
            edges = LY.EdgeMap(scaled[panel.id])
            placed = LY.place_bubbles(
                panel.id,
                box,
                specs,
                faces.get(panel.id, []),
                edges,
                style,
                fonts,
                occupied,
                box[1] - prev_bottom,
                strip.width,
            )
            for q in placed:
                occupied.append(q.box)
                out.append(
                    LetteringLayer(
                        panel_id=panel.id,
                        kind=DialogueKind(q.kind),
                        text=q.text,
                        speaker_id=q.speaker,
                        box=tuple(float(v) for v in q.box),
                        tail_to=tuple(float(v) for v in q.tail) if q.tail else None,
                        font_size=None if q.kind != "caption" else style.caption_size,
                    )
                )
        prev_bottom, prev_loc = box[3], panel.location_id or prev_loc
    return out


def layout(
    series: Series,
    episode: Episode,
    images: dict[str, Image.Image],
    faces: dict | None = None,
    style: LY.Style | None = None,
    relayout_lettering: bool = True,
) -> tuple[Strip, dict]:
    """Compute a new :class:`Strip` (boxes, crops, lettering).  ``images``: panel id → PIL image."""
    style = style or LY.Style(width=episode.strip.width)
    strip = episode.strip.model_copy(deep=True)
    boxes, height = panel_geometry(episode, strip, set(images), title=bool(series.title))
    scaled = {}
    for panel in episode.ordered_panels():
        if panel.id in boxes:
            x0, y0, x1, y1 = boxes[panel.id]
            im = _crop(images[panel.id], (x1 - x0) / max(1, y1 - y0), strip.crops.get(panel.id))
            scaled[panel.id] = im.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    strip.panel_boxes = {pid: tuple(float(v) for v in b) for pid, b in boxes.items()}
    strip.height = height
    if relayout_lettering:
        strip.lettering = auto_lettering(series, episode, strip, boxes, scaled, faces or {}, style)
    return strip, scaled


def render(
    series: Series,
    episode: Episode,
    strip: Strip,
    scaled: dict[str, Image.Image],
    style: LY.Style | None = None,
) -> Image.Image:
    style = style or LY.Style(width=strip.width)
    fonts = _fonts(style)
    canvas = Image.new("RGB", (strip.width, max(strip.height, 1)), strip.background)
    draw = ImageDraw.Draw(canvas)
    ordered = [p for p in episode.ordered_panels() if p.id in strip.panel_boxes and p.id in scaled]
    for i, panel in enumerate(ordered):
        box = tuple(round(v) for v in strip.panel_boxes[panel.id])
        if i + 1 < len(ordered):
            nxt = tuple(round(v) for v in strip.panel_boxes[ordered[i + 1].id])
            if nxt[1] > box[3]:
                _paint_background(
                    draw, panel.transition_background, (0, box[3], strip.width, nxt[1])
                )
        im = scaled[panel.id]
        if panel.width_mode == PanelWidth.frameless:
            mask = Image.new("L", im.size, 255)
            fade = max(8, im.height // 12)
            md = ImageDraw.Draw(mask)
            for k in range(fade):
                md.line([(0, k), (im.width, k)], fill=round(255 * k / fade))
                md.line(
                    [(0, im.height - 1 - k), (im.width, im.height - 1 - k)],
                    fill=round(255 * k / fade),
                )
            canvas.paste(im, box[:2], mask)
        else:
            canvas.paste(im, box[:2])
        if panel.width_mode == PanelWidth.inset:
            draw.rectangle(box, outline="black", width=3)
    for layer in strip.lettering:
        font = {DialogueKind.caption: fonts["caption"], DialogueKind.sfx: fonts["sfx"]}.get(
            layer.kind, fonts["text"]
        )
        x0, y0, x1, y1 = layer.box
        if layer.vertical:
            lines = ["\n".join(layer.text)]
        else:
            pad = 44 if layer.kind in (DialogueKind.speech, DialogueKind.thought) else 24
            lines = LY.wrap(layer.text, font, max(40, x1 - x0 - pad))
        q = LY.Placement(
            layer.panel_id or "",
            layer.kind.value,
            layer.text,
            lines,
            tuple(round(v) for v in layer.box),
            tuple(round(v) for v in layer.tail_to) if layer.tail_to else None,
            layer.speaker_id,
        )
        LY.draw_bubble(draw, q, fonts, style)
    if series.title and TITLE_SPACE <= (
        min((b[1] for b in strip.panel_boxes.values()), default=TITLE_SPACE)
    ):
        tw = fonts["title"].getlength(episode.title or series.title)
        draw.text(
            ((strip.width - tw) / 2, (TITLE_SPACE - style.title_size) / 2 - 10),
            episode.title or series.title,
            font=fonts["title"],
            fill="black",
        )
    end = "— 完 —"
    ew = fonts["text"].getlength(end)
    draw.text(
        ((strip.width - ew) / 2, strip.height - END_SPACE / 2 - style.font_size / 2),
        end,
        font=fonts["text"],
        fill=(90, 90, 90),
    )
    return canvas


def cut_points(strip: Strip, height: int) -> list[int]:
    """Slice boundaries ≤ ``height`` apart, preferring gutters and never cutting a bubble."""
    fake = LY.StripResult(
        Image.new("RGB", (1, max(1, strip.height))),
        [
            LY.Placement("", "speech", "", [], tuple(round(v) for v in l.box))
            for l in strip.lettering
        ],
        {k: tuple(round(v) for v in b) for k, b in strip.panel_boxes.items()},
    )
    return LY.cut_points(fake, height)
