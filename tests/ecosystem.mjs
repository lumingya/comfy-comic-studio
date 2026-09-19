import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdirSync,readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,utimesSync} from 'node:fs';import {spawn,execFileSync} from 'node:child_process';import {tmpdir} from 'node:os';import path from 'node:path';
/* Platform SDK v3 acceptance: theme stack (variants, settings, scripts, icons), Style Studio (live
   snippets, element picker, tokens, assets, export), extension lifecycle incl. linked folders + hot
   reload, every UI slot/anchor/mount/patch/filter/key, tasks + raw responses, events, album facade,
   exporters, data tiers and safe-mode recovery — all through the real UI. */
const temp=mkdtempSync(path.join(tmpdir(),'mio-ecosystem-')),base='http://127.0.0.1:8896',artifacts='docs/acceptance-ecosystem';mkdirSync(artifacts,{recursive:true});
const py=process.platform==='win32'?'python':'python3';
execFileSync(py,['-c',`import pathlib,shutil,sys\ns=pathlib.Path(sys.argv[1]);d=pathlib.Path(sys.argv[2]);d.mkdir()\nfor name in ['backend','js','vendor','data','docs','examples']:\n shutil.copytree(s/name,d/name,ignore=shutil.ignore_patterns('__pycache__','acceptance*'))\nfor name in ['server.py','styles.css','index.html','favicon.svg']:shutil.copy2(s/name,d/name)`,process.cwd(),temp+'/app']);
const server=spawn(py,['server.py'],{cwd:temp+'/app',env:{...process.env,MIO_HOST:'127.0.0.1',MIO_PORT:'8896',MIO_DATA_DIR:temp+'/data'},stdio:'ignore'});
let browser,p,n=0;const errors=[];const check=(name,v)=>{assert.ok(v,name);console.log('PASS '+name);n++};
const zipOf=folder=>execFileSync(py,['-c',`import io,zipfile,pathlib,base64,sys\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:\n for p in pathlib.Path(sys.argv[1]).glob('*'):\n  if p.is_file():z.write(p,p.name)\nprint(base64.b64encode(b.getvalue()).decode())`,folder]).toString().trim();
async function boot(suffix=''){await p.goto(base+suffix);await p.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting&&typeof ecoState!=='undefined'&&ecoState.status.sdkVersion===3&&Array.isArray(ecoState.status.platform?.providers)&&(ecoState.themeCompiled||window.MioSafeMode));await p.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.settings.identity.onboarded=true;guidePreferences().seen=true})}
async function view(tab){await p.evaluate(tab=>{studioUI.settingsTab=tab;navigate(5)},tab)}
async function studio(tab){await view('themes');await p.evaluate(tab=>{styleStudio.tab=tab;render()},tab);await p.waitForFunction(()=>styleStudio.loaded);await p.evaluate(async()=>{await ssLoad(true);render()})}
async function shot(name){await p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));await p.screenshot({path:artifacts+'/'+name+'.png',fullPage:true})}
async function install(kind,b64,name){await p.evaluate(([b64,name,kind])=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));void importEcosystemFile(new File([bytes],name),kind)},[b64,name,kind]);await p.locator('#confirm-yes').click()}
const layer=name=>p.evaluate(name=>document.head.querySelector(`style[data-mio-layer="${name}"]`)?.textContent||'',name);
const linkedKit=path.join(temp,'app','examples','extensions','studio-kit');
try{
 for(let i=0;i<150;i++){try{if((await fetch(base+'/api/content')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({args:['--no-sandbox']});p=await browser.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errors.push(e.message));await boot();
 check('platform manifest lists built-in providers and exporters',await p.evaluate(()=>ecoState.status.platform.providers.some(x=>x.id==='comfyui')&&ecoState.status.platform.exporters.length>=1));
 check('no hardcoded hex colors remain outside token blocks',(()=>{const css=readFileSync('styles.css','utf8').replace(/:root[^{}]*\{[^{}]*\}|\[data-theme=light\]\{[^{}]*\}/g,'');return !/#[0-9a-fA-F]{3,8}\b/.test(css)})());
 check('style layers exist in <head> in cascade order',await p.evaluate(()=>[...document.head.querySelectorAll('style[data-mio-layer]')].map(s=>s.dataset.mioLayer).join()==='themes,theme-settings,extensions,user-tokens,user-snippets'));

 /* ---- theme stack ------------------------------------------------------------------- */
 await studio('themes');await install('theme',zipOf('examples/themes/paper-atelier'),'paper-atelier.zip');await p.waitForFunction(()=>ecoState.status.themes.stack.includes('paper-atelier')&&document.head.querySelector('style[data-mio-layer="themes"]').textContent.includes('theme: paper-atelier'));
 const themeCss=await layer('themes');
 check('theme is enabled on import; tokens per mode, scoped variants and rewritten asset URLs',themeCss.includes(':root[data-theme=dark]{')&&themeCss.includes('[data-theme=light] .sidebar')&&themeCss.includes('[data-theme-variant~=sepia]')&&/url\("\/theme-assets\/paper-atelier\/[a-z0-9]+\/paper\.png"\)/.test(themeCss)&&!themeCss.includes('data:image'));
 check('theme assets are served with an immutable revision URL',await p.evaluate(async()=>{const url=/\/theme-assets\/paper-atelier\/[a-z0-9]+\/paper\.png/.exec(document.head.querySelector('style[data-mio-layer="themes"]').textContent)[0];const r=await fetch(url);return r.ok&&r.headers.get('content-type')==='image/png'&&(r.headers.get('cache-control')||'').includes('immutable')}));
 check('theme icon pack is mounted and rendered through icon()',await p.evaluate(()=>MioIcons.resolve('book')?.includes('M4 5.5')&&icon('book').includes('M4 5.5')));
 await p.waitForSelector('.paper-stamp');check('theme script (theme.js) runs with ctx and mounts UI',true);
 const before=await p.evaluate(()=>getComputedStyle(document.body).backgroundColor);await p.evaluate(()=>{document.documentElement.dataset.theme='light'});const after=await p.evaluate(()=>getComputedStyle(document.body).backgroundColor);
 check('one theme package reacts to host dark/light mode',before!==after);await shot('01-theme-light');await p.evaluate(()=>{document.documentElement.dataset.theme='dark'});
 await p.evaluate(()=>{styleStudio.openTheme='paper-atelier';render()});await p.locator('[data-ss-theme-settings="paper-atelier"] select[data-ss-theme-variant]').selectOption('sepia');
 await p.waitForFunction(()=>document.documentElement.dataset.themeVariant==='sepia');check('custom variant is selectable and scoped via data-theme-variant',await p.evaluate(()=>getComputedStyle(document.body).filter.includes('saturate')));
 await p.locator('[data-ss-theme-settings="paper-atelier"] [data-eco-setting="accent"]').fill('#ff0000');await p.waitForFunction(()=>document.head.querySelector('style[data-mio-layer="theme-settings"]').textContent.includes('--accent:#ff0000'));
 check('theme settings apply live as CSS variables',await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#ff0000'));
 await p.locator('[data-ss-theme-settings="paper-atelier"] [data-eco-setting="stamp"]').uncheck();await p.waitForFunction(()=>!document.querySelector('.paper-stamp'));check('theme script receives live setting changes (onSettings)',true);
 await p.waitForTimeout(600);check('theme settings persist on the backend',await p.evaluate(async()=>{const s=await ecoRequest('status');const t=s.themes.items.find(x=>x.id==='paper-atelier');return t.values.accent==='#ff0000'&&t.values.__variant==='sepia'&&t.values.stamp===false}));
 await shot('02-theme-settings');
 await install('theme',Buffer.from(readFileSync('examples/themes/orbital-night.css')).toString('base64'),'orbital-night.css');await p.waitForFunction(()=>ecoState.status.themes.stack.length===2&&document.head.querySelector('style[data-mio-layer="themes"]').textContent.includes('theme: orbital-night'));
 check('a plain .css file installs as a second, stacked theme (top of stack)',await p.evaluate(()=>ecoState.status.themes.stack.join()==='paper-atelier,orbital-night'&&document.head.querySelector('style[data-mio-layer="themes"]').textContent.indexOf('theme: orbital-night')>document.head.querySelector('style[data-mio-layer="themes"]').textContent.indexOf('theme: paper-atelier')));
 await p.locator('.ss-theme[data-id="orbital-night"] [data-act="ss-theme-move"][data-dir="down"]').click();await p.waitForFunction(()=>ecoState.status.themes.stack.join()==='orbital-night,paper-atelier');check('stack order can be changed from the UI',true);
 await p.locator('[data-ss-theme-toggle="orbital-night"]').uncheck();await p.waitForFunction(()=>ecoState.status.themes.stack.join()==='paper-atelier');check('themes can be toggled off without uninstalling',await p.evaluate(()=>ecoState.status.themes.items.length===2));

 /* ---- style studio: snippets, picker, tokens, assets, export ------------------------- */
 await studio('snippets');await p.locator('[data-act="ss-snippet-new"]').first().click();await p.waitForSelector('#ss-css');
 await p.locator('#ss-name').fill('圆角按钮');await p.locator('#ss-css').fill('.btn{border-radius:19px}\n.statusbar{letter-spacing:.3em}');
 await p.waitForFunction(()=>document.head.querySelector('style[data-mio-layer="user-snippets"]').textContent.includes('border-radius:19px'));
 check('snippet edits preview live before saving',await p.evaluate(()=>getComputedStyle(document.querySelector('.statusbar')).letterSpacing!=='normal'&&styleStudio.draft.dirty));
 await p.locator('#ss-css').press('Control+s');await p.waitForFunction(()=>styleStudio.snippets.length===1&&!styleStudio.draft.dirty);
 check('Ctrl+S saves the snippet through the API',await p.evaluate(async()=>(await ecoRequest('styles')).snippets[0].css.includes('border-radius:19px')));
 await p.locator('[data-act="ss-pick"]').first().click();await p.waitForSelector('#mio-pick-box');
 const bar=await p.evaluate(()=>{const el=document.querySelector('#statusbar');el.scrollIntoView({block:'end'});const b=el.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}});
 await p.mouse.move(bar.x-80,bar.y-120);await p.mouse.move(bar.x,bar.y,{steps:4});await p.waitForFunction(()=>document.querySelector('#mio-pick-box')?.textContent==='#statusbar');await p.mouse.click(bar.x,bar.y);
 await p.waitForFunction(()=>!document.querySelector('#mio-pick-box'));
 check('element picker inserts a selector for the clicked element and cancels the click',await p.evaluate(()=>styleStudio.draft.css.includes('#statusbar')&&ui.workspace===5));
 await shot('03-style-studio-snippets');
 await studio('tokens');await p.locator('#ss-token-search').fill('--accent');await p.waitForSelector('.ss-token[data-name="--accent"]');
 await p.locator('.ss-token[data-name="--accent"] input[data-ss-token]').fill('#00aa66');await p.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#00aa66');
 check('design token overrides beat theme settings and apply instantly',true);await p.waitForTimeout(900);
 check('token overrides persist',await p.evaluate(async()=>(await ecoRequest('styles')).tokens.shared['--accent']==='#00aa66'));await shot('04-style-studio-tokens');
 const png=readFileSync('examples/themes/paper-atelier/paper.png').toString('base64');
 check('style assets upload and are served from /style-assets/',await p.evaluate(async b64=>{await ecoRequest('styles/assets/upload',{name:'grain.png',data:b64});const r=await fetch('/style-assets/grain.png');return r.ok&&r.headers.get('content-type')==='image/png'},png));
 await studio('assets');await p.waitForSelector('.ss-asset');await p.locator('[data-act="ss-asset-background"]').click();await p.waitForFunction(()=>styleStudio.draft?.css.includes('/style-assets/grain.png'));check('assets tab drafts a background snippet',true);
 const exported=await p.evaluate(async()=>{const r=await ecoRequest('styles/export',{name:'验收主题'});const buf=new Uint8Array(await r.arrayBuffer());return {pk:buf[0]===80&&buf[1]===75,size:buf.length,name:r.headers.get('Content-Disposition')||''}});
 check('user styles export as an installable theme ZIP',exported.pk&&exported.size>200&&exported.name.includes('.mio-theme.zip'));
 await boot();check('user tokens and snippets survive a reload',await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#00aa66'&&document.head.querySelector('style[data-mio-layer="user-snippets"]').textContent.includes('border-radius:19px')));

 /* ---- safe mode ----------------------------------------------------------------------- */
 await boot('/?safe_mode=1');check('safe mode excludes themes, user styles, theme scripts and icon packs, and offers recovery',await p.evaluate(()=>[...document.head.querySelectorAll('style[data-mio-layer]')].every(s=>!s.textContent)&&MioIcons.packs.size===0&&!document.querySelector('.paper-stamp')&&!!document.getElementById('mio-safe-recovery')&&getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()!=='#00aa66'));await boot();
 await studio('themes');await p.locator('[data-act="ss-theme-clear"]').click();await p.waitForFunction(()=>!document.head.querySelector('style[data-mio-layer="themes"]').textContent);check('closing all themes unmounts icon packs and scripts',await p.evaluate(()=>MioIcons.packs.size===0&&!document.querySelector('.paper-stamp')&&ecoState.themeScripts.size===0));
 await p.evaluate(async()=>{await ecoRequest('styles/tokens',{tokens:{}});styleStudio.snippets.forEach(s=>{s.enabled=false});await ssPersistSnippets();await applyEcosystemTheme()});

 /* ---- extension lifecycle: linked folder --------------------------------------------- */
 await view('extensions');await p.evaluate(()=>v3Actions['eco-extension-link']());await p.locator('#eco-link-path').fill(linkedKit);await p.locator('#eco-link-trust').check();await p.locator('[data-act="eco-link-submit"]').click();
 await p.waitForFunction(()=>ecoState.loaded.has('studio-kit')&&!ecoState.loaded.get('studio-kit').failed);
 check('linked folder installs, enables and loads without errors',await p.evaluate(()=>ecoState.errors.length===0&&ecoState.status.extensions[0].source==='link'&&ecoState.status.extensions[0].capabilities.providers.includes('echo-canvas')&&ecoState.status.watching));
 check('backend provider / hooks / exporters registered',await p.evaluate(()=>{const m=ecoState.status.platform;return m.providers.some(x=>x.id==='echo-canvas'&&x.owner==='studio-kit')&&m.hooks.find(h=>h.name==='render.before').handlers.some(x=>(x.owner||x)==='studio-kit')&&m.exporters.some(e=>e.id==='studio-kit:cbz')}));
 check('manifest styles are linked as an owner-scoped stylesheet between theme and user layers',await p.evaluate(()=>{const link=document.head.querySelector('link[data-mio-style="studio-kit:manifest:0"]');const order=[...document.head.children];return !!link&&order.indexOf(link)>order.indexOf(document.head.querySelector('style[data-mio-layer="themes"]'))&&order.indexOf(link)<order.indexOf(document.head.querySelector('style[data-mio-layer="user-tokens"]'))}));
 await shot('05-extension-center');

 /* ---- v3 surface: anchors, mounts, patches, filters, keys, settings page ------------- */
 await p.waitForSelector('#topbar .sk-badge');
 check('anchors render into topbar / sidebar-nav / statusbar',await p.evaluate(()=>!!document.querySelector('[data-mio-anchor="topbar"] .sk-badge')&&!!document.querySelector('[data-mio-anchor="sidebar-nav"] .mio-anchor-btn')&&document.querySelector('[data-mio-anchor="statusbar"]')?.textContent.includes('Kit')));
 check('ctx.patch wraps a core function and is listed in the platform description',await p.evaluate(()=>MioPlatform.describe().patches.some(x=>x.target==='renderShell'&&x.layers.includes('studio-kit'))&&document.querySelector('#topbar .breadcrumb strong')?.title.includes('ctx.patch')));
 check('ctx.styles.vars injects CSS variables scoped to the owner',await p.evaluate(()=>getComputedStyle(document.querySelector('.sk-badge')).color==='rgb(232, 163, 61)'));
 await p.keyboard.press('Control+Shift+K');await p.waitForSelector('#mio-settings-page-body.sk-lab .settings-section');
 check('ctx.keys shortcut opens the extension settings page (slots.settings)',await p.evaluate(()=>studioUI.settingsTab==='ext:studio-kit:lab'&&document.querySelector('.settings-nav button.active')?.textContent.includes('Studio Kit')));
 await shot('06-extension-settings-page');
 await p.evaluate(()=>{workshop.view='stories';navigate(1)});await p.waitForSelector('.workshop-page-title');await p.waitForSelector('.sk-frame-tip');
 check('ctx.mount attaches UI after a core element and survives re-render',await p.evaluate(()=>{render();return document.querySelectorAll('.sk-frame-tip').length===1&&document.querySelector('.workshop-page-title').nextElementSibling.classList.contains('mio-mount')}));
 check('creation-tabs anchor is auto-created in the create workspace',await p.locator('.quiet-tabs [data-mio-anchor="creation-tabs"] .mio-anchor-btn').count()===1);
 await p.evaluate(async()=>{const ctx=ecoContext('studio-kit');await ctx.settings.set({suffix:'ink wash',stamp:false,dockOnStart:false,badge:'LAB',accent:'#2266ff'})});
 await p.waitForFunction(()=>document.querySelector('.sk-badge')?.textContent==='LAB');
 check('settings.onChange re-renders live anchors and CSS variables',await p.evaluate(()=>getComputedStyle(document.querySelector('.sk-badge')).color==='rgb(34, 102, 255)'));
 check('prompt.compose filter is applied by the core interpolate()',await p.evaluate(()=>interpolate('a quiet room',{},{}).endsWith(', ink wash')));
 await p.evaluate(()=>openCommand());await p.locator('#command-input').fill('Studio Kit');await p.waitForFunction(()=>document.querySelector('#command-results')?.textContent.includes('Studio Kit ·'));check('command.items filter injects palette entries',true);await p.evaluate(()=>document.querySelector('#command-dialog').close());

 /* ---- v2 slots still work --------------------------------------------------------------- */
 check('nav slot adds a workspace entry',await p.locator('.nav-item.mio-nav-item[data-route="studio-kit:notebook"]').count()===1);
 await p.locator('.nav-item.mio-nav-item[data-route="studio-kit:notebook"]').click();await p.waitForSelector('#mio-ext-body .settings-section');
 check('extension page renders with plan context and backend route data',await p.evaluate(()=>ui.workspace==='studio-kit:notebook'&&document.querySelector('#mio-ext-body').textContent.includes('当前上下文')));await shot('07-extension-page');
 await p.evaluate(()=>{workshop.view='stories';workshop.frame=0;navigate(1)});await p.waitForSelector('.workshop-page-title');
 check('frame-card slot injects quick action on the active storyboard frame',await p.locator('.workshop-page-title [data-act="mio-slot"][data-slot="frame-card"]').count()===1);
 check('toolbar slot injects into storyboard actions',await p.locator('.workshop-asset-head [data-act="mio-slot"][data-slot="toolbar"]').count()===1);
 const promptBefore=await p.evaluate(()=>workshopStory().frames[0].prompt);await p.locator('.workshop-page-title [data-act="mio-slot"][data-slot="frame-card"]').click();await p.waitForFunction(b=>workshopStory().frames[0].prompt!==b,promptBefore);
 check('frame-card action mutates the storyboard frame through the albums facade',await p.evaluate(()=>workshopStory().frames[0].prompt.startsWith('(masterpiece)')&&document.querySelector('[data-workshop-frame="prompt"]').value.startsWith('(masterpiece)')));
 await p.locator('.workshop-frames [data-act="workshop-frame"][data-index="0"]').click({button:'right'});await p.waitForSelector('#mio-context-menu');
 check('frame context menu shows extension entries only for kind=frame',await p.evaluate(()=>[...document.querySelectorAll('#mio-context-menu [data-act="mio-context-item"] span')].map(x=>x.textContent).join('|')==='复制这一格的提示词'));await p.keyboard.press('Escape');
 await p.locator('#mio-dock-toggle').click();await p.waitForSelector('#mio-dock:not([hidden]) .mio-dock-body pre');check('dock panel renders in the shared drawer',await p.evaluate(()=>document.querySelector('#mio-dock .mio-dock-tabs button.active')?.textContent.includes('事件流')));await p.locator('#mio-dock [data-act="mio-dock-toggle"]').click();
 await p.evaluate(async()=>{await savePythonWorkspace();navigate(0)});await p.waitForSelector('[data-act="mio-slot"][data-slot="album-card"]');check('album-card slot appears on album cards',true);
 const firstBook=await p.evaluate(()=>state.books[0].id);await p.evaluate(id=>openBookContext(id,300,300),firstBook);await p.waitForSelector('#book-context-menu [data-act="mio-export"]');
 check('album context menu gains extension entries plus every exporter',await p.evaluate(()=>{const m=document.querySelector('#book-context-menu');return m.querySelector('[data-act="mio-context-item"]')&&m.querySelector('[data-act="mio-export"][data-exporter="studio-kit:cbz"]')&&m.querySelector('[data-act="mio-export"][data-exporter="studio-kit:script-txt"]')}));
 const dl=p.waitForEvent('download');await p.locator('#book-context-menu [data-act="mio-export"][data-exporter="studio-kit:cbz"]').click();const download=await dl;await download.saveAs(temp+'/album.cbz');
 check('backend exporter streams a real CBZ',readFileSync(temp+'/album.cbz').subarray(0,2).toString()==='PK'&&readFileSync(temp+'/album.cbz').includes('ComicInfo.xml'));
 const dl2=p.waitForEvent('download');await p.evaluate(id=>mioExportAlbum('studio-kit:script-txt',id),firstBook);const download2=await dl2;await download2.saveAs(temp+'/album.txt');check('browser exporter downloads text',readFileSync(temp+'/album.txt','utf8').includes('#1'));
 await p.evaluate(id=>openReader(id),firstBook);await p.waitForSelector('#reader[open]');await p.evaluate(()=>{artUI.showInfo=true;renderRoomInfo()});await p.waitForSelector('#room-info .mio-inspector-section textarea');
 check('inspector slot renders inside the reader info panel',true);await p.evaluate(()=>closeReader());

 /* ---- tasks, raw responses, cross-extension API ---------------------------------------- */
 const task=await p.evaluate(async()=>{const ctx=ecoContext('studio-kit');const {id}=await ctx.api('/tasks/start',{steps:4});const seen=[];const done=await ctx.tasks.wait(id,{interval:120,onProgress:t=>seen.push(t.progress)});return {status:done.status,result:done.result,progressed:seen.some(x=>x>0&&x<1)||done.progress===1,listed:(await ctx.tasks.list()).some(t=>t.id===id)}});
 check('background tasks run in the extension process with progress, result and listing',task.status==='complete'&&task.result.steps===4&&task.progressed&&task.listed);
 const cancelled=await p.evaluate(async()=>{const ctx=ecoContext('studio-kit');const {id}=await ctx.api('/tasks/start',{steps:200});await new Promise(r=>setTimeout(r,200));await ctx.tasks.cancel(id);await new Promise(r=>setTimeout(r,400));return (await ctx.tasks.get(id)).status});
 check('tasks can be cancelled cooperatively',cancelled==='cancelled');
 const raw=await p.evaluate(async()=>{const html=await fetch('/api/extensions/studio-kit/report?from=test');const svg=await fetch('/api/extensions/studio-kit/badge.svg?text=hi');const file=await fetch('/api/extensions/studio-kit/manifest-file');return {html:(html.headers.get('content-type')||'')+'|'+(await html.text()).slice(0,15),svg:(svg.headers.get('content-type')||'')+'|'+(await svg.text()).includes('>hi<'),file:file.headers.get('content-disposition')||''}});
 check('Python routes can answer with raw HTML / SVG / files',raw.html.startsWith('text/html')&&raw.html.endsWith('<!doctype html>')&&raw.svg==='image/svg+xml|true'&&raw.file.includes('mio.extension.json'));
 check('extensions can publish an API for other extensions',await p.evaluate(async()=>{const api=MioPlatform.extension('studio-kit');await api.note('hello');return Array.isArray(api.events())&&(await ecoContext('studio-kit').api('/log')).events.some(e=>e.kind==='note')}));

 /* ---- events, facade, data tiers ---------------------------------------------------- */
 const facade=await p.evaluate(async()=>{const seen=[];const off=MioPlatform.on('album.saved',e=>seen.push(e.id));const book=MioAlbums.update(state.books[0].id,{tags:['sdk']});off();await new Promise(r=>setTimeout(r,300));const events=(await ecoRequest('activity?since=0')).events.map(e=>e.name);return {tags:book.tags,seen,relayed:events.includes('album.saved')||events.includes('frame.updated')}});
 check('albums facade writes, emits locally and relays to the backend bus',facade.tags[0]==='sdk'&&facade.seen.length===1&&facade.relayed);
 check('custom event names flow through the front-end bus and relay to Python',await p.evaluate(async()=>{let got=null;const off=MioPlatform.on('studio.custom',p=>{got=p});await MioPlatform.emit('studio.custom',{x:1},{source:'test'});off();await new Promise(r=>setTimeout(r,300));const events=(await ecoRequest('activity?since=0')).events;return got?.x===1&&events.some(e=>e.name==='studio.custom')}));
 const tiers=await p.evaluate(async()=>{const ctx=ecoContext('studio-kit');await ctx.data.config.set('k',1);await ctx.data.cache.set('k',2);await ctx.storage.set('k',3);return [await ctx.data.config.get('k'),await ctx.data.cache.get('k'),await ctx.storage.get('k')]});
 check('data tiers are isolated (config / cache / workspace)',tiers.join()==='1,2,3');
 const purged=await p.evaluate(async()=>{await ecoRequest('extensions/purge',{id:'studio-kit',level:'cache'});const ctx=ecoContext('studio-kit');return [await ctx.data.cache.get('k'),await ctx.data.config.get('k')]});
 check('cache purge keeps config',purged[0]===null&&purged[1]===1);

 /* ---- hot reload of a linked folder ---------------------------------------------------- */
 const revisionBefore=await p.evaluate(()=>ecoState.loaded.get('studio-kit').revision);
 const indexPath=path.join(linkedKit,'index.js');writeFileSync(indexPath,readFileSync(indexPath,'utf8').replace("Kit · ${seen.length} 个事件","Kit · reloaded ${seen.length}"));const future=new Date(Date.now()+5000);utimesSync(indexPath,future,future);
 await p.waitForFunction(r=>ecoState.loaded.get('studio-kit')?.revision&&ecoState.loaded.get('studio-kit').revision!==r&&!ecoState.loaded.get('studio-kit').failed,revisionBefore,{timeout:15000});
 await p.waitForFunction(()=>document.querySelector('[data-mio-anchor="statusbar"]')?.textContent.includes('reloaded'));
 check('editing a linked extension hot-reloads it (new revision, new code, no duplicates)',await p.evaluate(()=>document.querySelectorAll('.sk-badge').length===1&&MioPlatform.describe().patches.filter(x=>x.target==='renderShell').length===1&&ecoState.errors.length===0));

 /* ---- disable cleans everything ------------------------------------------------------- */
 await view('extensions');await p.locator('[data-act="eco-extension-toggle"][data-id="studio-kit"]').click();await p.waitForFunction(()=>!ecoState.loaded.has('studio-kit'));
 check('disable removes slots, anchors, mounts, patches, filters, keys, styles, commands, exporters and nav page',await p.evaluate(()=>{const d=MioPlatform.describe();return Object.values(d.slots).every(n=>n===0)&&d.mounts===0&&d.patches.length===0&&Object.keys(d.filters).length===0&&d.keys.length===0&&d.styles.length===0&&MioPlatform.exporters.size===0&&!document.querySelector('.mio-nav-item')&&!document.querySelector('.sk-badge')&&!document.querySelector('.sk-frame-tip')&&!document.head.querySelector('link[data-mio-style]')&&!ecoState.status.platform.providers.some(x=>x.id==='echo-canvas')}));
 await p.evaluate(()=>v3Actions['eco-extension-remove']({id:'studio-kit'}));await p.locator('input[name="eco-purge"][value="none"]').check();await p.locator('[data-act="eco-extension-remove-confirm"]').click();await p.waitForFunction(()=>ecoState.status.extensions.length===0);
 check('unlinking keeps the source folder and the tiered data',existsSync(indexPath)&&existsSync(path.join(temp,'data','extensions','studio-kit','config','k.json')));

 /* ---- zip install path still works ------------------------------------------------------- */
 await install('extension',zipOf('examples/extensions/scene-notebook'),'scene-notebook.zip');await p.waitForFunction(()=>ecoState.status.extensions.some(x=>x.id==='scene-notebook'));
 check('imported ZIP extension is disabled until trusted',await p.evaluate(()=>!ecoState.status.extensions[0].enabled&&!ecoState.loaded.has('scene-notebook')));
 await p.locator('[data-act="eco-extension-toggle"][data-id="scene-notebook"]').click();await p.locator('#confirm-yes').click();await p.waitForFunction(()=>ecoState.loaded.has('scene-notebook')&&!ecoState.loaded.get('scene-notebook').failed);
 await p.waitForSelector('[data-mio-anchor="topbar"] .mio-anchor-btn');check('minimal extension registers a topbar anchor button',true);

 await p.setViewportSize({width:390,height:844});await view('extensions');await shot('08-mobile-extensions');check('mobile ecosystem has no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await studio('snippets');check('mobile style studio has no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 check('no uncaught browser errors',errors.length===0);console.log(`${n} ecosystem assertions PASS`);
}catch(e){console.error(e);if(p)await shot('failure').catch(()=>{});process.exitCode=1}finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));rmSync(temp,{recursive:true,force:true})}
