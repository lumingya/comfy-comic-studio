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
        self.assertEqual(targets(graph, "prompt"), {("text", "clip_l"), ("text", "t5xxl")})
        self.assertEqual(
            targets(graph, "negative"),
            {("negative", "clip_l"), ("negative", "clip_g"), ("negative", "t5xxl")},
        )
        self.assertEqual(targets(graph, "cfg"), {("guider", "cfg")})

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


if __name__ == "__main__":
    unittest.main()
