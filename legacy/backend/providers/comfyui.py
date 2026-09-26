from backend.providers.reliability import ExecutionError, failure_summary, retry_delay

"""Server-side ComfyUI transport: upload -> submit once -> poll -> persist."""
import json
import time
import uuid
import urllib.parse
import urllib.request
import urllib.error


class ResultUnconfirmed(InterruptedError):
    def __init__(self, prompt_id, status):
        self.rate_limited = status == 429
        super().__init__(
            f"ComfyUI 任务 {prompt_id} 已提交，但读取结果遇到 HTTP {status}。请先核对上游历史；不会重新提交生成。"
        )


def _generate(payload, host):
    config = payload["config"]
    base = config.get("baseUrl", "").rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid ComfyUI URL")
    workflow = json.loads(json.dumps(payload.get("workflow", {})))
    if not workflow or not isinstance(workflow, dict):
        raise ValueError("ComfyUI requires an API workflow")

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None

    from backend.providers.transport import opener as cancelable_opener

    opener = cancelable_opener(payload, NoRedirect)
    timeout = payload.get("_requestTimeout", 600)
    deadline = time.monotonic() + timeout
    # Queue time is not render time: while ComfyUI still lists the prompt as
    # pending, the deadline keeps sliding (bounded by hard_deadline) so a busy
    # GPU does not turn a finished render into a "timeout" we then redo.
    hard_deadline = time.monotonic() + max(timeout * 4, 3600)
    queue_checked_at = 0.0

    def request_once(path, data=None, content_type="application/json", persist=False):
        if payload.get("_isCanceled", lambda: False)():
            raise InterruptedError("Stopped locally; output discarded")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("ComfyUI configured timeout reached; result unconfirmed")
        try:
            with opener.open(
                urllib.request.Request(
                    base + path, data=data, headers={"Content-Type": content_type}
                ),
                timeout=min(remaining, payload.get("_requestTimeout", 300)),
            ) as response:
                if persist:
                    return host.store_image_stream(response)
                raw = host.read_limited_response(response)
                if path == "/prompt" and payload.get("_onResponse"):
                    payload["_onResponse"](getattr(response, "status", 200))
                return raw
        except urllib.error.HTTPError as exc:
            error = host.ProviderHTTPError(
                exc.code, host.read_limited_response(exc, 2 * 1024 * 1024)
            )
            error.headers = dict(exc.headers)
            raise error from None

    def request(path, data=None, content_type="application/json", persist=False):
        for attempt in range(6):
            try:
                return request_once(path, data, content_type, persist)
            except host.ProviderHTTPError as exc:
                status = getattr(exc, "status", None)
                if not prompt_id or data is not None or not status:
                    raise
                # Poll/view failures must never bubble up as a fresh /prompt retry.
                if status != 429 or attempt == 5:
                    raise ResultUnconfirmed(prompt_id, status) from exc
                delay = retry_delay(getattr(exc, "headers", {}), attempt + 1)
                if payload.get("_onRateLimit"):
                    payload["_onRateLimit"](
                        {
                            "until": time.time() + delay,
                            "attempt": attempt + 1,
                            "phase": "read_result",
                        }
                    )
                until = min(deadline, time.monotonic() + delay)
                while time.monotonic() < until:
                    if payload.get("_isCanceled", lambda: False)():
                        raise InterruptedError("已取消限流等待")
                    time.sleep(max(0, min(0.1, until - time.monotonic())))
                if payload.get("_onRateLimit"):
                    payload["_onRateLimit"](None)
                if time.monotonic() >= deadline:
                    raise ResultUnconfirmed(prompt_id, 429) from exc

    prompt_id = payload.get("_resumePromptId")
    if not prompt_id:
        inputs = payload.get("images", [])
        if not isinstance(inputs, list) or len(inputs) > 32:
            raise ValueError("At most 32 ComfyUI image inputs")
        raw_inputs = [host.provider_image_input(src) for src in inputs]
        if sum(len(raw) for _, raw in raw_inputs) > host.MAX_IMAGE_BYTES:
            raise ValueError("Combined inputs exceed 50 MiB")

        def replace(value, token, filename):
            if isinstance(value, dict):
                return {k: replace(v, token, filename) for k, v in value.items()}
            if isinstance(value, list):
                return [replace(v, token, filename) for v in value]
            return filename if value == token else value

        for i, (_, raw) in enumerate(raw_inputs):
            token = "mio-image://" + str(i + 1)
            if token not in json.dumps(workflow):
                raise ValueError("Unbound image " + str(i + 1))
            if payload.get("_isCanceled", lambda: False)():
                raise InterruptedError("Stopped locally; output discarded")
            mime = host.detect_image_mime_type(raw)
            ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[
                mime
            ]
            boundary = "mio" + uuid.uuid4().hex
            data = (
                (
                    f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{uuid.uuid4().hex}{ext}"\r\nContent-Type: {mime}\r\n\r\n'
                ).encode()
                + raw
                + f"\r\n--{boundary}--\r\n".encode()
            )
            uploaded = json.loads(
                request(
                    "/upload/image", data, "multipart/form-data; boundary=" + boundary
                )
            )
            if not uploaded.get("name"):
                raise ValueError("ComfyUI upload returned no filename")
            workflow = replace(
                workflow,
                token,
                (uploaded.get("subfolder", "") + "/").lstrip("/") + uploaded["name"],
            )
        if payload.get("_onRequest"):
            from backend.providers.request_evidence import safe_request

            payload["_onRequest"](safe_request({"workflow": workflow}))
        submitted = json.loads(
            request(
                "/prompt",
                json.dumps(
                    {"prompt": workflow, "client_id": uuid.uuid4().hex}
                ).encode(),
            )
        )
        prompt_id = submitted.get("prompt_id")
        if not prompt_id:
            raise ValueError("ComfyUI rejected workflow: " + json.dumps(submitted))
        if payload.get("_checkpoint"):
            payload["_checkpoint"](prompt_id)
    def still_queued():
        """True when ComfyUI reports the prompt as waiting behind other jobs."""
        try:
            queue = json.loads(request("/queue"))
        except (ValueError, TypeError, host.ProviderHTTPError, InterruptedError):
            return False
        pending = queue.get("queue_pending") if isinstance(queue, dict) else None
        return any(
            isinstance(entry, list) and len(entry) > 1 and entry[1] == prompt_id
            for entry in (pending or [])
        )

    while time.monotonic() < deadline:
        history = json.loads(
            request("/history/" + urllib.parse.quote(prompt_id, safe=""))
        ).get(prompt_id)
        if not history:
            now = time.monotonic()
            if (
                deadline - now < timeout * 0.5
                and now - queue_checked_at >= 5
                and now < hard_deadline
            ):
                queue_checked_at = now
                if still_queued():
                    deadline = min(hard_deadline, now + timeout)
            time.sleep(1)
            continue
        if history.get("status", {}).get("status_str") == "error":
            raise ExecutionError(failure_summary(json.dumps(history["status"])))
        outputs = history.get("outputs", {})
        node = config.get("outputNodeId")
        records = (
            outputs.get(node, {}).get("images", [])
            if node
            else [im for output in outputs.values() for im in output.get("images", [])]
        )
        if len(records) > 32:
            raise ValueError("Too many ComfyUI outputs")
        artifacts = []
        total = 0
        for image in records:
            stored = request(
                "/view?"
                + urllib.parse.urlencode(
                    {k: image.get(k, "") for k in ("filename", "subfolder", "type")}
                ),
                persist=True,
            )
            total += stored["bytes"]
            if total > host.MAX_IMAGE_BYTES:
                raise ValueError("Combined outputs exceed 50 MiB")
            url, mime = stored["url"], stored["mime"]
            if mime not in ("image/png", "image/jpeg", "image/webp"):
                raise ValueError("Unsupported output format")
            artifacts.append(
                {"kind": "image", "url": url, "mime": mime, "bytes": stored["bytes"]}
            )
        if artifacts:
            return {
                "image": artifacts[0]["url"],
                "artifacts": artifacts,
                "provider": "comfyui",
                "promptId": prompt_id,
                "offlineFallback": False,
            }
        if history.get("status", {}).get("completed"):
            raise ValueError("ComfyUI completed without images")
        time.sleep(1)
    raise TimeoutError(
        "ComfyUI result not confirmed; inspect upstream history before resubmitting"
    )


