import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from backend.production.store import TaskStore

class ProductionStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.store=TaskStore(self.temp.name)
        self.task={'id':'assembly-test','title':'A','snapshot':{'story':{'title':'Story','frames':[{}]}},'prepared':None,'pages':[{'index':0,'state':'complete','result':{'image':'/images/a.png','prompt':'large'},'attempts':[]}]}
    def test_large_history_split_and_light_summary(self):
        self.task['pages'][0]['attempts']=[{'id':str(i),'result':{'image':'/images/a.png','prompt':str(i)+'x'*200000}} for i in range(20)]
        self.store.set(self.task['id'],self.task)
        self.assertEqual(self.store.get(self.task['id']),self.task)
        summary=self.store.get(self.task['id'],summary=True)
        self.assertEqual(summary['pages'][0]['attemptCount'],20);self.assertEqual(len(summary['pages'][0]['attempts']),3)
        self.assertLess(len(json.dumps(summary)),3000)
        manifest=json.loads(self.store.file(self.task['id']).read_text());self.assertIn('pageRefs',manifest);self.assertNotIn('pages',manifest)
    def test_failed_manifest_write_keeps_previous_complete_revision(self):
        self.store.set(self.task['id'],self.task);updated=copy.deepcopy(self.task);updated['title']='Changed';updated['pages'][0]['state']='failed'
        from backend.production import store
        real=store.atomic_write
        def fail(path,raw):
            if path==self.store.file(self.task['id']):raise OSError('commit failure')
            real(path,raw)
        with patch.object(store,'atomic_write',side_effect=fail):
            with self.assertRaises(OSError):self.store.set(self.task['id'],updated)
        self.assertEqual(self.store.get(self.task['id']),self.task)
    def test_unchanged_records_are_deduplicated(self):
        self.store.set(self.task['id'],self.task);before=set(self.store.root.rglob('*.json'));self.store.set(self.task['id'],self.task);self.assertEqual(set(self.store.root.rglob('*.json')),before)
