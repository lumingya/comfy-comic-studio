"""LoRA selections and channel options remain frozen across durable task boundaries."""

import base64
import json
import shutil
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.backups import Backups
from mio_server.backups.models import BackupOptions, RestoreApply
from mio_server.backups.paths import recovery_root
from mio_server.context import AppContext
from mio_server.creation_kits import assemble_kit, import_kit
from mio_server.creation_kits.archive import unpack
from mio_server.creation_kits.models import KitAssembly, KitImport

from .api_harness import LOCAL, ApiCase, FakeComfy, FakeLLM
from .test_slot_topology_matrix import chain, graph_for


class SlotLifecycleTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.addCleanup(self.cleanup_recovery)
        self.ctx.legacy_root = Path(self.tmp) / "empty"
        self.workflow = self.ok(
            self.client.post(
                "/api/workflows", json={"name": "Portable ink", "graph": graph_for(chain())}
            ),
            201,
        )
        self.path = f"/api/workflows/{self.workflow['id']}"
        self.group = self.ok(self.client.get(self.path + "/loras"))["groups"][0]
        self.pin = self.group["loras"][0]
        self.default = self.slots(enabled=True, strength=0.5, clip=0.2)
        self.ok(self.client.patch(self.path, json={"config": {"slot_overrides": self.default}}))
        self.board = self.ok(
            self.client.post(
                "/api/workshop/storyboards",
                json={
                    "title": "Two rooms",
                    "panels": [
                        {"order": 0, "overrides": {"raw_prompt": "a blue room"}},
                        {
                            "order": 1,
                            "overrides": {
                                "raw_prompt": "a green room",
                                "slot_overrides": {
                                    "workflow_id": self.workflow["id"],
                                    **self.slots(enabled=True, strength=0.9, clip=0.4),
                                },
                            },
                        },
                    ],
                },
            ),
            201,
        )

    def cleanup_recovery(self):
        self.ctx.close()
        shutil.rmtree(recovery_root(Path(self.tmp)), ignore_errors=True)

    def slots(self, **values):
        return {
            "groups": [
                {
                    "key": self.group["key"],
                    "loras": [{"key": self.pin["key"], "name": self.pin["name"], **values}],
                }
            ]
        }

    def assemble(self, **changes):
        return self.ok(
            self.client.post(
                "/api/workshop/assemble",
                json={
                    "storyboard_id": self.board["id"],
                    "generation": {"workflow_id": self.workflow["id"], "candidates": 1},
                    "slot_overrides": self.slots(enabled=False),
                    **changes,
                },
            ),
            201,
        )

    def render(self, episode_id, **body):
        result = self.ok(self.client.post(f"/api/episodes/{episode_id}/render", json=body))
        return self.ctx.engine.get(result["id"])

    def assert_strengths(self, job, expected):
        strengths = [
            (
                item["input"]["stages"][0]["graph"]["2"]["inputs"]["strength_model"],
                item["input"]["stages"][0]["graph"]["2"]["inputs"]["strength_clip"],
            )
            for item in job["items"]
        ]
        self.assertEqual(strengths, expected)

    def reopen(self):
        self.client.close()
        self.ctx.close()
        self.ctx = AppContext.create(
            self.tmp,
            autostart=False,
            llm_factory=FakeLLM,
            comfy_client_factory=FakeComfy,
            seed_instance=False,
        )
        self.addCleanup(self.ctx.close)
        self.ctx.legacy_root = Path(self.tmp) / "empty"
        self.client = TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)
        self.addCleanup(self.client.close)

    def test_default_task_panel_priority_is_frozen_and_survives_clone_and_single_panel_rerun(self):
        task = self.assemble(idempotency_key="frozen-priority")
        frozen = task["series"]["generation"]
        stage = frozen["profile"]["draft"][0]
        self.assertEqual(stage["slot_overrides"], self.slots(enabled=False))
        self.ok(
            self.client.patch(
                self.path,
                json={"config": {"slot_overrides": self.slots(enabled=True, strength=2, clip=3)}},
            )
        )
        job = self.render(task["episode"]["id"])
        self.assert_strengths(job, [(0, 0), (0.9, 0.4)])
        self.drain(job)
        clone = self.ok(
            self.client.post(f"/api/workshop/tasks/{task['series']['id']}/clone", json={}), 201
        )
        self.assertEqual(clone["series"]["generation"], frozen)
        cloned_job = self.render(clone["episode"]["id"])
        self.assert_strengths(cloned_job, [(0, 0), (0.9, 0.4)])
        self.drain(cloned_job)
        rerun = self.render(task["episode"]["id"], panel_ids=[task["episode"]["panels"][1]["id"]])
        self.assert_strengths(rerun, [(0.9, 0.4)])
        self.drain(rerun)
        self.assertEqual(self.ok(self.client.get(self.path))["graph"], self.workflow["graph"])
        self.assertEqual(
            self.ok(self.client.get(f"/api/workshop/storyboards/{self.board['id']}")), self.board
        )

    def test_kit_round_trip_remaps_panel_workflow_qualifier_and_preserves_task_selection(self):
        task = self.assemble()
        archive = self.client.post(
            "/api/creation-kits/export",
            json={"series_id": task["series"]["id"], "episode_ids": [task["episode"]["id"]]},
        )
        self.assertEqual(archive.status_code, 200, archive.text)
        payload, _ = unpack(archive.content)
        self.assertEqual(payload.profiles[0].draft[0].slot_overrides, self.slots(enabled=False))
        imported = import_kit(
            self.ctx,
            KitImport(
                archive_base64=base64.b64encode(archive.content).decode(),
                profiles={profile.id: {"instances": ["c1"]} for profile in payload.profiles},
                idempotency_key="ink-kit-import",
            ),
        )
        imported_panel = self.ctx.store.get_episode(imported.episode_ids[0]).panels[1]
        destination = imported.id_map["workflows"][self.workflow["id"]]
        self.assertEqual(imported_panel.overrides.slot_overrides["workflow_id"], destination)
        _, episode = assemble_kit(
            self.ctx,
            imported.series_id,
            KitAssembly(episode_id=imported.episode_ids[0], idempotency_key="ink-kit-task"),
        )
        self.assert_strengths(self.render(episode.id), [(0, 0), (0.9, 0.4)])

    def test_kit_task_can_override_its_frozen_lora_defaults_without_mutating_kit(self):
        task = self.assemble()
        archive = self.client.post(
            "/api/creation-kits/export",
            json={"series_id": task["series"]["id"], "episode_ids": [task["episode"]["id"]]},
        )
        self.assertEqual(archive.status_code, 200, archive.text)
        payload, _ = unpack(archive.content)
        imported = import_kit(
            self.ctx,
            KitImport(
                archive_base64=base64.b64encode(archive.content).decode(),
                profiles={profile.id: {"instances": ["c1"]} for profile in payload.profiles},
                idempotency_key="kit-override-import",
            ),
        )
        # The second panel's independent override still wins over this new task override.
        original = self.ctx.store.get_series(imported.series_id).model_dump(mode="json")
        _, episode = assemble_kit(
            self.ctx,
            imported.series_id,
            KitAssembly(
                episode_id=imported.episode_ids[0],
                slot_overrides=self.slots(enabled=True, strength=0.6, clip=0.1),
                idempotency_key="kit-override-task",
            ),
        )
        self.assert_strengths(self.render(episode.id), [(0.6, 0.1), (0.9, 0.4)])
        self.assertEqual(
            self.ctx.store.get_series(imported.series_id).model_dump(mode="json"), original
        )

    def test_real_restart_then_backup_restore_keep_slots_and_redacted_cloud_options(self):
        local = self.assemble(idempotency_key="durable-local")
        channel = {
            "id": "portable-cloud",
            "kind": "openai_images",
            "model": "fixture-model",
            "extra_options": {
                "quality_mode": "draft",
                "accounts": [{"token": "fixture-private-key", "region": "offline"}],
            },
        }
        self.ok(self.client.patch("/api/settings", json={"image_channels": [channel]}))
        cloud = self.assemble(
            generation={"cloud_channel_id": channel["id"]},
            slot_overrides=None,
            idempotency_key="durable-cloud",
        )
        local_snapshot = local["series"]["generation"]
        cloud_snapshot = cloud["series"]["generation"]
        self.assertEqual(
            cloud_snapshot["channels"][channel["id"]]["options"]["extra_options"],
            {"quality_mode": "draft", "accounts": [{"region": "offline"}]},
        )
        self.assertNotIn("fixture-private-key", json.dumps(cloud_snapshot))
        self.reopen()
        for task, snapshot in ((local, local_snapshot), (cloud, cloud_snapshot)):
            self.assertEqual(
                self.ctx.store.get_series(task["series"]["id"]).generation.model_dump(), snapshot
            )
        self.assertEqual(
            self.assemble(idempotency_key="durable-local")["series"]["id"], local["series"]["id"]
        )
        service = Backups(self.ctx)
        backup = service.export(BackupOptions())
        with zipfile.ZipFile(service.download(backup.id)) as archive:
            for name in archive.namelist():
                self.assertNotIn(b"fixture-private-key", archive.read(name), name)
        self.ctx.store.update_series(
            local["series"]["id"], lambda series: setattr(series, "title", "Changed")
        )
        plan = service.stage(service.download(backup.id))
        service.apply(
            plan.id,
            RestoreApply(
                expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
            ),
        )
        self.reopen()
        self.assertEqual(
            self.ctx.store.get_series(local["series"]["id"]).title, local["series"]["title"]
        )
        self.assertEqual(
            self.ctx.store.get_series(local["series"]["id"]).generation.model_dump(), local_snapshot
        )
        self.assertEqual(
            self.ctx.store.get_series(cloud["series"]["id"]).generation.model_dump(), cloud_snapshot
        )
        self.assertEqual(
            self.assemble(idempotency_key="durable-local")["series"]["id"], local["series"]["id"]
        )
        self.assert_strengths(self.render(local["episode"]["id"]), [(0, 0), (0.9, 0.4)])

    def test_cloud_clone_and_portable_kit_keep_frozen_options_with_a_new_channel_binding(self):
        channels = [
            {
                "id": identifier,
                "kind": "openai_images",
                "model": "fixture-model" if identifier == "source-cloud" else "destination-model",
                "extra_options": {
                    "quality_mode": quality,
                    "accounts": [{"token": secret, "region": "offline"}],
                },
            }
            for identifier, quality, secret in (
                ("source-cloud", "draft", "fixture-source-private-key"),
                ("destination-cloud", "final", "fixture-destination-private-key"),
            )
        ]
        self.ok(self.client.patch("/api/settings", json={"image_channels": channels}))
        cloud_board = self.ok(
            self.client.post(
                "/api/workshop/storyboards",
                json={
                    "title": "Cloud recipe",
                    "panels": [{"order": 0, "overrides": {"raw_prompt": "a quiet room"}}],
                },
            ),
            201,
        )
        source = self.assemble(
            storyboard_id=cloud_board["id"],
            generation={"cloud_channel_id": "source-cloud"},
            slot_overrides=None,
        )
        frozen_options = source["series"]["generation"]["channels"]["source-cloud"]["options"]
        clone = self.ok(
            self.client.post(f"/api/workshop/tasks/{source['series']['id']}/clone", json={}), 201
        )
        self.assertEqual(clone["series"]["generation"], source["series"]["generation"])
        archive = self.client.post(
            "/api/creation-kits/export",
            json={"series_id": source["series"]["id"], "episode_ids": [source["episode"]["id"]]},
        )
        self.assertEqual(archive.status_code, 200, archive.text)
        payload, _ = unpack(archive.content)
        self.assertNotIn("fixture-source-private-key", payload.model_dump_json())
        self.assertNotIn("fixture-destination-private-key", payload.model_dump_json())
        imported = import_kit(
            self.ctx,
            KitImport(
                archive_base64=base64.b64encode(archive.content).decode(),
                profiles={
                    profile.id: {"cloud_channel": "destination-cloud"}
                    for profile in payload.profiles
                },
                idempotency_key="portable-cloud-recipe",
            ),
        )
        album, _ = assemble_kit(
            self.ctx,
            imported.series_id,
            KitAssembly(episode_id=imported.episode_ids[0], idempotency_key="cloud-kit-task"),
        )
        self.assertEqual(album.generation.channels["destination-cloud"]["options"], frozen_options)
        self.assertEqual(album.generation.channels["destination-cloud"]["model"], "fixture-model")
        self.assertNotIn("private-key", album.generation.model_dump_json())

    def test_cloud_kit_includes_workflow_referenced_only_by_a_panel_override(self):
        self.ok(
            self.client.patch(
                "/api/settings",
                json={"image_channels": [{"id": "cloud", "kind": "openai_images"}]},
            )
        )
        task = self.assemble(generation={"cloud_channel_id": "cloud"}, slot_overrides=None)
        archive = self.client.post(
            "/api/creation-kits/export",
            json={"series_id": task["series"]["id"], "episode_ids": [task["episode"]["id"]]},
        )
        self.assertEqual(archive.status_code, 200, archive.text)
        payload, _ = unpack(archive.content)
        self.assertIn(self.workflow["id"], {workflow.id for workflow in payload.workflows})
        imported = import_kit(
            self.ctx,
            KitImport(
                archive_base64=base64.b64encode(archive.content).decode(),
                profiles={profile.id: {"cloud_channel": "cloud"} for profile in payload.profiles},
                idempotency_key="cloud-with-panel-recipe",
            ),
        )
        panel = self.ctx.store.get_episode(imported.episode_ids[0]).panels[1]
        self.assertEqual(
            panel.overrides.slot_overrides["workflow_id"],
            imported.id_map["workflows"][self.workflow["id"]],
        )
