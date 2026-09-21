/* Workflow library, per-scene assignments and immutable queue configuration. */
'use strict';

function workflowLibraryEnsure(s=state){
  const c=s.settings.comfy;
  c.presets??=[];
  const used=new Set();
  for(const p of c.presets){if(!p.id||used.has(p.id))p.id=uid('wf');used.add(p.id)}
  if(!c.activeWorkflowId||!c.presets.some(p=>p.id===c.activeWorkflowId)){
    const p={id:uid('wf'),title:c.workflowTitle||'默认工作流',workflow:clone(c.workflow),mapping:clone(c.mapping||{}),bindings:clone(c.bindings||[]),outputNodeId:c.outputNodeId||'',randomizeSeeds:!!c.randomizeSeeds,slots:clone(c.slots||{})};
    c.presets.push(p);c.activeWorkflowId=p.id;
  }
  s.settings.studio.visibility.extensions??=true;
}

function storeActiveWorkflow(){
  const c=state.settings.comfy,p=c.presets.find(x=>x.id===c.activeWorkflowId);
  if(!p)return;
  Object.assign(p,{title:c.workflowTitle,workflow:clone(c.workflow),mapping:clone(c.mapping||{}),bindings:clone(c.bindings||[]),outputNodeId:c.outputNodeId||'',randomizeSeeds:!!c.randomizeSeeds,slots:clone(c.slots||{}),updatedAt:Date.now()});
}

function workflowExecutionFor(plan,frame){
  const c=state.settings.comfy,id=planFrameOverrides(plan,frame||{}).workflowId||plan?.workflowId||c.activeWorkflowId;
  if(id===c.activeWorkflowId)return {...mappedExecutionSnapshot(),workflowId:id};
  const p=c.presets.find(w=>w.id===id);
  if(!p)throw Error('所选工作流已删除，请重新选择。');
  return {workflowId:id,workflowTitle:p.title,workflow:clone(p.workflow),bindings:clone(p.bindings||initialWorkflowBindings({...c,...p})),outputNodeId:p.outputNodeId||'',randomizeSeeds:!!p.randomizeSeeds,slots:clone(p.slots||{}),globalNegative:state.settings.negative,baseUrl:c.baseUrl,mode:c.mode,autoFallback:c.autoFallback,objectInfo:clone(Object.fromEntries([...new Set(Object.values(p.workflow).map(n=>n.class_type))].filter(key=>c.objectInfo?.[key]).map(key=>[key,c.objectInfo[key]])))};
}

function selectLibraryWorkflow(id){
  storeActiveWorkflow();const c=state.settings.comfy,p=c.presets.find(x=>x.id===id);
  if(!p)throw Error('工作流不存在。');
  c.activeWorkflowId=id;c.workflow=clone(p.workflow);c.workflowTitle=p.title;c.mapping=clone(p.mapping||{});
  c.bindings=clone(p.bindings||initialWorkflowBindings({...c,...p}));c.outputNodeId=p.outputNodeId||'';c.randomizeSeeds=!!p.randomizeSeeds;c.slots=clone(p.slots||{});
  createUI.nodeSearch='';mapperUI.selected='';mapperUI.search='';mapperUI.filter='all';mapperUI.nodes=false;mapperUI.sel.clear();mapperUI.selMode=false;save();render();
}

function parseLibraryWorkflow(data,title){
  if(!data||typeof data!=='object')throw Error('不是有效的 JSON 工作流。');
  const workflow=data.workflow||data.prompt||data;
  if(Array.isArray(workflow.nodes))throw Error('这是 ComfyUI 编辑器格式，请导出 API 格式后导入。');
  validateWorkflow(workflow);
  const c=state.settings.comfy,p={id:uid('wf'),title:String(data.title||data.workflowTitle||title||'导入工作流'),workflow:clone(workflow),mapping:clone(data.mapping||{}),bindings:[],outputNodeId:String(data.outputNodeId||''),randomizeSeeds:!!data.randomizeSeeds,slots:data.slots&&typeof data.slots==='object'&&!Array.isArray(data.slots)?clone(data.slots):{}};
  if(Array.isArray(data.bindings)){validateBindings(data.bindings);p.bindings=clone(data.bindings)}
  else {
    const nodes=Object.entries(workflow),texts=nodes.filter(([,n])=>/TextEncode|Prompt/i.test(n.class_type)&&Object.values(n.inputs).some(v=>typeof v==='string'));
    const neg=texts.find(([,n])=>/negative|负/i.test(n._meta?.title||''))||(texts.length>1?texts[1]:null),pos=texts.find(x=>x!==neg);
    p.mapping.positive=pos?.[0]||'';p.mapping.negative=neg?.[0]||'';
    p.bindings=initialWorkflowBindings({...c,...p});
  }
  p.outputNodeId||=Object.entries(workflow).find(([,n])=>/SaveImage|PreviewImage/.test(n.class_type))?.[0]||'';
  return p;
}

