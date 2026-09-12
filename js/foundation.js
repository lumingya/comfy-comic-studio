/* Explicit foundation service boundary. UI never performs a real album generation. */
const foundationRuntime={activityAfter:0,diagnosticKey:"",polling:false,submitting:null,enabled:true,runtimeLoaded:false,runtime:{concurrency:1,requestTimeoutSeconds:600},runningCount:0,failurePolicy:{mode:'retry',maxRetries:5,delaySeconds:15,onExhausted:'continue'}};
function foundationIsMock(){return state.settings.comfy.mode==='mock'&&activeImageProfile().provider==='comfyui'}
async function foundationRequest(path,body){const response=await request('/api/foundation/'+path,body===undefined?{}:post(body),120000);return(await response.json()).data}
function foundationFrameInput(frame,row,bookId,frameIndex){
  const ex=frame._execution||mappedExecutionSnapshot(),scope=frame._scope||row._scope||row,resolved=frame._imageInputs?{prompt:frame._resolvedImagePrompt,negative:frame._resolvedImageNegative,images:frame._imageInputs}:resolveImageVariables(frame.prompt,scope,true,frame.negative||ex.globalNegative||'');
  const common={channelId:ex.profileId||ex.config?.id||'comfyui',frameIndex,prompt:resolved.prompt,negative:resolved.negative||'',images:resolved.images.map(i=>i.src),albumId:bookId,frame:{width:frame.width,height:frame.height,steps:frame.steps,cfg:frame.cfg,seed:frame.seed,denoise:frame.denoise}};
  if(ex.provider&&ex.provider!=='comfyui')return{...common,config:{provider:ex.provider}};
  const uploadedImages=Object.fromEntries(resolved.images.map((image,i)=>[image.key,'mio-image://'+(i+1)]));
  for(const image of resolved.images)if(!ex.bindings.some(b=>b.enabled&&b.source==='variable'&&String(b.value).replace(/^\{|\}$/g,'')===image.key))throw Error('图片变量 {'+image.key+'} 尚未绑定工作流节点。');
  const compiled=buildMappedWorkflow(frame,row,{execution:ex,uploadedImages});
  return{...common,config:{provider:'comfyui',baseUrl:ex.baseUrl,outputNodeId:ex.outputNodeId||''},workflow:compiled.workflow};
}
async function submitFoundationQueue(){
  if(foundationRuntime.submitting)return foundationRuntime.submitting;
  foundationRuntime.submitting=(async()=>{
    const requested=state.queue.filter(q=>q.status==='pending'||q.serverAwaitingRelease);
    for(const q of requested.filter(q=>!q.serverId)){
      q.serverAwaitingRelease=true;
      while(rt.lockedRows.has(q.rowId))await delay(500);
      const b=bookBy(q.bookId);if(!b)continue;
      if(!q.serverInput){q.serverIndices=q.indices.filter(i=>!b.steps.some(s=>s.stepIndex===i&&s.image));if(!q.serverIndices.length){q.status='complete';q.done=q.indices.length;q.serverAwaitingRelease=false;continue}q.serverMeta=q.serverIndices.map(i=>{const f=q.frames[i];return{stepIndex:i,name:f.name,prompt:f._resolvedImagePrompt||f.prompt,caption:scopeText(f.caption,f._scope||q.rowSnapshot)}});q.serverInput={hold:true,owner:q.id,albumId:q.bookId,label:b.title,frames:q.serverIndices.map(i=>foundationFrameInput(q.frames[i],q.rowSnapshot||b.sourceSnapshot.row,q.bookId,i))};save();if(!await savePythonWorkspace())throw Error('任务快照尚未保存，未提交付费生成。')}
      const job=await foundationRequest('jobs',{idempotencyKey:(state.workspaceId||'workspace')+':'+q.id,input:q.serverInput});q.serverId=job.id;save();
    }
    if(!await savePythonWorkspace())throw Error('服务端任务已保存，但本地映射尚未确认。请刷新恢复，勿新建重复任务。');
    for(const q of requested.filter(q=>state.queue.includes(q)&&q.serverId)){const job=await foundationRequest('jobs/'+q.serverId);if(job.state==='paused')await foundationRequest('jobs/'+q.serverId,{action:'resume'});q.serverAwaitingRelease=false}save();
    await pollFoundationJobs();
  })();try{return await foundationRuntime.submitting}finally{foundationRuntime.submitting=null}
}
async function pollFoundationJobs(){
  if(rt.booting||foundationRuntime.polling||!foundationRuntime.enabled||foundationIsMock())return;
  foundationRuntime.polling=true;
  try{
    const result=await foundationRequest('jobs');let changed=rt.paused!==result.paused;
    if(result.runtime){
      const previous=foundationRuntime.runtime,different=JSON.stringify(previous)!==JSON.stringify(result.runtime),clean=Number($('#queue-concurrency')?.value)===previous.concurrency&&Number($('#queue-timeout')?.value)===previous.requestTimeoutSeconds;
      foundationRuntime.runtime=result.runtime;foundationRuntime.runtimeLoaded=true;foundationRuntime.runningCount=result.jobs.reduce((n,j)=>n+(j.running_count||0),0);
      if(different&&clean&&$('#queue-runtime')&&!document.activeElement?.closest('#queue-runtime'))$('#queue-runtime').outerHTML=queueRuntimeHTML();
      if($('#queue-runtime-count'))$('#queue-runtime-count').textContent=`当前 ${foundationRuntime.runningCount} 个请求 · 每任务上限 ${result.runtime.concurrency}`;
      if($('[data-act="queue-runtime-save"]'))$('[data-act="queue-runtime-save"]').disabled=false;
    }
    if(result.failurePolicy){const different=JSON.stringify(foundationRuntime.failurePolicy)!==JSON.stringify(result.failurePolicy);foundationRuntime.failurePolicy=result.failurePolicy;if(different&&$('#queue-policy')&&!document.activeElement?.closest('#queue-policy')){const opened=$('#queue-policy').open;$('#queue-policy').outerHTML=queuePolicyHTML();$('#queue-policy').open=opened}}
    for(const q of state.queue){let job=result.jobs.find(j=>j.id===q.serverId||j.owner===q.id);if(!job||job.state==='archived'||q.serverUpdated>job.updated)continue;if(!q.serverId){q.serverId=job.id;changed=true}
      const b=bookBy(q.bookId);if(!b)continue;
      const projectedDone=q.indices.length-(q.serverIndices||q.indices).length+job.cursor;
      if(projectedDone>q.done||(job.error&&q.serverUpdated!==job.updated))job=await foundationRequest('jobs/'+job.id);
      else if(job.error)job.error={message:q.error};
      q.serverUpdated=job.updated;
      for(const [field,key] of [['retry_count','serverRetries'],['ready_at','serverReadyAt'],['attempts','serverAttempts'],['cancel','serverCancel'],['cursor','serverCursor'],['active_timeout','serverTimeout'],['nextIndex','serverNextIndex'],['running_count','serverRunningCount'],['enabled','serverEnabled'],['blocked','serverBlocked']])if(q[key]!==job[field]){q[key]=job[field];changed=true}
      if(JSON.stringify(q.serverChannels)!==JSON.stringify(job.currentChannels)){q.serverChannels=job.currentChannels;changed=true}
      if(JSON.stringify(q.serverFrameStates)!==JSON.stringify(job.frameStates)){q.serverFrameStates=job.frameStates;changed=true}
      for(const item of job.results){const index=(q.serverIndices||q.indices)[item.index],f=q.frames[index];if(!f)continue;const existing=b.steps.find(s=>s.stepIndex===index);
        if(!existing?.image){const step={stepIndex:index,name:f.name,prompt:item.prompt??f._resolvedImagePrompt??f.prompt,caption:scopeText(f.caption,f._scope||q.rowSnapshot),image:item.image,artifacts:item.artifacts,offlineFallback:false};if(existing)Object.assign(existing,step);else b.steps.push(step);hotReplace(b.id,index,item.image);changed=true}
      }
      const status={unknown:'failed',pending:'pending',running:'running',paused:'paused',complete:'complete',failed:'failed',canceled:'canceled'}[job.state];
      const done=Math.min(q.indices.length,(q.indices.length-(q.serverIndices||q.indices).length)+job.cursor),error=job.state==='unknown'?(job.error?.message?.startsWith('结果未确认：')?job.error.message:'结果未确认：'+(job.error?.message||'请核对上游记录，不要直接重试。')):job.error?.message;
      if(q.status!==status||q.done!==done||q.error!==error||q.serverState!==job.state){q.status=status;q.done=done;q.error=error;q.serverState=job.state;q.serverProvider=job.provider;changed=true}
      b.steps.sort((a,b)=>a.stepIndex-b.stepIndex);b.generatedSteps=b.steps.filter(s=>s.image).length;b.inProgress=job.state==='running';b.status=job.state==='complete'?(missingIndices(b).length?'partial':'complete'):['pending','running','paused'].includes(status)?'generating':status;
    }
    for(const b of state.books){const related=state.queue.filter(q=>q.bookId===b.id);if(!related.length)continue;b.inProgress=related.some(q=>q.status==='running');if(related.some(q=>['pending','paused','running'].includes(q.status)))b.status='generating'}
    await syncProductionActivity(result);
    rt.paused=result.paused;rt.running=result.jobs.some(j=>j.owner&&state.queue.some(q=>q.id===j.owner)&&j.state==='running');
    if(changed){save();updateQueueUI();renderStatus()}
    if(rt.running&&!rt.paused&&!foundationRuntime.submitting&&state.queue.some(q=>q.status==='pending'&&!q.serverId))void runQueue();
  }catch(error){if(state.queue.some(q=>q.serverId&&['running','pending','paused'].includes(q.status)))log('任务服务暂不可读；未自动重试生成：'+error.message,'warn')}
  finally{foundationRuntime.polling=false}
}
async function openFoundationAssets(){
  const report=await foundationRequest('assets/catalog?verify=1');
  modal('素材索引与完整性',`<p class="help">${report.items.length} 个文件 · ${report.missing.length} 个缺失引用。未引用文件至少保留 24 小时；清理只移入回收目录。运行中或结果未确认的任务会阻止清理。</p><div style="max-height:55vh;overflow:auto">${report.missing.map(x=>`<p class="danger">缺失：${esc(x.url)}</p>`).join('')}${report.items.map(x=>`<details><summary>${esc(x.name)} · ${(x.bytes/1024).toFixed(1)} KiB · ${x.references.length} 处引用 ${x.integrity==='ok'?'':'· 校验不一致'}</summary><code>${esc(x.url)}</code><pre>${esc(x.references.join('\n')||'未被当前工程或任务引用')}</pre>${x.cleanupEligible?`<label><input type="checkbox" data-recycle-asset="${esc(x.url)}">移入回收目录</label>`:''}</details>`).join('')}</div><div class="modal-footer">${btn('关闭','','close-modal')}${btn('回收所选文件','trash','foundation-cleanup',`data-token="${report.cleanup.token}"`,'small')}</div>`);
}
async function runFoundationQueue(){if(foundationIsMock())return runFlexibleQueue();try{return await submitFoundationQueue()}catch(e){toast(e.message,'error');log(e.message,'error')}}
async function interruptQueue(){
  if(foundationIsMock())return interruptLegacyQueue();
  await foundationRequest('jobs/scheduler',{action:'pause'});rt.paused=true;
  for(const q of state.queue.filter(q=>['pending','running','paused'].includes(q.status))){
    if(q.serverId){try{const stopped=await foundationRequest('jobs/'+q.serverId,{action:'cancel'});q.serverUpdated=stopped.updated;q.serverCursor=stopped.cursor;q.serverNextIndex=stopped.nextIndex;q.serverRunningCount=stopped.running_count;q.serverEnabled=stopped.enabled;q.serverFrameStates=stopped.frameStates;q.error=stopped.error?.message;q.serverState='canceled';q.serverCancel=true}catch(e){log('停止核对：'+e.message,'warn');continue}}
    q.status='canceled';const b=bookBy(q.bookId);if(b){b.inProgress=false;b.status='canceled'}updateQueueUI();
  }
  save();await pollFoundationJobs();toast('已停止本地任务，后续返回将丢弃；上游可能仍运行或计费。');
}
async function foundationAction(action,d={}){
    if(action==='queue-start-parallel')return startParallelTask(d.id);
    if(action==='queue-release-held')return releaseHeldTasks();
    if(action==='queue-runtime-save')return saveQueueRuntime();
    if(action==='queue-policy-save')return saveQueuePolicy();
    if(action==='queue-retry')return retryQueueTask(d.id);
    if(action==='queue-stop-task'){const q=state.queue.find(q=>q.id===d.id);if(q?.serverId){const stopped=await foundationRequest('jobs/'+q.serverId,{action:'cancel'});q.status=q.serverState='canceled';q.serverUpdated=stopped.updated;q.serverCursor=stopped.cursor;q.serverNextIndex=stopped.nextIndex;q.serverRunningCount=stopped.running_count;q.serverEnabled=stopped.enabled;q.serverFrameStates=stopped.frameStates;q.error=stopped.error?.message;q.serverCancel=true;const b=bookBy(q.bookId);if(b){b.inProgress=false;b.status='canceled'}updateQueueUI();await pollFoundationJobs();toast('已立即停止，后续返回将丢弃；无法保证供应商撤销请求或计费。')}return}
    if(action==='queue-continue-others'){if(!await confirmAction('保留失败结果并继续其他任务？','不重新生成这个失败任务；继续执行队列中其他已等待的任务。','继续其他任务'))return;const target=d.id||state.queue.find(q=>q.serverEnabled&&q.serverBlocked&&!q.serverRunningCount)?.id;const q=state.queue.find(q=>q.id===target);if(q?.serverId)await foundationRequest('jobs/'+q.serverId,{action:'defer'});await foundationRequest('jobs/scheduler',{action:'resume'});await pollFoundationJobs();return runQueue()}

    if(action==='foundation-reconcile'||action==='foundation-abandon'){const q=state.queue.find(x=>x.id===d.id);if(!q)return;if(action==='foundation-abandon'&&!await confirmAction('放弃跟踪未确认结果？','这不会撤销上游请求或退款。核对供应商记录后再决定是否新建付费任务。','放弃跟踪'))return;if(!q.serverId){if(action==='foundation-reconcile')return toast('请在原服务核对任务 '+(q.previousServerId||''));q.serverState='canceled';q.status='canceled';q.error='';save();updateQueueUI();return}await foundationRequest('jobs/'+q.serverId,{action:action==='foundation-reconcile'?'reconcile':'abandon'});return pollFoundationJobs()}
    if(action==='foundation-jobs')return openFoundationJobs();
    if(action==='foundation-job-detail')return openFoundationJobs(d.job);
    if(action==='foundation-job-control'){if(d.operation==='continue'){await continueServiceJob(d.job);return openFoundationJobs()}if(['cancel','abandon','archive','retry'].includes(d.operation)&&!await confirmAction('确认任务操作？','不会撤销上游计费；归档释放服务端引用但保留原画册。',d.operation))return;await foundationRequest('jobs/'+d.job,{action:d.operation});await pollFoundationJobs();return openFoundationJobs()}
    if(action==='foundation-assets')return openFoundationAssets();
    if(action==='foundation-cleanup'){const paths=$$('[data-recycle-asset]:checked').map(el=>el.dataset.recycleAsset);if(!paths.length)return toast('先选择文件。');if(!await confirmAction('回收所选素材？','仅处理未引用且超过 24 小时的文件，移入 data/trash，不永久删除。','移入回收目录'))return;await foundationRequest('assets/cleanup',{token:d.token,paths});return openFoundationAssets()}
}
function syncFoundationOrder(){const ids=state.queue.filter(q=>q.status==='pending'&&q.serverId&&(q.done||0)===0&&!q.serverAttempts).map(q=>q.serverId);if(ids.length)foundationRequest('jobs/reorder',{ids}).catch(e=>{toast('服务端排序未确认：'+e.message,'error');void pollFoundationJobs()})}
function foundationSettingsHTML(){return `<section class="settings-section"><h2>生产服务与素材</h2><p>真实画册生成在 Python 服务端执行，关页后继续。重启时，正在提交但没有结果的任务标记为“结果未确认”，不自动付费重试。</p>${btn('全部服务端任务','list','foundation-jobs','','small')}${btn('素材索引 / 引用 / 安全清理','image','foundation-assets','','small')}<a class="btn small" href="/docs/guide/FOUNDATION.html" target="_blank" rel="noopener">基座与 API 教程 ↗</a></section>`}
function installFoundation(){
  for(const action of ['queue-start-parallel','queue-release-held','queue-runtime-save','queue-policy-save','queue-retry','queue-stop-task','queue-continue-others','foundation-assets','foundation-cleanup','foundation-reconcile','foundation-abandon','foundation-jobs','foundation-job-control','foundation-job-detail'])v3Actions[action]=data=>foundationAction(action,data);
  document.addEventListener('change',event=>{if(event.target.id==='queue-policy-mode'){for(const id of ['queue-policy-exhausted','queue-policy-count','queue-policy-delay'])if($('#'+id))$('#'+id).disabled=event.target.value!=='retry';return}if(event.target.id!=='provider-extra-params')return;try{const value=JSON.parse(event.target.value||'{}');if(!value||Array.isArray(value)||typeof value!=='object')throw Error('请输入 JSON 对象');activeImageProfile().extraParams=value;save()}catch(e){toast('高级参数未保存：'+e.message,'error')}});
  setInterval(()=>void pollFoundationJobs(),1500);
  globalThis.ComfyComic.foundation={request:foundationRequest,submitQueue:submitFoundationQueue,poll:pollFoundationJobs};
}

