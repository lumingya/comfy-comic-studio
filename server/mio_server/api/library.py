"""Workflows, render profiles, ComfyUI instances and assets."""

from __future__ import annotations

from typing import Any

from fastapi import Request, Response, status
from pydantic import BaseModel, Field

from .. import imaging
from ..comfy import adapters
from ..comfy import compile as C
from ..comfy import inspection as I
from ..comfy import slot_adapters as SA
from ..comfy import workflow_slots as slots
from ..comfy.client import ComfyError
from ..comfy.diagnostics import diagnose, model_catalog
from ..models import now_iso
from ..render_models import Asset, ComfyInstance, RenderProfile, WorkflowConfig, WorkflowDoc
from ..storage import Conflict
from ..workflow_trial import WorkflowTrialRequest, WorkflowTrialResult, trial
from .deps import Ctx
from .operations import Router as APIRouter

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
    slot_overrides: dict[str, Any] = Field(default_factory=dict)


class WorkflowFormatError(ValueError):
    code = "ui_format"


def _check_api_format(graph: dict) -> None:
    if isinstance(graph.get("nodes"), list):
        raise WorkflowFormatError(
            "这是 ComfyUI 的界面格式；请在 ComfyUI 里用「导出 (API)」保存后再导入"
        )


def _analyze(graph: dict) -> dict | None:
    try:
        return slots.analyze(graph)
    except Exception:  # analysis is advisory: never block an import
        return None


def _rules(ctx):
    return tuple((f"{c.source}:{c.id}", c.value) for c in ctx.registry.all("workflow_binding"))


# --------------------------------------------------------------- workflows
@router.get("/workflows")
def list_workflows(ctx: Ctx) -> list[dict]:
    out = []
    for doc in ctx.store.list_docs("workflow"):
        info = C.describe(doc, rules=_rules(ctx))
        plan = slots.ensure_plan(doc.graph, doc.slots, adapters=SA.installed(ctx.registry))
        lora_groups = plan.get("lora", {}).get("groups", [])
        out.append(
            {
                "id": doc.id,
                "name": doc.name,
                "source": doc.source,
                "nodes": info["nodes"],
                "variants": info["variants"],
                "image_inputs": info["image_inputs"],
                "checkpoint": info["checkpoint"],
                "loras": {
                    "enabled": bool(plan.get("lora", {}).get("enabled")),
                    "groups": len(lora_groups),
                    "supports_independent_toggle": any(
                        SA.can_toggle(group) for group in lora_groups
                    ),
                },
                "updated_at": doc.updated_at,
            }
        )
    return out


@router.post("/workflows/inspect", response_model=I.Inspection)
def inspect_workflow(ctx: Ctx, body: I.InspectRequest) -> I.Inspection:
    """Preview import and selected-output dependencies without saving or contacting a service."""
    return I.inspect(body, rules=_rules(ctx), registry=ctx.registry)


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
    C.describe(doc, rules=_rules(ctx))  # raises on broken manual mappings
    ctx.store.put_doc(doc)
    return {
        **doc.model_dump(),
        "describe": C.describe(doc, rules=_rules(ctx)),
        "lora_controls": SA.describe(doc, ctx.registry),
    }


@router.get("/workflows/{workflow_id}")
def get_workflow(ctx: Ctx, workflow_id: str) -> dict:
    doc = ctx.store.get_doc("workflow", workflow_id)
    return {
        **doc.model_dump(),
        "describe": C.describe(doc, rules=_rules(ctx)),
        "lora_controls": SA.describe(doc, ctx.registry),
    }


@router.get("/workflows/{workflow_id}/loras")
def workflow_loras(ctx: Ctx, workflow_id: str) -> dict:
    """Describe the workflow's LoRA controls without contacting ComfyUI."""
    doc = ctx.store.get_doc("workflow", workflow_id)
    return SA.describe(doc, ctx.registry)


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
    C.describe(doc, rules=_rules(ctx))
    ctx.store.put_doc(doc)
    return {
        **doc.model_dump(),
        "describe": C.describe(doc, rules=_rules(ctx)),
        "lora_controls": SA.describe(doc, ctx.registry),
    }


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
    users = [
        p.name
        for p in ctx.store.list_docs("profile")
        if any(s.workflow_id == workflow_id for s in [*p.draft, *p.final, *p.edits.values()])
    ]
    if users:
        raise Conflict("工作流仍被出图配置使用，请先更换工作流：" + "、".join(users))
    doc.deleted_at = now_iso()
    ctx.store.put_doc(doc)


@router.post("/workflows/{workflow_id}/compile")
def compile_preview(ctx: Ctx, workflow_id: str, body: CompileRequest) -> dict:
    """Dry run: the exact graph Mio would queue for these values (编译结果可见)."""
    doc = ctx.store.get_doc("workflow", workflow_id)
    compiled = C.compile_workflow(
        doc,
        body.values,
        variant=body.variant,
        overrides=body.overrides,
        slot_overrides=body.slot_overrides,
        rules=_rules(ctx),
        registry=ctx.registry,
    ).to_json()
    return {**compiled, "lora_controls": SA.describe(doc, ctx.registry, body.slot_overrides)}


