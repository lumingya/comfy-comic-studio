"""Assemble, migrate and refresh version-three semantic slot plans."""

import copy
from datetime import datetime, timezone

from . import slot_adapters as SA
from .workflow_slot_common import STRONG_MODEL_KEYS, _node_ids, info_hash
from .workflow_slot_graph import Graph, _rules
from .workflow_slot_plan_groups import _plan_groups
from .workflow_slot_plan_models import _manual_sites, _model_targets
from .workflow_slot_values import _pinned, keyed_loras

ANALYSIS_REVISION = 2


def _plan_output(wf, g, targets, groups, object_info):
    def drives_sampler(target):
        nid = target.get("sourceNodeId", target["nodeId"])
        first = [u["consumer"] for u in g.users.get(nid, []) if g.edge(nid, u)]
        reachable = first + [
            u["consumer"] for n in first for u in g.users.get(n, []) if g.edge(n, u)
        ]
        return any(
            any(k in wf[n]["inputs"] for k in ("latent_image", "samples", "latent"))
            for n in reachable
        )

    pair_target = next((t for t in targets if t["role"] == "other" and drives_sampler(t)), None)
    paired = pair_target is not None
    if pair_target:
        pair_target["pairedSelector"] = True
    synth = None
    if not any(group["active"] for group in groups):
        main = next((t for t in targets if t["role"] == "primary"), None)
        if main:
            nid = main.get("sourceNodeId", main["nodeId"])
            path = main.get("sourcePath", main["path"])
            outputs = (object_info or {}).get(wf[nid].get("class_type"), {}).get("output", [])
            if STRONG_MODEL_KEYS.fullmatch(path) and "MODEL" in outputs:
                clip_slot = outputs.index("CLIP") if "CLIP" in outputs else None
                clip_used = clip_slot is not None and any(
                    u["index"] == clip_slot
                    and any(k in wf[u["consumer"]]["inputs"] for k in ("text", "prompt"))
                    for u in g.users.get(nid, [])
                )
                synth = {
                    "after": {
                        "nodeId": nid,
                        "modelSlot": outputs.index("MODEL"),
                        "clipSlot": clip_slot if clip_used else None,
                    },
                    "classType": "LoraLoader" if clip_used else "LoraLoaderModelOnly",
                }
                rules = _rules({"class_type": synth["classType"]}, object_info)
                ranges = [
                    rule[1]
                    for key, rule in rules.items()
                    if key in ("strength_model", "strength_clip")
                    and len(rule) > 1
                    and isinstance(rule[1], dict)
                ]
                synth["range"] = {
                    "min": max([r.get("min", -5) for r in ranges] or [-5]),
                    "max": min([r.get("max", 5) for r in ranges] or [5]),
                }

    return paired, synth


def analyze(workflow, object_info=None, manual=None, legacy=None, *, adapters=()):
    wf = workflow or {}
    g = Graph(wf, object_info)
    issues = []

    def issue(code, nid, text):
        issues.append({"level": "warn", "code": code, "nodeId": nid, "text": text})

    targets, model_ids = _model_targets(wf, g, object_info, issue)
    sites = {}
    for nid in _node_ids(wf):
        if site := SA.find_site(nid, wf, model_ids, adapters):
            sites[nid] = site
    _manual_sites(wf, sites, targets, model_ids, manual, issue)
    groups = _plan_groups(wf, g, sites, object_info, issues, issue)
    paired, synth = _plan_output(wf, g, targets, groups, object_info)
    enabled = any(group["active"] for group in groups) or synth is not None
    reason = (
        ""
        if enabled
        else "此工作流没有可用的 LoRA 应用点，且加载器不是标准类型（缺少声明时请同步节点定义）"
    )
    if reason:
        issue("no-lora-site", "", reason)
    plan = {
        "version": 3,
        "analysisRevision": ANALYSIS_REVISION,
        "analyzedAt": datetime.now(timezone.utc).isoformat(),
        "objectInfoHash": info_hash(object_info),
        "workflowHash": info_hash(wf),
        "manual": copy.deepcopy(manual or []),
        "model": {"paired": paired, "targets": targets},
        "lora": {"enabled": enabled, "reason": reason, "groups": groups, "synth": synth},
        "issues": issues,
    }
    _migrate(plan, legacy or {})
    return plan


def _migrate(plan, legacy):
    oldplan = legacy.get("plan", {})
    if (
        plan["lora"]["synth"]
        and (oldplan.get("lora", {}).get("synth") or {}).get("enabled") is False
    ):
        plan["lora"]["synth"]["enabled"] = False
    if plan["lora"]["synth"] and legacy.get("lora", {}).get("mode") == "off":
        plan["lora"]["synth"]["enabled"] = False
    for kind, collection in [("model", "targets"), ("lora", "groups")]:
        previous = {x["key"]: x for x in oldplan.get(kind, {}).get(collection, [])}
        current_keys = {x["key"] for x in plan[kind][collection]}
        for key in previous.keys() - current_keys:
            plan["issues"].append(
                {
                    "level": "warn",
                    "code": "stale-target",
                    "nodeId": previous[key].get("nodeId", ""),
                    "text": "旧的计划目标不在工作流中：" + key,
                }
            )
        for entry in plan[kind][collection]:
            if entry["key"] in previous:
                entry["enabled"] = previous[entry["key"]].get("enabled", entry["enabled"])
                if "disabled" in previous[entry["key"]]:
                    entry["disabled"] = previous[entry["key"]]["disabled"]
        old = legacy.get(kind, {})
        if old.get("enabled") is False or old.get("mode") == "off":
            for entry in plan[kind][collection]:
                entry["enabled"] = False
        if old.get("auto") is False and old.get("nodeId"):
            match = [
                e
                for e in plan[kind][collection]
                if (e.get("nodeId") == str(old["nodeId"]) and e.get("path") == old.get("path"))
                or any(s["nodeId"] == str(old["nodeId"]) for s in e.get("sites", []))
            ]
            if match:
                for entry in plan[kind][collection]:
                    entry["enabled"] = (
                        entry in match
                        and old.get("enabled") is not False
                        and old.get("mode") != "off"
                    )
            else:
                for entry in plan[kind][collection]:
                    entry["enabled"] = False
                plan["issues"].append(
                    {
                        "level": "warn",
                        "code": "legacy-missing",
                        "nodeId": str(old["nodeId"]),
                        "text": "旧的自定义目标不在工作流中",
                    }
                )


def ensure_plan(workflow, slots=None, object_info=None, *, adapters=()):
    slots = slots or {}
    plan = slots.get("plan", slots if slots.get("version") == 3 else {})
    if (
        adapters
        or any(g["kind"] == "extension" for g in plan.get("lora", {}).get("groups", []))
        or plan.get("version") != 3
        or plan.get("analysisRevision") != ANALYSIS_REVISION
        or plan.get("objectInfoHash") != info_hash(object_info)
        or plan.get("workflowHash") != info_hash(workflow)
    ):
        legacy = {"plan": plan} if slots.get("version") == 3 else slots
        plan = analyze(workflow, object_info, plan.get("manual"), legacy, adapters=adapters)
    else:
        plan = copy.deepcopy(plan)
    for group in plan.get("lora", {}).get("groups", []):
        if group["kind"] in ("stack", "object"):
            group["pinned"] = _pinned(group["writer"], workflow, include_disabled=True)
        group["pinned"] = keyed_loras(group["key"], group.get("pinned", []))
    return plan
