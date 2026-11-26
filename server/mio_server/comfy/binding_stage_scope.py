"""Conditioning-stage ambiguity can veto controls without changing canvas ownership.

An opaque conditioning dependency is not a reference contract or a new primary.
Only existing semantic routes are used to cross selectors and identity nodes.
"""

import re

from .binding_scope import CANVAS_PORTS, CANVAS_SIZE, NON_CANVAS_PORTS, _link

STAGE_CONTROL_KINDS = frozenset({"steps", "cfg", "sampler", "denoise", "scheduler"})
_CONDITION_PORT = re.compile(r"^(?:positive|negative|cond(?:itioning)?)(?:_?\d+)?$", re.I)
_OWNER_PORTS = {"guider", "pipe"}
_REFERENCE_PAYLOADS = {"image", "images", "pixels", "latent"}
_CONFIG_PORTS = NON_CANVAS_PORTS - {"positive", "negative", "conditioning", "guider"}


def ambiguous_conditioning_stage(binding_scope, sites):
    """Find an unexplained generation stage; never recommend or promote its controls."""
    graph, semantic = binding_scope.graph, binding_scope.semantic
    canvas = binding_scope.canvas_sites(sites)
    # Broad sampling-site fallbacks also recognize providers with model/positive/seed.
    # A provider without an input canvas is not evidence of another generation stage.
    other_stages = {
        nid
        for nid in set(sites) - canvas
        if semantic.is_active(nid)
        and any(
            field in CANVAS_PORTS and _link(value, graph)
            for field, value in graph[nid].get("inputs", {}).items()
        )
    }
    if not canvas or not other_stages:
        return False
    pending = [(nid, None, "owner") for nid in canvas]
    seen = set()
    while pending:
        nid, slot, context = pending.pop()
        marker = (nid, slot, context)
        if marker in seen or nid not in binding_scope.nodes:
            continue
        seen.add(marker)
        inputs = graph[nid].get("inputs", {})
        if slot is not None:
            routes, reason = semantic.route([nid, slot])
            if reason == "dynamic-selector":
                _, branches, _ = semantic.selection(nid)
                routes = [(field, inputs[field]) for field in branches]
            elif reason == "not-router":
                routes = None
            elif reason:
                # Auxiliary outputs never borrow a sibling payload route.
                continue
            if routes is not None:
                pending.extend(
                    (value[0], value[1], context) for _, value in routes if _link(value, graph)
                )
                continue
        if not semantic.is_active(nid):
            continue
        if context != "owner" and nid in other_stages:
            return True
        conditioning = any(_CONDITION_PORT.fullmatch(field) for field in inputs)
        for field, value in inputs.items():
            if not _link(value, graph):
                continue
            if _CONDITION_PORT.fullmatch(field):
                next_context = "conditioning"
            elif context == "owner":
                if field not in _OWNER_PORTS:
                    continue
                next_context = "owner"
            elif field in _CONFIG_PORTS or CANVAS_SIZE.fullmatch(field):
                continue
            elif conditioning and field in _REFERENCE_PAYLOADS:
                # Existing conditioning continuation + image/latent side-input contract.
                continue
            else:
                next_context = "opaque"
            pending.append((value[0], value[1], next_context))
    return False
