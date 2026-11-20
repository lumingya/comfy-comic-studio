"""Saved compositions must survive every delivery format, including their blank space."""

import io
import json
import re
import zipfile
import zlib
from pathlib import Path
from unittest import mock

from PIL import Image, ImageChops

from mio_server.album.build import episode_pages
from mio_server.importer import LegacyImporter, composition_strip
from mio_server.models import Episode, LetteringLayer, Panel, Series, Strip, Take
from mio_server.pipeline import file_export as F
from mio_server.pipeline.export_composition import BAND_HEIGHT, band_regions
from mio_server.pipeline.regions import prepare_snapshot

from .api_harness import ApiCase
from .test_reading import AlbumImages


class ExportIntegrityTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.series = self.ctx.store.create_series(Series(title="Neutral composition"))
        out = io.BytesIO()
        with Image.new("RGB", (200, 100), "#7799bb") as image:
            image.paste("#334455", (100, 0, 200, 100))
            image.save(out, "PNG")
        self.original = out.getvalue()
        asset = self.ctx.assets.put(self.original, source="test:neutral")
        self.ep = self.ctx.store.create_episode(
            Episode(
                series_id=self.series.id,
                title="Neutral",
                order=0,
                panels=[Panel(id="a", order=0), Panel(id="b", order=1)],
                takes=[Take(panel_id=p, asset_id=asset.id, status="adopted") for p in ("a", "b")],
                strip=Strip(
                    width=400,
                    height=3500,
                    manual=True,
                    margin=0,
                    panel_boxes={"a": (100, 2100, 300, 2300), "b": (50, 100, 250, 300)},
                    lettering=[
                        LetteringLayer(
                            id="gap",
                            kind="caption",
                            text="INTERLUDE",
                            box=(40, 1000, 350, 1060),
                            panel_id=None,
                            font_size=24,
                            locked=True,
                        )
                    ],
                ),
            )
        )
        self.opts = {"episode_ids": [self.ep.id], "lettered": True, "image_profile": "clean"}

    def expected(self):
        ep = self.ctx.store.get_episode(self.ep.id)
        with prepare_snapshot(self.ctx, self.series, ep) as snapshot:
            return snapshot.render_region((0, 0, snapshot.strip.width, snapshot.strip.height))

    def assert_joined(self, images, expected):
        joined = Image.new("RGB", expected.size)
        top = 0
        try:
            for image in images:
                with image:
                    self.assertEqual(image.width, expected.width)
                    joined.paste(image.convert("RGB"), (0, top))
                    top += image.height
            self.assertEqual(top, expected.height)
            self.assertIsNone(ImageChops.difference(joined, expected).getbbox())
        finally:
            joined.close()

    def pdf_images(self, pdf):
        for header, raw in re.findall(
            rb"<< (/Type /XObject /Subtype /Image.*?) >>\nstream\n(.*?)\nendstream", pdf, re.S
        ):
            width = int(re.search(rb"/Width (\d+)", header)[1])
            height = int(re.search(rb"/Height (\d+)", header)[1])
            self.assertIn(b"/FlateDecode", header)
            yield Image.frombytes("RGB", (width, height), zlib.decompress(raw))

    def test_interlude_and_all_saved_whitespace_survive_html_and_pdf(self):
        document = self.ok(self.client.post("/api/export/album", json=self.opts)).text
        payload = json.loads(
            re.search(r'id="mio-album-data"[^>]*>(.*?)</script>', document, re.S)[1]
        )
        album = payload["books"][0]["album"]
        assets = AlbumImages(document).images
        with self.expected() as expected:
            self.assert_joined(
                (Image.open(io.BytesIO(assets[s["image"]["$mioImage"]])) for s in album["steps"]),
                expected,
            )
            pdf = self.ok(
                self.client.post("/api/export/portable", json={**self.opts, "format": "pdf"})
            ).content
            self.assert_joined(self.pdf_images(pdf), expected)

    def test_zip_png_and_lossless_slices_equal_the_same_complete_canvas(self):
        zipped = self.ok(
            self.client.post("/api/export/portable", json={**self.opts, "format": "zip"})
        ).content
        path = Path(self.tmp) / "pixels.bin"
        with self.expected() as expected, zipfile.ZipFile(io.BytesIO(zipped)) as archive:
            book = json.loads(archive.read("manifest.json"))["books"][0]
            self.assertEqual(book["composition"], {"width": 400, "height": 3500})
            cursor = 0
            for entry in book["files"]:
                region = entry["sourceRegion"]
                self.assertEqual(region[:3], [0, cursor, 400])
                cursor = region[3]
            self.assertEqual(cursor, 3500)
            self.assert_joined(
                (Image.open(io.BytesIO(archive.read(f["name"]))) for f in book["files"]), expected
            )
            ep = self.ctx.store.get_episode(self.ep.id)
            with prepare_snapshot(self.ctx, self.series, ep) as snapshot:
                F.write_png(snapshot, path)
                with Image.open(path) as image:
                    self.assertEqual(image.tobytes(), expected.tobytes())
                F.write_export(
                    snapshot, "slices", F.X.SlicePreset("clean", "Clean", 400, 1600, "PNG"), path
                )
                with zipfile.ZipFile(path) as slices:
                    manifest = json.loads(slices.read("manifest.json"))
                    self.assert_joined(
                        (Image.open(io.BytesIO(slices.read(f["name"]))) for f in manifest["files"]),
                        expected,
                    )

    def test_overlap_reverse_order_cross_edge_tail_and_oversized_text_keep_every_pixel(self):
        def edit(ep):
            ep.strip.panel_boxes = {"a": (-40, 1800, 280, 2400), "b": (120, 1600, 450, 2200)}
            ep.strip.lettering.extend(
                [
                    LetteringLayer(
                        kind="speech",
                        text="Crossing",
                        box=(-30, 1510, 450, 1710),
                        panel_id="a",
                        bridge_to="b",
                        tail_to=(250, 2100),
                        font_size=24,
                    ),
                    LetteringLayer(
                        kind="sfx", text="SFX", box=(80, 3000, 300, 3100), style={"rotation": 31}
                    ),
                ]
            )

        self.ctx.store.update_episode(self.ep.id, edit)
        _, _, pages = episode_pages(self.ctx, self.ep.id, profile="clean")
        with self.expected() as expected:
            self.assert_joined((Image.open(io.BytesIO(p.data)) for p in pages), expected)
        self.assertTrue(all(p.height <= BAND_HEIGHT for p in pages))

    def test_original_mode_and_unsaved_composition_never_apply_ratio_crop(self):
        for saved in (True, False):
            if not saved:
                self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "strip", Strip()))
            _, _, pages = episode_pages(self.ctx, self.ep.id, lettered=not saved, profile="clean")
            self.assertEqual(len(pages), 2)
            for page in pages:
                self.assertEqual(page.data, self.original)
                self.assertEqual((page.width, page.height), (200, 100))
                self.assertIsNone(page.source_region)

    def test_text_only_canvas_exports_without_adopted_images(self):
        def edit(ep):
            ep.panels = []
            ep.takes = []
            ep.strip.panel_boxes = {}

        self.ctx.store.update_episode(self.ep.id, edit)
        self.ctx.exports.freeze("portable", self.opts, require_complete=True)
        for kind, extra in (
            ("album", {}),
            ("portable", {"format": "pdf"}),
            ("portable", {"format": "zip"}),
        ):
            response = self.client.post(f"/api/export/{kind}", json={**self.opts, **extra})
            self.assertEqual(response.status_code, 200, response.text[:200])
        _, _, pages = episode_pages(self.ctx, self.ep.id, profile="clean")
        with self.expected() as expected:
            self.assert_joined((Image.open(io.BytesIO(p.data)) for p in pages), expected)

    def test_long_html_uses_bounded_bands_file_spooling_and_cleans_up_on_cancel(self):
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep.strip, "height", 100_000))
        path = self.ctx.exports.root / "streamed.html"
        sizes, files = [], []
        new = Image.new
        from mio_server.album import render

        writer = render.write_album

        def inspect(*args, **kwargs):
            spooled = args[4]
            files.extend(file for _, file in spooled.values())
            self.assertGreater(len(spooled), 50)
            self.assertTrue(
                all(f.image.startswith("mio-spooled-") for b in args[1] for f in b.frames)
            )
            return writer(*args, **kwargs)

        def allocated(mode, size, *args, **kwargs):
            sizes.append(size)
            return new(mode, size, *args, **kwargs)

        frozen = self.ctx.exports.freeze("album", self.opts)
        with (
            mock.patch.object(render, "write_album", side_effect=inspect),
            mock.patch.object(Image, "new", side_effect=allocated),
        ):
            self.ctx.exports.write(frozen, path)
        self.assertLessEqual(max(w * h for w, h in sizes), 400 * BAND_HEIGHT)
        self.assertTrue(files)
        self.assertTrue(all(not f.exists() for f in files))

        def cancel(*args, **kwargs):
            def stop():
                raise RuntimeError("cancelled while encoding")

            kwargs["checkpoint"] = stop
            return inspect(*args, **kwargs)

        with mock.patch.object(render, "write_album", side_effect=cancel):
            with self.assertRaisesRegex(RuntimeError, "cancelled while encoding"):
                self.ctx.exports.write(frozen, path)
        self.assertFalse(path.exists())
        self.assertTrue(all(not f.exists() for f in files))

    def test_safe_boundaries_avoid_tail_and_hard_limit_covers_oversized_layer(self):
        ep = self.ctx.store.get_episode(self.ep.id)
        with prepare_snapshot(self.ctx, self.series, ep) as snapshot:
            regions = list(band_regions(snapshot))
            cursor = 0
            for region in regions:
                self.assertEqual(region[:3], (0, cursor, 400))
                self.assertLessEqual(region[3] - region[1], BAND_HEIGHT)
                cursor = region[3]
            self.assertEqual(cursor, snapshot.strip.height)
            snapshot.layer_bounds = [(0, 1500, 400, 1700)]
            self.assertEqual(next(iter(band_regions(snapshot)))[3], 1500)
            snapshot.layer_bounds = [(0, -5000, 400, 5000)]
            self.assertEqual(
                list(band_regions(snapshot)),
                [
                    (0, 0, 400, 1600),
                    (0, 1600, 400, 3200),
                    (0, 3200, 400, 3500),
                ],
            )

    def test_v1_metadata_reimports_as_seamless_raster_composition(self):
        document = self.ok(self.client.post("/api/export/album", json=self.opts)).text
        payload = json.loads(
            re.search(r'id="mio-album-data"[^>]*>(.*?)</script>', document, re.S)[1]
        )
        self.assertEqual(payload["schema"], "mio.album-html.v1")
        album = payload["books"][0]["album"]
        self.assertEqual(album["composition"], {"width": 400, "height": 3500})
        assets = AlbumImages(document).images
        folder = Path(self.tmp) / "legacy" / "albums" / "neutral"
        folder.mkdir(parents=True)
        album["id"] = "neutral-round-trip"
        for i, step in enumerate(album["steps"]):
            self.assertEqual(step["stepIndex"], i)
            name = f"{i}.png"
            (folder / name).write_bytes(assets[step["image"]["$mioImage"]])
            step["image"] = name
        (folder / "album.json").write_text(json.dumps(album), encoding="utf-8")
        report = LegacyImporter(self.ctx.store, folder.parents[1], self.ctx.assets).import_albums()
        imported = self.ctx.store.get_episode(report.episodes[0])
        series = self.ctx.store.get_series(imported.series_id)
        self.assertTrue(imported.strip.rasterized)
        self.assertEqual(imported.strip.height, 3500)
        with self.expected() as expected, prepare_snapshot(self.ctx, series, imported) as snapshot:
            self.assertEqual(snapshot.strip.height, 3500)
            with snapshot.render_region((0, 0, 400, 3500)) as actual:
                self.assertEqual(actual.tobytes(), expected.tobytes())
        _, _, pages = episode_pages(self.ctx, imported.id, profile="clean")
        with self.expected() as expected:
            self.assert_joined((Image.open(io.BytesIO(p.data)) for p in pages), expected)
        # Untrusted partial/overlapping partitions must not acquire rasterized semantics.
        album["steps"][1]["sourceRegion"][1] -= 1
        self.assertIsNone(composition_strip(album, album["steps"], imported.panels, imported.takes))

    def test_publish_changes_encoding_and_sampling_but_never_coverage(self):
        _, _, pages = episode_pages(self.ctx, self.ep.id, profile="publish")
        cursor = 0
        for page in pages:
            self.assertEqual(page.source_region[:3], (0, cursor, 400))
            cursor = page.source_region[3]
            self.assertEqual(page.mime, "image/webp")
            with Image.open(io.BytesIO(page.data)) as image:
                self.assertEqual(image.size, (page.width, page.height))
        self.assertEqual(cursor, 3500)
        _, _, preview = episode_pages(self.ctx, self.ep.id, profile="preview", max_width=320)
        self.assertEqual([p.source_region for p in preview], [p.source_region for p in pages])
        self.assertTrue(all(p.width == 320 for p in preview))
        for page in preview:
            with Image.open(io.BytesIO(page.data)) as image:
                self.assertEqual(image.size, (page.width, page.height))

    def test_archive_canvas_uses_lossless_png_and_pdf_pixels(self):
        opts = {**self.opts, "image_profile": "archive"}
        document = self.ok(self.client.post("/api/export/album", json=opts)).text
        payload = json.loads(
            re.search(r'id="mio-album-data"[^>]*>(.*?)</script>', document, re.S)[1]
        )
        assets = AlbumImages(document).images
        pdf = self.ok(
            self.client.post("/api/export/portable", json={**opts, "format": "pdf"})
        ).content
        with self.expected() as expected:
            self.assert_joined(
                (
                    Image.open(io.BytesIO(assets[s["image"]["$mioImage"]]))
                    for s in payload["books"][0]["album"]["steps"]
                ),
                expected,
            )
            self.assert_joined(self.pdf_images(pdf), expected)

    def test_one_pixel_tail_band_survives_directory_round_trip(self):
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep.strip, "height", 3201))
        _, _, pages = episode_pages(self.ctx, self.ep.id, profile="clean")
        self.assertEqual(pages[-1].height, 1)
        folder = Path(self.tmp) / "tiny-tail" / "albums" / "neutral"
        folder.mkdir(parents=True)
        steps = []
        for i, page in enumerate(pages):
            name = f"{i}.png"
            (folder / name).write_bytes(page.data)
            steps.append(
                {
                    "stepIndex": i,
                    "width": page.width,
                    "height": page.height,
                    "image": name,
                    "sourceRegion": page.source_region,
                }
            )
        album = {"id": "tiny-tail", "composition": {"width": 400, "height": 3201}, "steps": steps}
        (folder / "album.json").write_text(json.dumps(album), encoding="utf-8")
        report = LegacyImporter(self.ctx.store, folder.parents[1], self.ctx.assets).import_albums()
        imported = self.ctx.store.get_episode(report.episodes[0])
        series = self.ctx.store.get_series(imported.series_id)
        with self.expected() as expected, prepare_snapshot(self.ctx, series, imported) as snapshot:
            self.assertEqual(snapshot.strip.height, 3201)
            with snapshot.render_region((0, 0, 400, 3201)) as actual:
                self.assertIsNone(ImageChops.difference(actual, expected).getbbox())

    def test_preview_narrow_one_pixel_tail_keeps_nonzero_height_and_source_region(self):
        def edit(ep):
            ep.strip.width = 800
            ep.strip.height = 3201

        self.ctx.store.update_episode(self.ep.id, edit)
        for width in (320, 400):
            with self.subTest(width=width):
                opts = {**self.opts, "image_profile": "preview", "max_width": width}
                document = self.ok(self.client.post("/api/export/album", json=opts)).text
                payload = json.loads(
                    re.search(r'id="mio-album-data"[^>]*>(.*?)</script>', document, re.S)[1]
                )
                album = payload["books"][0]["album"]
                self.assertEqual(album["composition"], {"width": 800, "height": 3201})
                tail = album["steps"][-1]
                self.assertEqual(tail["sourceRegion"], [0, 3200, 800, 3201])
                self.assertEqual((tail["width"], tail["height"]), (width, 1))
                assets = AlbumImages(document).images
                with Image.open(io.BytesIO(assets[tail["image"]["$mioImage"]])) as image:
                    self.assertEqual(image.size, (width, 1))

    def test_odd_origin_sfx_and_fractional_glyphs_join_on_global_pixel_grid(self):
        def edit(ep):
            ep.strip.lettering = [
                LetteringLayer(
                    kind="sfx", text="SFX", box=(80.5, 1510, 300.5, 1599), style={"rotation": 31}
                ),
                LetteringLayer(
                    kind="speech", text="Phase", box=(-30.5, 1511, 450.5, 1711), font_size=24
                ),
            ]

        self.ctx.store.update_episode(self.ep.id, edit)
        ep = self.ctx.store.get_episode(self.ep.id)
        with prepare_snapshot(self.ctx, self.series, ep) as snapshot:
            with snapshot.render_region((0, 0, 400, 3500)) as expected:
                self.assert_joined(
                    (
                        snapshot.render_region(box)
                        for box in ((0, 0, 400, 1551), (0, 1551, 400, 3500))
                    ),
                    expected,
                )

    def test_fractional_bubble_geometry_rounds_before_translating_odd_bands(self):
        from mio_server.pipeline import episode_strip as ES

        path = Path(self.tmp) / "fractional.png"
        for kind in ("speech", "thought", "caption"):
            with self.subTest(kind=kind):

                def edit(ep):
                    ep.strip.lettering = [
                        LetteringLayer(
                            kind=kind,
                            text="Neutral phase",
                            box=(20.5, 1490.5, 380.5, 1680.5),
                            font_size=24,
                            tail_to=(280.5, 1801.5),
                        )
                    ]
                    ep.strip.panel_boxes["a"] = (100, 1001, 300, 1201)

                self.ctx.store.update_episode(self.ep.id, edit)
                ep = self.ctx.store.get_episode(self.ep.id)
                _, _, _, expected = ES.render_snapshot(self.ctx, self.series, ep)
                with expected, prepare_snapshot(self.ctx, self.series, ep) as snapshot:
                    self.assert_joined(
                        (
                            snapshot.render_region(box)
                            for box in ((0, 0, 400, 1551), (0, 1551, 400, 3500))
                        ),
                        expected,
                    )
                    F.write_png(snapshot, path)
                    with Image.open(path) as actual:
                        self.assertIsNone(ImageChops.difference(actual, expected).getbbox())
                _, _, pages = episode_pages(self.ctx, self.ep.id, profile="clean")
                self.assertEqual(pages[0].source_region[3] % 2, 1)
                with self.expected() as expected:
                    self.assert_joined((Image.open(io.BytesIO(p.data)) for p in pages), expected)
                    document = self.ok(self.client.post("/api/export/album", json=self.opts)).text
                    payload = json.loads(
                        re.search(r'id="mio-album-data"[^>]*>(.*?)</script>', document, re.S)[1]
                    )
                    assets = AlbumImages(document).images
                    self.assert_joined(
                        (
                            Image.open(io.BytesIO(assets[s["image"]["$mioImage"]]))
                            for s in payload["books"][0]["album"]["steps"]
                        ),
                        expected,
                    )
                    pdf = self.ok(
                        self.client.post(
                            "/api/export/portable", json={**self.opts, "format": "pdf"}
                        )
                    ).content
                    self.assert_joined(self.pdf_images(pdf), expected)
