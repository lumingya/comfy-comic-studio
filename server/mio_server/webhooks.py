"""Outgoing webhooks: domain events POSTed as signed JSON to user-configured URLs.

Delivery runs on one background thread so the pipeline never waits on the network.  Every request
carries:

* ``X-Mio-Event`` – event name, e.g. ``job.completed``.
* ``X-Mio-Delivery`` – unique delivery id (receivers can de-duplicate on it).
* ``X-Mio-Timestamp`` – unix seconds.
* ``X-Mio-Signature`` – ``sha256=`` + HMAC-SHA256(secret, ``"<timestamp>.<body>"``).

Failed deliveries (network errors, 5xx, 429) are retried after 2 s and 10 s.  The last 30
deliveries per webhook are kept in memory for the settings page.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import queue
import secrets
import threading
import time
import uuid
from collections import deque
from urllib.parse import urlsplit

import httpx
from pydantic import Field, field_validator

from .models import StrictModel, new_id, now_iso

log = logging.getLogger("mio.webhooks")

EVENTS = {
    "job.completed": "任务完成",
    "job.failed": "任务失败",
    "job.canceled": "任务取消",
    "take.created": "出图结果入库",
    "take.status": "采用 / 淘汰某张图",
    "episode.exported": "导出完成",
}
TERMINAL = {"completed": "job.completed", "failed": "job.failed", "canceled": "job.canceled"}
RETRY_DELAYS = (2.0, 10.0)


def validate_webhook_url(value: str) -> None:
    """Validate writes and legacy configuration without echoing credentials or the URL."""
    try:
        if (
            not isinstance(value, str)
            or not value.startswith(("http://", "https://"))
            or len(value) > 2000
            or any(c.isspace() for c in value)
        ):
            raise ValueError
        parts = urlsplit(value)
        url = httpx.URL(value)
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or not url.host
            or not url.is_absolute_url
            or parts.username is not None
            or parts.password is not None
            or "\\" in value
        ):
            raise ValueError
        # Both parsers are needed: urlsplit checks IPv6 brackets and the port range;
        # HTTPX validates the URL that will actually be passed to the request client.
        parts.port
    except (ValueError, httpx.InvalidURL):
        raise ValueError("Webhook URL must be a valid HTTP(S) URL without userinfo") from None


class Webhook(StrictModel):
    id: str = Field(default_factory=lambda: new_id("hook"))
    name: str = Field(default="webhook", max_length=60)
    url: str = Field(pattern=r"^https?://\S+$", max_length=2000)
    events: list[str] = Field(default_factory=lambda: ["job.completed", "job.failed"])
    secret: str = Field(default_factory=lambda: secrets.token_urlsafe(24))
    enabled: bool = True
    created_at: str = Field(default_factory=now_iso)

    @field_validator("events")
    @classmethod
    def known_events(cls, value: list[str]) -> list[str]:
        unknown = [e for e in value if e != "*" and e not in EVENTS]
        if unknown or not value:
            raise ValueError(
                f"未知事件：{', '.join(unknown) or '（空）'}；可用：{', '.join(EVENTS)}"
            )
        return value

    def wants(self, event: str) -> bool:
        return self.enabled and ("*" in self.events or event in self.events)


def sign(secret: str, timestamp: str, body: bytes) -> str:
    mac = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256)
    return "sha256=" + mac.hexdigest()


class Dispatcher:
    def __init__(self, store, engine=None, transport: httpx.BaseTransport | None = None):
        self.store = store
        self.engine = engine
        self.transport = transport
        self.deliveries: dict[str, deque] = {}
        self._queue: queue.Queue = queue.Queue()
        self._thread: threading.Thread | None = None
        self._closed = False
        self._lifecycle_lock = threading.Lock()
        self._stopping = threading.Event()
        self.sleep = self._stopping.wait

    # ----------------------------------------------------------------- intake
    def attach(self, hooks) -> None:
        for name in ("take.created", "take.status", "episode.exported"):
            hooks.add(name, lambda payload, _n=name: self.emit(_n, payload), source="core:webhooks")
        hooks.add("job.event", self._job_event, source="core:webhooks")

    def _job_event(self, payload: dict) -> None:
        if payload.get("type") == "state" and payload.get("idx") is None:
            event = TERMINAL.get((payload.get("data") or {}).get("state"))
            if event:
                self.emit(event, {"job_id": payload["job_id"], **payload["data"]})

    def emit(self, event: str, data: dict) -> None:
        with self._lifecycle_lock:
            if self._closed:
                return
            self._queue.put((event, data))
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, name="mio-webhooks", daemon=True)
                self._thread.start()

    # ---------------------------------------------------------------- delivery
    def _run(self) -> None:
        while True:
            item = self._queue.get()
            try:
                if item is None:
                    return
                if not self._closed:
                    self._fan_out(*item)
            except Exception as exc:
                log.warning("webhook fan-out failed (%s)", type(exc).__name__)
            finally:
                self._queue.task_done()

    def _fan_out(self, event: str, data: dict) -> None:
        hooks = [h for h in self.store.list_docs("webhook") if h.wants(event)]
        if not hooks:
            return
        if event.startswith("job.") and self.engine is not None:
            try:
                job = self.engine.get(data["job_id"])
                data = {**data, "kind": job.get("kind"), "title": job.get("title")}
                data["owner"] = job.get("owner")
                data["params"] = job.get("snapshot") or {}
            except Exception:
                pass
        for hook in hooks:
            try:
                self.deliver(hook, event, data)
            except Exception as exc:
                # One subscriber must not consume the event for later subscribers. Never
                # log exception text: transports may include URLs or signing credentials.
                log.warning("webhook delivery failed (%s)", type(exc).__name__)

    def deliver(self, hook: Webhook, event: str, data: dict, retries=RETRY_DELAYS) -> dict:
        delivery_id = uuid.uuid4().hex
        body = json.dumps(
            {"id": delivery_id, "event": event, "at": now_iso(), "data": data},
            ensure_ascii=False,
            default=str,
        ).encode("utf-8")
        record = {
            "id": delivery_id,
            "event": event,
            "at": now_iso(),
            "status": None,
            "attempts": 0,
            "error": "",
        }
        for delay in (0.0, *retries):
            if delay:
                self.sleep(delay)
            if self._closed:
                record["error"] = "Webhook dispatcher closed"
                break
            try:
                # Reload after every backoff. A previously sent request cannot be revoked,
                # but no new attempt should keep using its stale address or signing key.
                current = self.store.get_doc("webhook", hook.id)
                validate_webhook_url(current.url)
                if not current.secret.strip():
                    raise ValueError("missing signing key")
            except Exception:
                record["error"] = "Webhook configuration unavailable or invalid"
                break
            # Manual test requests deliberately bypass enabled/event subscriptions while
            # still requiring the current persisted URL and signing key.
            if event != "ping" and (event not in EVENTS or not current.wants(event)):
                record["error"] = "Webhook disabled or no longer subscribed"
                break
            stamp = str(int(time.time()))
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "mio-webhooks",
                "X-Mio-Event": event,
                "X-Mio-Delivery": delivery_id,
                "X-Mio-Timestamp": stamp,
                "X-Mio-Signature": sign(current.secret, stamp, body),
            }
            try:
                record["attempts"] += 1
                with httpx.Client(timeout=15, transport=self.transport) as http:
                    resp = http.post(current.url, content=body, headers=headers)
                record.update(status=resp.status_code, error="")
                if resp.status_code < 500 and resp.status_code != 429:
                    break
                record["error"] = f"HTTP {resp.status_code}"
            except httpx.InvalidURL:
                record.update(status=None, error="Webhook configuration unavailable or invalid")
                break
            except httpx.HTTPError as exc:
                record.update(status=None, error=f"Webhook request failed ({type(exc).__name__})")
            except Exception as exc:
                record.update(status=None, error=f"Webhook delivery failed ({type(exc).__name__})")
                break
        self.deliveries.setdefault(hook.id, deque(maxlen=30)).appendleft(record)
        return record

    def flush(self, timeout: float = 5.0) -> None:
        """Wait until queued events are delivered (tests, shutdown)."""
        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.01)

    def close(self) -> None:
        """Stop intake, discard unstarted events, and wait for the in-flight request.

        Backoff is interruptible. An already running HTTP request keeps its own timeout;
        close returns only after the worker has exited rather than orphaning it.
        """
        with self._lifecycle_lock:
            if not self._closed:
                self._closed = True
                self._stopping.set()
                if self._thread is not None:
                    self._queue.put(None)
            thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join()
