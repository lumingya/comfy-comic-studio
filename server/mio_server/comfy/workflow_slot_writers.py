"""Apply resolved LoRA selections to copied native node input shapes."""

import copy
import re

from .workflow_slot_common import (
    LORA_TAG,
    LibraryError,
    _consumer_index,
    _is_link,
    _is_number,
    _write_field,
)
from .workflow_slot_syntax import _num, format_tag, lora_display_name
from .workflow_slot_values import _is_empty_name, _name_key, _switch_enabled


def _apply_chain(workflow, lora, loras, notices):
    chain = copy.deepcopy(lora["chain"])
    if not chain:
        raise LibraryError("工作流里没有可用的 LoRA 加载节点")
    while len(chain) < len(loras):
        tail = chain[-1]
        tail_node = workflow[tail["nodeId"]]
        base = re.sub(r":lora\d+$", "", tail["nodeId"])
        n, new_id = 1, base + ":lora1"
        while new_id in workflow:
            n += 1
            new_id = base + ":lora" + str(n)
        clone = copy.deepcopy(tail_node)
        if isinstance(clone.get("_meta"), dict) and clone["_meta"].get("title"):
            clone["_meta"]["title"] = str(clone["_meta"]["title"]) + " · " + str(len(chain) + 1)
        for entry in _consumer_index(workflow).get(tail["nodeId"], []):
            if entry["index"] < len(tail["passthrough"]):
                workflow[entry["consumer"]]["inputs"][entry["key"]] = [new_id, entry["index"]]
        for i, key in enumerate(tail["passthrough"]):
            clone["inputs"][key] = [tail["nodeId"], i]
        workflow[new_id] = clone
        chain.append({**tail, "nodeId": new_id})
    for i, d in enumerate(chain):
        node = workflow[d["nodeId"]]
        if i < len(loras) and loras[i].get("enabled", True):
            l = loras[i]
            _write_field(workflow, d["nodeId"], d["namePath"], lora_display_name(l["name"], "file"))
            if d["strengthPath"]:
                _write_field(workflow, d["nodeId"], d["strengthPath"], l["strength"])
            if d["clipPath"]:
                _write_field(workflow, d["nodeId"], d["clipPath"], l.get("clip", l["strength"]))
            continue
        if i < len(loras):
            l = loras[i]
            _write_field(workflow, d["nodeId"], d["namePath"], lora_display_name(l["name"], "file"))
            if d["strengthPath"]:
                _write_field(workflow, d["nodeId"], d["strengthPath"], 0)
            if d["clipPath"]:
                _write_field(workflow, d["nodeId"], d["clipPath"], 0)
            continue
        users = _consumer_index(workflow).get(d["nodeId"], [])
        bypassable = bool(d["passthrough"]) and all(
            u["index"] < len(d["passthrough"])
            and _is_link(node["inputs"].get(d["passthrough"][u["index"]]), workflow)
            for u in users
        )
        if bypassable:
            for u in users:
                workflow[u["consumer"]]["inputs"][u["key"]] = copy.deepcopy(
                    node["inputs"][d["passthrough"][u["index"]]]
                )
            del workflow[d["nodeId"]]
        else:
            if d["strengthPath"]:
                node["inputs"][d["strengthPath"]] = 0
            if d["clipPath"]:
                node["inputs"][d["clipPath"]] = 0
            notices.append("LoRA 节点 %s 无法绕过，已将其强度设为 0。" % d["nodeId"])


def _changes(before, after):
    return {
        key
        for key in ("name", "strength", "clip", "enabled")
        if before is None
        or before.get(key, True if key == "enabled" else None)
        != after.get(key, True if key == "enabled" else None)
    }


def _object_value(entry):
    name = entry.get("name", entry.get("lora"))
    if _is_empty_name(name):
        return None
    value = {
        "name": name,
        "strength": _num(entry.get("strength", 1)),
        "enabled": entry.get("active") is not False and entry.get("on") is not False,
    }
    if entry.get("clipStrength") not in (None, ""):
        value["clip"] = _num(entry["clipStrength"])
    return value


def _assign_existing(originals, loras):
    """Match occurrences before adding anything, retaining each native position."""
    assigned, pending = {}, []
    for item in loras:
        name = _name_key(item["name"])
        index = next(
            (
                i
                for i, old in enumerate(originals)
                if old is not None and _name_key(old["name"]) == name and i not in assigned
            ),
            None,
        )
        if index is None:
            pending.append(item)
        else:
            assigned[index] = item
    return assigned, pending


