/* Mio assistant: feature declarations; initialization remains in app.js. */
'use strict';
async function chatCompletion(messages,tools,signal,cfg=state.settings.llm){const url=cfg.baseUrl.replace(/\/+$/,'')+'/chat/completions',body={model:cfg.model,messages,temperature:.75};if(tools){body.tools=tools;body.tool_choice='auto'}const headers={'Content-Type':'application/json'};if(cfg.key)headers.Authorization='Bearer '+cfg.key;const response=await request(url,{method:'POST',headers,body:JSON.stringify(body),signal},90000),json=await response.json(),msg=json.choices?.[0]?.message;if(!msg||msg.role!=='assistant')throw Error('兼容 API 未返回合法的 assistant 消息。');if(msg.tool_calls&&(!Array.isArray(msg.tool_calls)||msg.tool_calls.some(c=>typeof c.id!=='string'||!c.function||typeof c.function.name!=='string'||typeof c.function.arguments!=='string')))throw Error('模型工具调用协议不完整，已拒绝写入会话。');return msg}

function critiqueHTML(c,i){if(!c)return'';return`<div class="score-block"><div class="row"><div class="score-ring" style="--score:${c.score}"><span>${c.score.toFixed(1)}</span></div><div><strong>${c.score>=9?'S':c.score>=8?'A':c.score>=7?'B':'C'} · ${c.passed?'审校通过':'建议精修'}</strong><div class="tiny muted">${state.settings.llm.mode==='mock'?'本地模拟审校':'视觉审校报告'}</div></div></div><p>${esc(c.summary)}</p><details><summary>查看结构与一致性诊断</summary><p><b>解剖：</b>${esc(c.anatomy)}</p><p><b>一致性：</b>${esc(c.consistency)}</p></details><p>${esc(c.suggestions)}</p>${btn('填入重绘框','plus','apply-critique',`data-index="${i}"`,'small ghost')}</div>`}

async function critiqueStep(id,i,automatic=false){
const b=bookBy(id),s=b?.steps.find(s=>s.stepIndex===i);if(!s?.image)throw Error('本页尚未生成。');const key=id+':'+i;if(rt.critiqueBusy.has(key))return;rt.critiqueBusy.add(key);
const snapshot=s.image,area=ui.bookId===id?$('#critique-'+i):null,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),automatic?15000:90000);if(area)area.innerHTML='<p class="help"><i class="dot live"></i> 正在审校画面...</p>';
try{let c;if(llmMock()){await delay(750,controller.signal);const n=7.2+(hash(snapshot)%24)/10;c={score:n,passed:n>=7,summary:'离线模拟审校：画面叙事完整，主角与环境的层次关系清晰。',anatomy:'模拟诊断：建议在真实模型中进一步检查手部、五官与透视。',consistency:'模拟诊断：以角色参考立绘为准核对发色与服装细节。',suggestions:'soft rim lighting, consistent character design, refined hands, detailed eyes'}}
else{let jpg;try{jpg=await rasterJPEG(snapshot)}catch(e){if(s.offlineImage){jpg=await rasterJPEG(s.offlineImage);log('参考封面受跨域限制，审校内置矢量版本。','warn')}else throw e}const content=[{type:'text',text:'角色 '+b.characterName+'；分镜 '+s.name+'；旁白 '+s.caption+'。第一张图片为待审校画面。'},{type:'image_url',image_url:{url:jpg}}],ref=rowBy(b.rowId)?.references?.front;if(ref){content.push({type:'text',text:'以下图片是角色参考立绘，请检查角色与服装一致性。'},{type:'image_url',image_url:{url:await rasterJPEG(ref)}})}const m=await chatCompletion([{role:'system',content:'你是专业漫画视觉审校员。仅返回JSON: {"score":1到10的数字,"passed":布尔,"summary":"整体评价","anatomy":"解剖诊断","consistency":"连续性诊断","suggestions":"具体英文精修提示词"}。严格区分可观察信息与推测，没有参考图时不要声称完成跨帧对照。'},{role:'user',content}],null,controller.signal);c=parseJson(m.content);if(!Number.isFinite(c.score)||['summary','anatomy','consistency','suggestions'].some(k=>typeof c[k]!=='string'))throw Error('审校报告字段不符合数据契约。');c.score=clamp(c.score,1,10);c.passed=c.score>=7}
if(bookBy(id)?.steps.find(x=>x.stepIndex===i)?.image!==snapshot){log('图片已变化，丢弃过期审校报告。','warn');return}s.critique=c;b.updatedAt=Date.now();save();if(ui.bookId===id&&$('#critique-'+i))$('#critique-'+i).innerHTML=critiqueHTML(c,i);return c;
}catch(e){if(area?.isConnected)area.innerHTML=`<p class="help danger">${esc(e.message)}</p>`;throw e}finally{clearTimeout(timer);rt.critiqueBusy.delete(key)}}

function showAssistant(){flushEditor();if($('#reader').open)$('#reader').append($('#assistant'));else document.body.append($('#assistant'));$('#assistant').hidden=false;renderAssistant();$('#chat-input').focus()}

