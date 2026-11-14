from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.auth import issue

from .longform_fixture import LongformFixture


class LongformApiTests(LongformFixture):
    def test_v2_read_previews_write_commands_and_revision_contract(self):
        reader_token, reader = issue("Reader", ["read"])
        writer_token, writer = issue("Writer", ["read", "write"])
        self.ctx.store.put_doc(reader_token)
        self.ctx.store.put_doc(writer_token)
        read_headers, write_headers = (
            {"Authorization": f"Bearer {raw}"} for raw in (reader, writer)
        )
        app = create_app(self.ctx, serve_web=False)
        prefix = f"/api/v2/series/{self.series.id}"
        command = {"key": "hero", "action": "rename", "value": "lead"}
        with TestClient(app, base_url="http://127.0.0.1") as client:
            denied = client.post(prefix + "/variables/find", json={"key": "hero"})
            self.assertEqual(denied.status_code, 401, denied.text)
            found = client.post(
                prefix + "/variables/find", headers=read_headers, json={"key": "hero"}
            )
            self.assertEqual(found.status_code, 200, found.text)
            preview = client.post(prefix + "/variables/preview", headers=read_headers, json=command)
            self.assertEqual(preview.status_code, 200, preview.text)
            body = {**command, "expected_head": preview.json()["head"]}
            forbidden = client.post(prefix + "/variables/apply", headers=read_headers, json=body)
            self.assertEqual(forbidden.status_code, 403, forbidden.text)
            applied = client.post(prefix + "/variables/apply", headers=write_headers, json=body)
            self.assertEqual(applied.status_code, 200, applied.text)
            self.assertEqual(applied.json()["series"]["variables"], {"lead": "Alice"})
            stale = client.post(prefix + "/variables/apply", headers=write_headers, json=body)
            self.assertEqual(stale.status_code, 409, stale.text)
            transfer = self.transfer(source_revision=1).model_dump()
            copied = client.post(prefix + "/panels/transfer", headers=write_headers, json=transfer)
            self.assertEqual(copied.status_code, 200, copied.text)
            self.assertTrue(copied.json()["notes"])
            stale = client.post(prefix + "/panels/transfer", headers=write_headers, json=transfer)
            self.assertEqual(stale.status_code, 409, stale.text)
            invalid = client.post(
                prefix + "/panels/transfer", headers=write_headers, json={"panel_ids": ["a"]}
            )
            self.assertEqual(invalid.status_code, 422, invalid.text)
            duplicate = client.post(
                "/api/v2/episodes/source/copy", headers=write_headers, json={"revision": 1}
            )
            self.assertEqual(duplicate.status_code, 201, duplicate.text)
            episodes = self.store.list_episodes(self.series.id)
            reordered = client.post(
                prefix + "/episodes/reorder",
                headers=write_headers,
                json={
                    "order": [e.id for e in reversed(episodes)],
                    "revisions": {e.id: e.revision for e in episodes},
                },
            )
            self.assertEqual(reordered.status_code, 200, reordered.text)
            self.assertEqual(reordered.json()[0]["id"], duplicate.json()["episode"]["id"])
            self.assertEqual(len(self.ctx.engine.list()), 0)

    def test_local_and_v2_share_typed_extensible_operations(self):
        app = create_app(self.ctx, serve_web=False)
        with TestClient(app, base_url="http://127.0.0.1") as client:
            local = client.post(
                f"/api/series/{self.series.id}/variables/find", json={"key": "hero"}
            )
            self.assertEqual(local.status_code, 200, local.text)
            schema = client.get("/api/v2/openapi.json").json()
            operation = schema["paths"]["/series/{series_id}/panels/transfer"]["post"]
            self.assertEqual(operation["operationId"], "transfer_panels")
            self.assertEqual(
                operation["x-mio-operation"], "POST /series/{series_id}/panels/transfer"
            )
            body = schema["components"]["schemas"]["PanelTransfer"]
            self.assertIn("source_revision", body["required"])
            self.assertIn("target_revision", body["required"])
            apply = schema["components"]["schemas"]["VariableApply"]
            self.assertIn("expected_head", apply["required"])
