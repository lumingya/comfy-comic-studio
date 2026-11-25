"""Plugin-independent probes for native LoRA input shapes and chains."""

from .workflow_slot_common import (
    CHAIN_CLIP_KEYS,
    CHAIN_NAME_KEYS,
    CHAIN_STRENGTH_KEYS,
    PASSTHROUGH_KEYS,
    STACK_CLIP_PREFIXES,
    STACK_KEY,
    STACK_STRENGTH_PREFIXES,
    STACK_SWITCH_PREFIXES,
    _is_link,
    _node_ids,
    _sort_key,
    _title,
)


def _first_key(inputs, keys):
    for key in keys:
        if key in inputs:
            return key
    return ""


def _mode_stack(inputs):
    """Recognize complete literal mode/count contracts without node-class rules."""
    candidates = []
    for mode_key, count_key, name_template, templates in (
        ("input_mode", "lora_count", None, ("lora_wt_{}", "model_str_{}", "clip_str_{}")),
        (
            "mode",
            "num_loras",
            "lora_{}_name",
            ("lora_{}_strength", "lora_{}_model_strength", "lora_{}_clip_strength"),
        ),
    ):
        if mode_key not in inputs or count_key not in inputs:
            continue
        positions = {}
        for key, value in inputs.items():
            match = STACK_KEY.match(key)
            if match and isinstance(value, str):
                token = match.group(2)
                if name_template and key != name_template.format(token):
                    continue
                paths = [template.format(token) for template in templates]
                if any(path in inputs for path in paths):
                    positions[token] = paths
        if positions:
            candidates.append((inputs[mode_key], inputs[count_key], positions))
    if not candidates:
        return None
    if len(candidates) != 1:
        return {}
    mode, count, positions = candidates[0]
    if mode not in ("simple", "advanced") or type(count) is not int or count < 0:
        return {}
    complete = {
        token: paths for token, paths in positions.items() if all(path in inputs for path in paths)
    }
    return {"mode": mode, "count": count, "positions": complete}


def stack_slots(node, workflow):
    inputs = node["inputs"]
    # Some flat stacks expose two complete weight sets selected by a literal mode.
    # Only this full structural contract proves which fields actually affect execution;
    # writing every apparent mirror would overwrite the other mode's saved values.
    mode_stack = _mode_stack(inputs)
    if mode_stack == {}:
        return []
    slots = []
    for key, value in inputs.items():
        match = STACK_KEY.match(key)
        if not match or _is_link(value, workflow):
            continue
        token = match.group(2)
        if mode_stack is not None and (
            token not in mode_stack["positions"] or not 1 <= int(token) <= mode_stack["count"]
        ):
            continue
        object_style = isinstance(value, dict)
        if not object_style and not isinstance(value, str):
            continue

        def siblings(prefixes):
            return (
                []
                if object_style
                else [
                    k
                    for k in node["inputs"]
                    if any(
                        k in (p + "_" + token, p + token, "lora_" + token + "_" + p)
                        for p in prefixes
                    )
                ]
            )

        strength_paths, clip_paths, switch_paths = (
            siblings(STACK_STRENGTH_PREFIXES),
            siblings(STACK_CLIP_PREFIXES),
            siblings(STACK_SWITCH_PREFIXES),
        )
        if mode_stack is not None:
            shared, model, clip = mode_stack["positions"][token]
            strength_paths = [shared if mode_stack["mode"] == "simple" else model]
            clip_paths = [shared if mode_stack["mode"] == "simple" else clip]
            if any(_is_link(inputs[path], workflow) for path in strength_paths + clip_paths):
                continue
        slots.append(
            {
                "index": int(token),
                "slotToken": token,
                "namePrefix": key[: match.start(2)],
                "nameSuffix": key[match.end(2) :],
                "namePath": key,
                "objectStyle": object_style,
                "strengthPaths": strength_paths,
                "clipPaths": clip_paths,
                "strengthPath": strength_paths[0] if strength_paths else "",
                "clipPath": clip_paths[0] if clip_paths and clip_paths != strength_paths else "",
                "switchPath": switch_paths[0] if switch_paths else "",
                **({"preserveEmpty": True} if mode_stack is not None else {}),
            }
        )
    slots.sort(key=lambda s: s["index"])
    return slots


def chain_descriptor(node_id, workflow):
    node = workflow[node_id]
    inputs = node["inputs"]
    if stack_slots(node, workflow):
        return None
    name_path = next(
        (
            k
            for k in CHAIN_NAME_KEYS
            if k in inputs
            and not _is_link(inputs[k], workflow)
            and (isinstance(inputs[k], str) or inputs[k] is None)
        ),
        None,
    )
    if not name_path:
        return None
    strength_path, clip_path = (
        _first_key(inputs, CHAIN_STRENGTH_KEYS),
        _first_key(inputs, CHAIN_CLIP_KEYS),
    )
    if not strength_path:
        return None
    passthrough = [k for k in PASSTHROUGH_KEYS if k in inputs]
    return {
        "nodeId": node_id,
        "classType": str(node.get("class_type") or ""),
        "title": _title(node),
        "namePath": name_path,
        "strengthPath": strength_path,
        "clipPath": clip_path,
        "passthrough": passthrough,
        "value": inputs[name_path],
        "strength": inputs[strength_path] if strength_path else None,
        "clip": inputs[clip_path] if clip_path else None,
    }


def _chain_parent(descriptor, workflow, chain_ids):
    node, guard = workflow[descriptor["nodeId"]], 0
    while node and guard < 64:
        guard += 1
        key = next((k for k in PASSTHROUGH_KEYS if _is_link(node["inputs"].get(k), workflow)), None)
        if not key:
            return ""
        source = str(node["inputs"][key][0])
        if source in chain_ids:
            return source
        node = workflow.get(source)
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            return ""
    return ""


def ordered_chain(workflow, anchor):
    all_nodes = {}
    for node_id in _node_ids(workflow):
        descriptor = chain_descriptor(node_id, workflow)
        if descriptor:
            all_nodes[node_id] = descriptor
    ids = set(all_nodes)
    if not ids:
        return []
    children = {}
    for node_id in ids:
        parent = _chain_parent(all_nodes[node_id], workflow, ids)
        if parent:
            children.setdefault(parent, []).append(node_id)
    start = str(anchor) if anchor and str(anchor) in ids else ""
    if not start:
        roots = sorted(
            [i for i in ids if not _chain_parent(all_nodes[i], workflow, ids)], key=_sort_key
        )

        def depth(node_id, seen=()):
            if node_id in seen:
                return 1
            return 1 + max([0] + [depth(c, seen + (node_id,)) for c in children.get(node_id, [])])

        roots.sort(key=lambda i: (-depth(i), _sort_key(i)))
        start = roots[0] if roots else sorted(ids, key=_sort_key)[0]
    chain, current, seen = [], start, set()
    while current and current not in seen:
        seen.add(current)
        chain.append(all_nodes[current])
        nxt = sorted(children.get(current, []), key=_sort_key)
        current = nxt[0] if nxt else ""
    return chain


def _mirror_path_for(node, workflow):
    if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
        return ""
    for key, value in node["inputs"].items():
        if _is_link(value, workflow):
            continue
        if isinstance(value, list):
            entries = value
        elif isinstance(value, dict) and isinstance(value.get("__value__"), list):
            entries = value["__value__"]
        else:
            continue
        if not entries and key == "loras":
            return key
        if entries and all(
            isinstance(e, dict) and ("name" in e or "lora" in e) and "strength" in e
            for e in entries
        ):
            return key
    return ""
