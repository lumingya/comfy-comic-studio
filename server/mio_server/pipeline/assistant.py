"""Structured script assistant with a reviewable diff (ROADMAP P2 「结构化剧本助手：可审阅 diff」).

Flow: :func:`propose` asks the LLM to revise the current script (story JSON in, story JSON out)
and turns the answer into a list of small operations.  The UI shows them as a diff; the user
accepts any subset and :func:`apply` writes exactly those, atomically, against the revision the
proposal was made from.  Locked panels are never touched (their ops come back ``blocked``), and
only script fields change — overrides, strip layout, references and takes stay as they are.
"""

from __future__ import annotations

import copy
import json

from ..models import Bible, Character, Dialogue, DialogueKind, Episode, Panel, Series
from ..storage import Conflict
from . import script as S
from .assistant_story import (
    LABELS as LABELS,
)
from .assistant_story import (
    VIEW_CHAR,
    VIEW_LOC,
    VIEW_PANEL,
    _dialogue_edits,
    _dialogues,
    normalized_view,
    panel_from_view,
)
from .assistant_story import (
    _cast as _cast,
)
from .assistant_story import (
    _changes as _changes,
)
from .assistant_story import (
    diff as diff,
)
from .story import from_story, split_times, to_story

REVISE_PROMPT = """你是条漫剧本编辑。下面是当前剧本 JSON 和用户的修改要求。
按要求修改后输出**完整的**剧本 JSON（字段结构与输入完全相同），不要任何解释。
- 没改动的格、角色、场景必须原样保留，包括 id；新增的格用新的 id（如 "p_new1"）。
- 所有角色都是成年人，内容全年龄向；对白每句不超过 {max_chars} 个汉字。
- 取值范围与原剧本一致：shot ∈ extreme_close|close|medium|cowboy|full|wide；
  angle ∈ eye|high|low|side|back|dutch；dialogue.kind ∈ speech|thought|narration|sfx。"""


class AssistantError(ValueError):
    pass


def _character_patch(ch: Character, changes: dict) -> None:
    for field, (_, value) in changes.items():
        if field == "tags":
            ch.tag_description = [tag for tag in value if tag != ch.trigger]
        else:
            setattr(ch, field, copy.deepcopy(value))


def _checked_changes(op: dict, current: dict, fields) -> dict:
    changes = op.get("changes")
    if not isinstance(changes, dict) or not changes or set(changes) - set(fields):
        raise AssistantError("修改操作含无效字段")
    for field, pair in changes.items():
        if not isinstance(pair, list) or len(pair) != 2:
            raise AssistantError("修改操作缺少修改前后的值")
        if current.get(field) != pair[0]:
            raise Conflict(f"审阅内容已改变：{op['target']} / {field}")
        if type(pair[1]) is not type(pair[0]) or pair[0] == pair[1]:
            raise AssistantError("修改操作的字段类型无效或没有差异")
        if field in {"tags", "signature"} and any(not isinstance(tag, str) for tag in pair[1]):
            raise AssistantError("标签与标志特征必须为文字列表")
        if op["after"].get(field) != pair[1]:
            raise AssistantError("修改操作与展示的差异不一致")
    return changes


def _sentence_edit(op: dict, before: list[dict]) -> tuple:
    action, index, order = (
        op.get("dialogue_action"),
        op.get("dialogue_index"),
        op.get("dialogue_order"),
    )
    changes = op.get("changes")
    if not isinstance(changes, dict):
        raise AssistantError("无效的逐句修改操作")
    pair = changes.get("dialogue")
    lengths = {"add": (0, 1), "remove": (1, 0), "replace": (1, 1)}
    if (
        not isinstance(action, str)
        or action not in lengths
        or type(index) is not int
        or type(order) is not int
        or order < 0
        or not 0 <= index <= len(before)
        or not isinstance(pair, list)
        or len(pair) != 2
        or any(not isinstance(lines, list) for lines in pair)
        or tuple(map(len, pair)) != lengths[action]
        or set(changes) != {"dialogue"}
    ):
        raise AssistantError("无效的逐句修改操作")
    old, new = pair
    if action != "add" and (index == len(before) or before[index] != old[0]):
        raise Conflict(f"审阅对白已改变：{op['target']} / {index + 1}")
    if new:
        line = new[0]
        if (
            not isinstance(line, dict)
            or set(line) != {"speaker", "kind", "text"}
            or not all(isinstance(value, str) for value in line.values())
            or line["kind"] not in DialogueKind._value2member_map_
            or not line["text"].strip()
            or old == new
        ):
            raise AssistantError("无效的对白内容")
        _dialogues({"dialogue": new})  # validate before the transaction can commit
    return action, index, order, old[0] if old else None, new[0] if new else None


