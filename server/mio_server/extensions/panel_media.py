"""Spool declared binary operations without granting panels a URL or HTTP client."""

from __future__ import annotations

import asyncio
import json
import re
import tempfile
import warnings
from email.message import Message
from urllib.parse import quote, unquote

import httpx
from fastapi import HTTPException
from PIL import Image
from starlette.responses import JSONResponse, StreamingResponse

from .protocol import MAX_DOWNLOAD_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_RESPONSE_BYTES

IMAGE_TYPES = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP", "image/gif": "GIF"}
DOWNLOAD_TYPES = {
    *IMAGE_TYPES,
    "application/pdf",
    "application/zip",
    "application/octet-stream",
    "application/json",
    "text/html",
    "text/plain",
    "video/mp4",
    "video/webm",
}


class MediaRejected(Exception):
    def __init__(self, status: int, detail: str):
        self.status, self.detail = status, detail


class _MediaResponse(StreamingResponse):
    def __init__(self, content, *, close, **kwargs):
        super().__init__(content, **kwargs)
        self._close = close

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            # ASGI 2.4 send failures skip Starlette's background task. Own cleanup
            # here even when response headers fail before the iterator is started.
            self._close()


def safe_filename(disposition: str, mime: str) -> str:
    header = Message()
    header["content-disposition"] = disposition
    name = header.get_filename() or "mio-download"
    name = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', "_", name).strip(". ")[:180]
    if not name or name.split(".")[0].upper() in {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }:
        name = "mio-download"
    # Executable/server-selected suffixes do not turn a permitted response into an executable.
    suffix = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "application/pdf": ".pdf",
        "application/zip": ".zip",
        "application/json": ".json",
        "text/html": ".html",
        "text/plain": ".txt",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
    }.get(mime, ".bin")
    if not name.lower().endswith(suffix):
        name += suffix
    return name


def verify_image(output, mime):
    try:
        output.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(output) as image:
                if image.format != IMAGE_TYPES[mime]:
                    raise ValueError("image type does not match its content")
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ValueError("panel image exceeds the pixel limit")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("panel images must be still images")
                image.verify()
            output.seek(0)
            with Image.open(output) as image:
                image.load()
    except (
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ) as exc:
        raise HTTPException(415, "panel image is invalid or exceeds the pixel limit") from exc
    finally:
        output.seek(0)


async def dispatch_media(request, spec, path, body, validate, still_active, release):
    """Invoke the same ASGI operation, enforcing bounds while bytes are written to disk.

    Using ASGI directly avoids ASGITransport's full-response buffering, including when a
    producer lies about Content-Length. No target headers or paths come from the panel.
    """
    output = tempfile.TemporaryFile()
    closed = False

    def close():
        nonlocal closed
        if not closed:
            closed = True
            try:
                output.close()
            finally:
                release()

    total = 0
    response_status = 0
    mime = ""
    disposition = ""
    expected = None
    finished = False
    payload = json.dumps(body.body, ensure_ascii=False, allow_nan=False).encode("utf-8")
    headers = [(b"content-type", b"application/json"), (b"host", b"127.0.0.1")]
    if credential := request.headers.get("authorization"):
        headers.append((b"authorization", credential.encode("latin-1")))
    consumed = False

    async def receive():
        nonlocal consumed
        if not consumed:
            consumed = True
            return {"type": "http.request", "body": payload, "more_body": False}
        await asyncio.Future()

    async def send(message):
        nonlocal total, response_status, mime, disposition, expected, finished
        if message["type"] == "http.response.start":
            response_status = message["status"]
            values = dict(message.get("headers", []))
            mime = values.get(b"content-type", b"").decode("latin-1").split(";", 1)[0].lower()
            if 300 <= response_status < 400:
                raise MediaRejected(415, "panel binary requests do not follow redirects")
            if values.get(b"content-encoding", b"identity") != b"identity":
                raise MediaRejected(415, "panel binary responses cannot be content-encoded")
            allowed = IMAGE_TYPES if spec.response == "image" else DOWNLOAD_TYPES
            if response_status < 400 and mime not in allowed:
                raise MediaRejected(415, "response type does not match the panel declaration")
            if response_status >= 400 and mime != "application/json":
                raise MediaRejected(415, "panel operation did not return a JSON error")
            disposition = values.get(b"content-disposition", b"").decode("latin-1")
            if raw_length := values.get(b"content-length"):
                try:
                    expected = int(raw_length)
                    if expected < 0:
                        raise ValueError
                except ValueError:
                    raise MediaRejected(415, "invalid panel response length") from None
                if expected > limit():
                    raise MediaRejected(413, "panel binary response exceeds its byte limit")
        elif message["type"] == "http.response.body":
            if not response_status or finished:
                raise MediaRejected(415, "invalid panel response stream")
            chunk = message.get("body", b"")
            total += len(chunk)
            if total > limit():
                raise MediaRejected(413, "panel binary response exceeds its byte limit")
            output.write(chunk)
            finished = not message.get("more_body", False)

    def limit():
        if response_status >= 400:
            return MAX_RESPONSE_BYTES
        return MAX_IMAGE_BYTES if spec.response == "image" else MAX_DOWNLOAD_BYTES

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": spec.method,
        "scheme": "http",
        "path": unquote(path, encoding="utf-8", errors="strict"),
        "raw_path": path.encode("ascii"),
        "root_path": "",
        "query_string": str(httpx.QueryParams(body.query)).encode("ascii"),
        "headers": headers,
        "server": ("127.0.0.1", 80),
        "client": ("127.0.0.1", 0),
    }
    try:
        async with asyncio.timeout(30):
            await request.app(scope, receive, send)
        if not finished or (expected is not None and expected != total):
            raise HTTPException(415, "incomplete panel response stream")
        validate()
        output.seek(0)
        if response_status >= 400:
            try:
                error = json.load(output)
            except (ValueError, UnicodeError):
                raise HTTPException(415, "panel operation error is not valid JSON") from None
            close()
            return JSONResponse(error, status_code=response_status)
        if spec.response == "image":
            verify_image(output, mime)
        filename = safe_filename(disposition, mime)

        def chunks():
            while chunk := output.read(64 * 1024):
                if not still_active():
                    return
                yield chunk

        return _MediaResponse(
            chunks(),
            close=close,
            media_type=mime,
            headers={
                "Content-Length": str(total),
                "Content-Disposition": "attachment; filename*=UTF-8''" + quote(filename),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "X-Mio-Panel-Response": spec.response,
            },
        )
    except MediaRejected as exc:
        close()
        raise HTTPException(exc.status, exc.detail) from None
    except TimeoutError:
        close()
        raise HTTPException(
            504, "panel binary operation timed out; check before retrying"
        ) from None
    except BaseException:
        close()
        raise
