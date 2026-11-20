"""Story projection, reviewable field/sentence diffs and model conversion."""

from __future__ import annotations

import json
from difflib import SequenceMatcher

from ..models import Bible, Dialogue, DialogueKind, Episode, Panel, PanelCharacter, Series
from . import script as S
from .story import split_times, to_story

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


def _changes(old: dict, new: dict, fields) -> dict:
    return {f: [old.get(f), new.get(f)] for f in fields if old.get(f) != new.get(f)}


def normalized_view(series: Series, episode: Episode) -> dict:
    """The story view exactly as a revised answer will look after normalization."""
    return S.normalize_story(split_times(to_story(series, episode))[0])


def _dialogue_edits(before: list[dict], after: list[dict]):
    """Use original coordinates so accepting a deletion never shifts another edit."""

    def key(line):
        return json.dumps(line, sort_keys=True, ensure_ascii=False)

    matcher = SequenceMatcher(None, list(map(key, before)), list(map(key, after)), autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        paired = min(i2 - i1, j2 - j1)
        for offset in range(paired):
            yield "replace", i1 + offset, j1 + offset, before[i1 + offset], after[j1 + offset]
        for index in range(i1 + paired, i2):
            yield "remove", index, j2, before[index], None
        for index in range(j1 + paired, j2):
            yield "add", i2, index, None, after[index]


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

    def fields(kind: str, before: dict, after: dict, names, summary: str, blocked=None):
        for field, pair in _changes(before, after, names).items():
            add(
                {
                    "op": kind,
                    "target": after["id"],
                    "changes": {field: pair},
                    "after": after,
                    "summary": f"{summary}：{LABELS[field]}",
                    "blocked": blocked,
                }
            )

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
        else:
            fields(
                "update_character", old_chars[ch["id"]], ch, VIEW_CHAR, f"修改角色「{ch['name']}」"
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
        else:
            fields(
                "update_location",
                old_locs[sc["id"]],
                sc,
                VIEW_LOC,
                f"修改场景「{sc['location']}」",
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
                    "after_panels": new_ids[:idx],
                    "before_panels": new_ids[idx + 1 :],
                    "index": idx,
                    "summary": f"新增一格（新第 {idx + 1} 格）",
                    "after": pv,
                }
            )
        else:
            before = old_views[pv["id"]]
            blocked = "已锁定" if old.locked else None
            fields("update_panel", before, pv, VIEW_PANEL[:-1], f"第 {old.order + 1} 格", blocked)
            for action, index, order, line_before, line_after in _dialogue_edits(
                before["dialogue"], pv["dialogue"]
            ):
                add(
                    {
                        "op": "update_panel",
                        "target": pv["id"],
                        "dialogue_action": action,
                        "dialogue_index": index,
                        "dialogue_order": order,
                        "changes": {
                            "dialogue": [
                                [line_before] if line_before is not None else [],
                                [line_after] if line_after is not None else [],
                            ]
                        },
                        "after": pv,
                        "summary": f"第 {old.order + 1} 格：对白第 {index + 1} 句"
                        f"（{ {'replace': '修改', 'remove': '删除', 'add': '新增'}[action] }）",
                        "blocked": blocked,
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
