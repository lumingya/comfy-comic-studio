"""Lettering beyond plain bubbles: SFX (拟声字), speaker anchors and cross-panel bubbles.

* SFX are drawn glyph by glyph onto a transparent layer (fill, stroke, letter spacing and a
  per-glyph effect: ``grow`` / ``shake`` / ``arc``), then rotated as a whole and centred on the
  layer box.  ``web/src/pages/canvas/sfx.ts`` implements the same glyph maths for the canvas.
* Without detected faces, tails aim at a head position estimated from the script
  (``PanelCharacter.position`` and the shot), and those estimates double as soft "don't cover"
  boxes for bubble placement.
* A dialogue with ``bridge`` straddles the gutter between its panel and the next one.
"""

from __future__ import annotations

import math

from PIL import Image, ImageDraw

from ..models import DialogueKind, LetteringLayer, LetterStyle
from . import layout as LY
from . import vertical as VT
from .composition import character_x

SFX_PRESETS: dict[str, dict] = {
    "impact": {
        "fill": "#e03131",
        "stroke": "#ffffff",
        "stroke_width": 6,
        "rotation": -8,
        "effect": "grow",
        "letter_spacing": 0,
    },
    "shake": {
        "fill": "#111111",
        "stroke": "#ffffff",
        "stroke_width": 5,
        "rotation": 0,
        "effect": "shake",
        "letter_spacing": 6,
    },
    "soft": {
        "fill": "#868e96",
        "stroke": "#ffffff",
        "stroke_width": 3,
        "rotation": 0,
        "effect": "none",
        "letter_spacing": 10,
    },
    "cute": {
        "fill": "#f06595",
        "stroke": "#ffffff",
        "stroke_width": 5,
        "rotation": 6,
        "effect": "arc",
        "letter_spacing": 2,
    },
    "horror": {
        "fill": "#212529",
        "stroke": "#c92a2a",
        "stroke_width": 3,
        "rotation": 0,
        "effect": "shake",
        "letter_spacing": 14,
    },
}
DEFAULT_SFX_PRESET = "impact"

HEAD_Y = {"extreme_close": 0.3, "close": 0.3, "medium": 0.24, "cowboy": 0.22, "full": 0.18}
HEAD_SIZE = {"extreme_close": 0.62, "close": 0.4, "medium": 0.24, "cowboy": 0.18, "full": 0.11}


def preset_style(name: str = DEFAULT_SFX_PRESET) -> LetterStyle:
    return LetterStyle(preset=name, **SFX_PRESETS.get(name, SFX_PRESETS[DEFAULT_SFX_PRESET]))


# ----------------------------------------------------------------------------- anchors
def estimated_faces(panel) -> list[dict]:
    """Normalized head boxes guessed from character positions (``estimated`` = True)."""
    cast = panel.characters
    if panel.shot == "wide" or not cast:
        return []
    out = []
    size = HEAD_SIZE.get(panel.shot, 0.2)
    for pc, x in zip(cast, character_x(panel)):
        y = HEAD_Y.get(panel.shot, 0.24)
        s = size * (0.7 if pc.position == "background" else 1.0)
        if pc.position == "background":
            y += 0.08
        out.append(
            {
                "character": pc.character_id,
                "estimated": True,
                "box": (
                    max(0.0, x - s * 0.4),
                    max(0.0, y - s * 0.5),
                    min(1.0, x + s * 0.4),
                    min(1.0, y + s * 0.5),
                ),
            }
        )
    return out


def faces_for(panel, detected: list[dict] | None) -> list[dict]:
    """Detected faces win; characters without a detected face get an estimated box."""
    detected = list(detected or [])
    have = {f.get("character") for f in detected if f.get("character")}
    return detected + [f for f in estimated_faces(panel) if f["character"] not in have]


def _anchor(face_box, panel_box) -> tuple[float, float]:
    px0, py0, px1, py1 = panel_box
    x1, y1, x2, y2 = face_box
    return px0 + (x1 + x2) / 2 * (px1 - px0), py0 + y1 * (py1 - py0)


# ----------------------------------------------------------------------------- bridges
def place_bridge(
    panel_id: str,
    spec: dict,
    box,
    next_box,
    faces: list[dict],
    occupied: list,
    style: LY.Style,
    fonts: dict,
    strip_width: int,
) -> LY.Placement:
    """A bubble centred on the gutter between ``box`` and ``next_box``, tail to the speaker."""
    lines, bw, bh, vertical = LY.measure(spec, style, fonts)
    cy = (box[3] + next_box[1]) / 2
    speaker = next((f for f in faces if f.get("character") == spec.get("speaker")), None)
    target = _anchor(speaker["box"], box) if speaker else None
    xs = [target[0]] if target else []
    xs += [strip_width * f for f in (0.5, 0.3, 0.7, 0.2, 0.8)]
    chosen = None
    for cx in xs:
        cx = min(max(cx, bw / 2 + 12), strip_width - bw / 2 - 12)
        cand = (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)
        if not any(LY._overlap(cand, o) > 0 for o in occupied):
            chosen = cand
            break
    chosen = tuple(round(v) for v in (chosen or cand))
    tail = None
    if spec["kind"] in ("speech", "thought"):
        cx, cy = (chosen[0] + chosen[2]) / 2, (chosen[1] + chosen[3]) / 2
        tx, ty = target or (cx - bw * 0.2, box[3] - 40)
        ty = min(ty, chosen[1] - 10) if ty < chosen[1] else ty
        dist = math.hypot(tx - cx, ty - cy) or 1
        reach = min(dist, bh / 2 + 80)
        tail = (round(cx + (tx - cx) * reach / dist), round(cy + (ty - cy) * reach / dist))
    return LY.Placement(
        panel_id,
        spec["kind"],
        spec["text"],
        lines,
        chosen,
        tail,
        spec.get("speaker"),
        0.0,
        vertical,
    )


