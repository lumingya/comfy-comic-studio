"""Bounded-memory multipart uploads shared by folder import operations."""

from __future__ import annotations

import tempfile
from email import policy
from email.message import Message
from email.parser import BytesParser

from fastapi import Request
from starlette.datastructures import UploadFile


async def multipart_uploads(
    request: Request,
    *,
    max_files: int,
    max_file_bytes: int,
    max_body_bytes: int,
) -> list[tuple[str, UploadFile]]:
    content_type = request.headers.get("content-type", "")
    envelope = Message()
    envelope["content-type"] = content_type
    boundary = envelope.get_param("boundary")
    if not isinstance(boundary, str) or not boundary or len(boundary) > 200:
        raise ValueError("multipart upload requires a valid boundary")
    try:
        delimiter = b"--" + boundary.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ValueError("multipart boundary must be ASCII") from exc

    opening = delimiter + b"\r\n"
    closing = delimiter + b"--"
    separator = b"\r\n" + delimiter
    buffer = bytearray()
    uploads: list[tuple[str, UploadFile]] = []
    active: UploadFile | None = None
    field_bytes = 0
    total_files = total_bytes = body_bytes = fields = 0
    state = "start"
    declared_length = request.headers.get("content-length", "")
    if declared_length.isdigit() and int(declared_length) > max_body_bytes:
        raise ValueError("multipart upload exceeds its request size limit")

    async def write_part(data: bytes) -> None:
        nonlocal field_bytes, total_bytes
        if active is None:
            field_bytes += len(data)
            if field_bytes > 64 * 1024:
                raise ValueError("multipart field exceeds its size limit")
            return
        total_bytes += len(data)
        if total_bytes > max_file_bytes:
            raise ValueError("multipart files exceed their total size limit")
        await active.write(data)

    async def begin_part(headers: bytes) -> None:
        nonlocal active, fields, total_files, field_bytes
        message = BytesParser(policy=policy.default).parsebytes(headers + b"\r\n\r\n")
        if message.get_content_disposition() != "form-data":
            raise ValueError("multipart upload contains an invalid part")
        name = message.get_param("name", header="content-disposition")
        if not isinstance(name, str) or not name:
            raise ValueError("multipart upload contains a part without a name")
        filename = message.get_filename()
        field_bytes = 0
        if filename is None:
            fields += 1
            if fields > 8:
                raise ValueError("multipart upload contains too many fields")
            active = None
            return
        total_files += 1
        if total_files > max_files:
            raise ValueError("multipart upload contains too many files")
        active = UploadFile(
            file=tempfile.SpooledTemporaryFile(max_size=256 * 1024, mode="w+b"),
            filename=filename,
        )
        uploads.append((name, active))

    async def finish_part() -> None:
        nonlocal active, field_bytes
        if active is not None:
            await active.seek(0)
        active = None
        field_bytes = 0

    async def process_buffer() -> None:
        nonlocal state
        while True:
            if state == "start":
                if buffer.startswith(opening):
                    del buffer[: len(opening)]
                    state = "headers"
                elif buffer.startswith(closing):
                    del buffer[: len(closing)]
                    state = "done"
                elif not any(candidate.startswith(buffer) for candidate in (opening, closing)):
                    raise ValueError("multipart upload has an invalid opening boundary")
                else:
                    return
            elif state == "headers":
                end = buffer.find(b"\r\n\r\n")
                if end < 0:
                    if len(buffer) > 64 * 1024:
                        raise ValueError("multipart part headers are too large")
                    return
                await begin_part(bytes(buffer[:end]))
                del buffer[: end + 4]
                state = "body"
            elif state == "body":
                start = buffer.find(separator)
                if start < 0:
                    safe = len(buffer) - len(separator) - 2
                    if safe > 0:
                        await write_part(bytes(buffer[:safe]))
                        del buffer[:safe]
                    return
                end = start + len(separator)
                if len(buffer) < end + 2:
                    if start:
                        await write_part(bytes(buffer[:start]))
                        del buffer[:start]
                    return
                suffix = bytes(buffer[end : end + 2])
                if suffix not in (b"\r\n", b"--"):
                    await write_part(bytes(buffer[: start + 2]))
                    del buffer[: start + 2]
                    continue
                await write_part(bytes(buffer[:start]))
                del buffer[: end + 2]
                await finish_part()
                state = "headers" if suffix == b"\r\n" else "done"
            else:
                buffer.clear()
                return

    try:
        async for chunk in request.stream():
            body_bytes += len(chunk)
            if body_bytes > max_body_bytes:
                raise ValueError("multipart upload exceeds its request size limit")
            for offset in range(0, len(chunk), 64 * 1024):
                buffer.extend(chunk[offset : offset + 64 * 1024])
                await process_buffer()
        await process_buffer()
        if state != "done":
            raise ValueError("multipart upload is incomplete")
        return uploads
    except BaseException:
        for _, upload in uploads:
            await upload.close()
        raise
