/* Mio development module: state. */
'use strict';

function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}

function rng(s){return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296)}


function svgArt(theme=0,seed=1,fallback=false){const list=MioContent[fallback?'fallback':'svg'];return list[Math.abs(theme)%list.length]}


function seedState(){return createConfigConverters(createStudioStateContract()).fromApi(MioContent.config,MioContent.initial)}


/** @typedef {{score:number,passed:boolean,summary:string,anatomy:string,consistency:string,suggestions:string}} VisualCritiqueReport */
/** @typedef {{id:string,title:string,templateId:string,source:'llm'|'manual'|'preset',captions:Record<string,string>,createdAt:number,updatedAt:number}} StoryVersion */
/** @typedef {{id:string,active:boolean,bookTitle:string,character:string,style:string,outfit:string,storyVersions:Object<string,StoryVersion[]>,activeStoryVersionIds:Object<string,string>,captions?:string[]}} BatchMatrixRow */
/** @typedef {{id:string,title:string,characterName:string,rowId:string,templateId:string,templateTitle:string,storyVersionId?:string,storyTitle?:string,synopsis:string,tags:string[],totalSteps:number,generatedSteps:number,status:'generating'|'complete'|'canceled'|'failed'|'partial',inProgress?:boolean,liked?:boolean,likes?:number,createdAt:number,updatedAt:number,completedAt?:number,steps:Array<{stepIndex:number,name:string,prompt:string,caption:string,image:string,critique?:VisualCritiqueReport}>}} ComicBook */
function isFallbackImage(src){if(!src)return true;if(/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src))return false;if(src.includes('offline-fallback'))return true;if(src.startsWith('data:image/svg+xml;base64,')){try{return atob(src.split(',')[1]).includes('data-comfy-art="offline-fallback"')}catch(e){return true}}if(src.startsWith('data:image/svg+xml,')){try{return decodeURIComponent(src).includes('offline-fallback')}catch(e){return true}}return false}


function missingIndices(b){return Array.from({length:b.totalSteps},(_,i)=>i).filter(i=>{const s=b.steps.find(s=>s.stepIndex===i);return !b.pictureEdits?.[i]?.removed&&(!s||!s.image||s.offlineFallback===true||isFallbackImage(s.image))})}

function score(b){const s=b.steps.map(s=>s.critique?.score).filter(Number.isFinite);return s.length?s.reduce((a,b)=>a+b)/s.length:0}

function assetCount(s){return s.books.length+s.templates.length+s.rows.length+s.books.reduce((n,b)=>n+b.steps.length,0)}


