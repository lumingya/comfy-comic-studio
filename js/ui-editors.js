/* Mio editors: feature-owned UI functions. Loaded before ui.js; initialization remains in app.js. */
'use strict';

function renderAssistant(){const c=currentChat();$('#assistant').innerHTML=`<header class="assistant-head" id="assistant-drag">${icon('spark')}<div class="grow"><strong>Comfy 创作助手</strong><small>${llmMock()?'LOCAL INTELLIGENCE · 离线模拟':esc(state.settings.llm.model)}</small></div>${ibtn('expand','assistant-full','展开 / 收起')}${ibtn('close','assistant-close','关闭助手')}</header><div class="assistant-tabs"><select id="chat-select" aria-label="切换会话">${state.chats.map(c=>opt(c.id,c.title,state.activeChatId)).join('')}</select>${ibtn('plus','new-chat','新建会话分支')}</div><div class="chat-messages" id="chat-messages">${c.messages.map(m=>{if(m.role==='tool')return'';if(m.tool_calls)return`<details class="tool-result"><summary>已处理 ${m.tool_calls.length} 项工具操作</summary><pre>${esc(m.tool_calls.map(t=>t.function.name).join('\n'))}</pre></details>`;const text=typeof m.content==='string'?m.content:(m.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');return`<div class="chat-bubble ${m.role==='user'?'user':''}">${esc(text)}</div>`}).join('')}${rt.chatBusy?'<div class="chat-bubble"><i class="dot live"></i> 正在思考与编排...</div>':''}</div><div class="chat-compose"><div class="attachments" id="chat-attachments">${rt.attachments.map((a,i)=>`<span class="row">${a.image?imgTag(a.image,a.name):icon('attach','sm')}${esc(a.name)}${ibtn('close','remove-attachment','移除附件',`data-index="${i}"`)}</span>`).join('')}</div><textarea id="chat-input" placeholder="描述你想调整的分镜，或拖入参考图..." aria-label="输入给助手的指令"></textarea><div class="row" style="margin-top:6px">${ibtn('attach','chat-attach','上传图片、TXT 或 DOCX')}<span class="tiny muted grow">Enter 发送 · Shift + Enter 换行</span>${btn('发送','send','send-chat',rt.chatBusy?'disabled':'','small primary')}</div></div>${['n','s','e','w','ne','nw','se','sw'].map(d=>`<i class="resize-handle ${d}" data-resize="${d}"></i>`).join('')}`;$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;setupAssistantPointer()}

function persistEditorDraft(){try{sessionStorage.setItem('cc-template-draft',JSON.stringify({template:studioUI.editor,time:Date.now()}));return true}catch(e){return false}}

