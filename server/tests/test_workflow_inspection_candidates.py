"""Manual recovery candidates retain source identity without widening automatic bindings."""

import copy
import unittest

from mio_server.comfy import bindings as B
from mio_server.comfy import compile as C
from mio_server.comfy import inspection as I
from mio_server.render_models import WorkflowConfig, WorkflowDoc

IMAGE_ROLES = {"ref", "init", "control", "mask"}


def node(class_type, **inputs):
    return {"class_type": class_type, "inputs": inputs}


def definition(outputs, **inputs):
    return {
        "output": outputs,
        "input": {
            "required": {
                field: kind if isinstance(kind, list) else [kind] for field, kind in inputs.items()
            }
        },
    }


def output(**inputs):
    result = node("NeutralOutput", **inputs)
    result["_meta"] = {"title": "[mio:output]"}
    return result


def reference_graph():
    graph = {
        "style": node("NeutralInput", filename="neutral-style.png"),
        "base": node("NeutralInput", filename="neutral-base.png"),
        "mask_source": node("NeutralInput", filename="neutral-mask.png"),
        "resize": node("ArbitraryRasterStep", image=["base", 0]),
        "normalize": node("AnotherRasterStep", image=["resize", 0]),
        "encode": node("AnonymousEncoder", pixels=["normalize", 0]),
        "preprocess": node("AnonymousPreprocess", image=["normalize", 0]),
        "resource": node("NeutralResource", resource="control-resource"),
        "control": node(
            "AnonymousControlUse", image=["preprocess", 0], control_net=["resource", 0]
        ),
        "style_use": node("AnonymousStyleUse", image=["style", 0]),
        "mask_first": node("FirstMaskStep", image=["mask_source", 0]),
        "mask_second": node("SecondMaskStep", image=["mask_first", 0]),
        "save": output(
            latent=["encode", 0],
            conditioning=["control", 0],
            reference=["style_use", 0],
            mask=["mask_second", 0],
        ),
    }
    info = {
        "NeutralInput": definition(["IMAGE"], filename="STRING"),
        "ArbitraryRasterStep": definition(["IMAGE"], image="IMAGE"),
        "AnotherRasterStep": definition(["IMAGE"], image="IMAGE"),
        "AnonymousEncoder": definition(["LATENT"], pixels="IMAGE"),
        "AnonymousPreprocess": definition(["IMAGE"], image="IMAGE"),
        "NeutralResource": definition(["CONTROL_NET"], resource="STRING"),
        "AnonymousControlUse": definition(
            ["CONDITIONING"], image="IMAGE", control_net="CONTROL_NET"
        ),
        "AnonymousStyleUse": definition(["IMAGE"], image="IMAGE"),
        "FirstMaskStep": definition(["IMAGE"], image="IMAGE"),
        "SecondMaskStep": definition(["MASK"], image="IMAGE"),
        "NeutralOutput": definition(
            [], latent="LATENT", conditioning="CONDITIONING", reference="IMAGE", mask="MASK"
        ),
    }
    return graph, info


