"""Synthetic integration contracts; no third-party workflows or prompt text are fixtures."""

from copy import deepcopy
from unittest import TestCase

from mio_server.comfy import slot_adapters
from mio_server.comfy.compile import compile_workflow
from mio_server.comfy.inspection import InspectRequest, inspect
from mio_server.render_models import WorkflowConfig, WorkflowDoc


def operation(class_type, **inputs):
    return {"class_type": class_type, "inputs": inputs}


def static_graph():
    return {
        "model": operation("CheckpointLoaderSimple", ckpt_name="synthetic.safetensors"),
        "positive": operation("CLIPTextEncode", text="synthetic subject", clip=["model", 1]),
        "negative": operation("CLIPTextEncode", text="synthetic exclusion", clip=["model", 1]),
        "latent": operation("EmptyLatentImage", width=640, height=960, batch_size=1),
        "sample": operation(
            "KSampler",
            model=["model", 0],
            positive=["positive", 0],
            negative=["negative", 0],
            latent_image=["latent", 0],
            seed=11,
            steps=20,
            cfg=5.5,
            sampler_name="euler",
            scheduler="normal",
            denoise=1.0,
        ),
        "decode": operation("VAEDecode", samples=["sample", 0], vae=["model", 2]),
        "save": operation("SaveImage", images=["decode", 0], filename_prefix="synthetic"),
    }


def literal_inputs(graph):
    """All actual edge destinations and values, independent of the inference implementation."""
    return {
        (node_id, field): deepcopy(value)
        for node_id, node in graph.items()
        for field, value in node["inputs"].items()
        if isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], str)
        and value[0] in graph
        and type(value[1]) is int
    }