function validateState(s){
if(!s||s.schemaVersion!=='2.2'||!Array.isArray(s.projects)||!s.projects.length||!Array.isArray(s.templates)||!Array.isArray(s.rows)||!Array.isArray(s.books)||!Array.isArray(s.queue)||!s.settings?.comfy?.mapping||!s.settings?.llm||!Array.isArray(s.chats)||!s.chats.length)throw Error('工程结构不合法，需要完整 v2.2 备份。');
const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,150}$/.test(x),safeImage=x=>typeof x==='string'&&(!x||/^\/images\/[A-Za-z0-9_./-]+$/.test(x)&&!x.split('/').includes('..')||/^https?:\/\//.test(x)||/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)[;,]/i.test(x)),strFields=(o,keys)=>keys.every(k=>typeof o[k]==='string');
for(const list of [s.projects,s.templates,s.rows,s.books,s.queue,s.chats])if(list.some(x=>!x||!safeId(x.id))||new Set(list.map(x=>x.id)).size!==list.length)throw Error('工程 ID 含非法字符或重复。');
if(!s.projects.some(p=>p.id===s.activeProjectId))throw Error('当前企划不存在。');
for(const t of s.templates)if(!strFields(t,['title','outline'])||!Array.isArray(t.frames)||t.frames.length>512||t.frames.some(f=>!strFields(f,['name','prompt','caption'])))throw Error('模板分镜结构不完整或超过512幕。');
for(const r of s.rows){if(!r.storyVersions||!r.activeStoryVersionIds||typeof r.active!=='boolean'||!strFields(r,['character','bookTitle','style','outfit']))throw Error('角色缺少平铺字段或剧情双键索引。');for(const [key,versions]of Object.entries(r.storyVersions)){if(!safeId(key)||!Array.isArray(versions)||versions.some(v=>!safeId(v.id)||v.templateId!==key||!['llm','manual','preset'].includes(v.source)||!v.captions||Array.isArray(v.captions)||Object.entries(v.captions).some(([id,c])=>!safeId(id)||typeof c!=='string')||!Number.isFinite(v.createdAt)||!Number.isFinite(v.updatedAt)))throw Error('剧情版本与模板复合键不匹配。');if(r.activeStoryVersionIds[key]&&!versions.some(v=>v.id===r.activeStoryVersionIds[key]))throw Error('激活剧情版本不存在。')}}
for(const b of s.books){if(!safeId(b.rowId)||!safeId(b.templateId)||!strFields(b,['title','characterName','templateTitle','synopsis'])||!Array.isArray(b.tags)||b.tags.some(t=>typeof t!=='string')||!Array.isArray(b.steps)||!Number.isInteger(b.totalSteps)||b.totalSteps<0||b.totalSteps>512||!Number.isInteger(b.generatedSteps)||(b._lazy?(b.steps.length!==0||b.generatedSteps<0||b.generatedSteps>b.totalSteps):b.generatedSteps!==b.steps.filter(f=>f.image).length)||!Number.isFinite(b.createdAt)||!Number.isFinite(b.updatedAt)||!['complete','generating','failed','canceled','partial'].includes(b.status)||b.steps.some(f=>!Number.isInteger(f.stepIndex)||f.stepIndex<0||f.stepIndex>=b.totalSteps||!strFields(f,['name','prompt','caption'])||!safeImage(f.image))||new Set(b.steps.map(f=>f.stepIndex)).size!==b.steps.length)throw Error('画册数据契约或分镜计数不合法。');for(const f of b.steps)if(f.critique&&(!Number.isFinite(f.critique.score)||f.critique.score<1||f.critique.score>10||!strFields(f.critique,['summary','anatomy','consistency','suggestions'])||f.critique.passed!==(f.critique.score>=7)))throw Error('审校报告契约不合法。')}
if((s.customColumns||[]).some(k=>!/^[a-zA-Z0-9_]+$/.test(k)||reserved.has(k)))throw Error('自定义变量名不合法。');
for(const q of s.queue)if(!safeId(q.bookId)||!Array.isArray(q.indices)||q.indices.some(i=>!Number.isInteger(i)||i<0||i>=512)||!Number.isInteger(q.done)||q.done<0||q.done>q.indices.length)throw Error('渲染队列数据不合法。');
for(const chat of s.chats){if(!Array.isArray(chat.messages))throw Error('会话历史不合法。');const pending=new Set();for(const m of chat.messages){if(!['user','assistant','tool','system'].includes(m.role))throw Error('会话角色不合法。');if(m.role==='tool'){if(!pending.has(m.tool_call_id))throw Error('发现未配对的 tool 消息。');pending.delete(m.tool_call_id)}else{if(pending.size)throw Error('工具调用链缺少结果。');if(m.tool_calls){if(!Array.isArray(m.tool_calls))throw Error('工具调用数组不合法。');m.tool_calls.forEach(c=>pending.add(c.id))}}}if(pending.size)throw Error('工具调用链不完整。')}
validateWorkflow(s.settings.comfy.workflow);return true}


function activeVersion(row,tId){return row?.storyVersions?.[tId]?.find(v=>v.id===row.activeStoryVersionIds[tId])}


function captionFor(row,t,i){return activeVersion(row,t.id)?.captions[t.frames[i]?.id]??interpolate(t.frames[i]?.caption||'',row,t.frames[i]||{})}


function currentChat(){return state.chats.find(c=>c.id===state.activeChatId)||state.chats[0]}


function backupObject(includeSecrets=false){const data=clone(state);if(!includeSecrets){data.settings.llm.key='';data.settings.xml.key='';if(data.settings.critic)data.settings.critic.key=''}if(data.settings.github){delete data.settings.github.token;delete data.settings.github.key}return data}


function ensureStudioState(s=state){
  if(!s.settings.studio||typeof s.settings.studio!=='object')s.settings.studio=clone(studioDefaults);
  for(const [group,defaults] of Object.entries(studioDefaults))s.settings.studio[group]={...defaults,...(s.settings.studio[group]||{})};
  s.settings.studio.visibility.gallery=true;
  if(!Array.isArray(s.exportTemplates))s.exportTemplates=[];
  if(!s.exportTemplates.some(t=>t.id===s.settings.studio.export.templateId))s.settings.studio.export.templateId=s.exportTemplates[0]?.id||'';
  s.appVersion=STUDIO_VERSION;
  return s;
}


function ensureWorkspaceIdentity(s=state){
  const prior=s===state?getStartupProfile():null;
  s.settings.identity={workspaceName:'',creatorName:'',onboarded:false,...(prior||{}),...(s.settings.identity||{})};
  s.settings.disk={includeKeys:false,...(s.settings.disk||{})};
  s.workspaceId ||= uid('workspace');
  s.drafts ||= {};
  if(s.settings.signature==='Kira'&&s.settings.identity.creatorName)s.settings.signature=s.settings.identity.creatorName;
}