function importWorkflowIntoMapper(data){
  const p=parseLibraryWorkflow(data);storeActiveWorkflow();state.settings.comfy.presets.push(p);selectLibraryWorkflow(p.id);navigate(3);toast('已作为独立工作流导入，请核对节点映射。');
}

async function importWorkflowFiles(files){
  const accepted=[],errors=[];
  for(const file of files){
    try{
      if(file.size>100*1024*1024)throw Error('文件超过 100 MB');
      const data=JSON.parse(await file.text()),items=Array.isArray(data)?data:Array.isArray(data.workflows)?data.workflows:[data];
      if(items.length>200)throw Error('每个文件最多包含 200 份工作流');
      for(let i=0;i<items.length;i++)try{accepted.push(parseLibraryWorkflow(items[i],file.name.replace(/\.json$/i,'')+(items.length>1?' · '+(i+1):'')))}catch(e){errors.push(file.name+' #'+(i+1)+'：'+e.message)}
    }catch(e){errors.push(file.name+'：'+e.message)}
  }
  storeActiveWorkflow();state.settings.comfy.presets.push(...accepted);
  if(accepted.length)selectLibraryWorkflow(accepted[0].id);
  save();render();
  modal('批量导入结果',`<p>成功导入 ${accepted.length} 份工作流。</p>${errors.length?'<div class="notice amber">'+errors.map(esc).join('<br>')+'</div>':'<p class="help">自动识别仅作为初始映射，请核对正负提示词及输出节点。</p>'}<div class="modal-footer">${btn('完成','check','close-modal','','primary')}</div>`);
  return {accepted,errors};
}

function workflowOptions(value,inherit='跟随全册默认'){
  return opt('',inherit,value||'')+state.settings.comfy.presets.map(p=>opt(p.id,p.title,value||'')).join('');
}

// Render protocol applicability at the source, including partial view refreshes.
function workflowControlHTML(id,value,inherit,label){
  const profile=activeImageProfile();
  if(profile.provider!=='comfyui')return `<div id="${id}" class="workflow-not-applicable" role="note" aria-label="${esc(label)}：无需工作流">${icon('check','sm')}<span>无需工作流 · ${esc(profile.title)}</span></div>`;
  return `<select id="${id}" aria-label="${esc(label)}">${workflowOptions(value,inherit)}</select>`;
}

function sceneAssignmentHTML(p,f){
  const o=planFrameOverrides(p,f),sets=o.variableSetIds||[],current=sets[0]||'';
  return `<section class="scene-assignment"><div class="scene-assignment-grid">${field('本幕设定预设',`<select id="ws-scene-preset" aria-label="本幕设定预设">${opt('','继承全册设定',current)}${projectVariableSets().map(s=>opt(s.id,s.title,current)).join('')}</select>`)}${field('本幕工作流',workflowControlHTML('ws-scene-workflow',o.workflowId,'全册默认 · '+(state.settings.comfy.presets.find(w=>w.id===p.workflowId)?.title||state.settings.comfy.workflowTitle),'本幕工作流'))}</div><div class="row wrap">${btn('仅此幕加入队列','plus','ws-enqueue-scene','','small')}${activeImageProfile().provider==='comfyui'?btn('调整此工作流','nodes','ws-edit-scene-workflow','','small ghost'):''}</div></section>`;
}

function queueComposerHTML(){
  const p=selectedPlan(),t=p&&templateBy(p.templateId);if(!p)return '';
  return `<div class="queue-compose-inline" aria-label="添加生成任务">${activeImageProfile().provider==='comfyui'?`<div class="queue-compose-field"><span class="workflow-control-label">工作流</span>${workflowControlHTML('ws-plan-workflow',p.workflowId,'当前工作流 · '+state.settings.comfy.workflowTitle,'全册默认工作流')}</div>`:''}<div class="queue-compose-field"><label for="ws-queue-range">生成范围</label><select id="ws-queue-range" aria-label="生成范围"><option value="all">整本画册 · 保留单幕配置</option>${(t?.frames||[]).map((f,i)=>opt(i,'第 '+(i+1)+' 幕 · '+f.name,'all')).join('')}</select></div>${btn(rt.paused?'加入待办':'加入并执行','plus','ws-enqueue-range','','small')}<span class="queue-compose-note">新建独立画册版本 · 暂停时只加入待办</span></div>`;
}


