"""Readable Folio metadata and bounded contact-print turns in real offline exports."""

from __future__ import annotations

import json
import re
import unittest
from html.parser import HTMLParser
from itertools import product
from pathlib import Path

from PIL import Image

from mio_server.album.build import data_url
from mio_server.album.render import AlbumOptions, Book, Frame, render_album
from mio_server.album.templates import parse_template

TEMPLATE_PATH = (
    Path(__file__).resolve().parents[1] / "mio_server" / "album" / "builtin" / "export-folio.json"
)


class FolioDocument(HTMLParser):
    def __init__(self, document: str):
        super().__init__()
        self.nodes: list[dict] = []
        self.stack: list[dict] = []
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        node = {"tag": tag, "attrs": dict(attrs), "text": ""}
        self.nodes.append(node)
        if tag not in {"meta", "link", "img", "br", "hr", "input", "source"}:
            self.stack.append(node)

    def handle_data(self, data):
        for node in self.stack:
            node["text"] += data

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break

    def text_for_class(self, name: str) -> list[str]:
        return [
            node["text"].strip()
            for node in self.nodes
            if name in node["attrs"].get("class", "").split()
        ]


def sample_book() -> Book:
    """Neutral export fixture; no workspace or model service is involved."""
    with Image.new("RGB", (320, 400), "#a8b4b0") as image:
        artwork = data_url(image, 1400)
    return Book(
        "Quiet afternoon",
        [
            Frame(artwork, name="First page", caption="The window is open.", width=320, height=400),
            Frame(artwork, name="Second page", caption="A quiet moment.", width=320, height=400),
        ],
        synopsis="An offline reading sample.",
        story_title="Chapter 01",
    )


def sample_folio() -> str:
    template = parse_template(json.loads(TEMPLATE_PATH.read_text(encoding="utf-8")))
    return render_album(template, [sample_book()], AlbumOptions(signature="Sample author"))


def rgb(color: str) -> tuple[float, ...]:
    return tuple(int(color[index : index + 2], 16) for index in (1, 3, 5))


def composite(foreground, background, opacity):
    return tuple(
        front * opacity + back * (1 - opacity)
        for front, back in zip(foreground, background, strict=True)
    )


