"""Same-origin assembly boundary. Source references are resolved and copied here."""
import copy
import hashlib
import json
from pathlib import Path
import re
import threading
import time
from backend.mio_library import LibraryError,atomic_write,image_type
from backend.ecosystem import api as ecosystem_api
from backend.ecosystem.workflow import compile_workflow
from backend.mio_channels import resolve_channel,CONFIG_FIELDS
from .queue import ProductionQueue

LOCK=threading.RLock()

def durable_assets(host,value):
    if isinstance(value,str) and value.startswith('/images/'):
        raw,_=host.native_store().image_bytes(value);_,ext=image_type(raw);name=hashlib.sha256(raw).hexdigest()+'.'+ext.lstrip('.')
        atomic_write(Path(host.DATA_DIR)/'production/assets'/name,raw)
        return '/images/production/assets/'+name
    if isinstance(value,dict):return {k:durable_assets(host,v) for k,v in value.items()}
    if isinstance(value,list):return [durable_assets(host,v) for v in value]
    return value

def typed(entry):
    value=entry.get('value','');kind=entry.get('type','text')
    if kind=='number':return float(value or 0)
    if kind=='boolean':return value is True or value=='true'
    if kind=='json':return json.loads(value) if isinstance(value,str) and value else value or {}
    if kind not in ('text','image'):raise LibraryError('生产端不接受未解析的插件类型，请使用标准类型保存预设')
    return value

def interpolate(text,values,images=None):
    def replace(match):
        key=match[1]
        if key not in values:raise LibraryError('缺少变量：'+key)
        value=values[key]
        if isinstance(value,dict) and value.get('kind')=='mio-image':
            if images is None:return ''
            if not value.get('src'):raise LibraryError('图片变量为空：'+key)
            if value['src'] not in images:images.append(value['src'])
            return '@image_'+str(images.index(value['src'])+1)
        return json.dumps(value,ensure_ascii=False) if isinstance(value,(dict,list)) else str(value if value is not None else '')
    return re.sub(r'\{([\w]+)\}',replace,str(text or ''))

def seed_binding_ready(workflow):
    for binding in workflow.get('bindings',[]):
        if not binding.get('enabled') or binding.get('source')!='random':continue
        try:
            graph=workflow.get('workflow',{});node=graph[str(binding['nodeId'])]['inputs'];path=str(binding['path'])
            parts=path[1:].split('/') if path.startswith('/') else path.split('.')
            for part in parts:node=node[int(part)] if isinstance(node,list) else node[part.replace('~1','/').replace('~0','~')]
            if type(node) in (int,float):return True
        except (KeyError,ValueError,IndexError,TypeError):continue
    return False