@router.post("/workflows/{workflow_id}/trial", response_model=WorkflowTrialResult)
def trial_workflow(ctx: Ctx, workflow_id: str, body: WorkflowTrialRequest) -> WorkflowTrialResult:
    """Generate exactly one image with normal job progress, cancellation and results."""
    return trial(ctx, workflow_id, body)


@router.post("/workflows/{workflow_id}/diagnose")
def diagnose_workflow(
    ctx: Ctx, workflow_id: str, instance_id: str = "comfy_local", body: CompileRequest | None = None
) -> dict:
    doc = ctx.store.get_doc("workflow", workflow_id)
    inst = ctx.store.get_doc("instance", instance_id)
    try:
        info = ctx.comfy_client_factory(inst.base_url).object_info()
    except (ComfyError, OSError) as exc:
        raise ValueError(f"无法读取 {inst.name} 的 /object_info：{exc}") from None
    request = body or CompileRequest()
    compiled = C.compile_workflow(
        doc,
        request.values,
        variant=request.variant,
        overrides=request.overrides,
        slot_overrides=request.slot_overrides,
        rules=_rules(ctx),
        registry=ctx.registry,
    )
    return {
        **diagnose(compiled.graph, info),
        "models": model_catalog(info),
        "instance": inst.id,
        "variant": request.variant,
        "selected_nodes": list(compiled.graph),
        "warnings": compiled.warnings,
        "lora_controls": SA.describe(doc, ctx.registry, request.slot_overrides),
    }


@router.post("/workflows/{workflow_id}/capture-state")
def capture_workflow_state(ctx: Ctx, workflow_id: str, instance_id: str = "comfy_local") -> dict:
    """Read existing frontend-node snapshots; callers explicitly save the returned config.state."""
    doc = ctx.store.get_doc("workflow", workflow_id)
    inst = ctx.store.get_doc("instance", instance_id)
    if not adapters.stateful_nodes(doc.graph) and not doc.config.state_adapters:
        raise ValueError("工作流没有支持捕获状态的参数面板节点")
    try:
        captured = adapters.capture(
            ctx.comfy_client_factory(inst.base_url),
            doc.graph,
            doc.config.state_adapters,
            ctx.registry,
        )
    except Exception as exc:
        raise ValueError(
            f"无法读取 {inst.name} 的参数面板状态；请确认 ComfyUI 与对应插件可用：{exc}"
        ) from None
    state = {}
    for node_id, item in captured.items():
        try:
            from ..comfy.contracts import resolve, select

            adapter = resolve(
                ctx.registry,
                select(
                    ctx.registry,
                    "comfy_state_adapter",
                    doc.config.state_adapters.get(node_id, "parameter-control-panel"),
                ),
            )
            adapter.validate(item["state"], nonempty=True)
        except ComfyError as exc:
            raise ValueError(
                f"节点 {node_id} 状态不可用：{exc}。请先在 ComfyUI 中打开工作流并保存面板参数。"
            ) from None
        state[node_id] = item["state"]
    return {"state": state}


@router.get("/comfy-adapters")
def comfy_adapters(ctx: Ctx) -> list[dict]:
    """Available adapter contracts and reviewed source identities."""
    return [
        {
            "point": point,
            "id": c.id,
            "title": c.title,
            "source": c.source,
            "digest": c.meta.get("digest", ""),
            "contract": c.meta.get("contract", 1),
        }
        for point in ("comfy_output_adapter", "comfy_state_adapter", SA.POINT)
        for c in ctx.registry.all(point)
    ]


# ---------------------------------------------------------------- profiles
@router.get("/profiles", response_model=list[RenderProfile])
def list_profiles(ctx: Ctx) -> list[RenderProfile]:
    return ctx.store.list_docs("profile")


@router.post("/profiles", response_model=RenderProfile, status_code=status.HTTP_201_CREATED)
def create_profile(ctx: Ctx, body: RenderProfile) -> RenderProfile:
    if body.cloud_channel and body.cloud_channel not in {
        c.id for c in ctx.settings().image_channels
    }:
        raise ValueError("出图配置选择的云端渠道不存在，请重新选择")
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
    users = [p.name for p in ctx.store.list_docs("profile") if instance_id in p.instances]
    if users:
        raise Conflict("服务仍被出图配置指定使用，请先更换服务：" + "、".join(users))
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


def _is_svg(data: bytes) -> bool:
    """Pillow cannot read SVG, so imported vector art is stored as octet-stream."""
    head = data[:2048].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    return head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in head)


@router.get("/assets/{asset_id}")
def get_asset(ctx: Ctx, asset_id: str, thumb: int = 0) -> Response:
    asset = ctx.store.get_asset(asset_id)
    data = ctx.assets.read(asset_id)
    mime = asset.mime
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    if mime == "application/octet-stream" and _is_svg(data):
        # Served as an image so <img> renders it (no thumbnail: it scales anyway). The CSP keeps
        # a directly opened SVG inert.
        mime = "image/svg+xml"
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
        headers["X-Content-Type-Options"] = "nosniff"
    elif thumb and mime.startswith("image/"):
        data, mime = imaging.thumbnail(data, max_side=max(64, min(thumb, 1024))), "image/jpeg"
    return Response(data, media_type=mime, headers=headers)
