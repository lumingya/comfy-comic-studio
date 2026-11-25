"""Neutral output-canvas contracts; candidate tests kept outside the frozen repo."""

import copy
import unittest

from mio_server.comfy.compile import compile_workflow
from mio_server.render_models import WorkflowDoc


def node(kind, **inputs):
    return {"class_type": kind, "inputs": inputs}


def base(prefix=""):
    def p(value):
        return prefix + value

    return {
        p("text"): node("NeutralTextEncoder", text=prefix + "subject"),
        p("model"): node("NeutralModelSource"),
        p("canvas"): node("NeutralCanvasSource", width=640, height=896, batch_size=1),
        p("sample"): node(
            "NeutralGeneration",
            positive=[p("text"), 0],
            model=[p("model"), 0],
            latent_image=[p("canvas"), 0],
            seed=17,
            steps=20,
            cfg=6.0,
        ),
        p("decode"): node("NeutralDecode", samples=[p("sample"), 0]),
        p("save"): node("SaveImage", images=[p("decode"), 0]),
    }


VALUES = {"prompt": "new subject", "width": 832, "height": 1216, "steps": 28}


def compile_graph(graph, values=VALUES):
    before = copy.deepcopy(graph)
    result = compile_workflow(WorkflowDoc(name="Neutral canvas scope", graph=graph), values)
    if graph != before:
        raise AssertionError("compile mutated the source graph")
    return result


def main_expected(graph):
    expected = copy.deepcopy(graph)
    expected["text"]["inputs"]["text"] = VALUES["prompt"]
    expected["canvas"]["inputs"].update(width=VALUES["width"], height=VALUES["height"])
    expected["sample"]["inputs"]["steps"] = VALUES["steps"]
    return expected


