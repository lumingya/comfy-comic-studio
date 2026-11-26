"""Conservative binding inference from data ports, independent of plugin class lists.

This module only recommends literal targets. It never rewrites links, evaluates custom
nodes or uses inferred reachability to remove executable nodes.
"""

from __future__ import annotations

import re

from .binding_dimensions import infer_dimension_bindings
from .binding_scope import BindingScope
from .binding_stage_scope import STAGE_CONTROL_KINDS, ambiguous_conditioning_stage
from .workflow_graph import SemanticGraph

TEXT_PORTS = (
    "text",
    "prompt",
    "positive",
    "string",
    "value",
    "text_g",
    "text_l",
    "clip_l",
    "clip_g",
    "t5xxl",
    "text_t5",
)
SCALAR_PORTS = {
    "seed": ("seed", "noise_seed", "seed_num"),
    "width": ("width",),
    "height": ("height",),
    "batch": ("batch_size",),
    "steps": ("steps",),
    "cfg": ("cfg",),
    "denoise": ("denoise",),
    "sampler": ("sampler_name",),
    "scheduler": ("scheduler",),
}
_POSITIVE_PORT = re.compile(r"^(?:positive|cond(?:itioning)?)(?:_?\d+)?$", re.I)
_TEXT_PORT = re.compile(r"^(?:text|prompt|string)(?:[_ \d].*)?$", re.I)
_CONTROL_PORT = re.compile(
    r"(?:^|_)(?:clip|model|vae|filename|path|language|lang|separator|delimiter|mode|format)$", re.I
)


def _link(value, graph):
    return (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], str)
        and value[0] in graph
        and type(value[1]) is int
        and value[1] >= 0
    )


def _ancestors(graph, roots):
    seen, pending = set(), list(roots)
    while pending:
        nid = pending.pop()
        if nid in seen or nid not in graph:
            continue
        seen.add(nid)
        pending.extend(v[0] for v in graph[nid].get("inputs", {}).values() if _link(v, graph))
    return seen


def image_outputs(graph: dict) -> list[str]:
    """Recognize image sinks by image ports and save/preview intent, retaining branches."""
    saves, previews = [], []
    for nid, node in graph.items():
        if node.get("mode") in (2, 4):
            continue
        inputs = node.get("inputs", {})
        cls = str(node.get("class_type", "")).lower()
        if not any(_link(inputs.get(k), graph) for k in ("images", "image")):
            continue
        if "save" in cls and ("image" in cls or "images" in inputs):
            saves.append(nid)
        elif "preview" in cls or ("output" in cls and "image" in cls):
            previews.append(nid)
    saved = _ancestors(graph, saves)
    # A separate preview branch remains available; a preview of a saved path is redundant.
    return saves + [
        nid
        for nid in previews
        if not saves
        or not any(
            _link(v, graph) and v[0] in saved
            for k, v in graph[nid].get("inputs", {}).items()
            if k in ("images", "image")
        )
    ]


