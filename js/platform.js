/* Mio platform kernel (front end), SDK v3: icon packs, event bus, open UI slots, anchors,
   mounts, patch chains, filters, key bindings, owner-scoped styles, registries, album facade.
   Everything an extension touches goes through here so unregisterOwner() can undo it.
   Third-party code is trusted code — the kernel organises it, it does not sandbox it. */
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
  const SLOTS=['nav','topbar','sidebar','statusbar','reader','home','inspector','dock','frame-card','album-card','context-menu','commands','toolbar','settings'];
  const LAYERS=['themes','theme-settings','extensions','user-tokens','user-snippets'];
  const ID=/^[a-z][a-z0-9_.:-]{0,79}$/i;
  const listeners=new Map(),slots=new Map(),exporters=new Map(),importers=new Map();
  const mounts=new Map(),patches=new Map(),filters=new Map(),keys=new Map(),styles=new Map(),exposed=new Map(),waiting=new Map();
  const recent=[],failures=[];let serial=0,decorating=false,decorateQueued=false;const relayTimes=new Map();
  for(const s of SLOTS)slots.set(s,new Map());
  function fail(owner,where,error){failures.push({owner,where,error:String(error?.message||error),at:Date.now()});if(failures.length>80)failures.shift();console.warn('[Mio]',owner,where,error)}
  function key(owner,id){const local=id==null||id===''?'auto-'+(++serial):String(id);if(!ID.test(local))throw Error('Registration id must match [a-z][a-z0-9_.:-]{0,79}: '+local);return owner+':'+local}
  function slotMap(name){if(typeof name!=='string'||!/^[a-z][a-z0-9_.:-]{0,79}$/i.test(name))throw Error('Slot names look like nav, dock or anchor:topbar');if(!slots.has(name))slots.set(name,new Map());return slots.get(name)}
  /* ---- events (any well-formed name) */
  function on(event,handler,{owner='core',priority=100,once=false}={}){
    if(typeof event!=='string'||!event||typeof handler!=='function')throw Error('on(event, handler) requires a name and a function');
    const entry={event,owner,handler,priority:Number(priority)||100,serial:++serial,once};const list=listeners.get(event)||[];list.push(entry);list.sort((a,b)=>a.priority-b.priority||a.serial-b.serial);listeners.set(event,list);
    return ()=>{const current=listeners.get(event)||[];listeners.set(event,current.filter(x=>x!==entry))};
  }
  function off(owner){for(const [event,list] of listeners)listeners.set(event,list.filter(x=>x.owner!==owner))}
  function relay(event,payload){
    if(event.startsWith('app.')||/^(extensions|preparation)\./.test(event))return;const last=relayTimes.get(event)||0,now=Date.now();if(/^(frame|pointer|scroll)\./.test(event)&&now-last<250)return;relayTimes.set(event,now);
    let body;try{body=JSON.stringify({name:event,payload:payload&&typeof payload==='object'?payload:{value:payload}})}catch{return}
    if(body.length>256*1024)return;fetch('/api/ecosystem/events/emit',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body}).catch(()=>{});
  }
  async function emit(event,payload={},{source='core',relay:doRelay=true}={}){
    const record={event,source,at:Date.now(),listeners:0,errors:0};
    const list=event==='*'?(listeners.get('*')||[]):[...(listeners.get(event)||[]),...(listeners.get('*')||[])];
    for(const entry of list){record.listeners++;try{if(entry.once){const k=entry.event||(listeners.get('*')?.includes(entry)?'*':event);listeners.set(k,(listeners.get(k)||[]).filter(x=>x!==entry))}await entry.handler(payload,{event,source,at:record.at})}catch(e){record.errors++;fail(entry.owner,'event '+event,e)}}
    recent.push(record);if(recent.length>300)recent.shift();if(doRelay&&source!=='backend')relay(event,payload);return record;
  }
  /* ---- slots (open set: unknown names are created on first registration) */
  function register(slot,item,owner='core'){
    const map=slotMap(slot);if(!item||typeof item!=='object')throw Error('Slot item must be an object');
    const k=key(owner,item.id);if(map.has(k))throw Error('Duplicate '+slot+' item: '+k);
    const entry={...item,key:k,owner,slot,order:Number(item.order)||100,serial:++serial};map.set(k,entry);scheduleDecorate();return ()=>{map.delete(k);scheduleDecorate()};
  }
  function items(slot,context={}){
    const map=slots.get(slot);if(!map)return [];
    return [...map.values()].filter(item=>{if(typeof item.when!=='function')return true;try{return item.when(context)!==false}catch(e){fail(item.owner,slot+' when',e);return false}}).sort((a,b)=>a.order-b.order||a.serial-b.serial);
  }
  function find(slot,k){return slots.get(slot)?.get(k)||null}
  function slotNames(){return [...slots.keys()]}
  /* ---- anchors: <element data-mio-anchor="name"> in core markup, filled from slot anchor:<name> */
  function anchorContext(){try{return mioSlotContext({})}catch{return {}}}
  function renderAnchorItem(item,container,context){
    if(typeof item.render==='function'){run(item.owner,'anchor '+item.key,item.render,container,context);return}
    if(typeof item.html==='string'){container.innerHTML=item.html;return}
    if(typeof item.html==='function'){try{container.innerHTML=String(item.html(context)??'')}catch(e){fail(item.owner,'anchor '+item.key,e)}return}
    const label=item.label?`<span>${esc(item.label)}</span>`:'';container.innerHTML=`<button type="button" class="${item.cls||(item.label?'btn small ghost':'ibtn')} mio-anchor-btn" data-act="mio-anchor-run" data-slot="${esc(item.slot)}" data-key="${esc(item.key)}" title="${esc(item.title||item.label||'')}" aria-label="${esc(item.title||item.label||'')}">${item.icon?icon(item.icon,item.label?'sm':''):''}${label}</button>`;
  }
  function renderAnchors(root=document){
    const nodes=root.querySelectorAll?root.querySelectorAll('[data-mio-anchor]'):[];const context=nodes.length?anchorContext():null;
    for(const node of nodes){const name=node.dataset.mioAnchor,list=items('anchor:'+name,{...context,anchor:name,element:node});const keep=new Set(list.map(i=>i.key));
      for(const child of [...node.children])if(child.dataset.mioKey&&!keep.has(child.dataset.mioKey))child.remove();
      for(const item of list){let child=node.querySelector(':scope > [data-mio-key="'+CSS.escape(item.key)+'"]');if(child&&!item.live)continue;if(!child){child=document.createElement(item.tag||'span');child.className='mio-anchor-item';child.dataset.mioKey=item.key;child.dataset.owner=item.owner;node.append(child)}renderAnchorItem(item,child,context)}
      node.hidden=!node.children.length;
    }
  }
  /* ---- mounts: put UI next to any element the core renders, re-applied after every render */
  function mount(spec,owner='core'){
    if(!spec||typeof spec!=='object')throw Error('mount spec must be an object');
    const selector=spec.selector||spec.target;
    if(typeof selector!=='string')throw Error('mount({selector, position, render|html}) needs a CSS selector');
    if(typeof spec.render!=='function'&&typeof spec.html!=='string'&&typeof spec.html!=='function')throw Error('mount needs render(container, target, context) or html');
    const k=key(owner,spec.id),entry={...spec,selector,key:k,owner,position:spec.position||'append',nodes:new Set()};mounts.set(k,entry);scheduleDecorate();return ()=>unmount(k);
  }
  function unmount(k){const entry=mounts.get(k);if(!entry)return;for(const node of entry.nodes)node.remove();mounts.delete(k)}
  function applyMounts(root=document){
    if(!mounts.size)return;let context=null;
    for(const entry of mounts.values()){let targets;try{targets=root.querySelectorAll(entry.selector)}catch(e){fail(entry.owner,'mount selector',e);continue}
      for(const node of [...entry.nodes])if(!node.isConnected)entry.nodes.delete(node);
      for(const target of targets){
        if(entry.nodes.size&&[...entry.nodes].some(n=>n.__mioTarget===target&&n.isConnected))continue;
        if(entry.max&&entry.nodes.size>=entry.max)break;
        context=context||anchorContext();if(typeof entry.when==='function'){try{if(entry.when({...context,target})===false)continue}catch(e){fail(entry.owner,'mount when',e);continue}}
        const container=document.createElement(entry.tag||'span');container.className='mio-mount'+(entry.cls?' '+entry.cls:'');container.dataset.mioMount=entry.key;container.dataset.owner=entry.owner;container.__mioTarget=target;
        const pos=entry.position;if(pos==='before'||pos==='beforebegin')target.before(container);else if(pos==='after'||pos==='afterend')target.after(container);else if(pos==='prepend'||pos==='afterbegin')target.prepend(container);else if(pos==='replace'){target.replaceWith(container);container.__mioTarget=container}else target.append(container);
        entry.nodes.add(container);
        if(typeof entry.render==='function')run(entry.owner,'mount '+entry.key,entry.render,container,target,context);else{try{container.innerHTML=typeof entry.html==='function'?String(entry.html(target,context)??''):entry.html}catch(e){fail(entry.owner,'mount '+entry.key,e)}}
      }
    }
  }
  function decorate(){if(decorating||window.MioSafeMode)return;decorating=true;try{if(typeof mioEnsureAnchors==='function')mioEnsureAnchors();renderAnchors(document);applyMounts(document)}catch(e){fail('core','decorate',e)}finally{decorating=false}}
  function scheduleDecorate(){if(decorateQueued)return;decorateQueued=true;requestAnimationFrame(()=>{decorateQueued=false;decorate()})}
  /* ---- patch chains: wrap any global (or object) function; restored when the last layer leaves */
  function resolveTarget(target,name){if(typeof target==='string'){name=target;target=globalThis}if(!target||typeof name!=='string')throw Error('patch(name, wrapper) or patch(object, name, wrapper)');if(typeof target[name]!=='function')throw Error('Not a function: '+name);return [target,name]}
  function patch(target,name,wrapper,options){
    if(typeof target==='string'){options=wrapper;wrapper=name;name=target;target=globalThis}
    const [obj,prop]=resolveTarget(target,name);if(typeof wrapper!=='function')throw Error('patch needs wrapper(next, ...args)');
    const owner=options?.owner||'core';const id=obj===globalThis?prop:(obj.__mioPatchId||(obj.__mioPatchId='obj'+(++serial)))+'.'+prop;
    let entry=patches.get(id);
    if(!entry){entry={obj,prop,original:obj[prop],layers:[]};patches.set(id,entry);const layers=entry.layers,original=entry.original;
      const composite=function(...args){let fn=(...a)=>original.apply(this,a);for(const layer of layers)fn=((next)=>(...a)=>layer.wrapper.call(this,next,...a))(fn);return fn(...args)};
      composite.__mioPatched=id;composite.mioOriginal=original;Object.defineProperty(composite,'name',{value:original.name});obj[prop]=composite;}
    else if(obj[prop].__mioPatched!==id){entry.original=obj[prop];const layers=entry.layers;const original=entry.original;const composite=function(...args){let fn=(...a)=>original.apply(this,a);for(const layer of layers)fn=((next)=>(...a)=>layer.wrapper.call(this,next,...a))(fn);return fn(...args)};composite.__mioPatched=id;composite.mioOriginal=original;obj[prop]=composite}
    const layer={owner,wrapper,priority:Number(options?.priority)||100,serial:++serial};entry.layers.push(layer);entry.layers.sort((a,b)=>a.priority-b.priority||a.serial-b.serial);
    return ()=>{const current=patches.get(id);if(!current)return;current.layers=current.layers.filter(x=>x!==layer);entry.layers=current.layers;if(!current.layers.length){if(current.obj[current.prop]?.__mioPatched===id)current.obj[current.prop]=current.original;patches.delete(id)}else{const layers=current.layers,original=current.original;const composite=function(...args){let fn=(...a)=>original.apply(this,a);for(const l of layers)fn=((next)=>(...a)=>l.wrapper.call(this,next,...a))(fn);return fn(...args)};composite.__mioPatched=id;composite.mioOriginal=original;current.obj[current.prop]=composite}};
  }
  function unpatchOwner(owner){for(const [id,entry] of [...patches]){const remaining=entry.layers.filter(l=>l.owner!==owner);if(remaining.length===entry.layers.length)continue;entry.layers.length=0;entry.layers.push(...remaining);if(!remaining.length){if(entry.obj[entry.prop]?.__mioPatched===id)entry.obj[entry.prop]=entry.original;patches.delete(id)}}}
  /* ---- filters: value pipelines at named core points */
  function addFilter(name,fn,{owner='core',priority=100}={}){if(typeof name!=='string'||typeof fn!=='function')throw Error('addFilter(name, fn)');const entry={owner,fn,priority:Number(priority)||100,serial:++serial};const list=filters.get(name)||[];list.push(entry);list.sort((a,b)=>a.priority-b.priority||a.serial-b.serial);filters.set(name,list);return ()=>filters.set(name,(filters.get(name)||[]).filter(x=>x!==entry))}
  function applyFilter(name,value,context={}){for(const entry of filters.get(name)||[]){try{const out=entry.fn(value,context);if(out!==undefined&&!(out&&typeof out.then==='function'))value=out}catch(e){fail(entry.owner,'filter '+name,e)}}return value}
  async function applyFilterAsync(name,value,context={}){for(const entry of filters.get(name)||[]){try{const out=await entry.fn(value,context);if(out!==undefined)value=out}catch(e){fail(entry.owner,'filter '+name,e)}}return value}
  function filterNames(){return [...filters.keys()]}
  /* ---- key bindings: 'mod+shift+k', 'alt+1', 'escape' */
  function comboOf(e){const parts=[];if(e.ctrlKey||e.metaKey)parts.push('mod');if(e.altKey)parts.push('alt');if(e.shiftKey)parts.push('shift');let k=String(e.key||'').toLowerCase();if(k===' ')k='space';if(k.length===1)k=k;parts.push(k);return parts.join('+')}
  function normalizeCombo(combo){const parts=String(combo).toLowerCase().split('+').map(s=>s.trim()).filter(Boolean);const mods=[];let main='';for(const p of parts){if(['mod','cmd','meta','ctrl','control'].includes(p))mods.push('mod');else if(p==='alt'||p==='option')mods.push('alt');else if(p==='shift')mods.push('shift');else main=p==='esc'?'escape':p}return [...['mod','alt','shift'].filter(m=>mods.includes(m)),main].join('+')}
  function bindKey(combo,run,{owner='core',when=null,global:isGlobal=false,description='',id=''}={}){if(typeof run!=='function')throw Error('keys.register(combo, run)');const norm=normalizeCombo(combo);const entry={id:id?(id.includes(':')?id:owner+':'+id):(owner+':'+norm),owner,run,when,global:isGlobal,description,combo:norm,serial:++serial};const list=keys.get(norm)||[];list.unshift(entry);keys.set(norm,list);return ()=>keys.set(norm,(keys.get(norm)||[]).filter(x=>x!==entry))}
  function handleKey(e){
    if(window.MioSafeMode||!keys.size)return;const list=keys.get(comboOf(e));if(!list?.length)return;const typing=e.target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
    for(const entry of list){if(typing&&!entry.global)continue;if(typeof entry.when==='function'){try{if(entry.when(e)===false)continue}catch(err){fail(entry.owner,'key when',err);continue}}let result;try{result=entry.run(e)}catch(err){fail(entry.owner,'key '+entry.combo,err)}if(result!==false){e.preventDefault();e.stopPropagation()}return}
  }
  function keyList(){return [...keys.values()].flat().map(k=>({combo:k.combo,owner:k.owner,description:k.description}))}
  function bindings(){return [...keys.values()].flat().map(k=>({id:k.id||(k.owner+':'+k.combo),owner:k.owner,keys:k.combo,label:k.description||''}))}
  /* ---- style layers + owner-scoped style elements */
  function layer(name){let el=document.head.querySelector('style[data-mio-layer="'+name+'"]');if(el)return el;for(const n of LAYERS){if(!document.head.querySelector('style[data-mio-layer="'+n+'"]')){const s=document.createElement('style');s.dataset.mioLayer=n;document.head.append(s)}}return document.head.querySelector('style[data-mio-layer="'+name+'"]')}
  function styleKey(owner,id){return owner+':'+(id||'default')}
  function setStyle(owner,id,css){const k=styleKey(owner,id);let el=styles.get(k);if(!el||el.tagName!=='STYLE'){el?.remove();el=document.createElement('style');el.dataset.mioStyle=k;el.dataset.owner=owner;styles.set(k,el)}el.textContent=String(css??'');if(!el.isConnected)layer('user-tokens').before(el);return el}
  function linkStyle(owner,id,href){const k=styleKey(owner,id);let el=styles.get(k);if(!el||el.tagName!=='LINK'){el?.remove();el=document.createElement('link');el.rel='stylesheet';el.dataset.mioStyle=k;el.dataset.owner=owner;styles.set(k,el)}if(el.getAttribute('href')!==href)el.href=href;if(!el.isConnected)layer('user-tokens').before(el);return el}
  function removeStyle(owner,id){const k=styleKey(owner,id);styles.get(k)?.remove();styles.delete(k)}
  function clearStyles(owner){for(const [k,el] of [...styles])if(el.dataset.owner===owner){el.remove();styles.delete(k)}}
  function styleList(){return [...styles.values()].map(el=>({key:el.dataset.mioStyle,owner:el.dataset.owner,kind:el.tagName.toLowerCase(),size:el.tagName==='STYLE'?el.textContent.length:0,href:el.href||''}))}
  /* ---- cross-extension APIs */
  function expose(owner,api){exposed.set(owner,api);for(const resolve of waiting.get(owner)||[])resolve(api);waiting.delete(owner);emit('extension.exposed',{id:owner},{relay:false})}
  function extension(id){return exposed.get(id)??null}
  function whenReady(id,timeout=15000){if(exposed.has(id))return Promise.resolve(exposed.get(id));return new Promise((resolve,reject)=>{const list=waiting.get(id)||[];list.push(resolve);waiting.set(id,list);setTimeout(()=>{if((waiting.get(id)||[]).includes(resolve)){waiting.set(id,waiting.get(id).filter(r=>r!==resolve));reject(Error('Extension not ready: '+id))}},timeout)})}
  /* ---- teardown */
  function unregisterOwner(owner){
    off(owner);for(const map of slots.values())for(const [k,v] of map)if(v.owner===owner)map.delete(k);
    for(const map of [exporters,importers])for(const [k,v] of map)if(v.owner===owner)map.delete(k);
    for(const [k,entry] of [...mounts])if(entry.owner===owner)unmount(k);
    unpatchOwner(owner);for(const [name,list] of [...filters]){const rest=list.filter(x=>x.owner!==owner);if(rest.length)filters.set(name,rest);else filters.delete(name)}for(const [name,list] of [...keys]){const rest=list.filter(x=>x.owner!==owner);if(rest.length)keys.set(name,rest);else keys.delete(name)}for(const [name,list] of [...listeners])if(!list.length)listeners.delete(name);
    clearStyles(owner);exposed.delete(owner);MioIcons.unmount('ext:'+owner);
    for(const node of document.querySelectorAll('[data-mio-key][data-owner="'+CSS.escape(owner)+'"]'))node.remove();scheduleDecorate();
  }
  function registerExporter(spec,owner='core'){const k=key(owner,spec.id);if(typeof spec.run!=='function')throw Error('Exporter requires run(album, options)');exporters.set(k,{...spec,id:k,localId:spec.id,owner,runtime:'browser'});return ()=>exporters.delete(k)}
  function registerImporter(spec,owner='core'){const k=key(owner,spec.id);if(typeof spec.run!=='function')throw Error('Importer requires run(file, options)');importers.set(k,{...spec,id:k,localId:spec.id,owner,runtime:'browser'});return ()=>importers.delete(k)}
  async function run(owner,label,fn,...args){try{return await fn(...args)}catch(e){fail(owner,label,e);toast('['+owner+'] '+e.message,'error');return undefined}}
  function describe(){return {slots:Object.fromEntries([...slots].map(([n,m])=>[n,m.size])),mounts:mounts.size,patches:[...patches].map(([id,e])=>({target:id,layers:e.layers.map(l=>l.owner)})),filters:Object.fromEntries([...filters].filter(([,l])=>l.length).map(([n,l])=>[n,l.map(x=>x.owner)])),keys:keyList(),styles:styleList(),exposed:[...exposed.keys()],listeners:Object.fromEntries([...listeners].map(([n,l])=>[n,l.length]))}}
  window.addEventListener('keydown',handleKey,true);
  return Object.freeze({apiVersion:3,SLOTS,LAYERS,on,off,emit,register,items,find,slotNames,renderAnchors,mount,unmount,mounts,applyMounts,decorate,scheduleDecorate,patch,around:(name,wrapper,opts)=>patch(name,wrapper,opts),unpatchOwner,addFilter,applyFilter,applyFilterAsync,filterNames,bindKey,keymap:(spec,owner='core')=>bindKey(spec.keys||spec.key,spec.run,{id:spec.id,label:spec.label,description:spec.label,owner}),keyList,bindings,layer,setStyle,linkStyle,removeStyle,clearStyles,styleList,expose,extension,whenReady,unregisterOwner,registerExporter,registerImporter,exporters,importers,recent,failures,fail,run,listeners,describe});
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
  stories(){return (typeof projectTemplates==='function'?projectTemplates():state.templates||[]).map(t=>({id:t.id,title:t.title,projectId:t.projectId,frames:(t.frames||[]).length}))},
  story(id){const t=id?templateBy(id):mioWorkshopStory();return t?clone(t):null},
  updateStoryFrame(storyId,index,patch={}){
    const t=storyId?templateBy(storyId):mioWorkshopStory();const frame=t?.frames?.[index];if(!frame)throw Error('Unknown storyboard frame');
    const allowed=['name','prompt','negative','caption','width','height','steps','cfg','seed','renderOverride'];for(const [k,v] of Object.entries(patch)){if(!allowed.includes(k))throw Error('Frame field not writable: '+k);frame[k]=typeof frame[k]==='number'?Number(v):v}
    t.updatedAt=Date.now();save();render();MioPlatform.emit('frame.updated',{storyId:t.id,index,fields:Object.keys(patch)});return clone(frame);
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
function mioWorkshopStory(){return typeof workshopStory==='function'&&typeof workshop!=='undefined'?workshopStory()||null:null}
function mioSlotContext(d){
  const story=mioWorkshopStory();const index=Number.isInteger(Number(d.index))&&d.index!==undefined&&d.index!==null&&d.index!==''?Number(d.index):(story&&typeof workshop!=='undefined'?workshop.frame:NaN);const plan=selectedPlan(),t=plan&&templateBy(plan.templateId);
  const planFrame=plan&&t?.frames[index]?clone(effectivePlanFrame(plan,t.frames[index])):null,storyFrame=story?.frames?.[index]?clone(story.frames[index]):null;
  return {id:d.id||null,book:d.id?MioAlbums.get(d.id):null,plan:plan?clone(plan):null,story:story?clone(story):null,index:Number.isInteger(index)?index:null,frame:planFrame||storyFrame,step:ui.bookId?ui.step:null,albums:MioAlbums};
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
async function reloadFromLibrary(){if(typeof globalThis.migrateAndLoad==='function'){await globalThis.migrateAndLoad();render()}else location.reload()}

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
const MIO_ANCHOR_SPOTS=[['sidebar-nav','#sidebar nav.nav-list','after'],['sidebar-bottom','#sidebar .profile','before'],['topbar','#topbar','append'],['statusbar','#statusbar','append'],['main-top','#main .view','prepend'],['main-bottom','#main .view','append'],['settings-nav','.settings-nav','append'],['creation-tabs','.quiet-tabs','append'],['reader-controls','.room-controls','append'],['home','.home-hero','after']];
function mioEnsureAnchors(){
  if(window.MioSafeMode)return;
  for(const [name,selector,position] of MIO_ANCHOR_SPOTS){const target=document.querySelector(selector);if(!target)continue;const parent=position==='after'||position==='before'?target.parentElement:target;if(!parent||parent.querySelector(':scope > [data-mio-anchor="'+name+'"]'))continue;const el=document.createElement('div');el.className='mio-anchor mio-anchor-'+name;el.dataset.mioAnchor=name;el.hidden=true;if(position==='after')target.after(el);else if(position==='before')target.before(el);else if(position==='prepend')target.prepend(el);else target.append(el)}
}
function mioRenderSettingsPage(){
  const body=$('#mio-settings-page-body');if(!body)return;const page=MioPlatform.find('settings',String(studioUI.settingsTab).replace(/^ext:/,''));if(page)MioPlatform.run(page.owner,'settings '+page.key,page.render,body,mioSlotContext({}));
}
function installPlatformUI(){
  const previousRender=render;render=function(...args){
    if(typeof ui.workspace==='string'&&MioPlatform.find('nav',ui.workspace)){ensureStudioState();mioRenderExtensionPage()}else{const result=previousRender(...args);mioInjectSlots();mioDockRender();mioRenderSettingsPage();mioEnsureAnchors();MioPlatform.decorate();return result}
    mioDockRender();mioEnsureAnchors();MioPlatform.decorate();
  };
  if(typeof renderSimpleSettings==='function'){const previousSettings=renderSimpleSettings;renderSimpleSettings=function(...args){const html=previousSettings(...args);const pages=MioPlatform.items('settings');if(!pages.length)return html;const tpl=document.createElement('template');tpl.innerHTML=html;const nav=tpl.content.querySelector('.settings-nav');if(nav)nav.insertAdjacentHTML('beforeend',pages.map(p=>`<button class="${studioUI.settingsTab==='ext:'+p.key?'active':''}" data-act="v3-settings-tab" data-tab="ext:${esc(p.key)}">${icon(p.icon||'box','sm')}${esc(p.label)}</button>`).join(''));const page=MioPlatform.find('settings',String(studioUI.settingsTab).replace(/^ext:/,''));const content=tpl.content.querySelector('#studio-settings-content');if(page&&content)content.innerHTML=`<section class="eco-settings mio-settings-page" data-key="${esc(page.key)}"><header class="eco-heading"><span class="context-kicker">${esc(page.kicker||'扩展设置 · '+page.owner)}</span><h2>${esc(page.label)}</h2>${page.description?`<p>${esc(page.description)}</p>`:''}</header><div id="mio-settings-page-body"></div></section>`;return tpl.innerHTML}}
  const previousShell=renderShell;renderShell=function(...args){const result=previousShell(...args);const nav=$('#sidebar nav');if(nav){const pages=mioNavPages();if(pages.length)nav.insertAdjacentHTML('beforeend',pages.map(p=>`<button class="nav-item mio-nav-item ${ui.workspace===p.key?'active':''}" data-act="mio-nav" data-route="${esc(p.key)}" aria-label="${esc(p.label)}" title="${esc(p.label)}" ${ui.workspace===p.key?'aria-current="page"':''}>${icon(p.icon||'box')}<span>${esc(p.label)}</span></button>`).join(''));if(typeof ui.workspace==='string'){const crumb=$('.breadcrumb strong');const page=MioPlatform.find('nav',ui.workspace);if(crumb&&page)crumb.textContent=page.label}}MioPlatform.decorate();return result};
  if(typeof renderStatus==='function'){const previousStatus=renderStatus;renderStatus=function(...args){const result=previousStatus(...args);MioPlatform.decorate();return result}}
  const previousNavigate=navigate;navigate=function(index){if(typeof index==='string'&&MioPlatform.find('nav',index)){flushEditor();ui.workspace=index;render();window.scrollTo({top:0,behavior:'instant'});return}if(typeof ui.workspace==='string')ui.workspace=0;return previousNavigate(index)};
  const previousVisible=workspaceVisible;workspaceVisible=index=>typeof index==='string'?!!MioPlatform.find('nav',index):previousVisible(index);
  const previousCommands=indexCommands;indexCommands=function(query){previousCommands(query);const extra=[...MioPlatform.items('commands').map(c=>({title:c.title,type:c.type||'扩展 · '+c.owner,icon:c.icon||'box',run:()=>MioPlatform.run(c.owner,'command '+c.key,c.run,mioSlotContext({}))})),...mioNavPages().map(p=>({title:p.label,type:'扩展工作区',icon:p.icon||'box',run:()=>navigate(p.key)}))].filter(x=>(x.title+' '+x.type).toLowerCase().includes(String(query||'').toLowerCase()));const filtered=MioPlatform.applyFilter('command.items',[...rt.commandItems,...extra],{query});if(!extra.length&&filtered===rt.commandItems)return;rt.commandItems=(Array.isArray(filtered)?filtered:[...rt.commandItems,...extra]).slice(0,80);const results=$('#command-results');if(results)results.innerHTML=rt.commandItems.map((x,i)=>`<button class="command-item ${i===rt.commandIndex?'active':''}" data-act="run-command" data-index="${i}">${icon(x.icon)}<span>${esc(x.title)}</span><small>${esc(x.type)}</small></button>`).join('')};
  if(typeof openBookContext==='function'){const previousContext=openBookContext;openBookContext=function(id,x,y,extend){previousContext(id,x,y,extend);const menu=$('#book-context-menu');if(!menu)return;const items=MioPlatform.items('context-menu',{kind:'album',id}).filter(i=>!i.kinds||i.kinds.includes('album')),exporters=mioExporterList();const extra=items.map(i=>`<button type="button" role="menuitem" data-act="mio-context-item" data-key="${esc(i.key)}" data-id="${esc(id)}">${icon(i.icon||'box','sm')}<span>${esc(i.label)}</span></button>`).join('')+exporters.map(e=>`<button type="button" role="menuitem" data-act="mio-export" data-exporter="${esc(e.id)}" data-id="${esc(id)}">${icon('download','sm')}<span>导出 · ${esc(e.label)}</span></button>`).join('');if(extra)menu.querySelector('.context-menu-hint')?.insertAdjacentHTML('beforebegin','<div class="context-menu-separator"></div>'+extra)}}
  const previousRoomInfo=typeof renderRoomInfo==='function'?renderRoomInfo:null;if(previousRoomInfo)renderRoomInfo=function(){previousRoomInfo();const panel=$('#room-info');const book=bookBy(ui.bookId);if(!panel||!book)return;const sections=MioPlatform.items('inspector',{book,step:ui.step});if(!sections.length)return;panel.insertAdjacentHTML('beforeend',sections.map(s=>`<section class="mio-inspector-section" data-key="${esc(s.key)}"><h4>${esc(s.title)}</h4><div class="mio-inspector-body"></div></section>`).join(''));for(const s of sections){const body=panel.querySelector(`[data-key="${CSS.escape(s.key)}"] .mio-inspector-body`);if(body)MioPlatform.run(s.owner,'inspector '+s.key,s.render,body,{book:clone(book),step:ui.step,page:clone(book.steps.find(p=>p.stepIndex===ui.step)||null),albums:MioAlbums})}};
  Object.assign(v3Actions,{
    'mio-slot':d=>mioRunSlot(d.slot,d.key,d),
    'mio-anchor-run':d=>mioRunSlot(d.slot,d.key,d),
    'mio-nav':d=>navigate(d.route),
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
    const workshopFrame=e.target.closest('.workshop-frames [data-act="workshop-frame"][data-index]');
    if(workshopFrame){const index=Number(workshopFrame.dataset.index);if(mioOpenContextMenu('frame',{index,story:mioWorkshopStory()},e.clientX,e.clientY))e.preventDefault();return}
  });
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#mio-context-menu'))mioCloseContextMenu()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')mioCloseContextMenu()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)mioPollActivity()});
  mioActivity.timer=setInterval(mioPollActivity,4000);
  const observer=new MutationObserver(records=>{for(const r of records){const t=r.target.nodeType===1?r.target:r.target.parentElement;if(t&&t.closest('[data-mio-key],[data-mio-mount],#mio-dock,#mio-context-menu,#toast,.toast'))continue;MioPlatform.scheduleDecorate();return}});
  observer.observe(document.body,{childList:true,subtree:true});
  if(typeof openReader==='function'){const previousOpen=openReader;openReader=function(...args){const result=previousOpen(...args);mioEnsureAnchors();MioPlatform.scheduleDecorate();return result}}
}
function mioInjectSlots(){
  if(window.MioSafeMode)return;
  const top=$('.quiet-scene-top');if(top&&!top.querySelector('.mio-slot-btn')){const html=mioSlotButtons('frame-card',{index:ui.frameIndex,plan:selectedPlan()},'');if(html)top.querySelector('.spacer')?.insertAdjacentHTML('afterend',html)}
  for(const tile of $$('.edition-tile-footer, .edition-entry, .shelf-item .shelf-meta, .shelf-exhibit .edition-entry')){const id=tile.closest('[data-sort-book]')?.dataset.sortBook||tile.querySelector('[data-id]')?.dataset.id||tile.closest('article')?.querySelector('[data-id]')?.dataset.id;if(!id||tile.querySelector('.mio-slot-btn'))continue;const html=mioSlotButtons('album-card',{id,book:bookBy(id)},'');if(html)tile.insertAdjacentHTML('beforeend',`<span class="mio-card-actions">${html}</span>`)}
  const actions=$('.source-story-actions');if(actions&&!actions.querySelector('.mio-slot-btn'))actions.insertAdjacentHTML('beforeend',mioSlotButtons('toolbar',{plan:selectedPlan()}));
  const story=mioWorkshopStory();
  if(story&&typeof workshop!=='undefined'&&workshop.view==='stories'){
    const head=$('.workshop-asset-head > div');if(head&&!head.querySelector('.mio-slot-btn'))head.insertAdjacentHTML('beforeend',mioSlotButtons('toolbar',{plan:selectedPlan(),story},'small ghost'));
    const title=$('.workshop-page-title');if(title&&!title.querySelector('.mio-slot-btn')){const html=mioSlotButtons('frame-card',mioSlotContext({index:workshop.frame}),'');if(html)title.insertAdjacentHTML('beforeend',html)}
  }
  if(mioTheme.lock&&document.documentElement.dataset.theme!==mioTheme.lock)document.documentElement.dataset.theme=mioTheme.lock;
}
const mioTheme={lock:null};
