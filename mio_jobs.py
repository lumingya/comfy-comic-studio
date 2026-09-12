"""Shared durable storage and process lease. Per-frame dispatch lives in mio_frame_jobs."""
import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager

DEFAULT_POLICY={'mode':'retry','maxRetries':5,'delaySeconds':15,'onExhausted':'continue'}
def validate_policy(value):
    if not isinstance(value,dict) or set(value)-set(DEFAULT_POLICY):raise ValueError('Invalid failure policy')
    p={**DEFAULT_POLICY,**value}
    if p['mode'] not in ('pause','retry','continue') or p['onExhausted'] not in ('pause','continue'):raise ValueError('Invalid failure policy mode')
    for name,low,high in [('maxRetries',1,100),('delaySeconds',5,300)]:
        if type(p[name]) is not int or not low<=p[name]<=high:raise ValueError('Invalid '+name)
    return p
DEFAULT_RUNTIME={'concurrency':1,'requestTimeoutSeconds':600}
def validate_runtime(value):
    if not isinstance(value,dict) or set(value)-set(DEFAULT_RUNTIME):raise ValueError('Invalid execution settings')
    r={**DEFAULT_RUNTIME,**value}
    for key,low,high in [('concurrency',1,16),('requestTimeoutSeconds',30,7200)]:
        if type(r[key]) is not int or not low<=r[key]<=high:raise ValueError('Invalid '+key)
    return r
class Conflict(ValueError):pass

def validate_progress(row):
    results=json.loads(row['results']);cursor=row['cursor'];total=len(json.loads(row['payload'])['frames'])
    if not 0<=cursor<=total or len(results)!=cursor or any(not isinstance(r,dict) or r.get('index')!=i or not r.get('image') for i,r in enumerate(results)):
        raise Conflict('Stored progress is inconsistent; refusing to restart from frame one. Restore/check the task record.')
    return results

