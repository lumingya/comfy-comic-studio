import copy
import json
from pathlib import Path
import unittest
from backend.ecosystem.workflow import compile_workflow
from backend.mio_library import LibraryError

class WorkflowMappingTests(unittest.TestCase):
    def test_shared_contract(self):
        fixtures = json.loads((Path(__file__).parent/'fixtures/workflow_mapping_contract.json').read_text())
        for fixture in fixtures:
            with self.subTest(fixture=fixture['name']):
                before=copy.deepcopy(fixture['workflow'])
                def compile():
                    return compile_workflow(fixture['workflow'],fixture['bindings'],'prompt',fixture.get('options',{}),[])
                if fixture['error']:
                    with self.assertRaises(LibraryError):compile()
                else:
                    result=compile()
                    if fixture.get('unchangedWorkflow'):self.assertEqual(result,before)
                    for key,value in fixture['expectedInputs'].items():
                        self.assertEqual(result['n']['inputs'][key],value)
                    self.assertEqual(result['up'],before['up'])
                self.assertEqual(fixture['workflow'],before)

    def test_image_upload_staging_is_atomic(self):
        images=[]
        workflow={'1':{'inputs':{'image':'','number':1}}}
        bindings=[{'nodeId':'1','path':'image','source':'variable','value':'ref','enabled':True,'type':'text'},
                  {'nodeId':'1','path':'number','source':'literal','value':'bad','enabled':True,'type':'number'}]
        with self.assertRaises(LibraryError):
            compile_workflow(workflow,bindings,'',{'variables':{'ref':{'kind':'mio-image','src':'private'}}},images)
        self.assertEqual(images,[])
