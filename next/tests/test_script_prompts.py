import copy
import unittest

from mio_next import prompts as P
from mio_next import script as S
from tests.story_fixture import make_story


class ScriptValidationTests(unittest.TestCase):
    def test_fixture_is_valid(self):
        story = S.normalize_story(make_story())
        self.assertEqual(S.validate_story(story), [])
        self.assertEqual(S.stats(story)["panels"], 12)

    def test_normalize_cleans_tags_ids_and_narration(self):
        raw = make_story()
        raw["characters"][0]["tags"] = ["Black_Hair", "black hair", "  Bob   Cut "] + raw["characters"][0]["tags"]
        raw["characters"][0]["age"] = "27"
        raw["panels"][1]["dialogue"] = [{"speaker": "lin", "kind": "narration", "text": "旁白"}]
        story = S.normalize_story(raw)
        self.assertEqual(story["characters"][0]["tags"][:2], ["black hair", "bob cut"])
        self.assertEqual(story["characters"][0]["age"], 27)
        self.assertEqual(story["panels"][1]["dialogue"][0]["speaker"], "narrator")
        self.assertEqual(S.normalize_story("oops"), {})

    def check(self, mutate, expected):
        raw = make_story()
        mutate(raw)
        problems = S.validate_story(S.normalize_story(raw))
        self.assertTrue(any(expected in p for p in problems), problems)

    def test_rejects_minors_and_blocked_content(self):
        self.check(lambda s: s["characters"][0].update(age=16), "成年人")
        self.check(lambda s: s["characters"][0].update(age=None), "成年人")
        self.check(lambda s: s["characters"][1]["tags"].append("school uniform"), "不允许")
        self.check(lambda s: s["panels"][2].update(description="she is naked"), "naked")

    def test_rejects_structural_problems(self):
        self.check(lambda s: s["panels"].pop(), "12–16 格")
        self.check(lambda s: s["panels"][1].update(scene="s9"), "scene 不存在")
        self.check(lambda s: s["panels"][1].update(shot="aerial"), "shot 只能是")
        self.check(lambda s: s["panels"][3]["characters"].append({"id": "ghost"}), "角色 ghost 不存在")
        self.check(lambda s: s["panels"][1]["dialogue"].append({"speaker": "zhou", "text": "一" * 40}), "超过")
        self.check(lambda s: s["panels"][1]["dialogue"].append({"speaker": "boss", "text": "嗯"}), "说话人 boss")
        self.check(lambda s: s["characters"][0].update(signature=["red scarf", "bob cut"]), "取自 tags")
        self.check(lambda s: s["characters"][1].update(id="lin"), "重复")
        self.check(lambda s: s["scenes"][0].update(time="noon"), "time 只能是")

    def test_system_prompt_formats(self):
        text = S.SYSTEM_PROMPT.format(min_panels=12, max_panels=16, max_chars=36)
        self.assertIn("12–16 格", text)
        self.assertIn('"characters"', text)


class CompilerTests(unittest.TestCase):
    def setUp(self):
        self.story = S.normalize_story(make_story())

    def panel(self, pid):
        return next(p for p in self.story["panels"] if p["id"] == pid)

    def test_single_character_close_up(self):
        panel = self.panel("p03")  # close, lin only
        pos, neg = P.danbooru(self.story, panel)
        tags = pos.split(", ")
        self.assertEqual(tags[:7], ["masterpiece", "best quality", "amazing quality", "very aesthetic", "absurdres", "newest", "general"])
        for expected in ("1girl", "solo", "bob cut", "round eyewear", "holding phone", "portrait", "close-up", "office", "night"):
            self.assertIn(expected, tags)
        self.assertLess(tags.index("1girl"), tags.index("bob cut"))
        self.assertIn("multiple girls", neg)
        self.assertIn("nsfw", neg)

    def test_two_shot_and_empty_shot(self):
        pos, _ = P.danbooru(self.story, self.panel("p04"))
        self.assertIn("1girl, 1boy", pos)
        self.assertNotIn("solo", pos.split(", "))
        pos, neg = P.danbooru(self.story, self.panel("p01"))
        self.assertIn("no humans", pos)
        self.assertIn("1girl", neg)

    def test_escaping_and_dedupe(self):
        self.assertEqual(P.escape_tag("hood (clothing)"), r"hood \(clothing\)")
        self.assertEqual(P.escape_tag(r"hood \(clothing\)"), r"hood \(clothing\)")
        self.assertEqual(P.dedupe(["a", "b", "a", " ", "c"]), ["a", "b", "c"])

    def test_natural_prompt_numbers_references_in_order(self):
        text, refs = P.natural(self.story, self.panel("p04"))
        self.assertEqual(refs, ["lin", "zhou"])
        self.assertLess(text.index("reference image 1"), text.index("reference image 2"))
        self.assertIn("2 people, nobody else", text)
        self.assertIn("speech bubbles", text)
        text, refs = P.natural(self.story, self.panel("p01"))
        self.assertEqual(refs, [])
        self.assertIn("No people", text)
        text, refs = P.natural(self.story, self.panel("p03"), with_refs=False)
        self.assertEqual(refs, [])
        self.assertNotIn("reference image", text)

    def test_sizes_and_sheets(self):
        self.assertEqual(P.panel_size({"shot": "wide"}), (1216, 832))
        self.assertEqual(P.panel_size({"shot": "full"}), (832, 1216))
        self.assertEqual(P.panel_size({"shot": "??"}), (1024, 1024))
        pos, neg = P.sheet_danbooru(self.story["characters"][1])
        self.assertIn("1boy, solo", pos)
        self.assertIn("white background", pos)
        self.assertIn("multiple views", neg)
        self.assertIn("full-body front view", P.sheet_natural(self.story["characters"][0]))


if __name__ == "__main__":
    unittest.main()


class GoldenStoryTests(unittest.TestCase):
    """The committed benchmark story must stay valid and compile for every panel."""

    def test_golden_story(self):
        import json
        from pathlib import Path
        raw = json.loads((Path(__file__).resolve().parent.parent / "fixtures" / "golden_story.json").read_text(encoding="utf-8"))
        story = S.normalize_story(raw)
        self.assertEqual(S.validate_story(story), [])
        self.assertTrue(all(c["age"] >= 20 for c in story["characters"]))
        for panel in story["panels"]:
            pos, neg = P.danbooru(story, panel)
            text, refs = P.natural(story, panel)
            self.assertIn("general", pos)
            self.assertEqual(len(refs), len(panel["characters"]))
            for cid in refs:
                self.assertIn(P.display_name(next(c for c in story["characters"] if c["id"] == cid)), text)
