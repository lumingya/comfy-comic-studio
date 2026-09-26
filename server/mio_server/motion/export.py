"""Episode → self-contained offline motion-comic player (single HTML file).

Each adopted panel becomes a shot: the image (cropped from the lettered strip, so bubbles and SFX
come along, or the raw adopted image), the planned camera move and hold time, and the lines the
player reads aloud with the browser's built-in speech synthesis.  No audio is generated on the
server and the file needs no network: a strict CSP allows only inline data images and the one
nonce'd player script.
"""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass
from functools import lru_cache
from html import escape
from pathlib import Path

from PIL import Image

from ..album.build import data_url
from ..pipeline import episode_strip as ES
from .plan import plan_episode

HERE = Path(__file__).resolve().parent
ASPECTS = {"portrait": (9, 16), "landscape": (16, 9)}


@dataclass
class MotionOptions:
    aspect: str = "portrait"
    lettered: bool = True
    subtitles: bool = False
    voice: bool = True
    lang: str = "zh-CN"
    max_width: int = 1280


def episode_motion(ctx, episode_id: str, variant_id: str | None, opts: MotionOptions) -> dict:
    """The player timeline: title card data plus one shot per panel that has an adopted image."""
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    images, _ = ES.adopted_images(ctx, ep, variant_id)
    if not images:
        raise ValueError("还没有采用任何一格的图片")
    crops: dict[str, Image.Image] = {}
    if opts.lettered:
        _, _, strip, full = ES.render_episode_strip(ctx, episode_id, variant_id)
        for pid, box in strip.panel_boxes.items():
            if pid in images:
                x0, y0, x1, y1 = (round(v) for v in box)
                crops[pid] = full.crop((x0, y0, x1, y1))
    shots = []
    for plan in plan_episode(series, ep.ordered_panels()):
        im = crops.get(plan["panel_id"]) or images.get(plan["panel_id"])
        if im is None:
            continue
        shots.append(
            {
                "image": data_url(im, opts.max_width),
                "width": im.width,
                "height": im.height,
                "move": plan["move"],
                "hold": plan["hold"],
                "lines": plan["lines"],
            }
        )
    return {
        "schema": "mio.motion.v1",
        "series": series.title,
        "title": ep.title or f"第 {ep.order + 1} 话",
        "synopsis": ep.synopsis,
        "shots": shots,
    }


@lru_cache(maxsize=1)
def _asset(name: str) -> str:
    return (HERE / name).read_text(encoding="utf-8")


def _json_block(data: dict) -> str:
    """JSON inside <script type=application/json>: no ``<``, ``>`` or ``&`` survive literally."""
    text = json.dumps(data, ensure_ascii=False)
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def render_motion(timeline: dict, opts: MotionOptions | None = None) -> str:
    opts = opts or MotionOptions()
    if opts.aspect not in ASPECTS:
        raise ValueError(f"未知的画幅：{opts.aspect}")
    w, h = ASPECTS[opts.aspect]
    nonce = secrets.token_hex(12)
    csp = (
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; "
        f"script-src 'nonce-{nonce}'; connect-src 'none'; object-src 'none'; frame-src 'none'; "
        "base-uri 'none'; form-action 'none'"
    )
    config = {
        "aspect": opts.aspect,
        "subtitles": opts.subtitles,
        "voice": opts.voice,
        "lang": opts.lang,
    }
    title = f"{timeline.get('series', '')} · {timeline.get('title', '')}".strip(" ·")
    return (
        "<!DOCTYPE html>\n"
        f'<html lang="{escape(opts.lang)}"><head><meta charset="utf-8">'
        f'<meta http-equiv="Content-Security-Policy" content="{csp}">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{escape(title)}</title>"
        f"<style>:root{{--ar:{w}/{h}}}{_asset('player.css')}</style></head>"
        f'<body data-aspect="{opts.aspect}"><main id="stage" aria-live="polite"></main>'
        f'<script type="application/json" id="mio-motion">{_json_block(timeline)}</script>'
        f'<script type="application/json" id="mio-motion-config">{_json_block(config)}</script>'
        f'<script nonce="{nonce}">{_asset("player.js")}</script>'
        "</body></html>\n"
    )
