"""Unified job engine (ROADMAP §6.2), replacing the legacy mio_jobs / production queue pair.

Safety semantics inherited from the legacy paid-request engine:

* **Immutable snapshot** – a job's inputs are frozen (with a sha256) at submit time; later edits to
  panels never change what an already queued job sends.
* **Idempotency** – ``submit`` with the same key and the same snapshot returns the existing job;
  the same key with a different snapshot is a conflict.  A double click never double-submits.
* **Epochs** – every claim / stop bumps the item epoch.  A worker that returns after its item was
  stopped or re-queued is *stale*: its result is logged but never applied.
* **uncertain** – if an item fails (or the process dies) after the request may have reached the
  upstream, the item becomes ``uncertain`` and the job is blocked.  It is never resubmitted
  implicitly; the user reconciles (e.g. Comfy history lookup), marks it failed, or confirms a
  resubmit.
* **No implicit retry** – ``failed`` items stay failed.  A failure limit pauses the job.
* **Stop** – ``cancel`` signals running work and calls the executor's ``abort`` (Comfy:
  interrupt / delete from queue). A result already being committed finishes first; a stop
  that wins the commit guard prevents result application. Other jobs remain independent.
* **Restart recovery** – items found ``running`` on start-up become ``uncertain``; executors with a
  ``reconcile`` hook can confirm them from upstream records without resubmitting.
* **Lease** – one engine per database file (OS file lock).
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from typing import Callable

from ..registry import Registry
from .delivery import DeliveryRuntime
from .executors import ExecutorRuntime, ExecutorView
from .lease import FileLease
from .operations import OperationRuntime, operation_serialized
from .pool import InstanceSlot, ResourcePool
from .runtime import EngineRuntime
from .state_leases import StateLeases
from .types import (  # noqa: F401  (re-exported)
    ITEM_STATES,
    SCHEMA,
    TERMINAL,
    Canceled,
    ExecError,
    Executor,
    ItemContext,
    ItemSpec,
    JobConflict,
    JobError,
    JobNotFound,
    canonical,
)

log = logging.getLogger("mio.jobs")


class JobEngine(ExecutorRuntime, OperationRuntime, DeliveryRuntime, EngineRuntime):
    def __init__(
        self,
        path: str | Path = ":memory:",
        pool: ResourcePool | None = None,
        autostart: bool = True,
        poll: float = 0.2,
        max_workers: int = 8,
    ):
        self.path = str(path)
        self.pool = pool or ResourcePool()
        self.registry = Registry()
        self.executors = ExecutorView(self)
        self.catalog_loading = False
        self.lock = threading.RLock()
        self._operation_lock = threading.RLock()
        self._job_guards: dict[str, tuple[threading.RLock, int]] = {}
        self._applying_jobs: set[str] = set()
        self._callback_context = threading.local()
        self.wake = threading.Event()
        self.closed = False
        self.poll = poll
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with ExitStack() as startup:
            self.lease = FileLease(self.path + ".lease") if self.path != ":memory:" else None
            if self.lease:
                startup.callback(self.lease.release)
            self.db = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
            startup.callback(self.db.close)
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA foreign_keys = ON")
            with self.db:
                self.db.executescript(SCHEMA)
            self.running: dict[tuple[str, int], ItemContext] = {}
            self.listeners: list[Callable[[dict], None]] = []
            self.workers = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="mio-job")
            startup.callback(self.workers.shutdown, wait=True, cancel_futures=True)
            startup.callback(self._stop_failed_start)
            self.state_leases = StateLeases(self)
            self._recover()
            self.thread = threading.Thread(target=self._loop, name="mio-job-scheduler", daemon=True)
            if autostart:
                self.thread.start()
            startup.pop_all()

    def _stop_failed_start(self) -> None:
        """Bootstrap can fail before close()'s required fields exist."""
        self.closed = True
        self.wake.set()
        thread = getattr(self, "thread", None)
        if thread is not None and thread.is_alive():
            thread.join(timeout=5)

    # ================================================================= lifecycle
    def start(self) -> None:
        if not self.thread.is_alive() and not self.closed:
            self.thread.start()

    def close(self, wait: bool = True) -> None:
        if self.closed:
            return
        self.closed = True
        self.wake.set()
        with self.lock:
            for ctx in list(self.running.values()):
                ctx.cancelled.set()
        if self.thread.is_alive():
            self.thread.join(timeout=5)
        self.workers.shutdown(wait=wait, cancel_futures=True)
        with self.lock:
            self.db.close()
        if self.lease:
            self.lease.release()

    def _recover(self) -> None:
        now = time.time()
        with self.lock, self.db:
            rows = self.db.execute(
                "SELECT job_id, idx, upstream, sent FROM job_items WHERE state = 'running'"
            ).fetchall()
            for r in rows:
                error = {
                    "kind": "result_unconfirmed",
                    "message": "服务中断时这一项正在执行。先核对上游结果，确认后再决定是否重新提交。",
                    "upstream": r["upstream"],
                }
                state = (
                    "uncertain"
                    if r["sent"]
                    or self.state_leases.get(r["job_id"], r["idx"])
                    or self._pending_delivery(r["job_id"], r["idx"])
                    else "pending"
                )
                self.db.execute(
                    "UPDATE job_items SET state = ?, error_json = ?, epoch = epoch + 1, updated = ? "
                    "WHERE job_id = ? AND idx = ?",
                    (
                        state,
                        json.dumps(error, ensure_ascii=False) if state == "uncertain" else None,
                        now,
                        r["job_id"],
                        r["idx"],
                    ),
                )
                self._event(
                    r["job_id"], r["idx"], "recovered", {"state": state, "upstream": r["upstream"]}
                )
            affected = {r["job_id"] for r in rows}
            affected.update(
                row[0]
                for row in self.db.execute(
                    "SELECT DISTINCT job_id FROM job_items WHERE state = 'pending'"
                )
            )
            for job_id in affected:
                self._aggregate(job_id)

    # ================================================================== public API
    @operation_serialized
    def submit(
        self,
        kind: str,
        items: list[ItemSpec],
        snapshot: dict | None = None,
        *,
        title: str = "",
        idempotency_key: str | None = None,
        window: int = 1,
        priority: int = 0,
        failure_limit: int = 3,
        owner: str = "",
        paused: bool = False,
    ) -> dict:
        if self.catalog_loading:
            raise JobConflict("tasks cannot be submitted while extension activation is in progress")
        if not items:
            raise JobError("a job needs at least one item")
        snapshot = snapshot or {}
        body = {
            "kind": kind,
            "snapshot": snapshot,
            "items": [
                {
                    "input": i.input,
                    "resource": i.resource,
                    "group": i.group,
                    "instances": list(i.instances),
                }
                for i in items
            ],
        }
        sha = hashlib.sha256(canonical(body).encode()).hexdigest()
        now = time.time()
        with self.lock, self.db:
            if idempotency_key:
                row = self.db.execute(
                    "SELECT id, snapshot_sha FROM jobs WHERE idempotency_key = ?",
                    (idempotency_key,),
                ).fetchone()
                if row:
                    if row["snapshot_sha"] != sha:
                        raise JobConflict("idempotency key reused with a different payload")
                    return self.get(row["id"])
            job_id = "job_" + uuid.uuid4().hex[:16]
            binding = self.current_executor(kind)
            if binding and any(item.resource not in binding.resources for item in items):
                raise JobError("executor does not support the requested resources")
            self.db.execute(
                """INSERT INTO jobs(id, kind, title, state, idempotency_key, snapshot_json, snapshot_sha, window,
                   priority, failure_limit, paused, owner, created, updated)
                   VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    job_id,
                    kind,
                    title,
                    idempotency_key,
                    canonical(snapshot),
                    sha,
                    max(1, window),
                    priority,
                    max(0, failure_limit),
                    int(paused),
                    owner,
                    now,
                    now,
                ),
            )
            if binding:
                self._write_executor_ref(job_id, binding.ref)
            for idx, item in enumerate(items):
                self.db.execute(
                    """INSERT INTO job_items(job_id, idx, state, resource, group_key, instances, label, input_json,
                       updated) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)""",
                    (
                        job_id,
                        idx,
                        item.resource,
                        item.group,
                        json.dumps(list(item.instances)),
                        item.label,
                        canonical(item.input),
                        now,
                    ),
                )
            self._event(job_id, None, "submitted", {"items": len(items)})
            self._aggregate(job_id)
        self.wake.set()
        return self.get(job_id)

    def get(self, job_id: str, items: bool = True) -> dict:
        with self.lock:
            row = self.db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                raise JobNotFound(f"job not found: {job_id}")
            job = self._job_dict(row)
            if items:
                rows = self.db.execute(
                    "SELECT * FROM job_items WHERE job_id = ? ORDER BY idx", (job_id,)
                ).fetchall()
                job["items"] = [self._item_dict(r) for r in rows]
            return job

    def find_submission(self, idempotency_key: str) -> dict | None:
        """Find the frozen job for a logical request before consulting mutable inputs."""
        with self.lock:
            row = self.db.execute(
                "SELECT id FROM jobs WHERE idempotency_key = ?", (idempotency_key,)
            ).fetchone()
            return self.get(row["id"]) if row else None

    def list(
        self,
        owner: str | None = None,
        limit: int = 100,
        active_only: bool = False,
        *,
        kinds: tuple[str, ...] = (),
    ) -> list[dict]:
        sql, args = "SELECT * FROM jobs", []
        conds = []
        if owner is not None:
            conds.append("owner = ?")
            args.append(owner)
        if active_only:
            conds.append("state IN ('queued', 'running', 'paused', 'blocked')")
        if kinds:
            placeholders = ",".join("?" for _ in kinds)
            conds.append(f"kind IN ({placeholders})")
            args.extend(kinds)
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        sql += " ORDER BY created DESC LIMIT ?"
        args.append(limit)
        with self.lock:
            jobs = [self._job_dict(r) for r in self.db.execute(sql, args).fetchall()]
            if not jobs:
                return jobs
            # Item counts so a list can show progress without loading every item.
            marks = ",".join("?" * len(jobs))
            rows = self.db.execute(
                "SELECT job_id, state, COUNT(*) AS n FROM job_items "
                f"WHERE job_id IN ({marks}) GROUP BY job_id, state",
                [j["id"] for j in jobs],
            ).fetchall()
        counts: dict[str, dict[str, int]] = {}
        for r in rows:
            counts.setdefault(r["job_id"], {})[r["state"]] = r["n"]
        for job in jobs:
            by_state = counts.get(job["id"], {})
            job["total"] = sum(by_state.values())
            job["done"] = by_state.get("complete", 0) + by_state.get("skipped", 0)
            job["failed"] = by_state.get("failed", 0) + by_state.get("uncertain", 0)
        return jobs

    def events(self, job_id: str, after: int = 0, limit: int = 200) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT * FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT ?",
                (job_id, after, limit),
            ).fetchall()
        return [
            {
                "seq": r["seq"],
                "job_id": r["job_id"],
                "idx": r["idx"],
                "type": r["type"],
                "data": json.loads(r["data_json"]),
                "at": r["at"],
            }
            for r in rows
        ]

    def pause(self, job_id: str) -> dict:
        return self._set_flag(job_id, "paused", 1, "paused")

    def resume(self, job_id: str) -> dict:
        with self.lock, self.db:
            self._require(job_id)
            self.db.execute(
                "UPDATE jobs SET paused = 0, error = NULL, updated = ? WHERE id = ?",
                (time.time(), job_id),
            )
            self._event(job_id, None, "resumed", {})
            self._aggregate(job_id)
        self.wake.set()
        return self.get(job_id)

    def set_window(self, job_id: str, window: int) -> dict:
        """How many items of the job may run at once; applies from the next dispatch."""
        with self.lock, self.db:
            self._require(job_id)
            self.db.execute(
                "UPDATE jobs SET window = ?, updated = ? WHERE id = ?",
                (max(1, int(window)), time.time(), job_id),
            )
            self._event(job_id, None, "window", {"window": max(1, int(window))})
        self.wake.set()
        return self.get(job_id, items=False)

    def cancel(self, job_id: str) -> dict:
        """Stop execution immediately, after any result already being committed finishes."""
        with self._job_guard(job_id, command=True):
            return self._cancel_guarded(job_id)

    def _cancel_guarded(self, job_id: str) -> dict:
        hooks = []
        now = time.time()
        with self.lock, self.db:
            self._require(job_id)
            self.db.execute("UPDATE jobs SET canceled = 1, updated = ? WHERE id = ?", (now, job_id))
            self.db.execute(
                "UPDATE job_deliveries SET state = 'discarded', updated = ? "
                "WHERE job_id = ? AND state = 'pending'",
                (now, job_id),
            )
            self.db.execute(
                "UPDATE job_items SET state = 'canceled', updated = ?, epoch = epoch + 1 "
                "WHERE job_id = ? AND state IN ('pending', 'uncertain')",
                (now, job_id),
            )
            for (jid, idx), ctx in list(self.running.items()):
                if jid != job_id:
                    continue
                row = self.db.execute(
                    "SELECT state, sent, upstream FROM job_items WHERE job_id = ? AND idx = ?",
                    (jid, idx),
                ).fetchone()
                if row["state"] != "running":
                    continue  # The callback committed before cancellation acquired the guard.
                ctx.cancelled.set()
                hooks.extend(ctx.abort_hooks)
                error = {
                    "kind": "canceled_after_send" if row["sent"] else "canceled",
                    "message": "已停止。请求可能已到达上游，结果不会被采用。"
                    if row["sent"]
                    else "已停止。",
                    "upstream": row["upstream"],
                }
                self.db.execute(
                    "UPDATE job_items SET state = 'canceled', error_json = ?, epoch = epoch + 1, "
                    "finished = ?, updated = ? WHERE job_id = ? AND idx = ?",
                    (json.dumps(error, ensure_ascii=False), now, now, jid, idx),
                )
            self._event(job_id, None, "canceled", {})
            self._aggregate(job_id)
        for hook in hooks:
            try:
                with self._callback_scope():
                    hook()
            except Exception as exc:  # abort is best effort
                log.warning("abort hook failed: %s", exc)
        return self.get(job_id)

    @operation_serialized
    def retry(
        self,
        job_id: str,
        indexes: list[int] | None = None,
        from_index: int | None = None,
        confirm_uncertain: bool = False,
        include_complete: bool = False,
    ) -> dict:
        """Explicit re-run: single items (``indexes``) or a suffix (``from_index``)."""
        with self._job_guard(job_id, command=True):
            return self._retry_guarded(
                job_id, indexes, from_index, confirm_uncertain, include_complete
            )

    def _retry_guarded(self, job_id, indexes, from_index, confirm_uncertain, include_complete):
        now = time.time()
        with self.lock, self.db:
            self._require(job_id)
            if self.state_leases.list(job_id):
                raise JobConflict("restore the endpoint state before retrying this job")
            rows = self.db.execute(
                "SELECT idx, state FROM job_items WHERE job_id = ? ORDER BY idx", (job_id,)
            ).fetchall()
            chosen = [
                r
                for r in rows
                if (indexes is None or r["idx"] in indexes)
                and (from_index is None or r["idx"] >= from_index)
            ]
            if not chosen:
                raise JobError("no items selected")
            allowed = {"failed", "canceled", "uncertain", "skipped"} | (
                {"complete"} if include_complete else set()
            )
            for r in chosen:
                if self._pending_delivery(job_id, r["idx"]):
                    raise JobConflict(
                        "a received result is awaiting delivery; replay it before retrying"
                    )
                if r["state"] == "running":
                    raise JobConflict(f"item {r['idx']} is still running")
                if r["state"] == "uncertain" and not confirm_uncertain:
                    raise JobConflict(
                        f"item {r['idx']} is uncertain: reconcile it or confirm the resubmit"
                    )
            reset = [r["idx"] for r in chosen if r["state"] in allowed]
            for idx in reset:
                self.db.execute(
                    "UPDATE job_items SET state = 'pending', error_json = NULL, sent = 0, upstream = NULL, "
                    "instance_id = NULL, epoch = epoch + 1, updated = ? WHERE job_id = ? AND idx = ?",
                    (now, job_id, idx),
                )
            self.db.execute(
                "UPDATE jobs SET canceled = 0, paused = 0, error = NULL, updated = ? WHERE id = ?",
                (now, job_id),
            )
            self._event(
                job_id, None, "retried", {"items": reset, "confirmed_uncertain": confirm_uncertain}
            )
            self._aggregate(job_id)
        self.wake.set()
        return self.get(job_id)

    def resolve(self, job_id: str, idx: int, action: str, result: dict | None = None) -> dict:
        """Resolve uncertain work; ``resubmit`` explicitly confirms retrying this item only."""
        with self.lock:
            pending = self._pending_delivery(job_id, idx)
        if pending:
            if action == "reconcile":
                return self.replay_result(job_id, idx)
            raise JobConflict("a received result is awaiting delivery; replay it or cancel the job")
        if self.state_leases.get(job_id, idx):
            if action != "reconcile":
                raise JobConflict("restore the endpoint state before resolving this item")
            self.restore_state(job_id, idx)
            return self.get(job_id)
        row = self._item_row(job_id, idx)
        if row["state"] != "uncertain":
            raise JobConflict(f"item {idx} is {row['state']}, not uncertain")
        if action == "resubmit":
            return self.retry(job_id, indexes=[idx], confirm_uncertain=True)
        if action == "reconcile":
            job = self.get(job_id, items=False)
            executor = self.job_executor(job_id, required=True).executor
            if not executor or not hasattr(executor, "reconcile"):
                raise JobError("this job kind cannot reconcile automatically")
            ctx = self._context(job, row, self.pool.instance(row["instance_id"]))
            with self._callback_scope():
                result = executor.reconcile(ctx)
            if result is None:
                self._event(job_id, idx, "reconcile_miss", {"upstream": row["upstream"]})
                return self.get(job_id)
            action = "complete"
        if action == "complete":
            self._finish(job_id, idx, row["epoch"], "complete", result=result or {}, apply=True)
        elif action == "failed":
            self._finish(
                job_id,
                idx,
                row["epoch"],
                "failed",
                error={"kind": "resolved_failed", "message": "已人工标记为失败"},
            )
        else:
            raise JobError(f"unknown action: {action}")
        return self.get(job_id)

    def restore_state(
        self, job_id: str, idx: int, confirm_stopped: bool = False, *, discard_result: bool = False
    ) -> dict:
        """Explicitly restore a frozen endpoint and only then allow further dispatch."""
        with self._job_guard(job_id, command=True):
            with self.lock:
                job = self._require(job_id)
                row = self._item_row(job_id, idx)
                if (job_id, idx) in self.running:
                    raise JobConflict("the original worker is still running")
                record = self.state_leases.get(job_id, idx)
                if record is None:
                    raise JobConflict("this item has no endpoint state to restore")
                executor = self.job_executor(job_id, required=True).executor
                if not hasattr(executor, "recover_state"):
                    raise JobError("this job kind cannot restore endpoint state")
                instance = InstanceSlot(row["instance_id"] or "", record["base_url"])
                ctx = self._context(job, row, instance)
            options = {"confirm_stopped": confirm_stopped}
            if discard_result:
                options["discard_result"] = True
            with self._callback_scope():
                report = executor.recover_state(ctx, record, **options)
            if not report.get("restored"):
                return report
            # Cancellation is allowed to retain ownership; cleanup must never adopt its result.
            with self.lock:
                job = self._require(job_id)
                row = self._item_row(job_id, idx)
            if row["state"] == "uncertain" and not job["canceled"]:
                result = report.get("result")
                if result is not None:
                    self._finish(job_id, idx, row["epoch"], "complete", result=result, apply=True)
                else:
                    self._finish(
                        job_id,
                        idx,
                        row["epoch"],
                        "failed",
                        error=report.get("error")
                        or {
                            "kind": "state_restored",
                            "message": "Endpoint restored; retry explicitly.",
                        },
                    )
            self.state_leases.release(record["token"])
            return report

    def reconcile_all(self) -> int:
        """Try every uncertain item whose executor supports reconcile (read-only upstream lookups)."""
        with self.lock:
            rows = self.db.execute(
                "SELECT i.job_id, i.idx, j.kind FROM job_items i JOIN jobs j ON j.id = i.job_id "
                "WHERE i.state = 'uncertain' AND i.upstream IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM state_leases s "
                "WHERE s.job_id = i.job_id AND s.idx = i.idx)"
            ).fetchall()
        fixed = 0
        for r in rows:
            binding = self.job_executor(r["job_id"])
            if binding and hasattr(binding.executor, "reconcile"):
                try:
                    if (
                        self.resolve(r["job_id"], r["idx"], "reconcile")["items"][r["idx"]]["state"]
                        == "complete"
                    ):
                        fixed += 1
                except Exception as exc:
                    log.warning("reconcile %s/%s failed: %s", r["job_id"], r["idx"], exc)
        return fixed

    def delete(self, job_id: str) -> None:
        with self._job_guard(job_id, command=True), self.lock, self.db:
            job = self._require(job_id)
            if any(d["state"] == "pending" for d in self.deliveries(job_id)):
                raise JobConflict(
                    "a received result is awaiting delivery; replay it or cancel the job"
                )
            if self.state_leases.list(job_id):
                raise JobConflict("restore the endpoint state before deleting this job")
            if job["state"] in ("running",):
                raise JobConflict("stop the job before deleting it")
            self.db.execute("DELETE FROM job_events WHERE job_id = ?", (job_id,))
            self.db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))

    def subscribe(self, fn: Callable[[dict], None]) -> Callable[[], None]:
        with self.lock:
            self.listeners.append(fn)
        return lambda: self.listeners.remove(fn) if fn in self.listeners else None

    def wait(
        self,
        job_id: str,
        timeout: float = 10.0,
        states=("completed", "failed", "canceled", "blocked", "paused"),
    ) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            job = self.get(job_id)
            if job["state"] in states and not any(i["state"] == "running" for i in job["items"]):
                return job
            time.sleep(0.02)
        raise TimeoutError(f"job {job_id} still {self.get(job_id, items=False)['state']}")
