"""Export-time image treatment shared by the ZIP / PDF exporters.

Three profiles, mirrored one-to-one by ``exportImageProfiles`` in js/ui-export.js:

``archive``
    Bytes are copied verbatim. ComfyUI writes the full workflow graph and the
    prompt into PNG ``tEXt`` chunks, so this profile is only meant for local,
    lossless backups.
``clean``
    Identical pixels, resolution and container: PNG text / EXIF chunks, JPEG
    APPn / COM segments and WebP EXIF / XMP chunks are removed by rewriting
    the container, never by re-encoding. A JPEG / PNG / WebP orientation tag is
    preserved through a minimal EXIF block so photos keep their rotation.
``publish``
    ``clean`` plus a high-quality re-encode (WebP for ZIP, JPEG for PDF) with a
    bounded long edge, for single-file distribution and phone reading. When the
    re-encode would not be smaller than the cleaned original, the cleaned
    original is kept so quality is never traded for nothing.

``auto`` is accepted for API symmetry with the browser: ZIP and PDF have no
inline budget, so it resolves to ``clean``.

Everything here is pure Python; Pillow is only imported for ``publish``.
"""

from __future__ import annotations

import io
import struct
from dataclasses import dataclass, field
from pathlib import Path

from backend.mio_library import LibraryError, image_type

PROFILES = ("auto", "archive", "clean", "publish")
DEFAULT_PROFILE = "auto"
PUBLISH_MAX_EDGE = 2560
PUBLISH_WEBP_QUALITY = 86
PUBLISH_JPEG_QUALITY = 88
PROFILE_LABELS = {
    "archive": "无损归档",
    "clean": "无损清洗",
    "publish": "轻量发布",
}

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_METADATA_CHUNKS = {b"tEXt", b"zTXt", b"iTXt", b"eXIf"}
_WEBP_KNOWN_CHUNKS = {b"VP8 ", b"VP8L", b"VP8X", b"ALPH", b"ANIM", b"ANMF", b"ICCP"}
_EXIF_ORIENTATION_TAG = 0x0112


def resolve_profile(value, default=DEFAULT_PROFILE):
    """Normalise a request value to archive / clean / publish, or raise 400."""
    if value is None or value == "":
        value = default
    if not isinstance(value, str) or value not in PROFILES:
        raise LibraryError("图片处理方式只支持 auto、archive、clean 或 publish")
    return "clean" if value == "auto" else value


@dataclass
class PreparedImage:
    data: bytes
    suffix: str
    mime: str
    original_size: int
    removed: list = field(default_factory=list)
    recompressed: bool = False

    @property
    def scrubbed(self):
        return bool(self.removed)


# --------------------------------------------------------------------------- EXIF helpers

def exif_orientation(tiff):
    """Return the IFD0 Orientation value (1–8) from a raw TIFF/EXIF block, else 1."""
    try:
        if tiff[:6] == b"Exif\x00\x00":
            tiff = tiff[6:]
        if tiff[:2] == b"MM":
            order = ">"
        elif tiff[:2] == b"II":
            order = "<"
        else:
            return 1
        if struct.unpack(order + "H", tiff[2:4])[0] != 42:
            return 1
        offset = struct.unpack(order + "I", tiff[4:8])[0]
        count = struct.unpack(order + "H", tiff[offset : offset + 2])[0]
        for index in range(count):
            entry = tiff[offset + 2 + index * 12 : offset + 14 + index * 12]
            tag, kind, _ = struct.unpack(order + "HHI", entry[:8])
            if tag == _EXIF_ORIENTATION_TAG and kind == 3:
                value = struct.unpack(order + "H", entry[8:10])[0]
                return value if 1 <= value <= 8 else 1
    except (struct.error, IndexError):
        pass
    return 1


def minimal_exif(orientation):
    """A TIFF block whose only tag is Orientation; nothing else survives cleaning."""
    return (
        b"MM\x00\x2a\x00\x00\x00\x08"
        + b"\x00\x01"
        + struct.pack(">HHIHH", _EXIF_ORIENTATION_TAG, 3, 1, orientation, 0)
        + b"\x00\x00\x00\x00"
    )


