/* Acceptance: albums produced by the generation queue appear on the shelf and grow inside the open reader
   without any click, page reload or full workspace reload. Runs against the controlled fixture host. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {chromium} from 'playwright';
const root=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mio-album-live-')),port=18771,url=`http://127.0.0.1:${port}`;fs.cpSync('data',dir,{recursive:true});
const log=fs.openSync('/tmp/mio-album-live-server.log','w');const server=spawn('python',['tests/production_fixture_server.py'],{cwd:root,env:{...process.env,MIO_DATA_DIR:dir,MIO_PORT:String(port),MIO_HOST:'127.0.0.1',MIO_NO_BROWSER:'1'},stdio:['ignore',log,log]});
let browser;let checks=0;const check=(x,text)=>{assert.ok(x,text);checks++;console.log('PASS',text)};
const evidence='docs/acceptance-album-live';fs.mkdirSync(evidence,{recursive:true});
try{
 for(let i=0;i<100;i++){try{if((await fetch(url+'/api/content')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>globalThis.Mio&&state.templates.length);
 /* Fixture channel + spy on the heavy full reload: live sync must never call it. */
 const taskId=await page.evaluate(async()=>{
  await connectPythonBackend();
  state.settings.imageGeneration.profiles.push({id:'controlled',title:'受控验收渠道',provider:'openai',model:'fixture',baseUrl:'https://controlled.invalid/v1',keyMode:'none',protocol:'images'});save();await savePythonWorkspace();
  globalThis.__reloads=0;const prior=connectPythonBackend;connectPythonBackend=async function(...a){globalThis.__reloads++;return prior(...a)};
  const story=projectTemplates()[0];
  await productionRequest('assemble',{requestId:'live-sync-'+Date.now(),title:'实时同步验收册',projectId:state.activeProjectId,storyId:story.id,presets:projectVariableSets().map(p=>({id:p.id,kind:p.category==='scenes'?'scenes':'characters'})),channelId:'controlled',seed:1});
  await refreshProduction();navigate(0);
  return workshop.queue.tasks.find(t=>t.title==='实时同步验收册').id;
 });
 const albumId=await page.evaluate(id=>workshop.queue.tasks.find(t=>t.id===id).albumId,taskId);
 const total=await page.evaluate(id=>workshop.queue.tasks.find(t=>t.id===id).pages.length,taskId);
 const shelfBefore=await page.locator('#gallery-results [data-sort-book]').count();
 check(await page.evaluate(id=>!bookBy(id),albumId),'standby task has no album on the shelf yet');
 /* Start generation through the API (the confirm dialog is UI sugar) and just watch the shelf. */
 await page.evaluate(id=>productionRequest('start',{id,trusted:true}),taskId);
 await page.waitForFunction(id=>document.querySelector(`#gallery-results [data-sort-book="${id}"]`),albumId,{timeout:30000});
 check(true,'album tile appears on the shelf while the queue is still producing, without clicking 查看画册');
 check(await page.locator('#gallery-results [data-sort-book]').count()===shelfBefore+1,'exactly one new tile was added');
 check(await page.evaluate(()=>globalThis.__reloads===0),'no full workspace reload was needed');
 await page.screenshot({path:evidence+'/shelf-live.png',fullPage:false,animations:'disabled'});
 /* Open the reader mid-production and watch pages fill in while it stays open. */
 const seenBefore=await page.evaluate(id=>bookBy(id).steps.filter(s=>s.image).length,albumId);
 await page.evaluate(id=>openReader(id),albumId);await page.waitForFunction(()=>document.querySelector('#reader').open);
 await page.waitForFunction(id=>bookBy(id).steps.filter(s=>s.image).length===bookBy(id).totalSteps&&bookBy(id).status==='complete',albumId,{timeout:60000});
 check(await page.evaluate(()=>document.querySelector('#reader').open),'reader stayed open while the album completed');
 check(await page.evaluate(id=>ui.bookId===id,albumId),'reader still shows the same album');
 const rendered=await page.evaluate(()=>document.querySelectorAll('#reader-canvas .room-page img[data-page-img]').length);
 check(rendered===total,`all ${total} pages are rendered inside the open reader (was ${seenBefore} when opened)`);
 check(await page.evaluate(()=>document.querySelectorAll('#reader-canvas [data-scroll-step]').length)===total,'webtoon keeps one article per scene');
 check(await page.evaluate(()=>globalThis.__reloads===0),'reader updates never triggered a full reload either');
 check(await page.evaluate(()=>ComfyComic.sync.runtime.previous.savedGalleries.find(x=>x.id===ui.bookId)?.steps.length===bookBy(ui.bookId).steps.length),'sync baseline mirrors the merged album, so autosave writes no spurious delta');
 await page.screenshot({path:evidence+'/reader-live.png',fullPage:false,animations:'disabled'});
 await page.evaluate(()=>closeArtReader());
 check(await page.evaluate(id=>document.querySelector(`#gallery-results [data-sort-book="${id}"] .status-label`)?.textContent.trim()!=='',albumId),'shelf status label reflects the finished album');
 /* Local, unsaved edits survive a live merge. */
 const merged=await page.evaluate(async id=>{const b=bookBy(id);b.title='我改过的标题';const before=b.steps.length;const report=await ComfyComic.fileLibrary.refreshAlbum(id);return {title:bookBy(id).title,steps:bookBy(id).steps.length,before,status:report.status}},albumId);
 check(merged.title==='我改过的标题'&&merged.steps===merged.before,'refreshAlbum keeps unsaved local edits while re-reading the server copy ('+merged.status+')');
 check(errors.length===0,'no page errors: '+errors.join(' | '));
 console.log(`\n${checks} checks passed`);
}finally{await browser?.close();server.kill();fs.rmSync(dir,{recursive:true,force:true})}