def contrast(foreground, background) -> float:
    def luminance(color):
        channels = [channel / 255 for channel in color]
        linear = [
            channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4
            for channel in channels
        ]
        return sum(channel * weight for channel, weight in zip(linear, (0.2126, 0.7152, 0.0722)))

    light, dark = sorted((luminance(foreground), luminance(background)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


class FolioReadabilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = sample_folio()
        cls.parsed = FolioDocument(cls.document)
        cls.css = "\n".join(node["text"] for node in cls.parsed.nodes if node["tag"] == "style")

    def rule(self, selector):
        matches = re.findall(re.escape(selector) + r"\s*\{([^{}]*)\}", self.css)
        self.assertTrue(matches, selector)
        return ";".join(matches)

    def test_real_export_keeps_all_metadata_and_its_accent_mapping(self):
        expected = {
            "topline": ["FOLIO / 精装对页"],
            "chapter-header": ["Chapter 01"],
            "signature": ["Sample author"],
            "running-head": ["Quiet afternoon01 / 2", "Quiet afternoon02 / 2"],
        }
        for name, text in expected.items():
            with self.subTest(metadata=name):
                self.assertEqual(self.parsed.text_for_class(name), text)
        imprint = self.parsed.text_for_class("imprint")
        self.assertEqual(len(imprint), 1)
        self.assertRegex(imprint[0], r"^\d{4}/\d{1,2}/\d{1,2} · 2 PLATES · MIO EDITION$")
        self.assertEqual(
            self.parsed.text_for_class("caption-text"),
            ["The window is open.", "A quiet moment."],
        )
        for selector in (
            ".topline",
            ".chapter-header",
            ".signature",
            ".running-head",
            ".caption h2",
            ".colophon.imprint",
        ):
            with self.subTest(selector=selector):
                rule = self.rule(selector)
                self.assertIn("color:var(--accent)", rule)
                self.assertNotIn("display:none", rule)

    def test_default_small_text_contrast_includes_the_readers_ambient_layer(self):
        variables = dict(re.findall(r"(--[a-z-]+):(#[0-9a-fA-F]{6})(?=[;}])", self.css))
        accent = rgb(variables["--accent"])
        surfaces = {name: rgb(variables[name]) for name in ("--canvas", "--paper")}
        # The warm spine tint is part of the real exported paper, not a new flat white backdrop.
        tint = re.search(r"linear-gradient\(90deg,(#[0-9a-fA-F]{8}),transparent 5%\)", self.css)
        self.assertIsNotNone(tint)
        surfaces["spine"] = composite(
            rgb(tint[1]), surfaces["--paper"], int(tint[1][-2:], 16) / 255
        )
        ambient = float(
            re.search(r"opacity:\s*([.\d]+)", self.rule(".mio-ambient > [data-visible]"))[1]
        )
        # The reader's palette tint overlays both text and paper. Include RGB extremes so
        # the default does not rely on a conveniently dark or desaturated fixture palette.
        for name, surface in surfaces.items():
            for color in product((0, 255), repeat=3):
                for opacity in (0, ambient):
                    with self.subTest(surface=name, ambient=color, opacity=opacity):
                        value = contrast(
                            composite(color, accent, opacity),
                            composite(color, surface, opacity),
                        )
                        self.assertGreaterEqual(value, 4.5)


class ContactSheetTurnContainmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = TEMPLATE_PATH.with_name("export-contact-sheet.json")
        template = parse_template(json.loads(path.read_text(encoding="utf-8")))
        cls.document = render_album(template, [sample_book()])
        cls.parsed = FolioDocument(cls.document)
        cls.css = "\n".join(node["text"] for node in cls.parsed.nodes if node["tag"] == "style")

    def test_real_export_clips_turn_projection_at_the_outer_book_gutter(self):
        parsed, css = self.parsed, self.css
        self.assertEqual(len(parsed.text_for_class("contact-book")), 1)
        self.assertEqual(len(parsed.text_for_class("frame")), 2)
        self.assertIn("First page", parsed.text_for_class("frame")[0])
        self.assertIn("Second page", parsed.text_for_class("frame")[1])
        containment = (
            r'body\[data-layout="contact"\]\[data-mio-paged\] \.contact-book'
            r"\s*\{\s*overflow-x:\s*clip;\s*\}"
        )
        self.assertRegex(css, containment)
        # Keep the existing interactive card outline; clipping belongs outside its gutters.
        self.assertIn("[data-cc-frame][role=button]:focus-visible", css)
        self.assertIn("outline:2px solid var(--accent);outline-offset:3px", css)
        # The animated turn itself remains active, including for the other album layouts.
        self.assertRegex(css, r"\[data-mio-enter\]\s*\{\s*animation:\s*mio-enter 0\.4s")
        self.assertIn("transform: rotateY(-7deg) translateX(5px)", css)

    def test_print_ink_and_accent_keep_small_captions_and_labels_readable(self):
        body = re.search(r"@media print\{html\{[^{}]*\}body\{([^{}]*)\}", self.css)
        self.assertIsNotNone(body)
        variables = dict(re.findall(r"(--[a-z-]+):(#[0-9a-fA-F]{6})(?=[;}])", body[1] + ";"))
        white = (255, 255, 255)
        # The existing dark header gradient is retained when printing onto white paper.
        header = re.search(r"background:linear-gradient\(110deg,(#000[0-9a-f]),", self.css)
        self.assertIsNotNone(header)
        shaded = composite((0, 0, 0), white, int(header[1][-1], 16) / 15)
        for surface in (white, shaded):
            with self.subTest(metadata_background=surface):
                self.assertGreaterEqual(contrast(rgb(variables["--accent"]), surface), 4.5)
        for selector, surface in (
            (".caption-text", white),
            (".shot-size", white),
            (".synopsis", shaded),
        ):
            with self.subTest(print_text=selector):
                rule = re.search(re.escape(selector) + r"\{([^{}]*color:[^{}]*)\}", self.css)
                self.assertIsNotNone(rule)
                opacity = re.search(
                    r"color-mix\(in srgb,var\(--ink\) (\d+)%,transparent\)", rule[1]
                )
                self.assertIsNotNone(opacity)
                ink = composite(rgb(variables["--ink"]), surface, int(opacity[1]) / 100)
                self.assertGreaterEqual(contrast(ink, surface), 4.5)


if __name__ == "__main__":
    unittest.main()
