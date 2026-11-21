"""Resource pool: ComfyUI instances (each with a capacity) plus a local slot pool.

Scheduling rule (ROADMAP §2.2 "按模型分组调度以减少换模型"): a free instance first takes work
whose model group equals the group it ran last; otherwise work whose group no other instance is
currently "warm" for; otherwise the oldest eligible item.  Everything is deterministic so the
policy is unit-testable without threads.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field, replace
from urllib.parse import urlsplit, urlunsplit

LOCAL = "local"
COMFY = "comfy"


def normalize_endpoint(base_url: str) -> str:
    """Validate and identify a Comfy endpoint, independent of instance ids.

    Also used at the save boundary. Historical documents remain readable so the pool can
    quarantine a bad endpoint and expose a useful diagnostic beside healthy instances.
    """
    value = base_url.strip()
    if any(ord(c) <= 32 or ord(c) == 127 for c in value) or "\\" in value:
        raise ValueError("ComfyUI URL contains whitespace, control characters or backslashes")
    parts = urlsplit(value)
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if scheme not in ("http", "https") or not host:
        raise ValueError("ComfyUI URL requires http:// or https:// and a hostname")
    if ":" not in host:
        try:
            labels = host.encode("idna").decode("ascii").rstrip(".").split(".")
        except UnicodeError:
            raise ValueError("ComfyUI URL has an invalid hostname") from None
        if any(
            not label
            or len(label) > 63
            or label.startswith("-")
            or label.endswith("-")
            or any(not (c.isalnum() or c in "-_") for c in label)
            for label in labels
        ):
            raise ValueError("ComfyUI URL has an invalid hostname")
    authority = parts.netloc.rsplit("@", 1)[-1]
    if authority.endswith(":") or (":" in host and not authority.startswith("[")):
        raise ValueError("ComfyUI URL has an invalid port or IPv6 address")
    if authority.startswith("["):
        suffix = authority.partition("]")[2]
        if suffix and not (
            suffix.startswith(":") and suffix[1:].isascii() and suffix[1:].isdigit()
        ):
            raise ValueError("ComfyUI URL has an invalid IPv6 authority")
    port = parts.port  # urlsplit validates numeric range as well as malformed ports.
    if port == 0:
        raise ValueError("ComfyUI URL port must be between 1 and 65535")
    if ":" in host:
        host = f"[{host}]"
    authority = host
    if port is not None and (scheme, port) not in (("http", 80), ("https", 443)):
        authority += f":{port}"
    return urlunsplit((scheme, authority, parts.path.rstrip("/"), parts.query, ""))


@dataclass
class Candidate:
    job_id: str
    idx: int
    resource: str
    group: str = ""
    instances: tuple[str, ...] = ()  # allowed instance ids; empty = any
    order: tuple = ()  # sort key: (-priority, created, idx)
    exclusive: bool = False


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
        self.endpoint_active: dict[str, int] = {}
        self.state_blocks: dict[str, str] = {}

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
                try:
                    endpoint = normalize_endpoint(inst.base_url)
                except ValueError as exc:
                    slot.healthy = False
                    slot.info["configuration_error"] = str(exc)
                    fresh[inst.id] = slot
                    continue
                if (
                    old
                    and not old.info.get("configuration_error")
                    and normalize_endpoint(old.base_url) == endpoint
                ):
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
                slot = self.instances[instance_id]
                slot.healthy = healthy and not slot.info.get("configuration_error")

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
                        **(
                            {"error": s.info["configuration_error"]}
                            if s.info.get("configuration_error")
                            else {}
                        ),
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
            active = dict(self.endpoint_active)
            blocked = set(self.state_blocks)
            progress = True
            while progress and free:
                progress = False
                for iid in sorted(free, key=lambda i: (-free[i], i)):
                    if free[iid] <= 0:
                        continue
                    slot = self.instances[iid]
                    endpoint = normalize_endpoint(slot.base_url)
                    if endpoint in blocked:
                        continue
                    eligible = [
                        c
                        for c in comfy
                        if (c.job_id, c.idx) not in taken
                        and (not c.instances or iid in c.instances)
                        and (not c.exclusive or active.get(endpoint, 0) == 0)
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
                    active[endpoint] = active.get(endpoint, 0) + 1
                    if pick.exclusive:
                        blocked.add(endpoint)
                    warm.add(pick.group)
                    progress = True
                free = {k: v for k, v in free.items() if v > 0}
            return chosen

    def available(self, resource: str, instance_id: str | None, exclusive: bool = False) -> bool:
        with self.lock:
            if resource == LOCAL:
                return self.local_busy < self.local_capacity
            slot = self.instances.get(instance_id)
            if slot is None or not slot.healthy or slot.busy >= slot.capacity:
                return False
            endpoint = normalize_endpoint(slot.base_url)
            return endpoint not in self.state_blocks and (
                not exclusive or not self.endpoint_active.get(endpoint, 0)
            )

    def acquire(self, resource: str, instance_id: str | None, group: str = "") -> None:
        with self.lock:
            if resource == LOCAL:
                self.local_busy += 1
            else:
                slot = self.instances[instance_id]
                endpoint = normalize_endpoint(slot.base_url)
                slot.busy += 1
                self.endpoint_active[endpoint] = self.endpoint_active.get(endpoint, 0) + 1
                if group:
                    slot.last_group = group

    def release(self, resource: str, instance_id: str | None, base_url: str | None = None) -> None:
        with self.lock:
            if resource == LOCAL:
                self.local_busy = max(0, self.local_busy - 1)
            else:
                slot = self.instances.get(instance_id)
                captured = base_url if base_url is not None else (slot.base_url if slot else None)
                if captured is None:
                    return
                endpoint = normalize_endpoint(captured)
                remaining = self.endpoint_active.get(endpoint, 0) - 1
                if remaining > 0:
                    self.endpoint_active[endpoint] = remaining
                else:
                    self.endpoint_active.pop(endpoint, None)
                if (
                    slot
                    and not slot.info.get("configuration_error")
                    and normalize_endpoint(slot.base_url) == endpoint
                ):
                    slot.busy = max(0, slot.busy - 1)
                    if slot.capacity == 0 and slot.busy == 0:
                        del self.instances[instance_id]

    def instance(self, instance_id: str | None) -> InstanceSlot | None:
        with self.lock:
            slot = self.instances.get(instance_id) if instance_id else None
            return replace(slot) if slot else None
