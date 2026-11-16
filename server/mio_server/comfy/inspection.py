"""Pure, reviewable workflow import analysis shared by HTTP and extension callers."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..render_models import WorkflowConfig, WorkflowDoc
from . import bindings as B
from . import compile as C
from .diagnostics import MODEL_FILE, diagnose


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


def inspect(request: InspectRequest, *, rules: B.BindingRules = (), registry=None) -> Inspection:
    """Never imports, mutates input, contacts ComfyUI or executes a workflow."""
    payload = request.workflow
    graph = payload.get("graph", payload)
    result = Inspection(format="mio" if "graph" in payload else "api")
    if isinstance(graph, dict) and len(graph) > 20000:
        result.format = "invalid"
        result.issues.append(
            Issue(
                code="graph_too_large",
                severity="error",
                message="工作流超过 20000 个节点的分析上限。",
            )
        )
        return result
    if isinstance(graph, dict) and isinstance(graph.get("nodes"), list):
        result.format = "ui"
        result.issues.append(
            Issue(
                code="ui_format",
                severity="error",
                message="这是 ComfyUI 界面工作流，请使用「导出 (API)」；不会猜测自定义控件的值顺序。",
            )
        )
        return result
    try:
        config = request.config or WorkflowConfig.model_validate(
            payload.get("config", {}) if "graph" in payload else {}
        )
        doc = WorkflowDoc(name="Import preview", graph=graph, config=config)
    except (ValidationError, ValueError, TypeError) as exc:
        result.format = "invalid"
        result.issues.append(Issue(code="invalid_format", severity="error", message=str(exc)))
        return result
    result.importable = True
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
        result.compilable = True
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
                message=f"未绑定 {kind}；保留工作流原值，Mio 传入的该参数不会生效。",
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
                    message=f"{kind} 有多个候选，请明确选择映射；未自动改写。",
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
    return list(dict.fromkeys(found))
