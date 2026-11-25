"""Read-only semantic routes, distinct from the complete execution dependency graph.

Matching input/output types or names do not prove that a node forwards its input.
Unknown scalar transformations require manual mapping or a trusted route contract.
Object-info remains type information, never an identity declaration.
"""

import re

from .workflow_slot_common import _consumer_index, _is_link

_BRANCHES = (("on_true", "on_false"), ("tt_value", "ff_value"), ("true_input", "false_input"))
_NUMBERED = re.compile(r"input_?(\d+)", re.I)
_NATIVE_IDENTITY = {"reroute", "primitivenode"}
_SCALARS = {"STRING": (str,), "INT": (int,), "FLOAT": (int, float), "BOOLEAN": (bool,)}
_UNKNOWN = object()


def _same_type(actual, expected):
    return actual == expected or actual == "*" or expected == "*"


class SemanticGraph:
    """Resolve native identity and selector payload routes without evaluating plugins.

    ``route_contracts`` is trusted caller configuration: class -> output index -> input
    field. It is separate from untrusted workflow and object-info data. Existing
    workflow-binding adapters remain the public seam for plugin integration.
    """

    def __init__(self, workflow, object_info=None, *, route_contracts=None):
        self.workflow = workflow
        self.info = object_info or {}
        self.route_contracts = route_contracts or {}
        self.users = _consumer_index(workflow)
        self._literal_cache = {}

    def _definition(self, nid):
        node = self.workflow.get(nid, {})
        definition = self.info.get(node.get("class_type"), {})
        return definition if isinstance(definition, dict) else {}

    def output_type(self, nid, slot):
        outputs = self._definition(nid).get("output", [])
        if type(slot) is int and 0 <= slot < len(outputs):
            return str(outputs[slot]).upper()
        return ""

    def _node(self, link, kind=None):
        if not _is_link(link, self.workflow):
            return None, "invalid-link"
        nid, slot = str(link[0]), link[1]
        node = self.workflow.get(nid)
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            return None, "missing-node"
        if type(slot) is not int or slot < 0:
            return None, "invalid-port"
        if node.get("mode") == 2:
            return None, "inactive-node"
        outputs = self._definition(nid).get("output", [])
        if outputs and slot >= len(outputs):
            return None, "invalid-port"
        output = self.output_type(nid, slot)
        if kind and output and not _same_type(output, kind):
            return None, "type-mismatch"
        return node, ""

    @staticmethod
    def _branches(inputs):
        for yes, no in _BRANCHES:
            if yes in inputs and no in inputs:
                return (yes, no), [value for key, value in inputs.items() if key not in (yes, no)]
        branches = [key for key in inputs if _NUMBERED.fullmatch(key)]
        if branches and "select" in inputs:
            return tuple(branches), [inputs["select"]]
        return (), []

    def _identity(self, node, slot):
        inputs = node["inputs"]
        declared = self.route_contracts.get(node.get("class_type"), {})
        field = declared.get(slot)
        if isinstance(field, str) and field in inputs:
            return (
                field if node.get("mode") != 4 or _is_link(inputs[field], self.workflow) else None
            )
        if slot != 0:
            return None
        native = str(node.get("class_type", "")).lower() in _NATIVE_IDENTITY
        # Bypassed widgets are inactive; one linked port has a unique bypass route.
        linked_bypass = (
            node.get("mode") == 4
            and len(inputs) == 1
            and _is_link(next(iter(inputs.values())), self.workflow)
        )
        if len(inputs) == 1 and ((native and node.get("mode") != 4) or linked_bypass):
            return next(iter(inputs))
        return None

    def _chosen(self, inputs, branches):
        if branches in _BRANCHES:
            values = [self._cached(value) for key, value in inputs.items() if key not in branches]
            bools = [value for value in values if type(value) is bool]
            return branches[0 if bools[0] else 1] if len(bools) == 1 else None
        selected = self._cached(inputs["select"])
        if type(selected) is int:
            matches = [key for key in branches if int(_NUMBERED.fullmatch(key)[1]) == selected]
            if len(matches) == 1:
                return matches[0]
        return None

    def _cached(self, value):
        if not _is_link(value, self.workflow):
            return value
        return self._literal_cache.get((str(value[0]), value[1]), _UNKNOWN)

    def _literal(self, value):
        """Evaluate only identity/selector contracts with an iterative bounded work stack."""
        if not _is_link(value, self.workflow):
            return value
        pending, visiting = [(value, False)], set()
        # Each expression enters at most twice; never recurse or invoke plugin code.
        budget = max(32, len(self.workflow) * 4)
        while pending and budget:
            budget -= 1
            link, expanded = pending.pop()
            marker = (str(link[0]), link[1])
            if marker in self._literal_cache:
                continue
            node, _ = self._node(link)
            if node is None:
                self._literal_cache[marker] = _UNKNOWN
                continue
            field = self._identity(node, link[1])
            branches, controls = self._branches(node["inputs"])
            if node.get("mode") == 4 and field is None:
                self._literal_cache[marker] = _UNKNOWN
                continue
            if field is None and (not branches or link[1] != 0):
                self._literal_cache[marker] = _UNKNOWN
                continue
            if expanded:
                visiting.discard(marker)
                if field is None:
                    field = self._chosen(node["inputs"], branches)
                self._literal_cache[marker] = (
                    self._cached(node["inputs"][field]) if field else _UNKNOWN
                )
                continue
            if marker in visiting:
                self._literal_cache[marker] = _UNKNOWN
                continue
            visiting.add(marker)
            pending.append((link, True))
            dependencies = (
                [node["inputs"][field]]
                if field
                else controls + [node["inputs"][key] for key in branches]
            )
            pending.extend(
                (dependency, False)
                for dependency in dependencies
                if _is_link(dependency, self.workflow)
            )
        return self._cached(value)

    def selection(self, nid, seen=None):
        """Static payload selection only; auxiliary outputs never inherit this route."""
        node = self.workflow.get(nid, {})
        inputs = node.get("inputs", {})
        branches, controls = self._branches(inputs)
        if not branches:
            return None, (), "not-router"
        for value in controls:
            self._literal(value)
        selected = self._chosen(inputs, branches)
        return selected, branches, "" if selected else "dynamic-selector"

    def route(self, link, kind=None):
        """Return (routes, reason); only ``not-router`` permits semantic caller fallback."""
        kind = str(kind).upper() if kind else None
        node, reason = self._node(link, kind)
        if node is None:
            return [], reason
        nid, slot = str(link[0]), link[1]
        field = self._identity(node, slot)
        if field is not None:
            return [(field, node["inputs"][field])], ""
        if node.get("mode") == 4:
            return [], "ambiguous-bypass"
        branches, _ = self._branches(node["inputs"])
        if branches:
            if slot != 0:
                return [], "undeclared-output-port"
            selected, _, reason = self.selection(nid)
            return ([(selected, node["inputs"][selected])], "") if selected else ([], reason)
        # Types and matching names cannot prove that arbitrary code preserves its input.
        return [], "not-router"

    def input_routes(self, link, kind=None):
        return self.route(link, kind)[0]

    def literal_origin(self, link, kind=None, sites=None):
        """A writable scalar must have an explicit identity route to its literal input."""
        kind = str(kind).upper() if kind else None
        seen, nid, reason = set(), "", "invalid-link"
        while _is_link(link, self.workflow):
            nid, slot = str(link[0]), link[1]
            if (nid, slot) in seen:
                reason = "cycle"
                break
            seen.add((nid, slot))
            node, reason = self._node(link, kind)
            if node is None:
                break
            if (
                sites
                and nid in sites
                and sites[nid]["kind"] in ("object", "syntax")
                and node.get("mode") != 4
            ):
                return {"nodeId": nid, "path": sites[nid]["path"], "writable": True, "reason": ""}
            routes, reason = self.route(link, kind)
            if len(routes) != 1:
                reason = "undeclared-origin" if reason == "not-router" else reason
                break
            field, value = routes[0]
            if _is_link(value, self.workflow):
                link = value
                continue
            expected = kind or self.output_type(nid, slot)
            allowed = _SCALARS.get(expected, ()) if expected else (str, int, float, bool)
            if type(value) not in allowed:
                reason = "type-mismatch"
                break
            return {"nodeId": nid, "path": field, "writable": True, "reason": ""}
        return {"nodeId": nid, "path": "", "writable": False, "reason": reason}

    def all_reachable(self, roots):
        """Actual dependencies, including inactive switch branches; safe execution closure."""
        seen, pending = set(), list(roots)
        while pending:
            nid = str(pending.pop())
            if nid in seen or nid not in self.workflow:
                continue
            seen.add(nid)
            pending.extend(
                str(value[0])
                for value in self.workflow[nid].get("inputs", {}).values()
                if _is_link(value, self.workflow)
            )
        return seen

    def is_active(self, nid):
        node = self.workflow.get(nid)
        return (
            isinstance(node, dict)
            and isinstance(node.get("inputs"), dict)
            and node.get("mode") not in (2, 4)
        )
