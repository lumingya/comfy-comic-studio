import copy
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from mio_server import settings as SET
from mio_server.comfy import compile as C
from mio_server.importer import LegacyImporter, convert_workflow, ratio_of, shot_of
from mio_server.models import Series
from mio_server.pipeline import assistant as A
from mio_server.pipeline import compiler as K
from mio_server.pipeline import story as ST
from mio_server.pipeline.render import panel_values
from mio_server.storage import Conflict, NotFound, SQLiteStore
from mio_server.trash import Trash

from .legacy_fixture import copy_shipped_legacy
from .story_fixture import make_story


class ReviseLLM:
    """Fake LLM: applies ``edit(story)`` to the story it receives."""

    def __init__(self, edit):
        self.edit = edit
        self.calls = 0

    def chat_json(self, messages, models=None, validate=None, repairs=0, **kw):
        self.calls += 1
        text = messages[-1]["content"]
        story = json.loads(text.split("当前剧本：\n", 1)[1].split("\n\n修改要求：", 1)[0])
        story = self.edit(copy.deepcopy(story))
        if validate:
            assert not validate(story), validate(story)
        return story, SimpleNamespace(model="fake", seconds=0)


def store_with_story(n=6):
    store = SQLiteStore(":memory:")
    series = Series(title="雨夜便利店")
    bible, episode = ST.from_story(make_story(n), series.id)
    series.bible = bible
    episode.panels[0].lighting = "neon light"
    lin = series.bible.character("lin")
    lin.outfits = {"winter": ["red scarf"]}
    episode.panels[1].characters[0].outfit = "winter"
    episode.panels[1].characters[0].position = "left"
    store.create_series(series)
    store.create_episode(episode)
    return store, series, episode


class AssistantTests(unittest.TestCase):
    def test_unchanged_story_has_no_ops(self):
        store, series, episode = store_with_story()
        self.addCleanup(store.close)
        proposal = A.propose(series, episode, "保持原样", ReviseLLM(lambda s: s))
        self.assertEqual(proposal["ops"], [])

    def test_review_and_apply_subset(self):
        store, series, episode = store_with_story()
        self.addCleanup(store.close)
        store.update_episode(episode.id, lambda e: setattr(e.panel("p05"), "locked", True))
        episode = store.get_episode(episode.id)

        def edit(story):
            panels = story["panels"]
            panels[1]["description"] = "Lin laughs at the counter"
            panels[4]["shot"] = "wide"  # p05 is locked
            new = copy.deepcopy(panels[3])
            new["id"] = "p_new1"
            new["dialogue"] = [{"speaker": "zhou", "kind": "speech", "text": "好久不见。"}]
            story["panels"] = [p for p in panels if p["id"] != "p03"]
            story["panels"].insert(3, new)
            story["characters"][0]["tags"].append("silver earrings")
            return story

        proposal = A.propose(series, episode, "加一格重逢", ReviseLLM(edit))
        kinds = {op["op"]: op for op in proposal["ops"]}
        self.assertEqual(
            set(kinds), {"update_character", "remove_panel", "update_panel", "add_panel"}
        )
        blocked = [op for op in proposal["ops"] if op["blocked"]]
        self.assertEqual([op["target"] for op in blocked], ["p05"])
        p02 = next(op for op in proposal["ops"] if op["target"] == "p02")
        self.assertEqual(list(p02["changes"]), ["description"])  # outfit / position not reported

        accept = [op["id"] for op in proposal["ops"] if op["op"] != "remove_panel"]
        result = A.apply(store, episode.id, proposal["ops"], accept, proposal["base_revision"])
        self.assertEqual(len(result["applied"]), 3)  # blocked op silently skipped
        ep = store.get_episode(episode.id)
        self.assertEqual(ep.panel("p02").description, "Lin laughs at the counter")
        self.assertEqual(ep.panel("p02").characters[0].outfit, "winter")
        self.assertEqual(ep.panel("p02").characters[0].position, "left")
        self.assertEqual(ep.panel("p05").shot, episode.panel("p05").shot)
        self.assertIsNotNone(ep.panel("p03"))  # removal was not accepted
        order = [p.id for p in ep.ordered_panels()]
        self.assertEqual(order.index("p_new1"), order.index("p04") + 1)
        self.assertEqual(ep.panel("p01").lighting, "neon light")
        lin = store.get_series(series.id).bible.character("lin")
        self.assertIn("silver earrings", lin.tag_description)
        with self.assertRaises(Conflict):  # stale base revision
            A.apply(store, episode.id, proposal["ops"], accept, proposal["base_revision"])


