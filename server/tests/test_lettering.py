import unittest

from PIL import Image

from mio_server.models import (
    Dialogue,
    DialogueKind,
    LetteringLayer,
    LetterStyle,
    PanelCharacter,
    PanelWidth,
    Series,
)
from mio_server.pipeline import backdrop as BD
from mio_server.pipeline import lettering as LT
from mio_server.pipeline import story as ST
from mio_server.pipeline import strip as SP
from mio_server.pipeline import vertical as VT

from .story_fixture import make_story

# Shared with web/src/pages/canvas/vertical.test.ts: keep both in sync.
VERTICAL_SAMPLES = {
    "你好，世界。": ["你好︐世界︒"],
    "「真的吗？！」": ["﹁真的吗⁈﹂"],
    "等等……": ["等等︙︙"],
    "好!!": ["好‼"],
}


def project(n=4):
    series = Series(title="雨夜")
    bible, episode = ST.from_story(make_story(n), series.id)
    series.bible = bible
    images = {p.id: Image.new("RGB", (832, 1216), (140, 150, 160)) for p in episode.panels}
    return series, episode, images


class VerticalTests(unittest.TestCase):
    def test_presentation_forms_and_combined_pairs(self):
        for text, cols in VERTICAL_SAMPLES.items():
            self.assertEqual(VT.columns(text, 10), cols, text)

    def test_columns_are_balanced_and_obey_kinsoku(self):
        cols = VT.columns("一二三四五六七八九十。", 5)
        self.assertTrue(all(len(c) <= 5 for c in cols[:-1]))
        self.assertFalse(any(c[0] in VT.NO_START for c in cols))
        self.assertEqual("".join(cols), "一二三四五六七八九十︒")
        cols = VT.columns("一二三「四五六", 4)
        self.assertFalse(any(c[-1] in VT.NO_END for c in cols[:-1]))

    def test_cells_run_right_to_left(self):
        cells = VT.cell_centers(["一二", "三"], (100, 100), 20, 6)
        (_, x1, y1), (_, _, y2), (_, x3, _) = cells
        self.assertGreater(x1, x3)  # first column is the rightmost
        self.assertGreater(y2, y1)


class BackdropTests(unittest.TestCase):
    def test_stops_and_sampling(self):
        self.assertIsNone(BD.parse_stops("transparent"))
        stops = BD.parse_stops("#000>#ffffff>#000000")
        self.assertEqual(stops, [(0, 0, 0), (255, 255, 255), (0, 0, 0)])
        self.assertEqual(BD.sample(stops, 0.5), (255, 255, 255))
        self.assertFalse(BD.valid_spec("red"))
        self.assertEqual(BD.ink_for((10, 10, 20)), "white")

    def test_track_flows_behind_inset_panels(self):
        series, episode, images = project(3)
        a, b, c = episode.ordered_panels()
        a.transition_background = "#101010"
        b.width_mode = PanelWidth.inset
        b.transition_background = "#101010"
        strip, scaled = SP.layout(series, episode, images)
        image = SP.render(series, episode, strip, scaled)
        box = strip.panel_boxes[b.id]
        mid = round((box[1] + box[3]) / 2)
        self.assertEqual(image.getpixel((5, mid)), (16, 16, 16))  # margin beside the inset
        self.assertEqual(image.getpixel((5, round(box[3]) + 10)), (16, 16, 16))

    def test_frameless_mask_fades_edges(self):
        mask = BD.frameless_mask((200, 100))
        self.assertLess(mask.getpixel((0, 50)), 40)
        self.assertEqual(mask.getpixel((100, 50)), 255)


class SfxTests(unittest.TestCase):
    def test_glyph_effects(self):
        style = LetterStyle(effect="grow")
        glyphs = LT.glyph_layout("轰隆隆", 40, style, False, lambda ch, s: s)
        self.assertLess(glyphs[0]["size"], glyphs[-1]["size"])
        self.assertAlmostEqual(glyphs[0]["x"] + glyphs[-1]["x"], 0, delta=glyphs[-1]["size"])
        shake = LT.glyph_layout("咚咚", 40, LetterStyle(effect="shake"), False, lambda c, s: s)
        self.assertEqual(shake[0]["angle"], -shake[1]["angle"])
        vertical = LT.glyph_layout("啊啊", 40, LetterStyle(), True, lambda c, s: s)
        self.assertEqual(vertical[0]["x"], 0)
        self.assertLess(vertical[0]["y"], vertical[1]["y"])

    def test_rotation_expands_the_rendered_layer(self):
        flat = LT.render_sfx("轰隆隆", None, 40, LetterStyle())
        tilted = LT.render_sfx("轰隆隆", None, 40, LetterStyle(rotation=30))
        self.assertGreater(tilted.height, flat.height)
        self.assertEqual(flat.mode, "RGBA")

    def test_auto_sfx_gets_a_preset_style_and_renders(self):
        series, episode, images = project(2)
        episode.panels[0].dialogues = [Dialogue(text="砰", kind=DialogueKind.sfx)]
        strip, scaled = SP.layout(series, episode, images)
        sfx = [l for l in strip.lettering if l.kind == DialogueKind.sfx]
        self.assertEqual(sfx[0].style.preset, LT.DEFAULT_SFX_PRESET)
        strip.lettering.append(
            LetteringLayer(kind=DialogueKind.sfx, text="咔", box=(10, 10, 90, 90), style=None)
        )
        SP.render(series, episode, strip, scaled)


class PlacementTests(unittest.TestCase):
    def test_estimated_faces_follow_positions(self):
        series, episode, _ = project(1)
        panel = episode.panels[0]
        panel.shot = "medium"
        panel.characters = [
            PanelCharacter(character_id="a", position="left"),
            PanelCharacter(character_id="b", position="right"),
        ]
        faces = LT.estimated_faces(panel)
        self.assertLess(faces[0]["box"][0], faces[1]["box"][0])
        self.assertTrue(all(f["estimated"] for f in faces))
        detected = [{"character": "a", "box": (0.1, 0.1, 0.2, 0.2)}]
        merged = LT.faces_for(panel, detected)
        self.assertEqual([f["character"] for f in merged], ["a", "b"])
        panel.shot = "wide"
        self.assertEqual(LT.estimated_faces(panel), [])

    def test_bridge_bubble_straddles_the_gutter(self):
        series, episode, images = project(3)
        first, second, _ = episode.ordered_panels()
        first.gap_after = 40
        first.dialogues = [Dialogue(speaker_id=None, text="这句话跨过格子", bridge=True)]
        strip, _ = SP.layout(series, episode, images)
        bridge = next(l for l in strip.lettering if l.bridge_to)
        self.assertEqual(bridge.bridge_to, second.id)
        top, bottom = strip.panel_boxes[first.id][3], strip.panel_boxes[second.id][1]
        self.assertLess(bridge.box[1], top)
        self.assertGreater(bridge.box[3], bottom)

    def test_vertical_strip_sets_vertical_layers(self):
        series, episode, images = project(2)
        episode.strip.text_direction = "vertical"
        episode.panels[0].dialogues = [Dialogue(text="竖排的台词，看看效果。")]
        strip, scaled = SP.layout(series, episode, images)
        speech = [l for l in strip.lettering if l.kind == DialogueKind.speech]
        self.assertTrue(speech and all(l.vertical for l in speech))
        box = speech[0].box
        self.assertGreater(box[3] - box[1], box[2] - box[0])  # taller than wide
        SP.render(series, episode, strip, scaled)


if __name__ == "__main__":
    unittest.main()
