/* Mio platform kernel (front end): icon packs, event bus, UI slots, registries, album facade.
   Everything an extension touches goes through here; core screens only ask the kernel
   for "what is registered for this slot" and never know which extension answered. */
'use strict';

/* ---------------------------------------------------------------- icons */
const MioIcons={
  packs:new Map(),order:[],
  resolve(name){for(let i=this.order.length-1;i>=0;i--){const pack=this.packs.get(this.order[i]);if(pack&&Object.hasOwn(pack,name))return pack[name]}return null},
  mount(id,map){if(!map||typeof map!=='object')return;this.packs.set(id,{...map});if(!this.order.includes(id))this.order.push(id)},
  unmount(id){this.packs.delete(id);this.order=this.order.filter(x=>x!==id)},
  names(){const set=new Set(Object.keys(globalThis.paths||{}));for(const pack of this.packs.values())Object.keys(pack).forEach(k=>set.add(k));return [...set].sort()}
};

/* ------------------------------------------------------------ kernel */
const MioPlatform=(()=>{
  const SLOTS=['nav','inspector','dock','frame-card','album-card','context-menu','commands','toolbar'];
  const ID=/^[a-z][a-z0-9_-]{0,63}$/;
  const listeners=new Map(),slots=Object.fromEntries(SLOTS.map(s=>[s,new Map()])),exporters=new Map(),importers=new Map();
  const recent=[],failures=[];let serial=0;const relayTimes=new Map();
  function fail(owner,where,error){failures.push({owner,where,error:String(error?.message||error),at:Date.now()});if(failures.length>60)failures.shift();console.warn('[Mio]',owner,where,error)}
  function key(owner,id){if(!ID.test(String(id||'')))throw Error('Registration needs a local id matching [a-z][a-z0-9_-]{0,63}');return owner+':'+id}
  function on(event,handler,{owner='core',priority=100}={}){
    if(typeof event!=='string'||!event||typeof handler!=='function')throw Error('on(event, handler) requires a name and a function');
    const entry={owner,handler,priority:Number(priority)||100,serial:++serial};const list=listeners.get(event)||[];list.push(entry);list.sort((a,b)=>a.priority-b.priority||a.serial-b.serial);listeners.set(event,list);
    return ()=>{const current=listeners.get(event)||[];listeners.set(event,current.filter(x=>x!==entry))};
  }
  function off(owner){for(const [event,list] of listeners)listeners.set(event,list.filter(x=>x.owner!==owner))}
  function relay(event,payload){
    if(!/^(album|frame|theme)\./.test(event)&&!event.startsWith('ext:'))return;const last=relayTimes.get(event)||0,now=Date.now();if(event.startsWith('frame.')&&now-last<250)return;relayTimes.set(event,now);
    fetch('/api/ecosystem/events/emit',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:event,payload})}).catch(()=>{});
  }
  async function emit(event,payload={},{source='core',relay:doRelay=true}={}){
    const record={event,source,at:Date.now(),listeners:0,errors:0};
    for(const entry of [...(listeners.get(event)||[])]){record.listeners++;try{await entry.handler(payload,{event,source,at:record.at})}catch(e){record.errors++;fail(entry.owner,'event '+event,e)}}
    recent.push(record);if(recent.length>200)recent.shift();if(doRelay&&source!=='backend')relay(event,payload);return record;
  }
  function register(slot,item,owner='core'){
    const map=slots[slot];if(!map)throw Error('Unknown slot: '+slot);if(!item||typeof item!=='object')throw Error('Slot item must be an object');
    const k=key(owner,item.id);if(map.has(k))throw Error('Duplicate '+slot+' item: '+k);
    const entry={...item,key:k,owner,order:Number(item.order)||100,serial:++serial};map.set(k,entry);return ()=>{map.delete(k)};
  }
  function items(slot,context={}){
    const map=slots[slot];if(!map)return [];
    return [...map.values()].filter(item=>{if(typeof item.when!=='function')return true;try{return item.when(context)!==false}catch(e){fail(item.owner,slot+' when',e);return false}}).sort((a,b)=>a.order-b.order||a.serial-b.serial);
  }
  function find(slot,k){return slots[slot]?.get(k)||null}
  function unregisterOwner(owner){off(owner);for(const map of Object.values(slots))for(const [k,v] of map)if(v.owner===owner)map.delete(k);for(const map of [exporters,importers])for(const [k,v] of map)if(v.owner===owner)map.delete(k);MioIcons.unmount('ext:'+owner)}
  function registerExporter(spec,owner='core'){const k=key(owner,spec.id);if(typeof spec.run!=='function')throw Error('Exporter requires run(album, options)');exporters.set(k,{...spec,id:k,localId:spec.id,owner,runtime:'browser'});return ()=>exporters.delete(k)}
  function registerImporter(spec,owner='core'){const k=key(owner,spec.id);if(typeof spec.run!=='function')throw Error('Importer requires run(file, options)');importers.set(k,{...spec,id:k,localId:spec.id,owner,runtime:'browser'});return ()=>importers.delete(k)}
  async function run(owner,label,fn,...args){try{return await fn(...args)}catch(e){fail(owner,label,e);toast('['+owner+'] '+e.message,'error');return undefined}}
  return Object.freeze({SLOTS,on,off,emit,register,items,find,unregisterOwner,registerExporter,registerImporter,exporters,importers,recent,failures,fail,run,listeners});
})();

