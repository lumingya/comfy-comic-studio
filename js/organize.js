/* Ordered production queue and collection context tools. Classic script. */
'use strict';

function missingArtworkHTML(label='尚未生成',attributes=''){
  const extra=attributes.match(/class="([^"]*)"/)?.[1]||'';
  return `<span class="artwork-missing ${esc(extra)}" role="img" aria-label="${esc(label)} · 暂无画面" ${attributes.replace(/class="[^"]*"/g,'')}><span aria-hidden="true">?</span><small>暂无画面</small></span>`;
}

function missingArtworkElement(img){
  const holder=document.createElement('template');holder.innerHTML=missingArtworkHTML(img.alt||'图片未加载');const el=holder.content.firstElementChild;
  for(const a of img.attributes)if(a.name.startsWith('data-')||a.name==='id')el.setAttribute(a.name,a.value);
  el.classList.add(...img.classList);el.classList.remove('artwork-loaded');return el;
}

function queueControlsHTML(){
  const waiting=state.queue.some(q=>q.status==='pending'||q.serverAwaitingRelease),running=rt.running;
  return `${btn(rt.paused?'继续执行':running?'暂停调度':'暂停队列',rt.paused?'play':'pause','org-queue-pause','','small')}${!running&&waiting&&!rt.paused?btn('执行待办','play','org-queue-run','','small'):''}${btn('中止','stop','interrupt',!running&&!waiting?'disabled':'','small')}`;
}

function renderCompactQueue(){
  return `<section class="compact-production">${queueComposerHTML()}<div class="queue-section-heading"><div><h2>生成队列</h2><p>按顺序生成 · 拖动待办排序 · 每任务独立并发</p></div><div class="row" id="queue-controls">${queueControlsHTML()}</div></div>${queueRuntimeHTML()}${queuePolicyHTML()}<div class="ordered-queue" id="queue-list">${renderOrderedQueue()}</div><div class="queue-footer">${btn('检查当前队列','refresh','scan-resume','','small')}${btn('服务端任务','list','foundation-jobs','','small ghost')}${btn('查看运行日志','terminal','v3-nav','data-route="logs"','small ghost')}<span>删除会移除任务及对应画册；磁盘素材不立即永久删除</span></div></section>`;
}

function taskWorkflowHTML(q){
  if(!q.frames?.length||q.serverInput||q.serverId)return '';
  const editable=q.indices.filter((i,pos)=>{const ex=q.frames[i]?._execution||q.execution;return (!ex?.provider||ex.provider==='comfyui')&&(q.status==='pending'||['running','paused'].includes(q.status)&&pos>q.done)});if(!editable.length)return '';
  return `<details class="quiet-advanced queue-workflow-detail" data-task-detail="${esc(q.id)}"><summary>待发送工作流调整</summary>${editable.map((i,pos)=>{
    const f=q.frames[i],ex=f?._execution||q.execution,locked=!!q.serverInput||!!q.serverId||q.status!=='pending'&&(!['running','paused'].includes(q.status)||pos<=q.done);
    if(ex?.provider&&ex.provider!=='comfyui')return `<div class="queue-workflow-row"><span>${i+1}. ${esc(f?.name||'分镜')}</span><span class="tiny muted">${esc(ex.provider)} · ${esc(ex.config?.model||'渠道快照')}</span><span class="tiny muted">初始值 · 非当前配置</span></div>`;
    return `<div class="queue-workflow-row"><span>${i+1}. ${esc(f?.name||'分镜')}</span><span class="tiny muted">${esc(ex?.workflowTitle||'默认工作流')}</span><select data-ws-task="${esc(q.id)}" data-ws-index="${i}" aria-label="第 ${i+1} 幕任务工作流" ${locked?'disabled':''}>${opt('','保留当前快照','')}${state.settings.comfy.presets.map(p=>opt(p.id,p.title,'')).join('')}</select></div>`;
  }).join('')}</details>`;
}

