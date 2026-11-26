import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from mio_server.assets import AssetStore
from mio_server.comfy.compile import find_placeholders
from mio_server.comfy.executor import ComfyRenderExecutor
from mio_server.jobs import JobEngine
from mio_server.models import AssetRef, Series, TakeStatus, VariantSet
from mio_server.pipeline import cloud_jobs
from mio_server.pipeline import qa as Q
from mio_server.pipeline import story as ST
from mio_server.pipeline.cloud_jobs import CloudExecutor
from mio_server.pipeline.render import RenderError, RenderService
from mio_server.render_models import RenderStage
from mio_server.storage import SQLiteStore

from .story_fixture import make_story
from .test_compile_executor import FakeClient, image_pair_workflow, png
from .test_jobs import drain


class FakeVLM:
    identity = 5
    dialogue_score = 4
    dialogue_note = "The visible mood and setting support the line."

    def vision_json(self, text, images):
        if text.startswith("Locate"):
            return {"faces": [{"name": "unknown", "box": [100, 100, 400, 400]}]}, SimpleNamespace(
                model="vlm", seconds=0
            )
        dialogue = json.loads(
            text.split("<dialogue_data>\n", 1)[1].split("\n</dialogue_data>", 1)[0]
        )
        note = (
            f"{FakeVLM.dialogue_note} "
            f"({dialogue[0]['speaker']}/{dialogue[0]['kind']}: {dialogue[0]['text']})"
            if dialogue
            else ""
        )
        return (
            {
                "characters": [
                    {"present": True, "identity": FakeVLM.identity, "features": {"bob cut": True}}
                ],
                "extra_people": 0,
                "scene": 4,
                "quality": 4,
                "dialogue": {"score": FakeVLM.dialogue_score if dialogue else None, "note": note},
            },
            SimpleNamespace(model="vlm", seconds=0.1),
        )


class FakeCloudRenderer:
    def __init__(self, llm):
        pass

    def panel(self, story, panel, sheets, **kwargs):
        return png((9, 9, 9)), {"model": "cloud", "mode": "shape"}

    def edit(self, image, instruction, refs=(), **kwargs):
        return png((8, 8, 8)), {"model": "cloud", "mode": "edit"}


