import json
import unittest

from mio_server import importer
from mio_server.jobs import JobState, JobStore
from mio_server.comfy import bindings


class ImporterTests(unittest.TestCase):
    def test_storyboard_and_preset_to_series_episode(self):
        story = {"title": "旧分镜", "outline": "简介", "frames": [
            {"id": "f1", "name": "开场", "camera": "Full Shot", "prompt": "{character}, sea", "caption": "风来了", "width": 768, "height": 1024, "seed": 42}
        ]}
        preset = {"entries": [{"key": "character_display_name", "value": "七海"}, {"key": "character", "value": "nanami"},
                               {"key": "outfit", "value": "white shirt"}, {"key": "scene", "value": "coast"}]}
        series = importer.series_from_legacy(story, preset)
        episode = importer.episode_from_legacy(story, series.id, preset)
        self.assertEqual(series.bible.characters[0].name, "七海")
        self.assertEqual(episode.panels[0].overrides.raw_prompt, "{character}, sea")
        self.assertEqual(episode.panels[0].dialogues[0].text, "风来了")

    def test_workflow_profile_preserves_mapping(self):
        profile = importer.workflow_profile_from_legacy({"id": "wf", "title": "基础", "workflow": {"1": {}}, "mapping": {"positive": "6"}})
        self.assertEqual(profile.to_json()["mapping"]["positive"], "6")


class JobStoreTests(unittest.TestCase):
    def test_idempotency_and_uncertain_state(self):
        store = JobStore(":memory:")
        self.addCleanup(store.close)
        first = store.submit("render.panel", {"panel": "p01"}, "same")
        again = store.submit("render.panel", {"panel": "p01"}, "same")
        self.assertEqual(first.id, again.id)
        with self.assertRaises(ValueError):
            store.submit("render.panel", {"panel": "p02"}, "same")
        leased = store.lease("worker-a", ttl=1)
        self.assertEqual(leased.state, JobState.running)
        uncertain = store.mark_uncertain(leased.id, "network timeout after submit")
        self.assertEqual(uncertain.state, JobState.uncertain)
        self.assertEqual(store.cancel(leased.id).state, JobState.uncertain)


class ComfyPortTests(unittest.TestCase):
    def test_tagged_binding_ported_from_spike(self):
        graph = {"1": {"class_type": "CLIPTextEncode", "_meta": {"title": "Positive [mio:prompt=text]"}, "inputs": {"text": "old"}},
                 "2": {"class_type": "SaveImage", "_meta": {"title": "Out [mio:output]"}, "inputs": {"images": ["1", 0]}}}
        resolved, problems = bindings.resolve(graph)
        self.assertEqual(problems, [])
        final = bindings.apply_values(graph, resolved, {"prompt": "new"})
        self.assertEqual(final["1"]["inputs"]["text"], "new")


if __name__ == "__main__":
    unittest.main()
