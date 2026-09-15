"""Saved inputs share one lifecycle: latest before submission, immutable afterwards."""
import copy
import json
import tempfile
import threading
import unittest
from types import SimpleNamespace
from backend.mio_jobs import Jobs
from backend.mio_foundation import latest_frame_input

class LiveSettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.current={'prompt':'original','images':['/images/original.png'],'config':{'provider':'openai','baseUrl':'http://127.0.0.1:1','model':'test','keyMode':'none'}}
        self.calls=[]
        self.jobs=Jobs(self.tmp.name,self.execute,lambda row,original:copy.deepcopy(self.current))
        self.jobs.close();self.addCleanup(self.jobs.close)
    def execute(self,frame):
        frame['_onRequest']({'prompt':frame['prompt']})
        self.calls.append((frame['prompt'],copy.deepcopy(frame['images'])))
        return {'image':'/images/result.png'}
    def submit(self,n=2):return self.jobs.submit({'frames':[copy.deepcopy(self.current) for _ in range(n)]},'live-inputs')['id']
    def test_pending_reads_latest_text_and_image_while_completed_history_is_immutable(self):
        id=self.submit();self.jobs.step();self.current.update(prompt='changed',images=['/images/new.png']);self.jobs.step()
        self.assertEqual(self.calls,[('original',['/images/original.png']),('changed',['/images/new.png'])])
        j=self.jobs.get(id);self.assertEqual(j['state'],'complete');self.assertEqual(j['attempts'],2)
        with self.jobs.connect() as db:rows=db.execute('SELECT idx,input FROM request_inputs ORDER BY idx').fetchall()
        self.assertEqual(json.loads(rows[0]['input'])['images'],['/images/original.png']);self.assertEqual(json.loads(rows[1]['input'])['images'],['/images/new.png'])
    def test_reference_change_during_slow_preparation_releases_unsent_claim_without_failure(self):
        id=self.submit(1);ready=threading.Event();release=threading.Event()
        def prepare(frame):ready.set();release.wait(5);return self.execute(frame)
        self.jobs.execute=prepare;thread=threading.Thread(target=self.jobs.step);thread.start();self.assertTrue(ready.wait(2))
        self.current.update(prompt='latest',images=['/images/latest.png']);release.set();thread.join(3);self.assertFalse(thread.is_alive())
        j=self.jobs.get(id);self.assertEqual((j['attempts'],j['consecutive_failures'],j['frameStates'][0]['state']),(0,0,'pending'));self.assertEqual(self.calls,[])
        with self.jobs.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM request_inputs').fetchone()[0],0)
        self.jobs.execute=self.execute;self.jobs.step();self.assertEqual(self.calls,[('latest',['/images/latest.png'])]);self.assertEqual(self.jobs.get(id)['attempts'],1)
    def test_inflight_request_retains_its_image_after_save(self):
        id=self.submit();ready=threading.Event();release=threading.Event()
        def sent(frame):
            frame['_onRequest']({'prompt':frame['prompt']});ready.set();release.wait(5)
            self.calls.append((frame['prompt'],copy.deepcopy(frame['images'])));return {'image':'/images/first.png'}
        self.jobs.execute=sent;thread=threading.Thread(target=self.jobs.step);thread.start();self.assertTrue(ready.wait(2))
        self.current.update(prompt='future',images=['/images/future.png']);release.set();thread.join(3)
        self.jobs.execute=self.execute;self.jobs.step();self.assertEqual(self.calls,[('original',['/images/original.png']),('future',['/images/future.png'])]);self.assertEqual(self.jobs.get(id)['attempts'],2)
    def test_restart_resolves_saved_inputs_without_replaying_completed_frames(self):
        id=self.submit();self.jobs.step();self.jobs.close();self.current.update(prompt='after restart',images=['/images/restarted.png'])
        self.jobs=Jobs(self.tmp.name,self.execute,lambda row,original:copy.deepcopy(self.current));self.jobs.close();self.addCleanup(self.jobs.close);self.jobs.step()
        self.assertEqual(len(self.calls),2);self.assertEqual(self.calls[-1][0],'after restart');self.assertEqual(self.jobs.get(id)['completedIndices'],[0,1])
    def test_failed_retry_resolves_new_saved_reference(self):
        id=self.submit(1)
        class Failure(Exception):status=503
        def fail(frame):frame['_onRequest']({'prompt':frame['prompt']});raise Failure('controlled')
        self.jobs.execute=fail;self.jobs.step();self.current.update(prompt='retry latest',images=['/images/retry.png'])
        with self.jobs.connect() as db:db.execute('UPDATE job_frames SET ready_at=0')
        self.jobs.execute=self.execute;self.jobs.step();self.assertEqual(self.calls,[('retry latest',['/images/retry.png'])]);self.assertEqual(self.jobs.get(id)['attempts'],2)
    def test_invalid_saved_reference_is_not_replaced_with_old_reference(self):
        id=self.submit(1)
        def invalid(row,original):raise ValueError('reference was removed')
        self.jobs.resolve_frame=invalid;self.jobs.step();self.assertEqual(self.calls,[]);self.assertEqual(self.jobs.get(id)['frameStates'][0]['state'],'failed')

