"""Public AI assistant contracts; credentials are masked at the storage boundary."""

from typing import Literal

from mio_server.extensions.public import Scope, StrictModel
from pydantic import Field, model_validator


class Channel(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(default="", max_length=80)
    provider: Literal["openai", "deepseek", "gemini"] = "openai"
    base_url: str = Field(default="", max_length=2048)
    api_key: str = Field(default="", max_length=8192)
    model: str = Field(default="", max_length=200)
    timeout: float = Field(default=120, ge=5, le=600)


class Permissions(StrictModel):
    scopes: list[Scope] = Field(default_factory=lambda: ["read"])
    allow_operations: list[str] = Field(default_factory=list, max_length=2000)
    deny_operations: list[str] = Field(default_factory=list, max_length=2000)
    confirm_mutations: bool = True


class AssistSettings(StrictModel):
    mode: Literal["floating", "page"] = "floating"
    active_channel_id: str = ""
    channels: list[Channel] = Field(default_factory=list, max_length=40)
    permissions: Permissions = Field(default_factory=Permissions)

    @model_validator(mode="after")
    def unique_channels(self):
        ids = [c.id for c in self.channels]
        if len(ids) != len(set(ids)):
            raise ValueError("渠道 ID 不能重复")
        if self.active_channel_id and self.active_channel_id not in ids:
            raise ValueError("当前渠道不存在")
        return self


class NewConversation(StrictModel):
    title: str = Field(default="新对话", min_length=1, max_length=120)


class MessageRequest(StrictModel):
    content: str = Field(default="", max_length=100000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=4)
    idempotency_key: str = Field(min_length=1, max_length=128)


class ApprovalRequest(StrictModel):
    call_id: str
    approved: bool
