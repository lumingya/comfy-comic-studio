"""Export image processing — the legacy「图片处理」profiles.

* ``clean``   无损清洗: the original file with its embedded workflow / prompt / EXIF metadata removed at
  the container level; pixels, resolution and encoding are untouched.
* ``publish`` 轻量发布: metadata dropped and re-encoded as high-quality WebP, long side ≤ 2560 px.
* ``archive`` 无损归档: the original bytes as they are, embedded ComfyUI workflow included (local backup
  only — never hand these out).
* ``auto``    自动: ``clean``; a single-file HTML whose inlined images exceed the 512 MiB budget is redone
  as ``publish`` (the caller decides — see :func:`over_budget`).
* ``preview`` the fast in-app preview encoding (JPEG, capped width); not offered to users.

A lettered panel is cropped from the composited strip, so it has no original file: ``clean`` /
``archive`` store it as lossless PNG and ``publish`` as WebP.
"""

from __future__ import annotations

import io
import struct
from dataclasses import dataclass, field
from typing import Literal

from PIL import Image

Profile = Literal["auto", "clean", "publish", "archive", "preview"]
PROFILES: tuple[str, ...] = ("auto", "clean", "publish", "archive")
INLINE_BUDGET = 512 * 1024 * 1024
PUBLISH_MAX_SIDE = 2560
PUBLISH_QUALITY = 86

_PNG_SIG = b"\x89PNG\r\n\x1a\n"
# Ancillary PNG chunks that carry text / metadata (ComfyUI stores its workflow in tEXt "prompt"/"workflow").
_PNG_DROP = {b"tEXt", b"iTXt", b"zTXt", b"eXIf", b"tIME"}


@dataclass
class Stats:
    """What the processing did, reported back to the user after an export."""

    profile: str
    count: int = 0
    scrubbed: int = 0
    recompressed: int = 0
    original_bytes: int = 0
    output_bytes: int = 0
    auto_compressed: bool = False
    over_budget: bool = False
    notes: list[str] = field(default_factory=list)

    def header(self) -> str:
        """ASCII-only JSON for the ``X-Mio-Export`` response header."""
        import json

        return json.dumps(
            {
                "profile": self.profile,
                "count": self.count,
                "scrubbed": self.scrubbed,
                "recompressed": self.recompressed,
                "original_bytes": self.original_bytes,
                "output_bytes": self.output_bytes,
                "auto_compressed": self.auto_compressed,
                "over_budget": self.over_budget,
            },
            separators=(",", ":"),
        )


def mime_of(data: bytes) -> str:
    if data.startswith(_PNG_SIG):
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "application/octet-stream"


def ext_of(mime: str) -> str:
    return {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}.get(
        mime, "bin"
    )


def _scrub_png(data: bytes) -> bytes:
    out, i = [_PNG_SIG], len(_PNG_SIG)
    while i + 8 <= len(data):
        (length,) = struct.unpack(">I", data[i : i + 4])
        kind = data[i + 4 : i + 8]
        end = i + 12 + length
        if end > len(data):
            return data  # truncated / unexpected: keep the file as it is
        if kind not in _PNG_DROP:
            out.append(data[i:end])
        i = end
        if kind == b"IEND":
            break
    return b"".join(out)


def _scrub_jpeg(data: bytes) -> bytes:
    # Drop APP1 (EXIF / XMP), APP13 (Photoshop / IPTC) and COM; keep JFIF, ICC (APP2) and Adobe (APP14).
    out, i = [data[:2]], 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker = data[i + 1]
        if marker == 0xDA:  # start of scan: the rest is entropy-coded image data
            out.append(data[i:])
            return b"".join(out)
        (length,) = struct.unpack(">H", data[i + 2 : i + 4])
        seg = data[i : i + 2 + length]
        if marker not in (0xE1, 0xED, 0xFE):
            out.append(seg)
        i += 2 + length
    return data


def _scrub_webp(data: bytes) -> bytes:
    chunks, i = [], 12
    while i + 8 <= len(data):
        kind = data[i : i + 4]
        (size,) = struct.unpack("<I", data[i + 4 : i + 8])
        end = i + 8 + size + (size & 1)
        if end > len(data):
            return data
        if kind not in (b"EXIF", b"XMP "):
            chunk = bytearray(data[i:end])
            if kind == b"VP8X":
                chunk[8] &= ~(0x08 | 0x04) & 0xFF  # clear the EXIF / XMP flags
            chunks.append(bytes(chunk))
        i = end
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def scrub(data: bytes) -> bytes:
    """Remove embedded metadata without touching pixels (container rewrite, no decode)."""
    mime = mime_of(data)
    try:
        if mime == "image/png":
            return _scrub_png(data)
        if mime == "image/jpeg":
            return _scrub_jpeg(data)
        if mime == "image/webp":
            return _scrub_webp(data)
    except (struct.error, IndexError):
        pass
    return data


def _encode(im: Image.Image, fmt: str, **kw) -> bytes:
    buf = io.BytesIO()
    if fmt in ("JPEG", "WEBP") and im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    im.save(buf, fmt, **kw)
    return buf.getvalue()


def publish(im: Image.Image, max_side: int = PUBLISH_MAX_SIDE) -> bytes:
    long_side = max(im.size)
    if long_side > max_side:
        k = max_side / long_side
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    return _encode(im, "WEBP", quality=PUBLISH_QUALITY, method=4)


def preview(im: Image.Image, max_width: int, quality: int = 86) -> bytes:
    im = im.convert("RGB")
    if max_width and im.width > max_width:
        im = im.resize((max_width, round(im.height * max_width / im.width)), Image.LANCZOS)
    return _encode(im, "JPEG", quality=quality, optimize=True)


def process(
    profile: str,
    *,
    original: bytes | None,
    image: Image.Image,
    stats: Stats,
    max_width: int = 1400,
) -> tuple[bytes, str]:
    """Encode one panel for ``profile`` (``auto`` means ``clean`` here); returns ``(bytes, mime)``."""
    if original is not None:
        stats.original_bytes += len(original)
    stats.count += 1
    if profile == "preview":
        data, mime = preview(image, max_width), "image/jpeg"
    elif profile == "publish":
        data, mime = publish(image), "image/webp"
        stats.recompressed += 1
    elif original is None:
        data, mime = _encode(image, "PNG", optimize=True), "image/png"
    elif profile == "archive":
        data, mime = original, mime_of(original)
    else:  # clean / auto
        data = scrub(original)
        mime = mime_of(data)
        if len(data) != len(original):
            stats.scrubbed += 1
    stats.output_bytes += len(data)
    return data, mime


def over_budget(stats: Stats) -> bool:
    # Inlined as base64: 4/3 of the raw size.
    return stats.output_bytes * 4 // 3 > INLINE_BUDGET
