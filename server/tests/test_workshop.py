"""创作工坊: storyboards + presets seeded from the legacy data, assembled into albums."""

from __future__ import annotations

from pathlib import Path

from .api_harness import ApiCase

EMPTY = Path(__file__).resolve().parent / "no-legacy-here"


class WorkshopTest(ApiCase):
    def workshop(self):
        return self.ok(self.client.get("/api/workshop"))

    def test_seeded_from_legacy_data_and_hidden_from_the_shelf(self):
        ws = self.workshop()
        self.assertEqual(ws["kind"], "workshop")
        self.assertEqual(self.workshop()["id"], ws["id"])  # created once
        # The repo's data/ may hold more legacy material than the demo; look the demo up by name.
        preset = next(p for p in ws["presets"] if p["title"] == "七海 · 标准角色设定")
        self.assertEqual([g["title"] for g in preset["groups"]], ["主角与服装", "画风与场景"])
        entry = next(e for e in preset["entries"] if e["key"] == "character_display_name")
        self.assertEqual((entry["value"], entry["label"]), ("七海", "角色展示名 / 旁白"))
        boards = self.ok(self.client.get(f"/api/series/{ws['id']}/episodes"))["items"]
        demo = next(b for b in boards if b["title"] == "远行与归来 · 十二幕")
        board = self.ok(self.client.get(f"/api/episodes/{demo['id']}"))
        self.assertIn("{character}", board["panels"][0]["overrides"]["raw_prompt"])
        self.assertEqual(self.ok(self.client.get("/api/series")), [])

    def test_without_legacy_data_a_blank_storyboard_and_default_preset(self):
        self.ctx.legacy_root = EMPTY
        ws = self.workshop()
        self.assertEqual(ws["presets"][0]["title"], "默认预设")
        boards = self.ok(self.client.get(f"/api/series/{ws['id']}/episodes"))["items"]
        self.assertEqual([b["title"] for b in boards], ["第一个分镜"])

    def test_assemble_snapshots_story_and_presets_then_one_click_fills_the_album(self):
        ws = self.workshop()
        board = self.ok(self.client.get(f"/api/series/{ws['id']}/episodes"))["items"][0]
        preset = next(p for p in ws["presets"] if p["title"] == "七海 · 标准角色设定")
        out = self.ok(
            self.client.post(
                "/api/workshop/assemble",
                json={"storyboard_id": board["id"], "preset_ids": [preset["id"]], "title": "夏"},
            ),
            201,
        )
        album, ep = out["series"], out["episode"]
        self.assertEqual((album["kind"], album["status"], album["title"]), ("album", "draft", "夏"))
        self.assertEqual(album["variables"]["character"], "nanami")
        # The queue card's 预设 line comes from the snapshot of the chosen presets.
        self.assertEqual([p["title"] for p in album["presets"]], ["七海 · 标准角色设定"])
        self.assertEqual(len(ep["panels"]), board["panel_count"])
        self.assertEqual([c["id"] for c in self.ok(self.client.get("/api/series"))], [album["id"]])
        # Editing the preset afterwards does not touch the assembled album.
        next(e for e in preset["entries"] if e["key"] == "character")["value"] = "someone else"
        self.ok(self.client.patch(f"/api/series/{ws['id']}", json={"presets": ws["presets"]}))
        again = self.ok(self.client.get(f"/api/series/{album['id']}"))
        self.assertEqual(again["variables"]["character"], "nanami")
        # 开始: the first image of every panel goes straight into the album.
        pid = ep["panels"][0]["id"]
        job = self.client.post(
            f"/api/episodes/{ep['id']}/render",
            json={"panel_ids": [pid], "candidates": 2, "adopt_first": True},
        )
        self.drain(self.ok(job))
        takes = self.ok(self.client.get(f"/api/episodes/{ep['id']}"))["takes"]
        self.assertEqual(sorted(t["status"] for t in takes), ["adopted", "candidate"])

    def test_clone_task_copies_frames_presets_and_profile_but_no_images(self):
        ws = self.workshop()
        board = self.ok(self.client.get(f"/api/series/{ws['id']}/episodes"))["items"][0]
        preset = next(p for p in ws["presets"] if p["title"] == "七海 · 标准角色设定")
        out = self.ok(
            self.client.post(
                "/api/workshop/assemble",
                json={"storyboard_id": board["id"], "preset_ids": [preset["id"]], "title": "夏"},
            ),
            201,
        )
        album, ep = out["series"], out["episode"]
        self.drain(
            self.ok(
                self.client.post(
                    f"/api/episodes/{ep['id']}/render",
                    json={"panel_ids": [ep["panels"][0]["id"]], "adopt_first": True},
                )
            )
        )
        copy = self.ok(self.client.post(f"/api/workshop/tasks/{album['id']}/clone"), 201)
        self.assertEqual((copy["series"]["title"], copy["series"]["status"]), ("夏 副本", "draft"))
        self.assertEqual(copy["series"]["variables"], album["variables"])
        self.assertEqual([p["title"] for p in copy["series"]["presets"]], ["七海 · 标准角色设定"])
        self.assertEqual(
            [p["description"] for p in copy["episode"]["panels"]],
            [p["description"] for p in ep["panels"]],
        )
        self.assertEqual(copy["episode"]["takes"], [])
        named = self.client.post(f"/api/workshop/tasks/{album['id']}/clone", json={"title": "秋"})
        self.assertEqual(self.ok(named, 201)["series"]["title"], "秋")
        self.assertEqual(self.client.post(f"/api/workshop/tasks/{ws['id']}/clone").status_code, 404)
        self.assertEqual(self.client.post("/api/workshop/tasks/nope/clone").status_code, 404)

    def test_assemble_rejects_unknown_story_or_preset(self):
        ws = self.workshop()
        board = self.ok(self.client.get(f"/api/series/{ws['id']}/episodes"))["items"][0]
        r = self.client.post("/api/workshop/assemble", json={"storyboard_id": "nope"})
        self.assertEqual(r.status_code, 404)
        r = self.client.post(
            "/api/workshop/assemble", json={"storyboard_id": board["id"], "preset_ids": ["x"]}
        )
        self.assertEqual(r.status_code, 404)