def is_minimal_exif(tiff):
    """True for the orientation-only block written by cleaning (kept, not reported)."""
    if tiff[:6] == b"Exif\x00\x00":
        tiff = tiff[6:]
    return any(tiff == minimal_exif(orientation) for orientation in range(2, 9))


# --------------------------------------------------------------------------- PNG

def _png_chunks(raw):
    """Yield (type, data) pairs; stop at IEND or at the first malformed chunk."""
    position = len(_PNG_SIGNATURE)
    total = len(raw)
    while position + 8 <= total:
        length = struct.unpack(">I", raw[position : position + 4])[0]
        kind = raw[position + 4 : position + 8]
        end = position + 12 + length
        if end > total:
            return
        yield kind, raw[position + 8 : position + 8 + length]
        position = end
        if kind == b"IEND":
            return


def _png_chunk(kind, data):
    import zlib

    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_metadata_keys(raw):
    keys = []
    for kind, data in _png_chunks(raw):
        if kind in (b"tEXt", b"zTXt", b"iTXt"):
            keyword = data.split(b"\x00", 1)[0].decode("latin-1", "replace")
            keys.append(kind.decode() + ":" + keyword)
        elif kind == b"eXIf" and not is_minimal_exif(data):
            keys.append("eXIf")
    return keys


def strip_png(raw):
    removed = png_metadata_keys(raw)
    if not removed:
        return raw, []
    orientation = 1
    out = [_PNG_SIGNATURE]
    complete = False
    for kind, data in _png_chunks(raw):
        if kind == b"eXIf":
            orientation = exif_orientation(data)
            continue
        if kind in _PNG_METADATA_CHUNKS:
            continue
        if kind == b"IDAT" and orientation != 1:
            out.append(_png_chunk(b"eXIf", minimal_exif(orientation)))
            orientation = 1
        out.append(_png_chunk(kind, data))
        if kind == b"IEND":
            complete = True
    if not complete:
        # Malformed tail: keep the readable prefix only, never guess at the rest.
        out.append(_png_chunk(b"IEND", b""))
    return b"".join(out), removed


# --------------------------------------------------------------------------- JPEG

def _jpeg_segments(raw):
    """Yield (marker, segment_bytes) including entropy-coded scans as marker 0xDA."""
    total = len(raw)
    position = 2  # SOI
    while position < total:
        if raw[position] != 0xFF:
            # Garbage between segments; emit it as opaque data so nothing is lost.
            end = raw.find(b"\xff", position)
            end = total if end < 0 else end
            yield None, raw[position:end]
            position = end
            continue
        while position < total and raw[position] == 0xFF:
            position += 1
        if position >= total:
            return
        marker = raw[position]
        start = position - 1
        position += 1
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            yield marker, raw[start:position]
            continue
        if marker == 0xD9:
            yield marker, raw[start:position]
            return
        if position + 2 > total:
            yield marker, raw[start:]
            return
        length = struct.unpack(">H", raw[position : position + 2])[0]
        end = min(total, position + max(length, 2))
        if marker == 0xDA:
            # Scan data continues until a marker that is neither stuffing nor RSTn.
            cursor = end
            while cursor + 1 < total:
                if raw[cursor] == 0xFF and raw[cursor + 1] != 0x00 and not 0xD0 <= raw[cursor + 1] <= 0xD7:
                    break
                cursor += 1
            else:
                cursor = total
            yield marker, raw[start:cursor]
            position = cursor
            continue
        yield marker, raw[start:end]
        position = end


def _jpeg_segment_payload(segment):
    return segment[4:]


