"""Four independent native variant axes reach the existing prompt and workflow compiler."""

import itertools
import math
import unittest

from pydantic import ValidationError

from mio_server.assembly import build_snapshot
from mio_server.models import (
    Bible,
    Character,
    Episode,
    Location,
    Panel,
    PanelCharacter,
    PanelOverrides,
    Preset,
    PresetBinding,
    PresetEntry,
    Series,
    Style,
    VariantSet,
)
from mio_server.pipeline.compiler import compile_panel
from mio_server.pipeline.node_overrides import node_overrides
from mio_server.pipeline.render_draft import panel_values
from mio_server.pipeline.story import apply_variant
from mio_server.pipeline.variables import table

from .api_harness import ApiCase

AXES = ("character", "outfit", "scene", "style")


def structured_work():
    series = Series(
        title="Study",
        bible=Bible(
            characters=[
                Character(
                    id="hero",
                    name="Hero",
                    age=24,
                    tag_description=["black hair"],
                    outfits={"default": ["red coat"], "party": ["blue suit"]},
                )
            ],
            locations=[Location(id="room", name="Room", tags=["bookshelves"])],
            styles=[
                Style(id="ink", tag_description=["ink drawing"]),
                Style(id="color", tag_description=["watercolor"]),
            ],
        ),
    )
    episode = Episode(
        series_id=series.id,
        title="Study",
        order=0,
        panels=[
            Panel(
                id="p1",
                order=0,
                characters=[PanelCharacter(character_id="hero", outfit="default")],
                location_id="room",
            )
        ],
    )
    return series, episode


