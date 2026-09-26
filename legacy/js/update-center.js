/* Update center: the 「关于与更新」 settings tab. Talks to /api/update/* (backend/mio_update.py), which reads GitHub Releases
   for lumingya/comfy-comic-studio, verifies the package checksum, swaps program files with a backup and never touches
   the user's data directory. The page only renders server facts; it never guesses. */
'use strict';
const UPDATE_PREFS_KEY='mio-update-prefs';
const updateCenter={status:null,check:null,busy:'',error:'',prefs:null,pollTimer:null,restartTimer:null,restarting:false,noticeShown:'',statusTried:false};

function updatePrefs(){
  if(!updateCenter.prefs){
    let stored={};try{stored=JSON.parse(localStorage.getItem(UPDATE_PREFS_KEY)||'{}')||{}}catch{stored={}}
    updateCenter.prefs={autoCheck:true,includePrerelease:null,dismissed:'',lastAutoCheck:0,...stored};
  }
  return updateCenter.prefs;
}
function saveUpdatePrefs(patch){Object.assign(updatePrefs(),patch);try{localStorage.setItem(UPDATE_PREFS_KEY,JSON.stringify(updatePrefs()))}catch{/* private mode: preferences simply do not persist */}}

function updateErrorText(error){return String(error?.message||error||'更新服务不可用').replace(/^HTTP \d+:\s*/,'')}
async function updateRequest(route,body){
  const response=await request('/api/update/'+route,body===undefined?{}:post(body),body===undefined?15000:30000);
  const result=await response.json().catch(()=>({}));
  if(result.error)throw Error(typeof result.error==='string'?result.error:'更新服务不可用');
  return result.data;
}
function updateBackendAvailable(){return !!backendConfig()?.enabled||location.protocol.startsWith('http')&&!location.pathname.endsWith('.html')}

function updateJob(){return updateCenter.status?.job||null}
function updateJobActive(){const job=updateJob();return !!job&&!['done','failed'].includes(job.phase)}
function updateLatest(){return updateCenter.check?.latest||updateCenter.status?.lastCheck?.latest||null}
function updateCheckResult(){return updateCenter.check||updateCenter.status?.lastCheck||null}

/* ---- server calls */
async function refreshUpdateStatus(){updateCenter.status=await updateRequest('status');if(!updateCenter.check&&updateCenter.status.lastCheck)updateCenter.check=updateCenter.status.lastCheck;renderUpdateCenter();return updateCenter.status}

async function runUpdateCheck({manual=true}={}){
  if(updateCenter.busy)return null;
  updateCenter.busy='check';updateCenter.error='';renderUpdateCenter();
  try{
    const prefs=updatePrefs();
    updateCenter.check=await updateRequest('check',prefs.includePrerelease===null?{}:{prerelease:!!prefs.includePrerelease});
    saveUpdatePrefs({lastAutoCheck:Date.now()});
    if(manual)toast(updateCenter.check.updateAvailable?`发现新版本 v${updateCenter.check.latest.version}。`:`当前已是最新版本 v${updateCenter.check.current}。`);
    return updateCenter.check;
  }catch(error){
    updateCenter.error=updateErrorText(error);if(manual)toast(updateCenter.error,'error');return null;
  }finally{updateCenter.busy='';renderUpdateCenter();markUpdateBadge()}
}

async function startUpdateApply(version){
  const check=updateCheckResult();if(!check?.latest)throw Error('请先检查更新。');
  const facts=check.install||{};
  const lines=[`将下载 ${check.latest.asset?.name||'程序包'}，校验 SHA-256 后替换程序文件。`,'被替换的旧程序文件会先备份，可一键回退。'];
  if(!facts.dataInsideProgram)lines.push('数据目录在程序目录之外，更新只涉及程序文件。');
  if(!await confirmAction(`安装 v${check.latest.version}？`,lines.join(' '),'下载并安装'))return;
  updateCenter.busy='apply';updateCenter.error='';renderUpdateCenter();
  try{updateCenter.status=await updateRequest('apply',{version:version||check.latest.version})}
  catch(error){updateCenter.error=updateErrorText(error);toast(updateCenter.error,'error')}
  finally{updateCenter.busy='';renderUpdateCenter();scheduleUpdatePoll()}
}