function safeFolderName(value,id=''){let name=String(value||'未命名').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,48);if(!name||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))name='工作室_'+(name||'未命名');return name+(id?'__'+String(id).replace(/[^a-zA-Z0-9_-]/g,'').slice(-12)+'_'+hash(id).toString(16):'')}


function normalizedChatEndpoint(base){let url;try{url=new URL(String(base).trim())}catch(e){throw Error('请填写完整的 Base URL，例如 https://api.openai.com/v1。')}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Base URL 需为不含凭据、查询参数的 HTTP(S) 地址。');return url.href.replace(/\/+$/,'').replace(/\/chat\/completions$/,'')+'/chat/completions'}


function normalizeCriticReport(raw){
  if(!raw||!Number.isFinite(raw.score))throw Error('视觉模型返回的报告缺少有效 score。');
  for(const key of ['summary','anatomy','consistency'])if(typeof raw[key]!=='string'||!raw[key].trim())throw Error('报告缺少 '+key+'，请检查模型的 JSON 输出能力。');
  const issues=Array.isArray(raw.issues)?raw.issues.slice(0,10).filter(x=>x&&typeof x.observation==='string').map(x=>({area:String(x.area||'画面'),severity:['high','medium','low'].includes(x.severity)?x.severity:'medium',observation:x.observation.slice(0,1600),fixPrompt:String(x.fixPrompt||'').slice(0,1600)})):[];
  const suggestions=typeof raw.suggestions==='string'?raw.suggestions:issues.map(i=>i.fixPrompt).filter(Boolean).join(', ');if(!suggestions&&issues.some(i=>i.severity==='high'))throw Error('报告指出高优先级问题，但没有返回可执行的修改建议。');
  const score=clamp(Math.round(raw.score*10)/10,1,10);return {score,passed:score>=7,summary:raw.summary.slice(0,3000),anatomy:raw.anatomy.slice(0,3000),consistency:raw.consistency.slice(0,3000),suggestions:suggestions.slice(0,4000),issues};
}


function ensureReleaseSettings(s=state){
  s.settings.critic={...clone(criticDefaults),...(s.settings.critic||{})};
  const gh=s.settings.github||{};s.settings.github={repository:String(gh.repository||''),branch:String(gh.branch||''),path:String(gh.path||'')};
  s.settings.tutorial={seen:false,completed:false,readSteps:[],lastStep:0,...(s.settings.tutorial||{})};
  if(!Array.isArray(s.settings.tutorial.readSteps))s.settings.tutorial.readSteps=[];
  s.appVersion=STUDIO_VERSION;return s;
}


function checkVariableKey(key){if(typeof key!=='string'||!/^[\p{L}\p{N}_]+$/u.test(key)||systemVariableKeys.has(key))throw Error('变量标识符只能包含中英文字母、数字和下划线，不可使用危险系统属性。');return key}


function typedVariableValue(entry){if(entry.type==='image'){const value=entry.value;if(value&&typeof value==='object'&&value.kind==='mio-image')return clone(value);return{kind:'mio-image',src:typeof value==='string'?value:'',name:entry.key}}if(entry.value===undefined||entry.value===null||typeof entry.value==='string'&&!entry.value.trim())return'';switch(entry.type){case'text':return String(entry.value);case'number':if(!Number.isFinite(Number(entry.value)))throw Error('属性 '+entry.key+' 需要有效数字，或留空使用默认值。');return Number(entry.value);case'boolean':if(typeof entry.value==='boolean')return entry.value;if(['true','false'].includes(entry.value))return entry.value==='true';throw Error('属性 '+entry.key+' 需要 true 或 false。');case'json':if(typeof entry.value==='string'){try{return JSON.parse(entry.value)}catch(e){throw Error('属性 '+entry.key+' 的 JSON 格式不合法。')}}return clone(entry.value);default:throw Error('不支持的属性类型。')}}


function variableEntry(key,value){const type=typeof value==='number'?'number':typeof value==='boolean'?'boolean':value&&typeof value==='object'?'json':'text';return{id:uid('var'),key,type,value:type==='json'?JSON.stringify(value,null,2):value??''}}


function ensureCreationModel(s=state){
  const first=!s.creation;
  s.creation??={version:1,variableSets:[],plans:[]};s.creation.variableSets??=[];s.creation.plans??=[];
  s.settings.studio.visibility.logs??=true;s.settings.studio.shell??={collapsed:false};
  if(!s.settings.studio.creationMigration){s.settings.studio.visibility.llm=false;s.settings.studio.shell.collapsed=innerWidth<760;s.settings.studio.creationMigration=1}
  s.settings.backend={enabled:false,baseUrl:'',loadPath:'',savePath:'',method:'PUT',payloadField:'state',responseField:'state',...(s.settings.backend||{})};
  for(const t of s.templates)for(const f of t.frames){f.id ||=uid('frame');if(f.renderOverride===undefined)f.renderOverride=false;f.nodeOverrides??={}}
  // Native rows and plans are independent files. Never infer new presets/plans
  // from a row on reload: that would bypass import consent or resurrect deletions.
  if(!Array.isArray(s.settings.comfy.bindings)){s.settings.comfy.bindings=initialWorkflowBindings(s.settings.comfy);s.settings.comfy.bindingVersion=1}
  s.settings.comfy.outputNodeId??=s.settings.comfy.mapping?.output||'';s.settings.comfy.randomizeSeeds??=false;s.settings.comfy.objectInfo??={};
  if(first)s.creation.migratedAt=Date.now();return s;
}


function scopeText(text,scope){const policy=globalThis.ComfyComic?.promptPolicy;return policy?resolveImageVariables(text,scope||{}).prompt:String(text??'')}


function missingScopeKeys(text,scope={}){
  const raw=String(text??''),safeScope=scope||{};
  const missing=[];
  for(const match of raw.matchAll(/\{([\p{L}\p{N}_]+)\}/gu)){
    const start=match.index,end=start+match[0].length;
    if(raw[start-1]==='{'||raw[end]==='}'||raw[start-1]==='\\')continue;
    const key=match[1];
    if(!Object.hasOwn(safeScope,key))missing.push(key);
  }
  return [...new Set(missing)];
}


/* Source: /js/state.js. The build tool keeps this standalone delivery in sync. */
function createStudioStateContract() {
  const MAX_FRAMES=512,requiredFields=Object.freeze(['templates','savedGalleries','batchMatrix','comfyWorkflows','comfyConfig','llmConfig','xmlConfig','chatConfig','uiConfig','batchRunState']);
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v)),object=v=>plain(v)?v:{};
  function collection(value,keys=[]){if(Array.isArray(value))return value;if(!plain(value))return[];for(const key of keys)if(Array.isArray(value[key]))return value[key];return Object.values(value).filter(plain)}
  function replaceCollection(original,items,keys,defaultKey){if(Array.isArray(original)||original===undefined||original===null)return copy(items);for(const key of keys)if(Array.isArray(original[key]))return{...copy(original),[key]:copy(items)};if(Object.keys(original).length&&Object.values(original).every(plain))return Object.fromEntries(items.map(item=>[item.id,copy(item)]));return{...copy(object(original)),[defaultKey]:copy(items)}}
  function assertFrameCount(frames,label='frames'){if(!Array.isArray(frames))throw Error(label+' must be an array.');if(frames.length>MAX_FRAMES)throw Error(label+' exceeds 512 frames.');return frames}
  function safeId(value,prefix,index){const candidate=String(value??'');if(/^[a-zA-Z0-9_-]{1,150}$/.test(candidate)&&!['__proto__','constructor','prototype'].includes(candidate))return candidate;let digest=2166136261;for(const char of candidate)digest=Math.imul(digest^char.charCodeAt(0),16777619);return prefix+'_'+index+'_'+(digest>>>0).toString(36)}
  function frame(value,index){const s=object(value);return{...copy(s),id:safeId(s.id,'frame',index),name:String(s.name??s.title??'Scene '+(index+1)),prompt:String(s.prompt??s.positivePrompt??''),caption:String(s.caption??s.text??''),negative:String(s.negative??s.negativePrompt??''),renderOverride:s.renderOverride===true,nodeOverrides:copy(object(s.nodeOverrides)),width:Number(s.width??768),height:Number(s.height??1024),steps:Number(s.steps??24),cfg:Number(s.cfg??7),denoise:Number(s.denoise??1),seed:Number(s.seed??-1)}}
  function normalizeBook(b,index=0,now=Date.now(),projectId=v=>String(v??'')){const source=object(b),rawSteps=source.steps??source.frames??[];assertFrameCount(rawSteps,'book.steps');const steps=rawSteps.map((f,i)=>({...object(f),stepIndex:Number.isInteger(f?.stepIndex)?f.stepIndex:i,name:String(f?.name??'Scene '+(i+1)),prompt:String(f?.prompt??''),caption:String(f?.caption??''),image:String(f?.image??'')})),implied=steps.reduce((n,f)=>Math.max(n,f.stepIndex+1),0),total=Math.max(Number.isInteger(source.totalSteps)?source.totalSteps:0,implied);if(total>MAX_FRAMES)throw Error('A book exceeds the 512-frame limit.');if(source._lazy&&(!Number.isInteger(source.generatedSteps)||source.generatedSteps<0||source.generatedSteps>total||steps.length))throw Error('Invalid read-only album summary.');return{...copy(source),id:safeId(source.id,'book',index),projectId:projectId(source.projectId),title:String(source.title??'Untitled book'),characterName:String(source.characterName??source.character??''),rowId:safeId(source.rowId,'source_row',index),templateId:safeId(source.templateId,'source_template',index),templateTitle:String(source.templateTitle??''),synopsis:String(source.synopsis??''),tags:(Array.isArray(source.tags)?source.tags:[]).map(String),steps,totalSteps:total,generatedSteps:source._lazy?source.generatedSteps:steps.filter(f=>f.image).length,status:['complete','generating','failed','canceled','partial'].includes(source.status)?source.status:'complete',inProgress:false,createdAt:Number(source.createdAt)||now,updatedAt:Number(source.updatedAt)||now}}
  function normalize(s){
    s.schemaVersion='2.2';s.templates=Array.isArray(s.templates)?s.templates:collection(s.templates,['templates','items']);s.rows=Array.isArray(s.rows)?s.rows:collection(s.rows,['rows']);s.books=Array.isArray(s.books)?s.books:collection(s.books,['books','galleries']);s.queue=Array.isArray(s.queue)?s.queue:[];s.projects=Array.isArray(s.projects)?s.projects:[];
    if(!s.projects.length)s.projects=[{id:'project_default',title:'My project',createdAt:Date.now()}];s.projects=s.projects.map((p,i)=>({...object(p),id:safeId(p?.id,'project',i),title:String(p?.title??p?.name??'Project'),createdAt:Number(p?.createdAt)||Date.now()}));const defaultProject=s.projects.some(p=>p.id===s.activeProjectId)?s.activeProjectId:s.projects[0].id;s.activeProjectId=defaultProject;const projectId=v=>s.projects.some(p=>p.id===v)?v:defaultProject,now=Date.now();
    s.templates=s.templates.map((t,index)=>{const source=object(t),frames=source.frames??[];assertFrameCount(frames,'template.frames');const ids=frames.map((f,i)=>frame(f,i).id);if(new Set(ids).size!==ids.length)throw Error('分镜 ID 重复，无法可靠关联台词，请修正后导入。');return{...copy(source),id:safeId(source.id,'template',index),projectId:projectId(source.projectId),title:String(source.title??source.name??'Untitled storyboard'),outline:String(source.outline??source.synopsis??''),frames:frames.map(frame),createdAt:Number(source.createdAt)||now}});
    s.rows=s.rows.map((r,index)=>{const source=object(r),versions=copy(object(source.storyVersions)),active=copy(object(source.activeStoryVersionIds));for(const[key,values]of Object.entries(versions)){versions[key]=(Array.isArray(values)?values:[]).map((v,i)=>({...object(v),id:safeId(v?.id,'story',i),templateId:key,title:String(v?.title??'Story'),source:['manual','preset','llm'].includes(v?.source)?v.source:'manual',captions:Object.fromEntries((Array.isArray(v?.captions)?(s.templates.find(t=>t.id===key)?.frames||[]).map((f,i)=>[f.id,String(v.captions[i]??f.caption??'')]):Object.entries(object(v?.captions))).map(([id,text])=>[id,String(text)])),createdAt:Number(v?.createdAt)||now,updatedAt:Number(v?.updatedAt)||now}));if(!versions[key].some(v=>v.id===active[key]))delete active[key]}return{...copy(source),id:safeId(source.id,'row',index),projectId:projectId(source.projectId),active:source.active===true,bookTitle:String(source.bookTitle??source.title??''),character:String(source.character??''),style:String(source.style??''),outfit:String(source.outfit??''),storyVersions:versions,activeStoryVersionIds:active,references:copy(object(source.references))}});
    s.books=s.books.map((b,index)=>normalizeBook(b,index,now,projectId));
    s.queue=s.queue.map((task,index)=>{const source=object(task),indices=Array.isArray(source.indices)?source.indices:[];if(indices.some(i=>!Number.isInteger(i)||i<0||i>=MAX_FRAMES))throw Error('Queue frame index is outside 0..511.');const book=s.books.find(b=>b.id===String(source.bookId));return{...copy(source),id:safeId(source.id,'task',index),bookId:safeId(source.bookId,'book_ref',index),rowId:source.rowId??book?.rowId,templateId:source.templateId??book?.templateId,indices,done:Math.max(0,Math.min(indices.length,Number(source.done)||0)),status:['running','paused'].includes(source.status)?'pending':source.status||'pending'}});
    s.chats=Array.isArray(s.chats)?s.chats:[];if(!s.chats.length)s.chats=[{id:'chat_default',title:'New conversation',messages:[]}];if(!s.chats.some(c=>c.id===s.activeChatId))s.activeChatId=s.chats[0].id;s.customColumns=Array.isArray(s.customColumns)?s.customColumns:[];s.installedPackages=Array.isArray(s.installedPackages)?s.installedPackages:[];return s;
  }
  return Object.freeze({MAX_FRAMES,requiredFields,plain,object,copy,collection,replaceCollection,assertFrameCount,normalizeBook,normalize});
}


