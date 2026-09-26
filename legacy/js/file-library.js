/* File-native transport. Summaries are never writable album bodies. */
'use strict';
function nativeSplitDTO(value){
  const c=clone(value),uiConfig=c.uiConfig||{},meta=uiConfig.comfyStudio||{},creation=meta.creation||{},matrix=c.batchMatrix||{},chats=c.chatConfig||{},queue=c.batchRunState||{};
  const groups={storyboards:c.templates||[],albums:c.savedGalleries||[],workflows:c.comfyWorkflows||[],rows:matrix.rows||[],collections:meta.projects||[],plans:creation.plans||[],layouts:meta.exportTemplates||[],conversations:chats.sessions||[],tasks:queue.queue||[],characters:[],scenes:[]};
  const presets=creation.variableSets||[];for(const item of presets)groups[item.category==='scenes'?'scenes':'characters'].push(item);
  delete matrix.rows;delete chats.sessions;delete queue.queue;delete meta.projects;delete creation.plans;delete creation.variableSets;delete meta.exportTemplates;
  // A preset draft without unsaved edits is an exact copy of its preset and is rebuilt on demand
  // (settingPresetDraft), so only dirty drafts are written to settings/workspace.json.
  const edits=meta.drafts?.presetEdits;if(edits&&typeof edits==='object')for(const [id,draft] of Object.entries(edits))if(draft?.dirty!==true)delete edits[id];
  const settings={comfy:c.comfyConfig||{},llm:c.llmConfig||{},xml:c.xmlConfig||{}},ordering={},fieldKinds={templates:'storyboards',savedGalleries:'albums',rows:'rows',projects:'collections',plans:'plans',characters:'characters',scenes:'scenes',exportTemplates:'layouts',comfyWorkflows:'workflows',sessions:'conversations',queue:'tasks'};
  for(const[field,kind]of Object.entries(fieldKinds))ordering[field]=groups[kind].map(x=>x.id);ordering.variableSets=presets.map(x=>x.id);
  const excluded=new Set(['uiConfig','templates','savedGalleries','comfyWorkflows','batchMatrix','chatConfig','batchRunState','comfyConfig','llmConfig','xmlConfig','expectedRevision','forceWrite','updatedAt']);
  settings.workspace={globals:Object.fromEntries(Object.entries(c).filter(([k])=>!k.startsWith('_')&&!excluded.has(k))),ui:uiConfig,matrix,chats,queue,ordering,aliases:[],executionStartPolicy:'manual'};
  return{groups,settings};
}
function nativeEqual(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const ak=Object.keys(a),bk=Object.keys(b);
  return ak.length===bk.length&&ak.every(k=>Object.hasOwn(b,k)&&nativeEqual(a[k],b[k]));
}
function nativeDelta(studio,payload,previous){
  // This transport is private/local. General backup converters still strip keys.
  for(const name of ['llm','xml'])if(studio.settings[name]?.key)payload[name+'Config'].key=studio.settings[name].key;
  if(studio.settings.critic?.key)payload.uiConfig.comfyStudio.settings.critic.key=studio.settings.critic.key;
  const next=nativeSplitDTO(payload),old=nativeSplitDTO(previous),revisions=previous._fileRevisions||{},changes=[],removals=[],settings=[];
  for(const[kind,items]of Object.entries(next.groups)){
    const prior=new Map((old.groups[kind]||[]).map(x=>[x.id,x])),ids=new Set(items.map(x=>x.id));
    for(const item of items)if(!item._lazy&&!nativeEqual(item,prior.get(item.id)))changes.push({kind,id:item.id,document:item,baseline:prior.get(item.id),expected:revisions[kind+':'+item.id]||null});
    for(const item of old.groups[kind]||[])if(!ids.has(item.id))removals.push({kind,id:item.id,expected:revisions[kind+':'+item.id]||null});
  }
  for(const[name,document]of Object.entries(next.settings))if(!nativeEqual(document,old.settings[name]))settings.push({name,document,baseline:old.settings[name],expected:revisions['settings:'+name]||null});
  return{format:'mio.delta.v2',changes,removals,settings};
}
function installFileLibrary(){
  const ns=globalThis.ComfyComic,inflight=new Map();
  async function hydrate(id){
    const book=bookBy(id);if(!book?._lazy)return book;
    if(inflight.has(id))return inflight.get(id);
    const operation=(async()=>{
      const response=await request('/api/library/entity/albums/'+encodeURIComponent(id));const record=await response.json();
      if(!record.document||record.document.id!==id)throw Error('画册正文返回不完整，未替换现有内容。');
      const current=bookBy(id);if(!current)return null;
      const pending=Object.values(current.pictureEdits||{});
      // A raw album.json (e.g. published by the production queue) may lack contract
      // fields such as rowId/templateId. Normalize it exactly like initial load does,
      // keeping the identifiers the summary already carried, so validateState keeps
      // accepting the workspace and saves/exports are not blocked after reading.
      const index=Math.max(0,state.books.indexOf(current)),projectId=v=>state.projects.some(p=>p.id===v)?v:state.activeProjectId;
      const document=ns.stateContract.normalizeBook({...record.document,rowId:record.document.rowId??current.rowId,templateId:record.document.templateId??current.templateId,projectId:record.document.projectId??current.projectId},index,Date.now(),projectId);
      Object.keys(current).forEach(k=>delete current[k]);Object.assign(current,document);
      const prior=ns.sync.runtime.previous.savedGalleries?.find(x=>x.id===id);if(prior){Object.keys(prior).forEach(k=>delete prior[k]);Object.assign(prior,clone(document))}
      ns.sync.runtime.previous._fileRevisions??={};ns.sync.runtime.previous._fileRevisions['albums:'+id]=record.etag;
      for(const edit of pending)ns.pictures?.apply(edit);
      return current;
    })();inflight.set(id,operation);try{return await operation}finally{inflight.delete(id)}
  }
  async function hydrateAll(){for(const book of [...state.books])await hydrate(book.id)}
  /* Live album sync: pull one album document that another writer (the production queue)
     changed on disk and fold it into the open workspace without a full reload.
     Returns {status:'created'|'updated'|'unchanged'|'missing', book, changed:[stepIndex…], structure}. */
  const pageSignature=book=>({total:book.totalSteps||book.steps?.length||0,pages:new Map((book.steps||[]).map((s,i)=>[s.stepIndex??i,[s.image,s.caption,s.name,s.prompt,s.offlineFallback].join('\u0001')]))});
  function changedPages(before,after){if(!before)return{changed:[...after.pages.keys()],structure:true};const changed=[];for(const [i,sig] of after.pages)if(before.pages.get(i)!==sig)changed.push(i);for(const i of before.pages.keys())if(!after.pages.has(i))changed.push(i);return{changed:changed.sort((a,b)=>a-b),structure:before.total!==after.total}}
  const refreshing=new Map();
  async function refreshAlbum(id){
    if(refreshing.has(id))return refreshing.get(id);
    const operation=(async()=>{
      let record;
      try{const response=await request('/api/library/entity/albums/'+encodeURIComponent(id));record=await response.json()}
      catch(error){if(/^HTTP 404\b/.test(error?.message||''))return{status:'missing',book:null,changed:[],structure:false};throw error}
      if(!record.document||record.document.id!==id)throw Error('画册正文返回不完整，未替换现有内容。');
      const previous=ns.sync.runtime.previous;previous.savedGalleries??=[];previous._fileRevisions??={};
      const current=bookBy(id),projectId=v=>state.projects.some(p=>p.id===v)?v:state.activeProjectId;
      const index=current?Math.max(0,state.books.indexOf(current)):state.books.length;
      const document=ns.stateContract.normalizeBook({...record.document,rowId:record.document.rowId??current?.rowId,templateId:record.document.templateId??current?.templateId,projectId:record.document.projectId??current?.projectId},index,Date.now(),projectId);
      if(!current){
        state.books.push(document);previous.savedGalleries.push(clone(document));previous._fileRevisions['albums:'+id]=record.etag;
        return{status:'created',book:document,changed:[...pageSignature(document).pages.keys()],structure:true};
      }
      const before=current._lazy?null:pageSignature(current),pending=Object.values(current.pictureEdits||{});
      const baseline=previous.savedGalleries.find(x=>x.id===id);
      // Three-way merge keeps unsaved local edits (title, likes, page fixes) while taking every page the queue wrote.
      const merged=current._lazy||!baseline||baseline._lazy?document:nativeReconcile(current,baseline,document);
      const unchanged=!current._lazy&&nativeEqual(merged,current)&&previous._fileRevisions['albums:'+id]===record.etag;
      Object.keys(current).forEach(k=>delete current[k]);Object.assign(current,merged);
      if(baseline){Object.keys(baseline).forEach(k=>delete baseline[k]);Object.assign(baseline,clone(document))}else previous.savedGalleries.push(clone(document));
      previous._fileRevisions['albums:'+id]=record.etag;
      for(const edit of pending)ns.pictures?.apply(edit);
      if(unchanged)return{status:'unchanged',book:current,changed:[],structure:false};
      return{status:'updated',book:current,...changedPages(before,pageSignature(current))};
    })();refreshing.set(id,operation);try{return await operation}finally{refreshing.delete(id)}
  }
  ns.fileLibrary={hydrate,hydrateAll,refreshAlbum};
  const oldPackage=buildDiskPackage;buildDiskPackage=async function(source,...args){if(source.books?.some(b=>b._lazy)){const copy=clone(source);for(let i=0;i<copy.books.length;i++)if(copy.books[i]._lazy){const book=await hydrate(copy.books[i].id);if(!book)throw Error('备份所需画册已被删除，未导出残缺摘要。');copy.books[i]=clone(book)}source=copy}return oldPackage(source,...args)};
  const oldBackup=backupObject;backupObject=function(...args){if(state.books.some(b=>b._lazy))throw Error('请通过备份入口完整读取画册后再导出。');return oldBackup(...args)};
  const oldRemote=syncRemote;syncRemote=async function(...args){await hydrateAll();return oldRemote(...args)};
  const action=handleAction;
  handleAction=async function(act,data={},element){
    const id=data.id||data.book||ui.bookId;
    if(id&&bookBy(id)?._lazy)await hydrate(id);
    if(/bulk|compare-book|backup|disk-archive|directory|import-project|restore|collection-delete/.test(act))await hydrateAll();
    if(act.startsWith('et-')&&state.books[0]?._lazy)await hydrate(state.books[0].id);
    return action(act,data,element);
  };
  const reader=openArtReader;openArtReader=function(id){return bookBy(id)?._lazy?hydrate(id).then(()=>reader(id)):reader(id)};
  const oldExport=exportModal;exportModal=function(ids){return ids.some(id=>bookBy(id)?._lazy)?Promise.all(ids.map(hydrate)).then(()=>oldExport(ids)):oldExport(ids)};
  const olderReader=openReader;openReader=function(id){return bookBy(id)?._lazy?hydrate(id).then(()=>olderReader(id)):olderReader(id)};
  const oldMissing=missingIndices;missingIndices=function(book){return book?._lazy?(book._missingIndices||[]):oldMissing(book)};
  const oldScore=score;score=function(book){return book?._lazy?book._score||0:oldScore(book)};
  const previousRender=render;render=function(){previousRender();
    for(const input of document.querySelectorAll('input[type="password"]'))if(!input.value&&!input.hasAttribute('placeholder'))input.placeholder='留空保留已存密钥';
    if(ui.workspace===0&&ns.sync.runtime.previous._libraryProblems?.length){const node=document.createElement('div');node.className='notice';node.textContent='部分独立文件存在格式或重复 ID 问题，未自动修复或覆盖。请查看设置中的文件库诊断。';document.querySelector('#gallery-results')?.prepend(node)}
    /* Runtime diagnostics report missing seeds, never differences from release checksums. */
    if(ui.workspace===0&&Array.isArray(globalThis.MioContent?.contentProblems)&&MioContent.contentProblems.length&&!document.querySelector('#gallery-results .content-problem-notice')){const node=document.createElement('div');node.className='notice amber content-problem-notice';const count=MioContent.contentProblems.length;node.textContent=count+' 个随附内容文件缺失，未复制；现有作品未被覆盖。请查看设置 → 文件库诊断。';document.querySelector('#gallery-results')?.prepend(node)}
  };
  const oldVision=visionRequest;visionRequest=async function(messages,cfg,signal){if(!/^http/.test(location.protocol))return oldVision(messages,cfg,signal);if(cfg.mode!=='real')throw Error('请先启用真实视觉 API。');const message=await chatCompletion(messages,null,signal,{...cfg,_credentialScope:cfg.connection==='shared'?'llm':'critic'});if(typeof message.content!=='string'||!message.content.trim())throw Error('视觉模型未返回文本结果。');return message.content};
  const priorChat=chatCompletion;
  chatCompletion=async function(messages,tools,signal,cfg=state.settings.llm){
    if(!/^http/.test(location.protocol))return priorChat(messages,tools,signal,cfg);
    if(!await ns.sync.save())throw Error('连接设置尚未保存，未发送模型请求。');
    const scope=cfg===state.settings.xml?'xml':cfg._credentialScope||'llm',body={model:cfg.model,messages,temperature:.75};if(tools){body.tools=tools;body.tool_choice='auto'}
    const response=await request('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,baseUrl:cfg.baseUrl,key:cfg.key||'',body}),signal},90000);
    const json=await response.json(),message=json.choices?.[0]?.message;
    if(!message||message.role!=='assistant')throw Error('模型未返回合法的 assistant 消息。');if(message.tool_calls&&(!Array.isArray(message.tool_calls)||message.tool_calls.some(c=>typeof c.id!=='string'||!c.function||typeof c.function.name!=='string'||typeof c.function.arguments!=='string')))throw Error('模型工具调用结构不完整，未写入会话。');return message;
  };
}
function nativeAck(studio,payload,data){
  const before=nativeSplitDTO(payload).groups,live=nativeSplitDTO(globalThis.ComfyComic.converters.toApi(studio,payload)).groups;
  for(const [identity,confirmed]of Object.entries(data.entities||{})){
    const split=identity.indexOf(':'),kind=identity.slice(0,split),id=identity.slice(split+1),submitted=before[kind]?.find(x=>x.id===id),current=live[kind]?.find(x=>x.id===id);
    if(!submitted||!current)continue;
    const patched=nativeReconcile(current,submitted,confirmed),target=kind==='albums'?studio.books:kind==='storyboards'?studio.templates:kind==='plans'?studio.creation.plans:kind==='characters'||kind==='scenes'?studio.creation.variableSets:kind==='rows'?studio.rows:kind==='collections'?studio.projects:kind==='tasks'?studio.queue:kind==='layouts'?studio.exportTemplates:kind==='workflows'?studio.settings.comfy.presets:studio.chats;
    const item=target?.find(x=>x.id===id);if(item)nativePatch(item,patched)
    const confirmedTarget=kind==='albums'?payload.savedGalleries:kind==='storyboards'?payload.templates:kind==='plans'?payload.uiConfig.comfyStudio.creation.plans:kind==='characters'||kind==='scenes'?payload.uiConfig.comfyStudio.creation.variableSets:kind==='rows'?payload.batchMatrix.rows:kind==='collections'?payload.uiConfig.comfyStudio.projects:kind==='tasks'?payload.batchRunState.queue:kind==='layouts'?payload.uiConfig.comfyStudio.exportTemplates:kind==='workflows'?payload.comfyWorkflows:payload.chatConfig.sessions;
    const index=confirmedTarget?.findIndex(x=>x.id===id);if(index>=0)confirmedTarget[index]=clone(confirmed);
  }
  nativeAckSettings(studio,payload,data.settingsDocuments||{});
  for(const name of ['llm','xml']){
    const doc=payload[name+'Config'];if(!doc)continue;
    if(studio.settings[name]?.key===doc.key)studio.settings[name].key='';doc.key='';
    if(data.secretRefs?.[name])doc._secretRefs=data.secretRefs[name];
  }
  const doc=payload.uiConfig?.comfyStudio?.settings?.critic;
  if(doc){if(studio.settings.critic?.key===doc.key)studio.settings.critic.key='';doc.key=''}
}

function nativeReconcile(current,submitted,confirmed){
  if(nativeEqual(current,submitted))return clone(confirmed);
  if(current&&submitted&&confirmed&&[current,submitted,confirmed].every(v=>typeof v==='object'&&!Array.isArray(v))){const result=clone(current);for(const k of new Set([...Object.keys(submitted),...Object.keys(confirmed)])){if(Object.hasOwn(confirmed,k))result[k]=nativeReconcile(current[k],submitted[k],confirmed[k]);else if(nativeEqual(current[k],submitted[k]))delete result[k]}return result}
  if([current,submitted,confirmed].every(Array.isArray)){const items=[...current,...submitted,...confirmed],key=items.every(x=>x&&typeof x==='object'&&'id'in x)?'id':'stepIndex';if(items.every(x=>x&&typeof x==='object'&&key in x)){const ids=[...new Set([...current,...confirmed].map(x=>x[key]))];return ids.map(id=>{const a=current.find(x=>x[key]===id),b=submitted.find(x=>x[key]===id),c=confirmed.find(x=>x[key]===id);if(!a)return c&&!b?clone(c):undefined;if(!c)return b&&nativeEqual(a,b)?undefined:a;return nativeReconcile(a,b,c)}).filter(Boolean)}}
  return current;
}
function nativeLibrarySettings(){
  const problems=ComfyComic.sync.runtime.previous._libraryProblems||[],content=Array.isArray(globalThis.MioContent?.contentProblems)?MioContent.contentProblems:[];
  return '<section class="settings-section"><h2>独立文件库</h2><div class="service-context"><code>data/settings/ · storyboards/ · presets/ · collections/ · albums/</code></div><div class="row wrap" style="margin:15px 0">'+btn('扫描并重新读取','refresh','v3-connect-backend')+'</div><p class="help">'+(problems.length?esc(JSON.stringify(problems)):'文件库未报告冲突。修改同一字段发生版本冲突时，保留本页草稿，不强制覆盖。')+'</p>'+(content.length?'<div class="notice amber"><strong>随附内容文件缺失（未复制）</strong><ul class="content-problem-list">'+content.map(p=>'<li><code>'+esc(p.file||'')+'</code> · '+esc(p.reason||'')+'</li>').join('')+'</ul><p class="help">请检查程序 data/ 中列出的源文件。补回源文件不会自动恢复已删除的作品。</p></div>':'')+'<a href="/docs/guide/FILE_LIBRARY.html" target="_blank" rel="noopener">文件复制、分享、备份与密钥教程 ↗</a></section>';
}
/* 已保存密钥按用途称呼：llm = AI 写故事的文本模型，xml = 把故事整理成分镜结构的解析服务，critic = 视觉审校。 */
const SAVED_KEY_SCOPES={llm:'文本模型',xml:'结构化解析服务',critic:'视觉审校'};
function savedKeysSettings(){
  return '<section class="settings-section"><h2>已保存密钥</h2><p>密码框留空会保留已绑定密钥；修改地址时需要明确重新填写或忘记原密钥。</p><div class="row wrap">'+Object.entries(SAVED_KEY_SCOPES).map(([scope,label])=>btn('忘记'+label+'密钥','trash','native-forget','data-scope="'+scope+'"','small')).join('')+'</div></section>';
}
function installNativeLibraryPanel(){
  installContextualSharing();installRecycleBin();
  v3Actions['native-forget']=async({scope})=>{if(!Object.hasOwn(SAVED_KEY_SCOPES,scope))throw Error('未知的密钥类型。');if(!await confirmAction('忘记已保存的'+SAVED_KEY_SCOPES[scope]+'密钥？','清除此连接的密钥绑定。','忘记密钥'))return;if(!await ComfyComic.sync.save())throw Error('请先保存当前编辑。');await request('/api/library/forget-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope})});await connectPythonBackend()};
}

function nativeAckSettings(studio,payload,documents){
  const submitted=nativeSplitDTO(payload).settings;
  for(const[name,doc]of Object.entries(documents)){
    if(name!=='workspace'){
      studio.settings[name]=nativePatch(studio.settings[name],nativeReconcile(studio.settings[name],submitted[name],doc));
      payload[name+'Config']=clone(doc);continue;
    }
    const before=submitted.workspace,oldMeta=before.ui?.comfyStudio||{},meta=doc.ui?.comfyStudio||{};
    for(const key of ['workspaceId','activeProjectId','customColumns','installedPackages','drafts'])if(Object.hasOwn(meta,key))studio[key]=nativeReconcile(studio[key],oldMeta[key],meta[key]);
    for(const[key,value]of Object.entries(meta.settings||{}))studio.settings[key]=nativePatch(studio.settings[key],nativeReconcile(studio.settings[key],oldMeta.settings?.[key],value));
    for(const[key,value]of Object.entries(meta.creation||{}))studio.creation[key]=nativeReconcile(studio.creation[key],oldMeta.creation?.[key],value);
    const groups=payload.uiConfig.comfyStudio,plans=groups.creation.plans,presets=groups.creation.variableSets;
    payload.uiConfig=clone(doc.ui||{});payload.uiConfig.comfyStudio??={};const next=payload.uiConfig.comfyStudio;
    next.projects=groups.projects;next.exportTemplates=groups.exportTemplates;next.creation={...(next.creation||{}),plans,variableSets:presets};
    payload.batchMatrix={...doc.matrix,rows:payload.batchMatrix.rows};payload.chatConfig={...doc.chats,sessions:payload.chatConfig.sessions};payload.batchRunState={...doc.queue,queue:payload.batchRunState.queue};Object.assign(payload,doc.globals||{});
  }
}

function nativePatch(target,value){
  if(Array.isArray(target)&&Array.isArray(value)){
    const old=[...target],byId=new Map(old.filter(x=>x&&typeof x==='object'&&x.id).map(x=>[x.id,x]));
    const next=value.map((v,i)=>nativePatch(v?.id?byId.get(v.id):old[i],v));target.splice(0,target.length,...next);return target;
  }
  if(target&&value&&typeof target==='object'&&typeof value==='object'&&!Array.isArray(target)&&!Array.isArray(value)){
    for(const k of Object.keys(target))if(!Object.hasOwn(value,k))delete target[k];for(const[k,v]of Object.entries(value))target[k]=nativePatch(target[k],v);return target;
  }
  return value;
}

/* 回收站（UX A8）。后端删除任何独立文件时都先移进 data/.trash/<id>/（附 receipt.json），
   这里列出、原样恢复、永久删除，并按保留天数自动清理。撤销（D5）也走这里：undoDeletion。 */
const RECYCLE_KIND_LABELS={albums:'画册',storyboards:'分镜',characters:'预设',scenes:'预设',collections:'画册集',layouts:'画册版式',workflows:'工作流',plans:'创作计划',rows:'角色记录',conversations:'助手对话',tasks:'生成任务',unknown:'无法识别'};
const RECYCLE_KIND_ORDER=['albums','storyboards','characters','scenes','collections','workflows','layouts','plans','unknown'];
const RECYCLE_RETENTION=[[0,'不自动清理'],[7,'7 天'],[30,'30 天'],[90,'90 天']];
const RECYCLE_CONFLICTS={path:'原位置已有同名文件',id:'已存在同一 ID 的内容（可能已经恢复过）',missing:'回收站里的文件已经不在了',invalid:'回收记录已损坏，只能永久删除'};
const recycleUI={data:null,loading:false,error:'',busy:'',autoCleaned:false};
function recycleRetention(){const d=state.settings.recycle?.retentionDays;return RECYCLE_RETENTION.some(([n])=>n===d)?d:30}
function recycleAvailable(){return !!ComfyComic.sync?.runtime.loaded&&/http/.test(location.protocol)}
function recycleBytes(n){n=Number(n)||0;return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB'}
function recycleWhen(ms){const days=Math.floor((Date.now()-ms)/86400000),time=new Date(ms);if(days<1)return localeString('今天 {time}',{time:time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})});return days<2?localeString('昨天'):localeString('{n} 天前',{n:days})}
async function recycleRequest(action,body){
  const r=await request('/api/library/recycle'+(action?'/'+action:''),action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}:{cache:'no-store'},60000);
  return r.json();
}
function recycleRowHTML(item){
  const blocked=item.conflict?RECYCLE_CONFLICTS[item.conflict]||item.conflict:'';
  return `<div class="settings-row recycle-row" data-recycle-id="${esc(item.trashId)}"><div class="grow"><strong data-user-content>${esc(item.title||item.id)}</strong><p>${esc(recycleWhen(item.deletedAt))} · ${esc(recycleBytes(item.bytes))}${item.original?` · <code>${esc(item.original)}</code>`:''}</p>${blocked?`<p class="help danger">${esc(localeString(blocked))}</p>`:''}</div>${btn('恢复','refresh','recycle-restore',`data-id="${esc(item.trashId)}" ${blocked||recycleUI.busy?'disabled':''} ${blocked?`title="${esc(localeString(blocked))}"`:''}`,'small')}${btn('永久删除','trash','recycle-purge',`data-id="${esc(item.trashId)}" data-title="${esc(item.title||item.id)}" ${recycleUI.busy?'disabled':''}`,'small ghost danger')}</div>`;
}
function recycleBodyHTML(){
  const days=recycleRetention(),d=recycleUI.data;
  const toolbar=`<div class="row wrap recycle-toolbar"><label class="recycle-retention">${esc(localeString('自动清理'))}<select id="recycle-retention">${RECYCLE_RETENTION.map(([n,label])=>`<option value="${n}" ${n===days?'selected':''}>${esc(localeString(label))}</option>`).join('')}</select></label>${btn('刷新','refresh','recycle-refresh','','small ghost')}${btn('清空回收站','trash','recycle-empty',recycleUI.busy||!d||!(d.items.length+d.assets.length+d.files.length+d.hidden.count)?'disabled':'','small ghost danger')}</div>`;
  const intro=`<p>${esc(localeString('删除的画册、分镜、预设、画册集和工作流会先放在这里，可以原样恢复。删除后 10 秒内也可以直接点提示条上的「撤销」。'))}</p>`;
  if(!recycleAvailable())return intro+`<p class="help">${esc(localeString('回收站需要连接本地服务。离线打开的页面没有回收站。'))}</p>`;
  if(recycleUI.error)return intro+toolbar+`<p class="help danger">${esc(recycleUI.error)}</p>`;
  if(!d)return intro+toolbar+`<p class="help">${esc(localeString('正在读取回收站…'))}</p>`;
  const groups=RECYCLE_KIND_ORDER.map(kind=>[kind,d.items.filter(i=>i.kind===kind)]).filter(([,items])=>items.length);
  const merged=[];for(const [kind,items] of groups){const label=RECYCLE_KIND_LABELS[kind],last=merged[merged.length-1];if(last&&last[0]===label)last[1].push(...items);else merged.push([label,items])}
  const list=merged.map(([label,items])=>`<h3 class="recycle-group">${esc(localeString(label))} <span>${items.length}</span></h3>`+items.map(recycleRowHTML).join('')).join('');
  const batches=[...d.assets.map(b=>({id:'assets:'+b.batch,label:localeString('未引用的图片 · {n} 个文件',{n:b.files}),...b})),...d.files.map(b=>({id:'files:'+b.batch,label:localeString('素材索引回收的文件 · {n} 个',{n:b.files}),...b}))];
  const batchHTML=batches.length?`<h3 class="recycle-group">${esc(localeString('素材文件'))} <span>${batches.length}</span></h3>`+batches.map(b=>`<div class="settings-row recycle-row"><div class="grow"><strong>${esc(b.label)}</strong><p>${esc(recycleWhen(b.deletedAt))} · ${esc(recycleBytes(b.bytes))}</p></div>${btn('恢复','refresh','recycle-restore',`data-id="${esc(b.id)}" ${recycleUI.busy?'disabled':''}`,'small')}${btn('永久删除','trash','recycle-purge',`data-id="${esc(b.id)}" data-title="${esc(b.label)}" ${recycleUI.busy?'disabled':''}`,'small ghost danger')}</div>`).join(''):'';
  const hidden=d.hidden.count?`<p class="help">${esc(localeString('另有 {n} 条生成任务、角色记录或助手对话随删除一起进入回收站（{size}），清空或到期时一并删除。',{n:d.hidden.count,size:recycleBytes(d.hidden.bytes)}))}</p>`:'';
  const empty=!list&&!batchHTML?`<div class="eco-empty recycle-empty"><p>${esc(localeString('回收站是空的。'))}</p></div>`:'';
  return intro+toolbar+(recycleUI.busy?`<p class="help" role="status">${esc(localeString(recycleUI.busy))}</p>`:'')+empty+list+batchHTML+hidden;
}
function recycleBinHTML(){
  if(recycleAvailable()&&!recycleUI.data&&!recycleUI.loading&&!recycleUI.error)setTimeout(()=>loadRecycleBin(),0);
  return `<section class="settings-section recycle-bin" id="recycle-bin" aria-live="polite"><h2>${esc(localeString('回收站'))}</h2><div class="recycle-body">${recycleBodyHTML()}</div></section>`;
}
function paintRecycleBin(){const body=document.querySelector('#recycle-bin .recycle-body');if(body)body.innerHTML=recycleBodyHTML()}
async function loadRecycleBin(){
  if(recycleUI.loading)return;recycleUI.loading=true;recycleUI.error='';
  try{recycleUI.data=await recycleRequest()}catch(e){recycleUI.error=localeString('回收站读取失败：')+e.message}
  finally{recycleUI.loading=false;paintRecycleBin()}
}
/* 恢复后重新读取整个工作室（同「扫描并重新读取」），保留当前能保留的选择。 */
async function reloadStudioFromServer(){
  const ns=ComfyComic;state=await ns.sync.read();ensureStudioState();ns.sync.runtime.dirty=false;backendRuntime.dirty=false;rt.saved=true;ui.selected.clear();
  if(!templateBy(ui.templateId))ui.templateId=projectTemplates()[0]?.id;if(!templateBy(ui.storyTemplateId))ui.storyTemplateId=ui.templateId;
  if(!projectPlans().some(p=>p.id===createUI.planId))createUI.planId=projectPlans()[0]?.id||null;
  if(typeof refreshGallery==='function')refreshGallery();render();
}
async function prepareRecycleRestore(){
  if(!recycleAvailable())throw Error(localeString('回收站需要连接本地服务。'));
  if(activeJobs())throw Error(localeString('请等当前的生成、导出或保存结束后再恢复。'));
  flushEditor();await ComfyComic.sync.save();
  const r=ComfyComic.sync.runtime;if(r.dirty&&r.error)throw Error(localeString('还有修改没保存成功，先处理保存问题再恢复：')+r.error);
}
function finishRecycleRestore(keys){
  const moved=adoptRecycledOrphans(state,keys);if(moved.length){save(true);render()}
  return moved.length?localeString('原来的画册集已不在，{n} 项已放进当前画册集。',{n:moved.length}):'';
}
/* 撤销一次删除：先把删除提交到磁盘，再按回执把文件原样移回；从未保存过的项目用内存副本放回。 */
async function undoDeletion(removed){
  if(!recycleAvailable()){const n=restoreLocalCopies(state,removed);ensureStudioState();save(true);render();return n?localeString('已撤销删除。'):localeString('没有可恢复的内容。')}
  await prepareRecycleRestore();
  const missing=[],failed=[];let restored=0;
  for(const r of removed){try{await recycleRequest('restore',{kind:r.kind,id:r.id});restored++}catch(e){if(/HTTP 404/.test(e.message))missing.push(r);else failed.push((r.title||r.id)+'：'+e.message.replace(/^HTTP \d+: /,''))}}
  await reloadStudioFromServer();
  if(missing.length&&restoreLocalCopies(state,missing)){ensureStudioState();save(true);render()}
  const note=finishRecycleRestore(removed.map(r=>r.kind+':'+r.id));recycleUI.data=null;paintRecycleBin();
  if(failed.length)throw Error(localeString('{ok} 项已恢复，{n} 项没有恢复：',{ok:restored+missing.length,n:failed.length})+failed.join('；'));
  return [localeString('已撤销删除。'),note].filter(Boolean).join(' ');
}
async function recycleAutoClean(){
  if(recycleUI.autoCleaned||!recycleAvailable())return;recycleUI.autoCleaned=true;
  const days=recycleRetention();if(!days)return;
  try{const result=await recycleRequest('auto-clean',{retentionDays:days});if(result.purged?.length){recycleUI.data=null;log(localeString('回收站自动清理：永久删除 {n} 项超过 {days} 天的内容。',{n:result.purged.length,days}))}}catch(e){log('回收站自动清理失败：'+e.message,'error')}
}
function installRecycleBin(){
  v3Actions['recycle-refresh']=()=>{recycleUI.data=null;recycleUI.error='';return loadRecycleBin()};
  v3Actions['recycle-restore']=async({id})=>{
    recycleUI.busy='正在恢复…';paintRecycleBin();
    try{
      await prepareRecycleRestore();
      const result=await recycleRequest('restore',{trashId:id}),item=result.restored;
      if(item?.kind){await reloadStudioFromServer();const note=finishRecycleRestore([item.kind+':'+item.id]);toast([localeString('已恢复「{title}」。',{title:item.title||item.id}),note].filter(Boolean).join(' '))}
      else toast(result.skipped?.length?localeString('已恢复 {ok} 个文件；{n} 个原位置已有文件，保留在回收站。',{ok:result.restored.length,n:result.skipped.length}):localeString('素材文件已恢复。'));
    }finally{recycleUI.busy='';recycleUI.data=null;await loadRecycleBin()}
  };
  v3Actions['recycle-purge']=async({id,title})=>{
    if(!await confirmAction(localeString('永久删除「{title}」？',{title}),localeString('文件会从磁盘上删除，之后无法再恢复。'),localeString('永久删除')))return;
    recycleUI.busy='正在删除…';paintRecycleBin();
    try{await recycleRequest('purge',{trashId:id,trusted:true});toast(localeString('已永久删除。'))}finally{recycleUI.busy='';recycleUI.data=null;await loadRecycleBin()}
  };
  v3Actions['recycle-empty']=async()=>{
    const d=recycleUI.data,count=d?d.items.length+d.assets.length+d.files.length+d.hidden.count:0;
    if(!await confirmAction(localeString('清空回收站？'),localeString('{n} 项会从磁盘上永久删除，之后无法再恢复。',{n:count}),localeString('清空回收站')))return;
    recycleUI.busy='正在清空…';paintRecycleBin();
    try{const result=await recycleRequest('empty',{trusted:true});toast(localeString('已清空回收站，释放 {size}。',{size:recycleBytes(result.bytes)}))}finally{recycleUI.busy='';recycleUI.data=null;await loadRecycleBin()}
  };
  document.addEventListener('change',async event=>{
    const select=event.target.closest?.('#recycle-retention');if(!select)return;
    const days=Number(select.value),d=recycleUI.data,cutoff=Date.now()-days*86400000;
    const affected=days&&d?[...d.items,...d.assets,...d.files].filter(i=>i.deletedAt<cutoff).length:0;
    if(affected&&!await confirmAction(localeString('改为保留 {days} 天？',{days}),localeString('回收站里 {n} 项已超过 {days} 天，会立即永久删除。',{n:affected,days}),localeString('确认修改'))){select.value=String(recycleRetention());return}
    state.settings.recycle={...(state.settings.recycle||{}),retentionDays:days};save();
    if(affected){try{await recycleRequest('auto-clean',{retentionDays:days})}catch(e){toast(e.message,'error')}recycleUI.data=null;await loadRecycleBin()}
    else paintRecycleBin();
    toast(days?localeString('回收站会自动清理超过 {days} 天的内容。',{days}):localeString('回收站不会自动清理。'));
  });
  setTimeout(()=>recycleAutoClean(),30000);
}
