"""Episodes → album books: one book per episode, one frame per panel (adopted take).

``lettered=True`` crops each panel from the composited strip so bubbles and SFX come along
(cross-panel bubbles are cut at the panel edge); otherwise the raw adopted image is used and the
dialogue goes into the caption.
"""

from __future__ import annotations

import base64
import io

from PIL import Image

from ..models import DialogueKind, Episode, Series
from ..pipeline import episode_strip as ES
from ..pipeline.compiler import compile_panel
from .render import Book, Frame


def data_url(im: Image.Image, max_width: int, quality: int = 86) -> str:
    im = im.convert("RGB")
    if max_width and im.width > max_width:
        im = im.resize((max_width, round(im.height * max_width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def palette(im: Image.Image, n: int = 3) -> list[str]:
    """Dominant colours (most frequent first) for the templates' palette swatches."""
    small = im.convert("RGB").resize((48, 48))
    quant = small.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    pal = quant.getpalette() or []
    counts = sorted(quant.getcolors() or [], reverse=True)
    return ["#%02x%02x%02x" % tuple(pal[i * 3 : i * 3 + 3]) for _, i in counts[:n]]


def caption(series: Series, panel) -> str:
    names = {c.id: c.name for c in series.bible.characters}
    lines = []
    for d in panel.dialogues:
        if d.kind == DialogueKind.sfx:
            continue
        who = names.get(d.speaker_id or "", "")
        if d.kind in (DialogueKind.narration, DialogueKind.caption) or not who:
            lines.append(d.text)
        else:
            lines.append(f"{who}：{d.text}")
    return "　".join(lines)


def episode_book(
    ctx,
    episode_id: str,
    *,
    variant_id: str | None = None,
    lettered: bool = True,
    max_width: int = 1400,
) -> Book:
    ep: Episode = ctx.store.get_episode(episode_id)
    series: Series = ctx.store.get_series(ep.series_id)
    images, _ = ES.adopted_images(ctx, ep, variant_id)
    crops: dict[str, Image.Image] = {}
    if lettered and images:
        _, _, strip, full = ES.render_episode_strip(ctx, episode_id, variant_id)
        for pid, box in strip.panel_boxes.items():
            if pid in images:
                x0, y0, x1, y1 = (round(v) for v in box)
                crops[pid] = full.crop((x0, y0, x1, y1))
    frames = []
    for i, panel in enumerate(ep.ordered_panels(), start=1):
        im = crops.get(panel.id) or images.get(panel.id)
        prompt = compile_panel(series, ep, panel, dialect="tags", seed=0).positive
        frames.append(
            Frame(
                image=data_url(im, max_width) if im is not None else "",
                name=f"第 {i} 格",
                caption=caption(series, panel),
                prompt=prompt,
                width=im.width if im is not None else None,
                height=im.height if im is not None else None,
                palette=palette(im) if im is not None else [],
            )
        )
    return Book(
        title=ep.title or f"第 {ep.order + 1} 话",
        frames=frames,
        synopsis=ep.synopsis,
        story_title=series.title,
    )
