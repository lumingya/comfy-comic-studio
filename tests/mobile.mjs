// Isolated layout and interaction checks; never sends a model request.
import {chromium,webkit} from 'playwright';
const engine=process.env.MIO_MOBILE_BROWSER||process.argv[2]||'chromium';
import {spawn} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=mkdtempSync(path.join(tmpdir(),'mio-mobile-'));
for(const name of ['providers','mio_jobs.py','mio_frame_jobs.py','mio_channels.py','mio_contracts.py','mio_foundation.py','server.py','mio_api.py','mio_credentials.py','mio_docs.py','index.html','styles.css','favicon.svg','vendor','js','docs'])cpSync(path.join(root,name),path.join(temp,name),{recursive:true});
const server=spawn('python',['-u','server.py'],{cwd:temp,env:{...process.env,MIO_PORT:'8799'},stdio:['ignore','pipe','pipe']});let browser,checks=0;const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log('PASS '+name)};
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('物理落盘')){clearTimeout(t);resolve()}});server.on('error',reject)});
 browser=await ({chromium,webkit})[engine].launch({args:engine==='chromium'?['--no-sandbox']:[],...(process.platform==='linux'?{env:{...process.env,LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}}:{})});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https:\/\//,r=>r.abort());await page.goto('http://127.0.0.1:8799');await page.waitForFunction(()=>!rt.booting);


 await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.settings.identity.onboarded=true});
 for(const [width,height] of [[320,740],[390,844],[430,932],[844,390]]){
  await page.setViewportSize({width,height});
  for(const [name,route,tab] of [['gallery',0,''],['story',1,'story'],['queue',1,'queue'],['variables',1,'settings'],['engine',3,''],['settings',5,'general'],['storage',5,'connections'],['appearance',5,'appearance']]){
   await page.evaluate(({route,tab})=>{navigate(route);if(route===1)createUI.tab=tab;if(route===5)studioUI.settingsTab=tab;if(route===3){const g=ensureImageProviders();g.active=g.profiles.find(p=>p.provider==='openai').id}render()}, {route,tab});
   check(width+' x '+height+' '+name+' fits with bottom navigation',await page.evaluate(()=>{const main=$('#main').getBoundingClientRect(),nav=$('#sidebar').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth+2&&main.left<20&&nav.width>=innerWidth-2&&nav.bottom<=innerHeight+1&&nav.top>innerHeight-110}));
  }
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('#sidebar [data-route="1"]').tap();
 check('touch navigation opens creation with a horizontal title',await page.evaluate(()=>ui.workspace===1&&$('.quiet-create-head h1').getBoundingClientRect().height<65));
 check('primary controls are comfortable touch targets',await page.evaluate(()=>[...document.querySelectorAll('#sidebar .nav-item,.quiet-create-head .btn')].every(el=>el.getBoundingClientRect().height>=44)));
 await page.locator('[data-act="art-create-tab"][data-tab="story"]').tap();await page.locator('#frame-prompt').fill('手机分镜草稿，旋转屏幕也不丢失。');
 await page.setViewportSize({width:844,height:390});await page.setViewportSize({width:390,height:844});
 check('rotation keeps the current prompt draft',await page.locator('#frame-prompt').inputValue()==='手机分镜草稿，旋转屏幕也不丢失。');
 await page.locator('[data-act="art-create-tab"][data-tab="settings"]').tap();
 await page.locator('[data-act="art-setting-add"]').tap();await page.locator('#art-new-setting-key').fill('手机图片');await page.locator('#art-new-setting-label').fill('手机图片');await page.locator('#art-new-setting-type').selectOption('image');
 check('variable modal and inputs fit the phone',await page.evaluate(()=>{const r=$('#modal').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&parseFloat(getComputedStyle($('#art-new-setting-key')).fontSize)>=16}));
 await page.locator('[data-act="art-setting-confirm"]').tap();
 await page.locator('[data-image-key="手机图片"] input').setInputFiles({name:'phone.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 await page.waitForFunction(()=>selectedPlan().variables.find(v=>v.key==='手机图片')?.value?.src?.startsWith('/images/'));
 check('phone image upload produces a durable local asset',await page.evaluate(()=>selectedPlan().variables.find(v=>v.key==='手机图片').value.kind==='mio-image'));
 await page.evaluate(()=>{navigate(3);const g=ensureImageProviders();g.active=g.profiles.find(p=>p.provider==='openai').id;render()});
 await page.route('**/api/image/models',r=>r.fulfill({json:{models:['gpt-image-1','gpt-image-2.5-sunburst','flux-dev',...Array.from({length:229},(_,i)=>'other-'+i)]}}));
 await page.locator('[data-act="image-provider-models"]').tap();await page.waitForFunction(()=>imageProviderUI.models.get(imageModelsCacheKey(activeImageProfile()))?.length===232);
 await page.locator('#image-provider-model-input').fill('gpt');
 check('touch model suggestions stay in the visible viewport',await page.evaluate(()=>{const r=$('#image-provider-model-results').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight-80}));
 await page.locator('#image-provider-model-results [data-model="gpt-image-1"]').evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:91,pointerType:'touch',clientX:100,clientY:100}));el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:91,pointerType:'touch',clientX:100,clientY:135}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:91,pointerType:'touch',clientX:100,clientY:135}))});
 check('scroll-like touch movement does not pick a model',await page.locator('#image-provider-model-input').inputValue()==='gpt');
 await page.locator('#image-provider-model-results [data-model="gpt-image-2.5-sunburst"]').tap();
 check('touch selection replaces the model input without a second tap',await page.locator('#image-provider-model-input').inputValue()==='gpt-image-2.5-sunburst'&&await page.locator('#image-provider-model-results').isHidden());
 await page.evaluate(()=>{state.queue=[];const p=selectedPlan();enqueuePlanSnapshot(p);enqueuePlanSnapshot(p);navigate(1);createUI.tab='queue';render()});
 const first=await page.evaluate(()=>state.queue[0].id);
 await page.locator('.ordered-task').first().locator('[data-act="org-task-down"]').tap();
 check('touch buttons reorder waiting jobs without drag gestures',await page.evaluate(id=>state.queue[1].id===id,first));
 check('populated queue cards fit the phone',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2&&[...document.querySelectorAll('.task-actions .ibtn')].every(el=>el.getBoundingClientRect().height>=44)));
 await page.locator('.ordered-task').last().locator('[data-act="org-task-delete"]').tap();await page.locator('#confirm-no').tap();
 check('canceling deletion retains the queued work',await page.evaluate(()=>state.queue.length===2));
 await page.locator('#sidebar [data-route="0"]').tap();
 await page.locator('[data-act="book-menu"]').first().tap();
 check('album management opens by touch and stays above navigation',await page.evaluate(()=>{const r=$('#book-context-menu').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<$('#sidebar').getBoundingClientRect().top}));
 const albumOrder=await page.evaluate(()=>getShelfBooks().map(b=>b.id));
 await page.locator('[data-act="org-context-down"]').tap();
 check('album order changes via touch menu',await page.evaluate(ids=>getShelfBooks()[1].id===ids[0],albumOrder));
 await page.evaluate(()=>{const b=state.books.find(b=>b.steps.some(s=>s.image));b.steps=b.steps.filter(s=>s.image).slice(0,1);b.totalSteps=1;b.generatedSteps=1;b.status='complete';const first=getShelfBooks()[0];if(b.id!==first.id)reorderCollectionBook(b.id,first.id);ui.bulk=false;ui.selected.clear();navigate(0);render()});
 await page.locator('[data-act="read"]').first().tap();
 check('reader fits and preserves complete-image mode',await page.evaluate(()=>{const r=$('#reader').getBoundingClientRect();return r.width<=innerWidth+1&&r.height<=innerHeight+1&&artUI.readerMode==='gallery'}));
 await page.locator('#reader-canvas img').evaluate(img=>img.decode());
 check('phone reader displays the entire image within its canvas',await page.evaluate(()=>{const img=$('#reader-canvas img'),a=img.getBoundingClientRect(),b=$('#reader-canvas').getBoundingClientRect();return getComputedStyle(img).objectFit==='contain'&&a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1}));
 await page.locator('.presentation-trigger').tap();await page.locator('#presentation-search').fill('完整');
 check('reader template drawer is scrollable and within viewport',await page.evaluate(()=>{const r=$('#presentation-drawer').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>0&&r.bottom<=innerHeight}));
 const downloading=page.waitForEvent('download');await page.locator('[data-act="presentation-export"]').tap();const download=await downloading;
 check('phone export produces an HTML download',download.suggestedFilename().endsWith('.html')&&await download.failure()===null&&/<!doctype html>/i.test(readFileSync(await download.path(),'utf8')));
 await page.locator('#presentation-drawer [data-act="presentation-panel"]').tap();await page.locator('[data-act="close-reader"]').tap();
 await page.locator('.assistant-launch').tap();await page.locator('#chat-input').fill('手机输入');await page.locator('#chat-input').press('Enter');
 check('mobile Enter inserts a newline instead of sending',await page.locator('#chat-input').inputValue()==='手机输入\n'&&await page.evaluate(()=>!rt.chatBusy));
 await page.setViewportSize({width:390,height:480});await page.waitForFunction(()=>{const r=$('#assistant').getBoundingClientRect(),b=$('[data-act="send-chat"]',$('#assistant')).getBoundingClientRect();return b.top>=r.top&&b.bottom<=r.bottom+1&&b.right<=innerWidth&&r.bottom<=innerHeight},{},{timeout:5000});
 check('short viewport keeps assistant input and send button accessible',await page.evaluate(()=>{const r=$('#assistant').getBoundingClientRect(),b=$('[data-act="send-chat"]',$('#assistant')).getBoundingClientRect();return b.top>=r.top&&b.bottom<=r.bottom+1&&b.right<=innerWidth&&r.bottom<=innerHeight}));
 check('draft remains after viewport resizing',await page.locator('#chat-input').inputValue()==='手机输入\n');
 await page.locator('[data-act="assistant-close"]').tap();
 await page.setViewportSize({width:390,height:844});
 await page.locator('#project-switch-button').tap();
 check('collection switcher fits and remains usable on touch',await page.evaluate(()=>{const r=$('#project-popover').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}));
 await page.evaluate(()=>closeProjectPopover());
 check('no uncaught browser errors',!errors.length);console.log(checks+' mobile checks passed ('+engine+').');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(temp,{recursive:true,force:true})}
