"""Conservative generation-canvas and model-calibration size domains.

Execution dependencies and stage causality remain separate. This module recommends
literal writes only and never alters image, reference, control, or selector links.
"""

import re

_CANVAS_PORTS = {"latent_image", "latent", "samples", "image", "images", "pixels"}
_MODEL_PORTS = {"model", "guider", "pipe"}
_SIZE_PORTS = {"width", "height", "batch_size"}
_GEOMETRY_CONTROL = re.compile(
    r"(?:^|_)(?:aspect_?ratio|ratio|resolution|preset|size|scale|swap|crop|fit|mode)(?:$|_)",
    re.I,
)
_CANVAS_SIZE = re.compile(
    r"^(?:(?:empty_)?(?:latent|canvas|image|pixels)_)?(width|height|batch_size)$"
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


class _Dimensions:
    def __init__(self, graph, routes, scope, scalar):
        self.graph = graph
        self.routes = routes
        self.scope = scope
        self.scalar = scalar
        self.protected_roots = set()

    def inputs(self, nid):
        return self.graph.get(nid, {}).get("inputs", {})

    def dimension_dependencies(self, roots, role):
        """Follow canvas/model payloads without crossing into reference/control branches."""
        found, seen, pending = {}, set(), [(value, role) for value in roots]
        while pending:
            value, domain = pending.pop()
            if not _link(value, self.graph):
                continue
            nid, slot = value
            marker = (nid, slot, domain)
            if marker in seen or nid not in self.scope:
                continue
            seen.add(marker)
            routes, reason = self.routes.route(value)
            if reason == "dynamic-selector":
                _, branches, _ = self.routes.selection(nid)
                routes = [(field, self.inputs(nid)[field]) for field in branches]
            elif reason == "not-router":
                # A numeric helper can transform or replace its inputs. Width/height
                # input names do not prove that either consumed output is identity.
                if domain == "size":
                    continue
                ports = (
                    _MODEL_PORTS
                    if domain == "model"
                    else _CANVAS_PORTS | {"pipe"}
                    if domain == "canvas"
                    else set()
                )
                routes = [
                    (field, item)
                    for field, item in self.inputs(nid).items()
                    if field in ports | _SIZE_PORTS or _CANVAS_SIZE.fullmatch(field)
                ]
            elif reason:
                continue
            _, branches, _ = self.routes.selection(nid)
            followed = {field for field, _ in routes}
            self.protected_roots.update(
                item[0]
                for field, item in self.inputs(nid).items()
                if field not in followed and field not in branches and _link(item, self.graph)
            )
            found.setdefault(nid, set()).add(domain)
            pending.extend(
                (item, "size" if _CANVAS_SIZE.fullmatch(field) else domain)
                for field, item in routes
                if _link(item, self.graph)
            )
        return found

    def dimension_sources(self, dimensions):
        """Do not change a resolution literal also used by a protected size domain."""
        candidates = {}
        for nid, roles in dimensions.items():
            inputs = self.inputs(nid)
            if _CANVAS_PORTS.intersection(inputs):
                continue
            prefixes = [
                field[:-5]
                for field in inputs
                if field.endswith("width")
                and _CANVAS_SIZE.fullmatch(field)
                and (field == "width" or "canvas" in roles)
                and field[:-5] + "height" in inputs
            ]
            if len(prefixes) != 1:
                continue
            prefix = prefixes[0]
            # A preset/mode may ignore both literal dimensions. Even a value named
            # "custom" needs a trusted contract; never guess or change that control.
            candidates[nid] = (
                {}
                if any(
                    _GEOMETRY_CONTROL.search(field) and not _CANVAS_SIZE.fullmatch(field)
                    for field in inputs
                )
                else {"width": prefix + "width", "height": prefix + "height"}
            )
            batch = prefix + "batch_size" if prefix + "batch_size" in inputs else "batch_size"
            if batch in inputs:
                candidates[nid]["batch"] = batch
        protected = _ancestors(
            self.graph,
            list(self.protected_roots)
            + [
                value[0]
                for nid in self.graph
                for field, value in self.inputs(nid).items()
                if _CANVAS_SIZE.fullmatch(field)
                and field not in candidates.get(nid, {}).values()
                and _link(value, self.graph)
            ],
        )
        return candidates, protected


def infer_dimension_bindings(graph, routes, scope, primary, owners, scalar):
    """Return (kind, node, field) recommendations using the caller's scalar resolver."""
    engine = _Dimensions(graph, routes, scope, scalar)
    canvas_dependencies = engine.dimension_dependencies(
        [
            value
            for nid in primary
            for field, value in engine.inputs(nid).items()
            if field in _CANVAS_PORTS | {"pipe"} and _link(value, graph)
        ],
        "canvas",
    )
    model_dependencies = engine.dimension_dependencies(
        [
            value
            for nid in primary | set(owners)
            for field, value in engine.inputs(nid).items()
            if field in _MODEL_PORTS and _link(value, graph)
        ],
        "model",
    )
    dimension_roles = {nid: set(roles) for nid, roles in canvas_dependencies.items()}
    for nid, roles in model_dependencies.items():
        dimension_roles.setdefault(nid, set()).update(roles)
    dimensions, protected_dimensions = engine.dimension_sources(dimension_roles)
    canvas_sizes = set()
    for nid in canvas_dependencies:
        fields = dimensions.get(nid, {})
        if "width" not in fields or "height" not in fields or "model" in engine.inputs(nid):
            continue
        sizes = [engine.scalar(nid, fields[kind], kind) for kind in ("width", "height")]
        if all(sizes):
            canvas_sizes.add(tuple(engine.inputs(n).get(field) for n, field in sizes))
    ambiguous_size = len(canvas_sizes) > 1
    found = []
    for nid in graph:
        if nid not in dimensions or not routes.is_active(nid):
            continue
        for kind, field in dimensions[nid].items():
            if ambiguous_size and kind in ("width", "height"):
                continue
            target = scalar(nid, field, kind)
            if target and target[0] not in protected_dimensions:
                found.append((kind, *target))
    return found