function renderSettingsWorkspace(){
  const p=state.settings.studio,tab=studioUI.settingsTab;
  const tabs=[['general','users','工作室身份'],['storage','folder','文件与保存'],['modules','grid','模块管理'],['appearance','sun','外观与阅读'],['connections','nodes','生成与连接'],['github','upload','GitHub 发布'],['export','book','导出与数据'],['guide','help','快速开始教程']];
  let content='';
  if(tab==='general')content=identitySettingsHTML();
  if(tab==='storage')content=storageSettingsHTML();
  if(tab==='github')content=githubSummarySettings();
  if(tab==='guide')content=quickStartSettings();
  if(tab==='modules')content=`<section class="settings-section"><div class="row between" style="margin-bottom:9px"><h2 style="margin:0">只留下你需要的工作区</h2><select id="studio-preset" class="module-preset" aria-label="界面预设"><option value="">应用界面预设...</option value="full">完整创作工作室</option><option value="manual">专注手动分镜</option></select></div><p>隐藏入口，不删除资产。随时回来打开，作品与配置都还在。</p>${workspaces.map((w,i)=>settingsRow(w[0],['核心资产与阅读入口，始终保留。','编排镜头、提示词与默认旁白。','维护角色变量，管理批量渲染任务。','导入工作流与映射 GPU 节点。隐藏不影响引擎运行。','使用 LLM 生成剧情与模板。不需要时可从导航中隐藏。'][i],switchControl('visibility.'+moduleKeys[i],w[0]+'可见',p.visibility[moduleKeys[i]],i===0),w[1])).join('')}</section><section class="settings-section"><h2>辅助功能开关</h2>${[['assistant','分镜精修助手','用自然语言修改当前分镜模板，不是生图聊天机器人。','spark'],['marketplace','模板与插件市场','发现并安装分镜、角色、工作流和画册 HTML 模板。','box'],['visualCritic','视觉审校','检查单页画面，或在批量出图后自动生成报告。','shield'],['executionLogs','执行终端日志','显示队列调度详情。隐藏后仍会记录本次运行日志。','terminal']].map(([key,l,d,ic])=>settingsRow(l,d,switchControl('features.'+key,l,p.features[key]),ic)).join('')}</section><div class="settings-note">${icon('shield')}<span>快捷键与命令面板会同步隐藏工作区入口。正在运行的队列与剧本推演，可在“生成与连接”中停止。</span></div>`;
  if(tab==='appearance')content=`<section class="settings-section"><h2>为长时间创作调校界面</h2><p>安静一点，紧凑一点，或让阅读成为你的默认入口。</p>${settingsRow('界面主题','日光适合明亮环境；暗室让画面更突出。',`<select id="studio-theme" class="inline-setting" aria-label="界面主题">${opt('dark','暗室',document.documentElement.dataset.theme)}${opt('light','日光',document.documentElement.dataset.theme)}</select>`,'sun')}${settingsRow('界面密度','紧凑模式减少表格与面板间距。',`<select class="inline-setting" data-studio-pref="appearance.density" aria-label="界面密度">${opt('comfortable','舒适',p.appearance.density)}${opt('compact','紧凑',p.appearance.density)}</select>`,'list')}${settingsRow('减少动态效果','关闭入场、微光和翻页动画；同时尊重系统减弱动态设置。',switchControl('appearance.reduceMotion','减少动态效果',p.appearance.reduceMotion),'eye')}${settingsRow('显示画廊统计','隐藏顶部统计区域，把更多空间留给画作。',switchControl('appearance.showMetrics','显示画廊统计',p.appearance.showMetrics),'grid')}</section><section class="settings-section"><h2>阅读器默认行为</h2>${settingsRow('打开画册时的模式','只影响下次打开的画册，不打断当前阅读。',`<select class="inline-setting" data-studio-pref="reader.defaultMode" aria-label="默认阅读模式">${[['focus','单页专注'],['manga','Manga 双页'],['webtoon','Webtoon 长卷'],['flip','3D 翻页']].map(x=>opt(...x,p.reader.defaultMode)).join('')}</select>`,'book')}${settingsRow('助手修改前确认','应用工具修改前，显示将受影响的模板与分镜。',switchControl('assistant.confirmChanges','助手修改前确认',p.assistant.confirmChanges),'shield')}</section>`;
  if(tab==='connections')content=`<section class="settings-section"><h2>连接与生成默认值</h2><div class="settings-connections"><div class="connection-setting">${icon('nodes')}<h3>ComfyUI 图像引擎</h3><p>${state.settings.comfy.mode==='mock'?'当前：本地 SVG 演示模式':esc(state.settings.comfy.baseUrl)}<br>节点映射和工作流配置独立保留。</p>${btn('连接配置','settings','engine-info','','small')}${btn('测试','refresh','test-engine','style="margin-left:7px"','small')}</div><div class="connection-setting">${icon('spark')}<h3>LLM 与精修助手</h3><p>${llmMock()?'当前：离线规则模拟':esc(state.settings.llm.model)}<br>剧情台与精修助手共用兼容 API 设置。</p>${btn('模型与密钥','settings','llm-settings','','small')}</div></div><div class="divider"></div>${field('全局负向提示词',`<textarea data-setting="negative">${esc(state.settings.negative)}</textarea>`)}${settingsRow('批量出图后自动审校','连续 3 次失败后熔断，已生成画面始终保留。',`<label class="switch"><input type="checkbox" role="switch" aria-label="自动视觉审校" data-setting="autoCritique" ${state.settings.autoCritique?'checked':''} ${!featureEnabled('visualCritic')?'disabled':''}><span class="switch-track"></span></label>`,'shield')}<p class="help">${featureEnabled('visualCritic')?'可在“模块管理”中整体停用审校功能。':'视觉审校已停用，请先在模块管理中启用。'}</p></section><section class="settings-section"><h2>后台任务控制</h2><div class="settings-row"><div class="grow"><h3>图像渲染流水线</h3><p>${rt.running?'正在后台运行。':'当前没有运行中的本地任务。'}</p></div>${btn('中止图像任务','stop','interrupt','','small danger')}</div><div class="settings-row"><div class="grow"><h3>剧本推演流水线</h3><p>${rt.llmBusy?'正在推演，已完成的分段会自动保留。':'当前没有运行中的剧本推演。'}</p></div>${btn('停止推演','stop','stop-llm',rt.llmBusy?'':'disabled','small danger')}</div></section>`;
  if(tab==='export')content=`<section class="settings-section"><h2>让每次导出都有你的风格</h2><p>选择默认 HTML 模板；每次导出仍可单独调整主题色、签名与台词。</p>${settingsRow('默认画册模板','新打开的导出窗口会优先使用此模板。',`<select class="inline-setting" data-studio-pref="export.templateId" aria-label="默认导出模板">${state.exportTemplates.map(t=>opt(t.id,t.title,p.export.templateId)).join('')}</select>`,'book')}<div class="row" style="padding:14px 0">${btn('管理与自定义模板','edit','et-open-library','','small')}${featureEnabled('marketplace')?btn('从市场下载','box','et-settings-market','','small'):''}</div>${field('默认创作者签名',setting('signature',state.settings.signature))}${settingsRow('默认显示剧情台词','关闭后导出纯画面。',switchControl('export.showCaptions','默认导出台词',p.export.showCaptions),'story')}${settingsRow('默认附带提示词','开启后提示词会写入导出的离线 HTML。',switchControl('export.showPrompts','默认导出提示词',p.export.showPrompts),'edit')}${settingsRow('默认分镜框线','支持 0 至 8 px，0 为无框线。',`<input type="number" class="inline-setting" data-studio-pref="export.border" min="0" max="8" value="${p.export.border}" aria-label="默认分镜框线">`,'image')}</section><section class="settings-section"><h2>工程与数据</h2><div class="row wrap">${btn('工程备份与恢复','disk','backup')}${btn('系统自检','shield','diagnostics')}</div><div class="divider"></div>${settingsRow('恢复界面默认设置','只还原模块开关、阅读和导出默认值。不会删除模板、画册、角色或 API 配置。',btn('恢复默认','refresh','studio-reset','','small'),'refresh')}</section>`;
  return `<div class="settings-intro">${heading('工作室设置','让工具适应你的创作，而不是反过来。',btn('返回画廊','arrow','workspace','data-index="0"'),'YOUR STUDIO, YOUR WAY.')}</div><div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${tabs.map(([v,ic,l])=>`<button class="${tab===v?'active':''}" data-act="studio-tab" data-tab="${v}" ${tab===v?'aria-current="page"':''}>${icon(ic,'sm')}${l}</button>`).join('')}</nav><div id="studio-settings-content">${content}<div class="settings-summary">${icon('disk','sm')}更改即时生效，自动保存到本地。<span class="spacer"></span>v${MIO_VERSION}</div></div></div>`;
}

