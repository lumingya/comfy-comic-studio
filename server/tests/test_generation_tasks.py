"""Generation choices belong to a task, and the preview describes what it will send."""

from pathlib import Path

from mio_server.auth import required_scope
from mio_server.creation_kits.archive import unpack
from mio_server.models import Panel, PanelOverrides, Preset, PresetEntry, Series
from mio_server.render_models import RenderProfile, RenderStage

from .api_harness import ApiCase


class GenerationTaskTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "empty"
        self.workshop = self.ok(self.client.get("/api/workshop"))
        self.board = self.ctx.store.list_episodes(self.workshop["id"])[0]
        self.board.panels = [Panel(order=0, overrides=PanelOverrides(raw_prompt="a quiet room"))]
        self.ctx.store.save_episode(self.board)
        self.workflow = self.ctx.store.get_doc("workflow", "builtin_t2i_sdxl").model_copy(
            update={"id": "wf_generation", "name": "Test workflow", "source": "import"}, deep=True
        )
        for node in self.workflow.graph.values():
            if node["class_type"] == "EmptyLatentImage":
                node["inputs"].update(width=704, height=960)
        for key in ("width", "height"):
            self.workflow.config.values.pop(key, None)
        self.ctx.store.put_doc(self.workflow)

    def assemble(self, generation=None, **extra):
        return self.ok(
            self.client.post(
                "/api/workshop/assemble",
                json={
                    "storyboard_id": self.board.id,
                    "generation": generation or {"workflow_id": self.workflow.id},
                    **extra,
                },
            ),
            201,
        )

    def render(self, episode_id, **body):
        job = self.ok(self.client.post(f"/api/episodes/{episode_id}/render", json=body))
        return self.ctx.engine.get(job["id"])

    @staticmethod
    def dimensions(item):
        graph = item["input"]["stages"][0]["graph"]
        node = next(node for node in graph.values() if node["class_type"] == "EmptyLatentImage")
        return node["inputs"]["width"], node["inputs"]["height"]

    def test_direct_workflow_freezes_count_and_graph_without_creating_a_profile(self):
        profiles_before = len(self.ctx.store.list_docs("profile"))
        result = self.assemble({"workflow_id": self.workflow.id, "candidates": 2})
        self.assertEqual(len(self.ctx.store.list_docs("profile")), profiles_before)
        self.assertEqual(result["series"]["generation"]["candidates"], 2)
        card = next(
            item
            for item in self.ok(self.client.get("/api/series"))
            if item["id"] == result["series"]["id"]
        )
        self.assertEqual(card["generation"]["profile"]["name"], "Test workflow")
        self.assertNotIn("workflows", card["generation"])
        self.assertNotIn("profiles", card["generation"])
        self.assertIn(
            "wf_generation",
            self.ok(self.client.get(f"/api/series/{card['id']}"))["generation"]["workflows"],
        )
        for node in self.workflow.graph.values():
            if node["class_type"] == "EmptyLatentImage":
                node["inputs"]["width"] = 2048
        self.ctx.store.put_doc(self.workflow)
        self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "generation_defaults": {
                        "workflow:wf_generation": {"candidates": 7, "width": 1024, "height": 1024},
                    }
                },
            )
        )
        queue = self.ok(
            self.client.post(
                "/api/workshop/queue/start", json={"album_ids": [result["series"]["id"]]}
            )
        )
        job = self.ctx.engine.get(queue["active_job"])
        self.assertEqual(len(job["items"]), 2)
        self.assertEqual(self.dimensions(job["items"][0]), (704, 960))
        clone = self.ok(
            self.client.post(f"/api/workshop/tasks/{result['series']['id']}/clone", json={}), 201
        )
        self.assertEqual(clone["series"]["generation"], result["series"]["generation"])
        rerun = self.render(clone["episode"]["id"])
        self.assertEqual(len(rerun["items"]), 2)
        self.assertEqual(self.dimensions(rerun["items"][0]), (704, 960))

    def test_remembered_parameters_apply_only_to_new_tasks_and_explicit_null_clears_size(self):
        first = self.assemble(
            {"workflow_id": self.workflow.id, "candidates": 3, "width": 640, "height": 896}
        )
        second = self.assemble()
        self.assertEqual(second["series"]["generation"]["candidates"], 3)
        self.assertEqual(second["series"]["generation"]["width"], 640)
        cleared = self.assemble({"workflow_id": self.workflow.id, "width": None, "height": None})
        self.assertIsNone(cleared["series"]["generation"]["width"])
        self.assertEqual(
            self.dimensions(self.render(cleared["episode"]["id"])["items"][0]), (704, 960)
        )
        self.assertEqual(
            self.dimensions(self.render(first["episode"]["id"])["items"][0]), (640, 896)
        )

    def test_preset_variables_are_available_in_explicit_panel_prompts(self):
        preset = Preset(
            title="Watercolor",
            entries=[
                PresetEntry(key="tone", value="blue"),
                PresetEntry(key="exclusions", value="{tone} ink"),
            ],
        )
        self.board.panels[0].overrides.raw_prompt = "a quiet room, watercolor"
        self.board.panels[0].overrides.raw_negative = "{exclusions}"
        self.ctx.store.save_episode(self.board)
        self.ctx.store.update_series(
            self.workshop["id"], lambda series: setattr(series, "presets", [preset])
        )
        request = {
            "storyboard_id": self.board.id,
            "preset_ids": [preset.id],
            "generation": {"workflow_id": self.workflow.id},
        }
        preview = self.ok(self.client.post("/api/workshop/assemble/preview", json=request))[
            "panels"
        ][0]
        self.assertEqual(preview["positive"], "a quiet room, watercolor")
        self.assertEqual(preview["negative"], "blue ink")
        self.assertTrue(
            any(v["key"] == "tone" and v["source"] == "preset" for v in preview["variables"])
        )
        self.assertEqual(self.ok(self.client.get("/api/settings"))["generation_defaults"], {})
        result = self.ok(self.client.post("/api/workshop/assemble", json=request), 201)
        self.ctx.store.update_series(
            self.workshop["id"], lambda series: setattr(series, "presets", [])
        )
        meta = self.render(result["episode"]["id"])["items"][0]["input"]["meta"]
        self.assertEqual(
            (meta["prompt"], meta["negative"]), (preview["positive"], preview["negative"])
        )

    def test_retired_preset_fragments_do_not_change_prompts_or_exported_presets(self):
        preset = Preset.model_validate(
            {
                "title": "Old preset",
                "entries": [{"key": "negative", "value": "unused ink"}],
                "positive_prompt": "hidden positive {missing_positive}",
                "negative_prompt": "hidden negative {missing_negative}",
            }
        )
        self.ctx.store.update_series(
            self.workshop["id"], lambda series: setattr(series, "presets", [preset])
        )
        request = {
            "storyboard_id": self.board.id,
            "preset_ids": [preset.id],
            "generation": {"workflow_id": self.workflow.id},
        }
        report = self.ok(self.client.post("/api/workshop/assemble/preview", json=request))[
            "panels"
        ][0]
        self.assertEqual(report["positive"], "a quiet room")
        self.assertEqual(report["negative"], "")
        self.assertEqual(report["variables"], [])
        made = self.ok(self.client.post("/api/workshop/assemble", json=request), 201)
        meta = self.render(made["episode"]["id"])["items"][0]["input"]["meta"]
        self.assertEqual((meta["prompt"], meta["negative"]), ("a quiet room", ""))
        response = self.client.post(
            "/api/creation-kits/export",
            json={
                "series_id": made["series"]["id"],
                "episode_ids": [made["episode"]["id"]],
                "preset_ids": [preset.id],
            },
        )
        self.assertEqual(response.status_code, 200)
        payload, _ = unpack(response.content)
        exported = payload.series.presets[0].model_dump()
        self.assertNotIn("positive_prompt", exported)
        self.assertNotIn("negative_prompt", exported)
        self.assertEqual(exported["entries"][0]["value"], "unused ink")

    def test_explicit_profile_fragments_are_preserved_in_snapshot_and_raw_render(self):
        profile = RenderProfile(
            id="personal",
            name="Personal",
            candidates=2,
            quality_tags=["personal quality"],
            negative_tags=["personal exclusion"],
            draft=[RenderStage(workflow_id=self.workflow.id)],
        )
        self.ctx.store.put_doc(profile)
        result = self.assemble({"profile_id": profile.id})
        profile.quality_tags, profile.negative_tags = [], []
        self.ctx.store.put_doc(profile)
        job = self.render(result["episode"]["id"])
        self.assertEqual(len(job["items"]), 2)
        meta = job["items"][0]["input"]["meta"]
        self.assertEqual(meta["prompt"], "a quiet room, personal quality")
        self.assertEqual(meta["negative"], "personal exclusion")
        self.assertEqual(self.dimensions(job["items"][0]), (704, 960))

    def test_preset_preview_retry_after_lost_response_keeps_one_task_and_frozen_values(self):
        preset = Preset(title="Blue", entries=[PresetEntry(key="tone", value="blue")])
        self.ctx.store.update_series(
            self.workshop["id"], lambda series: setattr(series, "presets", [preset])
        )
        body = {
            "preset_ids": [preset.id],
            "prompt": "a quiet room",
            "generation": {"workflow_id": self.workflow.id, "candidates": 2},
            "idempotency_key": "lost-preview-response",
        }
        # The server commits the first response, but the caller retries without consuming it.
        self.assertEqual(self.client.post("/api/workshop/preview", json=body).status_code, 201)
        albums = [item for item in self.ctx.store.list_series() if item.kind == "album"]
        self.assertEqual(len(albums), 1)
        self.ctx.store.update_series(
            self.workshop["id"], lambda series: setattr(series, "presets", [])
        )
        retry = self.ok(self.client.post("/api/workshop/preview", json=body), 201)
        self.assertEqual(retry["series"]["id"], albums[0].id)
        self.assertEqual(retry["series"]["presets"][0]["entries"][0]["value"], "blue")
        self.assertEqual(len(self.ctx.store.list_episodes(albums[0].id)), 1)
        self.assertEqual(
            len([item for item in self.ctx.store.list_series() if item.kind == "album"]), 1
        )
        self.assertEqual(self.ok(self.client.get("/api/workshop/queue"))["order"], [albums[0].id])
        changed = self.client.post("/api/workshop/preview", json={**body, "prompt": "another room"})
        self.assertEqual(changed.status_code, 409)

    def test_kit_preset_preview_uses_same_idempotent_contract(self):
        preset = Preset(title="Kit look", entries=[PresetEntry(key="tone", value="noise")])
        kit = self.ctx.store.create_series(Series(title="Kit", kind="kit", presets=[preset]))
        path = f"/api/creation-kits/{kit.id}/preview-preset"
        body = {
            "preset_ids": [preset.id],
            "prompt": "a quiet room",
            "generation": {"workflow_id": self.workflow.id},
            "idempotency_key": "kit-preview",
        }
        self.assertEqual(self.client.post(path, json=body).status_code, 201)
        first = next(item for item in self.ctx.store.list_series() if item.kind == "album")
        retry = self.ok(self.client.post(path, json=body), 201)
        self.assertEqual(retry["series"]["id"], first.id)
        self.assertEqual(
            len([item for item in self.ctx.store.list_series() if item.kind == "album"]), 1
        )
        changed = self.client.post(
            path, json={**body, "generation": {"workflow_id": self.workflow.id, "width": None}}
        )
        self.assertEqual(changed.status_code, 409)

    def test_size_omission_and_explicit_null_have_distinct_idempotent_meanings(self):
        self.assemble({"workflow_id": self.workflow.id, "width": 640, "height": 896})
        self.assemble({"workflow_id": self.workflow.id}, idempotency_key="size-choice")
        changed = self.client.post(
            "/api/workshop/assemble",
            json={
                "storyboard_id": self.board.id,
                "generation": {"workflow_id": self.workflow.id, "width": None, "height": None},
                "idempotency_key": "size-choice",
            },
        )
        self.assertEqual(changed.status_code, 409)

    def test_direct_workflow_kit_exports_frozen_recipe_without_a_task_binding(self):
        result = self.assemble({"workflow_id": self.workflow.id, "candidates": 2})
        self.workflow.name = "Changed after assembly"
        self.ctx.store.put_doc(self.workflow)
        response = self.client.post(
            "/api/creation-kits/export",
            json={
                "series_id": result["series"]["id"],
                "episode_ids": [result["episode"]["id"]],
            },
        )
        self.assertEqual(response.status_code, 200)
        payload, _ = unpack(response.content)
        self.assertIsNone(payload.series.generation)
        self.assertEqual(payload.profiles[0].candidates, 2)
        self.assertEqual(payload.profiles[0].instances, [])
        self.assertEqual(payload.workflows[0].name, "Test workflow")

    def test_trial_is_one_real_job_is_idempotent_and_requires_render_scope(self):
        body = {"prompt": "a blue ceramic cup", "instance_id": "c1", "idempotency_key": "trial-1"}
        result = self.ok(self.client.post(f"/api/workflows/{self.workflow.id}/trial", json=body))
        again = self.ok(self.client.post(f"/api/workflows/{self.workflow.id}/trial", json=body))
        self.assertEqual(again["job"]["id"], result["job"]["id"])
        self.assertEqual(again["series"]["id"], result["series"]["id"])
        job = self.ctx.engine.get(result["job"]["id"])
        self.assertEqual(len(job["items"]), 1)
        self.assertEqual(job["items"][0]["instances"], ["c1"])
        self.assertEqual(self.dimensions(job["items"][0]), (704, 960))
        self.drain(result["job"])
        self.assertEqual(len(self.ctx.store.get_episode(result["episode"]["id"]).takes), 1)
        self.assertEqual(required_scope("POST", "/workflows/wf_generation/trial"), "render")
        token = self.ok(
            self.client.post("/api/tokens", json={"name": "reader", "scopes": ["read"]}), 201
        )["token"]
        denied = self.client.post(
            f"/api/v2/workflows/{self.workflow.id}/trial",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(denied.status_code, 403)

    def test_cloud_source_freezes_model_and_options_without_credentials(self):
        channel = {
            "id": "testcloud",
            "kind": "openai_images",
            "label": "Cloud",
            "model": "image-one",
            "base_url": "https://example.invalid/v1",
            "api_key": "private-test-key",
            "size": "1024x1024",
            "negative": "channel exclusion",
        }
        self.ok(self.client.patch("/api/settings", json={"image_channels": [channel]}))
        result = self.assemble({"cloud_channel_id": channel["id"], "candidates": 2})
        snapshot = result["series"]["generation"]
        self.assertNotIn("private-test-key", str(snapshot))
        self.assertNotIn("https://", str(snapshot))
        self.assertNotIn("api_key", str(snapshot))
        self.assertEqual(snapshot["channels"]["testcloud"]["model"], "image-one")
        channel.update(model="image-two", size="1536x1024", negative="changed exclusion")
        self.ok(self.client.patch("/api/settings", json={"image_channels": [channel]}))
        job = self.render(result["episode"]["id"])
        self.assertEqual(len(job["items"]), 2)
        request = job["items"][0]["input"]["request"]
        self.assertEqual(request["model"], "image-one")
        self.assertEqual(request["options"]["size"], "1024x1024")
        self.assertEqual(request["options"]["negative"], "channel exclusion")
        self.assertIsNone(request["requested"]["width"])
        # Unused local stages do not prevent a cloud-only task from being assembled.
        profile = RenderProfile(
            id="cloud-only",
            name="Cloud only",
            cloud_shape=True,
            cloud_channel="testcloud",
            draft=[RenderStage(workflow_id="")],
            edits={"edit": RenderStage(workflow_id="removed-workflow")},
        )
        self.ctx.store.put_doc(profile)
        cloud = self.assemble({"profile_id": profile.id, "candidates": 1})
        request = self.render(cloud["episode"]["id"])["items"][0]["input"]["request"]
        self.assertIsNone(request["requested"]["width"])
        self.assertEqual(request["options"]["size"], "1536x1024")
