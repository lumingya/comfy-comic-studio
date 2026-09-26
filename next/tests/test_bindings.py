import copy
import unittest

from mio_next.comfy import bindings as B


def link(node, slot=0):
    return [node, slot]


def multi_stage_workflow():
    """Synthetic stand-in for a real multi-stage workflow (custom prompt UI node, two samplers
    sharing one seed, resolution node, draft + final outputs, frontend-only seed node)."""
    return {
        "1": {"class_type": "CheckpointLoader", "inputs": {"ckpt_name": "base.safetensors"}, "_meta": {"title": "Checkpoint"}},
        "2": {"class_type": "LoraStack", "inputs": {"text": "<lora:style_a:0.8>", "loras": {"__value__": [
            {"name": "style_a", "active": True}, {"name": "style_b", "active": False}]}, "model": link("1")},
              "_meta": {"title": "LoRA stack"}},
        "10": {"class_type": "FancyPromptUI", "inputs": {"positive": "old subject tags", "auto_random": False},
               "_meta": {"title": "Positive editor [mio:prompt=positive]"}},
        "11": {"class_type": "FancyPromptUI", "inputs": {"positive": "old negative", "auto_random": False},
               "_meta": {"title": "Negative editor [mio:negative=positive]"}},
        "12": {"class_type": "PromptSelector", "inputs": {"selected_prompts": "masterpiece, best quality, forbidden_style,"},
               "_meta": {"title": "Fixed prefix"}},
        "13": {"class_type": "PromptSelector", "inputs": {"selected_prompts": "forbidden_tag,"}, "_meta": {"title": "Fixed suffix"}},
        "14": {"class_type": "PromptConcat", "inputs": {"a": link("12"), "b": link("10"), "c": link("13")}, "_meta": {"title": "concat"}},
        "15": {"class_type": "PCTextEncode", "inputs": {"text": link("14"), "clip": link("2", 1)}, "_meta": {"title": "encode +"}},
        "16": {"class_type": "CLIPTextEncode", "inputs": {"text": link("11"), "clip": link("2", 1)}, "_meta": {"title": "encode -"}},
        "20": {"class_type": "ResolutionMasterSimplify", "inputs": {"width": 768, "height": 1024},
               "_meta": {"title": "Resolution [mio:width] [mio:height]"}},
        "21": {"class_type": "EmptyLatentImage", "inputs": {"width": link("20", 0), "height": link("20", 1), "batch_size": 1},
               "_meta": {"title": "latent"}},
        "30": {"class_type": "KSamplerAdvanced", "inputs": {"noise_seed": 1, "steps": 20, "model": link("2"),
                                                            "positive": link("15"), "negative": link("16"), "latent_image": link("21")},
               "_meta": {"title": "Sampler [mio:seed=noise_seed]"}},
        "31": {"class_type": "KSamplerAdvanced", "inputs": {"noise_seed": 1, "steps": 20, "model": link("2"),
                                                            "positive": link("15"), "negative": link("16"), "latent_image": link("30")},
               "_meta": {"title": "Refiner [mio:seed=noise_seed]"}},
        "40": {"class_type": "VAEDecode", "inputs": {"samples": link("31"), "vae": link("1", 2)}, "_meta": {"title": "decode"}},
        "50": {"class_type": "PreviewImage", "inputs": {"images": link("40")}, "_meta": {"title": "Base [mio:output:draft]"}},
        "60": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "4x.pth"}, "_meta": {"title": "upscaler"}},
        "61": {"class_type": "ImageUpscaleWithModel", "inputs": {"image": link("40"), "upscale_model": link("60")}, "_meta": {"title": "upscale"}},
        "62": {"class_type": "SaveImage", "inputs": {"images": link("61"), "filename_prefix": "final"}, "_meta": {"title": "Final [mio:output:final]"}},
        "70": {"class_type": "ShowText", "inputs": {"text": link("14")}, "_meta": {"title": "Final prompt [mio:inspect]"}},
        "80": {"class_type": "easy globalSeed", "inputs": {"value": 5, "mode": True}, "_meta": {"title": "frontend-only seed"}},
    }


