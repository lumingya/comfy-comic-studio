"""Typed graph traversal, live branches and unambiguous string origins."""

from .workflow_graph import SemanticGraph
from .workflow_slot_common import MODEL_INPUT, _consumer_index, _node_ids


def _rules(node, info):
    inputs = (info or {}).get(node.get("class_type"), {}).get("input", {})
    return {**inputs.get("required", {}), **inputs.get("optional", {})}


class Graph:
    """Model reachability on active semantic routes, independent of execution closure."""

    def __init__(self, workflow, info):
        self.wf, self.info = workflow, info or {}
        self.semantic = SemanticGraph(workflow, info)
        self.users = _consumer_index(workflow)
        self.blocked = set()
        for nid in _node_ids(workflow):
            selected, branches, _ = self.semantic.selection(nid)
            if selected:
                self.blocked.update((nid, key) for key in branches if key != selected)
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
        return self.semantic.output_type(nid, slot)

    def edge(self, nid, user, kind="MODEL", seen=None):
        pending, seen = [(nid, user)], set() if seen is None else set(seen)
        while pending:
            source, edge = pending.pop()
            consumer, key = edge["consumer"], edge["key"]
            marker = (source, consumer, key, edge["index"])
            if marker in seen:
                continue
            seen.add(marker)
            # Inactive input routing takes precedence over the source's declared type.
            if (consumer, key) in self.blocked or self.wf.get(consumer, {}).get("mode") == 2:
                continue
            if self.wf.get(source, {}).get("mode") == 2:
                continue
            declared = self.output(source, edge["index"])
            if declared and declared != "*":
                if declared.endswith("MODEL") if kind == "MODEL" else declared == kind:
                    return True
                continue
            if (
                bool(MODEL_INPUT.fullmatch(key))
                if kind == "MODEL"
                else key.lower() in ("lora_stack", "prev_lora")
            ):
                return True
            for downstream in self.users.get(consumer, []):
                routes = self.semantic.input_routes([consumer, downstream["index"]], kind)
                if any(path == key for path, _ in routes):
                    pending.append((consumer, downstream))
        return False

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
    """Follow cycle-safe scalar routes, requiring a unique writable STRING origin."""
    return SemanticGraph(workflow, object_info).literal_origin(link, "STRING", sites)
