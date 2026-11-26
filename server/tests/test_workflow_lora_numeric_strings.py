"""Native stack weight reads and partial writes share finite numeric semantics."""

import json
from copy import deepcopy
from unittest import TestCase

from mio_server.comfy import slot_adapters, workflow_slots
from mio_server.comfy.compile import compile_workflow
from mio_server.comfy.inspection import InspectRequest, inspect
from mio_server.comfy.workflow_slot_common import LibraryError
from mio_server.render_models import WorkflowDoc


def graph(inputs):
    return {
        "base": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "neutral-base.safetensors"},
        },
        "slot": {
            "class_type": "NeutralNumericStack",
            "inputs": {"model": ["base", 0], **inputs},
            "_meta": {"retained": [True, 1, 1.0, -0.0]},
        },
        "sample": {"class_type": "KSampler", "inputs": {"model": ["slot", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["sample", 0]}},
    }


def stack_inputs(power, model="0.375", clip="-0.25"):
    if power:
        return {
            "lora_1": {
                "lora": "neutral-ink.safetensors",
                "on": True,
                "strength": model,
                "strengthTwo": clip,
                "opaque": {"retained": [False, 1, 1.0]},
            }
        }
    return {
        "lora_name_1": "neutral-ink.safetensors",
        "strength_model_1": model,
        "strength_clip_1": clip,
        "enabled_1": 1,
        "opaque": {"retained": [False, 1, 1.0]},
    }


def set_weight(inputs, power, field, value):
    if power:
        inputs["lora_1"]["strength" if field == "strength" else "strengthTwo"] = value
    else:
        inputs["strength_model_1" if field == "strength" else "strength_clip_1"] = value


def keyed(group, index=0, **changes):
    row = group["loras"][index]
    return {
        "groups": [
            {
                "key": group["key"],
                "loras": [{"key": row["key"], "name": row["name"], **changes}],
            }
        ]
    }


def mode_inputs(family, mode):
    if family == "prefix":
        fields = {
            "input_mode": mode,
            "lora_count": 1,
            "lora_name_1": "neutral-ink.safetensors",
            "lora_wt_1": "-0.375",
            "model_str_1": "-0.375",
            "clip_str_1": "0.25",
            "lora_name_3": "neutral-hidden.safetensors",
            "lora_wt_3": True,
            "model_str_3": "NaN",
            "clip_str_3": {"retained": "not-active"},
        }
        shared, model, clip = "lora_wt_1", "model_str_1", "clip_str_1"
    else:
        fields = {
            "mode": mode,
            "num_loras": 1,
            "lora_1_name": "neutral-ink.safetensors",
            "lora_1_strength": "-0.375",
            "lora_1_model_strength": "-0.375",
            "lora_1_clip_strength": "0.25",
            "lora_3_name": "neutral-hidden.safetensors",
            "lora_3_strength": True,
            "lora_3_model_strength": "NaN",
            "lora_3_clip_strength": {"retained": "not-active"},
        }
        shared, model, clip = (
            "lora_1_strength",
            "lora_1_model_strength",
            "lora_1_clip_strength",
        )
    if mode == "simple":
        fields[model] = True
        fields[clip] = {"retained": "not-active"}
    else:
        fields[shared] = {"retained": "not-active"}
    return fields, shared, model, clip


