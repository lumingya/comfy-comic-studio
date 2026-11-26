"""Read-only manual candidates; payload dependency never establishes binding identity."""

from __future__ import annotations

import re
from collections import deque

from . import bindings as B
from .binding_scope import BindingScope
from .workflow_graph import SemanticGraph

_IMAGE_FILE = re.compile(r"\.(png|jpe?g|webp|bmp|tiff?)(?:\s*\[input\])?$", re.I)
_TEXT_FIELDS = set(B.TEXT_FIELDS) - {"value", "string"}
_TEXT_ROLE = re.compile(
    r"^(?:(?:positive|negative)(?:_(?:prompt|text))?|(?:prompt|text)_(?:positive|negative))"
    r"(?:_?\d+)?$",
    re.I,
)
_CONTROL_FIELDS = {field for fields in B.DEFAULT_FIELDS.values() for field in fields} | {
    "mode",
    "format",
    "language",
    "lang",
    "separator",
    "delimiter",
    "device",
    "dtype",
    "precision",
    "method",
    "interpolation",
    "alignment",
    "encoding",
    "upload",
    "url",
}
_PAYLOAD_NAME = re.compile(r"(?:^|_)(image|images|pixels|mask|masks)(?:$|_|\d)", re.I)
_NON_PAYLOAD_NAME = re.compile(
    r"(?:^|_)(?:width|height|size|batch|seed|steps|cfg|strength|threshold|resolution|"
    r"channels|count|index|select|model|clip|vae|text|prompt|path|file|filename|format|mode)"
    r"(?:$|_)",
    re.I,
)
_ROLE_BITS = {"init": 1, "control": 2, "mask": 4}
_PAYLOAD_TYPES = {"IMAGE", "MASK"}


class _Types:
    def __init__(self, graph, info):
        self.graph, self.info, self.cache = graph, info, {}
        self.output_cache = {}

    def definition(self, nid):
        definition = self.info.get(self.graph[nid].get("class_type"), {})
        return definition if isinstance(definition, dict) else {}

    def inputs(self, nid):
        cls = self.graph[nid].get("class_type")
        if cls not in self.cache:
            specs = {}
            inputs = self.definition(nid).get("input") or {}
            if isinstance(inputs, dict):
                for section in ("required", "optional"):
                    fields = inputs.get(section)
                    if isinstance(fields, dict):
                        specs.update(fields)
            self.cache[cls] = specs
        return self.cache[cls]

    def input(self, nid, field):
        spec = self.inputs(nid).get(field)
        if isinstance(spec, (list, tuple)) and spec:
            if isinstance(spec[0], str):
                return spec[0].upper()
            if isinstance(spec[0], (list, tuple)):
                return "COMBO"
        return ""

    def multiline(self, nid, field):
        spec = self.inputs(nid).get(field)
        return (
            isinstance(spec, (list, tuple))
            and len(spec) > 1
            and isinstance(spec[1], dict)
            and spec[1].get("multiline") is True
        )

    def outputs(self, nid):
        cls = self.graph[nid].get("class_type")
        if cls not in self.output_cache:
            outputs = self.definition(nid).get("output", [])
            values = (
                [str(value).upper() for value in outputs]
                if isinstance(outputs, (list, tuple))
                else []
            )
            self.output_cache[cls] = values, set(values)
        return self.output_cache[cls][0]

    def has_output(self, nid, *kinds):
        self.outputs(nid)
        types = self.output_cache[self.graph[nid].get("class_type")][1]
        return any(kind in types for kind in kinds)


