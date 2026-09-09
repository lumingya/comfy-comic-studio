/* Workflow library, per-scene assignments and immutable queue configuration. */
'use strict';

function workflowLibraryEnsure(s=state){
  const c=s.settings.comfy;
  c.presets??=[];
  const used=new Set();
  for(const p of c.presets){if(!p.id||used.has(p.id))p.id=uid('wf');used.add(p.id)}
  if(!c.activeWorkflowId||!c.presets.some(p=>p.id===c.activeWorkflowId)){
    const p={id:uid('wf'),title:c.workflowTitle||'默认工作流',workflow:clone(c.workflow),mapping:clone(c.mapping||{}),bindings:clone(c.bindings||[]),outputNodeId:c.outputNodeId||'',randomizeSeeds:!!c.randomizeSeeds};
    c.presets.push(p);c.activeWorkflowId=p.id;
  }
  s.settings.studio.visibility.extensions??=false;
}

function storeActiveWorkflow(){
  const c=state.settings.comfy,p=c.presets.find(x=>x.id===c.activeWorkflowId);
  if(!p)return;
  Object.assign(p,{title:c.workflowTitle,workflow:clone(c.workflow),mapping:clone(c.mapping||{}),bindings:clone(c.bindings||[]),outputNodeId:c.outputNodeId||'',randomizeSeeds:!!c.randomizeSeeds,updatedAt:Date.now()});
}

function workflowExecutionFor(plan,frame){
  const c=state.settings.comfy,id=planFrameOverrides(plan,frame||{}).workflowId||plan?.workflowId||c.activeWorkflowId;
  if(id===c.activeWorkflowId)return {...mappedExecutionSnapshot(),workflowId:id};
  const p=c.presets.find(w=>w.id===id);
  if(!p)throw Error('所选工作流已删除，请重新选择。');
  return {workflowId:id,workflowTitle:p.title,workflow:clone(p.workflow),bindings:clone(p.bindings||initialWorkflowBindings({...c,...p})),outputNodeId:p.outputNodeId||'',randomizeSeeds:!!p.randomizeSeeds,globalNegative:state.settings.negative,baseUrl:c.baseUrl,mode:c.mode,autoFallback:c.autoFallback,objectInfo:clone(Object.fromEntries([...new Set(Object.values(p.workflow).map(n=>n.class_type))].filter(key=>c.objectInfo?.[key]).map(key=>[key,c.objectInfo[key]])))};
}

function selectLibraryWorkflow(id){
  storeActiveWorkflow();const c=state.settings.comfy,p=c.presets.find(x=>x.id===id);
  if(!p)throw Error('工作流不存在。');
  c.activeWorkflowId=id;c.workflow=clone(p.workflow);c.workflowTitle=p.title;c.mapping=clone(p.mapping||{});
  c.bindings=clone(p.bindings||initialWorkflowBindings({...c,...p}));c.outputNodeId=p.outputNodeId||'';c.randomizeSeeds=!!p.randomizeSeeds;
  createUI.nodeSearch='';save();render();
}