class OutputCanvasScopeTests(unittest.TestCase):
    def test_generated_references_do_not_own_main_prompt_canvas_or_steps(self):
        for role in ("control_image", "model_image", "conditioning_latent"):
            with self.subTest(role=role):
                graph = {**base(), **base("reference_")}
                del graph["reference_save"]
                graph["reference_canvas"]["inputs"].update(width=256, height=320)
                if role == "model_image":
                    graph["adapter"] = node(
                        "NeutralAdapter", model=["model", 0], image=["reference_decode", 0]
                    )
                    graph["sample"]["inputs"]["model"] = ["adapter", 0]
                else:
                    field = "image" if role == "control_image" else "latent"
                    source = "reference_decode" if field == "image" else "reference_sample"
                    if field == "latent":
                        del graph["reference_decode"]
                    graph["condition"] = node(
                        "NeutralCondition", conditioning=["text", 0], **{field: [source, 0]}
                    )
                    graph["sample"]["inputs"]["positive"] = ["condition", 0]
                self.assertEqual(compile_graph(graph).graph, main_expected(graph))

    def test_nested_generated_reference_does_not_become_primary(self):
        graph = {**base(), **base("reference_")}
        del graph["reference_save"]
        graph["processed"] = node("NeutralImageTransform", pixels=["reference_decode", 0])
        graph["adapter"] = node("NeutralAdapter", model=["model", 0], image=["processed", 0])
        graph["sample"]["inputs"]["model"] = ["adapter", 0]
        self.assertEqual(compile_graph(graph).graph, main_expected(graph))

    def test_true_latent_and_reencoded_image_stages_keep_first_canvas_contract(self):
        for reencode in (False, True):
            with self.subTest(reencode=reencode):
                graph = base()
                if reencode:
                    graph["transform"] = node("NeutralImageTransform", image=["decode", 0])
                    graph["encode"] = node("NeutralEncode", pixels=["transform", 0])
                    origin = "encode"
                else:
                    graph["transform"] = node("NeutralLatentTransform", samples=["sample", 0])
                    del graph["decode"]
                    origin = "transform"
                graph["refine_text"] = node("NeutralTextEncoder", text="fixed detail")
                graph["refine"] = node(
                    "NeutralRefinement",
                    model=["model", 0],
                    positive=["refine_text", 0],
                    latent_image=[origin, 0],
                    seed=19,
                    steps=4,
                )
                graph["refine_decode"] = node("NeutralDecode", samples=["refine", 0])
                graph["save"]["inputs"]["images"] = ["refine_decode", 0]
                self.assertEqual(compile_graph(graph).graph, main_expected(graph))

    def test_all_execution_stage_seeds_still_fan_out(self):
        graph = {**base(), **base("reference_")}
        del graph["reference_save"]
        graph["adapter"] = node("NeutralAdapter", model=["model", 0], image=["reference_decode", 0])
        graph["sample"]["inputs"]["model"] = ["adapter", 0]
        expected = copy.deepcopy(graph)
        expected["sample"]["inputs"]["seed"] = 99
        expected["reference_sample"]["inputs"]["seed"] = 99
        self.assertEqual(compile_graph(graph, {"seed": 99}).graph, expected)

    def test_unknown_output_canvas_role_requires_mapping(self):
        graph = base()
        graph["unknown"] = node("NeutralUnknownRole", opaque=["decode", 0])
        graph["save"]["inputs"]["images"] = ["unknown", 0]
        result = compile_graph(graph)
        self.assertEqual(result.graph, graph)
        self.assertFalse(set(VALUES).intersection(result.bindings))

    def test_auxiliary_selector_output_never_acquires_payload_bindings(self):
        for selected in (1, 2):
            for requested in (VALUES, {**VALUES, "seed": 99}):
                with self.subTest(selected=selected, requested=requested):
                    graph = {**base("a_"), **base("b_")}
                    del graph["a_save"], graph["b_save"]
                    graph["choice"] = node(
                        "NeutralTwoOutputSwitch",
                        input1=["a_decode", 0],
                        input2=["b_decode", 0],
                        select=selected,
                    )
                    graph["save"] = node("SaveImage", images=["choice", 1])
                    result = compile_graph(graph, requested)
                    self.assertEqual(result.graph, graph)
                    self.assertFalse(set(requested).intersection(result.bindings))

    def test_static_payload_selector_keeps_automatic_selected_canvas(self):
        graph = {**base("a_"), **base("b_")}
        del graph["a_save"], graph["b_save"]
        graph["choice"] = node(
            "NeutralTwoOutputSwitch", input1=["a_decode", 0], input2=["b_decode", 0], select=2
        )
        graph["save"] = node("SaveImage", images=["choice", 0])
        expected = copy.deepcopy(graph)
        expected["b_text"]["inputs"]["text"] = VALUES["prompt"]
        expected["b_canvas"]["inputs"].update(width=VALUES["width"], height=VALUES["height"])
        expected["b_sample"]["inputs"]["steps"] = VALUES["steps"]
        self.assertEqual(compile_graph(graph).graph, expected)

    def test_compound_regions_keep_distinct_prompts_manual_and_first_stage_controls(self):
        graph = {}
        for index, prefix in enumerate(("first_", "second_", "third_")):
            region = base(prefix)
            del region[prefix + "save"], region[prefix + "decode"]
            region[prefix + "canvas"]["inputs"]["width"] = 320 + index * 128
            graph.update(region)
        graph["compound"] = node(
            "NeutralCompound", samples_to=["first_sample", 0], samples_from=["second_sample", 0]
        )
        graph["compound_again"] = node(
            "NeutralCompound", samples_to=["compound", 0], samples_from=["third_sample", 0]
        )
        graph["final_text"] = node("NeutralEncoder", text="fixed finishing instructions")
        graph["final"] = node(
            "NeutralGeneration",
            model=["first_model", 0],
            positive=["final_text", 0],
            latent_image=["compound_again", 0],
            seed=31,
            steps=4,
        )
        graph["decode"] = node("NeutralDecode", samples=["final", 0])
        graph["save"] = node("SaveImage", images=["decode", 0])
        requested = {**VALUES, "batch": 2}
        expected = copy.deepcopy(graph)
        for prefix in ("first_", "second_", "third_"):
            expected[prefix + "sample"]["inputs"]["steps"] = VALUES["steps"]
            expected[prefix + "canvas"]["inputs"]["batch_size"] = 2
        result = compile_graph(graph, requested)
        self.assertEqual(result.graph, expected)
        self.assertFalse({"prompt", "width", "height"}.intersection(result.bindings))
        self.assertTrue(
            all(
                any(kind in warning for warning in result.warnings)
                for kind in ("prompt", "width", "height")
            )
        )

    def test_unknown_canvas_dependency_does_not_promote_downstream_sampler(self):
        graph = base()
        del graph["decode"], graph["save"]
        graph["unknown"] = node("NeutralOpaqueCanvas", operand=["sample", 0])
        graph["final_text"] = node("NeutralEncoder", text="fixed finishing instructions")
        graph["final"] = node(
            "NeutralGeneration",
            model=["model", 0],
            positive=["final_text", 0],
            latent_image=["unknown", 0],
            seed=31,
            steps=4,
        )
        graph["decode"] = node("NeutralDecode", samples=["final", 0])
        graph["save"] = node("SaveImage", images=["decode", 0])
        result = compile_graph(graph)
        self.assertEqual(result.graph, graph)
        self.assertFalse(set(VALUES).intersection(result.bindings))
        seed_result = compile_graph(graph, {"seed": 99})
        expected = copy.deepcopy(graph)
        expected["sample"]["inputs"]["seed"] = 99
        expected["final"]["inputs"]["seed"] = 99
        self.assertEqual(seed_result.graph, expected)

    def test_canvas_source_size_model_and_vae_dependencies_are_not_unknown_payloads(self):
        graph = base()
        graph["width"] = node("PrimitiveNode", value=640)
        graph["height"] = node("PrimitiveNode", value=896)
        graph["canvas"]["inputs"].update(
            width=["width", 0], height=["height", 0], model=["model", 0], vae=["model", 2]
        )
        expected = main_expected(graph)
        expected["canvas"]["inputs"].update(width=["width", 0], height=["height", 0])
        expected["width"]["inputs"]["value"] = VALUES["width"]
        expected["height"]["inputs"]["value"] = VALUES["height"]
        self.assertEqual(compile_graph(graph).graph, expected)

    def test_known_canvas_payload_does_not_hide_an_unknown_region_dependency(self):
        for field in ("operand", "source", "target"):
            with self.subTest(field=field):
                graph = {**base("first_"), **base("second_")}
                del graph["first_save"], graph["second_save"]
                graph["mixed"] = node(
                    "NeutralMixedPayload",
                    image=["first_decode", 0],
                    **{field: ["second_decode", 0]},
                )
                graph["save"] = node("SaveImage", images=["mixed", 0])
                requested = {**VALUES, "batch": 2}
                result = compile_graph(graph, requested)
                self.assertEqual(result.graph, graph)
                self.assertFalse(set(requested).intersection(result.bindings))
                self.assertTrue(
                    all(any(kind in warning for warning in result.warnings) for kind in requested)
                )

    def test_reference_mask_and_upscaler_configuration_do_not_obscure_a_known_canvas(self):
        graph = base()
        graph["reference"] = node("NeutralImage", width=128, height=128)
        graph["mask"] = node("NeutralMask", width=256, height=256)
        graph["configuration"] = node("NeutralConfiguration", model=["model", 0])
        graph["transform"] = node(
            "NeutralImageTransform",
            image=["decode", 0],
            reference_image=["reference", 0],
            mask=["mask", 0],
            attn_mask=["mask", 0],
            upscaler=["configuration", 0],
        )
        graph["save"]["inputs"]["images"] = ["transform", 0]
        self.assertEqual(compile_graph(graph).graph, main_expected(graph))


if __name__ == "__main__":
    unittest.main()
