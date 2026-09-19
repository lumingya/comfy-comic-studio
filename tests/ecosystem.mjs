import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdirSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';import {spawn,execFileSync} from 'node:child_process';import {tmpdir} from 'node:os';import path from 'node:path';
/* Platform SDK v2 acceptance: themes (variants + icons), extension lifecycle, every UI slot,
   events, album facade, exporters, data tiers and safe-mode recovery — all through the real UI. */
const temp=mkdtempSync(path.join(tmpdir(),'mio-ecosystem-')),base='http://127.0.0.1:8896',artifacts='docs/acceptance-ecosystem';mkdirSync(artifacts,{recursive:true});
const py=process.platform==='win32'?'python':'python3';
execFileSync(py,['-c',`import pathlib,shutil,sys\ns=pathlib.Path(sys.argv[1]);d=pathlib.Path(sys.argv[2]);d.mkdir()\nfor name in ['backend','js','vendor','data','docs']:\n shutil.copytree(s/name,d/name,ignore=shutil.ignore_patterns('__pycache__','acceptance*'))\nfor name in ['server.py','styles.css','index.html','favicon.svg']:shutil.copy2(s/name,d/name)`,process.cwd(),temp+'/app']);
const server=spawn(py,['server.py'],{cwd:temp+'/app',env:{...process.env,MIO_HOST:'127.0.0.1',MIO_PORT:'8896',MIO_DATA_DIR:temp+'/data'},stdio:'ignore'});
let browser,p,n=0;const errors=[];const check=(name,v)=>{assert.ok(v,name);console.log('PASS '+name);n++};
const zipOf=folder=>execFileSync(py,['-c',`import io,zipfile,pathlib,base64,sys\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:\n for p in pathlib.Path(sys.argv[1]).glob('*'):\n  if p.is_file():z.write(p,p.name)\nprint(base64.b64encode(b.getvalue()).decode())`,folder]).toString().trim();
async function boot(suffix=''){await p.goto(base+suffix);await p.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting&&typeof ecoState!=='undefined'&&ecoState.status.sdkVersion===2);await p.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.settings.identity.onboarded=true;guidePreferences().seen=true})}
async function view(tab){await p.evaluate(tab=>{studioUI.settingsTab=tab;navigate(5)},tab)}
async function shot(name){await p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));await p.screenshot({path:artifacts+'/'+name+'.png',fullPage:true})}
async function install(kind,b64,name){await p.evaluate(([b64,name,kind])=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));void importEcosystemFile(new File([bytes],name),kind)},[b64,name,kind]);await p.locator('#confirm-yes').click()}
try{
 for(let i=0;i<150;i++){try{if((await fetch(base+'/api/content')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({args:['--no-sandbox']});p=await browser.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errors.push(e.message));await boot();
 check('platform manifest lists built-in providers and exporters',await p.evaluate(()=>ecoState.status.platform.providers.some(x=>x.id==='comfyui')&&ecoState.status.platform.exporters.length>=1));
 check('no hardcoded hex colors remain outside token blocks',(()=>{const css=readFileSync('styles.css','utf8').replace(/:root[^{}]*\{[^{}]*\}|\[data-theme=light\]\{[^{}]*\}/g,'');return !/#[0-9a-fA-F]{3,8}\b/.test(css)})());

 /* ---- themes v2 -------------------------------------------------------------------- */
 await view('themes');await install('theme',zipOf('examples/themes/paper-atelier'),'paper-atelier.zip');await p.waitForFunction(()=>ecoState.status.themes.items.length===1);
 await p.locator('[data-act="eco-theme-use"][data-id="paper-atelier"]').click();await p.waitForSelector('#mio-user-theme',{state:'attached'});
 const themeCss=await p.evaluate(()=>document.getElementById('mio-user-theme').textContent);
 check('v2 theme compiles tokens per mode and scopes variant CSS',themeCss.includes(':root[data-theme=dark]{')&&themeCss.includes(':root[data-theme=light]{')&&themeCss.includes('[data-theme=light] .sidebar'));
 check('theme icon pack is mounted and rendered through icon()',await p.evaluate(()=>MioIcons.resolve('book')?.includes('M4 5.5')&&document.querySelector('.nav-item .icon')?.innerHTML.includes('M4 5.5')));
 const before=await p.evaluate(()=>getComputedStyle(document.body).backgroundColor);await p.evaluate(()=>{document.documentElement.dataset.theme='light'});const after=await p.evaluate(()=>getComputedStyle(document.body).backgroundColor);
 check('one theme package reacts to host dark/light mode',before!==after);await shot('01-theme-light');await p.evaluate(()=>{document.documentElement.dataset.theme='dark'});await shot('02-theme-dark');
 await boot('/?safe_mode=1');check('safe mode excludes theme CSS, icon packs and offers recovery',await p.evaluate(()=>!document.getElementById('mio-user-theme')&&MioIcons.packs.size===0&&!!document.getElementById('mio-safe-recovery')));await boot();
 await view('themes');await p.locator('[data-act="eco-theme-off"]').first().click();await p.waitForFunction(()=>!document.getElementById('mio-user-theme'));check('switching back unmounts icon pack',await p.evaluate(()=>MioIcons.packs.size===0));

 /* ---- extension lifecycle ----------------------------------------------------------- */
 await view('extensions');await install('extension',zipOf('examples/extensions/studio-kit'),'studio-kit.zip');await p.waitForFunction(()=>ecoState.status.extensions.some(x=>x.id==='studio-kit'));
 check('imported extension is disabled until trusted',await p.evaluate(()=>!ecoState.status.extensions[0].enabled&&!ecoState.loaded.has('studio-kit')));
 await p.locator('[data-act="eco-extension-toggle"][data-id="studio-kit"]').click();await p.locator('#confirm-yes').click();await p.waitForFunction(()=>ecoState.loaded.has('studio-kit')&&!ecoState.loaded.get('studio-kit').failed);
 check('extension loads without errors and reports capabilities',await p.evaluate(()=>ecoState.errors.length===0&&ecoState.status.extensions[0].capabilities.providers.includes('echo-canvas')));
 check('backend provider registered by the extension appears in the platform manifest',await p.evaluate(()=>ecoState.status.platform.providers.some(x=>x.id==='echo-canvas'&&x.owner==='studio-kit')));
 check('backend hooks/events/exporters registered',await p.evaluate(()=>{const m=ecoState.status.platform;return m.hooks.find(h=>h.name==='render.before').handlers.some(x=>(x.owner||x)==='studio-kit')&&m.exporters.some(e=>e.id==='studio-kit:cbz')}));
 await shot('03-extension-center');

 /* ---- UI slots ---------------------------------------------------------------------- */
 check('nav slot adds a workspace entry',await p.locator('.nav-item.mio-nav-item[data-route="studio-kit:notebook"]').count()===1);
 await p.locator('.nav-item.mio-nav-item[data-route="studio-kit:notebook"]').click();await p.waitForSelector('#mio-ext-body .settings-section');
 check('extension page renders with plan context and backend route data',await p.evaluate(()=>ui.workspace==='studio-kit:notebook'&&document.querySelector('#mio-ext-body').textContent.includes('当前上下文')&&document.querySelector('.nav-item.mio-nav-item').classList.contains('active')));await shot('04-extension-page');
 await p.evaluate(()=>{createUI.tab='scenes';navigate(1)});await p.waitForSelector('.quiet-scene-top');
 check('frame-card slot injects quick action on the active frame',await p.locator('.quiet-scene-top [data-act="mio-slot"][data-slot="frame-card"]').count()===1);
 check('toolbar slot injects into storyboard actions',await p.locator('.source-story-actions [data-act="mio-slot"][data-slot="toolbar"]').count()===1);
 const promptBefore=await p.evaluate(()=>MioAlbums.current().frame.prompt);await p.locator('.quiet-scene-top [data-act="mio-slot"][data-slot="frame-card"]').click();await p.waitForFunction(b=>MioAlbums.current().frame.prompt!==b,promptBefore);
 check('frame-card action mutates the frame through the albums facade',await p.evaluate(()=>MioAlbums.current().frame.prompt.startsWith('(masterpiece)')));
 await p.locator('.quiet-scene[data-index="0"]').first().click({button:'right'});await p.waitForSelector('#mio-context-menu');
 check('frame context menu shows extension entries only for kind=frame',await p.evaluate(()=>[...document.querySelectorAll('#mio-context-menu [data-act="mio-context-item"] span')].map(x=>x.textContent).join('|')==='复制这一格的提示词'));await shot('05-frame-context');await p.keyboard.press('Escape');
 await p.locator('#mio-dock-toggle').click();await p.waitForSelector('#mio-dock:not([hidden]) .mio-dock-body pre');check('dock panel renders in the shared drawer',await p.evaluate(()=>document.querySelector('#mio-dock .mio-dock-tabs button.active')?.textContent.includes('事件流')));await shot('06-dock');await p.locator('#mio-dock [data-act="mio-dock-toggle"]').click();
 await p.evaluate(()=>openCommand());await p.locator('#command-input').fill('笔记');await p.waitForFunction(()=>document.querySelector('#command-results')?.textContent.includes('工作室笔记'));check('command palette lists extension commands and pages',true);await p.keyboard.press('Escape');
 await p.evaluate(async()=>{await savePythonWorkspace();navigate(0)});await p.waitForSelector('[data-act="mio-slot"][data-slot="album-card"]');check('album-card slot appears on album cards',true);
 const firstBook=await p.evaluate(()=>state.books[0].id);await p.evaluate(id=>openBookContext(id,300,300),firstBook);await p.waitForSelector('#book-context-menu [data-act="mio-export"]');
 check('album context menu gains extension entries plus every exporter',await p.evaluate(()=>{const m=document.querySelector('#book-context-menu');return m.querySelector('[data-act="mio-context-item"]')&&m.querySelector('[data-act="mio-export"][data-exporter="studio-kit:cbz"]')&&m.querySelector('[data-act="mio-export"][data-exporter="studio-kit:script-txt"]')}));await shot('07-album-context');
 const dl=p.waitForEvent('download');await p.locator('#book-context-menu [data-act="mio-export"][data-exporter="studio-kit:cbz"]').click();const download=await dl;await download.saveAs(temp+'/album.cbz');
 check('backend exporter streams a real CBZ',readFileSync(temp+'/album.cbz').subarray(0,2).toString()==='PK'&&(await download.suggestedFilename()).endsWith('.cbz'));
 const dl2=p.waitForEvent('download');await p.evaluate(id=>mioExportAlbum('studio-kit:script-txt',id),firstBook);const download2=await dl2;await download2.saveAs(temp+'/album.txt');check('browser exporter downloads text',readFileSync(temp+'/album.txt','utf8').includes('#1'));
 await p.evaluate(id=>openReader(id),firstBook);await p.waitForSelector('#reader[open]');await p.evaluate(()=>{artUI.showInfo=true;renderRoomInfo()});await p.waitForSelector('#room-info .mio-inspector-section textarea');
 check('inspector slot renders inside the reader info panel',true);await shot('08-inspector');await p.evaluate(()=>closeReader());

 /* ---- events, facade, data tiers ---------------------------------------------------- */
 const facade=await p.evaluate(async()=>{const seen=[];const off=MioPlatform.on('album.saved',e=>seen.push(e.id));const book=MioAlbums.update(state.books[0].id,{tags:['sdk']});off();const events=(await ecoRequest('activity?since=0')).events.map(e=>e.name);return {tags:book.tags,seen,relayed:events.includes('album.saved')||events.includes('frame.updated')}});
 check('albums facade writes, emits locally and relays to the backend bus',facade.tags[0]==='sdk'&&facade.seen.length===1&&facade.relayed);
 const tiers=await p.evaluate(async()=>{const ctx=ecoContext('studio-kit');await ctx.data.config.set('k',1);await ctx.data.cache.set('k',2);await ctx.storage.set('k',3);return [await ctx.data.config.get('k'),await ctx.data.cache.get('k'),await ctx.storage.get('k')]});
 check('data tiers are isolated (config / cache / workspace)',tiers.join()==='1,2,3');
 const purged=await p.evaluate(async()=>{await ecoRequest('extensions/purge',{id:'studio-kit',level:'cache'});const ctx=ecoContext('studio-kit');return [await ctx.data.cache.get('k'),await ctx.data.config.get('k')]});
 check('cache purge keeps config',purged[0]===null&&purged[1]===1);
 const settings=await p.evaluate(async()=>{const ctx=ecoContext('studio-kit');await ctx.settings.set({suffix:'ink wash',stamp:false,dockOnStart:false});return (await ctx.settings.get()).suffix});check('declared settings persist through the config tier',settings==='ink wash');
 await view('extensions');await p.locator('[data-act="eco-extension-toggle"][data-id="studio-kit"]').click();await p.waitForFunction(()=>!ecoState.loaded.has('studio-kit'));
 check('disable removes every slot, command, exporter and nav page',await p.evaluate(()=>MioPlatform.SLOTS.every(s=>MioPlatform.items(s).length===0)&&MioPlatform.exporters.size===0&&!document.querySelector('.mio-nav-item')&&!ecoState.status.platform.providers.some(x=>x.id==='echo-canvas')));
 await p.evaluate(()=>{rt.ecoRemoveId='studio-kit'});await p.evaluate(()=>v3Actions['eco-extension-remove']({id:'studio-kit'}));await p.locator('input[name="eco-purge"][value="none"]').check();await p.locator('[data-act="eco-extension-remove-confirm"]').click();await p.waitForFunction(()=>ecoState.status.extensions.length===0);
 check('uninstall with purge=none keeps tiered data for reinstall',execFileSync(py,['-c',`import pathlib,sys;print((pathlib.Path(sys.argv[1])/'packages'/'extensions'/'studio-kit'/'config'/'k.json').exists() or (pathlib.Path(sys.argv[1])/'packages'/'extensions'/'studio-kit'/'config').exists())`,temp+'/data']).toString().trim()==='True');

 await p.setViewportSize({width:390,height:844});await view('extensions');await shot('09-mobile-extensions');check('mobile ecosystem has no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 check('no uncaught browser errors',errors.length===0);console.log(`${n} ecosystem assertions PASS`);
}finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));rmSync(temp,{recursive:true,force:true})}
