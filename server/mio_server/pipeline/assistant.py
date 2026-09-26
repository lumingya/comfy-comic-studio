"""Structured script assistant with a reviewable diff (ROADMAP P2 「结构化剧本助手：可审阅 diff」).

Flow: :func:`propose` asks the LLM to revise the current script (story JSON in, story JSON out)
and turns the answer into a list of small operations.  The UI shows them as a diff; the user
accepts any subset and :func:`apply` writes exactly those, atomically, against the revision the
proposal was made from.  Locked panels are never touched (their ops come back ``blocked``), and
only script fields change — overrides, strip layout, references and takes stay as they are.
"""

from __future__ import annotations

import json

from ..models import (
    Bible,
    Character,
    Dialogue,
    DialogueKind,
    Episode,
    Panel,
    PanelCharacter,
    Series,
)
from . import script as S
from .story import from_story, split_times, to_story

VIEW_PANEL = ("shot", "angle", "scene", "description", "tags", "characters", "dialogue")
VIEW_CHAR = ("name", "tags", "signature", "description")
VIEW_LOC = ("location", "description", "tags")
LABELS = {
    "shot": "景别",
    "angle": "角度",
    "scene": "场景",
    "description": "描述",
    "tags": "标签",
    "characters": "出场角色",
    "dialogue": "对白",
    "name": "名字",
    "signature": "标志特征",
    "location": "名称",
}

REVISE_PROMPT = """你是条漫剧本编辑。下面是当前剧本 JSON 和用户的修改要求。
按要求修改后输出**完整的**剧本 JSON（字段结构与输入完全相同），不要任何解释。
- 没改动的格、角色、场景必须原样保留，包括 id；新增的格用新的 id（如 "p_new1"）。
- 所有角色都是成年人，内容全年龄向；对白每句不超过 {max_chars} 个汉字。
- 取值范围与原剧本一致：shot ∈ extreme_close|close|medium|cowboy|full|wide；
  angle ∈ eye|high|low|side|back|dutch；dialogue.kind ∈ speech|thought|narration|sfx。"""


class AssistantError(ValueError):
    pass


def _changes(old: dict, new: dict, fields) -> dict:
    return {f: [old.get(f), new.get(f)] for f in fields if old.get(f) != new.get(f)}


def _labels(changes: dict) -> str:
    return "、".join(LABELS.get(k, k) for k in changes)


def normalized_view(series: Series, episode: Episode) -> dict:
    """The story view exactly as a revised answer will look after normalization."""
    return S.normalize_story(split_times(to_story(series, episode))[0])


