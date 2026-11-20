"""Explicit canvas assistance is a preview, preserves manual layers and refuses stale writes."""

import copy
import io
import unittest

from PIL import Image

from mio_server.models import Episode, Face, LetteringLayer, Panel, Series, Strip, Take
from mio_server.pipeline import canvas_assist as CA
from mio_server.pipeline import layout as LY
from mio_server.pipeline import pacing as PC

from .api_harness import ApiCase


def canvas():
    episode = Episode(
        series_id="series",
        title="Canvas",
        order=0,
        panels=[Panel(id="panel", order=0)],
        takes=[
            Take(
                panel_id="panel",
                asset_id="asset",
                status="adopted",
                width=800,
                height=1000,
                faces=[Face(box=(0.2, 0.1, 0.5, 0.4))],
            )
        ],
    )
    episode.strip = Strip(
        width=800,
        height=1500,
        manual=True,
        panel_boxes={"panel": (0, 100, 800, 1100)},
        lettering=[
            LetteringLayer(
                id="bubble",
                panel_id="panel",
                text="Hello",
                box=(180, 250, 390, 370),
                tail_to=(230, 420),
                locked=True,
            ),
            LetteringLayer(
                id="manual",
                panel_id="panel",
                text="Keep",
                kind="caption",
                box=(400, 100, 790, 220),
                locked=True,
            ),
        ],
    )
    return episode


class CanvasAssistTests(unittest.TestCase):
    def test_only_explicit_target_moves_without_covering_faces_or_other_layers(self):
        ep = canvas()
        before = ep.model_dump()
        strip, unresolved = CA.avoid_lettering(ep, ep.strip, ["bubble"])
        self.assertEqual(unresolved, [])
        moved, fixed = strip.lettering
        self.assertNotEqual(moved.box, ep.strip.lettering[0].box)
        self.assertEqual(LY._overlap(moved.box, (160, 200, 400, 500)), 0)
        self.assertEqual(LY._overlap(moved.box, fixed.box), 0)
        self.assertEqual(fixed, ep.strip.lettering[1])
        self.assertEqual(moved.box[2] - moved.box[0], 210)
        self.assertEqual(moved.box[3] - moved.box[1], 120)
        self.assertEqual(moved.tail_to[0] - moved.box[0], 50)
        self.assertEqual(moved.tail_to[1] - moved.box[1], 170)
        self.assertTrue(moved.locked)
        self.assertEqual(strip.panel_boxes, ep.strip.panel_boxes)
        self.assertEqual(strip.crops, ep.strip.crops)
        self.assertEqual(ep.model_dump(), before)

    def test_detected_faces_follow_the_saved_crop(self):
        ep = canvas()
        ep.strip.crops["panel"] = (0.5, 0, 1, 1)
        ep.takes[0].faces[0].box = (0.6, 0.1, 0.8, 0.4)
        strip, unresolved = CA.avoid_lettering(ep, ep.strip, ["bubble"])
        self.assertEqual(unresolved, [])
        self.assertEqual(LY._overlap(strip.lettering[0].box, (160, 200, 480, 500)), 0)
        self.assertEqual(strip.crops, ep.strip.crops)

    def test_no_safe_position_and_cross_panel_targets_are_kept_verbatim(self):
        ep = canvas()
        ep.strip.lettering[0].box = (0, 100, 800, 1100)
        strip, unresolved = CA.avoid_lettering(ep, ep.strip, ["bubble"])
        self.assertEqual(unresolved, ["bubble"])
        self.assertEqual(strip, ep.strip)
        ep.strip.lettering[0].bridge_to = "panel"
        strip, unresolved = CA.avoid_lettering(ep, ep.strip, ["bubble"])
        self.assertEqual(unresolved, ["bubble"])
        self.assertEqual(strip, ep.strip)

    def test_invalid_geometry_identifiers_and_targets_are_rejected(self):
        for key, value in (
            ("box", (0, 0, float("nan"), 100)),
            ("font_size", 100000),
            ("box", (20, 20, 10, 10)),
            ("panel_id", "missing"),
        ):
            ep = canvas()
            setattr(ep.strip.lettering[0], key, value)
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                CA.avoid_lettering(ep, ep.strip, ["bubble"])
        for selected in ([], ["missing"], ["bubble", "bubble"]):
            ep = canvas()
            with self.subTest(selected=selected), self.assertRaises(ValueError):
                CA.avoid_lettering(ep, ep.strip, selected)

    def test_rhythm_presets_use_existing_fields_and_preserve_locked_panels(self):
        ep = canvas()
        ep.panels.append(Panel(id="locked", order=1, locked=True))
        series = Series(id=ep.series_id, title="Canvas")
        before = copy.deepcopy(ep.model_dump())
        suggestions = {
            name: PC.suggest(series, ep, name) for name in ("compact", "lyrical", "cinematic")
        }
        compact = suggestions["compact"][0]["changes"]
        lyrical = suggestions["lyrical"][0]["changes"]
        cinema = suggestions["cinematic"][0]["changes"]
        self.assertLess(compact["gap_after"], lyrical["gap_after"])
        self.assertEqual(cinema["aspect_ratio"], "16:9")
        for changes in suggestions.values():
            self.assertNotIn("locked", [item["panel_id"] for item in changes])
            self.assertTrue(all(set(item["changes"]) <= set(PC.FIELDS) for item in changes))
        self.assertEqual(ep.model_dump(), before)


