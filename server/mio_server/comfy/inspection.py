"""Pure, reviewable workflow import analysis shared by HTTP and extension callers."""

from __future__ import annotations

import re
from dataclasses import asdict
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..render_models import WorkflowConfig, WorkflowDoc
from . import bindings as B
from . import compile as C
from . import slot_adapters as SA
from .diagnostics import MODEL_FILE, diagnose
from .workflow_import import (
    WorkflowDecodeError,
    normalize_workflow,
    ui_issues,
    validate_finite_numbers,
)

_IMAGE_FILE = re.compile(r"\.(png|jpe?g|webp|bmp|tiff?)(?:\s*\[input\])?$", re.I)
_KINDS = {
    "prompt": "正提示词",
    "negative": "负提示词",
    "seed": "种子",
    "width": "宽度",
    "height": "高度",
    "output": "出图节点",
}


class InspectRequest(BaseModel):
    workflow: dict[str, Any] = Field(max_length=20000)
    config: WorkflowConfig | None = None
    variant: str | None = None
    values: dict[str, Any] = Field(default_factory=dict)
    overrides: dict[str, Any] = Field(default_factory=dict)
    object_info: dict[str, dict] | None = Field(default=None, max_length=20000)


class BindingTarget(BaseModel):
    kind: str
    node: str
    field: str | None = None
    qualifier: str | None = None
    source: str
    part: str | None = None


class Issue(BaseModel):
    code: str
    severity: Literal["error", "warning", "info"]
    message: str
    kind: str | None = None


class Dependency(BaseModel):
    class_type: str
    nodes: list[str]


class ModelDependency(BaseModel):
    node: str
    field: str
    value: str


class DiagnosticReport(BaseModel):
    ok: bool
    missing_nodes: list[Dependency]
    missing_models: list[dict[str, Any]]
    invalid_values: list[dict[str, Any]]
    missing_inputs: list[dict[str, Any]]
    invalid_links: list[dict[str, Any]]
    invalid_inputs: list[dict[str, Any]]
    scope: str


class Inspection(BaseModel):
    format: Literal["api", "mio", "ui", "invalid"]
    importable: bool = False
    compilable: bool = False
    bindings: list[BindingTarget] = Field(default_factory=list)
    candidates: list[BindingTarget] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    output_nodes: list[str] = Field(default_factory=list)
    variants: list[str] = Field(default_factory=list)
    selected_nodes: list[str] = Field(default_factory=list)
    dependencies: list[Dependency] = Field(default_factory=list)
    models: list[ModelDependency] = Field(default_factory=list)
    issues: list[Issue] = Field(default_factory=list)
    diagnostics: DiagnosticReport | None = None
    lora_controls: dict | None = None


class FileInspection(BaseModel):
    workflow: dict[str, Any] | None = None
    inspection: Inspection


