/* One visible album owns the editor. Public presets are edited only in their library. */
'use strict';
function creationTask(plan=selectedPlan()){
  if(!plan)return null;
  const saved=state.drafts?.creationTargets;
  const explicit=saved&&Object.hasOwn(saved,plan.id)?saved[plan.id]:undefined;
  const id=explicit!==undefined?explicit:createUI.liveTaskId;
  const valid=q=>q.planId===plan.id&&bookBy(q.bookId)&&q.status!=='archived';
  if(explicit!==undefined)return explicit?state.queue.find(q=>q.id===explicit&&valid(q))||null:null;
  return state.queue.find(q=>q.id===id&&valid(q))||state.queue.filter(q=>valid(q)&&q.done<q.indices.length).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0]||null;
}
function selectCreationContext(value){
  const task=value.startsWith('task:')?state.queue.find(q=>q.id===value.slice(5)):null;
  const plan=planBy(task?.planId||value);if(!plan||plan.projectId!==state.activeProjectId)throw Error('画册已不在当前画册集。');
  flushEditor();createUI.planId=plan.id;createUI.liveTaskId=task?.id||null;createUI.sceneScope='plan';ui.templateId=plan.templateId;ui.frameIndex=0;
  state.drafts??={};state.drafts.creationTargets??={};state.drafts.creationTargets[plan.id]=task?.id||'';save();render();
}
function creationContextSelector(plan){
  const q=creationTask(plan),value=q?'task:'+q.id:plan.id;
  const tasks=state.queue.filter(x=>planBy(x.planId)?.projectId===state.activeProjectId&&bookBy(x.bookId));
  return `<label class="creation-owner-select"><span>当前画册</span><select id="art-book-draft" aria-label="当前画册">${projectPlans().map(p=>opt(p.id,p.title+' · 草稿',value)).join('')}${tasks.length?'<optgroup label="画册版本">'+tasks.map(x=>opt('task:'+x.id,bookBy(x.bookId).title+' · '+(x.done>=x.indices.length?'已完成':['pending','running'].includes(x.status)?'制作中':'待继续')+' · '+new Date(x.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}),value)).join('')+'</optgroup>':''}</select></label>`;
}
function sameSettingValue(a,b){return JSON.stringify(a,(k,v)=>typeof v==='string'&&v.startsWith('/images/')?v.split('/').at(-1):v)===JSON.stringify(b,(k,v)=>typeof v==='string'&&v.startsWith('/images/')?v.split('/').at(-1):v)}
function entriesFromScope(values){return Object.entries(values||{}).map(([key,value])=>({id:uid('var'),key,type:isImageVariable(value)?'image':typeof value==='number'?'number':typeof value==='boolean'?'boolean':value&&typeof value==='object'?'json':'text',value:clone(value)}))}
function bookSettingsContext(q,plan=planBy(q?.planId)){
  const book=bookBy(q?.bookId);if(!book||book._lazy||!book.sourceSnapshot)return null;
  const source=book.sourceSnapshot;
  if(!source.settingsContext){
    const global=clone(source.row?._scope||q.rowSnapshot?._scope||{}),variables=entriesFromScope(global),sceneOverrides={};
    for(const f of source.frames||q.frames){
      const own=entriesFromScope(Object.fromEntries(Object.entries(f._scope||{}).filter(([k,v])=>!sameSettingValue(global[k],v))));
      // Retain explicit scene overrides where their saved values still match this task snapshot.
      const prior=plan?.sceneOverrides?.[f.id];for(const e of [...(prior?.variableSetIds||[]).flatMap(id=>setBy(id)?.entries||[]),...(prior?.variables||[])])if(sameSettingValue(typedVariableValue(e),f._scope?.[e.key])&&!own.some(x=>x.key===e.key))own.push(clone(e));
      if(own.length)sceneOverrides[f.id]={variables:own,variableSetIds:[]};
    }
    source.settingsContext={id:'book-settings:'+book.id,_bookSettingsOwner:book.id,taskId:q.id,projectId:book.projectId,title:book.title,variables,variableSetIds:[],excludedSettingKeys:[],sceneOverrides};
  }
  source.settingsContext.title=book.title;return source.settingsContext;
}
function currentBookSettings(){const p=selectedPlan(),q=creationTask(p);return q?bookSettingsContext(q,p):p}
function currentSettingsLabel(){const q=creationTask();return q?bookBy(q.bookId)?.title:selectedPlan()?.title}
function presetLibraryIsOpen(){return !!$('#modal[open] #preset-library')}
function refreshSettingsSaveStatus(){for(const el of document.querySelectorAll('[data-settings-save-status]')){el.textContent=backendRuntime.error?'保存未确认':backendRuntime.saving?'正在保存…':backendRuntime.dirty?'有修改待保存':'已保存';el.dataset.state=backendRuntime.error?'error':backendRuntime.dirty?'pending':'saved'}}
function settingsContextSignature(ctx){return JSON.stringify({variables:ctx.variables,excluded:ctx.excludedSettingKeys,scenes:ctx.sceneOverrides},(k,v)=>typeof v==='string'&&v.startsWith('/images/')?v.split('/').at(-1):v)}
function compileBookFrameInput(q,frame,index,ctx){
  const fresh=clone(frame);fresh._scope=effectivePlanScope(ctx,frame).values;
  delete fresh._imageInputs;delete fresh._resolvedImagePrompt;delete fresh._resolvedImageNegative;
  const resolved=resolveImageVariables(fresh.prompt,fresh._scope,true,fresh.negative||fresh._execution?.globalNegative||'');
  return {input:foundationFrameInput(fresh,q.rowSnapshot||bookBy(q.bookId).sourceSnapshot.row,q.bookId,index),imageKeys:resolved.images.map(x=>x.key)};
}
function syncBookSettingsInputs(forceTask=null){
  for(const q of state.queue){
    const b=bookBy(q.bookId),ctx=b?.sourceSnapshot?.settingsContext;if(!ctx||ctx.taskId!==q.id||b._lazy)continue;
    const signature=settingsContextSignature(ctx);if(q!==forceTask&&ctx.compiledSignature===signature)continue;
    const source=b.sourceSnapshot;source.liveInputs??={};const now=Date.now();
    for(const i of q.indices){
      const frame=q.frames[i];if(!frame||b.steps.some(s=>s.stepIndex===i&&s.image))continue;
      const before=source.liveInputs[i]||{};
      try{source.liveInputs[i]={...compileBookFrameInput(q,frame,i,ctx),savedAt:now,settingsSavedAt:now,textSavedAt:before.textSavedAt||before.savedAt||0,initialImageKeys:before.initialImageKeys||resolveImageVariables(frame.prompt,frame._scope||{},false,frame.negative||'').images.map(x=>x.key)}}
      catch(error){source.liveInputs[i]={error:error.message,savedAt:now,settingsSavedAt:now,textSavedAt:before.textSavedAt||before.savedAt||0}}
    }
    ctx.compiledSignature=signature;b.updatedAt=now;
  }
}
function generationContextPlan(plan){
  const q=plan?.id===selectedPlan()?.id?creationTask(plan):null,ctx=q&&bookSettingsContext(q,plan);
  if(!ctx)return plan;
  return {...clone(plan),variables:clone(ctx.variables),variableSetIds:[],excludedSettingKeys:clone(ctx.excludedSettingKeys),sceneOverrides:clone(ctx.sceneOverrides),storyVersionId:'',title:bookBy(q.bookId).title,_creationTemplate:{...clone(templateBy(plan.templateId)),frames:clone(q.frames)}};
}
function presetLibraryHTML(){
  const selected=settingPresetSelection(),draft=selected?settingPresetDraft(selected):null;
  return `<div id="preset-library"><header class="preset-library-heading"><div><span class="context-kicker">公共预设库</span><p>这里管理可复用的设定。编辑草稿不会自动改变任何画册。</p></div>${btn('新建预设','plus','ws-new-preset','','small')}</header><div class="preset-library-layout"><aside class="preset-library-index"><label for="art-setting-preset">选择公共预设</label><select id="art-setting-preset" aria-label="选择公共预设"><option value="">选择预设…</option>${projectVariableSets().map(s=>opt(s.id,s.title,selected)).join('')}</select><label class="preset-search-label" for="preset-search">搜索预设</label><input id="preset-search" type="search" placeholder="输入预设名称…" autocomplete="off"><div class="preset-library-list">${projectVariableSets().map(s=>`<button type="button" class="preset-library-item ${s.id===selected?'active':''}" data-act="preset-library-select" data-id="${esc(s.id)}"><span>${esc(s.title)}</span><small>${(s.entries||[]).length} 个属性${state.drafts?.presetEdits?.[s.id]?.dirty?' · 草稿待更新':''}</small></button>`).join('')}</div>${btn('导入','upload','native-import','data-kind="variables"','small ghost')}${btn('删除预设','trash','ws-delete-preset',selected?'':'disabled','small ghost')}</aside><section class="preset-library-editor">${draft?`<div class="preset-editor-heading"><div><span class="context-kicker">预设草稿 · 不直接生效</span><h3>${esc(draft.title)}</h3></div>${btn('新增属性','plus','art-setting-add','','small')}</div><div class="preset-edit-notice">${icon('shield')} 正在编辑公共预设草稿，不会改变本册。更新预设与应用到画册是两个独立操作。</div>${renderSettingsGroups(draft)}<div class="preset-library-actions">${btn('更新此预设','disk','ws-update-preset','','small')}${btn('另存为','copy','art-save-preset','','small ghost')}${btn('导出','download','native-export-settings','','small ghost')}</div>`:'<div class="empty"><h3>选择一份预设</h3><p>查看或编辑公共库，不改变当前画册。</p></div>'}</section></div><footer class="preset-library-footer"><span><small class="apply-kicker">复制预设到</small><strong>${esc(currentSettingsLabel()||'当前画册')}</strong></span>${btn('应用到当前画册','check','art-apply-preset',draft?'':'disabled','primary')}</footer></div>`;
}
function openPresetLibrary(id){
  if(id)selectSettingPreset(id);
  modal('预设库',presetLibraryHTML(),'与当前画册分开管理；只有“应用”会把内容复制到画册。',true);
}
function refreshPresetLibrary(){if(presetLibraryIsOpen())$('#modal-body').innerHTML=presetLibraryHTML()}
function installCreativeContext(){
  document.addEventListener('input',event=>{
    if(event.target.id!=='preset-search')return;
    const query=event.target.value.trim().toLocaleLowerCase();
    for(const item of document.querySelectorAll('.preset-library-item'))item.hidden=!item.textContent.toLocaleLowerCase().includes(query);
    const list=document.querySelector('.preset-library-list');
    let empty=list.querySelector('.preset-search-empty');
    if(!empty){empty=document.createElement('p');empty.className='help preset-search-empty';empty.textContent='没有匹配的预设，试试其他关键词。';list.append(empty)}
    empty.hidden=!!list.querySelector('.preset-library-item:not([hidden])');
  });
  const oldModal=modal;modal=function(title,body,...args){if(presetLibraryIsOpen()&&!body.includes('id="preset-library"'))rt.presetReturn={id:settingPresetSelection(),projectId:state.activeProjectId};return oldModal(title,body,...args)};
  const oldClose=closeModal;closeModal=function(){const back=rt.presetReturn;rt.presetReturn=null;oldClose();if(back)queueMicrotask(()=>{if(!$('#modal').open&&back.projectId===state.activeProjectId&&setBy(back.id))openPresetLibrary(back.id)})};
  const oldTarget=settingsTargetById;settingsTargetById=function(id){if(id?.startsWith('book-settings:')){const b=bookBy(id.slice(14));return b?.projectId===state.activeProjectId?b.sourceSnapshot?.settingsContext:null}return oldTarget(id)};
  settingsEditorTarget=function(){return presetLibraryIsOpen()?(settingPresetSelection()?settingPresetDraft(settingPresetSelection()):null):currentBookSettings()};
  liveStoryboardTask=creationTask;
  const oldStatus=renderStatus;renderStatus=function(...args){const result=oldStatus(...args);refreshSettingsSaveStatus();return result};
  const oldRender=render;render=function(...args){const result=oldRender(...args);refreshPresetLibrary();refreshSettingsSaveStatus();return result};
  const oldCreation=renderQuietCreation;renderQuietCreation=function(){
    const p=selectedPlan(),q=creationTask(p),b=bookBy(q?.bookId);
    if(b?._lazy){if(!rt.contextLoading){rt.contextLoading=b.id;globalThis.Mio.fileLibrary.hydrate(b.id).then(()=>{rt.contextLoading=null;render()}).catch(e=>{rt.contextLoading=null;toast(e.message,'error')})}return '<div class="empty"><h2>正在读取当前画册…</h2><p>只读取这本画册，不以其他画册或预设代替。</p></div>'}
    if(q)bookSettingsContext(q,p);
    return oldCreation();
  };
  const oldEnqueue=enqueuePlanSnapshot;enqueuePlanSnapshot=function(plan,existing=null,indices=null){
    const effective=plan,book=oldEnqueue(effective,existing,indices),q=state.queue.filter(x=>x.bookId===book.id).at(-1);
    if(q&&!book.sourceSnapshot.settingsContext){
      const scenes={};for(const f of q.frames){const o=effective.sceneOverrides?.[f.id];if(o)scenes[f.id]={variables:clone([...new Map([...(o.variableSetIds||[]).flatMap(id=>setBy(id)?.entries||[]),...(o.variables||[])].map(e=>[e.key,e])).values()]),variableSetIds:[]}}
      book.sourceSnapshot.settingsContext={id:'book-settings:'+book.id,_bookSettingsOwner:book.id,taskId:q.id,projectId:book.projectId,title:book.title,variables:clone(mergedSettingEntries(effective)),variableSetIds:[],excludedSettingKeys:clone(effective.excludedSettingKeys||[]),sceneOverrides:scenes};
    }
    if(q&&book.sourceSnapshot.settingsContext)book.sourceSnapshot.settingsContext.taskId=q.id;
    state.drafts??={};state.drafts.creationTargets??={};state.drafts.creationTargets[plan.id]=q?.id||'';syncBookSettingsInputs(q);save();return book;
  };
  saveLiveStoryboardFrame=function(plan,frame){
    const q=creationTask(plan);if(!q)return;const i=q.frames.findIndex(f=>f.id===frame.id);if(i<0)return;
    const source=bookBy(q.bookId).sourceSnapshot,ctx=bookSettingsContext(q,plan),now=Date.now();source.frames[i]=clone(frame);source.liveInputs??={};
    try{source.liveInputs[i]={...compileBookFrameInput(q,frame,i,ctx),savedAt:now,textSavedAt:now,settingsSavedAt:now}}
    catch(e){source.liveInputs[i]={error:e.message,savedAt:now,textSavedAt:now}}
  };
  liveStoryboardNotice=function(plan){const q=creationTask(plan);return q?'<p class="help">提示词、文字变量和参考图统一在保存后供尚未发送的分镜读取。已经发出的请求与已完成图片不变。</p>':''};
  storyboardScopeHTML=function(p,t,own){return `<div class="storyboard-context"><span class="context-kicker">${own?'当前画册分镜':'公共分镜模板'}</span>${liveStoryboardNotice(p)}<details><summary>编辑公共模板</summary><select id="v3-scene-scope">${opt('plan','返回当前画册',own?'plan':'shared')}${opt('shared','编辑公共分镜模板（不改变制作中的画册）',own?'plan':'shared')}</select></details></div>`};
  const oldAction=handleAction;handleAction=async function(action,d={},el){
    if(action==='preset-library-open')return openPresetLibrary();
    if(action==='preset-library-preview')return openPresetLibrary(d.id);
    if(action==='preset-library-select'){selectSettingPreset(d.id);return refreshPresetLibrary()}
    return oldAction(action,d,el);
  };
}