async function foundationCancelForBooks(ids){
  if(foundationRuntime.submitting&&state.queue.some(q=>ids.includes(q.bookId)&&q.serverAwaitingRelease&&!q.serverId))throw Error('此任务正在提交服务端，请等待提交完成后再删除。');
  for(const q of state.queue.filter(q=>ids.includes(q.bookId))){
    if(q.serverState==='unknown')throw Error('请先核对结果未确认的任务或明确放弃跟踪，再删除画册。');
    if(!q.serverId)continue;
    const job=await foundationRequest('jobs/'+q.serverId);
    if(['running','unknown'].includes(job.state))throw Error('服务端仍有运行中或结果未确认的任务，请先处理后删除。');
    if(['pending','paused'].includes(job.state)){const stopped=await foundationRequest('jobs/'+q.serverId,{action:'cancel'});if(stopped.state==='running')throw Error('确认期间任务已开始；已请求停止后续分镜，请等待当前结果后删除。')}
  }
}
async function openFoundationJobs(id=null){
  const data=id?{jobs:[await foundationRequest('jobs/'+id)]}:await foundationRequest('jobs');
  const statuses={pending:'等待',paused:'暂存',running:'执行中',complete:'完成',failed:'失败',unknown:'结果未确认',canceled:'已停止',archived:'已归档'};
  modal('全部服务端任务',`<p class="help">包含界面及外部客户端任务。${data.paused?'调度已暂停':'调度运行中'}；当前上游请求可能继续计费。列表最多显示 2,000 项。</p><div style="max-height:60vh;overflow:auto;overflow-wrap:anywhere">${data.jobs.map(job=>{const actions=job.state==='pending'?['pause','cancel']:job.state==='paused'?['resume','cancel']:job.state==='running'?['cancel']:job.state==='failed'?['continue','archive']:job.state==='canceled'&&job.cursor<job.total?['continue','archive']:job.state==='unknown'?['continue',...(job.frameStates.some(f=>f.state==='unknown'&&f.provider==='comfyui'&&f.upstream)?['reconcile']:[]),'abandon']:['archive'];return `<details style="margin:12px 0"><summary>${esc(job.label||job.id)} · ${esc(statuses[job.state]||job.state)} · ${job.cursor}/${job.total}</summary><code>${esc(job.id)}</code><p>${esc(job.provider)} ${job.upstream?'· '+esc(job.upstream):''}</p>${job.error?`<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(job.error.message)}</pre>`:''}<div class="row wrap">${!id?btn('查看结果 / 原始错误','eye','foundation-job-detail',`data-job="${esc(job.id)}"`,'small'):''}${actions.map(action=>btn(({pause:'暂存',resume:'继续',cancel:'停止后续',reconcile:'核对已有结果',abandon:'放弃跟踪',archive:'归档',continue:'从未完成幕继续（原任务）',retry:'重试失败分镜（不自动解除全局暂停）'})[action],'','foundation-job-control',`data-job="${esc(job.id)}" data-operation="${action}"`,'small')).join('')}</div>${job.requestHistory?.length?`<details><summary>实际请求输入 · 最近 ${job.requestHistory.length} 次</summary>${job.requestHistory.map(a=>`<details class="log-request"><summary>第 ${(job.frameIndices?.[a.index]??a.index)+1} 幕 · 本幕第 ${a.attempt} 次尝试 · ${esc(a.config?.model||a.config?.provider||'')} · ${esc(new Date(a.time*1000).toLocaleTimeString())}</summary><p class="help">本次准备发送的实际输入，不代表上游已受理或未计费。</p><pre>${esc(JSON.stringify(a,null,2))}</pre></details>`).join('')}</details>`:''}${job.revisions?.length?`<details><summary>输入修订历史 · ${job.revisions.length} 次</summary>${job.revisions.slice(-10).map(r=>`<section><h4>${esc(new Date(r.time*1000).toLocaleString())}</h4>${r.changes.slice(0,20).map(c=>`<p>第 ${(job.frameIndices?.[c.index]??c.index)+1} 幕 · ${esc(c.field)}</p><pre style="white-space:pre-wrap;max-height:160px;overflow:auto">修改前：${esc(c.before.slice(0,2000))}\n修改后：${esc(c.after.slice(0,2000))}</pre>`).join('')}</section>`).join('')}<p class="help">这里显示最近 10 次的文本摘要，完整记录可通过任务 API 读取。</p></details>`:''}${job.errors?.length?`<details><summary>最近失败记录 · ${job.errors.length} 条</summary>${job.errors.map(e=>`<pre style="white-space:pre-wrap;overflow-wrap:anywhere">第 ${(job.frameIndices?.[e.index]??e.index)+1} 幕 · 第 ${e.attempt} 次尝试 · ${esc(new Date(e.time*1000).toLocaleString())}\n${esc(e.message)}${e.truncated?'\n（历史摘要已截断）':''}</pre>`).join('')}</details>`:''}${job.results.flatMap(r=>r.artifacts||[{url:r.image}]).map(a=>`<p><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url)}</a></p>`).join('')}</details>`}).join('')||'<p>暂无任务。</p>'}</div><div class="modal-footer">${btn('刷新','refresh','foundation-jobs')}${btn('关闭','','close-modal')}</div>`);
}

