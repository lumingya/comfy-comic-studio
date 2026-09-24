/* User-owned groups are document data. Expansion / editing state is session-only. */
'use strict';
const settingsGroupUI={open:new Set(),editing:new Map(),picked:new Set(),drag:null};
function settingsGroups(p){
  if(!Array.isArray(p.settingsGroups))p.settingsGroups=[];
  return p.settingsGroups;
}
function settingsGroupOptions(p,value=''){
  return opt('','不分组',value)+settingsGroups(p).map(g=>opt(g.id,g.title,value)).join('');
}
function settingsGroupTitle(p,id){return settingsGroups(p).find(g=>g.id===id)?.title||'不分组'}
/* Multi-select and drag state are session-only; tokens are owner-scoped so two editors never share a selection. */
function settingsPickToken(p,key){return p.id+'::'+key}
function settingsPickedKeys(p){const prefix=p.id+'::',keys=new Set(mergedSettingEntries(p).map(e=>e.key));return [...settingsGroupUI.picked].filter(t=>t.startsWith(prefix)).map(t=>t.slice(prefix.length)).filter(k=>keys.has(k))}
function clearSettingsSelection(p){for(const t of [...settingsGroupUI.picked])if(!p||t.startsWith(p.id+'::'))settingsGroupUI.picked.delete(t)}
function moveSettingEntries(p,keys,groupId){
  if(groupId&&!settingsGroups(p).some(g=>g.id===groupId))throw Error('分组已不存在。');
  const entries=mergedSettingEntries(p),wanted=new Set(keys);let moved=0;
  for(const e of entries){if(!wanted.has(e.key))continue;if((e.groupId||'')===(groupId||''))continue;if(groupId)e.groupId=groupId;else delete e.groupId;moved++}
  p.variables=entries;if(moved)settingsChanged(p);
  if(groupId)settingsGroupUI.open.add(settingsGroupToken(p,groupId));
  clearSettingsSelection(p);return moved;
}
function settingsMoveToast(p,moved,groupId){if(moved)toast(groupId?`已将 ${moved} 个变量移到「${settingsGroupTitle(p,groupId)}」。`:`已将 ${moved} 个变量移出分组。`)}
function settingsChanged(p){if(p._presetEditorId)p.dirty=true;save();}
function settingsGroupToken(p,id){return p.id+'::'+id}
function commitSettingsGroupNames(p){
  if(!p)return;const draft=settingsGroupUI.editing.get(p.id);if(!draft)return;
  const titles=settingsGroups(p).map(g=>(draft[g.id]??g.title).trim());
  if(titles.some(t=>!t))throw Error('分组名称不能为空。');
  if(new Set(titles).size!==titles.length)throw Error('分组名称不能重复。');
  settingsGroups(p).forEach((g,i)=>g.title=titles[i]);
  settingsGroupUI.editing.delete(p.id);settingsChanged(p);
}
function settingsToolbar(p){
  const editing=settingsGroupUI.editing.has(p.id);
  return `<div class="settings-form-toolbar"><div class="settings-toolbar-label">变量 <span>${mergedSettingEntries(p).length}</span></div><div class="settings-toolbar-actions" role="group" aria-label="设定操作">${p._presetEditorId?btn('更新预设','disk','ws-update-preset','','small'):''}${btn('新增变量','plus','art-setting-add','','small')}${btn('新建分组','plus','settings-group-new',`data-owner="${esc(p.id)}"`,'small ghost')}${btn(editing?'完成编辑':'编辑分组',editing?'check':'edit','settings-group-edit',`data-owner="${esc(p.id)}" aria-pressed="${editing}"`,'small ghost')}<span class="toolbar-divider" aria-hidden="true"></span>${btn('导入','upload','native-import','data-kind="variables" title="导入设定到公共预设库，再选择应用到本册"','small ghost')}${btn('导出','download','native-export-settings','','small ghost')}${btn('存为公共预设','box','art-save-preset','','small ghost')}</div></div>`;
}
/* Attributes are a flat list by default. Groups are optional folders the creator adds; ungrouped cards simply stay in the flat area below them (no synthetic "未分组" folder). Every group section and the flat area are drop targets. */
function renderSettingsGroups(p){
  const entries=mergedSettingEntries(p),groups=settingsGroups(p),ids=new Set(groups.map(g=>g.id)),edit=settingsGroupUI.editing.get(p.id),picked=settingsPickedKeys(p);
  const loose=entries.filter(e=>!ids.has(e.groupId));
  const sections=groups.map(g=>{
    const members=entries.filter(e=>e.groupId===g.id),open=settingsGroupUI.open.has(settingsGroupToken(p,g.id)),token='group-body-'+p.id+'-'+g.id;
    return `<section class="setting-group ${open?'is-open':''}" data-group-id="${esc(g.id)}" data-drop-group="${esc(g.id)}" data-drop-owner="${esc(p.id)}"><header class="setting-group-heading"><button type="button" class="group-toggle" data-act="settings-group-toggle" data-owner="${esc(p.id)}" data-id="${esc(g.id)}" aria-expanded="${open}" aria-controls="${esc(token)}" aria-label="${open?'折叠':'展开'}${esc(g.title)}"><span class="group-chevron" aria-hidden="true">›</span></button>${edit?`<input class="group-title-input" data-group-name="${esc(g.id)}" data-owner="${esc(p.id)}" aria-label="分组名称" value="${esc(edit[g.id]??g.title)}" maxlength="60">`:`<button type="button" class="group-title" data-act="settings-group-toggle" data-owner="${esc(p.id)}" data-id="${esc(g.id)}" aria-expanded="${open}" aria-controls="${esc(token)}">${esc(g.title)}</button>`}<span class="setting-count">${members.length} 个变量</span>${edit?ibtn('trash','settings-group-delete','删除分组，变量回到平铺列表',`data-owner="${esc(p.id)}" data-id="${esc(g.id)}"`):btn('添加变量','plus','settings-group-add-attribute',`data-owner="${esc(p.id)}" data-id="${esc(g.id)}"`,'small ghost group-add')}</header><div id="${esc(token)}" class="group-content setting-cards" ${open?'':'hidden'}>${members.length?`<div class="character-settings-grid">${renderSettingCards(p,members)}</div>`:'<p class="group-empty">这一组还是空的。把下方的变量拖进来，或点击「添加变量」。</p>'}</div></section>`;
  }).join('');
  const selection=picked.length?`<div class="setting-selection-bar" role="toolbar" aria-label="已选变量操作"><strong>已选 ${picked.length} 项</strong><label class="setting-selection-target"><span>移到</span><select data-pick-target="${esc(p.id)}" aria-label="目标分组">${settingsGroupOptions(p,'')}</select></label>${btn('移动','check','settings-pick-move',`data-owner="${esc(p.id)}"`,'small')}${btn('取消选择','','settings-pick-clear',`data-owner="${esc(p.id)}"`,'small ghost')}<span class="setting-selection-hint">也可以直接把选中的卡片拖进分组。</span></div>`:'';
  const looseBody=loose.length?`${groups.length?'<p class="setting-loose-hint">未归入分组的变量 · 用卡片左侧的把手拖到上方分组即可归类</p>':''}<div class="character-settings-grid">${renderSettingCards(p,loose)}</div>`:groups.length?'<p class="group-empty setting-loose-empty">所有变量都已归入分组。把卡片拖到这里可以移出分组。</p>':'<p class="group-empty">还没有变量。点击「新增变量」开始定义画面。</p>';
  return `<div class="settings-groups ${edit?'is-editing':''} ${picked.length?'has-picked':''}">${selection}${sections}<div class="setting-loose setting-cards" data-drop-group="" data-drop-owner="${esc(p.id)}">${looseBody}</div></div>`;
}
function openSettingMetadata(owner,key){
  const p=settingsTargetById(owner),entry=p&&mergedSettingEntries(p).find(e=>e.key===key);if(!entry)throw Error('变量已不存在。');
  rt.settingMetadata={owner,key};
  const references=countVariableReferences(key);
  modal('编辑变量',`${field('显示名称',input('label',entry.label||settingLabel(entry),'text','id="setting-meta-label" maxlength="80"'))}${field('变量标识符',input('key',key,'text','id="setting-meta-key" maxlength="60" spellcheck="false" autocomplete="off" placeholder="例如：weapon"'))}<p class="help">提示词与台词里用 <code>{${esc(key)}}</code> 引用这个变量；只能包含中英文字母、数字和下划线。</p><label class="row setting-meta-rewrite"><input type="checkbox" id="setting-meta-rewrite" checked><span>改名时同步替换本画册集分镜里的 <code>{${esc(key)}}</code> 引用${references?`（${references} 处）`:''}</span></label>${field('归属分组',`<select id="setting-meta-group">${settingsGroupOptions(p,entry.groupId)}</select>`)}<div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('保存修改','check','settings-meta-save','','primary')}</div>`);
}
/* A rename only touches single-brace tokens of the exact key; {{weights}}, escaped braces and other keys stay byte-identical. */
function variableTokenPattern(key){return new RegExp('(?<![{\\\\])\\{'+key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\}(?!\\})','gu')}
function variableReferenceTargets(){
  const texts=[];
  for(const t of projectTemplates())for(const f of t.frames||[])for(const fieldName of ['prompt','negative','caption'])texts.push({doc:t,obj:f,field:fieldName});
  const plans=typeof projectPlans==='function'?projectPlans():state.creation?.plans||[];
  for(const plan of plans){
    for(const override of Object.values(plan.sceneOverrides||{})){
      if(!override||typeof override!=='object')continue;
      for(const fieldName of ['prompt','negative','caption'])if(fieldName in override)texts.push({doc:plan,obj:override,field:fieldName});
    }
  }
  for(const r of state.rows||[]){
    for(const versions of Object.values(r.storyVersions||{})){
      for(const v of versions||[]){
        if(v?.captions&&typeof v.captions==='object'){
          for(const frameId of Object.keys(v.captions)){
            texts.push({doc:v,obj:v.captions,field:frameId});
          }
        }
      }
    }
  }
  return texts;
}
function countVariableReferences(key){const pattern=variableTokenPattern(key);let n=0;for(const {obj,field:fieldName} of variableReferenceTargets())n+=(String(obj[fieldName]||'').match(pattern)||[]).length;return n}
function renameVariableReferences(oldKey,newKey){
  const pattern=variableTokenPattern(oldKey),touched=new Set();let n=0;
  for(const {doc,obj,field:fieldName} of variableReferenceTargets()){const before=String(obj[fieldName]||'');if(!pattern.test(before)){pattern.lastIndex=0;continue}pattern.lastIndex=0;obj[fieldName]=before.replace(pattern,()=>{n++;return '{'+newKey+'}'});touched.add(doc)}
  for(const doc of touched)doc.updatedAt=Date.now();
  return n;
}
function renameSettingKey(p,entries,entry,newKey,rewrite){
  const oldKey=entry.key;checkVariableKey(newKey);
  if(entries.some(e=>e!==entry&&e.key===newKey))throw Error('已有同名变量，请换一个标识符。');
  entry.key=newKey;
  const inheritedFromSets=Array.isArray(p.variableSetIds)&&p.variableSetIds.some(id=>setBy(id)?.entries?.some(e=>e.key===oldKey));
  if(inheritedFromSets){
    p.excludedSettingKeys=[...(p.excludedSettingKeys||[]).filter(k=>k!==newKey),oldKey];
  }else{
    p.excludedSettingKeys=(p.excludedSettingKeys||[]).filter(k=>k!==oldKey&&k!==newKey);
  }
  for(const override of Object.values(p.sceneOverrides||{}))for(const e of override?.variables||[])if(e.key===oldKey)e.key=newKey;
  for(const b of p.bindings||[])if(b.source==='variable'&&String(b.value||'').replace(/^\{|\}$/g,'')===oldKey)b.value=newKey;
  return rewrite?renameVariableReferences(oldKey,newKey):0;
}
function settingsDragPayload(el){
  const p=settingsTargetById(el.dataset.dragOwner);if(!p)return null;
  const picked=settingsPickedKeys(p),keys=picked.includes(el.dataset.dragKey)?picked:[el.dataset.dragKey];
  return {owner:p.id,keys};
}
function settingsDropTarget(event){
  const zone=event.target.closest?.('[data-drop-group]');const drag=settingsGroupUI.drag;
  return zone&&drag&&zone.dataset.dropOwner===drag.owner?zone:null;
}
function installSettingsWorkbench(){
  document.addEventListener('input',event=>{
    const el=event.target;if(el.dataset.groupName){const draft=settingsGroupUI.editing.get(el.dataset.owner);if(draft)draft[el.dataset.groupName]=el.value;}
  });
  document.addEventListener('change',event=>{
    const el=event.target;if(!el.classList?.contains('setting-pick'))return;
    const p=settingsTargetById(el.dataset.pickOwner);if(!p)return;const token=settingsPickToken(p,el.dataset.pickKey);
    el.checked?settingsGroupUI.picked.add(token):settingsGroupUI.picked.delete(token);
    render();document.querySelector(`.setting-pick[data-pick-owner="${CSS.escape(p.id)}"][data-pick-key="${CSS.escape(el.dataset.pickKey)}"]`)?.focus({preventScroll:true});
  });
  /* HTML5 drag & drop: the handle carries the card (or the whole selection when the card is picked); drop zones are group sections and the flat area. */
  document.addEventListener('dragstart',event=>{
    const handle=event.target.closest?.('.setting-drag-handle');if(!handle)return;
    const payload=settingsDragPayload(handle);if(!payload){event.preventDefault();return}
    settingsGroupUI.drag=payload;try{event.dataTransfer.setData('text/plain',payload.keys.join(','));event.dataTransfer.effectAllowed='move'}catch(e){}
    for(const key of payload.keys)document.querySelector(`.character-setting[data-setting-key="${CSS.escape(key)}"][data-setting-owner="${CSS.escape(payload.owner)}"]`)?.classList.add('is-dragging');
    document.querySelector('.settings-groups')?.classList.add('is-drag-active');
  });
  document.addEventListener('dragover',event=>{const zone=settingsDropTarget(event);if(!zone)return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';if(!zone.classList.contains('is-drop-target')){document.querySelectorAll('.is-drop-target').forEach(x=>x.classList.remove('is-drop-target'));zone.classList.add('is-drop-target')}});
  document.addEventListener('dragleave',event=>{const zone=event.target.closest?.('[data-drop-group]');if(zone&&!zone.contains(event.relatedTarget))zone.classList.remove('is-drop-target')});
  document.addEventListener('drop',event=>{
    const zone=settingsDropTarget(event);const drag=settingsGroupUI.drag;if(!zone||!drag)return;event.preventDefault();settingsGroupUI.drag=null;
    try{const p=settingsTargetById(drag.owner);if(!p)return;const moved=moveSettingEntries(p,drag.keys,zone.dataset.dropGroup||'');render();settingsMoveToast(p,moved,zone.dataset.dropGroup||'')}catch(e){toast(e.message,'error')}
  });
  document.addEventListener('dragend',()=>{settingsGroupUI.drag=null;document.querySelectorAll('.is-dragging,.is-drop-target,.is-drag-active').forEach(x=>x.classList.remove('is-dragging','is-drop-target','is-drag-active'))});
  Object.assign(v3Actions,{
    'settings-group-toggle':d=>{const p=settingsTargetById(d.owner);if(!p)return;const token=settingsGroupToken(p,d.id);settingsGroupUI.open.has(token)?settingsGroupUI.open.delete(token):settingsGroupUI.open.add(token);render();document.querySelector(`.group-toggle[data-owner="${CSS.escape(p.id)}"][data-id="${CSS.escape(d.id)}"]`)?.focus({preventScroll:true});},
    'settings-group-edit':d=>{const p=settingsTargetById(d.owner);if(!p)return;if(settingsGroupUI.editing.has(p.id))commitSettingsGroupNames(p);else settingsGroupUI.editing.set(p.id,Object.fromEntries(settingsGroups(p).map(g=>[g.id,g.title])));render();},
    'settings-group-new':d=>{
      const p=settingsTargetById(d.owner);if(!p)return;
      textModal('新建分组','分组名称','',name=>{
        if(settingsTargetById(p.id)!==p)throw Error('编辑对象已变化，请重新操作。');
        if(settingsGroups(p).length>=128)throw Error('最多支持 128 个分组。');const title=name.trim();if(!title)throw Error('请输入分组名称。');if(title.length>60)throw Error('分组名称最多 60 字。');
        if(settingsGroups(p).some(g=>g.title===title))throw Error('已有同名分组。');
        const g={id:uid('group'),title};p.settingsGroups.push(g);
        const draft=settingsGroupUI.editing.get(p.id);if(draft)draft[g.id]=title;
        settingsChanged(p);closeModal();render();if(p._presetEditorId)openPresetLibrary(p._presetEditorId);
      });
    },
    'settings-group-delete':async d=>{
      const p=settingsTargetById(d.owner),g=p&&settingsGroups(p).find(x=>x.id===d.id);if(!g)return;
      if(!await confirmAction('删除分组「'+g.title+'」？','组内变量会回到平铺列表。','删除分组'))return;
      if(settingsTargetById(p.id)!==p)throw Error('编辑对象已变化。');
      p.settingsGroups=p.settingsGroups.filter(x=>x.id!==g.id);
      p.variables=mergedSettingEntries(p).map(e=>{if(e.groupId===g.id)delete e.groupId;return e;});
      settingsGroupUI.open.delete(settingsGroupToken(p,g.id));settingsChanged(p);render();
    },
    'settings-group-add-attribute':d=>{const p=settingsTargetById(d.owner);if(!p)return;addUnifiedSetting(d.id);},
    'settings-pick-move':d=>{const p=settingsTargetById(d.owner);if(!p)return;const groupId=document.querySelector(`[data-pick-target="${CSS.escape(p.id)}"]`)?.value||'',keys=settingsPickedKeys(p);if(!keys.length)throw Error('请先勾选要移动的变量。');const moved=moveSettingEntries(p,keys,groupId);render();settingsMoveToast(p,moved,groupId)},
    'settings-pick-clear':d=>{const p=settingsTargetById(d.owner);clearSettingsSelection(p||null);render()},
    'settings-meta-edit':d=>openSettingMetadata(d.owner,d.key),
    'settings-meta-save':()=>{
      const {owner,key}=rt.settingMetadata||{},p=settingsTargetById(owner);if(!p)throw Error('编辑对象已变化。');
      const groupId=$('#setting-meta-group').value,label=$('#setting-meta-label').value.trim(),newKey=($('#setting-meta-key')?.value??key).trim(),rewrite=!!$('#setting-meta-rewrite')?.checked;
      if(!label)throw Error('显示名称不能为空。');
      if(groupId&&!settingsGroups(p).some(g=>g.id===groupId))throw Error('分组已不存在。');
      const entries=mergedSettingEntries(p),entry=entries.find(e=>e.key===key);if(!entry)throw Error('变量已不存在。');
      const renamed=newKey!==key?renameSettingKey(p,entries,entry,newKey,rewrite):0;
      Object.assign(entry,{label,groupId});p.variables=entries;settingsChanged(p);closeModal();render();if(p._presetEditorId)openPresetLibrary(p._presetEditorId);
      if(newKey!==key)toast(renamed?`已将 {${key}} 改为 {${newKey}}，并更新了 ${renamed} 处分镜引用。`:`已将 {${key}} 改为 {${newKey}}${rewrite?'':'；分镜中的旧引用需要手动改写'}。`);
    }
  });
}
