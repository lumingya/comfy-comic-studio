/* Mio development module: creation. */
'use strict';

function flushEditor(){const t=currentTemplate();if(!t)return;const f=t.frames[ui.frameIndex];let changed=false;$$('[data-frame-field]').forEach(e=>{if(!f)return;let v=e.type==='number'?Number(e.value):e.value;if(e.type==='number'&&!Number.isFinite(v))return;if(f[e.dataset.frameField]!==v){f[e.dataset.frameField]=v;changed=true}});$$('[data-template-field]').forEach(e=>{if(t[e.dataset.templateField]!==e.value){t[e.dataset.templateField]=e.value;changed=true}});if(changed){t.updatedAt=Date.now();save()}}


function validateColumn(k,old){if(!/^[a-zA-Z0-9_]+$/.test(k)||reserved.has(k)||(k!==old&&state.customColumns.includes(k)))throw Error('变量名只能包含字母、数字和下划线，不可使用系统字段或重复名称。')}


async function updateColumn(old,name,remove=false){if(!remove)validateColumn(name,old);const re=old?new RegExp('\\{'+old+'\\}','g'):null,affected=old?state.templates.flatMap(t=>t.frames.filter(f=>(f.prompt+' '+f.caption).includes('{'+old+'}')).map(f=>({t,f}))):[];if(remove&&!await confirmAction('删除变量 {'+old+'}？',`将影响 ${new Set(affected.map(x=>x.t.id)).size} 个模板、${affected.length} 幕分镜。占位符及角色变量值将被移除。`,'删除变量'))return;if(old){for(const r of state.rows){if(!remove)r[name]=r[old]??'';delete r[old]}for(const t of state.templates)for(const f of t.frames){f.prompt=f.prompt.replace(re,remove?'':'{'+name+'}');f.caption=f.caption.replace(re,remove?'':'{'+name+'}')}for(const r of state.rows)for(const versions of Object.values(r.storyVersions))for(const v of versions)v.captions=v.captions.map(c=>c.replace(re,remove?'':'{'+name+'}'));state.customColumns=state.customColumns.filter(c=>c!==old)}if(!remove){state.customColumns.push(name);state.rows.forEach(r=>{if(r[name]===undefined)r[name]=''})}save(true);closeModal();render();toast(remove?'变量及引用已删除':'变量列与宏引用已同步')}


function ensureManual(row,t){let v=activeVersion(row,t.id);if(!v){v={id:uid('sv'),title:'人工精修版',templateId:t.id,source:'manual',captions:t.frames.map((f,i)=>captionFor(row,t,i)),createdAt:Date.now(),updatedAt:Date.now()};(row.storyVersions[t.id]??=[]).push(v);row.activeStoryVersionIds[t.id]=v.id}return v}


function validatePrompt(value){return String(value??'')}


function interpolate(text,row={},f={}){return String(text||'').replace(/\{([a-zA-Z0-9_]+)\}/g,(_,k)=>{const v=k==='camera'?f.camera:k==='action'?f.action||'':row[k];return typeof v==='string'||typeof v==='number'?String(v):''})}


function delay(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new DOMException('已取消','AbortError'));const done=()=>{signal?.removeEventListener('abort',abort);resolve()},t=setTimeout(done,ms),abort=()=>{clearTimeout(t);reject(new DOMException('已取消','AbortError'))};signal?.addEventListener('abort',abort,{once:true})})}


function enqueueBook(row,t,book=null){flushEditor();if(!row||!t)throw Error('角色或模板不存在，请检查企划。');if(book&&state.queue.some(q=>q.bookId===book.id&&['pending','running','paused'].includes(q.status)))return book;const v=activeVersion(row,t.id);if(!book){book={id:uid('book'),projectId:state.activeProjectId,title:row.bookTitle||row.character+'的故事',characterName:row.character,rowId:row.id,templateId:t.id,templateTitle:t.title,storyVersionId:v?.id,storyTitle:v?.title,synopsis:row.storyOutline||t.outline,tags:['原创','本地创作'],totalSteps:t.frames.length,generatedSteps:0,status:'generating',inProgress:false,liked:false,likes:0,createdAt:Date.now(),updatedAt:Date.now(),theme:hash(row.character)%6,steps:[]};state.books.push(book)}const indices=missingIndices(book);if(!indices.length)return book;for(const i of indices)if(!t.frames[i])throw Error('溯源模板的幕数已改变，无法补齐第 '+(i+1)+' 幕。');state.queue.push({id:uid('task'),bookId:book.id,rowId:row.id,templateId:t.id,indices,done:0,status:'pending',frames:clone(t.frames),waitForStory:rt.lockedRows.has(row.id),createdAt:Date.now()});book.status='generating';save();log('加入队列：'+book.title+' · '+indices.length+' 帧');updateQueueUI();return book}


async function runQueue(){
if(rt.running){if(rt.paused){rt.paused=false;toast('渲染队列已继续')}return}
rt.running=true;rt.paused=false;rt.controller=new AbortController();const signal=rt.controller.signal;updateQueueUI();
try{let q;while((q=state.queue.find(q=>q.status==='pending'))){
if(signal.aborted)break;const b=bookBy(q.bookId),row=rowBy(q.rowId),t=templateBy(q.templateId);if(!b||!row||!t){q.status='failed';log('队列溯源数据缺失','error');continue}
q.status='running';delete q.error;b.inProgress=true;log('开始画册：'+b.title);
try{
while(rt.lockedRows.has(row.id)){log('互锁等待：当前角色正在推演剧情。');await delay(800,signal)}
if(q.waitForStory){const v=activeVersion(row,t.id);b.storyVersionId=v?.id;b.storyTitle=v?.title}const story=row.storyVersions[t.id]?.find(v=>v.id===b.storyVersionId);
for(let pos=q.done;pos<q.indices.length;pos++){
while(rt.paused){q.status='paused';updateQueueUI();await delay(300,signal)}q.status='running';const i=q.indices[pos],f=q.frames?.[i]||t.frames[i];if(!f)throw Error('找不到原始分镜 '+i);
while(rt.redraw.has(b.id+':'+i))await delay(250,signal);
if(!missingIndices(b).includes(i)){q.done=pos+1;save();log('跳过已就绪帧：'+b.title+' / '+(i+1));continue}
const snapshot=b.steps.find(s=>s.stepIndex===i)?.image;rt.frameProgress=0;updateQueueUI();loadingPage(b.id,i,true);
try{
const result=await generateFrame(f,row,signal,b.theme);
if(b.steps.find(s=>s.stepIndex===i)?.image!==snapshot){q.done=pos+1;save();log('本页已被手动替换，丢弃过期生成结果。','warn');continue}
const step={stepIndex:i,name:f.name,prompt:interpolate(f.prompt,row,f),caption:story?.captions[i]||interpolate(f.caption,row,f),image:result.image,offlineFallback:result.offlineFallback},old=b.steps.findIndex(s=>s.stepIndex===i);
if(old>=0)b.steps[old]=step;else b.steps.push(step);b.steps.sort((a,b)=>a.stepIndex-b.stepIndex);q.done=pos+1;b.generatedSteps=b.steps.filter(s=>s.image).length;b.updatedAt=Date.now();f.status='generated';if(t.frames[i])t.frames[i].status='generated';save();log('完成 '+b.title+' / 第 '+(i+1)+' 幕'+(result.offlineFallback?'（离线降级）':''));hotReplace(b.id,i,step.image);updateQueueUI();
if(state.settings.autoCritique&&rt.criticFailures<3){try{await critiqueStep(b.id,i,true);rt.criticFailures=0}catch(e){rt.criticFailures++;log('伴随审校失败 '+rt.criticFailures+'/3：'+e.message,'warn');if(rt.criticFailures===3)log('视觉审校已熔断，主生图任务继续。','warn')}}
}finally{loadingPage(b.id,i,false)}
}
q.status='complete';b.status='complete';b.completedAt=Date.now();log('画册完成：'+b.title+(missingIndices(b).length?' · 存在降级帧，可增量补齐':''));
}catch(e){q.status=signal.aborted?'canceled':'failed';q.error=e.message;b.status=signal.aborted?'canceled':'failed';log(e.message,signal.aborted?'warn':'error')}
finally{b.inProgress=false;save();updateQueueUI()}if(signal.aborted)break;
}}
finally{rt.running=false;rt.paused=false;rt.controller=null;renderShell();updateQueueUI();toast('队列已停止，所有已生成画面均已保留。')}}