function queuePolicyHTML(){
  const p=foundationRuntime.failurePolicy,name={pause:'失败暂停本任务',retry:'有限重试',continue:'失败幕保留，其他分镜继续'}[p.mode];
  return `<details class="queue-policy" id="queue-policy"><summary>失败策略 <strong>${esc(name)}</strong><span>调整策略</span></summary><p class="help">自动重试按幕计数，保存后生效。失败或暂停的任务会自动让出顺序位置，不必手动放行其他画册。没有明确 HTTP 状态的未知结果不会被悄悄重发。</p><div class="grid2">${field('发生明确失败时',`<select id="queue-policy-mode">${opt('pause','暂停本任务后续分镜，不影响其他任务',p.mode)}${opt('retry','自动重试 5xx（默认），耗尽后按下方策略处理',p.mode)}${opt('continue','不自动重试，保留失败幕并继续其他分镜',p.mode)}</select>`)}${field('重试耗尽 / 不可自动重试时',`<select id="queue-policy-exhausted" ${p.mode==='retry'?'':'disabled'}>${opt('pause','暂停本任务',p.onExhausted)}${opt('continue','保留失败幕，其他分镜继续',p.onExhausted)}</select>`)}${field('每幕自动重试上限（1–100）',`<input id="queue-policy-count" ${p.mode==='retry'?'':'disabled'} type="number" min="1" max="100" step="1" value="${p.maxRetries}">`)}${field('每次重试前等待秒数（5–300）',`<input id="queue-policy-delay" ${p.mode==='retry'?'':'disabled'} type="number" min="5" max="300" step="1" value="${p.delaySeconds}">`)}</div><p class="help">所有 HTTP 5xx 可自动重试；4xx 不自动重试。422 标记并跳过，继续后面的分镜。此上限只限制自动重试，手动重试无次数上限。</p>${btn('应用失败策略','check','queue-policy-save','','small')}<span class="help" id="queue-policy-feedback" role="status"></span></details>`;
}
async function saveQueuePolicy(){
  const policy={mode:$('#queue-policy-mode').value,onExhausted:$('#queue-policy-exhausted').value,maxRetries:Number($('#queue-policy-count').value),delaySeconds:Number($('#queue-policy-delay').value)};
  if(!Number.isInteger(policy.maxRetries)||policy.maxRetries<1||policy.maxRetries>100||!Number.isInteger(policy.delaySeconds)||policy.delaySeconds<5||policy.delaySeconds>300)throw Error('自动重试次数须为 1–100 的整数；等待时间须为 5–300 秒的整数。');
  if(policy.mode==='retry'&&!await confirmAction('启用可能产生额外费用的重试？',`每幕最多额外请求 ${policy.maxRetries} 次，每次等待 ${policy.delaySeconds} 秒。即使接口报错，也可能已经计费。结果不明不自动重发。此策略用于整个服务端队列。`,'确认启用有限重试'))return;
  const data=await foundationRequest('jobs/scheduler',{action:'policy',policy});foundationRuntime.failurePolicy=data.failurePolicy;$('#queue-policy').outerHTML=queuePolicyHTML();$('#queue-policy').open=true;$('#queue-policy-feedback').textContent=' 已保存到服务端';await pollFoundationJobs();
}
function queueNextFrame(q){return (q.serverIndices||q.indices)?.[q.serverNextIndex??q.serverCursor??q.done]??q.indices?.[q.done]}
function queueCanContinue(q){return !!q.serverId&&!q.serverRunningCount&&(['failed','unknown','canceled','paused'].includes(q.serverState)||q.serverReadyAt>0)&&Number.isInteger(queueNextFrame(q))}
async function retryQueueTask(id){
  const q=state.queue.find(q=>q.id===id);if(!q?.serverId)throw Error('此任务没有当前服务的任务 ID，请先核对来源。');
  return continueServiceJob(q.serverId,q);
}
async function continueServiceJob(id,q=null){
  q=q||state.queue.find(item=>item.serverId===id);
  let job=await foundationRequest('jobs/'+id);
  if(job.state==='pending'&&job.ready_at){job=await foundationRequest('jobs/'+id,{action:'hold'})}
  if(!['failed','unknown','canceled','paused'].includes(job.state)||job.cursor>=job.total)throw Error('任务不是可继续的停止状态，请刷新进度。');
  const index=(q?.serverIndices||q?.indices||job.frameIndices)[job.nextIndex];
  if(!Number.isInteger(index))throw Error('分镜索引不完整，已阻止从第一幕重新开始。');
  const unresolved=job.frameStates.filter(f=>f.state!=='complete'),numbers=unresolved.map(f=>(q?.serverIndices||q?.indices||job.frameIndices)[f.index]+1),unknown=unresolved.some(f=>f.state==='unknown'||f.error&&['result_unconfirmed','persistence_unconfirmed'].includes(f.error.kind));
  const message=`已确认 ${job.cursor} / ${job.total} 幕，可能并非连续前缀。仅处理第 ${numbers.slice(0,40).join('、')}${numbers.length>40?'…':''} 幕；所有已完成幕均保留，不新建画册。每本独立维持 ${foundationRuntime.runtime.concurrency} 并发，此任务可与其他已启动任务同时执行。${unknown?'包含结果未确认的请求，上游可能已经计费，再次发送可能重复扣费。':'请求可能产生费用。'}将恢复全局调度。`;
  if(!await confirmAction(unknown?'确认风险并继续未完成分镜？':'继续原任务的未完成分镜？',message,'继续 '+numbers.length+' 幕'))return;
  await foundationRequest('jobs/'+id,{action:'continue',recovery:{expectedCursor:job.cursor,expectedUpdated:job.updated,acknowledgeUnconfirmed:unknown}});
  await runQueue();await foundationRequest('jobs/scheduler',{action:'resume'});await pollFoundationJobs();
}
function queueRuntimeHTML(){
  const r=foundationRuntime.runtime;
  return `<section class="queue-runtime queue-toolbar" id="queue-runtime" aria-label="队列运行设置"><div class="queue-toolbar-status"><i class="queue-status-dot"></i><span id="queue-runtime-count">${foundationRuntime.runtimeLoaded?`${foundationRuntime.runningCount} 个请求 · 每任务上限 ${r.concurrency}`:'读取运行配置…'}</span></div><div class="queue-inline-settings"><label for="queue-concurrency">每任务并发</label><input id="queue-concurrency" type="number" min="1" max="16" step="1" value="${r.concurrency}" aria-label="每任务分镜并发数"><label for="queue-timeout">超时 / 秒</label><input id="queue-timeout" type="number" min="30" max="7200" step="1" value="${r.requestTimeoutSeconds}" aria-label="请求超时秒数">${btn('保存','check','queue-runtime-save',foundationRuntime.runtimeLoaded?'':'disabled','small')}</div><div class="queue-toolbar-secondary">${btn('恢复暂存','play','queue-release-held','','small ghost')}<details class="queue-scheduler-info"><summary>调度详情</summary><div><p>每任务独立补位；另开任务需手动并行启动。降低并发不打断在途请求。</p><p id="queue-diagnostics" role="status">${esc(foundationRuntime.diagnostics||'读取调度状态…')}</p></div></details></div><span id="queue-runtime-feedback" class="help" role="status"></span></section>`;
}
async function saveQueueRuntime(){
  const runtime={concurrency:Number($('#queue-concurrency').value),requestTimeoutSeconds:Number($('#queue-timeout').value)};
  if(!Number.isInteger(runtime.concurrency)||runtime.concurrency<1||runtime.concurrency>16||!Number.isInteger(runtime.requestTimeoutSeconds)||runtime.requestTimeoutSeconds<30||runtime.requestTimeoutSeconds>7200)throw Error('并发须为 1–16 的整数；超时须为 30–7200 秒的整数。');
  const data=await foundationRequest('jobs/scheduler',{action:'runtime',runtime});foundationRuntime.runtime=data.runtime;$('#queue-runtime').outerHTML=queueRuntimeHTML();$('#queue-runtime-feedback').textContent=' 已保存，下一次请求生效';
}
async function archiveDeletedBookJobs(ids){
  for(const q of state.queue.filter(q=>ids.includes(q.bookId)&&q.serverId)){
    const job=await foundationRequest('jobs/'+q.serverId);
    if(['complete','failed','canceled'].includes(job.state))await foundationRequest('jobs/'+q.serverId,{action:'archive'});
    else if(job.state!=='archived')throw Error('关联任务尚未结束，未删除画册。');
  }
}
function inspectQueueGaps(){
  const rows=state.queue.filter(q=>bookBy(q.bookId)).map(q=>({q,b:bookBy(q.bookId),missing:q.indices.filter(i=>!bookBy(q.bookId).steps.some(s=>s.stepIndex===i&&s.image))}));
  modal('检查当前队列 · 不创建任务',`<p class="help">只检查当前队列中每个任务的分镜范围，不扫描其他画册，不自动加入或执行任何任务。正在等待或执行的分镜不代表需要新建任务。</p><div class="queue-inspection">${rows.map(({q,b,missing})=>`<section><strong>${esc(b.title)}</strong><p>${q.indices.length} 幕任务 · 已有 ${q.indices.length-missing.length} 幕 · 尚未生成 ${missing.length} 幕</p>${missing.length?`<small>分镜：${missing.map(i=>i+1).join('、')}</small>`:'<small>此任务范围内已齐全。</small>'}<p>${esc(q.serverState==='unknown'?'结果不明：先核对上游，禁止盲目补齐。':q.status==='running'?'正在执行，请等待当前请求返回。':['pending','paused'].includes(q.status)?'已在队列中，无需重复添加。':q.status==='failed'?'任务失败，查看错误并决定是否重试。':'查看画册确认剩余内容。')}</p>${queueCanContinue(q)?btn('从第 '+(queueNextFrame(q)+1)+' 幕继续','refresh','queue-retry',`data-id="${esc(q.id)}"`,'small'):''}</section>`).join('')||'<p>当前队列没有任务。</p>'}</div><div class="modal-footer">${btn('关闭检查','','close-modal')}</div>`);
}

