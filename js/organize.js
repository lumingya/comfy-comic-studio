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
  const waiting=state.queue.some(q=>q.status==='pending'),running=rt.running;
  return `${btn(rt.paused?'继续执行':running?'暂停调度':'暂停队列',rt.paused?'play':'pause','org-queue-pause','','small')}${!running&&waiting&&!rt.paused?btn('执行待办','play','org-queue-run','','small'):''}${btn('中止','stop','interrupt',!running&&!waiting?'disabled':'','small')}`;
}

function renderCompactQueue(){
  return `<section class="compact-production">${queueComposerHTML()}<div class="queue-section-heading"><div><h2>生成队列</h2><p>从上往下执行。拖动待执行任务排序，展开查看分镜配置。</p></div><div class="row" id="queue-controls">${queueControlsHTML()}</div></div><div class="ordered-queue" id="queue-list">${renderOrderedQueue()}</div><div class="queue-footer">${btn('查找缺失分镜','refresh','scan-resume','','small')}${btn('查看运行日志','terminal','v3-nav','data-route="logs"','small ghost')}<span>删除任务不会删除画册或已生成图片</span></div></section>`;
}

function taskWorkflowHTML(q){
  if(!q.frames?.length)return '';
  return `<details class="quiet-advanced queue-workflow-detail" data-task-detail="${esc(q.id)}"><summary>分镜与工作流 · ${q.indices.length} 幕</summary>${q.indices.map((i,pos)=>{
    const f=q.frames[i],ex=f?._execution||q.execution,locked=q.status!=='pending'&&(!['running','paused'].includes(q.status)||pos<=q.done);
    return `<div class="queue-workflow-row"><span>${i+1}. ${esc(f?.name||'分镜')}</span><span class="tiny muted">${esc(ex?.workflowTitle||'默认工作流')}</span><select data-ws-task="${esc(q.id)}" data-ws-index="${i}" aria-label="第 ${i+1} 幕任务工作流" ${locked?'disabled':''}>${opt('','保留当前快照','')}${state.settings.comfy.presets.map(p=>opt(p.id,p.title,'')).join('')}</select></div>`;
  }).join('')}</details>`;
}

function renderOrderedQueue(){
  const tasks=state.queue.filter(q=>bookBy(q.bookId)),pending=tasks.filter(q=>q.status==='pending');
  if(!tasks.length)return `<div class="queue-empty"><span class="queue-empty-symbol">≡</span><strong>还没有生成任务</strong><p>选择工作流与范围，加入后会自动按顺序执行。</p></div>`;
  return tasks.map((q,i)=>{
    const b=bookBy(q.bookId),active=['running','paused'].includes(q.status),movable=q.status==='pending',pos=pending.indexOf(q),pct=q.indices.length?Math.round(q.done/q.indices.length*100):100;
    const statuses={pending:rt.paused?'等待 · 调度暂停':'等待执行',running:'正在生成',paused:'已暂停',complete:'已完成',canceled:'已中止',failed:'生成失败'};
    return `<article class="ordered-task ${active?'is-running':''}" data-sort-task="${esc(q.id)}" draggable="${movable}" aria-label="任务 ${i+1}：${esc(b.title)}"><div class="ordered-task-main"><span class="task-drag-handle" title="${movable?'拖动调整待执行顺序':'已开始的任务不能移动'}">${movable?'⠿':'·'}</span><span class="task-position">${pad(i+1)}</span><div class="ordered-queue-thumb">${imgTag(coverImage(b),b.title,`data-book="${esc(b.id)}"`)}</div><div class="task-title"><strong>${esc(b.title)}</strong><span>${q.indices.length===1?'第 '+(q.indices[0]+1)+' 幕 · ':''}${q.done} / ${q.indices.length} 幕 · ${esc(statuses[q.status]||q.status)}</span></div><div class="task-mini-progress" aria-label="进度 ${pct}%"><i style="width:${pct}%"></i></div><div class="task-actions">${ibtn('up','org-task-up','任务上移',`data-id="${esc(q.id)}" ${!movable||pos===0?'disabled':''}`)}${ibtn('down','org-task-down','任务下移',`data-id="${esc(q.id)}" ${!movable||pos===pending.length-1?'disabled':''}`)}${ibtn('book','read','查看画册',`data-id="${esc(b.id)}"`)}${ibtn('trash','org-task-delete',active?'执行中的任务请先中止':'删除此任务，保留画册',`data-id="${esc(q.id)}" ${active?'disabled':''}`)}</div></div>${taskWorkflowHTML(q)}</article>`;
  }).join('');
}

