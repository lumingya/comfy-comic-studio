/* Mio development module: ui. */
'use strict';

function makeFrame(i=0){return{id:uid('f'),name:frameNames[i%8],camera:['Full Shot','Medium Shot','Close-up','Low Angle'][i%4],prompt:'masterpiece, anime illustration, {character}, {style}, {outfit}, {scene}, cinematic lighting, '+['summer railway station, ocean in distance','holding a letter, soft backlighting','expressive eyes, wind in hair','golden hour, seaside'][i%4],caption:captions[i%8],negative:'',width:768,height:1024,steps:24,cfg:7,denoise:1,seed:-1,status:'pending'}}


function makeRow(i,p='p_summer'){return{id:uid('row'),projectId:p,active:i<2,bookTitle:['海风与未寄出的信','霓虹尽头','花开时，遇见你','月下的第七封信','森之回响','坠入星河','夏日祭的约定','最后一班电车'][i%8],character:['七海 Nanami','凛 Rin','千夏 Chinatsu','月 Tsuki','森 Mori','星野 Hoshino','绫 Aya','七海 Nanami'][i%8],style:'cinematic anime, cel shading',outfit:i%2?'dark jacket, silver accessories':'white shirt, navy school uniform',scene:['seaside train station','neon city at night','summer flower field','moonlit garden'][i%4],trigger:'consistent face, delicate features',lora:'',references:{},storyVersions:{},activeStoryVersionIds:{}}}


function toast(m,type='ok'){const host=['#confirm-dialog','#command-dialog','#modal','#reader'].map(s=>$(s)).find(d=>d?.open)||document.body;let region=$('#toasts');if(!region){region=document.createElement('div');region.id='toasts';region.className='toast-region';region.setAttribute('role','status');region.setAttribute('aria-live','polite')}host.append(region);const el=document.createElement('div');el.className='toast '+(type==='error'?'error':'');el.innerHTML=icon(type==='error'?'help':'check')+`<span>${esc(m)}</span>`;region.append(el);setTimeout(()=>el.remove(),4500)}

function log(m,level='info'){rt.logs.push({time:Date.now(),message:m,level});if(rt.logs.length>300)rt.logs.shift();renderLogs()}


async function copyText(v){try{await navigator.clipboard.writeText(v)}catch(e){const t=document.createElement('textarea');t.value=v;t.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();if(!ok)throw Error('剪贴板不可用，请手动复制。')}toast('已复制到剪贴板')}


function download(n,c,type='application/json'){const u=URL.createObjectURL(c instanceof Blob?c:new Blob([c],{type})),a=document.createElement('a');a.href=u;a.download=n.replace(/[\\/:*?"<>|]/g,'_');(document.querySelector('dialog[open]')||document.body).append(a);a.click();setTimeout(()=>a.remove(),1000);setTimeout(()=>URL.revokeObjectURL(u),30000)}

function pickFile(accept,fn,multiple=false){const e=$('#file-input');e.accept=accept;e.multiple=multiple;e.value='';e.onchange=async()=>{try{if(e.files.length)await fn(multiple?[...e.files]:e.files[0])}catch(x){toast(x.message,'error')}};e.click()}


function modal(title,body,sub='',wide=false){$('#modal').classList.remove('market-dialog');$('#modal').classList.toggle('modal-wide',wide);$('#modal-title').textContent=title;$('#modal-subtitle').textContent=sub;$('#modal-body').innerHTML=body;if(!$('#modal').open)$('#modal').showModal()}

function closeModal(){$('#modal').close()}

function confirmAction(title,msg,label='确认'){return new Promise(resolve=>{const d=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-message').textContent=msg;$('#confirm-yes').textContent=label;const end=v=>{d.close();resolve(v)};$('#confirm-yes').onclick=()=>end(true);$('#confirm-no').onclick=()=>end(false);d.oncancel=e=>{e.preventDefault();end(false)};d.showModal()})}


function renderShell(){$('#sidebar').innerHTML=`<a class="brand" href="#gallery" data-act="workspace" data-index="0"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><div class="brand-text"><div class="brand-name">Mio</div><div class="brand-sub">STUDIO <span>v2.2</span></div></div></a><button class="side-search" data-act="command">${icon('search')}<span class="grow">搜索与快速操作</span><kbd class="kbd">⌘ K</kbd></button><div class="nav-label">创作工作区 / WORKSPACE</div><nav class="nav-list">${workspaces.map((w,i)=>`<button class="nav-item ${ui.workspace===i?'active':''}" data-act="workspace" data-index="${i}" title="${w[0]} (${i+1})" ${ui.workspace===i?'aria-current="page"':''}>${icon(w[1])}<span>${w[0]}</span><b class="nav-key">${i+1}</b></button>`).join('')}</nav><section class="side-section"><div class="nav-label row between">我的企划 ${ibtn('plus','new-project','新建企划')}</div><div class="nav-list">${state.projects.map(p=>`<button class="side-project" data-act="project" data-id="${p.id}"><i class="dot ${p.id===state.activeProjectId?'':'amber'}" style="opacity:${p.id===state.activeProjectId?1:.45}"></i><span>${esc(p.title)}</span><span class="count">${state.books.filter(b=>b.projectId===p.id).length}</span></button>`).join('')}<button class="side-project muted" data-act="new-project">${icon('plus','sm')}新建企划</button></div></section><div class="side-bottom"><nav class="nav-list"><button class="nav-item" data-act="market">${icon('box')}<span>模板与插件</span><span class="nav-key">↗</span></button><button class="nav-item" data-act="backup">${icon('disk')}<span>工程备份与迁移</span></button></nav><div class="storage"><div class="row between">本地私有空间 ${icon('shield','sm')}</div><div class="storage-bar"><i></i></div>所有创作，只属于你。</div><div class="profile"><div class="avatar">K</div><div class="grow"><strong>Kira 的工作室</strong><p>LOCAL WORKSPACE</p></div>${ibtn('settings','settings','全局设置')}</div></div>`;$('#topbar').innerHTML=`<div class="breadcrumb"><span>工作空间</span><span>/</span><strong>${workspaces[ui.workspace][0]}</strong></div><div class="top-separator"></div><div class="row">${icon('folder','sm')}<select class="project-select" id="project-select" aria-label="切换企划">${state.projects.map(p=>opt(p.id,p.title,state.activeProjectId)).join('')}</select></div><div class="spacer"></div><button class="engine-status" data-act="engine-info"><i class="dot ${rt.connected||state.settings.comfy.mode==='mock'?'':'amber'}"></i><span>${state.settings.comfy.mode==='mock'?'本地演示引擎':rt.connected?'ComfyUI 已连接':'ComfyUI 未连接'}</span><span class="engine-address mono" style="opacity:.5;margin-left:3px">${state.settings.comfy.mode==='mock'?'SVG':rt.vram!==null?rt.vram+'% VRAM':'GPU'}</span></button><button class="top-queue" data-act="workspace" data-index="2">${icon('nodes','sm')}队列 <b>${state.queue.filter(q=>['pending','running','paused'].includes(q.status)).length}</b></button><div class="top-separator"></div>${ibtn('sun','theme','切换日光 / 暗室主题')}${ibtn('help','help','使用指南与快捷键')}`;renderStatus()}


function renderStatus(){$('#statusbar').innerHTML=`<i class="dot ${rt.saved?'':'amber'}"></i><span>${rt.saving?'正在安全保存...':rt.saved?'所有更改已保存至本地':'尚未保存，请导出备份'}</span><span style="opacity:.5;margin-left:9px">${state.settings.syncUrl?'远端同步已配置':'LOCAL FIRST'}</span><div class="spacer"></div>${rt.running?'<i class="dot live"></i><span>渲染队列正在运行</span>':'<span>创作，不被打断。</span>'}<span style="margin:0 10px;opacity:.5">|</span><span>⌘ K 快速操作</span><span style="margin-left:13px">Mio v2.2.0</span>`}


function applyArtworkRatios(){for(const el of $$('.cover[data-id]')){const b=bookBy(el.dataset.id);if(b?.aspectRatio)el.style.aspectRatio=String(clamp(b.aspectRatio,.5,1.9))}}


function render(){renderShell();$('#main').innerHTML=`<div class="view">${[renderGallery,renderStoryboard,renderMatrix,renderEngine,renderStoryStudio][ui.workspace]()}</div>`;applyArtworkRatios();if(ui.workspace===2)renderLogs();if(ui.workspace===4){const badge=$('.tabbar .chip.green');if(badge)badge.textContent=llmMock()?'离线规则推演':state.settings.llm.model;const outline=$('#story-outline'),t=templateBy(ui.storyTemplateId);if(outline&&t){const notice=outline.closest('.panel').querySelector('.notice');notice.insertAdjacentHTML('beforebegin',field('篇幅目标 / 分镜幕数',input('panelCount',t.frames.length,'number','id="story-target" min="1" max="512"'),'推演前同步调整绑定模板的尾部幕数，已有画册不受影响。'))}if(rt.llmBusy)$$('[data-story-caption],#story-version,#story-row,#story-template,#story-target').forEach(e=>e.disabled=true)}}


function navigate(i){flushEditor();ui.workspace=clamp(Number(i),0,4);render();window.scrollTo({top:0,behavior:'instant'})}


function renderGallery(){const b=projectBooks(),scores=b.map(score).filter(Boolean),avg=scores.length?(scores.reduce((a,b)=>a+b)/scores.length).toFixed(1):'0.0';return heading('画廊展厅','让每一个灵感，成为值得珍藏的连续画面。',btn('导入工程','upload','import-project')+btn('新建画册','plus','new-book','','primary'),'YOUR STORIES, FRAME BY FRAME.')+`<section class="metrics" aria-label="项目统计">${[['folder','创作企划',state.projects.length,'个企划'],['book','连续画册',b.length,b.filter(b=>b.status==='complete').length+' 本已完成'],['image','已生成分镜',b.reduce((a,b)=>a+b.generatedSteps,0),'帧画面'],['shield','平均审校得分',avg,'/ 10 · 演示']].map(m=>`<div class="metric"><div class="metric-label">${icon(m[0])}${m[1]}</div><strong>${typeof m[2]==='number'?pad(m[2]):m[2]}</strong><small>${m[3]}</small></div>`).join('')}</section><div class="tabbar"><button class="tab ${ui.filter!=='starred'?'active':''}" data-act="gallery-tab" data-filter="all">全部画册 <b>${b.length}</b></button><button class="tab ${ui.filter==='starred'?'active':''}" data-act="gallery-tab" data-filter="starred">${icon('star','sm')}星标收藏 <b>${b.filter(b=>b.liked).length}</b></button><button class="tab" data-act="recent">最近编辑</button><div class="spacer"></div>${btn('批量管理','check','toggle-bulk','','ghost small')}</div><div class="gallery-controls"><div class="search-field">${icon('search')}<input id="gallery-search" value="${esc(ui.search)}" placeholder="搜索画册、角色、标签或故事内容..." aria-label="搜索画册"></div><div class="spacer"></div><select id="gallery-filter" aria-label="状态筛选">${[['all','全部状态'],['complete','已完成'],['generating','渲染中 / 排队'],['failed','失败 / 待补齐'],['starred','星标收藏']].map(x=>opt(...x,ui.filter)).join('')}</select><select id="gallery-sort" aria-label="画册排序">${[['createdAt','创建时间 ↓'],['updatedAt','最近更新 ↓'],['totalSteps','分镜数量 ↓'],['score','审校评分 ↓']].map(x=>opt(...x,ui.sort)).join('')}</select><div class="view-toggle"><button class="ibtn ${ui.layout==='grid'?'on':''}" data-act="layout" data-layout="grid" aria-label="网格视图">${icon('grid','sm')}</button><button class="ibtn ${ui.layout==='list'?'on':''}" data-act="layout" data-layout="list" aria-label="列表视图">${icon('list','sm')}</button></div></div><div id="gallery-results">${galleryResults()}</div><div class="gallery-note">每一帧，都是故事的一部分。</div>`}


function filteredBooks(){let b=projectBooks().filter(b=>ui.filter==='all'||ui.filter==='starred'&&b.liked||ui.filter==='failed'&&(b.status==='failed'||missingIndices(b).length)||b.status===ui.filter);const q=ui.search.trim().toLowerCase();if(q)b=b.filter(b=>[b.title,b.characterName,b.templateTitle,b.synopsis,...b.tags,...b.steps.map(s=>s.caption)].join(' ').toLowerCase().includes(q));return b.sort((a,b)=>ui.sort==='score'?score(b)-score(a):(b[ui.sort]||0)-(a[ui.sort]||0))}


function galleryResults(){const b=filteredBooks(),n=ui.selected.size;return`${n?`<div class="bulk-bar"><span>已选择 ${n} 本</span>${btn('全选','','select-all','','small')}${btn('星标','star','bulk-star','','small')}${btn('导出','download','bulk-export','','small')}${btn('补齐','refresh','bulk-resume','','small')}${btn('删除','trash','bulk-delete','','small danger')}<div class="spacer"></div>${ibtn('close','clear-selection','取消选择')}</div>`:''}<div class="result-count"><i class="dot" style="width:4px;height:4px;opacity:.55"></i>${b.length} 本画册<span style="margin-left:auto">${esc(project().title)} <span style="opacity:.4;margin-left:5px">/ PRIVATE COLLECTION</span></span></div><div class="gallery-grid ${ui.layout==='list'?'gallery-list':''} ${ui.bulk?'bulk-active':''}">${b.length?b.map(bookCard).join(''):`<div class="empty">${icon('book')}<h3>故事，等待第一帧</h3><p>${ui.search?'试试其他关键词，或清除筛选。':'从一个角色、一份剧本开始，创建你的第一本画册。'}</p>${btn('新建画册','plus','new-book','','primary')}</div>`}</div>`}


function bookCard(b,i){const missing=missingIndices(b),status=b.inProgress?'渲染中':b.status==='complete'&&!missing.length?'已完成':b.status==='generating'?'等待渲染':'待补齐';return`<article class="book-card ${ui.selected.has(b.id)?'selected':''}" style="--i:${i}"><div class="cover" role="button" tabindex="0" data-act="read" data-id="${b.id}" aria-label="阅读 ${esc(b.title)}">${imgTag(coverImage(b),b.title,`data-book="${b.id}" data-step="0" loading="${i<4?'eager':'lazy'}"`)}<div class="cover-top"><span class="cover-status"><i class="dot ${status==='已完成'?'':'amber'}"></i>${status}</span><button class="cover-star ${b.liked?'on':''}" data-act="star" data-id="${b.id}" aria-label="${b.liked?'取消星标':'星标收藏'}">${icon('star')}</button></div><label class="cover-check"><input type="checkbox" data-select-book="${b.id}" ${ui.selected.has(b.id)?'checked':''} aria-label="选择 ${esc(b.title)}"></label><div class="cover-foot"><span class="row" style="gap:4px">${icon('story')}${b.generatedSteps} / ${b.totalSteps} 幕</span><span class="chapter-label">${score(b)?'A / '+score(b).toFixed(1):'IN PROGRESS'}</span></div></div><div class="book-title"><h3>${esc(b.title)}</h3>${ibtn('more','book-menu','画册操作',`data-id="${b.id}"`)}</div><p class="book-desc">${esc(b.synopsis)}</p><div class="book-meta"><span class="character-dot">${esc(b.characterName[0])}</span><span>${esc(b.characterName)}</span><span style="opacity:.4">·</span><span>${esc(b.tags[0]||'原创')}</span><time>${dateFmt(b.createdAt)}</time></div>${missing.length?btn('断点补齐 · '+missing.length+' 帧','refresh','resume',`data-id="${b.id}"`,'resume'):''}</article>`}


function refreshGallery(){if(ui.workspace===0&&$('#gallery-results')){$('#gallery-results').innerHTML=galleryResults();applyArtworkRatios();const books=projectBooks(),scores=books.map(score).filter(Boolean),values=[pad(state.projects.length),pad(books.length),pad(books.reduce((n,b)=>n+b.generatedSteps,0)),scores.length?(scores.reduce((a,b)=>a+b)/scores.length).toFixed(1):'0.0'];$$('.metric strong').forEach((e,i)=>e.textContent=values[i]);const completed=$$('.metric small')[1];if(completed)completed.textContent=books.filter(b=>b.status==='complete').length+' 本已完成';const tabs=$$('.tabbar .tab b');if(tabs[0])tabs[0].textContent=books.length;if(tabs[1])tabs[1].textContent=books.filter(b=>b.liked).length}}


function templateSelect(id,cur){return`<select id="${id}" aria-label="选择模板">${projectTemplates().map(t=>opt(t.id,t.title,cur)).join('')}</select>`}


function renderStoryboard(){const t=currentTemplate();if(!t)return heading('分镜剧本配置','每一个好故事，都从第一个镜头开始。',btn('新建模板','plus','new-template','','primary'))+`<div class="empty">${icon('story')}<p>当前企划还没有模板。</p></div>`;ui.templateId=t.id;ui.frameIndex=clamp(ui.frameIndex,0,t.frames.length-1);const f=t.frames[ui.frameIndex];return heading('分镜剧本配置','编排叙事节奏，让每个镜头各就其位。',btn('导入 JSON','upload','import-template')+btn('新建模板','plus','new-template','','primary'),'STORYBOARD / PANEL STUDIO')+`<div class="row" style="margin-bottom:20px"><div style="width:290px">${templateSelect('template-select',t.id)}</div><span class="chip">${t.frames.length} 幕</span><div class="spacer"></div>${btn('复制模板','copy','clone-template')}${btn('导出','download','export-template')}${btn('AI 精修','spark','assistant')}</div><div class="split-view"><aside class="panel timeline"><div class="timeline-top row between">连续分镜时间线 <span class="muted mono tiny">${pad(t.frames.length)} SCENES</span></div>${t.frames.map((f,i)=>`<button class="scene-item ${i===ui.frameIndex?'active':''}" data-act="scene" data-index="${i}" draggable="true" data-drag-index="${i}"><span class="scene-number">${pad(i+1)}</span><div class="grow"><strong>${esc(f.name)}</strong><small>${esc(f.camera)} · ${f.status==='generated'?'已生成':f.status==='warning'?'审校预警':'待生成'}</small></div></button>`).join('')}${btn('新增一幕','plus','add-frame','style="margin:13px"','ghost small')}</aside><div class="stack"><section class="panel"><div class="scene-editor-head row"><div class="grow"><div class="eyebrow">SCENE ${pad(ui.frameIndex+1)} / ${pad(t.frames.length)}</div><h2>${esc(f.name)}</h2></div>${ibtn('up','move-frame','向前移动','data-dir="-1"')}${ibtn('down','move-frame','向后移动','data-dir="1"')}${ibtn('copy','clone-frame','克隆当前幕')}${ibtn('trash','delete-frame','删除当前幕')}</div><div class="grid2">${field('分镜名称',input('name',f.name,'text','data-frame-field="name"'))}${field('景别 / CAMERA',`<select data-frame-field="camera">${['Close-up','Medium Shot','Full Shot','Low Angle','High Angle'].map(x=>opt(x,{'Close-up':'特写 · Close-up','Medium Shot':'中景 · Medium Shot','Full Shot':'全景 · Full Shot','Low Angle':'仰角 · Low Angle','High Angle':'俯瞰 · High Angle'}[x],f.camera)).join('')}</select>`)}</div>${field('正向提示词 / POSITIVE PROMPT',`<textarea id="frame-prompt" class="prompt-area" data-frame-field="prompt">${esc(f.prompt)}</textarea><div>${['character','outfit','style',...state.customColumns,'camera','action'].map(m=>`<button class="macro" data-act="insert-prompt" data-value="{${m}}">{${m}}</button>`).join('')}</div>`,'宏变量将从角色矩阵根对象读取，并在提交时精确替换。')}${field('剧情台词 / CAPTION',`<textarea data-frame-field="caption" style="min-height:75px">${esc(f.caption)}</textarea>`)}${field('负向提示词 / NEGATIVE PROMPT',`<textarea data-frame-field="negative" style="min-height:64px" placeholder="留空则继承全局负向提示词">${esc(f.negative)}</textarea>`)}<div class="divider"></div><h3 class="panel-title">${icon('settings')}分镜渲染规格 <span class="chip" style="margin-left:auto">覆盖工作流默认值</span></h3><div class="editor-options">${[['width','宽度',256,4096,64],['height','高度',256,4096,64],['steps','采样步数',1,150,1],['cfg','CFG Scale',0,30,.1],['denoise','Denoise',0,1,.05],['seed','Seed / -1 随机',-1,9007199254740991,1]].map(([k,l,min,max,step])=>field(l,input(k,f[k],'number',`data-frame-field="${k}" min="${min}" max="${max}" step="${step}"`))).join('')}</div></section><section class="panel"><h3 class="panel-title">${icon('spark')}全局提示词修饰库</h3>${[['赛璐珞','cel shading, clean lineart'],['厚涂质感','painterly, impasto brush strokes'],['电影感风光','cinematic sky, detailed clouds, dramatic light'],['水墨黑白','monochrome manga, ink wash'],['柔和逆光','soft backlighting, rim light'],['胶片颗粒','subtle film grain'],['高精度细节','highly detailed, sharp focus']].map(([l,v])=>`<button class="modifier" data-act="insert-prompt" data-value=", ${v}">${l}</button>`).join('')}<div class="divider"></div>${field('模板标题',input('templateTitle',t.title,'text','data-template-field="title"'))}${field('全局故事主线',`<textarea data-template-field="outline">${esc(t.outline)}</textarea>`)}</section></div></div>`}


function renderMatrix(){return heading('批量角色矩阵','一个故事，多种可能。让角色与变量驱动连续创作。',btn('新增变量列','plus','column-add')+btn('追加角色','users','add-row','','primary'),'PRODUCTION / CHARACTER MATRIX')+`<div class="row wrap" style="margin-bottom:18px"><div style="width:260px">${templateSelect('batch-template',ui.templateId)}</div><span class="chip">${projectRows().filter(r=>r.active).length} 个角色已勾选</span><div class="spacer"></div>${btn(rt.llmBusy?'停止剧本推演':'批量推演剧本',rt.llmBusy?'stop':'spark',rt.llmBusy?'stop-llm':'batch-story')}${btn('加入渲染队列','plus','enqueue')}${btn('开始批量渲染','play','start-batch','','primary')}</div><div class="panel table-panel"><div class="matrix-scroll"><table class="matrix"><thead><tr><th><input type="checkbox" id="matrix-all" aria-label="全选角色" ${projectRows().length&&projectRows().every(r=>r.active)?'checked':''}></th><th>画册标题</th><th>角色 {character}</th><th>画风 {style}</th><th>服装 {outfit}</th>${state.customColumns.map(c=>`<th>{${esc(c)}} ${ibtn('edit','column-edit','编辑变量列',`data-key="${esc(c)}"`)}</th>`).join('')}<th>剧本 / 操作</th></tr></thead><tbody>${projectRows().map(r=>`<tr><td><input type="checkbox" data-row-active="${r.id}" aria-label="选择 ${esc(r.character)}" ${r.active?'checked':''}></td>${['bookTitle','character','style','outfit',...state.customColumns].map(k=>`<td>${input(k,r[k]??'','text',`data-row="${r.id}" data-row-field="${esc(k)}" aria-label="${esc(k)}"`)}</td>`).join('')}<td><div class="row" style="gap:2px">${ibtn('story','script-modal','编辑专属剧本',`data-id="${r.id}"`)}${ibtn('users','character-modal','角色立绘与 LoRA',`data-id="${r.id}"`)}${ibtn('trash','delete-row','删除角色',`data-id="${r.id}"`)}</div></td></tr>`).join('')}</tbody></table></div><div class="table-foot row"><span class="tiny muted">变量平铺存储 · 按角色与模板隔离剧情版本</span><div class="spacer"></div>${btn('追加角色','plus','add-row','','ghost small')}</div></div><div class="queue-top"><h2>工业化渲染队列</h2><span class="chip">${state.queue.filter(q=>['pending','running'].includes(q.status)).length} 个待执行</span><div class="spacer"></div>${btn('巡检补齐','refresh','scan-resume','','small')}${btn(rt.paused?'继续':'暂停',rt.paused?'play':'pause','pause-queue','','small')}${btn('物理中断','stop','interrupt','','small danger')}</div><div class="panel table-panel" id="queue-list">${queueHTML()}</div><div class="terminal"><div class="terminal-head">${icon('terminal','sm')}EXECUTION LOG<span class="spacer"></span><select id="log-filter" style="width:90px;height:24px;font-size:9px">${opt('all','全部日志',ui.logFilter)}${opt('error','仅错误',ui.logFilter)}</select>${ibtn('copy','copy-logs','复制日志')}</div><div class="terminal-body" id="log-body"></div></div>`}


function queueHTML(){const q=state.queue.filter(q=>bookBy(q.bookId)).slice(-10).reverse();return q.length?q.map(q=>{const b=bookBy(q.bookId),pct=q.indices.length?Math.round(q.done/q.indices.length*100):100;return`<div class="queue-item">${imgTag(coverImage(b),b.title,`class="queue-thumb" data-book="${b.id}" data-step="0"`)}<div class="grow"><h4>${esc(b.title)}</h4><div class="tiny muted mono">${esc(q.id.slice(-12))} · ${q.done} / ${q.indices.length} 幕</div></div><div class="queue-progress"><div class="row between tiny"><span class="soft">${({pending:'等待执行',running:'正在渲染',paused:'已暂停',complete:'已完成',canceled:'已中止',failed:'执行失败'})[q.status]}</span><span class="mono muted">${pct}%</span></div><div class="progress"><i style="width:${pct}%"></i></div><div class="tiny muted" style="margin-top:7px">${q.status==='running'&&state.settings.comfy.mode==='mock'?'预计剩余 '+Math.max(1,q.indices.length-q.done)*2+' 秒':'已就绪帧将被保留'}</div></div>${ibtn('book','read','查看画册',`data-id="${b.id}"`)}</div>`}).join(''):`<div class="empty" style="padding:28px">队列为空。勾选角色，把灵感交给生产线。</div>`}


function renderLogs(){if(!$('#log-body'))return;$('#log-body').innerHTML=rt.logs.filter(l=>ui.logFilter==='all'||l.level==='error').map(l=>`<div class="log-${l.level}"><span class="log-time">${new Date(l.time).toLocaleTimeString('en-GB')}</span>${esc(l.message)}</div>`).join('')||'<div class="muted">等待新的生产任务...</div>';$('#log-body').scrollTop=$('#log-body').scrollHeight}


function updateQueueUI(){if($('#queue-list'))$('#queue-list').innerHTML=queueHTML();renderStatus();const n=$('.top-queue b');if(n)n.textContent=state.queue.filter(q=>['pending','running'].includes(q.status)).length;refreshGallery()}


function setting(path,value,type='text',extra=''){return input(path,value,type,`data-setting="${path}" ${extra}`)}


function renderEngine(){const c=state.settings.comfy,w=c.workflow,m=c.mapping;const bind=(key,label)=>field(label,`<select data-setting="comfy.mapping.${key}">${opt('','未绑定（可选）',m[key])}${Object.entries(w).map(([id,n])=>opt(id,'#'+id+' · '+n.class_type,m[key])).join('')}</select>`);return heading('ComfyUI 引擎管线','从提示词到画面，构建可追溯的生成链路。',btn('导入工作流','upload','import-workflow')+btn('单帧试跑','play','dry-run','','primary'),'WORKFLOW / ENGINE ROOM')+`<div class="pipeline-grid"><div class="stack"><section class="panel"><h3 class="panel-title">${icon('nodes')}引擎连接 <span class="chip green" style="margin-left:auto">${c.mode==='mock'?'OFFLINE SVG':'REAL GPU'}</span></h3>${field('运行模式',`<select data-setting="comfy.mode">${opt('mock','本地确定性 SVG 演示引擎',c.mode)}${opt('real','真实 ComfyUI GPU 服务',c.mode)}</select>`)}${field('服务端地址',setting('comfy.baseUrl',c.baseUrl))}<div class="row">${btn('测试连接','refresh','test-engine')}<span class="tiny muted" id="connection-result">${rt.connected?'已连接 · '+rt.latency+' ms'+(rt.vram!==null?' · VRAM '+rt.vram+'%':''):'尚未连接真实 GPU'}</span></div><div class="divider"></div><label class="row small soft"><input type="checkbox" data-setting="comfy.autoFallback" ${c.autoFallback?'checked':''}>真实服务不可用时，自动回退到离线演示</label><div class="notice amber" style="margin-top:17px">跨域连接需使用 <code>python main.py --enable-cors-header</code> 启动 ComfyUI。请仅在可信本地网络使用。基础蓝图中的模型文件名需要替换为实际模型。</div></section><section class="panel"><h3 class="panel-title">${icon('image')}单帧验证预览</h3><div class="preview-box" id="dry-preview">${rt.preview?imgTag(rt.preview,'单帧试跑结果'):icon('image')+'<p>运行一帧，验证你的创作管线</p>'}</div></section></div><div class="stack"><section class="panel"><h3 class="panel-title">${icon('nodes')}智能节点映射器</h3>${field('工作流名称',setting('comfy.workflowTitle',c.workflowTitle))}<div class="row" style="margin-bottom:15px"><select id="workflow-preset" aria-label="工作流预设">${opt('','选择已保存的蓝图','')}${c.presets.map((p,i)=>opt(i,p.title,'')).join('')}</select>${btn('保存预设','disk','save-workflow','','small')}</div><div class="node-chain"><div class="node-box">Text Encode<small>#${esc(m.positive)}</small></div><span class="node-line"></span><div class="node-box">KSampler<small>#${esc(m.sampler)}</small></div><span class="node-line"></span><div class="node-box">VAE Decode<small>LATENT → RGB</small></div><span class="node-line"></span><div class="node-box">Save Image<small>#${esc(m.output)}</small></div></div><div class="binding-grid">${bind('positive','正向提示词节点')}${bind('negative','负向提示词节点')}${field('正向文本字段',setting('comfy.mapping.positiveField',m.positiveField))}${field('负向文本字段',setting('comfy.mapping.negativeField',m.negativeField))}${bind('sampler','采样器 / KSampler')}${bind('size','尺寸 / EmptyLatentImage')}${bind('output','输出 / SaveImage')}${bind('image','图像输入 / LoadImage（精修可选）')}</div><div class="help">text、opt_text、text_g 均可绑定。图生图 / 蒙版精修需导入含 VAEEncode 或 VAEEncodeForInpaint 的蓝图，再绑定 LoadImage。</div><div class="divider"></div>${btn('编辑 API JSON','edit','edit-workflow')}${btn('导出蓝图','download','export-workflow','style="margin-left:8px"')}</section></div></div>`}


function renderStoryStudio(){const cfg=state.settings.llm;let row=rowBy(ui.storyRowId)||projectRows()[0],t=templateBy(ui.storyTemplateId)||currentTemplate();if(row)ui.storyRowId=row.id;if(t)ui.storyTemplateId=t.id;const v=activeVersion(row,t?.id);return heading('LLM 剧情策划台','从一个灵感，到一段值得被画出来的故事。',btn('连接设置','settings','llm-settings')+btn('创作助手','spark','assistant','','primary'),'NARRATIVE / STORY STUDIO')+`<div class="tabbar" style="margin-bottom:23px"><button class="tab ${ui.llmTab==='story'?'active':''}" data-act="llm-tab" data-tab="story">角色剧情策划</button><button class="tab ${ui.llmTab==='xml'?'active':''}" data-act="llm-tab" data-tab="xml">XML 模板生成器</button><div class="spacer"></div><span class="chip green">${cfg.mode==='mock'?'离线规则推演':esc(cfg.model)}</span></div>${ui.llmTab==='xml'?renderXMLStudio():!row||!t?'<div class="empty">请先在角色矩阵中添加角色，并创建分镜模板。</div>':`<div class="pipeline-grid"><section class="panel" style="align-self:start"><h3 class="panel-title">${icon('spark')}故事的起点</h3><div class="grid2">${field('目标角色',`<select id="story-row">${projectRows().map(r=>opt(r.id,r.character,row.id)).join('')}</select>`)}${field('应用模板',templateSelect('story-template',t.id))}</div>${field('核心梗概',`<textarea id="story-outline" placeholder="描述你想讲述的故事...">${esc(row.storyOutline||t.outline)}</textarea>`)}<div class="grid2">${field('主题基调',input('tone',row.tone||'温柔、治愈、青春','text','id="story-tone"'))}${field('分段幕数 / Chunk Size',setting('llm.chunkSize',cfg.chunkSize,'number','min="2" max="6"'))}</div><div class="notice">按 ${t.frames.length} 幕生成，保留前序剧情作为上下文。每次生成都会创建独立版本，不覆盖旧稿。</div><div class="row" style="margin-top:20px">${btn(rt.llmBusy?'停止推演':'推演整套剧情',rt.llmBusy?'stop':'spark',rt.llmBusy?'stop-llm':'generate-story','','primary')}${btn('生成大纲','edit','generate-outline')}</div><div class="help" id="story-progress">${rt.llmBusy?'正在分段推演并自动保存...':'当前模板：'+esc(t.title)}</div></section><section class="panel"><div class="row" style="margin-bottom:16px"><h3 class="panel-title" style="margin:0">${icon('story')}剧情版本</h3><div class="spacer"></div>${btn('新建手稿','plus','new-story-version','','small')}</div><select id="story-version" aria-label="剧情版本">${(row.storyVersions[t.id]||[]).map(x=>opt(x.id,x.title+' · '+x.source,v?.id)).join('')||'<option>尚无专属版本，使用模板默认旁白</option>'}</select><div id="story-frames">${t.frames.map((f,i)=>`<div class="story-frame"><div class="row"><span class="tiny mono muted">${pad(i+1)}</span><h4 class="grow">${esc(f.name)}</h4>${ibtn('refresh','regenerate-scene','单幕重新推演',`data-index="${i}"`)}</div><textarea data-story-caption="${i}">${esc(captionFor(row,t,i))}</textarea></div>`).join('')}</div><div class="modal-footer">${btn('保存台词','disk','save-story')}${btn('载入分镜工作台','arrow','load-story','','primary')}</div></section></div>`}`}


function renderXMLStudio(){return`<div class="pipeline-grid"><section class="panel" style="align-self:start"><h3 class="panel-title">${icon('story')}从 0 到 1 设计模板</h3>${field('题材与构思',`<textarea id="xml-idea" placeholder="例如：一位少女在废弃的海边车站，收到来自十年后的信。">${esc(ui.xmlIdea||'夏日的海边，一封来自未来的信。')}</textarea>`)}${field('篇幅幕数',`<select id="xml-count">${[4,6,8,12].map(n=>opt(n,n+' 幕',ui.xmlCount||6)).join('')}</select>`)}<label class="row small soft"><input type="checkbox" data-setting="xml.separate" ${state.settings.xml.separate?'checked':''}>使用独立大模型配置</label><div style="margin-top:16px">${field('独立 Base URL',setting('xml.baseUrl',state.settings.xml.baseUrl))}${field('独立模型名称',setting('xml.model',state.settings.xml.model))}${field('独立 API Key',setting('xml.key',state.settings.xml.key,'password'))}</div><div class="help">生成请求自动替换 {panelCount}，严格校验中文 XML 根节点与逐幕字段。</div><div class="row" style="margin-top:18px">${btn('生成 XML 模板','spark','generate-xml','','primary')}</div></section><section class="panel"><h3 class="panel-title">${icon('terminal')}标准 XML 编辑与校验</h3><textarea id="xml-output" class="code-area" spellcheck="false" placeholder="生成或粘贴标准 XML 模板...">${esc(ui.xmlOutput||'')}</textarea><div class="notice" style="margin-top:16px">必须包含「模板 / 标题 / 简介 / 分镜列表」，每幕必须包含「名称 / 提示词 / 剧情」。</div><div class="modal-footer">${btn('校验结构','shield','validate-xml')}${btn('转录为正式模板','plus','import-xml','','primary')}</div></section></div>`}


function scriptModal(id){const r=rowBy(id),t=currentTemplate();if(!t)throw Error('请先创建模板。');ui.scriptRow=id;ui.scriptTemplate=t.id;const v=ensureManual(r,t);modal(r.character+' · 逐幕台词',`${field('版本名称',input('title',v.title,'text','id="script-title"'))}${t.frames.map((f,i)=>field(pad(i+1)+' · '+esc(f.name),`<textarea data-script-caption="${i}" style="min-height:65px">${esc(v.captions[i]||captionFor(r,t,i))}</textarea>`)).join('')}<div class="modal-footer">${btn('为此角色重新推演','spark','script-regenerate')}${btn('保存专属剧本','disk','script-save','','primary')}</div>`,t.title+' · 剧情按角色 × 模板独立存储')}


function llmSettings(){const c=state.settings.llm;modal('大模型连接设置',`${field('运行模式',`<select data-setting="llm.mode">${opt('mock','离线规则模拟（不调用 API）',c.mode)}${opt('real','OpenAI 兼容 API',c.mode)}</select>`)}${field('服务商预设',`<select id="llm-provider">${[['openai','OpenAI'],['deepseek','DeepSeek'],['ollama','Ollama 本地'],['custom','自定义兼容网关（含 Claude）']].map(x=>opt(...x,c.provider)).join('')}</select>`)}${field('Base URL',setting('llm.baseUrl',c.baseUrl))}${field('API Key',setting('llm.key',c.key,'password'))}${field('模型名称',setting('llm.model',c.model))}<div class="notice amber">密钥仅存于此浏览器。真实调用会将指定文本和图片发送至配置的服务商。请使用可信的 OpenAI 兼容端点，Anthropic 原生协议不适用。</div><div class="modal-footer">${btn('测试连接','refresh','test-llm')}${btn('保存并关闭','check','close-modal','','primary')}</div>`,'使用 POST /chat/completions，支持多模态和工具调用')}


async function interruptQueue(){rt.controller?.abort();rt.paused=false;for(const q of state.queue)if(['pending','paused'].includes(q.status)){q.status='canceled';const b=bookBy(q.bookId);if(b)b.status='canceled'}if(state.settings.comfy.mode==='real'){const results=await Promise.allSettled([request(baseURL()+'/interrupt',post({}),5000),request(baseURL()+'/queue',post({clear:true}),5000)]);log(results.every(x=>x.status==='fulfilled')?'已物理中断 GPU 并清空服务端队列。':'本地任务已停，部分物理中断请求失败，请检查 ComfyUI。',results.every(x=>x.status==='fulfilled')?'info':'warn')}save();updateQueueUI()}


async function dryRun(){flushEditor();const t=currentTemplate(),r=projectRows()[0];if(!t||!r)throw Error('请先创建一个角色和模板。');if($('#dry-preview'))$('#dry-preview').innerHTML='<i class="dot live"></i><p>正在执行单帧验证...</p>';try{const result=await generateFrame(t.frames[0],r,new AbortController().signal,0);rt.preview=result.image;if($('#dry-preview'))$('#dry-preview').innerHTML=imgTag(result.image,'测试出图');toast(result.offlineFallback?'GPU 失败，显示本地降级预览。':'单帧测试完成')}catch(e){if($('#dry-preview'))$('#dry-preview').textContent=e.message;throw e}}


function llmMock(cfg=state.settings.llm){return cfg.mode==='mock'}


async function chatCompletion(messages,tools,signal,cfg=state.settings.llm){const url=cfg.baseUrl.replace(/\/+$/,'')+'/chat/completions',body={model:cfg.model,messages,temperature:.75};if(tools){body.tools=tools;body.tool_choice='auto'}const headers={'Content-Type':'application/json'};if(cfg.key)headers.Authorization='Bearer '+cfg.key;const response=await request(url,{method:'POST',headers,body:JSON.stringify(body),signal},90000),json=await response.json(),msg=json.choices?.[0]?.message;if(!msg||msg.role!=='assistant')throw Error('兼容 API 未返回合法的 assistant 消息。');if(msg.tool_calls&&(!Array.isArray(msg.tool_calls)||msg.tool_calls.some(c=>typeof c.id!=='string'||!c.function||typeof c.function.name!=='string'||typeof c.function.arguments!=='string')))throw Error('模型工具调用协议不完整，已拒绝写入会话。');return msg}


function parseJson(text){const raw=String(text).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();return JSON.parse(raw)}


function xmlEscape(s){return esc(s).replace(/&#39;/g,'&apos;')}


function slots(b){return readerSequence(b)}


function preserveFloating(){for(const id of ['#assistant','#toasts']){const el=$(id);if(el&&$('#reader').contains(el))document.body.append(el)}}


function openReader(id){flushEditor();const b=bookBy(id);if(!b)throw Error('画册不存在。');preserveFloating();ui.bookId=id;ui.step=0;renderReader();if(!$('#reader').open)$('#reader').showModal();if(!$('#assistant').hidden)$('#reader').append($('#assistant'))}


function closeReader(){rt.observer?.disconnect();if($('#assistant'))document.body.append($('#assistant'));if($('#toasts'))document.body.append($('#toasts'));$('#reader').close();ui.bookId=null;refreshGallery()}


function renderReader(){const b=bookBy(ui.bookId);if(!b)return;const variants=state.books.filter(x=>x.rowId===b.rowId&&x.templateId===b.templateId&&x.projectId===b.projectId);$('#reader').innerHTML=`<header class="reader-header">${ibtn('close','close-reader','关闭阅读器')}<div class="reader-title grow"><h2>${esc(b.title)}</h2><div class="tiny muted" style="margin-top:5px">${esc(b.characterName)} · ${b.totalSteps} 幕</div></div><select id="reader-version" aria-label="切换剧情画册">${variants.map(x=>opt(x.id,x.storyTitle||x.title,b.id)).join('')}</select><div class="reader-modes">${[['focus','单页'],['manga','Manga 双页'],['webtoon','Webtoon'],['flip','3D 翻页']].map(([v,l])=>btn(l,'','reader-mode',`data-mode="${v}"`,ui.mode===v?'on':'')).join('')}</div>${ibtn('list','toggle-inspector','显示分镜检查器')}${btn('导出画册','download','export-book',`data-id="${b.id}"`,'small reader-export')}</header><div class="reader-layout"><section class="reader-stage"><div class="reader-canvas" id="reader-canvas"></div><div class="reader-pagination">${ibtn('up','page-prev','上一页')}<span id="page-position"></span>${ibtn('down','page-next','下一页')}</div></section><aside class="reader-inspector"><div class="inspector-label row">${icon('story','sm')}分镜检查器 <span class="spacer"></span><span class="mono tiny">${pad(b.totalSteps)} PANELS</span></div>${slots(b).map((s,i)=>`<section class="inspector-step ${i===ui.step?'active':''}" data-inspector="${i}"><button class="inspector-step-head" data-act="reader-step" data-index="${i}">${imgTag(s.image,s.name,`data-page-img="${b.id}:${i}" data-book="${b.id}" data-step="${i}"`)}<span class="grow"><strong>${esc(s.name)}</strong><small>SCENE ${pad(i+1)} ${s.pending?' / PENDING':''}</small></span>${icon('down','sm')}</button><div class="inspector-content"><p class="caption">${esc(s.caption)}</p><div class="row">${btn('审校本页','shield','critique',`data-index="${i}" ${s.pending?'disabled':''}`,'small')}${btn('图片替换','upload','replace-page',`data-index="${i}"`,'small')}</div><div id="critique-${i}">${critiqueHTML(s.critique,i)}</div><div class="divider"></div><label class="label">精修提示词 / REFINEMENT</label><textarea id="refine-${i}" placeholder="描述希望调整的细节...">${esc(s.prompt)}</textarea><div class="row tiny soft" style="margin:12px 0">Denoise <input type="range" min="0" max="1" step=".05" value=".45" id="denoise-${i}" aria-label="重绘强度"><span id="denoise-value-${i}">0.45</span></div><div class="row">${btn('精修重绘','brush','redraw',`data-index="${i}"`,'small primary')}${btn('局部蒙版','edit','mask',`data-index="${i}"`,'small')}</div><div class="help">${state.settings.comfy.mode==='mock'?'离线矢量模拟：输出可复现的新画面。':'局部精修需要绑定图像输入与蒙版工作流。'}</div></div></section>`).join('')}</aside></div>`;renderReaderCanvas()}


function pageHTML(b,s){return s?`<div class="page-art ${rt.redraw.has(b.id+':'+s.stepIndex)?'loading':''}" data-page="${b.id}:${s.stepIndex}">${imgTag(s.image,s.name,`data-page-img="${b.id}:${s.stepIndex}" data-book="${b.id}" data-step="${s.stepIndex}"`)}</div>`:'<div class="page-art"><div class="blank-page">THIS STORY CONTINUES</div></div>'}


function renderReaderCanvas(animate=false){const b=bookBy(ui.bookId);if(!b||!$('#reader-canvas'))return;rt.observer?.disconnect();const list=slots(b),canvas=$('#reader-canvas');ui.step=clamp(ui.step,0,list.length-1);if(ui.mode==='webtoon'){canvas.innerHTML=`<div class="webtoon">${list.map(s=>`<div data-scroll-step="${s.stepIndex}">${pageHTML(b,s)}<div class="page-caption">${esc(s.caption)}</div></div>`).join('')}</div>`;rt.observer=new IntersectionObserver(entries=>{if(Date.now()<(rt.anchorUntil||0))return;const best=entries.filter(x=>x.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(best){ui.step=Number(best.target.dataset.scrollStep);syncInspector()}},{root:canvas,threshold:[.1,.3,.6]});$$('[data-scroll-step]',canvas).forEach(el=>rt.observer.observe(el))}else if(ui.mode==='focus')canvas.innerHTML=`<div class="page-focus">${pageHTML(b,list[ui.step])}</div>`;else{const first=Math.floor(ui.step/2)*2;canvas.innerHTML=`<div class="spread ${ui.mode==='flip'&&animate?'flipping':''}">${pageHTML(b,list[first])}${pageHTML(b,list[first+1])}</div>`}syncInspector()}


function syncInspector(){$$('[data-inspector]',$('#reader')).forEach(e=>{e.classList.toggle('active',Number(e.dataset.inspector)===ui.step);e.classList.toggle('refining',rt.redraw.has(ui.bookId+':'+e.dataset.inspector))});const b=bookBy(ui.bookId);if($('#page-position')&&b)$('#page-position').textContent=pad(ui.step+1)+' / '+pad(b.totalSteps)}


function setReaderStep(i){const b=bookBy(ui.bookId);if(!b)return;ui.step=clamp(i,0,b.totalSteps-1);if(ui.mode==='webtoon'){rt.anchorUntil=Date.now()+800;$(`[data-scroll-step="${ui.step}"]`,$('#reader-canvas'))?.scrollIntoView({behavior:'smooth',block:'start'});syncInspector()}else renderReaderCanvas(ui.mode==='flip')}


function hotReplace(id,i,src){$$('[data-page-img]').filter(el=>el.dataset.pageImg===id+':'+i).forEach(el=>{el.src=src});if(ui.bookId===id){const s=bookBy(id)?.steps.find(s=>s.stepIndex===i),area=$('#critique-'+i),panel=$(`[data-inspector="${i}"]`);if(area)area.innerHTML=critiqueHTML(s?.critique,i);if(s&&panel){$('.inspector-step-head strong',panel).textContent=s.name;$('.inspector-step-head small',panel).textContent='SCENE '+pad(i+1);$('.caption',panel).textContent=s.caption;const critique=$('[data-act="critique"]',panel);if(critique)critique.disabled=false;const webCaption=$(`[data-scroll-step="${i}"] .page-caption`,$('#reader'));if(webCaption)webCaption.textContent=s.caption}}}


function loadingPage(id,i,on){const key=id+':'+i;on?rt.redraw.add(key):rt.redraw.delete(key);$$('[data-page]').filter(e=>e.dataset.page===key).forEach(e=>e.classList.toggle('loading',on));if(ui.bookId===id)$(`[data-inspector="${i}"]`)?.classList.toggle('refining',on);const thumb=$(`[data-page-img="${key}"]`,$('.reader-inspector')||document);if(thumb)thumb.style.opacity=on?'.35':'1'}


function critiqueHTML(c,i){if(!c)return'';return`<div class="score-block"><div class="row"><div class="score-ring" style="--score:${c.score}"><span>${c.score.toFixed(1)}</span></div><div><strong>${c.score>=9?'S':c.score>=8?'A':c.score>=7?'B':'C'} · ${c.passed?'审校通过':'建议精修'}</strong><div class="tiny muted">${state.settings.llm.mode==='mock'?'本地模拟审校':'视觉审校报告'}</div></div></div><p>${esc(c.summary)}</p><details><summary>查看结构与一致性诊断</summary><p><b>解剖：</b>${esc(c.anatomy)}</p><p><b>一致性：</b>${esc(c.consistency)}</p></details><p>${esc(c.suggestions)}</p>${btn('填入重绘框','plus','apply-critique',`data-index="${i}"`,'small ghost')}</div>`}


async function critiqueStep(id,i,automatic=false){
const b=bookBy(id),s=b?.steps.find(s=>s.stepIndex===i);if(!s?.image)throw Error('本页尚未生成。');const key=id+':'+i;if(rt.critiqueBusy.has(key))return;rt.critiqueBusy.add(key);
const snapshot=s.image,area=ui.bookId===id?$('#critique-'+i):null,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),automatic?15000:90000);if(area)area.innerHTML='<p class="help"><i class="dot live"></i> 正在审校画面...</p>';
try{let c;if(llmMock()){await delay(750,controller.signal);const n=7.2+(hash(snapshot)%24)/10;c={score:n,passed:n>=7,summary:'离线模拟审校：画面叙事完整，主角与环境的层次关系清晰。',anatomy:'模拟诊断：建议在真实模型中进一步检查手部、五官与透视。',consistency:'模拟诊断：以角色参考立绘为准核对发色与服装细节。',suggestions:'soft rim lighting, consistent character design, refined hands, detailed eyes'}}
else{let jpg;try{jpg=await rasterJPEG(snapshot)}catch(e){if(s.offlineImage){jpg=await rasterJPEG(s.offlineImage);log('参考封面受跨域限制，审校内置矢量版本。','warn')}else throw e}const content=[{type:'text',text:'角色 '+b.characterName+'；分镜 '+s.name+'；旁白 '+s.caption+'。第一张图片为待审校画面。'},{type:'image_url',image_url:{url:jpg}}],ref=rowBy(b.rowId)?.references?.front;if(ref){content.push({type:'text',text:'以下图片是角色参考立绘，请检查角色与服装一致性。'},{type:'image_url',image_url:{url:await rasterJPEG(ref)}})}const m=await chatCompletion([{role:'system',content:'你是专业漫画视觉审校员。仅返回JSON: {"score":1到10的数字,"passed":布尔,"summary":"整体评价","anatomy":"解剖诊断","consistency":"连续性诊断","suggestions":"具体英文精修提示词"}。严格区分可观察信息与推测，没有参考图时不要声称完成跨帧对照。'},{role:'user',content}],null,controller.signal);c=parseJson(m.content);if(!Number.isFinite(c.score)||['summary','anatomy','consistency','suggestions'].some(k=>typeof c[k]!=='string'))throw Error('审校报告字段不符合数据契约。');c.score=clamp(c.score,1,10);c.passed=c.score>=7}
if(bookBy(id)?.steps.find(x=>x.stepIndex===i)?.image!==snapshot){log('图片已变化，丢弃过期审校报告。','warn');return}s.critique=c;b.updatedAt=Date.now();save();if(ui.bookId===id&&$('#critique-'+i))$('#critique-'+i).innerHTML=critiqueHTML(c,i);return c;
}catch(e){if(area?.isConnected)area.innerHTML=`<p class="help danger">${esc(e.message)}</p>`;throw e}finally{clearTimeout(timer);rt.critiqueBusy.delete(key)}}


async function maskModal(i){const b=bookBy(ui.bookId),s=b?.steps.find(s=>s.stepIndex===i);if(!s)throw Error('请先生成本页。');let jpg;try{jpg=await rasterJPEG(s.image,900)}catch(e){if(!s.offlineImage)throw e;jpg=await rasterJPEG(s.offlineImage,900)}modal('局部蒙版 · 第 '+(i+1)+' 幕',`<div class="notice">在画面上涂抹，透明区域将作为重绘蒙版。真实精修需 LoadImage → VAEEncodeForInpaint 工作流。</div><canvas id="mask-canvas" class="mask-canvas" style="display:block;margin:18px auto;background:repeating-conic-gradient(#888 0 25%,#bbb 0 50%) 0/16px 16px"></canvas><div class="row">画笔大小 <input id="mask-brush" type="range" min="5" max="90" value="35"><span class="spacer"></span>${btn('保存蒙版','check','save-mask',`data-key="${b.id}:${i}"`,'primary')}</div>`);const img=new Image();img.src=jpg;await img.decode();const c=$('#mask-canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);let drawing=false;const draw=e=>{if(!drawing)return;const box=c.getBoundingClientRect();ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc((e.clientX-box.left)*c.width/box.width,(e.clientY-box.top)*c.height/box.height,Number($('#mask-brush').value),0,Math.PI*2);ctx.fill()};c.onpointerdown=e=>{drawing=true;c.setPointerCapture(e.pointerId);draw(e)};c.onpointermove=draw;c.onpointerup=()=>drawing=false;c.onpointercancel=()=>drawing=false}


function exportModal(ids){ui.exportIds=ids.filter(id=>bookBy(id));if(!ui.exportIds.length)throw Error('请选择至少一本画册。');modal('导出你的故事',`<p class="soft small" style="margin:0 0 20px">${ui.exportIds.length===1?esc(bookBy(ids[0]).title):ui.exportIds.length+' 本画册合集'} · 独立 HTML，断网也能阅读</p><div class="export-options">${[['webtoon','list','Webtoon 长卷','流式纵向阅读，适合移动端'],['manga','compare','Manga 双页','经典对开排版，可直接打印'],['artbook','image','Artbook 艺术册','留白展台、色卡与创作者签名'],['flip','book','3D 交互翻页','带纸张光影的独立翻页画册']].map(([v,ic,l,h])=>`<button class="export-option ${v===ui.exportFormat?'active':''}" data-act="export-format" data-format="${v}">${icon(ic)}<span><strong>${l}</strong><small>${h}</small></span></button>`).join('')}</div><div class="divider"></div><div class="grid2">${field('画册主题色','<input id="export-color" type="color" value="#43634b">')}${field('分镜框线 / px','<input id="export-border" type="number" min="0" max="8" value="0">')}${field('创作者签名',input('signature',state.settings.signature,'text','id="export-signature"'))}</div><label class="row small soft"><input type="checkbox" id="export-prompts">附带提示词水印</label><div class="help">分镜严格按 stepIndex 升序编译。所有图片和脚本均内联。在线示例参考图若受跨域限制，将使用对应的内置矢量画面，并在画册中注明。</div><div class="modal-footer"><span class="grow tiny muted" id="export-status">OFFLINE · SELF-CONTAINED</span>${btn('生成并下载画册','download','compile-export','','primary')}</div>`,'每一帧都将被妥善保存',true)}


function standaloneFlip(){document.querySelectorAll('.flipbook').forEach(book=>{const pages=[...book.querySelectorAll('.sheet')];let spread=0;function paint(){pages.forEach((p,i)=>p.hidden=Math.floor(i/2)!==spread);book.querySelector('.counter').textContent=(spread+1)+' / '+Math.ceil(pages.length/2);book.querySelector('.sheets').classList.remove('turn');void book.offsetWidth;book.querySelector('.sheets').classList.add('turn')}book.querySelector('.prev').onclick=()=>{spread=Math.max(0,spread-1);paint()};book.querySelector('.next').onclick=()=>{spread=Math.min(Math.ceil(pages.length/2)-1,spread+1);paint()};paint()})}


async function compileExport(){const theme=$('#export-color').value,watermark=$('#export-prompts').checked,border=clamp(Number($('#export-border').value),0,8),signature=$('#export-signature').value,format=ui.exportFormat,books=ui.exportIds.map(bookBy),sections=[];let fallbackCount=0,done=0;const total=books.reduce((n,b)=>n+b.totalSteps,0);const button=$('[data-act="compile-export"]');button.disabled=true;try{for(const b of books){const pages=[];for(const s of slots(b).sort((a,b)=>a.stepIndex-b.stepIndex)){let data,notice='';try{data=await imageData(s.image)}catch(e){if(!s.offlineImage)throw Error('分镜 '+(s.stepIndex+1)+' 无法内联，请先上传本地图片。');data=s.offlineImage;fallbackCount++;notice='内置矢量版本 · 在线参考图不可离线读取'}if(!data.startsWith('data:'))throw Error('图片未能内联。');let colors='';if(format==='artbook'){try{const jpg=await rasterJPEG(data,64),im=new Image();im.src=jpg;await im.decode();const cv=document.createElement('canvas');cv.width=cv.height=32;const cx=cv.getContext('2d');cx.drawImage(im,0,0,32,32);colors=Array.from({length:5},(_,i)=>{const p=cx.getImageData(4+i*5,12+i*2,1,1).data;return`<i style="background:rgb(${p[0]},${p[1]},${p[2]})"></i>`}).join('')}catch(e){}}pages.push(`<article class="sheet"><img src="${esc(data)}" alt="${esc(s.name)}"><div class="caption"><small>${pad(s.stepIndex+1)} / ${esc(s.name)}</small><p>${esc(s.caption)}</p>${watermark?`<pre>${esc(s.prompt)}</pre>`:''}${notice?`<small>${notice}</small>`:''}${format==='artbook'?`<div class="palette">${colors}</div><div class="signature">${esc(signature)}</div>`:''}</div></article>`);done++;if($('#export-status'))$('#export-status').textContent='正在内联图片 '+done+' / '+total}if((format==='manga'||format==='flip')&&pages.length%2)pages.push('<article class="sheet blank"><span>THIS STORY CONTINUES</span></article>');const cover=`<header><small>MIO / ${esc(format.toUpperCase())}</small><h1>${esc(b.title)}</h1><p>${esc(b.synopsis)}</p><span>${esc(b.characterName)} · ${b.totalSteps} 幕</span></header>`;sections.push(`<section class="collection ${format==='flip'?'flipbook':''}">${cover}<div class="sheets">${pages.join('')}</div>${format==='flip'?'<nav><button class="prev">上一跨页</button><span class="counter"></span><button class="next">下一跨页</button></nav>':''}</section>`)}const html=`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(books.length===1?books[0].title:'Mio 画册合集')}</title><style>*{box-sizing:border-box}body{margin:0;background:${format==='artbook'?'#f0eee7':'#101614'};color:${format==='artbook'?'#273229':'#e4e9df'};font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{text-align:center;padding:64px 24px 45px}header small{font-size:9px;letter-spacing:3px;color:${theme}}h1{font:38px Georgia,serif;letter-spacing:2px}header p{opacity:.6;line-height:1.9}header>span{font-size:10px;opacity:.5}.sheets{max-width:${format==='webtoon'?'720px':'1140px'};margin:auto;${format==='manga'||format==='flip'?'display:grid;grid-template-columns:1fr 1fr;gap:4px;':''}${format==='flip'?'perspective:1800px;':''}}.sheet{margin:0;min-width:0;${format==='artbook'?'padding:70px 120px;background:#f8f7f2;margin-bottom:30px;':''}border:${border}px solid ${theme};break-inside:avoid}.sheet img{display:block;width:100%;height:auto;${format==='flip'?'height:60vh;object-fit:contain;background:#eee9dc;':''}}.caption{padding:22px 28px;background:${format==='artbook'?'#f8f7f2':'#ece9de'};color:#333e33;line-height:1.9}.caption small{font-size:10px;color:${theme};letter-spacing:1px}.caption p{margin:9px 0}.caption pre{font-size:9px;white-space:pre-wrap;opacity:.5}.blank{min-height:65vh;background:#ece9de;color:#a6a294;display:grid;place-items:center;font:11px Georgia;letter-spacing:3px}.palette{display:flex;gap:5px;margin-top:22px}.palette i{width:22px;height:22px;display:block}.signature{font:italic 24px Georgia;color:${theme};text-align:right;margin-top:15px}.collection{margin-bottom:80px}nav{display:flex;justify-content:center;align-items:center;gap:24px;padding:25px}nav button{background:${theme};color:white;border:0;padding:12px 20px;border-radius:4px;cursor:pointer}.counter{font-size:11px}.turn .sheet:nth-child(even){transform-origin:left;animation:turn .65s ease-out}footer{text-align:center;font-size:10px;padding:35px;opacity:.5}[hidden]{display:none!important}@keyframes turn{from{transform:rotateY(-155deg);filter:brightness(.5)}to{transform:rotateY(0);filter:brightness(1)}}@media(max-width:700px){.sheet{padding:${format==='artbook'?'24px':'0'}}h1{font-size:29px}.caption{padding:14px;font-size:11px}.sheet img{height:auto}.blank{min-height:40vh}}@media print{body{background:white;color:black}nav,footer{display:none}header{break-after:page}.sheet{break-inside:avoid}.sheet[hidden]{display:block!important}.collection{margin:0}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style></head><body>${sections.join('')}<footer>${esc(signature)} · Mio · 完全内联离线画册${fallbackCount?' · '+fallbackCount+' 张参考封面使用内置矢量版本':''}</footer>${format==='flip'?'<script>('+standaloneFlip.toString()+')();<'+ '/script>':''}</body></html>`;download((books.length===1?books[0].title:'Mio 合集')+'_'+format+'.html',html,'text/html');toast('离线画册已生成'+(fallbackCount?'，含 '+fallbackCount+' 张矢量替代封面。':'。'));closeModal()}finally{if(button.isConnected)button.disabled=false}}


function renderAssistant(){const c=currentChat();$('#assistant').innerHTML=`<header class="assistant-head" id="assistant-drag">${icon('spark')}<div class="grow"><strong>Comfy 创作助手</strong><small>${llmMock()?'LOCAL INTELLIGENCE · 离线模拟':esc(state.settings.llm.model)}</small></div>${ibtn('expand','assistant-full','展开 / 收起')}${ibtn('close','assistant-close','关闭助手')}</header><div class="assistant-tabs"><select id="chat-select" aria-label="切换会话">${state.chats.map(c=>opt(c.id,c.title,state.activeChatId)).join('')}</select>${ibtn('plus','new-chat','新建会话分支')}</div><div class="chat-messages" id="chat-messages">${c.messages.map(m=>{if(m.role==='tool')return'';if(m.tool_calls)return`<details class="tool-result"><summary>已处理 ${m.tool_calls.length} 项工具操作</summary><pre>${esc(m.tool_calls.map(t=>t.function.name).join('\n'))}</pre></details>`;const text=typeof m.content==='string'?m.content:(m.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');return`<div class="chat-bubble ${m.role==='user'?'user':''}">${esc(text)}</div>`}).join('')}${rt.chatBusy?'<div class="chat-bubble"><i class="dot live"></i> 正在思考与编排...</div>':''}</div><div class="chat-compose"><div class="attachments" id="chat-attachments">${rt.attachments.map((a,i)=>`<span class="row">${a.image?imgTag(a.image,a.name):icon('attach','sm')}${esc(a.name)}${ibtn('close','remove-attachment','移除附件',`data-index="${i}"`)}</span>`).join('')}</div><textarea id="chat-input" placeholder="描述你想调整的分镜，或拖入参考图..." aria-label="输入给助手的指令"></textarea><div class="row" style="margin-top:6px">${ibtn('attach','chat-attach','上传图片、TXT 或 DOCX')}<span class="tiny muted grow">Enter 发送 · Shift + Enter 换行</span>${btn('发送','send','send-chat',rt.chatBusy?'disabled':'','small primary')}</div></div>${['n','s','e','w','ne','nw','se','sw'].map(d=>`<i class="resize-handle ${d}" data-resize="${d}"></i>`).join('')}`;$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;setupAssistantPointer()}


function showAssistant(){flushEditor();if($('#reader').open)$('#reader').append($('#assistant'));else document.body.append($('#assistant'));$('#assistant').hidden=false;renderAssistant();$('#chat-input').focus()}


function setupAssistantPointer(){const panel=$('#assistant');panel.onpointerdown=e=>{const resize=e.target.closest('[data-resize]'),drag=e.target.closest('#assistant-drag');if(!resize&&(!drag||e.target.closest('button')))return;if(panel.classList.contains('fullscreen'))return;const rect=panel.getBoundingClientRect(),x=e.clientX,y=e.clientY,d=resize?.dataset.resize;panel.style.right='auto';panel.style.bottom='auto';panel.style.left=rect.left+'px';panel.style.top=rect.top+'px';panel.setPointerCapture(e.pointerId);panel.onpointermove=ev=>{const dx=ev.clientX-x,dy=ev.clientY-y;let w=rect.width,h=rect.height,left=rect.left,top=rect.top;if(d){if(d.includes('e'))w+=dx;if(d.includes('s'))h+=dy;if(d.includes('w')){w-=dx;left+=dx}if(d.includes('n')){h-=dy;top+=dy}w=clamp(w,290,innerWidth);h=clamp(h,300,innerHeight-15);left=clamp(left,0,innerWidth-w);top=clamp(top,0,innerHeight-h)}else{left=clamp(left+dx,0,innerWidth-w);top=clamp(top+dy,0,innerHeight-h)}Object.assign(panel.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'})};panel.onpointerup=()=>{panel.onpointermove=null;const r=panel.getBoundingClientRect();if(r.left<24)panel.style.left='10px';if(innerWidth-r.right<24)panel.style.left=innerWidth-r.width-10+'px';if(r.top<24)panel.style.top='10px'};panel.onpointercancel=()=>panel.onpointermove=null}}


function chineseNumber(s){if(/^\d+$/.test(s))return Number(s);const digits={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};if(s.includes('十')){const p=s.split('十');return(digits[p[0]]||1)*10+(digits[p[1]]||0)}return digits[s]||1}


function textModal(title,label,value,callback,description=''){rt.modalSubmit=callback;modal(title,`<form id="text-form">${field(label,input('value',value,'text','id="text-value" required autofocus maxlength="150"'))}<div class="modal-footer">${btn('取消','','close-modal')}${btn('确认','check','text-submit','','primary')}</div></form>`,description);setTimeout(()=>$('#text-value')?.focus(),40)}


function newBookModal(){flushEditor();if(!projectRows().length||!projectTemplates().length){toast('先为企划创建角色和分镜模板。');navigate(projectTemplates().length?2:1);return}modal('让一个新故事开始',`${field('画册标题',input('title','未命名的夏天','text','id="new-book-title" required'))}${field('主演角色',`<select id="new-book-row">${projectRows().map(r=>opt(r.id,r.character,'')).join('')}</select>`)}${field('叙事模板',templateSelect('new-book-template',ui.templateId))}<div class="notice">角色变量与激活剧情将自动载入。没有专属台词时，使用模板默认旁白。</div><div class="modal-footer">${btn('仅加入队列','plus','create-book')}${btn('创建并开始渲染','play','create-book','data-start="true"','primary')}</div>`,'从一份剧本，到一本属于你的画册。')}


function bookMenu(id){const b=bookBy(id);modal(b.title,`<p class="soft small" style="line-height:1.9">${esc(b.synopsis)}</p><div class="grid2">${btn('进入沉浸阅读','book','read',`data-id="${id}"`)}${btn(b.liked?'取消星标':'星标收藏','star','star',`data-id="${id}"`)}${btn('复制画册概要','copy','copy-book',`data-id="${id}"`)}${btn('剧情版本对比','compare','compare-book',`data-id="${id}"`)}${btn('导出离线画册','download','export-book',`data-id="${id}"`)}${btn('增量补齐缺帧','refresh','resume',`data-id="${id}"`)}</div><div class="divider"></div><div class="row tiny muted"><span>${esc(b.templateTitle)} · ${esc(b.storyTitle||'默认剧情')}</span><span class="spacer"></span>${btn('删除画册','trash','delete-book',`data-id="${id}"`,'small danger')}</div>`,'仅保存在本地工程中，无公开社交功能')}


function compareBook(id){const b=bookBy(id),other=state.books.find(x=>x.id!==id&&x.rowId===b.rowId&&x.templateId===b.templateId);if(!other){toast('此角色与模板目前只有一个画册版本。请生成新的剧情版本再对比。');return}modal('多剧情版本对比',`<div class="compare-grid">${[b,other].map(x=>`<section>${imgTag(coverImage(x),x.title,`data-book="${x.id}" data-step="0"`)}<h3 style="font-size:14px;font-weight:500">${esc(x.storyTitle||x.title)}</h3>${x.steps.map(s=>`<p><span class="mono muted">${pad(s.stepIndex+1)}</span> ${esc(s.caption)}</p>`).join('')}${btn('阅读此版本','book','read',`data-id="${x.id}"`)}</section>`).join('')}</div>`,'同角色 × 同模板，独立剧情演进',true)}


function backupModal(){modal('工程备份与迁移',`<div class="notice">备份包含所有企划、模板、角色变量、剧情版本、画册图片索引、渲染队列、工作流映射及配置。恢复前会执行结构校验与覆盖确认。</div><div class="row" style="margin-top:20px">${btn('导出全量工程 JSON','download','backup-export','','primary')}${btn('从 JSON 恢复','upload','import-project')}</div><label class="row small soft" style="margin-top:17px"><input type="checkbox" id="backup-secrets">包含 API 密钥（敏感，请妥善保管）</label><div class="divider"></div><h3 class="panel-title">${icon('disk')}双向远端存储</h3>${field('自有 JSON 存储端点',setting('syncUrl',state.settings.syncUrl),'此端点需支持 GET 与 PUT application/json，并允许浏览器 CORS。未配置时只保存在本地，不会上传数据。')}<div class="row">${btn('推送至远端','upload','sync-push')}${btn('拉取远端工程','download','sync-pull')}</div><p class="help" id="sync-status">${esc(rt.syncStatus||'远端未同步 · 防冲刷保护已开启')}</p><div class="divider"></div><p class="tiny muted">当前工程：${state.projects.length} 个企划 / ${state.books.length} 本画册 / ${state.templates.length} 个模板</p>`,'LOCAL FIRST / FULL PROJECT BACKUP')}


function characterModal(id){const r=rowBy(id);ui.characterId=id;modal(r.character+' · 角色资产',`${field('角色特征 / Trigger Prompt',input('trigger',r.trigger||'','text','id="character-trigger"'))}${field('LoRA 文件绑定',input('lora',r.lora||'','text','id="character-lora" placeholder="例如 nanami_v2.safetensors"'))}<div class="grid3">${[['front','正面立绘'],['side','侧面立绘'],['full','全身立绘']].map(([k,l])=>`<div><div class="label">${l}</div><button class="preview-box" style="width:100%;height:150px;min-height:150px" data-act="character-reference" data-key="${k}">${r.references?.[k]?imgTag(r.references[k],l,'style="height:145px"'):icon('upload')+'<p>上传参考图</p>'}</button></div>`).join('')}</div><p class="help">LoRA 名称会写入工作流的 LoraLoader 节点。绑定 LoadImage 后，可使用正面立绘作为图生图输入。</p><div class="modal-footer">${btn('保存角色资产','disk','save-character','','primary')}</div>`,'本地角色参考与一致性治理',true)}


function marketModal(){modal('模板与插件','<div id="market-content"></div>','精心整理的创作组件，装进你的本地工作室。',true);renderMarket()}


function renderMarket(){const q=ui.marketSearch.toLowerCase(),items=catalog.filter(c=>(ui.marketTab==='all'||ui.marketTab===c.type)&&[c.title,c.desc,c.tags].join(' ').toLowerCase().includes(q));$('#market-content').innerHTML=`<div class="tabbar" style="gap:18px">${[['all','全部'],['templates','分镜剧本'],['characters','角色资产'],['workflows','工作流'],['rules','审校规则']].map(([v,l])=>`<button class="tab ${v===ui.marketTab?'active':''}" data-act="market-tab" data-tab="${v}">${l}</button>`).join('')}</div><div class="row" style="margin-top:18px"><div class="search-field" style="max-width:none">${icon('search')}<input id="market-search" value="${esc(ui.marketSearch)}" placeholder="搜索组件、作者或标签..." aria-label="搜索模板与插件"></div></div><div class="row wrap" style="margin-top:12px">${['治愈','青春','赛博','一致性'].map(t=>btn(t,'','market-tag',`data-tag="${t}"`,'small ghost')).join('')}<span class="spacer"></span><span class="tiny muted">内置包 · 离线可安装</span></div><div class="market-grid">${items.map(c=>{const installed=state.installedPackages.some(p=>p.id===c.id);return`<article class="market-item"><div class="row accent">${icon(c.icon)}<span class="spacer"></span><span class="tiny">${icon('star','sm')} ${c.score}</span></div><h3>${esc(c.title)}</h3><p>${esc(c.desc)}</p><div class="row"><span class="grow tiny muted">${esc(c.author)} · v${c.version}</span>${btn(installed?'卸载':'安装',installed?'check':'download','market-install',`data-id="${c.id}"`,'small '+(installed?'':'primary'))}</div></article>`}).join('')||'<div class="empty">没有匹配的组件。</div>'}</div><div class="divider"></div><h3 class="panel-title">从开源仓库导入</h3><div class="row"><input id="raw-url" placeholder="GitHub / Gitee Raw JSON 链接" aria-label="开源组件 JSON 链接">${btn('导入新副本','download','import-raw')}</div><div class="help">GitHub /blob/ 链接自动转为 Raw。外部 JSON 仅作为数据解析，绝不执行脚本。</div>`}


async function installPackage(id){const c=catalog.find(c=>c.id===id),installed=state.installedPackages.find(p=>p.id===id);if(installed){if(!await confirmAction('卸载 '+c.title+'？','已生成画册会被保留。被画册引用的模板与角色不会删除。','卸载'))return;state.templates=state.templates.filter(t=>!installed.assetIds.includes(t.id)||state.books.some(b=>b.templateId===t.id));state.rows=state.rows.filter(r=>!installed.assetIds.includes(r.id)||state.books.some(b=>b.rowId===r.id));state.settings.comfy.presets=state.settings.comfy.presets.filter(p=>!installed.assetIds.includes(p.id));if(c.type==='rules')state.settings.autoCritique=false;state.installedPackages=state.installedPackages.filter(p=>p.id!==id)}else{const assetIds=[];if(c.type==='templates'){const t={id:uid('tpl'),projectId:state.activeProjectId,title:c.title,outline:c.desc,frames:Array.from({length:id==='noir-pack'?8:6},(_,i)=>makeFrame(i)),createdAt:Date.now()};state.templates.push(t);assetIds.push(t.id)}if(c.type==='characters'){const r=makeRow(0,state.activeProjectId);r.bookTitle='新角色企划';state.rows.push(r);assetIds.push(r.id)}if(c.type==='workflows'){const p={id:uid('wf'),title:c.title,workflow:clone(defaultWorkflow),mapping:clone(state.settings.comfy.mapping)};state.settings.comfy.presets.push(p);assetIds.push(p.id)}if(c.type==='rules')state.settings.autoCritique=true;state.installedPackages.push({id,title:c.title,type:c.type,assetIds})}save(true);renderMarket();renderShell();toast(installed?'组件已卸载，引用资产已保留。':'组件已安装至本地工程。')}


async function importRaw(){let url=new URL($('#raw-url').value.trim());if(!['http:','https:'].includes(url.protocol))throw Error('仅支持 HTTP(S) JSON 链接。');if(url.hostname==='github.com'&&url.pathname.includes('/blob/'))url=new URL('https://raw.githubusercontent.com'+url.pathname.replace('/blob/','/'));if(url.hostname==='gitee.com')url.pathname=url.pathname.replace('/blob/','/raw/');const data=await(await request(url.href,{},15000)).json();if(!await confirmAction('导入外部 JSON 资产？','将作为独立新副本导入，不覆盖现有资产。','校验并导入'))return;if(data.class_type||Object.values(data).every(n=>n?.class_type)){validateWorkflow(data);state.settings.comfy.presets.push({id:uid('wf'),title:'外部工作流',workflow:data,mapping:clone(state.settings.comfy.mapping)});save()}else importTemplateObject(data);toast('外部资产已校验并导入。')}


function settingsModal(){modal('工作室设置',`${field('全局负向提示词',`<textarea data-setting="negative">${esc(state.settings.negative)}</textarea>`)}${field('创作者签名',setting('signature',state.settings.signature))}<label class="row small soft"><input type="checkbox" data-setting="autoCritique" ${state.settings.autoCritique?'checked':''}>批量出图后自动审校（连续 3 次失败熔断）</label><div class="divider"></div>${btn('切换日光 / 暗室','sun','theme')}${btn('系统自检','shield','diagnostics','style="margin-left:9px"')}<div class="modal-footer">${btn('保存并关闭','check','close-modal','','primary')}</div>`,'设置仅保存在本地浏览器')}


function openCommand(){flushEditor();$('#command-input').value='';rt.commandIndex=0;indexCommands('');$('#command-dialog').showModal();$('#command-input').focus()}


function indexCommands(query){const all=[...workspaces.map((w,i)=>({title:w[0],type:'工作区 '+(i+1),icon:w[1],run:()=>navigate(i)})),...state.books.map(b=>({title:b.title,type:'画册 · '+b.characterName,icon:'book',run:()=>{changeProject(b.projectId);openReader(b.id)}})),...state.templates.map(t=>({title:t.title,type:'分镜模板',icon:'story',run:()=>{changeProject(t.projectId);ui.templateId=t.id;ui.frameIndex=0;navigate(1)}})),...state.rows.map(r=>({title:r.character+' · '+r.bookTitle,type:'矩阵角色',icon:'users',run:()=>{changeProject(r.projectId);navigate(2);characterModal(r.id)}})),...[['新建模板','plus','new-template'],['追加角色','users','add-row'],['启动批量出图','play','start-batch'],['打开创作助手','spark','assistant'],['工程备份 / 恢复','disk','backup'],['引擎连通性测试','nodes','test-engine'],['安装模板与插件','box','market']].map(([title,ic,act])=>({title,type:'快捷动作',icon:ic,run:()=>handleAction(act,{})}))];rt.commandItems=all.filter(x=>(x.title+' '+x.type).toLowerCase().includes(query.toLowerCase())).slice(0,45);rt.commandIndex=clamp(rt.commandIndex,0,Math.max(0,rt.commandItems.length-1));$('#command-results').innerHTML=rt.commandItems.map((x,i)=>`<button class="command-item ${i===rt.commandIndex?'active':''}" data-act="run-command" data-index="${i}">${icon(x.icon)}<span>${esc(x.title)}</span><small>${esc(x.type)}</small></button>`).join('')||'<div class="empty" style="padding:30px">没有匹配的结果。</div>'}


function changeProject(id){flushEditor();if(!state.projects.some(p=>p.id===id))return;state.activeProjectId=id;ui.templateId=projectTemplates()[0]?.id;ui.storyTemplateId=ui.templateId;ui.storyRowId=projectRows()[0]?.id;ui.frameIndex=0;ui.selected.clear();ui.search='';save();render()}


function storeSetting(el){const parts=el.dataset.setting.split('.');if(parts.some(p=>['__proto__','constructor','prototype'].includes(p)))return;let obj=state.settings;for(const p of parts.slice(0,-1)){if(!obj[p]||typeof obj[p]!=='object')return;obj=obj[p]}obj[parts.at(-1)]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;if(el.dataset.setting==='autoCritique'&&el.checked)rt.criticFailures=0;save()}


function columnModal(old=''){modal(old?'编辑变量 {'+old+'}':'新增自定义变量',`${field('变量标识符',input('column',old,'text','id="column-name" pattern="[a-zA-Z0-9_]+" required placeholder="例如 character2、weapon、mood"'))}<div class="notice">变量直接平铺在角色行对象中。重命名将精确改写所有模板的提示词与台词，不影响相似名称。</div><div class="modal-footer">${old?btn('删除此变量','trash','column-delete',`data-key="${esc(old)}"`,'danger'):''}${btn('保存变量','check','column-save',`data-key="${esc(old)}"`,'primary')}</div>`)}


async function handleAction(act,d,el){switch(act){
case'workspace':navigate(d.index);break;
case'project':changeProject(d.id);break;
case'new-project':textModal('新建企划','企划名称','',v=>{const p={id:uid('project'),title:v,createdAt:Date.now()};state.projects.push(p);changeProject(p.id);closeModal();toast('企划已创建。先创建模板，再添加角色。')});break;
case'text-submit':if(!$('#text-form').reportValidity())return;if(!$('#text-value').value.trim())throw Error('名称不能为空。');await rt.modalSubmit?.($('#text-value').value.trim());break;
case'close-modal':flushEditor();closeModal();break;
case'theme':{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;try{localStorage.setItem('cc-theme',theme)}catch(e){}renderShell();break}
case'engine-info':modal('创作引擎状态',`<div class="notice">${state.settings.comfy.mode==='mock'?'当前使用本地确定性 SVG 引擎。不会调用 GPU 或向外部发送提示词。':'真实 ComfyUI 模式。地址：'+esc(baseURL())}</div><div class="divider"></div>${field('切换运行模式',`<select data-setting="comfy.mode">${opt('mock','离线 SVG 演示',state.settings.comfy.mode)}${opt('real','真实 ComfyUI GPU',state.settings.comfy.mode)}</select>`)}<p class="help">真实连接需启动 ComfyUI 并开启 --enable-cors-header。GPU 显存与延迟只显示服务端真实返回值。</p><div class="modal-footer">${btn('连通性测试','refresh','test-engine')}${btn('进入引擎工作区','nodes','go-engine','','primary')}</div>`);break;
case'go-engine':closeModal();navigate(3);break;
case'help':modal('让故事，逐帧发生',`<h3 class="panel-title">创作路径</h3><p class="soft small" style="line-height:2.1">1. 在分镜工作台设计模板与提示词。<br>2. 在角色矩阵配置平铺变量与参考立绘。<br>3. 用剧情策划台生成独立剧本版本。<br>4. 启动队列，在画廊阅读、审校与精修。<br>5. 导出完全自包含的离线画册。</p><div class="divider"></div><div class="grid2"><span class="small soft">1 至 5：切换工作区</span><span class="small soft">Cmd / Ctrl + K：全局命令</span><span class="small soft">Cmd / Ctrl + J：创作助手</span><span class="small soft">← / →：阅读器翻页</span></div><div class="divider"></div><div class="notice">这是本地优先的功能原型。离线审校为规则模拟，不是实际图像诊断。在线示例封面来自 Alpha Coders，仅用于个人预览；作品权利归原作者。离线自动使用内置原创 SVG。</div><div class="modal-footer">${btn('运行系统自检','shield','diagnostics')}${btn('开始创作','check','close-modal','','primary')}</div>`);break;
case'diagnostics':diagnostics();break;
case'settings':settingsModal();break;
case'command':openCommand();break;
case'run-command':{const item=rt.commandItems[Number(d.index)];$('#command-dialog').close();if(item)await item.run();break}
case'gallery-tab':ui.filter=d.filter;render();break;
case'recent':ui.sort='updatedAt';ui.filter='all';render();break;
case'layout':ui.layout=d.layout;render();break;
case'toggle-bulk':ui.bulk=!ui.bulk;if(!ui.bulk)ui.selected.clear();refreshGallery();break;
case'select-all':filteredBooks().forEach(b=>ui.selected.add(b.id));refreshGallery();break;
case'clear-selection':ui.selected.clear();ui.bulk=false;refreshGallery();break;
case'star':{const b=bookBy(d.id);b.liked=!b.liked;b.likes=b.liked?1:0;b.updatedAt=Date.now();save();refreshGallery();if($('#modal').open&&$('#modal-title').textContent===b.title)bookMenu(b.id);break}
case'bulk-star':ui.selected.forEach(id=>{const b=bookBy(id);if(b){b.liked=true;b.likes=1;b.updatedAt=Date.now()}});save();render();toast('所选画册已添加星标。');break;
case'bulk-delete':await deleteBooks([...ui.selected]);break;
case'delete-book':await deleteBooks([d.id]);break;
case'bulk-export':exportModal([...ui.selected]);break;
case'bulk-resume':for(const id of ui.selected){const b=bookBy(id);enqueueBook(rowBy(b.rowId),templateBy(b.templateId),b)}void runQueue();break;
case'book-menu':bookMenu(d.id);break;
case'copy-book':{const b=bookBy(d.id);await copyText([b.title,b.characterName,b.templateTitle,b.synopsis,b.tags.join(' / ')].join('\n'));break}
case'compare-book':compareBook(d.id);break;
case'read':if($('#modal').open)closeModal();openReader(d.id);break;
case'close-reader':closeReader();break;
case'resume':{const b=bookBy(d.id);enqueueBook(rowBy(b.rowId),templateBy(b.templateId),b);closeModal();void runQueue();toast('仅补齐缺失或降级帧，现有画面不重跑。');break}
case'new-book':newBookModal();break;
case'create-book':{const r=rowBy($('#new-book-row').value),t=templateBy($('#new-book-template').value),title=$('#new-book-title').value.trim();if(!title)throw Error('请输入画册标题。');const b=enqueueBook(r,t);b.title=title;b.aspectRatio=t.frames[0].width/t.frames[0].height;save();closeModal();render();if(d.start)void runQueue();else toast('新画册已加入队列。');break}
case'new-template':flushEditor();textModal('新建分镜模板','模板名称','未命名故事',v=>{const t={id:uid('tpl'),projectId:state.activeProjectId,title:v,outline:'',frames:[makeFrame(0)],createdAt:Date.now()};state.templates.push(t);ui.templateId=t.id;ui.frameIndex=0;save();closeModal();navigate(1)});break;
case'clone-template':{flushEditor();const t=clone(currentTemplate());if(!t)throw Error('请先选择模板。');t.id=uid('tpl');t.title+=' · 副本';t.frames.forEach(f=>f.id=uid('f'));t.createdAt=Date.now();state.templates.push(t);ui.templateId=t.id;ui.frameIndex=0;save();render();break}
case'export-template':flushEditor();download(currentTemplate().title+'.json',JSON.stringify(currentTemplate(),null,2));break;
case'import-template':pickFile('.json,application/json',async f=>{importTemplateObject(JSON.parse(await f.text()));navigate(1);toast('模板已导入为独立副本。')});break;
case'scene':flushEditor();ui.frameIndex=Number(d.index);render();break;
case'add-frame':flushEditor();if(!currentTemplate())throw Error('请先创建分镜模板。');if(currentTemplate().frames.length>=512)throw Error('最多支持512幕。');currentTemplate().frames.push(makeFrame(currentTemplate().frames.length));ui.frameIndex=currentTemplate().frames.length-1;save();render();break;
case'clone-frame':{flushEditor();const t=currentTemplate();if(!t?.frames[ui.frameIndex])throw Error('请先添加一幕。');if(t.frames.length>=512)throw Error('最多支持512幕。');const f=clone(t.frames[ui.frameIndex]);f.id=uid('f');f.name+=' · 副本';t.frames.splice(ui.frameIndex+1,0,f);ui.frameIndex++;save();render();break}
case'delete-frame':{flushEditor();const t=currentTemplate();if(t.frames.length===1)throw Error('至少保留一幕。');if(await confirmAction('删除当前分镜？','源分镜会被移除；已生成画册保持不变。','删除分镜')){t.frames.splice(ui.frameIndex,1);ui.frameIndex=Math.min(ui.frameIndex,t.frames.length-1);save(true);render()}break}
case'move-frame':{flushEditor();const t=currentTemplate(),next=ui.frameIndex+Number(d.dir);if(next<0||next>=t.frames.length)return;[t.frames[next],t.frames[ui.frameIndex]]=[t.frames[ui.frameIndex],t.frames[next]];ui.frameIndex=next;save();render();break}
case'insert-prompt':{const e=$('#frame-prompt');if(!e)return;const start=e.selectionStart,end=e.selectionEnd;e.setRangeText(d.value,start,end,'end');e.focus();flushEditor();break}
case'column-add':columnModal();break;
case'column-edit':columnModal(d.key);break;
case'column-save':await updateColumn(d.key,$('#column-name').value.trim());break;
case'column-delete':await updateColumn(d.key,'',true);break;
case'add-row':{const r=makeRow(projectRows().length,state.activeProjectId);r.character='新角色';r.bookTitle='未命名企划';r.active=true;state.customColumns.forEach(k=>{r[k]??='' });state.rows.push(r);save();navigate(2);toast('角色已追加，可直接编辑表格。');break}
case'delete-row':{if(state.books.some(b=>b.rowId===d.id))throw Error('此角色已有溯源画册，请先删除相关画册。');if(rt.lockedRows.has(d.id))throw Error('此角色正在推演中。');if(await confirmAction('删除角色？','专属剧情版本也会被移除。','删除角色')){state.rows=state.rows.filter(r=>r.id!==d.id);save(true);render()}break}
case'script-modal':scriptModal(d.id);break;
case'script-save':{const r=rowBy(ui.scriptRow),t=templateBy(ui.scriptTemplate),v=ensureManual(r,t);if(rt.lockedRows.has(r.id))throw Error('剧情正在推演中，请稍候。');v.title=$('#script-title').value;$$('[data-script-caption]').forEach(e=>v.captions[Number(e.dataset.scriptCaption)]=e.value);v.source='manual';v.updatedAt=Date.now();save();closeModal();toast('角色专属台词已保存。');break}
case'script-regenerate':{const r=rowBy(ui.scriptRow),t=templateBy(ui.scriptTemplate);closeModal();await runStories([r],t);break}
case'character-modal':characterModal(d.id);break;
case'character-reference':{const r=rowBy(ui.characterId);r.trigger=$('#character-trigger').value;r.lora=$('#character-lora').value;pickFile('image/*',async f=>{r.references??={};r.references[d.key]=await rasterJPEG(await blobData(f));save();characterModal(r.id)});break}
case'save-character':{const r=rowBy(ui.characterId);r.trigger=$('#character-trigger').value;r.lora=$('#character-lora').value;save();closeModal();toast('角色参考与 LoRA 绑定已保存。');break}
case'enqueue':enqueueSelected();toast('已勾选角色已加入队列。');break;
case'start-batch':flushEditor();if(!state.queue.some(q=>q.status==='pending')||projectRows().some(r=>r.active))enqueueSelected();if(!state.queue.some(q=>q.status==='pending'))throw Error('队列为空，请先选择角色。');void runQueue();break;
case'pause-queue':if(!rt.running){toast('当前没有运行中的队列。');return}rt.paused=!rt.paused;log(rt.paused?'已请求暂停，当前帧完成后停止调度。':'队列继续执行。');if(ui.workspace===2)render();break;
case'interrupt':if(state.settings.comfy.mode==='real'&&!await confirmAction('物理中断 GPU？','将中断此 ComfyUI 服务上的当前任务，并清空全部待执行队列。已生成图片会保留。','中断 GPU'))return;for(const c of rt.refineControllers?.values()||[])c.abort();await interruptQueue();toast('中止请求已发送。');break;
case'scan-resume':{let n=0;for(const b of projectBooks())if(missingIndices(b).length){enqueueBook(rowBy(b.rowId),templateBy(b.templateId),b);n++}toast(n?'已为 '+n+' 本画册追加增量任务。':'巡检完成，没有缺失分镜。');break}
case'copy-logs':await copyText(rt.logs.map(l=>new Date(l.time).toISOString()+' ['+l.level+'] '+l.message).join('\n'));break;
case'batch-story':await runStories(projectRows().filter(r=>r.active),currentTemplate());break;
case'stop-llm':rt.llmController?.abort();toast('已请求停止剧本流水线，不影响生图队列。');break;
case'test-engine':await testEngine();break;
case'dry-run':await dryRun();break;
case'import-workflow':pickFile('.json',async f=>{const data=JSON.parse(await f.text());validateWorkflow(data);state.settings.comfy.workflow=data;autoBindWorkflow();save();navigate(3);toast('API 蓝图已导入并自动匹配节点。')});break;
case'export-workflow':download('comfycomic_workflow.json',JSON.stringify(state.settings.comfy.workflow,null,2));break;
case'edit-workflow':modal('编辑 ComfyUI API 蓝图',`<textarea id="workflow-json" class="code-area">${esc(JSON.stringify(state.settings.comfy.workflow,null,2))}</textarea><div class="modal-footer">${btn('校验并保存','check','apply-workflow','','primary')}</div>`,'例如：把 your-anime-model.safetensors 替换为你本地的模型文件名',true);break;
case'apply-workflow':{const data=JSON.parse($('#workflow-json').value);validateWorkflow(data);state.settings.comfy.workflow=data;autoBindWorkflow();save();closeModal();render();toast('工作流蓝图已校验保存。');break}
case'save-workflow':{const c=state.settings.comfy;c.presets.push({id:uid('wf'),title:c.workflowTitle,workflow:clone(c.workflow),mapping:clone(c.mapping)});save();render();toast('工作流预设已保存。');break}
case'llm-tab':saveStoryInputs();ui.llmTab=d.tab;render();break;
case'llm-settings':llmSettings();break;
case'test-llm':if(llmMock())toast('离线规则引擎已就绪。真实 API 测试需切换模式并配置密钥或本地端点。');else{await chatCompletion([{role:'user',content:'Reply with OK.'}]);toast('兼容 API 连接成功。')}break;
case'generate-story':{saveStoryInputs();const t=templateBy(ui.storyTemplateId);if(!t)throw Error('请先选择分镜模板。');const n=Number($('#story-target')?.value||t.frames.length);if(!Number.isInteger(n)||n<1||n>512)throw Error('生成目标需为1至512幕；空模板可先保存，生成前请添加分镜。');if(n!==t.frames.length){if(!await confirmAction('同步调整模板为 '+n+' 幕？','仅在模板尾部增删分镜，不会修改已经生成的画册。','调整并推演'))return;while(t.frames.length<n)t.frames.push(makeFrame(t.frames.length));t.frames=t.frames.slice(0,n);save(true)}await runStories([rowBy(ui.storyRowId)],t);break}
case'generate-outline':await generateOutline();break;
case'save-story':saveStoryInputs();toast('台词修改已保存到当前剧情版本。');break;
case'new-story-version':{saveStoryInputs();const r=rowBy(ui.storyRowId),t=templateBy(ui.storyTemplateId),old=ensureManual(r,t),v={...clone(old),id:uid('sv'),title:'人工精修版 '+((r.storyVersions[t.id]||[]).length+1),source:'manual',createdAt:Date.now(),updatedAt:Date.now()};r.storyVersions[t.id].push(v);r.activeStoryVersionIds[t.id]=v.id;save();render();break}
case'regenerate-scene':{if(rt.llmBusy)throw Error('剧本流水线正在运行。');saveStoryInputs();rt.llmBusy=true;rt.llmController=new AbortController();try{await generateStory(rowBy(ui.storyRowId),templateBy(ui.storyTemplateId),Number(d.index));toast('此幕剧情已重新推演。')}finally{rt.llmBusy=false;rt.llmController=null;render()}break}
case'load-story':{saveStoryInputs();const r=rowBy(ui.storyRowId),t=templateBy(ui.storyTemplateId);t.frames.forEach((f,i)=>f.caption=captionFor(r,t,i));ui.templateId=t.id;ui.frameIndex=0;save();navigate(1);toast('当前剧情已载入分镜时间线。');break}
case'generate-xml':await generateXML();break;
case'validate-xml':ui.xmlOutput=$('#xml-output').value;toast('结构通过：'+parseTemplateXML(ui.xmlOutput).frames.length+' 幕分镜。');break;
case'import-xml':{ui.xmlOutput=$('#xml-output').value;const t=parseTemplateXML(ui.xmlOutput);state.templates.push(t);ui.templateId=t.id;ui.frameIndex=0;save();navigate(1);toast('XML 已转录为正式模板。');break}
case'reader-mode':preserveFloating();ui.mode=d.mode;renderReader();if(!$('#assistant').hidden)$('#reader').append($('#assistant'));break;
case'reader-step':setReaderStep(Number(d.index));break;
case'page-prev':setReaderStep(ui.step-(['manga','flip'].includes(ui.mode)?2:1));break;
case'page-next':setReaderStep(ui.step+(['manga','flip'].includes(ui.mode)?2:1));break;
case'toggle-inspector':$('#reader').classList.toggle('inspect-open');break;
case'critique':await critiqueStep(ui.bookId,Number(d.index));break;
case'apply-critique':{const c=bookBy(ui.bookId).steps.find(s=>s.stepIndex===Number(d.index))?.critique;if(c)$('#refine-'+d.index).value+=', '+c.suggestions;toast('建议已追加至重绘提示词。');break}
case'redraw':await redrawStep(Number(d.index));break;
case'mask':await maskModal(Number(d.index));break;
case'save-mask':rt.mask={key:d.key,data:$('#mask-canvas').toDataURL('image/png')};closeModal();toast('局部蒙版已准备好，点击精修重绘即可应用。');break;
case'replace-page':{const id=ui.bookId,i=Number(d.index);pickFile('image/*',async f=>{const b=bookBy(id),image=await rasterJPEG(await blobData(f)),s=b.steps.find(s=>s.stepIndex===i);if(s){s.image=image;s.offlineFallback=false;delete s.critique;delete s.offlineImage}else b.steps.push({stepIndex:i,name:'上传分镜 '+(i+1),caption:'',prompt:'',image});b.generatedSteps=b.steps.filter(s=>s.image).length;b.updatedAt=Date.now();if(!missingIndices(b).length)b.status='complete';hotReplace(id,i,image);save();toast('本页图片已替换，旧审校报告已清除。')});break}
case'export-book':exportModal([d.id||ui.bookId]);break;
case'export-format':ui.exportFormat=d.format;$$('.export-option').forEach(e=>e.classList.toggle('active',e.dataset.format===ui.exportFormat));break;
case'compile-export':await compileExport();break;
case'assistant':showAssistant();break;
case'assistant-close':$('#assistant').hidden=true;break;
case'assistant-full':$('#assistant').classList.toggle('fullscreen');break;
case'new-chat':{if(rt.chatBusy)throw Error('请等待本次对话完成。');const c={id:uid('chat'),title:'创作分支 '+(state.chats.length+1),messages:[{role:'assistant',content:'新的创作分支已建立。你希望先调整哪个分镜？'}]};state.chats.push(c);state.activeChatId=c.id;save();renderAssistant();break}
case'send-chat':await sendChat();break;
case'chat-attach':pickFile('image/*,.txt,.docx',addAttachments,true);break;
case'remove-attachment':rt.attachments.splice(Number(d.index),1);renderAssistant();break;
case'backup':backupModal();break;
case'backup-export':flushEditor();download('Mio_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(backupObject($('#backup-secrets')?.checked),null,2));toast('全量工程备份已下载。');break;
case'import-project':pickFile('.json,application/json',async f=>{if(f.size>80000000)throw Error('备份包超过 80 MB。');await restoreObject(JSON.parse(await f.text()))});break;
case'sync-push':await syncRemote('push');break;
case'sync-pull':await syncRemote('pull');break;
case'market':marketModal();break;
case'market-tab':ui.marketTab=d.tab;renderMarket();break;
case'market-tag':ui.marketSearch=d.tag;renderMarket();break;
case'market-install':await installPackage(d.id);break;
case'import-raw':await importRaw();break;
default:log('未识别的操作：'+act,'warn');}}



function standardBookLoop(){return `{{#books}}
<article class="cc-book" data-cc-book>
  <header class="cc-cover">
    <p class="cc-eyebrow">MIO / {{layoutName}}</p>
    <h1>{{title}}</h1>
    <p class="cc-synopsis">{{synopsis}}</p>
    <span class="cc-byline">{{characterName}} · {{panelCount}} 幕</span>
  </header>
  <main class="cc-pages" data-cc-pages>
    {{#frames}}
    <figure class="cc-frame" data-cc-frame>
      <img class="cc-image" src="{{image}}" alt="{{name}}">
      <figcaption class="cc-caption" data-cc-caption>
        <span class="cc-scene">{{number}} / {{name}}</span>
        <p>{{caption}}</p>
        <pre class="cc-prompt" data-cc-prompt>{{prompt}}</pre>
        <small class="cc-image-note">{{imageNote}}</small>
        <div class="cc-palette"><i style="background:{{palette1}}"></i><i style="background:{{palette2}}"></i><i style="background:{{palette3}}"></i></div>
      </figcaption>
    </figure>
    {{/frames}}
  </main>
  <footer class="cc-colophon"><span>{{signature}}</span><span>{{date}} / MIO</span></footer>
</article>
{{/books}}`;}



function defaultExportHTML(){return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{collectionTitle}}</title>
  <style>
    :root { --accent: {{themeColor}}; --paper: {{paperColor}}; --text: {{textColor}}; }
    * { box-sizing: border-box; }
    body { margin: 0; background: {{background}}; color: var(--text); font-family: {{bodyFont}}; }
    .cc-book { max-width: {{contentWidth}}px; margin: 0 auto 72px; }
    .cc-cover { padding: 68px 28px 45px; text-align: center; }
    .cc-eyebrow { font: 9px monospace; letter-spacing: 3px; color: var(--accent); }
    h1 { font-size: clamp(27px, 5vw, 48px); font-weight: 500; letter-spacing: 2px; margin: 20px 0; }
    .cc-synopsis { font-size: 13px; line-height: 2; opacity: .7; max-width: 550px; margin: 0 auto 20px; }
    .cc-byline { font: 10px sans-serif; letter-spacing: 1px; opacity: .6; }
    .cc-pages { display: grid; gap: {{panelGap}}px; padding: 0 22px; }
    .cc-frame { margin: 0; overflow: hidden; background: var(--paper); border: {{frameBorder}}px solid var(--accent); border-radius: {{imageRadius}}px; }
    .cc-image { display: block; width: 100%; height: auto; }
    .cc-caption { padding: 23px 26px; color: var(--text); font-size: 13px; line-height: 1.9; }
    .cc-caption p { margin: 9px 0 0; }
    .cc-scene { font: 9px monospace; letter-spacing: 1.5px; color: var(--accent); }
    .cc-prompt { margin-top: 15px; font: 10px/1.8 monospace; white-space: pre-wrap; overflow-wrap: anywhere; opacity: .6; }
    .cc-prompt:empty, .cc-image-note:empty { display: none; }
    .cc-image-note { display: block; font: 9px/1.8 sans-serif; opacity: .55; margin-top: 10px; }
    .cc-colophon { margin: 40px 22px 0; padding-top: 18px; border-top: 1px solid var(--accent); display: flex; justify-content: space-between; gap: 15px; opacity: .6; font: 9px/1.8 monospace; }
    .cc-colophon span:first-child { font: italic 21px Georgia, serif; color: var(--accent); }
    .cc-palette { display: none; gap: 5px; margin-top: 22px; }
    .cc-palette i { width: 20px; height: 20px; display: block; }
    [data-layout="manga"] .cc-pages, [data-layout="flip"] .cc-pages { grid-template-columns: 1fr 1fr; gap: {{panelGap}}px; }
    [data-layout="manga"] .cc-caption { padding: 18px; font-size: 12px; }
    [data-layout="artbook"] .cc-frame { padding: clamp(20px, 6vw, 70px); }
    [data-layout="artbook"] .cc-caption { padding: 26px 0 0; }
    [data-layout="artbook"] .cc-palette { display: flex; }
    [data-layout="flip"] .cc-image { height: min(61vh, 640px); object-fit: contain; }
    [data-layout="flip"] .cc-caption { min-height: 110px; font-size: 11px; padding: 16px 20px; }
    [data-layout="flip"] .cc-pages { perspective: 1800px; }
    .cc-blank { display: grid; place-items: center; min-height: 430px; background: var(--paper); color: var(--accent); font: 9px Georgia, serif; letter-spacing: 3px; }
    .cc-controls { display: flex; align-items: center; justify-content: center; gap: 20px; margin: 24px 0; font: 11px sans-serif; }
    .cc-controls button { cursor: pointer; padding: 10px 15px; border: 1px solid var(--accent); color: var(--accent); background: transparent; border-radius: 3px; }
    .cc-controls button:disabled { opacity: .3; cursor: default; }
    .cc-turn { transform-origin: left; animation: cc-turn .6s ease-out; }
    @keyframes cc-turn { from { transform: rotateY(-135deg); filter: brightness(.65); } to { transform: none; filter: brightness(1); } }
    [hidden] { display: none !important; }
    @media (max-width: 640px) { .cc-cover { padding: 42px 20px 30px; } .cc-pages { padding: 0 10px; } .cc-caption { padding: 17px; font-size: 12px; } [data-layout="manga"] .cc-caption, [data-layout="flip"] .cc-caption { font-size: 10px; padding: 11px; } }
    @media print { body { background: white; } .cc-book { max-width: none; margin: 0; } .cc-cover { break-after: page; } .cc-frame { break-inside: avoid; } .cc-controls { display: none; } .cc-frame[hidden] { display: block !important; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
</head>
<body>
${standardBookLoop()}
</body>
</html>`;}



function makeExportTemplate(id,title,layout,options={},description='',source='builtin'){
  return {id,kind:templateKind,formatVersion:1,title,description,author:'Mio',version:'1.0.0',layout,html:defaultExportHTML(),options:{...exportOptionDefaults,...options},source,builtin:source==='builtin',createdAt:Date.now(),updatedAt:Date.now()};
}


function builtinExportTemplates(){return [
  makeExportTemplate('export-paper','纸间 · 温柔长卷','webtoon',{},'暖白纸张与安静的留白，让画面自然延续。'),
  makeExportTemplate('export-ink','墨序 · 经典双页','manga',{accent:'#353535',background:'#e7e7e2',paper:'#ffffff',text:'#232323',width:1120,gap:4,radius:0,font:'sans'},'克制的黑白双页排版，保留分镜的叙事张力。'),
  makeExportTemplate('export-gallery','留白 · 私人艺术册','artbook',{accent:'#887050',background:'#eae6db',paper:'#fcfaf4',text:'#39352c',width:1000,gap:36,radius:0},'展台式留白、画面色卡与签名，为作品落款。'),
  makeExportTemplate('export-flip','夜读 · 交互翻页','flip',{accent:'#9fafb1',background:'#151c22',paper:'#222d35',text:'#e0e7e7',width:1120,gap:3,radius:1,font:'sans'},'暗室双页与轻盈的纸张转场，适合沉浸式阅读。')
];}


function exportTemplateCopy(t){return {...clone(t),id:uid('export'),title:t.title.slice(0,100)+' · 我的副本',builtin:false,source:'local',createdAt:Date.now(),updatedAt:Date.now()};}



function inspectExportHTML(raw){
  if(typeof raw!=='string'||raw.length>600000)throw Error('模板 HTML 必须为文本，且不超过 600 KB。');
  if(!/<!doctype\s+html\s*>/i.test(raw)||!/<html[\s>]/i.test(raw)||!/<head[\s>]/i.test(raw)||!/<body[\s>]/i.test(raw))throw Error('请提供包含 DOCTYPE、html、head 和 body 的完整 HTML 文档。');
  for(const loop of ['books','frames']){
    if((raw.match(new RegExp('\\{\\{#'+loop+'\\}\\}','g'))||[]).length!==1||(raw.match(new RegExp('\\{\\{/'+loop+'\\}\\}','g'))||[]).length!==1)throw Error('需要且只能有一组 {{#'+loop+'}} 与 {{/'+loop+'}} 循环。');
  }
  const bookStart=raw.indexOf('{{#books}}'),bookEnd=raw.indexOf('{{/books}}'),frameStart=raw.indexOf('{{#frames}}'),frameEnd=raw.indexOf('{{/frames}}');
  if(!(bookStart<frameStart&&frameStart<frameEnd&&frameEnd<bookEnd))throw Error('frames 分镜循环必须完整嵌套在 books 画册循环内。');
  if(!raw.slice(frameStart,frameEnd).includes('{{image}}'))throw Error('分镜循环中缺少图片占位符 {{image}}。');
  for(const match of raw.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))if(!['#books','/books','#frames','/frames'].includes(match[1])&&!exportVariableNames.has(match[1]))throw Error('不支持的模板变量：{{'+match[1]+'}}');
  // Inspect in inert template content before creating a document or any preview.
  const inert=document.createElement('template');inert.innerHTML=raw;
  const probe=inert.content;
  const allowed=new Set('html head body title meta style main section article header footer div span p a h1 h2 h3 h4 h5 h6 ul ol li figure figcaption img hr br strong em b i small pre code blockquote table thead tbody tfoot tr th td caption col colgroup button nav details summary'.split(' '));
  for(const node of probe.querySelectorAll('*')){
    if(!allowed.has(node.localName))throw Error('安全限制：不支持 <'+node.localName+'>。自定义 HTML / CSS 可用；翻页脚本由系统提供。');
    if(node.localName==='meta'&&node.hasAttribute('http-equiv'))throw Error('请移除 http-equiv 元信息；离线安全策略由系统注入。');
    for(const attr of [...node.attributes]){
      const k=attr.name.toLowerCase(),v=attr.value.trim();
      if(k.startsWith('on')||['srcdoc','srcset','ping','formaction','action','is','nonce','autofocus'].includes(k))throw Error('安全限制：不能使用 '+k+' 属性。');
      if(k==='href'&&v&&!v.startsWith('#'))throw Error('模板链接仅允许页内锚点，不能跳转到外部网站。');
      if(k==='src'&&!['{{image}}','{{coverImage}}'].includes(v)&&!/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(v))throw Error('图片须使用 {{image}}、{{coverImage}} 或 Base64 Data URL；不能依赖外部图片。');
    }
  }
  const styles=[...probe.querySelectorAll('style')].map(n=>n.textContent).concat([...probe.querySelectorAll('[style]')].map(n=>n.getAttribute('style'))).join('\n');
  validateOfflineCSS(styles);
  const block=raw.slice(bookStart,bookEnd),frameBlock=raw.slice(frameStart,frameEnd);
  if(!/data-cc-book(?:\s|[=>])/.test(block)||!/data-cc-pages(?:\s|[=>])/.test(block)||!/data-cc-frame(?:\s|[=>])/.test(frameBlock))throw Error('请保留 data-cc-book、data-cc-pages 与 data-cc-frame 属性，以支持翻页、打印和奇数页兜底。');
  const doc=new DOMParser().parseFromString(raw,'text/html');
  for(const root of [doc.documentElement,doc.head,doc.body])for(const attr of [...root.attributes]){
    if(attr.name.toLowerCase().startsWith('on')||['src','background','nonce','is'].includes(attr.name.toLowerCase()))throw Error('文档根节点不能包含脚本事件或外部资源属性。');
    if(attr.name==='style')validateOfflineCSS(attr.value);
  }
  return doc;
}


function validateExportTemplate(t){
  if(!t||t.kind!==templateKind||t.formatVersion!==1||typeof t.title!=='string'||!t.title.trim()||t.title.length>120||!exportLayouts[t.layout])throw Error('不是合法的 Mio 画册导出模板（formatVersion: 1）。');
  if(!t.options||typeof t.author!=='string'||typeof t.version!=='string')throw Error('模板缺少作者、版本或外观选项。');
  for(const k of ['accent','background','paper','text'])if(!/^#[0-9a-f]{6}$/i.test(t.options[k]))throw Error('模板颜色必须为六位十六进制色值。');
  for(const [k,min,max] of [['width',400,1800],['gap',0,100],['radius',0,40]])if(!Number.isFinite(t.options[k])||t.options[k]<min||t.options[k]>max)throw Error(k+' 应在 '+min+' 至 '+max+' 之间。');
  if(!['sans','serif'].includes(t.options.font))throw Error('字体设置不合法。');
  inspectExportHTML(t.html);
  return true;
}


function validateStudioData(s){
  if(s.exportTemplates!==undefined){if(!Array.isArray(s.exportTemplates)||s.exportTemplates.length>100)throw Error('画册模板库上限为 100 个。');const ids=new Set();for(const t of s.exportTemplates){if(!/^[a-zA-Z0-9_-]{1,150}$/.test(t.id)||ids.has(t.id))throw Error('导出模板 ID 非法或重复。');ids.add(t.id);validateExportTemplate(t)}}
  const p=s.settings?.studio;
  if(p){
    if(typeof p!=='object'||Array.isArray(p))throw Error('工作室设置必须为对象。');
    for(const group of Object.keys(studioDefaults)){if(p[group]&&(typeof p[group]!=='object'||Array.isArray(p[group])))throw Error('设置分类结构不合法。')}
    for(const group of ['visibility','features'])if(p[group])for(const [k,v] of Object.entries(p[group]))if(!Object.hasOwn(studioDefaults[group],k)||typeof v!=='boolean')throw Error('模块设置字段不合法。');
    for(const key of ['showMetrics','reduceMotion'])if(p.appearance?.[key]!==undefined&&typeof p.appearance[key]!=='boolean')throw Error('外观开关必须是布尔值。');
    if(p.appearance?.theme&&!['light','dark'].includes(p.appearance.theme))throw Error('主题配置不合法。');
    if(p.appearance?.density&&!['comfortable','compact'].includes(p.appearance.density))throw Error('界面密度不合法。');
    if(p.reader?.defaultMode&&!['focus','manga','webtoon','flip'].includes(p.reader.defaultMode))throw Error('默认阅读模式不合法。');
    if(p.assistant?.confirmChanges!==undefined&&typeof p.assistant.confirmChanges!=='boolean')throw Error('助手确认开关不合法。');
    if(p.export?.border!==undefined&&(!Number.isFinite(p.export.border)||p.export.border<0||p.export.border>8))throw Error('默认导出框线不合法。');
    for(const key of ['showCaptions','showPrompts'])if(p.export?.[key]!==undefined&&typeof p.export[key]!=='boolean')throw Error('导出显示开关不合法。');
  }
  return true;
}


function escapedTemplateValue(value){return esc(value).replace(/\{/g,'&#123;').replace(/\}/g,'&#125;');}


function fillExportVariables(html,values){return html.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g,(_,key)=>escapedTemplateValue(values[key]??''));}


function compiledBookRuntime(){
  const layout=document.body.dataset.layout;
  for(const book of document.querySelectorAll('[data-cc-book]')){
    const pages=book.querySelector('[data-cc-pages]');if(!pages)continue;
    let frames=[...pages.querySelectorAll('[data-cc-frame]')];
    if(['manga','flip'].includes(layout)&&frames.length%2){const blank=document.createElement('div');blank.className='cc-frame cc-blank';blank.setAttribute('data-cc-frame','');blank.setAttribute('aria-label','空白衬纸');blank.textContent='THIS STORY CONTINUES';pages.append(blank);frames.push(blank)}
    if(layout!=='flip')continue;
    const nav=document.createElement('nav');nav.className='cc-controls';nav.setAttribute('aria-label','翻页控制');const prev=document.createElement('button'),next=document.createElement('button'),counter=document.createElement('span');prev.type=next.type='button';prev.textContent='上一跨页';next.textContent='下一跨页';counter.setAttribute('aria-live','polite');nav.append(prev,counter,next);pages.after(nav);let current=0;
    function show(animate=true){frames.forEach((f,i)=>{f.hidden=Math.floor(i/2)!==current;f.classList.remove('cc-turn')});counter.textContent=(current+1)+' / '+Math.ceil(frames.length/2);prev.disabled=current===0;next.disabled=current>=Math.ceil(frames.length/2)-1;if(animate){const right=frames[current*2+1];if(right){void right.offsetWidth;right.classList.add('cc-turn')}}}
    prev.onclick=()=>{current=Math.max(0,current-1);show()};next.onclick=()=>{current=Math.min(Math.ceil(frames.length/2)-1,current+1);show()};book.tabIndex=0;book.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();next.click()}if(e.key==='ArrowLeft'){e.preventDefault();prev.click()}});show(false);
  }
}


function compileTemplateDocument(t,books,options={}){
  validateExportTemplate(t);
  if(!Array.isArray(books)||!books.length||books.some(b=>!Array.isArray(b.steps)||!b.steps.length))throw Error('没有可导出的分镜，请先生成或上传画面。');
  const opts={showCaptions:true,showPrompts:false,border:0,signature:state.settings.signature,...options};
  const globals={collectionTitle:books.length===1?books[0].title:'我的画册合集',title:books.length===1?books[0].title:'我的画册合集',signature:opts.signature,date:new Date().toLocaleDateString('zh-CN'),themeColor:opts.themeColor||t.options.accent,background:t.options.background,paperColor:t.options.paper,textColor:t.options.text,contentWidth:t.options.width,panelGap:t.options.gap,imageRadius:t.options.radius,bodyFont:t.options.font==='serif'?'Georgia, serif':'system-ui, sans-serif',frameBorder:clamp(Number(opts.border)||0,0,8),layout:t.layout,layoutName:exportLayouts[t.layout],bookCount:books.length};
  if(!/^#[0-9a-f]{6}$/i.test(globals.themeColor))throw Error('导出主题色不合法。');
  let html=t.html.replace(/\{\{#books\}\}([\s\S]*?)\{\{\/books\}\}/,(_,bookBlock)=>books.map(book=>{
    const values={...globals,title:book.title,synopsis:book.synopsis,characterName:book.characterName,templateTitle:book.templateTitle,storyTitle:book.storyTitle||'',panelCount:book.steps.length,coverImage:[...book.steps].sort((a,b)=>a.stepIndex-b.stepIndex)[0]?.image||''};
    const body=bookBlock.replace(/\{\{#frames\}\}([\s\S]*?)\{\{\/frames\}\}/,(_,frameBlock)=>[...book.steps].sort((a,b)=>a.stepIndex-b.stepIndex).map((frame,index)=>fillExportVariables(frameBlock,{...values,...frame,number:pad(index+1),caption:opts.showCaptions?frame.caption:'',prompt:opts.showPrompts?frame.prompt:'',palette1:frame.palette?.[0]||t.options.accent,palette2:frame.palette?.[1]||t.options.background,palette3:frame.palette?.[2]||t.options.paper})).join(''));
    return fillExportVariables(body,values);
  }).join(''));
  html=fillExportVariables(html,globals);
  const doc=new DOMParser().parseFromString(html,'text/html');
  doc.body.dataset.layout=t.layout;
  const nonce=uid('cc').replace(/[^a-zA-Z0-9]/g,'');
  const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-"+nonce+"'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';";
  doc.head.prepend(csp);
  const baseStyle=doc.createElement('style');baseStyle.textContent='[hidden]{display:none!important}[data-cc-prompt]:empty{display:none!important}'+(!opts.showCaptions?'[data-cc-caption]{display:none!important}':'')+'@media print{[data-cc-frame][hidden]{display:block!important}.cc-controls{display:none!important}}';doc.head.append(baseStyle);
  const script=doc.createElement('script');script.setAttribute('nonce',nonce);script.textContent='('+compiledBookRuntime.toString()+')();';doc.body.append(script);
  return '<!DOCTYPE html>\n'+doc.documentElement.outerHTML;
}


function exportPreviewBooks(id){
  const b=bookBy(id)||projectBooks()[0]||state.books[0];
  if(!b)return [{title:'海风与未寄出的信',synopsis:'那些没说出口的话，都藏在夏日的海风里。',characterName:'七海 Nanami',templateTitle:'夏日来信',steps:Array.from({length:3},(_,i)=>({stepIndex:i,name:frameNames[i],caption:captions[i].replaceAll('{character}','七海'),prompt:'cinematic anime, seaside, soft light',image:svgArt(i,42+i),imageNote:'离线示例画面'}))}];
  return [{...b,steps:slots(b).slice(0,3).map(s=>({...s,image:s.pending?missingArtworkDataURL():s.image,imageNote:s.pending?'尚未生成':''}))}];
}


async function imagePalette(data){
  const jpg=await rasterJPEG(data,40),im=new Image();im.crossOrigin='anonymous';im.src=jpg;await im.decode();const c=document.createElement('canvas');c.width=c.height=24;const ctx=c.getContext('2d');ctx.drawImage(im,0,0,24,24);
  return [5,12,19].map((x,i)=>{const rgb=ctx.getImageData(x,8+i*4,1,1).data;return '#'+[...rgb].slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('')});
}


async function prepareExportBooks(ids,t,onProgress){
  const selected=ids.map(bookBy).filter(Boolean).map(clone),total=selected.reduce((n,b)=>n+b.totalSteps,0);let done=0,fallbacks=0;
  for(const b of selected){const frames=[];for(const s of slots(b).sort((a,b)=>a.stepIndex-b.stepIndex)){
    let image,note=s.pending?'尚未生成':'';
    if(s.pending)image=missingArtworkDataURL();else {try{image=await imageData(s.image)}catch(e){throw Error('第 '+(s.stepIndex+1)+' 幕原图无法读取，请修复图片后再导出。不会用示例图替代。')}}
    if(!/^data:image\//i.test(image))throw Error('导出图片格式不合法。');
    let palette;if(t.layout==='artbook'){try{palette=await imagePalette(image)}catch(e){palette=[t.options.accent,t.options.background,t.options.paper]}}
    frames.push({...s,image,imageNote:note,palette});done++;onProgress?.(done,total);
  }b.steps=frames}
  return {books:selected,fallbacks};
}


function encodeMetadata(value){const bytes=new TextEncoder().encode(JSON.stringify(value));let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary)}


function decodeMetadata(text){return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text),c=>c.charCodeAt(0))))}


function exportTemplatePackage(t,type='json'){
  validateExportTemplate(t);
  const data={...clone(t),builtin:false,source:'import'};
  if(type==='html'){const {html,...meta}=data;const doc=inspectExportHTML(html);doc.querySelectorAll('meta[name="comfycomic-export-template"]').forEach(e=>e.remove());const tag=doc.createElement('meta');tag.name='comfycomic-export-template';tag.content=encodeMetadata(meta);doc.head.append(tag);download(t.title+'.template.html','<!DOCTYPE html>\n'+doc.documentElement.outerHTML,'text/html')}
  else download(t.title+'.cctemplate.json',JSON.stringify({kind:templateKind,formatVersion:1,template:data},null,2));
}


function parseExportTemplateFile(text,name='导入的画册模板'){
  let t;
  if(/^\s*[\[{]/.test(text)){const data=JSON.parse(text);t=data.template||data;if(t.kind!==templateKind)throw Error('此 JSON 不是画册导出模板，请使用对应的导入入口。');t=clone(t)}
  else{const inert=document.createElement('template');inert.innerHTML=text;const tag=inert.content.querySelector('meta[name="comfycomic-export-template"]');let meta={};if(tag){try{meta=decodeMetadata(tag.content)}catch(e){throw Error('HTML 模板元数据损坏。')}}const titleText=inert.content.querySelector('title')?.textContent||'',title=titleText&&!titleText.includes('{{')?titleText:name.replace(/\.(html?|json)$/i,'');t={...makeExportTemplate(uid('export'),title,'webtoon',{},'从 HTML 导入的自定义画册模板。','import'),...meta,html:text}}
  t.id=uid('export');t.builtin=false;t.source='import';t.createdAt=t.updatedAt=Date.now();t.options={...exportOptionDefaults,...t.options};return t;
}


function templateListItem(t){const selected=studioUI.editor?.id===t.id;return `<button class="template-library-item ${selected?'active':''}" data-act="et-select" data-id="${esc(t.id)}"><span class="template-glyph"><i></i><i></i></span><span class="grow"><strong>${esc(t.title)}</strong><small>${t.builtin?'内置':t.source==='market'?'市场安装':'自定义'} · ${exportLayouts[t.layout]}</small></span>${state.settings.studio.export.templateId===t.id?icon('check','sm'):''}</button>`;}


function currentEditorTemplate(){if(!studioUI.editor)throw Error('请先选择画册导出模板。');return studioUI.editor;}


function persistEditorDraft(){try{sessionStorage.setItem('cc-template-draft',JSON.stringify({template:studioUI.editor,time:Date.now()}));return true}catch(e){return false}}


function stashTemplateDraft(){
  if(!studioUI.editor)return;studioUI.editorDirty=true;
  const stored=persistEditorDraft();
  const status=$('#template-save-status');if(status){status.textContent=stored?'有未保存修改 · 草稿保存在此标签页':'有未保存修改 · 浏览器未允许暂存，请及时保存';status.className='validation-result'}
  clearTimeout(studioUI.previewTimer);studioUI.previewTimer=setTimeout(updateTemplatePreview,500);
}


function storedTemplateDraft(){try{const v=JSON.parse(sessionStorage.getItem('cc-template-draft')||'null');return v?.template?.kind===templateKind&&typeof v.template.html==='string'?v:null}catch(e){return null}}


async function canLeaveTemplate(){
  if(!studioUI.editorDirty)return true;
  const stored=persistEditorDraft();
  return confirmAction('暂不保存这份修改？',stored?'草稿已暂存在当前标签页。模板库仍使用上一次保存的版本，可稍后恢复草稿。':'浏览器暂存不可用，关闭将丢失未保存的编辑内容。建议取消并先保存或导出模板。',stored?'保留草稿并离开':'放弃并离开');
}


function openTemplateStudio(id=null,draft=null){
  ensureStudioState();
  const t=draft||exportTemplateBy(id)||exportTemplateBy(state.settings.studio.export.templateId)||state.exportTemplates[0];
  studioUI.editor=clone(t);studioUI.editorDirty=Boolean(draft);studioUI.editorTab='design';studioUI.previewBookId=ui.exportIds?.[0]||projectBooks()[0]?.id||null;
  renderTemplateStudio();if(!$('#template-studio').open)$('#template-studio').showModal();
}


function renderTemplateStudio(){
  const t=currentEditorTemplate(),exists=state.exportTemplates.some(x=>x.id===t.id),draft=storedTemplateDraft();
  $('#template-studio').innerHTML=`<header class="template-dialog-head">${icon('book')}<div class="grow"><h2 id="template-studio-title">画册导出模板</h2><p>设计阅读体验，而不是修改分镜内容。</p></div>${btn('导入 HTML / JSON','upload','et-import','','small')}${featureEnabled('marketplace')?btn('模板市场','box','et-market','','small'):''}${ibtn('close','et-close','关闭模板工作室')}</header>
  <div class="template-layout"><aside class="template-library"><div class="template-library-label">MY EXPORT TEMPLATES <span class="spacer"></span>${state.exportTemplates.length}</div>${state.exportTemplates.map(templateListItem).join('')}${!exists?`<div class="template-library-label" style="padding-top:13px">当前新草稿</div>${templateListItem(t)}`:''}<div class="template-library-tools">${btn('新建模板','plus','et-new','','small')}${draft?btn('恢复未保存草稿','refresh','et-restore-draft','','small ghost'):''}<p class="tiny muted" style="line-height:1.9;margin:8px 0 0">内置模板受保护。修改后会保存为你的独立副本。</p></div></aside>
  <div class="template-workbench"><div class="template-tools"><button class="tab ${studioUI.editorTab==='design'?'active':''}" data-act="et-tab" data-tab="design">外观与信息</button><button class="tab ${studioUI.editorTab==='source'?'active':''}" data-act="et-tab" data-tab="source">HTML / CSS 源码</button><div class="spacer"></div>${ibtn('plus','et-new','新建模板')}${ibtn('copy','et-duplicate','复制模板')}${btn('模板包','download','et-export-menu','','small')}${btn('HTML','download','et-export-html','','small')}${!t.builtin&&exists?ibtn('trash','et-delete','删除此模板'):''}</div>
  <div class="template-editor-grid"><section class="template-edit-fields">${studioUI.editorTab==='design'?templateDesignFields(t):templateSourceFields(t)}</section><section class="template-preview-pane"><div class="preview-toolbar"><i class="dot" style="width:4px;height:4px"></i><span>实时预览 · 前 3 幕</span><span class="spacer"></span><button class="ibtn ${studioUI.previewDevice==='desktop'?'on':''}" data-act="et-device" data-device="desktop" title="桌面预览" aria-label="桌面预览">${icon('expand','sm')}</button><button class="ibtn ${studioUI.previewDevice==='mobile'?'on':''}" data-act="et-device" data-device="mobile" title="手机预览" aria-label="手机预览">${icon('book','sm')}</button></div><div class="preview-viewport ${studioUI.previewDevice==='mobile'?'mobile':''}" id="template-viewport"><iframe id="template-preview" class="template-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" title="自定义画册模板沙盒预览"></iframe></div><div class="preview-toolbar">${icon('shield','sm')}独立沙盒 · 无网络请求<span class="spacer"></span>${btn('刷新预览','refresh','et-preview','','ghost small')}</div></section></div>
  <footer class="template-footer"><span id="template-save-status" class="validation-result grow">${studioUI.editorDirty?'有未保存修改':'已保存 · 画作和台词不受模板编辑影响'}</span>${btn('设为默认','','et-default','','small')}${btn('还原修改','refresh','et-revert','','small')}${btn(t.builtin?'保存为我的模板':'保存模板','check','et-save','','primary')}</footer></div></div>`;
  updateTemplatePreview();
}


function templateDesignFields(t){return `
  <h3>让画册拥有自己的气质</h3>
  ${field('模板名称',input('title',t.title,'text','data-et-field="title" maxlength="120"'))}
  ${field('阅读版式',`<select data-et-field="layout">${Object.entries(exportLayouts).map(([v,l])=>opt(v,l,t.layout)).join('')}</select>`)}
  ${field('简介',`<textarea data-et-field="description" style="min-height:64px">${esc(t.description||'')}</textarea>`)}
  <div class="grid2">${field('作者',input('author',t.author,'text','data-et-field="author"'))}${field('版本',input('version',t.version,'text','data-et-field="version"'))}</div>
  <div class="divider"></div><h3>纸张与排版</h3><div class="template-colors">${[['accent','主题色'],['background','画布底色'],['paper','纸张色'],['text','文字颜色']].map(([k,l])=>field(l,`<div class="color-setting"><input type="color" data-et-option="${k}" value="${esc(t.options[k])}" aria-label="${l}"><span data-et-color-label="${k}">${esc(t.options[k])}</span></div>`)).join('')}</div>
  ${field('字体',`<select data-et-option="font">${opt('serif','衬线 · 书刊质感',t.options.font)}${opt('sans','无衬线 · 现代清晰',t.options.font)}</select>`)}
  <div class="grid3">${[['width','版心宽度',400,1800],['gap','页间距',0,100],['radius','圆角',0,40]].map(([k,l,min,max])=>field(l,input(k,t.options[k],'number',`data-et-option="${k}" min="${min}" max="${max}"`))).join('')}</div>
  <div class="help">这些选项通过 {{themeColor}}、{{contentWidth}} 等变量写入 HTML。自定义源码中保留相应变量才会联动。</div>
  <div class="divider"></div>${field('用于预览的画册',`<select id="et-preview-book">${projectBooks().map(b=>opt(b.id,b.title,studioUI.previewBookId)).join('')||'<option value="">内置演示画册</option>'}</select>`)}
  ${t.builtin?'<p class="help">正在编辑内置版式。保存时自动建立副本，原版始终可用。</p>':''}`;}


function templateSourceFields(t){return `<div class="row between" style="margin-bottom:12px"><h3 style="margin:0">完整 HTML / CSS 文档</h3>${btn('插入分镜循环','plus','et-insert-loop','','ghost small')}</div><p class="template-source-info">只改变导出排版，不修改你的原始画册。支持自定义 HTML/CSS；交互翻页由系统注入。</p><textarea id="et-source" class="template-source" data-et-field="html" spellcheck="false" aria-label="自定义画册 HTML 源码">${esc(t.html)}</textarea><details class="source-guide"><summary>模板变量与安全规则</summary><p><code>{{#books}}...{{/books}}</code> 遍历画册。<br><code>{{#frames}}...{{/frames}}</code> 必须嵌套其中，遍历按序排列的分镜。</p><p><code>{{title}} {{synopsis}} {{characterName}}</code><br><code>{{image}} {{name}} {{caption}} {{prompt}} {{number}}</code><br><code>{{signature}} {{themeColor}} {{background}} {{paperColor}}</code><br><code>{{contentWidth}} {{panelGap}} {{imageRadius}} {{bodyFont}}</code></p><p>保留 <code>data-cc-book</code>、<code>data-cc-pages</code>、<code>data-cc-frame</code> 以启用翻页与奇数页保护。预览隔离于主应用，不允许外部资源、自定义脚本和事件处理属性。</p></details>`;}


function updateTemplatePreview(){
  const iframe=$('#template-preview');if(!iframe||!studioUI.editor)return;
  const status=$('#template-save-status');
  try{const t=currentEditorTemplate(),html=compileTemplateDocument(t,exportPreviewBooks(studioUI.previewBookId),{signature:state.settings.signature});iframe.srcdoc=html;if(status){status.className='validation-result '+(studioUI.editorDirty?'':'ok');status.textContent=studioUI.editorDirty?'校验通过 · 有未保存修改':'校验通过 · 预览与主应用安全隔离'}}
  catch(e){if(status){status.className='validation-result error';status.textContent=e.message}if(!iframe.srcdoc)iframe.srcdoc='<html lang="zh-CN"><body style="font:13px/1.9 sans-serif;padding:30px;color:#737a70;background:#f3f0e7"><h3>等待有效模板</h3><p>修正左侧提示后，预览会自动更新。</p></body></html>'}
}


async function closeTemplateStudio(){
  if(!await canLeaveTemplate())return false;
  clearTimeout(studioUI.previewTimer);if($('#template-studio').contains($('#toasts')))document.body.append($('#toasts'));
  $('#template-studio').close();studioUI.editorDirty=false;
  if($('#export-template-select'))renderExportHub();
  return true;
}


function saveEditedTemplate(){
  const draft=clone(currentEditorTemplate());validateExportTemplate(draft);
  const existing=exportTemplateBy(draft.id);let result=draft;
  if(draft.builtin){result=exportTemplateCopy(draft);result.title=draft.title.slice(0,100)+' · 自定义'}
  else{result.builtin=false;result.source=existing?.source||'local';result.updatedAt=Date.now()}
  if(!existing||draft.builtin){if(state.exportTemplates.length>=100)throw Error('模板库已达 100 个上限。');state.exportTemplates.push(result)}
  else Object.assign(existing,result);
  studioUI.editor=clone(result);studioUI.editorDirty=false;
  try{sessionStorage.removeItem('cc-template-draft')}catch(e){}
  if(studioUI.exportDraft){studioUI.exportDraft.templateId=result.id;studioUI.exportDraft.themeColor=null}
  save();renderTemplateStudio();toast('模板已保存。导出时即可使用。');return result;
}


async function importExportTemplate(file){
  if(file.size>2000000)throw Error('模板文件不能超过 2 MB。');
  const t=parseExportTemplateFile(await file.text(),file.name);
  let error;try{validateExportTemplate(t)}catch(e){error=e.message}
  if(error){if(!await confirmAction('在编辑器中修复这份 HTML？',error+'\n文件尚未安装，也不会执行任何脚本。可补全占位符后保存。','打开为草稿'))return;openTemplateStudio(null,t);return}
  if(!await confirmAction('导入「'+t.title+'」？','将建立独立画册模板副本，不覆盖现有模板或作品。','导入模板'))return;
  if(state.exportTemplates.length>=100)throw Error('模板库已达上限。');state.exportTemplates.push(t);save();openTemplateStudio(t.id);toast('画册模板已导入，可以继续自定义。');
}


function readExportDraft(){
  const d=studioUI.exportDraft;if(!d)return;
  if($('#export-template-select'))d.templateId=$('#export-template-select').value;
  if($('#export-color'))d.themeColor=$('#export-color').value;
  if($('#export-border'))d.border=Number($('#export-border').value);
  if($('#export-signature'))d.signature=$('#export-signature').value;
  if($('#export-captions'))d.showCaptions=$('#export-captions').checked;
  if($('#export-prompts'))d.showPrompts=$('#export-prompts').checked;
}


function showExportHub(ids,preserve=false){
  ensureStudioState();ui.exportIds=ids.filter(id=>bookBy(id));if(!ui.exportIds.length)throw Error('请选择至少一本画册。');
  if(!preserve||!studioUI.exportDraft)studioUI.exportDraft={...clone(state.settings.studio.export),signature:state.settings.signature,themeColor:null};
  studioUI.returnToExport=false;
  modal('导出你的故事','<div id="export-hub-root"></div>','用自己的 HTML 模板，为每一个故事设计阅读体验。',true);renderExportHub();
}


function renderExportHub(){
  if(!$('#export-hub-root'))return;
  let d=studioUI.exportDraft,t=exportTemplateBy(d.templateId)||state.exportTemplates[0];d.templateId=t.id;
  const b=bookBy(ui.exportIds[0]);
  $('#export-hub-root').innerHTML=`<div class="export-hub"><section><div class="export-identity">${imgTag(coverImage(b),b.title,`data-book="${b.id}" data-step="0"`)}<div class="grow"><strong>${ui.exportIds.length===1?esc(b.title):ui.exportIds.length+' 本画册合集'}</strong><p>${ui.exportIds.reduce((n,id)=>n+bookBy(id).totalSteps,0)} 幕分镜 · 全内联离线 HTML</p></div></div>${field('画册导出模板',`<select id="export-template-select" aria-label="选择画册导出 HTML 模板">${state.exportTemplates.map(x=>opt(x.id,x.title+(x.builtin?' · 内置':''),t.id)).join('')}</select>`)}<p class="export-template-description">${esc(t.description||'自定义画册 HTML 模板')}<br><span class="tiny">${exportLayouts[t.layout]} · ${esc(t.author)} · v${esc(t.version)}</span></p><div class="export-mobile-actions">${btn('自定义此模板','edit','et-open-selected','','small')}${btn('导入模板','upload','et-import','','small')}${featureEnabled('marketplace')?btn('从市场下载','box','et-export-market','','small'):''}</div><div class="divider"></div><div class="grid2">${field('本次主题色',`<input id="export-color" type="color" value="${esc(d.themeColor||t.options.accent)}" aria-label="导出主题色">`)}${field('分镜框线 / px',input('border',d.border,'number','id="export-border" min="0" max="8"'))}</div>${field('创作者签名',input('signature',d.signature,'text','id="export-signature"'))}<label class="row small soft" style="margin-bottom:12px"><input type="checkbox" id="export-captions" ${d.showCaptions?'checked':''}>显示剧情台词</label><label class="row small soft"><input type="checkbox" id="export-prompts" ${d.showPrompts?'checked':''}>附带提示词水印</label><div class="help" style="margin-top:14px">自定义版式只作用于导出的 HTML，不会改动作品与原始台词。</div></section><section class="export-hub-preview"><div class="preview-toolbar">${icon('eye','sm')}效果预览 · 首本画册前 3 幕<span class="spacer"></span>${icon('shield','sm')}</div><iframe id="export-preview" sandbox="allow-scripts" referrerpolicy="no-referrer" title="离线画册导出预览"></iframe><div class="preview-toolbar"><span>图片 / 样式 / 翻页脚本全部内联</span></div></section></div><div class="modal-footer"><span id="export-status" class="grow validation-result">按分镜顺序导出；未生成画面显示问号，原图读取失败时停止导出。</span>${btn('管理模板库','book','et-open-library','','small')}${btn('生成并下载画册','download','compile-export',studioUI.exportBusy?'disabled':'','primary')}</div>`;
  updateExportPreview();
}


function updateExportPreview(){
  const iframe=$('#export-preview');if(!iframe)return;
  try{const d=studioUI.exportDraft,t=exportTemplateBy(d.templateId);iframe.srcdoc=compileTemplateDocument(t,exportPreviewBooks(ui.exportIds[0]),d)}catch(e){const status=$('#export-status');if(status){status.className='grow validation-result error';status.textContent=e.message}}
}


async function compileCustomExport(){
  if(studioUI.exportBusy)return;readExportDraft();
  const d=clone(studioUI.exportDraft),t=clone(exportTemplateBy(d.templateId));validateExportTemplate(t);
  const ids=[...ui.exportIds];studioUI.exportBusy=true;
  const button=$('[data-act="compile-export"]');if(button)button.disabled=true;
  try{const {books,fallbacks}=await prepareExportBooks(ids,t,(done,total)=>{const s=$('#export-status');if(s)s.textContent='正在内联图片 '+done+' / '+total+'，请稍候...'});
    const html=compileTemplateDocument(t,books,d),destination=await deliverExportHTML(html,t,books);
    const status=$('#export-status');if(status){status.className='grow validation-result ok';status.textContent=(destination?'已保存到 '+destination:'画册已下载')+(fallbacks?'；'+fallbacks+' 张封面使用内置矢量版本。':'。')}
    toast(destination?'离线画册已写入「画册 / 导出」文件夹。':'离线画册已下载，使用「'+t.title+'」模板。');
  }finally{studioUI.exportBusy=false;if(button?.isConnected)button.disabled=false}
}


function workspaceVisible(index){return index===5||state.settings.studio?.visibility?.[moduleKeys[index]]!==false;}


function featureEnabled(key){return state.settings.studio?.features?.[key]!==false;}


function switchControl(path,label,value,disabled=false){return `<label class="switch"><input type="checkbox" role="switch" data-studio-pref="${path}" aria-label="${esc(label)}" ${value?'checked':''} ${disabled?'disabled':''}><span class="switch-track" aria-hidden="true"></span></label>`;}


function settingsRow(title,description,control,ic=''){return `<div class="settings-row">${ic?icon(ic):''}<div class="grow"><h3>${title}</h3><p>${description}</p></div>${control}</div>`;}


function renderSettingsWorkspace(){
  const p=state.settings.studio,tab=studioUI.settingsTab;
  const tabs=[['general','users','工作室身份'],['storage','folder','文件与保存'],['modules','grid','模块管理'],['appearance','sun','外观与阅读'],['connections','nodes','生成与连接'],['critic','shield','视觉审校 API'],['github','upload','GitHub 发布'],['export','book','导出与数据'],['guide','help','快速开始教程']];
  let content='';
  if(tab==='general')content=identitySettingsHTML();
  if(tab==='storage')content=storageSettingsHTML();
  if(tab==='critic')content=criticSettingsSummary();
  if(tab==='github')content=githubSummarySettings();
  if(tab==='guide')content=quickStartSettings();
  if(tab==='modules')content=`<section class="settings-section"><div class="row between" style="margin-bottom:9px"><h2 style="margin:0">只留下你需要的工作区</h2><select id="studio-preset" class="module-preset" aria-label="界面预设"><option value="">应用界面预设...</option value="full">完整创作工作室</option><option value="manual">专注手动分镜</option></select></div><p>隐藏入口，不删除资产。随时回来打开，作品与配置都还在。</p>${workspaces.map((w,i)=>settingsRow(w[0],['核心资产与阅读入口，始终保留。','编排镜头、提示词与默认旁白。','维护角色变量，管理批量渲染任务。','导入工作流与映射 GPU 节点。隐藏不影响引擎运行。','使用 LLM 生成剧情与模板。不需要时可从导航中隐藏。'][i],switchControl('visibility.'+moduleKeys[i],w[0]+'可见',p.visibility[moduleKeys[i]],i===0),w[1])).join('')}</section><section class="settings-section"><h2>辅助功能开关</h2><p>停用后不再提供新的操作入口，历史数据仍保留。已运行任务不会被静默中断。</p>${[['assistant','分镜精修助手','用自然语言修改当前分镜模板，不是生图聊天机器人。','spark'],['marketplace','模板与插件市场','发现并安装分镜、角色、工作流和画册 HTML 模板。','box'],['visualCritic','视觉审校','检查单页画面，或在批量出图后自动生成报告。','shield'],['executionLogs','执行终端日志','显示队列调度详情。隐藏后仍会记录本次运行日志。','terminal']].map(([key,l,d,ic])=>settingsRow(l,d,switchControl('features.'+key,l,p.features[key]),ic)).join('')}</section><div class="settings-note">${icon('shield')}<span>快捷键与命令面板会同步隐藏工作区入口。正在运行的队列与剧本推演，可在“生成与连接”中停止。</span></div>`;
  if(tab==='appearance')content=`<section class="settings-section"><h2>为长时间创作调校界面</h2><p>安静一点，紧凑一点，或让阅读成为你的默认入口。</p>${settingsRow('界面主题','日光适合明亮环境；暗室让画面更突出。',`<select id="studio-theme" class="inline-setting" aria-label="界面主题">${opt('dark','暗室 / Dark',document.documentElement.dataset.theme)}${opt('light','日光 / Light',document.documentElement.dataset.theme)}</select>`,'sun')}${settingsRow('界面密度','紧凑模式减少表格与面板间距。',`<select class="inline-setting" data-studio-pref="appearance.density" aria-label="界面密度">${opt('comfortable','舒适',p.appearance.density)}${opt('compact','紧凑',p.appearance.density)}</select>`,'list')}${settingsRow('减少动态效果','关闭入场、微光和翻页动画；同时尊重系统减弱动态设置。',switchControl('appearance.reduceMotion','减少动态效果',p.appearance.reduceMotion),'eye')}${settingsRow('显示画廊统计','隐藏顶部统计区域，把更多空间留给画作。',switchControl('appearance.showMetrics','显示画廊统计',p.appearance.showMetrics),'grid')}</section><section class="settings-section"><h2>阅读器默认行为</h2>${settingsRow('打开画册时的模式','只影响下次打开的画册，不打断当前阅读。',`<select class="inline-setting" data-studio-pref="reader.defaultMode" aria-label="默认阅读模式">${[['focus','单页专注'],['manga','Manga 双页'],['webtoon','Webtoon 长卷'],['flip','3D 翻页']].map(x=>opt(...x,p.reader.defaultMode)).join('')}</select>`,'book')}${settingsRow('助手修改前确认','应用工具修改前，显示将受影响的模板与分镜。',switchControl('assistant.confirmChanges','助手修改前确认',p.assistant.confirmChanges),'shield')}</section>`;
  if(tab==='connections')content=`<section class="settings-section"><h2>连接与生成默认值</h2><p>隐藏工作区不会关闭引擎。离线模拟与真实服务始终明确区分。</p><div class="settings-connections"><div class="connection-setting">${icon('nodes')}<h3>ComfyUI 图像引擎</h3><p>${state.settings.comfy.mode==='mock'?'当前：本地 SVG 演示模式':esc(state.settings.comfy.baseUrl)}<br>节点映射和工作流配置独立保留。</p>${btn('连接配置','settings','engine-info','','small')}${btn('测试','refresh','test-engine','style="margin-left:7px"','small')}</div><div class="connection-setting">${icon('spark')}<h3>LLM 与精修助手</h3><p>${llmMock()?'当前：离线规则模拟':esc(state.settings.llm.model)}<br>剧情台与精修助手共用兼容 API 设置。</p>${btn('模型与密钥','settings','llm-settings','','small')}</div></div><div class="divider"></div>${field('全局负向提示词',`<textarea data-setting="negative">${esc(state.settings.negative)}</textarea>`)}${settingsRow('批量出图后自动审校','连续 3 次失败后熔断，已生成画面始终保留。',`<label class="switch"><input type="checkbox" role="switch" aria-label="自动视觉审校" data-setting="autoCritique" ${state.settings.autoCritique?'checked':''} ${!featureEnabled('visualCritic')?'disabled':''}><span class="switch-track"></span></label>`,'shield')}<p class="help">${featureEnabled('visualCritic')?'可在“模块管理”中整体停用审校功能。':'视觉审校已停用，请先在模块管理中启用。'}</p></section><section class="settings-section"><h2>后台任务控制</h2><div class="settings-row"><div class="grow"><h3>图像渲染流水线</h3><p>${rt.running?'正在运行，关闭或隐藏工作区不会中断。':'当前没有运行中的本地任务。'}</p></div>${btn('中止图像任务','stop','interrupt','','small danger')}</div><div class="settings-row"><div class="grow"><h3>剧本推演流水线</h3><p>${rt.llmBusy?'正在推演，已完成的分段会自动保留。':'当前没有运行中的剧本推演。'}</p></div>${btn('停止推演','stop','stop-llm',rt.llmBusy?'':'disabled','small danger')}</div></section>`;
  if(tab==='export')content=`<section class="settings-section"><h2>让每次导出都有你的风格</h2><p>选择默认 HTML 模板；每次导出仍可单独调整主题色、签名与台词。</p>${settingsRow('默认画册模板','新打开的导出窗口会优先使用此模板。',`<select class="inline-setting" data-studio-pref="export.templateId" aria-label="默认导出模板">${state.exportTemplates.map(t=>opt(t.id,t.title,p.export.templateId)).join('')}</select>`,'book')}<div class="row" style="padding:14px 0">${btn('管理与自定义模板','edit','et-open-library','','small')}${featureEnabled('marketplace')?btn('从市场下载','box','et-settings-market','','small'):''}</div>${field('默认创作者签名',setting('signature',state.settings.signature))}${settingsRow('默认显示剧情台词','关闭时导出纯画面版本，不会删除原始台词。',switchControl('export.showCaptions','默认导出台词',p.export.showCaptions),'story')}${settingsRow('默认附带提示词','开启后提示词会写入导出的离线 HTML。',switchControl('export.showPrompts','默认导出提示词',p.export.showPrompts),'edit')}${settingsRow('默认分镜框线','支持 0 至 8 px，0 为无框线。',`<input type="number" class="inline-setting" data-studio-pref="export.border" min="0" max="8" value="${p.export.border}" aria-label="默认分镜框线">`,'image')}</section><section class="settings-section"><h2>工程与数据</h2><p>自定义画册模板、模块开关和默认设置均会随全量工程备份迁移。不会自动上传任何作品。</p><div class="row wrap">${btn('工程备份与恢复','disk','backup')}${btn('系统自检','shield','diagnostics')}</div><div class="divider"></div>${settingsRow('恢复界面默认设置','只还原模块开关、阅读和导出默认值。不会删除模板、画册、角色或 API 配置。',btn('恢复默认','refresh','studio-reset','','small'),'refresh')}</section>`;
  return `<div class="settings-intro">${heading('工作室设置','让工具适应你的创作，而不是反过来。',btn('返回画廊','arrow','workspace','data-index="0"'),'YOUR STUDIO, YOUR WAY.')}</div><div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${tabs.map(([v,ic,l])=>`<button class="${tab===v?'active':''}" data-act="studio-tab" data-tab="${v}" ${tab===v?'aria-current="page"':''}>${icon(ic,'sm')}${l}</button>`).join('')}</nav><div id="studio-settings-content">${content}<div class="settings-summary">${icon('disk','sm')}更改即时生效，自动保存到本地。<span class="spacer"></span>v${MIO_VERSION}</div></div></div>`;
}


function applyStudioPreferences(){
  const p=state.settings.studio;if(!p)return;
  document.documentElement.dataset.theme=p.appearance.theme;
  try{localStorage.setItem('cc-theme',p.appearance.theme)}catch(e){}
  document.documentElement.dataset.density=p.appearance.density;
  document.documentElement.dataset.reduceMotion=String(p.appearance.reduceMotion);
  document.querySelectorAll('.metrics').forEach(e=>e.hidden=!p.appearance.showMetrics);
  const launcher=$('.assistant-launch');if(launcher)launcher.hidden=!featureEnabled('assistant');
  if(!featureEnabled('assistant'))$('#assistant').hidden=true;
  $$('.terminal').forEach(e=>e.hidden=e.closest('.logs-full')?!state.settings.studio.visibility.logs:!featureEnabled('executionLogs'));
  for(const e of $$('[data-act]')){
    const a=e.dataset.act;
    if(a==='assistant'){e.hidden=!featureEnabled('assistant');e.title='分镜精修助手：用自然语言修改源模板的提示词与台词';if(!e.classList.contains('assistant-launch'))e.setAttribute('aria-label','打开分镜精修助手')}
    if(['market','et-market','et-export-market','et-settings-market'].includes(a))e.hidden=!featureEnabled('marketplace');
    if(['critique','apply-critique'].includes(a))e.hidden=!featureEnabled('visualCritic');
    if(['batch-story','script-regenerate'].includes(a))e.hidden=!workspaceVisible(4);
  }
  $$('.score-block').forEach(e=>e.hidden=!featureEnabled('visualCritic'));
}


function renderStudioShell(){
  ensureStudioState();
  const title=ui.workspace===5?'工作室设置':workspaces[ui.workspace]?.[0]||'画廊展厅';
  $('#sidebar').innerHTML=`<a class="brand" href="#gallery" data-act="workspace" data-index="0"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><div class="brand-text"><div class="brand-name">Mio</div><div class="brand-sub">STUDIO <span>v2.3</span></div></div></a><button class="side-search" data-act="command">${icon('search')}<span class="grow">搜索与快速操作</span><kbd class="kbd">⌘ K</kbd></button><div class="nav-label">创作工作区 / WORKSPACE</div><nav class="nav-list">${workspaces.map((w,i)=>workspaceVisible(i)?`<button class="nav-item ${ui.workspace===i?'active':''}" data-act="workspace" data-index="${i}" title="${w[0]} (${i+1})" aria-label="${w[0]}" ${ui.workspace===i?'aria-current="page"':''}>${icon(w[1])}<span>${w[0]}</span><b class="nav-key">${i+1}</b></button>`:'').join('')}</nav><section class="side-section"><div class="nav-label row between">我的企划 ${ibtn('plus','new-project','新建企划')}</div><div class="nav-list">${state.projects.map(p=>`<button class="side-project" data-act="project" data-id="${p.id}"><i class="dot ${p.id===state.activeProjectId?'':'amber'}" style="opacity:${p.id===state.activeProjectId?1:.45}"></i><span>${esc(p.title)}</span><span class="count">${state.books.filter(b=>b.projectId===p.id).length}</span></button>`).join('')}<button class="side-project muted" data-act="new-project">${icon('plus','sm')}新建企划</button></div></section><div class="side-bottom"><nav class="nav-list nav-utility"><button class="nav-item" data-act="et-open-library" title="自定义画册导出的 HTML 与 CSS" aria-label="画册导出模板">${icon('book')}<span>画册导出模板</span></button>${featureEnabled('marketplace')?`<button class="nav-item" data-act="market" title="模板与插件市场" aria-label="模板与插件市场">${icon('box')}<span>模板与插件市场</span></button>`:''}<button class="nav-item" data-act="backup" title="工程备份与迁移" aria-label="工程备份与迁移">${icon('disk')}<span>工程备份与迁移</span></button><button class="nav-item ${ui.workspace===5?'active':''}" data-act="settings" title="工作室设置 (Cmd / Ctrl + ,)" aria-label="工作室设置" ${ui.workspace===5?'aria-current="page"':''}>${icon('settings')}<span>工作室设置</span><b class="nav-key">,</b></button></nav><div class="profile" style="margin-top:17px"><div class="avatar">K</div><div class="grow"><strong>Kira 的工作室</strong><p>LOCAL WORKSPACE</p></div>${icon('shield','sm')}</div></div>`;
  $('#topbar').innerHTML=`<div class="breadcrumb"><span>工作空间</span><span>/</span><strong>${title}</strong></div><div class="top-separator"></div><div class="row">${icon('folder','sm')}<select class="project-select" id="project-select" aria-label="切换企划">${state.projects.map(p=>opt(p.id,p.title,state.activeProjectId)).join('')}</select></div><div class="spacer"></div><button class="engine-status" data-act="engine-info" title="当前引擎模式与连接状态"><i class="dot ${rt.connected||state.settings.comfy.mode==='mock'?'':'amber'}"></i><span>${state.settings.comfy.mode==='mock'?'本地演示引擎':rt.connected?'ComfyUI 已连接':'ComfyUI 未连接'}</span><span class="engine-address mono" style="opacity:.5;margin-left:3px">${state.settings.comfy.mode==='mock'?'SVG':rt.vram!==null?rt.vram+'% VRAM':'GPU'}</span></button><button class="top-queue" data-act="${workspaceVisible(2)?'workspace':'studio-background'}" data-index="2">${icon('nodes','sm')}队列 <b>${state.queue.filter(q=>['pending','running','paused'].includes(q.status)).length}</b></button><div class="top-separator"></div>${ibtn('sun','theme','切换日光 / 暗室')}${ibtn('settings','settings','工作室设置')}`;
  const launch=$('.assistant-launch');launch.innerHTML=icon('spark')+'<span><strong>分镜精修助手</strong><small>用自然语言改提示词与台词</small></span><span class="kbd" style="color:inherit">⌘ J</span>';launch.setAttribute('aria-label','分镜精修助手：用自然语言修改当前模板');
  applyStudioPreferences();renderStatus();
}


function navigateStudio(index){
  const n=Number(index);if(!Number.isInteger(n)||n<0||n>5)return;
  if(!workspaceVisible(n)){toast('此工作区已隐藏，可在“工作室设置 → 模块管理”中重新打开。');return}
  flushEditor();saveStoryInputs();ui.workspace=n;render();window.scrollTo({top:0,behavior:'instant'});
}


function changeStudioPreference(el){
  const path=el.dataset.studioPref,[group,key]=path.split('.');
  if(!Object.hasOwn(studioDefaults,group)||!Object.hasOwn(studioDefaults[group],key))throw Error('未知的工作室设置。');
  let value=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
  if(path==='visibility.gallery')value=true;
  if(path==='export.border'&&(!Number.isFinite(value)||value<0||value>8))throw Error('分镜框线需为 0 至 8 px。');
  if(path==='export.templateId'&&!exportTemplateBy(value))throw Error('默认导出模板不存在。');
  if(path==='reader.defaultMode'&&!['focus','manga','webtoon','flip'].includes(value))throw Error('阅读模式不合法。');
  if(path==='appearance.density'&&!['compact','comfortable'].includes(value))throw Error('界面密度不合法。');
  state.settings.studio[group][key]=value;
  if(path==='features.visualCritic'&&!value)state.settings.autoCritique=false;
  if(!workspaceVisible(ui.workspace))ui.workspace=0;
  save();renderShell();applyStudioPreferences();
  if(path==='assistant.confirmChanges')updateAssistantDisclosure();
  if(group==='features'&&ui.workspace===5)render();
}


function buildStudioCommandIndex(query){
  const all=[];
  workspaces.forEach((w,i)=>{if(workspaceVisible(i))all.push({title:w[0],type:'工作区 '+(i+1),icon:w[1],run:()=>navigate(i)})});
  all.push({title:'工作室设置 · 模块显示与功能开关',type:'设置',icon:'settings',run:()=>navigate(5)},{title:'画册 HTML 导出模板库',type:'导出模板',icon:'book',run:()=>openTemplateStudio()});
  for(const b of state.books)all.push({title:b.title,type:'画册 · '+b.characterName,icon:'book',run:()=>{changeProject(b.projectId);openReader(b.id)}});
  if(workspaceVisible(1))for(const t of state.templates)all.push({title:t.title,type:'分镜剧本模板',icon:'story',run:()=>{changeProject(t.projectId);ui.templateId=t.id;ui.frameIndex=0;navigate(1)}});
  if(workspaceVisible(2))for(const r of state.rows)all.push({title:r.character+' · '+r.bookTitle,type:'矩阵角色',icon:'users',run:()=>{changeProject(r.projectId);navigate(2);characterModal(r.id)}});
  for(const t of state.exportTemplates)all.push({title:t.title,type:'画册 HTML 模板',icon:'book',run:()=>openTemplateStudio(t.id)});
  const shortcuts=[['工程备份 / 恢复','disk','backup'],...(workspaceVisible(1)?[['新建分镜模板','plus','new-template']]:[]),...(workspaceVisible(2)?[['追加角色','users','add-row'],['启动批量出图','play','start-batch']]:[]),...(featureEnabled('assistant')?[['分镜精修助手 · 用自然语言修改模板','spark','assistant']]:[]),...(featureEnabled('marketplace')?[['画册模板市场','box','et-settings-market']]:[])];
  shortcuts.forEach(([title,ic,act])=>all.push({title,type:'快捷动作',icon:ic,run:()=>handleAction(act,{})}));
  rt.commandItems=all.filter(x=>(x.title+' '+x.type).toLowerCase().includes(query.toLowerCase())).slice(0,55);rt.commandIndex=clamp(rt.commandIndex,0,Math.max(0,rt.commandItems.length-1));
  $('#command-results').innerHTML=rt.commandItems.map((x,i)=>`<button class="command-item ${i===rt.commandIndex?'active':''}" data-act="run-command" data-index="${i}">${icon(x.icon)}<span>${esc(x.title)}</span><small>${esc(x.type)}</small></button>`).join('')||'<div class="empty" style="padding:30px">没有匹配的结果。隐藏的工作区可在设置中重新启用。</div>';
}


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


function marketTemplate(packageId){const c=exportMarketCatalog.find(c=>c.id===packageId);if(!c)throw Error('画册模板包不存在。');return {...makeExportTemplate(uid('export'),c.title,c.layout,c.options,c.desc,'market'),version:c.version,packageId:c.id};}


function marketCardHTML(c,installed){
  return `<article class="market-item ${c.type==='exports'?'market-item-export':''}" data-market-id="${esc(c.id)}">${c.type==='exports'?`<button class="market-preview-strip" style="width:100%;background:${c.options.background};--mini-accent:${c.options.accent}" data-act="et-market-preview" data-id="${c.id}" aria-label="预览 ${esc(c.title)}"><span class="mini-page"><i></i><span></span></span><span class="mini-page"><i></i><span></span></span></button>`:`<div class="row accent">${icon(c.icon)}<span class="spacer"></span><span class="tiny">v${esc(c.version)}</span></div>`}<div class="row"><h3 data-user-content class="grow" style="margin:0 0 7px">${esc(c.title)}</h3>${c.type==='exports'?'<span class="utility-caption">HTML / CSS</span>':''}</div><p data-user-content>${esc(c.desc)}</p><div data-user-content class="tiny muted" style="margin-bottom:13px">${esc(c.author)} · v${esc(c.version)}</div><div class="row">${c.type==='exports'?btn('预览','eye','et-market-preview',`data-id="${c.id}"`,'small')+btn('下载模板','download','et-market-download',`data-id="${c.id}"`,'small'):''}<span class="spacer"></span>${btn(installed?'卸载':'安装',installed?'check':'plus','market-install',`data-id="${c.id}"`,'small '+(installed?'':'primary'))}</div></article>`;
}

function renderStudioMarket(){
  const q=ui.marketSearch.toLowerCase(),items=catalog.filter(c=>(ui.marketTab==='all'||ui.marketTab===c.type)&&[c.title,c.desc,c.tags,c.author].join(' ').toLowerCase().includes(q));
  const installedIds=new Set(state.installedPackages.map(p=>p.id));
  $('#market-content').innerHTML=`<div class="tabbar market-subtabs" style="gap:20px">${[['all','全部'],['exports','画册 HTML 模板'],['templates','分镜剧本'],['characters','角色资产'],['workflows','工作流'],['rules','审校规则']].map(([v,l])=>`<button class="tab ${ui.marketTab===v?'active':''}" data-act="market-tab" data-tab="${v}">${l}</button>`).join('')}</div><div class="row" style="margin-top:18px"><div class="search-field" style="max-width:none">${icon('search')}<input id="market-search" value="${esc(ui.marketSearch)}" placeholder="搜索画册模板、作者或标签..." aria-label="搜索市场资源"></div>${studioUI.returnToExport?btn('返回画册导出','arrow','et-return-export','','small'):''}</div><div class="row wrap" style="margin-top:12px">${['画册','治愈','赛博','极简'].map(t=>btn(t,'','market-tag',`data-tag="${t}"`,'small ghost')).join('')}<span class="spacer"></span><span class="tiny muted">内置精选 · 可离线安装与下载</span></div><div class="market-grid">${items.map(c=>marketCardHTML(c,installedIds.has(c.id))).join('')||'<div class="empty">没有匹配的组件，试试其他标签。</div>'}</div><div class="divider"></div><h3 class="panel-title">从 GitHub / Gitee / 自有仓库导入</h3><div class="row"><input id="raw-url" placeholder="粘贴 Raw JSON 或 HTML 模板链接" aria-label="外部组件地址">${btn('解析并导入','download','import-raw')}</div><div class="help">支持画册 HTML 模板包与分镜、工作流 JSON。GitHub /blob/ 链接自动转换为 Raw，外部模板须通过离线安全校验。</div>`;
}


function previewMarketTemplate(id){
  const c=exportMarketCatalog.find(c=>c.id===id),t=marketTemplate(id),installed=state.installedPackages.some(p=>p.id===id);
  modal(c.title,`<p class="export-template-description">${esc(c.desc)}<br>${esc(c.author)} · v${esc(c.version)} · ${exportLayouts[c.layout]}</p><iframe id="market-template-preview" sandbox="allow-scripts" referrerpolicy="no-referrer" title="市场画册 HTML 模板预览" style="width:100%;height:470px;border:1px solid var(--line);border-radius:5px"></iframe><div class="modal-footer">${btn('返回市场','','market')}${btn('下载模板包','download','et-market-download',`data-id="${id}"`)}${btn(installed?'在模板库编辑':'安装到模板库',installed?'edit':'plus',installed?'et-open-installed':'market-install',`data-id="${id}"`,'primary')}</div>`,'预览使用本地矢量示例画面，不发送任何数据。',true);
  $('#market-template-preview').srcdoc=compileTemplateDocument(t,exportPreviewBooks(ui.exportIds?.[0]));
}


async function installExportPackage(id){
  const c=exportMarketCatalog.find(c=>c.id===id),installed=state.installedPackages.find(p=>p.id===id);
  if(!c)return false;
  if(installed){
    if(!await confirmAction('卸载「'+c.title+'」？','将移除该市场包安装的模板。如果你直接编辑过安装模板，请先复制或导出备份。独立复制的模板和已导出的画册不会被删除。','卸载模板包'))return true;
    state.exportTemplates=state.exportTemplates.filter(t=>!installed.assetIds.includes(t.id));state.installedPackages=state.installedPackages.filter(p=>p.id!==id);ensureStudioState();
    if(studioUI.exportDraft&&!exportTemplateBy(studioUI.exportDraft.templateId))studioUI.exportDraft.templateId=state.settings.studio.export.templateId;
    toast('模板包已卸载，独立副本仍然保留。');
  }else{
    if(state.exportTemplates.length>=100)throw Error('画册模板库已达上限。');
    const t=marketTemplate(id);validateExportTemplate(t);state.exportTemplates.push(t);state.installedPackages.push({id,title:c.title,type:'exports',assetIds:[t.id],version:c.version});
    if(studioUI.exportDraft){studioUI.exportDraft.templateId=t.id;studioUI.exportDraft.themeColor=null}
    toast('「'+c.title+'」已安装，可在导出时选择或继续修改。');
  }
  save(true);renderShell();if($('#market-content'))renderMarket();else previewMarketTemplate(id);return true;
}


async function importStudioRaw(){
  const raw=$('#raw-url')?.value.trim();if(!raw)throw Error('请先输入资源地址。');let url=new URL(raw);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('请输入可信的 HTTP(S) Raw 地址。');
  if(url.hostname==='github.com'&&url.pathname.includes('/blob/'))url=new URL('https://raw.githubusercontent.com'+url.pathname.replace('/blob/','/'));
  if(url.hostname==='gitee.com')url.pathname=url.pathname.replace('/blob/','/raw/');
  const text=await(await request(url.href,{},15000)).text();if(text.length>2000000)throw Error('外部资源超过 2 MB，已拒绝导入。');
  let data;try{data=JSON.parse(text)}catch(e){}
  if(!data||data.kind===templateKind||data.template?.kind===templateKind){
    const t=parseExportTemplateFile(text,url.pathname.split('/').pop()||'外部模板');validateExportTemplate(t);
    if(!await confirmAction('安装外部画册模板？','名称：'+t.title+'\n来源：'+url.hostname+'\n已校验 HTML/CSS，不执行自定义脚本。','安装新副本'))return;
    if(state.exportTemplates.length>=100)throw Error('模板库已达上限。');t.sourceUrl=url.href;state.exportTemplates.push(t);save();openTemplateStudio(t.id);toast('外部 HTML 模板已安装。');return;
  }
  if(!await confirmAction('导入外部 JSON 资产？','作为独立副本导入，不覆盖已有资产。','校验并导入'))return;
  if(data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length&&Object.values(data).every(n=>n?.class_type)){validateWorkflow(data);state.settings.comfy.presets.push({id:uid('wf'),title:'外部工作流',workflow:data,mapping:clone(state.settings.comfy.mapping)});save()}
  else importTemplateObject(data);
  toast('外部资产已导入。');
}


function getStartupProfile(){try{return JSON.parse(localStorage.getItem('cc-workspace-profile')||'null')}catch(e){return null}}


function rememberProfile(){const v=state.settings.identity;if(!v?.workspaceName)return;try{localStorage.setItem('cc-workspace-profile',JSON.stringify({workspaceName:v.workspaceName,creatorName:v.creatorName,onboarded:!!v.onboarded}))}catch(e){}}


function workspaceName(){return state.settings.identity?.workspaceName||'未命名工作室'}


function tooltipText(el){return el.dataset.tip||actionHelp[el.dataset.act]||el.getAttribute('title')||''}


function hideTip(){clearTimeout(detailUI.tooltipTimer);const tip=$('#ui-tooltip');if(tip&&!tip.hidden)tip.hidden=true;detailUI.tooltipTarget?.removeAttribute('aria-describedby');detailUI.tooltipTarget=null}


function revealTip(el){
  const text=tooltipText(el);if(!text||!el.isConnected)return;
  let tip=$('#ui-tooltip');if(!tip){tip=document.createElement('div');tip.id='ui-tooltip';tip.className='ui-tooltip';tip.setAttribute('role','tooltip')}
  const host=el.closest('dialog')||document.body;host.append(tip);tip.textContent=text;tip.hidden=false;el.setAttribute('aria-describedby','ui-tooltip');
  const r=el.getBoundingClientRect(),box=tip.getBoundingClientRect();let top=r.bottom+9;if(top+box.height>innerHeight-12)top=r.top-box.height-9;
  tip.style.left=clamp(r.left+r.width/2-box.width/2,12,Math.max(12,innerWidth-box.width-12))+'px';tip.style.top=Math.max(12,top)+'px';detailUI.tooltipTarget=el;
}


function hint(text){return `<button type="button" class="hint-button" data-tip="${esc(text)}" aria-label="操作说明：${esc(text)}">?</button>`}


function renderProjectPopover(){
  const menu=$('#project-popover'),button=$('#project-switch-button');if(!menu||!button)return;
  menu.innerHTML=`<div class="project-popover-label">切换企划 / PROJECTS</div>${state.projects.map(p=>`<button class="project-choice" role="menuitem" aria-current="${p.id===state.activeProjectId}" data-act="project" data-id="${p.id}">${icon('folder','sm')}<span class="grow"><strong>${esc(p.title)}</strong><small>${state.books.filter(b=>b.projectId===p.id).length} 本画册 · 独立资产目录</small></span>${p.id===state.activeProjectId?icon('check','sm'):''}</button>`).join('')}<button class="project-new" role="menuitem" data-act="new-project">${icon('plus','sm')}新建企划<span class="spacer"></span><span class="kbd">N</span></button><button class="project-choice" role="menuitem" data-act="project-rename">${icon('edit','sm')}<span style="font-size:11px">重命名当前企划</span></button>`;
  const rect=button.getBoundingClientRect();menu.style.left=clamp(rect.left,12,innerWidth-312)+'px';menu.style.top=(rect.bottom+7)+'px';menu.hidden=false;button.setAttribute('aria-expanded','true');detailUI.projectOpen=true;
}


function closeProjectPopover(){const menu=$('#project-popover');if(menu)menu.hidden=true;$('#project-switch-button')?.setAttribute('aria-expanded','false');detailUI.projectOpen=false}


function decorateWorkspaceShell(){
  ensureWorkspaceIdentity();
  const select=$('#project-select');if(select){const parent=select.parentElement;parent.outerHTML=`<button id="project-switch-button" class="project-switch" data-act="project-toggle" aria-haspopup="menu" aria-expanded="false" aria-controls="project-popover">${icon('folder','sm')}<span class="project-switch-name">${esc(project().title)}</span>${icon('down','sm')}</button>`}
  $$('.side-section [data-act="new-project"]').forEach(e=>e.remove());
  const navLabel=$('.side-section .nav-label');if(navLabel)navLabel.innerHTML='我的企划 <span class="utility-caption">在顶栏切换 / 新建</span>';
  const profile=$('.profile');if(profile)profile.innerHTML=`<button class="workspace-profile-button" data-act="profile-settings" data-tip="点击修改工作室名称与创作者署名"><span class="avatar">${esc([...workspaceName()][0])}</span><span class="grow"><strong>${esc(workspaceName())}</strong><p>${disk.root?'LOCAL DISK STUDIO':'TEMPORARY SESSION'}</p></span>${icon('edit','sm')}</button>`;
  const version=$('.brand-sub span');if(version)version.textContent='v2.4';
  if(detailUI.projectOpen)renderProjectPopover();
}


function descriptiveBookMenu(id){
  const b=bookBy(id);if(!b)throw Error('画册不存在。');
  const rows=[['book','read','沉浸阅读','查看画面、台词与逐页精修工具。'],['star','star',b.liked?'取消星标':'加入星标','仅在本地收藏，方便之后快速找到。'],['copy','copy-book','复制画册概要','复制标题、角色、故事概要与标签。'],['compare','compare-book','对比剧情版本','并排查看同角色、同模板的不同剧情。'],['download','export-book','导出离线画册','选择精装版式，生成单文件 HTML。'],['refresh','resume','补齐缺失分镜',missingIndices(b).length?'检测到 '+missingIndices(b).length+' 个待补齐分镜，已完成图片不重跑。':'所有分镜已齐备，无需重复生成。']];
  modal('画册操作',`<div class="book-actions-heading">${imgTag(coverImage(b),b.title,`data-book="${b.id}" data-step="0"`)}<div class="grow"><h3>${esc(b.title)}</h3><p>${esc(b.characterName)} · ${b.generatedSteps} / ${b.totalSteps} 幕<br>${esc(b.synopsis)}</p></div></div>${rows.map(([ic,a,title,sub])=>`<div class="book-action-row"><button class="book-action" data-act="${a}" data-id="${b.id}" ${a==='resume'&&!missingIndices(b).length?'disabled':''}>${icon(ic)}<span class="grow"><strong>${title}</strong><small>${sub}</small></span>${icon('arrow','sm')}</button>${hint(actionHelp[a])}</div>`).join('')}<div class="row" style="padding-top:19px"><span class="tiny muted grow">悬停在 ? 上可查看更完整的操作说明。</span>${btn('移除画册','trash','delete-book',`data-id="${b.id}"`,'small danger')}${hint(actionHelp['delete-book'])}</div>`,'所有操作仅作用于你的私有工程。');
}


function identitySettingsHTML(){
  const identity=state.settings.identity;
  return `<section class="settings-section workspace-identity"><h2>这是你的工作室</h2><p>名称显示在侧栏与工作室文件中。创作者署名可用于画册落款。</p><div class="row" style="margin:22px 0"><div class="workspace-monogram">${esc([...workspaceName()][0])}</div><div><strong style="font-size:14px;font-weight:500">${esc(workspaceName())}</strong><p class="tiny muted" style="margin:7px 0 0">PRIVATE CREATIVE WORKSPACE</p></div></div>${field('工作室名称',input('workspaceName',identity.workspaceName,'text','id="identity-workspace" maxlength="40" placeholder="例如：纸间漫画工作室"'))}${field('创作者署名',input('creatorName',identity.creatorName||'','text','id="identity-creator" maxlength="60" placeholder="你的名字或笔名"'))}<label class="row small soft" style="margin-bottom:20px"><input id="identity-sync-signature" type="checkbox" checked>同时用此署名作为默认画册签名</label>${btn('保存名称与署名','check','identity-save','','primary')}<div class="help">修改名称不会移动或重命名已有项目文件夹，不会破坏图片引用。</div></section><section class="settings-section"><h2>你的作品在哪里？</h2><p>工作室数据以普通文件保存。目录访问需要你主动授权。</p>${disk.root?`<div class="disk-path">${esc(disk.root.name)} / workspace.json</div>`:'<div class="disk-warning">尚未连接本地目录。当前更改只在本次会话内，关闭前请连接目录或下载备份。</div>'}<div class="row" style="margin-top:15px">${btn('管理文件保存位置','folder','storage-settings')}${btn('下载目录备份','download','disk-archive')}</div></section>`;
}


function saveIdentityFromForm(){
  const name=$('#identity-workspace')?.value.trim(),creator=$('#identity-creator')?.value.trim()||'';
  if(!name||name.length>40)throw Error('请输入 1 至 40 个字符的工作室名称。');
  Object.assign(state.settings.identity,{workspaceName:name,creatorName:creator,onboarded:true});if($('#identity-sync-signature')?.checked)state.settings.signature=creator||name;
  rememberProfile();save();render();toast(disk.root?'名称已更新，正在写入工作室目录。':'名称已更新；作品尚未连接落盘目录。');
}


function showWorkspaceWelcome(){
  const identity=state.settings.identity,named=!!identity.workspaceName;
  $('#welcome-dialog').innerHTML=`<div class="welcome-content"><div class="welcome-brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Mio <span class="spacer"></span><span class="utility-caption">YOUR STORIES LIVE HERE</span></div><h1 id="welcome-title">${named?'欢迎回到，<br>'+esc(identity.workspaceName)+'。':'先给你的工作室，<br>起一个名字。'}</h1><p class="welcome-description">一个属于你的创作空间。企划、画册和原始图片，都可以保存在你选择的本地文件夹中。</p><div class="welcome-step">01 / 工作室身份</div>${field('工作室名称',input('name',identity.workspaceName||'','text','id="welcome-name" maxlength="40" placeholder="例如：纸间漫画工作室" autocomplete="organization"'))}${field('创作者署名（可选）',input('creator',identity.creatorName||'','text','id="welcome-creator" maxlength="60" placeholder="你的名字或笔名"'))}<div class="welcome-step">02 / 作品保存位置</div><div class="welcome-folder">${icon('folder')}<div class="grow"><strong>${disk.remembered?'重新连接 '+esc(disk.remembered.name):'选择工作室根目录'}</strong><p>自动建立「企划 / 画册 / 图片」目录。<br>已有工作室目录会先读取，不会被示例工程覆盖。</p></div>${btn(disk.remembered?'重新授权':'选择文件夹','folder',disk.remembered?'welcome-reconnect':'welcome-connect','','small')}</div><div class="welcome-limit">${diskSupported()?'目录读写需浏览器授权。只有状态栏显示“已写入磁盘”才表示保存完成。':'当前浏览器或嵌入环境可能不支持直接写入目录。推荐在桌面 Chrome / Edge 的安全页面中打开；也可下载 ZIP 目录包后手动管理。'}${disk.legacy?'<br>检测到浏览器缓存工程，连接新目录后可一并迁移。':''}</div><div class="welcome-foot">${btn('打开已有目录（只读）','upload','welcome-import','','ghost small')}${btn('命名并进入临时会话','arrow','welcome-temporary','','primary')}</div><p class="help" style="margin:12px 0 0">临时会话不会自动保存作品。工作室名称之后可在设置中修改。</p></div>`;
  const connect=$('[data-act="welcome-connect"],[data-act="welcome-reconnect"]',$('#welcome-dialog'));if(connect)connect.classList.add('primary');if(diskSupported()){$('[data-act="welcome-temporary"]',$('#welcome-dialog')).classList.remove('primary');$('[data-act="welcome-temporary"]',$('#welcome-dialog')).textContent='稍后连接，先进入临时会话'}
  $('#welcome-name').setAttribute('aria-label','工作室名称');$('#welcome-creator').setAttribute('aria-label','创作者署名');
  if(!$('#welcome-dialog').open)$('#welcome-dialog').showModal();setTimeout(()=>$('#welcome-name')?.focus(),50);
}


function captureWelcomeIdentity(){
  const name=$('#welcome-name')?.value.trim(),creator=$('#welcome-creator')?.value.trim()||'';if(!name||name.length>40)throw Error('请先输入工作室名称。');
  const value={workspaceName:name,creatorName:creator,onboarded:true};Object.assign(state.settings.identity,value);state.settings.signature=creator||name;detailUI.profileDraft=value;return value;
}


function finishWelcome(){state.settings.identity.onboarded=true;rememberProfile();$('#welcome-dialog').close();save();render()}


function contextualTemplate(){if($('#reader').open)return templateBy(bookBy(ui.bookId)?.templateId);if(ui.workspace===4)return templateBy(ui.storyTemplateId);return currentTemplate()}


function bindChatToTemplate(id,newBranch=false){
  const template=templateBy(id);if(!template)return null;
  const old=currentChat();if(old&&$('#chat-input'))old.draft=$('#chat-input').value;
  let chat=!newBranch?state.chats.find(c=>c.templateId===id):null;
  if(!chat){const reusable=!newBranch?state.chats.find(c=>!c.templateId&&!c.messages.some(m=>m.role==='user')):null;chat=reusable||{id:uid('chat'),messages:[]};if(!reusable)state.chats.push(chat);chat.templateId=id;chat.projectId=template.projectId;const count=state.chats.filter(c=>c.templateId===id).length;chat.title=template.title.slice(0,22)+' · 对话 '+count;chat.draft=''}
  state.activeChatId=chat.id;studioUI.assistantDraft=chat.draft||'';if($('#chat-input'))$('#chat-input').value=studioUI.assistantDraft;save();return chat;
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


function designedExportHTML(kind){
  const covers={
    paper:`<header class="edition-cover cover-letter"><img src="{{coverImage}}" alt="{{title}} 的封面" class="cover-art"><div class="cover-shade"></div><div class="cover-topline"><span>MIO / A VISUAL STORY</span><span>{{date}}</span></div><div class="cover-letter-title"><span class="edition-kicker">A LETTER IN FRAMES</span><h1>{{title}}</h1><p>{{synopsis}}</p><div class="cover-byline"><span>{{characterName}}</span><span>{{panelCount}} 个瞬间 · {{signature}}</span></div></div></header><div class="edition-opening"><span class="opening-number">01</span><div><span class="edition-kicker">THE STORY BEGINS</span><h2>让故事，慢慢展开。</h2><p>{{synopsis}}</p></div><span class="vertical-note">PRIVATE EDITION / {{signature}}</span></div>`,
    ink:`<header class="edition-cover cover-ink"><div class="ink-masthead"><span>COMFYCOMIC</span><span>漫画作品集 / VOL. 01</span></div><div class="ink-cover-grid"><div class="ink-copy"><span class="edition-kicker">A STORY IN {{panelCount}} SCENES</span><h1>{{title}}</h1><p>{{synopsis}}</p><div class="ink-seal">壱</div><span class="ink-author">STORY &amp; ART<br>{{signature}}</span></div><img src="{{coverImage}}" alt="{{title}} 的封面" class="ink-portrait"></div><div class="ink-bottom"><span>{{characterName}}</span><span>THE COLLECTED FRAMES</span><span>{{date}}</span></div></header><div class="edition-chapter"><span>第一章</span><div class="chapter-rule"></div><span>CHAPTER 01 / {{storyTitle}}</span></div>`,
    gallery:`<header class="edition-cover cover-gallery"><div class="gallery-top"><span>COMFYCOMIC<br>PRIVATE COLLECTION</span><span>{{signature}}<br>{{date}}</span></div><div class="gallery-title"><span class="edition-kicker">AN EXHIBITION IN FRAMES</span><h1>{{title}}</h1><p>{{synopsis}}</p></div><figure class="gallery-cover-art"><img src="{{coverImage}}" alt="{{title}} 的封面"><figcaption><span>PLATE 001</span><span>{{characterName}} / {{panelCount}} 幕</span></figcaption></figure><div class="gallery-opening"><span>CURATOR'S NOTE</span><p>每一个被留下的瞬间，<br>都是故事的一部分。</p></div></header>`,
    night:`<header class="edition-cover cover-night"><img src="{{coverImage}}" alt="{{title}} 的封面" class="cover-art"><div class="cover-shade"></div><div class="night-top"><span>COMFYCOMIC PICTURES</span><span>PRIVATE SCREENING</span></div><div class="night-copy"><span class="edition-kicker">A STORY BY {{signature}}</span><h1>{{title}}</h1><div class="night-rule"></div><p>{{synopsis}}</p><div class="night-credits"><span>STARRING<br><b>{{characterName}}</b></span><span>SCENES<br><b>{{panelCount}}</b></span><span>EDITION<br><b>{{date}}</b></span></div></div></header><div class="edition-chapter"><span>LIGHTS DOWN. STORY ON.</span><div class="chapter-rule"></div><span>使用左右键翻页</span></div>`
  };
  const frame=`<figure class="cc-frame plate" data-cc-frame><div class="plate-art"><img class="cc-image" src="{{image}}" alt="{{name}}"><span class="plate-index">{{number}}</span></div><figcaption class="cc-caption" data-cc-caption><span class="cc-scene">SCENE {{number}} / {{name}}</span><p>{{caption}}</p><pre class="cc-prompt" data-cc-prompt>{{prompt}}</pre><small class="cc-image-note">{{imageNote}}</small><div class="cc-palette"><i style="background:{{palette1}}"></i><i style="background:{{palette2}}"></i><i style="background:{{palette3}}"></i></div></figcaption></figure>`;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{collectionTitle}}</title>
<style>
:root{--accent:{{themeColor}};--paper:{{paperColor}};--ink:{{textColor}};--canvas:{{background}};--line:color-mix(in srgb,var(--ink) 19%,transparent)}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font-family:{{bodyFont}}}img{display:block;max-width:100%}p{line-height:2}h1,h2{font-weight:400}button{font:inherit}::selection{background:var(--accent);color:var(--paper)}
.cc-book{max-width:{{contentWidth}}px;margin:0 auto 100px}.edition-cover{position:relative;overflow:hidden}.edition-kicker{font:9px/1.8 monospace;letter-spacing:2.8px;display:block}.cover-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.cover-shade{position:absolute;inset:0;background:linear-gradient(180deg,#101a201a,#10202205 22%,#142525bb 72%,#101c25e8)}
.cover-letter{min-height:740px;min-height:min(920px,100svh);color:#fffbed;background:#334954}.cover-topline{position:relative;z-index:1;display:flex;justify-content:space-between;gap:20px;padding:35px 44px;font:9px/1.8 monospace;letter-spacing:1px}.cover-letter-title{position:absolute;left:7%;right:7%;bottom:7%}.cover-letter-title h1{font-size:clamp(36px,6.5vw,72px);line-height:1.3;letter-spacing:4px;max-width:630px;margin:18px 0}.cover-letter-title>p{font-size:13px;line-height:2;max-width:400px;opacity:.85}.cover-byline{border-top:1px solid #fff5;margin-top:35px;padding-top:17px;display:flex;justify-content:space-between;gap:15px;font-size:10px;letter-spacing:1px}.cover-byline span:last-child{opacity:.65}
.edition-opening{display:flex;align-items:flex-start;gap:33px;margin:60px 7% 70px;border-bottom:1px solid var(--line);padding-bottom:45px}.opening-number{font:70px/1 Georgia,serif;color:var(--accent);opacity:.5}.edition-opening h2{font-size:24px;letter-spacing:2px;margin:10px 0}.edition-opening p{font-size:12px;opacity:.65;max-width:380px}.vertical-note{writing-mode:vertical-rl;font:8px monospace;letter-spacing:2px;margin-left:auto;opacity:.45}
.cc-pages{display:grid;gap:{{panelGap}}px;padding:0 7%}.plate{margin:0;min-width:0;background:var(--paper);border:{{frameBorder}}px solid var(--accent);border-radius:{{imageRadius}}px;overflow:hidden}.plate-art{position:relative}.cc-image{width:100%;height:auto}.plate-index{position:absolute;bottom:17px;left:20px;font:10px monospace;letter-spacing:2px;color:#fff;mix-blend-mode:difference}.cc-caption{padding:26px 30px 31px;position:relative}.cc-scene{font:9px/1.8 monospace;letter-spacing:1.5px;color:var(--accent)}.cc-caption p{font-size:13px;margin:14px 0 0;line-height:2.1}.cc-prompt{font:9px/1.8 monospace;opacity:.55;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:18px}.cc-prompt:empty,.cc-image-note:empty{display:none}.cc-image-note{display:block;font:9px/1.8 sans-serif;opacity:.5;margin-top:14px}.cc-palette{display:none;gap:4px;margin-top:26px}.cc-palette i{width:22px;height:6px;display:block}
.edition-end{margin:70px 7% 0;padding-top:38px;border-top:1px solid var(--accent);text-align:center}.edition-end .end-marker{font:9px monospace;letter-spacing:4px;color:var(--accent)}.edition-end h2{font-size:28px;letter-spacing:3px;margin:20px 0 13px}.edition-end p{font-size:11px;opacity:.6}.edition-signature{font:italic 28px/1.6 Georgia,serif;margin-top:30px;color:var(--accent)}.edition-colophon{display:flex;justify-content:space-between;gap:12px;margin-top:40px;font:8px/1.8 monospace;opacity:.5;letter-spacing:1px}
.cover-ink{padding:35px;background:var(--paper);border-bottom:8px solid var(--ink)}.ink-masthead{display:flex;justify-content:space-between;align-items:baseline;border-top:5px solid var(--ink);border-bottom:1px solid var(--ink);padding:13px 0;margin-bottom:28px}.ink-masthead span:first-child{font:bold 28px/1 sans-serif;letter-spacing:-1px}.ink-masthead span:last-child{font:9px monospace;letter-spacing:1px}.ink-cover-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:24px;min-height:560px}.ink-copy{padding:22px 0;display:flex;flex-direction:column;align-items:flex-start}.ink-copy h1{font-size:clamp(33px,5.5vw,69px);line-height:1.25;letter-spacing:2px;font-weight:800;margin:30px 0 20px}.ink-copy p{font-size:12px;opacity:.65}.ink-seal{background:var(--accent);color:var(--paper);padding:9px 10px;font:28px serif;margin-top:28px;transform:rotate(-6deg)}.ink-author{margin-top:auto;padding-top:30px;font:10px/1.8 monospace;letter-spacing:2px}.ink-portrait{width:100%;height:100%;object-fit:cover;filter:grayscale(1);border:1px solid var(--ink)}.ink-bottom{display:flex;justify-content:space-between;gap:10px;font:8px monospace;border-top:1px solid var(--ink);padding-top:17px;margin-top:25px}.edition-chapter{display:flex;align-items:center;gap:15px;padding:35px 5%;font:9px monospace;color:var(--accent);letter-spacing:1px}.chapter-rule{height:1px;flex:1;background:var(--accent);opacity:.3}
.cover-gallery{padding:45px 8%;background:var(--paper)}.gallery-top{display:flex;justify-content:space-between;gap:30px;font:8px/1.9 monospace;letter-spacing:1.3px;opacity:.6;padding-bottom:27px;border-bottom:1px solid var(--line)}.gallery-top span:last-child{text-align:right}.gallery-title{padding:55px 0 35px}.gallery-title h1{font-size:clamp(34px,5.5vw,62px);letter-spacing:4px;line-height:1.35;margin:15px 0 22px}.gallery-title p{font-size:12px;opacity:.6;max-width:430px}.gallery-cover-art{margin:0}.gallery-cover-art img{width:100%;height:540px;object-fit:cover;object-position:center 36%}.gallery-cover-art figcaption{display:flex;justify-content:space-between;gap:16px;font:8px monospace;color:var(--accent);letter-spacing:1px;margin-top:12px}.gallery-opening{display:flex;justify-content:space-between;gap:30px;align-items:baseline;border-top:1px solid var(--line);padding-top:30px;margin-top:43px}.gallery-opening>span{font:8px monospace;letter-spacing:1.4px;color:var(--accent)}.gallery-opening p{font-size:15px;line-height:2.1;margin:0;letter-spacing:1.5px}
.cover-night{background:#14222e;min-height:750px;color:#efecdf}.cover-night .cover-art{filter:saturate(.8);object-position:center 35%}.cover-night .cover-shade{background:linear-gradient(180deg,#10172088,transparent 23%,#0a121aa8 54%,#091219 100%)}.night-top{position:relative;padding:37px 6%;display:flex;justify-content:space-between;font:9px monospace;letter-spacing:3px}.night-copy{position:absolute;bottom:8%;left:7%;right:7%;text-align:center}.night-copy h1{font-size:clamp(37px,6vw,76px);line-height:1.3;margin:22px 0;letter-spacing:6px}.night-copy>p{font-size:12px;max-width:510px;margin:22px auto;opacity:.7}.night-rule{height:1px;width:60px;background:#d5c392;margin:auto}.night-credits{display:flex;justify-content:center;gap:38px;margin-top:37px}.night-credits span{font:8px/2 monospace;letter-spacing:1px;opacity:.55}.night-credits b{font-weight:400;font-size:11px;color:#fff}
[data-layout=manga] .cc-pages,[data-layout=flip] .cc-pages{grid-template-columns:1fr 1fr;gap:{{panelGap}}px;padding:0 4%}[data-layout=manga] .cc-caption{padding:19px 21px}[data-layout=manga] .cc-caption p{font-size:12px}[data-layout=manga] .cc-frame{border-radius:0}[data-layout=artbook] .cc-pages{padding:50px 0 0}[data-layout=artbook] .cc-frame{display:grid;grid-template-columns:1.7fr 1fr;padding:50px 6%;gap:35px;border-radius:0}[data-layout=artbook] .cc-frame:nth-child(even){grid-template-columns:1fr 1.7fr}[data-layout=artbook] .cc-frame:nth-child(even) .plate-art{order:2}[data-layout=artbook] .cc-caption{padding:25px 0;align-self:center}[data-layout=artbook] .cc-caption p{font-size:12px}[data-layout=artbook] .cc-palette{display:flex}[data-layout=flip] .cc-pages{perspective:1800px}[data-layout=flip] .cc-frame{box-shadow:inset -12px 0 24px #0002}[data-layout=flip] .cc-image{height:62vh;object-fit:contain}[data-layout=flip] .cc-caption{min-height:140px;padding:20px 25px}[data-layout=flip] .cc-caption p{font-size:11px}
.cc-blank{min-height:540px;display:grid!important;place-items:center;color:var(--accent);background:var(--paper);font:9px Georgia,serif;letter-spacing:3px}.cc-controls{display:flex;justify-content:center;align-items:center;gap:22px;margin:28px 0;font:10px monospace;color:var(--accent)}.cc-controls button{background:transparent;border:1px solid var(--accent);color:var(--accent);padding:12px 17px;cursor:pointer}.cc-controls button:hover{background:var(--accent);color:var(--paper)}.cc-controls button:disabled{opacity:.25;cursor:default}.cc-turn{transform-origin:left;animation:page-turn .65s ease-out}[hidden]{display:none!important}@keyframes page-turn{from{transform:rotateY(-140deg);filter:brightness(.5)}to{transform:rotateY(0);filter:brightness(1)}}
@media(max-width:640px){.cover-letter{min-height:620px}.cover-topline{padding:25px 6%;font-size:7px}.cover-letter-title h1{letter-spacing:2px}.cover-byline{font-size:9px;line-height:1.8}.edition-opening{gap:19px;margin:40px 6%;padding-bottom:25px}.opening-number{font-size:47px}.edition-opening h2{font-size:20px}.cc-pages{padding:0 5%}.cc-caption{padding:22px}.cover-ink{padding:19px}.ink-masthead span:first-child{font-size:19px}.ink-masthead span:last-child{font-size:7px}.ink-cover-grid{gap:17px;min-height:450px}.ink-copy h1{font-size:36px}.ink-copy p{font-size:10px}.ink-seal{font-size:20px}.ink-bottom{font-size:7px}.gallery-cover-art img{height:430px}.cover-gallery{padding:28px 7%}.gallery-title{padding:35px 0 24px}.gallery-opening{gap:15px}.gallery-opening p{font-size:12px}.cover-night{min-height:630px}.night-top{font-size:7px;letter-spacing:1px}.night-copy h1{letter-spacing:3px}.night-credits{gap:20px}.edition-chapter{font-size:8px}[data-layout=artbook] .cc-frame,[data-layout=artbook] .cc-frame:nth-child(even){grid-template-columns:1fr;padding:30px 7%;gap:8px}[data-layout=artbook] .cc-frame:nth-child(even) .plate-art{order:0}[data-layout=manga] .cc-caption,[data-layout=flip] .cc-caption{padding:13px}[data-layout=manga] .cc-caption p,[data-layout=flip] .cc-caption p{font-size:10px}.cc-scene{font-size:7px}.cc-blank{min-height:360px}}
@media print{body{background:white;color:#222}.cc-book{max-width:none;margin:0}.edition-cover{break-after:page}.cc-frame{break-inside:avoid}.cc-controls{display:none}.cc-frame[hidden]{display:block!important}.edition-end{break-before:page}.cover-letter,.cover-night{height:260mm;min-height:0;print-color-adjust:exact}.plate-art{print-color-adjust:exact}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto!important}}
</style></head><body>{{#books}}<article class="cc-book" data-cc-book>${covers[kind]||covers.paper}<main class="cc-pages" data-cc-pages>{{#frames}}${frame}{{/frames}}</main><footer class="edition-end"><span class="end-marker">FIN / THE STORY CONTINUES</span><h2>故事，未完待续。</h2><p>珍藏每一帧，也珍藏这一刻的自己。</p><div class="edition-signature">{{signature}}</div><div class="edition-colophon"><span>{{title}}</span><span>MIO / PRIVATE EDITION</span></div></footer></article>{{/books}}</body></html>`;
}


function designedTemplates(){return[
  {...makeExportTemplate('export-paper','海风来信 · 电影长卷','webtoon',{accent:'#55756e',background:'#eae7df',paper:'#fffcf4',text:'#293e38',width:860,gap:32,radius:0},'整幅封面、开篇题记与温柔的纸张留白，让每个画面像一封长信。'),html:designedExportHTML('paper'),version:'2.0.0',designRevision:2},
  {...makeExportTemplate('export-ink','墨与叙事 · 漫画精装','manga',{accent:'#9b453c',background:'#e4e2d9',paper:'#fffdf6',text:'#262624',width:1200,gap:8,radius:0,font:'sans'},'复古漫画刊物封面、朱红卷号与经典对开排版，完整保留分镜节奏。'),html:designedExportHTML('ink'),version:'2.0.0',designRevision:2},
  {...makeExportTemplate('export-gallery','白昼美术馆 · 典藏展册','artbook',{accent:'#786b4e',background:'#eae7de',paper:'#fcfaf4',text:'#3a3931',width:1100,gap:30,radius:0},'美术馆式标题页、交错展台、作品说明与色卡，为每一幅画留出呼吸。'),html:designedExportHTML('gallery'),version:'2.0.0',designRevision:2},
  {...makeExportTemplate('export-flip','深夜放映室 · 交互画册','flip',{accent:'#c9b98d',background:'#10191f',paper:'#ece7d9',text:'#333b38',width:1220,gap:3,radius:0,font:'serif'},'电影海报封面、演职署名、暖纸双页与纸张翻动，像一场私人放映。'),html:designedExportHTML('night'),version:'2.0.0',designRevision:2}
]}


function upgradeExportDesigns(s){
  if(!Array.isArray(s.exportTemplates))return;
  if(s.exportTemplates.some(t=>t.builtin&&['export-paper','export-ink','export-gallery','export-flip'].includes(t.id)&&t.designRevision!==2)){
    const replacements=designedTemplates();s.exportTemplates=s.exportTemplates.map(t=>{const replacement=replacements.find(x=>x.id===t.id);return replacement&&t.builtin&&t.designRevision!==2?{...replacement,createdAt:t.createdAt}:t});
  }
}


function checkedPath(path){if(typeof path!=='string'||path.length>2500)throw Error('磁盘文件路径不合法。');const parts=path.split('/');if(!parts.length||parts.some(x=>!x||x==='.'||x==='..'||/[\\\u0000-\u001f]/.test(x)))throw Error('拒绝越界文件路径：'+path);return parts}


function parentPath(path){return checkedPath(path).slice(0,-1).join('/')}


async function dirAt(root,path,create=false){let dir=root;if(!path)return dir;for(const part of checkedPath(path))dir=await dir.getDirectoryHandle(part,{create});return dir}


async function fileAt(root,path,create=false){const parts=checkedPath(path),name=parts.pop(),dir=await dirAt(root,parts.join('/'),create);return dir.getFileHandle(name,{create})}


function imageExtension(type){return({'image/png':'png','image/jpeg':'jpg','image/jpg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'})[String(type).split(';')[0].trim().toLowerCase()]||'png'}


function renderDiskStatus(){
  const root=disk.root?.name||disk.remembered?.name||'选择保存目录';
  $('#statusbar').innerHTML=`<i class="dot ${disk.busy?'live':rt.saved&&disk.root?'':'amber'}"></i><button class="disk-status-action" data-act="storage-settings" data-tip="${esc(disk.lastError||'工程主存储是你授权的真实文件夹。点击管理保存位置与目录权限。')}">${esc(diskStatusText())}</button><span style="opacity:.5;margin-left:9px">${disk.root?'LOCAL FILESYSTEM':'MEMORY ONLY'}</span><div class="spacer"></div><button class="disk-status-action" data-act="storage-settings">${icon('folder','sm')}${esc(root)}</button><span style="margin:0 8px;opacity:.45">|</span><span>Mio v${MIO_VERSION}</span>`;
}


function storageSettingsHTML(){
  const supported=diskSupported(),connected=!!disk.root;
  return `<section class="settings-section"><h2>普通文件，真正属于你</h2><p>作品使用本地文件保存。每个企划、每本画册都有自己的文件夹，图片单独保存。</p><div class="disk-info"><div class="disk-info-header">${icon('folder')}<div class="grow"><h3>${esc(connected?disk.root.name:disk.remembered?'待连接：'+disk.remembered.name:'尚未选择工作室根目录')}</h3><p id="disk-settings-status">${esc(diskStatusText())}</p></div><span class="chip ${connected?'green':''}">${connected?'磁盘目录':'临时会话'}</span></div><div class="row wrap">${btn(connected?'切换工作室目录':'选择本地根目录','folder','disk-connect','','primary')}${disk.remembered&&!connected||disk.phase==='permission'?btn('重新授权','refresh','disk-reconnect'):''}${btn('立即保存','disk','disk-save',connected&&!disk.busy?'':'disabled')}${connected?btn('重新读取磁盘','refresh','disk-reload',disk.busy?'disabled':''):''}</div><div class="disk-progress-caption" id="disk-save-progress">${esc(disk.progress||'只在所选目录范围内读写；不会访问其他文件夹。')}</div>${disk.lastError?`<div class="disk-warning">${esc(disk.lastError)}</div>`:''}${disk.phase==='recovery'?`<div class="disk-warning">当前索引未完整读取，已从 workspace.previous.json 恢复上一次完整记录。请检查画册后确认恢复，再继续保存。${btn('确认恢复并继续保存','check','disk-accept-recovery','style="margin-top:12px"','small')}</div>`:''}</div>${!supported?'<div class="disk-warning">当前浏览器或嵌入页面未开放本地目录写入。请在桌面 Chrome / Edge 的 HTTPS 或 localhost 页面直接打开；当前仍可下载 ZIP 目录包、只读载入已解压目录。</div>':''}<div class="settings-note">${icon('shield')}<span>浏览器仅记住目录授权、工作室名称和主题偏好。图片、剧情、模板与队列保存为磁盘文件。浏览器缓存工程只用于迁移，不再自动写回缓存。</span></div></section><section class="settings-section"><h2>清晰的目录层级</h2><p>名称便于辨认，短 ID 避免同名冲突。重命名只改变显示名称，已建立的目录路径保持稳定。</p><pre class="folder-tree">${esc(disk.root?.name||workspaceName())}/
  workspace.json <span class="muted">工作室入口，最后提交</span>
  workspace.previous.json <span class="muted">上次完整索引</span>
  企划/
    ${esc(safeFolderName(project().title,'project'))}/
      project.json
      画册/
        画册名称__ID/
          book.json <span class="muted">台词、参数与图片路径</span>
          图片/ <span class="muted">001_分镜名_内容指纹.png</span>
          导出/ <span class="muted">离线 HTML 画册</span>
      分镜模板/模板名称__ID/template.json
      角色/角色名称__ID/
        character.json
        参考立绘/
        剧情/模板ID/
  导出模板/模板名称__ID/
    template.json
    layout.html
  引擎/workflow.json
  对话记录/对话名称__ID/session.json
  工作室/settings.json
  .history/ <span class="muted">完整索引和版本记录</span></pre></section><section class="settings-section"><h2>安全与备份</h2>${settingsRow('把 API 密钥也写入本地目录','适用于 LLM 等服务设置。开启后 settings.json 可能含明文密钥；图像渠道密钥由独立本地文件管理，不受此开关控制。',`<label class="switch"><input role="switch" type="checkbox" data-disk-key="includeKeys" ${state.settings.disk.includeKeys?'checked':''} aria-label="将 API 密钥写入磁盘"><span class="switch-track"></span></label>`,'shield')}<div class="row wrap" style="padding:20px 0">${btn('下载完整目录 ZIP','download','disk-archive')}${btn('载入已解压目录','upload','disk-import-folder')}${btn('下载工程 JSON','disk','backup-export')}</div><p class="help">ZIP 保留相同目录层级，可解压后用“选择本地根目录”继续创作。浏览器不支持写入时，只读载入不会冒充自动保存。</p></section>`;
}


function updateDiskSettingsStatus(){const s=$('#disk-settings-status');if(s)s.textContent=diskStatusText();const p=$('#disk-save-progress');if(p)p.textContent=disk.progress||'文件写入完成后，工作室索引才会更新。';$$('[data-act="disk-save"],[data-act="disk-reload"]').forEach(e=>e.disabled=!disk.root||disk.busy||disk.connecting);$$('[data-act="disk-clear-legacy"]').forEach(e=>e.disabled=!disk.root||!rt.saved||disk.busy)}


function activeJobs(){return rt.running||rt.llmBusy||rt.chatBusy||rt.redraw.size>0||studioUI.exportBusy||disk.packBusy}


async function downloadDirectoryArchive(){
  if(disk.packBusy)throw Error('目录包正在准备中。');flushEditor();saveStoryInputs();disk.packBusy=true;
  try{toast('正在整理企划、画册与图片目录...');const snapshot=clone(state);snapshot.settings.disk.includeKeys=false;const pack=await buildDiskPackage(snapshot,(message)=>{disk.progress=message;updateDiskSettingsStatus()});const entries=new Map([...pack.directories.map(path=>[path+'/',new Blob([])]),...pack.files]);let missing=0;
    for(const b of snapshot.books)for(const item of b.exports||[]){try{checkedPath(item.path);if(!item.path.startsWith((disk.paths.books[b.id]||'INVALID')+'/导出/'))throw Error('导出路径不属于当前画册');const file=disk.root?await readDiskFile(disk.root,item.path):disk.importedFiles?.get(item.path);if(!file)throw Error('成品文件不可用');entries.set(item.path,file)}catch(e){missing++}}
    if(missing)entries.set('导出成品说明.txt',new Blob(['有 '+missing+' 个历史导出成品不在当前可访问目录内，未包含在本 ZIP。\n原始图片、剧情和模板仍完整包含，可在应用中重新导出 HTML 画册。'],{type:'text/plain'}));
    const archive=await zipDirectory(entries);download(safeFolderName(workspaceName())+'_工作室目录.zip',archive);toast(missing?'目录 ZIP 已下载；'+missing+' 个不可访问的旧导出成品未包含，详见包内说明。':'目录 ZIP 已下载。解压后可作为工作室根目录重新打开。')}
  finally{disk.packBusy=false;disk.progress='';renderStatus();updateDiskSettingsStatus()}
}


async function deliverExportHTML(html,t,books){
  const filename=safeFolderName(books.length===1?books[0].title:'画册合集')+'_'+safeFolderName(t.title)+'_'+Date.now()+'.html';
  if(!disk.root||disk.phase!=='connected'){download(filename,html,'text/html');return null}
  const saved=await flushDiskSave();if(!saved){download(filename,html,'text/html');toast('目录未能保存，已改为下载 HTML，避免丢失导出结果。','error');return null}
  const base=books.length===1?disk.paths.books[books[0].id]+'/导出':'导出合集',path=base+'/'+filename;
  try{await writeDiskFile(disk.root,path,html);if(books.length===1){const b=bookBy(books[0].id);b.exports||=[];b.exports.push({path,createdAt:Date.now(),templateId:t.id,format:t.layout});save()}return path}
  catch(e){download(filename,html,'text/html');toast('写入导出目录失败，已改为下载文件：'+e.message,'error');return null}
}


function openFileSettings(){studioUI.settingsTab='storage';if($('#modal').open)closeModal();if($('#reader').open)closeReader();navigate(5)}


function fileBackupHub(){modal('工作室文件与备份',`<div class="disk-info-header">${icon('folder')}<div class="grow"><h3>${esc(workspaceName())}</h3><p>${esc(diskStatusText())}</p></div></div><div class="notice">主存储是你授权的本地文件夹。完整目录保留「企划 / 画册 / 图片」层级；JSON 是便携恢复文件，HTML 是用于阅读的成品画册。</div><div class="divider"></div><div class="stack">${btn(disk.root?'管理当前保存目录':'选择本地工作室目录','folder',disk.root?'storage-settings':'disk-connect','','primary')}${btn('下载完整目录 ZIP','download','disk-archive')}${btn('下载全量工程 JSON','disk','backup-export')}${btn('从 JSON 恢复工程','upload','import-project')}${btn('载入已解压目录（只读）','upload','disk-import-folder')}</div><label class="row small soft" style="margin-top:17px"><input type="checkbox" id="backup-secrets">仅本次 JSON 备份包含其他服务密钥（敏感，不含图像密钥库）</label><div class="help">ZIP 目录包不含 API 密钥。磁盘保存是否包含密钥可在“文件与保存”中独立配置。</div><div class="modal-footer">${btn('高级：自有远端同步','','advanced-sync','','ghost small')}${btn('关闭','','close-modal','','small')}</div>`,'不依赖浏览器缓存保管你的作品。')}


function bookDiskPathModal(id){const b=bookBy(id),path=disk.paths.books[id];if(!path||!disk.root){toast('此画册尚未写入目录，请先连接根目录并保存。');return}modal('画册文件位置',`<p class="soft small">${esc(b.title)}</p><div class="disk-path">${esc(disk.root.name)} / ${esc(path)} / 图片</div><p class="help">目录选择器不会向网页提供绝对磁盘路径。你可以在系统文件管理器中打开授权的根目录，再按此相对路径查找。</p><div class="modal-footer">${btn('复制相对路径','copy','copy-disk-path',`data-id="${id}"`,'primary')}</div>`)}


async function clearLegacyCache(){
  if(!disk.root||!rt.saved)throw Error('请先将当前工程完整写入磁盘。');
  if(disk.legacy?.books.some(b=>!state.books.some(x=>x.id===b.id)))throw Error('当前磁盘工程未包含所有缓存画册。为避免误删，请先备份工程。');
  if(!await confirmAction('清理浏览器缓存工程缓存？','只移除IndexedDB/localStorage 中的工程副本。目录授权与磁盘原文件会保留。','清理缓存'))return;
  try{localStorage.removeItem('cc-project');sessionStorage.removeItem('cc-template-draft')}catch(e){}
  if(rt.db)await new Promise((resolve,reject)=>{const tx=rt.db.transaction('snapshots','readwrite');tx.objectStore('snapshots').delete('current');tx.objectStore('snapshots').delete('previous');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
  disk.legacy=null;render();toast('浏览器缓存工程缓存已清理，磁盘文件不受影响。');
}



function cssDecode(value){return value.replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\n\r\f])/gi,(_,hex,char)=>hex?String.fromCodePoint(Math.min(parseInt(hex,16)||65533,0x10ffff)):char)}


function validateOfflineCSS(css){
  const fail=(message,position)=>{throw Error('CSS 第 '+(css.slice(0,position).split('\n').length)+' 行：'+message)};
  const trivia=start=>{let p=start;while(p<css.length){if(/\s/.test(css[p])){p++;continue}if(css.slice(p,p+2)==='/*'){const end=css.indexOf('*/',p+2);if(end<0)fail('注释未闭合。',p);p=end+2;continue}break}return p};
  const identifier=start=>{let p=start,value='';while(p<css.length){if(/[a-zA-Z0-9_-]/.test(css[p])){value+=css[p++];continue}if(css[p]==='\\'){const match=css.slice(p).match(/^\\(?:[0-9a-f]{1,6}(?:\r\n|[\t\n\r\f ])?|[^\n\r\f])/i);if(!match)fail('无效的 CSS 转义。',p);value+=cssDecode(match[0]);p+=match[0].length;continue}break}return {value:value.toLowerCase(),end:p}};
  const quoted=start=>{const quote=css[start];let p=start+1,value='';while(p<css.length){if(css[p]===quote)return {value:cssDecode(value),end:p+1};if(css[p]==='\\'&&p+1<css.length){value+=css[p]+css[p+1];p+=2}else value+=css[p++]}fail('字符串未闭合。',start)};
  const allowedURL=value=>/^#[a-zA-Z0-9_-]+$/.test(value)||['{{image}}','{{coverImage}}'].includes(value)||/^data:(?:image\/(?:png|jpeg|gif|webp|svg\+xml)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-ttf));base64,[a-zA-Z0-9+/=\s]+$/i.test(value);
  let i=0;
  while(i<css.length){i=trivia(i);if(i>=css.length)break;
    if(css[i]==='"'||css[i]==="'"){i=quoted(i).end;continue}
    if(css[i]==='@'){const at=identifier(i+1);if(['import','namespace','document','-moz-document'].includes(at.value))fail('@'+at.value+' 不适用于离线模板。请将所需样式直接写入文档。',i);i=Math.max(i+1,at.end);continue}
    if(/[a-zA-Z_\\-]/.test(css[i])){
      const token=identifier(i),next=trivia(token.end);
      if(['behavior','-moz-binding'].includes(token.value)&&css[next]===':')fail('禁止执行型 CSS 属性 '+token.value+'。scroll-behavior 不受此限制。',i);
      if(css[next]==='('&&token.value==='expression')fail('禁止 expression() 执行表达式。',i);
      if(css[next]==='('&&['image-set','-webkit-image-set'].includes(token.value))fail('请用内联 img 或 url(data:...) 替代 image-set()，避免隐式外部资源。',i);
      if(token.value==='url'&&css[next]==='('){
        let p=trivia(next+1),value='';
        if(css[p]==='"'||css[p]==="'"){const q=quoted(p);value=q.value;p=trivia(q.end);if(css[p]!==')')fail('url() 缺少闭合括号。',i)}
        else{let raw='';while(p<css.length&&css[p]!==')'){if(css[p]==='\\'&&p+1<css.length){raw+=css[p]+css[p+1];p+=2}else raw+=css[p++]}if(css[p]!==')')fail('url() 缺少闭合括号。',i);value=cssDecode(raw.trim())}
        if(!allowedURL(value))fail('资源 '+value.slice(0,75)+' 不是可离线读取的内联数据。请使用 Base64 Data URL、页内 #id 或图片变量。',i);
        i=p+1;continue;
      }
      i=Math.max(i+1,token.end);continue;
    }
    i++;
  }
  return true;
}


function templateValidationHub(){
  const results=state.exportTemplates.map(t=>{try{validateExportTemplate(t);compileTemplateDocument(t,exportPreviewBooks());return {t,ok:true,message:'结构、CSS 与示例编译通过'}}catch(e){return {t,ok:false,message:e.message}}});
  modal('模板检查与修复',`<div class="notice">已修复对 scroll-behavior 的误拦截。注释、字符串里的 @import / url 文本不再被当作实际资源指令；真正的外部依赖仍会明确指出位置。</div><div class="template-check-list">${results.map(({t,ok,message})=>`<div class="template-check-row"><span class="${ok?'accent':'danger'}">${icon(ok?'check':'help')}</span><div class="grow">${esc(t.title)}<small>${esc(message)}</small></div>${btn('编辑','edit','template-fix-open',`data-id="${t.id}"`,'small')}</div>`).join('')}</div><div class="modal-footer">${btn('恢复内置模板原版','refresh','template-reset-builtins')}${btn('关闭','','close-modal','','primary')}</div>`,'检查不会改动任何自定义模板。',true);
}


function composerBounds(panelHeight,headHeight,contextHeight){const max=Math.max(126,Math.floor(panelHeight-headHeight-contextHeight-48-4));return {min:Math.min(155,max),max:Math.min(430,max)}}


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
  const help=[...compose.children].find(e=>e.classList.contains('help'));if(help){help.classList.add('composer-help');help.textContent='Enter 发送 · Shift + Enter 换行'}
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


function criticConfig(){const c=state.settings.critic;return {...c,...(c.connection==='shared'?{baseUrl:state.settings.llm.baseUrl,model:state.settings.llm.model,key:state.settings.llm.key}:{})};}


function criticConfigSignature(c=criticConfig()){return hash([c.mode,c.connection,c.baseUrl,c.model,hash(c.key||'')].join('|')).toString(16)}


function criticReadyLabel(){const c=criticConfig();if(c.mode==='mock')return '离线演示 · 不是真实诊断';if(!c.model||!c.baseUrl||(!c.key&&!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(c.baseUrl)))return '真实模式 · 尚未填写完整 API';return state.settings.critic.verification?.signature===criticConfigSignature(c)?'真实视觉 API · 带图测试已通过':'真实视觉 API · 尚未进行带图测试'}


function safeServiceError(error){let text=error?.message||String(error);for(const secret of [state.settings.critic?.key,state.settings.llm.key,releaseUI.githubToken])if(secret)text=text.split(secret).join('[REDACTED]');if(error?.name==='AbortError')return '请求已停止或超时。已生成画面不受影响。';if(text.includes('401'))return 'API 拒绝认证（401）。请检查密钥、服务商和 Base URL 是否匹配。';if(text.includes('403'))return '服务拒绝访问（403）。请检查 API 权限、余额或账号限制。';if(text.includes('404'))return '端点或模型不存在（404）。检查 Base URL 是否包含正确的 /v1 前缀，以及模型名称。';if(text.includes('429'))return '请求频率或额度超限（429）。请稍后重试，检查模型配额。';if(/Failed to fetch|NetworkError|Load failed/i.test(text))return '浏览器无法访问服务：检查网络、HTTPS 与 CORS。不要将 API 密钥放进不可信代理。';return text.slice(0,700)}


async function visionRequest(messages,cfg,signal){
  if(cfg.mode!=='real')throw Error('此操作需要真实视觉 API。请先切换运行模式。');
  const endpoint=normalizedChatEndpoint(cfg.baseUrl);if(!cfg.model?.trim())throw Error('请输入支持图片输入的模型名称。');
  if(!cfg.key&&!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(endpoint))throw Error('真实审校缺少 API Key。请先在“视觉审校 API”中填写，系统不会自动伪造审校结果。');
  const headers={'Content-Type':'application/json'};if(cfg.key)headers.Authorization='Bearer '+cfg.key;
  try{const response=await request(endpoint,{method:'POST',headers,signal,body:JSON.stringify({model:cfg.model.trim(),messages,max_tokens:1800})},clamp(Number(cfg.timeout)||60,15,180)*1000);const data=await response.json(),message=data.choices?.[0]?.message;if(typeof message?.content!=='string'||!message.content.trim())throw Error('接口没有返回文本审校结果，请确认使用 OpenAI Chat Completions 兼容协议。');return message.content}
  catch(e){if(signal?.aborted)throw e;throw Error(safeServiceError(e))}
}


function criticSettingsSummary(){const c=criticConfig();return `<section class="settings-section"><h2>可真正看图的视觉审校</h2><p>审校使用独立的视觉模型连接，不依赖“LLM 剧情策划台”是否显示。需要支持图片输入的 OpenAI 兼容模型。</p><div class="service-context"><strong>${esc(criticReadyLabel())}</strong><br>${esc(c.baseUrl)}<br>模型：${esc(c.model)} · ${c.connection==='shared'?'复用剧情连接参数':'独立 API 配置'}</div><div class="row wrap" style="margin:19px 0">${btn('填写 API / 配置模型','settings','critic-settings','','primary')}${btn('带图连通性测试','image','critic-test-open')}${btn('阅读审校教程','help','guide-open','data-step="4"')}</div><div class="settings-note">${icon('shield')}<span>真实审校将当前画面、可选角色立绘与前序分镜发送到你配置的服务。图像会转为白底 JPEG，最长边不超过 1280px。无法读取原图时会报错，不会换一张图冒充审校。</span></div>${settingsRow('批量生成后自动审校','连续 3 次服务失败自动熔断。不会删除已生成的画面。',`<label class="switch"><input role="switch" type="checkbox" data-setting="autoCritique" ${state.settings.autoCritique?'checked':''} ${featureEnabled('visualCritic')?'':'disabled'} aria-label="生成后自动视觉审校"><span class="switch-track"></span></label>`,'shield')}<p class="help">${featureEnabled('visualCritic')?'审校模块已启用。':'审校模块已停用，可在“模块管理”中重新启用。'}</p></section><section class="settings-section"><h2>从报告到修改</h2><p>每条诊断区分问题区域与修改建议。点击“填入重绘框”追加建议，确认后再重绘。图片已改变时，旧异步报告会自动丢弃。</p>${btn('清除失败熔断计数','refresh','critic-reset','','small')}<span class="tiny muted" style="margin-left:10px">当前连续失败 ${rt.criticFailures} / 3</span></section>`;}


function openCriticSettings(){
  const c=state.settings.critic;releaseUI.criticDraft=c;
  $('#critic-dialog').innerHTML=`<header class="modal-head">${icon('shield')}<div class="grow"><h2 id="critic-title">视觉审校 API</h2><p>连接能理解图片的模型，获得可执行的诊断与重绘建议。</p></div>${ibtn('close','critic-close','关闭审校配置')}</header><div class="service-body"><div class="grid2">${field('运行模式',`<select data-critic-field="mode" aria-label="审校运行模式">${opt('mock','离线演示：不调用 API',c.mode)}${opt('real','真实视觉 API',c.mode)}</select>`)}${field('连接来源',`<select data-critic-field="connection" aria-label="审校连接来源">${opt('independent','独立配置（推荐）',c.connection)}${opt('shared','复用 LLM 的地址、模型与密钥',c.connection)}</select>`)}</div>${c.connection==='independent'?`${field('服务商预设',`<select id="critic-provider" aria-label="视觉服务商">${[['openai','OpenAI'],['ollama','Ollama 本地视觉模型'],['custom','自定义 OpenAI 兼容视觉接口']].map(x=>opt(...x,c.provider)).join('')}</select>`)}${field('Base URL',input('baseUrl',c.baseUrl,'url','data-critic-field="baseUrl" placeholder="https://api.openai.com/v1" autocomplete="off"'),'系统会调用 /chat/completions，不是图像生成接口。')}${field('API Key',`<div class="service-key">${input('key',c.key,'password','data-critic-field="key" autocomplete="off" spellcheck="false" aria-label="视觉审校 API Key"')}${ibtn('eye','critic-key-toggle','显示或隐藏 API Key')}</div>`,'密钥仅在本次会话使用；是否写入磁盘由“文件与保存 → API 密钥”控制。')}${field('视觉模型名称',input('model',c.model,'text','data-critic-field="model" placeholder="例如 gpt-4o 或本地视觉模型"'),'纯文本模型不能进行图像审校。请使用你的服务商实际支持的视觉模型。')}`:`<div class="service-context"><strong>复用的连接参数</strong><br>${esc(state.settings.llm.baseUrl)}<br>${esc(state.settings.llm.model)}<br>${state.settings.llm.key?'已配置密钥':'未配置密钥'}</div><p class="service-note">只复用连接参数。审校模式仍由上方选择；纯文本剧情模型不能自动获得视觉能力。</p>${btn('修改共享连接','settings','critic-shared-settings','','small')}`}<hr class="service-divider"><div class="grid2">${field('单次超时 / 秒',input('timeout',c.timeout,'number','data-critic-field="timeout" min="15" max="180"'))}${field('报告通过标准','<div class="service-context" style="padding:7px 12px">7 / 10 分及以上</div>')}</div><div class="row wrap" style="margin-bottom:15px"><label class="row small soft"><input type="checkbox" data-critic-field="includeReference" ${c.includeReference?'checked':''}>附带角色参考立绘</label><label class="row small soft"><input type="checkbox" data-critic-field="includePrevious" ${c.includePrevious?'checked':''}>附带前一幕画面</label></div>${field('审校重点',`<textarea data-critic-field="focus" style="min-height:65px" aria-label="视觉审校重点">${esc(c.focus)}</textarea>`)}<div class="service-note">带图测试会向已配置的视觉服务发送一张本地几何测试图，可能产生少量 API 费用。真实审校失败时会显示原因，不会静默回退为模拟评分。</div><div id="critic-test-result" class="service-test-result"><span class="service-status">${esc(criticReadyLabel())}</span></div></div><footer class="service-footer"><span class="grow service-status">${disk.root?'配置更改将自动落盘；密钥遵循保存开关。':'当前为临时会话，记得连接目录保存设置。'}</span>${releaseUI.criticTesting?btn('停止测试','stop','critic-test-stop'):btn('带图测试连接','image','critic-test','','primary')}${btn('保存并关闭','check','critic-close')}</footer>`;
  if(!$('#critic-dialog').open)$('#critic-dialog').showModal();
}


function visionProbeImage(){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,256,128);ctx.fillStyle='#238b45';ctx.beginPath();ctx.arc(66,64,29,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d84a42';ctx.fillRect(161,36,56,56);return canvas.toDataURL('image/jpeg',.85)}


async function testCriticConnection(){
  if(releaseUI.criticTesting)return;const c=criticConfig();if(c.mode!=='real')throw Error('请先切换为“真实视觉 API”并填写连接参数。');normalizedChatEndpoint(c.baseUrl);
  releaseUI.criticTesting=true;releaseUI.criticController=new AbortController();const signature=criticConfigSignature(c),image=visionProbeImage();
  const area=$('#critic-test-result');if(area)area.innerHTML=`<div class="row">${imgTag(image,'本地几何图形测试','class="critic-sample-image"')}<span class="service-status"><i class="dot live"></i> 正在发送图片并验证视觉响应...</span></div>`;
  const button=$('[data-act="critic-test"]');if(button){button.dataset.act='critic-test-stop';button.innerHTML=icon('stop')+'停止测试'}
  try{const answer=await visionRequest([{role:'system',content:'Identify the geometric shape on the left and on the right in the provided image. Reply only with a JSON object with keys left and right. Use single lowercase English shape names.'},{role:'user',content:[{type:'text',text:'Identify the two shapes in this image.'},{type:'image_url',image_url:{url:image}}]}],c,releaseUI.criticController.signal);const result=parseJson(answer);if(String(result.left).toLowerCase()!=='circle'||String(result.right).toLowerCase()!=='square')throw Error('接口返回了内容，但没有正确识别测试图的左右形状。请确认模型支持图像输入。');if(signature!==criticConfigSignature())throw Error('测试期间配置已变化，请用当前参数重新测试。');state.settings.critic.verification={signature,at:Date.now(),model:c.model};releaseUI.criticTest={ok:true,time:Date.now()};save();if(area?.isConnected)area.innerHTML=`<div class="row">${imgTag(image,'验证成功的几何测试图','class="critic-sample-image"')}<span class="service-status success">带图测试通过：正确识别左侧圆形与右侧正方形。<br>${esc(c.model)} · ${new Date().toLocaleTimeString()}</span></div>`;toast('视觉 API 带图测试已通过。')}
  catch(e){const message=safeServiceError(e);releaseUI.criticTest={ok:false,message};if(area?.isConnected)area.innerHTML=`<p class="service-status error">${esc(message)}</p>`;throw Error(message)}
  finally{releaseUI.criticTesting=false;releaseUI.criticController=null;if(button?.isConnected){button.dataset.act='critic-test';button.innerHTML=icon('image')+'带图测试连接'}}
}


function criticReportHTML(c,i){
  if(!c)return `<div class="help">尚无审校报告。${btn('填写审校 API','settings','critic-settings','','small ghost')}</div>`;
  const real=c.engine==='real';const issues=c.issues?.length?c.issues:[{area:'整体建议',severity:'medium',observation:c.suggestions,fixPrompt:c.suggestions}];
  return `<div class="score-block"><div class="row"><div class="score-ring" style="--score:${c.score}"><span>${c.score.toFixed(1)}</span></div><div class="grow"><strong>${c.score>=9?'S':c.score>=8?'A':c.score>=7?'B':'C'} · ${c.passed?'审校通过':'建议精修'}</strong><div class="tiny muted">${real?'真实视觉报告':'离线演示 / 历史示例'}</div></div></div><p>${esc(c.summary)}</p>${real?`<div class="help">模型 ${esc(c.model||'未知')} · ${c.createdAt?new Date(c.createdAt).toLocaleString('zh-CN'):''}</div>`:'<p class="help">此报告不代表真实模型观察。请配置视觉 API 后重新审校。</p>'}<details><summary>结构与一致性诊断</summary><p><b>解剖：</b>${esc(c.anatomy)}</p><p><b>一致性：</b>${esc(c.consistency)}</p></details>${issues.map((issue,n)=>`<div class="critic-issue"><span class="critic-issue-label">${esc(issue.area)} · ${({high:'优先修改',medium:'建议调整',low:'可选优化'})[issue.severity]||'建议'}</span><p>${esc(issue.observation||'无需额外调整')}</p>${issue.fixPrompt?btn('将此建议填入重绘框','plus','critic-apply-issue',`data-index="${i}" data-issue="${n}"`,'small ghost'):''}</div>`).join('')}<div class="critic-actions">${btn('复制报告','copy','critic-copy-report',`data-index="${i}"`,'small')}${btn('API 设置','settings','critic-settings','','small')}</div></div>`;
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


function utf8Base64(text){const bytes=new TextEncoder().encode(text);let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result)}


function base64UTF8(text){return new TextDecoder().decode(Uint8Array.from(atob(String(text).replace(/\s+/g,'')),c=>c.charCodeAt(0)))}


function githubRepoParts(value){let text=String(value||'').trim().replace(/\/$/,'');if(/^https:\/\/github\.com\//i.test(text))text=new URL(text).pathname.slice(1);text=text.replace(/\.git$/,'');const parts=text.split('/');if(parts.length!==2||!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(parts[0])||!/^[a-zA-Z0-9_.-]{1,100}$/.test(parts[1])||['.','..'].includes(parts[1]))throw Error('仓库请填写 owner/repository，例如 your-name/comfycomic-templates。');return {owner:parts[0],repo:parts[1]}}


function githubFilePath(value){const path=String(value||'').trim();if(!path||path.length>500||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'||/[\\\u0000-\u001f]/.test(p)))throw Error('请输入仓库内的相对文件路径，不能包含 ../ 或反斜线。');if(!/\.(json|html?)$/i.test(path)||path.startsWith('.github/'))throw Error('发布范围仅限普通 JSON / HTML 模板文件，不允许修改 GitHub 工作流。');return path}


function githubBranch(value){const v=String(value||'').trim();if(v&&(/[\s~^:?*\[\\]|\.\.|@\{|\/\/|^\/|\/$/.test(v)||v.endsWith('.lock')||v.endsWith('.')))throw Error('分支名称格式不合法。');return v}


function githubResources(){const resources=[];if($('#template-studio').open&&studioUI.editor)resources.push({id:'draft',title:'当前 HTML 编辑草稿 · '+studioUI.editor.title,type:'画册 HTML 模板'});state.exportTemplates.forEach(t=>resources.push({id:'export:'+t.id,title:t.title,type:'画册 HTML 模板'}));projectTemplates().forEach(t=>resources.push({id:'story:'+t.id,title:t.title,type:'分镜剧本模板'}));resources.push({id:'workflow:active',title:state.settings.comfy.workflowTitle,type:'ComfyUI API 工作流'});return resources}


function selectedPublishPackage(id){
  let value,title,kind,filename;
  if(id==='draft'||id?.startsWith('export:')){
    const source=id==='draft'?studioUI.editor:exportTemplateBy(id.slice(7));if(!source)throw Error('所选 HTML 模板已不存在。');validateExportTemplate(source);
    const t={id:source.id,kind:templateKind,formatVersion:1,title:source.title,description:source.description||'',author:source.author,version:source.version,layout:source.layout,html:source.html,options:clone(source.options),builtin:false,source:'import',createdAt:source.createdAt,updatedAt:source.updatedAt};
    value={kind:templateKind,formatVersion:1,template:t};title=t.title;kind='画册 HTML 模板';filename='templates/'+safeFolderName(t.title)+'.cctemplate.json';
  }else if(id?.startsWith('story:')){
    const t=templateBy(id.slice(6));if(!t)throw Error('分镜模板已不存在。');value={title:t.title,outline:t.outline,frames:t.frames.map(f=>{const out={};for(const k of ['name','camera','prompt','caption','negative','width','height','steps','cfg','denoise','seed'])out[k]=f[k];return out})};title=t.title;kind='分镜剧本模板';filename='storyboards/'+safeFolderName(t.title)+'.json';
  }else if(id==='workflow:active'){value=clone(validateWorkflow(state.settings.comfy.workflow));title=state.settings.comfy.workflowTitle;kind='ComfyUI API 工作流';filename='workflows/'+safeFolderName(title)+'.json';}
  else throw Error('请选择要上传的资源。');
  const secrets=[];const scan=(node,path='')=>{if(!node||typeof node!=='object')return;for(const[k,v]of Object.entries(node)){if(/^(api[_-]?key|access[_-]?token|token|authorization|password|secret)$/i.test(k)&&typeof v==='string'&&v.trim())secrets.push(path+k);if(v&&typeof v==='object')scan(v,path+k+'.')}};scan(value);if(secrets.length)throw Error('所选资源包含疑似密钥字段：'+secrets.slice(0,3).join(', ')+'。请先移除再发布。');
  const text=JSON.stringify(value,null,2),bytes=new TextEncoder().encode(text).length;if(bytes>1000000)throw Error('模板包超过 1 MB，建议导出后在 GitHub 网页或 Git 客户端上传。');return {value,text,title,kind,filename,bytes};
}


function githubConfiguration(){const d=releaseUI.githubDraft||state.settings.github,repo=githubRepoParts(d.repository);return {...repo,branch:githubBranch(d.branch),path:githubFilePath(d.path),token:releaseUI.githubToken.trim()}}


function githubBase(c){return '/repos/'+encodeURIComponent(c.owner)+'/'+encodeURIComponent(c.repo)}


function githubWriteBody(text,message,branch,sha=null){const body={message,content:utf8Base64(text),branch};if(sha)body.sha=sha;return body}


async function githubRequest(path,{method='GET',body,token=releaseUI.githubToken,signal,missing=false}={}){
  if(!path.startsWith('/repos/'))throw Error('GitHub API 路径不合法。');
  const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(token)headers.Authorization='Bearer '+token;if(body)headers['Content-Type']='application/json';
  try{const response=await request('https://api.github.com'+path,{method,headers,signal,body:body?JSON.stringify(body):undefined,redirect:'error'},30000);return response.json()}
  catch(error){const message=error.message||'';if(missing&&/^HTTP 404:/.test(message))return null;
    if(error.name==='AbortError')throw error;
    if(/^HTTP 401:/.test(message))throw Error('GitHub Token 无效或已过期。请创建仅限此仓库的 fine-grained token。');
    if(/^HTTP 403:/.test(message))throw Error('GitHub 拒绝访问。检查 Contents: Read and write 权限、组织审批或 API 频率限制。');
    if(/^HTTP 404:/.test(message))throw Error('仓库、分支或文件不存在，或 Token 没有访问权限。新仓库请先创建 README 以初始化分支。');
    if(/^HTTP 409:/.test(message))throw Error('GitHub 文件已被其他提交修改（409）。请重新检查文件，不会强制覆盖。');
    if(/^HTTP 422:/.test(message))throw Error('GitHub 拒绝本次提交（422）。检查文件路径、分支规则和提交消息。');
    throw Error(safeServiceError(error));
  }
}


function readGithubDraft(){
  if(!releaseUI.githubDraft)return;for(const key of ['repository','branch','path','message','resourceId']){const el=$('#github-'+key);if(el)releaseUI.githubDraft[key]=el.value}
  const token=$('#github-token');if(token)releaseUI.githubToken=token.value;
}


function rememberGithubLocation(){const d=releaseUI.githubDraft;state.settings.github={repository:d.repository,branch:d.branch,path:d.path};save()}


function openGithubPublisher(resourceId=null,tab='publish'){
  if(releaseUI.githubBusy){if(!$('#github-dialog').open)$('#github-dialog').showModal();return}
  const resources=githubResources(),preferred=resourceId||($('#template-studio').open?'draft':null)||resources[0]?.id;
  releaseUI.githubDraft={...state.settings.github,resourceId:preferred,message:'Publish Mio template'};
  if(!releaseUI.githubDraft.path){try{releaseUI.githubDraft.path=selectedPublishPackage(preferred).filename}catch(e){releaseUI.githubDraft.path='templates/my-template.cctemplate.json'}}
  releaseUI.githubTab=tab;releaseUI.githubResult=null;releaseUI.githubCheck=null;renderGithubPublisher();if(!$('#github-dialog').open)$('#github-dialog').showModal();
}


function githubLocationFields(includeToken=true){const d=releaseUI.githubDraft;return `${field('GitHub 仓库',input('repository',d.repository,'text','id="github-repository" placeholder="your-name/comfycomic-templates" autocomplete="off"'),'填写 owner/repo 或 github.com 仓库地址。')}${field('分支',input('branch',d.branch,'text','id="github-branch" placeholder="留空，读取仓库默认分支" autocomplete="off"'))}${field('仓库内文件路径',input('path',d.path,'text','id="github-path" placeholder="templates/my-template.cctemplate.json" autocomplete="off"'),'这是仓库文件路径，不是电脑上的保存目录。')}${includeToken?field('Fine-grained GitHub Token',`<div class="service-key">${input('token',releaseUI.githubToken,'password','id="github-token" autocomplete="off" spellcheck="false" aria-label="GitHub 访问令牌"')}${ibtn('eye','github-token-toggle','显示或隐藏访问令牌')}</div>`,'选择目标仓库，授予 Contents: Read and write。Token 仅在此窗口会话使用，不写入工程或磁盘。'):''}`}


function renderGithubPublisher(){
  const d=releaseUI.githubDraft,tab=releaseUI.githubTab;let body;
  const selector=field('只上传这一个资源',`<select id="github-resourceId" aria-label="选择上传模板">${githubResources().map(r=>opt(r.id,r.type+' / '+r.title,d.resourceId)).join('')}</select>`);
  if(tab==='publish')body=`<div class="publish-layout"><section>${selector}${githubLocationFields()}${field('提交说明',input('message',d.message,'text','id="github-message" maxlength="200"'))}<label class="publish-consent"><input type="checkbox" id="github-consent"><span>我确认有权发布所选资源，并已检查其中的 HTML、提示词和台词。公开仓库中的文件任何人都可读取。</span></label><p class="service-note">不会上传画册原图、角色库、对话历史或工程 API 配置。模板源码若本身包含内嵌图片，则图片随模板一起上传。</p></section><aside class="publish-summary" id="github-package-preview"></aside></div>`;
  else if(tab==='manual')body=`<div class="publish-layout"><section>${selector}${githubLocationFields(false)}<ol class="publish-steps"><li>下载模板包<p>点击下方“下载所选模板”，得到可直接导入的 JSON 文件。</p></li><li>在 GitHub 上传文件<p>打开已初始化的仓库，选择 Add file → Upload files，上传模板包并 Commit changes。文件路径请与左侧设置一致。</p></li><li>复制 Raw 地址供安装<p>打开仓库中的 JSON 文件，点击 Raw。把地址粘贴到 Mio 市场的“从仓库导入”即可。</p></li></ol></section><aside class="publish-summary"><h3>不想填写 Token？用网页上传。</h3><p class="service-note">手工方式不会让本应用获得仓库写入权限。GitHub Pages 不是安装模板的必要条件，公开仓库的 Raw 文件即可托管。</p><div class="stack">${btn('下载所选模板','download','github-download-package')}${btn('打开 GitHub 上传页面','upload','github-open-upload')}${btn('复制预计 Raw 地址','copy','github-copy-expected')}</div><p class="help">预计链接只有实际上传成功后才可访问；上传页需在 GitHub 登录。</p></aside></div>`;
  else body=`<div class="publish-layout"><section>${githubLocationFields()}<div class="service-note">公开仓库读取不需要 Token。私有仓库需要具备 Contents: Read 权限的 Token；该凭据只会发给 api.github.com。</div></section><aside class="publish-summary"><h3>把托管的模板装回工作室</h3><p class="service-note">填写明确的仓库、分支与文件路径。系统读取文件后会先校验，再询问是否安装为独立副本。支持画册 HTML 模板包、分镜模板 JSON 和 API 工作流。</p>${btn('读取并校验仓库文件','download','github-import','','primary')}<p class="help">不会执行仓库脚本，也不会把访问令牌附加到分享链接中。</p></aside></div>`;
  $('#github-dialog').innerHTML=`<header class="modal-head">${icon('upload')}<div class="grow"><h2 id="github-title">GitHub 模板发布与安装</h2><p>上传一个可复用的创作组件，而不是你的整个私有工作室。</p></div>${ibtn('close','github-close','关闭发布窗口并清除 Token')}</header><div class="service-body"><div class="tabbar" style="margin-bottom:21px">${[['publish','直接上传到仓库'],['manual','GitHub 网页上传教程'],['import','从仓库安装']].map(([v,l])=>`<button class="tab ${v===tab?'active':''}" data-act="github-tab" data-tab="${v}">${l}</button>`).join('')}</div>${body}<div id="github-result" class="service-test-result"><span class="service-status">${tab==='publish'?'先检查仓库，再确认提交。已有文件会使用 SHA 防止并发覆盖。':'所有仓库操作均由你主动触发。'}</span></div><div class="row wrap" style="margin-top:13px"><a href="https://github.com/new" target="_blank" rel="noopener noreferrer" class="tiny">创建仓库</a><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" class="tiny">创建 Fine-grained Token</a><a href="https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents" target="_blank" rel="noopener noreferrer" class="tiny">权限与接口文档</a></div></div><footer class="service-footer"><span class="grow service-status">Token 不写入磁盘，关闭窗口即清除。</span>${releaseUI.githubBusy?btn('停止等待','stop','github-stop'):tab==='publish'?btn('检查仓库与文件','eye','github-check')+btn('上传并提交','upload','github-publish','','primary'):btn('关闭','','github-close')}</footer>`;
  if(tab==='publish')updateGithubPackagePreview();
  if(tab==='manual'){const steps=$$('.publish-steps li',$('#github-dialog'));if(steps[1])$('p',steps[1]).textContent='在仓库中进入目标文件夹，再选择 Add file → Upload files，上传 JSON 后 Commit changes。如果 templates/ 文件夹尚不存在，可先用 Add file → Create new file 创建 templates/README.md；或者将左侧文件路径改为不含目录的文件名，直接上传到仓库根目录。';}
}


function updateGithubPackagePreview(){const area=$('#github-package-preview');if(!area)return;try{const p=selectedPublishPackage(releaseUI.githubDraft.resourceId);area.innerHTML=`<h3>即将上传的内容</h3><dl><dt>资源</dt><dd>${esc(p.title)}</dd><dt>类型</dt><dd>${p.kind}</dd><dt>大小</dt><dd>${(p.bytes/1024).toFixed(1)} KB</dd><dt>范围</dt><dd>仅一个模板文件</dd></dl><pre>${esc(p.text.slice(0,6500))}${p.text.length>6500?'\n...（界面预览已截断，上传包含完整模板）':''}</pre><p class="service-note">请检查要公开的提示词、台词、作者和内嵌图片。应用不会追加任何工程设置或 API 密钥。</p>`}catch(e){area.innerHTML=`<p class="service-status error">${esc(e.message)}</p>`}}


function setGithubBusy(busy){releaseUI.githubBusy=busy;$$('input,select,textarea,button',$('#github-dialog')).forEach(el=>{if(['github-close','github-stop'].includes(el.dataset.act))return;el.disabled=busy});if(busy){const status=$('#github-result');if(status)status.innerHTML='<span class="service-status"><i class="dot live"></i> 正在与 GitHub 通信...</span>'+btn('停止等待','stop','github-stop','style="margin-left:12px"','small')}}


async function verifyGithubTarget(cfg,signal){
  const repo=await githubRequest(githubBase(cfg),{token:cfg.token,signal});const branch=cfg.branch||repo.default_branch;if(!branch)throw Error('仓库没有可用分支，请先创建 README。');await githubRequest(githubBase(cfg)+'/branches/'+encodeURIComponent(branch),{token:cfg.token,signal});
  const file=await githubRequest(githubBase(cfg)+'/contents/'+encodedPath(cfg.path)+'?ref='+encodeURIComponent(branch),{token:cfg.token,signal,missing:true});if(file&&file.type!=='file')throw Error('目标路径不是普通文件，请换一个文件名。');return {repo,branch,file};
}


async function checkGithubTarget(){
  if(releaseUI.githubBusy)return;readGithubDraft();const cfg=githubConfiguration();releaseUI.githubController=new AbortController();setGithubBusy(true);
  try{const target=await verifyGithubTarget(cfg,releaseUI.githubController.signal);releaseUI.githubCheck=target;releaseUI.githubDraft.branch=target.branch;$('#github-branch').value=target.branch;rememberGithubLocation();$('#github-result').innerHTML=`<span class="service-status success">已连接 ${esc(cfg.owner+'/'+cfg.repo)} / ${esc(target.branch)} · ${target.repo.private?'私有仓库':'公开仓库'}。<br>${target.file?'已存在同名文件，上传前将再次确认并带 SHA 更新。':'当前路径尚无文件，上传将创建新文件。'}${cfg.token?'':' 未提供 Token，只能检查公开资源，上传需填写写入令牌。'}</span>`}
  catch(e){$('#github-result').innerHTML=`<span class="service-status error">${esc(safeServiceError(e))}</span>`;throw e}
  finally{setGithubBusy(false);releaseUI.githubController=null}
}


async function publishGithubTemplate(){
  if(releaseUI.githubBusy)return;readGithubDraft();const cfg=githubConfiguration(),pkg=selectedPublishPackage(releaseUI.githubDraft.resourceId);
  if(!cfg.token)throw Error('请填写 GitHub Token，或切换到无需 Token 的“GitHub 网页上传教程”。');if(!$('#github-consent')?.checked)throw Error('请先确认你有权发布此资源，并已检查公开内容。');const message=releaseUI.githubDraft.message.trim();if(!message)throw Error('请输入提交说明。');
  if(!/\.json$/i.test(cfg.path))throw Error('直接上传以 JSON 模板包保存，请将文件路径设置为 .json。');
  releaseUI.githubController=new AbortController();setGithubBusy(true);let putStarted=false;
  try{const target=await verifyGithubTarget(cfg,releaseUI.githubController.signal);
    if(!await confirmAction(target.file?'更新 GitHub 上的同名文件？':'将模板上传到 GitHub？',`资源：${pkg.title}\n目标：${cfg.owner}/${cfg.repo} / ${target.branch} / ${cfg.path}\n可见性：${target.repo.private?'私有仓库，仅有权限的人可读取':'公开仓库，任何人都可读取'}\n${target.file?'将创建新提交并替换当前文件。Git 历史保留旧版本。':'将创建一个新的仓库文件。'}\n不会上传私有画册或 API 配置。`,'确认提交')){$('#github-result').innerHTML='<span class="service-status">已取消提交，GitHub 文件未被修改。</span>';return}
    if(releaseUI.githubController.signal.aborted)throw new DOMException('上传已取消','AbortError');
    const body=githubWriteBody(pkg.text,message,target.branch,target.file?.sha);
    putStarted=true;const result=await githubRequest(githubBase(cfg)+'/contents/'+encodedPath(cfg.path),{method:'PUT',token:cfg.token,signal:releaseUI.githubController.signal,body});
    const sha=result.commit?.sha;if(!/^[a-f0-9]{40,64}$/i.test(sha||''))throw Error('GitHub 已返回响应，但缺少提交 SHA，请到仓库确认上传结果。');
    const raw='https://raw.githubusercontent.com/'+encodeURIComponent(cfg.owner)+'/'+encodeURIComponent(cfg.repo)+'/'+sha+'/'+encodedPath(cfg.path),page='https://github.com/'+encodeURIComponent(cfg.owner)+'/'+encodeURIComponent(cfg.repo)+'/blob/'+sha+'/'+encodedPath(cfg.path);
    releaseUI.githubResult={raw,page,sha,private:target.repo.private,path:cfg.path,title:pkg.title,kind:pkg.kind};releaseUI.githubDraft.branch=target.branch;rememberGithubLocation();state.settings.tutorial.publishedAt=Date.now();save();
    $('#github-result').innerHTML=`<p class="service-status success">提交成功 · ${esc(sha.slice(0,10))}。${target.repo.private?'私有仓库的 Raw 地址不公开可读，请通过“从仓库安装”并提供读取权限。':'以下固定版本地址可以粘贴到模板市场的导入栏。'}</p><div class="publish-link">${esc(raw)}</div><div class="row wrap" style="margin-top:12px">${btn('复制安装链接','copy','github-copy-result')}<a href="${esc(page)}" target="_blank" rel="noopener noreferrer" class="btn small">在 GitHub 查看文件</a>${btn('生成 README 安装说明','download','github-readme','','small')}</div>`;toast('GitHub 已确认模板提交成功。');
  }catch(e){let message=safeServiceError(e);if(putStarted&&(e.name==='AbortError'||/网络|浏览器无法/.test(message)))message+=' 提交可能已到达 GitHub，请先检查仓库再重试，避免重复提交。';$('#github-result').innerHTML=`<span class="service-status error">${esc(message)}</span>`;throw Error(message)}
  finally{setGithubBusy(false);releaseUI.githubController=null}
}


async function installGithubFile(){
  if(releaseUI.githubBusy)return;readGithubDraft();const cfg=githubConfiguration();releaseUI.githubController=new AbortController();setGithubBusy(true);
  try{const target=await verifyGithubTarget(cfg,releaseUI.githubController.signal);if(!target.file||target.file.encoding!=='base64'||!target.file.content)throw Error('没有可读取的普通文件，或文件超出 1 MB 限制。');const text=base64UTF8(target.file.content);let value;try{value=JSON.parse(text)}catch(e){}
    if(!value||value.kind===templateKind||value.template?.kind===templateKind){const t=parseExportTemplateFile(text,cfg.path.split('/').at(-1));validateExportTemplate(t);if(!await confirmAction('安装「'+t.title+'」？','来源：'+cfg.owner+'/'+cfg.repo+'\n已验证离线模板结构，作为独立副本导入。','安装模板'))return;if(state.exportTemplates.length>=100)throw Error('画册模板库已达上限。');state.exportTemplates.push(t);save();$('#github-dialog').close();releaseUI.githubToken='';openTemplateStudio(t.id)}
    else if(Array.isArray(value.frames)){if(!await confirmAction('导入分镜剧本模板？',value.title||cfg.path,'导入副本'))return;importTemplateObject(value);$('#github-dialog').close();releaseUI.githubToken='';if(workspaceVisible(1))navigate(1)}
    else{validateWorkflow(value);if(!await confirmAction('导入 API 工作流？','仅保存蓝图，不会立即提交 GPU 任务。','保存工作流'))return;state.settings.comfy.presets.push({id:uid('wf'),title:cfg.path.split('/').at(-1),workflow:value,mapping:clone(state.settings.comfy.mapping)});save();$('#github-dialog').close();releaseUI.githubToken=''}
    toast('GitHub 文件已校验并导入。');
  }catch(e){const area=$('#github-result');if(area)area.innerHTML=`<span class="service-status error">${esc(safeServiceError(e))}</span>`;throw e}
  finally{setGithubBusy(false);releaseUI.githubController=null}
}


function githubSummarySettings(){const c=state.settings.github;return `<section class="settings-section"><h2>让模板在 GitHub 上流转</h2><p>上传、版本管理和安装链接有独立入口。你可以直接通过 GitHub API 提交，也可以下载模板包后在 GitHub 网页上传。</p><div class="service-context"><strong>模板发布，不是全量工程同步</strong><br>最近仓库：${esc(c.repository||'尚未配置')}<br>资源类型：画册 HTML 模板、分镜剧本、ComfyUI 工作流</div><div class="row wrap" style="margin:20px 0">${btn('上传模板到 GitHub','upload','github-open','','primary')}${btn('查看网页上传教程','help','github-manual')}${btn('从仓库安装','download','github-import-open')}</div><div class="settings-note">${icon('shield')}<span>GitHub Token 只会发送给 api.github.com，不保存在工程、磁盘或模板包中。公开仓库中的模板可以用 Raw 链接安装；私有仓库必须有读取权限。</span></div></section>`;}


function guidePreferences(){return state.settings.tutorial}


function guideBook(){const p=guidePreferences();return bookBy(p.practiceBookId)||projectBooks()[0]||state.books[0]}


function guideTaskStatus(index){const t=guidePreferences();if(index===0)return disk.root&&rt.saved?'已连接并写入本地目录。':'尚未落盘，也可以先在临时会话中练习。';if(index===3)return releaseUI.practiceBusy?'正在本地生成练习分镜...':bookBy(t.practiceBookId)?.status==='complete'?'三幕练习已生成，可进入下一步阅读。':'练习会新建独立企划，不会改动你的已有作品。';if(index===4)return criticReadyLabel();if(index===6)return t.publishedAt?'已完成过一次 GitHub 提交。':'上传是可选步骤，不影响本地创作。';return ''}


function openQuickStart(step=null){
  if(step!==null)releaseUI.guideStep=clamp(Number(step),0,guideSteps.length-1);else releaseUI.guideStep=clamp(guidePreferences().lastStep||0,0,guideSteps.length-1);
  guidePreferences().seen=true;try{localStorage.setItem('cc-quickstart-v25','seen')}catch(e){}save();renderQuickStart();if(!$('#guide-dialog').open)$('#guide-dialog').showModal();
}


function renderQuickStart(){
  const index=releaseUI.guideStep,step=guideSteps[index],prefs=guidePreferences(),book=guideBook();
  $('#guide-dialog').innerHTML=`<header class="modal-head">${icon('help')}<div class="grow"><h2 id="guide-title">快速开始 · 从灵感到一本画册</h2><p>约 5 分钟 · 可以随时暂停，在侧栏重新打开。</p></div>${ibtn('close','guide-close','暂停教程')}</header><div class="guide-progress"><i style="width:${(index+1)/guideSteps.length*100}%"></i></div><div class="guide-layout"><nav class="guide-sidebar" aria-label="教程步骤"><p>GET STARTED</p>${guideSteps.map((s,i)=>`<button class="guide-step ${i===index?'active':''} ${prefs.readSteps.includes(i)?'complete':''}" data-act="guide-step" data-index="${i}" ${i===index?'aria-current="step"':''}><span class="step-no">${pad(i+1)}</span><span>${s.title}</span></button>`).join('')}</nav><div class="guide-main"><div class="service-eyebrow">STEP ${pad(index+1)} / ${pad(guideSteps.length)}</div><h3>${step.headline}</h3><p class="guide-description">${step.description}</p>${index===0?`<div class="guide-art">${icon('folder')}<div class="guide-mini-steps">工作室 / 企划 / 画册 / 图片<br><span class="muted">分镜模板 · 角色参考 · 剧情版本 · 导出模板</span></div></div>`:index===3||index===4?`<div class="guide-art">${[0,1,2].map(i=>imgTag(svgArt(i,200+i),'本地练习分镜 '+(i+1))).join('')}<span class="tiny muted">离线 SVG<br>三幕完整流程</span></div>`:''}<ul class="guide-checklist">${step.checks.map(text=>`<li>${icon('check')}<span>${text}</span></li>`).join('')}</ul><div class="row wrap" style="margin-top:23px">${btn(index===3&&bookBy(prefs.practiceBookId)?.status==='complete'?'打开已生成的练习画册':step.label,step.icon,step.action,releaseUI.practiceBusy&&index===3?'disabled':'','primary')}${index===4?btn('填写视觉审校 API','settings','guide-critic'):''}${index===5?btn('自定义 HTML 模板','edit','guide-template'):''}</div><p class="guide-task-status">${esc(guideTaskStatus(index))}</p>${index===3?'<p class="help">这是真实写入本地工程的数据练习，不需要连接任何外部模型。可在普通画廊删除练习画册。</p>':''}</div></div><footer class="service-footer"><span class="grow service-status">${index+1} / ${guideSteps.length} · 阅读本页不会自动执行任何生产任务。</span>${btn('上一步','','guide-prev',index===0?'disabled':'')}${btn(index===guideSteps.length-1?'完成教程':'下一步','arrow',index===guideSteps.length-1?'guide-finish':'guide-next','','primary')}</footer>`;
}


function markGuidePage(){const p=guidePreferences();if(!p.readSteps.includes(releaseUI.guideStep))p.readSteps.push(releaseUI.guideStep);p.lastStep=releaseUI.guideStep;save()}


function quickStartSettings(){const p=guidePreferences();return `<section class="settings-section"><h2>一份可以边做边看的教程</h2><p>从本地保存、企划、角色与分镜，到生成、视觉审校、HTML 导出和 GitHub 托管。每一步都能跳到对应的真实功能。</p><div class="row wrap">${btn('从头开始教程','play','guide-open','data-step="0"','primary')}${btn('继续上次步骤','arrow','guide-open')}${btn('创建本地三幕练习','story','guide-practice')}</div><div class="divider"></div>${guideSteps.map((s,i)=>settingsRow(p.readSteps.includes(i)?s.title+' · 已阅读':s.title,s.description,btn('阅读','','guide-open',`data-step="${i}"`,'small'),s.icon)).join('')}</section>`}


async function guideDestination(action){
  markGuidePage();$('#guide-dialog').close();
  if(action==='storage')return handleAction('storage-settings',{});
  if(action==='project')return handleAction('new-project',{});
  if(action==='storyboard'){if(!workspaceVisible(1)){studioUI.settingsTab='modules';navigate(5);toast('分镜工作区已隐藏，可先在模块管理中重新启用。');return}navigate(1);return}
  if(action==='reader'||action==='export'){const b=guideBook();if(!b){openQuickStart(3);toast('先创建三幕练习或生成你的第一本画册。');return}if(action==='reader'){changeProject(b.projectId);openReader(b.id)}else showExportHub([b.id]);return}
  if(action==='critic'){openCriticSettings();return}
  if(action==='template'){openTemplateStudio();return}
  if(action==='github'){openGithubPublisher(null,'manual');return}
}


async function composerLayoutProbe(){
  closeModal();if(!featureEnabled('assistant'))throw Error('请先启用分镜精修助手。');showAssistant();const panel=$('#assistant'),size=releaseUI.composerSize;releaseUI.composerSize=10000;fitAssistantWindow();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const actions=$('.composer-actions',panel),help=$('.composer-help',panel),textarea=$('#chat-input'),r=panel.getBoundingClientRect(),a=actions?.getBoundingClientRect(),h=help?.getBoundingClientRect(),t=textarea?.getBoundingClientRect();const good=a&&h&&t&&a.bottom<=r.bottom-2&&h.bottom<=r.bottom&&t.bottom<=a.top+1;releaseUI.composerSize=size;fitAssistantWindow();toast(good?'当前视口布局检查通过：最大输入区不会挤出发送按钮或覆盖说明。':'当前视口未通过布局检查，请扩大窗口或调整浏览器缩放。',good?'ok':'error');
}



function closeServiceDialog(id){const dialog=$('#'+id);if(dialog.contains($('#toasts')))document.body.append($('#toasts'));if(dialog.contains($('#ui-tooltip')))document.body.append($('#ui-tooltip'));dialog.close()}


async function closeGithubWindow(){if(releaseUI.githubBusy){if(!await confirmAction('停止等待 GitHub 响应？','请求可能已经到达 GitHub。停止后请到仓库检查是否产生了提交，再决定是否重试。','停止并关闭'))return;releaseUI.githubController?.abort()}readGithubDraft();rememberGithubLocation();releaseUI.githubToken='';const token=$('#github-token');if(token){token.value='';token.removeAttribute('value')}closeServiceDialog('github-dialog')}


function githubExpectedURL(){readGithubDraft();const c=githubConfiguration();if(!c.branch)throw Error('请填写实际分支名，或在直接上传页先检查默认分支。');return 'https://raw.githubusercontent.com/'+encodeURIComponent(c.owner)+'/'+encodeURIComponent(c.repo)+'/'+encodedPath(c.branch)+'/'+encodedPath(c.path)}


function selectedPlan(){return planBy(createUI.planId)&&planBy(createUI.planId).projectId===state.activeProjectId?planBy(createUI.planId):projectPlans()[0]}


function variableEditor(entries,group,id){return `${entries.length?`<table class="variable-table"><thead><tr><th>变量 / 占位符</th><th>类型</th><th>内容</th><th></th></tr></thead><tbody>${entries.map(e=>`<tr><td><div class="row" style="gap:4px"><span class="mono grow">{${esc(e.key)}}</span>${ibtn('edit','v3-variable-rename','重命名变量',`data-group="${group}" data-id="${id}" data-entry="${e.id}"`)}</div></td><td><select data-v3-var="type" data-group="${group}" data-owner="${id}" data-entry="${e.id}" aria-label="${esc(e.key)} 的类型">${Object.entries(variableTypes).map(([v,l])=>opt(v,l,e.type)).join('')}</select></td><td>${e.type==='boolean'?`<select data-v3-var="value" data-group="${group}" data-owner="${id}" data-entry="${e.id}" aria-label="${esc(e.key)} 的值">${opt('true','开启 / true',String(e.value))}${opt('false','关闭 / false',String(e.value))}</select>`:e.type==='number'?input('value',e.value,'number',`data-v3-var="value" data-group="${group}" data-owner="${id}" data-entry="${e.id}" step="any" aria-label="${esc(e.key)} 的值"`):`<textarea data-v3-var="value" data-group="${group}" data-owner="${id}" data-entry="${e.id}" aria-label="${esc(e.key)} 的值" ${e.type==='json'?'spellcheck="false"':''}>${esc(typeof e.value==='object'?JSON.stringify(e.value,null,2):e.value)}</textarea>`}</td><td>${ibtn('trash','v3-variable-delete','删除变量',`data-group="${group}" data-id="${id}" data-entry="${e.id}"`)}</td></tr>`).join('')}</tbody></table>`:'<div class="variable-empty">这里没有固定字段。按需添加角色、场景、模型强度，或工作流需要的任何参数。</div>'}<div class="row" style="padding-top:13px">${btn('添加变量','plus','v3-variable-add',`data-group="${group}" data-id="${id}"`,'small')}<span class="tiny muted">在提示词中使用 {变量名}，节点中可以直接读取类型化的值。</span></div>`}


function renderCreationWorkspace(){
  const p=selectedPlan();if(p)createUI.planId=p.id;
  const header=`<div class="creation-head">${heading('创作画册','把分镜、素材与生成计划放在一起。',btn('新建画册计划','plus','v3-plan-new')+btn('生成选中的画册','play','v3-generate-selected','','primary'),'CREATE / YOUR NEXT STORY')}<div class="creation-path"><span>画册计划</span>${icon('arrow')}<span>选择分镜</span>${icon('arrow')}<span>组合变量素材</span>${icon('arrow')}<span>生成画面</span></div></div><nav class="creation-tabs" aria-label="创作步骤">${[['plans','画册计划'],['scenes','分镜编辑'],['variables','变量素材'],['queue','生成队列']].map(([id,l])=>`<button class="${createUI.tab===id?'active':''}" data-act="v3-create-tab" data-tab="${id}" ${createUI.tab===id?'aria-current="page"':''}>${l}</button>`).join('')}</nav>`;
  return header+({plans:renderBookPlans,scenes:renderSceneComposer,variables:renderVariableLibrary,queue:renderCreationQueue}[createUI.tab]||renderBookPlans)();
}


function renderPlanRail(){return `<aside class="creation-rail"><div class="creation-rail-head"><span>本企划的画册计划</span>${ibtn('plus','v3-plan-new','新建画册计划')}</div>${projectPlans().map(p=>`<div class="plan-list-item ${p.id===createUI.planId?'active':''}"><input type="checkbox" data-v3-plan-enabled="${p.id}" ${p.enabled?'checked':''} aria-label="勾选 ${esc(p.title)} 参与生成"><button class="plan-list-button" data-act="v3-plan-select" data-id="${p.id}"><strong>${esc(p.title)}</strong><small>${esc(templateBy(p.templateId)?.title||'尚未选择分镜')}<br>${p.variableSetIds.length} 组复用素材</small></button></div>`).join('')}${!projectPlans().length?'<p class="help">先给你的第一本画册起一个名字。</p>':''}</aside>`}


function renderBookPlans(){const p=selectedPlan();if(!p)return `<div class="empty">${icon('book')}<h3>一本画册，不止一组固定变量。</h3><p>给画册起名，选择分镜，然后自由组合角色、画风或模型参数。</p>${btn('创建第一份计划','plus','v3-plan-new','','primary')}</div>`;const t=templateBy(p.templateId);return `<div class="creation-layout">${renderPlanRail()}<div class="creation-detail"><section class="creation-section"><div class="row between"><label class="label" for="v3-plan-title">为画册起名</label><div class="row">${ibtn('copy','v3-plan-clone','复制计划，复用原有素材')}${ibtn('trash','v3-plan-delete','删除计划，不删除已生成画册')}</div></div>${input('title',p.title,'text','class="plan-name-input" id="v3-plan-title" data-v3-plan="title" placeholder="一个好故事，从名字开始"')}<p class="help">名称可以使用变量，例如「{character} 的夏天」。素材与名字独立管理。</p><div class="plan-context-grid" style="margin-top:22px">${field('使用哪套分镜？',`<select data-v3-plan="templateId" aria-label="画册使用的分镜模板"><option value="">请选择分镜模板</option>${projectTemplates().map(t=>opt(t.id,t.title+' · '+t.frames.length+' 幕',p.templateId)).join('')}</select>`)}<div><div class="label">内容编辑</div><div class="row">${btn('编辑分镜','story','v3-plan-scenes',t?'':'disabled')}${btn('新建分镜','plus','new-template','','small')}</div></div></div></section><section class="creation-section"><h2>组合可复用素材</h2><p>同一套角色、画风或 LoRA 参数可用于多本画册。按下方顺序合并，同名变量由后者覆盖。</p>${p.variableSetIds.map((id,i)=>{const s=setBy(id);return `<div class="variable-source-row"><span class="order-label">${pad(i+1)}</span><div class="grow"><strong>${esc(s?.title||'素材已删除')}</strong><small>${s?s.entries.map(e=>'{'+esc(e.key)+'}').join(' · '):'请移除无效引用'}</small></div>${ibtn('up','v3-set-order','向前移动素材',`data-index="${i}" data-dir="-1"`)}${ibtn('down','v3-set-order','向后移动素材',`data-index="${i}" data-dir="1"`)}${ibtn('close','v3-plan-unlink','仅从本册移除素材引用',`data-id="${id}"`)}</div>`}).join('')||'<div class="variable-empty">还没有引用素材。可直接填写本册变量，也可以复用已有素材。</div>'}<div class="row" style="padding-top:13px">${btn('选择素材','plus','v3-choose-sets','','small')}${btn('创建可复用素材','users','v3-set-new','','ghost small')}</div></section><section class="creation-section"><h2>本册专属变量</h2><p>只影响这本画册。可以添加新变量，也可以覆盖上面素材中的同名值。</p>${variableEditor(p.variables,'plan',p.id)}</section><section class="creation-section"><div class="row between"><h3>最终内容预览</h3>${btn('重新检查','refresh','v3-refresh-preview','','ghost small')}</div><div id="v3-plan-preview">${renderPlanPreview(p)}</div></section><div class="create-queue-actions"><span class="tiny muted grow">分镜与变量会在入队时拍成快照，后续修改不影响正在生成的画册。</span>${btn('只加入队列','plus','v3-enqueue-plan',t?'':'disabled')}${btn('生成这本画册','play','v3-generate-plan',t?'':'disabled','primary')}</div></div></div>`}


function renderPlanPreview(p){try{const t=templateBy(p.templateId),f=t?.frames[0],scope=effectivePlanScope(p,f),title=scopeText(p.title,effectivePlanScope(p).values),frame=f?effectivePlanFrame(p,f):null,missing=missingScopeKeys(p.title,effectivePlanScope(p).values).concat(frame?missingScopeKeys(frame.prompt+' '+frame.caption,scope.values):[]);return `${missing.length?`<div class="scope-warnings">待补充 ${[...new Set(missing)].map(k=>'{'+esc(k)+'}').join('、')}。缺少的变量会在生成前拦截，不会静默删除。</div>`:''}<div class="resolved-preview"><strong style="font-family:var(--sans);font-size:13px">${esc(title)}</strong>${frame?'\n\n'+esc(scopeText(frame.prompt,scope.values))+'\n\n'+esc(scopeText(frame.caption,scope.values)):'\n请先选择分镜模板。'}</div><div class="scope-explain">${icon('nodes')}<span>优先级：复用素材从上到下 → 本册变量 → 本幕变量。${scope.overrides.length?'本幕发生 '+scope.overrides.length+' 处同名覆盖，可在“分镜编辑”中查看。':'当前没有同名冲突。'}</span></div>`}catch(e){return '<div class="scope-warnings">'+esc(e.message)+'</div>'}}


function renderVariableLibrary(){const sets=projectVariableSets(),s=setBy(createUI.setId)&&setBy(createUI.setId).projectId===state.activeProjectId?setBy(createUI.setId):sets[0];if(s)createUI.setId=s.id;return `<div class="row between" style="margin-bottom:23px"><div><h2 style="font-size:17px;font-weight:500;margin:0 0 7px">可复用的变量素材</h2><span class="tiny muted">素材可以是一个角色、一种画风，或一套你自己的插件参数，没有固定字段。</span></div>${btn('新建素材','plus','v3-set-new','','primary')}</div>${s?`<div class="creation-layout"><aside class="creation-rail"><div class="source-set-list">${sets.map(x=>`<button class="source-set-item ${s.id===x.id?'active':''}" data-act="v3-set-select" data-id="${x.id}"><strong>${esc(x.title)}</strong><small>${x.entries.length} 个变量 · ${state.creation.plans.filter(p=>p.variableSetIds.includes(x.id)).length} 本画册使用</small></button>`).join('')}</div></aside><section class="creation-detail"><div class="row" style="margin-bottom:22px"><div class="grow">${field('素材名称',input('title',s.title,'text','data-v3-set-title="true"'))}</div>${ibtn('copy','v3-set-clone','复制为独立素材')}${ibtn('trash','v3-set-delete','删除素材并移除引用')}</div>${variableEditor(s.entries,'set',s.id)}<div class="divider"></div><h3 style="font-size:12px;font-weight:500;margin-bottom:10px">哪些画册在使用？</h3>${state.creation.plans.filter(p=>p.variableSetIds.includes(s.id)).map(p=>`<button class="variable-source-row" style="width:100%;text-align:left" data-act="v3-plan-select" data-id="${p.id}">${icon('book','sm')}<span class="grow small">${esc(p.title)}</span>${icon('arrow','sm')}</button>`).join('')||'<p class="help">尚未被画册引用。在“画册计划 → 选择素材”中加入即可。</p>'}<div class="scope-explain">${icon('shield')}<span>这里的所有变量都能增删。删除仍被引用的变量后，生成预检查会提示缺失，不会替你猜值。</span></div></section></div>`:'<div class="empty">'+icon('users')+'<h3>从一组你需要的变量开始。</h3><p>例如 character / outfit，也可以是你工作流中的任意参数。</p></div>'}`}


function renderSceneComposer(){const p=selectedPlan();let t=currentTemplate()||projectTemplates()[0];if(!t)return `<div class="empty">${icon('story')}<h3>先创建一套分镜。</h3><p>只需要提示词与台词，不必先配置景别或采样参数。</p>${btn('新建分镜模板','plus','new-template','','primary')}</div>`;ui.templateId=t.id;ui.frameIndex=clamp(ui.frameIndex,0,t.frames.length-1);const frame=t.frames[ui.frameIndex],own=createUI.sceneScope==='plan'&&p?.templateId===t.id,o=own?planFrameOverrides(p,frame):frame,shown=own?effectivePlanFrame(p,frame):frame;return `<div class="row wrap" style="margin-bottom:22px"><div style="min-width:210px;flex:1;max-width:350px">${templateSelect('v3-scene-template',t.id)}</div>${btn('新建分镜','plus','new-template','','small')}${btn('导入','upload','import-template','','small')}${btn('导出','download','export-template','','small')}<span class="spacer"></span><select id="v3-scene-scope" class="scene-scope-select" aria-label="分镜修改范围">${opt('shared','编辑共享分镜模板',own?'plan':'shared')}${p?.templateId===t.id?opt('plan','仅覆盖当前画册这一幕',own?'plan':'shared'):''}</select></div><div class="scope-explain" style="padding:0 0 20px">${icon('shield')}<span>${own?'只修改「'+esc(p.title)+'」这一幕，不影响复用这套分镜的其他画册。':'这是一套共享分镜，'+state.creation.plans.filter(x=>x.templateId===t.id).length+' 份计划正在使用。需要个别调整时切换为“仅覆盖当前画册”。'}</span></div><div class="scene-workspace"><aside class="scene-rail">${t.frames.map((f,i)=>`<button class="scene-item ${i===ui.frameIndex?'active':''}" data-act="scene" data-index="${i}" draggable="true" data-drag-index="${i}"><span class="scene-number">${pad(i+1)}</span><div><strong>${esc(f.name)}</strong><small>${planFrameOverrides(p,f).prompt!==undefined?'有本册覆盖':'分镜提示词与台词'}</small></div></button>`).join('')}${btn('新增一幕','plus','add-frame','','ghost small')}</aside><section class="creation-detail scene-text-editor"><div class="row between" style="margin-bottom:18px"><span class="eyebrow" style="margin:0">SCENE ${pad(ui.frameIndex+1)} / ${pad(t.frames.length)}</span><div class="row">${ibtn('up','move-frame','向前移动分镜','data-dir="-1"')}${ibtn('down','move-frame','向后移动分镜','data-dir="1"')}${ibtn('copy','clone-frame','复制本幕')}${ibtn('trash','delete-frame','删除本幕')}</div></div>${field('这一幕叫什么？',input('name',shown.name,'text','data-v3-frame="name"'))}${field('画面提示词',`<textarea id="frame-prompt" data-v3-frame="prompt" placeholder="描述人物、场景、镜头和氛围，所有构图都由你的提示词决定。">${esc(shown.prompt)}</textarea>`,'可以使用 {变量名}。景别、角度、风格均可直接写入提示词，无额外固定控件。')}${field('剧情台词 / 旁白',`<textarea class="caption-editor" data-v3-frame="caption" placeholder="不需要旁白时可以留空。">${esc(shown.caption)}</textarea>`)}${own?btn('清除此幕覆盖，恢复模板','refresh','v3-clear-scene','','small ghost'):''}<details class="advanced-details"><summary>${icon('nodes')}此幕的变量覆盖</summary><p class="help">可为这一幕更换服装、场景或 LoRA 强度。同名值只在这一幕优先。</p>${p?.templateId===t.id?variableEditor(planFrameOverrides(p,frame).variables||[],'scene',p.id):'<p class="help">先为当前画册选择这套分镜，即可添加单幕覆盖。</p>'}</details><details class="advanced-details"><summary>${icon('settings')}高级选项：负向词与渲染覆盖</summary>${field('负向提示词（留空则继承）',`<textarea data-v3-frame="negative" style="min-height:70px">${esc(shown.negative||'')}</textarea>`)}<label class="row small soft" style="margin:15px 0"><input type="checkbox" id="v3-render-override" ${shown.renderOverride?'checked':''}>启用此幕渲染规格覆盖</label><p class="help">默认关闭，保持工作流中的原始参数。启用后，只有已映射为“分镜参数”的输入项会接收这些值。</p>${shown.renderOverride?`<div class="editor-options">${[['width','宽度',256,4096,64],['height','高度',256,4096,64],['steps','采样步数',1,150,1],['cfg','CFG',0,30,.1],['denoise','Denoise',0,1,.05],['seed','Seed / -1 随机',-1,9007199254740991,1]].map(([k,l,min,max,step])=>field(l,input(k,shown[k]??makeFrame()[k],'number',`data-v3-frame="${k}" min="${min}" max="${max}" step="${step}"`))).join('')}</div>`:''}<div style="margin-top:15px">${btn('配置对应节点输入','nodes','v3-settings-tab','data-tab="mapping"','small')}</div></details>${!own?`<details class="advanced-details"><summary>${icon('story')}分镜模板信息</summary>${field('模板名称',input('title',t.title,'text','data-v3-template="title"'))}${field('故事主线',`<textarea data-v3-template="outline" style="min-height:80px">${esc(t.outline)}</textarea>`)}</details>`:''}<div class="scene-mini-preview"><div class="row between"><h3 style="font-size:12px;font-weight:500">当前画册的替换结果</h3>${btn('刷新预览','refresh','v3-refresh-preview','','ghost small')}</div><div id="v3-scene-preview">${p&&p.templateId===t.id?sceneResolvedPreview(p,frame):'<p class="help">选择使用这套分镜的画册计划后，可查看变量替换结果。</p>'}</div></div></section></div>`}


function sceneResolvedPreview(p,f){try{const frame=effectivePlanFrame(p,f),scope=effectivePlanScope(p,f),missing=missingScopeKeys(frame.prompt+' '+frame.caption,scope.values);return `${missing.length?'<div class="scope-warnings">待填写 '+missing.map(k=>'{'+esc(k)+'}').join('、')+'</div>':''}<div class="resolved-preview">${esc(scopeText(frame.prompt,scope.values))}\n\n${esc(scopeText(frame.caption,scope.values))}</div><div class="help">${Object.entries(scope.sources).map(([key,source])=>'{'+esc(key)+'} ← '+esc(source)).join(' · ')}</div>`}catch(e){return '<div class="scope-warnings">'+esc(e.message)+'</div>'}}


function renderCreationQueue(){return `<div class="row wrap" style="margin-bottom:21px"><div class="grow"><h2 style="font-size:17px;font-weight:500;margin:0 0 8px">生成队列</h2><span class="tiny muted">入队后使用当时的分镜、变量和工作流快照，可暂停、继续或增量补齐。</span></div>${btn('开始队列','play','v3-run-queue','','primary')}${btn(rt.paused?'继续':'暂停',rt.paused?'play':'pause','pause-queue')}${btn('中止','stop','interrupt','','danger')}</div><div class="panel table-panel" id="queue-list">${queueHTML()}</div><div class="row" style="margin-top:18px">${btn('查找缺失分镜','refresh','scan-resume','','small')}${btn('查看运行日志','terminal','v3-nav','data-route="logs"','small ghost')}</div>`}


function renderLogsWorkspace(){return `<div class="logs-full">${heading('运行日志','按时间查看生成、连接、保存和审校的真实运行记录。',btn('复制日志','copy','copy-logs')+btn('清空本次显示','trash','v3-clear-logs'),'ACTIVITY / EXECUTION')}<div class="logs-filter"><input id="v3-log-search" placeholder="搜索任务、错误或关键词..." value="${esc(createUI.logsSearch)}" aria-label="搜索运行日志"><select id="v3-log-level">${[['all','全部级别'],['error','错误'],['warn','警告'],['info','普通']].map(x=>opt(...x,createUI.logLevel)).join('')}</select><span class="spacer"></span>${btn('打开生成队列','nodes','v3-create-tab','data-tab="queue"','small')}</div><div class="terminal"><div class="terminal-head">${icon('terminal','sm')}LIVE ACTIVITY<span class="spacer"></span><span id="v3-log-count">${rt.logs.length} 条</span></div><div id="log-body" class="terminal-body"></div></div></div>`}


function renderNodeBrowser(){const workflow=state.settings.comfy.workflow,search=createUI.nodeSearch.toLowerCase();return `<aside class="mapping-browser"><input id="v3-node-search" value="${esc(createUI.nodeSearch)}" placeholder="搜索节点 / LoRA / 字段..." aria-label="搜索工作流节点"><div id="v3-node-results">${nodeBrowserItems(workflow,search)}</div></aside>`}


function nodeBrowserItems(workflow,search){return Object.entries(workflow).filter(([id,n])=>(id+' '+n.class_type+' '+(n._meta?.title||'')+' '+Object.keys(n.inputs).join(' ')).toLowerCase().includes(search)).map(([id,n])=>`<details class="node-group" ${search?'open':''}><summary>#${esc(id)} · ${esc(n._meta?.title||n.class_type)}<small>${esc(n.class_type)}</small></summary>${workflowInputEntries(n,workflow).map(entry=>`<div class="node-input-item"><span class="grow ${entry.link?'linked':''}" title="${esc(JSON.stringify(entry.value))}">${esc(entry.label)} <span style="opacity:.5">${entry.link?'连线':entry.type}</span></span>${ibtn('plus','v3-expose-input',entry.link?'将此连线添加为待确认映射':'添加此字段到映射表',`data-node="${esc(id)}" data-path="${esc(entry.path)}"`)}</div>`).join('')}</details>`).join('')||'<div class="mapping-list-empty">未找到匹配节点。</div>'}


function renderMappingRule(binding,index){const w=state.settings.comfy.workflow,n=w[binding.nodeId],valid=bindingRowValidity(binding),fieldId='field-'+binding.id,fields=n?workflowInputEntries(n,w):[];return `<article class="mapping-rule"><div class="mapping-rule-title"><input type="checkbox" data-v3-binding="enabled" data-id="${binding.id}" ${binding.enabled?'checked':''} aria-label="启用映射 ${esc(binding.label)}"><span class="mono tiny muted">${pad(index+1)}</span>${input('label',binding.label,'text',`data-v3-binding="label" data-id="${binding.id}" aria-label="映射显示名称"`)}${ibtn('trash','v3-remove-binding','仅删除映射项，不删除原工作流节点',`data-id="${binding.id}"`)}</div><div class="mapping-target">${field('节点 ID（可手动填）',input('nodeId',binding.nodeId,'text',`data-v3-binding="nodeId" data-id="${binding.id}" list="v3-node-ids" placeholder="例如 42"`))}${field('输入字段 / 路径',input('path',binding.path,'text',`data-v3-binding="path" data-id="${binding.id}" list="${fieldId}" placeholder="text 或 /loras/0/strength"`))}${field('值类型',`<select data-v3-binding="type" data-id="${binding.id}">${Object.entries(bindingTypes).map(x=>opt(...x,binding.type)).join('')}</select>`)}</div><datalist id="${fieldId}">${fields.map(f=>`<option value="${esc(f.path.slice(1).includes('/')?f.path:f.path.slice(1))}">${esc(f.type+(f.link?' / 连线':''))}</option>`).join('')}</datalist><div class="mapping-source">${field('值从哪里来？',`<select data-v3-binding="source" data-id="${binding.id}">${Object.entries(bindingSources).map(x=>opt(...x,binding.source)).join('')}</select>`)}${['literal','variable','sceneParameter'].includes(binding.source)?field(binding.source==='variable'?'变量名（任意自定义变量）':binding.source==='sceneParameter'?'分镜参数名':'自定义内容（支持 {变量名}）',binding.source==='literal'&&binding.type==='json'?`<textarea data-v3-binding="value" data-id="${binding.id}" spellcheck="false">${esc(binding.value)}</textarea>`:input('value',binding.value,'text',`data-v3-binding="value" data-id="${binding.id}" ${binding.source==='sceneParameter'?'list="v3-render-parameters"':''} placeholder="${binding.source==='variable'?'例如 lora_strength':binding.source==='sceneParameter'?'例如 width / steps':'固定值或 {变量名}'}"`)):`<div class="mapping-resolved" style="padding-top:22px">${binding.source==='sceneParameter'?'只有单幕高级覆盖开启时生效。':'此来源会按每一幕自动传入，无需重复填写。'}</div>`}</div><div class="mapping-resolved ${valid.ok?'':'danger'}">${valid.ok?icon('check','sm'):icon('help','sm')} ${esc(valid.text)}</div>${binding.warning?`<div class="mapping-warning">${esc(binding.warning)}</div>`:''}<details class="advanced-details" style="margin-top:12px;padding-top:10px"><summary>${icon('settings')}映射高级控制</summary><div class="row wrap"><label class="row tiny soft"><input type="checkbox" data-v3-binding="allowCreate" data-id="${binding.id}" ${binding.allowCreate?'checked':''}>允许新增此可选输入字段</label><label class="row tiny soft"><input type="checkbox" data-v3-binding="allowLink" data-id="${binding.id}" ${binding.allowLink?'checked':''}>允许覆盖原节点连线</label>${['positive','negative'].includes(binding.source)?btn('重新识别文本字段','refresh','v3-infer-field',`data-id="${binding.id}"`,'small'):''}</div><p class="help">JSON 路径以 / 开头，支持嵌套对象和数组。覆盖连线会改变拓扑，请仅在明确知道节点要求时开启。</p></details></article>`}


function renderSmartMapper(){const c=state.settings.comfy;return `<section class="mapping-page"><div class="row between"><div><h2>智能节点映射</h2><p class="help">让工作流里的每一个可配置输入，都成为你的创作参数。无需修改项目源码。</p></div><span class="mapping-stats">${Object.keys(c.workflow).length} NODES / ${c.bindings.length} BINDINGS</span></div><div class="mapping-toolbar">${btn('导入工作流 JSON','upload','v3-import-workflow')}${btn('从节点定义读取字段','refresh','v3-read-object-info')}${btn('导入映射包','upload','v3-import-mapping')}${btn('导出映射包','download','v3-export-mapping')}<span class="spacer"></span>${btn('添加映射项','plus','v3-add-binding','','primary')}</div><div class="plan-context-grid">${field('工作流名称',input('workflowTitle',c.workflowTitle,'text','data-setting="comfy.workflowTitle"'))}${field('结果图片节点（可手动输入，留空自动查找）',input('outputNodeId',c.outputNodeId||'','text','data-v3-output="true" list="v3-node-ids" placeholder="例如 9 / SaveImage"'))}</div><datalist id="v3-node-ids">${Object.entries(c.workflow).map(([id,n])=>`<option value="${esc(id)}">${esc(n._meta?.title||n.class_type)}</option>`).join('')}</datalist><datalist id="v3-render-parameters">${['width','height','steps','cfg','denoise','seed'].map(k=>`<option value="${k}"></option>`).join('')}</datalist><div class="scope-explain">${icon('nodes')}<span>示例：LoRA 管理器 #42 → <code>/loras/0/strength</code> → 读取变量 <code>lora_strength</code>。原工作流仍然保留全部未知节点与连接；这里只覆写你启用的输入项。</span></div><div class="mapping-layout">${renderNodeBrowser()}<section>${c.bindings.map(renderMappingRule).join('')||'<div class="mapping-list-empty">从左侧节点添加字段，或手动建立映射。没有任何必填的固定节点类型。</div>'}<div class="row wrap" style="padding-top:21px">${btn('添加映射项','plus','v3-add-binding')}${btn('自动识别正负提示词','spark','v3-auto-bind')}${btn('配置高级分镜参数','settings','v3-add-render-mappings','','small')}</div></section></div><div class="divider"></div><div class="row wrap"><label class="row small soft"><input type="checkbox" id="v3-randomize-seeds" ${c.randomizeSeeds?'checked':''}>每次任务随机化蓝图中的种子</label><span class="spacer"></span>${btn('查看实际提交 JSON','eye','v3-preview-workflow')}${btn('一帧试跑','play','v3-mapping-dry','','primary')}${btn('编辑完整蓝图','edit','edit-workflow','','small')}</div><div class="help">默认保留工作流的尺寸、采样器、CFG 与 LoRA 参数。高级分镜参数只有你启用并映射后才会覆盖。</div><div id="dry-preview" class="preview-box" style="margin-top:18px;min-height:110px">${rt.preview?imgTag(rt.preview,'试跑结果'):'试跑结果将显示在这里。连接地址集中在“服务连接”设置，不在本页面重复配置。'}</div></section>`}


async function previewMappedSubmission(){const p=selectedPlan();if(!p)throw Error('先创建画册计划，填写变量后预览真实提交。');const t=templateBy(p.templateId);if(!t)throw Error('画册计划还没有选分镜。');const row=planRuntimeRow(p),frame=effectivePlanFrame(p,t.frames[clamp(ui.frameIndex,0,t.frames.length-1)]),compiled=buildMappedWorkflow(frame,row,{execution:mappedExecutionSnapshot(),preview:true});modal('工作流提交预览',`<p class="help">${esc(p.title)} · 只预览，不提交 GPU。随机种子用固定示例值展示。</p><div class="notice">已覆写 ${compiled.changes.length} 项。未映射或关闭的字段保持原工作流值。</div><pre class="mapping-preview-code">${esc(JSON.stringify(compiled.workflow,null,2))}</pre><div class="modal-footer">${btn('复制 JSON','copy','v3-copy-submission')}${btn('关闭','','close-modal','','primary')}</div>`,'先检查最终参数，再开始生成。',true);createUI.lastSubmission=compiled.workflow}


async function mappedDryRun(){const p=selectedPlan(),t=p?templateBy(p.templateId):currentTemplate();if(!t)throw Error('请先创建分镜。');const row=p?planRuntimeRow(p):projectRows()[0];if(!row)throw Error('请先创建一个画册计划。');const f=p?effectivePlanFrame(p,t.frames[0]):clone(t.frames[0]);f._execution=mappedExecutionSnapshot();createUI.dryController=new AbortController();const area=$('#dry-preview');if(area)area.innerHTML='<p><i class="dot live"></i> 正在验证映射并生成一帧...</p>';try{const result=await generateFrame(f,row,createUI.dryController.signal,0);rt.preview=result.image;if($('#dry-preview'))$('#dry-preview').innerHTML=imgTag(result.image,'通用映射试跑结果');toast(result.offlineFallback?'真实服务失败，当前显示明确标记的离线降级图。':'映射试跑完成。')}catch(e){if($('#dry-preview'))$('#dry-preview').textContent=e.message;throw e}finally{createUI.dryController=null}}


function renderPythonSettings(){const c=backendConfig();return `<section class="settings-section"><h2>Python 后端与保存</h2><p>有本地后端时，不需要逐次选择文件夹。配置你现有的读取和保存接口，由 Python 负责落盘和目录管理。</p><div class="service-context"><strong id="v3-backend-status">${esc(backendStatusText())}</strong><br>不会猜测或写入未知接口；成功读取并确认连接后才开启自动保存。</div><div class="divider"></div>${field('Python 服务地址',input('baseUrl',c.baseUrl,'text','data-v3-backend="baseUrl" placeholder="留空使用当前页面同源，或 http://127.0.0.1:8000"'))}<div class="backend-paths">${field('读取接口（GET）',input('loadPath',c.loadPath,'text','data-v3-backend="loadPath" list="v3-backend-reads" placeholder="填写已有接口，例如 /api/workspace"'))}${field('保存接口',input('savePath',c.savePath,'text','data-v3-backend="savePath" list="v3-backend-writes" placeholder="填写已有接口，例如 /api/workspace"'))}${field('保存方法',`<select data-v3-backend="method">${opt('PUT','PUT',c.method)}${opt('POST','POST',c.method)}</select>`)}${field('请求中的工程字段',input('payloadField',c.payloadField,'text','data-v3-backend="payloadField" placeholder="state；留空直接发送工程 JSON"'))}${field('响应中的工程字段',input('responseField',c.responseField,'text','data-v3-backend="responseField" placeholder="state；留空读取整个响应"'))}${field('会话访问令牌（可选）',input('token',createUI.backendToken||'','password','id="v3-backend-token" autocomplete="off"'))}</div><datalist id="v3-backend-reads">${(createUI.backendReads||[]).map(p=>`<option value="${esc(p)}"></option>`).join('')}</datalist><datalist id="v3-backend-writes">${(createUI.backendWrites||[]).map(p=>`<option value="${esc(p)}"></option>`).join('')}</datalist><div class="row wrap">${btn('读取接口说明','search','v3-read-openapi')}${btn('读取并连接后端','link','v3-connect-backend','','primary')}${btn('立即保存','disk','v3-save-backend',backendRuntime.connected?'':'disabled')}${backendRuntime.connected?btn('断开自动保存','stop','v3-disconnect-backend','','small'):''}</div><div class="help">“读取接口说明”仅尝试 GET /openapi.json，并将已声明的路径放入建议列表；不主动调用写入接口。</div><details class="advanced-details"><summary>${icon('terminal')}接口约定示例与兼容说明</summary><pre class="backend-code">读取响应：{ "state": 完整工程对象, "revision": "可选版本号" }
空工作室：{ "state": null }
保存请求：{ "state": 完整工程对象 }
保存确认：{ "ok": true, "revision": "可选版本号" } 或 HTTP 204

工程字段可配置为空或其他字段名。
如果后端返回 ETag，保存时自动发送 If-Match 防止并发覆盖。
实际的 图片 / 画册 / 企划 文件结构由已有 Python 后端实现。</pre><p class="help">当前项目没有 Python 源码可供自动适配。如果你的接口使用不同结构，请按实际后端填写。连接未测试通过前，状态栏会保留“临时会话”提醒。</p></details></section><section class="settings-section"><h2>生成服务</h2><p>这里集中管理连接地址。智能节点映射页面只负责输入参数，不再重复连接设置。</p><div class="plan-context-grid">${field('图像生成模式',`<select data-setting="comfy.mode">${opt('mock','离线 SVG 预览',state.settings.comfy.mode)}${opt('real','真实 ComfyUI',state.settings.comfy.mode)}</select>`)}${field('ComfyUI 地址',setting('comfy.baseUrl',state.settings.comfy.baseUrl))}</div><div class="row wrap">${btn('测试 ComfyUI','refresh','test-engine')}${btn('配置智能节点映射','nodes','v3-settings-tab','data-tab="mapping"')}${btn('AI 模型连接','spark','llm-settings')}</div><label class="row small soft" style="margin-top:19px"><input type="checkbox" data-setting="comfy.autoFallback" ${state.settings.comfy.autoFallback?'checked':''}>真实 ComfyUI 不可用时，显示明确标记的离线降级图</label></section><section class="settings-section"><h2>便携备份</h2><p>即使尚未连接 Python，也可以下载当前工程。高级浏览器目录写入保留为备用，不再是首次使用的必经步骤。</p><div class="row wrap">${btn('工程 JSON','download','backup-export')}${btn('目录 ZIP','folder','disk-archive')}${btn('从工程恢复','upload','import-project')}${btn('备用目录保存','settings','v3-browser-storage','','small')}</div></section>`}


function routeLabel(){return ui.workspace===0?'我的画册':ui.workspace===1?'创作画册':ui.workspace===6?'运行日志':ui.workspace===4?'AI 写故事':'设置'}


function primaryNavItems(){return [[0,'book','我的画册','1'],[1,'story','创作画册','2'],...(state.settings.studio.visibility.logs?[[6,'terminal','运行日志','3']]:[]),...(state.settings.studio.visibility.llm?[[4,'spark','AI 写故事','4']]:[]),[5,'settings','设置',',']]}


function renderQuietShell(){
  ensureStudioState();const collapsed=innerWidth<760||!!state.settings.studio.shell.collapsed;document.documentElement.dataset.navCollapsed=String(collapsed);
  $('#sidebar').innerHTML=`<a class="brand" href="#books" data-act="v3-nav" data-route="books"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><div class="brand-text"><div class="brand-name">Mio</div><div class="brand-sub">STUDIO <span>v3.0</span></div></div></a><button class="side-search" data-act="command" aria-label="搜索和快捷操作">${icon('search')}<span class="grow">搜索与快速操作</span><kbd class="kbd">⌘ K</kbd></button><nav class="nav-list" aria-label="主要功能">${primaryNavItems().map(([id,ic,label,key])=>`<button class="nav-item ${ui.workspace===id?'active':''} ${id===5?'nav-settings':''}" data-act="v3-nav" data-route="${({0:'books',1:'create',6:'logs',4:'writing',5:'settings'})[id]}" title="${label}" aria-label="${label}" ${ui.workspace===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span><b class="nav-key">${key}</b></button>`).join('')}</nav><div class="spacer"></div><button class="nav-collapse" data-act="v3-collapse-nav" aria-label="${collapsed?'展开':'折叠'}侧栏">${icon(collapsed?'arrow':'list')}<span>折叠侧栏</span></button><div class="profile"><button class="workspace-profile-button" data-act="profile-settings" aria-label="修改工作室名称"><span class="avatar">${esc([...workspaceName()][0])}</span><span class="grow"><strong>${esc(workspaceName())}</strong><p>PRIVATE WORKSPACE</p></span></button></div>`;
  $('#topbar').innerHTML=`<button id="project-switch-button" class="project-switch" data-act="project-toggle" aria-haspopup="menu" aria-expanded="false" aria-controls="project-popover">${icon('folder','sm')}<span class="project-switch-name">${esc(project().title)}</span>${icon('down','sm')}</button><div class="top-separator"></div><div class="breadcrumb"><strong>${routeLabel()}</strong></div><span class="spacer"></span><span class="tiny muted">${state.settings.comfy.mode==='mock'?'本地预览模式':rt.connected?'ComfyUI 已连接':'ComfyUI 待连接'}</span><button class="top-queue" data-act="v3-create-tab" data-tab="queue">${icon('nodes','sm')}队列 <b>${state.queue.filter(q=>['pending','running','paused'].includes(q.status)).length}</b></button>${ibtn('sun','theme','切换界面主题')}${ibtn('help','v3-resources','工具、模板和使用帮助')}`;
  if(detailUI.projectOpen)renderProjectPopover();renderAssistantOrb();applyStudioPreferences();renderStatus();
}


function renderAssistantOrb(){
  const orb=$('.assistant-launch');orb.classList.add('assistant-orb');orb.innerHTML=icon('spark')+'<span class="orb-copy"><strong>分镜精修助手</strong><small>用自然语言改提示词与台词</small></span>';orb.setAttribute('aria-label','拖动悬浮球，点击打开分镜精修助手');orb.hidden=!featureEnabled('assistant');
  if(!orb.dataset.orbInitialized){orb.dataset.orbInitialized='true';const p=state.settings.studio.shell.orbPosition;if(p){orb.style.right=clamp(p.right,12,innerWidth-58)+'px';orb.style.bottom=clamp(p.bottom,40,innerHeight-60)+'px'}
    orb.addEventListener('pointerdown',e=>{if(e.button!==0)return;const start={x:e.clientX,y:e.clientY,right:innerWidth-orb.getBoundingClientRect().right,bottom:innerHeight-orb.getBoundingClientRect().bottom};let moved=false;orb.setPointerCapture(e.pointerId);orb.onpointermove=event=>{const dx=event.clientX-start.x,dy=event.clientY-start.y;if(!moved&&Math.hypot(dx,dy)<5)return;moved=true;createUI.orbDragging=true;orb.classList.add('orb-dragging');orb.style.right=clamp(start.right-dx,12,Math.max(12,innerWidth-58))+'px';orb.style.bottom=clamp(start.bottom-dy,40,Math.max(40,innerHeight-58))+'px';orb.style.left='auto';orb.style.top='auto'};orb.onpointerup=orb.onpointercancel=()=>{orb.onpointermove=null;orb.classList.remove('orb-dragging');createUI.orbDragging=false;if(moved){createUI.orbIgnoreClick=true;state.settings.studio.shell.orbPosition={right:parseFloat(orb.style.right)||20,bottom:parseFloat(orb.style.bottom)||48};save();setTimeout(()=>createUI.orbIgnoreClick=false,100)}}});
    orb.addEventListener('pointerenter',()=>{if(createUI.orbDragging)return;const right=parseFloat(orb.style.right)||27;createUI.orbHoverRight=right;orb.style.right=clamp(right,12,Math.max(12,innerWidth-222))+'px'});orb.addEventListener('pointerleave',()=>{if(createUI.orbDragging)return;const right=state.settings.studio.shell.orbPosition?.right??createUI.orbHoverRight??27;orb.style.right=clamp(right,12,Math.max(12,innerWidth-58))+'px'});
  }
}


function renderV3Modules(){const p=state.settings.studio;return `<section class="settings-section"><h2>只留下你需要的功能</h2><p>画册与创作是核心功能，始终保留。其他模块可以按需开启，隐藏不会删除历史作品。</p>${settingsRow('我的画册','阅读、精修和导出已生成的画册。','<span class="tiny muted">核心功能</span>','book')}${settingsRow('创作画册','画册计划、分镜、变量素材和生成队列收纳在一个工作区。','<span class="tiny muted">核心功能</span>','story')}${settingsRow('运行日志','独立查看生成、连接、保存与审校的运行过程。',switchControl('visibility.logs','显示运行日志',p.visibility.logs),'terminal')}${settingsRow('AI 写故事','可选功能：把想法写成剧情台词或分镜初稿。默认关闭，不影响普通生成。',switchControl('visibility.llm','启用 AI 写故事',p.visibility.llm),'spark')}</section><section class="settings-section"><h2>辅助工具</h2>${settingsRow('悬浮精修助手','可拖动的小悬浮球；悬停展开说明，点击对话。只修改源分镜模板。',switchControl('features.assistant','显示悬浮助手',p.features.assistant),'spark')}${settingsRow('视觉审校','连接支持图片输入的模型，检查真实画面并给出修改建议。',switchControl('features.visualCritic','启用视觉审校',p.features.visualCritic),'shield')}${settingsRow('模板与扩展市场','从设置中的“工具与资源”进入，不再占用主侧栏。',switchControl('features.marketplace','启用模板市场',p.features.marketplace),'box')}</section>`}


function renderResourceHub(){const items=[['book','画册导出模板','设计 HTML/CSS 阅读版式，不改变源画面与台词。','et-open-library'],['box','模板与插件市场','安装或导入分镜、画册版式与工作流。','market'],['upload','GitHub 托管','上传或安装可复用模板，不上传私有工程。','github-open'],['help','快速开始教程','从创作计划到生成画册，含本地三幕练习。','guide-open'],['disk','工程备份与恢复','下载工程 JSON 或便携目录包。','backup'],['shield','系统自检','检查变量、通用映射、模板和页面边界。','v3-diagnostics']];return `<section class="settings-section"><h2>工具与资源</h2><p>低频工具集中在这里，主侧栏只保留日常创作入口。</p><div class="resources-list">${items.filter(x=>x[3]!=='market'||featureEnabled('marketplace')).map(([ic,title,text,a])=>`<button class="resource-link" data-act="${a}">${icon(ic)}<span class="grow"><strong>${title}</strong><small>${text}</small></span>${icon('arrow','sm')}</button>`).join('')}</div></section>`}


function renderCurrentIdentity(){const identity=state.settings.identity;return `<section class="settings-section"><h2>你的工作室</h2><p>名称显示在工作室侧栏。随时可以修改，不改变已有企划、画册或变量素材。</p>${field('工作室名称',input('workspaceName',identity.workspaceName,'text','id="identity-workspace" maxlength="40"'))}${field('创作者署名',input('creatorName',identity.creatorName||'','text','id="identity-creator" maxlength="60"'))}<label class="row small soft" style="margin-bottom:19px"><input id="identity-sync-signature" type="checkbox" checked>同时更新默认画册签名</label>${btn('保存名称与署名','check','identity-save','','primary')}</section><section class="settings-section"><h2>当前保存方式</h2><p>使用已有 Python 后端时，由服务负责保存与文件夹管理，不需要浏览器目录授权。</p><div class="service-context">${esc(backendStatusText())}</div><div class="row" style="margin-top:17px">${btn('配置服务与保存','disk','v3-settings-tab','data-tab="connections"')}${btn('导出备份','download','backup-export')}</div></section>`}


function renderSimpleSettings(){
  const tab=studioUI.settingsTab,tabs=[['general','users','工作室'],['modules','grid','功能开关'],['appearance','sun','外观与阅读'],['connections','disk','服务与保存'],['critic','shield','视觉审校'],['resources','box','工具与资源']];
  let content='';if(tab==='mapping')content=renderSmartMapper();else if(tab==='connections'||tab==='storage')content=renderPythonSettings();else if(tab==='modules')content=renderV3Modules();else if(tab==='resources')content=renderResourceHub();else if(tab==='general')content=renderCurrentIdentity();else if(tab==='critic')content=criticSettingsSummary();else if(tab==='github')content=githubSummarySettings();else if(tab==='guide')content=quickStartSettings();else if(tab==='appearance'||tab==='export'){const markup=v3Core.renderSettingsWorkspace(),inert=document.createElement('template');inert.innerHTML=markup;content=[...inert.content.querySelectorAll('#studio-settings-content > .settings-section')].map(x=>x.outerHTML).join('')}else content=renderResourceHub();
  return `${heading('设置','创作流程由你定义，工具保持安静。','','SETTINGS / WORKSPACE')}<div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${tabs.map(([id,ic,label])=>`<button class="${id===tab||id==='connections'&&tab==='storage'?'active':''}" data-act="v3-settings-tab" data-tab="${id}">${icon(ic,'sm')}${label}</button>`).join('')}</nav><div id="studio-settings-content">${content}</div></div>`;
}


function renderWritingWorkspace(){return `${heading('AI 写故事','把故事想法整理成台词与分镜初稿；不负责生成图片。',btn('配置文本模型','settings','llm-settings'),'OPTIONAL / STORY WRITING')}<div class="ai-writing-intro"><strong>这个工具能做什么？</strong>选择一份画册计划和它的分镜，输入剧情方向，AI 会逐幕生成旁白或对白，并保存为独立剧情版本。你可以人工修改后再生成画面。<br>这不是必需步骤：直接在“创作画册”中写提示词和台词，也能完成所有生成。</div><div id="v3-writing-inner">${v3Core.renderStoryStudio()}</div>`}


function displayV3(){
  ensureStudioState();if(ui.workspace===2){ui.workspace=1;createUI.tab='queue'}if(ui.workspace===3){ui.workspace=5;studioUI.settingsTab='mapping'}if(ui.workspace===4&&!state.settings.studio.visibility.llm)ui.workspace=1;if(ui.workspace===6&&!state.settings.studio.visibility.logs)ui.workspace=0;
  renderShell();let content;
  if(ui.workspace===0)content=v3Core.renderGallery().replace('画廊展厅','我的画册').replace('YOUR STORIES, FRAME BY FRAME.','YOUR BOOKS / PRIVATE COLLECTION');
  else if(ui.workspace===1)content=renderCreationWorkspace();else if(ui.workspace===6)content=renderLogsWorkspace();else if(ui.workspace===4)content=renderWritingWorkspace();else content=renderSimpleSettings();
  $('#main').innerHTML='<div class="view">'+content+'</div>';delete $('#main').dataset.editorTemplateId;delete $('#main').dataset.editorFrameIndex;
  if(ui.workspace===1&&createUI.tab==='plans'){const p=selectedPlan(),context=$('.plan-context-grid');if(p&&context){const versions=rowBy(p.rowId)?.storyVersions?.[p.templateId]||[];context.insertAdjacentHTML('afterend',field('台词来源',`<select id="v3-story-source" aria-label="画册台词来源">${opt('','使用分镜默认台词',p.storyVersionId||'')}${versions.map(v=>opt(v.id,v.title,p.storyVersionId)).join('')}</select>`,'本册单幕台词覆盖的优先级最高。默认不会让旧的 AI 剧情覆盖你的新编辑。'))}}
  if(ui.workspace===4){const old=$('#v3-writing-inner .page-heading');if(old)old.remove();const r=rowBy(ui.storyRowId);if(r){const p=state.creation.plans.find(p=>p.rowId===r.id);if(p){try{r._scope=effectivePlanScope(p).values;const names=resolveCharacterNames(r._scope);r.character=names.promptName;r.character_display_name=names.displayName}catch(e){}}}const select=$('#story-row');if(select){select.innerHTML=projectPlans().map(p=>opt(p.rowId,p.title,p.rowId===ui.storyRowId?p.rowId:'')).join('');const label=select.closest('.field')?.querySelector('.label');if(label)label.textContent='目标画册计划'}}
  applyArtworkRatios();applyStudioPreferences();if(ui.workspace===6){const terminal=$('.terminal');if(terminal)terminal.hidden=false;renderLogs()}if(!$('#assistant').hidden)renderAssistant();
}


function navigateV3(index){flushEditor();const n=Number(index);if(n===2){createUI.tab='queue';ui.workspace=1}else if(n===3){studioUI.settingsTab='mapping';ui.workspace=5}else if([0,1,4,5,6].includes(n)){if(n===4&&!state.settings.studio.visibility.llm){toast('AI 写故事默认关闭，可在“设置 → 功能开关”中启用。');return}ui.workspace=n}render();window.scrollTo({top:0,behavior:'instant'})}


function nameFirstWelcome(){
  const id=state.settings.identity;createUI.welcomePending=true;if($('#guide-dialog').open)$('#guide-dialog').close();
  $('#welcome-dialog').innerHTML=`<div class="welcome-content"><div class="welcome-brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Mio<span class="spacer"></span><span class="utility-caption">A SPACE FOR YOUR STORIES</span></div><h1 id="welcome-title">先认识你的工作室。</h1><p class="welcome-description">给自己的创作空间取个名字。后端连接和使用教程都可以稍后在设置里处理，不会挡住你开始创作。</p>${field('工作室名称',input('name',id.workspaceName||'','text','id="welcome-name" maxlength="40" placeholder="例如：纸间漫画工作室" aria-label="工作室名称"'))}${field('创作者署名（可选）',input('creator',id.creatorName||'','text','id="welcome-creator" maxlength="60" placeholder="你的名字或笔名"'))}<div class="welcome-foot">${btn('先用默认名称','','v3-welcome-default')}${btn('进入工作室','arrow','v3-welcome-enter','','primary')}</div><p class="help" style="margin-top:16px">默认名称为“我的工作室”。之后可以随时在设置中修改。教程不会在命名之前自动弹出。</p></div>`;
  if(!$('#welcome-dialog').open)$('#welcome-dialog').showModal();setTimeout(()=>$('#welcome-name')?.focus(),50);
}


function finishNameFirst(useDefault=false){const text=$('#welcome-name')?.value.trim()||'',creator=$('#welcome-creator')?.value.trim()||'';if(!useDefault&&!text)throw Error('请填写工作室名称，或点击“先用默认名称”。');state.settings.identity={workspaceName:text||(useDefault?'我的工作室':''),creatorName:creator,onboarded:true};state.settings.signature=creator||state.settings.identity.workspaceName;rememberProfile();createUI.welcomePending=false;$('#welcome-dialog').close();save();render();toast('欢迎来到你的工作室。教程和服务连接都在设置里。')}


function renderPersistentProjectMenu(){const menu=$('#project-popover'),trigger=$('#project-switch-button');if(!trigger)return;menu.innerHTML=`<div class="project-popover-label row">切换企划<span class="spacer"></span>${ibtn('close','v3-project-close','关闭企划菜单')}</div>${state.projects.map(p=>`<button class="project-choice" role="menuitem" data-act="project" data-id="${p.id}" aria-current="${p.id===state.activeProjectId}">${icon('folder','sm')}<span class="grow"><strong>${esc(p.title)}</strong><small>${state.creation.plans.filter(x=>x.projectId===p.id).length} 个计划 · ${state.books.filter(b=>b.projectId===p.id).length} 本画册</small></span></button>`).join('')}<button class="project-new" data-act="new-project">${icon('plus','sm')}新建企划</button><button class="project-choice" data-act="project-rename">${icon('edit','sm')}重命名当前企划</button>`;const r=trigger.getBoundingClientRect();menu.style.left=clamp(r.left,12,Math.max(12,innerWidth-312))+'px';menu.style.top=(r.bottom+7)+'px';menu.hidden=false;trigger.setAttribute('aria-expanded','true');detailUI.projectOpen=true;}


function commandIndexV3(query){
  const all=[
    {title:'画册集',type:'主功能',icon:'book',run:()=>navigate(0)},
    {title:'创作画册',type:'主功能',icon:'story',run:()=>navigate(1)},
    {title:'设置',type:'主功能',icon:'settings',run:()=>navigate(5)},
    {title:'工作流配置',type:'设置',icon:'nodes',run:()=>{studioUI.settingsTab='mapping';navigate(5)}},
    {title:'扩展功能',type:'主功能',icon:'nodes',run:()=>navigate(7)},
    {title:'工具与资源',type:'设置',icon:'box',run:()=>{studioUI.settingsTab='resources';navigate(5)}},
    {title:'快速开始教程',type:'帮助',icon:'help',run:()=>openQuickStart(0)}
  ];
  if(state.settings.studio.visibility.logs)all.push({title:'运行日志',type:'主功能',icon:'terminal',run:()=>navigate(6)});
  if(state.settings.studio.visibility.llm)all.push({title:'AI 写故事',type:'可选工具',icon:'spark',run:()=>navigate(4)});
  for(const p of state.creation.plans)all.push({title:p.title,type:'画册草稿',icon:'story',run:()=>{changeProject(p.projectId);createUI.planId=p.id;createUI.tab='plans';navigate(1)}});
  for(const b of state.books)all.push({title:b.title,type:'已生成画册',icon:'book',run:()=>openReader(b.id)});
  for(const t of state.templates)all.push({title:t.title,type:'分镜模板',icon:'story',run:()=>{changeProject(t.projectId);ui.templateId=t.id;createUI.tab='scenes';navigate(1)}});
  rt.commandItems=all.filter(x=>(x.title+' '+x.type+' '+localeString(x.title)).toLowerCase().includes(query.toLowerCase())).slice(0,50);
  rt.commandIndex=clamp(rt.commandIndex,0,Math.max(0,rt.commandItems.length-1));
  $('#command-results').innerHTML=rt.commandItems.map((x,i)=>`<button class="command-item ${i===rt.commandIndex?'active':''}" data-act="run-command" data-index="${i}">${icon(x.icon)}<span>${esc(x.title)}</span><small>${esc(x.type)}</small></button>`).join('')||'<div class="empty">没有匹配结果。</div>';
}


function refreshCreationPreviews(){const p=selectedPlan();if(!p)return;const plan=$('#v3-plan-preview');if(plan)plan.innerHTML=renderPlanPreview(p);const t=currentTemplate(),f=t?.frames[ui.frameIndex],scene=$('#v3-scene-preview');if(scene&&f)scene.innerHTML=sceneResolvedPreview(p,f)}


function renderVariableChooser(){const p=selectedPlan();if(!p)throw Error('请先创建画册计划。');modal('为「'+p.title+'」选择素材',`<p class="help">勾选的素材按当前顺序合并。之后可以在计划中调整优先级。</p>${projectVariableSets().map(s=>`<label class="variable-source-row"><input type="checkbox" data-v3-choose-set="${s.id}" ${p.variableSetIds.includes(s.id)?'checked':''}><span class="grow"><strong>${esc(s.title)}</strong><small>${s.entries.map(e=>'{'+esc(e.key)+'}').join(' · ')||'空素材'}</small></span></label>`).join('')||'<p class="help">还没有可复用素材。可以先创建素材，也可直接为本册添加变量。</p>'}<div class="modal-footer">${btn('完成选择','check','v3-close-chooser','','primary')}</div>`,'只改变当前画册引用，不复制或覆盖素材本身。')}


function addVariable(group,id){textModal('添加自定义变量','变量标识符','',key=>{checkVariableKey(key);const entries=variableOwner(group,id);if(!entries)throw Error('变量作用域已不存在。');if(entries.some(e=>e.key===key))throw Error('当前作用域已经有 {'+key+'}，请直接编辑原值。');entries.push(variableEntry(key,''));save();closeModal();render();if(group==='scene')$$('.advanced-details').find(e=>e.querySelector('summary')?.textContent.includes('变量覆盖'))?.setAttribute('open','')},'例如 character、mood、lora_strength。所有变量均可删除，没有固定列。')}


async function importGenericWorkflowLink(){const raw=$('#raw-url')?.value.trim();if(!raw)throw Error('请填写资源链接。');let url=new URL(raw);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('请输入可信的 HTTP(S) 地址。');if(url.hostname==='github.com'&&url.pathname.includes('/blob/'))url=new URL('https://raw.githubusercontent.com'+url.pathname.replace('/blob/','/'));if(url.hostname==='gitee.com')url.pathname=url.pathname.replace('/blob/','/raw/');const text=await(await request(url.href,{},15000)).text();let data;try{data=JSON.parse(text)}catch(e){return v3Core.importRaw()}if(data.kind!=='comfycomic.workflow-mappings')return v3Core.importRaw();validateBindings(data.bindings);validateWorkflow(data.workflow);if(!await confirmAction('安装通用节点映射包？','将替换当前工作流和映射。已入队任务不受影响，请先备份当前映射。','安装映射包'))return;importWorkflowIntoMapper(data);state.settings.comfy.randomizeSeeds=!!data.randomizeSeeds;save();closeModal()}


/* Source: /js/ui.js */
function installNativeUIModule(){const ns=globalThis.ComfyComic,scenePrevious=renderSceneComposer;renderSceneComposer=function(){const t=currentTemplate();if(t&&!t.frames?.length)return'<div class="empty">'+icon('story')+'<h3>分镜列表为空</h3><p>空模板可以正常保存。添加第一幕后即可编辑和生成，最多支持512幕。</p>'+btn('添加第一幕','plus','add-frame','','primary')+'</div>';return scenePrevious()};const readerPrevious=openReader;openReader=function(id){const b=bookBy(id);if(!b)throw Error('The book no longer exists.');if(!b.totalSteps&&!b.steps?.length){modal(b.title||'空画册','<div class="empty"><h3>还没有分镜</h3><p>这本画册已正常读取，目前没有可阅读的图片。</p></div><div class="modal-footer">'+btn('关闭','','close-modal','','primary')+'</div>');return}return readerPrevious(id)};renderPythonSettings=function(){return'<section class="settings-section"><h2>Python 原生配置同步</h2><p>同源读取和保存已自动配置，无需填写接口路径。</p><div class="service-context"><strong>GET /api/config</strong><br><strong>POST /api/config</strong><br>10 个必填字段顶层平铺，删除时透传 forceWrite。</div><div class="row wrap" style="margin:18px 0">'+btn('重新读取后端','refresh','v3-connect-backend')+btn('立即保存','disk','v3-save-backend','','primary')+'</div><p class="help">'+esc(backendRuntime.error||'新编辑会清除旧网络错误并重新安排保存。未读取成功前不会覆盖后端数据。')+'</p></section><section class="settings-section"><h2>ComfyUI 服务</h2><div class="grid2">'+field('运行模式','<select data-setting="comfy.mode">'+opt('mock','离线预览',state.settings.comfy.mode)+opt('real','真实 ComfyUI',state.settings.comfy.mode)+'</select>')+field('ComfyUI 地址',setting('comfy.baseUrl',state.settings.comfy.baseUrl))+'</div><div class="row">'+btn('测试连接','refresh','test-engine')+btn('智能节点映射','nodes','v3-settings-tab','data-tab="mapping"')+'</div></section>'};const renderPrevious=render;render=function(){const result=renderPrevious();document.querySelectorAll('input[id="story-target"]').forEach(e=>e.max=String(ns.MAX_FRAMES));document.querySelectorAll('[data-v3-binding="allowLink"]').forEach(e=>{e.checked=false;e.disabled=true;e.title='连线禁止被普通文本覆盖，请绑定上游文本节点。'});return result};ns.modules.ui=true}


async function nativeContractDiagnostics(){
  const ns=globalThis.ComfyComic,results=[],test=async(name,fn)=>{try{if(await fn()===false)throw Error('Assertion failed.');results.push({name,passed:true})}catch(e){results.push({name,passed:false,message:e.message})}};
  const empty={templates:[],savedGalleries:{books:[]},batchMatrix:{rows:[]},comfyWorkflows:[],comfyConfig:{},llmConfig:{},xmlConfig:{},chatConfig:{},uiConfig:{},batchRunState:{},updatedAt:1};
  await test('原生平铺10字段，不包装 state',()=>{const p=ns.converters.toApi(ns.converters.fromApi(empty,state),empty);return !Object.hasOwn(p,'state')&&ns.stateContract.requiredFields.every(k=>Object.hasOwn(p,k))});
  await test('空模板、角色和画册不会恢复示例数据',()=>{const s=ns.converters.fromApi(empty,state);return s.templates.length===0&&s.rows.length===0&&s.books.length===0});
  await test('512幕通过，513幕拒绝',()=>{ns.stateContract.assertFrameCount(new Array(512).fill({}));try{ns.stateContract.assertFrameCount(new Array(513).fill({}));return false}catch(e){return true}});
  await test('WeiLin positive 与 SDXL text_g 自动识别',()=>ns.textNodes.detect({inputs:{positive:'',text:['6',0]}}).field==='positive'&&ns.textNodes.detect({inputs:{text_g:'',text_l:''}}).field==='text_g');
  await test('连线数组禁止被普通值覆盖',()=>{try{ns.textNodes.healBinding({enabled:true,source:'literal',nodeId:'1',path:'text',allowLink:true},{'1':{inputs:{text:['6',0]}}});return false}catch(e){return true}});
  await test('新编辑重试 POST，并保留 forceWrite',async()=>{let attempts=0;const sent=[],mock=createNativeConfigSync({contract:ns.stateContract,convert:ns.converters,defaults:()=>state,getState:()=>state,validate:()=>true,enabled:()=>true,fetch:async(_,r)=>{if(r.method==='GET')return{ok:true,status:200,json:async()=>empty};sent.push(JSON.parse(r.body));return++attempts===1?{ok:false,status:503}:{ok:true,status:204}}});await mock.read();mock.markDirty(true);await mock.save();mock.markDirty();if(mock.runtime.error)return false;return await mock.save()&&sent.length===2&&sent.every(p=>p.forceWrite===true)});
  modal('原生接口与512幕回归检查','<div class="notice">使用隔离的模拟 HTTP 响应，不访问 Python 后端。</div>'+results.map(r=>'<div class="template-check-row"><span class="'+(r.passed?'accent':'danger')+'">'+icon(r.passed?'check':'close')+'</span><div class="grow">'+esc(r.name)+(r.message?'<small>'+esc(r.message)+'</small>':'')+'</div></div>').join('')+'<div class="modal-footer">'+btn('关闭','','close-modal','','primary')+'</div>','',true);return results;
}


function installNativeParityChecks(){
  const ns=globalThis.ComfyComic;
  indexSchema.maximum=ns.MAX_FRAMES-1;for(const tool of assistantTools){const frames=tool.function?.parameters?.properties?.frames;if(frames?.type==='array')frames.maxItems=ns.MAX_FRAMES}
  const renderPrevious=render;render=function(){const result=renderPrevious();const count=document.getElementById('xml-count');if(count?.tagName==='SELECT'){const el=document.createElement('input');el.id='xml-count';el.type='number';el.min='1';el.max='512';el.value=count.value||'6';el.setAttribute('aria-label','XML 模板幕数，1至512');count.replaceWith(el)}return result};
  const previous=handleAction;handleAction=async function(action,data={},element){if(action==='native-diagnostics')return nativeContractDiagnostics();const result=await previous(action,data,element);if(['diagnostics','v3-diagnostics','release-diagnostics'].includes(action)&&document.getElementById('modal-body'))document.getElementById('modal-body').insertAdjacentHTML('beforeend','<div class="modal-footer">'+btn('原生 API / 512 幕 / 节点保护','shield','native-diagnostics','','primary')+'</div>');return result};
}


function loadArtTypography(){
  if(state.settings.presentation.fonts===false||document.getElementById('art-font-stylesheet'))return;
  artUI.fontStatus='loading';
  const link=document.createElement('link');link.id='art-font-stylesheet';link.rel='stylesheet';link.href='https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Serif+SC:wght@400;500;600&display=swap';
  link.onload=()=>{artUI.fontStatus='loaded';updateArtFontStatus()};link.onerror=()=>{artUI.fontStatus='fallback';updateArtFontStatus()};document.head.append(link);
}


function updateArtFontStatus(){const label=$('#art-font-status');if(label)label.textContent=artUI.fontStatus==='loaded'?'艺术字体样式已加载，实际字形按需下载并由浏览器缓存。':artUI.fontStatus==='loading'?'正在加载艺术字体；现在仍可使用系统衬线字体。':'艺术字体暂不可用，已使用系统衬线字体，不影响创作与阅读。'}


function promptMarkup(text,values={},definitions=definedPromptNames(values)){return ComfyComic.promptPolicy.tokens(text,definitions).map(part=>part.type==='variable'?`<mark class="${!Object.hasOwn(values,part.key)||values[part.key]===''?'empty-token':''}" data-prompt-variable="${esc(part.key)}">${esc(part.value)}</mark>`:esc(part.value)).join('')}


function currentPromptContext(){const p=selectedPlan(),t=currentTemplate(),f=t?.frames[ui.frameIndex];try{return p&&f?effectivePlanScope(p,f).values:p?effectivePlanScope(p).values:{}}catch(e){return{}}}


function paintPromptEditor(textarea){const wrapper=textarea.closest('.prompt-surface');if(!wrapper)return;const pre=wrapper.querySelector('.prompt-paint'),values=currentPromptContext();pre.innerHTML=promptMarkup(textarea.value,values)+'\n';pre.style.width=textarea.clientWidth+'px';pre.style.transform=`translate(${-textarea.scrollLeft}px,${-textarea.scrollTop}px)`;const hint=wrapper.nextElementSibling?.querySelector('.prompt-hint');if(hint){hint.hidden=!ComfyComic.promptPolicy.hasUnclosedBrace(textarea.value);hint.textContent='提示：有未闭合的花括号。若是变量可检查闭合；若用于提示词权重，请忽略。不会影响生成。'}}


function attachPromptEditors(){
  artUI.editorObserver?.disconnect();const observers=[];
  for(const textarea of $$('textarea[data-v3-frame="prompt"],textarea[data-v3-frame="negative"]')){
    let wrapper=textarea.closest('.prompt-surface');if(!wrapper){wrapper=document.createElement('div');wrapper.className='prompt-surface';const overlay=document.createElement('div');overlay.className='prompt-paint-viewport';overlay.setAttribute('aria-hidden','true');overlay.innerHTML='<pre class="prompt-paint"></pre>';textarea.before(wrapper);wrapper.append(overlay,textarea);const foot=document.createElement('div');foot.innerHTML='<div class="prompt-foot"><i class="dot"></i><span>只有已定义的 {变量名} 会高亮。其他括号、权重与符号原样保留。</span></div><p class="prompt-hint" hidden></p>';wrapper.after(foot);textarea.addEventListener('scroll',()=>paintPromptEditor(textarea),{passive:true});textarea.addEventListener('input',()=>paintPromptEditor(textarea));textarea.spellcheck=false}
    paintPromptEditor(textarea);observers.push(textarea);
  }
  if(window.ResizeObserver){artUI.editorObserver=new ResizeObserver(entries=>entries.forEach(e=>paintPromptEditor(e.target)));observers.forEach(e=>artUI.editorObserver.observe(e))}
}


function renderCollectionGallery(){const books=filteredBooks();return `<section class="art-fade"><div class="collection-heading"><div class="grow"><div class="overline">MIO / PRIVATE COLLECTION</div><h1 data-user-content>${esc(project().title)}</h1><p>把故事留在画面里，把时间留给创作。</p></div>${btn('创作新画册','plus','new-book','','primary')}</div><div class="collection-toolbar"><div class="search-field">${icon('search')}<input id="gallery-search" value="${esc(ui.search)}" placeholder="寻找一本画册..." aria-label="搜索画册"></div><span class="spacer"></span><button class="filter-link ${ui.filter==='starred'?'active':''}" data-act="art-star-filter">${icon('star','sm')}星标</button><select id="gallery-filter" aria-label="画册状态">${[['all','所有画册'],['complete','已完成'],['generating','生成中'],['failed','待补齐'],['starred','星标收藏']].map(x=>opt(...x,ui.filter)).join('')}</select><select id="gallery-sort" aria-label="画册排序">${[['manual','手动排序'],['createdAt','最近创建'],['updatedAt','最近修改'],['totalSteps','分镜数量']].map(x=>opt(...x,ui.sort)).join('')}</select>${ibtn('check','toggle-bulk','批量选择与管理')}</div><div id="gallery-results">${artGalleryResults()}</div><p class="collection-note">每一帧，都值得被好好收藏。</p></section>`}


function artGalleryResults(){const books=filteredBooks(),selected=ui.selected.size;const bulk=selected?`<div class="bulk-bar"><span>选中 ${selected} 本</span>${btn('星标','star','bulk-star','','small')}${btn('导出','download','bulk-export','','small')}${btn('删除','trash','bulk-delete','','small danger')}<span class="spacer"></span>${ibtn('close','clear-selection','退出选择')}</div>`:'';const index=`<div class="collection-index"><span>${pad(books.length)} BOOK${books.length===1?'':'S'} / 画册集</span><span>LOCAL FIRST · YOUR WORK, YOUR SPACE</span></div>`;if(!books.length)return bulk+index+`<div class="empty">${icon('book')}<h3>留一点空白，给新的故事。</h3><p>${ui.search?'没有找到匹配的画册，试试其他名字。':'这里还没有画册。可以开始创作，或载入一份十二幕示范。'}</p>${btn('开始创作','plus','new-book','','primary')}${!ui.search?btn('载入精选示范','image','art-import-demo','style="margin-left:10px"'):''}</div>`;
  if(books.length===1&&!ui.bulk&&!selected){const b=books[0];return bulk+index+`<article class="edition-showcase"><button class="edition-image" data-act="read" data-id="${b.id}" aria-label="打开 ${esc(b.title)}">${imgTag(coverImage(b),b.title,`data-book="${b.id}" data-step="0" loading="eager" decoding="async"`)}</button><div class="edition-info"><div class="edition-count">${b.curatedDemo?'THE FIRST EDITION':'A VISUAL STORY'} / ${pad(b.totalSteps)} FRAMES</div><h2 data-user-content>${esc(b.title)}</h2><p class="synopsis" data-user-content>${esc(b.synopsis)}</p><div class="edition-byline" data-user-content>${esc(b.characterName||'原创画册')}</div><div class="edition-entry"><button class="read-link" data-act="read" data-id="${b.id}">翻开这本画册 ${icon('arrow','sm')}</button><span class="spacer"></span><button class="ibtn ${b.liked?'on':''}" data-act="star" data-id="${b.id}" aria-label="${b.liked?'取消星标':'星标收藏'}">${icon('star')}</button>${ibtn('more','book-menu','导出与管理画册',`data-id="${b.id}"`)}</div>${missingIndices(b).length?btn('补齐 '+missingIndices(b).length+' 幕','refresh','resume',`data-id="${b.id}" style="margin-top:20px"`,'small'):''}<div class="edition-credit">MIO<br><span style="display:block;margin-top:9px;opacity:.55">${b.curatedDemo?'CURATED DEMO / PERSONAL PREVIEW':'PRIVATE ARTBOOK'}</span></div></div></article>`}
  return bulk+index+`<div class="collection-grid">${books.map(b=>`<article class="edition-tile"><button class="edition-image" data-act="read" data-id="${b.id}" aria-label="阅读 ${esc(b.title)}">${imgTag(coverImage(b),b.title,`data-book="${b.id}" data-step="0" loading="lazy" decoding="async"`)}</button><div class="edition-tile-footer"><h3 data-user-content>${esc(b.title)}</h3>${ibtn('more','book-menu','画册操作',`data-id="${b.id}"`)}</div><div class="edition-tile-meta">${b.totalSteps} 幕 · ${esc(b.characterName||'原创')}</div>${ui.bulk||selected?`<label class="edition-select"><input type="checkbox" data-select-book="${b.id}" ${ui.selected.has(b.id)?'checked':''}>选择这本画册</label>`:''}</article>`).join('')}</div>`;
}


function mergedSettingEntries(plan){const map=new Map();for(const id of plan.variableSetIds||[])for(const e of setBy(id)?.entries||[])map.set(e.key,{...e});for(const e of plan.variables||[])map.set(e.key,{...e});return [...map.values()].filter(e=>!(plan.excludedSettingKeys||[]).includes(e.key))}


function settingLabel(entry){return entry.label||({character_display_name:'角色展示名 / 旁白',character:'角色名 / 提示词',character2:'同行角色',outfit:'服装',style:'画风',scene:'场景与环境',weapon:'道具',mood:'情绪',lora:'LoRA',lora_strength:'LoRA 强度',trigger:'角色特征',tone:'故事基调'})[entry.key]||entry.key}


function characterSettingHelp(key){return key==='character_display_name'?'用于旁白和画册展示，例如「七海」。不会自动加入出图提示词。':key==='character'?'用于出图提示词，填写模型识别的角色名或触发词，例如 nanami。':''}


function updateUnifiedSetting(plan,key,value){let entry=plan.variables.find(e=>e.key===key);if(!entry){const original=mergedSettingEntries(plan).find(e=>e.key===key);entry=original?{...clone(original),id:uid('var')}:variableEntry(key,'');plan.variables.push(entry)}entry.value=entry.type==='boolean'?(value===true||value==='true'):value;plan.excludedSettingKeys=(plan.excludedSettingKeys||[]).filter(k=>k!==key);plan.updatedAt=Date.now();save();return entry}


function renderUnifiedSettings(){
  const p=selectedPlan();if(!p)return '<div class="empty"><h3>先创建一本画册</h3>'+btn('新建画册','plus','new-book','','primary')+'</div>';
  const entries=mergedSettingEntries(p);
  const controls=entries.map(e=>{
    const help=characterSettingHelp(e.key),label=esc(settingLabel(e)),attrs=`id="setting-${e.id}" data-art-setting="${esc(e.key)}" aria-label="${label}" ${help?`aria-describedby="setting-help-${e.id}"`:''}`;
    const control=e.type==='boolean'?`<select ${attrs}>${opt('true','开启',String(e.value))}${opt('false','关闭',String(e.value))}</select>`:e.type==='number'?input('value',e.value,'number',attrs+' step="any"'):`<textarea ${attrs} placeholder="可留空">${esc(typeof e.value==='object'?JSON.stringify(e.value,null,2):e.value)}</textarea>`;
    return `<div class="character-setting ${help?'character-identity-setting':''}"><div class="character-setting-head"><label for="setting-${e.id}" class="grow">${label}</label><code>{${esc(e.key)}}</code>${ibtn('trash','art-setting-remove','从这本画册移除此属性',`data-key="${esc(e.key)}"`)}</div>${control}${help?`<p class="help" id="setting-help-${e.id}">${esc(help)}</p>`:''}${!e.value&&e.value!==0?'<div class="empty-label">未填写，生成时忽略此项</div>':''}</div>`;
  }).join('');
  return `<section class="character-settings"><header class="character-settings-head"><div class="grow"><h2>角色与画面设定</h2><p>设定一次，贯穿所有分镜。留空的属性会自然略过。</p></div>${btn('新增属性','plus','art-setting-add','','small')}</header><div class="character-settings-grid">${controls||'<p class="variable-empty">添加角色、服装或任何你需要的画面属性。</p>'}</div><div class="settings-preset-line"><span class="tiny muted">设定预设</span><select id="art-setting-preset" aria-label="选择角色与画面设定预设"><option value="">选择预设...</option>${projectVariableSets().map(s=>opt(s.id,s.title,'')).join('')}</select>${btn('应用','','art-apply-preset','','small')}${btn('新建空白预设','plus','ws-new-preset','','small')}${btn('将当前设定存为预设','copy','art-save-preset','','ghost small')}</div><details class="quiet-advanced"><summary>高级：自定义节点与单幕设定</summary><p class="help">LoRA 等属性只有在工作流中映射到对应节点输入时才生效。需要某一幕单独变化，可以在分镜高级选项中覆盖属性。</p>${btn('打开节点映射','nodes','v3-settings-tab','data-tab="mapping"','small')}</details></section>`;
}


function renderQuietCreation(){const p=selectedPlan();if(p)createUI.planId=p.id;const tab=createUI.tab==='queue'?'queue':createUI.tab==='variables'||createUI.tab==='settings'?'settings':'story';return `<div class="quiet-create-head"><div class="grow"><h1>创作画册</h1><p>画面由你定义，故事自由发生。</p></div>${p?`<select id="art-book-draft" aria-label="选择要创作的画册">${projectPlans().map(x=>opt(x.id,x.title,p.id)).join('')}</select>`:''}${btn('新画册','plus','new-book','','small')}${p?btn('生成画册','play','v3-generate-plan','','primary'):''}</div><nav class="quiet-tabs" aria-label="创作内容">${[['story','分镜故事'],['settings','角色与画面设定'],['queue','生成队列']].map(([id,title])=>`<button class="${tab===id?'active':''}" data-act="art-create-tab" data-tab="${id}" ${tab===id?'aria-current="page"':''}>${title}</button>`).join('')}</nav>${!p?`<div class="empty"><h3>先给一本新画册起名。</h3><p>再写下分镜，或从十二幕示范开始。</p>${btn('新建画册','plus','new-book','','primary')}</div>`:tab==='settings'?renderUnifiedSettings():tab==='queue'?renderCreationQueue():renderQuietStoryboard(p)}`}


function renderQuietStoryboard(p){const t=templateBy(p.templateId)||currentTemplate(),f=t?.frames[clamp(ui.frameIndex,0,Math.max(0,(t?.frames.length||1)-1))];if(t){ui.templateId=t.id;ui.frameIndex=t.frames.indexOf(f);if(ui.frameIndex<0)ui.frameIndex=0}const own=createUI.sceneScope==='plan'&&p.templateId===t?.id,shown=f?(own?effectivePlanFrame(p,f):f):null;return `<div class="quiet-story-header">${field('画册名称',input('title',p.title,'text','id="v3-plan-title" data-v3-plan="title" placeholder="给画册一个名字"'))}${field('分镜模板',`<div class="row"><select data-v3-plan="templateId" aria-label="分镜模板"><option value="">选择分镜模板...</option>${projectTemplates().map(x=>opt(x.id,x.title,p.templateId)).join('')}</select>${ibtn('plus','new-template','新建分镜模板')}${ibtn('upload','import-template','导入分镜模板')}</div>`)}</div>${!shown?`<div class="empty"><h3>从第一个镜头开始。</h3><p>可以写一段完整的画面，也可以只留下几个词。</p>${btn('添加分镜','plus',t?'add-frame':'new-template','','primary')}</div>`:`<div class="quiet-editor"><nav class="quiet-scene-rail" aria-label="分镜列表">${t.frames.map((x,i)=>`<button class="quiet-scene ${ui.frameIndex===i?'active':''}" data-act="scene" data-index="${i}" draggable="true" data-drag-index="${i}"><span class="number">${pad(i+1)}</span><span data-user-content>${esc(x.name)}</span></button>`).join('')}${btn('新增一幕','plus','add-frame','','small ghost')}</nav><section class="quiet-scene-content"><div class="quiet-scene-top"><input data-v3-frame="name" value="${esc(shown.name)}" aria-label="分镜名称"><span class="spacer"></span>${ibtn('up','move-frame','前移分镜','data-dir="-1"')}${ibtn('down','move-frame','后移分镜','data-dir="1"')}${ibtn('copy','clone-frame','复制此幕')}${ibtn('trash','delete-frame','删除此幕')}</div>${field('画面提示词',`<textarea id="frame-prompt" data-v3-frame="prompt" aria-label="画面提示词，自由输入，支持权重语法" placeholder="描述你想看见的画面...">${esc(shown.prompt)}</textarea>`)}${field('台词 / 旁白',`<textarea class="caption-editor" data-v3-frame="caption" aria-label="这一幕的台词或旁白" placeholder="也可以让画面自己说话。">${esc(shown.caption)}</textarea>`)}${sceneAssignmentHTML(p,f)}<details class="prompt-preview-details"><summary>查看变量替换后的提示词</summary><div id="art-prompt-preview" class="prompt-resolved">${quietResolvedPrompt(p,f)}</div></details><details class="quiet-advanced"><summary>高级选项</summary><div class="field"><label class="label" for="v3-scene-scope">修改范围</label><select id="v3-scene-scope">${opt('shared','修改共享分镜模板',own?'plan':'shared')}${p.templateId===t.id?opt('plan','仅修改当前画册这一幕',own?'plan':'shared'):''}</select></div>${field('负向提示词（可留空）',`<textarea data-v3-frame="negative" aria-label="负向提示词">${esc(shown.negative||'')}</textarea>`)}<label class="row small soft" style="margin:17px 0"><input id="v3-render-override" type="checkbox" ${shown.renderOverride?'checked':''}>覆盖本幕渲染参数</label>${shown.renderOverride?`<div class="editor-options">${[['width','宽度',256,4096,64],['height','高度',256,4096,64],['steps','采样步数',1,150,1],['cfg','CFG',0,30,.1],['denoise','去噪强度',0,1,.05],['seed','Seed',-1,9007199254740991,1]].map(([key,label,min,max,step])=>field(label,input(key,shown[key],'number',`data-v3-frame="${key}" min="${min}" max="${max}" step="${step}"`))).join('')}</div>`:'<p class="help">默认使用工作流参数，不自动覆盖。</p>'}${p.templateId===t.id?`<details class="quiet-advanced"><summary>此幕单独的画面设定</summary>${variableEditor(planFrameOverrides(p,f).variables||[],'scene',p.id)}</details>`:''}<div class="row" style="margin-top:18px">${btn('导出分镜','download','export-template','','small')}${own?btn('恢复共享分镜','refresh','v3-clear-scene','','small ghost'):''}</div></details></section></div>`}`}


function quietResolvedPrompt(p,f){try{const frame=effectivePlanFrame(p,f);return esc(scopeText(frame.prompt,frame._scope))}catch(e){return '设定尚未完整：'+esc(e.message)+'。提示词本身不受语法限制。'}}


function addUnifiedSetting(){modal('新增画面属性',`${field('显示名称',input('label','','text','id="art-new-setting-label" placeholder="例如：道具"'))}${field('变量标识符',input('key','','text','id="art-new-setting-key" placeholder="例如：weapon"'))}${field('属性类型',`<select id="art-new-setting-type">${Object.entries(variableTypes).map(([key,label])=>opt(key,label,'text')).join('')}</select>`)}<div class="help">标识符用于 {变量名} 高亮。它只影响属性识别，不会限制你的提示词语法。</div><div class="modal-footer">${btn('取消','','close-modal')}${btn('添加属性','plus','art-setting-confirm','','primary')}</div>`)}


function readerSequence(book){return Array.from({length:book.totalSteps||book.steps?.length||0},(_,i)=>{const step=book.steps.find(s=>s.stepIndex===i);return step?{...step,image:step.image&&!step.offlineFallback&&!isFallbackImage(step.image)?step.image:'',pending:!step.image||step.offlineFallback===true||isFallbackImage(step.image)}:{stepIndex:i,name:'尚未生成的分镜',caption:'',prompt:'',image:'',pending:true}})}


function readerSpreadIndices(index,total){const start=Math.floor(Math.max(0,index)/2)*2;return[start<total?start:null,start+1<total?start+1:null]}


function roomPage(book,step){if(!step)return '<div class="room-page"><div class="room-blank"><span>Fin.</span><small>THIS STORY CONTINUES</small></div></div>';return `<div class="room-page" data-page="${book.id}:${step.stepIndex}">${imgTag(step.image,step.name,`data-page-img="${book.id}:${step.stepIndex}" data-book="${book.id}" data-step="${step.stepIndex}" decoding="async" loading="${artUI.readerMode==='webtoon'?'lazy':'eager'}"`)}<span class="room-page-number">${pad(step.stepIndex+1)}</span></div>`}


function openArtReader(id){
  flushEditor();const book=bookBy(id);if(!book)throw Error('这本画册已经不存在。');if(!readerSequence(book).length){modal(book.title,'<div class="empty"><h3>这本画册还没有分镜。</h3><p>先生成或上传画面，再来翻阅。</p></div><div class="modal-footer">'+btn('关闭','','close-modal','','primary')+'</div>');return}
  preserveFloating();$('#assistant').hidden=true;ui.bookId=id;ui.step=0;artUI.showInfo=false;artUI.readerMode=state.settings.presentation.defaultReaderMode||'webtoon';artUI.filmstrip=artUI.readerMode==='gallery';ui.mode=artUI.readerMode==='spread'?'manga':artUI.readerMode==='webtoon'?'webtoon':'focus';
  const dialog=$('#reader');dialog.classList.add('art-reader');dialog.classList.remove('inspect-open');renderArtReader();if(!dialog.open)dialog.showModal();
}


function closeArtReader(){artUI.readerObserver?.disconnect();if(document.fullscreenElement===$('#reader'))document.exitFullscreen?.().catch(()=>{});for(const id of ['#toasts','#ui-tooltip','#assistant']){const el=$(id);if(el&&$('#reader').contains(el))document.body.append(el)}$('#reader').close();ui.bookId=null;artUI.showInfo=false;refreshGallery()}


function renderArtReader(){
  const b=bookBy(ui.bookId);if(!b)return;artUI.readerObserver?.disconnect();preserveFloating();const versions=state.books.filter(x=>x.rowId===b.rowId&&x.templateId===b.templateId&&x.projectId===b.projectId),sequence=readerSequence(b);ui.step=clamp(ui.step,0,sequence.length-1);
  $('#reader').innerHTML=`<header class="room-head">${ibtn('close','close-reader','关闭画册')}<span class="room-brand">Mio.</span><span class="room-title grow" data-user-content>${esc(b.title)}</span>${versions.length>1?`<select id="reader-version" aria-label="切换此画册的剧情版本">${versions.map(v=>opt(v.id,v.storyTitle||v.title,b.id)).join('')}</select>`:''}<nav class="room-controls" aria-label="阅读模式">${[['spread','book','对开本'],['webtoon','list','卷轴'],['gallery','image','画廊']].map(([mode,ic,label])=>`<button class="${artUI.readerMode===mode?'active':''}" data-act="room-mode" data-mode="${mode}" aria-pressed="${artUI.readerMode===mode}">${label}</button>`).join('')}</nav>${ibtn('expand','room-fullscreen','进入或退出全屏')}${btn('导出','download','export-book',`data-id="${b.id}"`,'small room-export')}</header><section class="room-stage"><div class="room-canvas" id="reader-canvas"></div><button class="room-open-details" data-act="room-info">${icon('eye')}本幕文字</button><aside class="room-info" id="room-info" ${artUI.showInfo?'':'hidden'} aria-label="当前分镜信息"></aside></section><div class="room-filmstrip" id="room-filmstrip" ${artUI.readerMode==='gallery'||artUI.filmstrip?'':'hidden'} aria-label="分镜缩略图">${sequence.map(s=>`<button data-act="reader-step" data-index="${s.stepIndex}" class="${s.stepIndex===ui.step?'active':''}" aria-label="跳到第 ${s.stepIndex+1} 幕：${esc(s.name)}" ${s.stepIndex===ui.step?'aria-current="page"':''}>${imgTag(s.image,s.name,`data-book="${b.id}" data-step="${s.stepIndex}" data-page-img="${b.id}:${s.stepIndex}" loading="lazy" decoding="async"`)}<small>${pad(s.stepIndex+1)}</small></button>`).join('')}</div><footer class="room-footer"><span>PRIVATE READING ROOM</span><span class="spacer"></span><div class="room-pagination">${ibtn('up','page-prev','上一页')}<span class="page-label" id="page-position"></span>${ibtn('down','page-next','下一页')}</div><span class="spacer"></span><span class="room-scene-title" id="room-scene-title" data-user-content></span>${ibtn('story','room-thumbnails','显示或收起分镜胶卷')}${ibtn('eye','room-info','查看本幕文字')}${ibtn('nodes','room-laboratory','到实验室使用精修扩展')}</footer>`;
  const filmstrip=$('#room-filmstrip');if(filmstrip)filmstrip.hidden=!artUI.filmstrip;
  renderArtCanvas(false);
}


function renderArtCanvas(animate=false){
  const book=bookBy(ui.bookId),canvas=$('#reader-canvas');if(!book||!canvas)return;const frames=readerSequence(book);ui.step=clamp(ui.step,0,frames.length-1);artUI.readerObserver?.disconnect();
  if(artUI.readerMode==='webtoon'){
    canvas.innerHTML=`<div class="room-scroll">${frames.map(s=>`<article data-scroll-step="${s.stepIndex}">${roomPage(book,s)}${artUI.showCaptions?`<div class="scroll-caption" data-user-content>${esc(s.caption)}</div>`:''}</article>`).join('')}</div>`;
    if(window.IntersectionObserver){const visible=new Map();artUI.readerObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)visible.set(entry.target,entry.intersectionRatio);else visible.delete(entry.target)}if(Date.now()<artUI.readerAnchorUntil)return;const best=[...visible].sort((a,b)=>b[1]-a[1])[0];if(best){ui.step=Number(best[0].dataset.scrollStep);syncArtReader()}},{root:canvas,threshold:[0,.15,.35,.65]});$$('[data-scroll-step]',canvas).forEach(el=>artUI.readerObserver.observe(el))}
    requestAnimationFrame(()=>{if(ui.step>0)scrollRoomTo(ui.step,false)});
  }else if(artUI.readerMode==='gallery')canvas.innerHTML=`<div class="room-focus">${roomPage(book,frames[ui.step])}</div>`;
  else{const [a,b]=readerSpreadIndices(ui.step,frames.length);canvas.innerHTML=`<div class="room-spread ${animate?'turning':''}">${roomPage(book,a===null?null:frames[a])}${roomPage(book,b===null?null:frames[b])}</div>`}
  $$('img',canvas).forEach(img=>{img.addEventListener('load',()=>{if(artUI.showInfo)renderRoomInfo()},{once:true})});
  syncArtReader();
}


function scrollRoomTo(index,smooth=true){const canvas=$('#reader-canvas'),target=$(`[data-scroll-step="${index}"]`,canvas);if(!target)return;artUI.readerAnchorUntil=Date.now()+650;const top=target.getBoundingClientRect().top-canvas.getBoundingClientRect().top+canvas.scrollTop-15;canvas.scrollTo({top,behavior:smooth?'smooth':'instant'})}


function setArtStep(index){const b=bookBy(ui.bookId);if(!b)return;ui.step=clamp(Number(index)||0,0,Math.max(0,b.totalSteps-1));if(artUI.readerMode==='webtoon'){scrollRoomTo(ui.step);syncArtReader()}else renderArtCanvas(true)}


function syncArtReader(){const book=bookBy(ui.bookId);if(!book)return;const [a,b]=readerSpreadIndices(ui.step,book.totalSteps);if($('#page-position'))$('#page-position').textContent=artUI.readerMode==='spread'?pad(a+1)+(b===null?'':' / '+pad(b+1))+' · '+pad(book.totalSteps):pad(ui.step+1)+' / '+pad(book.totalSteps);const frame=readerSequence(book)[ui.step];if($('#room-scene-title'))$('#room-scene-title').textContent=frame?.name||'';for(const el of $$('[data-act="reader-step"]',$('#room-filmstrip')||document)){const active=Number(el.dataset.index)===ui.step;el.classList.toggle('active',active);active?el.setAttribute('aria-current','page'):el.removeAttribute('aria-current')}const strip=$('#room-filmstrip'),active=strip?.querySelector('.active');if(strip&&!strip.hidden&&active){const offset=active.offsetLeft-strip.offsetLeft-strip.clientWidth/2+active.clientWidth/2;strip.scrollTo({left:Math.max(0,offset),behavior:'smooth'})}if(artUI.showInfo)renderRoomInfo()}


function renderRoomInfo(){const book=bookBy(ui.bookId),panel=$('#room-info');if(!book||!panel)return;const step=readerSequence(book)[ui.step],img=$(`[data-page-img="${book.id}:${ui.step}"]`,$('#reader-canvas')),size=img?.naturalWidth?img.naturalWidth+' × '+img.naturalHeight:'原始比例';panel.innerHTML=`<div class="row"><h3 class="grow" data-user-content>${esc(step.name)}</h3>${ibtn('close','room-info','收起分镜文字')}</div>${step.caption?`<p class="room-caption" data-user-content>${esc(step.caption)}</p>`:'<p class="room-caption">这一幕，让画面自己说话。</p>'}<div class="room-resolution">${size} · ${pad(ui.step+1)} / ${pad(book.totalSteps)}</div><details><summary>查看画面提示词</summary><pre data-user-content>${esc(step.prompt)}</pre>${btn('复制提示词','copy','room-copy-prompt','','small')}</details>`;panel.hidden=!artUI.showInfo}


function readerLabNavigation(){artUI.labBookId=ui.bookId;artUI.labIndex=ui.step;closeArtReader();navigate(7)}


function artworkImageFallback(event){const img=event.target;if(img instanceof HTMLImageElement&&img.isConnected)img.replaceWith(missingArtworkElement(img))}


function laboratoryExtensions(){return [
  {key:'critic',icon:'shield',title:'视觉审校',description:'连接视觉模型，检查画面与角色一致性。',enabled:featureEnabled('visualCritic')},
  {key:'refine',icon:'brush',title:'单页精修',description:'基于原画册的工作流快照，原地替换一页。',enabled:!!state.settings.presentation.lab.refine},
  {key:'mask',icon:'edit',title:'局部蒙版',description:'涂抹局部区域，需要对应的图生图工作流。',enabled:!!state.settings.presentation.lab.mask},
  {key:'assistant',icon:'spark',title:'分镜写作助手',description:'用自然语言调整源分镜，不改动已有画册。',enabled:featureEnabled('assistant')}
]}


function selectedLabBook(){return bookBy(artUI.labBookId)||projectBooks()[0]||null}


function renderLaboratory(){const b=selectedLabBook();if(b){artUI.labBookId=b.id;artUI.labIndex=clamp(artUI.labIndex,0,Math.max(0,b.totalSteps-1));ui.bookId=b.id;ui.step=artUI.labIndex}const exts=laboratoryExtensions();return `<div class="lab-heading">${heading('实验室','专业工具留在这里。开启你需要的，其余交给画面。',featureEnabled('marketplace')?btn('扩展与模板市场','box','market'):'','LABORATORY / OPTIONAL TOOLS')}</div><div class="lab-experiments">${exts.map(x=>`<section class="lab-extension">${icon(x.icon)}<div class="grow"><h3>${x.title}</h3><p>${x.description}</p></div><label class="switch"><input type="checkbox" role="switch" data-art-extension="${x.key}" aria-label="${x.enabled?'停用':'启用'}${x.title}" ${x.enabled?'checked':''}><span class="switch-track"></span></label></section>`).join('')}</div>${!exts.some(x=>x.enabled)?'<div class="lab-disabled">所有实验扩展默认关闭。开启一个工具后，选择画册与分镜即可使用。阅读器始终保持简洁。</div>':`<div class="lab-controls"><label for="lab-book-select">工作画册</label><select id="lab-book-select" aria-label="实验室的目标画册">${projectBooks().map(book=>opt(book.id,book.title,b?.id)).join('')||'<option value="">当前画册集没有作品</option>'}</select>${b?`<select id="lab-frame-select" aria-label="目标分镜">${readerSequence(b).map(s=>opt(s.stepIndex,pad(s.stepIndex+1)+' · '+s.name,artUI.labIndex)).join('')}</select>${btn('纯粹阅读','book','read',`data-id="${b.id}"`,'small')}`:''}</div>${b?renderLabWorkbench(b):'<div class="empty"><h3>先创作一本画册。</h3><p>实验工具会在这里处理具体分镜。</p>'+btn('创作画册','plus','new-book','','primary')+'</div>'}`}<div class="lab-footer"><span class="lab-stamp">LOCAL / OPT-IN</span><span class="grow">外部服务只在你主动操作时调用，离线演示会明确标注。</span>${btn('扩展使用说明','help','art-lab-help','','ghost small')}</div>`}


function renderLabWorkbench(book){const s=readerSequence(book)[artUI.labIndex],idx=artUI.labIndex;if(!s)return'<div class="lab-disabled">这本画册没有可处理的分镜。</div>';const refiner=state.settings.presentation.lab.refine,critic=featureEnabled('visualCritic'),mask=state.settings.presentation.lab.mask,assistant=featureEnabled('assistant'),engine=book.sourceSnapshot?.frames?.[idx]?._execution?.bindings||book.sourceSnapshot?.execution?.bindings||state.settings.comfy.bindings||[],hasImage=engine.some(b=>b.enabled&&b.source==='image');return `<div class="lab-workbench"><div class="lab-artwork page-art" data-page="${book.id}:${idx}">${imgTag(s.image,s.name,`id="lab-image" data-page-img="${book.id}:${idx}" data-book="${book.id}" data-step="${idx}"`)}</div><aside class="lab-tools">${critic?`<section><div class="row"><h3 class="grow">视觉审校</h3>${icon('shield','sm')}</div><p class="lab-note">${esc(criticReadyLabel())}</p><div class="row">${btn('审校这张图','eye','art-lab-critique',s.pending?'disabled':'','small primary')}${btn('API 设置','settings','critic-settings','','small')}</div><div id="critique-${idx}">${s.critique?criticReportHTML(s.critique,idx):''}</div></section>`:''}${refiner||mask?`<section><h3>单页精修</h3><label class="label" for="refine-${idx}">想改变什么？</label><textarea id="refine-${idx}" placeholder="自由描述希望调整的细节...">${esc(s.prompt)}</textarea><div class="row small soft" style="margin:15px 0">强度<input id="denoise-${idx}" type="range" min="0" max="1" step=".05" value=".45" aria-label="精修去噪强度"><span id="denoise-value-${idx}">0.45</span></div><div class="row">${btn('重绘这一页','brush','art-lab-redraw','','small primary')}${mask?btn('绘制蒙版','edit','art-lab-mask','','small'):''}</div><p class="lab-note">${state.settings.comfy.mode==='mock'?'当前为离线矢量演示，不会调用 GPU。真实精修需连接 ComfyUI。':hasImage?'已找到图像输入映射，请确认原工作流支持所需的图生图或蒙版节点。':'此画册的工作流没有图像输入映射。当前只能重新文生图，不能原图局部精修。'}</p>${!hasImage?btn('检查节点映射','nodes','v3-settings-tab','data-tab="mapping"','ghost small'):''}</section>`:''}${assistant?`<section><h3>分镜写作助手</h3><p class="lab-note">修改「${esc(book.templateTitle)}」的源分镜。已有图像不会自动改变。</p>${btn('打开助手','spark','art-lab-assistant','','small')}</section>`:''}</aside></div>`}


async function setLaboratoryExtension(key,enabled){if(!enabled&&(rt.redraw.size||visionJobs.size||rt.chatBusy))throw Error('请先等待当前精修、审校或助手任务完成，再停用扩展。');if(key==='critic'){state.settings.studio.features.visualCritic=enabled;if(!enabled)state.settings.autoCritique=false}else if(key==='assistant')state.settings.studio.features.assistant=enabled;else if(key==='refine'){state.settings.presentation.lab.refine=enabled;if(!enabled)state.settings.presentation.lab.mask=false}else if(key==='mask'){state.settings.presentation.lab.mask=enabled;if(enabled)state.settings.presentation.lab.refine=true}save();render()}


function addSettingFromDialog(){const p=selectedPlan();if(!p)throw Error('请先选择一本画册。');const key=$('#art-new-setting-key').value.trim(),label=$('#art-new-setting-label').value.trim(),type=$('#art-new-setting-type').value;checkVariableKey(key);if(mergedSettingEntries(p).some(e=>e.key===key))throw Error('已有同名属性，可直接编辑它。');p.variables=p.variables.filter(e=>e.key!==key);p.variables.push({id:uid('var'),key,label:label||key,type,value:type==='number'?0:type==='boolean'?false:type==='json'?'{}':''});p.excludedSettingKeys=(p.excludedSettingKeys||[]).filter(x=>x!==key);save();closeModal();render()}


function textualInterfaceCopy(text){return String(text).replaceAll('智能节点映射器','工作流配置').replaceAll('智能节点映射','工作流配置').replaceAll('实验室','扩展功能').replaceAll('LABORATORY / OPTIONAL TOOLS','EXTENSIONS / OPTIONAL TOOLS').replaceAll('创作企划','画册集').replaceAll('企划','画册集').replaceAll('画册计划','画册').replaceAll('创作计划','画册创作').replaceAll('角色矩阵','角色与画面设定').replaceAll('可复用素材','画面设定').replaceAll('本册专属变量','角色与画面设定').replaceAll('变量素材','设定预设')}


function refreshInterfaceCopy(root=document.body){
  if(artUI.changingCopy||!root)return;artUI.changingCopy=true;
  try{const userTitles=new Set([...state.projects,...state.books,...state.templates,...(state.creation?.plans||[]),...(state.creation?.variableSets||[])].map(x=>x.title));const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,textarea,pre,code,[data-user-content],.chat-bubble,.prompt-surface,.resolved-preview,.mapping-preview-code,.publish-link,.book-title,.book-desc,.room-caption'))continue;if(userTitles.has(node.textContent.trim()))continue;const next=textualInterfaceCopy(node.textContent);if(next!==node.textContent)node.textContent=next}for(const el of root.querySelectorAll('[placeholder],[aria-label],[title]')){if(el.closest('.prompt-surface,.chat-bubble,[data-user-content],#template-studio'))continue;for(const key of ['placeholder','aria-label','title'])if(el.hasAttribute(key)){const value=el.getAttribute(key),next=textualInterfaceCopy(value);if(next!==value)el.setAttribute(key,next)}}}finally{artUI.changingCopy=false}
}


function renderCollectionSwitcher(){const menu=$('#project-popover'),trigger=$('#project-switch-button');if(!trigger)return;menu.innerHTML=`<div class="project-popover-label row">切换画册集<span class="spacer"></span>${ibtn('close','v3-project-close','关闭画册集菜单')}</div>${state.projects.map(p=>`<button class="project-choice" role="menuitem" data-act="project" data-id="${p.id}" aria-current="${p.id===state.activeProjectId}">${icon('folder','sm')}<span class="grow"><strong data-user-content>${esc(p.title)}</strong><small>${state.books.filter(b=>b.projectId===p.id).length} 本画册</small></span></button>`).join('')}<button class="project-new" role="menuitem" data-act="new-project">${icon('plus','sm')}新建画册集</button><button class="project-choice" role="menuitem" data-act="project-rename">${icon('edit','sm')}重命名当前画册集</button><button class="project-choice" role="menuitem" data-act="delete-collection" data-id="${state.activeProjectId}" style="color:var(--red);border-top:1px solid var(--line);border-radius:0;margin-top:5px">${icon('trash','sm')}删除当前画册集</button>`;const r=trigger.getBoundingClientRect();menu.style.left=clamp(r.left,12,Math.max(12,innerWidth-312))+'px';menu.style.top=(r.bottom+7)+'px';menu.hidden=false;trigger.setAttribute('aria-expanded','true');detailUI.projectOpen=true}


async function importCuratedDemo(){if(!await confirmAction('载入精选十二幕示范？','会新增一个独立画册集，不覆盖已有画册、设定或模板。','载入示范'))return;const demo=createCuratedDemo(state),suffix=uid('demo'),remap=new Map();for(const x of [...demo.projects,...demo.books,...demo.templates,...demo.rows,...demo.creation.plans,...demo.creation.variableSets])remap.set(x.id,x.id+'_'+suffix);const walk=value=>{if(typeof value==='string'&&remap.has(value))return remap.get(value);if(Array.isArray(value))return value.map(walk);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[remap.get(key)||key,walk(v)]));return value};const assets=walk({projects:demo.projects,books:demo.books,templates:demo.templates,rows:demo.rows,creation:demo.creation});state.projects.push(...assets.projects);state.books.push(...assets.books);state.templates.push(...assets.templates);state.rows.push(...assets.rows);state.creation.plans.push(...assets.creation.plans);state.creation.variableSets.push(...assets.creation.variableSets);state.activeProjectId=assets.projects[0].id;ui.templateId=assets.templates[0].id;createUI.planId=assets.creation.plans[0].id;save();render();toast('示范已载入，可自由修改与离线浏览。')}


/* Domain source: js/ui.js. Cover fitting never crops or stretches the artwork. */
function createCollectionDisplayModel(){
  const validModes=new Set(['showcase','grid']);
  function mode(value){return validModes.has(value)?value:'showcase'}
  function page(total,requested=0,pageSize=24){const size=Math.max(1,Number(pageSize)||24),count=Math.max(0,Number(total)||0),pages=Math.max(1,Math.ceil(count/size)),index=Math.max(0,Math.min(pages-1,Math.floor(Number(requested)||0)));return{index,pages,start:index*size,end:Math.min(count,(index+1)*size),total:count}}
  function fit(width,height,maxWidth,maxHeight,upscale=true){if(![width,height,maxWidth,maxHeight].every(value=>Number.isFinite(value)&&value>0))return{width:0,height:0,scale:0};const scale=Math.min(maxWidth/width,maxHeight/height,upscale?Infinity:1);return{width:width*scale,height:height*scale,scale}}
  return Object.freeze({mode,page,fit});
}


function createWorkspaceChromePolicy(){
  function navigation(visibility={}){return [[0,'book','画册集','1'],[1,'story','创作画册','2'],[3,'nodes','图像引擎','3'],...(visibility.extensions===true?[[7,'nodes','扩展功能','']]:[]),...(visibility.llm===true?[[4,'spark','AI 写故事','4']]:[]),[5,'settings','设置',','],...(visibility.logs===true?[[6,'terminal','运行日志','']]:[])]}
  function ownsDisplayPreferences(tab){return tab==='appearance'}
  function brandFontSize(preferred,availableWidth,measuredWidth){if(![preferred,availableWidth,measuredWidth].every(value=>Number.isFinite(value)&&value>0))return 0;return Math.min(preferred,preferred*Math.max(0,availableWidth-2)/measuredWidth)}
  return Object.freeze({navigation,ownsDisplayPreferences,brandFontSize});
}


function rememberedInterfaceLanguage(){try{const lang=localStorage.getItem('cc-language');return lang==='en'?'en':'zh-CN'}catch(e){return'zh-CN'}}


function collectionCoverInfo(book){const frame=[...(book.steps||[])].sort((a,b)=>a.stepIndex-b.stepIndex).find(s=>s.image&&!s.offlineFallback&&!isFallbackImage(s.image));const src=frame?.image||'',dimensions=displayUI.dimensions.get(src);return{frame,src,ratio:dimensions?dimensions.width/dimensions.height:Number(frame?.width)>0&&Number(frame?.height)>0?frame.width/frame.height:4/5}}


function responsiveCover(book,mode,index=0){const image=collectionCoverInfo(book),ratio=clamp(image.ratio,.4,2.4);return `<button class="shelf-cover" style="--cover-ratio:${ratio}" data-act="read" data-id="${book.id}" data-cover-mode="${mode}" aria-label="${esc(localeString('阅读'))} ${esc(book.title)}">${imgTag(image.src,book.title,`data-book="${book.id}" data-step="${image.frame?.stepIndex||0}" data-responsive-cover="true" loading="${index<4?'eager':'lazy'}" decoding="async"`)}<span class="cover-paper" aria-hidden="true"></span></button>`}


function updateCoverSizing(img){if(!img?.naturalWidth||!img.naturalHeight)return;const size={width:img.naturalWidth,height:img.naturalHeight};displayUI.dimensions.set(img.currentSrc||img.src,size);displayUI.dimensions.set(img.getAttribute('src'),size);const button=img.closest('.shelf-cover');if(!button)return;const ratio=size.width/size.height;button.dataset.orientation=ratio>1.2?'landscape':ratio<.75?'portrait':'square';if(button.dataset.coverMode==='showcase')button.style.setProperty('--cover-ratio',String(clamp(ratio,.4,2.4)))}


function fitVisibleCovers(){document.querySelectorAll('img[data-responsive-cover]').forEach(img=>{if(img.complete)updateCoverSizing(img)})}


function getShelfBooks(){const key=[state.activeProjectId,ui.search,ui.filter,ui.sort].join('|');if(displayUI.filterKey!==key){displayUI.filterKey=key;displayUI.featuredIndex=0;displayUI.page=0}const books=filteredBooks();displayUI.featuredIndex=clamp(displayUI.featuredIndex,0,Math.max(0,books.length-1));displayUI.page=displayModel.page(books.length,displayUI.page).index;return books}


/* Native localization catalog, mirrored in js/ui.js. No translation service is used. */
function createStudioLocaleCatalog(initial='zh-CN'){
  const pairs=[
    ['画册集','Collections'],['我的画册','My books'],['创作画册','Create a book'],['实验室','Laboratory'],['设置','Settings'],['工作室','Workspace'],['工作室设置','Settings'],['运行日志','Activity log'],['AI 写故事','AI story writer'],['分镜故事','Storyboard'],['角色与画面设定','Character & scene'],['生成队列','Render queue'],['工具与资源','Tools & resources'],['功能开关','Modules'],['外观与阅读','Appearance & reading'],['智能节点映射','Smart input mapping'],['服务与保存','Services & storage'],['视觉审校','Visual review'],
    ['精选展示','Showcase'],['紧凑网格','Grid'],['首页展示方式','Collection view'],['保留大图欣赏，或快速浏览更多画册。','Enjoy a large artwork, or browse more books at a glance.'],['展示方式已保存','View preference saved'],['语言 / Language','Language / 语言'],['界面语言','Interface language'],['只切换界面文字，不翻译画册名称、提示词或台词。','Changes interface text only. Your book titles, prompts and captions remain untouched.'],['显示与语言','Display & language'],['调整阅读习惯，让工作室更适合你。','Make the studio feel like your own.'],['默认阅读模式','Default reading mode'],['打开一本画册时，默认从卷轴阅读开始。','Books open in the continuous scroll view by default.'],['卷轴 · 连续阅读','Scroll · continuous reading'],['对开本 · 双页画册','Spread · facing pages'],['画廊 · 大图与胶卷','Gallery · image & filmstrip'],['艺术字体风格','Display typography'],['只改变界面标题与装饰文字，编辑区保持易读。','Applies to headings and accents. Editors stay clear and legible.'],['书刊 · 雅致衬线','Editorial · elegant serif'],['手札 · 东方笔意','Journal · calligraphic'],['典藏 · 古典书卷','Classic · artbook serif'],['丰富字体按需下载；离线时自动使用系统字体。','Fonts load on demand. System fonts are used automatically when offline.'],['字体已就绪','Font styles ready'],['正在加载字体，当前使用系统字体。','Loading fonts; system fonts are available now.'],['字体加载不可用，已使用系统字体。','Web fonts are unavailable. System fonts are in use.'],['艺术字体','Display typography'],
    ['新建画册集','New collection'],['切换画册集','Switch collection'],['重命名当前画册集','Rename collection'],['关闭画册集菜单','Close collection menu'],['画册集名称','Collection name'],['重命名画册集','Rename collection'],['新的画册集已建立。','Collection created.'],['把故事留在画面里，把时间留给创作。','Stories in every frame. More space to create.'],['创作新画册','Create a book'],['寻找一本画册...','Find a book...'],['搜索画册','Search books'],['星标','Starred'],['所有画册','All books'],['已完成','Complete'],['生成中','Rendering'],['待补齐','Needs frames'],['星标收藏','Bookmarks'],['最近创建','Newest'],['最近修改','Recently edited'],['分镜数量','Frame count'],['画册状态','Book status'],['画册排序','Sort books'],['批量选择与管理','Select and manage books'],['每一帧，都值得被好好收藏。','Every frame deserves a place in your collection.'],['翻开这本画册','Open this book'],['取消星标','Remove bookmark'],['导出与管理画册','Export and manage book'],['画册操作','Book actions'],['选择这本画册','Select this book'],['退出选择','Exit selection'],['全部选择','Select all'],['已选 {count} 本','{count} selected'],['{count} 本画册','{count} books'],['{count} 幕','{count} frames'],['第 {current} / {total} 页','Page {current} of {total}'],['上一册','Previous book'],['下一册','Next book'],['上一页','Previous'],['下一页','Next'],['补齐 {count} 幕','Resume {count} frames'],['仅保留封面示例，十二幕分镜模板仍可用于创作。','Cover-only sample. The 12-scene storyboard is still available for your own book.'],['留一点空白，给新的故事。','Leave room for your next story.'],['没有找到匹配的画册，试试其他名字。','No books match. Try a different name.'],['这里还没有画册。可以开始创作，或载入一份封面示范。','No books here yet. Create one or load the cover sample.'],['载入精选示范','Load the sample'],['开始创作','Start creating'],['原创画册','Original artbook'],['原创','Original'],['阅读','Read'],
    ['对开本','Spread'],['卷轴','Scroll'],['画廊','Gallery'],['关闭画册','Close book'],['进入或退出全屏','Enter or exit full screen'],['本幕文字','Frame notes'],['阅读模式','Reading mode'],['分镜缩略图','Frame thumbnails'],['当前分镜信息','Frame information'],['显示或收起分镜胶卷','Show or hide filmstrip'],['查看本幕文字','Show frame notes'],['收起分镜文字','Close frame notes'],['查看画面提示词','Show image prompt'],['复制提示词','Copy prompt'],['原始比例','Original proportions'],['这一幕，让画面自己说话。','Let this frame speak for itself.'],['到实验室使用精修扩展','Open refinement tools in the laboratory'],['尚未生成的分镜','Frame not generated'],['这本画册还没有分镜。','This book has no frames yet.'],['先生成或上传画面，再来翻阅。','Generate or upload images before reading.'],
    ['新画册','New book'],['生成画册','Generate book'],['画面由你定义，故事自由发生。','Your vision. Your story. No limits on expression.'],['画册名称','Book title'],['给画册一个名字','Name your book'],['分镜模板','Storyboard template'],['选择分镜模板...','Choose a storyboard...'],['新建分镜模板','New storyboard'],['导入分镜模板','Import storyboard'],['分镜列表','Scenes'],['新增一幕','Add scene'],['分镜名称','Scene title'],['前移分镜','Move scene earlier'],['后移分镜','Move scene later'],['复制此幕','Duplicate scene'],['删除此幕','Delete scene'],['画面提示词','Image prompt'],['描述你想看见的画面...','Describe the image you imagine...'],['台词 / 旁白','Dialogue / narration'],['也可以让画面自己说话。','Or let the image speak for itself.'],['查看变量替换后的提示词','Preview the resolved prompt'],['只有已定义的 {变量名} 会高亮。其他括号、权重与符号原样保留。','Only declared {variables} are highlighted. Other brackets, weights and symbols stay exactly as written.'],['提示：有未闭合的花括号。若是变量可检查闭合；若用于提示词权重，请忽略。不会影响生成。','Tip: an opening brace is not closed. Check it if it is a variable, or ignore this for prompt weights. Generation is never blocked.'],['高级选项','Advanced options'],['修改范围','Edit scope'],['修改共享分镜模板','Edit shared storyboard'],['仅修改当前画册这一幕','Override this scene for this book'],['负向提示词（可留空）','Negative prompt (optional)'],['覆盖本幕渲染参数','Override render parameters for this scene'],['默认使用工作流参数，不自动覆盖。','Workflow parameters are preserved unless you enable overrides.'],['此幕单独的画面设定','Scene-specific settings'],['导出分镜','Export storyboard'],['恢复共享分镜','Reset to shared storyboard'],['宽度','Width'],['高度','Height'],['采样步数','Sampling steps'],['去噪强度','Denoise'],
    ['设定一次，贯穿所有分镜。留空的属性会自然略过。','Define once for the whole book. Empty attributes are simply omitted.'],['新增属性','Add attribute'],['未填写，生成时忽略此项','Empty; omitted during generation'],['设定预设','Setting preset'],['选择预设...','Choose a preset...'],['应用','Apply'],['将当前设定存为预设','Save settings as a preset'],['高级：自定义节点与单幕设定','Advanced: custom nodes and scene overrides'],['打开节点映射','Open input mapping'],['角色名','Character'],['同行角色','Companion'],['服装','Outfit'],['画风','Art style'],['场景与环境','Scene & environment'],['道具','Props'],['情绪','Mood'],['角色特征','Character traits'],['故事基调','Story tone'],['可留空','Optional'],['文本','Text'],['数字','Number'],['开关','Boolean'],['添加属性','Add attribute'],['显示名称','Display name'],['变量标识符','Variable identifier'],['属性类型','Attribute type'],['预设名称','Preset name'],['设定预设已保存。','Settings preset saved.'],['属性已移除。','Attribute removed.'],
    ['关闭','Close'],['取消','Cancel'],['确认','Confirm'],['完成','Done'],['保存','Save'],['删除','Delete'],['导出','Export'],['导入','Import'],['复制','Copy'],['编辑','Edit'],['重试','Retry'],['刷新','Refresh'],['继续','Resume'],['暂停','Pause'],['中止','Cancel task'],['开始队列','Start queue'],['查看运行日志','View activity log'],['查找缺失分镜','Find missing frames'],['复制日志','Copy log'],['清空日志','Clear log'],['等待执行','Queued'],['正在渲染','Rendering'],['已暂停','Paused'],['已中止','Canceled'],['执行失败','Failed'],['已复制到剪贴板','Copied to clipboard'],
    ['专业工具留在这里。开启你需要的，其余交给画面。','Professional tools live here. Enable what you need; leave the rest to the artwork.'],['扩展与模板市场','Extensions & templates'],['单页精修','Page refinement'],['局部蒙版','Inpainting mask'],['分镜写作助手','Storyboard assistant'],['连接视觉模型，检查画面与角色一致性。','Connect a vision model to review images and character consistency.'],['基于原画册的工作流快照，原地替换一页。','Refine one page using the book’s original workflow snapshot.'],['涂抹局部区域，需要对应的图生图工作流。','Paint a mask. A compatible image-to-image workflow is required.'],['用自然语言调整源分镜，不改动已有画册。','Edit the source storyboard with natural language. Existing images stay unchanged.'],['所有实验扩展默认关闭。开启一个工具后，选择画册与分镜即可使用。阅读器始终保持简洁。','Experimental tools are off by default. Enable one, then choose a book and frame. The reader always stays clean.'],['工作画册','Target book'],['目标分镜','Target frame'],['纯粹阅读','Open reader'],['审校这张图','Review this image'],['想改变什么？','What would you like to change?'],['强度','Strength'],['重绘这一页','Refine this page'],['绘制蒙版','Paint a mask'],['检查节点映射','Check input mapping'],['打开助手','Open assistant'],['扩展使用说明','Extension guide'],['外部服务只在你主动操作时调用，离线演示会明确标注。','External services run only when you request them. Offline demonstrations are clearly labeled.'],
    ['你的工作室','Your workspace'],['名称显示在工作室侧栏。随时可以修改，不改变已有画册集、画册或设定预设。','This name appears in the sidebar. Changing it does not alter your collections, books or setting presets.'],['工作室名称','Workspace name'],['创作者署名','Creator signature'],['同时更新默认画册签名','Also update the default book signature'],['保存名称与署名','Save name & signature'],['当前保存方式','Current storage'],['配置服务与保存','Configure services & storage'],['导出备份','Export backup'],['返回画廊','Back to books'],['只留下你需要的功能','Keep only the tools you need'],['核心功能','Core feature'],['辅助工具','Additional tools'],['悬浮精修助手','Floating assistant'],['模板与扩展市场','Template & extension market'],['启用','Enable'],['停用','Disable'],['为长时间创作调校界面','Settle into your creative space'],['安静一点，紧凑一点，或让阅读成为你的默认入口。','Quieter, denser, or made for reading. Tune the workspace to your preferences.'],['界面主题','Theme'],['日光适合明亮环境；暗室让画面更突出。','Light for bright rooms; dark to let the artwork stand out.'],['暗室 / Dark','Dark'],['日光 / Light','Light'],['界面密度','Interface density'],['舒适','Comfortable'],['紧凑','Compact'],['紧凑模式减少表格与面板间距。','Compact mode reduces table and panel spacing.'],['减少动态效果','Reduce motion'],['关闭入场、微光和翻页动画；同时尊重系统减弱动态设置。','Reduces entrances and page-turn effects, while respecting your system motion preference.'],['阅读器默认行为','Reader defaults'],['打开画册时的模式','Default opening mode'],['只影响下次打开的画册，不打断当前阅读。','Applies to the next book you open, without interrupting your current reading.'],['助手修改前确认','Confirm assistant edits'],['应用工具修改前，显示将受影响的模板与分镜。','Shows the target storyboard and scenes before applying tool changes.'],
    ['Python 原生配置同步','Native Python configuration sync'],['同源读取和保存已自动配置，无需填写接口路径。','Same-origin read and save endpoints are already configured.'],['10 个必填字段顶层平铺，删除时透传 forceWrite。','Ten required top-level fields; forceWrite is sent for authorized deletions.'],['重新读取后端','Reload backend'],['立即保存','Save now'],['ComfyUI 服务','ComfyUI service'],['运行模式','Run mode'],['离线预览','Offline preview'],['真实 ComfyUI','Real ComfyUI'],['ComfyUI 地址','ComfyUI URL'],['测试连接','Test connection'],['本地预览模式','Offline preview'],['ComfyUI 待连接','ComfyUI disconnected'],['ComfyUI 已连接','ComfyUI connected'],['队列','Queue'],['切换界面主题','Toggle theme'],['折叠侧栏','Collapse sidebar'],['展开侧栏','Expand sidebar'],['搜索与快速操作','Search & commands'],['新编辑会清除旧网络错误并重新安排保存。未读取成功前不会覆盖后端数据。','A new edit retries after network errors. Existing backend data is not overwritten before a successful read.'],
    ['导入工作流 JSON','Import workflow JSON'],['从节点定义读取字段','Read node definitions'],['导入映射包','Import mappings'],['导出映射包','Export mappings'],['添加映射项','Add binding'],['工作流名称','Workflow name'],['结果图片节点（可手动输入，留空自动查找）','Output image node (leave blank to detect)'],['节点 ID（可手动填）','Node ID (editable)'],['输入字段 / 路径','Input field / path'],['值类型','Value type'],['值从哪里来？','Value source'],['映射高级控制','Advanced binding controls'],['自动类型','Auto type'],['本幕正向提示词','Scene positive prompt'],['负向提示词','Negative prompt'],['本幕台词','Scene caption'],['读取变量','Read variable'],['自定义值 / 模板文本','Custom value / template text'],['随机种子','Random seed'],['分镜高级参数','Scene parameter override'],['上传参考图 / 重绘图','Uploaded reference / refinement image'],['保持工作流原值','Keep workflow value'],['重新识别文本字段','Detect text field again'],['允许新增此可选输入字段','Allow adding this optional input'],['允许覆盖原节点连线','Allow overwriting original link'],['查看实际提交 JSON','Preview submission JSON'],['一帧试跑','Test one frame'],['编辑完整蓝图','Edit full workflow'],['每次任务随机化蓝图中的种子','Randomize workflow seeds for each task'],['配置高级分镜参数','Map scene parameters'],['自动识别正负提示词','Detect positive / negative nodes'],['让工作流里的每一个可配置输入，都成为你的创作参数。无需修改项目源码。','Make any configurable workflow input a creative parameter, without changing application source.'],
    ['画册导出模板','Book export templates'],['模板与插件市场','Template marketplace'],['GitHub 托管','GitHub hosting'],['快速开始教程','Quick-start guide'],['工程备份与恢复','Backup & restore'],['系统自检','Diagnostics'],['设计 HTML/CSS 阅读版式，不改变源画面与台词。','Design an HTML/CSS reading layout without changing source artwork or captions.'],['安装或导入分镜、画册版式与工作流。','Install or import storyboards, book layouts and workflows.'],['上传或安装可复用模板，不上传私有工程。','Publish or install reusable templates, never your entire private workspace.'],['低频工具集中在这里，主侧栏只保留日常创作入口。','Less-used tools stay here so the sidebar remains focused on daily work.'],['检查变量、通用映射、模板和页面边界。','Check variables, mappings, templates and interface boundaries.'],
    ['导出你的故事','Export your story'],['自定义此模板','Customize template'],['导入模板','Import template'],['从市场下载','Get from marketplace'],['本次主题色','Accent color'],['分镜框线 / px','Frame border / px'],['显示剧情台词','Include captions'],['附带提示词水印','Include image prompts'],['管理模板库','Manage templates'],['生成并下载画册','Build & download book'],['用自己的 HTML 模板，为每一个故事设计阅读体验。','Give each story its own reading experience with HTML templates.'],['自定义版式只作用于导出的 HTML，不会改动作品与原始台词。','Layouts affect exported HTML only; source artwork and captions remain unchanged.'],['外观与信息','Design & details'],['HTML / CSS 源码','HTML / CSS source'],['模板包','Template package'],['发布到 GitHub','Publish to GitHub'],['实时预览 · 前 3 幕','Live preview · first 3 frames'],['独立沙盒 · 无网络请求','Isolated preview · no network requests'],['设为默认','Set as default'],['还原修改','Revert changes'],['保存为我的模板','Save as my template'],['保存模板','Save template'],['模板名称','Template name'],['阅读版式','Reading layout'],['简介','Description'],['作者','Author'],['版本','Version'],['纸张与排版','Paper & typography'],['主题色','Accent'],['画布底色','Canvas'],['纸张色','Paper'],['文字颜色','Text'],['字体','Typeface'],['版心宽度','Content width'],['页间距','Page gap'],['圆角','Corner radius'],['用于预览的画册','Preview book'],['完整 HTML / CSS 文档','Complete HTML / CSS document'],['插入分镜循环','Insert frame loop'],['模板变量与安全规则','Variables & safety rules'],['刷新预览','Refresh preview'],['恢复未保存草稿','Recover draft'],['新建模板','New template'],
    ['视觉审校 API','Visual review API'],['填写 API / 配置模型','Configure API / model'],['带图连通性测试','Test with an image'],['连接来源','Connection source'],['独立配置（推荐）','Independent settings (recommended)'],['复用 LLM 的地址、模型与密钥','Reuse story model connection'],['服务商预设','Provider preset'],['视觉模型名称','Vision model'],['单次超时 / 秒','Timeout / seconds'],['报告通过标准','Passing score'],['附带角色参考立绘','Include character reference'],['附带前一幕画面','Include previous frame'],['审校重点','Review focus'],['带图测试连接','Test vision connection'],['保存并关闭','Save & close'],['离线演示：不调用 API','Offline demo: no API calls'],['真实视觉 API','Real vision API'],['配置 API','Configure API'],['审校整本画册','Review whole book'],['停止整册审校','Stop book review'],['复制报告','Copy report'],['API 设置','API settings'],['修改 API 配置','Edit API settings'],['重试审校','Retry review'],['将此建议填入重绘框','Add suggestion to refinement prompt'],['结构与一致性诊断','Anatomy & continuity'],['离线演示 · 不是真实诊断','Offline demonstration · not a real diagnosis'],['真实视觉 API · 尚未进行带图测试','Vision API · image test not run'],['真实视觉 API · 带图测试已通过','Vision API · image test passed'],
    ['GitHub 模板发布与安装','Publish & install with GitHub'],['直接上传到仓库','Upload to repository'],['GitHub 网页上传教程','Upload on GitHub.com'],['从仓库安装','Install from repository'],['只上传这一个资源','Upload only this resource'],['GitHub 仓库','GitHub repository'],['分支','Branch'],['仓库内文件路径','Repository file path'],['提交说明','Commit message'],['检查仓库与文件','Check repository & file'],['上传并提交','Upload & commit'],['下载所选模板','Download selected template'],['打开 GitHub 上传页面','Open GitHub upload page'],['复制预计 Raw 地址','Copy expected Raw URL'],['创建仓库','Create repository'],['创建 Fine-grained Token','Create fine-grained token'],['权限与接口文档','Permissions & API docs'],['即将上传的内容','Upload preview'],['资源','Resource'],['类型','Type'],['大小','Size'],['范围','Scope'],['仅一个模板文件','One template file only'],['上传到 GitHub','Upload to GitHub'],['上传教程','Upload guide'],['安装','Install'],['卸载','Uninstall'],['下载模板','Download template'],['预览','Preview'],['全部','All'],['画册 HTML 模板','Book HTML templates'],['分镜剧本','Storyboards'],['角色资产','Character assets'],['工作流','Workflows'],['审校规则','Review rules'],['解析并导入','Parse & import'],['返回画册导出','Back to book export'],
    ['先认识你的工作室。','Meet your workspace.'],['先用默认名称','Use a default name'],['进入工作室','Enter workspace'],['创作者署名（可选）','Creator signature (optional)'],['分镜精修助手','Storyboard assistant'],['编辑指令','Edit instruction'],['修改前确认','Confirm before editing'],['发送','Send'],['停止','Stop'],['对话记录','Conversations'],['修改目标 / 画册集与源分镜模板','Target / collection and source storyboard'],['用自然语言，修改提示词与台词','Edit prompts and captions with natural language'],['离线规则模式','Offline rule mode'],['原生接口与512幕回归检查','Native API & 512-frame diagnostics'],['通过','Passed'],['未通过','Not passed'],['画册操作','Book actions'],['沉浸阅读','Immersive reader'],['加入星标','Bookmark'],['复制画册概要','Copy book summary'],['对比剧情版本','Compare story versions'],['导出离线画册','Export offline book'],['补齐缺失分镜','Resume missing frames'],['移除画册','Remove book'],['查看图片目录','Show image folder'],['悬停在 ? 上可查看更完整的操作说明。','Hover over ? for a description of each action.'],['所有操作仅作用于你的私有工程。','All actions stay within your private workspace.']
  ];
  pairs.push(['修改目标','Editing target'],['改写场景','Reimagine a scene'],['润色台词','Polish the dialogue'],['续写一幕','Add a new scene'],['让下一幕，','Let the next scene'],['更接近你的想象。','feel more like you.'],['雨夜、车站，以及新的氛围','A rainy station. A different atmosphere.'],['让对白更自然，让情绪更细腻','Natural words. More delicate emotions.'],['给还未结束的故事一个转折','A new turn for an unfinished story.'],['文本与附件将发送至你配置的模型','Text and attachments go to your configured model.'],['离线规则模式 · 不会发送到云端','Offline rules · Nothing sent to the cloud.'],['改场景、润色台词，或为故事添上一幕。 修改前，由你确认。','Reimagine a scene, polish a line, or write what comes next. You approve every edit.'],['改场景、润色台词，或为故事添上一幕。 已关闭确认，修改将直接应用。','Reimagine a scene, polish a line, or write what comes next. Confirmation is off; edits apply directly.'],['Enter 发送 · Shift + Enter 换行','Enter to send · Shift + Enter for a new line']);
  const messages=Object.fromEntries(pairs);let language=initial==='en'?'en':'zh-CN';
  function text(source,values={}){const template=language==='en'?messages[source]||source:source;return String(template).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(whole,key)=>Object.hasOwn(values,key)?String(values[key]):whole)}
  function translate(source){if(language!=='en')return source;const original=String(source),core=original.trim();let value=messages[core];if(!value){const count=core.match(/^(\d+)\s*本画册$/),frame=core.match(/^(\d+)\s*幕$/),selected=core.match(/^(?:选中|已选择)\s*(\d+)\s*本$/);if(count)value=count[1]+' books';else if(frame)value=frame[1]+' frames';else if(selected)value=selected[1]+' selected'}return value?original.slice(0,original.indexOf(core))+value+original.slice(original.indexOf(core)+core.length):source}
  return{get language(){return language},setLanguage(value){language=value==='en'?'en':'zh-CN'},text,translate,messages};
}


function extendStudioLocaleCatalog(catalog){Object.assign(catalog.messages,{
  '角色展示名 / 旁白':'Display name / narration','角色名 / 提示词':'Character name / prompt',
  '用于旁白和画册展示，例如「七海」。不会自动加入出图提示词。':'Used in narration and book details, for example Nanami. Never automatically added to image prompts.',
  '用于出图提示词，填写模型识别的角色名或触发词，例如 nanami。':'Used in image prompts. Enter the name or trigger recognized by your model, for example nanami.',
  '删除画册集':'Delete collection','删除当前画册集':'Delete current collection','确定删除这个画册集？':'Delete this collection?','未命名画册集':'Untitled collection',
  '将移除 {books} 本画册、{plans} 份创作草稿、{templates} 套专属分镜和 {sets} 组设定。':'This removes {books} books, {plans} book drafts, {templates} exclusive storyboards and {sets} setting presets.',
  '关联的角色记录、对话与队列任务也会移除；全局工作流和导出模板保留。':'Related character records, conversations and queue tasks will also be removed. Global workflows and export templates are kept.',
  '另外 {count} 项被其他画册集使用的资产会保留。':'{count} assets referenced by other collections will be retained.',
  '这是最后一个画册集，删除后会建立一个新的空白画册集。':'This is the last collection. A new empty collection will be created afterward.',
  '无法撤销，建议先导出备份。磁盘文件的清理由你的后端策略决定。':'This cannot be undone; export a backup first. Physical file cleanup is governed by your backend.',
  '请先等待当前生成、审校、上传或保存任务结束，再删除画册集。':'Wait for active generation, review, upload or save tasks to finish before deleting this collection.',
  '工程在确认期间发生变化，请重新检查后删除。':'The project changed while awaiting confirmation. Review it and try again.',
  '画册集已删除，正在等待后端保存确认。':'Collection deleted locally; waiting for the backend to confirm the save.',
  '画册集已删除；当前尚未连接后端，请保存或导出备份。':'Collection deleted locally. Connect to the backend or export a backup to retain this change.',
  '图像引擎':'Image engines','工作流配置':'Workflow configuration','智能节点映射':'Workflow configuration','智能节点映射器':'Workflow configuration',
  '扩展功能':'Extensions','实验室':'Extensions','扩展功能使用说明':'Extension guide','扩展功能的目标画册':'Target book for extensions','到扩展功能使用精修扩展':'Open refinement extensions','显示运行日志':'Show activity log',
  '画册与创作是核心功能，始终保留。其他模块可以按需开启，隐藏不会删除历史作品。':'Books and creation are always available. Optional modules can be hidden without deleting your work.',
  '阅读、精修和导出已生成的画册。':'Read, refine and export generated books.',
  '画册、分镜、设定预设和生成队列收纳在一个工作区。':'Book drafts, storyboards, setting presets and rendering share one workspace.',
  '独立查看生成、连接、保存与审校的运行过程。':'Inspect rendering, connections, saves and review activity.',
  '可选功能：把想法写成剧情台词或分镜初稿。默认关闭，不影响普通生成。':'Optional: turn ideas into dialogue or storyboard drafts. Off by default; rendering works without it.',
  '可拖动的小悬浮球；悬停展开说明，点击对话。只修改源分镜模板。':'Drag the floating button, hover for its label, or click to chat. It edits source storyboards only.',
  '连接支持图片输入的模型，检查真实画面并给出修改建议。':'Connect a vision-capable model to inspect artwork and suggest refinements.',
  '从设置中的“工具与资源”进入，不再占用主侧栏。':'Available under Settings > Tools & resources, keeping the sidebar clear.',
  '使用已有 Python 后端时，由服务负责保存与文件夹管理，不需要浏览器目录授权。':'Your Python service manages saves and folders, without browser directory permissions.',
  '创作流程由你定义，工具保持安静。':'Define your creative process. Let the tools stay out of the way.',
  '从画册创作到生成画册，含本地三幕练习。':'Learn the creative workflow with a local three-scene exercise.',
  '下载工程 JSON 或便携目录包。':'Download a project JSON backup or portable directory archive.',
  '给自己的创作空间取个名字。后端连接和使用教程都可以稍后在设置里处理，不会挡住你开始创作。':'Name your creative space. Connections and tutorials can wait until later in Settings.',
  '默认名称为“我的工作室”。之后可以随时在设置中修改。教程不会在命名之前自动弹出。':'You can use the default name and change it later. Tutorials never interrupt the naming step.',
  '当前为离线矢量演示，不会调用 GPU。真实精修需连接 ComfyUI。':'Offline vector demonstration. Connect ComfyUI for real image refinement.',
  '此画册的工作流没有图像输入映射。当前只能重新文生图，不能原图局部精修。':'This workflow has no image-input binding. It can regenerate from text but cannot inpaint the original.',
  '已找到图像输入映射，请确认原工作流支持所需的图生图或蒙版节点。':'Image-input binding found. Confirm that your workflow supports the required image-to-image or mask nodes.',
  '标识符用于 {变量名} 高亮。它只影响属性识别，不会限制你的提示词语法。':'The identifier enables {variable} highlighting. It never restricts your prompt syntax.',
  'LoRA 等属性只有在工作流中映射到对应节点输入时才生效。需要某一幕单独变化，可以在分镜高级选项中覆盖属性。':'LoRA and other properties take effect when bound to workflow inputs. Use advanced scene settings for individual overrides.',
  '变量名（任意自定义变量）':'Variable name (any custom attribute)',
  '自定义内容（支持 {变量名}）':'Custom value (supports {variables})',
  '分镜参数名':'Scene parameter name',
  '此来源会按每一幕自动传入，无需重复填写。':'This value is supplied for each scene automatically.',
  '只有单幕高级覆盖开启时生效。':'Applies only when advanced scene overrides are enabled.',
  'JSON 路径以 / 开头，支持嵌套对象和数组。覆盖连线会改变拓扑，请仅在明确知道节点要求时开启。':'JSON paths begin with / and support nested objects and arrays. Upstream workflow links are protected.',
  '默认保留工作流的尺寸、采样器、CFG 与 LoRA 参数。高级分镜参数只有你启用并映射后才会覆盖。':'Workflow size, sampler, CFG and LoRA settings are preserved by default. Scene overrides apply only when enabled and mapped.',
  '试跑结果将显示在这里。连接地址集中在“服务连接”设置，不在本页面重复配置。':'A test render will appear here. Configure service addresses in the connection settings.',
  '从左侧节点添加字段，或手动建立映射。没有任何必填的固定节点类型。':'Add an input from the node browser, or define a binding manually. No fixed node types are required.',
  'Token 不写入磁盘，关闭窗口即清除。':'The token is never written to disk and is cleared when this window closes.',
  '使用 POST /chat/completions，支持多模态和工具调用':'Uses POST /chat/completions with image input and tool calling.',
  '离线规则模拟（不调用 API）':'Offline rule simulation (no API calls)',
  '模型名称':'Model name','服务商预设':'Provider preset','全局负向提示词':'Global negative prompt',
  '从第一个镜头开始。':'Start with the first shot.','可以写一段完整的画面，也可以只留下几个词。':'Describe a full scene, or begin with just a few words.','添加分镜':'Add a scene',
  '队列已结束，已生成画面全部保留。':'The queue has finished. All completed images were retained.',
  '正在读取 Python 工作室...':'Loading workspace from Python...','正在提交 Python 后端...':'Saving to Python backend...','后端保存未确认 · 请检查设置':'Save not confirmed · check settings','有待保存修改':'Unsaved changes','尚未连接保存服务 · 当前未保存到后端':'Storage service disconnected · not saved to backend','已读取 /api/config，保存使用 POST 平铺字段。':'Loaded /api/config. Saves use the native flat POST payload.','POST /api/config 已由后端确认。':'POST /api/config was confirmed by the backend.',
  '当页图片会被保留，原始分镜不会更改。':'Images are retained and source storyboards remain unchanged.',
  '真实视觉 API · 尚未进行带图测试':'Vision API · image test not run','真实模式 · 尚未填写完整 API':'Vision API · configuration incomplete',
  '所有创作，只属于你。':'Your work belongs to you.',
  '原生中英文界面，无需联网翻译。':'Built-in Chinese and English. No translation service required.'
});return catalog}


function localeString(source,values={}){return displayUI.locale?displayUI.locale.text(source,values):String(source).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(m,k)=>Object.hasOwn(values,k)?values[k]:m)}


function localeExcludedElement(element){return !element||!!element.closest('script,style,textarea,input,pre,code,[data-user-content],[data-no-translate],.chat-bubble,.prompt-surface,.prompt-resolved,.resolved-preview,.mapping-preview-code,.publish-link,.room-caption,.room-scene-title,.book-desc,.book-title,#log-body,.terminal-body,.assistant-tool-detail')}


function localizeWorkspace(root=document.body){
  if(!displayUI.locale||displayUI.localizing||!root)return;displayUI.localizing=true;const pending=displayUI.observer?.takeRecords();if(pending?.length)queueLocalization(pending);displayUI.observer?.disconnect();
  try{
    const interfaceOnly=root.closest?.('#market-content,#ui-tooltip,#statusbar');
    const values=new Set();for(const item of interfaceOnly?[]:[...state.projects,...state.books,...state.templates,...state.rows,...(state.creation?.plans||[]),...(state.creation?.variableSets||[])]){for(const key of ['title','character','characterName','synopsis','outline'])if(typeof item[key]==='string')values.add(item[key]);const frames=Array.isArray(item.frames)?item.frames:Array.isArray(item.steps)?item.steps:[];for(const f of frames)for(const key of ['name','prompt','caption'])if(typeof f?.[key]==='string')values.add(f[key])}values.add(workspaceName());
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){const element=node.parentElement;if(localeExcludedElement(element)||!node.nodeValue?.trim())continue;const current=node.nodeValue,stored=displayUI.originalText.get(node);if(values.has(current.trim())&&!stored)continue;const source=stored&&current===stored.output?stored.source:current;const output=displayUI.locale.translate(textualInterfaceCopy(source));if(current!==output)node.nodeValue=output;displayUI.originalText.set(node,{source,output})}
    for(const el of [...(root.matches?.('[title],[placeholder],[aria-label]')?[root]:[]),...root.querySelectorAll('[title],[placeholder],[aria-label]')]){if(el.closest('script,style,pre,code,[data-user-content],[data-no-translate],.publish-link'))continue;let records=displayUI.originalAttrs.get(el)||{};for(const attr of ['title','placeholder','aria-label']){if(!el.hasAttribute(attr))continue;const current=el.getAttribute(attr),old=records[attr],source=old&&current===old.output?old.source:current,output=displayUI.locale.translate(textualInterfaceCopy(source));if(output!==current)el.setAttribute(attr,output);records[attr]={source,output}}displayUI.originalAttrs.set(el,records)}
  }finally{displayUI.localizing=false;displayUI.observer?.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label']})}
}


function queueLocalization(records){
  displayUI.pendingLocaleRoots??=new Set();
  const add=node=>{const el=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;if(!el?.isConnected||el.closest('script,style,pre,code,[data-user-content],[data-no-translate]'))return;for(const current of displayUI.pendingLocaleRoots){if(current.contains(el))return;if(el.contains(current))displayUI.pendingLocaleRoots.delete(current)}displayUI.pendingLocaleRoots.add(el)};
  if(!records)add(document.body);else for(const record of records){if(record.type==='childList')record.addedNodes.forEach(add);else add(record.target)}
  if(displayUI.localeFramePending||!displayUI.pendingLocaleRoots.size)return;
  displayUI.localeFramePending=true;displayUI.frame=requestAnimationFrame(()=>{displayUI.localeFramePending=false;const roots=[...displayUI.pendingLocaleRoots];displayUI.pendingLocaleRoots.clear();for(const root of roots)if(root.isConnected)localizeWorkspace(root)});
}


function shelfButton(iconName,action,label,attributes='',classes=''){return btn(localeString(label),iconName,action,attributes,classes)}


function shelfIcon(name,action,label,attrs=''){return ibtn(name,action,localeString(label),attrs)}


function shelfStatus(book){return localeString(book.inProgress||book.status==='generating'?'生成中':missingIndices(book).length?'待补齐':'已完成')}


function shelfBookCount(count){return localeString('{count} 本画册',{count})}


function shelfViewSwitch(){const current=state.settings.presentation.homeLayout;return `<div class="shelf-view-switch" role="group" aria-label="${esc(localeString('首页展示方式'))}">${[['showcase','image','精选展示'],['grid','grid','紧凑网格']].map(([mode,ic,label])=>`<button data-act="shelf-layout" data-layout="${mode}" class="${current===mode?'active':''}" aria-pressed="${current===mode}" title="${esc(localeString(label))}">${icon(ic)}<span>${localeString(label)}</span></button>`).join('')}</div>`}


function renderResponsiveCollection(){return `<section class="art-fade" id="collection-home"><div class="collection-heading"><div class="grow"><div class="overline">MIO / PRIVATE COLLECTION</div><h1 data-user-content>${esc(project().title)}</h1><p>${localeString('把故事留在画面里，把时间留给创作。')}</p></div>${shelfButton('plus','new-book','创作新画册','','primary')}</div><div class="collection-toolbar shelf-toolbar"><div class="search-field">${icon('search')}<input id="gallery-search" value="${esc(ui.search)}" placeholder="${esc(localeString('寻找一本画册...'))}" aria-label="${esc(localeString('搜索画册'))}"></div><span class="spacer"></span><button class="filter-link ${ui.filter==='starred'?'active':''}" data-act="art-star-filter">${icon('star','sm')}${localeString('星标')}</button><select id="gallery-filter" aria-label="${esc(localeString('画册状态'))}">${[['all','所有画册'],['complete','已完成'],['generating','生成中'],['failed','待补齐'],['starred','星标收藏']].map(([id,label])=>opt(id,localeString(label),ui.filter)).join('')}</select><select id="gallery-sort" aria-label="${esc(localeString('画册排序'))}">${[['manual','手动排序'],['createdAt','最近创建'],['updatedAt','最近修改'],['totalSteps','分镜数量']].map(([id,label])=>opt(id,localeString(label),ui.sort)).join('')}</select>${shelfViewSwitch()}${shelfIcon('check','toggle-bulk','批量选择与管理')}</div><div id="gallery-results">${responsiveCollectionResults()}</div><p class="collection-note">${localeString('每一帧，都值得被好好收藏。')}</p></section>`}


function shelfSelectionBar(books){if(!ui.bulk&&!ui.selected.size)return'';const selected=ui.selected.size,all=books.length>0&&books.every(b=>ui.selected.has(b.id));return `<div class="shelf-bulk"><label><input type="checkbox" id="shelf-select-all" ${all?'checked':''} aria-label="${esc(localeString('全部选择'))}">${localeString('全部选择')}</label><span class="grow">${localeString('已选 {count} 本',{count:selected})}</span>${shelfButton('star','bulk-star','星标',selected?'':'disabled','small')}${shelfButton('download','bulk-export','导出',selected?'':'disabled','small')}${shelfButton('trash','bulk-delete','删除',selected?'':'disabled','small danger')}${shelfIcon('close','clear-selection','退出选择')}</div>`}


function responsiveCollectionResults(){
  const books=getShelfBooks(),mode=state.settings.presentation.homeLayout,b=books[displayUI.featuredIndex],paging=displayModel.page(books.length,displayUI.page),bulk=shelfSelectionBar(books),count=`<span>${shelfBookCount(books.length)}</span>`;
  if(!books.length)return `<div class="shelf-index">${count}</div><div class="empty">${icon('book')}<h3>${localeString('留一点空白，给新的故事。')}</h3><p>${localeString(ui.search?'没有找到匹配的画册，试试其他名字。':'这里还没有画册。可以开始创作，或载入一份封面示范。')}</p>${shelfButton('plus','new-book','开始创作','','primary')}${!ui.search?shelfButton('image','art-import-demo','载入精选示范','style="margin-left:10px"'):''}</div>`;
  const navigation=mode==='showcase'?`<div class="shelf-exhibit-nav">${shelfIcon('up','shelf-feature-prev','上一册',displayUI.featuredIndex===0?'disabled':'')}<span class="shelf-counter">${pad(displayUI.featuredIndex+1)} / ${pad(books.length)}</span>${shelfIcon('down','shelf-feature-next','下一册',displayUI.featuredIndex===books.length-1?'disabled':'')}</div>`:`<span class="shelf-context">${paging.start+1} - ${paging.end} / ${books.length}</span>`;
  const prefix=`${bulk}<div class="shelf-index">${count}${navigation}</div>`;
  if(mode==='showcase')return prefix+`<article class="edition-showcase shelf-exhibit" data-sort-book="${esc(b.id)}" draggable="true" tabindex="0" aria-label="画册 ${esc(b.title)}，右键管理">${responsiveCover(b,'showcase')}<div class="edition-info"><div class="edition-count">${b.curatedDemo?'THE FIRST EDITION':'A VISUAL STORY'} / ${localeString('{count} 幕',{count:b.totalSteps})}</div><h2 data-user-content>${esc(b.title)}</h2><p class="synopsis" data-user-content>${esc(b.synopsis)}</p><div class="edition-byline" data-user-content>${esc(b.characterName||'')}</div><div class="edition-entry"><button class="read-link" data-act="read" data-id="${b.id}">${localeString('翻开这本画册')} ${icon('arrow','sm')}</button><span class="spacer"></span><button class="ibtn ${b.liked?'on':''}" data-act="star" data-id="${b.id}" aria-label="${esc(localeString(b.liked?'取消星标':'星标收藏'))}">${icon('star')}</button>${shelfIcon('more','book-menu','导出与管理画册',`data-id="${b.id}"`)}</div><div class="shelf-meta-line"><i class="dot ${missingIndices(b).length?'amber':''}"></i><span>${shelfStatus(b)}</span><span style="opacity:.4">/</span><time>${new Date(b.createdAt).toLocaleDateString(displayUI.locale.language==='en'?'en-US':'zh-CN',{year:'numeric',month:'short',day:'numeric'})}</time></div>${missingIndices(b).length?btn(localeString('补齐 {count} 幕',{count:missingIndices(b).length}),'refresh','resume',`data-id="${b.id}" style="margin-top:19px"`,'small'):''}${b.curatedDemo&&b.demoContentRevision===2?`<p class="shelf-import-note">${localeString('仅保留封面示例，十二幕分镜模板仍可用于创作。')}</p>`:''}${ui.bulk||ui.selected.size?`<label class="shelf-select"><input type="checkbox" data-select-book="${b.id}" ${ui.selected.has(b.id)?'checked':''}>${localeString('选择这本画册')}</label>`:''}<div class="edition-credit">MIO<br><span style="display:block;margin-top:8px;opacity:.55">PRIVATE ARTBOOK COLLECTION</span></div></div></article>`;
  const tiles=books.slice(paging.start,paging.end).map((book,i)=>`<article class="shelf-item" data-sort-book="${esc(book.id)}" draggable="true" tabindex="0" aria-label="画册 ${esc(book.title)}，右键管理">${responsiveCover(book,'grid',i)}<div class="edition-tile-footer"><h3 data-user-content>${esc(book.title)}</h3><button class="ibtn ${book.liked?'on':''}" data-act="star" data-id="${book.id}" aria-label="${esc(localeString(book.liked?'取消星标':'星标收藏'))}">${icon('star','sm')}</button>${shelfIcon('more','book-menu','画册操作',`data-id="${book.id}"`)}</div><div class="edition-tile-meta"><span>${localeString('{count} 幕',{count:book.totalSteps})}</span><span class="status-label">${shelfStatus(book)}</span><time>${dateFmt(book.createdAt)}</time></div>${ui.bulk||ui.selected.size?`<label class="shelf-select"><input type="checkbox" data-select-book="${book.id}" ${ui.selected.has(book.id)?'checked':''}>${localeString('选择这本画册')}</label>`:''}</article>`).join('');
  return prefix+`<div class="shelf-grid">${tiles}</div>${paging.pages>1?`<nav class="shelf-pages" aria-label="${esc(localeString('第 {current} / {total} 页',{current:paging.index+1,total:paging.pages}))}">${shelfButton('up','shelf-page-prev','上一页',paging.index===0?'disabled':'','small')}<span class="shelf-page-number">${localeString('第 {current} / {total} 页',{current:paging.index+1,total:paging.pages})}</span>${shelfButton('down','shelf-page-next','下一页',paging.index===paging.pages-1?'disabled':'','small')}</nav>`:''}`;
}


function displayPreferencesHTML(){const p=state.settings.presentation;return `<section class="display-preferences" id="display-preferences"><h2>${localeString('显示与语言')}</h2><p>${localeString('调整阅读习惯，让工作室更适合你。')}</p><div class="display-preference-row"><div class="grow"><strong>${localeString('语言 / Language')}</strong><p>${localeString('只切换界面文字，不翻译画册名称、提示词或台词。')}</p></div><select id="interface-language" data-no-translate aria-label="Interface language / 界面语言"><option value="zh-CN" ${p.language==='zh-CN'?'selected':''}>简体中文</option><option value="en" ${p.language==='en'?'selected':''}>English</option></select></div><div class="display-preference-row"><div class="grow"><strong>${localeString('首页展示方式')}</strong><p>${localeString('保留大图欣赏，或快速浏览更多画册。')}</p></div><select id="default-shelf-view" aria-label="${esc(localeString('首页展示方式'))}">${opt('showcase',localeString('精选展示'),p.homeLayout)}${opt('grid',localeString('紧凑网格'),p.homeLayout)}</select></div><div class="display-preference-row"><div class="grow"><strong>${localeString('默认阅读模式')}</strong><p>${localeString('打开一本画册时，默认从卷轴阅读开始。')}</p></div><select id="default-room-view" aria-label="${esc(localeString('默认阅读模式'))}">${[['webtoon','卷轴 · 连续阅读'],['spread','对开本 · 双页画册'],['gallery','画廊 · 大图与胶卷']].map(([id,label])=>opt(id,localeString(label),p.defaultReaderMode)).join('')}</select></div><div class="display-preference-row"><div class="grow"><strong>${localeString('艺术字体风格')}</strong><p>${localeString('只改变界面标题与装饰文字，编辑区保持易读。')}</p></div><select id="display-lettering" aria-label="${esc(localeString('艺术字体风格'))}">${[['editorial','书刊 · 雅致衬线'],['calligraphy','手札 · 东方笔意'],['classic','典藏 · 古典书卷']].map(([id,label])=>opt(id,localeString(label),p.lettering)).join('')}</select></div><div class="font-sample" data-no-translate><span class="sample-cn">海风有信，画面有声。</span><span class="sample-en">A story worth keeping.</span></div><p class="font-status-note" id="collection-font-status">${localeString('丰富字体按需下载；离线时自动使用系统字体。')}</p></section>`}


function decorateDisplayPreferences(){if(ui.workspace!==5)return;const content=$('#studio-settings-content');if(!content)return;$('#display-preferences')?.remove();$('#art-font-status')?.closest('.settings-section')?.remove();if(!createWorkspaceChromePolicy().ownsDisplayPreferences(studioUI.settingsTab))return;$('[data-studio-pref="reader.defaultMode"]')?.closest('.settings-row')?.remove();content.insertAdjacentHTML('afterbegin',displayPreferencesHTML());updateCollectionFontStatus()}


function fitSidebarWordmark(){
  const holder=$('.sidebar .brand-text'),wordmark=$('.sidebar .brand-name');
  if(!holder||!wordmark||holder.clientWidth<=0)return;
  const preferred=state.settings.presentation.lettering==='editorial'?24:22;
  wordmark.style.setProperty('--sidebar-brand-font-size',preferred+'px');
  const measured=Math.max(wordmark.scrollWidth,wordmark.getBoundingClientRect().width);
  const size=createWorkspaceChromePolicy().brandFontSize(preferred,holder.clientWidth,measured);
  if(size>0)wordmark.style.setProperty('--sidebar-brand-font-size',size.toFixed(3)+'px');
}


function scheduleSidebarWordmarkFit(){cancelAnimationFrame(displayUI.brandFrame);displayUI.brandFrame=requestAnimationFrame(fitSidebarWordmark)}


function observeSidebarWordmark(){
  displayUI.brandObserver?.disconnect();const holder=$('.sidebar .brand-text');
  if(window.ResizeObserver&&holder){displayUI.brandObserver=new ResizeObserver(scheduleSidebarWordmarkFit);displayUI.brandObserver.observe(holder)}
  fitSidebarWordmark();
}


function applyDisplayAttributes(){const p=state.settings.presentation;if(!displayUI.locale)displayUI.locale=extendStudioLocaleCatalog(createStudioLocaleCatalog(p.language));displayUI.locale.setLanguage(p.language);document.documentElement.lang=p.language==='en'?'en':'zh-CN';document.documentElement.dataset.lettering=p.lettering;scheduleSidebarWordmarkFit();}


function updateCollectionFontStatus(){const label=$('#collection-font-status');if(label)label.textContent=localeString(displayUI.fontStatus==='loaded'?'字体已就绪':displayUI.fontStatus==='loading'?'正在加载字体，当前使用系统字体。':'丰富字体按需下载；离线时自动使用系统字体。');if(label&&displayUI.fontStatus==='fallback')label.textContent=localeString('字体加载不可用，已使用系统字体。')}


async function verifyDisplayTypeface(){
  if(!document.fonts?.load){displayUI.fontStatus='fallback';updateCollectionFontStatus();return}
  const sequence=(displayUI.fontSequence||0)+1;displayUI.fontSequence=sequence;displayUI.fontStatus='loading';updateCollectionFontStatus();
  const variant=state.settings.presentation.lettering,faces=variant==='calligraphy'?[['Ma Shan Zheng','海风有信'],['Bodoni Moda','Story']]:variant==='classic'?[['Noto Serif SC','海风有信'],['DM Serif Display','Story']]:[['Noto Serif SC','海风有信'],['Cormorant Garamond','Story']];let timer;
  try{const loaded=await Promise.race([Promise.all(faces.map(([name,sample])=>document.fonts.load('400 24px "'+name+'"',sample))),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),10000)})]);if(sequence===displayUI.fontSequence)displayUI.fontStatus=loaded&&loaded.every(list=>list.length>0)?'loaded':'fallback'}catch(e){if(sequence===displayUI.fontSequence)displayUI.fontStatus='fallback'}finally{clearTimeout(timer);updateCollectionFontStatus()}
}


function loadCollectionFonts(){if(state.settings.presentation.fonts===false)return;const existing=$('#collection-font-stylesheet');if(existing){void verifyDisplayTypeface();return}displayUI.fontStatus='loading';const link=document.createElement('link');link.id='collection-font-stylesheet';link.rel='stylesheet';link.href='https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,500;1,400&family=DM+Serif+Display:ital@0;1&family=Ma+Shan+Zheng&display=swap';link.onload=()=>void verifyDisplayTypeface();link.onerror=()=>{displayUI.fontStatus='fallback';updateCollectionFontStatus()};$('#art-font-stylesheet')?.addEventListener('load',()=>void verifyDisplayTypeface(),{once:true});document.head.append(link)}


function changeInterfaceLanguage(language){if(!['en','zh-CN'].includes(language))return;state.settings.presentation.language=language;displayUI.languageTouched=true;try{localStorage.setItem('cc-language',language)}catch(e){}applyDisplayAttributes();save();localizeWorkspace();decorateDisplayPreferences();if(ui.workspace===0){$('#main').innerHTML='<div class="art-fade">'+renderResponsiveCollection()+'</div>';fitVisibleCovers()}updateCollectionFontStatus()}


function setShelfLayout(mode){state.settings.presentation.homeLayout=displayModel.mode(mode);displayUI.page=0;try{localStorage.setItem('cc-home-layout',state.settings.presentation.homeLayout)}catch(e){}save();if(ui.workspace===0)render();else decorateDisplayPreferences()}


function requestDemoCleanupSave(){if(!displayUI.cleanupPending||rt.booting||displayUI.cleanupTimer)return;if(!ComfyComic.sync?.runtime.loaded)return;displayUI.cleanupTimer=setTimeout(()=>{displayUI.cleanupTimer=null;if(!displayUI.cleanupPending)return;displayUI.cleanupPending=false;save(true)},300)}


async function deleteCollection(collectionId=state.activeProjectId){
  if(activeJobs()||backendRuntime.loading||disk.busy||disk.connecting)throw Error(localeString('请先等待当前生成、审校、上传或保存任务结束，再删除画册集。'));
  flushEditor();saveStoryInputs();closeProjectPopover();
  const original=state,replacement={id:uid('collection'),title:localeString('未命名画册集'),createdAt:Date.now()},preview=planCollectionRemoval(state,collectionId,replacement),s=preview.summary;
  const description=[s.title,localeString('将移除 {books} 本画册、{plans} 份创作草稿、{templates} 套专属分镜和 {sets} 组设定。',{books:s.books,plans:s.plans,templates:s.templates,sets:s.variableSets}),localeString('关联的角色记录、对话与队列任务也会移除；全局工作流和导出模板保留。'),s.sharedAssets?localeString('另外 {count} 项被其他画册集使用的资产会保留。',{count:s.sharedAssets}):'',s.lastCollection?localeString('这是最后一个画册集，删除后会建立一个新的空白画册集。'):'',localeString('无法撤销，建议先导出备份。磁盘文件的清理由你的后端策略决定。')].filter(Boolean).join('\n\n');
  if(!await confirmAction(localeString('确定删除这个画册集？'),description,localeString('删除画册集')))return;
  if(state!==original||activeJobs()||backendRuntime.loading||disk.busy||disk.connecting)throw Error(localeString('工程在确认期间发生变化，请重新检查后删除。'));
  const deletion=planCollectionRemoval(state,collectionId,replacement);if(JSON.stringify(deletion.summary)!==JSON.stringify(s))throw Error(localeString('工程在确认期间发生变化，请重新检查后删除。'));
  validateState(deletion.next);
  if($('#reader').open)closeReader();if($('#modal').open)closeModal();$('#assistant').hidden=true;
  state=deletion.next;ensureStudioState();ui.workspace=0;ui.selected.clear();ui.bulk=false;ui.search='';ui.filter='all';ui.bookId=null;ui.step=0;ui.frameIndex=0;ui.templateId=projectTemplates()[0]?.id;ui.storyTemplateId=ui.templateId;ui.storyRowId=projectRows()[0]?.id;ui.exportIds=[];
  createUI.planId=projectPlans()[0]?.id||null;createUI.setId=projectVariableSets()[0]?.id||null;artUI.labBookId=null;artUI.labIndex=0;studioUI.assistantUndo=null;studioUI.assistantTargetId=null;studioUI.exportDraft=null;displayUI.featuredIndex=0;displayUI.page=0;
  save(true);render();toast(localeString(ComfyComic.sync?.runtime.loaded?'画册集已删除，正在等待后端保存确认。':'画册集已删除；当前尚未连接后端，请保存或导出备份。'));
}


function ensureRoomDefaultChoice(mode){if(!['webtoon','spread','gallery'].includes(mode))return;const p=state.settings.presentation;p.defaultReaderMode=mode;p.readerMode=mode;state.settings.studio.reader.defaultMode=({webtoon:'webtoon',spread:'manga',gallery:'focus'})[mode];save()}

function createReaderPresentationModel(totalSteps = 0, mode = 'webtoon') {
  const state = { total: Math.max(0, Number(totalSteps) || 0), index: 0, mode, info: false, filmstrip: false };
  const seek = index => {
    state.index = Math.max(0, Math.min(Math.max(0, state.total - 1), Number(index) || 0));
    return state.index;
  };
  return {
    state,
    seek,
    next() { return seek(state.index + (state.mode === 'spread' ? 2 : 1)); },
    previous() { return seek(state.index - (state.mode === 'spread' ? 2 : 1)); },
    setMode(next) { if (['spread', 'webtoon', 'gallery'].includes(next)) state.mode = next; },
    spread() {
      const first = Math.floor(state.index / 2) * 2;
      return [first < state.total ? first : null, first + 1 < state.total ? first + 1 : null];
    }
  };
}

function highlightedPromptHTML(value, definitions, values = {}) {
  const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&#60;', '>': '&#62;', '"': '&quot;', "'": '&#39;' })[char]);
  return createFreePromptPolicy().tokens(value, definitions).map(token => token.type === 'variable'
    ? '<mark class="' + (!Object.hasOwn(values, token.key) || values[token.key] === '' ? 'empty-token' : '') + '" data-prompt-variable="' + escape(token.key) + '">' + escape(token.value) + '</mark>'
    : escape(token.value)).join('');
}


// Market scrolling has no render loop. Only search results are replaced, after typing settles.
const marketPerformance={searchTimer:null};
function scheduleMarketSearch(){
  clearTimeout(marketPerformance.searchTimer);const root=$('#market-content');
  marketPerformance.searchTimer=setTimeout(()=>{
    if(!root?.isConnected||!$('#modal').open||root!==$('#market-content'))return;
    const query=ui.marketSearch.toLowerCase(),items=catalog.filter(c=>(ui.marketTab==='all'||ui.marketTab===c.type)&&[c.title,c.desc,c.tags,c.author].join(' ').toLowerCase().includes(query)),installed=new Set(state.installedPackages.map(p=>p.id)),grid=$('.market-grid',root);
    if(grid){grid.innerHTML=items.map(c=>marketCardHTML(c,installed.has(c.id))).join('')||'<div class="empty">没有匹配的组件，试试其他标签。</div>';localizeWorkspace(grid)}
  },120);
}
function installMarketPerformance(){
  const previous=renderMarket;
  renderMarket=function(){const dialog=$('#modal'),body=$('#modal-body'),position=body?.scrollTop||0,raw=$('#raw-url')?.value;clearTimeout(marketPerformance.searchTimer);previous();dialog.classList.add('market-dialog');if(raw!==undefined&&$('#raw-url'))$('#raw-url').value=raw;if(body)body.scrollTop=position;localizeWorkspace($('#market-content'))};
  $('#modal').addEventListener('close',()=>{clearTimeout(marketPerformance.searchTimer);$('#modal').classList.remove('market-dialog')});
}
