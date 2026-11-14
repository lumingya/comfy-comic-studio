"""Durable endpoint ownership, independent of worker epochs and job lifetime."""

from __future__ import annotations

import json
import uuid

from .pool import normalize_endpoint
from .types import JobConflict, canonical


class StateLeases:
    def __init__(self, engine):
        self.engine = engine
        with engine.lock, engine.pool.lock:
            for record in self.list():
                engine.pool.state_blocks[record["endpoint"]] = record["token"]

    @staticmethod
    def _record(row) -> dict | None:
        if row is None:
            return None
        record = dict(row)
        record["data"] = json.loads(record.pop("data_json"))
        return record

    def get(self, job_id: str, idx: int) -> dict | None:
        with self.engine.lock:
            return self._record(
                self.engine.db.execute(
                    "SELECT * FROM state_leases WHERE job_id = ? AND idx = ?", (job_id, idx)
                ).fetchone()
            )

    def list(self, job_id: str | None = None) -> list[dict]:
        with self.engine.lock:
            query = "SELECT * FROM state_leases"
            args = ()
            if job_id is not None:
                query += " WHERE job_id = ?"
                args = (job_id,)
            return [self._record(row) for row in self.engine.db.execute(query, args).fetchall()]

    def _reserve(self, job_id: str, idx: int, epoch: int, base_url: str) -> dict:
        """Called inside the engine claim transaction and engine/pool locks."""
        endpoint, token = normalize_endpoint(base_url), uuid.uuid4().hex
        self.engine.db.execute(
            "INSERT INTO state_leases(endpoint, token, job_id, idx, epoch, base_url, data_json) "
            "VALUES (?, ?, ?, ?, ?, ?, '{}')",
            (endpoint, token, job_id, idx, epoch, base_url),
        )
        self.engine.pool.state_blocks[endpoint] = token
        return {
            "endpoint": endpoint,
            "token": token,
            "job_id": job_id,
            "idx": idx,
            "epoch": epoch,
            "base_url": base_url,
            "data": {},
        }

    def update(self, token: str, data: dict) -> dict:
        """Replace opaque recovery data; cancellation does not invalidate the token."""
        with self.engine.lock, self.engine.db:
            changed = self.engine.db.execute(
                "UPDATE state_leases SET data_json = ? WHERE token = ?", (canonical(data), token)
            )
            if changed.rowcount != 1:
                raise JobConflict("state lease is no longer owned by this token")
            return self._record(
                self.engine.db.execute(
                    "SELECT * FROM state_leases WHERE token = ?", (token,)
                ).fetchone()
            )

    def release(self, token: str) -> bool:
        """Release only this ownership token, never a newer owner's reservation."""
        with self.engine.lock, self.engine.pool.lock:
            with self.engine.db:
                row = self.engine.db.execute(
                    "SELECT endpoint FROM state_leases WHERE token = ?", (token,)
                ).fetchone()
                if row is None:
                    return False
                self.engine.db.execute("DELETE FROM state_leases WHERE token = ?", (token,))
            if self.engine.pool.state_blocks.get(row["endpoint"]) == token:
                del self.engine.pool.state_blocks[row["endpoint"]]
        self.engine.wake.set()
        return True
