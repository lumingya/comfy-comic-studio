"""Restored workshop operations also belong to the scoped, generated API v2."""

from __future__ import annotations

from pathlib import Path

from mio_server.models import Panel

from .api_harness import ApiCase


class WorkshopV2Tests(ApiCase):
    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "no-legacy-data"

    def headers(self, *scopes):
        result = self.ok(
            self.client.post("/api/tokens", json={"name": "workshop test", "scopes": list(scopes)}),
            201,
        )
        return {"Authorization": "Bearer " + result["token"]}

    def test_workshop_requires_a_token_and_write_scope_for_assembly(self):
        self.assertEqual(self.client.get("/api/v2/workshop").status_code, 401)
        read = self.headers("read")
        ws = self.ok(self.client.get("/api/v2/workshop", headers=read))
        board = self.ctx.store.list_episodes(ws["id"])[0]
        board.panels = [Panel(order=0)]
        self.ctx.store.save_episode(board)
        body = {"storyboard_id": board.id}
        self.assertEqual(
            self.client.post("/api/v2/workshop/assemble", json=body, headers=read).status_code, 403
        )
        assembled = self.ok(
            self.client.post("/api/v2/workshop/assemble", json=body, headers=self.headers("write")),
            201,
        )
        self.assertEqual(assembled["series"]["kind"], "album")
        self.assertEqual(len(assembled["episode"]["panels"]), 1)
        self.assertEqual(self.ctx.engine.list(), [])  # assembly does not spend GPU / cloud credits

    def test_openapi_contains_scoped_workshop_operations(self):
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        for path, verb in (("/workshop", "get"), ("/workshop/assemble", "post")):
            self.assertEqual(schema["paths"][path][verb]["security"], [{"bearer": []}])