class WorkflowInspectionCandidateTests(unittest.TestCase):
    def candidates(self, graph, info=None):
        before = copy.deepcopy(graph)
        found = I._candidates(graph, {"prompt", "negative"}, info)
        self.assertTrue(all(binding.source == "candidate" for binding in found))
        self.assertEqual(graph, before)
        return {(binding.kind, binding.node, binding.field) for binding in found}

    def roles(self, found, node_id):
        return {kind for kind, source, _ in found if source == node_id and kind in IMAGE_ROLES}

    def test_empty_paired_and_typed_text_fields_are_manual_candidates(self):
        graph = {
            "pair": node("AnonymousPair", prompt="", negative_prompt=" \t"),
            "alias": node("AnotherPair", positive_prompt="  ", negative_prompt=""),
            "typed": node(
                "AnonymousText",
                body="",
                description=" \n",
                filename="neutral.png",
                model="neutral-resource",
                scheduler="uniform",
                mode="manual",
                label="single line",
            ),
            "integer": node("AnonymousInteger", prompt="7"),
            "context": node("AnonymousConditioning", detail=""),
            "save": output(
                first=["pair", 0],
                second=["alias", 0],
                third=["typed", 0],
                fourth=["integer", 0],
                fifth=["context", 0],
            ),
        }
        info = {
            "AnonymousPair": definition(
                ["CONDITIONING"], prompt="STRING", negative_prompt="STRING"
            ),
            "AnotherPair": definition(
                ["CONDITIONING"], positive_prompt="STRING", negative_prompt="STRING"
            ),
            "AnonymousText": definition(
                ["STRING"],
                body=["STRING", {"multiline": True}],
                filename="STRING",
                model="STRING",
                scheduler="STRING",
                mode="STRING",
                label="STRING",
            ),
            "AnonymousInteger": definition(["INT"], prompt="INT"),
            "AnonymousConditioning": definition(["CONDITIONING"], detail="STRING"),
        }
        info["AnonymousText"]["input"]["optional"] = {
            "description": ["STRING", {"multiline": True}]
        }
        before, automatic = copy.deepcopy(graph), B.resolve(graph)
        report = I.inspect(I.InspectRequest(workflow=graph, object_info=info))
        found = {(binding.kind, binding.node, binding.field) for binding in report.candidates}
        self.assertTrue(
            {
                ("prompt", "pair", "prompt"),
                ("negative", "pair", "negative_prompt"),
                ("prompt", "alias", "positive_prompt"),
                ("negative", "alias", "negative_prompt"),
                ("prompt", "typed", "body"),
                ("prompt", "typed", "description"),
                ("prompt", "context", "detail"),
            }
            <= found
        )
        self.assertFalse(
            any(
                source == "integer"
                or (
                    source == "typed"
                    and field in {"filename", "model", "scheduler", "mode", "label"}
                )
                for kind, source, field in found
                if kind in {"prompt", "negative"}
            )
        )
        self.assertTrue({"prompt", "negative"} <= set(report.missing))
        self.assertFalse(any(binding.kind in {"prompt", "negative"} for binding in report.bindings))
        self.assertEqual({binding.kind for binding in automatic[0]}, {"output"})
        self.assertEqual(B.resolve(graph), automatic)
        self.assertEqual(graph, before)
        without_info = self.candidates(graph)
        self.assertIn(("prompt", "pair", "prompt"), without_info)
        self.assertIn(("negative", "pair", "negative_prompt"), without_info)
        for kind, field in (("prompt", "prompt"), ("negative", "negative_prompt")):
            compiled = C.compile_workflow(
                WorkflowDoc(
                    name="Neutral empty text mapping",
                    graph=graph,
                    config=WorkflowConfig(mapping={kind: f"/pair/inputs/{field}"}),
                ),
                {kind: "manual neutral text"},
            )
            expected = copy.deepcopy(graph)
            expected["pair"]["inputs"][field] = "manual neutral text"
            self.assertEqual(compiled.graph, expected)
            self.assertEqual(graph, before)

    def test_empty_literal_text_chains_need_payload_context_not_just_string_values(self):
        controls = ("filename", "model", "scheduler", "mode")
        info = {
            "PlainValue": definition(["STRING"], value="STRING"),
            "PlainString": definition(["STRING"], string="STRING"),
            "Reroute": definition(["STRING"], value="STRING"),
            "PrimitiveNode": definition(["STRING"], value="STRING"),
            "CLIPTextEncode": definition(["CONDITIONING"], text="STRING"),
            "TextAssembly": definition(
                ["STRING"], text="STRING", prompt="STRING", **dict.fromkeys(controls, "STRING")
            ),
            "ScalarOutput": definition(["INT"], value="STRING"),
        }
        for literal in ("", " \t"):
            for typed in (False, True):
                with self.subTest(literal=repr(literal), typed=typed):
                    graph = {
                        "value_source": node("PlainValue", value=literal),
                        "string_source": node("PlainString", string=literal),
                        "reroute": node("Reroute", value=["value_source", 0]),
                        "primitive": node("PrimitiveNode", value=["reroute", 0]),
                        "string_route": node("PrimitiveNode", value=["string_source", 0]),
                        "first_encoder": node("CLIPTextEncode", text=["assembly", 0]),
                        "second_encoder": node("CLIPTextEncode", text=["string_route", 0]),
                        "unrelated_value": node("PlainValue", value=literal),
                        "unrelated_string": node("PlainString", string=literal),
                        "scalar": node("ScalarOutput", value=literal),
                        **{
                            f"control_{field}": node("PlainValue", value=literal)
                            for field in controls
                        },
                    }
                    graph["assembly"] = node(
                        "TextAssembly",
                        text=["primitive", 0],
                        prompt=["scalar", 0],
                        **{field: [f"control_{field}", 0] for field in controls},
                    )
                    graph["save"] = output(
                        first=["first_encoder", 0],
                        second=["second_encoder", 0],
                        unrelated_a=["unrelated_value", 0],
                        unrelated_b=["unrelated_string", 0],
                    )
                    before, automatic = copy.deepcopy(graph), B.resolve(graph)
                    report = I.inspect(
                        I.InspectRequest(workflow=graph, object_info=info if typed else None)
                    )
                    found = {
                        (binding.kind, binding.node, binding.field) for binding in report.candidates
                    }
                    self.assertTrue(all(b.source == "candidate" for b in report.candidates))
                    self.assertIn(("prompt", "value_source", "value"), found)
                    self.assertIn(("negative", "string_source", "string"), found)
                    excluded = {"unrelated_value", "unrelated_string"} | {
                        f"control_{field}" for field in controls
                    }
                    if typed:
                        excluded.add("scalar")
                    self.assertFalse(
                        any(
                            source in excluded
                            for kind, source, _ in found
                            if kind in {"prompt", "negative"}
                        )
                    )
                    self.assertEqual({binding.kind for binding in automatic[0]}, {"output"})
                    self.assertEqual(B.resolve(graph), automatic)
                    self.assertEqual(graph, before)
                    for kind, source, field in (
                        ("prompt", "value_source", "value"),
                        ("negative", "string_source", "string"),
                    ):
                        compiled = C.compile_workflow(
                            WorkflowDoc(
                                name="Neutral text origin mapping",
                                graph=graph,
                                config=WorkflowConfig(mapping={kind: f"/{source}/inputs/{field}"}),
                            ),
                            {kind: "manual neutral origin"},
                        )
                        expected = copy.deepcopy(graph)
                        expected[source]["inputs"][field] = "manual neutral origin"
                        self.assertEqual(compiled.graph, expected)
                        self.assertEqual(graph, before)

    def test_image_roles_cross_payload_steps_without_merging_independent_sources(self):
        graph, info = reference_graph()
        before, automatic = copy.deepcopy(graph), B.resolve(graph)
        for catalog in (None, info):
            with self.subTest(typed=catalog is not None):
                report = I.inspect(I.InspectRequest(workflow=graph, object_info=catalog))
                found = {
                    (binding.kind, binding.node, binding.field) for binding in report.candidates
                }
                self.assertEqual(self.roles(found, "style"), {"ref"})
                self.assertTrue({"ref", "init", "control"} <= self.roles(found, "base"))
                self.assertTrue({"ref", "mask"} <= self.roles(found, "mask_source"))
                self.assertFalse(any(binding.kind in IMAGE_ROLES for binding in report.bindings))
                self.assertEqual(B.resolve(graph), automatic)
                self.assertEqual(graph, before)

    def test_manual_mapping_and_explicit_tags_only_write_the_selected_source(self):
        graph, _ = reference_graph()
        before = copy.deepcopy(graph)
        for kind, source in (("init", "base"), ("ref:1", "style")):
            with self.subTest(kind=kind):
                compiled = C.compile_workflow(
                    WorkflowDoc(
                        name="Neutral manual source",
                        graph=graph,
                        config=WorkflowConfig(mapping={kind: f"/{source}/inputs/filename"}),
                    ),
                    {kind: "neutral-replacement.png"},
                )
                expected = copy.deepcopy(graph)
                expected[source]["inputs"]["filename"] = "neutral-replacement.png"
                self.assertEqual(compiled.graph, expected)
                self.assertEqual(graph, before)
        graph["base"]["_meta"] = {"title": "[mio:init=filename]"}
        tagged_before = copy.deepcopy(graph)
        compiled = C.compile_workflow(
            WorkflowDoc(
                name="Neutral explicit sources",
                graph=graph,
                config=WorkflowConfig(mapping={"ref:1": "/style/inputs/filename"}),
            ),
            {"init": "neutral-tagged.png"},
        )
        expected = copy.deepcopy(graph)
        expected["base"]["inputs"]["filename"] = "neutral-tagged.png"
        self.assertEqual(compiled.graph, expected)
        self.assertTrue(
            {
                ("init", "base", "filename", "tag"),
                ("ref", "style", "filename", "mapping"),
            }
            <= {
                (binding.kind, binding.node, binding.field, binding.source)
                for binding in compiled.resolved_bindings
            }
        )
        self.assertEqual(graph, tagged_before)

    def test_typed_payloads_exclude_scalar_outputs_and_control_dependencies(self):
        graph = {
            key: node("NeutralInput", filename=f"neutral-{key}.png")
            for key in ("real", "width_source", "text_source", "model_source")
        }
        graph["step"] = node(
            "ArbitraryTypedStep",
            raster=["real", 0],
            image_width=["width_source", 0],
            text=["text_source", 0],
            model=["model_source", 0],
        )
        graph["encode"] = node("AnonymousEncoder", pixels=["step", 0])
        info = {
            "NeutralInput": definition(["IMAGE"], filename="STRING"),
            "ArbitraryTypedStep": definition(
                ["IMAGE", "INT"], raster="IMAGE", image_width="INT", text="STRING", model="MODEL"
            ),
            "AnonymousEncoder": definition(["LATENT"], pixels="IMAGE"),
        }
        found = self.candidates(graph, info)
        self.assertIn("init", self.roles(found, "real"))
        for source in ("width_source", "text_source", "model_source"):
            self.assertNotIn("init", self.roles(found, source))
        graph["encode"]["inputs"]["pixels"] = ["step", 1]
        found = self.candidates(graph, info)
        self.assertFalse(any("init" in self.roles(found, source) for source in graph))

    def test_invalid_ports_and_inactive_or_ambiguous_bypasses_do_not_gain_roles(self):
        for slot in (-1, 1, True):
            with self.subTest(slot=slot):
                graph = {
                    "source": node("NeutralInput", filename="neutral-source.png"),
                    "step": node("ArbitraryStep", image=["source", slot]),
                    "encode": node("AnonymousEncoder", pixels=["step", 0]),
                }
                info = {"NeutralInput": definition(["IMAGE"], filename="STRING")}
                self.assertNotIn("init", self.roles(self.candidates(graph, info), "source"))
        graph["step"]["inputs"]["image"] = ["source", 0]
        graph["encode"]["inputs"]["pixels"] = ["step", 1]
        self.assertNotIn("init", self.roles(self.candidates(graph), "source"))
        for mode, extra, expected in ((2, False, False), (4, False, True), (4, True, False)):
            with self.subTest(mode=mode, extra=extra):
                graph = {
                    "source": node("NeutralInput", filename="neutral-source.png"),
                    "other": node("NeutralInput", filename="neutral-other.png"),
                    "step": node("ArbitraryStep", image=["source", 0]),
                    "encode": node("AnonymousEncoder", pixels=["step", 0]),
                }
                graph["step"]["mode"] = mode
                if extra:
                    graph["step"]["inputs"]["other_image"] = ["other", 0]
                found = self.candidates(graph)
                self.assertEqual("init" in self.roles(found, "source"), expected)
                self.assertNotIn("init", self.roles(found, "other"))
        for mode in (2, 4):
            graph = {"source": node("NeutralInput", filename="neutral-source.png")}
            graph["source"]["mode"] = mode
            self.assertEqual(self.roles(self.candidates(graph), "source"), set())

    def test_selectors_keep_static_branches_and_auxiliary_outputs_separate(self):
        for choice, slot, expected in (
            (True, 0, {"first"}),
            (False, 0, {"second"}),
            ("dynamic", 0, {"first", "second"}),
            (True, 1, set()),
        ):
            with self.subTest(choice=choice, slot=slot):
                graph = {
                    "first": node("NeutralInput", filename="neutral-first.png"),
                    "second": node("NeutralInput", filename="neutral-second.png"),
                    "flag": node("UnseenBooleanTransform", value=True),
                    "switch": node(
                        "UnseenSelector",
                        on_true=["first", 0],
                        on_false=["second", 0],
                        boolean=["flag", 0] if choice == "dynamic" else choice,
                    ),
                    "encode": node("AnonymousEncoder", pixels=["switch", slot]),
                }
                info = {
                    "NeutralInput": definition(["IMAGE"], filename="STRING"),
                    "UnseenBooleanTransform": definition(["BOOLEAN"], value="BOOLEAN"),
                    "UnseenSelector": definition(
                        ["IMAGE", "IMAGE"], on_true="IMAGE", on_false="IMAGE", boolean="BOOLEAN"
                    ),
                }
                found = self.candidates(graph, info)
                self.assertEqual(
                    {
                        source
                        for source in ("first", "second")
                        if "init" in self.roles(found, source)
                    },
                    expected,
                )
                self.assertFalse(
                    any(binding.kind in IMAGE_ROLES for binding in B.resolve(graph)[0])
                )

    def test_cyclic_payload_dependencies_are_bounded_and_leave_graph_unchanged(self):
        graph = {
            "source": node("NeutralInput", filename="neutral-cycle.png"),
            "first": node("UnseenBlend", image=["second", 0], other_image=["source", 0]),
            "second": node("UnseenRaster", image=["first", 0]),
            "encode": node("AnonymousEncoder", pixels=["first", 0]),
        }
        info = {
            "NeutralInput": definition(["IMAGE"], filename="STRING"),
            "UnseenBlend": definition(["IMAGE"], image="IMAGE", other_image="IMAGE"),
            "UnseenRaster": definition(["IMAGE"], image="IMAGE"),
        }
        before = copy.deepcopy(graph)
        found = self.candidates(graph, info)
        self.assertIn("init", self.roles(found, "source"))
        self.assertEqual(graph, before)


if __name__ == "__main__":
    unittest.main()
