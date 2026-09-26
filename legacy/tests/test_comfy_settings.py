"""settings/comfy.json stores intent only; workflows and the node cache live elsewhere."""
import copy
import json
import shutil
import tempfile
import unittest
from tests.data_support import copy_shipped_data
from pathlib import Path

from backend import mio_comfy_settings as comfy
from backend.mio_native_store import NativeStore

ROOT = Path(__file__).resolve().parents[1]
GRAPH = {'6': {'class_type': 'CLIPTextEncode', 'inputs': {'text': 'hello'}},
         '9': {'class_type': 'SaveImage', 'inputs': {'images': ['8', 0]}}}
INFO = {'CLIPTextEncode': {'input': {'required': {'text': ['STRING', {}]}}}}
CATALOG = {'checkpoints': ['a.safetensors'], 'unets': [], 'loras': [], 'vaes': [], 'fetchedAt': 1, 'nodeClasses': 1}


def flat(**extra):
    return {'mode': 'real', 'autoFallback': False, 'baseUrl': 'http://127.0.0.1:8188', 'activeWorkflowId': 'wf_a',
            'workflow': GRAPH, 'workflowTitle': 'A', 'mapping': {}, 'bindings': [], 'bindingVersion': 1,
            'outputNodeId': '9', 'randomizeSeeds': False, 'slots': {}, 'objectInfo': INFO, 'modelCatalog': CATALOG, **extra}


class SplitHydrateTests(unittest.TestCase):
    def test_split_keeps_intent_and_moves_machine_data_to_the_cache(self):
        stored, cache = comfy.split(flat(slotPresets=[{'id': 'p', 'title': '常用', 'rows': []}], extension={'x': 1}))
        self.assertEqual(stored, {'schema': comfy.SCHEMA, 'baseUrl': 'http://127.0.0.1:8188', 'activeWorkflowId': 'wf_a',
                                  'slotPresets': [{'id': 'p', 'title': '常用', 'rows': []}], 'extension': {'x': 1}})
        self.assertEqual(cache, {'objectInfo': INFO, 'modelCatalog': CATALOG})
        self.assertTrue(comfy.is_lean(stored))

    def test_split_without_cache_fields_leaves_the_cache_alone(self):
        stored, cache = comfy.split({'baseUrl': 'http://gpu:8188', 'activeWorkflowId': 'wf_a'})
        self.assertIsNone(cache)
        self.assertEqual(stored['baseUrl'], 'http://gpu:8188')

    def test_hydrate_rebuilds_the_flat_view_from_the_active_workflow(self):
        workflows = [{'id': 'wf_b', 'title': 'B', 'workflow': {'1': {'class_type': 'X', 'inputs': {}}}},
                     {'id': 'wf_a', 'title': 'A', 'workflow': GRAPH, 'bindings': [{'id': 'b1'}], 'outputNodeId': '9',
                      'randomizeSeeds': True, 'slots': {'plan': {'version': 3}}, 'mapping': {'positive': '6'}}]
        view = comfy.hydrate({'schema': comfy.SCHEMA, 'baseUrl': 'http://gpu:8188', 'activeWorkflowId': 'wf_a'},
                             workflows, {'objectInfo': INFO, 'modelCatalog': CATALOG})
        self.assertEqual(view['workflow'], GRAPH)
        self.assertEqual((view['workflowTitle'], view['outputNodeId'], view['randomizeSeeds']), ('A', '9', True))
        self.assertEqual(view['bindings'], [{'id': 'b1'}])
        self.assertEqual(view['slots'], {'plan': {'version': 3}})
        self.assertEqual((view['mode'], view['autoFallback'], view['baseUrl']), ('real', False, 'http://gpu:8188'))
        self.assertEqual((view['objectInfo'], view['modelCatalog']), (INFO, CATALOG))
        self.assertNotIn('schema', view)

    def test_missing_active_workflow_falls_back_to_the_first_one(self):
        view = comfy.hydrate({'activeWorkflowId': 'gone'}, [{'id': 'wf_b', 'title': 'B', 'workflow': GRAPH}], None)
        self.assertEqual((view['activeWorkflowId'], view['workflowTitle']), ('wf_b', 'B'))

    def test_legacy_flat_file_is_its_own_view(self):
        legacy = flat()
        view = comfy.hydrate(legacy, [{'id': 'wf_a', 'title': 'Other title', 'workflow': {}}], None)
        self.assertEqual(view['workflow'], GRAPH)
        self.assertEqual(view['workflowTitle'], 'A')
        self.assertEqual(view['objectInfo'], INFO)

    def test_converter_reference_is_reattached(self):
        view = comfy.hydrate({'baseUrl': 'x', '_workflowRef': 'wf_a', 'bindings': []},
                             [{'id': 'wf_a', 'title': 'A', 'workflow': GRAPH}], None)
        self.assertEqual(view['workflow'], GRAPH)
        self.assertNotIn('_workflowRef', view)

    def test_orphan_graph_is_never_dropped(self):
        self.assertTrue(comfy.needs_inline(flat(activeWorkflowId='wf_missing'), {'wf_a'}))
        self.assertFalse(comfy.needs_inline(flat(), {'wf_a'}))
        stored, _ = comfy.split(flat(activeWorkflowId='wf_missing'), keep_workflow=True)
        self.assertEqual(stored['workflow'], GRAPH)

    def test_invalid_slot_presets_are_dropped(self):
        stored, _ = comfy.split({'slotPresets': [{'title': 'ok', 'rows': []}, 'bad', {'rows': []}, {'title': 1, 'rows': []}]})
        self.assertEqual(stored['slotPresets'], [{'title': 'ok', 'rows': []}])


class CacheFileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_cache_round_trip_is_compact_and_idempotent(self):
        self.assertTrue(comfy.write_cache(self.root, {'objectInfo': INFO, 'modelCatalog': CATALOG}))
        raw = (self.root / comfy.CACHE_FILE).read_bytes()
        self.assertNotIn(b'\n  ', raw)
        self.assertEqual(comfy.read_cache(self.root), {'objectInfo': INFO, 'modelCatalog': CATALOG})
        self.assertFalse(comfy.write_cache(self.root, {'objectInfo': INFO, 'modelCatalog': CATALOG}))

    def test_damaged_or_foreign_cache_reads_as_empty(self):
        path = self.root / comfy.CACHE_FILE
        path.parent.mkdir(parents=True)
        for raw in (b'{', b'[]', json.dumps({'schema': 'other', 'objectInfo': INFO}).encode()):
            path.write_bytes(raw)
            self.assertEqual(comfy.read_cache(self.root), {'objectInfo': {}, 'modelCatalog': {}})

    def test_clearing_the_catalogue_removes_the_file(self):
        comfy.write_cache(self.root, {'objectInfo': INFO, 'modelCatalog': CATALOG})
        self.assertTrue(comfy.write_cache(self.root, {'objectInfo': {}, 'modelCatalog': {}}))
        self.assertFalse((self.root / comfy.CACHE_FILE).exists())


