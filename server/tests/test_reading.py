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
from mio_server.models import (
    Bible,
    Character,
    Dialogue,
    Episode,
    LetteringLayer,
    Panel,
    Series,
    Strip,
    Take,
)
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

    def test_panel_keeps_complete_caption_crossing_top_edge_without_duplicate_caption(self):
        def edit(ep):
            ep.strip.lettering = [
                LetteringLayer(
                    panel_id="p1",
                    kind="caption",
                    text="Mio arrives",
                    box=(40, 160, 180, 220),
                    font_size=16,
                )
            ]

        self.ctx.store.update_episode(self.ep.id, edit)
        _, _, pages = episode_pages(
            self.ctx, self.ep.id, profile="clean", deduplicate_captions=True
        )
        self.assertEqual((pages[0].width, pages[0].height), (160, 200))
        self.assertEqual(pages[0].caption, "")
        preview = self.ok(self.client.get(self.path + "/reading"))
        self.assertEqual(preview["panel_boxes"]["p1"], [30, 160, 190, 360])
        self.assertEqual(preview["display_captions"]["p1"], "")
        image = self.ok(self.client.get(self.path + "/panels/p1/image"))
        self.assert_pixels_equal(image.content, pages[0].data)
        with Image.open(io.BytesIO(image.content)) as im:
            self.assertEqual(im.getpixel((5, 100)), (0, 0, 255))
            self.assertEqual(im.getpixel((5, 5)), (255, 255, 255))
            colors = im.crop((10, 0, 150, 60)).getcolors(140 * 60)
            self.assertTrue(any(max(pixel) < 100 for _, pixel in colors))
        body = {
            "episode_ids": [self.ep.id],
            "image_profile": "clean",
            "lettered": True,
            "deduplicate_captions": True,
        }
        html = self.ok(self.client.post("/api/export/album", json=body)).text
        marker = re.search(r'<script id="mio-album-data"[^>]*>(.*?)</script>', html, re.S)
        step = json.loads(marker.group(1))["books"][0]["album"]["steps"][0]
        self.assertEqual(step["caption"], "")
        self.assert_pixels_equal(
            pages[0].data, AlbumImages(html).images[step["image"]["$mioImage"]]
        )
        zipped = self.ok(self.client.post("/api/export/portable", json={**body, "format": "zip"}))
        with zipfile.ZipFile(io.BytesIO(zipped.content)) as zf:
            entry = json.loads(zf.read("manifest.json"))["books"][0]["files"][0]
            self.assertEqual(entry["caption"], "")
            self.assert_pixels_equal(zf.read(entry["name"]), pages[0].data)
        pdf = self.ok(self.client.post("/api/export/portable", json={**body, "format": "pdf"}))
        first_box = re.findall(rb"/MediaBox\s*\[([^\]]+)\]", pdf.content)[0]
        self.assertEqual([float(value) for value in first_box.split()], [0, 0, 120, 150])

    def test_cross_panel_lettering_belongs_wholly_to_its_owner_without_neighbor_art(self):
        def edit(ep):
            ep.strip.lettering = [
                LetteringLayer(
                    panel_id="p1",
                    bridge_to="p2",
                    kind="speech",
                    text="Mio arrives",
                    box=(40, 580, 180, 650),
                    tail_to=(110, 350),
                    font_size=16,
                )
            ]

        self.ctx.store.update_episode(self.ep.id, edit)
        _, _, pages = episode_pages(
            self.ctx, self.ep.id, profile="clean", deduplicate_captions=True
        )
        self.assertEqual((pages[0].width, pages[0].height), (160, 451))
        self.assertEqual(pages[0].caption, "")
        with Image.open(io.BytesIO(pages[0].data)) as first:
            self.assertEqual(first.getpixel((155, 440)), (255, 255, 255))
            self.assertEqual(first.getpixel((5, 5)), (0, 0, 255))
        with Image.open(io.BytesIO(pages[1].data)) as second:
            self.assertEqual(second.size, (160, 80))
            self.assertEqual(second.convert("RGB").getcolors(160 * 80), [(160 * 80, (255, 0, 0))])

    def test_standalone_panel_keeps_the_tip_of_a_tail_beyond_its_right_and_bottom_edges(self):
        self.ctx.store.update_episode(
            self.ep.id,
            lambda ep: setattr(
                ep.strip,
                "lettering",
                [
                    LetteringLayer(
                        panel_id="p1",
                        kind="speech",
                        text="Hello",
                        box=(50, 230, 170, 300),
                        tail_to=(240, 400),
                        font_size=16,
                    )
                ],
            ),
        )
        _, _, pages = episode_pages(self.ctx, self.ep.id, profile="clean")
        with Image.open(io.BytesIO(pages[0].data)) as image:
            self.assertEqual(image.size, (211, 201))
            self.assertEqual(image.getpixel((210, 200)), (0, 0, 0))
            self.assertEqual(image.getpixel((200, 0)), (255, 255, 255))

    def test_panel_expanding_into_previous_frame_does_not_copy_previous_art_or_words(self):
        def edit(ep):
            ep.strip.lettering = [
                LetteringLayer(
                    panel_id="p1",
                    kind="caption",
                    text="Other panel",
                    box=(70, 220, 180, 280),
                    font_size=16,
                ),
                LetteringLayer(
                    panel_id="p2",
                    kind="speech",
                    text="Mio",
                    box=(80, 300, 220, 370),
                    font_size=16,
                ),
            ]

        self.ctx.store.update_episode(self.ep.id, edit)
        _, _, pages = episode_pages(
            self.ctx, self.ep.id, profile="clean", deduplicate_captions=True
        )
        self.assertEqual(pages[0].caption, "Mio arrives")
        self.assertEqual(pages[1].caption, "")
        with Image.open(io.BytesIO(pages[1].data)) as image:
            self.assertEqual(image.size, (160, 380))
            self.assertEqual(image.getpixel((5, 10)), (255, 255, 255))
            self.assertEqual(image.getpixel((5, 320)), (255, 0, 0))

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

    def test_unsaved_layout_reads_full_originals_with_captions_without_auto_lettering(self):
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "strip", Strip(width=320)))
        before = self.ctx.store.get_episode(self.ep.id).model_dump(mode="json")
        original = self.ctx.assets.read(self.asset.id)
        with mock.patch.object(SP, "render", side_effect=AssertionError("implicit lettering")):
            metadata = self.ok(self.client.get(self.path + "/reading"))
            self.assertEqual(
                metadata["panel_boxes"], {"p1": [0, 0, 200, 100], "p2": [0, 100, 200, 200]}
            )
            self.assertEqual(metadata["captions"], {"p1": "Mio arrives", "p2": "Ada：Mio"})
            for pid in metadata["panel_boxes"]:
                response = self.ok(self.client.get(self.path + f"/panels/{pid}/image"))
                self.assert_pixels_equal(response.content, original)
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).model_dump(mode="json"), before)

    def test_explicit_lettered_export_still_auto_layouts_an_unsaved_episode(self):
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "strip", Strip(width=320)))
        _, _, plain = episode_pages(self.ctx, self.ep.id, lettered=False, profile="clean")
        _, _, lettered = episode_pages(self.ctx, self.ep.id, lettered=True, profile="clean")
        self.assertEqual((plain[0].width, plain[0].height), (200, 100))
        self.assertNotEqual((lettered[0].width, lettered[0].height), (200, 100))
        self.assert_pixels_equal(plain[0].data, self.ctx.assets.read(self.asset.id))

    def test_caption_deduplication_is_per_line_and_panel_and_ignores_sfx(self):
        def edit(ep):
            ep.panels[0].dialogues = [
                Dialogue(kind="narration", text="{hero} arrives"),
                Dialogue(kind="narration", text="More narration"),
            ]
            ep.strip.lettering = [
                LetteringLayer(
                    panel_id="p1", kind="caption", text="Mio   arrives", box=(50, 230, 170, 300)
                ),
                LetteringLayer(
                    panel_id="p1", kind="sfx", text="More narration", box=(50, 230, 170, 300)
                ),
                LetteringLayer(panel_id="p2", kind="speech", text="Mio", box=(50, 580, 170, 650)),
            ]

        self.ctx.store.update_episode(self.ep.id, edit)
        preview = self.ok(self.client.get(self.path + "/reading"))
        self.assertEqual(preview["captions"]["p1"], "Mio arrives　More narration")
        expected = {"p1": "More narration", "p2": ""}
        self.assertEqual(preview["display_captions"], expected)
        body = {"episode_ids": [self.ep.id], "lettered": True, "deduplicate_captions": True}
        doc = self.ok(self.client.post("/api/export/album", json=body)).text
        marker = re.search(r'<script id="mio-album-data"[^>]*>(.*?)</script>', doc, re.S)
        steps = json.loads(marker.group(1))["books"][0]["album"]["steps"]
        self.assertEqual([step["caption"] for step in steps], list(expected.values()))
        zip_response = self.ok(
            self.client.post("/api/export/portable", json={**body, "format": "zip"})
        )
        with zipfile.ZipFile(io.BytesIO(zip_response.content)) as archive:
            files = json.loads(archive.read("manifest.json"))["books"][0]["files"]
            self.assertEqual([entry["caption"] for entry in files], list(expected.values()))
        _, _, legacy = episode_pages(self.ctx, self.ep.id, lettered=True)
        self.assertEqual(legacy[0].caption, preview["captions"]["p1"])
        _, _, raw = episode_pages(self.ctx, self.ep.id, lettered=False, deduplicate_captions=True)
        self.assertEqual(raw[0].caption, preview["captions"]["p1"])
        self.ctx.store.update_episode(
            self.ep.id, lambda ep: setattr(ep.strip.lettering[0], "kind", "sfx")
        )
        self.assertEqual(self.preview().preview.display_captions["p1"], preview["captions"]["p1"])

    def test_plain_reading_preserves_png_and_webp_alpha_in_panels_and_thumbnails(self):
        for fmt in ("PNG", "WEBP"):
            with self.subTest(fmt=fmt):
                with Image.new("RGBA", (200, 100), (20, 80, 150, 0)) as image:
                    image.paste((20, 80, 150, 128), (50, 0, 150, 100))
                    image.paste((20, 80, 150, 255), (150, 0, 200, 100))
                    out = io.BytesIO()
                    image.save(out, fmt, lossless=True)
                original = out.getvalue()
                asset = self.ctx.assets.put(original, source="test")

                def replace(ep):
                    ep.strip = Strip()
                    for take in ep.takes:
                        take.asset_id = asset.id

                self.ctx.store.update_episode(self.ep.id, replace)
                response = self.ok(self.client.get(self.path + "/panels/p1/image"))
                with (
                    Image.open(io.BytesIO(original)) as source,
                    Image.open(io.BytesIO(response.content)) as panel,
                ):
                    self.assertEqual(panel.mode, "RGBA")
                    self.assertEqual(panel.tobytes(), source.convert("RGBA").tobytes())
                thumbnail = self.ok(self.client.get(self.path + "/panels/p1/image?width=64"))
                with Image.open(io.BytesIO(thumbnail.content)) as panel:
                    self.assertEqual(panel.mode, "RGBA")
                    self.assertEqual(panel.size, (64, 32))
                    self.assertEqual(panel.getpixel((0, 16))[3], 0)
                    self.assertEqual(panel.getpixel((32, 16))[3], 128)
                    self.assertEqual(panel.getpixel((63, 16))[3], 255)

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
