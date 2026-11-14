"""Reading uses the exported composition and shares bounded, isolated preview work."""

from __future__ import annotations

import base64
import io
import json
import random
import re
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

from PIL import Image

from mio_server.album.build import episode_pages
from mio_server.context import AppContext
from mio_server.models import Bible, Character, Dialogue, Episode, Panel, Series, Strip, Take
from mio_server.pipeline import strip as SP
from mio_server.pipeline.reading import ReadingCache

from .api_harness import ApiCase, FakeComfy, FakeLLM


class AlbumImages(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.images = {}
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "img" and "data-mio-asset" in attrs:
            self.images[attrs["data-mio-asset"]] = base64.b64decode(attrs["src"].split(",", 1)[1])


class ReadingTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.series = self.ctx.store.create_series(
            Series(
                title="Reading",
                variables={"hero": "Mio"},
                bible=Bible(characters=[Character(id="speaker", name="Ada", age=25)]),
            )
        )
        with Image.new("RGB", (200, 100), "red") as image:
            image.paste("blue", (100, 0, 200, 100))
            self.asset = self.put_image(image)
        self.ep = self.ctx.store.create_episode(
            Episode(
                series_id=self.series.id,
                title="Framing",
                order=0,
                panels=[
                    Panel(id="p1", order=0, dialogues=[Dialogue(text="{hero} arrives")]),
                    Panel(
                        id="p2", order=1, dialogues=[Dialogue(speaker_id="speaker", text="{hero}")]
                    ),
                ],
                takes=[
                    Take(panel_id=pid, asset_id=self.asset.id, status="adopted")
                    for pid in ("p1", "p2")
                ],
            )
        )
        self.path = f"/api/episodes/{self.ep.id}"
        self.saved = self.ok(
            self.client.put(
                self.path + "/strip",
                json={
                    "width": 320,
                    "height": 1000,
                    "panel_boxes": {"p1": [30, 200, 190, 360], "p2": [70, 600, 230, 680]},
                    "crops": {"p1": [0.5, 0, 1, 1], "p2": [0, 0, 0.5, 1]},
                    "lettering": [
                        {
                            "panel_id": "p1",
                            "text": "INK",
                            "kind": "caption",
                            "box": [50, 230, 170, 300],
                            "font_size": 24,
                            "locked": True,
                        }
                    ],
                },
            )
        )

    def put_image(self, image, ctx=None):
        out = io.BytesIO()
        image.save(out, "PNG")
        return (ctx or self.ctx).assets.put(out.getvalue(), source="test")

    def assert_pixels_equal(self, first, second):
        with Image.open(io.BytesIO(first)) as a, Image.open(io.BytesIO(second)) as b:
            self.assertEqual(a.size, b.size)
            self.assertEqual(a.convert("RGB").tobytes(), b.convert("RGB").tobytes())

    def preview(self):
        return self.ctx.reading.get(self.ctx, self.ep.id, None, 1600)

    def test_panel_png_matches_clean_export_with_saved_crop_and_lettering(self):
        _, _, pages = episode_pages(self.ctx, self.ep.id, profile="clean")
        for pid, page, size, color in zip(
            ("p1", "p2"), pages, ((160, 160), (160, 80)), ((0, 0, 255), (255, 0, 0)), strict=True
        ):
            response = self.ok(self.client.get(self.path + f"/panels/{pid}/image"))
            self.assertEqual(response.headers["content-type"], "image/png")
            self.assert_pixels_equal(response.content, page.data)
            with Image.open(io.BytesIO(response.content)) as image:
                self.assertEqual(image.size, size)
                self.assertEqual(image.getpixel((5, 5)), color)
                if pid == "p1":
                    lettering = image.crop((20, 30, 140, 100)).convert("RGB")
                    colors = {
                        pixel
                        for _, pixel in lettering.getcolors(lettering.width * lettering.height)
                    }
                    self.assertIn((255, 255, 255), colors)
                    self.assertTrue(any(max(pixel) < 100 for pixel in colors))
        full = self.ok(self.client.get(self.path + "/strip.png"))
        with Image.open(io.BytesIO(full.content)) as image:
            self.assertEqual(image.size, (320, 1000))
            self.assertEqual(image.getpixel((100, 480)), (255, 255, 255))

    def test_html_zip_and_pdf_use_composited_panel_dimensions(self):
        _, _, pages = episode_pages(self.ctx, self.ep.id, profile="clean")
        body = {"episode_ids": [self.ep.id], "image_profile": "clean", "lettered": True}
        html = self.ok(self.client.post("/api/export/album", json=body)).text
        marker = re.search(r'<script id="mio-album-data"[^>]*>(.*?)</script>', html, re.S)
        self.assertIsNotNone(marker)
        steps = json.loads(marker.group(1))["books"][0]["album"]["steps"]
        images = AlbumImages(html).images
        for page, step in zip(pages, steps, strict=True):
            self.assert_pixels_equal(page.data, images[step["image"]["$mioImage"]])
        response = self.ok(self.client.post("/api/export/portable", json={**body, "format": "zip"}))
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            files = json.loads(archive.read("manifest.json"))["books"][0]["files"]
            for page, entry in zip(pages, files, strict=True):
                self.assert_pixels_equal(page.data, archive.read(entry["name"]))
                self.assertEqual(entry["caption"], page.caption)
        pdf = self.ok(self.client.post("/api/export/portable", json={**body, "format": "pdf"}))
        self.assertEqual(pdf.headers["content-type"], "application/pdf")
        self.assertEqual(len(re.findall(rb"/Type\s*/Page\b", pdf.content)), 2)
        media_boxes = re.findall(rb"/MediaBox\s*\[([^\]]+)\]", pdf.content)
        self.assertEqual(
            [[float(value) for value in box.split()] for box in media_boxes],
            [[0, 0, 120, 120], [0, 0, 120, 60]],
        )

    def test_metadata_preserves_geometry_expands_captions_and_never_writes(self):
        before_ep = self.ctx.store.get_episode(self.ep.id).model_dump(mode="json")
        before_series = self.ctx.store.get_series(self.series.id).model_dump(mode="json")
        with (
            mock.patch.object(self.ctx.store, "save_episode", side_effect=AssertionError("write")),
            mock.patch.object(self.ctx.store, "update_series", side_effect=AssertionError("write")),
            mock.patch.object(self.ctx.engine, "submit", side_effect=AssertionError("job")),
        ):
            preview = self.ok(self.client.get(self.path + "/reading"))
            self.ok(self.client.get(self.path + "/panels/p1/image"))
        self.assertEqual(preview["panel_boxes"], self.saved["panel_boxes"])
        self.assertEqual((preview["width"], preview["height"]), (320, 1000))
        self.assertEqual(preview["captions"], {"p1": "Mio arrives", "p2": "Ada\uff1aMio"})
        self.assertRegex(preview["revision"], r"^[a-f0-9]{64}$")
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).model_dump(mode="json"), before_ep)
        self.assertEqual(
            self.ctx.store.get_series(self.series.id).model_dump(mode="json"), before_series
        )
        self.assertEqual(self.ctx.engine.list(), [])

    def test_unsaved_layout_metadata_matches_pixels_without_saving_layout(self):
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "strip", Strip(width=320)))
        before = self.ctx.store.get_episode(self.ep.id).model_dump(mode="json")
        metadata = self.ok(self.client.get(self.path + "/reading"))
        self.assertEqual(set(metadata["panel_boxes"]), {"p1", "p2"})
        full = self.ok(self.client.get(self.path + "/strip.png"))
        with Image.open(io.BytesIO(full.content)) as image:
            self.assertEqual(image.size, (metadata["width"], metadata["height"]))
            for pid, box in metadata["panel_boxes"].items():
                response = self.ok(self.client.get(self.path + f"/panels/{pid}/image"))
                with Image.open(io.BytesIO(response.content)) as panel:
                    expected = image.crop(tuple(round(value) for value in box))
                    self.assertEqual(panel.size, expected.size)
                    self.assertEqual(panel.tobytes(), expected.tobytes())
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).model_dump(mode="json"), before)

    def test_no_adopted_image_has_empty_metadata_and_404(self):
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "takes", []))
        with mock.patch.object(SP, "render", side_effect=AssertionError("empty render")):
            preview = self.ok(self.client.get(self.path + "/reading"))
            self.assertEqual(preview["panel_boxes"], {})
            self.assertEqual(preview["captions"], {})
            for pid in ("p1", "unknown"):
                self.assertEqual(
                    self.client.get(self.path + f"/panels/{pid}/image").status_code, 404
                )

    def test_v2_preview_and_image_require_only_read_scope(self):
        read = self.ok(
            self.client.post("/api/tokens", json={"name": "reader", "scopes": ["read"]}), 201
        )
        write = self.ok(
            self.client.post("/api/tokens", json={"name": "writer", "scopes": ["write"]}), 201
        )
        for suffix in ("/reading", "/panels/p1/image"):
            url = self.path.replace("/api/", "/api/v2/") + suffix
            self.assertEqual(self.client.get(url).status_code, 401)
            self.assertEqual(
                self.client.get(
                    url, headers={"Authorization": f"Bearer {write['token']}"}
                ).status_code,
                403,
            )
            self.ok(self.client.get(url, headers={"Authorization": f"Bearer {read['token']}"}))
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        response = schema["paths"]["/episodes/{episode_id}/reading"]["get"]["responses"]["200"]
        self.assertEqual(
            response["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/ReadingPreview",
        )

    def test_mixed_preview_widths_share_render_without_upscaling(self):
        def widen(ep):
            ep.strip.width = 2400
            ep.strip.panel_boxes["p1"] = (20, 200, 2020, 400)

        self.ctx.store.update_episode(self.ep.id, widen)
        with mock.patch.object(SP, "render", wraps=SP.render) as render:
            metadata = self.ok(self.client.get(self.path + "/reading?width=1600"))
            self.assertEqual(metadata["panel_boxes"]["p1"], [20, 200, 2020, 400])
            for width, expected in ((256, (256, 26)), (1600, (1600, 160)), (3200, (2000, 200))):
                with self.subTest(width=width):
                    response = self.ok(
                        self.client.get(self.path + f"/panels/p1/image?width={width}")
                    )
                    with Image.open(io.BytesIO(response.content)) as image:
                        self.assertEqual(image.size, expected)
                        self.assertLessEqual(image.width, width)
            small = self.ok(self.client.get(self.path + "/panels/p2/image?width=3200"))
            with Image.open(io.BytesIO(small.content)) as image:
                self.assertEqual(image.size, (160, 80))
            self.assertEqual(render.call_count, 1)
        self.assertEqual(len(self.ctx.reading.entries), 1)

    def test_fifty_concurrent_panel_requests_render_snapshot_once(self):
        def populate(ep):
            ep.panels = [Panel(id=f"p{i}", order=i) for i in range(50)]
            ep.takes = [
                Take(panel_id=p.id, asset_id=self.asset.id, status="adopted") for p in ep.panels
            ]
            ep.strip = Strip(
                width=320,
                panel_boxes={
                    p.id: (20, 200 + i * 20, 36, 216 + i * 20) for i, p in enumerate(ep.panels)
                },
                height=1500,
            )

        self.ctx.store.update_episode(self.ep.id, populate)
        start = threading.Barrier(10)

        def read(index):
            if index < 10:
                start.wait(timeout=10)
            return self.ctx.reading.image(self.ctx, self.ep.id, f"p{index}", None, 1600)

        with mock.patch.object(SP, "render", wraps=SP.render) as render:
            with ThreadPoolExecutor(max_workers=10) as pool:
                images = list(pool.map(read, range(50)))
            self.assertEqual(render.call_count, 1)
        self.assertEqual(len(images), 50)
        for data in images:
            with Image.open(io.BytesIO(data)) as image:
                self.assertEqual(image.size, (16, 16))
        self.assertEqual(len(self.ctx.reading.entries), 1)

    def test_cache_invalidates_crop_adoption_series_variables_and_bible(self):
        with mock.patch.object(SP, "render", wraps=SP.render) as render:
            initial = self.preview()
            self.ctx.store.update_episode(
                self.ep.id, lambda ep: ep.strip.crops.update({"p1": (0, 0, 0.5, 1)})
            )
            cropped = self.preview()
            with Image.open(io.BytesIO(cropped.images["p1"])) as image:
                self.assertEqual(image.getpixel((5, 5)), (255, 0, 0))
            self.assertNotEqual(initial.images["p1"], cropped.images["p1"])
            with Image.new("RGB", (100, 100), "green") as image:
                replacement = self.put_image(image)

            def adopt(ep):
                ep.takes[0].status = "candidate"
                ep.takes.append(Take(panel_id="p1", asset_id=replacement.id, status="adopted"))

            self.ctx.store.update_episode(self.ep.id, adopt)
            adopted = self.preview()
            with Image.open(io.BytesIO(adopted.images["p1"])) as image:
                self.assertEqual(image.getpixel((5, 5)), (0, 128, 0))
            self.ctx.store.update_series(self.series.id, lambda s: s.variables.update(hero="Nova"))
            variables = self.preview()
            self.assertEqual(variables.preview.captions["p1"], "Nova arrives")
            self.ctx.store.update_series(
                self.series.id, lambda s: setattr(s.bible.characters[0], "name", "Bea")
            )
            bible = self.preview()
            self.assertEqual(bible.preview.captions["p2"], "Bea\uff1aNova")
            entries = (initial, cropped, adopted, variables, bible)
            self.assertEqual(len({entry.preview.revision for entry in entries}), 5)
            self.assertEqual(render.call_count, 5)
            self.assertIs(self.preview(), bible)
            self.assertEqual(render.call_count, 5)
            self.assertLessEqual(len(self.ctx.reading.entries), self.ctx.reading.max_entries)

    def test_distinct_contexts_never_share_preview_cache(self):
        other = AppContext.create(
            Path(self.tmp) / "other",
            autostart=False,
            llm_factory=FakeLLM,
            comfy_client_factory=FakeComfy,
            seed_instance=False,
        )
        self.addCleanup(other.close)
        other.store.create_series(self.ctx.store.get_series(self.series.id))
        other.store.create_episode(self.ctx.store.get_episode(self.ep.id))
        self.assertIsNot(other.reading, self.ctx.reading)
        with (
            mock.patch.object(other.assets, "read", side_effect=self.ctx.assets.read),
            mock.patch.object(SP, "render", wraps=SP.render) as render,
        ):
            first = self.preview()
            second = other.reading.get(other, self.ep.id, None, 1600)
            self.assertEqual(first.preview.revision, second.preview.revision)
            self.assertEqual(render.call_count, 2)
            self.assertIsNot(first, second)
            self.assert_pixels_equal(first.images["p1"], second.images["p1"])
            other.reading.clear()
            self.assertIs(self.preview(), first)
            self.assertEqual(render.call_count, 2)

    def test_small_byte_budget_reduces_width_and_reuses_all_panels(self):
        with Image.frombytes("RGB", (64, 64), random.Random(17).randbytes(64 * 64 * 3)) as image:
            noisy = self.put_image(image)

        def replace(ep):
            ep.strip = Strip(
                width=320,
                panel_boxes={"p1": (20, 200, 84, 264), "p2": (20, 400, 84, 464)},
                height=700,
            )
            for take in ep.takes:
                take.asset_id = noisy.id

        self.ctx.store.update_episode(self.ep.id, replace)
        cache = ReadingCache(max_bytes=1200, max_entries=2)
        self.addCleanup(cache.clear)
        with mock.patch.object(SP, "render", wraps=SP.render) as render:
            first = cache.image(self.ctx, self.ep.id, "p1", None, 64)
            second = cache.image(self.ctx, self.ep.id, "p2", None, 64)
            self.assertEqual(render.call_count, 1)
        with Image.open(io.BytesIO(first)) as a, Image.open(io.BytesIO(second)) as b:
            self.assertLess(a.width, 64)
            self.assertEqual(a.size, b.size)
        self.assertEqual(cache.bytes, len(first) + len(second))
        self.assertLessEqual(cache.bytes, 1200)
        self.assertEqual(len(cache.entries), 1)
