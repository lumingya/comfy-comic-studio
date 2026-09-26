import json
import random
import unittest
from pathlib import Path

from mio_server.models import AssetRef, PanelOverrides, Series, VariantSet
from mio_server.pipeline import compiler as K
from mio_server.pipeline import refs as R
from mio_server.pipeline import story as ST
from mio_server.pipeline import variables as V

from .story_fixture import make_story

GOLDEN = Path(__file__).resolve().parent.parent / "fixtures" / "golden_story.json"


def project(story=None):
    series = Series(title="雨夜便利店")
    bible, episode = ST.from_story(story or make_story(), series.id)
    series.bible = bible
    return series, episode


class StoryTests(unittest.TestCase):
    def test_round_trip_keeps_ids_and_cast(self):
        story = make_story()
        series, episode = project(story)
        self.assertEqual(
            [p.id for p in episode.ordered_panels()], [p["id"] for p in story["panels"]]
        )
        back = ST.to_story(series, episode)
        self.assertEqual({c["id"] for c in back["characters"]}, {"lin", "zhou"})
        p4 = next(p for p in back["panels"] if p["id"] == "p04")
        self.assertEqual([c["id"] for c in p4["characters"]], ["lin", "zhou"])
        self.assertEqual(back["panels"][0]["dialogue"][0]["kind"], "narration")

    def test_golden_story_imports(self):
        story = json.loads(GOLDEN.read_text(encoding="utf-8"))
        series, episode = project(story)
        self.assertGreaterEqual(len(episode.panels), 8)
        self.assertTrue(all(p.location_id for p in episode.panels))

    def test_variant_patches_character(self):
        series, episode = project()
        variant = VariantSet(
            name="冬装", characters={"lin": {"tag_description": ["red scarf", "black hair"]}}
        )
        story = ST.to_story(series, episode, variant)
        lin = next(c for c in story["characters"] if c["id"] == "lin")
        self.assertIn("red scarf", lin["tags"])
        self.assertNotIn("red scarf", series.bible.character("lin").tag_description)

    def test_panel_time_overrides_scene(self):
        series, episode = project()
        episode.panels[0].time = "morning"
        story = ST.to_story(series, episode)
        self.assertEqual(story["panels"][0]["scene"], "s1@morning")


class CompilerTests(unittest.TestCase):
    def test_tags_dialect_contains_character_tags(self):
        series, episode = project()
        panel = episode.panel("p02")
        out = K.compile_panel(series, episode, panel, rng=random.Random(1))
        self.assertIn("bob cut", out.positive)
        self.assertIn("nsfw", out.negative)
        self.assertEqual(out.refs, ["lin"])
        self.assertEqual(out.width % 64, 0)
        self.assertLess(out.width, out.height)  # 2:3 portrait default

    def test_natural_dialect(self):
        series, episode = project()
        out = K.compile_panel(series, episode, episode.panel("p04"), dialect="natural", seed=3)
        self.assertEqual(out.seed, 3)
        self.assertIn("trench coat", out.positive)

    def test_custom_quality_replaces_defaults(self):
        series, episode = project()
        out = K.compile_panel(
            series, episode, episode.panel("p02"), quality=["score_9"], negative=["bad"], seed=1
        )
        self.assertTrue(out.positive.startswith("score_9"))
        self.assertNotIn("masterpiece", out.positive)
        self.assertTrue(out.negative.startswith("bad"))

    def test_raw_mode_and_variables(self):
        series, episode = project()
        series.variables = {"look": "{char1}, looking at viewer", "q": "masterpiece"}
        panel = episode.panel("p04")
        panel.overrides = PanelOverrides(
            raw_prompt="{q}, {look}, {林夏}, {missing}, {{literal}}", seed=5, width=768, height=1152
        )
        out = K.compile_panel(series, episode, panel)
        self.assertTrue(out.raw)
        self.assertIn("masterpiece, black hair", out.positive)
        self.assertIn("looking at viewer", out.positive)
        self.assertIn("{missing}", out.positive)
        self.assertIn("{literal}", out.positive)
        self.assertEqual(out.unresolved, ["missing"])
        self.assertEqual((out.width, out.height, out.seed), (768, 1152, 5))

    def test_append_prompt_expands_panel_local_variable(self):
        series, episode = project()
        panel = episode.panel("p02")
        panel.overrides = PanelOverrides(append_prompt="{mood}", values={"$mood": "rain, {scene}"})
        out = K.compile_panel(series, episode, panel, seed=1)
        self.assertIn("rain, office", out.positive)

    def test_preview(self):
        series, episode = project()
        view = K.preview(series, episode, episode.panel("p02"))
        self.assertEqual(set(view), {"tags", "natural", "panel"})


