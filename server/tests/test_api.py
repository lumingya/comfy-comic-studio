"""HTTP API: the golden story end to end, plus series / episode / panel / take CRUD."""

import unittest

from .api_harness import ApiCase, zip_names


class GoldenStoryTests(ApiCase):
    def test_golden_story_renders_via_api(self):
        """P1 done criterion: sentence → script → render → adopt → QA → strip → exports."""
        self.assertEqual(self.ok(self.client.get("/healthz"))["ok"], True)
        series, ep = self.make_episode()
        self.assertEqual(len(ep["panels"]), 12)
        series = self.ok(self.client.get(f"/api/series/{series['id']}"))
        self.assertEqual({c["id"] for c in series["bible"]["characters"]}, {"lin", "zhou"})

        pid = ep["panels"][1]["id"]
        prompt = self.ok(self.client.get(f"/api/episodes/{ep['id']}/panels/{pid}/prompt"))
        self.assertIn("positive", prompt["tags"])
        self.assertIn("references", prompt)

        job = self.ok(
            self.client.post(
                f"/api/episodes/{ep['id']}/render", json={"candidates": 1, "idempotency_key": "g1"}
            )
        )
        again = self.ok(
            self.client.post(
                f"/api/episodes/{ep['id']}/render", json={"candidates": 1, "idempotency_key": "g1"}
            )
        )
        self.assertEqual(job["id"], again["id"], "idempotency key must dedupe paid requests")
        self.drain(job)
        ep = self.ok(self.client.get(f"/api/episodes/{ep['id']}"))
        self.assertEqual(len(ep["takes"]), 12)

        for take in ep["takes"]:
            ep = self.ok(self.client.post(f"/api/episodes/{ep['id']}/takes/{take['id']}/adopt"))
        adopted = [t for t in ep["takes"] if t["status"] == "adopted"]
        self.assertEqual(len(adopted), 12)
        image = self.client.get(f"/api/episodes/{ep['id']}/takes/{adopted[0]['id']}/image")
        self.assertEqual(image.headers["content-type"], "image/png")

        qa = self.ok(self.client.post(f"/api/episodes/{ep['id']}/qa", json={"votes": 1}))
        self.drain(qa)
        ep = self.ok(self.client.get(f"/api/episodes/{ep['id']}"))
        self.assertTrue(all(t["qa"] for t in ep["takes"]))

        strip = self.ok(self.client.post(f"/api/episodes/{ep['id']}/strip/layout", json={}))
        self.assertEqual(len(strip["panel_boxes"]), 12)
        self.assertTrue(strip["lettering"])
        png = self.client.get(f"/api/episodes/{ep['id']}/strip.png")
        self.assertEqual(png.content[:8], b"\x89PNG\r\n\x1a\n")

        zipped = self.client.get(f"/api/episodes/{ep['id']}/export?fmt=slices&preset=webtoon")
        self.assertEqual(zipped.status_code, 200, zipped.text)
        self.assertIn("attachment", zipped.headers["content-disposition"])
        names = zip_names(zipped.content)
        self.assertIn("manifest.json", names)
        self.assertTrue(all(n.endswith(".jpg") for n in names if n != "manifest.json"))
        html = self.client.get(f"/api/episodes/{ep['id']}/export?fmt=html")
        self.assertIn(b"<html", html.content[:400].lower())
        presets = self.ok(self.client.get("/api/export/presets"))
        self.assertIn("webtoon", {p["id"] for p in presets})

    def test_strip_needs_adopted_images(self):
        _, ep = self.make_episode()
        r = self.client.get(f"/api/episodes/{ep['id']}/strip.png")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["kind"], "invalid")


