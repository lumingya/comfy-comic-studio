// End-to-end durable worker: browser closes, the real Python service keeps producing.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=mkdtempSync(path.join(tmpdir(),'mio-foundation-'));
for(const name of ['providers','mio_jobs.py','mio_frame_jobs.py','mio_channels.py','mio_contracts.py','mio_foundation.py','server.py','mio_api.py','mio_credentials.py','mio_docs.py','index.html','styles.css','favicon.svg','vendor','js','docs'])cpSync(path.join(root,name),path.join(temp,name),{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),calls=[];
const upstream=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;if(req.url==='/v1/images/generations'){calls.push(JSON.parse(raw));await new Promise(r=>setTimeout(r,400));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}))}else{res.statusCode=404;res.end('unsupported')}});
await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));const upstreamUrl='http://127.0.0.1:'+upstream.address().port+'/v1';
const server=spawn('python',['-u','server.py'],{cwd:temp,env:{...process.env,MIO_PORT:'8795',MIO_API_TOKEN:'t'.repeat(40)},stdio:['ignore','pipe','pipe']});let browser,checks=0;const check=(n,v)=>{assert.ok(v,n);console.log('PASS '+n);checks++};
const base='http://127.0.0.1:8795';
async function api(url,body){const r=await fetch(base+'/api/v1/'+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'t'.repeat(40)},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json()}}
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('物理落盘')){clearTimeout(t);resolve()}})});
 browser=await chromium.launch({args:['--no-sandbox']});let page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https:\/\//,r=>r.abort());await page.goto(base);await page.waitForFunction(()=>!rt.booting);
 const snapshot=await page.evaluate(async url=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.settings.identity.workspaceName='Foundation acceptance';state.settings.identity.onboarded=true;state.settings.comfy.mode='real';state.queue=[];state.books=[];const p=selectedPlan(),t=templateBy(p.templateId);p.storyVersionId='';t.frames=t.frames.slice(0,3);t.frames.forEach((f,i)=>{f.prompt='durable frame '+i;f.negative=''});const g=ensureImageProviders();g.profiles.push({id:'durable_test',title:'Durable test',provider:'openai',protocol:'images',model:'test',baseUrl:url,keyMode:'none',sendSize:false,sendQuality:false,extraParams:{output_compression:80}});g.active='durable_test';save();await savePythonWorkspace(true);enqueuePlanSnapshot(p);await runQueue();const q=state.queue[0];return{id:q.serverId,input:q.serverInput,token:(state.workspaceId||'workspace')+':'+q.id,book:q.bookId}},upstreamUrl);
 check('UI submits an immutable held snapshot to the durable service',!!snapshot.id&&snapshot.input.frames.length===3);
 await page.close();
 let job;for(let i=0;i<100;i++){job=(await api('jobs/'+snapshot.id)).body.data;if(job.state==='complete')break;await new Promise(r=>setTimeout(r,100))}
 check('all frames complete after the browser page closes',job.state==='complete'&&job.cursor===3&&calls.length===3);
 const albums=(await api('albums')).body.data.items;check('album metadata reflects durable results before any browser reopens',albums.find(b=>b.id===snapshot.book)?.generatedSteps===3);
 check('advanced parameters reach the real wire format',calls.every(c=>c.output_compression===80));
 check('all results expose the versioned artifact-list contract',job.results.every(r=>r.contractVersion===1&&r.artifacts[0].kind==='image'));
 const duplicate=await api('jobs',{idempotencyKey:snapshot.token,input:snapshot.input});check('external duplicate returns same job without extra generation',duplicate.body.data.id===snapshot.id&&calls.length===3);
 const conflict=await api('jobs',{idempotencyKey:snapshot.token,input:{...snapshot.input,label:'changed'}});check('same key with a different snapshot returns conflict',conflict.status===409);
 page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route(/^https:\/\//,r=>r.abort());await page.goto(base);await page.waitForFunction(()=>!rt.booting);await page.waitForFunction(book=>bookBy(book)?.generatedSteps===3,snapshot.book);
 check('reopening reconciles server results into the original album',await page.evaluate(book=>bookBy(book).steps.length===3&&state.queue[0].status==='complete',snapshot.book));
 check('real queue uses an explicit service entry rather than an added run wrapper',await page.evaluate(()=>runQueue===runFoundationQueue));
 const unauth=await fetch(base+'/api/v1/jobs');check('public task API requires authentication',unauth.status===401);
 const events=await fetch(base+'/api/v1/jobs/events',{headers:{Authorization:'Bearer '+'t'.repeat(40)}});check('SSE exposes replayable job events',events.headers.get('Content-Type').includes('text/event-stream')&&(await events.text()).includes('event: job'));
 const asset=await api('assets/upload',{name:'external.png',dataUrl:'data:image/png;base64,'+png.toString('base64')});check('external clients can upload durable inputs',asset.status===200&&asset.body.data.url.startsWith('/images/'));
 const catalog=await api('assets/catalog');check('asset index includes hashes and task references',catalog.body.data.items.some(i=>i.sha256?.length===64&&i.references.some(r=>r.startsWith('result/'))));
 check('recent unreferenced uploads are protected by the grace period',catalog.body.data.items.find(i=>i.url===asset.body.data.url).cleanupEligible===false);
 await page.evaluate(async()=>{window.__foundationPortable=await buildDiskPackage(state)});check('portable export externalizes secondary artifact references',await page.evaluate(async()=>{const pkg=window.__foundationPortable;const book=[...pkg.files.entries()].find(([p])=>p.endsWith('/book.json'));return !!book&&(await book[1].text()).includes('__cc_asset')}));
 check('portable restore re-materializes primary and artifact images locally',await page.evaluate(async()=>{const pkg=window.__foundationPortable,loaded=await loadDiskManifest(async name=>pkg.files.get(name),await pkg.files.get('workspace.json').text());return loaded.state.books.every(b=>b.steps.every(s=>s.image.startsWith('/images/')&&s.artifacts.every(a=>a.url.startsWith('/images/'))))}));
 const badCleanup=await api('assets/cleanup',{token:(await api('assets/catalog')).body.data.cleanup.token,paths:[asset.body.data.url]});check('cleanup refuses noneligible assets',badCleanup.status===400);
 const resources=await api('resources/storyboards');const projectId=resources.body.data.items[0].projectId;
 const write=await api('resources/storyboards',{expectedRevision:resources.body.data.revision,item:{id:'external_storyboard',projectId,title:'External storyboard',frames:[{prompt:'A quiet lake'}]}});check('controlled storyboard write succeeds with current revision',write.status===200);
 const stale=await api('resources/storyboards',{expectedRevision:resources.body.data.revision,item:{id:'other',projectId,title:'Stale',frames:[{prompt:'x'}]}});check('stale resource writers cannot overwrite new data',stale.status===409);
 check('stale browser saves are rejected rather than overwriting external edits',await page.evaluate(async()=>{selectedPlan().title='stale browser title';save();return !await savePythonWorkspace()}));
 check('no uncaught browser errors',errors.length===0);console.log(checks+' foundation checks passed.');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));await new Promise(resolve=>upstream.close(resolve));rmSync(temp,{recursive:true,force:true})}