function parseLibraryWorkflow(data,title){
  if(!data||typeof data!=='object')throw Error('不是有效的 JSON 工作流。');
  const workflow=data.workflow||data.prompt||data;
  if(Array.isArray(workflow.nodes))throw Error('这是 ComfyUI 编辑器格式，请导出 API 格式后导入。');
  validateWorkflow(workflow);
  const c=state.settings.comfy,p={id:uid('wf'),title:String(data.title||data.workflowTitle||title||'导入工作流'),workflow:clone(workflow),mapping:clone(data.mapping||{}),bindings:[],outputNodeId:String(data.outputNodeId||''),randomizeSeeds:!!data.randomizeSeeds};
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
      if(file.size>10*1024*1024)throw Error('文件超过 10 MB');
      const data=JSON.parse(await file.text()),items=Array.isArray(data)?data:Array.isArray(data.workflows)?data.workflows:[data];
      if(items.length>200)throw Error('每个文件最多包含 200 份工作流');
      for(let i=0;i<items.length;i++)try{accepted.push(parseLibraryWorkflow(items[i],file.name.replace(/\.json$/i,'')+(items.length>1?' · '+(i+1):'')))}catch(e){errors.push(file.name+' #'+(i+1)+'：'+e.message)}
    }catch(e){errors.push(file.name+'：'+e.message)}
  }
  storeActiveWorkflow();state.settings.comfy.presets.push(...accepted);
  if(accepted.length)selectLibraryWorkflow(accepted[0].id);
  save();render();
  modal('批量导入结果',`<p>成功导入 ${accepted.length} 份工作流。每份独立保存节点与映射，同名文件不会覆盖已有工作流。</p>${errors.length?'<div class="notice amber">'+errors.map(esc).join('<br>')+'</div>':'<p class="help">自动识别仅作为初始映射，请核对正负提示词及输出节点。</p>'}<div class="modal-footer">${btn('完成','check','close-modal','','primary')}</div>`);
  return {accepted,errors};
}

function workflowOptions(value,inherit='跟随全册默认'){
  return opt('',inherit,value||'')+state.settings.comfy.presets.map(p=>opt(p.id,p.title,value||'')).join('');
}

function renderWorkflowLibrary(){
  const c=state.settings.comfy;
  return heading('工作流配置','独立管理蓝图与映射。编辑自动保存；已入队任务不受影响。',btn('批量导入','upload','ws-import','','primary')+btn('导出全部','download','ws-export-all'),'WORKFLOW / LIBRARY')+
    `<div class="workflow-library"><aside class="panel workflow-library-list"><div class="row between"><h3>工作流库</h3><span class="chip">${c.presets.length}</span></div><label class="label" for="ws-library-select">快捷切换</label><select id="ws-library-select">${c.presets.map(p=>opt(p.id,p.title,c.activeWorkflowId)).join('')}</select><div class="workflow-items">${c.presets.map(p=>`<button class="workflow-library-item ${p.id===c.activeWorkflowId?'active':''}" data-act="ws-select" data-id="${esc(p.id)}"><strong>${esc(p.title)}</strong><span>${Object.keys(p.workflow||{}).length} 个节点 · ${(p.bindings||[]).length} 项映射</span></button>`).join('')}</div><div class="row wrap">${btn('复制','copy','ws-copy','','small')}${btn('删除','trash','ws-delete','','small danger')}</div><p class="help">支持多选 JSON 文件、JSON 数组和 workflows 工作流包。原始未知节点与连接都会保留。</p></aside><div class="panel workflow-library-editor">${renderSmartMapper()}</div></div>`;
}

// Render protocol applicability at the source, including partial view refreshes.
function workflowControlHTML(id,value,inherit,label){
  const profile=activeImageProfile();
  if(profile.provider!=='comfyui')return `<div id="${id}" class="workflow-not-applicable" role="note" aria-label="${esc(label)}：无需工作流">${icon('check','sm')}<span>无需工作流 · ${esc(profile.title)}</span></div>`;
  return `<select id="${id}" aria-label="${esc(label)}">${workflowOptions(value,inherit)}</select>`;
}

function sceneAssignmentHTML(p,f){
  const o=planFrameOverrides(p,f),sets=o.variableSetIds||[],current=sets[0]||'';
  return `<section class="scene-assignment"><div class="scene-assignment-grid">${field('本幕设定预设',`<select id="ws-scene-preset" aria-label="本幕设定预设">${opt('','继承全册设定',current)}${projectVariableSets().map(s=>opt(s.id,s.title,current)).join('')}</select>`)}${field('本幕工作流',workflowControlHTML('ws-scene-workflow',o.workflowId,'全册默认 · '+(state.settings.comfy.presets.find(w=>w.id===p.workflowId)?.title||state.settings.comfy.workflowTitle),'本幕工作流'))}</div><p class="help">应用顺序：全册设定 → 本幕预设 → 本幕自定义属性。只影响本册这一幕，不修改共享模板。下方预览使用同一组设定。</p><div class="row wrap">${btn('仅此幕加入队列','plus','ws-enqueue-scene','','small')}${activeImageProfile().provider==='comfyui'?btn('调整此工作流','nodes','ws-edit-scene-workflow','','small ghost'):''}</div></section>`;
}

