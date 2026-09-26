"""Vertical (竖排) typesetting: presentation forms, kinsoku and right-to-left columns.

Mirrored by ``web/src/pages/canvas/vertical.ts`` so the canvas preview matches the export; keep
the two tables in sync (both have tests that pin the same samples).
"""

from __future__ import annotations

import math

# Horizontal punctuation → vertical presentation forms (U+FE10–FE19, U+FE30–FE4F).
VERTICAL_FORMS = {
    "，": "︐",
    ",": "︐",
    "、": "︑",
    "。": "︒",
    "：": "︓",
    ":": "︓",
    "；": "︔",
    ";": "︔",
    "！": "︕",
    "!": "︕",
    "？": "︖",
    "?": "︖",
    "…": "︙",
    "‥": "︰",
    "—": "︱",
    "–": "︲",
    "（": "︵",
    "(": "︵",
    "）": "︶",
    ")": "︶",
    "｛": "︷",
    "{": "︷",
    "｝": "︸",
    "}": "︸",
    "〔": "︹",
    "〕": "︺",
    "【": "︻",
    "】": "︼",
    "《": "︽",
    "》": "︾",
    "〈": "︿",
    "〉": "﹀",
    "「": "﹁",
    "」": "﹂",
    "『": "﹃",
    "』": "﹄",
    "［": "﹇",
    "[": "﹇",
    "］": "﹈",
    "]": "﹈",
    "ー": "丨",
    "～": "≀",
    "~": "≀",
}
# Pairs set upright in a single cell (縦中横).
COMBINED = {"!!": "‼", "！！": "‼", "!?": "⁉", "！？": "⁉", "?!": "⁈", "？！": "⁈", "??": "⁇"}
# Glyphs that must not start a column (closing marks hang at the end of the previous one).
NO_START = set("︐︑︒︓︔︕︖︙︰︶︸︺︼︾﹀﹂﹄﹈‼⁉⁈⁇")
# Glyphs that must not end a column (opening marks move down to the next one).
NO_END = set("︵︷︹︻︽︿﹁﹃﹇")


def glyphs(text: str) -> list[str]:
    """Characters of ``text`` in vertical form, whitespace dropped, ``\\n`` kept as a break."""
    out: list[str] = []
    i = 0
    while i < len(text):
        pair = text[i : i + 2]
        if pair in COMBINED:
            out.append(COMBINED[pair])
            i += 2
            continue
        ch = text[i]
        i += 1
        if ch == "\n":
            out.append("\n")
        elif ch.isspace():
            continue
        else:
            out.append(VERTICAL_FORMS.get(ch, ch))
    return out


def columns(text: str, max_chars: int) -> list[str]:
    """Split into balanced columns of at most ``max_chars`` cells (first column = rightmost)."""
    max_chars = max(2, max_chars)
    cols: list[str] = []
    for para in "".join(glyphs(text)).split("\n"):
        cells = list(para)
        if not cells:
            continue
        n = math.ceil(len(cells) / max_chars)
        size = math.ceil(len(cells) / n)
        part: list[list[str]] = [cells[k : k + size] for k in range(0, len(cells), size)]
        for k in range(1, len(part)):
            while part[k] and part[k][0] in NO_START:  # hang closing marks
                part[k - 1].append(part[k].pop(0))
            while len(part[k - 1]) > 1 and part[k - 1][-1] in NO_END:
                part[k].insert(0, part[k - 1].pop())
        cols.extend("".join(p) for p in part if p)
    return cols


def block_size(cols: list[str], font_size: int, col_gap: int) -> tuple[int, int]:
    """Text block (w, h) of vertical columns."""
    if not cols:
        return 0, 0
    w = len(cols) * font_size + (len(cols) - 1) * col_gap
    h = max(len(c) for c in cols) * round(font_size * 1.05)
    return w, h


def cell_centers(
    cols: list[str], center: tuple[float, float], font_size: int, col_gap: int
) -> list[tuple[str, float, float]]:
    """``(glyph, x, y)`` cell centres; columns run right → left, glyphs top → bottom."""
    w, h = block_size(cols, font_size, col_gap)
    cx, cy = center
    step = round(font_size * 1.05)
    out = []
    for k, col in enumerate(cols):
        x = cx + w / 2 - font_size / 2 - k * (font_size + col_gap)
        for j, ch in enumerate(col):
            out.append((ch, x, cy - h / 2 + step * j + step / 2))
    return out


def draw(draw_ctx, cols: list[str], center, font, col_gap: int, fill="black", **kwargs) -> None:
    for ch, x, y in cell_centers(cols, center, font.size, col_gap):
        draw_ctx.text((x, y), ch, font=font, fill=fill, anchor="mm", **kwargs)
