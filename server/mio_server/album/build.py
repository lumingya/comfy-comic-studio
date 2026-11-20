"""Episodes → books: complete saved canvas bands, or original adopted images.

Saved geometry/lettering uses full-width bands in visual order. Without a saved composition,
or with ``lettered=False``, original adopted images are never automatically ratio-cropped.
The explicit internal ``panels`` mode serves standalone panel/reader contracts.
"""

from __future__ import annotations

import base64
import io
import secrets
import unicodedata
from collections import Counter
from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path

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
    """One bounded canvas band or original image and its interchange metadata."""

    data: bytes
    mime: str
    name: str
    caption: str
    prompt: str
    width: int
    height: int
    palette: list[str]
    source_region: tuple[int, int, int, int] | None = None
    composition: dict | None = None


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
    checkpoint=lambda: None,
    mode: str = "auto",
) -> tuple[Episode, Series, list[Page | None]]:
    """Encode a saved canvas partition, or original panels (None for missing originals)."""
    ep: Episode = ctx.store.get_episode(episode_id)
    series: Series = ctx.store.get_series(ep.series_id)
    pages = list(
        iter_episode_pages(
            ctx,
            series,
            ep,
            variant_id=variant_id,
            lettered=lettered,
            deduplicate_captions=deduplicate_captions,
            profile=profile,
            max_width=max_width,
            stats=stats,
            checkpoint=checkpoint,
            mode=mode,
        )
    )
    return ep, series, pages


def iter_episode_pages(
    ctx,
    series,
    ep,
    *,
    variant_id=None,
    lettered=True,
    deduplicate_captions=False,
    profile="preview",
    max_width=1400,
    stats=None,
    checkpoint=lambda: None,
    mode="auto",
):
    """Encode one band/original at a time; callers control encoded result retention."""
    from ..pipeline.export_composition import band_regions, has_composition, metadata
    from ..pipeline.regions import prepare_snapshot

    stats = stats if stats is not None else M.Stats(profile)
    present = any(ep.adopted(p.id, variant_id) for p in ep.panels)
    saved = lettered and mode != "panels" and has_composition(ep)
    prepared = (
        prepare_snapshot(ctx, series, ep, variant_id, checkpoint=checkpoint)
        if saved or (mode == "panels" and lettered and present)
        else nullcontext(None)
    )
    with prepared as snapshot:
        if saved:
            panels = ep.ordered_panels()
            remaining = {p.id for p in panels}
            for i, box in enumerate(band_regions(snapshot), start=1):
                checkpoint()
                captions, prompts = [], []
                for panel in panels:
                    if panel.id not in remaining:
                        continue
                    bounds = snapshot.strip.panel_boxes.get(panel.id)
                    anchor = (bounds[1] + bounds[3]) / 2 if bounds else 0
                    anchor = max(0, min(snapshot.strip.height - 1, anchor))
                    if box[1] <= anchor < box[3]:
                        remaining.remove(panel.id)
                        captions.append(
                            caption(series, panel, snapshot.strip if deduplicate_captions else None)
                        )
                        prompts.append(
                            compile_panel(series, ep, panel, dialect="tags", seed=0).positive
                        )
                with snapshot.render_region(box) as im:
                    data, mime = M.process(
                        profile, original=None, image=im, stats=stats, max_width=max_width
                    )
                    with Image.open(io.BytesIO(data)) as encoded:
                        width, height = encoded.size
                    yield Page(
                        data=data,
                        mime=mime,
                        name=f"画布第 {i} 段",
                        caption="　".join(filter(None, captions)),
                        prompt="\n".join(prompts),
                        width=width,
                        height=height,
                        palette=palette(im),
                        source_region=box,
                        composition=metadata(snapshot),
                    )
            return
        for i, panel in enumerate(ep.ordered_panels(), start=1):
            checkpoint()
            take = ep.adopted(panel.id, variant_id)
            if take is None:
                yield None
                continue
            original = None if snapshot else ctx.assets.read(take.asset_id)
            if snapshot:
                image = snapshot.render_panel(panel.id)
            else:
                with Image.open(io.BytesIO(original)) as source:
                    image = source.convert("RGB")
            with image as im:
                data, mime = M.process(
                    profile, original=original, image=im, stats=stats, max_width=max_width
                )
                with Image.open(io.BytesIO(data)) as encoded:
                    width, height = encoded.size
                prompt = compile_panel(series, ep, panel, dialect="tags", seed=0).positive
                page = Page(
                    data=data,
                    mime=mime,
                    name=f"第 {i} 格",
                    caption=caption(
                        series, panel, snapshot.strip if snapshot and deduplicate_captions else None
                    ),
                    prompt=prompt,
                    width=width,
                    height=height,
                    palette=palette(im),
                )
            yield page


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
    checkpoint=lambda: None,
    mode: str = "auto",
    spool_dir=None,
    spooled=None,
) -> Book:
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    pages = iter_episode_pages(
        ctx,
        series,
        ep,
        variant_id=variant_id,
        lettered=lettered,
        deduplicate_captions=deduplicate_captions,
        profile=profile,
        max_width=max_width,
        stats=stats,
        checkpoint=checkpoint,
        mode=mode,
    )
    frames = []
    composition = None
    for i, page in enumerate(pages, start=1):
        if page is None:
            panel = ep.ordered_panels()[i - 1]
            prompt = compile_panel(series, ep, panel, dialect="tags", seed=0).positive
            frames.append(
                Frame(image="", name=f"第 {i} 格", caption=caption(series, panel), prompt=prompt)
            )
            continue
        if spool_dir is not None:
            token = "mio-spooled-" + secrets.token_hex(20)
            file = Path(spool_dir) / token
            file.write_bytes(page.data)
            spooled[token] = (page.mime, file)
            image = token
        else:
            image = f"data:{page.mime};base64," + base64.b64encode(page.data).decode("ascii")
        composition = page.composition or composition
        frames.append(
            Frame(
                image=image,
                name=page.name,
                caption=page.caption,
                prompt=page.prompt,
                width=page.width,
                height=page.height,
                palette=page.palette,
                source_region=page.source_region,
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
        composition=composition,
    )
