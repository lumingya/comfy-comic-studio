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
        # 模板工作室: an unsaved draft previews without being stored; broken drafts are refused.
        draft = {
            "id": "draft",
            "title": "草稿",
            "html": MINIMAL.replace("<body>", "<body>草稿标记"),
        }
        inline = self.ok(self.client.post("/api/export/album", json={**body, "template": draft}))
        self.assertIn("草稿标记", inline.text)
        self.assertNotIn(
            "draft", {t["id"] for t in self.ok(self.client.get("/api/album-templates"))}
        )
        bad = {**draft, "html": MINIMAL.replace("{{image}}", "")}
        self.assertEqual(
            self.client.post("/api/export/album", json={**body, "template": bad}).status_code, 400
        )

    def test_book_text_uses_album_variables_like_legacy(self):
        """The cover resolves {变量} in the synopsis (unknown names stay, as in prompts), 主演 is
        the preset's 展示名, and — like legacy books — the cover title is the album's own name
        while CHAPTER shows the story's."""
        series, ep = self.make_episode()
        self.ctx.store.update_series(
            series["id"],
            lambda s: setattr(s, "variables", {"character_display_name": "七海", "style": "水彩"}),
        )
        self.ctx.store.update_episode(
            ep["id"],
            lambda e: setattr(e, "synopsis", "{character_display_name}的夏天，{style}，{unknown}"),
        )
        probe = MINIMAL.replace(
            "<section data-cc-book>",
            "<section data-cc-book><p id=probe>{{title}}|{{storyTitle}}|{{synopsis}}|{{characterName}}</p>",
        )
        body = {
            "episode_ids": [ep["id"]],
            "template": {"id": "probe", "title": "探针", "html": probe},
        }
        doc = self.ok(self.client.post("/api/export/album", json=body)).text
        text = re.search(r"<p id=probe>(.*?)</p>", doc).group(1)
        title, story, synopsis, starring = text.split("|")
        self.assertEqual(title, "雨夜便利店")
        self.assertEqual(story, ep["title"])
        self.assertEqual(synopsis, "七海的夏天，水彩，&#123;unknown&#125;")
        self.assertEqual(starring, "七海")
        self.assertEqual(
            metadata(doc)["books"][0]["album"]["synopsis"], "七海的夏天，水彩，{unknown}"
        )

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


class MediaTests(unittest.TestCase):
    """The legacy「图片处理」profiles."""

    def png_with_workflow(self) -> bytes:
        import io

        from PIL import PngImagePlugin

        info = PngImagePlugin.PngInfo()
        info.add_text("workflow", '{"nodes": []}')
        info.add_text("prompt", "1girl")
        buf = io.BytesIO()
        Image.new("RGB", (32, 48), "#336699").save(buf, "PNG", pnginfo=info)
        return buf.getvalue()

    def test_clean_png_drops_metadata_and_keeps_pixels(self):
        import io

        from mio_server.album import media as M

        src = self.png_with_workflow()
        out = M.scrub(src)
        self.assertIn(b"workflow", src)
        self.assertNotIn(b"workflow", out)
        with Image.open(io.BytesIO(src)) as a, Image.open(io.BytesIO(out)) as b:
            self.assertEqual(a.convert("RGB").tobytes(), b.convert("RGB").tobytes())
            self.assertEqual(b.info.get("prompt"), None)

    def test_clean_jpeg_and_webp_drop_exif(self):
        import io

        from mio_server.album import media as M

        exif = Image.Exif()
        exif[0x010E] = "workflow-secret"  # ImageDescription
        for fmt in ("JPEG", "WEBP"):
            with self.subTest(fmt):
                buf = io.BytesIO()
                Image.new("RGB", (40, 40), "#aa3355").save(buf, fmt, exif=exif.tobytes())
                src = buf.getvalue()
                self.assertIn(b"workflow-secret", src)
                out = M.scrub(src)
                self.assertNotIn(b"workflow-secret", out)
                with Image.open(io.BytesIO(out)) as im:
                    im.load()
                    self.assertEqual(im.size, (40, 40))

    def test_profiles(self):
        from mio_server.album import media as M

        src = self.png_with_workflow()
        im = Image.new("RGB", (3000, 1000), "#ffffff")
        stats = M.Stats("clean")
        data, mime = M.process("clean", original=src, image=im, stats=stats)
        self.assertEqual((mime, stats.scrubbed), ("image/png", 1))
        self.assertNotIn(b"workflow", data)
        data, mime = M.process("archive", original=src, image=im, stats=stats)
        self.assertEqual(data, src)
        data, mime = M.process("publish", original=src, image=im, stats=stats)
        self.assertEqual(mime, "image/webp")
        import io

        with Image.open(io.BytesIO(data)) as out:
            self.assertEqual(max(out.size), M.PUBLISH_MAX_SIDE)
        data, mime = M.process("clean", original=None, image=im, stats=stats)  # lettered crop
        self.assertEqual(mime, "image/png")
        self.assertEqual(json.loads(stats.header())["count"], 4)