async function generateStory(row,t,single=null,owned=false){
if(!row||!t)throw Error('请先选择角色与模板。');if(rt.lockedRows.has(row.id)&&!owned)throw Error('该角色正在推演，请稍候。');
const plan=state.creation?.plans?.find(p=>p.rowId===row.id&&p.templateId===t.id),runtime=plan?planRuntimeRow(plan):row,identity=resolveCharacterNames(runtime._scope||runtime),sceneFor=f=>plan?{...f,_scope:effectivePlanScope(plan,f).values}:f;
const controller=rt.llmController||new AbortController(),signal=controller.signal;rt.lockedRows.add(row.id);let v;
try{
const current=ui.workspace===4&&ui.storyRowId===row.id&&ui.storyTemplateId===t.id;row.storyOutline=(current?$('#story-outline')?.value:'')||row.storyOutline||t.outline;row.tone=(current?$('#story-tone')?.value:'')||row.tone||'温柔治愈';
if(single!==null)v=ensureManual(row,t);else{v={id:uid('sv'),title:(llmMock()?'离线推演':'AI 剧情')+' · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),templateId:t.id,source:llmMock()?'preset':'llm',captions:[],createdAt:Date.now(),updatedAt:Date.now()};(row.storyVersions[t.id]??=[]).push(v);row.activeStoryVersionIds[t.id]=v.id}
const chunk=clamp(Number(state.settings.llm.chunkSize)||3,2,6),start=single===null?0:single,end=single===null?t.frames.length:single+1;
for(let i=start;i<end;i+=chunk){const count=Math.min(single===null?chunk:1,end-i);let lines;
if(llmMock()){await delay(650,signal);lines=Array.from({length:count},(_,k)=>{const n=i+k,f=sceneFor(t.frames[n]);return interpolate(f.caption,runtime,f)+' '+['她终于明白，有些相遇不需要答案。','风带来了远方的消息，也带来了勇气。','在这一刻，所有等待都有了意义。'][n%3]})}
else{const msg=await chatCompletion([{role:'system',content:'你是漫画编剧。只返回 JSON 对象 {"captions":["逐幕中文台词"]}。旁白须推进情节并保持角色、服装、时空一致。使用 character_display_name 称呼角色；character 仅为出图识别标签，不要把标签写入旁白。展示名为空时使用自然代词。每幕提供的展示名优先于全局名称。'},{role:'user',content:JSON.stringify({character_display_name:identity.displayName,character:identity.promptName,outline:row.storyOutline,tone:row.tone,previousCaptions:v.captions.slice(0,i),startScene:i+1,count,scenes:t.frames.slice(i,i+count).map(sceneFor).map(f=>({name:f.name,character_display_name:resolveCharacterNames(f._scope||runtime._scope||runtime).displayName,prompt:interpolate(f.prompt,runtime,f)}))})}],null,signal);lines=parseJson(msg.content).captions;if(!Array.isArray(lines)||lines.length!==count||lines.some(x=>typeof x!=='string'))throw Error('LLM 台词数量或类型不符合本批幕数。')}
lines.forEach((line,k)=>v.captions[i+k]=line);v.updatedAt=Date.now();save();log('剧情已保存：'+row.character+' / '+Math.min(i+count,end)+' / '+t.frames.length+' 幕');if($('#story-progress'))$('#story-progress').textContent='已保存 '+Math.min(i+count,end)+' / '+t.frames.length+' 幕';
}return v;
}finally{rt.lockedRows.delete(row.id)}}


async function runStories(rows,t){
if(rt.llmBusy)throw Error('剧本流水线已在运行。');if(!t||!rows.length||rows.some(r=>!r))throw Error('请先选择模板与角色。');
rt.llmBusy=true;rt.llmController=new AbortController();rows.forEach(r=>rt.lockedRows.add(r.id));if([2,4].includes(ui.workspace))render();
try{for(const row of rows){await generateStory(row,t,null,true);if(rt.llmController.signal.aborted)break}toast('剧情版本已保存至角色矩阵。')}
catch(e){log(e.message,'error');toast(rt.llmController.signal.aborted?'剧本推演已中止，已完成分段已保留。':e.message,'error')}
finally{rows.forEach(r=>rt.lockedRows.delete(r.id));rt.llmBusy=false;rt.llmController=null;if([2,4].includes(ui.workspace))render();save()}}


async function generateOutline(){const r=rowBy(ui.storyRowId),t=templateBy(ui.storyTemplateId);if(!r||!t)throw Error('请先选择角色和模板。');const plan=state.creation?.plans?.find(p=>p.rowId===r.id&&p.templateId===t.id),scope=plan?effectivePlanScope(plan).values:r._scope||r,character=resolveCharacterNames(scope).displayName||'主角',idea=$('#story-outline')?.value||t.outline;if(llmMock()){r.storyOutline=`${character}在${scope.scene||r.scene||'夏日小镇'}发现了一封没有署名的信。沿着记忆的线索，她跨越误解与迟疑，在故事的终章学会告别，也学会重新开始。\n创作主题：${idea}`;await delay(450)}else{const m=await chatCompletion([{role:'user',content:'请为角色「'+character+'」创作一段四阶段漫画剧情梗概，100字内。使用这个展示名称称呼角色，不混入出图标签。主题：'+idea}]);r.storyOutline=m.content}if($('#story-outline'))$('#story-outline').value=r.storyOutline;save();toast('剧情大纲已生成')}


function parseTemplateXML(xml){const d=new DOMParser().parseFromString(xml,'application/xml');if(d.querySelector('parsererror')||d.documentElement.tagName!=='模板')throw Error('XML 不合法：根节点必须为「模板」。');const root=d.documentElement,title=root.querySelector(':scope > 标题')?.textContent.trim(),outline=root.querySelector(':scope > 简介')?.textContent.trim()||'',list=root.querySelector(':scope > 分镜列表');if(!title||!list)throw Error('缺少标题或分镜列表。');const nodes=[...list.children];if(nodes.length>512)throw Error('分镜不能超过512幕。');const frames=nodes.map((n,i)=>{if(n.tagName!=='分镜'+(i+1))throw Error('分镜节点必须连续编号，从分镜1开始。');const name=n.querySelector('名称')?.textContent||'分镜 '+(i+1),prompt=n.querySelector('提示词')?.textContent||'',caption=n.querySelector('剧情')?.textContent||'';validatePrompt(prompt);return{...makeFrame(i),name,prompt,caption}});return{id:uid('tpl'),projectId:state.activeProjectId,title,outline,frames,createdAt:Date.now()}}


async function generateXML(){ui.xmlIdea=$('#xml-idea').value;ui.xmlCount=Number($('#xml-count').value);const n=ui.xmlCount,c=state.settings.xml.separate?{...state.settings.xml,mode:state.settings.llm.mode}:state.settings.llm;$('#xml-output').value='正在构建 '+n+' 幕模板...';if(llmMock(c)){await delay(750);ui.xmlOutput=`<模板>\n  <标题>${xmlEscape(ui.xmlIdea.slice(0,22)||'未命名故事')}</标题>\n  <简介>${xmlEscape(ui.xmlIdea)}</简介>\n  <分镜列表>\n${Array.from({length:n},(_,i)=>{const f=makeFrame(i);return`    <分镜${i+1}>\n      <名称>${xmlEscape(f.name)}</名称>\n      <提示词>${xmlEscape(f.prompt)}</提示词>\n      <剧情>${xmlEscape(f.caption)}</剧情>\n    </分镜${i+1}>`}).join('\n')}\n  </分镜列表>\n</模板>`}else{const instruction='为构思生成 {panelCount} 幕漫画模板。只输出 XML：<模板><标题>...</标题><简介>...</简介><分镜列表><分镜1><名称>...</名称><提示词>英文，角色标签使用 {character}，保留 {style}, {outfit}</提示词><剧情>中文旁白，角色展示名使用 {character_display_name}，不要混入出图角色标签</剧情></分镜1>...连续编号...</分镜列表></模板>';const m=await chatCompletion([{role:'system',content:instruction.replaceAll('{panelCount}',String(n))},{role:'user',content:ui.xmlIdea}],null,undefined,c);ui.xmlOutput=m.content.replace(/^```(?:xml)?\s*/,'').replace(/\s*```$/,'')}parseTemplateXML(ui.xmlOutput);if($('#xml-output'))$('#xml-output').value=ui.xmlOutput;toast('XML 结构已校验，可转录入库。')}


async function redrawStep(i){const b=bookBy(ui.bookId),t=templateBy(b?.templateId),r=rowBy(b?.rowId);if(!b||!t||!r)throw Error('溯源角色或模板不存在。');const key=b.id+':'+i;if(rt.redraw.has(key))return;const f=clone(t.frames[i]||makeFrame(i));f.prompt=$('#refine-'+i)?.value||f.prompt;f.denoise=Number($('#denoise-'+i)?.value||.45);f.seed=Date.now()%100000000;validatePrompt(f.prompt);const old=b.steps.find(s=>s.stepIndex===i),controller=new AbortController();rt.refineControllers??=new Map();rt.refineControllers.set(key,controller);loadingPage(b.id,i,true);try{const source=rt.mask?.key===key?rt.mask.data:old?.image,result=await generateFrame(f,r,controller.signal,b.theme,source);const target=b.steps.find(s=>s.stepIndex===i);if(target){target.image=result.image;target.prompt=interpolate(f.prompt,r,f);target.offlineFallback=result.offlineFallback;delete target.critique;delete target.offlineImage}else b.steps.push({stepIndex:i,name:f.name,prompt:interpolate(f.prompt,r,f),caption:captionFor(r,t,i),image:result.image,offlineFallback:result.offlineFallback});b.generatedSteps=b.steps.filter(s=>s.image).length;b.updatedAt=Date.now();if(!missingIndices(b).length)b.status='complete';hotReplace(b.id,i,result.image);save();toast('第 '+(i+1)+' 幕已就地替换，阅读位置保持不变。')}finally{loadingPage(b.id,i,false);rt.refineControllers.delete(key);rt.mask=null}}


function executeTool(name,args={}){flushEditor();const original=currentTemplate();if(!original)throw Error('请先创建或选择模板。');const draft=clone(original);if(name==='get_current_template_details')return draft;const result=assistantToolDraft(draft,name,args);Object.assign(original,draft,{updatedAt:Date.now()});ui.frameIndex=clamp(ui.frameIndex,0,Math.max(0,draft.frames.length-1));save(name==='delete_frame');if(ui.workspace===1)render();return result}


function mockTool(text){const t=currentTemplate(),match=text.match(/第\s*([0-9一二三四五六七八九十]+)\s*幕/),i=match?chineseNumber(match[1])-1:ui.frameIndex;if(/新增|添加.*幕/.test(text))return{name:'add_new_frame',args:{name:'新的一幕',prompt:'{character}, {style}, {outfit}, '+text.replace(/^.*?(?:新增一幕|新增|添加一幕)[：: ]*/,''),caption:text.replace(/^.*?(?:新增一幕|新增|添加一幕)[：: ]*/,'')}};if(/删除.*幕/.test(text))return{name:'delete_frame',args:{frameIndex:i}};if(/标题.*(?:改|设)/.test(text))return{name:'update_template_title',args:{title:text.replace(/^.*?(?:改成|改为|设为)[：: ]*/,'')}};if(match&&/改|调整|变/.test(text)){const f=t?.frames[i];if(!f)throw Error('没有第 '+(i+1)+' 幕。');return{name:'update_frame_prompt_and_caption',args:{frameIndex:i,prompt:[...(f.prompt.match(/\{[a-zA-Z0-9_]+\}/g)||[]),text.replace(/^.*?(?:改成|改为|调整为)[：: ]*/,'')].join(', '),caption:text.replace(/^.*?(?:改成|改为|调整为)[：: ]*/,'')}}}return null}


async function sendChat(){const value=$('#chat-input')?.value.trim();if(rt.chatBusy||(!value&&!rt.attachments.length))return;flushEditor();const chat=currentChat(),attachments=rt.attachments.splice(0),content=attachments.length?[{type:'text',text:value||'请分析这些参考资料。'},...attachments.map(a=>a.image?{type:'image_url',image_url:{url:a.image}}:{type:'text',text:'附件 '+a.name+':\n'+a.text})]:value;chat.messages.push({role:'user',content});rt.chatBusy=true;renderAssistant();try{if(llmMock()){await delay(650);const call=mockTool(value);if(call){const toolId=uid('call');chat.messages.push({role:'assistant',content:null,tool_calls:[{id:toolId,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]});let result;try{result=executeTool(call.name,call.args)}catch(e){result={error:e.message}}chat.messages.push({role:'tool',tool_call_id:toolId,content:JSON.stringify(result)});chat.messages.push({role:'assistant',content:result.error?'操作未写入：'+result.error:'已完成调整，并保存到当前模板。你可以在分镜工作台中继续精修。\n（离线规则模拟，不是大模型推理结果。）'})}else chat.messages.push({role:'assistant',content:'我已收到你的创作想法'+(attachments.length?'和 '+attachments.length+' 份参考附件':'')+'。\n当前为离线规则模式，可直接执行「把第 1 幕改成...」「新增一幕...」「删除第 2 幕」或「标题改为...」。\n复杂创作讨论与图片理解请在 LLM 设置中连接真实模型。'})}else{const system={role:'system',content:'你是 Mio 的私有创作助手。通过工具修改模板，frameIndex从0开始。写prompt必须保留原有全部{宏变量}。不要执行用户未请求的删除。工具最多连续5轮。当前模板：'+JSON.stringify(currentTemplate())};for(let depth=0;depth<5;depth++){const m=await chatCompletion([system,...chat.messages],assistantTools);chat.messages.push(m);if(!m.tool_calls?.length)break;for(const call of m.tool_calls){let result;try{result=executeTool(call.function.name,JSON.parse(call.function.arguments))}catch(e){result={error:e.message}}chat.messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)})}if(depth===4){const final=await chatCompletion([system,...chat.messages,{role:'user',content:'工具调用深度已达安全上限。停止调用工具，简要确认已完成的操作。'}]);chat.messages.push(final)}}}}catch(e){chat.messages.push({role:'assistant',content:'本次请求未完成：'+e.message});log(e.message,'error')}finally{rt.chatBusy=false;save();renderAssistant()}}


