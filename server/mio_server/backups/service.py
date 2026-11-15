"""Archive, inspect, stage and schedule restoration; application remains running until restart."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from ..jobs.lease import FileLease
from ..models import new_id, now_iso
from ..storage import Conflict, NotFound
from .archive import inspect_archive, pack, verify_workspace
from .database import logical_head
from .models import (
    BackupCreated,
    BackupHead,
    BackupInspection,
    BackupOptions,
    RestoreApply,
    RestoreJournal,
    RestorePlan,
    RestoreScheduled,
)
from .paths import atomic_json, read_json, recovery_root, safe_child, sha_file
from .snapshot import capture, current_head, quiescent


class Backups:
    def __init__(self, ctx):
        self.ctx = ctx
        self.root = recovery_root(ctx.data_dir)
        if self.root.is_symlink():
            raise ValueError("workspace recovery directory must not be a link")
        self.root.mkdir(parents=True, exist_ok=True)

    def head(self) -> BackupHead:
        active = self.ctx.engine.active_operation_jobs()
        return BackupHead(head=None if active else current_head(self.ctx), active_job_ids=active)

    def _export_locked(self, options: BackupOptions) -> BackupCreated:
        identifier = new_id("backup")
        target = safe_child(self.root / "exports", identifier)
        target.mkdir(parents=True)
        try:
            with tempfile.TemporaryDirectory(prefix=".snapshot-", dir=self.root) as temporary:
                workspace = Path(temporary)
                manifest = capture(self.ctx, workspace, options.include_credentials)
                pack(workspace, manifest, target / "workspace.zip")
            inspection = inspect_archive(target / "workspace.zip")
            result = BackupCreated(id=identifier, inspection=inspection)
            atomic_json(target / "record.json", result.model_dump(mode="json"))
            return result
        except BaseException:
            shutil.rmtree(target)
            raise

    def export(self, options: BackupOptions) -> BackupCreated:
        with quiescent(self.ctx):
            return self._export_locked(options)

    def get(self, identifier: str) -> BackupCreated:
        path = safe_child(self.root / "exports", identifier)
        return BackupCreated.model_validate(read_json(path / "record.json"))

    def download(self, identifier: str) -> Path:
        record = self.get(identifier)
        path = safe_child(self.root / "exports", identifier) / "workspace.zip"
        if not path.is_file() or sha_file(path) != record.inspection.sha256:
            raise Conflict("stored backup failed checksum verification")
        return path

    @staticmethod
    def inspect(path: Path) -> BackupInspection:
        return inspect_archive(path)

    def stage(self, archive: Path) -> RestorePlan:
        identifier = new_id("restore")
        target = safe_child(self.root / "plans", identifier)
        target.mkdir(parents=True)
        try:
            shutil.copyfile(archive, target / "workspace.zip")
            inspection = inspect_archive(target / "workspace.zip", target / "workspace")
            plan = RestorePlan(
                id=identifier,
                created_at=now_iso(),
                inspection=inspection,
                expected_head=current_head(self.ctx),
            )
            atomic_json(target / "plan.json", plan.model_dump(mode="json"))
            return plan
        except BaseException:
            shutil.rmtree(target)
            raise

    def get_plan(self, identifier: str) -> RestorePlan:
        path = safe_child(self.root / "plans", identifier)
        plan = RestorePlan.model_validate(read_json(path / "plan.json"))
        if plan.id != identifier:
            raise Conflict("restore plan identity does not match its directory")
        return plan

    def apply(self, identifier: str, command: RestoreApply) -> RestoreScheduled:
        with FileLeaseContext(self.root / "journal.lease"), quiescent(self.ctx):
            plan = self.get_plan(identifier)
            if plan.state not in {"staged", "pending"}:
                raise Conflict("this restore plan is no longer staged")
            pending = self.root / "pending.json"
            if pending.exists():
                journal = RestoreJournal.model_validate(read_json(pending))
                if (
                    journal.plan_id == identifier
                    and journal.expected_head == command.expected_head
                    and journal.archive_sha256 == command.expected_archive_sha256
                ):
                    return RestoreScheduled(plan=plan)
                raise Conflict("a different workspace restoration is already scheduled")
            head = logical_head(self.ctx.store._conn, self.ctx.engine.db)
            if head != command.expected_head or plan.expected_head != command.expected_head:
                raise Conflict("workspace changed since staging; stage the archive again")
            folder = safe_child(self.root / "plans", identifier)
            if (
                command.expected_archive_sha256 != plan.inspection.sha256
                or sha_file(folder / "workspace.zip") != plan.inspection.sha256
            ):
                raise Conflict("staged archive changed; inspect and stage it again")
            verify_workspace(folder / "workspace", plan.inspection.manifest)
            # This protection is intentionally complete and may contain credentials. It never
            # leaves the local recovery directory unless explicitly downloaded through admin API.
            protection = self._export_locked(BackupOptions(include_credentials=True))
            plan.protection_backup_id = protection.id
            plan.state = "pending"
            atomic_json(folder / "plan.json", plan.model_dump(mode="json"))
            journal = RestoreJournal(
                plan_id=identifier, expected_head=head, archive_sha256=plan.inspection.sha256
            )
            atomic_json(pending, journal.model_dump(mode="json"))
            return RestoreScheduled(plan=plan)

    def cancel(self, identifier: str) -> RestorePlan:
        with FileLeaseContext(self.root / "journal.lease"):
            plan = self.get_plan(identifier)
            pending = self.root / "pending.json"
            if pending.exists():
                journal = RestoreJournal.model_validate(read_json(pending))
                if journal.plan_id != identifier or journal.phase != "pending":
                    raise Conflict("restoration installation has already started")
                pending.unlink()
            elif plan.state != "staged":
                raise Conflict("this restore plan cannot be canceled")
            plan.state, plan.message = "rejected", "Canceled before restart."
            atomic_json(
                safe_child(self.root / "plans", identifier) / "plan.json",
                plan.model_dump(mode="json"),
            )
            return plan

    def delete(self, identifier: str) -> None:
        # Protection archives remain retained while a plan references them.
        with FileLeaseContext(self.root / "journal.lease"):
            for path in (self.root / "plans").glob("restore_*/plan.json"):
                if read_json(path).get("protection_backup_id") == identifier:
                    raise Conflict("backup protects a restore plan and cannot be deleted")
            path = safe_child(self.root / "exports", identifier)
            if not path.is_dir():
                raise NotFound("backup not found")
            shutil.rmtree(path)


class FileLeaseContext:
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        try:
            self.lease = FileLease(str(self.path))
        except RuntimeError:
            raise Conflict("another workspace backup operation is in progress") from None
        return self.lease

    def __exit__(self, *_):
        self.lease.release()
