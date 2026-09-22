import tempfile
import threading
import time
import unittest
from backend.production.queue import ProductionQueue, MAX_PAGE_CONCURRENCY
from backend.mio_library import LibraryError

class ProductionQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.calls=[]
        self.q=ProductionQueue(self.tmp.name,lambda task,cancel:{'ready':True},self.render);self.addCleanup(self.q.close)
    def render(self,task,index,cancel):self.calls.append((task['title'],index));return {'image':task['title']+str(index)}
    def make(self,title='A',count=3,**kw):return self.q.assemble({'story':{'id':'story','title':'Story','frames':[{'prompt':'x'} for _ in range(count)]},'presets':[]},title,title,**kw)
    def wait(self,id,status,idle=True):
        for _ in range(400):
            if self.q.get(id)['status']==status and (not idle or not self.q.active):return self.q.get(id)
            time.sleep(.01)
        self.fail(str(self.q.list()))
    def settle(self):
        for _ in range(400):
            if not self.q.active:return
            time.sleep(.01)
        self.fail('runners still active: '+str(self.q.active))
    def held_render(self,predicate,timeout=2):
        began=threading.Event();release=threading.Event()
        def held(task,index,cancel):
            if predicate(task,index):began.set();release.wait(timeout)
            return self.render(task,index,cancel)
        self.q.render=held;return began,release

    # ------------------------------------------------------------ assembly
    def test_batch_assembly_publishes_only_a_complete_set(self):
        snapshot={'story':{'frames':[{'prompt':'x'}]}}
        tasks=self.q.assemble_many([(snapshot,'A','a'),(snapshot,'B','b',2)])
        self.assertEqual(len(self.q.list()['tasks']),2);self.assertTrue(all(t['status']=='standby' for t in tasks));self.assertFalse(self.calls)
        self.assertEqual([t['concurrency'] for t in tasks],[None,2])
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

    def test_clone_copies_the_frozen_book_into_a_new_standby_task(self):
        a=self.make('A',concurrency=3);b=self.make('B');self.q.start(a['id'],trusted=True);self.wait(a['id'],'complete')
        copy1=self.q.clone(a['id']);copy2=self.q.clone(a['id']);named=self.q.clone(a['id'],'定稿版')
        self.assertNotEqual(copy1['id'],a['id']);self.assertNotEqual(copy1['albumId'],a['albumId'])
        self.assertEqual(copy1['title'],'A 副本');self.assertEqual(copy2['title'],'A 副本 2');self.assertEqual(named['title'],'定稿版')
        self.assertEqual(copy1['snapshot'],self.q.get(a['id'])['snapshot']);self.assertEqual(copy1['status'],'standby');self.assertEqual(copy1['concurrency'],3)
        self.assertEqual([p['state'] for p in copy1['pages']],['standby']*3)
        # Copies sit right behind their source, before unrelated books.
        self.assertEqual([t['title'] for t in self.q.list()['tasks']],['A','定稿版','A 副本 2','A 副本','B'])
        self.assertEqual(self.calls,[('A',0),('A',1),('A',2)])

    # ---------------------------------------------------------- scheduling
    def test_single_start_never_releases_other_tasks(self):
        a,b=self.make('A'),self.make('B');self.q.start(b['id'],trusted=True);self.wait(b['id'],'complete');self.assertEqual(self.calls,[('B',0),('B',1),('B',2)]);self.assertEqual(self.q.get(a['id'])['status'],'standby')
    def test_start_rejects_a_finished_book_without_a_page_selection(self):
        a=self.make();self.q.start(a['id'],trusted=True);self.wait(a['id'],'complete')
        with self.assertRaises(LibraryError):self.q.start(a['id'],trusted=True)
        self.q.start(a['id'],indices=[2],trusted=True);self.wait(a['id'],'complete');self.assertEqual(self.calls[-1],('A',2))
    def test_sequential_start_skips_before_and_uses_fixed_order(self):
        a,b,c=[self.make(x) for x in 'ABC'];self.q.start(b['id'],sequential=True,trusted=True);self.wait(c['id'],'complete');self.assertEqual(self.calls,[(x,i) for x in 'BC' for i in range(3)]);self.assertEqual(self.q.get(a['id'])['status'],'standby')
    def test_start_sequence_runs_books_one_at_a_time_in_visible_order(self):
        began,release=self.held_render(lambda task,index:task['title']=='A' and index==0)
        a,b,c=[self.make(x,1) for x in 'ABC'];self.q.start(c['id'],trusted=True);self.wait(c['id'],'complete')
        state=self.q.start_sequence(trusted=True);self.assertTrue(began.wait(2))
        state=self.q.list();self.assertEqual(state['active'],[a['id']]);self.assertEqual(state['lane'],[b['id']]);self.assertEqual(state['batch'],[a['id'],b['id']])
        self.assertTrue(next(t for t in state['tasks'] if t['id']==b['id'])['queued']);self.assertEqual(next(t for t in state['tasks'] if t['id']==b['id'])['queuePosition'],1)
        release.set();self.wait(b['id'],'complete');self.assertEqual(self.calls,[('C',0),('A',0),('B',0)]);self.assertEqual(self.q.list()['lane'],[])
        with self.assertRaises(LibraryError):self.q.start_sequence(trusted=True)  # everything is finished
    def test_two_books_run_at_the_same_time(self):
        gate=threading.Barrier(2,timeout=2)
        def render(task,index,cancel):
            if index==0:gate.wait()
            return self.render(task,index,cancel)
        self.q.render=render;a,b=self.make('A'),self.make('B');self.q.start(a['id'],trusted=True);self.q.start(b['id'],trusted=True)
        self.wait(a['id'],'complete');self.wait(b['id'],'complete');self.assertEqual(gate.broken,False);self.assertEqual(len(self.calls),6)
        with self.assertRaises(LibraryError):self.q.start_many(['nope'],trusted=True)
    def test_start_many_runs_every_selected_book_in_its_own_runner(self):
        gate=threading.Barrier(3,timeout=2)
        def render(task,index,cancel):
            gate.wait();return self.render(task,index,cancel)
        self.q.render=render;a,b,c,d=[self.make(x,1) for x in 'ABCD'];self.q.start_many([a['id'],b['id'],c['id']],trusted=True)
        for t in (a,b,c):self.wait(t['id'],'complete',idle=False)
        self.settle();self.assertEqual(self.q.get(d['id'])['status'],'standby');self.assertEqual(sorted(self.calls),[('A',0),('B',0),('C',0)])
    def test_page_concurrency_limits_in_flight_pages(self):
        lock=threading.Lock();live={'now':0,'peak':0}
        def render(task,index,cancel):
            with lock:live['now']+=1;live['peak']=max(live['peak'],live['now'])
            time.sleep(.05)
            with lock:live['now']-=1
            return self.render(task,index,cancel)
        self.q.render=render;a=self.make('A',count=6,concurrency=2);self.q.start(a['id'],trusted=True);self.wait(a['id'],'complete')
        self.assertEqual(live['peak'],2);self.assertEqual(sorted(i for _,i in self.calls),list(range(6)))
        live['peak']=0;self.calls=[];self.q.set_concurrency(4);b=self.make('B',count=8);self.assertEqual(self.q.list()['concurrency'],4)
        self.assertEqual(next(t for t in self.q.list()['tasks'] if t['id']==b['id'])['effectiveConcurrency'],4)
        self.q.start(b['id'],trusted=True);self.wait(b['id'],'complete');self.assertEqual(live['peak'],4)
        self.q.set_concurrency(1,b['id']);self.assertEqual(next(t for t in self.q.list()['tasks'] if t['id']==b['id'])['effectiveConcurrency'],1)
        self.q.set_concurrency(None,b['id']);self.assertEqual(next(t for t in self.q.list()['tasks'] if t['id']==b['id'])['effectiveConcurrency'],4)
        for bad in (0,-1,1.5,'2',True,MAX_PAGE_CONCURRENCY+1):
            with self.assertRaises(LibraryError):self.q.set_concurrency(bad)
        with self.assertRaises(LibraryError):self.q.set_concurrency(None)
    def test_concurrency_change_applies_to_the_next_dispatch_of_a_running_book(self):
        lock=threading.Lock();live={'now':0,'peak':0};first=threading.Event();release=threading.Event()
        def render(task,index,cancel):
            with lock:live['now']+=1;live['peak']=max(live['peak'],live['now'])
            if index==0:first.set();release.wait(2)
            else:time.sleep(.03)
            with lock:live['now']-=1
            return self.render(task,index,cancel)
        self.q.render=render;a=self.make('A',count=6);self.q.start(a['id'],trusted=True);self.assertTrue(first.wait(2))
        self.q.set_concurrency(3,a['id']);time.sleep(.2);self.assertGreaterEqual(live['peak'],3);release.set();self.wait(a['id'],'complete')

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
        self.assertEqual(self.q.list()['lane'],[])
        self.q.start(a['id'],trusted=True)
        for _ in range(250):
            if len(self.q.get(a['id'])['pages'][1]['attempts'])==2 and not self.q.active:break
            time.sleep(.01)
        self.assertEqual(self.q.get(a['id'])['pages'][1]['attempts'][-1]['status'],'failed');self.assertEqual(len(self.calls),4);self.assertEqual(self.q.get(a['id'])['status'],'partial')
    def test_credential_failure_stops_the_book_and_empties_the_lane(self):
        class Denied(Exception):status=401
        def render(task,index,cancel):raise Denied('HTTP 401: invalid_api_key')
        self.q.render=render;a,b=self.make('A'),self.make('B');self.q.start(a['id'],sequential=True,trusted=True);after=self.wait(a['id'],'failed')
        self.assertEqual([p['state'] for p in after['pages']],['failed','standby','standby']);self.assertIn('拒绝了密钥',after['error']);self.assertIn('已停止剩余 2 幕',after['error'])
        self.assertEqual(self.q.get(b['id'])['status'],'standby');self.assertEqual(self.q.get(b['id'])['selection'],[]);self.assertEqual(self.q.list()['lane'],[])
    def test_consecutive_failures_trip_the_streak_guard(self):
        def render(task,index,cancel):raise ValueError('boom '+str(index))
        self.q.render=render;a=self.make('A',count=5);self.q.start(a['id'],trusted=True);after=self.wait(a['id'],'failed')
        self.assertEqual([p['state'] for p in after['pages']],['failed']*3+['standby']*2);self.assertIn('3/5 幕失败：boom 0',after['error'])
    def test_finalize_hook_receives_every_terminal_task(self):
        seen=[];self.q.finalize=lambda task:seen.append((task['title'],task['status']))
        def render(task,index,cancel):
            if task['title']=='B':raise ValueError('nope')
            return self.render(task,index,cancel)
        self.q.render=render;a,b=self.make('A'),self.make('B');self.q.start(a['id'],sequential=True,trusted=True);self.wait(b['id'],'failed')
        self.assertEqual(seen,[('A','complete'),('B','failed')])

    # ------------------------------------------------------- pause / cancel
    def test_pause_drains_only_current_request(self):
        began,release=self.held_render(lambda task,index:index==0)
        a=self.make();self.q.start(a['id'],trusted=True);self.assertTrue(began.wait(2));self.q.pause();release.set();time.sleep(.2);self.assertEqual(self.calls,[('A',0)])
        self.assertTrue(self.q.list()['paused']);self.assertEqual(self.q.get(a['id'])['status'],'running');self.q.resume();self.wait(a['id'],'complete')
    def test_per_task_pause_holds_only_that_book(self):
        began,release=self.held_render(lambda task,index:task['title']=='A' and index==0)
        a,b=self.make('A'),self.make('B');self.q.start(a['id'],trusted=True);self.assertTrue(began.wait(2))
        self.q.pause(a['id']);self.q.start(b['id'],trusted=True);release.set();self.wait(b['id'],'complete',idle=False);time.sleep(.2)
        self.assertEqual([c for c in self.calls if c[0]=='A'],[('A',0)]);self.assertEqual([c for c in self.calls if c[0]=='B'],[('B',0),('B',1),('B',2)])
        state=self.q.list();held=next(t for t in state['tasks'] if t['id']==a['id']);self.assertTrue(held['paused']);self.assertTrue(held['running']);self.assertFalse(next(t for t in state['tasks'] if t['id']==b['id'])['paused'])
        self.q.resume(a['id']);after=self.wait(a['id'],'complete');self.assertFalse(after['paused']);self.assertEqual(len(self.calls),6)
    def test_global_pause_does_not_block_an_explicit_start(self):
        began,release=self.held_render(lambda task,index:task['title']=='A')
        a,b,c=self.make('A',1),self.make('B',1),self.make('C',1)
        self.q.start_sequence(trusted=True);self.assertTrue(began.wait(2));self.q.pause()
        self.q.start(c['id'],trusted=True);self.wait(c['id'],'complete',idle=False)  # runs beside the held lane
        release.set();self.wait(a['id'],'complete',idle=False);time.sleep(.3)
        state=self.q.list();self.assertTrue(state['paused']);self.assertEqual(state['lane'],[b['id']]);self.assertEqual(self.q.get(b['id'])['status'],'ready')
        self.assertTrue(next(t for t in state['tasks'] if t['id']==b['id'])['paused'])
        self.q.resume();self.wait(b['id'],'complete');self.assertEqual(sorted(self.calls[:2]),[('A',0),('C',0)]);self.assertEqual(self.calls[2:],[('B',0)]);self.assertEqual(self.q.list()['lane'],[])
    def test_rejected_start_preserves_paused_lane_and_persisted_tasks(self):
        from copy import deepcopy
        from pathlib import Path
        a, b = self.make('A'), self.make('B')
        with self.q.lock:
            a['status'] = 'ready'
            a['selection'] = [0, 1, 2]
            b['pages'][0]['state'] = 'uncertain'
            self.q._save(a)
            self.q._save(b)
            self.q.control.update(lane=[a['id']], paused=True)
            self.q._save_control()
            before_control = deepcopy(self.q.control)
            before_tasks = [self.q.get(t['id']) for t in (a, b)]
            def files():
                return {str(p.relative_to(self.tmp.name)): p.read_bytes()
                        for p in Path(self.tmp.name).rglob('*.json')}
            before_files = files()
            for options in ({'indices': []}, {'indices': [99]}, {'indices': [0, 0]},
                            {'indices': [True]}, {'indices': [0], 'sequential': True},
                            {'indices': [0]}, {'sequential': True}, {'concurrency': 0}):
                with self.subTest(options=options):
                    with self.assertRaises(LibraryError):
                        self.q.start(b['id'], trusted=True, **options)
                    self.assertEqual(self.q.control, before_control)
                    self.assertEqual([self.q.get(t['id']) for t in (a, b)], before_tasks)
                    self.assertEqual(files(), before_files)
            with self.assertRaises(LibraryError):self.q.start_sequence([b['id']],trusted=True)
            self.assertEqual(files(), before_files)
            self.assertEqual(self.calls, [])
        self.q.resume()
        self.wait(a['id'], 'complete')
        self.assertEqual(self.calls, [('A', 0), ('A', 1), ('A', 2)])

    def test_cancel_discards_late_result_and_does_not_start_next_book(self):
        began,release=self.held_render(lambda task,index:True)
        a,b=self.make('A'),self.make('B');self.q.start(a['id'],sequential=True,trusted=True);self.assertTrue(began.wait(2));self.q.cancel();release.set();after=self.wait(a['id'],'cancelled');self.assertIsNone(after['pages'][0]['result']);self.assertEqual(self.q.get(b['id'])['status'],'standby');self.assertEqual(self.calls,[('A',0)])
    def test_per_task_cancel_leaves_other_runners_and_the_lane_alone(self):
        began,release=self.held_render(lambda task,index:task['title']=='A' and index==0)
        a,b,c=self.make('A'),self.make('B'),self.make('C',1);self.q.start(a['id'],trusted=True);self.q.start(b['id'],trusted=True);self.q.start_sequence([c['id']],trusted=True)
        self.assertTrue(began.wait(2));self.q.cancel(a['id']);release.set()
        self.wait(a['id'],'cancelled',idle=False);self.wait(b['id'],'complete',idle=False);self.wait(c['id'],'complete')
        self.assertEqual([c for c in self.calls if c[0]=='B'],[('B',0),('B',1),('B',2)]);self.assertEqual(self.q.get(a['id'])['pages'][1]['state'],'standby')
        with self.assertRaises(LibraryError):self.q.start_sequence([a['id'],b['id']],trusted=True)  # page 0 of A is unconfirmed
        self.q.start_sequence([a['id'],b['id']],trusted=True,confirm_uncertain=True);self.wait(a['id'],'complete')
        # De-queueing a waiting lane book returns it to standby without touching the running one.
        d,e=self.make('D',1),self.make('E',1);began2,release2=self.held_render(lambda task,index:True);self.q.start_sequence([d['id'],e['id']],trusted=True)
        self.assertTrue(began2.wait(2));self.assertEqual(self.q.list()['active'],[d['id']]);self.assertEqual(self.q.get(e['id'])['status'],'ready')
        self.q.cancel(ids=[e['id']]);self.assertEqual(self.q.list()['lane'],[]);self.assertEqual(self.q.get(e['id'])['status'],'standby')
        release2.set();self.wait(d['id'],'complete');self.assertEqual(self.q.get(e['id'])['status'],'standby');self.assertEqual(self.q.get(e['id'])['selection'],[])
    def test_start_requires_explicit_trust_and_valid_indices(self):
        a=self.make()
        for kw in ({},{'indices':[9],'trusted':True},{'indices':[0,0],'trusted':True}):
            with self.assertRaises(LibraryError):self.q.start(a['id'],**kw)
        for call in (lambda:self.q.start_many([a['id']]),lambda:self.q.start_sequence()):
            with self.assertRaises(LibraryError):call()

    # ------------------------------------------------------- housekeeping
    def test_reorder_persists_and_the_lane_follows_it(self):
        a,b,c=[self.make(x) for x in 'ABC']
        with self.assertRaises(LibraryError):self.q.reorder([a['id'],b['id']])
        with self.assertRaises(LibraryError):self.q.reorder([a['id'],b['id'],c['id'],'ghost'])
        state=self.q.reorder([c['id'],a['id'],b['id']]);self.assertEqual([t['title'] for t in state['tasks']],['C','A','B'])
        self.q.close();self.q=ProductionQueue(self.tmp.name,lambda *_:None,self.render);self.addCleanup(self.q.close)
        self.assertEqual([t['title'] for t in self.q.list()['tasks']],['C','A','B'])
        began,release=self.held_render(lambda task,index:task['title']=='C' and index==0)
        self.q.start_sequence(trusted=True);self.assertTrue(began.wait(2));self.assertEqual(self.q.list()['lane'],[a['id'],b['id']])
        self.q.reorder([b['id'],c['id'],a['id']]);self.assertEqual(self.q.list()['lane'],[b['id'],a['id']]);release.set();self.wait(a['id'],'complete')
        self.assertEqual([t for t,_ in self.calls][::3],['C','B','A'])
    def test_clear_finished_removes_only_complete_books(self):
        a,b,c=self.make('A',1),self.make('B',1),self.make('C',1)
        def render(task,index,cancel):
            if task['title']=='B':raise ValueError('nope')
            return self.render(task,index,cancel)
        self.q.render=render;self.q.start_many([a['id'],b['id']],trusted=True);self.wait(a['id'],'complete',idle=False);self.wait(b['id'],'failed')
        state=self.q.clear_finished();self.assertEqual(state['removed'],1);self.assertEqual([t['title'] for t in state['tasks']],['B','C'])
        self.assertEqual(self.q.clear_finished()['removed'],0)
    def test_bulk_remove_skips_running_books(self):
        began,release=self.held_render(lambda task,index:True)
        a,b,c=self.make('A',1),self.make('B',1),self.make('C',1);self.q.start(a['id'],trusted=True);self.assertTrue(began.wait(2))
        with self.assertRaises(LibraryError):self.q.remove(a['id'])
        state=self.q.remove(ids=[a['id'],b['id']]);self.assertEqual([t['title'] for t in state['tasks']],['A','C'])
        with self.assertRaises(LibraryError):self.q.remove(ids=[a['id']])
        release.set();self.wait(a['id'],'complete');self.q.remove(ids=[a['id'],c['id']]);self.assertEqual(self.q.list()['tasks'],[])
    def test_restart_leaves_interrupted_work_stopped(self):
        a=self.make();a['status']='running';a['pages'][0]['state']='running';self.q.tasks.set(a['id'],a);self.q.close();self.q=ProductionQueue(self.tmp.name,lambda *_:None,self.render);self.addCleanup(self.q.close)
        self.assertEqual(self.q.get(a['id'])['status'],'interrupted');self.assertEqual(self.q.get(a['id'])['pages'][0]['state'],'uncertain');self.assertTrue(self.q.list()['paused']);self.assertEqual(self.calls,[])
    def test_restart_keeps_a_waiting_lane_but_never_resumes_it_by_itself(self):
        a,b=self.make('A',1),self.make('B',1)
        with self.q.lock:
            for t in (a,b):t['status']='ready';t['selection']=[0];self.q._save(t)
            self.q.control.update(lane=[a['id'],b['id']],paused=False,concurrency=3);self.q._save_control()
        self.q.close();self.q=ProductionQueue(self.tmp.name,lambda *_:{},self.render);self.addCleanup(self.q.close)
        time.sleep(.3);state=self.q.list();self.assertTrue(state['paused']);self.assertEqual(state['lane'],[a['id'],b['id']]);self.assertEqual(state['concurrency'],3);self.assertEqual(self.calls,[])
        self.q.resume();self.wait(b['id'],'complete');self.assertEqual(self.calls,[('A',0),('B',0)])
    def test_legacy_batch_control_migrates_to_the_lane(self):
        a=self.make('A',1)
        with self.q.lock:
            a['status']='ready';a['selection']=[0];self.q._save(a)
            self.q.state.set('queue',{'order':[a['id']],'paused':True,'batch':[a['id']]})
        self.q.close();self.q=ProductionQueue(self.tmp.name,lambda *_:{},self.render);self.addCleanup(self.q.close)
        state=self.q.list();self.assertEqual(state['lane'],[a['id']]);self.assertEqual(state['concurrency'],1);self.assertNotIn('batch',self.q.control)
        self.q.resume();self.wait(a['id'],'complete')

    def test_remove_on_remove_hook_and_safety(self):
        a = self.make('A', 1)
        b = self.make('B', 1)
        a['albumId'] = 'alb_a'
        b['albumId'] = 'alb_b'
        self.q.tasks.set(a['id'], a)
        self.q.tasks.set(b['id'], b)
        
        callback_called = []
        def on_rem(tasks):
            callback_called.append([t['albumId'] for t in tasks])
            return {'deletedAlbumIds': [t['albumId'] for t in tasks]}
        
        res = self.q.remove(a['id'], on_remove=on_rem)
        self.assertEqual(callback_called, [['alb_a']])
        self.assertEqual(res.get('deletedAlbumIds'), ['alb_a'])
        self.assertEqual(res.get('removedTaskIds'), [a['id']])
        
        # Test running task rejects before on_remove
        began, release = self.held_render(lambda task, index: True)
        self.q.start(b['id'], trusted=True)
        self.assertTrue(began.wait(2))
        callback_called.clear()
        with self.assertRaises(LibraryError):
            self.q.remove(b['id'], on_remove=on_rem)
        self.assertEqual(callback_called, [])  # on_remove must not be called when rejected
        release.set()
        self.wait(b['id'], 'complete')
        self.q.remove(b['id'], on_remove=on_rem)
        self.assertEqual(callback_called, [['alb_b']])

if __name__=='__main__':
    unittest.main()

