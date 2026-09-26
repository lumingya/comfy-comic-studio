"""Minimal webtoon layout: vertical strip, automatic bubbles, 800 px slices.

Bubble placement scores candidate positions per bubble: overlap with face boxes (heavy),
visual busyness under the bubble (edge density), distance to the speaker, and reading order
(top-to-bottom, then left-to-right). Bubbles may hang into the gutter above a panel, which
keeps them off the art. Tails point at the speaker's face when a face box is known.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from . import vertical as VT

FONT_CANDIDATES = (
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
)
BOLD_CANDIDATES = (
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
) + FONT_CANDIDATES
NO_LINE_START = set("，。！？、；：…」』）》〉】,.!?;:)]}~—")


def find_font(candidates) -> str | None:
    return next((p for p in candidates if os.path.exists(p)), None)


def load_font(path: str | None, size: int):
    if path:
        return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


@dataclass
class Style:
    width: int = 800
    gutter: int = 64
    scene_gap: int = 240
    top: int = 170
    bottom: int = 220
    font_path: str | None = None
    bold_path: str | None = None
    font_size: int = 27
    caption_size: int = 22
    title_size: int = 40
    line_gap: int = 7
    outline: int = 3
    max_text_width: int = 300
    slice_height: int = 1280

    def __post_init__(self):
        self.font_path = self.font_path or find_font(FONT_CANDIDATES)
        self.bold_path = self.bold_path or find_font(BOLD_CANDIDATES)


@dataclass
class Placement:
    panel: str
    kind: str
    text: str
    lines: list[str]
    box: tuple[int, int, int, int]
    tail: tuple[int, int] | None = None
    speaker: str | None = None
    face_overlap: float = 0.0
    vertical: bool = False


@dataclass
class StripResult:
    image: Image.Image
    placements: list[Placement]
    panel_boxes: dict[str, tuple[int, int, int, int]]
    report: dict = field(default_factory=dict)


# ----------------------------------------------------------------------------- text
def _tokens(text: str) -> list[str]:
    tokens, word = [], ""
    for ch in text:
        if ch.isascii() and not ch.isspace() and ch not in ",.!?;:":
            word += ch
            continue
        if word:
            tokens.append(word)
            word = ""
        tokens.append(ch)
    if word:
        tokens.append(word)
    return tokens


def wrap(text: str, font, max_width: float) -> list[str]:
    """Greedy wrap that breaks between CJK characters and keeps ASCII words whole; closing
    punctuation never starts a line."""
    lines, line = [], ""
    for tok in _tokens(text.strip()):
        if not line or font.getlength(line + tok) <= max_width:
            line += tok
        else:
            lines.append(line.rstrip())
            line = tok.lstrip()
    if line:
        lines.append(line)
    for i in range(1, len(lines)):
        while lines[i] and lines[i][0] in NO_LINE_START:
            lines[i - 1] += lines[i][0]
            lines[i] = lines[i][1:]
    return [l for l in lines if l.strip()]


BREAK_AFTER = set("，。！？、；：…—」』）》,.!?;:")


def _even_lines(tokens: list[str], widths: list[float], n: int) -> list[str] | None:
    """Split tokens into ``n`` lines of near-equal width (dynamic programming). Breaking after
    punctuation is rewarded; a line may not start with closing punctuation."""
    T = len(tokens)
    prefix = [0.0]
    for w in widths:
        prefix.append(prefix[-1] + w)
    target = prefix[-1] / n
    INF = math.inf
    best = [[INF] * (n + 1) for _ in range(T + 1)]
    back = [[0] * (n + 1) for _ in range(T + 1)]
    best[0][0] = 0.0
    for i in range(1, T + 1):
        for k in range(1, min(n, i) + 1):
            for j in range(k - 1, i):
                if best[j][k - 1] == INF or (j > 0 and tokens[j].strip()[:1] in NO_LINE_START):
                    continue
                cost = ((prefix[i] - prefix[j] - target) / target) ** 2
                if i < T and tokens[i - 1].strip()[-1:] in BREAK_AFTER:
                    cost -= 0.12
                if best[j][k - 1] + cost < best[i][k]:
                    best[i][k], back[i][k] = best[j][k - 1] + cost, j
    if best[T][n] == INF:
        return None
    lines, i = [], T
    for k in range(n, 0, -1):
        j = back[i][k]
        lines.append("".join(tokens[j:i]).strip())
        i = j
    return lines[::-1]


def balanced_wrap(text: str, font, max_width: float, ratio: float = 1.7) -> list[str]:
    """Even lines whose block is about ``ratio`` wide/high (speech ellipses ~1.7, captions wider)."""
    tokens = _tokens(text.strip())
    if not tokens:
        return []
    widths = [font.getlength(t) for t in tokens]
    total, line_h = sum(widths), font.size * 1.3
    n = max(1, round(math.sqrt(total / (ratio * line_h))), math.ceil(total / max_width))
    while n <= len(tokens):
        lines = _even_lines(tokens, widths, n)
        if lines and all(font.getlength(l) <= max_width for l in lines):
            return lines
        n += 1
    return wrap(text, font, max_width)


def text_block(lines: list[str], font, gap: int) -> tuple[int, int, list[float]]:
    widths = [font.getlength(l) for l in lines]
    height = len(lines) * font.size + max(0, len(lines) - 1) * gap
    return math.ceil(max(widths or [0])), height, widths


def ellipse_size(
    lines: list[str], font, gap: int, pad: tuple[int, int] = (22, 16)
) -> tuple[int, int]:
    """Smallest ellipse (w, h) containing every text line, plus padding."""
    tw, th, widths = text_block(lines, font, gap)
    b = th / 2 * 1.18 + pad[1]
    a_needed = 0.0
    for i, lw in enumerate(widths):
        top = i * (font.size + gap)
        extreme = max(abs(top - th / 2), abs(top + font.size - th / 2))
        room = max(0.2, 1 - (extreme / b) ** 2)
        a_needed = max(a_needed, (lw / 2) / math.sqrt(room))
    return math.ceil(2 * (a_needed + pad[0])), math.ceil(2 * b)


# ----------------------------------------------------------------------------- geometry
def _area(box) -> float:
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def _overlap(a, b) -> float:
    return _area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))


class EdgeMap:
    """Edge density of a panel on a coarse grid, with an integral image for fast box means."""

    def __init__(self, image: Image.Image, grid_width: int = 160):
        self.scale = grid_width / image.width
        small = image.convert("L").resize((grid_width, max(1, round(image.height * self.scale))))
        edges = small.filter(ImageFilter.FIND_EDGES)
        self.w, self.h = edges.size
        px = edges.load()
        self.integral = [[0] * (self.w + 1) for _ in range(self.h + 1)]
        for y in range(self.h):
            row, run = self.integral[y + 1], 0
            above = self.integral[y]
            for x in range(self.w):
                run += px[x, y]
                row[x + 1] = above[x + 1] + run

    def mean(self, box) -> float:
        """Mean edge value (0-1) inside ``box`` given in panel pixel coordinates."""
        x0, y0, x1, y1 = (
            max(0, min(lim, round(v * self.scale)))
            for v, lim in zip(box, (self.w, self.h, self.w, self.h))
        )
        if x1 <= x0 or y1 <= y0:
            return 0.0
        I = self.integral
        total = I[y1][x1] - I[y0][x1] - I[y1][x0] + I[y0][x0]
        return total / ((x1 - x0) * (y1 - y0) * 255)


def font_for(kind: str, fonts: dict):
    return (
        fonts["caption"] if kind == "caption" else fonts["sfx"] if kind == "sfx" else fonts["text"]
    )


def measure(spec: dict, style: Style, fonts: dict) -> tuple[list[str], int, int, bool]:
    """``(lines, bubble_w, bubble_h, vertical)`` for one spec (``kind``, ``text``, ``vertical``).

    Vertical specs return columns (rightmost first) instead of lines.
    """
    kind, text = spec["kind"], spec["text"]
    font = font_for(kind, fonts)
    if spec.get("vertical") and kind in ("speech", "thought", "narration"):
        cells = len([g for g in VT.glyphs(text) if g != "\n"])
        cols = VT.columns(text, min(10, max(4, math.ceil(math.sqrt(cells * 1.8)))))
        tw, th = VT.block_size(cols, font.size, style.line_gap)
        if kind == "narration":
            return cols, tw + 36, th + 36, True
        return cols, math.ceil(tw * 1.3 + 40), math.ceil(th * 1.18 + 44), True
    max_w = style.max_text_width if kind in ("speech", "thought") else style.max_text_width + 120
    if kind in ("speech", "thought"):
        lines = balanced_wrap(text, font, max_w)
    elif kind == "narration":
        lines = balanced_wrap(text, font, max_w, ratio=5.0)
    else:
        lines = wrap(text, font, max_w)
    tw, th, _ = text_block(lines, font, style.line_gap)
    if kind in ("speech", "thought"):
        bw, bh = ellipse_size(lines, font, style.line_gap)
    elif kind == "caption":
        bw, bh = tw + 28, th + 18
    elif kind == "sfx":
        bw, bh = tw + 12, th + 12
    else:  # narration
        bw, bh = tw + 40, th + 30
    return lines, bw, bh, False


def place_bubbles(
    panel_id: str,
    panel_box,
    specs: list[dict],
    faces: list[dict],
    edges: EdgeMap | None,
    style: Style,
    fonts: dict,
    occupied: list,
    gutter_above: int,
    strip_width: int,
    rtl: bool = False,
) -> list[Placement]:
    """Choose a box for each bubble spec (``kind``, ``text``, ``speaker``) in reading order.

    ``faces`` items: ``{"box": normalized, "character": id, "estimated": bool}``; estimated
    boxes (from the script's character positions) weigh less than detected ones.  ``rtl`` reads
    right-to-left (vertical manga text).
    """
    px0, py0, px1, py1 = panel_box
    pw, ph = px1 - px0, py1 - py0
    face_boxes = []
    for f in faces or []:
        x1, y1, x2, y2 = f["box"]
        fw, fh = (x2 - x1) * pw, (y2 - y1) * ph
        face_boxes.append(
            {
                "character": f.get("character"),
                "weight": 3.5 if f.get("estimated") else 10.0,
                "box": (
                    px0 + x1 * pw - fw * 0.12,
                    py0 + y1 * ph - fh * 0.12,
                    px0 + x2 * pw + fw * 0.12,
                    py0 + y2 * ph + fh * 0.12,
                ),
            }
        )
    placed: list[Placement] = []
    for spec in specs:
        kind, text = spec["kind"], spec["text"]
        lines, bw, bh, vertical = measure(spec, style, fonts)
        speaker_face = next(
            (
                f["box"]
                for f in face_boxes
                if spec.get("speaker") and f["character"] == spec["speaker"]
            ),
            None,
        )
        hang = min(gutter_above * 0.7, bh * 0.55) if gutter_above > 0 else 0
        if kind == "caption":
            xs, ys = [px0 + 18 + bw / 2], [py0 + 16 + bh / 2]
        else:
            xs = [px0 + pw * f for f in (0.18, 0.3, 0.42, 0.5, 0.58, 0.7, 0.82)]
            y_lo, y_hi = py0 - hang + bh / 2, py0 + ph * (0.42 if kind != "sfx" else 0.85)
            ys = [y_lo + (y_hi - y_lo) * t / 6 for t in range(7)] + [py1 - bh / 2 - 14]
        best, best_score = None, math.inf
        for cx in xs:
            cx = min(max(cx, px0 + bw / 2 + 14), px1 - bw / 2 - 14)
            for cy in ys:
                box = (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)
                if box[0] < 6 or box[2] > strip_width - 6 or box[1] < py0 - hang - 1:
                    continue
                if any(_overlap(box, o) > 0 for o in occupied) or any(
                    _overlap(box, p.box) > 0 for p in placed
                ):
                    continue
                area = _area(box)
                face_hit = sum(_overlap(box, f["box"]) * f["weight"] for f in face_boxes) / area
                inside = (
                    box[0] - px0,
                    max(box[1], py0) - py0,
                    box[2] - px0,
                    min(box[3], py1) - py0,
                )
                busy = edges.mean(inside) if edges and inside[3] > inside[1] else 0.0
                inside_frac = max(0.0, inside[3] - inside[1]) / bh
                s = face_hit + busy * inside_frac * 2.5 + (cy - py0) / ph * 0.6
                if speaker_face:
                    fx, fy = (speaker_face[0] + speaker_face[2]) / 2, speaker_face[1]
                    s += math.hypot(cx - fx, cy - fy) / pw * 1.2 + (0.8 if cy > fy else 0)
                if placed:
                    prev = placed[-1].box
                    pcx, pcy = (prev[0] + prev[2]) / 2, (prev[1] + prev[3]) / 2
                    if cy < pcy - (prev[3] - prev[1]) * 0.25:
                        s += 3
                    elif abs(cy - pcy) < bh * 0.6 and (cx > pcx if rtl else cx < pcx):
                        s += 2
                if s < best_score:
                    best, best_score = box, s
        if best is None:  # no free spot: stack under the last bubble inside the panel
            y = (placed[-1].box[3] + 10) if placed else py0 + 16
            best = (px0 + 16, y, px0 + 16 + bw, y + bh)
        box = tuple(round(v) for v in best)
        tail = None
        if kind in ("speech", "thought"):
            cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            if speaker_face:
                tx = min(max((speaker_face[0] + speaker_face[2]) / 2, box[0] + 20), box[2] - 20)
                ty = speaker_face[1] - 6
                dist = math.hypot(tx - cx, ty - cy)
                reach = min(dist, (box[3] - box[1]) / 2 + 70)
                tail = (
                    (round(cx + (tx - cx) * reach / dist), round(cy + (ty - cy) * reach / dist))
                    if dist
                    else None
                )
            else:
                tail = (round(cx + (box[2] - box[0]) * 0.12), round(box[3] + 34))
        area = _area(box)
        real = [f for f in face_boxes if f["weight"] >= 10]
        overlap = sum(_overlap(box, f["box"]) for f in real) / area if area else 0.0
        placed.append(
            Placement(
                panel_id,
                kind,
                text,
                lines,
                box,
                tail,
                spec.get("speaker"),
                round(overlap, 3),
                vertical,
            )
        )
    return placed


# ----------------------------------------------------------------------------- drawing
def draw_bubble(
    draw: ImageDraw.ImageDraw, p: Placement, fonts: dict, style: Style, text: bool = True
) -> None:
    x0, y0, x1, y1 = p.box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ow = style.outline
    if p.kind in ("speech", "thought"):
        a, b = (x1 - x0) / 2, (y1 - y0) / 2
        base = None
        if p.tail and p.kind == "speech":
            ang = math.atan2(p.tail[1] - cy, p.tail[0] - cx)
            bx, by = cx + a * 0.8 * math.cos(ang), cy + b * 0.8 * math.sin(ang)
            nx, ny = -math.sin(ang), math.cos(ang)
            base = [(bx + nx * 14, by + ny * 14), p.tail, (bx - nx * 14, by - ny * 14)]
            draw.polygon(base, fill="white", outline="black", width=ow)
        draw.ellipse(p.box, fill="white", outline="black", width=ow)
        if base:  # hide the seam where the tail meets the ellipse
            inner = [
                (bx + nx * (14 - ow), by + ny * (14 - ow)),
                (bx + (p.tail[0] - bx) * 0.3, by + (p.tail[1] - by) * 0.3),
                (bx - nx * (14 - ow), by - ny * (14 - ow)),
            ]
            draw.polygon(inner, fill="white")
        if p.tail and p.kind == "thought":
            ang = math.atan2(p.tail[1] - cy, p.tail[0] - cx)
            ex, ey = cx + a * math.cos(ang), cy + b * math.sin(ang)
            for t, r in ((0.35, 9), (0.75, 5)):
                px_, py_ = ex + (p.tail[0] - ex) * t, ey + (p.tail[1] - ey) * t
                draw.ellipse(
                    (px_ - r, py_ - r, px_ + r, py_ + r), fill="white", outline="black", width=2
                )
        font, color = fonts["text"], "black"
    elif p.kind == "caption":
        draw.rectangle(p.box, fill=(20, 20, 20))
        font, color = fonts["caption"], "white"
    elif p.kind == "sfx":
        font, color = fonts["sfx"], "black"
    else:
        draw.rectangle(p.box, fill=(255, 250, 236), outline="black", width=ow)
        font, color = fonts["text"], "black"
    if not text:
        return
    if p.vertical:
        VT.draw(draw, p.lines, (cx, cy), font, style.line_gap, fill=color)
        return
    _, th, widths = text_block(p.lines, font, style.line_gap)
    y = cy - th / 2
    for line, lw in zip(p.lines, widths):
        kwargs = {"stroke_width": 4, "stroke_fill": "white"} if p.kind == "sfx" else {}
        draw.text((cx - lw / 2, y - font.size * 0.12), line, font=font, fill=color, **kwargs)
        y += font.size + style.line_gap


# ----------------------------------------------------------------------------- strip
def layout_strip(
    story: dict, images: dict, faces: dict | None = None, style: Style | None = None
) -> StripResult:
    """``images``: panel id -> PIL image (panels without an image are skipped)."""
    style = style or Style()
    fonts = {
        "text": load_font(style.font_path, style.font_size),
        "caption": load_font(style.bold_path or style.font_path, style.caption_size),
        "title": load_font(style.bold_path or style.font_path, style.title_size),
        "sfx": load_font(style.bold_path or style.font_path, style.font_size + 16),
    }
    scenes = {s["id"]: s for s in story.get("scenes") or []}
    panels = [p for p in story.get("panels") or [] if p["id"] in images]
    W = style.width
    boxes, y, prev_scene = {}, style.top, None
    scaled = {}
    for p in panels:
        im = images[p["id"]]
        h = round(im.height * W / im.width)
        scaled[p["id"]] = im.resize((W, h), Image.LANCZOS)
        if prev_scene is not None:
            y += style.scene_gap if p["scene"] != prev_scene else style.gutter
        boxes[p["id"]] = (0, y, W, y + h)
        y += h
        prev_scene = p["scene"]
    height = y + style.bottom
    strip = Image.new("RGB", (W, height), "white")
    for pid, box in boxes.items():
        strip.paste(scaled[pid], box[:2])
    placements: list[Placement] = []
    prev_bottom, prev_scene = style.top - style.gutter, None
    for p in panels:
        box = boxes[p["id"]]
        specs = []
        if p["scene"] != prev_scene and scenes.get(p["scene"], {}).get("location"):
            specs.append(
                {"kind": "caption", "text": scenes[p["scene"]]["location"], "speaker": None}
            )
        for d in p.get("dialogue") or []:
            specs.append(
                {
                    "kind": d["kind"],
                    "text": d["text"],
                    "speaker": None if d["speaker"] == "narrator" else d["speaker"],
                }
            )
        edges = EdgeMap(scaled[p["id"]])
        gutter_above = box[1] - prev_bottom
        placements += place_bubbles(
            p["id"],
            box,
            specs,
            (faces or {}).get(p["id"], []),
            edges,
            style,
            fonts,
            [q.box for q in placements],
            gutter_above,
            W,
        )
        prev_bottom, prev_scene = box[3], p["scene"]
    draw = ImageDraw.Draw(strip)
    for q in placements:
        draw_bubble(draw, q, fonts, style)
    title = story.get("title") or ""
    if title:
        tw = fonts["title"].getlength(title)
        draw.text(
            ((W - tw) / 2, (style.top - style.title_size) / 2 - 10),
            title,
            font=fonts["title"],
            fill="black",
        )
    end = "— 完 —"
    ew = fonts["text"].getlength(end)
    draw.text(
        ((W - ew) / 2, height - style.bottom / 2 - style.font_size / 2),
        end,
        font=fonts["text"],
        fill=(90, 90, 90),
    )
    report = {
        "height": height,
        "panels": len(panels),
        "bubbles": len(placements),
        "bubbles_on_faces": sum(1 for q in placements if q.face_overlap > 0.02),
        "font_px": style.font_size,
        "font": os.path.basename(style.font_path or "default"),
    }
    return StripResult(strip, placements, boxes, report)


def cut_points(result: StripResult, height: int) -> list[int]:
    """Slice boundaries at most ``height`` apart, preferring gutters and never cutting a bubble."""
    total = result.image.height
    panels = sorted(result.panel_boxes.values(), key=lambda b: b[1])
    bubbles = [q.box for q in result.placements]
    cuts, start = [], 0
    while total - start > height:
        target = start + height
        choice = None
        for y in range(target, max(start + height // 2, target - 420), -2):
            if any(b[1] - 4 <= y <= b[3] + 4 for b in bubbles):
                continue
            if not any(b[1] < y < b[3] for b in panels):
                choice = y
                break
            if choice is None:
                choice = -y  # first bubble-free row inside a panel, used if no gutter is found
        y = choice if choice and choice > 0 else (-choice if choice else target)
        cuts.append(y)
        start = y
    return cuts


def slices(result: StripResult, height: int | None = None) -> list[Image.Image]:
    height = height or 1280
    ys = [0] + cut_points(result, height) + [result.image.height]
    return [result.image.crop((0, a, result.image.width, b)) for a, b in zip(ys, ys[1:])]