function renderOrderedQueue(){
  const tasks=state.queue.filter(q=>bookBy(q.bookId)),pending=tasks.filter(q=>q.status==='pending'&&(q.done||0)===0&&!q.serverAttempts);
  if(!tasks.length)return `<div class="queue-empty"><span class="queue-empty-symbol">≡</span><strong>还没有生成任务</strong><p>选择范围加入队列，按顺序开始。</p></div>`;
  return tasks.map((q,i)=>{
    const b=bookBy(q.bookId),active=q.status==='running',movable=q.status==='pending'&&(q.done||0)===0&&!q.serverAttempts,pos=pending.indexOf(q),pct=q.indices.length?Math.round(q.done/q.indices.length*100):100;
    const statuses={pending:rt.paused?'等待恢复':'排队中',running:'生成中',paused:'已暂存',complete:'已完成',canceled:'已停止',failed:'需要处理'};
    return `<article class="ordered-task queue-card ${active?'is-running':q.serverReadyAt&&['pending','paused'].includes(q.status)?'is-retrying':''}" data-sort-task="${esc(q.id)}" draggable="${movable}" aria-label="任务 ${i+1}：${esc(b.title)}"><div class="ordered-task-main"><span class="task-drag-handle" title="${movable?'拖动排序':'执行顺序已固定'}">${movable?'⠿':'·'}</span><span class="task-position">${pad(i+1)}</span><div class="ordered-queue-thumb">${imgTag(coverImage(b),b.title,`data-book="${esc(b.id)}"`)}</div><div class="task-title"><strong>${esc(b.title)}</strong><div class="queue-card-meta"><span>${q.done} / ${q.indices.length} 幕</span><span class="queue-state">${esc(q.serverState==='unknown'?'结果未确认':statuses[q.status]||q.status)}</span>${active?`<span class="task-live-badge" role="status"><i></i>${queuePoolLabel(q)}</span>`:''}</div></div><div class="task-actions">${ibtn('up','org-task-up','任务上移',`data-id="${esc(q.id)}" ${!movable||pos===0?'disabled':''}`)}${ibtn('down','org-task-down','任务下移',`data-id="${esc(q.id)}" ${!movable||pos===pending.length-1?'disabled':''}`)}${ibtn('book','read','查看画册',`data-id="${esc(b.id)}"`)}${btn(active?'停止并删除':'删除','trash','org-task-delete',`data-id="${esc(q.id)}"`,'small ghost danger')}</div></div><div class="queue-card-body"><div class="task-mini-progress" aria-label="进度 ${pct}%"><i style="width:${pct}%"></i></div><div class="queue-channel-line"><span>下次请求</span><strong>${esc(queueChannelLabel(q))}</strong></div>${q.error||q.serverFailureLimit?`<p class="task-error-summary">${esc(queueErrorSummary(q).slice(0,220))}</p>`:''}${q.serverReadyAt?`<p class="task-retry-badge">额外重试 ${q.serverRetries} · ${rt.paused||q.status==='paused'?'已暂停':new Date(q.serverReadyAt*1000).toLocaleTimeString()+' 后执行'}</p>`:''}<div class="task-recovery-actions">${q.serverId&&(q.serverActions?q.serverActions.includes('start'):['pending','paused'].includes(q.serverState)&&!q.serverEnabled&&!q.serverReadyAt)?btn('并行启动','play','queue-start-parallel',`data-id="${esc(q.id)}"`,'small'):''}${active&&q.serverId?btn('立即停止','stop','queue-stop-task',`data-id="${esc(q.id)}"`,'small'):''}${queueCanContinue(q)?btn('继续未完成分镜','refresh','queue-retry',`data-id="${esc(q.id)}"`,'small'):''}${q.serverId?btn('请求记录','list','foundation-job-detail',`data-job="${esc(q.serverId)}"`,'small ghost'):''}</div></div><details class="queue-card-details"><summary>任务详情 <span>逐幕状态与原始响应</span></summary>${q.error?`<details class="queue-error-detail"><summary>错误详情（原始响应）</summary><pre>${esc(q.error)}</pre></details>`:''}${queueFrameStatesHTML(q)}${taskWorkflowHTML(q)}</details></article>`;
  }).join('');
}

function moveOrderedId(order,source,target,after=false){
  if(source===target||!order.includes(source)||!order.includes(target))return [...order];
  const next=order.filter(id=>id!==source),index=next.indexOf(target);next.splice(index+(after?1:0),0,source);return next;
}

function reorderPendingTask(source,target,after=false){
  const pending=state.queue.filter(q=>q.status==='pending'&&(q.done||0)===0&&!q.serverAttempts),ids=pending.map(q=>q.id);
  if(!ids.includes(source)||!ids.includes(target))throw Error('只能调整尚未开始的任务；运行中的任务位置已锁定。');
  const next=moveOrderedId(ids,source,target,after).map(id=>pending.find(q=>q.id===id));let index=0;
  // Preserve the actual running task object, including its loop cursor.
  state.queue=state.queue.map(q=>q.status==='pending'&&(q.done||0)===0&&!q.serverAttempts?next[index++]:q);syncFoundationOrder();save();updateQueueUI();
}

async function deleteQueuedTask(id){
  const q=state.queue.find(q=>q.id===id);if(!q)return;
  return deleteBooks([q.bookId]);
}

function manualBookIds(projectId=state.activeProjectId){
  const books=state.books.filter(b=>b.projectId===projectId),live=new Set(books.map(b=>b.id));
  const stored=state.settings.presentation.bookOrder?.[projectId]||[];
  return [...new Set([...stored.filter(id=>live.has(id)),...books.map(b=>b.id)])];
}

function reorderCollectionBook(source,target,after=false){
  const a=bookBy(source),b=bookBy(target);if(!a||!b||a.projectId!==state.activeProjectId||b.projectId!==a.projectId)throw Error('只能调整当前画册集内的顺序。');
  let order=manualBookIds();
  if(ui.sort!=='manual'){
    const displayed=getShelfBooks().map(x=>x.id),set=new Set(displayed);let i=0;
    order=order.map(id=>set.has(id)?displayed[i++]:id);
  }
  state.settings.presentation.bookOrder??={};state.settings.presentation.bookOrder[a.projectId]=moveOrderedId(order,source,target,after);
  state.settings.presentation.collectionSort='manual';ui.sort='manual';save();render();
}