class _Inference:
    def __init__(self, graph, roots):
        self.graph = graph
        self.routes = SemanticGraph(graph)
        self.binding_scope = BindingScope(graph, self.routes, roots)
        self.scope = self.binding_scope.nodes
        self.users = {}
        for nid in self.scope:
            for field, value in self.inputs(nid).items():
                if _link(value, graph):
                    self.users.setdefault(value[0], []).append((nid, field))

    def inputs(self, nid):
        return self.graph.get(nid, {}).get("inputs", {})

    def scalar(self, nid, field, kind):
        value = self.inputs(nid).get(field)
        target = (nid, field)
        if _link(value, self.graph):
            expected = (
                "STRING"
                if kind in ("sampler", "scheduler")
                else "INT"
                if kind in ("seed", "width", "height", "batch", "steps")
                else "FLOAT"
            )
            origin = self.routes.literal_origin(value, expected)
            if not origin.get("writable") or not origin.get("path"):
                return None
            target = (origin["nodeId"], origin["path"])
            value = self.inputs(target[0]).get(target[1])
        if not self.routes.is_active(target[0]):
            return None
        if kind in ("sampler", "scheduler"):
            valid = isinstance(value, str)
        elif kind in ("seed", "width", "height", "batch", "steps"):
            valid = type(value) is int and (kind == "seed" or value > 0)
        else:
            valid = type(value) in (int, float)
        return target if valid else None

    def string_sources(self, link, *, all_origins=False):
        """A string assembly with several editable terms requires an explicit mapping."""
        found, seen, pending = set(), set(), [link]
        while pending:
            value = pending.pop()
            if not _link(value, self.graph):
                continue
            nid, slot = value
            if (nid, slot) in seen or nid not in self.scope:
                continue
            seen.add((nid, slot))
            routes, reason = self.routes.route(value, "STRING")
            if reason not in ("", "not-router") and not all_origins:
                return []
            if reason != "":
                inputs = self.inputs(nid)
                fields = [k for k in inputs if k in TEXT_PORTS or _TEXT_PORT.fullmatch(k)]
                if not fields:
                    fields = [k for k in inputs if not _CONTROL_PORT.search(k)]
                routes = [(k, inputs[k]) for k in fields]
            for field, item in routes:
                if _link(item, self.graph):
                    pending.append(item)
                elif isinstance(item, str):
                    found.add((nid, field))
        return sorted(found)

    def encoder_sources(self, nid, *, all_origins=False):
        groups = []
        for field, value in self.inputs(nid).items():
            if field not in TEXT_PORTS and not _TEXT_PORT.fullmatch(field):
                continue
            sources = (
                self.string_sources(value, all_origins=all_origins)
                if _link(value, self.graph)
                else ([(nid, field)] if isinstance(value, str) else [])
            )
            if len(sources) != 1 and not all_origins:
                return []
            groups.extend(sources)
        unique = list(dict.fromkeys(groups))
        # Dual/triple text encoders commonly duplicate the same prompt across text ports.
        # Distinct regional/language prompts must retain their individual meaning.
        values = {self.inputs(n).get(f) for n, f in unique}
        return unique if all_origins or len(values) == 1 else []

    def conditioning_sources(self, value, kind, *, all_origins=False):
        found, seen, pending = set(), set(), [value]
        while pending:
            link = pending.pop()
            if not _link(link, self.graph):
                continue
            nid, slot = link
            if (nid, slot) in seen or nid not in self.scope:
                continue
            seen.add((nid, slot))
            inputs = self.inputs(nid)
            cls = str(self.graph[nid].get("class_type", "")).lower()
            routes, reason = self.routes.route(link, "CONDITIONING")
            if reason not in ("", "not-router") and not all_origins:
                return []
            if (
                reason == "not-router"
                and self.routes.is_active(nid)
                and ("textencode" in cls or ("clip" in inputs and "text" in inputs))
            ):
                sources = self.encoder_sources(nid, all_origins=all_origins)
                if not sources and not all_origins:
                    return []
                found.update(sources)
                # A text-bearing node may append regional conditioning to an existing
                # chain. Its local text does not replace the incoming text's meaning.
                if not any(
                    _link(item, self.graph)
                    and (
                        field == "negative"
                        or _POSITIVE_PORT.fullmatch(field)
                        or "conditioning" in field.lower()
                    )
                    for field, item in inputs.items()
                ):
                    continue
            if reason != "":
                port = "positive" if kind == "prompt" else "negative"
                if "positive" in inputs and "negative" in inputs:
                    # Input roles do not declare output order. A custom paired node may
                    # reorder its ports, or its two outputs may be crosswired downstream.
                    if not all_origins:
                        return []
                    routes = [(k, inputs[k]) for k in ("positive", "negative")]
                elif port in inputs:
                    routes = [(port, inputs[port])]
                else:
                    routes = [
                        (k, v)
                        for k, v in inputs.items()
                        if "conditioning" in k.lower()
                        or (all_origins and _POSITIVE_PORT.fullmatch(k))
                    ]
                    if not routes and all_origins:
                        _, branches, _ = self.routes.selection(nid)
                        routes = [(k, inputs[k]) for k in branches]
            if all_origins and reason != "":
                routes.extend((k, v) for k, v in inputs.items() if _POSITIVE_PORT.fullmatch(k))
            if not routes:
                if not all_origins:
                    return []
                continue
            pending.extend(v for _, v in routes if _link(v, self.graph))
        # Different encoders combined for regions/averaging are not a single text slot.
        values = {self.inputs(n).get(f) for n, f in found}
        return sorted(found) if all_origins or len(values) == 1 else []

    def sampling_sites(self):
        sites = []
        for nid in self.graph:
            if nid not in self.scope:
                continue
            inputs = self.inputs(nid)
            cls = str(self.graph[nid].get("class_type", "")).lower()
            latent = any(k in inputs for k in ("latent_image", "latent", "samples"))
            conditioning = any(k in inputs for k in ("positive", "conditioning", "guider"))
            sampling = any(
                k in inputs
                for k in (
                    "model",
                    "noise",
                    "guider",
                    "sampler",
                    "sigmas",
                    "seed",
                    "noise_seed",
                    "seed_num",
                    "steps",
                )
            )
            if (
                (latent and conditioning and sampling)
                or ("model" in inputs and "positive" in inputs and "seed" in inputs)
                or ("sampler" in cls and "pipe" in inputs)
            ):
                sites.append(nid)
        return sites

    def primary_sites(self, sites):
        return self.binding_scope.primary_sites(sites)

    def prompt_owners(self, sites, *, primary_only=True):
        owners = set(self.primary_sites(sites) if primary_only else sites)
        for nid in list(owners):
            for port in ("guider", "pipe"):
                value = self.inputs(nid).get(port)
                pending, seen = [value], set()
                while pending:
                    link = pending.pop()
                    if not _link(link, self.graph) or link[0] in seen or link[0] not in self.scope:
                        continue
                    source = link[0]
                    seen.add(source)
                    routes, reason = self.routes.route(link)
                    if reason == "":
                        pending.extend(v for _, v in routes)
                    elif reason == "not-router":
                        inputs = self.inputs(source)
                        if "negative" in inputs or any(_POSITIVE_PORT.fullmatch(k) for k in inputs):
                            owners.add(source)
                        elif port in inputs:
                            pending.append(inputs[port])
        if not owners and not sites:
            owners = {
                nid
                for nid in self.scope
                if "model" in self.inputs(nid)
                and any(k in self.inputs(nid) for k in ("positive", "conditioning"))
            }
        return [nid for nid in self.graph if nid in owners]

    def positive_literals(self, owners):
        """Protect every positive dependency, including fixed/ambiguous prompt regions.

        Automatic negative binding must never change a string used by a positive path,
        even when a different region already has an explicit prompt binding.
        """
        literals = set()
        for nid in owners:
            for field, value in self.inputs(nid).items():
                if not _POSITIVE_PORT.fullmatch(field):
                    continue
                if isinstance(value, str):
                    literals.add((nid, field))
                elif _link(value, self.graph):
                    literals.update(self.conditioning_sources(value, "prompt", all_origins=True))
        return literals


