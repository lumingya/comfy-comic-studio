"""Runtime v2 replaces implicit six-file migration; conversion has its own regressions."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import server
from backend.mio_library import LibraryError
from backend.mio_native_store import NativeStore

class StructuredStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=NativeStore(self.tmp.name,Path(server.__file__).parent);self.addCleanup(self.store.library.close)
        self.mock=patch.object(server,'native_store',return_value=self.store);self.mock.start();self.addCleanup(self.mock.stop)
        self.path=patch.object(server,'DATA_DIR',self.tmp.name);self.path.start();self.addCleanup(self.path.stop)
    def test_empty_installation_returns_complete_explicit_contract(self):
        config=server.read_merged_config();self.assertTrue(config['_emptyWorkspace'])
        for key,kind in server.REQUIRED_CONFIG_FIELDS.items():self.assertIsInstance(config[key],kind)
    def test_nested_plans_presets_and_unknown_metadata_round_trip(self):
        config=self.store.read();meta=config['uiConfig']['comfyStudio'];meta['creation'].update(futureProperty='keep',plans=[{'id':'plan','title':'企划','sceneOverrides':{'frame':{'workflowId':'wf','variableSetIds':['preset']}}}],variableSets=[{'id':'preset','title':'主角','category':'characters','entries':[]}]);meta['custom']='keep me'
        original=copy.deepcopy(config);server.write_split_config(config);loaded=server.read_merged_config()
        self.assertEqual(loaded['uiConfig'],original['uiConfig']);self.assertEqual(config,original)
        self.assertTrue(list(Path(self.tmp.name,'presets/characters').glob('*.json')))
        raw=json.loads(Path(self.tmp.name,'settings/workspace.json').read_text());self.assertNotIn('plans',raw['ui']['comfyStudio']['creation'])
    def test_old_formats_require_explicit_conversion_to_another_directory(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root,'content.json');p.write_text('{}')
            with self.assertRaises(LibraryError):NativeStore(root,'.')
            self.assertEqual(p.read_text(),'{}');self.assertEqual([x.name for x in Path(root).iterdir()],['content.json'])
    def test_active_svg_is_rejected_before_it_can_enter_any_album(self):
        import base64
        for raw in [b'<svg onload="alert(1)"/>',b'<svg><script>alert(1)</script></svg>']:
            with self.assertRaises(LibraryError):server.store_image_data('data:image/svg+xml;base64,'+base64.b64encode(raw).decode())

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