function bookOrderListHTML(){
  const books=getShelfBooks();return books.map((b,i)=>`<div class="book-order-chip" data-sort-book="${esc(b.id)}" draggable="true" tabindex="0" aria-label="拖动排序：${esc(b.title)}"><span aria-hidden="true">⠿</span><span class="mono">${i+1}</span><span class="grow">${esc(b.title)}</span>${ibtn('up','org-book-up','画册前移',`data-id="${esc(b.id)}" ${i===0?'disabled':''}`)}${ibtn('down','org-book-down','画册后移',`data-id="${esc(b.id)}" ${i===books.length-1?'disabled':''}`)}</div>`).join('');
}

function refreshCollectionSelection(){
  document.querySelectorAll('[data-sort-book]').forEach(el=>{const chosen=ui.selected.has(el.dataset.sortBook);el.classList.toggle('is-selected',chosen);});
  if($('.book-order-list'))$('.book-order-list').innerHTML=bookOrderListHTML();
}

function closeBookContext(restoreFocus=false){if(typeof closeContextMenu==='function')closeContextMenu(restoreFocus)}

function bookContextBusy(ids){return ids.some(key=>bookBy(key)?.inProgress||[...rt.redraw].some(k=>k.startsWith(key+':')))}

/* Menu for one album: primary actions first, export/organize folded into submenus, destructive action last. */
function singleBookContextItems(book){
  const id=book.id,shelf=getShelfBooks().map(b=>b.id),index=shelf.indexOf(id),busy=bookContextBusy([id]),missing=missingIndices(book).length,data={ids:JSON.stringify([id])};
  const exporters=typeof mioExporterList==='function'?mioExporterList():[];
  const extension=typeof contextMenuExtensionItems==='function'?contextMenuExtensionItems('album',{id}):[];
  return [
    {label:'翻开这本画册',icon:'book',act:'read',data:{id},primary:true,shortcut:'Enter'},
    {label:book.liked?'取消星标':'星标收藏',icon:'star',act:'star',data:{id},checked:!!book.liked},
    {label:'重命名…',icon:'edit',act:'org-context-edit',data,disabled:busy,title:busy?'画册正在生成，稍后再改名。':''},
    {label:'补齐缺失分镜',icon:'refresh',act:'resume',data:{id},disabled:!missing,hint:missing?`${missing} 幕待补齐，已完成画面不重跑`:'所有分镜已齐备'},
    '-',
    {label:'导出与分享',icon:'download',children:[
      {label:'导出离线画册…',icon:'download',act:'org-context-export',data,hint:'单文件 HTML，可选版式与水印'},
      {label:'分享画册源文件…',icon:'upload',act:'native-export',data:{kind:'albums',id},hint:'可在另一间工作室导入，不含服务密钥'},
      exporters.length?'-':null,
      ...exporters.map(e=>({label:'导出 · '+e.label,icon:'box',act:'mio-export',data:{exporter:e.id,id},hint:e.runtime==='browser'?'浏览器生成':'后端打包'}))
    ]},
    {label:'整理',icon:'list',children:[
      {label:'向前移动',icon:'up',act:'org-context-up',data,disabled:index<=0},
      {label:'向后移动',icon:'down',act:'org-context-down',data,disabled:index<0||index===shelf.length-1},
      '-',
      {label:'选择当前筛选结果',icon:'check',act:'org-context-select-all',shortcut:'Ctrl/⌘ A',hint:'拖动框选或 Ctrl / ⌘ 点击也可多选'}
    ]},
    extension.length?'-':null,
    ...extension,
    '-',
    {label:busy?'停止并删除画册…':'删除画册…',icon:'trash',act:'org-context-delete',data,danger:true}
  ];
}

function multiBookContextItems(ids,focusId=''){
  const busy=bookContextBusy(ids),data={ids:JSON.stringify(ids)},focus=bookBy(focusId);
  return [
    {type:'label',label:`对这 ${ids.length} 本画册`},
    {label:'批量星标',icon:'star',act:'org-context-star',data},
    {label:'批量重命名…',icon:'edit',act:'org-context-edit',data,disabled:busy,title:busy?'有画册正在生成，稍后再改名。':''},
    {label:'导出离线画册…',icon:'download',act:'org-context-export',data,hint:'合并为一个离线 HTML'},
    {label:'补齐缺失分镜',icon:'refresh',act:'org-context-resume',data,disabled:!ids.some(id=>missingIndices(bookBy(id)||{steps:[],totalSteps:0}).length),hint:'只重跑缺失的分幕'},
    '-',
    focus?{label:'只翻开这本',icon:'book',act:'read',data:{id:focus.id},hint:focus.title}:null,
    {label:'选择当前筛选结果',icon:'check',act:'org-context-select-all',shortcut:'Ctrl/⌘ A'},
    {label:'取消选择',icon:'close',act:'org-context-clear',shortcut:'Esc'},
    '-',
    {label:busy?'停止并批量删除…':'批量删除…',icon:'trash',act:'org-context-delete',data,danger:true,shortcut:'Delete'}
  ];
}

