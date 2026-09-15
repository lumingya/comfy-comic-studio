/* Ecosystem SDK v1. Third-party UI and Python are trusted code, never a sandbox claim. */
'use strict';
const ecoState={status:{extensions:[],themes:{items:[],active:''}},loaded:new Map(),actions:new Map(),panels:new Map(),types:new Map(),hooks:new Map(),preparing:new Set(),errors:[],activeTheme:'',themeSerial:0};
async function ecoRequest(path,body){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),125000);
  try{const response=await fetch('/api/ecosystem/'+path,{credentials:'same-origin',signal:controller.signal,...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const result=await response.json();if(!response.ok)throw Error(result.error||'HTTP '+response.status);return result.data}finally{clearTimeout(timer)}
}
function ensureSourceStory(p){
  const t=templateBy(p.templateId);if(t?.ownerPlanId===p.id)return t;
  if(t&&!t.ownerPlanId&&!state.creation.plans.some(other=>other.id!==p.id&&other.templateId===t.id)&&!state.books.some(b=>b.templateId===t.id)){t.ownerPlanId=p.id;createUI.sceneScope='plan';save();return t}
  const story=t?{...clone(t),id:uid('story'),ownerPlanId:p.id,title:p.title}:{id:uid('story'),projectId:p.projectId,ownerPlanId:p.id,title:p.title,outline:'',frames:[]};
  state.templates.push(story);p.templateId=story.id;ui.templateId=story.id;createUI.sceneScope='plan';save();return story;
}
function ecoToolbarHTML(){return [...ecoState.actions.values()].map(a=>btn(a.label,a.icon||'box','eco-plugin-action',`data-id="${esc(a.key)}"`,'small ghost')).join('')+[...ecoState.panels.values()].map(p=>btn(p.title,'box','eco-plugin-panel',`data-id="${esc(p.key)}"`,'small ghost')).join('')}
function ecoContext(id){
  const key=name=>{if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name))throw Error('SDK registration requires a local identifier');return id+':'+name};
  async function api(path,body){if(!path.startsWith('/')||path.includes('..'))throw Error('Use a plugin-local route');const response=await fetch('/api/extensions/'+encodeURIComponent(id)+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error||'Extension API failed');return data.data}
  return Object.freeze({id,apiVersion:1,api,storage:Object.freeze({get:k=>api('/storage?key='+encodeURIComponent(k)),set:(k,value)=>api('/storage',{key:k,value}),delete:k=>api('/storage',{key:k,delete:true})}),
    toolbar:{register:action=>{const k=key(action.id);if(ecoState.actions.has(k))throw Error('Duplicate toolbar action');if(typeof action.run!=='function')throw Error('Action requires run');ecoState.actions.set(k,{...action,key:k,owner:id})}},
    panels:{register:panel=>{const k=key(panel.id);if(ecoState.panels.has(k))throw Error('Duplicate panel');if(typeof panel.render!=='function')throw Error('Panel requires render');ecoState.panels.set(k,{...panel,key:k,owner:id})}},
    variables:{registerType:(name,definition)=>{const k='plugin:'+key(name);if(ecoState.types.has(k))throw Error('Duplicate variable type');if(typeof definition.normalize!=='function')throw Error('Type requires normalize');ecoState.types.set(k,{...definition,owner:id});variableTypes[k]=definition.label||name;}},
    on:(event,handler)=>{if(!['beforePrepare','afterPrepare','afterRender'].includes(event)||typeof handler!=='function')throw Error('Unknown hook');const k=id+':'+event;if(ecoState.hooks.has(k))throw Error('Duplicate hook');ecoState.hooks.set(k,{event,handler,owner:id})},
    toast:message=>toast('['+id+'] '+message),getAlbum:()=>clone(selectedPlan()),assetURL:relative=>'/extension-assets/'+id+'/'+ecoState.status.extensions.find(p=>p.id===id).revision+'/'+relative
  });
}
async function ecoHook(name,value){for(const h of ecoState.hooks.values())if(h.event===name)await h.handler(value)}
function dropExtension(id){
  const loaded=ecoState.loaded.get(id);if(loaded?.dispose)try{loaded.dispose()}catch(e){ecoState.errors.push(id+': '+e.message)}
  for(const map of [ecoState.actions,ecoState.panels,ecoState.types,ecoState.hooks])for(const [key,value] of map)if(value.owner===id){map.delete(key);if(key.startsWith('plugin:'))delete variableTypes[key]}
  ecoState.loaded.delete(id);
}
async function syncExtensions(){
  const enabled=window.MioSafeMode||ecoState.status.safeMode?[]:ecoState.status.extensions.filter(p=>p.enabled);
  for(const id of ecoState.loaded.keys())if(!enabled.some(p=>p.id===id))dropExtension(id);
  for(const plugin of enabled){
    if(ecoState.loaded.has(plugin.id))continue;
    try{const module=await import('/extension-assets/'+plugin.id+'/'+encodeURIComponent(plugin.revision)+'/index.js');if(typeof module.default!=='function')throw Error('index.js must export default setup(ctx)');const dispose=await module.default(ecoContext(plugin.id));ecoState.loaded.set(plugin.id,{dispose:typeof dispose==='function'?dispose:null})}
    catch(e){dropExtension(plugin.id);ecoState.loaded.set(plugin.id,{failed:true});ecoState.errors.push(plugin.name+': '+e.message)}
  }
}
async function applyEcosystemTheme(){
  const serial=++ecoState.themeSerial,id=window.MioSafeMode||ecoState.status.safeMode?'':ecoState.status.themes.active;
  document.getElementById('mio-user-theme')?.remove();ecoState.activeTheme='';if(!id)return;
  try{const result=await ecoRequest('themes/css/'+id);if(serial!==ecoState.themeSerial)return;const style=document.createElement('style');style.id='mio-user-theme';style.textContent=result.css;document.head.append(style);ecoState.activeTheme=id}catch(e){ecoState.errors.push('主题未加载：'+e.message)}
}
async function refreshEcosystem(){ecoState.status=await ecoRequest('status');await applyEcosystemTheme();await syncExtensions();}
function renderEcosystemSettings(tab){
  const theme=tab==='themes',status=ecoState.status;
  return `<section class="eco-settings"><header class="eco-heading"><span class="context-kicker">${theme?'自定义主题':'扩展中心'} · 本地优先</span><h2>${theme?'让工作室，长成你的样子。':'为创作，接入更多可能。'}</h2><p>${theme?'不止配色。布局、材质、字体与动效，都可以重新定义。':'一个 Git 地址，或一份本地 ZIP。每个扩展拥有独立的代码、数据与开关。'}</p></header><div class="eco-safety">${icon('shield')}<div><strong>${theme?'全局 CSS 拥有完整界面覆盖能力':'只安装你信任的代码'}</strong><p>${theme?'第三方主题可以隐藏或仿冒操作控件。界面异常时，使用 ?safe_mode=1，或按住 Shift 刷新。':'扩展 JavaScript 与 Python 具有完全执行能力，可能读写本机文件、访问网络并产生费用。独立数据目录不是恶意代码沙箱。'}</p><a href="?safe_mode=1">进入安全模式 ↗</a></div></div><div class="eco-management-actions">${theme?btn('导入主题','upload','eco-theme-import','','primary')+btn('使用官方主题','refresh','eco-theme-off','','ghost'):btn('通过 Git 安装','plus','eco-extension-install','','primary')+btn('导入扩展 ZIP','upload','eco-extension-zip','','ghost')}${btn('刷新列表','refresh','eco-refresh','','ghost')}</div><div class="eco-dropzone" data-eco-drop="${theme?'theme':'extension'}" tabindex="0" role="button" data-act="${theme?'eco-theme-import':'eco-extension-zip'}" aria-label="${theme?'导入主题文件':'导入扩展 ZIP'}">${icon('upload')}<strong>拖放${theme?' .css / .zip 主题包':' .zip 扩展包'}到这里</strong><span>本地检查 · 显式确认 · 不自动覆盖已有包</span></div><div class="eco-package-grid">${theme?`<article class="eco-package official"><div class="theme-swatch"></div><h3>原生 · 安静的工作室</h3><p>官方基线，随时可以回来。</p>${btn(!status.themes.active?'正在使用':'切换到官方','check','eco-theme-off','','small')}</article>`:''}${(theme?status.themes.items:status.extensions).map(p=>`<article class="eco-package"><div class="eco-package-label">${icon(theme?'sun':'box')}<span>${theme?(status.themes.active===p.id?'正在使用':'本地主题'):(p.enabled?'已启用':'已停用')}</span><small>v${esc(p.version)}</small></div><h3>${esc(p.name)}</h3><code>${esc(p.id)}</code>${p.error?`<p class="danger">${esc(p.error)}</p>`:''}<div class="eco-package-actions">${theme?btn('使用主题','check','eco-theme-use',`data-id="${esc(p.id)}"`,'small'):btn(p.enabled?'停用':'启用',p.enabled?'pause':'play','eco-extension-toggle',`data-id="${esc(p.id)}" data-enabled="${p.enabled?'0':'1'}"`,'small')}${!theme?btn('更新代码','refresh','eco-extension-update',`data-id="${esc(p.id)}" ${p.enabled?'disabled title="请先停用扩展"':''}`,'small ghost'):''}${btn('卸载','trash',theme?'eco-theme-remove':'eco-extension-remove',`data-id="${esc(p.id)}"`,'small ghost')}</div></article>`).join('')}</div>${!theme&&!status.extensions.length?'<div class="eco-empty"><h3>扩展库还是一张白纸</h3><p>从一个可信的仓库开始，或试试 examples/extensions 中的示例。</p></div>':''}<details class="quiet-advanced"><summary>运行环境与开发文档</summary><p>Node.js ${status.node?'已就绪':'未检测到（可执行变量需要 Node.js 20+）'} · Git ${status.git?'已就绪':'未检测到'}</p><a href="/docs/ECOSYSTEM_GUIDE.html" target="_blank" rel="noopener">主题与扩展 SDK 指南 ↗</a></details>${ecoState.errors.length?`<details class="quiet-advanced" open><summary>加载诊断</summary>${ecoState.errors.map(e=>`<p class="danger">${esc(e)}</p>`).join('')}</details>`:''}</section>`;
}
async function importEcosystemFile(file,kind){
  if(!file)return;if(file.size>32*1024*1024)throw Error('安装包最大 32 MiB。');
  const trusted=await confirmAction(kind==='theme'?'信任这个全局主题？':'信任并执行这个扩展？',kind==='theme'?'全局样式可隐藏或仿冒界面控件。出错可用 ?safe_mode=1 恢复。':'JavaScript / Python 扩展具备完全执行能力，可以访问本机与网络。只安装可信作者的包。','我信任并安装');if(!trusted)return;
  const data=(await blobData(file)).split(',')[1];
  await ecoRequest(kind==='theme'?'themes/install':'extensions/install',kind==='theme'?{data,filename:file.name,trusted:true}:{zip:data,trusted:true});await refreshEcosystem();render();toast('安装完成。');
}
function macroEditor(owner,key){
  const p=settingsTargetById(owner),e=p&&mergedSettingEntries(p).find(v=>v.key===key);if(!e)throw Error('属性不存在。');rt.ecoMacro={owner,key,id:e.id};
  modal('可执行变量 · '+settingLabel(e),`<div class="eco-safety"><div><strong>脚本不是被动数据</strong><p>生成前执行，可能调用已配置的模型并产生费用。只运行可信脚本；不会自动重试未确认的 API 请求。</p></div></div><div class="grid2">${field('结果类型',`<select id="eco-macro-type">${['text','image','number','boolean','json'].map(t=>opt(t,variableTypes[t],e.type)).join('')}</select>`)}${field('依赖变量（逗号分隔）',input('deps',(e.compute?.dependsOn||[]).join(', '),'text','id="eco-macro-deps" placeholder="character, environment"'))}</div>${field('JavaScript · 函数体，使用 return 返回结果',`<textarea id="eco-macro-code" class="eco-code" spellcheck="false">${esc(e.compute?.script||'const words = ["晨光", "薄雾", "雨后"];\nreturn words[Math.floor(ctx.random() * words.length)];')}</textarea>`)}<div class="grid2">${field('本册随机种子',input('seed',p.macroSeed??1,'number','id="eco-macro-seed" min="0" max="4294967295"'))}${field('执行上限（秒，1–180）',input('timeout',e.compute?.timeout||60,'number','id="eco-macro-timeout" min="1" max="180"'))}</div><p class="help">ctx.get('变量') · ctx.image.generate(prompt, options) · ctx.llm.chat(prompt) · ctx.random() · ctx.seed</p><a href="/docs/COMPUTED_VARIABLES.html" target="_blank" rel="noopener">标准写法与示例 ↗</a><div class="modal-footer">${btn('恢复字面量','refresh','eco-macro-literal','','ghost')}${btn('保存脚本','check','eco-macro-save','','primary')}</div>`,'脚本只在前置准备阶段执行，后续分镜消费独立结果缓存。',true);
}
async function prepareComputedPlan(source){
  if(Object.values(source.sceneOverrides||{}).some(o=>[...(o.variables||[]),...(o.variableSetIds||[]).flatMap(id=>setBy(id)?.entries||[])].some(e=>e.compute)))throw Error('可执行变量应放在本册属性中；单幕仅支持字面量覆盖。');
  const prepared=clone(source);prepared.variables=mergedSettingEntries(source).map(e=>({...clone(e),value:e.compute?e.value:typedVariableValue(e)}));prepared.variableSetIds=[];
  if(!prepared.variables.some(e=>e.compute)){prepared._macroPrepared=true;return prepared}
  if(ecoState.preparing.has(source.id))throw Error('这本画册正在准备前置资产。');
  ecoState.preparing.add(source.id);
  try{
    await ecoHook('beforePrepare',prepared);
    if(!await confirmAction('执行「'+source.title+'」的可执行变量？','脚本可调用已保存的图像与语言模型，可能产生费用。缓存命中时复用已有结果；前置失败不会提交分镜。请确认脚本来源可信。','信任并准备'))throw Error('已取消前置准备。');
    if(!await savePythonWorkspace())throw Error('源画册未保存成功，未执行脚本。');
    const force=!!ecoState.forceNext;ecoState.forceNext=false;
    const {id}=await ecoRequest('preparations',{owner:source.id,seed:source.macroSeed??1,entries:prepared.variables,trusted:true,force});
    let completed=false;
    modal('前置资产准备',`<div class="eco-phase"><span>阶段 0 / 1</span><h3>先准备世界，再开始故事。</h3><p>只提交一次。关闭此窗口会请求取消，不会自动重试。</p><div id="eco-preparation-nodes"></div></div><div class="modal-footer">${btn('取消准备','stop','eco-preparation-cancel',`data-id="${esc(id)}"`,'ghost')}</div>`,'分镜尚未进入生成队列。');
    const dialog=$('#modal');const cancel=()=>{if(!completed)ecoRequest('preparations/cancel',{id}).catch(()=>{})};dialog.addEventListener('close',cancel,{once:true});
    try{
      for(;;){
        const job=await ecoRequest('preparations/'+id),area=$('#eco-preparation-nodes');
        if(area)area.innerHTML=Object.entries(job.nodes).map(([key,n])=>`<div class="eco-node"><code>{${esc(key)}}</code><span>${esc(({pending:'等待依赖',running:'执行中',cached:'缓存命中',complete:'已完成',failed:'失败',blocked:'已阻止'})[n.status]||n.status)}</span>${n.error?`<small>${esc(n.error)}</small>`:''}</div>`).join('');
        if(job.status==='complete'){
          if(!dialog.open)throw Error('窗口已关闭；结果保留在缓存，未继续生成。');
          for(const e of prepared.variables){e.value=clone(job.values[e.key]);delete e.compute}prepared._macroPrepared=true;prepared.preparationId=id;completed=true;closeModal();await ecoHook('afterPrepare',prepared);return prepared;
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
  const previousRender=render;render=function(...args){const result=previousRender(...args);const target=$('.source-story-actions')||$('.settings-toolbar-actions');if(target&&ecoState.actions.size+ecoState.panels.size)target.insertAdjacentHTML('beforeend',ecoToolbarHTML());for(const h of ecoState.hooks.values())if(h.event==='afterRender')try{Promise.resolve(h.handler()).catch(e=>{ecoState.errors.push(h.owner+': '+e.message);dropExtension(h.owner)})}catch(e){ecoState.errors.push(h.owner+': '+e.message)}if(window.MioSafeMode)document.documentElement.dataset.theme='light';return result};
  Object.assign(v3Actions,{
    'eco-refresh':async()=>{await refreshEcosystem();render()},
    'eco-theme-import':()=>pickFile('.css,.zip',file=>importEcosystemFile(file,'theme')),
    'eco-extension-zip':()=>pickFile('.zip',file=>importEcosystemFile(file,'extension')),
    'eco-extension-install':()=>modal('安装扩展',`<div class="eco-safety"><div><strong>外部扩展具备完全执行能力</strong><p>可能带来未知副作用与安全隐患，能够访问本机文件与网络。请确保来源可信。安装后会加载前后端代码。</p></div></div>${field('输入扩展程序的 Git URL 以安装',input('url','','url','id="eco-git-url" placeholder="https://github.com/author/extension-name"'))}${field('分支（可选）',input('branch','','text','id="eco-git-branch" placeholder="默认分支"'))}<label class="row"><input type="checkbox" id="eco-git-trust">我信任来源，并授权执行扩展代码</label><div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('安装并加载','download','eco-git-submit','','primary')}</div>`),
    'eco-git-submit':async()=>{const trusted=$('#eco-git-trust').checked;if(!trusted)throw Error('请先确认信任来源。');const url=$('#eco-git-url').value.trim(),branch=$('#eco-git-branch').value.trim();const button=$('[data-act="eco-git-submit"]');button.disabled=true;button.textContent='下载并校验中…';try{await ecoRequest('extensions/install',{url,branch,trusted});closeModal();await refreshEcosystem();render();toast('扩展已安装。')}finally{if(button.isConnected){button.disabled=false;button.textContent='安装并加载'}}},
    'eco-theme-use':async d=>{await ecoRequest('themes/select',{id:d.id});await refreshEcosystem();render()},
    'eco-theme-off':async()=>{await ecoRequest('themes/select',{id:''});await refreshEcosystem();render()},
    'eco-theme-remove':async d=>{if(await confirmAction('卸载主题？','主题样式和随包字体将删除，作品不受影响。','卸载')){await ecoRequest('themes/uninstall',{id:d.id});await refreshEcosystem();render()}},
    'eco-extension-toggle':async d=>{const enabled=d.enabled==='1';if(enabled&&!await confirmAction('启用扩展代码？','JavaScript 与 Python 将立即执行，仅启用可信代码。','信任并启用'))return;await ecoRequest('extensions/enable',{id:d.id,enabled,trusted:enabled});await refreshEcosystem();render()},
    'eco-extension-update':async d=>{if(!await confirmAction('更新扩展代码？','重新下载所选分支，校验后替换代码。独立用户数据不动；更新后保持停用，需重新确认启用。','信任并更新'))return;await ecoRequest('extensions/update',{id:d.id,trusted:true});await refreshEcosystem();render()},
    'eco-extension-remove':d=>{rt.ecoRemoveId=d.id;modal('卸载扩展',`<p>代码仓库将移除。默认保留独立用户数据，重新安装相同 ID 后可继续使用。</p><label class="row"><input type="checkbox" id="eco-delete-data">同时删除配置与历史缓存数据（不可恢复）</label><div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('确认卸载','trash','eco-extension-remove-confirm','','primary')}</div>`)},
    'eco-extension-remove-confirm':async()=>{await ecoRequest('extensions/uninstall',{id:rt.ecoRemoveId,deleteData:$('#eco-delete-data').checked});closeModal();await refreshEcosystem();render()},
    'eco-plugin-action':async d=>{const a=ecoState.actions.get(d.id);if(a)await a.run()},
    'eco-plugin-panel':async d=>{const p=ecoState.panels.get(d.id);if(!p)return;modal(p.title,'<div id="eco-plugin-panel"></div>');await p.render($('#eco-plugin-panel'))},
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
    'eco-history':()=>{const p=selectedPlan(),jobs=state.queue.filter(q=>q.planId===p.id).sort((a,b)=>b.createdAt-a.createdAt);modal('历史生成记录',`<p class="help">历史是独立产物，不会成为源画册编辑入口。</p>${jobs.map(q=>`<div class="eco-history-row"><div><strong>${esc(bookBy(q.bookId)?.title||'画册')}</strong><small>${esc(new Date(q.createdAt).toLocaleString())} · ${esc(q.status)} · ${q.done}/${q.indices.length} 幕</small></div>${btn('查看画册','book','read',`data-id="${esc(q.bookId)}"`,'small')}</div>`).join('')||'<div class="empty">还没有生成记录。</div>'}`)}
  });
  document.addEventListener('dragover',e=>{if(e.target.closest('[data-eco-drop]'))e.preventDefault()});
  document.addEventListener('drop',e=>{const box=e.target.closest('[data-eco-drop]');if(!box)return;e.preventDefault();importEcosystemFile(e.dataTransfer.files[0],box.dataset.ecoDrop).catch(err=>toast(err.message,'error'))});
  document.addEventListener('keydown',e=>{if(e.target.matches('[data-eco-drop]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.click()}});
}
async function bootEcosystem(){
  globalThis.Mio.extensions=Object.freeze({apiVersion:1});
  try{await refreshEcosystem()}catch(e){ecoState.errors.push(e.message)}
  if(window.MioSafeMode){
    const host=document.createElement('aside');host.style.cssText='position:fixed!important;inset:auto 16px 40px auto!important;z-index:2147483647!important;display:block!important';
    host.id='mio-safe-recovery';const shadow=host.attachShadow({mode:'closed'});shadow.innerHTML='<style>:host{all:initial}section{font:13px system-ui;background:#fff;color:#15271a;border:2px solid #4a7952;border-radius:12px;padding:18px;max-width:320px;box-shadow:0 6px 30px #0003}button{padding:9px;border-radius:6px;border:1px solid #9abfa2;background:#e6f2e6;color:#15271a;cursor:pointer;margin-top:10px}</style><section><b>安全模式 · 官方界面</b><p>第三方主题与前端扩展未加载。点击下方可停用所有扩展并恢复官方主题；代码与数据均保留。</p><button>一键重置主题并停用扩展</button></section>';
    shadow.querySelector('button').onclick=async()=>{await ecoRequest('reset',{});shadow.querySelector('p').textContent='已重置。可以移除地址中的 safe_mode=1 后重新访问。'};document.body.append(host);
  }
  render();
}
