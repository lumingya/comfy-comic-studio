"""Browser guard for the token-free local API (``/api/...``; ``/api/v2`` is exempt).

The UI API has no login: it trusts that only this machine talks to it.  A browser breaks that
trust in two ways, both closed here:

* **Cross-site requests.**  Any page the user visits can POST to ``http://127.0.0.1:8788`` — a
  "simple" request needs no CORS preflight, and FastAPI parses a body *without* Content-Type as
  JSON — or open the job WebSocket.  That is enough to install and enable an extension (i.e. run
  code), register a webhook or a ComfyUI instance that leaks the work, or start paid renders.
  So unsafe methods and WebSocket handshakes must come from the app's own origin: a present
  ``Origin`` has to match ``Host``; without one, ``Sec-Fetch-Site`` (if sent) must be
  ``same-origin`` / ``none``.  Clients that send neither (scripts, curl, tests) are not browsers.
* **DNS rebinding.**  A hostile domain that re-resolves to 127.0.0.1 is "same-origin" with the
  app and could read everything.  The ``Host`` header must therefore be ``localhost`` /
  ``*.localhost``, an IP literal, or listed in ``MIO_ALLOWED_HOSTS`` (comma separated, e.g. a
  LAN name when serving with ``--host 0.0.0.0``; ``*`` turns the Host check off).

``/api/v2`` needs a bearer token, which browsers never attach on their own, so it is exempt.
"""

from __future__ import annotations

import ipaddress
import json
import os
from urllib.parse import urlsplit

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
SAME_SITE = frozenset({"same-origin", "none"})

MESSAGES = {
    "host": (
        "拒绝访问：未知的主机名 {host}。请用 http://127.0.0.1 或 localhost 打开；"
        "局域网主机名请加入环境变量 MIO_ALLOWED_HOSTS"
    ),
    "origin": "拒绝跨站请求：只有 Mio 自己的页面可以修改数据",
}


def env_hosts() -> frozenset[str]:
    raw = os.environ.get("MIO_ALLOWED_HOSTS", "")
    return frozenset(h.strip().lower().strip("[]") for h in raw.split(",") if h.strip())


def hostname(value: str) -> str:
    """``Example.com:8788`` → ``example.com``; ``[::1]:8788`` → ``::1``."""
    value = value.strip().lower()
    if value.startswith("["):
        end = value.find("]")
        return value[1:end] if end > 0 else ""
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def host_allowed(host_header: str, extra: frozenset[str] = frozenset()) -> bool:
    """Only names an attacker cannot point at this machine (or ones the user listed)."""
    host = hostname(host_header)
    if not host:
        return False
    if host == "localhost" or host.endswith(".localhost") or _is_ip(host):
        return True
    return host in extra or "*" in extra


def same_origin(headers: dict[str, str], extra: frozenset[str] = frozenset()) -> bool:
    origin = headers.get("origin")
    if origin is not None:
        if origin == "null":  # sandboxed iframes, file://, some redirects
            return False
        parts = urlsplit(origin)
        if not parts.netloc:
            return False
        if parts.netloc.lower() == headers.get("host", "").strip().lower():
            return True
        # A reverse proxy may rewrite Host; an explicitly allowed name is trusted as an origin.
        return (parts.hostname or "") in extra
    return headers.get("sec-fetch-site", "none") in SAME_SITE


class LocalGuard:
    """Pure ASGI middleware (covers HTTP and WebSocket alike)."""

    def __init__(
        self,
        app,
        allowed: frozenset[str] = frozenset(),
        prefix: str = "/api",
        exempt: tuple[str, ...] = ("/api/v2",),
    ):
        self.app = app
        self.extra = allowed
        self.prefix = prefix
        self.exempt = exempt

    def guarded(self, path: str) -> bool:
        def under(root: str) -> bool:
            return path == root or path.startswith(root + "/")

        return under(self.prefix) and not any(under(e) for e in self.exempt)

    def verdict(self, scope) -> str | None:
        headers = {
            k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])
        }
        if not host_allowed(headers.get("host", ""), self.extra):
            return "host"
        unsafe = scope["type"] == "websocket" or scope.get("method") not in SAFE_METHODS
        if unsafe and not same_origin(headers, self.extra):
            return "origin"
        return None

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or not self.guarded(scope.get("path", "")):
            await self.app(scope, receive, send)
            return
        reason = self.verdict(scope)
        if reason is None:
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            # Closing before accept makes the server answer the handshake with 403.
            await send({"type": "websocket.close", "code": 1008})
            return
        host = dict(scope.get("headers", [])).get(b"host", b"").decode("latin-1")
        body = json.dumps(
            {"detail": MESSAGES[reason].format(host=host or "?"), "kind": "forbidden"},
            ensure_ascii=False,
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