/* Right-click never re-renders the shelf: the card only gets a highlight class, so nothing shifts under the pointer.
   With Ctrl / ⌘ the card joins the current selection; otherwise an existing multi-selection containing the card is kept. */
function openBookContext(id,x,y,extend=false){
  const b=bookBy(id);if(!b||b.projectId!==state.activeProjectId)return;
  ui.selected=new Set([...ui.selected].filter(key=>bookBy(key)?.projectId===state.activeProjectId));
  if(extend){ui.selected.add(id);ui.bulk=true;syncSelectionView()}
  else if(!ui.selected.has(id)&&ui.selected.size){exitBookSelection();syncSelectionView()}
  const multi=ui.selected.has(id)&&ui.selected.size>1,ids=multi?[...ui.selected]:[id];
  const card=document.querySelector(`[data-sort-book="${CSS.escape(id)}"]:not(.book-order-chip)`)||document.querySelector(`[data-sort-book="${CSS.escape(id)}"]`);
  card?.classList.add('is-context');
  const missing=missingIndices(b).length;
  openContextMenu({x,y,label:'画册右键菜单',focusEl:card,
    title:multi?`已选择 ${ids.length} 本画册`:b.title,
    subtitle:multi?'Ctrl / ⌘ + 右键可继续加选 · Esc 取消选择':[`${b.totalSteps} 幕`,b.characterName,missing?`${missing} 幕待补齐`:'已齐备'].filter(Boolean).join(' · '),
    items:multi?multiBookContextItems(ids,id):singleBookContextItems(b),
    onClose:()=>card?.classList.remove('is-context')});
}

/* ---- Selection model ---------------------------------------------------------------------------
   Plain clicks always open an album. Multi-select has one entry point — the desktop gestures in
   desktop-selection.js (marquee, Ctrl / ⌘ + click, Shift + click, Ctrl / ⌘ + A) — and the selection itself
   is the mode: `ui.bulk` simply mirrors `ui.selected.size > 0`. `ui.bulkPinned` only exists for touch
   screens, where the toolbar toggle reveals per-card checkboxes because there is no marquee. */
function bookSelectionActive(){return !!ui.bulk||ui.selected.size>0}

function setBookSelected(id,on){
  if(!bookBy(id))return;
  if(on)ui.selected.add(id);else ui.selected.delete(id);
}

function toggleBookSelected(id){setBookSelected(id,!ui.selected.has(id))}

/* Leave an implicit multi-select once nothing is selected; keep an explicitly pinned mode. */
function settleSelectionMode(){
  if(!ui.selected.size&&ui.bulk&&!ui.bulkPinned)ui.bulk=false;
  if(!ui.bulk)ui.bulkPinned=false;
}

function exitBookSelection(){ui.selected.clear();ui.bulk=false;ui.bulkPinned=false}

/* Keep the shelf in sync without rebuilding it: per-card classes and checkboxes plus the bulk bar counters
   are patched in place, and the shelf is only re-rendered when the bulk bar has to appear or disappear
   (that also swaps the toolbar button state and the per-card checkboxes). */
function syncSelectionView(){
  if(ui.workspace!==0)return;
  const boxes=!!$('#gallery-results [data-select-book]');
  if(boxes!==!!ui.bulkPinned){refreshGallery();return}
  syncBulkToggle();
  document.querySelectorAll('#gallery-results [data-sort-book]').forEach(card=>{
    const on=ui.selected.has(card.dataset.sortBook);card.classList.toggle('is-selected',on);card.setAttribute('aria-selected',String(on));
    const box=card.querySelector('[data-select-book]');if(box&&box.checked!==on)box.checked=on;
  });
  const status=$('#gallery-results .shelf-selection-status');if(status){status.textContent=ui.selected.size?localeString('已选 {count} 本 · 右键操作',{count:ui.selected.size}):'';status.hidden=!ui.selected.size}
  $('#gallery-results')?.classList.toggle('has-selection',ui.selected.size>0);
  refreshCollectionSelection();
}

/* The toolbar toggle lives outside #gallery-results, so it is patched separately whenever the shelf refreshes. */
function syncBulkToggle(){
  const toggle=$('.collection-toolbar [data-act="toggle-bulk"]');if(!toggle||typeof shelfBulkToggle!=='function')return;
  const on=String(!!ui.bulkPinned);if(toggle.getAttribute('aria-pressed')===on)return;
  const holder=document.createElement('template');holder.innerHTML=shelfBulkToggle();const next=holder.content.firstElementChild;
  if(next){toggle.replaceWith(next);if(typeof localizeWorkspace==='function')localizeWorkspace(next)}
}