def infer_bindings(graph: dict, missing: set[str], roots=()) -> list[tuple[str, str, str | None]]:
    """Return deterministic (kind, node, literal field) recommendations; outputs have no field."""
    outputs = list(roots) or image_outputs(graph)
    engine = _Inference(graph, outputs)
    found = [("output", nid, None) for nid in outputs] if "output" in missing else []
    sites = engine.sampling_sites()
    primary = set(engine.primary_sites(sites))
    owners = engine.prompt_owners(sites)
    found.extend(
        item
        for item in infer_dimension_bindings(
            graph, engine.routes, engine.scope, primary, owners, engine.scalar
        )
        if item[0] in missing
    )
    text_targets = {"prompt": [], "negative": []}
    for nid in owners:
        inputs = engine.inputs(nid)
        for kind, ports in (("prompt", ("positive", "conditioning")), ("negative", ("negative",))):
            if kind not in missing:
                continue
            for field in ports:
                value = inputs.get(field)
                if isinstance(value, str):
                    text_targets[kind].append((nid, field))
                elif _link(value, graph):
                    text_targets[kind].extend(engine.conditioning_sources(value, kind))
    # Positive dependencies include fixed regions which intentionally have no auto binding.
    positive_literals = engine.positive_literals(engine.prompt_owners(sites, primary_only=False))
    text_targets["negative"] = [t for t in text_targets["negative"] if t not in positive_literals]
    # Unresolved output switches retain all possible scalar control sites. Different text
    # origins across those possible generation branches still require an explicit choice.
    for kind, targets in text_targets.items():
        if len({engine.inputs(nid).get(field) for nid, field in targets}) > 1:
            text_targets[kind] = []
    found.extend((kind, n, f) for kind, targets in text_targets.items() for n, f in targets)
    for nid in graph:
        if nid not in engine.scope:
            continue
        if not engine.routes.is_active(nid):
            continue
        inputs = engine.inputs(nid)
        cls = str(graph[nid].get("class_type", "")).lower()
        noise = any(
            field in ("noise", "seed", "noise_seed") for _, field in engine.users.get(nid, [])
        )
        scalar_kinds = set(SCALAR_PORTS) - {"width", "height", "batch"} if nid in primary else set()
        if nid in sites:
            scalar_kinds.add("seed")
        consumer_ports = {field for user, field in engine.users.get(nid, []) if user in primary}
        if "guider" in consumer_ports and "cfg" in inputs:
            scalar_kinds.add("cfg")
        if "sigmas" in consumer_ports:
            scalar_kinds.update(("steps", "denoise", "scheduler"))
        if "sampler" in consumer_ports:
            scalar_kinds.add("sampler")
        if noise or "noise" in cls or "seed" in cls:
            scalar_kinds.add("seed")
        for kind in SCALAR_PORTS:
            if kind not in missing or kind not in scalar_kinds:
                continue
            for field in SCALAR_PORTS[kind]:
                if field in inputs:
                    target = engine.scalar(nid, field, kind)
                    if target:
                        found.append((kind, *target))
                    break
    # Canvas ownership does not prove which conditioning-connected generation stage
    # should receive generic controls. Filter providers too, without changing explicit
    # mappings, canvas dimensions, prompt ownership, or execution seed fan-out.
    if missing & STAGE_CONTROL_KINDS and ambiguous_conditioning_stage(engine.binding_scope, sites):
        found = [item for item in found if item[0] not in STAGE_CONTROL_KINDS]
    claims = {}
    for kind, nid, field in found:
        if field is not None:
            claims.setdefault((nid, field), set()).add(kind)
    return list(
        dict.fromkeys(item for item in found if item[2] is None or len(claims[item[1:]]) == 1)
    )
