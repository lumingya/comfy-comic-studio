"""/manual: the legacy handbook (使用教程) rendered from legacy/docs without network access."""

from __future__ import annotations

import unittest

from mio_server.api import manual

from .api_harness import ApiCase


@unittest.skipUnless(manual.available(), "legacy/docs is not part of this checkout")
class ManualTest(ApiCase):
    def get(self, path):
        return self.client.get(path, follow_redirects=False)

    def test_markdown_guides_render_offline_in_the_reader_template(self):
        r = self.get("/manual/docs/guide/QUICKSTART.html")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/html", r.headers["content-type"])
        self.assertIn("THE MIO HANDBOOK", r.text)
        self.assertIn("document-data", r.text)
        self.assertNotIn("__MARKED__", r.text)
        self.assertNotIn("__DOC_DATA__", r.text)
        # The embedded JSON cannot close its script element.
        data = r.text.split('id="document-data" type="application/json">', 1)[1].split("</script>")[
            0
        ]
        self.assertNotIn("<", data)

    def test_centre_images_and_links_back_to_the_app(self):
        self.assertIn("guide/QUICKSTART.html", self.get("/manual/docs/index.html").text)
        self.assertEqual(self.get("/manual/docs/guide/img/flow.svg").status_code, 200)
        self.assertEqual(self.get("/manual/").headers["location"], "/manual/docs/index.html")
        self.assertEqual(self.get("/manual/index.html").headers["location"], "/")
        self.assertEqual(self.get("/manual/README.html").status_code, 200)

    def test_nothing_outside_the_docs(self):
        for path in (
            "/manual/js/app.js",
            "/manual/backend/server.py",
            "/manual/docs/../js/app.js",
            "/manual/docs/guide/QUICKSTART.md",
            "/manual/docs/nope.html",
            "/manual/vendor/marked.min.js",
        ):
            self.assertEqual(self.get(path).status_code, 404, path)
