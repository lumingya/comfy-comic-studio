import base64
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from contextlib import ExitStack
from unittest.mock import patch

import server


class StructuredStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = self.temp.name
        self.patches = ExitStack()
        self.addCleanup(self.patches.close)
        self.config = {key: os.path.join(self.root, 'data', key, 'state.json') for key in server.CONFIG_FILES}
        self.legacy = {key: os.path.join(self.root, 'data', key + '.json') for key in server.LEGACY_CONFIG_FILES}
        for name, value in {
            'BASE_DIR': self.root,
            'CONFIG_FILES': self.config,
            'LEGACY_CONFIG_FILES': self.legacy,
            'LEGACY_DATA_FILE': os.path.join(self.root, 'legacy.json'),
            'IMAGES_DIR': os.path.join(self.root, 'data', 'assets', 'images'),
            'LEGACY_IMAGES_DIR': os.path.join(self.root, 'images'),
        }.items():
            self.patches.enter_context(patch.object(server, name, value))
        self.payload = {key: kind() for key, kind in server.REQUIRED_CONFIG_FIELDS.items()}
        self.payload['uiConfig'] = {'custom': 'retained', 'comfyStudio': {
            'projects': [{'id': 'collection-1'}],
            'creation': {'plans': [{'id': 'plan-1', 'workflowId': 'wf-a', 'sceneOverrides': {'scene': {'workflowId': 'wf-b', 'variableSetIds': ['preset-1']}}}],
                         'variableSets': [{'id': 'preset-1', 'entries': []}], 'futureProperty': 'keep'},
            'settings': {'presentation': {'homeLayout': 'showcase'}},
        }}

    def test_empty_installation_returns_complete_explicit_contract(self):
        config = server.read_merged_config()
        self.assertTrue(config['_emptyWorkspace'])
        for key, kind in server.REQUIRED_CONFIG_FIELDS.items():
            self.assertIsInstance(config[key], kind)

    def test_nested_plans_presets_and_unknown_metadata_round_trip(self):
        original = copy.deepcopy(self.payload)
        server.write_split_config(self.payload)
        loaded = server.read_merged_config()
        self.assertEqual(loaded['uiConfig'], original['uiConfig'])
        self.assertEqual(self.payload, original, 'splitting must not mutate the caller')
        self.assertIn('_studioPresets', server.read_json_file(self.config['presets'], {}))
        ui = server.read_json_file(self.config['ui'], {})
        self.assertNotIn('creation', ui['uiConfig']['comfyStudio'])

    def test_legacy_six_file_migration_retains_originals(self):
        for key, path in self.legacy.items():
            server.write_json_file(path, self.payload if key == 'content' else {})
        old = {key: Path(path).read_bytes() for key, path in self.legacy.items()}
        loaded = server.read_merged_config()
        self.assertEqual(loaded['uiConfig'], self.payload['uiConfig'])
        self.assertTrue(all(os.path.isfile(path) for path in self.config.values()))
        for key, path in self.legacy.items():
            with open(path, 'rb') as handle:
                self.assertEqual(handle.read(), old[key])

    def test_incomplete_legacy_migration_refuses_to_erase_data(self):
        server.write_json_file(self.legacy['content'], self.payload)
        with self.assertRaises(server.ConfigReadError):
            server.read_merged_config()
        self.assertFalse(any(os.path.exists(path) for path in self.config.values()))

    def test_interrupted_multi_file_save_recovers_whole_transaction(self):
        server.write_split_config(self.payload)
        changed = copy.deepcopy(self.payload)
        changed['templates'] = [{'id': 'new'}]
        changed['comfyWorkflows'] = [{'id': 'new-workflow'}]
        changed['batchRunState'] = {'queue': [{'id': 'new-task'}]}
        writer = server.write_json_file

        def fail_once(path, value):
            if path == self.config['comfy']:
                raise OSError('simulated disk failure')
            return writer(path, value)

        with patch.object(server, 'write_json_file', side_effect=fail_once):
            with self.assertRaises(OSError):
                server.write_split_config(changed)
        self.assertTrue(os.path.isfile(server.transaction_path()))
        recovered = server.read_merged_config()
        for key in ('templates', 'comfyWorkflows', 'batchRunState'):
            self.assertEqual(recovered[key], changed[key])
        self.assertFalse(os.path.exists(server.transaction_path()))

    def test_album_assets_deduplicate_and_use_portable_relative_urls(self):
        data = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()
        first = server.store_image_data(data, 'album-1')
        second = server.store_image_data(data, 'album-1')
        self.assertEqual(first, second)
        self.assertTrue(first.startswith('/images/albums/album-1/'))
        self.assertTrue(server.is_public_static_path(first))
        self.assertTrue(os.path.isfile(server.local_path_from_url(first)))
        self.assertEqual(server.local_path_from_url(first), server.local_path_from_url(f'http://127.0.0.1:{server.PORT}' + first))

    def test_old_image_links_continue_to_resolve(self):
        os.makedirs(server.LEGACY_IMAGES_DIR)
        file = os.path.join(server.LEGACY_IMAGES_DIR, 'old.png')
        with open(file, 'wb') as handle:
            handle.write(b'\x89PNG\r\n\x1a\n')
        self.assertEqual(server.local_path_from_url('/images/old.png'), file)
        self.assertTrue(server.is_public_static_path('/images/old.png'))

    def test_asset_traversal_and_svg_are_rejected(self):
        png = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\n').decode()
        for value in ('../settings', '/tmp', 'a/b', '..', 'a\\b'):
            with self.assertRaises(ValueError):
                server.store_image_data(png, value)
        svg = 'data:image/svg+xml;base64,' + base64.b64encode(b'<svg onload="alert(1)"/>').decode()
        with self.assertRaises(ValueError):
            server.store_image_data(svg)
        self.assertFalse(server.is_public_static_path('/images/../../settings/comfy.json'))


if __name__ == '__main__':
    unittest.main()


class ReleaseDefaultsTests(unittest.TestCase):
    def test_release_defaults_use_real_services_and_complete_api_graph(self):
        from tools.build_release import get_v9_pure_default_data
        content, ui, chat, comfy, llm, xml = get_v9_pure_default_data()
        merged = {}
        for part in (content, ui, chat, comfy, llm, xml):
            merged.update(part)
        server.validate_config_payload(merged)
        cfg = comfy['comfyConfig']
        self.assertEqual(cfg['mode'], 'real')
        self.assertFalse(cfg['autoFallback'])
        self.assertEqual(cfg['workflow']['9']['class_type'], 'SaveImage')
        self.assertEqual(cfg['workflow']['6']['inputs']['clip'], ['4', 1])
        self.assertEqual(llm['llmConfig']['mode'], 'real')
        self.assertEqual(xml['xmlConfig']['mode'], 'real')
        for key in ('comfy', 'llm', 'xml', 'critic'):
            self.assertEqual(ui['uiConfig']['comfyStudio']['settings'][key]['mode'], 'real')
