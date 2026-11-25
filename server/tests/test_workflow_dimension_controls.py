"""Dimension literals need a proven scalar origin and no competing geometry mode."""

import copy
import unittest

from mio_server.comfy.compile import compile_workflow
from mio_server.render_models import WorkflowDoc


def node(kind, **inputs):
    return {"class_type": kind, "inputs": inputs}


def graph():
    return {
        "model": node("NeutralSource"),
        "text": node("NeutralEncoder", text="subject"),
        "canvas": node("NeutralCanvas", width=640, height=896, batch_size=1),
        "sample": node(
            "NeutralGeneration",
            model=["model", 0],
            positive=["text", 0],
            latent_image=["canvas", 0],
            seed=17,
            steps=20,
        ),
        "save": node("SaveImage", images=["sample", 0]),
    }


def compile_graph(source, values):
    before = copy.deepcopy(source)
    result = compile_workflow(WorkflowDoc(name="Neutral dimension contract", graph=source), values)
    if before != source:
        raise AssertionError("source mutated")
    return result


class DimensionControlTests(unittest.TestCase):
    def test_unknown_size_calculators_are_not_reclassified_as_canvas_origins(self):
        for controls in ({}, {"aspectRatio": "4:3"}, {"mode": "custom"}):
            with self.subTest(controls=controls):
                source = graph()
                source["calculator"] = node(
                    "NeutralSizeCalculator", width=64, height=64, **controls
                )
                source["canvas"]["inputs"].update(width=["calculator", 0], height=["calculator", 1])
                result = compile_graph(source, {"width": 768, "height": 640})
                self.assertEqual(result.graph, source)
                self.assertNotIn("width", result.bindings)
                self.assertNotIn("height", result.bindings)

    def test_canvas_geometry_modes_require_explicit_effective_dimension_contract(self):
        for field, value in (
            ("aspectRatio", "custom"),
            ("preset", "manual"),
            ("mode", "direct"),
            ("resolution", "768x640"),
        ):
            with self.subTest(field=field, value=value):
                source = graph()
                source["canvas"]["inputs"][field] = value
                result = compile_graph(source, {"width": 768, "height": 640, "batch": 2})
                expected = copy.deepcopy(source)
                expected["canvas"]["inputs"]["batch_size"] = 2
                self.assertEqual(result.graph, expected)
                self.assertNotIn("width", result.bindings)
                self.assertNotIn("height", result.bindings)

    def test_identity_and_static_scalar_selector_remain_writable(self):
        source = graph()
        source["width"] = node("PrimitiveNode", value=640)
        source["height"] = node("PrimitiveNode", value=896)
        source["unused"] = node("PrimitiveNode", value=320)
        source["choice"] = node(
            "NeutralSelector", input1=["height", 0], input2=["unused", 0], select=1
        )
        source["canvas"]["inputs"].update(width=["width", 0], height=["choice", 0])
        expected = copy.deepcopy(source)
        expected["width"]["inputs"]["value"] = 768
        expected["height"]["inputs"]["value"] = 640
        self.assertEqual(compile_graph(source, {"width": 768, "height": 640}).graph, expected)

    def test_ambiguous_model_calibration_does_not_disable_clear_canvas_dimensions(self):
        source = graph()
        source["calibration"] = node(
            "NeutralCalibration", model=["model", 0], width=640, height=896, preset="fixed"
        )
        source["sample"]["inputs"]["model"] = ["calibration", 0]
        expected = copy.deepcopy(source)
        expected["canvas"]["inputs"].update(width=768, height=640)
        self.assertEqual(compile_graph(source, {"width": 768, "height": 640}).graph, expected)


if __name__ == "__main__":
    unittest.main()
