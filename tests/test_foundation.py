import base64
import copy
import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import server
import mio_foundation
from mio_jobs import Jobs, Conflict
from providers import extras
from providers.comfyui import generate as comfy_generate
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')

class FoundationSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.store=Jobs(str(self.root/'execution'),lambda _:None);self.addCleanup(self.store.close)
        self.config={}
        for name,value in [('DATA_DIR',str(self.root)),('IMAGES_DIR',str(self.root/'assets/images')),('LEGACY_IMAGES_DIR',str(self.root/'legacy'))]:
            p=patch.object(server,name,value);p.start();self.addCleanup(p.stop)
        p=patch.object(server,'read_merged_config',side_effect=lambda:copy.deepcopy(self.config));p.start();self.addCleanup(p.stop)
        p=patch.object(mio_foundation,'jobs',return_value=self.store);p.start();self.addCleanup(p.stop)
    def asset(self,old=False):
        url=server.store_image_data('data:image/png;base64,'+base64.b64encode(PNG).decode(),'asset-test')
        if old:os.utime(server.local_path_from_url(url),(time.time()-172800,)*2)
        return url
    def test_metadata_and_current_reference_lookup(self):
        url=self.asset();self.config={'variables':[{'value':{'kind':'mio-image','src':url}}]}
        record=mio_foundation.inventory(server)['items'][0];self.assertEqual(record['width'],1);self.assertEqual(record['height'],1);self.assertEqual(record['integrity'],'ok');self.assertTrue(record['references'])
    def test_job_snapshot_protects_old_image(self):
        url=self.asset(True);self.store.submit({'hold':True,'frames':[{'config':{'provider':'openai'},'prompt':'test','images':[url]}]},'snapshot')
        record=mio_foundation.inventory(server)['items'][0];self.assertFalse(record['cleanupEligible']);self.assertTrue(any(r.startswith('job/') for r in record['references']))
    def test_cleanup_is_preview_confirmed_and_recoverable(self):
        url=self.asset(True);report=mio_foundation.inventory(server)
        result=mio_foundation.cleanup(server,{'token':report['cleanup']['token'],'paths':[url]});self.assertEqual(result['recycled'],[url]);self.assertTrue(list((self.root/'trash').rglob('*.png')))
        with self.assertRaises(FileNotFoundError):server.local_path_from_url(url)
    def test_new_reference_invalidates_cleanup_preview(self):
        url=self.asset(True);report=mio_foundation.inventory(server);self.config={'snapshot':{'image':url}}
        with self.assertRaises(Conflict):mio_foundation.cleanup(server,{'token':report['cleanup']['token'],'paths':[url]})
    def test_unknown_job_blocks_cleanup(self):
        url=self.asset(True);report=mio_foundation.inventory(server);job=self.store.submit({'hold':True,'frames':[{'config':{'provider':'openai'},'prompt':'test'}]},'unknown')
        with self.store.connect() as db:db.execute("UPDATE jobs SET state='unknown' WHERE id=?",(job['id'],))
        with self.assertRaises(Conflict):mio_foundation.cleanup(server,{'token':report['cleanup']['token'],'paths':[url]})
    def test_missing_and_modified_assets_are_reported(self):
        url=self.asset();path=Path(server.local_path_from_url(url));path.write_bytes(PNG+b'modified');self.config={'image':url,'missing':'/images/no.png'}
        report=mio_foundation.inventory(server,True);self.assertEqual(report['items'][0]['integrity'],'mismatch');self.assertEqual(report['missing'][0]['url'],'/images/no.png')
    def test_extra_params_cannot_override_bound_fields(self):
        for name in ['prompt','image','image[]','messages','model','api_key','authorization','bad\"\r\nname=\"image']:
            with self.assertRaises(ValueError):extras({'extraParams':{name:'bad'}},{})
        body={};self.assertEqual(extras({'extraParams':{'output_compression':80}},body),['output_compression']);self.assertEqual(body['output_compression'],80)
    def test_comfy_reconcile_only_reads_history_without_resubmit(self):
        import io,json
        from unittest.mock import MagicMock
        responses=[]
        for content in [json.dumps({'known-id':{'status':{'completed':True},'outputs':{'9':{'images':[{'filename':'result.png','type':'output'}]}}}}).encode(),PNG]:
            r=MagicMock();r.headers={};r.read.side_effect=[content,b''];r.__enter__.return_value=r;responses.append(r)
        opener=MagicMock();opener.open.side_effect=responses
        with patch('providers.comfyui.urllib.request.build_opener',return_value=opener):
            result=comfy_generate({'config':{'baseUrl':'http://localhost:8188','provider':'comfyui'},'workflow':{'9':{'class_type':'SaveImage','inputs':{}}},'_resumePromptId':'known-id','_requestTimeout':45},server)
        self.assertEqual(len(result['artifacts']),1)
        self.assertTrue(all(call.args[0].data is None for call in opener.open.call_args_list));self.assertEqual(opener.open.call_count,2)
        self.assertTrue(all(40<c.kwargs['timeout']<=45 for c in opener.open.call_args_list))

    def test_saved_scene_lookup_is_album_local_and_binding_checked(self):
        import json
        original={'config':{'provider':'openai','keyMode':'none'},'albumId':'a','frameIndex':3,'prompt':'old','images':[]}
        fresh={**original,'prompt':'new'}
        config={'savedGalleries':[{'id':'other','sourceSnapshot':{'liveInputs':{'3':{'input':{**fresh,'prompt':'wrong'}}}}},{'id':'a','sourceSnapshot':{'liveInputs':{'3':{'input':fresh,'savedAt':2000}}}}]}
        host=SimpleNamespace(read_merged_config_raw=lambda:copy.deepcopy(config));row={'payload':json.dumps({'owner':'task','albumId':'a'}),'idx':0}
        self.assertEqual(mio_foundation.latest_frame_input(host,row,original)['prompt'],'new')
        row['last_amended']=3;self.assertEqual(mio_foundation.latest_frame_input(host,row,original)['prompt'],'old');row['last_amended']=0
        fresh['config']={'provider':'novelai'}
        with self.assertRaises(ValueError):mio_foundation.latest_frame_input(host,row,original)

    def test_invalid_saved_draft_is_not_silently_ignored(self):
        import json
        host=SimpleNamespace(read_merged_config_raw=lambda:{'savedGalleries':[{'id':'a','sourceSnapshot':{'liveInputs':{'0':{'error':'unresolved variable'}}}}]})
        with self.assertRaises(ValueError):mio_foundation.latest_frame_input(host,{'payload':json.dumps({'owner':'task','albumId':'a'}),'idx':0},{'prompt':'old'})

    def test_channel_reference_replaces_model_endpoint_and_credential_binding(self):
        import json
        original={'channelId':'ch','config':{'id':'ch','provider':'openai','model':'old','baseUrl':'https://old.invalid','keyMode':'stored','keyId':'old-key'},'prompt':'same'}
        profile={'id':'ch','provider':'openai','model':'new','baseUrl':'https://new.invalid/v1','keyMode':'none','sendSize':False}
        config={'uiConfig':{'comfyStudio':{'settings':{'imageGeneration':{'profiles':[profile]}}}}}
        host=SimpleNamespace(read_merged_config_raw=lambda:copy.deepcopy(config));row={'payload':json.dumps({'frames':[original]}),'idx':0}
        frame=mio_foundation.latest_frame_input(host,row,original)
        self.assertEqual(frame['config']['model'],'new');self.assertEqual(frame['config']['baseUrl'],'https://new.invalid/v1');self.assertNotIn('keyId',frame['config']);self.assertEqual(frame['config']['keyMode'],'none');self.assertEqual(original['config']['model'],'old')
        profile['keyMode']='stored';profile['keyId']='new-key';self.assertEqual(mio_foundation.latest_frame_input(host,row,original)['config']['keyId'],'new-key')

    def test_missing_empty_or_type_changed_channel_never_uses_snapshot(self):
        import json
        from mio_channels import ChannelConfigurationError
        original={'channelId':'missing','config':{'provider':'openai','model':'old'},'prompt':'same'};profiles=[]
        host=SimpleNamespace(read_merged_config_raw=lambda:{'uiConfig':{'comfyStudio':{'settings':{'imageGeneration':{'profiles':profiles}}}}});row={'payload':json.dumps({'frames':[original]}),'idx':0}
        with self.assertRaises(ChannelConfigurationError):mio_foundation.latest_frame_input(host,row,original)
        profiles.append({'id':'missing','provider':'openai','model':'','baseUrl':'https://new.invalid'})
        with self.assertRaises(ChannelConfigurationError):mio_foundation.latest_frame_input(host,row,original)
        profiles[0].update(provider='novelai',model='new')
        with self.assertRaises(ChannelConfigurationError):mio_foundation.latest_frame_input(host,row,original)

    def test_legacy_browser_profile_id_resolves_without_resubmission(self):
        import json
        original={'config':{'id':'old-profile','provider':'openai','model':'old'},'prompt':'same'}
        host=SimpleNamespace(read_merged_config_raw=lambda:{'uiConfig':{'comfyStudio':{'settings':{'imageGeneration':{'profiles':[{'id':'old-profile','provider':'openai','model':'latest','baseUrl':'https://new.invalid'}]}}}}})
        row={'payload':json.dumps({'owner':'q','albumId':'a','frames':[original]}),'idx':0}
        self.assertEqual(mio_foundation.latest_frame_input(host,row,original)['config']['model'],'latest')
        row['payload']=json.dumps({'frames':[original]});self.assertEqual(mio_foundation.latest_frame_input(host,row,original)['config']['model'],'old')
