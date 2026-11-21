"""Read-only routing of exported API edges; never rewrites the execution graph.

Routing is deliberately narrower than dependency traversal. A dynamic selector or an
ambiguous bus port cannot identify a writable origin. Callers can still display the
actual dependencies and offer explicit mappings for those cases.
"""

import re

from .workflow_slot_common import _consumer_index, _is_link

_BRANCHES = (("on_true", "on_false"), ("tt_value", "ff_value"), ("true_input", "false_input"))
_NUMBERED = re.compile(r"input_?(\d+)", re.I)
_REROUTES = {"reroute", "primitivenode"}


def _type(rule):
    return str(rule[0]).upper() if isinstance(rule, (list, tuple)) and rule else ""


def _same_type(actual, expected):
    return actual == expected or actual == "*" or expected == "*"


class SemanticGraph:
    """Resolve explicit selectors and declared output ports without guessing widget order."""

    def __init__(self, workflow, object_info=None):
        self.workflow = workflow
        self.info = object_info or {}
        self.users = _consumer_index(workflow)

    def _definition(self, nid):
        node = self.workflow.get(nid, {})
        definition = self.info.get(node.get("class_type"), {})
        return definition if isinstance(definition, dict) else {}

    def output_type(self, nid, slot):
        outputs = self._definition(nid).get("output", [])
        if type(slot) is int and 0 <= slot < len(outputs):
            return str(outputs[slot]).upper()
        return ""

    def _literal(self, value, seen):
        if not _is_link(value, self.workflow):
            return value
        origin = self._origin(value, None, None, seen)
        if origin["writable"]:
            return self.workflow[origin["nodeId"]]["inputs"][origin["path"]]
        return None

    def selection(self, nid, seen=None):
        """Return (selected input, all branch inputs, reason), or no branch contract."""
        inputs = self.workflow.get(nid, {}).get("inputs", {})
        seen = set() if seen is None else seen
        for yes, no in _BRANCHES:
            if yes not in inputs or no not in inputs:
                continue
            controls = [self._literal(v, seen) for k, v in inputs.items() if k not in (yes, no)]
            bools = [value for value in controls if type(value) is bool]
            if len(bools) == 1:
                return yes if bools[0] else no, (yes, no), ""
            return None, (yes, no), "dynamic-selector"
        branches = [key for key in inputs if _NUMBERED.fullmatch(key)]
        if branches and "select" in inputs:
            selected = self._literal(inputs["select"], seen)
            if type(selected) is int:
                match = [key for key in branches if int(_NUMBERED.fullmatch(key)[1]) == selected]
                if len(match) == 1:
                    return match[0], branches, ""
            return None, branches, "dynamic-selector"
        return None, (), "not-router"

    def route(self, link, kind=None):
        """Return (input routes, reason). ``not-router`` permits semantic caller fallback.

        Other failure reasons prohibit fallback: scanning both branches of an unresolved
        switch or both equally typed bus ports would create misleading writable targets.
        """
        return self._route(link, str(kind).upper() if kind else None, set())

    def input_routes(self, link, kind=None):
        return self.route(link, kind)[0]

    def _route(self, link, kind, seen):
        if not _is_link(link, self.workflow):
            return [], "invalid-link"
        nid, slot = str(link[0]), link[1]
        node = self.workflow.get(nid)
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            return [], "missing-node"
        if type(slot) is not int or slot < 0:
            return [], "invalid-port"
        inputs = node["inputs"]
        if node.get("mode") == 2:
            return [], "inactive-node"
        definition = self._definition(nid)
        output = self.output_type(nid, slot)
        if kind and output and not _same_type(output, kind):
            return [], "type-mismatch"
        if definition.get("output") and slot >= len(definition["output"]):
            return [], "invalid-port"
        selected, branches, reason = self.selection(nid, seen | {(nid, slot)})
        if branches:
            return ([(selected, inputs[selected])], "") if selected else ([], reason)
        rules = definition.get("input", {})
        rules = {**rules.get("required", {}), **rules.get("optional", {})}
        names = definition.get("output_name", [])
        # Output names disambiguate repeated types, e.g. positive/negative conditioning.
        if slot < len(names):
            name = str(names[slot])
            match = next((key for key in inputs if key.lower() == name.lower()), None)
            if match and (not output or _same_type(_type(rules.get(match)), output)):
                if _is_link(inputs[match], self.workflow):
                    return [(match, inputs[match])], ""
        if output and output != "*":
            candidates = [key for key in inputs if _type(rules.get(key)) == output]
            if len(candidates) == 1 and _is_link(inputs[candidates[0]], self.workflow):
                key = candidates[0]
                return [(key, inputs[key])], ""
            if len(candidates) > 1 and len(definition.get("output", [])) > 1:
                return [], "ambiguous-port"
        linked = [(key, value) for key, value in inputs.items() if _is_link(value, self.workflow)]
        reroute = str(node.get("class_type", "")).lower() in _REROUTES
        # Explicit bypass may forward an unambiguous input, but its own widgets are inactive.
        if (reroute or node.get("mode") == 4) and len(linked) == len(inputs) == 1:
            return linked, ""
        if node.get("mode") == 4:
            return [], "ambiguous-bypass"
        return [], "not-router"

    def literal_origin(self, link, kind=None, sites=None):
        """Return the single writable scalar origin, or a stable reason for manual mapping."""
        return self._origin(link, str(kind).upper() if kind else None, sites, set())

    def _origin(self, link, kind, sites, seen):
        nid = ""
        reason = "invalid-link"
        while _is_link(link, self.workflow):
            nid, slot = str(link[0]), link[1]
            marker = (nid, slot)
            if marker in seen:
                reason = "cycle"
                break
            seen = seen | {marker}
            node = self.workflow.get(nid)
            if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
                reason = "missing-node"
                break
            output = self.output_type(nid, slot)
            if kind and output and not _same_type(output, kind):
                reason = "type-mismatch"
                break
            routes, reason = self._route(link, kind, seen)
            if reason not in ("", "not-router"):
                break
            if sites and nid in sites and sites[nid]["kind"] in ("object", "syntax"):
                return {"nodeId": nid, "path": sites[nid]["path"], "writable": True, "reason": ""}
            if len(routes) == 1:
                path, value = routes[0]
                if _is_link(value, self.workflow):
                    link = value
                    continue
                expected = kind or output
                types = {"STRING": (str,), "INT": (int,), "FLOAT": (int, float), "BOOLEAN": (bool,)}
                if expected and type(value) not in types.get(expected, ()):
                    reason = "type-mismatch"
                    break
                return {"nodeId": nid, "path": path, "writable": True, "reason": ""}
            inputs = node["inputs"]
            if any(_is_link(value, self.workflow) for value in inputs.values()):
                reason = "ambiguous-origin"
                break
            expected = kind or output
            types = {"STRING": (str,), "INT": (int,), "FLOAT": (int, float), "BOOLEAN": (bool,)}
            allowed = types.get(expected, ()) if expected else (str, int, float, bool)
            candidates = [key for key, value in inputs.items() if type(value) in allowed]
            if len(candidates) == 1:
                return {"nodeId": nid, "path": candidates[0], "writable": True, "reason": ""}
            reason = "ambiguous-origin"
            break
        return {"nodeId": nid, "path": "", "writable": False, "reason": reason}

    def all_reachable(self, roots):
        """Actual dependencies, including inactive switch branches; safe for execution closure."""
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
