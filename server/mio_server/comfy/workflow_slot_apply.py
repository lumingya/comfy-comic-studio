"""Execute a frozen slot plan on a workflow copy with validated overrides."""

import copy
import math

from . import slot_adapters as SA
from .workflow_slot_common import LibraryError, _consumer_index, _is_number, _write_field
from .workflow_slot_models import _field_enum
from .workflow_slot_overrides import normalize_overrides
from .workflow_slot_plan import analyze, ensure_plan
from .workflow_slot_selection import resolved_loras


def apply(workflow, plan, overrides, object_info=None, positive=None, *, adapters=()):
    """Execute a v3 plan on an in-memory copy. Legacy callers are analyzed in Python."""
    plan = plan or {}
    plan = plan.get("plan", plan)
    if plan.get("version") != 3:
        plan = analyze(workflow, object_info, legacy=plan, adapters=adapters)
    clean = normalize_overrides(overrides)
    if clean.get("groups"):
        plan = ensure_plan(workflow, {"plan": plan}, object_info, adapters=adapters)
    result, notices, writes = copy.deepcopy(workflow or {}), [], []
    disabled = set(clean.get("disabled", []))
    model = clean.get("model")
    known = {t["key"] for t in plan["model"]["targets"]}
    if isinstance(model, dict) and set(model) - known:
        raise LibraryError("模型目标不在工作流中")
    for target in plan["model"]["targets"]:
        key = target["key"]
        selected = target.get("enabled", target["role"] in ("primary", "same")) or (
            isinstance(model, dict) and key in model
        )
        value = model.get(key) if isinstance(model, dict) else model
        if not value:
            continue
        if (
            key in disabled
            or target.get("disabled")
            or not selected
            or target["role"] == "linked-unwritable"
        ):
            notices.append("跳过模型 " + key + "：" + target.get("reason", "未勾选"))
            continue
        nid, path = target["nodeId"], target["path"]
        source = result.get(target.get("sourceNodeId", nid), {})
        options = _field_enum(source, target.get("sourcePath", path), object_info)
        norm_val = str(value).replace("\\", "/").lower()
        if options is not None and not any(
            str(o).replace("\\", "/").lower() == norm_val for o in options
        ):
            raise LibraryError("模型 " + value + " 不在 " + key + " 的枚举列表中")
        _write_field(result, nid, path, value)
        writes.append({"kind": "model", "key": key, "nodeId": nid, "path": path, "value": value})
        notices.append("写入模型 " + key + " → " + value)
    if model and not any(w["kind"] == "model" for w in writes):
        raise LibraryError("当前工作流没有可写入的模型映射（全部跳过）")
    if "loras" in clean or clean.get("unpin") or clean.get("groups"):
        groups = copy.deepcopy(plan["lora"]["groups"])
        known_group_keys = {group["key"] for group in groups}
        requested_keys = {item["key"] for item in clean.get("groups", [])}
        unknown_group_keys = requested_keys - known_group_keys
        if unknown_group_keys:
            raise LibraryError("LoRA 组标识与工作流槽位不匹配")
        if (
            clean.get("loras")
            and plan["lora"].get("synth")
            and plan["lora"]["synth"].get("enabled", True)
            and "synth:" + plan["lora"]["synth"]["after"]["nodeId"] not in disabled
            and not any(g.get("enabled", g["active"]) and g["key"] not in disabled for g in groups)
        ):
            synth = plan["lora"]["synth"]
            after = synth["after"]
            src = after["nodeId"]
            n, nid = 1, src + ":lora"
            while nid in result:
                nid = f"{src}:lora{n}"
                n += 1
            inputs = {"model": [src, after["modelSlot"]], "lora_name": "", "strength_model": 1}
            passthrough = ["model"]
            if after["clipSlot"] is not None:
                inputs.update(clip=[src, after["clipSlot"]], strength_clip=1)
                passthrough.append("clip")
            for user in _consumer_index(result).get(src, []):
                if user["index"] == after["modelSlot"]:
                    result[user["consumer"]]["inputs"][user["key"]] = [nid, 0]
                elif after["clipSlot"] is not None and user["index"] == after["clipSlot"]:
                    result[user["consumer"]]["inputs"][user["key"]] = [nid, 1]
            result[nid] = {"class_type": synth["classType"], "inputs": inputs}
            desc = {
                "nodeId": nid,
                "namePath": "lora_name",
                "strengthPath": "strength_model",
                "clipPath": "strength_clip" if len(passthrough) == 2 else "",
                "passthrough": passthrough,
            }
            groups.append(
                {
                    "key": "synth:" + src,
                    "kind": "chain",
                    "writer": {
                        "nodeId": nid,
                        "chain": [desc],
                        "range": synth.get("range", {"min": -5, "max": 5}),
                    },
                    "active": True,
                    "enabled": True,
                    "append": True,
                    "pinned": [],
                    "sites": [{"nodeId": nid, "path": "lora_name"}],
                }
            )
        wrote = False
        for group in groups:
            if group["key"] in disabled or not group.get("enabled", group["active"]):
                if group["key"] in requested_keys and group["key"] not in disabled:
                    raise LibraryError("LoRA 组当前不可写入")
                notices.append("跳过 LoRA " + group["key"] + "：" + (group.get("warn") or "未勾选"))
                continue
            stable_keys = bool(clean.get("groups")) or any(
                "key" in item for item in group["pinned"]
            )
            final = resolved_loras(group, groups, clean, stable_keys=stable_keys)
            if final == group["pinned"]:
                # Still count this as a valid destination for an empty user addition.
                wrote = True
                continue
            writer = group["writer"]
            bounds = writer.get("range", {"min": -5, "max": 5})
            for item in final:
                for value in [item["strength"]] + ([item["clip"]] if "clip" in item else []):
                    if (
                        not _is_number(value)
                        or not math.isfinite(value)
                        or not bounds["min"] <= value <= bounds["max"]
                    ):
                        raise LibraryError(
                            "LoRA 强度必须在 %s 到 %s 之间" % (bounds["min"], bounds["max"])
                        )
            for site in group["sites"]:
                if site.get("active") is False and group["active"]:
                    notices.append(
                        "跳过 LoRA 站点 "
                        + site["nodeId"]
                        + ":"
                        + site["path"]
                        + "："
                        + site.get("reason", "不活跃")
                    )
            SA.write_group(result, group, final, notices, adapters)
            wrote = True
            if not group["active"]:
                notices.append("手动启用不活跃 LoRA 组 " + group["key"])
            writes.append(
                {
                    "kind": "lora",
                    "key": group["key"],
                    "origin": group.get("origin"),
                    "sites": [
                        s
                        for s in group["sites"]
                        if s.get("active") is not False or not group["active"]
                    ],
                    "loras": final,
                }
            )
            notices.append(
                "写入 LoRA "
                + group["key"]
                + " → "
                + ", ".join(
                    s["nodeId"] + ":" + s["path"]
                    for s in group["sites"]
                    if s.get("active") is not False or not group["active"]
                )
            )
        if clean.get("loras") and not wrote:
            raise LibraryError(plan["lora"].get("reason") or "没有启用的 LoRA 应用点")
    return {
        "workflow": result,
        "notices": notices,
        "writes": writes,
        "slots": {"plan": plan},
        "plan": plan,
        "overrides": clean,
    }
