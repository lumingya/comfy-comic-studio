"""Adversarial regressions for keyed LoRAs and task-wide portable recipes."""

import base64
from pathlib import Path

from mio_server.comfy import workflow_slots as slots
from mio_server.creation_kits import assemble_kit, import_kit
from mio_server.creation_kits.archive import unpack
from mio_server.creation_kits.models import KitAssembly, KitImport
from mio_server.models import (
    Bible,
    Character,
    Episode,
    LoraRef,
    Panel,
    PanelCharacter,
    PanelOverrides,
    Series,
)
from mio_server.render_models import CloudRecipe, RenderProfile, RenderStage

from .api_harness import ApiCase
from .test_slot_topology_matrix import chain, graph_for


class ReviewBackendRegressions(ApiCase):
    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "empty"
        self.workflow = self.ok(
            self.client.post(
                "/api/workflows", json={"name": "Review ink", "graph": graph_for(chain())}
            ),
            201,
        )

    @staticmethod
    def lora_weights(graph):
        return sorted(
            (inputs["lora_name"], inputs["strength_model"], inputs["strength_clip"])
            for node in graph.values()
            if node["class_type"] == "LoraLoader"
            for inputs in [node["inputs"]]
        )

    def test_bible_reference_keys_preserve_same_name_pins_and_other_additions(self):
        profile = RenderProfile(
            id="reference-profile",
            name="Reference profile",
            draft=[RenderStage(workflow_id=self.workflow["id"])],
            candidates=1,
        )
        self.ctx.store.put_doc(profile)
        character = Character(
            name="Reference character",
            age=20,
            loras=[
                LoraRef(
                    key="reference-ink",
                    name="ink.safetensors",
                    strength_model=0.6,
                    strength_clip=0.2,
                ),
                LoraRef(
                    key="reference-tone",
                    name="tone.safetensors",
                    strength_model=0.4,
                    strength_clip=0.1,
                ),
            ],
        )
        series = Series(
            title="Reference collision",
            default_profile_id=profile.id,
            bible=Bible(characters=[character]),
        )
        panel = Panel(
            order=0,
            characters=[PanelCharacter(character_id=character.id)],
            overrides=PanelOverrides(raw_prompt="a blue room"),
        )
        episode = Episode(series_id=series.id, title="Reference collision", order=0, panels=[panel])
        self.ctx.store.create_series(series)
        self.ctx.store.create_episode(episode)
        job = self.ctx.render.render(episode.id, candidates=1)
        stage = job["items"][0]["input"]["stages"][0]
        self.assertEqual(
            self.lora_weights(stage["graph"]),
            [
                ("ink.safetensors", 0.6, 0.2),
                ("ink.safetensors", 0.7, 0.3),
                ("tone.safetensors", 0.4, 0.1),
            ],
        )
        self.assertFalse(any("LoRA 未写入" in warning for warning in stage["warnings"]))
        self.assertEqual(
            self.ctx.store.get_doc("workflow", self.workflow["id"]).graph, self.workflow["graph"]
        )

    def test_same_name_additional_keys_remain_independent_and_preserve_weights_on_toggle(self):
        path = f"/api/workflows/{self.workflow['id']}"
        defaults = {
            "loras": [
                {"key": "wash-one", "name": "wash.safetensors", "strength": 0.6, "clip": 0.2},
                {"key": "wash-two", "name": "wash.safetensors", "strength": 0.8, "clip": 0.3},
            ]
        }
        self.ok(self.client.patch(path, json={"config": {"slot_overrides": defaults}}))
        controls = self.ok(self.client.get(path + "/loras"))["groups"][0]
        washes = [lora for lora in controls["loras"] if lora["name"] == "wash.safetensors"]
        self.assertEqual({lora["key"] for lora in washes}, {"wash-one", "wash-two"})
        self.assertTrue(all(not lora["pinned"] for lora in washes))
        off = {"loras": [{"key": "wash-one", "name": "wash.safetensors", "enabled": False}]}
        merged = slots.merge_overrides(defaults, off)
        self.assertEqual(
            next(lora for lora in merged["loras"] if lora["key"] == "wash-one"),
            {**defaults["loras"][0], "enabled": False},
        )
        compiled = self.ok(self.client.post(path + "/compile", json={"slot_overrides": off}))
        self.assertEqual(
            self.lora_weights(compiled["graph"]),
            [
                ("ink.safetensors", 0.7, 0.3),
                ("wash.safetensors", 0, 0),
                ("wash.safetensors", 0.8, 0.3),
            ],
        )
        restored = self.ok(
            self.client.post(
                path + "/compile",
                json={
                    "slot_overrides": {
                        "loras": [{"key": "wash-one", "name": "wash.safetensors", "enabled": True}]
                    }
                },
            )
        )
        self.assertEqual(
            self.lora_weights(restored["graph"]),
            [
                ("ink.safetensors", 0.7, 0.3),
                ("wash.safetensors", 0.6, 0.2),
                ("wash.safetensors", 0.8, 0.3),
            ],
        )

    def test_task_toggle_applies_to_the_profile_selected_by_a_panel(self):
        profiles = [
            RenderProfile(
                id=identifier,
                name=identifier,
                candidates=1,
                draft=[RenderStage(workflow_id=self.workflow["id"])],
            )
            for identifier in ("default-route", "panel-route")
        ]
        for profile in profiles:
            self.ctx.store.put_doc(profile)
        board = self.ok(
            self.client.post(
                "/api/workshop/storyboards",
                json={
                    "title": "Two profiles",
                    "panels": [
                        {"order": 0, "overrides": {"raw_prompt": "a blue room"}},
                        {
                            "order": 1,
                            "overrides": {
                                "raw_prompt": "a green room",
                                "profile_id": profiles[1].id,
                            },
                        },
                    ],
                },
            ),
            201,
        )
        group = self.ok(self.client.get(f"/api/workflows/{self.workflow['id']}/loras"))["groups"][0]
        pin = group["loras"][0]
        task = self.ok(
            self.client.post(
                "/api/workshop/tasks",
                json={
                    "storyboard_id": board["id"],
                    "profile_id": profiles[0].id,
                    "auto_start": True,
                    "slot_overrides": {
                        "groups": [
                            {
                                "key": group["key"],
                                "loras": [
                                    {"key": pin["key"], "name": pin["name"], "enabled": False}
                                ],
                            }
                        ]
                    },
                },
            ),
            201,
        )
        self.assertIsNone(task["start_error"])
        self.assertEqual(len(task["job"]["items"]), 2)
        for item in task["job"]["items"]:
            self.assertEqual(
                self.lora_weights(item["input"]["stages"][0]["graph"]),
                [("ink.safetensors", 0, 0)],
            )
        for profile in profiles:
            self.assertEqual(
                self.ctx.store.get_doc("profile", profile.id).draft[0].slot_overrides, {}
            )

    def test_portable_profiles_bound_to_one_channel_keep_distinct_cloud_recipes(self):
        self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "image_channels": [
                        {"id": identifier, "kind": "openai_images", "model": "mutable-model"}
                        for identifier in ("source-a", "source-b", "destination")
                    ]
                },
            )
        )
        profiles = [
            RenderProfile(
                id=identifier,
                name=identifier,
                candidates=1,
                cloud_shape=True,
                cloud_channel=channel,
                cloud_recipe=CloudRecipe(
                    kind="openai_images",
                    model=model,
                    options={"extra_options": {"quality_mode": quality}},
                ),
            )
            for identifier, channel, model, quality in (
                ("recipe-a", "source-a", "model-a", "draft"),
                ("recipe-b", "source-b", "model-b", "final"),
            )
        ]
        for profile in profiles:
            self.ctx.store.put_doc(profile)
        board = self.ok(
            self.client.post(
                "/api/workshop/storyboards",
                json={
                    "title": "Distinct recipes",
                    "panels": [
                        {"order": 0, "overrides": {"raw_prompt": "a blue room"}},
                        {
                            "order": 1,
                            "overrides": {
                                "raw_prompt": "a green room",
                                "profile_id": profiles[1].id,
                            },
                        },
                    ],
                },
            ),
            201,
        )
        source = self.ok(
            self.client.post(
                "/api/workshop/tasks",
                json={"storyboard_id": board["id"], "profile_id": profiles[0].id},
            ),
            201,
        )
        archive = self.client.post(
            "/api/creation-kits/export",
            json={"series_id": source["series"]["id"], "episode_ids": [source["episode"]["id"]]},
        )
        self.assertEqual(archive.status_code, 200)
        payload, _ = unpack(archive.content)
        imported = import_kit(
            self.ctx,
            KitImport(
                archive_base64=base64.b64encode(archive.content).decode(),
                profiles={p.id: {"cloud_channel": "destination"} for p in payload.profiles},
                idempotency_key="two-recipes-import",
            ),
        )
        _, episode = assemble_kit(
            self.ctx,
            imported.series_id,
            KitAssembly(episode_id=imported.episode_ids[0], idempotency_key="two-recipes-assemble"),
        )
        job = self.ctx.render.render(episode.id)
        requests = [item["input"]["request"] for item in job["items"]]
        self.assertEqual([request["channel_id"] for request in requests], ["destination"] * 2)
        self.assertEqual([request["model"] for request in requests], ["model-a", "model-b"])
        self.assertEqual(
            [request["options"]["extra_options"]["quality_mode"] for request in requests],
            ["draft", "final"],
        )
