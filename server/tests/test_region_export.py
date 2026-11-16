"""Region rendering matches the full compositor without allocating the full strip."""

import io
import json
import re
import zipfile
from pathlib import Path
from unittest import mock

from PIL import Image

from mio_server.models import Dialogue, Episode, LetteringLayer, Panel, Series, Strip, Take
from mio_server.pipeline import episode_strip as ES
from mio_server.pipeline import file_export as F
from mio_server.pipeline import regions as R
from mio_server.pipeline import strip as SP

from .api_harness import ApiCase


class RegionExportTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.series = Series(title="Region")
        with Image.new("RGB", (100, 120), "#8fa9cc") as image:
            image.paste("#b93922", (20, 10, 55, 90))
            buf = io.BytesIO()
            image.save(buf, "PNG")
        asset = self.ctx.assets.put(buf.getvalue(), source="test")
        self.ep = Episode(
            series_id=self.series.id,
            order=0,
            title="Slices",
            panels=[
                Panel(id="a", order=0, width_mode="frameless", transition_background="#346>#fda"),
                Panel(id="b", order=1, width_mode="inset", transition_background="#333"),
            ],
            takes=[Take(panel_id=p, asset_id=asset.id, status="adopted") for p in ("a", "b")],
            strip=Strip(
                width=320,
                height=1300,
                panel_boxes={"a": (20, 180, 300, 510), "b": (35, 650, 275, 930)},
                crops={"a": (0.1, 0.1, 0.95, 0.9)},
                lettering=[
                    LetteringLayer(
                        panel_id="a",
                        text="A bridge",
                        kind="speech",
                        box=(70, 470, 270, 570),
                        tail_to=(160, 660),
                    ),
                    LetteringLayer(
                        panel_id="b",
                        text="BOOM",
                        kind="sfx",
                        box=(65, 690, 250, 800),
                        style={"rotation": 20},
                    ),
                    LetteringLayer(
                        panel_id="b", text="End", kind="caption", box=(60, 890, 290, 1010)
                    ),
                ],
            ),
        )
        self.path = Path(self.tmp) / "region-test.out"

    def test_regions_and_standalone_panels_match_full_composition(self):
        _, _, strip, full = ES.render_snapshot(self.ctx, self.series, self.ep)
        _, _, _, unlettered = ES.render_snapshot(self.ctx, self.series, self.ep, panel_images=True)
        with full, unlettered, R.prepare_snapshot(self.ctx, self.series, self.ep) as snapshot:
            self.assertTrue(snapshot.bounded)
            for top, bottom in ((0, 120), (120, 500), (500, 780), (780, strip.height)):
                with snapshot.render_region((0, top, strip.width, bottom)) as actual:
                    with full.crop((0, top, strip.width, bottom)) as expected:
                        self.assertEqual(actual.tobytes(), expected.tobytes())
            for pid, expected in ES.panel_crops(self.ep, strip, unlettered):
                with expected, snapshot.render_panel(pid) as actual:
                    self.assertEqual(actual.size, expected.size)
                    self.assertEqual(actual.tobytes(), expected.tobytes())

    def test_streamed_png_zip_pdf_and_html(self):
        with R.prepare_snapshot(self.ctx, self.series, self.ep) as snapshot:
            F.write_export(snapshot, "long", "long", self.path)
            with (
                Image.open(self.path) as png,
                snapshot.render_region((0, 0, 320, 1300)) as expected,
            ):
                self.assertEqual(png.tobytes(), expected.tobytes())
            for fmt in ("slices", "pdf", "html"):
                progress = []
                F.write_export(
                    snapshot,
                    fmt,
                    "webtoon",
                    self.path,
                    progress=lambda done, total: progress.append((done, total)),
                )
                self.assertEqual(progress[-1][0], progress[-1][1])
                if fmt == "slices":
                    with zipfile.ZipFile(self.path) as z:
                        manifest = json.loads(z.read("manifest.json"))
                        self.assertEqual(len(manifest["files"]), manifest["count"])
                        self.assertEqual(sum(f["height"] for f in manifest["files"]), 3250)
                elif fmt == "pdf":
                    data = self.path.read_bytes()
                    self.assertEqual(len(re.findall(rb"/Type /Page\s", data)), progress[-1][1])
                    start = int(re.search(rb"startxref\n(\d+)", data)[1])
                    self.assertEqual(data[start : start + 4], b"xref")
                else:
                    self.assertIn("data:image/jpeg;base64,", self.path.read_text(encoding="utf-8"))

    def test_noninteger_scaled_slices_match_global_sampling(self):
        _, _, strip, full = ES.render_snapshot(self.ctx, self.series, self.ep)
        with full, R.prepare_snapshot(self.ctx, self.series, self.ep) as snapshot:
            with full.resize(
                (437, round(full.height * 437 / full.width)), Image.Resampling.LANCZOS
            ) as expected:
                with F.render_slice(snapshot, 437, 413, 1007) as actual:
                    with expected.crop((0, 413, 437, 1007)) as region:
                        # Pillow's fractional box path can round a filter coefficient by one.
                        differences = [
                            abs(a - b) for a, b in zip(actual.tobytes(), region.tobytes())
                        ]
                        self.assertLessEqual(max(differences), 1)

    def test_long_strip_bounds_allocations_and_cancel_removes_partial(self):
        ep = self.ep.model_copy(deep=True)
        ep.strip.height = 100_000
        ep.strip.lettering = []
        sizes = []
        new = Image.new

        def allocated(mode, size, *args, **kwargs):
            sizes.append(size)
            return new(mode, size, *args, **kwargs)

        with R.prepare_snapshot(self.ctx, self.series, ep) as snapshot:
            with (
                mock.patch.object(Image, "new", side_effect=allocated),
                mock.patch.object(SP, "render", side_effect=AssertionError("full render")),
            ):
                F.write_export(snapshot, "long", "long", self.path)
            self.assertLessEqual(max(w * h for w, h in sizes), 320 * 512)

            def stop(done, total):
                raise RuntimeError("cancelled")

            with self.assertRaisesRegex(RuntimeError, "cancelled"):
                F.write_export(snapshot, "long", "long", self.path, progress=stop)
            self.assertFalse(self.path.exists())

    def test_custom_layout_is_called_and_marked_unbounded(self):
        calls = []

        def custom(*args, **kwargs):
            calls.append(1)
            return SP.layout(*args, **kwargs)

        self.ctx.registry.register(
            "layout", "strip.default", custom, replace=True, source="ext:test"
        )
        with R.prepare_snapshot(self.ctx, self.series, self.ep) as snapshot:
            self.assertFalse(snapshot.bounded)
            with snapshot.render_panel("a") as image:
                self.assertGreater(image.width, 0)
        self.assertEqual(calls, [1])

    def test_stale_layout_matches_and_saved_geometry_loads_images_lazily(self):
        ep = self.ep.model_copy(deep=True)
        ep.strip = Strip(width=320)
        ep.panels[0].dialogues = [Dialogue(text="Hello there"), Dialogue(text="Next", bridge=True)]
        _, _, expected_strip, full = ES.render_snapshot(self.ctx, self.series, ep)
        with full, R.prepare_snapshot(self.ctx, self.series, ep) as snapshot:
            exclude = {"lettering": {"__all__": {"id"}}}
            self.assertEqual(
                snapshot.strip.model_dump(exclude=exclude),
                expected_strip.model_dump(exclude=exclude),
            )
            with snapshot.render_region((0, 0, 320, full.height)) as image:
                self.assertEqual(image.tobytes(), full.tobytes())
        with mock.patch.object(self.ctx.assets, "read", wraps=self.ctx.assets.read) as read:
            with R.prepare_snapshot(self.ctx, self.series, self.ep) as snapshot:
                self.assertEqual(read.call_count, 0)
                with snapshot.render_region((0, 180, 320, 300)):
                    pass
                self.assertEqual(read.call_count, 1)

    def test_many_panels_release_previous_image_and_pdf_closes_iterator_on_cancel(self):
        ep = self.ep.model_copy(deep=True)
        asset = ep.takes[0].asset_id
        ep.panels = [Panel(id=str(i), order=i) for i in range(120)]
        ep.takes = [Take(panel_id=p.id, asset_id=asset, status="adopted") for p in ep.panels]
        ep.strip = Strip(
            width=320,
            height=120_500,
            panel_boxes={
                p.id: (0, 200 + i * 1000, 320, 1000 + i * 1000) for i, p in enumerate(ep.panels)
            },
        )
        with R.prepare_snapshot(self.ctx, self.series, ep) as snapshot:
            previous = None
            for panel in ep.panels:
                current = snapshot.images[panel.id]
                if previous:
                    with self.assertRaises(ValueError):
                        previous.getpixel((0, 0))
                previous = current
        released = []

        def images():
            try:
                yield Image.new("RGB", (20, 30), "red")
                yield Image.new("RGB", (20, 30), "blue")
            finally:
                released.append(True)

        def cancel(done):
            raise RuntimeError("cancelled")

        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            F.write_pdf(images(), self.path, progress=cancel)
        self.assertEqual(released, [True])

    def test_overlapping_panels_and_outside_canvas_match_crop(self):
        ep = self.ep.model_copy(deep=True)
        ep.strip.panel_boxes = {"a": (-20, -30, 210, 330), "b": (140, 210, 400, 470)}
        _, _, strip, full = ES.render_snapshot(self.ctx, self.series, ep, panel_images=True)
        with full, R.prepare_snapshot(self.ctx, self.series, ep) as snapshot:
            for pid, expected in ES.panel_crops(ep, strip, full):
                with expected, snapshot.render_panel(pid) as actual:
                    self.assertEqual(actual.tobytes(), expected.tobytes())
