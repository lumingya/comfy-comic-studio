/* Mio development module: sync. */
'use strict';

function openDB(){return new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(Error('IndexedDB unavailable'));const q=indexedDB.open('comfycomic-studio',1);q.onupgradeneeded=()=>q.result.createObjectStore('snapshots');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}


function dbRead(key){return new Promise((resolve,reject)=>{const q=rt.db.transaction('snapshots').objectStore('snapshots').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}


function dbWrite(s,allow=false){return new Promise((resolve,reject)=>{const tx=rt.db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');let protectionError;const q=store.get('current');q.onsuccess=()=>{if(q.result&&!allow&&assetCount(s)<assetCount(q.result)*.6){protectionError=Error('防冲刷保护：持久化资产多于当前客户端，拒绝覆盖。');tx.abort();return}if(q.result)store.put(q.result,'previous');store.put(s,'current')};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(protectionError||tx.error)})}


async function loadState(){let candidates=[];try{const s=JSON.parse(localStorage.getItem('cc-project'));if(s){validateState(s);candidates.push(s)}}catch(e){}try{rt.db=await openDB();const s=await dbRead('current');if(s){validateState(s);candidates.push(s)}}catch(e){}if(candidates.length)state=candidates.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];state.customColumns??=[];state.installedPackages??=[];state.settings.xml??={separate:false,baseUrl:'https://api.openai.com/v1',key:'',model:'gpt-4o'};state.settings.comfy.presets??=[];state.queue.forEach(q=>{if(q.status==='running'||q.status==='paused')q.status='pending'});state.books.forEach(b=>b.inProgress=false);rt.lastCount=assetCount(state);rt.booting=false;ui.templateId=projectTemplates()[0]?.id;ui.storyTemplateId=ui.templateId;ui.storyRowId=projectRows()[0]?.id;render();save()}

function save(allow=false){if(rt.booting)return;saveAllow=saveAllow||allow;rt.saved=false;rt.saving=true;clearTimeout(saveTimer);renderStatus();saveTimer=setTimeout(()=>{const allowed=saveAllow;saveAllow=false;saveTail=saveTail.catch(()=>{}).then(()=>persist(allowed))},250)}


async function persist(allow){try{validateState(state);const n=assetCount(state);if(!allow&&rt.lastCount>10&&n<rt.lastCount*.6)throw Error('防冲刷保护：工程资产异常减少，已阻止覆盖。请导出当前工程检查。');state.updatedAt=Date.now();const snapshot=clone(state);let ok=false;if(rt.db){try{await dbWrite(snapshot,allow);ok=true}catch(e){if(e?.message?.includes('防冲刷'))throw e}}try{const previous=JSON.parse(localStorage.getItem('cc-project')||'null');if(previous&&!allow&&n<assetCount(previous)*.6)throw Error('防冲刷保护：本地缓存包含更多资产。');localStorage.setItem('cc-project',JSON.stringify(snapshot));ok=true}catch(e){if(e?.message?.includes('防冲刷'))throw e}if(!ok)throw Error('浏览器存储不可用或空间不足，请立即导出工程。');rt.lastCount=n;rt.saved=true;rt.saving=false;renderStatus()}catch(e){rt.saved=false;rt.saving=false;renderStatus();toast(e.message,'error')}}


async function restoreObject(data){if(rt.running||rt.llmBusy||rt.chatBusy)throw Error('请先停止正在执行的渲染、剧本或助手任务。');validateState(data);if(!await confirmAction('恢复并覆盖当前工程？',`将载入 ${data.projects.length} 个企划、${data.books.length} 本画册、${data.templates.length} 个模板。建议先导出当前备份。`,'恢复工程'))return;state=clone(data);state.customColumns??=[];state.installedPackages??=[];state.settings.comfy.presets??=[];state.settings.xml??={separate:false,baseUrl:'https://api.openai.com/v1',key:'',model:'gpt-4o'};state.queue.forEach(q=>{if(['running','paused'].includes(q.status))q.status='pending'});state.books.forEach(b=>b.inProgress=false);ui.workspace=0;ui.selected.clear();ui.templateId=projectTemplates()[0]?.id;ui.storyTemplateId=ui.templateId;ui.storyRowId=projectRows()[0]?.id;resetWS();save(true);closeModal();if($('#reader').open)closeReader();render();toast('工程已恢复，待执行任务已安全暂停。')}


async function syncRemote(direction){flushEditor();const url=state.settings.syncUrl.trim();if(!/^https?:\/\//.test(url))throw Error('请先配置可信的 HTTP(S) JSON 存储端点。');if(direction==='push'){let remote;try{remote=await(await request(url)).json();validateState(remote)}catch(e){if(!e.message.includes('404'))throw e}if(remote&&assetCount(state)<assetCount(remote)*.6)throw Error('防冲刷保护：本地数据明显少于远端，已拒绝覆盖。');if(!await confirmAction('推送工程到自有远端？','画册与角色数据将离开浏览器。API 密钥不会包含在同步包中。','安全推送'))return;await request(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(backupObject(false))});rt.syncStatus='已安全推送 · '+new Date().toLocaleTimeString()}else{const data=await(await request(url)).json();validateState(data);if(assetCount(data)<assetCount(state)*.6)throw Error('防冲刷保护：远端资产异常偏少，拒绝覆盖本地。');await restoreObject(data);rt.syncStatus='已拉取并恢复远端工程'}if($('#sync-status'))$('#sync-status').textContent=rt.syncStatus;toast(rt.syncStatus)}


function diskSupported(){return typeof window.showDirectoryPicker==='function'&&window.isSecureContext}


async function readDiskFile(root,path){return(await fileAt(root,path)).getFile()}


async function readDiskText(root,path,limit=25000000){const file=await readDiskFile(root,path);if(file.size>limit)throw Error('工程配置文件过大：'+path);return file.text()}


async function writeDiskFile(root,path,data){const h=await fileAt(root,path,true),stream=await h.createWritable();try{await stream.write(data);await stream.close()}catch(e){try{await stream.abort()}catch(x){}throw e}}


async function maybeDiskText(root,path){try{return await readDiskText(root,path)}catch(e){if(e.name==='NotFoundError')return null;throw e}}


async function contentDigest(blob){const bytes=new Uint8Array(await blob.arrayBuffer());if(globalThis.crypto?.subtle){const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].slice(0,12).map(n=>n.toString(16).padStart(2,'0')).join('')}let a=2166136261,b=5381;for(const n of bytes){a=Math.imul(a^n,16777619);b=Math.imul(b,33)^n}return(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0')+'_'+bytes.length}


async function openDirectoryLinks(){
  if(disk.linkDB)return disk.linkDB;
  disk.linkDB=await new Promise((resolve,reject)=>{const req=indexedDB.open('comfycomic-directory-links',1);req.onupgradeneeded=()=>req.result.createObjectStore('links');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return disk.linkDB;
}


async function rememberDirectory(handle){try{const db=await openDirectoryLinks();await new Promise((resolve,reject)=>{const tx=db.transaction('links','readwrite');tx.objectStore('links').put(handle,'root');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});disk.remembered=handle}catch(e){log('浏览器不能记住目录授权；下次请重新选择同一文件夹。','warn')}}


async function recalledDirectory(){try{const db=await openDirectoryLinks();return await new Promise((resolve,reject)=>{const req=db.transaction('links').objectStore('links').get('root');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}catch(e){return null}}


async function findLegacyProject(){
  const candidates=[];try{const s=JSON.parse(localStorage.getItem('cc-project')||'null');if(s){validateState(s);candidates.push(s)}}catch(e){}
  try{rt.db=await openDB();const s=await dbRead('current');if(s){validateState(s);candidates.push(s)}}catch(e){}
  return candidates.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0]||null;
}


async function diskImage(source,fallback=''){
  const key=source+'|'+(fallback?'fallback':'');if(disk.resolved.has(key))return disk.resolved.get(key);
  let blob,note='';try{if(source.startsWith('data:'))blob=await(await fetch(source)).blob();else blob=await(await request(source,{},5000)).blob();if(!blob.type.startsWith('image/'))throw Error('资源不是图片。')}
  catch(e){throw Error('无法保存原始图片：'+e.message+'。不会使用示例图代替。')}
  const value={blob,digest:await contentDigest(blob),extension:imageExtension(blob.type),note};disk.resolved.set(key,value);return value;
}


async function buildDiskPackage(source,progress=()=>{},options={}){
  const snapshot=clone(source);ensureStudioState(snapshot);ensureWorkspaceIdentity(snapshot);
  for(const group of ['books','rows','templates'])for(const entity of snapshot[group]){entity.projectId ||= snapshot.activeProjectId;if(!snapshot.projects.some(p=>p.id===entity.projectId))throw Error('资产「'+(entity.title||entity.character||entity.id)+'」的企划不存在，未保存。')}
  validateState(snapshot);
  const files=new Map(),paths=clone(options.paths||disk.paths),directories=new Set(['企划','导出模板','引擎','对话记录','工作室']);for(const key of ['projects','books','rows','templates','exports','chats'])paths[key]||={};
  const emit=(path,data,type='application/json')=>{checkedPath(path);files.set(path,data instanceof Blob?data:new Blob([data],{type}));return path};
  const record=async(base,name,value,type='application/json')=>{const text=typeof value==='string'?value:JSON.stringify(value,null,2),blob=new Blob([text],{type}),hash=await contentDigest(blob),dot=name.lastIndexOf('.'),stem=dot>=0?name.slice(0,dot):name,ext=dot>=0?name.slice(dot):'',path=(base?base+'/':'')+'.history/'+stem+'_'+hash+ext;emit(path,blob);emit((base?base+'/':'')+name,blob);return path};
  const entityBase=(group,entity,parent,label)=>{const old=paths[group][entity.id];if(old){checkedPath(old);return old}const path=parent+'/'+safeFolderName(label,entity.id);paths[group][entity.id]=path;return path};
  const asset=async(base,label,src,fallback='')=>{if(!src)return {path:'',note:''};const img=await diskImage(src,fallback),path=base+'/'+safeFolderName(label)+'_'+img.digest+'.'+img.extension;emit(path,img.blob);return {path,note:img.note}};
  const externalize=async(value,base)=>{if(value?.kind==='image'&&typeof value.url==='string'&&value.url.startsWith('/images/')){const stored=await asset(base,'result',value.url);return{...value,url:{__cc_asset:stored.path}}}if(isImageVariable(value)&&value.src){const stored=await asset(base,'variable',value.src);return{...value,src:{__cc_asset:stored.path}}}if(typeof value==='string'&&value.startsWith('data:image/')){const stored=await asset(base,'asset',value);return {__cc_asset:stored.path}}if(Array.isArray(value)){const out=[];for(const item of value)out.push(await externalize(item,base));return out}if(value&&typeof value==='object'){const out={};for(const[k,v]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))continue;out[k]=await externalize(v,base)}return out}return value};
  const manifest={kind:DISK_KIND,formatVersion:1,appVersion:STUDIO_VERSION,workspaceId:snapshot.workspaceId,revision:uid('commit'),savedAt:Date.now(),assetCount:assetCount(snapshot),core:{schemaVersion:snapshot.schemaVersion,appVersion:STUDIO_VERSION,workspaceId:snapshot.workspaceId,updatedAt:Date.now(),activeProjectId:snapshot.activeProjectId,activeChatId:snapshot.activeChatId,customColumns:snapshot.customColumns,installedPackages:snapshot.installedPackages,creation:snapshot.creation},projects:[],exportTemplates:[],chats:[],pathMap:paths};
  const settings=clone(snapshot.settings);if(!settings.disk.includeKeys){settings.llm.key='';if(settings.xml)settings.xml.key='';if(settings.critic)settings.critic.key=''}if(settings.github){delete settings.github.token;delete settings.github.key}
  const activeWorkflow=await record('引擎','workflow.json',settings.comfy.workflow);settings.comfy.workflow={__cc_json:activeWorkflow};
  const workflowPresets=[];for(const preset of snapshot.settings.comfy.presets||[]){const base='引擎/预设/'+safeFolderName(preset.title,preset.id||hash(preset.title).toString(16)),path=await record(base,'workflow.json',preset);workflowPresets.push({__cc_json:path})}settings.comfy.presets=workflowPresets;
  manifest.settingsFile=await record('工作室','settings.json',await externalize(settings,'工作室/附件'));
  manifest.queueFile=await record('工作室','queue.json',await externalize(snapshot.queue,'工作室/图片变量'));
  manifest.core.creation=await externalize(snapshot.creation,'工作室/图片变量');
  manifest.draftsFile=await record('工作室','drafts.json',await externalize(snapshot.drafts||{},'工作室/草稿附件'));
  let completed=0;const total=snapshot.books.reduce((n,b)=>n+b.steps.filter(s=>s.image).length,0);
  for(const p of snapshot.projects){
    const base=entityBase('projects',p,'企划',p.title),projectRecord={...p,books:[],templates:[],rows:[]};for(const child of ['画册','分镜模板','角色'])directories.add(base+'/'+child);
    for(const b of snapshot.books.filter(b=>b.projectId===p.id)){
      const bookBase=entityBase('books',b,base+'/画册',b.title),book=clone(b);for(const child of ['图片','参考图','导出'])directories.add(bookBase+'/'+child);
      for(const step of book.steps){if(!step.image)continue;progress('保存 '+b.title+' · '+(step.stepIndex+1)+' / '+b.totalSteps,completed,total);const stored=await asset(bookBase+'/图片',pad(step.stepIndex+1)+'_'+step.name,step.image,step.offlineImage);step.image=stored.path.slice(bookBase.length+1);if(stored.note){step.diskImageNote=stored.note;step.referenceUrl=b.steps.find(x=>x.stepIndex===step.stepIndex)?.image}if(step.offlineImage){const preview=await asset(bookBase+'/参考图',pad(step.stepIndex+1),step.offlineImage);step.offlineImage=preview.path.slice(bookBase.length+1)}completed++}
      book.inProgress=false;const path=await record(bookBase,'book.json',await externalize(book,bookBase+'/参考图'));projectRecord.books.push({id:b.id,title:b.title,base:bookBase,file:path});
      emit(bookBase+'/阅读说明.txt','图片/ 保存按分镜编号命名的原始图片。book.json 可查看标题、台词、提示词和相对图片路径。\n导出的 HTML 画册保存在 导出/ 下。\n.history/ 保存版本记录，请勿删除仍被工作室索引引用的文件。\n','text/plain');
    }
    for(const t of snapshot.templates.filter(t=>t.projectId===p.id)){const templateBase=entityBase('templates',t,base+'/分镜模板',t.title),path=await record(templateBase,'template.json',t);projectRecord.templates.push({id:t.id,title:t.title,base:templateBase,file:path})}
    for(const row of snapshot.rows.filter(r=>r.projectId===p.id)){
      const rowBase=entityBase('rows',row,base+'/角色',row.character),copy=await externalize(row,rowBase+'/参考立绘');
      for(const[templateId,versions]of Object.entries(row.storyVersions))for(const v of versions)await record(rowBase+'/剧情/'+safeFolderName(templateId),safeFolderName(v.title,v.id)+'.json',v);
      const path=await record(rowBase,'character.json',copy);projectRecord.rows.push({id:row.id,character:row.character,base:rowBase,file:path});
    }
    const file=await record(base,'project.json',projectRecord);manifest.projects.push({id:p.id,title:p.title,base,file});
  }
  if(manifest.projects.reduce((n,p)=>n+snapshot.books.filter(b=>b.projectId===p.id).length,0)!==snapshot.books.length)throw Error('有画册缺少有效企划归属，未提交磁盘工程。');
  for(const t of snapshot.exportTemplates){const base=entityBase('exports',t,'导出模板',t.title),copy=clone(t);copy.htmlFile=await record(base,'layout.html',copy.html,'text/html');delete copy.html;const file=await record(base,'template.json',copy);manifest.exportTemplates.push({id:t.id,title:t.title,base,file})}
  for(const chat of snapshot.chats){const base=entityBase('chats',chat,'对话记录',chat.title||'对话'),data=await externalize(chat,base+'/附件'),file=await record(base,'session.json',data);manifest.chats.push({id:chat.id,base,file})}
  emit('工作室使用说明.txt','Mio '+STUDIO_VERSION+'\n\nworkspace.json 是工作室入口，请保留目录结构。\n企划/<企划名称>/画册/<画册名称>/图片/ 保存独立的原图文件。\n分镜模板、角色、剧情版本按企划存放；导出模板和引擎工作流独立存放。\n\n应用先写入不可变版本文件，再最后提交 workspace.json。每个目录中的同名 JSON/HTML 是方便浏览的当前副本；索引引用 .history/ 中的完整版本。\n修改目录内的模板可通过应用的导入功能重新载入。请勿手动修改索引或删除 .history/。\n删除作品仅移除当前工程索引，旧原图和版本文件不会被自动销毁。\nAPI 密钥默认不写入目录；可以在设置中明确开启。\n\n浏览器数据库仅记住目录授权，作品内容不作为浏览器缓存保存。\n','text/plain');
  emit('workspace.json',JSON.stringify(manifest,null,2));return {files,manifest,paths,directories:[...directories]};
}


async function loadDiskManifest(readFile,rootText){
  const manifest=JSON.parse(rootText);if(manifest.kind!==DISK_KIND||manifest.formatVersion!==1||!Array.isArray(manifest.projects)||!manifest.projects.length||!manifest.core||typeof manifest.revision!=='string')throw Error('这不是有效的 ComfyComic 目录工程。');
  if(manifest.projects.length>300||(manifest.exportTemplates?.length||0)>100||(manifest.chats?.length||0)>1000)throw Error('工作室索引数量超过安全限制。');
  const readJSON=async path=>{checkedPath(path);const f=await readFile(path);if(f.size>30000000)throw Error('JSON 文件超过 30 MB：'+path);return JSON.parse(await f.text())};
  const readImage=async path=>{checkedPath(path);const f=await readFile(path);if(f.size>60000000)throw Error('单张图片超过 60 MB：'+path);return blobData(f.type?f:new Blob([f],{type:path.endsWith('.svg')?'image/svg+xml':path.endsWith('.jpg')?'image/jpeg':'image/png'}))};
  const hydrate=async(value,depth=0)=>{if(depth>40)throw Error('工程引用嵌套过深。');if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.__cc_asset==='string')return readImage(value.__cc_asset);if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.__cc_json==='string')return hydrate(await readJSON(value.__cc_json),depth+1);if(Array.isArray(value)){const list=[];for(const item of value)list.push(await hydrate(item,depth+1));return list}if(value&&typeof value==='object'){const out={};for(const[k,v]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))throw Error('拒绝危险工程字段。');out[k]=await hydrate(v,depth+1)}return out}return value};
  const restored={...manifest.core,projects:[],books:[],templates:[],rows:[],exportTemplates:[],chats:[],settings:await hydrate(await readJSON(manifest.settingsFile)),queue:await hydrate(await readJSON(manifest.queueFile)),drafts:manifest.draftsFile?await hydrate(await readJSON(manifest.draftsFile)):{}};
  restored.creation=await hydrate(manifest.core.creation);
  for(const ref of manifest.projects){
    const project=await readJSON(ref.file),{books=[],templates=[],rows=[],...meta}=project;restored.projects.push(meta);
    for(const refBook of books){const b=await hydrate(await readJSON(refBook.file));for(const step of b.steps){if(step.image&&!/^(data:|https?:)/.test(step.image))step.image=await readImage(refBook.base+'/'+step.image);if(step.offlineImage&&!/^(data:|https?:)/.test(step.offlineImage))step.offlineImage=await readImage(refBook.base+'/'+step.offlineImage);if(step.image)step.image=await persistRasterAsset(step.image,b.id);if(step.offlineImage)step.offlineImage=await persistRasterAsset(step.offlineImage,b.id)}b.inProgress=false;restored.books.push(b)}
    for(const refTemplate of templates)restored.templates.push(await readJSON(refTemplate.file));
    for(const refRow of rows)restored.rows.push(await hydrate(await readJSON(refRow.file)));
  }
  for(const ref of manifest.exportTemplates||[]){const t=await readJSON(ref.file);const file=await readFile(t.htmlFile);if(file.size>2000000)throw Error('HTML 模板文件过大。');t.html=await file.text();delete t.htmlFile;restored.exportTemplates.push(t)}
  for(const ref of manifest.chats||[])restored.chats.push(await hydrate(await readJSON(ref.file)));
  restored.queue.forEach(q=>{if(['running','paused'].includes(q.status))q.status='pending'});
  for(const q of restored.queue)if(q.serverId){q.previousServerId=q.serverId;delete q.serverId;if(['pending','running','paused'].includes(q.status)){q.status='failed';q.serverState='unknown';q.error='便携恢复：原服务端任务结果需核对，不自动重新提交。'}}
  await persistImportedImageVariables(restored);ensureStudioState(restored);ensureWorkspaceIdentity(restored);validateState(restored);return {state:restored,manifest};
}


async function readFolderWorkspace(root){
  const text=await maybeDiskText(root,'workspace.json');if(text===null){const previous=await maybeDiskText(root,'workspace.previous.json');if(!previous)return null;return {...await loadDiskManifest(path=>readDiskFile(root,path),previous),text:previous,recovered:true,error:'workspace.json 缺失，已读取上一次完整索引。'}}
  try{return {...await loadDiskManifest(path=>readDiskFile(root,path),text),text,recovered:false}}
  catch(e){const previous=await maybeDiskText(root,'workspace.previous.json');if(!previous)throw e;try{return {...await loadDiskManifest(path=>readDiskFile(root,path),previous),text:previous,recovered:true,error:e.message}}catch(x){throw Error('当前和上一次工作室索引均无法完整读取：'+e.message)}}
}


function installLoadedWorkspace(loaded){
  state=loaded.state;ensureStudioState();ensureWorkspaceIdentity();upgradeExportDesigns(state);
  disk.paths=clone(loaded.manifest.pathMap||{projects:{},books:{},rows:{},templates:{},exports:{},chats:{}});disk.workspaceId=loaded.manifest.workspaceId;disk.rootRevision=loaded.manifest.revision;disk.lastManifestText=loaded.text;disk.lastSavedAt=loaded.manifest.savedAt;disk.written.clear();disk.resolved.clear();disk.revision=0;disk.savedRevision=0;rt.lastCount=assetCount(state);rt.saved=true;rt.saving=false;
  ui.selected.clear();ui.workspace=0;ui.templateId=projectTemplates()[0]?.id;ui.storyTemplateId=ui.templateId;ui.storyRowId=projectRows()[0]?.id;ui.frameIndex=0;studioUI.exportDraft=null;studioUI.assistantUndo=null;studioUI.assistantTargetId=null;studioUI.assistantDraft='';
  if($('#reader').open)closeReader();$('#assistant').hidden=true;rememberProfile();
}


async function commitDiskWorkspace(allow=false){
  if(!disk.root||disk.connecting||disk.phase==='recovery')return false;
  const root=disk.root,revision=disk.revision;
  const commit=async()=>{
    if(await root.queryPermission({mode:'readwrite'})!=='granted'){disk.phase='permission';throw Error('目录写入权限已失效。请点击“重新授权”，当前修改仍在内存中。')}
    validateState(state);
    const existing=await maybeDiskText(root,'workspace.json');
    if(disk.lastManifestText!==null&&existing!==disk.lastManifestText)throw Error('磁盘索引已被其他窗口或程序修改。自动保存已暂停，请重新读取磁盘或另存目录包。');
    if(disk.lastManifestText===null&&existing!==null)throw Error('目标目录已经有工作室索引，拒绝覆盖未打开的工程。');
    if(!allow&&existing){const stored=JSON.parse(existing);if(stored.assetCount>10&&assetCount(state)<stored.assetCount*.6)throw Error('防冲刷保护：当前资产明显少于磁盘记录，已停止覆盖。')}
    const snapshot=clone(state);snapshot.updatedAt=Date.now();
    const pack=await buildDiskPackage(snapshot,(message)=>{disk.progress=message;renderStatus()});
    for(const path of pack.directories)await dirAt(root,path,true);
    let count=0;for(const[path,data]of pack.files){if(path==='workspace.json')continue;if(disk.root!==root)throw Error('保存目录在写入期间改变，未提交索引。');const stamp=await contentDigest(data),cached=disk.written.get(path);let ready=false;if(cached?.stamp===stamp){try{const file=await readDiskFile(root,path);ready=file.size===cached.size&&file.lastModified===cached.modified}catch(e){if(e.name!=='NotFoundError')throw e}}if(!ready){await writeDiskFile(root,path,data);const file=await readDiskFile(root,path);disk.written.set(path,{stamp,size:file.size,modified:file.lastModified})}count++;if(count%10===0){disk.progress='写入文件 '+count+' / '+(pack.files.size-1);renderStatus()}}
    if(existing){await writeDiskFile(root,'workspace.previous.json',existing);await writeDiskFile(root,'.history/workspace_'+JSON.parse(existing).revision+'.json',existing)}
    const latest=await maybeDiskText(root,'workspace.json');if(latest!==existing)throw Error('写入过程中检测到另一份提交，未替换磁盘索引。');
    const text=JSON.stringify(pack.manifest,null,2);await writeDiskFile(root,'workspace.json',text);
    disk.lastManifestText=text;disk.rootRevision=pack.manifest.revision;disk.paths=pack.paths;disk.lastSavedAt=pack.manifest.savedAt;disk.savedRevision=revision;disk.phase='connected';disk.lastError='';disk.lastErrorShown='';disk.progress='';rt.saved=disk.revision===revision;rt.lastCount=assetCount(snapshot);state.updatedAt=snapshot.updatedAt;
    return true;
  };
  return navigator.locks?.request?navigator.locks.request('comfycomic-write-'+(disk.workspaceId||state.workspaceId),commit):commit();
}


function queueDiskSave(allow=false){
  disk.allowReduction ||= allow;
  disk.tail=disk.tail.catch(()=>{}).then(async()=>{
    if(!disk.root||disk.connecting||disk.phase==='recovery')return false;
    const allowed=disk.allowReduction;disk.allowReduction=false;disk.busy=true;rt.saving=true;renderStatus();
    try{return await commitDiskWorkspace(allowed)}
    catch(e){disk.lastError=e.message;disk.allowReduction ||= allowed;disk.phase=e.name==='NotAllowedError'?'permission':disk.phase==='permission'?'permission':'error';rt.saved=false;log('落盘未完成：'+e.message,'error');if(disk.lastErrorShown!==e.message){toast(e.message,'error');disk.lastErrorShown=e.message}return false}
    finally{disk.busy=false;rt.saving=false;renderStatus();updateDiskSettingsStatus()}
  });return disk.tail;
}


function saveToDirectory(allow=false){
  if(rt.booting)return;disk.revision++;disk.allowReduction ||= allow;rt.saved=false;clearTimeout(disk.timer);
  if(disk.root&&!disk.connecting&&!['permission','recovery','error'].includes(disk.phase)){rt.saving=true;disk.timer=setTimeout(()=>queueDiskSave(),800)}else rt.saving=false;
  renderStatus();
}


async function flushDiskSave(){
  flushEditor();saveStoryInputs();if(!disk.root)throw Error('请先选择工作室目录；当前更改尚未写入磁盘。');clearTimeout(disk.timer);const done=await queueDiskSave();if(done&&disk.revision>disk.savedRevision)return queueDiskSave();return done;
}


function diskStatusText(){
  if(disk.connecting)return '正在打开本地工作室...';
  if(disk.busy)return disk.progress||'正在写入磁盘...';
  if(disk.phase==='recovery')return '已恢复上一完整版本 · 等待确认';
  if(disk.phase==='permission')return '目录需要重新授权 · 更改尚未落盘';
  if(disk.phase==='error')return '保存失败 · 当前更改仍在内存中';
  if(disk.root)return rt.saved?'已写入磁盘 · '+new Date(disk.lastSavedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'有待落盘更改';
  if(disk.remembered)return '目录待重新授权 · 作品尚未落盘';
  return disk.phase==='readonly'?'只读载入 · 新修改尚未落盘':'临时会话 · 作品尚未落盘';
}


async function attachWorkspaceDirectory(handle,auto=false){
  if(disk.connecting)throw Error('正在连接目录，请稍候。');
  if(!auto&&activeJobs())throw Error('请先结束渲染、剧情推演或导出，再切换工作室目录。');
  disk.connecting=true;clearTimeout(disk.timer);renderStatus();
  try{
    await disk.tail.catch(()=>{});
    const loaded=await readFolderWorkspace(handle);
    if(loaded){
      if(!auto&&!await confirmAction('打开「'+(loaded.state.settings.identity?.workspaceName||handle.name)+'」？','将从所选目录恢复 '+loaded.state.projects.length+' 个企划、'+loaded.state.books.length+' 本画册。\n当前临时会话不会与磁盘记录混合；如需保留，请先导出备份。','打开磁盘工程'))return false;
      disk.root=handle;installLoadedWorkspace(loaded);disk.phase=loaded.recovered?'recovery':await handle.queryPermission({mode:'readwrite'})==='granted'?'connected':'permission';disk.lastError=loaded.recovered?'当前索引异常，已载入上次完整提交：'+loaded.error:'';
      if(loaded.recovered)rt.saved=false;
    }else{
      if(auto)return false;
      let hasFiles=false;for await(const entry of handle.values()){hasFiles=true;break}
      if(hasFiles){if(!await confirmAction('在所选目录中创建工作室子文件夹？','该目录已有其他文件，但未发现 ComfyComic 索引。\n将创建新的工作室子目录，不改动已有文件。','创建独立子目录'))return false;handle=await handle.getDirectoryHandle(safeFolderName(workspaceName(),state.workspaceId),{create:true});if(await maybeDiskText(handle,'workspace.json'))throw Error('子目录已存在工作室，请直接选择那个目录重新打开。')}
      disk.root=handle;disk.workspaceId=state.workspaceId;disk.lastManifestText=null;disk.rootRevision=null;disk.paths={projects:{},books:{},rows:{},templates:{},exports:{},chats:{}};disk.written.clear();disk.resolved.clear();disk.phase='connected';disk.lastError='';disk.revision++;rt.saved=false;
    }
    await rememberDirectory(handle);
    disk.connecting=false;
    if(!loaded){const success=await queueDiskSave(true);if(!success)throw Error(disk.lastError||'首次写入未完成，当前数据仍在内存中。')}
    if($('#welcome-dialog').open&&state.settings.identity.workspaceName){state.settings.identity.onboarded=true;rememberProfile();$('#welcome-dialog').close()}
    if($('#modal').open)closeModal();render();
    if(!state.settings.identity.workspaceName)showWorkspaceWelcome();
    if(!auto)toast(loaded?'磁盘工作室已载入，企划和图片已恢复。':'目录已连接，完整工程已分层写入磁盘。');
    return true;
  }finally{disk.connecting=false;renderStatus()}
}


async function chooseWorkspaceDirectory(){
  if(!diskSupported())throw Error('当前环境不支持目录写入。请使用桌面 Chrome / Edge 并直接打开安全页面，或下载 ZIP 目录包。');
  if(disk.connecting||disk.busy||activeJobs())throw Error('请先等待保存或生产任务结束。');
  try{const handle=await window.showDirectoryPicker({id:'comfycomic-workspace',mode:'readwrite',startIn:disk.root||disk.remembered||'documents'});return await attachWorkspaceDirectory(handle)}
  catch(e){if(e.name==='AbortError')return false;if(e.name==='SecurityError')throw Error('浏览器拒绝打开目录选择器。请在独立的安全页面中点击此按钮，并检查权限。');throw e}
}


async function reconnectWorkspaceDirectory(){
  const handle=disk.root||disk.remembered;if(!handle)return chooseWorkspaceDirectory();
  if(activeJobs()||disk.busy)throw Error('请先等待当前任务或写入结束。');
  const permission=await handle.requestPermission({mode:'readwrite'});if(permission!=='granted')throw Error('未取得目录写入权限，当前改动未落盘。');
  if(disk.root&&disk.lastManifestText){disk.phase='connected';disk.lastError='';const result=await flushDiskSave();if(result)toast('目录权限已恢复，修改已写入磁盘。');return result}
  return attachWorkspaceDirectory(handle);
}


async function reloadWorkspaceDirectory(){
  if(!disk.root)throw Error('尚未连接工作室目录。');if(activeJobs()||disk.busy)throw Error('请先停止任务，或等待写入完成。');
  if(!await confirmAction('重新读取磁盘工程？','未落盘的内存改动将被磁盘版本替代。建议先下载 JSON 或目录备份。','读取磁盘'))return;
  clearTimeout(disk.timer);disk.connecting=true;try{await disk.tail;const loaded=await readFolderWorkspace(disk.root);if(!loaded)throw Error('目录中未找到 workspace.json。');installLoadedWorkspace(loaded);disk.phase=loaded.recovered?'recovery':'connected';disk.lastError=loaded.recovered?loaded.error:'';render();toast('已从磁盘重新读取完整工程。')}finally{disk.connecting=false;renderStatus()}
}


async function acceptDiskRecovery(){
  if(disk.phase!=='recovery'||!disk.root)return;
  if(!await confirmAction('将恢复版本作为当前工作室？','会保留损坏的索引副本，再将当前恢复的数据提交为新版本。','确认恢复'))return;
  const original=await maybeDiskText(disk.root,'workspace.json'),restoredText=disk.lastManifestText;if(original)await writeDiskFile(disk.root,'.history/damaged_'+Date.now()+'.json',original);if(!restoredText)throw Error('缺少可恢复索引。');await writeDiskFile(disk.root,'workspace.json',restoredText);disk.lastManifestText=restoredText;disk.phase='connected';disk.revision++;const result=await queueDiskSave(true);if(result){render();toast('恢复版本已完整写入磁盘。')}
}


function crcTable(){const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0}return table}


function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=zipCRC[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0}


async function zipDirectory(files){
  if(files.size>65535)throw Error('目录文件过多，无法导出标准 ZIP。');
  const local=[],central=[];let offset=0;const now=new Date(),time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),date=((Math.max(1980,now.getFullYear())-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
  for(const[path,blob]of files){const name=new TextEncoder().encode(path),bytes=new Uint8Array(await blob.arrayBuffer()),crc=crc32(bytes),size=bytes.length;if(offset+size>500000000)throw Error('目录包超过 500 MB，请改用直接连接本地目录。');const header=new Uint8Array(30+name.length),v=new DataView(header.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(10,time,true);v.setUint16(12,date,true);v.setUint32(14,crc,true);v.setUint32(18,size,true);v.setUint32(22,size,true);v.setUint16(26,name.length,true);header.set(name,30);local.push(header,bytes);
    const cd=new Uint8Array(46+name.length),c=new DataView(cd.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(12,time,true);c.setUint16(14,date,true);c.setUint32(16,crc,true);c.setUint32(20,size,true);c.setUint32(24,size,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);cd.set(name,46);central.push(cd);offset+=header.length+size;
  }
  const size=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.size,true);e.setUint16(10,files.size,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);return new Blob([...local,...central,end],{type:'application/zip'});
}


function importDirectoryReadOnly(){const input=$('#directory-import');input.value='';input.click()}


async function restoreImportedDirectory(files){
  if(activeJobs()||disk.busy)throw Error('请先结束当前任务，再载入目录。');
  const map=new Map();for(const f of files){const relative=f.webkitRelativePath.split('/').slice(1).join('/');if(relative)map.set(relative,f)}
  const rootFile=map.get('workspace.json');if(!rootFile)throw Error('请选择包含 workspace.json 的工作室根目录，而不是它的上层目录。');
  const text=await rootFile.text(),reader=async path=>{checkedPath(path);const file=map.get(path);if(!file)throw Error('目录缺少文件：'+path);return file},loaded=await loadDiskManifest(reader,text);
  if(!await confirmAction('以只读方式载入目录？','可浏览与编辑，但浏览器不能将修改自动写回此目录。之后可选择新的可写目录或重新下载 ZIP。','只读载入'))return;
  clearTimeout(disk.timer);disk.root=null;installLoadedWorkspace({...loaded,text});disk.importedFiles=map;disk.phase='readonly';rt.saved=false;disk.lastError='';if($('#welcome-dialog').open&&state.settings.identity.workspaceName)$('#welcome-dialog').close();if($('#modal').open)closeModal();render();if(!state.settings.identity.workspaceName)showWorkspaceWelcome();toast('目录已载入。当前为只读来源，新修改需要另行保存。');
}


async function loadDiskFirst(){
  disk.legacy=await findLegacyProject();
  const remembered=await recalledDirectory();disk.remembered=remembered;
  if(remembered){try{if(await remembered.queryPermission({mode:'readwrite'})==='granted'){await attachWorkspaceDirectory(remembered,true);disk.restored=!!disk.root}else disk.phase='permission'}catch(e){disk.lastError=e.message;disk.phase='error'}}
  if(!disk.restored&&disk.legacy){state=clone(disk.legacy);ensureStudioState();ensureWorkspaceIdentity();upgradeExportDesigns(state);rt.lastCount=assetCount(state)}
  else{ensureStudioState();ensureWorkspaceIdentity();upgradeExportDesigns(state)}
  state.queue.forEach(q=>{if(['running','paused'].includes(q.status))q.status='pending'});state.books.forEach(b=>b.inProgress=false);
  rt.saved=!!disk.root&&disk.phase==='connected';rt.saving=false;rt.booting=false;ui.templateId=projectTemplates()[0]?.id;ui.storyTemplateId=ui.templateId;ui.storyRowId=projectRows()[0]?.id;render();
  if(!state.settings.identity.onboarded||!state.settings.identity.workspaceName)showWorkspaceWelcome();
  else if(disk.remembered&&!disk.root)toast('请在设置中重新授权「'+disk.remembered.name+'」，作品以磁盘记录为准。');
}


async function diskFormatDiagnostics(){
  if(disk.busy||activeJobs())throw Error('请在生产与写入任务结束后运行自检。');
  modal('目录格式与恢复自检','<div class="notice">使用独立的内存示例生成目录并重新读取，不访问或修改你的实际工作室文件。</div><div id="disk-test-results" style="padding-top:18px"><p class="soft small"><i class="dot live"></i> 正在检查文件层级与引用...</p></div>','这些检查不代表浏览器目录授权或实际硬盘写入已经验证。');
  const tests=[],test=async(name,fn)=>{try{if(await fn()===false)throw Error('断言不成立');tests.push({name,ok:true,message:'通过'})}catch(e){tests.push({name,ok:false,message:e.message})}};
  let pack,restored;const fixture=seedState();fixture.projects=fixture.projects.slice(0,1);fixture.templates=fixture.templates.slice(0,1);fixture.rows=fixture.rows.slice(0,1);fixture.books=fixture.books.slice(0,1);fixture.queue=[];const book=fixture.books[0];book.totalSteps=3;book.generatedSteps=3;book.steps=Array.from({length:3},(_,i)=>({stepIndex:i,name:'格式测试 '+(i+1),prompt:'offline validation frame',caption:'仅用于内存自检。',image:svgArt(0,i)}));fixture.settings.identity={workspaceName:'格式自检工作室',creatorName:'测试',onboarded:true};fixture.settings.disk={includeKeys:false};fixture.settings.llm.key='TEST_SECRET_NOT_FOR_DISK';fixture.exportTemplates=designedTemplates();ensureStudioState(fixture);
  await test('目录名称兼容特殊字符与同名项目',()=>!/[<>:"/\\|?*]/.test(safeFolderName('A/B:画册?'))&&safeFolderName('同名','project_111')!==safeFolderName('同名','project_222'));
  await test('拒绝父目录跳转',()=>{try{checkedPath('企划/../外部文件');return false}catch(e){return true}});
  await test('生成独立的分层目录包',async()=>{pack=await buildDiskPackage(fixture,()=>{},{paths:{projects:{},books:{},rows:{},templates:{},exports:{},chats:{}}});return pack.files.has('workspace.json')&&[...pack.files.keys()].some(p=>p.includes('/画册/')&&p.includes('/图片/'))});
  if(pack){
    await test('入口索引最后加入提交清单',()=>[...pack.files.keys()].at(-1)==='workspace.json');
    await test('book.json 使用相对图片路径而非 Base64',async()=>{const key=[...pack.files.keys()].find(k=>k.endsWith('/book.json')&&!k.includes('/.history/'));const b=JSON.parse(await pack.files.get(key).text());return b.steps.every(s=>s.image.startsWith('图片/')&&!s.image.startsWith('data:'))});
    await test('原始图片作为独立文件写入目录包',()=>[...pack.files.entries()].some(([p,b])=>p.includes('/图片/')&&b.type==='image/svg+xml'));
    await test('HTML 模板具有源码和配置两份文件',()=>[...pack.files.keys()].some(p=>p.startsWith('导出模板/')&&p.endsWith('/layout.html'))&&[...pack.files.keys()].some(p=>p.startsWith('导出模板/')&&p.endsWith('/template.json')));
    await test('默认不把 API 密钥写入磁盘',async()=>{for(const[p,b]of pack.files)if(p.startsWith('工作室/')&&(await b.text()).includes('TEST_SECRET_NOT_FOR_DISK'))return false;return true});
    await test('从目录索引完整恢复画册与模板',async()=>{restored=await loadDiskManifest(async path=>{const b=pack.files.get(path);if(!b)throw Error('缺失 '+path);return b},await pack.files.get('workspace.json').text());return restored.state.books[0].steps.length===3&&restored.state.exportTemplates.length===4&&restored.state.settings.identity.workspaceName==='格式自检工作室'});
    await test('恢复后的画面可脱机读取',()=>restored?.state.books[0].steps.every(s=>s.image.startsWith('data:image/svg+xml;base64,')));
    await test('目录 ZIP 使用标准签名与 UTF-8 文件名',async()=>{const zip=await zipDirectory(new Map([['企划/测试.txt',new Blob(['测试'])]])),bytes=new Uint8Array(await zip.arrayBuffer()),v=new DataView(bytes.buffer);return v.getUint32(0,true)===0x04034b50&&v.getUint16(6,true)===0x800&&v.getUint32(bytes.length-22,true)===0x06054b50});
  }
  await test('ZIP CRC32 校验值',()=>crc32(new TextEncoder().encode('123456789'))===0xcbf43926);
  await test('模拟写入失败不会提交新内容',async()=>{let data='上一次完整记录',aborted=false;const root={getDirectoryHandle:async()=>root,getFileHandle:async()=>({createWritable:async()=>({write:async()=>{},close:async()=>{throw Error('模拟中断')},abort:async()=>{aborted=true}})})};try{await writeDiskFile(root,'测试/book.json','新内容')}catch(e){}return data==='上一次完整记录'&&aborted});
  const area=$('#disk-test-results');if(area)area.innerHTML=tests.map(t=>`<div class="row" style="padding:12px 0;border-bottom:1px solid var(--line)"><span class="${t.ok?'accent':'danger'}">${icon(t.ok?'check':'close')}</span><span class="grow small">${esc(t.name)}</span><span class="tiny muted">${esc(t.message)}</span></div>`).join('')+'<p class="help">实际目录访问需要你在当前浏览器中授权并测试。自检不会冒充原生文件系统权限。</p>';
  return tests;
}


function backendConfig(){return state.settings.backend}


function backendURL(path,config=backendConfig()){const base=config.baseUrl?.trim()||(location.protocol.startsWith('http')?location.origin:'');if(!base)throw Error('当前不是 HTTP 页面，请填写你的 Python 服务地址。');const url=new URL(path,base.replace(/\/$/,'')+'/');if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('后端地址必须是 HTTP(S)，不能在 URL 中包含密钥。');return url.href}


function responseAt(object,field){if(!field)return object;let value=object;for(const key of field.split('.')){if(systemVariableKeys.has(key))throw Error('响应字段路径不合法。');value=value?.[key]}return value}


function persistBackendLocation(){try{localStorage.setItem('cc-python-connection',JSON.stringify(backendConfig()))}catch(e){}}


function rememberedBackend(){try{return JSON.parse(localStorage.getItem('cc-python-connection')||'null')}catch(e){return null}}


function backendHeaders(){const h={Accept:'application/json'};if(createUI.backendToken)h.Authorization='Bearer '+createUI.backendToken;return h}


async function readPythonWorkspace(config=backendConfig()){
  if(!config.loadPath?.trim())throw Error('请填写现有 Python 后端的读取接口。项目中没有可自动确认的后端接口约定。');
  const response=await request(backendURL(config.loadPath,config),{headers:backendHeaders()},20000),json=await response.json(),data=responseAt(json,config.responseField);
  if(data===null)return{state:null,etag:response.headers.get('etag'),revision:json.revision||null};
  const candidate=data?.schemaVersion?data:json.schemaVersion?json:null;if(!candidate)throw Error('接口已响应，但没有找到工程数据。请核对“响应中的工程字段”，或让接口返回 {state: null} 表示空工作室。');validateState(candidate);return{state:candidate,etag:response.headers.get('etag'),revision:json.revision||null};
}


function applyPythonState(data,config){state=clone(data);ensureStudioState();state.settings.backend={...config,enabled:true};ui.workspace=0;ui.templateId=projectTemplates()[0]?.id;ui.storyTemplateId=ui.templateId;ui.storyRowId=projectRows()[0]?.id;ui.frameIndex=0;createUI.planId=projectPlans()[0]?.id||null;ui.selected.clear();studioUI.exportDraft=null;studioUI.assistantUndo=null;$('#assistant').hidden=true;if($('#reader').open)closeReader();rememberProfile();}


async function connectPythonBackend(){
  if(activeJobs())throw Error('请先完成生成、导出或其他正在执行的服务任务。');const config=clone(backendConfig());if(!config.savePath?.trim())throw Error('请填写保存接口。');backendURL(config.savePath,config);backendRuntime.loading=true;createUI.backendBusy=true;renderStatus();
  try{const result=await readPythonWorkspace(config);if(result.state){if(!await confirmAction('打开 Python 后端里的工作室？','读取到 '+result.state.projects.length+' 个企划和 '+result.state.books.length+' 本画册。当前内存工程不会与后端自动混合。','读取并连接'))return;applyPythonState(result.state,config)}else{if(!await confirmAction('连接空的 Python 工作室？','读取接口明确返回空工程。连接后，你下一次保存会发送当前内存工程给此服务。','确认连接'))return;state.settings.backend.enabled=true}
    backendRuntime.connected=true;backendRuntime.loaded=true;backendRuntime.etag=result.etag;backendRuntime.revision=result.revision;backendRuntime.count=result.state?assetCount(result.state):0;backendRuntime.error='';backendRuntime.dirty=!result.state;backendRuntime.savedAt=result.state?Date.now():null;persistBackendLocation();render();toast(result.state?'已读取后端工程，后续修改通过保存接口提交。':'空工作室已连接，可点击“立即保存”首次提交。')
  }catch(e){backendRuntime.connected=false;backendRuntime.error=e.message;throw e}finally{backendRuntime.loading=false;createUI.backendBusy=false;renderStatus()}
}


async function savePythonWorkspace(allow=false){
  backendRuntime.allowReduction ||= allow;
  backendRuntime.tail=backendRuntime.tail.catch(()=>{}).then(async()=>{
    if(!backendConfig().enabled||!backendRuntime.connected)return false;const serial=backendRuntime.saveSerial,config=clone(backendConfig());backendRuntime.saving=true;renderStatus();
    try{validateState(state);if(!backendRuntime.allowReduction&&backendRuntime.count>10&&assetCount(state)<backendRuntime.count*.6)throw Error('防冲刷保护：本地工程明显少于后端记录，已停止覆盖。');const snapshot=backupObject(!!state.settings.disk.includeKeys);snapshot.updatedAt=Date.now();const payload=config.payloadField?{[config.payloadField]:snapshot}:snapshot;const headers={...backendHeaders(),'Content-Type':'application/json'};if(backendRuntime.etag)headers['If-Match']=backendRuntime.etag;
      const response=await request(backendURL(config.savePath,config),{method:config.method||'PUT',headers,body:JSON.stringify(payload)},90000);let ack={};if(response.status!==204)ack=await response.json();if(response.status!==204&&ack.ok!==true&&ack.saved!==true&&ack.success!==true)throw Error('后端未明确确认保存（需要 ok/saved/success:true 或 HTTP 204）。当前不会标记为已保存。');backendRuntime.etag=response.headers.get('etag')||backendRuntime.etag;backendRuntime.revision=ack.revision||backendRuntime.revision;backendRuntime.savedAt=Date.now();backendRuntime.committedSerial=serial;backendRuntime.dirty=backendRuntime.saveSerial!==serial;backendRuntime.count=assetCount(snapshot);backendRuntime.error='';backendRuntime.allowReduction=false;state.updatedAt=snapshot.updatedAt;return true;
    }catch(e){backendRuntime.error=e.message;backendRuntime.dirty=true;log('Python 保存未确认：'+e.message,'error');toast('后端保存未完成：'+e.message,'error');return false}finally{backendRuntime.saving=false;renderStatus();const status=$('#v3-backend-status');if(status)status.textContent=backendStatusText()}
  });return backendRuntime.tail;
}


function backendStatusText(){if(backendRuntime.loading)return'正在读取 Python 工作室...';if(backendRuntime.saving)return'正在提交 Python 后端...';if(backendRuntime.error)return'后端保存未确认 · 请检查设置';if(backendRuntime.connected)return backendRuntime.dirty?'有待保存修改':'Python 已确认保存'+(backendRuntime.savedAt?' · '+new Date(backendRuntime.savedAt).toLocaleTimeString('zh-CN'):'');return'尚未连接保存服务 · 当前为临时会话'}


async function discoverBackendSchema(){const config=backendConfig(),schema=await(await request(backendURL('/openapi.json',config),{headers:backendHeaders()},10000)).json();if(!schema?.paths)throw Error('此服务没有返回 OpenAPI 路径。请手动填写已知接口。');createUI.backendReads=[];createUI.backendWrites=[];for(const[path,methods]of Object.entries(schema.paths)){if(path.includes('{'))continue;if(methods.get)createUI.backendReads.push(path);if(methods.put||methods.post)createUI.backendWrites.push(path)}createUI.backendSchema=schema;render();toast('已读取 '+createUI.backendReads.length+' 个读取路径与 '+createUI.backendWrites.length+' 个写入路径。请选择实际工程接口。')}


async function migrateAndLoadV3(){
  let restored=false;const config=rememberedBackend();if(config?.enabled){state.settings.backend={...state.settings.backend,...config};try{backendRuntime.loading=true;const result=await readPythonWorkspace(config);if(result.state){applyPythonState(result.state,config);backendRuntime.connected=true;backendRuntime.loaded=true;backendRuntime.etag=result.etag;backendRuntime.revision=result.revision;backendRuntime.savedAt=Date.now();backendRuntime.count=assetCount(state);restored=true}}catch(e){backendRuntime.error=e.message}finally{backendRuntime.loading=false}}
  if(!restored){const legacy=await findLegacyProject();disk.legacy=legacy;if(legacy){state=clone(legacy);ensureStudioState();if(config)state.settings.backend={...state.settings.backend,...config}}}
  ensureStudioState();state.queue.forEach(q=>{if(['running','paused'].includes(q.status))q.status='pending'});state.books.forEach(b=>b.inProgress=false);rt.booting=false;rt.saved=backendRuntime.connected;rt.saving=false;ui.templateId=projectTemplates()[0]?.id;ui.storyTemplateId=ui.templateId;ui.storyRowId=projectRows()[0]?.id;createUI.planId=projectPlans()[0]?.id;render();if(!state.settings.identity.workspaceName||!state.settings.identity.onboarded)showWorkspaceWelcome();else if(backendRuntime.error)toast('Python 服务未连接：'+backendRuntime.error,'error');
}


/* Source: /js/sync.js */
function createConfigConverters(contract){
  const {object,copy,collection,replaceCollection,requiredFields}=contract;
  function fromApi(config,defaults){
    if(!contract.plain(config))throw Error('/api/config must return a flat JSON object.');if(Object.hasOwn(config,'state')&&!requiredFields.some(k=>Object.hasOwn(config,k)))throw Error('Wrapped {state: ...} responses are not the /api/config contract.');const missing=requiredFields.filter(k=>!Object.hasOwn(config,k));if(missing.length)throw Error('Incomplete /api/config response: '+missing.join(', ')+'. Existing local state was retained.');
    const result=copy(defaults),uiConfig=object(config.uiConfig),meta=object(uiConfig.comfyStudio),priorSettings=object(meta.settings);
    result.templates=collection(config.templates,['templates','items']);result.books=collection(config.savedGalleries,['books','galleries','items']);result.rows=collection(config.batchMatrix,['rows','items']);result.projects=copy(meta.projects??uiConfig.projects??result.projects);result.activeProjectId=meta.activeProjectId??uiConfig.activeProjectId??result.projects?.[0]?.id;result.creation=copy(meta.creation);result.exportTemplates=copy(meta.exportTemplates??result.exportTemplates);result.installedPackages=copy(meta.installedPackages??[]);result.customColumns=copy(meta.customColumns??object(config.batchMatrix).customColumns??[]);result.drafts=copy(meta.drafts??{});result.workspaceId=meta.workspaceId??result.workspaceId;
    result.settings={...result.settings,...priorSettings};const comfyConfig=object(config.comfyConfig),workflows=collection(config.comfyWorkflows,['workflows','presets','items']);result.settings.comfy={...defaults.settings.comfy,...comfyConfig};result.settings.comfy.presets=copy(workflows);const selected=workflows.find(item=>item.id===comfyConfig.activeWorkflowId||item.id===comfyConfig.workflowId)||workflows[0],workflow=comfyConfig.workflow??meta.workflow??selected?.workflow??selected?.prompt;result.settings.comfy.workflow=copy(workflow&&Object.keys(workflow).length?workflow:defaults.settings.comfy.workflow);const mapping={...defaults.settings.comfy.mapping,...object(comfyConfig.mapping)};for(const kind of ['positive','negative','output'])if(comfyConfig[kind+'NodeId']!==undefined)mapping[kind]=String(comfyConfig[kind+'NodeId']);result.settings.comfy.mapping=mapping;if(!Array.isArray(comfyConfig.bindings))delete result.settings.comfy.bindings;result.settings.llm={...defaults.settings.llm,...object(config.llmConfig)};result.settings.xml={...defaults.settings.xml,...object(config.xmlConfig)};result.settings.studio=copy(meta.studio??priorSettings.studio??uiConfig.studio??defaults.settings.studio);
    const chat=object(config.chatConfig),run=object(config.batchRunState);result.chats=copy(chat.sessions??chat.chats??meta.chats??[]);result.activeChatId=chat.activeChatId??meta.activeChatId;result.queue=copy(Array.isArray(config.batchRunState)?config.batchRunState:run.queue??run.tasks??[]);result.updatedAt=Number(config.updatedAt)||Date.now();result.settings.backend={enabled:true,baseUrl:'',loadPath:'/api/config',savePath:'/api/config',method:'POST',payloadField:'',responseField:''};return contract.normalize(result);
  }
  function toApi(studio,previous={},forceWrite=false){
    const settings=copy(studio.settings);if(!settings.disk?.includeKeys)for(const key of ['llm','xml','critic'])if(settings[key])settings[key].key='';if(settings.github){delete settings.github.token;delete settings.github.key}const comfy={...object(previous.comfyConfig),...settings.comfy};delete comfy.presets;
    const metadataSettings=copy(settings);for(const key of ['comfy','llm','xml'])delete metadataSettings[key];
    const payload={...copy(previous),expectedRevision:previous.updatedAt,templates:replaceCollection(previous.templates,studio.templates||[],['templates','items'],'templates'),savedGalleries:replaceCollection(previous.savedGalleries,studio.books||[],['books','galleries','items'],'books'),batchMatrix:replaceCollection(previous.batchMatrix,studio.rows||[],['rows','items'],'rows'),comfyWorkflows:replaceCollection(previous.comfyWorkflows,settings.comfy.presets||[],['workflows','presets','items'],'workflows'),comfyConfig:comfy,llmConfig:{...object(previous.llmConfig),...settings.llm},xmlConfig:{...object(previous.xmlConfig),...settings.xml},chatConfig:{...object(previous.chatConfig),sessions:copy(studio.chats||[]),activeChatId:studio.activeChatId},uiConfig:{...object(previous.uiConfig),comfyStudio:{...object(object(previous.uiConfig).comfyStudio),projects:copy(studio.projects),activeProjectId:studio.activeProjectId,workspaceId:studio.workspaceId,creation:copy(studio.creation),exportTemplates:copy(studio.exportTemplates),customColumns:copy(studio.customColumns),installedPackages:copy(studio.installedPackages),drafts:copy(studio.drafts),settings:metadataSettings,studio:copy(settings.studio)}},batchRunState:{...object(previous.batchRunState),queue:copy(studio.queue||[])},updatedAt:Date.now()};delete payload.state;delete payload._emptyWorkspace;delete payload.forceWrite;if(forceWrite)payload.forceWrite=true;for(const key of requiredFields)if(!Object.hasOwn(payload,key))throw Error('Missing required API field: '+key);return payload;
  }
  return {fromApi,toApi};
}


function createNativeConfigSync(options){
  const runtime={loading:false,saving:false,loaded:false,error:'',dirty:false,previous:{},serial:0,committed:0,forceSerial:0,savedAt:null,timer:null,tail:Promise.resolve()},notify=()=>options.onStatus?.(runtime),getFetch=()=>options.fetch||globalThis.fetch.bind(globalThis);
  async function read(){runtime.loading=true;runtime.error='';notify();try{const response=await getFetch()('/api/config',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)throw Error('GET /api/config: HTTP '+response.status);const config=await response.json(),validated=options.convert.fromApi(config,options.defaults()),converted=config._emptyWorkspace===true&&!validated.templates.length&&!validated.books.length&&!validated.rows.length?options.contract.copy(options.defaults()):validated;runtime.previous=options.contract.copy(config);runtime.loaded=true;runtime.savedAt=Number(config.updatedAt)||null;return converted}catch(e){runtime.error=e.message;throw e}finally{runtime.loading=false;notify()}}
  function markDirty(force=false){runtime.serial++;runtime.dirty=true;runtime.error='';if(force)runtime.forceSerial=runtime.serial;clearTimeout(runtime.timer);if(options.enabled())runtime.timer=setTimeout(()=>save(),options.debounce??700);notify()}
  function save(force=false){
    clearTimeout(runtime.timer);if(force){runtime.serial++;runtime.forceSerial=runtime.serial;runtime.dirty=true}
    runtime.tail=runtime.tail.catch(()=>false).then(async()=>{
      if(!options.enabled())return false;
      if(!runtime.loaded){try{const recovered=await read();if(recovered.templates.length||recovered.books.length||recovered.rows.length){runtime.loaded=false;runtime.error='Connection recovered, but the backend contains existing work. Reload it explicitly before saving local edits.';notify();return false}}catch(e){notify();return false}}
      const serial=runtime.serial,forceSerial=runtime.forceSerial;runtime.saving=true;runtime.error='';notify();
      try{const studio=options.getState();options.validate(studio);const payload=options.convert.toApi(studio,runtime.previous,forceSerial>0),response=await getFetch()('/api/config',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});if(!response.ok)throw Error('POST /api/config: HTTP '+response.status);if(response.status!==204){const text=await response.text();if(text.trim()){let data;try{data=JSON.parse(text)}catch(e){throw Error('The config endpoint returned non-JSON content.')}if(data.ok===false||data.status==='error'||data.success===false)throw Error(data.message||data.error||'The backend rejected the save.')}}runtime.previous=payload;runtime.committed=serial;if(runtime.forceSerial===forceSerial)runtime.forceSerial=0;runtime.dirty=runtime.serial!==serial;runtime.savedAt=payload.updatedAt;return true}
      catch(e){runtime.error=e.message;runtime.dirty=true;options.onError?.(e);return false}finally{runtime.saving=false;notify()}
    });return runtime.tail;
  }
  return{runtime,read,save,markDirty};
}


function installNativeSyncModule(){
  const ns=globalThis.ComfyComic;ns.converters=createConfigConverters(ns.stateContract);ns.sync=createNativeConfigSync({contract:ns.stateContract,convert:ns.converters,defaults:()=>state,getState:()=>state,validate:value=>validateState(value),enabled:()=>/http/.test(location.protocol),onStatus:r=>{backendRuntime.connected=r.loaded;backendRuntime.loading=r.loading;backendRuntime.saving=r.saving;backendRuntime.dirty=r.dirty;backendRuntime.error=r.error;backendRuntime.savedAt=r.savedAt;rt.saved=r.loaded&&!r.dirty&&!r.error;if(document.getElementById('statusbar'))renderStatus()},onError:e=>log(e.message,'error')});
  save=function(force=false){if(!rt.booting)ns.sync.markDirty(force)};
  flushDiskSave=async function(){flushEditor();return ns.sync.save()};
  readPythonWorkspace=async function(){return {state:await ns.sync.read(),revision:null,etag:null}};savePythonWorkspace=force=>ns.sync.save(force);
  connectPythonBackend=async function(){if(activeJobs())throw Error('Finish active jobs before reloading the config.');if(ns.sync.runtime.dirty&&!await confirmAction('重新读取后端配置？','尚未保存的本地更改会被后端内容替换。','重新读取'))return;state=await ns.sync.read();ensureStudioState();ns.sync.runtime.dirty=false;backendRuntime.dirty=false;rt.saved=true;ui.selected.clear();ui.templateId=projectTemplates()[0]?.id;ui.frameIndex=0;createUI.planId=projectPlans()[0]?.id||null;render();toast('已读取 /api/config，保存使用 POST 平铺字段。')};
  loadState=async function(){ensureStudioState();if(/http/.test(location.protocol)){try{state=await ns.sync.read()}catch(e){log('Config load failed: '+e.message,'error')}}ensureStudioState();rt.booting=false;ui.templateId=projectTemplates()[0]?.id;ui.storyTemplateId=ui.templateId;ui.storyRowId=projectRows()[0]?.id;ui.frameIndex=0;createUI.planId=projectPlans()[0]?.id||null;render();if(!state.settings.identity.workspaceName||!state.settings.identity.onboarded)showWorkspaceWelcome()};ns.modules.sync=true;
}


function convertApiConfigToStudioState(config,defaults=state){return globalThis.ComfyComic.converters.fromApi(config,defaults)}


function convertStudioStateToApiPayload(studio=state,previous,forceWrite=false){return globalThis.ComfyComic.converters.toApi(studio,previous??globalThis.ComfyComic.sync.runtime.previous,forceWrite)}
