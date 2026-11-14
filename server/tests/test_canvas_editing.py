"""Saved framing and whitespace survive the actual HTTP read/export path."""

import io

from PIL import Image

from mio_server.models import Episode, Panel, Series, Take

from .api_harness import ApiCase


class CanvasEditingTests(ApiCase):
    def setUp(self):
        super().setUp()
        series = self.ctx.store.create_series(Series(title="Canvas"))
        image = Image.new("RGB", (200, 100), "red")
        image.paste(Image.new("RGB", (100, 100), "blue"), (100, 0))
        buf = io.BytesIO()
        image.save(buf, "PNG")
        asset = self.ctx.assets.put(buf.getvalue(), source="test")
        self.ep = self.ctx.store.create_episode(
            Episode(
                series_id=series.id,
                title="Framing",
                order=0,
                panels=[Panel(id="p1", order=0)],
                takes=[Take(panel_id="p1", asset_id=asset.id, status="adopted")],
            )
        )
        self.path = f"/api/episodes/{self.ep.id}"
        self.strip = {
            "panel_boxes": {"p1": [50, 200, 250, 400]},
            "crops": {"p1": [0.5, 0, 1, 1]},
            "height": 1000,
        }

    def test_saved_framing_and_whitespace_match_reading_and_export(self):
        saved = self.ok(self.client.put(self.path + "/strip", json=self.strip))
        self.ok(
            self.client.patch(
                self.path + "/panels/p1",
                json={"changes": {"aspect_ratio": "16:9", "gap_after": 1000}},
            )
        )
        for url in ("/strip.png", "/export?fmt=long"):
            result = self.ok(self.client.get(self.path + url))
            with Image.open(io.BytesIO(result.content)) as image:
                self.assertEqual(image.size, (saved["width"], 1000))
                self.assertEqual(image.getpixel((150, 300)), (0, 0, 255))
                self.assertEqual(image.getpixel((300, 300)), (255, 255, 255))
                self.assertEqual(image.getpixel((150, 450)), (255, 255, 255))
        persisted = self.ok(self.client.get(self.path))["strip"]
        self.assertEqual(persisted, saved)

    def test_bottom_lettering_expands_saved_canvas_and_export(self):
        self.strip["lettering"] = [{"text": "End", "box": [30, 1100, 300, 1200], "locked": True}]
        saved = self.ok(self.client.put(self.path + "/strip", json=self.strip))
        self.assertEqual(saved["height"], 1420)
        result = self.ok(self.client.get(self.path + "/strip.png"))
        with Image.open(io.BytesIO(result.content)) as image:
            self.assertEqual(image.height, 1420)
            self.assertLess(image.crop((30, 1100, 300, 1200)).convert("L").getextrema()[0], 100)

    def test_invalid_geometry_is_rejected_without_changing_saved_work(self):
        saved = self.ok(self.client.put(self.path + "/strip", json=self.strip))
        invalid = [
            {"crops": {"p1": [0.5, 0, 0.5, 1]}},
            {"crops": {"p1": [-0.1, 0, 1, 1]}},
            {"crops": {"p1": [0, 0, 1.1, 1]}},
            {"panel_boxes": {"p1": [200, 0, 100, 100]}},
            {"panel_boxes": {"p1": [0, 0, 0.1, 100]}},
            {"height": -1},
        ]
        for patch in invalid:
            with self.subTest(patch=patch):
                self.assertEqual(
                    self.client.put(self.path + "/strip", json={**saved, **patch}).status_code,
                    422,
                )
                self.assertEqual(self.ok(self.client.get(self.path))["strip"], saved)

    def test_tiny_valid_crop_does_not_round_to_empty_pixels(self):
        self.strip["crops"] = {"p1": [0.999, 0.999, 1, 1]}
        self.ok(self.client.put(self.path + "/strip", json=self.strip))
        result = self.ok(self.client.get(self.path + "/strip.png"))
        with Image.open(io.BytesIO(result.content)) as image:
            self.assertEqual(image.getpixel((150, 300)), (0, 0, 255))
