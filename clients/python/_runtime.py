from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

__all__ = ["MioClient", "MioError"]

TERMINAL = {"completed", "failed", "canceled"}


class MioError(Exception):
    """HTTP error from the Mio API; ``kind`` is not_found / invalid / unauthorized / …"""

    def __init__(self, status: int, kind: str, detail: str):
        super().__init__(f"{status} {kind}: {detail}")
        self.status, self.kind, self.detail = status, kind, detail


def _q(value: Any) -> str:
    return urllib.parse.quote(str(value), safe="")


class _Base:
    def __init__(self, base_url: str = "http://127.0.0.1:8788", token: str = "", timeout=120.0):
        self.base = base_url.rstrip("/") + "/api/v2"
        self.token = token
        self.timeout = timeout

    def _request(
        self, method: str, path: str, *, params=None, json=None, content=None, timeout=None
    ) -> Any:
        url = self.base + path
        query = {k: v for k, v in (params or {}).items() if v is not None}
        if query:
            url += "?" + urllib.parse.urlencode(
                {k: str(v).lower() if isinstance(v, bool) else v for k, v in query.items()}
            )
        headers = {"Accept": "application/json", "User-Agent": "mio-client"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = None
        if json is not None:
            data = _json.dumps(json, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif content is not None:
            data = content
            headers["Content-Type"] = "application/octet-stream"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(
                req, timeout=self.timeout if timeout is None else timeout
            ) as resp:
                raw, ctype = resp.read(), resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:
            with exc:
                raw = exc.read()
            try:
                err = _json.loads(raw)
            except ValueError:
                err = None
            if isinstance(err, dict):
                raise MioError(exc.code, err.get("kind", "error"), str(err.get("detail"))) from None
            raise MioError(exc.code, "error", raw[:300].decode("utf-8", "replace")) from None
        if not raw:
            return None
        return _json.loads(raw) if "json" in ctype else raw

    # ---------------------------------------------------------------- helpers
    def wait_job(self, job_id: str, timeout: float = 1800, poll: float = 2.0) -> dict:
        """Poll for a terminal job; zero timeout expires without making a request."""
        if not math.isfinite(timeout) or timeout < 0:
            raise ValueError("timeout must be finite and non-negative")
        if not math.isfinite(poll) or poll <= 0:
            raise ValueError("poll must be finite and positive")
        deadline = time.monotonic() + timeout
        state = "not polled"
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"job {job_id} still {state} after {timeout:.0f}s")
            request_timeout = remaining if self.timeout is None else min(self.timeout, remaining)
            job = self._request("GET", f"/jobs/{_q(job_id)}", timeout=request_timeout)
            state = job["state"]
            if state in TERMINAL:
                return job
            remaining = deadline - time.monotonic()
            if remaining > 0:
                time.sleep(min(poll, remaining))


_json = json


class MioClient(_Base):
    """One method per ``/api/v2`` operation.  Binary endpoints return ``bytes``."""
