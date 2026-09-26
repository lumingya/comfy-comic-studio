"""The ``{变量}`` layer (ROADMAP §2.1: kept as an advanced layer on top of the compiler).

Resolution order for ``{name}``:

1. panel-local variables (``PanelOverrides.values`` entries whose key starts with ``$``);
2. series variables (``Series.variables``, imported from legacy presets);
3. built-ins derived from the panel:
   ``{character}`` / ``{角色}`` – tags of every character on stage,
   ``{char1}`` … ``{char4}`` – one character's tags,
   ``{<character name or id>}`` – that character's tags,
   ``{scene}`` / ``{场景}`` – location tags, ``{style}`` / ``{画风}`` – style tags,
   ``{description}`` / ``{描述}`` – the panel description, ``{shot}`` / ``{angle}``.

Unknown names stay verbatim (so ComfyUI wildcard syntax survives); ``{{`` / ``}}`` escape braces.
Values may reference other variables up to :data:`MAX_DEPTH` levels.
"""

from __future__ import annotations

import re

from ..models import Bible, Panel, Series

PATTERN = re.compile(r"\{\{|\}\}|\{([^{}\s][^{}]{0,63})\}")
MAX_DEPTH = 4


def _tags(items) -> str:
    return ", ".join(t for t in items if t)


def builtins(bible: Bible, panel: Panel, style_id: str | None = None) -> dict[str, str]:
    out: dict[str, str] = {}
    cast = []
    for i, pc in enumerate(panel.characters, 1):
        ch = bible.character(pc.character_id)
        if not ch:
            continue
        outfit = ch.outfits.get(pc.outfit) or []
        tags = _tags(
            [*ch.tag_description, *([ch.trigger] if ch.trigger else []), *outfit, *pc.tags]
        )
        cast.append(tags)
        if i <= 4:
            out[f"char{i}"] = tags
        out[ch.name] = tags
        out[ch.id] = tags
    out["character"] = out["角色"] = _tags(cast)
    loc = bible.location(panel.location_id)
    out["scene"] = out["场景"] = _tags(loc.tags) if loc else ""
    style = bible.style(style_id)
    out["style"] = out["画风"] = _tags(style.tag_description) if style else ""
    out["description"] = out["描述"] = panel.description
    out["shot"], out["angle"] = panel.shot, panel.angle
    return out


def table(
    series: Series, panel: Panel, bible: Bible | None = None, style_id: str | None = None
) -> dict[str, str]:
    values = builtins(bible or series.bible, panel, style_id)
    values.update(series.variables)
    values.update({k[1:]: str(v) for k, v in panel.overrides.values.items() if k.startswith("$")})
    return values


def expand(text: str, values: dict[str, str]) -> str:
    def one(s: str, depth: int) -> str:
        def sub(m: re.Match) -> str:
            token = m.group(0)
            if token in ("{{", "}}"):
                return token  # unescaped once, after the last pass
            name = m.group(1).strip()
            if name not in values:
                return token
            value = str(values[name])
            return one(value, depth + 1) if depth < MAX_DEPTH else value

        return PATTERN.sub(sub, s)

    return one(text, 0).replace("{{", "{").replace("}}", "}") if text else text


def unknown(text: str, values: dict[str, str]) -> list[str]:
    """Names in ``text`` that would stay unresolved (shown as warnings in the UI)."""
    return sorted(
        {
            m.group(1).strip()
            for m in PATTERN.finditer(text or "")
            if m.group(1) and m.group(1).strip() not in values
        }
    )