async function extractDocx(file){const bytes=new Uint8Array(await file.arrayBuffer()),v=new DataView(bytes.buffer);let eocd=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){eocd=p;break}if(eocd<0)throw Error('DOCX ZIP 目录损坏。');let p=v.getUint32(eocd+16,true),count=v.getUint16(eocd+10,true);for(let i=0;i<count;i++){if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw Error('DOCX ZIP 结构无效。');const method=v.getUint16(p+10,true),size=v.getUint32(p+20,true),original=v.getUint32(p+24,true),nl=v.getUint16(p+28,true),xl=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),off=v.getUint32(p+42,true),name=new TextDecoder().decode(bytes.slice(p+46,p+46+nl));if(name==='word/document.xml'){if(original>8000000)throw Error('文档文本过大。');if(off+30>bytes.length)throw Error('DOCX 数据边界错误。');const start=off+30+v.getUint16(off+26,true)+v.getUint16(off+28,true);let blob=new Blob([bytes.slice(start,start+size)]);if(method===8){if(!window.DecompressionStream)throw Error('此浏览器不支持原生 DOCX 解压。请改用 TXT。');/* ZIP entries contain raw DEFLATE, not zlib-wrapped deflate. */blob=await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()}else if(method!==0)throw Error('不支持此 DOCX 压缩方式。');const d=new DOMParser().parseFromString(await blob.text(),'application/xml');if(d.querySelector('parsererror'))throw Error('DOCX 文本 XML 无效。');return[...d.getElementsByTagNameNS('*','t')].map(n=>n.textContent).join('\n').slice(0,30000)}p+=46+nl+xl+cl}throw Error('DOCX 中未找到 word/document.xml。')}


