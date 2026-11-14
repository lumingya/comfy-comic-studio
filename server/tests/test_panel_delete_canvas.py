"""Deleting a scripted panel must not strand the editable canvas or erase its artwork."""

import io

from PIL import Image, ImageChops

from mio_server.models import Take, TakeStatus

from .api_harness import ApiCase


class PanelDeleteCanvasTests(ApiCase):
    def laid_out_episode(self):
        series = self.ok(self.client.post("/api/series", json={"title": "Canvas deletion"}), 201)
        episode = self.ok(
            self.client.post(
                f"/api/series/{series['id']}/episodes", json={"title": "Manual composition"}
            ),
            201,
        )
        eid = episode["id"]
        assets = {}
        for pid, color in (("p1", "red"), ("p2", "green"), ("p3", "blue")):
            self.ok(
                self.client.post(
                    f"/api/episodes/{eid}/panels",
                    json={"panel": {"id": pid, "description": pid, "aspect_ratio": "8:5"}},
                ),
                201,
            )
            buf = io.BytesIO()
            Image.new("RGB", (160, 100), color).save(buf, "PNG")
            asset = self.ctx.assets.put(buf.getvalue(), source="test:panel-delete")
            assets[asset.id] = buf.getvalue()
            self.ctx.store.update_episode(
                eid,
                lambda ep, pid=pid, asset=asset: ep.takes.append(
                    Take(
                        id=f"take_{pid}", panel_id=pid, asset_id=asset.id, status=TakeStatus.adopted
                    )
                ),
            )

        strip = self.ok(self.client.post(f"/api/episodes/{eid}/strip/layout", json={}))
        strip.update(
            width=320,
            height=1800,
            manual=True,
            panel_boxes={
                "p1": [0, 170, 320, 370],
                "p2": [0, 500, 320, 700],
                "p3": [0, 800, 320, 1000],
            },
            crops={pid: [0.1, 0.1, 0.9, 0.9] for pid in ("p1", "p2", "p3")},
            lettering=[
                {
                    "id": f"letter_{pid}",
                    "panel_id": pid,
                    "kind": "caption",
                    "text": f"Owned by {pid}",
                    "box": [20, y, 250, y + 60],
                    "locked": True,
                }
                for pid, y in (("p1", 200), ("p2", 530), ("p3", 830))
            ]
            + [
                {
                    "id": "bridge",
                    "panel_id": "p3",
                    "bridge_to": "p1",
                    "kind": "caption",
                    "text": "Keep the surviving dialogue",
                    "box": [20, 1030, 300, 1090],
                    "locked": True,
                },
                {
                    "id": "free",
                    "panel_id": None,
                    "bridge_to": "p1",
                    "kind": "caption",
                    "text": "Independent author note",
                    "box": [20, 1150, 280, 1210],
                    "locked": True,
                },
            ],
        )
        self.ok(self.client.put(f"/api/episodes/{eid}/strip", json=strip))
        return self.ok(self.client.get(f"/api/episodes/{eid}")), assets

    def test_single_and_batch_delete_leave_canvas_editable_and_export_clean(self):
        for removed in ({"p1"}, {"p1", "p2"}):
            with self.subTest(removed=removed):
                before, assets = self.laid_out_episode()
                eid = before["id"]
                if len(removed) == 1:
                    response = self.client.delete(f"/api/episodes/{eid}/panels/p1")
                else:
                    response = self.client.post(
                        f"/api/episodes/{eid}/panels/batch-delete",
                        json={"panel_ids": sorted(removed)},
                    )
                after = self.ok(response)
                remaining = [p["id"] for p in before["panels"] if p["id"] not in removed]
                self.assertEqual([p["id"] for p in after["panels"]], remaining)
                self.assertEqual([p["order"] for p in after["panels"]], list(range(len(remaining))))
                self.assertEqual(after["revision"], before["revision"] + 1)
                strip = after["strip"]
                for field in ("panel_boxes", "crops"):
                    self.assertEqual(
                        strip[field], {pid: before["strip"][field][pid] for pid in remaining}
                    )
                expected_layers = []
                for layer in before["strip"]["lettering"]:
                    if layer["panel_id"] not in removed:
                        expected_layers.append(
                            {**layer, "bridge_to": None} if layer["bridge_to"] in removed else layer
                        )
                self.assertEqual(strip["lettering"], expected_layers)
                self.assertEqual(strip["height"], before["strip"]["height"])
                self.assertEqual(after["takes"], before["takes"])
                for asset_id, data in assets.items():
                    self.assertEqual(self.ctx.assets.read(asset_id), data)

                # A normal next edit succeeds, and preserves deliberate empty space.
                strip["margin"] = 30
                saved = self.ok(self.client.put(f"/api/episodes/{eid}/strip", json=strip))
                self.assertEqual(saved, strip)
                exported = self.ok(self.client.get(f"/api/episodes/{eid}/export?fmt=long"))
                with Image.open(io.BytesIO(exported.content)) as image:
                    self.assertEqual(image.size, (320, strip["height"]))
                    for pid in removed:
                        old_area = image.crop(tuple(before["strip"]["panel_boxes"][pid]))
                        blank = Image.new("RGB", old_area.size, "white")
                        self.assertIsNone(
                            ImageChops.difference(old_area.convert("RGB"), blank).getbbox()
                        )
                    self.assertEqual(image.getpixel((300, 900)), (0, 0, 255))

                # Deletion affects the live composition, not historical source material.
                history = self.ok(self.client.get(f"/api/episodes/{eid}/panels/p1/history"))
                self.assertTrue(history)
                self.assertEqual(history[0]["panel"]["id"], "p1")
                snapshots = self.ctx.store.episode_snapshots(eid)
                old = next(ep for revision, _, ep in snapshots if revision == before["revision"])
                self.assertIn("p1", old.strip.panel_boxes)
                self.assertTrue(any(layer.id == "letter_p1" for layer in old.strip.lettering))

    def test_deleting_every_panel_preserves_independent_text_spacing_and_takes(self):
        before, _ = self.laid_out_episode()
        eid = before["id"]
        after = self.ok(
            self.client.post(
                f"/api/episodes/{eid}/panels/batch-delete",
                json={"panel_ids": ["p1", "p2", "p3", "p1"]},
            )
        )
        self.assertEqual(after["panels"], [])
        self.assertEqual(after["strip"]["panel_boxes"], {})
        self.assertEqual(after["strip"]["crops"], {})
        free = next(layer for layer in before["strip"]["lettering"] if layer["id"] == "free")
        self.assertEqual(after["strip"]["lettering"], [{**free, "bridge_to": None}])
        self.assertEqual(after["strip"]["height"], before["strip"]["height"])
        self.assertEqual(after["takes"], before["takes"])
        self.ok(self.client.put(f"/api/episodes/{eid}/strip", json=after["strip"]))

    def test_unknown_single_delete_does_not_modify_composition(self):
        before, _ = self.laid_out_episode()
        eid = before["id"]
        self.assertEqual(self.client.delete(f"/api/episodes/{eid}/panels/missing").status_code, 404)
        self.assertEqual(self.ok(self.client.get(f"/api/episodes/{eid}")), before)
