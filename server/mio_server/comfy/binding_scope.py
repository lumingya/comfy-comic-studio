"""Output-port-aware binding scope and primary generation-canvas lineage.

Execution dependency is broader than automatic binding ownership. Reference/control
inputs remain in the possible execution scope, but never establish a canvas stage.
"""

import re

CANVAS_PORTS = {
    "latent_image",
    "latent",
    "samples",
    "samples_to",
    "samples_from",
    "image",
    "images",
    "pixels",
    "pipe",
}
CANVAS_SIZE = re.compile(
    r"^(?:(?:empty_)?(?:latent|canvas|image|pixels)_)?(width|height|batch_size)$"
)
NON_CANVAS_PORTS = {
    "model",
    "clip",
    "vae",
    "positive",
    "negative",
    "conditioning",
    "guider",
    "noise",
    "seed",
    "noise_seed",
    "seed_num",
    "steps",
    "cfg",
    "sampler",
    "sampler_name",
    "sigmas",
    "scheduler",
    "denoise",
    "mask",
    "attn_mask",
    "noise_mask",
    "latent_mask",
    "mask_image",
    "reference_image",
    "upscaler",
    "upscale_model",
    "upscale_model_opt",
    "control_net",
    "clip_vision",
    "lora_stack",
    "prev_lora",
    "enable",
    "positive_prompt",
    "negative_prompt",
    "lora_syntax",
    "checkpoint_name",
    "ckpt_name",
}


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
        self.nodes, _ = self._walk([(nid, None) for nid in self.roots or graph])

    def _inputs(self, nid, slot, canvas):
        inputs = self.graph.get(nid, {}).get("inputs", {})
        if slot is None:
            return self._role_inputs(inputs, canvas)
        routes, reason = self.semantic.route([nid, slot])
        if reason == "dynamic-selector":
            _, branches, _ = self.semantic.selection(nid)
            return [(key, inputs[key]) for key in branches], True
        if reason == "not-router":
            return self._role_inputs(inputs, canvas)
        # In particular, an undeclared selector auxiliary output has no payload proof.
        return (routes, True) if not reason else (None, False)

    def _role_inputs(self, inputs, canvas):
        routes = [
            (key, value) for key, value in inputs.items() if not canvas or key in CANVAS_PORTS
        ]
        unresolved = canvas and any(
            _link(value, self.graph)
            and key not in CANVAS_PORTS
            and key not in NON_CANVAS_PORTS
            and not CANVAS_SIZE.fullmatch(key)
            for key, value in inputs.items()
        )
        return routes, not unresolved

    def _walk(self, roots, *, canvas=False):
        found, seen, pending, complete = set(), set(), list(roots), True
        while pending:
            nid, slot = pending.pop()
            marker = (nid, slot)
            if marker in seen or nid not in self.graph or self.graph[nid].get("mode") == 2:
                continue
            seen.add(marker)
            inputs, resolved = self._inputs(nid, slot, canvas)
            complete = complete and resolved
            if inputs is None:
                continue
            found.add(nid)
            pending.extend((value[0], value[1]) for _, value in inputs if _link(value, self.graph))
        return found, complete

    def canvas_sites(self, sites):
        """Return sampling sites on a complete, output-port-aware canvas lineage."""
        lineage, complete = self._walk([(nid, None) for nid in self.roots], canvas=True)
        return lineage.intersection(sites) if complete else set()

    def primary_sites(self, sites):
        """Select first stages only among samplers proven on the output canvas path."""
        pipeline = self.canvas_sites(sites)
        primary = set()
        for nid in pipeline:
            inputs, _ = self._inputs(nid, None, True)
            upstream, complete = self._walk(
                [(value[0], value[1]) for _, value in inputs if _link(value, self.graph)],
                canvas=True,
            )
            if complete and not upstream.intersection(pipeline - {nid}) and nid not in upstream:
                primary.add(nid)
        return primary
