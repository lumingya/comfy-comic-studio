"""Bridge between the v3 domain model and the spike's story dict.

The spike's compiler (``prompts``), VLM judge (``judge``) and strip layout (``layout``) were
validated on a plain dict ("story") format.  Rather than re-implementing them, the v3 pipeline
projects ``Series + Episode (+ VariantSet)`` onto that format, and imports LLM scripts / the
golden story back into v3 objects.
"""

from __future__ import annotations

import copy
import re

from ..models import (
    Bible,
    Character,
    Dialogue,
    DialogueKind,
    Episode,
    Gender,
    Location,
    Panel,
    PanelCharacter,
    Series,
    Style,
    VariantSet,
)
from . import script as S

ROMAN = re.compile(r"^[a-z][a-z0-9_]*$")


def apply_variant(bible: Bible, variant: VariantSet | None) -> Bible:
    """Batch variants: patch characters (appearance / tags / loras …) for one render set."""
    if variant is None or not variant.characters:
        return bible
    data = bible.model_dump()
    for ch in data["characters"]:
        patch = variant.characters.get(ch["id"])
        if patch:
            ch.update({k: copy.deepcopy(v) for k, v in patch.items() if k != "id"})
    return Bible.model_validate(data)


def _gender(value: Gender) -> str:
    return value.value if value in (Gender.female, Gender.male) else ""


def character_view(ch: Character) -> dict:
    generated = re.fullmatch(r"char_[0-9a-f]{12}", ch.id) is not None
    return {
        "id": ch.id,
        "name": ch.name,
        "label": ch.name if generated else None,
        "gender": _gender(ch.gender),
        "age": ch.age,
        "tags": list(ch.tag_description) + ([ch.trigger] if ch.trigger else []),
        "signature": list(ch.signature) or list(ch.appearance)[:4],
        "description": ch.description or ", ".join(ch.appearance),
    }


def panel_view(bible: Bible, panel: Panel) -> dict:
    loc = bible.location(panel.location_id)
    cast = []
    for pc in panel.characters:
        ch = bible.character(pc.character_id)
        outfit = (ch.outfits.get(pc.outfit) if ch else None) or []
        cast.append(
            {
                "id": pc.character_id,
                "expression": pc.expression if pc.expression != "neutral" else "",
                "action": pc.action,
                "tags": list(outfit) + list(pc.tags),
            }
        )
    lines = []
    for d in panel.dialogues:
        speaker = d.speaker_id if d.kind != DialogueKind.narration and d.speaker_id else S.NARRATOR
        lines.append({"speaker": speaker, "kind": d.kind.value, "text": d.text})
    extra = [f"{panel.lighting}"] if panel.lighting else []
    return {
        "id": panel.id,
        "scene": loc.id if loc else "",
        "shot": panel.shot,
        "angle": panel.angle,
        "tags": list(panel.tags) + extra,
        "description": panel.description,
        "characters": cast,
        "dialogue": lines,
        "time": panel.time or (loc.time if loc else ""),
    }


def to_story(series: Series, episode: Episode, variant: VariantSet | None = None) -> dict:
    bible = apply_variant(series.bible, variant)
    scenes = []
    for loc in bible.locations:
        scenes.append(
            {
                "id": loc.id,
                "location": loc.name,
                "time": loc.time or "day",
                "tags": list(loc.tags),
                "description": loc.description,
            }
        )
    panels = [panel_view(bible, p) for p in episode.ordered_panels()]
    # Panel-level time overrides the location's default: emit a per-panel scene copy when needed.
    by_id = {s["id"]: s for s in scenes}
    for pv in panels:
        base = by_id.get(pv["scene"])
        if base and pv["time"] and pv["time"] != base["time"]:
            sid = f"{base['id']}@{pv['time']}"
            if sid not in by_id:
                by_id[sid] = {**base, "id": sid, "time": pv["time"]}
                scenes.append(by_id[sid])
            pv["scene"] = sid
    return {
        "title": series.title,
        "logline": episode.synopsis,
        "characters": [character_view(c) for c in bible.characters],
        "scenes": scenes,
        "panels": panels,
    }


def split_times(story: dict) -> tuple[dict, dict[str, str]]:
    """Undo to_story's per-panel time scene copies (``s1@morning``) before normalizing ids."""
    story = copy.deepcopy(story) if isinstance(story, dict) else {}
    story["scenes"] = [
        sc
        for sc in story.get("scenes") or []
        if not (isinstance(sc, dict) and "@" in str(sc.get("id", "")))
    ]
    times = {}
    for pn in story.get("panels") or []:
        if isinstance(pn, dict) and "@" in str(pn.get("scene") or ""):
            base, _, time = str(pn["scene"]).partition("@")
            pn["scene"] = base
            if time in ("morning", "day", "evening", "night"):
                times[str(pn.get("id"))] = time
    return story, times


def from_story(
    story: dict, series_id: str, title: str | None = None, order: int = 0
) -> tuple[Bible, Episode]:
    """LLM / golden story JSON → v3 bible + episode (ids kept, so re-imports are stable)."""
    story, times = split_times(story)
    story = S.normalize_story(story)
    characters = []
    for ch in story.get("characters") or []:
        gender = ch.get("gender") if ch.get("gender") in ("female", "male") else "unknown"
        characters.append(
            Character(
                id=ch["id"],
                name=ch.get("name") or ch["id"],
                gender=gender,
                age=max(18, ch.get("age") or 20),
                tag_description=ch.get("tags") or [],
                signature=ch.get("signature") or [],
                appearance=ch.get("signature") or [],
                description=ch.get("description") or "",
            )
        )
    locations = [
        Location(
            id=sc["id"],
            name=sc.get("location") or sc["id"],
            description=sc.get("description") or "",
            tags=sc.get("tags") or [],
            time=sc["time"] if sc.get("time") in ("morning", "day", "evening", "night") else "",
        )
        for sc in story.get("scenes") or []
    ]
    known = {c.id for c in characters}
    panels = []
    for i, pn in enumerate(story.get("panels") or []):
        cast = [
            PanelCharacter(
                character_id=c["id"],
                expression=c.get("expression") or "neutral",
                action=c.get("action") or "",
                tags=c.get("tags") or [],
            )
            for c in pn.get("characters") or []
            if c.get("id") in known
        ]
        dialogues = [
            Dialogue(
                speaker_id=None if d["speaker"] == S.NARRATOR else d["speaker"],
                text=d["text"],
                kind=d["kind"] if d["kind"] in DialogueKind._value2member_map_ else "speech",
            )
            for d in pn.get("dialogue") or []
        ]
        panels.append(
            Panel(
                id=pn["id"],
                order=i,
                shot=pn["shot"] if pn["shot"] in S.SHOTS else "medium",
                angle=pn["angle"] if pn["angle"] in S.ANGLES else "eye",
                characters=cast,
                location_id=(pn.get("scene") or "").split("@")[0] or None,
                time=times.get(pn["id"], ""),
                description=pn.get("description") or "",
                tags=pn.get("tags") or [],
                dialogues=dialogues,
            )
        )
    bible = Bible(characters=characters, locations=locations, styles=[Style()])
    episode = Episode(
        series_id=series_id,
        title=title or story.get("title") or "第一话",
        order=order,
        synopsis=story.get("logline") or "",
        panels=panels,
    )
    return bible, episode