function installNativeStateModule(){const ns=globalThis.ComfyComic=globalThis.ComfyComic||{};ns.stateContract=createStudioStateContract();ns.MAX_FRAMES=ns.stateContract.MAX_FRAMES;ns.getState=()=>state;ns.replaceState=value=>{state=ns.stateContract.normalize(value);ensureStudioState()};ns.modules={...(ns.modules||{}),state:true}}


/* Domain source: js/state.js. This copy keeps the delivered document standalone. */
function createFreePromptPolicy(){
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
  function tokens(value,definitions=[]){const text=String(value??''),known=definitions instanceof Set?definitions:new Set(definitions),parts=[];let cursor=0;for(const match of text.matchAll(/\{([\p{L}\p{N}_]+)\}/gu)){const start=match.index,end=start+match[0].length;if(!known.has(match[1])||text[start-1]==='{'||text[end]==='}'||text[start-1]==='\\')continue;if(start>cursor)parts.push({type:'text',value:text.slice(cursor,start)});parts.push({type:'variable',key:match[1],value:match[0],start,end});cursor=end}if(cursor<text.length)parts.push({type:'text',value:text.slice(cursor)});return parts}
  function collapseEmptyPunctuation(text){let output='',ordinary='',quote='';const stack=[],close={'{':'}','[':']','(':')'},flush=last=>{let value=ordinary.replace(/[,，](?:[ \t]*[,，])+/g,',').replace(/[,，][ \t]+/g,', ').replace(/[ \t]{2,}/g,' ');if(!output)value=value.replace(/^[ \t,，]+/,'');if(last)value=value.replace(/[ \t,，]+$/,'');output+=value;ordinary=''};for(let i=0;i<text.length;i++){const char=text[i];if(quote){output+=char;if(char==='\\'&&i+1<text.length)output+=text[++i];else if(char===quote)quote='';continue}if(char==='"'||char==="'"){flush(false);quote=char;output+=char;continue}if(close[char]){flush(false);stack.push(close[char]);output+=char;continue}if(stack.length){output+=char;if(char===stack[stack.length-1])stack.pop();continue}ordinary+=char}flush(true);return output}
  function interpolate(value,values={},definitions=Object.keys(values||{})){const known=new Set([...(definitions||[]),...Object.keys(values||{})]);let removedEmpty=false;const output=tokens(value,known).map(part=>{if(part.type!=='variable')return part.value;const item=own(values,part.key)?values[part.key]:'';if(item===undefined||item===null||item===''){removedEmpty=true;return''}if(typeof item==='object'){try{return JSON.stringify(item)}catch(e){return String(item)}}return String(item)}).join('');return removedEmpty?collapseEmptyPunctuation(output):output}
  function hasUnclosedBrace(value){let open=0;for(const char of String(value??'')){if(char==='{')open++;else if(char==='}'&&open>0)open--}return open>0}
  return Object.freeze({tokens,interpolate,collapseEmptyPunctuation,hasUnclosedBrace});
}


