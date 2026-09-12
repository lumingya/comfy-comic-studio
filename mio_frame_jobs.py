"""Per-task sliding-window execution. Results are indexed, never a completed prefix."""
from mio_channels import channel_reference, ChannelConfigurationError
import copy
import hashlib
import json
import threading
import time
import uuid
from providers.transport import close_socket


def make_jobs(Base):
    from mio_jobs import Conflict, job_meta, validate_runtime, validate_policy, validate_progress

    class FrameJobs(Base):
        def __init__(self,root,execute,resolve_frame=None):
            self.resolve_frame=resolve_frame
            self.prepared=threading.Event()
            super().__init__(root,execute)
            try:
                with self.lock,self.connect() as db:
                    db.executescript('''CREATE TABLE IF NOT EXISTS job_frames(
                    job TEXT NOT NULL,idx INTEGER NOT NULL,state TEXT NOT NULL,epoch INTEGER NOT NULL DEFAULT 0,
                    attempts INTEGER NOT NULL DEFAULT 0,retry_count INTEGER NOT NULL DEFAULT 0,ready_at REAL NOT NULL DEFAULT 0,
                    timeout INTEGER NOT NULL DEFAULT 0,upstream TEXT,result TEXT,error TEXT,updated REAL NOT NULL,
                    reconcile INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(job,idx));
                    CREATE TABLE IF NOT EXISTS request_inputs(job TEXT NOT NULL,idx INTEGER NOT NULL,attempt INTEGER NOT NULL,created REAL NOT NULL,input TEXT NOT NULL,PRIMARY KEY(job,idx,attempt));
                    CREATE TABLE IF NOT EXISTS request_parameters(job TEXT NOT NULL,idx INTEGER NOT NULL,attempt INTEGER NOT NULL,parameters TEXT NOT NULL,PRIMARY KEY(job,idx,attempt));
                    CREATE INDEX IF NOT EXISTS frame_dispatch ON job_frames(job,state,ready_at,idx);''')
                    existing={r[1] for r in db.execute('PRAGMA table_info(jobs)')}
                    for name in ('frame_migrated','enabled','blocked','corrupt'):
                        if name not in existing:db.execute('ALTER TABLE jobs ADD COLUMN '+name+' INTEGER NOT NULL DEFAULT 0')
                    for row in db.execute('SELECT * FROM jobs WHERE frame_migrated=0').fetchall():self.migrate(db,row)
                    interrupted=db.execute("SELECT DISTINCT job FROM job_frames WHERE state='running'").fetchall()
                    for r in interrupted:
                        error=json.dumps({'kind':'result_unconfirmed','message':'Service interrupted. Check each unconfirmed frame before resubmitting.'})
                        db.execute("UPDATE job_frames SET state='unknown',error=?,epoch=epoch+1,updated=? WHERE job=? AND state='running'",(error,time.time(),r['job']))
                        db.execute('UPDATE jobs SET enabled=0,blocked=1 WHERE id=?',(r['job'],))
                        self.aggregate(db,r['job']);self.event(db,r['job'],'unknown')
            except Exception:
                self.closed=True;self.prepared.set();self.thread.join(timeout=2);self.lease.close();raise
            finally:self.prepared.set()

        def loop(self):
            self.prepared.wait()
            super().loop()

        def migrate(self,db,row):
            payload=json.loads(row['payload']);results=json.loads(row['results']);bad=False
            try:validate_progress(row)
            except Conflict:bad=True
            known={r.get('index'):r for r in results if isinstance(r,dict) and type(r.get('index')) is int and r.get('image')}
            stopped=row['state'] in ('paused','failed','unknown','canceled','archived')
            for i in range(len(payload['frames'])):
                result=known.get(i);state='complete' if result else 'pending';error=None
                if not result:
                    if bad:state='unknown';error=json.dumps({'kind':'progress_inconsistent','message':'Stored progress is inconsistent. Restore task data before continuing.'})
                    elif row['state']=='canceled':state='canceled';error=row['error'] if i==row['cursor'] else None
                    elif i==row['cursor'] and row['state'] in ('failed','unknown'):state=row['state'];error=row['error']
                    elif i==row['cursor']:error=row['error']
                db.execute('INSERT INTO job_frames(job,idx,state,result,error,updated,retry_count,ready_at,upstream,timeout) VALUES(?,?,?,?,?,?,?,?,?,?)',
                           (row['id'],i,state,json.dumps(result) if result else None,error,time.time(),row['retry_count'] if i==row['cursor'] else 0,row['ready_at'] if i==row['cursor'] else 0,row['upstream'] if i==row['cursor'] else None,row['active_timeout'] if i==row['cursor'] else 0))
            db.execute('UPDATE jobs SET frame_migrated=1,blocked=?,enabled=0,corrupt=? WHERE id=?',(int(stopped or bad),int(bad),row['id']))
            self.aggregate(db,row['id'])

        def aggregate(self,db,id):
            row=db.execute('SELECT * FROM jobs WHERE id=?',(id,)).fetchone()
            frames=db.execute('SELECT * FROM job_frames WHERE job=? ORDER BY idx',(id,)).fetchall()
            results=[json.loads(f['result']) for f in frames if f['state']=='complete'];states=[f['state'] for f in frames]
            error_frame=next((f for f in sorted(frames,key=lambda f:f['updated'],reverse=True) if f['error']),None)
            error=error_frame['error'] if error_frame else None
            state='pending';enabled=row['enabled']
            if row['state']=='archived':state='archived';enabled=0
            elif 'running' in states:state='running'
            elif len(results)==len(frames):state='complete';enabled=0
            elif row['cancel']:state='canceled';enabled=0
            elif row['blocked']:
                state='unknown' if 'unknown' in states else 'failed' if 'failed' in states or 'skipped' in states else 'paused';enabled=0
            elif 'pending' in states:state='pending'
            else:
                state='unknown' if 'unknown' in states else 'failed' if 'failed' in states or 'skipped' in states else 'canceled';enabled=0
            ready=min((f['ready_at'] for f in frames if f['state']=='pending' and f['ready_at']>0),default=0)
            upstream=next((f['upstream'] for f in frames if f['state']=='unknown' and f['upstream']),None)
            db.execute('UPDATE jobs SET reconcile=? WHERE id=?',(int(any(f['reconcile'] and f['state'] in ('pending','running') for f in frames)),id))
            db.execute('UPDATE jobs SET state=?,enabled=?,cursor=?,results=?,error=?,ready_at=?,retry_count=?,upstream=?,updated=? WHERE id=?',
                       (state,enabled,len(results),json.dumps(results),error,ready,max((f['retry_count'] for f in frames),default=0),upstream,time.time(),id))

        def submit(self,payload,token):
            payload,encoded,digest=validate_submission(payload,token)
            with self.lock,self.connect() as db:
                db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT id,digest FROM jobs WHERE token=?',(token,)).fetchone()
                if old:
                    if old['digest']!=digest:raise Conflict('Idempotency key already used with a different input')
                    id=old['id']
                else:
                    if db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('pending','paused','running','unknown')").fetchone()[0]>=1000:raise ValueError('At most 1000 unfinished jobs')
                    id='job_'+uuid.uuid4().hex;now=time.time();position=db.execute('SELECT COALESCE(MAX(position),0)+1 FROM jobs').fetchone()[0]
                    db.execute('INSERT INTO jobs(id,token,digest,payload,state,position,created,updated,meta,album_key,frame_migrated,blocked) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)',
                               (id,token,digest,encoded,'paused' if payload.get('hold') else 'pending',position,now,now,job_meta(payload),payload.get('albumId') or id,int(payload.get('hold',False))))
                    db.executemany("INSERT INTO job_frames(job,idx,state,updated) VALUES(?,?,'pending',?)",[(id,i,now) for i in range(len(payload['frames']))]);self.event(db,id,'pending')
            self.wake.set();return self.get(id)

        def get(self,id,full=True):
            with self.connect() as db:
                db.execute('BEGIN')
                row=db.execute('SELECT * FROM jobs WHERE id=?',(id,)).fetchone()
                if not row:raise KeyError(id)
                frames=[dict(f) for f in db.execute('SELECT * FROM job_frames WHERE job=? ORDER BY idx',(id,))]
                revisions=[{'id':r['id'],'time':r['created'],'changes':json.loads(r['changes'])} for r in db.execute('SELECT * FROM revisions WHERE job=? ORDER BY id',(id,))] if full else []
            meta=json.loads(row['meta']);providers=meta.pop('providers');indices=meta.pop('frameIndices',list(range(meta['total'])))
            obj={k:row[k] for k in ('id','state','position','cursor','cancel','created','updated','ready_at','retry_count','attempts','active_timeout','enabled','blocked','upstream')}
            initial=json.loads(row['payload']);obj['channelRefs']=list({(channel_reference(initial,f),f['config']['provider']):{'id':channel_reference(initial,f),'provider':f['config']['provider'],'snapshotModel':f['config'].get('model','')} for f in initial['frames']}.values())
            obj.update(executionModel='per-task-frame-pools',progressVersion=2);obj.update(meta);obj['frameIndices']=indices;obj['completedIndices']=[f['idx'] for f in frames if f['state']=='complete'];obj['runningIndices']=[f['idx'] for f in frames if f['state']=='running']
            obj['nextIndex']=next((f['idx'] for f in frames if f['state']!='complete'),None);obj['nextFrameIndex']=indices[obj['nextIndex']] if obj['nextIndex'] is not None else None
            obj['provider']=providers[obj['nextIndex'] or 0];obj['running_count']=len(obj['runningIndices']);obj['reconcile']=int(any(f['reconcile'] and f['state'] in ('pending','running') for f in frames))
            obj['frameStates']=[{**{k:f[k] for k in ('state','attempts','retry_count','ready_at','upstream','timeout')},'index':f['idx'],'provider':providers[f['idx']],'error':json.loads(f['error']) if full and f['error'] else bool(f['error'])} for f in frames]
            obj['results']=json.loads(row['results']) if full else [];obj['error']=json.loads(row['error']) if row['error'] else None
            if obj['error'] and not full:obj['error']={'kind':obj['error']['kind'],'message':'Open details for the original response'}
            if full:
                with self.connect() as db:
                    attempts=db.execute('SELECT idx,attempt,created,input FROM request_inputs WHERE job=? ORDER BY created DESC LIMIT 100',(id,)).fetchall()
                    parameters={(a['idx'],a['attempt']):json.loads(a['parameters']) for a in db.execute('SELECT * FROM request_parameters WHERE job=? ORDER BY rowid DESC LIMIT 100',(id,))}
                obj['requestHistory']=[{'index':a['idx'],'attempt':a['attempt'],'time':a['created'],'inputHash':hashlib.sha256(a['input'].encode()).hexdigest(),**public_request_input(json.loads(a['input'])),**({'requestParameters':parameters[(a['idx'],a['attempt'])]} if (a['idx'],a['attempt']) in parameters else {})} for a in attempts]
                payload=json.loads(row['payload']);obj['errors']=json.loads(row['errors']);obj['revisions']=revisions
                obj['editableFrames']=[{'index':f['idx'],'prompt':payload['frames'][f['idx']].get('prompt',''),'negative':payload['frames'][f['idx']].get('negative',''),'provider':providers[f['idx']]} for f in frames if f['state'] not in ('complete','running')]
            return obj

        def event(self,db,id,state,index=None):
            super().event(db,id,state)
            if index is not None:
                last=db.execute('SELECT id,data FROM events ORDER BY id DESC LIMIT 1').fetchone();data=json.loads(last['data']);data['index']=index
                meta=json.loads(db.execute('SELECT meta FROM jobs WHERE id=?',(id,)).fetchone()[0]);data['provider']=meta['providers'][index];data['frameIndex']=meta.get('frameIndices',list(range(meta['total'])))[index]
                f=db.execute('SELECT * FROM job_frames WHERE job=? AND idx=?',(id,index)).fetchone()
                data.pop('error',None);data.pop('attempt',None)
                if f:
                    data.update(frameAttempt=f['attempts'],retryCount=f['retry_count'],retryAt=f['ready_at'],timeout=f['timeout'])
                    if state in ('failed','unknown','retry_wait','skipped') and f['error']:data['error']=json.loads(f['error']);data['error']['message']=data['error'].get('message','')[:8000]
                if state in ('input_read','request_ready'):
                    attempt=db.execute('SELECT input FROM request_inputs WHERE job=? AND idx=? ORDER BY attempt DESC LIMIT 1',(id,index)).fetchone()
                    if attempt:data['request']=public_request_input(json.loads(attempt['input']))
                    params=db.execute('SELECT parameters FROM request_parameters WHERE job=? AND idx=? AND attempt=?',(id,index,f['attempts'])).fetchone()
                    if params:data['request']['requestParameters']=json.loads(params['parameters'])

                db.execute('UPDATE events SET data=? WHERE id=?',(json.dumps(data),last['id']))

        def valid(self,db,row):
            f=db.execute('SELECT state,epoch FROM job_frames WHERE job=? AND idx=?',(row['id'],row['idx'])).fetchone()
            return bool(f and f['state']=='running' and f['epoch']==row['frame_epoch'])

        def attempt_valid(self,row):
            with self.connect() as db:return self.valid(db,row)

        def register_socket(self,row,sock):
            with self.lock:
                if self.attempt_valid(row):self.sockets[(row['id'],row['idx'],row['frame_epoch'])]=sock;return
            close_socket(sock)

        def checkpoint_frame(self,row,upstream):
            with self.lock,self.connect() as db:
                if self.valid(db,row):
                    db.execute('UPDATE job_frames SET upstream=?,updated=? WHERE job=? AND idx=?',(str(upstream),time.time(),row['id'],row['idx']));self.event(db,row['id'],'upstream_received',row['idx'])

        def activate(self,db,row):
            if row['corrupt']:raise Conflict('Stored progress is inconsistent; restore the task record')
            other=db.execute('SELECT id FROM jobs WHERE enabled=1 AND album_key=? AND id!=?',(row['album_key'],row['id'])).fetchone()
            if other:raise Conflict('Another task for this same album is active')
            if not row['enabled'] and db.execute('SELECT COUNT(*) FROM jobs WHERE enabled=1').fetchone()[0]>=32:raise Conflict('At most 32 active task pools; stop or finish another task')
            db.execute('UPDATE jobs SET enabled=1,blocked=0,cancel=0 WHERE id=?',(row['id'],))

        def claim(self):
            with self.lock,self.connect() as db:
                db.execute('BEGIN IMMEDIATE');runtime=json.loads(db.execute("SELECT value FROM settings WHERE key='runtime'").fetchone()[0]);paused=db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()[0]=='true'
                if not paused:
                    # The earliest unfinished eligible task owns the automatic lane.
                    # Explicitly started later jobs have their own independent pools.
                    head=db.execute("SELECT * FROM jobs WHERE state!='archived' AND (enabled=1 OR (state='pending' AND blocked=0)) ORDER BY position,created LIMIT 1").fetchone()
                    if head and not head['enabled']:
                        try:self.activate(db,head)
                        except Conflict:pass
                candidates=db.execute("SELECT * FROM jobs WHERE state!='archived' AND (enabled=1 OR reconcile=1) ORDER BY position,created").fetchall()
                for task in candidates:
                    if task['corrupt']:continue
                    try:self.validate_indexed(db,task)
                    except Conflict as exc:
                        db.execute("UPDATE jobs SET corrupt=1,blocked=1,state='unknown',error=? WHERE id=?",(json.dumps({'kind':'progress_inconsistent','message':str(exc)}),task['id']));self.event(db,task['id'],'unknown');continue
                    active=db.execute("SELECT COUNT(*) FROM job_frames WHERE job=? AND state='running'",(task['id'],)).fetchone()[0]
                    if active>=runtime['concurrency']:continue
                    query="SELECT * FROM job_frames WHERE job=? AND state='pending' AND ready_at<=?"
                    if paused or task['blocked']:query+=' AND reconcile=1'
                    f=db.execute(query+' ORDER BY idx LIMIT 1',(task['id'],time.time())).fetchone()
                    if not f:continue
                    epoch=f['epoch']+1;now=time.time()
                    db.execute("UPDATE job_frames SET state='running',epoch=?,attempts=attempts+1,timeout=?,updated=? WHERE job=? AND idx=?",(epoch,runtime['requestTimeoutSeconds'],now,task['id'],f['idx']))
                    db.execute('UPDATE jobs SET attempts=attempts+1,active_timeout=? WHERE id=?',(runtime['requestTimeoutSeconds'],task['id']));self.aggregate(db,task['id']);self.event(db,task['id'],'running',f['idx'])
                    amended=db.execute('SELECT COALESCE(MAX(created),0) FROM revisions WHERE job=?',(task['id'],)).fetchone()[0]
                    return {**dict(task),'last_amended':amended,'idx':f['idx'],'frame_epoch':epoch,'frame_attempt':f['attempts']+1,'frame_retries':f['retry_count'],'frame_upstream':f['upstream'],'frame_reconcile':f['reconcile'],'active_timeout':runtime['requestTimeoutSeconds']}
            return None

        def record_request_parameters(self,row,parameters):
            with self.lock,self.connect() as db:
                if not self.valid(db,row):raise InterruptedError('Stopped before request submission')
                db.execute('INSERT OR REPLACE INTO request_parameters VALUES(?,?,?,?)',(row['id'],row['idx'],row['frame_attempt'],json.dumps(parameters)))
                self.event(db,row['id'],'request_ready',row['idx'])

        def execute_row(self,row):
            id=row['id'];idx=row['idx'];frame=json.loads(row['payload'])['frames'][idx]
            frame.update(_onRequest=lambda parameters:self.record_request_parameters(row,parameters),_requestTimeout=row['active_timeout'],_checkpoint=lambda upstream:self.checkpoint_frame(row,upstream),_isCanceled=lambda:not self.attempt_valid(row),_onSocket=lambda sock:self.register_socket(row,sock))
            if row['frame_reconcile']:frame['_resumePromptId']=row['frame_upstream']
            generated=False
            try:
                if not self.attempt_valid(row):return False
                # Read saved task-local content outside the database/dispatcher lock.
                # Reconciliation must use the input of the original upstream request.
                snapshot=json.loads(row['payload'])['frames'][idx]
                if row['frame_reconcile']:
                    with self.connect() as db:previous=db.execute('SELECT input FROM request_inputs WHERE job=? AND idx=? ORDER BY attempt DESC LIMIT 1',(id,idx)).fetchone()
                    if previous:snapshot=json.loads(previous['input'])
                elif self.resolve_frame:snapshot=self.resolve_frame(row,snapshot)
                validate_submission({'frames':[snapshot]},'attempt-validation')
                with self.lock,self.connect() as db:
                    if not self.valid(db,row):return False
                    db.execute('INSERT INTO request_inputs VALUES(?,?,?,?,?)',(id,idx,row['frame_attempt'],time.time(),json.dumps(snapshot)));self.event(db,id,'input_read',idx)
                frame={**snapshot,**{k:v for k,v in frame.items() if k.startswith('_')}}
                if not self.attempt_valid(row):return False
                result=self.execute(frame);generated=True
                if not isinstance(result,dict) or not result.get('image'):raise ValueError('Provider did not return an image result')
                result={**result,'index':idx,'prompt':frame.get('prompt',''),'negative':frame.get('negative','')}
                with self.lock,self.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    if not self.valid(db,row):self.event(db,id,'late_result_discarded',idx);return False
                    db.execute("UPDATE job_frames SET state='complete',result=?,error=NULL,upstream=NULL,reconcile=0,retry_count=0,ready_at=0,updated=? WHERE job=? AND idx=?",(json.dumps(result),time.time(),id,idx));self.aggregate(db,id);self.event(db,id,'frame_complete',idx)
            except Exception as exc:
                status=getattr(exc,'status',None);state='failed' if not generated and (status or isinstance(exc,(ValueError,FileNotFoundError,PermissionError))) else 'unknown'
                error={'kind':'channel_configuration' if isinstance(exc,ChannelConfigurationError) else 'upstream_http' if status else 'validation' if state=='failed' else 'result_unconfirmed','status':status,'message':str(exc)}
                with self.lock,self.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    if not self.valid(db,row):self.event(db,id,'late_result_discarded',idx);return False
                    policy=json.loads(db.execute("SELECT value FROM settings WHERE key='failurePolicy'").fetchone()[0]);count=row['frame_retries'];ready=0
                    if status==422:state='skipped';error['kind']='prompt_rejected';error['message']='HTTP 422：此幕已跳过，请修改内容后再继续。\n'+str(exc)
                    if state=='failed' and policy['mode']=='retry' and isinstance(status,int) and 500<=status<=599 and not row['frame_reconcile'] and count<policy['maxRetries']:
                        count+=1;ready=time.time()+policy['delaySeconds'];state='pending'
                    stop=isinstance(exc,ChannelConfigurationError) or state!='skipped' and not ready and (policy['mode']=='pause' or policy['mode']=='retry' and policy['onExhausted']=='pause')
                    if stop:db.execute('UPDATE jobs SET blocked=1 WHERE id=?',(id,))
                    history=json.loads(db.execute('SELECT errors FROM jobs WHERE id=?',(id,)).fetchone()[0]);history.append({'index':idx,'attempt':row['frame_attempt'],'time':time.time(),**error,'message':error['message'][:16384],'truncated':len(error['message'])>16384})
                    db.execute('UPDATE jobs SET errors=? WHERE id=?',(json.dumps(history[-30:]),id))
                    db.execute('UPDATE job_frames SET state=?,error=?,retry_count=?,ready_at=?,updated=? WHERE job=? AND idx=?',(state,json.dumps(error),count,ready,time.time(),id,idx));self.aggregate(db,id);self.event(db,id,'retry_wait' if ready else state,idx)
            self.wake.set();return True

        def run_claimed(self,row):
            try:self.execute_row(row)
            except Exception:
                try:
                    with self.lock,self.connect() as db:
                        if self.valid(db,row):
                            db.execute("UPDATE job_frames SET state='unknown',error=? WHERE job=? AND idx=?",(json.dumps({'kind':'persistence_unconfirmed','message':'Attempt persistence failed; inspect storage before continuing.'}),row['id'],row['idx']))
                            db.execute('UPDATE jobs SET blocked=1 WHERE id=?',(row['id'],));self.aggregate(db,row['id']);self.event(db,row['id'],'unknown',row['idx'])
                except Exception:pass
            finally:
                with self.lock:
                    self.sockets.pop((row['id'],row['idx'],row['frame_epoch']),None);self.workers.discard(threading.current_thread())
                    if self.closed and self.dispatcher_done and not self.workers:self.lease.close()
                self.wake.set()

        def validate_indexed(self,db,row):
            try:
                frames=db.execute("SELECT idx,result FROM job_frames WHERE job=? AND state='complete' ORDER BY idx",(row['id'],)).fetchall()
                expected=[json.loads(f['result']) for f in frames];results=json.loads(row['results'])
                extent=db.execute('SELECT COUNT(*),MIN(idx),MAX(idx) FROM job_frames WHERE job=?',(row['id'],)).fetchone();total=json.loads(row['meta'])['total']
                valid=tuple(extent)==(total,0,total-1) and row['cursor']==len(expected) and results==expected and all(isinstance(r,dict) and type(r.get('index')) is int and r.get('index')==f['idx'] and r.get('image') for f,r in zip(frames,expected))
            except (ValueError,TypeError,KeyError):valid=False
            if row['corrupt'] or not valid:raise Conflict('Stored indexed progress is inconsistent; restore task data')

        def check_recovery(self,row,recovery):
            with self.connect() as db:self.validate_indexed(db,row)
            if not isinstance(recovery,dict) or type(recovery.get('expectedCursor')) is not int or recovery.get('expectedCursor')!=row['cursor'] or recovery.get('expectedUpdated')!=row['updated']:raise Conflict('Progress changed; refresh before confirming')

        def control(self,id,action,policy=None,runtime=None,recovery=None,edits=None):
            abort=[]
            with self.lock,self.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if id=='scheduler':
                    if action=='runtime':db.execute("UPDATE settings SET value=? WHERE key='runtime'",(json.dumps(validate_runtime(runtime)),))
                    elif action=='policy':
                        revised=validate_policy(policy);db.execute("UPDATE settings SET value=? WHERE key='failurePolicy'",(json.dumps(revised),))
                        for f in db.execute("SELECT * FROM job_frames WHERE state='pending' AND ready_at>0").fetchall():
                            if revised['mode']!='retry' or f['retry_count']>revised['maxRetries']:
                                db.execute("UPDATE job_frames SET state='failed',ready_at=0 WHERE job=? AND idx=?",(f['job'],f['idx']))
                                if revised['mode']=='pause' or revised['mode']=='retry' and revised['onExhausted']=='pause':db.execute('UPDATE jobs SET blocked=1 WHERE id=?',(f['job'],))
                                self.aggregate(db,f['job']);self.event(db,f['job'],'retry_disarmed',f['idx'])
                    elif action in ('pause','resume'):db.execute("UPDATE settings SET value=? WHERE key='paused'",('true' if action=='pause' else 'false',))
                    else:raise ValueError('Invalid scheduler action')
                    self.event(db,id,action)
                else:
                    row=db.execute('SELECT * FROM jobs WHERE id=?',(id,)).fetchone()
                    if not row:raise KeyError(id)
                    frames=db.execute('SELECT * FROM job_frames WHERE job=? ORDER BY idx',(id,)).fetchall();state=row['state'];active=any(f['state']=='running' for f in frames)
                    uncertain=any(f['state']=='unknown' or json.loads(f['error'] or '{}').get('kind') in ('result_unconfirmed','persistence_unconfirmed') for f in frames if f['state']!='complete')
                    if action in ('hold','pause'):
                        if state in ('complete','archived'):raise Conflict('Task already ended')
                        db.execute('UPDATE jobs SET blocked=1 WHERE id=?',(id,));db.execute('UPDATE job_frames SET ready_at=0 WHERE job=?',(id,))
                    elif action=='resume':
                        if state!='paused' or uncertain:raise Conflict('Only held tasks can resume without recovery consent')
                        db.execute('UPDATE jobs SET blocked=0 WHERE id=?',(id,))
                    elif action=='start':
                        self.check_recovery(row,recovery)
                        if uncertain or any(f['state'] in ('failed','canceled') for f in frames):raise Conflict('Stopped or failed frames require explicit continuation')
                        if state not in ('pending','paused'):raise Conflict('Only waiting tasks can be manually started')
                        self.activate(db,row)
                    elif action in ('continue','retry'):
                        if active:raise Conflict('Hold/stop this task and wait for current attempts before retrying failed frames')
                        if state not in ('failed','unknown','canceled','paused','pending'):raise Conflict('Task cannot continue')
                        self.check_recovery(row,recovery)
                        if action=='retry' and (state!='failed' or uncertain):raise Conflict('Only confirmed failed frames can retry without unconfirmed consent')
                        if uncertain and (not recovery or recovery.get('acknowledgeUnconfirmed') is not True):raise Conflict('Explicit acknowledgement of possible duplicate upstream billing is required')
                        if all(f['state']=='complete' for f in frames):raise Conflict('All frames already complete')
                        self.activate(db,row)
                        db.execute("UPDATE job_frames SET state='pending',error=NULL,retry_count=0,ready_at=0,upstream=NULL,reconcile=0 WHERE job=? AND state IN ('failed','unknown','canceled','skipped')",(id,))
                        db.execute("UPDATE job_frames SET ready_at=0,error=NULL,retry_count=0 WHERE job=? AND state='pending'",(id,))
                    elif action=='amend':
                        self.check_recovery(row,recovery)
                        if not row['blocked'] and row['enabled']:raise Conflict('Hold the task before editing')
                        payload=json.loads(row['payload']);by_index={f['idx']:f for f in frames};changes=[];seen=set()
                        if not isinstance(edits,list) or not 1<=len(edits)<=1000:raise ValueError('Provide unfinished prompt edits')
                        for edit in edits:
                            if not isinstance(edit,dict) or set(edit)-{'index','prompt','negative'}:raise ValueError('Only prompt and negative edits are accepted')
                            i=edit.get('index')
                            if type(i) is not int or i not in by_index or i in seen or by_index[i]['state'] in ('complete','running'):raise Conflict('Completed or running frames cannot be edited')
                            seen.add(i);f=payload['frames'][i]
                            if f['config']['provider']=='comfyui':raise ValueError('Compiled ComfyUI workflow cannot use cloud prompt edits')
                            for key in ('prompt','negative'):
                                if key not in edit:continue
                                text=edit[key]
                                if not isinstance(text,str) or len(text)>100000 or key=='prompt' and not text.strip():raise ValueError('Invalid prompt')
                                if text!=f.get(key,''):changes.append({'index':i,'field':key,'before':f.get(key,''),'after':text});f[key]=text
                        if not changes:raise ValueError('No prompt changes')
                        encoded=json.dumps(payload,ensure_ascii=False)
                        if len(encoded.encode())>10*1024*1024:raise ValueError('Revised input exceeds 10 MiB')
                        db.execute('INSERT INTO revisions(job,created,changes) VALUES(?,?,?)',(id,time.time(),json.dumps(changes)));db.execute('UPDATE jobs SET payload=? WHERE id=?',(encoded,id))
                    elif action=='cancel':
                        if state in ('complete','archived'):raise Conflict('Task already ended')
                        for f in frames:
                            if f['state'] in ('complete','skipped'):continue
                            error=f['error']
                            if f['state']=='running':error=json.dumps({'kind':'result_unconfirmed','message':'Stopped locally; late output discarded. Upstream may still run or charge.'})
                            sock=self.sockets.pop((id,f['idx'],f['epoch']),None)
                            if sock:abort.append(sock)
                            db.execute("UPDATE job_frames SET state='canceled',epoch=epoch+1,ready_at=0,error=?,updated=? WHERE job=? AND idx=?",(error,time.time(),id,f['idx']))
                        db.execute('UPDATE jobs SET cancel=1,blocked=0,enabled=0 WHERE id=?',(id,))
                    elif action=='defer':
                        if active:raise Conflict('Wait for active requests or stop this task first')
                        db.execute('UPDATE jobs SET enabled=0,blocked=1 WHERE id=?',(id,))
                    elif action=='reconcile':
                        payload=json.loads(row['payload']);targets=[f for f in frames if f['state']=='unknown' and f['upstream'] and payload['frames'][f['idx']]['config']['provider']=='comfyui']
                        if not targets:raise Conflict('No unconfirmed ComfyUI prompt IDs available')
                        db.executemany("UPDATE job_frames SET state='pending',reconcile=1 WHERE job=? AND idx=?",[(id,f['idx']) for f in targets]);db.execute('UPDATE jobs SET reconcile=1,blocked=1 WHERE id=?',(id,))
                    elif action=='abandon':
                        if active:raise Conflict('Stop active requests first')
                        db.execute("UPDATE job_frames SET state='canceled' WHERE job=? AND state!='complete'",(id,));db.execute('UPDATE jobs SET cancel=1,enabled=0,blocked=0 WHERE id=?',(id,))
                    elif action in ('archive','remove'):
                        if active or uncertain:raise Conflict('Stop and resolve unconfirmed frames before removing or archiving')
                        if action=='archive' and state not in ('complete','failed','canceled'):raise Conflict('Only ended tasks can archive')
                        db.execute("UPDATE jobs SET state='archived',enabled=0,blocked=0 WHERE id=?",(id,))
                    else:raise Conflict('Invalid task action')
                    self.aggregate(db,id);self.event(db,id,action)
            for sock in abort:close_socket(sock)
            self.wake.set();return self.list() if id=='scheduler' else self.get(id)
    return FrameJobs

