"""Episodes → album books: one book per episode, one frame per panel (adopted take).

``lettered=True`` keeps each panel's saved framing and complete owned bubbles and SFX on an
expanded canvas; otherwise the raw adopted image is used and dialogue goes into the caption.
"""

from __future__ import annotations

import base64
import unicodedata
from collections import Counter
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


def display_name(series: Series, values: dict[str, str] | None = None) -> str:
    """主演 (the templates' ``{{characterName}}``, legacy ``resolveCharacterNames``): the preset's
    角色展示名, else the characters of the bible, else the character prompt name."""
    values = values if values is not None else V.series_table(series)
    shown = V.display(str(series.variables.get("character_display_name") or ""), values).strip()
    if shown:
        return shown
    cast = "、".join(c.name for c in series.bible.characters if c.name.strip())
    return cast or V.display(str(series.variables.get("character") or ""), values).strip()


def caption(series: Series, panel, embedded_strip=None) -> str:
    """Dialogue not already visible in this panel's image, when a composition is supplied.

    Match whole normalized lines only. SFX and another panel's text cannot consume a dialogue
    line. Standalone panel images preserve owned lettering beyond the artwork's edge.
    Keep the full caption by omitting the strip.
    """
    names = {c.id: c.name for c in series.bible.characters}
    values = V.table(series, panel)

    def normalized(text):
        return " ".join(unicodedata.normalize("NFC", text).split())

    embedded = Counter()
    box = (
        ES.panel_crop_box(embedded_strip, panel.id)
        if embedded_strip and panel.id in embedded_strip.panel_boxes
        else None
    )
    if box:
        for layer in embedded_strip.lettering:
            if layer.panel_id != panel.id or layer.kind == "sfx":
                continue
            if not (
                box[0] <= layer.box[0] < layer.box[2] <= box[2]
                and box[1] <= layer.box[1] < layer.box[3] <= box[3]
            ):
                continue
            # The compositor paints layer.text literally; do not expand variables it did not draw.
            embedded[normalized(layer.text)] += 1
    lines = []
    for d in panel.dialogues:
        if d.kind == DialogueKind.sfx:
            continue
        who = names.get(d.speaker_id or "", "")
        text = V.display(d.text, values)
        if text.strip() and embedded[normalized(text)]:
            embedded[normalized(text)] -= 1
            continue
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
    deduplicate_captions: bool = False,
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
    composed_strip = None
    if lettered and images:
        _, _, strip, full = ES.render_snapshot(ctx, series, ep, variant_id, panel_images=True)
        crops = dict(ES.panel_crops(ep, strip, full, variant_id))
        composed_strip = strip
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
                caption=caption(series, panel, composed_strip if deduplicate_captions else None),
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
    deduplicate_captions: bool = False,
    max_width: int = 1400,
    profile: str = "preview",
    stats: M.Stats | None = None,
) -> Book:
    ep, series, pages = episode_pages(
        ctx,
        episode_id,
        variant_id=variant_id,
        lettered=lettered,
        deduplicate_captions=deduplicate_captions,
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
    # Text outside the panels uses the album's variables too: a synopsis written in the workshop
    # says {style} / {character_display_name} just like the prompts do (unknown names stay).
    values = V.series_table(series)
    episode_title = V.display(ep.title, values).strip() or f"第 {ep.order + 1} 话"
    _, count = ctx.store.episode_summaries(series.id, 0, 1)
    # Legacy books: the cover shows the album's own name and 「CHAPTER 01 / …」 the story's; an
    # album of several episodes names each book after its episode.
    single = count <= 1 and bool(series.title.strip())
    return Book(
        title=series.title if single else episode_title,
        frames=frames,
        synopsis=V.display(ep.synopsis, values),
        character_name=display_name(series, values),
        story_title=episode_title if single else series.title,
    )
