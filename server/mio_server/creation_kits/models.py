"""Portable template data, explicit destination bindings and review results."""

from typing import Literal

from pydantic import Field

from ..models import Episode, GenerationOptions, Series, StrictModel
from ..render_models import RenderProfile, WorkflowDoc


class KitSelection(StrictModel):
    series_id: str
    episode_ids: list[str] = Field(min_length=1)
    preset_ids: list[str] = Field(default_factory=list)
    title: str = Field(default="", max_length=120)


class ExternalRequirement(StrictModel):
    profile_id: str
    local: bool
    cloud: bool


class KitPayload(StrictModel):
    format: Literal["mio.creation-kit"] = "mio.creation-kit"
    version: Literal[1] = 1
    title: str
    series: Series
    episodes: list[Episode] = Field(min_length=1)
    profiles: list[RenderProfile]
    workflows: list[WorkflowDoc]
    external: list[ExternalRequirement]
    assets: list[str]


class ProfileDestination(StrictModel):
    unbound: bool = Field(
        default=False,
        description="Import for editing without selecting a service; rendering stays blocked until configured.",
    )
    instances: list[str] | None = None
    cloud_channel: str | None = None


class KitImport(StrictModel):
    archive_base64: str = Field(min_length=1, max_length=89478488)
    profiles: dict[str, ProfileDestination] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=1, max_length=200)


class KitInspection(StrictModel):
    title: str
    sha256: str
    episodes: list["KitEpisodeSummary"]
    presets: list["KitPresetSummary"]
    profiles: list["KitDocumentSummary"]
    workflows: list["KitDocumentSummary"]
    asset_count: int
    external: list[ExternalRequirement]
    warnings: list[str] = Field(default_factory=list)


class KitEpisodeSummary(StrictModel):
    id: str
    title: str
    panels: int


class KitPresetSummary(StrictModel):
    id: str
    title: str


class KitDocumentSummary(StrictModel):
    id: str
    name: str


KitInspection.model_rebuild()


class KitImported(StrictModel):
    series_id: str
    episode_ids: list[str]
    preset_ids: list[str]
    id_map: dict[str, dict[str, str]]
    unbound_profile_ids: list[str] = Field(default_factory=list)


class KitAssembly(StrictModel):
    episode_id: str
    preset_ids: list[str] = Field(default_factory=list)
    title: str = Field(default="", max_length=120)
    profile_id: str | None = None
    generation: GenerationOptions | None = None
    variables: dict[str, str] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=1, max_length=200)