/* ------------------------------------------------------- album facade */
/* Active control instead of a read-only snapshot: extensions can open, select,
   edit and annotate work. Every write goes through save() and emits an event. */
const MioAlbums={
  list(){return state.books.map(b=>({id:b.id,title:b.title,projectId:b.projectId,status:b.status,totalSteps:b.totalSteps,generatedSteps:b.generatedSteps,tags:clone(b.tags||[]),liked:!!b.liked,updatedAt:b.updatedAt}))},
  get(id){const b=bookBy(id);return b?clone(b):null},
  current(){const plan=selectedPlan(),book=bookBy(ui.bookId),template=plan?templateBy(plan.templateId):null;const frame=template?.frames?.[ui.frameIndex];return {plan:plan?clone(plan):null,book:book?clone(book):null,template:template?clone(template):null,frameIndex:ui.frameIndex,frame:plan&&frame?clone(effectivePlanFrame(plan,frame)):null,step:book?ui.step:null,workspace:ui.workspace}},
  open(id){openReader(id);MioPlatform.emit('album.opened',{id})},
  close(){closeReader()},
  goTo(step){if(!bookBy(ui.bookId))throw Error('No album is open');setReaderStep(Number(step)||0);MioPlatform.emit('frame.selected',{albumId:ui.bookId,step:ui.step})},
  select(planId){const p=state.creation.plans.find(x=>x.id===planId);if(!p)throw Error('Unknown album draft');changeProject(p.projectId);createUI.planId=p.id;createUI.tab='scenes';navigate(1)},
  selectFrame(index){const plan=selectedPlan(),t=plan&&templateBy(plan.templateId);if(!t)throw Error('No storyboard is open');ui.frameIndex=clamp(Number(index)||0,0,Math.max(0,t.frames.length-1));render();MioPlatform.emit('frame.selected',{planId:plan.id,index:ui.frameIndex})},
  create(title='未命名画册'){const p=createBookPlan();p.title=String(title).slice(0,150)||p.title;save();render();MioPlatform.emit('album.created',{planId:p.id,title:p.title});return clone(p)},
  update(id,patch={}){
    const b=bookBy(id);if(!b)throw Error('Unknown album');const allowed=['title','synopsis','tags','liked','steps'];
    for(const [k,v] of Object.entries(patch)){if(!allowed.includes(k))throw Error('Album field not writable: '+k);
      if(k==='steps'){for(const item of v||[]){const step=b.steps.find(s=>s.stepIndex===item.stepIndex);if(!step)throw Error('Unknown stepIndex '+item.stepIndex);for(const f of ['caption','prompt','name','image'])if(f in item){if(f==='image'){if(typeof item[f]==='string'&&item[f].startsWith('/images/'))step.image=item[f]}else step[f]=String(item[f])}}}
      else if(k==='tags')b.tags=(Array.isArray(v)?v:[]).map(x=>String(x).slice(0,60)).slice(0,40);else if(k==='liked')b.liked=!!v;else b[k]=String(v).slice(0,20000)}
    b.updatedAt=Date.now();save();render();MioPlatform.emit('album.saved',{id,fields:Object.keys(patch)});return clone(b);
  },
  updateFrame(planId,index,patch={}){
    const plan=state.creation.plans.find(x=>x.id===planId);if(!plan)throw Error('Unknown album draft');const t=templateBy(plan.templateId),frame=t?.frames[index];if(!frame)throw Error('Unknown frame');
    const allowed=['name','prompt','negative','caption','width','height','steps','cfg','seed','renderOverride'];for(const [k,v] of Object.entries(patch)){if(!allowed.includes(k))throw Error('Frame field not writable: '+k);frame[k]=typeof frame[k]==='number'?Number(v):v}
    plan.updatedAt=Date.now();save();render();MioPlatform.emit('frame.updated',{planId,index,fields:Object.keys(patch)});return clone(effectivePlanFrame(plan,frame));
  }
};

