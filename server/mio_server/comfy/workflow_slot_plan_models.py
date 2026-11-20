"""Plan writable model targets and explicit manual slot declarations."""

import re

from .workflow_slot_common import (
    CHAIN_CLIP_KEYS,
    CHAIN_NAME_KEYS,
    CHAIN_STRENGTH_KEYS,
    MODEL_EXT,
    PASSTHROUGH_KEYS,
    STRONG_MODEL_KEYS,
    _is_link,
    _node_ids,
    _sort_key,
    _title,
)
from .workflow_slot_graph import trace_origin
from .workflow_slot_models import model_candidates
from .workflow_slot_shapes import _first_key, _mirror_path_for, chain_descriptor


def _model_targets(wf, g, object_info, issue):
    targets = []
    candidates = model_candidates(wf, object_info)
    for nid in _node_ids(wf):
        for key, value in wf[nid]["inputs"].items():
            if not STRONG_MODEL_KEYS.fullmatch(key) or not _is_link(value, wf):
                continue
            origin = trace_origin(wf, value, object_info)
            provider = wf.get(origin["nodeId"], {}).get("inputs", {})
            filenames = [
                (k, v) for k, v in provider.items() if isinstance(v, str) and MODEL_EXT.search(v)
            ]
            if (
                not origin["writable"]
                and not any(_is_link(v, wf) for v in provider.values())
                and len(filenames) == 1
            ):
                origin.update(path=filenames[0][0], writable=True)
            current = provider.get(origin["path"])
            if origin["writable"] and isinstance(current, str) and MODEL_EXT.search(current):
                candidates.append(
                    {
                        "nodeId": origin["nodeId"],
                        "path": origin["path"],
                        "value": current,
                        "sourceNodeId": nid,
                        "sourcePath": key,
                        "score": 6,
                        "title": _title(wf[nid]),
                    }
                )
            else:
                targets.append(
                    {
                        "key": f"{nid}:{key}",
                        "nodeId": nid,
                        "path": key,
                        "current": "",
                        "title": _title(wf[nid]),
                        "role": "linked-unwritable",
                        "enabled": False,
                        "reason": "模型字段已连线，来源不是唯一字面量提供者",
                    }
                )
                issue("linked-unwritable", nid, targets[-1]["reason"])
    candidates.sort(key=lambda c: (-c["score"], _sort_key(c.get("sourceNodeId", c["nodeId"]))))
    primary = None
    for c in candidates:
        nid = c.get("sourceNodeId", c["nodeId"])
        if any(t["key"] == c["nodeId"] + ":" + c["path"] for t in targets):
            continue
        if not g.model_node(nid):
            issue("accessory-weight", nid, "附属权重，不进模型映射：" + c["path"])
            continue
        key = c["nodeId"] + ":" + c["path"]
        if any(t["key"] == key for t in targets):
            continue
        normalized = c["value"].replace("\\", "/").lower()
        role = "primary" if primary is None else "same" if primary == normalized else "other"
        if primary is None:
            primary = normalized
        targets.append(
            {**c, "key": key, "current": c["value"], "role": role, "enabled": role != "other"}
        )
    model_ids = {c.get("sourceNodeId", c["nodeId"]) for c in candidates}

    return targets, model_ids


def _manual_sites(wf, sites, targets, model_ids, manual, issue):
    for entry in manual or []:
        nid, path = str(entry.get("nodeId", "")), entry.get("path", "")
        if sites.get(nid, {}).get("kind") == "extension":
            continue
        if nid not in wf or path not in wf[nid]["inputs"]:
            issue("manual-missing", nid, "手动指定的字段不在工作流中")
            continue
        value = wf[nid]["inputs"][path]
        if _is_link(value, wf):
            issue("manual-linked", nid, "手动字段已连线，不能安全写入")
            continue
        if (
            re.search(r"lora", path, re.I)
            and isinstance(value, str)
            and "<lora:" not in value
            and "syntax" not in path
        ):
            inputs = wf[nid]["inputs"]
            token = re.search(r"\d+", path)
            token = token.group() if token else ""
            strength = _first_key(
                inputs, CHAIN_STRENGTH_KEYS + [f"strength_{token}", f"lora_{token}_strength"]
            )
            sites[nid] = {
                "nodeId": nid,
                "path": path,
                "kind": "chain"
                if path in CHAIN_NAME_KEYS and nid not in model_ids and chain_descriptor(nid, wf)
                else "embedded",
                "manual": True,
                "chain": [
                    {
                        "nodeId": nid,
                        "namePath": path,
                        "strengthPath": strength,
                        "clipPath": _first_key(inputs, CHAIN_CLIP_KEYS),
                        "value": value,
                        "strength": inputs.get(strength),
                        "clip": None,
                        "passthrough": [k for k in PASSTHROUGH_KEYS if k in inputs],
                    }
                ],
            }
        elif isinstance(value, str) and MODEL_EXT.search(value):
            key = nid + ":" + path
            if not any(t["key"] == key for t in targets):
                targets.append(
                    {
                        "key": key,
                        "nodeId": nid,
                        "path": path,
                        "title": _title(wf[nid]),
                        "current": value,
                        "role": "other",
                        "enabled": True,
                        "manual": True,
                    }
                )
        elif isinstance(value, str):
            sites[nid] = {"nodeId": nid, "path": path, "kind": "syntax", "manual": True}
        elif _mirror_path_for({"inputs": {path: value}}, wf):
            sites[nid] = {"nodeId": nid, "path": path, "kind": "object", "manual": True}
        else:
            issue("manual-unwritable", nid, "手动字段的值形态不可写")

    return None