function moveOrderedId(order,source,target,after=false){
  if(source===target||!order.includes(source)||!order.includes(target))return [...order];
  const next=order.filter(id=>id!==source),index=next.indexOf(target);next.splice(index+(after?1:0),0,source);return next;
}

function reorderPendingTask(source,target,after=false){
  const pending=state.queue.filter(q=>q.status==='pending'),ids=pending.map(q=>q.id);
  if(!ids.includes(source)||!ids.includes(target))throw Error('只能调整尚未开始的任务；运行中的任务位置已锁定。');
  const next=moveOrderedId(ids,source,target,after).map(id=>pending.find(q=>q.id===id));let index=0;
  // Preserve the actual running task object, including its loop cursor.
  state.queue=state.queue.map(q=>q.status==='pending'?next[index++]:q);save();updateQueueUI();
}

async function deleteQueuedTask(id){
  let q=state.queue.find(x=>x.id===id);if(!q)return;
  if(['running','paused'].includes(q.status))throw Error('此任务正在执行，请先中止后再删除。');
  if(!await confirmAction('删除这个生成任务？','仅移除任务记录；画册、已生成图片、分镜和预设都会保留。','删除任务'))return;
  q=state.queue.find(x=>x.id===id);if(!q)return;
  if(['running','paused'].includes(q.status))throw Error('确认期间任务已开始，未删除。请先中止。');
  state.queue=state.queue.filter(x=>x.id!==id);
  const b=bookBy(q.bookId);if(b&&!state.queue.some(x=>x.bookId===b.id&&['pending','running','paused'].includes(x.status)))b.status=missingIndices(b).length?(b.generatedSteps?'partial':'canceled'):'complete';
  save(true);updateQueueUI();toast('任务已移除，画册和图片已保留。');
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

function closeBookContext(restoreFocus=false){
  const menu=$('#book-context-menu');if(!menu)return;const id=menu.dataset.focusId;menu.remove();
  if(restoreFocus)document.querySelector(`[data-sort-book="${CSS.escape(id)}"]`)?.focus();
}

function openBookContext(id,x,y,extend=false){
  const b=bookBy(id);if(!b||b.projectId!==state.activeProjectId)return;
  ui.selected=new Set([...ui.selected].filter(key=>bookBy(key)?.projectId===state.activeProjectId));
  if(!ui.selected.has(id)){if(!extend)ui.selected.clear();ui.selected.add(id)}
  ui.bulk=true;refreshGallery();closeBookContext();
  const ids=[...ui.selected],busy=ids.some(key=>bookBy(key)?.inProgress||[...rt.redraw].some(k=>k.startsWith(key+':'))),menu=document.createElement('div');
  menu.id='book-context-menu';menu.className='book-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','画册右键菜单');menu.dataset.focusId=id;menu.dataset.ids=JSON.stringify(ids);
  const item=(action,label,iconName,disabled=false)=>`<button type="button" role="menuitem" data-act="${action}" ${disabled?'disabled':''}>${icon(iconName,'sm')}<span>${label}</span></button>`;
  menu.innerHTML=`<div class="context-menu-title">已选择 ${ids.length} 本画册</div>${item('org-context-export','批量导出…','download')}${item('org-context-edit','批量编辑名称 / 标签…','edit',busy)}${item('org-context-star','批量星标','star')}<div class="context-menu-separator"></div>${item('org-context-select-all','选择当前筛选结果','check')}${item('org-context-clear','取消选择','close')}<div class="context-menu-separator"></div>${item('org-context-delete',busy?'生成中 · 暂不可删除':'批量删除…','trash',busy)}<div class="context-menu-hint">Ctrl / ⌘ 点击多选 · Shift 连选<br>拖动画册可调整顺序</div>`;
  document.body.append(menu);const rect=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';menu.querySelector('button')?.focus();
}

