from __future__ import annotations

import json
import math
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
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


def _multipart(files: list[tuple[str, tuple[str, bytes]]]) -> tuple[bytes, str]:
    """Encode repeated file fields; each entry is ``(field, (filename, bytes))``."""

    def quoted(value: str) -> str:
        if (
            not isinstance(value, str)
            or not value
            or any(ord(c) < 32 or ord(c) == 127 for c in value)
        ):
            raise ValueError("multipart names must be non-empty and contain no control characters")
        return value.replace("\\", "\\\\").replace('"', '\\"')

    boundary = "mio-" + secrets.token_hex(24)
    chunks = []
    for field, (filename, content) in files:
        name, filename = quoted(field), quoted(filename)
        if not isinstance(content, bytes):
            raise TypeError("multipart file content must be bytes")
        header = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
            f'filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'
        )
        chunks.extend((header.encode("utf-8"), content, b"\r\n"))
    chunks.append(f"--{boundary}--\r\n".encode("ascii"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


class _Base:
    def __init__(self, base_url: str = "http://127.0.0.1:8788", token: str = "", timeout=120.0):
        self.base = base_url.rstrip("/") + "/api/v2"
        self.token = token
        self.timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        *,
        params=None,
        json=None,
        content=None,
        files=None,
        timeout=None,
    ) -> Any:
        if sum(value is not None for value in (json, content, files)) > 1:
            raise ValueError("choose one request body: json, content or files")
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
        elif files is not None:
            data, headers["Content-Type"] = _multipart(files)
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
    def discover_studio(self, *, offset: int = 0, limit: int = 50) -> dict:
        """Fetch the resource catalogs needed to start a workshop task."""
        workflows = self.list_workflows()
        return {
            "storyboards": self.list_storyboards(offset=offset, limit=limit),
            "presets": self.list_presets(),
            "workflows": workflows,
            "workflow_loras": {row["id"]: self.workflow_loras(row["id"]) for row in workflows},
            "templates": self.list_album_templates(),
            "image_adapters": self.image_adapters(),
            "channels": self.list_image_channels(),
        }

    def generate_workshop_task(
        self, body: dict, *, idempotency_key: str, timeout: float = 1800, poll: float = 2
    ) -> dict:
        """Create and start a task, then wait for its job without automatically retrying it."""
        task = self.create_workshop_task(
            {**body, "auto_start": True, "idempotency_key": idempotency_key}
        )
        if task.get("job_id"):
            task["job"] = self.wait_job(task["job_id"], timeout=timeout, poll=poll)
        return task

    def save_episode_deliverable(
        self,
        episode_id: str,
        destination: str | Path,
        *,
        format: str = "html",
        template_id: str | None = None,
        variant_id: str | None = None,
        idempotency_key: str | None = None,
        timeout: float = 1800,
        poll: float = 2,
        background: bool = True,
    ) -> Path:
        """Export to a new local file. An existing destination raises FileExistsError."""
        path = Path(destination)
        if path.exists():
            raise FileExistsError(path)
        if format not in {"html", "pdf", "zip", "png"}:
            raise ValueError("format must be html, pdf, zip, or png")
        if template_id is not None and format != "html":
            raise ValueError("template_id is only supported for HTML export")
        if background:
            export = self.export_episode_deliverable(
                episode_id,
                {
                    "format": format,
                    "template_id": template_id,
                    "variant_id": variant_id,
                    "idempotency_key": idempotency_key,
                },
            )
            job_id = export["job_id"]
            job = self.wait_job(job_id, timeout=timeout, poll=poll)
            if job["state"] != "completed":
                raise MioError(409, "export_incomplete", f"job {job_id}: {job['state']}")
            data = self.download_export(job_id)
        else:
            status = self.get_episode_deliverables(episode_id, variant_id=variant_id)
            if not status["ready"]:
                raise MioError(409, "export_incomplete", "episode has unadopted panels")
            params = {"episode_ids": [episode_id], "variant_id": variant_id}
            if format == "html":
                if template_id is not None:
                    params["template_id"] = template_id
                data = self.export_album(params)
            elif format == "png":
                data = self.export_episode(episode_id, fmt="long", quality=0, variant_id=variant_id)
            else:
                data = self.export_portable({**params, "format": format})
        if not isinstance(data, bytes) or not data:
            raise MioError(502, "invalid_export", "export did not return file bytes")
        with path.open("xb") as output:
            output.write(data)
        return path

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
