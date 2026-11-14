"""Cloud routes and immutable local follow-up plans, without external services."""

import copy
from types import SimpleNamespace
from unittest import mock

from mio_server.models import VariantSet
from mio_server.pipeline import cloud_jobs
from mio_server.pipeline.render import RenderError
from mio_server.pipeline.render_cloud import CLOUD_SOURCE, bind_cloud_source
from mio_server.render_models import RenderStage
from mio_server.storage import NotFound

from .test_compile_executor import FakeClient
from .test_render_qa import FakeCloudRenderer, Harness


class CloudRouteTests(Harness):
    def cloud_profile(self, **changes):
        return self.store.put_doc(
            self.render.profile(None).model_copy(
                update={
                    "id": "cloud-route",
                    "cloud_shape": True,
                    "candidates": 1,
                    **changes,
                }
            )
        )

    def submit(self, profile, **kw):
        return self.render.render(self.episode.id, ["p02"], profile_id=profile.id, **kw)

    def local_instance(self):
        self.engine.pool.set_instances(
            [SimpleNamespace(id="c1", base_url="http://x", capacity=2, enabled=True)]
        )

    def test_cloud_ignores_stale_local_workflows_even_after_opt_in_changes(self):
        profile = self.cloud_profile()
        self.store.delete_doc("workflow", profile.final[0].workflow_id)
        self.store.delete_doc("workflow", profile.draft[0].workflow_id)
        self.engine.pool.set_instances([])
        job = self.submit(profile, adopt_first=True)
        self.assertEqual(job["snapshot"]["purpose"], "cloud")
        self.assertIsNone(job["items"][0]["input"]["refinement"])
        self.store.put_doc(profile.model_copy(update={"cloud_refine": True}))
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(job)
        self.assertEqual(ep.adopted("p02").stage, "draft")
        self.assertEqual(len(self.engine.list()), 1)
        self.assertEqual(FakeClient.graphs, [])

    def frozen_job(self):
        profile = self.cloud_profile(cloud_refine=True, instances=["c1"], model_group="original")
        profile.final.append(profile.final[0].model_copy(update={"id": "second"}))
        self.store.put_doc(profile)
        job = self.submit(profile, adopt_first=True, idempotency_key="frozen-hybrid")
        plan = copy.deepcopy(job["items"][0]["input"]["refinement"])
        self.assertEqual(plan["instances"], ["c1"])
        self.assertEqual(plan["group"], "original")
        self.assertEqual(plan["stages"][0]["uploads"]["/10/inputs/image"], CLOUD_SOURCE)
        return profile, job, plan

    def check_frozen(self, job, plan):
        self.engine.pool.set_instances([])
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(job)
        self.assertIsNone(ep.adopted("p02"))
        shape = ep.takes[0]
        refine = next(j for j in self.engine.list() if j["kind"] == "comfy.render")
        item = self.engine.get(refine["id"])["items"][0]
        bound = bind_cloud_source(plan, shape.asset_id)
        self.assertEqual(item["input"]["stages"], bound["stages"])
        self.assertEqual(item["input"]["feeds"], plan["feeds"])
        self.assertEqual(item["instances"], ["c1"])
        self.assertEqual(item["group"], "original")
        self.assertEqual(self.engine.get(job["id"])["items"][0]["input"]["refinement"], plan)
        self.local_instance()
        ep = self.run_job(refine)
        self.assertEqual(ep.adopted("p02").parent_take_id, shape.id)
        self.assertEqual(ep.adopted("p02").stage, "draft")
        self.assertEqual(FakeClient.graphs[0]["14"]["inputs"]["denoise"], 0.35)
        self.assertEqual(len(FakeClient.graphs), 2)
        self.assertEqual(self.render.refine_shape(ep.id, shape.id, plan)["id"], refine["id"])

    def test_hybrid_snapshot_survives_profile_and_workflow_changes(self):
        profile, job, plan = self.frozen_job()
        profile.cloud_refine = False
        profile.final[0].values["denoise"] = 0.99
        profile.instances = ["other"]
        profile.model_group = "changed"
        self.store.put_doc(profile)
        workflow = self.render.workflow(profile.final[0].workflow_id)
        workflow.graph["14"]["inputs"]["steps"] = 99
        self.store.put_doc(workflow)
        self.check_frozen(job, plan)

    def test_hybrid_snapshot_survives_profile_and_workflow_deletion(self):
        profile, job, plan = self.frozen_job()
        self.store.delete_doc("profile", profile.id)
        self.store.delete_doc("workflow", profile.final[0].workflow_id)
        self.check_frozen(job, plan)

    def test_refinement_submission_stays_idempotent_after_manual_parent_adoption(self):
        profile = self.cloud_profile(cloud_refine=True)
        self.engine.pool.set_instances([])
        job = self.submit(profile)
        plan = job["items"][0]["input"]["refinement"]
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(job)
        shape = ep.takes[0]
        refine = next(j for j in self.engine.list() if j["kind"] == "comfy.render")
        self.adopt(shape.id)
        self.assertEqual(self.render.refine_shape(ep.id, shape.id, plan)["id"], refine["id"])
        self.local_instance()
        ep = self.run_job(refine)
        self.assertEqual(ep.adopted("p02").parent_take_id, shape.id)

    def test_invalid_hybrid_fails_before_submitting_a_cloud_job(self):
        bad_chains = [
            [],
            [RenderStage(workflow_id="builtin_i2i_tile", enabled=False)],
            [RenderStage(workflow_id="builtin_t2i_sdxl")],
            [RenderStage(workflow_id="builtin_i2i_tile", feed="none")],
            [RenderStage(workflow_id="builtin_i2i_tile", overrides={"/10/inputs/image": "x"})],
        ]
        for chain in bad_chains:
            with self.subTest(chain=chain):
                profile = self.cloud_profile(cloud_refine=True, final=chain)
                with self.assertRaises(RenderError):
                    self.submit(profile)
                self.assertEqual(self.engine.list(), [])
        self.assertEqual(FakeClient.graphs, [])

    def test_cloud_adopted_draft_can_be_explicitly_finalized(self):
        profile = self.cloud_profile()
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(self.submit(profile, adopt_first=True))
        draft = ep.adopted("p02")
        job = self.render.finalize(ep.id, profile_id=profile.id)
        ep = self.run_job(job)
        self.assertEqual(ep.adopted("p02").stage, "final")
        self.assertEqual(ep.adopted("p02").parent_take_id, draft.id)

    def test_explicit_hybrid_candidate_plans_are_independent(self):
        profile = self.cloud_profile(cloud_refine=True)
        job = self.submit(profile, candidates=2, idempotency_key="two-cloud-candidates")
        again = self.submit(profile, candidates=2, idempotency_key="two-cloud-candidates")
        self.assertEqual(again["id"], job["id"])
        first, second = [item["input"]["refinement"] for item in job["items"]]
        self.assertNotEqual(first["meta"]["seed"], second["meta"]["seed"])
        first["stages"][0]["graph"].clear()
        self.assertTrue(second["stages"][0]["graph"])

    def test_panel_cloud_override_controls_a_local_default_request(self):
        profile = self.cloud_profile()
        self.store.update_episode(
            self.episode.id, lambda e: setattr(e.panel("p02").overrides, "profile_id", profile.id)
        )
        job = self.render.render(self.episode.id, ["p02"], variant_ids=[None], adopt_first=True)
        self.assertEqual(job["kind"], "cloud.render")
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(job)
        self.assertEqual(ep.adopted("p02").parameter_snapshot["profile_id"], profile.id)

    def test_mixed_panel_routes_and_missing_profiles_do_not_submit_partial_batches(self):
        profile = self.cloud_profile()
        self.store.update_episode(
            self.episode.id,
            lambda e: setattr(e.panel("p02").overrides, "profile_id", profile.id),
        )
        with self.assertRaisesRegex(RenderError, "混用"):
            self.render.render(self.episode.id, ["p02", "p03"])
        self.store.delete_doc("profile", profile.id)
        with self.assertRaises(NotFound):
            self.render.render(self.episode.id, ["p02"])
        self.assertEqual(self.engine.list(), [])

    def test_cloud_rejects_empty_panel_selection_and_unknown_variant(self):
        profile = self.cloud_profile()
        with self.assertRaisesRegex(RenderError, "没有要出图"):
            self.render.render(self.episode.id, [], profile_id=profile.id)
        with self.assertRaisesRegex(RenderError, "变体不存在"):
            self.submit(profile, variant_ids=["missing"])
        self.assertEqual(self.engine.list(), [])

    def test_panel_local_override_controls_a_cloud_default_request(self):
        profile = self.cloud_profile()
        self.store.update_series(
            self.series.id, lambda s: setattr(s, "default_profile_id", profile.id)
        )
        self.store.update_episode(
            self.episode.id,
            lambda e: setattr(e.panel("p02").overrides, "profile_id", "profile_default"),
        )
        job = self.render.render(self.episode.id, ["p02"], variant_ids=[None], adopt_first=True)
        self.assertEqual(job["kind"], "comfy.render")
        self.assertEqual(self.run_job(job).adopted("p02").stage, "draft")

    def test_variant_override_and_real_mixed_batches(self):
        profile = self.cloud_profile()
        self.store.update_series(
            self.series.id,
            lambda s: s.variants.append(
                VariantSet(id="cloud-variant", name="Cloud", profile_id=profile.id)
            ),
        )
        job = self.render.render(self.episode.id, ["p02"], variant_ids=["cloud-variant"])
        self.assertEqual(job["kind"], "cloud.render")
        with self.assertRaisesRegex(RenderError, "混用"):
            self.render.render(self.episode.id, ["p02"], variant_ids=[None, "cloud-variant"])
        self.assertEqual(len(self.engine.list()), 1)

    def test_hybrid_replacement_adopts_only_the_first_refined_candidate(self):
        profile = self.cloud_profile()
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(self.submit(profile, adopt_first=True))
        original = ep.adopted("p02").id
        profile.cloud_refine = True
        self.store.put_doc(profile)
        self.engine.pool.set_instances([])
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(self.submit(profile, adopt_replace=True, candidates=2))
        self.assertEqual(ep.adopted("p02").id, original)
        refinements = [j for j in self.engine.list() if j["kind"] == "comfy.render"]
        self.assertEqual(len(refinements), 2)
        self.local_instance()
        for job in refinements:
            ep = self.run_job(job)
        adopted = ep.adopted("p02")
        self.assertNotEqual(adopted.id, original)
        self.assertEqual(adopted.stage, "draft")
        self.assertEqual(adopted.parameter_snapshot["candidate"], 0)
        self.assertEqual(ep.take(adopted.parent_take_id).stage, "shape")
