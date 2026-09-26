"""Strip backgrounds: transition gradients, the continuous background track and frameless fades.

A panel's ``transition_background`` colours the gap *after* it: ``transparent`` (strip colour),
``#rrggbb`` (solid) or ``#a>#b>#c`` (vertical gradient with any number of stops).  Behind each
panel the track blends from the colour the previous gap ended with to the colour the next gap
starts with, so inset and frameless panels sit on a background that flows from one transition
into the next instead of snapping back to white.
"""

from __future__ import annotations

import re

from PIL import Image, ImageDraw, ImageFilter

RGB = tuple[int, int, int]
HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def parse_color(value: str) -> RGB:
    value = value.strip()
    if not HEX_RE.match(value):
        raise ValueError(f"颜色必须是 #rgb 或 #rrggbb：{value!r}")
    if len(value) == 4:
        value = "#" + "".join(c * 2 for c in value[1:])
    return tuple(int(value[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def parse_stops(spec: str | None) -> list[RGB] | None:
    """``None`` for transparent; otherwise one or more colour stops."""
    if not spec or spec.strip() in ("", "transparent"):
        return None
    return [parse_color(part) for part in spec.split(">")]


def valid_spec(spec: str) -> bool:
    try:
        parse_stops(spec)
    except ValueError:
        return False
    return True


def _mix(a: RGB, b: RGB, t: float) -> RGB:
    return tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3))  # type: ignore[return-value]


def sample(stops: list[RGB], t: float) -> RGB:
    """Colour at ``t`` (0 top … 1 bottom) of evenly spaced stops."""
    if len(stops) == 1:
        return stops[0]
    t = min(1.0, max(0.0, t)) * (len(stops) - 1)
    i = min(int(t), len(stops) - 2)
    return _mix(stops[i], stops[i + 1], t - i)


def gradient_image(stops: list[RGB], size: tuple[int, int]) -> Image.Image:
    w, h = max(1, size[0]), max(1, size[1])
    if len(stops) == 1:
        return Image.new("RGB", (w, h), stops[0])
    column = Image.new("RGB", (1, h))
    px = column.load()
    for y in range(h):
        px[0, y] = sample(stops, y / max(1, h - 1))
    return column.resize((w, h), Image.NEAREST)


def paint(canvas: Image.Image, stops: list[RGB] | None, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = (round(v) for v in box)
    if stops is None or x1 <= x0 or y1 <= y0:
        return
    canvas.paste(gradient_image(stops, (x1 - x0, y1 - y0)), (x0, y0))


def paint_track(canvas: Image.Image, background: str, panels: list, boxes: dict) -> None:
    """Paint every gap and the band behind each panel.  ``panels`` in reading order."""
    base = parse_color(background) if HEX_RE.match(background or "") else (255, 255, 255)
    width = canvas.width
    before: RGB = base  # colour the previous gap ended with
    for i, panel in enumerate(panels):
        x0, y0, x1, y1 = (round(v) for v in boxes[panel.id])
        stops = parse_stops(panel.transition_background)
        gap_top = stops[0] if stops else base
        if before != base or gap_top != base:
            paint(canvas, [before, gap_top], (0, y0, width, y1))
        gap_end = canvas.height if i + 1 == len(panels) else round(boxes[panels[i + 1].id][1])
        if stops and gap_end > y1:
            paint(canvas, stops, (0, y1, width, gap_end))
        before = stops[-1] if stops else base


def color_at(canvas: Image.Image, y: int) -> RGB:
    return canvas.getpixel((0, min(max(0, y), canvas.height - 1)))[:3]


def ink_for(rgb: RGB) -> str:
    """Readable text colour on a background (relative luminance)."""
    lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    return "black" if lum > 140 else "white"


def frameless_mask(size: tuple[int, int], fade: int | None = None) -> Image.Image:
    """Alpha mask that fades all four edges, so a frameless panel dissolves into the track."""
    w, h = size
    fade = fade or max(8, min(w, h) // 10)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rectangle((fade, fade, w - 1 - fade, h - 1 - fade), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(fade / 2))