class CanvasAssistApiTests(ApiCase):
    def setUp(self):
        super().setUp()
        series = self.ctx.store.create_series(Series(title="Canvas"))
        ep = canvas()
        ep.series_id = series.id
        out = io.BytesIO()
        Image.new("RGB", (800, 1000), "#bac9d8").save(out, "PNG")
        ep.takes[0].asset_id = self.ctx.assets.put(out.getvalue(), source="test").id
        self.ep = self.ctx.store.create_episode(ep)
        self.path = f"/api/episodes/{ep.id}"

    def test_preview_never_writes_and_requires_a_current_revision(self):
        body = {
            "base_revision": self.ep.revision,
            "strip": self.ep.strip.model_dump(mode="json"),
            "layer_ids": ["bubble"],
        }
        preview = self.ok(self.client.post(self.path + "/strip/avoid-lettering", json=body))
        self.assertEqual(preview["unresolved"], [])
        self.assertNotEqual(
            preview["strip"]["lettering"][0]["box"], body["strip"]["lettering"][0]["box"]
        )
        self.assertEqual(self.ctx.store.get_episode(self.ep.id), self.ep)
        body["base_revision"] += 1
        self.assertEqual(
            self.client.post(self.path + "/strip/avoid-lettering", json=body).status_code, 409
        )
        body["base_revision"] = self.ep.revision
        body["layer_ids"] = ["unknown"]
        self.assertEqual(
            self.client.post(self.path + "/strip/avoid-lettering", json=body).status_code, 400
        )

    def test_stale_canvas_save_does_not_overwrite_newer_geometry(self):
        newer = self.ep.strip.model_copy(update={"background": "#112233"})
        first = self.ok(
            self.client.put(
                self.path + f"/strip?base_revision={self.ep.revision}",
                json=newer.model_dump(mode="json"),
            )
        )
        conflict = self.client.put(
            self.path + f"/strip?base_revision={self.ep.revision}",
            json=self.ep.strip.model_dump(mode="json"),
        )
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(
            self.ctx.store.get_episode(self.ep.id).strip.model_dump(mode="json"), first
        )

    def test_preset_query_is_validated_and_available_on_open_api(self):
        token = self.ok(
            self.client.post("/api/tokens", json={"name": "canvas", "scopes": ["write"]}), 201
        )["token"]
        headers = {"Authorization": f"Bearer {token}"}
        path = self.path.replace("/api/", "/api/v2/")
        response = self.client.post(path + "/pacing/suggest?preset=cinematic", headers=headers)
        preview = self.ok(response)
        self.assertEqual(preview["suggestions"][0]["changes"]["aspect_ratio"], "16:9")
        self.assertEqual(
            self.client.post(self.path + "/pacing/suggest?preset=unknown").status_code, 422
        )
        self.assertEqual(self.ctx.store.get_episode(self.ep.id), self.ep)
