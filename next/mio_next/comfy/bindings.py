"""Bind Mio values to arbitrary ComfyUI API-format workflows.

Binding priority (ROADMAP §6.4):
  1. explicit tags in node titles, e.g. ``[mio:prompt=positive]``, ``[mio:seed=noise_seed]``,
     ``[mio:output:draft]``; the same tag on several nodes fans the value out to all of them;
  2. manual JSON Pointer mappings, e.g. ``{"seed": ["/4529/inputs/noise_seed"]}``;
  3. heuristics as a fallback (sampler -> CLIPTextEncode, EmptyLatentImage, Save/PreviewImage).

Tag grammar: ``[mio:<kind>[:<qualifier>][=<field>]]``. Everything here is a pure function over
plain dicts, so the module is unit-testable without a ComfyUI server.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass

TAG_RE = re.compile(r"\[mio:([a-z][a-z0-9_-]*)(?::([a-z0-9_.-]+))?(?:=([^\]\s]+))?\]", re.I)

# Kinds whose value is written into a node input. ``output``/``inspect`` only select nodes.
VALUE_KINDS = {
    "prompt", "negative", "seed", "width", "height", "steps", "cfg", "denoise",
    "sampler", "scheduler", "batch", "checkpoint", "ref", "init", "mask",
}
SELECT_KINDS = {"output", "inspect"}
DEFAULT_FIELDS = {
    "seed": ("seed", "noise_seed"),
    "width": ("width",),
    "height": ("height",),
    "steps": ("steps",),
    "cfg": ("cfg",),
    "denoise": ("denoise",),
    "sampler": ("sampler_name",),
    "scheduler": ("scheduler",),
    "batch": ("batch_size",),
    "checkpoint": ("ckpt_name",),
    "ref": ("image",),
    "init": ("image",),
    "mask": ("image",),
}
TEXT_FIELDS = ("text", "prompt", "positive", "string", "value", "text_g", "text_l")
SAMPLER_CLASSES = {"KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced"}
LATENT_CLASSES = {"EmptyLatentImage", "EmptySD3LatentImage"}
OUTPUT_CLASSES = {"SaveImage", "PreviewImage"}
TEXT_ENCODER_HINT = ("TextEncode",)
CORE_KINDS = ("prompt", "negative", "seed", "width", "height", "output")


class BindingError(ValueError):
    """A workflow cannot be bound or modified as requested."""


@dataclass(frozen=True)
class Binding:
    kind: str
    node: str
    field: str | None = None
    qualifier: str | None = None
    source: str = "tag"  # tag | mapping | heuristic


def is_link(value) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], str)
        and isinstance(value[1], int)
    )


def title_of(node: dict) -> str:
    return str((node.get("_meta") or {}).get("title") or "")


def parse_tags(title: str) -> list[tuple[str, str | None, str | None]]:
    """``"Seed [mio:seed=noise_seed]"`` -> ``[("seed", None, "noise_seed")]``."""
    return [(m.group(1).lower(), m.group(2), m.group(3)) for m in TAG_RE.finditer(title or "")]


def _default_field(kind: str, inputs: dict) -> str | None:
    if kind in ("prompt", "negative"):
        for name in TEXT_FIELDS:
            if isinstance(inputs.get(name), str):
                return name
        for name, value in inputs.items():
            if isinstance(value, str):
                return name
        return None
    for name in DEFAULT_FIELDS.get(kind, ()):
        if name in inputs and not is_link(inputs[name]):
            return name
    return None


def tag_bindings(graph: dict) -> tuple[list[Binding], list[str]]:
    """Bindings declared in node titles, plus human-readable problems."""
    found, problems = [], []
    for node_id, node in graph.items():
        inputs = node.get("inputs") or {}
        for kind, qualifier, field in parse_tags(title_of(node)):
            if kind in SELECT_KINDS:
                found.append(Binding(kind, node_id, None, qualifier))
                continue
            if kind not in VALUE_KINDS:
                problems.append(f"节点 {node_id}：未知标签 [mio:{kind}]")
                continue
            target = field or _default_field(kind, inputs)
            if not target:
                problems.append(f"节点 {node_id}：[mio:{kind}] 找不到可写字段，请写成 [mio:{kind}=字段名]")
                continue
            if target not in inputs:
                problems.append(f"节点 {node_id}：字段 {target} 不存在（可用：{', '.join(inputs)}）")
                continue
            if is_link(inputs[target]):
                problems.append(f"节点 {node_id}：字段 {target} 是连线输入，不能直接写值")
                continue
            found.append(Binding(kind, node_id, target, qualifier))
    return found, problems


def _split_pointer(pointer: str) -> list[str]:
    if not pointer.startswith("/"):
        raise BindingError(f"JSON Pointer 必须以 / 开头：{pointer}")
    return [p.replace("~1", "/").replace("~0", "~") for p in pointer[1:].split("/")]


def mapping_bindings(graph: dict, mapping: dict | None) -> list[Binding]:
    """Manual JSON Pointer mappings: ``{"seed": ["/12/inputs/seed"], "ref:1": "/30/inputs/image"}``."""
    result = []
    for key, pointers in (mapping or {}).items():
        kind, _, qualifier = key.partition(":")
        for pointer in [pointers] if isinstance(pointers, str) else pointers:
            parts = _split_pointer(pointer)
            if len(parts) != 3 or parts[1] != "inputs" or parts[0] not in graph:
                raise BindingError(f"映射 {key}：指针 {pointer} 必须形如 /<节点>/inputs/<字段>")
            if parts[2] not in graph[parts[0]].get("inputs", {}):
                raise BindingError(f"映射 {key}：节点 {parts[0]} 没有字段 {parts[2]}")
            result.append(Binding(kind, parts[0], parts[2], qualifier or None, "mapping"))
    return result


def heuristic_bindings(graph: dict, missing: set[str]) -> list[Binding]:
    found: list[Binding] = []
    for node_id, node in graph.items():
        cls, inputs = node.get("class_type", ""), node.get("inputs") or {}
        if cls in SAMPLER_CLASSES:
            for kind, port in (("prompt", "positive"), ("negative", "negative")):
                if kind in missing and is_link(inputs.get(port)):
                    src_id = inputs[port][0]
                    src = graph.get(src_id) or {}
                    if any(h in src.get("class_type", "") for h in TEXT_ENCODER_HINT):
                        field = _default_field(kind, src.get("inputs") or {})
                        if field and not is_link(src["inputs"][field]):
                            found.append(Binding(kind, src_id, field, None, "heuristic"))
            if "seed" in missing:
                field = _default_field("seed", inputs)
                if field:
                    found.append(Binding("seed", node_id, field, None, "heuristic"))
        if cls in LATENT_CLASSES:
            for kind in ("width", "height", "batch"):
                field = _default_field(kind, inputs)
                if (kind in missing or kind == "batch") and field:
                    found.append(Binding(kind, node_id, field, None, "heuristic"))
        if cls in OUTPUT_CLASSES and "output" in missing:
            found.append(Binding("output", node_id, None, None, "heuristic"))
    return list(dict.fromkeys(found))


def resolve(graph: dict, mapping: dict | None = None) -> tuple[list[Binding], list[str]]:
    """All bindings by priority: tags, then mappings, then heuristics for kinds still missing."""
    tags, problems = tag_bindings(graph)
    maps = mapping_bindings(graph, mapping)
    have = {b.kind for b in tags + maps}
    missing = set(CORE_KINDS) - have
    return tags + maps + heuristic_bindings(graph, missing), problems


def summary(bindings: list[Binding]) -> dict:
    """``{"prompt": ["1832.positive (tag)"], "output:draft": ["2528 (tag)"], ...}`` for reports."""
    out: dict[str, list[str]] = {}
    for b in bindings:
        key = b.kind + (f":{b.qualifier}" if b.qualifier else "")
        out.setdefault(key, []).append(f"{b.node}{'.' + b.field if b.field else ''} ({b.source})")
    return out


def _value_for(binding: Binding, values: dict):
    """``ref:1`` beats ``ref`` so a qualifier can target one slot."""
    if binding.qualifier is not None and f"{binding.kind}:{binding.qualifier}" in values:
        return True, values[f"{binding.kind}:{binding.qualifier}"]
    if binding.kind in values:
        return True, values[binding.kind]
    return False, None


def apply_values(graph: dict, bindings: list[Binding], values: dict) -> dict:
    """Return a copy of graph with every bound field that has a value written (fan-out)."""
    out = copy.deepcopy(graph)
    for b in bindings:
        if b.kind in SELECT_KINDS or b.field is None or b.node not in out:
            continue
        present, value = _value_for(b, values)
        if present and value is not None:
            out[b.node]["inputs"][b.field] = value
    return out


def ancestors(graph: dict, roots) -> set[str]:
    keep, stack = set(), list(roots)
    while stack:
        node_id = stack.pop()
        if node_id in keep or node_id not in graph:
            continue
        keep.add(node_id)
        for value in (graph[node_id].get("inputs") or {}).values():
            if is_link(value):
                stack.append(value[0])
    return keep


def select_variant(graph: dict, bindings: list[Binding], variant: str | None) -> tuple[dict, list[str]]:
    """Keep only what the chosen output variant needs.

    Outputs tagged ``[mio:output:<variant>]`` (plus plain ``[mio:output]`` and ``[mio:inspect]``
    nodes) are kept with their ancestors. ComfyUI then never runs the other branches, so one
    workflow serves both the draft tier (base image only) and the final tier (upscale + detail)
    without exporting it twice.
    """
    outputs = [b for b in bindings if b.kind == "output" and b.qualifier in (None, variant)]
    if variant and not any(b.qualifier == variant for b in outputs):
        raise BindingError(f"没有标记为 [mio:output:{variant}] 的输出节点")
    if not outputs:
        raise BindingError("工作流没有可用的输出节点")
    inspect = [b for b in bindings if b.kind == "inspect" and b.qualifier in (None, variant)]
    keep = ancestors(graph, [b.node for b in outputs + inspect])
    pruned = {k: copy.deepcopy(v) for k, v in graph.items() if k in keep}
    return pruned, sorted({b.node for b in outputs})


def _expand(target, parts: list[str]):
    """Concrete ``(container, key)`` matches for pointer ``parts``; ``*`` matches every item."""
    head, rest = parts[0], parts[1:]
    if head == "*":
        keys = range(len(target)) if isinstance(target, list) else list(target) if isinstance(target, dict) else []
    elif isinstance(target, list):
        keys = [int(head)] if head.isdigit() and int(head) < len(target) else []
    elif isinstance(target, dict):
        keys = [head] if head in target else []
    else:
        keys = []
    for key in keys:
        if rest:
            yield from _expand(target[key], rest)
        else:
            yield target, key


def apply_overrides(graph: dict, overrides: dict | None) -> dict:
    """Set existing values by JSON Pointer (``/2295/inputs/text``). Never adds nodes or links.

    Overrides tune parameters (switch off a LoRA stack, blank a fixed suffix). They refuse to
    create keys or replace links, so the workflow structure stays exactly as the user built it.
    ``*`` matches every list item or key (``/2295/inputs/loras/__value__/*/active``).
    Pointers into nodes that the chosen variant pruned away are ignored.
    """
    out = copy.deepcopy(graph)
    for pointer, value in (overrides or {}).items():
        parts = _split_pointer(pointer)
        if parts[0] == "*":
            raise BindingError(f"覆盖路径的节点位不能用通配符：{pointer}")
        if parts[0] not in out:
            continue
        matches = list(_expand(out, parts))
        if not matches:
            raise BindingError(f"覆盖路径不存在：{pointer}")
        if any(is_link(container[key]) for container, key in matches):
            raise BindingError(f"不能覆盖连线：{pointer}")
        for container, key in matches:
            container[key] = copy.deepcopy(value)
    return out


def text_sources(graph: dict) -> list[tuple[str, str, str]]:
    """Literal strings that can reach a text encoder: ``(node, field, value)``."""
    encoders = [k for k, n in graph.items() if any(h in n.get("class_type", "") for h in TEXT_ENCODER_HINT)]
    roots = [v[0] for k in encoders for v in (graph[k].get("inputs") or {}).values() if is_link(v)]
    found = []
    for node_id in sorted(ancestors(graph, roots) | set(encoders)):
        for field, value in (graph[node_id].get("inputs") or {}).items():
            if isinstance(value, str) and value.strip():
                found.append((node_id, field, value))
    return found


FILE_KEYS = re.compile(r"(^|_)(name|names|lora|loras|ckpt|model|vae|file|filename|path|dir|prefix|format)$", re.I)


def string_values(graph: dict):
    """Every literal string in the graph as ``(node, path, value)``, nested lists/dicts included.

    Keys that identify files or models (``ckpt_name``, ``lora``, ``filename_prefix`` ...) are
    skipped: they name assets rather than feed prompts.
    """
    def walk(value, path):
        if isinstance(value, str):
            if value.strip():
                yield path, value
        elif isinstance(value, dict):
            for key, item in value.items():
                if not FILE_KEYS.search(str(key)):
                    yield from walk(item, f"{path}/{key}")
        elif isinstance(value, list) and not is_link(value):
            for i, item in enumerate(value):
                yield from walk(item, f"{path}/{i}")

    for node_id, node in graph.items():
        for field, value in (node.get("inputs") or {}).items():
            if FILE_KEYS.search(field):
                continue
            for path, text in walk(value, field):
                yield node_id, path, text


def guard_terms(graph: dict, terms) -> list[tuple[str, str, str]]:
    """Pre-flight content guard: ``(node, path, term)`` for every string containing a term.

    Scans all strings, not only known prompt fields, so text hidden in helper nodes (trigger
    word lists, cached editor state, fixed prefixes/suffixes) is caught before submission.
    ASCII terms match whole words; other scripts match substrings.
    """
    hits = []
    for node_id, path, value in string_values(graph):
        low = value.lower()
        for term in terms:
            t = term.lower().strip()
            if not t:
                continue
            if t.isascii():
                matched = re.search(r"(?<![a-z0-9_])" + re.escape(t) + r"(?![a-z0-9_])", low)
            else:
                matched = t in low
            if matched:
                hits.append((node_id, path, term))
    return hits


def guard_text(text: str, terms) -> list[str]:
    """Terms found in one string (used on the final prompt echoed by ``[mio:inspect]`` nodes)."""
    return sorted({term for _, _, term in guard_terms({"x": {"inputs": {"text": text}}}, terms)})


def lint_outputs(graph: dict, outputs) -> list[str]:
    """Warn about output nodes configured to save without reporting images to ``/history``."""
    warnings = []
    for node_id in outputs:
        inputs = graph.get(node_id, {}).get("inputs") or {}
        for field, value in inputs.items():
            if value is False and ("preview" in field.lower() or field.lower() in ("enable", "enabled")):
                warnings.append(
                    f"输出节点 {node_id}（{graph[node_id].get('class_type')}）的 {field}=false，"
                    f"ComfyUI 可能不回报图片；可用覆盖 /{node_id}/inputs/{field}=true"
                )
    return warnings
