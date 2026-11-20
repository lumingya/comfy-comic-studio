"""Parse bounded image replies without trusting upstream error text or ZIP paths."""

from __future__ import annotations

import base64
import binascii
import io
import json
import re
import struct
import warnings
import zipfile

from PIL import Image

from .transport import error


def document(body):
    try:
        value = json.loads(body)
    except (ValueError, UnicodeError, RecursionError):
        raise error("Image service returned malformed JSON", sent=True) from None
    if not isinstance(value, dict):
        raise error("Image service returned an unexpected JSON shape", sent=True)
    return value


def image_bytes(body, limit, *, sent=True):
    if not body or len(body) > limit:
        raise error("Image bytes are empty or exceed the configured limit", sent=sent)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(body)) as image:
                if (
                    image.format not in {"PNG", "JPEG", "WEBP"}
                    or image.width * image.height > 16_777_216
                ):
                    raise ValueError
                image.verify()
            # verify() only checks structure for some formats (notably JPEG). The bytes
            # must also survive the same full decode that the reader/exporter performs.
            with Image.open(io.BytesIO(body)) as image:
                image.load()
    except (
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise error("Image response is invalid or exceeds the pixel limit", sent=sent) from None
    return body


def decode64(value, transfer):
    if not isinstance(value, str) or len(value) > (transfer.limit + 2) // 3 * 4:
        raise error("Encoded image exceeds the configured limit", sent=True)
    try:
        body = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise error("Image service returned invalid base64", sent=True) from None
    return image_bytes(body, transfer.limit)


def result(value, transfer):
    if not isinstance(value, dict):
        raise error("Image service did not return an image object", sent=True)
    if "b64_json" in value:
        return decode64(value["b64_json"], transfer)
    url = value.get("url")
    if isinstance(url, str) and url.startswith("data:"):
        match = re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,(.+)", url, re.DOTALL)
        if not match:
            raise error("Image service returned an unsupported data URL", sent=True)
        return decode64(match[1], transfer)
    if url:
        return image_bytes(transfer.download(url), transfer.limit)
    raise error("Image service returned no image", sent=True)


def zip_directory(body, limit):
    """Bound central-directory work before ZipFile allocates any ZipInfo objects.

    Image replies do not need ZIP64, spanning, self-extracting prefixes or giant metadata.
    Reject those representations rather than trusting an EOCD entry count. Walk every
    actual directory record and compare the record count and boundaries to the footer.
    """
    footer = body.rfind(b"PK\x05\x06", max(0, len(body) - 65557))
    if footer < 0 or footer + 22 > len(body):
        raise ValueError
    _, disk, directory_disk, disk_count, count, size, offset, comment = struct.unpack_from(
        "<4s4H2IH", body, footer
    )
    if (
        disk
        or directory_disk
        or disk_count != count
        or count > 16
        or size > 16 * (46 + 3 * 4096)
        or offset + size != footer
        or footer + 22 + comment != len(body)
        or body[max(0, footer - 20) : footer - 16] == b"PK\x06\x07"
    ):
        raise ValueError

    def extra_fields(start, length):
        end = start + length
        while start < end:
            if start + 4 > end:
                raise ValueError
            identifier, field_size = struct.unpack_from("<HH", body, start)
            start += 4 + field_size
            if identifier == 1 or start > end:  # ZIP64 is deliberately unsupported.
                raise ValueError

    cursor, actual, expanded = offset, 0, 0
    while cursor < footer:
        actual += 1
        if actual > 16 or cursor + 46 > footer or body[cursor : cursor + 4] != b"PK\x01\x02":
            raise ValueError
        flags = struct.unpack_from("<H", body, cursor + 8)[0]
        compressed, uncompressed = struct.unpack_from("<II", body, cursor + 20)
        name_size, extra_size, comment_size, start_disk = struct.unpack_from(
            "<4H", body, cursor + 28
        )
        local = struct.unpack_from("<I", body, cursor + 42)[0]
        end = cursor + 46 + name_size + extra_size + comment_size
        expanded += uncompressed
        if (
            flags & 1
            or start_disk
            or not 0 < name_size <= 4096
            or max(extra_size, comment_size) > 4096
            or end > footer
            or compressed == 0xFFFFFFFF
            or uncompressed == 0xFFFFFFFF
            or expanded > limit
            or local + 30 > offset
            or body[local : local + 4] != b"PK\x03\x04"
        ):
            raise ValueError
        extra_fields(cursor + 46 + name_size, extra_size)
        local_name, local_extra = struct.unpack_from("<HH", body, local + 26)
        if (
            max(local_name, local_extra) > 4096
            or local + 30 + local_name + local_extra + compressed > offset
        ):
            raise ValueError
        extra_fields(local + 30 + local_name, local_extra)
        cursor = end
    if cursor != footer or actual != count:
        raise ValueError


def zipped_image(body, transfer):
    if body.startswith((b"\x89PNG", b"\xff\xd8\xff", b"RIFF")):
        return image_bytes(body, transfer.limit)
    try:
        zip_directory(body, transfer.limit)
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            entries = archive.infolist()
            if len(entries) > 16 or any(item.flag_bits & 1 for item in entries):
                raise ValueError
            images = [
                item
                for item in entries
                if item.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
            ]
            if not images or sum(item.file_size for item in entries) > transfer.limit:
                raise ValueError
            with archive.open(images[0]) as stream:
                data = stream.read(transfer.limit + 1)
            return image_bytes(data, transfer.limit)
    except (
        OSError,
        ValueError,
        zipfile.BadZipFile,
        RuntimeError,
        NotImplementedError,
        EOFError,
        struct.error,
    ):
        raise error(
            "Image service returned an invalid or oversized image archive", sent=True
        ) from None


def reference(data, limit):
    image_bytes(data, limit, sent=False)
    with Image.open(io.BytesIO(data)) as image:
        output = io.BytesIO()
        image.convert("RGB").save(output, "PNG")
    body = output.getvalue()
    if len(body) > limit:
        raise error("Reference image exceeds the configured limit", status=400)
    return body
