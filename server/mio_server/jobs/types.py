"""Job engine data types: schema, errors, item specs and the executor context."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Protocol

from .pool import LOCAL, InstanceSlot

if TYPE_CHECKING:
    from .engine import JobEngine

ITEM_STATES = ("pending", "running", "complete", "failed", "uncertain", "canceled", "skipped")
TERMINAL = {"complete", "failed", "canceled", "skipped"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', state TEXT NOT NULL,
    idempotency_key TEXT UNIQUE, snapshot_json TEXT NOT NULL, snapshot_sha TEXT NOT NULL,
    window INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0, failure_limit INTEGER NOT NULL DEFAULT 3,
    paused INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, canceled INTEGER NOT NULL DEFAULT 0,
    owner TEXT NOT NULL DEFAULT '', error TEXT, created REAL NOT NULL, updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS job_items (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, idx INTEGER NOT NULL, state TEXT NOT NULL,
    epoch INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, resource TEXT NOT NULL,
    group_key TEXT NOT NULL DEFAULT '', instances TEXT NOT NULL DEFAULT '[]', label TEXT NOT NULL DEFAULT '',
    input_json TEXT NOT NULL, result_json TEXT, error_json TEXT, upstream TEXT, sent INTEGER NOT NULL DEFAULT 0,
    instance_id TEXT, started REAL, finished REAL, updated REAL NOT NULL, PRIMARY KEY(job_id, idx));
CREATE INDEX IF NOT EXISTS idx_items_dispatch ON job_items(state, job_id, idx);
CREATE TABLE IF NOT EXISTS job_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, idx INTEGER, type TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}', at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_job ON job_events(job_id, seq);
"""


class JobError(RuntimeError):
    pass


class JobConflict(JobError):
    pass


class JobNotFound(JobError):
    pass


class ExecError(RuntimeError):
    """Raised by executors.  ``sent``: False = provably never reached upstream (safe failure);
    True / None = may have reached upstream (→ uncertain)."""

    def __init__(
        self, message: str, kind: str = "error", sent: bool | None = None, detail: Any = None
    ):
        super().__init__(message)
        self.kind, self.sent, self.detail = kind, sent, detail


class Canceled(ExecError):
    def __init__(self, message: str = "stopped"):
        super().__init__(message, kind="canceled", sent=None)


@dataclass
class ItemSpec:
    input: dict
    resource: str = LOCAL
    group: str = ""
    label: str = ""
    instances: tuple[str, ...] = ()


@dataclass
class ItemContext:
    engine: "JobEngine"
    job_id: str
    kind: str
    idx: int
    epoch: int
    attempt: int
    input: dict
    snapshot: dict
    instance: InstanceSlot | None
    upstream: str | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)
    abort_hooks: list[Callable[[], None]] = field(default_factory=list)

    def mark_sent(self, upstream: str | None = None) -> None:
        """Call *before* the request leaves the process: from now on a failure is uncertain."""
        self.upstream = upstream or self.upstream
        self.engine._checkpoint(self, sent=True)

    def checkpoint(self, upstream: str) -> None:
        """Record the upstream id (e.g. Comfy prompt_id) as soon as it is known."""
        self.upstream = upstream
        self.engine._checkpoint(self, sent=True)

    def progress(self, **data) -> None:
        self.engine._emit(self.job_id, self.idx, "progress", data, persist=False)

    def on_abort(self, hook: Callable[[], None]) -> None:
        self.abort_hooks.append(hook)

    def raise_if_cancelled(self) -> None:
        if self.cancelled.is_set():
            raise Canceled()


class Executor(Protocol):
    def execute(self, ctx: ItemContext) -> dict: ...


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
