"""Local foundation API; public calls are authenticated by mio_api first."""
import copy
from mio_channels import channel_reference, resolve_channel, channel_preview
import hashlib
import json
import os
import re
import threading
import time
import urllib.parse
from pathlib import Path
from mio_jobs import Jobs, Conflict
_STORES={};_LOCK=threading.RLock()

def jobs(host):
    root=os.path.join(host.DATA_DIR,'execution')
    with _LOCK:
        if root not in _STORES:_STORES[root]=Jobs(root,host.generate_provider_image,lambda row,frame:latest_frame_input(host,row,frame))
        return _STORES[root]

def latest_frame_input(host,row,original):
    """One saved-workspace snapshot supplies scene content AND current channel configuration."""
    payload=json.loads(row['payload']);channel_id=channel_reference(payload,original)
    if not channel_id and not (payload.get('owner') and payload.get('albumId')):return original
    config=host.read_merged_config_raw() if hasattr(host,'read_merged_config_raw') else host.read_merged_config()
    frame=copy.deepcopy(original)
    if payload.get('owner') and payload.get('albumId'):
        book=next((b for b in config.get('savedGalleries',[]) if b.get('id')==payload['albumId']),None)
        entry=(book or {}).get('sourceSnapshot',{}).get('liveInputs',{}).get(str(original.get('frameIndex',row['idx'])))
        if entry and entry.get('savedAt',0)/1000>=row.get('last_amended',0):
            if entry.get('error'):raise ValueError('Saved scene cannot be submitted: '+str(entry['error']))
            fresh=entry.get('input')
            if not isinstance(fresh,dict) or (fresh.get('config',{}).get('provider')!=original['config']['provider'] if channel_id else fresh.get('config')!=original.get('config')) or fresh.get('albumId')!=original.get('albumId') or fresh.get('frameIndex')!=original.get('frameIndex') or channel_reference(payload,fresh)!=channel_id:
                raise ValueError('Saved scene binding changed; refusing to submit a different channel or album')
            frame=copy.deepcopy(fresh)
    if channel_id:
        current=resolve_channel(config,channel_id,original['config']['provider'])
        if current['provider']=='comfyui':
            # Graph/output selection belongs to the task; the server address belongs to the channel.
            current['outputNodeId']=original['config'].get('outputNodeId','')
        frame['config']=current
    return frame


def references(value, label, output):
    if isinstance(value,str) and value.startswith('/images/'):
        path=urllib.parse.unquote(urllib.parse.urlsplit(value).path)
        output.setdefault(path,set()).add(label)
    elif isinstance(value,dict):
        for k,v in value.items():references(v,label+'/'+str(k),output)
    elif isinstance(value,list):
        for i,v in enumerate(value):references(v,label+'/'+str(i),output)

def inventory(host,verify=False):
    store=jobs(host);refs={}
    references(host.read_merged_config(),'workspace',refs)
    for id,payload,results in store.references():
        references(payload,'job/'+id,refs);references(results,'result/'+id,refs)
    records=[];root=Path(host.IMAGES_DIR)
    index_file=Path(host.DATA_DIR)/'assets'/'catalog.json'
    try:cache=json.loads(index_file.read_text())
    except (OSError,ValueError):cache={}
    try:origins=json.loads((Path(host.DATA_DIR)/'assets'/'origins.json').read_text())
    except (OSError,ValueError):origins={}
    fresh={}
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.is_symlink() or path.name.endswith('.tmp'):continue
        url='/images/'+path.relative_to(root).as_posix();stat=path.stat();stamp=[stat.st_mtime_ns,stat.st_size]
        item=cache.get(url)
        if verify or not item or item.get('stamp')!=stamp:
            raw=path.read_bytes()
            try:mime=host.detect_image_mime_type(raw)
            except ValueError:mime='application/octet-stream'
            width,height=image_dimensions(raw,mime)
            item={'url':url,'name':path.name,'mime':mime,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'modified':stat.st_mtime,'width':width,'height':height,'stamp':stamp}
        fresh[url]=item;record={**item,'references':sorted(refs.get(url,[])),**origins.get(url,{'created':stat.st_mtime,'sources':[]})}
        record['integrity']='mismatch' if re.fullmatch('[a-f0-9]{64}',path.stem) and path.stem!=record['sha256'] else 'ok'
        record['cleanupEligible']=not record['references'] and time.time()-stat.st_mtime>86400
        records.append(record)
    index_file.parent.mkdir(parents=True,exist_ok=True)
    host.write_json_file(str(index_file),fresh)
    present={r['url'] for r in records}
    missing=[{'url':url,'references':sorted(labels)} for url,labels in refs.items() if url not in present and not _legacy_exists(host,url)]
    candidates=[r['url'] for r in records if r['cleanupEligible']]
    token=hashlib.sha256(json.dumps([[r['url'],r['sha256'],r['references'],r['stamp']] for r in records],sort_keys=True).encode()).hexdigest()
    return {'items':records,'missing':missing,'cleanup':{'token':token,'candidates':candidates,'graceHours':24}}