function variableEditor(entries,group,id){return `${entries.length?`<table class="variable-table"><thead><tr><th>变量 / 占位符</th><th>类型</th><th>内容</th><th></th></tr></thead><tbody>${entries.map(e=>`<tr><td><div class="row" style="gap:4px"><span class="mono grow">{${esc(e.key)}}</span>${ibtn('edit','v3-variable-rename','重命名变量',`data-group="${group}" data-id="${id}" data-entry="${e.id}"`)}</div></td><td><select data-v3-var="type" data-group="${group}" data-owner="${id}" data-entry="${e.id}" aria-label="${esc(e.key)} 的类型">${Object.entries(variableTypes).map(([v,l])=>opt(v,l,e.type)).join('')}</select></td><td>${e.type==='image'?imageVariableControl(e,group,id):e.type==='boolean'?`<select data-v3-var="value" data-group="${group}" data-owner="${id}" data-entry="${e.id}" aria-label="${esc(e.key)} 的值">${opt('true','开启 / true',String(e.value))}${opt('false','关闭 / false',String(e.value))}</select>`:e.type==='number'?input('value',e.value,'number',`data-v3-var="value" data-group="${group}" data-owner="${id}" data-entry="${e.id}" step="any" aria-label="${esc(e.key)} 的值"`):`<textarea data-v3-var="value" data-group="${group}" data-owner="${id}" data-entry="${e.id}" aria-label="${esc(e.key)} 的值" ${e.type==='json'?'spellcheck="false"':''}>${esc(typeof e.value==='object'?JSON.stringify(e.value,null,2):e.value)}</textarea>`}</td><td>${ibtn('trash','v3-variable-delete','删除变量',`data-group="${group}" data-id="${id}" data-entry="${e.id}"`)}</td></tr>`).join('')}</tbody></table>`:'<div class="variable-empty">这里没有固定字段。按需添加角色、场景、模型强度，或工作流需要的任何参数。</div>'}<div class="row" style="padding-top:13px">${btn('添加变量','plus','v3-variable-add',`data-group="${group}" data-id="${id}"`,'small')}<span class="tiny muted">在提示词中使用 {变量名}，节点中可以直接读取类型化的值。</span></div>`}