def text_candidates(graph, missing, object_info):
    """Empty text is writable too; types alone do not turn configuration into prompts."""
    types = _Types(graph, object_info)
    legacy = {(nid, field) for nid, field, _ in B.text_sources(graph) if field in B.TEXT_FIELDS}
    linked = _linked_text_sources(graph, types, object_info)
    found = []
    for nid, node in graph.items():
        if node.get("mode") in (2, 4):
            continue
        for field, value in node["inputs"].items():
            name = field.lower()
            kind = types.input(nid, field)
            if (
                not isinstance(value, str)
                or kind not in ("", "*", "STRING")
                or B.FILE_KEYS.search(name)
                or name in _CONTROL_FIELDS
            ):
                continue
            semantic = name in _TEXT_FIELDS or _TEXT_ROLE.fullmatch(name)
            typed_text = kind == "STRING" and (
                types.multiline(nid, field) or types.has_output(nid, "CONDITIONING")
            )
            if semantic or typed_text or (nid, field) in legacy or (nid, field) in linked:
                found.extend(
                    B.Binding(role, nid, field, source="candidate")
                    for role in ("prompt", "negative")
                    if role in missing
                )
    return found


def _linked_text_sources(graph, types, object_info):
    """Retain empty payload terms connected to text consumers, not unrelated string widgets."""
    semantic = SemanticGraph(graph, object_info)
    pending, seen, found = [], set(), set()

    def text_input(nid, field):
        return (
            types.input(nid, field) in ("", "*", "STRING")
            and not B.FILE_KEYS.search(field)
            and field.lower() not in _CONTROL_FIELDS
        )

    def link(value):
        return B.is_link(value) and value[0] in graph and type(value[1]) is int and value[1] >= 0

    for nid, node in graph.items():
        if not semantic.is_active(nid):
            continue
        for field, value in node["inputs"].items():
            if (
                link(value)
                and text_input(nid, field)
                and (
                    field.lower() in _TEXT_FIELDS
                    or _TEXT_ROLE.fullmatch(field)
                    or (
                        types.input(nid, field) == "STRING"
                        and (types.multiline(nid, field) or types.has_output(nid, "CONDITIONING"))
                    )
                )
            ):
                pending.append((value[0], value[1]))
    while pending:
        nid, slot = pending.pop()
        if (nid, slot) in seen:
            continue
        seen.add((nid, slot))
        inputs = graph[nid]["inputs"]
        if slot is None:
            # One shared payload hub keeps multi-output string transforms bounded too.
            routes = [
                (field, value)
                for field, value in inputs.items()
                if field.lower() in B.TEXT_FIELDS
                or _TEXT_ROLE.fullmatch(field)
                or types.input(nid, field) == "STRING"
            ]
        else:
            routes, reason = semantic.route([nid, slot], "STRING")
            if reason == "not-router":
                if slot == 0 or semantic.output_type(nid, slot) == "STRING":
                    pending.append((nid, None))
                continue
            if reason == "dynamic-selector":
                _, branches, _ = semantic.selection(nid)
                routes = [(field, inputs[field]) for field in branches]
            elif reason:
                continue
        for field, value in routes:
            if not text_input(nid, field):
                continue
            if link(value):
                pending.append((value[0], value[1]))
            elif isinstance(value, str):
                found.add((nid, field))
    return found


