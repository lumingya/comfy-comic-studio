import tempfile
import time
import threading
import unittest
from mio_jobs import Jobs, Conflict

class DurableJobsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.calls=[]
        def execute(frame):self.calls.append(frame);return {'image':'/images/result.png','artifacts':[{'kind':'image','url':'/images/result.png'}]}
        self.store=Jobs(self.temp.name,execute);self.addCleanup(self.store.close)
    def payload(self,hold=False,count=1):return {'hold':hold,'frames':[{'config':{'provider':'openai','keyMode':'none'},'prompt':'test','images':[]} for _ in range(count)]}
    def wait(self,id,status):
        end=time.monotonic()+5
        while time.monotonic()<end:
            job=self.store.get(id)
            if job['state']==status:return job
            time.sleep(.01)
        self.fail(str(job))
    def test_executes_all_frames_without_a_browser(self):
        job=self.store.submit(self.payload(count=3),'one')
        result=self.wait(job['id'],'complete');self.assertEqual(result['cursor'],3);self.assertEqual(len(self.calls),3)
    def test_idempotent_submit_never_reexecutes(self):
        first=self.store.submit(self.payload(),'same');self.wait(first['id'],'complete')
        second=self.store.submit(self.payload(),'same');self.assertEqual(first['id'],second['id']);self.assertEqual(len(self.calls),1)
    def test_conflicting_key_rejected(self):
        self.store.submit(self.payload(True),'same')
        with self.assertRaises(Conflict):self.store.submit(self.payload(True,2),'same')
    def test_pending_survives_restart(self):
        first=self.store.submit(self.payload(True),'held');self.store.close()
        self.store=Jobs(self.temp.name,lambda _: {'image':'/images/a.png'});self.addCleanup(self.store.close)
        self.assertEqual(self.store.get(first['id'])['state'],'paused');self.store.control(first['id'],'resume');self.wait(first['id'],'complete')
    def test_interrupted_attempt_becomes_unknown_without_retry(self):
        first=self.store.submit(self.payload(True),'held');self.store.close()
        with self.store.connect() as db:db.execute("UPDATE jobs SET state='running',upstream='remote-123' WHERE id=?",(first['id'],))
        self.store=Jobs(self.temp.name,lambda _:self.fail('must not retry'));self.addCleanup(self.store.close)
        job=self.store.get(first['id']);self.assertEqual(job['state'],'unknown');self.assertEqual(job['upstream'],'remote-123')
        with self.assertRaises(Conflict):self.store.control(job['id'],'resume')
    def test_only_one_worker_can_own_a_directory(self):
        with self.assertRaises(OSError):Jobs(self.temp.name,lambda _:None)
    def test_reorder_and_global_pause(self):
        self.store.control('scheduler','pause');a=self.store.submit(self.payload(),'a');b=self.store.submit(self.payload(),'b')
        self.store.reorder([b['id'],a['id']]);self.assertEqual(self.store.list()['jobs'][0]['id'],b['id']);self.assertEqual(len(self.calls),0)
        self.store.control('scheduler','resume');self.wait(a['id'],'complete')
    def test_cancel_before_dispatch(self):
        a=self.store.submit(self.payload(True),'a');self.store.control(a['id'],'cancel');self.assertEqual(self.store.get(a['id'])['state'],'canceled');self.assertFalse(self.calls)
    def test_cancel_immediately_discards_current_and_stops_next_frame(self):
        started=threading.Event();release=threading.Event()
        def execute(frame):started.set();release.wait(5);return {'image':'/images/paid-result.png'}
        self.store.execute=execute;job=self.store.submit(self.payload(count=2),'cancel')
        self.assertTrue(started.wait(3));self.store.control(job['id'],'cancel');release.set()
        result=self.wait(job['id'],'canceled');self.assertEqual(result['cursor'],0);self.assertEqual(len(result['results']),0)
        for worker in list(self.store.workers):worker.join(2)
        self.assertEqual(self.store.get(job['id'])['cursor'],0)
    def test_unknown_network_result_is_not_retried(self):
        def execute(frame):raise TimeoutError('acknowledgement lost')
        self.store.execute=execute;job=self.store.submit(self.payload(),'timeout');result=self.wait(job['id'],'unknown');self.assertEqual(result['error']['kind'],'result_unconfirmed')
    def test_events_have_monotonic_replay_ids(self):
        job=self.store.submit(self.payload(),'events');self.wait(job['id'],'complete');events=self.store.events();ids=[e['id'] for e in events]
        self.assertEqual(ids,sorted(set(ids)));self.assertEqual(self.store.events(ids[-1]),[])
    def test_inline_credentials_and_inline_images_are_rejected(self):
        for key,value in [('apiKey','secret'),('images',['data:image/png;base64,AA=='])]:
            data=self.payload();data['frames'][0][key]=value
            with self.assertRaises(ValueError):self.store.submit(data,key)

    def test_reorder_does_not_jump_ahead_of_started_book(self):
        self.store.control('scheduler','pause')
        a=self.store.submit(self.payload(True,2),'started');b=self.store.submit(self.payload(),'next');c=self.store.submit(self.payload(),'last')
        with self.store.connect() as db:db.execute("UPDATE jobs SET state='pending',cursor=1 WHERE id=?",(a['id'],))
        self.store.reorder([c['id'],b['id']])
        self.assertLess(self.store.get(a['id'])['position'],self.store.get(c['id'])['position'])
        self.assertLess(self.store.get(c['id'])['position'],self.store.get(b['id'])['position'])
        with self.assertRaises(Conflict):self.store.reorder([a['id']])

    def manual_store(self):
        self.store.close()
        return self.store

    def test_task_pause_does_not_pause_other_manual_tasks(self):
        s=self.manual_store();s.control('scheduler','policy',{'mode':'pause'});s.execute=lambda _:(_ for _ in ()).throw(ValueError('invalid'))
        a=s.submit(self.payload(),'bad');b=s.submit(self.payload(),'next');s.step()
        self.assertEqual(s.get(a['id'])['state'],'failed');self.assertFalse(s.list()['paused']);self.assertTrue(s.step());self.assertEqual(s.get(b['id'])['attempts'],1)

    def test_bounded_retry_preserves_fifo_and_exhausts(self):
        s=self.manual_store()
        class Transient(Exception):status=503
        s.execute=lambda _:(_ for _ in ()).throw(Transient('service unavailable'))
        s.control('scheduler','policy',{'mode':'retry','maxRetries':2,'delaySeconds':5})
        a=s.submit(self.payload(),'retry');b=s.submit(self.payload(),'next');s.step()
        self.assertEqual(s.get(a['id'])['retry_count'],1);self.assertFalse(s.step());self.assertEqual(s.get(b['id'])['attempts'],0)
        for _ in range(2):
            with s.connect() as db:db.execute('UPDATE job_frames SET ready_at=0 WHERE job=?',(a['id'],))
            s.step()
        result=s.get(a['id']);self.assertEqual(result['state'],'failed');self.assertEqual(result['attempts'],3);self.assertEqual(len(result['errors']),3);self.assertFalse(s.list()['paused'])

    def test_unknown_never_retries_even_when_policy_enabled(self):
        s=self.manual_store();s.control('scheduler','policy',{'mode':'retry'});s.execute=lambda _:(_ for _ in ()).throw(TimeoutError('lost'))
        a=s.submit(self.payload(),'unknown');s.step();self.assertEqual(s.get(a['id'])['state'],'unknown');self.assertEqual(s.get(a['id'])['retry_count'],0);self.assertFalse(s.list()['paused'])
        with self.assertRaises(Conflict):s.control(a['id'],'retry')

    def test_auth_error_does_not_auto_retry(self):
        s=self.manual_store()
        class Unauthorized(Exception):status=401
        s.control('scheduler','policy',{'mode':'retry'});s.execute=lambda _:(_ for _ in ()).throw(Unauthorized('bad key'))
        a=s.submit(self.payload(),'auth');s.step();self.assertEqual(s.get(a['id'])['state'],'failed');self.assertEqual(s.get(a['id'])['attempts'],1)

    def test_continue_completes_other_frames_before_next_task(self):
        s=self.manual_store();s.control('scheduler','policy',{'mode':'continue'})
        s.execute=lambda f:(_ for _ in ()).throw(ValueError('bad')) if f['prompt']=='bad' else {'image':'/images/ok.png'}
        payload=self.payload(count=2);payload['frames'][0]['prompt']='bad'
        a=s.submit(payload,'bad');b=s.submit(self.payload(),'next');s.step();s.step()
        self.assertEqual(s.get(a['id'])['cursor'],1);self.assertEqual(s.get(a['id'])['results'][0]['index'],1);self.assertEqual(s.get(b['id'])['state'],'pending');s.step();self.assertEqual(s.get(b['id'])['state'],'complete')

    def test_manual_retry_keeps_original_job_and_completed_frames(self):
        s=self.manual_store();n=0
        def run(frame):
            nonlocal n
            n+=1
            if n==2:raise ValueError('rejected')
            return {'image':'/images/'+str(n)+'.png'}
        s.execute=run;a=s.submit(self.payload(count=2),'same');s.step();s.step()
        self.assertEqual(s.get(a['id'])['cursor'],1)
        job=s.get(a['id']);s.control(a['id'],'retry',recovery={'expectedCursor':job['cursor'],'expectedUpdated':job['updated']});self.assertFalse(s.list()['paused']);s.control('scheduler','resume');s.step()
        r=s.get(a['id']);self.assertEqual(r['state'],'complete');self.assertEqual([x['index'] for x in r['results']],[0,1]);self.assertEqual(r['results'][0]['image'],'/images/1.png');self.assertEqual(len(r['errors']),1);self.assertIsNone(r['error']);self.assertEqual(n,3)

    def test_retry_policy_validation_and_persistence(self):
        s=self.manual_store()
        for policy in [{'maxRetries':True},{'maxRetries':101},{'delaySeconds':0},{'mode':'forever'},{'extra':1}]:
            with self.assertRaises(ValueError):s.control('scheduler','policy',policy)
        s.control('scheduler','policy',{'mode':'retry','maxRetries':4});reopened=Jobs(self.temp.name,lambda _:None)
        self.addCleanup(reopened.close);self.assertEqual(reopened.policy()['maxRetries'],4)

    def test_cancel_retry_wait_prevents_future_attempts(self):
        s=self.manual_store()
        class Busy(Exception):status=429
        s.control('scheduler','policy',{'mode':'retry'});s.execute=lambda _:(_ for _ in ()).throw(Busy('rate limit'))
        a=s.submit(self.payload(),'cancel-wait');s.step();s.control(a['id'],'cancel');self.assertFalse(s.step());self.assertEqual(s.get(a['id'])['state'],'canceled')

    def test_changing_policy_disarms_waiting_retry(self):
        s=self.manual_store()
        class Busy(Exception):status=503
        s.control('scheduler','policy',{'mode':'retry'});s.execute=lambda _:(_ for _ in ()).throw(Busy('busy'))
        a=s.submit(self.payload(),'wait');s.step()
        with self.assertRaises(Conflict):s.reorder([a['id']])
        s.control('scheduler','policy',{'mode':'pause'});self.assertEqual(s.get(a['id'])['state'],'failed');self.assertEqual(s.get(a['id'])['ready_at'],0);self.assertFalse(s.list()['paused'])

    def test_acknowledged_unknown_continues_at_saved_cursor(self):
        s=self.manual_store();sent=[]
        def run(f):
            sent.append(f['prompt'])
            if sent==['0','1']:raise TimeoutError('read timed out')
            return {'image':'/images/'+f['prompt']+'.png','index':0}
        s.execute=run;data=self.payload(count=3)
        for i,f in enumerate(data['frames']):f['prompt']=str(i);f['frameIndex']=i+4
        a=s.submit(data,'recovery');s.step();s.step();old=s.get(a['id'])
        self.assertEqual(old['cursor'],1);self.assertEqual(old['nextFrameIndex'],5)
        recovery={'expectedCursor':1,'expectedUpdated':old['updated']}
        with self.assertRaises(Conflict):s.control(a['id'],'continue',recovery=recovery)
        recovery['acknowledgeUnconfirmed']=True;s.control(a['id'],'continue',recovery=recovery)
        with self.assertRaises(Conflict):s.control(a['id'],'continue',recovery=recovery)
        s.control('scheduler','resume');s.step();s.step();result=s.get(a['id'])
        self.assertEqual(sent,['0','1','1','2']);self.assertEqual(result['cursor'],3)
        self.assertEqual([r['index'] for r in result['results']],[0,1,2]);self.assertEqual(result['results'][0]['image'],old['results'][0]['image'])

    def test_stale_or_inconsistent_recovery_is_rejected(self):
        s=self.manual_store();a=s.submit(self.payload(),'corrupt')
        with s.connect() as db:db.execute("UPDATE jobs SET state='unknown',cursor=1 WHERE id=?",(a['id'],))
        old=s.get(a['id'])
        for cursor in [0,1]:
            with self.assertRaises(Conflict):s.control(a['id'],'continue',recovery={'expectedCursor':cursor,'expectedUpdated':old['updated'],'acknowledgeUnconfirmed':True})
        self.assertEqual(s.get(a['id'])['cursor'],1)

    def test_runtime_validation_persists_and_reaches_attempt(self):
        s=self.manual_store()
        for runtime in [{'concurrency':0},{'concurrency':17},{'concurrency':True},{'requestTimeoutSeconds':29},{'requestTimeoutSeconds':7201}]:
            with self.assertRaises(ValueError):s.control('scheduler','runtime',runtime=runtime)
        s.control('scheduler','runtime',runtime={'concurrency':2,'requestTimeoutSeconds':90})
        a=s.submit(self.payload(),'runtime');s.step();self.assertEqual(self.calls[-1]['_requestTimeout'],90);self.assertEqual(s.get(a['id'])['active_timeout'],90)
        other=Jobs(self.temp.name,lambda _:None);self.addCleanup(other.close);self.assertEqual(other.runtime(),{'concurrency':2,'requestTimeoutSeconds':90})

    def test_parallel_frames_and_default_sequential_albums(self):
        started=threading.Event();release=threading.Event();guard=threading.Lock();active=set();peak=[0];seen=[];collisions=[]
        def run(f):
            album=f['albumId'];key=(album,f['prompt'])
            with guard:
                if any(a!=album for a,_ in active):collisions.append(album)
                active.add(key);peak[0]=max(peak[0],len(active));seen.append((album,f['prompt']))
                if len(active)==2:started.set()
            release.wait(4)
            with guard:active.remove(key)
            return {'image':'/images/'+album+'.png'}
        self.store.execute=run;self.store.control('scheduler','runtime',runtime={'concurrency':2})
        jobs=[]
        for name in ['a','b','c']:
            p=self.payload(count=2);p['albumId']=name
            for i,f in enumerate(p['frames']):f.update(albumId=name,prompt=str(i))
            jobs.append(self.store.submit(p,name))
        self.assertTrue(started.wait(3));self.assertEqual(peak[0],2);release.set()
        for job in jobs:self.wait(job['id'],'complete')
        self.assertFalse(collisions);self.assertEqual(peak[0],2)
        for name in ['a','b','c']:self.assertEqual(sorted(p for a,p in seen if a==name),['0','1'])

    def test_parallel_claim_does_not_run_two_jobs_for_same_album(self):
        s=self.manual_store();s.control('scheduler','runtime',runtime={'concurrency':3})
        data=self.payload();data['albumId']='shared'
        a=s.submit(data,'first');b=s.submit(data,'second');row=s.claim();self.assertEqual(row['id'],a['id']);self.assertIsNone(s.claim())
        s.execute_row(row);row=s.claim();self.assertEqual(row['id'],b['id']);s.execute_row(row)

    def test_lower_concurrency_and_pause_do_not_interrupt_current_attempt(self):
        s=self.manual_store();s.control('scheduler','runtime',runtime={'concurrency':2,'requestTimeoutSeconds':60})
        jobs=[s.submit(self.payload(count=3),str(i)) for i in range(3)]
        rows=[s.claim(),s.claim()];self.assertIsNotNone(rows[1]);s.control('scheduler','runtime',runtime={'concurrency':1,'requestTimeoutSeconds':120})
        self.assertIsNone(s.claim());self.assertEqual(rows[0]['active_timeout'],60)
        s.control('scheduler','pause');s.execute_row(rows[0]);s.execute_row(rows[1]);self.assertIsNone(s.claim());self.assertEqual(s.get(jobs[2]['id'])['state'],'pending')

    def test_worker_lease_is_held_until_inflight_request_finishes(self):
        from mio_jobs import acquire_lease
        started=threading.Event();release=threading.Event()
        def run(_):started.set();release.wait(5);return {'image':'/images/end.png'}
        self.store.execute=run;a=self.store.submit(self.payload(),'lease-inflight');self.assertTrue(started.wait(2));self.store.close()
        try:
            with self.assertRaises(OSError):acquire_lease(self.temp.name)
        finally:release.set()
        self.wait(a['id'],'complete')
        end=time.monotonic()+3
        while not self.store.lease.closed and time.monotonic()<end:time.sleep(.01)
        self.assertTrue(self.store.lease.closed)
        lease=acquire_lease(self.temp.name);lease.close()

    def test_persistence_error_after_upstream_success_stays_unknown(self):
        s=self.manual_store();original=s.event
        def event(db,id,state,index=None):
            if state=='frame_complete':raise PermissionError('storage unavailable')
            return original(db,id,state,index)
        s.event=event;a=s.submit(self.payload(),'persist-error');s.step();job=s.get(a['id'])
        self.assertEqual(job['state'],'unknown');self.assertEqual(job['cursor'],0);self.assertFalse(s.list()['paused'])

    def test_abandoning_unknown_does_not_bypass_continuation_consent(self):
        s=self.manual_store();s.execute=lambda _:(_ for _ in ()).throw(TimeoutError('timeout'));a=s.submit(self.payload(),'abandon-consent');s.step();s.control(a['id'],'abandon');job=s.get(a['id'])
        with self.assertRaises(Conflict):s.control(a['id'],'continue',recovery={'expectedCursor':job['cursor'],'expectedUpdated':job['updated']})

    def test_malformed_job_configuration_is_rejected_before_execution(self):
        for data in [[],None,{'frames':[{'config':None}]},{'frames':[{'config':[]}]},{'frames':[{'config':'openai'}]}]:
            with self.assertRaises(ValueError):self.store.submit(data,'malformed')
        self.assertFalse(self.calls)

    def test_stopped_attempt_cannot_overwrite_immediate_continuation(self):
        s=self.manual_store();a=s.submit(self.payload(count=2),'fence');old=s.claim();s.control(a['id'],'cancel');stopped=s.get(a['id'])
        s.control(a['id'],'continue',recovery={'expectedCursor':0,'expectedUpdated':stopped['updated'],'acknowledgeUnconfirmed':True})
        current=s.claim();s.execute_row(old);self.assertEqual(s.get(a['id'])['state'],'running');self.assertFalse(self.calls)
        s.execute_row(current);self.assertEqual(s.get(a['id'])['cursor'],1)

    def test_amend_keeps_completed_prefix_and_original_idempotency(self):
        s=self.manual_store();data=self.payload(count=3);a=s.submit(data,'amend');s.step();s.control(a['id'],'pause');job=s.get(a['id'])
        recovery={'expectedCursor':1,'expectedUpdated':job['updated']}
        with self.assertRaises(Conflict):s.control(a['id'],'amend',recovery=recovery,edits=[{'index':0,'prompt':'must not change'}])
        s.control(a['id'],'amend',recovery=recovery,edits=[{'index':1,'prompt':'revised safe scene'}]);job=s.get(a['id'])
        self.assertEqual(len(job['results']),1);self.assertEqual(len(job['revisions']),1);self.assertEqual(job['editableFrames'][0]['prompt'],'revised safe scene')
        self.assertEqual(s.submit(data,'amend')['id'],a['id'])
        s.control(a['id'],'continue',recovery={'expectedCursor':1,'expectedUpdated':job['updated']});s.step();self.assertEqual(self.calls[-1]['prompt'],'revised safe scene');self.assertEqual(s.get(a['id'])['results'][1]['prompt'],'revised safe scene')

    def test_actual_5xx_status_retries_even_when_body_mentions_422(self):
        s=self.manual_store();s.control('scheduler','policy',policy={'mode':'retry'})
        class Rejected(Exception):status=502
        s.execute=lambda _:(_ for _ in ()).throw(Rejected('Arena [422]: Request rejected: Content violates our terms'))
        a=s.submit(self.payload(),'policy');s.step();job=s.get(a['id']);self.assertEqual(job['state'],'pending');self.assertGreater(job['ready_at'],0)

    def test_hold_disarms_retry_and_activity_survives_reload(self):
        s=self.manual_store();s.control('scheduler','policy',policy={'mode':'retry'})
        class Busy(Exception):status=503
        s.execute=lambda _:(_ for _ in ()).throw(Busy('busy'));a=s.submit(self.payload(),'hold');s.step();s.control(a['id'],'hold')
        self.assertEqual(s.get(a['id'])['state'],'paused');self.assertEqual(s.get(a['id'])['ready_at'],0)
        other=Jobs(self.temp.name,lambda _:None);self.addCleanup(other.close)
        records=other.activity();self.assertTrue(any(e['state']=='retry_wait' and e['error']['message']=='busy' for e in records));self.assertTrue(any(e['state']=='hold' for e in records))

    def test_four_frame_window_refills_without_waiting_for_slowest(self):
        s=self.manual_store();s.control('scheduler','runtime',runtime={'concurrency':4})
        a=s.submit(self.payload(count=8),'window');b=s.submit(self.payload(count=8),'next')
        rows=[s.claim() for _ in range(4)];self.assertEqual([r['idx'] for r in rows],[0,1,2,3]);self.assertIsNone(s.claim())
        s.execute_row(rows[3]);next_row=s.claim();self.assertEqual(next_row['idx'],4)
        job=s.get(a['id']);self.assertEqual(job['runningIndices'],[0,1,2,4]);self.assertEqual(job['completedIndices'],[3]);self.assertEqual(job['cursor'],1);self.assertEqual(job['nextIndex'],0)
        self.assertEqual(s.get(b['id'])['attempts'],0)

    def test_two_manually_started_tasks_each_get_four_slots(self):
        s=self.manual_store();s.control('scheduler','runtime',runtime={'concurrency':4})
        a=s.submit(self.payload(count=8),'a8');b=s.submit(self.payload(count=8),'b8')
        first=[s.claim() for _ in range(4)];b=s.get(b['id']);s.control(b['id'],'start',recovery={'expectedCursor':b['cursor'],'expectedUpdated':b['updated']})
        second=[s.claim() for _ in range(4)];self.assertTrue(all(r['id']==a['id'] for r in first));self.assertTrue(all(r['id']==b['id'] for r in second));self.assertIsNone(s.claim())
        self.assertEqual(sum(j['running_count'] for j in s.list()['jobs']),8)
        s.execute_row(second[1]);self.assertEqual(s.claim()['idx'],4)

    def test_pause_one_task_does_not_block_another_pool(self):
        s=self.manual_store();s.control('scheduler','runtime',runtime={'concurrency':2});s.control('scheduler','policy',policy={'mode':'pause'})
        a=s.submit(self.payload(count=4),'pa');b=s.submit(self.payload(count=4),'pb');ar=[s.claim(),s.claim()]
        s.control(b['id'],'start',recovery={'expectedCursor':0,'expectedUpdated':b['updated']});br=[s.claim(),s.claim()]
        s.execute=lambda _:(_ for _ in ()).throw(TimeoutError('unconfirmed'));s.execute_row(ar[0]);self.assertTrue(s.get(a['id'])['blocked']);self.assertFalse(s.list()['paused'])
        s.execute=lambda _: {'image':'/images/ok.png'};s.execute_row(br[0]);next_row=s.claim();self.assertEqual(next_row['id'],b['id']);self.assertEqual(next_row['idx'],2)

    def test_out_of_order_restart_keeps_every_completed_index(self):
        s=self.manual_store();s.control('scheduler','runtime',runtime={'concurrency':4});a=s.submit(self.payload(count=6),'restart-holes');rows=[s.claim() for _ in range(4)]
        s.execute_row(rows[3]);s.execute_row(rows[1]);self.assertEqual(s.get(a['id'])['completedIndices'],[1,3])
        other=Jobs(self.temp.name,lambda _:self.fail('Unknown attempts must not replay'));self.addCleanup(other.close)
        job=other.get(a['id']);self.assertEqual(job['cursor'],2);self.assertEqual(job['completedIndices'],[1,3]);self.assertEqual([f['index'] for f in job['frameStates'] if f['state']=='unknown'],[0,2]);self.assertTrue(other.list()['paused'])
        with self.assertRaises(Conflict):other.control(a['id'],'continue',recovery={'expectedCursor':2,'expectedUpdated':job['updated']})

    def test_retry_does_not_resubmit_successful_frames_after_a_hole(self):
        s=self.manual_store();s.control('scheduler','runtime',runtime={'concurrency':4});a=s.submit(self.payload(count=4),'holes');rows=[s.claim() for _ in range(4)]
        for row in rows[1:]:s.execute_row(row)
        s.execute=lambda _:(_ for _ in ()).throw(ValueError('bad first'));s.execute_row(rows[0]);job=s.get(a['id']);self.assertEqual(job['completedIndices'],[1,2,3])
        s.control(a['id'],'continue',recovery={'expectedCursor':3,'expectedUpdated':job['updated']});row=s.claim();self.assertEqual(row['idx'],0);self.assertIsNone(s.claim())
        s.execute=lambda _: {'image':'/images/fixed.png'};s.execute_row(row);self.assertEqual([r['index'] for r in s.get(a['id'])['results']],[0,1,2,3])

    def test_default_unknown_frame_does_not_block_later_frames(self):
        s=self.manual_store();a=s.submit(self.payload(count=3),'unknown-default');s.execute=lambda _:(_ for _ in ()).throw(TimeoutError('lost'));s.step()
        s.execute=lambda _: {'image':'/images/good.png'};s.step();s.step();job=s.get(a['id']);self.assertEqual(job['state'],'unknown');self.assertEqual(job['completedIndices'],[1,2]);self.assertEqual(job['attempts'],3);self.assertFalse(s.step())

    def test_stop_closes_all_task_sockets_but_not_other_task(self):
        import socket
        s=self.manual_store();s.control('scheduler','runtime',runtime={'concurrency':4});a=s.submit(self.payload(count=6),'sock-a');b=s.submit(self.payload(count=6),'sock-b');ar=[s.claim() for _ in range(4)]
        s.control(b['id'],'start',recovery={'expectedCursor':0,'expectedUpdated':b['updated']});br=[s.claim() for _ in range(4)];peers=[]
        for row in ar+br:
            local,remote=socket.socketpair();self.addCleanup(local.close);self.addCleanup(remote.close);remote.settimeout(.5);s.register_socket(row,local);peers.append((local,remote))
        s.control(a['id'],'cancel')
        for _,remote in peers[:4]:self.assertEqual(remote.recv(1),b'')
        for local,remote in peers[4:]:local.send(b'x');self.assertEqual(remote.recv(1),b'x')
        self.assertEqual(s.get(a['id'])['running_count'],0);self.assertEqual(s.get(b['id'])['running_count'],4)
        for row in ar:self.assertFalse(s.attempt_valid(row));s.execute_row(row)
        self.assertFalse(self.calls)

    def test_amend_hole_before_completed_count_and_reject_finished_index(self):
        s=self.manual_store();s.control('scheduler','runtime',runtime={'concurrency':4});a=s.submit(self.payload(count=4),'amend-hole');rows=[s.claim() for _ in range(4)]
        for row in rows[1:]:s.execute_row(row)
        s.execute=lambda _:(_ for _ in ()).throw(ValueError('first rejected'));s.execute_row(rows[0]);s.control(a['id'],'hold');job=s.get(a['id']);recovery={'expectedCursor':3,'expectedUpdated':job['updated']}
        with self.assertRaises(Conflict):s.control(a['id'],'amend',recovery=recovery,edits=[{'index':2,'prompt':'must not change'}])
        s.control(a['id'],'amend',recovery=recovery,edits=[{'index':0,'prompt':'revised missing first frame'}]);job=s.get(a['id']);self.assertEqual(job['completedIndices'],[1,2,3]);self.assertEqual(job['editableFrames'][0]['prompt'],'revised missing first frame')

    def test_failed_head_yields_without_defer_or_replaying_frames(self):
        s=self.manual_store();s.control('scheduler','policy',policy={'mode':'pause'});a=s.submit(self.payload(count=2),'yield-a');b=s.submit(self.payload(),'yield-b')
        s.execute=lambda _:(_ for _ in ()).throw(ValueError('failed'));s.step();self.assertEqual(s.claim()['id'],b['id']);self.assertEqual(s.get(a['id'])['attempts'],1)

    def test_final_request_parameters_are_separate_and_safe(self):
        import json
        from providers.request_evidence import safe_request
        s=self.manual_store()
        def execute(frame):
            frame['_onRequest'](safe_request({'model':'actual','seed':123,'apiKey':'private','nested':{'Authorization':'private'},'image':'base64','prompt':'hello private'},'private'))
            return {'image':'/images/ok.png'}
        s.execute=execute;a=s.submit(self.payload(),'wire-evidence');s.step();j=s.get(a['id']);p=j['requestHistory'][0]['requestParameters']
        self.assertEqual(p['seed'],123);self.assertEqual(p['model'],'actual');self.assertNotIn('private',json.dumps(p));self.assertNotIn('base64',json.dumps(p))
        e=next(e for e in s.events() if e['state']=='request_ready');self.assertEqual(e['frameAttempt'],1);self.assertEqual(e['request']['requestParameters'],p)
        self.assertEqual(j['requestHistory'][0]['prompt'],'test')

    def test_all_http_status_classes_and_skipped_422(self):
        s=self.manual_store();s.control('scheduler','policy',{'mode':'retry','maxRetries':1})
        for status in (400,401,403,404,408,422,429,499,500,501,502,503,504,507,529,599):
            with self.subTest(status=status):
                class HTTPError(Exception):pass
                error=HTTPError('controlled failure');error.status=status
                s.execute=lambda _,error=error:(_ for _ in ()).throw(error)
                a=s.submit(self.payload(),str(status));s.step();j=s.get(a['id'])
                self.assertEqual(j['frameStates'][0]['state'],'pending' if status>=500 else 'skipped' if status==422 else 'failed')
                self.assertEqual(j['retry_count'],int(status>=500));s.control(a['id'],'cancel')

    def test_manual_retry_refreshes_auto_budget_and_logs_are_scene_specific(self):
        s=self.manual_store();s.control('scheduler','policy',{'mode':'retry','maxRetries':1})
        class HTTPError(Exception):status=500
        s.execute=lambda _:(_ for _ in ()).throw(HTTPError('old error'));a=s.submit(self.payload(),'fresh-budget')
        for cycle in range(4):
            self.assertTrue(s.step())
            with s.connect() as db:db.execute('UPDATE job_frames SET ready_at=0 WHERE job=?',(a['id'],))
            self.assertTrue(s.step());j=s.get(a['id']);self.assertEqual(j['state'],'failed');self.assertEqual(j['retry_count'],1)
            if cycle<3:s.control(a['id'],'retry',recovery={'expectedCursor':j['cursor'],'expectedUpdated':j['updated']})
        inputs=[e for e in s.events() if e['state']=='input_read']
        self.assertEqual(len(inputs),8);self.assertEqual([e['frameAttempt'] for e in inputs],list(range(1,9)))
        self.assertTrue(all('error' not in e and e['request']['prompt']=='test' for e in inputs))

    def test_422_skips_scene_even_with_pause_policy_and_keeps_sparse_results(self):
        s=self.manual_store();s.control('scheduler','policy',{'mode':'pause'})
        class Rejected(Exception):status=422
        s.execute=lambda _:(_ for _ in ()).throw(Rejected('policy rejected'));a=s.submit(self.payload(count=3),'422-sparse');s.step()
        s.execute=lambda _:{'image':'/images/ok.png'};s.step();s.step();j=s.get(a['id'])
        self.assertEqual(j['completedIndices'],[1,2]);self.assertEqual(j['frameStates'][0]['state'],'skipped')
        s.control(a['id'],'retry',recovery={'expectedCursor':j['cursor'],'expectedUpdated':j['updated']});s.step();self.assertEqual(s.get(a['id'])['completedIndices'],[0,1,2])

    def test_migrate_existing_prefix_without_resubmission(self):
        s=self.manual_store();a=s.submit(self.payload(count=4),'old-prefix');s.step();s.step();s.control(a['id'],'hold');before=s.get(a['id'])
        with s.connect() as db:db.execute('DELETE FROM job_frames WHERE job=?',(a['id'],));db.execute('UPDATE jobs SET frame_migrated=0 WHERE id=?',(a['id'],))
        other=Jobs(self.temp.name,lambda _:self.fail('held migration must not submit'));self.addCleanup(other.close);job=other.get(a['id']);self.assertEqual(job['results'],before['results']);self.assertEqual(job['completedIndices'],[0,1]);self.assertEqual(job['nextIndex'],2);self.assertEqual(job['state'],'paused')

    def test_migration_failure_never_dispatches_and_releases_lease(self):
        import sqlite3
        s=self.manual_store();a=s.submit(self.payload(count=2),'migration-fault')
        with s.connect() as db:
            db.execute('DELETE FROM job_frames WHERE job=?',(a['id'],));db.execute('UPDATE jobs SET frame_migrated=0 WHERE id=?',(a['id'],));db.execute("CREATE TRIGGER migration_fault BEFORE INSERT ON job_frames BEGIN SELECT RAISE(ABORT,'migration fault'); END")
        with self.assertRaises(sqlite3.IntegrityError):Jobs(self.temp.name,lambda _:self.fail('failed initialization must not dispatch'))
        with s.connect() as db:db.execute('DROP TRIGGER migration_fault');db.execute("UPDATE settings SET value='true' WHERE key='paused'")
        other=Jobs(self.temp.name,lambda _:self.fail('paused'));self.addCleanup(other.close);self.assertEqual(other.get(a['id'])['attempts'],0)

    def test_real_dispatcher_has_no_shared_thirty_two_worker_cap(self):
        gate=threading.Event();lock=threading.Lock();started=[]
        def execute(frame):
            with lock:started.append(frame['prompt'])
            gate.wait(8);return {'image':'/images/'+frame['prompt']+'.png'}
        s=self.store;s.execute=execute;self.addCleanup(gate.set);s.control('scheduler','runtime',runtime={'concurrency':16})
        for name in ('a','b','c'):
            p=self.payload(count=20)
            for i,f in enumerate(p['frames']):f['prompt']=name+str(i)
            job=s.submit(p,'real-pool-'+name)
            if name!='a':s.control(job['id'],'start',recovery={'expectedCursor':0,'expectedUpdated':job['updated']})
        deadline=time.monotonic()+5
        while len(started)<48 and time.monotonic()<deadline:time.sleep(.02)
        self.assertEqual(len(started),48);self.assertEqual([sum(x.startswith(n) for x in started) for n in ('a','b','c')],[16,16,16]);gate.set()

    def test_retry_rejects_missing_or_stale_confirmation(self):
        s=self.manual_store();s.execute=lambda _:(_ for _ in ()).throw(ValueError('rejected'));job=s.submit(self.payload(),'stale-retry');s.step();job=s.get(job['id'])
        with self.assertRaises(Conflict):s.control(job['id'],'retry')
        with self.assertRaises(Conflict):s.control(job['id'],'retry',recovery={'expectedCursor':0,'expectedUpdated':job['updated']-1})
        self.assertEqual(s.get(job['id'])['attempts'],1)

    def test_reads_latest_input_after_claim_and_records_actual_attempt(self):
        import copy
        s=self.manual_store();latest={'prompt':'first'}
        s.resolve_frame=lambda row,f:{**copy.deepcopy(f),**latest}
        a=s.submit(self.payload(count=2),'live-read');r=s.claim();latest['prompt']='saved after claim';s.execute_row(r)
        latest['prompt']='next frame';s.step();job=s.get(a['id'])
        self.assertEqual([r['prompt'] for r in job['results']],['saved after claim','next frame'])
        self.assertEqual([a['prompt'] for a in job['requestHistory']],['next frame','saved after claim']);self.assertNotIn('keyMode',job['requestHistory'][0]['config'])

    def test_invalid_live_input_never_falls_back_to_old_paid_request(self):
        s=self.manual_store();s.resolve_frame=lambda row,f:(_ for _ in ()).throw(ValueError('missing image variable'))
        a=s.submit(self.payload(),'invalid-live');s.step();self.assertEqual(s.get(a['id'])['state'],'failed');self.assertFalse(self.calls)

    def test_changed_content_does_not_mutate_inflight_request(self):
        import copy
        s=self.manual_store();latest={'prompt':'before send'};entered=threading.Event();release=threading.Event()
        s.resolve_frame=lambda row,f:{**copy.deepcopy(f),**latest}
        def run(f):entered.set();release.wait(3);return {'image':'/images/'+f['prompt']+'.png'}
        s.execute=run;a=s.submit(self.payload(),'inflight-live');row=s.claim();worker=threading.Thread(target=s.execute_row,args=(row,));worker.start();self.assertTrue(entered.wait(2));latest['prompt']='changed during request';release.set();worker.join(3)
        self.assertEqual(s.get(a['id'])['results'][0]['prompt'],'before send')

    def test_reconcile_uses_original_attempt_not_new_saved_prompt(self):
        s=self.manual_store();p=self.payload();p['frames'][0]['config']['provider']='comfyui';p['frames'][0]['workflow']={'1':{'class_type':'X','inputs':{}}};s.resolve_frame=lambda row,f:{**f,'prompt':'original sent'}
        def run(f):f['_checkpoint']('prompt-1');raise TimeoutError('unknown')
        s.execute=run;a=s.submit(p,'live-reconcile');s.step();s.resolve_frame=lambda row,f:self.fail('reconcile must not read changed draft')
        seen=[];s.execute=lambda f:(seen.append(f['prompt']) or {'image':'/images/reconciled.png'});s.control(a['id'],'reconcile');s.step();self.assertEqual(seen,['original sent'])

    def test_channel_configuration_error_blocks_dispatch_without_provider_calls(self):
        from mio_channels import ChannelConfigurationError
        s=self.manual_store();s.resolve_frame=lambda row,f:(_ for _ in ()).throw(ChannelConfigurationError('missing model'))
        a=s.submit(self.payload(count=5),'bad-channel');s.step();self.assertIsNone(s.claim());self.assertFalse(self.calls);self.assertEqual(s.get(a['id'])['error']['kind'],'channel_configuration')