class ExportChannelTests(ApiCase):
    def test_album_image_profiles_report_what_they_did(self):
        _, ep = self.make_episode()
        ep = self.adopt_all(ep)
        body = {"episode_ids": [ep["id"]], "template_id": "export-ink", "lettered": False}
        for profile, mime in (("clean", None), ("publish", "image/webp"), ("archive", None)):
            with self.subTest(profile):
                res = self.ok(
                    self.client.post("/api/export/album", json={**body, "image_profile": profile})
                )
                report = json.loads(res.headers["x-mio-export"])
                self.assertEqual(report["profile"], profile)
                self.assertEqual(report["count"], len(ep["panels"]))
                if mime:
                    self.assertIn(f"data:{mime};base64,", res.text)
        auto = self.ok(
            self.client.post("/api/export/album", json={**body, "image_profile": "auto"})
        )
        self.assertEqual(json.loads(auto.headers["x-mio-export"])["profile"], "clean")
        self.assertFalse(json.loads(auto.headers["x-mio-export"])["auto_compressed"])

    def test_portable_zip_and_pdf(self):
        import io
        import zipfile

        _, ep = self.make_episode()
        ep = self.adopt_all(ep)
        body = {"episode_ids": [ep["id"]], "title": "雨夜"}
        res = self.ok(self.client.post("/api/export/portable", json={**body, "format": "zip"}))
        self.assertIn(".zip", res.headers["content-disposition"])
        names = zipfile.ZipFile(io.BytesIO(res.content)).namelist()
        self.assertIn("index.html", names)
        self.assertIn("manifest.json", names)
        self.assertEqual(len([n for n in names if n.startswith("images/")]), len(ep["panels"]))
        pdf = self.ok(
            self.client.post(
                "/api/export/portable", json={**body, "format": "pdf", "image_profile": "publish"}
            )
        )
        self.assertTrue(pdf.content.startswith(b"%PDF"))
        self.assertEqual(json.loads(pdf.headers["x-mio-export"])["profile"], "publish")

    def test_slice_plan_and_quality(self):
        _, ep = self.make_episode()
        ep = self.adopt_all(ep)
        plan = self.ok(self.client.get(f"/api/episodes/{ep['id']}/slices?preset=kuaikan"))
        self.assertEqual((plan["preset"], plan["width"]), ("kuaikan", 750))
        self.assertEqual(sum(plan["heights"]), plan["height"])
        self.assertTrue(all(h <= 1500 for h in plan["heights"]))
        url = f"/api/episodes/{ep['id']}/export?fmt=long"
        self.assertEqual(self.ok(self.client.get(url)).headers["content-type"], "image/png")
        lossy = self.ok(self.client.get(url + "&quality=80"))
        self.assertEqual(lossy.headers["content-type"], "image/jpeg")
        lossless = self.ok(self.client.get(f"/api/episodes/{ep['id']}/export?fmt=slices&quality=0"))
        import io
        import zipfile

        names = zipfile.ZipFile(io.BytesIO(lossless.content)).namelist()
        self.assertTrue(any(n.endswith(".png") for n in names))