class ProductionAdapter:
    def __init__(self,host,eco):self.host=host;self.eco=eco
    def snapshot(self,body):
        store=self.host.native_store();presets=[]
        preview=body.get('preview') is True
        if preview:
            prompt=body.get('previewPrompt','')
            if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>100000:raise LibraryError('请填写有效试绘描述')
            story={'title':'预设独立试绘','frames':[{'name':'独立试绘','prompt':prompt,'caption':'','seed':-1}]}
        else:story=store.entity('storyboards',body['storyId'])['document']
        if len(body.get('presets',[]))>20:raise LibraryError('一次装配最多 20 份预设')
        for reference in body.get('presets',[]):
            if reference.get('kind') not in ('characters','scenes'):raise LibraryError('只能装配角色或场景预设')
            presets.append(store.entity(reference['kind'],reference['id'])['document'])
        config=store.read(include_baseline=False);channels=config.get('uiConfig',{}).get('comfyStudio',{}).get('settings',{}).get('imageGeneration',{})
        profile=next((p for p in channels.get('profiles',[]) if p.get('id')==body.get('channelId')),None)
        if not profile:raise LibraryError('请选择并保存有效图像渠道')
        profile=copy.deepcopy(profile)
        if profile.get('provider')=='comfyui':profile['baseUrl']=config.get('comfyConfig',{}).get('baseUrl','')
        workflow=copy.deepcopy(config.get('comfyConfig',{}))
        if profile.get('provider')=='comfyui' and body.get('workflowId'):
            selected=next((w for w in config.get('comfyWorkflows',[]) if w.get('id')==body['workflowId']),None)
            if not selected:raise LibraryError('所选工作流不存在，请重新选择')
            if not isinstance(selected.get('workflow'),dict) or not selected['workflow']:raise LibraryError('所选工作流为空，请先导入有效节点图')
            workflow.update({'id':selected['id'],'title':selected.get('title',''),'workflow':copy.deepcopy(selected['workflow']),'bindings':copy.deepcopy(selected.get('bindings',[])),'outputNodeId':selected.get('outputNodeId','')})
        seed_enabled=body.get('seedEnabled') is True and profile.get('provider')=='comfyui'
        if seed_enabled and not seed_binding_ready(workflow):raise LibraryError('请先配置所选工作流中的有效种子节点映射')
        seed=body.get('seed',1)
        if type(seed)is not int or not 0<=seed<2**32:raise LibraryError('种子必须为 uint32 整数')
        return durable_assets(self.host,{'story':story,'presets':presets,'channel':{k:copy.deepcopy(profile[k]) for k in CONFIG_FIELDS if k in profile},'workflow':workflow,'seedEnabled':seed_enabled,'projectId':body.get('projectId') or story.get('projectId'),'seed':seed,'preview':preview,'previewPresetId':presets[0]['id'] if preview and len(presets)==1 else None})
    def prepare(self,task,cancel):
        entries={}
        for preset in task['snapshot']['presets']:
            for entry in preset.get('entries',[]):
                value=copy.deepcopy(entry)
                if not value.get('compute'):value['value']=typed(value)
                entries[value['key']]=value
        # Syntax/dependency validation and all model calls occur only on explicit start.
        id=self.eco.macros.start({'owner':task['id'],'seed':task['snapshot']['seed'],'entries':list(entries.values()),'trusted':True,'force':task.get('forcePrepare',False)})['id']
        while True:
            if cancel.is_set():self.eco.macros.cancel(id);raise InterruptedError('前置准备已取消')
            record=self.eco.macros.get(id)
            if record['status']=='complete':return {'values':durable_assets(self.host,record['values']),'preparationId':id}
            if record['status'] in ('failed','cancelled','interrupted'):raise LibraryError(record.get('error','前置准备未完成'))
            cancel.wait(.1)
    def render(self,task,index,cancel):
        snap=task['snapshot'];frame=snap['story']['frames'][index];values=task['prepared']['values'];images=[]
        prompt=interpolate(frame.get('prompt',''),values,images)
        caption=interpolate(frame.get('caption',''),values)
        negative=interpolate(frame.get('negative',''),values,images)
        config=self.host.native_store().read(include_baseline=False);live=resolve_channel(config,snap['channel']['id'],snap['channel']['provider']);channel=copy.deepcopy(snap['channel']);channel.update({k:live[k] for k in ('keyId','keyMode') if k in live})
        if channel['provider']=='comfyui':channel['baseUrl']=channel.get('baseUrl') or live['baseUrl']
        params={k:frame[k] for k in ('width','height','steps','cfg','denoise','seed') if k in frame};params['seed']=(snap['seed']+index)%2**32 if params.get('seed',-1)<0 else params.get('seed',(snap['seed']+index)%2**32)
        payload={'config':channel,'prompt':prompt,'negative':negative,'images':images,'frame':params,'_requestTimeout':180}
        if channel['provider']=='comfyui':
            wf=snap['workflow'];rules=copy.deepcopy(wf.get('bindings',[]))
            for p in snap['presets']:rules.extend(p.get('bindings',[]))
            if not snap.get('seedEnabled'):rules=[b for b in rules if b.get('source')!='random']
            payload['workflow']=compile_workflow(wf.get('workflow',{}),rules,prompt,{**params,'negative':negative,'variables':values,'renderOverride':frame.get('renderOverride',False),'title':task['title'],'sceneName':frame.get('name',''),'caption':caption},images);channel['outputNodeId']=wf.get('outputNodeId','')
        previous=None
        try:previous=next((p.get('image') for p in self.host.native_store().entity('albums',task['albumId'])['document'].get('steps',[]) if p.get('stepIndex')==index),None)
        except LibraryError as exc:
            if exc.status!=404:raise
        if cancel.is_set():raise InterruptedError('分幕提交前已取消')
        result=self.host.generate_provider_image(payload)
        return {'image':durable_assets(self.host,result['image']),'prompt':prompt,'caption':caption,'previousImage':previous,'name':frame.get('name','第 '+str(index+1)+' 幕')}
    def publish(self,task,index,result):
        if task['snapshot'].get('preview'):return
        from backend.mio_lifecycle import deleted_album_ids
        if task['albumId'] in deleted_album_ids(self.host.DATA_DIR):raise LibraryError('画册已被删除，生成结果保留在任务记录，未重新创建')
        store=self.host.native_store()
        try:record=store.entity('albums',task['albumId']);album=record['document'];revision=record['etag']
        except LibraryError as exc:
            if exc.status!=404:raise
            revision=None;album={'id':task['albumId'],'projectId':task['snapshot']['projectId'],'title':task['title'],'totalSteps':len(task['pages']),'generatedSteps':0,'steps':[],'status':'generating','createdAt':int(task['createdAt']*1000),'assemblyId':task['id'],'synopsis':task['snapshot']['story'].get('outline',''),'tags':['装配作品'],'characterName':'','templateTitle':task['snapshot']['story'].get('title','')}
        old=next((p for p in album['steps'] if p.get('stepIndex')==index),None)
        if old and Path(old['image']).name==Path(result['image']).name and old.get('caption')==result.get('caption') and old.get('prompt')==result.get('prompt'):return
        if (old or {}).get('image')!=result.get('previousImage'):raise LibraryError('该页在生成期间已被修改。新结果保留在任务记录，未覆盖当前图片。')
        page={'stepIndex':index,**{k:result[k] for k in ('image','prompt','caption','name')}}
        album['steps']=[p for p in album['steps'] if p.get('stepIndex')!=index]+[page];album['steps'].sort(key=lambda p:p['stepIndex']);album['generatedSteps']=len(album['steps']);album['status']='complete' if len(album['steps'])==album['totalSteps'] else 'generating';album['updatedAt']=int(time.time()*1000)
        store.apply([{'kind':'albums','id':album['id'],'document':album,'expected':revision}],internal=True)