/* Open an album regardless of the selection mode; errors surface as toasts like every other action. */
function openBookFromShelf(id){
  if(!bookBy(id))return;
  Promise.resolve(handleAction('read',{id})).catch(error=>toast(error.message||'无法打开画册。','error'));
}

/* ---- Pointer drag to reorder --------------------------------------------------------------------
   Native HTML drag-and-drop on the whole card swallowed every click that drifted a few pixels, which made
   covers feel dead. Reordering now uses pointer events with an 8px activation distance: below that the
   gesture is a click (and opens the album), above it the card lifts and can be dropped on another one. */
function installShelfReorderDrag(){
  const THRESHOLD=8;let gesture=null,ghost=null,raf=0,suppressClick=false;
  const cards=()=>[...document.querySelectorAll('#gallery-results .shelf-item[data-sort-book],#gallery-results .shelf-exhibit[data-sort-book]')];
  function clearTargets(){document.querySelectorAll('#gallery-results .is-drop-target,#gallery-results .is-drop-after').forEach(el=>el.classList.remove('is-drop-target','is-drop-after'))}
  function finish(){
    cancelAnimationFrame(raf);raf=0;ghost?.remove();ghost=null;clearTargets();
    document.querySelectorAll('#gallery-results .is-dragging').forEach(el=>el.classList.remove('is-dragging'));
    document.body.classList.remove('shelf-reordering');gesture=null;
  }
  function makeGhost(card,x,y){
    const cover=card.querySelector('.shelf-cover')||card,rect=cover.getBoundingClientRect(),el=document.createElement('div');
    el.className='shelf-drag-ghost';el.setAttribute('aria-hidden','true');
    const art=cover.querySelector('img,.artwork-missing');if(art){const copy=art.cloneNode(true);copy.removeAttribute('id');copy.removeAttribute('loading');if(copy.tagName==='IMG')copy.draggable=false;el.append(copy)}
    const scale=Math.min(1,150/Math.max(rect.width,1));
    el.style.cssText=`position:fixed;left:0;top:0;width:${rect.width}px;height:${rect.height}px;margin:0;pointer-events:none;z-index:1000;opacity:.92;transform-origin:top left;transform:translate(${x-rect.width*scale/2}px,${y-rect.height*scale/2}px) scale(${scale});box-shadow:0 24px 60px rgb(var(--shadow-rgb)/.5);border-radius:6px;transition:none`;
    document.body.append(el);return el;
  }
  function positionGhost(x,y){if(!ghost||!gesture)return;const w=parseFloat(ghost.style.width),h=parseFloat(ghost.style.height),scale=Math.min(1,150/Math.max(w,1));ghost.style.transform=`translate(${x-w*scale/2}px,${y-h*scale/2}px) scale(${scale})`}
  function hitTest(x,y){
    if(ghost)ghost.style.visibility='hidden';const el=document.elementFromPoint(x,y);if(ghost)ghost.style.visibility='';
    const card=el?.closest?.('#gallery-results .shelf-item[data-sort-book],#gallery-results .shelf-exhibit[data-sort-book]');
    if(!card||card.dataset.sortBook===gesture.id)return null;
    const r=card.getBoundingClientRect(),horizontal=card.classList.contains('shelf-item');
    return {card,after:horizontal?x>r.left+r.width/2:y>r.top+r.height/2};
  }
  function track(x,y){
    gesture.x=x;gesture.y=y;positionGhost(x,y);const hit=hitTest(x,y);clearTargets();
    gesture.target=hit?.card.dataset.sortBook||null;gesture.after=!!hit?.after;
    if(hit){hit.card.classList.add('is-drop-target');hit.card.classList.toggle('is-drop-after',hit.after)}
  }
  function tick(){
    if(!gesture?.active)return;const top=($('#topbar')?.getBoundingClientRect().bottom||0)+40,bottom=innerHeight-64,y=gesture.y;
    const dy=y<top?-Math.min(18,(top-y)/3):y>bottom?Math.min(18,(y-bottom)/3):0;
    if(dy){window.scrollBy({top:dy,behavior:'instant'});track(gesture.x,gesture.y)}raf=requestAnimationFrame(tick);
  }
  window.addEventListener('pointerdown',e=>{
    suppressClick=false;if(gesture)finish();
    if(e.button!==0||e.pointerType==='touch'||ui.workspace!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||document.querySelector('dialog[open]'))return;
    // Only the handle reorders: a drag anywhere else on the shelf draws the selection marquee (desktop-selection.js).
    if(!e.target.closest('.shelf-drag-handle'))return;
    const card=e.target.closest('#gallery-results .shelf-item[data-sort-book],#gallery-results .shelf-exhibit[data-sort-book]');if(!card)return;
    gesture={id:card.dataset.sortBook,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,card,active:false,target:null,after:false};
  },true);
  window.addEventListener('pointermove',e=>{
    if(!gesture||e.pointerId!==gesture.pointerId)return;
    if(!(e.buttons&1)){finish();return}
    if(!gesture.active){
      if(Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)<THRESHOLD)return;
      if(cards().length<2||ui.bulk){finish();return}
      gesture.active=true;closeBookContext();document.getSelection?.()?.removeAllRanges();
      ghost=makeGhost(gesture.card,e.clientX,e.clientY);gesture.card.classList.add('is-dragging');document.body.classList.add('shelf-reordering');
      try{gesture.card.setPointerCapture?.(e.pointerId)}catch{/* capture is a nicety only */}
      raf=requestAnimationFrame(tick);
    }
    e.preventDefault();track(e.clientX,e.clientY);
  },true);
  window.addEventListener('pointerup',e=>{
    if(!gesture||e.pointerId!==gesture.pointerId)return;
    if(!gesture.active){gesture=null;return}
    const {id,target,after}=gesture;suppressClick=true;finish();
    if(target&&target!==id){try{reorderCollectionBook(id,target,after);toast(localeString('画册顺序已更新'))}catch(error){toast(error.message,'error')}}
  },true);
  window.addEventListener('pointercancel',()=>{if(gesture?.active){suppressClick=true}finish()},true);
  window.addEventListener('click',e=>{if(suppressClick){suppressClick=false;e.preventDefault();e.stopImmediatePropagation()}},true);
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&gesture?.active){e.preventDefault();e.stopImmediatePropagation();suppressClick=true;finish()}},true);
  window.addEventListener('blur',()=>finish());
}

