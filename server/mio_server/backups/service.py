"""Archive, inspect, stage and schedule restoration; application remains running until restart."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from ..jobs.lease import FileLease
from ..models import new_id, now_iso
from ..private_store import regular_path
from ..storage import Conflict, NotFound
from .archive import inspect_archive, pack, verify_workspace
from .database import logical_head
from .models import (
    BackupCreated,
    BackupHead,
    BackupInspection,
    BackupOptions,
    BackupPage,
    BackupRecord,
    RestoreApply,
    RestoreJournal,
    RestorePage,
    RestorePlan,
    RestoreRecord,
    RestoreScheduled,
)
from .participants import require_restore_idle, with_workspace_head
from .paths import atomic_json, read_json, recovery_root, safe_child, sha_file
from .snapshot import capture, current_head, quiescent


class Backups:
    def __init__(self, ctx):
        self.ctx = ctx
        self.root = recovery_root(ctx.data_dir)
        _regular_path(self.root)
        self.root.mkdir(parents=True, exist_ok=True)

    def head(self) -> BackupHead:
        active = self.ctx.engine.active_operation_jobs()
        return BackupHead(head=None if active else current_head(self.ctx), active_job_ids=active)

    def _export_locked(self, options: BackupOptions) -> BackupCreated:
        identifier = new_id("backup")
        target = self._folder("exports", identifier)
        target.mkdir(parents=True)
        try:
            with tempfile.TemporaryDirectory(prefix=".snapshot-", dir=self.root) as temporary:
                workspace = Path(temporary)
                manifest = capture(self.ctx, workspace, options.include_credentials)
                pack(workspace, manifest, target / "workspace.zip")
            inspection = inspect_archive(
                target / "workspace.zip", trusted_workspace=self.ctx.data_dir
            )
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
        path = self._folder("exports", identifier)
        _regular_path(path / "record.json")
        record = BackupCreated.model_validate(read_json(path / "record.json"))
        if record.id != identifier:
            raise Conflict("backup identity does not match its directory")
        return record

    def download(self, identifier: str) -> Path:
        record = self.get(identifier)
        path = self._folder("exports", identifier) / "workspace.zip"
        _regular_path(path)
        if not path.is_file() or sha_file(path) != record.inspection.sha256:
            raise Conflict("stored backup failed checksum verification")
        return path

    @staticmethod
    def inspect(path: Path, trusted_workspace: Path | None = None) -> BackupInspection:
        return inspect_archive(path, trusted_workspace=trusted_workspace)

    def stage(self, archive: Path) -> RestorePlan:
        require_restore_idle(self.ctx)
        identifier = new_id("restore")
        target = self._folder("plans", identifier)
        target.mkdir(parents=True)
        try:
            shutil.copyfile(archive, target / "workspace.zip")
            inspection = inspect_archive(
                target / "workspace.zip", target / "workspace", trusted_workspace=self.ctx.data_dir
            )
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
        path = self._folder("plans", identifier)
        _regular_path(path / "plan.json")
        plan = RestorePlan.model_validate(read_json(path / "plan.json"))
        if plan.id != identifier:
            raise Conflict("restore plan identity does not match its directory")
        return plan

    def apply(self, identifier: str, command: RestoreApply) -> RestoreScheduled:
        with FileLeaseContext(self.root / "journal.lease"), quiescent(self.ctx):
            require_restore_idle(self.ctx)
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
            head = with_workspace_head(
                logical_head(self.ctx.store._conn, self.ctx.engine.db), self.ctx.data_dir
            )
            if head != command.expected_head or plan.expected_head != command.expected_head:
                raise Conflict("workspace changed since staging; stage the archive again")
            folder = self._folder("plans", identifier)
            if (
                command.expected_archive_sha256 != plan.inspection.sha256
                or sha_file(folder / "workspace.zip") != plan.inspection.sha256
            ):
                raise Conflict("staged archive changed; inspect and stage it again")
            verify_workspace(
                folder / "workspace", plan.inspection.manifest, trusted_workspace=self.ctx.data_dir
            )
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
            elif plan.state not in {"staged", "pending"}:
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
            for plan in self._plans():
                if plan.protection_backup_id == identifier:
                    raise Conflict("backup protects a restore plan and cannot be deleted")
            self.get(identifier)
            path = self._folder("exports", identifier)
            _remove_record(path, "record.json")

    def _folder(self, kind: str, identifier: str) -> Path:
        prefix = "backup_" if kind == "exports" else "restore_"
        if not identifier.startswith(prefix):
            raise NotFound("backup or restore plan not found")
        _regular_path(self.root)
        _regular_path(self.root / kind)
        path = safe_child(self.root / kind, identifier)
        _regular_path(path)
        if not path.resolve().is_relative_to(self.root.resolve()):
            raise ValueError("recovery path escapes the original recovery directory")
        return path

    def _folders(self, kind: str):
        root = self.root / kind
        _regular_path(root)
        if not root.exists():
            return
        prefix = "backup_" if kind == "exports" else "restore_"
        for child in root.iterdir():
            if child.name.startswith(prefix):
                yield self._folder(kind, child.name)

    def _plans(self) -> list[RestorePlan]:
        plans = []
        for path in self._folders("plans"):
            _regular_path(path / "plan.json")
            if (path / "plan.json").exists():
                plans.append(self.get_plan(path.name))
        return plans

    def _protected_plans(self) -> dict[str, str]:
        protected = {}
        for name, reason in (("pending.json", "installation"), ("restored.json", "startup")):
            path = self.root / name
            _regular_path(path)
            if path.exists():
                value = read_json(path)
                identifier = value["plan_id"]
                self._folder("plans", identifier)
                protected[identifier] = reason
        return protected

    def list_backups(self, *, offset: int = 0, limit: int = 20) -> BackupPage:
        _pagination(offset, limit)
        with FileLeaseContext(self.root / "journal.lease"):
            plans = self._plans()
            records = []
            for path in self._folders("exports"):
                _regular_path(path / "record.json")
                if (path / "record.json").exists():
                    records.append(self.get(path.name))
            records.sort(
                key=lambda item: (item.inspection.manifest.created_at, item.id), reverse=True
            )
            items = []
            for record in records[offset : offset + limit]:
                references = sorted(p.id for p in plans if p.protection_backup_id == record.id)
                items.append(
                    BackupRecord(
                        id=record.id,
                        created_at=record.inspection.manifest.created_at,
                        size=record.inspection.size,
                        retained_bytes=_tree_bytes(self._folder("exports", record.id)),
                        includes_credentials=record.inspection.manifest.includes_credentials,
                        protection_plan_ids=references,
                        can_delete=not references,
                    )
                )
            return BackupPage(items=items, **_page_meta(len(records), offset, limit))

    def list_plans(self, *, offset: int = 0, limit: int = 20) -> RestorePage:
        _pagination(offset, limit)
        with FileLeaseContext(self.root / "journal.lease"):
            protected = self._protected_plans()
            plans = sorted(self._plans(), key=lambda item: (item.created_at, item.id), reverse=True)
            items = []
            for plan in plans[offset : offset + limit]:
                folder = self._folder("plans", plan.id)
                reason = protected.get(plan.id) or ("pending" if plan.state == "pending" else None)
                items.append(
                    RestoreRecord(
                        id=plan.id,
                        created_at=plan.created_at,
                        state=plan.state,
                        protection_backup_id=plan.protection_backup_id,
                        retained_bytes=_tree_bytes(folder),
                        staged_bytes=_tree_bytes(folder / "workspace")
                        + _tree_bytes(folder / "workspace.zip"),
                        previous_bytes=_tree_bytes(folder / "previous"),
                        pending=plan.state == "pending" or plan.id in protected,
                        can_delete=reason is None,
                        blocked_reason=reason,
                    )
                )
            return RestorePage(items=items, **_page_meta(len(plans), offset, limit))

    def delete_plan(self, identifier: str) -> None:
        with FileLeaseContext(self.root / "journal.lease"):
            plan = self.get_plan(identifier)
            if plan.state == "pending" or identifier in self._protected_plans():
                raise Conflict(
                    "restore plan is scheduled or still needed by startup; cancel it first"
                )
            path = self._folder("plans", identifier)
            # Preflight every descendant, including previous/incoming/failed directories. Reject
            # symlinks and Windows junctions before deleting anything, even on older Python.
            _remove_record(path, "plan.json")


def _regular_path(path: Path):
    # Check before resolving: an 8.3 alias is safe, but any redirected ancestor is not.
    regular_path(path)


def _tree_bytes(path: Path) -> int:
    _regular_path(path)
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    total, pending = 0, [path]
    while pending:
        for child in pending.pop().iterdir():
            _regular_path(child)
            if child.is_dir():
                pending.append(child)
            else:
                total += child.stat().st_size
    return total


def _remove_record(path: Path, metadata: str):
    _tree_bytes(path)
    # Keep the catalog record until payload cleanup succeeds. Interrupted/denied cleanup stays
    # discoverable and can be retried instead of leaving an invisible retained workspace.
    for child in path.iterdir():
        if child.name == metadata:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    (path / metadata).unlink()
    path.rmdir()


def _pagination(offset: int, limit: int):
    if offset < 0 or not 1 <= limit <= 100:
        raise ValueError("offset must be non-negative and limit must be between 1 and 100")


def _page_meta(total: int, offset: int, limit: int) -> dict:
    return dict(
        total=total,
        offset=offset,
        limit=limit,
        next_offset=offset + limit if offset + limit < total else None,
    )


class FileLeaseContext:
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        _regular_path(self.path.parent)
        _regular_path(self.path)
        try:
            self.lease = FileLease(str(self.path))
        except RuntimeError:
            raise Conflict("another workspace backup operation is in progress") from None
        return self.lease

    def __exit__(self, *_):
        self.lease.release()
