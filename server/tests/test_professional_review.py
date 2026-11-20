"""Installable review panels exercise real typed APIs with offline text/vision models."""

import copy
import io
import zipfile
from pathlib import Path
from unittest.mock import patch

from mio_server.extensions.ctk import check_package
from mio_server.models import AssetRef, Series, Take
from mio_server.pipeline.story import from_story

from .api_harness import ApiCase, FakeLLM
from .story_fixture import make_story
from .test_compile_executor import png
from .test_render_qa import FakeVLM

EXAMPLES = Path(__file__).resolve().parents[2] / "examples/extensions"


def package(identifier):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path in sorted((EXAMPLES / identifier).iterdir()):
            if path.is_file() and path.suffix in {".json", ".html", ".js", ".py", ".md"}:
                archive.write(path, identifier + "/" + path.name)
    return buffer.getvalue()


class ReviewPanelTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.series = Series(title="Offline review")
        bible, episode = from_story(make_story(3), self.series.id)
        self.series.bible = bible
        reference = self.ctx.assets.put(png((20, 40, 60)), source="test-reference")
        for character in bible.characters:
            character.references = [AssetRef(asset_id=reference.id, role="front")]
        image = self.ctx.assets.put(png((80, 100, 120)), source="test-candidate")
        episode.takes = [
            Take(panel_id="p02", asset_id=image.id, status="adopted", width=64, height=96),
            Take(panel_id="p02", asset_id=image.id, width=64, height=96),
        ]
        self.ctx.store.create_series(self.series)
        self.episode = self.ctx.store.create_episode(episode)
        self.addCleanup(setattr, FakeVLM, "identity", 5)

    def token(self, scopes):
        value = self.ok(
            self.client.post("/api/tokens", json={"name": "Review test", "scopes": scopes}), 201
        )
        return {"Authorization": "Bearer " + value["token"]}

    def install(self, identifier, *, remote=False):
        prefix = "/api/v2" if remote else "/api"
        headers = self.token(["admin", "read", "render", "write"]) if remote else {}
        installed = self.ok(
            self.client.post(prefix + "/extensions", content=package(identifier), headers=headers),
            201,
        )
        self.assertEqual(installed["status"], "disabled")
        self.ok(
            self.client.post(
                prefix + f"/extensions/{identifier}/enable",
                json={"digest": installed["digest"]},
                headers=headers,
            )
        )
        panels = self.ok(self.client.get(prefix + "/extension-panels", headers=headers))
        panel = next(item for item in panels if item["extension"] == identifier)
        self.assertEqual(self.ctx.engine.list(), [])
        return panel, headers

    def bridge(self, panel, request_id, *, body=None, params=None, headers=None):
        payload = {
            "activation": panel["activation"],
            "digest": panel["digest"],
            "request_id": request_id,
            "path_params": {"episode_id": self.episode.id} if params is None else params,
            "context": {"episode_id": self.episode.id, "series_id": self.series.id},
        }
        if body is not None:
            payload["body"] = body
        prefix = "/api/v2" if headers else "/api"
        response = self.client.post(
            prefix + f"/extension-panels/{panel['extension']}/review/requests",
            json=payload,
            headers=headers,
        )
        return response

    def reply(self, response, status=200):
        value = self.ok(response)
        self.assertEqual(value["status"], status, value)
        return value["data"]

    def test_both_packages_pass_ctk_and_v2_lifecycle_revokes_old_panels(self):
        before = self.ctx.store.get_episode(self.episode.id).model_dump()
        for identifier in ("qa-review", "script-review"):
            with self.subTest(identifier=identifier):
                report = check_package(EXAMPLES / identifier, "extension")
                self.assertTrue(report.valid, report.model_dump())
                panel, headers = self.install(identifier, remote=True)
                self.assertIsNone(self.ctx.extensions.info(identifier).manifest.main)
                self.assertEqual(
                    self.reply(self.bridge(panel, "episode", headers=headers))["id"],
                    self.episode.id,
                )
                self.ok(
                    self.client.post(f"/api/v2/extensions/{identifier}/disable", headers=headers)
                )
                self.assertEqual(self.bridge(panel, "episode", headers=headers).status_code, 404)
                info = self.ctx.extensions.info(identifier)
                self.ok(
                    self.client.post(
                        f"/api/v2/extensions/{identifier}/enable",
                        json={"digest": info.digest},
                        headers=headers,
                    )
                )
                self.assertEqual(self.bridge(panel, "episode", headers=headers).status_code, 404)
                self.ok(
                    self.client.post(f"/api/v2/extensions/{identifier}/disable", headers=headers)
                )
                self.ok(
                    self.client.delete(f"/api/v2/extensions/{identifier}", headers=headers), 204
                )
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).model_dump(), before)
        self.assertEqual(self.ctx.engine.list(), [])

    def test_qa_real_executor_persists_structured_vlm_issues_without_adopting(self):
        panel, _ = self.install("qa-review")
        FakeVLM.identity = 2
        vision = FakeVLM()
        body = {
            "take_ids": [take.id for take in self.episode.takes],
            "votes": 2,
            "auto_adopt": False,
            "idempotency_key": "review-offline",
        }
        with (
            patch.object(self.ctx.qa, "llm_factory", return_value=vision),
            patch.object(vision, "vision_json", wraps=vision.vision_json) as model,
        ):
            job = self.reply(self.bridge(panel, "review", body=body))
            self.assertFalse(job["snapshot"]["auto_adopt"])
            self.drain(job)
        self.assertEqual(model.call_count, 6)  # two votes and one face check for each candidate
        stored = self.reply(self.bridge(panel, "episode"))
        self.assertEqual([take["status"] for take in stored["takes"]], ["adopted", "candidate"])
        for take in stored["takes"]:
            qa = take["qa"]
            self.assertFalse(qa["passed"])
            self.assertEqual(qa["votes"], 2)
            self.assertEqual(qa["identity"][0]["score"], 2)
            self.assertTrue(qa["issues"])
            self.assertTrue(qa["shot_ok"])
            self.assertTrue(qa["characters_ok"])
            self.assertEqual(qa["model"], "vlm")
        done = self.reply(self.bridge(panel, "job", params={"job_id": job["id"]}))
        self.assertEqual(done["state"], "completed")

    def test_vlm_failure_produces_no_fabricated_qa_and_no_automatic_retry(self):
        panel, _ = self.install("qa-review")
        vision = FakeVLM()
        with (
            patch.object(self.ctx.qa, "llm_factory", return_value=vision),
            patch.object(
                vision, "vision_json", side_effect=RuntimeError("offline fixture failure")
            ) as model,
        ):
            job = self.reply(
                self.bridge(
                    panel,
                    "review",
                    body={"take_ids": [self.episode.takes[1].id], "votes": 1, "auto_adopt": False},
                )
            )
            self.ctx.engine.tick()
            done = self.ctx.engine.wait(job["id"])
        self.assertEqual(done["state"], "failed")
        self.assertEqual(model.call_count, 1)
        self.assertIsNone(self.ctx.store.get_episode(self.episode.id).takes[1].qa)
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).takes[0].status, "adopted")

    def proposal(self, panel):
        return self.reply(
            self.bridge(
                panel, "propose", body={"instruction": "Shorten the dialogue; keep layout."}
            )
        )

    def test_script_diff_shows_dialogue_and_locked_ops_then_applies_only_selected(self):
        panel, _ = self.install("script-review")
        self.ctx.store.update_episode(
            self.episode.id, lambda ep: setattr(ep.panel("p03"), "locked", True)
        )
        before = self.ctx.store.get_episode(self.episode.id)

        def revise(story):
            story["panels"][0]["description"] = "Rejected description"
            story["panels"][1]["dialogue"][0]["text"] = "Short line."
            story["panels"][2]["description"] = "Locked suggestion"
            return story

        FakeLLM.edit = revise
        proposal = self.proposal(panel)
        self.assertEqual(self.ctx.store.get_episode(self.episode.id), before)
        self.assertEqual(proposal["base_revision"], before.revision)
        dialogue = next(op for op in proposal["ops"] if op["target"] == "p02")
        blocked = next(op for op in proposal["ops"] if op["target"] == "p03")
        self.assertTrue(blocked["blocked"])
        self.assertEqual(dialogue["changes"]["dialogue"][1][0]["text"], "Short line.")
        result = self.reply(
            self.bridge(
                panel,
                "apply",
                body={
                    "ops": proposal["ops"],
                    "accepted": [dialogue["id"], blocked["id"]],
                    "base_revision": proposal["base_revision"],
                },
            )
        )
        self.assertEqual(result["applied"], [dialogue["id"]])
        after = self.ctx.store.get_episode(self.episode.id)
        self.assertEqual(after.panel("p02").dialogues[0].text, "Short line.")
        self.assertEqual(after.panel("p01").description, before.panel("p01").description)
        self.assertEqual(after.panel("p03").description, before.panel("p03").description)
        self.assertEqual(after.takes, before.takes)

    def test_stale_script_proposal_returns_409_without_partial_bible_updates(self):
        panel, _ = self.install("script-review")

        def revise(story):
            story["characters"][0]["tags"].append("silver scarf")
            story["panels"][0]["description"] = "Stale panel suggestion"
            return story

        FakeLLM.edit = revise
        proposal = self.proposal(panel)
        self.ctx.store.update_episode(
            self.episode.id, lambda ep: setattr(ep, "title", "Newer edit")
        )
        series_before = self.ctx.store.get_series(self.series.id)
        episode_before = self.ctx.store.get_episode(self.episode.id)
        self.reply(
            self.bridge(
                panel,
                "apply",
                body={
                    "ops": proposal["ops"],
                    "accepted": [op["id"] for op in proposal["ops"]],
                    "base_revision": proposal["base_revision"],
                },
            ),
            409,
        )
        self.assertEqual(self.ctx.store.get_episode(self.episode.id), episode_before)
        self.assertEqual(self.ctx.store.get_series(self.series.id), series_before)

    def test_v2_script_propose_and_apply_keep_their_distinct_scopes(self):
        panel, _ = self.install("script-review")
        read = self.token(["read"])
        render = self.token(["read", "render"])
        write = self.token(["read", "write"])
        with patch.object(FakeLLM, "chat_json", wraps=FakeLLM().chat_json) as model:
            self.reply(
                self.bridge(panel, "propose", body={"instruction": "No changes"}, headers=read), 403
            )
            model.assert_not_called()
            proposal = self.reply(
                self.bridge(panel, "propose", body={"instruction": "No changes"}, headers=render)
            )
        body = {"ops": proposal["ops"], "accepted": [], "base_revision": proposal["base_revision"]}
        self.reply(self.bridge(panel, "apply", body=body, headers=render), 403)
        self.reply(self.bridge(panel, "apply", body=copy.deepcopy(body), headers=write))
