"""Immutable PCP compile plans and write-ahead restoration, without a live ComfyUI."""

from __future__ import annotations

import copy
import unittest
from urllib.parse import parse_qs, urlsplit

from mio_server.comfy import adapters
from mio_server.comfy.bindings import BindingError
from mio_server.comfy.client import ComfyError
from mio_server.comfy.compile import compile_workflow, validate_plan
from mio_server.render_models import WorkflowDoc


def state(value=20):
    return [
        {"name": "steps", "type": "custom-number", "value": value},
        {"name": "options", "type": "plugin-structured", "value": {"flags": [True]}},
    ]


def workflow():
    return WorkflowDoc(
        name="PCP",
        graph={
            "1": {"class_type": "ParameterControlPanel", "inputs": {"pcp_ui": ""}},
            "2": {
                "class_type": "SaveImage",
                "inputs": {"images": ["1", 0]},
                "_meta": {"title": "[mio:output:draft]"},
            },
            "3": {"class_type": "ParameterControlPanel", "inputs": {"pcp_ui": ""}},
            "4": {
                "class_type": "SaveImage",
                "inputs": {"images": ["3", 0]},
                "_meta": {"title": "[mio:output:final]"},
            },
        },
        config={"state": {"1": state(), "3": state(40)}},
    )


class CompileStateTests(unittest.TestCase):
    def test_variant_replaces_state_and_merges_frontend_parameters(self):
        doc = workflow()
        doc.config.frontend = {"1": {"steps": 10, "options": {"flags": [False]}}}
        doc.config.variants = {
            "draft": {"state": {"1": state(30)}, "frontend": {"1": {"steps": 15}}}
        }
        result = compile_workflow(doc, {}, variant="draft")
        self.assertEqual(set(result.graph), {"1", "2"})
        self.assertEqual(set(result.frontend_state), {"1"})
        item = result.frontend_state["1"]
        self.assertEqual(item["saved"], state(30))
        self.assertEqual(item["changes"], {"steps": 15, "options": {"flags": [False]}})
        self.assertEqual(item["desired"][0]["value"], 15)
        self.assertEqual(item["desired"][1]["value"], {"flags": [False]})

    def test_snapshot_has_no_mutable_aliases_to_config_or_export(self):
        doc = workflow()
        doc.config.frontend = {"1": {"options": {"flags": [False]}}}
        result = compile_workflow(doc, {}, variant="draft")
        exported = result.to_json()
        doc.config.state["1"][0]["value"] = 999
        doc.config.frontend["1"]["options"]["flags"].append(True)
        exported["frontend_state"]["1"]["desired"][0]["value"] = 888
        item = result.frontend_state["1"]
        self.assertEqual(item["saved"], state())
        self.assertEqual(item["desired"][0]["value"], 20)
        self.assertEqual(item["changes"], {"options": {"flags": [False]}})
        item["desired"][1]["value"]["flags"].append(True)
        self.assertEqual(item["changes"], {"options": {"flags": [False]}})

    def test_missing_or_invalid_state_on_pruned_nodes_is_ignored(self):
        doc = workflow()
        doc.config.state["3"] = ["bad parameter"]
        doc.config.frontend["3"] = {"unknown": object()}
        compile_workflow(doc, {}, variant="draft")
        del doc.config.state["3"]
        compile_workflow(doc, {}, variant="draft")
        with self.assertRaises(BindingError):
            compile_workflow(doc, {}, variant="final")

    def test_bad_targets_fail_even_if_output_branch_is_pruned(self):
        for target in ("missing", "4"):
            for field in ("state", "frontend"):
                with self.subTest(target=target, field=field):
                    doc = workflow()
                    getattr(doc.config, field)[target] = [] if field == "state" else {}
                    with self.assertRaises(BindingError):
                        compile_workflow(doc, {}, variant="draft")

    def test_invalid_saved_state_fails_before_execution(self):
        cases = [
            [],
            ["bad"],
            [{"type": "number", "value": 2}],
            [{"name": "x"}, {"name": "x"}],
            [{"name": "x", "value": float("nan")}],
            [{"name": "x", "value": {1: "bad key"}}],
            [{"name": "x", "type": 1}],
        ]
        for saved in cases:
            with self.subTest(saved=saved):
                doc = workflow()
                doc.config.state["1"] = saved
                with self.assertRaises(BindingError):
                    compile_workflow(doc, {}, variant="draft")

    def test_type_override_cannot_silently_discard_configured_state(self):
        with self.assertRaises(BindingError):
            compile_workflow(workflow(), {}, variant="draft", overrides={"/1/class_type": "Text"})

    def test_separators_and_arbitrary_plugin_types_are_supported(self):
        doc = workflow()
        doc.config.state["1"] += [{"type": "separator"}, {"type": "separator"}]
        compile_workflow(doc, {}, variant="draft")

    def test_invalid_changes_and_variant_shapes_fail(self):
        for changes in ({"unknown": 1}, {"steps": object()}, {"steps": float("inf")}):
            with self.subTest(changes=changes):
                doc = workflow()
                doc.config.frontend["1"] = changes
                with self.assertRaises(BindingError):
                    compile_workflow(doc, {}, variant="draft")
        for variant in ({"state": []}, {"frontend": []}, {"frontend": {"1": []}}):
            with self.subTest(variant=variant):
                doc = workflow()
                doc.config.variants["draft"] = variant
                with self.assertRaises(BindingError):
                    compile_workflow(doc, {}, variant="draft")

    def test_hook_removal_addition_or_type_change_invalidates_plan(self):
        result = compile_workflow(workflow(), {}, variant="draft")
        for operation in ("remove", "add", "type"):
            with self.subTest(operation=operation):
                graph = copy.deepcopy(result.graph)
                if operation == "remove":
                    del graph["1"]
                elif operation == "add":
                    graph["extra"] = copy.deepcopy(graph["1"])
                else:
                    graph["1"]["class_type"] = "Text"
                with self.assertRaises(BindingError):
                    validate_plan(graph, result.frontend_state)
        result.frontend_state["1"]["class_type"] = "other"
        with self.assertRaises(BindingError):
            validate_plan(result.graph, result.frontend_state)