class Jobs:
    def __init__(self, root, execute):
        os.makedirs(root,exist_ok=True)
        self.lease=acquire_lease(root)
        self.path=os.path.join(root,'jobs.sqlite3');self.execute=execute
        self.lock=threading.RLock();self.wake=threading.Event();self.closed=False;self.workers=set();self.sockets={};self.dispatcher_done=False
        with self.connect() as db:
            db.executescript('''PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, position INTEGER NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, results TEXT NOT NULL DEFAULT '[]', error TEXT, upstream TEXT, cancel INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, updated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT,created REAL,changes TEXT);
            CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
            INSERT OR IGNORE INTO settings VALUES('paused','false');''')
            for column,definition in [('retry_count','INTEGER NOT NULL DEFAULT 0'),('ready_at','REAL NOT NULL DEFAULT 0'),('attempts','INTEGER NOT NULL DEFAULT 0'),('errors',"TEXT NOT NULL DEFAULT '[]'"),('album_key',"TEXT NOT NULL DEFAULT ''"),('active_timeout','INTEGER NOT NULL DEFAULT 0'),('epoch','INTEGER NOT NULL DEFAULT 0')]:
                if column not in [r[1] for r in db.execute('PRAGMA table_info(jobs)')]:db.execute('ALTER TABLE jobs ADD COLUMN '+column+' '+definition)
            db.execute("INSERT OR IGNORE INTO settings VALUES('failurePolicy',?)",(json.dumps(DEFAULT_POLICY),))
            db.execute("INSERT OR IGNORE INTO settings VALUES('runtime',?)",(json.dumps(DEFAULT_RUNTIME),))
            for record in db.execute("SELECT id,payload FROM jobs WHERE album_key=''").fetchall():db.execute('UPDATE jobs SET album_key=? WHERE id=?',(json.loads(record['payload']).get('albumId') or record['id'],record['id']))
            if 'meta' not in [r[1] for r in db.execute('PRAGMA table_info(jobs)')]:db.execute('ALTER TABLE jobs ADD COLUMN meta TEXT')
            for row in db.execute('SELECT id,payload FROM jobs WHERE meta IS NULL').fetchall():db.execute('UPDATE jobs SET meta=? WHERE id=?',(job_meta(json.loads(row["payload"])),row["id"]))
            if 'reconcile' not in [r[1] for r in db.execute('PRAGMA table_info(jobs)')]:db.execute('ALTER TABLE jobs ADD COLUMN reconcile INTEGER NOT NULL DEFAULT 0')
            if db.execute("SELECT COUNT(*) FROM jobs WHERE state='running'").fetchone()[0]:db.execute("UPDATE settings SET value='true' WHERE key='paused'")
            interrupted=[r[0] for r in db.execute("SELECT id FROM jobs WHERE state='running'")]
            db.execute("UPDATE jobs SET state='unknown',error=?,updated=? WHERE state='running'",(json.dumps({'kind':'result_unconfirmed','message':'Service stopped during an attempt. No automatic retry.'}),time.time()))
            for id in interrupted:self.event(db,id,'unknown')
        self.thread=threading.Thread(target=self.loop,name='Mio durable worker',daemon=True);self.thread.start()
    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path,timeout=30);db.row_factory=sqlite3.Row
        try:
            with db:yield db
        finally:db.close()
    def event(self,db,id,state):
        row=db.execute('SELECT meta,cursor,attempts,error,active_timeout FROM jobs WHERE id=?',(id,)).fetchone()
        data={'jobId':id,'state':state,'time':time.time()}
        if row:
            meta=json.loads(row['meta']);data.update(provider=meta.get('providers',[''])[min(row['cursor'],len(meta.get('providers',['']))-1)],label=meta.get('label',id),cursor=row['cursor'],attempt=row['attempts'],timeout=row['active_timeout'])
            if row['error'] and state in ('failed','unknown','retry_wait','skipped'):
                data['error']=json.loads(row['error']);data['error']['message']=data['error'].get('message','')[:4000]
        else:data['runtime']=json.loads(db.execute("SELECT value FROM settings WHERE key='runtime'").fetchone()[0])
        db.execute('INSERT INTO events(job,data) VALUES(?,?)',(id,json.dumps(data)))
    def list(self):
        with self.connect() as db:ids=[r[0] for r in db.execute("SELECT id FROM jobs WHERE state!='archived' ORDER BY CASE WHEN state IN ('pending','paused','running','unknown') THEN 0 ELSE 1 END, CASE WHEN state IN ('pending','paused','running','unknown') THEN position END, created DESC LIMIT 2000")];paused=db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()[0]=='true'
        return {'jobs':[self.get(id,False) for id in ids],'paused':paused,'failurePolicy':self.policy(),'runtime':self.runtime()}
    def policy(self):
        with self.connect() as db:return json.loads(db.execute("SELECT value FROM settings WHERE key='failurePolicy'").fetchone()[0])
    def runtime(self):
        with self.connect() as db:return json.loads(db.execute("SELECT value FROM settings WHERE key='runtime'").fetchone()[0])
    def reorder(self,ids):
        if not isinstance(ids,list) or len(set(ids))!=len(ids):raise ValueError('Unique job IDs required')
        with self.lock,self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            pending=[r[0] for r in db.execute("SELECT id FROM jobs WHERE state IN ('pending','paused') AND cursor=0 AND attempts=0 ORDER BY position")]
            if any(id not in pending for id in ids):raise Conflict('Only waiting jobs can move')
            ordered=ids+[id for id in pending if id not in ids]
            offset=db.execute("SELECT COALESCE(MAX(position),-1)+1 FROM jobs WHERE state='running' OR ((cursor>0 OR attempts>0) AND state IN ('pending','paused'))").fetchone()[0]
            for i,id in enumerate(ordered):db.execute('UPDATE jobs SET position=? WHERE id=?',(offset+i,id))
        return self.list()
    def references(self):
        with self.connect() as db:
            items=[(r['id'],json.loads(r['payload']),json.loads(r['results'])) for r in db.execute('SELECT id,payload,results FROM jobs WHERE state!="archived"')]
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='request_inputs'").fetchone():
                items.extend((r['job']+':'+str(r['idx'])+':'+str(r['attempt']),json.loads(r['input']),[]) for r in db.execute("SELECT r.* FROM request_inputs r JOIN jobs j ON j.id=r.job WHERE j.state!='archived'"))
            return items
    def activity(self,after=0):
        with self.connect() as db:return [{'id':r['id'],**json.loads(r['data'])} for r in db.execute('SELECT * FROM (SELECT * FROM events WHERE id>? ORDER BY id DESC LIMIT 200) ORDER BY id',(after,))]
    def events(self,after=0):
        with self.connect() as db:return [{'id':r['id'],**json.loads(r['data'])} for r in db.execute('SELECT * FROM events WHERE id>? ORDER BY id LIMIT 200',(after,))]
    def loop(self):
        try:
            while not self.closed:
                try:
                    with self.lock:
                        if self.closed:break
                        row=self.claim()
                        if row:
                            worker=threading.Thread(target=self.run_claimed,args=(row,),name='Mio '+row['id'],daemon=True)
                            self.workers.add(worker)
                            try:worker.start()
                            except Exception:self.workers.discard(worker);raise
                    if row:continue
                except Exception:
                    print('[Mio worker] Storage/worker failure: no replay. Check storage before resuming.',flush=True)
                    try:
                        with self.connect() as db:db.execute("UPDATE settings SET value='true' WHERE key='paused'")
                    except Exception:pass
                self.wake.wait(.25);self.wake.clear()
        finally:
            with self.lock:
                self.dispatcher_done=True
                if self.closed and not self.workers:self.lease.close()
    def step(self):
        row=self.claim()
        if row is None:return False
        self.execute_row(row);return True
    def close(self):
        self.closed=True;self.wake.set();self.thread.join(timeout=2)
        with self.lock:workers=list(self.workers)
        deadline=time.monotonic()+2
        for worker in workers:worker.join(timeout=max(0,deadline-time.monotonic()))
        with self.lock:
            if not self.workers and not self.thread.is_alive():self.lease.close()


def acquire_lease(root):
    lease=open(os.path.join(root,'worker.lock'),'a+b')
    try:
        lease.seek(0);lease.write(b'0');lease.flush();lease.seek(0)
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(lease.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        return lease
    except Exception:
        lease.close();raise


def job_meta(payload):
    return json.dumps({'total':len(payload['frames']),'label':payload.get('label',''),'owner':payload.get('owner',''),'albumId':payload.get('albumId',''),'providers':[frame['config']['provider'] for frame in payload['frames']],'frameIndices':[frame.get('frameIndex',i) for i,frame in enumerate(payload['frames'])]})


# Public worker uses per-frame scheduling; base schema is retained for safe migration.
from mio_frame_jobs import make_jobs
Jobs=make_jobs(Jobs)
