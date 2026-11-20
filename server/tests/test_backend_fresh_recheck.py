"""Fresh boundary checks for the final LoRA and cloud-recipe repair pass."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from mio_server.generation import capture_channels
from mio_server.models import GenerationSnapshot, Series
from mio_server.pipeline.providers import ImageChannel
from mio_server.pipeline.render import RenderService
from mio_server.render_models import CloudRecipe, RenderProfile, RenderStage, WorkflowDoc
from mio_server.workshop import _freeze_task_slots


def lora_workflow():
    return WorkflowDoc(
        id="fresh-lora",
        name="Fresh LoRA",
        graph={
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": "base.safetensors"},
            },
            "2": {
                "class_type": "LoraLoader",
                "inputs": {
                    "model": ["1", 0],
                    "clip": ["1", 1],
                    "lora_name": "ink.safetensors",
                    "strength_model": 0.7,
                    "strength_clip": 0.5,
                },
            },
            "3": {"class_type": "KSampler", "inputs": {"model": ["2", 0]}},
            "9": {"class_type": "SaveImage", "inputs": {"images": ["3", 0]}},
        },
    )


class FreshTaskSlotBoundaries(unittest.TestCase):
    def test_distinct_reference_keys_preserve_same_file_enabled_and_clip_values(self):
        workflow = lora_workflow()
        service = RenderService(None, None, SimpleNamespace(registry=None))
        service.workflow = lambda identifier: workflow
        stage, _, _ = service._compile_stage(
            RenderStage(id="generate", workflow_id=workflow.id),
            {},
            loras=[
                {
                    "key": "character-entry",
                    "name": "ink.safetensors",
                    "strength_model": 0.3,
                    "strength_clip": 0.1,
                    "enabled": True,
                },
                {
                    "key": "style-entry",
                    "name": "ink.safetensors",
                    "strength_model": 0.9,
                    "strength_clip": 0.4,
                    "enabled": False,
                },
            ],
        )
        applied = [
            (node["inputs"]["strength_model"], node["inputs"]["strength_clip"])
            for node in stage["graph"].values()
            if node["class_type"] == "LoraLoader"
        ]
        self.assertCountEqual(applied, [(0.7, 0.5), (0.3, 0.1), (0, 0)])
        self.assertEqual(workflow.graph["2"]["inputs"]["strength_model"], 0.7)

    def test_hybrid_task_overrides_also_reach_its_captured_local_edit(self):
        workflow = lora_workflow()
        profile = RenderProfile(
            id="fresh-hybrid",
            name="Hybrid with local edit",
            cloud_shape=True,
            cloud_refine=True,
            final=[RenderStage(id="refine", workflow_id=workflow.id)],
            edits={"inpaint": RenderStage(id="inpaint", workflow_id=workflow.id)},
        )
        data = profile.model_dump()
        series = Series(
            title="Fresh review",
            generation=GenerationSnapshot(
                profile=data,
                profiles={profile.id: data},
                workflows={workflow.id: workflow.model_dump()},
            ),
        )
        _freeze_task_slots(
            series,
            {"loras": [{"name": "ink.safetensors", "enabled": False}]},
            (),
        )
        frozen = RenderProfile.model_validate(series.generation.profile)
        expected = {"loras": [{"name": "ink.safetensors", "enabled": False}]}
        self.assertEqual(frozen.final[0].slot_overrides, expected)
        self.assertEqual(frozen.edits["inpaint"].slot_overrides, expected)

    def test_pure_cloud_task_preserves_overrides_for_manual_local_final(self):
        workflow = lora_workflow()
        profile = RenderProfile(
            id="fresh-cloud",
            name="Cloud with manual local final",
            cloud_shape=True,
            cloud_refine=False,
            final=[RenderStage(id="manual-final", workflow_id=workflow.id)],
        )
        data = profile.model_dump()
        series = Series(
            title="Fresh manual final review",
            generation=GenerationSnapshot(
                profile=data,
                profiles={profile.id: data},
                workflows={workflow.id: workflow.model_dump()},
            ),
        )
        _freeze_task_slots(
            series,
            {"loras": [{"name": "ink.safetensors", "enabled": False}]},
            (),
        )
        frozen = RenderProfile.model_validate(series.generation.profile)
        self.assertEqual(
            frozen.final[0].slot_overrides,
            {"loras": [{"name": "ink.safetensors", "enabled": False}]},
        )

    def test_same_destination_keeps_each_profiles_inline_cloud_recipe(self):
        channel = ImageChannel(id="destination", kind="demo", model="live-model")
        profiles = {}
        for identifier, model, style in (("first", "model-a", "ink"), ("second", "model-b", "oil")):
            profiles[identifier] = RenderProfile(
                id=identifier,
                name=identifier,
                cloud_shape=True,
                cloud_channel=channel.id,
                cloud_recipe=CloudRecipe(
                    kind="demo", model=model, options={"extra_options": {"style": style}}
                ),
            ).model_dump()
        snapshot = GenerationSnapshot(profile=profiles["first"], profiles=profiles)
        capture_channels(
            SimpleNamespace(image_channels=[channel], image_channel=channel.id), snapshot
        )
        service = RenderService(None, None, SimpleNamespace(registry=None))
        service._local.generation = snapshot
        service.cloud_backend = lambda identifier: SimpleNamespace(channel=channel)
        for identifier, model, style in (("first", "model-a", "ink"), ("second", "model-b", "oil")):
            recipe = CloudRecipe.model_validate(snapshot.profiles[identifier]["cloud_recipe"])
            request = service._cloud_request(channel.id, {"prompt": "quiet room"}, recipe=recipe)
            self.assertEqual(request["model"], model)
            self.assertEqual(request["options"]["extra_options"], {"style": style})
