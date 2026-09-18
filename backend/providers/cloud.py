"""Cloud transport implementation. Host utilities are explicitly supplied at installation."""

import json, uuid, base64, time
import urllib.request, urllib.parse, urllib.error
from backend import mio_credentials


class ResultUnconfirmed(InterruptedError):
    def __init__(self, message="云端生成已成功，但读取结果遇到异常。请先核对上游历史；不会重新提交生成。"):
        self.rate_limited = True
        super().__init__(message)


def generate(payload, services):
    from backend.providers import extras as apply_provider_extras

    DATA_DIR = services.DATA_DIR
    MAX_IMAGE_BYTES = services.MAX_IMAGE_BYTES
    provider_image_input = services.provider_image_input
    detect_image_mime_type = services.detect_image_mime_type
    read_limited_response = services.read_limited_response
    ProviderHTTPError = services.ProviderHTTPError
    fetch_remote_image = services.fetch_remote_image
    store_image_bytes = services.store_image_bytes
    import io
    import zipfile
    import secrets

    config = payload.get("config") or {}
    provider = config.get("provider")
    if provider not in ("novelai", "openai"):
        raise ValueError("Unsupported image provider")
    _, base = mio_credentials.endpoint(config)
    model = str(config.get("model", "")).strip()
    prompt = str(payload.get("prompt", ""))
    if not model or not prompt.strip():
        raise ValueError("Model and prompt are required")
    source = payload.get("source")
    source_raw = None
    if source:
        source, source_raw = provider_image_input(source)
    image_values = payload.get("images", [])
    if not isinstance(image_values, list) or len(image_values) > 32:
        raise ValueError("images must be an ordered array of at most 32 image inputs")
    ordered_images = [provider_image_input(value) for value in image_values]
    if source_raw:
        ordered_images.append((source, source_raw))
    if sum(len(raw) for _, raw in ordered_images) > MAX_IMAGE_BYTES:
        raise ValueError("Combined image inputs exceed 50 MB")
    frame = payload.get("frame") or {}

    def number(name, default, low, high):
        value = float(frame.get(name, default))
        if not low <= value <= high:
            raise ValueError("Invalid parameter: " + name)
        return value

    negative = str(payload.get("negative", ""))
    headers = {"Content-Type": "application/json", "User-Agent": "Mio/1.0"}
    from backend.providers import build_request

    path, body = build_request(
        dict(
            config=config,
            model=model,
            prompt=prompt,
            negative=negative,
            number=number,
            source_raw=source_raw,
            ordered_images=ordered_images,
            image_values=image_values,
        )
    )
    applied = apply_provider_extras(
        config, body["parameters"] if provider == "novelai" else body
    )
    if provider == "openai" and ordered_images and config.get("protocol") != "chat":
        boundary = "ComicStudio" + uuid.uuid4().hex
        parts = []
        for name, value in body.items():
            parts.append(
                (
                    "----"
                    + boundary
                    + '\r\nContent-Disposition: form-data; name="'
                    + name
                    + '"\r\n\r\n'
                    + (
                        json.dumps(value, ensure_ascii=False)
                        if isinstance(value, (dict, list, bool))
                        else str(value)
                    )
                    + "\r\n"
                ).encode()
            )
        for index, (_, image_raw) in enumerate(ordered_images):
            mime = detect_image_mime_type(image_raw, "")
            ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
            field = "image[]" if len(ordered_images) > 1 else "image"
            parts.append(
                (
                    "----"
                    + boundary
                    + '\r\nContent-Disposition: form-data; name="'
                    + field
                    + '"; filename="image_'
                    + str(index + 1)
                    + "."
                    + ext
                    + '"\r\nContent-Type: '
                    + mime
                    + "\r\n\r\n"
                ).encode()
                + image_raw
                + b"\r\n"
            )
        parts.append(("----" + boundary + "--\r\n").encode())
        data = b"".join(parts)
        headers["Content-Type"] = "multipart/form-data; boundary=--" + boundary
    else:
        data = json.dumps(body).encode()

    key = mio_credentials.resolve(DATA_DIR, payload)
    if key and any(ord(char) < 33 or ord(char) > 126 for char in key):
        raise ValueError(
            "Credential contains invalid characters; use an ASCII token without whitespace"
        )
    if key:
        headers["Authorization"] = "Bearer " + key

    # Never forward Authorization to a redirect target or retry a paid generation.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    from backend.providers.transport import opener as cancelable_opener

    opener = cancelable_opener(payload, NoRedirect)
    if payload.get("_onRequest"):
        from backend.providers.request_evidence import safe_request

        payload["_onRequest"](safe_request(body, key))
    try:
        with opener.open(
            urllib.request.Request(base + path, data=data, headers=headers),
            timeout=payload.get("_requestTimeout", 300),
        ) as response:
            raw = read_limited_response(response)
            if payload.get("_onResponse"):
                payload["_onResponse"](getattr(response, "status", 200))
    except urllib.error.HTTPError as exc:
        raise ProviderHTTPError(
            exc.code,
            read_limited_response(exc, limit=2 * 1024 * 1024),
            key,
            headers=exc.headers,
        ) from None
    if payload.get("_isCanceled", lambda: False)():
        raise InterruptedError("Stopped locally; output discarded")
    decoded = []
    if provider == "novelai":
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = [
                entry
                for entry in archive.infolist()
                if entry.filename.lower().endswith((".png", ".jpg", ".webp"))
            ]
            if (
                not entries
                or len(entries) > 32
                or sum(entry.file_size for entry in entries) > MAX_IMAGE_BYTES
            ):
                raise ValueError(
                    "NovelAI returned no usable image or oversized outputs"
                )
            decoded = [archive.read(entry) for entry in entries]
    else:
        result = json.loads(raw)
        items = result.get("data") or []
        if config.get("protocol") == "chat":
            message = (result.get("choices") or [{}])[0].get("message") or {}
            from backend.providers.openai_chat import extract_images

            items = extract_images(message)
        if not items or len(items) > 32:
            raise ValueError(
                "Provider returned no image or too many outputs; text-only responses are not successful generations"
            )
        total = 0
        for item in items:
            if item.get("b64_json"):
                image_raw = base64.b64decode(item["b64_json"], validate=True)
            elif str(item.get("url", "")).startswith("data:image/"):
                image_raw = base64.b64decode(
                    item["url"].split(",", 1)[1], validate=True
                )
            elif item.get("url"):
                url = item["url"]
                fetch_kwargs = {}
                if "_requestTimeout" in payload:
                    fetch_kwargs["timeout"] = payload["_requestTimeout"]
                if payload.get("_onSocket"):
                    fetch_kwargs["on_socket"] = payload["_onSocket"]
                from backend.providers.reliability import retry_delay
                from backend.providers.request_evidence import sanitize_url

                image_raw = None
                for attempt in range(6):
                    if payload.get("_isCanceled", lambda: False)():
                        raise InterruptedError("Stopped locally; output discarded")
                    try:
                        image_raw, _ = fetch_remote_image(url, **fetch_kwargs)
                        break
                    except Exception as exc:
                        status = getattr(exc, "status", getattr(exc, "code", None))
                        if status != 429 or attempt == 5:
                            if status == 429:
                                safe_url = sanitize_url(url)
                                raise ResultUnconfirmed(
                                    f"云端生成已完成，但下载图片遇到 HTTP 429 限流；已就地重试耗尽，不会重新计费生成。URL: {safe_url}"
                                ) from exc
                            raise
                        headers = getattr(exc, "headers", {})
                        delay = retry_delay(headers, attempt + 1)
                        if payload.get("_onRateLimit"):
                            payload["_onRateLimit"](
                                {
                                    "until": time.time() + delay,
                                    "attempt": attempt + 1,
                                    "phase": "download_image",
                                }
                            )
                        deadline = time.monotonic() + delay
                        while time.monotonic() < deadline:
                            if payload.get("_isCanceled", lambda: False)():
                                raise InterruptedError("已取消限流等待")
                            time.sleep(max(0, min(0.1, deadline - time.monotonic())))
                        if payload.get("_onRateLimit"):
                            payload["_onRateLimit"](None)
            else:
                raise ValueError("Provider returned an unusable image entry")
            total += len(image_raw)
            if total > MAX_IMAGE_BYTES:
                raise ValueError("Combined generated images exceed 50 MiB")
            decoded.append(image_raw)
    validated = []
    for image_raw in decoded:
        if payload.get("_isCanceled", lambda: False)():
            raise InterruptedError("Stopped locally; output discarded")
        mime = detect_image_mime_type(image_raw, "")
        if mime not in ("image/png", "image/jpeg", "image/webp"):
            raise ValueError(
                "Provider must return PNG, JPEG or WebP, not active SVG or other content"
            )
        validated.append((image_raw, mime))
    artifacts = []
    for image_raw, mime in validated:
        url = store_image_bytes(image_raw, payload.get("albumId", "unassigned"))
        artifacts.append(
            {"kind": "image", "url": url, "mime": mime, "bytes": len(image_raw)}
        )
    return {
        "image": artifacts[0]["url"],
        "artifacts": artifacts,
        "offlineFallback": False,
        "provider": provider,
        "appliedExtraParams": applied,
    }