async function addAttachments(files){for(const f of files){if(f.size>12000000)throw Error('单个附件上限为 12 MB。');if(rt.attachments.length>=6)throw Error('每条消息最多 6 个附件。');if(f.type.startsWith('image/'))rt.attachments.push({name:f.name,image:await rasterJPEG(await blobData(f))});else if(/\.docx$/i.test(f.name))rt.attachments.push({name:f.name,text:await extractDocx(f)});else if(/\.txt$/i.test(f.name))rt.attachments.push({name:f.name,text:(await f.text()).slice(0,30000)});else throw Error('仅支持图片、TXT 与 DOCX。')}renderAssistant()}


function importTemplateObject(data){const raw=data.template||data,frames=raw.frames??[];if(typeof raw.title!=='string'||!Array.isArray(frames)||frames.length>512)throw Error('模板需要 title，frames 可为空数组，最多512幕。');const t={id:uid('tpl'),projectId:state.activeProjectId,title:raw.title,outline:String(raw.outline||''),frames:frames.map((f,i)=>{const frame={...makeFrame(i),...f,id:uid('f'),prompt:String(f.prompt??''),caption:String(f.caption??'')};validatePrompt(frame.prompt);return frame}),createdAt:Date.now()};state.templates.push(t);ui.templateId=t.id;ui.frameIndex=0;save();return t}


function saveStoryInputs(){const row=rowBy(ui.storyRowId),t=templateBy(ui.storyTemplateId),fields=$$('[data-story-caption]');if(!row||!t||!fields.length||rt.lockedRows.has(row.id))return;const v=ensureManual(row,t);fields.forEach(e=>v.captions[Number(e.dataset.storyCaption)]=e.value);v.updatedAt=Date.now();save()}


async function deleteBooks(ids){if(ids.some(id=>bookBy(id)?.inProgress||[...rt.redraw].some(k=>k.startsWith(id+':'))))throw Error('请先停止画册的渲染或精修任务。');if(!await confirmAction('删除 '+ids.length+' 本画册？','将删除选中画册及其全部关联队列记录。模板、角色和剧情版本保留。磁盘图片不会立即永久删除，可通过素材清理回收。此操作不能撤销。','删除画册'))return;if(ids.some(id=>bookBy(id)?.inProgress||[...rt.redraw].some(k=>k.startsWith(id+':'))))throw Error('确认期间画册已开始生成或精修，未删除。请先停止任务。');await foundationCancelForBooks(ids);await archiveDeletedBookJobs(ids);state.books=state.books.filter(b=>!ids.includes(b.id));state.queue=state.queue.filter(q=>!ids.includes(q.bookId));ui.selected.clear();save(true);closeModal();render();toast('画册已删除，源资产已保留。')}


function enqueueSelected(){const rows=projectRows().filter(r=>r.active),t=currentTemplate();if(!t||!rows.length)throw Error('请选择至少一个角色和一个模板。');for(const r of rows)if(!state.queue.some(q=>q.rowId===r.id&&q.templateId===t.id&&['pending','running','paused'].includes(q.status))){const b=enqueueBook(r,t);b.aspectRatio=t.frames[0].width/t.frames[0].height}save();return rows.length}


function assistantToolDraft(template,name,args={}){
  const text=(value,key)=>{if(typeof value!=='string'||value.length>50000)throw Error(key+' 必须为有效文本。');return value};
  const frame=i=>{if(!Number.isInteger(i)||i<0||i>=template.frames.length)throw Error('分镜编号超出模板范围。');return template.frames[i]};
  const update=a=>{const f=frame(a.frameIndex);if(a.prompt!==undefined)f.prompt=validatePrompt(text(a.prompt,'prompt'),f.prompt);if(a.caption!==undefined)f.caption=text(a.caption,'caption');if(a.name!==undefined)f.name=text(a.name,'name')};
  switch(name){
    case 'get_current_template_details':return clone(template);
    case 'update_template_title':if(!text(args.title,'title').trim())throw Error('标题不能为空。');template.title=args.title;break;
    case 'update_template_outline':template.outline=text(args.outline,'outline');break;
    case 'update_frame_prompt_and_caption':update(args);break;
    case 'add_new_frame':{const i=args.insertIndex??template.frames.length;if(!Number.isInteger(i)||i<0||i>template.frames.length||template.frames.length>=512)throw Error('新增位置不合法或已达到512幕。');template.frames.splice(i,0,{...makeFrame(i),name:text(args.name,'name'),prompt:validatePrompt(text(args.prompt,'prompt')),caption:text(args.caption,'caption')});break}
    case 'delete_frame':frame(args.frameIndex);if(template.frames.length===1)throw Error('模板至少保留一幕。');template.frames.splice(args.frameIndex,1);break;
    case 'swap_frames':frame(args.indexA);frame(args.indexB);[template.frames[args.indexA],template.frames[args.indexB]]=[template.frames[args.indexB],template.frames[args.indexA]];break;
    case 'batch_update_prompts_and_captions':if(!Array.isArray(args.frames)||args.frames.length>512)throw Error('批量分镜参数不合法，最多512幕。');args.frames.forEach(update);break;
    default:throw Error('未注册的工具：'+name);
  }
  return {success:true,templateId:template.id,action:name,frameCount:template.frames.length};
}


async function applyScopedToolBatch(calls,scopeId){
  const fail=message=>calls.map(()=>({error:message}));
  if(!featureEnabled('assistant'))return fail('分镜精修助手已停用，本次不写入修改。');
  if(calls.length>16)return fail('单次工具批次超过16项，已安全中止。');
  flushEditor();const live=templateBy(scopeId);if(!live)return fail('目标模板已不存在，未修改任何数据。');
  const before=clone(live),beforeText=JSON.stringify(before),draft=clone(live);let outputs=[];
  try{for(const c of calls)outputs.push(assistantToolDraft(draft,c.function.name,JSON.parse(c.function.arguments)))}catch(e){return fail('整个批次未应用：'+e.message)}
  const changing=calls.filter(c=>c.function.name!=='get_current_template_details');
  if(!changing.length)return outputs;
  if(state.settings.studio.assistant.confirmChanges){
    const lines=changing.map(c=>{const a=JSON.parse(c.function.arguments);return '· '+toolLabels[c.function.name]+(a.frameIndex!==undefined?'：第 '+(a.frameIndex+1)+' 幕':'')});
    if(!await confirmAction('将修改应用到分镜模板？','目标：'+live.title+'\n'+lines.join('\n')+'\n只修改源模板，不重绘或覆盖已有画册。','应用 '+changing.length+' 项修改'))return fail('用户取消了本批修改，请不要声称已修改。');
  }
  if(rt.assistantController?.signal.aborted)return fail('助手请求已中止，修改未应用。');
  if(!featureEnabled('assistant')||JSON.stringify(templateBy(scopeId))!==beforeText)return fail('模板或功能状态在等待期间发生变化，已阻止覆盖。请重新读取模板。');
  Object.assign(live,draft,{updatedAt:Date.now()});studioUI.assistantUndo={templateId:scopeId,before,afterText:JSON.stringify(live)};
  if(currentTemplate()?.id===scopeId)ui.frameIndex=clamp(ui.frameIndex,0,live.frames.length-1);
  save();if(ui.workspace===1)render();
  return outputs;
}


function scopedMockCall(text,template){
  if(/(?:查看|读取|介绍|检查).*(?:当前)?模板/.test(text))return {name:'get_current_template_details',args:{}};
  const match=text.match(/第\s*([0-9一二三四五六七八九十]+)\s*幕/),index=match?chineseNumber(match[1])-1:template?.id===ui.templateId?ui.frameIndex:0;
  const replacement=text.replace(/^.*?(?:改成|改为|调整为|设为)[：: ]*/,'');
  if(/新增|添加.*幕/.test(text)){const caption=text.replace(/^.*?(?:新增一幕|新增|添加一幕)[：: ]*/,'');return {name:'add_new_frame',args:{name:'新的一幕',prompt:'{character}, {style}, {outfit}, '+caption,caption}}}
  if(/删除.*幕/.test(text))return {name:'delete_frame',args:{frameIndex:index}};
  if(/标题.*(?:改|设)/.test(text))return {name:'update_template_title',args:{title:replacement}};
  if(match&&/改|调整|变/.test(text)){
    const f=template?.frames[index];if(!f)throw Error('找不到第 '+(index+1)+' 幕，请确认当前目标模板。');
    if(/台词|旁白/.test(text))return {name:'update_frame_prompt_and_caption',args:{frameIndex:index,caption:replacement}};
    return {name:'update_frame_prompt_and_caption',args:{frameIndex:index,prompt:[...(f.prompt.match(/\{[a-zA-Z0-9_]+\}/g)||[]),replacement].join(', '),caption:replacement}};
  }
  return null;
}


