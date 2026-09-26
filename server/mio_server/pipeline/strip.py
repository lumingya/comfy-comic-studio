"""Strip canvas for v3 episodes: layout, lettering and rendering.

Layout honours each panel's strip attributes and keeps hand-edited geometry: panels with a box
in a ``manual`` strip keep it, and ``locked`` lettering layers are never regenerated.

Width modes: ``full`` edge to edge; ``bleed`` edge to edge *and* flush with its neighbours (the
gaps on both sides collapse); ``inset`` a framed panel of ``inset_scale`` × width aligned
left / centre / right; ``frameless`` no frame, all edges fading into the background track
(``backdrop``).  Bubble placement uses the face-avoiding placer (``layout.place_bubbles``);
cross-panel bubbles, SFX and vertical text live in ``lettering``.
"""

from __future__ import annotations

from PIL import Image, ImageDraw

from ..models import DialogueKind, Episode, LetteringLayer, PanelWidth, Series, Strip, parse_ratio
from . import backdrop as BD
from . import layout as LY
from . import lettering as LT

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


def panel_x(panel, strip: Strip) -> tuple[int, int]:
    W, m = strip.width, strip.margin
    if panel.width_mode in (PanelWidth.full, PanelWidth.bleed):
        return 0, W
    if panel.width_mode == PanelWidth.frameless:
        return m, W - m
    w = round(W * panel.inset_scale)
    if panel.inset_align == "left":
        x0 = m
    elif panel.inset_align == "right":
        x0 = W - m - w
    else:
        x0 = (W - w) // 2
    return x0, x0 + w


def panel_geometry(
    episode: Episode, strip: Strip, present: set[str], title: bool = True
) -> tuple[dict, int]:
    """Boxes (x0, y0, x1, y1) in strip pixels for every panel that has an image."""
    y = TITLE_SPACE if title else strip.margin
    boxes = {}
    panels = [p for p in episode.ordered_panels() if p.id in present]
    for i, panel in enumerate(panels):
        nxt = panels[i + 1] if i + 1 < len(panels) else None
        flush = nxt is not None and PanelWidth.bleed in (panel.width_mode, nxt.width_mode)
        gap = 0 if flush else panel.gap_after
        if strip.manual and panel.id in strip.panel_boxes:
            box = tuple(round(v) for v in strip.panel_boxes[panel.id])
            boxes[panel.id] = box
            y = max(y, box[3] + gap)
            continue
        x0, x1 = panel_x(panel, strip)
        h = round((x1 - x0) / parse_ratio(panel.aspect_ratio))
        boxes[panel.id] = (x0, y, x1, y + h)
        y += h + gap
    return boxes, y + END_SPACE


def _specs(panel, names: dict, prev_loc, vertical: bool) -> tuple[list[dict], list[dict]]:
    """``(in_panel, bridges)`` bubble specs for one panel."""
    specs, bridges = [], []
    if panel.location_id and panel.location_id != prev_loc and names.get(panel.location_id):
        specs.append({"kind": "caption", "text": names[panel.location_id], "speaker": None})
    for d in panel.dialogues:
        spec = {
            "kind": d.kind.value,
            "text": d.text,
            "speaker": None if d.kind == DialogueKind.narration else d.speaker_id,
            "vertical": vertical and d.kind != DialogueKind.sfx,
        }
        (bridges if d.bridge and d.kind != DialogueKind.sfx else specs).append(spec)
    return specs, bridges


def _layer(q: LY.Placement, style: LY.Style, bridge_to: str | None = None) -> LetteringLayer:
    kind = DialogueKind(q.kind)
    return LetteringLayer(
        panel_id=q.panel,
        kind=kind,
        text=q.text,
        speaker_id=q.speaker,
        box=tuple(float(v) for v in q.box),
        tail_to=tuple(float(v) for v in q.tail) if q.tail else None,
        font_size=style.caption_size if kind == DialogueKind.caption else None,
        vertical=q.vertical,
        bridge_to=bridge_to,
        style=LT.preset_style() if kind == DialogueKind.sfx else None,
    )


