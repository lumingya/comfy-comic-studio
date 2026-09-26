"""P4: ControlNet pose/depth inputs and regional multi-character prompts (mock ComfyUI only)."""

import unittest

from mio_server.comfy import bindings as B
from mio_server.comfy.compile import builtin_workflows, compile_workflow, describe
from mio_server.models import ControlInput, PanelCharacter
from mio_server.pipeline import composition as CP
from mio_server.pipeline.render import RenderError
from mio_server.render_models import RenderProfile, RenderStage

from .test_compile_executor import png
from .test_render_qa import Harness


def area_graph(cls):
    return {
        "1": {"class_type": "CLIPTextEncode", "inputs": {"text": ""}, "_meta": {"title": "[mio:region:1]"}},
        "2": {
            "class_type": cls,
            "inputs": {"conditioning": ["1", 0], "x": 0, "y": 0, "width": 64, "height": 64, "strength": 1.0},
            "_meta": {"title": "[mio:area:1]"},
        },
        "3": {"class_type": "LoadImage", "inputs": {"image": "x.png"}, "_meta": {"title": "[mio:control:depth]"}},
    }  # fmt: skip


def two_characters(panel, positions=("right", "left")):
    panel.characters = [
        PanelCharacter(character_id="lin", position=positions[0], action="挥手"),
        PanelCharacter(character_id="zhou", position=positions[1]),
    ]
    panel.shot = "full"


class BindingTests(unittest.TestCase):
    def test_area_fans_out_and_converts_to_pixels(self):
        values = {"width": 1024, "height": 768, "region:1": "1girl, red scarf"}
        values["area:1"] = {"x": 0.5, "y": 0.0, "width": 0.5, "height": 1.0}
        for cls, expect in (
            ("ConditioningSetAreaPercentage", (0.5, 0.0, 0.5, 1.0)),
            ("ConditioningSetArea", (512, 0, 512, 768)),
        ):
            graph = area_graph(cls)
            bound, problems = B.resolve(graph)
            self.assertEqual(problems, [])
            out = B.apply_values(graph, bound, values)["2"]["inputs"]
            self.assertEqual((out["x"], out["y"], out["width"], out["height"]), expect)
            self.assertEqual(out["strength"], 1.0)
            self.assertEqual(out["conditioning"], ["1", 0])
        self.assertEqual(
            B.apply_values(graph, bound, values)["1"]["inputs"]["text"], values["region:1"]
        )

    def test_control_is_an_image_input(self):
        doc = next(d for d in builtin_workflows() if d.id == "builtin_t2i_sdxl_pose")
        info = describe(doc)
        self.assertEqual((info["image_inputs"], info["regions"]), (["control:pose"], ["1", "2"]))
        compiled = compile_workflow(
            doc,
            {
                "prompt": "p",
                "control:pose": {"$asset": "abc"},
                "strength:pose": 0.55,
                "region:1": "lin",
                "area:1": {"x": 0.1, "y": 0, "width": 0.4, "height": 1},
            },
        )
        self.assertEqual(compiled.uploads, {"/15/inputs/image": "abc"})
        self.assertEqual(compiled.graph["17"]["inputs"]["strength"], 0.55)
        self.assertEqual(compiled.graph["9"]["inputs"]["text"], "lin")
        self.assertEqual(compiled.graph["10"]["inputs"]["x"], 0.1)
        plain = next(d for d in builtin_workflows() if d.id == "builtin_t2i_sdxl")
        with self.assertRaises(B.BindingError):
            compile_workflow(plain, {"prompt": "p", "control:pose": {"$asset": "abc"}})