class NativeStoreLayoutTests(unittest.TestCase):
    """The shipped seed workspace: reading and saving never loses a field."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'data'
        copy_shipped_data(self.root)
        self.store = NativeStore(str(self.root), str(ROOT))
        self.store.wait_index()

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def comfy_file(self):
        return json.loads((self.root / 'settings/comfy.json').read_text(encoding='utf-8'))

    def save_comfy(self, document, workflow_changes=()):
        config = self.store.read()
        return self.store.apply(list(workflow_changes), settings_changes=[
            {'name': 'comfy', 'document': document, 'expected': config['_fileRevisions']['settings:comfy']}])

    def test_seed_settings_file_is_lean(self):
        stored = self.comfy_file()
        self.assertEqual(stored.get('schema'), comfy.SCHEMA)
        self.assertTrue(comfy.is_lean(stored), sorted(stored))
        self.assertLess((self.root / 'settings/comfy.json').stat().st_size, 4096)

    def test_read_exposes_the_complete_flat_view(self):
        view = self.store.read()['comfyConfig']
        for key in ('mode', 'baseUrl', 'autoFallback', 'workflow', 'workflowTitle', 'mapping', 'bindings',
                    'outputNodeId', 'randomizeSeeds', 'slots', 'objectInfo', 'modelCatalog', 'activeWorkflowId', 'slotPresets'):
            self.assertIn(key, view)
        active = self.store.entity('workflows', view['activeWorkflowId'], urls=False)['document']
        self.assertEqual(view['workflow'], active['workflow'])
        self.assertEqual(view['workflowTitle'], active['title'])

    def test_saving_the_flat_view_stays_lean_and_round_trips(self):
        before = self.store.read()['comfyConfig']
        document = copy.deepcopy(before)
        document['objectInfo'] = INFO
        document['modelCatalog'] = CATALOG
        result = self.save_comfy(document)
        stored = self.comfy_file()
        self.assertTrue(comfy.is_lean(stored), sorted(stored))
        self.assertEqual(comfy.read_cache(self.root), {'objectInfo': INFO, 'modelCatalog': CATALOG})
        ack = result['settingsDocuments']['comfy']
        self.assertEqual(ack['workflow'], before['workflow'])
        self.assertEqual(ack['objectInfo'], INFO)
        after = self.store.read()['comfyConfig']
        self.assertEqual({k: v for k, v in after.items() if k not in ('objectInfo', 'modelCatalog')},
                         {k: v for k, v in before.items() if k not in ('objectInfo', 'modelCatalog')})

    def test_new_workflow_in_the_same_save_becomes_the_active_reference(self):
        view = self.store.read()['comfyConfig']
        created = {'id': 'wf_created', 'title': '新工作流', 'workflow': GRAPH, 'bindings': [], 'outputNodeId': '9',
                   'mapping': {}, 'randomizeSeeds': False, 'slots': {}}
        result = self.save_comfy({**view, 'activeWorkflowId': 'wf_created', 'workflow': GRAPH, 'workflowTitle': '新工作流'},
                                 [{'kind': 'workflows', 'id': 'wf_created', 'document': created, 'expected': None}])
        stored = self.comfy_file()
        self.assertTrue(comfy.is_lean(stored))
        self.assertEqual(stored['activeWorkflowId'], 'wf_created')
        self.assertEqual(result['settingsDocuments']['comfy']['workflowTitle'], '新工作流')
        self.assertEqual(self.store.read()['comfyConfig']['workflow'], GRAPH)

    def test_reference_to_an_unsaved_workflow_keeps_its_graph(self):
        view = self.store.read()['comfyConfig']
        self.save_comfy({**view, 'activeWorkflowId': 'wf_not_saved', 'workflow': GRAPH, 'workflowTitle': '孤儿'})
        stored = self.comfy_file()
        self.assertEqual(stored['workflow'], GRAPH)
        self.assertEqual(self.store.read()['comfyConfig']['workflow'], GRAPH)

    def test_legacy_flat_directory_is_rewritten_lean_on_next_save(self):
        view = self.store.read()['comfyConfig']
        legacy = {**view, 'mode': 'real', 'autoFallback': False}
        (self.root / 'settings/comfy.json').write_bytes((json.dumps(legacy, ensure_ascii=False, indent=2) + '\n').encode())
        self.store.library.scan(force=True)
        self.assertEqual(self.store.read()['comfyConfig']['workflow'], view['workflow'])
        self.save_comfy(legacy)
        self.assertTrue(comfy.is_lean(self.comfy_file()))

    def test_deleting_active_workflow_does_not_resurrect_it_inline(self):
        view = self.store.read()['comfyConfig']
        active_id = view['activeWorkflowId']
        wf_record = self.store.entity('workflows', active_id, urls=False)
        self.store.apply(
            [],
            removals=[{'kind': 'workflows', 'id': active_id, 'expected': wf_record['etag']}],
            settings_changes=[{'name': 'comfy', 'document': view, 'expected': self.store.settings.get('comfy')['etag']}]
        )
        stored = self.comfy_file()
        self.assertNotIn('workflow', stored)
        self.assertTrue(comfy.is_lean(stored))
        remaining = [r['id'] for r in self.store.records('workflows')]
        if remaining:
            self.assertEqual(stored['activeWorkflowId'], remaining[0])

    def test_ordinary_save_does_not_delete_existing_cache(self):
        comfy.write_cache(self.root, {'objectInfo': INFO, 'modelCatalog': CATALOG})
        self.assertTrue(comfy.cache_path(self.root).is_file())
        view = self.store.read()['comfyConfig']
        # Save with empty objectInfo and modelCatalog
        view['objectInfo'] = {}
        view['modelCatalog'] = {}
        view['baseUrl'] = 'http://127.0.0.1:9999'
        self.save_comfy(view)
        # Cache must remain intact on disk
        self.assertTrue(comfy.cache_path(self.root).is_file())
        self.assertEqual(comfy.read_cache(self.root)['objectInfo'], INFO)

    def test_hydrate_with_no_workflows_provides_contract_defaults(self):
        h = comfy.hydrate({'schema': comfy.SCHEMA, 'baseUrl': 'http://127.0.0.1:8188'}, [], cache=None)
        for field in comfy.WORKFLOW_FIELDS:
            self.assertIn(field, h)
        self.assertEqual(h['workflow'], {})
        self.assertEqual(h['bindings'], [])
        self.assertEqual(h['mapping'], {})




if __name__ == '__main__':
    unittest.main()