function taskWorkflowLocked(q,index){
  const position=q?.indices.indexOf(index),execution=q?.frames?.[index]?._execution||q?.execution;
  if(!q||position<0||(execution?.provider&&execution.provider!=='comfyui'))return true;
  if(q.serverFrameStates?.length){const local=(q.serverIndices||q.indices).indexOf(index),frame=q.serverFrameStates.find(f=>f.index===local);return !frame||!['pending','failed','skipped'].includes(frame.state)}
  return position<q.done||(['running','paused'].includes(q.status)&&position===q.done);
}
function queueWorkflowDetails(){
  return state.queue.filter(q=>['pending','running','paused','failed'].includes(q.status)).map(q=>{
    const b=bookBy(q.bookId);if(!b)return '';
    return `<details class="quiet-advanced queue-workflow-detail" data-task-detail="${esc(q.id)}"><summary>${esc(b.title)} · 查看 / 调整待执行工作流</summary><p class="help">已开始的分镜被锁定；调整未开始的分镜仅更改此任务的快照，不影响其他任务。</p>${q.indices.map(i=>{
      const f=q.frames?.[i],ex=f?._execution||q.execution,locked=taskWorkflowLocked(q,i);
      return `<div class="queue-workflow-row"><span>${i+1}. ${esc(f?.name||'分镜')}</span><span class="tiny muted">快照：${esc(ex?.workflowTitle||'默认')}</span><select data-ws-task="${esc(q.id)}" data-ws-index="${i}" aria-label="第 ${i+1} 幕任务工作流" ${locked?'disabled':''}>${opt('','保留当前快照','')}${state.settings.comfy.presets.map(p=>opt(p.id,p.title,'')).join('')}</select></div>`;
    }).join('')}</details>`;
  }).join('');
}

async function enqueueWorkspaceRange(indices,start=false){
  flushEditor();const p=selectedPlan();if(!p)throw Error('先创建画册。');
  const prepared=await prepareComputedPlan(generationContextPlan(p));const book=enqueuePlanSnapshot(prepared,null,indices);createUI.tab='queue';navigate(1);
  if(!rt.paused&&(!rt.running||!foundationIsMock()))void runQueue();toast(rt.paused?'任务已加入，队列暂停中。':'任务已加入，将按队列顺序执行。');return book;
}

// A preset draft is not a creation plan: generation always reads selectedPlan().
// Drafts live in private workspace metadata, so switching/reloading does not discard edits.
function settingPresetSelection(p=selectedPlan()){
  const id=createUI.presetOwner===p?.id?createUI.presetSelection:state.drafts?.settingSelections?.[p?.id];
  return projectVariableSets().some(s=>s.id===id)?id:'';
}

function selectSettingPreset(id,p=selectedPlan()){
  if(!p)return;
  if(id&&!projectVariableSets().some(s=>s.id===id))throw Error('预设已不存在。');
  state.drafts??={};state.drafts.settingSelections??={};state.drafts.settingSelections[p.id]=id;
  createUI.presetOwner=p.id;createUI.presetSelection=id;
  if(id)settingPresetDraft(id);
  save();
}

function presetContentSignature(set){
  function canonical(value){
    if(typeof value==='string'&&value.startsWith('/images/'))return value.split('/').at(-1);
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
    return value;
  }
  return JSON.stringify(canonical({title:set.title,entries:set.entries,settingsGroups:set.settingsGroups||[],frames:set.frames||{}}));
}

function settingPresetDraft(id,create=true){
  const set=setBy(id);if(!set||set.projectId!==state.activeProjectId)return null;
  state.drafts??={};state.drafts.presetEdits??={};
  if(create&&(!state.drafts.presetEdits[id]||(!state.drafts.presetEdits[id].dirty&&state.drafts.presetEdits[id].base!==presetContentSignature(set))))state.drafts.presetEdits[id]={id:'preset-editor-'+id,_presetEditorId:id,projectId:set.projectId,title:set.title,variableSetIds:[],variables:clone(set.entries),settingsGroups:clone(set.settingsGroups||[]),frames:clone(set.frames||{}),excludedSettingKeys:[],base:presetContentSignature(set)};
  return state.drafts.presetEdits[id]||null;
}

function settingsEditorTarget(){const p=selectedPlan(),id=settingPresetSelection(p);return id?settingPresetDraft(id):p}
function settingsTargetById(id){
  if(id?.startsWith('preset-editor-'))return settingPresetDraft(id.slice('preset-editor-'.length),false);
  const p=planBy(id);return p?.projectId===state.activeProjectId?p:null;
}