class CompositionTests(unittest.TestCase):
    def setUp(self):
        from mio_server.models import Series
        from mio_server.pipeline import story as ST

        from .story_fixture import make_story

        self.series = Series(title="x")
        self.series.bible, self.episode = ST.from_story(make_story(2), self.series.id)
        self.panel = self.episode.panels[0]

    def test_regions_follow_positions(self):
        two_characters(self.panel)
        lin, zhou = CP.regions(self.panel)
        self.assertGreater(lin["box"][0], zhou["box"][0])  # lin stands right
        self.assertTrue(all(0 <= v <= 1 for r in (lin, zhou) for v in r["box"]))
        self.panel.characters[1].position = "background"
        small = CP.regions(self.panel)[1]["box"]
        self.assertLess(small[3], 1.0)

    def test_region_prompt_is_the_characters_own(self):
        two_characters(self.panel)
        text = CP.region_prompt(self.series, self.panel, 0, "tags")
        lin = self.series.bible.character("lin")
        self.assertTrue(all(t in text for t in lin.tag_description[:2]))
        self.assertIn("挥手", text)
        self.assertIn("solo", text)
        self.assertNotIn(self.series.bible.character("zhou").tag_description[0], text)

    def test_pose_skeleton(self):
        two_characters(self.panel)
        people = CP.keypoints(self.panel, 1024, 768)
        self.assertEqual(len(people), 2)
        self.assertGreater(people[0][1][0], people[1][1][0])  # necks: lin right of zhou
        self.assertLess(people[0][7][1], people[0][1][1])  # waving: left wrist above the neck
        image = CP.pose_image(self.panel, 1024, 768)
        self.assertEqual(image.size, (1024, 768))
        self.assertIsNotNone(image.getbbox())
        self.panel.angle = "back"
        self.assertNotIn(0, CP.keypoints(self.panel, 1024, 768)[0])  # no face from behind
        self.panel.shot = "extreme_close"
        self.assertIsNone(CP.pose_image(self.panel, 1024, 768))
        self.assertEqual(CP.pose_of("坐在长椅上"), "sit")
        self.assertEqual(CP.pose_of("looks away"), "stand")


class RenderPlanTests(Harness):
    def profile(self, workflow="builtin_t2i_sdxl_pose"):
        return RenderProfile(
            id="p", name="pose", draft=[RenderStage(id="s", kind="generate", workflow_id=workflow)]
        )

    def stage(self, panel, workflow="builtin_t2i_sdxl_pose"):
        spec = self.render.plan_panel(
            self.series, self.episode, panel, self.profile(workflow), candidates=1
        )[0]
        return spec.input["stages"][0]

    def test_auto_pose_and_regions_reach_the_workflow(self):
        panel = self.episode.panels[1]
        two_characters(panel)
        panel.regional = True
        panel.controls = [ControlInput(kind="pose", strength=0.6)]
        stage = self.stage(panel)
        pose_id = stage["uploads"]["/15/inputs/image"]
        self.assertTrue(self.assets.exists(pose_id))
        self.assertEqual(stage["graph"]["17"]["inputs"]["strength"], 0.6)
        self.assertIn("挥手", stage["graph"]["9"]["inputs"]["text"])
        self.assertGreater(stage["graph"]["10"]["inputs"]["x"], stage["graph"]["12"]["inputs"]["x"])
        self.assertEqual(stage["warnings"], [])

    def test_missing_pose_uses_blank_at_zero_strength(self):
        panel = self.episode.panels[1]
        stage = self.stage(panel)
        self.assertEqual(stage["graph"]["17"]["inputs"]["strength"], 0.0)
        self.assertTrue(self.assets.exists(stage["uploads"]["/15/inputs/image"]))
        self.assertEqual(
            stage["graph"]["9"]["inputs"]["text"], stage["graph"]["3"]["inputs"]["text"]
        )
        self.assertTrue(any("空图" in w for w in stage["warnings"]))

    def test_depth_from_asset_or_take_and_unsupported_workflows(self):
        panel = self.episode.panels[1]
        depth = self.assets.put(png((5, 5, 5)), source="upload").id
        panel.controls = [ControlInput(kind="depth", source="asset", asset_id=depth)]
        stage = self.stage(panel, "builtin_t2i_sdxl")
        self.assertTrue(any("control:depth" in w for w in stage["warnings"]))
        panel.controls = [ControlInput(kind="depth", source="take", take_id="nope")]
        with self.assertRaises(RenderError):
            self.stage(panel, "builtin_t2i_sdxl")
        panel.regional = True
        two_characters(panel)
        panel.controls = []
        stage = self.stage(panel, "builtin_t2i_sdxl")
        self.assertTrue(any("region" in w for w in stage["warnings"]))


if __name__ == "__main__":
    unittest.main()
