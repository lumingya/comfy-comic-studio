/* Application bridge for SDK 2. Install last, so every workspace is observable. */
'use strict';
const extensionHost={runtime:null,activeWorkspace:'',mounts:[],pending:false,rendering:false,workspace:'',sync:Promise.resolve()};
const extensionWorkspaceNames={0:'gallery',1:'creation',2:'queue',3:'workflow',4:'stories',5:'settings',6:'logs',7:'laboratory',8:'marketplace',9:'home'};
function extensionWorkspace(){return extensionHost.activeWorkspace||extensionWorkspaceNames[ui.workspace]||String(ui.workspace)}
function extensionRuntime(){
  if(extensionHost.runtime)return extensionHost.runtime;
  extensionHost.runtime=globalThis.MioExtensionRuntime.create({
    report:item=>{ecoState.errors.push(item.owner+' / '+item.phase+': '+item.message);if(ecoState.errors.length>100)ecoState.errors.shift()},
    changed:()=>{},
    openWorkspace:key=>{if(!extensionRuntime().list('workspaces').some(x=>x.key===key))throw Error('Workspace unavailable');closeModal();extensionHost.activeWorkspace=key;render()},
    type:(key,definition)=>{if(definition){ecoState.types.set(key,{...definition,owner:key.split(':')[1]});variableTypes[key]=definition.label||key}else{ecoState.types.delete(key);delete variableTypes[key]}},
    style:(id,css,options)=>{if(typeof css!=='string')throw Error('CSS must be text');const node=document.createElement('style');node.dataset.extensionStyle=id;node.textContent=css;if(options.media)node.media=String(options.media);document.head.append(node);return node}
  });
  return extensionHost.runtime;
}
function extensionContext(id){
  async function api(path,body){if(!path.startsWith('/')||path.includes('..'))throw Error('Use a plugin-local route');const response=await fetch('/api/extensions/'+encodeURIComponent(id)+path,body===undefined?{}:post(body));const data=await response.json();if(!response.ok)throw Error(data.error||'Extension API failed');return data.data}
  return extensionRuntime().context(id,{
    api,storage:Object.freeze({get:k=>api('/storage?key='+encodeURIComponent(k)),set:(k,value)=>api('/storage',{key:k,value}),delete:k=>api('/storage',{key:k,delete:true})}),
    toast:message=>toast('['+id+'] '+message),getAlbum:()=>clone(selectedPlan()),
    assetURL:relative=>{const p=ecoState.status.extensions.find(x=>x.id===id);if(!p)throw Error('Extension not installed');if(typeof relative!=='string'||relative.startsWith('/')||relative.split('/').includes('..'))throw Error('Use a package-local asset');return '/extension-assets/'+id+'/'+encodeURIComponent(p.revision)+'/'+relative},
    app:Object.freeze({getContext:()=>({workspace:extensionWorkspace(),projectId:state.activeProjectId,storyId:workshop.storyId||'',albumId:selectedPlan()?.id||''}),navigate:name=>{const entry=Object.entries(extensionWorkspaceNames).find(([,value])=>value===name);if(!entry)throw Error('Unknown workspace');navigate(Number(entry[0]))},runAction:(name,data={})=>handleAction(name,data),
      getStories:()=>clone(projectTemplates()),getPresets:()=>clone(projectVariableSets()),
      updateStory:async(id,updater)=>{const source=templateBy(id);if(!source)throw Error('Story not found');const draft=clone(source),result=await updater(draft),next=result===undefined?draft:result;if(!next||next.id!==id||typeof next.title!=='string'||!Array.isArray(next.frames))throw Error('Invalid story update');Object.assign(source,next);save();render();await extensionRuntime().emit('story:changed',{id});return clone(source)},
      production:(route,body)=>productionRequest(route,body)
    })
  });
}
function extensionUnmount(preserveWorkspace=false){
  const keep=[];for(const mount of extensionHost.mounts){
    if(mount.active&&mount.root.isConnected&&(mount.root.closest('#modal[open]')||(preserveWorkspace&&mount.root.classList.contains('extension-workspace')))){keep.push(mount);continue}
    mount.active=false;mount.controller.abort();mount.dispose?.();mount.root.remove();
  }extensionHost.mounts=keep;
}
function extensionMount(item,root){
  const runtime=extensionRuntime(),controller=new AbortController(),mount={root,controller,active:true,dispose:null};extensionHost.mounts.push(mount);
  root.dataset.extensionOwner=item.owner;root.dataset.extensionMount=item.key;root.dataset.noTranslate='';
  const owner=runtime.owners.get(item.owner);if(!owner)return;
  const remove=()=>{mount.active=false;controller.abort();mount.dispose?.();mount.dispose=null;root.remove()};
  owner.controller.signal.addEventListener('abort',remove,{once:true});
  const cleanup=()=>owner.controller.signal.removeEventListener('abort',remove);
  mount.dispose=cleanup;
  void runtime.invoke(item,item.render,[root,{...extensionContext(item.owner),mountSignal:controller.signal}]).then(dispose=>{
    if(typeof dispose!=='function')return;
    const safe=()=>{try{Promise.resolve(dispose()).catch(e=>runtime.report(item.owner,'unmount',e))}catch(e){runtime.report(item.owner,'unmount',e)}};
    if(!mount.active||!root.isConnected){safe();cleanup()}else mount.dispose=()=>{cleanup();safe()};
  });
}
function extensionToolbarHTML(){return extensionRuntime().list('commands').filter(x=>x.toolbar).map(a=>btn(a.label,a.icon||'box','ext-command',`data-id="${esc(a.key)}"`,'small ghost')).join('')+extensionRuntime().list('panels').map(p=>btn(p.title||p.id,'box','ext-panel',`data-id="${esc(p.key)}"`,'small ghost')).join('')}
function extensionAfterRender(){
  if(extensionHost.rendering)return;
  extensionHost.rendering=true;
  try{
    const runtime=extensionRuntime(),workspace=extensionWorkspace();
    document.documentElement.dataset.workspace=workspace;
    for(const [selector,part] of [['#sidebar','sidebar'],['#topbar','topbar'],['#main','workspace'],['#statusbar','statusbar'],['#modal','dialog']]){const el=document.querySelector(selector);if(el)el.dataset.mioPart=part}
    if(window.MioSafeMode||ecoState.status.safeMode)return;
    const active=runtime.list('workspaces').find(x=>x.key===extensionHost.activeWorkspace);
    if(extensionHost.activeWorkspace&&!active)extensionHost.activeWorkspace='';
    if(active&&!extensionHost.mounts.some(m=>m.active&&m.root.dataset.extensionMount===active.key)){ $('#main').replaceChildren();const root=document.createElement('section');root.className='extension-workspace';$('#main').append(root);extensionMount(active,root);const crumb=$('.breadcrumb strong');if(crumb)crumb.textContent=active.title||active.id}
    const nav=$('#sidebar .nav-list');
    if(nav)for(const item of runtime.list('workspaces')){const button=document.createElement('button');button.className='nav-item'+(active?.key===item.key?' active':'');button.dataset.act='ext-workspace';button.dataset.id=item.key;button.textContent=item.title||item.id;button.dataset.extensionNav='';button.dataset.noTranslate='';button.setAttribute('aria-current',active?.key===item.key?'page':'false');nav.append(button)}
    const top=$('#topbar');if(top){const button=document.createElement('button');button.className='btn ghost small';button.dataset.act='ext-palette';button.textContent=localeString('扩展命令');button.title='Ctrl / ⌘ + Shift + P';button.dataset.extensionNav='';top.append(button)}
    const targets={'sidebar.bottom':'#sidebar .side-bottom','topbar.end':'#topbar','workspace.before':'#main','workspace.after':'#main','story.toolbar':'.source-story-actions, .workshop-asset-head > div','settings.toolbar':'.settings-toolbar-actions'};
    for(const item of runtime.list('slots')){
      if(item.when){try{if(!item.when({workspace}))continue}catch(e){runtime.report(item.owner,'slot predicate',e);continue}}
      const target=document.querySelector(targets[item.slot]);if(!target)continue;
      const root=document.createElement('div');root.dataset.mioSlot=item.slot;
      if(item.slot==='workspace.before')target.prepend(root);else target.append(root);extensionMount(item,root);
    }
    const toolbar=document.querySelector('.source-story-actions, .settings-toolbar-actions, .workshop-asset-head > div');
    if(toolbar){const root=document.createElement('div');root.className='extension-toolbar';root.innerHTML=extensionToolbarHTML();root.dataset.extensionNav='';toolbar.append(root)}
    if(extensionHost.workspace!==workspace){extensionHost.workspace=workspace;void runtime.emit('workspace:changed',{workspace})}
    // Defer notifications; a listener calling render cannot recursively grow the stack.
    if(!extensionHost.pending){extensionHost.pending=true;queueMicrotask(()=>{void runtime.emit('afterRender',{workspace}).finally(()=>{extensionHost.pending=false})})}
  }finally{extensionHost.rendering=false;applyCustomization()}
}
function extensionPalette(query=''){
  const commands=extensionRuntime().list('commands').filter(x=>(x.label+' '+x.key).toLowerCase().includes(query.toLowerCase()));
  return commands.map(c=>`<button class="extension-command" data-act="ext-command" data-id="${esc(c.key)}"><strong>${esc(c.label)}</strong><small>${esc(c.key)}${c.shortcut?' · '+esc(c.shortcut):''}</small></button>`).join('')||'<p>没有匹配的扩展命令。安装示例扩展后再试试。</p>';
}
function installExtensionHost(){
  const originalRender=render;render=function(...args){const active=extensionRuntime().list('workspaces').some(x=>x.key===extensionHost.activeWorkspace);extensionUnmount(active);document.querySelectorAll('[data-extension-nav]').forEach(x=>x.remove());let result;if(active){renderShell();const crumb=$('.breadcrumb strong');if(crumb)crumb.textContent=extensionRuntime().list('workspaces').find(x=>x.key===extensionHost.activeWorkspace).title||extensionHost.activeWorkspace;document.querySelectorAll('#sidebar [aria-current="page"]').forEach(x=>{x.removeAttribute('aria-current');x.classList.remove('active')})}else result=originalRender(...args);extensionAfterRender();return result};
  const originalNavigate=navigate;navigate=function(...args){extensionHost.activeWorkspace='';return originalNavigate(...args)};
  Object.assign(v3Actions,{
    'ext-workspace':d=>{extensionHost.activeWorkspace=d.id;render()},
    'ext-command':async d=>{if($('#extension-command-list'))closeModal();await extensionRuntime().execute(d.id)},
    'ext-palette':()=>modal('扩展命令',`<input id="extension-command-search" aria-label="搜索扩展命令" placeholder="搜索命令或扩展 ID"><div id="extension-command-list">${extensionPalette()}</div>`),
    'ext-panel':d=>{const item=extensionRuntime().list('panels').find(p=>p.key===d.id);if(item){modal(item.title||item.id,'<div id="eco-plugin-panel"></div>');extensionMount(item,$('#eco-plugin-panel'))}},
    'ext-reload':async d=>{dropExtension(d.id);await syncExtensions();render()},
    'ext-diagnostics':()=>{const r=extensionRuntime();modal('扩展运行诊断',`<p>SDK 2 · ${r.owners.size} 个运行实例 · ${r.list('commands').length} 条命令 · ${r.list('hooks').length} 个监听器</p><pre>${esc(JSON.stringify({registrations:Object.fromEntries(Object.keys(r.registries).map(k=>[k,r.list(k).map(x=>x.key)])),errors:r.errors},null,2))}</pre>`)}
  });
  new MutationObserver(()=>{for(const mount of extensionHost.mounts.filter(m=>!m.root.isConnected)){mount.active=false;mount.controller.abort();mount.dispose?.();mount.dispose=null}extensionHost.mounts=extensionHost.mounts.filter(m=>m.active&&m.root.isConnected)}).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('input',e=>{if(e.target.id==='extension-command-search')$('#extension-command-list').innerHTML=extensionPalette(e.target.value)});
  $('#modal').addEventListener('close',()=>{for(const m of extensionHost.mounts.filter(m=>m.root.closest('#modal'))){m.active=false;m.controller.abort();m.dispose?.();m.dispose=null;m.root.remove()}});
  document.addEventListener('keydown',e=>{
    if(e.isComposing||e.repeat||window.MioSafeMode)return;
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='p'){e.preventDefault();e.stopImmediatePropagation();v3Actions['ext-palette']();return}
    if(e.target.closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]'))return;
    const parts=[];if(e.ctrlKey||e.metaKey)parts.push('mod');if(e.altKey)parts.push('alt');if(e.shiftKey)parts.push('shift');parts.push(e.key.toLowerCase());
    const command=extensionRuntime().list('commands').find(c=>c.shortcut?.toLowerCase()===parts.join('+'));
    if(command){e.preventDefault();e.stopImmediatePropagation();void extensionRuntime().execute(command.key).catch(err=>toast(err.message,'error'))}
  },true);
}
