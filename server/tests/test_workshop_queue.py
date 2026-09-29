"""装配队列 on the server: card order, the sequential lane, concurrency and storage warnings."""

from __future__ import annotations

from collections import namedtuple
from unittest import mock

from mio_server.queue import lane_finished

from .api_harness import ApiCase
from .test_jobs import drain

Usage = namedtuple("Usage", "total used free")


class QueueTest(ApiCase):
    def setUp(self):
        super().setUp()
        ws = self.ok(self.client.get("/api/workshop"))
        self.board = self.ok(self.client.get(f"/api/series/{ws['id']}/episodes"))["items"][0]
        self.preset = ws["presets"][0]["id"]

    def assemble(self, title):
        out = self.ok(
            self.client.post(
                "/api/workshop/assemble",
                json={
                    "storyboard_id": self.board["id"],
                    "preset_ids": [self.preset],
                    "title": title,
                },
            ),
            201,
        )
        return out["series"]["id"], out["episode"]["id"]

    def queue(self):
        return self.ok(self.client.get("/api/workshop/queue"))

    def jobs_of(self, episode_id):
        return self.ctx.engine.list(owner=episode_id)

    def test_lane_starts_albums_one_after_another_and_skips_finished_ones(self):
        a, ep_a = self.assemble("A")
        b, ep_b = self.assemble("B")
        q = self.ok(self.client.post("/api/workshop/queue/start", json={"album_ids": [a, b]}))
        self.assertEqual((q["active"], q["lane"]), (a, [b]))
        self.assertEqual(len(self.jobs_of(ep_a)), 1)
        self.assertEqual(self.jobs_of(ep_b), [])  # B waits for A
        # Every panel of A lands in the album (adopt_first), and only then B starts.
        drain(self.ctx.engine, q["active_job"])
        q = self.queue()
        self.assertEqual((q["active"], q["lane"]), (b, []))
        drain(self.ctx.engine, q["active_job"])
        self.assertEqual(self.queue()["active"], None)
        ep = self.ok(self.client.get(f"/api/episodes/{ep_a}"))
        adopted = {t["panel_id"] for t in ep["takes"] if t["status"] == "adopted"}
        self.assertEqual(adopted, {p["id"] for p in ep["panels"]})
        # A finished album has nothing missing: queuing it again starts no job.
        q = self.ok(self.client.post("/api/workshop/queue/start", json={"album_ids": [a]}))
        self.assertEqual((q["active"], q["lane"]), (None, []))
        self.assertEqual(len(self.jobs_of(ep_a)), 1)

    def test_pause_holds_the_lane_and_resume_releases_it(self):
        a, _ = self.assemble("A")
        b, ep_b = self.assemble("B")
        q = self.ok(self.client.post("/api/workshop/queue/start", json={"album_ids": [a, b]}))
        self.ok(self.client.post("/api/workshop/queue/pause"))
        drain(self.ctx.engine, q["active_job"])
        q = self.queue()
        self.assertEqual((q["active"], q["lane"], q["paused"]), (None, [b], True))
        self.assertEqual(self.jobs_of(ep_b), [])
        q = self.ok(self.client.post("/api/workshop/queue/resume"))
        self.assertEqual((q["active"], q["paused"]), (b, False))

    def test_a_manual_pause_holds_but_an_auto_pause_or_review_moves_on(self):
        self.assertFalse(lane_finished({"state": "paused", "error": None}))
        self.assertTrue(lane_finished({"state": "paused", "error": "连续失败 3 项，已暂停。"}))
        for state in ("completed", "failed", "canceled", "blocked"):
            self.assertTrue(lane_finished({"state": state, "error": None}))
        self.assertFalse(lane_finished({"state": "running", "error": None}))
        self.assertTrue(lane_finished(None))
        a, _ = self.assemble("A")
        b, _ = self.assemble("B")
        q = self.ok(self.client.post("/api/workshop/queue/start", json={"album_ids": [a, b]}))
        self.ok(self.client.post(f"/api/jobs/{q['active_job']}/pause"))
        self.assertEqual(self.queue()["active"], a)

    def test_remove_clear_and_trash_take_albums_out_of_the_lane(self):
        a, _ = self.assemble("A")
        b, _ = self.assemble("B")
        c, _ = self.assemble("C")
        self.ok(self.client.post("/api/workshop/queue/start", json={"album_ids": [a, b, c]}))
        q = self.ok(self.client.post("/api/workshop/queue/remove", json={"album_id": b}))
        self.assertEqual(q["lane"], [c])
        self.ok(self.client.delete(f"/api/series/{c}"), 204)
        self.assertEqual(self.queue()["lane"], [])
        q = self.ok(self.client.post("/api/workshop/queue/clear"))
        self.assertEqual((q["active"], q["active_job"], q["lane"]), (None, None, []))

    def test_card_order_is_kept_and_the_lane_follows_it(self):
        a, _ = self.assemble("A")
        b, _ = self.assemble("B")
        c, _ = self.assemble("C")
        self.ok(self.client.post("/api/workshop/queue/start", json={"album_ids": [a, b, c]}))
        q = self.ok(self.client.put("/api/workshop/queue/order", json={"album_ids": [c, a, b, c]}))
        self.assertEqual(q["order"], [c, a, b])
        self.assertEqual(q["lane"], [c, b])
        # 清空已完成 moves an album to the shelf: it leaves the order too.
        self.ok(self.client.patch(f"/api/series/{a}", json={"status": "active"}))
        self.assertEqual(self.queue()["order"], [c, b])

    def test_concurrency_default_and_per_album_reach_running_jobs(self):
        q = self.queue()
        self.assertEqual((q["concurrency"], q["auto_concurrency"]), (None, 2))
        a, _ = self.assemble("A")
        self.ok(self.client.patch("/api/workshop/queue", json={"concurrency": 3}))
        q = self.ok(self.client.post("/api/workshop/queue/start", json={"album_ids": [a]}))
        job = q["active_job"]
        self.assertEqual(self.ctx.engine.get(job, items=False)["window"], 3)
        # The album's own value wins and is applied to the job already running …
        self.ok(self.client.patch(f"/api/series/{a}", json={"concurrency": 5}))
        self.assertEqual(self.ctx.engine.get(job, items=False)["window"], 5)
        # … so a new default leaves it alone; clearing the album's value follows the default.
        self.ok(self.client.patch("/api/workshop/queue", json={"concurrency": 4}))
        self.assertEqual(self.ctx.engine.get(job, items=False)["window"], 5)
        self.ok(self.client.patch(f"/api/series/{a}", json={"concurrency": None}))
        self.assertEqual(self.ctx.engine.get(job, items=False)["window"], 4)
        self.ok(self.client.patch("/api/workshop/queue", json={"concurrency": None}))
        self.assertEqual(self.ctx.engine.get(job, items=False)["window"], 2)
        self.assertEqual(
            self.client.patch("/api/workshop/queue", json={"concurrency": 0}).status_code, 422
        )

    def test_an_album_that_cannot_start_gets_a_notice_and_is_skipped(self):
        a, _ = self.assemble("A")
        q = self.ok(
            self.client.post("/api/workshop/queue/start", json={"album_ids": ["series_gone", a]})
        )
        self.assertEqual(q["active"], a)
        self.assertIn("series_gone", q["notices"])
        # Queuing it again clears the old notice until its turn comes (A is still running).
        q = self.ok(
            self.client.post("/api/workshop/queue/start", json={"album_ids": ["series_gone"]})
        )
        self.assertNotIn("series_gone", q["notices"])
        self.assertEqual(q["lane"], ["series_gone"])

    def test_low_disk_warns_and_holds_the_lane(self):
        a, ep_a = self.assemble("A")
        low = Usage(100, 100, 50 * 1024 * 1024)
        with mock.patch("mio_server.queue.shutil.disk_usage", return_value=low):
            q = self.ok(self.client.post("/api/workshop/queue/start", json={"album_ids": [a]}))
            self.assertIn("50 MB", q["fault"])
            self.assertEqual((q["active"], q["lane"]), (None, [a]))
        self.assertEqual(self.jobs_of(ep_a), [])
        q = self.queue()
        self.assertIsNone(q["fault"])
        self.assertEqual(q["active"], a)