def _jpeg_keep(marker, segment):
    if marker in (0xE1, 0xFE) or (0xE2 <= marker <= 0xEF):
        payload = _jpeg_segment_payload(segment)
        if marker == 0xE2 and payload.startswith(b"ICC_PROFILE\x00"):
            return True  # colour management, not metadata
        if marker == 0xEE and payload.startswith(b"Adobe"):
            return True  # colour transform flag; required for correct decoding
        if marker == 0xE1 and payload.startswith(b"Exif\x00\x00") and is_minimal_exif(payload):
            return True  # orientation-only block from an earlier cleaning pass
        return False
    return True


def jpeg_metadata_keys(raw):
    keys = []
    for marker, segment in _jpeg_segments(raw):
        if marker is None or _jpeg_keep(marker, segment):
            continue
        payload = _jpeg_segment_payload(segment)
        if marker == 0xFE:
            keys.append("COM")
        elif marker == 0xE1 and payload.startswith(b"Exif\x00"):
            keys.append("EXIF")
        elif marker == 0xE1 and payload.startswith(b"http://ns.adobe.com/xap/1.0/"):
            keys.append("XMP")
        else:
            keys.append("APP%d" % (marker - 0xE0))
    return keys


def strip_jpeg(raw):
    removed = jpeg_metadata_keys(raw)
    if not removed:
        return raw, []
    out = [raw[:2]]
    orientation = 1
    inserted = False
    for marker, segment in _jpeg_segments(raw):
        if marker is None:
            continue
        if not _jpeg_keep(marker, segment):
            payload = _jpeg_segment_payload(segment)
            if marker == 0xE1 and payload.startswith(b"Exif\x00"):
                orientation = exif_orientation(payload)
            continue
        if marker not in (0xD8, 0xE0) and orientation != 1 and not inserted:
            payload = b"Exif\x00\x00" + minimal_exif(orientation)
            out.append(b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload)
            inserted = True
        out.append(segment)
        if marker == 0xD9:
            break
    return b"".join(out), removed


# --------------------------------------------------------------------------- WebP

def _webp_chunks(raw):
    position = 12
    total = len(raw)
    while position + 8 <= total:
        fourcc = raw[position : position + 4]
        size = struct.unpack("<I", raw[position + 4 : position + 8])[0]
        end = position + 8 + size
        if end > total:
            return
        yield fourcc, raw[position + 8 : end]
        position = end + (size & 1)


def webp_metadata_keys(raw):
    if raw[12:16] != b"VP8X":
        return []
    keys = []
    for fourcc, data in _webp_chunks(raw):
        if fourcc == b"EXIF":
            if not is_minimal_exif(data):
                keys.append("EXIF")
        elif fourcc == b"XMP ":
            keys.append("XMP")
        elif fourcc not in _WEBP_KNOWN_CHUNKS:
            keys.append(fourcc.decode("latin-1").strip())
    return keys


def strip_webp(raw):
    removed = webp_metadata_keys(raw)
    if not removed:
        return raw, []
    chunks = []
    orientation = 1
    for fourcc, data in _webp_chunks(raw):
        if fourcc == b"EXIF":
            orientation = exif_orientation(data)
            continue
        if fourcc not in _WEBP_KNOWN_CHUNKS:
            continue
        if fourcc == b"VP8X":
            if data:
                flags = data[0] & ~0x0C  # drop EXIF (0x08) and XMP (0x04) bits
                data = bytes([flags]) + data[1:]
        chunks.append((fourcc, data))
    if orientation != 1:
        chunks.append((b"EXIF", minimal_exif(orientation)))
        if chunks and chunks[0][0] == b"VP8X":
            head = chunks[0][1]
            if head:
                chunks[0] = (b"VP8X", bytes([head[0] | 0x08]) + head[1:])
    body = b"".join(
        fourcc + struct.pack("<I", len(data)) + data + (b"\x00" if len(data) & 1 else b"")
        for fourcc, data in chunks
    )
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WEBP" + body, removed


# --------------------------------------------------------------------------- public API

