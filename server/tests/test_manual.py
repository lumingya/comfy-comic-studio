"""The current handbook is offline, release-packaged and compatible with restored help links."""

from __future__ import annotations

import importlib.util
import shutil
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

from mio_server.api import manual

from .api_harness import ApiCase


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
        for path in (manual.ZH, manual.EN):
            response = self.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn("text/html", response.headers["content-type"])
            self.assertIn("THE MIO HANDBOOK", response.text)
            self.assertIn("8788", response.text)
            self.assertIn("Python 3.11+", response.text)
            self.assertNotIn("<script", response.text)
            parsed = Links(response.text)
            self.assertFalse(
                [r for r in parsed.resources if r.startswith(("http:", "https:", "//"))]
            )
            for href in parsed.links:
                if href.startswith("#"):
                    self.assertIn(href[1:], parsed.ids)
            self.assertIn("default-src 'none'", response.headers["content-security-policy"])

    def test_all_restored_help_links_point_to_existing_current_sections(self):
        for language, canonical in (("guide", manual.ZH), ("en", manual.EN)):
            anchors = Links(self.get(canonical).text).ids
            for name, section in manual.GUIDES.items():
                with self.subTest(language=language, name=name):
                    response = self.get(f"/manual/docs/{language}/{name}.html")
                    self.assertEqual(response.status_code, 307)
                    self.assertEqual(response.headers["location"], canonical + "#" + section)
                    self.assertIn(section, anchors)
        self.assertEqual(self.get("/manual/").headers["location"], manual.ZH)
        self.assertEqual(self.get("/manual/index.html").headers["location"], "/")
        self.assertEqual(self.get("/manual/README.html").headers["location"], manual.ZH + "#start")
        self.assertEqual(self.get("/manual/docs/guide/img/flow.svg").status_code, 200)

    def test_only_bundled_manual_files_are_reachable(self):
        for path in (
            "/manual/js/app.js",
            "/manual/backend/server.py",
            "/manual/docs/%2e%2e/server.py",
            "/manual/docs/guide/QUICKSTART.md",
            "/manual/docs/nope.html",
            "/manual/vendor/marked.min.js",
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
        included = {path.relative_to(repo).as_posix() for path in release.files()}
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
