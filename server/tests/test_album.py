"""P5: album template engine (port of the legacy 画册模板) and HTML album export."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from PIL import Image

from mio_server.album.build import data_url, palette
from mio_server.album.render import AlbumOptions, Book, Frame, render_album
from mio_server.album.templates import TemplateError, builtin_templates, parse_template

from .api_harness import ApiCase

BUILTIN = Path(__file__).resolve().parents[1] / "mio_server" / "album" / "builtin"
MINIMAL = (
    "<!DOCTYPE html><html><head><title>{{title}}</title></head><body>"
    "{{#books}}<section data-cc-book><div data-cc-pages>{{#frames}}"
    '<figure data-cc-frame><img src="{{image}}"><figcaption data-cc-caption>{{caption}}'
    "</figcaption></figure>{{/frames}}</div></section>{{/books}}</body></html>"
)


def books() -> list[Book]:
    red = data_url(Image.new("RGB", (64, 96), "#c0392b"), 1400)
    blue = data_url(Image.new("RGB", (64, 96), "#2e86de"), 1400)
    first = [
        Frame(red, name="第 1 格", caption="<b>{{title}}</b> & 你好", prompt="1girl, rain"),
        Frame(blue, name="第 2 格", caption="林：走吧"),
        Frame(red, name="第 3 格"),  # same image → one shared asset
    ]
    return [Book("雨夜", first, synopsis="便利店"), Book("第二话", [Frame("", name="第 1 格")])]


def metadata(doc: str) -> dict:
    raw = re.search(r'<script id="mio-album-data" type="application/json">(.*?)</script>', doc)
    return json.loads(raw.group(1))


class TemplateTests(unittest.TestCase):
    def test_every_builtin_renders_offline_and_safely(self):
        templates = builtin_templates()
        self.assertEqual(len(templates), 7)
        for tpl in templates:
            with self.subTest(tpl.id):
                doc = render_album(tpl, books(), AlbumOptions(show_prompts=True, signature="Mio"))
                self.assertNotIn("{{", doc.split('<script id="mio-album-data"')[0])
                if "{{caption}}" in tpl.html:  # captions are escaped, braces too
                    self.assertNotIn("<b>{{title}}", doc)
                    self.assertIn("&lt;b&gt;&#123;&#123;title&#125;&#125;", doc)
                nonce = re.search(r"script-src 'nonce-([0-9a-f]+)'", doc).group(1)
                self.assertIn(f'<script nonce="{nonce}">', doc)
                self.assertNotIn("http://", doc.split("</head>")[0].replace("http://www.w3", ""))
                self.assertIn(f'data-layout="{tpl.layout}"', doc)
                meta = metadata(doc)
                self.assertEqual(meta["schema"], "mio.album-html.v1")
                steps = meta["books"][0]["album"]["steps"]
                self.assertEqual(steps[0]["image"], steps[2]["image"])
                self.assertEqual(meta["books"][1]["album"]["steps"][0]["image"], "")
                key = steps[1]["image"]["$mioImage"]
                self.assertEqual(len(re.findall(f'data-mio-asset="{key}"', doc)), 1)

    def test_captions_and_prompts_can_be_hidden(self):
        tpl = parse_template({"id": "mini", "title": "迷你", "html": MINIMAL})
        doc = render_album(tpl, books(), AlbumOptions(show_captions=False))
        self.assertNotIn("林：走吧", doc)
        self.assertNotIn("1girl", doc)

    def test_validation(self):
        base = {"id": "t", "title": "T", "html": MINIMAL}
        parse_template(base)
        for broken in (
            MINIMAL.replace("</body>", "<script>alert(1)</script></body>"),
            MINIMAL.replace("{{image}}", "x"),
            MINIMAL.replace("{{#books}}", "").replace("{{/books}}", ""),
        ):
            with self.assertRaises(TemplateError):
                parse_template({**base, "html": broken})
        with self.assertRaises(TemplateError):
            parse_template({**base, "assets": {"bg": "https://example.com/x.png"}})

    def test_palette_is_dominant_first(self):
        im = Image.new("RGB", (40, 40), "#ffffff")
        im.paste(Image.new("RGB", (40, 10), "#000000"), (0, 0))
        self.assertEqual(palette(im)[0], "#ffffff")


class AlbumApiTests(ApiCase):
    def test_export_album_lettered_and_raw(self):
        _, ep = self.make_episode()
        ep = self.adopt_all(ep)
        body = {"episode_ids": [ep["id"]], "template_id": "export-ink", "title": "雨夜合集"}
        res = self.ok(self.client.post("/api/export/album", json=body))
        self.assertIn("text/html", res.headers["content-type"])
        self.assertIn("filename*=UTF-8''", res.headers["content-disposition"])
        doc = res.text
        panels = len(ep["panels"])
        steps = metadata(doc)["books"][0]["album"]["steps"]
        self.assertEqual(len(steps), panels)
        self.assertTrue(all(s["image"] for s in steps))
        raw = self.ok(self.client.post("/api/export/album", json={**body, "lettered": False}))
        self.assertIn("data:image/jpeg;base64,", raw.text)
        missing = self.client.post("/api/export/album", json={**body, "template_id": "nope"})
        self.assertEqual(missing.status_code, 404)

    def test_template_import_list_delete(self):
        listed = {t["id"]: t for t in self.ok(self.client.get("/api/album-templates"))}
        self.assertEqual(listed["export-flip"]["layout"], "flip")
        legacy = json.loads((BUILTIN / "export-paper.json").read_text(encoding="utf-8"))
        legacy_copy = {**legacy, "id": "my-paper", "title": "我的纸本"}
        created = self.ok(self.client.post("/api/album-templates", json=legacy_copy), 201)
        self.assertEqual(created["source"], "user")
        full = self.ok(self.client.get("/api/album-templates/my-paper"))
        self.assertEqual(full["html"], legacy["html"])
        clash = self.client.post("/api/album-templates", json=legacy)  # builtin id
        self.assertEqual(clash.status_code, 400)
        self.assertEqual(self.client.delete("/api/album-templates/export-paper").status_code, 400)
        self.ok(self.client.delete("/api/album-templates/my-paper"), 204)
        self.assertNotIn(
            "my-paper", {t["id"] for t in self.ok(self.client.get("/api/album-templates"))}
        )


if __name__ == "__main__":
    unittest.main()
