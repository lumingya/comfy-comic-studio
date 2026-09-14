import base64
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from mio_native_store import NativeStore
from mio_library import LibraryError
from mio_resource_sharing import export_document, inspect_resource, import_resource

ROOT=Path(__file__).resolve().parents[1]

class ResourceSharingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.store=NativeStore(self.temp.name,ROOT);self.store.wait_index()
        self.store.library.put('collections',{'id':'project','title':'目标画册集'},create=True,allocate_id=False)
        self.addCleanup(self.store.library.db.close)
        self.png=(ROOT/'examples/afterglow/cover.webp').read_bytes()
        self.uri='data:image/webp;base64,'+base64.b64encode(self.png).decode()
    def snapshot(self):
        return {p.relative_to(self.temp.name).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(self.temp.name).rglob('*.json')}
    def preset(self):
        return {'id':'source','title':'中文角色设定','entries':[{'id':'v','key':'主角参考图','type':'image','value':{'kind':'mio-image','src':self.uri,'name':'主角'}}]}
    def packed(self):
        raw=export_document(self.store,'characters',self.preset())
        return {'zip':base64.b64encode(raw).decode(),'expectedKind':'variables','projectId':'project'},raw
    def test_export_and_inspection_do_not_create_resources(self):
        before=self.snapshot();body,raw=self.packed();kind,doc,assets=inspect_resource(self.store,body)
        self.assertEqual(self.snapshot(),before);self.assertEqual(kind,'characters');self.assertEqual(list(assets.values()),[self.png]);self.assertEqual(doc['entries'][0]['key'],'主角参考图')
        self.assertEqual(len(assets),1)
    def test_import_twice_makes_independent_ids_and_owned_images(self):
        body,raw=self.packed();a=import_resource(self.store,body);b=import_resource(self.store,body)
        self.assertNotEqual(a['id'],b['id']);one=self.store.library.get('characters',a['id'])['document'];two=self.store.library.get('characters',b['id'])['document']
        self.assertNotEqual(one['entries'][0]['id'],two['entries'][0]['id']);ref=one['entries'][0]['value']['src'];self.assertEqual(self.store.library.asset('characters',a['id'],ref)[0],self.png)
    def test_wrong_page_rejected_before_writes(self):
        body,raw=self.packed();body['expectedKind']='storyboards';before=self.snapshot()
        with self.assertRaises(LibraryError):import_resource(self.store,body)
        self.assertEqual(before,self.snapshot())
    def test_plain_storyboard_gets_new_frame_id(self):
        body={'document':{'title':'旧式独立分镜','frames':[{'id':'old','name':'一幕','prompt':'中文提示词','caption':''}]},'expectedKind':'storyboards','projectId':'project'}
        result=import_resource(self.store,body);doc=self.store.library.get('storyboards',result['id'])['document']
        self.assertNotEqual(doc['frames'][0]['id'],'old');self.assertEqual(doc['projectId'],'project')
    def test_corrupt_checksum_rejected(self):
        body,raw=self.packed();z=zipfile.ZipFile(io.BytesIO(raw));files={n:z.read(n) for n in z.namelist()};files['resource.json']=files['resource.json'].replace('中文'.encode(),'错误'.encode());out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as target:
            for n,v in files.items():target.writestr(n,v)
        body['zip']=base64.b64encode(out.getvalue()).decode();before=self.snapshot()
        with self.assertRaises(LibraryError):import_resource(self.store,body)
        self.assertEqual(before,self.snapshot())
    def test_bad_variable_types_and_remote_images_rejected(self):
        for entry in [{'key':'a','type':'number','value':'NaN'},{'key':'a','type':'boolean','value':'maybe'},{'key':'a','type':'json','value':'{oops'},{'key':'a','type':'image','value':{'kind':'mio-image','src':'https://example.invalid/a.png'}}]:
            body={'document':{'title':'坏文件','entries':[entry]},'expectedKind':'variables','projectId':'project'}
            with self.assertRaises(LibraryError):import_resource(self.store,body)
    def test_services_tasks_and_settings_cannot_be_imported_here(self):
        for kind in ['tasks','settings','conversations','rows']:
            with self.assertRaises(LibraryError):inspect_resource(self.store,{'document':{'kind':kind,'title':'不应导入','id':'x'}})
    def test_reserved_nested_keys_rejected(self):
        with self.assertRaises(LibraryError):inspect_resource(self.store,{'document':{'title':'无效','entries':[{'key':'x','type':'json','value':{'__proto__':{}}}]}})

    def album(self):
        return {'id':'old_album','title':'独立分享','steps':[{'stepIndex':0,'image':self.uri,'caption':'保留台词'}],
                'totalSteps':1,'pictureEdits':{'0':{'layers':[],'originalImage':self.uri}},
                'sourceSnapshot':{'execution':{'key':'NEVER_SHARE'},'row':{'私密':'不应默认带出'}},
                'sharedSources':{'storyboard':{'title':'源分镜','frames':[{'id':'old_frame','prompt':'{地点}','name':'一幕','caption':'台词'}]},
                                 'variables':{'title':'源设定','entries':[{'id':'old_var','key':'地点','type':'text','value':'庭院'}, {'id':'old_image','key':'参考','type':'image','value':{'kind':'mio-image','src':self.uri}}],
                                              'frames':{'0':[{'id':'old_override','key':'地点','type':'text','value':'雨中庭院'}]}}}}
    def test_all_native_export_import_consent_combinations(self):
        for export_story in (False,True):
            for export_vars in (False,True):
                doc=self.album()
                if not export_story:doc['sharedSources'].pop('storyboard')
                if not export_vars:doc['sharedSources'].pop('variables')
                raw=export_document(self.store,'albums',doc)
                with zipfile.ZipFile(io.BytesIO(raw)) as z:
                    encoded=z.read('resource.json').decode();self.assertNotIn('NEVER_SHARE',encoded);self.assertNotIn('不应默认带出',encoded)
                    self.assertEqual('源分镜' in encoded,export_story);self.assertEqual('源设定' in encoded,export_vars)
                body={'zip':base64.b64encode(raw).decode(),'expectedKind':'albums','projectId':'project'}
                before=self.snapshot();inspect_resource(self.store,body);self.assertEqual(before,self.snapshot())
                for story in (False,True):
                    for variables in (False,True):
                        counts={k:self.store.library.catalog(k)['total'] for k in ('albums','storyboards','characters','plans')}
                        result=import_resource(self.store,{**body,'include':{'storyboards':story,'variables':variables}})
                        self.assertNotEqual(result['id'],'old_album')
                        for k,extra in [('albums',1),('storyboards',story and export_story),('characters',variables and export_vars),('plans',story and export_story)]:
                            self.assertEqual(self.store.library.catalog(k)['total'],counts[k]+int(extra))
                        album=self.store.library.get('albums',result['id'])['document'];self.assertEqual(album['steps'][0]['caption'],'保留台词')
                        self.assertIn('pictureEdits',album);self.assertNotIn('sharedSources',album)
                        self.assertEqual(self.store.library.asset('albums',result['id'],album['steps'][0]['image'])[0],self.png)
                        if variables and export_vars:
                            preset=self.store.library.get('characters',album['importedVariableSetIds'][0])['document']
                            self.assertEqual(preset['frames']['0'][0]['value'],'雨中庭院');self.assertNotEqual(preset['frames']['0'][0]['id'],'old_override')
                        if story and export_story:
                            template=self.store.library.get('storyboards',album['templateId'])['document'];self.assertNotEqual(template['frames'][0]['id'],'old_frame')
                            plans=self.store.library.catalog('plans')['items'];plan=next(self.store.library.get('plans',x['id'])['document'] for x in plans if self.store.library.get('plans',x['id'])['document'].get('rowId')==album['rowId'])
                            self.assertFalse(plan['enabled']);self.assertEqual(plan['templateId'],template['id']);self.assertEqual(len(plan['variableSetIds']),int(variables and export_vars))
                            if variables and export_vars:self.assertIn(template['frames'][0]['id'],plan['sceneOverrides'])
    def test_json_sources_require_independent_consent_and_are_not_overwritten(self):
        doc=self.album();doc['steps'][0]['image']='';doc.pop('pictureEdits');doc['sharedSources']['variables']['entries']=doc['sharedSources']['variables']['entries'][:1]
        body={'document':doc,'expectedKind':'albums','projectId':'project'}
        before=self.snapshot();inspect_resource(self.store,body);self.assertEqual(before,self.snapshot())
        result=import_resource(self.store,body);self.assertNotIn('templateId',self.store.library.get('albums',result['id'])['document'])
        prior=self.snapshot();import_resource(self.store,{**body,'include':{'storyboards':True,'variables':True}})
        current=self.snapshot();self.assertTrue(all(current[k]==v for k,v in prior.items() if k!='runtime/revision.json'))
    def test_invalid_sources_choices_or_svg_fail_without_any_resource_write(self):
        doc=self.album();raw=export_document(self.store,'albums',doc)
        body={'zip':base64.b64encode(raw).decode(),'projectId':'project'}
        for include in ([],{'storyboards':'yes'},{'variables':1}):
            before=self.snapshot()
            with self.assertRaises(LibraryError):import_resource(self.store,{**body,'include':include})
            self.assertEqual(before,self.snapshot())
        for value in ([123], [{'key':'bad','type':'image','value':'https://never-fetch.invalid'}]):
            doc=self.album();doc['sharedSources']['variables']['entries']=value;before=self.snapshot()
            with self.assertRaises(LibraryError):export_document(self.store,'albums',doc)
            self.assertEqual(before,self.snapshot())
        doc=self.album();doc['steps'][0]['image']='data:image/svg+xml;base64,'+base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').decode()
        before=self.snapshot()
        with self.assertRaises(LibraryError):export_document(self.store,'albums',doc)
        self.assertEqual(before,self.snapshot())

    def test_html_import_rejects_malformed_source_frames_without_writes(self):
        from mio_album_html import import_html
        for bad in ([None],[{'prompt':7}],[{'prompt':'文本','renderOverride':{}}]):
            payload={'schema':'mio.album-html.v1','books':[{'album':{'title':'画册','steps':[{'stepIndex':0,'image':''}]},'storyboard':{'title':'坏分镜','frames':bad}}]}
            body={'projectId':'project','html':'<script type="application/json" id="mio-album-data">'+json.dumps(payload)+'</script>','include':{'storyboards':True}}
            before=self.snapshot()
            with self.assertRaises(LibraryError):import_html(self.store,body)
            self.assertEqual(before,self.snapshot())
    def test_html_import_ignores_scripts_and_rejects_external_assets(self):
        from mio_album_html import import_html,inspect
        payload={'schema':'mio.album-html.v1','books':[{'album':{'title':'只读数据','steps':[{'stepIndex':0,'image':{'$mioImage':'a'}}]}}]}
        html='<script>location="https://never-fetch.invalid"</script><script type="application/json" id="mio-album-data">'+json.dumps(payload)+'</script><img data-mio-asset="a" src="'+self.uri+'">'
        body={'html':html,'projectId':'project'};before=self.snapshot();self.assertEqual(inspect(self.store,body)['images'],1);self.assertEqual(before,self.snapshot())
        for replacement in ('https://never-fetch.invalid/image.png','file:///private.png','data:image/svg+xml;base64,'+base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').decode()):
            with self.assertRaises(LibraryError):import_html(self.store,{**body,'html':html.replace(self.uri,replacement)})
            self.assertEqual(before,self.snapshot())
