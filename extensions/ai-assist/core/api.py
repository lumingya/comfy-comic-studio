"""The optional assistant's UI and public API share exactly the same operations."""

from email import policy
from email.parser import BytesParser
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from mio_server.extensions.http import read_body
from mio_server.extensions.public import SCOPES

from .models import (
    ApprovalRequest,
    AssistSettings,
    Channel,
    MessageRequest,
    NewConversation,
)


def get_service(request: Request):
    return request.app.state.ctx.extension_services["ai-assist"]


Service = Annotated[object, Depends(get_service)]

router = APIRouter(tags=["ai-assist"])


def _scopes(request):
    token = getattr(request.state, "api_token", None)
    return token.scopes if token is not None else list(SCOPES)


@router.get("/status")
def ai_assist_status(service: Service) -> dict:
    return service.status()


@router.get("/settings")
def ai_assist_settings(service: Service) -> dict:
    return service.store.public_settings()


@router.put("/settings")
def ai_assist_save_settings(service: Service, body: AssistSettings) -> dict:
    return service.store.save_settings(body)


@router.post("/models")
def ai_assist_models(service: Service, body: Channel) -> dict:
    return service.discover(body)


@router.get("/tools")
def ai_assist_tools(service: Service, request: Request) -> dict:
    return {"items": service.bridge.listing(scopes=_scopes(request))}


@router.get("/conversations")
def ai_assist_conversations(service: Service) -> dict:
    items = service.store.list()
    for item in items:
        item["run"].pop("scopes", None)
        item["run"].pop("token_id", None)
    return {"items": items}


@router.post("/conversations", status_code=201)
def ai_assist_create_conversation(service: Service, body: NewConversation) -> dict:
    return service.create(body.title)


@router.get("/conversations/{conversation_id}")
def ai_assist_get_conversation(service: Service, conversation_id: str) -> dict:
    return service.get(conversation_id)


@router.get("/conversations/{conversation_id}/requests/{request_key}")
def ai_assist_request_receipt(service: Service, conversation_id: str, request_key: str) -> dict:
    return service.request_receipt(conversation_id, request_key)


@router.patch("/conversations/{conversation_id}")
def ai_assist_rename_conversation(
    service: Service, conversation_id: str, body: NewConversation
) -> dict:
    return service.rename(conversation_id, body.title)


@router.delete("/conversations/{conversation_id}", status_code=204)
def ai_assist_delete_conversation(service: Service, conversation_id: str) -> None:
    service.delete(conversation_id)


@router.post("/conversations/{conversation_id}/messages", status_code=202)
def ai_assist_send_message(
    service: Service, request: Request, conversation_id: str, body: MessageRequest
) -> dict:
    token = getattr(request.state, "api_token", None)
    return service.send(conversation_id, body, _scopes(request), token.id if token else "")


@router.post("/conversations/{conversation_id}/stop")
def ai_assist_stop(service: Service, conversation_id: str) -> dict:
    return service.stop(conversation_id)


@router.post("/conversations/{conversation_id}/approval", status_code=202)
def ai_assist_approval(
    service: Service, request: Request, conversation_id: str, body: ApprovalRequest
) -> dict:
    return service.approve(conversation_id, body, _scopes(request))


@router.post(
    "/attachments",
    status_code=201,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "properties": {"file": {"type": "string", "format": "binary"}},
                        "required": ["file"],
                    }
                }
            },
        }
    },
)
async def ai_assist_upload_attachment(service: Service, request: Request) -> dict:
    """Bound the multipart body before parsing; no unbounded spool or extra upload dependency."""
    service.require_enabled()
    content_type = request.headers.get("content-type", "")
    if (
        not content_type.startswith("multipart/form-data;")
        or "\r" in content_type
        or "\n" in content_type
    ):
        raise ValueError("请通过 multipart file 上传图片")
    raw = await read_body(request, 8 * 1024 * 1024 + 65536, "图片不能超过 8 MB")
    envelope = BytesParser(policy=policy.default).parsebytes(
        ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode("ascii") + raw
    )
    parts = list(envelope.iter_parts())
    if len(parts) != 1 or parts[0].get_param("name", header="content-disposition") != "file":
        raise ValueError("每次请上传一张图片")
    return service.upload(
        parts[0].get_payload(decode=True) or b"", parts[0].get_filename() or "image"
    )


@router.get("/attachments/{attachment_id}")
def ai_assist_get_attachment(service: Service, attachment_id: str):
    metadata, path = service.attachment(attachment_id)
    return FileResponse(
        path,
        media_type=metadata["mime_type"],
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


for route in router.routes:
    methods = route.methods
    scope = "read" if "GET" in methods else "write"
    if route.path in {"/settings", "/models"}:
        scope = "admin"
    elif route.path.endswith(("/messages", "/approval")):
        scope = "render"
    route.openapi_extra = {**(route.openapi_extra or {}), "x-mio-scope": scope}
