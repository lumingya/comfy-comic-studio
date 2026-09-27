"""Regression coverage for the restored workshop -> new engine boundary (no user data)."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from mio_server import workshop as W
from mio_server.models import Panel

from .api_harness import ApiCase


class WorkshopBridgeTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "empty-legacy"

    def board(self):
        ws = self.ok(self.client.get("/api/workshop"))
        ep = self.ctx.store.list_episodes(ws["id"])[0]
        ep.panels = [Panel(order=0)]
        ep.strip.width = 960
        ep.strip.text_direction = "vertical"
        ep.strip.background = "#eef5ee"
        self.ctx.store.save_episode(ep)
        return ws, ep

    def test_simultaneous_first_load_creates_one_workshop(self):
        original = W.find_workshop

        def slow_find(store):
            result = original(store)
            if result is None:
                time.sleep(0.05)  # let all unlocked callers observe the empty store
            return result

        with mock.patch.object(W, "find_workshop", side_effect=slow_find):
            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(
                    pool.map(
                        lambda _: W.ensure_workshop(self.ctx.store, self.ctx.legacy_root),
                        range(6),
                    )
                )
        self.assertEqual(len({s.id for s in results}), 1)
        self.assertEqual(len(self.ctx.store.list_series()), 1)
        self.assertEqual(len(self.ctx.store.list_episodes(results[0].id)), 1)

    def test_assembly_copies_canvas_settings_without_candidates(self):
        _, board = self.board()
        out = self.ok(
            self.client.post("/api/workshop/assemble", json={"storyboard_id": board.id}), 201
        )
        self.assertEqual(out["episode"]["strip"], board.strip.model_dump(mode="json"))
        self.assertEqual(out["episode"]["takes"], [])
        self.assertNotEqual(out["episode"]["id"], board.id)

    def test_missing_profile_is_rejected_before_creating_an_album(self):
        _, board = self.board()
        response = self.client.post(
            "/api/workshop/assemble",
            json={"storyboard_id": board.id, "profile_id": "deleted-profile"},
        )
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.ok(self.client.get("/api/series")), [])

    def test_empty_story_is_rejected_before_creating_a_dead_queue_card(self):
        ws = self.ok(self.client.get("/api/workshop"))
        board = self.ctx.store.list_episodes(ws["id"])[0]
        response = self.client.post("/api/workshop/assemble", json={"storyboard_id": board.id})
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.ok(self.client.get("/api/series")), [])