/* --------------------------------------------------------- slot HTML */
function mioSlotButtons(slot,context,cls='small ghost'){
  return MioPlatform.items(slot,context).map(item=>`<button type="button" class="btn ${cls} mio-slot-btn" data-act="mio-slot" data-slot="${slot}" data-key="${esc(item.key)}" ${context.id?`data-id="${esc(context.id)}"`:''} ${Number.isInteger(context.index)?`data-index="${context.index}"`:''} title="${esc(item.title||item.label||'')}">${icon(item.icon||'box','sm')}${item.label?`<span>${esc(item.label)}</span>`:''}</button>`).join('');
}
function mioSlotContext(d){
  const index=Number(d.index);const plan=selectedPlan(),t=plan&&templateBy(plan.templateId);
  return {id:d.id||null,book:d.id?MioAlbums.get(d.id):null,plan:plan?clone(plan):null,index:Number.isInteger(index)?index:null,frame:plan&&t?.frames[index]?clone(effectivePlanFrame(plan,t.frames[index])):null,step:ui.bookId?ui.step:null,albums:MioAlbums};
}
async function mioRunSlot(slot,keyName,d){const item=MioPlatform.find(slot,keyName);if(!item)return;const context=mioSlotContext(d);if(typeof item.run==='function')await MioPlatform.run(item.owner,slot+' '+item.key,item.run,context)}

/* ------------------------------------------------------ context menu */
function mioCloseContextMenu(){$('#mio-context-menu')?.remove()}
function mioOpenContextMenu(kind,context,x,y){
  mioCloseContextMenu();const items=MioPlatform.items('context-menu',{kind,...context}).filter(i=>!i.kinds||i.kinds.includes(kind));
  const exportItems=kind==='album'&&context.id?mioExporterList().map(e=>({key:'export:'+e.id,label:'导出 · '+e.label,icon:'download',exporter:e.id})):[];
  if(!items.length&&!exportItems.length)return false;
  const menu=document.createElement('div');menu.id='mio-context-menu';menu.className='book-context-menu mio-context-menu';menu.setAttribute('role','menu');
  menu.innerHTML=`<div class="context-menu-title">${kind==='frame'?'分镜 · 扩展动作':'画册 · 扩展动作'}</div>${items.map(i=>`<button type="button" role="menuitem" data-act="mio-context-item" data-key="${esc(i.key)}" ${context.id?`data-id="${esc(context.id)}"`:''} ${Number.isInteger(context.index)?`data-index="${context.index}"`:''}>${icon(i.icon||'box','sm')}<span>${esc(i.label)}</span></button>`).join('')}${items.length&&exportItems.length?'<div class="context-menu-separator"></div>':''}${exportItems.map(e=>`<button type="button" role="menuitem" data-act="mio-export" data-exporter="${esc(e.exporter)}" data-id="${esc(context.id)}">${icon('download','sm')}<span>${esc(e.label)}</span></button>`).join('')}`;
  document.body.append(menu);const rect=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';menu.querySelector('button')?.focus({preventScroll:true});return true;
}

