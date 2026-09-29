"""预设「LoRA / 节点输入绑定」: presets write workflow node inputs when their album renders."""

import unittest

from pydantic import ValidationError

from mio_server.comfy.bindings import BindingError
from mio_server.models import Preset, PresetBinding, PresetEntry, Series, coerce_binding
from mio_server.pipeline.node_overrides import node_overrides
from mio_server.render_models import RenderProfile, RenderStage
from mio_server.workshop import preset_from_legacy

from .test_render_qa import Harness


def preset(title, *bindings, **variables):
    return Preset(
        title=title,
        entries=[PresetEntry(key=k, value=v) for k, v in variables.items()],
        bindings=list(bindings),
    )


class ModelTests(unittest.TestCase):
    def test_values_follow_the_chosen_type(self):
        self.assertEqual(coerce_binding(" 0.75 ", "number"), 0.75)
        self.assertEqual(coerce_binding("3.0", "number"), 3)
        self.assertIs(coerce_binding("1", "boolean"), True)
        self.assertIs(coerce_binding("off", "boolean"), False)
        self.assertEqual(coerce_binding('{"a": [1]}', "json"), {"a": [1]})
        self.assertEqual(coerce_binding("0.8", "text"), "0.8")
        # auto: finite numbers and true/false become typed, everything else stays text.
        self.assertEqual(coerce_binding("0.8", "auto"), 0.8)
        self.assertIs(coerce_binding("false", "auto"), False)
        self.assertEqual(coerce_binding("girl.safetensors", "auto"), "girl.safetensors")
        for raw, kind in (
            ("abc", "number"),
            ("inf", "number"),
            ("maybe", "boolean"),
            ("{", "json"),
        ):
            with self.assertRaises(ValueError):
                coerce_binding(raw, kind)

    def test_a_binding_is_checked_when_it_is_saved(self):
        b = PresetBinding(node_id="12", path="/lora_name/", source="variable", value=" {lora} ")
        self.assertEqual(
            (b.path, b.value, b.pointer), ("lora_name", "lora", "/12/inputs/lora_name")
        )
        for bad in (
            {"node_id": "", "path": "x"},
            {"node_id": "1", "path": "  "},
            {"node_id": "1", "path": "loras/*/on"},
            {"node_id": "1", "path": "x", "source": "variable", "value": "{}"},
            {"node_id": "1", "path": "x", "type": "number", "value": "abc"},
            {"node_id": "1", "path": "x", "type": "json", "value": '{"a":'},
        ):
            with self.assertRaises(ValidationError, msg=bad):
                PresetBinding(**bad)
        # A literal with {变量} is only typed at render time.
        PresetBinding(node_id="1", path="x", type="number", value="{strength}")

    def test_one_enabled_binding_per_input(self):
        a = PresetBinding(node_id="12", path="lora_name", value="a")
        with self.assertRaises(ValidationError):
            preset("p", a, PresetBinding(node_id="12", path="lora_name", value="b"))
        off = PresetBinding(node_id="12", path="lora_name", value="b", enabled=False)
        self.assertEqual(len(preset("p", a, off).bindings), 2)

    def test_legacy_bindings_are_imported(self):
        p = preset_from_legacy(
            {
                "id": "old",
                "title": "七海",
                "entries": [{"key": "lora", "value": "nanami.safetensors"}],
                "bindings": [
                    {"nodeId": "12", "path": "lora_name", "source": "variable", "value": "lora", "type": "text", "enabled": True},
                    {"nodeId": "12", "path": "lora_name", "source": "literal", "value": "x", "enabled": True},
                    {"nodeId": "12", "path": "strength_model", "source": "literal", "value": "0.7", "type": "auto"},
                    {"nodeId": "", "path": "broken", "source": "literal", "value": "", "enabled": True},
                    {"nodeId": "3", "path": "text", "source": "positive", "enabled": True},
                ],
            }
        )  # fmt: skip
        self.assertEqual(
            [(b.path, b.source, b.enabled) for b in p.bindings],
            [("lora_name", "variable", True), ("lora_name", "literal", False), ("strength_model", "literal", True)],
        )  # fmt: skip


class OverrideTests(unittest.TestCase):
    def album(self, *presets, kind="album"):
        variables = {}
        for p in presets:
            variables.update(p.variables())
        return Series(title="册", kind=kind, presets=list(presets), variables=variables)

    def test_variables_literals_and_precedence(self):
        character = preset(
            "七海",
            PresetBinding(node_id="12", path="lora_name", source="variable", value="lora"),
            PresetBinding(node_id="12", path="strength_model", type="number", value="{strength}"),
            PresetBinding(node_id="12", path="strength_clip", source="variable", value="empty"),
            PresetBinding(node_id="30", path="text", value="late", enabled=False),
            lora="nanami.safetensors",
            strength="0.6",
            empty="",
        )
        style = preset(
            "画风", PresetBinding(node_id="12", path="strength_model", value="0.9", type="number")
        )
        series = self.album(character, style)
        self.assertEqual(
            node_overrides(series, None),
            {"/12/inputs/lora_name": "nanami.safetensors", "/12/inputs/strength_model": 0.9},
        )
        self.assertEqual(
            node_overrides(self.album(character), None)["/12/inputs/strength_model"], 0.6
        )

    def test_the_frame_override_wins_and_the_workshop_applies_none(self):
        from mio_server.models import Panel, PanelOverrides

        p = preset("p", PresetBinding(node_id="12", path="lora_name", value="preset.safetensors"))
        panel = Panel(
            order=0, overrides=PanelOverrides(node_overrides={"/12/inputs/lora_name": "own"})
        )
        self.assertEqual(node_overrides(self.album(p), panel), {"/12/inputs/lora_name": "own"})
        self.assertEqual(node_overrides(self.album(p, kind="workshop"), None), {})

    def test_a_bad_variable_value_names_the_preset(self):
        p = preset(
            "七海", PresetBinding(node_id="12", path="strength_model", source="variable", value="s", type="number"), s="strong"
        )  # fmt: skip
        with self.assertRaisesRegex(BindingError, "七海.*12 · strength_model"):
            node_overrides(self.album(p), None)


class RenderPlanTests(Harness):
    def test_preset_bindings_reach_the_sampler(self):
        def mutate(s):
            s.presets = [
                preset(
                    "采样",
                    PresetBinding(
                        node_id="6", path="steps", source="variable", value="steps", type="number"
                    ),
                    PresetBinding(node_id="6", path="sampler_name", value="dpmpp_2m"),
                    PresetBinding(node_id="99", path="missing", value="skipped"),
                )
            ]
            s.variables = {**s.variables, "steps": "31"}

        series = self.store.update_series(self.series.id, mutate)
        profile = RenderProfile(
            id="p", name="t", draft=[RenderStage(id="s", kind="generate", workflow_id="builtin_t2i_sdxl_pose")]
        )  # fmt: skip
        spec = self.render.plan_panel(
            series, self.episode, self.episode.panels[0], profile, candidates=1
        )[0]
        sampler = spec.input["stages"][0]["graph"]["6"]["inputs"]
        self.assertEqual((sampler["steps"], sampler["sampler_name"]), (31, "dpmpp_2m"))


if __name__ == "__main__":
    unittest.main()