def _merge_dialogue(original: list[Dialogue], edits: list[tuple]) -> list[Dialogue]:
    replacements, additions = {}, {}
    for action, index, order, before, after in edits:
        if action == "add":
            additions.setdefault(index, []).append((order, after))
        else:
            if index in replacements:
                raise AssistantError("同一句对白有重复操作")
            replacements[index] = (before, after)
    result = []
    for index in range(len(original) + 1):
        for _, line in sorted(additions.get(index, []), key=lambda item: item[0]):
            result.extend(_dialogues({"dialogue": [line]}))
        if index == len(original):
            break
        if index not in replacements:
            result.append(original[index])
            continue
        before, after = replacements[index]
        if after is None:
            continue
        line = original[index].model_copy(deep=True)
        # In particular, keep bridge and any story fields that were not edited.
        for field in ("speaker", "kind", "text"):
            if before[field] != after[field]:
                if field == "speaker":
                    line.speaker_id = None if after[field] == S.NARRATOR else after[field]
                else:
                    setattr(line, field, after[field])
        result.append(line)
    return result


def _panel_patch(panel: Panel, changes: dict, bible: Bible) -> None:
    for field, (before, value) in changes.items():
        if field == "dialogue":  # Also handle earlier, whole-dialogue proposals safely.
            panel.dialogues = _merge_dialogue(panel.dialogues, list(_dialogue_edits(before, value)))
        elif field == "characters":
            panel.characters = _cast({field: value}, panel, bible)
        elif field == "tags":
            panel.tags = [tag for tag in value if tag != panel.lighting]
        elif field == "scene":
            panel.location_id = value or None
        else:
            setattr(panel, field, copy.deepcopy(value))


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
    """Apply only accepted deltas, checking their before-values and the episode CAS."""
    ids = [op.get("id") for op in ops]
    if (
        any(not isinstance(oid, str) or not oid for oid in ids)
        or len(set(ids)) != len(ids)
        or set(accepted) - set(ids)
    ):
        raise AssistantError("审阅操作标识无效或重复")
    chosen = [op for op in ops if op["id"] in set(accepted) and not op.get("blocked")]
    # Bible edits and the episode CAS are one write. A stale revision or invalid
    # operation must also undo earlier series edits and any episode snapshots.
    with store.tx():
        episode = store.get_episode(episode_id)
        series = store.get_series(episode.series_id)
        current = normalized_view(series, episode)
        views = {
            "character": {view["id"]: view for view in current["characters"]},
            "location": {view["id"]: view for view in current["scenes"]},
            "panel": {view["id"]: view for view in current["panels"]},
        }
        fields = {"character": VIEW_CHAR, "location": VIEW_LOC, "panel": VIEW_PANEL}
        touched = set()
        sentence_edits = {}
        for op in chosen:
            kind, target = op.get("op"), op.get("target")
            if not isinstance(kind, str) or not isinstance(target, str) or not target:
                raise AssistantError("无效的审阅操作")
            if kind == "reorder":
                order = op.get("order")
                if (
                    target != episode.id
                    or not isinstance(order, list)
                    or any(not isinstance(pid, str) for pid in order)
                    or len(set(order)) != len(order)
                ):
                    raise AssistantError("无效的分幕顺序")
                key = (kind, target)
            elif kind == "remove_panel":
                panel = episode.panel(target)
                if panel is None:
                    raise Conflict("要删除的分幕已不存在")
                if panel.locked:
                    raise Conflict("不能修改已锁定的分幕")
                key = ("panel", target, "remove")
            elif kind in {
                "add_character",
                "add_location",
                "add_panel",
                "update_character",
                "update_location",
                "update_panel",
            }:
                action, entity = kind.split("_", 1)
                view = op.get("after")
                if not isinstance(view, dict) or view.get("id") != target:
                    raise AssistantError("审阅操作缺少目标内容")
                if action == "add":
                    if target in views[entity]:
                        raise Conflict("要新增的审阅对象已存在")
                    key = (entity, target, "add")
                else:
                    before = views[entity].get(target)
                    if before is None:
                        raise Conflict("审阅对象已不存在")
                    if entity == "panel":
                        panel = episode.panel(target)
                        if panel.locked:
                            raise Conflict("不能修改已锁定的分幕")
                        # Validate the complete proposal without writing undisplayed fields.
                        panel_from_view(view, panel, series.bible)
                    if "dialogue_action" in op:
                        if entity != "panel":
                            raise AssistantError("逐句操作必须指向分幕")
                        edit = _sentence_edit(op, before["dialogue"])
                        sentence_edits.setdefault(target, []).append(edit)
                        key = (
                            entity,
                            target,
                            "sentence",
                            edit[1],
                            edit[2] if edit[0] == "add" else -1,
                        )
                    else:
                        changes = _checked_changes(op, before, fields[entity])
                        keys = {(entity, target, field) for field in changes}
                        if touched & keys:
                            raise AssistantError("同一字段有重复操作")
                        touched.update(keys)
                        continue
            else:
                raise AssistantError("不支持的审阅操作")
            if key in touched:
                raise AssistantError("审阅操作重复")
            touched.add(key)
        for target in sentence_edits:
            if ("panel", target, "dialogue") in touched:
                raise AssistantError("不能混用整组与逐句对白操作")
        removed = {op["target"] for op in chosen if op["op"] == "remove_panel"}
        if any(op["op"] == "update_panel" and op["target"] in removed for op in chosen):
            raise AssistantError("不能同时删除和修改同一分幕")
        known = set(views["panel"]) | {op["target"] for op in chosen if op["op"] == "add_panel"}
        if any(op["op"] == "reorder" and set(op["order"]) - known for op in chosen):
            # A reorder can still name additions whose checkbox was rejected.
            proposed = {op.get("target") for op in ops if op.get("op") == "add_panel"}
            if any(op["op"] == "reorder" and set(op["order"]) - known - proposed for op in chosen):
                raise AssistantError("分幕顺序含未知目标")
        series_ops = [op for op in chosen if op["op"].endswith(("_character", "_location"))]
        if series_ops:

            def patch_series(series: Series) -> None:
                bible = series.bible
                for op in series_ops:
                    view = op["after"]
                    if op["op"] == "add_character":
                        new_bible, _ = from_story(
                            {"title": "x", "characters": [view], "scenes": [], "panels": []},
                            series.id,
                        )
                        bible.characters.extend(new_bible.characters)
                    elif op["op"] == "update_character" and (ch := bible.character(op["target"])):
                        _character_patch(ch, op["changes"])
                    elif op["op"] == "add_location":
                        new_bible, _ = from_story(
                            {"title": "x", "characters": [], "scenes": [view], "panels": []},
                            series.id,
                        )
                        bible.locations.extend(new_bible.locations)
                    elif op["op"] == "update_location" and (loc := bible.location(op["target"])):
                        for field, (_, value) in op["changes"].items():
                            setattr(
                                loc, "name" if field == "location" else field, copy.deepcopy(value)
                            )

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
                    if "dialogue_action" not in op:
                        _panel_patch(target, op["changes"], bible)
            for target, edits in sentence_edits.items():
                if target not in panels:
                    raise AssistantError("不能同时删除和修改同一分幕")
                panels[target].dialogues = _merge_dialogue(panels[target].dialogues, edits)
            # Insert in proposal order, using all preceding anchors rather than reversing
            # consecutive additions that used to share a single original anchor.
            additions = sorted(
                (op for op in chosen if op["op"] == "add_panel"), key=lambda op: op.get("index", 0)
            )
            for op in additions:
                panel = panel_from_view(op["after"], None, bible)
                panels[panel.id] = panel
                anchors = op.get("after_panels", [op.get("after_panel")])
                anchor = next((pid for pid in reversed(anchors) if pid in sequence), None)
                following = next(
                    (pid for pid in op.get("before_panels", []) if pid in sequence), None
                )
                pos = (
                    sequence.index(anchor) + 1
                    if anchor
                    else sequence.index(following)
                    if following
                    else 0
                )
                sequence.insert(pos, panel.id)
            reorder = next((op for op in chosen if op["op"] == "reorder"), None)
            if reorder:
                wanted = [pid for pid in reorder["order"] if pid in panels]
                original = [pid for pid in sequence if pid in wanted]
                if any(
                    panels[pid].locked and original.index(pid) != wanted.index(pid)
                    for pid in original
                ):
                    raise Conflict("不能移动已锁定的分幕")
                replacement = iter(wanted)
                sequence = [next(replacement) if pid in wanted else pid for pid in sequence]
            for i, pid in enumerate(sequence):
                panels[pid].order = i
            ep.panels = [panels[pid] for pid in sequence]

        episode = store.update_episode(episode_id, patch_episode, expected_revision=base_revision)
        return {"applied": applied, "revision": episode.revision}


def generate_episode(series: Series, sentence: str, llm, order: int) -> tuple[Bible, Episode]:
    """One sentence → a new episode (and bible entries) via the spike's validated generator."""
    story, _ = S.generate_script(sentence, llm)
    return from_story(story, series.id, order=order)
