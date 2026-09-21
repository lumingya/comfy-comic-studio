/* Sharing belongs to the resource's page, not a global resource picker. */
'use strict';
function resourceKindLabel(kind){return {albums:'画册',storyboards:'分镜模板',characters:'角色设定',scenes:'场景设定',variables:'变量设定',layouts:'展示模板',workflows:'工作流'}[kind]||'资源'}
async function confirmResourceImport(info){
  return new Promise(resolve=>{
    modal('导入'+resourceKindLabel(info.kind),`<div class="resource-import-summary"><strong data-user-content>${esc(info.title)}</strong><p class="help">${info.count} 项内容 · ${info.images} 个图片文件</p></div><p class="help">将导入到「${esc(project().title)}」，创建独立的新副本，不覆盖已有资源。导入设定只加入预设库，不自动替换当前画册的变量。</p><div id="resource-extra-choices" class="resource-import-choices">${info.storyboards?`<label class="resource-import-choice"><input type="checkbox" id="import-include-storyboards"><span>导入附带分镜模板<small>${info.storyboards} 份，创建独立新副本。</small></span></label>`:''}${info.variables?`<label class="resource-import-choice"><input type="checkbox" id="import-include-variables"><span>导入附带变量设定<small>${info.variables} 组，包含参考图片；不覆盖现有设定。</small></span></label>`:''}</div><div class="modal-footer">${btn('取消','','close-modal','','ghost')}<button type="button" class="btn primary" id="resource-import-confirm">导入新副本</button></div>`,'只读取资源数据，不运行文件中的脚本。');
    const dialog=$('#modal');let finished=false;
    const finish=value=>{if(finished)return;finished=true;dialog.removeEventListener('close',cancel);resolve(value)};
    const cancel=()=>finish(null);dialog.addEventListener('close',cancel);
    $('#resource-import-confirm').onclick=()=>{finish({storyboards:!!$('#import-include-storyboards')?.checked,variables:!!$('#import-include-variables')?.checked});closeModal()};
  });
}
async function exportContextResource(kind,id){
  if(!id)throw Error('请先选择要导出的'+resourceKindLabel(kind)+'。');
  let include={};if(kind==='albums'){closeBookContext();include=await new Promise(resolve=>{modal('分享画册源文件',`<p class="help">包含画册、原图与可编辑内容。源分镜和变量可分别附带；请先检查提示词、台词及参考图片是否适合公开。</p>${albumEmbeddingControls({})}<div class="modal-footer"><button class="btn primary" id="native-share-download">下载分享包</button></div>`);const dialog=$('#modal'),cancel=()=>resolve(null);dialog.addEventListener('close',cancel,{once:true});$('#native-share-download').onclick=()=>{dialog.removeEventListener('close',cancel);resolve({embedStoryboard:$('#export-embed-storyboard').checked,embedVariables:$('#export-embed-variables').checked});closeModal()}});if(!include)return;await globalThis.Mio.fileLibrary.hydrate(id)}
  flushEditor();if(!await ComfyComic.sync.save())throw Error('编辑尚未保存，未导出旧内容。');
  const groups=nativeSplitDTO(ComfyComic.converters.toApi(state)).groups,item=groups[kind]?.find(x=>x.id===id);
  if(kind==='albums')item.sharedSources=albumSharedSources(bookBy(id),include);
  const response=kind==='albums'?await request('/api/library/export-document',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,document:item})},90000):await request('/api/library/export/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id));
  download((item?.title||id)+'.mio.zip',await response.blob(),'application/zip');
  toast('独立分享包已下载，图片随包携带，不包含服务密钥。');
}
function installContextualSharing(){
  v3Actions['native-export']=async d=>exportContextResource(d.kind||'albums',d.id);
  v3Actions['native-export-settings']=async()=>{
    commitSettingsGroupNames(settingsEditorTarget());flushEditor();const plan=settingsEditorTarget();if(!plan)throw Error('请先选择画册计划。');
    const document={id:uid('share'),title:plan.title+' · 角色与画面设定',entries:clone(mergedSettingEntries(plan)),settingsGroups:clone(settingsGroups(plan)),...(plan._presetEditorId?{frames:clone(plan.frames||{})}:{})};
    if(!document.entries.length)throw Error('当前没有可导出的变量设定。');
    if(!await ComfyComic.sync.save())throw Error('编辑尚未保存，未导出旧内容。');
    const response=await request('/api/library/export-document',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'characters',document})},90000);
    download(document.title+'.mio.zip',await response.blob(),'application/zip');toast('当前显示的设定已导出，参考图片随包携带。');
  };
  v3Actions['native-import']=async d=>{
    if(activeJobs())throw Error('请在当前生成任务结束后导入。');
    const kind=d.kind;if(!kind)throw Error('请从画册、分镜或设定页面选择导入。');
    const destination=state.activeProjectId,targetPlanId=selectedPlan()?.id;
    flushEditor();
    pickFile(kind==='albums'?'.html,.htm,.json,.zip':'.json,.zip',async file=>{
      if(file.size>600*1024*1024)throw Error('分享包最大 600 MiB。');
      const body={projectId:destination,expectedKind:kind};
      if(/\.html?$/i.test(file.name)){
        if(file.size>480*1024*1024)throw Error('单文件 HTML 受浏览器单字符串与 JSON 传输限制，导入建议在 480 MiB 以内，超出请使用离线 ZIP 分发。');
        body.html=await file.text();
      }
      else if(file.name.toLowerCase().endsWith('.zip')){
        if(file.size>380*1024*1024)throw Error('ZIP 分享包经由浏览器 Base64 传输最大支持 380 MiB，超出请直接放置到数据目录或分包导入。');
        body.zip=(await blobData(file)).split(',')[1];
      }
      else body.document=JSON.parse(await file.text(),(key,value)=>{if(['__proto__','prototype','constructor'].includes(key))throw Error('文件含不安全的 JSON 字段。');return value});
      let inspectPayload;
      try{inspectPayload=JSON.stringify(body)}catch(e){if(e instanceof RangeError||e?.message?.includes('string length'))throw Error('文件体积过大，经 JSON 传输超出浏览器单字符串 512 MiB 极限，请改用 ZIP 格式导入。');throw e}
      const response=await request('/api/library/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:inspectPayload},90000),info=await response.json();
      const include=await confirmResourceImport(info);if(!include)return;body.include=include;
      if(state.activeProjectId!==destination||activeJobs())throw Error('工作区或任务状态已变化，请重新选择导入。');
      flushEditor();if(!await ComfyComic.sync.save())throw Error('请先解决当前编辑的保存冲突，文件尚未导入。');
      let importPayload;
      try{importPayload=JSON.stringify(body)}catch(e){if(e instanceof RangeError||e?.message?.includes('string length'))throw Error('文件体积过大，经 JSON 传输超出浏览器单字符串 512 MiB 极限，请改用 ZIP 格式导入。');throw e}
      const result=await(await request('/api/library/import',{method:'POST',headers:{'Content-Type':'application/json'},body:importPayload},90000)).json();
      if(!result.ok)throw Error('导入未确认，请先扫描并重新读取，不要重复提交。');
      await connectPythonBackend();
      if(state.creation.plans.some(p=>p.id===targetPlanId))createUI.planId=targetPlanId;
      if(result.kind==='storyboards'){
        ui.templateId=result.id;ui.storyTemplateId=result.id;ui.frameIndex=0;
        // Match the existing storyboard importer: select the new copy in this plan.
        const plan=selectedPlan();if(plan){const previous=templateBy(plan.templateId);if(previous?.ownerPlanId===plan.id)for(const f of previous.frames){const own=plan.sceneOverrides[f.id]||{};for(const key of ['name','prompt','caption','negative','renderOverride','width','height','steps','cfg','denoise','seed'])if(Object.hasOwn(own,key)){f[key]=clone(own[key]);delete own[key]}}plan.templateId=result.id;plan.storyVersionId='';save()}
        ui.workspace=1;render();
      }else if(['characters','scenes'].includes(result.kind)){
        createUI.setId=result.id;createUI.tab='settings';ui.workspace=1;render();
        const select=$('#art-setting-preset');if(select){select.value=result.id;select.dispatchEvent(new Event('change',{bubbles:true}))}
      }else if(result.kind==='albums'){ui.filter='all';ui.search='';ui.selected.clear();ui.workspace=0;render()}
      window.scrollTo({top:0,behavior:'instant'});
      toast(result.kind==='characters'||result.kind==='scenes'?'设定已导入为新预设；需要时再点击“应用”，现有变量未改变。':'已导入新副本，原资源未覆盖。');
    });
  };
}
