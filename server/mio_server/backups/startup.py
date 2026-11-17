"""Journaled directory installation before any workspace database or service is opened.

Each rename has a durable intent record. A crash is resumed from observable paths; an ordinary
installation error restores the untouched previous directory. The previous directory remains
retained after success. No live database files are replaced.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from ..jobs.lease import FileLease
from .archive import verify_workspace
from .database import logical_head
from .models import RestoreJournal, RestorePlan
from .participants import with_workspace_head
from .paths import atomic_json, read_json, recovery_root, safe_child, sha_file, sync_directory
from .service import FileLeaseContext


@dataclass
class WorkspaceLease:
    lease: FileLease
    restored: bool
    root: Path

    def release(self):
        self.lease.release()

    def acknowledge_startup(self):
        """Call only after context construction succeeds, preserving recovery across boot errors."""
        (self.root / "restored.json").unlink(missing_ok=True)
        sync_directory(self.root)


def prepare_workspace(data_dir: str | Path) -> WorkspaceLease:
    """Keep this lease until context.close(); skip entirely for memory-only test contexts."""
    workspace = Path(data_dir).resolve()
    root = recovery_root(workspace)
    if root.is_symlink():
        raise ValueError("workspace recovery directory must not be a link")
    root.mkdir(parents=True, exist_ok=True)
    lease = FileLease(str(root / "workspace.lease"))
    try:
        with FileLeaseContext(root / "journal.lease"):
            restored = install_pending(workspace)
        return WorkspaceLease(lease, restored or (root / "restored.json").exists(), root)
    except BaseException:
        lease.release()
        raise


def offline_head(workspace: Path) -> str:
    databases = []
    try:
        for name in ("mio.sqlite3", "jobs.sqlite3"):
            # WAL must be visible after an abrupt process exit, so do not use immutable=1.
            db = sqlite3.connect((workspace / name).as_uri() + "?mode=ro", uri=True)
            databases.append(db)
        return with_workspace_head(logical_head(*databases), workspace)
    finally:
        for db in databases:
            db.close()


def move_directory(source: Path, destination: Path):
    """A separate seam for interrupted-rename tests; destination must never be overwritten."""
    if destination.exists() or source.is_symlink():
        raise ValueError("restore directory state changed unexpectedly")
    source.rename(destination)
    sync_directory(source.parent)
    sync_directory(destination.parent)


def durable_copy(source: Path, destination: Path):
    shutil.copytree(source, destination)
    for path in destination.rglob("*"):
        if path.is_file():
            with path.open("r+b") as stream:
                os.fsync(stream.fileno())
    for path in sorted((p for p in destination.rglob("*") if p.is_dir()), reverse=True):
        sync_directory(path)
    sync_directory(destination)
    sync_directory(destination.parent)


def _finish(root: Path, folder: Path, plan: RestorePlan, state: str, message: str):
    plan.state, plan.message = state, message
    atomic_json(folder / "plan.json", plan.model_dump(mode="json"))
    if state == "installed":
        atomic_json(root / "restored.json", {"plan_id": plan.id})
    (root / "pending.json").unlink(missing_ok=True)
    sync_directory(root)


def _rollback(
    workspace: Path, root: Path, folder: Path, journal: RestoreJournal, plan: RestorePlan
):
    journal.phase = "rolling_back"
    atomic_json(root / "pending.json", journal.model_dump(mode="json"))
    previous = folder / "previous"
    if previous.exists():
        if workspace.exists():
            move_directory(workspace, folder / "failed")
        move_directory(previous, workspace)
    elif not workspace.exists():
        raise RuntimeError("restore rollback has no original workspace; startup is stopped")
    _finish(
        root,
        folder,
        plan,
        "rolled_back",
        "Installation failed; the previous workspace was restored.",
    )


def install_pending(workspace: Path) -> bool:
    """Caller holds the stable workspace and journal leases. Never call against an open context."""
    root = recovery_root(workspace)
    pending = root / "pending.json"
    if not pending.exists():
        return False
    journal = RestoreJournal.model_validate(read_json(pending))
    folder = safe_child(root / "plans", journal.plan_id)
    plan = RestorePlan.model_validate(read_json(folder / "plan.json"))
    if plan.id != journal.plan_id or plan.inspection.sha256 != journal.archive_sha256:
        raise ValueError("restore journal does not match its verified plan")
    incoming, previous = folder / "incoming", folder / "previous"
    for path in (folder, workspace, incoming, previous):
        if path.is_symlink():
            raise ValueError("restore directory must not be a symbolic link")
    if journal.phase == "rolling_back":
        _rollback(workspace, root, folder, journal, plan)
        return False
    try:
        if journal.phase == "pending":
            # Also detect processes started with an older version without the stable lease.
            probe = FileLease(str(workspace / "jobs.sqlite3.lease"))
            probe.release()
            if offline_head(workspace) != journal.expected_head:
                _finish(
                    root,
                    folder,
                    plan,
                    "rejected",
                    "Workspace changed after scheduling; stage it again.",
                )
                return False
            if sha_file(folder / "workspace.zip") != journal.archive_sha256:
                raise ValueError("staged archive changed after scheduling")
            verify_workspace(
                folder / "workspace", plan.inspection.manifest, trusted_workspace=workspace
            )
            if incoming.exists():
                # Only our disposable copy is removed. The reviewed archive and original work
                # remain intact; an interruption while copying must be restartable.
                shutil.rmtree(incoming)
            durable_copy(folder / "workspace", incoming)
            verify_workspace(incoming, plan.inspection.manifest, trusted_workspace=workspace)
            journal.phase = "prepared"
            atomic_json(pending, journal.model_dump(mode="json"))
        if journal.phase == "prepared":
            if workspace.exists() and not previous.exists():
                if offline_head(workspace) != journal.expected_head:
                    _finish(
                        root,
                        folder,
                        plan,
                        "rejected",
                        "Workspace changed before installation; stage it again.",
                    )
                    return False
                move_directory(workspace, previous)
            elif workspace.exists() or not previous.exists():
                raise ValueError("unexpected original workspace state during installation")
            journal.phase = "old_moved"
            atomic_json(pending, journal.model_dump(mode="json"))
        if journal.phase == "old_moved":
            if incoming.exists() and not workspace.exists():
                move_directory(incoming, workspace)
            elif incoming.exists() or not workspace.exists():
                raise ValueError("unexpected replacement workspace state during installation")
            verify_workspace(workspace, plan.inspection.manifest, trusted_workspace=workspace)
            journal.phase = "installed"
            atomic_json(pending, journal.model_dump(mode="json"))
        if journal.phase == "installed":
            verify_workspace(workspace, plan.inspection.manifest, trusted_workspace=workspace)
            _finish(
                root,
                folder,
                plan,
                "installed",
                "Restored successfully; previous workspace retained locally.",
            )
            return True
    except Exception:
        if previous.exists() or journal.phase in {"old_moved", "installed", "rolling_back"}:
            _rollback(workspace, root, folder, journal, plan)
        else:
            _finish(
                root,
                folder,
                plan,
                "rejected",
                "Installation validation failed; current workspace was retained.",
            )
        raise
    return False
