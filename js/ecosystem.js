/* Ecosystem SDK v3 (front end). Third-party JS and Python are trusted code, never a sandbox claim.
   This file owns: extension module lifecycle + hot reload, the `ctx` handed to index.js, the theme
   stack (CSS layers, icons, theme scripts, per-theme settings), the 设置 → 扩展中心 screen and the
   macro ("可执行变量") UI. Slots/anchors/mounts/patches/filters/keys live in platform.js; the
   样式工坊 (Style Studio) UI lives in style-studio.js. */
'use strict';
const ecoState={status:{extensions:[],themes:{items:[],stack:[],active:''},styles:{},scripts:[],node:false,git:false,safeMode:false,platform:{},watching:false,sdkVersion:3},customize:{snippets:[],scripts:[],assets:[]},view:{extensions:'installed',themes:'themes'},scripts:[],scriptsDirty:new Set(),loaded:new Map(),types:new Map(),errors:[],forceNext:false,themeSerial:0,activeTheme:'',activeThemes:[],themeScripts:new Map(),themeCompiled:null,settingsCache:new Map(),watchTimer:null,watchBusy:false,preparing:new Set(),booted:false};
const ECO_SLOT_MOUNTS={statusbar:{target:'#statusbar',position:'beforeend',tag:'span',className:'mio-statusbar-item'},topbar:{target:'#topbar',position:'beforeend',tag:'span',className:'mio-topbar-item'},sidebar:{target:'#sidebar nav',position:'beforeend',tag:'div',className:'mio-sidebar-item'},reader:{target:'#reader .room-footer',position:'beforeend',tag:'span',className:'mio-reader-item'},home:{target:'.home-steps',position:'afterend',tag:'section',className:'home-section mio-home-section'}};
function ecoBytes(n){return n>=1048576?(n/1048576).toFixed(1)+' MiB':n>=1024?Math.round(n/1024)+' KiB':n+' B'}
async function ecoRequest(path,body,timeout=125000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{const response=await fetch('/api/ecosystem/'+path,{credentials:'same-origin',signal:controller.signal,...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const type=response.headers.get('Content-Type')||'';if(!type.includes('json')){if(!response.ok)throw Error('HTTP '+response.status);return response}const result=await response.json();if(!response.ok)throw Error(result.error||'HTTP '+response.status);return result.data}finally{clearTimeout(timer)}
}
function ensureSourceStory(p){
  const t=templateBy(p.templateId);if(t?.ownerPlanId===p.id)return t;
  if(t&&!t.ownerPlanId&&!state.creation.plans.some(other=>other.id!==p.id&&other.templateId===t.id)&&!state.books.some(b=>b.templateId===t.id)){t.ownerPlanId=p.id;createUI.sceneScope='plan';save();return t}
  const story=t?{...clone(t),id:uid('story'),ownerPlanId:p.id,title:p.title}:{id:uid('story'),projectId:p.projectId,ownerPlanId:p.id,title:p.title,outline:'',frames:[]};
  state.templates.push(story);p.templateId=story.id;ui.templateId=story.id;createUI.sceneScope='plan';save();return story;
}
/* ---- shared core facade: what extensions and theme scripts may reach without ceremony. ---- */
function ecoCoreFacade(){
  return Object.freeze({
    get state(){return state},get ui(){return ui},get rt(){return rt},get createUI(){return typeof createUI!=='undefined'?createUI:undefined},get studioUI(){return typeof studioUI!=='undefined'?studioUI:undefined},
    save:()=>save(),render:()=>render(),renderShell:()=>renderShell(),navigate:route=>navigate(route),
    modal:(title,html,sub,wide)=>modal(title,html,sub,wide),closeModal:()=>closeModal(),toast:(message,type)=>toast(message,type),confirmAction:(title,message,label)=>confirmAction(title,message,label),textModal:(title,label,value,cb,desc)=>textModal(title,label,value,cb,desc),
    request:(url,options,timeout)=>request(url,options,timeout),post:body=>post(body),download:(name,content,type)=>download(name,content,type),pickFile:(accept,fn,multiple)=>pickFile(accept,fn,multiple),
    icon,btn,ibtn,field,input,opt,esc,uid,clone,heading:(...args)=>heading(...args),
    selectedPlan:()=>selectedPlan(),templateBy:id=>templateBy(id),bookBy:id=>bookBy(id),openReader:id=>openReader(id),closeReader:()=>closeReader(),
    actions:v3Actions,globals:globalThis,platform:MioPlatform,icons:MioIcons,albums:MioAlbums
  });
}
function ecoAssetURL(plugin,relative){return '/extension-assets/'+plugin.id+'/'+encodeURIComponent(plugin.revision||'0')+'/'+String(relative).replace(/^\/+/,'')}
/* ---- the extension context. Everything is owner-scoped so dropExtension() can undo it. */
function ecoContext(id,options={}){
  const plugin=options.manifest||ecoState.status.extensions.find(p=>p.id===id)||{id},owner=options.owner||id;
  async function api(path,body,{tier,raw=false,method,timeout=600000,headers}={}){
    if(typeof path!=='string'||!path.startsWith('/')||path.includes('..'))throw Error('Use a plugin-local route such as /notes');
    const url='/api/extensions/'+id+path+(tier?(path.includes('?')?'&':'?')+'tier='+tier:'');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{const response=await fetch(url,{credentials:'same-origin',signal:controller.signal,method:method||(body===undefined?'GET':'POST'),...(body===undefined?{}:{headers:{'Content-Type':'application/json',...(headers||{})},body:JSON.stringify(body)})});
      if(raw)return response;const type=response.headers.get('Content-Type')||'';if(!type.includes('application/json')){if(!response.ok)throw Error('HTTP '+response.status);return response}
      const json=await response.json().catch(()=>({}));if(!response.ok||json.error)throw Error(json.error||('HTTP '+response.status));return json.data}
    finally{clearTimeout(timer)}
  }
  api.url=path=>'/api/extensions/'+id+String(path||'/');
  const store=tier=>Object.freeze({get:k=>api('/storage?key='+encodeURIComponent(k),undefined,{tier}),set:(k,value)=>api('/storage',{key:k,value,tier}),delete:k=>api('/storage',{key:k,delete:true,tier})});
  const filesBase='/api/ecosystem/extensions/'+id+'/files/';
  const files=Object.freeze({
    url:path=>filesBase+String(path).replace(/^\/+/,'').split('/').map(encodeURIComponent).join('/'),
    list:(prefix='')=>ecoRequest('extensions/'+id+'/files/'+String(prefix).replace(/^\/+/,'')+(prefix&&!String(prefix).endsWith('/')?'/':'')),
    read:path=>fetch(files.url(path),{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r}),
    text:path=>files.read(path).then(r=>r.text()),json:path=>files.read(path).then(r=>r.json()),blob:path=>files.read(path).then(r=>r.blob()),
    write:async(path,data)=>{const body=typeof data==='string'?new Blob([data],{type:'text/plain'}):data instanceof Blob?data:new Blob([data]);const r=await fetch(files.url(path),{method:'PUT',credentials:'same-origin',headers:{'Content-Type':body.type||'application/octet-stream'},body});const json=await r.json().catch(()=>({}));if(!r.ok)throw Error(json.error||'HTTP '+r.status);return json.data},
    delete:async path=>{const r=await fetch(files.url(path),{method:'DELETE',credentials:'same-origin'});const json=await r.json().catch(()=>({}));if(!r.ok)throw Error(json.error||'HTTP '+r.status);return json.data}
  });
  const slot=name=>{
    const mountSpec=ECO_SLOT_MOUNTS[name];
    return Object.freeze({
      name,
      register:item=>{
        const off1=MioPlatform.register(name,item,owner);
        let off2=()=>{};
        if(mountSpec&&item?.id){
          off2=MioPlatform.mount({
            id:name+'-'+item.id,
            selector:item.target||mountSpec.target,
            position:item.position||mountSpec.position,
            tag:item.tag||mountSpec.tag,
            cls:mountSpec.className+' '+(item.className||''),
            when:item.when,
            live:item.live,
            render:typeof item.render==='function'?(container,target,context)=>item.render(container,{target,...context}):undefined,
            html:typeof item.html==='string'||typeof item.html==='function'?item.html:undefined
          },owner);
        }
        return ()=>{off1();off2()};
      },
      items:context=>MioPlatform.items(name,context),
      find:k=>MioPlatform.find(name,k)
    });
  };
  const slotAlias={frameCard:'frame-card',albumCard:'album-card',contextMenu:'context-menu'};
  const slots=new Proxy({},{get:(_,name)=>typeof name==='string'?slot(slotAlias[name]||name.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())):undefined,has:()=>true,ownKeys:()=>MioPlatform.slotNames(),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
  const disposers=()=>{const entry=ecoState.loaded.get(id);if(entry&&!entry.failed)return entry.disposers||(entry.disposers=[]);const pending=ecoState.pendingDisposers||(ecoState.pendingDisposers=new Map());if(!pending.has(id))pending.set(id,[]);return pending.get(id)};
  const settingsEvent='ext:'+id+':settings.changed';
  return Object.freeze({
    id,apiVersion:3,manifest:clone(plugin),dev:plugin.source==='link',revision:plugin.revision||'0',api,request:api,
    files,
    storage:store('workspace'),data:Object.freeze({config:store('config'),workspace:store('workspace'),cache:store('cache'),tmp:store('tmp')}),
    settings:Object.freeze({get:async()=>(await api('/settings')).values,schema:()=>clone(plugin.settings||[]),set:values=>api('/settings',{values}).then(r=>{MioPlatform.emit(settingsEvent,values,{source:owner,relay:false});return r}),onChange:handler=>MioPlatform.on(settingsEvent,handler,{owner})}),
    tasks:Object.freeze({list:()=>api('/tasks'),get:taskId=>api('/tasks?id='+encodeURIComponent(taskId)),cancel:taskId=>api('/tasks',{id:taskId,cancel:true}),
      wait:async(taskId,{interval=500,onProgress,timeout=3600000}={})=>{const started=Date.now();for(;;){const task=await api('/tasks?id='+encodeURIComponent(taskId));if(!task)throw Error('任务不存在：'+taskId);if(onProgress)try{onProgress(task)}catch(e){MioPlatform.fail(owner,'task progress',e)}if(task.status!=='running'){if(task.status==='failed')throw Error(task.error||'任务失败');return task}if(Date.now()-started>timeout)throw Error('等待任务超时');await new Promise(r=>setTimeout(r,interval))}}}),
    events:Object.freeze({on:(event,handler,options={})=>MioPlatform.on(event,handler,{...options,owner}),once:(event,handler,options={})=>MioPlatform.on(event,handler,{...options,owner,once:true}),emit:(name,payload,options={})=>MioPlatform.emit(name,payload,{...options,source:owner}),recent:()=>MioPlatform.recent.slice(-80)}),
    slots,anchors:Object.freeze({register:(anchor,item)=>MioPlatform.register('anchor:'+anchor,item,owner),list:()=>[...new Set([...document.querySelectorAll('[data-mio-anchor]')].map(n=>n.dataset.mioAnchor))],refresh:()=>MioPlatform.decorate()}),
    mount:spec=>MioPlatform.mount(spec,owner),
    mounts:Object.freeze({add:spec=>MioPlatform.mount(spec,owner),remove:localId=>MioPlatform.unmount(owner+':'+localId),apply:()=>MioPlatform.applyMounts()}),
    styles:Object.freeze({add:(css,key='default')=>MioPlatform.setStyle(owner,key,css),link:(href,key)=>MioPlatform.linkStyle(owner,key||href,/^(\/|https?:|data:|blob:)/.test(href)?href:ecoAssetURL(plugin,href)),vars:(map,selector=':root')=>MioPlatform.setStyle(owner,'vars:'+selector,selector+'{'+Object.entries(map||{}).map(([k,v])=>k+':'+v).join(';')+'}'),remove:(key='default')=>MioPlatform.removeStyle(owner,key),clear:()=>MioPlatform.clearStyles(owner)}),
    patch:(...args)=>{if(typeof args[0]==='string'){const [name,wrapper,options]=args;return MioPlatform.patch(name,wrapper,{...(options||{}),owner})}const [target,name,wrapper,options]=args;return MioPlatform.patch(target,name,wrapper,{...(options||{}),owner})},
    around:(name,wrapper,options)=>MioPlatform.patch(name,wrapper,{...(options||{}),owner}),
    filters:Object.freeze({add:(name,fn,options={})=>MioPlatform.addFilter(name,fn,{...options,owner}),apply:(name,value,context)=>MioPlatform.applyFilter(name,value,context),applyAsync:(name,value,context)=>MioPlatform.applyFilterAsync(name,value,context),names:()=>MioPlatform.filterNames()}),
    keys:Object.freeze({register:(combo,run,options={})=>MioPlatform.bindKey(combo,run,{...options,owner}),list:()=>MioPlatform.keyList()}),
    keymap:Object.freeze({add:spec=>MioPlatform.bindKey(spec.keys||spec.key,spec.run,{id:spec.id,label:spec.label,owner}),list:()=>MioPlatform.keyList()}),
    exporters:Object.freeze({register:spec=>MioPlatform.registerExporter(spec,owner),list:()=>mioExporterList()}),
    importers:Object.freeze({register:spec=>MioPlatform.registerImporter(spec,owner),list:()=>mioImporterList()}),
    albums:MioAlbums,
    icons:Object.freeze({mount:map=>{MioIcons.mount('ext:'+owner,map);renderShell()},names:()=>MioIcons.names(),resolve:name=>MioIcons.resolve(name)}),
    variables:Object.freeze({registerType:(name,definition)=>{if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name))throw Error('Type id must match [a-z][a-z0-9_-]{0,63}');const k='plugin:'+owner+':'+name;if(ecoState.types.has(k))throw Error('Duplicate variable type');if(typeof definition.normalize!=='function')throw Error('Type requires normalize');ecoState.types.set(k,{...definition,owner});variableTypes[k]=definition.label||name}}),
    ui:Object.freeze({toast:(message,level)=>toast('['+(plugin.name||id)+'] '+message,level==='error'?'error':'ok'),confirm:(title,message,label)=>confirmAction(title,message,label),modal:(title,html,sub,wide)=>modal(title,html,sub,wide),closeModal,textModal:(title,label,value,cb,desc)=>textModal(title,label,value,cb,desc),icon:(name,cls)=>icon(name,cls),button:(label,iconName,action,attrs,cls)=>btn(label,iconName,action,attrs,cls),iconButton:(iconName,action,label,attrs)=>ibtn(iconName,action,label,attrs),field:(label,control,help)=>field(label,control,help),input:(name,value,type,attrs)=>input(name,value,type,attrs),esc,navigate:route=>navigate(typeof route==='string'&&!MioPlatform.find('nav',route)&&!/^\d+$/.test(route)?owner+':'+route:route),openReader:bookId=>openReader(bookId),render:()=>render(),download:(name,content,type)=>download(name,content,type),pickFile:(accept,fn,multiple)=>pickFile(accept,fn,multiple),settingsTab:tab=>{studioUI.settingsTab=tab.includes(':')?'ext:'+tab:'ext:'+owner+':'+tab;navigate(5)}}),
    host:Object.freeze({request:(url,options,timeout)=>request(url,options,timeout),fetch:(url,options)=>fetch(url,{credentials:'same-origin',...(options||{})}),production:Object.freeze({tasks:()=>productionRequest('tasks'),start:(taskId,options)=>startProduction(taskId,options),control:(action,body)=>productionRequest('control',{action,...body})}),platform:()=>clone(ecoState.status.platform),status:()=>clone(ecoState.status),ecosystem:(path,body)=>ecoRequest(path,body)}),
    core:ecoCoreFacade(),
    extensions:Object.freeze({list:()=>ecoState.status.extensions.map(p=>({id:p.id,name:p.name,version:p.version,enabled:!!p.enabled,loaded:ecoState.loaded.has(p.id)&&!ecoState.loaded.get(p.id).failed,contributes:clone(p.contributes||{})})),get:target=>MioPlatform.extension(target),whenReady:(target,timeout)=>MioPlatform.whenReady(target,timeout),call:(target,path,body)=>ecoContext(target).api(path,body)}),
    expose:apiObject=>MioPlatform.expose(owner,apiObject),
    theme:Object.freeze({stack:()=>clone(ecoState.status.themes.stack||[]),active:()=>ecoState.status.themes.active||'',mode:()=>document.documentElement.dataset.theme,setMode:mode=>{if(mode==='dark'||mode==='light'){document.documentElement.dataset.theme=mode;try{localStorage.setItem('cc-theme',mode)}catch{}renderShell()}},variants:()=>String(document.documentElement.dataset.themeVariant||'').split(' ').filter(Boolean),tokens:()=>ecoRequest('styles').then(s=>s.tokens),setVar:(name,value,selector=':root')=>MioPlatform.setStyle(owner,'var:'+name,selector+'{'+name+':'+value+'}')}),
    assetURL:relative=>ecoAssetURL(plugin,relative),
    log:(...args)=>console.info('[ext:'+id+']',...args),
    onDispose:fn=>{if(typeof fn==='function')disposers().push(fn)},
    reload:()=>ecoReloadExtension(id)
  });
}
function dropExtension(id){
  const loaded=ecoState.loaded.get(id);
  for(const fn of [...(loaded?.disposers||[]),...(ecoState.pendingDisposers?.get(id)||[])])try{fn()}catch(e){ecoState.errors.push(id+': '+e.message)}
  ecoState.pendingDisposers?.delete(id);
  if(loaded?.dispose)try{loaded.dispose()}catch(e){ecoState.errors.push(id+': '+e.message)}
  MioPlatform.unregisterOwner(id);for(const [key,value] of ecoState.types)if(value.owner===id){ecoState.types.delete(key);delete variableTypes[key]}
  ecoState.loaded.delete(id);if(typeof ui.workspace==='string'&&ui.workspace.startsWith(id+':'))ui.workspace=0;if(String(studioUI?.settingsTab||'').startsWith('ext:'+id+':'))studioUI.settingsTab='extensions';
}
async function loadExtension(plugin){
  const entry={revision:plugin.revision,dispose:null,disposers:[],failed:false,loadedAt:Date.now()};ecoState.loaded.set(plugin.id,entry);
  const pending=ecoState.pendingDisposers?.get(plugin.id);if(pending){entry.disposers.push(...pending);ecoState.pendingDisposers.delete(plugin.id)}
  try{
    (plugin.styles||[]).forEach((file,i)=>MioPlatform.linkStyle(plugin.id,'manifest:'+i,ecoAssetURL(plugin,file)));
    if(plugin.entry){
      const module=await import(ecoAssetURL(plugin,plugin.entry));if(typeof module.default!=='function')throw Error('index.js must export default function(ctx)');
      const result=await module.default(ecoContext(plugin.id));
      if(typeof result==='function')entry.dispose=result;else if(result&&typeof result==='object'){if(typeof result.dispose==='function')entry.dispose=result.dispose;if(result.api!==undefined)MioPlatform.expose(plugin.id,result.api)}
    }
    await MioPlatform.emit('extension.loaded',{id:plugin.id,revision:plugin.revision},{relay:false});
  }catch(e){dropExtension(plugin.id);ecoState.loaded.set(plugin.id,{failed:true,revision:plugin.revision,error:e.message});ecoState.errors.push((plugin.name||plugin.id)+': '+e.message);MioPlatform.fail(plugin.id,'load',e)}
}
async function syncExtensions(){
  const enabled=window.MioSafeMode||ecoState.status.safeMode?[]:ecoState.status.extensions.filter(p=>p.enabled&&(p.entry||p.styles?.length));
  for(const id of [...ecoState.loaded.keys()]){
    if(id.startsWith('theme:')||id.startsWith('script:'))continue;
    if(!enabled.some(p=>p.id===id))dropExtension(id);
  }
  for(const plugin of enabled){const current=ecoState.loaded.get(plugin.id);if(current&&current.revision===plugin.revision)continue;if(current)dropExtension(plugin.id);await loadExtension(plugin)}
  await MioPlatform.emit('extensions.synced',{loaded:[...ecoState.loaded.keys()]},{relay:false});
}
async function syncUserScripts(){
  const off=window.MioSafeMode||ecoState.status.safeMode;
  const list=(ecoState.customize?.scripts||ecoState.status?.scripts||[]);
  const enabled=off?[]:list.filter(s=>s.enabled);
  for(const owner of [...ecoState.loaded.keys()]){
    if(!owner.startsWith('script:'))continue;
    const current=enabled.find(s=>'script:'+s.id===owner);
    const entry=ecoState.loaded.get(owner);
    if(!current||(current.url&&entry?.revision!==current.url))dropExtension(owner);
  }
  for(const script of enabled){
    const owner='script:'+script.id;
    if(ecoState.loaded.has(owner))continue;
    const entry={revision:script.url||'0',dispose:null,disposers:[],failed:false,loadedAt:Date.now()};
    ecoState.loaded.set(owner,entry);
    try{
      const module=await import(script.url);
      if(typeof module.default!=='function')throw Error('User script must export default function(ctx)');
      const ctx=ecoContext(script.id,{kind:'script',owner,manifest:{id:script.id,name:script.name,version:'',apiVersion:3},base:'/customize/assets/'});
      const result=await module.default(ctx);
      if(typeof result==='function')entry.dispose=result;
      else if(result&&typeof result==='object'&&typeof result.dispose==='function')entry.dispose=result.dispose;
      await MioPlatform.emit('script.loaded',{id:script.id},{relay:false});
    }catch(e){
      dropExtension(owner);
      ecoState.loaded.set(owner,{failed:true,revision:script.url||'0',error:e.message});
      ecoState.errors.push('用户脚本 '+(script.name||script.id)+'：'+e.message);
      MioPlatform.fail(owner,'script',e);
    }
  }
}
async function ecoReloadExtension(id){await ecoRequest('extensions/reload',{id});await refreshEcosystem();render();toast('已重新加载：'+id)}
/* ---- theme stack ------------------------------------------------------------------------ */
function ecoThemeSettingsCss(theme){
  const values=theme.values||{},rules={};
  for(const f of theme.settings||[]){if(!f.var||f.type==='toggle')continue;let v=values[f.key];if(v===undefined||v===null||v==='')v=f.default;if(v===undefined||v===null||v==='')continue;const selector=f.selector||':root,:root[data-theme]';(rules[selector]=rules[selector]||[]).push(f.var+':'+String(v)+(f.unit&&/^-?\d+(\.\d+)?$/.test(String(v))?f.unit:''))}
  return Object.entries(rules).map(([s,d])=>s+'{'+d.join(';')+'}').join('\n');
}
function ecoApplyThemeSettings(stack){
  MioPlatform.layer('theme-settings').textContent=stack.map(t=>{const css=ecoThemeSettingsCss(t);return css?'/* == '+t.id+' settings == */\n'+css:''}).filter(Boolean).join('\n');
  const variants=stack.map(t=>t.values?.__variant).filter(v=>v&&v!=='dark'&&v!=='light');
  if(variants.length)document.documentElement.dataset.themeVariant=variants.join(' ');else delete document.documentElement.dataset.themeVariant;
  for(const t of stack){const script=ecoState.themeScripts.get(t.id);if(script?.ctx)script.ctx._notify(clone(t.values||{}))}
}
function ecoThemeContext(theme){
  const owner='theme:'+theme.id,handlers=new Set();
  return Object.freeze({
    id:theme.id,kind:'theme',apiVersion:3,settings:clone(theme.values||{}),schema:clone(theme.settings||[]),revision:theme.revision,
    onSettings:fn=>{handlers.add(fn);return()=>handlers.delete(fn)},_notify:values=>{for(const fn of handlers)try{fn(values)}catch(e){MioPlatform.fail(owner,'onSettings',e)}},
    core:ecoCoreFacade(),
    styles:Object.freeze({add:(css,key='script')=>MioPlatform.setStyle(owner,key,css),remove:(key='script')=>MioPlatform.removeStyle(owner,key)}),
    mount:spec=>MioPlatform.mount(spec,owner),anchors:Object.freeze({register:(anchor,item)=>MioPlatform.register('anchor:'+anchor,item,owner)}),
    events:Object.freeze({on:(event,handler,options={})=>MioPlatform.on(event,handler,{...options,owner}),emit:(name,payload)=>MioPlatform.emit(name,payload,{source:owner})}),
    patch:(...args)=>{if(typeof args[0]==='string'){const [name,wrapper,options]=args;return MioPlatform.patch(name,wrapper,{...(options||{}),owner})}const [target,name,wrapper,options]=args;return MioPlatform.patch(target,name,wrapper,{...(options||{}),owner})},
    keys:Object.freeze({register:(combo,run,options={})=>MioPlatform.bindKey(combo,run,{...options,owner})}),
    icons:Object.freeze({mount:map=>{MioIcons.mount(owner+':script',map);renderShell()}}),
    mode:()=>document.documentElement.dataset.theme,
    assetURL:relative=>'/theme-assets/'+theme.id+'/'+encodeURIComponent(theme.revision||'0')+'/'+String(relative).replace(/^\/+/,''),
    log:(...args)=>console.info('['+owner+']',...args)
  });
}
async function ecoSyncThemeScripts(stack){
  const wanted=new Map(stack.filter(t=>t.script).map(t=>[t.id,t]));
  for(const [id,entry] of [...ecoState.themeScripts]){const theme=wanted.get(id);if(theme&&theme.revision===entry.revision)continue;try{entry.dispose?.()}catch(e){ecoState.errors.push('主题脚本卸载失败：'+e.message)}MioPlatform.unregisterOwner('theme:'+id);MioIcons.unmount('theme:'+id+':script');ecoState.themeScripts.delete(id)}
  for(const theme of wanted.values()){
    if(ecoState.themeScripts.has(theme.id))continue;
    const entry={revision:theme.revision,dispose:null,ctx:null};ecoState.themeScripts.set(theme.id,entry);
    try{const module=await import(theme.script+'?rev='+encodeURIComponent(theme.revision));if(typeof module.default!=='function')throw Error('theme script must export default function(ctx)');entry.ctx=ecoThemeContext(theme);const result=await module.default(entry.ctx);if(typeof result==='function')entry.dispose=result}
    catch(e){ecoState.errors.push('主题脚本 '+theme.id+'：'+e.message);MioPlatform.fail('theme:'+theme.id,'script',e)}
  }
}
function ecoClearThemes(){
  MioPlatform.layer('themes').textContent='';MioPlatform.layer('theme-settings').textContent='';MioPlatform.layer('user-tokens').textContent='';MioPlatform.layer('user-snippets').textContent='';
  for(const id of [...MioIcons.order])if(id.startsWith('theme:'))MioIcons.unmount(id);
  for(const [id,entry] of [...ecoState.themeScripts]){try{entry.dispose?.()}catch{}MioPlatform.unregisterOwner('theme:'+id);ecoState.themeScripts.delete(id)}
  delete document.documentElement.dataset.themeVariant;mioTheme.lock=null;ecoState.activeTheme='';ecoState.activeThemes=[];ecoState.themeCompiled=null;
}
async function applyEcosystemTheme(){
  const serial=++ecoState.themeSerial;
  if(window.MioSafeMode||ecoState.status.safeMode){ecoClearThemes();renderShell();return}
  let compiled;try{compiled=await ecoRequest('themes/compiled')}catch(e){ecoState.errors.push('主题未加载：'+e.message);return}
  if(serial!==ecoState.themeSerial)return;
  ecoState.themeCompiled=compiled;const stack=compiled.stack||[];
  MioPlatform.layer('themes').textContent=stack.map(t=>'/* == theme: '+t.id+' == */\n'+(t.css||'')).join('\n');
  if(!(typeof styleStudio!=='undefined'&&styleStudio.previewing)){MioPlatform.layer('user-tokens').textContent=compiled.tokens||'';MioPlatform.layer('user-snippets').textContent=compiled.snippets||''}
  ecoApplyThemeSettings(stack);
  for(const id of [...MioIcons.order])if(id.startsWith('theme:')&&!id.endsWith(':script'))MioIcons.unmount(id);
  for(const t of stack)if(t.icons&&Object.keys(t.icons).length)MioIcons.mount('theme:'+t.id,t.icons);
  const lock=[...stack].reverse().find(t=>t.colorScheme==='dark'||t.colorScheme==='light');mioTheme.lock=lock?lock.colorScheme:null;if(mioTheme.lock)document.documentElement.dataset.theme=mioTheme.lock;
  ecoState.activeTheme=stack.length?stack[stack.length-1].id:'';
  ecoState.activeThemes=stack.map(t=>t.id);
  for(const t of stack)if(t.error)ecoState.errors.push('主题 '+t.id+'：'+t.error);
  await ecoSyncThemeScripts(stack);
  renderShell();
}
/* ---- dev watch: linked folders hot-reload themes and extensions ------------------------- */
function ecoStartWatch(){clearInterval(ecoState.watchTimer);ecoState.watchTimer=null;if(!ecoState.status.watching||window.MioSafeMode)return;ecoState.watchTimer=setInterval(ecoWatchTick,2500)}
async function ecoWatchTick(){
  if(document.hidden||ecoState.watchBusy)return;ecoState.watchBusy=true;
  try{const data=await ecoRequest('watch',undefined,15000);const changed=[...Object.keys(data.themes||{}),...Object.keys(data.extensions||{})];if(changed.length){ecoState.errors=[];await refreshEcosystem();render();toast('已热重载：'+changed.join('、'))}}
  catch(e){/* server restarting: quiet */}
  finally{ecoState.watchBusy=false}
}
async function refreshEcosystem(){
  ecoState.status=await ecoRequest('status');
  try{ecoState.customize=await ecoRequest('customize')}catch(e){ecoState.customize={snippets:[],scripts:[],assets:[]}}
  await applyEcosystemTheme();
  await syncExtensions();
  await syncUserScripts();
  ecoStartWatch();
}
async function ecoLoadSettings(id){const data=await ecoContext(id).api('/settings');ecoState.settingsCache.set(id,data);return data}
function ecoSettingsField(f,value){
  const v=value??f.default??'',attrs=`data-eco-setting="${esc(f.key)}"`;
  if(f.type==='toggle')return `<label class="row"><input type="checkbox" ${attrs} ${v?'checked':''}>${esc(f.label||f.key)}</label>`+(f.help?`<p class="soft small">${esc(f.help)}</p>`:'');
  if(f.type==='select')return field(f.label||f.key,`<select ${attrs}>${(f.options||[]).map(o=>opt(o.value??o,o.label??o,String(v))).join('')}</select>`,f.help||'');
  if(f.type==='textarea'||f.type==='json'||f.type==='code')return field(f.label||f.key,`<textarea rows="${f.type==='code'?8:3}" class="${f.type==='code'?'eco-code':''}" spellcheck="false" ${attrs}>${esc(typeof v==='string'?v:JSON.stringify(v,null,2))}</textarea>`,f.help||'');
  if(f.type==='color')return field(f.label||f.key,`<span class="eco-color-pair"><input type="color" value="${esc(/^#[0-9a-f]{6}$/i.test(String(v))?v:'#888888')}" data-eco-color="${esc(f.key)}"><input type="text" value="${esc(v)}" ${attrs} placeholder="#rrggbb / rgb() / var(--accent)"></span>`,f.help||'');
  if(f.type==='range')return field(f.label||f.key,`<span class="eco-range-pair"><input type="range" value="${esc(v)}" ${attrs} min="${esc(f.min??0)}" max="${esc(f.max??100)}" step="${esc(f.step??1)}"><output>${esc(v)}${esc(f.unit||'')}</output></span>`,f.help||'');
  return field(f.label||f.key,`<input type="${f.type==='number'?'number':f.type==='password'?'password':f.type==='url'?'url':'text'}" value="${esc(v)}" ${attrs} ${f.min!==undefined?`min="${esc(f.min)}"`:''} ${f.max!==undefined?`max="${esc(f.max)}"`:''} ${f.step!==undefined?`step="${esc(f.step)}"`:''} ${f.placeholder?`placeholder="${esc(f.placeholder)}"`:''} ${f.type==='font'?'list="mio-font-list"':''}>`,f.help||'');
}
function ecoReadSettingsForm(schema){const values={};for(const f of schema){const el=$(`[data-eco-setting="${CSS.escape(f.key)}"]`);if(!el)continue;values[f.key]=f.type==='toggle'?el.checked:f.type==='number'||f.type==='range'?Number(el.value):f.type==='json'?JSON.parse(el.value||'null'):el.value}return values}
function ecoUsageLabel(usage){const kb=n=>n>=1048576?(n/1048576).toFixed(1)+' MiB':n>=1024?Math.round(n/1024)+' KiB':n+' B';return ['config','workspace','cache','tmp'].map(t=>`${t} ${kb(usage?.[t]||0)}`).join(' · ')}
function ecoCapabilitySummary(p){const c=p.capabilities||{},parts=[];for(const [k,label] of [['providers','生成后端'],['hooks','管线钩子'],['events','事件'],['exporters','导出器'],['importers','导入器'],['routes','接口']]){const n=Array.isArray(c[k])?c[k].length:0;if(n)parts.push(label+' '+n)}if(c.tasks)parts.push('后台任务');if(p.entry)parts.push('前端界面');if(p.styles?.length)parts.push('样式 '+p.styles.length);if(p.requirements)parts.push('pip 依赖');return parts.join(' · ')||'仅清单'}
function ecoSourceLabel(p){if(p.source==='link')return '本地文件夹 · 热重载';if(p.source==='zip'||p.source==='css')return '导入的包';if(/^https?:/.test(p.source||''))return 'Git · '+p.source.replace(/^https?:\/\//,'').slice(0,48)+(p.branch?' @'+p.branch:'');return p.source||'—'}
function ecoDepsBadge(p){const d=p.deps||{};if(d.status==='installing')return '<span class="eco-badge is-busy">正在安装依赖…</span>';if(d.status==='failed')return `<span class="eco-badge is-danger">依赖安装失败</span> ${btn('查看日志','terminal','eco-extension-deps-log',`data-id="${esc(p.id)}"`,'small ghost')}${btn('重试','refresh','eco-extension-deps',`data-id="${esc(p.id)}"`,'small ghost')}`;if(d.status==='pending')return `<span class="eco-badge">依赖待安装</span> ${btn('安装依赖','download','eco-extension-deps',`data-id="${esc(p.id)}"`,'small ghost')}`;if(d.status==='ready')return '<span class="eco-badge is-ok">依赖已就绪</span>';return ''}
function ecoSubtabs(group,tabs){
  return `<nav class="quiet-tabs eco-subtabs" aria-label="子分类">${tabs.map(([id,label])=>`<button type="button" class="${(ecoState.view[group]||'installed')===id?'active':''}" data-act="eco-view" data-group="${group}" data-view="${id}">${label}</button>`).join('')}</nav>`;
}
function renderUserScriptEditor(){
  const scripts=ecoState.customize?.scripts||ecoState.status?.scripts||[];
  const card=r=>{
    const owner='script:'+r.id;
    const entry=ecoState.loaded.get(owner);
    const status=!r.enabled?'已停用':entry?.failed?'加载失败':entry?'运行中':'等待加载';
    return `<article class="eco-editor ${r.enabled?'is-active':''}" data-script-id="${esc(r.id)}"><header class="eco-editor-head"><label class="eco-switch" title="${r.enabled?'停用':'启用'}"><input type="checkbox" data-script-enabled ${r.enabled?'checked':''}><span></span></label><input class="eco-editor-name" value="${esc(r.name)}" data-script-name aria-label="脚本名称" maxlength="80"><code class="eco-editor-id">${esc(r.id)}</code><span class="spacer"></span><small class="eco-editor-status ${entry?.failed?'danger':''}" data-script-status>${ecoState.scriptsDirty.has(r.id)?'未保存':status}</small>${btn('保存并重载','check','eco-script-save',`data-id="${esc(r.id)}"`,'small primary')}${ibtn('trash','eco-script-delete','删除脚本',`data-id="${esc(r.id)}"`)}</header>${entry?.failed?`<p class="danger small" style="margin:0 0 8px">${esc(entry.error||'')}</p>`:''}<textarea class="eco-code eco-script-code" data-script-source spellcheck="false" aria-label="${esc(r.name)} 的代码">${esc(r.source||'')}</textarea></article>`;
  };
  return `<div class="eco-management-actions">${btn('新建脚本','plus','eco-script-new','','primary')}${btn('导入 .js','upload','eco-script-import')}<a class="btn ghost" href="/docs/ECOSYSTEM_GUIDE.html" target="_blank" rel="noopener">${icon('book','sm')}<span>扩展指南 ↗</span></a></div><p class="help">用户脚本是单文件轻量扩展：编写 ES 模块，<code>export default function (ctx) {…}</code>，拿到的 <code>ctx</code> 与扩展完全相同（<code>ctx.core</code> 直达全部状态与函数，<code>ctx.mounts</code> 往任何位置挂载界面，<code>ctx.around</code> 包装任何函数，<code>ctx.keymap</code> 绑定快捷键，<code>ctx.slots</code> 注册插槽）。返回清理函数即可在停用时自动卸载。</p>${scripts.length?`<div class="eco-editor-list">${scripts.map(card).join('')}</div>`:`<div class="eco-empty"><h3>还没有用户脚本</h3><p>示例在 <code>examples/user-scripts/</code>：字数统计状态栏、快捷键翻页、自动备份提醒。</p></div>`}`;
}
async function saveScript(id){
  const box=$(`[data-script-id="${CSS.escape(id)}"]`);
  const scripts=ecoState.customize?.scripts||ecoState.status?.scripts||[];
  const row=scripts.find(s=>s.id===id);
  if(!row&&!box)return;
  const body={
    id,
    name:box?.querySelector('[data-script-name]')?.value.trim()||row?.name||id,
    source:box?.querySelector('[data-script-source]')?.value??row?.source??'',
    enabled:box?box.querySelector('[data-script-enabled]').checked:!!row?.enabled
  };
  await ecoRequest('customize/scripts/save',body);
  ecoState.scriptsDirty.delete(id);
  dropExtension('script:'+id);
  await refreshEcosystem();
  render();
  toast('脚本已保存并重新加载。');
}
function renderEcosystemSettings(tab){
  if(tab==='themes')return typeof renderStyleStudio==='function'?renderStyleStudio():'<p class="danger">样式工坊未加载。</p>';
  const status=ecoState.status,platform=status.platform||{},describe=MioPlatform.describe();
  const view=ecoState.view?.extensions||'installed';
  const extCard=p=>{const loaded=ecoState.loaded.get(p.id);return `<article class="eco-package ${p.enabled?'is-active':''} ${p.source==='link'?'is-linked':''}"><div class="eco-package-label">${icon(p.source==='link'?'folder':'box')}<span>${p.enabled?(loaded?.failed?'启用但加载失败':'已启用'):'已停用'}</span><small>v${esc(p.version)} · SDK ${p.apiVersion}</small></div><h3>${esc(p.name)}</h3><code>${esc(p.id)}</code>${p.description?`<p>${esc(p.description)}</p>`:''}<p class="soft small">${ecoCapabilitySummary(p)}</p><p class="soft small">来源：${esc(ecoSourceLabel(p))}${p.source==='link'?`<br><code class="eco-path">${esc(p.path||'')}</code>`:''}</p><p class="soft small">数据：${ecoUsageLabel(p.data)}</p>${ecoDepsBadge(p)?`<p>${ecoDepsBadge(p)}</p>`:''}${p.missing?'<p class="danger">链接的文件夹不存在。</p>':''}${p.error?`<p class="danger">${esc(p.error)}</p>`:''}${loaded?.failed?`<p class="danger">前端加载失败：${esc(loaded.error||'')}</p>`:''}<div class="eco-package-actions">${btn(p.enabled?'停用':'启用',p.enabled?'pause':'play','eco-extension-toggle',`data-id="${esc(p.id)}" data-enabled="${p.enabled?'0':'1'}"`,'small')}${p.settings?.length?btn('设置','settings','eco-extension-settings',`data-id="${esc(p.id)}" ${p.enabled?'':'disabled title="请先启用扩展"'}`,'small ghost'):''}${btn('重新加载','refresh','eco-extension-reload',`data-id="${esc(p.id)}" title="重读清单并重启前后端代码"`,'small ghost')}${btn('文件','folder','eco-extension-files',`data-id="${esc(p.id)}"`,'small ghost')}${/^https?:/.test(p.source||'')?btn('更新代码','download','eco-extension-update',`data-id="${esc(p.id)}" ${p.enabled?'disabled title="请先停用扩展"':''}`,'small ghost'):''}${btn('清理缓存','trash','eco-extension-purge',`data-id="${esc(p.id)}"`,'small ghost')}${btn(p.source==='link'?'取消链接':'卸载','trash','eco-extension-remove',`data-id="${esc(p.id)}"`,'small ghost')}</div></article>`};
  const hooksList=Array.isArray(platform.hooks)?platform.hooks:Object.entries(platform.hooks||{}).map(([name,handlers])=>({name,handlers}));
  const eventsList=Array.isArray(platform.events)?platform.events:Object.entries(platform.events||{}).map(([name,items])=>({name,listeners:(items||[]).length}));
  const platformPanel=`<details class="quiet-advanced"><summary>平台能力总览（实时）</summary><div class="eco-platform-grid"><div><h4>生成后端 ${(platform.providers||[]).length}</h4>${(platform.providers||[]).map(p=>`<p><code>${esc(p.id)}</code> ${esc(p.label)} <small>${esc(p.owner||'core')}</small></p>`).join('')}</div><div><h4>导出器 ${mioExporterList().length}</h4>${mioExporterList().map(e=>`<p><code>${esc(e.id)}</code> ${esc(e.label)} <small>${esc(e.runtime)}</small></p>`).join('')}</div><div><h4>导入器 ${mioImporterList().length}</h4>${mioImporterList().map(e=>`<p><code>${esc(e.id)}</code> ${esc(e.label)} ${btn('导入','upload','mio-import',`data-importer="${esc(e.id)}"`,'small ghost')}</p>`).join('')}</div><div><h4>管线钩子</h4>${hooksList.map(h=>`<p><code>${esc(h.name)}</code> <small>${(h.handlers||[]).map(x=>esc(x.owner||x)).join(', ')||'无扩展'}</small></p>`).join('')}</div><div><h4>后端事件</h4>${eventsList.map(e=>`<p><code>${esc(e.name)}</code> <small>${e.listeners||0} 监听</small></p>`).join('')}</div><div><h4>界面插槽与锚点</h4>${Object.entries(describe.slots).map(([s,n])=>`<p><code>${esc(s)}</code> <small>${n} 项</small></p>`).join('')}<p><code>mount</code> <small>${describe.mounts} 处</small></p></div><div><h4>补丁 / 过滤器 / 快捷键</h4>${describe.patches.map(p=>`<p><code>${esc(p.target)}</code> <small>${p.layers.map(esc).join(' → ')}</small></p>`).join('')||'<p class="soft small">没有扩展改写核心函数</p>'}${Object.entries(describe.filters).map(([n,o])=>`<p><code>${esc(n)}</code> <small>${o.map(esc).join(', ')}</small></p>`).join('')}${describe.keys.map(k=>`<p><kbd class="kbd">${esc(k.combo)}</kbd> <small>${esc(k.owner)} ${esc(k.description||'')}</small></p>`).join('')}</div><div><h4>样式注入</h4>${describe.styles.map(s=>`<p><code>${esc(s.key)}</code> <small>${s.kind}${s.size?' · '+s.size+' 字符':''}</small></p>`).join('')||'<p class="soft small">无</p>'}</div></div></details>`;
  const scriptsCount=(ecoState.customize?.scripts||ecoState.status.scripts||[]).length;
  const tabs=ecoSubtabs('extensions',[['installed','已安装 '+status.extensions.length],['scripts','用户脚本 '+scriptsCount]]);
  let bodyHtml='';
  if(view==='scripts'){
    bodyHtml=renderUserScriptEditor();
  }else{
    bodyHtml=`<div class="eco-management-actions">${btn('通过 Git 安装','plus','eco-extension-install','','primary')}${btn('导入扩展 ZIP','upload','eco-extension-zip','','ghost')}${btn('链接本地文件夹','folder','eco-extension-link','','ghost')}${btn('刷新列表','refresh','eco-refresh','','ghost')}<a class="btn ghost" href="?safe_mode=1">进入安全模式 ↗</a></div><div class="eco-dropzone" data-eco-drop="extension" tabindex="0" role="button" data-act="eco-extension-zip" aria-label="导入扩展 ZIP">${icon('upload')}<strong>拖放 .zip 扩展包到这里</strong><span class="soft small">或点击选择文件</span></div><div class="eco-package-grid">${status.extensions.map(extCard).join('')}</div>${!status.extensions.length?'<div class="eco-empty"><h3>扩展库还是一张白纸</h3><p>试试链接 examples/extensions/studio-kit：一个扩展同时演示生成后端、钩子、后台任务、锚点、补丁与快捷键。</p></div>':''}`;
  }
  return `<section class="eco-settings"><header class="eco-heading"><span class="context-kicker">扩展中心 · SDK v3 开放平台</span><h2>为创作，接入更多可能。</h2><p>扩展可以新增页面、面板、按钮与快捷键，改写任意核心函数，注入样式，运行后台任务，提供生成后端与导出器；链接本地文件夹即可边改边看。</p>${tabs}</header>${bodyHtml}${platformPanel}<details class="quiet-advanced"><summary>运行环境与开发文档</summary><p>Node.js ${status.node?'已就绪':'未检测到（可执行变量需要 Node.js 20+）'} · Git ${status.git?'已就绪':'未检测到'} · 平台 SDK ${status.sdkVersion||3} · 数据目录 <code>${esc(status.dataDir||'')}</code>${status.watching?' · 正在监视链接的文件夹':''}</p><p><a href="/docs/ECOSYSTEM_GUIDE.html" target="_blank" rel="noopener">扩展 SDK v3 指南 ↗</a> · <a href="/docs/STYLE_STUDIO.html" target="_blank" rel="noopener">样式工坊与主题包 ↗</a></p></details>${ecoState.errors.length||MioPlatform.failures.length?`<details class="quiet-advanced" open><summary>加载诊断</summary>${ecoState.errors.map(e=>`<p class="danger">${esc(e)}</p>`).join('')}${MioPlatform.failures.slice(-10).map(f=>`<p class="danger">${esc(f.owner)} · ${esc(f.where)} · ${esc(f.error)}</p>`).join('')}${btn('清空诊断','trash','eco-clear-errors','','small ghost')}</details>`:''}</section>`;
}
async function importEcosystemFile(file,kind){
  if(!file)return;if(file.size>256*1024*1024)throw Error('安装包最大 256 MiB。');
  const trusted=await confirmAction(kind==='theme'?'信任这个主题包？':'信任并执行这个扩展？',kind==='theme'?'主题可以改写任何界面样式、加载远程字体，并可附带脚本。出错可用 ?safe_mode=1 恢复。':'JavaScript / Python 扩展具备完全执行能力，可以访问本机与网络。只安装可信作者的包。','我信任并安装');if(!trusted)return;
  const data=(await blobData(file)).split(',')[1];
  await ecoRequest(kind==='theme'?'themes/install':'extensions/install',kind==='theme'?{data,filename:file.name,trusted:true,enable:true}:{zip:data,trusted:true,enable:false});await refreshEcosystem();render();toast(kind==='theme'?'主题已安装并叠加到最上层。':'扩展已安装，默认停用；确认后再启用。');
}
function ecoLinkModal(kind){
  const theme=kind==='theme';
  modal(theme?'链接本地主题文件夹':'链接本地扩展文件夹',`<div class="eco-safety"><div><strong>开发模式：边改边看</strong><p>输入这台电脑上的绝对路径（含 ${theme?'mio.theme.json':'mio.extension.json'}）。文件变动会被自动检测并热重载，不复制文件。</p></div></div>${field('文件夹绝对路径',input('path','','text',`id="eco-link-path" placeholder="${theme?'/Users/me/my-theme 或 D:\\\\themes\\\\my-theme':'/Users/me/my-extension 或 D:\\\\ext\\\\my-extension'}"`))}<label class="row"><input type="checkbox" id="eco-link-trust">我了解风险，这是我自己的代码</label><div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('链接并启用','folder','eco-link-submit',`data-kind="${kind}"`,'primary')}</div>`);
}
function macroEditor(owner,key){
  const p=settingsTargetById(owner),e=p&&mergedSettingEntries(p).find(v=>v.key===key);if(!e)throw Error('属性不存在。');rt.ecoMacro={owner,key,id:e.id};
  modal('可执行变量 · '+settingLabel(e),`<div class="eco-safety"><div><strong>脚本不是被动数据</strong></div></div><div class="grid2">${field('结果类型',`<select id="eco-macro-type">${['text','image','number','boolean','json'].map(t=>opt(t,variableTypes[t],e.type)).join('')}</select>`)}${field('依赖变量（逗号分隔）',input('deps',(e.compute?.dependsOn||[]).join(', '),'text','id="eco-macro-deps" placeholder="character, environment"'))}</div>${field('JavaScript · 函数体，使用 return 返回结果',`<textarea id="eco-macro-code" class="eco-code" spellcheck="false">${esc(e.compute?.script||'const words = ["晨光", "薄雾", "雨后"];\nreturn words[Math.floor(ctx.random() * words.length)];')}</textarea>`)}<div class="grid2">${field('本册随机种子',input('seed',p.macroSeed??1,'number','id="eco-macro-seed" min="0" max="4294967295"'))}${field('执行上限（秒，1–180）',input('timeout',e.compute?.timeout||60,'number','id="eco-macro-timeout" min="1" max="180"'))}</div><p class="help">ctx.get('变量') · ctx.image.generate(prompt, options) · ctx.llm.chat(prompt) · ctx.random() · ctx.seed</p><a href="/docs/COMPUTED_VARIABLES.html" target="_blank" rel="noopener">标准写法与示例 ↗</a><div class="modal-footer">${btn('恢复字面量','refresh','eco-macro-literal','','ghost')}${btn('保存脚本','check','eco-macro-save','','primary')}</div>`,'脚本只在前置准备阶段执行，后续分镜消费独立结果缓存。',true);
}
async function prepareComputedPlan(source){
  if(Object.values(source.sceneOverrides||{}).some(o=>[...(o.variables||[]),...(o.variableSetIds||[]).flatMap(id=>setBy(id)?.entries||[])].some(e=>e.compute)))throw Error('可执行变量应放在本册属性中；单幕仅支持字面量覆盖。');
  const prepared=clone(source);prepared.variables=mergedSettingEntries(source).map(e=>({...clone(e),value:e.compute?e.value:typedVariableValue(e)}));prepared.variableSetIds=[];
  if(!prepared.variables.some(e=>e.compute)){prepared._macroPrepared=true;return prepared}
  if(ecoState.preparing.has(source.id))throw Error('这本画册正在准备前置资产。');
  ecoState.preparing.add(source.id);
  try{
    await MioPlatform.emit('preparation.before',prepared,{relay:false});
    if(!await confirmAction('执行「'+source.title+'」的可执行变量？','脚本可调用已保存的图像与语言模型，可能产生费用。缓存命中时复用已有结果；前置失败不会提交分镜。请确认脚本来源可信。','信任并准备'))throw Error('已取消前置准备。');
    if(!await savePythonWorkspace())throw Error('源画册未保存成功，未执行脚本。');
    const force=!!ecoState.forceNext;ecoState.forceNext=false;
    const {id}=await ecoRequest('preparations',{owner:source.id,seed:source.macroSeed??1,entries:prepared.variables,trusted:true,force});
    let completed=false;
    modal('前置资产准备',`<div class="eco-phase"><span>阶段 0 / 1</span><h3>先准备世界，再开始故事。</h3><div id="eco-preparation-nodes"></div></div><div class="modal-footer">${btn('取消准备','stop','eco-preparation-cancel',`data-id="${esc(id)}"`,'ghost')}</div>`,'分镜尚未进入生成队列。');
    const dialog=$('#modal');const cancel=()=>{if(!completed)ecoRequest('preparations/cancel',{id}).catch(()=>{})};dialog.addEventListener('close',cancel,{once:true});
    try{
      for(;;){
        const job=await ecoRequest('preparations/'+id),area=$('#eco-preparation-nodes');
        if(area)area.innerHTML=Object.entries(job.nodes).map(([key,n])=>`<div class="eco-node"><code>{${esc(key)}}</code><span>${esc(({pending:'等待依赖',running:'执行中',cached:'缓存命中',complete:'已完成',failed:'失败',blocked:'已阻止'})[n.status]||n.status)}</span>${n.error?`<small>${esc(n.error)}</small>`:''}</div>`).join('');
        if(job.status==='complete'){
          if(!dialog.open)throw Error('窗口已关闭；结果保留在缓存，未继续生成。');
          for(const e of prepared.variables){e.value=clone(job.values[e.key]);delete e.compute}prepared._macroPrepared=true;prepared.preparationId=id;completed=true;closeModal();await MioPlatform.emit('preparation.after',prepared,{relay:false});return prepared;
        }
        if(['failed','cancelled','interrupted'].includes(job.status))throw Error(job.error||'前置准备未完成');
        await new Promise(r=>setTimeout(r,400));
      }
    }finally{dialog.removeEventListener('close',cancel);if(!completed){cancel();if(dialog.open)closeModal()}}
  }finally{ecoState.preparing.delete(source.id)}
}
function installEcosystem(){
  const previousValue=typedVariableValue;typedVariableValue=function(e){if(e.type?.startsWith('plugin:')){const type=ecoState.types.get(e.type);if(!type)throw Error('变量类型所属扩展未启用：'+e.type);const value=type.normalize(clone(e.value));if(value?.then||JSON.stringify(value)===undefined)throw Error('扩展类型必须返回同步 JSON 值');return value}return previousValue(e)};
  const enqueue=enqueuePlanSnapshot;enqueuePlanSnapshot=function(p,...args){if(mergedSettingEntries(p).some(e=>e.compute)&&!p._macroPrepared)throw Error('可执行变量尚未准备，使用“生成画册”入口执行阶段 0。');const book=enqueue(p,...args);if(p.preparationId){book.sourceSnapshot.preparationId=p.preparationId;book.sourceSnapshot.macroSeed=p.macroSeed??1;save()}return book};
  const previousQueue=renderCreationQueue;renderCreationQueue=function(){return `<div class="eco-queue-actions">${btn('历史生成记录','clock','eco-history','','small ghost')}${btn('前置准备记录','nodes','eco-prep-history','','small ghost')}${btn('清空前置缓存','trash','eco-cache-clear','','small ghost')}${btn('强制重算并生成','refresh','eco-force-prepare','','small ghost')}</div>`+previousQueue()};
  const previousRender=render;render=function(...args){const result=previousRender(...args);if(window.MioSafeMode)document.documentElement.dataset.theme='light';return result};
  /* filter points the core exposes to extensions (see docs/ECOSYSTEM_GUIDE.md → 过滤器) */
  if(typeof interpolate==='function'){const previousInterpolate=interpolate;interpolate=function(text,row,f,...rest){const out=previousInterpolate(text,row,f,...rest);return typeof out==='string'?MioPlatform.applyFilter('prompt.compose',out,{text,row,frame:f}):out}}
  if(typeof generateFrame==='function'){const previousGenerate=generateFrame;generateFrame=async function(frame,...rest){const next=MioPlatform.applyFilter('frame.render',frame,{args:rest});return previousGenerate(next&&typeof next==='object'?next:frame,...rest)}}
  Object.assign(v3Actions,{
    'eco-refresh':async()=>{await refreshEcosystem();render()},
    'eco-view':d=>{ecoState.view[d.group]=d.view;render()},
    'eco-extension-files':async d=>{
      const rows=await ecoRequest('extensions/'+d.id+'/files/');
      modal(d.id+' · 文件区',`<p class="help">扩展通过 <code>ctx.files</code> 读写的文件，也可以在这里下载。位于 <code>data/extensions/${esc(d.id)}/files/</code>。</p>${rows.length?`<div class="eco-file-list">${rows.map(r=>`<a class="eco-file-row" href="/api/ecosystem/extensions/${esc(d.id)}/files/${r.path.split('/').map(encodeURIComponent).join('/')}?download=1" download><code>${esc(r.path)}</code><small>${ecoBytes(r.size)}</small></a>`).join('')}</div>`:'<p class="soft small">还没有文件。</p>'}<div class="modal-footer">${btn('关闭','','close-modal')}</div>`);
    },
    'eco-clear-errors':()=>{ecoState.errors=[];MioPlatform.failures.length=0;render()},
    'eco-theme-import':()=>pickFile('.css,.zip',file=>importEcosystemFile(file,'theme')),
    'eco-extension-zip':()=>pickFile('.zip',file=>importEcosystemFile(file,'extension')),
    'eco-extension-link':()=>ecoLinkModal('extension'),
    'eco-theme-link':()=>ecoLinkModal('theme'),
    'eco-link-submit':async d=>{if(!$('#eco-link-trust').checked)throw Error('请先确认这是你信任的代码。');const path=$('#eco-link-path').value.trim();if(!path)throw Error('请输入文件夹路径。');const button=$('[data-act="eco-link-submit"]');button.disabled=true;try{await ecoRequest(d.kind==='theme'?'themes/link':'extensions/link',{path,trusted:true,enable:true});closeModal();await refreshEcosystem();render();toast('已链接并启用；文件变动会自动热重载。')}finally{button.disabled=false}},
    'eco-extension-install':()=>modal('安装扩展',`<div class="eco-safety"><div><strong>外部扩展具备完全执行能力</strong><p>扩展的 JavaScript 运行在本页面，Python 运行在独立子进程；两者都能访问本地文件与网络。仅安装你信任的来源。</p></div></div>${field('输入扩展程序的 Git URL 以安装',input('url','','url','id="eco-git-url" placeholder="https://github.com/author/extension-name"'))}${field('分支（可选）',input('branch','','text','id="eco-git-branch" placeholder="main"'))}<label class="row"><input type="checkbox" id="eco-git-trust">我了解风险，信任这个来源</label><div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('下载并安装','download','eco-git-submit','','primary')}</div>`),
    'eco-git-submit':async()=>{const trusted=$('#eco-git-trust').checked;if(!trusted)throw Error('请先确认信任来源。');const url=$('#eco-git-url').value.trim(),branch=$('#eco-git-branch').value.trim();const button=$('[data-act="eco-git-submit"]');button.disabled=true;button.textContent='下载并校验中…';try{await ecoRequest('extensions/install',{url,branch,trusted,enable:false});closeModal();await refreshEcosystem();render();toast('扩展已安装，默认停用；确认后再启用。')}finally{button.disabled=false;button.textContent='下载并安装'}},
    'eco-extension-toggle':async d=>{const enabled=d.enabled==='1';if(enabled&&!await confirmAction('启用扩展代码？','JavaScript 与 Python 将立即执行，仅启用可信代码。','信任并启用'))return;await ecoRequest('extensions/enable',{id:d.id,enabled,trusted:enabled});await refreshEcosystem();render()},
    'eco-extension-update':async d=>{if(!await confirmAction('更新扩展代码？','重新下载所选分支，校验后替换代码。分层数据不动；更新后保持停用，需重新确认启用。','信任并更新'))return;await ecoRequest('extensions/update',{id:d.id,trusted:true});await refreshEcosystem();render()},
    'eco-extension-reload':async d=>{await ecoReloadExtension(d.id)},
    'eco-extension-deps':async d=>{await ecoRequest('extensions/deps',{id:d.id});toast('依赖开始安装（后台 pip）。');await refreshEcosystem();render()},
    'eco-extension-deps-log':d=>{const p=ecoState.status.extensions.find(x=>x.id===d.id);modal('依赖安装日志 · '+(p?.name||d.id),`<pre class="mio-log eco-deps-log">${esc(p?.deps?.log||'（暂无日志）')}</pre><p class="soft small">依赖安装到 <code>${esc(p?.deps?.site||'')}</code>，只对这个扩展的 Python 进程可见。</p>`)},
    'eco-extension-remove':d=>{rt.ecoRemoveId=d.id;const p=ecoState.status.extensions.find(x=>x.id===d.id);modal(p?.source==='link'?'取消链接扩展':'卸载扩展',`<p>${p?.source==='link'?'链接将被移除，你的文件夹原样保留。':'代码仓库将移除。'}选择保留哪些分层数据：</p><p class="soft small">当前占用：${ecoUsageLabel(p?.data)}</p><label class="row"><input type="radio" name="eco-purge" value="none" checked>保留配置与工作区数据（可随时重装继续）</label><label class="row"><input type="radio" name="eco-purge" value="cache">同时清理缓存与临时文件</label><label class="row"><input type="radio" name="eco-purge" value="all">删除全部数据（含已安装的 pip 依赖，不可恢复）</label><div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn(p?.source==='link'?'确认取消链接':'确认卸载','trash','eco-extension-remove-confirm','','danger')}</div>`)},
    'eco-extension-remove-confirm':async()=>{await ecoRequest('extensions/uninstall',{id:rt.ecoRemoveId,purge:$('input[name="eco-purge"]:checked')?.value||'none'});closeModal();await refreshEcosystem();render()},
    'eco-extension-purge':async d=>{if(await confirmAction('清理扩展缓存？','删除 cache 与 tmp 两层数据；配置和工作区数据保留。','清理')){const usage=await ecoRequest('extensions/purge',{id:d.id,level:'cache'});toast('已清理：'+ecoUsageLabel(usage));await refreshEcosystem();render()}},
    'eco-extension-settings':async d=>{const data=await ecoLoadSettings(d.id);const p=ecoState.status.extensions.find(x=>x.id===d.id);modal((p?.name||d.id)+' · 设置',`<form id="eco-settings-form" data-id="${esc(d.id)}">${data.schema.map(f=>ecoSettingsField(f,data.values[f.key])).join('')}<div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('保存','check','eco-extension-settings-save',`data-id="${esc(d.id)}"`,'primary')}</div></form>`)},
    'eco-extension-settings-save':async d=>{const data=ecoState.settingsCache.get(d.id);if(!data)return;const values=ecoReadSettingsForm(data.schema);await ecoContext(d.id).api('/settings',{values});closeModal();toast('设置已保存。');MioPlatform.emit('ext:'+d.id+':settings.changed',values,{source:'core',relay:false})},
    'eco-script-new':async()=>{
      const scripts=ecoState.customize?.scripts||ecoState.status?.scripts||[];
      const saved=await ecoRequest('customize/scripts/save',{name:'新用户脚本 '+(scripts.length+1),source:"export default function(ctx){\n  // 在此编写脚本逻辑\n}\n",enabled:false});
      await refreshEcosystem();
      render();
      requestAnimationFrame(()=>$(`[data-script-id="${CSS.escape(saved.id)}"] textarea`)?.focus());
    },
    'eco-script-save':d=>saveScript(d.id),
    'eco-script-delete':async d=>{
      if(!await confirmAction('删除用户脚本？','脚本文件会被删除，无法恢复。','删除'))return;
      await ecoRequest('customize/scripts/delete',{id:d.id});
      ecoState.scriptsDirty.delete(d.id);
      dropExtension('script:'+d.id);
      await refreshEcosystem();
      render();
    },
    'eco-script-import':()=>pickFile('.js,.mjs',async files=>{
      for(const file of files){
        await ecoRequest('customize/scripts/save',{name:file.name.replace(/\.m?js$/i,''),source:await file.text(),enabled:false});
      }
      await refreshEcosystem();
      render();
      toast('已导入 '+files.length+' 个脚本（默认停用，检查后再启用）。');
    },true),
    'eco-macro-edit':d=>macroEditor(d.owner,d.key),
    'eco-macro-save':()=>{
      const m=rt.ecoMacro,p=settingsTargetById(m.owner),entries=p&&mergedSettingEntries(p),e=entries?.find(x=>x.key===m.key&&x.id===m.id);if(!e)throw Error('属性已变化。');
      const script=$('#eco-macro-code').value,timeout=Number($('#eco-macro-timeout').value),seed=Number($('#eco-macro-seed').value);if(!script.trim()||script.length>32000||!Number.isInteger(seed)||seed<0||seed>=2**32||timeout<1||timeout>180)throw Error('请检查脚本、种子与执行时限。');
      e.type=$('#eco-macro-type').value;e.compute={script,dependsOn:$('#eco-macro-deps').value.split(',').map(x=>x.trim()).filter(Boolean),timeout};p.macroSeed=seed;p.variables=entries;settingsChanged(p);closeModal();render();if(p._presetEditorId)openPresetLibrary(p._presetEditorId);
    },
    'eco-macro-literal':()=>{const m=rt.ecoMacro,p=settingsTargetById(m.owner),entries=p&&mergedSettingEntries(p),e=entries?.find(x=>x.id===m.id);if(!e)return;delete e.compute;p.variables=entries;settingsChanged(p);closeModal();render();if(p._presetEditorId)openPresetLibrary(p._presetEditorId)},
    'eco-preparation-cancel':async d=>{await ecoRequest('preparations/cancel',{id:d.id})},
    'eco-cache-clear':async()=>{if(await confirmAction('清空前置变量缓存？','这不会删除已生成图片，但会移除成功结果和未确认标记。后续准备可能重新调用模型并计费。请确认没有外部请求仍在运行。','确认清空')){await ecoRequest('cache/clear',{trusted:true});toast('前置缓存已清空。')}},
    'eco-prep-history':async()=>{const records=await ecoRequest('preparations');modal('前置准备记录',records.filter(j=>j.owner===selectedPlan()?.id).map(j=>`<div class="eco-history-row"><div><strong>${esc(j.status)}</strong><small>${esc(new Date(j.createdAt*1000).toLocaleString())} · seed ${j.seed}</small>${j.error?`<p class="danger">${esc(j.error)}</p>`:''}<code>${esc(j.id)}</code></div></div>`).join('')||'<p>还没有前置准备记录。</p>')},
    'eco-force-prepare':async()=>{if(await confirmAction('强制重新执行可执行变量？','忽略成功缓存与上次未确认标记，可能再次计费。此次仍使用当前随机种子。','确认重新执行')){ecoState.forceNext=true;try{await generateChosenPlans(true,false)}finally{ecoState.forceNext=false}}},
    'eco-rename-book':()=>{const p=selectedPlan();textModal('重命名画册','作品名称',p.title,name=>{if(!name.trim())throw Error('名称不能为空');p.title=name.trim();save();closeModal();render()})},
    'eco-export-story':async()=>{flushEditor();const p=selectedPlan(),t=ensureSourceStory(p),document={id:uid('story'),title:p.title,outline:t.outline||'',frames:t.frames.map(f=>Object.fromEntries(Object.entries(effectivePlanFrame(p,f)).filter(([k])=>!k.startsWith('_'))))};if(!await savePythonWorkspace())throw Error('故事尚未保存');const r=await request('/api/library/export-document',post({kind:'storyboards',document}));download(p.title+' · 分镜.mio.zip',await r.blob(),'application/zip')},
    'eco-history':()=>{const p=selectedPlan(),jobs=state.queue.filter(q=>q.planId===p.id).sort((a,b)=>b.createdAt-a.createdAt);modal('历史生成记录',`${jobs.map(q=>`<div class="eco-history-row"><div><strong>${esc(bookBy(q.bookId)?.title||'画册')}</strong><small>${esc(new Date(q.createdAt).toLocaleString())} · ${esc(q.status)} · ${q.done}/${q.indices.length} 幕</small></div>${btn('查看画册','book','read',`data-id="${esc(q.bookId)}"`,'small')}</div>`).join('')||'<div class="empty">还没有生成记录。</div>'}`)}
  });
  document.addEventListener('dragover',e=>{if(e.target.closest('[data-eco-drop]'))e.preventDefault()});
  document.addEventListener('drop',e=>{const box=e.target.closest('[data-eco-drop]');if(!box)return;e.preventDefault();importEcosystemFile(e.dataTransfer.files[0],box.dataset.ecoDrop).catch(err=>toast(err.message,'error'))});
  document.addEventListener('keydown',e=>{if(e.target.matches('[data-eco-drop]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.click()}});
  document.addEventListener('input',e=>{
    if(e.target.matches('[data-script-source],[data-script-name]')){const id=e.target.closest('[data-script-id]')?.dataset.scriptId;if(id){ecoState.scriptsDirty.add(id);const status=e.target.closest('article')?.querySelector('[data-script-status]');if(status)status.textContent='未保存'}return}
    const color=e.target.closest('input[data-eco-color]');if(color){const text=color.parentElement.querySelector('input[type="text"]');if(text){text.value=color.value;text.dispatchEvent(new Event('input',{bubbles:true}))}return}
    const pairText=e.target.closest('.eco-color-pair input[type="text"]');if(pairText&&/^#[0-9a-f]{6}$/i.test(pairText.value.trim())){const swatch=pairText.parentElement.querySelector('input[type="color"]');if(swatch)swatch.value=pairText.value.trim().toLowerCase()}
    const range=e.target.closest('.eco-range-pair input[type="range"]');if(range){const out=range.parentElement.querySelector('output');if(out)out.textContent=range.value+(out.textContent.replace(/^-?[\d.]+/,''))}
  });
  document.addEventListener('change',e=>{
    if(e.target.matches('[data-script-enabled]')){const id=e.target.closest('[data-script-id]')?.dataset.scriptId;if(id)saveScript(id).catch(err=>toast(err.message,'error'))}
  });
  window.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){
      const script=e.target.closest?.('[data-script-id]');
      if(script){e.preventDefault();e.stopImmediatePropagation();saveScript(script.dataset.scriptId).catch(err=>toast(err.message,'error'));return}
    }
  },true);
  if(!document.getElementById('mio-font-list')){const list=document.createElement('datalist');list.id='mio-font-list';list.innerHTML=['Inter','"Noto Sans SC"','"Noto Serif SC"','"PingFang SC"','"Microsoft YaHei"','"Songti SC"','"Source Han Sans SC"','"LXGW WenKai"','Georgia','"Cormorant Garamond"','system-ui','monospace'].map(f=>`<option value='${f}'>`).join('');document.body.append(list)}
}
async function bootEcosystem(){
  globalThis.Mio.extensions=Object.freeze({apiVersion:3,platform:MioPlatform,albums:MioAlbums,icons:MioIcons,context:id=>ecoContext(id),core:ecoCoreFacade(),state:ecoState,refresh:()=>refreshEcosystem()});
  try{await refreshEcosystem()}catch(e){ecoState.errors.push(e.message)}
  ecoState.booted=true;
  if(window.MioSafeMode){
    const host=document.createElement('aside');host.style.cssText='position:fixed!important;inset:auto 16px 40px auto!important;z-index:2147483647!important;display:block!important';
    host.id='mio-safe-recovery';const shadow=host.attachShadow({mode:'closed'});shadow.innerHTML='<style>:host{all:initial}section{font:13px system-ui;background:#fff;color:#15271a;border:2px solid #4a7952;border-radius:12px;padding:18px;max-width:320px;box-shadow:0 6px 30px #0003}button{padding:9px;border-radius:6px;border:1px solid #9abfa2;background:#e6f2e6;color:#15271a;cursor:pointer;margin-top:10px}</style><section><b>安全模式 · 官方界面</b><p>第三方主题、用户样式与前端扩展未加载。点击下方可停用所有扩展并恢复官方外观；代码与数据均保留。</p><button>一键重置主题并停用扩展</button></section>';
    shadow.querySelector('button').onclick=async()=>{await ecoRequest('reset',{});shadow.querySelector('p').textContent='已重置。可以移除地址中的 safe_mode=1 后重新访问。'};document.body.append(host);
  }
  render();mioPollActivity();
}
