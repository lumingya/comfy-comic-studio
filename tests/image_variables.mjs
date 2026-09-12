// Real browser + native disk storage; all paid generation endpoints are intercepted.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,readFileSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=mkdtempSync(path.join(tmpdir(),'mio-images-'));
for(const name of ['providers','mio_jobs.py','mio_frame_jobs.py','mio_channels.py','mio_contracts.py','mio_foundation.py','server.py','mio_api.py','mio_credentials.py','mio_docs.py','index.html','styles.css','favicon.svg','vendor','js','docs'])cpSync(path.join(root,name),path.join(temp,name),{recursive:true});
const server=spawn('python',['-u','server.py'],{cwd:temp,env:{...process.env,MIO_PORT:'8796'},stdio:['ignore','pipe','pipe']});let browser,checks=0;const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log('PASS '+name)};
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('物理落盘')){clearTimeout(t);resolve()}});server.on('error',reject)});
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1568,height:1004}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https:\/\//,r=>r.abort());await page.goto('http://127.0.0.1:8796');await page.waitForFunction(()=>!rt.booting);
 const pngs=await page.evaluate(()=>['#dc855b','#56816a','#5977b2'].map(color=>{const c=document.createElement('canvas');c.width=160;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,160,100);return c.toDataURL()}));
 const expected='参考@image_1的人物，王明坐在椅子上，仰望星空。背景参考@image_2，再看@image_1';
 await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.settings.identity.workspaceName='图片变量测试';state.settings.identity.onboarded=true;const p=selectedPlan(),t=templateBy(p.templateId);state.books=[];state.queue=[];p.storyVersionId='';p.variableSetIds=[];p.variables=[{id:'character_name',key:'charcter',type:'text',value:'王明'}];p.sceneOverrides={};p.excludedSettingKeys=[];t.frames=t.frames.slice(0,1);t.frames[0].prompt='参考{charcter_image1}的人物，{charcter}坐在椅子上，仰望星空。背景参考{图片}，再看{charcter_image1}';t.frames[0].negative='';state.settings.negative='';const g=ensureImageProviders();g.profiles.push({id:'image_test',title:'协议测试',provider:'openai',protocol:'chat',baseUrl:'https://example.invalid/v1',model:'test',keyMode:'none',sendSize:false,sendQuality:false});g.active='image_test';navigate(1);createUI.tab='settings';render()});
 for(const key of ['charcter_image1','图片']){
  await page.locator('[data-act="art-setting-add"]').click();await page.locator('#art-new-setting-key').fill(key);await page.locator('#art-new-setting-label').fill(key==='图片'?'背景图片':'人物图片');await page.locator('#art-new-setting-type').selectOption('image');await page.locator('[data-act="art-setting-confirm"]').click();
 }
 check('Chinese image variables can be created in the normal settings UI',await page.locator('[data-image-key="图片"] input').count()===1);
 for(const [i,key]of ['charcter_image1','图片'].entries()){
  await page.locator(`[data-image-key="${key}"] input`).setInputFiles({name:`reference-${i+1}.png`,mimeType:'image/png',buffer:Buffer.from(pngs[i].split(',')[1],'base64')});
  await page.waitForFunction(key=>selectedPlan().variables.find(e=>e.key===key)?.value?.src?.startsWith('/images/'),key);
 }
 const refs=await page.evaluate(()=>selectedPlan().variables.filter(e=>e.type==='image').map(e=>e.value.src));
 check('uploads physically exist on disk and match their original bytes',refs.every((ref,i)=>readFileSync(path.join(temp,'data/assets/images',ref.slice('/images/'.length))).equals(Buffer.from(pngs[i].split(',')[1],'base64'))));
 check('configuration rejects inline image-variable data',await page.evaluate(png=>{const s=clone(state);s.creation.plans[0].variables.push({id:'bad_inline',key:'bad_inline',type:'image',value:{kind:'mio-image',src:png}});try{validateState(s);return false}catch(e){return e.message.includes('本地资产')}},pngs[0]));
 check('configuration stores local asset references, not base64',await page.evaluate(()=>selectedPlan().variables.filter(e=>e.type==='image').every(e=>e.value.kind==='mio-image'&&!JSON.stringify(e).includes('base64'))));
 await page.evaluate(()=>{selectedPlan().variables.push({id:'unused_img',key:'未使用',type:'image',value:''});save();});
 check('prompt resolves in first-occurrence order and deduplicates by variable name',await page.evaluate(expected=>{const p=selectedPlan(),f=effectivePlanFrame(p,currentTemplate().frames[0]);return f._resolvedImagePrompt===expected&&f._imageInputs.length===2&&f._imageInputs[1].key==='图片'},expected));
 check('unused empty images do not block resolution',await page.evaluate(()=>{const p=selectedPlan(),f=effectivePlanFrame(p,currentTemplate().frames[0]);return resolveImageVariables(f.prompt,f._scope,true).images.length===2}));
 check('Chinese variable identifiers retain weights and escaped braces',await page.evaluate(()=>{const scope={图片:{kind:'mio-image',src:'/images/a.png'},charcter:'王明'};return resolveImageVariables('{{图片}} \\{图片} {masterpiece} {charcter} {图片}',scope).prompt==='{{图片}} \\{图片} {masterpiece} 王明 @image_1'}));
 check('positive and negative references share one ordered attachment list',await page.evaluate(()=>{const a={kind:'mio-image',src:'/images/a.png'},b={kind:'mio-image',src:'/images/b.png'},r=resolveImageVariables('{a}',{a,b},true,'{b} {a}');return r.prompt==='@image_1'&&r.negative==='@image_2 @image_1'&&r.images.length===2}));
 check('scene overrides retain image typing and precedence',await page.evaluate(()=>{const p=selectedPlan(),f=currentTemplate().frames[0];p.sceneOverrides[f.id]={variables:[{id:'scene_img',key:'图片',type:'image',value:{kind:'mio-image',src:'/images/scene.png'}}]};const result=effectivePlanFrame(p,f)._imageInputs[1].src;delete p.sceneOverrides[f.id];return result==='/images/scene.png'}));
 await page.locator('[data-act="art-create-tab"][data-tab="story"]').click();
 check('resolved preview shows numbered image thumbnails',await page.locator('.image-binding-preview code').allTextContents().then(values=>values.includes('@image_1')&&values.includes('@image_2')));
 await page.evaluate(()=>{enqueuePlanSnapshot(selectedPlan());window.__imageQueue=clone(state.queue[0])});
 await page.locator('[data-act="art-create-tab"][data-tab="settings"]').click();await page.locator('[data-image-key="charcter_image1"] input').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from(pngs[2].split(',')[1],'base64')});await page.waitForFunction(old=>selectedPlan().variables.find(e=>e.key==='charcter_image1').value.src!==old,refs[0]);
 check('replacement does not mutate the queued prompt or ordered references',await page.evaluate(({expected,refs})=>state.queue[0].frames[0]._resolvedImagePrompt===expected&&state.queue[0].frames[0]._imageInputs.map(i=>i.src).join('|')===refs.join('|'),{expected,refs}));
 check('old queued image remains on disk after replacement',readFileSync(path.join(temp,'data/assets/images',refs[0].slice('/images/'.length))).equals(Buffer.from(pngs[0].split(',')[1],'base64')));
 await page.evaluate(async()=>{await savePythonWorkspace(true)});await page.reload();await page.waitForFunction(()=>!rt.booting);
 check('restart/read retains image variables and original queue snapshots',await page.evaluate(({refs,expected})=>selectedPlan().variables.find(e=>e.key==='图片').value.src===refs[1]&&state.queue[0].frames[0]._imageInputs[0].src===refs[0]&&state.queue[0].frames[0]._resolvedImagePrompt===expected,{refs,expected}));
 const sent=[],rawError=JSON.stringify({error:{code:'unsupported_images',message:'图片不兼容。'+('保留详细响应。'.repeat(100))}});
 await page.route('**/api/image/generate',async route=>{sent.push(route.request().postDataJSON());await route.fulfill({status:422,contentType:'application/json',body:rawError})});
 await page.evaluate(async()=>{await runFlexibleQueue()});
 check('adapter sends only ordered snapshot images, not unused or replacement assets',sent.length===1&&JSON.stringify(sent[0].images)===JSON.stringify(refs)&&sent[0].prompt===expected);
 check('generation failure has no paid retry or text-only fallback',sent.length===1&&await page.evaluate(()=>state.queue[0].status==='failed'&&state.books.find(b=>b.id===state.queue[0].bookId).steps.length===0));
 check('full upstream status and body are retained on the task',await page.evaluate(raw=>state.queue[0].error==='HTTP 422: '+raw,rawError));
 await page.evaluate(()=>{navigate(1);createUI.tab='queue';render()});
 check('queue exposes the original error in expandable details',await page.locator('.queue-error-detail pre').textContent().then(text=>text==='HTTP 422: '+rawError));
 check('no referenced images means no attachments or implicit character reference',await page.evaluate(async()=>{try{await generateProviderFrame({prompt:'plain text',negative:'',_scope:{}},{references:{front:'/images/should-not-be-attached.png'}},new AbortController().signal)}catch(e){return e.message.startsWith('HTTP 422:')}return false})&&sent.at(-1).images.length===0&&sent.at(-1).source===null);
 await page.unroute('**/api/image/generate');
 check('a missing local image fails explicitly before any provider request',await page.evaluate(async()=>{const q=state.queue[0],f=clone(q.frames[0]);f._imageInputs[0].src='/images/albums/variable-assets/missing.png';try{await generateProviderFrame(f,q.rowSnapshot,new AbortController().signal);return false}catch(e){return e.message.includes('Local image file does not exist')}}));
 // Export all plans and both queued/original images, then restore without the original asset folder.
 await page.evaluate(async()=>{window.__imagePackage=await buildDiskPackage(state)});
 check('portable package includes physical variable assets and no inline base64',await page.evaluate(async()=>{const pkg=window.__imagePackage,assets=[...pkg.files.keys()].filter(k=>k.includes('variable_')&&k.endsWith('.png'));return assets.length>=3&&!(await pkg.files.get('workspace.json').text()).includes('base64')}));
 renameSync(path.join(temp,'data/assets/images'),path.join(temp,'saved-original-images'));
 await page.evaluate(async()=>{const pkg=window.__imagePackage;window.__imageRestored=await loadDiskManifest(async name=>{const blob=pkg.files.get(name);if(!blob)throw Error('Missing '+name);return blob},await pkg.files.get('workspace.json').text())});
 check('portable restore recreates local files without needing the original folder',refs.every(ref=>readFileSync(path.join(temp,'data/assets/images',ref.slice('/images/'.length))).length>0));
 check('restored queue and source snapshots reference immutable local assets',await page.evaluate(refs=>{const restored=window.__imageRestored.state;return restored.queue[0].frames[0]._imageInputs[0].src===refs[0]&&restored.books.find(b=>b.id===restored.queue[0].bookId).sourceSnapshot.frames[0]._imageInputs[1].src===refs[1]&&!JSON.stringify(restored.creation).includes('base64')},refs));
 await page.evaluate(()=>{navigate(1);createUI.tab='settings';render()});
 await page.locator('[data-act="art-setting-remove"][data-key="图片"]').click();await page.locator('#confirm-yes').click();
 check('removing a still-referenced image is an explicit error, not silent omission',await page.evaluate(()=>{const p=selectedPlan(),f=effectivePlanFrame(p,currentTemplate().frames[0]);try{resolveImageVariables(f.prompt,f._scope,true);return false}catch(e){return e.message.includes('图片')}}));
 check('known variables outside the current scope cannot silently disappear',await page.evaluate(()=>{state.creation.variableSets.push({id:'outside_set',projectId:state.activeProjectId,title:'未应用',entries:[{id:'outside_var',key:'缺失图片',type:'image',value:''}]});try{resolveImageVariables('{缺失图片}',{},true);return false}catch(e){return e.message.includes('缺失')}}));
 // Exercise ComfyUI's real browser upload/submit protocol with named variable bindings.
 const uploads=[],workflows=[];
 await page.route('**/comfy/**',async route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/upload/image')){uploads.push(route.request().postDataBuffer());return route.fulfill({json:{name:'uploaded-'+uploads.length+'.png',subfolder:'variables'}})}if(url.pathname.endsWith('/prompt')){workflows.push(route.request().postDataJSON());return route.fulfill({json:{prompt_id:'image-variable-test'}})}if(url.pathname.includes('/history/'))return route.fulfill({json:{'image-variable-test':{status:{completed:true},outputs:{'4':{images:[{filename:'result.png',type:'output'}]}}}}});if(url.pathname.endsWith('/view'))return route.fulfill({contentType:'image/png',body:Buffer.from(pngs[0].split(',')[1],'base64')});return route.abort()});
 await page.evaluate(async()=>{const q=state.queue[0],f=clone(q.frames[0]);f._assetBookId=q.bookId;f._execution={provider:'comfyui',baseUrl:location.origin+'/comfy',workflowTitle:'变量图片协议测试',outputNodeId:'4',workflow:{'1':{class_type:'LoadImage',inputs:{image:'old.png'}},'2':{class_type:'LoadImage',inputs:{image:'old.png'}},'3':{class_type:'CLIPTextEncode',inputs:{text:''}},'4':{class_type:'SaveImage',inputs:{}}},bindings:[{id:'a',enabled:true,label:'人物',nodeId:'1',path:'image',source:'variable',value:'charcter_image1',type:'text'},{id:'b',enabled:true,label:'背景',nodeId:'2',path:'image',source:'variable',value:'图片',type:'text'},{id:'prompt',enabled:true,label:'提示词',nodeId:'3',path:'text',source:'positive',type:'text'}]};window.__comfyImageFrame=f;await executeMappedGPU(f,q.rowSnapshot,new AbortController().signal)});
 check('ComfyUI uploads both images in prompt order',uploads.length===2&&uploads[0].includes(Buffer.from(pngs[0].split(',')[1],'base64'))&&uploads[1].includes(Buffer.from(pngs[1].split(',')[1],'base64')));
 check('ComfyUI binds uploaded names to corresponding variables and resolved prompt',workflows.length===1&&workflows[0].prompt['1'].inputs.image==='variables/uploaded-1.png'&&workflows[0].prompt['2'].inputs.image==='variables/uploaded-2.png'&&workflows[0].prompt['3'].inputs.text===expected);
 check('missing ComfyUI variable bindings fail rather than drop images',await page.evaluate(async()=>{const f=clone(window.__comfyImageFrame);f._execution.bindings=[];try{await executeMappedGPU(f,state.queue[0].rowSnapshot,new AbortController().signal);return false}catch(e){return e.message.includes('绑定')}}));
 check('no request submitted after missing-binding error',workflows.length===1);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);check('image settings fit the mobile viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 check('no uncaught browser errors',errors.length===0);console.log(checks+' image-variable checks passed.');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(temp,{recursive:true,force:true})}
