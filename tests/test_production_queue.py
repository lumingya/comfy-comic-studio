import tempfile
import threading
import time
import unittest
from backend.production.queue import ProductionQueue
from backend.mio_library import LibraryError

class ProductionQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.calls=[]
        self.q=ProductionQueue(self.tmp.name,lambda task,cancel:{'ready':True},self.render);self.addCleanup(self.q.close)
    def render(self,task,index,cancel):self.calls.append((task['title'],index));return {'image':task['title']+str(index)}
    def make(self,title='A',count=3):return self.q.assemble({'story':{'id':'story','title':'Story','frames':[{'prompt':'x'} for _ in range(count)]},'presets':[]},title,title)
    def wait(self,id,status):
        for _ in range(250):
            if self.q.get(id)['status']==status and self.q.active is None:return self.q.get(id)
            time.sleep(.01)
        self.fail(str(self.q.list()))
    def test_batch_assembly_publishes_only_a_complete_set(self):
        snapshot={'story':{'frames':[{'prompt':'x'}]}}
        tasks=self.q.assemble_many([(snapshot,'A','a'),(snapshot,'B','b')])
        self.assertEqual(len(self.q.list()['tasks']),2);self.assertTrue(all(t['status']=='standby' for t in tasks));self.assertFalse(self.calls)
        with self.assertRaises(LibraryError):self.q.assemble_many([(snapshot,'C','c'),({'story':{'frames':[]}},'Bad','bad')])
        self.assertEqual(len(self.q.list()['tasks']),2);self.assertFalse(self.calls)

    def test_force_prepare_permission_is_one_start_not_sticky(self):
        flags=[]
        def reject(task,cancel):
            flags.append(task.get('forcePrepare'));raise ValueError('Unconfirmed provider result')
        self.q.prepare=reject;a=self.make()
        self.q.start(a['id'],trusted=True,force_prepare=True);self.wait(a['id'],'failed')
        self.q.start(a['id'],trusted=True);self.wait(a['id'],'failed')
        self.assertEqual(flags,[True,False]);self.assertEqual(self.calls,[])

    def test_failed_start_control_commit_never_dispatches_a_model(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as root:
            calls=[];q=ProductionQueue(root,lambda *_:calls.append('prepare') or {},lambda *_:calls.append('render') or {})
            try:
                task=q.assemble({'story':{'frames':[{}]}},'Book','request')
                with patch.object(q.state,'set',side_effect=OSError('disk full')):
                    with self.assertRaises(OSError):q.start(task['id'],trusted=True)
                time.sleep(.3)
                self.assertEqual(calls,[]);self.assertTrue(q.fault);self.assertTrue(q.control['paused'])
            finally:q.close()

    def test_second_writer_cannot_claim_the_same_directory(self):
        import tempfile
        with tempfile.TemporaryDirectory() as root:
            q=ProductionQueue(root,lambda *_:{},lambda *_:{})
            try:
                with self.assertRaises(LibraryError):ProductionQueue(root,lambda *_:{},lambda *_:{})
            finally:q.close()
            q=ProductionQueue(root,lambda *_:{},lambda *_:{})
            q.close()

    def test_assembly_has_no_execution_and_snapshots_do_not_share_identity(self):
        source={'story':{'frames':[{'prompt':'before'}]},'presets':[{'entries':[]}]};t=self.q.assemble(source,'Book','once');source['story']['frames'][0]['prompt']='after'
        self.assertEqual(self.q.get(t['id'])['snapshot']['story']['frames'][0]['prompt'],'before');self.assertEqual(t['status'],'standby');self.assertEqual(self.calls,[])
    def test_duplicate_submit_is_idempotent_but_conflicting_retry_is_not(self):
        a=self.make();b=self.make();self.assertEqual(a['id'],b['id'])
        with self.assertRaises(LibraryError):self.q.assemble(a['snapshot'],'Changed','A')
    def test_single_start_never_releases_other_tasks(self):
        a,b=self.make('A'),self.make('B');self.q.start(b['id'],trusted=True);self.wait(b['id'],'complete');self.assertEqual(self.calls,[('B',0),('B',1),('B',2)]);self.assertEqual(self.q.get(a['id'])['status'],'standby')
    def test_sequential_start_skips_before_and_uses_fixed_order(self):
        a,b,c=[self.make(x) for x in 'ABC'];self.q.start(b['id'],sequential=True,trusted=True);self.wait(c['id'],'complete');self.assertEqual(self.calls,[(x,i) for x in 'BC' for i in range(3)]);self.assertEqual(self.q.get(a['id'])['status'],'standby')
    def test_replay_one_page_preserves_other_pages(self):
        a=self.make();self.q.start(a['id'],trusted=True);before=self.wait(a['id'],'complete');self.q.start(a['id'],indices=[1],trusted=True);after=self.wait(a['id'],'complete')
        self.assertEqual(self.calls,[('A',0),('A',1),('A',2),('A',1)]);self.assertEqual(before['pages'][0],after['pages'][0]);self.assertEqual(before['pages'][2],after['pages'][2]);self.assertEqual(len(after['pages'][1]['attempts']),2)
    def test_suffix_replay_uses_original_indices(self):
        a=self.make();self.q.start(a['id'],trusted=True);self.wait(a['id'],'complete');self.q.start(a['id'],indices=[1,2],trusted=True);self.wait(a['id'],'complete');self.assertEqual(self.calls[-2:],[('A',1),('A',2)])
    def test_failed_replay_keeps_previous_image_and_marks_book_partial(self):
        a=self.make();self.q.start(a['id'],trusted=True);before=self.wait(a['id'],'complete')
        def fail(*args):raise ValueError('provider rejected')
        self.q.render=fail;self.q.start(a['id'],indices=[1],trusted=True);after=self.wait(a['id'],'partial');self.assertEqual(after['pages'][1]['result'],before['pages'][1]['result']);self.assertEqual(len(self.calls),3)
        self.assertEqual(after['pages'][1]['state'],'failed');self.assertIn('1/1 幕失败',after['error']);self.assertIn('provider rejected',after['error'])
    def test_one_rejected_page_does_not_stop_the_rest_of_the_book(self):
        def render(task,index,cancel):
            if index==1:raise ValueError('HTTP 400: {"error":{"message":"rejected by the safety system","code":"content_policy_violation"}}')
            return self.render(task,index,cancel)
        self.q.render=render;a,b=self.make('A'),self.make('B');self.q.start(a['id'],sequential=True,trusted=True);self.wait(b['id'],'partial');after=self.q.get(a['id'])
        self.assertEqual(after['status'],'partial');self.assertEqual([p['state'] for p in after['pages']],['complete','failed','complete'])
        self.assertIn('1/3 幕失败',after['error']);self.assertIn('内容安全审核',after['error']);self.assertEqual(self.calls,[('A',0),('A',2),('B',0),('B',2)])
        self.assertFalse(self.q.list()['paused'] and self.q.list()['batch'])
        self.q.start(a['id'],trusted=True)
        for _ in range(250):
            if len(self.q.get(a['id'])['pages'][1]['attempts'])==2 and self.q.active is None:break
            time.sleep(.01)
        self.assertEqual(self.q.get(a['id'])['pages'][1]['attempts'][-1]['status'],'failed');self.assertEqual(len(self.calls),4);self.assertEqual(self.q.get(a['id'])['status'],'partial')
    def test_credential_failure_stops_the_book_and_the_batch(self):
        class Denied(Exception):status=401
        def render(task,index,cancel):raise Denied('HTTP 401: invalid_api_key')
        self.q.render=render;a,b=self.make('A'),self.make('B');self.q.start(a['id'],sequential=True,trusted=True);after=self.wait(a['id'],'failed')
        self.assertEqual([p['state'] for p in after['pages']],['failed','standby','standby']);self.assertIn('拒绝了密钥',after['error']);self.assertIn('已停止剩余 2 幕',after['error'])
        self.assertEqual(self.q.get(b['id'])['status'],'standby');self.assertTrue(self.q.list()['paused']);self.assertEqual(self.q.list()['batch'],[])
    def test_consecutive_failures_trip_the_streak_guard(self):
        def render(task,index,cancel):raise ValueError('boom '+str(index))
        self.q.render=render;a=self.make('A',count=5);self.q.start(a['id'],trusted=True);after=self.wait(a['id'],'failed')
        self.assertEqual([p['state'] for p in after['pages']],['failed']*3+['standby']*2);self.assertIn('3/5 幕失败：boom 0',after['error']);self.assertTrue(self.q.list()['paused'])
    def test_finalize_hook_receives_every_terminal_task(self):
        seen=[];self.q.finalize=lambda task:seen.append((task['title'],task['status']))
        def render(task,index,cancel):
            if task['title']=='B':raise ValueError('nope')
            return self.render(task,index,cancel)
        self.q.render=render;a,b=self.make('A'),self.make('B');self.q.start(a['id'],sequential=True,trusted=True);self.wait(b['id'],'failed')
        self.assertEqual(seen,[('A','complete'),('B','failed')])
    def test_pause_drains_only_current_request(self):
        began=threading.Event();release=threading.Event()
        def held(task,index,cancel):
            if index==0:began.set();release.wait(2)
            return self.render(task,index,cancel)
        self.q.render=held;a=self.make();self.q.start(a['id'],trusted=True);self.assertTrue(began.wait(2));self.q.pause();release.set();time.sleep(.15);self.assertEqual(self.calls,[('A',0)]);self.q.resume();self.wait(a['id'],'complete')
    def test_paused_batch_with_nothing_in_flight_is_released_by_a_new_start(self):
        began=threading.Event();release=threading.Event()
        def held(task,index,cancel):
            if task['title']=='A':began.set();release.wait(2)
            return self.render(task,index,cancel)
        self.q.render=held;a,b,c=self.make('A',1),self.make('B',1),self.make('C',1)
        self.q.start(a['id'],sequential=True,trusted=True);self.assertTrue(began.wait(2));self.q.pause()
        with self.assertRaises(LibraryError):self.q.start(c['id'],trusted=True)  # A is paused mid-book: nothing may replace it
        release.set();self.wait(a['id'],'complete');time.sleep(.3)
        state=self.q.list();self.assertTrue(state['paused']);self.assertEqual(state['batch'],[b['id'],c['id']]);self.assertEqual(self.q.get(b['id'])['status'],'ready')
        self.q.start(c['id'],trusted=True);self.wait(c['id'],'complete')
        self.assertEqual(self.q.get(b['id'])['status'],'standby');self.assertEqual(self.q.get(b['id'])['selection'],[]);self.assertEqual(self.calls,[('A',0),('C',0)]);self.assertEqual(self.q.list()['batch'],[])
    def test_cancel_discards_late_result_and_does_not_start_next_book(self):
        began=threading.Event();release=threading.Event()
        def held(task,index,cancel):began.set();release.wait(2);return self.render(task,index,cancel)
        self.q.render=held;a,b=self.make('A'),self.make('B');self.q.start(a['id'],sequential=True,trusted=True);self.assertTrue(began.wait(2));self.q.cancel();release.set();after=self.wait(a['id'],'cancelled');self.assertIsNone(after['pages'][0]['result']);self.assertEqual(self.q.get(b['id'])['status'],'standby');self.assertEqual(self.calls,[('A',0)])
    def test_start_requires_explicit_trust_and_valid_indices(self):
        a=self.make()
        for kw in ({},{'indices':[9],'trusted':True},{'indices':[0,0],'trusted':True}):
            with self.assertRaises(LibraryError):self.q.start(a['id'],**kw)
    def test_restart_leaves_interrupted_work_stopped(self):
        a=self.make();a['status']='running';a['pages'][0]['state']='running';self.q.tasks.set(a['id'],a);self.q.close();self.q=ProductionQueue(self.tmp.name,lambda *_:None,self.render);self.addCleanup(self.q.close)
        self.assertEqual(self.q.get(a['id'])['status'],'interrupted');self.assertEqual(self.q.get(a['id'])['pages'][0]['state'],'uncertain');self.assertTrue(self.q.list()['paused']);self.assertEqual(self.calls,[])
