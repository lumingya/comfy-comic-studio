import copy
import json
from pathlib import Path
import unittest
from backend.ecosystem import workflow_slots as slots
from backend.mio_library import LibraryError


def pick(resolved):
    return {'model': {k: resolved['model'][k] for k in ('enabled', 'nodeId', 'path', 'kind')},
            'lora': {k: resolved['lora'][k] for k in ('mode', 'nodeId', 'path', 'assumed')}}


class WorkflowSlotsTests(unittest.TestCase):
    def test_shared_contract(self):
        fixtures = json.loads((Path(__file__).parent / 'fixtures/workflow_slots_contract.json').read_text())
        for fixture in fixtures:
            with self.subTest(fixture=fixture['name']):
                before = copy.deepcopy(fixture['workflow'])

                def run():
                    return slots.apply(fixture['workflow'], fixture.get('slots') or {}, fixture['overrides'],
                                       fixture.get('objectInfo') or {}, fixture.get('positive'))
                if fixture['error']:
                    with self.assertRaises(LibraryError):
                        run()
                else:
                    result = run()
                    self.assertEqual(pick(result['slots']), fixture['expectedSlots'])
                    self.assertEqual(result['workflow'], fixture['expectedWorkflow'])
                    self.assertEqual(len(result['notices']), fixture['expectedNotices'])
                    self.assertEqual({'model': slots.current_model(fixture['workflow'], result['slots']),
                                      'loras': slots.current_loras(fixture['workflow'], result['slots'])},
                                     fixture['expectedCurrent'])
                self.assertEqual(fixture['workflow'], before)

    def test_catalog_from_object_info(self):
        catalog = slots.catalog_from_object_info({
            'CheckpointLoaderSimple': {'input': {'required': {'ckpt_name': [['b.safetensors', 'a.safetensors']]}}},
            'Checkpoint Loader with Name (Image Saver)': {'input': {'required': {'ckpt_name': [['c.safetensors', 'a.safetensors']]}}},
            'UNETLoader': {'input': {'required': {'unet_name': [['flux.safetensors']], 'weight_dtype': [['default', 'fp8']]}}},
            'LoraLoader': {'input': {'required': {'lora_name': [['None', 'x.safetensors']]}}},
            'Broken': {'input': {'required': {'lora_name': ['STRING']}}},
        })
        self.assertEqual(catalog, {'checkpoints': ['a.safetensors', 'b.safetensors', 'c.safetensors'],
                                   'unets': ['flux.safetensors'], 'loras': ['x.safetensors'], 'vaes': []})

    def test_tag_formatting_matches_browser(self):
        self.assertEqual(slots.format_tag({'name': 'sub\\Cool Style.safetensors', 'strength': 0.85}, 'stem'), '<lora:Cool Style:0.85>')
        self.assertEqual(slots.format_tag({'name': 'x.safetensors', 'strength': 1, 'clip': 0.5}, 'stem'), '<lora:x:1:0.5>')
        self.assertEqual(slots.number_text(0.1 + 0.2), '0.3')
        parsed = slots.parse_lora_syntax('hello <lora:a:0.5> world, <lora:b:1:0.7>')
        self.assertEqual(parsed['loras'], [{'name': 'a', 'strength': 0.5}, {'name': 'b', 'strength': 1, 'clip': 0.7}])
        self.assertEqual(parsed['text'], 'hello world')

    def test_describe_overrides(self):
        self.assertEqual(slots.describe_overrides({'model': 'Illustrious\\wai.safetensors', 'loras': [{'name': 'a.safetensors', 'strength': 0.8}]}),
                         'wai · LoRA · a ×0.8')
        self.assertEqual(slots.describe_overrides({'loras': []}), 'LoRA · 无')
        self.assertEqual(slots.describe_overrides({}), '')
