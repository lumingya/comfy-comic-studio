"""Workflows, render profiles, ComfyUI instances and assets."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, Field

from .. import imaging
from ..comfy import compile as C
from ..comfy import workflow_slots as slots
from ..comfy.client import ComfyError
from ..comfy.diagnostics import diagnose, model_catalog
from ..models import now_iso
from ..render_models import Asset, ComfyInstance, RenderProfile, WorkflowConfig, WorkflowDoc
from ..storage import Conflict
from .deps import Ctx

router = APIRouter(tags=["library"])


async def read_body(request: Request, limit: int, message: str) -> bytes:
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise ValueError(message)
        chunks.append(chunk)
    if not size:
        raise ValueError("请求体为空")
    return b"".join(chunks)


MAX_UPLOAD = 64 * 1024 * 1024
# Raw-body uploads (no multipart dependency): declared so OpenAPI clients send bytes.
BINARY_BODY = {
    "requestBody": {
        "required": True,
        "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
    }
}


class WorkflowImport(BaseModel):
    name: str
    graph: dict[str, Any]
    config: WorkflowConfig | None = None
    notes: str = ""


class WorkflowPatch(BaseModel):
    name: str | None = None
    graph: dict[str, Any] | None = None
    config: WorkflowConfig | None = None
    notes: str | None = None


class CompileRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)
    variant: str | None = None
    overrides: dict[str, Any] = Field(default_factory=dict)


def _check_api_format(graph: dict) -> None:
    if isinstance(graph.get("nodes"), list) and "links" in graph:
        raise ValueError("这是 ComfyUI 的界面格式；请在 ComfyUI 里用「导出 (API)」保存后再导入")


def _analyze(graph: dict) -> dict | None:
    try:
        return slots.analyze(graph)
    except Exception:  # analysis is advisory: never block an import
        return None


# --------------------------------------------------------------- workflows
@router.get("/workflows")
def list_workflows(ctx: Ctx) -> list[dict]:
    out = []
    for doc in ctx.store.list_docs("workflow"):
        info = C.describe(doc)
        out.append(
            {
                "id": doc.id,
                "name": doc.name,
                "source": doc.source,
                "nodes": info["nodes"],
                "variants": info["variants"],
                "image_inputs": info["image_inputs"],
                "checkpoint": info["checkpoint"],
                "updated_at": doc.updated_at,
            }
        )
    return out


@router.post("/workflows", status_code=status.HTTP_201_CREATED)
def import_workflow(ctx: Ctx, body: WorkflowImport) -> dict:
    _check_api_format(body.graph)
    doc = WorkflowDoc(
        name=body.name,
        graph=body.graph,
        config=body.config or WorkflowConfig(),
        notes=body.notes,
        slots=_analyze(body.graph),
    )
    C.describe(doc)  # raises on broken manual mappings
    ctx.store.put_doc(doc)
    return {**doc.model_dump(), "describe": C.describe(doc)}


@router.get("/workflows/{workflow_id}")
def get_workflow(ctx: Ctx, workflow_id: str) -> dict:
    doc = ctx.store.get_doc("workflow", workflow_id)
    return {**doc.model_dump(), "describe": C.describe(doc)}


@router.patch("/workflows/{workflow_id}")
def patch_workflow(ctx: Ctx, workflow_id: str, body: WorkflowPatch) -> dict:
    doc = ctx.store.get_doc("workflow", workflow_id)
    if doc.source == "builtin" and body.graph is not None:
        raise Conflict("内置工作流的节点图不能修改；请先另存为副本")
    changes = body.model_dump(exclude_unset=True)
    if body.graph is not None:
        _check_api_format(body.graph)
        changes["slots"] = _analyze(body.graph)
    if body.config is not None:
        changes["config"] = body.config
    doc = WorkflowDoc.model_validate({**doc.model_dump(), **changes})
    C.describe(doc)
    ctx.store.put_doc(doc)
    return {**doc.model_dump(), "describe": C.describe(doc)}


@router.post("/workflows/{workflow_id}/copy", status_code=status.HTTP_201_CREATED)
def copy_workflow(ctx: Ctx, workflow_id: str) -> dict:
    src = ctx.store.get_doc("workflow", workflow_id)
    doc = WorkflowDoc(
        name=f"{src.name}（副本）",
        graph=src.graph,
        config=src.config,
        slots=src.slots,
        notes=src.notes,
    )
    ctx.store.put_doc(doc)
    return doc.model_dump()


@router.delete("/workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(ctx: Ctx, workflow_id: str) -> None:
    doc = ctx.store.get_doc("workflow", workflow_id)
    if doc.source == "builtin":
        raise Conflict("内置工作流不能删除")
    doc.deleted_at = now_iso()
    ctx.store.put_doc(doc)


@router.post("/workflows/{workflow_id}/compile")
def compile_preview(ctx: Ctx, workflow_id: str, body: CompileRequest) -> dict:
    """Dry run: the exact graph Mio would queue for these values (编译结果可见)."""
    doc = ctx.store.get_doc("workflow", workflow_id)
    return C.compile_workflow(
        doc, body.values, variant=body.variant, overrides=body.overrides
    ).to_json()


@router.post("/workflows/{workflow_id}/diagnose")
def diagnose_workflow(ctx: Ctx, workflow_id: str, instance_id: str = "comfy_local") -> dict:
    doc = ctx.store.get_doc("workflow", workflow_id)
    inst = ctx.store.get_doc("instance", instance_id)
    try:
        info = ctx.comfy_client_factory(inst.base_url).object_info()
    except (ComfyError, OSError) as exc:
        raise ValueError(f"无法读取 {inst.name} 的 /object_info：{exc}") from None
    return {**diagnose(doc.graph, info), "models": model_catalog(info), "instance": inst.id}


# ---------------------------------------------------------------- profiles
@router.get("/profiles", response_model=list[RenderProfile])
def list_profiles(ctx: Ctx) -> list[RenderProfile]:
    return ctx.store.list_docs("profile")


@router.post("/profiles", response_model=RenderProfile, status_code=status.HTTP_201_CREATED)
def create_profile(ctx: Ctx, body: RenderProfile) -> RenderProfile:
    for stage in [*body.draft, *body.final, *body.edits.values()]:
        ctx.store.get_doc("workflow", stage.workflow_id)
    return ctx.store.put_doc(body)


@router.get("/profiles/{profile_id}", response_model=RenderProfile)
def get_profile(ctx: Ctx, profile_id: str) -> RenderProfile:
    return ctx.store.get_doc("profile", profile_id)


@router.put("/profiles/{profile_id}", response_model=RenderProfile)
def put_profile(ctx: Ctx, profile_id: str, body: RenderProfile) -> RenderProfile:
    ctx.store.get_doc("profile", profile_id)
    return create_profile(ctx, body.model_copy(update={"id": profile_id}))


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(ctx: Ctx, profile_id: str) -> None:
    if profile_id == "profile_default":
        raise Conflict("默认出图配置不能删除")
    ctx.store.delete_doc("profile", profile_id)


# --------------------------------------------------------------- instances
@router.get("/instances")
def list_instances(ctx: Ctx) -> dict:
    return {
        "instances": [i.model_dump() for i in ctx.store.list_docs("instance")],
        "pool": ctx.engine.pool.snapshot(),
    }


@router.post("/instances", response_model=ComfyInstance, status_code=status.HTTP_201_CREATED)
def create_instance(ctx: Ctx, body: ComfyInstance) -> ComfyInstance:
    doc = ctx.store.put_doc(body)
    ctx.refresh_instances()
    return doc


@router.put("/instances/{instance_id}", response_model=ComfyInstance)
def put_instance(ctx: Ctx, instance_id: str, body: ComfyInstance) -> ComfyInstance:
    ctx.store.get_doc("instance", instance_id)
    return create_instance(ctx, body.model_copy(update={"id": instance_id}))


@router.delete("/instances/{instance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_instance(ctx: Ctx, instance_id: str) -> None:
    ctx.store.delete_doc("instance", instance_id)
    ctx.refresh_instances()


@router.get("/instances/{instance_id}/health")
def instance_health(ctx: Ctx, instance_id: str) -> dict:
    inst = ctx.store.get_doc("instance", instance_id)
    try:
        stats = ctx.comfy_client_factory(inst.base_url).system_stats()
        ok = True
    except (ComfyError, OSError) as exc:
        stats, ok = {"error": str(exc)}, False
    ctx.engine.pool.mark_health(instance_id, ok)
    return {"id": instance_id, "ok": ok, "stats": stats}


# ------------------------------------------------------------------ assets
@router.post(
    "/assets", response_model=Asset, status_code=status.HTTP_201_CREATED, openapi_extra=BINARY_BODY
)
async def upload_asset(ctx: Ctx, request: Request, filename: str = "") -> Asset:
    """Raw request body = file bytes (``Content-Type`` is ignored; the type is sniffed)."""
    data = await read_body(request, MAX_UPLOAD, "文件超过 64 MB")
    return ctx.assets.put(data, source="upload", filename=filename)


@router.get("/assets/{asset_id}")
def get_asset(ctx: Ctx, asset_id: str, thumb: int = 0) -> Response:
    asset = ctx.store.get_asset(asset_id)
    data = ctx.assets.read(asset_id)
    mime = asset.mime
    if thumb and asset.mime.startswith("image/"):
        data, mime = imaging.thumbnail(data, max_side=max(64, min(thumb, 1024))), "image/jpeg"
    return Response(
        data, media_type=mime, headers={"Cache-Control": "public, max-age=31536000, immutable"}
    )
