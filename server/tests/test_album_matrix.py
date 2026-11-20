"""All built-in templates preserve offline security and album interchange under extreme data."""

from __future__ import annotations

import base64
import io
import json
import re
import unittest
from copy import deepcopy
from dataclasses import asdict
from html.parser import HTMLParser

from PIL import Image

from mio_server.album.build import data_url
from mio_server.album.render import MISSING, AlbumOptions, Book, Frame, render_album, runtime
from mio_server.album.templates import builtin_templates, parse_template

ATTACK = '"><svg onload="alert(42)"></svg></script><script>alert(42)</script>{{title}} & 中文'
COLORS = ("#204060", "#a03c58", "#e4c47c")


class AlbumDocument(HTMLParser):
    def __init__(self, document: str):
        super().__init__(convert_charrefs=True)
        self.nodes: list[tuple[str, dict[str, str | None]]] = []
        self.scripts: list[tuple[dict[str, str | None], str]] = []
        self._script = None
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.nodes.append((tag, attrs))
        if tag == "script":
            self._script = (attrs, "")

    def handle_data(self, data):
        if self._script is not None:
            attrs, text = self._script
            self._script = (attrs, text + data)

    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            self.scripts.append(self._script)
            self._script = None


def sample_books(case: str) -> list[Book]:
    count = {"single": 1, "twelve": 12}.get(case, 4)
    images = [
        data_url(Image.new("RGB", size, COLORS[index % 3]), 1400)
        for index, size in enumerate(((32, 48), (80, 24), (24, 100), (40, 40)))
    ]
    frames = []
    for index in range(count):
        width, height = ((32, 48), (80, 24), (24, 100), (40, 40))[index % 4]
        frames.append(
            Frame(
                "" if case == "missing" and index % 2 == 0 else images[index % 4],
                name=f"Frame {index + 1} / 幕" + (ATTACK if case == "xss" else ""),
                caption=ATTACK if case == "xss" else f"第 {index + 1} 幕的台词 & caption",
                prompt=ATTACK if case == "xss" else f"neutral landscape, scene {index}",
                width=width,
                height=height,
                palette=list(COLORS),
            )
        )
    title = "极长标题 Long title · " * 100 if case == "long_title" else "Story · 第一话"
    if case == "xss":
        title = ATTACK
    first = Book(title, frames, synopsis=ATTACK if case == "xss" else "作品简介 & synopsis")
    if case == "collection":
        return [first, Book("Story · 第二话", deepcopy(frames[:2]), synopsis="Another book")]
    return [first]