function renderAssistantOrb(){
  const orb=$('.assistant-launch');orb.classList.add('assistant-orb');orb.innerHTML=icon('spark')+'<span class="orb-copy"><strong>分镜精修助手</strong><small>用自然语言改提示词与台词</small></span>';orb.setAttribute('aria-label','拖动悬浮球，点击打开分镜精修助手');orb.hidden=!featureEnabled('assistant');
  if(!orb.dataset.orbInitialized){orb.dataset.orbInitialized='true';const p=state.settings.studio.shell.orbPosition;if(p){orb.style.right=clamp(p.right,12,innerWidth-58)+'px';orb.style.bottom=clamp(p.bottom,40,innerHeight-60)+'px'}
    orb.addEventListener('pointerdown',e=>{if(e.button!==0)return;const start={x:e.clientX,y:e.clientY,right:innerWidth-orb.getBoundingClientRect().right,bottom:innerHeight-orb.getBoundingClientRect().bottom};let moved=false;orb.setPointerCapture(e.pointerId);orb.onpointermove=event=>{const dx=event.clientX-start.x,dy=event.clientY-start.y;if(!moved&&Math.hypot(dx,dy)<5)return;moved=true;createUI.orbDragging=true;orb.classList.add('orb-dragging');orb.style.right=clamp(start.right-dx,12,Math.max(12,innerWidth-58))+'px';orb.style.bottom=clamp(start.bottom-dy,40,Math.max(40,innerHeight-58))+'px';orb.style.left='auto';orb.style.top='auto'};orb.onpointerup=orb.onpointercancel=()=>{orb.onpointermove=null;orb.classList.remove('orb-dragging');createUI.orbDragging=false;if(moved){createUI.orbIgnoreClick=true;state.settings.studio.shell.orbPosition={right:parseFloat(orb.style.right)||20,bottom:parseFloat(orb.style.bottom)||48};save();setTimeout(()=>createUI.orbIgnoreClick=false,100)}}});
    orb.addEventListener('pointerenter',()=>{if(createUI.orbDragging)return;const right=parseFloat(orb.style.right)||27;createUI.orbHoverRight=right;orb.style.right=clamp(right,12,Math.max(12,innerWidth-222))+'px'});orb.addEventListener('pointerleave',()=>{if(createUI.orbDragging)return;const right=state.settings.studio.shell.orbPosition?.right??createUI.orbHoverRight??27;orb.style.right=clamp(right,12,Math.max(12,innerWidth-58))+'px'});
  }
}

