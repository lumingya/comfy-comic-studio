/* User-owned groups are document data. Expansion / editing state is session-only. */
'use strict';
const settingsGroupUI={open:new Set(),editing:new Map()};
function settingsGroups(p){
  if(!Array.isArray(p.settingsGroups))p.settingsGroups=[];
  return p.settingsGroups;
}
function settingsGroupOptions(p,value=''){
  return opt('','未分组',value)+settingsGroups(p).map(g=>opt(g.id,g.title,value)).join('');
}
function settingsGroupTitle(p,id){return settingsGroups(p).find(g=>g.id===id)?.title||'未分组'}
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
  return `<div class="settings-form-toolbar"><div class="settings-toolbar-label">画面属性 <span>${mergedSettingEntries(p).length}</span></div><div class="settings-toolbar-actions" role="group" aria-label="设定操作">${p._presetEditorId?btn('更新预设','disk','ws-update-preset','','small'):''}${btn('新增属性','plus','art-setting-add','','small')}${btn('新建分组','plus','settings-group-new',`data-owner="${esc(p.id)}"`,'small ghost')}${btn(editing?'完成编辑':'编辑分组',editing?'check':'edit','settings-group-edit',`data-owner="${esc(p.id)}" aria-pressed="${editing}"`,'small ghost')}<span class="toolbar-divider" aria-hidden="true"></span>${btn('导入','upload','native-import','data-kind="variables" title="导入设定到公共预设库，再选择应用到本册"','small ghost')}${btn('导出','download','native-export-settings','','small ghost')}${btn('存为公共预设','box','art-save-preset','','small ghost')}</div></div>`;
}
function renderSettingsGroups(p){
  const entries=mergedSettingEntries(p),groups=settingsGroups(p),ids=new Set(groups.map(g=>g.id)),edit=settingsGroupUI.editing.get(p.id);
  const ungrouped=entries.filter(e=>!ids.has(e.groupId));
  const sections=groups.map(g=>({...g,entries:entries.filter(e=>e.groupId===g.id)}));
  if(ungrouped.length||!groups.length)sections.push({id:'',title:'未分组',entries:ungrouped});
  return `<div class="settings-groups ${edit?'is-editing':''}">${sections.map(g=>{
    const open=settingsGroupUI.open.has(settingsGroupToken(p,g.id)),token='group-body-'+p.id+'-'+(g.id||'ungrouped');
    return `<section class="setting-group ${open?'is-open':''}" data-group-id="${esc(g.id)}"><header class="setting-group-heading"><button type="button" class="group-toggle" data-act="settings-group-toggle" data-owner="${esc(p.id)}" data-id="${esc(g.id)}" aria-expanded="${open}" aria-controls="${esc(token)}" aria-label="${open?'折叠':'展开'}${esc(g.title)}"><span class="group-chevron" aria-hidden="true">›</span></button>${edit&&g.id?`<input class="group-title-input" data-group-name="${esc(g.id)}" data-owner="${esc(p.id)}" aria-label="分组名称" value="${esc(edit[g.id]??g.title)}" maxlength="60">`:`<button type="button" class="group-title" data-act="settings-group-toggle" data-owner="${esc(p.id)}" data-id="${esc(g.id)}" aria-expanded="${open}" aria-controls="${esc(token)}">${esc(g.title)}</button>`}<span class="setting-count">${g.entries.length} 项属性</span>${edit&&g.id?ibtn('trash','settings-group-delete','删除分组，属性将移至未分组',`data-owner="${esc(p.id)}" data-id="${esc(g.id)}"`):btn('添加属性','plus','settings-group-add-attribute',`data-owner="${esc(p.id)}" data-id="${esc(g.id)}"`,'small ghost group-add')}</header><div id="${esc(token)}" class="group-content" ${open?'':'hidden'}>${g.entries.length?`<div class="character-settings-grid">${renderSettingCards(p,g.entries)}</div>`:'<p class="group-empty">这里留给新的想法。添加一个属性，开始定义这一组。</p>'}</div></section>`;
  }).join('')}</div>`;
}
function openSettingMetadata(owner,key){
  const p=settingsTargetById(owner),entry=p&&mergedSettingEntries(p).find(e=>e.key===key);if(!entry)throw Error('属性已不存在。');
  rt.settingMetadata={owner,key};
  modal('编辑属性',`${field('显示名称',input('label',entry.label||settingLabel(entry),'text','id="setting-meta-label" maxlength="80"'))}${field('归属分组',`<select id="setting-meta-group">${settingsGroupOptions(p,entry.groupId)}</select>`)}<p class="help">变量标识 <code>{${esc(key)}}</code> 保持不变，调整分组不会改变提示词与属性值。</p><div class="modal-footer">${btn('取消','','close-modal','','ghost')}${btn('保存修改','check','settings-meta-save','','primary')}</div>`);
}
function installSettingsWorkbench(){
  document.addEventListener('input',event=>{
    const el=event.target;if(el.dataset.groupName){const draft=settingsGroupUI.editing.get(el.dataset.owner);if(draft)draft[el.dataset.groupName]=el.value;}
  });
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
      },'分组只负责组织属性，不改变生成参数。');
    },
    'settings-group-delete':async d=>{
      const p=settingsTargetById(d.owner),g=p&&settingsGroups(p).find(x=>x.id===d.id);if(!g)return;
      if(!await confirmAction('删除分组「'+g.title+'」？','组内属性会移到“未分组”，属性值、参考图片和提示词引用全部保留。','删除分组'))return;
      if(settingsTargetById(p.id)!==p)throw Error('编辑对象已变化。');
      p.settingsGroups=p.settingsGroups.filter(x=>x.id!==g.id);
      p.variables=mergedSettingEntries(p).map(e=>{if(e.groupId===g.id)delete e.groupId;return e;});
      settingsGroupUI.open.delete(settingsGroupToken(p,g.id));settingsChanged(p);render();
    },
    'settings-group-add-attribute':d=>{const p=settingsTargetById(d.owner);if(!p)return;addUnifiedSetting(d.id);},
    'settings-meta-edit':d=>openSettingMetadata(d.owner,d.key),
    'settings-meta-save':()=>{
      const {owner,key}=rt.settingMetadata||{},p=settingsTargetById(owner);if(!p)throw Error('编辑对象已变化。');
      const groupId=$('#setting-meta-group').value,label=$('#setting-meta-label').value.trim();
      if(!label)throw Error('显示名称不能为空。');
      if(groupId&&!settingsGroups(p).some(g=>g.id===groupId))throw Error('分组已不存在。');
      const entries=mergedSettingEntries(p),entry=entries.find(e=>e.key===key);if(!entry)throw Error('属性已不存在。');
      Object.assign(entry,{label,groupId});p.variables=entries;settingsChanged(p);closeModal();render();if(p._presetEditorId)openPresetLibrary(p._presetEditorId);
    }
  });
}