/* -------------------------------------------------- exporters/importers */
function mioExporterList(){const backend=(ecoState.status.platform?.exporters||[]).map(e=>({...e,runtime:'backend'}));return [...backend,...MioPlatform.exporters.values()]}
function mioImporterList(){const backend=(ecoState.status.platform?.importers||[]).map(e=>({...e,runtime:'backend'}));return [...backend,...MioPlatform.importers.values()]}
async function mioExportAlbum(exporterId,bookId){
  const book=bookBy(bookId);if(!book)throw Error('画册不存在');const browser=MioPlatform.exporters.get(exporterId);
  if(!await savePythonWorkspace())throw Error('画册尚未保存到本地库');
  await MioPlatform.emit('export.started',{exporter:exporterId,albumId:bookId},{relay:false});
  if(browser){const out=await browser.run(clone(book),{});const blob=out instanceof Blob?out:out?.blob;if(!(blob instanceof Blob))throw Error('导出器未返回文件');download(out?.filename||book.title+'.'+(browser.extension||'bin'),blob,blob.type);}
  else{const response=await request('/api/ecosystem/export',post({exporter:exporterId,albumId:bookId,options:{}}),600000);const disposition=response.headers.get('Content-Disposition')||'',match=/filename\*=UTF-8''([^;]+)/.exec(disposition);download(match?decodeURIComponent(match[1]):book.title+'.bin',await response.blob(),response.headers.get('Content-Type')||'application/octet-stream')}
  await MioPlatform.emit('export.finished',{exporter:exporterId,albumId:bookId},{relay:false});toast('导出完成。');
}
async function mioImportFile(importerId,file){
  const browser=MioPlatform.importers.get(importerId);if(file.size>512*1024*1024)throw Error('文件超过 512 MiB');
  if(browser){const result=await browser.run(file,{});if(result?.document&&result.kind==='albums'){await ComfyComic.fileLibrary?.hydrate?.(result.document)}toast('导入完成。');return}
  const b64=(await blobData(file)).split(',')[1];const result=await ecoRequest('import',{importer:importerId,payload:{b64,filename:file.name},options:{projectId:state.activeProjectId}});
  await reloadFromLibrary();await MioPlatform.emit('import.finished',result,{relay:false});toast('已导入：'+result.kind+' · '+result.id);
}
async function reloadFromLibrary(){if(typeof migrateAndLoad==='function'){await migrateAndLoad();render()}else location.reload()}

/* -------------------------------------------------------------- dock */
const mioDock={open:false,active:''};
function mioDockRender(){
  let dock=$('#mio-dock');const panels=MioPlatform.items('dock');
  if(!panels.length){dock?.remove();$('#mio-dock-toggle')?.remove();return}
  if(!dock){dock=document.createElement('aside');dock.id='mio-dock';dock.className='mio-dock';dock.setAttribute('aria-label','扩展面板');document.body.append(dock)}
  if(!panels.some(p=>p.key===mioDock.active))mioDock.active=panels[0].key;
  dock.hidden=!mioDock.open;dock.innerHTML=`<header class="mio-dock-head"><nav class="mio-dock-tabs" role="tablist">${panels.map(p=>`<button type="button" role="tab" class="${p.key===mioDock.active?'active':''}" data-act="mio-dock-tab" data-key="${esc(p.key)}" aria-selected="${p.key===mioDock.active}">${icon(p.icon||'box','sm')}<span>${esc(p.title)}</span></button>`).join('')}</nav>${ibtn('close','mio-dock-toggle','收起扩展面板')}</header><div class="mio-dock-body" id="mio-dock-body"></div>`;
  if(mioDock.open){const panel=panels.find(p=>p.key===mioDock.active);const body=$('#mio-dock-body');if(panel&&body)MioPlatform.run(panel.owner,'dock '+panel.key,panel.render,body,mioSlotContext({}))}
  let toggle=$('#mio-dock-toggle');if(!toggle){const bar=$('#topbar .topbar-actions')||$('#topbar');if(bar){bar.insertAdjacentHTML('beforeend',`<button type="button" class="ibtn" id="mio-dock-toggle" data-act="mio-dock-toggle" title="扩展面板" aria-label="扩展面板">${icon('box')}</button>`)}}
}

/* --------------------------------------------------- extension pages */
function mioNavPages(){return MioPlatform.items('nav')}
function mioRenderExtensionPage(){
  const page=MioPlatform.find('nav',ui.workspace);if(!page)return false;renderShell();
  patchMain(`<div class="art-fade mio-ext-page" data-page="${esc(page.key)}"><header class="mio-ext-head"><span class="context-kicker">${esc(page.kicker||'扩展工作区 · '+page.owner)}</span><h1>${esc(page.label)}</h1>${page.description?`<p>${esc(page.description)}</p>`:''}</header><section class="mio-ext-body" id="mio-ext-body"></section></div>`);
  const body=$('#mio-ext-body');if(body)MioPlatform.run(page.owner,'page '+page.key,page.render,body,mioSlotContext({}));return true;
}

