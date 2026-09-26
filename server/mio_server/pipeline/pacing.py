"""Automatic pacing (节奏): suggest width modes, ratios, gaps and transition backgrounds.

Rules of thumb from vertical-scroll comics, applied per panel with its neighbours in view:

* a scene opens on an establishing shot: wide → 4:3 (bleed for the very first panel),
  full → 3:4;
* close-ups are square-ish; extreme close-ups become inset beats that zig-zag left / right;
* scenery with nobody speaking dissolves (frameless 16:9); pure inner monologue close-ups too;
* dialogue-heavy panels get taller ratios so bubbles have room;
* gaps: rapid close-up exchanges 24, normal 48, after talk 72, silent beats 96,
  scene change 280, time skip 400, episode end 160;
* transitions: a change of time of day fades the gap between the two moods; night scenes keep
  dark gutters.

``suggest`` is pure and returns reviewable patches; ``apply`` writes the accepted ones with an
optimistic revision check.  Locked panels are never touched.
"""

from __future__ import annotations

from ..models import DialogueKind, Episode, Panel, PanelWidth, Series

FIELDS = ("width_mode", "aspect_ratio", "gap_after", "transition_background", "inset_align")
MOOD = {"morning": "#f7efe2", "day": None, "evening": "#f4c9a1", "night": "#1b1f2e", "": None}
GAPS = {"rapid": 24, "normal": 48, "talk": 72, "beat": 96, "scene": 280, "skip": 400, "end": 160}


def _time(series: Series, panel: Panel) -> str:
    loc = series.bible.location(panel.location_id)
    return panel.time or (loc.time if loc else "") or ""


def _lines(panel: Panel) -> int:
    return sum(1 for d in panel.dialogues if d.kind in (DialogueKind.speech, DialogueKind.thought))


def _inner_only(panel: Panel) -> bool:
    kinds = {d.kind for d in panel.dialogues}
    return bool(kinds) and kinds <= {DialogueKind.thought, DialogueKind.narration}


def _shape(
    panel: Panel, scene_start: bool, last: bool, first: bool = False
) -> tuple[str, str, str]:
    """``(width_mode, aspect_ratio, reason)``.

    Bleed butts both neighbours (no gap), so it is only used where no scene gap is lost: the
    episode's opening panel.
    """
    lines = _lines(panel)
    close = panel.shot in ("extreme_close", "close")
    if first and panel.shot == "wide":
        return "bleed", "4:3", "开篇远景：出血横幅建立空间"
    if scene_start and panel.shot == "wide":
        return "full", "4:3", "换场远景：通栏横幅建立空间"
    if scene_start and panel.shot == "full":
        return "full", "3:4", "场景开场的全景"
    if not panel.characters and lines == 0:
        return "frameless", "16:9", "无人无台词的空镜：无框溶入背景"
    if close and _inner_only(panel):
        return "frameless", "1:1", "内心独白特写：无框"
    if panel.shot == "extreme_close" and not last:
        return "inset", "1:1", "大特写：内嵌小格制造停顿"
    if last:
        return "full", "2:3", "本话最后一格：通栏高幅收尾"
    if panel.shot == "close":
        return ("full", "1:1", "特写：方幅") if lines <= 1 else ("full", "4:5", "特写且台词多")
    if panel.shot == "wide":
        return "full", "4:3", "远景：横幅"
    if lines >= 3:
        return "full", "2:3", "台词多：加高给气泡留位"
    return "full", "3:4", "常规镜头"


def _gap(series, panel, nxt, last) -> tuple[int, str]:
    if last:
        return GAPS["end"], "结尾留白"
    t0, t1 = _time(series, panel), _time(series, nxt)
    if t0 != t1:
        return GAPS["skip"], "时间跳跃：大留白"
    if panel.location_id != nxt.location_id:
        return GAPS["scene"], "换场：大留白"
    if panel.shot in ("extreme_close", "close") and nxt.shot in ("extreme_close", "close"):
        return GAPS["rapid"], "连续特写：紧凑"
    if not panel.dialogues and panel.characters:
        return GAPS["beat"], "无台词：停顿留白"
    if _lines(panel) >= 2:
        return GAPS["talk"], "对话之后稍作停顿"
    return GAPS["normal"], "同场景常规间距"


def _transition(series, panel, nxt, background: str) -> tuple[str, str]:
    t0 = _time(series, panel)
    if nxt is None:
        mood = MOOD.get(t0)
        return (mood, "夜景结尾：暗色收束") if t0 == "night" and mood else ("transparent", "")
    t1 = _time(series, nxt)
    a, b = MOOD.get(t0), MOOD.get(t1)
    if t0 != t1 and (a or b):
        return f"{a or background}>{b or background}", "时间变化：渐变过渡"
    if t0 == t1 == "night":
        return MOOD["night"], "夜景：暗色间隙"
    return "transparent", ""


def suggest(series: Series, episode: Episode) -> list[dict]:
    """``[{panel_id, order, changes: {field: value}, reasons: [..]}]`` for panels that change."""
    panels = episode.ordered_panels()
    background = episode.strip.background
    out, inset_run = [], 0
    for i, panel in enumerate(panels):
        prev = panels[i - 1] if i else None
        nxt = panels[i + 1] if i + 1 < len(panels) else None
        scene_start = prev is None or (
            prev.location_id != panel.location_id or _time(series, prev) != _time(series, panel)
        )
        width, ratio, why_shape = _shape(panel, scene_start, nxt is None, prev is None)
        want: dict = {"width_mode": width, "aspect_ratio": ratio}
        reasons = [why_shape]
        if width == "inset":
            run_next = nxt is not None and _shape(nxt, False, False)[0] == "inset"
            want["inset_align"] = (
                ("left", "right")[inset_run % 2] if inset_run or run_next else "center"
            )
            inset_run += 1
        else:
            inset_run = 0
        gap, why_gap = _gap(series, panel, nxt, nxt is None)
        want["gap_after"] = gap
        reasons.append(why_gap)
        trans, why_trans = _transition(series, panel, nxt, background)
        want["transition_background"] = trans
        if why_trans:
            reasons.append(why_trans)
        if panel.locked:
            continue
        changes = {}
        for key, value in want.items():
            current = getattr(panel, key)
            current = current.value if isinstance(current, PanelWidth) else current
            if current != value:
                changes[key] = value
        if changes:
            out.append(
                {"panel_id": panel.id, "order": panel.order, "changes": changes, "reasons": reasons}
            )
    return out


def apply(store, episode_id: str, patches: list[dict], base_revision: int | None) -> Episode:
    """Write accepted patches (only pacing fields, never locked panels) in one revision."""
    for patch in patches:
        bad = set(patch.get("changes") or {}) - set(FIELDS)
        if bad:
            raise ValueError(
                f"节奏补丁只能修改 {', '.join(FIELDS)}，收到：{', '.join(sorted(bad))}"
            )

    def update(ep: Episode) -> None:
        by_id = {p.get("panel_id"): p.get("changes") or {} for p in patches}
        for idx, panel in enumerate(ep.panels):
            changes = by_id.get(panel.id)
            if changes and not panel.locked:
                ep.panels[idx] = Panel.model_validate({**panel.model_dump(), **changes})

    return store.update_episode(episode_id, update, expected_revision=base_revision)
