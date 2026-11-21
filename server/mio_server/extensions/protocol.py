"""Authoritative manifest and browser bridge contracts, without runtime services.

Wire shapes and constants are exported through OpenAPI and a generated TypeScript adapter.
Origin, frame identity, authorization and request lifetime still belong to their host boundary.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import Field, FiniteFloat, JsonValue, RootModel, StrictBool, field_validator

from ..models import StrictModel
from ..themes import COLOR_TOKENS
from .manifest import FloatingPosition, Manifest, PanelRequestSpec

CONTRACT_VERSION = 1
PANEL_VERSION = 1
MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_CONCURRENT = 4
MAX_REQUEST_IDS = 256
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024
MAX_MEDIA_BYTES = 64 * 1024 * 1024
MAX_MEDIA_ITEMS = 8
MAX_IMAGE_PIXELS = 16 * 1024 * 1024
THEME_SETTINGS_BYTES = 64 * 1024
THEME_SETTINGS_TIMEOUT_MS = 30000
WORKSPACE_EVENT_TIMEOUT_MS = 250
CREATION_BYTES = 16 * 1024
CREATION_INTERVAL_MS = 100
FiniteNumber = Annotated[FiniteFloat, Field(strict=True)]


class PanelTag(str, Enum):
    ready = "mio:panel:ready"
    init = "mio:panel:init"
    appearance = "mio:panel:appearance"
    request = "mio:panel:request"
    response = "mio:panel:response"
    release = "mio:panel:release"
    media = "mio:panel:media"


class WorkspaceTag(str, Enum):
    ready = "mio:workspace:ready"
    context = "mio:workspace:context"
    changed = "mio:workspace:changed"
    resize = "mio:workspace:resize"
    clickThrough = "mio:workspace:click-through"
    moved = "mio:workspace:moved"
    listen = "mio:workspace:listen"
    event = "mio:workspace:event"
    eventResult = "mio:workspace:event-result"
    navigate = "mio:workspace:navigate"
    lifecycle = "mio:workspace:lifecycle"


class SurfaceLifecycle(str, Enum):
    shown = "shown"
    hidden = "hidden"
    focused = "focused"
    blurred = "blurred"


class EventDecision(str, Enum):
    continue_ = "continue"
    handled = "handled"
    stopPropagation = "stop_propagation"


class ThemeSettingsTag(str, Enum):
    ready = "mio:theme:ready"
    request = "mio:theme:request"
    response = "mio:theme:response"


class ThemeSettingsAction(str, Enum):
    getSettings = "getSettings"
    updateSettings = "updateSettings"


class SessionMessage(StrictModel):
    session: str = Field(min_length=1, max_length=100)


class PanelContext(StrictModel):
    episode_id: str | None = Field(default=None, max_length=160)
    series_id: str | None = Field(default=None, max_length=160)


class PanelAppearance(StrictModel):
    """Current host appearance, kept separate from business/API request context."""

    tokens: dict[str, str] = Field(default_factory=dict, max_length=len(COLOR_TOKENS))
    theme: Literal["dark", "light"] | None = None
    locale: str = Field(default="zh-CN", min_length=2, max_length=32)

    @field_validator("tokens")
    @classmethod
    def known_tokens(cls, value: dict[str, str]) -> dict[str, str]:
        if any(name not in COLOR_TOKENS or len(token) > 256 for name, token in value.items()):
            raise ValueError("panel appearance contains an unknown or oversized color token")
        return value


class CreationSelection(StrictModel):
    kind: Literal["none", "panels"] = "none"
    ids: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(
        default_factory=list, max_length=100
    )
    truncated: StrictBool = False


class CreationRevisions(StrictModel):
    episode: int | None = Field(default=None, ge=0)


class CreationContextV1(StrictModel):
    version: Literal[1] = 1
    seq: int = Field(ge=0)
    context_id: str = Field(min_length=1, max_length=80)
    route: Literal["script", "canvas", "other"] = "other"
    series_id: str | None = Field(default=None, max_length=128)
    episode_id: str | None = Field(default=None, max_length=128)
    selection: CreationSelection = Field(default_factory=CreationSelection)
    revisions: CreationRevisions = Field(default_factory=CreationRevisions)

    @field_validator("version", mode="before")
    @classmethod
    def exact_version(cls, value):
        if type(value) is not int:
            raise ValueError("creation context version requires an integer")
        return value


class CreationSubscribe(SessionMessage):
    version: Literal[1]
    type: Literal["mio:creation:subscribe"]
    event: Literal["creation.context.changed", "selection.changed"]
    enabled: StrictBool


class CreationEvent(SessionMessage):
    version: Literal[1]
    type: Literal["mio:creation:event"]
    activation: str = Field(min_length=1, max_length=100)
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    event: Literal["creation.context.changed", "selection.changed"]
    context: CreationContextV1


class PanelBridgeRequest(StrictModel):
    activation: str = Field(min_length=1, max_length=100)
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    request_id: str = Field(min_length=1, max_length=48)
    path_params: dict[str, str] = Field(default_factory=dict, max_length=20)
    query: dict[str, str | int | float | bool | list[str]] = Field(
        default_factory=dict, max_length=40
    )
    body: JsonValue = None
    context: PanelContext = Field(default_factory=PanelContext)


class PanelBridgeResponse(StrictModel):
    status: int
    data: JsonValue = None


class PanelMessage(SessionMessage):
    version: Literal[PANEL_VERSION]

    @field_validator("version", mode="before")
    @classmethod
    def exact_version_type(cls, value):
        if type(value) is not int:
            raise ValueError("panel version requires an integer")
        return value


class PanelReady(PanelMessage):
    type: Literal[PanelTag.ready]


class PanelRequestMessage(PanelMessage):
    type: Literal[PanelTag.request]
    rid: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    request_id: str = Field(min_length=1, max_length=48)
    path_params: dict[str, str] = Field(default_factory=dict, max_length=20)
    query: dict[str, str | int | float | bool | list[str]] = Field(
        default_factory=dict, max_length=40
    )
    body: JsonValue = None


class PanelLimits(StrictModel):
    requestBytes: int
    responseBytes: int
    concurrent: int
    imageBytes: int
    downloadBytes: int
    mediaBytes: int
    mediaItems: int


class PanelReleaseMessage(PanelMessage):
    type: Literal[PanelTag.release]
    media_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")


class PanelInit(PanelMessage):
    type: Literal[PanelTag.init]
    context: PanelContext
    appearance: PanelAppearance
    requests: list[PanelRequestSpec]
    limits: PanelLimits


class PanelAppearanceMessage(PanelMessage):
    type: Literal[PanelTag.appearance]
    appearance: PanelAppearance


class PanelResponseMessage(PanelMessage):
    type: Literal[PanelTag.response]
    rid: str
    status: int
    data: JsonValue
    ok: StrictBool


class PanelMediaMessage(PanelMessage):
    """Metadata only; a native MessagePort is transferred outside the JSON envelope."""

    type: Literal[PanelTag.media]
    rid: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    media_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    mime: Literal["image/png", "image/jpeg", "image/webp", "image/gif"]
    bytes: int = Field(ge=0, le=MAX_IMAGE_BYTES)


class PanelFromFrame(RootModel[PanelReady | PanelRequestMessage | PanelReleaseMessage]):
    pass


class PanelToFrame(
    RootModel[PanelInit | PanelAppearanceMessage | PanelResponseMessage | PanelMediaMessage]
):
    pass


class WorkspaceReady(SessionMessage):
    type: Literal[WorkspaceTag.ready]


class WorkspaceChanged(SessionMessage):
    type: Literal[WorkspaceTag.changed]


class WorkspaceResize(SessionMessage):
    type: Literal[WorkspaceTag.resize]
    width: FiniteNumber
    height: FiniteNumber


class WorkspaceClickThrough(SessionMessage):
    type: Literal[WorkspaceTag.clickThrough]
    enabled: StrictBool


class WorkspaceListen(SessionMessage):
    type: Literal[WorkspaceTag.listen]
    event: Literal["keydown"]
    enabled: StrictBool


class WorkspaceEventResult(SessionMessage):
    type: Literal[WorkspaceTag.eventResult]
    eventId: str
    action: EventDecision


class WorkspaceNavigate(SessionMessage):
    type: Literal[WorkspaceTag.navigate]
    path: str


class WorkspacePosition(StrictModel):
    x: FiniteNumber
    y: FiniteNumber


class WorkspaceContext(SessionMessage):
    type: Literal[WorkspaceTag.context]
    tokens: dict[str, str]
    theme: str | None = None
    locale: str
    floating: StrictBool


class WorkspaceMoved(SessionMessage):
    type: Literal[WorkspaceTag.moved]
    position: WorkspacePosition


class WorkspaceLifecycle(SessionMessage):
    type: Literal[WorkspaceTag.lifecycle]
    state: SurfaceLifecycle


class WorkspaceKeyEvent(StrictModel):
    type: Literal["keydown"]
    key: str
    code: str
    altKey: StrictBool
    ctrlKey: StrictBool
    metaKey: StrictBool
    shiftKey: StrictBool
    repeat: StrictBool


class WorkspaceEvent(SessionMessage):
    type: Literal[WorkspaceTag.event]
    eventId: str
    event: WorkspaceKeyEvent


class WorkspaceFromFrame(
    RootModel[
        WorkspaceReady
        | WorkspaceChanged
        | WorkspaceResize
        | WorkspaceClickThrough
        | WorkspaceListen
        | WorkspaceEventResult
        | WorkspaceNavigate
    ]
):
    pass


class WorkspaceToFrame(
    RootModel[WorkspaceContext | WorkspaceMoved | WorkspaceLifecycle | WorkspaceEvent]
):
    pass


class ThemeSettingsReady(SessionMessage):
    type: Literal[ThemeSettingsTag.ready]


class ThemeSettingsGet(SessionMessage):
    type: Literal[ThemeSettingsTag.request]
    requestId: str = Field(max_length=80)
    action: Literal[ThemeSettingsAction.getSettings]


class ThemeSettingsUpdate(SessionMessage):
    type: Literal[ThemeSettingsTag.request]
    requestId: str = Field(max_length=80)
    action: Literal[ThemeSettingsAction.updateSettings]
    settings: dict[str, JsonValue]


class ThemeSettingsSaved(SessionMessage):
    type: Literal[ThemeSettingsTag.response]
    requestId: str = Field(max_length=80)
    settings: dict[str, JsonValue]


class ThemeSettingsFailed(SessionMessage):
    type: Literal[ThemeSettingsTag.response]
    requestId: str = Field(max_length=80)
    error: str


class ThemeSettingsFromFrame(
    RootModel[ThemeSettingsReady | ThemeSettingsGet | ThemeSettingsUpdate]
):
    pass


class ThemeSettingsToFrame(RootModel[ThemeSettingsSaved | ThemeSettingsFailed]):
    pass


class PlatformContracts(StrictModel):
    manifest: Manifest
    floating_position: FloatingPosition
    panel_request_spec: PanelRequestSpec
    panel_context: PanelContext
    panel_call: PanelBridgeRequest
    panel_result: PanelBridgeResponse
    panel_from_frame: PanelFromFrame
    panel_to_frame: PanelToFrame
    workspace_from_frame: WorkspaceFromFrame
    workspace_to_frame: WorkspaceToFrame
    theme_settings_from_frame: ThemeSettingsFromFrame
    theme_settings_to_frame: ThemeSettingsToFrame
    creation_context: CreationContextV1
    creation_subscribe: CreationSubscribe
    creation_event: CreationEvent


def _enum_values(kind: type[Enum]) -> dict[str, str]:
    return {item.name: item.value for item in kind}


def client_constants() -> dict:
    return {
        "contractVersion": CONTRACT_VERSION,
        "creation": {
            "version": 1,
            "subscribe": "mio:creation:subscribe",
            "event": "mio:creation:event",
            "events": ["creation.context.changed", "selection.changed"],
            "maxBytes": CREATION_BYTES,
            "intervalMs": CREATION_INTERVAL_MS,
        },
        "panel": {
            "version": PANEL_VERSION,
            "types": _enum_values(PanelTag),
            "limits": {
                "requestBytes": MAX_REQUEST_BYTES,
                "responseBytes": MAX_RESPONSE_BYTES,
                "concurrent": MAX_CONCURRENT,
                "requestIds": MAX_REQUEST_IDS,
                "imageBytes": MAX_IMAGE_BYTES,
                "downloadBytes": MAX_DOWNLOAD_BYTES,
                "mediaBytes": MAX_MEDIA_BYTES,
                "mediaItems": MAX_MEDIA_ITEMS,
                "imagePixels": MAX_IMAGE_PIXELS,
            },
        },
        "workspace": {
            "types": _enum_values(WorkspaceTag),
            "lifecycle": _enum_values(SurfaceLifecycle),
            "decisions": _enum_values(EventDecision),
            "eventTimeoutMs": WORKSPACE_EVENT_TIMEOUT_MS,
        },
        "themeSettings": {
            "types": _enum_values(ThemeSettingsTag),
            "actions": _enum_values(ThemeSettingsAction),
            "maxBytes": THEME_SETTINGS_BYTES,
            "timeoutMs": THEME_SETTINGS_TIMEOUT_MS,
        },
        "colorTokens": list(COLOR_TOKENS),
    }


def contract_schemas() -> dict[str, dict]:
    schema = PlatformContracts.model_json_schema(
        ref_template="#/components/schemas/MioContract_{model}"
    )
    definitions = schema.pop("$defs", {})
    return {
        **{f"MioContract_{name}": value for name, value in definitions.items()},
        "MioContract_PlatformContracts": schema,
    }
