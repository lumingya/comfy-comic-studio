"""Distribution initialization is not a deleted-content restoration mechanism."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from tests.data_support import copy_shipped_data
from backend.mio_native_store import NativeStore
from backend.mio_library import FileLibrary
from backend.mio_content import initialize, bootstrap
ROOT=Path(__file__).resolve().parents[1]

class ContentDistributionTests(unittest.TestCase):
    def store(self,root,project=ROOT):
        store=NativeStore(root,project);store.wait_index();self.addCleanup(store.library.close);return store
    def test_genuinely_new_external_workspace_gets_real_shipped_content(self):
        with tempfile.TemporaryDirectory() as temp:
            s=self.store(Path(temp)/'new');self.assertTrue(initialize(s,ROOT))
            self.assertEqual(s.library.catalog('albums')['total'],1)
            self.assertEqual(s.library.catalog('layouts')['total'],7)
            self.assertTrue(bootstrap(s)['cover'].startswith('data:image/webp;base64,'));s.library.close()
    def test_existing_empty_workspace_gets_catalogs_not_resurrected_entities(self):
        with tempfile.TemporaryDirectory() as temp:
            old=FileLibrary(temp);old.close()
            s=self.store(temp);self.assertFalse(initialize(s,ROOT))
            self.assertEqual(s.library.catalog('albums')['total'],0)
            self.assertEqual(s.library.catalog('layouts')['total'],0)
            self.assertTrue((Path(temp)/'catalog/index.json').exists());s.library.close()
    def test_removing_all_shipped_entities_before_first_launch_is_respected(self):
        with tempfile.TemporaryDirectory() as temp:
            project=Path(temp);data=project/'data';copy_shipped_data(data)
            for name in ('albums','layouts','storyboards','presets','settings','collections','plans','records','workflows'):shutil.rmtree(data/name,ignore_errors=True)
            s=self.store(data,project);initialize(s,project)
            values=bootstrap(s);self.assertEqual(values['config']['savedGalleries'],[]);self.assertEqual(values['layouts'],[])
            self.assertFalse(any((data/'albums').rglob('album.json')));s.library.close()
    def test_existing_external_workspace_receives_upgraded_catalog_text_only(self):
        with tempfile.TemporaryDirectory() as temp:
            project=Path(temp)/'program';copy_shipped_data(project/'data')
            workspace=Path(temp)/'workspace';s=self.store(workspace,project);self.assertTrue(initialize(s,project));s.library.close()
            # Simulate a program upgrade: the shipped catalog changes and the manifest is rebuilt; the user meanwhile deleted the demo album.
            captions=project/'data/catalog/captions.json';captions.write_text(json.dumps({'upgraded':True}),'utf-8')
            manifest=json.loads((project/'data/distribution.json').read_text('utf-8'))
            from backend.mio_library import digest
            manifest['files']['catalog/captions.json']=digest(captions.read_bytes());manifest['version']='9.9.9'
            (project/'data/distribution.json').write_text(json.dumps(manifest,ensure_ascii=False),'utf-8')
            for album in (workspace/'albums').iterdir():shutil.rmtree(album)
            s=self.store(workspace,project);self.assertFalse(initialize(s,project))
            self.assertEqual(json.loads((workspace/'catalog/captions.json').read_text('utf-8')),{'upgraded':True})
            self.assertFalse(any((workspace/'albums').rglob('album.json')),'upgrading never resurrects deleted entities')
            self.assertEqual(s.content_problems,[]);s.library.close()
            # A local catalog edit is installed without rebuilding release checksums.
            captions.write_text(json.dumps({'locallyEdited':True}),'utf-8');manifest['version']='9.9.10'
            (project/'data/distribution.json').write_text(json.dumps(manifest,ensure_ascii=False),'utf-8')
            s=self.store(workspace,project);initialize(s,project)
            self.assertEqual(json.loads((workspace/'catalog/captions.json').read_text('utf-8')),{'locallyEdited':True})
            self.assertEqual(s.content_problems,[]);s.library.close()
