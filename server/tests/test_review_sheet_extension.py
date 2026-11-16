"""The optional review sheet runs through stable export and token contracts."""

import base64
import importlib.util
import io
import re
import tempfile
import unittest
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from mio_server.api import create_app
from mio_server.context import AppContext
from mio_server.models import Episode, Panel, Series, Strip, Take

PACKAGE = Path(__file__).resolve().parents[2] / "examples/extensions/review-sheet"
SPEC = importlib.util.spec_from_file_location("review_sheet_example", PACKAGE / "main.py")
EXAMPLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXAMPLE)


def package_bytes():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in ("mio-extension.json", "main.py"):
            archive.write(PACKAGE / name, name)
    return buffer.getvalue()


class ReviewSheetTests(unittest.TestCase):
    def test_visual_order_aspect_ratio_and_escaping(self):
        image = Image.new("RGB", (800, 1000), "white")
        image.paste("red", (0, 0, 800, 200))
        image.paste("blue", (0, 200, 200, 1000))
        strip = Strip(panel_boxes={"second": (0, 200, 200, 1000), 'first"<>': (0, 0, 800, 200)})
        raw, mime, filename = EXAMPLE.review_sheet(
            image, strip, "review-sheet", preset_id=None, title="<script>&", subtitle="", quality=0
        )
        text = raw.decode()
        self.assertEqual((mime, filename), ("text/html; charset=utf-8", "review-sheet.html"))
        self.assertNotIn("<script>", text)
        self.assertIn("&lt;script&gt;&amp;", text)
        self.assertIn('data-panel-id="first&quot;&lt;&gt;"', text)
        self.assertLess(text.index("first&quot;"), text.index('data-panel-id="second"'))
        thumbs = re.findall(r"data:image/png;base64,([A-Za-z0-9+/=]+)", text)
        images = [Image.open(io.BytesIO(base64.b64decode(item))) for item in thumbs]
        self.assertEqual([item.size for item in images], [(480, 120), (120, 480)])
        self.assertEqual(images[0].getpixel((240, 60)), (255, 0, 0))
        self.assertEqual(images[1].getpixel((60, 240)), (0, 0, 255))

    def test_empty_and_off_canvas_panels_remain_explicit(self):
        image = Image.new("RGB", (320, 320))
        for boxes, expected in (
            ({}, "当前画布没有分格"),
            ({"outside": (0, 400, 20, 420)}, "画格位于画布外"),
        ):
            raw, _, _ = EXAMPLE.review_sheet(
                image,
                Strip(panel_boxes=boxes),
                "review-sheet",
                preset_id=None,
                title="Test",
                subtitle="",
                quality=None,
            )
            self.assertIn(expected, raw.decode())
            self.assertNotIn("data:image", raw.decode())

    def test_install_export_disable_through_v2_preserves_episode(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = AppContext.create(tmp, autostart=False, seed_instance=False)
            try:
                series = ctx.store.create_series(Series(title="Review & repeat"))
                panel = Panel(order=0, description="A quiet room")
                png = io.BytesIO()
                Image.new("RGB", (120, 240), "#7799aa").save(png, "PNG")
                asset = ctx.assets.put(png.getvalue(), source="synthetic-test")
                ep = ctx.store.create_episode(
                    Episode(
                        series_id=series.id,
                        title="One",
                        order=0,
                        panels=[panel],
                        takes=[Take(panel_id=panel.id, asset_id=asset.id, status="adopted")],
                    )
                )
                client = TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1")
                admin = client.post(
                    "/api/tokens", json={"name": "admin", "scopes": ["admin"]}
                ).json()
                reader = client.post(
                    "/api/tokens", json={"name": "reader", "scopes": ["read"]}
                ).json()
                ah = {"Authorization": "Bearer " + admin["token"]}
                rh = {"Authorization": "Bearer " + reader["token"]}
                installed = client.post("/api/v2/extensions", content=package_bytes(), headers=ah)
                self.assertEqual(installed.status_code, 201, installed.text)
                digest = installed.json()["digest"]
                enable_url = "/api/v2/extensions/review-sheet/enable"
                self.assertEqual(
                    client.post(enable_url, json={"digest": digest}, headers=rh).status_code, 403
                )
                self.assertEqual(
                    client.post(enable_url, json={"digest": digest}, headers=ah).status_code, 200
                )
                formats = client.get("/api/v2/export/formats", headers=rh).json()
                self.assertIn("review-sheet", [item["id"] for item in formats])
                before = ctx.store.get_episode(ep.id).model_dump()
                url = f"/api/v2/episodes/{ep.id}/export?fmt=review-sheet"
                self.assertEqual(client.get(url).status_code, 401)
                response = client.get(url, headers=rh)
                self.assertEqual(response.status_code, 200, response.text[:300])
                self.assertIn("data:image/png;base64,", response.text)
                self.assertEqual(ctx.store.get_episode(ep.id).model_dump(), before)
                self.assertEqual(
                    client.post("/api/v2/extensions/review-sheet/disable", headers=ah).status_code,
                    200,
                )
                self.assertNotIn(
                    "review-sheet",
                    [
                        item["id"]
                        for item in client.get("/api/v2/export/formats", headers=rh).json()
                    ],
                )
                self.assertEqual(client.get(url, headers=rh).status_code, 400)
                self.assertEqual(
                    client.delete("/api/v2/extensions/review-sheet", headers=ah).status_code, 204
                )
            finally:
                ctx.close()
