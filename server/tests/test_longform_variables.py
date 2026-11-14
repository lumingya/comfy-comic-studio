from unittest.mock import patch

from pydantic import ValidationError

from mio_server.jobs import ItemSpec, JobConflict
from mio_server.longform import apply_variables, find_variables, preview_variables
from mio_server.longform.models import VariableApply, VariableOperation, VariableQuery
from mio_server.models import Preset, PresetBinding, PresetEntry, VariantSet
from mio_server.storage import Conflict

from .longform_fixture import LongformFixture


class LongformVariableTests(LongformFixture):
    def setUp(self):
        super().setUp()
        self.series.variables.update({"greeting": "Hi {hero}", "id": "{hero}"})
        self.series.presets = [
            Preset(
                title="Cast",
                entries=[PresetEntry(key="hero", value="{hero} {{hero}}")],
                bindings=[
                    PresetBinding(node_id="1", path="text", source="variable", value="hero"),
                    PresetBinding(node_id="2", path="text", source="literal", value="{hero}"),
                ],
            )
        ]
        self.series.variants = [
            VariantSet(
                name="Alternate",
                characters={
                    "character-id": {"description": "{hero}", "extension_data": {"text": "{hero}"}},
                },
            )
        ]
        self.store.save_series(self.series)
        panel = self.source.panel("a")
        panel.description = "{hero} {heron} {{hero}} { hero} {hero } {hero name} {角色}"
        panel.overrides.values = {
            "$hero": "Local {hero}",
            "refs": {"$asset": "{hero}", "text": "{hero}"},
        }
        panel.overrides.node_overrides = {"/1/inputs/text": ["{hero}", 0, {"text": "{{hero}}"}]}
        panel.overrides.raw_prompt = "{hero} {hero}"
        self.source.takes[0].parameter_snapshot = {"prompt": "{hero}"}
        self.source.strip.lettering[0].text = "{hero} speaks"
        self.store.save_episode(self.source)

    def command(self, action="rename", value="lead", **kwargs):
        return VariableOperation(key="hero", action=action, value=value, **kwargs)

    def apply(self, operation=None):
        command = operation or self.command()
        preview = preview_variables(self.ctx, self.series.id, command)
        return apply_variables(
            self.ctx,
            self.series.id,
            VariableApply(
                **command.model_dump(),
                expected_head=preview.head,
            ),
        )

    def test_find_and_preview_report_fields_without_writes_and_preserve_escapes(self):
        before = self.documents()
        search = find_variables(self.ctx, self.series.id, VariableQuery(key="hero"))
        fields = {hit.path: hit for hit in search.occurrences if hit.owner_id == "source"}
        self.assertEqual(fields["/panels/0/description"].count, 1)
        self.assertEqual(fields["/panels/0/overrides/raw_prompt"].count, 2)
        self.assertIn("/panels/0/overrides/node_overrides/~11~1inputs~1text/0", fields)
        self.assertNotIn("/takes/0/parameter_snapshot/prompt", fields)
        self.assertNotIn("/panels/0/overrides/values/refs/$asset", fields)
        self.assertIn("definition", {hit.kind for hit in search.occurrences})
        self.assertIn("binding", {hit.kind for hit in search.occurrences})
        preview = preview_variables(self.ctx, self.series.id, self.command())
        self.assertEqual(preview.conflicts, [])
        self.assertEqual(preview.head, search.head)
        description = next(c for c in preview.changes if c.path == "/panels/0/description")
        self.assertEqual(
            description.after, "{lead} {heron} {{hero}} { hero} {hero } {hero name} {角色}"
        )
        self.assertTrue(preview.fields)
        self.assertEqual(self.documents(), before)
        self.assertEqual(
            self.store.get_series(self.series.id).model_dump(), self.series.model_dump()
        )

    def test_rename_updates_definitions_bindings_and_all_current_references_atomically(self):
        result = self.apply()
        self.assertNotIn("hero", result.series.variables)
        self.assertEqual(result.series.variables["lead"], "Alice")
        self.assertEqual(result.series.variables["greeting"], "Hi {lead}")
        self.assertEqual(result.series.variables["id"], "{lead}")
        self.assertEqual(result.series.presets[0].entries[0].key, "lead")
        self.assertEqual(result.series.presets[0].entries[0].value, "{lead} {{hero}}")
        self.assertEqual(result.series.presets[0].bindings[0].value, "lead")
        self.assertEqual(result.series.presets[0].bindings[0].source, "variable")
        self.assertEqual(
            result.series.variants[0].characters["character-id"]["description"], "{lead}"
        )
        self.assertEqual(
            result.series.variants[0].characters["character-id"]["extension_data"]["text"], "{hero}"
        )
        panel = self.store.get_episode("source").panel("a")
        self.assertIn("$lead", panel.overrides.values)
        self.assertNotIn("$hero", panel.overrides.values)
        self.assertEqual(panel.overrides.values["$lead"], "Local {lead}")
        self.assertEqual(panel.overrides.values["refs"]["$asset"], "{hero}")
        self.assertEqual(
            self.store.get_episode("source").takes[0].parameter_snapshot["prompt"], "{hero}"
        )
        self.assertEqual(self.store.get_episode("source").revision, self.source.revision + 1)
        self.assertEqual(self.store.get_episode("target").revision, 0)
        self.assertEqual([ep.id for ep in result.episodes], ["source"])
        self.assertNotEqual(result.head, result.previous_head)
        self.assertEqual(len(self.ctx.engine.list()), 0)

    def test_replace_is_single_pass_literal_preserves_definitions_and_converts_bindings(self):
        result = self.apply(self.command(action="replace", value="New {hero} \\1"))
        self.assertEqual(result.series.variables["hero"], "Alice")
        self.assertEqual(result.series.presets[0].entries[0].key, "hero")
        self.assertEqual(result.series.presets[0].bindings[0].source, "literal")
        self.assertEqual(result.series.presets[0].bindings[0].value, "New {hero} \\1")
        panel = self.store.get_episode("source").panel("a")
        self.assertEqual(panel.overrides.raw_prompt, "New {hero} \\1 New {hero} \\1")
        self.assertIn("{{hero}}", panel.description)
        self.assertIn("$hero", panel.overrides.values)

    def test_chinese_keys_and_invalid_tokens_have_exact_boundary_rules(self):
        command = VariableOperation(key="角色", action="replace", value="主角")
        result = self.apply(command)
        self.assertIn("主角", result.episodes[0].panel("a").description)
        for key in ("", "has space", "{hero}", "x" * 65):
            with self.subTest(key=key), self.assertRaises(ValidationError):
                VariableQuery(key=key)
        with self.assertRaises(ValidationError):
            self.command(value="has space")

    def test_collisions_locks_and_invalid_dialogue_are_reviewable_and_block_apply(self):
        for command, phrase in [
            (self.command(value="greeting"), "already defined"),
            (self.command(value="character"), "built-in"),
            (self.command(value="style"), "built-in"),
            (self.command(action="replace", value=""), "invalid"),
        ]:
            preview = preview_variables(self.ctx, self.series.id, command)
            self.assertTrue(any(phrase in message for message in preview.conflicts))
            before = self.documents()
            with self.assertRaises(Conflict):
                apply_variables(
                    self.ctx,
                    self.series.id,
                    VariableApply(**command.model_dump(), expected_head=preview.head),
                )
            self.assertEqual(self.documents(), before)
        self.source.panel("a").locked = True
        self.store.save_episode(self.source)
        preview = preview_variables(self.ctx, self.series.id, self.command())
        self.assertTrue(any("locked" in issue for issue in preview.conflicts))
        self.assertTrue(any(change.locked for change in preview.changes))
        self.apply(self.command(include_locked=True))
        self.assertTrue(self.store.get_episode("source").panel("a").locked)

    def test_stale_series_or_episode_head_cannot_overwrite_concurrent_edits(self):
        command = self.command()
        preview = preview_variables(self.ctx, self.series.id, command)
        self.target.title = "Concurrent edit"
        self.store.save_episode(self.target)
        before = self.documents()
        with self.assertRaisesRegex(Conflict, "changed"):
            apply_variables(
                self.ctx,
                self.series.id,
                VariableApply(**command.model_dump(), expected_head=preview.head),
            )
        self.assertEqual(self.documents(), before)
        preview = preview_variables(self.ctx, self.series.id, command)
        self.series.subtitle = "Concurrent series edit"
        self.store.save_series(self.series)
        with self.assertRaises(Conflict):
            apply_variables(
                self.ctx,
                self.series.id,
                VariableApply(**command.model_dump(), expected_head=preview.head),
            )

    def test_variable_save_failure_rolls_back_series_episode_and_history(self):
        before_series, before_docs = self.series.model_dump(), self.documents()
        before_history = self.store.episode_snapshots("source")
        with patch.object(self.store, "save_episode", side_effect=RuntimeError("write failure")):
            with self.assertRaisesRegex(RuntimeError, "failure"):
                self.apply()
        self.assertEqual(self.store.get_series(self.series.id).model_dump(), before_series)
        self.assertEqual(self.documents(), before_docs)
        self.assertEqual(self.store.episode_snapshots("source"), before_history)

    def test_pending_delivery_or_series_owned_work_blocks_apply_without_blocking_preview(self):
        job = self.ctx.engine.submit("test", [ItemSpec(input={})], owner=self.series.id)
        preview = preview_variables(self.ctx, self.series.id, self.command())
        with self.assertRaises(JobConflict):
            self.apply()
        engine = self.ctx.engine
        with engine.lock, engine.db:
            engine.db.execute(
                "UPDATE job_items SET state = 'complete' WHERE job_id = ?", (job["id"],)
            )
            row = engine._item_row(job["id"], 0)
            engine._record_delivery(row, {"asset_id": "received-but-not-applied"})
        self.assertFalse(preview.conflicts)
        with self.assertRaises(JobConflict):
            self.apply()
        self.assertEqual(self.store.get_episode("source").revision, self.source.revision)
