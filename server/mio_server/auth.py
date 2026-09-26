"""API tokens for ``/api/v2`` (bots, scripts, other apps).

The local UI on ``/api`` stays token-free (it's bound to the machine); anything outside talks to
``/api/v2`` with ``Authorization: Bearer mio_<id>_<secret>``.  Only a sha256 of the secret is
stored, and the full token is shown once when created.

Scopes, from least to most powerful:

* ``read`` – every GET.
* ``write`` – edits to series, episodes, panels, strips, workflows and templates.
* ``render`` – anything that can spend money or GPU time: generating scripts, rendering, finalize,
  edits, QA, the assistant, and retrying or resuming jobs.  This replaces v1's
  ``trusted: true`` confirmation.
* ``admin`` – settings, ComfyUI instances, webhooks, legacy import.

Token management and extensions are never reachable through v2.  Tokens and extensions can only
be managed from the local UI.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Literal

from pydantic import Field, field_validator

from .models import StrictModel, new_id, now_iso

Scope = Literal["read", "write", "render", "admin"]
SCOPES: tuple[str, ...] = ("read", "write", "render", "admin")
TOKEN_RE = re.compile(r"^mio_(tok_[A-Za-z0-9]+)_([A-Za-z0-9_-]{20,})$")

RENDER_RE = re.compile(
    r"^/(series/[^/]+/episodes/generate"
    r"|episodes/[^/]+/(render|finalize|edit|qa|assistant/propose)"
    r"|jobs/[^/]+/(retry|resume))$"
)
ADMIN_RE = re.compile(r"^/(settings|instances|webhooks|legacy)(/|$)")


class ApiToken(StrictModel):
    id: str = Field(default_factory=lambda: new_id("tok"))
    name: str = Field(min_length=1, max_length=60)
    scopes: list[Scope] = Field(default_factory=lambda: ["read"])
    secret_hash: str = ""
    hint: str = Field(default="", description="Last 4 characters, to tell tokens apart")
    created_at: str = Field(default_factory=now_iso)
    expires_at: str = Field(default="", description="ISO time; '' = never")
    last_used_at: str = ""

    def public(self) -> dict:
        return self.model_dump(exclude={"secret_hash"})

    @field_validator("expires_at")
    @classmethod
    def iso_time(cls, value: str) -> str:
        if value:
            _parse(value)
        return value

    def expired(self) -> bool:
        return bool(self.expires_at) and _parse(self.expires_at) <= datetime.now(timezone.utc)


def _parse(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError("过期时间必须是 ISO 8601 时间") from None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class AuthError(Exception):
    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def issue(name: str, scopes: list[str], expires_at: str = "") -> tuple[ApiToken, str]:
    """New token and its one-time plaintext."""
    secret = secrets.token_urlsafe(30)
    token = ApiToken(name=name, scopes=sorted(set(scopes), key=SCOPES.index), expires_at=expires_at)
    token.secret_hash = _hash(secret)
    token.hint = secret[-4:]
    return token, f"mio_{token.id}_{secret}"


def required_scope(method: str, path: str) -> str:
    """Scope needed for ``method path`` (path relative to ``/api/v2``)."""
    if ADMIN_RE.match(path):
        return "admin"
    if method in ("GET", "HEAD", "OPTIONS", "WS"):
        return "read"
    if RENDER_RE.match(path):
        return "render"
    return "write"


class TokenStore:
    """Verifies bearer tokens; ``last_used_at`` is written at most once a minute per token."""

    def __init__(self, store):
        self.store = store
        self._touched: dict[str, float] = {}

    def verify(self, raw: str, method: str, path: str) -> ApiToken:
        from .storage import NotFound

        match = TOKEN_RE.match(raw or "")
        if not match:
            raise AuthError("缺少或无效的 API 令牌（Authorization: Bearer mio_…）")
        token_id, secret = match.groups()
        try:
            token: ApiToken = self.store.get_doc("api_token", token_id)
        except NotFound:
            raise AuthError("API 令牌不存在或已撤销") from None
        if not hmac.compare_digest(token.secret_hash, _hash(secret)):
            raise AuthError("API 令牌不存在或已撤销")
        if token.expired():
            raise AuthError("API 令牌已过期")
        need = required_scope(method, path)
        if need not in token.scopes:
            raise AuthError(f"令牌缺少权限：{need}", 403)
        now = time.monotonic()
        if now - self._touched.get(token.id, -1e9) > 60:
            self._touched[token.id] = now
            token.last_used_at = now_iso()
            self.store.put_doc(token)
        return token