class SavedAlbumTests(unittest.TestCase):
    def setUp(self):
        self.original={'albumId':'a','frameIndex':1,'prompt':'amended text','negative':'amended negative','images':['/images/old.png'],'config':{'provider':'openai','keyMode':'none'}}
        self.fresh={**copy.deepcopy(self.original),'prompt':'template text','images':['/images/new.png']}
        self.entry={'input':self.fresh,'savedAt':3000,'textSavedAt':1000,'settingsSavedAt':3000,'initialImageKeys':['male_lead'],'imageKeys':['male_lead']}
        self.config={'savedGalleries':[{'id':'other','sourceSnapshot':{'liveInputs':{'1':{'input':{'prompt':'WRONG'}}}}},{'id':'a','sourceSnapshot':{'liveInputs':{'1':self.entry}}}]}
        self.host=SimpleNamespace(read_merged_config_raw=lambda:copy.deepcopy(self.config));self.row={'payload':json.dumps({'owner':'task','albumId':'a'}),'idx':0,'last_amended':2}
    def test_latest_reference_preserves_newer_api_amendment_text(self):
        f=latest_frame_input(self.host,self.row,self.original);self.assertEqual((f['prompt'],f['negative'],f['images']),('amended text','amended negative',['/images/new.png']))
    def test_slot_reorder_after_amendment_is_refused_not_silently_rebound(self):
        self.entry['imageKeys']=['other_person']
        with self.assertRaisesRegex(ValueError,'conflict'):latest_frame_input(self.host,self.row,self.original)
    def test_explicit_scene_save_resolves_the_amendment_conflict(self):
        self.entry['textSavedAt']=3000;self.entry['imageKeys']=['other_person'];self.assertEqual(latest_frame_input(self.host,self.row,self.original)['prompt'],'template text')
    def test_older_saved_inputs_do_not_replace_newer_amended_request(self):
        self.entry['savedAt']=1500;self.assertEqual(latest_frame_input(self.host,self.row,self.original),self.original)
    def test_album_binding_cannot_change_with_new_reference(self):
        self.fresh['albumId']='other'
        with self.assertRaisesRegex(ValueError,'binding'):latest_frame_input(self.host,self.row,self.original)
    def test_saved_invalid_draft_blocks_submission(self):
        self.entry['error']='male_lead missing'
        with self.assertRaisesRegex(ValueError,'missing'):latest_frame_input(self.host,self.row,self.original)

    def test_saved_comfy_workflow_keeps_its_own_output_node_with_live_channel(self):
        self.original['config']={'provider':'comfyui','outputNodeId':'old-output'}
        self.fresh['config']={'provider':'comfyui','outputNodeId':'new-output'}
        self.fresh['workflow']={'new-output':{'class_type':'SaveImage','inputs':{}}}
        self.entry['textSavedAt']=3000
        self.config['uiConfig']={'comfyStudio':{'settings':{'imageGeneration':{'profiles':[{'id':'comfyui','provider':'comfyui'}]}}}}
        self.config['comfyConfig']={'baseUrl':'http://127.0.0.1:8188'}
        frame=latest_frame_input(self.host,self.row,self.original)
        self.assertEqual(frame['config']['outputNodeId'],'new-output')
        self.assertEqual(frame['config']['baseUrl'],'http://127.0.0.1:8188')
        self.assertIn('new-output',frame['workflow'])
