"""Bounded HTTP owned by this package; generation POSTs are never retried."""

from __future__ import annotations

import hashlib
import math
import re
import threading
import time
from collections import OrderedDict
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin

import httpx
from httpx import create_ssl_context
from mio_server.llm import LLMError

from .deadline import Deadline

MAX_BYTES = 16 * 1024 * 1024


def error(message, *, sent=False, status=None):
    return LLMError(message, status, False, sent=sent)


def number(options, name, default, minimum, maximum, *, integer=False):
    value = options.get(name, default)
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not minimum <= value <= maximum
        or not math.isfinite(value)
        or (integer and not isinstance(value, int))
    ):
        raise error("Invalid numeric channel option", status=400)
    return value


def retry_after(value):
    try:
        delay = float(value)
    except (ValueError, TypeError):
        try:
            deadline = parsedate_to_datetime(value)
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=UTC)
            delay = (deadline - datetime.now(UTC)).total_seconds()
        except (ValueError, TypeError, OverflowError):
            return 1.0
    return min(30.0, max(0.0, delay)) if math.isfinite(delay) else 1.0


class Scope:
    """An activation owns cancellation and a bounded origin/credential rate ledger."""

    def __init__(self):
        self.stopped = threading.Event()
        self.lock = threading.Lock()
        self.next_at = OrderedDict()
        self.cooldowns = {}

    def close(self):
        self.stopped.set()

    def reserve(self, key, interval, *, cooldown=0.0):
        with self.lock:
            now = time.monotonic()
            if cooldown:
                self.cooldowns[key] = max(self.cooldowns.get(key, now), now + cooldown)
            start = max(now, self.next_at.pop(key, now), self.cooldowns.get(key, now))
            delay = start - now
            # Waiting callers do not own future slots: after a cooldown they must compete
            # again under this lock, so only one sender is admitted per interval.
            self.next_at[key] = start if delay or cooldown else now + interval
            while len(self.next_at) > 256:
                removed, _ = self.next_at.popitem(last=False)
                self.cooldowns.pop(removed, None)
            return delay

    def cooldown(self, key):
        with self.lock:
            return max(0, self.cooldowns.get(key, 0) - time.monotonic())


