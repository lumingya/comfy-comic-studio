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
        strip["lettering"][0]["locked"] = True
        strip["lettering"][0]["text"] = "改过的台词"
        saved = self.ok(self.client.put(f"/api/episodes/{ep['id']}/strip", json=strip))
        self.assertEqual(saved["lettering"][0]["text"], "改过的台词")
        bad = {**strip, "crops": {"nope": [0, 0, 1, 1]}}
        self.assertEqual(
            self.client.put(f"/api/episodes/{ep['id']}/strip", json=bad).status_code, 400
        )
        relaid = self.ok(self.client.post(f"/api/episodes/{ep['id']}/strip/layout", json={}))
        self.assertIn("改过的台词", [layer["text"] for layer in relaid["lettering"]])
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

    def test_listings_carry_progress_and_covers(self):
        series = self.ok(self.client.post("/api/series", json={"title": "雨夜"}), 201)
        sid = series["id"]
        # An empty first episode must not hide the cover of a later one.
        self.ok(self.client.post(f"/api/series/{sid}/episodes", json={"title": "序章"}), 201)
        ep = self.ok(
            self.client.post(f"/api/series/{sid}/episodes/generate", json={"sentence": "雨夜"}),
            201,
        )
        card = self.ok(self.client.get("/api/series"))[0]
        self.assertEqual((card["episode_count"], card["cover_asset_id"]), (2, None))
        items = self.ok(self.client.get(f"/api/series/{sid}/episodes"))["items"]
        self.assertEqual(
            [(i["adopted_count"], i["cover_asset_id"]) for i in items], [(0, None)] * 2
        )

        ep = self.adopt_all(ep)
        first = min(ep["panels"], key=lambda p: p["order"])["id"]
        cover = next(t["asset_id"] for t in ep["takes"] if t["panel_id"] == first)
        items = self.ok(self.client.get(f"/api/series/{sid}/episodes"))["items"]
        self.assertEqual(
            (items[1]["adopted_count"], items[1]["cover_asset_id"]), (len(ep["panels"]), cover)
        )
        extra = self.ok(self.client.post(f"/api/series/{sid}/episodes", json={"title": "x"}), 201)
        self.ok(self.client.delete(f"/api/episodes/{extra['id']}"), 204)  # trashed: not counted
        card = self.ok(self.client.get("/api/series"))[0]
        self.assertEqual((card["episode_count"], card["cover_asset_id"]), (2, cover))
        # Rejected takes stop counting; the cover is the first adopted panel that remains.
        keep = next(t for t in ep["takes"] if t["panel_id"] == first)
        for take in ep["takes"]:
            if take["id"] != keep["id"]:
                self.ok(self.client.post(f"/api/episodes/{ep['id']}/takes/{take['id']}/reject"))
        items = self.ok(self.client.get(f"/api/series/{sid}/episodes"))["items"]
        self.assertEqual((items[1]["adopted_count"], items[1]["cover_asset_id"]), (1, cover))
        self.ok(self.client.post(f"/api/episodes/{ep['id']}/takes/{keep['id']}/reject"))
        card = self.ok(self.client.get("/api/series"))[0]
        self.assertEqual((card["episode_count"], card["cover_asset_id"]), (2, None))

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

    def test_batch_edit_import_and_panel_history(self):
        _, ep = self.make_episode()
        eid = ep["id"]
        ids = [p["id"] for p in sorted(ep["panels"], key=lambda p: p["order"])]
        first, second, third = ids[:3]

        # Batch edit: one revision, overrides merged, unknown ids rejected.
        before = ep["revision"]
        ep = self.ok(
            self.client.post(
                f"/api/episodes/{eid}/panels/batch",
                json={
                    "panel_ids": [first, second],
                    "changes": {"time": "night", "overrides": {"append_prompt": "rain"}},
                },
            )
        )
        self.assertEqual(ep["revision"], before + 1)
        by_id = {p["id"]: p for p in ep["panels"]}
        self.assertEqual(
            [(by_id[i]["time"], by_id[i]["overrides"]["append_prompt"]) for i in (first, second)],
            [("night", "rain"), ("night", "rain")],
        )
        self.assertNotEqual(by_id[third]["time"], "night")
        ep = self.ok(
            self.client.post(
                f"/api/episodes/{eid}/panels/batch",
                json={
                    "panel_ids": [first, third],
                    "changes": {},
                    "append_text": {"append_prompt": "fog"},
                },
            )
        )
        by_id = {p["id"]: p for p in ep["panels"]}
        self.assertEqual(by_id[first]["overrides"]["append_prompt"], "rain, fog")
        self.assertEqual(by_id[third]["overrides"]["append_prompt"], "fog")
        by_id[first]["overrides"]["append_prompt"] = (
            "rain"  # exported below expects the batch value
        )
        r = self.client.post(
            f"/api/episodes/{eid}/panels/batch",
            json={"panel_ids": ["nope"], "changes": {"time": "day"}},
        )
        self.assertEqual(r.status_code, 404)

        # Export = the panel JSON; import re-issues ids and lands after the anchor.
        exported = [by_id[first], by_id[second]]
        ep = self.ok(
            self.client.post(
                f"/api/episodes/{eid}/panels/import",
                json={"panels": exported, "after": third},
            ),
            201,
        )
        order = [p["id"] for p in sorted(ep["panels"], key=lambda p: p["order"])]
        self.assertEqual(len(order), len(ids) + 2)
        self.assertEqual(order[:3], [first, second, third])
        copies = order[3:5]
        self.assertTrue(all(c not in ids for c in copies))
        copied = next(p for p in ep["panels"] if p["id"] == copies[0])
        self.assertEqual(copied["overrides"]["append_prompt"], "rain")

        # Batch delete.
        ep = self.ok(
            self.client.post(f"/api/episodes/{eid}/panels/batch-delete", json={"panel_ids": copies})
        )
        self.assertEqual([p["id"] for p in ep["panels"]], ids)

        # History: every save is a version; restore brings the old content back in place.
        self.ok(
            self.client.patch(
                f"/api/episodes/{eid}/panels/{first}",
                json={"changes": {"overrides": {"append_prompt": "snow"}}},
            )
        )
        history = self.ok(self.client.get(f"/api/episodes/{eid}/panels/{first}/history"))
        self.assertEqual([h["prompt"] for h in history[:3]], ["snow", "rain, fog", "rain"])
        self.assertEqual(history[-1]["prompt"], "")  # the state before any edit is kept too
        ep = self.ok(
            self.client.post(
                f"/api/episodes/{eid}/panels/{first}/restore",
                json={"revision": history[1]["revision"]},
            )
        )
        panel = next(p for p in ep["panels"] if p["id"] == first)
        self.assertEqual((panel["overrides"]["append_prompt"], panel["order"]), ("rain, fog", 0))
        r = self.client.post(
            f"/api/episodes/{eid}/panels/{first}/restore", json={"revision": 99999}
        )
        self.assertEqual(r.status_code, 404)

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

    def test_openapi_marks_defaulted_response_fields_required(self):
        """web/src/api/schema.d.ts relies on this: response fields with defaults are non-optional,
        request bodies keep them optional."""
        schemas = self.client.get("/openapi.json").json()["components"]["schemas"]
        self.assertIn("bible", schemas["Series"]["required"])
        self.assertIn("lettering", schemas["Strip-Output"]["required"])
        self.assertNotIn("lettering", schemas["Strip-Input"].get("required", []))
        self.assertNotIn("confirm_uncertain", schemas["RetryRequest"].get("required", []))


if __name__ == "__main__":
    unittest.main()