class VariantMatrixCompilerTests(unittest.TestCase):
    def assembled(self):
        preset = Preset(
            title="Original",
            entries=[PresetEntry(key=axis, value=f"original-{axis}") for axis in AXES],
            bindings=[
                PresetBinding(
                    node_id="1", path="text", value=" / ".join("{" + axis + "}" for axis in AXES)
                ),
                PresetBinding(node_id="2", path="text", source="variable", value="outfit"),
            ],
        )
        workshop = Series(title="Workshop", kind="workshop", presets=[preset])
        board = Episode(
            series_id=workshop.id,
            title="Board",
            order=0,
            panels=[
                Panel(
                    order=0,
                    overrides=PanelOverrides(
                        raw_prompt=" / ".join("{" + axis + "}" for axis in AXES)
                    ),
                )
            ],
        )
        snapshot = build_snapshot(workshop, board, [preset.id], "Frozen album")
        return snapshot.series, snapshot.episode

    def test_all_sixteen_preset_combinations_change_real_assembled_prompt_and_workflow_values(self):
        series, episode = self.assembled()
        panel = episode.panels[0]
        before = series.model_dump()
        prompts = set()
        for choices in itertools.product(("a", "b"), repeat=4):
            values = {axis: f"{axis}-{choice}" for axis, choice in zip(AXES, choices)}
            variant = VariantSet(name="Matrix", variables=values)
            expected = " / ".join(values.values())
            for dialect in ("tags", "natural"):
                compiled = compile_panel(
                    series, episode, panel, variant=variant, dialect=dialect, seed=1
                )
                self.assertEqual(compiled.positive, expected)
                self.assertTrue(compiled.raw)
            self.assertEqual(node_overrides(series, panel, variant)["/1/inputs/text"], expected)
            self.assertEqual(
                node_overrides(series, panel, variant)["/2/inputs/text"], values["outfit"]
            )
            self.assertEqual(
                panel_values(series, panel, variant),
                {f"var.{key}": value for key, value in values.items()},
            )
            prompts.add(compiled.positive)
        self.assertEqual(len(prompts), 16)
        self.assertEqual(series.model_dump(), before)

    def test_local_then_variant_then_frozen_series_then_bible_priority_and_explicit_clear(self):
        series, episode = self.assembled()
        panel = episode.panels[0]
        variant = VariantSet(name="Clear outfit", variables={"outfit": "", "scene": "new-scene"})
        panel.overrides.values = {"$character": "local-character"}
        self.assertEqual(
            compile_panel(series, episode, panel, variant=variant).positive,
            "local-character /  / new-scene / original-style",
        )
        bindings = node_overrides(series, panel, variant)
        self.assertEqual(
            bindings["/1/inputs/text"], "local-character /  / new-scene / original-style"
        )
        self.assertNotIn(
            "/2/inputs/text", bindings, "empty variable bindings preserve the workflow value"
        )
        panel.overrides.node_overrides = {"/1/inputs/text": "local-node"}
        self.assertEqual(node_overrides(series, panel, variant)["/1/inputs/text"], "local-node")
        structured, ep = structured_work()
        self.assertEqual(table(structured, ep.panels[0])["scene"], "bookshelves")
        structured.variables["scene"] = "frozen-scene"
        self.assertEqual(table(structured, ep.panels[0], variant=variant)["scene"], "new-scene")
        self.assertEqual(table(structured, ep.panels[0])["scene"], "frozen-scene")

    def test_structured_appearance_outfit_location_and_style_reach_real_prompt_independently(self):
        series, episode = structured_work()
        panel = episode.panels[0]
        before = series.model_dump()
        variant = VariantSet(
            name="New scene",
            characters={"hero": {"tag_description": ["silver hair"]}},
            outfits={"hero": {"default": ["yellow jacket"]}},
            locations={
                "room": {"tags": ["seaside"], "description": "An open beach", "time": "morning"}
            },
            style_id="color",
        )
        compiled = compile_panel(series, episode, panel, variant=variant, seed=2)
        for value in ("silver hair", "yellow jacket", "seaside", "watercolor"):
            self.assertIn(value, compiled.positive)
        for value in ("black hair", "red coat", "bookshelves", "ink drawing"):
            self.assertNotIn(value, compiled.positive)
        for field, marker in (
            ("characters", "black hair"),
            ("outfits", "red coat"),
            ("locations", "bookshelves"),
            ("style_id", "ink drawing"),
        ):
            data = variant.model_dump()
            data[field] = None if field == "style_id" else {}
            self.assertIn(
                marker,
                compile_panel(
                    series, episode, panel, variant=VariantSet.model_validate(data)
                ).positive,
            )
        patched = apply_variant(series.bible, variant)
        self.assertEqual(patched.characters[0].id, "hero")
        self.assertEqual(patched.characters[0].outfits["party"], ["blue suit"])
        self.assertEqual(patched.locations[0].id, "room")
        self.assertEqual(patched.locations[0].time, "morning")
        self.assertEqual(series.model_dump(), before)

    def test_outfit_axis_wins_over_character_outfits_and_clears_only_its_slot(self):
        series, _ = structured_work()
        variant = VariantSet(
            name="Clear",
            characters={"hero": {"outfits": {"default": ["coat"], "party": ["suit"]}}},
            outfits={"hero": {"default": []}},
            locations={"room": {"tags": []}},
        )
        patched = apply_variant(series.bible, variant)
        self.assertEqual(patched.characters[0].outfits, {"default": [], "party": ["suit"]})
        self.assertEqual(patched.locations[0].tags, [])
        self.assertIs(apply_variant(series.bible, None), series.bible)

    def test_strict_new_fields_reject_invalid_shapes_ids_keys_and_nonfinite_json(self):
        for patch in (
            {"outfits": {"": {"default": []}}},
            {"outfits": {"hero": {" ": []}}},
            {"outfits": {"hero": {"default": [1]}}},
            {"locations": {"room": {"id": "other"}}},
            {"locations": {"room": {"api_key": "private"}}},
            {"locations": {"room": {"tags": [1]}}},
            {"locations": {"room": {"time": "tomorrow"}}},
            {"variables": {"bad name": "value"}},
            {"variables": {"{bad}": "value"}},
            {"variables": {"outfit": 4}},
            {"characters": {"hero": {"weight": math.nan}}},
            {"characters": {"hero": {"weight": math.inf}}},
        ):
            with self.subTest(patch=patch), self.assertRaises(ValidationError):
                VariantSet(name="Invalid", **patch)


class VariantMatrixApiTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.series, self.episode = structured_work()
        self.ctx.store.create_series(self.series)
        self.ctx.store.create_episode(self.episode)
        self.path = f"/api/series/{self.series.id}/variants"

    def test_append_validation_is_atomic_for_missing_targets_and_invalid_character_patch(self):
        for patch in (
            {"outfits": {"missing": {"default": []}}},
            {"locations": {"missing": {"tags": ["trees"]}}},
            {"characters": {"missing": {"tag_description": []}}},
            {"characters": {"hero": {"age": 10}}},
            {"style_id": "missing"},
        ):
            with self.subTest(patch=patch):
                result = self.client.post(
                    self.path,
                    json={
                        "variants": [
                            {"id": "first", "name": "First"},
                            {"id": "invalid", "name": "Invalid", **patch},
                        ]
                    },
                )
                self.assertEqual(result.status_code, 400)
                self.assertEqual(self.ctx.store.get_series(self.series.id).variants, [])
                self.assertEqual(self.ctx.engine.list(), [])

    def test_four_axis_variant_preview_uses_native_compiler_and_append_starts_no_work(self):
        variant = {
            "id": "four",
            "name": "Four",
            "characters": {"hero": {"tag_description": ["silver hair"]}},
            "outfits": {"hero": {"default": ["yellow jacket"]}},
            "locations": {"room": {"tags": ["seaside"]}},
            "style_id": "color",
        }
        self.ok(self.client.post(self.path, json={"variants": [variant, variant]}))
        self.assertEqual(len(self.ctx.store.get_series(self.series.id).variants), 1)
        self.assertEqual(self.ctx.engine.list(), [])
        preview = self.ok(
            self.client.get(
                f"/api/episodes/{self.episode.id}/panels/p1/prompt", params={"variant_id": "four"}
            )
        )
        for marker in ("silver hair", "yellow jacket", "seaside", "watercolor"):
            self.assertIn(marker, preview["tags"]["positive"])
        self.assertEqual(self.ctx.store.get_series(self.series.id).bible, self.series.bible)

    def test_selected_raw_matrix_subset_freezes_distinct_prompts_into_real_queued_items(self):
        def raw_panel(episode):
            episode.panels[0].overrides.raw_prompt = " / ".join("{" + axis + "}" for axis in AXES)

        self.ctx.store.update_episode(self.episode.id, raw_panel)
        self.ctx.store.update_series(
            self.series.id,
            lambda series: series.variables.update({axis: "frozen" for axis in AXES}),
        )
        variants = [
            {
                "id": f"matrix-{value}",
                "name": value,
                "variables": {axis: f"{axis}-{value}" for axis in AXES},
            }
            for value in ("a", "b", "not-selected")
        ]
        self.ok(self.client.post(self.path, json={"variants": variants}))
        job = self.ok(
            self.client.post(
                f"/api/episodes/{self.episode.id}/render",
                json={
                    "panel_ids": ["p1"],
                    "variant_ids": ["matrix-a", "matrix-b"],
                    "candidates": 2,
                    "adopt_first": False,
                    "adopt_replace": False,
                    "idempotency_key": "matrix-subset",
                },
            )
        )
        self.assertEqual(len(job["items"]), 4)
        plans = [item["input"]["meta"] for item in job["items"]]
        self.assertEqual({plan["variant_id"] for plan in plans}, {"matrix-a", "matrix-b"})
        self.assertEqual(
            {plan["prompt"] for plan in plans},
            {" / ".join(f"{axis}-{value}" for axis in AXES) for value in ("a", "b")},
        )
        self.assertTrue(all(plan["raw"] for plan in plans))
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).takes, [])
