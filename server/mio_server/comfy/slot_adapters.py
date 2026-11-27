"""Extension entry point for LoRA slots whose node inputs need a custom codec."""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import Field, JsonValue

from ..models import StrictModel
from .builtin_slot_adapters import BUILTINS, BY_KIND
from .contracts import json_copy

POINT = "workflow_slot_adapter"


class SlotLoRA(StrictModel):
    name: str = Field(min_length=1, max_length=300)
    strength: float = Field(default=1, allow_inf_nan=False)
    clip: float | None = Field(default=None, allow_inf_nan=False)
    enabled: bool = True


class SlotRange(StrictModel):
    min: float = Field(default=-5, allow_inf_nan=False)
    max: float = Field(default=5, allow_inf_nan=False)


class SlotDescription(StrictModel):
    path: str = Field(min_length=1, max_length=200)
    loras: list[SlotLoRA] = Field(default_factory=list, max_length=64)
    range: SlotRange = Field(default_factory=SlotRange)
    can_disable: bool = True
    can_append: bool = False
    options: dict[str, JsonValue] = Field(default_factory=dict)


def installed(registry) -> tuple:
    return (
        tuple(item for item in reversed(registry.all(POINT)) if item.source != "builtin")
        if registry is not None
        else ()
    )


def register_builtins(registry):
    for adapter in BUILTINS:
        ref = adapter.identity()
        registry.register(
            POINT, adapter.id, adapter, title=adapter.kind, contract=1, digest=ref["digest"]
        )


def identity(adapter) -> dict:
    return {
        "id": adapter.id,
        "source": adapter.source,
        "digest": adapter.meta.get("digest", ""),
        "contract": adapter.meta.get("contract", 1),
    }


@dataclass(frozen=True)
class ExtensionSlotAdapter:
    contribution: object

    def inspect(self, node_id, workflow, model_ids):
        adapter = self.contribution
        node = workflow[node_id]
        indicated = adapter.invoke_method(adapter.value, "inspect", json_copy(node))
        if indicated is None:
            return None
        slot = SlotDescription.model_validate(indicated)
        if slot.path not in node["inputs"] or slot.range.min > slot.range.max:
            raise ValueError(f"Invalid LoRA slot from {adapter.id} for node {node_id}")
        return {
            "nodeId": node_id,
            "kind": "extension",
            "path": slot.path,
            "adapter": identity(adapter),
            "slot": slot.model_dump(mode="json", exclude_none=True),
        }

    def can_toggle(self, group):
        return group["writer"]["slot"]["can_disable"]

    def write(self, graph, group, loras, notices):
        writer = group["writer"]
        node_id = writer["nodeId"]
        adapter = self.contribution
        inputs = graph[node_id]["inputs"]
        updated = adapter.invoke_method(
            adapter.value,
            "write",
            json_copy(graph[node_id]),
            json_copy(writer["slot"]),
            json_copy(loras),
        )
        if not isinstance(updated, dict) or set(updated) - set(inputs):
            raise ValueError(f"LoRA slot adapter {adapter.id} must return existing input changes")
        graph[node_id]["inputs"].update(json_copy(updated))


def find_site(node_id, workflow, model_ids, adapters):
    codecs = (*map(ExtensionSlotAdapter, adapters), *BUILTINS)
    return next(
        (site for adapter in codecs if (site := adapter.inspect(node_id, workflow, model_ids))),
        None,
    )


def _codec(group, adapters):
    ref = group["writer"].get("adapter")
    if ref is not None:
        matched = next((item for item in adapters if identity(item) == ref), None)
        if matched is None:
            raise ValueError(f"LoRA slot adapter is unavailable: {ref['id']}")
        return ExtensionSlotAdapter(matched)
    try:
        return BY_KIND[group["kind"]]
    except KeyError:
        raise ValueError(f"Unknown LoRA input shape: {group['kind']}") from None


