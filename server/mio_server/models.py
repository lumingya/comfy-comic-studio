"""Domain model v3 for strip-comic production.

The UI names, API names and persisted JSON names intentionally match the ROADMAP vocabulary:
Series → Bible → Episode → Panel → Take → Strip.  The models are deliberately strict so that old
"templates / rows / books / steps" terminology cannot silently leak into the new stack.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SHOTS = ("extreme_close", "close", "medium", "cowboy", "full", "wide")
ANGLES = ("eye", "high", "low", "side", "back", "dutch")
TIMES = ("", "morning", "day", "evening", "night")
REFERENCE_ROLES = ("front", "side", "back", "expression", "outfit", "reference", "style", "sheet")

# "" = unspecified: the prompt gets no framing tags and the author's own words decide.
Shot = Literal["", "extreme_close", "close", "medium", "cowboy", "full", "wide"]
Angle = Literal["", "eye", "high", "low", "side", "back", "dutch"]
TimeOfDay = Literal["", "morning", "day", "evening", "night"]
ReferenceRole = Literal[
    "front", "side", "back", "expression", "outfit", "reference", "style", "sheet"
]
Position = Literal["left", "center", "right", "foreground", "background", "unspecified"]
ControlKind = Literal["pose", "depth", "canny", "lineart"]
Box = tuple[float, float, float, float]
COLOR_RE = re.compile(r"^\s*#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\s*$")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        validate_assignment=True,
        # Response schemas mark defaulted fields as required, so generated TS types are exact.
        json_schema_serialization_defaults_required=True,
    )


def _required(value: str, label: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError(f"{label} is required")
    return value


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
    caption = "caption"


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
    role: ReferenceRole = "reference"
    label: str = ""
    outfit: str | None = None
    expression: str | None = None


class LoraRef(StrictModel):
    name: str
    strength_model: float = 1.0
    strength_clip: float = 1.0
    model_family: str = "sdxl"


# --------------------------------------------------------------------------- bible
class Character(StrictModel):
    id: str = Field(default_factory=lambda: new_id("char"))
    name: str
    gender: Gender = Gender.unknown
    age: int = Field(ge=18, description="Mio only generates adult characters.")
    appearance: list[str] = Field(default_factory=list, description="Checklist used by VLM QA.")
    description: str = ""
    tag_description: list[str] = Field(default_factory=list)
    signature: list[str] = Field(
        default_factory=list, description="Must-not-drop identity features."
    )
    references: list[AssetRef] = Field(default_factory=list)
    outfits: dict[str, list[str]] = Field(default_factory=dict)
    loras: list[LoraRef] = Field(default_factory=list)
    trigger: str = ""

    @field_validator("name")
    @classmethod
    def name_required(cls, value: str) -> str:
        return _required(value, "character name")


class Location(StrictModel):
    id: str = Field(default_factory=lambda: new_id("loc"))
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    time: TimeOfDay = ""
    references: list[AssetRef] = Field(default_factory=list)


class Prop(StrictModel):
    id: str = Field(default_factory=lambda: new_id("prop"))
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    references: list[AssetRef] = Field(default_factory=list)


class Style(StrictModel):
    id: str = Field(default_factory=lambda: new_id("style"))
    name: str = "默认画风"
    description: str = ""
    tag_description: list[str] = Field(default_factory=list)
    negative: list[str] = Field(default_factory=list)
    references: list[AssetRef] = Field(default_factory=list)
    loras: list[LoraRef] = Field(default_factory=list)


class Bible(StrictModel):
    characters: list[Character] = Field(default_factory=list)
    locations: list[Location] = Field(default_factory=list)
    props: list[Prop] = Field(default_factory=list)
    styles: list[Style] = Field(default_factory=list)

    @model_validator(mode="after")
    def ids_unique(self):
        for label, items in (
            ("characters", self.characters),
            ("locations", self.locations),
            ("props", self.props),
            ("styles", self.styles),
        ):
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate ids in {label}")
        return self

    def character(self, character_id: str) -> Character | None:
        return next((c for c in self.characters if c.id == character_id), None)

    def location(self, location_id: str | None) -> Location | None:
        return next((x for x in self.locations if x.id == location_id), None)

    def style(self, style_id: str | None) -> Style | None:
        if style_id:
            return next((x for x in self.styles if x.id == style_id), None)
        return self.styles[0] if self.styles else None


class VariantSet(StrictModel):
    """Batch variant (the old "character matrix"): the same script rendered with another bible set.

    ``characters`` maps a character id to a partial Character patch (appearance, tags, loras…).
    """

    id: str = Field(default_factory=lambda: new_id("var"))
    name: str
    characters: dict[str, dict] = Field(default_factory=dict)
    style_id: str | None = None
    profile_id: str | None = None


# ------------------------------------------------------------------------- episode
class PanelCharacter(StrictModel):
    character_id: str
    outfit: str = "default"
    expression: str = "neutral"
    action: str = ""
    tags: list[str] = Field(default_factory=list)
    position: Position = "unspecified"


class Dialogue(StrictModel):
    speaker_id: str | None = None
    text: str
    kind: DialogueKind = DialogueKind.speech
    bridge: bool = Field(
        default=False, description="Cross-panel bubble: straddles the gutter to the next panel."
    )

    @field_validator("text")
    @classmethod
    def text_required(cls, value: str) -> str:
        return _required(value, "dialogue text")


class PanelOverrides(StrictModel):
    raw_prompt: str | None = Field(
        default=None, description="Raw mode: skip the compiler entirely."
    )
    raw_negative: str | None = None
    append_prompt: str = ""
    negative_prompt: str = ""
    seed: int | None = None
    width: int | None = Field(default=None, ge=64, le=4096)
    height: int | None = Field(default=None, ge=64, le=4096)
    values: dict[str, object] = Field(default_factory=dict, description="Extra [mio:*] values.")
    node_overrides: dict[str, object] = Field(
        default_factory=dict, description="JSON Pointer → value."
    )
    profile_id: str | None = None


class ControlInput(StrictModel):
    """One ControlNet input, bound to ``[mio:control:<kind>]`` (+ ``[mio:strength:<kind>]``)."""

    kind: ControlKind = "pose"
    source: Literal["auto", "asset", "take"] = Field(
        default="auto",
        description="auto = skeleton drawn from character positions (pose only); "
        "asset = uploaded image; take = an existing take of this panel.",
    )
    asset_id: str | None = None
    take_id: str | None = None
    strength: float = Field(default=0.8, ge=0, le=2)


MotionMove = Literal[
    "auto", "still", "push_in", "pull_out", "pan_left", "pan_right", "pan_up", "pan_down", "shake"
]


class PanelMotion(StrictModel):
    """Dynamic-comic camera for this panel (``auto`` = chosen from shot size, SFX and text)."""

    move: MotionMove = "auto"
    hold: float | None = Field(
        default=None, ge=0.5, le=30, description="Seconds on screen; None = from reading time"
    )


class Panel(StrictModel):
    id: str = Field(default_factory=lambda: new_id("panel"))
    order: int = Field(ge=0)
    shot: Shot = ""
    angle: Angle = ""
    characters: list[PanelCharacter] = Field(default_factory=list)
    location_id: str | None = None
    props: list[str] = Field(default_factory=list)
    time: TimeOfDay = ""
    lighting: str = ""
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    dialogues: list[Dialogue] = Field(default_factory=list)
    width_mode: PanelWidth = PanelWidth.full
    inset_align: Literal["left", "center", "right"] = "center"
    inset_scale: float = Field(default=0.78, ge=0.4, le=0.95, description="Inset width / strip.")
    aspect_ratio: str = "2:3"
    gap_after: int = Field(default=48, ge=0, le=1200)
    transition_background: str = "transparent"
    reference_mode: Literal["auto", "manual", "off"] = "auto"
    references: list[AssetRef] = Field(default_factory=list, description="Manual references.")
    controls: list[ControlInput] = Field(default_factory=list)
    regional: bool = Field(
        default=False, description="Per-character regional prompts ([mio:region:N] slots)."
    )
    locked: bool = Field(
        default=False, description="Automation (assistant, auto-pick) may not touch it."
    )
    overrides: PanelOverrides = Field(default_factory=PanelOverrides)
    motion: PanelMotion | None = Field(default=None, description="Dynamic comic; None = auto")

    @field_validator("aspect_ratio")
    @classmethod
    def ratio_valid(cls, value: str) -> str:
        parse_ratio(value)
        return value

    @field_validator("transition_background")
    @classmethod
    def background_valid(cls, value: str) -> str:
        value = value.strip() or "transparent"
        if value != "transparent" and not all(COLOR_RE.match(c) for c in value.split(">")):
            raise ValueError(f"过渡背景须为 transparent、#rrggbb 或 #a>#b>#c：{value!r}")
        return value


def parse_ratio(value: str) -> float:
    try:
        w, h = (float(x) for x in value.split(":"))
    except ValueError as exc:
        raise ValueError(f"aspect ratio must look like 2:3, got {value!r}") from exc
    if w <= 0 or h <= 0 or not (0.1 <= w / h <= 10):
        raise ValueError(f"aspect ratio out of range: {value!r}")
    return w / h


class IdentityCheck(StrictModel):
    character_id: str
    score: int = Field(ge=0, le=5)
    missing: list[str] = Field(default_factory=list)


class QAResult(StrictModel):
    passed: bool
    score: float = Field(ge=0, le=1)
    identity: list[IdentityCheck] = Field(default_factory=list)
    shot_ok: bool | None = None
    characters_ok: bool | None = None
    action_ok: bool | None = None
    issues: list[str] = Field(default_factory=list)
    votes: int = 1
    model: str = ""
    checked_at: str = Field(default_factory=now_iso)


class TakeEdit(StrictModel):
    kind: Literal["inpaint", "edit", "outpaint", "refine", "upscale", "final"]
    from_take_id: str
    params: dict[str, object] = Field(default_factory=dict)
    created_at: str = Field(default_factory=now_iso)


class Face(StrictModel):
    box: Box
    character_id: str | None = None


class Take(StrictModel):
    id: str = Field(default_factory=lambda: new_id("take"))
    panel_id: str
    asset_id: str
    status: TakeStatus = TakeStatus.candidate
    score: float | None = Field(default=None, ge=0, le=1)
    stage: str = "draft"
    variant_id: str | None = None
    job_id: str | None = None
    parent_take_id: str | None = None
    width: int | None = None
    height: int | None = None
    seed: int | None = None
    parameter_snapshot: dict[str, object] = Field(default_factory=dict)
    qa: QAResult | None = None
    faces: list[Face] = Field(default_factory=list)
    edits: list[TakeEdit] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)


class LetterStyle(StrictModel):
    """Free styling for SFX (拟声字) and any other layer."""

    fill: str = "#111111"
    stroke: str = "#ffffff"
    stroke_width: int = Field(default=4, ge=0, le=40)
    rotation: float = Field(default=0, ge=-180, le=180)
    effect: Literal["none", "grow", "shake", "arc"] = "none"
    letter_spacing: int = Field(default=0, ge=-40, le=200)
    preset: str = ""


class LetteringLayer(StrictModel):
    id: str = Field(default_factory=lambda: new_id("letter"))
    panel_id: str | None = None
    kind: DialogueKind = DialogueKind.speech
    text: str
    speaker_id: str | None = None
    box: Box
    tail_to: tuple[float, float] | None = None
    vertical: bool = False
    font_size: int | None = None
    locked: bool = False
    bridge_to: str | None = Field(
        default=None, description="Next panel id of a cross-panel bubble."
    )
    style: LetterStyle | None = None


class Strip(StrictModel):
    width: int = Field(default=800, ge=320, le=2400)
    background: str = "#ffffff"
    margin: int = Field(default=24, ge=0, le=400)
    text_direction: Literal["horizontal", "vertical"] = "horizontal"
    panel_boxes: dict[str, Box] = Field(default_factory=dict)
    crops: dict[str, Box] = Field(default_factory=dict, description="Normalized crop per panel.")
    lettering: list[LetteringLayer] = Field(default_factory=list)
    height: int = 0
    manual: bool = Field(
        default=False, description="Boxes were dragged by hand; relayout keeps them."
    )


class Episode(StrictModel):
    id: str = Field(default_factory=lambda: new_id("episode"))
    series_id: str
    title: str
    order: int = Field(ge=0)
    synopsis: str = ""
    panels: list[Panel] = Field(default_factory=list)
    takes: list[Take] = Field(default_factory=list)
    strip: Strip = Field(default_factory=Strip)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    deleted_at: str | None = None
    revision: int = 0

    @model_validator(mode="after")
    def panel_orders_unique(self):
        orders = [panel.order for panel in self.panels]
        if len(orders) != len(set(orders)):
            raise ValueError("duplicate panel order")
        ids = [panel.id for panel in self.panels]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate panel id")
        return self

    def panel(self, panel_id: str) -> Panel | None:
        return next((p for p in self.panels if p.id == panel_id), None)

    def ordered_panels(self) -> list[Panel]:
        return sorted(self.panels, key=lambda p: p.order)

    def take(self, take_id: str) -> Take | None:
        return next((t for t in self.takes if t.id == take_id), None)

    def adopted(self, panel_id: str, variant_id: str | None = None) -> Take | None:
        return next(
            (
                t
                for t in self.takes
                if t.panel_id == panel_id
                and t.status == TakeStatus.adopted
                and t.variant_id == variant_id
            ),
            None,
        )


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
    variants: list[VariantSet] = Field(default_factory=list)
    variables: dict[str, str] = Field(
        default_factory=dict, description="{变量} values (advanced layer)."
    )
    default_profile_id: str | None = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    deleted_at: str | None = None

    @field_validator("title")
    @classmethod
    def title_required(cls, value: str) -> str:
        return _required(value, "series title")


class SeriesCard(Series):
    """A series as listed on the works page: plus its episode count and a cover image."""

    episode_count: int = 0
    cover_asset_id: str | None = None


class SeriesCreate(StrictModel):
    title: str
    subtitle: str = ""


class SeriesPatch(StrictModel):
    title: str | None = None
    subtitle: str | None = None
    status: SeriesStatus | None = None
    bible: Bible | None = None
    variants: list[VariantSet] | None = None
    variables: dict[str, str] | None = None
    default_profile_id: str | None = None


class EpisodeCreate(StrictModel):
    title: str
    order: int | None = Field(default=None, ge=0)
    synopsis: str = ""


class EpisodePatch(StrictModel):
    title: str | None = None
    order: int | None = Field(default=None, ge=0)
    synopsis: str | None = None
    strip: Strip | None = None
    revision: int | None = Field(default=None, description="Optimistic concurrency check.")
