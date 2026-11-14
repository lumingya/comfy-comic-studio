import json
import random
import unittest
from pathlib import Path

from mio_server.models import AssetRef, PanelOverrides, Series, Style, VariantSet
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

    def test_natural_negative_combines_profile_style_and_panel(self):
        series, episode = project()
        series.bible.styles[0].negative = ["style defect"]
        panel = episode.panel("p02")
        panel.overrides.negative_prompt = "panel defect"
        out = K.compile_panel(
            series, episode, panel, dialect="natural", negative=["profile defect"], seed=3
        )
        self.assertEqual(out.negative, "profile defect, style defect, panel defect")

    def test_natural_reference_numbers_follow_available_images(self):
        series, episode = project()
        # The first character has no image; the second one's image occupies slot 1.
        series.bible.character("zhou").references = [AssetRef(asset_id="zhou-front")]
        out = K.compile_panel(series, episode, episode.panel("p04"), dialect="natural", seed=3)
        self.assertEqual(out.refs, ["zhou"])
        self.assertNotIn("reference image", out.positive.split(" | ")[0])
        self.assertIn("reference image 1", out.positive.split(" | ")[1])
        self.assertNotIn("reference image 2", out.positive)

    def test_natural_manual_and_off_do_not_invent_character_associations(self):
        series, episode = project()
        series.bible.character("lin").references = [AssetRef(asset_id="lin-front")]
        panel = episode.panel("p02")
        panel.references = [AssetRef(asset_id="m1")]
        for mode in ("manual", "off"):
            with self.subTest(mode=mode):
                panel.reference_mode = mode
                out = K.compile_panel(series, episode, panel, dialect="natural", seed=3)
                self.assertEqual(out.refs, [])
                self.assertNotIn("reference image", out.positive)

    def test_natural_uses_explicit_reference_order(self):
        series, episode = project()
        selected = [
            R.RefChoice(1, "manual", "reference", "manual", "manual"),
            R.RefChoice(2, "zhou-front", "front", "zhou", "character"),
            R.RefChoice(3, "lin-front", "front", "lin", "character"),
        ]
        out = K.compile_panel(
            series, episode, episode.panel("p04"), dialect="natural", references=selected, seed=3
        )
        self.assertEqual(out.refs, ["zhou", "lin"])
        self.assertIn("reference image 3", out.positive.split(" | ")[0])
        self.assertIn("reference image 2", out.positive.split(" | ")[1])
        self.assertNotIn("reference image 1", out.positive)
        out = K.compile_panel(
            series, episode, episode.panel("p04"), dialect="natural", references=[], seed=3
        )
        self.assertNotIn("reference image", out.positive)

    def test_raw_prompt_is_not_rewritten_for_references_or_profile_negative(self):
        series, episode = project()
        series.bible.character("lin").references = [AssetRef(asset_id="lin-front")]
        panel = episode.panel("p02")
        panel.overrides = PanelOverrides(
            raw_prompt="Exactly my text", raw_negative="Exactly my exclusions"
        )
        out = K.compile_panel(
            series,
            episode,
            panel,
            dialect="natural",
            references=R.select_references(series.bible, panel),
            negative=["profile defect"],
            seed=3,
        )
        self.assertEqual(out.positive, "Exactly my text")
        self.assertEqual(out.negative, "Exactly my exclusions")

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

    def test_manual_keeps_every_image_in_user_order(self):
        series, episode = project()
        panel = episode.panel("p02")
        panel.reference_mode = "manual"
        ids = ["m6", "m2", "m4", "m3", "m1", "m5"]
        panel.references = [AssetRef(asset_id=aid) for aid in ids]
        selected = R.select_references(series.bible, panel)
        self.assertEqual([ref.asset_id for ref in selected], ids)
        self.assertEqual([ref.slot for ref in selected], list(range(1, 7)))
        self.assertEqual({ref.owner for ref in selected}, {"manual"})

    def test_auto_includes_scene_and_selected_style_after_characters(self):
        series, episode = project()
        panel = episode.panel("p04")
        for cid in ("lin", "zhou"):
            series.bible.character(cid).references = [AssetRef(asset_id=f"{cid}-front")]
        series.bible.location(panel.location_id).references = [AssetRef(asset_id="scene")]
        series.bible.styles[0].references = [AssetRef(asset_id="default-style")]
        alternate = Style(
            id="alternate",
            description="warm watercolor",
            references=[AssetRef(asset_id="alternate-style")],
        )
        series.bible.styles.append(alternate)
        variant = VariantSet(name="Alternate", style_id=alternate.id)
        bible = ST.apply_variant(series.bible, variant)
        selected = R.select_references(bible, panel, style_id=variant.style_id)
        self.assertEqual(
            [ref.asset_id for ref in selected],
            ["lin-front", "zhou-front", "scene", "alternate-style"],
        )
        self.assertEqual([ref.slot for ref in selected], [1, 2, 3, 4])
        self.assertEqual(selected[-1].owner, alternate.id)
        self.assertEqual(selected[-1].role, "style")
        default = R.select_references(bible, panel)
        self.assertEqual(default[-1].asset_id, "default-style")
        limited = R.select_references(bible, panel, max_refs=3, style_id=variant.style_id)
        self.assertEqual([ref.asset_id for ref in limited], ["lin-front", "zhou-front", "scene"])
        out = K.compile_panel(series, episode, panel, variant=variant, dialect="natural", seed=3)
        self.assertIn("warm watercolor", out.positive)


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
