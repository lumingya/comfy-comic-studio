"""Panel composition for ComfyUI: character regions, regional prompts and pose skeletons.

* ``regions`` – one normalized box per character from ``PanelCharacter.position`` (left /
  centre / right / foreground / background; unspecified characters spread evenly).
* ``region_prompt`` – the character's own prompt (identity tags, outfit, expression, action)
  for a ``[mio:region:N]`` text encoder; ``[mio:area:N]`` receives the box.
* ``pose_png`` – an OpenPose (COCO-18) skeleton per character on black, framed by the shot and
  posed by keywords in the action (sit / run / wave / point / cross arms), for
  ``[mio:control:pose]``.  Depth / canny / lineart need a real image (upload or existing take).
"""

from __future__ import annotations

import io

from PIL import Image, ImageDraw

from ..models import Panel, Series
from . import prompts as P
from .story import apply_variant, character_view

POSITION_X = {"left": 0.26, "center": 0.5, "right": 0.74, "foreground": 0.5, "background": 0.5}

# COCO-18 keypoints of a standing figure facing the viewer, in body-height units:
# x relative to the body centre (image left = the character's right), y from the head top.
STAND = {
    0: (0.0, 0.07),
    1: (0.0, 0.15),
    2: (-0.09, 0.16),
    3: (-0.12, 0.3),
    4: (-0.13, 0.43),
    5: (0.09, 0.16),
    6: (0.12, 0.3),
    7: (0.13, 0.43),
    8: (-0.055, 0.5),
    9: (-0.06, 0.72),
    10: (-0.06, 0.95),
    11: (0.055, 0.5),
    12: (0.06, 0.72),
    13: (0.06, 0.95),
    14: (-0.02, 0.055),
    15: (0.02, 0.055),
    16: (-0.045, 0.065),
    17: (0.045, 0.065),
}
POSES = {
    "sit": {9: (-0.1, 0.6), 10: (-0.1, 0.78), 12: (0.1, 0.6), 13: (0.1, 0.78)},
    "run": {
        3: (-0.15, 0.25),
        4: (-0.08, 0.2),
        6: (0.14, 0.32),
        7: (0.2, 0.38),
        9: (-0.1, 0.66),
        10: (-0.05, 0.82),
        12: (0.07, 0.74),
        13: (0.13, 0.93),
    },
    "wave": {6: (0.17, 0.1), 7: (0.2, -0.02)},
    "point": {3: (-0.2, 0.18), 4: (-0.32, 0.17)},
    "cross": {3: (-0.11, 0.3), 4: (0.05, 0.27), 6: (0.11, 0.3), 7: (-0.05, 0.28)},
}
POSE_WORDS = {
    "sit": ("坐", "sit", "sitting", "seated"),
    "run": ("跑", "奔", "run", "running", "dash"),
    "wave": ("挥手", "招手", "举手", "wave", "waving", "raise"),
    "point": ("指着", "指向", "point", "pointing"),
    "cross": ("抱臂", "抱胸", "双臂交叉", "crossed arms", "arms crossed"),
}
# Body height (× image height) and head-top position per shot: close shots crop the body.
FRAMING = {
    "close": (3.6, 0.08),
    "medium": (2.1, 0.08),
    "cowboy": (1.45, 0.07),
    "full": (0.84, 0.08),
    "wide": (0.45, 0.35),
}
LIMBS = [
    (1, 2),
    (1, 5),
    (2, 3),
    (3, 4),
    (5, 6),
    (6, 7),
    (1, 8),
    (8, 9),
    (9, 10),
    (1, 11),
    (11, 12),
    (12, 13),
    (1, 0),
    (0, 14),
    (14, 16),
    (0, 15),
    (15, 17),
]
COLORS = [
    (255, 0, 0),
    (255, 85, 0),
    (255, 170, 0),
    (255, 255, 0),
    (170, 255, 0),
    (85, 255, 0),
    (0, 255, 0),
    (0, 255, 85),
    (0, 255, 170),
    (0, 255, 255),
    (0, 170, 255),
    (0, 85, 255),
    (0, 0, 255),
    (85, 0, 255),
    (170, 0, 255),
    (255, 0, 255),
    (255, 0, 170),
    (255, 0, 85),
]
MIRROR = {2: 5, 3: 6, 4: 7, 8: 11, 9: 12, 10: 13, 14: 15, 16: 17}
MIRROR.update({v: k for k, v in list(MIRROR.items())})


