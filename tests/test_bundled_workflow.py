"""The shipped “Anime · 基础图像管线” workflow writes each scene's seed, so a book never renders from one fixed seed."""
import json
import unittest
from pathlib import Path

from backend.ecosystem.workflow import compile_workflow
from backend.production.api import frame_seed, seed_binding_ready

ROOT = Path(__file__).resolve().parents[1]
BUNDLED = next((ROOT / 'data' / 'workflows').glob('*9399e1242916.json'))


class BundledWorkflowSeed(unittest.TestCase):
    def setUp(self):
        self.entry = json.loads(BUNDLED.read_text(encoding='utf-8'))

    def compile(self, seed):
        options = {'seed': seed, 'negative': '', 'outputNodeId': self.entry['outputNodeId']}
        return compile_workflow(self.entry['workflow'], self.entry['bindings'], 'a girl on a train', options, [])

    def test_seed_mapping_is_ready(self):
        self.assertTrue(seed_binding_ready(self.entry))
        seeds = [b for b in self.entry['bindings'] if b.get('value') == 'seed']
        self.assertEqual([(b['nodeId'], b['path'], b['source']) for b in seeds], [('3', 'seed', 'sceneParameter')])

    def test_reproducible_seed_is_base_plus_scene_index(self):
        snapshot = {'seedEnabled': True, 'seed': 100}
        seeds = [self.compile(frame_seed(snapshot, index))['3']['inputs']['seed'] for index in range(3)]
        self.assertEqual(seeds, [100, 101, 102])

    def test_without_the_switch_every_scene_gets_a_fresh_seed(self):
        seeds = {self.compile(frame_seed({}, index))['3']['inputs']['seed'] for index in range(6)}
        self.assertEqual(len(seeds), 6)
        self.assertNotIn(self.entry['workflow']['3']['inputs']['seed'], seeds)

    def test_prompt_still_reaches_the_positive_node(self):
        self.assertEqual(self.compile(7)['6']['inputs']['text'], 'a girl on a train')


if __name__ == '__main__':
    unittest.main()
