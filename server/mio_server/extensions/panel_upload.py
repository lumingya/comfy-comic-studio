"""Validated, declared image uploads through the original raw-byte assets operation."""

from __future__ import annotations

from fastapi import HTTPException, Request
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from ..api.uploads import multipart_uploads
from .panel_bridge import PanelBridgeRequest, _context, active_panel, dispatch_panel
from .panel_media import verify_image
from .protocol import MAX_IMAGE_BYTES, MAX_REQUEST_BYTES, PanelUploadRequest

UPLOAD_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "required": ["metadata", "image"],
                    "properties": {
                        "metadata": {
                            "type": "string",
                            "format": "binary",
                            "description": "UTF-8 PanelUploadRequest JSON file, at most 64 KiB",
                        },
                        "image": {"type": "string", "format": "binary"},
                    },
                }
            }
        },
    }
}


async def upload_panel_image(ctx, request: Request, ext_id: str, panel_id: str):
    uploads = []
    try:
        try:
            uploads = await multipart_uploads(
                request,
                max_files=2,
                max_file_bytes=MAX_IMAGE_BYTES + MAX_REQUEST_BYTES,
                max_body_bytes=MAX_IMAGE_BYTES + MAX_REQUEST_BYTES + 64 * 1024,
            )
        except ValueError as exc:
            raise HTTPException(413, str(exc)) from None
        if len(uploads) != 2 or {name for name, _ in uploads} != {"metadata", "image"}:
            raise HTTPException(422, "upload requires exactly one metadata and one image file")
        parts = dict(uploads)
        raw = await parts["metadata"].read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise HTTPException(413, "panel upload metadata exceeds 64 KiB")
        try:
            metadata = PanelUploadRequest.model_validate_json(raw)
        except ValidationError:
            raise HTTPException(422, "panel upload metadata is invalid") from None
        if any(ord(char) < 32 or char in "/\\" for char in metadata.filename):
            raise HTTPException(422, "panel upload filename must be a plain filename")
        panel, _, _ = active_panel(ctx, ext_id, panel_id, metadata)
        spec = next((item for item in panel.requests if item.id == metadata.request_id), None)
        if spec is None or spec.input != "image":
            raise HTTPException(403, "image upload was not declared by this panel")
        _context(ctx, metadata.context)
        image = parts["image"]
        data = await image.read(MAX_IMAGE_BYTES + 1)
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "panel image exceeds 32 MiB")
        if len(data) != metadata.bytes:
            raise HTTPException(422, "panel image size does not match its metadata")
        await run_in_threadpool(verify_image, image.file, metadata.mime)
        # dispatch_panel repeats active/digest, declaration, context and actual target checks,
        # forwards the caller's bearer and invokes POST /assets with raw bytes, not JSON.
        return await dispatch_panel(
            ctx,
            request,
            ext_id,
            panel_id,
            PanelBridgeRequest(
                activation=metadata.activation,
                digest=metadata.digest,
                request_id=metadata.request_id,
                context=metadata.context,
                query={"filename": metadata.filename},
            ),
            image=(data, metadata.mime),
        )
    finally:
        for _, upload in uploads:
            await upload.close()