async function updateSelectedSettingPreset(){
  commitSettingsGroupNames(settingsEditorTarget());flushEditor();const draft=settingsEditorTarget(),id=draft?._presetEditorId,set=setBy(id),projectId=state.activeProjectId;
  if(!set)throw Error('请先选择要更新的预设。');
  if(draft.base!==presetContentSignature(set))throw Error('原预设已有其他修改，未覆盖。你的草稿仍保留，可使用“另存为”保存新副本。');
  // Materialize legacy live references before changing this shared resource.
  await Promise.all(state.books.filter(b=>(b.importedVariableSetIds||[]).includes(id)).map(b=>globalThis.Mio.fileLibrary.hydrate(b.id)));
  if(projectId!==state.activeProjectId||settingPresetDraft(id,false)!==draft||setBy(id)!==set||draft.base!==presetContentSignature(set))throw Error('工作区或预设已变化，未更新。');
  const change=preparePresetRemoval(state,id);
  for(const {original,document} of [...change.plans,...change.books]){for(const k of Object.keys(original))delete original[k];Object.assign(original,document)}
  set.entries=clone(mergedSettingEntries(draft));set.settingsGroups=clone(settingsGroups(draft));
  draft.variables=clone(set.entries);draft.excludedSettingKeys=[];draft.base=presetContentSignature(set);draft.dirty=false;
  save();render();
  if(!await savePythonWorkspace())throw Error('更新尚未确认。草稿仍保留，请检查保存错误后重新保存；未声称预设文件已更新。');
  toast('已更新「'+set.title+'」；本册、其他预设和已入队任务不变。');
}

async function applySelectedSettingPreset(){
  commitSettingsGroupNames(settingsEditorTarget());flushEditor();const p=currentBookSettings(),draft=settingsEditorTarget(),id=draft?._presetEditorId,projectId=state.activeProjectId;
  if(!p||!id)throw Error('请先选择要应用的预设。');
  if(!await confirmAction('应用「'+draft.title+'」到本册？','将当前显示的预设草稿复制到本册，替换本册全局设定；不修改预设文件或单幕覆盖；保存后影响本册尚未发送的分镜，在途请求不变。','应用'))return;
  if(projectId!==state.activeProjectId||settingsTargetById(p.id)!==p||currentBookSettings()!==p||settingPresetDraft(id,false)!==draft)throw Error('工作区或预设已变化，未应用。');
  p.settingsGroups=clone(settingsGroups(draft));p.variables=mergedSettingEntries(draft).map(e=>({...clone(e),id:uid('var')}));p.variableSetIds=[];p.excludedSettingKeys=[];delete p.editingPresetId;
  save();closeModal();render();if(!await savePythonWorkspace())throw Error('应用尚未保存成功，未声称已生效。请检查保存错误。');toast('已应用到本册。');
}

function saveSettingsAsPreset(){
  commitSettingsGroupNames(settingsEditorTarget());flushEditor();const target=settingsEditorTarget(),p=selectedPlan(),projectId=state.activeProjectId;
  if(!target||!p)throw Error('请先选择画册计划。');
  const groups=clone(settingsGroups(target)),entries=clone(mergedSettingEntries(target)),frames=clone(target.frames||{}),inLibrary=presetLibraryIsOpen();
  textModal('另存为','预设名称',target.title+' · 副本',async name=>{
    if(!name.trim())throw Error('请输入预设名称。');
    if(state.activeProjectId!==projectId||!planBy(p.id))throw Error('工作区已变化，请重新另存为。');
    const set={id:uid('set'),projectId,title:name.trim(),settingsGroups:groups,entries:entries.map(e=>({...e,id:uid('var')}))};
    if(Object.keys(frames).length)set.frames=frames;
    state.creation.variableSets.push(set);selectSettingPreset(set.id,p);save();closeModal();render();if(inLibrary)openPresetLibrary(set.id);
    if(!await savePythonWorkspace())throw Error('另存尚未确认。新副本草稿仍保留，请检查保存错误后重新保存，不必再次创建副本。');
    toast('已创建独立预设副本；当前画册不变。');
  },'保存当前显示的内容为新预设，不覆盖原预设，也不改变本册设定。');
}

