"""Focused contract checks for the independently published offline zine template."""

from __future__ import annotations

import json
import re
import unittest

from mio_server.album.render import AlbumOptions, Book, Frame, render_album
from mio_server.album.templates import builtin_templates, parse_template


class ZineTemplateTests(unittest.TestCase):
    def test_template_is_offline_editorial_and_keeps_round_trip_data(self):
        template = next(item for item in builtin_templates() if item.id == "export-zine")
        self.assertEqual(template.formatVersion, 1)
        self.assertEqual(template.layout, "editorial")
        self.assertIn("独立出版", template.description)
        self.assertIn("repeating-linear-gradient", template.html)
        self.assertIn("@media print", template.html)
        self.assertIn("@media(max-width:680px)", template.html)
        self.assertNotRegex(template.html, r"(?i)<\s*script\b|https?://")
        self.assertEqual(template.html.count("{{#books}}"), 1)
        self.assertEqual(template.html.count("{{#frames}}"), 1)

        document = render_album(
            template,
            [Book("小志标题", [Frame("", name="雨停", caption="一段手记")])],
            AlbumOptions(signature="作者"),
        )
        self.assertIn('data-layout="editorial"', document)
        self.assertIn("小志标题", document)
        self.assertIn("雨停", document)
        self.assertIn("一段手记", document)
        self.assertIn("MARGIN NOTE", document)
        self.assertIn("mio.album-html.v1", document)
        raw = re.search(
            r'<script id="mio-album-data" type="application/json">(.*?)</script>', document
        )
        payload = json.loads(raw.group(1))
        self.assertEqual(payload["books"][0]["album"]["title"], "小志标题")
        self.assertEqual(payload["books"][0]["album"]["steps"][0]["name"], "雨停")

    def test_template_validator_rejects_executable_custom_content(self):
        template = next(item for item in builtin_templates() if item.id == "export-zine")
        with self.assertRaises(ValueError):
            parse_template(
                {
                    **template.model_dump(),
                    "html": template.html.replace("</body>", "<script>alert(1)</script></body>"),
                }
            )


if __name__ == "__main__":
    unittest.main()
