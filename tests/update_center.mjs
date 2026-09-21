/* End-to-end update flow: a copy of this checkout runs as "v-current", a second copy is packaged as a newer release and
   served by a fake GitHub API on loopback. The browser drives 设置 → 关于与更新: check → install → restart → verify →
   rollback → restart. The data directory must be byte-identical afterwards.
   Run: node tests/update_center.mjs */
import {chromium} from 'playwright';
import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=process.env.PYTHON||'python3';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mio-update-'));
const programDir=path.join(temp,'program'),buildDir=path.join(temp,'build'),dataDir=path.join(temp,'data'),releaseDir=path.join(temp,'releases');
let count=0,failures=0;
const check=(label,ok)=>{count++;if(!ok)failures++;console.log((ok?'PASS':'FAIL')+' '+label)};
const SKIP=new Set(['.git','node_modules','data','releases','.mio-updates','.scratch','test-results','__pycache__','tests/evidence']);
function copyTree(from,to,rel=''){
  fs.mkdirSync(to,{recursive:true});
  for(const entry of fs.readdirSync(from,{withFileTypes:true})){
    const childRel=rel?rel+'/'+entry.name:entry.name;if(SKIP.has(entry.name)||SKIP.has(childRel))continue;
    const source=path.join(from,entry.name),target=path.join(to,entry.name);
    if(entry.isSymbolicLink())continue;
    if(entry.isDirectory())copyTree(source,target,childRel);else fs.copyFileSync(source,target);
  }
}
function hashTree(dir){
  const out=[];const walk=(d,rel)=>{for(const entry of fs.readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(d,entry.name),r=rel+'/'+entry.name;if(entry.isDirectory())walk(p,r);else out.push(r+':'+crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'))}};
  if(fs.existsSync(dir))walk(dir,'');return crypto.createHash('sha256').update(out.join('\n')).digest('hex');
}
const currentVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const nextVersion=currentVersion.replace(/-.*$/,'').split('.').map((n,i)=>i===2?Number(n)+1:n).join('.')+'-e2e.1';
console.log(`current ${currentVersion} → release ${nextVersion}`);

// 1. program copy (runs as the installed studio; shipped data/ comes from the checkout so first use bootstraps normally)
copyTree(root,programDir);copyTree(path.join(root,'data'),path.join(programDir,'data'));
// 2. newer build: bump version everywhere the studio reads it, regenerate the distribution manifest, package
copyTree(root,buildDir);copyTree(path.join(root,'data'),path.join(buildDir,'data'));
const pkg=JSON.parse(fs.readFileSync(path.join(buildDir,'package.json'),'utf8'));pkg.version=nextVersion;fs.writeFileSync(path.join(buildDir,'package.json'),JSON.stringify(pkg,null,2)+'\n');
const appJs=path.join(buildDir,'js/app.js');fs.writeFileSync(appJs,fs.readFileSync(appJs,'utf8').replace(/const MIO_VERSION='[^']*'/,`const MIO_VERSION='${nextVersion}'`));
fs.writeFileSync(path.join(buildDir,'docs/E2E_UPDATE_NOTE.md'),'# e2e\nAdded by the update test.\n');
execFileSync(python,[path.join(buildDir,'tools/build_distribution.py')],{stdio:'inherit'});
execFileSync(python,[path.join(buildDir,'tools/package_project.py'),'--output',releaseDir],{stdio:'inherit'});
const assetName=`mio-${nextVersion}-source.zip`,assetPath=path.join(releaseDir,assetName),checksumText=fs.readFileSync(assetPath+'.sha256','utf8');
check('release package and checksum exist',fs.existsSync(assetPath)&&checksumText.includes(assetName));

// 3. fake GitHub API on loopback
const api=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname==='/repos/e2e/mio/releases'){
    const body=JSON.stringify([
      {tag_name:'v0.0.1',name:'ancient',draft:false,prerelease:false,published_at:'2024-01-01T00:00:00Z',html_url:'http://127.0.0.1/rel/0',body:'',assets:[]},
      {tag_name:'v'+nextVersion,name:'Mio '+nextVersion,draft:false,prerelease:true,published_at:new Date().toISOString(),html_url:'http://127.0.0.1/rel/1',body:'## 更新内容\n- 端到端更新测试\n',assets:[
        {name:assetName,size:fs.statSync(assetPath).size,browser_download_url:`http://127.0.0.1:${api.address().port}/dl/${assetName}`},
        {name:assetName+'.sha256',size:checksumText.length,browser_download_url:`http://127.0.0.1:${api.address().port}/dl/${assetName}.sha256`}]}
    ]);
    response.writeHead(200,{'Content-Type':'application/json'});response.end(body);return;
  }
  if(url.pathname.startsWith('/dl/')){const file=path.join(releaseDir,path.basename(url.pathname));if(!fs.existsSync(file)){response.writeHead(404);response.end();return}response.writeHead(200,{'Content-Length':fs.statSync(file).size});fs.createReadStream(file).pipe(response);return}
  response.writeHead(404);response.end();
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));

// 4. run the program copy
const port=18000+Math.floor(Math.random()*2000);
const env={...process.env,MIO_DATA_DIR:dataDir,MIO_PORT:String(port),MIO_UPDATE_REPO:'e2e/mio',MIO_UPDATE_API:`http://127.0.0.1:${api.address().port}`,MIO_GITHUB_TOKEN:''};
let server=spawn(python,[path.join(programDir,'server.py')],{env,cwd:programDir,stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',d=>{serverLog+=d});server.stderr.on('data',d=>{serverLog+=d});
const base=`http://127.0.0.1:${port}`;
async function waitForServer(expectVersion,timeout=60000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    try{const r=await fetch(base+'/api/update/status');if(r.ok){const data=(await r.json()).data;if(!expectVersion||data.current===expectVersion)return data}}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  throw Error('server did not come up with version '+expectVersion+'\n'+serverLog.slice(-2000));
}
try{
  const status0=await waitForServer(currentVersion);
  check('program copy reports the current version',status0.current===currentVersion&&['source','package'].includes(status0.install.kind));if(status0.current!==currentVersion)console.log('[debug] status0',JSON.stringify(status0.install),status0.current);
  const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(process.env.DEBUG_UPDATE)console.log('[page]',m.type(),m.text().slice(0,300))});
  await page.goto(base+'/index.html');await page.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting,null,{timeout:60000});
  await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close())});
  // give the studio a name so the data dir carries real user state, then snapshot it
  await page.evaluate(async()=>{state.settings.identity.studioName='更新测试工作室';state.settings.identity.onboarded=true;save();await savePythonWorkspace?.()});
  await page.waitForTimeout(1500);
  const dataHashBefore=hashTree(dataDir);
  check('data directory has user state before the update',fs.existsSync(dataDir)&&dataHashBefore.length===64);

  await page.evaluate(()=>handleAction('v3-settings-tab',{tab:'about'}));await page.waitForSelector('#update-center');
  await page.locator('[data-act="update-check"]').click();
  await page.waitForSelector('[data-act="update-apply"]',{timeout:30000});
  check('check finds the newer release',(await page.locator('#update-status-line').textContent()).includes(nextVersion));
  check('release notes are rendered from the GitHub body',await page.evaluate(()=>document.querySelector('.update-notes')?.textContent.includes('端到端更新测试')));
  await page.locator('[data-act="update-apply"]').click();
  await page.locator('#confirm-yes').click();
  await page.waitForSelector('.update-job.is-done',{timeout:120000});
  check('install job finishes and asks for a restart',await page.locator('[data-act="update-restart"]').count()===1);
  const lastUpdate=(await (await fetch(base+'/api/update/status')).json()).data.lastUpdate;
  check('last-update record points to a backup directory',lastUpdate&&lastUpdate.to===nextVersion&&fs.existsSync(path.join(lastUpdate.backupDir,'backup.json')));
  check('new file from the release is installed',fs.existsSync(path.join(programDir,'docs/E2E_UPDATE_NOTE.md')));
  check('package.json in the program dir now carries the new version',JSON.parse(fs.readFileSync(path.join(programDir,'package.json'),'utf8')).version===nextVersion);
  check('data directory is untouched by the install',hashTree(dataDir)===dataHashBefore);

  await page.locator('[data-act="update-restart"]').click();await page.locator('#confirm-yes').click();
  const statusAfter=await waitForServer(nextVersion,90000);
  check('server restarts itself into the new version',statusAfter.current===nextVersion);
  if(process.env.DEBUG_UPDATE){await page.waitForTimeout(12000);console.log('[debug] updateCenter',await page.evaluate(()=>JSON.stringify({restarting:updateCenter.restarting,error:updateCenter.error,current:updateCenter.status?.current,version:MIO_VERSION,url:location.href})).catch(e=>e.message))}
  await page.waitForFunction(v=>typeof MIO_VERSION!=='undefined'&&MIO_VERSION===v,nextVersion,{timeout:90000});
  check('page reloads by itself and runs the new frontend',await page.evaluate(()=>MIO_VERSION)===nextVersion);
  await page.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting,null,{timeout:60000});
  check('studio name survives the update',await page.evaluate(()=>state.settings.identity.studioName)==='更新测试工作室');
  check('data directory is untouched after the restart',hashTree(dataDir)===dataHashBefore);

  // rollback
  await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());handleAction('v3-settings-tab',{tab:'about'})});
  await page.waitForSelector('[data-act="update-rollback"]',{timeout:30000});
  await page.locator('[data-act="update-rollback"]').click();await page.locator('#confirm-yes').click();
  await page.waitForSelector('[data-act="update-restart"]',{timeout:30000});
  check('rollback restores the previous package.json',JSON.parse(fs.readFileSync(path.join(programDir,'package.json'),'utf8')).version===currentVersion);
  check('rollback removes files the release had added',!fs.existsSync(path.join(programDir,'docs/E2E_UPDATE_NOTE.md')));
  await page.locator('[data-act="update-restart"]').click();await page.locator('#confirm-yes').click();
  const statusBack=await waitForServer(currentVersion,90000);
  check('server restarts back into the previous version',statusBack.current===currentVersion);
  check('data directory is still untouched after rollback',hashTree(dataDir)===dataHashBefore);
  check('no uncaught browser errors',errors.length===0);
  if(errors.length)console.log(errors);
  await browser.close();
}finally{
  try{const status=await fetch(base+'/api/update/status').catch(()=>null);void status}catch{}
  // the server re-exec'd itself, so kill by port owner rather than the original child
  try{execFileSync('sh',['-c',`kill $(ss -ltnp 2>/dev/null | grep ':${port} ' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u) 2>/dev/null || true`])}catch{}
  server.kill();api.close();
  if(!process.env.KEEP_TEMP)fs.rmSync(temp,{recursive:true,force:true});
}
console.log(`\n${count-failures}/${count} update center checks PASS`);
process.exit(failures?1:0);