async function sendScopedChat(){
  if(rt.chatBusy||!featureEnabled('assistant'))return;
  const value=$('#chat-input')?.value.trim()||'';if(!value&&!rt.attachments.length)return;
  flushEditor();const scope=assistantScope(),chat=currentChat(),attachments=rt.attachments.splice(0);
  studioUI.assistantTargetId=scope?.id||null;studioUI.assistantDraft='';if($('#chat-input'))$('#chat-input').value='';
  const content=attachments.length?[{type:'text',text:value||'请参考这些附件，帮助我调整当前分镜模板。'},...attachments.map(a=>a.image?{type:'image_url',image_url:{url:a.image}}:{type:'text',text:'附件 '+a.name+':\n'+a.text})]:value;
  chat.messages.push({role:'user',content});rt.chatBusy=true;rt.assistantController=new AbortController();renderAssistant();
  try{
    if(llmMock()){
      await delay(500,rt.assistantController.signal);
      const call=scopedMockCall(value,scope);
      if(call){const c={id:uid('call'),type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}};const outputs=await applyScopedToolBatch([c],scope?.id);chat.messages.push({role:'assistant',content:null,tool_calls:[c]},{role:'tool',tool_call_id:c.id,content:JSON.stringify(outputs[0])});const result=outputs[0];chat.messages.push({role:'assistant',content:result.error?'本次未修改模板：'+result.error:call.name==='get_current_template_details'?'当前模板「'+result.title+'」包含 '+result.frames.length+' 幕：\n'+result.frames.map((f,i)=>(i+1)+'. '+f.name).join('\n'):'已在「'+scope.title+'」中完成修改。\n已有画册保持不变；需要新画面时，请继续使用渲染队列。可通过顶部撤销按钮还原本次修改。'})}
      else chat.messages.push({role:'assistant',content:'这里是分镜模板编辑助手，不会直接生成图片，也不编辑导出画册的 HTML。\n\n离线模式支持明确指令，如「把第 1 幕改成雨夜车站」「把第 2 幕台词改成...」「新增一幕...」「删除第 2 幕」和「查看当前模板」。\n\n若要调整导出 HTML，请打开侧栏「画册导出模板」；复杂创作讨论与附件理解请先连接真实模型。'});
    }else{
      const system={role:'system',content:'你是 Mio 的分镜精修助手，不是图像生成器，也不是导出HTML模板编辑器。只通过提供的8个工具修改本次锁定的源分镜模板。frameIndex从0开始。提示词格式由作者自由决定；普通括号、NovelAI 权重、不规则符号均合法。不要擅自纠正或拒绝这些语法，按用户指示修改文本。用户取消或工具返回error时不得声称已经修改。不要执行未请求的删除。最多5轮连续工具调用。锁定模板：'+JSON.stringify(scope||null)};
      let needsFinal=false;
      for(let depth=0;depth<5;depth++){
        const m=await chatCompletion([system,...chat.messages],assistantTools,rt.assistantController.signal);
        if(!m.tool_calls?.length){chat.messages.push(m);needsFinal=false;break}
        const outputs=await applyScopedToolBatch(m.tool_calls,studioUI.assistantTargetId);
        chat.messages.push(m,...m.tool_calls.map((c,i)=>({role:'tool',tool_call_id:c.id,content:JSON.stringify(outputs[i])})));save();needsFinal=true;
        if(rt.assistantController.signal.aborted)throw new DOMException('已停止本次助手请求','AbortError');
      }
      if(needsFinal){const m=await chatCompletion([system,...chat.messages,{role:'user',content:'已达到5轮安全上限。停止调用工具，准确总结已经执行和未执行的修改。'}],null,rt.assistantController.signal);chat.messages.push({role:'assistant',content:m.content||'已达到工具调用安全上限。请检查上方操作记录。'})}
    }
  }catch(e){chat.messages.push({role:'assistant',content:rt.assistantController?.signal.aborted?'本次请求已停止。已确认的修改保留，未确认的修改不会应用。':'本次请求未完成：'+e.message});log(e.message,'warn')}
  finally{rt.chatBusy=false;rt.assistantController=null;save();renderAssistant()}
}


async function createGuidePractice(){
  if(releaseUI.practiceBusy)return;const prefs=guidePreferences(),existing=bookBy(prefs.practiceBookId);if(existing?.status==='complete'){if($('#guide-dialog').open)$('#guide-dialog').close();changeProject(existing.projectId);openReader(existing.id);return}
  if(activeJobs())throw Error('请先等待当前生产或导出任务结束，再创建练习。');
  releaseUI.practiceBusy=true;releaseUI.practiceController=new AbortController();let b;
  try{const now=Date.now(),p={id:uid('project'),title:'快速开始 · 三幕练习',createdAt:now},t={id:uid('tpl'),projectId:p.id,title:'海边来信 · 练习分镜',outline:'少女在海边小站发现一封信，沿着记忆寻找寄信的人，最终与故友重逢。',frames:[0,1,2].map(makeFrame),createdAt:now},r=makeRow(0,p.id);r.character='nanami';r.character_display_name='七海';r.bookTitle='第一封海风来信';r.active=false;
    const v={id:uid('sv'),templateId:t.id,title:'三幕练习稿',source:'preset',captions:t.frames.map(f=>interpolate(f.caption,r,f)),createdAt:now,updatedAt:now};r.storyVersions[t.id]=[v];r.activeStoryVersionIds[t.id]=v.id;
    b={id:uid('book'),projectId:p.id,title:r.bookTitle,characterName:r.character_display_name,rowId:r.id,templateId:t.id,templateTitle:t.title,storyVersionId:v.id,storyTitle:v.title,synopsis:t.outline,tags:['教程练习','本地 SVG'],totalSteps:3,generatedSteps:0,status:'generating',inProgress:true,liked:false,likes:0,createdAt:now,updatedAt:now,theme:0,steps:[]};
    state.projects.push(p);state.templates.push(t);state.rows.push(r);state.books.push(b);Object.assign(prefs,{practiceProjectId:p.id,practiceTemplateId:t.id,practiceBookId:b.id});changeProject(p.id);ui.workspace=0;render();if($('#guide-dialog').open)renderQuickStart();save();
    for(let i=0;i<3;i++){await delay(650,releaseUI.practiceController.signal);const f=t.frames[i];b.steps.push({stepIndex:i,name:f.name,prompt:interpolate(f.prompt,r,f),caption:v.captions[i],image:fitSVG(svgArt(i,200+i),768,1024),offlineFallback:false});b.generatedSteps++;b.updatedAt=Date.now();save();refreshGallery();if($('#guide-dialog').open)renderQuickStart()}
    b.status='complete';b.completedAt=Date.now();toast('三幕练习已生成，可以阅读、审校或导出。');
  }catch(e){if(b)b.status='canceled';throw e}
  finally{if(b)b.inProgress=false;releaseUI.practiceBusy=false;releaseUI.practiceController=null;save();render();if($('#guide-dialog').open)renderQuickStart()}
}


function planFrameOverrides(plan,frame){return plan?.sceneOverrides?.[frame.id]||{}}