/* ---- Prompt editor surface -------------------------------------------------------------------------------------------
   A textarea with a mirrored, pointer-transparent paint layer underneath it. Templates render the whole surface directly
   (promptEditorHTML) so patchDOM keeps the textarea, its focus and IME session; only the paint layer is refreshed in place.
   The paint context decides which {names} are variables: 'plan' is the legacy storyboard editor (bound plan values),
   'workshop' is the story workshop, where a story is not bound to presets and the union of the collection's presets is used. */
const promptEditorBound=typeof WeakSet==='function'?new WeakSet():{has(){return false},add(){}};
function promptEscape(text){return String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&#60;','>':'&#62;','"':'&quot;',"'":'&#39;'})[char])}
function promptPolicyFor(){return (globalThis.ComfyComic&&globalThis.ComfyComic.promptPolicy)||(promptPolicyFor.fallback??=createFreePromptPolicy())}
function promptText(source,values={}){return typeof displayUI==='object'&&displayUI?.locale?localeString(source,values):String(source).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(whole,key)=>Object.hasOwn(values,key)?String(values[key]):whole)}
const PROMPT_VARIABLE_PATTERN=/\{([\p{L}\p{N}_]+)\}/gu;

/* Legacy plan context expressed in the shared shape {definitions, emptyKeys, sources, used}. */
function planPromptContext(){
  let values={},definitions;/* Outside the studio (tests, detached editors) there is no plan: no names are defined. */
  try{values=currentPromptContext()||{};definitions=definedPromptNames(values)}catch(e){definitions=new Set(Object.keys(values))}
  const emptyKeys=new Set([...definitions].filter(key=>!Object.hasOwn(values,key)||values[key]===''||values[key]===null||values[key]===undefined));
  return {kind:'plan',definitions,emptyKeys,sources:new Map(),used:new Map(),values};
}
function promptContextFor(kind){
  if(kind&&typeof kind==='object')return kind;
  if(kind==='workshop'&&typeof workshopPromptContext==='function')return workshopPromptContext();
  return planPromptContext();
}

/* Classifies every isolated {name}: declared (accent), declared-but-empty (muted), or unknown (dotted). Unknown names are only
   marked, never rewritten: {{weight}} groups, \{ escapes and nested braces are skipped exactly as the replacement policy does. */
function promptVariableReport(text,context={}){
  const known=context.definitions instanceof Set?context.definitions:new Set(context.definitions||[]);
  const empty=context.emptyKeys instanceof Set?context.emptyKeys:new Set(context.emptyKeys||[]);
  const candidates=new Set(known);
  if(context.markUnknown!==false)for(const match of String(text??'').matchAll(PROMPT_VARIABLE_PATTERN))candidates.add(match[1]);
  const tokens=promptPolicyFor().tokens(text,candidates).map(part=>part.type!=='variable'?part:{...part,state:!known.has(part.key)?'unknown':empty.has(part.key)?'empty':'defined'});
  const variables=tokens.filter(part=>part.type==='variable');
  const unique=state=>[...new Set(variables.filter(part=>part.state===state).map(part=>part.key))];
  return {tokens,variables,defined:unique('defined'),empty:unique('empty'),unknown:unique('unknown')};
}
function promptTokenMarkup(text,context={}){
  return promptVariableReport(text,context).tokens.map(part=>part.type==='variable'
    ?`<mark class="${part.state==='unknown'?'unknown-token':part.state==='empty'?'empty-token':''}" data-prompt-variable="${promptEscape(part.key)}" data-state="${part.state}">${promptEscape(part.value)}</mark>`
    :promptEscape(part.value)).join('');
}
function promptSummaryText(text,context={}){
  const report=promptVariableReport(text,context);
  if(!report.variables.length)return promptText('只有已定义的 {变量名} 会高亮。其他括号、权重与符号原样保留。');
  const parts=[promptText('识别到 {n} 个变量',{n:new Set(report.variables.map(part=>part.key)).size})];
  if(report.unknown.length)parts.push(promptText('{n} 个未定义（{names}）',{n:report.unknown.length,names:report.unknown.join(', ')}));
  if(report.empty.length)parts.push(promptText('{n} 个值为空（{names}）',{n:report.empty.length,names:report.empty.join(', ')}));
  return parts.join(' · ');
}

