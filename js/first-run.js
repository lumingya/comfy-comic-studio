/* First-use orientation. No generation, model probe, or macro execution here. */
'use strict';
const firstRunUI={checks:new Map(),keyNotices:new Set(),checking:false};
function firstRunHome(){
 if(state.settings.presentation.hideFirstRun)return `<div class="first-run-reopen">${btn('首次使用指引','help','first-run-show','','ghost small')}</div>`;
 return `<section class="first-run" aria-labelledby="first-run-title"><header><div><h2 id="first-run-title">初光映格，微墨生花</h2><p>配置不会自动生成。只有在任务中明确开始，才会请求图像服务；费用由所选渠道决定。</p></div>${btn('收起指引','close','first-run-hide','','ghost small')}</header><div class="first-run-paths">${[['comfyui','ComfyUI','连接已运行的服务，导入 API 工作流。','nodes'],['novelai','NovelAI','保存图像 API 密钥，无需工作流。','image'],['openai','OpenAI 兼容','填写基础地址，选模型与接口协议。','link']].map(([id,title,text,ic])=>`<button class="first-run-path" data-act="first-run-provider" data-provider="${id}">${icon(ic)}<span><strong>我使用 ${title}</strong><small>${text}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</div></section>`;
}
/* Mirrors backend/mio_credentials.is_private_host: loopback, RFC 1918 / link-local / ULA and LAN-style names may use plain HTTP. */
function isPrivateHost(hostname){
 const host=String(hostname||'').trim().toLowerCase().replace(/\.$/,'').replace(/^\[|\]$/g,'');
 if(!host)return false;
 if(host==='localhost'||host==='localhost.localdomain')return true;
 const v4=host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
 if(v4){const[a,b]=[Number(v4[1]),Number(v4[2])];return a===10||a===127||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254)}
 if(host.includes(':'))return host==='::1'||/^f[cd]/.test(host)||/^fe[89ab]/.test(host);
 return !host.includes('.')||['.local','.lan','.internal','.home','.home.arpa','.localdomain','.localhost'].some(suffix=>host.endsWith(suffix));
}
function providerSetupIssues(p=activeImageProfile()){
 const issues=[],base=p.provider==='comfyui'?state.settings.comfy.baseUrl:p.baseUrl;let url;
 try{url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error()}catch{issues.push('填写有效的 HTTP(S) 服务基础地址，不要包含密钥、查询参数或片段。')}
 if(url&&p.provider!=='comfyui'){
  if(url.protocol==='http:'&&!isPrivateHost(url.hostname))issues.push('公网云渠道需要 HTTPS；HTTP 仅允许本机或局域网（192.168.x.x、10.x.x.x、*.local 等）服务。');
  if(/\/(?:images\/(?:generations|edits)|chat\/completions|models)\/?$/.test(url.pathname))issues.push('这里只填基础地址（通常到 /v1），不要包含 /images/generations、/chat/completions 或 /models。');
  if(!p.model?.trim())issues.push('填写模型 ID；可获取模型列表，也可按服务商说明手动填写。');
 }
 return issues;
}
function providerSetupHTML(p=activeImageProfile()){
 if(p.provider!=='comfyui')return '';
 const check=firstRunUI.checks.get(state.settings.comfy.baseUrl)||'';
 return `<div class="provider-comfy-connect">${field('ComfyUI 服务地址',`<input id="setup-comfy-url" type="url" value="${esc(state.settings.comfy.baseUrl||'')}" placeholder="http://127.0.0.1:8188" spellcheck="false">`)}<div class="row wrap">${btn(firstRunUI.checking?'检查中…':'检查连接','refresh','first-run-check-comfy',firstRunUI.checking?'disabled':'','small')}${btn('去工作流库配置','arrow','wf-focus-library','','small ghost')}</div><p id="setup-comfy-status" class="help" role="status">${esc(check)}</p></div>`;
}
function providerSetupFooter(){return `<div class="provider-next">${btn('编写分镜','arrow','first-run-continue','','primary')}</div>`}
function assemblyInputIssues(storyId,presetIds,channel){
 const story=templateBy(storyId),values=Object.fromEntries(presetIds.flatMap(id=>(setBy(id)?.entries||[]).map(e=>[e.key,true]))),issues=[];
 for(const [i,f] of (story?.frames||[]).entries()){
  if(!f.prompt?.trim())issues.push('第 '+(i+1)+' 幕尚未填写正向提示词。');
  for(const key of ['prompt','negative','caption']){
   if(channel?.provider==='novelai'&&key!=='caption')continue;
   const missing=[...new Set([...String(f[key]||'').matchAll(/\{([\p{L}\p{N}_]+)\}/gu)].map(m=>m[1]).filter(k=>!Object.hasOwn(values,k)))];if(missing.length)issues.push('第 '+(i+1)+' 幕'+({prompt:'正向提示词',negative:'负向提示词',caption:'台词'})[key]+'缺少变量：'+missing.join('、'));
  }
  if(channel?.provider==='novelai'&&['width','height'].some(k=>!Number.isInteger(Number(f[k]))||Number(f[k])<64||Number(f[k])>2048||Number(f[k])%64))issues.push('第 '+(i+1)+' 幕 NovelAI 宽高需为 64–2048 内的 64 倍数。');
 }
 return issues;
}
/* Non-blocking advisories: the book can still be queued, but the creator should know what will silently differ from their intent. */
function assemblyPreflightNotices(storyId,presetIds,channel,workflow){
 const story=templateBy(storyId),notes=[];if(!story)return notes;
 const sets=presetIds.map(id=>setBy(id)).filter(Boolean),imageKeys=new Set(sets.flatMap(s=>(s.entries||[]).filter(e=>e.type==='image').map(e=>e.key)));
 if(channel?.provider==='comfyui'&&imageKeys.size){
  /* C2: image variables referenced from a prompt are staged as reference images, but a text-to-image graph has no node to receive them. */
  const used=[...new Set(story.frames.flatMap(f=>[...String(f.prompt||'').matchAll(/\{([\p{L}\p{N}_]+)\}/gu)].map(m=>m[1]).filter(k=>imageKeys.has(k))))];
  const bindings=[...(workflow?.bindings||[]),...sets.flatMap(s=>s.bindings||[])].filter(b=>b.enabled!==false);
  const bound=bindings.some(b=>b.source==='image'||(b.source==='variable'&&imageKeys.has(String(b.value||'').replace(/^\{|\}$/g,''))));
  if(used.length&&!bound)notes.push('所选工作流是纯文生图（没有映射 LoadImage 等图片输入），提示词里引用的立绘参考图 {'+used.join('}、{')+'} 会被忽略，文字描述照常生成。需要参考图时，请在「工作流与 API 配置 → 节点映射」中为 LoadImage 节点绑定图片变量。');
 }
 if(channel?.provider==='comfyui'&&workflow&&!(workflow.bindings||[]).some(b=>b.enabled!==false&&(b.source==='random'||(b.source==='sceneParameter'&&String(b.value||'').trim()==='seed'))))notes.push('所选工作流没有种子映射，每一幕都会沿用蓝图里的固定种子，整本画面可能雷同。建议在「工作流与 API 配置」中点击「添加分镜参数映射」。');
 if(channel?.provider==='novelai'){
  /* C3: NovelAI's own UI stops at guidance 10; higher values are accepted by the API but tend to oversaturate. */
  const hot=story.frames.map((f,i)=>[i+1,Number(f.cfg)]).filter(([,c])=>Number.isFinite(c)&&c>10);
  if(hot.length)notes.push('第 '+hot.map(([i])=>i).join('、')+' 幕的 CFG 高于 10（NovelAI 官方界面的上限）。请求仍会发送，但画面可能过饱和；如无特别需要，建议改回 5–10。');
 }
 return notes;
}
function assemblyPreflightHTML(){const d=assemblyDesign,channel=designerChannel(),issues=assemblyInputIssues(d.storyId,[...d.presets],channel),notes=assemblyPreflightNotices(d.storyId,[...d.presets],channel,channel?.provider==='comfyui'?designerWorkflow():null);return `<div class="assembly-preflight ${issues.length?'setup-warning':''}" role="status"><strong>${issues.length?'检查分镜':'输入检查通过'}</strong>${issues.length?'<ul>'+issues.slice(0,8).map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':''}${notes.length?'<ul class="preflight-notes">'+notes.slice(0,4).map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':''}<p>共 ${templateBy(d.storyId)?.frames.length||0} 幕。</p></div>`}
function installFirstRun(){
 [{"title": "选择图像渠道", "headline": "连接你的图像服务。", "description": "在渠道配置中选择 ComfyUI、NovelAI 或 OpenAI 兼容服务。", "checks": ["填写服务地址。", "选择模型并填写 API Key，或导入 ComfyUI API 工作流。"]}, {"title": "管理画册集", "headline": "为每个故事留一个位置。", "description": "使用顶部菜单新建或切换画册集。", "checks": ["新建画册集并填写名称。", "在画册集中整理和阅读作品。"]}, {"title": "编写分镜", "headline": "从一个镜头开始。", "description": "在创作工坊新建分镜，填写画面提示词与台词。", "checks": ["添加或调整分幕。", "选择角色、服装和画风预设。"]}, {"title": "装配与生成", "headline": "把分镜变成画面。", "description": "选择渠道、分镜和预设，添加生成任务。", "checks": ["在装配向导中确认配置。", "在任务卡点击开始，查看分幕进度。"]}, {"title": "阅读与编辑", "headline": "让每一帧更完整。", "description": "打开画册，调整图片、气泡和文字。", "checks": ["在阅读器中选择页面。", "点击编辑图片，保存修改。"]}, {"title": "导出画册", "headline": "把故事分享出去。", "description": "选择展示模板，导出 HTML、图片 ZIP 或 PDF。", "checks": ["选择版式与主题色。", "选择导出格式。"]}, {"title": "分享模板", "headline": "在 GitHub 上分享创作资源。", "description": "选择模板和目标仓库，上传或下载模板包。", "checks": ["填写仓库、分支和文件路径。", "检查文件后提交。"]}].forEach((copy,i)=>Object.assign(guideSteps[i],copy));
 Object.assign(guideSteps[0],{action:"first-run-config",label:"配置渠道",icon:"settings"});
 Object.assign(guideSteps[3],{action:"first-run-queue",label:"打开生成任务",icon:"list"});
 guideTaskStatus=()=>"";
 const previous=handleAction;handleAction=async function(action,d={},el){
  if(action==='first-run-config'||action==='first-run-queue'){if($('#guide-dialog').open)closeServiceDialog('guide-dialog');if(action==='first-run-config')navigate(3);else{workshop.view='production';navigate(1);await refreshProduction()}return}
  if(action==='first-run-hide'||action==='first-run-show'){state.settings.presentation.hideFirstRun=action==='first-run-hide';save();render();return}
  if(action==='first-run-provider'){
   const g=ensureImageProviders(),p=g.profiles.find(p=>p.provider===d.provider);if(!p){navigate(3);await handleImageProviderAction('image-provider-new');$('#image-new-type').value=d.provider;return}
   g.active=p.id;save();navigate(3);return;
  }
  if(action==='first-run-continue'){
   const p=activeImageProfile();await saveImageKeyDrafts(p);const issues=providerSetupIssues(p);if(issues.length){render();throw Error(issues[0])}
   storeActiveWorkflow();if(!await savePythonWorkspace())throw Error('配置保存尚未确认，请检查服务或冲突。');
   state.settings.productionAssembly={channelId:p.id,workflowId:state.settings.comfy.activeWorkflowId};save();workshop.view='stories';navigate(1);return;
  }
  if(action==='first-run-assemble-story'){await saveWorkshop();openAssemblyDesigner();return}
  if(action==='first-run-check-comfy'){
   if(firstRunUI.checking)return;const baseUrl=state.settings.comfy.baseUrl;firstRunUI.checking=true;render();
   try{const result=await(await request('/api/image/comfy-check',post({baseUrl}),12000)).json();firstRunUI.checks.set(baseUrl,result.message)}catch(e){firstRunUI.checks.set(baseUrl,'连接失败：'+e.message)}finally{firstRunUI.checking=false;if(ui.workspace===3)render()}return;
  }
  return previous(action,d,el);
 };
 document.addEventListener('input',e=>{if(e.target.id==='setup-comfy-url'){state.settings.comfy.baseUrl=e.target.value.trim();const status=$('#setup-comfy-status');if(status)status.textContent='地址已更改';save()}});
}
