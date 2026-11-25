"""Requested supported values must not disappear without an actionable diagnostic."""

import copy
import unittest

from mio_server.comfy import bindings as B
from mio_server.comfy.compile import compile_workflow
from mio_server.render_models import WorkflowConfig, WorkflowDoc


def document(config=None):
    return WorkflowDoc(
        name="Neutral unresolved output",
        graph={
            "opaque": {"class_type": "NeutralOpaqueImage", "inputs": {"value": 0}},
            "save": {"class_type": "SaveImage", "inputs": {"images": ["opaque", 0]}},
        },
        config=config or WorkflowConfig(),
    )


class RequestedBindingWarningTests(unittest.TestCase):
    def test_every_requested_supported_value_without_target_is_reported(self):
        values = {
            "prompt": "subject",
            "negative": "exclusion",
            "seed": 7,
            "width": 768,
            "height": 640,
            "steps": 21,
            "cfg": 4.5,
            "denoise": 0.4,
            "sampler": "neutral",
            "scheduler": "neutral",
            "batch": 2,
            "checkpoint": "neutral.safetensors",
            "strength:pose": 0.4,
            "region:1": "region subject",
            "area:1": {"x": 0.1, "y": 0.1},
        }
        doc = document()
        before = copy.deepcopy(doc.model_dump())
        result = compile_workflow(doc, values)
        for key in values:
            with self.subTest(key=key):
                messages = [message for message in result.warnings if f" {key} " in message]
                self.assertEqual(len(messages), 1)
                self.assertIn("mapping", messages[0])
        self.assertEqual(result.graph, doc.graph)
        self.assertEqual(doc.model_dump(), before)

    def test_unrequested_unrelated_and_none_values_do_not_add_noise(self):
        result = compile_workflow(document(), {"steps": None, "application_note": "neutral"})
        self.assertEqual(result.warnings, [])

    def test_explicit_mapping_remains_writable_and_suppresses_missing_warning(self):
        doc = document(WorkflowConfig(mapping={"steps": "/opaque/inputs/value"}))
        result = compile_workflow(doc, {"steps": 21})
        self.assertEqual(result.graph["opaque"]["inputs"]["value"], 21)
        self.assertEqual(result.warnings, [])

    def test_image_requests_keep_the_existing_explicit_failure(self):
        for key in ("init", "mask", "ref:1", "control:pose"):
            with self.subTest(key=key):
                with self.assertRaises(B.BindingError):
                    compile_workflow(document(), {key: "neutral-asset"})


if __name__ == "__main__":
    unittest.main()
