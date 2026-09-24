// Second-pass controlled regressions. No paid calls; fresh isolated server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mio-round2-')),base='http://127.0.0.1:18839';
const log=fs.openSync(path.join(root,'server.log'),'w'),server=spawn('python',['-u','server.py'],{env:{...process.env,MIO_HOST:'127.0.0.1',MIO_PORT:'18839',MIO_DATA_DIR:path.join(root,'data')},stdio:['ignore',log,log]});
let browser,count=0;const failures=[];
async function check(name,run){try{assert.ok(await run(),name);console.log('PASS '+name);count++}catch(e){console.log('FAIL '+name+': '+e.message);failures.push(name)}}
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/content')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
 browser=await chromium.launch({args:['--no-sandbox']});const p=await browser.newPage();
 await p.route(/^https?:\/\//,r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 await p.goto(base);await p.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);
 await p.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());clearTimeout(workshop.pollTimer)});
 // Let any boot-time request finish before substituting the queue transport (the extension boot renders once more when it lands).
 await p.waitForFunction(()=>!workshop.loading&&ecoState.booted);
 await p.evaluate(()=>clearTimeout(workshop.pollTimer));
 await check('duplicate inferred keys do not steal already reconciled siblings',()=>p.evaluate(()=>{
  const el=document.createElement('section');document.body.append(el);el.innerHTML='<button data-act="sample">one</button>';
  const next='<button data-act="sample">one</button><button data-act="sample">two</button>';patchDOM(el,next);const ok=el.innerHTML===next;el.remove();return ok;
 }));
 await check('deterministic mixed-node and duplicate-key fuzz (200 transitions)',()=>p.evaluate(()=>{
  let seed=123456;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n},node=()=>{const t=rand(5);return t===0?'text'+rand(9):t===1?'<!--'+rand(9)+'-->':`<${t===2?'i':'b'}${rand(2)?' data-key="'+rand(3)+'"':''}>${rand(9)}</${t===2?'i':'b'}>`};
  const el=document.createElement('section');document.body.append(el);try{for(let i=0;i<200;i++){const before=Array.from({length:rand(8)},node).join(''),after=Array.from({length:rand(8)},node).join('');el.innerHTML=before;patchDOM(el,after);const expected=document.createElement('section');expected.innerHTML=after;if(el.innerHTML!==expected.innerHTML)throw Error(JSON.stringify({i,before,after,actual:el.innerHTML}))}return true}finally{el.remove()}
 }));
 await check('queue change deferred by modal renders once after close, even on 304',()=>p.evaluate(async()=>{
  const old={request,render,queue:workshop.queue,etag:workshop.etag};workshop.view='production';navigate(1);clearTimeout(workshop.pollTimer);let calls=0,requests=0;
  const next={...workshop.queue,paused:!workshop.queue.paused,serverEpochMs:Date.now()};
  request=async(url,...args)=>url==='/api/production/tasks'?(requests++===0?new Response(JSON.stringify({data:next}),{headers:{ETag:'"round2"'}}):new Response(null,{status:304})):old.request(url,...args);
  render=(...args)=>{calls++;return old.render(...args)};
  try{modal('diagnostics','controlled');await refreshProduction();if(calls!==0)return false;closeModal();await refreshProduction();await refreshProduction();return calls===1}finally{closeModal();request=old.request;render=old.render;workshop.queue=old.queue;workshop.etag=old.etag;render()}
 }));
 await check('gallery resume asks billing consent; decline sends zero start requests',()=>p.evaluate(async()=>{
  navigate(0);const old={books:state.books,queue:workshop.queue,confirmAction,productionRequest,refreshProduction};const b={...clone(state.books[0]),id:'audit-book',totalSteps:2,steps:[],_lazy:false,pictureEdits:{},curatedDemo:false};state.books=[b];workshop.queue={tasks:[{id:'assembly-audit',albumId:b.id,status:'standby',pages:[{index:0,state:'standby'},{index:1,state:'standby'}]}],batch:[],paused:true};let starts=0,confirms=0;
  productionRequest=async(route)=>{if(route==='start')starts++;return workshop.queue};refreshProduction=async()=>{};confirmAction=async()=>{confirms++;return false};
  try{await handleAction('resume',{id:b.id});if(confirms!==1||starts!==0)throw Error(JSON.stringify({confirms,starts,missing:missingIndices(b),found:!!bookBy(b.id)}));return true}finally{state.books=old.books;workshop.queue=old.queue;confirmAction=old.confirmAction;productionRequest=old.productionRequest;refreshProduction=old.refreshProduction;render()}
 }));
 await check('gallery uncertain result requires the extra warning; declining it starts nothing',()=>p.evaluate(async()=>{
  navigate(0);const old={books:state.books,queue:workshop.queue,confirmAction,productionRequest,refreshProduction};const b={...clone(state.books[0]),id:'audit-warning',totalSteps:1,steps:[],_lazy:false,pictureEdits:{},curatedDemo:false};state.books=[b];workshop.queue={tasks:[{id:'assembly-warning',albumId:b.id,status:'failed',pages:[{index:0,state:'uncertain'}]}],batch:[],paused:true};let starts=0,confirms=0;
  productionRequest=async()=>{starts++;return workshop.queue};refreshProduction=async()=>{};confirmAction=async()=>++confirms===1;
  try{await handleAction('resume',{id:b.id});return confirms===2&&starts===0}finally{state.books=old.books;workshop.queue=old.queue;confirmAction=old.confirmAction;productionRequest=old.productionRequest;refreshProduction=old.refreshProduction;render()}
 }));
 await check('bulk resume never partially launches first book before failing on second',()=>p.evaluate(async()=>{
  navigate(0);const old={books:state.books,queue:workshop.queue,selected:ui.selected,confirmAction,productionRequest,refreshProduction};state.books=[0,1].map(i=>({...clone(state.books[0]),id:'audit-'+i,totalSteps:1,steps:[],_lazy:false,pictureEdits:{},curatedDemo:false}));ui.selected=new Set(state.books.map(b=>b.id));workshop.queue={tasks:state.books.map((b,i)=>({id:'assembly-'+i,albumId:b.id,status:'standby',pages:[{index:0,state:'standby'}]})),batch:[],paused:true};let starts=0;
  productionRequest=async(route)=>{if(route==='start'&&++starts===2)throw Error('batch is busy');return workshop.queue};refreshProduction=async()=>{};confirmAction=async()=>false;
  workshop.queue.tasks.forEach(t=>{t.title='fixture';t.sources={story:'fixture',presets:[],channel:'fixture'};t.pages.forEach(page=>Object.assign(page,{attempts:[],attemptCount:0,result:null}))});
  try{await handleAction('bulk-resume');return starts===0&&ui.workspace===1&&workshop.view==='production'}finally{state.books=old.books;workshop.queue=old.queue;ui.selected=old.selected;confirmAction=old.confirmAction;productionRequest=old.productionRequest;refreshProduction=old.refreshProduction;render()}
 }));
 console.log(`ROUND 2: ${count} passed, ${failures.length} failed`);assert.deepEqual(failures,[]);
}finally{await browser?.close();if(server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done}fs.closeSync(log);fs.rmSync(root,{recursive:true,force:true})}
