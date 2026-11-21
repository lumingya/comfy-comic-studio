from unittest import TestCase

from mio_server.comfy.inspection import InspectRequest, inspect

from .test_slot_topology_matrix import chain, graph_for


class InspectionControlsTests(TestCase):
    def test_invalid_object_lora_strength_is_a_structured_preflight_error(self):
        for value in (None, "not-a-number", True):
            with self.subTest(value=value):
                graph = graph_for(
                    {
                        "class_type": "ObjectLoader",
                        "inputs": {
                            "model": ["1", 0],
                            "loras": [{"name": "ink.safetensors", "strength": value}],
                        },
                    }
                )
                result = inspect(InspectRequest(workflow=graph))
                self.assertTrue(result.importable)
                self.assertFalse(result.compilable)
                self.assertTrue(any(issue.code == "slot_error" for issue in result.issues))

    def test_nonfinite_object_strength_is_rejected_before_lora_description(self):
        for value in (float("inf"), float("-inf"), float("nan")):
            with self.subTest(value=value):
                graph = graph_for(
                    {
                        "class_type": "ObjectLoader",
                        "inputs": {
                            "model": ["1", 0],
                            "loras": [{"name": "ink.safetensors", "strength": value}],
                        },
                    }
                )
                result = inspect(InspectRequest(workflow=graph))
                self.assertFalse(result.importable)
                self.assertFalse(result.compilable)
                self.assertEqual(result.format, "invalid")
                self.assertEqual([issue.code for issue in result.issues], ["invalid_format"])

    def test_missing_frontend_state_does_not_hide_independently_discovered_lora_controls(self):
        graph = graph_for(chain())
        graph["state"] = {"class_type": "ParameterControlPanel", "inputs": {"pcp_ui": ""}}
        graph["sample"]["inputs"]["steps"] = ["state", 0]
        result = inspect(InspectRequest(workflow=graph))
        self.assertTrue(result.importable)
        self.assertFalse(result.compilable)
        self.assertTrue(any(issue.code == "compile_error" for issue in result.issues))
        self.assertEqual(result.lora_controls["groups"][0]["loras"][0]["name"], "ink.safetensors")
