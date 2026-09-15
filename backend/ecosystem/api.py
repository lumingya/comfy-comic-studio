"""Same-origin management API. Installing/enabling executable packages requires explicit trust."""
import base64
import copy
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import shutil
import threading
import urllib.parse
from backend.mio_library import LibraryError,atomic_write,image_type
from .storage import Storage,identifier,owned
from .plugins import Plugins
from .themes import Themes
from .macros import Macros,signature

SERVICES={};LOCK=threading.RLock()

class Ecosystem:
    def __init__(self,host):
        self.host=host;self.plugins=Plugins(host.BASE_DIR,host.DATA_DIR);self.themes=Themes(host.DATA_DIR)
        self.macros=Macros(host.DATA_DIR,self.invoke,self.configuration_signature,self.asset_exists)
        if os.environ.get('MIO_SAFE_MODE')!='1':self.plugins.boot()
    def configuration_signature(self):
        config=self.host.native_store().read(include_baseline=False)
        return signature({'comfy':config.get('comfyConfig'),'profiles':config.get('uiConfig',{}).get('comfyStudio',{}).get('settings',{}).get('imageGeneration'),'llm':config.get('llmConfig'),'workflows':config.get('comfyWorkflows')})
    def asset_exists(self,value):
        if isinstance(value,dict) and value.get('kind')=='mio-image':
            try:return self.host.native_store().image_path(value['src']).is_file()
            except Exception:return False
        return True
    def invoke(self,method,args):
        host=self.host;prompt=args.get('prompt');options=args.get('options',{})
        if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>100000 or not isinstance(options,dict):raise LibraryError('SDK call requires prompt and options')
        config=host.native_store().read(include_baseline=False)
        if method=='llm.chat':
            cfg=host.native_store().settings.resolve('llm')
            result=host.chat_proxy({'scope':'llm','baseUrl':cfg.get('baseUrl',''),'body':{'model':options.get('model',cfg.get('model')),'messages':[{'role':'user','content':prompt}],**{k:options[k] for k in ('temperature','max_tokens') if k in options}}})
            return result['choices'][0]['message']['content']
        if method!='image.generate':raise LibraryError('Unknown SDK API')
        generation=config.get('uiConfig',{}).get('comfyStudio',{}).get('settings',{}).get('imageGeneration',{})
        profile=next((p for p in generation.get('profiles',[]) if p.get('id')==options.get('channelId',generation.get('active'))),None)
        if not profile:raise LibraryError('Select and save an image channel first')
        cfg=copy.deepcopy(profile)
        payload={'config':cfg,'prompt':prompt,'negative':options.get('negative',''),'frame':{k:options[k] for k in ('width','height','seed','steps','cfg') if k in options},'images':[v['src'] if isinstance(v,dict) else v for v in options.get('images',[])],'_requestTimeout':min(int(options.get('timeout',120)),180)}
        if cfg['provider']=='comfyui':
            comfy=config.get('comfyConfig',{});cfg['baseUrl']=comfy.get('baseUrl','');cfg['outputNodeId']=comfy.get('outputNodeId','')
            preset=next((x for x in config.get('comfyWorkflows',[]) if x.get('id')==options.get('workflowId')),None)
            if options.get('workflowId') and not preset:raise LibraryError('Saved workflow not found')
            workflow=copy.deepcopy(options.get('workflow') or (preset or comfy).get('workflow',{}))
            if not workflow:raise LibraryError('Save an API workflow, or pass options.workflow')
            if not options.get('workflow'):
                from .workflow import compile_workflow
                workflow=compile_workflow(workflow,(preset or comfy).get('bindings',comfy.get('bindings',[])),prompt,options,payload['images'])
            payload['workflow']=workflow
        result=host.generate_provider_image(payload);src=result['image']
        if isinstance(src,dict):src=src.get('localUrl') or src.get('url')
        if not isinstance(src,str):raise LibraryError('Provider returned no image')
        raw,_=host.native_store().image_bytes(src);mime,suffix=image_type(raw)
        name=hashlib.sha256(raw).hexdigest()+'.'+suffix.lstrip('.')
        atomic_write(Path(host.DATA_DIR)/'macro-assets'/name,raw)
        return {'kind':'mio-image','src':'/images/ecosystem/macros/'+name,'name':options.get('name','计算资产'),'mime':mime}
    def close(self):
        if hasattr(self,'production'):self.production.close()
        self.plugins.close()
        for cancel in self.macros.running.values():cancel.set()

