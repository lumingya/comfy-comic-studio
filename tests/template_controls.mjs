// Isolated layout and interaction checks; never sends a model request.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=mkdtempSync(path.join(tmpdir(),'mio-template-'));
for(const name of ['server.py','mio_api.py','mio_credentials.py','mio_docs.py','index.html','styles.css','favicon.svg','vendor','js','docs'])cpSync(path.join(root,name),path.join(temp,name),{recursive:true});
const server=spawn('python',['-u','server.py'],{cwd:temp,env:{...process.env,MIO_PORT:'8797'},stdio:['ignore','pipe','pipe']});let browser,checks=0;const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log('PASS '+name)};
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('物理落盘')){clearTimeout(t);resolve()}});server.on('error',reject)});
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1568,height:1004}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https:\/\//,r=>r.abort());await page.goto('http://127.0.0.1:8797');await page.waitForFunction(()=>!rt.booting);

 await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());navigate(1);createUI.tab='story';render()});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);check('template toolbar fits the mobile viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.setViewportSize({width:1568,height:1004});
 const sourceId=await page.evaluate(()=>selectedPlan().templateId),booksBefore=await page.evaluate(()=>JSON.stringify(state.books));
 check('template deletion is directly beside the template picker',await page.locator('[data-act="delete-storyboard-template"]').isVisible());
 for(const provider of ['novelai','openai']){
  await page.evaluate(provider=>{const g=ensureImageProviders();let p=g.profiles.find(p=>p.provider===provider);if(!p){p={id:'test-'+provider,provider,title:provider,baseUrl:'https://example.invalid',model:'test',keyMode:'none'};g.profiles.push(p)}g.active=p.id;render()},provider);
  check(provider+' scene workflow is noninteractive explanatory text',await page.evaluate(()=>$('#ws-scene-workflow').tagName==='DIV'&&$('#ws-scene-workflow').getAttribute('role')==='note'&&$('#ws-scene-workflow').tabIndex===-1&&!$('[data-act="ws-edit-scene-workflow"]')));
  await page.locator('[data-act="art-create-tab"][data-tab="queue"]').click();
  check(provider+' queue workflow has no select or dropdown decoration',await page.evaluate(()=>$('#ws-plan-workflow').tagName==='DIV'&&getComputedStyle($('#ws-plan-workflow')).backgroundImage==='none'));
  await page.locator('[data-act="art-create-tab"][data-tab="story"]').click();
  check(provider+' partial storyboard render stays noninteractive',await page.evaluate(()=>{const host=document.createElement('div');host.innerHTML=sceneAssignmentHTML(selectedPlan(),currentTemplate().frames[0]);return host.querySelector('#ws-scene-workflow').tagName==='DIV'&&!host.querySelector('[data-act="ws-edit-scene-workflow"]')}));
 }
 await page.evaluate(()=>{ensureImageProviders().active=ensureImageProviders().profiles.find(p=>p.provider==='comfyui').id;render()});
 check('switching back to ComfyUI restores scene selection',await page.evaluate(()=>$('#ws-scene-workflow').tagName==='SELECT'&&!$('#ws-scene-workflow').disabled&&!!$('[data-act="ws-edit-scene-workflow"]')));
 await page.locator('[data-act="art-create-tab"][data-tab="queue"]').click();check('ComfyUI queue workflow is selectable',await page.evaluate(()=>$('#ws-plan-workflow').tagName==='SELECT'&&!$('#ws-plan-workflow').disabled));await page.locator('[data-act="art-create-tab"][data-tab="story"]').click();
 await page.locator('[data-act="delete-storyboard-template"]').click();check('confirmation distinguishes a whole template from one frame',(await page.locator('#confirm-dialog').innerText()).includes('整套'));
 await page.evaluate(()=>$('#confirm-no').click());check('cancel preserves the source template',await page.evaluate(id=>!!templateBy(id),sourceId));
 await page.evaluate(id=>{state.queue.push({id:'guard-test',templateId:id,status:'pending'});},sourceId);
 const blocked=await page.evaluate(async id=>{try{await deleteStoryboardTemplate(id);return false}catch(e){return e.message.includes('待执行')}},sourceId);check('pending tasks block deletion',blocked);await page.evaluate(()=>{state.queue=state.queue.filter(q=>q.id!=='guard-test')});
 // A second source proves deleting one template never silently switches plans to another.
 await page.evaluate(()=>{const t=clone(currentTemplate());t.id='other-template';t.title='保留的分镜';state.templates.push(t);render()});
 await page.locator('[data-act="delete-storyboard-template"]').click();await page.locator('#confirm-yes').click();
 check('confirmed deletion removes only the selected source',await page.evaluate(id=>!templateBy(id)&&!!templateBy('other-template'),sourceId));
 check('dependent plan is unbound and does not silently show another template',await page.evaluate(()=>selectedPlan().templateId===''&&!$('#frame-prompt')&&!!$('.quiet-story-header')));
 check('existing albums and original image references are unchanged',await page.evaluate(before=>JSON.stringify(state.books)===before,booksBefore));
 await page.locator('select[data-v3-plan="templateId"]').selectOption('other-template');await page.locator('[data-act="delete-storyboard-template"]').click();await page.locator('#confirm-yes').click();
 check('the final template can be deleted into a usable empty state',await page.evaluate(()=>state.templates.length===0&&!$('#frame-prompt')&&!!$('[data-act="new-template"]')));
 await page.evaluate(async()=>{await savePythonWorkspace(true)});await page.reload();await page.waitForFunction(()=>!rt.booting);check('deletion persists after reload without recreating templates',await page.evaluate(()=>state.templates.length===0&&state.creation.plans.every(p=>p.templateId==='')));
 check('no uncaught browser errors',!errors.length);console.log(checks+' template/provider checks passed.');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(temp,{recursive:true,force:true})}