def metadata_keys(raw):
    """Embedded metadata blocks that would leave the machine with this file."""
    if raw.startswith(_PNG_SIGNATURE):
        return png_metadata_keys(raw)
    if raw.startswith(b"\xff\xd8\xff"):
        return jpeg_metadata_keys(raw)
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return webp_metadata_keys(raw)
    return []


def strip_metadata(raw):
    """Return (bytes, removed) with identical pixels; unchanged bytes when clean."""
    if raw.startswith(_PNG_SIGNATURE):
        return strip_png(raw)
    if raw.startswith(b"\xff\xd8\xff"):
        return strip_jpeg(raw)
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return strip_webp(raw)
    return raw, []


def recompress(raw, *, output="WEBP", max_edge=PUBLISH_MAX_EDGE, quality=None):
    """Re-encode without any metadata; honours orientation before dropping EXIF."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(raw)) as source:
        if source.width * source.height > 100_000_000:
            raise LibraryError("图片像素数超过安全上限")
        image = ImageOps.exif_transpose(source)
        icc = image.info.get("icc_profile")
        if max(image.size) > max_edge:
            image.thumbnail((max_edge, max_edge), Image.LANCZOS)
        alpha = image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info)
        buffer = io.BytesIO()
        if output == "WEBP":
            image = image.convert("RGBA" if alpha else "RGB")
            image.save(buffer, "WEBP", quality=quality or PUBLISH_WEBP_QUALITY, method=4, icc_profile=icc)
            return buffer.getvalue(), ".webp", "image/webp"
        page = image.convert("RGBA")
        background = Image.new("RGB", page.size, "white")
        background.paste(page, mask=page.getchannel("A"))
        background.save(buffer, "JPEG", quality=quality or PUBLISH_JPEG_QUALITY, optimize=True, icc_profile=icc)
        return buffer.getvalue(), ".jpg", "image/jpeg"


def prepare(source, profile, *, pdf=False):
    """Read one frame from disk and apply the export profile.

    ``pdf`` requests JPEG output for ``publish`` because PDF only embeds DCT streams.
    """
    source = Path(source)
    raw = source.read_bytes()
    mime, suffix = image_type(raw)
    original = len(raw)
    if profile == "archive" or mime == "image/svg+xml":
        return PreparedImage(raw, suffix, mime, original)
    cleaned, removed = strip_metadata(raw)
    prepared = PreparedImage(cleaned, suffix, mime, original, removed)
    if profile != "publish":
        return prepared
    try:
        data, new_suffix, new_mime = recompress(raw, output="JPEG" if pdf else "WEBP")
    except (OSError, ValueError) as exc:
        raise LibraryError("无法压缩图片：" + source.name) from exc
    # PDF must receive JPEG; otherwise only accept the re-encode when it actually saves space.
    if (pdf and mime != "image/jpeg") or len(data) < len(cleaned):
        return PreparedImage(data, new_suffix, new_mime, original, removed, recompressed=True)
    return prepared


def profile_summary(profile, prepared):
    """One-line README / status wording for a finished export."""
    scrubbed = sum(1 for item in prepared if item.scrubbed)
    recompressed = sum(1 for item in prepared if item.recompressed)
    before = sum(item.original_size for item in prepared)
    after = sum(len(item.data) for item in prepared)
    if profile == "archive":
        return "images/ 为未经处理的原图，保留图片内嵌的工作流、提示词与 EXIF 元数据；仅建议本地归档。"
    text = "images/ 已移除 %d 张图片内嵌的工作流、提示词与 EXIF 元数据" % scrubbed
    if profile == "publish":
        text += "；%d 张按轻量发布重新编码（长边不超过 %d px），体积 %s → %s" % (
            recompressed,
            PUBLISH_MAX_EDGE,
            human_size(before),
            human_size(after),
        )
    else:
        text += "；分辨率与编码与原图一致"
    return text + "。"


def human_size(value):
    units = ["B", "KB", "MB", "GB"]
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return ("%d %s" if unit == "B" else "%.1f %s") % (size, unit)
        size /= 1024
    return "%d B" % value