function preparePresetRemoval(source,id){
  const set=source.creation.variableSets.find(s=>s.id===id);if(!set)throw Error('预设已不存在，请重新读取。');
  const plans=[],books=[],resolve=key=>source.creation.variableSets.find(s=>s.id===key);
  function detach(owner){
    const ids=owner.variableSetIds||[],index=ids.lastIndexOf(id);if(index<0)return;
    const keep=new Map(set.entries.map(e=>[e.key,e]));
    for(const later of ids.slice(index+1))for(const e of resolve(later)?.entries||[])keep.delete(e.key);
    for(const e of owner.variables||[])keep.delete(e.key);
    owner.variables=[...[...keep.values()].map(e=>({...clone(e),id:uid('var')})),...(owner.variables||[])];
    owner.variableSetIds=ids.filter(key=>key!==id);
  }
  for(const plan of source.creation.plans){
    if(!(plan.variableSetIds||[]).includes(id)&&!Object.values(plan.sceneOverrides||{}).some(o=>(o.variableSetIds||[]).includes(id))&&plan.editingPresetId!==id)continue;
    const document=clone(plan);detach(document);for(const o of Object.values(document.sceneOverrides||{}))detach(o);
    if(document.editingPresetId===id)delete document.editingPresetId;
    plans.push({original:plan,document});
  }
  for(const book of source.books){
    if(!(book.importedVariableSetIds||[]).includes(id))continue;
    if(book._lazy)throw Error('需要先读取引用此预设的画册，删除尚未提交。');
    const document=clone(book);document.importedVariableSetIds=document.importedVariableSetIds.filter(key=>key!==id);
    document.importedVariableSnapshots=[...(document.importedVariableSnapshots||[]),{title:set.title,entries:clone(set.entries),frames:clone(set.frames||{})}];
    books.push({original:book,document});
  }
  return {set,plans,books};
}

async function deleteSettingPreset(id=settingPresetSelection()){
  if(!id)throw Error('请先选择要删除的预设。');
  const set=setBy(id),projectId=state.activeProjectId;if(!set||set.projectId!==projectId)throw Error('请从当前画册集选择预设。');
  flushEditor();const count=state.creation.plans.filter(p=>(p.variableSetIds||[]).includes(id)||Object.values(p.sceneOverrides||{}).some(o=>(o.variableSetIds||[]).includes(id))).length;
  if(!await confirmAction('删除预设「'+set.title+'」？','从预设库移除这份文件。有 '+count+' 份画册计划引用它；正在使用的值和参考图会保留为画册或单幕自己的设定。已生成图片、台词和已入队快照不变。','删除预设'))return;
  if(state.activeProjectId!==projectId||!setBy(id))throw Error('工作区或预设已变化，请重新选择。');
  await Promise.all(state.books.filter(b=>(b.importedVariableSetIds||[]).includes(id)).map(b=>globalThis.Mio.fileLibrary.hydrate(b.id)));
  if(state.activeProjectId!==projectId)throw Error('工作区已变化，未删除预设。');
  flushEditor();const change=preparePresetRemoval(state,id);
  for(const {original,document} of [...change.plans,...change.books]){for(const k of Object.keys(original))delete original[k];Object.assign(original,document)}
  state.creation.variableSets=state.creation.variableSets.filter(s=>s.id!==id);
  if(createUI.setId===id)createUI.setId=null;
  if(createUI.presetSelection===id)createUI.presetSelection='';
  if(state.drafts?.presetEdits)delete state.drafts.presetEdits[id];
  for(const key of Object.keys(state.drafts?.settingSelections||{}))if(state.drafts.settingSelections[key]===id)state.drafts.settingSelections[key]='';
  save(true);render();
  if(!await savePythonWorkspace())throw Error('删除尚未确认。本页保留待保存更改，请检查保存错误后重新保存或读取，未声称磁盘已删除。');
  toast('预设已删除；正在使用的设定、原图和任务快照已保留。');
}

function createBlankPreset(){
  const p=selectedPlan(),projectId=state.activeProjectId;
  textModal('新建空白预设','预设名称','新角色设定',async name=>{
    if(!name.trim())throw Error('请输入预设名称。');
    if(state.activeProjectId!==projectId||!planBy(p?.id))throw Error('工作区已变化，请重新新建。');
    const set={id:uid('set'),title:name.trim(),projectId,entries:['character_display_name','character','outfit','style','scene'].map(k=>variableEntry(k,''))};
    state.creation.variableSets.push(set);selectSettingPreset(set.id,p);
    createUI.tab='settings';save();closeModal();render();openPresetLibrary(set.id);
    if(!await savePythonWorkspace())throw Error('新建尚未确认。预设草稿仍保留，请检查保存错误后重新保存。');
    toast('已创建空白预设；本册与原预设不变。');
  },'填写内容会暂存为这份预设自己的草稿；点击“更新当前预设”保存，点击“应用”才复制到本册。');
}

