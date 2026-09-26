"""P5 (optional direction): dynamic comic — camera plan, voice lines and the offline player."""

from __future__ import annotations

import json
import re
import unittest

from mio_server.models import Character, Dialogue, DialogueKind, Gender, Panel, PanelMotion, Series
from mio_server.motion.export import MotionOptions, render_motion
from mio_server.motion.plan import (
    MAX_HOLD,
    MIN_HOLD,
    auto_hold,
    auto_move,
    plan_episode,
    reading_seconds,
    voice_for,
)

from .api_harness import ApiCase


def series() -> Series:
    s = Series(title="雨夜")
    s.bible.characters = [
        Character(id="lin", name="林", gender=Gender.female, age=24),
        Character(id="zhou", name="周", gender=Gender.male, age=30),
    ]
    return s


def panel(order=0, shot="medium", lines=(), **kw) -> Panel:
    dialogues = [Dialogue(text=t, speaker_id=who, kind=kind) for who, t, kind in lines]
    return Panel(order=order, shot=shot, dialogues=dialogues, **kw)


SPEECH = DialogueKind.speech


class PlanTests(unittest.TestCase):
    def test_reading_time(self):
        self.assertAlmostEqual(reading_seconds("你好世界你好"), 1.0)
        self.assertAlmostEqual(reading_seconds("a" * 15), 1.0)
        self.assertEqual(auto_hold(panel()), MIN_HOLD)
        long = panel(lines=[("lin", "很长的台词" * 40, SPEECH)])
        self.assertEqual(auto_hold(long), MAX_HOLD)
        two = panel(lines=[("lin", "走吧走吧走吧", SPEECH), ("zhou", "好的好的好的", SPEECH)])
        self.assertAlmostEqual(auto_hold(two), round(1.6 + 2 + 0.7, 1))

    def test_auto_move_rules(self):
        self.assertEqual(auto_move(panel(shot="close"), 0), "push_in")
        self.assertEqual(auto_move(panel(shot="extreme_close"), 3), "push_in")
        self.assertEqual(auto_move(panel(shot="wide", aspect_ratio="16:9"), 0), "pan_right")
        self.assertEqual(auto_move(panel(shot="wide", aspect_ratio="16:9"), 1), "pan_left")
        self.assertEqual(auto_move(panel(shot="wide", aspect_ratio="2:3"), 0), "pan_down")
        self.assertEqual(auto_move(panel(shot="full", angle="low"), 0), "pan_up")
        self.assertEqual(auto_move(panel(), 0), "push_in")
        self.assertEqual(auto_move(panel(), 1), "pull_out")
        boom = panel(shot="wide", lines=[(None, "轰！", DialogueKind.sfx)])
        self.assertEqual(auto_move(boom, 0), "shake")

    def test_overrides_and_voice_lines(self):
        s = series()
        panels = [
            panel(0, lines=[("lin", "走吧", SPEECH), (None, "雨停了", DialogueKind.narration)]),
            panel(1, motion=PanelMotion(move="pan_up", hold=6)),
            panel(2, lines=[(None, "咚", DialogueKind.sfx)], motion=PanelMotion(move="auto")),
        ]
        plan = plan_episode(s, panels)
        self.assertEqual(plan[0]["move"], "push_in")
        self.assertFalse(plan[0]["move_overridden"])
        self.assertEqual([ln["speaker"] for ln in plan[0]["lines"]], ["林", ""])
        self.assertEqual(plan[0]["lines"][1]["voice"]["id"], "narrator")
        self.assertEqual((plan[1]["move"], plan[1]["hold"]), ("pan_up", 6))
        self.assertTrue(plan[1]["move_overridden"])
        self.assertEqual(plan[1]["auto_move"], "pull_out")
        self.assertEqual(plan[2]["lines"], [])  # SFX are drawn, not read

    def test_voices_are_stable_and_gendered(self):
        s = series()
        lin = voice_for(s, "lin", SPEECH)
        self.assertEqual(lin, voice_for(s, "lin", SPEECH))
        self.assertGreater(lin["pitch"], voice_for(s, "zhou", SPEECH)["pitch"])
        self.assertEqual(voice_for(s, "lin", DialogueKind.caption)["id"], "narrator")
        self.assertEqual(voice_for(s, "ghost", SPEECH)["gender"], "unknown")


