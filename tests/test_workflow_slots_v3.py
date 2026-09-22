"""Independent v3 acceptance assertions (not generated from the executor)."""
import copy
import json
import unittest
from pathlib import Path
from backend.ecosystem import workflow_slots as s
from backend.mio_library import LibraryError


def node(cls='Arbitrary', **inputs):
    return {'class_type': cls, 'inputs': inputs}


def lora(name='turbo', source='1', **more):
    return node(model=[source, 0], lora_name=name, strength_model=1, **more)


def basic():
    return {'1': node(ckpt_name='base.safetensors'), '2': lora(), '3': node(model=['2', 0], latent_image=['4', 0]), '4': node(width=512)}


def info(output, **required):
    return {'output': output, 'input': {'required': required}}


def fixtures():
    """Small, plugin-name-independent examples plus the repository's alice blueprint."""
    cases = []
    def add(name, wf, overrides=None, object_info=None, manual=None, enable=None):
        cases.append({'name': name, 'workflow': wf, 'overrides': overrides if overrides is not None else {'loras': [{'name': 'A', 'strength': .8}]},
                      'objectInfo': object_info or {}, 'manual': manual or [], 'enable': enable or []})
    w=basic();w.update({'5':node(ckpt_name='BASE.safetensors'),'6':node(ckpt_name='other.safetensors'),'7':node(model=['5',0]),'8':node(model=['6',0])})
    add('same-file',w,{'model':'new.safetensors'})
    w={'1':node(ckpt_name='base.safetensors'),'o':node(model=['1',0],loras={'__value__':[{'name':'turbo','strength':'0.5','active':True},{'name':'library','strength':1,'active':False}]},text='<lora:library:1>')}
    for i in range(3):w[str(i+2)]=node(model=['1',0],lora_syntax=['o',3]);w['s'+str(i)]=node(model=[str(i+2),0])
    w['meta']=node(lora_syntax=['o',3])
    add('relay-three',w)
    w=copy.deepcopy(w);w['o']=node(on_true=['a',0],on_false=['b',0],boolean=True);w['a']=node(text='x');w['b']=node(text='y')
    add('opaque-three',w)
    add('pin-append',basic());add('unpin',basic(),{'unpin':['turbo'],'loras':[{'name':'A','strength':.8}]})
    add('same-name',basic(),{'loras':[{'name':'turbo','strength':.9}]})
    add('same-file-extension',basic(),{'loras':[{'name':'turbo.safetensors','strength':.9}]})
    w={'1':node(ckpt_name='base.safetensors')}
    for i in range(2,14):w[str(i)]=node(model=[str(i-1),0],lora_1={'lora':'pin'+str(i),'strength':.5,'on':True})
    w['s']=node(model=['13',0]);add('twelve-series',w)
    w={'1':node(ckpt_name='high.safetensors'),'2':lora('high'),'3':node(model=['2',0],latent_image=['x',0]),'4':node(ckpt_name='low.safetensors'),'5':lora('low','4'),'6':node(model=['5',0],latent_image=['3',0]),'x':node(width=512)}
    add('paired',w,{'model':{'1:ckpt_name':'new-high.safetensors','4:ckpt_name':'new-low.safetensors'},'loras':[{'name':'A','strength':.8}]})
    w={'1':node(ckpt_name='base.safetensors'),'p':node(lora_1='pool',strength_1=1),'2':node(model=['1',0],lora_stack=['p',0],loras=[{'name':'own','strength':.5}]),'3':node(model=['2',0])}
    add('single-entry',w)
    w=copy.deepcopy(w);w['p']=node(seed=1);w['c']=node(lora_stack=['p',0]);w['2']['inputs']['lora_stack']=['c',0];add('readonly-pool',w)
    for count in (0,1,2):
        w={'1':node(ckpt_name='base.safetensors',lora_name='turbo',lora_strength=1),'2':node(model=['1',0])}
        add('embedded-'+str(count),w,{'unpin':['turbo'],'loras':[{'name':chr(65+i),'strength':.8} for i in range(count)]})
    for mode in ('simple','advanced'):
        w={'1':node(lora_1_name='None',strength_1=1,model_strength_1=1,clip_strength_1=1,lora_2_name='None',strength_2=1,model_strength_2=1,clip_strength_2=1,num_loras=0,mode=mode),'2':node(lora_stack=['1',0])}
        add('easy-'+mode,w)
    w=basic();w['switch']=node(on_true=['2',0],on_false=['1',0],boolean=False);w['3']['inputs']['model']=['switch',0]
    oi={'Arbitrary':info(['MODEL'])}
    add('dead-bool',w,{},oi);add('dead-explicit',w,None,oi,enable=['origin:2:lora_name'])
    w=copy.deepcopy(w);w['switch']=node(input1=['2',0],input2=['1',0],select=2);add('dead-select',w,{},oi)
    w={'1':node('Core',unet_name='base.safetensors'),'2':node(model=['1',0])}
    add('synth-model',w,object_info={'Core':info(['MODEL'])})
    w={'1':node('Alien',model='alien.safetensors'),'2':node(model=['1',0])};add('alien-disabled',w,object_info={'Alien':info(['FOREIGNMODEL'])})
    w={'p':node(value='base.safetensors'),'1':node(ckpt_name=['p',0]),'2':node(model=['1',0])};add('primitive-model',w,{'model':'new.safetensors'})
    w=copy.deepcopy(w);w['p']=node(on_true=['a',0],on_false=['b',0],boolean=True);add('switch-model',w,{'model':'new.safetensors'})
    w=basic();w['n']=node(negative='embedding:x.pt');add('negative-not-model',w,{})
    w=basic();w['197:189']=w.pop('2')
    for i in range(8):w['s'+str(i)]=node(model=['197:189',0])
    w.pop('3');add('subgraph-growth',w)
    w={'1':node('Core',ckpt_name='base.safetensors'),'2':node(model=['1',0])};add('enum-error',w,{'model':'absent.safetensors'},{'Core':info(['MODEL'],ckpt_name=[['base.safetensors']])})
    w={'1':node(lora_1='None',strength_1=1),'2':node(model=['1',0])};add('manual-embedded',w,manual=[{'nodeId':'1','path':'lora_1'}])
    w={'1':node('Core',ckpt_name='base.safetensors'),'2':node(model=['1',0]),'3':node(clip=['1',1],text='prompt')};add('synth-clip',w,object_info={'Core':info(['MODEL','CLIP','VAE'])})
    w=basic();w['2']['inputs'].update(lora_name='None',strength_model=0);add('negative-strength',w,{'loras':[{'name':'A','strength':-2}]})
    add('range-error',w,{'loras':[{'name':'A','strength':6}]})
    w=basic();w['2']['class_type']='Typed';add('declared-range',w,{'loras':[{'name':'A','strength':12}]},{'Typed':info(['MODEL'],strength_model=['FLOAT',{'min':-20,'max':20}])})
    w={'1':node(ckpt_name='base.safetensors'),'2':node(model=['1',0],lora_syntax='prefix <lora:old:0.5> <lora:unknown:bad:tag>'),'3':node(model=['2',0])};add('unknown-tags',w,{'unpin':['old'],'loras':[{'name':'A','strength':.8}]})
    w=basic();w['5']=lora('other','2');w['3']['inputs']['model']=['5',0];add('series-override-existing',w,{'loras':[{'name':'turbo','strength':.3}]})
    w={'1':node(lora_1='pinned',strength_1=1),'2':node(lora_stack=['1',0])};add('stack-overflow',w)
    w=basic();add('all-disabled',w,{'loras':[{'name':'A','strength':.8}],'disabled':['origin:2:lora_name']})
    add('alice',json.loads((Path(__file__).parents[1]/'docs/workflows/alice_copy_workflow.json').read_text())['workflow'],{'model':'new.safetensors','loras':[{'name':'A','strength':.8}]})
    return cases