def inspect(request: InspectRequest, *, rules: B.BindingRules = (), registry=None) -> Inspection:
    """Never imports, mutates input, contacts ComfyUI or executes a workflow."""
    result = Inspection(format="mio" if "graph" in request.workflow else "api")
    try:
        validate_finite_numbers(
            (
                request.config.model_dump() if request.config is not None else None,
                request.values,
                request.overrides,
                request.object_info,
            )
        )
        payload = normalize_workflow(request.workflow)
    except WorkflowDecodeError as exc:
        result.format = "invalid"
        result.issues.append(Issue(code=exc.code, severity="error", message=str(exc)))
        return result
    graph = payload["graph"]
    result.format = (
        "mio" if graph is not request.workflow and "graph" in request.workflow else "api"
    )
    if isinstance(graph, dict) and isinstance(graph.get("nodes"), list):
        result.format = "ui"
        result.issues.extend(Issue(**issue) for issue in ui_issues(graph))
        return result
    try:
        config = request.config or WorkflowConfig.model_validate(payload.get("config", {}))
        doc = WorkflowDoc(name="Import preview", graph=graph, config=config)
    except (ValidationError, ValueError, TypeError):
        result.format = "invalid"
        result.issues.append(
            Issue(
                code="invalid_format",
                severity="error",
                message="工作流节点或配置格式不完整；节点需包含 class_type 与 inputs 对象。请重新导出 API 格式，或检查 Mio 配置。",
            )
        )
        return result
    result.importable = True
    try:
        result.lora_controls = SA.describe(doc, registry, object_info=request.object_info)
        result.lora_controls.pop("workflow_id")
    except ValueError as exc:
        result.issues.append(Issue(code="slot_error", severity="error", message=str(exc)))
    rules = tuple(rules)
    try:
        bound, problems = B.resolve(doc.graph, doc.config.mapping, rules=rules)
    except B.BindingError as exc:
        result.importable = False
        result.issues.append(Issue(code="invalid_mapping", severity="error", message=str(exc)))
        return result
    result.variants = sorted({b.qualifier for b in bound if b.kind == "output" and b.qualifier})
    result.issues.extend(
        Issue(code="binding_warning", severity="warning", message=p) for p in problems
    )
    selected = doc.graph
    try:
        selected, result.output_nodes = B.select_variant(doc.graph, bound, request.variant)
        compiled = C.compile_workflow(
            doc,
            request.values,
            variant=request.variant,
            overrides=request.overrides,
            rules=rules,
            registry=registry,
        )
        selected = compiled.graph
        bound = compiled.resolved_bindings
        result.output_nodes = compiled.outputs
        result.compilable = not any(issue.severity == "error" for issue in result.issues)
        result.issues.extend(
            Issue(code="compile_warning", severity="warning", message=w)
            for w in compiled.warnings
            if w not in problems
        )
    except (B.BindingError, ValueError) as exc:
        result.issues.append(Issue(code="compile_error", severity="error", message=str(exc)))
    active = [b for b in bound if b.node in selected]
    result.bindings = [BindingTarget(**asdict(b)) for b in active]
    result.selected_nodes = list(selected)
    result.missing = [kind for kind in B.CORE_KINDS if not any(b.kind == kind for b in active)]
    for kind in result.missing:
        result.issues.append(
            Issue(
                code="unbound",
                severity="warning",
                kind=kind,
                message=f"未绑定{_KINDS.get(kind, kind)}；保留工作流原值，Mio 传入的该参数不会生效。",
            )
        )
    candidates = _candidates(selected, set(result.missing), request.object_info)
    result.candidates = [BindingTarget(**asdict(b)) for b in candidates]
    for kind in result.missing:
        if len([b for b in candidates if b.kind == kind]) > 1:
            result.issues.append(
                Issue(
                    code="ambiguous",
                    severity="warning",
                    kind=kind,
                    message=f"{_KINDS.get(kind, kind)}有多个候选，请明确选择映射；未自动改写。",
                )
            )
    classes: dict[str, list[str]] = {}
    for node_id, node in selected.items():
        classes.setdefault(node["class_type"], []).append(node_id)
        for field, value in node["inputs"].items():
            if B.FILE_KEYS.search(field) and isinstance(value, str) and MODEL_FILE.search(value):
                result.models.append(ModelDependency(node=node_id, field=field, value=value))
    result.dependencies = [
        Dependency(class_type=cls, nodes=ids) for cls, ids in sorted(classes.items())
    ]
    if request.object_info is not None:
        result.diagnostics = DiagnosticReport.model_validate(
            diagnose(selected, request.object_info)
        )
    else:
        result.issues.append(
            Issue(
                code="dependencies_unchecked",
                severity="info",
                message="未提供实例节点信息，尚未验证缺失节点与模型；可在保存后选择实例诊断。",
            )
        )
    return result


def _candidates(graph: dict, missing: set[str], object_info: dict | None) -> list[B.Binding]:
    found = []
    for node, field, _ in B.text_sources(graph):
        for kind in ("prompt", "negative"):
            if kind in missing and field in B.TEXT_FIELDS:
                found.append(B.Binding(kind, node, field, source="candidate"))
    for node_id, node in graph.items():
        for kind in ("seed", "width", "height"):
            field = B._default_field(kind, node["inputs"])
            if kind in missing and field:
                found.append(B.Binding(kind, node_id, field, source="candidate"))
        if "output" in missing and (object_info or {}).get(node["class_type"], {}).get(
            "output_node"
        ):
            found.append(B.Binding("output", node_id, source="candidate"))
    found.extend(_image_candidates(graph, object_info or {}))
    return list(dict.fromkeys(found))


def _image_candidates(graph: dict, object_info: dict) -> list[B.Binding]:
    """Offer source-image roles for manual review; never collapse distinct images to ref:1."""
    consumers: dict[str, list[tuple[str, dict]]] = {}
    for node in graph.values():
        for field, value in node["inputs"].items():
            if B.is_link(value):
                consumers.setdefault(value[0], []).append((field.lower(), node["inputs"]))
    found = []
    for node_id, node in graph.items():
        outputs = object_info.get(node["class_type"], {}).get("output", [])
        image_output = isinstance(outputs, (list, tuple)) and any(
            value in ("IMAGE", "MASK") for value in outputs
        )
        for field, value in node["inputs"].items():
            if not isinstance(value, str) or field.lower() not in ("image", "mask", "filename"):
                continue
            if not image_output and not _IMAGE_FILE.search(value):
                continue
            roles = {"ref"}
            if field.lower() == "mask" or outputs == ["MASK"]:
                roles = {"mask"}
            for target, inputs in consumers.get(node_id, []):
                if "mask" in target:
                    roles.add("mask")
                if "control" in target or any(
                    name.lower() in ("control_net", "controlnet") for name in inputs
                ):
                    roles.add("control")
                if target == "pixels":
                    roles.add("init")
            found.extend(
                B.Binding(role, node_id, field, source="candidate") for role in sorted(roles)
            )
    return found
