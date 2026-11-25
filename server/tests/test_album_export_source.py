"""Opt-in HTML reading sources preserve metadata without weakening sharing defaults."""

from __future__ import annotations

import base64
import io
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from mio_server import album_interchange as interchange
from mio_server.album import build
from mio_server.album.render import AlbumOptions, Book, Frame, render_album, write_album
from mio_server.album.templates import parse_template
from mio_server.models import (
    Dialogue,
    Episode,
    LetteringLayer,
    Panel,
    PanelOverrides,
    Series,
    Strip,
    Take,
)

from .api_harness import ApiCase

TEMPLATE = parse_template(
    {
        "id": "source-probe",
        "title": "Source probe",
        "html": (
            "<!doctype html><html><head><title>{{title}}</title></head><body>"
            "{{#books}}<section data-cc-book><div data-cc-pages>{{#frames}}"
            '<figure data-cc-frame><img src="{{image}}"><p data-cc-caption>{{caption}}</p>'
            "<p data-cc-prompt>{{prompt}}</p></figure>{{/frames}}</div></section>"
            "{{/books}}</body></html>"
        ),
    }
)


def metadata(document):
    return json.loads(
        re.search(r'<script id="mio-album-data"[^>]*>(.*?)</script>', document, re.S)[1]
    )


def image_bytes(color="red"):
    out = io.BytesIO()
    with Image.new("RGB", (16, 24), color) as image:
        image.save(out, "PNG")
    return out.getvalue()


def image_url(data):
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