def validate_submission(payload, token):
    if not isinstance(token,str) or not 1<=len(token)<=160:raise ValueError('idempotencyKey is required (1..160 characters)')
    if not isinstance(payload,dict):raise ValueError('Job input must be an object')
    payload=copy.deepcopy(payload)
    if set(payload)-{'frames','label','albumId','owner','hold'}:raise ValueError('Unknown job field')
    for field in ('label','owner','albumId'):
        if field in payload and (not isinstance(payload[field],str) or len(payload[field])>250):raise ValueError('Invalid job '+field)
    if 'hold' in payload and not isinstance(payload['hold'],bool):raise ValueError('hold must be boolean')
    frames=payload.get('frames')
    if not isinstance(frames,list) or not 1<=len(frames)<=1000:raise ValueError('frames must contain 1..1000 generation inputs')
    for frame in frames:
        if not isinstance(frame,dict) or set(frame)-{'config','prompt','negative','images','frame','workflow','albumId','source','frameIndex','channelId'}:raise ValueError('Unknown generation input fields')
        if 'channelId' in frame and (not isinstance(frame['channelId'],str) or not 1<=len(frame['channelId'])<=150):raise ValueError('Invalid channelId')
        if not isinstance(frame.get('config'),dict) or frame['config'].get('provider') not in ('openai','novelai','comfyui'):raise ValueError('Invalid frame provider')
        if any(k in frame for k in ('key','apiKey','_checkpoint')) or any(k in frame['config'] for k in ('key','apiKey')):raise ValueError('Durable jobs use stored/environment credentials, not inline secrets')
        if not isinstance(frame.get('config'),dict) or set(frame['config'])-{'provider','baseUrl','model','protocol','keyMode','keyId','id','title','sendQuality','sendSize','size','quality','sampler','extraParams','outputNodeId'}:raise ValueError('Unknown channel fields')
        if 'frameIndex' in frame and (type(frame['frameIndex']) is not int or not 0<=frame['frameIndex']<10000):raise ValueError('Invalid frameIndex')
        if not isinstance(frame.get('prompt',''),str):raise ValueError('prompt must be a string')
        if not isinstance(frame.get('images',[]),list) or len(frame.get('images',[]))>32:raise ValueError('At most 32 ordered images')
        if any(not isinstance(src,str) or not src.startswith('/images/') for src in frame.get('images',[])):raise ValueError('Upload job images first; jobs persist local references only')
        if frame.get('source') and not frame['source'].startswith('/images/'):raise ValueError('Upload source image first')
    encoded=json.dumps(payload,sort_keys=True,ensure_ascii=False,allow_nan=False)
    if len(encoded.encode())>10*1024*1024:raise ValueError('Job exceeds 10 MiB')
    digest=hashlib.sha256(encoded.encode()).hexdigest()
    return payload,encoded,digest


def public_request_input(value):
    # Endpoint URLs and arbitrary profile metadata may contain credentials.
    output={k:v for k,v in value.items() if k in ('prompt','negative','images','frame')}
    output['config']={k:v for k,v in value.get('config',{}).items() if k in ('provider','protocol','model','size','quality','sendSize','sendQuality','sampler')}
    if isinstance(value.get('workflow'),dict):
        names={'text','prompt','negative','seed','noise_seed','steps','cfg','sampler_name','scheduler','denoise','width','height','batch_size','ckpt_name'}
        output['workflowParameters']={str(k):{'class_type':v.get('class_type'),'inputs':{n:x for n,x in v.get('inputs',{}).items() if n in names}} for k,v in value['workflow'].items() if isinstance(v,dict) and isinstance(v.get('inputs'),dict)}
    return output
