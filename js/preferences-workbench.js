/* UI semantics and preferences grouping. Moves existing controls; never duplicates state. */
'use strict';
function fileOperationIcon(action,fallback){
  if(/(^|-)import($|-)/.test(action)||['eco-theme-import','eco-extension-zip','eco-extension-install'].includes(action))return 'file-import';
  if(/(^|-)export($|-)/.test(action)||['disk-archive','native-share-download','backup-export','presentation-export'].includes(action))return 'file-export';
  return fallback;
}
function normalizeSettingsSwitches(root){
  for(const input of root.querySelectorAll('input[type="checkbox"]')){
    if(input.closest('.switch')){input.setAttribute('role','switch');continue}
    const label=input.closest('label');if(!label)continue;
    input.setAttribute('role','switch');if(!input.hasAttribute('aria-label'))input.setAttribute('aria-label',label.textContent.trim());
    const control=document.createElement('span');control.className='switch';input.before(control);control.append(input);
    const track=document.createElement('span');track.className='switch-track';track.setAttribute('aria-hidden','true');control.append(track);label.classList.add('preference-switch-row');
  }
}
function groupGeneralPreferences(root){
  if(root.dataset.preferencesGrouped)return;root.dataset.preferencesGrouped='true';
  const original=[...root.children],groups=new Map();
  for(const [id,title,description] of [['general','语言与常规','决定工作室如何与你交流，以及操作前的确认方式。'],['display','字体与界面显示','调校文字、明暗与显示密度，让长时间创作更舒适。'],['reader','阅读与翻页','设置画册的默认阅读方式与翻页体验。']]){
    const section=document.createElement('section');section.className='preferences-category settings-section';section.dataset.preferenceCategory=id;
    section.innerHTML=`<header><h2>${title}</h2><p>${description}</p></header><div class="preferences-category-body"></div>`;groups.set(id,section);root.append(section);
  }
  function category(item,parent){
    if(item.matches('#art-font-status,.font-sample,.font-status-note')||item.querySelector('#studio-theme,#display-lettering,#default-shelf-view,[data-studio-pref^="appearance."]'))return 'display';
    if(item.querySelector('#interface-language,[data-studio-pref^="assistant."]'))return 'general';
    if(item.querySelector('#default-room-view,[data-studio-pref^="reader."]')||item.matches('[data-reader-preferences]'))return 'reader';
    if(parent?.querySelector('#art-font-status')||parent?.id==='display-preferences')return 'display';
    return 'general';
  }
  for(const section of original){
    for(const item of [...section.children]){
      if(item.matches('h2')||item.matches('p')&&!item.id&&!item.classList.contains('font-status-note'))continue;
      groups.get(category(item,section)).lastElementChild.append(item);
    }
    section.remove();
  }
}
function installPreferencesWorkbench(){
  paths['file-import']=paths.download;paths['file-export']=paths.upload;
  paths.toolbox='<path d="M8 7V4h8v3M3 7h18v14H3zM3 12h18M10 10v4h4v-4"/>';
  const previous=render;render=function(...args){const result=previous(...args);if(ui.workspace===5){const root=$('#studio-settings-content');if(root){if(studioUI.settingsTab==='appearance')groupGeneralPreferences(root);normalizeSettingsSwitches(root)}}
    for(const zone of document.querySelectorAll('[data-eco-drop]')){const svg=zone.querySelector('svg');if(svg)svg.innerHTML=paths['file-import']}
    return result;
  };
}