class TrashTests(unittest.TestCase):
    def test_soft_delete_restore_purge_expire(self):
        store, series, episode = store_with_story(3)
        self.addCleanup(store.close)
        trash = Trash(store)
        trash.delete_episode(episode.id)
        with self.assertRaises(NotFound):
            store.get_episode(episode.id)
        self.assertEqual(trash.list()["items"][0]["id"], episode.id)
        with self.assertRaises(Conflict):
            trash.purge("series", series.id)  # not in the trash
        # slot reused meanwhile → restored episode moves to the end
        from mio_server.models import Episode

        store.create_episode(Episode(series_id=series.id, title="新第一话", order=0))
        self.assertTrue(trash.restore_episode(episode.id)["moved_to_end"])
        trash.delete_series(series.id)
        self.assertEqual(store.list_series(), [])
        trash.restore_series(series.id)
        self.assertEqual(len(store.list_series()), 1)
        trash.delete_series(series.id)
        later = datetime.now(timezone.utc) + timedelta(days=31)
        self.assertEqual(trash.expire(30, now=later), 1)
        with self.assertRaises(NotFound):
            store.get_series(series.id, include_deleted=True)


class ImporterTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "data"
        copy_shipped_legacy(self.root)
        self.store = SQLiteStore(":memory:")
        self.addCleanup(self.store.close)

    def test_imports_shipped_legacy_data(self):
        importer = LegacyImporter(self.store, self.root)
        self.assertGreaterEqual(importer.scan()["storyboards"], 1)
        report = importer.run()
        self.assertEqual(len(report.series), 1)
        series = self.store.get_series(report.series[0])
        self.assertEqual(series.title, "遇见你，真好")
        self.assertEqual(series.variables["character"], "nanami")
        self.assertEqual(series.bible.characters[0].name, "七海")
        episode = self.store.get_episode(report.episodes[0])
        self.assertEqual(len(episode.panels), 12)
        panel = episode.ordered_panels()[0]
        self.assertTrue(panel.overrides.raw_prompt.startswith("{character}, {outfit}"))
        self.assertEqual((panel.shot, panel.aspect_ratio), ("full", "3:4"))
        compiled = K.compile_panel(series, episode, panel, seed=1)
        self.assertTrue(compiled.positive.startswith("nanami, white shirt"))
        self.assertEqual(compiled.unresolved, [])
        self.assertTrue(panel_values(series, panel)["var.character"] == "nanami")
        wf = self.store.get_doc("workflow", report.workflows[0])
        self.assertEqual(wf.config.mapping["prompt"], ["/6/inputs/text"])
        self.assertIn("seed", wf.config.mapping)
        out = C.compile_workflow(wf, {"prompt": "hello", "seed": 5})
        self.assertEqual(out.graph["6"]["inputs"]["text"], "hello")
        self.assertIn("9", out.outputs)
        again = LegacyImporter(self.store, self.root).run()
        self.assertEqual(again.series, [])  # idempotent

    def test_helpers(self):
        self.assertEqual(shot_of("Extreme Close-up"), "extreme_close")
        self.assertEqual(shot_of("Wide establishing"), "wide")
        self.assertEqual(ratio_of(768, 1024), "3:4")
        self.assertEqual(ratio_of(None, 5), "2:3")
        doc, ptrs, warns = convert_workflow(
            {
                "id": "wf_x",
                "title": "x",
                "workflow": {
                    "1": {"class_type": "CLIPTextEncode", "inputs": {"text": ""}},
                    "2": {"class_type": "SaveImage", "inputs": {"filename_prefix": "a"}},
                },
                "bindings": [
                    {
                        "id": "b1",
                        "nodeId": "1",
                        "path": "text",
                        "source": "variable",
                        "value": "{outfit}",
                    },
                    {
                        "id": "b2",
                        "nodeId": "2",
                        "path": "filename_prefix",
                        "source": "literal",
                        "value": "mio",
                    },
                    {"id": "b3", "nodeId": "1", "path": "text", "source": "weird"},
                ],
                "outputNodeId": "2",
            }
        )
        self.assertEqual(doc.config.mapping, {"var.outfit": ["/1/inputs/text"]})
        self.assertEqual(doc.config.overrides, {"/2/inputs/filename_prefix": "mio"})
        self.assertIn("[mio:output]", doc.graph["2"]["_meta"]["title"])
        self.assertEqual(ptrs["b1"], "/1/inputs/text")
        self.assertEqual(len(warns), 1)


class SettingsTests(unittest.TestCase):
    def test_key_is_masked_and_preserved(self):
        store = SQLiteStore(":memory:")
        self.addCleanup(store.close)
        s = SET.apply_patch(
            SET.load(store), {"llm": {"api_key": "sk-secret", "base_url": "http://x/v1"}}
        )
        store.put_doc(s)
        self.assertEqual(SET.public(SET.load(store))["llm"]["api_key"], SET.MASK)
        s2 = SET.apply_patch(SET.load(store), {"llm": {"api_key": SET.MASK, "pace": 2}})
        self.assertEqual(s2.llm.api_key, "sk-secret")
        client = SET.llm_factory(store)()
        self.assertEqual((client.base_url, client.api_key), ("http://x/v1", "sk-secret"))