def service(host):
    key=(str(host.BASE_DIR),str(host.DATA_DIR))
    with LOCK:
        if key not in SERVICES:SERVICES[key]=Ecosystem(host)
        return SERVICES[key]

def dispatch(handler,host,path):
    if not path.startswith(('/api/ecosystem/','/api/extensions/','/extension-assets/')):return False
    try:
        svc=service(host);method=handler.command
        if path.startswith('/extension-assets/'):
            id,relative=path[len('/extension-assets/'):].split('/',1);p=svc.plugins.asset(id,urllib.parse.unquote(relative));raw=p.read_bytes()
            if len(raw)>16*1024*1024:raise LibraryError('Asset too large')
            handler.send_response(200);handler.send_header('Content-Type',mimetypes.guess_type(p)[0] or 'application/octet-stream');handler.send_header('X-Content-Type-Options','nosniff');handler.send_header('Content-Length',str(len(raw)));handler.end_headers();handler.wfile.write(raw);return True
        body=handler.read_json_body(max_bytes=48*1024*1024) if method=='POST' else {}
        if path.startswith('/api/extensions/'):
            id,sep,tail=path[len('/api/extensions/'):].partition('/');identifier(id)
            if not svc.plugins.records().get(id,{}).get('enabled'):raise LibraryError('Extension disabled',403)
            if tail=='storage':
                storage=Storage(Path(host.DATA_DIR)/'extensions'/id)
                if method=='GET':result=storage.get(urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query).get('key',[''])[0])
                elif body.get('delete'):storage.delete(body['key']);result=None
                else:result=storage.set(body['key'],body.get('value'))
            else:result=svc.plugins.call(id,method,'/'+tail,body if method=='POST' else urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query))
        else:
            route=path[len('/api/ecosystem/'):]
            if method=='GET' and route=='status':result={'extensions':svc.plugins.list(),'themes':svc.themes.list(),'node':bool(shutil.which('node')),'git':bool(shutil.which('git')),'safeMode':os.environ.get('MIO_SAFE_MODE')=='1','sdkVersion':1}
            elif method=='GET' and route.startswith('themes/css/'):
                result={'css':svc.themes.css(route.split('/')[-1])}
            elif method=='GET' and route=='preparations':result=svc.macros.list()
            elif method=='GET' and route.startswith('preparations/'):
                result=svc.macros.get(route.split('/')[-1])
            elif method=='POST' and route=='cache/clear':result=svc.macros.clear_cache(body.get('trusted'))
            elif method=='POST' and route=='preparations':result=svc.macros.start(body)
            elif method=='POST' and route=='preparations/cancel':result=svc.macros.cancel(body['id'])
            elif method=='POST' and route=='extensions/install':
                if os.environ.get('MIO_SAFE_MODE')=='1':raise LibraryError('Installation disabled in backend safe mode',403)
                result=svc.plugins.install(url=body.get('url'),branch=body.get('branch',''),raw=base64.b64decode(body['zip'],validate=True) if body.get('zip') else None,trusted=body.get('trusted') is True)
            elif method=='POST' and route=='extensions/enable':
                if body.get('enabled') and body.get('trusted') is not True:raise LibraryError('Confirm trusted code execution',403)
                if body.get('enabled') and os.environ.get('MIO_SAFE_MODE')=='1':raise LibraryError('Backend safe mode disables extensions',403)
                svc.plugins.enable(body['id'],bool(body.get('enabled')));result=svc.plugins.list()
            elif method=='POST' and route=='extensions/update':svc.plugins.update(body['id'],body.get('trusted') is True);result=svc.plugins.list()
            elif method=='POST' and route=='extensions/uninstall':svc.plugins.uninstall(body['id'],body.get('deleteData') is True);result=svc.plugins.list()
            elif method=='POST' and route=='themes/install':result=svc.themes.install(base64.b64decode(body['data'],validate=True),body['filename'],body.get('trusted') is True)
            elif method=='POST' and route=='themes/select':result=svc.themes.select(body.get('id',''))
            elif method=='POST' and route=='themes/uninstall':svc.themes.uninstall(body['id']);result=svc.themes.list()
            elif method=='POST' and route=='reset':
                svc.themes.select('')
                for id in list(svc.plugins.records()):svc.plugins.enable(id,False)
                result={'reset':True}
            else:raise LibraryError('Unknown ecosystem route',404)
        handler.send_json(200,{'data':result})
    except LibraryError as e:handler.send_json(e.status,{'error':str(e)[:800]})
    except Exception as e:handler.send_json(400,{'error':str(e)[:500]})
    return True
