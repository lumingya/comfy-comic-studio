"""HTTP API: settings, registry, workflows, profiles, instances, assets, jobs + WebSocket,
`.mio.zip` bundles, the legacy importer and the script assistant."""

import importlib
import sys
import unittest
from pathlib import Path

from mio_server.comfy.compile import BUILTINS

from .api_harness import WS, ApiCase, FakeLLM
from .legacy_fixture import copy_shipped_legacy
from .test_compile_executor import png

GRAPH = {
    "3": {"class_type": "KSampler", "inputs": {"seed": 1, "steps": 20, "positive": ["6", 0]}},
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "", "clip": ["4", 1]},
        "_meta": {"title": "[mio:prompt]"},
    },
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
    "9": {
        "class_type": "SaveImage",
        "inputs": {"images": ["3", 0]},
        "_meta": {"title": "[mio:output]"},
    },
}


class SettingsRegistryTests(ApiCase):
    def test_api_key_is_masked_and_preserved(self):
        s = self.ok(self.client.patch("/api/settings", json={"llm": {"api_key": "sk-secret"}}))
        self.assertNotIn("sk-secret", str(s))
        masked = s["llm"]["api_key"]
        s = self.ok(
            self.client.patch("/api/settings", json={"llm": {"api_key": masked}, "trash_days": 7})
        )
        self.assertEqual(self.ctx.settings().llm.api_key, "sk-secret")
        self.assertEqual(s["trash_days"], 7)
        bad = self.client.patch("/api/settings", json={"trash_days": 0})
        self.assertIn(bad.status_code, (400, 422))

    def test_registry_lists_builtin_contributions(self):
        reg = self.ok(self.client.get("/api/registry"))
        ids = {point: {c["id"] for c in items} for point, items in reg.items()}
        self.assertLessEqual({"comfy.render", "cloud.render", "qa.check"}, ids["job_executor"])
        self.assertIn("webtoon", ids["slice_preset"])
        self.assertLessEqual(set(BUILTINS), ids["workflow_template"])


class LibraryTests(ApiCase):
    def test_workflow_import_compile_copy_delete(self):
        ui = self.client.post(
            "/api/workflows", json={"name": "ui", "graph": {"nodes": [], "links": []}}
        )
        self.assertEqual(ui.status_code, 400)
        self.assertIn("API", ui.json()["detail"])
        wf = self.ok(self.client.post("/api/workflows", json={"name": "测试", "graph": GRAPH}), 201)
        self.assertEqual(wf["describe"]["nodes"], 4)
        listed = {w["id"] for w in self.ok(self.client.get("/api/workflows"))}
        self.assertIn(wf["id"], listed)
        compiled = self.ok(
            self.client.post(
                f"/api/workflows/{wf['id']}/compile", json={"values": {"prompt": "1girl"}}
            )
        )
        self.assertEqual(compiled["graph"]["6"]["inputs"]["text"], "1girl")
        copy = self.ok(self.client.post(f"/api/workflows/{wf['id']}/copy"), 201)
        self.assertTrue(copy["name"].endswith("（副本）"))
        self.ok(self.client.delete(f"/api/workflows/{copy['id']}"), 204)
        self.assertNotIn(copy["id"], {w["id"] for w in self.ok(self.client.get("/api/workflows"))})
        builtin = next(iter(BUILTINS))
        self.assertEqual(self.client.delete(f"/api/workflows/{builtin}").status_code, 409)
        diag = self.ok(self.client.post(f"/api/workflows/{wf['id']}/diagnose?instance_id=c1"))
        self.assertIn("instance", diag)

    def test_profiles_and_instances(self):
        profiles = self.ok(self.client.get("/api/profiles"))
        self.assertIn("profile_default", {p["id"] for p in profiles})
        self.assertEqual(self.client.delete("/api/profiles/profile_default").status_code, 409)
        body = {**profiles[0], "id": "profile_x", "name": "X"}
        self.ok(self.client.post("/api/profiles", json=body), 201)
        broken = {**body, "id": "profile_y", "draft": [{"workflow_id": "wf_missing"}]}
        self.assertEqual(self.client.post("/api/profiles", json=broken).status_code, 404)
        self.ok(self.client.delete("/api/profiles/profile_x"), 204)

        inst = self.ok(
            self.client.post("/api/instances", json={"id": "c2", "base_url": "http://b"}), 201
        )
        self.assertEqual(inst["id"], "c2")
        listed = self.ok(self.client.get("/api/instances"))
        self.assertEqual({i["id"] for i in listed["instances"]}, {"c1", "c2"})
        self.assertIn("c2", str(listed["pool"]))
        health = self.ok(self.client.get("/api/instances/c2/health"))
        self.assertTrue(health["ok"])
        self.ok(self.client.delete("/api/instances/c2"), 204)
        self.assertNotIn("c2", str(self.ok(self.client.get("/api/instances"))["pool"]))

    def test_asset_upload_and_thumbnail(self):
        data = png((10, 20, 30))
        asset = self.ok(self.client.post("/api/assets?filename=a.png", content=data), 201)
        self.assertEqual(asset["mime"], "image/png")
        self.assertEqual(self.client.get(f"/api/assets/{asset['id']}").content, data)
        thumb = self.client.get(f"/api/assets/{asset['id']}?thumb=64")
        self.assertEqual(thumb.headers["content-type"], "image/jpeg")
        self.assertEqual(self.client.post("/api/assets", content=b"").status_code, 400)


