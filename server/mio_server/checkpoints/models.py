"""Typed, local-only work checkpoints. Images and global settings remain external."""

from typing import Literal

from pydantic import Field, field_validator

from ..models import Episode, Series, StrictModel


class WorkSnapshot(StrictModel):
    series: Series
    episodes: list[Episode]


class CheckpointCreate(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    expected_head: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @field_validator("name")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("checkpoint name must not be blank")
        return value.strip()


class CheckpointSummary(StrictModel):
    id: str
    series_id: str
    name: str
    created_at: str
    kind: Literal["manual", "pre_restore"]
    head: str
    episode_count: int
    deleted_episode_count: int
    asset_count: int


class Checkpoint(CheckpointSummary):
    snapshot: WorkSnapshot
    asset_ids: list[str]


class CheckpointPreview(StrictModel):
    checkpoint_id: str
    series_id: str
    current_head: str
    target_head: str
    series_changed: bool
    added_episode_ids: list[str]
    changed_episode_ids: list[str]
    removed_episode_ids: list[str]
    missing_asset_ids: list[str]
    reference_errors: list[str]
    active_job_ids: list[str]
    can_restore: bool


class CheckpointRestore(StrictModel):
    expected_head: str = Field(pattern=r"^[0-9a-f]{64}$")


class CheckpointRestored(StrictModel):
    checkpoint_id: str
    series_id: str
    head: str
    pre_restore_checkpoint: CheckpointSummary
    restored_episode_ids: list[str]
    trashed_episode_ids: list[str]


class WorkHead(StrictModel):
    series_id: str
    head: str