# ----------------------------------------------------------------------------- SFX
def glyph_layout(text: str, size: int, style: LetterStyle, vertical: bool, advance) -> list[dict]:
    """Per-glyph ``{ch, size, x, y, angle}`` (centre coordinates, degrees clockwise).

    ``advance(ch, size)`` measures a glyph.  Mirrors ``glyphLayout`` in ``sfx.ts``.
    """
    chars = [c for c in text if not c.isspace()]
    n = len(chars)
    out, pos = [], 0.0
    for i, ch in enumerate(chars):
        t = i / (n - 1) if n > 1 else 0.5
        scale, angle, off = 1.0, 0.0, 0.0
        if style.effect == "grow":
            scale = 0.7 + 0.6 * t
        elif style.effect == "shake":
            sign = 1 if i % 2 else -1
            angle, off = 12.0 * sign, 0.12 * size * sign
        elif style.effect == "arc":
            u = 2 * t - 1
            off, angle = -0.45 * size * (1 - u * u), 18.0 * u
        s = max(6, round(size * scale))
        step = advance(ch, s) if not vertical else s * 1.02
        centre = pos + step / 2
        out.append(
            {
                "ch": ch,
                "size": s,
                "x": off if vertical else centre,
                "y": centre if vertical else off,
                "angle": angle,
            }
        )
        pos += step + style.letter_spacing
    total = pos - style.letter_spacing if chars else 0.0
    for g in out:  # centre the run on (0, 0)
        if vertical:
            g["y"] -= total / 2
        else:
            g["x"] -= total / 2
    return out


def render_sfx(
    text: str, font_path: str | None, size: int, style: LetterStyle, vertical: bool = False
) -> Image.Image:
    """Transparent RGBA image of the SFX, rotation applied, tightly cropped."""
    fonts: dict[int, object] = {}

    def font(s: int):
        if s not in fonts:
            fonts[s] = LY.load_font(font_path, s)
        return fonts[s]

    glyphs = glyph_layout(text, size, style, vertical, lambda ch, s: font(s).getlength(ch))
    pad = style.stroke_width + 4
    span = sum(g["size"] for g in glyphs) + abs(style.letter_spacing) * len(glyphs) + size * 2
    canvas = Image.new("RGBA", (round(span) + pad * 2, round(span) + pad * 2), (0, 0, 0, 0))
    ox, oy = canvas.width / 2, canvas.height / 2
    for g in glyphs:
        cell = round(g["size"] * 1.6) + pad * 2
        tile = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text(
            (cell / 2, cell / 2),
            g["ch"],
            font=font(g["size"]),
            fill=style.fill,
            anchor="mm",
            stroke_width=style.stroke_width,
            stroke_fill=style.stroke,
        )
        if g["angle"]:
            tile = tile.rotate(-g["angle"], resample=Image.BICUBIC)
        canvas.alpha_composite(tile, (round(ox + g["x"] - cell / 2), round(oy + g["y"] - cell / 2)))
    if style.rotation:
        canvas = canvas.rotate(-style.rotation, resample=Image.BICUBIC, expand=True)
    bbox = canvas.getbbox()
    return canvas.crop(bbox) if bbox else canvas


def sfx_box(text: str, font_path, size: int, style: LetterStyle, center, vertical=False):
    im = render_sfx(text, font_path, size, style, vertical)
    cx, cy = center
    return (cx - im.width / 2, cy - im.height / 2, cx + im.width / 2, cy + im.height / 2)


# ----------------------------------------------------------------------------- drawing
def draw_layer(
    canvas: Image.Image, draw: ImageDraw.ImageDraw, layer: LetteringLayer, fonts: dict, style
) -> None:
    x0, y0, x1, y1 = layer.box
    if layer.kind == DialogueKind.sfx:
        size = layer.font_size or style.font_size + 16
        im = render_sfx(
            layer.text,
            style.bold_path or style.font_path,
            size,
            layer.style or preset_style(),
            layer.vertical,
        )
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        canvas.paste(im, (round(cx - im.width / 2), round(cy - im.height / 2)), im)
        return
    font = LY.font_for(layer.kind.value, fonts)
    if layer.font_size and layer.font_size != font.size:
        font = LY.load_font(font.path if hasattr(font, "path") else None, layer.font_size)
        fonts = {**fonts, {"caption": "caption"}.get(layer.kind.value, "text"): font}
    vertical = layer.vertical and layer.kind != DialogueKind.caption
    if vertical:
        max_chars = max(2, int((y1 - y0 - 40) / (font.size * 1.05)))
        lines = VT.columns(layer.text, max_chars)
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
        vertical=vertical,
    )
    LY.draw_bubble(draw, q, fonts, style)