def generate(payload, host):
    import threading
    from backend.providers.comfy_cancel import cancel_prompt

    payload = dict(payload)
    done = threading.Event()
    gate = threading.Lock()
    current = {
        "id": payload.get("_resumePromptId"),
        "cancelled": False,
        "socket": None,
        "thread_ident": None,
        "noIdReported": False,
    }
    checkpoint = payload.get("_checkpoint")
    forward_socket = payload.get("_onSocket")
    from backend.providers.transport import close_socket

    def register_socket(sock, thread_ident=None):
        current["socket"] = sock
        current["thread_ident"] = thread_ident or threading.get_ident()
        if forward_socket:
            try:
                forward_socket(sock, current["thread_ident"])
            except TypeError:
                forward_socket(sock)
        if payload.get("_isCanceled", lambda: False)():
            close_socket(sock, current["thread_ident"])

    payload["_onSocket"] = register_socket

    def remember(prompt_id):
        current["id"] = prompt_id
        if checkpoint:
            checkpoint(prompt_id)

    payload["_checkpoint"] = remember

    def interrupt():
        with gate:
            if current["cancelled"]:
                return
            if not current["id"]:
                if not current["noIdReported"] and payload.get("_onCancelResult"):
                    payload["_onCancelResult"](
                        {
                            "state": "unconfirmed",
                            "message": "取消时尚未收到上游任务 ID，无法确认是否已接单；请在 ComfyUI 核对，不会盲目中断共享实例。",
                        }
                    )
                current["noIdReported"] = True
                return
            current["cancelled"] = True
        try:
            report = cancel_prompt(payload["config"]["baseUrl"], current["id"])
        except Exception as exc:
            report = {
                "state": "unconfirmed",
                "message": "上游中断未确认，请在 ComfyUI 核对。" + str(exc)[:200],
            }
        if payload.get("_onCancelResult"):
            payload["_onCancelResult"](report)

    def watch():
        while not done.wait(0.1):
            if payload.get("_isCanceled", lambda: False)():
                try:
                    interrupt()
                finally:
                    if current["socket"]:
                        close_socket(current["socket"], current["thread_ident"])
                return

    worker = threading.Thread(target=watch, daemon=True, name="comfy-cancellation")
    worker.start()
    try:
        return _generate(payload, host)
    finally:
        if payload.get("_isCanceled", lambda: False)():
            interrupt()
        done.set()
        worker.join(timeout=11)