function queueComposerHTML(){
  const p=selectedPlan(),t=p&&templateBy(p.templateId);if(!p)return '';
  return `<div class="queue-compose-inline" aria-label="添加生成任务"><div class="queue-compose-field"><span class="workflow-control-label">工作流</span>${workflowControlHTML('ws-plan-workflow',p.workflowId,'当前工作流 · '+state.settings.comfy.workflowTitle,'全册默认工作流')}</div><div class="queue-compose-field"><label for="ws-queue-range">生成范围</label><select id="ws-queue-range" aria-label="生成范围"><option value="all">整本画册 · 保留单幕配置</option>${(t?.frames||[]).map((f,i)=>opt(i,'第 '+(i+1)+' 幕 · '+f.name,'all')).join('')}</select></div>${btn('加入队列','plus','ws-enqueue-range','','small')}<span class="queue-compose-note">按顺序自动执行 · 每次创建独立版本</span></div>`;
}


function queueWorkflowDetails(){
  return state.queue.filter(q=>['pending','running','paused','failed'].includes(q.status)).map(q=>{
    const b=bookBy(q.bookId);if(!b)return '';
    return `<details class="quiet-advanced queue-workflow-detail" data-task-detail="${esc(q.id)}"><summary>${esc(b.title)} · 查看 / 调整待执行工作流</summary><p class="help">已开始的分镜被锁定；调整未开始的分镜仅更改此任务的快照，不影响其他任务。</p>${q.indices.map((i,pos)=>{
      const f=q.frames?.[i],ex=f?._execution||q.execution,locked=(ex?.provider&&ex.provider!=='comfyui')||pos<q.done||(['running','paused'].includes(q.status)&&pos===q.done);
      return `<div class="queue-workflow-row"><span>${i+1}. ${esc(f?.name||'分镜')}</span><span class="tiny muted">快照：${esc(ex?.workflowTitle||'默认')}</span><select data-ws-task="${esc(q.id)}" data-ws-index="${i}" aria-label="第 ${i+1} 幕任务工作流" ${locked?'disabled':''}>${opt('','保留当前快照','')}${state.settings.comfy.presets.map(p=>opt(p.id,p.title,'')).join('')}</select></div>`;
    }).join('')}</details>`;
  }).join('');
}

async function enqueueWorkspaceRange(indices,start=false){
  flushEditor();const p=selectedPlan();if(!p)throw Error('先创建画册。');
  const book=enqueuePlanSnapshot(p,null,indices);createUI.tab='queue';navigate(1);
  if(!rt.running&&!rt.paused)void runQueue();toast(rt.paused?'任务已加入，队列暂停中。':'任务已加入，将按队列顺序执行。');return book;
}

function createBlankPreset(){
  textModal('新建空白预设','预设名称','新角色设定',name=>{
    if(!name.trim())throw Error('请输入预设名称。');
    const p=selectedPlan(),set={id:uid('set'),title:name.trim(),projectId:state.activeProjectId,entries:['character_display_name','character','outfit','style','scene'].map(k=>variableEntry(k,''))};
    state.creation.variableSets.push(set);
    if(p){p.variableSetIds=[set.id];p.variables=[];p.excludedSettingKeys=[];p.editingPresetId=set.id}
    createUI.tab='settings';save();closeModal();render();toast('已创建空白预设，可直接填写；原预设不受影响。');
  },'新预设从空白开始。填写后点击“更新当前预设”，或将设定另存为预设。');
}

