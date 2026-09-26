"""P4: automatic pacing, SFX presets, readability report and the golden-story strip."""

import unittest

from mio_server.models import Dialogue, DialogueKind, PanelWidth, Series
from mio_server.pipeline import pacing as PC
from mio_server.pipeline import story as ST

from .api_harness import ApiCase
from .story_fixture import make_story


def project(n=8):
    series = Series(title="雨夜")
    bible, episode = ST.from_story(make_story(n), series.id)
    series.bible = bible
    return series, episode


class PacingRuleTests(unittest.TestCase):
    def test_rules_follow_shots_scenes_and_time(self):
        series, episode = project()
        panels = episode.ordered_panels()
        panels[0].shot = "wide"
        panels[1].shot = "extreme_close"
        panels[2].shot = "extreme_close"
        panels[3].characters, panels[3].dialogues = [], []
        panels[4].location_id = panels[3].location_id
        panels[5].location_id = panels[4].location_id
        panels[5].time = "morning" if panels[4].time != "morning" else "evening"
        by_id = {s["panel_id"]: s for s in PC.suggest(series, episode)}
        get = lambda p, k: by_id.get(p.id, {}).get("changes", {}).get(k, getattr(p, k))  # noqa: E731
        self.assertEqual(get(panels[0], "width_mode"), "bleed")  # opening establishing shot
        self.assertEqual(get(panels[1], "width_mode"), "inset")
        self.assertEqual(
            (get(panels[1], "inset_align"), get(panels[2], "inset_align")), ("left", "right")
        )
        self.assertEqual(get(panels[3], "width_mode"), "frameless")  # empty scenery
        self.assertEqual(get(panels[4], "gap_after"), PC.GAPS["skip"])  # time skip follows
        self.assertIn(">", get(panels[4], "transition_background"))
        self.assertEqual(get(panels[-1], "gap_after"), PC.GAPS["end"])

    def test_locked_panels_are_left_alone_and_rerun_is_stable(self):
        series, episode = project()
        episode.panels[0].locked = True
        suggestions = PC.suggest(series, episode)
        self.assertNotIn(episode.panels[0].id, {s["panel_id"] for s in suggestions})
        for s in suggestions:
            panel = next(p for p in episode.panels if p.id == s["panel_id"])
            for key, value in s["changes"].items():
                setattr(panel, key, PanelWidth(value) if key == "width_mode" else value)
        self.assertEqual(PC.suggest(series, episode), [])

    def test_dialogue_heavy_panels_get_taller(self):
        series, episode = project(3)
        panel = episode.ordered_panels()[1]
        panel.shot, panel.aspect_ratio = "medium", "3:4"
        panel.dialogues = [Dialogue(speaker_id="lin", text=f"第{i}句") for i in range(3)]
        by_id = {s["panel_id"]: s["changes"] for s in PC.suggest(series, episode)}
        self.assertEqual(by_id[panel.id]["aspect_ratio"], "2:3")


class CanvasApiTests(ApiCase):
    def test_pacing_suggest_and_apply(self):
        _, ep = self.make_episode()
        preview = self.ok(self.client.post(f"/api/episodes/{ep['id']}/pacing/suggest"))
        self.assertTrue(preview["suggestions"])
        first = preview["suggestions"][0]
        body = {
            "base_revision": preview["revision"],
            "patches": [{"panel_id": first["panel_id"], "changes": first["changes"]}],
        }
        updated = self.ok(self.client.post(f"/api/episodes/{ep['id']}/pacing/apply", json=body))
        panel = next(p for p in updated["panels"] if p["id"] == first["panel_id"])
        for key, value in first["changes"].items():
            if value is not None:
                self.assertEqual(panel[key], value)
        stale = self.client.post(f"/api/episodes/{ep['id']}/pacing/apply", json=body)
        self.assertEqual(stale.status_code, 409)
        bad = {
            "base_revision": updated["revision"],
            "patches": [{"panel_id": first["panel_id"], "changes": {"description": "x"}}],
        }
        self.assertEqual(
            self.client.post(f"/api/episodes/{ep['id']}/pacing/apply", json=bad).status_code, 422
        )

    def test_sfx_presets(self):
        presets = self.ok(self.client.get("/api/lettering/sfx-presets"))
        self.assertIn("impact", presets)
        self.assertEqual(presets["impact"]["preset"], "impact")

    def test_golden_story_auto_strip_is_readable(self):
        """P4 done criterion (machine part): script → render → auto pacing → auto lettering."""
        _, ep = self.make_episode()
        eid = ep["id"]
        panels = ep["panels"]
        panels[2]["dialogues"].append({"text": "砰", "kind": DialogueKind.sfx.value})
        panels[4]["dialogues"].append(
            {"speaker_id": "lin", "text": "我们……下一格见。", "kind": "speech", "bridge": True}
        )
        for panel in (panels[2], panels[4]):
            self.ok(
                self.client.patch(
                    f"/api/episodes/{eid}/panels/{panel['id']}",
                    json={"changes": {"dialogues": panel["dialogues"]}},
                )
            )
        self.drain(self.ok(self.client.post(f"/api/episodes/{eid}/render", json={"candidates": 1})))
        ep = self.ok(self.client.get(f"/api/episodes/{eid}"))
        for take in ep["takes"]:
            ep = self.ok(self.client.post(f"/api/episodes/{eid}/takes/{take['id']}/adopt"))
        preview = self.ok(self.client.post(f"/api/episodes/{eid}/pacing/suggest"))
        self.ok(
            self.client.post(
                f"/api/episodes/{eid}/pacing/apply",
                json={
                    "base_revision": preview["revision"],
                    "patches": [
                        {"panel_id": s["panel_id"], "changes": s["changes"]}
                        for s in preview["suggestions"]
                    ],
                },
            )
        )
        strip = self.ok(self.client.post(f"/api/episodes/{eid}/strip/layout", json={}))
        self.assertTrue(any(layer["bridge_to"] for layer in strip["lettering"]))
        self.assertTrue(any(layer["style"] for layer in strip["lettering"]))
        report = self.ok(self.client.get(f"/api/episodes/{eid}/strip/report"))
        self.assertEqual(report["panels"], 12)
        self.assertTrue(report["readable"], report)
        png = self.client.get(f"/api/episodes/{eid}/strip.png")
        self.assertEqual(png.content[:4], b"\x89PNG")


if __name__ == "__main__":
    unittest.main()
