"""Render-side documents: imported ComfyUI workflows, render profiles, instances and assets."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from .models import StrictModel, new_id, now_iso

StageKind = Literal["generate", "refine", "upscale", "face", "inpaint", "outpaint", "edit"]


class WorkflowConfig(StrictModel):
    """Run configuration next to an API-format workflow (same keys as the spike runner)."""

    mapping: dict[str, str | list[str]] = Field(
        default_factory=dict, description="kind → JSON Pointer (or several: one-to-many)"
    )
    values: dict[str, object] = Field(default_factory=dict)
    overrides: dict[str, object] = Field(default_factory=dict)
    guard: list[str] = Field(default_factory=list)
    variants: dict[str, dict] = Field(default_factory=dict)
    frontend: dict[str, dict] = Field(default_factory=dict)
    state: dict[str, list] = Field(default_factory=dict, description="Frontend-only node snapshot.")


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
                or "class_type" not in node
                or not isinstance(node.get("inputs"), dict)
            ):
                raise ValueError(
                    f"node {node_id} is not in ComfyUI API format (class_type + inputs)"
                )
        return graph


class RenderStage(StrictModel):
    id: str = Field(default_factory=lambda: new_id("stage"))
    kind: StageKind = "generate"
    workflow_id: str
    variant: str | None = Field(default=None, description="[mio:output:<variant>] to keep")
    values: dict[str, object] = Field(default_factory=dict)
    overrides: dict[str, object] = Field(default_factory=dict)
    enabled: bool = True
    feed: Literal["none", "previous"] = Field(
        default="previous", description="previous: the prior stage's image becomes [mio:init]"
    )


class RenderProfile(StrictModel):
    """A pipeline of workflows.  ``draft`` runs per candidate, ``final`` only on adopted takes."""

    id: str = Field(default_factory=lambda: new_id("profile"))
    name: str
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
        default=False, description="Hybrid: cloud 'max' shapes, local unifies style"
    )
    model_group: str | None = Field(
        default=None, description="Scheduler affinity key; default = checkpoint"
    )
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


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