function installWorkspaceUpgrade(){
  const oldEnsure=ensureStudioState;ensureStudioState=function(s=state){oldEnsure(s);workflowLibraryEnsure(s);return s};
  studioDefaults.visibility.extensions??=true;
  window.matchMedia('(max-width: 759px)').addEventListener('change',()=>renderShell());
  const oldSave=save;save=function(...args){storeActiveWorkflow();return oldSave(...args)};
  const oldNavigate=navigate;navigate=function(index){
    if(Number(index)===3){flushEditor();ui.workspace=3;render();window.scrollTo({top:0,behavior:'instant'});return}
    return oldNavigate(index);
  };
  const oldRender=render;render=function(){
    if(ui.workspace===3){ensureStudioState();renderShell();patchMain('<div class="view">'+renderWorkflowLibrary()+'</div>');const crumb=$('.breadcrumb strong');if(crumb)crumb.textContent='工作流与 API 配置';applyStudioPreferences();return}
    oldRender();
    const p=selectedPlan();if(ui.workspace===1&&createUI.tab==='settings'&&settingPresetSelection(p)) $('.settings-preset-line')?.insertAdjacentHTML('beforeend',btn('更新当前预设','disk','ws-update-preset','','small'));
  };
  const oldPythonSettings=renderPythonSettings;renderPythonSettings=()=>oldPythonSettings()+dataLayoutHTML();
  renderCreationQueue=renderCompactQueue;
  const oldUpdate=updateQueueUI;updateQueueUI=function(){
    const detailKey=x=>(x.closest('[data-sort-task]')?.dataset.sortTask||x.dataset.taskDetail||'')+'/'+x.className;
    const open=new Set([...document.querySelectorAll('#queue-list details[open]')].map(detailKey));
    oldUpdate();
    document.querySelectorAll('#queue-list details').forEach(x=>x.open=open.has(detailKey(x)));
    if($('#queue-controls'))$('#queue-controls').innerHTML=queueControlsHTML();
  };
  const oldAction=handleAction;handleAction=async function(action,d={},el){
    if(action==='wf-focus-library'||(action==='v3-settings-tab'&&d.tab==='mapping'))return navigate(3);
    if(action==='ws-import'||action==='ws-open-unified-import'){
      openUnifiedWorkflowImportModal();
      return;
    }
    if(action==='ws-do-unified-import'){
      const files=window._pendingImportFiles?.()||[];
      if(!files.length)return;
      const mode=document.querySelector('input[name="wf-import-mode"]:checked')?.value||'new';
      closeModal();
      if(mode==='replace'){
        const file=files[0];
        try{
          const c=state.settings.comfy;
          const data=JSON.parse(await file.text());
          const newWf=data.workflow||data.prompt||data;
          if(Array.isArray(newWf.nodes))throw Error('这是 ComfyUI 编辑器格式，请导出 API 格式后导入。');
          validateWorkflow(newWf);
          // 校验合法后再自动备份下载当前映射包
          download(safeFolderName(c.workflowTitle)+'.backup.mappings.json',JSON.stringify({kind:'comfycomic.workflow-mappings',formatVersion:1,title:c.workflowTitle,workflow:c.workflow,bindings:c.bindings,outputNodeId:c.outputNodeId,randomizeSeeds:c.randomizeSeeds},null,2));
          c.workflow=clone(newWf);
          // 保留 bindings 真实状态，失效项如实由健康条与待检查捕获
          if(c.outputNodeId&&!c.workflow[c.outputNodeId])c.outputNodeId='';
          storeActiveWorkflow();
          save();render();
          toast('已更新蓝图底层节点图，原有映射包已自动备份并下载。');
        }catch(err){
          toast('替换蓝图失败：'+err.message,'error');
        }
        return;
      }
      return importWorkflowFiles(files).catch(e=>toast(e.message,'error'));
    }
    if(action==='ws-select')return selectLibraryWorkflow(d.id);
    if(action==='ws-copy'){storeActiveWorkflow();const c=state.settings.comfy,p=clone(c.presets.find(x=>x.id===c.activeWorkflowId));p.id=uid('wf');p.title+=' · 副本';c.presets.push(p);return selectLibraryWorkflow(p.id)}
    if(action==='ws-delete'){
      const c=state.settings.comfy,id=c.activeWorkflowId;
      if(c.presets.length===1)throw Error('至少保留一份工作流。');
      if(state.creation.plans.some(p=>p.workflowId===id||Object.values(p.sceneOverrides||{}).some(o=>o.workflowId===id)))throw Error('有画册或分镜正在引用此工作流，请先更换选择。');
      if(!await confirmAction('删除这份工作流？','已入队的工作流快照不会删除。建议先导出备份。','删除'))return;
      c.presets=c.presets.filter(p=>p.id!==id);selectLibraryWorkflow(c.presets[0].id);save(true);return;
    }
    /* 工作流库批量选择 */
    if(action==='ws-lib-sel-toggle'){
      mapperUI.libSelMode=!mapperUI.libSelMode;
      if(!mapperUI.libSelMode)mapperUI.libSel.clear();
      render();return;
    }
    if(action==='ws-lib-pick'){
      if(mapperUI.libSel.has(d.id))mapperUI.libSel.delete(d.id);
      else mapperUI.libSel.add(d.id);
      render();return;
    }
    if(action==='ws-lib-pick-all'){
      const c=state.settings.comfy;
      const q=String(mapperUI.libSearch||'').trim().toLowerCase();
      const visiblePresets=c.presets.filter(p=>!q||(p.title||'').toLowerCase().includes(q));
      const allPicked=visiblePresets.length>0&&visiblePresets.every(p=>mapperUI.libSel.has(p.id));
      if(allPicked)visiblePresets.forEach(p=>mapperUI.libSel.delete(p.id));
      else visiblePresets.forEach(p=>mapperUI.libSel.add(p.id));
      render();return;
    }
    if(action==='ws-lib-delete-bulk'){
      const c=state.settings.comfy;
      if(!mapperUI.libSel.size)return;
      storeActiveWorkflow();
      const originalPresets=clone(c.presets),originalActive=c.activeWorkflowId;
      let deleted=0,skipped=0;
      const keep=[];
      for(const p of c.presets){
        if(mapperUI.libSel.has(p.id)){
          const isReferenced=state.creation.plans.some(pl=>pl.workflowId===p.id||Object.values(pl.sceneOverrides||{}).some(o=>o.workflowId===p.id));
          if(isReferenced){keep.push(p);skipped++}
          else{deleted++}
        }else{
          keep.push(p);
        }
      }
      if(!keep.length){toast('不能删除全部工作流，至少保留一份','error');return}
      if(!deleted){toast('所选工作流均被画册或分镜引用，无法删除','error');return}
      c.presets=keep;
      if(!c.presets.some(p=>p.id===c.activeWorkflowId))selectLibraryWorkflow(c.presets[0].id);
      mapperUI.libSel.clear();mapperUI.libSelMode=false;
      save(true);render();
      const msg=skipped?`已删除 ${deleted} 份工作流，跳过 ${skipped} 份被引用的工作流`:`已删除 ${deleted} 份工作流`;
      undoToast(msg,()=>{
        c.presets=originalPresets;
        selectLibraryWorkflow(originalActive);
        save(true);render();
      });
      return;
    }
    /* 映射表批量选择与操作 */
    if(action==='wm-sel-toggle'){
      mapperUI.selMode=!mapperUI.selMode;
      if(!mapperUI.selMode)mapperUI.sel.clear();
      render();return;
    }
    if(action==='wm-pick'){
      if(mapperUI.sel.has(d.id))mapperUI.sel.delete(d.id);
      else mapperUI.sel.add(d.id);
      render();return;
    }
    if(action==='wm-pick-all'){
      const visibleBindings=mapperVisibleBindings();
      const allPicked=visibleBindings.length>0&&visibleBindings.every(b=>mapperUI.sel.has(b.id));
      if(allPicked)visibleBindings.forEach(b=>mapperUI.sel.delete(b.id));
      else visibleBindings.forEach(b=>mapperUI.sel.add(b.id));
      render();return;
    }
    if(action==='wm-pick-noncore'){
      const c=state.settings.comfy;
      mapperUI.sel.clear();
      c.bindings.forEach(b=>{
        if(!['positive','negative','caption'].includes(b.source))mapperUI.sel.add(b.id);
      });
      render();return;
    }
    if(action==='wm-pick-disabled'){
      const c=state.settings.comfy;
      mapperUI.sel.clear();
      c.bindings.forEach(b=>{if(!b.enabled)mapperUI.sel.add(b.id)});
      render();return;
    }
    if(action==='wm-delete-bulk'){
      const c=state.settings.comfy;
      if(!mapperUI.sel.size)return;
      const count=mapperUI.sel.size;
      const originalBindings=clone(c.bindings);
      c.bindings=c.bindings.filter(b=>!mapperUI.sel.has(b.id));
      mapperUI.sel.clear();mapperUI.selMode=false;
      if(!c.bindings.some(b=>b.id===mapperUI.selected))mapperUI.selected=c.bindings[0]?.id||'';
      save();render();
      undoToast(`已删除 ${count} 项映射`,()=>{
        c.bindings=originalBindings;
        save();render();
      });
      return;
    }
    if(action==='wm-health-toggle'){
      mapperUI.healthOpen=!mapperUI.healthOpen;
      render();return;
    }
    if(action==='wm-select-output'){
      mapperUI.selected='__output__';mapperUI.nodes=false;
      render();
      if(innerWidth<=1024)document.querySelector('.wm-inspector')?.scrollIntoView({block:'start',behavior:'smooth'});
      return;
    }
    if(action==='v3-copy-binding'){
      const c=state.settings.comfy,b=c.bindings.find(x=>x.id===d.id);
      if(b){
        const nb=clone(b);nb.id=uid('b');nb.label+=' 副本';nb.enabled=false;
        c.bindings.push(nb);mapperUI.selected=nb.id;save();render();
        toast('已复制映射副本');
      }
      return;
    }
    if(action==='ws-export-all'){storeActiveWorkflow();const blob=new Blob([JSON.stringify({version:1,workflows:state.settings.comfy.presets},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='工作流库.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return}
    if(action==='ws-delete-preset'||action==='v3-set-delete')return deleteSettingPreset(action==='v3-set-delete'?createUI.setId:settingPresetSelection());
    if(action==='ws-new-preset')return createBlankPreset();
    if(action==='ws-update-preset')return updateSelectedSettingPreset();
    if(action==='ws-enqueue-scene')return enqueueWorkspaceRange([ui.frameIndex]);
    if(action==='ws-enqueue-range'||action==='ws-generate-range'){const value=$('#ws-queue-range')?.value||'all';return enqueueWorkspaceRange(value==='all'?null:[Number(value)],action==='ws-generate-range')}
    if(action==='ws-edit-scene-workflow'){const p=selectedPlan(),f=currentTemplate()?.frames[ui.frameIndex],id=planFrameOverrides(p,f||{}).workflowId||p.workflowId||state.settings.comfy.activeWorkflowId;selectLibraryWorkflow(id);return navigate(3)}
    if(action==='art-apply-preset')return applySelectedSettingPreset();
    return oldAction(action,d,el);
  };
  document.addEventListener('change',async event=>{const el=event.target;try{
    if(el.id==='art-setting-preset'){flushEditor();selectSettingPreset(el.value);render()}
    if(el.id==='ws-library-select')selectLibraryWorkflow(el.value);
    if(el.id==='v3-output-node-select'){
      state.settings.comfy.outputNodeId=el.value;
      save();render();
      toast('已更新结果图片输出节点');
    }
    if(el.id==='ws-extensions'){state.settings.studio.visibility.extensions=el.checked;save();render()}
    if(el.id==='ws-plan-workflow'){selectedPlan().workflowId=el.value;save()}
    if(el.id==='ws-scene-preset'||el.id==='ws-scene-workflow'){
      flushEditor();const p=selectedPlan(),f=currentTemplate().frames[ui.frameIndex];p.sceneOverrides[f.id]??={};const o=p.sceneOverrides[f.id];
      if(el.id==='ws-scene-preset')o.variableSetIds=el.value?[el.value]:[];else o.workflowId=el.value;
      save();render();
    }
    if(el.dataset.wsTask&&el.value){
      const q=state.queue.find(x=>x.id===el.dataset.wsTask),i=Number(el.dataset.wsIndex);
      if(q&&bookBy(q.bookId)?._lazy)await globalThis.Mio.fileLibrary.hydrate(q.bookId);
      if(!state.queue.includes(q)||taskWorkflowLocked(q,i))throw Error('此幕已经开始，不能修改正在执行的快照。');
      const execution=workflowExecutionFor({workflowId:el.value},{}),f=q.frames[i];
      buildMappedWorkflow(f,q.rowSnapshot,{execution,preview:true});f._execution=clone(execution);
      const b=bookBy(q.bookId);if(b)bookSettingsContext(q);if(b?.sourceSnapshot?.frames[i])b.sourceSnapshot.frames[i]._execution=clone(execution);
      syncBookSettingsInputs(q);save();toast('待执行分镜的工作流快照已更新。');
    }
  }catch(e){toast(e.message,'error')}});
}

function dataLayoutHTML(){
  return `<section class="settings-section"><h2>数据目录与完整备份</h2><p>默认使用程序旁的 data/，也可通过 MIO_DATA_DIR 指定独立工作区。标题与文件 ID 分离；不因改名移动或覆盖原图。</p><pre class="backend-code">data/
  workspace.json                  v2 工作区标记
  settings/{comfy,llm,xml}.json    服务连接
  settings/workspace.json         界面、顺序等小型元数据
  settings/secrets.json           私密凭据库，禁止公开分享
  storyboards/中文标题--ID.json    独立分镜
  presets/{characters,scenes}/    独立角色 / 场景设定
  collections/                   独立企划
  plans/                         独立创作计划
  albums/标题--ID/album.json            画册、对白、提示词及编辑快照
  albums/标题--ID/images/               本册原图、参考图与编辑图
  workflows/ · layouts/           独立工作流与版式
  records/ · runtime/             对话、队列与执行记录
  .cache/                        可重建的目录索引</pre><p class="help">含图资源的 JSON 同时携带同名 .assets/；画册请复制整个 ID 目录。单文件复制遇到相同 ID 时拒绝覆盖，界面导入分享包会分配新 ID。</p><div class="row wrap">${btn('导出完整图片目录 ZIP','download','disk-archive')}${btn('载入已解压目录','upload','disk-import-folder')}${btn('导出本机配置 JSON','disk','backup-export')}</div></section>`;
}
