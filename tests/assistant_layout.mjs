// Isolated layout and interaction checks; never sends a model request.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=mkdtempSync(path.join(tmpdir(),'mio-assistant-'));
for(const name of ['server.py','mio_api.py','mio_credentials.py','mio_docs.py','index.html','styles.css','favicon.svg','vendor','js','docs'])cpSync(path.join(root,name),path.join(temp,name),{recursive:true});
const server=spawn('python',['-u','server.py'],{cwd:temp,env:{...process.env,MIO_PORT:'8796'},stdio:['ignore','pipe','pipe']});let browser,checks=0;const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log('PASS '+name)};
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('物理落盘')){clearTimeout(t);resolve()}});server.on('error',reject)});
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1568,height:1004}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https:\/\//,r=>r.abort());await page.goto('http://127.0.0.1:8796');await page.waitForFunction(()=>!rt.booting);
 await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());showAssistant();$('#assistant').classList.add('fullscreen');scheduleAssistantFit()});await page.waitForTimeout(350);
 const layout=()=>page.evaluate(()=>{const p=$('#assistant'),c=$('.assistant-context-scroll',p),m=$('#chat-messages'),input=$('#chat-input'),send=$('[data-act="send-chat"]',p),r=p.getBoundingClientRect();return{context:c.offsetHeight,conversation:m.offsetHeight,ratio:m.offsetHeight/r.height,overflow:p.scrollWidth>p.clientWidth+1,sendVisible:send.getBoundingClientRect().bottom<=r.bottom,inputHeight:input.offsetHeight}});
 let sizes=await layout();check('desktop reserves over half the panel for conversation',sizes.ratio>.5);check('desktop context is a single compact row',sizes.context<110);check('desktop composer remains usable without overflow',!sizes.overflow&&sizes.sendVisible&&sizes.inputHeight>=40);
 check('one target selector replaces duplicated scope text',await page.evaluate(()=>$$('#assistant-target').length===1&&getComputedStyle($('.assistant-scope')).display==='none'&&!!$('.assistant-target-context [data-act="assistant-open-target"]')));
 if(process.env.MIO_ASSISTANT_SCREENSHOT)await page.locator('#assistant').screenshot({path:process.env.MIO_ASSISTANT_SCREENSHOT});
 await page.locator('.assistant-suggestion').first().click();check('suggestion inserts a draft without sending',await page.locator('#chat-input').inputValue()==='把第 1 幕改成雨夜车站'&&await page.evaluate(()=>!rt.chatBusy));
 await page.locator('#chat-input').fill('保留这条草稿');await page.locator('[data-act="assistant-full"]').click();await page.waitForTimeout(250);sizes=await layout();check('floating mode keeps input and actions visible',sizes.sendVisible&&!sizes.overflow&&sizes.inputHeight>=40);check('resizing does not clear the draft',await page.locator('#chat-input').inputValue()==='保留这条草稿');
 await page.locator('[data-act="assistant-input-expand"]').click();await page.waitForTimeout(150);check('expanded composer retains send controls',(await layout()).sendVisible);await page.locator('[data-act="assistant-input-expand"]').click();
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);sizes=await layout();check('mobile panel has no horizontal overflow and retains send controls',!sizes.overflow&&sizes.sendVisible&&sizes.inputHeight>=40);
 await page.setViewportSize({width:1100,height:600});await page.evaluate(()=>{$('#assistant').classList.add('fullscreen');scheduleAssistantFit()});await page.waitForTimeout(250);sizes=await layout();check('short windows retain scrolling conversation and a usable input',!sizes.overflow&&sizes.sendVisible&&sizes.conversation>80&&sizes.inputHeight>=40);
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{currentChat().messages.push({role:'user',content:'测试对话内容'},{role:'assistant',content:'这是一条用于布局检查的消息，不是模型响应。'});renderAssistant()});await page.waitForTimeout(250);check('conversation replaces the welcome state',await page.locator('.assistant-intro').count()===0&&await page.locator('.chat-bubble.user').count()===1);check('draft survives message rerender',await page.locator('#chat-input').inputValue()==='保留这条草稿');
 await page.locator('[data-act="new-chat"]').click();check('new conversation retains its bound target',await page.evaluate(()=>currentChat().messages.length===0&&currentChat().templateId===$('#assistant-target').value));
 const otherTarget=await page.evaluate(()=>{const t=clone(state.templates[0]);t.id='assistant-layout-target';t.title='另一份分镜';state.templates.push(t);renderAssistant();return t.id});if(otherTarget){await page.locator('#assistant-target').selectOption(otherTarget);check('target selector explicitly binds the selected template',await page.evaluate(id=>currentChat().templateId===id,otherTarget))}
 await page.evaluate(()=>{rt.chatBusy=true;renderAssistant()});check('busy state locks target and history while keeping stop available',await page.locator('#assistant-target').isDisabled()&&await page.locator('#chat-select').isDisabled()&&await page.locator('[data-act="assistant-stop"]').isVisible());
 await page.evaluate(()=>{rt.chatBusy=false;renderAssistant();displayUI.locale.setLanguage('en');localizeWorkspace()});check('new welcome copy is available in English',await page.locator('.assistant-intro h3').innerText()==='Let the next scene\nfeel more like you.');
 check('no uncaught browser errors',!errors.length);console.log(checks+' assistant layout checks passed.');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(temp,{recursive:true,force:true})}
