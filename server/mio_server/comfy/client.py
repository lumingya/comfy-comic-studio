"""ComfyUI HTTP + WebSocket runner.

``ComfyClient.run(graph)`` submits a prompt, follows ``/ws`` for progress, per-node timing and
preview frames, then collects output images from ``/history``. If the WebSocket cannot be
opened it falls back to polling, so a run never depends on live previews.
"""

from __future__ import annotations

import json
import socket
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field

from .ws import WebSocket, WebSocketError

PREVIEW_IMAGE = 1
PREVIEW_IMAGE_WITH_METADATA = 4
IMAGE_TYPES = {1: "jpeg", 2: "png", 3: "webp"}


class ComfyError(RuntimeError):
    """Structured failure: only rejection/execution errors prove no usable result exists."""

    def __init__(
        self, message: str, detail=None, *, kind: str = "unknown", status: int | None = None
    ):
        super().__init__(message)
        self.detail = detail
        self.kind = kind
        self.status = status


@dataclass
class OutputImage:
    node: str
    filename: str
    subfolder: str
    type: str
    data: bytes = b""


@dataclass
class RunResult:
    prompt_id: str
    images: list[OutputImage]
    elapsed: float
    node_seconds: dict[str, float] = field(default_factory=dict)
    cached: list[str] = field(default_factory=list)
    previews: int = 0
    texts: dict[str, list[str]] = field(default_factory=dict)  # e.g. ShowText outputs
    live: bool = True  # False when the run fell back to polling


class ComfyClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8188", timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.client_id = uuid.uuid4().hex

    # ------------------------------------------------------------------ HTTP
    def _request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict | None = None,
        timeout: float | None = None,
    ) -> bytes:
        req = urllib.request.Request(
            self.base_url + path, data=body, method=method, headers=headers or {}
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            try:
                detail = json.loads(detail)
            except ValueError:
                pass
            raise ComfyError(
                f"ComfyUI {method} {path} 返回 {exc.code}", detail, kind="http", status=exc.code
            ) from None
        except urllib.error.URLError as exc:
            kind = (
                "unreachable"
                if isinstance(exc.reason, (ConnectionRefusedError, socket.gaierror))
                else "connection_lost"
            )
            raise ComfyError(
                f"连不上 ComfyUI（{self.base_url}）：{exc.reason}", kind=kind
            ) from None
        except OSError as exc:
            raise ComfyError(f"ComfyUI 连接中断：{exc}", kind="connection_lost") from None

    def get_json(self, path: str, timeout: float | None = None):
        return json.loads(self._request("GET", path, timeout=timeout))

    def post_json(self, path: str, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        raw = self._request("POST", path, body, {"Content-Type": "application/json"})
        return json.loads(raw) if raw.strip() else {}

    def system_stats(self) -> dict:
        return self.get_json("/system_stats")

    def object_info(self, node_class: str | None = None) -> dict:
        path = "/object_info" + (f"/{urllib.parse.quote(node_class)}" if node_class else "")
        return self.get_json(path, timeout=120)

    def upload_image(self, data: bytes, filename: str, subfolder: str = "mio") -> str:
        """Upload into ComfyUI's input folder; returns the value a LoadImage node expects."""
        boundary = "----mio" + uuid.uuid4().hex
        parts = []
        for name, value in (("overwrite", "true"), ("type", "input"), ("subfolder", subfolder)):
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
            )
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n".encode()
            + data
            + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode())
        raw = self._request(
            "POST",
            "/upload/image",
            b"".join(parts),
            {"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        info = json.loads(raw)
        return f"{info['subfolder']}/{info['name']}" if info.get("subfolder") else info["name"]

    def queue_prompt(self, graph: dict) -> str:
        try:
            result = self.post_json("/prompt", {"prompt": graph, "client_id": self.client_id})
        except ComfyError as exc:
            rejected = (
                exc.status is not None and 400 <= exc.status < 500 and exc.status not in (408, 429)
            )
            raise ComfyError(
                describe_prompt_error(exc.detail) or str(exc),
                exc.detail,
                kind="rejected" if rejected else exc.kind,
                status=exc.status,
            ) from None
        return result["prompt_id"]

    def history(self, prompt_id: str) -> dict:
        history = self.get_json(f"/history/{urllib.parse.quote(prompt_id, safe='')}")
        if not isinstance(history, dict):
            raise ComfyError("ComfyUI history 响应格式无效", kind="invalid_response")
        entry = history.get(prompt_id, {})
        if not isinstance(entry, dict) or (
            "status" in entry and not isinstance(entry["status"], dict)
        ):
            raise ComfyError("ComfyUI history 条目格式无效", kind="invalid_response")
        return entry

    def queue_status(self) -> dict:
        """A validated queue snapshot; malformed responses never prove the instance is idle."""
        queue = self.get_json("/queue")
        if not isinstance(queue, dict):
            raise ComfyError("ComfyUI queue 响应格式无效", kind="invalid_response")
        for name in ("queue_running", "queue_pending"):
            entries = queue.get(name)
            if not isinstance(entries, list) or any(
                not isinstance(entry, list)
                or len(entry) < 2
                or not isinstance(entry[1], str)
                or not entry[1].strip()
                for entry in entries
            ):
                raise ComfyError(f"ComfyUI {name} 格式无效", kind="invalid_response")
        return queue

    def execution_state(self, prompt_id: str) -> tuple[str, dict]:
        """Return active/terminal_success/terminal_error/unknown with any history evidence.

        Queue membership wins over history. Empty queue/history and outputs alone never prove
        terminal execution, so callers can safely retain state until a later reconciliation.
        """
        if not isinstance(prompt_id, str) or not prompt_id.strip():
            return "unknown", {}
        queue = self.queue_status()
        if any(
            entry[1] == prompt_id
            for name in ("queue_running", "queue_pending")
            for entry in queue[name]
        ):
            return "active", {}
        entry = self.history(prompt_id)
        return _history_state(entry), entry

    def view(self, filename: str, subfolder: str, kind: str) -> bytes:
        query = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": kind})
        return self._request("GET", f"/view?{query}", timeout=120)

    def interrupt(self) -> None:
        try:
            self._request("POST", "/interrupt", b"{}", {"Content-Type": "application/json"})
        except ComfyError:
            pass

    # ------------------------------------------------------------------- run
    def delete_queued(self, prompt_id: str) -> None:
        """Remove a prompt that has not started yet (immediate stop of queued work)."""
        try:
            self.post_json("/queue", {"delete": [prompt_id]})
        except ComfyError:
            pass

    def run(
        self,
        graph: dict,
        output_nodes=None,
        on_event=None,
        timeout: float = 900.0,
        on_queued=None,
        cancelled=None,
    ) -> RunResult:
        """Execute ``graph`` and return its images (only ``output_nodes`` if given).

        ``on_queued(prompt_id)`` fires right after ComfyUI accepted the prompt (the job engine
        records it for reconcile); ``cancelled()`` is polled while following progress.
        """
        emit = on_event or (lambda event: None)
        self._cancelled = cancelled or (lambda: False)
        started = time.monotonic()
        ws = None
        try:
            ws_url = "ws" + self.base_url[4:] + f"/ws?clientId={self.client_id}"
            ws = WebSocket(ws_url, timeout=10)
        except (OSError, WebSocketError) as exc:
            emit({"type": "warning", "message": f"WebSocket 不可用，改为轮询：{exc}"})
        try:
            prompt_id = self.queue_prompt(graph)
            emit({"type": "queued", "prompt_id": prompt_id})
            if on_queued:
                on_queued(prompt_id)
        except Exception:
            if ws:
                ws.close()
            raise
        node_seconds: dict[str, float] = {}
        cached: list[str] = []
        previews = 0
        try:
            if ws:
                previews = self._follow(ws, prompt_id, started, timeout, node_seconds, cached, emit)
            else:
                self._poll(prompt_id, started, timeout)
        except TimeoutError:
            raise ComfyError(
                f"等待出图超时（{timeout:.0f} 秒），请稍后核对执行结果", kind="timeout"
            ) from None
        finally:
            if ws:
                ws.close()
        entry = self._settled_history(prompt_id)
        images, texts = self.collect(entry, output_nodes)
        return RunResult(
            prompt_id,
            images,
            time.monotonic() - started,
            node_seconds,
            cached,
            previews,
            texts,
            live=ws is not None,
        )

    def collect(
        self, entry: dict, output_nodes=None
    ) -> tuple[list[OutputImage], dict[str, list[str]]]:
        """Images and text outputs of a finished history entry (also used to reconcile)."""
        status = entry.get("status") or {}
        if status.get("status_str") == "error":
            raise ComfyError("ComfyUI 执行失败", status.get("messages"), kind="execution_error")
        wanted = {str(n) for n in output_nodes} if output_nodes else None
        images, texts = [], {}
        for node_id, out in (entry.get("outputs") or {}).items():
            for key in ("text", "string"):
                if isinstance(out.get(key), list):
                    texts[node_id] = [str(t) for t in out[key]]
            if wanted is not None and node_id not in wanted:
                continue
            for img in out.get("images") or []:
                ref = OutputImage(
                    node_id, img["filename"], img.get("subfolder", ""), img.get("type", "output")
                )
                ref.data = self.view(ref.filename, ref.subfolder, ref.type)
                images.append(ref)
        return images, texts

    def _follow(self, ws, prompt_id, started, timeout, node_seconds, cached, emit) -> int:
        ws.settimeout(5)
        current, since, previews = None, time.monotonic(), 0
        while True:
            if time.monotonic() - started > timeout:
                raise TimeoutError
            if self._cancelled():
                raise ComfyError("出图已停止", kind="canceled")
            try:
                message = ws.recv()
            except TimeoutError:  # socket.timeout; partial frames stay buffered in ws
                continue
            except OSError as exc:
                emit({"type": "warning", "message": f"WebSocket 中断，改为轮询：{exc}"})
                self._poll(prompt_id, started, timeout)
                return previews
            if isinstance(message, bytes):
                previews += 1
                emit(parse_preview(message))
                continue
            event = json.loads(message)
            kind, data = event.get("type"), event.get("data") or {}
            if data.get("prompt_id") not in (None, prompt_id):
                continue
            if kind == "execution_cached":
                cached.extend(str(n) for n in data.get("nodes") or [])
            elif kind == "executing":
                now = time.monotonic()
                if current is not None:
                    node_seconds[current] = node_seconds.get(current, 0.0) + now - since
                current, since = data.get("node"), now
                if current is None and data.get("prompt_id") == prompt_id:
                    return previews
                emit({"type": "executing", "node": current})
            elif kind == "progress":
                emit(
                    {
                        "type": "progress",
                        "node": data.get("node"),
                        "value": data.get("value"),
                        "max": data.get("max"),
                    }
                )
            elif kind == "execution_error":
                raise ComfyError(
                    f"节点 {data.get('node_id')}（{data.get('node_type')}）出错：{data.get('exception_message', '').strip()}",
                    data,
                    kind="execution_error",
                )
            elif kind == "execution_interrupted":
                raise ComfyError("出图被中断", data, kind="execution_error")
            elif kind == "execution_success" and data.get("prompt_id") == prompt_id:
                if current is not None:
                    node_seconds[current] = (
                        node_seconds.get(current, 0.0) + time.monotonic() - since
                    )
                return previews

    def _settled_history(self, prompt_id: str, wait: float = 15.0) -> dict:
        """History entry once ComfyUI has stored it.

        ComfyUI sends ``execution_success`` before it writes ``/history`` (``executing: null``
        comes after), so an immediate read can come back empty. Poll briefly until it settles.
        """
        deadline = time.monotonic() + wait
        while True:
            entry = self.history(prompt_id)
            if _history_state(entry) != "unknown":
                return entry
            if time.monotonic() > deadline:
                raise ComfyError("ComfyUI 尚未保存执行结果，请稍后核对", kind="timeout")
            time.sleep(0.25)

    def _poll(self, prompt_id, started, timeout) -> None:
        while time.monotonic() - started <= timeout:
            if getattr(self, "_cancelled", lambda: False)():
                raise ComfyError("出图已停止", kind="canceled")
            state, _ = self.execution_state(prompt_id)
            if state in ("terminal_success", "terminal_error"):
                return
            time.sleep(1.0)
        raise TimeoutError


def _history_state(entry: dict) -> str:
    status = entry.get("status") or {}
    if status.get("status_str") == "error":
        return "terminal_error"
    if status.get("status_str") == "success" or status.get("completed") is True:
        return "terminal_success"
    return "unknown"


def parse_preview(message: bytes) -> dict:
    """Binary ``/ws`` frame: 4-byte event type, then (for previews) 4-byte image type + bytes."""
    if len(message) < 8:
        return {"type": "binary", "size": len(message)}
    event, image_type = struct.unpack(">II", message[:8])
    if event == PREVIEW_IMAGE:
        return {
            "type": "preview",
            "format": IMAGE_TYPES.get(image_type, "unknown"),
            "data": message[8:],
        }
    if event == PREVIEW_IMAGE_WITH_METADATA:
        (meta_len,) = struct.unpack(">I", message[4:8])
        meta = json.loads(message[8 : 8 + meta_len] or b"{}")
        return {
            "type": "preview",
            "format": (meta.get("image_type") or "image/png").split("/")[-1],
            "data": message[8 + meta_len :],
            "meta": meta,
        }
    return {"type": "binary", "event": event, "size": len(message)}


def describe_prompt_error(detail) -> str | None:
    """Turn ComfyUI's ``/prompt`` validation error into one readable line."""
    if not isinstance(detail, dict):
        return None
    lines = []
    err = detail.get("error") or {}
    if err.get("message"):
        lines.append(
            str(err["message"]) + (f"：{err.get('details')}" if err.get("details") else "")
        )
    for node_id, info in (detail.get("node_errors") or {}).items():
        for e in info.get("errors") or []:
            lines.append(
                f"节点 {node_id}（{info.get('class_type')}）：{e.get('message')} {e.get('details', '')}".strip()
            )
    return "；".join(lines) or None