def write_group(graph, group, loras, notices, adapters):
    codec = _codec(group, adapters)
    if not codec.can_toggle(group) and any(not item.get("enabled", True) for item in loras):
        from .workflow_slots import LibraryError

        raise LibraryError("此 LoRA 槽位不支持独立关闭")
    codec.write(graph, group, loras, notices)


def can_toggle(group: dict) -> bool:
    writer = group["writer"]
    if not group["active"] or not group.get("enabled", True) or group.get("disabled"):
        return False
    return (
        writer["slot"]["can_disable"]
        if group["kind"] == "extension"
        else BY_KIND[group["kind"]].can_toggle(group)
    )


def syntax_targets(plan: dict) -> set[tuple[str, str]]:
    return {
        (site["nodeId"], site["path"])
        for group in plan["lora"]["groups"]
        if group["kind"] == "syntax" and group["active"]
        for site in ([group["origin"]] if group["origin"] else group["sites"])
        if site.get("active", True)
    }


def preserve_bound_tags(before: dict, after: dict, targets: set[tuple[str, str]]) -> None:
    """A text binding replaces prompt text, while a slot override owns its LoRA tags."""
    from .workflow_slots import LORA_TAG

    for node_id, path in targets:
        previous = before[node_id]["inputs"].get(path)
        inputs = after[node_id]["inputs"]
        new = inputs.get(path)
        if not isinstance(previous, str) or not isinstance(new, str) or previous == new:
            continue
        managed_tags = [match[0] for match in LORA_TAG.finditer(previous)]
        text = LORA_TAG.sub("", new).strip()
        inputs[path] = " ".join(part for part in [text, *managed_tags] if part)


def describe(doc, registry=None, overrides=None, *, object_info=None) -> dict:
    """Describe stable controls using the same adapter and keyed defaults as compilation."""
    from . import workflow_slots as slots

    contributions = installed(registry)
    plan = slots.ensure_plan(doc.graph, doc.slots, object_info, adapters=contributions)["lora"]
    changes = slots.merge_overrides(doc.config.slot_overrides, overrides)
    groups = []
    active_adapters = {}
    for group in plan["groups"]:
        writer = group["writer"]
        toggle = can_toggle(group) and group["key"] not in changes.get("disabled", [])
        bounds = writer["range"]
        adapter = writer.get("adapter") or BY_KIND[group["kind"]].identity()
        active_adapters[adapter["id"]] = adapter
        controls = []
        pinned_keys = {item["key"] for item in group["pinned"]}
        for item in slots.resolved_loras(group, plan["groups"], changes, stable_keys=True):
            pinned = item["key"] in pinned_keys
            controls.append(
                {
                    "key": item["key"],
                    "name": item["name"],
                    "strength": item["strength"],
                    "clip": item.get("clip"),
                    "enabled": item.get("enabled", True),
                    "source": adapter["source"]
                    if adapter["source"] != "builtin"
                    else "workflow"
                    if pinned
                    else "defaults",
                    "pinned": pinned,
                    "supports_independent_toggle": toggle,
                    "supports_strength": True,
                    "range": bounds,
                }
            )
        groups.append(
            {
                "key": group["key"],
                "kind": group["kind"],
                "adapter": adapter,
                "active": group["active"],
                "range": bounds,
                "supports_independent_toggle": toggle,
                "reason": "" if toggle else group["warn"] or "该槽位不支持独立关闭",
                "sites": group["sites"],
                "loras": controls,
            }
        )
    return {
        "workflow_id": doc.id,
        "adapter": {"id": "workflow_slots.v3", "source": "builtin"},
        "adapters": list(active_adapters.values()),
        "enabled": plan["enabled"],
        "reason": plan["reason"],
        "supports_append": bool(
            plan.get("synth")
            or any(group["active"] and group["append"] for group in plan["groups"])
        ),
        "groups": groups,
    }