/* ----------------------------------------------------- notices poll */
const mioActivity={since:0,timer:null};
async function mioPollActivity(){
  if(document.hidden||window.MioSafeMode)return;
  try{const data=await ecoRequest('activity?since='+encodeURIComponent(mioActivity.since));mioActivity.since=data.now;
    for(const n of data.notices||[])toast(n.message,n.level==='error'?'error':'ok');
    for(const e of data.events||[]){if(e.source==='ui')continue;MioPlatform.emit(e.name,{...(e.payload||{}),backend:true},{source:'backend'})}
  }catch(e){/* offline or backend restarting: quiet */}
}

/* --------------------------------------------------------- install */
function installPlatformUI(){
  const previousRender=render;render=function(...args){
    if(typeof ui.workspace==='string'&&MioPlatform.find('nav',ui.workspace)){ensureStudioState();mioRenderExtensionPage()}else{const result=previousRender(...args);mioInjectSlots();mioDockRender();return result}
    mioDockRender();
  };
  const previousShell=renderShell;renderShell=function(...args){const result=previousShell(...args);const nav=$('#sidebar nav');if(nav){const pages=mioNavPages();if(pages.length)nav.insertAdjacentHTML('beforeend',pages.map(p=>`<button class="nav-item mio-nav-item ${ui.workspace===p.key?'active':''}" data-act="art-nav" data-route="${esc(p.key)}" aria-label="${esc(p.label)}" title="${esc(p.label)}" ${ui.workspace===p.key?'aria-current="page"':''}>${icon(p.icon||'box')}<span>${esc(p.label)}</span></button>`).join(''));if(typeof ui.workspace==='string'){const crumb=$('.breadcrumb strong');const page=MioPlatform.find('nav',ui.workspace);if(crumb&&page)crumb.textContent=page.label}}return result};
  const previousNavigate=navigate;navigate=function(index){if(typeof index==='string'&&MioPlatform.find('nav',index)){flushEditor();ui.workspace=index;render();window.scrollTo({top:0,behavior:'instant'});return}if(typeof ui.workspace==='string')ui.workspace=0;return previousNavigate(index)};
  const previousVisible=workspaceVisible;workspaceVisible=index=>typeof index==='string'?!!MioPlatform.find('nav',index):previousVisible(index);
  const previousCommands=indexCommands;indexCommands=function(query){previousCommands(query);const extra=[...MioPlatform.items('commands').map(c=>({title:c.title,type:c.type||'扩展 · '+c.owner,icon:c.icon||'box',run:()=>MioPlatform.run(c.owner,'command '+c.key,c.run,mioSlotContext({}))})),...mioNavPages().map(p=>({title:p.label,type:'扩展工作区',icon:p.icon||'box',run:()=>navigate(p.key)}))].filter(x=>(x.title+' '+x.type).toLowerCase().includes(String(query||'').toLowerCase()));if(!extra.length)return;rt.commandItems=[...rt.commandItems,...extra].slice(0,60);const results=$('#command-results');if(results)results.innerHTML=rt.commandItems.map((x,i)=>`<button class="command-item ${i===rt.commandIndex?'active':''}" data-act="run-command" data-index="${i}">${icon(x.icon)}<span>${esc(x.title)}</span><small>${esc(x.type)}</small></button>`).join('')};
  if(typeof openBookContext==='function'){const previousContext=openBookContext;openBookContext=function(id,x,y,extend){previousContext(id,x,y,extend);const menu=$('#book-context-menu');if(!menu)return;const items=MioPlatform.items('context-menu',{kind:'album',id}).filter(i=>!i.kinds||i.kinds.includes('album')),exporters=mioExporterList();const extra=items.map(i=>`<button type="button" role="menuitem" data-act="mio-context-item" data-key="${esc(i.key)}" data-id="${esc(id)}">${icon(i.icon||'box','sm')}<span>${esc(i.label)}</span></button>`).join('')+exporters.map(e=>`<button type="button" role="menuitem" data-act="mio-export" data-exporter="${esc(e.id)}" data-id="${esc(id)}">${icon('download','sm')}<span>导出 · ${esc(e.label)}</span></button>`).join('');if(extra)menu.querySelector('.context-menu-hint')?.insertAdjacentHTML('beforebegin','<div class="context-menu-separator"></div>'+extra)}}
  const previousRoomInfo=typeof renderRoomInfo==='function'?renderRoomInfo:null;if(previousRoomInfo)renderRoomInfo=function(){previousRoomInfo();const panel=$('#room-info');const book=bookBy(ui.bookId);if(!panel||!book)return;const sections=MioPlatform.items('inspector',{book,step:ui.step});if(!sections.length)return;panel.insertAdjacentHTML('beforeend',sections.map(s=>`<section class="mio-inspector-section" data-key="${esc(s.key)}"><h4>${esc(s.title)}</h4><div class="mio-inspector-body"></div></section>`).join(''));for(const s of sections){const body=panel.querySelector(`[data-key="${CSS.escape(s.key)}"] .mio-inspector-body`);if(body)MioPlatform.run(s.owner,'inspector '+s.key,s.render,body,{book:clone(book),step:ui.step,page:clone(book.steps.find(p=>p.stepIndex===ui.step)||null),albums:MioAlbums})}};
  Object.assign(v3Actions,{
    'mio-slot':d=>mioRunSlot(d.slot,d.key,d),
    'mio-context-item':d=>{mioCloseContextMenu();closeBookContext?.();return mioRunSlot('context-menu',d.key,d)},
    'mio-export':d=>{mioCloseContextMenu();closeBookContext?.();return mioExportAlbum(d.exporter,d.id)},
    'mio-import':d=>pickFile((mioImporterList().find(i=>i.id===d.importer)?.accepts||['.zip']).join(','),file=>mioImportFile(d.importer,file).catch(e=>toast(e.message,'error'))),
    'mio-dock-toggle':()=>{mioDock.open=!mioDock.open;mioDockRender()},
    'mio-dock-tab':d=>{mioDock.active=d.key;mioDock.open=true;mioDockRender()},
    'mio-export-menu':d=>{const list=mioExporterList();modal('导出画册',`<p class="soft small">内置与扩展导出器统一在这里；后端导出器在服务端打包，浏览器导出器直接在本页生成。</p><div class="mio-export-list">${list.map(e=>`<button type="button" class="btn ghost" data-act="mio-export" data-exporter="${esc(e.id)}" data-id="${esc(d.id)}">${icon('download','sm')}<span>${esc(e.label)}</span><small>${esc(e.runtime==='browser'?'浏览器':'后端')}${e.owner&&e.owner!=='core'?' · '+esc(e.owner):''}</small></button>`).join('')}</div>`)}
  });
  document.addEventListener('contextmenu',e=>{
    if(window.MioSafeMode)return;const scene=e.target.closest('.quiet-scene[data-index]');
    if(scene&&ui.workspace===1){const index=Number(scene.dataset.index);if(mioOpenContextMenu('frame',{index,plan:selectedPlan()},e.clientX,e.clientY))e.preventDefault();return}
  });
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#mio-context-menu'))mioCloseContextMenu()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')mioCloseContextMenu()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)mioPollActivity()});
  mioActivity.timer=setInterval(mioPollActivity,4000);
}
function mioInjectSlots(){
  if(window.MioSafeMode)return;
  const top=$('.quiet-scene-top');if(top&&!top.querySelector('.mio-slot-btn')){const html=mioSlotButtons('frame-card',{index:ui.frameIndex,plan:selectedPlan()},'');if(html)top.querySelector('.spacer')?.insertAdjacentHTML('afterend',html)}
  for(const tile of $$('.edition-tile-footer, .edition-entry, .shelf-item .shelf-meta, .shelf-exhibit .edition-entry')){const id=tile.closest('[data-sort-book]')?.dataset.sortBook||tile.querySelector('[data-id]')?.dataset.id||tile.closest('article')?.querySelector('[data-id]')?.dataset.id;if(!id||tile.querySelector('.mio-slot-btn'))continue;const html=mioSlotButtons('album-card',{id,book:bookBy(id)},'');if(html)tile.insertAdjacentHTML('beforeend',`<span class="mio-card-actions">${html}</span>`)}
  const actions=$('.source-story-actions');if(actions&&!actions.querySelector('.mio-slot-btn'))actions.insertAdjacentHTML('beforeend',mioSlotButtons('toolbar',{plan:selectedPlan()}));
  if(mioTheme.lock&&document.documentElement.dataset.theme!==mioTheme.lock)document.documentElement.dataset.theme=mioTheme.lock;
}
const mioTheme={lock:null};