function batchEditBookMetadata(ids){
  modal('批量编辑 '+ids.length+' 本画册',`${field('标题前缀（留空不改）',input('prefix','','text','id="org-book-prefix" maxlength="60" placeholder="例如：第一辑 · "'))}${field('追加标签（逗号分隔，留空不改）',input('tags','','text','id="org-book-tags" maxlength="300" placeholder="例如：旅行, 青春"'))}<p class="help">仅修改选中画册的展示信息，不改变源计划、图片文件名或工作流快照。</p><div class="modal-footer">${btn('取消','','close-modal')}${btn('应用修改','check','org-book-edit-confirm')}</div>`);
  $('#modal-body').dataset.bookIds=JSON.stringify(ids);
}

function installOrganizationTools(){
  let sortState=null,drag=null,lastSelected=null;
  const oldEnsure=ensureStudioState;ensureStudioState=function(s=state){oldEnsure(s);const p=s.settings.presentation;p.bookOrder??={};p.collectionSort??='manual';if(sortState!==s){ui.sort=p.collectionSort;sortState=s}return s};
  const oldFiltered=filteredBooks;filteredBooks=function(){const books=oldFiltered();if(ui.sort!=='manual')return books;const rank=new Map(manualBookIds().map((id,i)=>[id,i]));return books.sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity))};
  queueHTML=renderOrderedQueue;
  const oldCollection=renderResponsiveCollection;renderResponsiveCollection=function(){return oldCollection().replace('<div id="gallery-results">',`<details class="book-order-drawer"><summary>调整画册顺序 <span>拖动排序 · 右键批量管理</span></summary><div class="book-order-list">${bookOrderListHTML()}</div></details><div id="gallery-results">`)};
  const oldGalleryRefresh=refreshGallery;refreshGallery=function(){oldGalleryRefresh();refreshCollectionSelection()};
  const oldRender=render;render=function(){const orderOpen=$('.book-order-drawer')?.open;closeBookContext();oldRender();document.documentElement.dataset.queueView=String(ui.workspace===1&&createUI.tab==='queue');if(orderOpen&&$('.book-order-drawer'))$('.book-order-drawer').open=true;refreshCollectionSelection();if(ui.workspace===1){document.querySelectorAll('#main .primary').forEach(el=>{if(el.dataset.act!=='v3-generate-plan')el.classList.remove('primary')})}};
  const oldHotReplace=hotReplace;hotReplace=function(id,index,src){
    document.querySelectorAll('.artwork-missing[data-page-img]').forEach(el=>{if(el.dataset.pageImg!==id+':'+index)return;const img=document.createElement('img');for(const a of el.attributes)if(a.name.startsWith('data-')||a.name==='id')img.setAttribute(a.name,a.value);img.alt=bookBy(id)?.steps.find(s=>s.stepIndex===index)?.name||'分镜';img.src=src;el.replaceWith(img)});oldHotReplace(id,index,src);
  };
  const oldSettings=renderPythonSettings;renderPythonSettings=()=>oldSettings()+`<section class="settings-section"><h2>真实服务默认值</h2><p>新安装默认使用真实 ComfyUI、文本模型和视觉模型。请填写实际地址、模型和密钥；连接失败不再回退到示例图。</p>${btn('将当前服务切换为真实模式','settings','org-enable-real','','small')}<p class="help">保留已有地址和密钥。只影响后续任务，已入队快照不会被改写。</p></section>`;
  const oldAction=handleAction;handleAction=async function(action,d={},element){
    if(action==='org-enable-real'){for(const key of ['comfy','llm','xml','critic'])if(state.settings[key])state.settings[key].mode='real';state.settings.comfy.autoFallback=false;save();render();toast('服务已切换为真实模式，请核对连接设置。');return}
    if(action==='org-queue-pause'){rt.paused=!rt.paused;if(!rt.paused&&!rt.running)void runQueue();updateQueueUI();toast(rt.paused?'已暂停后续调度，当前帧会保留。':'队列继续按顺序执行。');return}
    if(action==='org-queue-run'){rt.paused=false;void runQueue();updateQueueUI();return}
    if(action==='org-task-delete')return deleteQueuedTask(d.id);
    if(action==='org-task-up'||action==='org-task-down'){const ids=state.queue.filter(q=>q.status==='pending').map(q=>q.id),i=ids.indexOf(d.id),down=action==='org-task-down',other=ids[i+(down?1:-1)];if(other)reorderPendingTask(d.id,other,down);return}
    if(action==='org-book-up'||action==='org-book-down'){const ids=getShelfBooks().map(b=>b.id),i=ids.indexOf(d.id),down=action==='org-book-down',other=ids[i+(down?1:-1)];if(other)reorderCollectionBook(d.id,other,down);return}
    if(action.startsWith('org-context-')){
      const ids=JSON.parse($('#book-context-menu')?.dataset.ids||'[]').filter(id=>bookBy(id)?.projectId===state.activeProjectId);closeBookContext();
      if(action==='org-context-select-all'){ui.selected=new Set(getShelfBooks().map(b=>b.id));ui.bulk=true;refreshGallery();return}
      if(action==='org-context-clear'){ui.selected.clear();ui.bulk=false;refreshGallery();return}
      if(!ids.length)return;
      if(action==='org-context-export')return exportModal(ids);
      if(action==='org-context-delete')return deleteBooks(ids);
      if(action==='org-context-edit')return batchEditBookMetadata(ids);
      if(action==='org-context-star'){ids.forEach(id=>{bookBy(id).liked=true});save();refreshGallery();return}
    }
    if(action==='org-book-edit-confirm'){
      const ids=JSON.parse($('#modal-body').dataset.bookIds||'[]'),prefix=$('#org-book-prefix').value,tags=$('#org-book-tags').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
      for(const id of ids){const b=bookBy(id);if(b&&b.projectId===state.activeProjectId){if(b.inProgress)throw Error('选中的画册正在生成，请稍后修改。')}}
      for(const id of ids){const b=bookBy(id);if(b&&b.projectId===state.activeProjectId){if(prefix)b.title=prefix+b.title;b.tags=[...new Set([...b.tags,...tags])];b.updatedAt=Date.now()}}
      save();closeModal();render();toast('画册展示信息已更新。');return;
    }
    if(action==='book-menu'&&ui.workspace===0){const rect=element?.getBoundingClientRect();openBookContext(d.id,rect?.left||innerWidth/2,rect?.bottom||innerHeight/2);return}
    return oldAction(action,d,element);
  };
  document.addEventListener('change',e=>{if(e.target.id==='gallery-sort'){state.settings.presentation.collectionSort=e.target.value;save()}if(e.target.dataset.selectBook)refreshCollectionSelection()});
  document.addEventListener('contextmenu',e=>{const card=e.target.closest('[data-sort-book]');if(ui.workspace!==0||!card||e.target.closest('input,textarea,[contenteditable="true"]'))return;e.preventDefault();openBookContext(card.dataset.sortBook,e.clientX,e.clientY,e.ctrlKey||e.metaKey)});
  document.addEventListener('click',e=>{
    if($('#book-context-menu')&&!e.target.closest('#book-context-menu'))closeBookContext();
    const card=e.target.closest('[data-sort-book]');if(ui.workspace!==0||!card||card.classList.contains('book-order-chip'))return;
    if(e.target.closest('input,select,textarea')||e.target.closest('[data-act]')?.dataset.act&&e.target.closest('[data-act]').dataset.act!=='read')return;
    if(!(e.ctrlKey||e.metaKey||e.shiftKey||ui.bulk))return;
    e.preventDefault();e.stopImmediatePropagation();const id=card.dataset.sortBook,ids=getShelfBooks().map(b=>b.id);
    if(e.shiftKey&&lastSelected&&ids.includes(lastSelected)){const a=ids.indexOf(lastSelected),b=ids.indexOf(id);ids.slice(Math.min(a,b),Math.max(a,b)+1).forEach(x=>ui.selected.add(x))}
    else ui.selected.has(id)?ui.selected.delete(id):ui.selected.add(id);
    lastSelected=id;ui.bulk=true;refreshGallery();
  },true);
  document.addEventListener('keydown',e=>{
    const menu=$('#book-context-menu');if(menu){if(e.key==='Escape'){e.preventDefault();closeBookContext(true);return}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[...menu.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();return}}
    const card=e.target.closest('[data-sort-book]');if(card&&ui.workspace===0&&(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10')){e.preventDefault();const rect=card.getBoundingClientRect();openBookContext(card.dataset.sortBook,rect.left+20,rect.top+20)}
  });
  document.addEventListener('dragstart',e=>{
    const target=e.target.closest('[data-sort-task],[data-sort-book]');if(!target||e.target.closest('input,select,textarea'))return;
    const type=target.dataset.sortTask?'task':'book',id=target.dataset.sortTask||target.dataset.sortBook;
    if(type==='task'&&state.queue.find(q=>q.id===id)?.status!=='pending'){e.preventDefault();return}
    drag={type,id};closeBookContext();e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-comfy-order',JSON.stringify(drag));target.classList.add('is-dragging');
  });
  document.addEventListener('dragover',e=>{if(!drag)return;const target=e.target.closest(drag.type==='task'?'[data-sort-task]':'[data-sort-book]');if(!target)return;if(drag.type==='task'&&state.queue.find(q=>q.id===target.dataset.sortTask)?.status!=='pending')return;e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('.is-drop-target').forEach(x=>x.classList.remove('is-drop-target'));target.classList.add('is-drop-target')});
  document.addEventListener('drop',e=>{if(!drag)return;const target=e.target.closest(drag.type==='task'?'[data-sort-task]':'[data-sort-book]');if(!target)return;e.preventDefault();try{const rect=target.getBoundingClientRect(),after=e.clientY>rect.top+rect.height/2;if(drag.type==='task')reorderPendingTask(drag.id,target.dataset.sortTask,after);else reorderCollectionBook(drag.id,target.dataset.sortBook,after)}catch(error){toast(error.message,'error')}finally{drag=null;document.querySelectorAll('.is-drop-target,.is-dragging').forEach(x=>x.classList.remove('is-drop-target','is-dragging'))}});
  document.addEventListener('dragend',()=>{drag=null;document.querySelectorAll('.is-drop-target,.is-dragging').forEach(x=>x.classList.remove('is-drop-target','is-dragging'))});
  window.addEventListener('resize',()=>closeBookContext());
  document.addEventListener('scroll',e=>{if(!e.target.closest?.('#book-context-menu'))closeBookContext()},true);
}

// Standalone exports need an image URL; use only a neutral question mark, not artwork.
function missingArtworkDataURL(){
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024"><rect width="768" height="1024" fill="#ececea"/><text x="384" y="530" text-anchor="middle" font-size="64" fill="#999a96" font-family="sans-serif">?</text></svg>');
}
