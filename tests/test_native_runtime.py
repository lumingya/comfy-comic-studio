"""Native runtime reproductions, including real entity/vault transaction failures."""
import base64
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from backend import server
from backend.mio_library import FileLibrary, LibraryError, atomic_write, encode
from backend.mio_native_store import NativeStore, split_dto

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
class NativeRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.store=NativeStore(self.temp.name,Path(server.__file__).parent);self.addCleanup(self.store.library.close)
        self.root=Path(self.temp.name)
    def create(self,kind='storyboards',id='one',**extra):
        doc={'id':id,'title':'独立文件 '+id,**({'frames':[]} if kind=='storyboards' else {'steps':[]} if kind=='albums' else {}),**extra}
        self.store.apply([{'kind':kind,'id':id,'document':doc,'expected':None}]);return self.store.entity(kind,id)
    def change(self,record,**fields):
        return {'kind':record['document'].get('frames') is not None and 'storyboards' or 'albums','id':record['document']['id'],'document':{**record['document'],**fields},'baseline':record['document'],'expected':record['etag']}
    def test_empty_is_explicit_and_wrong_old_directory_is_never_initialized(self):
        self.assertTrue(self.store.read()['_emptyWorkspace'])
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'content.json';p.write_text('{"keep":1}')
            with self.assertRaises(LibraryError):NativeStore(root,'.')
            self.assertEqual(p.read_text(),'{"keep":1}');self.assertFalse((Path(root)/'workspace.json').exists())
    def test_owned_album_copies_all_originals_and_snapshots(self):
        url=self.store.upload('data:image/png;base64,'+base64.b64encode(PNG).decode())
        a=self.create('albums',steps=[{'stepIndex':0,'image':url,'caption':'原对白'}],sourceSnapshot={'frames':[{'prompt':'原提示','_imageInputs':[{'kind':'mio-image','key':'主角参考图','src':url}]}]})
        doc=self.store.library.get('albums','one')['document'];self.assertTrue(doc['steps'][0]['image'].startswith('images/'))
        self.assertEqual(self.store.image_path(a['document']['steps'][0]['image']).read_bytes(),PNG)
        self.assertEqual(doc['sourceSnapshot']['frames'][0]['_imageInputs'][0]['key'],'主角参考图')
        self.assertEqual(self.store.library.asset('albums','one',doc['steps'][0]['image'])[0],PNG)
    def test_bootstrap_does_not_open_album_bodies(self):
        for i in range(50):self.create('albums','book_'+str(i),steps=[{'stepIndex':0,'prompt':'large '*1000,'image':''}])
        original=self.store.library.get
        def checked(kind,id):
            if kind=='albums':raise AssertionError('eager album read')
            return original(kind,id)
        with patch.object(self.store.library,'get',side_effect=checked):result=self.store.read(album_summaries=True)
        self.assertEqual(len(result['savedGalleries']),50);self.assertTrue(all(b['_lazy'] and b['steps']==[] for b in result['savedGalleries']))
    def test_summary_can_never_overwrite_a_body(self):
        self.create('albums');summary=self.store.read(album_summaries=True)['savedGalleries'][0]
        with self.assertRaises(LibraryError):self.store.apply([{'kind':'albums','id':'one','document':summary,'expected':self.store.library.get('albums','one')['etag']}])
    def test_disjoint_edits_rebase_but_same_field_conflicts(self):
        old=self.create();self.store.apply([self.change(old,title='另一页改标题')]);self.store.apply([self.change(old,outline='本页改大纲')])
        doc=self.store.entity('storyboards','one')['document'];self.assertEqual((doc['title'],doc['outline']),('另一页改标题','本页改大纲'))
        with self.assertRaises(LibraryError):self.store.apply([self.change(old,title='过时标题')])
        self.assertEqual(self.store.entity('storyboards','one')['document'],doc)
    def test_absent_unloaded_entities_are_not_implicitly_deleted(self):
        self.create('albums','a');self.create('albums','b');before=self.store.library.get('albums','b')['etag']
        a=self.store.entity('albums','a');self.store.apply([self.change(a,title='only a')]);self.assertEqual(self.store.library.get('albums','b')['etag'],before)
    def test_invalid_settings_abort_the_entire_entity_batch(self):
        a=self.create();before=(self.root/a['file']).read_bytes()
        with self.assertRaises(LibraryError):self.store.apply([self.change(a,title='must not commit')],settings_changes=[{'name':'llm','expected':None,'document':{'baseUrl':'https://x.test/?key=secret','key':'dont-leak'}}])
        self.assertEqual((self.root/a['file']).read_bytes(),before);self.assertFalse((self.root/'settings/secrets.json').exists())
    def test_entity_settings_vault_and_deletion_roll_forward_as_one_intent(self):
        a=self.create();b=self.create('storyboards','two');original=self.store.library._apply
        with patch.object(self.store.library,'_apply',side_effect=OSError('controlled crash after commit marker')):
            with self.assertRaises(OSError):self.store.apply([self.change(a,title='committed')],[{'kind':'storyboards','id':'two','expected':b['etag']}],[{'name':'llm','expected':None,'document':{'baseUrl':'https://x.test','key':'PRIVATE_NATIVE_TEST'}}])
        self.assertEqual(len(list((self.root/'.transactions').iterdir())),1)
        self.assertEqual(self.store.entity('storyboards','one')['document']['title'],'committed')
        self.assertEqual(self.store.settings.resolve('llm')['key'],'PRIVATE_NATIVE_TEST')
        self.store.library.scan()
        with self.assertRaises(LibraryError):self.store.entity('storyboards','two')
        self.assertEqual(len(list((self.root/'.transactions').iterdir())),0)
        self.assertNotIn('PRIVATE_NATIVE_TEST',json.dumps(self.store.read()))
    def test_settings_two_writers_merge_and_ack_canonical_values(self):
        self.store.apply([],settings_changes=[{'name':'llm','document':{'baseUrl':'https://x.test','model':'a','timeout':30},'expected':None}]);old=self.store.settings.get('llm')
        self.store.apply([],settings_changes=[{'name':'llm','document':{**old['document'],'model':'b'},'baseline':old['document'],'expected':old['etag']}])
        result=self.store.apply([],settings_changes=[{'name':'llm','document':{**old['document'],'timeout':60},'baseline':old['document'],'expected':old['etag']}])
        self.assertEqual((result['settingsDocuments']['llm']['model'],result['settingsDocuments']['llm']['timeout']),('b',60))
    def test_key_binding_blank_preserve_and_explicit_forget(self):
        def save(doc,**extra):return self.store.apply([],settings_changes=[{'name':'llm','document':doc,'expected':self.store.settings.get('llm')['etag'],**extra}])
        save({'baseUrl':'https://a.test','key':'SECRET_VALUE'})
        save({'baseUrl':'https://a.test','key':''});self.assertEqual(self.store.settings.resolve('llm')['key'],'SECRET_VALUE')
        with self.assertRaises(LibraryError):save({'baseUrl':'https://b.test','key':''})
        save({'baseUrl':'https://b.test','key':''},clearSecrets=['/key']);self.assertEqual(self.store.settings.resolve('llm')['key'],'')
        self.assertNotIn('SECRET_VALUE',(self.root/'settings/secrets.json').read_text())
    def test_undeclared_settings_asset_and_secret_routes_are_rejected(self):
        self.store.apply([],settings_changes=[{'name':'llm','document':{},'expected':None}]);p=self.root/'settings/llm.assets/images/private.png';p.parent.mkdir(parents=True);p.write_bytes(PNG)
        for url in ['/images/library/settings/llm/images/private.png','/images/library/settings/secrets/images/key.png','/images/library/albums/one/../../settings/secrets.json']:
            with self.assertRaises(LibraryError):self.store.image_path(url)
    def test_saved_snapshot_survives_source_preset_deletion(self):
        url=self.store.upload('data:image/png;base64,'+base64.b64encode(PNG).decode());p=self.create('characters',entries=[{'id':'v','key':'主角参考图','type':'image','value':{'kind':'mio-image','src':url}}])
        frozen=self.store.freeze({'images':[p['document']['entries'][0]['value']['src']]});self.store.library.delete('characters','one',p['etag']);self.assertEqual(self.store.image_path(frozen['images'][0]).read_bytes(),PNG)
    def test_copy_file_rescan_and_import_as_new_id_never_replace(self):
        a=self.create();path=self.root/'storyboards/复制来的中文分镜.json';doc=copy.deepcopy(self.store.library.get('storyboards','one')['document']);doc['id']='copied';path.write_bytes(encode(doc));self.store.library.scan();self.assertEqual(self.store.entity('storyboards','copied')['document']['title'],a['document']['title'])
        bundle=self.store.library.export_bundle('storyboards','one');new=self.store.library.import_bundle(bundle);self.assertNotEqual(new['document']['id'],'one');self.assertEqual(self.store.library.get('storyboards','one')['etag'],a['etag'])
    def test_unchanged_internal_writer_preserves_file_mtimes(self):
        self.create();config=self.store.read();self.store.write(config);config=self.store.read();files=list(self.root.rglob('*.json'));before={p:p.stat().st_mtime_ns for p in files};self.store.write(config);self.assertEqual(before,{p:p.stat().st_mtime_ns for p in files})
    def test_disposable_summary_cache_is_rebuilt_after_version_change(self):
        self.create('albums','cache_book',characterName='fresh character')
        with self.store.library.cache_lock:
            self.store.library.db.execute("UPDATE catalog SET summary=?",('{"id":"cache_book","title":"obsolete"}',))
            self.store.library.db.execute('PRAGMA user_version=2')
        self.store.library.close()
        self.store=NativeStore(self.temp.name,Path(server.__file__).parent);self.addCleanup(self.store.library.close)
        book=self.store.read(album_summaries=True)['savedGalleries'][0]
        self.assertEqual(book['characterName'],'fresh character');self.assertNotEqual(book['title'],'obsolete')
    def test_scene_kind_is_authoritative_and_cross_category_ids_do_not_overwrite(self):
        raw={'schema':'mio.resource.v2','kind':'scenes','id':'scene','title':'庭院','entries':[]}
        self.store.wait_index();self.store.library.put('scenes',raw,create=True,allocate_id=False)
        self.assertEqual(self.store.read()['uiConfig']['comfyStudio']['creation']['variableSets'][0]['category'],'scenes')
        with self.assertRaises(LibraryError):self.create('characters','scene',entries=[])
        self.assertEqual(self.store.library.get('scenes','scene')['document'],raw)
    def test_startup_recovers_committed_picture_without_a_provider_request(self):
        import threading
        from types import SimpleNamespace
        from backend import mio_foundation as foundation
        from backend.mio_jobs import Jobs
        url=self.store.upload('data:image/png;base64,'+base64.b64encode(PNG).decode())
        self.create('albums','book',steps=[{'stepIndex':0,'image':url}],totalSteps=1)
        jobs=Jobs(str(self.root/'runtime/execution'),lambda _:self.fail('must not call provider'));self.addCleanup(jobs.close)
        record={'albumId':'book','index':0,'revision':1,'removed':True,'originalImage':url,'image':'','recipe':{}}
        with jobs.connect() as db:db.execute('INSERT INTO picture_edits(album,idx,revision,record) VALUES(?,?,?,?)',('book',0,1,json.dumps(record)))
        receipt=self.store.mark_materialization('book')
        host=SimpleNamespace(DATA_DIR=str(self.root),CONFIG_LOCK=threading.RLock(),native_store=lambda:self.store)
        original=self.store.apply
        with patch.object(self.store,'apply',side_effect=OSError('controlled disk failure')):
            foundation.recover_materializations(host)
        self.assertTrue(receipt.exists());self.assertTrue(self.store.read()['_libraryProblems'])
        self.assertTrue(self.store.entity('albums','book')['document']['steps'][0]['image'])
        foundation.recover_materializations(host)
        self.assertFalse(receipt.exists());self.assertFalse(self.store.read()['_libraryProblems'])
        self.assertEqual(self.store.entity('albums','book')['document']['steps'][0]['image'],'')
    def test_native_restart_pauses_pending_and_second_owner_cannot_change_state(self):
        from backend.mio_jobs import Jobs
        path=str(self.root/'runtime/execution')
        calls=[];jobs=Jobs(path,lambda f:calls.append(f),manual_start=True);self.addCleanup(jobs.close)
        job=jobs.submit({'hold':True,'frames':[{'config':{'provider':'openai','keyMode':'none'},'prompt':'hold','images':[]}]},'hold')
        jobs.close()
        with jobs.connect() as db:
            db.execute("UPDATE settings SET value='false' WHERE key='paused'")
            db.execute("UPDATE jobs SET enabled=1,state='pending' WHERE id=?",(job['id'],))
            db.execute("UPDATE job_frames SET state='pending' WHERE job=?",(job['id'],))
        restarted=Jobs(path,lambda f:calls.append(f),manual_start=True);self.addCleanup(restarted.close)
        self.assertTrue(restarted.list()['paused']);self.assertEqual(restarted.get(job['id'])['enabled'],0)
        with restarted.connect() as db:db.execute("UPDATE settings SET value='false' WHERE key='paused'")
        with self.assertRaises(OSError):Jobs(path,lambda _:None,manual_start=True)
        self.assertFalse(restarted.list()['paused']);self.assertEqual(calls,[])
    def test_tombstone_recovers_failed_file_deletion_without_resubmission(self):
        import threading
        from types import SimpleNamespace
        from backend import mio_foundation as foundation
        from backend.mio_jobs import Jobs
        album=self.create('albums','deleted_book');self.create('tasks','deleted_task',bookId='deleted_book')
        jobs=Jobs(str(self.root/'runtime/execution'),lambda _:self.fail('must not generate'));self.addCleanup(jobs.close)
        jobs.delete_albums(['deleted_book'])
        host=SimpleNamespace(DATA_DIR=str(self.root),CONFIG_LOCK=threading.RLock(),native_store=lambda:self.store)
        with patch.object(self.store.library,'delete',side_effect=OSError('controlled filesystem failure')):
            self.assertTrue(foundation.recover_deletions(host))
        self.assertTrue((self.root/album['file']).exists())
        self.assertFalse(foundation.recover_deletions(host))
        for kind,id in [('albums','deleted_book'),('tasks','deleted_task')]:
            with self.assertRaises(LibraryError):self.store.entity(kind,id)
        self.assertEqual(jobs.list()['deletedAlbumIds'],['deleted_book'])
