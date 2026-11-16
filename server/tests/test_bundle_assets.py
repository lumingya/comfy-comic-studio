"""Editable bundles must carry every image needed to continue work elsewhere."""

import io
import json
import tempfile
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.comfy.compile import asset_value
from mio_server.context import AppContext
from mio_server.models import (
    Bible,
    Character,
    ControlInput,
    Episode,
    Panel,
    PanelOverrides,
    Series,
    VariantSet,
)
from mio_server.render_models import ComfyInstance, RenderProfile, RenderStage

from .api_harness import LOCAL, ApiCase, FakeComfy, FakeLLM
from .test_compile_executor import FakeClient, png
from .test_jobs import drain


class BundleAssetTests(ApiCase):
    def make_asset(self, color):
        return self.ctx.assets.put(png(color), source="bundle test")

    def export(self, series_id):
        return self.client.get(f"/api/series/{series_id}/bundle")

    def test_frozen_workflow_asset_survives_import_into_a_fresh_workspace(self):
        asset = self.make_asset((0, 0, 255))
        workflow = self.ctx.store.get_doc("workflow", "builtin_i2i_tile").model_copy(
            update={"id": "bundle-init", "source": "import"}, deep=True
        )
        workflow.config.values["init"] = asset_value(asset.id)
        self.ctx.store.put_doc(workflow)
        workshop = self.ctx.store.create_series(Series(title="Templates", kind="workshop"))
        board = self.ctx.store.create_episode(
            Episode(
                series_id=workshop.id,
                title="One frame",
                order=0,
                panels=[Panel(order=0, overrides=PanelOverrides(raw_prompt="a blue cup"))],
            )
        )
        made = self.ok(
            self.client.post(
                "/api/workshop/assemble",
                json={
                    "storyboard_id": board.id,
                    "generation": {"workflow_id": workflow.id, "candidates": 1},
                },
            ),
            201,
        )
        # The snapshot is now the only workflow document that can supply this input.
        self.ctx.store.delete_doc("workflow", workflow.id)
        exported = self.ok(self.export(made["series"]["id"]))

        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        target = AppContext.create(
            Path(tmp.name),
            autostart=False,
            seed_instance=False,
            llm_factory=FakeLLM,
            comfy_client_factory=FakeComfy,
        )
        self.addCleanup(target.close)
        target.store.put_doc(ComfyInstance(id="target", base_url="http://fake"))
        target.refresh_instances()
        self.assertFalse(target.assets.exists(asset.id))
        with TestClient(create_app(target, serve_web=False), base_url=LOCAL) as client:
            imported = self.ok(client.post("/api/bundles", content=exported.content), 201)
            self.assertEqual(imported["bad_assets"], [])
            self.assertEqual(target.assets.read(asset.id), self.ctx.assets.read(asset.id))
            episode = target.store.list_episodes(imported["series_id"])[0]
            job = self.ok(
                client.post(
                    f"/api/episodes/{episode.id}/render",
                    json={"candidates": 1, "adopt_first": True},
                )
            )
            completed = drain(target.engine, job["id"])
            self.assertEqual(completed["state"], "completed", completed)
            self.assertIn(f"mio_{asset.id[:24]}.png", FakeClient.uploads)
            saved = target.store.get_episode(episode.id)
            self.assertEqual(len(saved.takes), 1)
            self.assertEqual(saved.adopted(saved.panels[0].id).id, saved.takes[0].id)
            self.assertTrue(target.assets.exists(saved.takes[0].asset_id))

    def test_controls_variants_and_recipe_documents_export_their_images(self):
        assets = [self.make_asset((i, 0, 0)) for i in range(1, 5)]
        workflow = self.ctx.store.get_doc("workflow", "builtin_i2i_tile").model_copy(
            update={"id": "bundle-recipe", "source": "import"}, deep=True
        )
        workflow.config.values["init"] = asset_value(assets[0].id)
        self.ctx.store.put_doc(workflow)
        profile = self.ctx.store.put_doc(
            RenderProfile(
                id="bundle-profile",
                name="Recipe",
                draft=[
                    RenderStage(workflow_id=workflow.id, values={"init": asset_value(assets[1].id)})
                ],
            )
        )
        series = self.ctx.store.create_series(
            Series(
                title="References",
                default_profile_id=profile.id,
                bible=Bible(characters=[Character(id="alice", name="Alice", age=28)]),
                variants=[
                    VariantSet(
                        name="Alternate reference",
                        characters={"alice": {"references": [{"asset_id": assets[2].id}]}},
                    )
                ],
            )
        )
        self.ctx.store.create_episode(
            Episode(
                series_id=series.id,
                title="Control",
                order=0,
                panels=[
                    Panel(order=0, controls=[ControlInput(source="asset", asset_id=assets[3].id)])
                ],
            )
        )
        exported = self.ok(self.export(series.id))
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            self.assertEqual(json.loads(archive.read("manifest.json"))["counts"]["assets"], 4)
            for asset in assets:
                self.assertEqual(
                    archive.read(f"assets/{self.ctx.assets.path(asset.id).name}"),
                    self.ctx.assets.read(asset.id),
                )

    def test_missing_asset_metadata_rejects_export(self):
        missing = "a" * 64
        series = self.ctx.store.create_series(Series(title="Missing", cover_asset_id=missing))
        response = self.export(series.id)
        self.assertEqual(response.status_code, 400)
        self.assertIn(missing, response.json()["detail"])

    def test_missing_asset_file_rejects_export(self):
        asset = self.make_asset((0, 255, 0))
        series = self.ctx.store.create_series(Series(title="Missing", cover_asset_id=asset.id))
        self.ctx.assets.path(asset.id).unlink()
        response = self.export(series.id)
        self.assertEqual(response.status_code, 400)
        self.assertIn(asset.id, response.json()["detail"])