class V3Acceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases={x['name']:x for x in fixtures()}

    def run_case(self,name):
        f=copy.deepcopy(self.cases[name]);wf=f['workflow'];before=copy.deepcopy(wf)
        plan=s.analyze(wf,f['objectInfo'],f['manual'])
        for g in plan['lora']['groups']:
            if g['key'] in f['enable']:g['enabled']=True
        frozen=copy.deepcopy(plan)
        result=s.apply(wf,plan,f['overrides'],f['objectInfo'])
        self.assertEqual(wf,before);self.assertEqual(plan,frozen)
        self.assertEqual(result,s.apply(wf,plan,f['overrides'],f['objectInfo']))
        return plan,result['workflow'],result

    def test_same_file(self):
        p,w,_=self.run_case('same-file');self.assertEqual([t['role'] for t in p['model']['targets']],['primary','same','other'])
        self.assertEqual(w['1']['inputs']['ckpt_name'],'new.safetensors');self.assertEqual(w['5']['inputs']['ckpt_name'],'new.safetensors');self.assertEqual(w['6']['inputs']['ckpt_name'],'other.safetensors')
    def test_relay(self):
        p,w,_=self.run_case('relay-three');self.assertEqual(len(p['lora']['groups']),1);self.assertEqual(len(p['lora']['groups'][0]['sites']),3)
        self.assertEqual([e['name'] for e in w['o']['inputs']['loras']['__value__']],['turbo','A']);self.assertEqual(w['meta']['inputs']['lora_syntax'],['o',3]);self.assertEqual(w['2']['inputs']['lora_syntax'],['o',3])
    def test_opaque(self):
        p,w,_=self.run_case('opaque-three');self.assertEqual(len(p['lora']['groups']),1)
        self.assertEqual([w[str(i)]['inputs']['lora_syntax'] for i in range(2,5)],['<lora:A:0.8>']*3)
    def test_pins(self):
        _,w,_=self.run_case('pin-append');self.assertEqual(w['2']['inputs']['lora_name'],'turbo');self.assertEqual(w['2:lora1']['inputs']['lora_name'],'A');self.assertEqual(w['3']['inputs']['model'],['2:lora1',0])
        _,w,_=self.run_case('unpin');self.assertEqual(w['2']['inputs']['lora_name'],'A');self.assertNotIn('2:lora1',w)
        _,w,_=self.run_case('same-name');self.assertEqual(w['2']['inputs']['strength_model'],.9);self.assertNotIn('2:lora1',w)
    def test_name_file_alias(self):
        _,w,_=self.run_case('same-file-extension');self.assertNotIn('2:lora1',w);self.assertEqual(w['2']['inputs']['strength_model'],.9)

    def test_series(self):
        p,w,_=self.run_case('twelve-series');self.assertEqual(sum(g['append'] for g in p['lora']['groups']),1)
        for i in range(2,13):self.assertEqual(w[str(i)],self.cases['twelve-series']['workflow'][str(i)])
        self.assertEqual(w['13']['inputs']['lora_2']['lora'],'A')
        _,w,_=self.run_case('series-override-existing');self.assertEqual(w['2']['inputs']['strength_model'],.3);self.assertNotIn('5:lora1',w)
    def test_paired(self):
        p,w,_=self.run_case('paired');self.assertTrue(p['model']['paired']);self.assertEqual(w['1']['inputs']['ckpt_name'],'new-high.safetensors');self.assertEqual(w['4']['inputs']['ckpt_name'],'new-low.safetensors');self.assertIn('2:lora1',w);self.assertIn('5:lora1',w)
    def test_single_entry(self):
        for n in ('single-entry','readonly-pool'):
            p,w,_=self.run_case(n);self.assertEqual(len(p['lora']['groups']),1);self.assertEqual(w['p'],self.cases[n]['workflow']['p']);self.assertEqual(w['2']['inputs']['loras'][-1]['name'],'A')
    def test_embedded(self):
        _,w,_=self.run_case('embedded-0');self.assertEqual(w['1']['inputs']['lora_strength'],0)
        _,w,_=self.run_case('embedded-1');self.assertEqual(w['1']['inputs']['lora_name'],'A')
        with self.assertRaisesRegex(LibraryError,'最多 1 个'):self.run_case('embedded-2')
    def test_stack(self):
        for n in ('easy-simple','easy-advanced'):
            p,w,_=self.run_case(n);self.assertEqual(p['lora']['groups'][0]['kind'],'stack');self.assertEqual(w['1']['inputs']['num_loras'],1);self.assertEqual(w['1']['inputs']['lora_1_name'],'A');self.assertEqual(w['1']['inputs']['model_strength_1'],.8)
        with self.assertRaisesRegex(LibraryError,'槽位'):self.run_case('stack-overflow')
    def test_dead(self):
        for n in ('dead-bool','dead-select'):
            p,w,_=self.run_case(n);self.assertFalse(p['lora']['groups'][0]['active']);self.assertTrue(any(i['code']=='dead-branch' for i in p['issues']));self.assertEqual(w,self.cases[n]['workflow'])
        _,w,r=self.run_case('dead-explicit');self.assertIn('2:lora1',w);self.assertTrue(any('手动启用' in x for x in r['notices']))
    def test_synth(self):
        p,w,_=self.run_case('synth-model');self.assertEqual(w['1:lora']['class_type'],'LoraLoaderModelOnly');self.assertEqual(w['2']['inputs']['model'],['1:lora',0])
        _,w,_=self.run_case('synth-clip');self.assertEqual(w['1:lora']['class_type'],'LoraLoader');self.assertEqual(w['3']['inputs']['clip'],['1:lora',1])
        with self.assertRaisesRegex(LibraryError,'没有可用'):self.run_case('alien-disabled')
    def test_linked(self):
        p,w,_=self.run_case('primitive-model');self.assertEqual(p['model']['targets'][0]['nodeId'],'p');self.assertEqual(w['p']['inputs']['value'],'new.safetensors');self.assertEqual(w['1']['inputs']['ckpt_name'],['p',0])
        with self.assertRaises(LibraryError):self.run_case('switch-model')
    def test_negative(self):
        p,_,_=self.run_case('negative-not-model');self.assertFalse(any(t['nodeId']=='n' for t in p['model']['targets']))
    def test_subgraph(self):
        _,w,_=self.run_case('subgraph-growth')
        for i in range(8):self.assertEqual(w['s'+str(i)]['inputs']['model'],['197:189:lora1',0])
    def test_guards(self):
        for n in ('enum-error','range-error','all-disabled'):
            with self.subTest(n=n),self.assertRaises(LibraryError):self.run_case(n)
        _,w,_=self.run_case('negative-strength');self.assertEqual(w['2']['inputs']['strength_model'],-2)
        _,w,_=self.run_case('declared-range');self.assertEqual(w['2:lora1']['inputs']['strength_model'],12)
    def test_manual(self):
        p,w,_=self.run_case('manual-embedded');self.assertEqual(p['lora']['groups'][0]['kind'],'embedded');self.assertEqual(w['1']['inputs']['lora_1'],'A')
    def test_unknown_tags(self):
        _,w,_=self.run_case('unknown-tags');text=w['2']['inputs']['lora_syntax'];self.assertIn('<lora:unknown:bad:tag>',text);self.assertNotIn('<lora:old:',text);self.assertIn('<lora:A:0.8>',text)
    def test_alice(self):
        p,w,_=self.run_case('alice');self.assertEqual(w['3699']['inputs']['ckpt_name'],'new.safetensors');self.assertEqual(w['4528']['inputs']['ckpt_name'],'new.safetensors')
        self.assertEqual(len(p['lora']['groups']),1);g=p['lora']['groups'][0];self.assertEqual(len(g['sites']),3);self.assertEqual(len(g['pinned']),2)
        self.assertEqual(w['2295']['inputs']['loras']['__value__'][-1]['name'],'A');self.assertEqual(w['4277'],self.cases['alice']['workflow']['4277'])
    def test_migration_and_hash(self):
        w=basic();p=s.ensure_plan(w,{'model':{'auto':False,'nodeId':'absent','path':'model'}})
        self.assertTrue(any(i['code']=='legacy-missing' for i in p['issues']));self.assertFalse(p['model']['targets'][0]['enabled'])
        self.assertEqual(s.ensure_plan(w,{'plan':p}),p)
        q=s.ensure_plan(w,{'plan':p},{'Arbitrary':info(['MODEL'])});self.assertNotEqual(q['objectInfoHash'],p['objectInfoHash'])
    def test_plan_ids_are_not_credentials(self):
        from backend.mio_library import assert_no_credentials, scrub
        from backend.mio_library_settings import leaves
        plan=s.analyze(basic());doc={'slots':{'plan':plan},'apiKey':'secret'}
        public={'slots':doc['slots']}
        assert_no_credentials(public)
        self.assertEqual(list(leaves(public)),[])
        self.assertEqual(scrub(public)['slots']['plan']['model']['targets'][0]['key'],'1:ckpt_name')
        self.assertEqual([k for _,k,_ in leaves(doc)],['apiKey'])
        bad=copy.deepcopy(public);bad['slots']['plan']['model']['targets'][0]['key']='not-a-slot-secret'
        with self.assertRaises(LibraryError):assert_no_credentials(bad)
        self.assertEqual(len(list(leaves(bad))),1)
        with self.assertRaises(LibraryError):assert_no_credentials({'key':'still-secret'})

    def test_cycles_and_bound(self):
        w={'a':node(text=['b',0]),'b':node(text=['a',0])}
        self.assertFalse(s.trace_origin(w,['a',0],{'Arbitrary':info(['STRING'],text=['STRING'])})['writable']);s.analyze(w)

if __name__=='__main__':unittest.main()