class CrudTests(ApiCase):
    def test_series_patch_trash_restore(self):
        series, ep = self.make_episode()
        sid = series["id"]
        patched = self.ok(self.client.patch(f"/api/series/{sid}", json={"subtitle": "第一季"}))
        self.assertEqual(patched["subtitle"], "第一季")
        page = self.ok(self.client.get(f"/api/series/{sid}/episodes?limit=1"))
        self.assertEqual((page["total"], len(page["items"])), (1, 1))

        self.ok(self.client.delete(f"/api/episodes/{ep['id']}"), 204)
        self.assertEqual(self.client.get(f"/api/episodes/{ep['id']}").status_code, 404)
        trash = self.ok(self.client.get("/api/trash"))
        self.assertEqual([i["id"] for i in trash["items"] if i["kind"] == "episode"], [ep["id"]])
        self.ok(self.client.post(f"/api/episodes/{ep['id']}/restore"))
        self.ok(self.client.get(f"/api/episodes/{ep['id']}"))

        self.ok(self.client.delete(f"/api/series/{sid}"), 204)
        self.assertEqual(self.ok(self.client.get("/api/series")), [])
        self.assertEqual(len(self.ok(self.client.get("/api/series?deleted=true"))), 1)
        self.ok(self.client.post(f"/api/series/{sid}/restore"))
        self.ok(self.client.delete(f"/api/series/{sid}"), 204)
        self.ok(self.client.delete(f"/api/trash/series/{sid}"), 204)
        self.assertEqual(self.client.get(f"/api/series/{sid}/restore").status_code, 405)
        self.assertEqual(self.client.post(f"/api/series/{sid}/restore").status_code, 404)

    def test_panel_editing_and_revision_conflict(self):
        _, ep = self.make_episode()
        eid, first = ep["id"], ep["panels"][0]["id"]
        ep = self.ok(
            self.client.post(
                f"/api/episodes/{eid}/panels",
                json={"panel": {"id": "p_new", "description": "a quiet street"}, "after": first},
            ),
            201,
        )
        ids = [p["id"] for p in sorted(ep["panels"], key=lambda p: p["order"])]
        self.assertEqual(ids[1], "p_new")
        ep = self.ok(
            self.client.patch(
                f"/api/episodes/{eid}/panels/p_new",
                json={"changes": {"shot": "close", "overrides": {"seed": 7}}},
            )
        )
        panel = next(p for p in ep["panels"] if p["id"] == "p_new")
        self.assertEqual((panel["shot"], panel["overrides"]["seed"]), ("close", 7))

        stale = ep["revision"] - 1
        r = self.client.patch(
            f"/api/episodes/{eid}/panels/p_new",
            json={"changes": {"shot": "wide"}, "revision": stale},
        )
        self.assertEqual(r.status_code, 409)

        ep = self.ok(self.client.post(f"/api/episodes/{eid}/panels/p_new/duplicate"))
        self.assertEqual(len(ep["panels"]), 14)
        order = [p["id"] for p in sorted(ep["panels"], key=lambda p: p["order"])][::-1]
        ep = self.ok(self.client.post(f"/api/episodes/{eid}/panels/reorder", json={"order": order}))
        self.assertEqual([p["id"] for p in ep["panels"]], order)
        bad = self.client.post(f"/api/episodes/{eid}/panels/reorder", json={"order": order[1:]})
        self.assertEqual(bad.status_code, 400)
        ep = self.ok(self.client.delete(f"/api/episodes/{eid}/panels/p_new"))
        self.assertNotIn("p_new", [p["id"] for p in ep["panels"]])
        self.assertEqual(self.client.delete(f"/api/episodes/{eid}/panels/p_new").status_code, 404)

    def test_take_adopt_is_exclusive_per_panel(self):
        _, ep = self.make_episode()
        pid = ep["panels"][0]["id"]
        job = self.ok(
            self.client.post(
                f"/api/episodes/{ep['id']}/render", json={"panel_ids": [pid], "candidates": 2}
            )
        )
        self.drain(job)
        takes = self.ok(self.client.get(f"/api/episodes/{ep['id']}"))["takes"]
        self.assertEqual(len(takes), 2)
        self.ok(self.client.post(f"/api/episodes/{ep['id']}/takes/{takes[0]['id']}/adopt"))
        ep = self.ok(self.client.post(f"/api/episodes/{ep['id']}/takes/{takes[1]['id']}/adopt"))
        status = {t["id"]: t["status"] for t in ep["takes"]}
        self.assertEqual(status, {takes[0]["id"]: "candidate", takes[1]["id"]: "adopted"})
        ep = self.ok(self.client.post(f"/api/episodes/{ep['id']}/takes/{takes[0]['id']}/reject"))
        self.assertEqual(ep["takes"][0]["status"], "rejected")

    def test_not_found(self):
        self.assertEqual(self.client.get("/api/series/nope").status_code, 404)
        r = self.client.post("/api/series/nope/episodes", json={"title": "x", "order": 0})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["kind"], "not_found")


if __name__ == "__main__":
    unittest.main()