function effectivePlanScope(plan,frame=null,resolveSet=setBy){
  const values=Object.create(null),sources=Object.create(null),overrides=[];
  const merge=(entries,label)=>{const seen=new Set();for(const entry of entries||[]){checkVariableKey(entry.key);if(seen.has(entry.key))throw Error(label+' 中存在重复变量 {'+entry.key+'}。');seen.add(entry.key);const value=typedVariableValue(entry);if(Object.hasOwn(values,entry.key))overrides.push({key:entry.key,from:sources[entry.key],to:label});values[entry.key]=value;sources[entry.key]=label}};
  for(const id of plan?.variableSetIds||[]){const set=resolveSet(id);if(!set)throw Error('画册计划引用的变量素材已不存在，请重新选择。');merge(set.entries,set.title)}
  merge(plan?.variables,'本册覆盖');if(frame){for(const id of planFrameOverrides(plan,frame).variableSetIds||[]){const set=resolveSet(id);if(!set)throw Error('本幕预设已不存在，请重新选择。');merge(set.entries,'本幕预设 · '+set.title)}}if(frame)merge(planFrameOverrides(plan,frame).variables,'本幕覆盖');return{values,sources,overrides};
}


function effectivePlanFrame(plan,frame){const override=planFrameOverrides(plan,frame),f={...clone(frame)};if(plan.storyVersionId){const t=templateBy(plan.templateId),version=rowBy(plan.rowId)?.storyVersions?.[plan.templateId]?.find(v=>v.id===plan.storyVersionId),index=t?.frames.findIndex(x=>x.id===frame.id);if(version?.captions[index]!==undefined)f.caption=version.captions[index]}for(const key of ['name','prompt','caption','negative','renderOverride','width','height','steps','cfg','denoise','seed'])if(Object.hasOwn(override,key))f[key]=clone(override[key]);f._captionOverride=Object.hasOwn(override,'caption');f._scope=effectivePlanScope(plan,frame).values;f._scopeResolved=true;f._execution=workflowExecutionFor(plan,frame);const imageBindings=resolveImageVariables(f.prompt,f._scope,false,f.negative||f._execution.globalNegative||'');f._imageInputs=imageBindings.images;f._resolvedImagePrompt=imageBindings.prompt;f._resolvedImageNegative=imageBindings.negative;f.nodeOverrides={...(frame.nodeOverrides||{}),...(override.nodeOverrides||{})};return f}


function createBookPlan(){const t=currentTemplate()||projectTemplates()[0],r={id:uid('row'),projectId:state.activeProjectId,active:false,bookTitle:'未命名画册',character:'',character_display_name:'',style:'',outfit:'',references:{},storyVersions:{},activeStoryVersionIds:{},_planMapped:true};state.rows.push(r);const p={id:uid('plan'),projectId:state.activeProjectId,title:'未命名画册',templateId:t?.id||'',rowId:r.id,enabled:true,variableSetIds:[],variables:['character_display_name','character'].map(key=>variableEntry(key,'')),sceneOverrides:{},createdAt:Date.now(),updatedAt:Date.now()};state.creation.plans.push(p);createUI.planId=p.id;if(t)ui.templateId=t.id;createUI.tab='plans';save();navigate(1);return p}


function newVariableSet(){const s={id:uid('set'),projectId:state.activeProjectId,title:'我的变量素材',entries:[]};state.creation.variableSets.push(s);createUI.setId=s.id;createUI.tab='variables';save();navigate(1);return s}


function planRuntimeRow(plan){const stored=rowBy(plan.rowId);if(!stored)throw Error('画册计划的剧情记录不存在。');const scope=effectivePlanScope(plan).values,names=resolveCharacterNames(scope);return{...clone(stored),_scope:scope,_planId:plan.id,_runtimeSnapshot:true,bookTitle:scopeText(plan.title,scope,true),character:names.promptName,character_display_name:names.displayName,style:typeof scope.style==='string'?scope.style:'',outfit:typeof scope.outfit==='string'?scope.outfit:'',projectId:plan.projectId}}


function variableOwner(group,id){if(group==='set')return setBy(id)?.entries;if(group==='plan')return planBy(id)?.variables;if(group==='scene'){const p=selectedPlan(),t=currentTemplate(),f=t?.frames[ui.frameIndex];if(!p||!f)return null;p.sceneOverrides[f.id]??={};p.sceneOverrides[f.id].variables??=[];return p.sceneOverrides[f.id].variables}return null}


async function renameScopedVariable(group,id,entryId){const list=variableOwner(group,id),entry=list?.find(e=>e.id===entryId);if(!entry)throw Error('变量不存在。');const projectId=group==='set'?setBy(id).projectId:group==='plan'?planBy(id).projectId:state.activeProjectId;textModal('重命名变量','变量标识符',entry.key,async value=>{checkVariableKey(value);if(list.some(e=>e.id!==entry.id&&e.key===value))throw Error('当前作用域已有同名变量。');const old=entry.key;if(value===old){closeModal();return}const affected=state.templates.filter(t=>t.projectId===projectId).flatMap(t=>t.frames).filter(f=>(f.prompt+' '+f.caption).includes('{'+old+'}')).length;if(!await confirmAction('同步重命名 {'+old+'}？','将把当前企划中同名变量和所有分镜引用统一改为 {'+value+'}，影响 '+affected+' 个源分镜。其他企划不受影响。','同步改名'))return;const re=new RegExp('\\{'+old+'\\}','g'),replace=s=>String(s||'').replace(re,'{'+value+'}');for(const s of state.creation.variableSets.filter(s=>s.projectId===projectId))for(const e of s.entries)if(e.key===old)e.key=value;for(const p of state.creation.plans.filter(p=>p.projectId===projectId)){p.title=replace(p.title);for(const e of p.variables)if(e.key===old)e.key=value;for(const o of Object.values(p.sceneOverrides)){for(const e of o.variables||[])if(e.key===old)e.key=value;for(const k of ['name','prompt','caption','negative'])if(o[k]!==undefined)o[k]=replace(o[k])}}for(const t of state.templates.filter(t=>t.projectId===projectId))for(const f of t.frames){f.prompt=replace(f.prompt);f.caption=replace(f.caption);f.negative=replace(f.negative)}entry.key=value;save();closeModal();render();toast('变量与当前企划中的宏引用已同步。')},'变量不是固定字段，可根据你的工作流自由定义。')}


function flushCreationEditor(){
  const p=selectedPlan(),t=currentTemplate(),task=createUI.sceneScope==='plan'?liveStoryboardTask(p):null,f=task?.frames[ui.frameIndex]||t?.frames[ui.frameIndex];let changed=false;
  if(f){const own=!!task||createUI.sceneScope==='plan'&&p?.templateId===t?.id;if(own)p.sceneOverrides[f.id]??={};const live=own?liveStoryboardFrame(p,f):null,target=live||(own?p.sceneOverrides[f.id]:f);$$('[data-v3-frame]').forEach(el=>{const key=el.dataset.v3Frame,value=el.type==='number'?Number(el.value):el.value;if(target[key]!==value){target[key]=value;changed=true}});if(own&&changed){p.updatedAt=Date.now();if(live)saveLiveStoryboardFrame(p,live)}}
  if(t)$$('[data-v3-template]').forEach(el=>{const key=el.dataset.v3Template;if(t[key]!==el.value){t[key]=el.value;changed=true}});
  if(changed){if(t)t.updatedAt=Date.now();save()}
}