class WildWorkflowContractsTests(TestCase):
    def test_two_hundred_node_graph_freezes_values_without_mutating_edges_or_document(self):
        graph = static_graph()
        upstream = "decode"
        for index in range(193):
            node_id = f"route-{index}"
            graph[node_id] = operation("Reroute", input=[upstream, 0])
            upstream = node_id
        graph["save"]["inputs"]["images"] = [upstream, 0]
        self.assertEqual(len(graph), 200)
        doc = WorkflowDoc(name="Synthetic large static graph", graph=graph)
        before = doc.model_dump()
        values = {"prompt": "replacement subject", "seed": 987, "width": 832, "height": 1216}

        compiled = compile_workflow(doc, values)
        self.assertEqual(len(compiled.graph), 200)
        self.assertEqual(literal_inputs(compiled.graph), literal_inputs(graph))
        self.assertEqual(compiled.graph["positive"]["inputs"]["text"], values["prompt"])
        self.assertEqual(compiled.graph["sample"]["inputs"]["seed"], 987)
        self.assertIs(type(compiled.graph["sample"]["inputs"]["seed"]), int)
        self.assertEqual(compiled.graph["latent"]["inputs"]["width"], 832)
        self.assertEqual(compiled.graph["latent"]["inputs"]["height"], 1216)
        self.assertEqual(doc.model_dump(), before)
        compiled.graph["positive"]["inputs"]["text"] = "changed compiled copy"
        self.assertEqual(doc.model_dump(), before)

    def test_explicit_prompt_and_seed_controls_prevent_heuristic_rewrites(self):
        graph = static_graph()
        graph["positive"]["inputs"]["text"] = ["join", 0]
        graph["subject"] = operation("TextValue", text="editable subject")
        graph["prefix"] = operation("TextValue", text="fixed style prefix")
        graph["join"] = operation("StringConcatenate", text_a=["prefix", 0], text_b=["subject", 0])
        graph["noise"] = operation("PrimitiveNode", value=11)
        graph["noise"]["_meta"] = {"title": "[mio:seed=value]"}
        graph["sample"]["inputs"]["seed"] = ["noise", 0]
        doc = WorkflowDoc(
            name="Synthetic explicit controls",
            graph=graph,
            config=WorkflowConfig(mapping={"prompt": "/subject/inputs/text"}),
        )
        before = doc.model_dump()

        compiled = compile_workflow(doc, {"prompt": "chosen subject", "seed": 42})
        self.assertEqual(compiled.graph["subject"]["inputs"]["text"], "chosen subject")
        self.assertEqual(compiled.graph["prefix"]["inputs"]["text"], "fixed style prefix")
        self.assertEqual(compiled.graph["noise"]["inputs"]["value"], 42)
        self.assertEqual(literal_inputs(compiled.graph), literal_inputs(graph))
        self.assertEqual(doc.model_dump(), before)

    def test_switch_override_keeps_both_real_branches_and_does_not_capture_old_selection(self):
        graph = static_graph()
        graph["alternate"] = operation("CheckpointLoaderSimple", ckpt_name="alternate.safetensors")
        graph["switch"] = operation(
            "ModelSwitch", input1=["model", 0], input2=["alternate", 0], select=1
        )
        graph["sample"]["inputs"]["model"] = ["switch", 0]
        doc = WorkflowDoc(name="Synthetic selectable models", graph=graph)
        before = doc.model_dump()

        compiled = compile_workflow(doc, {"seed": 42}, overrides={"/switch/inputs/select": 2})
        self.assertEqual(compiled.graph["switch"]["inputs"]["select"], 2)
        self.assertIn("model", compiled.graph)
        self.assertIn("alternate", compiled.graph)
        self.assertEqual(literal_inputs(compiled.graph), literal_inputs(graph))
        self.assertEqual(doc.model_dump(), before)

    def test_thirty_repeated_model_only_loras_keep_stable_keys_and_individual_precision(self):
        graph = static_graph()
        previous = "model"
        for index in range(30):
            node_id = f"lora-{index:02d}"
            graph[node_id] = operation(
                "LoraLoaderModelOnly",
                model=[previous, 0],
                lora_name="repeated.safetensors",
                strength_model=0.125 + index / 1000,
            )
            previous = node_id
        graph["sample"]["inputs"]["model"] = [previous, 0]
        doc = WorkflowDoc(name="Synthetic repeated LoRA chain", graph=graph)
        before = doc.model_dump()
        controls = slot_adapters.describe(doc)
        groups = controls["groups"]
        entries = [(group, item) for group in groups for item in group["loras"]]
        keys = [item["key"] for _, item in entries]
        self.assertEqual(len(keys), 30)
        self.assertEqual(len(set(keys)), 30)
        self.assertEqual(slot_adapters.describe(doc), controls)
        first_group, first = entries[0]
        last_group, last = entries[-1]
        override = {
            "groups": [
                {
                    "key": first_group["key"],
                    "loras": [
                        {"key": first["key"], "name": first["name"], "strength": -0.123456789},
                    ],
                },
                {
                    "key": last_group["key"],
                    "loras": [
                        {"key": last["key"], "name": last["name"], "enabled": False},
                    ],
                },
            ]
        }

        compiled = compile_workflow(doc, {"seed": 123}, slot_overrides=override)
        self.assertEqual(compiled.graph["lora-00"]["inputs"]["strength_model"], -0.123456789)
        self.assertEqual(compiled.graph["lora-29"]["inputs"]["strength_model"], 0)
        for index in range(1, 29):
            node_id = f"lora-{index:02d}"
            self.assertEqual(compiled.graph[node_id], graph[node_id])
        self.assertEqual(literal_inputs(compiled.graph), literal_inputs(graph))
        self.assertNotIn("strength_clip", compiled.graph["lora-00"]["inputs"])
        self.assertEqual(doc.model_dump(), before)
        self.assertEqual(compile_workflow(doc, {}).graph, graph)

    def test_ambiguous_nested_prompt_pieces_require_mapping_and_keep_constants(self):
        graph = static_graph()
        graph["part-a"] = operation("TextValue", text="first synthetic fragment")
        graph["part-b"] = operation("TextValue", text="second synthetic fragment")
        graph["inner"] = operation(
            "StringConcatenate", text_a=["part-a", 0], text_b=["part-b", 0], delimiter=", "
        )
        graph["outer"] = operation("StringConcatenate", text_a=["inner", 0], text_b="fixed suffix")
        graph["positive"]["inputs"]["text"] = ["outer", 0]
        doc = WorkflowDoc(name="Synthetic ambiguous prompt composition", graph=graph)

        report = inspect(InspectRequest(workflow=graph, values={"prompt": "replacement"}))
        self.assertTrue(report.importable)
        self.assertTrue(report.compilable)
        self.assertIn("prompt", report.missing)
        self.assertFalse(any(binding.kind == "prompt" for binding in report.bindings))
        compiled = compile_workflow(doc, {"prompt": "replacement"})
        self.assertEqual(compiled.graph, graph)
        self.assertTrue(any("prompt" in warning for warning in compiled.warnings))

    def test_modern_guider_with_deep_text_and_noise_routes_writes_only_literal_origins(self):
        graph = static_graph()
        graph["subject"] = operation("TextValue", value="synthetic routed subject")
        graph["seed-source"] = operation("PrimitiveNode", value=11)
        text_source, seed_source = "subject", "seed-source"
        for index in range(20):
            text_route, seed_route = f"text-{index}", f"seed-{index}"
            graph[text_route] = operation("Reroute", input=[text_source, 0])
            graph[seed_route] = operation("Reroute", input=[seed_source, 0])
            text_source, seed_source = text_route, seed_route
        graph["positive"]["inputs"]["text"] = [text_source, 0]
        graph["latent"]["class_type"] = "EmptySD3LatentImage"
        graph["guidance"] = operation("FluxGuidance", conditioning=["positive", 0], guidance=3.5)
        graph["guider"] = operation("BasicGuider", model=["model", 0], conditioning=["guidance", 0])
        graph["noise"] = operation("RandomNoise", noise_seed=[seed_source, 0])
        graph["algorithm"] = operation("KSamplerSelect", sampler_name="euler")
        graph["schedule"] = operation("BasicScheduler", model=["model", 0], steps=20, denoise=1.0)
        graph["sample"] = operation(
            "SamplerCustomAdvanced",
            noise=["noise", 0],
            guider=["guider", 0],
            sampler=["algorithm", 0],
            sigmas=["schedule", 0],
            latent_image=["latent", 0],
        )
        doc = WorkflowDoc(name="Synthetic modern routing", graph=graph)
        before = doc.model_dump()

        compiled = compile_workflow(
            doc, {"prompt": "new routed subject", "seed": 654, "width": 768, "height": 1152}
        )
        self.assertEqual(compiled.graph["subject"]["inputs"]["value"], "new routed subject")
        self.assertEqual(compiled.graph["seed-source"]["inputs"]["value"], 654)
        self.assertIs(type(compiled.graph["seed-source"]["inputs"]["value"]), int)
        self.assertEqual(compiled.graph["latent"]["inputs"]["width"], 768)
        self.assertEqual(compiled.graph["latent"]["inputs"]["height"], 1152)
        self.assertEqual(compiled.graph["guidance"]["inputs"]["guidance"], 3.5)
        self.assertEqual(
            literal_inputs(compiled.graph),
            {
                target: value
                for target, value in literal_inputs(graph).items()
                if target[0] in compiled.graph
            },
        )
        self.assertEqual(doc.model_dump(), before)

    def test_multiple_final_saves_survive_and_shared_intermediate_preview_is_not_final(self):
        graph = static_graph()
        graph["upscale"] = operation("ImageScaleBy", image=["decode", 0], scale_by=1.5)
        graph["final"] = operation("SaveImagePlus", images=["upscale", 0], filename_prefix="final")
        graph["preview"] = operation("PreviewImage", images=["decode", 0])
        doc = WorkflowDoc(name="Synthetic two saved branches", graph=graph)

        compiled = compile_workflow(doc, {"seed": 1})
        self.assertEqual(set(compiled.outputs), {"save", "final"})
        self.assertNotIn("preview", compiled.outputs)
        self.assertIn("save", compiled.graph)
        self.assertIn("final", compiled.graph)
        self.assertIn("upscale", compiled.graph)
        report = inspect(InspectRequest(workflow=graph))
        self.assertEqual(set(report.output_nodes), {"save", "final"})
        self.assertEqual(doc.graph, graph)