function installWorkspaceUpgrade(){
  const oldEnsure=ensureStudioState;ensureStudioState=function(s=state){oldEnsure(s);workflowLibraryEnsure(s);return s};
  studioDefaults.visibility.extensions=false;
  window.matchMedia('(max-width: 759px)').addEventListener('change',()=>renderShell());
  const oldSave=save;save=function(...args){storeActiveWorkflow();return oldSave(...args)};
  const oldNavigate=navigate;navigate=function(index){
    if(Number(index)===3){flushEditor();ui.workspace=3;render();window.scrollTo({top:0,behavior:'instant'});return}
    return oldNavigate(index);
  };
  const oldRender=render;render=function(){
    if(ui.workspace===3){ensureStudioState();renderShell();$('#main').innerHTML='<div class="view">'+renderWorkflowLibrary()+'</div>';const crumb=$('.breadcrumb strong');if(crumb)crumb.textContent='工作流配置';applyStudioPreferences();return}
    oldRender();
    if(ui.workspace===5&&studioUI.settingsTab==='modules')$('#studio-settings-content')?.insertAdjacentHTML('afterbegin','<section class="settings-section"><h2>扩展功能模块</h2><label class="row"><input type="checkbox" id="ws-extensions" '+(state.settings.studio.visibility.extensions?'checked':'')+'>显示扩展功能（默认关闭，不影响已有作品）</label></section>');
    const p=selectedPlan();if(ui.workspace===1&&createUI.tab==='settings'&&p?.editingPresetId) $('.settings-preset-line')?.insertAdjacentHTML('beforeend',btn('更新当前预设','disk','ws-update-preset','','small'));
  };
  const oldPythonSettings=renderPythonSettings;renderPythonSettings=()=>oldPythonSettings()+dataLayoutHTML();
  renderCreationQueue=renderCompactQueue;
  const oldUpdate=updateQueueUI;updateQueueUI=function(){
    const open=new Set([...document.querySelectorAll('.queue-workflow-detail[open]')].map(x=>x.dataset.taskDetail));
    oldUpdate();
    document.querySelectorAll('.queue-workflow-detail').forEach(x=>x.open=open.has(x.dataset.taskDetail));
    if($('#queue-controls'))$('#queue-controls').innerHTML=queueControlsHTML();
  };
  const oldAction=handleAction;handleAction=async function(action,d={},el){
    if((action==='v3-settings-tab'&&d.tab==='mapping')||action==='import-workflow'||action==='v3-import-workflow'||action==='v3-import-mapping'||action==='ws-import'){
      if(action==='v3-settings-tab')return navigate(3);
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.multiple=true;input.onchange=()=>importWorkflowFiles([...input.files]).catch(e=>toast(e.message,'error'));input.click();return;
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
    if(action==='ws-export-all'){storeActiveWorkflow();const blob=new Blob([JSON.stringify({version:1,workflows:state.settings.comfy.presets},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='工作流库.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return}
    if(action==='ws-new-preset')return createBlankPreset();
    if(action==='ws-update-preset'){const p=selectedPlan(),set=setBy(p.editingPresetId);if(!set)throw Error('原预设已不存在。');set.entries=mergedSettingEntries(p).map(e=>({...clone(e),id:uid('var')}));set.updatedAt=Date.now();p.variables=[];save();render();toast('预设已更新。');return}
    if(action==='ws-enqueue-scene')return enqueueWorkspaceRange([ui.frameIndex]);
    if(action==='ws-enqueue-range'||action==='ws-generate-range'){const value=$('#ws-queue-range')?.value||'all';return enqueueWorkspaceRange(value==='all'?null:[Number(value)],action==='ws-generate-range')}
    if(action==='ws-edit-scene-workflow'){const p=selectedPlan(),f=currentTemplate()?.frames[ui.frameIndex],id=planFrameOverrides(p,f||{}).workflowId||p.workflowId||state.settings.comfy.activeWorkflowId;selectLibraryWorkflow(id);return navigate(3)}
    if(action==='art-apply-preset'){const p=selectedPlan(),id=$('#art-setting-preset')?.value;const result=await oldAction(action,d,el);if(p?.variableSetIds?.[0]===id){p.editingPresetId=id;save();render()}return result}
    return oldAction(action,d,el);
  };
  document.addEventListener('change',event=>{const el=event.target;try{
    if(el.id==='ws-library-select')selectLibraryWorkflow(el.value);
    if(el.id==='ws-extensions'){state.settings.studio.visibility.extensions=el.checked;save();render()}
    if(el.id==='ws-plan-workflow'){selectedPlan().workflowId=el.value;save()}
    if(el.id==='ws-scene-preset'||el.id==='ws-scene-workflow'){
      flushEditor();const p=selectedPlan(),f=currentTemplate().frames[ui.frameIndex];p.sceneOverrides[f.id]??={};const o=p.sceneOverrides[f.id];
      if(el.id==='ws-scene-preset')o.variableSetIds=el.value?[el.value]:[];else o.workflowId=el.value;
      save();render();
    }
    if(el.dataset.wsTask&&el.value){
      const q=state.queue.find(x=>x.id===el.dataset.wsTask),i=Number(el.dataset.wsIndex),pos=q?.indices.indexOf(i);
      if(!q||pos<q.done||pos<0||(['running','paused'].includes(q.status)&&pos===q.done))throw Error('此幕已经开始，不能修改正在执行的快照。');
      const execution=workflowExecutionFor({workflowId:el.value},{}),f=q.frames[i];
      buildMappedWorkflow(f,q.rowSnapshot,{execution,preview:true});f._execution=clone(execution);
      const b=bookBy(q.bookId);if(b?.sourceSnapshot?.frames[i])b.sourceSnapshot.frames[i]._execution=clone(execution);
      save();toast('待执行分镜的工作流快照已更新。');
    }
  }catch(e){toast(e.message,'error')}});
}

function dataLayoutHTML(){
  return `<section class="settings-section"><h2>数据目录与备份</h2><p>所有路径相对于程序目录。修改标题不会移动图片，画册 ID 保持稳定。</p><pre class="backend-code">data/
  workflows/library.json       工作流与映射库
  storyboards/templates.json   分镜模板
  storyboards/plans.json       画册计划与单幕覆盖
  presets/scene-presets.json   角色与画面预设
  presets/characters.json      角色矩阵
  albums/index.json            画册索引与历史快照
  queue/tasks.json             生成任务快照
  workspace/                  画册集与界面偏好
  settings/                   服务连接与模型配置
  conversations/              对话记录
  assets/images/albums/       按画册 ID 保存的原图
  cache/                      可重新获取的缓存</pre><details class="quiet-advanced"><summary>按画册名称查找图片目录</summary>${state.books.map(b=>`<div style="margin:14px 0"><strong>${esc(b.title)}</strong><br><code style="overflow-wrap:anywhere">data/assets/images/albums/${esc(b.id)}/</code></div>`).join('')}<p class="help">仅真实生成的 PNG/JPEG/WebP/GIF 自动拆分到此目录；内嵌图片保存在画册索引中。</p></details><p class="help">发现缺失或损坏时停止读取，不用空数据覆盖。服务运行时请通过界面编辑，不要同时手改文件。</p><div class="row wrap">${btn('导出完整图片目录 ZIP','download','disk-archive')}${btn('载入已解压目录','upload','disk-import-folder')}${btn('导出工程 JSON','disk','backup-export')}</div><p class="help">跨电脑迁移优先使用 ZIP（包含图片）。JSON 中的本地图片链接需要连同 data/assets/images/ 一起备份。直接复制 data/ 可能包含 API 密钥，请勿公开分享。完整说明见 docs/DATA_LAYOUT.md。</p></section>`;
}