async function batchEditBookMetadata(ids){
  const projectId=state.activeProjectId,unique=[...new Set(ids)];
  if(!unique.length)return;
  for(let i=0;i<unique.length;i+=8){if(projectId!==state.activeProjectId)throw Error('画册集已变化，请重新选择。');await Promise.all(unique.slice(i,i+8).map(id=>globalThis.Mio.fileLibrary.hydrate(id)))}
  if(projectId!==state.activeProjectId)throw Error('画册集已变化，请重新选择。');
  const rows=unique.map(id=>{const b=bookBy(id);if(!b||b.projectId!==projectId)throw Error('选中的画册已变化，请重新选择。');if(b.inProgress||[...rt.redraw].some(k=>k.startsWith(id+':')))throw Error('选中的画册正在生成或重绘，请稍后修改。');return {id,title:b.title}});
  rt.bookRenameDraft={projectId,rows};
  modal('重命名',`<div class="book-rename-list">${rows.map((b,i)=>field(rows.length===1?'画册名称':'画册 '+(i+1),input('title',b.title,'text',`data-book-rename="${esc(b.id)}" maxlength="150" aria-label="${esc('画册 '+(i+1)+' 名称')}"`))).join('')}</div><p class="help">直接修改现有名称。仅修改选中的画册，不更改图片、文件身份、原标签或生成任务。</p><div class="modal-footer">${btn('取消','','close-modal')}${btn('保存名称','check','org-book-edit-confirm','','primary')}</div>`);
  $('[data-book-rename]')?.focus();
}

async function saveBookNames(){
  const draft=rt.bookRenameDraft;if(!draft||draft.projectId!==state.activeProjectId)throw Error('画册集已变化，请重新打开重命名。');
  const changes=draft.rows.map(row=>{
    const b=bookBy(row.id),el=$(`[data-book-rename="${CSS.escape(row.id)}"]`),title=el?.value.trim();
    if(!el||!b||b.projectId!==draft.projectId||b._lazy)throw Error('画册已变化，请重新打开重命名。');
    if(b.inProgress||[...rt.redraw].some(k=>k.startsWith(b.id+':')))throw Error('选中的画册正在生成或重绘，请稍后修改。');
    if(!title||title.length>150)throw Error('每本画册都需要填写 1–150 字的名称。');
    if(b.title!==row.title)throw Error('画册名称已在其他操作中改变，未覆盖；请重新打开重命名。');
    return {b,title};
  }).filter(({b,title})=>b.title!==title);
  if(!changes.length){closeModal();return}
  for(const {b,title} of changes){b.title=title;b.updatedAt=Date.now()}
  rt.bookRenameDraft=null;save();closeModal();render();
  if(!await savePythonWorkspace())throw Error('重命名尚未确认。本页保留待保存名称，请检查保存错误后重新保存。');
  toast('已重命名 '+changes.length+' 本画册。');
}

