// User-visible interaction only: no injecting profiles, assets, queue state, or navigation.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {chromium} from 'playwright';
const evidence=process.env.MIO_JOURNEY_EVIDENCE||'docs/acceptance-first-use';fs.mkdirSync(evidence,{recursive:true});
let checks=0;function check(value,label){assert.ok(value,label);checks++;console.log('PASS '+label)}
const workflow={'3':{class_type:'KSampler',inputs:{seed:1,steps:20,cfg:7,model:['4',0],positive:['6',0],negative:['7',0],latent_image:['5',0]}},'4':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'fixture.safetensors'}},'5':{class_type:'EmptyLatentImage',inputs:{width:512,height:512,batch_size:1}},'6':{class_type:'CLIPTextEncode',inputs:{text:'initial prompt',clip:['4',1]},_meta:{title:'Positive'}},'7':{class_type:'CLIPTextEncode',inputs:{text:'',clip:['4',1]},_meta:{title:'Negative'}},'8':{class_type:'VAEDecode',inputs:{samples:['3',0],vae:['4',2]}},'9':{class_type:'SaveImage',inputs:{images:['8',0],filename_prefix:'fixture'}}};
const people=[{id:'comfy',provider:'comfyui',label:'ComfyUI'},{id:'novelai',provider:'novelai',label:'NovelAI'},{id:'images',provider:'openai',label:'OpenAI 兼容'},{id:'chat-mobile',provider:'openai',label:'OpenAI 兼容',mobile:true}];
const browser=await chromium.launch({args:['--no-sandbox']});
try{for(const [n,person] of people.entries()){
 if(process.env.MIO_JOURNEY_ONLY&&person.id!==process.env.MIO_JOURNEY_ONLY)continue;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mio-first-use-')),port=18850+n,providerPort=18950+n,base=`http://127.0.0.1:${port}`,upstream=`http://127.0.0.1:${providerPort}`;
 const log=fs.openSync(path.join(root,'server.log'),'w'),server=spawn('python',['tests/journey_fixture_server.py'],{env:{...process.env,MIO_DATA_DIR:path.join(root,'fresh'),MIO_HOST:'127.0.0.1',MIO_PORT:String(port),MIO_JOURNEY_PROVIDER_PORT:String(providerPort)},stdio:['ignore',log,log]});let context;
 const wire=()=>fs.existsSync(path.join(root,'fresh/journey-wire.json'))?JSON.parse(fs.readFileSync(path.join(root,'fresh/journey-wire.json'))):[],generations=()=>wire().filter(x=>x.method==='POST');
 try{
  let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/content')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'isolated fresh server');
  context=await browser.newContext({viewport:person.mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:!!person.mobile,hasTouch:!!person.mobile,reducedMotion:'reduce'});const p=await context.newPage(),errors=[];globalThis.journeyPage=p;p.on('pageerror',e=>errors.push(e.message));
  await p.route(/^https?:\/\//,r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await p.goto(base);await p.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);
  check(await p.locator('.first-run-path').count()===3,person.id+': fresh home offers three explicit provider paths');
  check(await p.locator('.first-run-path').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44})),person.id+': first-use targets meet 44px minimum');
  if(person.id==='comfy'){await p.getByRole('button',{name:'收起指引',exact:true}).click();check(await p.locator('.first-run-path').count()===0,'home orientation can be dismissed');await p.getByRole('button',{name:'首次使用指引',exact:true}).click()}
  await p.screenshot({path:path.join(evidence,person.id+'-home.png'),animations:'disabled'});
  await p.getByRole('button',{name:'我使用 '+person.label,exact:false}).click();check(await p.locator('#image-provider-select').inputValue()===person.provider,person.id+': selected path opens the intended channel');
  async function saveKey(key){await p.getByLabel('API Key',{exact:true}).fill(key);await p.locator('[data-act="image-key-save-inline"]').click();await p.waitForFunction(()=>activeImageProfile().keyMode==='stored'&&imageProviderUI.keyWrites.size===0);check(await p.getByLabel('API Key',{exact:true}).inputValue()==='••••••••', 'key saved directly on the provider page and plaintext masked')}
  if(person.provider==='comfyui'){
   await p.getByLabel('ComfyUI 服务地址',{exact:true}).fill('http://127.0.0.1:1');await p.getByRole('button',{name:'检查连接',exact:true}).click();await p.locator('#setup-comfy-status').filter({hasText:'连接失败'}).waitFor();check(generations().length===0,'ComfyUI unavailable service gives an actionable read-only failure');
   await p.getByLabel('ComfyUI 服务地址',{exact:true}).fill(upstream);await p.getByRole('button',{name:'检查连接',exact:true}).click();await p.locator('#setup-comfy-status').filter({hasText:'服务可读'}).waitFor();check(wire().some(x=>x.path==='/system_stats')&&generations().length===0&&(await p.locator('#topbar').innerText()).includes('后端按需连接'),'ComfyUI check reaches backend-side system_stats, no prompt submission');
   for(const [filename,doc,bad] of [['canvas.json',{nodes:[],links:[]},true],['my-api-workflow.json',workflow,false]]){
    const chooser=p.waitForEvent('filechooser');await p.getByRole('button',{name:'导入 API 工作流',exact:true}).click();await(await chooser).setFiles({name:filename,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await p.getByRole('heading',{name:'批量导入结果',exact:true}).waitFor();
    check((await p.locator('#modal').innerText()).includes(bad?'导出 API 格式':'成功导入 1 份'),bad?'ComfyUI canvas JSON is rejected with API export instructions':'ComfyUI API workflow imports via real file picker');await p.getByRole('button',{name:'完成',exact:true}).click();
   }
  }else{
   if(person.provider==='novelai'){
    check(await p.getByLabel('API Key',{exact:true}).inputValue()===''&&await p.locator('#image-provider-auth').count()===0,'NovelAI directly accepts an empty credential field');
    await p.locator('[data-image-config="baseUrl"]').fill(upstream);await p.locator('[data-image-config="baseUrl"]').press('Tab');await saveKey('fixture-invalid');
   }else{
    await p.locator('[data-image-config="baseUrl"]').fill(upstream+'/v1/images/generations');await p.locator('[data-image-config="baseUrl"]').press('Tab');await p.getByRole('button',{name:'编写分镜',exact:true}).click();check(await p.locator('#toasts').innerText().then(t=>t.includes('不要包含')),'OpenAI full generation URL is caught before enqueue');
    await p.locator('[data-image-config="baseUrl"]').fill(upstream+(person.mobile?'/manual/v1':'/v1'));await p.locator('[data-image-config="baseUrl"]').press('Tab');await p.getByRole('button',{name:'获取模型',exact:true}).click();
    if(person.mobile){await p.locator('#provider-model-status').filter({hasText:'获取失败：'}).waitFor();await p.getByRole('combobox',{name:'模型 ID'}).fill('fixture-chat');await p.locator('[data-image-config="protocol"]').selectOption('chat');check(await p.locator('[data-image-config="sendSize"]').count()===0&&await p.locator('[data-image-config="sendAspectHint"]').isChecked(),'Chat user can type model after /models 404; Images-only parameters give way to the aspect-ratio hint switch')}
    else{await p.getByRole('option',{name:'fixture-image',exact:true}).waitFor();check(await p.getByRole('option',{name:'fixture-chat',exact:true}).isVisible(),'models outside the default gpt-image filter are shown immediately');await p.getByRole('option',{name:'fixture-image',exact:true}).click()}
   }
   check(await p.locator('.workflow-library').count()===0,person.id+': cloud user is not forced through ComfyUI workflow settings');
  }
  await p.screenshot({path:path.join(evidence,person.id+'-configured.png'),animations:'disabled',fullPage:true});
  check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),person.id+': configuration has no horizontal page overflow');
  await p.getByRole('button',{name:'编写分镜',exact:true}).click();await p.getByRole('button',{name:'新建分镜',exact:true}).click();await p.locator('#text-value').fill('First scene '+person.id);await p.getByRole('button',{name:'确认',exact:true}).click();
  const prompt=p.locator('[data-workshop-frame="prompt"]');await prompt.waitFor();check(await prompt.inputValue()==='',person.id+': a new story is a blank scene, not a hidden demo template');
  if(person.id==='comfy'){
   await p.getByRole('button',{name:'新增分幕',exact:true}).click();check(await prompt.inputValue()===''&&await p.locator('[data-workshop-frame="negative"]').inputValue()==='','additional new frames are also blank, without inherited demo variables');await p.locator('[data-act="workshop-delete-frame"]').click();await p.locator('#confirm-yes').click();
  }
  const content=person.provider==='novelai'?'{masterpiece}, {{soft_lighting}}, a quiet greenhouse at dawn':'a quiet greenhouse at dawn';await prompt.fill(content);await p.getByLabel('分镜台词',{exact:true}).fill('第一幕的旁白');
  async function assemble(){await p.getByRole('button',{name:'去装配此分镜',exact:true}).click();check(await p.locator('#designer-channel').inputValue()===person.provider,person.id+': setup channel carries through into assembly');check(await p.locator('#designer-workflow').count()===(person.provider==='comfyui'?1:0),person.id+': workflow selector only appears for ComfyUI');await p.getByRole('button',{name:'下一步',exact:true}).click();await p.getByRole('button',{name:'下一步',exact:true}).click()}
  if(person.id==='images'){
   await prompt.fill('portrait of {hero}');await assemble();check(await p.locator('.assembly-preflight').innerText().then(t=>t.includes('缺少变量：hero')),'missing preset variable is surfaced in the assembly review');await p.locator('#designer-title').fill('invalid draft');await p.getByRole('button',{name:'添加待命任务',exact:true}).click();check(await p.locator('#modal').evaluate(e=>e.open)&&generations().length===0,'invalid draft does not enqueue or invoke a provider');await p.getByRole('button',{name:'取消',exact:true}).click();await prompt.fill(content);
  }
  await assemble();check(await p.locator('.assembly-preflight').innerText().then(t=>t.includes('共 1 幕')),person.id+': review exposes the scene count');await p.locator('#designer-title').fill('My first album '+person.id);await p.getByRole('button',{name:'添加待命任务',exact:true}).click();await p.locator('.production-card').waitFor();check(generations().length===0,person.id+': configure, save and assemble caused zero generation calls');
  await p.getByRole('button',{name:'开始生成',exact:true}).click();await p.locator('#confirm-no').click();check(generations().length===0,person.id+': declining the billing confirmation sends nothing');
  async function start(){await p.getByRole('button',{name:'开始生成',exact:true}).click();await p.locator('#confirm-yes').click()}
  await start();
  if(person.provider==='novelai'){
   await p.locator('.production-card .state-failed').waitFor({timeout:45000});check(await p.locator('.production-card').innerText().then(t=>t.includes('密钥'))&&generations().length===1,'NovelAI 401 stays a stopped task and explains the key problem');
   await p.getByRole('button',{name:'工作流与 API 配置',exact:true}).click();await saveKey('fixture-valid');check(generations().length===1,'repairing the NovelAI key does not retry automatically');await p.getByRole('button',{name:'创作工坊',exact:true}).click();await p.getByRole('button',{name:'装配与队列',exact:true}).click();await start();
  }
  await p.locator('.production-card .state-complete').waitFor({timeout:45000});check(generations().length===(person.provider==='novelai'?2:1),person.id+': only explicitly confirmed attempts reached the protocol fixture');
  if(person.provider==='novelai')check(generations().at(-1).body.input===content,'NovelAI literal weight braces survive the full UI → provider request');
  await p.screenshot({path:path.join(evidence,person.id+'-completed.png'),animations:'disabled'});await p.getByRole('button',{name:'查看画册',exact:true}).click();await p.locator('#reader').waitFor();await p.locator('#reader-canvas img').first().evaluate(e=>e.decode());check(true,person.id+': generated fixture image opens in the actual reader');
  if(person.provider==='novelai'){
   await p.goto(base);await p.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);await p.getByRole('button',{name:'工作流与 API 配置',exact:true}).click();check(await p.evaluate(()=>activeImageProfile().keyMode==='stored'),'saved NovelAI credential reference survives a full reload');
   await p.locator('[data-image-config="baseUrl"]').fill(upstream+'/other');await p.locator('[data-image-config="baseUrl"]').press('Tab');check(await p.evaluate(()=>activeImageProfile().keyMode==='none')&&await p.getByLabel('API Key',{exact:true}).inputValue()==='','changing endpoint explicitly clears the old stored credential binding');
   await p.getByRole('button',{name:'管理密钥',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#modal').open);check(await p.locator('.provider-key-row').count()===0,'new endpoint cannot silently reuse keys scoped to the previous address');await p.getByRole('button',{name:'关闭',exact:true}).last().click();
   await p.locator('[data-image-config="baseUrl"]').fill(upstream);await p.locator('[data-image-config="baseUrl"]').press('Tab');await p.getByRole('button',{name:'管理密钥',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#modal').open);check(await p.locator('.provider-key-row').count()===2&&await p.getByLabel('新增 API Key',{exact:true}).inputValue()==='','original vault keys remain stored but plaintext is never returned');await p.getByRole('button',{name:'使用',exact:true}).last().click();await p.waitForFunction(()=>!document.querySelector('#modal').open);check(generations().length===2,'explicitly rebinding an existing credential causes no generation');
  }
  check(errors.length===0,person.id+': no uncaught browser errors');fs.writeFileSync(path.join(evidence,person.id+'-wire.json'),JSON.stringify(wire(),null,2));
 }catch(e){if(globalThis.journeyPage){fs.writeFileSync(path.join(evidence,person.id+'-failure-ui.txt'),await globalThis.journeyPage.locator('body').innerText());await globalThis.journeyPage.screenshot({path:path.join(evidence,person.id+'-failure.png'),animations:'disabled'})}fs.writeFileSync(path.join(evidence,person.id+'-failure-wire.json'),JSON.stringify(wire(),null,2));fs.copyFileSync(path.join(root,'server.log'),path.join(evidence,person.id+'-server-failure.txt'));throw e}finally{await context?.close();if(server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done}fs.closeSync(log);fs.rmSync(root,{recursive:true,force:true})}
}}
finally{await browser.close()}
console.log(`FIRST USE: ${checks} checks PASS across four isolated UI journeys`);
