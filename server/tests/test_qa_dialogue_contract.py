"""Dialogue QA contracts across voting, persisted evidence and real job execution."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from mio_server.assets import AssetStore
from mio_server.jobs import JobEngine
from mio_server.models import Dialogue, QAResult, Series, Take, TakeStatus
from mio_server.pipeline import qa as Q
from mio_server.pipeline import story as ST
from mio_server.storage import SQLiteStore

from .story_fixture import make_story
from .test_compile_executor import png
from .test_jobs import drain


def vote(score=None, note="Cannot determine the dialogue fit.", **changes):
    result = {
        "verdicts": [],
        "extra_people": 0,
        "scene": 5,
        "quality": 5,
        "dialogue_status": "assessed" if score is not None else "unknown",
        "dialogue_score": score,
        "dialogue_note": note,
    }
    return {**result, **changes}


class DialogueVoteContractTests(unittest.TestCase):
    def setUp(self):
        self.story = make_story(2)
        self.panel = self.story["panels"][0]

    def test_strict_majority_uses_lower_median_and_its_actual_explanation(self):
        cases = [
            ([vote(5, "high"), vote(2, "low"), vote(4, "middle"), vote()], 4, "middle", 3),
            (
                [vote(5, "high"), vote(2, "low"), vote(4, "upper"), vote(3, "lower"), vote()],
                3,
                "lower",
                4,
            ),
        ]
        for runs, expected_score, expected_note, valid_votes in cases:
            with self.subTest(scores=[r["dialogue_score"] for r in runs]):
                qa = Q.aggregate(self.story, self.panel, runs, model="contract-vlm")
                self.assertEqual(qa.dialogue_status, "assessed")
                self.assertEqual(qa.dialogue_score, expected_score)
                self.assertEqual(qa.dialogue_note, expected_note)
                self.assertEqual((qa.dialogue_votes, qa.votes), (valid_votes, len(runs)))
                self.assertAlmostEqual(qa.score, 0.8 + expected_score / 5 * 0.2)
                self.assertTrue(qa.passed)
                self.assertEqual(qa.model, "contract-vlm")

    def test_refusals_ties_and_forged_scores_cannot_supply_a_majority(self):
        cases = [
            ([vote(5, "fits"), vote()], 1),
            ([vote(5, "fits"), vote(), vote()], 1),
            (
                [vote(5, "fits"), vote(True), vote("5"), vote(5.0), vote(4, "  ")],
                1,
            ),
            ([vote(), vote(), vote()], 0),
            ([], 0),
        ]
        for runs, valid_votes in cases:
            with self.subTest(scores=[r["dialogue_score"] for r in runs]):
                qa = Q.aggregate(self.story, self.panel, runs)
                self.assertEqual(qa.dialogue_status, "unknown")
                self.assertIsNone(qa.dialogue_score)
                self.assertEqual((qa.dialogue_votes, qa.votes), (valid_votes, len(runs)))
                self.assertFalse(qa.passed)
                self.assertLessEqual(qa.score, 0.8)
                self.assertTrue(qa.dialogue_note.strip())
                self.assertTrue(any(qa.dialogue_note in issue for issue in qa.issues))

    def test_dialogue_pass_floor_is_independent_of_the_total_score(self):
        for score in range(1, 6):
            with self.subTest(score=score):
                qa = Q.aggregate(self.story, self.panel, [vote(score, "visual evidence")])
                self.assertGreater(qa.score, Q.PASS_SCORE)
                self.assertEqual(qa.passed, score >= 3)
                self.assertEqual(qa.dialogue_status, "assessed")
                self.assertEqual(qa.dialogue_votes, 1)

    def test_good_dialogue_does_not_erase_identity_cast_or_scene_failures(self):
        self.panel["characters"] = [{"id": "lin"}]
        good_identity = {
            "character": "lin",
            "present": True,
            "identity": 5,
            "features_wrong": [],
        }
        failures = [
            {"verdicts": [{**good_identity, "identity": 2}]},
            {"verdicts": [good_identity], "extra_people": 1},
            {"verdicts": [good_identity], "scene": 2},
        ]
        for changes in failures:
            with self.subTest(changes=changes):
                qa = Q.aggregate(self.story, self.panel, [vote(5, "dialogue fits", **changes)])
                self.assertEqual(qa.dialogue_score, 5)
                self.assertGreater(qa.score, Q.PASS_SCORE)
                self.assertFalse(qa.passed)

    def test_absent_or_blank_dialogue_keeps_existing_score_and_verdict(self):
        identity = {
            "character": "lin",
            "present": True,
            "identity": 4,
            "features_wrong": [],
        }
        for lines in (None, [], [{"speaker": "lin", "kind": "speech", "text": " \n "}]):
            for identity_score, expected_score, expected_pass in ((4, 0.8, True), (2, 0.56, False)):
                with self.subTest(lines=lines, identity=identity_score):
                    panel = {"id": "p", "characters": [{"id": "lin"}]}
                    if lines is not None:
                        panel["dialogue"] = lines
                    run = vote(
                        1,
                        "Must be ignored because no actual lines exist.",
                        scene=4,
                        quality=4,
                        verdicts=[{**identity, "identity": identity_score}],
                    )
                    qa = Q.aggregate(self.story, panel, [run])
                    self.assertEqual((qa.score, qa.passed), (expected_score, expected_pass))
                    self.assertEqual(qa.dialogue_status, "not_assessed")
                    self.assertIsNone(qa.dialogue_score)
                    self.assertEqual((qa.dialogue_note, qa.dialogue_votes), ("", 0))


class DialogueEvidenceModelTests(unittest.TestCase):
    def test_legacy_qa_loads_as_unknown_without_fabricating_evidence(self):
        legacy = {
            "passed": True,
            "score": 0.84,
            "identity": [{"character_id": "lin", "score": 4, "missing": []}],
            "issues": ["existing review note"],
            "votes": 3,
            "model": "previous-vlm",
            "checked_at": "2026-11-20T09:00:00+00:00",
        }
        qa = QAResult.model_validate(legacy)
        self.assertEqual(qa.dialogue_status, "unknown")
        self.assertIsNone(qa.dialogue_score)
        self.assertEqual((qa.dialogue_note, qa.dialogue_votes), ("", 0))
        saved = json.loads(qa.model_dump_json())
        self.assertEqual({key: saved[key] for key in legacy}, legacy)
        self.assertEqual(QAResult.model_validate_json(qa.model_dump_json()), qa)

    def test_persisted_dialogue_scores_are_strict_and_round_trip(self):
        payload = {
            "passed": True,
            "score": 0.96,
            "dialogue_score": 4,
            "dialogue_note": "表情与告别的台词相符。",
            "dialogue_status": "assessed",
            "dialogue_votes": 3,
            "votes": 4,
        }
        qa = QAResult.model_validate_json(json.dumps(payload, ensure_ascii=False))
        restored = QAResult.model_validate_json(qa.model_dump_json())
        self.assertEqual(restored, qa)
        self.assertIs(type(restored.dialogue_score), int)
        for invalid in (True, False, 4.0, "4", 0, 6):
            with self.subTest(score=invalid):
                with self.assertRaises(ValidationError):
                    QAResult.model_validate({**payload, "dialogue_score": invalid})
        with self.assertRaises(ValidationError):
            QAResult.model_validate({**payload, "dialogue_status": "passed"})
        with self.assertRaises(ValidationError):
            QAResult.model_validate({**payload, "dialogue_votes": -1})


class RecordingVLM:
    def __init__(self):
        self.responses = []
        self.calls = []

    def vision_json(self, text, images):
        self.calls.append((text, list(images)))
        if not self.responses:
            raise AssertionError("Unexpected VLM call")
        return self.responses.pop(0), SimpleNamespace(model="contract-vlm", seconds=0.01)


class DialogueQAJobContractTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.store = SQLiteStore(Path(tmp.name) / "db.sqlite3")
        self.addCleanup(self.store.close)
        self.assets = AssetStore(Path(tmp.name) / "assets", self.store)
        self.engine = JobEngine(":memory:", autostart=False, poll=0.01)
        self.addCleanup(self.engine.close)
        self.vlm = RecordingVLM()
        self.qa = Q.QAService(self.store, self.assets, self.engine, lambda: self.vlm)
        self.engine.register("qa.check", self.qa)
        series = Series(title="台词质检契约")
        series.bible, episode = ST.from_story(make_story(2), series.id)
        self.series = self.store.create_series(series)
        self.episode = self.store.create_episode(episode)
        self.image = png()

    def candidate(self, panel_id):
        asset = self.assets.put(self.image, source="synthetic-qa-contract")
        take = Take(panel_id=panel_id, asset_id=asset.id, width=64, height=96)
        self.store.update_episode(self.episode.id, lambda ep: ep.takes.append(take))
        return take

    def check(self, take, votes=1, auto_adopt=False):
        job = self.qa.submit(
            self.episode.id,
            take_ids=[take.id],
            votes=votes,
            faces=False,
            auto_adopt=auto_adopt,
        )
        done = drain(self.engine, job["id"])
        self.assertEqual(done["state"], "completed", done)
        return self.store.get_episode(self.episode.id).take(take.id)

    @staticmethod
    def response(score, note):
        return {
            "characters": [
                {"name": "Lin", "present": False, "identity": 1, "features": {"bob cut": False}}
            ],
            "extra_people": 0,
            "scene": 5,
            "quality": 5,
            "dialogue": {"score": score, "note": note},
        }

    def test_dialogue_without_anchors_still_calls_vlm_and_persists_its_evidence(self):
        cases = [
            ("p01", None, "narration", "夜深了，街边的灯还亮着。"),
            ("p02", "lin", "thought", '总算能回家了。\n"明天见！"'),
        ]
        for panel_id, speaker, kind, text in cases:
            with self.subTest(panel=panel_id):
                dialogue = Dialogue(speaker_id=speaker, kind=kind, text=text)
                self.store.update_episode(
                    self.episode.id,
                    lambda ep: setattr(ep.panel(panel_id), "dialogues", [dialogue]),
                )
                self.vlm.calls.clear()
                self.vlm.responses = [
                    self.response(4, "动作与台词相符。"),
                    self.response(5, "情绪与场景很明确。"),
                ]
                take = self.check(self.candidate(panel_id), votes=2)
                self.assertEqual(len(self.vlm.calls), 2)
                self.assertEqual(self.vlm.responses, [])
                expected = [{"speaker": speaker or "narrator", "kind": kind, "text": text}]
                for prompt, images in self.vlm.calls:
                    block = prompt.split("<dialogue_data>\n", 1)[1].split("\n</dialogue_data>", 1)[
                        0
                    ]
                    self.assertEqual(json.loads(block), expected)
                    self.assertEqual(images, [self.image])
                self.assertEqual(take.qa.identity, [])
                self.assertEqual(take.qa.dialogue_status, "assessed")
                self.assertEqual(take.qa.dialogue_score, 4)
                self.assertEqual(take.qa.dialogue_note, "动作与台词相符。")
                self.assertEqual((take.qa.dialogue_votes, take.qa.votes), (2, 2))
                self.assertTrue(take.qa.passed)
                self.assertEqual((take.qa.score, take.score), (0.96, 0.96))
                self.assertEqual(take.qa.model, "contract-vlm")

    def test_refused_unanchored_dialogue_is_incomplete_and_never_auto_adopted(self):
        refusal = "无法判断表情与这句台词是否一致。"
        self.vlm.responses = [self.response(None, refusal)]
        candidate = self.candidate("p02")
        take = self.check(candidate, auto_adopt=True)
        self.assertEqual(len(self.vlm.calls), 1)
        self.assertEqual(take.qa.dialogue_status, "unknown")
        self.assertIsNone(take.qa.dialogue_score)
        self.assertEqual((take.qa.dialogue_votes, take.qa.votes), (0, 1))
        self.assertIn(refusal, take.qa.dialogue_note)
        self.assertFalse(take.qa.passed)
        self.assertLess(take.qa.score, 1)
        self.assertEqual(take.status, TakeStatus.candidate)
        self.assertIsNone(self.store.get_episode(self.episode.id).adopted("p02"))

    def test_no_lines_or_anchors_still_assess_and_persist_visual_quality(self):
        cases = [
            (2, 2, 0.4, False, False),
            (4, 4, 0.8, True, True),
            (None, 4, 0.4, False, None),
            (4, None, 0.4, False, True),
            (0, 4, 0.4, False, None),
            (4, 6, 0.4, False, True),
            ("4", 4, 0.4, False, None),
            (4, True, 0.4, False, True),
        ]
        for panel_id in ("p01", "p02"):
            self.store.update_episode(
                self.episode.id, lambda ep: ep.panel(panel_id).dialogues.clear()
            )
            for scene, quality, score, passed, shot_ok in cases:
                with self.subTest(panel=panel_id, scene=scene, quality=quality):
                    self.vlm.calls.clear()
                    self.vlm.responses = [
                        {**self.response(None, ""), "scene": scene, "quality": quality}
                    ]
                    take = self.check(self.candidate(panel_id))
                    self.assertEqual(len(self.vlm.calls), 1)
                    self.assertEqual(self.vlm.responses, [])
                    self.assertEqual(self.vlm.calls[0][1], [self.image])
                    self.assertEqual(take.qa.identity, [])
                    self.assertEqual(take.qa.dialogue_status, "not_assessed")
                    self.assertEqual((take.qa.dialogue_score, take.qa.dialogue_votes), (None, 0))
                    self.assertEqual(take.qa.dialogue_note, "")
                    self.assertEqual(take.qa.votes, 1)
                    self.assertEqual(take.qa.model, "contract-vlm")
                    self.assertEqual((take.qa.score, take.score), (score, score))
                    self.assertEqual(take.qa.shot_ok, shot_ok)
                    self.assertEqual(take.qa.passed, passed)
                    if not passed:
                        self.assertTrue(take.qa.issues)
