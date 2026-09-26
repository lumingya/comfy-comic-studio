from __future__ import annotations

import json
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

    def _request(self, method: str, path: str, *, params=None, json=None, content=None) -> Any:
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
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw, ctype = resp.read(), resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                err = _json.loads(raw)
                raise MioError(exc.code, err.get("kind", "error"), str(err.get("detail"))) from None
            except ValueError:
                raise MioError(exc.code, "error", raw[:300].decode("utf-8", "replace")) from None
        if not raw:
            return None
        return _json.loads(raw) if "json" in ctype else raw

    # ---------------------------------------------------------------- helpers
    def wait_job(self, job_id: str, timeout: float = 1800, poll: float = 2.0) -> dict:
        """Poll until the job reaches completed / failed / canceled; returns the job."""
        deadline = time.monotonic() + timeout
        while True:
            job = self._request("GET", f"/jobs/{_q(job_id)}")
            if job["state"] in TERMINAL:
                return job
            if time.monotonic() > deadline:
                raise TimeoutError(f"job {job_id} still {job['state']} after {timeout:.0f}s")
            time.sleep(poll)


_json = json


class MioClient(_Base):
    """One method per ``/api/v2`` operation.  Binary endpoints return ``bytes``."""
