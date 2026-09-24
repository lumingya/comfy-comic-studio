/* One visible album owns the editor. Public presets are edited only in their library. */
'use strict';
function creationTask(){return null} // Source editor never binds itself to a generated version.
function selectCreationContext(value){
  const plan=planBy(value);if(!plan||plan.projectId!==state.activeProjectId)throw Error('请选择当前作品，不是历史生成快照。');
  commitSettingsGroupNames(currentBookSettings());flushEditor();createUI.planId=plan.id;createUI.liveTaskId=null;createUI.sceneScope='plan';ui.templateId=plan.templateId;ui.frameIndex=0;save();render();
}
function creationContextSelector(plan,titleLevel=false){
  return `<label class="creation-owner-select ${titleLevel?'title-owner-select':''}"><span class="${titleLevel?'visually-hidden':''}">当前画册</span><select id="art-book-draft" aria-label="当前画册">${projectPlans().map(p=>opt(p.id,p.title,plan.id)).join('')}</select></label>`;
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
    source.settingsContext={id:'book-settings:'+book.id,_bookSettingsOwner:book.id,taskId:q.id,projectId:book.projectId,title:book.title,variables,settingsGroups:clone(plan?.settingsGroups||[]),variableSetIds:[],excludedSettingKeys:[],sceneOverrides};
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
  return {...clone(plan),variables:clone(ctx.variables),settingsGroups:clone(settingsGroups(ctx)),variableSetIds:[],excludedSettingKeys:clone(ctx.excludedSettingKeys),sceneOverrides:clone(ctx.sceneOverrides),storyVersionId:'',title:bookBy(q.bookId).title,_creationTemplate:{...clone(templateBy(plan.templateId)),frames:clone(q.frames)}};
}
function presetLibraryHTML(){
  const selected=settingPresetSelection(),draft=selected?settingPresetDraft(selected):null;
  return `<div id="preset-library"><header class="preset-library-heading"><div><span class="context-kicker">公共预设库</span></div>${btn('新建预设','plus','ws-new-preset','','small')}</header><div class="preset-library-layout"><aside class="preset-library-index"><label for="art-setting-preset">选择公共预设</label><select id="art-setting-preset" aria-label="选择公共预设"><option value="">选择预设…</option>${projectVariableSets().map(s=>opt(s.id,s.title,selected)).join('')}</select><label class="preset-search-label" for="preset-search">搜索预设</label>${searchInput({id:'preset-search',placeholder:'输入预设名称…',label:'搜索预设'})}<div class="preset-library-list">${projectVariableSets().map(s=>`<button type="button" class="preset-library-item ${s.id===selected?'active':''}" data-act="preset-library-select" data-id="${esc(s.id)}"><span>${esc(s.title)}</span><small>${(s.entries||[]).length} 个变量${state.drafts?.presetEdits?.[s.id]?.dirty?' · 草稿待更新':''}</small></button>`).join('')}</div>${btn('导入','upload','native-import','data-kind="variables"','small ghost')}${btn('删除预设','trash','ws-delete-preset',selected?'':'disabled','small ghost')}</aside><section class="preset-library-editor">${draft?`<div class="preset-editor-heading"><div><span class="context-kicker">预设草稿</span><h3>${esc(draft.title)}</h3></div></div>${settingsToolbar(draft)}${renderSettingsGroups(draft)}`:'<div class="empty"><h3>选择一份预设</h3><p>查看或编辑预设。</p></div>'}</section></div><footer class="preset-library-footer"><span><small class="apply-kicker">复制预设到</small><strong>${esc(currentSettingsLabel()||'当前画册')}</strong></span>${btn('应用到当前画册','check','art-apply-preset',draft?'':'disabled','primary')}</footer></div>`;
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
      book.sourceSnapshot.settingsContext={id:'book-settings:'+book.id,_bookSettingsOwner:book.id,taskId:q.id,projectId:book.projectId,title:book.title,variables:clone(mergedSettingEntries(effective)),settingsGroups:clone(settingsGroups(effective)),variableSetIds:[],excludedSettingKeys:clone(effective.excludedSettingKeys||[]),sceneOverrides:scenes};
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
  liveStoryboardNotice=function(plan){const q=creationTask(plan);return q?'<p class="help">提示词、文字变量和参考图保存后供尚未发送的分镜读取。</p>':''};
  storyboardScopeHTML=function(){return ''};
  const oldAction=handleAction;handleAction=async function(action,d={},el){
    if(action==='preset-library-open')return openPresetLibrary();
    if(action==='preset-library-preview')return openPresetLibrary(d.id);
    if(action==='preset-library-select'){selectSettingPreset(d.id);return refreshPresetLibrary()}
    return oldAction(action,d,el);
  };
}
