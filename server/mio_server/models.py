"""Domain model v3 for strip-comic production.

The UI names, API names and persisted JSON names intentionally match the ROADMAP vocabulary:
Series → Bible → Episode → Panel → Take → Strip.  The models are deliberately strict so that old
"templates / rows / books / steps" terminology cannot silently leak into the new stack.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Gender(str, Enum):
    female = "female"
    male = "male"
    nonbinary = "nonbinary"
    unknown = "unknown"


class DialogueKind(str, Enum):
    speech = "speech"
    thought = "thought"
    narration = "narration"
    sfx = "sfx"


class PanelWidth(str, Enum):
    full = "full"
    inset = "inset"
    bleed = "bleed"
    frameless = "frameless"


class TakeStatus(str, Enum):
    candidate = "candidate"
    adopted = "adopted"
    rejected = "rejected"


class AssetRef(StrictModel):
    asset_id: str
    role: str = "reference"
    label: str = ""
    sha256: str | None = None


class LoraRef(StrictModel):
    name: str
    strength_model: float = 1.0
    strength_clip: float = 1.0
    model_family: str = "sdxl"


class Character(StrictModel):
    id: str = Field(default_factory=lambda: new_id("char"))
    name: str
    gender: Gender = Gender.unknown
    age: int = Field(ge=18, description="Mio only generates all-ages adult characters by default.")
    appearance: list[str] = Field(default_factory=list, description="Checklist used by VLM QA.")
    description: str = ""
    tag_description: list[str] = Field(default_factory=list)
    signature: list[str] = Field(default_factory=list, description="Must-not-drop identity features.")
    references: list[AssetRef] = Field(default_factory=list)
    outfits: dict[str, list[str]] = Field(default_factory=dict)
    loras: list[LoraRef] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def name_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("character name is required")
        return value


class Location(StrictModel):
    id: str = Field(default_factory=lambda: new_id("loc"))
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    references: list[AssetRef] = Field(default_factory=list)


class Prop(StrictModel):
    id: str = Field(default_factory=lambda: new_id("prop"))
    name: str
    description: str = ""
    references: list[AssetRef] = Field(default_factory=list)


class Style(StrictModel):
    id: str = Field(default_factory=lambda: new_id("style"))
    name: str = "默认画风"
    description: str = ""
    tag_description: list[str] = Field(default_factory=list)
    references: list[AssetRef] = Field(default_factory=list)
    loras: list[LoraRef] = Field(default_factory=list)


class Bible(StrictModel):
    characters: list[Character] = Field(default_factory=list)
    locations: list[Location] = Field(default_factory=list)
    props: list[Prop] = Field(default_factory=list)
    styles: list[Style] = Field(default_factory=list)

    @model_validator(mode="after")
    def ids_unique(self):
        for label, items in (("characters", self.characters), ("locations", self.locations),
                             ("props", self.props), ("styles", self.styles)):
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate ids in {label}")
        return self


class PanelCharacter(StrictModel):
    character_id: str
    outfit: str = "default"
    expression: str = "neutral"
    action: str = ""
    position: Literal["left", "center", "right", "foreground", "background", "unspecified"] = "unspecified"


class Dialogue(StrictModel):
    speaker_id: str | None = None
    text: str
    kind: DialogueKind = DialogueKind.speech

    @field_validator("text")
    @classmethod
    def text_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("dialogue text is required")
        return value


class PanelOverrides(StrictModel):
    raw_prompt: str | None = None
    append_prompt: str = ""
    negative_prompt: str = ""
    seed: int | None = None
    node_overrides: dict[str, object] = Field(default_factory=dict)


class Panel(StrictModel):
    id: str = Field(default_factory=lambda: new_id("panel"))
    order: int = Field(ge=0)
    shot: str = "medium"
    angle: str = "eye_level"
    characters: list[PanelCharacter] = Field(default_factory=list)
    location_id: str | None = None
    time: str = ""
    lighting: str = ""
    description: str = ""
    dialogues: list[Dialogue] = Field(default_factory=list)
    width_mode: PanelWidth = PanelWidth.full
    aspect_ratio: str = "2:3"
    gap_after: int = Field(default=48, ge=0, le=600)
    transition_background: str = "transparent"
    overrides: PanelOverrides = Field(default_factory=PanelOverrides)


class Take(StrictModel):
    id: str = Field(default_factory=lambda: new_id("take"))
    panel_id: str
    asset_id: str
    status: TakeStatus = TakeStatus.candidate
    score: float | None = Field(default=None, ge=0, le=1)
    parameter_snapshot: dict[str, object] = Field(default_factory=dict)
    created_at: str = Field(default_factory=now_iso)


class LetteringLayer(StrictModel):
    id: str = Field(default_factory=lambda: new_id("letter"))
    panel_id: str | None = None
    kind: DialogueKind = DialogueKind.speech
    text: str
    speaker_id: str | None = None
    box: tuple[float, float, float, float]
    tail_to: tuple[float, float] | None = None
    vertical: bool = False


class Strip(StrictModel):
    width: int = Field(default=800, ge=320, le=2400)
    background: str = "#ffffff"
    panel_boxes: dict[str, tuple[float, float, float, float]] = Field(default_factory=dict)
    lettering: list[LetteringLayer] = Field(default_factory=list)


class Episode(StrictModel):
    id: str = Field(default_factory=lambda: new_id("episode"))
    series_id: str
    title: str
    order: int = Field(ge=0)
    panels: list[Panel] = Field(default_factory=list)
    takes: list[Take] = Field(default_factory=list)
    strip: Strip = Field(default_factory=Strip)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)

    @model_validator(mode="after")
    def panel_orders_unique(self):
        orders = [panel.order for panel in self.panels]
        if len(orders) != len(set(orders)):
            raise ValueError("duplicate panel order")
        ids = [panel.id for panel in self.panels]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate panel id")
        return self


class SeriesStatus(str, Enum):
    draft = "draft"
    active = "active"
    archived = "archived"


class Series(StrictModel):
    id: str = Field(default_factory=lambda: new_id("series"))
    title: str
    subtitle: str = ""
    status: SeriesStatus = SeriesStatus.draft
    bible: Bible = Field(default_factory=Bible)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)

    @field_validator("title")
    @classmethod
    def title_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("series title is required")
        return value


class SeriesCreate(StrictModel):
    title: str
    subtitle: str = ""


class EpisodeCreate(StrictModel):
    title: str
    order: int = Field(ge=0)