function installOrganizationTools(){
  let sortState=null,drag=null;
  const oldEnsure=ensureStudioState;ensureStudioState=function(s=state){oldEnsure(s);const p=s.settings.presentation;p.bookOrder??={};p.collectionSort??='manual';if(sortState!==s){ui.sort=p.collectionSort;sortState=s}return s};
  const oldFiltered=filteredBooks;filteredBooks=function(){const books=oldFiltered();if(ui.sort!=='manual')return books;const rank=new Map(manualBookIds().map((id,i)=>[id,i]));return books.sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity))};
  queueHTML=renderOrderedQueue;
  const oldCollection=renderResponsiveCollection;renderResponsiveCollection=function(){return oldCollection().replace('<div id="gallery-results">',`<details class="book-order-drawer"><summary>调整画册顺序 <span>拖动排序 · 右键批量管理</span></summary><div class="book-order-list">${bookOrderListHTML()}</div></details><div id="gallery-results">`)};
  const oldGalleryRefresh=refreshGallery;refreshGallery=function(){oldGalleryRefresh();refreshCollectionSelection();syncBulkToggle()};
  const oldRender=render;render=function(){const orderOpen=$('.book-order-drawer')?.open;closeBookContext();oldRender();document.documentElement.dataset.queueView=String(ui.workspace===1&&createUI.tab==='queue');if(orderOpen&&$('.book-order-drawer'))$('.book-order-drawer').open=true;refreshCollectionSelection();if(ui.workspace===1){document.querySelectorAll('#main .primary').forEach(el=>{if(el.dataset.act!=='v3-generate-plan')el.classList.remove('primary')})}};
  const oldHotReplace=hotReplace;hotReplace=function(id,index,src){
    document.querySelectorAll('.artwork-missing[data-page-img]').forEach(el=>{if(el.dataset.pageImg!==id+':'+index)return;const img=document.createElement('img');for(const a of el.attributes)if(a.name.startsWith('data-')||a.name==='id')img.setAttribute(a.name,a.value);img.alt=bookBy(id)?.steps.find(s=>s.stepIndex===index)?.name||'分镜';img.src=el.closest('.room-filmstrip,.reader-inspector,.queue-item,.shelf-cover')?thumbnailURL(src):src;el.replaceWith(img)});oldHotReplace(id,index,src);
  };
  const oldSettings=renderPythonSettings;renderPythonSettings=()=>oldSettings()+`<section class="settings-section"><h2>真实服务默认值</h2><p>新安装默认使用真实 ComfyUI、文本模型和视觉模型。请填写实际地址、模型和密钥；连接失败不再回退到示例图。</p>${btn('将当前服务切换为真实模式','settings','org-enable-real','','small')}</section>`;
  const oldAction=handleAction;handleAction=async function(action,d={},element){
    if(action==='resume'){const q=state.queue.find(q=>q.bookId===d.id&&queueCanContinue(q));if(q)return retryQueueTask(q.id)}
    if(action==='scan-resume')return inspectQueueGaps();
    if(action==='org-enable-real'){for(const key of ['comfy','llm','xml','critic'])if(state.settings[key])state.settings[key].mode='real';state.settings.comfy.autoFallback=false;save();render();toast('服务已切换为真实模式，请核对连接设置。');return}
    if(action==='org-queue-pause'&&!foundationIsMock()){await foundationRequest('jobs/scheduler',{action:rt.paused?'resume':'pause'});rt.paused=!rt.paused;if(!rt.paused)await runQueue();updateQueueUI();return}
    if(action==='org-queue-pause'){rt.paused=!rt.paused;if(!rt.paused&&!rt.running)void runQueue();updateQueueUI();toast(rt.paused?'已暂停后续调度，当前帧会保留。':'队列继续按顺序执行。');return}
    if(action==='org-queue-run'){if(!foundationIsMock())await foundationRequest('jobs/scheduler',{action:'resume'});rt.paused=false;void runQueue();updateQueueUI();return}
    if(action==='org-task-delete')return deleteQueuedTask(d.id);
    if(action==='org-task-up'||action==='org-task-down'){const ids=state.queue.filter(q=>q.status==='pending').map(q=>q.id),i=ids.indexOf(d.id),down=action==='org-task-down',other=ids[i+(down?1:-1)];if(other)reorderPendingTask(d.id,other,down);return}
    if(action==='org-book-up'||action==='org-book-down'){const ids=getShelfBooks().map(b=>b.id),i=ids.indexOf(d.id),down=action==='org-book-down',other=ids[i+(down?1:-1)];if(other)reorderCollectionBook(d.id,other,down);return}
    if(action.startsWith('org-context-')){
      let ids=[];try{ids=JSON.parse(d.ids||'[]')}catch{ids=[]}ids=ids.filter(id=>bookBy(id)?.projectId===state.activeProjectId);closeBookContext();
      if(action==='org-context-select-all'){ui.selected=new Set(getShelfBooks().map(b=>b.id));ui.bulk=true;syncSelectionView();return}
      if(action==='org-context-clear'){exitBookSelection();syncSelectionView();return}
      if(action==='org-context-resume'){for(const id of ids){const b=bookBy(id);if(b&&missingIndices(b).length)await handleAction('resume',{id})}return}
      if(!ids.length)return;
      if((action==='org-context-up'||action==='org-context-down')&&ids.length===1){const order=getShelfBooks().map(b=>b.id),i=order.indexOf(ids[0]),down=action==='org-context-down',other=order[i+(down?1:-1)];if(other)reorderCollectionBook(ids[0],other,down);return}
      if(action==='org-context-export')return exportModal(ids);
      if(action==='org-context-delete')return deleteBooks(ids);
      if(action==='org-context-edit')return batchEditBookMetadata(ids);
      if(action==='org-context-star'){ids.forEach(id=>{bookBy(id).liked=true});save();refreshGallery();return}
    }
    if(action==='org-book-edit-confirm')return saveBookNames();
    if(action==='book-menu'&&ui.workspace===0){const rect=element?.getBoundingClientRect();openBookContext(d.id,rect?.left||innerWidth/2,rect?.bottom||innerHeight/2);return}
    return oldAction(action,d,element);
  };
  document.addEventListener('change',e=>{
    if(e.target.id==='gallery-sort'){state.settings.presentation.collectionSort=e.target.value;save()}
    // Per-card checkboxes and the "select all" box are the touch-friendly path into the same selection model.
    if(e.target.dataset.selectBook){setBookSelected(e.target.dataset.selectBook,e.target.checked);if(e.target.checked){ui.bulk=true;ui.selectionAnchor=e.target.dataset.selectBook}settleSelectionMode();syncSelectionView()}
    if(e.target.id==='shelf-select-all'){for(const book of getShelfBooks())setBookSelected(book.id,e.target.checked);if(e.target.checked)ui.bulk=true;settleSelectionMode();syncSelectionView()}
  });
  document.addEventListener('contextmenu',e=>{const card=e.target.closest('[data-sort-book]');if(ui.workspace!==0||!card||e.target.closest('input,textarea,[contenteditable="true"]'))return;e.preventDefault();openBookContext(card.dataset.sortBook,e.clientX,e.clientY,e.ctrlKey||e.metaKey)});
  document.addEventListener('keydown',e=>{
    if(typeof contextMenuOpen==='function'&&contextMenuOpen())return;
    const card=e.target.closest('[data-sort-book]');if(!card||ui.workspace!==0)return;
    if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();const rect=card.getBoundingClientRect();openBookContext(card.dataset.sortBook,rect.left+20,rect.top+20);return}
    if(card.classList.contains('book-order-chip'))return;
    const id=card.dataset.sortBook,onCard=e.target===card||e.target.closest('[data-act]')?.dataset.act==='read';
    // Space toggles selection (file-manager convention); Enter on the card itself opens it.
    if(e.key===' '&&onCard&&!e.altKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();e.stopImmediatePropagation();toggleBookSelected(id);ui.selectionAnchor=id;ui.bulk=true;settleSelectionMode();syncSelectionView();document.querySelector(`[data-sort-book="${CSS.escape(id)}"]`)?.focus({preventScroll:true});return}
    if(e.key==='Enter'&&e.target===card){e.preventDefault();openBookFromShelf(id)}
  });
  document.addEventListener('keyup',e=>{const card=e.target.closest('[data-sort-book]');if(e.key===' '&&card&&ui.workspace===0&&(e.target===card||e.target.closest('[data-act]')?.dataset.act==='read'))e.preventDefault()});
  document.addEventListener('dragstart',e=>{
    const target=e.target.closest('[data-sort-task],[data-sort-book]');if(!target||e.target.closest('input,select,textarea'))return;
    const type=target.dataset.sortTask?'task':'book',id=target.dataset.sortTask||target.dataset.sortBook;
    if(type==='task'&&state.queue.find(q=>q.id===id)?.status!=='pending'){e.preventDefault();return}
    // Shelf cards reorder through pointer events (see installShelfReorderDrag); never let an image drag hijack them.
    if(type==='book'&&!target.classList.contains('book-order-chip')){e.preventDefault();return}
    drag={type,id};closeBookContext();e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-comfy-order',JSON.stringify(drag));target.classList.add('is-dragging');
  });
  document.addEventListener('dragover',e=>{if(!drag)return;const target=e.target.closest(drag.type==='task'?'[data-sort-task]':'[data-sort-book]');if(!target)return;if(drag.type==='task'&&state.queue.find(q=>q.id===target.dataset.sortTask)?.status!=='pending')return;e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('.is-drop-target').forEach(x=>x.classList.remove('is-drop-target'));target.classList.add('is-drop-target')});
  document.addEventListener('drop',e=>{if(!drag)return;const target=e.target.closest(drag.type==='task'?'[data-sort-task]':'[data-sort-book]');if(!target)return;e.preventDefault();try{const rect=target.getBoundingClientRect(),after=e.clientY>rect.top+rect.height/2;if(drag.type==='task')reorderPendingTask(drag.id,target.dataset.sortTask,after);else reorderCollectionBook(drag.id,target.dataset.sortBook,after)}catch(error){toast(error.message,'error')}finally{drag=null;document.querySelectorAll('.is-drop-target,.is-dragging').forEach(x=>x.classList.remove('is-drop-target','is-dragging'))}});
  document.addEventListener('dragend',()=>{drag=null;document.querySelectorAll('.is-drop-target,.is-dragging').forEach(x=>x.classList.remove('is-drop-target','is-dragging'))});
}

// Standalone exports need an image URL; use only a neutral question mark, not artwork.
function missingArtworkDataURL(){
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024"><rect width="768" height="1024" fill="#ececea"/><text x="384" y="530" text-anchor="middle" font-size="64" fill="#999a96" font-family="sans-serif">?</text></svg>');
}
