"""Portable imports preserve source recipes and commit as one visible operation."""

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from mio_server.assets import AssetStore
from mio_server.bundle import export_series, import_series
from mio_server.generation import profile_for
from mio_server.models import Episode, GenerationSnapshot, Panel, PanelOverrides, Series, VariantSet
from mio_server.render_models import RenderProfile, RenderStage, WorkflowDoc
from mio_server.storage import Conflict, SQLiteStore


class BundleImportTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.source = SQLiteStore(":memory:")
        self.target = SQLiteStore(":memory:")
        self.addCleanup(self.source.close)
        self.addCleanup(self.target.close)
        self.source_assets = AssetStore(Path(tmp.name) / "source", self.source)
        self.target_assets = AssetStore(Path(tmp.name) / "target", self.target)
        self.workflow = self.source.put_doc(
            WorkflowDoc(
                id="shared-workflow",
                name="Source workflow",
                graph={"1": {"class_type": "Text", "inputs": {"text": "source"}}},
            )
        )
        self.profile = self.source.put_doc(
            RenderProfile(
                id="shared-profile",
                name="Source profile",
                candidates=2,
                draft=[RenderStage(workflow_id=self.workflow.id)],
                final=[RenderStage(workflow_id=self.workflow.id)],
                edits={"inpaint": RenderStage(workflow_id=self.workflow.id)},
            )
        )
        self.series = self.source.create_series(
            Series(
                title="Imported story",
                default_profile_id=self.profile.id,
                variants=[VariantSet(name="Alternate", profile_id=self.profile.id)],
            )
        )
        self.episode = self.source.create_episode(
            Episode(
                series_id=self.series.id,
                title="One",
                order=0,
                panels=[Panel(order=0, overrides=PanelOverrides(profile_id=self.profile.id))],
            )
        )

    def archive(self):
        return export_series(self.source, self.source_assets, self.series.id)

    def test_failed_import_rolls_back_series_documents_and_asset_metadata(self):
        asset = self.source_assets.put(b"bundle image")
        self.series.cover_asset_id = asset.id
        self.source.save_series(self.series)
        self.source.create_episode(Episode(series_id=self.series.id, title="Two", order=1))
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.archive())) as original:
            with zipfile.ZipFile(output, "w") as broken:
                for name in original.namelist():
                    data = original.read(name)
                    if name.startswith("episodes/"):
                        episode = json.loads(data)
                        episode["order"] = 0
                        data = json.dumps(episode).encode()
                    broken.writestr(name, data)
        with self.assertRaises(Conflict):
            import_series(self.target, self.target_assets, output.getvalue())
        self.assertEqual(self.target.list_series(), [])
        self.assertEqual(self.target.list_docs("profile"), [])
        self.assertEqual(self.target.list_docs("workflow"), [])
        self.assertEqual(self.target.asset_ids(), set())
        result = import_series(self.target, self.target_assets, self.archive())
        self.assertFalse(result["renamed"])
        self.assertEqual(len(self.target.list_episodes(result["series_id"])), 2)
        self.assertEqual(self.target_assets.read(asset.id), b"bundle image")

    def add_conflicting_documents(self):
        self.target.put_doc(self.profile.model_copy(update={"name": "Local", "candidates": 9}))
        self.target.put_doc(
            self.workflow.model_copy(
                update={
                    "name": "Local",
                    "graph": {"1": {"class_type": "Text", "inputs": {"text": "local"}}},
                }
            )
        )

    def test_conflicting_recipe_ids_preserve_imported_and_local_recipes(self):
        self.add_conflicting_documents()
        result = import_series(self.target, self.target_assets, self.archive())
        imported = self.target.get_series(result["series_id"])
        profile = profile_for(self.target, imported)
        self.assertEqual(profile.candidates, 2)
        self.assertNotEqual(profile.id, self.profile.id)
        self.assertEqual(imported.variants[0].profile_id, profile.id)
        panel = self.target.list_episodes(imported.id)[0].panels[0]
        self.assertEqual(panel.overrides.profile_id, profile.id)
        for stage in [*profile.draft, *profile.final, *profile.edits.values()]:
            workflow = self.target.get_doc("workflow", stage.workflow_id)
            self.assertNotEqual(workflow.id, self.workflow.id)
            self.assertEqual(workflow.graph["1"]["inputs"]["text"], "source")
        self.assertEqual(self.target.get_doc("profile", self.profile.id).candidates, 9)
        self.assertEqual(
            self.target.get_doc("workflow", self.workflow.id).graph["1"]["inputs"]["text"],
            "local",
        )

    def test_conflicting_workflow_id_remaps_even_without_a_profile_collision(self):
        self.target.put_doc(
            self.workflow.model_copy(
                update={"graph": {"1": {"class_type": "Text", "inputs": {"text": "local"}}}}
            )
        )
        result = import_series(self.target, self.target_assets, self.archive())
        profile = profile_for(self.target, self.target.get_series(result["series_id"]))
        workflow = self.target.get_doc("workflow", profile.draft[0].workflow_id)
        self.assertEqual(workflow.graph["1"]["inputs"]["text"], "source")

    def test_frozen_recipe_remains_independent_when_document_ids_are_remapped(self):
        self.series.generation = GenerationSnapshot(
            profile_id=self.profile.id,
            profile=self.profile.model_dump(),
            profiles={self.profile.id: self.profile.model_dump()},
            workflows={self.workflow.id: self.workflow.model_dump()},
        )
        self.source.save_series(self.series)
        self.source.put_doc(self.profile.model_copy(update={"candidates": 5}))
        self.add_conflicting_documents()
        result = import_series(self.target, self.target_assets, self.archive())
        imported = self.target.get_series(result["series_id"])
        self.assertNotEqual(imported.default_profile_id, self.profile.id)
        frozen = imported.generation
        self.assertEqual(frozen.profile_id, imported.default_profile_id)
        self.assertEqual(frozen.profile["id"], imported.default_profile_id)
        self.assertEqual(
            profile_for(self.target, imported, imported.default_profile_id).candidates, 2
        )
        self.assertEqual(self.target.get_doc("profile", imported.default_profile_id).candidates, 5)
        workflow_id = frozen.profile["draft"][0]["workflow_id"]
        self.assertNotEqual(workflow_id, self.workflow.id)
        self.assertEqual(frozen.workflows[workflow_id]["id"], workflow_id)
        self.assertEqual(frozen.workflows[workflow_id]["graph"]["1"]["inputs"]["text"], "source")