class NumericStringLoRATests(TestCase):
    def exact(self, actual, expected):
        # JSON encoding distinguishes bool/int/float, signed zero and raw string formats.
        self.assertEqual(json.dumps(actual, sort_keys=True), json.dumps(expected, sort_keys=True))

    def controls(self, doc, *, kind="stack"):
        return next(
            group
            for group in slot_adapters.describe(doc)["groups"]
            if group["kind"] == kind and any(site["nodeId"] == "slot" for site in group["sites"])
        )

    def edit(self, source, changes, *, index=0, kind="stack", slots=None):
        source_before = deepcopy(source)
        doc = WorkflowDoc(name="Neutral numeric-string weights", graph=source, slots=slots)
        before = deepcopy(doc.model_dump())
        group = self.controls(doc, kind=kind)
        result = compile_workflow(doc, {}, slot_overrides=keyed(group, index, **changes))
        self.exact(doc.model_dump(), before)
        self.exact(source, source_before)
        self.exact(self.controls(doc, kind=kind), group)
        return result.graph, group

    def test_flat_and_power_discover_real_defaults_and_apply_explicit_one(self):
        for power in (False, True):
            with self.subTest(power=power):
                model, clip = ("-0.375", "0.25") if power else ("0.375", "-0.25")
                source = graph(stack_inputs(power, model, clip))
                expected = deepcopy(source)
                set_weight(expected["slot"]["inputs"], power, "strength", 1.0)
                actual, group = self.edit(source, {"strength": 1})
                self.assertEqual(group["loras"][0]["strength"], float(model))
                self.assertEqual(group["loras"][0]["clip"], float(clip))
                self.exact(actual, expected)

    def test_partial_model_and_clip_edits_preserve_unedited_numeric_strings(self):
        for power in (False, True):
            for field in ("strength", "clip"):
                with self.subTest(power=power, field=field):
                    source = graph(stack_inputs(power, " -0.3750 ", "+2.50e-1"))
                    expected = deepcopy(source)
                    set_weight(expected["slot"]["inputs"], power, field, -0.625)
                    actual, _ = self.edit(source, {field: -0.625})
                    self.exact(actual, expected)

    def test_equal_semantic_requests_preserve_every_native_representation(self):
        for power in (False, True):
            for model, clip in ((" -0.3750 ", "+2.50e-1"), (1.0, -0.0)):
                with self.subTest(power=power, model=repr(model), clip=repr(clip)):
                    source = graph(stack_inputs(power, model, clip))
                    actual, _ = self.edit(source, {"strength": float(model), "clip": float(clip)})
                    self.exact(actual, source)

    def test_finite_zero_negative_and_exponent_strings_are_consistent(self):
        for power in (False, True):
            for model, clip in (("0", "-0.0"), ("-2.5e-1", " +3.75e-1 "), (1, -2.0)):
                with self.subTest(power=power, model=repr(model), clip=repr(clip)):
                    source = graph(stack_inputs(power, model, clip))
                    actual, group = self.edit(source, {"strength": 0.5})
                    self.assertEqual(group["loras"][0]["strength"], float(model))
                    self.assertEqual(group["loras"][0]["clip"], float(clip))
                    expected = deepcopy(source)
                    set_weight(expected["slot"]["inputs"], power, "strength", 0.5)
                    self.exact(actual, expected)

    def test_duplicate_keys_disabled_neighbors_and_vacancies_remain_lossless(self):
        for power in (False, True):
            with self.subTest(power=power):
                fields = stack_inputs(power)
                if power:
                    fields.update(
                        lora_2={
                            "lora": "neutral-ink.safetensors",
                            "on": False,
                            "strength": "-0.6250",
                            "strengthTwo": "-0.2500",
                            "opaque": [False, 1, 1.0],
                        },
                        lora_3={
                            "lora": None,
                            "on": False,
                            "strength": "not-a-weight",
                            "marker": "vacancy",
                        },
                    )
                else:
                    fields.update(
                        lora_name_2="neutral-ink.safetensors",
                        strength_model_2="-0.6250",
                        strength_clip_2="-0.2500",
                        enabled_2=0.0,
                        lora_name_3="",
                        strength_model_3="not-a-weight",
                        enabled_3=0,
                    )
                source = graph(fields)
                expected = deepcopy(source)
                set_weight(expected["slot"]["inputs"], power, "strength", 1.0)
                actual, group = self.edit(source, {"strength": 1})
                first, second = group["loras"]
                self.assertNotEqual(first["key"], second["key"])
                self.assertTrue(first["enabled"])
                self.assertFalse(second["enabled"])
                self.assertEqual((second["strength"], second["clip"]), (-0.625, -0.25))
                self.exact(actual, expected)
                refreshed = self.controls(WorkflowDoc(name="Neutral result", graph=actual))
                self.assertEqual(
                    [row["key"] for row in refreshed["loras"]],
                    [first["key"], second["key"]],
                )

    def test_closed_flat_gate_reenable_keeps_original_string_weights(self):
        for closed, opened in ((0, 1), (0.0, 1.0), (False, True), ("Off", "On")):
            with self.subTest(gate=repr(closed)):
                fields = stack_inputs(False, "-0.3750", "-0.2500")
                fields["enabled_1"] = closed
                source = graph(fields)
                actual, group = self.edit(source, {"enabled": True})
                self.assertFalse(group["loras"][0]["enabled"])
                expected = deepcopy(source)
                expected["slot"]["inputs"]["enabled_1"] = opened
                self.exact(actual, expected)

    def test_optional_clip_sentinels_are_omitted_without_rewriting_fields(self):
        for power in (False, True):
            for absent in (False, True):
                for clip in (None, ""):
                    with self.subTest(power=power, absent=absent, clip=repr(clip)):
                        fields = stack_inputs(power, "-0.3750", clip)
                        if absent:
                            if power:
                                del fields["lora_1"]["strengthTwo"]
                            else:
                                del fields["strength_clip_1"]
                        source = graph(fields)
                        actual, group = self.edit(source, {"strength": 1})
                        self.assertIsNone(group["loras"][0]["clip"])
                        expected = deepcopy(source)
                        set_weight(expected["slot"]["inputs"], power, "strength", 1.0)
                        self.exact(actual, expected)

    def test_missing_model_weight_retains_existing_default_and_true_noop(self):
        for power in (False, True):
            with self.subTest(power=power):
                fields = stack_inputs(power)
                if power:
                    del fields["lora_1"]["strength"]
                else:
                    del fields["strength_model_1"]
                source = graph(fields)
                actual, group = self.edit(source, {"strength": 1})
                self.assertEqual(group["loras"][0]["strength"], 1)
                self.exact(actual, source)

    def test_simple_mode_uses_shared_string_and_ignores_inactive_bad_fields(self):
        for family in ("prefix", "suffix"):
            with self.subTest(family=family):
                fields, shared, _, _ = mode_inputs(family, "simple")
                source = graph(fields)
                actual, group = self.edit(source, {"strength": 1})
                self.assertEqual(len(group["loras"]), 1)
                self.assertEqual(group["loras"][0]["strength"], -0.375)
                self.assertIsNone(group["loras"][0]["clip"])
                expected = deepcopy(source)
                expected["slot"]["inputs"][shared] = 1.0
                self.exact(actual, expected)

    def test_simple_mode_still_rejects_independent_clip_without_mutation(self):
        for family in ("prefix", "suffix"):
            with self.subTest(family=family):
                fields, _, _, _ = mode_inputs(family, "simple")
                doc = WorkflowDoc(name="Neutral shared rejection", graph=graph(fields))
                before = deepcopy(doc.model_dump())
                group = self.controls(doc)
                with self.assertRaises(LibraryError):
                    compile_workflow(doc, {}, slot_overrides=keyed(group, clip=0.5))
                self.exact(doc.model_dump(), before)

    def test_advanced_mode_edits_only_selected_independent_string_field(self):
        for family in ("prefix", "suffix"):
            for changed in ("strength", "clip"):
                with self.subTest(family=family, changed=changed):
                    fields, _, model, clip = mode_inputs(family, "advanced")
                    source = graph(fields)
                    actual, group = self.edit(source, {changed: -0.625})
                    self.assertEqual(len(group["loras"]), 1)
                    self.assertEqual(
                        (group["loras"][0]["strength"], group["loras"][0]["clip"]),
                        (-0.375, 0.25),
                    )
                    expected = deepcopy(source)
                    expected["slot"]["inputs"][model if changed == "strength" else clip] = -0.625
                    self.exact(actual, expected)

    def test_invalid_native_weights_raise_library_error_without_echo_or_mutation(self):
        invalid = (
            True,
            False,
            "not-a-weight-do-not-echo",
            "NaN",
            "Infinity",
            "-Infinity",
            "1e9999",
            float("nan"),
            float("inf"),
            {"value": "do-not-echo"},
            ["do-not-echo"],
            10**400,
        )
        for power in (False, True):
            valid = WorkflowDoc(name="Neutral valid keys", graph=graph(stack_inputs(power)))
            group = self.controls(valid)
            for field in ("strength", "clip"):
                values = (*invalid, None, "") if field == "strength" else invalid
                for raw in values:
                    with self.subTest(power=power, field=field, raw_type=type(raw).__name__):
                        fields = stack_inputs(power)
                        set_weight(fields, power, field, raw)
                        doc = WorkflowDoc(name="Neutral invalid weight", graph=graph(fields))
                        before = deepcopy(doc.model_dump())
                        with self.assertRaises(LibraryError) as discovery:
                            slot_adapters.describe(doc)
                        self.assertEqual(discovery.exception.code, "MIO-SLOT-001")
                        self.assertNotIn("do-not-echo", str(discovery.exception))
                        with self.assertRaises(LibraryError) as application:
                            compile_workflow(doc, {}, slot_overrides=keyed(group, strength=1))
                        self.assertEqual(application.exception.code, "MIO-SLOT-001")
                        self.assertNotIn("do-not-echo", str(application.exception))
                        self.exact(doc.model_dump(), before)

    def test_bad_string_inspection_retains_structured_slot_error(self):
        for power in (False, True):
            with self.subTest(power=power):
                source = graph(stack_inputs(power, "not-a-weight-do-not-echo"))
                before = deepcopy(source)
                result = inspect(InspectRequest(workflow=source))
                self.assertTrue(result.importable)
                self.assertFalse(result.compilable)
                self.assertTrue(
                    any(
                        issue.code == "slot_error" and issue.severity == "error"
                        for issue in result.issues
                    )
                )
                self.assertNotIn("do-not-echo", " ".join(issue.message for issue in result.issues))
                self.exact(source, before)

    def test_same_revision_cached_pinned_weights_refresh_without_identity_change(self):
        for power in (False, True):
            with self.subTest(power=power):
                source = graph(stack_inputs(power, "-0.375", "0.25"))
                previous = workflow_slots.analyze(source)
                self.assertEqual(previous["analysisRevision"], 3)
                old_group = next(
                    group for group in previous["lora"]["groups"] if group["kind"] == "stack"
                )
                old_group["pinned"][0]["strength"] = 1
                old_group["pinned"][0].pop("clip", None)
                expected = deepcopy(source)
                set_weight(expected["slot"]["inputs"], power, "strength", 1.0)
                actual, group = self.edit(source, {"strength": 1}, slots={"plan": previous})
                self.assertEqual(group["key"], old_group["key"])
                self.assertEqual(
                    (group["loras"][0]["strength"], group["loras"][0]["clip"]),
                    (-0.375, 0.25),
                )
                self.exact(actual, expected)
                current = self.controls(WorkflowDoc(name="Neutral result keys", graph=actual))
                self.assertEqual(current["loras"][0]["key"], group["loras"][0]["key"])

    def test_chain_and_embedded_partial_clip_keep_original_model_representation(self):
        for embedded in (False, True):
            with self.subTest(embedded=embedded):
                fields = {
                    "lora_name": "folder\\neutral-ink.safetensors",
                    "strength_model": " -0.3750 ",
                    "strength_clip": "+2.50e-1",
                    "opaque": {"retained": [False, 1, 1.0]},
                }
                if embedded:
                    fields["ckpt_name"] = "neutral-base.safetensors"
                source = graph(fields)
                expected = deepcopy(source)
                expected["slot"]["inputs"]["strength_clip"] = -0.625
                kind = "embedded" if embedded else "chain"
                actual, group = self.edit(source, {"clip": -0.625}, kind=kind)
                self.assertEqual(
                    (group["loras"][0]["strength"], group["loras"][0]["clip"]),
                    (-0.375, 0.25),
                )
                self.exact(actual, expected)
