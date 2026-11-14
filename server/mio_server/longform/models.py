"""Explicit, revision-checked commands for organizing one series."""

from typing import Literal

from pydantic import Field, model_validator

from ..models import Episode, Series, StrictModel


class PanelTransfer(StrictModel):
    source_episode_id: str
    target_episode_id: str
    source_revision: int = Field(ge=0)
    target_revision: int = Field(ge=0)
    panel_ids: list[str] = Field(min_length=1, max_length=1000)
    mode: Literal["copy", "move"] = "copy"
    include_locked: bool = False
    break_bridges: bool = Field(
        default=False,
        description="Explicitly disconnect bubbles crossing the selection boundary.",
    )


class TransferResult(StrictModel):
    source: Episode
    target: Episode
    panel_ids: dict[str, str]
    take_ids: dict[str, str]
    lettering_ids: dict[str, str]
    layout_offset_y: float = 0
    notes: list[str] = Field(default_factory=list)


class EpisodeCopy(StrictModel):
    revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1)
    include_locked: bool = False


class EpisodeCopyResult(StrictModel):
    episode: Episode
    panel_ids: dict[str, str]
    take_ids: dict[str, str]
    lettering_ids: dict[str, str]
    notes: list[str] = Field(default_factory=list)


class EpisodeReorder(StrictModel):
    order: list[str] = Field(max_length=10000)
    revisions: dict[str, int]
    include_locked: bool = False


class VariableQuery(StrictModel):
    key: str = Field(pattern=r"^[^\s{}]{1,64}$")


class VariableOperation(VariableQuery):
    action: Literal["rename", "replace"]
    value: str = Field(
        max_length=100000,
        description="New key for rename; literal text for replace (inserted once, not expanded).",
    )
    include_locked: bool = False

    @model_validator(mode="after")
    def valid_rename(self):
        if self.action == "rename":
            VariableQuery(key=self.value)
            if self.value == self.key:
                raise ValueError("new variable key must differ from the old key")
        return self


class VariableApply(VariableOperation):
    expected_head: str = Field(pattern=r"^[a-f0-9]{64}$")


class VariableOccurrence(StrictModel):
    owner_id: str
    path: str
    kind: Literal["text", "definition", "binding"]
    value: str
    count: int = 1
    locked: bool = False


class VariableSearch(StrictModel):
    head: str
    key: str
    occurrences: list[VariableOccurrence]
    fields: list[str]


class VariableChange(StrictModel):
    owner_id: str
    path: str
    kind: Literal["text", "definition", "binding"]
    before: str
    after: str
    locked: bool = False


class VariablePreview(StrictModel):
    head: str
    changes: list[VariableChange]
    conflicts: list[str]
    fields: list[str]


class VariableResult(VariablePreview):
    previous_head: str
    series: Series
    episodes: list[Episode]
