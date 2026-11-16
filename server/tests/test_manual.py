"""The current handbook is offline, release-packaged and compatible with restored help links."""

from __future__ import annotations

import importlib.util
import shutil
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock
from urllib.parse import urljoin, urlsplit

from mio_server.api import manual

from .api_harness import ApiCase
from .release_fixture import write_release_seed


class Links(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids, self.links, self.resources = set(), [], []
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "a" and attrs.get("href"):
            self.links.append(attrs["href"])
        if tag in ("script", "img", "link"):
            self.resources.append(attrs.get("src") or attrs.get("href") or "")


class ManualTest(ApiCase):
    def get(self, path):
        return self.client.get(path, follow_redirects=False)

    def test_current_manual_has_no_legacy_runtime_or_external_script_dependency(self):
        self.assertTrue(manual.available())
        for path in ("/manual/" + name for name in manual.FILES if name.endswith(".html")):
            response = self.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn("text/html", response.headers["content-type"])
            self.assertIn("THE MIO HANDBOOK", response.text)
            self.assertIn('src="/manual/assets/manual.js"', response.text)
            self.assertNotIn("data:image", response.text)
            self.assertNotIn("/api/v1", response.text)
            parsed = Links(response.text)
            self.assertFalse(
                [r for r in parsed.resources if r.startswith(("http:", "https:", "//"))]
            )
            for href in parsed.links:
                if href.startswith("#"):
                    self.assertIn(href[1:], parsed.ids)
            self.assertIn("default-src 'none'", response.headers["content-security-policy"])
            self.assertIn("script-src 'self'", response.headers["content-security-policy"])
            for resource in parsed.resources:
                self.assertEqual(self.get(urljoin(path, resource)).status_code, 200, resource)

    def test_home_restores_illustration_cards_and_search_without_technical_setup(self):
        for path in (manual.ZH, manual.EN):
            response = self.get(path)
            parsed = Links(response.text)
            self.assertIn("guide-search", parsed.ids)
            self.assertIn("guide-grid", parsed.ids)
            self.assertIn("no-results", parsed.ids)
            self.assertIn('class="studio-art"', response.text)
            self.assertIn('class="postcard"', response.text)
            self.assertEqual(response.text.count('class="chapter"'), 3)
            self.assertNotIn("Python 3.11+", response.text)
            self.assertNotIn("FastAPI", response.text)
            self.assertNotIn("<pre", response.text)
            self.assertTrue(set(manual.SECTIONS).issubset(parsed.ids))
        artwork = self.get("/manual/assets/coast.webp")
        self.assertEqual(artwork.headers["content-type"], "image/webp")
        self.assertLess(len(artwork.content), 1_000_000)
        self.assertTrue(artwork.content.startswith(b"RIFF"))

    def test_chapters_preserve_current_content_and_all_local_navigation(self):
        for language in ("guide", "en"):
            start = self.get(f"/manual/docs/{language}/start.html").text
            self.assertIn("8788", start)
            self.assertIn("Python 3.11+", start)
            for section in manual.SECTIONS:
                path = f"/manual/docs/{language}/{section}.html"
                response = self.get(path)
                self.assertIn('class="document"', response.text)
                self.assertEqual(response.text.count('<section id="'), 1)
                parsed = Links(response.text)
                self.assertIn(section, parsed.ids)
                for href in parsed.links:
                    target = urlsplit(urljoin(path, href))
                    if not target.path.startswith("/manual/"):
                        continue
                    linked = self.get(target.path)
                    self.assertEqual(linked.status_code, 200, href)
                    if target.fragment:
                        self.assertIn(target.fragment, Links(linked.text).ids, href)
            api_page = self.get(f"/manual/docs/{language}/sharing.html").text
            self.assertIn("/api/v2/workshop/assemble", api_page)
            self.assertIn('id="automation"', api_page)

    def test_bundled_resource_types_do_not_depend_on_system_mime_registration(self):
        with mock.patch("starlette.responses.guess_type", return_value=(None, None)):
            for path, expected in (
                (manual.ZH, "text/html"),
                ("/manual/assets/home.css", "text/css"),
                ("/manual/assets/manual.js", "text/javascript"),
                ("/manual/assets/coast.webp", "image/webp"),
                ("/manual/docs/guide/img/flow.svg", "image/svg+xml"),
            ):
                with self.subTest(path=path):
                    response = self.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["content-type"].split(";")[0], expected)
                    self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_all_restored_help_links_point_to_existing_current_sections(self):
        for language in ("guide", "en"):
            for name, section in manual.GUIDES.items():
                with self.subTest(language=language, name=name):
                    response = self.get(f"/manual/docs/{language}/{name}.html")
                    self.assertEqual(response.status_code, 307)
                    anchor = "automation" if name == "API" else section
                    destination = f"/manual/docs/{language}/{section}.html"
                    self.assertEqual(response.headers["location"], destination + "#" + anchor)
                    anchors = Links(self.get(destination).text).ids
                    self.assertIn(section, anchors)
                    self.assertIn(anchor, anchors)
        self.assertEqual(self.get("/manual/").headers["location"], manual.ZH)
        self.assertEqual(self.get("/manual/index.html").headers["location"], "/")
        self.assertEqual(
            self.get("/manual/README.html").headers["location"],
            "/manual/docs/guide/start.html#start",
        )
        self.assertEqual(
            self.get("/manual/README.en.html").headers["location"],
            "/manual/docs/en/start.html#start",
        )
        self.assertEqual(self.get("/manual/docs/guide/img/flow.svg").status_code, 200)

    def test_only_bundled_manual_files_are_reachable(self):
        for path in (
            "/manual/js/app.js",
            "/manual/backend/server.py",
            "/manual/docs/%2e%2e/server.py",
            "/manual/docs/guide/QUICKSTART.md",
            "/manual/docs/nope.html",
            "/manual/vendor/marked.min.js",
            "/manual/assets/unknown.js",
            "/manual/chapters/zh/start.html",
            "/manual/docs/guide/%5c..%5c..%5cserver.py",
        ):
            self.assertEqual(self.get(path).status_code, 404, path)

    def test_release_contains_handbook_and_it_works_without_legacy(self):
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location(
            "mio_release_manual_test", repo / "tools/build_release.py"
        )
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_release_seed(root)
            shutil.copytree(manual.MANUAL, root / "server/mio_server/manual")
            with mock.patch.object(release, "ROOT", root):
                included = {path.relative_to(root).as_posix() for path in release.files()}
            for name in manual.FILES.values():
                self.assertIn("server/mio_server/manual/" + name, included)
        # Emulate a release's isolated handbook folder: no repository / legacy tree alongside it.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "manual"
            shutil.copytree(manual.MANUAL, root)
            with mock.patch.object(manual, "MANUAL", root):
                self.assertTrue(manual.available())
                self.assertEqual(self.get(manual.ZH).status_code, 200)
                self.assertEqual(self.get(manual.EN).status_code, 200)
