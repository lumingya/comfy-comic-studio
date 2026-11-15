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
from ..render_models import RenderProfile
from . import prompts as P
from . import variables as V
from .refs import RefChoice, select_references
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
    # Where each tag came from (tags dialect): [{"tag", "source"}], see prompts.danbooru_parts.
    # Extra sources here: "profile" (quality / negative lists), "append", "style_negative", "extra".
    sources: list[dict] = field(default_factory=list)
    negative_sources: list[dict] = field(default_factory=list)

    def to_json(self) -> dict:
        return asdict(self)


def _round64(value: float) -> int:
    return max(512, int(round(value / 64.0)) * 64)


def canvas_size(
    panel: Panel, pixels: int = SDXL_PIXELS, *, base_width: int | None = None
) -> tuple[int, int]:
    """Align the profile width to 64 px; without a profile retain the ~1 MP preview default."""
    ratio = parse_ratio(panel.aspect_ratio)
    if base_width is not None:
        width = base_width * (0.8**0.5 if panel.width_mode == PanelWidth.inset else 1)
        return max(64, round(width / 64) * 64), max(64, round(width / ratio / 64) * 64)
    if panel.width_mode == PanelWidth.inset:
        pixels = int(pixels * 0.8)
    width = (pixels * ratio) ** 0.5
    return _round64(width), _round64(width / ratio)


def _join(*parts: str) -> str:
    return ", ".join(p.strip().strip(",") for p in parts if p and p.strip().strip(","))


def _split(text: str | None) -> list[str]:
    """Comma-separated tags -> list; commas inside (...) / [...] stay with their group."""
    out, buf, depth = [], [], 0
    for ch in text or "":
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    out.append("".join(buf))
    return [t.strip() for t in out if t.strip()]


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
    base_width: int | None = None,
    references: list[RefChoice] | None = None,
) -> PanelPrompt:
    ov = panel.overrides
    width, height = canvas_size(panel, base_width=base_width)
    if series.generation:
        width = series.generation.width or width
        height = series.generation.height or height
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
    preset_positive = [preset.positive_prompt for preset in series.presets]
    preset_negative = [preset.negative_prompt for preset in series.presets]
    texts = [
        ov.raw_prompt or "",
        ov.raw_negative or "",
        ov.append_prompt,
        ov.negative_prompt,
        *preset_positive,
        *preset_negative,
    ]
    unresolved = sorted({name for t in texts for name in V.unknown(t, table)})
    raw, raw_neg, append, extra_neg = (
        V.expand(t, table) if t else t
        for t in (ov.raw_prompt, ov.raw_negative, ov.append_prompt, ov.negative_prompt)
    )
    preset_pos = _join(*(V.expand(text, table) for text in preset_positive))
    preset_neg = _join(*(V.expand(text, table) for text in preset_negative))
    if raw is not None:
        neg = raw_neg if raw_neg is not None else _join(", ".join(negative or []), style_negative)
        if preset_neg:
            neg = _join(neg, preset_neg)
        return PanelPrompt(
            _join(raw, ", ".join(quality or []), preset_pos) if quality or preset_pos else raw,
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
        selected = (
            references
            if references is not None
            else select_references(bible, panel, style_id=style.id if style else None)
        )
        slots = {
            ref.owner: ref.slot
            for ref in selected
            if ref.owner != "manual" and bible.character(ref.owner) is not None
        }
        text, refs = P.natural(story, pv, with_refs=True, reference_slots=slots)
        if style and style.description:
            text = f"{text} Style: {style.description}."
        positive = _join(text, append, ", ".join(quality or []), preset_pos)
        neg = _join(", ".join(negative or []), style_negative, extra_neg, preset_neg)
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
    pos_parts, neg_parts = P.danbooru_parts(story, pv, extra_style=style_tags)
    pos_parts = [(P.escape_tag(t), s) for t, s in pos_parts]
    # Only explicitly configured quality / negative fragments are sent.
    rest = [(t, s) for t, s in pos_parts if s != "quality"]
    pos_parts = P.sourced([(P.escape_tag(t), "profile") for t in quality or []] + rest)
    neg_parts = [(t, "profile") for t in P.dedupe(negative or [])]
    # The author's own text is appended verbatim (never deduped against generated tags).
    pos_parts += [(t, "append") for t in _split(append)]
    neg_parts += [(t, "style_negative") for t in _split(style_negative)]
    neg_parts += [(t, "extra") for t in _split(extra_neg)]
    pos_parts += [(t, "preset") for t in _split(preset_pos)]
    neg_parts += [(t, "preset") for t in _split(preset_neg)]
    refs = [c["id"] for c in pv["characters"]]
    return PanelPrompt(
        ", ".join(t for t, _ in pos_parts),
        ", ".join(t for t, _ in neg_parts),
        width,
        height,
        chosen_seed,
        dialect,
        refs=refs,
        loras=loras,
        unresolved=unresolved,
        sources=[{"tag": t, "source": s} for t, s in pos_parts],
        negative_sources=[{"tag": t, "source": s} for t, s in neg_parts],
    )


def preview(
    series: Series,
    episode: Episode,
    panel: Panel,
    variant: VariantSet | None = None,
    *,
    profile: RenderProfile | None = None,
) -> dict:
    """Both dialects side by side, using the same profile defaults as generation."""
    options = {
        "base_width": profile.base_width if profile and not profile.cloud_shape else None,
        "quality": profile.quality_tags if profile else None,
        "negative": profile.negative_tags if profile else None,
    }
    tags = compile_panel(series, episode, panel, dialect="tags", variant=variant, seed=0, **options)
    natural = compile_panel(
        series, episode, panel, dialect="natural", variant=variant, seed=0, **options
    )
    return {
        "tags": tags.to_json(),
        "natural": natural.to_json(),
        "panel": panel_view(apply_variant(series.bible, variant), panel),
    }