function definedPromptNames(scope={}){const names=new Set([...Object.keys(scope||{}),...(state.creation?.removedImageKeys?.[state.activeProjectId]||[])]);const collectionId=state.activeProjectId;for(const set of state.creation?.variableSets||[])if(set.projectId===collectionId)for(const entry of set.entries||[])names.add(entry.key);for(const plan of state.creation?.plans||[])if(plan.projectId===collectionId){for(const entry of plan.variables||[])names.add(entry.key);for(const override of Object.values(plan.sceneOverrides||{}))for(const entry of override.variables||[])names.add(entry.key)}return names}


function ensureArtSettings(s=state){
  if(!s.settings.presentation){s.settings.presentation={version:1,lab:{refine:false,mask:false},fonts:false,readerMode:'spread'};if(s.settings.studio){s.settings.studio.features.visualCritic=false;s.settings.studio.features.assistant=false;s.settings.studio.visibility.logs=false}s.settings.autoCritique=false}
  s.settings.presentation.lab??={refine:false,mask:false};s.settings.presentation.fonts??=false;if(!['spread','webtoon','gallery'].includes(s.settings.presentation.readerMode))s.settings.presentation.readerMode='spread';if(s.settings.studio)s.settings.studio.appearance.showMetrics=false;
  upgradeCuratedCharacterIdentity(s,()=>uid('var'));
  restoreCuratedCover(s);
  return s;
}


