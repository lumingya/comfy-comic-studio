import concurrent.futures
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import mio_credentials as vault, mio_api, mio_channels

class KeyPoolTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=self.temp.name; self.config={'id':'p','provider':'openai','baseUrl':'https://example.test/v1','model':'image','keyMode':'stored'}
    def apply(self, entries):return vault.manage(self.root,{'action':'apply','config':self.config,'entries':entries})['keys']
    def pool(self):
        keys=self.apply([{'key':'secret-A'},{'key':'secret-B'},{'key':'secret-C'}])
        return {**self.config,'keyIds':[k['id'] for k in keys]}
    def resolve(self,c):return vault.resolve(self.root,{'config':c})
    def test_order_and_persistence(self):
        c=self.pool();self.assertEqual([self.resolve(c) for _ in range(5)],['secret-A','secret-B','secret-C','secret-A','secret-B'])
        self.assertEqual(self.resolve(dict(c)),'secret-C')
        self.assertTrue(vault.read(self.root)['rotations'])
    def test_concurrent_rotation_is_balanced(self):
        c=self.pool()
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:keys=list(ex.map(lambda _:self.resolve(c),range(90)))
        self.assertEqual([keys.count('secret-'+x) for x in 'ABC'],[30,30,30])
    def test_blank_list_is_empty_even_with_environment_and_old_id(self):
        c=self.pool()
        with patch.dict('os.environ',{'OPENAI_API_KEY':'environment'}):
            self.assertEqual(self.resolve({**c,'keyIds':[],'keyId':c['keyIds'][0]}),'')
            self.assertEqual(self.resolve({**c,'keyMode':'none'}),'')
    def test_atomic_apply_rejects_partial_invalid_changes(self):
        c=self.pool();before=Path(vault.path_for(self.root)).read_bytes()
        for entries in [[{'key':'new'},{'id':'bad'}],[{'key':'new'},{'key':'bad\nheader'}],[{'key':'x'}]*33]:
            with self.assertRaises(ValueError):self.apply(entries)
            self.assertEqual(before,Path(vault.path_for(self.root)).read_bytes())
        self.assertEqual(self.resolve(c),'secret-A')
    def test_refs_and_duplicate_values_reuse_keys(self):
        c=self.pool();keys=self.apply([{'id':c['keyIds'][0]},{'key':'secret-B'},{'key':'secret-A'}])
        self.assertEqual([k['id'] for k in keys],[c['keyIds'][0],c['keyIds'][1],c['keyIds'][0]])
        self.assertEqual(len(vault.read(self.root)['keys']),3)
        self.assertNotIn('secret',str(keys))
    def test_scope_and_missing_member_abort_entire_pool(self):
        c=self.pool()
        for changed in [{'id':'other'},{'baseUrl':'https://other.test/v1'},{'keyIds':[c['keyIds'][0],'missing']}]:
            with self.assertRaises(ValueError):self.resolve({**c,**changed})
        self.assertEqual(self.resolve(c),'secret-A')
    def test_pool_order_changes_start_new_sequence(self):
        c=self.pool();self.resolve(c)
        self.assertEqual(self.resolve({**c,'keyIds':list(reversed(c['keyIds']))}),'secret-C')
    def test_external_api_and_channel_resolver_preserve_pool(self):
        c=self.pool();config={'uiConfig':{'comfyStudio':{'settings':{'imageGeneration':{'profiles':[c]}}}}}
        self.assertEqual(mio_channels.resolve_channel(config,'p','openai')['keyIds'],c['keyIds'])
        for body in [{'providerId':'p','prompt':'x'},{'config':c,'prompt':'x'}]:
            payload=mio_api.generation_payload(body,config)
            self.assertEqual(payload['config']['keyIds'],c['keyIds'])
    def test_invalid_pool_shape(self):
        c=self.pool()
        for ids in ['bad',[None],['x']*33]:
            with self.assertRaises(ValueError):self.resolve({**c,'keyIds':ids})
    def test_deleted_key_is_not_silently_skipped(self):
        c=self.pool();vault.manage(self.root,{'action':'delete','config':c,'keyId':c['keyIds'][1]})
        with self.assertRaises(ValueError):self.resolve(c)

    def test_actual_authorization_headers_across_all_cloud_protocols(self):
        import base64, io, json, zipfile
        from backend import server
        from tests.test_providers import ProviderTests, PNG
        image='data:image/png;base64,'+base64.b64encode(PNG).decode()
        for provider,protocol,reference in [('openai','images',False),('openai','images',True),('openai','chat',True),('novelai','images',False)]:
            with self.subTest(provider=provider,protocol=protocol,reference=reference):
                self.config.update(id=provider+protocol+str(reference),provider=provider,protocol=protocol)
                c=self.pool();payload={'config':c,'prompt':'test','frame':{},'albumId':'test'}
                if reference:payload['source']=image
                if provider=='novelai':
                    data=io.BytesIO()
                    with zipfile.ZipFile(data,'w') as z:z.writestr('image.png',PNG)
                    raw=data.getvalue()
                elif protocol=='chat':raw=json.dumps({'choices':[{'message':{'images':[{'image_url':{'url':image}}]}}]}).encode()
                else:raw=json.dumps({'data':[{'b64_json':base64.b64encode(PNG).decode()}]}).encode()
                with patch.object(server,'DATA_DIR',self.root):
                    requests=[ProviderTests().run_provider(payload,raw) for _ in range(4)]
                self.assertEqual([r.get_header('Authorization') for r in requests],['Bearer secret-A','Bearer secret-B','Bearer secret-C','Bearer secret-A'])