def timeline(lines=()) -> dict:
    shot = {"image": "data:image/jpeg;base64,AAAA", "width": 8, "height": 12}
    return {
        "series": "雨夜",
        "title": "第一话 </script><script>alert(1)</script>",
        "synopsis": "",
        "shots": [{**shot, "move": "push_in", "hold": 2.0, "lines": list(lines)}],
    }


class PlayerTests(unittest.TestCase):
    def test_offline_and_escaped(self):
        doc = render_motion(timeline(), MotionOptions(aspect="landscape"))
        head = doc.split("</head>")[0]
        nonce = re.search(r"script-src 'nonce-([0-9a-f]+)'", head).group(1)
        self.assertEqual(doc.count(f'<script nonce="{nonce}">'), 1)
        self.assertIn("default-src 'none'", head)
        self.assertIn("connect-src 'none'", head)
        self.assertIn("--ar:16/9", head)
        self.assertNotIn("<script>alert", doc)
        raw = re.search(r'id="mio-motion">(.*?)</script>', doc, re.S).group(1)
        self.assertEqual(json.loads(raw)["title"], timeline()["title"])
        self.assertNotRegex(doc, r"https?://(?!www\.w3)")
        with self.assertRaises(ValueError):
            render_motion(timeline(), MotionOptions(aspect="square"))


class MotionApiTests(ApiCase):
    def test_plan_override_and_export(self):
        _, ep = self.make_episode()
        plan = self.ok(self.client.get(f"/api/episodes/{ep['id']}/motion-plan"))
        self.assertEqual(len(plan["shots"]), len(ep["panels"]))
        self.assertFalse(any(s["has_image"] for s in plan["shots"]))
        self.assertEqual(plan["total_seconds"], 0)
        empty = self.client.post("/api/export/motion", json={"episode_id": ep["id"]})
        self.assertEqual(empty.status_code, 400)

        ep = self.adopt_all(ep)
        first = ep["panels"][0]["id"]
        changes = {"changes": {"motion": {"move": "pan_left", "hold": 4.5}}}
        self.ok(self.client.patch(f"/api/episodes/{ep['id']}/panels/{first}", json=changes))
        bad = {"changes": {"motion": {"move": "spin"}}}
        res = self.client.patch(f"/api/episodes/{ep['id']}/panels/{first}", json=bad)
        self.assertIn(res.status_code, (400, 422))
        plan = self.ok(self.client.get(f"/api/episodes/{ep['id']}/motion-plan"))
        shot = next(s for s in plan["shots"] if s["panel_id"] == first)
        self.assertEqual((shot["move"], shot["hold"]), ("pan_left", 4.5))
        self.assertGreater(plan["total_seconds"], 4.5)

        exported = []
        self.ctx.hooks.add("episode.exported", exported.append, source="test")
        res = self.ok(self.client.post("/api/export/motion", json={"episode_id": ep["id"]}))
        self.assertIn("text/html", res.headers["content-type"])
        self.assertIn("filename*=UTF-8''", res.headers["content-disposition"])
        data = json.loads(re.search(r'id="mio-motion">(.*?)</script>', res.text, re.S).group(1))
        self.assertEqual(data["schema"], "mio.motion.v1")
        self.assertEqual(len(data["shots"]), len(ep["panels"]))
        self.assertEqual(data["shots"][0]["move"], "pan_left")
        self.assertEqual(exported[-1]["fmt"], "motion")
        raw = {"episode_id": ep["id"], "lettered": False, "aspect": "landscape", "voice": False}
        self.ok(self.client.post("/api/export/motion", json=raw))


if __name__ == "__main__":
    unittest.main()
