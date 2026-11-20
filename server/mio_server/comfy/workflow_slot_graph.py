"""Typed graph traversal, live branches and unambiguous string origins."""

import re

from .workflow_slot_common import MODEL_INPUT, _consumer_index, _is_link, _node_ids


def _rules(node, info):
    inputs = (info or {}).get(node.get("class_type"), {}).get("input", {})
    return {**inputs.get("required", {}), **inputs.get("optional", {})}


class Graph:
    """Declared types first; without definitions only one-hop field semantics."""

    def __init__(self, workflow, info):
        self.wf, self.info = workflow, info or {}
        self.users = _consumer_index(workflow)
        self.blocked = set()
        for nid in _node_ids(workflow):
            inputs = workflow[nid]["inputs"]

            def literal(value):
                if _is_link(value, workflow):
                    src = workflow.get(str(value[0]), {}).get("inputs", {})
                    if any(_is_link(v, workflow) for v in src.values()) or len(src) != 1:
                        return None
                    return next(iter(src.values()))
                return value

            for yes, no in [
                ("on_true", "on_false"),
                ("tt_value", "ff_value"),
                ("true_input", "false_input"),
            ]:
                if yes in inputs and no in inputs:
                    controls = [literal(v) for k, v in inputs.items() if k not in (yes, no)]
                    bools = [v for v in controls if type(v) is bool]
                    if len(bools) == 1:
                        self.blocked.add((nid, no if bools[0] else yes))
            selected = literal(inputs.get("select"))
            if type(selected) is int:
                for key in inputs:
                    match = re.fullmatch(r"input_?(\d+)", key)
                    if match and int(match[1]) != selected:
                        self.blocked.add((nid, key))
        # A branch shared by a live consumer must never be classified as dead.
        self.dead = set()
        for _ in workflow:
            added = {
                nid
                for nid, users in self.users.items()
                if users
                and all(
                    (u["consumer"], u["key"]) in self.blocked or u["consumer"] in self.dead
                    for u in users
                )
            }
            if added <= self.dead:
                break
            self.dead |= added

    def output(self, nid, slot):
        outputs = self.info.get(self.wf.get(nid, {}).get("class_type"), {}).get("output", [])
        return str(outputs[slot]).upper() if 0 <= slot < len(outputs) else ""

    def edge(self, nid, user, kind="MODEL", seen=None):
        declared = self.output(nid, user["index"])
        if declared:
            return declared.endswith("MODEL") if kind == "MODEL" else declared == kind
        key = user["key"].lower()
        if key in (
            "on_true",
            "on_false",
            "tt_value",
            "ff_value",
            "true_input",
            "false_input",
        ) or re.fullmatch(r"input_?\d+", key):
            consumer = user["consumer"]
            if (consumer, user["key"]) in self.blocked:
                return False
            seen = set() if seen is None else seen
            if consumer in seen:
                return False
            seen = seen | {consumer}
            return any(
                self.edge(consumer, downstream, kind, seen)
                for downstream in self.users.get(consumer, [])
            )
        return (
            bool(MODEL_INPUT.fullmatch(key))
            if kind == "MODEL"
            else key in ("lora_stack", "prev_lora")
        )

    def model_node(self, nid):
        definition = self.info.get(self.wf[nid].get("class_type"))
        if definition is not None:
            return any(str(t).upper().endswith("MODEL") for t in definition.get("output", []))
        return any(self.edge(nid, u) for u in self.users.get(nid, []))

    def active(self, nid):
        if self.wf[nid].get("mode") in (2, 4):
            return False, "节点未启用，不在执行图中"
        if nid in self.dead:
            return False, "LoRA 节点位于未启用的分支，默认不写入"
        if not any(
            self.edge(nid, u) or self.edge(nid, u, "LORA_STACK") for u in self.users.get(nid, [])
        ):
            return False, "MODEL / LORA_STACK 输出没有消费者，默认不写入"
        return True, ""

    def reaches(self, start, end):
        seen, todo = set(), [start]
        while todo:
            nid = todo.pop()
            if nid in seen:
                continue
            seen.add(nid)
            for user in self.users.get(nid, []):
                if not self.edge(nid, user) or (user["consumer"], user["key"]) in self.blocked:
                    continue
                if user["consumer"] == end:
                    return True
                todo.append(user["consumer"])
        return False


def trace_origin(workflow, link, object_info=None, sites=None):
    """Follow at most eight unambiguous STRING edges, never switches/concats."""
    seen = set()
    for _ in range(8):
        if not _is_link(link, workflow):
            break
        nid = str(link[0])
        if nid in seen or nid not in workflow:
            break
        seen.add(nid)
        node = workflow[nid]
        outputs = (object_info or {}).get(node.get("class_type"), {}).get("output", [])
        if link[1] < len(outputs) and outputs[link[1]] != "STRING":
            return {"nodeId": nid, "path": "", "writable": False}
        if sites and nid in sites and sites[nid]["kind"] in ("object", "syntax"):
            return {"nodeId": nid, "path": sites[nid]["path"], "writable": True}
        links = [(k, v) for k, v in node["inputs"].items() if _is_link(v, workflow)]
        if not links:
            strings = [(k, v) for k, v in node["inputs"].items() if isinstance(v, str)]
            return {
                "nodeId": nid,
                "path": strings[0][0] if len(strings) == 1 else "",
                "writable": len(strings) == 1,
            }
        rules = _rules(node, object_info)
        # Only pure single-input forwarding nodes are transparent. A selector is not.
        if len(node["inputs"]) != 1 or len(links) != 1:
            return {"nodeId": nid, "path": "", "writable": False}
        key, value = links[0]
        rule = rules.get(key, [])
        if not rule or rule[0] != "STRING":
            return {"nodeId": nid, "path": "", "writable": False}
        link = value
    return {
        "nodeId": str(link[0]) if _is_link(link, workflow) else "",
        "path": "",
        "writable": False,
    }