function setupAssistantPointer(){const panel=$('#assistant');panel.onpointerdown=e=>{const resize=e.target.closest('[data-resize]'),drag=e.target.closest('#assistant-drag');if(!resize&&(!drag||e.target.closest('button')))return;if(panel.classList.contains('fullscreen'))return;const rect=panel.getBoundingClientRect(),x=e.clientX,y=e.clientY,d=resize?.dataset.resize;panel.style.right='auto';panel.style.bottom='auto';panel.style.left=rect.left+'px';panel.style.top=rect.top+'px';panel.setPointerCapture(e.pointerId);panel.onpointermove=ev=>{const dx=ev.clientX-x,dy=ev.clientY-y;let w=rect.width,h=rect.height,left=rect.left,top=rect.top;if(d){if(d.includes('e'))w+=dx;if(d.includes('s'))h+=dy;if(d.includes('w')){w-=dx;left+=dx}if(d.includes('n')){h-=dy;top+=dy}w=clamp(w,290,innerWidth);h=clamp(h,300,innerHeight-15);left=clamp(left,0,innerWidth-w);top=clamp(top,0,innerHeight-h)}else{left=clamp(left+dx,0,innerWidth-w);top=clamp(top+dy,0,innerHeight-h)}Object.assign(panel.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'})};panel.onpointerup=()=>{panel.onpointermove=null;const r=panel.getBoundingClientRect();if(r.left<24)panel.style.left='10px';if(innerWidth-r.right<24)panel.style.left=innerWidth-r.width-10+'px';if(r.top<24)panel.style.top='10px'};panel.onpointercancel=()=>panel.onpointermove=null}}

function assistantScope(){
  if(rt.chatBusy&&studioUI.assistantTargetId)return templateBy(studioUI.assistantTargetId);
  if($('#reader').open){const b=bookBy(ui.bookId);if(b)return templateBy(b.templateId)}
  return currentTemplate();
}

function renderScopedAssistant(){
  const chat=currentChat(),scope=assistantScope(),hasUser=chat.messages.some(m=>m.role==='user'),draft=$('#chat-input')?.value??studioUI.assistantDraft;
  $('#assistant').innerHTML=`<header class="assistant-head" id="assistant-drag">${icon('spark')}<div class="grow"><strong>分镜精修助手</strong><small class="assistant-model-state">${rt.chatBusy?'正在处理 · 目标已锁定':llmMock()?'离线规则模式':'模型 · '+esc(state.settings.llm.model||'尚未配置')}</small></div>${ibtn('settings','llm-settings','助手模型与连接设置')}${ibtn('expand','assistant-full','展开或还原窗口')}${ibtn('close','assistant-close','收起精修助手')}</header>
  <div class="assistant-scope"><div class="row"><span>${rt.chatBusy?'本次操作已锁定目标':'作用范围 / SOURCE TEMPLATE'}</span><span class="spacer"></span><span class="accent tiny">${llmMock()?'离线规则模式':'真实模型 · '+esc(state.settings.llm.model)}</span></div><div class="row"><strong class="grow">${esc(scope?.title||'尚未选择分镜模板')}</strong>${scope&&workspaceVisible(1)?ibtn('arrow','assistant-open-target','在分镜工作区查看此模板'):''}</div><p>只改源模板，不修改已有画册，也不编辑导出的 HTML 版式。</p></div>
  <div class="assistant-tabs"><select id="chat-select" aria-label="选择创作对话" ${rt.chatBusy?'disabled':''}>${state.chats.map(c=>opt(c.id,c.title,state.activeChatId)).join('')}</select>${ibtn('plus','new-chat','开启新的创作对话')}${ibtn('refresh','assistant-undo','撤销上次助手修改',!studioUI.assistantUndo||rt.chatBusy?'disabled':'')}</div>
  <div class="chat-messages" id="chat-messages">${!hasUser?`<section class="assistant-intro"><div class="assistant-motif" aria-hidden="true"><svg viewBox="0 0 88 72" fill="none"><rect x="12" y="13" width="44" height="48" rx="7" transform="rotate(-12 12 13)" stroke="currentColor" opacity=".24"/><rect x="28" y="12" width="44" height="48" rx="7" fill="var(--panel)" stroke="currentColor" opacity=".8"/><path d="M37 45l9-10 8 8 7-6M38 23h16" stroke="currentColor" stroke-linecap="round"/><path d="M70 1l2.8 7.2L80 11l-7.2 2.8L70 21l-2.8-7.2L60 11l7.2-2.8z" fill="var(--panel)" stroke="currentColor"/></svg></div><div class="assistant-kicker">MIO · STORYBOARD COMPANION</div><h3>让下一幕，<br><em>更接近你的想象。</em></h3><p>改场景、润色台词，或为故事添上一幕。</p><div class="assistant-suggestions">${[['edit','改写场景','把第 1 幕改成雨夜车站','雨夜、车站，以及新的氛围'],['story','润色台词','把第 2 幕的台词改成：我们终于又见面了。','让对白更自然，让情绪更细腻'],['plus','续写一幕','新增一幕：她在海边找到那封信。','给还未结束的故事一个转折']].map(([ic,title,v,l])=>`<button class="assistant-suggestion" data-act="assistant-suggestion" data-text="${esc(v)}">${icon(ic)}<span class="grow"><strong>${title}</strong><small>${l}</small></span>${icon('arrow','sm')}</button>`).join('')}</div><div class="assistant-privacy">${icon('shield','sm')}<span>${llmMock()?'离线规则模式 · 不会发送到云端':'文本与附件将发送至你配置的模型'}</span></div></section>`:''}
  ${chat.messages.map(m=>{
    if(m.role==='tool')return'';
    if(m.tool_calls){const outputs=m.tool_calls.map(c=>chat.messages.find(x=>x.role==='tool'&&x.tool_call_id===c.id)).filter(Boolean);const errors=outputs.filter(m=>{try{return Boolean(JSON.parse(m.content).error)}catch(e){return false}}).length;return `<details class="tool-result"><summary>${errors?'本批有 '+errors+' 项未应用':'已处理 '+m.tool_calls.length+' 项模板操作'}</summary><div class="assistant-tool-detail">${m.tool_calls.map(c=>esc(toolLabels[c.function.name]||c.function.name)).join('<br>')}</div>${errors?`<pre>${esc(outputs.map(o=>{try{return JSON.parse(o.content).error||''}catch(e){return''}}).filter(Boolean).join('\n'))}</pre>`:''}</details>`}
    if(!hasUser&&m.role==='assistant')return'';
    const content=typeof m.content==='string'?m.content:(m.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
    const images=Array.isArray(m.content)?m.content.filter(x=>x.type==='image_url'):[];
    return `<div class="chat-bubble ${m.role==='user'?'user':''}">${esc(content)}${images.map(x=>imgTag(x.image_url.url,'本条消息的参考附件','class="assistant-attachment-preview"')).join('')}</div>`;
  }).join('')}${rt.chatBusy?'<div class="chat-bubble"><i class="dot live"></i> 正在处理已锁定模板...</div>':''}</div>
  <div class="chat-compose"><div class="attachments">${rt.attachments.map((a,i)=>`<span class="row">${a.image?imgTag(a.image,a.name):icon('attach','sm')}${esc(a.name)}${ibtn('close','remove-attachment','移除附件',`data-index="${i}"`)}</span>`).join('')}</div><textarea id="chat-input" placeholder="例如：把第 1 幕改成雨夜车站..." aria-label="描述对分镜模板的修改">${esc(draft)}</textarea><div class="row" style="margin-top:7px">${ibtn('attach','chat-attach','上传图片、TXT 或 DOCX')}<label class="assistant-edit-gate grow"><input type="checkbox" data-studio-pref="assistant.confirmChanges" ${state.settings.studio.assistant.confirmChanges?'checked':''}>修改前确认</label>${rt.chatBusy?btn('停止','stop','assistant-stop','','small'):btn('发送','send','send-chat','','small primary')}</div><div class="help" style="margin-top:4px;font-size:9px">Enter 发送 · Shift + Enter 换行 · 可拖动或缩放窗口</div></div>${['n','s','e','w','ne','nw','se','sw'].map(d=>`<i class="resize-handle ${d}" data-resize="${d}"></i>`).join('')}`;
  $('#chat-messages').scrollTop=hasUser?$('#chat-messages').scrollHeight:0;setupAssistantPointer();updateAssistantDisclosure();
}

function updateAssistantDisclosure(){const p=$('.assistant-intro p');if(p)p.textContent='改场景、润色台词，或为故事添上一幕。'+(state.settings.studio.assistant.confirmChanges?' 修改前，由你确认。':' 已关闭确认，修改将直接应用。');}

function showScopedAssistant(){
  if(!featureEnabled('assistant')){toast('精修助手已停用。可在“设置 → 模块管理”中重新启用。');return}
  flushEditor();const parent=$('#reader').open?$('#reader'):document.body;parent.append($('#assistant'));$('#assistant').hidden=false;renderAssistant();$('#chat-input').focus();
}

async function undoAssistantEdit(){
  if(rt.chatBusy)throw Error('请等待本次助手操作结束。');const u=studioUI.assistantUndo;if(!u)throw Error('暂无可撤销的助手修改。');flushEditor();const t=templateBy(u.templateId);
  if(!t||JSON.stringify(t)!==u.afterText)throw Error('模板在助手修改后又有新编辑。为避免覆盖，请手动调整。');
  if(!await confirmAction('撤销上次助手修改？','将「'+t.title+'」还原为上次助手操作前的状态。','撤销修改'))return;
  Object.assign(t,clone(u.before));studioUI.assistantUndo=null;currentChat().messages.push({role:'assistant',content:'已按你的要求撤销上次助手修改，恢复「'+t.title+'」。'});save(true);if(ui.workspace===1)render();renderAssistant();toast('上次助手修改已撤销。');
}

function decorateAssistantContext(){
  const container=$('#assistant');if(!container||container.hidden)return;const chat=currentChat(),template=assistantScope(),proj=state.projects.find(p=>p.id===template?.projectId),scope=$('.assistant-scope',container);
  if(scope)scope.innerHTML=`<div class="row"><span class="scope-project">${esc(proj?.title||'未绑定企划')}</span><span class="spacer"></span><span class="tiny muted">${rt.chatBusy?'处理中 · 目标已锁定':llmMock()?'离线规则模式':'真实模型'}</span></div><div class="row"><strong class="grow">${esc(template?.title||'请明确选择要修改的源模板')}</strong>${template&&workspaceVisible(1)?ibtn('arrow','assistant-open-target','在工作区打开绑定模板'):''}</div><p>此对话始终绑定以上模板。切换企划不会悄悄改变修改目标。</p>`;
  if(!$('.assistant-target-context',container))scope?.insertAdjacentHTML('afterend',`<div class="assistant-target-context"><label class="label" for="assistant-target">修改目标</label><select class="assistant-target-select" id="assistant-target" ${rt.chatBusy?'disabled':''}>${state.templates.map(t=>opt(t.id,(state.projects.find(p=>p.id===t.projectId)?.title||'企划')+' / '+t.title,template?.id)).join('')||'<option value="">尚无模板</option>'}</select></div>`);
  const tabs=$('.assistant-tabs',container),select=$('#chat-select');if(select){select.innerHTML=state.chats.filter(c=>template?c.templateId===template.id:c.id===chat.id).map(c=>opt(c.id,c.title,c.id===chat.id?c.id:'')).join('');select.setAttribute('aria-label','当前绑定模板的对话记录');if(!$('.assistant-session-label',tabs))tabs.insertAdjacentHTML('afterbegin','<span class="assistant-session-label">对话记录</span>')}
  const textarea=$('#chat-input'),compose=$('.chat-compose',container);if(textarea){textarea.style.height=detailUI.assistantHeight+'px';textarea.style.resize='vertical';if(!$('.assistant-input-top',compose))textarea.insertAdjacentHTML('beforebegin',`<div class="assistant-input-top"><span>编辑指令</span><span class="spacer"></span><span>可拖动右下角调整高度</span>${ibtn('expand','assistant-input-expand','展开或还原输入区')}</div>`);detailUI.assistantObserver?.disconnect();if(window.ResizeObserver){detailUI.assistantObserver=new ResizeObserver(entries=>{const h=entries[0]?.target.getBoundingClientRect().height;if(h>70)detailUI.assistantHeight=Math.round(h)});detailUI.assistantObserver.observe(textarea)}}
  container.classList.toggle('input-expanded',detailUI.assistantExpanded);
  if(template&&template.projectId!==state.activeProjectId&&!$('.assistant-context-note',container))$('#chat-messages').insertAdjacentHTML('afterbegin',`<p class="assistant-context-note">当前页面属于「${esc(project().title)}」，此对话仍绑定「${esc(proj?.title)}」。请用上方目标选择器明确切换。</p>`);
}

function fitAssistantWindow(){
  const panel=$('#assistant');if(!panel||panel.hidden)return;
  const available=Math.max(220,innerHeight-24),r=panel.getBoundingClientRect();
  if(!panel.classList.contains('fullscreen')){
    const width=clamp(r.width,Math.min(310,innerWidth-24),Math.max(280,innerWidth-24)),height=clamp(r.height,Math.min(440,available),available);
    if(Math.abs(r.width-width)>.5)panel.style.width=width+'px';if(Math.abs(r.height-height)>.5)panel.style.height=height+'px';
    if(r.left<12||r.right>innerWidth-12){panel.style.left=clamp(r.left,12,Math.max(12,innerWidth-width-12))+'px';panel.style.right='auto'}
    if(r.top<12||r.bottom>innerHeight-12){panel.style.top=clamp(r.top,12,Math.max(12,innerHeight-height-12))+'px';panel.style.bottom='auto'}
  }
  panel.classList.toggle('compact-height',panel.clientHeight<430);
  const head=$('.assistant-head',panel),context=$('.assistant-context-scroll',panel),compose=$('.chat-compose',panel);if(!compose)return;
  const h=panel.clientHeight,style=getComputedStyle(compose),visible=[...compose.children].filter(e=>getComputedStyle(e).display!=='none'),chrome=visible.filter(e=>e.tagName!=='TEXTAREA').reduce((n,e)=>n+e.offsetHeight,0)+(parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0)+(parseFloat(style.rowGap)||0)*Math.max(0,visible.length-1),headHeight=head?.offsetHeight||54;
  const contextMax=Math.max(0,Math.min(225,h*.34,h-headHeight-chrome-92));if(context&&context.style.maxHeight!==contextMax+'px')context.style.maxHeight=contextMax+'px';
  const composerAvailable=Math.max(chrome+32,h-headHeight-(context?.offsetHeight||0)-46),maxComposer=Math.max(chrome+32,Math.min(460,composerAvailable)),limits={min:Math.min(chrome+60,maxComposer),max:maxComposer},size=clamp(releaseUI.composerSize,limits.min,limits.max);releaseUI.composerLimits=limits;
  if(panel.style.getPropertyValue('--composer-height')!==size+'px')panel.style.setProperty('--composer-height',size+'px');
  const grip=$('.compose-divider',panel);if(grip){grip.setAttribute('aria-valuenow',Math.round(size));grip.setAttribute('aria-valuemin',limits.min);grip.setAttribute('aria-valuemax',limits.max)}
}

function scheduleAssistantFit(){cancelAnimationFrame(releaseUI.composerRAF);releaseUI.composerRAF=requestAnimationFrame(fitAssistantWindow)}

function boundAssistantComposer(){
  const panel=$('#assistant');if(!panel||panel.hidden)return;
  detailUI.assistantObserver?.disconnect();releaseUI.composerObserver?.disconnect();
  const head=$('.assistant-head',panel),scope=$('.assistant-scope',panel),target=$('.assistant-target-context',panel),tabs=$('.assistant-tabs',panel);
  let context=$('.assistant-context-scroll',panel);if(!context){context=document.createElement('div');context.className='assistant-context-scroll';head.after(context);for(const e of [scope,target,tabs])if(e)context.append(e)}
  const openTarget=$('[data-act="assistant-open-target"]',scope);if(openTarget&&target){openTarget.classList.add('assistant-target-link');target.append(openTarget)}
  const compose=$('.chat-compose',panel),textarea=$('#chat-input');
  if(!compose||!textarea)return;
  panel.classList.toggle('assistant-is-empty',!currentChat().messages.some(m=>m.role==='user'));
  textarea.style.removeProperty('height');textarea.style.setProperty('resize','none','important');
  const actions=[...compose.children].find(e=>e.classList.contains('row')&&e.querySelector('[data-act="send-chat"],[data-act="assistant-stop"]'));if(actions)actions.classList.add('composer-actions');
  const help=[...compose.children].find(e=>e.classList.contains('help'));if(help){help.classList.add('composer-help');help.textContent=matchMedia('(pointer:coarse)').matches?localeString('回车换行 · 点击发送按钮提交'):'Enter 发送 · Shift + Enter 换行'}
  const top=$('.assistant-input-top',compose);if(top)top.innerHTML='<span>编辑指令</span><span class="spacer"></span>'+ibtn('expand','assistant-input-expand','展开或还原输入区域');
  if(!$('.compose-divider',compose)){
    const grip=document.createElement('div');grip.className='compose-divider';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','horizontal');grip.setAttribute('aria-label','调整输入区高度；可拖动，或使用上下方向键');compose.prepend(grip);
    grip.onpointerdown=e=>{e.preventDefault();e.stopPropagation();const start=e.clientY,size=compose.getBoundingClientRect().height;grip.setPointerCapture(e.pointerId);grip.onpointermove=move=>{const limits=releaseUI.composerLimits||composerBounds(panel.clientHeight,head.offsetHeight,context.offsetHeight);releaseUI.composerSize=clamp(size+start-move.clientY,limits.min,limits.max);fitAssistantWindow()};grip.onpointerup=grip.onpointercancel=()=>grip.onpointermove=null};
    grip.onkeydown=e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const limits=releaseUI.composerLimits||composerBounds(panel.clientHeight,head.offsetHeight,context.offsetHeight);releaseUI.composerSize=e.key==='Home'?limits.min:e.key==='End'?limits.max:clamp(compose.offsetHeight+(e.key==='ArrowUp'?20:-20),limits.min,limits.max);fitAssistantWindow()};
  }
  panel.classList.remove('input-expanded');
  if(window.ResizeObserver){releaseUI.composerObserver=new ResizeObserver(scheduleAssistantFit);releaseUI.composerObserver.observe(panel);releaseUI.composerObserver.observe(head);releaseUI.composerObserver.observe(context)}
  fitAssistantWindow();
}

function boundedAssistantPointer(){
  const panel=$('#assistant');panel.onpointerdown=e=>{
    if(e.target.closest('.compose-divider'))return;
    const resize=e.target.closest('[data-resize]'),drag=e.target.closest('#assistant-drag');
    if((!resize&&(!drag||e.target.closest('button')))||panel.classList.contains('fullscreen'))return;
    const r=panel.getBoundingClientRect(),x=e.clientX,y=e.clientY,direction=resize?.dataset.resize;
    panel.style.right='auto';panel.style.bottom='auto';panel.style.left=r.left+'px';panel.style.top=r.top+'px';panel.setPointerCapture(e.pointerId);
    panel.onpointermove=event=>{const dx=event.clientX-x,dy=event.clientY-y;let w=r.width,h=r.height,left=r.left,top=r.top;const minWidth=Math.min(310,innerWidth-24),minHeight=Math.min(420,innerHeight-24);
      if(direction){if(direction.includes('e'))w=clamp(r.width+dx,minWidth,innerWidth-left-12);if(direction.includes('s'))h=clamp(r.height+dy,minHeight,innerHeight-top-12);if(direction.includes('w')){w=clamp(r.width-dx,minWidth,r.right-12);left=r.right-w}if(direction.includes('n')){h=clamp(r.height-dy,minHeight,r.bottom-12);top=r.bottom-h}}
      else{left=clamp(left+dx,12,Math.max(12,innerWidth-w-12));top=clamp(top+dy,12,Math.max(12,innerHeight-h-12))}
      Object.assign(panel.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'});scheduleAssistantFit();
    };
    panel.onpointerup=panel.onpointercancel=()=>{panel.onpointermove=null;fitAssistantWindow()};
  };
}

function openCriticSettings(){
  const c=state.settings.critic;releaseUI.criticDraft=c;
  $('#critic-dialog').innerHTML=`<header class="modal-head">${icon('shield')}<div class="grow"><h2 id="critic-title">视觉审校 API</h2><p>连接能理解图片的模型，获得可执行的诊断与重绘建议。</p></div>${ibtn('close','critic-close','关闭审校配置')}</header><div class="service-body"><div class="grid2">${field('运行模式',`<select data-critic-field="mode" aria-label="审校运行模式">${opt('mock','离线演示：不调用 API',c.mode)}${opt('real','真实视觉 API',c.mode)}</select>`)}${field('连接来源',`<select data-critic-field="connection" aria-label="审校连接来源">${opt('independent','独立配置（推荐）',c.connection)}${opt('shared','复用 LLM 的地址、模型与密钥',c.connection)}</select>`)}</div>${c.connection==='independent'?`${field('服务商预设',`<select id="critic-provider" aria-label="视觉服务商">${[['openai','OpenAI'],['ollama','Ollama 本地视觉模型'],['custom','自定义 OpenAI 兼容视觉接口']].map(x=>opt(...x,c.provider)).join('')}</select>`)}${field('Base URL',input('baseUrl',c.baseUrl,'url','data-critic-field="baseUrl" placeholder="https://api.openai.com/v1" autocomplete="off"'),'系统会调用 /chat/completions，不是图像生成接口。')}${field('API Key',`<div class="service-key">${input('key',c.key,'password','data-critic-field="key" autocomplete="off" spellcheck="false" aria-label="视觉审校 API Key"')}${ibtn('eye','critic-key-toggle','显示或隐藏 API Key')}</div>`,'密钥仅在本次会话使用；是否写入磁盘由“文件与保存 → API 密钥”控制。')}${field('视觉模型名称',input('model',c.model,'text','data-critic-field="model" placeholder="例如 gpt-4o 或本地视觉模型"'),'纯文本模型不能进行图像审校。请使用你的服务商实际支持的视觉模型。')}`:`<div class="service-context"><strong>复用的连接参数</strong><br>${esc(state.settings.llm.baseUrl)}<br>${esc(state.settings.llm.model)}<br>${state.settings.llm.key?'已配置密钥':'未配置密钥'}</div><p class="service-note">只复用连接参数。审校模式仍由上方选择；纯文本剧情模型不能自动获得视觉能力。</p>${btn('修改共享连接','settings','critic-shared-settings','','small')}`}<hr class="service-divider"><div class="grid2">${field('单次超时 / 秒',input('timeout',c.timeout,'number','data-critic-field="timeout" min="15" max="180"'))}${field('报告通过标准','<div class="service-context" style="padding:7px 12px">7 / 10 分及以上</div>')}</div><div class="row wrap" style="margin-bottom:15px"><label class="row small soft"><input type="checkbox" data-critic-field="includeReference" ${c.includeReference?'checked':''}>附带角色参考立绘</label><label class="row small soft"><input type="checkbox" data-critic-field="includePrevious" ${c.includePrevious?'checked':''}>附带前一幕画面</label></div>${field('审校重点',`<textarea data-critic-field="focus" style="min-height:65px" aria-label="视觉审校重点">${esc(c.focus)}</textarea>`)}<div class="service-note">带图测试会向已配置的视觉服务发送一张本地几何测试图，可能产生少量 API 费用。真实审校失败时会显示原因，不会静默回退为模拟评分。</div><div id="critic-test-result" class="service-test-result"><span class="service-status">${esc(criticReadyLabel())}</span></div></div><footer class="service-footer"><span class="grow service-status">${disk.root?'配置更改将自动落盘；密钥遵循保存开关。':'当前为临时会话，记得连接目录保存设置。'}</span>${releaseUI.criticTesting?btn('停止测试','stop','critic-test-stop'):btn('带图测试连接','image','critic-test','','primary')}${btn('保存并关闭','check','critic-close')}</footer>`;
  if(!$('#critic-dialog').open)$('#critic-dialog').showModal();
}

async function testCriticConnection(){
  if(releaseUI.criticTesting)return;const c=criticConfig();if(c.mode!=='real')throw Error('请先切换为“真实视觉 API”并填写连接参数。');normalizedChatEndpoint(c.baseUrl);
  releaseUI.criticTesting=true;releaseUI.criticController=new AbortController();const signature=criticConfigSignature(c),image=visionProbeImage();
  const area=$('#critic-test-result');if(area)area.innerHTML=`<div class="row">${imgTag(image,'本地几何图形测试','class="critic-sample-image"')}<span class="service-status"><i class="dot live"></i> 正在发送图片并验证视觉响应...</span></div>`;
  const button=$('[data-act="critic-test"]');if(button){button.dataset.act='critic-test-stop';button.innerHTML=icon('stop')+'停止测试'}
  try{const answer=await visionRequest([{role:'system',content:'Identify the geometric shape on the left and on the right in the provided image. Reply only with a JSON object with keys left and right. Use single lowercase English shape names.'},{role:'user',content:[{type:'text',text:'Identify the two shapes in this image.'},{type:'image_url',image_url:{url:image}}]}],c,releaseUI.criticController.signal);const result=parseJson(answer);if(String(result.left).toLowerCase()!=='circle'||String(result.right).toLowerCase()!=='square')throw Error('接口返回了内容，但没有正确识别测试图的左右形状。请确认模型支持图像输入。');if(signature!==criticConfigSignature())throw Error('测试期间配置已变化，请用当前参数重新测试。');state.settings.critic.verification={signature,at:Date.now(),model:c.model};releaseUI.criticTest={ok:true,time:Date.now()};save();if(area?.isConnected)area.innerHTML=`<div class="row">${imgTag(image,'验证成功的几何测试图','class="critic-sample-image"')}<span class="service-status success">带图测试通过：正确识别左侧圆形与右侧正方形。<br>${esc(c.model)} · ${new Date().toLocaleTimeString()}</span></div>`;toast('视觉 API 带图测试已通过。')}
  catch(e){const message=safeServiceError(e);releaseUI.criticTest={ok:false,message};if(area?.isConnected)area.innerHTML=`<p class="service-status error">${esc(message)}</p>`;throw Error(message)}
  finally{releaseUI.criticTesting=false;releaseUI.criticController=null;if(button?.isConnected){button.dataset.act='critic-test';button.innerHTML=icon('image')+'带图测试连接'}}
}

function renderCriticEntry(){
  if(!$('#reader').open)return;const inspector=$('.reader-inspector');if(!inspector)return;
  let box=$('.critic-entry',inspector);if(!box){box=document.createElement('section');box.className='critic-entry';$('.inspector-label',inspector).after(box)}
  box.hidden=!featureEnabled('visualCritic');box.innerHTML=`<div class="row"><h3 class="grow">视觉审校</h3>${icon('shield','sm')}</div><p>${esc(criticReadyLabel())}</p><div class="row wrap">${btn('配置 API','settings','critic-settings','','small')}${releaseUI.criticBatch?btn('停止整册审校','stop','critic-batch-stop','','small'):btn('审校整本画册','eye','critic-batch','','small')}</div>${releaseUI.criticBatch?`<div class="critic-progress">${releaseUI.criticBatch.done} / ${releaseUI.criticBatch.total} 页 · ${esc(releaseUI.criticBatch.title)}</div>`:''}`;
  const header=$('.reader-header');if(header&&!$('[data-act="critic-settings"]',header))header.insertAdjacentHTML('beforeend',ibtn('shield','critic-settings','填写视觉审校 API 与测试图片能力'));
}

async function performVisualCritique(id,index,automatic=false,parentSignal=null){
  if(!featureEnabled('visualCritic')){if(automatic)return;throw Error('视觉审校模块已关闭，可在模块管理中启用。')}
  const book=bookBy(id),step=book?.steps.find(s=>s.stepIndex===index);if(!step?.image)throw Error('本页尚未生成，不能审校。');const key=id+':'+index;if(visionJobs.has(key))throw Error('本页已经在审校，请等待或停止当前任务。');
  const snapshot=step.image,cfg=criticConfig(),controller=new AbortController(),abort=()=>controller.abort();parentSignal?.addEventListener('abort',abort,{once:true});if(parentSignal?.aborted)controller.abort();const timeout=setTimeout(abort,clamp(Number(cfg.timeout)||60,15,180)*1000);
  visionJobs.set(key,controller);rt.critiqueBusy.add(key);const area=ui.bookId===id?$('#critique-'+index):null;if(area)area.innerHTML=`<div class="service-note"><i class="dot live"></i> ${cfg.mode==='real'?'正在分析原始画面...':'正在生成演示报告...'}${btn('停止','','critic-page-stop',`data-id="${id}" data-index="${index}"`,'small ghost')}</div>`;
  try{let report;
    if(cfg.mode==='mock'){await delay(600,controller.signal);report=normalizeCriticReport({score:7.5,summary:'离线演示报告，用于体验从审校到精修的操作流程。未向视觉模型发送此图。',anatomy:'示例：真实审校将检查手部指节、眼睛位置与肢体比例。',consistency:'示例：真实审校会对照可选的角色立绘与前序画面。',suggestions:'consistent character features, refined hands, coherent lighting',issues:[{area:'演示建议',severity:'low',observation:'连接视觉 API 后，此处会展示基于实际图片的问题与修改建议。',fixPrompt:'consistent character features, refined hands'}]})}
    else{
      let image;try{image=await rasterJPEG(snapshot)}catch(e){throw Error('无法读取当前原图，审校已停止。请用“图片替换”上传这张图的本地文件，或为图片服务启用 CORS。不会用 SVG 替代原图生成真实报告。')}
      const inputs=[{type:'text',text:'待审校图片是下面第一张。角色：'+book.characterName+'；场景：'+step.name+'；台词：'+step.caption+'。审校重点：'+cfg.focus},{type:'image_url',image_url:{url:image}}];
      const reference=rowBy(book.rowId)?.references?.front;if(cfg.includeReference&&reference){inputs.push({type:'text',text:'以下是角色参考立绘，仅用于角色与服装一致性对照。'},{type:'image_url',image_url:{url:await rasterJPEG(reference)}})}
      const previous=book.steps.find(s=>s.stepIndex===index-1);if(cfg.includePrevious&&previous?.image){try{inputs.push({type:'text',text:'以下是前一幕，请对照故事的连续性。'},{type:'image_url',image_url:{url:await rasterJPEG(previous.image)}})}catch(e){inputs.push({type:'text',text:'前一幕因跨域或读取失败未能附带。请不要声称已完成跨帧对照。'})}}
      const system='你是专业漫画视觉审校员。只审校第一张目标图，其他图仅为参考。不要把风格化当作解剖错误，不确定时明确说明。没有参考图时不可声称已对比。仅输出 JSON：{"score":1到10数字,"summary":"中文整体结论","anatomy":"解剖诊断","consistency":"角色/衣服/镜头连续性","suggestions":"汇总英文重绘提示词","issues":[{"area":"问题区域","severity":"high或medium或low","observation":"具体可观察问题，未发现则说明","fixPrompt":"可直接附加的英文精修提示词"}]}。不编造不存在的缺陷；最多6条问题。';
      report=normalizeCriticReport(parseJson(await visionRequest([{role:'system',content:system},{role:'user',content:inputs}],cfg,controller.signal)));
    }
    if(controller.signal.aborted)throw new DOMException('审校已停止','AbortError');const target=bookBy(id)?.steps.find(s=>s.stepIndex===index);if(!target||target.image!==snapshot){if(area?.isConnected)area.innerHTML=criticReportHTML(target?.critique,index);log('已丢弃旧图片的过期审校结果。','warn');return null}
    target.critique={...report,engine:cfg.mode==='real'?'real':'mock',model:cfg.mode==='real'?cfg.model:'offline-example',createdAt:Date.now(),imageFingerprint:hash(snapshot).toString(16)};book.updatedAt=Date.now();save();if(ui.bookId===id&&$('#critique-'+index))$('#critique-'+index).innerHTML=criticReportHTML(target.critique,index);return target.critique;
  }catch(e){const message=safeServiceError(e);if(area?.isConnected)area.innerHTML=`<div class="service-note"><span class="danger">${esc(message)}</span><div class="critic-actions">${btn('修改 API 配置','settings','critic-settings','','small')}${btn('重试审校','refresh','critique',`data-index="${index}"`,'small')}</div></div>`;throw Error(message)}
  finally{clearTimeout(timeout);parentSignal?.removeEventListener('abort',abort);visionJobs.delete(key);rt.critiqueBusy.delete(key)}
}

async function critiqueWholeBook(){
  if(releaseUI.criticBatch)throw Error('已有整册审校正在执行。');const book=bookBy(ui.bookId);if(!book)throw Error('请先打开画册。');
  const steps=[...book.steps].filter(s=>s.image).sort((a,b)=>a.stepIndex-b.stepIndex);if(!steps.length)throw Error('此画册没有可审校图片。');const real=criticConfig().mode==='real';
  if(!await confirmAction('审校整本画册？',`将按顺序审校「${book.title}」的 ${steps.length} 张图片。\n${real?'图片将发往已配置的视觉服务，可能产生 API 费用。':'当前为离线演示，不会获得真实图像诊断。'}\n连续 3 次失败自动停止，已完成报告会保留。`,'开始整册审校'))return;
  const batch={controller:new AbortController(),id:book.id,title:book.title,total:steps.length,done:0,failures:0,successes:0};releaseUI.criticBatch=batch;renderCriticEntry();
  try{for(const step of steps){if(batch.controller.signal.aborted)break;try{const result=await performVisualCritique(book.id,step.stepIndex,false,batch.controller.signal);if(result)batch.successes++;batch.failures=0}catch(e){if(batch.controller.signal.aborted)break;batch.failures++;log('整册审校失败：'+safeServiceError(e),'warn');if(batch.failures>=3){toast('视觉服务连续失败 3 次，整册审校已安全停止。','error');break}}batch.done++;renderCriticEntry()}toast('整册审校结束：已保存 '+batch.successes+' 份报告。')}
  finally{releaseUI.criticBatch=null;renderCriticEntry()}
}
