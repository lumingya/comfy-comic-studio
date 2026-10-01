"""Application settings (one ``settings`` document, id ``app``) and the configured LLM client.

The API key never leaves the server: :func:`public` masks it, and :func:`apply_patch` keeps the
stored key when the client sends the mask back unchanged.
"""

from __future__ import annotations

from typing import Callable

from pydantic import Field

from . import llm as L
from .models import StrictModel, now_iso
from .pipeline.providers import ImageChannel

MASK = "••••••"
PROTECTED = {"extensions", "api_tokens", "id", "name"}


class LLMSettings(StrictModel):
    base_url: str = L.DEFAULT_BASE
    api_key: str = ""
    text_models: list[str] = Field(default_factory=lambda: list(L.TEXT_MODELS))
    vision_models: list[str] = Field(default_factory=lambda: list(L.VISION_MODELS))
    image_models: list[str] = Field(default_factory=lambda: list(L.IMAGE_SINGLE))
    timeout: float = Field(default=240.0, ge=5, le=1800)
    pace: float = Field(default=0.0, ge=0, le=60, description="Min seconds between requests")


class QASettings(StrictModel):
    votes: int = Field(default=3, ge=1, le=7)
    auto_adopt: bool = True
    faces: bool = True


class ExtensionState(StrictModel):
    enabled: bool = False
    digest: str = Field(default="", description="sha256 of the folder the user enabled")


# The legacy app's bundled collection; replaced by the real legacy name on first start.
DEFAULT_COLLECTION = "遇见你，真好"


class AppSettings(StrictModel):
    id: str = "app"
    name: str = "settings"
    llm: LLMSettings = Field(default_factory=LLMSettings)
    qa: QASettings = Field(default_factory=QASettings)
    guard_terms: list[str] = Field(
        default_factory=list, description="Blocked terms, checked before submit"
    )
    trash_days: int = Field(default=30, ge=1, le=3650)
    locale: str = "zh-CN"
    collection_title: str = Field(
        default=DEFAULT_COLLECTION, max_length=80, description="Name of the works shelf (画册集)"
    )
    studio_name: str = Field(
        default="", max_length=40, description="工作室名称 in the sidebar; '' = 我的工作室"
    )
    creator_name: str = Field(default="", max_length=60, description="创作者署名")
    signature: str = Field(
        default="", max_length=120, description="Default album signature (画册落款)"
    )
    legacy_seeded: bool = Field(
        default=False, description="The legacy books were brought over on first start"
    )
    theme: str = Field(default="system", description="system, or a theme id")
    extensions: dict[str, ExtensionState] = Field(default_factory=dict)
    image_channels: list[ImageChannel] = Field(
        default_factory=list, description="Extra cloud image channels (NovelAI, OpenAI Images…)"
    )
    image_channel: str = Field(default="", description="Default channel id; '' = LLM proxy")
    update_feed: str = Field(default="", description="Signed release manifest URL; '' = GitHub")
    updated_at: str = Field(default_factory=now_iso)


def load(store) -> AppSettings:
    from .storage import NotFound

    try:
        return store.get_doc("settings", "app")
    except NotFound:
        return AppSettings()


def public(settings: AppSettings) -> dict:
    data = settings.model_dump()
    data["llm"]["api_key"] = MASK if settings.llm.api_key else ""
    for channel in data["image_channels"]:
        channel["api_key"] = MASK if channel["api_key"] else ""
    return data


def apply_patch(settings: AppSettings, patch: dict) -> AppSettings:
    data = settings.model_dump()
    for key, value in patch.items():
        if key in PROTECTED:
            continue  # changed only through their own endpoints (trust / token flows)
        if isinstance(value, dict) and isinstance(data.get(key), dict):
            data[key] = {**data[key], **value}
        else:
            data[key] = value
    if data["llm"].get("api_key") == MASK:
        data["llm"]["api_key"] = settings.llm.api_key
    stored = {c.id: c.api_key for c in settings.image_channels}
    for channel in data.get("image_channels") or []:
        if isinstance(channel, dict) and channel.get("api_key") == MASK:
            if channel.get("id") not in stored:
                raise ValueError("渠道 ID 已改变，无法沿用原密钥；请保留原 ID 或重新填写密钥")
            channel["api_key"] = stored[channel["id"]]
    data["id"], data["name"] = "app", "settings"
    updated = AppSettings.model_validate(data)
    # Validate changes at the write boundary, not when loading older settings: a broken old
    # channel must not prevent the user from opening the UI to repair it.
    if "image_channels" in patch or "image_channel" in patch:
        ids = [c.id for c in updated.image_channels]
        if len(ids) != len(set(ids)):
            raise ValueError("渠道 ID 重复，请为每个渠道使用独立 ID")
        if updated.image_channel and updated.image_channel not in ids:
            raise ValueError("默认云端渠道不存在；删除前请明确选择新的默认渠道")
    return updated


class ConfiguredClient(L.Client):
    """:class:`llm.Client` whose default model lists come from the settings."""

    def __init__(self, cfg: LLMSettings):
        super().__init__(cfg.base_url, timeout=cfg.timeout, pace=cfg.pace, api_key=cfg.api_key)
        self.text_models = tuple(cfg.text_models) or L.TEXT_MODELS
        self.vision_models = tuple(cfg.vision_models) or L.VISION_MODELS
        self.image_models = tuple(cfg.image_models) or L.IMAGE_SINGLE

    def chat_json(self, messages, models=None, *args, **kw):
        return super().chat_json(messages, models or self.text_models, *args, **kw)

    def vision_json(self, prompt, images, models=None, timeout=None):
        return super().vision_json(prompt, images, models or self.vision_models, timeout)

    def generate_image(self, *args, models=None, **kw):
        return super().generate_image(*args, models=models or self.image_models, **kw)


def image_backend(
    settings: AppSettings, llm_factory, channel_id: str = "", transport=None, kinds=None
):
    """Image client for ``channel_id`` (or the default channel); raises LookupError if unknown."""
    from .pipeline import providers as PV

    channel_id = channel_id or settings.image_channel
    if not channel_id:
        return llm_factory()
    channel = next((c for c in settings.image_channels if c.id == channel_id), None)
    if channel is None:
        raise LookupError(f"出图渠道不存在：{channel_id}")
    return PV.build(channel, llm_factory, transport, kinds)


def llm_factory(store) -> Callable[[], L.Client]:
    return lambda: ConfiguredClient(load(store).llm)
