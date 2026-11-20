"""One layered registry, persistent executor identities and exact result delivery."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from ..models import StrictModel
from . import dependencies
from .operations import operation_serialized
from .types import JobConflict, JobError


class ExecutorRef(StrictModel):
    kind: str = Field(min_length=1, max_length=160)
    source: str = Field(min_length=1, max_length=160)
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class ExecutorInfo(ExecutorRef):
    current: bool
    replay_safe: bool
    resources: list[Literal["local", "comfy"]]


class RebindExecutor(StrictModel):
    expected: ExecutorRef | None
    target: ExecutorRef


@dataclass(frozen=True)
class ExecutorBinding:
    ref: ExecutorRef
    executor: object
    resources: tuple[str, ...]

    @property
    def replay_safe(self):
        return getattr(self.executor, "replay_safe", False) is True


def binding_of(contribution) -> ExecutorBinding | None:
    if not contribution or not contribution.meta.get("executor_contract"):
        return None
    return ExecutorBinding(
        ExecutorRef(
            kind=contribution.id, source=contribution.source, digest=contribution.meta["digest"]
        ),
        contribution.value,
        tuple(contribution.meta["resources"]),
    )


class ExecutorView(Mapping):
    """Read-only compatibility view; registration must go through engine.register()."""

    def __init__(self, engine):
        self.engine = engine

    def __iter__(self):
        return iter(item.id for item in self.engine.registry.all("job_executor"))

    def __len__(self):
        return len(self.engine.registry.all("job_executor"))

    def __getitem__(self, key):
        binding = self.engine.current_executor(key)
        if binding is None:
            raise KeyError(key)
        return binding.executor


class ExecutorRuntime:
    @operation_serialized
    def register(
        self,
        kind,
        executor,
        *,
        source="local",
        digest=None,
        resources=("local", "comfy"),
        replace=True,
        title="",
    ):
        if not callable(getattr(executor, "execute", None)):
            raise JobError("executor.execute must be callable")
        for method in ("on_complete", "reconcile", "recover_state"):
            if hasattr(executor, method) and not callable(getattr(executor, method)):
                raise JobError(f"executor.{method} must be callable")
        if not resources or not set(resources) <= {"local", "comfy"}:
            raise JobError("executor resources must be local and/or comfy")
        if digest is None:
            if source != "local":
                raise JobError("managed executors need a persistent reviewed digest")
            # Internal standalone consumers have an explicit v1 contract. Extensions must use
            # their reviewed package digest; core registrations supply a versioned contract hash.
            name = f"local-v1:{type(executor).__module__}:{type(executor).__qualname__}"
            digest = hashlib.sha256(name.encode()).hexdigest()
        ref = ExecutorRef(kind=kind, source=source, digest=digest)
        with self.lock:
            layers = self.registry.layers("job_executor", kind)
            for layer in layers:
                if layer.source == source or layer is layers[-1]:
                    self.ensure_executor_source_idle(layer.source, kind=kind)
            result = self.registry.register(
                "job_executor",
                kind,
                executor,
                source=source,
                title=title or kind,
                replace=replace,
                executor_contract=1,
                digest=ref.digest,
                resources=tuple(dict.fromkeys(resources)),
            )
            self.refresh_executor_jobs()
        return result

    def current_executor(self, kind):
        layers = self.registry.layers("job_executor", kind)
        return binding_of(layers[-1]) if layers else None

    def resolve_executor(self, ref: ExecutorRef | None) -> ExecutorBinding | None:
        if ref is None:
            return None
        return next(
            (
                binding
                for layer in self.registry.layers("job_executor", ref.kind)
                if (binding := binding_of(layer)) and binding.ref == ref
            ),
            None,
        )

    def executor_catalog(self) -> list[ExecutorInfo]:
        items = []
        for top in self.registry.all("job_executor"):
            for layer in self.registry.layers("job_executor", top.id):
                binding = binding_of(layer)
                if binding:
                    items.append(
                        ExecutorInfo(
                            **binding.ref.model_dump(),
                            current=layer is top,
                            replay_safe=binding.replay_safe,
                            resources=list(binding.resources),
                        )
                    )
        return items

    def executor_ref(self, job_id) -> ExecutorRef | None:
        with self.lock:
            row = self.db.execute(
                "SELECT kind, source, digest FROM job_executor_bindings WHERE job_id = ?", (job_id,)
            ).fetchone()
        return ExecutorRef(**dict(row)) if row else None

    def job_executor(self, job_id, *, required=False) -> ExecutorBinding | None:
        binding = self.resolve_executor(self.executor_ref(job_id))
        if required and (binding is None or dependencies.missing(self, job_id)):
            raise JobConflict(
                "the task's exact executor or adapter is unavailable; load its original source and digest"
            )
        return binding

    def executor_status(self, job_id):
        ref = self.executor_ref(job_id)
        binding = self.resolve_executor(ref)
        return {
            "missing_dependencies": dependencies.missing(self, job_id),
            "ref": ref.model_dump() if ref else None,
            "available": binding is not None,
            "replay_safe": bool(binding and binding.replay_safe),
            "reason": None if binding else "executor_missing" if ref else "executor_unbound",
        }

    def ensure_executor_source_idle(self, source, *, kind=None):
        """Called under operation lock. Never waits for a running job's result guard."""
        with self.lock:
            loaded = {
                (binding.ref.kind, binding.ref.digest)
                for top in self.registry.all("job_executor")
                if kind is None or top.id == kind
                for layer in self.registry.layers("job_executor", top.id)
                if layer.source == source and (binding := binding_of(layer))
            }
            rows = self.db.execute(
                "SELECT job_id FROM job_executor_bindings WHERE source = ?"
                + (" AND kind = ?" if kind else ""),
                (source, kind) if kind else (source,),
            ).fetchall()
            affected = {
                row[0]
                for row in rows
                if (ref := self.executor_ref(row[0])) and (ref.kind, ref.digest) in loaded
            }
            if kind is None:
                affected.update(
                    row[0]
                    for row in self.db.execute("SELECT id FROM jobs").fetchall()
                    if any(
                        ref["source"] == source for ref in dependencies.job_references(self, row[0])
                    )
                )
            busy = {
                jid
                for (jid, _), ctx in self.running.items()
                if ctx.executor_binding
                and ctx.executor_binding.ref.source == source
                and (kind is None or ctx.executor_binding.ref.kind == kind)
            }
            busy.update(jid for jid, _ in self.running if jid in affected)
            for jid in affected:
                if (
                    self.db.execute(
                        "SELECT 1 FROM job_items WHERE job_id = ? AND state IN ('running','uncertain')",
                        (jid,),
                    ).fetchone()
                    or self.db.execute(
                        "SELECT 1 FROM job_deliveries WHERE job_id = ? "
                        "AND state IN ('pending', 'publishing')",
                        (jid,),
                    ).fetchone()
                    or self.state_leases.list(jid)
                ):
                    busy.add(jid)
            if busy:
                raise JobConflict(
                    "executor source has active or unresolved tasks: " + ", ".join(sorted(busy))
                )

    def refresh_executor_jobs(self):
        with self.lock, self.db:
            for row in self.db.execute(
                "SELECT DISTINCT job_id FROM job_items WHERE state = 'pending'"
            ).fetchall():
                self._aggregate(row[0])
        self.wake.set()

    @operation_serialized
    def rebind_executor(self, job_id: str, command: RebindExecutor) -> dict:
        with self._job_guard(job_id, command=True), self.lock, self.db:
            job = self._require(job_id)
            if self.executor_ref(job_id) != command.expected:
                raise JobConflict("executor binding changed; inspect the task again")
            target = self.resolve_executor(command.target)
            if target is None or command.target.kind != job["kind"]:
                raise JobConflict("target executor is unavailable or has a different kind")
            items = self.db.execute(
                "SELECT attempts, resource, state FROM job_items WHERE job_id = ?", (job_id,)
            ).fetchall()
            if (
                any(item["attempts"] or item["state"] == "running" for item in items)
                or any(jid == job_id for jid, _ in self.running)
                or self.state_leases.list(job_id)
                or self.db.execute(
                    "SELECT 1 FROM job_deliveries WHERE job_id = ?", (job_id,)
                ).fetchone()
            ):
                raise JobConflict(
                    "only tasks with zero attempts and no result or state lease can be rebound"
                )
            if any(item["resource"] not in target.resources for item in items):
                raise JobConflict("target executor does not support this task's resources")
            self._write_executor_ref(job_id, target.ref)
            self._event(job_id, None, "executor_rebound", {"executor": target.ref.model_dump()})
            self._aggregate(job_id)
        self.wake.set()
        return self.get(job_id)

    def _write_executor_ref(self, job_id, ref):
        self.db.execute(
            "INSERT INTO job_executor_bindings(job_id, kind, source, digest) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(job_id) DO UPDATE SET kind=excluded.kind, source=excluded.source, digest=excluded.digest",
            (job_id, ref.kind, ref.source, ref.digest),
        )
