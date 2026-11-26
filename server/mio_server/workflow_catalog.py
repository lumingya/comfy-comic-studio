"""Bounded, workspace-local memoization of advisory workflow catalog analysis."""

from __future__ import annotations

import copy
import threading
from collections import OrderedDict
from dataclasses import dataclass

from .comfy import compile as C
from .comfy import slot_adapters as SA
from .comfy import workflow_slot_plan as plans
from .comfy import workflow_slots as slots


@dataclass(frozen=True)
class _Snapshot:
    generation: int
    signature: tuple
    rules: tuple
    adapters: tuple


def _slot_inputs(stored):
    value = copy.deepcopy(stored)
    if isinstance(value, dict):
        plan = value.get("plan", value)
        if isinstance(plan, dict) and plan.get("version") == 3:
            plan.pop("analyzedAt", None)
    return value


class WorkflowCatalog:
    """Cache only summaries; execution and editable controls always inspect their own inputs."""

    def __init__(self, registry, capacity: int = 256):
        if capacity < 1:
            raise ValueError("workflow catalog capacity must be positive")
        self.registry = registry
        self.capacity = capacity
        self._lock = threading.RLock()
        self._generation = 0
        self._entries: OrderedDict[tuple, dict] = OrderedDict()
        self._unsubscribe = registry.on("registry.changed", self._changed)

    def _changed(self, event):
        if event.get("point") in (None, "workflow_binding", SA.POINT):
            with self._lock:
                self._generation += 1
                self._entries.clear()

    def close(self):
        with self._lock:
            unsubscribe, self._unsubscribe = self._unsubscribe, None
            self._entries.clear()
        if unsubscribe is not None:
            unsubscribe()

    def _snapshot_locked(self):
        bindings = tuple(self.registry.all("workflow_binding"))
        adapters = SA.installed(self.registry)
        signature = tuple(
            (
                item.point,
                item.source,
                item.id,
                str(item.meta.get("digest", "")),
                str(item.meta.get("contract", 1)),
                id(item),
                id(item.value),
            )
            for item in (*bindings, *adapters)
        )
        return _Snapshot(
            self._generation,
            signature,
            tuple((f"{item.source}:{item.id}", item.value) for item in bindings),
            adapters,
        )

    def summaries(self, docs, *, object_info=None) -> list[dict]:
        object_info = copy.deepcopy(object_info)
        inputs = [
            (
                doc,
                slots.info_hash(
                    {
                        "graph": doc.graph,
                        "config": doc.config.model_dump(mode="json"),
                        "slots": _slot_inputs(doc.slots),
                        "analysisRevision": plans.ANALYSIS_REVISION,
                        "objectInfo": object_info,
                    }
                ),
            )
            for doc in docs
        ]
        while True:
            # Registry mutates under this RLock, before emitting its change event. Pin both
            # contribution points atomically, and check them again before publishing results.
            # The lock order is always registry -> cache; change callbacks only take cache.
            with self.registry._lock, self._lock:
                snapshot = self._snapshot_locked()
            out, pending = [], {}
            for doc, fingerprint in inputs:
                key = (snapshot.generation, snapshot.signature, fingerprint)
                with self._lock:
                    analysis = self._entries.get(key)
                    if analysis is not None:
                        self._entries.move_to_end(key)
                        analysis = copy.deepcopy(analysis)
                if analysis is None and key in pending:
                    analysis = copy.deepcopy(pending[key])
                if analysis is None:
                    analysis, cacheable = _analyze(doc, snapshot, object_info)
                    if cacheable:
                        pending[key] = analysis
                out.append(
                    {
                        "id": doc.id,
                        "name": doc.name,
                        "source": doc.source,
                        **analysis,
                        "updated_at": doc.updated_at,
                    }
                )
            with self.registry._lock, self._lock:
                current = self._snapshot_locked()
                if (current.generation, current.signature) != (
                    snapshot.generation,
                    snapshot.signature,
                ):
                    continue
                self._entries.update(pending)
                while len(self._entries) > self.capacity:
                    self._entries.popitem(last=False)
                return copy.deepcopy(out)


def _analyze(doc, snapshot, object_info):
    info = C.describe(doc, rules=snapshot.rules)
    result = {key: info[key] for key in ("nodes", "variants", "image_inputs", "checkpoint")}
    stored = doc.slots or {}
    previous = stored.get("plan", stored if stored.get("version") == 3 else {})
    legacy = {"plan": previous} if stored.get("version") == 3 else stored
    try:
        # Stored plans carry manual/enabled choices, not authoritative groups or pinned values.
        plan = slots.analyze(
            doc.graph,
            object_info,
            previous.get("manual"),
            legacy,
            adapters=snapshot.adapters,
        )
        plan = plans.refresh_pinned_values(plan, doc.graph)
        groups = plan.get("lora", {}).get("groups", [])
        result["loras"] = {
            "enabled": bool(plan.get("lora", {}).get("enabled")),
            "groups": len(groups),
            "supports_independent_toggle": any(SA.can_toggle(group) for group in groups),
        }
    except slots.LibraryError:
        result.update(
            loras=None,
            lora_error={
                "code": "MIO-SLOT-001",
                "message": "LoRA analysis is unavailable; correct the workflow weights and retry.",
            },
        )
        return result, False
    return result, True
