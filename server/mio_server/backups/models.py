"""Typed workspace archive and staged restore contracts."""

from typing import Literal

from pydantic import Field

from ..models import StrictModel


class BackupOptions(StrictModel):
    include_credentials: bool = Field(
        default=False,
        description="Include configured API credentials and tokens. Treat this archive as a secret.",
    )


class BackupEntry(StrictModel):
    path: str
    size: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class BackupManifest(StrictModel):
    format: Literal["mio.workspace"] = "mio.workspace"
    version: Literal[1] = 1
    schema_version: int
    created_at: str
    source_head: str = Field(pattern=r"^[0-9a-f]{64}$")
    includes_credentials: bool
    exclusions: list[str]
    entries: list[BackupEntry]


class BackupInspection(StrictModel):
    sha256: str
    size: int
    manifest: BackupManifest
    series_count: int
    episode_count: int
    asset_count: int
    checkpoint_count: int
    job_count: int
    warnings: list[str]


class BackupCreated(StrictModel):
    id: str
    inspection: BackupInspection


class BackupHead(StrictModel):
    head: str | None
    active_job_ids: list[str]


class RestorePlan(StrictModel):
    id: str
    created_at: str
    inspection: BackupInspection
    expected_head: str
    state: Literal["staged", "pending", "installed", "rejected", "rolled_back"] = "staged"
    protection_backup_id: str | None = None
    message: str = ""


class RestoreApply(StrictModel):
    expected_head: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_archive_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class RestoreScheduled(StrictModel):
    plan: RestorePlan
    requires_restart: Literal[True] = True


class RestoreJournal(StrictModel):
    plan_id: str
    expected_head: str
    archive_sha256: str
    phase: Literal["pending", "prepared", "old_moved", "installed", "rolling_back"] = "pending"
