"""Scheduler internals of :class:`~mio_server.jobs.engine.JobEngine` (claim, run, finish, events).

Kept as a mixin so the public API in ``engine.py`` stays readable; the mixin relies on the
attributes created by ``JobEngine.__init__`` (``db``, ``lock``, ``pool``, ``executors`` …).
"""

from __future__ import annotations

import json
import logging
import threading
import time
from contextlib import contextmanager

from .operations import OperationBusy, operation_serialized
from .pool import COMFY, LOCAL, Candidate
from .types import (  # noqa: F401
    ITEM_STATES,
    TERMINAL,
    Canceled,
    ExecError,
    ItemContext,
    JobConflict,
    JobNotFound,
    canonical,
)

log = logging.getLogger("mio.jobs")


class EngineRuntime:
    @contextmanager
    def _job_guard(self, job_id: str, *, command: bool = False):
        """Serialize result application and destructive commands for one job.

        Never wait for this guard while holding the database lock: a result hook may
        read the engine or submit another job. References keep guards alive for waiters.
        Reentrant mutations from a result hook are rejected rather than invalidating the
        result that hook is currently committing.
        """
        with self.lock:
            guard, users = self._job_guards.get(job_id, (threading.RLock(), 0))
            self._job_guards[job_id] = (guard, users + 1)
        try:
            # Listeners may hold the database lock; hooks may call another job.
            # Nested calls must not wait and invert either lock order.
            if not guard.acquire(blocking=not getattr(self._callback_context, "active", False)):
                raise JobConflict("a result is being saved; retry this command after it finishes")
            try:
                if command and job_id in self._applying_jobs:
                    raise JobConflict(
                        "a result is being saved; retry this command after it finishes"
                    )
                yield
            finally:
                guard.release()
        finally:
            with self.lock:
                _, users = self._job_guards[job_id]
                if users == 1:
                    del self._job_guards[job_id]
                else:
                    self._job_guards[job_id] = (guard, users - 1)

    @contextmanager
    def _callback_scope(self):
        active = getattr(self._callback_context, "active", False)
        self._callback_context.active = True
        try:
            yield
        finally:
            self._callback_context.active = active

    @operation_serialized
    def tick(self) -> int:
        """One scheduling pass (the background loop calls this; tests may call it directly)."""
        with self.lock:
            rows = self.db.execute(
                """SELECT i.job_id, i.idx, i.resource, i.group_key, i.instances, i.input_json,
                   j.priority, j.created, j.window,
                   (SELECT COUNT(*) FROM job_items r WHERE r.job_id = i.job_id AND r.state = 'running') AS active
                   FROM job_items i JOIN jobs j ON j.id = i.job_id
                   WHERE i.state = 'pending' AND j.paused = 0 AND j.blocked = 0 AND j.canceled = 0
                   ORDER BY j.priority DESC, j.created, i.idx LIMIT 500"""
            ).fetchall()
            budget: dict[str, int] = {}
            candidates = []
            for r in rows:
                if r["job_id"] not in budget:
                    budget[r["job_id"]] = r["window"] - r["active"]
                if budget[r["job_id"]] <= 0 or (r["resource"] not in self.executors_resources()):
                    continue
                budget[r["job_id"]] -= 1
                candidates.append(
                    Candidate(
                        r["job_id"],
                        r["idx"],
                        r["resource"],
                        r["group_key"],
                        tuple(json.loads(r["instances"])),
                        (-r["priority"], r["created"], r["idx"]),
                        self._needs_state_lease(json.loads(r["input_json"])),
                    )
                )
            plan = self.pool.plan(candidates)
            started = 0
            for cand, instance_id in plan:
                ctx = self._claim(cand, instance_id)
                if ctx:
                    self.workers.submit(self._run, ctx, cand.resource, instance_id)
                    started += 1
            return started

    def executors_resources(self) -> set[str]:
        return {LOCAL, COMFY}

    # ================================================================== internals
    def _loop(self) -> None:
        while not self.closed:
            try:
                self.tick()
            except Exception:  # never let the scheduler die
                log.exception("scheduler pass failed")
            self.wake.wait(self.poll)
            self.wake.clear()

    @operation_serialized
    def _claim(self, cand: Candidate, instance_id: str | None) -> ItemContext | None:
        now = time.time()
        with self.lock, self.pool.lock:
            item = self._item_row(cand.job_id, cand.idx)
            binding = self.job_executor(cand.job_id)
            if binding is None or item["resource"] not in binding.resources:
                with self.db:
                    self._aggregate(cand.job_id)
                return None
            exclusive = self._needs_state_lease(json.loads(item["input_json"]))
            if not self.pool.available(cand.resource, instance_id, exclusive):
                return None
            instance = self.pool.instance(instance_id)
            record, ctx, acquired = None, None, False
            try:
                with self.db:
                    cur = self.db.execute(
                        "UPDATE job_items SET state = 'running', epoch = epoch + 1, "
                        "attempts = attempts + 1, sent = 0, upstream = NULL, instance_id = ?, "
                        "started = ?, finished = NULL, error_json = NULL, updated = ? "
                        "WHERE job_id = ? AND idx = ? AND state = 'pending'",
                        (instance_id, now, now, cand.job_id, cand.idx),
                    )
                    if cur.rowcount != 1:
                        return None
                    job = self._job_dict(
                        self.db.execute(
                            "SELECT * FROM jobs WHERE id = ?", (cand.job_id,)
                        ).fetchone()
                    )
                    row = self._item_row(cand.job_id, cand.idx)
                    if exclusive and cand.resource == COMFY:
                        record = self.state_leases._reserve(
                            cand.job_id, cand.idx, row["epoch"], instance.base_url
                        )
                    self.pool.acquire(cand.resource, instance_id, cand.group)
                    acquired = True
                    ctx = self._context(job, row, instance)
                    self.running[(cand.job_id, cand.idx)] = ctx
                    self._event(
                        cand.job_id,
                        cand.idx,
                        "started",
                        {"instance": instance_id, "attempt": row["attempts"]},
                    )
                    self._aggregate(cand.job_id)
            except Exception:
                if ctx is not None and self.running.get((cand.job_id, cand.idx)) is ctx:
                    del self.running[(cand.job_id, cand.idx)]
                if acquired:
                    self.pool.release(
                        cand.resource, instance_id, instance.base_url if instance else None
                    )
                if record and self.state_leases.get(cand.job_id, cand.idx) is None:
                    if self.pool.state_blocks.get(record["endpoint"]) == record["token"]:
                        del self.pool.state_blocks[record["endpoint"]]
                raise
        return ctx

    @staticmethod
    def _needs_state_lease(payload: dict) -> bool:
        return any(stage.get("frontend_state") for stage in payload.get("stages", []))

    def _context(self, job: dict, row, instance) -> ItemContext:
        return ItemContext(
            self,
            job["id"],
            job["kind"],
            row["idx"],
            row["epoch"],
            row["attempts"],
            json.loads(row["input_json"]),
            job["snapshot"],
            instance,
            row["upstream"],
            state_lease=self.state_leases.get(job["id"], row["idx"]),
            executor_binding=self.job_executor(job["id"]),
        )

    def _run(self, ctx: ItemContext, resource: str, instance_id: str | None) -> None:
        executor = ctx.executor_binding.executor if ctx.executor_binding else None
        entered_executor = False
        try:
            if executor is None:
                raise ExecError(
                    f"no executor registered for {ctx.kind}", kind="no_executor", sent=False
                )
            ctx.raise_if_cancelled()
            entered_executor = True
            result = executor.execute(ctx)
            try:
                self._finish(
                    ctx.job_id,
                    ctx.idx,
                    ctx.epoch,
                    "complete",
                    result=result or {},
                    apply=True,
                    defer_busy=True,
                )
            except OperationBusy:
                # The received result is durable. Leave the result guard before waiting for
                # planning, then apply that same result once with the safe lock order. Keep
                # its epoch so cancellation during the wait still wins. Never re-execute.
                with self.hold_operation():
                    self._finish(
                        ctx.job_id, ctx.idx, ctx.epoch, "complete", result=result or {}, apply=True
                    )
        except ExecError as exc:
            sent = exc.sent if exc.sent is not None else self._was_sent(ctx)
            state = "canceled" if isinstance(exc, Canceled) else ("uncertain" if sent else "failed")
            self._finish(
                ctx.job_id,
                ctx.idx,
                ctx.epoch,
                state,
                error={
                    "kind": exc.kind,
                    "message": str(exc),
                    "detail": exc.detail,
                    "upstream": ctx.upstream,
                },
            )
        except Exception as exc:  # unexpected executor bug: uncertain if anything was sent
            state = "uncertain" if self._was_sent(ctx) else "failed"
            log.exception("executor %s crashed", ctx.kind)
            self._finish(
                ctx.job_id,
                ctx.idx,
                ctx.epoch,
                state,
                error={
                    "kind": "executor_crash",
                    "message": f"{type(exc).__name__}: {exc}",
                    "upstream": ctx.upstream,
                },
            )
        finally:
            try:
                if ctx.state_lease:
                    record = self.state_leases.get(ctx.job_id, ctx.idx)
                    if record and record["token"] == ctx.state_lease["token"]:
                        data = record["data"]
                        unused = not entered_executor and not data
                        saved = (
                            data.get("phase") == "restored"
                            and data.get("result") is not None
                            and self._item_row(ctx.job_id, ctx.idx)["state"] in TERMINAL
                        )
                        if unused or saved:
                            self.state_leases.release(record["token"])
            except Exception:
                log.exception("could not release restored endpoint state reservation")
            with self.lock:
                if self.running.get((ctx.job_id, ctx.idx)) is ctx:
                    del self.running[(ctx.job_id, ctx.idx)]
            self.pool.release(
                resource, instance_id, ctx.instance.base_url if ctx.instance else None
            )
            self.wake.set()

    def _was_sent(self, ctx: ItemContext) -> bool:
        with self.lock:
            row = self.db.execute(
                "SELECT sent FROM job_items WHERE job_id = ? AND idx = ?", (ctx.job_id, ctx.idx)
            ).fetchone()
        return bool(row and row["sent"])

    def _checkpoint(self, ctx: ItemContext, sent: bool) -> None:
        with self.lock, self.db:
            self.db.execute(
                "UPDATE job_items SET sent = ?, upstream = COALESCE(?, upstream), updated = ? "
                "WHERE job_id = ? AND idx = ? AND epoch = ?",
                (int(sent), ctx.upstream, time.time(), ctx.job_id, ctx.idx, ctx.epoch),
            )
            self._event(ctx.job_id, ctx.idx, "sent", {"upstream": ctx.upstream})
        ctx.raise_if_cancelled()

    def _finish(
        self,
        job_id: str,
        idx: int,
        epoch: int,
        state: str,
        result: dict | None = None,
        error: dict | None = None,
        apply: bool = False,
        *,
        defer_busy: bool = False,
    ) -> None:
        with self._job_guard(job_id, command=True):
            self._finish_guarded(job_id, idx, epoch, state, result, error, apply, defer_busy)

    def _finish_guarded(
        self, job_id, idx, epoch, state, result, error, apply, defer_busy=False
    ) -> None:
        now = time.time()
        with self.lock:
            row = self.db.execute(
                "SELECT * FROM job_items WHERE job_id = ? AND idx = ?", (job_id, idx)
            ).fetchone()
            if row is None or row["epoch"] != epoch or row["state"] not in ("running", "uncertain"):
                with self.db:
                    self._event(
                        job_id,
                        idx,
                        "stale_result",
                        {"state": state, "result": result, "error": error},
                    )
                return
            job = self._job_dict(
                self.db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            )
        delivery = None
        if state == "complete" and apply:
            # Commit before invoking domain code: a crash must not lose a received result.
            delivery = self._record_delivery(row, result)
            running = self.running.get((job_id, idx))
            binding = running.executor_binding if running else self.job_executor(job_id)
            executor = binding.executor if binding else None
            if executor is None:
                with self.lock, self.db:
                    self.db.execute(
                        "UPDATE job_items SET state = 'failed', error_json = ? WHERE job_id = ? AND idx = ?",
                        (
                            canonical(
                                {
                                    "kind": "executor_missing",
                                    "message": "Result retained; original executor is unavailable",
                                }
                            ),
                            job_id,
                            idx,
                        ),
                    )
                    self._aggregate(job_id)
                return
            hook = getattr(executor, "on_complete", None)
            if hook:
                self._applying_jobs.add(job_id)
                try:
                    with self._callback_scope():
                        hook(
                            job,
                            {
                                **self._item_dict(row),
                                "delivery_id": self._delivery_id(delivery),
                                "delivery_sha": delivery["result_sha"],
                            },
                            result,
                        )
                except Exception as exc:
                    if isinstance(exc, OperationBusy) and defer_busy and binding.replay_safe:
                        raise
                    log.exception("on_complete failed")
                    state, error = (
                        "failed",
                        {"kind": "apply_failed", "message": f"结果已返回但保存失败：{exc}"},
                    )
                finally:
                    self._applying_jobs.remove(job_id)
        with self.lock, self.db:
            updated = self.db.execute(
                "UPDATE job_items SET state = ?, result_json = ?, error_json = ?, finished = ?, updated = ? "
                "WHERE job_id = ? AND idx = ? AND epoch = ? AND state IN ('running', 'uncertain')",
                (
                    state,
                    canonical(result) if result is not None else row["result_json"],
                    json.dumps(error, ensure_ascii=False, default=str) if error else None,
                    now,
                    now,
                    job_id,
                    idx,
                    epoch,
                ),
            )
            if updated.rowcount != 1:
                self._event(job_id, idx, "stale_result", {"state": state})
                return
            if delivery is not None:
                self.db.execute(
                    "UPDATE job_deliveries SET state = ?, updated = ?, error = ? "
                    "WHERE job_id = ? AND idx = ? AND attempt = ?",
                    (
                        "applied" if state == "complete" else "pending",
                        now,
                        error.get("message") if error else None,
                        job_id,
                        idx,
                        delivery["attempt"],
                    ),
                )
            event_data = {"error": error} if error else {}
            if delivery is not None:
                event_data["delivery_id"] = self._delivery_id(delivery)
            self._event(job_id, idx, state, event_data)
            if state == "failed":
                failures = self.db.execute(
                    "SELECT COUNT(*) FROM job_items WHERE job_id = ? AND state = 'failed'",
                    (job_id,),
                ).fetchone()[0]
                if job["failure_limit"] and failures >= job["failure_limit"] and not job["paused"]:
                    self.db.execute(
                        "UPDATE jobs SET paused = 1, error = ? WHERE id = ?",
                        (f"连续失败 {failures} 项，已暂停。检查后再继续。", job_id),
                    )
                    self._event(job_id, None, "failure_limit", {"failures": failures})
            self._aggregate(job_id)

    def _aggregate(self, job_id: str) -> None:
        counts = {s: 0 for s in ITEM_STATES}
        for r in self.db.execute(
            "SELECT state, COUNT(*) AS n FROM job_items WHERE job_id = ? GROUP BY state", (job_id,)
        ):
            counts[r["state"]] = r["n"]
        job = self.db.execute(
            "SELECT paused, canceled, state FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        missing = bool(counts["pending"] and self.job_executor(job_id) is None)
        blocked = 1 if counts["uncertain"] or missing else 0
        total = sum(counts.values())
        if counts["running"]:
            state = "running"
        elif job["canceled"] and not counts["pending"]:
            state = "canceled"
        elif blocked:
            state = "blocked"
        elif job["paused"] and counts["pending"]:
            state = "paused"
        elif counts["pending"]:
            state = "queued" if counts["pending"] == total else "running"
        elif counts["failed"]:
            state = "failed"
        elif counts["canceled"] and not counts["complete"]:
            state = "canceled"
        else:
            state = "completed"
        self.db.execute(
            "UPDATE jobs SET state = ?, blocked = ?, updated = ? WHERE id = ?",
            (state, blocked, time.time(), job_id),
        )
        if state != job["state"]:
            self._event(job_id, None, "state", {"state": state, "counts": counts})

    def _event(self, job_id: str, idx: int | None, type_: str, data: dict) -> None:
        self._emit(job_id, idx, type_, data, persist=True)

    def _emit(self, job_id: str, idx: int | None, type_: str, data: dict, persist: bool) -> None:
        at = time.time()
        payload = {"job_id": job_id, "idx": idx, "type": type_, "data": data, "at": at}
        if persist:
            with self.lock:
                cur = self.db.execute(
                    "INSERT INTO job_events(job_id, idx, type, data_json, at) VALUES (?, ?, ?, ?, ?)",
                    (job_id, idx, type_, json.dumps(data, ensure_ascii=False, default=str), at),
                )
                payload["seq"] = cur.lastrowid
        for fn in list(self.listeners):
            try:
                with self._callback_scope():
                    fn(payload)
            except Exception:
                log.exception("job listener failed")

    def _set_flag(self, job_id: str, column: str, value: int, event: str) -> dict:
        with self.lock, self.db:
            self._require(job_id)
            self.db.execute(
                f"UPDATE jobs SET {column} = ?, updated = ? WHERE id = ?",
                (value, time.time(), job_id),
            )
            self._event(job_id, None, event, {})
            self._aggregate(job_id)
        return self.get(job_id)

    def _require(self, job_id: str) -> dict:
        row = self.db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise JobNotFound(f"job not found: {job_id}")
        return self._job_dict(row)

    def _item_row(self, job_id: str, idx: int):
        with self.lock:
            row = self.db.execute(
                "SELECT * FROM job_items WHERE job_id = ? AND idx = ?", (job_id, idx)
            ).fetchone()
        if not row:
            raise JobNotFound(f"item not found: {job_id}/{idx}")
        return row

    def _job_dict(self, row) -> dict:
        return {
            "id": row["id"],
            "kind": row["kind"],
            "title": row["title"],
            "state": row["state"],
            "idempotency_key": row["idempotency_key"],
            "snapshot": json.loads(row["snapshot_json"]),
            "snapshot_sha": row["snapshot_sha"],
            "window": row["window"],
            "priority": row["priority"],
            "failure_limit": row["failure_limit"],
            "paused": bool(row["paused"]),
            "blocked": bool(row["blocked"]),
            "canceled": bool(row["canceled"]),
            "owner": row["owner"],
            "error": row["error"],
            "created": row["created"],
            "updated": row["updated"],
            "executor": self.executor_status(row["id"]),
        }

    @staticmethod
    def _item_dict(row) -> dict:
        return {
            "idx": row["idx"],
            "state": row["state"],
            "epoch": row["epoch"],
            "attempts": row["attempts"],
            "resource": row["resource"],
            "group": row["group_key"],
            "label": row["label"],
            "instances": json.loads(row["instances"]),
            "input": json.loads(row["input_json"]),
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "error": json.loads(row["error_json"]) if row["error_json"] else None,
            "upstream": row["upstream"],
            "sent": bool(row["sent"]),
            "instance_id": row["instance_id"],
            "started": row["started"],
            "finished": row["finished"],
        }