class AlbumSourceRenderTests(unittest.TestCase):
    def setUp(self):
        self.data = image_bytes()
        self.image = image_url(self.data)
        self.opts = AlbumOptions(show_captions=False, show_prompts=False, include_source_data=True)

    def book(self, **changes):
        return Book("A book", [Frame(self.image, width=16, height=24, **changes)])

    def test_default_hidden_captions_and_prompts_are_absent_from_the_entire_document(self):
        book = self.book(
            caption="display-secret", source_caption="full-caption-secret", prompt="prompt-secret"
        )
        document = render_album(TEMPLATE, [book], AlbumOptions(show_captions=False))
        for hidden in ("display-secret", "full-caption-secret", "prompt-secret", "sourceData"):
            self.assertNotIn(hidden, document)
        self.assertNotIn("prompt", metadata(document)["books"][0]["album"]["steps"][0])

    def test_opt_in_keeps_full_text_and_shared_image_references_without_base64_copies(self):
        frame = Frame(
            self.image,
            name="  Name\n ",
            caption="display",
            source_caption="  Full <&>\n ",
            prompt="  Prompt {literal}\n ",
            width=16,
            height=24,
        )
        books = [
            Book(
                "  Title  ",
                [frame, frame, Frame("", name="Missing")],
                synopsis=" Synopsis\n ",
                character_name=" Cast ",
                story_title=" Story ",
            )
        ]
        default = render_album(TEMPLATE, books, AlbumOptions(show_captions=False))
        document = render_album(TEMPLATE, books, self.opts)
        payload = metadata(document)
        source = payload["sourceData"]
        self.assertEqual(source["schema"], "mio.album-source.v1")
        book = source["books"][0]
        self.assertEqual(
            (book["title"], book["synopsis"], book["characterName"], book["storyTitle"]),
            ("  Title  ", " Synopsis\n ", " Cast ", " Story "),
        )
        self.assertEqual(book["frames"][0]["caption"], "  Full <&>\n ")
        self.assertEqual(book["frames"][0]["prompt"], "  Prompt {literal}\n ")
        self.assertEqual(book["frames"][0]["name"], "  Name\n ")
        self.assertEqual(book["frames"][0]["image"], book["frames"][1]["image"])
        self.assertEqual(book["frames"][2]["image"], "")
        self.assertEqual(
            book["frames"][0]["image"], payload["books"][0]["album"]["steps"][0]["image"]
        )
        self.assertEqual(document.count(self.image), default.count(self.image))
        self.assertNotIn(self.image, json.dumps(source))
        self.assertEqual(payload["books"][0]["album"]["steps"][0]["caption"], "")

    def test_source_json_cannot_end_its_script_block(self):
        attack = '</script><script>alert("x")</script>&'
        document = render_album(TEMPLATE, [self.book(source_caption=attack)], self.opts)
        self.assertNotIn(attack, document)
        self.assertEqual(
            metadata(document)["sourceData"]["books"][0]["frames"][0]["caption"], attack
        )

    def test_book_and_total_frame_limits_apply_only_to_opt_in(self):
        for constant, books in (
            ("MAX_BOOKS", [self.book(), self.book()]),
            ("MAX_FRAMES", [Book("Many", [Frame(self.image), Frame(self.image)])]),
        ):
            with self.subTest(constant), mock.patch.object(interchange, constant, 1):
                with self.assertRaisesRegex(ValueError, "count limit"):
                    render_album(TEMPLATE, books, self.opts)
                render_album(TEMPLATE, books)

    def test_image_bytes_pixels_mime_and_dimensions_use_the_import_contract(self):
        for constant, limit, message in (
            ("MAX_IMAGE_BYTES", len(self.data) - 1, "byte limit"),
            ("MAX_IMAGE_PIXELS", 16 * 24 - 1, "pixel limit"),
            ("MAX_TOTAL_IMAGE_BYTES", len(self.data) - 1, "total image byte"),
        ):
            with self.subTest(constant), mock.patch.object(interchange, constant, limit):
                with self.assertRaisesRegex(ValueError, message):
                    render_album(TEMPLATE, [self.book()], self.opts)
        with self.assertRaisesRegex(ValueError, "MIME"):
            render_album(
                TEMPLATE,
                [Book("Bad", [Frame(self.image.replace("image/png", "image/jpeg"))])],
                self.opts,
            )
        with self.assertRaisesRegex(ValueError, "dimensions"):
            render_album(
                TEMPLATE, [Book("Bad", [Frame(self.image, width=32, height=24)])], self.opts
            )

    def test_unique_image_total_does_not_count_repeated_frames_twice(self):
        book = Book("Repeated", [Frame(self.image), Frame(self.image)])
        with mock.patch.object(interchange, "MAX_TOTAL_IMAGE_BYTES", len(self.data)):
            render_album(TEMPLATE, [book], self.opts)
        different = Book("Different", [Frame(self.image), Frame(image_url(image_bytes("blue")))])
        with mock.patch.object(interchange, "MAX_ASSETS", 1):
            with self.assertRaisesRegex(ValueError, "image count"):
                render_album(TEMPLATE, [different], self.opts)

    def test_metadata_limit_counts_escaped_utf8_bytes(self):
        book = self.book(source_caption="中文<&>")
        document = render_album(TEMPLATE, [book], self.opts)
        text = re.search(r'<script id="mio-album-data"[^>]*>(.*?)</script>', document, re.S)[1]
        size = len(text.encode("utf-8"))
        with mock.patch.object(interchange, "MAX_JSON_BYTES", size):
            render_album(TEMPLATE, [book], self.opts)
        with mock.patch.object(interchange, "MAX_JSON_BYTES", size - 1):
            with self.assertRaisesRegex(ValueError, "JSON byte"):
                render_album(TEMPLATE, [book], self.opts)

    def test_streaming_limit_counts_every_actual_base64_substitution_before_opening_output(self):
        with tempfile.TemporaryDirectory() as folder:
            image = Path(folder) / "frame.png"
            image.write_bytes(self.data)
            other = Path(folder) / "same.png"
            other.write_bytes(self.data)
            spooled = {
                "mio-spooled-first": ("image/png", image),
                "mio-spooled-second": ("image/png", other),
            }
            books = [Book("重复画面", [Frame(token) for token in spooled])]
            path = Path(folder) / "album.html"
            with mock.patch.object(interchange, "MAX_TOTAL_IMAGE_BYTES", len(self.data)):
                write_album(TEMPLATE, books, path, self.opts, spooled)
            size = path.stat().st_size
            self.assertEqual(path.read_text(encoding="utf-8").count(self.image), 2)
            with mock.patch.object(interchange, "MAX_HTML_BYTES", size):
                write_album(TEMPLATE, books, path, self.opts, spooled)
            path.write_text("untouched", encoding="utf-8")
            with mock.patch.object(interchange, "MAX_HTML_BYTES", size - 1):
                with self.assertRaisesRegex(ValueError, "HTML byte"):
                    write_album(TEMPLATE, books, path, self.opts, spooled)
            self.assertEqual(path.read_text(encoding="utf-8"), "untouched")


class AlbumSourceExportApiTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.series = self.ctx.store.create_series(
            Series(title="Source book", variables={"hero": "Ada", "character_display_name": "Ada"})
        )
        self.asset = self.ctx.assets.put(image_bytes(), source="test")
        self.episode = self.ctx.store.create_episode(
            Episode(
                series_id=self.series.id,
                title="A chapter",
                synopsis="Resolved {hero}",
                order=0,
                panels=[
                    Panel(
                        id="first",
                        order=0,
                        dialogues=[Dialogue(kind="narration", text="First full caption")],
                        overrides=PanelOverrides(
                            raw_prompt="first positive, {hero}", raw_negative="negative-private"
                        ),
                    ),
                    Panel(
                        id="second",
                        order=1,
                        dialogues=[Dialogue(kind="narration", text="Second full caption")],
                        overrides=PanelOverrides(raw_prompt="second positive"),
                    ),
                ],
                takes=[
                    Take(panel_id=pid, asset_id=self.asset.id, status="adopted")
                    for pid in ("first", "second")
                ],
                strip=Strip(
                    width=320,
                    height=480,
                    margin=0,
                    manual=True,
                    panel_boxes={"first": (0, 20, 320, 180), "second": (0, 240, 320, 400)},
                    lettering=[
                        LetteringLayer(
                            panel_id="first",
                            kind="caption",
                            text="First full caption",
                            box=(20, 40, 300, 100),
                            font_size=16,
                        )
                    ],
                ),
            )
        )
        self.options = {
            "episode_ids": [self.episode.id],
            "image_profile": "clean",
            "deduplicate_captions": True,
            "show_captions": False,
            "show_prompts": False,
        }

    def test_opt_in_hidden_deduplicated_projection_compiles_each_panel_once(self):
        with mock.patch.object(build, "compile_panel", wraps=build.compile_panel) as compiled:
            document = self.ok(
                self.client.post(
                    "/api/export/album", json={**self.options, "include_source_data": True}
                )
            ).text
        self.assertEqual(compiled.call_count, 2)
        payload = metadata(document)
        legacy = payload["books"][0]["album"]
        source = payload["sourceData"]["books"][0]
        self.assertEqual(len(source["frames"]), 1)
        self.assertEqual(source["frames"][0]["caption"], "First full caption　Second full caption")
        self.assertEqual(source["frames"][0]["prompt"], "first positive, Ada\nsecond positive")
        self.assertEqual(source["frames"][0]["sourceRegion"], [0, 0, 320, 620])
        self.assertEqual(source["composition"], {"width": 320, "height": 620})
        self.assertEqual(
            (source["title"], source["synopsis"], source["characterName"], source["storyTitle"]),
            ("Source book", "Resolved Ada", "Ada", "A chapter"),
        )
        self.assertEqual(legacy["steps"][0]["caption"], "")
        self.assertNotIn("prompt", legacy["steps"][0])
        self.assertNotIn("negative-private", document)
        self.assertNotIn(self.asset.id, document)

    def test_default_and_background_export_respect_the_explicit_flag(self):
        document = self.ok(self.client.post("/api/export/album", json=self.options)).text
        self.assertNotIn("sourceData", document)
        self.assertNotIn("full caption", document)
        self.assertNotIn("first positive", document)
        job = self.ok(
            self.client.post(
                "/api/export/jobs/album", json={**self.options, "include_source_data": True}
            ),
            202,
        )
        self.drain(job)
        exported = self.ok(self.client.get(f"/api/export/jobs/{job['id']}/file")).text
        self.assertEqual(metadata(exported)["sourceData"]["schema"], "mio.album-source.v1")

    def test_originals_and_missing_images_keep_the_same_projection_with_source_data(self):
        self.ctx.store.update_episode(self.episode.id, lambda episode: episode.takes.pop())
        document = self.ok(
            self.client.post(
                "/api/export/album",
                json={**self.options, "lettered": False, "include_source_data": True},
            )
        ).text
        source = metadata(document)["sourceData"]["books"][0]
        self.assertNotIn("composition", source)
        self.assertEqual(len(source["frames"]), 2)
        self.assertEqual(source["frames"][1]["image"], "")
        self.assertEqual(source["frames"][1]["caption"], "Second full caption")
        self.assertEqual(source["frames"][1]["prompt"], "second positive")