def _edit_object(entry, before, item, *, power=False):
    changes = _changes(before, item)
    if not changes:
        return
    if "name" in changes:
        entry["lora" if "lora" in entry and "name" not in entry else "name"] = item["name"]
    enabled = item.get("enabled", True)
    gates = [key for key in (("on",) if power else ("active", "on")) if key in entry]
    if "enabled" in changes:
        for key in gates or (["on"] if power else ["active"]):
            entry[key] = enabled
    disabling = "enabled" in changes and not enabled
    if "strength" in changes or disabling:
        entry["strength"] = 0 if disabling else item["strength"]
    clip_key = "strengthTwo" if power else "clipStrength"
    if clip_key in entry and ("clip" in changes or disabling):
        entry[clip_key] = 0 if disabling else item.get("clip", None if power else item["strength"])


def _switch_value(previous, enabled):
    if isinstance(previous, bool):
        return enabled
    if _is_number(previous):
        return type(previous)(enabled)
    return "On" if enabled else "Off"


def _stack_value(inputs, slot):
    raw = inputs[slot["namePath"]]
    if slot["objectStyle"]:
        name = raw.get("lora") if raw.get("lora") is not None else raw.get("name")
        if _is_empty_name(name):
            return None
        item = {
            "name": str(name),
            "strength": raw["strength"] if _is_number(raw.get("strength")) else 1,
            "enabled": raw.get("on") is not False,
        }
        if _is_number(raw.get("strengthTwo")):
            item["clip"] = raw["strengthTwo"]
        return item
    if _is_empty_name(raw):
        return None
    switch = inputs[slot["switchPath"]] if slot["switchPath"] else True
    strength = inputs.get(slot["strengthPath"])
    clip = inputs.get(slot["clipPath"])
    item = {
        "name": str(raw),
        "strength": strength if _is_number(strength) else 1,
        "enabled": _switch_enabled(switch),
    }
    if _is_number(clip):
        item["clip"] = clip
    return item


def _apply_stack(workflow, lora, loras):
    node = workflow.get(lora["nodeId"])
    if not isinstance(node, dict):
        raise LibraryError("LoRA 堆栈节点不存在")
    slots = copy.deepcopy(lora["slots"])
    if not slots:
        raise LibraryError("节点没有可识别的 LoRA 输入")
    inputs = node["inputs"]
    originals = [_stack_value(inputs, slot) for slot in slots]
    assigned, pending = _assign_existing(originals, loras)
    free = [i for i in range(len(slots)) if i not in assigned]
    while len(free) < len(pending):
        template = next((slot for slot in slots if slot["objectStyle"]), None)
        if template is None:
            raise LibraryError(
                "LoRA 堆栈只有 %d 个位置，无法放下 %d 个 LoRA" % (len(slots), len(loras))
            )
        index = max(slot["index"] for slot in slots) + 1
        token = str(index).rjust(len(template["slotToken"]), "0")
        path = template["namePrefix"] + token + template["nameSuffix"]
        while path in inputs:
            index += 1
            token = str(index).rjust(len(template["slotToken"]), "0")
            path = template["namePrefix"] + token + template["nameSuffix"]
        inputs[path] = copy.deepcopy(inputs[template["namePath"]])
        free.append(len(slots))
        slots.append({**template, "index": index, "slotToken": token, "namePath": path})
        originals.append(None)
    assigned.update(zip(free, pending))
    membership_changed = bool(pending) or any(
        item is not None and i not in assigned for i, item in enumerate(originals)
    )
    for i, slot in enumerate(slots):
        item, before = assigned.get(i), originals[i]
        if item is None and before is None:
            continue
        if slot["objectStyle"]:
            if item is None:
                del inputs[slot["namePath"]]
            else:
                _edit_object(inputs[slot["namePath"]], before, item, power=True)
            continue
        switch_path = slot["switchPath"]
        if item is None:
            if switch_path:
                _write_field(
                    workflow,
                    lora["nodeId"],
                    switch_path,
                    _switch_value(inputs[switch_path], False),
                )
            else:
                _write_field(workflow, lora["nodeId"], slot["namePath"], "None")
                for key in set(slot["strengthPaths"] + slot["clipPaths"]):
                    _write_field(workflow, lora["nodeId"], key, 0)
            continue
        changes = _changes(before, item)
        if not changes:
            continue
        enabled = item.get("enabled", True)
        if (
            set(slot["strengthPaths"]) & set(slot["clipPaths"])
            and enabled
            and item.get("clip", item["strength"]) != item["strength"]
        ):
            raise LibraryError("此 LoRA 位置共用模型与 CLIP 强度，请使用相同权重或切换高级模式")
        if "name" in changes:
            _write_field(workflow, lora["nodeId"], slot["namePath"], item["name"])
        disabling = "enabled" in changes and not enabled
        for paths, field in ((slot["strengthPaths"], "strength"), (slot["clipPaths"], "clip")):
            if field in changes or disabling:
                for key in paths:
                    _write_field(
                        workflow,
                        lora["nodeId"],
                        key,
                        0 if disabling else item.get(field, item["strength"]),
                    )
        if switch_path and "enabled" in changes:
            _write_field(
                workflow,
                lora["nodeId"],
                switch_path,
                _switch_value(inputs[switch_path], enabled),
            )
    if membership_changed:
        for count in ("lora_count", "num_loras"):
            if count not in inputs:
                continue
            first_index = min(slot["index"] for slot in slots)
            extent = max((slots[i]["index"] for i in assigned), default=-(first_index == 0))
            value = extent + (first_index == 0)
            if any(slot.get("preserveEmpty") for slot in slots):
                value = max(inputs[count], value)
            if inputs[count] != value:
                _write_field(workflow, lora["nodeId"], count, value)


