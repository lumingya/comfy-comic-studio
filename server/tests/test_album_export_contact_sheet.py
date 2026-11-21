"""Contract tests for the built-in film contact-sheet album template."""

from __future__ import annotations

import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image

from mio_server.album.build import data_url
from mio_server.album.render import AlbumOptions, Book, Frame, render_album
from mio_server.album.templates import parse_template

TEMPLATE_PATH = (
    Path(__file__).resolve().parents[1]
    / "mio_server"
    / "album"
    / "builtin"
    / "export-contact-sheet.json"
)


class ContactSheetDocument(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.classes: list[str] = []
        self.images: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        values = dict(attrs)
        self.classes.extend(values.get("class", "").split())
        if tag == "img":
            self.images.append(values)


def contact_template():
    return parse_template(json.loads(TEMPLATE_PATH.read_text(encoding="utf-8")))


def sample_book() -> Book:
    red = data_url(Image.new("RGB", (64, 96), "#c0392b"), 1400)
    blue = data_url(Image.new("RGB", (96, 64), "#2e86de"), 1400)
    return Book(
        "雨夜 <script>alert(1)</script>",
        [
            Frame(red, name="第 1 幕 <img>", caption='台词："先等等" & 看路', width=64, height=96),
            Frame(blue, name="第 2 幕", caption="结尾 {变量}", width=96, height=64),
        ],
        synopsis="街灯下的一次短暂停留",
    )


class ContactSheetTemplateTests(unittest.TestCase):
    def test_template_is_valid_offline_and_has_contact_sheet_layout(self):
        template = contact_template()

        self.assertEqual(template.id, "export-contact-sheet")
        self.assertEqual(template.formatVersion, 1)
        self.assertEqual(template.layout, "contact")
        self.assertIn("联系表", template.description)
        self.assertIn("grid-template-columns:repeat(auto-fit", template.html)
        self.assertIn("@media print", template.html)
        self.assertIn("@media(max-width:680px)", template.html)
        self.assertIn("film-rail", template.html)
        self.assertIn("data-cc-pages", template.html)
        self.assertIn("data-cc-frame", template.html)
        self.assertNotRegex(template.html, re.compile(r"<\s*script\b", re.IGNORECASE))
        self.assertNotRegex(template.html, re.compile(r"<\s*link\b", re.IGNORECASE))
        self.assertNotRegex(template.html, re.compile(r"@import|url\(\s*https?://", re.IGNORECASE))

    def test_render_escapes_text_and_preserves_reimport_metadata(self):
        template = contact_template()
        source = sample_book()
        rendered = render_album(
            template,
            [source],
            AlbumOptions(show_prompts=True, signature="Mio & <press>"),
        )

        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", rendered)
        self.assertIn("&lt;img&gt;", rendered)
        self.assertIn("&#123;变量&#125;", rendered)
        self.assertNotIn("<script>alert(1)</script>", rendered)
        self.assertIn("Mio &amp; &lt;press&gt;", rendered)

        parser = ContactSheetDocument()
        parser.feed(rendered)
        self.assertEqual(parser.classes.count("contact-sheet"), 1)
        self.assertEqual(parser.classes.count("frame"), 2)
        self.assertEqual(len(parser.images), 2)
        self.assertTrue(all(image.get("data-mio-asset") for image in parser.images))

        raw = re.search(
            r'<script id="mio-album-data" type="application/json">(.*?)</script>',
            rendered,
        )
        self.assertIsNotNone(raw)
        metadata = json.loads(raw.group(1))
        self.assertEqual(metadata["schema"], "mio.album-html.v1")
        steps = metadata["books"][0]["album"]["steps"]
        self.assertEqual([step["name"] for step in steps], [frame.name for frame in source.frames])
        self.assertEqual(
            [step["caption"] for step in steps], [frame.caption for frame in source.frames]
        )
        self.assertEqual([step["width"] for step in steps], [64, 96])
        self.assertTrue(all(isinstance(step["image"], dict) for step in steps))


if __name__ == "__main__":
    unittest.main()
