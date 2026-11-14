"""Public PCP capture and recovery contracts, with no live ComfyUI or generation."""

import copy
from unittest.mock import Mock, patch

from mio_server.auth import required_scope
from mio_server.comfy.client import ComfyError
from mio_server.jobs import ItemSpec

from .api_harness import ApiCase

GRAPH = {
    "1": {"class_type": "ParameterControlPanel", "inputs": {"pcp_ui": ""}},
    "2": {
        "class_type": "SaveImage",
        "inputs": {"images": ["1", 0]},
        "_meta": {"title": "[mio:output:draft]"},
    },
}
PARAMETERS = [{"name": "steps", "type": "number", "value": 20}]


class StateApiTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.workflow = self.ok(
            self.client.post("/api/workflows", json={"name": "PCP", "graph": copy.deepcopy(GRAPH)}),
            201,
        )
        self.path = f"/workflows/{self.workflow['id']}/capture-state"
        self.remote = Mock()
        self.remote.get_json.return_value = {"parameters": copy.deepcopy(PARAMETERS)}
        self.factory = Mock(return_value=self.remote)
        self.ctx.comfy_client_factory = self.factory

    def token(self, *scopes):
        result = self.ok(
            self.client.post("/api/tokens", json={"name": "state-test", "scopes": list(scopes)}),
            201,
        )
        return {"Authorization": f"Bearer {result['token']}"}

    def capture(self, prefix="/api", headers=None):
        return self.client.post(prefix + self.path, params={"instance_id": "c1"}, headers=headers)

    def test_capture_returns_patchable_snapshot_without_mutating_or_submitting(self):
        headers = self.token("write")
        for prefix in ("/api", "/api/v2"):
            with self.subTest(prefix=prefix):
                result = self.ok(self.capture(prefix, headers))
                self.assertEqual(result, {"state": {"1": PARAMETERS}})
        self.factory.assert_called_with("http://fake")
        self.assertEqual(
            [call.args[0] for call in self.remote.get_json.call_args_list],
            ["/danbooru_gallery/pcp/load_config?node_id=1"] * 2,
        )
        self.remote.post_json.assert_not_called()
        self.remote.run.assert_not_called()
        stored = self.ctx.store.get_doc("workflow", self.workflow["id"])
        self.assertEqual(stored.config.state, {})
        self.assertEqual(self.ctx.engine.list(), [])
        self.assertEqual(self.ctx.store.list_docs("asset"), [])

    def test_capture_patch_compile_and_submit_freeze_the_reviewed_plan(self):
        state = self.ok(self.capture())["state"]
        workflow_path = f"/api/workflows/{self.workflow['id']}"
        config = {**self.workflow["config"], "state": state, "frontend": {"1": {"steps": 7}}}
        self.ok(self.client.patch(workflow_path, json={"config": config}))
        compiled = self.ok(self.client.post(workflow_path + "/compile", json={"variant": "draft"}))
        plan = compiled["frontend_state"]["1"]
        self.assertEqual(plan["saved"], PARAMETERS)
        self.assertEqual(plan["desired"][0]["value"], 7)
        self.assertEqual(self.ctx.engine.list(), [])
        profile = self.ok(
            self.client.post(
                "/api/profiles",
                json={
                    "name": "PCP",
                    "draft": [{"workflow_id": self.workflow["id"], "variant": "draft"}],
                    "instances": ["c1"],
                },
            ),
            201,
        )
        _, episode = self.make_episode()
        job = self.ok(
            self.client.post(
                f"/api/episodes/{episode['id']}/render",
                json={
                    "profile_id": profile["id"],
                    "panel_ids": [episode["panels"][0]["id"]],
                    "candidates": 1,
                },
            )
        )
        self.assertEqual(job["items"][0]["input"]["stages"][0]["frontend_state"], {"1": plan})
        config["state"]["1"][0]["value"] = 100
        self.ok(self.client.patch(workflow_path, json={"config": config}))
        frozen = self.ctx.engine.get(job["id"])["items"][0]["input"]["stages"][0]
        self.assertEqual(frozen["frontend_state"]["1"]["desired"][0]["value"], 7)
        self.remote.post_json.assert_not_called()
        self.remote.run.assert_not_called()

    def test_missing_or_invalid_plugin_state_has_clear_error_and_no_save(self):
        for value in ([], {}, "invalid", [{"name": "x"}, {"name": "x"}]):
            with self.subTest(value=value):
                self.remote.get_json.return_value = {"parameters": value}
                response = self.capture()
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["kind"], "invalid")
                self.assertIn("节点 1", response.json()["detail"])
        for error in (ComfyError("plugin unavailable", status=404), OSError("offline")):
            with self.subTest(error=type(error).__name__):
                self.remote.get_json.side_effect = error
                response = self.capture()
                self.assertEqual(response.status_code, 400)
                self.assertIn("对应插件可用", response.json()["detail"])
        self.assertEqual(self.ctx.store.get_doc("workflow", self.workflow["id"]).config.state, {})
        self.remote.post_json.assert_not_called()

    def test_no_stateful_nodes_or_missing_documents_do_not_contact_remote(self):
        self.ok(
            self.client.patch(
                f"/api/workflows/{self.workflow['id']}",
                json={"graph": {"1": {"class_type": "SaveImage", "inputs": {}}}},
            )
        )
        self.assertEqual(self.capture().status_code, 400)
        self.assertEqual(
            self.client.post("/api/workflows/missing/capture-state?instance_id=c1").status_code,
            404,
        )
        self.assertEqual(
            self.client.post("/api" + self.path + "?instance_id=missing").status_code, 404
        )
        self.factory.assert_not_called()

    def test_capture_requires_write_and_restore_requires_render(self):
        self.assertEqual(required_scope("POST", self.path), "write")
        job = self.ctx.engine.submit("test", [ItemSpec({})])
        restore = f"/jobs/{job['id']}/items/0/restore-state"
        self.assertEqual(required_scope("POST", restore), "render")
        for scope in ("read", "render", "admin"):
            with self.subTest(capture_scope=scope):
                self.assertEqual(self.capture("/api/v2", self.token(scope)).status_code, 403)
        self.ok(self.capture("/api/v2", self.token("write")))
        report = {"restored": False, "status": "unknown", "result": None, "error": None}
        with patch.object(self.ctx.engine, "restore_state", return_value=report) as recover:
            for scope in ("read", "write", "admin"):
                with self.subTest(restore_scope=scope):
                    self.assertEqual(
                        self.client.post(
                            "/api/v2" + restore, headers=self.token(scope), json={}
                        ).status_code,
                        403,
                    )
            recover.assert_not_called()
            self.assertEqual(
                self.ok(
                    self.client.post(
                        "/api/v2" + restore,
                        headers=self.token("render"),
                        json={"confirm_stopped": True},
                    )
                ),
                report,
            )
            recover.assert_called_once_with(job["id"], 0, True, discard_result=False)
            self.ok(
                self.client.post(
                    "/api/v2" + restore,
                    headers=self.token("render"),
                    json={"confirm_stopped": True, "discard_result": True},
                )
            )
            recover.assert_called_with(job["id"], 0, True, discard_result=True)

    def test_schema_exposes_capture_and_restore_with_bearer_security(self):
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        capture = schema["paths"]["/workflows/{workflow_id}/capture-state"]["post"]
        self.assertEqual(capture["operationId"], "capture_workflow_state")
        self.assertEqual(capture["security"], [{"bearer": []}])
        self.assertIn("instance_id", [field["name"] for field in capture["parameters"]])
        restore = schema["paths"]["/jobs/{job_id}/items/{idx}/restore-state"]["post"]
        self.assertEqual(restore["security"], [{"bearer": []}])
