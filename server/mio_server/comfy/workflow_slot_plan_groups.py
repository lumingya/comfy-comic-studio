"""Group active LoRA application sites and annotate write capabilities."""

import copy

from .workflow_slot_common import _is_link, _node_ids
from .workflow_slot_graph import _rules, trace_origin
from .workflow_slot_values import _pinned


def _plan_groups(wf, g, sites, object_info, issues, issue):
    suppressed = set()
    for nid, s in sites.items():
        if s["kind"] != "object":
            continue
        todo = [
            str(v[0])
            for k, v in wf[nid]["inputs"].items()
            if k in ("lora_stack", "prev_lora") and _is_link(v, wf)
        ]
        while todo:
            src = todo.pop()
            if src in suppressed or src not in wf:
                continue
            suppressed.add(src)
            todo.extend(
                str(v[0])
                for k, v in wf[src]["inputs"].items()
                if k in ("lora_stack", "prev_lora") and _is_link(v, wf)
            )
    groups = {}
    for nid, site in sites.items():
        if nid in suppressed:
            issue("single-entry", nid, "下游加载器有自有 LoRA 参数，上游堆栈只读")
            continue
        active, warn = g.active(nid)
        if site["kind"] == "syntax" and not g.model_node(nid) and not site.get("manual"):
            # Passive metadata / prompt fields must never be parameter application sites.
            continue
        value = wf[nid]["inputs"][site["path"]]
        origin, writer = None, site
        if site["kind"] == "syntax" and _is_link(value, wf):
            origin = trace_origin(wf, value, object_info, sites)
            if origin["writable"] and origin["nodeId"] in sites:
                writer = sites[origin["nodeId"]]
                key = "origin:" + writer["nodeId"] + ":" + writer["path"]
            else:
                key = "direct:" + str(value[0]) + ":" + str(value[1])
                origin = None
        elif site["kind"] == "extension":
            key = "adapter:" + site["adapter"]["id"] + ":" + nid + ":" + site["path"]
        else:
            key = "origin:" + nid + ":" + site["path"]
        if key not in groups:
            groups[key] = {
                "key": key,
                "kind": writer["kind"],
                "origin": {"nodeId": writer["nodeId"], "path": writer["path"]}
                if origin or writer["kind"] != "syntax" or not _is_link(value, wf)
                else None,
                "writer": copy.deepcopy(writer),
                "sites": [],
                "pinned": _pinned(writer, wf),
                "active": False,
                "warn": "",
                "series": "",
                "append": True,
            }
        group = groups[key]
        group["sites"].append(
            {"nodeId": nid, "path": site["path"], "active": active, "reason": warn}
        )
        group["active"] |= active
        if warn:
            issue("dead-branch" if nid in g.dead else "inactive-site", nid, warn)
    groups = list(groups.values())
    for nid in _node_ids(wf):
        if nid not in sites and any(g.edge(nid, u, "LORA_STACK") for u in g.users.get(nid, [])):
            issue("readonly-origin", nid, "LoRA 堆栈来源没有可写参数，只读且不成组")
    for group in groups:
        if len(group["sites"]) > 1 and group.get("origin"):
            group["sites"] = [
                s for s in group["sites"] if s["active"] or s["nodeId"] != group["origin"]["nodeId"]
            ]
            issues[:] = [
                i
                for i in issues
                if not (i["code"] == "inactive-site" and i["nodeId"] == group["origin"]["nodeId"])
            ]
        group["enabled"] = group["active"]
        group["warn"] = "" if group["active"] else "无活跃应用点，默认不写入"
        # Declarative metadata for both executors: no browser-side discovery.
        writer = group["writer"]
        node = wf[writer["nodeId"]]
        if writer["kind"] == "extension":
            writer["range"] = writer["slot"]["range"]
            continue
        writer["textPaths"] = (
            [
                k
                for k, v in node["inputs"].items()
                if isinstance(v, str) and (k == "text" or "<lora:" in v)
            ]
            if writer["kind"] == "object"
            else []
        )
        ranges = []
        rules = _rules(node, object_info)
        paths = [d.get(k) for d in writer.get("chain", []) for k in ("strengthPath", "clipPath")]
        paths += [k for s in writer.get("slots", []) for k in s["strengthPaths"] + s["clipPaths"]]
        for path in filter(None, paths):
            rule = rules.get(path, [])
            metadata = rule[1] if len(rule) > 1 and isinstance(rule[1], dict) else {}
            ranges.append({"min": metadata.get("min", -5), "max": metadata.get("max", 5)})
        writer["range"] = {
            "min": max([r["min"] for r in ranges] or [-5]),
            "max": min([r["max"] for r in ranges] or [5]),
        }
    # Series annotation and append only at terminal sites; branches each have a terminal.
    for i, group in enumerate(groups):
        downstream = [
            other
            for other in groups
            if other is not group
            and other["active"]
            and group["active"]
            and any(
                g.reaches(a["nodeId"], b["nodeId"]) for a in group["sites"] for b in other["sites"]
            )
        ]
        group["upstreamKeys"] = [
            other["key"]
            for other in groups
            if other is not group
            and other["active"]
            and any(
                g.reaches(a["nodeId"], b["nodeId"]) for a in other["sites"] for b in group["sites"]
            )
        ]
        group["append"] = not downstream and group["writer"].get("slot", {}).get("can_append", True)
        upstream = [
            j
            for j, other in enumerate(groups)
            if any(
                g.reaches(a["nodeId"], b["nodeId"]) for a in other["sites"] for b in group["sites"]
            )
        ]
        group["series"] = "S" + str(min([i] + upstream) + 1)

    return groups
