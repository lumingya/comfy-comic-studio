"""Script review keeps concurrent Bible edits and accepts individual sentences."""

import copy
import unittest

from mio_server.models import Bible, Character, Dialogue, Episode, Location, Panel, Series
from mio_server.pipeline import assistant as A
from mio_server.pipeline.story import from_story
from mio_server.storage import Conflict, SQLiteStore

from .api_harness import ApiCase, FakeLLM
from .story_fixture import make_story


class ScriptReviewTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore(":memory:")
        self.addCleanup(self.store.close)
        self.series = self.store.create_series(
            Series(
                title="Neutral review",
                bible=Bible(
                    characters=[
                        Character(id="actor", name="Original", age=26, tag_description=["initial"])
                    ],
                    locations=[Location(id="room", name="Room", tags=["initial"])],
                ),
            )
        )
        self.episode = self.store.create_episode(
            Episode(
                series_id=self.series.id,
                title="Neutral episode",
                order=0,
                panels=[
                    Panel(
                        id="p1",
                        order=0,
                        location_id="room",
                        dialogues=[Dialogue(text="Old first."), Dialogue(text="Old second.")],
                    ),
                    Panel(id="p2", order=1),
                    Panel(id="p3", order=2),
                ],
            )
        )

    def proposal(self):
        return A.normalized_view(self.series, self.episode)

    def apply(self, ops, accepted=None):
        return A.apply(
            self.store,
            self.episode.id,
            ops,
            [op["id"] for op in ops] if accepted is None else accepted,
            self.episode.revision,
        )

    def test_name_only_proposal_preserves_independent_bible_tags(self):
        revised = self.proposal()
        revised["characters"][0]["name"] = "Proposed"
        ops = A.diff(self.series, self.episode, revised)
        self.assertEqual(ops[0]["changes"], {"name": ["Original", "Proposed"]})
        self.store.update_series(
            self.series.id,
            lambda series: setattr(series.bible.character("actor"), "tag_description", ["author"]),
        )
        self.apply(ops)
        character = self.store.get_series(self.series.id).bible.character("actor")
        self.assertEqual(character.name, "Proposed")
        self.assertEqual(character.tag_description, ["author"])

    def test_two_sentence_changes_can_be_accepted_independently(self):
        revised = self.proposal()
        lines = revised["panels"][0]["dialogue"]
        lines[0]["text"], lines[1]["text"] = "New first.", "New second."
        ops = A.diff(self.series, self.episode, revised)
        self.assertEqual(len(ops), 2)
        self.apply(ops, [ops[0]["id"]])
        lines = self.store.get_episode(self.episode.id).panel("p1").dialogues
        self.assertEqual([line.text for line in lines], ["New first.", "Old second."])

    def test_location_name_preserves_independent_description_and_tags(self):
        revised = self.proposal()
        revised["scenes"][0]["location"] = "Proposed room"
        ops = A.diff(self.series, self.episode, revised)

        def edit(series):
            location = series.bible.location("room")
            location.tags, location.description = ["author"], "Author description"

        self.store.update_series(self.series.id, edit)
        self.apply(ops)
        location = self.store.get_series(self.series.id).bible.location("room")
        self.assertEqual(location.name, "Proposed room")
        self.assertEqual(location.tags, ["author"])
        self.assertEqual(location.description, "Author description")

    def test_legacy_multifield_op_only_writes_its_diff(self):
        revised = self.proposal()
        revised["characters"][0].update(name="Proposed", description="New description")
        pieces = A.diff(self.series, self.episode, revised)
        legacy = copy.deepcopy(pieces[0])
        legacy["changes"] = {field: pair for op in pieces for field, pair in op["changes"].items()}
        self.store.update_series(
            self.series.id,
            lambda series: setattr(series.bible.character("actor"), "tag_description", ["author"]),
        )
        self.apply([legacy])
        character = self.store.get_series(self.series.id).bible.character("actor")
        self.assertEqual(character.name, "Proposed")
        self.assertEqual(character.description, "New description")
        self.assertEqual(character.tag_description, ["author"])

    def test_same_bible_field_conflict_preserves_all_documents_and_snapshots(self):
        revised = self.proposal()
        revised["characters"][0]["name"] = "Proposed"
        revised["scenes"][0]["location"] = "Proposed room"
        revised["panels"][0]["description"] = "Proposed panel"
        ops = A.diff(self.series, self.episode, revised)
        self.store.update_series(
            self.series.id,
            lambda series: setattr(series.bible.location("room"), "name", "Author room"),
        )
        before = self.store.get_series(self.series.id)
        snapshots = self.store.episode_snapshots(self.episode.id)
        with self.assertRaises(Conflict):
            self.apply(ops)
        self.assertEqual(self.store.get_series(self.series.id), before)
        self.assertEqual(self.store.get_episode(self.episode.id), self.episode)
        self.assertEqual(self.store.episode_snapshots(self.episode.id), snapshots)

    def test_character_and_panel_fields_and_sentences_are_independent(self):
        revised = self.proposal()
        revised["characters"][0].update(name="Proposed", tags=["rejected"])
        revised["panels"][0].update(description="Proposed panel", shot="wide")
        revised["panels"][0]["dialogue"][1]["text"] = "New second."
        ops = A.diff(self.series, self.episode, revised)
        self.assertEqual(ops, A.diff(self.series, self.episode, revised))
        self.assertEqual(len(ops), 5)
        accepted = [op["id"] for op in ops if set(op["changes"]) & {"name", "shot", "dialogue"}]
        self.apply(ops, accepted[::-1])
        character = self.store.get_series(self.series.id).bible.character("actor")
        panel = self.store.get_episode(self.episode.id).panel("p1")
        self.assertEqual((character.name, character.tag_description), ("Proposed", ["initial"]))
        self.assertEqual((panel.shot, panel.description), ("wide", ""))
        self.assertEqual([line.text for line in panel.dialogues], ["Old first.", "New second."])

    def test_sentence_insert_delete_replace_subset_uses_original_coordinates(self):
        self.episode.panels[0].dialogues = [
            Dialogue(text="Alpha."),
            Dialogue(text="Bravo."),
            Dialogue(text="Charlie."),
            Dialogue(text="Delta.", speaker_id="actor", kind="thought", bridge=True),
            Dialogue(text="Echo."),
        ]
        # Reset this isolated fixture without advancing its proposal revision.
        self.store.save_episode(self.episode)
        revised = self.proposal()
        lines = revised["panels"][0]["dialogue"]
        revised["panels"][0]["dialogue"] = [
            lines[1],
            lines[2],
            {**lines[3], "text": "Revised Delta."},
            lines[4],
            {"speaker": "narrator", "kind": "narration", "text": "Added one."},
            {"speaker": "narrator", "kind": "narration", "text": "Added two."},
        ]
        ops = A.diff(self.series, self.episode, revised)
        accepted = [op["id"] for op in ops if op.get("dialogue_order") != 4]
        self.apply(ops, accepted[::-1])
        lines = self.store.get_episode(self.episode.id).panel("p1").dialogues
        self.assertEqual(
            [line.text for line in lines],
            ["Bravo.", "Charlie.", "Revised Delta.", "Echo.", "Added two."],
        )
        self.assertEqual(
            (lines[2].speaker_id, lines[2].kind, lines[2].bridge), ("actor", "thought", True)
        )

    def test_legacy_whole_dialogue_op_preserves_unchanged_line_metadata(self):
        self.episode.panels[0].dialogues[1].bridge = True
        self.store.save_episode(self.episode)
        before = self.proposal()["panels"][0]
        after = copy.deepcopy(before)
        after["dialogue"][0]["text"] = "New first."
        legacy = {
            "id": "legacy",
            "op": "update_panel",
            "target": "p1",
            "after": after,
            "changes": {"dialogue": [before["dialogue"], after["dialogue"]]},
        }
        self.apply([legacy])
        lines = self.store.get_episode(self.episode.id).panel("p1").dialogues
        self.assertEqual([line.text for line in lines], ["New first.", "Old second."])
        self.assertTrue(lines[1].bridge)

    def test_multiple_added_panels_keep_order_when_anchor_or_other_addition_is_rejected(self):
        revised = self.proposal()
        p1, p2, p3 = revised["panels"]
        new1, new2 = ({**p1, "id": pid} for pid in ("new1", "new2"))
        revised["panels"] = [new1, new2, p1, p2, p3]
        ops = A.diff(self.series, self.episode, revised)
        self.apply(ops)
        self.assertEqual(
            [panel.id for panel in self.store.get_episode(self.episode.id).ordered_panels()],
            ["new1", "new2", "p1", "p2", "p3"],
        )

    def test_added_panel_uses_surviving_anchor_when_previous_addition_is_rejected(self):
        revised = self.proposal()
        p1, p2, p3 = revised["panels"]
        revised["panels"] = [p1, {**p1, "id": "new1"}, {**p1, "id": "new2"}, p2, p3]
        ops = A.diff(self.series, self.episode, revised)
        self.apply(ops, [op["id"] for op in ops if op["target"] == "new2"])
        self.assertEqual(
            [panel.id for panel in self.store.get_episode(self.episode.id).ordered_panels()],
            ["p1", "new2", "p2", "p3"],
        )

    def test_reorder_projects_onto_accepted_additions_and_retains_rejected_removal(self):
        revised = self.proposal()
        p1, _, p3 = revised["panels"]
        revised["panels"] = [p3, {**p1, "id": "new1"}, {**p1, "id": "new2"}, p1]
        ops = A.diff(self.series, self.episode, revised)
        accepted = [op["id"] for op in ops if op["op"] != "remove_panel" and op["target"] != "new1"]
        self.apply(ops, accepted[::-1])
        self.assertEqual(
            [panel.id for panel in self.store.get_episode(self.episode.id).ordered_panels()],
            ["p3", "p2", "new2", "p1"],
        )

    def test_locked_sentence_field_delete_and_reorder_are_not_applied(self):
        self.episode.panels[0].locked = True
        self.store.save_episode(self.episode)
        revised = self.proposal()
        revised["panels"][0]["description"] = "Locked description"
        revised["panels"][0]["dialogue"][0]["text"] = "Locked line."
        revised["panels"] = list(reversed(revised["panels"]))
        ops = A.diff(self.series, self.episode, revised)
        self.assertTrue(all(op["blocked"] for op in ops))
        revised["panels"] = [panel for panel in revised["panels"] if panel["id"] != "p1"]
        removal = A.diff(self.series, self.episode, revised)
        self.assertTrue(next(op for op in removal if op["op"] == "remove_panel")["blocked"])
        self.assertEqual(self.apply(ops)["applied"], [])
        panel = self.store.get_episode(self.episode.id).panel("p1")
        self.assertEqual(panel.description, "")
        self.assertEqual(panel.dialogues[0].text, "Old first.")
        self.assertEqual(panel.order, 0)

    def test_malformed_or_unknown_ops_fail_closed(self):
        revised = self.proposal()
        revised["characters"][0]["name"] = "Proposed"
        good = A.diff(self.series, self.episode, revised)[0]
        invalids = [
            {"id": "bad", "op": "unknown", "target": "p1"},
            {**good, "id": "bad", "changes": {"unknown": ["Original", "Proposed"]}},
            {**good, "id": "bad", "changes": {"name": ["Original"]}},
            {**good, "id": "bad"},  # duplicates the accepted field
            {**good, "id": "bad", "changes": {"name": ["Original", "Original"]}},
        ]
        for invalid in invalids:
            with self.subTest(invalid=invalid), self.assertRaises(A.AssistantError):
                self.apply([good, invalid])
            self.assertEqual(self.store.get_series(self.series.id), self.series)
            self.assertEqual(self.store.get_episode(self.episode.id), self.episode)
        with self.assertRaises(A.AssistantError):
            self.apply([good], ["unknown"])

    def test_malformed_sentence_rolls_back_preceding_bible_edit(self):
        revised = self.proposal()
        revised["characters"][0]["name"] = "Proposed"
        revised["panels"][0]["dialogue"][1]["text"] = "New second."
        ops = A.diff(self.series, self.episode, revised)
        sentence = ops[1]
        for changes in (None, {"dialogue": [[], []]}, {"dialogue": [[], ["bad"]]}):
            with self.subTest(changes=changes):
                invalid = copy.deepcopy(sentence)
                invalid["changes"] = changes
                with self.assertRaises(A.AssistantError):
                    self.apply([ops[0], invalid])
                self.assertEqual(self.store.get_series(self.series.id), self.series)
                self.assertEqual(self.store.get_episode(self.episode.id), self.episode)


class ScriptReviewApiTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.series = Series(title="Offline review")
        bible, episode = from_story(make_story(3), self.series.id)
        self.series.bible = bible
        self.ctx.store.create_series(self.series)
        self.episode = self.ctx.store.create_episode(episode)

    def test_api_proposal_and_subset_apply_expose_independent_sentences(self):
        def edit(story):
            story["panels"][1]["dialogue"] = [
                {"speaker": "lin", "kind": "speech", "text": "First replacement."},
                {"speaker": "zhou", "kind": "thought", "text": "Second replacement."},
            ]
            return story

        FakeLLM.edit = edit
        endpoint = f"/api/episodes/{self.episode.id}/assistant"
        proposal = self.ok(self.client.post(endpoint + "/propose", json={"instruction": "Revise"}))
        ops = proposal["ops"]
        self.assertEqual(len(ops), 2)
        result = self.ok(
            self.client.post(
                endpoint + "/apply",
                json={
                    "ops": ops,
                    "accepted": [ops[1]["id"]],
                    "base_revision": proposal["base_revision"],
                },
            )
        )
        self.assertEqual(result["applied"], [ops[1]["id"]])
        saved = self.ctx.store.get_episode(self.episode.id).panel("p02")
        self.assertEqual(saved.dialogues[0], self.episode.panel("p02").dialogues[0])
        self.assertEqual(saved.dialogues[1].text, "Second replacement.")

    def test_api_bible_same_field_conflict_returns_409_without_partial_updates(self):
        revised = A.normalized_view(self.series, self.episode)
        revised["characters"][0]["name"] = "Proposed"
        revised["panels"][0]["description"] = "Proposed panel"
        ops = A.diff(self.series, self.episode, revised)
        self.ctx.store.update_series(
            self.series.id, lambda series: setattr(series.bible.characters[0], "name", "Author")
        )
        series = self.ctx.store.get_series(self.series.id)
        self.ok(
            self.client.post(
                f"/api/episodes/{self.episode.id}/assistant/apply",
                json={
                    "ops": ops,
                    "accepted": [op["id"] for op in ops],
                    "base_revision": self.episode.revision,
                },
            ),
            409,
        )
        self.assertEqual(self.ctx.store.get_series(self.series.id), series)
        self.assertEqual(self.ctx.store.get_episode(self.episode.id), self.episode)