def service(host):
    eco=ecosystem_api.service(host)
    with LOCK:
        if not hasattr(eco,'production'):
            adapter=ProductionAdapter(host,eco);eco.production=ProductionQueue(host.DATA_DIR,adapter.prepare,adapter.render,adapter.publish);eco.production_adapter=adapter
        return eco

def dispatch(handler,host,path):
    if not path.startswith('/api/production/'):return False
    try:
        eco=service(host);queue=eco.production;route=path[len('/api/production/'):]
        if handler.command=='GET' and route=='tasks':result=queue.list()
        elif handler.command=='POST':
            body=handler.read_json_body(max_bytes=2*1024*1024)
            if route=='assemble':result=queue.assemble(eco.production_adapter.snapshot(body),body.get('title'),body.get('requestId'))
            elif route=='assemble-batch':
                items=body.get('items')
                if not isinstance(items,list) or not 1<=len(items)<=100:raise LibraryError('批量装配需包含 1–100 项')
                result=queue.assemble_many([(eco.production_adapter.snapshot(item),item.get('title'),item.get('requestId')) for item in items])
            elif route=='start':result=queue.start(body['id'],body.get('sequential') is True,body.get('indices'),body.get('trusted') is True,body.get('forcePrepare') is True)
            elif route=='recover-publication':result=queue.recover_publication(body['id'],body['index'])
            elif route=='pause':result=queue.pause()
            elif route=='resume':result=queue.resume()
            elif route=='cancel':result=queue.cancel()
            elif route=='remove':result=queue.remove(body['id'])
            else:raise LibraryError('未知生产操作',404)
        else:raise LibraryError('未知生产接口',404)
        handler.send_json(200,{'data':result})
    except LibraryError as exc:handler.send_json(exc.status,{'error':str(exc)})
    except Exception as exc:handler.send_json(400,{'error':str(exc)[:500]})
    return True
