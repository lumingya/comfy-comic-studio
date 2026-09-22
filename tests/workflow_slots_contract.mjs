import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({console});
vm.runInContext(fs.readFileSync('js/workflow-slots.js','utf8')+';globalThis.S=WorkflowSlots;',context);
const S=context.S,plain=x=>JSON.parse(JSON.stringify(x));
const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/workflow_slots_contract.json','utf8')).cases;
assert.equal(S.detect,undefined,'no JS analyzer');assert.equal(S.normalize,undefined,'no JS heuristics');
for(const f of fixtures){
 const before=JSON.stringify(f.workflow),planBefore=JSON.stringify(f.plan);
 try{
  const run=()=>S.applyPlan(f.workflow,{plan:f.plan},f.overrides,{objectInfo:f.objectInfo||{}});
  if(f.error)assert.throws(run,e=>e.message===f.error, f.name);
  else {const r=run();for(const [key,value] of Object.entries(f.apply))assert.deepEqual(plain(r[key]),value,`${f.name}: ${key}`);assert.deepEqual(plain(run()),plain(r),'deterministic');}
  assert.equal(JSON.stringify(f.workflow),before,'input not mutated');assert.equal(JSON.stringify(f.plan),planBefore,'plan not mutated');
 }catch(e){console.error('FAILED:',f.name);throw e;}
}
console.log(`${fixtures.length} shared v3 plan/apply fixtures PASS`);
