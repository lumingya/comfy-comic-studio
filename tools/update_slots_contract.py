"""Explicit snapshot update; review the diff and run independent v3 acceptance tests.

Usage: python -m tools.update_slots_contract --approve
"""
import json
import sys
from pathlib import Path
from backend.ecosystem import workflow_slots as slots
from backend.mio_library import LibraryError
from tests.test_workflow_slots_v3 import fixtures


def main():
    if '--approve' not in sys.argv:
        raise SystemExit('Snapshot changes require --approve and review.')
    path=Path('tests/fixtures/workflow_slots_contract.json')
    current=json.loads(path.read_text())
    if isinstance(current,list):
        legacy=current
    else:
        legacy=[x['legacy'] for x in current['cases'] if 'legacy' in x]
    cases=[{'name':'v1 migrated: '+x['name'],'workflow':x['workflow'],'overrides':x['overrides'],'objectInfo':x.get('objectInfo',{}),'slots':x.get('slots',{}),'legacy':x} for x in legacy]+fixtures()
    for f in cases:
        p=slots.analyze(f['workflow'],f.get('objectInfo'),f.get('manual'),f.get('slots'))
        for g in p['lora']['groups']:
            if g['key'] in f.get('enable',[]):g['enabled']=True
        p.pop('analyzedAt',None)
        f['plan']=p
        try:
            r=slots.apply(f['workflow'],p,f['overrides'],f.get('objectInfo'))
            f['apply']={k:r[k] for k in ('workflow','notices','writes','overrides')}
            f['error']=None
        except LibraryError as e:
            f['apply']=None;f['error']=str(e)
    path.write_text(json.dumps({'version':3,'note':'27 legacy inputs retained with v3 expectations; v2 prompt fallback/replace semantics intentionally removed.','cases':cases},ensure_ascii=False,indent=2)+'\n')
    print('Updated',len(cases),'plan + apply fixtures')

if __name__=='__main__':main()