class JobsTests(ApiCase):
    def test_job_controls_and_websocket(self):
        _, ep = self.make_episode()
        with self.client.websocket_connect(f"{WS}/api/ws/jobs?previews=false") as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")
            pid = ep["panels"][0]["id"]
            job = self.ok(
                self.client.post(f"/api/episodes/{ep['id']}/render", json={"panel_ids": [pid]})
            )
            event = ws.receive_json()
            self.assertEqual(event["job_id"], job["id"])
        self.ok(self.client.post(f"/api/jobs/{job['id']}/pause"))
        self.assertTrue(self.ok(self.client.get(f"/api/jobs/{job['id']}"))["paused"])
        self.ok(self.client.post(f"/api/jobs/{job['id']}/resume"))
        self.drain(job)
        self.assertTrue(self.ok(self.client.get(f"/api/jobs/{job['id']}/events")))
        self.assertEqual(
            [j["id"] for j in self.ok(self.client.get(f"/api/jobs?owner={ep['id']}"))], [job["id"]]
        )
        again = self.ok(
            self.client.post(
                f"/api/jobs/{job['id']}/retry", json={"indexes": [0], "include_complete": True}
            )
        )
        self.assertIn(again["state"], ("queued", "running"))
        self.ok(self.client.post(f"/api/jobs/{job['id']}/cancel"))
        self.assertEqual(self.client.get("/api/jobs/nope").status_code, 404)


class BundleLegacyAssistantTests(ApiCase):
    def test_bundle_round_trip_renames_on_collision(self):
        series, ep = self.make_episode()
        pid = ep["panels"][0]["id"]
        self.drain(
            self.ok(self.client.post(f"/api/episodes/{ep['id']}/render", json={"panel_ids": [pid]}))
        )
        data = self.client.get(f"/api/series/{series['id']}/bundle")
        self.assertIn(".mio.zip", data.headers["content-disposition"])
        report = self.ok(self.client.post("/api/bundles", content=data.content), 201)
        self.assertTrue(report["renamed"])
        self.assertEqual(report["bad_assets"], [])
        clone = self.ok(self.client.get(f"/api/series/{report['series_id']}"))
        self.assertTrue(clone["title"].endswith("（导入）"))
        page = self.ok(self.client.get(f"/api/series/{clone['id']}/episodes"))
        self.assertEqual(page["total"], 1)
        copy = self.ok(self.client.get(f"/api/episodes/{page['items'][0]['id']}"))
        self.assertNotEqual(copy["id"], ep["id"])
        self.assertEqual(
            len(copy["takes"]), len(self.ok(self.client.get(f"/api/episodes/{ep['id']}"))["takes"])
        )
        self.assertEqual(
            self.client.get(f"/api/assets/{copy['takes'][0]['asset_id']}").status_code, 200
        )
        self.assertEqual(self.client.post("/api/bundles", content=b"not a zip").status_code, 400)

    def test_legacy_import_via_api(self):
        root = Path(self.tmp) / "legacy"
        copy_shipped_legacy(root)
        scan = self.ok(self.client.get("/api/legacy/scan", params={"root": str(root)}))
        self.assertGreaterEqual(scan["storyboards"], 1)
        report = self.ok(self.client.post("/api/legacy/import", json={"root": str(root)}))
        self.assertEqual(len(report["series"]), 1)
        again = self.ok(self.client.post("/api/legacy/import", json={"root": str(root)}))
        self.assertEqual(again["series"], [])
        missing = self.client.get("/api/legacy/scan", params={"root": str(root / "nope")})
        self.assertEqual(missing.status_code, 400)

    def test_assistant_propose_then_apply(self):
        _, ep = self.make_episode()

        def edit(story):
            story["panels"][0]["description"] = "rain hits the window"
            return story

        FakeLLM.edit = staticmethod(edit)
        proposal = self.ok(
            self.client.post(
                f"/api/episodes/{ep['id']}/assistant/propose", json={"instruction": "加点雨"}
            )
        )
        ops = proposal["ops"]
        self.assertEqual([o["op"] for o in ops], ["update_panel"])
        result = self.ok(
            self.client.post(
                f"/api/episodes/{ep['id']}/assistant/apply",
                json={
                    "ops": ops,
                    "accepted": [ops[0]["id"]],
                    "base_revision": proposal["base_revision"],
                },
            )
        )
        self.assertEqual(result["applied"], [ops[0]["id"]])
        ep = self.ok(self.client.get(f"/api/episodes/{ep['id']}"))
        self.assertEqual(ep["panels"][0]["description"], "rain hits the window")
        stale = self.client.post(
            f"/api/episodes/{ep['id']}/assistant/apply",
            json={
                "ops": ops,
                "accepted": [ops[0]["id"]],
                "base_revision": proposal["base_revision"],
            },
        )
        self.assertEqual(stale.status_code, 409)


class LazyAppTests(unittest.TestCase):
    def test_importing_app_module_opens_nothing(self):
        sys.modules.pop("mio_server.app", None)
        module = importlib.import_module("mio_server.app")
        self.assertNotIn("app", vars(module))


if __name__ == "__main__":
    unittest.main()