def plain_sdxl():
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "x.safetensors"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 832, "height": 1216, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "pos", "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "neg", "clip": ["4", 1]}},
        "3": {"class_type": "KSampler", "inputs": {"seed": 1, "steps": 20, "model": ["4", 0], "positive": ["6", 0],
                                                   "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "x"}},
    }


class TagParsingTests(unittest.TestCase):
    def test_parse_multiple_tags_with_qualifier_and_field(self):
        self.assertEqual(
            B.parse_tags("Res [mio:width] [MIO:height=h] [mio:output:draft] [mio:ref:2=image]"),
            [("width", None, None), ("height", None, "h"), ("output", "draft", None), ("ref", "2", "image")],
        )

    def test_titles_without_tags(self):
        self.assertEqual(B.parse_tags("K采样器"), [])
        self.assertEqual(B.parse_tags(""), [])


class ResolveTests(unittest.TestCase):
    def setUp(self):
        self.graph = multi_stage_workflow()
        self.bindings, self.problems = B.resolve(self.graph)
        self.by_kind = {}
        for b in self.bindings:
            self.by_kind.setdefault(b.kind, []).append(b)

    def test_field_selection_on_custom_prompt_nodes(self):
        self.assertEqual([(b.node, b.field) for b in self.by_kind["prompt"]], [("10", "positive")])
        self.assertEqual([(b.node, b.field) for b in self.by_kind["negative"]], [("11", "positive")])

    def test_seed_fans_out_to_both_samplers(self):
        self.assertEqual(sorted((b.node, b.field) for b in self.by_kind["seed"]), [("30", "noise_seed"), ("31", "noise_seed")])

    def test_default_fields_for_resolution(self):
        self.assertEqual([(b.node, b.field) for b in self.by_kind["width"]], [("20", "width")])
        self.assertEqual([(b.node, b.field) for b in self.by_kind["height"]], [("20", "height")])

    def test_outputs_carry_variants(self):
        self.assertEqual(sorted((b.node, b.qualifier) for b in self.by_kind["output"]), [("50", "draft"), ("62", "final")])
        self.assertEqual(self.problems, [])

    def test_apply_values_writes_every_target_and_keeps_input_untouched(self):
        before = copy.deepcopy(self.graph)
        out = B.apply_values(self.graph, self.bindings, {"prompt": "1girl, adult, seaside", "seed": 42, "width": 832, "height": 1216})
        self.assertEqual(self.graph, before)
        self.assertEqual(out["10"]["inputs"]["positive"], "1girl, adult, seaside")
        self.assertEqual((out["30"]["inputs"]["noise_seed"], out["31"]["inputs"]["noise_seed"]), (42, 42))
        self.assertEqual((out["20"]["inputs"]["width"], out["20"]["inputs"]["height"]), (832, 1216))
        self.assertEqual(out["11"]["inputs"]["positive"], "old negative")  # no value given -> unchanged

    def test_problems_for_unknown_tag_link_field_and_missing_field(self):
        graph = plain_sdxl()
        graph["6"]["_meta"] = {"title": "[mio:prompt=clip] [mio:wat]"}
        graph["5"]["_meta"] = {"title": "[mio:seed]"}
        graph["7"]["_meta"] = {"title": "[mio:negative=missing]"}
        _, problems = B.tag_bindings(graph)
        self.assertEqual(len(problems), 4, problems)
        self.assertTrue(any("连线" in p for p in problems))
        self.assertTrue(any("未知标签" in p for p in problems))


class VariantTests(unittest.TestCase):
    def setUp(self):
        self.graph = multi_stage_workflow()
        self.bindings, _ = B.resolve(self.graph)

    def test_draft_keeps_base_branch_and_inspect_only(self):
        pruned, outputs = B.select_variant(self.graph, self.bindings, "draft")
        self.assertEqual(outputs, ["50"])
        self.assertIn("70", pruned)  # [mio:inspect] survives for prompt verification
        for gone in ("60", "61", "62", "80"):
            self.assertNotIn(gone, pruned)
        self.assertIn("30", pruned)

    def test_final_keeps_upscale_branch(self):
        pruned, outputs = B.select_variant(self.graph, self.bindings, "final")
        self.assertEqual(outputs, ["62"])
        self.assertTrue({"60", "61", "62", "40"} <= set(pruned))
        self.assertNotIn("50", pruned)

    def test_unknown_variant_is_an_error(self):
        with self.assertRaises(B.BindingError):
            B.select_variant(self.graph, self.bindings, "preview")


class OverrideAndGuardTests(unittest.TestCase):
    def setUp(self):
        self.graph = multi_stage_workflow()

    def test_overrides_set_existing_values_including_nested_lists(self):
        out = B.apply_overrides(self.graph, {
            "/13/inputs/selected_prompts": "",
            "/2/inputs/text": "",
            "/2/inputs/loras/__value__/0/active": False,
        })
        self.assertEqual(out["13"]["inputs"]["selected_prompts"], "")
        self.assertFalse(out["2"]["inputs"]["loras"]["__value__"][0]["active"])
        self.assertEqual(self.graph["13"]["inputs"]["selected_prompts"], "forbidden_tag,")

    def test_overrides_never_create_keys_or_replace_links(self):
        with self.assertRaises(B.BindingError):
            B.apply_overrides(self.graph, {"/13/inputs/new_field": 1})
        with self.assertRaises(B.BindingError):
            B.apply_overrides(self.graph, {"/15/inputs/text": "direct"})
        with self.assertRaises(B.BindingError):
            B.apply_overrides(self.graph, {"/2/inputs/loras/__value__/9/active": False})

    def test_overrides_for_pruned_nodes_are_ignored(self):
        bindings, _ = B.resolve(self.graph)
        pruned, _ = B.select_variant(self.graph, bindings, "draft")
        out = B.apply_overrides(pruned, {"/62/inputs/filename_prefix": "x"})
        self.assertNotIn("62", out)

    def test_guard_finds_terms_in_every_prompt_source_until_overridden(self):
        hits = B.guard_terms(self.graph, ["forbidden_tag", "forbidden_style"])
        self.assertEqual(sorted((n, t) for n, _, t in hits), [("12", "forbidden_style"), ("13", "forbidden_tag")])
        clean = B.apply_overrides(self.graph, {"/13/inputs/selected_prompts": "", "/12/inputs/selected_prompts": "masterpiece"})
        self.assertEqual(B.guard_terms(clean, ["forbidden_tag", "forbidden_style"]), [])

    def test_guard_ascii_terms_match_whole_words_only(self):
        graph = plain_sdxl()
        graph["6"]["inputs"]["text"] = "lollipop, bold"
        self.assertEqual(B.guard_terms(graph, ["lolli", "old"]), [])
        graph["6"]["inputs"]["text"] = "an old house"
        self.assertEqual(len(B.guard_terms(graph, ["old"])), 1)


class WildcardGuardLintTests(unittest.TestCase):
    def test_wildcard_switches_off_every_lora_entry(self):
        out = B.apply_overrides(multi_stage_workflow(), {"/2/inputs/loras/__value__/*/active": False})
        self.assertEqual([e["active"] for e in out["2"]["inputs"]["loras"]["__value__"]], [False, False])
        with self.assertRaises(B.BindingError):
            B.apply_overrides(multi_stage_workflow(), {"/*/inputs/text": ""})
        with self.assertRaises(B.BindingError):
            B.apply_overrides(multi_stage_workflow(), {"/2/inputs/loras/__value__/*/missing": 1})

    def test_guard_reads_nested_strings_but_not_asset_names(self):
        graph = multi_stage_workflow()
        graph["2"]["inputs"]["loras"]["__value__"][0]["name"] = "forbidden_tag_lora"
        graph["90"] = {"class_type": "TriggerToggle", "inputs": {"words": {"__value__": [{"text": "forbidden_tag", "active": True}]},
                                                               "ckpt_name": "forbidden_tag.safetensors"}}
        hits = B.guard_terms(graph, ["forbidden_tag"])
        self.assertIn(("90", "words/__value__/0/text", "forbidden_tag"), hits)
        self.assertFalse(any(n == "2" for n, _, _ in hits))
        self.assertFalse(any("ckpt" in path for _, path, _ in hits))

    def test_guard_skips_fields_bound_as_negative(self):
        graph = multi_stage_workflow()
        graph["11"]["inputs"]["positive"] = "forbidden_tag, lowres"
        clean = B.apply_overrides(graph, {"/12/inputs/selected_prompts": "", "/13/inputs/selected_prompts": ""})
        self.assertEqual(len(B.guard_terms(clean, ["forbidden_tag"])), 1)
        self.assertEqual(B.guard_terms(clean, ["forbidden_tag"], skip={("11", "positive")}), [])

    def test_guard_text_on_final_prompt(self):
        self.assertEqual(B.guard_text("masterpiece, forbidden_tag, 1girl", ["forbidden_tag", "x"]), ["forbidden_tag"])
        self.assertEqual(B.guard_text("masterpiece", ["forbidden_tag"]), [])

    def test_lint_flags_outputs_that_hide_images(self):
        graph = multi_stage_workflow()
        graph["62"]["inputs"]["enable_preview"] = False
        warnings = B.lint_outputs(graph, ["62", "50"])
        self.assertEqual(len(warnings), 1)
        self.assertIn("/62/inputs/enable_preview=true", warnings[0])


class FallbackTests(unittest.TestCase):
    def test_heuristics_bind_a_plain_workflow(self):
        bindings, problems = B.resolve(plain_sdxl())
        summary = B.summary(bindings)
        self.assertEqual(summary["prompt"], ["6.text (heuristic)"])
        self.assertEqual(summary["negative"], ["7.text (heuristic)"])
        self.assertEqual(summary["seed"], ["3.seed (heuristic)"])
        self.assertEqual(summary["width"], ["5.width (heuristic)"])
        self.assertEqual(summary["output"], ["9 (heuristic)"])
        self.assertEqual(problems, [])
        pruned, outputs = B.select_variant(plain_sdxl(), bindings, None)
        self.assertEqual(outputs, ["9"])
        self.assertEqual(len(pruned), 7)

    def test_heuristics_never_duplicate_tagged_kinds(self):
        graph = plain_sdxl()
        graph["5"]["_meta"] = {"title": "[mio:width] [mio:height] [mio:batch]"}
        bindings, _ = B.resolve(graph)
        self.assertEqual([b.source for b in bindings if b.kind == "batch"], ["tag"])
        bindings, _ = B.resolve(plain_sdxl())
        self.assertEqual([b.source for b in bindings if b.kind == "batch"], ["heuristic"])

    def test_mapping_bindings_and_errors(self):
        graph = plain_sdxl()
        bindings, _ = B.resolve(graph, {"seed": ["/3/inputs/seed"], "ref:1": "/6/inputs/text"})
        self.assertIn(B.Binding("seed", "3", "seed", None, "mapping"), bindings)
        self.assertIn(B.Binding("ref", "6", "text", "1", "mapping"), bindings)
        with self.assertRaises(B.BindingError):
            B.resolve(graph, {"seed": ["/3/seed"]})
        with self.assertRaises(B.BindingError):
            B.resolve(graph, {"seed": ["/3/inputs/nope"]})


if __name__ == "__main__":
    unittest.main()
