"""Scheduler internals of :class:`~mio_server.jobs.engine.JobEngine` (claim, run, finish, events).

Kept as a mixin so the public API in ``engine.py`` stays readable; the mixin relies on the
attributes created by ``JobEngine.__init__`` (``db``, ``lock``, ``pool``, ``executors`` …).
"""

from __future__ import annotations

import json
import logging
import time

from .pool import COMFY, LOCAL, Candidate
from .types import (  # noqa: F401
    ITEM_STATES,
    TERMINAL,
    Canceled,
    ExecError,
    ItemContext,
    JobNotFound,
    canonical,
)

log = logging.getLogger("mio.jobs")


class EngineRuntime:
    def tick(self) -> int:
        """One scheduling pass (the background loop calls this; tests may call it directly)."""
        with self.lock:
            rows = self.db.execute(
                """SELECT i.job_id, i.idx, i.resource, i.group_key, i.instances, j.priority, j.created, j.window,
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

    def _claim(self, cand: Candidate, instance_id: str | None) -> ItemContext | None:
        now = time.time()
        with self.db:
            cur = self.db.execute(
                "UPDATE job_items SET state = 'running', epoch = epoch + 1, attempts = attempts + 1, sent = 0, "
                "upstream = NULL, instance_id = ?, started = ?, finished = NULL, error_json = NULL, updated = ? "
                "WHERE job_id = ? AND idx = ? AND state = 'pending'",
                (instance_id, now, now, cand.job_id, cand.idx),
            )
            if cur.rowcount != 1:
                return None
            self.pool.acquire(cand.resource, instance_id, cand.group)
            job = self._job_dict(
                self.db.execute("SELECT * FROM jobs WHERE id = ?", (cand.job_id,)).fetchone()
            )
            row = self.db.execute(
                "SELECT * FROM job_items WHERE job_id = ? AND idx = ?", (cand.job_id, cand.idx)
            ).fetchone()
            ctx = self._context(job, row, self.pool.instance(instance_id))
            self.running[(cand.job_id, cand.idx)] = ctx
            self._event(
                cand.job_id,
                cand.idx,
                "started",
                {"instance": instance_id, "attempt": row["attempts"]},
            )
            self._aggregate(cand.job_id)
        return ctx

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
        )

    def _run(self, ctx: ItemContext, resource: str, instance_id: str | None) -> None:
        executor = self.executors.get(ctx.kind)
        try:
            if executor is None:
                raise ExecError(
                    f"no executor registered for {ctx.kind}", kind="no_executor", sent=False
                )
            ctx.raise_if_cancelled()
            result = executor.execute(ctx)
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
            with self.lock:
                if self.running.get((ctx.job_id, ctx.idx)) is ctx:
                    del self.running[(ctx.job_id, ctx.idx)]
            self.pool.release(resource, instance_id)
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
        if state == "complete" and apply:
            executor = self.executors.get(job["kind"])
            hook = getattr(executor, "on_complete", None)
            if hook:
                try:
                    hook(job, self._item_dict(row), result)
                except Exception as exc:
                    log.exception("on_complete failed")
                    state, error = (
                        "failed",
                        {"kind": "apply_failed", "message": f"结果已返回但保存失败：{exc}"},
                    )
        with self.lock, self.db:
            self.db.execute(
                "UPDATE job_items SET state = ?, result_json = ?, error_json = ?, finished = ?, updated = ? "
                "WHERE job_id = ? AND idx = ? AND epoch = ?",
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
            self._event(job_id, idx, state, {"error": error} if error else {})
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
        blocked = 1 if counts["uncertain"] else 0
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

    @staticmethod
    def _job_dict(row) -> dict:
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
