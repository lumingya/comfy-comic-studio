/* Current workspaces, not the retired createUI/ordered-task interface.
 * Isolated empty data directory; all external browser traffic blocked.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';
export async function runAudit({mobile=false,engine='chromium'}={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mio-audit-')),port=mobile?18837:18836,base=`http://127.0.0.1:${port}`;
 const log=fs.openSync(path.join(temp,'server.log'),'w');
 const server=spawn('python',['-u','server.py'],{env:{...process.env,MIO_DATA_DIR:path.join(temp,'fresh'),MIO_HOST:'127.0.0.1',MIO_PORT:String(port)},stdio:['ignore',log,log]});
 let browser,count=0;const check=(value,label)=>{assert.ok(value,label);console.log('PASS '+label);count++};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/content')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'fresh-directory startup');
  browser=await ({chromium,webkit}[engine]).launch({args:engine==='chromium'?['--no-sandbox']:[]});
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
  await context.addInitScript(()=>{window.auditLegacyWrites=[];window.auditLegacyReads=[];window.auditLegacyDB=[];const get=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k==='cc-project')window.auditLegacyReads.push(k);return get.call(this,k)};const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='cc-project')window.auditLegacyWrites.push(k);return set.call(this,k,v)};const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...args){window.auditLegacyDB.push(name);return open.call(this,name,...args)}});
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route(/^https?:\/\//,route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await p.goto(base);await p.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);
  await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  check(await p.evaluate(()=>state.books.length>0&&state.templates.length>0),'fresh external directory receives verified shipped resources');
  check(await p.evaluate(()=>state.settings.presentation.fonts===false&&!document.querySelector('link[href*="fonts.googleapis"]')),'external fonts are opt-in, no automatic remote stylesheet');
  for(const size of mobile?[{width:390,height:844},{width:430,height:932},{width:844,height:390}]:[{width:1440,height:1000}]){
   await p.setViewportSize(size);
   for(const [route,view] of [[0,null],[1,'stories'],[1,'presets'],[1,'production'],[7,null],[3,null],[5,null],[0,null]]){
    await p.evaluate(({route,view})=>{if(view)workshop.view=view;navigate(route);render()},{route,view});
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),`${size.width}px workspace ${route}/${view||''}: navigation and width`);
   }
  }
  await p.evaluate(()=>{workshop.view='stories';navigate(1);render()});
  if(mobile){
   /* Phones show the scene-card stream; the editor is a full-screen focus layer that follows the visual viewport. */
   await p.setViewportSize({width:390,height:844});await p.evaluate(()=>render());await p.waitForTimeout(200);
   check(await p.evaluate(()=>document.querySelectorAll('.wm-card').length===workshopStory().frames.length&&!document.querySelector('.wm-focus')),'mobile storyboard renders one card per scene without an open editor');
   await p.locator('.wm-card').first().click();await p.waitForSelector('.wm-focus [data-workshop-frame="prompt"]');await p.waitForTimeout(400);
   check(await p.evaluate(()=>{const l=document.querySelector('.wm-focus'),r=l.getBoundingClientRect();return Math.abs(r.top)<1&&Math.abs(r.height-innerHeight)<2&&document.documentElement.classList.contains('wm-focus-open')}),'mobile focus editor covers the visual viewport');
   check(await p.evaluate(()=>[...document.querySelectorAll('.wm-focus-head .ibtn,.wm-focus-actions .btn')].every(b=>b.getBoundingClientRect().height>=48)),'mobile focus editor controls are at least 48px tall');
   check(await p.evaluate(()=>[...document.querySelectorAll('.wm-focus textarea,.wm-focus input[data-workshop-frame="name"]')].every(t=>parseFloat(getComputedStyle(t).fontSize)>=15)),'mobile editors use 15–16px text so iOS does not zoom');
   check(await p.evaluate(()=>document.querySelector('.wm-focus-title strong').textContent.includes('1')&&document.querySelector('.wm-focus-title strong').textContent.includes(String(workshopStory().frames.length))),'mobile focus editor shows「第 N 幕 / 共 M 幕」');
   await p.evaluate(()=>{const fake={height:innerHeight-360,offsetTop:0,scale:1,width:innerWidth,addEventListener(){},removeEventListener(){}};Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>fake})});
   await p.locator('.wm-focus [data-workshop-frame="caption"]').focus();await p.evaluate(()=>window.dispatchEvent(new Event('resize')));await p.waitForTimeout(900);
   check(await p.evaluate(()=>{const l=document.querySelector('.wm-focus'),r=l.getBoundingClientRect(),chips=document.querySelector('.wm-chips'),c=chips.getBoundingClientRect(),ta=document.activeElement.getBoundingClientRect();return Math.abs(r.height-(innerHeight-360))<2&&getComputedStyle(chips).display!=='none'&&Math.abs(c.bottom-r.bottom)<2&&getComputedStyle(document.querySelector('.wm-focus-actions')).display==='none'&&ta.bottom<=c.top+1}),'with the keyboard open the editor shrinks to the visual viewport, chips sit above the keyboard and the focused field stays visible');
   await p.locator('.wm-chips [data-wm-insert="{style}"]').dispatchEvent('pointerdown');
   check(await p.evaluate(()=>document.activeElement?.dataset.workshopFrame==='caption'&&document.activeElement.value.includes('{style}')&&workshopStory().frames[workshop.frame].caption.includes('{style}')),'variable chips insert at the caret without closing the keyboard and the draft is saved');
   await p.evaluate(()=>{delete window.visualViewport;window.dispatchEvent(new Event('resize'))});await p.waitForTimeout(300);
   await p.locator('[data-act="workshop-mobile-step"][data-dir="1"]').click();await p.waitForTimeout(250);
   check(await p.evaluate(()=>workshop.frame===1&&document.querySelector('.wm-focus-title strong').textContent.includes('2')),'next button moves to the second scene');
   await p.evaluate(()=>openWorkshopMobileEditor(0));await p.waitForTimeout(250);
  }
  const prompt=p.locator('[data-workshop-frame="prompt"]');await prompt.fill('跨工作区和轮询也应保留的草稿');await prompt.focus();
  check(await p.evaluate(()=>{const el=document.activeElement;el.setSelectionRange(2,6);el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'输入'}));render();const ok=document.activeElement===el&&el.isConnected&&el.selectionStart===2&&el.selectionEnd===6;el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return ok}),'IME editor identity, draft and selection survive patch');
  for(const [before,after] of [['<div>旧</div>','<p>新</p>'],['<span>旧</span>','新文本'],['旧文本','<span>新</span>'],['<!--旧--><b>x</b>','<i>y</i><!--新-->'],['<i data-id="a">a</i><i data-id="b">b</i>','<i data-id="b">b</i><i data-id="a">a</i>']]){
   check(await p.evaluate(({before,after})=>{const root=document.createElement('section');document.body.append(root);root.innerHTML=before;patchDOM(root,after);const ok=root.innerHTML===after;root.remove();return ok},{before,after}),'DOM types/comments/reorder: '+before);
  }
  for(const tag of ['input','textarea','select']){
   check(await p.evaluate(tag=>{const root=document.createElement('section'),markup=tag==='select'?'<select id="audit-field"><option>a</option><option>b</option></select>':`<${tag} id="audit-field">${tag==='textarea'?'original</textarea>':''}`;root.innerHTML='<div class="editor">'+markup+'</div>';document.body.append(root);const el=root.querySelector('#audit-field');el.focus();el.value=tag==='select'?'b':'local draft';patchDOM(root,'<div class="notice">同步</div><div class="editor">'+markup+'</div>');const ok=document.activeElement===el&&el.value===(tag==='select'?'b':'local draft')&&root.firstChild.className==='notice';root.remove();return ok},tag),'unkeyed insertion preserves focused '+tag);
  }
  for(const tag of ['input','textarea','select']){
   check(await p.evaluate(tag=>{const root=document.createElement('section'),markup=tag==='select'?'<select id="audit-reorder"><option>a</option><option>b</option></select>':`<${tag} id="audit-reorder">${tag==='textarea'?'original</textarea>':''}`;root.innerHTML='<div data-key="a">a</div><div data-key="edit">'+markup+'</div><div data-key="z">z</div>';document.body.append(root);const el=root.querySelector('#audit-reorder');el.focus();el.value=tag==='select'?'b':'local draft';patchDOM(root,'<div data-key="edit">'+markup+'</div><div data-key="z">z</div><div data-key="a">a</div>');const ok=document.activeElement===el&&el.value===(tag==='select'?'b':'local draft')&&[...root.children].map(x=>x.dataset.key).join(',')==='edit,z,a';root.remove();return ok},tag),'keyed reorder preserves focused '+tag);
  }
  check(await p.evaluate(()=>nativeEqual({a:1,b:{x:2,y:[1,2]}},{b:{y:[1,2],x:2},a:1})&&!nativeEqual({a:[1,2]},{a:[2,1]})),'structural comparison ignores object key order but preserves array order');
  check(await p.evaluate(()=>{const real=Date.now;try{workshop.serverEpochMs=200000;workshop.receivedAt=performance.now();Date.now=()=>9999999999999;return productionRetrySeconds({untilEpochMs:205000})===5}finally{Date.now=real}}),'rate-limit countdown uses server anchor despite client clock skew');
  check(await p.evaluate(()=>{const root=document.createElement('div');root.innerHTML=field('说明','<textarea></textarea><select><option>a</option></select><input>');return [...root.querySelectorAll('textarea,select,input')].every(x=>x.getAttribute('aria-label')==='说明')}),'field component labels every control, including textarea/select');
  const list=await p.evaluate(async()=>{const a=await request('/api/production/tasks'),tag=a.headers.get('etag');const b=await request('/api/production/tasks',{headers:{'If-None-Match':tag}});return {status:b.status,bytes:(await b.text()).length,tag}});
  check(list.status===304&&list.bytes===0&&list.tag,'unchanged task list is empty 304 response');
  check(await p.evaluate(async()=>{await refreshProduction();const original=render;let calls=0;render=function(...args){calls++;return original(...args)};try{await refreshProduction();return calls===0}finally{render=original}}),'unchanged queue poll skips render');
  await p.evaluate(async()=>{await persist(false)});
  check(await p.evaluate(()=>auditLegacyWrites.length===0&&auditLegacyReads.length===0&&!auditLegacyDB.includes('comfycomic-studio')),'HTTP path never reads/writes legacy project snapshots');
  for(const [method,route] of [['GET','/api/config?summaries=1'],['POST','/api/production/pause'],['OPTIONS','/api/config']]){
   const response=await context.request.fetch(base+route,{method,headers:{Origin:'null','Content-Type':'application/json'},...(method==='POST'?{data:{}}:{})});
   check(response.status()===403&&!response.headers()['access-control-allow-origin'],'opaque-origin '+method+' cannot read/control local service');
  }
  check(await p.evaluate(base=>new Promise(resolve=>{const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');const timer=setTimeout(()=>finish(false),5000);function finish(ok){clearTimeout(timer);window.removeEventListener('message',receive);frame.remove();resolve(ok)}function receive(e){if(e.source===frame.contentWindow&&e.data==='audit-private-denied')finish(true);if(e.source===frame.contentWindow&&e.data==='audit-private-leaked')finish(false)}window.addEventListener('message',receive);frame.srcdoc='<script>fetch('+JSON.stringify(base+'/api/config')+').then(r=>r.text()).then(()=>parent.postMessage("audit-private-leaked","*")).catch(()=>parent.postMessage("audit-private-denied","*"))<'+'/script>';document.body.append(frame)}),base),'real opaque sandbox cannot read private configuration');
  const missing=await context.request.get(base+'/api/config',{headers:{Origin:base}});check(missing.status()===403,'same-origin private browser request without capability is rejected');
  check(await p.evaluate(async()=>{const r=await fetch('/api/config?summaries=1');return r.status===200}),'legitimate UI fetch automatically carries private API capability');
  await p.evaluate(()=>{navigate(5);studioUI.settingsTab='appearance';render()});
  check(await p.locator('#allow-external-fonts').count()===1,'explicit font privacy switch is available in general preferences');
  await p.locator('#allow-external-fonts').check();check(await p.evaluate(()=>state.settings.presentation.fonts&&document.querySelectorAll('#collection-font-stylesheet,#art-font-stylesheet').length===2),'font opt-in explicitly installs both stylesheets (network blocked in test)');
  await p.locator('#allow-external-fonts').uncheck();check(await p.evaluate(()=>!state.settings.presentation.fonts&&!document.querySelector('#collection-font-stylesheet,#art-font-stylesheet')),'font opt-out removes remote stylesheet links');
  await p.evaluate(()=>{navigate(1);workshop.view='production';render()});
  if(mobile)check(await p.locator('.production-controls button').evaluateAll(nodes=>nodes.length>0&&nodes.every(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44})),'production touch targets are at least 44 by 44 pixels');
  check(await p.locator('.production-toolbar [data-act="production-sequence"],.production-toolbar [data-act="production-clear-finished"],.production-toolbar [data-production-concurrency="*"]').count()===3,'queue toolbar offers sequential start, clear-finished and the default page concurrency');
  check(await p.locator('[data-act="production-uncertain-filter"],[data-act="production-uncertain-export"],[data-act="production-batch"],[data-act="production-reprepare"]').count()===0,'retired queue controls are not rendered');
  await p.evaluate(()=>{navigate(0);render()});
  const first=p.locator('[data-act="read"]').first();await first.click();check(await p.locator('#reader').evaluate(x=>x.open),'current gallery opens the actual reader');await p.evaluate(()=>closeReader());
  const boot=await context.newPage();let failed=false;await boot.route('**/api/content',route=>{if(!failed){failed=true;return route.fulfill({status:503,json:{error:'controlled temporary startup failure'}})}return route.continue()});
  await boot.goto(base);await boot.getByRole('button',{name:'重试加载'}).click();await boot.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);check(await boot.locator('.bootstrap-error').count()===0,'startup error offers retry and recovers without clearing data');await boot.close();
  check(errors.length===0,'no uncaught browser exceptions: '+errors.join(';'));
  console.log(`AUDIT ${mobile?'MOBILE':'DESKTOP'}: ${count} checks PASS`);
 }finally{
  await browser?.close();if(server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done}
  fs.closeSync(log);fs.rmSync(temp,{recursive:true,force:true});
 }
}