async function syncProductionActivity(result){
  const count=state=>result.jobs.filter(j=>j.state===state).length,waiting=count('pending'),held=count('paused'),failed=count('failed'),unknown=count('unknown'),running=count('running');
  const requests=result.jobs.reduce((n,j)=>n+(j.running_count||0),0),pools=result.jobs.filter(j=>j.enabled).length;
  const text=`${result.paused?'全局暂停':'调度运行'} · ${pools} 个已启动任务 · ${requests} 个在途请求 · 每任务 ${result.runtime.concurrency} 并发。待办 ${waiting} · 暂存 ${held} · 失败 ${failed} · 未确认 ${unknown}。默认顺序；卡片上的「并行启动」会额外开启一个独立请求池。`;

  foundationRuntime.diagnostics=text;if($('#queue-diagnostics'))$('#queue-diagnostics').textContent=text;
  const key=JSON.stringify([result.paused,result.runtime,requests,pools,running,waiting,held,failed,unknown]);if(key!==foundationRuntime.diagnosticKey){foundationRuntime.diagnosticKey=key;log('调度状态：'+text)}
  const events=await foundationRequest('jobs/activity?after='+foundationRuntime.activityAfter),labels={pending:'已入队',running:'开始请求',complete:'任务完成',failed:'生成失败',unknown:'结果未确认',canceled:'已停止',cancel:'立即停止，丢弃迟到结果',late_result_discarded:'已丢弃停止前请求的迟到结果',retry_wait:'等待自动重试',hold:'暂存 / 已撤销自动重试倒计时',amend:'未完成提示词已修订',continue:'继续未完成分镜',input_read:'已读取并记录本次分镜输入',frame_complete:'分镜结果已保存',start:'手动并行启动任务',runtime:'已保存每任务并发 / 超时',resume:'恢复调度 / 释放暂存',pause:'暂停',policy:'失败策略已修改'};
  for(const e of events){const q=state.queue.find(q=>q.serverId===e.jobId);if(e.index!==undefined&&(q?.serverIndices||q?.indices)?.[e.index]!==undefined)e.frameIndex=(q.serverIndices||q.indices)[e.index];foundationRuntime.activityAfter=Math.max(foundationRuntime.activityAfter,e.id);
    const title=e.label||'调度器',scene=e.frameIndex!==undefined?' · 第 '+(e.frameIndex+1)+' 幕':'',attempt=e.frameAttempt?' · 本幕第 '+e.frameAttempt+' 次尝试':'',model=e.request?.config?.model;
    let action=labels[e.state]||e.state;if(e.state==='input_read')action='输入已读取';if(e.state==='request_ready')action='请求参数已确定，准备发送';if(e.state==='running')action='取得执行名额';if(e.state==='skipped')action='已跳过：HTTP 422';
    if(e.state==='retry_wait')action='请求失败，'+new Date(e.retryAt*1000).toLocaleTimeString()+' 自动重试（已安排第 '+e.retryCount+' 次自动重试）';
    const message=title+scene+' · '+action+attempt+(model?' · 模型 '+model:'')+(['input_read','request_ready'].includes(e.state)?' · 等待上限 '+e.timeout+' 秒':'')+(e.error?'\n'+e.error.message:'');
    const attemptKey=e.jobId+':'+e.index+':'+e.frameAttempt,entry={time:e.time*1000,level:e.error?'error':'info',message,request:e.request,eventId:e.id,attemptKey};
    const previous=e.state==='request_ready'?rt.logs.findIndex(x=>x.attemptKey===attemptKey&&x.request):-1;if(previous>=0)rt.logs[previous]=entry;else rt.logs.push(entry);
  }
  if(rt.logs.length>1000)rt.logs.splice(0,rt.logs.length-1000);if(events.length)renderLogs();
}
async function releaseHeldTasks(){
  const data=await foundationRequest('jobs'),held=data.jobs.filter(j=>j.state==='paused'&&state.queue.some(q=>q.serverId===j.id));
  if(!held.length){await pollFoundationJobs();return toast('没有暂存画册。失败或停止的任务请在各自卡片确认继续；并发不会自动重发它们。')}
  if(!await confirmAction('释放 '+held.length+' 本暂存画册？','这些任务恢复到顺序队列，并不会一起并行启动。需要并行时，在对应卡片手动启动。不会重发失败、未知或停止的分镜。','释放并执行'))return;
  for(const j of held)await foundationRequest('jobs/'+j.id,{action:'resume'});
  await runQueue();await foundationRequest('jobs/scheduler',{action:'resume'});await pollFoundationJobs();
}
// The existing storyboard editor writes a task-local saved input, not a second editor.
function liveStoryboardTask(plan){const bound=state.queue.find(q=>q.id===createUI.liveTaskId&&q.planId===plan?.id&&bookBy(q.bookId)?.sourceSnapshot);if(bound)return bound;return state.queue.filter(q=>q.planId===plan?.id&&q.done<q.indices.length&&bookBy(q.bookId)?.sourceSnapshot).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0]}
function liveStoryboardFrame(plan,frame){const q=createUI.sceneScope==='plan'?liveStoryboardTask(plan):null;return q?.frames.find(f=>f.id===frame?.id)}
function saveLiveStoryboardFrame(plan,frame){
  const q=liveStoryboardTask(plan);if(!q)return;const index=q.frames.findIndex(f=>f.id===frame.id);if(index<0)return;
  const source=bookBy(q.bookId).sourceSnapshot;source.frames[index]=clone(frame);source.liveInputs??={};
  const fresh=clone(frame);delete fresh._imageInputs;delete fresh._resolvedImagePrompt;delete fresh._resolvedImageNegative;
  try{source.liveInputs[index]={input:foundationFrameInput(fresh,q.rowSnapshot||source.row,q.bookId,index),savedAt:Date.now()}}
  catch(e){source.liveInputs[index]={error:e.message,savedAt:Date.now()}}
}
function liveStoryboardNotice(plan){const q=liveStoryboardTask(plan);return q?`<p class="help">本册修改作用于「${esc(bookBy(q.bookId).title)}」的这个画册版本，不会自动跳到较早任务。保存成功后，尚未发送的分镜自动读取；在途请求不变，已完成图片不重画。共享模板不影响已入队画册。</p>`:''}

