/* First-use orientation. No generation, model probe, or macro execution here. */
'use strict';
const firstRunUI={checks:new Map(),keyNotices:new Set(),checking:false};
function firstRunHome(){
 if(state.settings.presentation.hideFirstRun)return `<div class="first-run-reopen">${btn('首次使用指引','help','first-run-show','','ghost small')}</div>`;
 return `<section class="first-run" aria-labelledby="first-run-title"><header><div><h2 id="first-run-title">初光映格，微墨生花</h2><p>在生成任务上点「开始」才会请求图像服务；费用由所选图像服务决定。</p></div>${btn('收起指引','close','first-run-hide','','ghost small')}</header><div class="first-run-paths">${[['comfyui','ComfyUI','连接已运行的服务，导入 API 工作流。','nodes'],['novelai','NovelAI','保存图像 API 密钥，无需工作流。','image'],['openai','OpenAI 兼容','填写基础地址，选模型与接口协议。','link']].map(([id,title,text,ic])=>`<button class="first-run-path" data-act="first-run-provider" data-provider="${id}">${icon(ic)}<span><strong>我使用 ${title}</strong><small>${text}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</div>${homeChecklistHTML()}</section>`;
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
  if(url.protocol==='http:'&&!isPrivateHost(url.hostname))issues.push('公网服务需要 HTTPS；HTTP 仅允许本机或局域网（192.168.x.x、10.x.x.x、*.local 等）服务。');
  if(/\/(?:images\/(?:generations|edits)|chat\/completions|models)\/?$/.test(url.pathname))issues.push('这里只填基础地址（通常到 /v1），不要包含 /images/generations、/chat/completions 或 /models。');
  if(!p.model?.trim())issues.push('填写模型 ID；可获取模型列表，也可按服务商说明手动填写。');
  if(providerKeyRequirement(p)==='required'&&!providerKeyCount(p))issues.push(p.provider==='novelai'?'添加 NovelAI API 密钥。':'添加 API 密钥：'+url.host+' 需要密钥才能生成。');
 }
 return issues;
}
/* keyMode only records whether a key is stored, so the requirement follows the service: NovelAI and OpenAI always need one,
   other public endpoints usually do (a reminder, not a block), local / LAN services may run without. */
function providerKeyCount(p){return p?.keyMode==='stored'?(p.keyIds||[p.keyId]).filter(Boolean).length:0}
function providerKeyRequirement(p){
 if(!p||p.provider==='comfyui')return 'none';if(p.provider==='novelai')return 'required';
 let host='';try{host=new URL(p.baseUrl).hostname}catch{return 'none'}
 if(/(^|\.)openai\.com$/i.test(host))return 'required';
 return isPrivateHost(host)?'optional':'recommended';
}
function providerSetupHTML(p=activeImageProfile()){
 if(p.provider!=='comfyui')return '';
 const check=firstRunUI.checks.get(state.settings.comfy.baseUrl)||'';
 return `<div class="provider-comfy-connect">${field('ComfyUI 服务地址',`<input id="setup-comfy-url" type="url" value="${esc(state.settings.comfy.baseUrl||'')}" placeholder="http://127.0.0.1:8188" spellcheck="false">`)}<div class="row wrap">${btn(firstRunUI.checking?'检查中…':'检查连接','refresh','first-run-check-comfy',firstRunUI.checking?'disabled':'','small')}${btn('去工作流库配置','arrow','wf-focus-library','','small ghost')}</div><p id="setup-comfy-status" class="help" role="status">${esc(check)}</p></div>`;
}
function providerSetupFooter(){return `<div class="provider-next">${btn('编写分镜','arrow','first-run-continue','','primary')}</div>`}
/* Placeholder names a text really references: {{nested}} braces and \{escaped\} ones are skipped, matching the interpolator. */
function promptPlaceholders(text){const raw=String(text||''),keys=[];for(const m of raw.matchAll(/\{([\p{L}\p{N}_]+)\}/gu)){const start=m.index,end=start+m[0].length;if(raw[start-1]==='{'||raw[end]==='}'||raw[start-1]==='\\')continue;if(!keys.includes(m[1]))keys.push(m[1])}return keys}
/* T3 · C2: the assembly checks as one structured list. Each item names the wizard step that owns it (0 分镜与图像服务,
   1 预设, 2 命名与入队), whether it blocks, and the fixes the wizard offers as buttons. assemblyInputIssues keeps returning
   plain texts for the canvas mode and the submit guard.
   Captions have no weight syntax, so an undefined {token} there blocks; prompt tokens only warn: names the collection
   defines are rendered blank (backend knownVariables policy), unknown braces stay in the prompt verbatim. */
function assemblyListText(items){return items.join(displayUI.locale?.language==='en'?', ':'、')}
function assemblySceneText(numbers,total=0){
 if(total>1&&numbers.length===total)return localeString('全部 {n} 幕',{n:total});
 if(numbers.length===1)return localeString('第 {n} 幕',{n:numbers[0]});
 const list=assemblyListText(numbers.slice(0,5));
 return numbers.length>5?localeString('第 {list} 等 {n} 幕',{list,n:numbers.length}):localeString('第 {list} 幕',{list});
}
function assemblyFrameFix(n,field){return {kind:'frame',index:n-1,field,label:localeString('去第 {n} 幕修改',{n})}}
/* A preset that is not selected yet and defines every one of the keys: one click adds it. */
function assemblyPresetFix(keys,presetIds){const p=projectVariableSets().find(s=>!presetIds.includes(s.id)&&keys.every(k=>(s.entries||[]).some(e=>e.key===k)));return p?{kind:'preset',id:p.id,label:localeString('选中「{title}」',{title:p.title})}:null}
function assemblyStoryChecks(storyId,presetIds,channel,workflow=null){
 const story=templateBy(storyId),items=[],add=(step,level,text,fixes=[])=>items.push({step,level,text,fixes:fixes.filter(Boolean)});
 if(!story){const any=projectTemplates().length>0;add(0,'block',localeString(any?'还没有选择分镜。':'当前画册集还没有分镜。'),any?[]:[{kind:'story',label:localeString('去分镜工坊')}]);return items}
 const frames=story.frames||[],total=frames.length,scenes=list=>assemblySceneText(list,total),numbers=test=>frames.flatMap((f,i)=>test(f)?[i+1]:[]);
 if(!total){add(0,'block',localeString('「{title}」还没有分幕。',{title:story.title}),[{kind:'story',label:localeString('去分镜工坊')}]);return items}
 const empty=numbers(f=>!String(f.prompt||'').trim());
 if(empty.length)add(0,'block',localeString('{scenes}还没有填写正向提示词。',{scenes:scenes(empty)}),[assemblyFrameFix(empty[0],'prompt')]);
 if(channel?.provider==='novelai'){
  const size=numbers(f=>['width','height'].some(k=>!Number.isInteger(Number(f[k]))||Number(f[k])<64||Number(f[k])>2048||Number(f[k])%64));
  if(size.length)add(0,'block',localeString('{scenes}的宽高需为 64–2048 内的 64 倍数（NovelAI 要求）。',{scenes:scenes(size)}),[assemblyFrameFix(size[0],'width')]);
  /* C3: NovelAI's own UI stops at guidance 10; higher values are accepted by the API but tend to oversaturate. */
  const hot=numbers(f=>Number.isFinite(Number(f.cfg))&&Number(f.cfg)>10);
  if(hot.length)add(0,'warn',localeString('{scenes}的 CFG 高于 10（NovelAI 官方界面的上限）。请求仍会发送，但画面可能过饱和；如无特别需要，建议改回 5–10。',{scenes:scenes(hot)}),[assemblyFrameFix(hot[0],'cfg')]);
 }
 const sets=presetIds.map(id=>setBy(id)).filter(Boolean),values=Object.fromEntries(sets.flatMap(s=>(s.entries||[]).map(e=>[e.key,true]))),known=definedPromptNames(values),novel=channel?.provider==='novelai';
 const caption=new Map(),blank=new Map(),literal=new Map(),note=(map,key,n)=>{if(!map.has(key))map.set(key,[]);if(!map.get(key).includes(n))map.get(key).push(n)};
 frames.forEach((f,i)=>{
  for(const key of promptPlaceholders(f.caption))if(!Object.hasOwn(values,key))note(caption,key,i+1);
  for(const key of [...promptPlaceholders(f.prompt),...promptPlaceholders(f.negative)])if(!Object.hasOwn(values,key)){if(known.has(key))note(blank,key,i+1);else if(!novel)note(literal,key,i+1)}
 });
 const brace=key=>'{'+key+'}',all=map=>[...new Set([...map.values()].flat())].sort((a,b)=>a-b);
 const perKey=(map,level,one,many,field)=>{
  if(map.size>4){const list=all(map);add(1,level,localeString(many,{vars:assemblyListText([...map.keys()].map(brace)),scenes:scenes(list)}),[assemblyPresetFix([...map.keys()],presetIds),assemblyFrameFix(list[0],field)]);return}
  for(const [key,list] of map)add(1,level,localeString(one,{vars:brace(key),scenes:scenes(list)}),[assemblyPresetFix([key],presetIds),assemblyFrameFix(list[0],field)]);
 };
 perKey(caption,'block','{scenes}的台词引用了未定义的变量 {vars}。','{scenes}的台词引用了未定义的变量：{vars}。','caption');
 perKey(blank,'warn','{scenes}的提示词引用了 {vars}，所选预设没有定义它，生成时替换为空。','{scenes}的提示词引用了所选预设没有定义的变量：{vars}，生成时替换为空。','prompt');
 if(literal.size){const list=all(literal);add(1,'warn',localeString('提示词里的 {vars} 没有任何预设定义，会按原文保留在提示词里（{scenes}）。',{vars:assemblyListText([...literal.keys()].map(brace)),scenes:scenes(list)}),[assemblyFrameFix(list[0],'prompt')])}
 if(channel?.provider==='comfyui'){
  /* C2: image variables referenced from a prompt are staged as reference images, but a text-to-image graph has no node to receive them. */
  const imageKeys=new Set(sets.flatMap(s=>(s.entries||[]).filter(e=>e.type==='image').map(e=>e.key))),used=[...new Set(frames.flatMap(f=>promptPlaceholders(f.prompt).filter(k=>imageKeys.has(k))))];
  const bindings=[...(workflow?.bindings||[]),...sets.flatMap(s=>s.bindings||[])].filter(b=>b.enabled!==false);
  const bound=bindings.some(b=>b.source==='image'||(b.source==='variable'&&imageKeys.has(String(b.value||'').replace(/^\{|\}$/g,''))));
  if(used.length&&!bound)add(1,'warn',localeString('所选工作流是纯文生图（没有映射 LoadImage 等图片输入），提示词里引用的立绘参考图 {vars} 会被忽略，文字描述照常生成。需要参考图时，请在「工作流与 API 配置 → 节点映射」中为 LoadImage 节点绑定图片变量。',{vars:assemblyListText(used.map(brace))}),[{kind:'workflow',label:localeString('打开工作流')}]);
 }
 return items;
}
function assemblyEnvironmentChecks(channel,workflow){
 const items=[],add=(level,text,fixes=[])=>items.push({step:0,level,text,fixes:fixes.filter(Boolean)});
 if(!channel){add('block',localeString('请选择图像服务。'));return items}
 const setup=providerSetupIssues(channel);
 if(setup.length)add('block',localeString('「{title}」还没配置好：{issue}',{title:channel.title,issue:localeString(setup[0])}),[{kind:'service',label:localeString('图像服务设置')}]);
 if(channel.provider==='comfyui'&&!workflow){const saved=state.settings.comfy.presets.length>0;add('block',localeString(saved?'请选择工作流。':'还没有保存的工作流。'),saved?[]:[{kind:'workflow',label:localeString('打开工作流')}])}
 return items;
}
function assemblyInputIssues(storyId,presetIds,channel){return assemblyStoryChecks(storyId,presetIds,channel).filter(i=>i.level==='block').map(i=>i.text)}
/* Variables the selected presets do not provide are a warning, not a blocker: production renders them blank (backend knownVariables policy) and the creator is told which ones. Prompt tokens count only when the collection defines the name somewhere, so NovelAI weights and authored braces are left alone; captions have no weight syntax, so every {token} counts. */
function assemblyMissingVariables(storyId,presetIds){
 const story=templateBy(storyId),values=Object.fromEntries(presetIds.flatMap(id=>(setBy(id)?.entries||[]).map(e=>[e.key,true]))),known=definedPromptNames(values),policy=globalThis.ComfyComic?.promptPolicy,found=new Map();
 const note=(key,i)=>{if(!found.has(key))found.set(key,[]);if(!found.get(key).includes(i+1))found.get(key).push(i+1)};
 for(const [i,f] of (story?.frames||[]).entries()){
  if(policy)for(const text of [f.prompt,f.negative])for(const part of policy.tokens(String(text||''),known))if(part.type==='variable'&&!Object.hasOwn(values,part.key))note(part.key,i);
  const captionRaw=String(f.caption||'');
  for(const m of captionRaw.matchAll(/\{([\p{L}\p{N}_]+)\}/gu)){const start=m.index,end=start+m[0].length;if(captionRaw[start-1]==='{'||captionRaw[end]==='}'||captionRaw[start-1]==='\\'||Object.hasOwn(values,m[1]))continue;note(m[1],i)}
 }
 return [...found].map(([key,frames])=>({key,frames}));
}
function assemblyMissingVariableNotes(missing,total=0){
 if(missing.length>4)return [missingVariablesNotice(missing.map(m=>m.key))];
 return missing.map(({key,frames})=>'变量 {'+key+'} 未定义（'+(total&&frames.length===total?'全部 '+total+' 幕':'第 '+frames.join('、')+' 幕')+'），生成时会被替换为空。');
}
/* Step 3 recap. Blocking items stay listed with their fixes; advisories open on click (E3: nothing is hover-only), so a
   ready book is not shouted at. */
function assemblyPreflightHTML(items=designerChecks()){
 const frames=templateBy(assemblyDesign.storyId)?.frames.length||0,blocks=items.filter(i=>i.level==='block'),warns=items.filter(i=>i.level==='warn');
 const tone=blocks.length?'is-blocked':warns.length?'is-advised':'is-ready',emoji=blocks.length?'⛔':warns.length?'⚠️':'✅',headline=blocks.length?'检查分镜':warns.length?'可以生成':'输入检查通过';
 const row=tail=>`<span class="preflight-emoji" aria-hidden="true">${emoji}</span><strong>${headline}</strong><span class="preflight-count">共 ${frames} 幕</span><span class="grow"></span>${tail}`;
 const notes=warns.length?designerIssueListHTML(warns,true,'preflight-notes-list'):'';
 const body=blocks.length?`<div class="assembly-preflight ${tone}"><div class="preflight-row">${row(`<span class="preflight-pill is-blocked">${blocks.length} 处需要修正</span>`)}</div>${designerIssueListHTML(blocks,true,'preflight-issues')}${warns.length?`<details class="preflight-notes"><summary><span class="preflight-pill is-advised">⚠️ ${warns.length} 项提示</span></summary>${notes}</details>`:''}</div>`
  :warns.length?`<details class="assembly-preflight ${tone} preflight-notes"><summary class="preflight-row">${row(`<span class="preflight-pill is-advised">${warns.length} 项提示</span>`)}</summary>${notes}</details>`
  :`<div class="assembly-preflight ${tone}"><div class="preflight-row">${row('')}</div></div>`;
 return `<div id="designer-recap" class="designer-recap" role="status">${body}</div>`;
}
function installFirstRun(){
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
   state.settings.productionAssembly={...(state.settings.productionAssembly||{}),channelId:p.id,workflowId:state.settings.comfy.activeWorkflowId};save();workshop.view='stories';navigate(1);return;
  }
  if(action==='first-run-assemble-story'){await saveWorkshop();openAssemblyDesigner();return}
  if(action==='first-run-check-comfy'){await checkWorkflowConnection();if(ui.workspace!==3)render();return}
  return previous(action,d,el);
 };
 document.addEventListener('input',e=>{if(e.target.id==='setup-comfy-url'){state.settings.comfy.baseUrl=e.target.value.trim();save()}});
}