function enqueuePlanSnapshot(plan,existing=null,selectedIndices=null){
  if(existing&&state.queue.some(q=>q.bookId===existing.id&&q.serverState==='unknown'))throw Error('此画册有结果未确认的任务，请先核对上游结果或明确放弃跟踪。');
  flushEditor();const t=templateBy(plan.templateId);if(!t)throw Error('计划「'+plan.title+'」尚未选择有效分镜。');const row=planRuntimeRow(plan),frames=t.frames.map(f=>effectivePlanFrame(plan,f)),execution=mappedExecutionSnapshot();
  for(const f of frames){resolveImageVariables(f.prompt,f._scope,true,f.negative||f._execution?.globalNegative||'');validatePrompt(f.prompt);scopeText(f.prompt,f._scope,true);scopeText(f.caption,f._scope,true);buildMappedWorkflow(f,row,{execution:f._execution||execution,preview:true})}
  const source={planId:plan.id,row:clone(row),frames:clone(frames),execution,templateTitle:t.title};
  let book=existing;const v=plan.storyVersionId?row.storyVersions?.[t.id]?.find(v=>v.id===plan.storyVersionId):null;if(plan.storyVersionId&&!v)throw Error('选中的剧情版本不存在，请重新选择台词来源。');if(!book){book={id:uid('book'),projectId:plan.projectId,title:row.bookTitle,characterName:resolveCharacterNames(row).displayName||'原创画册',rowId:plan.rowId,templateId:t.id,templateTitle:t.title,storyVersionId:v?.id,storyTitle:v?.title,synopsis:t.outline||'使用分镜与变量素材生成的连续画册。',tags:['原创','创作计划'],totalSteps:frames.length,generatedSteps:0,status:'generating',inProgress:false,liked:false,likes:0,createdAt:Date.now(),updatedAt:Date.now(),theme:hash(row.character||plan.title)%6,steps:[],planId:plan.id,sourceSnapshot:source};state.books.push(book)}
  if(state.queue.some(q=>q.bookId===book.id&&['pending','running','paused'].includes(q.status)))return book;
  const indices=missingIndices(book).filter(i=>!selectedIndices||selectedIndices.includes(i));if(indices.length){const snapshot=book.sourceSnapshot||source;state.queue.push({id:uid('task'),bookId:book.id,rowId:book.rowId,templateId:book.templateId,planId:plan.id,indices,done:0,status:'pending',frames:clone(snapshot.frames),rowSnapshot:clone(snapshot.row),execution:clone(snapshot.execution),waitForStory:!!plan.storyVersionId&&rt.lockedRows.has(book.rowId),createdAt:Date.now()});book.status='generating';log('计划入队：'+book.title+' · '+indices.length+' 帧 · 已冻结变量和工作流')}
  createUI.liveTaskId=state.queue.find(q=>q.bookId===book.id)?.id;createUI.sceneScope='plan';plan.updatedAt=Date.now();save();updateQueueUI();return book;
}


function enqueueCompatibleBook(row,t,book=null){
  if(book&&state.queue.some(q=>q.bookId===book.id&&q.serverState==='unknown'))throw Error('请先核对此画册未确认的上游结果。');
  if(!row||!t)throw Error('画册的源素材或分镜已不存在。');const plan=state.creation.plans.find(p=>p.rowId===row.id&&p.templateId===t.id);
  if(!book&&plan)return enqueuePlanSnapshot(plan);
  if(book&&state.queue.some(q=>q.bookId===book.id&&['pending','running','paused'].includes(q.status)))return book;
  if(!book){const generated={id:uid('plan'),projectId:row.projectId||state.activeProjectId,title:row.bookTitle||'新画册',templateId:t.id,rowId:row.id,enabled:true,variableSetIds:[],variables:Object.entries(row).filter(([k,v])=>!reserved.has(k)&&['string','number','boolean'].includes(typeof v)).map(([k,v])=>variableEntry(k,v)),sceneOverrides:{},createdAt:Date.now()};for(const k of ['character','style','outfit'])if(row[k])generated.variables.push(variableEntry(k,row[k]));state.creation.plans.push(generated);row._planMapped=true;return enqueuePlanSnapshot(generated)}
  const indices=missingIndices(book);if(!indices.length){toast('画册没有缺失分镜。');return book}
  const snapshot=book.sourceSnapshot||{row:clone(row),frames:clone(t.frames),execution:mappedExecutionSnapshot()};if(indices.some(i=>!snapshot.frames[i]))throw Error('源分镜数量已变化，无法按原索引补齐。请从画册计划生成新版本。');
  state.queue.push({id:uid('task'),bookId:book.id,rowId:book.rowId,templateId:book.templateId,indices,done:0,status:'pending',frames:clone(snapshot.frames),rowSnapshot:clone(snapshot.row),execution:clone(snapshot.execution),createdAt:Date.now()});book.status='generating';save();updateQueueUI();return book;
}


async function runFlexibleQueue(){
  if(rt.running)return;rt.running=true;rt.paused=false;rt.controller=new AbortController();const signal=rt.controller.signal;renderStatus();
  try{let q;while((q=state.queue.find(q=>q.status==='pending'))){while(rt.paused&&!signal.aborted)await delay(200);if(signal.aborted)break;q=state.queue.find(q=>q.status==='pending');if(!q)break;const b=bookBy(q.bookId),storedRow=rowBy(q.rowId);if(!b){q.status='failed';continue}q.status='running';delete q.error;b.inProgress=true;log('开始生成 '+b.title);
    try{while(rt.lockedRows.has(q.rowId)){log('等待此计划的剧情推演完成...');await delay(1000,signal)}const row=clone(q.rowSnapshot||storedRow||b.sourceSnapshot?.row),t=templateBy(q.templateId);if(!row)throw Error('缺少原始变量快照。');if(q.waitForStory&&storedRow){row.storyVersions=clone(storedRow.storyVersions);row.activeStoryVersionIds=clone(storedRow.activeStoryVersionIds);const v=activeVersion(row,q.templateId);b.storyVersionId=v?.id;b.storyTitle=v?.title}
      const story=row.storyVersions?.[q.templateId]?.find(v=>v.id===b.storyVersionId);
      for(let pos=q.done;pos<q.indices.length;pos++){while(rt.paused){q.status='paused';updateQueueUI();await delay(350,signal)}q.status='running';const i=q.indices[pos],original=q.frames?.[i]||b.sourceSnapshot?.frames?.[i]||t?.frames[i];if(!original)throw Error('缺少第 '+(i+1)+' 幕快照。');if(!missingIndices(b).includes(i)){q.done=pos+1;continue}
        while(rt.redraw.has(b.id+':'+i))await delay(250,signal);const f={...clone(original),_execution:original._execution||q.execution||b.sourceSnapshot?.execution,_assetBookId:b.id},before=b.steps.find(s=>s.stepIndex===i)?.image;updateQueueUI();loadingPage(b.id,i,true);
        try{if(q.waitForStory&&!f._captionOverride&&story?.captions[i]!==undefined)f.caption=story.captions[i];const result=await generateFrame(f,row,signal,b.theme);if(b.steps.find(s=>s.stepIndex===i)?.image!==before){q.done=pos+1;log('本页已有手动替换，忽略迟到的生成结果。','warn');continue}const scope=f._scope||row._scope||row,caption=q.planId||b.planId?f.caption:story?.captions[i]||f.caption,step={stepIndex:i,name:f.name,prompt:f._resolvedImagePrompt??scopeText(f.prompt,scope,true),caption:scopeText(caption,scope,true),image:result.image,offlineFallback:result.offlineFallback};const old=b.steps.findIndex(s=>s.stepIndex===i);if(old>=0)b.steps[old]=step;else b.steps.push(step);b.steps.sort((a,b)=>a.stepIndex-b.stepIndex);b.generatedSteps=b.steps.filter(s=>s.image).length;b.updatedAt=Date.now();q.done=pos+1;if(t?.frames[i])t.frames[i].status='generated';save();hotReplace(b.id,i,step.image);updateQueueUI();log('分镜完成：'+b.title+' / '+(i+1));if(state.settings.autoCritique&&rt.criticFailures<3){try{await critiqueStep(b.id,i,true);rt.criticFailures=0}catch(e){rt.criticFailures++;log('审校失败 '+rt.criticFailures+'/3：'+e.message,'warn')}}}finally{loadingPage(b.id,i,false)}
      }q.status='complete';b.status=missingIndices(b).length?'partial':'complete';b.completedAt=Date.now();log('画册生成完成：'+b.title);
    }catch(e){q.status=signal.aborted?'canceled':'failed';q.error=e.message;b.status=signal.aborted?'canceled':'failed';log(e.message,signal.aborted?'warn':'error')}
    finally{b.inProgress=false;save();updateQueueUI()}if(signal.aborted)break;
  }}finally{rt.running=false;rt.paused=false;rt.controller=null;renderShell();updateQueueUI();toast('队列已结束，已生成画面全部保留。')}
}


