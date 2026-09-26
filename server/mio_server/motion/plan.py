"""Dynamic comic (动态漫) planning: a camera move, a duration and voice lines for every panel.

Pure functions over the domain model, so the export page can show the plan and the player can be
tested without images.  ``Panel.motion`` overrides the automatic choice per panel:

* move – ``auto`` picks from the shot size, camera angle, SFX and the panel's shape;
* hold – seconds on screen; ``None`` estimates the reading time of the panel's text.

When the player reads the lines aloud it stays on a panel until the voice is done, so ``hold`` is
the minimum, not a hard cut.
"""

from __future__ import annotations

import hashlib
import re

from ..models import DialogueKind, Gender, Panel, Series, parse_ratio

MOVES = ("still", "push_in", "pull_out", "pan_left", "pan_right", "pan_up", "pan_down", "shake")
MIN_HOLD, MAX_HOLD = 2.0, 14.0
BASE_HOLD = 1.6  # time to take in the picture before reading
LINE_PAUSE = 0.35
CJK = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]")
BANG = re.compile(r"[!！]")


def reading_seconds(text: str) -> float:
    """About 6 CJK characters or 15 other characters per second."""
    cjk = len(CJK.findall(text))
    return cjk / 6.0 + (len(text) - cjk) / 15.0


def auto_hold(panel: Panel) -> float:
    lines = [d for d in panel.dialogues if d.kind != DialogueKind.sfx]
    text = sum(reading_seconds(d.text) for d in lines) + LINE_PAUSE * len(lines)
    return round(min(MAX_HOLD, max(MIN_HOLD, BASE_HOLD + text)), 1)


def auto_move(panel: Panel, index: int) -> str:
    """Camera move chosen from what the panel shows; alternates so neighbours differ."""
    sfx = [d for d in panel.dialogues if d.kind == DialogueKind.sfx]
    if sfx and (BANG.search(" ".join(d.text for d in sfx)) or panel.shot != "wide"):
        return "shake"
    if panel.shot in ("extreme_close", "close"):
        return "push_in"
    tall = _ratio(panel) < 0.8
    if panel.shot in ("wide", "full"):
        if panel.angle == "low":
            return "pan_up"
        if panel.angle == "high" or tall:
            return "pan_down"
        return "pan_right" if index % 2 == 0 else "pan_left"
    return "push_in" if index % 2 == 0 else "pull_out"


def _ratio(panel: Panel) -> float:
    try:
        return parse_ratio(panel.aspect_ratio)
    except ValueError:
        return 2 / 3


def voice_for(series: Series, speaker_id: str | None, kind: DialogueKind) -> dict:
    """Stable per-character voice parameters for the browser's speech synthesis."""
    if kind in (DialogueKind.narration, DialogueKind.caption) or not speaker_id:
        return {"id": "narrator", "gender": "unknown", "pitch": 1.0, "rate": 0.95}
    character = next((c for c in series.bible.characters if c.id == speaker_id), None)
    gender = character.gender if character else Gender.unknown
    base = {Gender.female: 1.2, Gender.male: 0.8}.get(gender, 1.0)
    seed = hashlib.sha256(speaker_id.encode("utf-8")).digest()
    pitch = base + (seed[0] / 255 - 0.5) * 0.24
    rate = 1.0 + (seed[1] / 255 - 0.5) * 0.12
    return {
        "id": speaker_id,
        "gender": gender.value,
        "pitch": round(pitch, 2),
        "rate": round(rate, 2),
    }


def lines(series: Series, panel: Panel) -> list[dict]:
    names = {c.id: c.name for c in series.bible.characters}
    out = []
    for d in panel.dialogues:
        if d.kind == DialogueKind.sfx:
            continue
        out.append(
            {
                "text": d.text,
                "kind": d.kind.value,
                "speaker": names.get(d.speaker_id or "", ""),
                "voice": voice_for(series, d.speaker_id, d.kind),
            }
        )
    return out


def plan_panel(series: Series, panel: Panel, index: int) -> dict:
    motion = panel.motion
    chosen_move = motion.move if motion else "auto"
    automatic = auto_move(panel, index)
    hold = auto_hold(panel)
    return {
        "panel_id": panel.id,
        "index": index,
        "move": automatic if chosen_move == "auto" else chosen_move,
        "auto_move": automatic,
        "move_overridden": chosen_move != "auto",
        "hold": motion.hold if motion and motion.hold else hold,
        "auto_hold": hold,
        "lines": lines(series, panel),
        "description": panel.description,
    }


def plan_episode(series: Series, panels: list[Panel]) -> list[dict]:
    return [plan_panel(series, p, i) for i, p in enumerate(panels)]
