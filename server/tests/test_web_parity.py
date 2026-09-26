"""Pin the canvas maths shared by the server and the web editor to one fixture.

``web/src/pages/canvas/parity.json`` holds server results for vertical text, SFX glyph
layout and the transition-background track.  This test checks the Python side still
produces them; ``parity.test.ts`` checks the TypeScript mirrors do.  Regenerate after an
intentional change with ``python server/tests/test_web_parity.py --write``.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "web" / "src" / "pages" / "canvas" / "parity.json"

if __package__ in (None, ""):
    sys.path.insert(0, str(ROOT / "server"))

from PIL import Image  # noqa: E402

from mio_server.models import LetterStyle  # noqa: E402
from mio_server.pipeline import backdrop, vertical  # noqa: E402
from mio_server.pipeline.lettering import glyph_layout  # noqa: E402

VERTICAL_TEXTS = [
    "你好，世界。",
    "等一下！！真的吗？！",
    "「走吧」——他说……",
    "OK2026年",
    "（小声）别出声",
]
SFX_TEXTS = ["砰！", "轰隆隆", "ドキドキ", "BANG"]
TRACK = {
    "background": "#ffffff",
    "height": 1400,
    "panels": [
        {"id": "a", "transition_background": "transparent", "box": [40, 40, 760, 400]},
        {"id": "b", "transition_background": "#1b1f2e", "box": [40, 460, 760, 800]},
        {"id": "c", "transition_background": "#1b1f2e>#ffffff", "box": [40, 900, 760, 1100]},
        {"id": "d", "transition_background": "", "box": [40, 1250, 760, 1360]},
    ],
    "rows": [0, 100, 420, 600, 820, 850, 1000, 1180, 1300, 1399],
}


def advance(ch: str, size: int) -> float:
    """Same estimate as ``advance`` in sfx.ts (CJK square, Latin 0.6 em)."""
    return size * 0.6 if ord(ch) <= 0x24F else size


def build() -> dict:
    vert = []
    for text in VERTICAL_TEXTS:
        for max_chars in (3, 5):
            cols = vertical.columns(text, max_chars)
            vert.append(
                {
                    "text": text,
                    "max": max_chars,
                    "glyphs": vertical.glyphs(text),
                    "columns": [list(c) for c in cols],
                    "block": list(vertical.block_size(cols, 30, 6)),
                    "cells": [
                        [ch, x, y] for ch, x, y in vertical.cell_centers(cols, (200, 100), 30, 6)
                    ],
                }
            )
    sfx = []
    for text in SFX_TEXTS:
        for effect in ("none", "grow", "shake", "arc"):
            for vert_flag in (False, True):
                style = LetterStyle(effect=effect, letter_spacing=4)
                sfx.append(
                    {
                        "text": text,
                        "effect": effect,
                        "vertical": vert_flag,
                        "glyphs": glyph_layout(text, 48, style, vert_flag, advance),
                    }
                )
    panels = [SimpleNamespace(**p) for p in TRACK["panels"]]
    canvas = Image.new("RGB", (800, TRACK["height"]), TRACK["background"])
    backdrop.paint_track(canvas, TRACK["background"], panels, {p.id: p.box for p in panels})
    colors = [list(backdrop.color_at(canvas, y)) for y in TRACK["rows"]]
    samples = [
        {"stops": stops, "t": t, "rgb": list(backdrop.sample([tuple(s) for s in stops], t))}
        for stops in ([[0, 0, 0], [255, 255, 255]], [[255, 0, 0], [0, 0, 255], [0, 255, 0]])
        for t in (0, 0.25, 0.5, 0.8, 1)
    ]
    specs = ["", "transparent", "#fff", "#1b1f2e", "#000>#fff", "#12345", "red", "#000>"]
    return {
        "vertical": vert,
        "sfx": sfx,
        "track": {**TRACK, "colors": colors},
        "samples": samples,
        "specs": [{"spec": s, "valid": backdrop.valid_spec(s)} for s in specs],
    }


def normalise(value):
    """JSON round-trip with floats rounded, so tiny platform differences don't matter."""
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, list):
        return [normalise(v) for v in value]
    if isinstance(value, dict):
        return {k: normalise(v) for k, v in value.items()}
    return value


class WebParityTest(unittest.TestCase):
    def test_fixture_matches_server(self):
        expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(normalise(expected), normalise(json.loads(json.dumps(build()))))


if __name__ == "__main__":
    if "--write" in sys.argv:
        data = normalise(json.loads(json.dumps(build())))
        FIXTURE.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {FIXTURE}")
    else:
        unittest.main()
