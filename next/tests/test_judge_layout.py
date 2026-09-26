import json
import unittest

from PIL import Image, ImageDraw

from mio_next import judge as J
from mio_next import layout as LY
from mio_next import script as S
from tests.story_fixture import make_story


def story():
    return S.normalize_story(make_story())


class JudgeScoringTests(unittest.TestCase):
    def setUp(self):
        self.story = story()
        self.two = next(p for p in self.story["panels"] if p["id"] == "p04")  # lin + zhou

    def test_pass_rule(self):
        result = {"characters": [
            {"name": "Lin", "present": True, "identity": 4, "features": {"bob cut": True, "round eyewear": None}},
            {"name": "ZHOU", "present": True, "identity": 5, "features": {"green hoodie": False}},
        ]}
        verdicts = J.score(self.story, self.two, result)
        self.assertEqual([(v["character"], v["pass"]) for v in verdicts], [("lin", True), ("zhou", False)])
        self.assertEqual(verdicts[1]["features_wrong"], ["green hoodie"])

    def test_missing_or_garbage_entries_fail(self):
        self.assertEqual([v["pass"] for v in J.score(self.story, self.two, {})], [False, False])
        verdicts = J.score(self.story, self.two, {"characters": [{"present": True, "identity": "5"}, "junk"]})
        self.assertEqual([v["pass"] for v in verdicts], [True, False])  # index fallback for the first
        self.assertEqual(J.score(self.story, self.two, {"characters": [{"name": "Lin", "present": False, "identity": 5}]})[0]["pass"], False)

    def test_summary(self):
        judged = [{"panel": "p04", "verdicts": J.score(self.story, self.two, {"characters": [
            {"name": "Lin", "present": True, "identity": 5, "features": {"a": True}},
            {"name": "Zhou", "present": True, "identity": 3, "features": {"b": True, "c": False}}]}),
            "extra_people": 1, "scene": 4, "quality": 5}]
        summary = J.summarize(judged)
        self.assertEqual((summary["appearances"], summary["passed"], summary["pass_rate"]), (2, 1, 0.5))
        self.assertEqual(summary["identity_mean"], 4.0)
        self.assertEqual(summary["feature_accuracy"], round(2 / 3, 3))
        self.assertEqual(summary["by_character"]["zhou"], {"appearances": 1, "passed": 0})
        self.assertEqual(summary["extra_people"], 1)

    def test_prompt_example_is_valid_json(self):
        text, order = J.consistency_prompt(self.story, self.two)
        self.assertEqual(order, ["lin", "zhou"])
        example = json.loads(text[text.rindex("{\"characters\""):])
        self.assertEqual([c["name"] for c in example["characters"]], ["Lin", "Zhou"])
        empty = next(p for p in self.story["panels"] if p["id"] == "p01")
        self.assertIn("should show no people", J.consistency_prompt(self.story, empty)[0])

    def test_face_boxes_are_normalized(self):
        faces = J.normalize_faces({"faces": [
            {"name": "Lin", "box": [100, 200, 300, 400]},        # 0-1000
            {"name": "Zhou", "box": [0.5, 0.1, 0.7, 0.3]},       # fractions
            {"name": "x", "box": [1200, 300, 1500, 600]},        # pixels of a 2000x1000 image
            {"name": "bad", "box": [1, 2, 3]}, {"name": "tiny", "box": [10, 10, 11, 11]}]}, (2000, 1000))
        self.assertEqual([f["name"] for f in faces], ["Lin", "Zhou", "x"])
        self.assertEqual(faces[0]["box"], [0.1, 0.2, 0.3, 0.4])
        self.assertEqual(faces[2]["box"], [0.6, 0.3, 0.75, 0.6])
        self.assertEqual(J.normalize_faces("junk", (10, 10)), [])


