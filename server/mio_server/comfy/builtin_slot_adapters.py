"""Five generic LoRA codecs behind the same inspect/write dispatch interface.

The semantic graph planner owns activity and grouping. These adapters only recognize native
input shapes and write a resolved selection to a copied graph, without plugin-name rules.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Callable


def _slots():
    # Low-level graph/field helpers stay in the legacy planner during its incremental split.
    from . import workflow_slots

    return workflow_slots


@dataclass(frozen=True)
class BuiltinSlotAdapter:
    kind: str
    inspect_shape: Callable
    write_shape: Callable
    requires_strength: bool = False

    @property
    def id(self):
        return f"builtin.{self.kind}"

    def identity(self):
        return {
            "id": self.id,
            "source": "builtin",
            "contract": 1,
            "digest": hashlib.sha256(f"mio-slot-v1:{self.id}".encode()).hexdigest(),
        }

    def inspect(self, node_id, workflow, model_ids):
        shape = self.inspect_shape(node_id, workflow, model_ids)
        return {"nodeId": node_id, "kind": self.kind, **shape} if shape else None

    def can_toggle(self, group):
        descriptors = group["writer"].get("chain", [])
        return not self.requires_strength or bool(
            descriptors and descriptors[0].get("strengthPath")
        )

    def write(self, graph, group, loras, notices):
        self.write_shape(graph, group, loras, notices)


def _object_site(node_id, workflow, model_ids):
    path = _slots()._mirror_path_for(workflow[node_id], workflow)
    return {"path": path} if path else None


def _stack_site(node_id, workflow, model_ids):
    slots = _slots().stack_slots(workflow[node_id], workflow)
    return {"path": slots[0]["namePath"], "slots": slots} if slots else None


def _loader_site(node_id, workflow, model_ids, *, embedded):
    if (node_id in model_ids) != embedded:
        return None
    descriptor = _slots().chain_descriptor(node_id, workflow)
    return {"path": descriptor["namePath"], "chain": [descriptor]} if descriptor else None


def _embedded_site(node_id, workflow, model_ids):
    return _loader_site(node_id, workflow, model_ids, embedded=True)


def _chain_site(node_id, workflow, model_ids):
    return _loader_site(node_id, workflow, model_ids, embedded=False)


def _syntax_site(node_id, workflow, model_ids):
    for path, value in workflow[node_id]["inputs"].items():
        if ("lora" in path.lower() and "syntax" in path.lower()) or (
            isinstance(value, str) and "<lora:" in value
        ):
            return {"path": path}
    return None


def _write_object(graph, group, loras, notices):
    _slots()._write_object(graph, group["writer"], loras)


def _write_stack(graph, group, loras, notices):
    _slots()._apply_stack(graph, group["writer"], loras)


def _write_chain(graph, group, loras, notices):
    _slots()._apply_chain(graph, group["writer"], loras, notices)


def _write_embedded(graph, group, loras, notices):
    slots = _slots()
    writer = group["writer"]
    active = [item for item in loras if item.get("enabled", True)]
    if len(active) > 1:
        raise slots.LibraryError("此工作流的加载器最多 1 个 LoRA")
    descriptor = writer["chain"][0]
    if not active and not descriptor["strengthPath"]:
        raise slots.LibraryError("内嵌 LoRA 没有强度字段，无法安全禁用")
    if active:
        slots._write_field(graph, writer["nodeId"], writer["path"], active[0]["name"])
    for path, clip in [(descriptor["strengthPath"], False), (descriptor["clipPath"], True)]:
        if path:
            strength = (
                active[0].get("clip", active[0]["strength"])
                if clip and active
                else (active[0]["strength"] if active else 0)
            )
            slots._write_field(graph, writer["nodeId"], path, strength)


def _write_syntax(graph, group, loras, notices):
    slots = _slots()
    active = [item for item in loras if item.get("enabled", True)]
    destinations = [group["origin"]] if group.get("origin") else group["sites"]
    for site in destinations:
        if site.get("active") is False and group["active"]:
            continue
        node = graph[site["nodeId"]]
        if slots._is_link(node["inputs"].get(site["path"]), graph):
            node["inputs"][site["path"]] = ""
        slots._apply_syntax(
            graph,
            {**site, "nameFormat": "path", "placement": "append", "mirror": False},
            active,
            notices,
        )


# Specific aggregate shapes win over generic scalar/tag fields, matching historical analysis.
BUILTINS = (
    BuiltinSlotAdapter("object", _object_site, _write_object),
    BuiltinSlotAdapter("stack", _stack_site, _write_stack),
    BuiltinSlotAdapter("embedded", _embedded_site, _write_embedded, requires_strength=True),
    BuiltinSlotAdapter("chain", _chain_site, _write_chain, requires_strength=True),
    BuiltinSlotAdapter("syntax", _syntax_site, _write_syntax),
)
BY_KIND = {adapter.kind: adapter for adapter in BUILTINS}
