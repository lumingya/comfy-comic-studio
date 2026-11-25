"""Synthetic, prompt-free contracts for unfamiliar static image graph topologies."""

import copy
import unittest

from mio_server.comfy import bindings as B


def node(cls, **inputs):
    return {"class_type": cls, "inputs": inputs}


def modern_graph():
    return {
        "model": node("UnfamiliarModelSource", model_name="test.safetensors"),
        "clip": node("UnfamiliarTextModel", model_name="text.safetensors"),
        "text": node("CLIPTextEncodeFlux", clip=["clip", 0], clip_l="subject", t5xxl="subject"),
        "guidance": node("NovelConditioningStrength", conditioning=["text", 0], guidance=3.5),
        "guider": node("UnfamiliarGuider", model=["model", 0], conditioning=["guidance", 0]),
        "seed": node("PrimitiveNode", value=13),
        "noise": node("UnfamiliarNoise", noise_seed=["seed", 0]),
        "latent": node("UnfamiliarLatent", width=768, height=1024, batch_size=1),
        "sigmas": node(
            "UnfamiliarSchedule", model=["model", 0], steps=20, scheduler="normal", denoise=1.0
        ),
        "algorithm": node("UnfamiliarSamplingAlgorithm", sampler_name="euler"),
        "sample": node(
            "UnfamiliarSample",
            latent_image=["latent", 0],
            guider=["guider", 0],
            noise=["noise", 0],
            sigmas=["sigmas", 0],
            sampler=["algorithm", 0],
        ),
        "decode": node("UnfamiliarDecode", samples=["sample", 0]),
        "out": node("Image Save with Prompt", images=["decode", 0], filename_prefix="test"),
    }


def targets(graph, kind):
    bound, problems = B.resolve(graph)
    if problems:
        raise AssertionError(problems)
    return {(b.node, b.field) for b in bound if b.kind == kind}