function scenicDemoFrame(scene,seed=1){return svgArt(scene,seed)}


/* Domain source: js/state.js. Prompt identity and reader-facing identity stay independent. */
function resolveCharacterNames(values={}){
  const promptName=String(values?.character??'');
  const displayName=Object.hasOwn(values||{},'character_display_name')?String(values.character_display_name??''):promptName;
  return{promptName,displayName};
}


function curatedAdventureSpec(){return clone(MioContent.demoSpec)}


function upgradeCuratedCharacterIdentity(){return 0}


function createCuratedDemo(base){const s=clone(base),roles=MioContent.registry.demo;for(const key of ['projects','books','templates','rows','chats']){s[key]=s[key].filter(v=>roles[key].includes(v.id));if(!s[key].length)throw Error('示范资源已从 data/ 删除；请导入您自己的资源，不会从源码重新生成。')}s.creation={...s.creation,plans:s.creation.plans.filter(v=>roles.plans.includes(v.id)),variableSets:s.creation.variableSets.filter(v=>roles.variableSets.includes(v.id))};s.activeProjectId=s.projects[0].id;s.activeChatId=s.chats[0].id;s.queue=[];return s}


function trimUntouchedDemoBook(book,isOriginalDemoPage){if(!book||book.curatedDemo!==true||book.demoContentRevision===2||!Array.isArray(book.steps))return false;if(book.steps.length<2){book.demoContentRevision=2;return false}if(!book.steps.slice(1).every(step=>isOriginalDemoPage(step)))return false;const first=book.steps.find(s=>s.stepIndex===0);if(!first)return false;book.steps=[first];book.totalSteps=1;book.generatedSteps=first.image?1:0;book.status=first.image?'complete':'canceled';book.demoContentRevision=2;book.updatedAt=Date.now();return true}


