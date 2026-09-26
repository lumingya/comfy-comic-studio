"""Open-API access management: API tokens (local UI only) and webhooks."""

from __future__ import annotations

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from .. import auth as AU
from ..webhooks import EVENTS, Webhook
from .deps import Ctx

tokens = APIRouter(tags=["access"])
hooks = APIRouter(tags=["webhooks"])


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    scopes: list[AU.Scope] = Field(default_factory=lambda: ["read"], min_length=1)
    expires_at: str = ""


class WebhookPatch(BaseModel):
    name: str | None = None
    url: str | None = None
    events: list[str] | None = None
    enabled: bool | None = None
    rotate_secret: bool = False


def _public_hook(hook: Webhook, reveal: bool = False) -> dict:
    data = hook.model_dump()
    if not reveal:
        data["secret"] = hook.secret[:4] + "…"
    return data


# ----------------------------------------------------------------- tokens
@tokens.get("/tokens")
def list_tokens(ctx: Ctx) -> dict:
    items = sorted(ctx.store.list_docs("api_token"), key=lambda t: t.created_at)
    return {"items": [t.public() for t in items], "scopes": list(AU.SCOPES)}


@tokens.post("/tokens", status_code=status.HTTP_201_CREATED)
def create_token(ctx: Ctx, body: TokenCreate) -> dict:
    """The plaintext ``token`` is returned only here, once."""
    token, plaintext = AU.issue(body.name, list(body.scopes), body.expires_at)
    ctx.store.put_doc(token)
    return {**token.public(), "token": plaintext}


@tokens.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(ctx: Ctx, token_id: str) -> None:
    ctx.store.get_doc("api_token", token_id)
    ctx.store.delete_doc("api_token", token_id)


# --------------------------------------------------------------- webhooks
@hooks.get("/webhooks")
def list_webhooks(ctx: Ctx) -> dict:
    items = sorted(ctx.store.list_docs("webhook"), key=lambda h: h.created_at)
    return {"items": [_public_hook(h) for h in items], "events": EVENTS}


@hooks.post("/webhooks", status_code=status.HTTP_201_CREATED)
def create_webhook(ctx: Ctx, body: dict) -> dict:
    """The signing ``secret`` is shown in full only here and after ``rotate_secret``."""
    hook = Webhook.model_validate({k: v for k, v in body.items() if k not in ("id", "secret")})
    ctx.store.put_doc(hook)
    return _public_hook(hook, reveal=True)


@hooks.patch("/webhooks/{hook_id}")
def update_webhook(ctx: Ctx, hook_id: str, body: WebhookPatch) -> dict:
    hook: Webhook = ctx.store.get_doc("webhook", hook_id)
    data = hook.model_dump()
    data.update(body.model_dump(exclude_none=True, exclude={"rotate_secret"}))
    if body.rotate_secret:
        data.pop("secret")
    updated = Webhook.model_validate(data)
    ctx.store.put_doc(updated)
    return _public_hook(updated, reveal=body.rotate_secret)


@hooks.delete("/webhooks/{hook_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_webhook(ctx: Ctx, hook_id: str) -> None:
    ctx.store.get_doc("webhook", hook_id)
    ctx.store.delete_doc("webhook", hook_id)
    ctx.webhooks.deliveries.pop(hook_id, None)


@hooks.post("/webhooks/{hook_id}/test")
def test_webhook(ctx: Ctx, hook_id: str) -> dict:
    """Send a ``ping`` right away (synchronously, no retries) and return the delivery record."""
    hook: Webhook = ctx.store.get_doc("webhook", hook_id)
    return ctx.webhooks.deliver(hook, "ping", {"webhook_id": hook.id}, retries=())


@hooks.get("/webhooks/{hook_id}/deliveries")
def webhook_deliveries(ctx: Ctx, hook_id: str) -> list[dict]:
    ctx.store.get_doc("webhook", hook_id)
    return list(ctx.webhooks.deliveries.get(hook_id, []))
