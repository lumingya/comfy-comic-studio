"""Assembly preview parity, variable diagnostics and atomic idempotent snapshots."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

from mio_server import workshop as W
from mio_server.assembly import build_snapshot
from mio_server.models import Dialogue, Panel, PanelOverrides, Preset, PresetEntry
from mio_server.pipeline import compiler
from mio_server.pipeline import variables as V
from mio_server.render_models import RenderProfile
from mio_server.storage import Conflict, NotFound, SQLiteStore

from .api_harness import ApiCase


class AssemblyPreviewTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "empty-legacy"
        self.ws = W.ensure_workshop(self.ctx.store, self.ctx.legacy_root)
        self.ws.variables = {
            "hero": "workshop hero",
            "workshop_only": "from workshop",
            "nested": "{missing_nested}",
            "cycle_a": "{cycle_b}",
            "cycle_b": "{cycle_a}",
            "escaped": "{{not_a_variable}}",
            "chain0": "{chain1}",
            "chain1": "{chain2}",
            "chain2": "{chain3}",
            "chain3": "{chain4}",
            "chain4": "{chain5}",
            "chain5": "done",
        }
        self.ws.presets = [
            Preset(
                id="preset_first",
                title="First",
                entries=[
                    PresetEntry(key="hero", value="first"),
                    PresetEntry(key="empty", value=""),
                ],
            ),
            Preset(id="preset_last", title="Last", entries=[PresetEntry(key="hero", value="last")]),
        ]
        self.ctx.store.save_series(self.ws)
        self.board = self.ctx.store.list_episodes(self.ws.id)[0]
        self.board.base_prompt = "{unused_starter}"
        self.board.panels = [
            Panel(
                order=0,
                description="Original frame",
                overrides=PanelOverrides(
                    raw_prompt="{hero}, {workshop_only}, {shot}, {empty}, {missing}, {nested}, "
                    "{cycle_a}, {escaped}, {{literal}}, {chain0}",
                    raw_negative="{negative}",
                    append_prompt="{ignored_append}",
                    negative_prompt="{ignored_negative}",
                    values={"$hero": "panel hero"},
                ),
                dialogues=[Dialogue(text="{hero}、{empty}、{missing}与{{literal}}")],
            ),
            Panel(order=1, overrides=PanelOverrides(raw_prompt="{hero}, {empty}")),
        ]
        self.ctx.store.save_episode(self.board)
        self.body = {
            "storyboard_id": self.board.id,
            "preset_ids": [preset.id for preset in self.ws.presets],
            "title": "Assembled",
            "variables": {"hero": "request hero", "negative": "request negative", "empty": ""},
        }

    def inspect(self, **changes):
        return self.ok(
            self.client.post("/api/workshop/assemble/preview", json={**self.body, **changes})
        )

    def assemble(self, **changes):
        return self.ok(
            self.client.post("/api/workshop/assemble", json={**self.body, **changes}), 201
        )

    def test_preview_is_side_effect_free_and_matches_persisted_snapshot(self):
        before = list(self.ctx.store._conn.iterdump())
        factory = Mock(side_effect=AssertionError("preview contacted ComfyUI"))
        with patch.object(self.ctx, "comfy_client_factory", factory):
            first, second = self.inspect(), self.inspect()
        self.assertEqual(first, second)
        self.assertEqual(list(self.ctx.store._conn.iterdump()), before)
        self.assertEqual(self.ctx.engine.list(), [])
        factory.assert_not_called()
        saved = self.assemble()
        album = self.ctx.store.get_series(saved["series"]["id"])
        episode = self.ctx.store.get_episode(saved["episode"]["id"])
        self.assertEqual(album.variables["hero"], "request hero")
        for panel, preview in zip(episode.ordered_panels(), first["panels"]):
            profile = self.ctx.render.profile(panel.overrides.profile_id, album)
            prompt = compiler.preview(album, episode, panel, profile=profile)[profile.dialect]
            self.assertEqual(preview["positive"], prompt["positive"])
            self.assertEqual(preview["negative"], prompt["negative"])
            self.assertEqual(
                preview["dialogues"],
                [V.display(d.text, V.table(album, panel)) for d in panel.dialogues],
            )
        self.assertEqual(self.ctx.store.get_series(self.ws.id).variables, self.ws.variables)
        self.assertEqual(self.ctx.store.get_episode(self.board.id).panels, self.board.panels)

    def test_reports_precedence_locations_nested_missing_empty_and_cycles(self):
        report = self.inspect()
        first = report["panels"][0]
        rows = first["variables"]

        def find(key, field="overrides.raw_prompt"):
            return next(row for row in rows if row["key"] == key and row["field"] == field)

        self.assertEqual(find("hero")["source"], "panel")
        self.assertEqual(find("hero")["source_id"], self.board.panels[0].id)
        self.assertEqual(find("workshop_only")["source"], "workshop")
        self.assertEqual(find("shot")["source"], "builtin")
        self.assertEqual(find("empty")["source"], "request")
        self.assertEqual(find("empty")["status"], "empty")
        self.assertEqual(find("missing")["status"], "missing")
        self.assertIsNone(find("missing")["value"])
        self.assertEqual(find("missing_nested")["chain"], ["nested", "missing_nested"])
        cycle = next(row for row in rows if row["status"] == "cycle")
        self.assertEqual(cycle["chain"], ["cycle_a", "cycle_b", "cycle_a"])
        self.assertTrue(any(row["status"] == "depth_limit" for row in rows))
        self.assertEqual(find("negative", "overrides.raw_negative")["source"], "request")
        self.assertFalse(
            {"ignored_append", "ignored_negative", "unused_starter", "not_a_variable", "literal"}
            & {row["key"] for row in rows}
        )
        self.assertEqual(first["dialogues"], ["panel hero与{literal}"])
        self.assertEqual(report["panels"][1]["variables"][0]["source"], "request")
        # Diagnostics are informational, including missing/cycle and intentional empty values.
        self.assertEqual(self.assemble()["series"]["variables"]["empty"], "")

    def test_preset_order_and_empty_request_override_are_respected(self):
        normal = self.inspect(variables={})["panels"][1]
        self.assertEqual(normal["positive"], "last, ")
        self.assertEqual(normal["variables"][0]["source"], "preset")
        self.assertEqual(normal["variables"][0]["source_id"], "preset_last")
        self.assertEqual(normal["variables"][0]["source_title"], "Last")
        reversed_ = self.inspect(variables={}, preset_ids=["preset_last", "preset_first"])
        self.assertEqual(reversed_["panels"][1]["positive"], "first, ")
        blank = self.inspect(variables={"hero": ""})["panels"][1]
        self.assertEqual(blank["positive"], ", ")
        self.assertEqual(blank["variables"][0]["status"], "empty")

    def test_trace_values_use_the_actual_field_remaining_depth_budget(self):
        values = {"a": "{b}", "b": "{c}", "c": "{d}", "d": "{e}", "e": "{f}", "f": "DONE"}
        self.assertEqual(V.expand("{a}", values), "{f}")
        traced = V.trace("{a}", values)
        self.assertEqual([row["value"] for row in traced], ["{f}"] * 5)
        self.assertEqual(traced[-1]["status"], "depth_limit")
        self.assertEqual(traced[-1]["chain"], ["a", "b", "c", "d", "e"])
        self.assertEqual(V.trace("{b}", values)[0]["value"], "DONE")
        self.board.panels[0].overrides.raw_prompt = "{a}"
        self.ctx.store.save_episode(self.board)
        report = self.inspect(variables=values)["panels"][0]
        self.assertEqual(report["positive"], "{f}")
        root = next(row for row in report["variables"] if row["chain"] == ["a"])
        self.assertEqual(root["value"], report["positive"])
        self.assertEqual(V.expand("{a}", {"a": "{{escaped}}"}), "{escaped}")
        self.assertEqual(V.trace("{a}", {"a": "{{escaped}}"})[0]["value"], "{escaped}")

    def test_effective_panel_profile_and_nonraw_fields_match_compiler(self):
        profile = RenderProfile(
            name="Panel profile",
            dialect="natural",
            quality_tags=["panel quality"],
            negative_tags=["profile negative"],
            base_width=1216,
        )
        self.ctx.store.put_doc(profile)
        self.board.panels[0].overrides = PanelOverrides(
            profile_id=profile.id,
            append_prompt="{hero}",
            negative_prompt="{negative}",
            raw_negative="{unused_raw_negative}",
        )
        self.ctx.store.save_episode(self.board)
        report = self.inspect()["panels"][0]
        self.assertEqual(report["profile_id"], profile.id)
        self.assertEqual(report["dialect"], "natural")
        self.assertIn("request hero", report["positive"])
        self.assertEqual(report["negative"], "profile negative, request negative")
        keys = {row["key"] for row in report["variables"]}
        self.assertNotIn("unused_raw_negative", keys)
        saved = self.assemble()
        album = self.ctx.store.get_series(saved["series"]["id"])
        ep = self.ctx.store.get_episode(saved["episode"]["id"])
        actual = compiler.preview(album, ep, ep.panels[0], profile=profile)["natural"]
        self.assertEqual(report["positive"], actual["positive"])
        self.assertEqual(report["negative"], actual["negative"])

    def test_idempotency_returns_original_after_source_changes_and_detects_conflicts(self):
        saved = self.assemble(idempotency_key="request-one")
        self.ctx.store.delete_series(self.ws.id)
        with patch.object(W, "_assembly_snapshot", side_effect=AssertionError("read source")):
            self.assertEqual(self.assemble(idempotency_key="request-one"), saved)
        conflict = self.client.post(
            "/api/workshop/assemble",
            json={**self.body, "title": "Changed", "idempotency_key": "request-one"},
        )
        self.assertEqual(conflict.status_code, 409)
        self.ctx.store.delete_series(saved["series"]["id"])
        missing = self.client.post(
            "/api/workshop/assemble", json={**self.body, "idempotency_key": "request-one"}
        )
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(self.ctx.store.list_series(), [])

    def test_same_key_concurrent_calls_save_one_album_and_receipt(self):
        def run(_):
            return W.assemble(
                self.ctx.store,
                self.board.id,
                self.body["preset_ids"],
                "Concurrent",
                variables=self.body["variables"],
                idempotency_key="same-key",
            )

        with ThreadPoolExecutor(max_workers=6) as workers:
            results = list(workers.map(run, range(12)))
        self.assertEqual(len({series.id for series, _ in results}), 1)
        self.assertEqual(len({episode.id for _, episode in results}), 1)
        self.assertEqual(len([s for s in self.ctx.store.list_series() if s.kind == "album"]), 1)
        self.assertEqual(
            self.ctx.store._rows("SELECT COUNT(*) AS n FROM assembly_receipts")[0]["n"], 1
        )
        with self.assertRaises(Conflict):
            W.assemble(self.ctx.store, self.board.id, [], "Different", idempotency_key="same-key")

    def test_receipt_survives_store_reopen_and_source_deletion(self):
        saved = self.assemble(idempotency_key="persisted")
        self.ctx.store.delete_series(self.ws.id)
        reopened = SQLiteStore(self.ctx.store.path)
        try:
            series, episode = W.assemble(
                reopened,
                self.board.id,
                self.body["preset_ids"],
                self.body["title"],
                variables=self.body["variables"],
                idempotency_key="persisted",
            )
            self.assertEqual(series.id, saved["series"]["id"])
            self.assertEqual(episode.id, saved["episode"]["id"])
        finally:
            reopened.close()

    def test_atomic_rollback_when_episode_or_receipt_insert_fails(self):
        for table in ("episodes", "assembly_receipts"):
            with self.subTest(table=table):
                with self.ctx.store.tx() as db:
                    db.execute(
                        f"CREATE TRIGGER reject_assembly BEFORE INSERT ON {table} "
                        "BEGIN SELECT RAISE(ABORT, 'injected write failure'); END"
                    )
                with self.assertRaises(sqlite3.IntegrityError):
                    W.assemble(
                        self.ctx.store, self.board.id, [], "Atomic", idempotency_key="atomic"
                    )
                self.assertEqual([s for s in self.ctx.store.list_series() if s.kind == "album"], [])
                self.assertEqual(self.ctx.store._rows("SELECT * FROM assembly_receipts"), [])
                self.assertEqual(len(self.ctx.store.list_episodes(self.ws.id)), 1)
                with self.ctx.store.tx() as db:
                    db.execute("DROP TRIGGER reject_assembly")
        saved = self.assemble(idempotency_key="atomic")
        self.assertEqual(saved["series"]["kind"], "album")

    def test_snapshot_has_no_aliases_and_no_writes(self):
        before = list(self.ctx.store._conn.iterdump())
        snapshot = build_snapshot(
            self.ws, self.board, self.body["preset_ids"], "Snapshot", variables={"hero": "request"}
        )
        snapshot.series.presets[0].entries[0].value = "changed"
        snapshot.episode.panels[0].overrides.values["$hero"] = "changed"
        self.assertEqual(self.ws.presets[0].entries[0].value, "first")
        self.assertEqual(self.board.panels[0].overrides.values["$hero"], "panel hero")
        self.assertEqual(list(self.ctx.store._conn.iterdump()), before)

    def test_preview_requires_write_permission_and_has_typed_schema(self):
        for scope, expected in (("read", 403), ("write", 200)):
            token = self.ok(
                self.client.post("/api/tokens", json={"name": scope, "scopes": [scope]}), 201
            )["token"]
            response = self.client.post(
                "/api/v2/workshop/assemble/preview",
                json=self.body,
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(response.status_code, expected, response.text)
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        operation = schema["paths"]["/workshop/assemble/preview"]["post"]
        self.assertEqual(operation["operationId"], "preview_assembly")
        self.assertEqual(
            operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/AssemblyPreview",
        )

    def test_invalid_sources_or_profiles_do_not_create_partial_albums(self):
        for overrides in (
            {"storyboard_id": "missing"},
            {"preset_ids": ["missing"]},
            {"profile_id": "missing"},
        ):
            with self.subTest(overrides=overrides):
                response = self.client.post(
                    "/api/workshop/assemble/preview", json={**self.body, **overrides}
                )
                self.assertEqual(response.status_code, 404)
                response = self.client.post(
                    "/api/workshop/assemble", json={**self.body, **overrides}
                )
                self.assertEqual(response.status_code, 404)
        self.assertEqual([s for s in self.ctx.store.list_series() if s.kind == "album"], [])

    def test_missing_workshop_preview_does_not_seed_legacy_data(self):
        self.ctx.store.delete_series(self.ws.id)
        with self.assertRaises(NotFound):
            W.assembly_preview(self.ctx.store, self.board.id, [], "Missing")
        self.assertEqual(self.ctx.store.list_series(), [])
