/* Ecosystem SDK v2 (front end). Third-party JS and Python are trusted code, never a sandbox claim.
   This file owns: extension module lifecycle, the `ctx` handed to index.js, theme application,
   the 设置 → 扩展/主题 screens, and the macro ("可执行变量") UI. Slots/events live in platform.js. */
'use strict';
const ecoState={status:{extensions:[],themes:{items:[],active:''},node:false,git:false,safeMode:false,platform:{}},loaded:new Map(),types:new Map(),errors:[],forceNext:false,themeSerial:0,activeTheme:'',settingsCache:new Map()};
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
/* ---- the extension context. Everything is owner-scoped so dropExtension() can undo it. */
function ecoContext(id){
  const plugin=ecoState.status.extensions.find(p=>p.id===id)||{},owner=id;
  async function api(path,body,{tier}={}){if(!path.startsWith('/')||path.includes('..'))throw Error('Use a plugin-local route');const response=await fetch('/api/extensions/'+id+path+(tier?(path.includes('?')?'&':'?')+'tier='+tier:''),{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const json=await response.json().catch(()=>({}));if(!response.ok||json.error)throw Error(json.error||('HTTP '+response.status));return json.data}
  const store=tier=>Object.freeze({get:k=>api('/storage?key='+encodeURIComponent(k),undefined,{tier}),set:(k,value)=>api('/storage',{key:k,value,tier}),delete:k=>api('/storage',{key:k,delete:true,tier})});
  const slot=(name,extra)=>Object.freeze({register:item=>MioPlatform.register(name,{...extra?.(item),...item},owner),items:context=>MioPlatform.items(name,context)});
  return Object.freeze({
    id,apiVersion:2,manifest:clone(plugin),api,
    storage:store('workspace'),data:Object.freeze({config:store('config'),workspace:store('workspace'),cache:store('cache')}),
    settings:Object.freeze({get:async()=>(await api('/settings')).values,schema:()=>clone(plugin.settings||[]),set:values=>api('/settings',{values})}),
    events:Object.freeze({on:(event,handler,options={})=>MioPlatform.on(event,handler,{...options,owner}),emit:(name,payload)=>{if(!name.startsWith('ext:'+id+':'))throw Error('Extensions emit under ext:'+id+':*');return MioPlatform.emit(name,payload,{source:owner})},recent:()=>MioPlatform.recent.slice(-50)}),
    slots:Object.freeze({nav:slot('nav'),inspector:slot('inspector'),dock:slot('dock'),frameCard:slot('frame-card'),albumCard:slot('album-card'),contextMenu:slot('context-menu'),commands:slot('commands'),toolbar:slot('toolbar')}),
    exporters:Object.freeze({register:spec=>MioPlatform.registerExporter(spec,owner),list:()=>mioExporterList()}),
    importers:Object.freeze({register:spec=>MioPlatform.registerImporter(spec,owner),list:()=>mioImporterList()}),
    albums:MioAlbums,
    icons:Object.freeze({mount:map=>{MioIcons.mount('ext:'+owner,map);renderShell()},names:()=>MioIcons.names()}),
    variables:Object.freeze({registerType:(name,definition)=>{if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name))throw Error('Type id must match [a-z][a-z0-9_-]{0,63}');const k='plugin:'+owner+':'+name;if(ecoState.types.has(k))throw Error('Duplicate variable type');if(typeof definition.normalize!=='function')throw Error('Type requires normalize');ecoState.types.set(k,{...definition,owner});variableTypes[k]=definition.label||name}}),
    ui:Object.freeze({toast:(message,level)=>toast('['+(plugin.name||id)+'] '+message,level==='error'?'error':'ok'),confirm:(title,message,label)=>confirmAction(title,message,label),modal:(title,html)=>modal(title,html),closeModal,icon:(name,cls)=>icon(name,cls),button:(label,iconName,action,attrs,cls)=>btn(label,iconName,action,attrs,cls),esc,navigate:route=>navigate(typeof route==='string'&&!MioPlatform.find('nav',route)?owner+':'+route:route),openReader:bookId=>openReader(bookId),render:()=>render()}),
    host:Object.freeze({request:(url,options,timeout)=>{if(!String(url).startsWith('/api/'))throw Error('host.request is limited to /api/*');return request(url,options,timeout)},production:Object.freeze({tasks:()=>productionRequest('tasks'),start:(taskId,options)=>startProduction(taskId,options),control:(action,body)=>productionRequest('control',{action,...body})}),platform:()=>clone(ecoState.status.platform)}),
    assetURL:relative=>'/extension-assets/'+id+'/'+encodeURIComponent(plugin.revision||'0')+'/'+String(relative).replace(/^\/+/,''),
    log:(...args)=>console.info('[ext:'+id+']',...args)
  });
}
function dropExtension(id){
  const loaded=ecoState.loaded.get(id);if(loaded?.dispose)try{loaded.dispose()}catch(e){ecoState.errors.push(id+': '+e.message)}
  MioPlatform.unregisterOwner(id);for(const [key,value] of ecoState.types)if(value.owner===id){ecoState.types.delete(key);delete variableTypes[key]}
  ecoState.loaded.delete(id);if(typeof ui.workspace==='string'&&ui.workspace.startsWith(id+':'))ui.workspace=0;
}
async function syncExtensions(){
  const enabled=window.MioSafeMode||ecoState.status.safeMode?[]:ecoState.status.extensions.filter(p=>p.enabled&&p.entry);
  for(const id of ecoState.loaded.keys())if(!enabled.some(p=>p.id===id))dropExtension(id);
  for(const plugin of enabled){
    if(ecoState.loaded.has(plugin.id))continue;
    try{const module=await import('/extension-assets/'+plugin.id+'/'+encodeURIComponent(plugin.revision)+'/'+plugin.entry);if(typeof module.default!=='function')throw Error('index.js must export default function(ctx)');const dispose=await module.default(ecoContext(plugin.id));ecoState.loaded.set(plugin.id,{dispose:typeof dispose==='function'?dispose:null})}
    catch(e){dropExtension(plugin.id);ecoState.loaded.set(plugin.id,{failed:true});ecoState.errors.push(plugin.name+': '+e.message)}
  }
  await MioPlatform.emit('extensions.synced',{loaded:[...ecoState.loaded.keys()]},{relay:false});
}
async function applyEcosystemTheme(){
  const serial=++ecoState.themeSerial,id=window.MioSafeMode||ecoState.status.safeMode?'':ecoState.status.themes.active;
  document.getElementById('mio-user-theme')?.remove();MioIcons.unmount('theme');mioTheme.lock=null;ecoState.activeTheme='';if(!id){renderShell();return}
  try{const result=await ecoRequest('themes/css/'+id);if(serial!==ecoState.themeSerial)return;const style=document.createElement('style');style.id='mio-user-theme';style.textContent=result.css;document.head.append(style);ecoState.activeTheme=id;if(result.icons&&Object.keys(result.icons).length)MioIcons.mount('theme',result.icons);if(result.colorScheme==='dark'||result.colorScheme==='light'){mioTheme.lock=result.colorScheme;document.documentElement.dataset.theme=result.colorScheme}renderShell()}catch(e){ecoState.errors.push('主题未加载：'+e.message)}
}
async function refreshEcosystem(){ecoState.status=await ecoRequest('status');await applyEcosystemTheme();await syncExtensions()}
async function ecoLoadSettings(id){const data=await ecoContext(id).api('/settings');ecoState.settingsCache.set(id,data);return data}
function ecoSettingsField(f,value){
  const v=value??f.default??'',attrs=`data-eco-setting="${esc(f.key)}"`;
  if(f.type==='toggle')return `<label class="row"><input type="checkbox" ${attrs} ${v?'checked':''}>${esc(f.label||f.key)}</label>`;
  if(f.type==='select')return field(f.label||f.key,`<select ${attrs}>${(f.options||[]).map(o=>opt(o.value??o,o.label??o,String(v)))}</select>`);
  if(f.type==='textarea'||f.type==='json')return field(f.label||f.key,`<textarea rows="3" ${attrs}>${esc(typeof v==='string'?v:JSON.stringify(v,null,2))}</textarea>`);
  return field(f.label||f.key,`<input type="${f.type==='number'?'number':f.type==='password'?'password':f.type==='url'?'url':'text'}" value="${esc(v)}" ${attrs} ${f.min!==undefined?`min="${esc(f.min)}"`:''} ${f.max!==undefined?`max="${esc(f.max)}"`:''} ${f.step!==undefined?`step="${esc(f.step)}"`:''} ${f.placeholder?`placeholder="${esc(f.placeholder)}"`:''}>`)+(f.help?`<p class="soft small">${esc(f.help)}</p>`:'');
}
function ecoUsageLabel(usage){const kb=n=>n>=1048576?(n/1048576).toFixed(1)+' MiB':n>=1024?Math.round(n/1024)+' KiB':n+' B';return ['config','workspace','cache','tmp'].map(t=>`${t} ${kb(usage?.[t]||0)}`).join(' · ')}
function ecoCapabilitySummary(p){const c=p.capabilities||{},parts=[];for(const [k,label] of [['providers','生成后端'],['hooks','管线钩子'],['events','事件'],['exporters','导出器'],['importers','导入器'],['routes','接口']]){const n=Array.isArray(c[k])?c[k].length:0;if(n)parts.push(label+' '+n)}if(p.entry)parts.push('前端界面');return parts.join(' · ')||'仅清单'}
function renderEcosystemSettings(tab){
  const theme=tab==='themes',status=ecoState.status,platform=status.platform||{};
  const themeCard=p=>`<article class="eco-package ${status.themes.active===p.id?'is-active':''}"><div class="eco-package-label">${icon('sun')}<span>${status.themes.active===p.id?'正在使用':'本地主题'}</span><small>v${esc(p.version)} · SDK ${p.apiVersion||1}</small></div><h3>${esc(p.name)}</h3><code>${esc(p.id)}</code>${p.description?`<p>${esc(p.description)}</p>`:''}<p class="soft small">${p.apiVersion===2?['深色','浅色'].filter((_,i)=>p.variants?.[i?'light':'dark']).join(' + ')||'令牌驱动':'单一样式表'}${p.icons?' · 自带图标包':''}${p.colorScheme&&p.colorScheme!=='auto'?' · 固定'+(p.colorScheme==='dark'?'深色':'浅色'):''}</p><div class="eco-package-actions">${btn('使用主题','check','eco-theme-use',`data-id="${esc(p.id)}"`,'small')}${btn('卸载','trash','eco-theme-remove',`data-id="${esc(p.id)}"`,'small ghost')}</div></article>`;
  const extCard=p=>`<article class="eco-package ${p.enabled?'is-active':''}"><div class="eco-package-label">${icon('box')}<span>${p.enabled?'已启用':'已停用'}</span><small>v${esc(p.version)} · SDK ${p.apiVersion}</small></div><h3>${esc(p.name)}</h3><code>${esc(p.id)}</code>${p.description?`<p>${esc(p.description)}</p>`:''}<p class="soft small">${ecoCapabilitySummary(p)}</p><p class="soft small">数据：${ecoUsageLabel(p.data)}</p>${p.error?`<p class="danger">${esc(p.error)}</p>`:''}<div class="eco-package-actions">${btn(p.enabled?'停用':'启用',p.enabled?'pause':'play','eco-extension-toggle',`data-id="${esc(p.id)}" data-enabled="${p.enabled?'0':'1'}"`,'small')}${p.settings?.length?btn('设置','settings','eco-extension-settings',`data-id="${esc(p.id)}" ${p.enabled?'':'disabled title="请先启用扩展"'}`,'small ghost'):''}${btn('更新代码','refresh','eco-extension-update',`data-id="${esc(p.id)}" ${p.enabled?'disabled title="请先停用扩展"':''}`,'small ghost')}${btn('清理缓存','trash','eco-extension-purge',`data-id="${esc(p.id)}"`,'small ghost')}${btn('卸载','trash','eco-extension-remove',`data-id="${esc(p.id)}"`,'small ghost')}</div></article>`;
  const hooksList=Array.isArray(platform.hooks)?platform.hooks:Object.entries(platform.hooks||{}).map(([name,handlers])=>({name,handlers}));
  const eventsList=Array.isArray(platform.events)?platform.events:Object.entries(platform.events||{}).map(([name,items])=>({name,listeners:(items||[]).length}));
  const platformPanel=theme?'':`<details class="quiet-advanced"><summary>平台能力总览</summary><div class="eco-platform-grid"><div><h4>生成后端 ${(platform.providers||[]).length}</h4>${(platform.providers||[]).map(p=>`<p><code>${esc(p.id)}</code> ${esc(p.label)} <small>${esc(p.owner||'core')}</small></p>`).join('')}</div><div><h4>导出器 ${mioExporterList().length}</h4>${mioExporterList().map(e=>`<p><code>${esc(e.id)}</code> ${esc(e.label)} <small>${esc(e.runtime)}</small></p>`).join('')}</div><div><h4>导入器 ${mioImporterList().length}</h4>${mioImporterList().map(e=>`<p><code>${esc(e.id)}</code> ${esc(e.label)} ${btn('导入','upload','mio-import',`data-importer="${esc(e.id)}"`,'small ghost')}</p>`).join('')}</div><div><h4>管线钩子</h4>${hooksList.map(h=>`<p><code>${esc(h.name)}</code> <small>${(h.handlers||[]).map(x=>esc(x.owner||x)).join(', ')||'无扩展'}</small></p>`).join('')}</div><div><h4>事件</h4>${eventsList.map(e=>`<p><code>${esc(e.name)}</code> <small>${e.listeners||0} 监听</small></p>`).join('')}</div><div><h4>界面插槽</h4>${MioPlatform.SLOTS.map(s=>`<p><code>${s}</code> <small>${MioPlatform.items(s).length} 项</small></p>`).join('')}</div></div></details>`;
  return `<section class="eco-settings"><header class="eco-heading"><span class="context-kicker">${theme?'自定义主题':'扩展中心'} · 本地优先</span><h2>${theme?'让工作室，长成你的样子。':'为创作，接入更多可能。'}</h2><p>${theme?'深色与浅色两套变体、设计令牌、图标包——一份主题包全部定义。':'生成后端、管线钩子、事件、导出器、导航页与面板：每个扩展拥有独立代码与分层数据。'}</p></header><div class="eco-management-actions">${theme?btn('导入主题','upload','eco-theme-import','','primary')+btn('使用官方主题','refresh','eco-theme-off','','ghost'):btn('通过 Git 安装','plus','eco-extension-install','','primary')+btn('导入扩展 ZIP','upload','eco-extension-zip','','ghost')}${btn('刷新列表','refresh','eco-refresh','','ghost')}<a class="btn ghost" href="?safe_mode=1">进入安全模式 ↗</a></div><div class="eco-dropzone" data-eco-drop="${theme?'theme':'extension'}" tabindex="0" role="button" data-act="${theme?'eco-theme-import':'eco-extension-zip'}" aria-label="${theme?'导入主题文件':'导入扩展 ZIP'}">${icon('upload')}<strong>拖放${theme?' .css / .zip 主题包':' .zip 扩展包'}到这里</strong></div><div class="eco-package-grid">${theme?`<article class="eco-package official ${!status.themes.active?'is-active':''}"><div class="theme-swatch"></div><h3>原生 · 安静的工作室</h3><p>官方基线，随时可以回来。</p>${btn(!status.themes.active?'正在使用':'切换到官方','check','eco-theme-off','','small')}</article>`:''}${(theme?status.themes.items:status.extensions).map(theme?themeCard:extCard).join('')}</div>${!theme&&!status.extensions.length?'<div class="eco-empty"><h3>扩展库还是一张白纸</h3><p>试试 examples/extensions/studio-kit：一个扩展同时演示生成后端、钩子、导出器与界面插槽。</p></div>':''}${platformPanel}<details class="quiet-advanced"><summary>运行环境与开发文档</summary><p>Node.js ${status.node?'已就绪':'未检测到（可执行变量需要 Node.js 20+）'} · Git ${status.git?'已就绪':'未检测到'} · 平台 SDK ${status.sdkVersion||2}</p><a href="/docs/ECOSYSTEM_GUIDE.html" target="_blank" rel="noopener">主题与扩展 SDK 指南 ↗</a></details>${ecoState.errors.length||MioPlatform.failures.length?`<details class="quiet-advanced" open><summary>加载诊断</summary>${ecoState.errors.map(e=>`<p class="danger">${esc(e)}</p>`).join('')}${MioPlatform.failures.slice(-10).map(f=>`<p class="danger">${esc(f.owner)} · ${esc(f.where)} · ${esc(f.error)}</p>`).join('')}</details>`:''}</section>`;
}
async function importEcosystemFile(file,kind){
  if(!file)return;if(file.size>32*1024*1024)throw Error('安装包最大 32 MiB。');
  const trusted=await confirmAction(kind==='theme'?'信任这个全局主题？':'信任并执行这个扩展？',kind==='theme'?'全局样式可隐藏或仿冒界面控件。出错可用 ?safe_mode=1 恢复。':'JavaScript / Python 扩展具备完全执行能力，可以访问本机与网络。只安装可信作者的包。','我信任并安装');if(!trusted)return;
  const data=(await blobData(file)).split(',')[1];
  await ecoRequest(kind==='theme'?'themes/install':'extensions/install',kind==='theme'?{data,filename:file.name,trusted:true}:{zip:data,trusted:true});await refreshEcosystem();render();toast('安装完成。');
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
  Object.assign(v3Actions,{
    'eco-refresh':async()=>{await refreshEcosystem();render()},
    'eco-theme-import':()=>pickFile('.css,.zip',file=>importEcosystemFile(file,'theme')),
    'eco-extension-zip':()=>pickFile('.zip',file=>importEcosystemFile(file,'extension')),
    'eco-extension-install':()=>modal('安装扩展',`<div class="eco-safety"><div><strong>外部扩展具备完全执行能力</strong><p>扩展的 JavaScript 运行在本页面，Python 运行在独立子进程；两者都能访问本地文件与网络。仅安装你信任的来源。</p></div></div>${field('输入扩展程序的 Git URL 以安装',input('url','','url','id="eco-git-url" placeholder="https://github.com/author/extension-name"'))}${field('分支（可选）',input('branch','','text','id="eco-git-branch" placeholder="main"'))}<label class="row"><input type="checkbox" id="eco-git-trust">我了解风险，信任这个来源</label><div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('下载并安装','download','eco-git-submit','','primary')}</div>`),
    'eco-git-submit':async()=>{const trusted=$('#eco-git-trust').checked;if(!trusted)throw Error('请先确认信任来源。');const url=$('#eco-git-url').value.trim(),branch=$('#eco-git-branch').value.trim();const button=$('[data-act="eco-git-submit"]');button.disabled=true;button.textContent='下载并校验中…';try{await ecoRequest('extensions/install',{url,branch,trusted});closeModal();await refreshEcosystem();render();toast('扩展已安装，默认停用；确认后再启用。')}finally{button.disabled=false;button.textContent='下载并安装'}},
    'eco-theme-use':async d=>{await ecoRequest('themes/select',{id:d.id});await refreshEcosystem();render();MioPlatform.emit('theme.changed',{id:d.id},{relay:false})},
    'eco-theme-off':async()=>{await ecoRequest('themes/select',{id:''});await refreshEcosystem();render();MioPlatform.emit('theme.changed',{id:''},{relay:false})},
    'eco-theme-remove':async d=>{if(await confirmAction('卸载主题？','主题样式、图标包和随包字体将删除，作品不受影响。','卸载')){await ecoRequest('themes/uninstall',{id:d.id});await refreshEcosystem();render()}},
    'eco-extension-toggle':async d=>{const enabled=d.enabled==='1';if(enabled&&!await confirmAction('启用扩展代码？','JavaScript 与 Python 将立即执行，仅启用可信代码。','信任并启用'))return;await ecoRequest('extensions/enable',{id:d.id,enabled,trusted:enabled});await refreshEcosystem();render()},
    'eco-extension-update':async d=>{if(!await confirmAction('更新扩展代码？','重新下载所选分支，校验后替换代码。分层数据不动；更新后保持停用，需重新确认启用。','信任并更新'))return;await ecoRequest('extensions/update',{id:d.id,trusted:true});await refreshEcosystem();render()},
    'eco-extension-remove':d=>{rt.ecoRemoveId=d.id;const p=ecoState.status.extensions.find(x=>x.id===d.id);modal('卸载扩展',`<p>代码仓库将移除。选择保留哪些分层数据：</p><p class="soft small">当前占用：${ecoUsageLabel(p?.data)}</p><label class="row"><input type="radio" name="eco-purge" value="none" checked>保留配置与工作区数据（仅删除代码，可随时重装继续）</label><label class="row"><input type="radio" name="eco-purge" value="cache">同时清理缓存与临时文件</label><label class="row"><input type="radio" name="eco-purge" value="all">删除全部数据（不可恢复）</label><div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('确认卸载','trash','eco-extension-remove-confirm','','danger')}</div>`)},
    'eco-extension-remove-confirm':async()=>{await ecoRequest('extensions/uninstall',{id:rt.ecoRemoveId,purge:$('input[name="eco-purge"]:checked')?.value||'none'});closeModal();await refreshEcosystem();render()},
    'eco-extension-purge':async d=>{if(await confirmAction('清理扩展缓存？','删除 cache 与 tmp 两层数据；配置和工作区数据保留。','清理')){const usage=await ecoRequest('extensions/purge',{id:d.id,level:'cache'});toast('已清理：'+ecoUsageLabel(usage));await refreshEcosystem();render()}},
    'eco-extension-settings':async d=>{const data=await ecoLoadSettings(d.id);const p=ecoState.status.extensions.find(x=>x.id===d.id);modal((p?.name||d.id)+' · 设置',`<form id="eco-settings-form" data-id="${esc(d.id)}">${data.schema.map(f=>ecoSettingsField(f,data.values[f.key])).join('')}<div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('保存','check','eco-extension-settings-save',`data-id="${esc(d.id)}"`,'primary')}</div></form>`)},
    'eco-extension-settings-save':async d=>{const data=ecoState.settingsCache.get(d.id);if(!data)return;const values={};for(const f of data.schema){const el=$(`[data-eco-setting="${CSS.escape(f.key)}"]`);if(!el)continue;values[f.key]=f.type==='toggle'?el.checked:f.type==='number'?Number(el.value):f.type==='json'?JSON.parse(el.value||'null'):el.value}await ecoContext(d.id).api('/settings',{values});closeModal();toast('设置已保存。');MioPlatform.emit('ext:'+d.id+':settings.changed',values,{source:'core',relay:false})},
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
}
async function bootEcosystem(){
  globalThis.Mio.extensions=Object.freeze({apiVersion:2,platform:MioPlatform,albums:MioAlbums,icons:MioIcons});
  try{await refreshEcosystem()}catch(e){ecoState.errors.push(e.message)}
  if(window.MioSafeMode){
    const host=document.createElement('aside');host.style.cssText='position:fixed!important;inset:auto 16px 40px auto!important;z-index:2147483647!important;display:block!important';
    host.id='mio-safe-recovery';const shadow=host.attachShadow({mode:'closed'});shadow.innerHTML='<style>:host{all:initial}section{font:13px system-ui;background:#fff;color:#15271a;border:2px solid #4a7952;border-radius:12px;padding:18px;max-width:320px;box-shadow:0 6px 30px #0003}button{padding:9px;border-radius:6px;border:1px solid #9abfa2;background:#e6f2e6;color:#15271a;cursor:pointer;margin-top:10px}</style><section><b>安全模式 · 官方界面</b><p>第三方主题与前端扩展未加载。点击下方可停用所有扩展并恢复官方主题；代码与数据均保留。</p><button>一键重置主题并停用扩展</button></section>';
    shadow.querySelector('button').onclick=async()=>{await ecoRequest('reset',{});shadow.querySelector('p').textContent='已重置。可以移除地址中的 safe_mode=1 后重新访问。'};document.body.append(host);
  }
  render();mioPollActivity();
}

