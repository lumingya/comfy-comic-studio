"""Read workflow-pinned LoRAs and assign stable per-group identities."""

import copy
import hashlib

from .workflow_slot_common import LibraryError, _is_number
from .workflow_slot_shapes import stack_slots
from .workflow_slot_syntax import _num, parse_lora_syntax, strip_extension


def _is_empty_name(name):
    return name is None or str(name).strip() == "" or str(name) == "None"


def _switch_enabled(value):
    return value is not False and value != "Off" and not (_is_number(value) and value == 0)


def _chain_value(inputs, descriptor):
    name = inputs.get(descriptor["namePath"])
    if _is_empty_name(name):
        return None

    def number(path, default=None):
        raw = inputs.get(path)
        if _is_number(raw) or isinstance(raw, str):
            try:
                return _num(raw)
            except LibraryError:
                pass
        return default

    result = {"name": name, "strength": number(descriptor["strengthPath"], 1)}
    clip = number(descriptor["clipPath"])
    if clip is not None:
        result["clip"] = clip
    return result


def _stack_current_loras(workflow, lora, include_disabled=False):
    node = (workflow or {}).get(lora.get("nodeId"))
    if not isinstance(node, dict):
        return []
    out = []
    for slot in stack_slots(node, workflow):
        raw = node["inputs"][slot["namePath"]]
        if slot["objectStyle"]:
            name = raw.get("lora") if raw.get("lora") is not None else raw.get("name")
            if (raw.get("on") is False and not include_disabled) or _is_empty_name(name):
                continue
            entry = {
                "name": str(name),
                "strength": raw["strength"] if _is_number(raw.get("strength")) else 1,
            }
            if include_disabled:
                entry["enabled"] = raw.get("on") is not False
            if _is_number(raw.get("strengthTwo")):
                entry["clip"] = raw["strengthTwo"]
            out.append(entry)
        else:
            if _is_empty_name(raw):
                continue
            switch = node["inputs"][slot["switchPath"]] if slot["switchPath"] else True
            if not _switch_enabled(switch) and not include_disabled:
                continue
            strength = node["inputs"][slot["strengthPath"]] if slot["strengthPath"] else 1
            clip = node["inputs"][slot["clipPath"]] if slot["clipPath"] else None
            entry = {"name": str(raw), "strength": strength if _is_number(strength) else 1}
            if include_disabled:
                entry["enabled"] = _switch_enabled(switch)
            if _is_number(clip):
                entry["clip"] = clip
            out.append(entry)
    return out


def _pinned(site, wf, include_disabled=False):
    nid, kind, path = site["nodeId"], site["kind"], site["path"]
    inputs = wf[nid]["inputs"]
    if kind == "extension":
        return copy.deepcopy(site["slot"]["loras"])
    if kind == "object":
        raw = inputs[path]
        entries = raw if isinstance(raw, list) else raw["__value__"]
        if any(
            not isinstance(e.get("name", e.get("lora")), str)
            and e.get("name", e.get("lora")) is not None
            for e in entries
        ):
            raise LibraryError("LoRA 对象条目名称必须是字符串")
        return [
            dict(
                name=e.get("name", e.get("lora")),
                strength=_num(e.get("strength", 1)),
                **(
                    {"enabled": e.get("active") is not False and e.get("on") is not False}
                    if include_disabled
                    else {}
                ),
                **(
                    {"clip": _num(e["clipStrength"])}
                    if e.get("clipStrength") not in (None, "")
                    else {}
                ),
            )
            for e in entries
            if (include_disabled or e.get("active") is not False and e.get("on") is not False)
            and not _is_empty_name(e.get("name", e.get("lora")))
        ]
    if kind == "syntax":
        return parse_lora_syntax(inputs[path])["loras"] if isinstance(inputs[path], str) else []
    if kind in ("chain", "embedded"):
        value = _chain_value(inputs, site["chain"][0])
        return [value] if value is not None else []
    return _stack_current_loras(wf, {"nodeId": nid}, include_disabled)


def _name_key(name):
    return strip_extension(name.replace("\\", "/").lower())


def _lora_key(group_key, name_key, occurrence=0):
    digest = hashlib.sha256(
        (group_key + "\0" + name_key + "\0" + str(occurrence)).encode("utf-8")
    ).hexdigest()[:16]
    return f"{group_key}:{digest}"


def keyed_loras(group_key, loras):
    result, occurrences = copy.deepcopy(loras), {}
    for item in result:
        name_key = _name_key(item["name"])
        occurrence = occurrences.get(name_key, 0)
        occurrences[name_key] = occurrence + 1
        item.setdefault("key", _lora_key(group_key, name_key, occurrence))
        item.setdefault("enabled", True)
    return result
