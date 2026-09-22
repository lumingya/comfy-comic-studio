import base64
import copy
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import json
import unittest
from backend.ecosystem.macros import Macros
from backend.mio_native_store import NativeStore
from backend.mio_library import LibraryError
from backend.production.api import ProductionAdapter,interpolate
from backend.production.queue import ProductionQueue

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfX8AAAAASUVORK5CYII=')
class ProductionAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(ignore_cleanup_errors=True);self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.store=NativeStore(self.root,Path(__file__).resolve().parents[1]);self.addCleanup(self.store.library.close)
        self.profile={'id':'channel-one','provider':'openai','model':'fixed-model','baseUrl':'https://example.invalid/v1','keyMode':'none','title':'受控渠道'}
        config={'uiConfig':{'comfyStudio':{'settings':{'imageGeneration':{'profiles':[self.profile]}}}}}
        self.store.read=lambda **_:copy.deepcopy(config)
        self.calls=[];image=self.store.upload('data:image/png;base64,'+base64.b64encode(PNG).decode())
        self.host=SimpleNamespace(DATA_DIR=str(self.root),native_store=lambda:self.store,generate_provider_image=lambda p:(self.calls.append(copy.deepcopy(p)) or {'image':image}))
        self.macros=Macros(self.root,lambda *_:self.fail('Unexpected model macro call'))
        from backend.ecosystem.events import EventBus,Hooks
        self.hooks=Hooks();self.events=EventBus()
        self.adapter=ProductionAdapter(self.host,SimpleNamespace(macros=self.macros,hooks=self.hooks,events=self.events))
        self.q=ProductionQueue(self.root,self.adapter.prepare,self.adapter.render,self.adapter.publish);self.addCleanup(self.q.close)
        for kind,doc in [('storyboards',{'id':'story-one','projectId':'project-one','title':'故事','outline':'独立主线','frames':[{'name':'一','prompt':'{hero} at sea','caption':'{hero}'},{'name':'二','prompt':'{hero} returns','caption':'归来'}]}),('characters',{'id':'preset-one','projectId':'project-one','title':'人物','negative':'blur','bindings':[],'settingsGroups':[],'entries':[{'key':'hero','type':'text','value':'Ada'}]})]:
            self.store.apply([{'kind':kind,'id':doc['id'],'document':doc,'expected':None}])
    def assemble(self):
        snapshot=self.adapter.snapshot({'storyId':'story-one','presets':[{'kind':'characters','id':'preset-one'}],'channelId':'channel-one','projectId':'project-one'})
        return self.q.assemble(snapshot,'输出画册','request-one')
    def wait(self,id):
        for _ in range(300):
            t=self.q.get(id)
            if t['status'] in ('complete','failed','partial','cancelled') and not self.q.active:return t
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
    def test_undefined_prompt_brackets_stay_literal_and_render_without_failing(self):
        task=self.assemble();task['snapshot']['story']['frames'][0]['prompt']='{missing}, {{on back}}';self.q.tasks.set(task['id'],task)
        self.q.start(task['id'],trusted=True);done=self.wait(task['id']);self.assertEqual(done['status'],'complete');self.assertEqual(self.calls[0]['prompt'],'{missing}, {{on back}}')
    def test_missing_caption_variable_warns_and_renders_blank_instead_of_blocking(self):
        task=self.assemble();task['snapshot']['knownVariables'].append('missing');task['snapshot']['story']['frames'][0]['caption']='{missing}：出发';self.q.tasks.set(task['id'],task)
        self.q.start(task['id'],trusted=True);done=self.wait(task['id']);self.assertEqual(done['status'],'complete',done.get('error'));self.assertEqual(len(self.calls),2)
        self.assertEqual(done['notices'],['存在变量 {missing} 未定义（第 1 幕），已替换为空。']);self.assertEqual(self.q.list()['tasks'][0]['notices'],done['notices'])
        self.assertEqual(self.store.entity('albums',task['albumId'])['document']['steps'][0]['caption'],'：出发')
    def test_caption_authored_brackets_outside_known_variables_stay_literal(self):
        task=self.assemble();task['snapshot']['story']['frames'][0]['caption']='{叹气}：出发';self.q.tasks.set(task['id'],task)
        self.q.start(task['id'],trusted=True);done=self.wait(task['id']);self.assertEqual(done['status'],'complete')
        self.assertNotIn('notices',done)
        self.assertEqual(self.store.entity('albums',task['albumId'])['document']['steps'][0]['caption'],'{叹气}：出发')
    def test_collection_variables_missing_from_the_selected_presets_blank_out_while_authored_braces_stay(self):
        config={'uiConfig':{'comfyStudio':{'settings':{'imageGeneration':{'profiles':[self.profile]}},'creation':{'variableSets':[{'id':'preset-two','projectId':'project-one','entries':[{'key':'outfit','type':'text','value':'coat'}]}],'plans':[{'projectId':'project-one','variables':[{'key':'weapon','type':'text','value':'bow'}],'sceneOverrides':{}}]}}}}
        self.store.read=lambda **_:copy.deepcopy(config)
        task=self.assemble();self.assertEqual(task['snapshot']['knownVariables'],['hero','outfit','weapon'])
        task['snapshot']['story']['frames'][0]['prompt']='{hero}, {outfit}, {weapon}, {masterpiece}, {{soft}}';task['snapshot']['story']['frames'][1]['caption']='{outfit}';self.q.tasks.set(task['id'],task)
        self.q.start(task['id'],trusted=True);done=self.wait(task['id']);self.assertEqual(done['status'],'complete',done.get('error'))
        self.assertEqual(self.calls[0]['prompt'],'Ada, {masterpiece}, {{soft}}');self.assertEqual(done['notices'],['存在变量 {outfit}、{weapon} 未定义（第 1、2 幕），已替换为空。'])
        self.q.start(task['id'],indices=[0],trusted=True,force_prepare=True);self.assertEqual(self.wait(task['id'])['status'],'complete')
    def test_interpolate_missing_policy(self):
        missing=[];self.assertEqual(interpolate('{a}, {b}',{'a':'x'},literal_unknown=False,missing=missing),'x');self.assertEqual(missing,['b'])
        with self.assertRaises(LibraryError):interpolate('{b}',{},literal_unknown=False)
        missing=[];self.assertEqual(interpolate('{known}, {weight}',{},known={'known'},missing=missing),'{weight}');self.assertEqual(missing,['known'])
    def test_referenced_assets_are_pinned_and_orphans_collected_from_the_unified_pool(self):
        import os,time
        from backend import mio_assets
        from backend.production.api import durable_assets
        url=self.store.upload('data:image/png;base64,'+base64.b64encode(PNG).decode())
        frozen=durable_assets(self.host,{'image':url});self.assertTrue(frozen['image'].startswith('/images/assets/'))
        self.assertEqual(self.store.image_bytes(frozen['image'])[0],PNG)
        # An image mentioned by a production task stays; an unreferenced one older than the grace period goes to trash.
        (self.root/'production/tasks').mkdir(parents=True,exist_ok=True);(self.root/'production/tasks/t.json').write_text(json.dumps({'snapshot':frozen}))
        stray=self.root/'assets/images'/('f'*64+'.png');stray.write_bytes(PNG);old=time.time()-3*86400;os.utime(stray,(old,old));os.utime(self.store.image_path(url),(old,old))
        report=mio_assets.inventory(self.root);self.assertEqual([o['name'] for o in report['orphans']],[stray.name]);self.assertEqual(report['referenced'],1)
        result=mio_assets.collect(self.root,report['token']);self.assertEqual(result['moved'],['/images/assets/'+stray.name]);self.assertFalse(stray.exists())
        self.assertEqual(self.store.image_bytes(frozen['image'])[0],PNG)
        with self.assertRaises(LibraryError):mio_assets.collect(self.root,'stale-token')
        restored=mio_assets.restore(self.root,result['batch']);self.assertEqual(restored['restored'],['/images/assets/'+stray.name]);self.assertTrue(stray.exists())
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
    def test_model_and_lora_overrides_are_frozen_and_applied_after_bindings(self):
        workflow={'4':{'class_type':'CheckpointLoaderSimple','inputs':{'ckpt_name':'blueprint.safetensors'}},
                  '6':{'class_type':'CLIPTextEncode','inputs':{'text':'blueprint prompt','clip':['4',1]}},
                  '3':{'class_type':'KSampler','inputs':{'model':['4',0],'positive':['6',0],'seed':1}}}
        bindings=[{'id':'pos','enabled':True,'nodeId':'6','path':'text','source':'positive','type':'text'}]
        huge={'CheckpointLoaderSimple':{'output':['MODEL','CLIP','VAE'],'input':{'required':{'ckpt_name':[['blueprint.safetensors','chosen.safetensors']]}}},'Unused':{'input':{'required':{'x':['STRING']}}}}
        config={'comfyConfig':{'mode':'real','baseUrl':'http://127.0.0.1:8188','objectInfo':huge,'modelCatalog':{'loras':['a.safetensors']}},
                'comfyWorkflows':[{'id':'saved-workflow','title':'Chosen','workflow':workflow,'bindings':bindings,'slots':{}}]}
        config['uiConfig']={'comfyStudio':{'settings':{'imageGeneration':{'profiles':[{'id':'comfyui','provider':'comfyui','title':'Test'}]}}}}
        self.store.read=lambda **_:copy.deepcopy(config)
        body={'storyId':'story-one','presets':[{'kind':'characters','id':'preset-one'}],'channelId':'comfyui','workflowId':'saved-workflow','seedEnabled':False,'seed':8}
        snap=self.adapter.snapshot({**body,'overrides':{'model':'chosen.safetensors','loras':[{'name':'sub\\Style Boost.safetensors','strength':0.85},{'name':'sub\\Style Boost.safetensors','strength':0.2}]}})
        self.assertEqual(snap['overrides'],{'model':'chosen.safetensors','loras':[{'name':'sub\\Style Boost.safetensors','strength':0.2}]})
        # The frozen workflow keeps only the node definitions it uses and never the catalog.
        self.assertEqual(set(snap['workflow']['objectInfo']),{'CheckpointLoaderSimple'});self.assertNotIn('modelCatalog',snap['workflow'])
        task=self.q.assemble(snap,'Overrides','overrides');self.q.start(task['id'],trusted=True);self.assertEqual(self.wait(task['id'])['status'],'complete',self.q.get(task['id']))
        sent=self.calls[-2]['workflow']
        self.assertEqual([c['workflow']['4']['inputs']['ckpt_name'] for c in self.calls[-2:]],['chosen.safetensors']*2)
        # V3 synthesizes a real core loader; prompts are never polluted with tags.
        self.assertEqual(sent['6']['inputs']['text'],'Ada at sea')
        self.assertEqual(sent['4:lora']['class_type'],'LoraLoader')
        self.assertEqual(sent['4:lora']['inputs']['strength_model'],0.2)
        self.assertEqual(sent['3']['inputs']['model'],['4:lora',0])
        self.assertEqual(sent['6']['inputs']['clip'],['4:lora',1])
        self.assertEqual(workflow['4']['inputs']['ckpt_name'],'blueprint.safetensors')
        listed=next(t for t in self.q.list()['tasks'] if t['id']==task['id']);self.assertEqual(listed['sources']['overrides']['model'],'chosen.safetensors')
        # No overrides → nothing frozen; an impossible override fails at assembly, not in the queue.
        self.assertIsNone(self.adapter.snapshot(body)['overrides'])
        with self.assertRaises(LibraryError):self.adapter.snapshot({**body,'overrides':{'model':'','loras':None}})
        config['comfyWorkflows'][0]['slots']={'model':{'enabled':False}}
        with self.assertRaises(LibraryError):self.adapter.snapshot({**body,'overrides':{'model':'chosen.safetensors'}})
        with self.assertRaises(LibraryError):self.adapter.snapshot({**body,'channelId':'channel-one','overrides':{'model':'chosen.safetensors'}})
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

    def test_seed_gate_accepts_scene_parameter_seed_mapping(self):
        # C1: the mapping wizard and the built-in workflows write the seed as a
        # scene parameter binding; the gate (and the compiler) must honour it.
        from backend.production.api import seed_binding_ready
        from backend.ecosystem.workflow import compile_workflow
        wf={'workflow':{'9':{'inputs':{'seed':42,'steps':20}}},'bindings':[{'enabled':True,'source':'sceneParameter','value':'seed','nodeId':'9','path':'seed'},{'enabled':True,'source':'sceneParameter','value':'steps','nodeId':'9','path':'steps'}]}
        self.assertTrue(seed_binding_ready(wf))
        # The seed flows even when the scene does not override render settings; other scene parameters stay gated.
        out=compile_workflow(wf['workflow'],wf['bindings'],'p',{'seed':777,'steps':30,'renderOverride':False},[])
        self.assertEqual(out['9']['inputs']['seed'],777);self.assertEqual(out['9']['inputs']['steps'],20)
        out=compile_workflow(wf['workflow'],wf['bindings'],'p',{'seed':778,'steps':30,'renderOverride':True},[])
        self.assertEqual((out['9']['inputs']['seed'],out['9']['inputs']['steps']),(778,30))
        wf['bindings'][0]['value']='width';self.assertFalse(seed_binding_ready(wf))
        wf['bindings']=[];self.assertFalse(seed_binding_ready(wf))

    def test_unbound_reference_images_are_dropped_instead_of_failing(self):
        # C2: a text-to-image graph has no LoadImage binding for prompt-referenced portraits.
        from backend.production.api import prune_unbound_images
        graph={'1':{'inputs':{'text':'hero'}},'2':{'inputs':{'image':'mio-image://2'}}}
        images=['/images/a.png','/images/b.png','/images/c.png']
        out,kept,dropped=prune_unbound_images(graph,images)
        self.assertEqual(kept,['/images/b.png']);self.assertEqual(dropped,['/images/a.png','/images/c.png'])
        self.assertEqual(out['2']['inputs']['image'],'mio-image://1')
        self.assertEqual(prune_unbound_images({'1':{'inputs':{'text':'hero'}}},images)[1:],([],images))
        same,kept,dropped=prune_unbound_images({'2':{'inputs':{'image':'mio-image://1'}}},['/images/a.png'])
        self.assertEqual((kept,dropped),(['/images/a.png'],[]))

    def test_inline_images_keep_stable_input_order(self):
        values={'hero':{'kind':'mio-image','src':'/images/one.png'}};images=[]
        self.assertEqual(interpolate('{hero} then {hero}',values,images),'@image_1 then @image_1');self.assertEqual(images,['/images/one.png'])
if __name__=='__main__':unittest.main()
