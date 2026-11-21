"""Durable result delivery, separate from executing an upstream request.

An executor opts in with ``replay_safe = True`` only when its completion callback is
idempotent across process restarts. The domain store must commit its mutation and receipt
together; a completed HTTP request alone cannot provide that guarantee.
"""

from __future__ import annotations

import hashlib
import logging
import time

from .types import JobConflict, canonical

log = logging.getLogger("mio.jobs")


class DeliveryRuntime:
    def deliveries(self, job_id: str) -> list[dict]:
        with self.lock:
            self._require(job_id)
            rows = self.db.execute(
                "SELECT * FROM job_deliveries WHERE job_id = ? ORDER BY idx, attempt", (job_id,)
            ).fetchall()
        return [
            {
                "id": self._delivery_id(row),
                "idx": row["idx"],
                "attempt": row["attempt"],
                "state": row["state"],
                "result_sha": row["result_sha"],
                "created": row["created"],
                "updated": row["updated"],
                "error": row["error"],
            }
            for row in rows
        ]

    @staticmethod
    def _delivery_id(row) -> str:
        return f"{row['job_id']}:{row['idx']}:{row['attempt']}"

    def _pending_delivery(self, job_id, idx):
        # Completion and recovery callers can hold only a per-job guard. The connection
        # is shared with scheduling and other jobs, so even reads need the database lock.
        with self.lock:
            return self.db.execute(
                "SELECT * FROM job_deliveries WHERE job_id = ? AND idx = ? "
                "AND state IN ('pending', 'publishing') ORDER BY attempt DESC",
                (job_id, idx),
            ).fetchone()

    def _record_delivery(self, row, result):
        """Called under the job guard, before any completion callback can mutate a work."""
        existing = self._pending_delivery(row["job_id"], row["idx"])
        if existing:
            if not self._restore_publication(row["job_id"], row["idx"]):
                raise JobConflict("the local result publication is incomplete or only a stage")
        payload = canonical(result)
        sha = hashlib.sha256(payload.encode()).hexdigest()
        now = time.time()
        with self.lock, self.db:
            existing = self.db.execute(
                "SELECT * FROM job_deliveries WHERE job_id = ? AND idx = ? AND attempt = ?",
                (row["job_id"], row["idx"], row["attempts"]),
            ).fetchone()
            if existing:
                if existing["result_sha"] != sha:
                    raise JobConflict("a different result is already stored for this attempt")
                return existing
            self.db.execute(
                "INSERT INTO job_deliveries "
                "(job_id, idx, attempt, state, result_sha, result_json, created, updated) "
                "VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
                (row["job_id"], row["idx"], row["attempts"], sha, payload, now, now),
            )
            self.db.execute(
                "UPDATE job_items SET result_json = ? WHERE job_id = ? AND idx = ?",
                (payload, row["job_id"], row["idx"]),
            )
        return self._pending_delivery(row["job_id"], row["idx"])

    def replay_result(self, job_id: str, idx: int) -> dict:
        """Apply an already received result; never execute, reconcile or contact a provider."""
        with self._job_guard(job_id, command=True):
            with self.lock:
                job = self._require(job_id)
                row = self._item_row(job_id, idx)
                if job["canceled"] or row["state"] == "canceled":
                    raise JobConflict("canceled results cannot be applied")
                if (job_id, idx) in self.running:
                    raise JobConflict("the original worker is still running")
                record = self.state_leases.get(job_id, idx)
                if record and record["data"].get("phase") != "restored":
                    raise JobConflict("restore the endpoint state before replaying this result")
                delivery = self._pending_delivery(job_id, idx)
                if delivery is None:
                    raise JobConflict("this item has no result awaiting delivery")
            if not self._restore_publication(job_id, idx):
                return self.get(job_id)
            delivery = self._pending_delivery(job_id, idx)
            with self.lock:
                binding = self.job_executor(job_id, required=True)
                if not binding.replay_safe:
                    raise JobConflict("this executor has not declared replay-safe result delivery")
                if delivery["attempt"] != row["attempts"]:
                    raise JobConflict("the stored result belongs to a different attempt")
                with self.db:
                    self.db.execute(
                        "UPDATE job_items SET state = 'uncertain' WHERE job_id = ? AND idx = ?",
                        (job_id, idx),
                    )
                result = self._delivery_result(delivery)
            self._finish_guarded(job_id, idx, row["epoch"], "complete", result, None, True)
            record = self.state_leases.get(job_id, idx)
            if record and record["data"].get("phase") == "restored":
                self.state_leases.release(record["token"])
        return self.get(job_id)

    def recover_deliveries(self) -> int:
        """One pass after executors are registered; failed callbacks are not looped forever."""
        with self.lock:
            rows = self.db.execute(
                "SELECT d.job_id, d.idx, j.kind FROM job_deliveries d JOIN jobs j ON j.id = d.job_id "
                "WHERE d.state IN ('pending', 'publishing') AND j.canceled = 0"
            ).fetchall()
        count = 0
        for row in rows:
            binding = self.job_executor(row["job_id"])
            if not binding or not binding.replay_safe:
                continue
            try:
                job = self.replay_result(row["job_id"], row["idx"])
                count += job["items"][row["idx"]]["state"] == "complete"
            except Exception as exc:
                log.warning("delivery %s/%s remains pending: %s", row["job_id"], row["idx"], exc)
        return count