function originalDemoPage(){return false}


function ensureCollectionDisplay(s=state){
  s.settings.presentation??={};const p=s.settings.presentation;
  if(!p.homeLayout){try{p.homeLayout=localStorage.getItem('cc-home-layout')||'showcase'}catch(e){p.homeLayout='showcase'}}p.homeLayout=displayModel.mode(p.homeLayout);
  if(!['spread','webtoon','gallery'].includes(p.defaultReaderMode))p.defaultReaderMode='webtoon';
  p.language=p.language==='en'?'en':p.language==='zh-CN'?'zh-CN':rememberedInterfaceLanguage();
  if(!p.lettering){try{p.lettering=localStorage.getItem('cc-lettering')||'editorial'}catch(e){p.lettering='editorial'}}if(!['editorial','calligraphy','classic'].includes(p.lettering))p.lettering='editorial';
  return s;
}


/* Domain source: js/state.js. Keep this operation side-effect free until confirmation. */
function planCollectionRemoval(studio,collectionId,replacement){
  const list=value=>Array.isArray(value)?value:[],target=list(studio.projects).find(item=>item.id===collectionId);if(!target)throw Error('Collection does not exist.');
  const remainingProjects=list(studio.projects).filter(item=>item.id!==collectionId),lastCollection=remainingProjects.length===0;
  if(lastCollection){if(!replacement?.id||replacement.id===collectionId)throw Error('An empty replacement collection is required.');remainingProjects.push({...replacement})}
  const books=list(studio.books).filter(item=>item.projectId!==collectionId),plans=list(studio.creation?.plans).filter(item=>item.projectId!==collectionId),removedBookIds=new Set(list(studio.books).filter(item=>item.projectId===collectionId).map(item=>item.id)),removedPlanIds=new Set(list(studio.creation?.plans).filter(item=>item.projectId===collectionId).map(item=>item.id));let sharedAssets=0;
  const retainReferenced=(items,findOwner)=>list(items).flatMap(item=>{if(item.projectId!==collectionId)return[item];const owner=findOwner(item);if(!owner)return[];sharedAssets++;const projectId=remainingProjects.some(p=>p.id===owner.projectId)?owner.projectId:remainingProjects[0].id;return[{...item,projectId}]});
  const rows=retainReferenced(studio.rows,row=>plans.find(p=>p.rowId===row.id)||books.find(b=>b.rowId===row.id)),templates=retainReferenced(studio.templates,template=>plans.find(p=>p.templateId===template.id)||books.find(b=>b.templateId===template.id)||rows.find(r=>list(r.storyVersions?.[template.id]).length)),variableSets=retainReferenced(studio.creation?.variableSets,set=>plans.find(p=>list(p.variableSetIds).includes(set.id)));
  const removedTemplateIds=new Set(list(studio.templates).filter(t=>!templates.some(kept=>kept.id===t.id)).map(t=>t.id)),removedAssetIds=new Set([...removedBookIds,...removedPlanIds,...removedTemplateIds,...list(studio.rows).filter(r=>!rows.some(kept=>kept.id===r.id)).map(r=>r.id),...list(studio.creation?.variableSets).filter(s=>!variableSets.some(kept=>kept.id===s.id)).map(s=>s.id)]);
  const queue=list(studio.queue).filter(task=>task.projectId!==collectionId&&!removedBookIds.has(task.bookId)&&!removedPlanIds.has(task.planId)),chats=list(studio.chats).filter(chat=>chat.projectId!==collectionId&&!removedTemplateIds.has(chat.templateId)&&!removedBookIds.has(chat.bookId)),removedChats=list(studio.chats).length-chats.length;
  if(!chats.length)chats.push({id:'chat_collection_default',title:'New conversation',messages:[]});
  const settings={...studio.settings},tutorial=settings.tutorial;if(tutorial?.practiceProjectId===collectionId||removedBookIds.has(tutorial?.practiceBookId)){settings.tutorial={...tutorial};for(const key of ['practiceProjectId','practiceBookId','practiceTemplateId'])delete settings.tutorial[key]}
  const next={...studio,projects:remainingProjects,books,rows,templates,queue,chats,settings,activeProjectId:studio.activeProjectId===collectionId||!remainingProjects.some(p=>p.id===studio.activeProjectId)?remainingProjects[0].id:studio.activeProjectId,activeChatId:chats.some(chat=>chat.id===studio.activeChatId)?studio.activeChatId:chats[0].id,creation:{...studio.creation,plans,variableSets},installedPackages:list(studio.installedPackages).flatMap(pkg=>{if(!Array.isArray(pkg.assetIds)||!pkg.assetIds.length)return[pkg];const assetIds=pkg.assetIds.filter(id=>!removedAssetIds.has(id));return assetIds.length?[{...pkg,assetIds}]:[]}),updatedAt:Date.now()};
  return{next,summary:{title:target.title,books:removedBookIds.size,plans:removedPlanIds.size,templates:list(studio.templates).length-templates.length,rows:list(studio.rows).length-rows.length,variableSets:list(studio.creation?.variableSets).length-variableSets.length,chats:removedChats,tasks:list(studio.queue).length-queue.length,sharedAssets,lastCollection}};
}

