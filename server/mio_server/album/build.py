"""Episodes → album books: one book per episode, one frame per panel (adopted take).

``lettered=True`` crops each panel from the composited strip so bubbles and SFX come along
(cross-panel bubbles are cut at the panel edge); otherwise the raw adopted image is used and the
dialogue goes into the caption.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass

from PIL import Image

from ..models import DialogueKind, Episode, Series
from ..pipeline import episode_strip as ES
from ..pipeline import variables as V
from ..pipeline.compiler import compile_panel
from . import media as M
from .render import Book, Frame


def data_url(im: Image.Image, max_width: int, quality: int = 86) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(M.preview(im, max_width, quality)).decode(
        "ascii"
    )


@dataclass
class Page:
    """One exported panel: encoded bytes plus the book metadata that goes with it."""

    data: bytes
    mime: str
    name: str
    caption: str
    prompt: str
    width: int
    height: int
    palette: list[str]


def palette(im: Image.Image, n: int = 3) -> list[str]:
    """Dominant colours (most frequent first) for the templates' palette swatches."""
    small = im.convert("RGB").resize((48, 48))
    quant = small.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    pal = quant.getpalette() or []
    counts = sorted(quant.getcolors() or [], reverse=True)
    return ["#%02x%02x%02x" % tuple(pal[i * 3 : i * 3 + 3]) for _, i in counts[:n]]


def caption(series: Series, panel) -> str:
    names = {c.id: c.name for c in series.bible.characters}
    values = V.table(series, panel)
    lines = []
    for d in panel.dialogues:
        if d.kind == DialogueKind.sfx:
            continue
        who = names.get(d.speaker_id or "", "")
        text = V.expand(d.text, values)
        if d.kind in (DialogueKind.narration, DialogueKind.caption) or not who:
            lines.append(text)
        else:
            lines.append(f"{who}：{text}")
    return "　".join(lines)


def episode_pages(
    ctx,
    episode_id: str,
    *,
    variant_id: str | None = None,
    lettered: bool = True,
    profile: str = "preview",
    max_width: int = 1400,
    stats: M.Stats | None = None,
) -> tuple[Episode, Series, list[Page | None]]:
    """Every panel of an episode encoded for ``profile``; ``None`` where nothing is adopted yet."""
    ep: Episode = ctx.store.get_episode(episode_id)
    series: Series = ctx.store.get_series(ep.series_id)
    stats = stats if stats is not None else M.Stats(profile)
    images, _ = ES.adopted_images(ctx, ep, variant_id)
    crops: dict[str, Image.Image] = {}
    if lettered and images:
        _, _, strip, full = ES.render_episode_strip(ctx, episode_id, variant_id)
        for pid, box in strip.panel_boxes.items():
            if pid in images:
                x0, y0, x1, y1 = (round(v) for v in box)
                crops[pid] = full.crop((x0, y0, x1, y1))
    pages: list[Page | None] = []
    for i, panel in enumerate(ep.ordered_panels(), start=1):
        im = crops.get(panel.id) or images.get(panel.id)
        if im is None:
            pages.append(None)
            continue
        original = None
        if panel.id not in crops and profile in ("clean", "archive", "auto", "publish"):
            take = ep.adopted(panel.id, variant_id)
            original = ctx.assets.read(take.asset_id) if take else None
        data, mime = M.process(
            profile, original=original, image=im, stats=stats, max_width=max_width
        )
        prompt = compile_panel(series, ep, panel, dialect="tags", seed=0).positive
        pages.append(
            Page(
                data=data,
                mime=mime,
                name=f"第 {i} 格",
                caption=caption(series, panel),
                prompt=prompt,
                width=im.width,
                height=im.height,
                palette=palette(im),
            )
        )
    return ep, series, pages


def episode_book(
    ctx,
    episode_id: str,
    *,
    variant_id: str | None = None,
    lettered: bool = True,
    max_width: int = 1400,
    profile: str = "preview",
    stats: M.Stats | None = None,
) -> Book:
    ep, series, pages = episode_pages(
        ctx,
        episode_id,
        variant_id=variant_id,
        lettered=lettered,
        profile=profile,
        max_width=max_width,
        stats=stats,
    )
    frames = []
    for i, (panel, page) in enumerate(zip(ep.ordered_panels(), pages), start=1):
        if page is None:
            prompt = compile_panel(series, ep, panel, dialect="tags", seed=0).positive
            frames.append(
                Frame(image="", name=f"第 {i} 格", caption=caption(series, panel), prompt=prompt)
            )
            continue
        frames.append(
            Frame(
                image=f"data:{page.mime};base64," + base64.b64encode(page.data).decode("ascii"),
                name=page.name,
                caption=page.caption,
                prompt=page.prompt,
                width=page.width,
                height=page.height,
                palette=page.palette,
            )
        )
    return Book(
        title=ep.title or f"第 {ep.order + 1} 话",
        frames=frames,
        synopsis=ep.synopsis,
        story_title=series.title,
    )
