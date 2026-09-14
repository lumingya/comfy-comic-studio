// End-to-end conversion source: the ACTUALLY DELIVERED 1.2.1 ZIP, not current factories.
// Run: node tests/conversion_delivered_baseline.mjs /path/to/mio-1.2.1-source.zip
import {chromium} from 'playwright';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(), archive=process.argv[2];
assert.ok(archive,'Pass the actual delivered 1.2.1 ZIP explicitly');
const temp=mkdtempSync(path.join(tmpdir(),'mio-conversion-baseline-'));
let server,browser,checks=0;
const check=(label,condition)=>{assert.ok(condition,label);console.log('PASS '+label);checks++};
const python=(code,args=[])=>{const result=spawnSync('python',['-c',code,...args],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout};
try{
 const baselineHash=createHash('sha256').update(readFileSync(archive)).digest('hex');
 console.log('BASELINE_SHA256 '+baselineHash);
 check('archive hash matches the actual delivered 1.2.1 package',baselineHash==='cfbc21fe58e13f6253ff83efe4c707b0220f42e2eb229d91950e167c16017742');
 python('import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:z.extractall(sys.argv[2])',[archive,temp]);
 const old=path.join(temp,readdirSync(temp)[0]),expected=path.join(temp,'expected.json'),output=path.join(temp,'new-data');
 check('baseline package really identifies itself as 1.2.1',JSON.parse(readFileSync(path.join(old,'package.json'),'utf8')).version==='1.2.1');
 const port='8828',base='http://127.0.0.1:'+port;
 server=spawn('python',['-u','server.py'],{cwd:old,env:{...process.env,MIO_PORT:port},stdio:['ignore','pipe','pipe']});
 let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 let ready=false;for(let i=0;i<200;i++){try{if((await fetch(base+'/api/config')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}
 assert.ok(ready,logs);
 browser=await chromium.launch({args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),paid=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&(/\/api\/image\/generate|\/api\/foundation\/jobs$|\/v1\/images\//.test(r.url())))paid.push(r.url())});
 await page.route(/^https:\/\//,r=>r.abort());
 await page.goto(base);await page.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);
 await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
 await page.evaluate(()=>{const p=createBookPlan();p.title='独立文件转换 · 真实旧版界面';createUI.tab='story';render()});
 await page.locator('[data-act="art-create-tab"][data-tab="settings"]').click();
 await page.locator('[data-act="art-setting-add"]').click();
 await page.locator('#art-new-setting-key').fill('主角参考图');
 await page.locator('#art-new-setting-label').fill('主角参考图');
 await page.locator('#art-new-setting-type').selectOption('image');
 await page.locator('[data-act="art-setting-confirm"]').click();
 await page.locator('[data-image-key="主角参考图"] input').setInputFiles({name:'主角参考.webp',mimeType:'image/webp',buffer:readFileSync(path.join(old,'vendor/default-cover.webp'))});
 await page.waitForFunction(()=>selectedPlan().variables.find(e=>e.key==='主角参考图')?.value?.src?.startsWith('/images/'));
 check('real old UI saves an uploaded image variable and a separate plan',await page.evaluate(()=>savePythonWorkspace(true)));
 const source=await(await fetch(base+'/api/config')).json();
 writeFileSync(expected,JSON.stringify(source));
 check('old workspace contains generated demo artwork and all five original layouts',source.savedGalleries.length>0&&source.uiConfig.comfyStudio.exportTemplates.length>=5);
 check('no generation request or uncaught browser exception occurred',paid.length===0&&errors.length===0);
 await browser.close();browser=null;
 const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await exited;server=null;
 const before=python("import sys,json,pathlib,hashlib\nr=pathlib.Path(sys.argv[1])\nprint(json.dumps({p.relative_to(r).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in r.rglob('*') if p.is_file()},sort_keys=True))",[path.join(old,'data')]);
 const result=spawnSync('python',['tools/convert_file_library.py','--source',old,'--output',output,'--source-stopped'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stdout+result.stderr);
 const report=JSON.parse(result.stdout);
 check('actual saved 1.2.1 data converts and publishes as new files',report.published&&report.sourceUnchanged&&report.counts.albums===source.savedGalleries.length);
 const after=python("import sys,json,pathlib,hashlib\nr=pathlib.Path(sys.argv[1])\nprint(json.dumps({p.relative_to(r).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in r.rglob('*') if p.is_file()},sort_keys=True))",[path.join(old,'data')]);
 check('all old data files, including SQLite state, are byte-for-byte unchanged',before===after);
 const verified=python(`import sys,json,pathlib,hashlib,base64,urllib.parse
from mio_library import FileLibrary,image_refs
from mio_library_workspace import WorkspaceRepository
old=pathlib.Path(sys.argv[1]);expected=json.loads(pathlib.Path(sys.argv[2]).read_bytes())
store=FileLibrary(sys.argv[3]);got=WorkspaceRepository(store).read()
def normalize(v,new=False):
 if isinstance(v,dict):return {k:normalize(x,new) for k,x in v.items() if k not in ('_fileWorkspace','_workspaceActiveOnly')}
 if isinstance(v,list):return [normalize(x,new) for x in v]
 if not isinstance(v,str):return v
 raw=None
 if v.startswith('data:image/'):
  header,data=v.split(',',1);raw=base64.b64decode(data) if header.endswith(';base64') else urllib.parse.unquote_to_bytes(data)
 elif v.startswith('/images/library/'):
  kind,id,relative=v[len('/images/library/'):].split('/',2);raw=store.asset(kind,id,relative)[0]
 elif v.startswith('/images/'):
  rel=urllib.parse.unquote(v[len('/images/'):]);p=old/'data/assets/images'/rel
  if not p.is_file():p=old/'images'/rel
  raw=p.read_bytes()
 return 'image-sha256:'+hashlib.sha256(raw).hexdigest() if raw is not None else v
for field in ('templates','savedGalleries','batchMatrix','chatConfig'):
 assert normalize(got[field],True)==normalize(expected[field]),field
for field in ('projects','creation','exportTemplates'):
 assert normalize(got['uiConfig']['comfyStudio'][field],True)==normalize(expected['uiConfig']['comfyStudio'][field]),field
for kind in ('storyboards','albums','characters','scenes','plans','rows','layouts','conversations','tasks'):
 for row in store.catalog(kind,limit=200)['items']:
  for ref in set(image_refs(store.get(kind,row['id'])['document'])):store.asset(kind,row['id'],ref)
assert all(not b.get('inProgress') for b in got['savedGalleries'])
print(json.dumps({'exactDomainContent':True,'allImageBytesMatch':True,'allOwnedReferencesReadable':True}))
store.close()
`,[old,expected,output]);
 const checksResult=JSON.parse(verified);
 check('all source storyboards, albums, characters, plans, conversations and original layouts retain exact domain content',checksResult.exactDomainContent);
 check('every embedded/uploaded image retains identical bytes in its new owner',checksResult.allImageBytesMatch&&checksResult.allOwnedReferencesReadable);
 if(process.argv.includes('--native')){
   server=spawn('python',['-u',path.join(root,'server.py')],{cwd:root,env:{...process.env,MIO_PORT:'8829',MIO_DATA_DIR:output},stdio:['ignore','pipe','pipe']});
   const nativeBase='http://127.0.0.1:8829';let ready=false;for(let i=0;i<200;i++){try{if((await fetch(nativeBase+'/api/config?summaries=1')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready);
   browser=await chromium.launch({args:['--no-sandbox']});const nativePage=await browser.newPage();const nativeErrors=[],nativePaid=[];nativePage.on('pageerror',e=>nativeErrors.push(e.message));nativePage.on('request',r=>{if(r.method()==='POST'&&/\/api\/image\/generate|\/api\/foundation\/jobs$/.test(r.url()))nativePaid.push(r.url())});await nativePage.route(/^https:\/\//,r=>r.abort());await nativePage.goto(nativeBase);await nativePage.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);await nativePage.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
   check('native GUI boots converted delivered data without eagerly loading album bodies',await nativePage.evaluate(n=>Mio.sync.runtime.loaded&&state.books.length===n&&state.books.every(b=>b._lazy&&b.steps.length===0),source.savedGalleries.length));
   const id=source.savedGalleries[0].id;await nativePage.locator('[data-act=read][data-id="'+id+'"]').first().click();await nativePage.locator('#reader[open]').waitFor();
   check('converted album opens in the real reader and its owned image decodes',await nativePage.locator('#reader-canvas img').first().evaluate(async img=>{await img.decode();return img.naturalWidth>0}));
   const oldTitle=source.templates[0].title,templateId=source.templates[0].id;
   check('native settings edit is confirmed without changing the delivered storyboard',await nativePage.evaluate(async({templateId,oldTitle})=>{state.settings.signature='native baseline check';save();return await savePythonWorkspace()&&templateBy(templateId).title===oldTitle},{templateId,oldTitle}));
   await nativePage.reload();await nativePage.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting);
   check('native per-file save survives reload and preserves delivered plans',await nativePage.evaluate(n=>state.settings.signature==='native baseline check'&&state.creation.plans.length===n,source.uiConfig.comfyStudio.creation.plans.length));
   const zipResponse=await fetch(nativeBase+'/api/library/export/albums/'+id);check('native sharing exports a real self-contained album ZIP',zipResponse.ok&&Buffer.from(await zipResponse.arrayBuffer()).subarray(0,2).toString()==='PK');
   const afterNative=python("import sys,json,pathlib,hashlib\nr=pathlib.Path(sys.argv[1])\nprint(json.dumps({p.relative_to(r).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in r.rglob('*') if p.is_file()},sort_keys=True))",[path.join(old,'data')]);
   check('running and editing the converted native GUI leaves every original file untouched',before===afterNative);
   check('native baseline run has no paid submissions or browser exceptions',nativePaid.length===0&&nativeErrors.length===0);
 }
 console.log(checks+' checks passed. Actual delivered 1.2.1, Chromium, isolated old/new directories. No paid generation.');
}finally{
 await browser?.close();
 if(server?.exitCode===null){const exit=new Promise(r=>server.once('exit',r));server.kill();await exit}
 rmSync(temp,{recursive:true,force:true});
}