class FakeClient:
    def __init__(self, states):
        self.states = copy.deepcopy(states)
        self.calls = []
        self.read_failure = set()
        self.write_failure = set()
        self.ambiguous_write = set()

    def get_json(self, path):
        node_id = parse_qs(urlsplit(path).query)["node_id"][0]
        self.calls.append(("read", node_id))
        if node_id in self.read_failure:
            raise ComfyError("read failed")
        return {"parameters": copy.deepcopy(self.states.get(node_id, []))}

    def post_json(self, path, data):
        node_id = data["node_id"]
        self.calls.append(("write", node_id))
        if node_id in self.write_failure:
            raise ComfyError("write failed")
        self.states[node_id] = copy.deepcopy(data["parameters"])
        if node_id in self.ambiguous_write:
            raise ComfyError("response lost")


class TransactionTests(unittest.TestCase):
    def setUp(self):
        doc = workflow()
        for node_id in ("2", "4"):
            doc.graph[node_id]["_meta"]["title"] = "[mio:output]"
        self.plan = compile_workflow(doc, {}).frontend_state
        self.client = FakeClient({"1": state(2), "3": []})
        self.journal = []

    def record(self, entries):
        self.journal.append(copy.deepcopy(entries))

    def test_capture_all_before_writes_and_intent_before_write(self):
        def record(entries):
            for entry in entries:
                if entry["status"] == "applying":
                    self.assertTrue(entry["write_intent"])
                    self.assertNotIn(("write", entry["node_id"]), self.client.calls)
            self.record(entries)

        entries = adapters.prepare_plan(self.client, self.plan, record)
        self.assertEqual(self.client.calls[:2], [("read", "1"), ("read", "3")])
        self.assertEqual([item["status"] for item in entries], ["applied", "applied"])
        self.assertEqual(self.client.states["1"], state(20))
        self.assertEqual(self.client.states["3"], state(40))
        entries[0]["desired"][0]["value"] = 500
        self.assertEqual(self.plan["1"]["desired"], state(20))

    def test_capture_failure_means_no_writes(self):
        self.client.read_failure.add("3")
        with self.assertRaises(ComfyError):
            adapters.prepare_plan(self.client, self.plan, self.record)
        self.assertFalse(any(op == "write" for op, _ in self.client.calls))

    def test_partial_and_ambiguous_failures_restore_from_last_journal(self):
        for ambiguous in (False, True):
            with self.subTest(ambiguous=ambiguous):
                self.setUp()
                failures = self.client.ambiguous_write if ambiguous else self.client.write_failure
                failures.add("3")
                with self.assertRaises(ComfyError):
                    adapters.prepare_plan(self.client, self.plan, self.record)
                entries = self.journal[-1]
                self.assertTrue(entries[1]["write_intent"])
                failures.clear()
                issues = adapters.restore_plan(self.client, entries, self.record)
                self.assertEqual(issues, [])
                self.assertEqual(self.client.states, {"1": state(2), "3": []})

    def test_restore_conflict_preserves_third_party_value_and_restores_others(self):
        entries = adapters.prepare_plan(self.client, self.plan, self.record)
        self.client.states["3"] = state(123)
        issues = adapters.restore_plan(self.client, entries, self.record)
        self.assertEqual(issues[0]["kind"], "conflict")
        self.assertEqual(issues[0]["node_id"], "3")
        self.assertEqual(self.client.states, {"1": state(2), "3": state(123)})

    def test_restore_errors_do_not_hide_or_block_other_nodes(self):
        entries = adapters.prepare_plan(self.client, self.plan, self.record)
        self.client.write_failure.add("3")
        issues = adapters.restore_plan(self.client, entries, self.record)
        self.assertEqual(issues[0]["kind"], "restore_failed")
        self.assertEqual(issues[0]["node_id"], "3")
        self.assertEqual(self.client.states["1"], state(2))
        self.client.write_failure.clear()
        self.assertEqual(adapters.restore_plan(self.client, self.journal[-1], self.record), [])
        self.assertEqual(self.client.states["3"], [])

    def test_restore_is_reverse_order_and_idempotent(self):
        entries = adapters.prepare_plan(self.client, self.plan, self.record)
        self.client.calls.clear()
        self.assertEqual(adapters.restore_plan(self.client, entries, self.record), [])
        writes = [node for op, node in self.client.calls if op == "write"]
        self.assertEqual(writes, ["3", "1"])
        self.client.calls.clear()
        self.assertEqual(adapters.restore_plan(self.client, self.journal[-1], self.record), [])
        self.assertFalse(any(op == "write" for op, _ in self.client.calls))

    def test_retry_does_not_recheck_nodes_already_restored(self):
        entries = adapters.prepare_plan(self.client, self.plan, self.record)
        self.client.write_failure.add("3")
        self.assertEqual(len(adapters.restore_plan(self.client, entries, self.record)), 1)
        self.client.states["1"] = state(999)
        self.client.write_failure.clear()
        self.client.calls.clear()
        self.assertEqual(adapters.restore_plan(self.client, self.journal[-1], self.record), [])
        self.assertEqual(self.client.states["1"], state(999))
        self.assertNotIn(("read", "1"), self.client.calls)
        self.assertNotIn(("write", "1"), self.client.calls)

    def test_unchanged_values_have_no_write_intent(self):
        self.client.states = {key: item["desired"] for key, item in self.plan.items()}
        entries = adapters.prepare_plan(self.client, self.plan, self.record)
        self.assertTrue(all(not item["write_intent"] for item in entries))
        self.assertEqual(adapters.restore_plan(self.client, entries, self.record), [])
        self.assertFalse(any(op == "write" for op, _ in self.client.calls))

    def test_journal_failure_stops_prepare_and_restore_before_writes(self):
        def fail_on_intent(entries):
            if any(item["write_intent"] for item in entries):
                raise OSError("journal unavailable")
            self.record(entries)

        with self.assertRaises(OSError):
            adapters.prepare_plan(self.client, self.plan, fail_on_intent)
        self.assertFalse(any(op == "write" for op, _ in self.client.calls))
        entries = adapters.prepare_plan(self.client, self.plan, self.record)
        self.client.calls.clear()
        with self.assertRaises(OSError):
            adapters.restore_plan(self.client, entries, fail_on_intent)
        self.assertEqual(self.client.calls, [])


if __name__ == "__main__":
    unittest.main()
