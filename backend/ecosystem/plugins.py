import json
import os
from pathlib import Path
import queue
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from backend.mio_library import LibraryError
from .storage import Storage,identifier,owned
from .packages import unpack,manifest,package_root,clone,git_command

class Worker:
    def __init__(self,code,data,project,timeout=15):
        self.timeout=timeout;self.lock=threading.Lock();self.queue=queue.Queue(maxsize=4)
        self.proc=subprocess.Popen([sys.executable,'-m','backend.ecosystem.plugin_host',str(code),str(data)],cwd=project,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',bufsize=1,start_new_session=os.name=='posix')
        def reader():
            while self.proc.stdout:
                line=self.proc.stdout.readline(2*1024*1024+1)
                if not line:break
                try:self.queue.put(json.loads(line),timeout=1)
                except Exception:break
        self.reader=threading.Thread(target=reader,daemon=True);self.reader.start()
        try:
            ready=self.queue.get(timeout=timeout)
            if not ready.get('ready'):raise LibraryError('Extension startup failed: '+ready.get('error','invalid response'))
        except Exception:
            self.kill();raise
    def kill(self):
        if self.proc.poll() is None:
            if os.name=='posix':os.killpg(self.proc.pid,signal.SIGKILL)
            else:self.proc.kill()
        self.proc.wait(timeout=5);self.reader.join(timeout=2)
        self.proc.stdin.close();self.proc.stdout.close()
    def call(self,payload):
        with self.lock:
            try:
                self.proc.stdin.write(json.dumps(payload)+'\n');self.proc.stdin.flush();result=self.queue.get(timeout=self.timeout)
            except Exception:
                self.kill();raise LibraryError('Extension timed out or stopped. Disabled; no automatic retry.',408) from None
            if not result.get('ok'):raise LibraryError('Extension failed: '+result.get('error','unknown'),502)
            return result.get('result')
    def stop(self):
        try:self.call({'stop':True})
        except Exception:pass
        finally:self.kill()

class Plugins:
    def __init__(self,project,data):
        self.project=Path(project);self.code=self.project/'extensions';self.data=Path(data)/'extensions'
        self.registry=Storage(Path(data)/'ecosystem');self.workers={};self.lock=threading.RLock();self.errors={}
    def records(self):return self.registry.get('extensions',{})
    def save(self,value):self.registry.set('extensions',value)
    def list(self):return [v|{'error':self.errors.get(k,'')} for k,v in self.records().items()]
    def install(self,*,raw=None,url=None,branch='',trusted=False):
        if not trusted:raise LibraryError('Explicit trusted-code confirmation is required',403)
        self.code.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.install-',dir=self.code) as tmp:
            stage=Path(tmp)/'package'
            if url:clone(url,branch,stage)
            else:stage.mkdir();unpack(raw,stage);stage=package_root(stage,'extension')
            meta=manifest(stage,'extension');id=meta['id']
            with self.lock:
                if len(self.records())>=32:raise LibraryError('Extension limit reached (32)')
                target=owned(self.code,id)
                if target.exists() or id in self.records():raise LibraryError('Extension ID already installed',409)
                shutil.move(str(stage),target)
                items=self.records();items[id]=meta|{'enabled':False,'source':url or 'zip','branch':branch,'revision':uuid.uuid4().hex}
                try:self.save(items)
                except Exception:shutil.rmtree(target);raise
            # Installation and enable are explicit trusted operations; startup failure remains visible.
            self.enable(id,True)
            return self.records()[id]
    def enable(self,id,on):
        identifier(id)
        with self.lock:
            items=self.records()
            if id not in items:raise LibraryError('Extension not found',404)
            if not on:
                worker=self.workers.pop(id,None)
                if worker:worker.stop()
                items[id]['enabled']=False;self.errors.pop(id,None);self.save(items);return
            try:
                manifest(self.code/id,'extension')
                if (self.code/id/'plugin.py').exists() and id not in self.workers:self.workers[id]=Worker(self.code/id,self.data/id,self.project)
                items[id]['enabled']=True;self.errors.pop(id,None)
            except Exception as e:
                items[id]['enabled']=False;self.errors[id]=str(e)[:500]
            self.save(items)
    def boot(self):
        for id,meta in self.records().items():
            if meta.get('enabled'):self.enable(id,True)
    def call(self,id,method,path,body):
        if not self.records().get(id,{}).get('enabled'):raise LibraryError('Extension disabled',403)
        worker=self.workers.get(id)
        if not worker:raise LibraryError('No backend registered for extension',404)
        try:return worker.call({'method':method,'path':path,'body':body})
        except LibraryError as e:
            if e.status==408:self.enable(id,False);self.errors[id]=str(e)
            raise
    def update(self,id,trusted):
        if not trusted:raise LibraryError('Confirm trust in the new revision',403)
        identifier(id)
        with self.lock:
            record=self.records().get(id)
            if not record:raise LibraryError('Extension not found',404)
            if record['enabled']:raise LibraryError('Disable extension before updating',409)
            if record['source']=='zip':raise LibraryError('ZIP extension: uninstall code only, then install new ZIP; data stays intact')
            # Stage a fresh clone. Failed validation never corrupts the current installation.
            with tempfile.TemporaryDirectory(dir=self.code,prefix='.update-') as tmp:
                staged=Path(tmp)/'code';clone(record['source'],record['branch'],staged);meta=manifest(staged,'extension')
                if meta['id']!=id:raise LibraryError('Updated package changed its ID')
                backup=Path(tmp)/'previous';os.replace(self.code/id,backup);os.replace(staged,self.code/id)
                items=self.records();items[id]=record|meta|{'revision':uuid.uuid4().hex}
                try:self.save(items)
                except Exception:shutil.rmtree(self.code/id);os.replace(backup,self.code/id);raise
    def uninstall(self,id,delete_data=False):
        identifier(id)
        with self.lock:
            if id in self.records():self.enable(id,False)
            target=owned(self.code,id)
            if target.exists():shutil.rmtree(target)
            if delete_data:
                data=owned(self.data,id)
                if data.exists():shutil.rmtree(data)
            items=self.records();items.pop(id,None);self.save(items);self.errors.pop(id,None)
    def asset(self,id,relative):
        if not self.records().get(identifier(id),{}).get('enabled'):raise LibraryError('Extension disabled',403)
        revision,sep,relative=relative.partition('/')
        if not sep or revision!=self.records()[id]['revision']:raise LibraryError('Extension revision unavailable',404)
        if '.git' in Path(relative).parts or Path(relative).suffix.lower() not in ('.js','.css','.json','.png','.jpg','.webp','.svg','.woff','.woff2'):raise LibraryError('Asset not public',403)
        return owned(self.code/id,relative)
    def close(self):
        for worker in self.workers.values():worker.stop()
        self.workers.clear()
