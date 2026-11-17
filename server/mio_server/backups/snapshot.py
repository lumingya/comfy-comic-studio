"""Capture both SQLite stores under a quiescent operation, then copy immutable assets."""

import shutil
import sqlite3
from contextlib import ExitStack, contextmanager
from pathlib import Path

from ..jobs.types import JOB_SCHEMA_VERSION
from ..models import now_iso
from ..storage import SCHEMA_VERSION
from .archive import MAX_DATABASE, MAX_UNPACKED, verify_workspace
from .database import logical_head
from .extension_data import copy_settings
from .models import BackupEntry, BackupManifest
from .participants import acquire_locks, copy_data, with_workspace_head
from .paths import sha_file
from .privacy import sanitize


@contextmanager
def quiescent(ctx):
    # Completion callbacks are already excluded. Never acquire the engine after store.lock.
    with ExitStack() as stack:
        stack.enter_context(ctx.engine.operation_guard())
        stack.enter_context(ctx.engine.lock)
        acquire_locks(ctx, stack)
        stack.enter_context(ctx.store.lock)
        if ctx.engine.db.in_transaction or ctx.store._conn.in_transaction:
            raise ValueError("workspace backup cannot run inside a database transaction")
        yield


def current_head(ctx) -> str:
    with quiescent(ctx):
        return with_workspace_head(logical_head(ctx.store._conn, ctx.engine.db), ctx.data_dir)


def capture(ctx, destination: Path, include_credentials: bool) -> BackupManifest:
    """Caller holds quiescent(). SQLite backup is never called on an open write transaction."""
    destination.mkdir(parents=True, exist_ok=True)
    database_head = logical_head(ctx.store._conn, ctx.engine.db)
    databases = []
    try:
        for name, source in (("mio.sqlite3", ctx.store._conn), ("jobs.sqlite3", ctx.engine.db)):
            target = sqlite3.connect(destination / name)
            databases.append(target)
            source.backup(target)
            target.execute("PRAGMA journal_mode = DELETE")
        exclusions = sanitize(*databases, include_credentials)
    finally:
        for db in databases:
            db.close()
    total = sum((destination / name).stat().st_size for name in ("mio.sqlite3", "jobs.sqlite3"))
    total += copy_settings(
        ctx.data_dir,
        destination,
        include_credentials=include_credentials,
        byte_budget=MAX_UNPACKED - total,
    )
    source_head = with_workspace_head(database_head, ctx.data_dir)
    total += copy_data(
        ctx.data_dir,
        destination,
        include_credentials=include_credentials,
        byte_budget=MAX_UNPACKED - total,
    )
    for asset_id in ctx.store.asset_ids():
        asset = ctx.store.get_asset(asset_id)
        source = ctx.assets.path(asset)
        if not source.is_file() or source.is_symlink():
            raise ValueError("workspace contains a missing or linked asset")
        target = destination / "assets" / source.relative_to(ctx.assets.root)
        target.parent.mkdir(parents=True, exist_ok=True)
        total += source.stat().st_size
        if total > MAX_UNPACKED:
            raise ValueError("workspace exceeds the archive size limit")
        shutil.copyfile(source, target)
    entries = []
    for path in sorted(destination.rglob("*")):
        if path.is_file():
            if path.name in {"mio.sqlite3", "jobs.sqlite3"} and path.stat().st_size > MAX_DATABASE:
                raise ValueError("workspace database exceeds 256 MiB")
            entries.append(
                BackupEntry(
                    path=path.relative_to(destination).as_posix(),
                    size=path.stat().st_size,
                    sha256=sha_file(path),
                )
            )
    manifest = BackupManifest(
        jobs_schema_version=JOB_SCHEMA_VERSION,
        schema_version=SCHEMA_VERSION,
        created_at=now_iso(),
        source_head=source_head,
        includes_credentials=include_credentials,
        exclusions=exclusions,
        entries=entries,
    )
    verify_workspace(destination, manifest, trusted_workspace=ctx.data_dir)
    return manifest
