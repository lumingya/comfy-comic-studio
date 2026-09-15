"""Phase 0 DAG scheduler: bounded subprocesses, content-addressed durable results, no automatic billing retries."""
import concurrent.futures
import copy
import hashlib
import json
import os
import signal
from pathlib import Path
import queue
import re
import shutil
import subprocess
import threading
import time
import uuid
from backend.mio_library import LibraryError
from .storage import Storage

class Cancelled(Exception):pass

def signature(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False).encode()).hexdigest()

def graph(entries):
    if not isinstance(entries,list) or len(entries)>512:raise LibraryError('At most 512 variables per preparation')
    by={}
    for e in entries:
        if not isinstance(e,dict):raise LibraryError('Variable entry must be an object')
        key=e.get('key')
        if not isinstance(key,str) or not re.fullmatch(r'\w{1,100}',key) or key in by or key in ('__proto__','constructor','prototype'):raise LibraryError('Invalid or duplicate variable key')
        by[key]=e
    deps={}
    scripts={}
    for key,e in by.items():
        c=e.get('compute')
        if c is None:continue
        if not isinstance(c,dict) or not isinstance(c.get('script'),str) or len(c['script'])>32000:raise LibraryError('Macro requires script up to 32 KiB')
        declared=c.get('dependsOn',[])
        if not isinstance(declared,list) or not all(isinstance(x,str) for x in declared):raise LibraryError('dependsOn must be a string array')
        scripts[key]=c['script'];deps[key]=set(declared)
    if scripts:
        node=shutil.which('node')
        if not node:raise LibraryError('Computed variables require Node.js 20+',503)
        try:
            analysis=subprocess.run([node,str(Path(__file__).with_name('macro_analyze.mjs'))],input=json.dumps(scripts),capture_output=True,text=True,timeout=8)
        except subprocess.TimeoutExpired:raise LibraryError('Macro analysis timed out') from None
        if analysis.returncode:raise LibraryError('Macro syntax error: '+analysis.stderr[:500])
        for key,literals in json.loads(analysis.stdout).items():
            deps[key].update(literals)
            if deps[key]-by.keys():raise LibraryError('Missing dependencies for '+key+': '+', '.join(sorted(deps[key]-by.keys())))
    visited=set();visiting=set()
    def visit(key):
        if key in visiting:raise LibraryError('Variable dependency cycle at '+key)
        if key in visited:return
        visiting.add(key)
        for other in deps.get(key,[]):visit(other)
        visiting.remove(key);visited.add(key)
    for k in by:visit(k)
    return by,deps

