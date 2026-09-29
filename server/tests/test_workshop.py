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
        first = next(t["id"] for t in takes if t["status"] == "adopted")
        # 单幕生成 again with adopt_first keeps the album image …
        self.drain(
            self.ok(
                self.client.post(
                    f"/api/episodes/{ep['id']}/render",
                    json={"panel_ids": [pid], "candidates": 1, "adopt_first": True},
                )
            )
        )
        takes = self.ok(self.client.get(f"/api/episodes/{ep['id']}"))["takes"]
        self.assertEqual([t["id"] for t in takes if t["status"] == "adopted"], [first])
        # … 单幕重跑 (adopt_replace) puts the new image in and keeps the old one as a candidate.
        self.drain(
            self.ok(
                self.client.post(
                    f"/api/episodes/{ep['id']}/render",
                    json={"panel_ids": [pid], "candidates": 2, "adopt_replace": True},
                )
            )
        )
        takes = self.ok(self.client.get(f"/api/episodes/{ep['id']}"))["takes"]
        adopted = [t for t in takes if t["status"] == "adopted"]
        self.assertEqual(len(adopted), 1)
        self.assertNotEqual(adopted[0]["id"], first)
        # The first new candidate to finish (both may render at once).
        self.assertIn(adopted[0]["id"], [t["id"] for t in takes[-2:]])
        self.assertEqual(next(t for t in takes if t["id"] == first)["status"], "candidate")

    def test_storyboard_keeps_its_starting_template_and_the_album_snapshots_it(self):
        ws = self.workshop()
        board = self.ok(
            self.client.post(
                f"/api/series/{ws['id']}/episodes",
                json={"title": "起手", "base_prompt": "{character}, {style}, "},
            ),
            201,
        )
        self.assertEqual(board["base_prompt"], "{character}, {style}, ")
        board = self.ok(
            self.client.patch(f"/api/episodes/{board['id']}", json={"base_prompt": "{scene}, "})
        )
        self.assertEqual(board["base_prompt"], "{scene}, ")
        self.ok(
            self.client.post(
                f"/api/episodes/{board['id']}/panels", json={"panel": {"description": "一"}}
            ),
            201,
        )
        preset = ws["presets"][0]
        out = self.ok(
            self.client.post(
                "/api/workshop/assemble",
                json={"storyboard_id": board["id"], "preset_ids": [preset["id"]]},
            ),
            201,
        )
        self.assertEqual(out["episode"]["base_prompt"], "{scene}, ")
        # Patching another field leaves the template alone.
        self.assertEqual(
            self.ok(self.client.patch(f"/api/episodes/{board['id']}", json={"title": "x"}))[
                "base_prompt"
            ],
            "{scene}, ",
        )

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

    def test_preview_makes_a_one_frame_album_for_the_preset(self):
        ws = self.workshop()
        preset = next(p for p in ws["presets"] if p["title"] == "七海 · 标准角色设定")
        boards = self.ok(self.client.get(f"/api/series/{ws['id']}/episodes"))["total"]
        out = self.ok(
            self.client.post(
                "/api/workshop/preview",
                json={"preset_ids": [preset["id"]], "prompt": "{character}, {outfit}, {style}"},
            ),
            201,
        )
        album, ep = out["series"], out["episode"]
        self.assertEqual(album["title"], "七海 · 标准角色设定 · 试绘")
        self.assertEqual(
            (album["kind"], album["status"], album["subtitle"]), ("album", "draft", "预设试绘")
        )
        self.assertEqual(album["variables"]["character"], "nanami")
        self.assertEqual([p["id"] for p in album["presets"]], [preset["id"]])
        self.assertEqual(len(ep["panels"]), 1)
        self.assertEqual(
            ep["panels"][0]["overrides"]["raw_prompt"], "{character}, {outfit}, {style}"
        )
        self.assertEqual(self.ctx.engine.list(), [])  # nothing is generated until 开始生成
        # No storyboard was created on the way: the workshop still lists the same boards.
        self.assertEqual(
            self.ok(self.client.get(f"/api/series/{ws['id']}/episodes"))["total"], boards
        )
        r = self.client.post("/api/workshop/preview", json={"preset_ids": ["x"], "prompt": "a"})
        self.assertEqual(r.status_code, 404)
        r = self.client.post(
            "/api/workshop/preview", json={"preset_ids": [preset["id"]], "prompt": " "}
        )
        self.assertEqual(r.status_code, 400)

    def test_assemble_rejects_unknown_story_or_preset(self):
        ws = self.workshop()
        board = self.ok(self.client.get(f"/api/series/{ws['id']}/episodes"))["items"][0]
        r = self.client.post("/api/workshop/assemble", json={"storyboard_id": "nope"})
        self.assertEqual(r.status_code, 404)
        r = self.client.post(
            "/api/workshop/assemble", json={"storyboard_id": board["id"], "preset_ids": ["x"]}
        )
        self.assertEqual(r.status_code, 404)