class Harness(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.store = SQLiteStore(Path(tmp.name) / "db.sqlite3")
        self.addCleanup(self.store.close)
        self.assets = AssetStore(Path(tmp.name) / "assets", self.store)
        self.engine = JobEngine(":memory:", autostart=False, poll=0.01)
        self.addCleanup(self.engine.close)
        self.engine.pool.set_instances(
            [SimpleNamespace(id="c1", base_url="http://x", capacity=2, enabled=True)]
        )
        self.render = RenderService(self.store, self.assets, self.engine)
        self.render.seed_builtins()
        self.qa = Q.QAService(self.store, self.assets, self.engine, FakeVLM)
        self.engine.register(
            "comfy.render",
            ComfyRenderExecutor(self.assets, FakeClient, on_result=self.render.apply_result),
        )
        self.engine.register("cloud.render", CloudExecutor(self.assets, FakeVLM, self.render))
        self.engine.register("qa.check", self.qa)
        FakeClient.uploads, FakeClient.graphs, FakeClient.mode = [], [], "ok"
        series = Series(title="雨夜便利店")
        bible, episode = ST.from_story(make_story(4), series.id)
        series.bible = bible
        lin_ref = self.assets.put(png((1, 1, 1)), source="ref").id
        series.bible.character("lin").references = [AssetRef(asset_id=lin_ref, role="front")]
        self.series = self.store.create_series(series)
        self.episode = self.store.create_episode(episode)

    def run_job(self, job):
        done = drain(self.engine, job["id"])
        self.assertEqual(done["state"], "completed", done)
        return self.store.get_episode(self.episode.id)

    def adopt(self, take_id):
        def mutate(ep):
            t = ep.take(take_id)
            t.status = TakeStatus.adopted
            t.parameter_snapshot = {**t.parameter_snapshot, "adopted_by": "user"}

        self.store.update_episode(self.episode.id, mutate)


class RenderTests(Harness):
    def test_draft_chain_fills_all_previous_targets_with_one_upload(self):
        workflow = self.store.put_doc(image_pair_workflow())
        profile = self.render.profile(None)
        profile.draft.append(RenderStage(id="pair", kind="refine", workflow_id=workflow.id))
        self.store.put_doc(profile)
        job = self.render.render(self.episode.id, ["p02"], candidates=1)
        plan = job["items"][0]["input"]
        self.assertEqual(plan["feeds"], [[], ["/10/inputs/image", "/11/inputs/image"]])
        self.assertEqual(plan["stages"][1]["uploads"], {})
        ep = self.run_job(job)
        self.assertEqual(len(ep.takes), 1)
        result = self.engine.get(job["id"])["items"][0]["result"]
        first = result["stages"][0]["images"][0]["asset_id"]
        self.assertEqual(FakeClient.uploads, [f"mio_{first[:24]}.png"])
        graph = FakeClient.graphs[1]
        self.assertEqual(graph["10"]["inputs"]["image"], f"mio/{FakeClient.uploads[0]}")
        self.assertEqual(graph["11"]["inputs"]["image"], graph["10"]["inputs"]["image"])
        self.assertEqual(graph["12"]["inputs"], workflow.graph["12"]["inputs"])
        self.assertEqual(find_placeholders(graph), {})

    def test_automatic_references_fill_plain_ref_and_skip_unused_extra_slots(self):
        workflow = self.store.put_doc(image_pair_workflow("ref", "ref"))
        stage = RenderStage(id="pair", kind="generate", workflow_id=workflow.id)
        data, _, _ = self.render._compile_stage(
            stage, {"ref:1": {"$asset": "first"}, "ref:2": {"$asset": "unused"}}
        )
        self.assertEqual(
            data["uploads"], {"/10/inputs/image": "first", "/11/inputs/image": "first"}
        )
        profile = self.render.profile(None)
        profile.draft = [stage]
        self.store.put_doc(profile)
        self.run_job(self.render.render(self.episode.id, ["p02"], candidates=1))
        ref = self.series.bible.character("lin").references[0].asset_id
        self.assertEqual(FakeClient.uploads, [f"mio_{ref[:24]}.png"])
        self.assertEqual(
            FakeClient.graphs[0]["10"]["inputs"]["image"], f"mio/{FakeClient.uploads[0]}"
        )

    def test_single_edit_uploads_one_source_for_all_init_targets(self):
        ep = self.run_job(self.render.render(self.episode.id, ["p02"], candidates=1))
        take = ep.takes[0]
        workflow = self.store.put_doc(image_pair_workflow())
        profile = self.render.profile(None)
        profile.edits["edit"] = RenderStage(id="pair", kind="refine", workflow_id=workflow.id)
        self.store.put_doc(profile)
        job = self.render.edit(self.episode.id, take.id, "edit", {"instruction": "adjust color"})
        self.assertEqual(job["items"][0]["input"]["feeds"], [[]])
        self.run_job(job)
        self.assertEqual(FakeClient.uploads, [f"mio_{take.asset_id[:24]}.png"])
        graph = FakeClient.graphs[-1]
        self.assertEqual(graph["10"]["inputs"]["image"], graph["11"]["inputs"]["image"])
        self.assertEqual(find_placeholders(graph), {})

    def test_draft_candidates_become_takes(self):
        job = self.render.render(self.episode.id, ["p02", "p03"], candidates=2)
        self.assertEqual(len(job["items"]), 4)
        ep = self.run_job(job)
        self.assertEqual(len(ep.takes), 4)
        take = ep.takes[0]
        self.assertEqual(
            (take.stage, take.status, take.job_id), ("draft", TakeStatus.candidate, job["id"])
        )
        self.assertIn("bob cut", take.parameter_snapshot["prompt"])
        self.assertEqual(take.parameter_snapshot["instance"], "c1")
        self.assertEqual(len({t.seed for t in ep.takes}), 4)

    def test_idempotent_submit(self):
        a = self.render.render(self.episode.id, ["p02"], candidates=1, idempotency_key="k1")
        self.assertEqual(self.engine.get(a["id"])["id"], a["id"])
        self.assertEqual(len(self.engine.list()), 1)

    def test_variants_render_per_set(self):
        var = VariantSet(name="冬装", characters={"lin": {"tag_description": ["red scarf"]}})
        self.store.update_series(self.series.id, lambda s: s.variants.append(var))
        ep = self.run_job(
            self.render.render(self.episode.id, ["p02"], candidates=1, variant_ids=[None, var.id])
        )
        by_variant = {t.variant_id: t for t in ep.takes}
        self.assertIn("red scarf", by_variant[var.id].parameter_snapshot["prompt"])
        self.assertNotIn("red scarf", by_variant[None].parameter_snapshot["prompt"])
        with self.assertRaises(RenderError):
            self.render.render(self.episode.id, variant_ids=["nope"])

    def test_finalize_adopted_draft(self):
        ep = self.run_job(self.render.render(self.episode.id, ["p02"], candidates=1))
        draft = ep.takes[0]
        self.adopt(draft.id)
        ep = self.run_job(self.render.finalize(self.episode.id))
        final = next(t for t in ep.takes if t.stage == "final")
        self.assertEqual(final.status, TakeStatus.adopted)
        self.assertEqual(ep.take(draft.id).status, TakeStatus.candidate)
        self.assertEqual(final.parent_take_id, draft.id)
        self.assertEqual(final.edits[-1].kind, "final")
        self.assertIn(f"mio_{draft.asset_id[:24]}.png", FakeClient.uploads)

    def test_inpaint_and_outpaint(self):
        ep = self.run_job(self.render.render(self.episode.id, ["p02"], candidates=1))
        take = ep.takes[0]
        ep = self.run_job(
            self.render.edit(
                self.episode.id,
                take.id,
                "inpaint",
                {"boxes": [[0.1, 0.1, 0.5, 0.5]], "prompt": "smile"},
            )
        )
        edited = ep.takes[-1]
        self.assertEqual(edited.edits[-1].kind, "inpaint")
        self.assertIn("mask_asset_id", edited.edits[-1].params)
        self.assertEqual(edited.parent_take_id, take.id)
        ep = self.run_job(
            self.render.edit(self.episode.id, take.id, "outpaint", {"aspect_ratio": "1:1"})
        )
        self.assertEqual(ep.takes[-1].edits[-1].params["pads"], [16, 0, 16, 0])
        with self.assertRaises(RenderError):
            self.render.edit(self.episode.id, take.id, "outpaint", {"aspect_ratio": "2:3"})

    def test_instruction_edit_goes_to_cloud(self):
        ep = self.run_job(self.render.render(self.episode.id, ["p02"], candidates=1))
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            job = self.render.edit(
                self.episode.id, ep.takes[0].id, "edit", {"instruction": "close her eyes"}
            )
            self.assertEqual(job["kind"], "cloud.render")
            ep = self.run_job(job)
        self.assertEqual(ep.takes[-1].edits[-1].params["route"], "cloud")

    def test_hybrid_shape_then_local_refine(self):
        profile = self.render.profile(None).model_copy(
            update={"id": "hybrid", "cloud_shape": True, "cloud_refine": True}
        )
        self.store.put_doc(profile)
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(self.render.render(self.episode.id, ["p02"], profile_id="hybrid"))
        shaped = next(t for t in ep.takes if t.stage == "shape")
        refine = next(j for j in self.engine.list() if j["kind"] == "comfy.render")
        ep = self.run_job(refine)
        refined = next(t for t in ep.takes if t.parent_take_id == shaped.id)
        self.assertEqual(refined.edits[-1].kind, "refine")

    def test_panel_deleted_while_rendering(self):
        job = self.render.render(self.episode.id, ["p02"], candidates=1)
        self.store.update_episode(self.episode.id, lambda ep: ep.panels.remove(ep.panel("p02")))
        ep = self.run_job(job)
        self.assertEqual(ep.takes, [])


class QATests(Harness):
    def test_nonidentity_assessment_does_not_award_unassessed_identity_or_visual_scores(self):
        story = make_story(4)
        panel = {"id": "p01", "characters": [], "dialogue": []}
        for scene, quality, expected_score, passed in [
            (4, 4, 0.8, True),
            (2, 4, 0.6, False),
            (4, 2, 0.6, False),
            (5, None, 0.5, False),
            (None, 5, 0.5, False),
            (True, 5, 0.5, False),
            (5, 0, 0.5, False),
        ]:
            with self.subTest(scene=scene, quality=quality):
                run = {"verdicts": [], "extra_people": 0, "scene": scene, "quality": quality}
                qa = Q.aggregate(story, panel, [run])
                self.assertEqual((qa.score, qa.passed), (expected_score, passed))
                self.assertEqual(qa.identity, [])
                self.assertEqual(qa.dialogue_status, "not_assessed")
                self.assertEqual(qa.votes, 1)
                if not passed:
                    self.assertTrue(qa.issues)
        runs = [
            {"verdicts": [], "extra_people": 0, "scene": scene, "quality": 5}
            for scene in (5, None, None)
        ]
        qa = Q.aggregate(story, panel, runs)
        self.assertFalse(qa.passed)
        self.assertIsNone(qa.shot_ok)
        self.assertEqual(qa.score, 0.5)

    def test_aggregate_median_and_majority(self):
        story = make_story(4)
        panel = {"id": "p02", "characters": [{"id": "lin"}]}
        runs = [
            {
                "verdicts": [
                    {"character": "lin", "present": True, "identity": s, "features_wrong": w}
                ],
                "extra_people": 0,
                "scene": 4,
                "quality": 4,
            }
            for s, w in ((5, []), (1, ["bob cut"]), (4, []))
        ]
        qa = Q.aggregate(story, panel, runs)
        self.assertEqual(qa.identity[0].score, 4)
        self.assertEqual(qa.identity[0].missing, [])
        self.assertTrue(qa.passed)
        runs.append(
            {
                "verdicts": [
                    {"character": "lin", "present": True, "identity": 5, "features_wrong": []}
                ],
                "extra_people": 2,
                "scene": 4,
                "quality": 4,
            }
        )
        self.assertTrue(Q.aggregate(story, panel, runs).passed)  # one extra-people vote is outvoted
        runs += [dict(runs[-1]) for _ in range(3)]  # now 4 of 7 votes see extra people
        self.assertFalse(Q.aggregate(story, panel, runs).passed)

    def test_qa_job_sets_verdicts_and_auto_picks(self):
        ep = self.run_job(self.render.render(self.episode.id, ["p02"], candidates=2))
        ep = self.run_job(self.qa.submit(self.episode.id, votes=2))
        self.assertTrue(all(t.qa and t.qa.passed for t in ep.takes))
        self.assertTrue(all(t.qa.dialogue_status == "assessed" for t in ep.takes))
        self.assertTrue(
            all(t.qa.dialogue_score == 4 and t.qa.dialogue_votes == 2 for t in ep.takes)
        )
        self.assertIn("lin/speech: 又是你啊。", ep.takes[0].qa.dialogue_note)
        self.assertEqual(len(ep.takes[0].faces), 1)
        adopted = ep.adopted("p02")
        self.assertIsNotNone(adopted)
        self.assertEqual(adopted.parameter_snapshot["adopted_by"], "auto")

    def test_auto_pick_respects_user_choice_and_lock(self):
        ep = self.run_job(self.render.render(self.episode.id, ["p02", "p04"], candidates=2))
        p02 = [t for t in ep.takes if t.panel_id == "p02"]
        self.adopt(p02[1].id)
        self.store.update_episode(
            self.episode.id, lambda e: setattr(e.panel("p04"), "locked", True)
        )
        ep = self.run_job(self.qa.submit(self.episode.id, votes=1))
        self.assertEqual(ep.adopted("p02").id, p02[1].id)
        self.assertIsNone(ep.adopted("p04"))

    def test_failed_identity_is_not_adopted(self):
        FakeVLM.identity = 2
        self.addCleanup(setattr, FakeVLM, "identity", 5)
        ep = self.run_job(self.render.render(self.episode.id, ["p02"], candidates=1))
        ep = self.run_job(self.qa.submit(self.episode.id, votes=1))
        self.assertFalse(ep.takes[0].qa.passed)
        self.assertIsNone(ep.adopted("p02"))
