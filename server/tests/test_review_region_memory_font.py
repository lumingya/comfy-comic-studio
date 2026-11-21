"""Region glyph phases must not copy/reopen in-memory FreeType fonts (R4-RENDER-FONT-01)."""

import builtins
import io
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from PIL import Image, ImageChops, ImageDraw, ImageFont

from mio_server.models import Episode, LetteringLayer, Series, Strip
from mio_server.pipeline import layout as LY
from mio_server.pipeline import regions as R
from mio_server.pipeline import strip as SP


class RegionMemoryFontTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.ttf = Path(folder.name) / "neutral.ttf"
        self.font_data = ImageFont.load_default(size=24).font_bytes
        self.ttf.write_bytes(self.font_data)

    @staticmethod
    def draw(font, origin=(0, 0), bottom=800, phase=0.375):
        top = origin[1]
        image = Image.new("RGB", (320, bottom - top), "white")
        draw = R._RegionDraw(image, origin)
        for y in (247 + phase, 501 + phase):
            draw.text(
                (17.625 - origin[0], y - top),
                "Neutral glyph phase",
                font=font,
                fill="#152535",
                stroke_width=1,
                stroke_fill="#aabbcc",
            )
        return image

    def assert_font_bands(self, font):
        # Native ImageDraw is the reference; include negative local glyph origins in
        # the second and third bands and an odd seam at y=257.
        with Image.new("RGB", (320, 800), "white") as expected:
            draw = ImageDraw.Draw(expected)
            for y in (247.375, 501.375):
                draw.text(
                    (17.625, y),
                    "Neutral glyph phase",
                    font=font,
                    fill="#152535",
                    stroke_width=1,
                    stroke_fill="#aabbcc",
                )
            with self.draw(font) as actual:
                self.assertIsNone(ImageChops.difference(actual, expected).getbbox())
            with Image.new("RGB", expected.size, "white") as joined:
                for top, bottom in ((0, 257), (257, 513), (513, 800)):
                    with self.draw(font, (0, top), bottom) as band:
                        joined.paste(band, (0, top))
                self.assertIsNone(ImageChops.difference(joined, expected).getbbox())

    def test_default_memory_font_regions_match_native_full_drawing(self):
        font = ImageFont.load_default(size=24)
        self.assertIsInstance(font.path, io.BytesIO)
        font.path.seek(0, io.SEEK_END)
        before = font.path.tell()
        self.assert_font_bands(font)
        self.assertEqual(font.path.tell(), before)

    def test_bytesio_ttf_regions_never_reopen_font(self):
        source = io.BytesIO(self.font_data)
        font = ImageFont.truetype(source, 24)
        source.seek(0, io.SEEK_END)
        with mock.patch.object(
            ImageFont.FreeTypeFont, "__init__", side_effect=AssertionError("font reopened")
        ):
            self.assert_font_bands(font)
        self.assertEqual(source.tell(), len(self.font_data))

    def test_file_ttf_regions_never_reopen_font(self):
        font = ImageFont.truetype(str(self.ttf), 24)
        with mock.patch.object(
            ImageFont.FreeTypeFont, "__init__", side_effect=AssertionError("font reopened")
        ):
            self.assert_font_bands(font)

    def test_concurrent_shared_memory_font_keeps_original_method_and_phase(self):
        font = ImageFont.truetype(io.BytesIO(self.font_data), 24)
        original_method = font.getmask2
        original_state = dict(font.__dict__)
        phases = (0.125, 0.375, 0.625, 0.875) * 2
        expected = []
        for phase in phases:
            with self.draw(font, phase=phase) as image:
                expected.append(image.tobytes())
        ready = threading.Barrier(len(phases))

        def render(phase):
            ready.wait(timeout=10)
            self.assertEqual(font.getmask2, original_method)
            with self.draw(font, phase=phase) as image:
                result = image.tobytes()
            self.assertEqual(font.getmask2, original_method)
            self.assertEqual(font.__dict__, original_state)
            return result

        with ThreadPoolExecutor(max_workers=len(phases)) as pool:
            results = list(pool.map(render, phases))
        self.assertEqual(results, expected)
        self.assertEqual(font.getmask2, original_method)
        self.assertEqual(font.__dict__, original_state)

    def test_multiline_text_preserves_native_alignment_and_phase(self):
        font = ImageFont.load_default(size=24)
        text = "Neutral title\nA short line\nLonger neutral lettering"
        for align in ("left", "center", "right"):
            with self.subTest(align=align):
                options = {
                    "font": font,
                    "fill": "#152535",
                    "anchor": "ma",
                    "spacing": 4.5,
                    "align": align,
                    "stroke_width": 1,
                }
                with Image.new("RGB", (320, 800), "white") as expected:
                    ImageDraw.Draw(expected).multiline_text((160.625, 242.375), text, **options)
                    with Image.new("RGB", expected.size, "white") as joined:
                        for top, bottom in ((0, 257), (257, 513), (513, 800)):
                            with Image.new("RGB", (320, bottom - top), "white") as band:
                                R._RegionDraw(band, (0, top)).multiline_text(
                                    (160.625, 242.375 - top), text, **options
                                )
                                joined.paste(band, (0, top))
                        self.assertIsNone(ImageChops.difference(joined, expected).getbbox())

    def test_recursive_multiline_path_receives_original_font_per_line(self):
        font = ImageFont.load_default(size=24)
        text = "Neutral title\nAnother line\nLast line"
        forwarded = []

        def legacy_multiline(draw, xy, text, fill, current_font, *args, **kwargs):
            self.assertIs(current_font, font)
            forwarded.append(current_font)
            for i, line in enumerate(text.split("\n")):
                draw.text((xy[0], xy[1] + 31.5 * i), line, fill, current_font)

        def old_layout_lookup(obj, name, *default):
            if obj is ImageDraw and name == "ImageText":
                return None
            return builtins.getattr(obj, name, *default)

        with Image.new("RGB", (320, 800), "white") as expected:
            native = ImageDraw.Draw(expected)
            for i, line in enumerate(text.split("\n")):
                native.text((17.625, 247.375 + 31.5 * i), line, font=font, fill="black")
            with (
                mock.patch.object(R, "getattr", side_effect=old_layout_lookup, create=True),
                mock.patch.object(ImageDraw.ImageDraw, "multiline_text", new=legacy_multiline),
            ):
                with Image.new("RGB", expected.size, "white") as joined:
                    for top, bottom in ((0, 257), (257, 513), (513, 800)):
                        with Image.new("RGB", (320, bottom - top), "white") as band:
                            R._RegionDraw(band, (0, top)).text(
                                (17.625, 247.375 - top), text, "black", font
                            )
                            joined.paste(band, (0, top))
                    self.assertIsNone(ImageChops.difference(joined, expected).getbbox())
            self.assertEqual(len(forwarded), 3)

    def test_no_system_fonts_snapshot_bands_match_full_compositor(self):
        series = Series(title="Memory font")
        episode = Episode(
            series_id=series.id,
            title="Neutral\nphase",
            order=0,
            strip=Strip(
                width=320,
                height=900,
                lettering=[
                    LetteringLayer(
                        kind="speech",
                        text="Neutral speech",
                        box=(20.5, 241.5, 300.5, 321.5),
                        tail_to=(180.5, 360.5),
                    ),
                    LetteringLayer(
                        kind="thought",
                        text="Neutral thought",
                        box=(20.5, 470.5, 300.5, 540.5),
                        tail_to=(180.5, 580.5),
                    ),
                    LetteringLayer(
                        kind="caption", text="Neutral caption", box=(20.5, 580.5, 300.5, 620.5)
                    ),
                ],
            ),
        )
        with mock.patch.object(LY, "find_font", return_value=None):
            with R.RenderSnapshot(series, episode, episode.strip, {}) as snapshot:
                self.assertTrue(
                    all(isinstance(font.path, io.BytesIO) for font in snapshot.fonts.values())
                )
                with SP.render(series, episode, episode.strip, {}) as expected:
                    with Image.new("RGB", expected.size) as joined:
                        for top, bottom in ((0, 257), (257, 513), (513, 900)):
                            with snapshot.render_region((0, top, 320, bottom)) as band:
                                joined.paste(band, (0, top))
                        self.assertIsNone(ImageChops.difference(joined, expected).getbbox())