async function removeVariable(group,id,entryId){const list=variableOwner(group,id),entry=list?.find(x=>x.id===entryId);if(!entry)return;const mentions=projectTemplates().flatMap(t=>t.frames).filter(f=>(f.prompt+' '+f.caption).includes('{'+entry.key+'}')).length;if(!await confirmAction('删除变量 {'+entry.key+'}？','当前企划 '+mentions+' 个分镜中出现此变量。删除后不会擅自改写提示词，生成前会提示缺失；也可以从其他素材或单幕覆盖提供此值。','删除变量'))return;rememberRemovedImageVariable(entry);list.splice(list.indexOf(entry),1);save(true);render()}


function legacyImportWorkflowIntoMapper(data){const w=data.workflow&&data.bindings?data.workflow:data;validateWorkflow(w);state.settings.comfy.workflow=clone(w);state.settings.comfy.workflowTitle=data.title||data.workflowTitle||'导入的工作流';if(Array.isArray(data.bindings)){validateBindings(data.bindings);state.settings.comfy.bindings=clone(data.bindings);state.settings.comfy.outputNodeId=String(data.outputNodeId||'')}else if(!state.settings.comfy.bindings.length)state.settings.comfy.bindings=initialWorkflowBindings({...state.settings.comfy,mapping:{}});save();studioUI.settingsTab='mapping';navigate(5);toast('蓝图已导入。已有映射保留，失效的节点会明确告警。')}


async function generateChosenPlans(one=false,onlyQueue=false){flushEditor();const plans=one?[selectedPlan()]:projectPlans().filter(p=>p.enabled);if(!plans.length||!plans[0])throw Error('请先选择至少一份画册计划。');for(const p of plans){const t=templateBy(p.templateId);if(!t)throw Error('「'+p.title+'」尚未选择分镜。');if(p.storyVersionId&&!rowBy(p.rowId)?.storyVersions?.[t.id]?.some(v=>v.id===p.storyVersionId))throw Error('「'+p.title+'」选择的台词版本已不存在。');const row=planRuntimeRow(p);for(const f of t.frames){const effective=effectivePlanFrame(p,f);resolveImageVariables(effective.prompt,effective._scope,true,effective.negative||effective._execution?.globalNegative||'');validatePrompt(effective.prompt);scopeText(effective.prompt,effective._scope,true);scopeText(effective.caption,effective._scope,true);buildMappedWorkflow(effective,row,{preview:true})}}for(const p of plans){if(state.queue.some(q=>q.planId===p.id&&['pending','running','paused'].includes(q.status)))continue;enqueuePlanSnapshot(p)}if(!onlyQueue)void runQueue();createUI.tab='queue';navigate(1);if(onlyQueue)toast('已加入生成队列，尚未启动。')}


async function redrawMappedBookStep(index){
  const b=bookBy(ui.bookId);if(!b)throw Error('请先打开画册。');const source=b.sourceSnapshot,t=templateBy(b.templateId),row=clone(source?.row||rowBy(b.rowId));if(!row)throw Error('找不到画册原始变量。');const f=clone(source?.frames?.[index]||t?.frames[index]||makeFrame(index)),key=b.id+':'+index;if(rt.redraw.has(key))return;
  const old=b.steps.find(s=>s.stepIndex===index),before=old?.image;f.prompt=$('#refine-'+index)?.value||old?.prompt||f.prompt;f.denoise=Number($('#denoise-'+index)?.value||.45);f.renderOverride=true;f.seed=Date.now()%100000000;f._execution=f._execution||source?.execution||mappedExecutionSnapshot();f._assetBookId=b.id;validatePrompt(f.prompt);const controller=new AbortController();rt.refineControllers??=new Map();rt.refineControllers.set(key,controller);loadingPage(b.id,index,true);
  try{const imageSource=rt.mask?.key===key?rt.mask.data:old?.image,result=await generateFrame(f,row,controller.signal,b.theme,imageSource);if(bookBy(b.id)?.steps.find(s=>s.stepIndex===index)?.image!==before){toast('本页已发生其他修改，精修结果未覆盖。');return}const target=b.steps.find(s=>s.stepIndex===index);if(target){target.image=result.image;target.prompt=scopeText(f.prompt,f._scope||row._scope||row,true);target.offlineFallback=result.offlineFallback;delete target.critique;delete target.offlineImage}else b.steps.push({stepIndex:index,name:f.name,prompt:scopeText(f.prompt,f._scope||row._scope||row,true),caption:scopeText(f.caption,f._scope||row._scope||row,true),image:result.image,offlineFallback:result.offlineFallback});b.generatedSteps=b.steps.filter(s=>s.image).length;b.updatedAt=Date.now();if(!missingIndices(b).length)b.status='complete';save();hotReplace(b.id,index,result.image);toast('此页已使用原始变量和工作流快照完成精修。')}
  finally{loadingPage(b.id,index,false);rt.refineControllers.delete(key);rt.mask=null}
}


/* Source: /js/creation.js */
function ensureFrameCapacity(frames,additional=1){const limit=globalThis.ComfyComic.MAX_FRAMES;if(!Array.isArray(frames)||!Number.isInteger(additional)||additional<0)throw Error('Invalid frame operation.');if(frames.length+additional>limit)throw Error('This operation would exceed '+limit+' frames.');return true}


function installNativeCreationModule(){const ns=globalThis.ComfyComic,enqueuePrevious=enqueuePlanSnapshot;enqueuePlanSnapshot=function(plan,existing=null,selectedIndices=null){const t=templateBy(plan?.templateId);if(!t)throw Error('Select a storyboard before generating.');ns.stateContract.assertFrameCount(t.frames);if(t.frames.length===0)throw Error('空分镜模板可以保存，生成前请先添加一幕。');return enqueuePrevious(plan,existing,selectedIndices)};const assistantPrevious=assistantToolDraft;assistantToolDraft=function(t,name,args={}){t.frames??=[];if(name==='add_new_frame')ensureFrameCapacity(t.frames);if(name==='batch_update_prompts_and_captions')ns.stateContract.assertFrameCount(args.frames||[]);return assistantPrevious(t,name,args)};const packagePrevious=selectedPublishPackage;selectedPublishPackage=function(id){const value=packagePrevious(id);if(value.value?.frames)ns.stateContract.assertFrameCount(value.value.frames);return value};ns.modules.creation=true}


async function deleteStoryboardTemplate(id){
  flushEditor();const template=templateBy(id);if(!template)throw Error('分镜模板已不存在。');
  const checkBusy=()=>{
    if(rt.chatBusy)throw Error('助手正在处理分镜，请等待完成或停止后再删除模板。');
    if(state.queue.some(q=>(q.templateId===id||bookBy(q.bookId)?.templateId===id)&&['pending','running','paused'].includes(q.status))||state.books.some(b=>b.templateId===id&&(b.inProgress||[...rt.redraw].some(k=>k.startsWith(b.id+':')))))throw Error('此模板仍有关联的待执行或生成中任务，请先完成或中止并移除任务。');
  };
  checkBusy();const count=state.creation.plans.filter(p=>p.templateId===id).length;
  if(!await confirmAction('删除分镜模板「'+template.title+'」？',`将删除整套 ${template.frames.length} 幕分镜，而不是当前一幕。
${count} 份画册计划会解除模板关联并清空单幕覆盖，之后需重新选择模板。
已生成画册、原图与对话记录保留；依赖此源模板的补齐和精修将不可用。建议先导出分镜备份。`,'删除模板'))return;
  checkBusy();if(!templateBy(id))return;
  state.templates=state.templates.filter(t=>t.id!==id);
  for(const plan of state.creation.plans)if(plan.templateId===id){plan.templateId='';plan.storyVersionId='';plan.sceneOverrides={};plan.updatedAt=Date.now()}
  for(const pkg of state.installedPackages)if(pkg.type==='templates')pkg.assetIds=(pkg.assetIds||[]).filter(assetId=>assetId!==id);
  state.installedPackages=state.installedPackages.filter(pkg=>pkg.type!=='templates'||pkg.assetIds.length);
  if(ui.templateId===id)ui.templateId='';if(ui.storyTemplateId===id)ui.storyTemplateId='';ui.frameIndex=0;
  if(studioUI.assistantUndo?.templateId===id)studioUI.assistantUndo=null;
  save(true);render();if(!$('#assistant').hidden)renderAssistant();toast('分镜模板已删除，画册与原图已保留。');
}
