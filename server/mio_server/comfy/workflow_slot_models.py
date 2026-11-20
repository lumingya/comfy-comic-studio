"""Model catalog discovery and scored writable-field candidates."""

import re

from .workflow_slot_common import (
    MODEL_CLASS,
    MODEL_EXT,
    NOT_MODEL,
    NOT_MODEL_FILE,
    STRONG_MODEL_KEYS,
    WEAK_MODEL_KEYS,
    _consumer_index,
    _node_ids,
    _sort_key,
    _title,
)


def catalog_from_object_info(object_info):
    lists = {"checkpoints": set(), "unets": set(), "loras": set(), "vaes": set()}
    kinds = {
        "ckpt_name": "checkpoints",
        "unet_name": "unets",
        "lora_name": "loras",
        "vae_name": "vaes",
    }
    for class_type, definition in (object_info or {}).items():
        if not isinstance(definition, dict):
            continue
        inputs = definition.get("input", {}) if isinstance(definition.get("input"), dict) else {}
        outputs = definition.get("output")
        # Semantic rule: Checkpoint/UNet loaders in ComfyUI MUST produce a MODEL output
        has_model_output = isinstance(outputs, list) and any(
            str(o).upper() == "MODEL" for o in outputs
        )
        for group in (inputs.get("required") or {}, inputs.get("optional") or {}):
            for field, rule in group.items():
                kind = kinds.get(field)
                if (
                    not kind
                    or not isinstance(rule, list)
                    or not rule
                    or not isinstance(rule[0], list)
                ):
                    continue
                if kind in ("checkpoints", "unets"):
                    if NOT_MODEL.search(class_type):
                        continue
                    if isinstance(outputs, list) and not has_model_output:
                        continue
                for option in rule[0]:
                    if isinstance(option, str) and option and option != "None":
                        if kind in ("checkpoints", "unets", "loras"):
                            if NOT_MODEL_FILE.search(option) or not MODEL_EXT.search(option):
                                continue
                        lists[kind].add(option)
    return {k: sorted(v, key=lambda s: s.lower()) for k, v in lists.items()}


def _field_enum(node, key, object_info):
    inputs = (
        (object_info or {}).get(node.get("class_type"), {}).get("input", {})
        if isinstance(object_info, dict)
        else {}
    )
    rule = {**(inputs.get("required") or {}), **(inputs.get("optional") or {})}.get(key)
    return rule[0] if isinstance(rule, list) and rule and isinstance(rule[0], list) else None


def model_candidates(workflow, object_info=None):
    consumers = _consumer_index(workflow)
    catalog = catalog_from_object_info(object_info)
    checkpoints, unets = set(catalog["checkpoints"]), set(catalog["unets"])
    found = []
    for node_id in _node_ids(workflow):
        node = workflow[node_id]
        class_type = str(node.get("class_type") or "")
        for key, value in node["inputs"].items():
            if not isinstance(value, str) or re.search(
                r"text|prompt|positive|negative|wildcard", key, re.I
            ):
                continue
            kind = "model"
            if STRONG_MODEL_KEYS.match(key):
                score = 3
                kind = "unet" if key.lower().startswith("unet") else "checkpoint"
            elif WEAK_MODEL_KEYS.match(key):
                if NOT_MODEL.search(class_type):
                    continue
                score = 2
            elif MODEL_EXT.search(value):
                if NOT_MODEL.search(key) or NOT_MODEL.search(class_type):
                    continue
                score = 1
            else:
                continue
            if MODEL_EXT.search(value):
                score += 1
            if MODEL_CLASS.search(class_type):
                score += 1
            if any(c["key"] == "model" for c in consumers.get(node_id, [])):
                score += 2
            options = _field_enum(node, key, object_info)
            if options:
                hits = [o for o in options if o in checkpoints or o in unets]
                if hits and all(o in checkpoints for o in options):
                    kind, score = "checkpoint", score + 1
                elif hits and all(o in unets for o in options):
                    kind, score = "unet", score + 1
                elif not hits and (checkpoints or unets):
                    score -= 2
            if score <= 0:
                continue
            found.append(
                {
                    "nodeId": node_id,
                    "path": key,
                    "classType": class_type,
                    "title": _title(node),
                    "value": value,
                    "kind": kind,
                    "score": score,
                }
            )
    found.sort(key=lambda c: (-c["score"], _sort_key(c["nodeId"])))
    return found
