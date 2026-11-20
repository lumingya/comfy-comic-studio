"""Render-side documents: imported ComfyUI workflows, render profiles, instances and assets."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, JsonValue, field_validator, model_validator

from .cloud_options import validate_options
from .models import StrictModel, new_id, now_iso

StageKind = Literal["generate", "refine", "upscale", "face", "inpaint", "outpaint", "edit"]


class OutputAdapterConfig(StrictModel):
    id: str = Field(min_length=1)
    options: dict[str, object] = Field(default_factory=dict)


class WorkflowConfig(StrictModel):
    """Run configuration next to an API-format workflow (same keys as the spike runner)."""

    mapping: dict[str, str | list[str]] = Field(
        default_factory=dict, description="kind → JSON Pointer (or several: one-to-many)"
    )
    values: dict[str, object] = Field(default_factory=dict)
    overrides: dict[str, object] = Field(default_factory=dict)
    slot_overrides: dict[str, object] = Field(default_factory=dict)
    guard: list[str] = Field(default_factory=list)
    variants: dict[str, dict] = Field(default_factory=dict)
    frontend: dict[str, dict] = Field(default_factory=dict)
    state: dict[str, list | dict] = Field(
        default_factory=dict, description="Frontend-only node snapshot."
    )
    state_adapters: dict[str, str] = Field(default_factory=dict)
    output_adapters: dict[str, OutputAdapterConfig] = Field(default_factory=dict)


class WorkflowDoc(StrictModel):
    id: str = Field(default_factory=lambda: new_id("wf"))
    name: str
    graph: dict[str, dict]
    config: WorkflowConfig = Field(default_factory=WorkflowConfig)
    slots: dict | None = Field(default=None, description="workflow_slots analysis plan")
    source: Literal["import", "builtin", "legacy"] = "import"
    notes: str = ""
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    deleted_at: str | None = None

    @field_validator("graph")
    @classmethod
    def api_format(cls, graph: dict) -> dict:
        if not graph:
            raise ValueError("workflow graph is empty")
        for node_id, node in graph.items():
            if (
                not isinstance(node, dict)
                or not isinstance(node.get("class_type"), str)
                or not node["class_type"].strip()
                or not isinstance(node.get("inputs"), dict)
            ):
                raise ValueError(
                    f"node {node_id} is not in ComfyUI API format (class_type + inputs)"
                )
        return graph


class StageOutput(StrictModel):
    node_id: str = Field(min_length=1)
    index: int = Field(default=0, ge=0)


class RenderStage(StrictModel):
    id: str = Field(default_factory=lambda: new_id("stage"))
    kind: StageKind = "generate"
    workflow_id: str
    variant: str | None = Field(default=None, description="[mio:output:<variant>] to keep")
    values: dict[str, object] = Field(default_factory=dict)
    overrides: dict[str, object] = Field(default_factory=dict)
    slot_overrides: dict[str, object] = Field(default_factory=dict)
    enabled: bool = True
    feed: Literal["none", "previous"] = Field(
        default="previous", description="previous: the prior stage's image becomes [mio:init]"
    )
    feed_output: StageOutput | None = Field(
        default=None,
        description="Select a previous stage's output node and zero-based image index.",
    )


class CloudRecipe(StrictModel):
    """Portable ordinary request parameters; service bindings and secrets stay local."""

    kind: str = Field(min_length=1, max_length=100)
    model: str = Field(default="", max_length=300)
    options: dict[str, JsonValue] = Field(default_factory=dict, max_length=64)

    @field_validator("options", mode="before")
    @classmethod
    def bounded_options(cls, value):
        return validate_options(value)


class RenderProfile(StrictModel):
    """A pipeline of workflows.  ``draft`` runs per candidate, ``final`` only on adopted takes."""

    id: str = Field(default_factory=lambda: new_id("profile"))
    name: str
    binding_required: bool = Field(
        default=False,
        description="Imported without destination services. Preview/edit are allowed; generation requires explicit configuration first.",
    )
    dialect: Literal["tags", "natural"] = "tags"
    draft: list[RenderStage] = Field(default_factory=list)
    final: list[RenderStage] = Field(default_factory=list)
    edits: dict[str, RenderStage] = Field(
        default_factory=dict, description="inpaint / outpaint / edit"
    )
    candidates: int = Field(default=3, ge=1, le=16)
    instances: list[str] = Field(default_factory=list, description="Empty = every enabled instance")
    base_width: int = Field(default=832, ge=256, le=4096)
    quality_tags: list[str] | None = None
    negative_tags: list[str] | None = None
    cloud_shape: bool = Field(
        default=False, description="Generate candidates through the selected cloud channel"
    )
    cloud_refine: bool = Field(
        default=False,
        description="Explicit hybrid route: refine cloud results with the local final/draft tail",
    )
    model_group: str | None = Field(
        default=None, description="Scheduler affinity key; default = checkpoint"
    )
    cloud_channel: str = Field(
        default="", description="Image channel for cloud steps; '' = the settings default"
    )
    cloud_recipe: CloudRecipe | None = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)

    @model_validator(mode="after")
    def explicit_hybrid(self):
        if self.cloud_refine and not self.cloud_shape:
            raise ValueError("cloud_refine requires cloud_shape")
        return self


class ComfyInstance(StrictModel):
    id: str = Field(default_factory=lambda: new_id("comfy"))
    name: str = "本机 ComfyUI"
    base_url: str = "http://127.0.0.1:8188"
    enabled: bool = True
    capacity: int = Field(default=1, ge=1, le=8)
    tags: list[str] = Field(default_factory=list)

    @field_validator("base_url")
    @classmethod
    def http_only(cls, value: str) -> str:
        value = value.rstrip("/")
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url must start with http:// or https://")
        return value


class Asset(StrictModel):
    id: str = Field(description="sha256 of the bytes")
    mime: str
    size: int
    width: int | None = None
    height: int | None = None
    source: str = ""
    filename: str = ""
    created_at: str = Field(default_factory=now_iso)
