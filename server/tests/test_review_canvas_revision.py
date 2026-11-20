"""The canvas can derive a receipt revision only because each CAS commits exactly once."""

import io

from PIL import Image

from mio_server.models import Episode, Panel, Series, Take

from .api_harness import ApiCase


class CanvasRevisionTests(ApiCase):
    def setUp(self):
        super().setUp()
        series = self.ctx.store.create_series(Series(title="Canvas revision"))
        buffer = io.BytesIO()
        Image.new("RGB", (16, 16), "#7799bb").save(buffer, "PNG")
        asset = self.ctx.assets.put(buffer.getvalue(), source="test:neutral")
        self.episode = self.ctx.store.create_episode(
            Episode(
                series_id=series.id,
                title="Neutral",
                order=0,
                panels=[Panel(id="p1", order=0)],
                takes=[Take(panel_id="p1", asset_id=asset.id, status="adopted")],
            )
        )
        self.path = f"/api/episodes/{self.episode.id}"

    def test_save_and_layout_commit_exactly_the_next_revision(self):
        before = self.ok(self.client.get(self.path))
        saved = self.ok(
            self.client.put(
                self.path + f"/strip?base_revision={before['revision']}",
                json={**before["strip"], "width": 900},
            )
        )
        after_save = self.ok(self.client.get(self.path))
        self.assertEqual(after_save["revision"], before["revision"] + 1)
        self.assertEqual(after_save["strip"], saved)
        laid_out = self.ok(
            self.client.post(
                self.path + f"/strip/layout?base_revision={after_save['revision']}", json={}
            )
        )
        after_layout = self.ok(self.client.get(self.path))
        self.assertEqual(after_layout["revision"], after_save["revision"] + 1)
        self.assertEqual(after_layout["strip"], laid_out)

    def test_stale_save_and_layout_preserve_the_remote_snapshot(self):
        before = self.ok(self.client.get(self.path))
        self.ok(
            self.client.put(
                self.path + f"/strip?base_revision={before['revision']}",
                json={**before["strip"], "background": "#123456"},
            )
        )
        remote = self.ok(self.client.get(self.path))
        for method, suffix, body in (
            (self.client.put, "/strip", before["strip"]),
            (self.client.post, "/strip/layout", {}),
        ):
            with self.subTest(suffix=suffix):
                response = method(
                    self.path + suffix + f"?base_revision={before['revision']}", json=body
                )
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(self.ok(self.client.get(self.path)), remote)

    def test_layout_rechecks_the_revision_after_computing_geometry(self):
        before = self.ok(self.client.get(self.path))
        layout = self.ctx.registry.get("layout", "strip.default")
        remote = []

        def concurrent_layout(*args, **kwargs):
            result = layout(*args, **kwargs)
            self.ok(
                self.client.put(
                    self.path + f"/strip?base_revision={before['revision']}",
                    json={**before["strip"], "background": "#123456"},
                )
            )
            remote.append(self.ok(self.client.get(self.path)))
            return result

        self.ctx.registry.register("layout", "test.concurrent", concurrent_layout)
        response = self.client.post(
            self.path + f"/strip/layout?base_revision={before['revision']}",
            json={"layout_id": "test.concurrent"},
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.ok(self.client.get(self.path)), remote[0])

    def test_legacy_writes_without_a_revision_remain_available(self):
        self.ok(self.client.post(self.path + "/strip/layout", json={}))
        self.ok(self.client.put(self.path + "/strip", json={"width": 900}))
        self.assertEqual(self.ok(self.client.get(self.path))["strip"]["width"], 900)
