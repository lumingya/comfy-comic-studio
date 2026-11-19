"""HTTP API: settings, registry, workflows, profiles, instances, assets, jobs + WebSocket,
`.mio.zip` bundles, the legacy importer and the script assistant."""

import importlib
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path

from PIL import Image

from mio_server.comfy.compile import BUILTINS
from mio_server.extensions.sdk import ExtensionAPI
from mio_server.importer import seed_albums
from mio_server.models import CloudRequestSnapshot

from .api_harness import WS, ApiCase, FakeLLM
from .shipped_data_fixture import SEED_KINDS, copy_shipped_data
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

    def test_extra_option_credentials_are_masked_and_preserved_by_settings_api(self):
        configured = self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "image_channels": [
                        {
                            "id": "vendor",
                            "kind": "vendor_images",
                            "extra_options": {
                                "quality_mode": "draft",
                                "auth": {"access_token": "never-return-this"},
                            },
                        }
                    ]
                },
            )
        )
        self.assertNotIn("never-return-this", str(configured))
        options = configured["image_channels"][0]["extra_options"]
        self.assertEqual(options["auth"], "••••••")
        updated = self.ok(
            self.client.patch(
                "/api/settings",
                json={"image_channels": configured["image_channels"], "image_channel": "vendor"},
            )
        )
        self.assertEqual(
            self.ctx.settings().image_channels[0].extra_options["auth"]["access_token"],
            "never-return-this",
        )
        self.assertNotIn("never-return-this", str(updated))

    def test_image_adapter_discovery_is_public_and_v2_read_scoped(self):
        class VendorAdapter:
            pass

        extension = ExtensionAPI("vendor", Path(self.tmp), self.ctx, digest="reviewed-digest")
        extension.contribute(
            "cloud_adapter",
            "vendor_images",
            VendorAdapter,
            title="Vendor images",
            capabilities=["generate", "reference"],
            schema={"type": "object", "properties": {"quality": {"type": "string"}}},
            supports_reference=True,
            supports_negative=False,
            supports_seed=False,
        )
        with self.assertRaises(ValueError):
            extension.contribute(
                "cloud_adapter", "bad_images", VendorAdapter, capabilities="generate"
            )
        local = self.ok(self.client.get("/api/image-adapters"))
        vendor = next(item for item in local if item["id"] == "vendor_images")
        self.assertEqual(vendor["capabilities"], ["generate", "reference"])
        self.assertEqual(vendor["schema"]["properties"]["quality"]["type"], "string")
        self.assertNotIn("value", vendor)

        token = self.ok(self.client.post("/api/tokens", json={"name": "reader"}), 201)
        denied = self.client.get("/api/v2/image-adapters")
        self.assertEqual(denied.status_code, 401)
        headers = {"Authorization": f"Bearer {token['token']}"}
        public = self.ok(self.client.get("/api/v2/image-adapters", headers=headers))
        self.assertEqual({item["id"] for item in public}, {item["id"] for item in local})
        self.assertEqual(
            self.client.post("/api/v2/image-adapters", headers=headers).status_code, 405
        )


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

    def test_svg_asset_is_served_as_an_image(self):
        svg = (
            b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'
        )
        asset = self.ok(self.client.post("/api/assets?filename=a.svg", content=svg), 201)
        for query in ("", "?thumb=640"):
            r = self.client.get(f"/api/assets/{asset['id']}{query}")
            self.assertEqual(r.headers["content-type"], "image/svg+xml")
            self.assertEqual(r.content, svg)
            self.assertIn("default-src 'none'", r.headers["content-security-policy"])


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
    def test_bundle_keeps_historical_cloud_reference_assets(self):
        series, ep = self.make_episode()
        pid = ep["panels"][0]["id"]
        self.drain(
            self.ok(self.client.post(f"/api/episodes/{ep['id']}/render", json={"panel_ids": [pid]}))
        )
        # These references survive only in a completed request, not today's panel or bible.
        refs = [
            self.ctx.assets.put(png(color), source="test") for color in ((12, 34, 56), (65, 43, 21))
        ]
        choices = [
            {"slot": 1, "asset_id": asset.id, "role": "front", "owner": "manual", "reason": "test"}
            for asset in refs
        ]
        snapshot = CloudRequestSnapshot.model_validate(
            {
                "kind": "openai_images",
                "requested": {"reference_mode": "manual", "refs": choices[:1]},
                "effective": {"reference_mode": "images", "refs": choices[1:]},
            }
        )

        def save_snapshot(episode):
            episode.takes[0].cloud_request = snapshot

        self.ctx.store.update_episode(ep["id"], save_snapshot)
        data = self.client.get(f"/api/series/{series['id']}/bundle").content
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for asset in refs:
                filename = self.ctx.assets.path(asset.id).name
                self.assertEqual(archive.read(f"assets/{filename}"), self.ctx.assets.read(asset.id))
        report = self.ok(self.client.post("/api/bundles", content=data), 201)
        copied = self.ctx.store.list_episodes(report["series_id"])[0]
        self.assertEqual(copied.takes[0].cloud_request, snapshot)

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
        copy_shipped_data(root)
        scan = self.ok(self.client.get("/api/legacy/scan", params={"root": str(root)}))
        self.assertGreaterEqual(scan["storyboards"], 1)
        report = self.ok(self.client.post("/api/legacy/import", json={"root": str(root)}))
        self.assertEqual(len(report["series"]), 1)
        again = self.ok(self.client.post("/api/legacy/import", json={"root": str(root)}))
        self.assertEqual(again["series"], [])
        missing = self.client.get("/api/legacy/scan", params={"root": str(root / "nope")})
        self.assertEqual(missing.status_code, 400)

    def test_first_start_brings_over_the_legacy_shelf(self):
        root = Path(self.tmp) / "legacy"
        copy_shipped_data(root, kinds=(*SEED_KINDS, "albums", "settings"))
        self.ok(self.client.patch("/api/settings", json={"collection_title": "遇见你，真好"}))
        report = seed_albums(self.ctx, root)
        self.assertEqual(len(report.albums), 2)
        cards = self.ok(self.client.get("/api/series"))
        card = next(c for c in cards if c["id"] == "series_album_edition_letter")
        rain = next(c for c in cards if c["id"] == "series_album_edition_rain_letter")
        self.assertEqual(rain["title"], "雨停以后，信会抵达")
        self.assertEqual((rain["panel_count"], rain["adopted_count"]), (4, 4))
        [rain_ep] = self.ok(self.client.get(f"/api/series/{rain['id']}/episodes"))["items"]
        rain_episode = self.ok(self.client.get(f"/api/episodes/{rain_ep['id']}"))
        for panel in rain_episode["panels"]:
            self.assertEqual(panel["aspect_ratio"], "4:3")
            self.assertEqual(
                (panel["overrides"]["width"], panel["overrides"]["height"]), (1448, 1086)
            )
            self.assertTrue(panel["overrides"]["raw_prompt"])
            self.assertTrue(panel["dialogues"][0]["text"])
        self.assertEqual(report.warnings, [])
        for take in rain_episode["takes"]:
            image_response = self.client.get(f"/api/assets/{take['asset_id']}")
            self.assertEqual(image_response.status_code, 200)
            self.assertLess(len(image_response.content), 1024 * 1024)
            with Image.open(io.BytesIO(image_response.content)) as image:
                self.assertEqual((image.format, image.size), ("WEBP", (1448, 1086)))
                self.assertFalse(any(image.info.get(k) for k in ("exif", "icc_profile", "xmp")))
        self.assertEqual(card["title"], "海风与未寄出的信")
        self.assertTrue(card["subtitle"].startswith("那些没说出口的话"))
        self.assertEqual((card["panel_count"], card["adopted_count"]), (1, 1))
        self.assertEqual((card["status"], card["cover_auto"]), ("archived", True))
        self.assertTrue(card["created_at"].startswith("2026-09-13"))
        self.assertEqual(card["bible"]["characters"][0]["name"], "七海")
        cover = self.client.get(f"/api/assets/{card['cover_asset_id']}")
        self.assertEqual(cover.status_code, 200)
        [ep] = self.ok(self.client.get(f"/api/series/{card['id']}/episodes"))["items"]
        episode = self.ok(self.client.get(f"/api/episodes/{ep['id']}"))
        self.assertEqual(
            episode["panels"][0]["dialogues"][0]["text"], "夏日的风经过窗边，故事还没有名字。"
        )
        settings = self.ok(self.client.get("/api/settings"))
        self.assertEqual(
            (settings["collection_title"], settings["legacy_seeded"]), ("遇见你，真好", True)
        )
        # Only once: a trashed or renamed shelf is not brought back on the next start.
        self.ok(self.client.delete(f"/api/series/{card['id']}"), 204)
        self.ok(self.client.patch(f"/api/series/{rain['id']}", json={"title": "我的画册"}))
        self.assertIsNone(seed_albums(self.ctx, root))
        [retained] = self.ok(self.client.get("/api/series"))
        self.assertEqual(retained["title"], "我的画册")
        # The manual import knows the book is already there.
        again = self.ok(self.client.post("/api/legacy/import", json={"root": str(root)}))
        self.assertEqual(again["albums"], [])
        self.assertEqual(
            self.ok(self.client.get("/api/legacy/scan", params={"root": str(root)}))["albums"], 2
        )

    def test_first_start_takes_the_legacy_collection_name(self):
        root = Path(self.tmp) / "legacy"
        (root / "albums").mkdir(parents=True)
        (root / "collections").mkdir()
        (root / "collections" / "a.json").write_text(
            '{"id": "c1", "title": "夏夜合集", "kind": "collections"}', encoding="utf-8"
        )
        seed_albums(self.ctx, root)
        self.assertEqual(self.ok(self.client.get("/api/settings"))["collection_title"], "夏夜合集")

    def test_first_start_takes_the_legacy_identity(self):
        root = Path(self.tmp) / "legacy"
        (root / "albums").mkdir(parents=True)
        (root / "settings").mkdir()
        prefs = {
            "signature": "纸间",
            "identity": {"workspaceName": "纸间漫画工作室", "creatorName": "Kira"},
        }
        (root / "settings" / "workspace.json").write_text(
            json.dumps({"ui": {"comfyStudio": {"settings": prefs}}}, ensure_ascii=False),
            encoding="utf-8",
        )
        seed_albums(self.ctx, root)
        s = self.ok(self.client.get("/api/settings"))
        self.assertEqual(
            (s["studio_name"], s["creator_name"], s["signature"]),
            ("纸间漫画工作室", "Kira", "纸间"),
        )
        renamed = self.ok(self.client.patch("/api/settings", json={"studio_name": "夜读社"}))
        self.assertEqual((renamed["studio_name"], renamed["signature"]), ("夜读社", "纸间"))
        too_long = self.client.patch("/api/settings", json={"studio_name": "长" * 41})
        self.assertIn(too_long.status_code, (400, 422))

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