function promptEditorHTML({attrs='',value='',placeholder='',context='plan',className=''}={}){
  const text=String(value??''),resolved=promptContextFor(context),kind=typeof context==='string'?context:(resolved.kind||'plan');
  return `<div class="prompt-surface${className?' '+className:''}" data-prompt-context="${promptEscape(kind)}"><div class="prompt-paint-viewport" aria-hidden="true"><pre class="prompt-paint">${promptTokenMarkup(text,resolved)}\n</pre></div><textarea ${attrs}${placeholder?` placeholder="${promptEscape(placeholder)}"`:''} spellcheck="false">${promptEscape(text)}</textarea></div><div class="prompt-editor-foot"><div class="prompt-foot"><i class="dot"></i><span class="prompt-summary">${promptEscape(promptSummaryText(text,resolved))}</span></div><p class="prompt-hint" hidden></p></div>`;
}

function paintPromptEditor(textarea){
  const wrapper=textarea.closest('.prompt-surface');if(!wrapper)return;const pre=wrapper.querySelector('.prompt-paint');if(!pre)return;
  const context=promptContextFor(wrapper.dataset.promptContext);
  pre.innerHTML=promptTokenMarkup(textarea.value,context)+'\n';pre.style.width=textarea.clientWidth+'px';pre.style.transform=`translate(${-textarea.scrollLeft}px,${-textarea.scrollTop}px)`;
  const foot=wrapper.nextElementSibling;const summary=foot?.querySelector('.prompt-summary');if(summary)summary.textContent=promptSummaryText(textarea.value,context);
  const hint=foot?.querySelector('.prompt-hint');if(hint){hint.hidden=!promptPolicyFor().hasUnclosedBrace(textarea.value);hint.textContent=promptText('变量花括号尚未闭合；提示词权重写法可忽略。')}
}

function attachPromptEditors(){
  artUI.editorObserver?.disconnect();const observers=[];
  for(const textarea of $$('textarea[data-v3-frame="prompt"],textarea[data-v3-frame="negative"],.prompt-surface>textarea')){
    let wrapper=textarea.closest('.prompt-surface');
    if(!wrapper){/* Legacy editors are not rendered with a surface; wrap them after render exactly as before. */
      wrapper=document.createElement('div');wrapper.className='prompt-surface';wrapper.dataset.promptContext='plan';const overlay=document.createElement('div');overlay.className='prompt-paint-viewport';overlay.setAttribute('aria-hidden','true');overlay.innerHTML='<pre class="prompt-paint"></pre>';textarea.before(wrapper);wrapper.append(overlay,textarea);
      const foot=document.createElement('div');foot.className='prompt-editor-foot';foot.innerHTML='<div class="prompt-foot"><i class="dot"></i><span class="prompt-summary"></span></div><p class="prompt-hint" hidden></p>';wrapper.after(foot);
    }
    if(!promptEditorBound.has(textarea)){promptEditorBound.add(textarea);textarea.addEventListener('scroll',()=>paintPromptEditor(textarea),{passive:true});textarea.addEventListener('input',()=>paintPromptEditor(textarea));textarea.spellcheck=false}
    paintPromptEditor(textarea);observers.push(textarea);
  }
  if(window.ResizeObserver){artUI.editorObserver=new ResizeObserver(entries=>entries.forEach(e=>paintPromptEditor(e.target)));observers.forEach(e=>artUI.editorObserver.observe(e))}
}
