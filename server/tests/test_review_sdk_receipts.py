"""Review regressions exercise real SDK requests against an isolated FastAPI workspace."""

from __future__ import annotations

import io
import json
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from mio_server.album_interchange import ImportedAlbumBook, ImportedAlbumFrame
from mio_server.models import Dialogue, Episode, Panel, PanelOverrides, Strip

from . import test_sdk_automation as automation_tests
from .api_harness import ApiCase

STORY = "# Neutral\nA quiet moment.\n\n## First\na red chair\n> Hello.\n"


class SDKReceiptReviewTests(ApiCase):
    @classmethod
    def setUpClass(cls):
        cls.sdk = automation_tests.fresh_client()
        cls.automation = automation_tests.load_example("markdown_album", cls.sdk)

    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "empty"
        token = self.ok(
            self.client.post(
                "/api/tokens", json={"name": "receipt test", "scopes": ["read", "write", "render"]}
            ),
            201,
        )["token"]
        self.mio = self.sdk.MioClient("http://127.0.0.1", token=token)
        self.requests = []
        transport = patch.object(self.sdk.urllib.request, "urlopen", side_effect=self.request)
        transport.start()
        self.addCleanup(transport.stop)

    request = automation_tests.SDKMarkdownAutomationTests.request

    def run_album(self, destination, *, key="receipt-review", **options):
        return self.automation.run_album(
            self.mio,
            STORY,
            destination,
            source={"workflow_id": "builtin_t2i_sdxl"},
            idempotency_key=key,
            adopt_first=True,
            timeout=15,
            poll=0.01,
            **options,
        )

    def test_155_156_and_180_character_keys_finish_and_resume_without_new_jobs(self):
        for length in (155, 156, 180):
            with self.subTest(length=length):
                destination = Path(self.tmp) / f"key-{length}"
                receipt = self.run_album(destination, key="k" * length)
                self.assertEqual(receipt["status"], "completed")
                self.assertTrue((destination / "album.html").is_file())
                self.assertTrue((destination / "album.pdf").read_bytes().startswith(b"%PDF-"))
                before = len(self.ctx.engine.list())
                self.assertEqual(self.run_album(destination, key="k" * length), receipt)
                self.assertEqual(len(self.ctx.engine.list()), before)

    def test_pending_binding_rejects_extra_generation_settings_without_post_or_private_output(self):
        story_path = Path(self.tmp) / "story.md"
        story_path.write_text(STORY, encoding="utf-8")
        for field, value in (
            ("raw_negative", "PRIVATE hidden negative"),
            ("seed", 314159),
            ("profile_id", "PRIVATE different profile"),
            ("node_overrides", {"/6/inputs/text": "PRIVATE hidden prompt"}),
        ):
            destination = Path(self.tmp) / f"pending-extra-{field}"
            with patch.object(self.mio, "create_storyboard", side_effect=OSError("lost response")):
                with self.assertRaises(self.automation.CreationPendingError):
                    self.run_album(destination)
            path = destination / "mio-automation.json"
            pending = path.read_bytes()
            board = self.automation.parse_markdown(STORY)
            board["panels"][0]["overrides"][field] = value
            identifier = self.mio.create_storyboard(board)["id"]
            with (
                self.subTest(field=field),
                patch.dict("os.environ", {"MIO_TOKEN": self.mio.token}),
                patch.object(self.automation, "MioClient", return_value=self.mio),
                redirect_stdout(io.StringIO()) as output,
            ):
                before = len(self.requests)
                code = self.automation.main(
                    [
                        str(story_path),
                        "--out",
                        str(destination),
                        "--workflow",
                        "builtin_t2i_sdxl",
                        "--idempotency-key",
                        "receipt-review",
                        "--adopt-first",
                        "--bind-storyboard",
                        identifier,
                    ]
                )
                self.assertEqual(code, 1)
                self.assertEqual(json.loads(output.getvalue())["status"], "stopped")
                self.assertEqual(
                    self.requests[before:],
                    [("GET", f"/api/v2/workshop/storyboards/{identifier}")],
                )
                self.assertEqual(path.read_bytes(), pending)
                self.assertFalse(self.ctx.engine.list())
                for private in ("PRIVATE", STORY, "a red chair", self.mio.token):
                    self.assertNotIn(private, output.getvalue())

    def test_service_defaults_and_metadata_allow_correct_binding_and_idempotent_resume(self):
        destination = Path(self.tmp) / "correct-binding"
        with patch.object(self.mio, "create_storyboard", side_effect=OSError("lost response")):
            with self.assertRaises(self.automation.CreationPendingError):
                self.run_album(destination)
        expected = self.automation.parse_markdown(STORY)
        actual = self.mio.create_storyboard(expected)
        self.assertIs(actual["strip"]["rasterized"], False)
        self.assertTrue(self.automation.matches_submission(expected, actual))
        self.assertEqual(actual["panels"][0]["overrides"]["node_overrides"], {})
        self.assertEqual(actual["panels"][0]["dialogues"][0]["speaker_id"], None)
        actual["revision"] += 1
        actual["updated_at"] = "2099-01-01T00:00:00Z"
        self.assertTrue(self.automation.matches_submission(expected, actual))
        receipt = self.run_album(destination, bind_storyboard=actual["id"])
        self.assertEqual(receipt["status"], "completed")
        jobs = len(self.ctx.engine.list())
        self.assertEqual(self.run_album(destination), receipt)
        self.assertEqual(len(self.ctx.engine.list()), jobs)

    def test_mirrored_defaults_equal_real_service_models_before_api_binding(self):
        for kind, model, minimal in (
            (
                "episode",
                Episode(series_id="workshop", title="Neutral", order=0),
                {"title": "Neutral"},
            ),
            ("panel", Panel(order=0), {"order": 0}),
            ("dialogue", Dialogue(text="Hello."), {"text": "Hello."}),
            ("overrides", PanelOverrides(), {}),
            ("strip", Strip(), {}),
        ):
            with self.subTest(model=kind):
                self.assertEqual(
                    self.automation.submission_content(minimal, kind),
                    self.automation.submission_content(model.model_dump(mode="json"), kind),
                )

    def test_nonempty_album_sources_remain_part_of_full_submission_comparison(self):
        board = self.automation.parse_markdown(STORY)
        actual = self.mio.create_storyboard(board)
        for path, source, field in (
            (
                (),
                ImportedAlbumBook(
                    title="Original album",
                    synopsis="A quiet moment.",
                    character_name="",
                    story_title="Neutral",
                    mapped_series_title="Original album",
                    mapped_episode_title="Neutral",
                    mapped_synopsis="A quiet moment.",
                ).model_dump(mode="json"),
                "title",
            ),
            (
                ("panels", 0),
                ImportedAlbumFrame(
                    name="First",
                    prompt="a red chair",
                    mapped_description="First",
                    mapped_caption="Hello.",
                    mapped_prompt="a red chair",
                ).model_dump(mode="json"),
                "prompt",
            ),
        ):
            with self.subTest(path=path):
                sourced = json.loads(json.dumps(actual))
                target = sourced
                for key in path:
                    target = target[key]
                target["album_source"] = source
                self.assertFalse(self.automation.matches_submission(board, sourced))
                expected = json.loads(json.dumps(board))
                expected_target = expected
                for key in path:
                    expected_target = expected_target[key]
                expected_target["album_source"] = dict(source)
                self.assertTrue(self.automation.matches_submission(expected, sourced))
                target["album_source"][field] = "Different source content"
                self.assertFalse(self.automation.matches_submission(expected, sourced))

    def test_pending_binding_rejects_changed_canvas_without_post_or_private_output(self):
        destination = Path(self.tmp) / "pending-canvas"
        with patch.object(self.mio, "create_storyboard", side_effect=OSError("lost response")):
            with self.assertRaises(self.automation.CreationPendingError):
                self.run_album(destination)
        path = destination / "mio-automation.json"
        pending = path.read_bytes()
        story_path = Path(self.tmp) / "canvas-story.md"
        story_path.write_text(STORY, encoding="utf-8")
        identifier = self.mio.create_storyboard(self.automation.parse_markdown(STORY))["id"]
        for changes in ({"rasterized": True}, {"background": "#000000"}):
            episode = self.ctx.store.get_episode(identifier)
            episode.strip = Strip(**changes)
            self.ctx.store.save_episode(episode, expected_revision=episode.revision)
            with (
                self.subTest(changes=changes),
                patch.dict("os.environ", {"MIO_TOKEN": self.mio.token}),
                patch.object(self.automation, "MioClient", return_value=self.mio),
                redirect_stdout(io.StringIO()) as output,
            ):
                before = len(self.requests)
                code = self.automation.main(
                    [
                        str(story_path),
                        "--out",
                        str(destination),
                        "--workflow",
                        "builtin_t2i_sdxl",
                        "--idempotency-key",
                        "receipt-review",
                        "--adopt-first",
                        "--bind-storyboard",
                        identifier,
                    ]
                )
                self.assertEqual(code, 1)
                self.assertEqual(json.loads(output.getvalue())["status"], "stopped")
                self.assertEqual(
                    self.requests[before:], [("GET", f"/api/v2/workshop/storyboards/{identifier}")]
                )
                self.assertEqual(path.read_bytes(), pending)
                self.assertFalse(self.ctx.engine.list())
                for private in (STORY, "a red chair", self.mio.token):
                    self.assertNotIn(private, output.getvalue())

    def test_full_semantic_comparison_preserves_all_business_fields_and_unknowns(self):
        expected = self.automation.parse_markdown(STORY)
        actual = self.mio.create_storyboard(expected)
        changes = (
            (("base_prompt",), "different template"),
            (("deleted_at",), "2099-01-01T00:00:00Z"),
            (("takes",), [{"id": "unrelated take"}]),
            (("strip", "background"), "#000000"),
            (("strip", "rasterized"), True),
            (("panels", 0, "characters"), [{"character_id": "other"}]),
            (("panels", 0, "reference_mode"), "off"),
            (("panels", 0, "controls"), [{"kind": "depth"}]),
            (("panels", 0, "regional"), True),
            (("panels", 0, "locked"), True),
            (("panels", 0, "dialogues", 0, "speaker_id"), "other"),
            (("panels", 0, "dialogues", 0, "bridge"), True),
            (("panels", 0, "overrides", "append_prompt"), "different prompt"),
            (("panels", 0, "overrides", "negative_prompt"), "different negative"),
            (("panels", 0, "overrides", "width"), 512),
            (("panels", 0, "overrides", "height"), 512),
            (("panels", 0, "overrides", "values"), {"seed": 42}),
            (("panels", 0, "overrides", "slot_overrides"), {"loras": []}),
        )
        for path, value in changes:
            changed = json.loads(json.dumps(actual))
            target = changed
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.subTest(path=path):
                self.assertFalse(self.automation.matches_submission(expected, changed))
        for path in (
            (),
            ("panels", 0),
            ("panels", 0, "overrides"),
            ("panels", 0, "dialogues", 0),
            ("strip",),
        ):
            changed = json.loads(json.dumps(actual))
            target = changed
            for key in path:
                target = target[key]
            target["future_setting"] = None
            with self.subTest(unknown_at=path):
                self.assertFalse(self.automation.matches_submission(expected, changed))

    def test_stage_keys_are_bounded_deterministic_and_use_full_intent_and_stage(self):
        fingerprints = []
        keys = []
        for suffix in ("a", "b"):
            destination = Path(self.tmp) / f"bounded-{suffix}"
            with patch.object(self.mio, "generate_workshop_task", side_effect=OSError("pause")):
                with self.assertRaises(OSError):
                    self.run_album(destination, key="k" * 179 + suffix)
            receipt = json.loads((destination / "mio-automation.json").read_text(encoding="utf-8"))
            fingerprints.append(receipt["fingerprint"])
            for stage in ("generation", "html", "pdf"):
                key = self.automation.stage_key(receipt, "k" * 179 + suffix, stage)
                self.assertLessEqual(len(key), 160)
                self.assertEqual(key, self.automation.stage_key(receipt, "k" * 179 + suffix, stage))
                keys.append(key)
        self.assertNotEqual(*fingerprints)
        self.assertEqual(len(set(keys)), 6)

    def test_v1_receipts_keep_submitted_keys_and_repair_only_rejected_export_keys(self):
        for length in (155, 156, 180):
            with self.subTest(length=length):
                key = "v" * length
                destination = Path(self.tmp) / f"legacy-{length}"
                with patch.object(self.mio, "generate_workshop_task", side_effect=OSError("pause")):
                    with self.assertRaises(OSError):
                        self.run_album(destination, key=key)
                path = destination / "mio-automation.json"
                receipt = json.loads(path.read_text(encoding="utf-8"))
                receipt["version"] = 1
                self.automation.save_receipt(path, receipt)
                # A v1 process submitted generation but stopped before it could persist task IDs.
                task = self.mio.generate_workshop_task(
                    {
                        "storyboard_id": receipt["storyboard_id"],
                        "workflow_id": "builtin_t2i_sdxl",
                        "title": "Neutral",
                        "preset_ids": [],
                        "generation": {"candidates": 1},
                        "adopt_first": True,
                    },
                    idempotency_key=key,
                    timeout=15,
                    poll=0.01,
                )
                submitted = []
                # Existing valid export submissions also survive lost responses without a new job.
                for extension in ("html", "pdf"):
                    if len(key + "." + extension) <= 160:
                        export = self.mio.export_episode_deliverable(
                            task["episode"]["id"],
                            {
                                "format": extension,
                                "template_id": "export-monograph" if extension == "html" else None,
                                "idempotency_key": key + "." + extension,
                            },
                        )
                        submitted.append(export["job_id"])
                before = len(self.ctx.engine.list())
                with (
                    patch.object(
                        self.mio, "create_storyboard", wraps=self.mio.create_storyboard
                    ) as create,
                    patch.object(
                        self.mio, "generate_workshop_task", wraps=self.mio.generate_workshop_task
                    ) as generate,
                    patch.object(
                        self.mio,
                        "save_episode_deliverable",
                        wraps=self.mio.save_episode_deliverable,
                    ) as save,
                ):
                    recovered = self.run_album(destination, key=key)
                create.assert_not_called()
                self.assertEqual(generate.call_args.kwargs["idempotency_key"], key)
                self.assertEqual(recovered["job_id"], task["job_id"])
                self.assertEqual(recovered["version"], 1)
                self.assertEqual(recovered["status"], "completed")
                self.assertEqual(len(self.ctx.engine.list()), before + 2 - len(submitted))
                for call in save.call_args_list:
                    extension = call.kwargs["format"]
                    export_key = call.kwargs["idempotency_key"]
                    self.assertLessEqual(len(export_key), 160)
                    if len(key + "." + extension) <= 160:
                        self.assertEqual(export_key, key + "." + extension)
                before = len(self.ctx.engine.list())
                self.assertEqual(self.run_album(destination, key=key), recovered)
                self.assertEqual(len(self.ctx.engine.list()), before)