def _legacy_exists(host,url):
    try:return bool(host.local_path_from_url(url))
    except (ValueError,OSError):return False

def cleanup(host,body):
    store=jobs(host)
    with store.lock,host.CONFIG_LOCK:
        if any(j['state'] in ('pending','paused','running','unknown') for j in store.list()['jobs']):raise Conflict('Resolve or finish active/unconfirmed jobs before cleanup')
        report=inventory(host)
        if body.get('token')!=report['cleanup']['token']:raise Conflict('Asset references changed; preview again')
        paths=body.get('paths')
        if not isinstance(paths,list) or not paths or len(set(paths))!=len(paths) or any(p not in report['cleanup']['candidates'] for p in paths):raise ValueError('Only explicitly selected eligible files can be recycled')
        moved=[]
        for url in paths:
            original=host.local_path_from_url(url)
            dest=Path(host.DATA_DIR)/'trash'/str(time.time_ns())/url.removeprefix('/images/')
            dest.parent.mkdir(parents=True,exist_ok=True);os.replace(original,dest);moved.append(url)
        return {'recycled':moved,'note':'Files remain in data/trash; no automatic permanent deletion.'}

def resources(host,kind,body=None):
    if kind not in ('storyboards','plans'):raise ValueError('Unknown resource')
    with host.CONFIG_LOCK:
        config=host.read_merged_config();meta=config.setdefault('uiConfig',{}).setdefault('comfyStudio',{})
        collection=config.setdefault('templates',[]) if kind=='storyboards' else meta.setdefault('creation',{}).setdefault('plans',[])
        if not isinstance(collection,list):raise Conflict('Unsupported resource layout')
        if body is None:
            allowed={'id','title','projectId','outline','description','frames'} if kind=='storyboards' else {'id','title','projectId','templateId','rowId','enabled','variableSetIds','variables','sceneOverrides'}
            items=[{k:v for k,v in item.items() if k in allowed} for item in collection]
            if kind=='storyboards':
                for item in items:item['frames']=[{k:v for k,v in f.items() if not k.startswith('_') and k not in ('nodeOverrides','workflow')} for f in item.get('frames',[])]
            return {'items':items,'revision':config.get('updatedAt')}
        if body.get('expectedRevision')!=config.get('updatedAt'):raise Conflict('Resource revision changed; reload before editing')
        item=body.get('item',{});allowed={'id','title','projectId','outline','description','frames'} if kind=='storyboards' else {'id','title','projectId','templateId','rowId','enabled','variableSetIds','variables','sceneOverrides'}
        if not isinstance(item,dict) or set(item)-allowed:raise ValueError('Unknown resource fields')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,150}',str(item.get('id',''))) or not isinstance(item.get('title'),str):raise ValueError('Resource ID and title required')
        if not any(p.get('id')==item.get('projectId') for p in meta.get('projects',[])):raise ValueError('Unknown projectId')
        if kind=='storyboards':
            frames=item.get('frames')
            if not isinstance(frames,list) or not 1<=len(frames)<=512:raise ValueError('1..512 storyboard frames required')
            fields={'id','name','prompt','negative','caption','width','height','steps','cfg','seed','denoise','camera','action'}
            for i,f in enumerate(frames):
                if not isinstance(f,dict) or set(f)-fields or not isinstance(f.get('prompt'),str):raise ValueError('Invalid frame')
                f.setdefault('id',item['id']+'_frame_'+str(i));
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,150}',str(f['id'])) or f['id'] in ('__proto__','prototype','constructor'):raise ValueError('Invalid frame ID')
                for field in ('name','negative','caption','camera','action'):
                    if field in f and not isinstance(f[field],str):raise ValueError('Frame text must be strings')
                for field,low,high in [('width',64,8192),('height',64,8192),('steps',1,150),('cfg',0,30),('denoise',0,1),('seed',-1,9007199254740991)]:
                    if field in f and (isinstance(f[field],bool) or not isinstance(f[field],(int,float)) or not low<=f[field]<=high):raise ValueError('Invalid frame number: '+field)
                f.setdefault('name','Frame '+str(i+1));f.setdefault('caption','');f.setdefault('negative','')
        else:
            if not any(t.get('id')==item.get('templateId') for t in config.get('templates',[])):raise ValueError('Unknown templateId')
            rows=config.get('batchMatrix',[]);rows=rows.get('rows',[]) if isinstance(rows,dict) else rows
            if not any(r.get('id')==item.get('rowId') for r in rows):raise ValueError('Unknown rowId')
            if item.get('variables') or item.get('sceneOverrides'):raise ValueError('Initial public plan writer accepts references only; edit typed overrides in Mio')
            if 'enabled' in item and not isinstance(item['enabled'],bool):raise ValueError('enabled must be boolean')
            ids=item.get('variableSetIds',[])
            if not isinstance(ids,list) or any(not isinstance(id,str) or not any(s.get('id')==id for s in meta.get('creation',{}).get('variableSets',[])) for id in ids):raise ValueError('Invalid variableSetIds')
            item.setdefault('variables',[]);item.setdefault('sceneOverrides',{});item.setdefault('variableSetIds',[]);item.setdefault('enabled',False)
        existing=next((x for x in collection if x.get('id')==item['id']),None)
        if existing:existing.update(item)
        else:collection.append(item)
        config['updatedAt']=max(int(time.time()*1000),int(config.get('updatedAt') or 0)+1);host.validate_config_payload(config);host.write_split_config(config)
        return {'item':item,'revision':config['updatedAt']}

