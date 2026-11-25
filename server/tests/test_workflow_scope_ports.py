"""Neutral output-port scope regressions; no inference or execution services."""

import copy
import unittest

from mio_server.comfy.workflow_slot_graph import Graph


def node(kind="NeutralNode", **inputs):
    return {"class_type": kind, "inputs": inputs}


def graph_info(enabled):
    if not enabled:
        return {}
    return {
        "NeutralModelSource": {"output": ["MODEL"]},
        "NeutralPortRouter": {
            "output": ["MODEL", "MODEL"],
            "output_name": ["input1", "input2"],
            "input": {"required": {"input1": ["MODEL"], "input2": ["MODEL"], "select": ["INT"]}},
        },
    }


def router_graph(*, payload=False, auxiliary=False):
    workflow = {
        "a": node("NeutralModelSource"),
        "b": node("NeutralModelSource"),
        "choice": node("NeutralPortRouter", input1=["a", 0], input2=["b", 0], select=1),
    }
    if payload:
        workflow["payload"] = node(model=["choice", 0])
    if auxiliary:
        workflow["auxiliary"] = node(model=["choice", 1])
    return workflow


class OutputPortScopeTests(unittest.TestCase):
    def test_payload_only_keeps_proven_unselected_branch_dead(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                graph = Graph(router_graph(payload=True), graph_info(declared))
                self.assertIn(("choice", "input2"), graph.blocked)
                self.assertIn("b", graph.dead)
                self.assertFalse(graph.edge("b", graph.users["b"][0]))
                self.assertTrue(graph.reaches("a", "payload"))
                self.assertFalse(graph.reaches("b", "payload"))

    def test_auxiliary_only_has_no_proven_blocked_payload_input(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                graph = Graph(router_graph(auxiliary=True), graph_info(declared))
                self.assertEqual(graph.semantic.route(["choice", 1])[1], "undeclared-output-port")
                self.assertNotIn(("choice", "input1"), graph.blocked)
                self.assertNotIn(("choice", "input2"), graph.blocked)

    def test_auxiliary_only_keeps_both_payload_origins_possible(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                graph = Graph(router_graph(auxiliary=True), graph_info(declared))
                self.assertNotIn("a", graph.dead)
                self.assertNotIn("b", graph.dead)

    def test_auxiliary_only_does_not_prove_payload_model_origin(self):
        for declared in (False, True):
            for origin in ("a", "b"):
                with self.subTest(schema=declared, origin=origin):
                    graph = Graph(router_graph(auxiliary=True), graph_info(declared))
                    self.assertFalse(graph.reaches(origin, "auxiliary"))

    def test_mixed_outputs_keep_possible_branch_in_scope(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                graph = Graph(router_graph(payload=True, auxiliary=True), graph_info(declared))
                self.assertNotIn(("choice", "input2"), graph.blocked)
                self.assertNotIn("b", graph.dead)

    def test_mixed_outputs_do_not_leak_payload_route_into_auxiliary(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                graph = Graph(router_graph(payload=True, auxiliary=True), graph_info(declared))
                self.assertTrue(graph.reaches("a", "payload"))
                self.assertFalse(graph.reaches("b", "payload"))
                self.assertFalse(graph.reaches("a", "auxiliary"))
                self.assertFalse(graph.reaches("b", "auxiliary"))

    def test_matching_schema_ports_are_types_not_identity_contracts(self):
        graph = Graph(router_graph(payload=True, auxiliary=True), graph_info(True))
        self.assertEqual(graph.output("choice", 1), "MODEL")
        self.assertEqual(
            graph.semantic.route(["choice", 1], "MODEL"), ([], "undeclared-output-port")
        )
        self.assertFalse(graph.reaches("a", "auxiliary"))

    def test_shared_origin_remains_live_only_on_its_proven_consumer_path(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                workflow = router_graph(payload=True)
                workflow["independent"] = node(model=["b", 0])
                graph = Graph(workflow, graph_info(declared))
                self.assertNotIn("b", graph.dead)
                self.assertTrue(graph.reaches("b", "independent"))
                self.assertFalse(graph.reaches("b", "payload"))
                self.assertTrue(graph.reaches("a", "payload"))

    def test_dead_auxiliary_consumer_does_not_keep_unselected_branch_live(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                workflow = router_graph(payload=True)
                workflow.update(
                    {
                        "auxiliary_route": node("Reroute", input=["choice", 1]),
                        "other": node("NeutralModelSource"),
                        "outer": node(
                            "NeutralPortRouter",
                            input1=["other", 0],
                            input2=["auxiliary_route", 0],
                            select=1,
                        ),
                        "outer_target": node(model=["outer", 0]),
                    }
                )
                graph = Graph(workflow, graph_info(declared))
                self.assertIn("auxiliary_route", graph.dead)
                self.assertNotIn("choice", graph.dead)
                self.assertIn(("choice", "input2"), graph.blocked)
                self.assertIn("b", graph.dead)
                self.assertTrue(graph.reaches("a", "payload"))
                self.assertFalse(graph.reaches("b", "payload"))

    def test_nested_reroute_preserves_the_entered_output_port(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                workflow = router_graph(payload=True)
                workflow.update(
                    {
                        "bridge": node("Reroute", input=["choice", 1]),
                        "other": node("NeutralModelSource"),
                        "outer": node(
                            "NeutralPortRouter",
                            input1=["bridge", 0],
                            input2=["other", 0],
                            select=1,
                        ),
                        "auxiliary": node(model=["outer", 0]),
                    }
                )
                graph = Graph(workflow, graph_info(declared))
                self.assertTrue(graph.reaches("a", "payload"))
                self.assertFalse(graph.reaches("a", "auxiliary"))
                self.assertFalse(graph.reaches("b", "auxiliary"))

    def test_unknown_output_cycle_is_bounded_and_not_proven_dead(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                workflow = router_graph(payload=True)
                workflow["loop"] = node("Reroute", input=["choice", 1])
                workflow["choice"]["inputs"]["input2"] = ["loop", 0]
                graph = Graph(workflow, graph_info(declared))
                self.assertNotIn("loop", graph.dead)
                self.assertTrue(graph.reaches("a", "payload"))
                self.assertFalse(graph.reaches("a", "loop"))
                self.assertFalse(graph.reaches("loop", "payload"))

    def test_dynamic_payload_selection_is_possible_but_not_a_proven_route(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                workflow = router_graph(payload=True)
                workflow["runtime"] = node("NeutralRuntimeInteger")
                workflow["choice"]["inputs"]["select"] = ["runtime", 0]
                graph = Graph(workflow, graph_info(declared))
                self.assertEqual(graph.semantic.route(["choice", 0])[1], "dynamic-selector")
                self.assertNotIn("a", graph.dead)
                self.assertNotIn("b", graph.dead)
                self.assertFalse(graph.reaches("a", "payload"))
                self.assertFalse(graph.reaches("b", "payload"))

    def test_invalid_auxiliary_port_cannot_exclude_a_payload_branch(self):
        for declared in (False, True):
            with self.subTest(schema=declared):
                workflow = router_graph(payload=True)
                workflow["invalid"] = node(model=["choice", -1])
                graph = Graph(workflow, graph_info(declared))
                self.assertEqual(graph.semantic.route(["choice", -1])[1], "invalid-port")
                self.assertNotIn("b", graph.dead)
                self.assertFalse(graph.reaches("a", "invalid"))

    def test_scope_queries_leave_the_source_graph_unchanged(self):
        workflow = router_graph(payload=True, auxiliary=True)
        before = copy.deepcopy(workflow)
        graph = Graph(workflow, graph_info(True))
        for origin in ("a", "b"):
            graph.active(origin)
            graph.edge(origin, graph.users[origin][0])
            for target in ("payload", "auxiliary"):
                graph.reaches(origin, target)
        self.assertEqual(workflow, before)


if __name__ == "__main__":
    unittest.main()