class VariableTests(unittest.TestCase):
    def test_recursion_is_bounded(self):
        self.assertEqual(V.expand("{a}", {"a": "{a}"}), "{a}")
        self.assertEqual(V.expand("x {b} y", {"b": "1"}), "x 1 y")
        self.assertEqual(V.expand("{ not a var}", {}), "{ not a var}")


class RefTests(unittest.TestCase):
    def test_auto_refs_follow_angle_and_outfit(self):
        series, episode = project()
        lin = series.bible.character("lin")
        lin.references = [
            AssetRef(asset_id="front", role="front"),
            AssetRef(asset_id="back", role="back"),
            AssetRef(asset_id="winter", role="front", outfit="winter"),
        ]
        panel = episode.panel("p02")
        self.assertEqual(R.select_references(series.bible, panel)[0].asset_id, "front")
        panel.angle = "back"
        self.assertEqual(R.select_references(series.bible, panel)[0].asset_id, "back")
        panel.angle = "eye"
        panel.characters[0].outfit = "winter"
        choice = R.select_references(series.bible, panel)[0]
        self.assertEqual(choice.asset_id, "winter")
        self.assertIn("winter", choice.reason)
        self.assertEqual(R.reference_values([choice]), {"ref:1": {"$asset": "winter"}})

    def test_manual_and_off(self):
        series, episode = project()
        panel = episode.panel("p02")
        panel.reference_mode = "manual"
        panel.references = [AssetRef(asset_id="m1")]
        self.assertEqual([c.asset_id for c in R.select_references(series.bible, panel)], ["m1"])
        panel.reference_mode = "off"
        self.assertEqual(R.select_references(series.bible, panel), [])


class ProvenanceTests(unittest.TestCase):
    def test_every_tag_names_its_source(self):
        series, episode = project()
        panel = episode.panel("p02")
        panel.overrides = PanelOverrides(append_prompt="rain, (wet street, puddles:1.2)")
        out = K.compile_panel(series, episode, panel, seed=1)
        self.assertEqual(", ".join(s["tag"] for s in out.sources), out.positive)
        by_source = {}
        for s in out.sources:
            by_source.setdefault(s["source"], []).append(s["tag"])
        self.assertEqual(by_source["quality"][0], "masterpiece")
        self.assertEqual(by_source["append"], ["rain", "(wet street, puddles:1.2)"])
        self.assertTrue(any(k.startswith("character:") for k in by_source))
        self.assertEqual(out.negative_sources[0]["source"], "negative")

    def test_profile_quality_list_is_marked_as_such(self):
        series, episode = project()
        out = K.compile_panel(series, episode, episode.panel("p02"), quality=["score_9"], seed=1)
        self.assertEqual(out.sources[0], {"tag": "score_9", "source": "profile"})
        self.assertNotIn("masterpiece", out.positive)

    def test_unspecified_shot_and_angle_add_no_framing(self):
        series, episode = project()
        panel = episode.panel("p02")
        panel.shot, panel.angle = "", ""
        out = K.compile_panel(series, episode, panel, seed=1)
        self.assertFalse({"shot", "angle"} & {s["source"] for s in out.sources})
        prose = K.compile_panel(series, episode, panel, dialect="natural", seed=1).positive
        self.assertNotIn("medium shot", prose)
        self.assertNotIn("eye level", prose)