def character_x(panel: Panel) -> list[float]:
    """Horizontal centre (0–1) of each character; stacked positions are pushed apart."""
    cast = panel.characters
    xs = []
    for i, pc in enumerate(cast):
        x = POSITION_X.get(pc.position, (i + 1) / (len(cast) + 1))
        if len(cast) > 1 and pc.position in ("center", "foreground", "background"):
            x = min(0.85, max(0.15, x + (i - (len(cast) - 1) / 2) * 0.08))
        xs.append(x)
    return xs


def regions(panel: Panel) -> list[dict]:
    """``[{character_id, position, box: (x0, y0, x1, y1)}]`` normalized to the canvas."""
    cast = panel.characters
    if not cast:
        return []
    width = min(0.62, max(0.34, 1.2 / len(cast)))
    out = []
    for pc, cx in zip(cast, character_x(panel)):
        w, y0, y1 = width, 0.0, 1.0
        if pc.position == "background":
            w, y0, y1 = width * 0.8, 0.0, 0.8
        elif pc.position == "foreground":
            w, y0 = min(0.7, width * 1.15), 0.1
        x0 = min(max(0.0, cx - w / 2), 1 - w)
        box = tuple(round(v, 3) for v in (x0, y0, x0 + w, y1))
        out.append({"character_id": pc.character_id, "position": pc.position, "box": box})
    return out


def area_value(box) -> dict:
    x0, y0, x1, y1 = box
    return {"x": x0, "y": y0, "width": round(x1 - x0, 3), "height": round(y1 - y0, 3)}


def region_prompt(series: Series, panel: Panel, index: int, dialect: str, variant=None) -> str:
    bible = apply_variant(series.bible, variant)
    pc = panel.characters[index]
    ch = bible.character(pc.character_id)
    view = character_view(ch) if ch else {"tags": [], "gender": "", "name": pc.character_id}
    outfit = list((ch.outfits.get(pc.outfit) if ch else None) or [])
    expression = pc.expression if pc.expression != "neutral" else ""
    if dialect == "natural":
        parts = [P.display_name(view) if ch else pc.character_id, view.get("description", "")]
        parts += [", ".join(outfit), expression, pc.action]
        return ", ".join(p for p in parts if p)
    tags = P.count_tags([view["gender"]] if view.get("gender") else [])
    tags += view["tags"] + outfit + list(pc.tags) + [t for t in (expression, pc.action) if t]
    return ", ".join(P.escape_tag(t) for t in P.dedupe(tags))


def pose_of(action: str) -> str:
    low = (action or "").lower()
    return next((k for k, words in POSE_WORDS.items() if any(w in low for w in words)), "stand")


def keypoints(panel: Panel, width: int, height: int) -> list[dict[int, tuple[float, float]]]:
    """Skeleton keypoints in canvas pixels, one dict per character (missing points omitted)."""
    if panel.shot == "extreme_close" or not panel.characters:
        return []
    body, top = FRAMING.get(panel.shot, FRAMING["medium"])
    people = []
    for pc, cx in zip(panel.characters, character_x(panel)):
        scale, head = body * height, top * height
        if pc.position == "background":
            scale, head = scale * 0.7, head + 0.06 * height
        elif pc.position == "foreground":
            scale *= 1.1
        pts = {**STAND, **POSES.get(pose_of(pc.action), {})}
        if panel.angle == "back":
            pts = {MIRROR.get(k, k): v for k, v in pts.items() if k not in (0, 14, 15)}
        elif panel.angle == "side":
            pts = {k: (x * 0.4, y) for k, (x, y) in pts.items() if k not in (15, 17)}
        people.append(
            {k: (cx * width + x * scale, head + y * scale) for k, (x, y) in sorted(pts.items())}
        )
    return people


def pose_image(panel: Panel, width: int, height: int) -> Image.Image | None:
    people = keypoints(panel, width, height)
    if not people:
        return None
    im = Image.new("RGB", (width, height), "black")
    draw = ImageDraw.Draw(im)
    stroke = max(3, round(min(width, height) / 170))
    inside = lambda p: 0 <= p[0] < width and 0 <= p[1] < height  # noqa: E731
    for pts in people:
        for i, (a, b) in enumerate(LIMBS):
            if a in pts and b in pts and (inside(pts[a]) or inside(pts[b])):
                color = tuple(round(c * 0.6) for c in COLORS[i])
                draw.line([pts[a], pts[b]], fill=color, width=stroke * 2)
        for k, (x, y) in pts.items():
            if inside((x, y)):
                draw.ellipse((x - stroke, y - stroke, x + stroke, y + stroke), fill=COLORS[k])
    return im


def png_bytes(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def blank_png(width: int, height: int) -> bytes:
    return png_bytes(Image.new("RGB", (width, height), "black"))
