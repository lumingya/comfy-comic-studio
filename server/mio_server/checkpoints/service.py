"""No foreign key ties a checkpoint's lifetime to a live work or episode.

These snapshots protect editing history, not the workstation's image files or settings.
Restoration currently requires the original work to exist (including in the trash).
"""

from __future__ import annotations

import hashlib
import json

from ..models import Episode, new_id, now_iso
from ..storage import Conflict, NotFound
from .models import (
    Checkpoint,
    CheckpointCreate,
    CheckpointPreview,
    CheckpointRestored,
    CheckpointSummary,
    WorkSnapshot,
)
from .validation import assets_for, validate_references


def head_of(snapshot: WorkSnapshot) -> str:
    payload = snapshot.model_dump(mode="json")
    payload["episodes"].sort(key=lambda episode: episode["id"])
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def content_of(document) -> dict:
    return document.model_dump(mode="json", exclude={"revision", "updated_at", "created_at"})


class Checkpoints:
    def __init__(self, ctx):
        self.ctx, self.store = ctx, ctx.store
        with self.store.tx() as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS work_checkpoints (
                   id TEXT PRIMARY KEY, series_id TEXT NOT NULL, created_at TEXT NOT NULL,
                   summary_json TEXT NOT NULL, payload_json TEXT NOT NULL)"""
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS idx_work_checkpoints_series "
                "ON work_checkpoints(series_id, created_at DESC)"
            )

    def snapshot(self, series_id: str) -> WorkSnapshot:
        with self.store.lock:
            series = self.store.get_series(series_id, include_deleted=True)
            episodes = [
                Episode.model_validate_json(row["payload_json"])
                for row in self.store._rows(
                    "SELECT payload_json FROM episodes WHERE series_id = ? ORDER BY episode_order, id",
                    (series_id,),
                )
            ]
            return WorkSnapshot(series=series, episodes=episodes)

    def head(self, series_id: str) -> str:
        return head_of(self.snapshot(series_id))

    @staticmethod
    def summary(checkpoint: Checkpoint) -> CheckpointSummary:
        return CheckpointSummary.model_validate(
            checkpoint.model_dump(exclude={"snapshot", "asset_ids"})
        )

    def list(self, series_id: str) -> list[CheckpointSummary]:
        return [
            CheckpointSummary.model_validate_json(row["summary_json"])
            for row in self.store._rows(
                "SELECT summary_json FROM work_checkpoints WHERE series_id = ? "
                "ORDER BY created_at DESC, rowid DESC",
                (series_id,),
            )
        ]

    def get(self, series_id: str, checkpoint_id: str) -> Checkpoint:
        rows = self.store._rows(
            "SELECT payload_json FROM work_checkpoints WHERE id = ? AND series_id = ?",
            (checkpoint_id, series_id),
        )
        if not rows:
            raise NotFound(f"checkpoint not found: {checkpoint_id}")
        checkpoint = Checkpoint.model_validate_json(rows[0]["payload_json"])
        if (
            checkpoint.id != checkpoint_id
            or checkpoint.series_id != series_id
            or checkpoint.snapshot.series.id != series_id
            or checkpoint.head != head_of(checkpoint.snapshot)
            or set(checkpoint.asset_ids) != assets_for(checkpoint.snapshot)
            or len(checkpoint.asset_ids) != len(set(checkpoint.asset_ids))
            or checkpoint.asset_count != len(checkpoint.asset_ids)
            or checkpoint.episode_count != len(checkpoint.snapshot.episodes)
            or checkpoint.deleted_episode_count
            != sum(bool(episode.deleted_at) for episode in checkpoint.snapshot.episodes)
        ):
            raise Conflict("checkpoint integrity check failed")
        return checkpoint

    def _save(self, snapshot: WorkSnapshot, name: str, kind="manual") -> Checkpoint:
        assets = sorted(assets_for(snapshot))
        checkpoint = Checkpoint(
            id=new_id("checkpoint"),
            series_id=snapshot.series.id,
            name=name,
            created_at=now_iso(),
            kind=kind,
            head=head_of(snapshot),
            episode_count=len(snapshot.episodes),
            deleted_episode_count=sum(bool(episode.deleted_at) for episode in snapshot.episodes),
            asset_count=len(assets),
            snapshot=snapshot,
            asset_ids=assets,
        )
        with self.store.tx() as db:
            db.execute(
                "INSERT INTO work_checkpoints(id, series_id, created_at, summary_json, payload_json) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    checkpoint.id,
                    checkpoint.series_id,
                    checkpoint.created_at,
                    self.summary(checkpoint).model_dump_json(),
                    checkpoint.model_dump_json(),
                ),
            )
        return checkpoint

    def create(self, series_id: str, request: CheckpointCreate) -> Checkpoint:
        with self.store.tx():
            snapshot = self.snapshot(series_id)
            if request.expected_head and request.expected_head != head_of(snapshot):
                raise Conflict("work changed; read its head and retry checkpoint creation")
            self._validate(snapshot)
            return self._save(snapshot, request.name)

    def _validate(self, snapshot: WorkSnapshot) -> None:
        errors = validate_references(snapshot, self.store)
        missing = sorted(aid for aid in assets_for(snapshot) if not self.ctx.assets.exists(aid))
        if errors or missing:
            raise Conflict(
                "checkpoint references are unavailable: " + "; ".join([*errors, *missing])
            )

    def preview(self, series_id: str, checkpoint_id: str) -> CheckpointPreview:
        with self.store.lock:
            checkpoint = self.get(series_id, checkpoint_id)
            current = self.snapshot(series_id)
            old = {episode.id: episode for episode in current.episodes}
            target = {episode.id: episode for episode in checkpoint.snapshot.episodes}
            errors = validate_references(checkpoint.snapshot, self.store)
            missing = sorted(aid for aid in checkpoint.asset_ids if not self.ctx.assets.exists(aid))
            preview = CheckpointPreview(
                checkpoint_id=checkpoint.id,
                series_id=series_id,
                current_head=head_of(current),
                target_head=checkpoint.head,
                series_changed=content_of(current.series) != content_of(checkpoint.snapshot.series),
                added_episode_ids=sorted(target.keys() - old.keys()),
                changed_episode_ids=sorted(
                    eid
                    for eid in target.keys() & old.keys()
                    if content_of(target[eid]) != content_of(old[eid])
                ),
                removed_episode_ids=sorted(old.keys() - target.keys()),
                missing_asset_ids=missing,
                reference_errors=errors,
                active_job_ids=[],
                can_restore=not errors and not missing,
            )
        # Engine locks are only taken after releasing the store lock. Preview is advisory;
        # restore repeats this check while it excludes new submissions.
        preview.active_job_ids = self.ctx.engine.active_operation_jobs(
            {series_id, *old.keys(), *target.keys()}
        )
        preview.can_restore = preview.can_restore and not preview.active_job_ids
        return preview

    def restore(self, series_id: str, checkpoint_id: str, expected_head: str) -> CheckpointRestored:
        # Read ownership before the engine guard. The head check below rejects any intervening
        # work changes; we never wait for the engine while holding the work store lock.
        checkpoint = self.get(series_id, checkpoint_id)
        current = self.snapshot(series_id)
        owners = {
            series_id,
            *(episode.id for episode in current.episodes),
            *(episode.id for episode in checkpoint.snapshot.episodes),
        }
        with self.ctx.engine.operation_guard(owners), self.store.tx() as db:
            checkpoint = self.get(series_id, checkpoint_id)
            current = self.snapshot(series_id)
            if expected_head != head_of(current):
                raise Conflict("work changed since preview; preview again before restoring")
            self._validate(checkpoint.snapshot)
            target_ids = {episode.id for episode in checkpoint.snapshot.episodes}
            for eid in target_ids:
                rows = db.execute("SELECT series_id FROM episodes WHERE id = ?", (eid,)).fetchall()
                if rows and rows[0]["series_id"] != series_id:
                    raise Conflict(f"episode ID now belongs to a different work: {eid}")
            protection = self._save(
                current, f"Before restoring {checkpoint.name}"[:160], "pre_restore"
            )
            # Free order slots inside this transaction, without inventing extra revisions.
            db.execute(
                "UPDATE episodes SET deleted_at = ? WHERE series_id = ?", (now_iso(), series_id)
            )
            self.store.save_series(checkpoint.snapshot.series.model_copy(deep=True))
            existing = {episode.id for episode in current.episodes}
            for saved in checkpoint.snapshot.episodes:
                episode = saved.model_copy(deep=True)
                if episode.id in existing:
                    self.store.save_episode(episode)
                else:
                    # Purge removes per-episode history; retained work checkpoints can still
                    # carry a newer revision than the chosen target snapshot.
                    revision = db.execute(
                        "SELECT MAX(CAST(json_extract(e.value, '$.revision') AS INTEGER)) "
                        "FROM work_checkpoints c, json_each(c.payload_json, '$.snapshot.episodes') e "
                        "WHERE c.series_id = ? AND json_extract(e.value, '$.id') = ?",
                        (series_id, episode.id),
                    ).fetchone()[0]
                    episode.revision = max(episode.revision, revision or 0) + 1
                    episode.updated_at = now_iso()
                    self.store._check_order(db, episode)
                    self.store._insert_episode(db, episode)
            extras = []
            for episode in current.episodes:
                if episode.id not in target_ids:
                    if not episode.deleted_at:
                        extras.append(episode.id)
                    episode.deleted_at = episode.deleted_at or now_iso()
                    self.store.save_episode(episode)
            return CheckpointRestored(
                checkpoint_id=checkpoint_id,
                series_id=series_id,
                head=self.head(series_id),
                pre_restore_checkpoint=self.summary(protection),
                restored_episode_ids=sorted(target_ids),
                trashed_episode_ids=sorted(extras),
            )

    def delete(self, series_id: str, checkpoint_id: str) -> None:
        with self.store.tx() as db:
            result = db.execute(
                "DELETE FROM work_checkpoints WHERE id = ? AND series_id = ?",
                (checkpoint_id, series_id),
            )
            if result.rowcount != 1:
                raise NotFound(f"checkpoint not found: {checkpoint_id}")

    def referenced_assets(self) -> set[str]:
        """Retention roots for a future workspace backup or garbage collector."""
        found: set[str] = set()
        for row in self.store._rows(
            "SELECT json_extract(payload_json, '$.asset_ids') AS refs FROM work_checkpoints"
        ):
            found.update(json.loads(row["refs"]))
        return found