def panel_image(size, face=None):
    im = Image.new("RGB", size, (200, 220, 240))
    d = ImageDraw.Draw(im)
    for x in range(0, size[0], 12):  # busy texture on the right half
        if x > size[0] // 2:
            d.line((x, 0, x, size[1]), fill=(20, 20, 20), width=2)
    if face:
        d.rectangle(face, fill=(250, 200, 180))
    return im


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.story = story()
        self.style = LY.Style()

    def test_wrap_never_starts_a_line_with_closing_punctuation(self):
        font = LY.load_font(self.style.font_path, 27)
        lines = LY.wrap("这本画册不卖，但只要雨天，随时欢迎你来看。", font, font.getlength("这本画册不"))
        self.assertTrue(all(line[0] not in LY.NO_LINE_START for line in lines))
        self.assertEqual("".join(lines), "这本画册不卖，但只要雨天，随时欢迎你来看。")
        self.assertEqual(LY.wrap("hello brave new world", font, font.getlength("hello brave")), ["hello brave", "new world"])

    def test_ellipse_contains_every_line(self):
        font = LY.load_font(self.style.font_path, 27)
        lines = LY.balanced_wrap("喜欢画画的眼睛是藏不住的。你刚才看它时的眼神很亮。", font, 300)
        w, h = LY.ellipse_size(lines, font, 7)
        tw, th, widths = LY.text_block(lines, font, 7)
        a, b = w / 2, h / 2
        for i, lw in enumerate(widths):
            top = i * (27 + 7) - th / 2
            for y in (top, top + 27):
                self.assertLessEqual((lw / 2) ** 2 / a ** 2 + y ** 2 / b ** 2, 1.0)
        self.assertGreater(w, h)

    def test_strip_bubbles_avoid_faces_and_slices_fit(self):
        panels = self.story["panels"]
        images, faces = {}, {}
        for p in panels:
            size = (1216, 832) if p["shot"] in ("wide", "extreme_close") else (1024, 1024)
            face = (int(size[0] * 0.3), int(size[1] * 0.15), int(size[0] * 0.45), int(size[1] * 0.4))
            images[p["id"]] = panel_image(size, face)
            if p["characters"]:
                faces[p["id"]] = [{"character": p["characters"][0]["id"], "name": "x",
                                   "box": [face[0] / size[0], face[1] / size[1], face[2] / size[0], face[3] / size[1]]}]
        result = LY.layout_strip(self.story, images, faces, self.style)
        self.assertEqual(result.image.width, 800)
        self.assertEqual(result.report["bubbles_on_faces"], 0)
        expected = sum(len(p["dialogue"]) for p in panels) + len(self.story["scenes"])  # + scene captions
        self.assertEqual(result.report["bubbles"], expected)
        for q in result.placements:
            self.assertGreaterEqual(q.box[0], 0)
            self.assertLessEqual(q.box[2], 800)
        parts = LY.slices(result, 1280)
        self.assertTrue(all(part.height <= 1280 for part in parts))
        self.assertEqual(sum(part.height for part in parts), result.image.height)
        cuts = LY.cut_points(result, 1280)
        for y in cuts:
            self.assertFalse(any(q.box[1] <= y <= q.box[3] for q in result.placements))

    def test_speech_tail_points_at_speaker(self):
        im = panel_image((1024, 1024), (600, 500, 800, 700))
        faces = [{"character": "lin", "box": [600 / 1024, 500 / 1024, 800 / 1024, 700 / 1024]}]
        fonts = {"text": LY.load_font(self.style.font_path, 27), "caption": LY.load_font(self.style.font_path, 22),
                 "sfx": LY.load_font(self.style.font_path, 40)}
        placed = LY.place_bubbles("p", (0, 100, 800, 900), [{"kind": "speech", "text": "你好。", "speaker": "lin"}],
                                  faces, LY.EdgeMap(im.resize((800, 800))), self.style, fonts, [], 64, 800)
        box, tail = placed[0].box, placed[0].tail
        face_top = 100 + 500 / 1024 * 800
        self.assertLess(box[3], face_top)          # bubble above the face
        self.assertGreater(tail[1], box[3] - 5)    # tail heads down towards it


if __name__ == "__main__":
    unittest.main()
