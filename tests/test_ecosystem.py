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
        css=manager.css(meta['id']);self.assertIn('/theme-assets/paper-atelier/'+meta['revision']+'/paper.png',css);self.assertNotIn('data:image/png;base64,',css)
        self.assertTrue(manager.asset(meta['id'],meta['revision'],'paper.png').is_file())
        with self.assertRaises(LibraryError):manager.asset(meta['id'],'stale','paper.png')
        manager.select(meta['id']);self.assertEqual(manager.list()['active'],meta['id']);self.assertEqual(manager.list()['stack'],[meta['id']])
        manager.uninstall(meta['id']);self.assertEqual(manager.list()['active'],'');self.assertFalse((manager.root/meta['id']).exists())
    def test_theme_css_is_unrestricted_but_install_requires_trust(self):
        manager=Themes(self.root)
        with self.assertRaises(LibraryError):manager.install(b'body{}','a.css')
        text='@import url("https://fonts.googleapis.com/css2?family=Inter");@import "local.css";body{background:url(https://example/x.png) , url(paper/tex.png);content:"\\2014"}'
        meta=manager.install(text.encode(),'Orbital Night.css',True);self.assertEqual(meta['id'],'orbital-night')
        css=manager.css(meta['id']);self.assertIn('fonts.googleapis.com',css);self.assertIn('https://example/x.png',css)
        self.assertIn('/theme-assets/orbital-night/'+meta['revision']+'/local.css',css);self.assertIn('/theme-assets/orbital-night/'+meta['revision']+'/paper/tex.png',css)
        second=manager.install(b'body{}','orbital-night.css',True);self.assertNotEqual(second['id'],meta['id'])
    def test_theme_stack_order_settings_and_variants(self):
        manager=Themes(self.root)
        a=manager.install(b':root{--accent:#111}','a.css',True);b=manager.install(zipped(ROOT/'examples/themes/paper-atelier'),'paper.zip',True)
        manager.enable(a['id'],True);manager.enable(b['id'],True);self.assertEqual(manager.stack(),[a['id'],b['id']])
        manager.order([b['id'],a['id'],'missing']);self.assertEqual(manager.stack(),[b['id'],a['id']])
        compiled=manager.compile_stack();self.assertEqual([c['id'] for c in compiled],[b['id'],a['id']]);self.assertIn('sepia',compiled[0]['variants']);self.assertIn('[data-theme-variant~=sepia]',compiled[0]['css'])
        values=manager.set_settings(b['id'],{'accent':'#ff0000','radius':12,'__variant':'sepia'});self.assertEqual(values['accent'],'#ff0000')
        with self.assertRaises(LibraryError):manager.set_settings(b['id'],{'unknown':1})
        self.assertEqual(manager.list()['items'][1]['values']['radius'],12)
        manager.enable(b['id'],False);self.assertEqual(manager.stack(),[a['id']]);manager.select('');self.assertEqual(manager.stack(),[])
    def test_theme_linked_folder_hot_reloads(self):
        folder=self.root/'dev-theme';shutil.copytree(ROOT/'examples/themes/paper-atelier',folder);manager=Themes(self.root)
        with self.assertRaises(LibraryError):manager.link(str(folder))
        meta=manager.link(str(folder),True);self.assertEqual(meta['source'],'link');self.assertEqual(manager.stack(),[meta['id']]);self.assertFalse((manager.root/meta['id']).exists())
        self.assertEqual(manager.watch(),{});time.sleep(.02)
        (folder/'theme.css').write_text('body{--changed:1}',encoding='utf-8');import os;os.utime(folder/'theme.css',(time.time()+2,time.time()+2))
        changed=manager.watch();self.assertIn(meta['id'],changed);self.assertIn('--changed:1',manager.css(meta['id']));self.assertEqual(manager.records()[meta['id']]['revision'],changed[meta['id']])
        manager.uninstall(meta['id']);self.assertTrue(folder.exists())
    def test_user_styles_snippets_tokens_assets_and_export(self):
        from backend.ecosystem.styles import Styles
        styles=Styles(self.root)
        one=styles.save_snippet({'name':'圆角','css':'.btn{border-radius:14px}'});two=styles.save_snippet({'name':'隐藏','css':'.statusbar{display:none}','enabled':False})
        self.assertEqual([s['id'] for s in styles.snippets()],[one['id'],two['id']]);self.assertIn('.btn{border-radius:14px}',styles.compile());self.assertNotIn('.statusbar',styles.compile())
        styles.replace_snippets([{'id':two['id'],'enabled':True},{'id':one['id']}]);self.assertEqual([s['id'] for s in styles.snippets()],[two['id'],one['id']]);self.assertLess(styles.compile().index('.statusbar'),styles.compile().index('.btn{'))
        tokens=styles.set_tokens({'shared':{'--accent':'#ff8800','--sans':'"Noto Sans SC",sans-serif'},'light':{'--bg':'#fff'},'dark':{'--bg':''}})
        self.assertEqual(tokens['dark'],{});css=styles.compile();self.assertTrue(css.startswith('/* == 设计令牌覆盖 == */\n:root,:root[data-theme]{--accent:#ff8800'));self.assertIn(':root[data-theme=light]{--bg:#fff}',css)
        for bad in ({'shared':{'accent':'#fff'}},{'shared':{'--x':'a;b'}},{'shared':{'--x':'}'}},{'weird mode':{'--x':'1'}}):
            with self.assertRaises(LibraryError):styles.set_tokens(bad)
        asset=styles.put_asset('paper.png',(ROOT/'examples/themes/paper-atelier/paper.png').read_bytes());self.assertEqual(asset['url'],'/style-assets/paper.png');self.assertTrue(styles.asset_path('paper.png').is_file())
        with self.assertRaises(LibraryError):styles.put_asset('../escape.png',b'x')
        with self.assertRaises(LibraryError):styles.put_asset('.hidden',b'x')
        styles.save_snippet({'id':one['id'],'css':'body{background:url(/style-assets/paper.png)}'})
        bundle=styles.export_theme('我的桌面');self.assertTrue(bundle['filename'].endswith('.mio-theme.zip'))
        with zipfile.ZipFile(io.BytesIO(bundle['bytes'])) as z:
            manifest=json.loads(z.read('mio.theme.json'));self.assertEqual(manifest['apiVersion'],3);self.assertEqual(manifest['tokens']['shared']['--accent'],'#ff8800');self.assertIn('assets/paper.png',z.namelist());self.assertIn('url(assets/paper.png)',z.read('theme.css').decode())
        Themes(self.root).install(bundle['bytes'],bundle['filename'],True)
        styles.delete_snippet(one['id']);styles.delete_asset('paper.png');self.assertEqual(len(styles.snippets()),1);self.assertEqual(styles.list_assets(),[])
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
    def _write_v3_extension(self,folder):
        folder.mkdir(parents=True,exist_ok=True)
        (folder/'mio.extension.json').write_text(json.dumps({'id':'v3-probe','name':'V3 Probe','version':'1.0.0','apiVersion':3,'entry':'index.js','styles':['style.css'],'contributes':{'anchors':['topbar']}}),encoding='utf-8')
        (folder/'index.js').write_text('export default function(ctx){return ()=>{}}',encoding='utf-8')
        (folder/'style.css').write_text('.probe{color:red}',encoding='utf-8')
        (folder/'plugin.py').write_text('''import time
def setup(ctx):
    @ctx.route('/echo',method='GET')
    def echo(body,query):
        return {'query':query,'sdk':ctx.sdk}
    @ctx.route('/slow',timeout=2)
    def slow(body):
        time.sleep(float(body.get('seconds',0)));return {'ok':True}
    @ctx.route('/page',method='GET')
    def page(body):
        return ctx.response('<h1>hi</h1>','text/html; charset=utf-8',headers={'X-Probe':'1'})
    @ctx.route('/file',method='GET')
    def file(body):
        return ctx.file(ctx.plugin_dir/'style.css',download=True)
    @ctx.route('/start')
    def start(body):
        def work(task,n):
            for i in range(n):
                if task.cancelled():return None
                task.report((i+1)/n,'step %d'%(i+1));time.sleep(.05)
            return {'done':n}
        return {'id':ctx.tasks.spawn(work,int(body.get('n',3)),name='count').id}
''',encoding='utf-8')
        return folder
    def test_plugin_v3_routes_tasks_raw_responses_and_link_reload(self):
        manager=Plugins(ROOT,self.root/'data');manager.code=self.root/'code';self.addCleanup(manager.close)
        folder=self._write_v3_extension(self.root/'dev-ext')
        with self.assertRaises(LibraryError):manager.link(str(folder))
        meta=manager.link(str(folder),trusted=True);self.assertEqual(meta['source'],'link');self.assertEqual(meta['styles'],['style.css']);self.assertTrue(manager.records()['v3-probe']['enabled'])
        self.assertEqual(manager.call('v3-probe','GET','/echo',{},{'q':'1'})['query'],{'q':'1'});self.assertEqual(manager.call('v3-probe','GET','/echo',{})['sdk'],3)
        self.assertEqual(manager.route_timeout('v3-probe','POST','/slow'),2);self.assertEqual(manager.route_timeout('v3-probe','GET','/echo'),30)
        page=manager.call('v3-probe','GET','/page',{});self.assertTrue(page.get('__mio_response__'));self.assertEqual(page['mime'],'text/html; charset=utf-8');self.assertEqual(page['headers']['X-Probe'],'1')
        import base64;self.assertEqual(base64.b64decode(page['b64']),b'<h1>hi</h1>');self.assertEqual(manager.call('v3-probe','GET','/file',{})['filename'],'style.css')
        started=manager.call('v3-probe','POST','/start',{'n':4});tid=started['id'];self.assertTrue(any(t['id']==tid for t in manager.task('v3-probe','list')))
        deadline=time.monotonic()+5
        while time.monotonic()<deadline and manager.task('v3-probe','get',tid)['status']=='running':time.sleep(.05)
        task=manager.task('v3-probe','get',tid);self.assertEqual(task['status'],'complete');self.assertEqual(task['result'],{'done':4});self.assertEqual(task['progress'],1.0)
        cancelled=manager.call('v3-probe','POST','/start',{'n':40})['id'];manager.task('v3-probe','cancel',cancelled);time.sleep(.3);self.assertEqual(manager.task('v3-probe','get',cancelled)['status'],'cancelled')
        self.assertTrue(manager.asset('v3-probe',manager.records()['v3-probe']['revision']+'/style.css').is_file())
        with self.assertRaises(LibraryError):manager.asset('v3-probe',manager.records()['v3-probe']['revision']+'/plugin.py')
        before=manager.records()['v3-probe']['revision'];time.sleep(.02)
        (folder/'plugin.py').write_text((folder/'plugin.py').read_text(encoding='utf-8').replace("'sdk':ctx.sdk","'sdk':99"),encoding='utf-8');import os;os.utime(folder/'plugin.py',(time.time()+2,time.time()+2))
        changed=manager.watch();self.assertIn('v3-probe',changed);self.assertNotEqual(manager.records()['v3-probe']['revision'],before);self.assertEqual(manager.call('v3-probe','GET','/echo',{})['sdk'],99)
        with self.assertRaises(LibraryError):manager.call('v3-probe','POST','/slow',{'seconds':3})
        self.assertFalse(manager.records()['v3-probe']['enabled'])
        manager.enable('v3-probe',True);self.assertTrue(manager.records()['v3-probe']['enabled']);manager.uninstall('v3-probe','all');self.assertTrue(folder.exists());self.assertEqual(manager.records(),{})
    def test_manifest_v3_extension_and_theme_fields(self):
        from backend.ecosystem.packages import manifest
        folder=self._write_v3_extension(self.root/'m');meta=manifest(folder,'extension');self.assertEqual(meta['contributes'],{'anchors':['topbar']});self.assertEqual(meta['styles'],['style.css'])
        (folder/'mio.extension.json').write_text(json.dumps({'id':'v3-probe','name':'x','version':'1','apiVersion':3,'requirements':['requests>=2']}),encoding='utf-8');self.assertEqual(manifest(folder,'extension')['requirements'],['requests>=2'])
        (folder/'mio.extension.json').write_text(json.dumps({'id':'v3-probe','name':'x','version':'1','apiVersion':3,'styles':['nope.css']}),encoding='utf-8')
        with self.assertRaises(LibraryError):manifest(folder,'extension')
        theme=self.root/'t';theme.mkdir();(theme/'a.css').write_text('a{}');(theme/'b.css').write_text('b{}');(theme/'sepia.css').write_text('body{}');(theme/'theme.js').write_text('export default function(){}')
        (theme/'mio.theme.json').write_text(json.dumps({'id':'multi','name':'M','version':'1','apiVersion':3,'css':['a.css','b.css'],'variants':{'sepia':'sepia.css'},'script':'theme.js','settings':[{'key':'accent','type':'color','var':'--accent','default':'#fff'},{'key':'radius','type':'range','var':'--radius','min':0,'max':20,'unit':'px'}]}),encoding='utf-8')
        meta=manifest(theme,'theme');self.assertEqual(meta['css'],['a.css','b.css']);self.assertEqual(meta['script'],'theme.js');self.assertEqual(meta['settings'][1]['unit'],'px');self.assertEqual(meta['settings'][0]['var'],'--accent')
        (theme/'mio.theme.json').write_text(json.dumps({'id':'multi','name':'M','version':'1','apiVersion':3,'css':'a.css','settings':[{'key':'accent','type':'color','var':'accent'}]}),encoding='utf-8')
        with self.assertRaises(LibraryError):manifest(theme,'theme')
    def test_host_api_accepts_open_event_names_and_library_kinds(self):
        from types import SimpleNamespace
        from backend.ecosystem.api import Ecosystem
        native=SimpleNamespace(read=lambda **kw:{},settings=SimpleNamespace(resolve=lambda _:{}),image_bytes=lambda _:(b'',''),image_path=lambda src:self.root/src)
        host=SimpleNamespace(BASE_DIR=ROOT,DATA_DIR=self.root,native_store=lambda:native,generate_provider_image=lambda payload:None,chat_proxy=lambda payload:None)
        eco=Ecosystem(host);self.addCleanup(eco.close)
        record=eco.host_call('probe','events.emit',{'name':'studio.custom-signal','payload':{'x':1}});self.assertEqual(record['source'],'probe')
        with self.assertRaises(LibraryError):eco.host_call('probe','events.emit',{'name':'app.ready'})
        self.assertIn('rows',eco.host_call('probe','library.kinds',{}));self.assertEqual(eco.host_call('probe','workspace.path',{})['path'],str(self.root))
        self.assertEqual(eco.styles.compile(),'');self.assertEqual(eco.manifest()['sdk'],3)
    def test_user_scripts_crud_and_safety(self):
        from backend.ecosystem.user_scripts import UserScripts
        store = UserScripts(self.root / "scripts-data")
        script = store.save({"name": "Word Counter", "source": "export default function(ctx){}"})
        self.assertEqual(script["id"], "word-counter")
        self.assertTrue(script["enabled"])
        self.assertTrue(store.script_path("word-counter.js").is_file())
        with self.assertRaises(LibraryError):
            store.script_path("../escape.js")
        with self.assertRaises(LibraryError):
            store.script_path("not-exist.js")
        second = store.save({"name": "Word Counter"})
        self.assertEqual(second["id"], "word-counter-2")
        store.reorder([second["id"], script["id"]])
        self.assertEqual([r["id"] for r in store.list(False)], [second["id"], script["id"]])
        store.save({"id": second["id"], "enabled": False})
        self.assertEqual([r["id"] for r in store.enabled()], [script["id"]])
        store.disable_all()
        self.assertEqual(store.enabled(), [])
        store.delete(script["id"])
        self.assertEqual([r["id"] for r in store.list(False)], [second["id"]])
    def test_extension_files_api_and_raw_responses(self):
        manager = Plugins(ROOT, self.root / "data")
        manager.code = self.root / "code"
        self.addCleanup(manager.close)
        record = manager.file_write("probe-ext", "out/data.bin", b"\x01\x02\x03")
        self.assertEqual(record["path"], "out/data.bin")
        self.assertEqual(record["size"], 3)
        self.assertTrue(manager.file_path("probe-ext", "out/data.bin").is_file())
        files = manager.file_list("probe-ext")
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["path"], "out/data.bin")
        with self.assertRaises(LibraryError):
            manager.file_path("probe-ext", "../escape.txt")
        # raw response handling
        raw_text = manager.raw_response("probe-ext", {"$text": "hello text"})
        self.assertEqual(raw_text["bytes"], b"hello text")
        self.assertEqual(raw_text["mime"], "text/plain; charset=utf-8")
        import base64
        raw_b64 = manager.raw_response("probe-ext", {"$raw": base64.b64encode(b"raw-bin").decode()})
        self.assertEqual(raw_b64["bytes"], b"raw-bin")
        mio_resp = manager.raw_response("probe-ext", {"__mio_response__": True, "b64": base64.b64encode(b"custom").decode(), "mime": "application/json", "status": 201})
        self.assertEqual(mio_resp["bytes"], b"custom")
        self.assertEqual(mio_resp["status"], 201)
        manager.file_delete("probe-ext", "out")
        self.assertEqual(manager.file_list("probe-ext"), [])