function scheduleUpdatePoll(){
  clearTimeout(updateCenter.pollTimer);
  updateCenter.pollTimer=setTimeout(async()=>{
    try{await refreshUpdateStatus()}catch(error){updateCenter.error=updateErrorText(error);renderUpdateCenter();return}
    const job=updateJob();
    if(updateJobActive())scheduleUpdatePoll();
    else if(job?.phase==='done'&&updateCenter.noticeShown!==job.version+':'+job.phase){updateCenter.noticeShown=job.version+':'+job.phase;toast(job.message||'更新已安装，重启后生效。')}
    else if(job?.phase==='failed'&&updateCenter.noticeShown!==(job.version||'')+':failed'){updateCenter.noticeShown=(job.version||'')+':failed';toast(job.error||'更新未完成。','error')}
  },1000);
}

async function restartAfterUpdate(){
  const before=updateCenter.status?.current||MIO_VERSION;
  if(!await confirmAction('现在重启工作室？','服务会在几秒内重新启动，页面随后自动刷新。正在运行的生成任务请先暂停。','重启'))return;
  // Flush everything the page still holds before the old process goes away; the reloaded page gets a fresh session token.
  if(typeof flushEditor==='function')flushEditor();
  if(typeof savePythonWorkspace==='function'){try{await savePythonWorkspace()}catch{/* the restart probe below will surface a failure */}}
  try{await updateRequest('restart',{})}
  catch(error){updateCenter.error=updateErrorText(error);toast(updateCenter.error,'error');renderUpdateCenter();return}
  updateCenter.restarting=true;clearTimeout(updateCenter.pollTimer);renderUpdateCenter();
  const started=Date.now();
  const probe=async()=>{
    try{
      const response=await fetch('/api/update/status',{cache:'no-store'});
      if(response.ok){const data=(await response.json()).data;if(data&&data.current!==before||Date.now()-started>8000&&data&&!data.restartPending){location.reload();return}}
    }catch{/* server is restarting */}
    if(Date.now()-started>90000){updateCenter.restarting=false;updateCenter.error='服务尚未回来。请手动运行 start.bat / start.sh 重新启动，若启动失败可在此回退。';renderUpdateCenter();return}
    updateCenter.restartTimer=setTimeout(probe,1500);
  };
  updateCenter.restartTimer=setTimeout(probe,2500);
}

async function rollbackUpdate(){
  const last=updateCenter.status?.lastUpdate;if(!last)return;
  if(!await confirmAction(`回退到 v${last.from}？`,'恢复更新前备份的程序文件。回退后需要重启。','回退'))return;
  updateCenter.busy='rollback';renderUpdateCenter();
  try{updateCenter.status=await updateRequest('rollback',{});toast(updateJob()?.message||'已回退，重启后生效。')}
  catch(error){updateCenter.error=updateErrorText(error);toast(updateCenter.error,'error')}
  finally{updateCenter.busy='';renderUpdateCenter()}
}

/* ---- boot-time check: at most once a day, quietly */
function markUpdateBadge(){
  const check=updateCheckResult(),latest=check?.latest;
  const show=!!(check?.updateAvailable&&latest&&updatePrefs().dismissed!==latest.version);
  document.documentElement.classList.toggle('has-update',show);
  $('#sidebar .nav-settings')?.classList.toggle('has-update',show);
}
function installUpdateAutoCheck(){
  const prefs=updatePrefs();
  if(!prefs.autoCheck||!updateBackendAvailable())return;
  const dayMs=24*60*60*1000;
  if(Date.now()-Number(prefs.lastAutoCheck||0)<dayMs)return;
  setTimeout(async()=>{
    if(!prefs.autoCheck)return;
    const result=await runUpdateCheck({manual:false});
    if(result?.updateAvailable&&prefs.dismissed!==result.latest.version){toast(`发现新版本 v${result.latest.version}，可在「设置 → 关于与更新」安装。`)}
  },9000);
}