def _write_object(wf, writer, loras):
    node = wf[writer["nodeId"]]
    path = writer["path"]
    raw = node["inputs"][path]
    if (
        _is_link(raw, wf)
        or not isinstance(raw, (dict, list))
        or isinstance(raw, dict)
        and not isinstance(raw.get("__value__"), list)
    ):
        raise LibraryError("LoRA 对象字段已连线或形态已变化，请重新分析")
    wrapped = isinstance(raw, dict)
    entries = raw["__value__"] if wrapped else raw
    if any(not isinstance(entry, dict) for entry in entries):
        raise LibraryError("LoRA 对象条目无效，请重新分析")
    originals = [_object_value(entry) for entry in entries]
    assigned, pending = _assign_existing(originals, loras)
    template = next(
        (entry for entry, value in zip(entries, originals) if value is not None),
        {"name": "", "strength": 1, "active": True, "clipStrength": 1},
    )
    values = []
    for i, entry in enumerate(entries):
        item = assigned.get(i)
        if item is None and originals[i] is not None:
            continue
        value = copy.deepcopy(entry)
        if item is not None:
            _edit_object(value, originals[i], item)
        values.append(value)
    for item in pending:
        value = copy.deepcopy(template)
        _edit_object(value, None, item)
        values.append(value)
    node["inputs"][path] = {**raw, "__value__": values} if wrapped else values
    for text_path in writer.get("textPaths", []):
        text = node["inputs"].get(text_path)
        if isinstance(text, str):
            node["inputs"][text_path] = _mirror_object_tags(text, originals, assigned, pending)


def _mirror_object_tags(text, originals, assigned, pending):
    """Own only as many same-name tags as there are evidenced object occurrences."""
    owned = {}
    for index, item in enumerate(originals):
        if item is not None:
            owned.setdefault(_name_key(item["name"]), []).append(index)
    matches = list(LORA_TAG.finditer(text))
    if not any(_name_key(match[1].strip()) in owned for match in matches):
        return text
    used, mirrored, unowned = {}, set(), set()

    def replace(match):
        key = _name_key(match[1].strip())
        occurrence = used.get(key, 0)
        used[key] = occurrence + 1
        positions = owned.get(key, [])
        if occurrence >= len(positions):
            unowned.add(key)
            return match[0]
        index = positions[occurrence]
        mirrored.add(index)
        item = assigned.get(index)
        changes = _changes(originals[index], item) if item is not None else set()
        if item is not None and not changes:
            return match[0]
        if item is None or not item.get("enabled", True):
            return ""
        # Keep the spelling and formatting of the tag's untouched components too.
        formatted = LORA_TAG.fullmatch(format_tag(item, "path"))
        edits = []
        for field, group in (("name", 1), ("strength", 2), ("clip", 3)):
            if field not in changes or match[group] is None or formatted[group] is None:
                continue
            edits.append(
                (
                    match.start(group) - match.start(),
                    match.end(group) - match.start(),
                    formatted[group],
                )
            )
        if any(
            field in changes and (match[group] is None or formatted[group] is None)
            for field, group in (("strength", 2), ("clip", 3))
        ):
            return format_tag(item, "path")
        value = match[0]
        for start, end, replacement in reversed(edits):
            value = value[:start] + replacement + value[end:]
        return value

    updated = LORA_TAG.sub(replace, text)
    additions = [
        format_tag(item, "path")
        for item in [
            *(item for index, item in assigned.items() if index not in mirrored),
            *pending,
        ]
        if item.get("enabled", True) and _name_key(item["name"]) not in unowned
    ]
    if additions:
        updated += ("" if not updated or updated[-1].isspace() else " ") + " ".join(additions)
    return updated
