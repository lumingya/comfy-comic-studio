// Export image profiles through the real UI: ComfyUI workflow / prompt chunks must never leak out of a
// clean or publish export, archive must stay byte-identical, and 「自动」must fall back to publish instead of failing.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn,spawnSync}from'node:child_process';import{chromium}from'playwright';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mio-export-profiles-')),port=18823,base='http://127.0.0.1:'+port,evidence=process.env.MIO_EXPORT_EVIDENCE||'build/export-profiles';fs.cpSync('data',temp,{recursive:true});fs.mkdirSync(evidence,{recursive:true});
const log=fs.openSync(path.join(temp,'server.log'),'w'),server=spawn('python',['server.py'],{env:{...process.env,MIO_DATA_DIR:temp,MIO_PORT:String(port),MIO_HOST:'127.0.0.1'},stdio:['ignore',log,log]});let browser,count=0;const check=(value,label)=>{assert.ok(value,label);console.log('PASS',label);count++};
const SECRETS=['KSampler','TOPSECRET_PROMPT','secret-lora.safetensors'];
const leaks=buffer=>SECRETS.filter(s=>buffer.includes(s));
const inlineImages=html=>[...html.matchAll(/data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)/g)].map(m=>({mime:m[1],bytes:Buffer.from(m[2],'base64')}));
const unzip=file=>{const run=spawnSync('python',['-c','import base64,json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({n:(base64.b64encode(z.read(n)).decode() if n.startswith("images/") else len(z.read(n))) for n in z.namelist()}))',file],{encoding:'utf8',maxBuffer:256*1024*1024});if(run.status!==0)throw Error('unzip failed for '+file+': '+run.stderr);return JSON.parse(run.stdout)};
let downloads=0;async function download(p,act){await p.waitForFunction(()=>!studioUI.exportBusy);const waiting=p.waitForEvent('download');await p.locator(act).click();const file=await waiting;const out=path.join(temp,(++downloads)+'-'+file.suggestedFilename());await file.saveAs(out);await p.waitForFunction(()=>!studioUI.exportBusy);return out}
async function naturalSizes(html){const page=await browser.newPage();await page.goto('file://'+html);const sizes=await page.locator('img[src^="data:image/"]').evaluateAll(async imgs=>{imgs.forEach(i=>i.loading='eager');await Promise.all(imgs.map(i=>i.decode()));return imgs.map(i=>[i.naturalWidth,i.naturalHeight,i.src.slice(5,15)])});await page.close();return sizes}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/content')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({args:['--no-sandbox']});const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);await p.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);await p.evaluate(async()=>{await connectPythonBackend();state.settings.identity.onboarded=true;document.querySelectorAll('dialog[open]').forEach(d=>d.close())});
 // A ComfyUI-style PNG: real pixels plus the prompt / workflow tEXt chunks SaveImage writes, stored by the backend byte for byte.
 const fixture=await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=2048;c.height=1536;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,2048,1536);g.addColorStop(0,'#7ba184');g.addColorStop(1,'#f5d392');x.fillStyle=g;x.fillRect(0,0,2048,1536);let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;for(let i=0;i<400;i++){x.fillStyle=`hsl(${Math.floor(rnd()*360)} 60% ${30+rnd()*50}%)`;x.fillRect(rnd()*2048,rnd()*1536,20+rnd()*200,20+rnd()*200)}
  const {bytes}=dataURLBytes(c.toDataURL('image/png'));const workflow=pngChunk('tEXt',asciiBytes('workflow\0'+JSON.stringify({nodes:[{type:'KSampler',widgets_values:[123456789,'secret-lora.safetensors']}]}))),prompt=pngChunk('tEXt',asciiBytes('prompt\0'+JSON.stringify({3:{class_type:'CLIPTextEncode',inputs:{text:'TOPSECRET_PROMPT'}}})));
  const dirty=concatBytes([bytes.subarray(0,33),workflow,prompt,bytes.subarray(33)]);const a=await foundationRequest('assets/upload',{dataUrl:await blobData(new Blob([dirty],{type:'image/png'}))});
  const b={id:uid('book'),projectId:state.activeProjectId,title:'导出图片处理验收',rowId:selectedPlan().rowId,templateId:selectedPlan().templateId,characterName:'验收',templateTitle:'原图测试',synopsis:'用于验收',tags:[],createdAt:Date.now(),updatedAt:Date.now(),totalSteps:3,generatedSteps:3,status:'complete',steps:Array.from({length:3},(_,i)=>({stepIndex:i,name:'原图 '+i,prompt:'safe',caption:'完整画面',image:a.url}))};
  state.books.push(b);save();if(!await savePythonWorkspace())throw Error('fixture save failed');openReader(b.id);return {book:b.id,url:a.url,size:dirty.length}});
 const stored=Buffer.from(await (await fetch(base+fixture.url)).arrayBuffer());check(stored.length===fixture.size&&leaks(stored).length===3,'backend stores the ComfyUI original untouched, workflow and prompt included');
 await p.locator('[data-act="presentation-open-export"]').click();await p.locator('#presentation-drawer details.presentation-options summary').click();await p.locator('#export-image-profile').waitFor();
 check(await p.locator('#export-image-profile').inputValue()==='auto'&&await p.locator('#export-image-profile option').count()===4,'presentation drawer offers the four image profiles with 自动 selected by default');
 await p.locator('#export-image-profile').scrollIntoViewIfNeeded();await p.locator('#presentation-drawer').screenshot({path:path.join(evidence,'drawer.png'),animations:'disabled'});
 // Default (auto -> clean): same pixels and resolution, zero private metadata.
 const cleanHTML=await download(p,'[data-act="presentation-export"]');const cleanImages=inlineImages(fs.readFileSync(cleanHTML,'utf8'));
 check(cleanImages.length>=3&&cleanImages.every(i=>i.mime==='image/png'&&leaks(i.bytes).length===0),'default single-file HTML inlines PNGs with workflow and prompt chunks removed');
 check(cleanImages.every(i=>i.bytes.length<fixture.size&&i.bytes.length>fixture.size*0.8),'cleaned PNGs shrink only by the metadata, pixels are re-used verbatim');
 check((await naturalSizes(cleanHTML)).filter(([,,kind])=>kind.startsWith('image/png')).every(([w,h])=>w===2048&&h===1536),'cleaned images still decode at the original 2048 × 1536');
 const cleanStatus=await p.locator('#export-status').innerText();check(cleanStatus.includes('已移除 3 张图片的工作流 / 提示词元数据')&&cleanStatus.includes('原图分辨率与编码未改动'),'status explains that 3 images were scrubbed and nothing was recompressed');
 // Archive: byte-identical originals, workflow included, clearly labelled.
 await p.selectOption('#export-image-profile','archive');check(await p.evaluate(()=>studioUI.exportDraft.imageProfile==='archive')&&(await p.locator('#export-image-profile-help').innerText()).includes('不要直接分发'),'choosing 无损归档 updates the draft and warns against distributing it');
 const archiveHTML=await download(p,'[data-act="presentation-export"]');const archiveImages=inlineImages(fs.readFileSync(archiveHTML,'utf8'));
 check(archiveImages.length>=3&&archiveImages.every(i=>i.bytes.equals(stored)),'archive HTML embeds the stored original byte for byte, workflow included');
 check((await p.locator('#export-status').innerText()).includes('无损归档'),'archive status says the workflow metadata is still inside');
 // Publish: WebP, no metadata, same dimensions under the 2560 px cap, much smaller.
 await p.selectOption('#export-image-profile','publish');const publishHTML=await download(p,'[data-act="presentation-export"]');const publishImages=inlineImages(fs.readFileSync(publishHTML,'utf8'));
 check(publishImages.length>=3&&publishImages.every(i=>i.mime==='image/webp'&&leaks(i.bytes).length===0&&i.bytes.length<stored.length/2),'publish HTML inlines metadata-free WebP at less than half the original size');
 check((await naturalSizes(publishHTML)).filter(([,,kind])=>kind.startsWith('image/webp')).every(([w,h])=>w===2048&&h===1536),'publish keeps 2048 × 1536 because it is under the 2560 px long-edge cap');
 const sizes={clean:fs.statSync(cleanHTML).size,publish:fs.statSync(publishHTML).size,original:fixture.size,cleanImage:cleanImages[0].bytes.length,publishImage:publishImages[0].bytes.length};
 check(sizes.publish<sizes.clean/2,'published single file is at least twice as small as the lossless one: '+JSON.stringify(sizes));
 check((await p.locator('#export-status').innerText()).includes('轻量发布：3 张重新编码为 WebP'),'publish status reports the recompression');
  // 「自动」: lossless whenever it fits, publish when the single-file budget would otherwise be exceeded.
  const auto=await p.evaluate(async id=>{const t=exportTemplateBy(presentationUI.templateId);const clean=await prepareExportBooks([id],t,null,null,{imageProfile:'clean'}),publish=await prepareExportBooks([id],t,null,null,{imageProfile:'publish'});const budget=Math.floor((clean.stats.inlineBytes+publish.stats.inlineBytes)/2);const fallback=await prepareExportBooks([id],t,null,null,{imageProfile:'auto',inlineBudget:budget});const fits=await prepareExportBooks([id],t,null,null,{imageProfile:'auto',inlineBudget:clean.stats.inlineBytes+1});const overBudgets={};for(const profile of ['clean','publish']){const res=await prepareExportBooks([id],t,null,null,{imageProfile:profile,inlineBudget:publish.stats.inlineBytes-1});overBudgets[profile]=res.stats}return {clean:clean.stats,publish:publish.stats,fallback:fallback.stats,fits:fits.stats,webp:fallback.books[0].steps.every(s=>s.image.startsWith('data:image/webp')),overBudgets}},fixture.book);
  check(auto.fallback.profile==='publish'&&auto.fallback.autoCompressed&&auto.webp&&auto.fallback.recompressed===3,'自动 retries the whole book as 轻量发布 when the lossless pass exceeds the budget');
  check(auto.fits.profile==='clean'&&!auto.fits.autoCompressed&&auto.fits.scrubbed===3&&auto.fits.recompressed===0,'自动 stays lossless when the cleaned book fits');
  check(auto.overBudgets.clean.overBudget&&auto.overBudgets.clean.budgetWarning.includes('轻量发布')&&auto.overBudgets.publish.overBudget&&auto.overBudgets.publish.budgetWarning.includes('ZIP'),'explicit profiles warn with profile-aware guidance instead of silently degrading or failing');
 // ZIP and PDF from the same drawer follow the same selector through the backend.
 const publishZip=unzip(await download(p,'[data-act="portable-export"][data-format="zip"]'));
 const zipImages=zip=>Object.keys(zip).filter(n=>n.startsWith('images/'));
 check(zipImages(publishZip).join()==='images/001-0001.webp,images/001-0002.webp,images/001-0003.webp'&&zipImages(publishZip).every(n=>leaks(Buffer.from(publishZip[n],'base64')).length===0)&&Object.keys(publishZip).includes('index.html'),'publish ZIP ships metadata-free WebP frames plus the offline reader');
 await p.selectOption('#export-image-profile','archive');const archiveZip=unzip(await download(p,'[data-act="portable-export"][data-format="zip"]'));
 check(Buffer.from(archiveZip['images/001-0001.png'],'base64').equals(stored),'archive ZIP keeps the original PNG bytes including the workflow');
 await p.selectOption('#export-image-profile','clean');const cleanZip=unzip(await download(p,'[data-act="portable-export"][data-format="zip"]'));const cleanZipPng=Buffer.from(cleanZip['images/001-0001.png'],'base64');
 check(leaks(cleanZipPng).length===0&&cleanZipPng.length<stored.length&&cleanZipPng.equals(cleanImages[0].bytes),'clean ZIP PNG is byte-identical to what the browser inlined: both scrubbers agree');
 const pdf=fs.readFileSync(await download(p,'[data-act="portable-export"][data-format="pdf"]'));check(pdf.subarray(0,5).toString()==='%PDF-'&&leaks(pdf).length===0,'clean PDF carries no workflow or prompt text');
 check((await p.locator('#export-status').innerText()).includes('已清洗工作流元数据'),'portable export status names the applied profile');
 // Multi-book export hub carries the same control; English interface translates it.
 await p.evaluate(()=>closeReader());await p.evaluate(id=>showExportHub([state.books.find(b=>b.id!==id).id,id]),fixture.book);await p.locator('#export-hub-root #export-image-profile').waitFor();
 check(await p.locator('#export-hub-root #export-image-profile').inputValue()==='auto','multi-book export hub shows the same image-processing selector');
 await p.screenshot({path:path.join(evidence,'export-hub.png'),animations:'disabled'});
 await p.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close())});await p.locator('#sidebar [data-act="art-nav"][data-route="5"]').click();await p.locator('[data-act="v3-settings-tab"][data-tab="appearance"]').click();await p.locator('#interface-language').selectOption('en');await p.waitForFunction(()=>document.documentElement.lang==='en');
 await p.evaluate(id=>showExportHub([state.books.find(b=>b.id!==id).id,id]),fixture.book);await p.locator('#export-hub-root #export-image-profile').waitFor();
 const english=await p.evaluate(()=>{const select=document.querySelector('#export-hub-root #export-image-profile');return {options:[...select.options].map(o=>o.textContent),help:document.querySelector('#export-image-profile-help').textContent,label:select.closest('.field')?.textContent||select.parentElement.textContent}});
 check(!/[\u3400-\u9fff]/.test(english.options.join()+english.help+english.label)&&english.options[0].startsWith('Auto'),'profile labels, help and field title are translated in the English interface');
 check(errors.length===0,'no uncaught browser errors: '+errors.join(' | '));
 console.log('EXPORT PROFILES: '+count+' checks PASS');
}finally{await browser?.close();server.kill();fs.closeSync(log);fs.rmSync(temp,{recursive:true,force:true})}