class AlbumTemplateMatrixTests(unittest.TestCase):
    def assert_safe_document(self, document: str) -> AlbumDocument:
        parsed = AlbumDocument(document)
        policies = [
            attrs["content"]
            for tag, attrs in parsed.nodes
            if tag == "meta" and attrs.get("http-equiv", "").lower() == "content-security-policy"
        ]
        self.assertEqual(len(policies), 1)
        policy = policies[0]
        nonce = re.search(r"script-src 'nonce-([0-9a-f]{24})'", policy).group(1)
        for directive in (
            "default-src 'none'",
            "img-src data:",
            "style-src 'unsafe-inline'",
            "font-src data:",
            "connect-src 'none'",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
        ):
            self.assertIn(directive, policy)
        self.assertNotIn("'unsafe-eval'", policy)
        self.assertNotIn("'unsafe-inline'", policy.split("script-src", 1)[1])
        self.assertEqual(len(parsed.scripts), 2)
        active = [
            (attrs, text)
            for attrs, text in parsed.scripts
            if attrs.get("type") != "application/json"
        ]
        self.assertEqual(active, [({"nonce": nonce}, runtime())])
        self.assertEqual(parsed.scripts[1][0], {"id": "mio-album-data", "type": "application/json"})
        for tag, attrs in parsed.nodes:
            self.assertFalse(any(name.lower().startswith("on") for name in attrs), (tag, attrs))
            self.assertNotIn(tag, {"iframe", "object", "embed", "form", "base"})
            for name in ("src", "href", "poster", "action", "formaction"):
                if attrs.get(name):
                    self.assertTrue(attrs[name].startswith(("data:image/", "#")), (tag, name))
        self.assertNotIn("<svg onload", document)
        self.assertNotIn("<script>alert(42)", document)
        return parsed

    def assert_round_trip(self, parsed: AlbumDocument, books: list[Book]):
        payload = json.loads(parsed.scripts[1][1])
        self.assertEqual(payload["schema"], "mio.album-html.v1")
        self.assertEqual(len(payload["books"]), len(books))
        images = {
            attrs["data-mio-asset"]: attrs["src"]
            for tag, attrs in parsed.nodes
            if tag == "img" and "data-mio-asset" in attrs
        }
        for book, exported in zip(books, payload["books"], strict=True):
            self.assertIsNone(exported["storyboard"])
            album = exported["album"]
            self.assertEqual(album["title"], book.title)
            self.assertEqual(album["synopsis"], book.synopsis)
            self.assertEqual(album["totalSteps"], len(book.frames))
            for index, (frame, step) in enumerate(zip(book.frames, album["steps"], strict=True)):
                self.assertEqual(step["stepIndex"], index)
                self.assertEqual(step["name"], frame.name)
                self.assertEqual(step["caption"], frame.caption)
                self.assertEqual(step["prompt"], frame.prompt)
                self.assertEqual((step["width"], step["height"]), (frame.width, frame.height))
                if not frame.image:
                    self.assertEqual(step["image"], "")
                    self.assertIn(MISSING, images.values())
                    continue
                restored = images[step["image"]["$mioImage"]]
                self.assertEqual(restored, frame.image)
                with Image.open(io.BytesIO(base64.b64decode(restored.split(",", 1)[1]))) as image:
                    self.assertEqual(image.size, (frame.width, frame.height))

    def run_template_case(self, template_id: str, case: str):
        template = next(t for t in builtin_templates() if t.id == template_id)
        books = sample_books(case)
        original = [asdict(book) for book in books]
        options = AlbumOptions(show_prompts=True, signature=ATTACK if case == "xss" else "作者 Mio")
        document = render_album(template, books, options)
        self.assertIn(f'data-layout="{template.layout}"', document)
        self.assert_round_trip(self.assert_safe_document(document), books)
        self.assertEqual([asdict(book) for book in books], original)
        self.assertNotRegex(document.split('<script nonce="', 1)[0], r"\{\{[#/]?\w+\}\}")
        # Palette variables must be resolved where a template elects to use them.
        for token, color in zip(("palette1", "palette2", "palette3"), COLORS, strict=True):
            if "{{" + token + "}}" in template.html:
                self.assertIn(color, document)

    def test_each_export_uses_a_new_nonce_and_one_policy(self):
        self.assertEqual(len(builtin_templates()), 13)
        template = builtin_templates()[0]
        documents = [render_album(template, sample_books("single")) for _ in range(2)]
        nonces = [re.search(r"script-src 'nonce-([0-9a-f]+)'", doc).group(1) for doc in documents]
        self.assertNotEqual(*nonces)
        for doc in documents:
            self.assert_safe_document(doc)

    def test_template_text_cover_and_palette_variables_are_escaped(self):
        html = (
            "<!doctype html><html><head><title>{{title}}</title></head><body>"
            "{{#books}}<article data-cc-book><h1>{{title}}</h1><p>{{synopsis}}</p>"
            '<img class="cover" src="{{coverImage}}"><footer>{{signature}}</footer>'
            "<main data-cc-pages>{{#frames}}<figure data-cc-frame>"
            '<img src="{{image}}" alt="{{name}}"><p data-cc-caption>{{caption}}</p>'
            '<i data-palette="{{palette1}}|{{palette2}}|{{palette3}}"></i>'
            '<output data-position="{{frameIndex}}|{{total}}|{{progress}}"></output>'
            "</figure>{{/frames}}</main></article>{{/books}}</body></html>"
        )
        template = parse_template({"id": "variable-probe", "title": "Probe", "html": html})
        books = sample_books("xss")
        document = render_album(template, books, AlbumOptions(signature=ATTACK, show_prompts=True))
        parsed = self.assert_safe_document(document)
        self.assert_round_trip(parsed, books)
        self.assertIn('data-palette="#204060|#a03c58|#e4c47c"', document)
        positions = [attrs["data-position"] for tag, attrs in parsed.nodes if tag == "output"]
        self.assertEqual(positions, ["1|4|0.25", "2|4|0.5", "3|4|0.75", "4|4|1.0"])
        self.assertIn("&#123;&#123;title&#125;&#125;", document)
        self.assertIn("&lt;svg onload=&quot;alert(42)&quot;&gt;", document)
        covers = [
            attrs for tag, attrs in parsed.nodes if tag == "img" and attrs.get("class") == "cover"
        ]
        self.assertEqual([attrs["src"] for attrs in covers], [books[0].frames[0].image])


def _matrix_test(template_id: str, case: str):
    def test(self):
        self.run_template_case(template_id, case)

    return test


for _template in builtin_templates():
    for _case in (
        "single",
        "four",
        "twelve",
        "missing",
        "mixed",
        "long_title",
        "xss",
        "collection",
    ):
        setattr(
            AlbumTemplateMatrixTests,
            "test_" + _template.id.replace("-", "_") + "_" + _case,
            _matrix_test(_template.id, _case),
        )