class _ImageRoles:
    def __init__(self, graph, info, roots):
        self.graph, self.types = graph, _Types(graph, info)
        self.semantic = SemanticGraph(graph, info)
        self.scope = BindingScope(graph, self.semantic, roots).nodes if roots else set(graph)
        self.edges, self.payloads, self.source_cache = {}, {}, {}

    def link(self, value):
        return (
            B.is_link(value) and value[0] in self.graph and type(value[1]) is int and value[1] >= 0
        )

    def input_kind(self, nid, field):
        kind = self.types.input(nid, field)
        if kind in _PAYLOAD_TYPES:
            return kind
        if kind not in ("", "*") or _NON_PAYLOAD_NAME.search(field):
            return ""
        match = _PAYLOAD_NAME.search(field)
        return ("MASK" if "mask" in match[1].lower() else "IMAGE") if match else ""

    def payload_inputs(self, nid):
        if nid not in self.payloads:
            self.payloads[nid] = [
                (value[0], value[1], kind)
                for field, value in self.graph[nid]["inputs"].items()
                if self.link(value) and (kind := self.input_kind(nid, field))
            ]
        return self.payloads[nid]

    def source_fields(self, nid):
        if nid not in self.source_cache:
            image_output = self.types.has_output(nid, "IMAGE", "MASK")
            self.source_cache[nid] = [
                field
                for field, value in self.graph[nid]["inputs"].items()
                if isinstance(value, str)
                and field.lower() in ("image", "mask", "filename")
                and (image_output or _IMAGE_FILE.search(value))
            ]
        return self.source_cache[nid]

    def routed_inputs(self, nid, routes, kind):
        return [
            (value[0], value[1], kind)
            for field, value in routes
            if self.link(value) and self.types.input(nid, field) in ("", "*", kind)
        ]

    def dependencies(self, marker):
        if marker in self.edges:
            return self.edges[marker]
        nid, slot, kind = marker
        result = None
        if nid in self.scope:
            if slot is None:
                # A shared hub avoids expanding every input for every transformed output.
                result = self.payload_inputs(nid)
            else:
                routes, reason = self.semantic.route([nid, slot], kind)
                if not reason:
                    result = self.routed_inputs(nid, routes, kind)
                elif reason == "dynamic-selector":
                    _, branches, _ = self.semantic.selection(nid)
                    result = self.routed_inputs(
                        nid, [(field, self.graph[nid]["inputs"][field]) for field in branches], kind
                    )
                elif reason == "not-router" and (
                    slot == 0 or self.semantic.output_type(nid, slot) in _PAYLOAD_TYPES
                ):
                    result = [(nid, None, "")]
                elif (
                    reason == "not-router"
                    and self.source_fields(nid)
                    and not self.payload_inputs(nid)
                ):
                    # An untyped file leaf can expose a mask port; it establishes no route.
                    result = []
        self.edges[marker] = result
        return result

    def roles(self):
        pending = deque()
        for nid in self.scope:
            if not self.semantic.is_active(nid):
                continue
            inputs = self.graph[nid]["inputs"]
            control = any(name.lower() in ("control_net", "controlnet") for name in inputs)
            for field, value in inputs.items():
                kind = self.input_kind(nid, field)
                if not kind or not self.link(value):
                    continue
                name = field.lower()
                bits = _ROLE_BITS["mask"] if kind == "MASK" or "mask" in name else 0
                if control or "control" in name:
                    bits |= _ROLE_BITS["control"]
                if name in ("pixels", "init_image", "initial_image"):
                    bits |= _ROLE_BITS["init"]
                if bits:
                    pending.append(((value[0], value[1], kind), bits))
        seen, found = {}, {}
        while pending:
            marker, bits = pending.popleft()
            added = bits & ~seen.get(marker, 0)
            if not added:
                continue
            edges = self.dependencies(marker)
            if edges is None:
                continue
            seen[marker] = seen.get(marker, 0) | added
            nid, slot, _ = marker
            if slot is not None:
                found[nid] = found.get(nid, 0) | added
            pending.extend((target, added) for target in edges)
        return found


def image_candidates(graph, object_info, roots=()):
    """Offer possible uses of each source without merging sources or binding any of them."""
    lineage = _ImageRoles(graph, object_info, roots)
    uses = lineage.roles()
    found = []
    for nid in graph:
        if not lineage.semantic.is_active(nid):
            continue
        outputs = lineage.types.outputs(nid)
        for field in lineage.source_fields(nid):
            roles = {"mask"} if field.lower() == "mask" or outputs == ["MASK"] else {"ref"}
            roles.update(role for role, bit in _ROLE_BITS.items() if uses.get(nid, 0) & bit)
            found.extend(B.Binding(role, nid, field, source="candidate") for role in sorted(roles))
    return found
