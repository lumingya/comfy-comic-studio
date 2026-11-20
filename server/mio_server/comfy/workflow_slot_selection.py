"""Resolve pinned and requested LoRAs consistently for discovery and writes."""

import copy

from .workflow_slot_common import LibraryError
from .workflow_slot_values import _name_key, keyed_loras


def _merged(pinned, additions, unpin):
    unpin_keys = {_name_key(u) for u in unpin}
    result = [copy.deepcopy(item) for item in pinned if _name_key(item["name"]) not in unpin_keys]
    for item in additions:
        name = _name_key(item["name"])
        if "key" in item:
            matches = [index for index, row in enumerate(result) if row.get("key") == item["key"]]
            if any(_name_key(result[index]["name"]) != name for index in matches):
                raise LibraryError("LoRA 标识与工作流槽位不匹配")
        else:
            matches = [index for index, row in enumerate(result) if _name_key(row["name"]) == name]
        if not matches:
            if (
                "key" in item
                and not item["key"].startswith("reference:")
                and any(_name_key(row["name"]) == name for row in pinned)
            ):
                raise LibraryError("LoRA 标识与工作流槽位不匹配")
            result.append({"strength": 1, **copy.deepcopy(item)})
            continue
        for index in matches:
            previous = result[index]
            result[index] = {**previous, **copy.deepcopy(item)}
            if "key" not in item and "strength" in item and "clip" not in item:
                result[index].pop("clip", None)
    return result


def _apply_group_overrides(group, loras, overrides):
    selected = next((item for item in overrides if item["key"] == group["key"]), None)
    if selected is None:
        return loras
    by_key = {item["key"]: item for item in loras if item.get("key")}
    for override in selected["loras"]:
        current = by_key.get(override["key"])
        if current is None or current["name"] != override["name"]:
            raise LibraryError("LoRA 项标识与工作流槽位不匹配")
        if "enabled" in override:
            current["enabled"] = override["enabled"]
        if "strength" in override:
            current["strength"] = override["strength"]
        if "clip" in override:
            current["clip"] = override["clip"]
    return loras


def resolved_loras(group, groups, overrides, *, stable_keys=False):
    """Resolve one destination identically for control discovery and compilation."""
    local_names = {_name_key(item["name"]) for item in group["pinned"]}
    unpin_keys = {_name_key(name) for name in overrides.get("unpin", [])}
    upstream_names = {
        _name_key(item["name"])
        for other in groups
        if other["key"] in group.get("upstreamKeys", [])
        for item in other["pinned"]
        if _name_key(item["name"]) not in unpin_keys
    }
    additions = [
        item
        for item in overrides.get("loras", [])
        if _name_key(item["name"]) in local_names
        or group.get("append", True)
        and _name_key(item["name"]) not in upstream_names
    ]
    final = _merged(group["pinned"], additions, overrides.get("unpin", []))
    if stable_keys:
        final = keyed_loras(group["key"], final)
    return _apply_group_overrides(group, final, overrides.get("groups", []))


def current_model(workflow, slots):
    plan = (slots or {}).get("plan", slots or {})
    return next(
        (t["current"] for t in plan.get("model", {}).get("targets", []) if t["role"] == "primary"),
        "",
    )


def current_loras(workflow, slots):
    plan = (slots or {}).get("plan", slots or {})
    return _merged([x for g in plan.get("lora", {}).get("groups", []) for x in g["pinned"]], [], [])
