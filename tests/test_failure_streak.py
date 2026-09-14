"""Per-task consecutive-failure guard: durable, cross-frame and concurrency-safe."""
import json
import tempfile
import threading
import unittest
from mio_jobs import Jobs, Conflict, validate_policy

class Unavailable(Exception):
    status=503

class FailureStreakTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.calls=[]
        self.s=Jobs(self.temp.name,self.fail_request);self.s.close()
        self.addCleanup(self.s.close)
    def fail_request(self,f):
        self.calls.append(f['prompt']);raise Unavailable('controlled 503')
    def policy(self,limit=3,**extra):
        self.s.control('scheduler','policy',{'mode':'retry','maxRetries':1,'delaySeconds':5,'onExhausted':'continue','maxConsecutiveFailures':limit,**extra})
    def submit(self,n=8,token='a'):
        return self.s.submit({'albumId':token,'frames':[{'config':{'provider':'openai','keyMode':'none'},'prompt':token+str(i),'images':[]} for i in range(n)]},token)['id']
    def expire(self):
        with self.s.connect() as db:db.execute('UPDATE job_frames SET ready_at=0')
    def again(self):
        self.expire();return self.s.step()
    def continue_job(self,id,**extra):
        j=self.s.get(id);return self.s.control(id,'continue',recovery={'expectedCursor':j['cursor'],'expectedUpdated':j['updated'],**extra})
    def test_cross_frame_failure_and_retry_count_trip_before_remaining_frames(self):
        self.policy();a=self.submit();b=self.submit(1,'b')
        for _ in range(3):self.again()
        j=self.s.get(a);self.assertEqual(self.calls,['a0','a0','a1']);self.assertEqual(j['attempts'],3)
        self.assertEqual((j['failure_limit_reached'],j['consecutive_failures'],j['blocked'],j['enabled']),(3,3,1,0))
        self.assertEqual([f['state'] for f in j['frameStates']],['failed','failed']+['pending']*6)
        self.assertEqual(j['ready_at'],0);self.assertFalse(self.s.list()['paused'])
        self.s.execute=lambda _: {'image':'/images/b.png'};self.s.step();self.assertEqual(self.s.get(b)['state'],'complete');self.assertEqual(self.s.get(a)['attempts'],3)
    def test_success_resets_streak_across_frames(self):
        self.policy(mode='continue');a=self.submit(5)
        for _ in range(2):self.s.step()
        self.s.execute=lambda _: {'image':'/images/ok.png'};self.s.step()
        self.assertEqual(self.s.get(a)['consecutive_failures'],0)
        self.s.execute=self.fail_request
        for _ in range(2):self.s.step()
        j=self.s.get(a);self.assertEqual(j['consecutive_failures'],2);self.assertEqual(j['failure_limit_reached'],0);self.assertEqual(j['completedIndices'],[2])
    def test_each_retry_is_a_failure_not_just_exhausted_frames(self):
        self.policy(2,maxRetries=100);a=self.submit()
        self.again();self.again();self.assertFalse(self.again());self.assertEqual(self.calls,['a0','a0']);self.assertEqual(self.s.get(a)['failure_limit_reached'],2)
    def test_guard_applies_without_retry_and_counts_4xx_and_422(self):
        for status in (401,403,422,429):
            with self.subTest(status=status):
                self.policy(2,mode='continue');a=self.submit(5,str(status))
                class HTTPError(Exception):pass
                error=HTTPError('controlled');error.status=status
                self.s.execute=lambda _: (_ for _ in ()).throw(error)
                self.s.step();self.s.step();j=self.s.get(a)
                self.assertEqual(j['failure_limit_reached'],2);self.assertEqual(j['attempts'],2);self.assertEqual(j['retry_count'],0)
                self.assertFalse(self.s.step())
    def test_unknown_results_are_never_auto_retried_and_keep_consent(self):
        self.policy(2);a=self.submit(4);self.s.execute=lambda _: (_ for _ in ()).throw(TimeoutError('response lost'))
        self.s.step();self.s.step();j=self.s.get(a)
        self.assertEqual(j['attempts'],2);self.assertEqual(j['failure_limit_reached'],2);self.assertEqual(j['state'],'unknown');self.assertTrue(j['requiresRecoveryConsent'])
        with self.assertRaises(Conflict):self.continue_job(a)
        self.assertEqual(self.s.get(a)['failure_limit_reached'],2)
        self.continue_job(a,acknowledgeUnconfirmed=True);self.assertEqual(self.s.get(a)['failure_limit_reached'],0)
    def test_zero_disables_guard_without_disabling_per_frame_budget(self):
        self.policy(0);a=self.submit(6)
        for _ in range(12):self.again()
        j=self.s.get(a);self.assertEqual(j['attempts'],12);self.assertEqual(j['consecutive_failures'],12);self.assertEqual(j['failure_limit_reached'],0);self.assertFalse(self.s.step())
    def test_late_success_does_not_release_latched_stop(self):
        self.policy(2);self.s.control('scheduler','runtime',runtime={'concurrency':3});a=self.submit(8)
        rows=[self.s.claim() for _ in range(3)]
        started=threading.Event();release=threading.Event()
        def execute(f):
            if f['prompt']=='a2':
                f['_onRequest']({'prompt':f['prompt']});started.set();release.wait(5);return {'image':'/images/late.png'}
            return self.fail_request(f)
        self.s.execute=execute;thread=threading.Thread(target=self.s.execute_row,args=(rows[2],));thread.start();self.assertTrue(started.wait(2))
        self.s.execute_row(rows[0]);self.s.execute_row(rows[1]);release.set();thread.join(5);self.assertFalse(thread.is_alive())
        j=self.s.get(a);self.assertEqual(j['consecutive_failures'],0);self.assertEqual(j['failure_limit_reached'],2);self.assertEqual(j['completedIndices'],[2]);self.assertEqual(j['ready_at'],0);self.assertFalse(self.s.step())
        self.continue_job(a);self.assertEqual(self.s.get(a)['failure_limit_reached'],0);self.s.execute=lambda _: {'image':'/images/ok.png'}
        while self.s.step():pass
        self.assertEqual(self.s.get(a)['state'],'complete');self.assertEqual(self.s.get(a)['attempts'],10)
    def test_concurrent_failures_are_serialized_and_never_arm_late_retries(self):
        self.policy(3,maxRetries=100);self.s.control('scheduler','runtime',runtime={'concurrency':8});a=self.submit(12)
        barrier=threading.Barrier(8)
        def concurrent(f):
            f['_onRequest']({'prompt':f['prompt']});barrier.wait(5);return self.fail_request(f)
        self.s.execute=concurrent
        rows=[self.s.claim() for _ in range(8)];threads=[threading.Thread(target=self.s.execute_row,args=(r,)) for r in rows]
        for t in threads:t.start()
        for t in threads:t.join(5);self.assertFalse(t.is_alive())
        j=self.s.get(a);self.assertEqual(j['consecutive_failures'],8);self.assertEqual(j['failure_limit_reached'],3);self.assertEqual(j['attempts'],8);self.assertEqual(j['ready_at'],0);self.assertFalse(self.s.step())
    def test_streak_is_per_task_not_global(self):
        self.policy(3,mode='continue');a=self.submit(5);b=self.submit(3,'b');self.s.control('scheduler','runtime',runtime={'concurrency':2})
        j=self.s.get(b);self.s.control(b,'start',recovery={'expectedCursor':j['cursor'],'expectedUpdated':j['updated']})
        ra=[self.s.claim(),self.s.claim()];rb=[self.s.claim(),self.s.claim()]
        for r in ra+rb:self.s.execute_row(r)
        self.assertEqual(self.s.get(a)['consecutive_failures'],2);self.assertEqual(self.s.get(b)['consecutive_failures'],2)
        self.assertFalse(self.s.get(a)['failure_limit_reached']);self.assertFalse(self.s.get(b)['failure_limit_reached'])
    def test_lowering_limit_disarms_waits_and_policy_or_global_resume_cannot_release(self):
        self.policy(10,maxRetries=100);a=self.submit();self.again();self.again()
        self.policy(2,maxRetries=100);self.assertEqual(self.s.get(a)['failure_limit_reached'],2);self.assertEqual(self.s.get(a)['ready_at'],0)
        for limit in (100,0):
            self.policy(limit);self.s.control('scheduler','resume');self.assertFalse(self.s.step());self.assertEqual(self.s.get(a)['failure_limit_reached'],2)
        self.continue_job(a);self.assertEqual(self.s.get(a)['consecutive_failures'],0);self.assertTrue(self.s.step())
    def test_latch_and_counter_survive_restart(self):
        self.policy(2);a=self.submit();self.again();self.again()
        self.s=Jobs(self.temp.name,self.fail_request,manual_start=True);self.s.close();self.addCleanup(self.s.close)
        j=self.s.get(a);self.assertEqual(j['failure_limit_reached'],2);self.assertEqual(j['consecutive_failures'],2);self.assertEqual(self.s.policy()['maxConsecutiveFailures'],2)
        self.s.control('scheduler','resume');self.assertFalse(self.s.step());self.assertEqual(len(self.calls),2)
    def test_nontripped_streak_survives_restart(self):
        self.policy(3,mode='continue');a=self.submit();self.s.step()
        self.s=Jobs(self.temp.name,self.fail_request,manual_start=True);self.s.close();self.addCleanup(self.s.close)
        self.assertEqual(self.s.get(a)['consecutive_failures'],1);self.s.control('scheduler','resume');self.s.step();self.s.step();self.assertEqual(self.s.get(a)['failure_limit_reached'],3)
    def test_old_database_columns_and_saved_policy_migrate_without_replaying(self):
        a=self.submit();before=self.s.get(a)
        with self.s.connect() as db:
            for column in ('consecutive_failures','failure_limit_reached'):db.execute('ALTER TABLE jobs DROP COLUMN '+column)
            db.execute("UPDATE settings SET value=? WHERE key='failurePolicy'",(json.dumps({'mode':'retry','maxRetries':7,'delaySeconds':30,'onExhausted':'pause'}),))
        self.s=Jobs(self.temp.name,self.fail_request,manual_start=True);self.s.close();self.addCleanup(self.s.close)
        j=self.s.get(a);self.assertEqual(j['attempts'],before['attempts']);self.assertEqual(j['consecutive_failures'],0);self.assertEqual(self.s.policy()['maxRetries'],7);self.assertEqual(self.s.policy()['maxConsecutiveFailures'],5);self.assertFalse(self.calls)
    def test_deletion_remains_one_operation_without_recovery_consent(self):
        self.policy(1);a=self.submit();self.s.step();self.s.control(a,'remove');self.assertEqual(self.s.get(a)['state'],'archived');self.assertFalse(self.s.step())
    def test_validation_is_strict_and_previous_policy_is_unchanged_on_error(self):
        self.policy(4);before=self.s.policy()
        for value in (-1,101,1.5,True,None,'3'):
            with self.assertRaises(ValueError):self.s.control('scheduler','policy',{'maxConsecutiveFailures':value})
            self.assertEqual(self.s.policy(),before)
        self.assertEqual(validate_policy({})['maxConsecutiveFailures'],5)
    def test_latched_state_is_in_summaries_and_activity_not_in_place_of_original_error(self):
        self.policy(1);a=self.submit();self.s.step();j=self.s.get(a,False)
        self.assertEqual(j['failure_limit_reached'],1);self.assertEqual(j['consecutive_failures'],1)
        self.assertIn('controlled 503',self.s.get(a)['error']['message'])
        with self.s.connect() as db:events=[json.loads(r[0]) for r in db.execute('SELECT data FROM events WHERE job=?',(a,))]
        event=next(e for e in events if e['state']=='failure_limit_reached');self.assertEqual(event['failure_limit_reached'],1)

    def test_claimed_but_unsubmitted_frame_is_held_without_inventing_a_request(self):
        self.policy(1);self.s.control('scheduler','runtime',runtime={'concurrency':2});a=self.submit(4)
        first=self.s.claim();unsubmitted=self.s.claim();self.s.execute_row(first);self.s.execute_row(unsubmitted)
        j=self.s.get(a);self.assertEqual(self.calls,['a0']);self.assertEqual(j['attempts'],1);self.assertEqual(j['consecutive_failures'],1);self.assertEqual(j['frameStates'][1]['attempts'],0);self.assertEqual(j['frameStates'][1]['state'],'pending');self.assertEqual(len(j['requestHistory']),1)
        self.continue_job(a);self.s.execute=lambda _: {'image':'/images/ok.png'}
        while self.s.step():pass
        self.assertEqual(self.s.get(a)['state'],'complete')
    def test_limit_rechecks_after_slow_provider_preparation_before_the_paid_submit_boundary(self):
        self.policy(1);self.s.control('scheduler','runtime',runtime={'concurrency':2});a=self.submit(4)
        first=self.s.claim();slow=self.s.claim();started=threading.Event();release=threading.Event();sent=[]
        def execute(f):
            if f['prompt']=='a1':started.set();release.wait(5)
            f['_onRequest']({'prompt':f['prompt']});sent.append(f['prompt']);raise Unavailable('controlled')
        self.s.execute=execute;thread=threading.Thread(target=self.s.execute_row,args=(slow,));thread.start();self.assertTrue(started.wait(2));self.s.execute_row(first);release.set();thread.join(5);self.assertFalse(thread.is_alive())
        j=self.s.get(a);self.assertEqual(sent,['a0']);self.assertEqual(j['attempts'],1);self.assertEqual(j['consecutive_failures'],1);self.assertEqual(j['failure_limit_reached'],1)