class Transfer:
    def __init__(self, channel, transport, scope, cancel, timeout):
        try:
            base = httpx.URL(channel.base_url)
        except (ValueError, httpx.InvalidURL):
            raise error("Invalid channel base URL", status=400) from None
        if (
            base.scheme not in ("http", "https")
            or not base.host
            or base.username
            or base.password
            or base.query
            or base.fragment
            or "\\" in channel.base_url
        ):
            raise error(
                "Base URL must be an explicit HTTP(S) origin/path without credentials",
                status=400,
            )
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not 0 < timeout <= 3600
            or not math.isfinite(timeout)
        ):
            raise error("Invalid generation deadline", status=400)
        self.base = str(base).rstrip("/")
        self.origin = (base.scheme, base.host, base.port)
        self.scope, self.cancel = scope, cancel
        self.deadline = time.monotonic() + timeout
        self.sent = False
        self.limit = number(
            channel.extra_options,
            "max_result_bytes",
            MAX_BYTES,
            1024,
            32 * 1024 * 1024,
            integer=True,
        )
        self.interval = number(channel.extra_options, "min_interval", 0.5, 0, 60)
        self.key = (self.origin, hashlib.sha256(channel.api_key.encode()).digest())
        headers = {
            "User-Agent": "mio-standard-image-channels/1",
            "Accept-Encoding": "identity",
        }
        if channel.api_key:
            headers["Authorization"] = f"Bearer {channel.api_key}"
        self.native = transport is None
        if self.native:
            # A request watchdog must never act on a connection returned to a
            # shared/idle pool. Each Transfer owns this HTTP/1-only transport;
            # no socket is handed to another request after its response ends.
            self.ssl_context = create_ssl_context(trust_env=False)
            transport = httpx.HTTPTransport(
                verify=self.ssl_context,
                trust_env=False,
                retries=0,
                limits=httpx.Limits(max_keepalive_connections=0),
            )
        self.http = httpx.Client(
            headers=headers,
            transport=transport,
            trust_env=False,
            follow_redirects=False,
        )

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.http.close()

    def check(self):
        if self.cancel.is_set() or self.scope.stopped.is_set():
            raise error(
                "Image request cancelled; any submitted remote work requires reconciliation",
                sent=self.sent,
            )
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise error(
                "Image request deadline exceeded; submitted work was not repeated",
                sent=self.sent,
            )
        return remaining

    def wait(self, seconds):
        end = time.monotonic() + max(0, seconds)
        while True:
            remaining = self.check()
            delay = end - time.monotonic()
            if delay <= 0:
                return
            self.cancel.wait(min(delay, remaining, 0.1))

    def endpoint(self, path):
        if (
            not isinstance(path, str)
            or not re.fullmatch(r"/[A-Za-z0-9_./-]+", path)
            or path.startswith("//")
            or any(char in path for char in "\\?#")
            or any(part in (".", "..") for part in path.split("/"))
        ):
            raise error(
                "Channel paths must be local absolute paths without traversal",
                sent=self.sent,
                status=400,
            )
        return self.base + path

    def download_url(self, value):
        if not isinstance(value, str) or len(value) > 4096 or "\\" in value:
            raise error("Generated image URL rejected", sent=True)
        try:
            url = httpx.URL(urljoin(self.base + "/", value))
        except (ValueError, httpx.InvalidURL):
            raise error("Generated image URL rejected", sent=True) from None
        if (
            (url.scheme, url.host, url.port) != self.origin
            or url.username
            or url.password
            or url.fragment
        ):
            raise error(
                "Image download must stay on the configured API origin; use inline image output",
                sent=True,
            )
        return str(url)

    def request(self, method, url, *, artifact=False, **kwargs):
        self.check()
        while delay := self.scope.reserve(self.key, self.interval):
            self.wait(delay)
        previous = self.sent
        if method == "POST":
            self.sent = True
        response = None
        guard = Deadline(self, self.ssl_context) if self.native else None
        if guard is not None:
            guard.start()
        try:
            request = self.http.build_request(method, url, timeout=self.check(), **kwargs)
            if guard is not None:
                request.extensions["trace"] = guard.trace
            if artifact:
                request.headers.pop("authorization", None)
                request.headers.pop("cookie", None)
            response = self.http.send(request, stream=True, follow_redirects=False)
            self.check()
            status = response.status_code
            if status == 429:
                self.scope.reserve(
                    self.key,
                    0,
                    cooldown=retry_after(response.headers.get("Retry-After")),
                )
            if not 200 <= status < 300:
                # Never copy an upstream body, URL or exception (which may echo credentials).
                if method == "GET" and (status == 429 or status >= 500):
                    return status, response.headers, b""
                definite = 400 <= status < 500 and status not in (408, 409, 425)
                sent = previous if method == "POST" and definite else self.sent
                raise error(
                    f"Image service HTTP {status}; no generation request was retried",
                    status=status,
                    sent=sent,
                )
            if response.headers.get("Content-Encoding", "identity").lower() not in (
                "",
                "identity",
            ):
                raise error("Compressed HTTP image responses are not supported", sent=self.sent)
            limit = self.limit if artifact else self.limit * 2 + 4096
            length = response.headers.get("Content-Length", "")
            if length.isdecimal() and (len(length) > 10 or int(length) > limit):
                raise error("Image response exceeds the configured byte limit", sent=self.sent)
            chunks, total = [], 0
            # iter_bytes(chunk_size=...) aggregates transport chunks before yielding and
            # can hide a slow trickle from our total deadline/cancellation checks.
            # Identity encoding was required above, so raw bytes need no decoder.
            stream = (response.content,) if response.is_stream_consumed else response.iter_raw()
            iterator = iter(stream)
            while True:
                self.check()
                try:
                    chunk = next(iterator)
                except StopIteration:
                    break
                self.check()
                total += len(chunk)
                if total > limit:
                    raise error(
                        "Image response exceeds the configured byte limit",
                        sent=self.sent,
                    )
                chunks.append(chunk)
            return status, response.headers, b"".join(chunks)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            self.check()
            if method == "GET":
                return 503, httpx.Headers(), b""
            raise error("Image service connection failed", sent=previous) from None
        except httpx.HTTPError:
            self.check()
            if method == "GET":
                return 503, httpx.Headers(), b""
            raise error(
                "Image transport ended without a confirmed result; no submission was repeated",
                sent=self.sent,
            ) from None
        finally:
            if guard is not None:
                guard.close()
            if response is not None:
                response.close()

    def download(self, value):
        url = self.download_url(value)
        for attempt in range(3):
            status, headers, body = self.request("GET", url, artifact=True)
            if 200 <= status < 300:
                return body
            if attempt < 2:
                self.wait(retry_after(headers.get("Retry-After")))
        raise error(
            "Generated image download failed; remote work was not repeated",
            sent=True,
            status=status,
        )
