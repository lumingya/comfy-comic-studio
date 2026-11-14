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


def series_table(
    series: Series, bible: Bible | None = None, style_id: str | None = None
) -> dict[str, str]:
    """Values for text that belongs to no panel (an album's title, synopsis and 主演): the series
    variables over the panel-free built-ins — ``{style}`` / ``{画风}`` of the default style and
    ``{<character name or id>}`` of every character in the bible."""
    bible = bible or series.bible
    values: dict[str, str] = {}
    for ch in bible.characters:
        values[ch.name] = values[ch.id] = _tags(
            [*ch.tag_description, *([ch.trigger] if ch.trigger else [])]
        )
    style = bible.style(style_id)
    if style:
        values["style"] = values["画风"] = _tags(style.tag_description)
    values.update(series.variables)
    return values


def _expand_at(text: str, values: dict[str, str], depth: int) -> str:
    """Expand using the caller's remaining budget; preserve escapes until the final pass."""

    def sub(match: re.Match) -> str:
        token = match.group(0)
        if token in ("{{", "}}"):
            return token
        name = match.group(1).strip()
        if name not in values:
            return token
        value = str(values[name])
        return _expand_at(value, values, depth + 1) if depth < MAX_DEPTH else value

    return PATTERN.sub(sub, text)


def expand(text: str, values: dict[str, str]) -> str:
    return _expand_at(text, values, 0).replace("{{", "{").replace("}}", "}") if text else text


_BLANK = "\x00"
_WORD = re.compile(r"\w{1,64}")
_BLANK_RUN = re.compile(r"\x00(?:[ \t]*[、，,/／·][ \t]*\x00)+")
_BLANK_THEN_SEP = re.compile(r"\x00[ \t]*[、，,/／][ \t]*")
_SEP_THEN_BLANK = re.compile(r"[ \t]*[、，,/／][ \t]*\x00")


def display(text: str, values: dict[str, str]) -> str:
    """Reader-facing text (captions, an album's title, synopsis and 主演): :func:`expand`, except
    that a ``{name}`` that stays unresolved is blanked the way the legacy books blanked caption
    variables, instead of showing ``{female_name}`` to the reader.  One separator next to a blanked
    name goes with it (``七海、{a}、{b}`` → ``七海``); ``{{`` / ``}}`` escapes still print braces and
    braces that are not a plain name (``{a|b}``, ``{ x }``) are left alone."""
    if not text:
        return text

    def one(s: str, depth: int) -> str:
        def sub(m: re.Match) -> str:
            token = m.group(0)
            if token in ("{{", "}}"):
                return token
            name = m.group(1).strip()
            if name not in values:
                return _BLANK if _WORD.fullmatch(name) else token
            value = str(values[name])
            if not value.strip():
                return _BLANK  # an empty value takes its separator along, like a missing one
            return one(value, depth + 1) if depth < MAX_DEPTH else value

        return PATTERN.sub(sub, s)

    out = one(text, 0)
    if _BLANK in out:
        out = _BLANK_RUN.sub(_BLANK, out)
        out = _BLANK_THEN_SEP.sub("", out)
        out = _SEP_THEN_BLANK.sub("", out)
        out = re.sub(r"[ \t]{2,}", " ", out.replace(_BLANK, "")).strip()
    return out.replace("{{", "{").replace("}}", "}")


def unknown(text: str, values: dict[str, str]) -> list[str]:
    """Names in ``text`` that would stay unresolved (shown as warnings in the UI)."""
    return sorted(
        {
            m.group(1).strip()
            for m in PATTERN.finditer(text or "")
            if m.group(1) and m.group(1).strip() not in values
        }
    )


def trace(text: str, values: dict[str, str]) -> list[dict]:
    """Explain actual variable references without re-scanning expanded escaped braces.

    Diagnostics never change expansion or reject author text. ``chain`` includes each
    referenced key from the source field to this entry, including a repeated cycle key.
    """
    rows, seen = [], set()

    def visit(source: str, chain: tuple[str, ...], depth: int) -> None:
        for match in PATTERN.finditer(source or ""):
            if not match.group(1):
                continue
            key = match.group(1).strip()
            path = (*chain, key)
            if path in seen:
                continue
            seen.add(path)
            raw = str(values[key]) if key in values else None
            if raw is None:
                status = "missing"
            elif key in chain:
                status = "cycle"
            elif not raw.strip():
                status = "empty"
            elif depth >= MAX_DEPTH and any(m.group(1) for m in PATTERN.finditer(raw)):
                status = "depth_limit"
            else:
                status = "resolved"
            value = raw
            if value is not None:
                if depth < MAX_DEPTH:
                    value = _expand_at(value, values, depth + 1)
                value = value.replace("{{", "{").replace("}}", "}")
            rows.append(
                {
                    "key": key,
                    "value": value,
                    "status": status,
                    "chain": list(path),
                }
            )
            if status == "resolved" and depth < MAX_DEPTH:
                visit(raw, path, depth + 1)

    visit(text, (), 0)
    return rows
