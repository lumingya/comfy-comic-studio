"""Authoritative per-page edits, CAS, late generation, restart and original retention."""
import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from backend.mio_jobs import Jobs, Conflict
from backend import mio_pictures as pictures
from backend import mio_foundation
from backend import server

PNG=bytes.fromhex('89504e470d0a1a0a0000000d494844520000006400000050')
RECIPE={'version':1,'crop':{'x':0,'y':0,'w':1,'h':1},'rotation':0,'flipX':False,'flipY':False,'brightness':1,'contrast':1,'saturation':1,'layers':[]}
class PictureTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.addCleanup(server.reset_native_stores);self.root=self.tmp.name
        library=__import__('backend.mio_library',fromlist=['*']).FileLibrary(self.root);self.addCleanup(library.close)
        self.calls=[];self.store=Jobs(str(Path(self.root)/'runtime'/'execution'),lambda f:self.calls.append(f) or {'image':'/images/late.png'});self.store.close();self.addCleanup(self.store.close)
        self.config={'savedGalleries':[{'id':'album','totalSteps':2,'generatedSteps':2,'status':'complete','steps':[{'stepIndex':i,'name':'scene','caption':'keep caption','prompt':'keep prompt','image':'/images/original.png'} for i in range(2)]}],'batchRunState':{'queue':[]}}
        for name in ['original.png','edited.png','late.png']:Path(self.root,name).write_bytes(PNG)
        self.host=SimpleNamespace(DATA_DIR=self.root,CONFIG_LOCK=threading.RLock(),read_merged_config=lambda:pictures.project(copy.deepcopy(self.config),self.root),local_path_from_url=lambda url:str(Path(self.root)/url.split('/')[-1]),detect_image_mime_type=lambda header:'image/png')
    def mutate(self,action='save',index=0,**extra):
        current=self.host.read_merged_config()['savedGalleries'][0];old=current.get('pictureEdits',{}).get(str(index),{})
        return pictures.mutate(self.host,self.store,{'albumId':'album','index':index,'action':action,'expectedRevision':old.get('revision',0),'expectedImage':current['steps'][index]['image'],**({'image':'/images/edited.png','sourceImage':'/images/original.png','recipe':RECIPE} if action=='save' else {}),**extra})['edit']
    def test_original_recipe_and_edited_raster_survive_restart(self):
        saved=self.mutate();self.assertEqual(saved['originalImage'],'/images/original.png');self.assertEqual(saved['width'],100)
        self.store=Jobs(str(Path(self.root)/'runtime'/'execution'),lambda f:None);self.store.close()
        record=pictures.records(self.root)[0];self.assertEqual(record['recipe'],RECIPE);self.assertEqual(record['image'],'/images/edited.png')
    def test_remove_restore_and_storyboard_retention(self):
        self.mutate();self.mutate('remove');book=self.host.read_merged_config()['savedGalleries'][0]
        self.assertEqual(book['steps'][0]['image'],'');self.assertEqual(book['steps'][0]['caption'],'keep caption');self.assertEqual(book['totalSteps'],2)
        self.assertEqual(book['steps'][1]['image'],'/images/original.png');self.assertEqual(book['generatedSteps'],1)
        restored=self.mutate('restore');self.assertEqual(restored['image'],'/images/original.png');self.assertIsNone(restored['recipe']);self.assertEqual(self.calls,[])
    def test_page_cas_rejects_both_revision_and_base_image_conflicts(self):
        self.mutate()
        with self.assertRaises(Conflict):self.mutate('remove',expectedRevision=0)
        with self.assertRaises(Conflict):self.mutate('remove',expectedImage='/images/late.png')
        self.assertEqual(pictures.records(self.root)[0]['revision'],1)
    def test_stale_split_writer_cannot_resurrect_or_drop_layers(self):
        self.mutate();self.mutate('remove')
        files={key:str(Path(self.root)/key/'state.json') for key in server.CONFIG_FILES}
        with patch.multiple(server,DATA_DIR=self.root,CONFIG_FILES=files,LEGACY_CONFIG_FILES={},LEGACY_DATA_FILE=str(Path(self.root)/'missing')):
            full={key:kind() for key,kind in server.REQUIRED_CONFIG_FIELDS.items()};full.update(copy.deepcopy(self.config));
            import base64
            url=server.store_image_data('data:image/png;base64,'+base64.b64encode(PNG).decode())
            text=json.dumps(full).replace('/images/original.png',url);full=json.loads(text)
            with self.store.connect() as db:
                for row in db.execute('SELECT album,idx,record FROM picture_edits').fetchall():db.execute('UPDATE picture_edits SET record=? WHERE album=? AND idx=?',(row['record'].replace('/images/original.png',url).replace('/images/edited.png',url),row['album'],row['idx']))
            server.write_split_config(full);loaded=server.read_merged_config()['savedGalleries'][0]
            self.assertEqual(loaded['steps'][0]['image'],'');self.assertEqual(loaded['pictureEdits']['0']['recipe'],RECIPE)
    def test_slow_late_generation_result_never_replaces_removed_image(self):
        job=self.store.submit({'albumId':'album','frames':[{'config':{'provider':'openai'},'albumId':'album','prompt':'late','frameIndex':0}]},'late')
        row=self.store.claim();self.mutate('remove');self.store.execute_row(row)
        self.config['batchRunState']['queue']=[{'id':'queue','serverId':job['id'],'bookId':'album','indices':[0],'serverIndices':[0],'serverMeta':[{'name':'late','caption':'different','prompt':'different'}]}]
        projected=mio_foundation.project_execution(self.host,self.host.read_merged_config())['savedGalleries'][0]
        self.assertEqual(projected['steps'][0]['image'],'');self.assertEqual(projected['steps'][0]['caption'],'keep caption');self.assertTrue(self.store.get(job['id'])['results'])
        self.assertEqual(len(self.calls),1) # Existing request, no extra generation triggered by removal.
    def test_local_replacement_fences_late_results(self):
        self.mutate();projected=self.host.read_merged_config()['savedGalleries'][0]
        self.assertEqual(projected['steps'][0]['image'],'/images/edited.png');self.assertEqual(projected['pictureEdits']['0']['originalImage'],'/images/original.png')
    def test_album_tombstone_wins_over_page_edit(self):
        self.mutate();self.store.delete_albums(['album'])
        with self.assertRaises(Conflict):self.mutate('restore')
    def test_change_cursor_and_revision_are_monotonic(self):
        a=self.mutate();b=self.mutate('remove');c=self.mutate('restore',index=1)
        edits=pictures.records(self.root,a['seq']);self.assertEqual([r['seq'] for r in edits],[b['seq'],c['seq']]);self.assertEqual(b['revision'],2)
    def test_recipe_limits_reject_executable_field_injection(self):
        for updates in [{'crop':{'x':0,'y':0,'w':2,'h':1}},{'rotation':45},{'brightness':float('inf')},{'layers':[{'kind':'text','x':0,'y':0,'w':1,'h':1,'fontSize':'\" autofocus onfocus=alert(1)'}]}]:
            with self.assertRaises(ValueError):self.mutate(recipe={**RECIPE,**updates})
        self.assertEqual(pictures.records(self.root),[])
    def test_original_and_stickers_are_referenced_even_before_json_save(self):
        self.mutate();refs=self.store.references();self.assertIn('/images/original.png',json.dumps(refs));self.assertIn('/images/edited.png',json.dumps(refs))
    def test_visual_commit_does_not_increment_workspace_revision(self):
        self.config['updatedAt']=100;self.mutate();self.assertEqual(self.host.read_merged_config()['updatedAt'],100)

if __name__=='__main__':unittest.main()