def diff(series: Series, episode: Episode, revised: dict) -> list[dict]:
    """Operations turning the current script view into ``revised`` (a normalized story dict).

    Comparison happens on the story view (what the LLM saw), so v3-only data that the view
    folds or omits (outfits, positions, lighting, overrides) never shows up as a change.
    """
    ops: list[dict] = []
    current = normalized_view(series, episode)

    def add(op: dict) -> None:
        op["id"] = f"op{len(ops) + 1}"
        op.setdefault("blocked", None)
        ops.append(op)

    old_chars = {c["id"]: c for c in current["characters"]}
    for ch in revised.get("characters") or []:
        if ch["id"] not in old_chars:
            add(
                {
                    "op": "add_character",
                    "target": ch["id"],
                    "summary": f"新增角色「{ch['name']}」",
                    "after": ch,
                }
            )
        elif changes := _changes(old_chars[ch["id"]], ch, VIEW_CHAR):
            add(
                {
                    "op": "update_character",
                    "target": ch["id"],
                    "changes": changes,
                    "after": ch,
                    "summary": f"修改角色「{ch['name']}」：{_labels(changes)}",
                }
            )
    old_locs = {x["id"]: x for x in current["scenes"]}
    for sc in revised.get("scenes") or []:
        if sc["id"] not in old_locs:
            add(
                {
                    "op": "add_location",
                    "target": sc["id"],
                    "summary": f"新增场景「{sc['location']}」",
                    "after": sc,
                }
            )
        elif changes := _changes(old_locs[sc["id"]], sc, VIEW_LOC):
            add(
                {
                    "op": "update_location",
                    "target": sc["id"],
                    "changes": changes,
                    "after": sc,
                    "summary": f"修改场景「{sc['location']}」：{_labels(changes)}",
                }
            )

    old_views = {p["id"]: p for p in current["panels"]}
    panels = {p.id: p for p in episode.panels}
    new_panels = [p for p in revised.get("panels") or []]
    new_ids = [p["id"] for p in new_panels]
    for panel in episode.ordered_panels():
        if panel.id not in new_ids:
            add(
                {
                    "op": "remove_panel",
                    "target": panel.id,
                    "summary": f"删除第 {panel.order + 1} 格",
                    "before": old_views[panel.id],
                    "blocked": "已锁定" if panel.locked else None,
                }
            )
    for idx, pv in enumerate(new_panels):
        old = panels.get(pv["id"])
        if old is None:
            anchor = next(
                (new_ids[j] for j in range(idx - 1, -1, -1) if new_ids[j] in panels), None
            )
            add(
                {
                    "op": "add_panel",
                    "target": pv["id"],
                    "after_panel": anchor,
                    "index": idx,
                    "summary": f"新增一格（新第 {idx + 1} 格）",
                    "after": pv,
                }
            )
        elif changes := _changes(old_views[pv["id"]], pv, VIEW_PANEL):
            add(
                {
                    "op": "update_panel",
                    "target": pv["id"],
                    "changes": changes,
                    "after": pv,
                    "summary": f"第 {old.order + 1} 格：{_labels(changes)}",
                    "blocked": "已锁定" if old.locked else None,
                }
            )
    kept_old = [p.id for p in episode.ordered_panels() if p.id in new_ids]
    kept_new = [pid for pid in new_ids if pid in panels]
    if kept_old != kept_new:
        moved = [
            pid
            for pid in kept_old
            if panels[pid].locked and kept_old.index(pid) != kept_new.index(pid)
        ]
        add(
            {
                "op": "reorder",
                "target": episode.id,
                "order": new_ids,
                "summary": "调整格子顺序",
                "blocked": "会移动已锁定的格" if moved else None,
            }
        )
    return ops


# ---------------------------------------------------------------- view → model
def _dialogues(view: dict) -> list[Dialogue]:
    out = []
    for d in view.get("dialogue") or []:
        kind = d.get("kind") if d.get("kind") in DialogueKind._value2member_map_ else "speech"
        speaker = None if d.get("speaker") in (None, S.NARRATOR) else d["speaker"]
        out.append(Dialogue(speaker_id=speaker, text=d["text"], kind=kind))
    return out


def _cast(view: dict, old: Panel | None, bible: Bible) -> list[PanelCharacter]:
    before = {pc.character_id: pc for pc in (old.characters if old else [])}
    cast = []
    for c in view.get("characters") or []:
        prev = before.get(c["id"])
        ch = bible.character(c["id"])
        outfit_tags = set(ch.outfits.get(prev.outfit, []) if ch and prev else [])
        tags = [t for t in c.get("tags") or [] if t not in outfit_tags]
        base = prev.model_dump() if prev else {"character_id": c["id"]}
        cast.append(
            PanelCharacter.model_validate(
                {
                    **base,
                    "expression": c.get("expression") or "neutral",
                    "action": c.get("action") or "",
                    "tags": tags,
                }
            )
        )
    return cast


def panel_from_view(view: dict, old: Panel | None, bible: Bible) -> Panel:
    data = old.model_dump() if old else {"id": view["id"], "order": 0}
    tags = [t for t in view.get("tags") or [] if not (old and old.lighting and t == old.lighting)]
    data.update(
        shot=view["shot"] if view.get("shot") in S.SHOTS else "medium",
        angle=view["angle"] if view.get("angle") in S.ANGLES else "eye",
        location_id=view.get("scene") or None,
        description=view.get("description") or "",
        tags=tags,
    )
    panel = Panel.model_validate(data)
    panel.characters = _cast(view, old, bible)
    panel.dialogues = _dialogues(view)
    return panel


def _character_patch(ch: Character, view: dict) -> None:
    ch.name = view.get("name") or ch.name
    ch.tag_description = [t for t in view.get("tags") or [] if t != ch.trigger]
    ch.signature = list(view.get("signature") or [])
    if view.get("description") and view["description"] != ", ".join(ch.appearance):
        ch.description = view["description"]