function queueErrorSummary(q){
  if(/content violates|content.policy|request rejected|\[422\]|内容审核|内容违规/i.test(q.error||''))return '上游拒绝了当前内容。请在原分镜编辑区修改本册内容，保存后再确认继续。';
  if(q.serverState==='canceled')return '已停止。已确认图片保留，停止前请求的迟到结果不再采纳。';
  if(q.serverState==='unknown')return '结果未确认。先核对上游，或确认当前幕可能重复计费的风险后继续。';
  if(q.serverReadyAt)return '上游暂时失败，正在等待有限重试。现在即可编辑或手动继续，无需等倒计时结束。';
  return (q.error||'').slice(0,150);
}

async function startParallelTask(id){
  let q=state.queue.find(q=>q.id===id);if(!q)return;
  if(!q.serverId){await runQueue();q=state.queue.find(q=>q.id===id)}
  if(!q?.serverId)throw Error('请先完成任务提交。');
  const job=await foundationRequest('jobs/'+q.serverId);
  if(job.state==='running'||job.enabled&&!job.blocked)return toast('这个任务已启动，无需再次启动。');
  const data=await foundationRequest('jobs'),other=data.jobs.filter(j=>j.enabled&&j.id!==job.id).length,n=data.runtime.concurrency;
  if(!await confirmAction('手动并行启动这个任务？',`本任务最多 ${n} 个分镜请求，独立于其他 ${other} 个已启动任务；合计最多 ${(other+1)*n} 个请求。结果按原幕号保存，可能产生费用。会恢复全局调度。`,'并行启动'))return;
  await foundationRequest('jobs/'+job.id,{action:'start',recovery:{expectedCursor:job.cursor,expectedUpdated:job.updated}});await foundationRequest('jobs/scheduler',{action:'resume'});await pollFoundationJobs();
}
function queuePoolLabel(q){
  const running=(q.serverFrameStates||[]).filter(f=>f.state==='running').map(f=>(q.serverIndices||q.indices)[f.index]+1);
  return running.length?`生成第 ${running.join('、')} 幕 · ${running.length} / ${foundationRuntime.runtime.concurrency} 并发`:'正在请求分镜';
}
function queueFrameStatesHTML(q){
  if(!q.serverFrameStates?.length)return '';
  const labels={complete:'完成',running:'生成中',pending:'待执行',failed:'失败',unknown:'未确认',canceled:'停止',skipped:'已跳过 · 422'};
  return `<details class="task-frame-states"><summary>逐幕状态 · 已完成 ${q.done} · 正在请求 ${q.serverRunningCount||0}</summary><div>${q.serverFrameStates.map(f=>`<span data-state="${f.state}" title="第 ${(q.serverIndices||q.indices)[f.index]+1} 幕：${labels[f.state]}${f.ready_at?' · 等待重试':''}">${(q.serverIndices||q.indices)[f.index]+1}<small>${labels[f.state]}</small></span>`).join('')}</div></details>`;
}

