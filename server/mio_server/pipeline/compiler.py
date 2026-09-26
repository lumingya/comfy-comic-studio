"""Panel → prompt (tags or natural dialect), size and seed.  Pure functions.

Every automated layer can be taken over (ROADMAP §2.1):
* ``overrides.raw_prompt`` skips the compiler entirely (raw mode);
* ``overrides.append_prompt`` / ``negative_prompt`` extend the compiled result;
* ``overrides.width/height/seed`` pin the canvas and the seed.
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field

from ..models import Episode, Panel, PanelWidth, Series, VariantSet, parse_ratio
from . import prompts as P
from . import variables as V
from .story import apply_variant, panel_view, to_story

SDXL_PIXELS = 1024 * 1024


@dataclass
class PanelPrompt:
    positive: str
    negative: str
    width: int
    height: int
    seed: int
    dialect: str
    raw: bool = False
    refs: list[str] = field(default_factory=list)  # character ids, in reference-image order
    loras: list[dict] = field(default_factory=list)
    unresolved: list[str] = field(default_factory=list)  # {变量} names nobody defines

    def to_json(self) -> dict:
        return asdict(self)


def _round64(value: float) -> int:
    return max(512, int(round(value / 64.0)) * 64)


def canvas_size(panel: Panel, pixels: int = SDXL_PIXELS) -> tuple[int, int]:
    """Size from the panel's aspect ratio at ~1 MP (SDXL sweet spot), multiples of 64."""
    ratio = parse_ratio(panel.aspect_ratio)
    if panel.width_mode == PanelWidth.inset:
        pixels = int(pixels * 0.8)
    width = (pixels * ratio) ** 0.5
    return _round64(width), _round64(width / ratio)


def _join(*parts: str) -> str:
    return ", ".join(p.strip().strip(",") for p in parts if p and p.strip().strip(","))


def compile_panel(
    series: Series,
    episode: Episode,
    panel: Panel,
    *,
    dialect: str = "tags",
    variant: VariantSet | None = None,
    quality: list[str] | None = None,
    negative: list[str] | None = None,
    seed: int | None = None,
    rng: random.Random | None = None,
) -> PanelPrompt:
    ov = panel.overrides
    width, height = canvas_size(panel)
    width, height = ov.width or width, ov.height or height
    chosen_seed = ov.seed if ov.seed is not None else seed
    if chosen_seed is None:
        chosen_seed = (rng or random).randrange(0, 2**48)
    bible = apply_variant(series.bible, variant)
    style = bible.style(variant.style_id if variant and variant.style_id else None)
    loras = [l.model_dump() for l in (style.loras if style else [])]
    for pc in panel.characters:
        ch = bible.character(pc.character_id)
        if ch:
            loras.extend(l.model_dump() for l in ch.loras)
    style_negative = ", ".join(style.negative) if style else ""
    table = V.table(series, panel, bible, style.id if style else None)
    texts = [ov.raw_prompt or "", ov.raw_negative or "", ov.append_prompt, ov.negative_prompt]
    unresolved = sorted({name for t in texts for name in V.unknown(t, table)})
    raw, raw_neg, append, extra_neg = (
        V.expand(t, table) if t else t
        for t in (ov.raw_prompt, ov.raw_negative, ov.append_prompt, ov.negative_prompt)
    )
    if raw is not None:
        neg = raw_neg if raw_neg is not None else _join(", ".join(P.NEGATIVE), style_negative)
        return PanelPrompt(
            raw,
            neg,
            width,
            height,
            chosen_seed,
            dialect,
            raw=True,
            loras=loras,
            unresolved=unresolved,
        )
    story = to_story(series, episode, variant)
    pv = next(p for p in story["panels"] if p["id"] == panel.id)
    if dialect == "natural":
        text, refs = P.natural(story, pv, with_refs=True)
        if style and style.description:
            text = f"{text} Style: {style.description}."
        positive = _join(text, append)
        neg = _join(extra_neg, style_negative)
        return PanelPrompt(
            positive,
            neg,
            width,
            height,
            chosen_seed,
            dialect,
            refs=refs,
            loras=loras,
            unresolved=unresolved,
        )
    style_tags = tuple(style.tag_description) if style and style.tag_description else P.STYLE_TAGS
    pos, neg = P.danbooru(story, pv, extra_style=style_tags)
    if quality is not None:
        defaults = {P.escape_tag(t) for t in P.QUALITY}
        rest = [t for t in pos.split(", ") if t not in defaults]
        pos = ", ".join(P.dedupe([P.escape_tag(t) for t in quality] + rest))
    if negative is not None:
        neg = ", ".join(negative)
    refs = [c["id"] for c in pv["characters"]]
    return PanelPrompt(
        _join(pos, append),
        _join(neg, style_negative, extra_neg),
        width,
        height,
        chosen_seed,
        dialect,
        refs=refs,
        loras=loras,
        unresolved=unresolved,
    )


def preview(
    series: Series, episode: Episode, panel: Panel, variant: VariantSet | None = None
) -> dict:
    """Both dialects side by side for the UI (编译结果可见、可改)."""
    tags = compile_panel(series, episode, panel, dialect="tags", variant=variant, seed=0)
    natural = compile_panel(series, episode, panel, dialect="natural", variant=variant, seed=0)
    return {
        "tags": tags.to_json(),
        "natural": natural.to_json(),
        "panel": panel_view(apply_variant(series.bible, variant), panel),
    }
