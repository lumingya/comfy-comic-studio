/* Scene actions use a controlled provider; never call a real model. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mio-scene-ui-'));
const port=18779,url=`http://127.0.0.1:${port}`;
fs.cpSync('data',dir,{recursive:true});
const log=fs.openSync(path.join(dir,'server.log'),'w');
const server=spawn('python',['tests/production_fixture_server.py'],{env:{...process.env,MIO_DATA_DIR:dir,MIO_PORT:String(port),MIO_HOST:'127.0.0.1',MIO_NO_BROWSER:'1'},stdio:['ignore',log,log]});
let browser,checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS',label)};
try {
  for(let i=0;i<100;i++){try{if((await fetch(url+'/api/content')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>globalThis.Mio&&state.templates.length);
  check(await page.evaluate(()=>state.exportTemplates.length>0&&state.exportTemplates.every(t=>validateExportTemplate(t))),'all shipped loop-based templates pass validation');
  check(await page.evaluate(()=>{
    const t=clone(state.exportTemplates[0]);
    for(const html of [t.html.replace('</head>','<script>alert(1)</script></head>'),t.html.replace('{{#frames}}',''),t.html.replace('<body','<body onload="alert(1)"')]){
      try{validateExportTemplate({...t,html});return false}catch{}
    }
    return true;
  }),'template validation still rejects scripts, events and broken loops');
  const id=await page.evaluate(async()=>{
    await connectPythonBackend();
    state.settings.imageGeneration.profiles.push({id:'controlled',title:'测试渠道',provider:'openai',model:'fixture',baseUrl:'https://controlled.invalid/v1',keyMode:'none',protocol:'images'});
    save();if(!await savePythonWorkspace())throw Error('Save failed: '+ComfyComic.sync.runtime.error);
    await productionRequest('assemble',{requestId:'scene-ui',title:'分幕交互测试',projectId:state.activeProjectId,storyId:projectTemplates()[0].id,presets:projectVariableSets().map(p=>({id:p.id,kind:p.category==='scenes'?'scenes':'characters'})),channelId:'controlled',seed:1});
    await refreshProduction();navigate(1);workshop.view='production';
    const t=workshop.queue.tasks.at(-1);workshop.openTasks.add(t.id);render();return t.id;
  });
  const card=page.locator(`[data-production-task="${id}"]`);
  const row=index=>card.locator(`.production-page[data-page-index="${index}"]`);
  check(await row(4).getByRole('button',{name:'单幕生成',exact:true}).count()===1,'untouched scene offers generation, not rerun');
  check(await row(4).getByRole('button',{name:'从此幕往后生成',exact:true}).count()===1,'untouched suffix offers generation');
  check(await card.locator('.production-page-preview').count()===0,'no preview action without an image');
  check(await page.evaluate(id=>productionPageContextItems(workshop.queue.tasks.find(t=>t.id===id),workshop.queue.tasks.find(t=>t.id===id).pages[4]).some(x=>x?.label==='单幕生成'),id),'context menu agrees with first-run button');
  await row(4).getByRole('button',{name:'单幕生成',exact:true}).click();
  check((await page.locator('#confirm-dialog').innerText()).includes('确认局部生成？'),'first-run confirmation does not say rerun');
  await page.locator('#confirm-yes').click();
  await page.waitForFunction(id=>workshop.queue.tasks.find(t=>t.id===id)?.pages[4].state==='complete',id);
  const calls=()=>JSON.parse(fs.readFileSync(path.join(dir,'controlled-calls.json'))).length;
  await row(4).getByRole('button',{name:'单幕重跑',exact:true}).waitFor();
  check(calls()===1,'single-scene generation calls provider once');
  check(await row(4).getByRole('button',{name:'单幕重跑',exact:true}).count()===1,'completed scene offers rerun');
  check(await row(5).getByRole('button',{name:'单幕生成',exact:true}).count()===1,'neighbour still offers first generation');
  check(await row(3).getByRole('button',{name:'从此幕往后重跑',exact:true}).count()===1,'mixed suffix warns that it will rerun existing output');
  check(await row(5).getByRole('button',{name:'从此幕往后生成',exact:true}).count()===1,'untouched suffix still offers generation');
  const image=await page.evaluate(id=>workshop.queue.tasks.find(t=>t.id===id).pages[4].result.image,id);
  await row(4).getByRole('button',{name:'查看第 5 幕图片',exact:true}).click();
  check(await page.locator('#modal-body img').getAttribute('src')===image,'thumbnail opens original image for the selected scene');
  check(await page.locator('#modal-title').innerText()==='分幕交互测试 · 第 5 幕','preview names the correct scene');
  check(!await page.locator('#reader').evaluate(el=>el.open),'preview does not open the album reader');
  check(calls()===1,'viewing an image makes no generation request');
  await page.locator('#modal [data-act="close-modal"]').click();
  await page.waitForFunction(()=>!document.querySelector('#modal').open);
  await row(4).locator('.production-page-preview').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#modal').open);
  check(await page.locator('#modal').evaluate(el=>el.open),'preview is keyboard accessible');
  await page.evaluate(()=>closeModal());
  await row(4).getByRole('button',{name:'单幕重跑',exact:true}).click();
  check((await page.locator('#confirm-dialog').innerText()).includes('确认局部重跑？'),'rerun confirmation retains warning');
  await page.locator('#confirm-yes').click();
  await page.waitForFunction(id=>{const p=workshop.queue.tasks.find(t=>t.id===id)?.pages[4];return p?.state==='complete'&&p.attemptCount===2},id);
  await row(4).locator('.production-page-preview').waitFor();
  check(calls()===2,'rerun only submits the selected scene');
  const edge=await page.evaluate(id=>{
    const t=workshop.queue.tasks.find(t=>t.id===id),p=t.pages[4];
    const failed={...p,state:'failed'},locked={...workshop.queue,active:t.id,batch:[t.id]};
    const access=productionTaskAccess(t,locked),html=renderProductionPage(t,failed,access);
    const holder=document.createElement('div');holder.innerHTML=html;
    return {previewEnabled:!holder.querySelector('[data-act="production-page-preview"]').disabled,rerunDisabled:holder.querySelector('[data-act="production-rerun"]').disabled,failedLabel:productionPageLabels(t,failed).single,cancelledLabel:productionPageLabels(t,{...p,state:'standby'}).single,menu:productionPageContextItems(t,failed,access).find(x=>x?.act==='production-page-preview')?.disabled!==true};
  },id);
  check(edge.previewEnabled&&edge.rerunDisabled&&edge.menu,'retained image remains viewable while generation is locked');
  check(edge.failedLabel==='单幕重跑'&&edge.cancelledLabel==='单幕重跑','failed or reset scenes with history remain reruns');
  await page.setViewportSize({width:390,height:844});
  await row(4).locator('.production-page-preview').click();
  check(await page.locator('#modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'mobile preview has no horizontal overflow');
  await page.evaluate(()=>closeModal());
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile queue has no horizontal overflow');
  check(errors.length===0,'no browser runtime errors: '+errors.join('; '));
  console.log(`SCENE UI: ${checks} checks passed`);
} finally {
  await browser?.close();server.kill();fs.closeSync(log);fs.rmSync(dir,{recursive:true,force:true});
}