/* ---- rendering */
function updateSizeText(bytes){if(!bytes)return '';return bytes>1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB'}
function updateDateText(value){if(!value)return '';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString('zh-CN',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function updateNotesHTML(notes){
  const text=String(notes||'').trim();if(!text)return '<p class="help">这个版本没有附带说明。</p>';
  const lines=text.split(/\r?\n/).slice(0,80);
  return `<div class="update-notes">${lines.map(line=>{const t=line.trim();if(!t)return '';if(/^#{1,6}\s/.test(t))return `<h4>${esc(t.replace(/^#+\s*/,''))}</h4>`;if(/^[-*]\s/.test(t))return `<li>${esc(t.replace(/^[-*]\s*/,''))}</li>`;return `<p>${esc(t)}</p>`}).join('')}</div>`;
}
function updateJobHTML(job){
  if(!job)return '';
  const percent=Math.round((job.progress||0)*100),failed=job.phase==='failed',done=job.phase==='done';
  return `<div class="update-job ${failed?'is-failed':done?'is-done':'is-active'}" role="status" aria-live="polite"><div class="row"><strong>${esc(job.rollback?'回退':'更新到 v'+(job.version||''))}</strong><span class="spacer"></span><span class="mono small">${failed?'失败':done?'完成':percent+'%'}</span></div><div class="update-progress" aria-hidden="true"><i style="width:${failed?100:percent}%"></i></div><p>${esc(failed?job.error||'更新未完成':job.message||'')}</p></div>`;
}
function renderAboutSettings(){
  const status=updateCenter.status,check=updateCheckResult(),latest=updateLatest(),prefs=updatePrefs(),job=updateJob(),active=updateJobActive();
  const current=status?.current||check?.current||MIO_VERSION,facts=status?.install||check?.install||null;
  const available=!!(check?.updateAvailable&&latest),canApply=!!(check?.canApply&&!active&&!updateCenter.busy),restartReady=!!(job?.restartRequired&&job.phase==='done')||!!status?.restartPending;
  const blockers=[...(check?.blockers||facts?.blockers||[])];
  const lastUpdate=status?.lastUpdate;
  const checking=updateCenter.busy==='check';
  const releaseLine=latest?`<div class="update-release"><div class="grow"><strong>v${esc(latest.version)}${latest.prerelease?' <span class="chip amber">预发布</span>':''}${available?' <span class="chip green">可更新</span>':''}</strong><small>${esc(latest.name||latest.tag)} · ${esc(updateDateText(latest.publishedAt))}${latest.asset?' · '+esc(latest.asset.name)+' '+esc(updateSizeText(latest.asset.size)):' · 未附带程序包'}</small></div><a class="btn ghost small" href="${esc(latest.url)}" target="_blank" rel="noopener">${icon('eye','sm')}<span>发布页</span></a></div><details class="update-notes-box"><summary>版本说明</summary>${updateNotesHTML(latest.notes)}</details>`:'';
  const statusText=updateCenter.restarting?'正在重启服务，请稍候…':checking?'正在读取 GitHub Releases…':check?available?`有新版本可用：v${latest.version}`:`已是最新版本（检查于 ${updateDateText(check.checkedAt)}）`:'尚未检查更新。';
  const blockerHTML=blockers.length?`<div class="notice amber"><strong>暂时不能自动安装</strong><ul>${blockers.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>${latest?`<p>你仍然可以在 <a href="${esc(latest.url)}" target="_blank" rel="noopener">GitHub 发布页</a> 下载，解压后覆盖程序文件；<code>data/</code> 目录保持原样即可。</p>`:''}</div>`:'';
  const dataLine=facts?`<div class="service-context"><strong>安装位置</strong><br>程序目录：<code>${esc(facts.programDir)}</code><br>数据目录：<code>${esc(facts.dataDir)}</code>${facts.dataInsideProgram?'（位于程序目录内，更新时受保护）':'（独立于程序目录）'}<br>安装方式：${esc(facts.kind==='git'?'Git 检出 · 建议用 git pull 更新，也可在此安装发布包':facts.kind==='frozen'?'打包的可执行程序':'发布包 / 源码目录')}</div>`:'';
  const lastUpdateHTML=lastUpdate?settingsRow(lastUpdate.rolledBack?`上次更新已回退（v${esc(lastUpdate.to)} → v${esc(lastUpdate.from)}）`:`上次更新：v${esc(lastUpdate.from)} → v${esc(lastUpdate.to)}`,`${esc(updateDateText(lastUpdate.at))} · 替换 ${lastUpdate.replaced} 个文件，新增 ${lastUpdate.added} 个，移除 ${lastUpdate.removed} 个 · 备份：<code>${esc(lastUpdate.backupDir)}</code>`,lastUpdate.rolledBack||active?'':btn('回退到上一版','refresh','update-rollback','','small ghost'),'disk'):'';
  return `<div id="update-center"><section class="settings-section"><h2>关于 Mio · 绘页</h2><p>本地优先的分镜到画册工作室。当前版本 <strong class="mono">v${esc(current)}</strong>${check?.currentPrerelease?'（预发布）':''}。开源仓库：<a href="https://github.com/lumingya/comfy-comic-studio" target="_blank" rel="noopener">github.com/lumingya/comfy-comic-studio</a></p>${dataLine}</section>
<section class="settings-section update-section"><h2>更新</h2><p id="update-status-line" role="status">${esc(statusText)}</p>${updateCenter.error?`<div class="notice amber">${esc(updateCenter.error)}</div>`:''}${releaseLine}${blockerHTML}${updateJobHTML(job)}<div class="row wrap update-actions">${btn(checking?'正在检查…':'检查更新','refresh','update-check',checking||active||updateCenter.restarting?'disabled':'',available?'':'primary')}${available?btn(active?'正在安装…':'下载并安装 v'+latest.version,'download','update-apply',`data-version="${esc(latest.version)}" ${canApply?'':'disabled'}`,'primary'):''}${restartReady?btn(updateCenter.restarting?'重启中…':'重启工作室以完成更新','play','update-restart',updateCenter.restarting?'disabled':'','primary'):''}</div><p class="help">更新会先下载发布包并核对 SHA-256，再逐个替换程序文件；旧文件备份在 <code>.mio-updates/</code>，数据目录始终不动。重启后如有问题，可在这里一键回退。</p>${lastUpdateHTML}</section>
<section class="settings-section"><h2>更新偏好</h2>${settingsRow('自动检查更新','启动后每天最多检查一次，有新版本时提示。',`<label class="switch"><input type="checkbox" data-update-pref="autoCheck" ${prefs.autoCheck?'checked':''} aria-label="自动检查更新"><span class="switch-track"></span></label>`,'clock')}${settingsRow('包含预发布版本','测试版可能不稳定。当前运行的是预发布版时默认包含。',`<label class="switch"><input type="checkbox" data-update-pref="includePrerelease" ${(prefs.includePrerelease===null?!!check?.currentPrerelease:!!prefs.includePrerelease)?'checked':''} aria-label="包含预发布版本"><span class="switch-track"></span></label>`,'spark')}${available?settingsRow('忽略这个版本','不再为 v'+esc(latest.version)+' 显示提醒；下一个版本仍会提示。',btn(prefs.dismissed===latest.version?'已忽略':'忽略 v'+latest.version,'close','update-dismiss',prefs.dismissed===latest.version?'disabled':'','small ghost'),'eye'):''}</section></div>`;
}
function renderUpdateCenter(){const host=$('#update-center');if(!host)return;host.outerHTML=renderAboutSettings()}

function installUpdateCenter(){
  // A restart we asked for must not be blocked by "unsaved changes" prompts: saves were flushed and the old session is gone anyway.
  window.addEventListener('beforeunload',event=>{if(updateCenter.restarting)event.stopImmediatePropagation()},true);
  const previousAction=handleAction;
  handleAction=async function(action,d={},element){
    if(action==='update-check'){await runUpdateCheck({manual:true});return}
    if(action==='update-apply'){await startUpdateApply(d.version);return}
    if(action==='update-restart'){await restartAfterUpdate();return}
    if(action==='update-rollback'){await rollbackUpdate();return}
    if(action==='update-dismiss'){const latest=updateLatest();if(latest)saveUpdatePrefs({dismissed:latest.version});markUpdateBadge();renderUpdateCenter();toast('已忽略这个版本的提醒。');return}
    if(action==='update-open'){studioUI.settingsTab='about';navigate(5);return}
    return previousAction(action,d,element);
  };
  document.addEventListener('change',event=>{
    const key=event.target.dataset?.updatePref;if(!key)return;
    saveUpdatePrefs({[key]:event.target.checked});
    if(key==='includePrerelease'&&updateBackendAvailable())void runUpdateCheck({manual:true});
  });
  const previousRender=render;
  render=function(...args){
    const result=previousRender(...args);
    if(ui.workspace===5&&studioUI.settingsTab==='about'&&$('#update-center')&&!updateCenter.statusTried&&!updateCenter.busy&&updateBackendAvailable()){updateCenter.statusTried=true;updateCenter.busy='status';refreshUpdateStatus().catch(error=>{updateCenter.error=updateErrorText(error)}).finally(()=>{updateCenter.busy='';renderUpdateCenter();if(updateJobActive())scheduleUpdatePoll()})}
    markUpdateBadge();
    return result;
  };
  installUpdateAutoCheck();
}
