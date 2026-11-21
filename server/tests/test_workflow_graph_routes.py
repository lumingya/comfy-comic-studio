"""Synthetic, publisher-independent scalar and model routing regressions."""

import copy
import unittest

from mio_server.comfy.workflow_graph import SemanticGraph
from mio_server.comfy.workflow_slot_graph import Graph, trace_origin


def node(kind="Unspecified", **inputs):
    return {"class_type": kind, "inputs": inputs}


def definition(outputs, *, names=(), **inputs):
    return {"output": outputs, "output_name": names, "input": {"required": inputs}}


class SemanticGraphTests(unittest.TestCase):
    def test_deep_reroutes_find_single_literal_without_mutating_edges(self):
        workflow = {"leaf": node("TextValue", value="synthetic text")}
        parent = "leaf"
        for i in range(180):
            workflow[str(i)] = node("Reroute", input=[parent, 0])
            parent = str(i)
        original = copy.deepcopy(workflow)
        origin = trace_origin(workflow, [parent, 0])
        self.assertTrue(origin["writable"])
        self.assertEqual((origin["nodeId"], origin["path"]), ("leaf", "value"))
        self.assertEqual(workflow, original)

    def test_literal_selector_through_deep_primitive_chain(self):
        workflow = {
            "first": node(value="first"),
            "second": node(value="second"),
            "index": node("IntegerValue", value=2),
        }
        parent = "index"
        for i in range(20):
            workflow[str(i)] = node("PrimitiveNode", value=[parent, 0])
            parent = str(i)
        workflow["switch"] = node(select=[parent, 0], input_1=["first", 0], input_2=["second", 0])
        graph = SemanticGraph(workflow)
        self.assertEqual(graph.selection("switch")[0], "input_2")
        self.assertEqual(graph.literal_origin(["switch", 0], "STRING")["nodeId"], "second")
        # Semantic selection must not remove either executable dependency.
        self.assertEqual(graph.all_reachable(["switch"]), set(workflow))

    def test_dynamic_selector_is_explicitly_unresolved(self):
        workflow = {
            "a": node(value="a"),
            "b": node(value="b"),
            "switch": node(select=["runtime", 0], input1=["a", 0], input2=["b", 0]),
            "runtime": node("RemoteInteger", url="synthetic.invalid", token_index=1),
        }
        origin = SemanticGraph(workflow).literal_origin(["switch", 0], "STRING")
        self.assertFalse(origin["writable"])
        self.assertEqual(origin["reason"], "dynamic-selector")

    def test_boolean_selector_with_linked_boolean_literal(self):
        workflow = {
            "condition": node("PrimitiveNode", value=False),
            "a": node(value=8),
            "b": node(value=12),
            "switch": node(on_true=["a", 0], on_false=["b", 0], boolean=["condition", 0]),
        }
        origin = SemanticGraph(workflow).literal_origin(["switch", 0], "INT")
        self.assertTrue(origin["writable"])
        self.assertEqual(origin["nodeId"], "b")

    def test_repeated_bus_types_require_named_output_ports(self):
        workflow = {
            "a": node(value="positive"),
            "b": node(value="negative"),
            "bus": node("ExampleBus", positive=["a", 0], negative=["b", 0]),
        }
        info = {
            "ExampleBus": definition(
                ["STRING", "STRING"],
                names=["positive", "negative"],
                positive=["STRING"],
                negative=["STRING"],
            )
        }
        graph = SemanticGraph(workflow, info)
        self.assertEqual(graph.literal_origin(["bus", 1], "STRING")["nodeId"], "b")
        info["ExampleBus"].pop("output_name")
        origin = SemanticGraph(workflow, info).literal_origin(["bus", 1], "STRING")
        self.assertFalse(origin["writable"])
        self.assertEqual(origin["reason"], "ambiguous-port")

    def test_distinct_bus_types_follow_requested_output_slot(self):
        workflow = {
            "number": node(value=19),
            "text": node(value="synthetic"),
            "bus": node("ExampleBus", text=["text", 0], number=["number", 0]),
        }
        info = {"ExampleBus": definition(["STRING", "INT"], text=["STRING"], number=["INT"])}
        graph = SemanticGraph(workflow, info)
        self.assertEqual(graph.literal_origin(["bus", 1], "INT")["nodeId"], "number")
        self.assertEqual(graph.literal_origin(["bus", 0], "STRING")["nodeId"], "text")
        self.assertEqual(graph.literal_origin(["bus", 1], "STRING")["reason"], "type-mismatch")

    def test_modes_never_expose_inactive_widgets_as_writable_origins(self):
        workflow = {
            "leaf": node(value="synthetic"),
            "muted": {**node("Reroute", input=["leaf", 0]), "mode": 2},
            "bypass": {**node("UnusedOperation", input=["leaf", 0]), "mode": 4},
            "bypass_value": {**node(value="unused widget"), "mode": 4},
        }
        graph = SemanticGraph(workflow)
        self.assertEqual(graph.literal_origin(["muted", 0], "STRING")["reason"], "inactive-node")
        self.assertEqual(graph.literal_origin(["bypass", 0], "STRING")["nodeId"], "leaf")
        self.assertFalse(graph.literal_origin(["bypass_value", 0], "STRING")["writable"])

    def test_invalid_cycles_ports_and_non_scalar_origins_are_readonly(self):
        workflow = {
            "a": node("Reroute", input=["b", 0]),
            "b": node("Reroute", input=["a", 0]),
            "leaf": node(value=True),
            "list": node(value=[1, 2, 3]),
            "concat": node(first="a", second="b"),
        }
        graph = SemanticGraph(workflow)
        for link, reason in (
            (["a", 0], "cycle"),
            (["missing", 0], "missing-node"),
            (["leaf", -1], "invalid-port"),
            (["leaf", 0], "ambiguous-origin"),
            (["list", 0], "ambiguous-origin"),
            (["concat", 0], "ambiguous-origin"),
        ):
            with self.subTest(link=link):
                origin = graph.literal_origin(link, "INT" if link[0] == "leaf" else "STRING")
                self.assertFalse(origin["writable"])
                self.assertEqual(origin["reason"], reason)


class ModelRouteTests(unittest.TestCase):
    def test_declared_model_type_cannot_reactivate_blocked_switch_input(self):
        workflow = {
            "a": node("ModelLoader"),
            "b": node("ModelLoader"),
            "switch": node(select=2, input1=["a", 0], input2=["b", 0]),
            "sample": node("KSampler", model=["switch", 0]),
        }
        graph = Graph(workflow, {"ModelLoader": definition(["MODEL"])})
        self.assertFalse(graph.edge("a", graph.users["a"][0]))
        self.assertTrue(graph.edge("b", graph.users["b"][0]))
        self.assertFalse(graph.active("a")[0])
        self.assertTrue(graph.active("b")[0])

    def test_unknown_model_routes_cross_reroute_and_branch_shared_elsewhere_stays_live(self):
        workflow = {
            "a": node(),
            "b": node(),
            "reroute": node("Reroute", input=["a", 0]),
            "switch": node(on_true=["reroute", 0], on_false=["b", 0], condition=False),
            "sample": node("KSampler", model=["switch", 0]),
        }
        self.assertFalse(Graph(workflow, {}).active("a")[0])
        workflow["other"] = node("KSampler", model=["reroute", 0])
        graph = Graph(workflow, {})
        self.assertTrue(graph.active("a")[0])
        self.assertTrue(graph.reaches("a", "other"))
        self.assertFalse(graph.reaches("a", "sample"))


if __name__ == "__main__":
    unittest.main()
