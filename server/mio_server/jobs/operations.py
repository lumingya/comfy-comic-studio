"""Coordinate work management with job planning without locking result callbacks out.

Order: operation lock -> engine lock (short inspection) -> release engine lock -> work store.
Completion callbacks never wait for the operation lock while holding their job guard. A worker
may reapply a replay-safe result after releasing that guard when follow-up planning contends.
"""

from contextlib import contextmanager
from functools import wraps
from typing import Iterable

from .types import JobConflict


class OperationBusy(JobConflict):
    """A callback cannot wait for planning while it holds a result or database lock."""


def operation_serialized(fn):
    """Hold planning and submission together, on either an engine or its domain service."""

    @wraps(fn)
    def guarded(self, *args, **kwargs):
        engine = getattr(self, "engine", self)
        with engine.hold_operation():
            return fn(self, *args, **kwargs)

    return guarded


class OperationRuntime:
    @contextmanager
    def hold_operation(self):
        """Acquire before reading mutable work for a future submission, never under store.lock."""
        callback = getattr(self._callback_context, "active", False)
        if not self._operation_lock.acquire(blocking=not callback):
            raise OperationBusy("work management is in progress; retry this operation afterwards")
        try:
            yield
        finally:
            self._operation_lock.release()

    def active_operation_jobs(self, owner_ids: Iterable[str] | None = None) -> list[str]:
        """Include paused work, unacknowledged deliveries and canceled workers still exiting.

        A job without an owner has unknown mutation scope, so it blocks all works. Extensions
        must declare the work/episode they mutate as owner; None queries the whole workspace.
        This is diagnostic only unless called while holding hold_operation().
        """
        owners = None if owner_ids is None else set(owner_ids)
        with self.lock:
            active = {
                row["id"]: row["owner"]
                for row in self.db.execute(
                    "SELECT j.id, j.owner FROM jobs j WHERE "
                    "EXISTS (SELECT 1 FROM job_items i WHERE i.job_id = j.id "
                    "AND i.state IN ('pending', 'running', 'uncertain')) OR "
                    "EXISTS (SELECT 1 FROM job_deliveries d WHERE d.job_id = j.id "
                    "AND d.state IN ('pending', 'publishing')) OR "
                    "EXISTS (SELECT 1 FROM state_leases s WHERE s.job_id = j.id)"
                ).fetchall()
            }
            for job_id, _ in self.running:
                if job_id not in active:
                    row = self.db.execute(
                        "SELECT owner FROM jobs WHERE id = ?", (job_id,)
                    ).fetchone()
                    active[job_id] = row["owner"] if row else ""
        return sorted(
            job_id
            for job_id, owner in active.items()
            if owners is None or not owner or owner in owners
        )

    @contextmanager
    def operation_guard(self, owner_ids: Iterable[str] | None = None):
        """Reject busy work immediately, then block new planning/claims through the mutation.

        Never wait for job guards here. Callers must acquire this before their store transaction
        and recheck a document revision/content head inside that transaction.
        """
        if getattr(self._callback_context, "active", False):
            raise JobConflict("work management cannot run inside a job callback; run it afterwards")
        with self.hold_operation():
            busy = self.active_operation_jobs(owner_ids)
            if busy:
                raise JobConflict("work has active or unresolved jobs: " + ", ".join(busy))
            yield