def run_script(script,values,seed,invoke,cancel,timeout=60):
    node=shutil.which('node')
    if not node:raise LibraryError('Computed variables require Node.js 20+',503)
    worker=Path(__file__).with_name('macro_worker.mjs');q=queue.Queue(maxsize=16)
    proc=subprocess.Popen([node,'--max-old-space-size=96',str(worker)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',bufsize=1,start_new_session=os.name=='posix')
    def read():
        while True:
            line=proc.stdout.readline(2*1024*1024+1)
            if not line:
                try:q.put({'error':'Script worker stopped'},timeout=1)
                except queue.Full:pass
                return
            try:q.put(json.loads(line),timeout=1)
            except Exception:return
    reader=threading.Thread(target=read,daemon=True);reader.start()
    def send(v):proc.stdin.write(json.dumps(v,ensure_ascii=False)+'\n');proc.stdin.flush()
    deadline=time.monotonic()+timeout;calls=0
    try:
        send({'script':script,'values':values,'seed':seed,'timeout':min(timeout*1000,30000)})
        while True:
            if cancel.is_set():raise Cancelled('Preparation cancelled; any already-submitted API request may still be billed')
            if time.monotonic()>deadline:raise TimeoutError('Macro deadline exceeded; API results may be uncertain. No retry was sent.')
            try:m=q.get(timeout=.1)
            except queue.Empty:continue
            if m.get('error'):raise LibraryError(m['error'])
            if m.get('done'):return m.get('value')
            if m.get('rpc'):
                calls+=1
                if calls>8:raise LibraryError('Macro API call budget exceeded (8)')
                # Only the main scheduler thread waits; HTTP calls have their own bounded worker.
                result=queue.Queue(maxsize=1)
                def call(message=m):
                    try:result.put({'result':invoke(message['rpc'],message.get('args',{}))})
                    except Exception as e:result.put({'error':str(e)[:500]})
                threading.Thread(target=call,daemon=True).start()
                while result.empty():
                    if cancel.wait(.05):raise Cancelled('Cancelled; already-sent provider request may complete, result is not committed')
                    if time.monotonic()>deadline:raise TimeoutError('API result unconfirmed; no automatic retry')
                send({'id':m['id'],**result.get()})
    finally:
        if proc.poll() is None:
            if os.name=='posix':os.killpg(proc.pid,signal.SIGKILL)
            else:proc.kill()
        proc.wait(timeout=5);reader.join(timeout=2)
        proc.stdin.close();proc.stdout.close()

def validate_result(entry,value):
    typ=entry.get('type','text')
    if typ=='image' and (not isinstance(value,dict) or value.get('kind')!='mio-image' or not str(value.get('src','')).startswith('/images/')):raise LibraryError('Image macro must return the local Asset from ctx.image.generate')
    if typ=='text' and not isinstance(value,str):raise LibraryError('Text macro must return a string')
    if typ=='number' and (isinstance(value,bool) or not isinstance(value,(int,float))):raise LibraryError('Number macro must return a number')
    if typ=='boolean' and not isinstance(value,bool):raise LibraryError('Boolean macro must return true/false')
    json.dumps(value,allow_nan=False)
    return value

class Macros:
    def __init__(self,data,invoke,config_signature=lambda:'',asset_exists=lambda asset:True):
        self.store=Storage(Path(data)/'runtime'/'preparations');self.cache=Storage(Path(data)/'macro-cache')
        self.invoke=invoke;self.config_signature=config_signature;self.asset_exists=asset_exists
        self.lock=threading.RLock();self.running={};self.owners={};self.live_jobs={};self.slots=threading.BoundedSemaphore(4);self.api_slots=threading.BoundedSemaphore(4)
        # Interrupted records are visible, never automatically replayed on restart.
        if self.store.root.exists():
            for file in self.store.root.glob('*.json'):
                job=json.loads(file.read_text())
                if job.get('status') in ('running','pending'):
                    job['status']='interrupted';job['error']='Service restarted; provider result may be unconfirmed. Explicit retry required.';self.store.set(job['id'],job)
    def start(self,body):
        entries=body.get('entries',[])
        if len(json.dumps(entries,ensure_ascii=False))>1024*1024:raise LibraryError('Variable input exceeds 1 MiB')
        by,deps=graph(entries)
        if deps and body.get('trusted') is not True:raise LibraryError('Confirm trusted macro execution and potential API charges',403)
        owner=body.get('owner');seed=body.get('seed',1)
        if not isinstance(owner,str) or not owner or len(owner)>150 or type(seed)is not int or not 0<=seed<2**32:raise LibraryError('Owner and uint32 seed required')
        if deps and not shutil.which('node'):raise LibraryError('Install Node.js 20+ to execute macros',503)
        with self.lock:
            if owner in self.owners:raise LibraryError('Preparation already running for this album',409)
            if len(self.running)>=4:raise LibraryError('Preparation pool is full',429)
            self.prune_records()
            id='prep-'+uuid.uuid4().hex;cancel=threading.Event();
            job={'id':id,'owner':owner,'seed':seed,'status':'pending','createdAt':time.time(),'nodes':{k:{'status':'pending'} for k in deps},'values':{},'fingerprint':signature(entries)}
            self.store.set(id,job);self.live_jobs[id]=job;self.running[id]=cancel;self.owners[owner]=id
        threading.Thread(target=self._run,args=(job,by,deps,cancel,body.get('force') is True),daemon=True).start()
        return {'id':id}
    def prune_records(self):
        files=sorted(self.store.root.glob('*.json'),key=lambda p:p.stat().st_mtime)
        size=sum(p.stat().st_size for p in files)
        for index,p in enumerate(files):
            if len(files)-index<100 and size<16*1024*1024:break
            if p.stem in self.running:continue
            size-=p.stat().st_size;self.store.delete(p.stem)
    def clear_cache(self,trusted):
        if trusted is not True:raise LibraryError('Confirm cache deletion and potential repeat billing',403)
        with self.lock:
            if self.running:raise LibraryError('Wait for current preparations to finish',409)
            for p in self.cache.root.glob('*.json'):self.cache.delete(p.stem)
        return {'cleared':True}
    def list(self):
        if not self.store.root.exists():return []
        records=[self.store.get(p.stem) for p in self.store.root.glob('*.json')]
        return [{k:v for k,v in item.items() if k!='values'} for item in sorted(records,key=lambda x:x.get('createdAt',0),reverse=True)[:50]]
    def get(self,id):
        with self.lock:value=copy.deepcopy(self.live_jobs[id].copy()) if id in self.live_jobs else self.store.get(id)
        if not value:raise LibraryError('Preparation not found',404)
        return value
    def cancel(self,id):
        with self.lock:
            if id in self.running:self.running[id].set()
        return self.get(id)
    def _run(self,job,by,deps,cancel,force):
        values={k:copy.deepcopy(e.get('value','')) for k,e in by.items() if k not in deps}
        def persist():self.store.set(job['id'],job)
        def execute(key,snapshot):
            e=by[key];c=e['compute'];node_seed=int(signature([job['seed'],key])[:8],16)
            config_stamp=self.config_signature()
            cache_key=signature({'owner':job['owner'],'key':key,'compute':c,'type':e.get('type'),'deps':snapshot,'seed':node_seed,'configuration':config_stamp})
            cached=None if force else self.cache.get(cache_key)
            if cached and self.asset_exists(cached['value']):return cached['value'],True
            with self.slots:
                if cancel.is_set():raise Cancelled('Preparation cancelled')
                # Persist in-flight marker before the first side effect; uncertainty blocks implicit replays.
                marker=self.cache.get('inflight-'+cache_key)
                if marker and not force:raise LibraryError('A prior attempt has an unconfirmed result. Explicit force retry required; it may incur another charge.')
                with self.lock:
                    if sum(p.stat().st_size for p in self.cache.root.glob('*.json'))>27*1024*1024:raise LibraryError('Cache nearly full. Back up and explicitly clear cache before new executions.',507)
                    self.cache.set('inflight-'+cache_key,{'startedAt':time.time()})
                def invoke(method,args):
                    while not self.api_slots.acquire(timeout=.1):
                        if cancel.is_set():raise Cancelled('Cancelled before API submission')
                    try:
                        if cancel.is_set():raise Cancelled('Cancelled before API submission')
                        return self.invoke(method,args)
                    finally:self.api_slots.release()
                value=validate_result(e,run_script(c['script'],snapshot,node_seed,invoke,cancel,min(max(int(c.get('timeout',60)),1),180)))
                if cancel.is_set():raise Cancelled('Cancelled result not committed')
                if self.config_signature()!=config_stamp:raise LibraryError('Saved channel configuration changed; result not cached, explicit retry required')
                self.cache.set(cache_key,{'value':value,'createdAt':time.time()});self.cache.delete('inflight-'+cache_key)
                return value,False
        try:
            job['status']='running';persist();remaining=set(deps)
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                pending={}
                while remaining or pending:
                    if cancel.is_set():raise Cancelled('Preparation cancelled; Phase 1 not enqueued')
                    for key in list(remaining):
                        if deps[key]<=values.keys():
                            job['nodes'][key]={'status':'running'};remaining.remove(key)
                            pending[pool.submit(execute,key,{k:values[k] for k in sorted(deps[key])})]=key
                    persist()
                    ready,_=concurrent.futures.wait(pending,timeout=.1,return_when=concurrent.futures.FIRST_COMPLETED)
                    for future in ready:
                        key=pending.pop(future)
                        try:value,hit=future.result()
                        except Exception as e:
                            job['nodes'][key]={'status':'failed','error':str(e)[:500]};cancel.set();raise
                        values[key]=value
                        if len(json.dumps(values,ensure_ascii=False))>1024*1024:cancel.set();raise LibraryError('Combined computed values exceed 1 MiB')
                        job['nodes'][key]={'status':'cached' if hit else 'complete'}
            job['values']=values;job['status']='complete'
        except Exception as e:
            job['status']='cancelled' if isinstance(e,Cancelled) else 'failed';job['error']=str(e)[:500]
            for n in job['nodes'].values():
                if n['status'] in ('running','pending'):n['status']='blocked'
        finally:
            job['finishedAt']=time.time()
            try:persist()
            except Exception as e:
                job['status']='failed';job['values']={};job['error']='Preparation state could not be persisted; Phase 1 is blocked: '+str(e)[:300]
            finally:
                with self.lock:
                    self.running.pop(job['id'],None);self.owners.pop(job['owner'],None)
                    for old in list(self.live_jobs):
                        if len(self.live_jobs)<=100:break
                        if old not in self.running:self.live_jobs.pop(old,None)
