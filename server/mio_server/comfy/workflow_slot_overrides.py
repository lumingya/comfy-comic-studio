"""Validate and merge immutable task and panel slot overrides."""

import copy
import math
import re

from .workflow_slot_common import MAX_LORAS, LibraryError
from .workflow_slot_values import _name_key


def _round2(value):
    value = round(float(value) * 100) / 100
    return int(value) if value == int(value) else value


def normalize_loras(items, partial=False):
    if not isinstance(items, list):
        raise LibraryError("LoRA 覆盖必须是数组")
    if len(items) > MAX_LORAS:
        raise LibraryError("一次最多叠加 %d 个 LoRA" % MAX_LORAS)
    out, seen = [], set()
    for raw in items:
        if not isinstance(raw, dict):
            raise LibraryError("LoRA 条目格式无效")
        name = str(raw.get("name") if raw.get("name") is not None else "").strip()
        if not name or len(name) > 300 or re.search(r"[<>\x00-\x1f]", name):
            raise LibraryError("LoRA 名称无效")
        strength = raw.get("strength", 1)
        try:
            strength = float(strength)
        except (TypeError, ValueError):
            raise LibraryError("LoRA 强度必须是有限数字") from None
        if not math.isfinite(strength):
            raise LibraryError("LoRA 强度必须是有限数字")
        precise = partial or raw.get("key") is not None
        entry = {"name": name, "strength": strength if precise else _round2(strength)}
        if partial and "strength" not in raw:
            entry.pop("strength")
        if "enabled" in raw:
            if type(raw["enabled"]) is not bool:
                raise LibraryError("LoRA 开关必须是布尔值")
            entry["enabled"] = raw["enabled"]
        key = raw.get("key")
        if key is not None:
            if not isinstance(key, str) or not key or len(key) > 512:
                raise LibraryError("LoRA 标识无效")
            entry["key"] = key
        clip = raw.get("clip")
        if clip not in (None, ""):
            try:
                clip = float(clip)
            except (TypeError, ValueError):
                raise LibraryError("LoRA CLIP 强度必须是有限数字") from None
            if not math.isfinite(clip):
                raise LibraryError("LoRA CLIP 强度必须是有限数字")
            entry["clip"] = clip if precise else _round2(clip)
        identity = ("key", key) if key is not None else ("name", name)
        if identity in seen:
            out[
                next(
                    i
                    for i, l in enumerate(out)
                    if (("key", l["key"]) if "key" in l else ("name", l["name"])) == identity
                )
            ] = entry
            continue
        seen.add(identity)
        out.append(entry)
    return out


def normalize_overrides(overrides):
    if not isinstance(overrides, dict):
        raise LibraryError("模型 / LoRA 覆盖必须是对象")
    clean = {}

    def filename(value):
        if (
            not isinstance(value, str)
            or not value.strip()
            or len(value) > 300
            or re.search(r"[<>\x00-\x1f]", value)
        ):
            raise LibraryError("模型名称无效")
        return value.strip()

    model = overrides.get("model")
    if isinstance(model, dict):
        clean["model"] = {str(k): filename(v) for k, v in model.items()}
    elif model not in (None, ""):
        clean["model"] = filename(model)
    if "loras" in overrides:
        clean["loras"] = normalize_loras(overrides["loras"], partial=True)
    if "groups" in overrides:
        groups = overrides["groups"]
        if not isinstance(groups, list) or len(groups) > 64:
            raise LibraryError("LoRA 组覆盖必须是数组")
        clean["groups"] = []
        seen_groups = set()
        for raw_group in groups:
            if not isinstance(raw_group, dict):
                raise LibraryError("LoRA 组覆盖格式无效")
            key = raw_group.get("key")
            if not isinstance(key, str) or not key or len(key) > 512 or key in seen_groups:
                raise LibraryError("LoRA 组标识无效或重复")
            seen_groups.add(key)
            raw_loras = raw_group.get("loras", [])
            if not isinstance(raw_loras, list) or len(raw_loras) > 64:
                raise LibraryError("LoRA 组覆盖条目必须是数组，最多 64 项")
            values = []
            seen_keys = set()
            for raw_lora in raw_loras:
                value = normalize_loras([raw_lora])[0]
                if not value.get("key") or value["key"] in seen_keys:
                    raise LibraryError("LoRA 组内每项都必须提供唯一稳定标识")
                seen_keys.add(value["key"])
                for optional in ("strength", "enabled", "clip"):
                    if optional not in raw_lora:
                        value.pop(optional, None)
                values.append(value)
            clean["groups"].append({"key": key, "loras": values})
    for key in ("unpin", "disabled"):
        if key in overrides:
            values = overrides[key]
            if not isinstance(values, list) or not all(
                isinstance(v, str) and len(v) <= 500 for v in values
            ):
                raise LibraryError(key + " 必须是字符串数组")
            clean[key] = list(dict.fromkeys(values))
    return clean


def merge_overrides(*overrides):
    """Merge slot overrides from defaults to the most specific task or panel layer."""
    result = {}
    for override in overrides:
        if override is None:
            continue
        if not isinstance(override, dict):
            raise LibraryError("LoRA 槽位覆盖必须是对象")
        override = normalize_overrides(override)
        if not override:
            continue
        for key, value in override.items():
            if key == "model" and isinstance(result.get(key), dict) and isinstance(value, dict):
                result[key] = {**result[key], **copy.deepcopy(value)}
            elif key == "groups" and isinstance(value, list):
                groups = {item.get("key"): copy.deepcopy(item) for item in result.get(key, [])}
                for item in value:
                    group_key = item.get("key") if isinstance(item, dict) else None
                    if not group_key:
                        raise LibraryError("LoRA 组覆盖格式无效")
                    previous = groups.get(group_key, {"key": group_key, "loras": []})
                    if not isinstance(previous.get("loras"), list) or not isinstance(
                        item.get("loras", []), list
                    ):
                        raise LibraryError("LoRA 组内条目必须是数组")
                    loras = {lora.get("key"): copy.deepcopy(lora) for lora in previous["loras"]}
                    for lora in item.get("loras", []):
                        lora_key = lora.get("key") if isinstance(lora, dict) else None
                        if not lora_key:
                            raise LibraryError("LoRA 项缺少稳定标识")
                        loras[lora_key] = {**loras.get(lora_key, {}), **copy.deepcopy(lora)}
                    previous["loras"] = list(loras.values())
                    groups[group_key] = previous
                result[key] = list(groups.values())
            elif key == "loras" and isinstance(value, list):
                loras = {
                    ("key", item["key"])
                    if item.get("key")
                    else ("name", _name_key(item["name"])): copy.deepcopy(item)
                    for item in result.get(key, [])
                    if isinstance(item, dict) and isinstance(item.get("name"), str)
                }
                for item in value:
                    if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                        raise LibraryError("LoRA 覆盖条目格式无效")
                    identity = (
                        ("key", item["key"])
                        if item.get("key")
                        else ("name", _name_key(item["name"]))
                    )
                    loras[identity] = {**loras.get(identity, {}), **copy.deepcopy(item)}
                result[key] = list(loras.values())
            else:
                result[key] = copy.deepcopy(value)
    return result