def _fit_sfx(q: LY.Placement, style: LY.Style) -> None:
    """Styled SFX are measured from their rendered glyphs, centred where the placer put them."""
    center = ((q.box[0] + q.box[2]) / 2, (q.box[1] + q.box[3]) / 2)
    box = LT.sfx_box(
        q.text, style.bold_path or style.font_path, style.font_size + 16, LT.preset_style(), center
    )
    q.box = tuple(round(v) for v in box)


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
    vertical = strip.text_direction == "vertical"
    prev_bottom, prev_loc = TITLE_SPACE - style.gutter, None
    names = {loc.id: loc.name for loc in series.bible.locations}
    panels = [p for p in episode.ordered_panels() if p.id in boxes]
    for i, panel in enumerate(panels):
        box = boxes[panel.id]
        specs, bridges = _specs(panel, names, prev_loc, vertical)
        panel_faces = LT.faces_for(panel, faces.get(panel.id))
        free = panel.id not in locked_panels
        if specs and free:
            placed = LY.place_bubbles(
                panel.id,
                box,
                specs,
                panel_faces,
                LY.EdgeMap(scaled[panel.id]),
                style,
                fonts,
                occupied,
                box[1] - prev_bottom,
                strip.width,
                rtl=vertical,
            )
            for q in placed:
                if q.kind == "sfx":
                    _fit_sfx(q, style)
                occupied.append(q.box)
                out.append(_layer(q, style))
        nxt = panels[i + 1] if i + 1 < len(panels) else None
        for spec in bridges if free else []:
            if nxt is None:  # last panel: nothing to bridge to, keep it inside
                q = LY.place_bubbles(
                    panel.id,
                    box,
                    [spec],
                    panel_faces,
                    None,
                    style,
                    fonts,
                    occupied,
                    0,
                    strip.width,
                    rtl=vertical,
                )[0]
            else:
                q = LT.place_bridge(
                    panel.id,
                    spec,
                    box,
                    boxes[nxt.id],
                    panel_faces,
                    occupied,
                    style,
                    fonts,
                    strip.width,
                )
            occupied.append(q.box)
            out.append(_layer(q, style, nxt.id if nxt else None))
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
    bg = strip.background if BD.HEX_RE.match(strip.background or "") else "#ffffff"
    canvas = Image.new("RGB", (strip.width, max(strip.height, 1)), bg)
    draw = ImageDraw.Draw(canvas)
    ordered = [p for p in episode.ordered_panels() if p.id in strip.panel_boxes and p.id in scaled]
    BD.paint_track(canvas, bg, ordered, strip.panel_boxes)
    for panel in ordered:
        box = tuple(round(v) for v in strip.panel_boxes[panel.id])
        im = scaled[panel.id]
        if panel.width_mode == PanelWidth.frameless:
            canvas.paste(im, box[:2], BD.frameless_mask(im.size))
        else:
            canvas.paste(im, box[:2])
        if panel.width_mode == PanelWidth.inset:
            draw.rectangle(box, outline="black", width=3)
    for layer in strip.lettering:
        LT.draw_layer(canvas, draw, layer, fonts, style)
    if series.title and TITLE_SPACE <= (
        min((b[1] for b in strip.panel_boxes.values()), default=TITLE_SPACE)
    ):
        tw = fonts["title"].getlength(episode.title or series.title)
        ty = (TITLE_SPACE - style.title_size) / 2 - 10
        draw.text(
            ((strip.width - tw) / 2, ty),
            episode.title or series.title,
            font=fonts["title"],
            fill=BD.ink_for(BD.color_at(canvas, round(ty))),
        )
    end = "— 完 —"
    ew = fonts["text"].getlength(end)
    ey = strip.height - END_SPACE / 2 - style.font_size / 2
    dark = BD.ink_for(BD.color_at(canvas, round(ey))) == "white"
    draw.text(
        ((strip.width - ew) / 2, ey),
        end,
        font=fonts["text"],
        fill=(200, 200, 200) if dark else (90, 90, 90),
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
