import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import zipfile
from unittest.mock import patch
from backend.ecosystem.storage import Storage,owned
from backend.ecosystem.packages import unpack,clone
from backend.ecosystem.plugins import Plugins
from backend.ecosystem.themes import Themes
from backend.ecosystem.macros import Macros,graph,run_script,Cancelled
from backend.mio_library import LibraryError

ROOT=Path(__file__).resolve().parents[1]

def zipped(folder):
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w') as z:
        for p in Path(folder).rglob('*'):
            if p.is_file():z.write(p,p.relative_to(folder).as_posix())
    return buffer.getvalue()

class EcosystemTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory(ignore_cleanup_errors=True);self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
    def test_storage_isolation_and_roundtrip(self):
        a,b=Storage(self.root/'a'),Storage(self.root/'b');a.set('prefs',{'font':'serif'})
        self.assertEqual(a.get('prefs'),{'font':'serif'});self.assertIsNone(b.get('prefs'));a.delete('prefs');self.assertIsNone(a.get('prefs'))
        for key in ('../b/prefs','/tmp/x','a/b'):
            with self.assertRaises(LibraryError):a.set(key,1)
    def test_sdk_rejects_symlink_root_and_file(self):
        other=self.root/'outside';other.mkdir();linked=self.root/'linked'
        try:linked.symlink_to(other,target_is_directory=True)
        except OSError as e:
            if getattr(e,'winerror',None)==1314:self.skipTest('Windows non-admin lacks symlink privilege')
            raise
        with self.assertRaises(LibraryError):Storage(linked).set('x',1)
        a=Storage(self.root/'a');a.set('x',1)
        try:(a.root/'leak.json').symlink_to(other/'secret.json')
        except OSError as e:
            if getattr(e,'winerror',None)==1314:self.skipTest('Windows non-admin lacks symlink privilege')
            raise
        with self.assertRaises(LibraryError):a.get('leak')
    def test_zip_rejects_traversal_and_duplicate(self):
        for names in (['../escape'],['/absolute'],['.git/config'],['a','A']):
            raw=io.BytesIO()
            with zipfile.ZipFile(raw,'w') as z:
                for name in names:z.writestr(name,'x')
            with self.assertRaises(LibraryError):unpack(raw.getvalue(),self.root/'stage')
    def test_git_transport_is_argument_only_and_bounded(self):
        with patch('backend.ecosystem.packages.git_command') as cmd:
            clone('https://github.com/author/plugin','dev/test',self.root/'x');args=cmd.call_args.args[0]
            self.assertIn('--no-recurse-submodules',args);self.assertIn('--',args);self.assertIn('--branch',args)
        for url in ('file:///etc','https://token@github.com/x/y','--upload-pack=evil','http://github.com/x/y'):
            with self.assertRaises(LibraryError):clone(url,'',self.root/'x')
    def test_theme_hot_selection_assets_and_uninstall(self):
        manager=Themes(self.root);meta=manager.install(zipped(ROOT/'examples/themes/paper-atelier'),'paper.zip',True)
        css=manager.css(meta['id']);self.assertIn('data:image/png;base64,',css);manager.select(meta['id']);self.assertEqual(manager.list()['active'],meta['id'])
        manager.uninstall(meta['id']);self.assertEqual(manager.list()['active'],'');self.assertFalse((manager.root/meta['id']).exists())
    def test_theme_rejects_remote_css_and_untrusted_install(self):
        manager=Themes(self.root)
        with self.assertRaises(LibraryError):manager.install(b'body{}','a.css')
        for text in ('@import "https://evil/x";','body{background:url(https://evil/x)}','@im\\port "x";'):
            with self.assertRaises(LibraryError):manager.install(text.encode(),'a.css',True)
            self.assertEqual(manager.records(),{})
    def test_plugin_real_worker_storage_disable_and_uninstall(self):
        # Worker imports core from the real project; installed fixture code is kept in a temp code root.
        manager=Plugins(ROOT,self.root/'data');manager.code=self.root/'extensions';self.addCleanup(manager.close)
        raw=zipped(ROOT/'examples/extensions/scene-notebook')
        with self.assertRaises(LibraryError):manager.install(raw=raw)
        meta=manager.install(raw=raw,trusted=True);self.assertTrue(manager.records()[meta['id']]['enabled'])
        manager.call(meta['id'],'POST','/notes',{'title':'Test','text':'kept'})
        self.assertEqual(manager.call(meta['id'],'GET','/notes',{})[0]['text'],'kept')
        manager.enable(meta['id'],False)
        with self.assertRaises(LibraryError):manager.call(meta['id'],'GET','/notes',{})
        manager.uninstall(meta['id'],False);self.assertTrue((self.root/'data/extensions/scene-notebook/workspace/notes.json').exists())
        manager.install(raw=raw,trusted=True);self.assertEqual(manager.call(meta['id'],'GET','/notes',{})[0]['text'],'kept')
        manager.uninstall(meta['id'],True);self.assertFalse((self.root/'data/extensions/scene-notebook').exists());self.assertFalse((manager.code/meta['id']).exists())
    def test_extension_revision_assets_and_conflicts(self):
        manager=Plugins(ROOT,self.root);manager.code=self.root/'code';self.addCleanup(manager.close)
        raw=zipped(ROOT/'examples/extensions/scene-notebook');meta=manager.install(raw=raw,trusted=True)
        rev=manager.records()[meta['id']]['revision'];self.assertTrue(manager.asset(meta['id'],rev+'/index.js').is_file())
        with self.assertRaises(LibraryError):manager.asset(meta['id'],'old/index.js')
        with self.assertRaises(LibraryError):manager.asset(meta['id'],rev+'/plugin.py')
        with self.assertRaises(LibraryError):manager.install(raw=raw,trusted=True)
    @unittest.skipUnless(shutil.which('node'),'Node.js is required')
    def test_macro_ast_dependencies_cycles_syntax(self):
        entries=[{'key':'base','value':'x'},{'key':'portrait','compute':{'script':'// ctx.get("not_real")\nreturn ctx.get("base");'}}]
        _,deps=graph(entries);self.assertEqual(deps['portrait'],{'base'})
        for invalid in ([{'key':'a','compute':{'script':'return ctx.get("a");'}}],[{'key':'a','compute':{'script':'return ctx.get("missing");'}}],[{'key':'a','compute':{'script':'return )'}}]):
            with self.assertRaises(LibraryError):graph(invalid)
    @unittest.skipUnless(shutil.which('node'),'Node.js is required')
    def test_macro_random_timeout_and_runtime_dependency_guard(self):
        cancel=threading.Event();run=lambda script,seed=42:run_script(script,{'x':'ok'},seed,lambda *_:None,cancel,1)
        self.assertEqual(run('return [ctx.random(),ctx.random()];'),run('return [ctx.random(),ctx.random()];'))
        with self.assertRaises(Exception):run('while(true){}')
        with self.assertRaises(Exception):run('const k="missing";return ctx.get(k);')
    @unittest.skipUnless(shutil.which('node'),'Node.js is required')
    def test_dag_api_parallel_cache_and_restart(self):
        calls=[];active=0;peak=0;lock=threading.Lock()
        def invoke(method,args):
            nonlocal active,peak
            with lock:active+=1;peak=max(active,peak);calls.append(method)
            time.sleep(.12)
            with lock:active-=1
            return args['prompt']+' result'
        engine=Macros(self.root,invoke);body={'owner':'book','seed':7,'trusted':True,'entries':[{'key':'a','type':'text','compute':{'script':'return await ctx.llm.chat("a");'}},{'key':'b','type':'text','compute':{'script':'return await ctx.llm.chat("b");'}},{'key':'c','type':'text','compute':{'script':'return ctx.get("a")+ctx.get("b");'}}]}
        def finish(engine,body):
            id=engine.start(body)['id'];deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                job=engine.get(id)
                if job['status'] not in ('pending','running'):return job
                time.sleep(.03)
            self.fail('Macro job did not finish')
        one=finish(engine,body);self.assertEqual(one['status'],'complete',one);self.assertGreater(peak,1);self.assertEqual(one['values']['c'],'a resultb result')
        two=finish(engine,body);self.assertEqual(len(calls),2);self.assertTrue(all(n['status']=='cached' for n in two['nodes'].values()))
        restarted=Macros(self.root,invoke);three=finish(restarted,body);self.assertEqual(three['status'],'complete');self.assertEqual(len(calls),2)
        changed=json.loads(json.dumps(body));changed['seed']=8;finish(restarted,changed);self.assertEqual(len(calls),4)
    @unittest.skipUnless(shutil.which('node'),'Node.js is required')
    def test_cancel_does_not_commit_or_start_dependents(self):
        started=threading.Event();calls=[]
        def invoke(*args):calls.append(1);started.set();time.sleep(.5);return 'result'
        engine=Macros(self.root,invoke);body={'owner':'book','trusted':True,'entries':[{'key':'a','type':'text','compute':{'script':'return await ctx.llm.chat("a");'}},{'key':'b','type':'text','compute':{'script':'return await ctx.llm.chat(ctx.get("a"));'}}]}
        id=engine.start(body)['id'];self.assertTrue(started.wait(4));engine.cancel(id)
        for _ in range(150):
            if engine.get(id)['status'] not in ('pending','running'):break
            time.sleep(.02)
        self.assertEqual(engine.get(id)['status'],'cancelled');self.assertEqual(engine.get(id)['values'],{});self.assertEqual(calls,[1])
        time.sleep(.6)
    def test_workflow_mapping_nested_types_and_link_guard(self):
        from backend.ecosystem.workflow import compile_workflow
        workflow={'1':{'class_type':'Test','inputs':{'text':'old','nested':{'steps':20},'enabled':False,'link':['2',0]}},'2':{'class_type':'Source','inputs':{}}}
        def binding(path,source,value='',typ='auto',**rest):return {'enabled':True,'nodeId':'1','path':path,'source':source,'value':value,'type':typ,**rest}
        out=compile_workflow(workflow,[binding('text','positive'),binding('nested.steps','literal','35'),binding('/enabled','literal','true')],'portrait',{},[])
        self.assertEqual(out['1']['inputs']['text'],'portrait');self.assertEqual(out['1']['inputs']['nested']['steps'],35);self.assertTrue(out['1']['inputs']['enabled']);self.assertEqual(workflow['1']['inputs']['text'],'old')
        for bindings in ([binding('link','literal','hi')],[binding('text','positive'),binding('text','negative')],[binding('enabled','literal','perhaps')]):
            with self.assertRaises(LibraryError):compile_workflow(workflow,bindings,'x',{},[])
    def test_provider_bridge_resolves_saved_channels_and_persists_assets(self):
        from types import SimpleNamespace
        from backend.ecosystem.api import Ecosystem
        raw=(ROOT/'examples/themes/paper-atelier/paper.png').read_bytes();calls=[]
        config={'uiConfig':{'comfyStudio':{'settings':{'imageGeneration':{'active':'cloud','profiles':[{'id':'cloud','provider':'openai','model':'saved-image'},{'id':'comfy','provider':'comfyui'}]}}}},'comfyConfig':{'baseUrl':'http://comfy.test:8188','workflow':{'1':{'class_type':'Text','inputs':{'text':'old'}}},'bindings':[{'enabled':True,'nodeId':'1','path':'text','source':'positive','type':'text'}]}}
        native=SimpleNamespace(read=lambda **kw:config,settings=SimpleNamespace(resolve=lambda _: {'baseUrl':'https://llm.test','model':'saved-llm'}),image_bytes=lambda _:(raw,'image/png'),image_path=lambda src:self.root/'assets'/'images'/src.rsplit('/',1)[-1])
        host=SimpleNamespace(BASE_DIR=ROOT,DATA_DIR=self.root,native_store=lambda:native,generate_provider_image=lambda payload:calls.append(payload) or {'image':'/images/provider.png'},chat_proxy=lambda payload:calls.append(payload) or {'choices':[{'message':{'content':'rainy street'}}]})
        eco=Ecosystem(host);self.addCleanup(eco.close)
        asset=eco.invoke('image.generate',{'prompt':'portrait','options':{'seed':5}});self.assertTrue(eco.asset_exists(asset));self.assertEqual(calls[0]['config']['model'],'saved-image');self.assertEqual(calls[0]['frame']['seed'],5)
        eco.invoke('image.generate',{'prompt':'mapped portrait','options':{'channelId':'comfy'}});self.assertEqual(calls[1]['workflow']['1']['inputs']['text'],'mapped portrait')
        self.assertEqual(eco.invoke('llm.chat',{'prompt':'mood','options':{}}),'rainy street');self.assertEqual(calls[2]['body']['model'],'saved-llm')
    def test_theme_concurrent_installs_do_not_lose_registry_records(self):
        from concurrent.futures import ThreadPoolExecutor
        manager=Themes(self.root)
        with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda i:manager.install(b'body{color:red}',str(i)+'.css',True),range(8)))
        self.assertEqual(len(manager.records()),8)
    def test_storage_overwrite_counts_replaced_value_once(self):
        store=Storage(self.root);store.set('large','a'*1000)
        # Simulate a namespace near the 32 MiB boundary without allocating many full JSON values.
        with open(self.root/'quota.json','wb') as f:f.truncate(32*1024*1024-1500)
        store.set('large','b'*1000);self.assertEqual(store.get('large'),'b'*1000)
    def test_cache_clear_requires_trust_and_rejects_running_job(self):
        engine=Macros(self.root,lambda *_:None);engine.cache.set('abc',{'value':1})
        with self.assertRaises(LibraryError):engine.clear_cache(False)
        engine.running['busy']=threading.Event()
        with self.assertRaises(LibraryError):engine.clear_cache(True)
        engine.running.clear();engine.clear_cache(True);self.assertIsNone(engine.cache.get('abc'))
    def test_git_update_keeps_data_and_rolls_back_invalid_revision(self):
        manager=Plugins(ROOT,self.root/'data');manager.code=self.root/'code';self.addCleanup(manager.close)
        def clone_fixture(url,branch,dest):shutil.copytree(ROOT/'examples/extensions/scene-notebook',dest)
        with patch('backend.ecosystem.plugins.clone',clone_fixture):manager.install(url='https://github.com/example/notebook',trusted=True)
        manager.call('scene-notebook','POST','/notes',{'title':'kept','text':'still here'});manager.enable('scene-notebook',False);before=manager.records()['scene-notebook']['revision']
        with patch('backend.ecosystem.plugins.clone',clone_fixture):manager.update('scene-notebook',True)
        self.assertNotEqual(before,manager.records()['scene-notebook']['revision']);self.assertFalse(manager.records()['scene-notebook']['enabled']);manager.enable('scene-notebook',True)
        self.assertEqual(manager.call('scene-notebook','GET','/notes',{})[0]['text'],'still here');manager.enable('scene-notebook',False)
        def invalid(url,branch,dest):clone_fixture(url,branch,dest);(dest/'mio.extension.json').write_text('{}')
        good=(manager.code/'scene-notebook/index.js').read_bytes()
        with patch('backend.ecosystem.plugins.clone',invalid):
            with self.assertRaises(LibraryError):manager.update('scene-notebook',True)
        self.assertEqual((manager.code/'scene-notebook/index.js').read_bytes(),good)
    @unittest.skipUnless(shutil.which('node'),'Node.js is required')
    def test_disk_failure_remains_visible_and_blocks_phase_one(self):
        engine=Macros(self.root,lambda *_:None)
        original=engine.store.set
        def fail_after_start(key,value):
            if value.get('status')!='pending':raise OSError('controlled disk full')
            return original(key,value)
        with patch.object(engine.store,'set',fail_after_start):
            id=engine.start({'owner':'book','trusted':True,'entries':[{'key':'x','type':'text','compute':{'script':'return "result";'}}]})['id']
            for _ in range(100):
                if id not in engine.running:break
                time.sleep(.02)
            self.assertEqual(engine.get(id)['status'],'failed');self.assertEqual(engine.get(id)['values'],{});self.assertIn('persisted',engine.get(id)['error']);self.assertNotIn('book',engine.owners)
