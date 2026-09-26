"""Resource pool: ComfyUI instances (each with a capacity) plus a local slot pool.

Scheduling rule (ROADMAP §2.2 "按模型分组调度以减少换模型"): a free instance first takes work
whose model group equals the group it ran last; otherwise work whose group no other instance is
currently "warm" for; otherwise the oldest eligible item.  Everything is deterministic so the
policy is unit-testable without threads.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

LOCAL = "local"
COMFY = "comfy"


@dataclass
class Candidate:
    job_id: str
    idx: int
    resource: str
    group: str = ""
    instances: tuple[str, ...] = ()  # allowed instance ids; empty = any
    order: tuple = ()  # sort key: (-priority, created, idx)


@dataclass
class InstanceSlot:
    id: str
    base_url: str
    capacity: int = 1
    tags: tuple[str, ...] = ()
    busy: int = 0
    last_group: str | None = None
    healthy: bool = True
    info: dict = field(default_factory=dict)


class ResourcePool:
    def __init__(self, local_capacity: int = 2):
        self.lock = threading.RLock()
        self.local_capacity = local_capacity
        self.local_busy = 0
        self.instances: dict[str, InstanceSlot] = {}

    # ------------------------------------------------------------ configuration
    def set_instances(self, instances) -> None:
        """``instances``: iterable of objects with id / base_url / capacity / enabled / tags."""
        with self.lock:
            fresh = {}
            for inst in instances:
                if not getattr(inst, "enabled", True):
                    continue
                old = self.instances.get(inst.id)
                slot = InstanceSlot(
                    inst.id, inst.base_url, inst.capacity, tuple(getattr(inst, "tags", ()) or ())
                )
                if old:
                    slot.busy, slot.last_group, slot.healthy = old.busy, old.last_group, old.healthy
                fresh[inst.id] = slot
            # keep busy counters of removed instances so running work can still release
            for iid, old in self.instances.items():
                if iid not in fresh and old.busy:
                    old.capacity = 0
                    fresh[iid] = old
            self.instances = fresh

    def mark_health(self, instance_id: str, healthy: bool) -> None:
        with self.lock:
            if instance_id in self.instances:
                self.instances[instance_id].healthy = healthy

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "local": {"capacity": self.local_capacity, "busy": self.local_busy},
                "instances": [
                    {
                        "id": s.id,
                        "base_url": s.base_url,
                        "capacity": s.capacity,
                        "busy": s.busy,
                        "last_group": s.last_group,
                        "healthy": s.healthy,
                    }
                    for s in self.instances.values()
                ],
            }

    # --------------------------------------------------------------- scheduling
    def plan(self, candidates: list[Candidate]) -> list[tuple[Candidate, str | None]]:
        """Pick as many candidates as free capacity allows.  Does not acquire."""
        with self.lock:
            chosen: list[tuple[Candidate, str | None]] = []
            ordered = sorted(candidates, key=lambda c: c.order)
            taken: set[tuple[str, int]] = set()
            local_free = self.local_capacity - self.local_busy
            for cand in ordered:
                if cand.resource == LOCAL and local_free > 0:
                    chosen.append((cand, None))
                    taken.add((cand.job_id, cand.idx))
                    local_free -= 1
            comfy = [c for c in ordered if c.resource == COMFY]
            if not comfy:
                return chosen
            free = {
                s.id: s.capacity - s.busy
                for s in self.instances.values()
                if s.healthy and s.capacity > s.busy
            }
            warm = {s.last_group for s in self.instances.values() if s.last_group}
            progress = True
            while progress and free:
                progress = False
                for iid in sorted(free, key=lambda i: (-free[i], i)):
                    if free[iid] <= 0:
                        continue
                    slot = self.instances[iid]
                    eligible = [
                        c
                        for c in comfy
                        if (c.job_id, c.idx) not in taken
                        and (not c.instances or iid in c.instances)
                    ]
                    if not eligible:
                        continue
                    pick = (
                        next(
                            (c for c in eligible if slot.last_group and c.group == slot.last_group),
                            None,
                        )
                        or next((c for c in eligible if c.group not in warm), None)
                        or eligible[0]
                    )
                    chosen.append((pick, iid))
                    taken.add((pick.job_id, pick.idx))
                    free[iid] -= 1
                    warm.add(pick.group)
                    progress = True
                free = {k: v for k, v in free.items() if v > 0}
            return chosen

    def acquire(self, resource: str, instance_id: str | None, group: str = "") -> None:
        with self.lock:
            if resource == LOCAL:
                self.local_busy += 1
            else:
                slot = self.instances[instance_id]
                slot.busy += 1
                if group:
                    slot.last_group = group

    def release(self, resource: str, instance_id: str | None) -> None:
        with self.lock:
            if resource == LOCAL:
                self.local_busy = max(0, self.local_busy - 1)
            elif instance_id in self.instances:
                slot = self.instances[instance_id]
                slot.busy = max(0, slot.busy - 1)
                if slot.capacity == 0 and slot.busy == 0:
                    del self.instances[instance_id]

    def instance(self, instance_id: str | None) -> InstanceSlot | None:
        with self.lock:
            return self.instances.get(instance_id) if instance_id else None
