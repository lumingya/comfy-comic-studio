// Actual HTTP/bootstrap/Chromium timing, not just a storage microbenchmark.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=process.cwd(),data=mkdtempSync(path.join(tmpdir(),'mio-native-benchmark-')),count=Number(process.argv[2]||5000),base='http://127.0.0.1:8851';
const setup=spawnSync('python',['-c',`import sys,json
from pathlib import Path
from backend.mio_library import FileLibrary,atomic_write,encode
r=Path(sys.argv[1]);n=int(sys.argv[2]);s=FileLibrary(r)
for i in range(n):
 doc={'schema':'mio.resource.v2','kind':'albums','id':'bench_'+str(i),'title':'效率验收画册 '+str(i),'totalSteps':12,'generatedSteps':0,'status':'partial','createdAt':1,'steps':[{'stepIndex':j,'prompt':'仅用于容量测试的分镜文字。'*75,'caption':'保留分镜文字','image':''} for j in range(12)]}
 atomic_write(r/'albums'/doc['id']/'album.json',encode(doc))
print(sum(p.stat().st_size for p in (r/'albums').rglob('*.json')))
s.close()`,data,String(count)],{cwd:root,encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
let server,browser;async function stop(){const child=server;server=null;if(child&&child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done}}
try{browser=await chromium.launch({args:['--no-sandbox']});const results=[];
 for(const cache of ['cold','warm']){
  const start=performance.now();server=spawn('python',['-u','server.py'],{cwd:root,env:{...process.env,MIO_DATA_DIR:data,MIO_PORT:'8851'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),60000);server.stdout.on('data',d=>{if(d.toString().includes('物理落盘')){clearTimeout(timer);resolve()}});server.on('exit',c=>{clearTimeout(timer);reject(Error('server exited '+c))})});const serverMs=performance.now()-start;
  const t=performance.now(),response=await fetch(base+'/api/config?summaries=1'),body=await response.text(),httpMs=performance.now()-t,json=JSON.parse(body);assert.equal(json.savedGalleries.length,count);assert.ok(json.savedGalleries.every(b=>b._lazy&&b.steps.length===0));
  const p=await browser.newPage({viewport:{width:1440,height:1000}});let details=0;const errors=[];p.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});p.on('request',r=>{if(r.url().includes('/api/library/entity/albums/'))details++});const begin=performance.now();await p.goto(base);await p.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting,{},{timeout:60000});const guiMs=performance.now()-begin;await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));const state=await p.evaluate(()=>({count:state.books.length,lazy:state.books.filter(b=>b._lazy).length,cards:document.querySelectorAll('[data-sort-book]').length}));assert.equal(state.count,count);assert.equal(state.lazy,count);assert.equal(details,0);assert.ok(state.cards<=24);const first=await p.evaluate(()=>state.books[0].id),open=performance.now();await p.evaluate(id=>Mio.fileLibrary.hydrate(id),first);const detailMs=performance.now()-open;assert.equal(details,1);assert.equal(await p.evaluate(id=>bookBy(id).steps.length,first),12);assert.deepEqual(errors,[]);results.push({cache,albums:count,framesPerAlbum:12,imageCount:0,serverReadyMs:+serverMs.toFixed(1),bootstrapHttpMs:+httpMs.toFixed(1),bootstrapBytes:Buffer.byteLength(body),guiBootMs:+guiMs.toFixed(1),visibleCards:state.cards,albumDetailRequestsAtBoot:0,firstDetailMs:+detailMs.toFixed(1)});await p.close();await stop();
 }
 console.log(JSON.stringify({platform:'Linux / Python 3.13 / sandbox Chromium',authoritativeAlbumJsonBytes:Number(setup.stdout.trim()),results,scope:'Measured synthetic 5000-album GUI path. No image decoding workload or physical-device/network benchmark.'},null,2));
}finally{await browser?.close();await stop();rmSync(data,{recursive:true,force:true})}