class SemanticBindingsTests(unittest.TestCase):
    def test_modern_sampler_guider_noise_schedule_and_multitext(self):
        graph = modern_graph()
        self.assertEqual(targets(graph, "prompt"), {("text", "clip_l"), ("text", "t5xxl")})
        self.assertEqual(targets(graph, "seed"), {("seed", "value")})
        self.assertEqual(targets(graph, "steps"), {("sigmas", "steps")})
        self.assertEqual(targets(graph, "scheduler"), {("sigmas", "scheduler")})
        self.assertEqual(targets(graph, "sampler"), {("algorithm", "sampler_name")})
        self.assertEqual(targets(graph, "cfg"), set())
        self.assertEqual(targets(graph, "width"), {("latent", "width")})
        self.assertEqual(targets(graph, "output"), {("out", None)})
        before = copy.deepcopy(graph)
        bound, _ = B.resolve(graph)
        changed = B.apply_values(graph, bound, {"prompt": "new", "seed": 99, "steps": 30})
        self.assertEqual(graph, before)
        self.assertEqual(changed["text"]["inputs"]["clip_l"], "new")
        self.assertEqual(changed["text"]["inputs"]["t5xxl"], "new")
        self.assertEqual(changed["noise"]["inputs"]["noise_seed"], ["seed", 0])
        self.assertEqual(changed["sigmas"]["inputs"]["steps"], 30)
        self.assertEqual(changed["guidance"], graph["guidance"])

    def test_conditioning_transforms_and_paired_control_paths(self):
        graph = modern_graph()
        graph["negative"] = node(
            "CLIPTextEncodeSD3",
            clip=["clip", 0],
            clip_l="negative",
            clip_g="negative",
            t5xxl="negative",
        )
        graph["control"] = node(
            "UnseenControl",
            positive=["text", 0],
            negative=["negative", 0],
            image=["control_image", 0],
        )
        graph["control_image"] = node("LoadImage", image="test.png")
        graph["guider"] = node(
            "UnseenCFGGuider",
            model=["model", 0],
            positive=["control", 0],
            negative=["control", 1],
            cfg=5.0,
        )
        # Paired input roles alone do not declare the custom node's output order.
        self.assertEqual(targets(graph, "prompt"), set())
        self.assertEqual(targets(graph, "negative"), set())
        self.assertEqual(targets(graph, "cfg"), {("guider", "cfg")})

    def test_crosswired_paired_outputs_require_mapping_instead_of_guessing_roles(self):
        graph = modern_graph()
        graph["negative"] = node("CLIPTextEncode", text="negative", clip=["clip", 0])
        graph["pair"] = node(
            "UnseenConditioningPair", positive=["text", 0], negative=["negative", 0]
        )
        graph["guider"] = node(
            "UnseenGuider", model=["model", 0], positive=["pair", 1], negative=["pair", 0]
        )
        before = copy.deepcopy(graph)
        bound, _ = B.resolve(graph)
        self.assertFalse(any(b.kind in ("prompt", "negative") for b in bound))
        self.assertEqual(
            B.apply_values(graph, bound, {"prompt": "new", "negative": "exclude"}), graph
        )
        bound, _ = B.resolve(
            graph,
            {
                "prompt": "/negative/inputs/text",
                "negative": ["/text/inputs/clip_l", "/text/inputs/t5xxl"],
            },
        )
        changed = B.apply_values(graph, bound, {"prompt": "new", "negative": "exclude"})
        self.assertEqual(changed["negative"]["inputs"]["text"], "new")
        self.assertEqual(changed["text"]["inputs"]["clip_l"], "exclude")
        self.assertEqual(changed["text"]["inputs"]["t5xxl"], "exclude")
        self.assertEqual(changed["guider"], graph["guider"])
        self.assertEqual(graph, before)

    def test_distinct_encoder_fields_and_regional_assembly_require_mapping(self):
        graph = modern_graph()
        graph["text"]["inputs"]["t5xxl"] = "different region"
        self.assertFalse(targets(graph, "prompt"))
        graph["text"]["inputs"]["t5xxl"] = "subject"
        graph["region"] = node("CLIPTextEncode", text="region", clip=["clip", 0])
        graph["combine"] = node(
            "UnseenRegionalCombine", conditioning_1=["text", 0], conditioning_2=["region", 0]
        )
        graph["guidance"]["inputs"]["conditioning"] = ["combine", 0]
        self.assertFalse(targets(graph, "prompt"))

    def test_regional_text_append_chain_requires_mapping_and_preserves_all_origins(self):
        from mio_server.comfy.compile import compile_workflow
        from mio_server.render_models import WorkflowConfig, WorkflowDoc

        graph = modern_graph()
        graph["text"] = node("CLIPTextEncode", clip=["clip", 0], text="global scene")
        graph["region_a"] = node(
            "UnseenRegionalAppend",
            conditioning_to=["text", 0],
            clip=["clip", 0],
            text="first region",
            x=32,
            y=64,
        )
        graph["region_b"] = node(
            "UnseenTextEncodeAppend",
            conditioning_to=["region_a", 0],
            clip=["clip", 0],
            text="second region",
            x=384,
            y=128,
        )
        graph["guidance"]["inputs"]["conditioning"] = ["region_b", 0]
        graph["guider"] = node(
            "UnseenCFGGuider",
            model=["model", 0],
            positive=["guidance", 0],
            negative=["text", 0],
            cfg=1.0,
        )
        original = copy.deepcopy(graph)
        self.assertEqual(targets(graph, "prompt"), set())
        # The global encoder is also a positive dependency, despite no automatic prompt.
        self.assertEqual(targets(graph, "negative"), set())
        doc = WorkflowDoc(name="Synthetic regional append", graph=graph)
        result = compile_workflow(doc, {"prompt": "replacement", "negative": "exclusion"})
        self.assertEqual(result.graph, original)
        self.assertNotIn("prompt", result.bindings)
        self.assertNotIn("negative", result.bindings)
        doc.config = WorkflowConfig(mapping={"prompt": "/text/inputs/text"})
        result = compile_workflow(doc, {"prompt": "replacement", "negative": "exclusion"})
        expected = copy.deepcopy(original)
        expected["text"]["inputs"]["text"] = "replacement"
        self.assertEqual(result.graph, expected)
        self.assertEqual(graph, original)

    def test_string_helper_controls_are_not_prompt_targets_and_concat_is_ambiguous(self):
        graph = modern_graph()
        graph["source"] = node("NovelTextEditor", text="subject", language="en", delimiter=", ")
        graph["text"] = node("CLIPTextEncode", clip=["clip", 0], text=["source", 0])
        self.assertEqual(targets(graph, "prompt"), {("source", "text")})
        graph["source"] = node(
            "StringConcatenate", text_a="subject", text_b="style", delimiter=", "
        )
        self.assertFalse(targets(graph, "prompt"))

    def test_zeroed_negative_does_not_overwrite_the_shared_positive_encoder(self):
        graph = modern_graph()
        graph["zero"] = node("ConditioningZeroOut", conditioning=["text", 0])
        graph["guider"] = node(
            "NovelCFGGuider",
            model=["model", 0],
            positive=["text", 0],
            negative=["zero", 0],
            cfg=1.0,
        )
        self.assertEqual(targets(graph, "negative"), set())
        self.assertEqual(len(targets(graph, "prompt")), 2)

    def test_explicit_prompt_target_is_not_overwritten_by_a_negative_heuristic(self):
        graph = modern_graph()
        graph["text"] = node("CLIPTextEncode", clip=["clip", 0], text="subject")
        graph["text"]["_meta"] = {"title": "[mio:prompt]"}
        graph["zero"] = node("ConditioningZeroOut", conditioning=["text", 0])
        graph["guider"] = node(
            "NovelCFGGuider",
            model=["model", 0],
            positive=["text", 0],
            negative=["zero", 0],
            cfg=1.0,
        )
        bound, _ = B.resolve(graph)
        changed = B.apply_values(graph, bound, {"prompt": "new", "negative": "exclusion"})
        self.assertEqual(changed["text"]["inputs"]["text"], "new")
        self.assertEqual(targets(graph, "negative"), set())

    def test_primary_stage_prompts_and_size_do_not_overwrite_refiner_inputs(self):
        graph = modern_graph()
        graph["refine_text"] = node(
            "CLIPTextEncode", clip=["clip", 0], text="refinement instructions"
        )
        graph["upscale"] = node("LatentUpscale", samples=["sample", 0], width=1536, height=2048)
        graph["refiner"] = node(
            "NovelRefiner",
            latent_image=["upscale", 0],
            positive=["refine_text", 0],
            model=["model", 0],
            seed_num=8,
            steps=7,
        )
        graph["decode"]["inputs"]["samples"] = ["refiner", 0]
        self.assertNotIn(("refine_text", "text"), targets(graph, "prompt"))
        self.assertEqual(targets(graph, "width"), {("latent", "width")})
        self.assertEqual(targets(graph, "seed"), {("seed", "value"), ("refiner", "seed_num")})
        self.assertNotIn(("refiner", "steps"), targets(graph, "steps"))

    def test_fixed_positive_region_is_protected_when_another_region_is_explicit(self):
        graph = modern_graph()
        graph["text"] = node("CLIPTextEncode", clip=["clip", 0], text="fixed region")
        graph["tagged"] = node("CLIPTextEncode", clip=["clip", 0], text="editable region")
        graph["tagged"]["_meta"] = {"title": "[mio:prompt]"}
        graph["combine"] = node(
            "ConditioningCombine", conditioning_1=["text", 0], conditioning_2=["tagged", 0]
        )
        graph["zero"] = node("ConditioningZeroOut", conditioning=["text", 0])
        graph["guider"] = node(
            "NovelCFGGuider",
            model=["model", 0],
            positive=["combine", 0],
            negative=["zero", 0],
            cfg=1.0,
        )
        before = copy.deepcopy(graph)
        bound, _ = B.resolve(graph)
        self.assertFalse(any(b.kind == "negative" for b in bound))
        changed = B.apply_values(graph, bound, {"prompt": "new region", "negative": "exclude"})
        self.assertEqual(changed["text"]["inputs"]["text"], "fixed region")
        self.assertEqual(changed["tagged"]["inputs"]["text"], "new region")
        self.assertEqual(changed["guider"], graph["guider"])
        self.assertEqual(graph, before)

    def test_nested_regional_control_does_not_bypass_top_level_prompt_ambiguity(self):
        graph = modern_graph()
        graph["region_text"] = node("CLIPTextEncode", text="different region", clip=["clip", 0])
        graph["region_control"] = node(
            "NovelControl", positive=["region_text", 0], negative=["region_text", 0]
        )
        graph["combine"] = node(
            "ConditioningCombine", conditioning_1=["text", 0], conditioning_2=["region_control", 0]
        )
        graph["guidance"]["inputs"]["conditioning"] = ["combine", 0]
        self.assertEqual(targets(graph, "prompt"), set())

    def test_negative_heuristic_preserves_a_shared_later_stage_positive(self):
        graph = modern_graph()
        graph["refiner_text"] = node("CLIPTextEncode", clip=["clip", 0], text="fixed refiner")
        graph["guider"] = node(
            "NovelCFGGuider",
            model=["model", 0],
            positive=["text", 0],
            negative=["refiner_text", 0],
            cfg=1.0,
        )
        graph["refiner"] = node(
            "UnseenRefiner",
            model=["model", 0],
            positive=["refiner_text", 0],
            latent_image=["sample", 0],
            seed=7,
        )
        graph["decode"]["inputs"]["samples"] = ["refiner", 0]
        before = copy.deepcopy(graph)
        bound, _ = B.resolve(graph)
        self.assertFalse(any(b.kind == "negative" for b in bound))
        changed = B.apply_values(graph, bound, {"prompt": "new", "negative": "exclude"})
        self.assertEqual(changed["refiner_text"], graph["refiner_text"])
        self.assertEqual(graph, before)

    def test_reference_conditioning_dependency_preserves_later_canvas_and_prompt(self):
        graph = modern_graph()
        graph["negative"] = node("CLIPTextEncode", clip=["clip", 0], text="exclusion")
        graph["guider"] = node(
            "UnseenGuider", model=["model", 0], positive=["text", 0], negative=["negative", 0]
        )
        graph["later_text"] = node("CLIPTextEncode", clip=["clip", 0], text="fixed later panel")
        graph["reference"] = node(
            "UnseenReferenceConditioning", conditioning=["later_text", 0], latent=["sample", 0]
        )
        graph["later_latent"] = node("UnseenCanvas", width=1024, height=1024, batch_size=1)
        graph["later_sample"] = node(
            "UnseenSampler",
            model=["model", 0],
            positive=["reference", 0],
            negative=["negative", 0],
            latent_image=["later_latent", 0],
            seed=8,
            steps=9,
        )
        graph["decode"]["inputs"]["samples"] = ["later_sample", 0]
        before = copy.deepcopy(graph)
        # A reference latent does not establish generation-canvas lineage.
        self.assertEqual(targets(graph, "prompt"), {("later_text", "text")})
        self.assertEqual(targets(graph, "negative"), {("negative", "text")})
        self.assertEqual(targets(graph, "width"), {("later_latent", "width")})
        self.assertEqual(targets(graph, "height"), {("later_latent", "height")})
        self.assertEqual(targets(graph, "seed"), {("seed", "value"), ("later_sample", "seed")})
        bound, _ = B.resolve(graph)
        changed = B.apply_values(
            graph,
            bound,
            {
                "prompt": "new",
                "negative": "new exclusion",
                "width": 832,
                "height": 1216,
                "seed": 99,
            },
        )
        self.assertEqual(changed["text"], graph["text"])
        self.assertEqual(changed["latent"], graph["latent"])
        self.assertEqual(changed["later_text"]["inputs"]["text"], "new")
        self.assertEqual(changed["later_latent"]["inputs"]["width"], 832)
        self.assertEqual(changed["later_latent"]["inputs"]["height"], 1216)
        self.assertEqual(changed["reference"], graph["reference"])
        self.assertEqual(changed["later_sample"]["inputs"]["steps"], 9)
        self.assertEqual(changed["negative"]["inputs"]["text"], "new exclusion")
        self.assertEqual(graph, before)
        graph["external"] = node("UnseenExternalLatent", source="fixture")
        graph["reference_switch"] = node(
            "UnseenSwitch", boolean=False, on_true=["sample", 0], on_false=["external", 0]
        )
        graph["reference"]["inputs"]["latent"] = ["reference_switch", 0]
        self.assertEqual(targets(graph, "prompt"), {("later_text", "text")})
        self.assertEqual(targets(graph, "width"), {("later_latent", "width")})
        self.assertEqual(targets(graph, "seed"), {("later_sample", "seed")})

    def test_primary_model_dimension_calibration_remains_coupled_to_canvas(self):
        graph = modern_graph()
        graph["calibration"] = node(
            "UnseenModelCalibration", model=["model", 0], width=768, height=1024
        )
        graph["guider"]["inputs"]["model"] = ["calibration", 0]
        self.assertEqual(targets(graph, "width"), {("latent", "width"), ("calibration", "width")})
        self.assertEqual(
            targets(graph, "height"), {("latent", "height"), ("calibration", "height")}
        )

    def test_bypassed_encoder_widgets_are_not_automatic_targets(self):
        for mode in (2, 4):
            with self.subTest(mode=mode):
                graph = modern_graph()
                graph["text"]["mode"] = mode
                before = copy.deepcopy(graph)
                bound, _ = B.resolve(graph)
                self.assertEqual(targets(graph, "prompt"), set())
                changed = B.apply_values(graph, bound, {"prompt": "new"})
                self.assertEqual(changed["text"], graph["text"])
                bound, _ = B.resolve(graph, {"prompt": "/text/inputs/clip_l"})
                changed = B.apply_values(graph, bound, {"prompt": "manual"})
                self.assertEqual(changed["text"]["inputs"]["clip_l"], "manual")
                self.assertEqual(graph, before)

    def test_unequal_composition_canvas_domains_require_explicit_size_mapping(self):
        graph = modern_graph()
        graph["patch_canvas"] = node("UnseenCanvas", width=384, height=768, batch_size=1)
        graph["patch_sample"] = node(
            "UnseenSampler",
            model=["model", 0],
            positive=["text", 0],
            latent_image=["patch_canvas", 0],
            seed=8,
        )
        graph["compose"] = node(
            "UnseenComposition",
            operand_a=["sample", 0],
            operand_b=["patch_sample", 0],
            offset_x=384,
            offset_y=128,
        )
        graph["decode"]["inputs"]["samples"] = ["compose", 0]
        graph["calibration"] = node(
            "UnseenModelCalibration", model=["model", 0], width=768, height=1024
        )
        graph["guider"]["inputs"]["model"] = ["calibration", 0]
        before = copy.deepcopy(graph)
        bound, _ = B.resolve(graph)
        self.assertEqual(targets(graph, "width"), set())
        self.assertEqual(targets(graph, "height"), set())
        changed = B.apply_values(graph, bound, {"width": 832, "height": 1216})
        self.assertEqual(changed, graph)
        bound, _ = B.resolve(
            graph, {"width": "/latent/inputs/width", "height": "/latent/inputs/height"}
        )
        changed = B.apply_values(graph, bound, {"width": 832, "height": 1216})
        self.assertEqual(changed["latent"]["inputs"]["width"], 832)
        self.assertEqual(changed["latent"]["inputs"]["height"], 1216)
        for nid in ("patch_canvas", "compose", "calibration"):
            self.assertEqual(changed[nid], graph[nid])
        self.assertEqual(graph, before)
        graph["patch_canvas"]["inputs"].update(width=768, height=1024)
        # Equal values and opaque operand names do not prove canvas roles.
        self.assertEqual(targets(graph, "width"), set())
        self.assertEqual(targets(graph, "height"), set())
        graph["latent"]["_meta"] = {"title": "[mio:width] [mio:height]"}
        self.assertEqual(targets(graph, "width"), {("latent", "width")})
        self.assertEqual(targets(graph, "height"), {("latent", "height")})

    def test_one_shared_numeric_source_is_not_claimed_as_independent_dimensions(self):
        graph = modern_graph()
        graph["side"] = node("PrimitiveNode", value=768)
        graph["latent"]["inputs"].update(width=["side", 0], height=["side", 0])
        self.assertEqual(targets(graph, "width"), set())
        self.assertEqual(targets(graph, "height"), set())

    def test_final_save_suppresses_only_previews_of_its_own_image_path(self):
        graph = modern_graph()
        graph["preview"] = node("PreviewChooser", images=["decode", 0])
        graph["other_image"] = node("LoadImage", image="other.png")
        graph["separate_preview"] = node("PreviewImage", images=["other_image", 0])
        graph["extra_save"] = node("SaveImageWebsocket", images=["decode", 0])
        self.assertEqual(
            targets(graph, "output"),
            {("out", None), ("extra_save", None), ("separate_preview", None)},
        )
        graph["preview"]["_meta"] = {"title": "[mio:output]"}
        self.assertEqual(targets(graph, "output"), {("preview", None)})

    def test_static_switch_reroutes_are_followed_and_unknown_selection_is_not_guessed(self):
        graph = modern_graph()
        graph["other_text"] = node("CLIPTextEncode", clip=["clip", 0], text="inactive")
        graph["select"] = node(
            "NovelSwitch", on_true=["text", 0], on_false=["other_text", 0], enabled=True
        )
        graph["reroute"] = node("Reroute", value=["select", 0])
        graph["guidance"]["inputs"]["conditioning"] = ["reroute", 0]
        self.assertEqual(targets(graph, "prompt"), {("text", "clip_l"), ("text", "t5xxl")})
        graph["select"]["inputs"]["enabled"] = "dynamic"
        self.assertEqual(targets(graph, "prompt"), set())

    def test_dynamic_image_switch_keeps_seed_batch_controls_but_not_distinct_prompts(self):
        graph = modern_graph()
        graph["other_text"] = node("CLIPTextEncode", clip=["clip", 0], text="different branch")
        graph["other_latent"] = node("UnseenLatent", width=768, height=1024, batch_size=1)
        graph["other_sample"] = node(
            "UnseenSampler",
            model=["model", 0],
            positive=["other_text", 0],
            latent_image=["other_latent", 0],
            noise_seed=8,
        )
        graph["other_decode"] = node("UnseenDecode", samples=["other_sample", 0])
        graph["decision"] = node("UnseenRuntimeBoolean", model=["model", 0])
        graph["image_switch"] = node(
            "UnseenImageSwitch",
            boolean=["decision", 0],
            on_true=["decode", 0],
            on_false=["other_decode", 0],
        )
        graph["out"]["inputs"]["images"] = ["image_switch", 0]
        before = copy.deepcopy(graph)
        bound, _ = B.resolve(graph)
        self.assertEqual(
            targets(graph, "seed"), {("seed", "value"), ("other_sample", "noise_seed")}
        )
        self.assertEqual(
            targets(graph, "batch"), {("latent", "batch_size"), ("other_latent", "batch_size")}
        )
        self.assertEqual(targets(graph, "prompt"), set())
        changed = B.apply_values(graph, bound, {"seed": 99, "batch": 2, "prompt": "new"})
        self.assertEqual(changed["seed"]["inputs"]["value"], 99)
        self.assertEqual(changed["other_sample"]["inputs"]["noise_seed"], 99)
        self.assertEqual(changed["latent"]["inputs"]["batch_size"], 2)
        self.assertEqual(changed["other_latent"]["inputs"]["batch_size"], 2)
        self.assertEqual(changed["text"], graph["text"])
        self.assertEqual(changed["other_text"], graph["other_text"])
        self.assertEqual(changed["image_switch"], graph["image_switch"])
        self.assertEqual(graph, before)
        graph["image_switch"]["inputs"]["boolean"] = False
        self.assertEqual(targets(graph, "seed"), {("other_sample", "noise_seed")})
        self.assertEqual(targets(graph, "batch"), {("other_latent", "batch_size")})
        self.assertEqual(targets(graph, "prompt"), {("other_text", "text")})

    def test_manual_and_tagged_targets_are_kept_ahead_of_generic_candidates(self):
        graph = modern_graph()
        graph["editor"] = node("UnseenEditor", content="manual", width=5, height=5)
        graph["editor"]["_meta"] = {"title": "[mio:prompt=content]"}
        bound, _ = B.resolve(graph, {"seed": "/latent/inputs/batch_size"})
        self.assertEqual(
            {(b.node, b.field) for b in bound if b.kind == "prompt"}, {("editor", "content")}
        )
        self.assertEqual(
            {(b.node, b.field) for b in bound if b.kind == "seed"}, {("latent", "batch_size")}
        )
        self.assertFalse(any(b.kind == "batch" for b in bound))
        self.assertNotIn(
            ("editor", "width"), {(b.node, b.field) for b in bound if b.kind == "width"}
        )

    def test_model_reference_and_control_canvases_keep_their_own_dimensions(self):
        from mio_server.comfy.compile import compile_workflow
        from mio_server.render_models import WorkflowDoc

        graph = modern_graph()
        graph["reference_a"] = node("UnseenImage", width=256, height=256, batch_size=1)
        graph["reference_b"] = node("UnseenImage", width=384, height=512, batch_size=3)
        graph["control_canvas"] = node("UnseenImage", width=320, height=480, batch_size=1)
        graph["reference_resize"] = node(
            "UnseenImageTransform", image=["reference_b", 0], width=128, height=128
        )
        graph["reference_join"] = node(
            "UnseenImageComposition", image=["reference_a", 0], images=["reference_resize", 0]
        )
        graph["control"] = node("UnseenControlPreparation", pixels=["control_canvas", 0])
        graph["adapter"] = node(
            "UnseenModelAdapter",
            model=["model", 0],
            image=["reference_join", 0],
            control=["control", 0],
        )
        graph["calibration"] = node(
            "ModelSamplingFlux", model=["adapter", 0], width=768, height=1024
        )
        graph["guider"]["inputs"]["model"] = ["calibration", 0]
        before = copy.deepcopy(graph)
        doc = WorkflowDoc(name="Synthetic dimension domains", graph=graph)
        result = compile_workflow(doc, {"width": 832, "height": 1216, "batch": 2})
        expected = copy.deepcopy(graph)
        expected["latent"]["inputs"].update(width=832, height=1216, batch_size=2)
        expected["calibration"]["inputs"].update(width=832, height=1216)
        self.assertEqual(result.graph, expected)
        self.assertEqual(graph, before)

    def test_generation_image_domain_excludes_reference_mask_and_control_inputs(self):
        graph = modern_graph()
        graph["generation"] = node("UnseenImage", width=768, height=1024, batch_size=1)
        graph["reference"] = node("UnseenImage", width=256, height=256, batch_size=1)
        graph["mask"] = node("UnseenMask", width=768, height=1024, batch_size=1)
        graph["encode"] = node(
            "UnseenImageEncode",
            pixels=["generation", 0],
            reference_image=["reference", 0],
            mask=["mask", 0],
            vae=["model", 2],
        )
        graph["sample"]["inputs"]["latent_image"] = ["encode", 0]
        self.assertEqual(targets(graph, "width"), {("generation", "width")})
        self.assertEqual(targets(graph, "height"), {("generation", "height")})
        self.assertEqual(targets(graph, "batch"), {("generation", "batch_size")})

    def test_canvas_shared_with_a_reference_data_branch_requires_explicit_mapping(self):
        for reference_port in ("image", "reference_image", "attn_mask", "control"):
            with self.subTest(reference_port=reference_port):
                graph = modern_graph()
                graph["canvas"] = node("UnseenImage", width=768, height=1024, batch_size=1)
                graph["encode"] = node("UnseenEncode", pixels=["canvas", 0])
                graph["sample"]["inputs"]["latent_image"] = ["encode", 0]
                graph["adapter"] = node(
                    "UnseenModelAdapter", model=["model", 0], **{reference_port: ["canvas", 0]}
                )
                graph["guider"]["inputs"]["model"] = ["adapter", 0]
                before = copy.deepcopy(graph)
                for kind in ("width", "height", "batch"):
                    self.assertEqual(targets(graph, kind), set())
                bound, _ = B.resolve(graph)
                self.assertEqual(
                    B.apply_values(graph, bound, {"width": 832, "height": 1216, "batch": 2}),
                    graph,
                )
                bound, _ = B.resolve(graph, {"width": "/canvas/inputs/width"})
                self.assertEqual(
                    B.apply_values(graph, bound, {"width": 832})["canvas"]["inputs"]["width"], 832
                )
                self.assertEqual(graph, before)

    def test_dynamic_model_selector_keeps_calibrations_and_excludes_selector_controls(self):
        graph = modern_graph()
        for index, size in (("a", 256), ("b", 384)):
            graph["reference_" + index] = node("UnseenImage", width=size, height=size, batch_size=1)
            graph["adapter_" + index] = node(
                "UnseenModelAdapter", model=["model", 0], image=["reference_" + index, 0]
            )
            graph["calibration_" + index] = node(
                "UnseenCalibration", model=["adapter_" + index, 0], width=768, height=1024
            )
        graph["decision_canvas"] = node("UnseenImage", width=64, height=64, batch_size=1)
        graph["decision"] = node("UnseenRuntimeBoolean", image=["decision_canvas", 0])
        graph["model_switch"] = node(
            "UnseenSwitch",
            boolean=["decision", 0],
            on_true=["calibration_a", 0],
            on_false=["calibration_b", 0],
        )
        graph["model_route"] = node("Reroute", value=["model_switch", 0])
        graph["guider"]["inputs"]["model"] = ["model_route", 0]
        for field in ("width", "height"):
            self.assertEqual(
                targets(graph, field),
                {("latent", field), ("calibration_a", field), ("calibration_b", field)},
            )
        self.assertEqual(targets(graph, "batch"), {("latent", "batch_size")})
        graph["model_switch"]["inputs"]["boolean"] = False
        self.assertEqual(targets(graph, "width"), {("latent", "width"), ("calibration_b", "width")})

    def test_reference_shared_resolution_literals_require_explicit_mapping(self):
        for field, kind in (("width", "width"), ("height", "height"), ("batch_size", "batch")):
            with self.subTest(field=field):
                graph = modern_graph()
                value = graph["latent"]["inputs"][field]
                graph["shared"] = node("PrimitiveNode", value=value)
                graph["route"] = node("Reroute", value=["shared", 0])
                graph["latent"]["inputs"][field] = ["shared", 0]
                graph["reference"] = node("UnseenImage", width=256, height=256, batch_size=1)
                graph["reference"]["inputs"][field] = ["route", 0]
                graph["adapter"] = node(
                    "UnseenModelAdapter", model=["model", 0], image=["reference", 0]
                )
                graph["guider"]["inputs"]["model"] = ["adapter", 0]
                before = copy.deepcopy(graph)
                self.assertEqual(targets(graph, kind), set())
                bound, _ = B.resolve(graph)
                self.assertEqual(B.apply_values(graph, bound, {kind: 2}), graph)
                bound, _ = B.resolve(graph, {kind: "/shared/inputs/value"})
                self.assertEqual(
                    B.apply_values(graph, bound, {kind: 2})["shared"]["inputs"]["value"], 2
                )
                self.assertEqual(graph, before)

    def test_shared_resolution_helpers_and_calibration_remain_protected(self):
        graph = modern_graph()
        graph["resolution"] = node("UnseenResolution", width=768, height=1024, batch_size=1)
        graph["latent"]["inputs"].update(width=["resolution", 0], height=["resolution", 1])
        graph["reference"] = node("UnseenImage", width=["resolution", 0], height=["resolution", 1])
        graph["adapter"] = node("UnseenModelAdapter", model=["model", 0], image=["reference", 0])
        graph["calibration"] = node(
            "UnseenCalibration",
            model=["adapter", 0],
            width=["resolution", 0],
            height=["resolution", 1],
        )
        graph["guider"]["inputs"]["model"] = ["calibration", 0]
        self.assertEqual(targets(graph, "width"), set())
        self.assertEqual(targets(graph, "height"), set())
        self.assertEqual(targets(graph, "batch"), {("latent", "batch_size")})

    def test_model_reference_causal_stage_preserves_later_canvas_and_calibration(self):
        graph = modern_graph()
        graph["later_text"] = node("CLIPTextEncode", clip=["clip", 0], text="fixed later")
        graph["later_canvas"] = node("UnseenLatent", width=1024, height=1024, batch_size=1)
        graph["reference_model"] = node(
            "UnseenModelAdapter", model=["model", 0], image=["decode", 0]
        )
        graph["later_calibration"] = node(
            "UnseenCalibration", model=["reference_model", 0], width=1024, height=1024
        )
        graph["later_sample"] = node(
            "UnseenSampler",
            model=["later_calibration", 0],
            positive=["later_text", 0],
            latent_image=["later_canvas", 0],
            seed=19,
            steps=7,
        )
        graph["later_decode"] = node("UnseenDecode", samples=["later_sample", 0])
        graph["out"]["inputs"]["images"] = ["later_decode", 0]
        before = copy.deepcopy(graph)
        bound, _ = B.resolve(graph)
        changed = B.apply_values(graph, bound, {"width": 832, "height": 1216, "batch": 2})
        expected = copy.deepcopy(graph)
        # Model-reference causality does not make its source the main canvas.
        expected["later_canvas"]["inputs"].update(width=832, height=1216, batch_size=2)
        expected["later_calibration"]["inputs"].update(width=832, height=1216)
        self.assertEqual(changed, expected)
        self.assertEqual(graph, before)

    def test_dynamic_generation_image_domains_keep_sizes_and_reference_canvases(self):
        graph = modern_graph()
        graph["other_latent"] = node("UnseenLatent", width=768, height=1024, batch_size=1)
        graph["reference"] = node("UnseenImage", width=256, height=256, batch_size=1)
        graph["adapter"] = node("UnseenModelAdapter", model=["model", 0], image=["reference", 0])
        graph["other_sample"] = node(
            "UnseenSampler",
            model=["adapter", 0],
            positive=["text", 0],
            latent_image=["other_latent", 0],
            seed=19,
        )
        graph["other_decode"] = node("UnseenDecode", samples=["other_sample", 0])
        graph["decision"] = node("UnseenRuntimeBoolean", model=["model", 0])
        graph["image_switch"] = node(
            "UnseenSwitch",
            boolean=["decision", 0],
            on_true=["decode", 0],
            on_false=["other_decode", 0],
        )
        graph["out"]["inputs"]["images"] = ["image_switch", 0]
        for field, kind in (("width", "width"), ("height", "height"), ("batch_size", "batch")):
            self.assertEqual(targets(graph, kind), {("latent", field), ("other_latent", field)})
        graph["image_switch"]["inputs"]["boolean"] = False
        self.assertEqual(targets(graph, "width"), {("other_latent", "width")})

    def test_prefixed_canvas_dimensions_do_not_bind_model_attention_masks(self):
        from mio_server.comfy.compile import compile_workflow
        from mio_server.render_models import WorkflowDoc

        graph = modern_graph()
        graph["bundle"] = node(
            "UnseenGenerationBundle",
            empty_latent_width=768,
            empty_latent_height=1024,
            batch_size=1,
            checkpoint_name="synthetic.safetensors",
        )
        graph["mask_a"] = node("UnseenMaskCanvas", width=768, height=1024)
        graph["mask_b"] = node("UnseenMaskCanvas", width=768, height=1024)
        graph["feather"] = node("UnseenMaskTransform", mask=["mask_a", 0])
        graph["composition"] = node(
            "UnseenMaskComposition", source=["feather", 0], destination=["mask_b", 0]
        )
        graph["inverse"] = node("UnseenMaskTransform", mask=["composition", 0])
        graph["reference_a"] = node("UnseenImage", width=256, height=256, batch_size=1)
        graph["reference_b"] = node("UnseenImage", width=384, height=384, batch_size=1)
        graph["adapter_a"] = node(
            "UnseenModelAdapter",
            model=["bundle", 0],
            image=["reference_a", 0],
            attn_mask=["composition", 0],
        )
        graph["adapter_b"] = node(
            "UnseenModelAdapter",
            model=["adapter_a", 0],
            image=["reference_b", 0],
            attn_mask=["inverse", 0],
        )
        graph["guider"]["inputs"]["model"] = ["adapter_b", 0]
        graph["sample"]["inputs"]["latent_image"] = ["bundle", 3]
        graph.pop("latent")
        before = copy.deepcopy(graph)
        compiled = compile_workflow(
            WorkflowDoc(name="Synthetic bundled canvas", graph=graph),
            {"width": 1152, "height": 896, "batch": 2},
        )
        expected = copy.deepcopy(graph)
        expected["bundle"]["inputs"].update(
            empty_latent_width=1152, empty_latent_height=896, batch_size=2
        )
        self.assertEqual(compiled.graph, expected)
        self.assertEqual(graph, before)
        self.assertEqual(compiled.warnings, [])

    def test_prefixed_reference_dimensions_do_not_become_model_calibrations(self):
        graph = modern_graph()
        graph["adapter"] = node(
            "UnseenModelAdapter",
            model=["model", 0],
            image_width=256,
            image_height=256,
            empty_latent_width=128,
            empty_latent_height=128,
        )
        graph["guider"]["inputs"]["model"] = ["adapter", 0]
        self.assertEqual(targets(graph, "width"), {("latent", "width")})
        self.assertEqual(targets(graph, "height"), {("latent", "height")})

    def test_multiple_conditioning_ports_protect_shared_positive_atoms(self):
        from mio_server.comfy.compile import compile_workflow
        from mio_server.render_models import WorkflowConfig, WorkflowDoc

        graph = modern_graph()
        graph["text"] = node("CLIPTextEncode", clip=["clip", 0], text="primary subject")
        graph["exclusion"] = node("CLIPTextEncode", clip=["clip", 0], text="fixed exclusion")
        graph["pair"] = node(
            "UnseenConditioningPair", positive=["text", 0], negative=["exclusion", 0]
        )
        graph["nested"] = node("UnseenConditioningWrapper", cond1=["pair", 0])
        graph["guider"] = node(
            "UnseenMultipleGuider",
            model=["model", 0],
            cond1=["nested", 0],
            cond2=["pair", 1],
            negative=["text", 0],
        )
        graph.pop("guidance")
        before = copy.deepcopy(graph)
        self.assertEqual(targets(graph, "prompt"), set())
        self.assertEqual(targets(graph, "negative"), set())
        result = compile_workflow(
            WorkflowDoc(name="Synthetic multiple conditioning", graph=graph),
            {"prompt": "replacement", "negative": "new exclusion"},
        )
        self.assertEqual(result.graph, graph)
        explicit = WorkflowDoc(
            name="Explicit shared text",
            graph=graph,
            config=WorkflowConfig(mapping={"negative": "/text/inputs/text"}),
        )
        result = compile_workflow(explicit, {"negative": "manual choice"})
        expected = copy.deepcopy(graph)
        expected["text"]["inputs"]["text"] = "manual choice"
        self.assertEqual(result.graph, expected)
        self.assertEqual(graph, before)

    def test_multiple_conditioning_ports_preserve_independent_negative_binding(self):
        graph = modern_graph()
        graph["text"] = node("CLIPTextEncode", clip=["clip", 0], text="primary subject")
        graph["second"] = node("CLIPTextEncode", clip=["clip", 0], text="secondary subject")
        graph["exclusion"] = node("CLIPTextEncode", clip=["clip", 0], text="exclusion")
        graph["guider"] = node(
            "UnseenMultipleGuider",
            model=["model", 0],
            cond1=["text", 0],
            cond2=["second", 0],
            negative=["exclusion", 0],
        )
        self.assertEqual(targets(graph, "prompt"), set())
        self.assertEqual(targets(graph, "negative"), {("exclusion", "text")})

    def test_multiple_conditioning_selector_protects_possible_positive_branches(self):
        graph = modern_graph()
        graph["text"] = node("CLIPTextEncode", clip=["clip", 0], text="primary subject")
        graph["second"] = node("CLIPTextEncode", clip=["clip", 0], text="secondary subject")
        graph["decision"] = node("UnseenRuntimeBoolean", model=["model", 0])
        graph["switch"] = node(
            "UnseenConditionSwitch",
            boolean=["decision", 0],
            on_true=["text", 0],
            on_false=["second", 0],
        )
        graph["guider"] = node(
            "UnseenMultipleGuider",
            model=["model", 0],
            cond1=["switch", 0],
            cond2=["second", 0],
            negative=["text", 0],
        )
        self.assertEqual(targets(graph, "negative"), set())
        graph["switch"]["inputs"]["boolean"] = False
        self.assertEqual(targets(graph, "negative"), {("text", "text")})


if __name__ == "__main__":
    unittest.main()
