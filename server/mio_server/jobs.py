"""Unified job engine skeleton with the safety semantics inherited from v2.

This module is deliberately small but already enforces the rules that matter for paid / expensive
requests: idempotency keys, immutable request snapshots, leases, cancellation, and an explicit
``uncertain`` state for attempts whose outcome is unknown.
"""
from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from uuid import uuid4


class JobState(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"
    uncertain = "uncertain"


TERMINAL = {JobState.succeeded, JobState.failed, JobState.canceled, JobState.uncertain}


@dataclass(frozen=True)
class Job:
    id: str
    kind: str
    state: JobState
    idempotency_key: str
    snapshot_json: str
    lease_until: float
    result_json: str | None = None

    @property
    def snapshot(self) -> dict:
        return json.loads(self.snapshot_json)


class JobStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        if self.path != Path(":memory:"):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.migrate()

    def close(self) -> None:
        self.db.close()

    def migrate(self) -> None:
        with self.db:
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS jobs(
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    state TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    snapshot_json TEXT NOT NULL,
                    lease_until REAL NOT NULL DEFAULT 0,
                    result_json TEXT
                )"""
            )

    def submit(self, kind: str, snapshot: dict, idempotency_key: str) -> Job:
        snap = json.dumps(snapshot, ensure_ascii=False, sort_keys=True)
        with self.db:
            row = self.db.execute("SELECT * FROM jobs WHERE idempotency_key=?", (idempotency_key,)).fetchone()
            if row:
                if row["snapshot_json"] != snap:
                    raise ValueError("idempotency key reused with a different immutable snapshot")
                return self._job(row)
            jid = "job_" + uuid4().hex[:16]
            self.db.execute(
                "INSERT INTO jobs(id, kind, state, idempotency_key, snapshot_json, lease_until) VALUES(?,?,?,?,?,0)",
                (jid, kind, JobState.queued.value, idempotency_key, snap),
            )
        return self.get_by_key(idempotency_key)

    def lease(self, worker: str, ttl: float = 60.0) -> Job | None:
        now = time.time()
        row = self.db.execute(
            "SELECT * FROM jobs WHERE state=? OR (state=? AND lease_until < ?) ORDER BY rowid LIMIT 1",
            (JobState.queued.value, JobState.running.value, now),
        ).fetchone()
        if not row:
            return None
        lease_until = now + ttl
        with self.db:
            self.db.execute("UPDATE jobs SET state=?, lease_until=? WHERE id=?", (JobState.running.value, lease_until, row["id"]))
        return self.get(row["id"])

    def complete(self, job_id: str, result: dict) -> Job:
        return self._transition(job_id, JobState.succeeded, result)

    def fail(self, job_id: str, error: str) -> Job:
        return self._transition(job_id, JobState.failed, {"error": error})

    def mark_uncertain(self, job_id: str, reason: str) -> Job:
        return self._transition(job_id, JobState.uncertain, {"reason": reason})

    def cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job.state in TERMINAL:
            return job
        return self._transition(job_id, JobState.canceled, {"canceled": True})

    def get(self, job_id: str) -> Job:
        row = self.db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise KeyError(job_id)
        return self._job(row)

    def get_by_key(self, key: str) -> Job:
        row = self.db.execute("SELECT * FROM jobs WHERE idempotency_key=?", (key,)).fetchone()
        if not row:
            raise KeyError(key)
        return self._job(row)

    def _transition(self, job_id: str, state: JobState, result: dict) -> Job:
        job = self.get(job_id)
        if job.state in TERMINAL:
            return job
        with self.db:
            self.db.execute("UPDATE jobs SET state=?, result_json=?, lease_until=0 WHERE id=?",
                            (state.value, json.dumps(result, ensure_ascii=False, sort_keys=True), job_id))
        return self.get(job_id)

    @staticmethod
    def _job(row) -> Job:
        return Job(id=row["id"], kind=row["kind"], state=JobState(row["state"]), idempotency_key=row["idempotency_key"],
                   snapshot_json=row["snapshot_json"], lease_until=row["lease_until"], result_json=row["result_json"])
