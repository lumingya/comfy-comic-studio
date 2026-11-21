"""Application settings (one ``settings`` document, id ``app``) and the configured LLM client.

The API key never leaves the server: :func:`public` masks it, and :func:`apply_patch` keeps the
stored key when the client sends the mask back unchanged.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Callable

from pydantic import Field

from . import llm as L
from .api_urls import normalize_base
from .models import GenerationDefaults, StrictModel, now_iso
from .pipeline import providers as PV

ImageChannel = PV.ImageChannel

MASK = "••••••"
PROTECTED = {"extensions", "api_tokens", "id", "name", "write_revision"}
# Masked credentials cannot serve as comparison values. This process-local keyed digest
# makes a stale private value detectable without exposing a stable hash of any credential.
_WRITE_REVISION_KEY = secrets.token_bytes(32)


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
    generation_defaults: dict[str, GenerationDefaults] = Field(default_factory=dict)
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
    data["write_revision"] = write_revision(settings)
    data["llm"]["api_key"] = MASK if settings.llm.api_key else ""
    for channel in data["image_channels"]:
        channel["api_key"] = MASK if channel["api_key"] else ""
        channel["extra_options"] = PV.redact_extra_options(channel["extra_options"])
    return data


def write_revision(settings: AppSettings) -> str:
    return hmac.new(
        _WRITE_REVISION_KEY, settings.model_dump_json().encode("utf-8"), hashlib.sha256
    ).hexdigest()


def intent_patch(settings: AppSettings, request: dict) -> dict:
    """Resolve field comparisons and channel edits against the transaction's live settings.

    ``expected`` compares only explicitly edited public fields. A channel edit has matching
    partial ``before``/``after`` keys; null before creates, null after deletes. The caller must
    keep read, comparison, validation and persistence within one store transaction.
    """
    from .storage import Conflict

    patch = dict(request)
    expected = patch.pop("expected", {})
    edits = patch.pop("image_channel_edits", [])
    revision = patch.pop("expected_revision", None)
    visible = public(settings)

    def compare(current, before):
        if isinstance(before, dict) and isinstance(current, dict):
            return all(
                key in current and compare(current[key], value) for key, value in before.items()
            )
        return current == before

    if not isinstance(expected, dict) or not isinstance(edits, list):
        raise ValueError("Invalid settings field intent")

    def masked(value):
        if isinstance(value, dict):
            return any(masked(item) for item in value.values())
        if isinstance(value, list):
            return any(masked(item) for item in value)
        return value == MASK

    compares_mask = masked(expected) or any(
        isinstance(edit, dict) and masked(edit.get("before")) for edit in edits
    )
    if compares_mask and revision is None:
        raise ValueError("Masked field comparisons require the opaque write revision")
    if revision is not None and (
        not isinstance(revision, str)
        or not revision.isascii()
        or not hmac.compare_digest(revision, visible["write_revision"])
    ):
        raise Conflict("Settings changed; cancel the draft and review the latest values.")
    if not compare(visible, expected):
        raise Conflict(
            "Settings changed in another window; cancel the draft and review the latest values."
        )
    if edits:
        if "image_channels" in patch:
            raise ValueError("Use channel edits or channel replacement, not both")
        channels = {c["id"]: c for c in visible["image_channels"]}
        seen = set()
        for edit in edits:
            if not isinstance(edit, dict) or not isinstance(edit.get("id"), str):
                raise ValueError("Invalid channel field intent")
            channel_id = edit["id"]
            if channel_id in seen or "before" not in edit or "after" not in edit:
                raise ValueError("Invalid or repeated channel field intent")
            seen.add(channel_id)
            before, after = edit["before"], edit["after"]
            current = channels.get(channel_id)
            if before is None:
                if current is not None:
                    raise Conflict(
                        "Channel was created in another window; review the latest settings."
                    )
                if not isinstance(after, dict) or after.get("id") != channel_id:
                    raise ValueError("New channel intent must contain its matching ID")
                channels[channel_id] = after
            else:
                if (
                    current is None
                    or not isinstance(before, dict)
                    or not all(
                        key in current and current[key] == value for key, value in before.items()
                    )
                ):
                    raise Conflict(
                        "Channel changed in another window; cancel the draft and review the latest values."
                    )
                if after is None:
                    # Deleting must compare the entire visible row, not merely one old field.
                    if before != current:
                        raise ValueError("Channel deletion must compare the full channel")
                    del channels[channel_id]
                elif (
                    isinstance(after, dict) and before.keys() == after.keys() and "id" not in after
                ):
                    channels[channel_id] = {**current, **after}
                else:
                    raise ValueError(
                        "Channel edit must compare each changed field and preserve its ID"
                    )
        patch["image_channels"] = list(channels.values())
    return patch


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
    stored_channels = {c.id: c for c in settings.image_channels}
    for channel in data.get("image_channels") or []:
        if isinstance(channel, dict) and channel.get("api_key") == MASK:
            if channel.get("id") not in stored:
                raise ValueError("渠道 ID 已改变，无法沿用原密钥；请保留原 ID 或重新填写密钥")
            channel["api_key"] = stored[channel["id"]]
        if isinstance(channel, dict) and channel.get("id") in stored_channels:
            channel["extra_options"] = _restore_masked_options(
                channel.get("extra_options", {}), stored_channels[channel["id"]].extra_options
            )
    data["id"], data["name"] = "app", "settings"
    updated = AppSettings.model_validate(data)
    # Normalize only edited addresses. Loading or editing an unrelated field must not rewrite
    # an existing service URL, especially an extension's own endpoint conventions.
    llm_patch = patch.get("llm")
    if (
        isinstance(llm_patch, dict)
        and "base_url" in llm_patch
        and updated.llm.base_url != settings.llm.base_url
    ):
        updated.llm.base_url = (
            normalize_base(updated.llm.base_url) if updated.llm.base_url.strip() else ""
        )
    if "image_channels" in patch:
        original = {c.id: c for c in settings.image_channels}
        for channel in updated.image_channels:
            old = original.get(channel.id)
            if channel.kind in {"openai_images", "chat_image"} and (
                old is None or channel.base_url != old.base_url
            ):
                channel.base_url = (
                    normalize_base(channel.base_url) if channel.base_url.strip() else ""
                )
    # Validate changes at the write boundary, not when loading older settings: a broken old
    # channel must not prevent the user from opening the UI to repair it.
    if "image_channels" in patch or "image_channel" in patch:
        ids = [c.id for c in updated.image_channels]
        if len(ids) != len(set(ids)):
            raise ValueError("渠道 ID 重复，请为每个渠道使用独立 ID")
        if updated.image_channel and updated.image_channel not in ids:
            raise ValueError("默认云端渠道不存在；删除前请明确选择新的默认渠道")
    return updated


def _restore_masked_options(value, stored):
    """Keep secret-like extra options when a public masked settings object is resubmitted."""
    from .pipeline.cloud_request import SECRET_OPTION_NAME

    if isinstance(value, list):
        old = stored if isinstance(stored, list) else []
        return [
            _restore_masked_options(item, old[index] if index < len(old) else {})
            for index, item in enumerate(value)
        ]
    if not isinstance(value, dict):
        return value
    stored = stored if isinstance(stored, dict) else {}
    result = {}
    for key, item in value.items():
        if SECRET_OPTION_NAME.search(key) and item == MASK:
            if key not in stored:
                raise ValueError(f"渠道参数 {key} 已改变，无法沿用原密钥")
            result[key] = stored[key]
        elif isinstance(item, (dict, list)):
            result[key] = _restore_masked_options(item, stored.get(key, {}))
        else:
            result[key] = item
    return result


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
