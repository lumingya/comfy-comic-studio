"""Distribution initialization is not a deleted-content restoration mechanism."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from mio_native_store import NativeStore
from mio_library import FileLibrary
from mio_content import initialize, bootstrap
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
            project=Path(temp);data=project/'data';shutil.copytree(ROOT/'data',data,ignore=shutil.ignore_patterns('runtime','.cache','.write.lock'))
            for name in ('albums','layouts','storyboards','presets','settings','collections','plans','records','workflows'):shutil.rmtree(data/name,ignore_errors=True)
            s=self.store(data,project);initialize(s,project)
            values=bootstrap(s);self.assertEqual(values['config']['savedGalleries'],[]);self.assertEqual(values['layouts'],[])
            self.assertFalse(any((data/'albums').rglob('album.json')));s.library.close()
