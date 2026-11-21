"""Apply resolved LoRA selections to copied native node input shapes."""

import copy
import re

from .workflow_slot_common import LibraryError, _consumer_index, _is_link, _is_number, _write_field
from .workflow_slot_syntax import format_tag, lora_display_name
from .workflow_slot_values import _is_empty_name, _name_key


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


def _apply_stack(workflow, lora, loras):
    node = workflow.get(lora["nodeId"])
    if not isinstance(node, dict):
        raise LibraryError("LoRA 堆栈节点不存在")
    slots = copy.deepcopy(lora["slots"])
    if not slots:
        raise LibraryError("节点没有可识别的 LoRA 输入")
    object_style = slots[0]["objectStyle"]
    if len(loras) > len(slots):
        if not object_style:
            raise LibraryError(
                "LoRA 堆栈只有 %d 个位置，无法放下 %d 个 LoRA" % (len(slots), len(loras))
            )
        template = node["inputs"][slots[0]["namePath"]]
        base, suffix = slots[0]["namePrefix"], slots[0]["nameSuffix"]
        next_index = max(s["index"] for s in slots) + 1
        while len(slots) < len(loras):
            token = str(next_index).rjust(len(slots[0]["slotToken"]), "0")
            path = base + token + suffix
            node["inputs"][path] = copy.deepcopy(template)
            slots.append({**slots[0], "index": next_index, "slotToken": token, "namePath": path})
            next_index += 1
    # Pins omit empty placeholders. Retain each existing occurrence in its native slot
    # rather than compacting a sparse stack and exchanging slot-specific metadata.
    names = []
    for slot in slots:
        raw = node["inputs"][slot["namePath"]]
        name = (
            (raw.get("lora") if raw.get("lora") is not None else raw.get("name"))
            if slot["objectStyle"]
            else raw
        )
        names.append(None if _is_empty_name(name) else _name_key(str(name)))
    assigned, pending = {}, []
    for item in loras:
        name = _name_key(item["name"])
        index = next((i for i, old in enumerate(names) if old == name and i not in assigned), None)
        if index is None:
            pending.append(item)
        else:
            assigned[index] = item
    free = [i for i in range(len(slots)) if i not in assigned]
    assigned.update(zip(free, pending))
    for i, slot in enumerate(slots):
        l = assigned.get(i)
        if (
            l is None
            and names[i] is None
            and (slot["objectStyle"] or i < max(assigned, default=-1))
        ):
            continue
        if slot["objectStyle"]:
            if l is None:
                del node["inputs"][slot["namePath"]]
                continue
            entry = node["inputs"][slot["namePath"]]
            if (
                entry.get("on") is False
                and not l.get("enabled", True)
                and entry.get("strength") == l["strength"]
                and entry.get("strengthTwo") == l.get("clip")
            ):
                # A native gate already disables this unchanged pin. Editing another
                # position must not erase its saved weights or optional widget values.
                continue
            if "lora" in entry or "name" not in entry:
                entry["lora"] = lora_display_name(l["name"], "file")
            else:
                entry["name"] = lora_display_name(l["name"], "file")
            enabled = l.get("enabled", True)
            entry["on"] = enabled
            entry["strength"] = l["strength"] if enabled else 0
            if "strengthTwo" in entry:
                entry["strengthTwo"] = (l["clip"] if "clip" in l else None) if enabled else 0
            continue
        switch_value = node["inputs"][slot["switchPath"]] if slot["switchPath"] else None
        on, off = (True, False) if isinstance(switch_value, bool) else ("On", "Off")
        if l is not None:
            strength = node["inputs"].get(slot["strengthPath"])
            clip = node["inputs"].get(slot["clipPath"])
            if (
                (switch_value is False or switch_value == "Off")
                and not l.get("enabled", True)
                and l["strength"] == (strength if _is_number(strength) else 1)
                and l.get("clip") == (clip if _is_number(clip) else None)
            ):
                continue
            _write_field(
                workflow, lora["nodeId"], slot["namePath"], lora_display_name(l["name"], "file")
            )
            enabled = l.get("enabled", True)
            for key in slot["strengthPaths"]:
                _write_field(workflow, lora["nodeId"], key, l["strength"] if enabled else 0)
            for key in slot["clipPaths"]:
                _write_field(
                    workflow, lora["nodeId"], key, l.get("clip", l["strength"]) if enabled else 0
                )
            if slot["switchPath"]:
                _write_field(workflow, lora["nodeId"], slot["switchPath"], on if enabled else off)
        elif slot["switchPath"]:
            _write_field(workflow, lora["nodeId"], slot["switchPath"], off)
        else:
            _write_field(workflow, lora["nodeId"], slot["namePath"], "None")
            for key in slot["strengthPaths"]:
                _write_field(workflow, lora["nodeId"], key, 0)
            for key in slot["clipPaths"]:
                _write_field(workflow, lora["nodeId"], key, 0)
    for count in ("lora_count", "num_loras"):
        if count in node["inputs"]:
            # Count controls commonly expose the first N numbered positions. A sparse
            # surviving pin at position 3 must not be hidden by setting the count to 1.
            first_index = min(slot["index"] for slot in slots)
            extent = max((slots[i]["index"] for i in assigned), default=-(first_index == 0))
            _write_field(workflow, lora["nodeId"], count, extent + (first_index == 0))


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
    if any(not isinstance(e, dict) for e in entries):
        raise LibraryError("LoRA 对象条目无效，请重新分析")
    template = (
        entries[0] if entries else {"name": "", "strength": 1, "active": True, "clipStrength": 1}
    )
    values = []
    occurrences = {}
    for lora in loras:
        name_key = _name_key(lora["name"])
        occurrence = occurrences.get(name_key, 0)
        occurrences[name_key] = occurrence + 1
        originals = [
            entry
            for entry in entries
            if _name_key(entry.get("name", entry.get("lora", ""))) == name_key
        ]
        e = copy.deepcopy(originals[occurrence] if occurrence < len(originals) else template)
        e["lora" if "lora" in e and "name" not in e else "name"] = lora["name"]
        enabled = lora.get("enabled", True)
        e.update(strength=lora["strength"] if enabled else 0, active=enabled)
        if "on" in e:
            e["on"] = enabled
        if "clipStrength" in e:
            e["clipStrength"] = lora.get("clip", lora["strength"]) if enabled else 0
        values.append(e)
    node["inputs"][path] = {**raw, "__value__": values} if wrapped else values
    for text_path in writer.get("textPaths", []):
        node["inputs"][text_path] = " ".join(
            format_tag(lora, "path") for lora in loras if lora.get("enabled", True)
        )
