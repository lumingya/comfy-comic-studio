"""Output-port-aware binding scope and primary generation-canvas lineage.

Execution dependency is broader than automatic binding ownership. Reference/control
inputs remain in the possible execution scope, but never establish a canvas stage.
"""

_CANVAS_PORTS = {"latent_image", "latent", "samples", "image", "images", "pixels", "pipe"}


def _link(value, graph):
    return (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], str)
        and value[0] in graph
        and type(value[1]) is int
        and value[1] >= 0
    )


class BindingScope:
    """Keep source output slots until every semantic route decision is made."""

    def __init__(self, graph, semantic, roots):
        self.graph, self.semantic, self.roots = graph, semantic, list(roots)
        # A sink root names a node, rather than pretending to consume its output 0.
        self.nodes = self._walk([(nid, None) for nid in self.roots or graph])

    def _inputs(self, nid, slot, canvas):
        inputs = self.graph.get(nid, {}).get("inputs", {})
        if slot is None:
            return [
                (key, value) for key, value in inputs.items() if not canvas or key in _CANVAS_PORTS
            ]
        routes, reason = self.semantic.route([nid, slot])
        if reason == "dynamic-selector":
            _, branches, _ = self.semantic.selection(nid)
            return [(key, inputs[key]) for key in branches]
        if reason == "not-router":
            return [
                (key, value) for key, value in inputs.items() if not canvas or key in _CANVAS_PORTS
            ]
        # In particular, an undeclared selector auxiliary output has no payload proof.
        return routes if not reason else None

    def _walk(self, roots, *, canvas=False):
        found, seen, pending = set(), set(), list(roots)
        while pending:
            nid, slot = pending.pop()
            marker = (nid, slot)
            if marker in seen or nid not in self.graph or self.graph[nid].get("mode") == 2:
                continue
            seen.add(marker)
            inputs = self._inputs(nid, slot, canvas)
            if inputs is None:
                continue
            found.add(nid)
            pending.extend((value[0], value[1]) for _, value in inputs if _link(value, self.graph))
        return found

    def primary_sites(self, sites):
        """Select first stages only among samplers proven on the output canvas path."""
        site_ids = set(sites)
        pipeline = self._walk([(nid, None) for nid in self.roots], canvas=True) & site_ids
        primary = set()
        for nid in pipeline:
            upstream = self._walk(
                [
                    (value[0], value[1])
                    for _, value in self._inputs(nid, None, True)
                    if _link(value, self.graph)
                ],
                canvas=True,
            )
            if not upstream.intersection(pipeline - {nid}) and nid not in upstream:
                primary.add(nid)
        return primary
