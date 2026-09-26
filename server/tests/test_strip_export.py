import io
import json
import unittest
import zipfile

from PIL import Image

from mio_server.models import Dialogue, LetteringLayer, PanelWidth, Series
from mio_server.pipeline import export as X
from mio_server.pipeline import story as ST
from mio_server.pipeline import strip as SP
from mio_server.registry import Registry, RegistryError

from .story_fixture import make_story


def project(n=6):
    series = Series(title="雨夜便利店")
    bible, episode = ST.from_story(make_story(n), series.id)
    series.bible = bible
    images = {
        p.id: Image.new("RGB", (832, 1216), (120 + i * 10, 140, 160))
        for i, p in enumerate(episode.panels)
    }
    return series, episode, images


class StripTests(unittest.TestCase):
    def test_layout_stacks_panels_with_gaps_and_modes(self):
        series, episode, images = project()
        episode.panels[1].width_mode = PanelWidth.inset
        episode.panels[1].gap_after = 300
        episode.panels[2].width_mode = PanelWidth.bleed
        episode.panels[2].gap_after = 0
        episode.panels[2].aspect_ratio = "16:9"
        strip, scaled = SP.layout(series, episode, images)
        b = strip.panel_boxes
        p1, p2, p3, p4 = (b[p.id] for p in episode.ordered_panels()[:4])
        self.assertEqual(p1[0], 0)
        self.assertGreater(p2[0], 0)  # inset
        self.assertEqual(p3[1] - p2[3], 300)  # rhythm: custom gap
        self.assertEqual(p4[1], p3[3])  # bleed with no gap
        self.assertEqual(round(p3[2] - p3[0]), 800)
        self.assertEqual(round((p3[2] - p3[0]) / (p3[3] - p3[1]), 2), round(16 / 9, 2))
        self.assertGreater(strip.height, p4[3])
        self.assertEqual(scaled[episode.panels[0].id].size, (800, 1200))

    def test_lettering_generated_and_locked_layers_kept(self):
        series, episode, images = project()
        strip, _ = SP.layout(series, episode, images)
        kinds = {l.kind.value for l in strip.lettering}
        self.assertIn("narration", kinds)
        self.assertIn("caption", kinds)  # location caption on scene change
        self.assertIn("speech", kinds)
        manual = LetteringLayer(panel_id="p02", text="手动", box=(10, 10, 200, 90), locked=True)
        episode.strip = strip.model_copy(update={"lettering": [manual]})
        strip2, _ = SP.layout(series, episode, images)
        self.assertIn(manual, strip2.lettering)
        self.assertFalse([l for l in strip2.lettering if l.panel_id == "p02" and not l.locked])

    def test_manual_boxes_survive_relayout(self):
        series, episode, images = project()
        strip, _ = SP.layout(series, episode, images)
        pid = episode.panels[0].id
        strip.manual = True
        strip.panel_boxes = {pid: (50.0, 200.0, 650.0, 1100.0)}
        episode.strip = strip
        strip2, scaled = SP.layout(series, episode, images, relayout_lettering=False)
        self.assertEqual(strip2.panel_boxes[pid], (50.0, 200.0, 650.0, 1100.0))
        self.assertEqual(scaled[pid].size, (600, 900))

    def test_render_and_transition_background(self):
        series, episode, images = project(3)
        episode.panels[0].gap_after = 200
        episode.panels[0].transition_background = "#000000>#ffffff"
        episode.panels[0].dialogues = [Dialogue(speaker_id="lin", text="竖排测试")]
        strip, scaled = SP.layout(series, episode, images)
        strip.lettering.append(LetteringLayer(text="竖排", box=(700, 300, 760, 420), vertical=True))
        image = SP.render(series, episode, strip, scaled)
        self.assertEqual(image.size, (800, strip.height))
        p1 = strip.panel_boxes[episode.panels[0].id]
        top = image.getpixel((5, int(p1[3]) + 2))
        bottom = image.getpixel((5, int(p1[3]) + 197))
        self.assertLess(sum(top), 60)
        self.assertGreater(sum(bottom), 600)


class ExportTests(unittest.TestCase):
    def setUp(self):
        series, episode, images = project(8)
        self.strip, scaled = SP.layout(series, episode, images)
        self.image = SP.render(series, episode, self.strip, scaled)

    def test_webtoon_slices_respect_limit_and_bubbles(self):
        parts = X.slice_image(self.image, self.strip, X.preset("webtoon"))
        self.assertGreater(len(parts), 3)
        self.assertTrue(all(p.width == 800 and p.height <= 1280 for p in parts))
        self.assertEqual(sum(p.height for p in parts), self.image.height)
        cuts, y = [], 0
        for p in parts[:-1]:
            y += p.height
            cuts.append(y)
        for layer in self.strip.lettering:
            self.assertFalse(any(layer.box[1] < c < layer.box[3] for c in cuts), layer.text)

    def test_tapas_rescales(self):
        parts = X.slice_image(self.image, self.strip, X.preset("tapas"))
        self.assertTrue(all(p.width == 940 and p.height <= 1880 for p in parts))

    def test_zip_long_pdf_html(self):
        data, mime, name = X.export(
            self.image, self.strip, "slices", preset_id="webtoon", title="第1话"
        )
        self.assertEqual(mime, "application/zip")
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            manifest = json.loads(z.read("manifest.json"))
            self.assertEqual(manifest["count"], len(z.namelist()) - 1)
            self.assertTrue(z.namelist()[0].endswith(".jpg"))
        long_png, mime, _ = X.export(self.image, self.strip, "long")
        self.assertEqual(Image.open(io.BytesIO(long_png)).size, self.image.size)
        pdf, mime, _ = X.export(self.image, self.strip, "pdf")
        self.assertTrue(pdf.startswith(b"%PDF"))
        page, mime, name = X.export(self.image, self.strip, "html", title="<雨夜>")
        text = page.decode()
        self.assertIn("&lt;雨夜&gt;", text)
        self.assertIn("data:image/jpeg;base64,", text)
        self.assertNotIn("http://", text.replace("http://www.w3.org", ""))
        with self.assertRaises(ValueError):
            X.export(self.image, self.strip, "gif")


class RegistryTests(unittest.TestCase):
    def test_register_get_and_events(self):
        reg = Registry()
        seen = []
        reg.on("registry.changed", seen.append)

        @reg.contribute("exporter", "long", title="长图")
        def long_exporter():
            return "ok"

        self.assertIs(reg.get("exporter", "long"), long_exporter)
        self.assertEqual(seen[0]["id"], "long")
        with self.assertRaises(RegistryError):
            reg.register("exporter", "long", object())
        with self.assertRaises(RegistryError):
            reg.register("nope", "x", object())
        reg.register("exporter", "long", "v2", replace=True, source="ext.demo")
        self.assertEqual(reg.describe()["exporter"][0]["source"], "ext.demo")
        reg.unregister("exporter", "long")
        with self.assertRaises(RegistryError):
            reg.get("exporter", "long")
