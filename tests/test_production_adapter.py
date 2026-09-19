import base64
import copy
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from backend.ecosystem.macros import Macros
from backend.mio_native_store import NativeStore
from backend.mio_library import LibraryError
from backend.production.api import ProductionAdapter,interpolate
from backend.production.queue import ProductionQueue

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfX8AAAAASUVORK5CYII=')
class ProductionAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.store=NativeStore(self.root,Path(__file__).resolve().parents[1]);self.addCleanup(self.store.library.close)
        self.profile={'id':'channel-one','provider':'openai','model':'fixed-model','baseUrl':'https://example.invalid/v1','keyMode':'none','title':'受控渠道'}
        config={'uiConfig':{'comfyStudio':{'settings':{'imageGeneration':{'profiles':[self.profile]}}}}}
        self.store.read=lambda **_:copy.deepcopy(config)
        self.calls=[];image=self.store.upload('data:image/png;base64,'+base64.b64encode(PNG).decode())
        self.host=SimpleNamespace(DATA_DIR=str(self.root),native_store=lambda:self.store,generate_provider_image=lambda p:(self.calls.append(copy.deepcopy(p)) or {'image':image}))
        self.macros=Macros(self.root,lambda *_:self.fail('Unexpected model macro call'))
        self.adapter=ProductionAdapter(self.host,SimpleNamespace(macros=self.macros))
        self.q=ProductionQueue(self.root,self.adapter.prepare,self.adapter.render,self.adapter.publish);self.addCleanup(self.q.close)
        for kind,doc in [('storyboards',{'id':'story-one','projectId':'project-one','title':'故事','outline':'独立主线','frames':[{'name':'一','prompt':'{hero} at sea','caption':'{hero}'},{'name':'二','prompt':'{hero} returns','caption':'归来'}]}),('characters',{'id':'preset-one','projectId':'project-one','title':'人物','negative':'blur','bindings':[],'settingsGroups':[],'entries':[{'key':'hero','type':'text','value':'Ada'}]})]:
            self.store.apply([{'kind':kind,'id':doc['id'],'document':doc,'expected':None}])
    def assemble(self):
        snapshot=self.adapter.snapshot({'storyId':'story-one','presets':[{'kind':'characters','id':'preset-one'}],'channelId':'channel-one','projectId':'project-one'})
        return self.q.assemble(snapshot,'输出画册','request-one')
    def wait(self,id):
        for _ in range(300):
            t=self.q.get(id)
            if t['status'] in ('complete','failed','partial','cancelled') and self.q.active is None:return t
            time.sleep(.01)
        self.fail('queue timed out')
    def test_standby_then_real_native_publication(self):
        task=self.assemble();self.assertFalse(self.calls);self.assertFalse(list((self.root/'runtime/preparations').glob('*')))
        self.q.start(task['id'],trusted=True);done=self.wait(task['id']);self.assertEqual(done['status'],'complete',done.get('error'))
        album=self.store.entity('albums',task['albumId'])['document'];self.assertEqual(album['title'],'输出画册');self.assertEqual(album['synopsis'],'独立主线');self.assertEqual(len(album['steps']),2)
        self.assertEqual(self.store.image_bytes(album['steps'][0]['image'])[0],PNG);self.assertEqual(self.calls[0]['prompt'],'Ada at sea');self.assertEqual(self.calls[0]['negative'],'')
        self.assertEqual(self.store.entity('storyboards','story-one')['document']['frames'][0]['prompt'],'{hero} at sea')
    def test_source_and_channel_snapshots_survive_edits(self):
        task=self.assemble();self.profile['model']='other-model'
        p=self.store.entity('characters','preset-one');p['document']['entries'][0]['value']='Other';self.store.apply([{'kind':'characters','id':'preset-one','document':p['document'],'expected':p['etag']}])
        self.q.start(task['id'],trusted=True);self.assertEqual(self.wait(task['id'])['status'],'complete');self.assertEqual(self.calls[0]['config']['model'],'fixed-model');self.assertEqual(self.calls[0]['prompt'],'Ada at sea')
    def test_rerun_only_one_page_and_same_native_album(self):
        task=self.assemble();self.q.start(task['id'],trusted=True);self.wait(task['id']);before=self.store.entity('albums',task['albumId'])['document']['steps'][0]
        self.q.start(task['id'],indices=[1],trusted=True);self.assertEqual(self.wait(task['id'])['status'],'complete');self.assertEqual(len(self.calls),3);self.assertEqual(self.store.entity('albums',task['albumId'])['document']['steps'][0],before)
    def test_publication_failure_recovery_does_not_pay_twice(self):
        task=self.assemble();real=self.q.publish;self.q.publish=lambda *_:(_ for _ in ()).throw(OSError('test disk failure'))
        self.q.start(task['id'],trusted=True);failed=self.wait(task['id']);self.assertEqual(failed['status'],'failed');self.assertEqual(len(self.calls),1)
        self.q.publish=real;self.q.recover_publication(task['id'],0);self.assertEqual(len(self.calls),1);self.assertEqual(self.q.get(task['id'])['pages'][0]['state'],'complete')
    def test_unknown_variables_fail_before_provider(self):
        task=self.assemble();task['snapshot']['story']['frames'][0]['prompt']='{missing}';self.q.tasks.set(task['id'],task)
        self.q.start(task['id'],trusted=True);done=self.wait(task['id']);self.assertEqual(done['status'],'failed');self.assertFalse(self.calls)
    def test_bad_caption_is_validated_before_paid_render(self):
        task=self.assemble();task['snapshot']['story']['frames'][0]['caption']='{missing}';self.q.tasks.set(task['id'],task)
        self.q.start(task['id'],trusted=True);done=self.wait(task['id']);self.assertEqual(done['status'],'failed');self.assertFalse(self.calls)
    def test_reference_freeze_survives_original_file_removal(self):
        url=self.store.upload('data:image/png;base64,'+base64.b64encode(PNG).decode());from backend.production.api import durable_assets
        frozen=durable_assets(self.host,{'image':url});self.store.image_path(url).unlink();self.assertEqual(self.store.image_bytes(frozen['image'])[0],PNG)
    def test_computed_variables_run_only_on_explicit_start(self):
        p=self.store.entity('characters','preset-one');p['document']['entries'][0]['compute']={'script':'return "Computed";', 'dependsOn':[], 'timeout':10}
        self.store.apply([{'kind':'characters','id':'preset-one','document':p['document'],'expected':p['etag']}])
        task=self.assemble();self.assertFalse(list(self.macros.store.root.glob('*.json')))
        self.q.start(task['id'],trusted=True);done=self.wait(task['id']);self.assertEqual(done['status'],'complete',done.get('error'));self.assertEqual(self.calls[0]['prompt'],'Computed at sea')
    def test_standalone_preview_does_not_create_or_change_an_album(self):
        before=self.store.entity('characters','preset-one')
        snap=self.adapter.snapshot({'preview':True,'previewPrompt':'{hero} portrait','presets':[{'kind':'characters','id':'preset-one'}],'channelId':'channel-one','projectId':'project-one'})
        task=self.q.assemble(snap,'Preview','preview-request');self.assertFalse(self.calls)
        self.q.start(task['id'],trusted=True);done=self.wait(task['id']);self.assertEqual(done['status'],'complete',done.get('error'))
        self.assertEqual(len(self.calls),1);self.assertEqual(done['purpose'],'preview')
        with self.assertRaises(LibraryError):self.store.entity('albums',task['albumId'])
        self.assertEqual(self.store.entity('characters','preset-one')['etag'],before['etag'])
    def test_lora_bindings_compile_before_provider(self):
        from backend.ecosystem.workflow import compile_workflow
        wf={'9':{'inputs':{'lora_name':'old','strength_model':1,'model':['1',0]}}}
        bindings=[{'nodeId':'9','path':'lora_name','source':'literal','value':'portrait.safetensors','type':'text','enabled':True},{'nodeId':'9','path':'strength_model','source':'variable','value':'strength','type':'number','enabled':True}]
        result=compile_workflow(wf,bindings,'',{'variables':{'strength':'.65'}},[])
        self.assertEqual(result['9']['inputs']['strength_model'],.65);self.assertEqual(result['9']['inputs']['lora_name'],'portrait.safetensors');self.assertEqual(result['9']['inputs']['model'],['1',0]);self.assertEqual(wf['9']['inputs']['lora_name'],'old')
        with self.assertRaises(LibraryError):compile_workflow(wf,bindings+bindings,'',{'variables':{'strength':'.65'}},[])
    def test_negative_prompt_uses_only_explicit_variables(self):
        task=self.assemble();task['snapshot']['presets'][0]['entries'].append({'key':'画风负向','type':'text','value':'bad anatomy'})
        task['snapshot']['story']['frames'][0]['negative']='low quality, {画风负向}'
        self.q.tasks.set(task['id'],task);self.q.start(task['id'],trusted=True);done=self.wait(task['id'])
        self.assertEqual(done['status'],'complete');self.assertEqual(self.calls[0]['negative'],'low quality, bad anatomy');self.assertNotIn('blur',self.calls[0]['negative'])
    def test_saved_workflow_is_frozen_and_seed_mapping_varies_per_frame(self):
        workflow={'9':{'class_type':'TestSeed','inputs':{'seed':731}}}
        config={'comfyConfig':{'mode':'real','baseUrl':'http://127.0.0.1:8188','workflow':{'wrong':{'inputs':{}}}},'comfyWorkflows':[{'id':'saved-workflow','title':'Chosen','workflow':workflow,'bindings':[{'enabled':True,'nodeId':'9','path':'seed','source':'random','type':'number'}]}]}
        config['uiConfig']={'comfyStudio':{'settings':{'imageGeneration':{'profiles':[{'id':'comfyui','provider':'comfyui','title':'Test'}]}}}}
        self.store.read=lambda **_:copy.deepcopy(config)
        for enabled in (False,True):
            snap=self.adapter.snapshot({'storyId':'story-one','presets':[{'kind':'characters','id':'preset-one'}],'channelId':'comfyui','workflowId':'saved-workflow','seedEnabled':enabled,'seed':8})
            self.assertIn('9',snap['workflow']['workflow']);self.assertNotIn('wrong',snap['workflow']['workflow'])
            task=self.q.assemble(snap,'Workflow '+str(enabled),'workflow-'+str(enabled));self.q.start(task['id'],trusted=True)
            self.assertEqual(self.wait(task['id'])['status'],'complete',self.q.get(task['id']))
            seeds=[c['workflow']['9']['inputs']['seed'] for c in self.calls[-2:]]
            if enabled:self.assertEqual(seeds,[8,9])
            else:
                # Disabled reproducibility means fresh seeds, never the literal 731 on every page.
                self.assertNotEqual(seeds[0],seeds[1]);self.assertTrue(all(isinstance(x,int) and 0<=x<2**32 for x in seeds))
        self.assertEqual(workflow['9']['inputs']['seed'],731)
    def test_workflow_without_seed_mapping_keeps_its_literal_seed(self):
        workflow={'9':{'class_type':'TestSeed','inputs':{'seed':731}}}
        config={'comfyConfig':{'mode':'real','baseUrl':'http://127.0.0.1:8188'},'comfyWorkflows':[{'id':'saved-workflow','title':'Chosen','workflow':workflow,'bindings':[]}]}
        config['uiConfig']={'comfyStudio':{'settings':{'imageGeneration':{'profiles':[{'id':'comfyui','provider':'comfyui','title':'Test'}]}}}}
        self.store.read=lambda **_:copy.deepcopy(config)
        snap=self.adapter.snapshot({'storyId':'story-one','presets':[{'kind':'characters','id':'preset-one'}],'channelId':'comfyui','workflowId':'saved-workflow','seedEnabled':False,'seed':8})
        task=self.q.assemble(snap,'Literal','literal');self.q.start(task['id'],trusted=True);self.assertEqual(self.wait(task['id'])['status'],'complete')
        self.assertEqual([c['workflow']['9']['inputs']['seed'] for c in self.calls[-2:]],[731,731])
    def test_cloud_frames_get_distinct_seeds_and_reruns_change_them(self):
        task=self.assemble();self.q.start(task['id'],trusted=True);self.assertEqual(self.wait(task['id'])['status'],'complete')
        first=[c['frame']['seed'] for c in self.calls];self.assertNotEqual(first[0],first[1])
        self.q.start(task['id'],indices=[0],trusted=True);self.wait(task['id']);self.assertNotEqual(self.calls[-1]['frame']['seed'],first[0])
    def test_blank_scene_negative_inherits_the_studio_negative(self):
        config={'uiConfig':{'comfyStudio':{'settings':{'negative':'lowres, watermark','imageGeneration':{'profiles':[self.profile]}}}}}
        self.store.read=lambda **_:copy.deepcopy(config)
        task=self.assemble();task['snapshot']['story']['frames'][1]['negative']='own negative';self.q.tasks.set(task['id'],task)
        self.assertEqual(task['snapshot']['globalNegative'],'lowres, watermark')
        self.q.start(task['id'],trusted=True);self.assertEqual(self.wait(task['id'])['status'],'complete')
        self.assertEqual([c['negative'] for c in self.calls],['lowres, watermark','own negative'])
    def test_blank_variables_do_not_leave_dangling_commas(self):
        values={'a':'','b':'cat'}
        self.assertEqual(interpolate('{a}, {b}, {a}',values),'cat');self.assertEqual(interpolate('{a} {b} , , sunny, {a}',values),'cat, sunny')
        self.assertEqual(interpolate('1,000 {b},{b}',values),'1,000 cat,cat');self.assertEqual(interpolate('  raw {b}',values),'  raw cat')
    def test_image_variable_bound_to_a_node_reuses_the_prompt_slot(self):
        from backend.ecosystem.workflow import compile_workflow
        wf={'1':{'class_type':'LoadImage','inputs':{'image':'x.png'}},'2':{'class_type':'CLIPTextEncode','inputs':{'text':'orig'}},'3':{'class_type':'CLIPTextEncode','inputs':{'text':'lowres, bad hands'}}}
        bindings=[{'enabled':True,'nodeId':'1','path':'image','source':'variable','value':'{ref}'},{'enabled':True,'nodeId':'2','path':'text','source':'positive'},{'enabled':True,'nodeId':'3','path':'text','source':'negative'}]
        images=['/images/ref.png']
        out=compile_workflow(wf,bindings,'@image_1 hero at sea',{'variables':{'ref':{'kind':'mio-image','src':'/images/ref.png'}},'negative':''},images)
        self.assertEqual(images,['/images/ref.png']);self.assertEqual(out['1']['inputs']['image'],'mio-image://1')
        self.assertEqual(out['2']['inputs']['text'],'hero at sea');self.assertEqual(out['3']['inputs']['text'],'lowres, bad hands')
        out=compile_workflow(wf,bindings,'hero',{'variables':{'ref':{'kind':'mio-image','src':'/images/ref.png'}},'negative':'blur'},[])
        self.assertEqual(out['3']['inputs']['text'],'blur');self.assertEqual(out['1']['inputs']['image'],'mio-image://1')

    def test_seed_gate_rejects_missing_node_and_accepts_numeric_input(self):
        from backend.production.api import seed_binding_ready
        wf={'workflow':{'9':{'inputs':{'seed':42}}},'bindings':[{'enabled':True,'source':'random','nodeId':'9','path':'seed'}]}
        self.assertTrue(seed_binding_ready(wf));wf['bindings'][0]['nodeId']='missing';self.assertFalse(seed_binding_ready(wf))
    def test_inline_images_keep_stable_input_order(self):
        values={'hero':{'kind':'mio-image','src':'/images/one.png'}};images=[]
        self.assertEqual(interpolate('{hero} then {hero}',values,images),'@image_1 then @image_1');self.assertEqual(images,['/images/one.png'])
if __name__=='__main__':unittest.main()