function prepareLiveStoryboard(plan){const q=liveStoryboardTask(plan);if(q&&createUI.liveTaskId!==q.id){createUI.liveTaskId=q.id;createUI.sceneScope='plan'}}
function storyboardScopeHTML(p,t,own){const q=liveStoryboardTask(p),selected=own?(q?'task:'+q.id:'plan'):'shared',tasks=state.queue.filter(x=>x.planId===p.id&&bookBy(x.bookId)?.sourceSnapshot&&(x.done<x.indices.length||x.id===q?.id));return `<div class="field"><label class="label" for="v3-scene-scope">修改范围</label><select id="v3-scene-scope">${opt('shared','修改共享分镜模板',selected)}${p.templateId===t?.id&&!tasks.length?opt('plan','仅修改当前画册这一幕',selected):''}${tasks.map(x=>opt('task:'+x.id,'画册：'+bookBy(x.bookId).title+' · '+new Date(x.createdAt).toLocaleTimeString(),selected)).join('')}</select>${liveStoryboardNotice(p)}</div>`}

function liveStoryboardPreview(p,f){try{const q=liveStoryboardTask(p),live=liveStoryboardFrame(p,f);if(!live)return quietResolvedPrompt(p,f);const index=q.frames.indexOf(live),entry=bookBy(q.bookId).sourceSnapshot.liveInputs?.[index];return esc(entry?.error||entry?.input?.prompt||foundationFrameInput(live,q.rowSnapshot,q.bookId,index).prompt)}catch(e){return esc(e.message)}}

function queueChannelLabel(q){const channels=q.serverChannels;if(!channels?.length)return '读取已保存渠道…';return channels.map(c=>c.available?`${c.title||c.provider} / ${c.model||'工作流'}`:'渠道配置需处理').join(' · ')}