def _revise_story(llm, story: dict, instruction: str) -> dict:
    messages = [
        {"role": "system", "content": REVISE_PROMPT.format(max_chars=S.MAX_BUBBLE_CHARS)},
        {
            "role": "user",
            "content": "当前剧本：\n"
            + json.dumps(story, ensure_ascii=False)
            + "\n\n修改要求："
            + instruction.strip(),
        },
    ]
    data, _ = llm.chat_json(
        messages, validate=lambda d: S.validate_story(S.normalize_story(d), 1, 80), repairs=2
    )
    return S.normalize_story(split_times(data)[0])


def propose(series: Series, episode: Episode, instruction: str, llm) -> dict:
    if not instruction.strip():
        raise AssistantError("请写下想怎么改")
    story = to_story(series, episode)
    revised = _revise_story(llm, story, instruction)
    return {
        "episode_id": episode.id,
        "base_revision": episode.revision,
        "instruction": instruction,
        "ops": diff(series, episode, revised),
    }


def apply(store, episode_id: str, ops: list[dict], accepted: list[str], base_revision: int) -> dict:
    """Apply the accepted ops.  Raises storage ``Conflict`` if the episode changed meanwhile."""
    chosen = [op for op in ops if op.get("id") in set(accepted) and not op.get("blocked")]
    episode = store.get_episode(episode_id)
    series_ops = [op for op in chosen if op["op"].endswith(("_character", "_location"))]
    if series_ops:

        def patch_series(series: Series) -> None:
            bible = series.bible
            for op in series_ops:
                view = op["after"]
                if op["op"] == "add_character" and not bible.character(op["target"]):
                    new_bible, _ = from_story(
                        {"title": "x", "characters": [view], "scenes": [], "panels": []}, series.id
                    )
                    bible.characters.extend(new_bible.characters)
                elif op["op"] == "update_character" and (ch := bible.character(op["target"])):
                    _character_patch(ch, view)
                elif op["op"] == "add_location" and not bible.location(op["target"]):
                    new_bible, _ = from_story(
                        {"title": "x", "characters": [], "scenes": [view], "panels": []}, series.id
                    )
                    bible.locations.extend(new_bible.locations)
                elif op["op"] == "update_location" and (loc := bible.location(op["target"])):
                    loc.name = view.get("location") or loc.name
                    loc.description = view.get("description", loc.description)
                    loc.tags = list(view.get("tags") or [])

        store.update_series(episode.series_id, patch_series)
    bible = store.get_series(episode.series_id).bible
    applied = [op["id"] for op in chosen]

    def patch_episode(ep: Episode) -> None:
        panels = {p.id: p for p in ep.panels}
        sequence = [p.id for p in ep.ordered_panels()]
        for op in chosen:
            target = panels.get(op["target"])
            if op["op"] == "remove_panel" and target and not target.locked:
                sequence.remove(target.id)
                del panels[target.id]
            elif op["op"] == "update_panel" and target and not target.locked:
                panels[target.id] = panel_from_view(op["after"], target, bible)
            elif op["op"] == "add_panel" and op["target"] not in panels:
                panel = panel_from_view(op["after"], None, bible)
                panels[panel.id] = panel
                anchor = op.get("after_panel")
                pos = sequence.index(anchor) + 1 if anchor in sequence else 0
                sequence.insert(pos, panel.id)
        reorder = next((op for op in chosen if op["op"] == "reorder"), None)
        if reorder:
            wanted = [pid for pid in reorder["order"] if pid in panels]
            sequence = wanted + [pid for pid in sequence if pid not in wanted]
        for i, pid in enumerate(sequence):
            panels[pid].order = i
        ep.panels = [panels[pid] for pid in sequence]

    episode = store.update_episode(episode_id, patch_episode, expected_revision=base_revision)
    return {"applied": applied, "revision": episode.revision}


def generate_episode(series: Series, sentence: str, llm, order: int) -> tuple[Bible, Episode]:
    """One sentence → a new episode (and bible entries) via the spike's validated generator."""
    story, _ = S.generate_script(sentence, llm)
    return from_story(story, series.id, order=order)
