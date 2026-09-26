// Native transport, real browser/vault proxy and portable sharing. No paid endpoint.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),data=mkdtempSync(path.join(tmpdir(),'mio-native-ui-')),base='http://127.0.0.1:8850',wire=[];
const upstream=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;wire.push({url:req.url,auth:req.headers.authorization,body:JSON.parse(raw)});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'受控模型响应'}}]}))});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const endpoint='http://127.0.0.1:'+upstream.address().port+'/v1';
let server,browser,count=0;const errors=[];const check=(name,value)=>{assert.ok(value,name);console.log('PASS '+name);count++};
async function load(page){await page.goto(base);await page.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()))}
try{
 server=spawn('python',['-u','server.py'],{cwd:root,env:{...process.env,MIO_DATA_DIR:data,MIO_PORT:'8850'},stdio:['ignore','pipe','pipe']});server.stdout.on('data',()=>{});server.stderr.on('data',()=>{});let ready=false;for(let i=0;i<200;i++){try{if((await fetch(base+'/api/config')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready);
 browser=await chromium.launch({args:['--no-sandbox']});const a=await browser.newPage(),b=await browser.newPage();for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));await load(a);
 check('first save initializes independent files without aggregate indexes',await a.evaluate(()=>savePythonWorkspace(true))&&!readdirSync(path.join(data,'albums')).includes('index.json')&&!readdirSync(path.join(data,'storyboards')).includes('templates.json'));
 const id=await a.evaluate(()=>state.books[0].id);await load(b);check('bootstrap carries summaries, not album bodies',await b.evaluate(()=>state.books.every(b=>b._lazy&&b.steps.length===0)));
 await Promise.all([a,b].map(p=>p.evaluate(id=>Mio.fileLibrary.hydrate(id),id)));
 assert.ok(await a.evaluate(async id=>{bookBy(id).title='页面甲修改标题';save();return savePythonWorkspace()},id));
 check('a second tab changes a different field without reverting the first tab',await b.evaluate(async id=>{bookBy(id).synopsis='页面乙修改简介';save();if(!await savePythonWorkspace())throw Error(Mio.sync.runtime.error);if(bookBy(id).title!=='页面甲修改标题')throw Error('ACK title: '+bookBy(id).title);return true},id));
 check('canonical ACK also prevents a later save from reverting merged fields',await b.evaluate(async id=>{bookBy(id).tags=['第三次编辑'];save();if(!await savePythonWorkspace())return false;const c=await(await fetch('/api/config')).json();return c.savedGalleries.find(x=>x.id===id).title==='页面甲修改标题'},id));
 await load(a);await load(b);await Promise.all([a,b].map(p=>p.evaluate(id=>Mio.fileLibrary.hydrate(id),id)));
 assert.ok(await a.evaluate(async id=>{bookBy(id).title='获确认的标题';save();return savePythonWorkspace()},id));
 check('overlapping field edits conflict and retain the unsaved local draft',await b.evaluate(async id=>{bookBy(id).title='本页未保存标题';save();return !await savePythonWorkspace()&&bookBy(id).title==='本页未保存标题'&&Mio.sync.runtime.error.includes('冲突')},id));
 await load(a);await load(b);
 assert.ok(await a.evaluate(async()=>{state.settings.llm.timeout=91;save();return savePythonWorkspace()}));
 check('settings merge returns all canonical fields to the browser',await b.evaluate(async()=>{state.settings.llm.model='native-model';save();if(!await savePythonWorkspace())return false;state.settings.llm.temperature=.2;save();return await savePythonWorkspace()&&state.settings.llm.timeout===91}));
 await load(a);await a.evaluate(async endpoint=>{Object.assign(state.settings.llm,{mode:'real',baseUrl:endpoint,model:'native-model',key:'NATIVE_LLM_TEST_ONLY'});save();if(!await savePythonWorkspace())throw Error(Mio.sync.runtime.error)},endpoint);
 check('text key is vaulted, not returned in public config or kept in browser state',await a.evaluate(async()=>!state.settings.llm.key&&!JSON.stringify(await(await fetch('/api/config')).json()).includes('NATIVE_LLM_TEST_ONLY'))&&readFileSync(path.join(data,'settings/secrets.json'),'utf8').includes('NATIVE_LLM_TEST_ONLY'));
 await load(a);check('text request after reload resolves the saved endpoint-bound key',await a.evaluate(async()=> (await chatCompletion([{role:'user',content:'测试'}],null,new AbortController().signal)).content==='受控模型响应')&&wire.at(-1).auth==='Bearer NATIVE_LLM_TEST_ONLY');
 await a.evaluate(async endpoint=>{Object.assign(state.settings.critic,{mode:'real',connection:'independent',baseUrl:endpoint,model:'native-vision',key:'NATIVE_VISION_TEST_ONLY'});save();if(!await savePythonWorkspace())throw Error(Mio.sync.runtime.error)},endpoint);await load(a);
 check('independent vision connection resolves its own key, not the text key',await a.evaluate(async()=>await visionRequest([{role:'user',content:'测试视觉连接'}],criticConfig(),new AbortController().signal)==='受控模型响应')&&wire.at(-1).auth==='Bearer NATIVE_VISION_TEST_ONLY');
 const beforeWire=wire.length;check('changing endpoint cannot leak a previously saved key',await a.evaluate(async()=>{state.settings.llm.baseUrl='https://must-not-receive.example/v1';save();return !await savePythonWorkspace()}));check('failed binding validation sends no model request',wire.length===beforeWire);await load(a);
 await a.evaluate(()=>handleAction('v3-settings-tab',{tab:'connections'}));check('settings retains maintenance without a single-resource picker',await a.locator('#native-share-resource').count()===0&&await a.locator('[data-act="v3-connect-backend"]').count()>0);
 await a.evaluate(()=>navigate(0));await a.locator('[data-act="book-menu"]').first().click();await a.locator('#book-context-menu').waitFor();const download=a.waitForEvent('download');await a.locator('#book-context-menu [data-act="native-export"]').click();await a.locator('#native-share-download').click();const packageFile=path.join(data,'share-test.zip');await(await download).saveAs(packageFile);check('album menu exports a standard ZIP',readFileSync(packageFile).subarray(0,2).toString()==='PK');await a.evaluate(()=>closeModal());
 const oldCount=await a.evaluate(()=>state.books.length);const chooser=a.waitForEvent('filechooser');await a.locator('#collection-home [data-act="native-import"]').click();await(await chooser).setFiles(packageFile);await a.locator('#resource-import-confirm').click();await a.waitForFunction(n=>state.books.length===n+1,oldCount);await a.locator('#collection-home').waitFor();
 check('normal UI import creates a different album identity and preserves originals',await a.evaluate(id=>state.books.some(b=>b.id===id)&&new Set(state.books.map(b=>b.id)).size===state.books.length,id));
 const newId=await a.evaluate(id=>state.books.find(b=>b.id!==id).id,id);await a.evaluate(id=>openArtReader(id),newId);await a.locator('#reader-canvas img').first().evaluate(i=>i.decode());check('imported shared album is immediately readable from its own images directory',await a.evaluate(id=>bookBy(id).steps[0].image.startsWith('/images/library/albums/'+id+'/images/'),newId));await a.evaluate(()=>closeReader());
 const cfg=await(await fetch(base+'/api/config')).json(),tpl=cfg.templates[0];const raw=JSON.parse(readFileSync(path.join(data,'storyboards',readdirSync(path.join(data,'storyboards')).find(n=>n.endsWith('.json'))),'utf8'));raw.id='copied_chinese';raw.title='从文件管理器复制的中文分镜';writeFileSync(path.join(data,'storyboards','复制来的中文分镜.json'),JSON.stringify(raw));await load(a);check('copying a valid independent file is discovered on reload without generation',await a.evaluate(()=>state.templates.some(t=>t.id==='copied_chinese'))&&wire.length===beforeWire);
 const oldFiles=readdirSync(path.join(data,'storyboards')).length;let requests=0;await a.route('**/api/config',async route=>{if(route.request().method()!=='POST')return route.continue();requests++;await route.fetch();await route.abort()});
 check('lost save response leaves the draft explicitly unconfirmed',await a.evaluate(async id=>{templateBy(id).outline='响应丢失后的草稿';save();return !await savePythonWorkspace()&&Mio.sync.runtime.dirty},tpl.id));await a.unroute('**/api/config');
 check('manual save recovery is idempotent and creates no duplicate file',await a.evaluate(()=>savePythonWorkspace())&&readdirSync(path.join(data,'storyboards')).length===oldFiles&&requests===1);
 // A detail response captured before a later picture poll must not erase that poll.
 const c=await browser.newPage();c.on('pageerror',e=>errors.push(e.message));await load(c);
 let releaseDetail,detailReady;const detailSeen=new Promise(r=>detailReady=r);
 await c.route('**/api/library/entity/albums/'+id,async route=>{const response=await route.fetch();await new Promise(r=>{releaseDetail=r;detailReady()});await route.fulfill({response})});
 const hydrating=c.evaluate(id=>Mio.fileLibrary.hydrate(id),id);await detailSeen;
 check('picture polling keeps lazy album bodies unmaterialized',await c.evaluate(id=>{Mio.pictures.apply({albumId:id,index:0,revision:99999,image:'',removed:true});return bookBy(id)._lazy&&bookBy(id).steps.length===0},id));releaseDetail();await hydrating;
 check('a slower detail response preserves the newer picture edit and full caption',await c.evaluate(id=>{const b=bookBy(id);return !b._lazy&&b.steps[0].image===''&&b.steps[0].visualRevision===99999&&!!b.steps[0].caption},id));await c.close();
 await a.evaluate(()=>handleAction('v3-settings-tab',{tab:'connections'}));await a.locator('[data-act="native-forget"][data-scope="llm"]').click();await a.getByRole('button',{name:'忘记密钥',exact:true}).click();await a.waitForFunction(()=>!Mio.sync.runtime.previous.llmConfig?._secretRefs?.['/key']);
 check('explicit forget control removes only the chosen saved key',!readFileSync(path.join(data,'settings/secrets.json'),'utf8').includes('NATIVE_LLM_TEST_ONLY')&&readFileSync(path.join(data,'settings/secrets.json'),'utf8').includes('NATIVE_VISION_TEST_ONLY'));
 check('settings/secrets.json is never served as a static file',(await fetch(base+'/data/settings/secrets.json')).status===404);
 check('no browser exceptions or paid provider requests occurred',errors.length===0&&wire.length===2);console.log(count+' native runtime UI checks passed. Controlled local text/vision only.');
}finally{await browser?.close();if(server?.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done}await new Promise(r=>upstream.close(r));rmSync(data,{recursive:true,force:true})}