// The original, repository-referenced cover, embedded so standalone/offline views work.
function defaultCuratedCover(){return MioContent.cover||''}

function restoreCuratedCover(){return 0}


function isImageVariable(value){return !!value&&typeof value==='object'&&value.kind==='mio-image'}
function resolveImageVariables(text,scope={},strict=false,negative=''){
  const policy=globalThis.ComfyComic.promptPolicy,definitions=definedPromptNames(scope),values={...scope},images=[],byKey=new Map();
  for(const part of policy.tokens(String(text??'')+'\n'+negative,definitions)){
    if(part.type!=='variable')continue;const value=scope[part.key];if(strict&&!Object.hasOwn(scope,part.key))throw Error('变量 {'+part.key+'} 在当前作用域中缺失。');
    if(!isImageVariable(value))continue;
    if(byKey.has(part.key))continue;
    if(strict&&!value.src)throw Error('图片变量 {'+part.key+'} 尚未上传图片。');
    const index=images.length+1;byKey.set(part.key,index);values[part.key]='@image_'+index;images.push({...clone(value),key:part.key,index});
  }
  return{prompt:policy.interpolate(text,values,definitions),negative:policy.interpolate(negative,values,definitions),images};
}

function rememberRemovedImageVariable(entry,projectId=state.activeProjectId){if(entry?.type!=='image')return;state.creation.removedImageKeys??={};state.creation.removedImageKeys[projectId]=[...new Set([...(state.creation.removedImageKeys[projectId]||[]),entry.key])];}

function fileLayout(id){const value=MioContent.layouts.find(t=>t.id===id);if(!value)throw Error('展示模板已从 data/ 移除，请导入模板或选择其他版式。');return clone(value)}