def dispatch(handler,host,route,query,request_id=None):
    """Returns False for other namespaces. Shared private/public semantics."""
    if not (route in ('jobs','jobs/events','jobs/activity','jobs/reorder','assets/catalog','assets/upload','assets/cleanup') or route.startswith('jobs/') or route.startswith('resources/')):return False
    def reply(status,payload):
        if request_id:payload['requestId']=request_id
        handler.send_json(status,payload)
    try:
        store=jobs(host);body=handler.read_json_body(max_bytes=host.MAX_IMAGE_BYTES*4//3+65536) if handler.command=='POST' else None
        if route=='jobs' and body is not None:data=store.submit(body.get('input',{}),body.get('idempotencyKey'))
        elif route=='jobs' and handler.command=='GET':data=store.list()
        elif route=='jobs/activity' and handler.command=='GET':data=store.activity(int(query.get('after',['0'])[0]))
        elif route=='jobs/events' and handler.command=='GET':
            after=int(query.get('after',[handler.headers.get('Last-Event-ID','0')])[0]);events=store.events(after)
            raw=('retry: 1500\n'+''.join('id: '+str(e['id'])+'\nevent: job\ndata: '+json.dumps(e)+'\n\n' for e in events)+'\n').encode()
            handler.send_response(200);handler.send_header('Content-Type','text/event-stream');handler.send_header('Cache-Control','no-cache');handler.send_header('Content-Length',str(len(raw)));handler.end_headers();handler.wfile.write(raw);return True
        elif route=='jobs/reorder' and body is not None:data=store.reorder(body.get('ids'))
        elif route.startswith('jobs/'):
            id=route.split('/')[1]
            if body is not None and body.get('action') in ('archive','remove'):
                with store.lock,host.CONFIG_LOCK:
                    snapshot=host.read_merged_config()
                    if snapshot.get('templates') is not None:host.write_split_config(snapshot)
                    data=store.control(id,body.get('action'))
            else:data=store.control(id,body.get('action'),body.get('policy'),body.get('runtime'),body.get('recovery'),body.get('edits')) if body is not None else store.get(id)
        elif route=='assets/upload' and body is not None:
            url=host.store_image_data(body.get('dataUrl',''),'external-assets');record_asset_origin(host,url,{'kind':'upload','name':str(body.get('name',''))[:250]});data={'kind':'image','url':url,'name':str(body.get('name',''))[:250]}
        elif route=='assets/catalog' and handler.command=='GET':
            with store.lock,host.CONFIG_LOCK:data=inventory(host,query.get('verify',['0'])[0]=='1')
        elif route=='assets/cleanup' and body is not None:data=cleanup(host,body)
        elif route.startswith('resources/'):data=resources(host,route.split('/')[1],body)
        else:raise ValueError('Method not supported')
        if route.startswith('jobs') and isinstance(data,dict):
            records=data.get('jobs',[]) if 'jobs' in data else [data] if 'channelRefs' in data else []
            if records:
                config=host.read_merged_config_raw() if hasattr(host,'read_merged_config_raw') else host.read_merged_config()
                for job in records:job['currentChannels']=[channel_preview(config,ref) for ref in job.get('channelRefs',[])]
        reply(200,{'data':data})
    except Conflict as exc:reply(409,{'error':{'code':'conflict','message':str(exc)}})
    except KeyError:reply(404,{'error':{'code':'not_found','message':'Not found'}})
    except (ValueError,TypeError) as exc:reply(400,{'error':{'code':'invalid_request','message':str(exc)}})
    except Exception:reply(500,{'error':{'code':'internal_error','message':'Foundation operation failed; no automatic generation retry'}})
    return True


def project_execution(host,config):
    """Read-time projection; job results are durable even with every browser closed.

    Does not revise or overwrite editable workspace configuration. A manual image
    replacement wins over an older task result. Normal UI saves materialize the view.
    """
    import sqlite3
    path=os.path.join(host.DATA_DIR,'execution','jobs.sqlite3')
    if not os.path.isfile(path):return config
    queue=config.get('batchRunState',{}).get('queue',[]);books=config.get('savedGalleries',[])
    if not isinstance(queue,list) or not isinstance(books,list) or not queue:return config
    ids=[q['serverId'] for q in queue if q.get('serverId')]
    workspace=config.get('uiConfig',{}).get('comfyStudio',{}).get('workspaceId') or 'workspace'
    tokens=[workspace+':'+q['id'] for q in queue if q.get('serverInput') and not q.get('serverId')]
    if not ids and not tokens:return config
    db=sqlite3.connect(path,timeout=10);db.row_factory=sqlite3.Row
    clauses=[];params=[]
    if ids:clauses.append('id IN ('+','.join('?' for _ in ids)+')');params.extend(ids)
    if tokens:clauses.append('token IN ('+','.join('?' for _ in tokens)+')');params.extend(tokens)
    frame_map={}
    try:
        db.execute('BEGIN')
        records=[dict(row) for row in db.execute("SELECT * FROM jobs WHERE state!='archived' AND ("+' OR '.join(clauses)+')',params)]
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='job_frames'").fetchone():
            for record in records:frame_map[record['id']]=[dict(f) for f in db.execute('SELECT idx AS "index",state,attempts,retry_count,ready_at,upstream,timeout FROM job_frames WHERE job=? ORDER BY idx',(record['id'],))]
    finally:db.close()
    for q in queue:
        record=next((r for r in records if r['id']==q.get('serverId')),None)
        if not record and q.get('serverInput'):
            record=next((r for r in records if json.loads(r['payload']).get('owner')==q.get('id')),None)
        if not record:continue
        book=next((b for b in books if b.get('id')==q.get('bookId')),None)
        if not book:continue
        q['serverId']=record['id'];q['serverState']=record['state']
        states=frame_map.get(record['id'],[]);q['serverFrameStates']=states;q['serverRunningCount']=sum(f['state']=='running' for f in states);q['serverEnabled']=record.get('enabled',0);q['serverBlocked']=record.get('blocked',0);q['serverNextIndex']=next((f['index'] for f in states if f['state']!='complete'),None) if states else record['cursor']
        for field,key in [('retry_count','serverRetries'),('ready_at','serverReadyAt'),('attempts','serverAttempts'),('cancel','serverCancel'),('cursor','serverCursor'),('active_timeout','serverTimeout')]:q[key]=record.get(field,0)
        inputs=json.loads(record['payload'])['frames'];
        for f in states:f['provider']=inputs[f['index']]['config']['provider']
        q['serverProvider']=inputs[q['serverNextIndex'] if q['serverNextIndex'] is not None else 0]['config']['provider']
        q['status']='failed' if record['state']=='unknown' else record['state']
        error=json.loads(record['error']) if record['error'] else None
        q['error']=('结果未确认：' if record['state']=='unknown' else '')+error['message'] if error else None
        indices=q.get('serverIndices',q.get('indices',[]));q['done']=len(q.get('indices',[]))-len(indices)+record['cursor']
        for result in json.loads(record['results']):
            if result['index']>=len(indices):continue
            index=indices[result['index']];steps=book.setdefault('steps',[]);old=next((s for s in steps if s.get('stepIndex')==index),None)
            if old and old.get('image'):continue
            meta=(q.get('serverMeta') or [{}]*len(indices))[result['index']]
            step={**meta,'prompt':result.get('prompt',meta.get('prompt','')),'stepIndex':index,'image':result['image'],'artifacts':result.get('artifacts',[]),'offlineFallback':False}
            if old:old.update(step)
            else:steps.append(step)
        book['steps'].sort(key=lambda s:s.get('stepIndex',0));book['generatedSteps']=sum(bool(s.get('image')) for s in book['steps'])
        book['inProgress']=record['state']=='running';book['status']='complete' if book['generatedSteps']>=book.get('totalSteps',1) else 'generating' if q['status'] in ('pending','running','paused') else q['status'] if q['status']!='complete' else 'partial'
    for book in books:
        related=[q for q in queue if q.get('bookId')==book.get('id')]
        if not related:continue
        book['inProgress']=any(q.get('status')=='running' for q in related)
        if any(q.get('status') in ('pending','paused','running') for q in related):book['status']='generating'
    return config


def image_dimensions(raw,mime):
    import struct
    try:
        if mime=='image/png' and len(raw)>=24:return struct.unpack('>II',raw[16:24])
        if mime=='image/gif' and len(raw)>=10:return struct.unpack('<HH',raw[6:10])
        if mime=='image/webp':
            if raw[12:16]==b'VP8X':return int.from_bytes(raw[24:27],'little')+1,int.from_bytes(raw[27:30],'little')+1
            if raw[12:16]==b'VP8L' and raw[20]==47:
                n=int.from_bytes(raw[21:25],'little');return (n&16383)+1,((n>>14)&16383)+1
            at=raw.find(b'\x9d\x01\x2a',20,40)
            if at>=0:return int.from_bytes(raw[at+3:at+5],'little')&16383,int.from_bytes(raw[at+5:at+7],'little')&16383
        if mime=='image/jpeg':
            p=2
            while p+4<len(raw):
                if raw[p]!=255:p+=1;continue
                marker=raw[p+1];p+=2
                if marker in (0,255,216,217) or 208<=marker<=215:continue
                size=int.from_bytes(raw[p:p+2],'big')
                if size<2:break
                if marker in (192,193,194,195,197,198,199,201,202,203,205,206,207):return int.from_bytes(raw[p+5:p+7],'big'),int.from_bytes(raw[p+3:p+5],'big')
                p+=size
    except (ValueError,IndexError,struct.error):pass
    return None,None


def record_asset_origin(host,url,origin):
    try:host.local_path_from_url(url)
    except (OSError,ValueError):return
    with host.CONFIG_LOCK:
        path=Path(host.DATA_DIR)/'assets'/'origins.json'
        try:data=json.loads(path.read_text())
        except FileNotFoundError:data={}
        except (OSError,ValueError):return
        if not isinstance(data,dict):return
        entry=data.setdefault(url,{'created':time.time(),'sources':[]})
        if origin not in entry['sources']:entry['sources'].append(origin)
        host.write_json_file(str(path),data)
