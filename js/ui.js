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

function queueHTML(){const q=state.queue.filter(q=>bookBy(q.bookId)).slice(-10).reverse();return q.length?q.map(q=>{const b=bookBy(q.bookId),pct=q.indices.length?Math.round(q.done/q.indices.length*100):100;return`<div class="queue-item">${imgTag(coverImage(b),b.title,`class="queue-thumb" data-book="${b.id}" data-step="0"`)}<div class="grow"><h4>${esc(b.title)}</h4><div class="tiny muted mono">${esc(q.id.slice(-12))} · ${q.done} / ${q.indices.length} 幕</div></div><div class="queue-progress"><div class="row between tiny"><span class="soft">${({pending:'等待执行',running:'正在渲染',paused:'已暂停',complete:'已完成',canceled:'已中止',failed:'执行失败'})[q.status]}</span><span class="mono muted">${pct}%</span></div><div class="progress"><i style="width:${pct}%"></i></div><div class="tiny muted" style="margin-top:7px">${q.status==='running'&&state.settings.comfy.mode==='mock'?'预计剩余 '+Math.max(1,q.indices.length-q.done)*2+' 秒':'已就绪帧将被保留'}</div></div>${ibtn('book','read','查看画册',`data-id="${b.id}"`)}</div>`}).join(''):`<div class="empty" style="padding:28px">队列为空。勾选角色，把灵感交给生产线。</div>`}


function renderLogs(){if(!$('#log-body'))return;$('#log-body').innerHTML=rt.logs.filter(l=>ui.logFilter==='all'||l.level==='error').map(l=>`<div class="log-${l.level}"><span class="log-time">${new Date(l.time).toLocaleTimeString('en-GB')}</span>${esc(l.message)}</div>`).join('')||'<div class="muted">等待新的生产任务...</div>';$('#log-body').scrollTop=$('#log-body').scrollHeight}


function updateQueueUI(){if($('#queue-list'))$('#queue-list').innerHTML=queueHTML();renderStatus();const n=$('.top-queue b');if(n)n.textContent=state.queue.filter(q=>['pending','running'].includes(q.status)).length;refreshGallery()}


function setting(path,value,type='text',extra=''){return input(path,value,type,`data-setting="${path}" ${extra}`)}

function renderXMLStudio(){return`<div class="pipeline-grid"><section class="panel" style="align-self:start"><h3 class="panel-title">${icon('story')}从 0 到 1 设计模板</h3>${field('题材与构思',`<textarea id="xml-idea" placeholder="例如：一位少女在废弃的海边车站，收到来自十年后的信。">${esc(ui.xmlIdea||'夏日的海边，一封来自未来的信。')}</textarea>`)}${field('篇幅幕数',`<select id="xml-count">${[4,6,8,12].map(n=>opt(n,n+' 幕',ui.xmlCount||6)).join('')}</select>`)}<label class="row small soft"><input type="checkbox" data-setting="xml.separate" ${state.settings.xml.separate?'checked':''}>使用独立大模型配置</label><div style="margin-top:16px">${field('独立 Base URL',setting('xml.baseUrl',state.settings.xml.baseUrl))}${field('独立模型名称',setting('xml.model',state.settings.xml.model))}${field('独立 API Key',setting('xml.key',state.settings.xml.key,'password'))}</div><div class="help">生成请求自动替换 {panelCount}，严格校验中文 XML 根节点与逐幕字段。</div><div class="row" style="margin-top:18px">${btn('生成 XML 模板','spark','generate-xml','','primary')}</div></section><section class="panel"><h3 class="panel-title">${icon('terminal')}标准 XML 编辑与校验</h3><textarea id="xml-output" class="code-area" spellcheck="false" placeholder="生成或粘贴标准 XML 模板...">${esc(ui.xmlOutput||'')}</textarea><div class="notice" style="margin-top:16px">必须包含「模板 / 标题 / 简介 / 分镜列表」，每幕必须包含「名称 / 提示词 / 剧情」。</div><div class="modal-footer">${btn('校验结构','shield','validate-xml')}${btn('转录为正式模板','plus','import-xml','','primary')}</div></section></div>`}


function scriptModal(id){const r=rowBy(id),t=currentTemplate();if(!t)throw Error('请先创建模板。');ui.scriptRow=id;ui.scriptTemplate=t.id;const v=ensureManual(r,t);modal(r.character+' · 逐幕台词',`${field('版本名称',input('title',v.title,'text','id="script-title"'))}${t.frames.map((f,i)=>field(pad(i+1)+' · '+esc(f.name),`<textarea data-script-caption="${i}" style="min-height:65px">${esc(v.captions[i]||captionFor(r,t,i))}</textarea>`)).join('')}<div class="modal-footer">${btn('为此角色重新推演','spark','script-regenerate')}${btn('保存专属剧本','disk','script-save','','primary')}</div>`,t.title+' · 剧情按角色 × 模板独立存储')}

async function interruptLegacyQueue(){rt.controller?.abort();rt.paused=false;for(const q of state.queue)if(['pending','paused'].includes(q.status)){q.status='canceled';const b=bookBy(q.bookId);if(b)b.status='canceled'}if(state.settings.comfy.mode==='real'){const results=await Promise.allSettled([request(baseURL()+'/interrupt',post({}),5000),request(baseURL()+'/queue',post({clear:true}),5000)]);log(results.every(x=>x.status==='fulfilled')?'已物理中断 GPU 并清空服务端队列。':'本地任务已停，部分物理中断请求失败，请检查 ComfyUI。',results.every(x=>x.status==='fulfilled')?'info':'warn')}save();updateQueueUI()}


async function dryRun(){flushEditor();const t=currentTemplate(),r=projectRows()[0];if(!t||!r)throw Error('请先创建一个角色和模板。');if($('#dry-preview'))$('#dry-preview').innerHTML='<i class="dot live"></i><p>正在执行单帧验证...</p>';try{const result=await generateFrame(t.frames[0],r,new AbortController().signal,0);rt.preview=result.image;if($('#dry-preview'))$('#dry-preview').innerHTML=imgTag(result.image,'测试出图');toast(result.offlineFallback?'GPU 失败，显示本地降级预览。':'单帧测试完成')}catch(e){if($('#dry-preview'))$('#dry-preview').textContent=e.message;throw e}}


function llmMock(cfg=state.settings.llm){return cfg.mode==='mock'}

function parseJson(text){const raw=String(text).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();return JSON.parse(raw)}


function xmlEscape(s){return esc(s).replace(/&#39;/g,'&apos;')}


function slots(b){return readerSequence(b)}


function preserveFloating(){for(const id of ['#assistant','#toasts']){const el=$(id);if(el&&$('#reader').contains(el))document.body.append(el)}}

function pageHTML(b,s){return s?`<div class="page-art ${rt.redraw.has(b.id+':'+s.stepIndex)?'loading':''}" data-page="${b.id}:${s.stepIndex}">${imgTag(s.image,s.name,`data-page-img="${b.id}:${s.stepIndex}" data-book="${b.id}" data-step="${s.stepIndex}"`)}</div>`:'<div class="page-art"><div class="blank-page">THIS STORY CONTINUES</div></div>'}

function syncInspector(){$$('[data-inspector]',$('#reader')).forEach(e=>{e.classList.toggle('active',Number(e.dataset.inspector)===ui.step);e.classList.toggle('refining',rt.redraw.has(ui.bookId+':'+e.dataset.inspector))});const b=bookBy(ui.bookId);if($('#page-position')&&b)$('#page-position').textContent=pad(ui.step+1)+' / '+pad(b.totalSteps)}

function hotReplace(id,i,src){$$('[data-page-img]').filter(el=>el.dataset.pageImg===id+':'+i).forEach(el=>{el.src=src});if(ui.bookId===id){const s=bookBy(id)?.steps.find(s=>s.stepIndex===i),area=$('#critique-'+i),panel=$(`[data-inspector="${i}"]`);if(area)area.innerHTML=critiqueHTML(s?.critique,i);if(s&&panel){$('.inspector-step-head strong',panel).textContent=s.name;$('.inspector-step-head small',panel).textContent='SCENE '+pad(i+1);$('.caption',panel).textContent=s.caption;const critique=$('[data-act="critique"]',panel);if(critique)critique.disabled=false;const webCaption=$(`[data-scroll-step="${i}"] .page-caption`,$('#reader'));if(webCaption)webCaption.textContent=s.caption}}}


function loadingPage(id,i,on){const key=id+':'+i;on?rt.redraw.add(key):rt.redraw.delete(key);$$('[data-page]').filter(e=>e.dataset.page===key).forEach(e=>e.classList.toggle('loading',on));if(ui.bookId===id)$(`[data-inspector="${i}"]`)?.classList.toggle('refining',on);const thumb=$(`[data-page-img="${key}"]`,$('.reader-inspector')||document);if(thumb)thumb.style.opacity=on?'.35':'1'}

async function maskModal(i){const b=bookBy(ui.bookId),s=b?.steps.find(s=>s.stepIndex===i);if(!s)throw Error('请先生成本页。');let jpg;try{jpg=await rasterJPEG(s.image,900)}catch(e){if(!s.offlineImage)throw e;jpg=await rasterJPEG(s.offlineImage,900)}modal('局部蒙版 · 第 '+(i+1)+' 幕',`<div class="notice">在画面上涂抹，透明区域将作为重绘蒙版。真实精修需 LoadImage → VAEEncodeForInpaint 工作流。</div><canvas id="mask-canvas" class="mask-canvas" style="display:block;margin:18px auto;background:repeating-conic-gradient(#888 0 25%,#bbb 0 50%) 0/16px 16px"></canvas><div class="row">画笔大小 <input id="mask-brush" type="range" min="5" max="90" value="35"><span class="spacer"></span>${btn('保存蒙版','check','save-mask',`data-key="${b.id}:${i}"`,'primary')}</div>`);const img=new Image();img.src=jpg;await img.decode();const c=$('#mask-canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);let drawing=false;const draw=e=>{if(!drawing)return;const box=c.getBoundingClientRect();ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc((e.clientX-box.left)*c.width/box.width,(e.clientY-box.top)*c.height/box.height,Number($('#mask-brush').value),0,Math.PI*2);ctx.fill()};c.onpointerdown=e=>{drawing=true;c.setPointerCapture(e.pointerId);draw(e)};c.onpointermove=draw;c.onpointerup=()=>drawing=false;c.onpointercancel=()=>drawing=false}

function standaloneFlip(){document.querySelectorAll('.flipbook').forEach(book=>{const pages=[...book.querySelectorAll('.sheet')];let spread=0;function paint(){pages.forEach((p,i)=>p.hidden=Math.floor(i/2)!==spread);book.querySelector('.counter').textContent=(spread+1)+' / '+Math.ceil(pages.length/2);book.querySelector('.sheets').classList.remove('turn');void book.offsetWidth;book.querySelector('.sheets').classList.add('turn')}book.querySelector('.prev').onclick=()=>{spread=Math.max(0,spread-1);paint()};book.querySelector('.next').onclick=()=>{spread=Math.min(Math.ceil(pages.length/2)-1,spread+1);paint()};paint()})}

function chineseNumber(s){if(/^\d+$/.test(s))return Number(s);const digits={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};if(s.includes('十')){const p=s.split('十');return(digits[p[0]]||1)*10+(digits[p[1]]||0)}return digits[s]||1}


function textModal(title,label,value,callback,description=''){rt.modalSubmit=callback;modal(title,`<form id="text-form">${field(label,input('value',value,'text','id="text-value" required autofocus maxlength="150"'))}<div class="modal-footer">${btn('取消','','close-modal')}${btn('确认','check','text-submit','','primary')}</div></form>`,description);setTimeout(()=>$('#text-value')?.focus(),40)}

function backupModal(){modal('工程备份与迁移',`<div class="notice">备份包含所有企划、模板、角色变量、剧情版本、画册图片索引、渲染队列、工作流映射及配置。恢复前会执行结构校验与覆盖确认。</div><div class="row" style="margin-top:20px">${btn('导出全量工程 JSON','download','backup-export','','primary')}${btn('从 JSON 恢复','upload','import-project')}</div><label class="row small soft" style="margin-top:17px"><input type="checkbox" id="backup-secrets">包含 API 密钥（敏感，请妥善保管）</label><div class="divider"></div><h3 class="panel-title">${icon('disk')}双向远端存储</h3>${field('自有 JSON 存储端点',setting('syncUrl',state.settings.syncUrl),'此端点需支持 GET 与 PUT application/json，并允许浏览器 CORS。未配置时只保存在本地，不会上传数据。')}<div class="row">${btn('推送至远端','upload','sync-push')}${btn('拉取远端工程','download','sync-pull')}</div><p class="help" id="sync-status">${esc(rt.syncStatus||'远端未同步 · 防冲刷保护已开启')}</p><div class="divider"></div><p class="tiny muted">当前工程：${state.projects.length} 个企划 / ${state.books.length} 本画册 / ${state.templates.length} 个模板</p>`,'LOCAL FIRST / FULL PROJECT BACKUP')}


function characterModal(id){const r=rowBy(id);ui.characterId=id;modal(r.character+' · 角色资产',`${field('角色特征 / Trigger Prompt',input('trigger',r.trigger||'','text','id="character-trigger"'))}${field('LoRA 文件绑定',input('lora',r.lora||'','text','id="character-lora" placeholder="例如 nanami_v2.safetensors"'))}<div class="grid3">${[['front','正面立绘'],['side','侧面立绘'],['full','全身立绘']].map(([k,l])=>`<div><div class="label">${l}</div><button class="preview-box" style="width:100%;height:150px;min-height:150px" data-act="character-reference" data-key="${k}">${r.references?.[k]?imgTag(r.references[k],l,'style="height:145px"'):icon('upload')+'<p>上传参考图</p>'}</button></div>`).join('')}</div><p class="help">LoRA 名称会写入工作流的 LoraLoader 节点。绑定 LoadImage 后，可使用正面立绘作为图生图输入。</p><div class="modal-footer">${btn('保存角色资产','disk','save-character','','primary')}</div>`,'本地角色参考与一致性治理',true)}


function marketModal(){modal('模板与插件','<div id="market-content"></div>','精心整理的创作组件，装进你的本地工作室。',true);renderMarket()}


function renderMarket(){const q=ui.marketSearch.toLowerCase(),items=catalog.filter(c=>(ui.marketTab==='all'||ui.marketTab===c.type)&&[c.title,c.desc,c.tags].join(' ').toLowerCase().includes(q));$('#market-content').innerHTML=`<div class="tabbar" style="gap:18px">${[['all','全部'],['templates','分镜剧本'],['characters','角色资产'],['workflows','工作流'],['rules','审校规则']].map(([v,l])=>`<button class="tab ${v===ui.marketTab?'active':''}" data-act="market-tab" data-tab="${v}">${l}</button>`).join('')}</div><div class="row" style="margin-top:18px"><div class="search-field" style="max-width:none">${icon('search')}<input id="market-search" value="${esc(ui.marketSearch)}" placeholder="搜索组件、作者或标签..." aria-label="搜索模板与插件"></div></div><div class="row wrap" style="margin-top:12px">${['治愈','青春','赛博','一致性'].map(t=>btn(t,'','market-tag',`data-tag="${t}"`,'small ghost')).join('')}<span class="spacer"></span><span class="tiny muted">内置包 · 离线可安装</span></div><div class="market-grid">${items.map(c=>{const installed=state.installedPackages.some(p=>p.id===c.id);return`<article class="market-item"><div class="row accent">${icon(c.icon)}<span class="spacer"></span><span class="tiny">${icon('star','sm')} ${c.score}</span></div><h3>${esc(c.title)}</h3><p>${esc(c.desc)}</p><div class="row"><span class="grow tiny muted">${esc(c.author)} · v${c.version}</span>${btn(installed?'卸载':'安装',installed?'check':'download','market-install',`data-id="${c.id}"`,'small '+(installed?'':'primary'))}</div></article>`}).join('')||'<div class="empty">没有匹配的组件。</div>'}</div><div class="divider"></div><h3 class="panel-title">从开源仓库导入</h3><div class="row"><input id="raw-url" placeholder="GitHub / Gitee Raw JSON 链接" aria-label="开源组件 JSON 链接">${btn('导入新副本','download','import-raw')}</div><div class="help">GitHub /blob/ 链接自动转为 Raw。外部 JSON 仅作为数据解析，绝不执行脚本。</div>`}


async function installPackage(id){const c=catalog.find(c=>c.id===id),installed=state.installedPackages.find(p=>p.id===id);if(installed){if(!await confirmAction('卸载 '+c.title+'？','已生成画册会被保留。被画册引用的模板与角色不会删除。','卸载'))return;state.templates=state.templates.filter(t=>!installed.assetIds.includes(t.id)||state.books.some(b=>b.templateId===t.id));state.rows=state.rows.filter(r=>!installed.assetIds.includes(r.id)||state.books.some(b=>b.rowId===r.id));state.settings.comfy.presets=state.settings.comfy.presets.filter(p=>!installed.assetIds.includes(p.id));if(c.type==='rules')state.settings.autoCritique=false;state.installedPackages=state.installedPackages.filter(p=>p.id!==id)}else{const assetIds=[];if(c.type==='templates'){const t={id:uid('tpl'),projectId:state.activeProjectId,title:c.title,outline:c.desc,frames:Array.from({length:id==='noir-pack'?8:6},(_,i)=>makeFrame(i)),createdAt:Date.now()};state.templates.push(t);assetIds.push(t.id)}if(c.type==='characters'){const r=makeRow(0,state.activeProjectId);r.bookTitle='新角色企划';state.rows.push(r);assetIds.push(r.id)}if(c.type==='workflows'){const p={id:uid('wf'),title:c.title,workflow:clone(defaultWorkflow),mapping:clone(state.settings.comfy.mapping)};state.settings.comfy.presets.push(p);assetIds.push(p.id)}if(c.type==='rules')state.settings.autoCritique=true;state.installedPackages.push({id,title:c.title,type:c.type,assetIds})}save(true);renderMarket();renderShell();toast(installed?'组件已卸载，引用资产已保留。':'组件已安装至本地工程。')}


async function importRaw(){let url=new URL($('#raw-url').value.trim());if(!['http:','https:'].includes(url.protocol))throw Error('仅支持 HTTP(S) JSON 链接。');if(url.hostname==='github.com'&&url.pathname.includes('/blob/'))url=new URL('https://raw.githubusercontent.com'+url.pathname.replace('/blob/','/'));if(url.hostname==='gitee.com')url.pathname=url.pathname.replace('/blob/','/raw/');const data=await(await request(url.href,{},15000)).json();if(!await confirmAction('导入外部 JSON 资产？','将作为独立新副本导入，不覆盖现有资产。','校验并导入'))return;if(data.class_type||Object.values(data).every(n=>n?.class_type)){validateWorkflow(data);state.settings.comfy.presets.push({id:uid('wf'),title:'外部工作流',workflow:data,mapping:clone(state.settings.comfy.mapping)});save()}else importTemplateObject(data);toast('外部资产已校验并导入。')}

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
case'delete-storyboard-template':await deleteStoryboardTemplate(d.id);break;
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
case'scan-resume':inspectQueueGaps();break;
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

function encodeMetadata(value){const bytes=new TextEncoder().encode(JSON.stringify(value));let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary)}


function decodeMetadata(text){return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text),c=>c.charCodeAt(0))))}

function workspaceVisible(index){return index===5||state.settings.studio?.visibility?.[moduleKeys[index]]!==false;}


function featureEnabled(key){return state.settings.studio?.features?.[key]!==false;}


function switchControl(path,label,value,disabled=false){return `<label class="switch"><input type="checkbox" role="switch" data-studio-pref="${path}" aria-label="${esc(label)}" ${value?'checked':''} ${disabled?'disabled':''}><span class="switch-track" aria-hidden="true"></span></label>`;}

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

function marketCardHTML(c,installed){
  return `<article class="market-item ${c.type==='exports'?'market-item-export':''}" data-market-id="${esc(c.id)}">${c.type==='exports'?`<button class="market-preview-strip" style="width:100%;background:${c.options.background};--mini-accent:${c.options.accent}" data-act="et-market-preview" data-id="${c.id}" aria-label="预览 ${esc(c.title)}"><span class="mini-page"><i></i><span></span></span><span class="mini-page"><i></i><span></span></span></button>`:`<div class="row accent">${icon(c.icon)}<span class="spacer"></span><span class="tiny">v${esc(c.version)}</span></div>`}<div class="row"><h3 data-user-content class="grow" style="margin:0 0 7px">${esc(c.title)}</h3>${c.type==='exports'?'<span class="utility-caption">HTML / CSS</span>':''}</div><p data-user-content>${esc(c.desc)}</p><div data-user-content class="tiny muted" style="margin-bottom:13px">${esc(c.author)} · v${esc(c.version)}</div><div class="row">${c.type==='exports'?btn('预览','eye','et-market-preview',`data-id="${c.id}"`,'small')+btn('下载模板','download','et-market-download',`data-id="${c.id}"`,'small'):''}<span class="spacer"></span>${btn(installed?'卸载':'安装',installed?'check':'plus','market-install',`data-id="${c.id}"`,'small '+(installed?'':'primary'))}</div></article>`;
}

function renderStudioMarket(){
  const q=ui.marketSearch.toLowerCase(),items=catalog.filter(c=>(ui.marketTab==='all'||ui.marketTab===c.type)&&[c.title,c.desc,c.tags,c.author].join(' ').toLowerCase().includes(q));
  const installedIds=new Set(state.installedPackages.map(p=>p.id));
  $('#market-content').innerHTML=`<div class="tabbar market-subtabs" style="gap:20px">${[['all','全部'],['exports','画册 HTML 模板'],['templates','分镜剧本'],['characters','角色资产'],['workflows','工作流'],['rules','审校规则']].map(([v,l])=>`<button class="tab ${ui.marketTab===v?'active':''}" data-act="market-tab" data-tab="${v}">${l}</button>`).join('')}</div><div class="row" style="margin-top:18px"><div class="search-field" style="max-width:none">${icon('search')}<input id="market-search" value="${esc(ui.marketSearch)}" placeholder="搜索画册模板、作者或标签..." aria-label="搜索市场资源"></div>${studioUI.returnToExport?btn('返回画册导出','arrow','et-return-export','','small'):''}</div><div class="row wrap" style="margin-top:12px">${['画册','治愈','赛博','极简'].map(t=>btn(t,'','market-tag',`data-tag="${t}"`,'small ghost')).join('')}<span class="spacer"></span><span class="tiny muted">内置精选 · 可离线安装与下载</span></div><div class="market-grid">${items.map(c=>marketCardHTML(c,installedIds.has(c.id))).join('')||'<div class="empty">没有匹配的组件，试试其他标签。</div>'}</div><div class="divider"></div><h3 class="panel-title">从 GitHub / Gitee / 自有仓库导入</h3><div class="row"><input id="raw-url" placeholder="粘贴 Raw JSON 或 HTML 模板链接" aria-label="外部组件地址">${btn('解析并导入','download','import-raw')}</div><div class="help">支持画册 HTML 模板包与分镜、工作流 JSON。GitHub /blob/ 链接自动转换为 Raw，外部模板须通过离线安全校验。</div>`;
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

function checkedPath(path){if(typeof path!=='string'||path.length>2500)throw Error('磁盘文件路径不合法。');const parts=path.split('/');if(!parts.length||parts.some(x=>!x||x==='.'||x==='..'||/[\\\u0000-\u001f]/.test(x)))throw Error('拒绝越界文件路径：'+path);return parts}


function parentPath(path){return checkedPath(path).slice(0,-1).join('/')}


async function dirAt(root,path,create=false){let dir=root;if(!path)return dir;for(const part of checkedPath(path))dir=await dir.getDirectoryHandle(part,{create});return dir}


async function fileAt(root,path,create=false){const parts=checkedPath(path),name=parts.pop(),dir=await dirAt(root,parts.join('/'),create);return dir.getFileHandle(name,{create})}


function imageExtension(type){return({'image/png':'png','image/jpeg':'jpg','image/jpg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'})[String(type).split(';')[0].trim().toLowerCase()]||'png'}


function renderDiskStatus(){
  const root=disk.root?.name||disk.remembered?.name||'选择保存目录';
  $('#statusbar').innerHTML=`<i class="dot ${disk.busy?'live':rt.saved&&disk.root?'':'amber'}"></i><button class="disk-status-action" data-act="storage-settings" data-tip="${esc(disk.lastError||'工程主存储是你授权的真实文件夹。点击管理保存位置与目录权限。')}">${esc(diskStatusText())}</button><span style="opacity:.5;margin-left:9px">${disk.root?'LOCAL FILESYSTEM':'MEMORY ONLY'}</span><div class="spacer"></div><button class="disk-status-action" data-act="storage-settings">${icon('folder','sm')}${esc(root)}</button><span style="margin:0 8px;opacity:.45">|</span><span>Mio v${MIO_VERSION}</span>`;
}

function activeJobs(){return rt.running||rt.llmBusy||rt.chatBusy||rt.redraw.size>0||studioUI.exportBusy||disk.packBusy}


async function downloadDirectoryArchive(){
  if(disk.packBusy)throw Error('目录包正在准备中。');flushEditor();saveStoryInputs();disk.packBusy=true;
  try{toast('正在整理企划、画册与图片目录...');const snapshot=clone(state);snapshot.settings.disk.includeKeys=false;const pack=await buildDiskPackage(snapshot,(message)=>{disk.progress=message;updateDiskSettingsStatus()});const entries=new Map([...pack.directories.map(path=>[path+'/',new Blob([])]),...pack.files]);let missing=0;
    for(const b of snapshot.books)for(const item of b.exports||[]){try{checkedPath(item.path);if(!item.path.startsWith((disk.paths.books[b.id]||'INVALID')+'/导出/'))throw Error('导出路径不属于当前画册');const file=disk.root?await readDiskFile(disk.root,item.path):disk.importedFiles?.get(item.path);if(!file)throw Error('成品文件不可用');entries.set(item.path,file)}catch(e){missing++}}
    if(missing)entries.set('导出成品说明.txt',new Blob(['有 '+missing+' 个历史导出成品不在当前可访问目录内，未包含在本 ZIP。\n原始图片、剧情和模板仍完整包含，可在应用中重新导出 HTML 画册。'],{type:'text/plain'}));
    const archive=await zipDirectory(entries);download(safeFolderName(workspaceName())+'_工作室目录.zip',archive);toast(missing?'目录 ZIP 已下载；'+missing+' 个不可访问的旧导出成品未包含，详见包内说明。':'目录 ZIP 已下载。解压后可作为工作室根目录重新打开。')}
  finally{disk.packBusy=false;disk.progress='';renderStatus();updateDiskSettingsStatus()}
}

function fileBackupHub(){modal('工作室文件与备份',`<div class="disk-info-header">${icon('folder')}<div class="grow"><h3>${esc(workspaceName())}</h3><p>${esc(diskStatusText())}</p></div></div><div class="notice">主存储是你授权的本地文件夹。完整目录保留「企划 / 画册 / 图片」层级；JSON 是便携恢复文件，HTML 是用于阅读的成品画册。</div><div class="divider"></div><div class="stack">${btn(disk.root?'管理当前保存目录':'选择本地工作室目录','folder',disk.root?'storage-settings':'disk-connect','','primary')}${btn('下载完整目录 ZIP','download','disk-archive')}${btn('下载全量工程 JSON','disk','backup-export')}${btn('从 JSON 恢复工程','upload','import-project')}${btn('载入已解压目录（只读）','upload','disk-import-folder')}</div><label class="row small soft" style="margin-top:17px"><input type="checkbox" id="backup-secrets">仅本次 JSON 备份包含其他服务密钥（敏感，不含图像密钥库）</label><div class="help">ZIP 目录包不含 API 密钥。磁盘保存是否包含密钥可在“文件与保存”中独立配置。</div><div class="modal-footer">${btn('高级：自有远端同步','','advanced-sync','','ghost small')}${btn('关闭','','close-modal','','small')}</div>`,'不依赖浏览器缓存保管你的作品。')}

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

function composerBounds(panelHeight,headHeight,contextHeight){const max=Math.max(126,Math.floor(panelHeight-headHeight-contextHeight-48-4));return {min:Math.min(155,max),max:Math.min(430,max)}}

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

function visionProbeImage(){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,256,128);ctx.fillStyle='#238b45';ctx.beginPath();ctx.arc(66,64,29,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d84a42';ctx.fillRect(161,36,56,56);return canvas.toDataURL('image/webp',.85)}

function criticReportHTML(c,i){
  if(!c)return `<div class="help">尚无审校报告。${btn('填写审校 API','settings','critic-settings','','small ghost')}</div>`;
  const real=c.engine==='real';const issues=c.issues?.length?c.issues:[{area:'整体建议',severity:'medium',observation:c.suggestions,fixPrompt:c.suggestions}];
  return `<div class="score-block"><div class="row"><div class="score-ring" style="--score:${c.score}"><span>${c.score.toFixed(1)}</span></div><div class="grow"><strong>${c.score>=9?'S':c.score>=8?'A':c.score>=7?'B':'C'} · ${c.passed?'审校通过':'建议精修'}</strong><div class="tiny muted">${real?'真实视觉报告':'离线演示 / 历史示例'}</div></div></div><p>${esc(c.summary)}</p>${real?`<div class="help">模型 ${esc(c.model||'未知')} · ${c.createdAt?new Date(c.createdAt).toLocaleString('zh-CN'):''}</div>`:'<p class="help">此报告不代表真实模型观察。请配置视觉 API 后重新审校。</p>'}<details><summary>结构与一致性诊断</summary><p><b>解剖：</b>${esc(c.anatomy)}</p><p><b>一致性：</b>${esc(c.consistency)}</p></details>${issues.map((issue,n)=>`<div class="critic-issue"><span class="critic-issue-label">${esc(issue.area)} · ${({high:'优先修改',medium:'建议调整',low:'可选优化'})[issue.severity]||'建议'}</span><p>${esc(issue.observation||'无需额外调整')}</p>${issue.fixPrompt?btn('将此建议填入重绘框','plus','critic-apply-issue',`data-index="${i}" data-issue="${n}"`,'small ghost'):''}</div>`).join('')}<div class="critic-actions">${btn('复制报告','copy','critic-copy-report',`data-index="${i}"`,'small')}${btn('API 设置','settings','critic-settings','','small')}</div></div>`;
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

function githubLocationFields(includeToken=true){const d=releaseUI.githubDraft;return `${field('GitHub 仓库',input('repository',d.repository,'text','id="github-repository" placeholder="your-name/comfycomic-templates" autocomplete="off"'),'填写 owner/repo 或 github.com 仓库地址。')}${field('分支',input('branch',d.branch,'text','id="github-branch" placeholder="留空，读取仓库默认分支" autocomplete="off"'))}${field('仓库内文件路径',input('path',d.path,'text','id="github-path" placeholder="templates/my-template.cctemplate.json" autocomplete="off"'),'这是仓库文件路径，不是电脑上的保存目录。')}${includeToken?field('Fine-grained GitHub Token',`<div class="service-key">${input('token',releaseUI.githubToken,'password','id="github-token" autocomplete="off" spellcheck="false" aria-label="GitHub 访问令牌"')}${ibtn('eye','github-token-toggle','显示或隐藏访问令牌')}</div>`,'选择目标仓库，授予 Contents: Read and write。Token 仅在此窗口会话使用，不写入工程或磁盘。'):''}`}

function guidePreferences(){return state.settings.tutorial}

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

function githubExpectedURL(){readGithubDraft();const c=githubConfiguration();if(!c.branch)throw Error('请填写实际分支名，或在直接上传页先检查默认分支。');return 'https://raw.githubusercontent.com/'+encodeURIComponent(c.owner)+'/'+encodeURIComponent(c.repo)+'/'+encodedPath(c.branch)+'/'+encodedPath(c.path)}


function selectedPlan(){return planBy(createUI.planId)&&planBy(createUI.planId).projectId===state.activeProjectId?planBy(createUI.planId):projectPlans()[0]}

function renderCreationWorkspace(){
  const p=selectedPlan();if(p)createUI.planId=p.id;
  const header=`<div class="creation-head">${heading('创作画册','把分镜、素材与生成计划放在一起。',btn('新建画册计划','plus','v3-plan-new')+btn('生成选中的画册','play','v3-generate-selected','','primary'),'CREATE / YOUR NEXT STORY')}<div class="creation-path"><span>画册计划</span>${icon('arrow')}<span>选择分镜</span>${icon('arrow')}<span>组合变量素材</span>${icon('arrow')}<span>生成画面</span></div></div><nav class="creation-tabs" aria-label="创作步骤">${[['plans','画册计划'],['scenes','分镜编辑'],['variables','变量素材'],['queue','生成队列']].map(([id,l])=>`<button class="${createUI.tab===id?'active':''}" data-act="v3-create-tab" data-tab="${id}" ${createUI.tab===id?'aria-current="page"':''}>${l}</button>`).join('')}</nav>`;
  return header+({plans:renderBookPlans,scenes:renderSceneComposer,variables:renderVariableLibrary,queue:renderCreationQueue}[createUI.tab]||renderBookPlans)();
}


function renderPlanRail(){return `<aside class="creation-rail"><div class="creation-rail-head"><span>本企划的画册计划</span>${ibtn('plus','v3-plan-new','新建画册计划')}</div>${projectPlans().map(p=>`<div class="plan-list-item ${p.id===createUI.planId?'active':''}"><input type="checkbox" data-v3-plan-enabled="${p.id}" ${p.enabled?'checked':''} aria-label="勾选 ${esc(p.title)} 参与生成"><button class="plan-list-button" data-act="v3-plan-select" data-id="${p.id}"><strong>${esc(p.title)}</strong><small>${esc(templateBy(p.templateId)?.title||'尚未选择分镜')}<br>${p.variableSetIds.length} 组复用素材</small></button></div>`).join('')}${!projectPlans().length?'<p class="help">先给你的第一本画册起一个名字。</p>':''}</aside>`}

function renderPlanPreview(p){try{const t=templateBy(p.templateId),f=t?.frames[0],scope=effectivePlanScope(p,f),title=scopeText(p.title,effectivePlanScope(p).values),frame=f?effectivePlanFrame(p,f):null,missing=missingScopeKeys(p.title,effectivePlanScope(p).values).concat(frame?missingScopeKeys(frame.prompt+' '+frame.caption,scope.values):[]);return `${missing.length?`<div class="scope-warnings">待补充 ${[...new Set(missing)].map(k=>'{'+esc(k)+'}').join('、')}。缺少的变量会在生成前拦截，不会静默删除。</div>`:''}<div class="resolved-preview"><strong style="font-family:var(--sans);font-size:13px">${esc(title)}</strong>${frame?'\n\n'+esc(scopeText(frame.prompt,scope.values))+'\n\n'+esc(scopeText(frame.caption,scope.values)):'\n请先选择分镜模板。'}</div><div class="scope-explain">${icon('nodes')}<span>优先级：复用素材从上到下 → 本册变量 → 本幕变量。${scope.overrides.length?'本幕发生 '+scope.overrides.length+' 处同名覆盖，可在“分镜编辑”中查看。':'当前没有同名冲突。'}</span></div>`}catch(e){return '<div class="scope-warnings">'+esc(e.message)+'</div>'}}

function renderCreationQueue(){return `<div class="row wrap" style="margin-bottom:21px"><div class="grow"><h2 style="font-size:17px;font-weight:500;margin:0 0 8px">生成队列</h2><span class="tiny muted">入队后使用当时的分镜、变量和工作流快照，可暂停、继续或增量补齐。</span></div>${btn('开始队列','play','v3-run-queue','','primary')}${btn(rt.paused?'继续':'暂停',rt.paused?'play':'pause','pause-queue')}${btn('中止','stop','interrupt','','danger')}</div><div class="panel table-panel" id="queue-list">${queueHTML()}</div><div class="row" style="margin-top:18px">${btn('查找缺失分镜','refresh','scan-resume','','small')}${btn('查看运行日志','terminal','v3-nav','data-route="logs"','small ghost')}</div>`}


function renderLogsWorkspace(){return `<div class="logs-full">${heading('运行日志','按时间查看生成、连接、保存和审校的真实运行记录。',btn('复制日志','copy','copy-logs')+btn('清空本次显示','trash','v3-clear-logs'),'ACTIVITY / EXECUTION')}<div class="logs-filter"><input id="v3-log-search" placeholder="搜索任务、错误或关键词..." value="${esc(createUI.logsSearch)}" aria-label="搜索运行日志"><select id="v3-log-level">${[['all','全部级别'],['error','错误'],['warn','警告'],['info','普通']].map(x=>opt(...x,createUI.logLevel)).join('')}</select><span class="spacer"></span>${btn('打开生成队列','nodes','v3-create-tab','data-tab="queue"','small')}</div><div class="terminal"><div class="terminal-head">${icon('terminal','sm')}LIVE ACTIVITY<span class="spacer"></span><span id="v3-log-count">${rt.logs.length} 条</span></div><div id="log-body" class="terminal-body"></div></div></div>`}


function renderNodeBrowser(){const workflow=state.settings.comfy.workflow,search=createUI.nodeSearch.toLowerCase();return `<aside class="mapping-browser"><input id="v3-node-search" value="${esc(createUI.nodeSearch)}" placeholder="搜索节点 / LoRA / 字段..." aria-label="搜索工作流节点"><div id="v3-node-results">${nodeBrowserItems(workflow,search)}</div></aside>`}


function nodeBrowserItems(workflow,search){return Object.entries(workflow).filter(([id,n])=>(id+' '+n.class_type+' '+(n._meta?.title||'')+' '+Object.keys(n.inputs).join(' ')).toLowerCase().includes(search)).map(([id,n])=>`<details class="node-group" ${search?'open':''}><summary>#${esc(id)} · ${esc(n._meta?.title||n.class_type)}<small>${esc(n.class_type)}</small></summary>${workflowInputEntries(n,workflow).map(entry=>`<div class="node-input-item"><span class="grow ${entry.link?'linked':''}" title="${esc(JSON.stringify(entry.value))}">${esc(entry.label)} <span style="opacity:.5">${entry.link?'连线':entry.type}</span></span>${ibtn('plus','v3-expose-input',entry.link?'将此连线添加为待确认映射':'添加此字段到映射表',`data-node="${esc(id)}" data-path="${esc(entry.path)}"`)}</div>`).join('')}</details>`).join('')||'<div class="mapping-list-empty">未找到匹配节点。</div>'}

async function previewMappedSubmission(){const p=selectedPlan();if(!p)throw Error('先创建画册计划，填写变量后预览真实提交。');const t=templateBy(p.templateId);if(!t)throw Error('画册计划还没有选分镜。');const row=planRuntimeRow(p),frame=effectivePlanFrame(p,t.frames[clamp(ui.frameIndex,0,t.frames.length-1)]),compiled=buildMappedWorkflow(frame,row,{execution:mappedExecutionSnapshot(),preview:true});modal('工作流提交预览',`<p class="help">${esc(p.title)} · 只预览，不提交 GPU。随机种子用固定示例值展示。</p><div class="notice">已覆写 ${compiled.changes.length} 项。未映射或关闭的字段保持原工作流值。</div><pre class="mapping-preview-code">${esc(JSON.stringify(compiled.workflow,null,2))}</pre><div class="modal-footer">${btn('复制 JSON','copy','v3-copy-submission')}${btn('关闭','','close-modal','','primary')}</div>`,'先检查最终参数，再开始生成。',true);createUI.lastSubmission=compiled.workflow}


async function mappedDryRun(){const p=selectedPlan(),t=p?templateBy(p.templateId):currentTemplate();if(!t)throw Error('请先创建分镜。');const row=p?planRuntimeRow(p):projectRows()[0];if(!row)throw Error('请先创建一个画册计划。');const f=p?effectivePlanFrame(p,t.frames[0]):clone(t.frames[0]);f._execution=mappedExecutionSnapshot();createUI.dryController=new AbortController();const area=$('#dry-preview');if(area)area.innerHTML='<p><i class="dot live"></i> 正在验证映射并生成一帧...</p>';try{const result=await generateFrame(f,row,createUI.dryController.signal,0);rt.preview=result.image;if($('#dry-preview'))$('#dry-preview').innerHTML=imgTag(result.image,'通用映射试跑结果');toast(result.offlineFallback?'真实服务失败，当前显示明确标记的离线降级图。':'映射试跑完成。')}catch(e){if($('#dry-preview'))$('#dry-preview').textContent=e.message;throw e}finally{createUI.dryController=null}}

function routeLabel(){return ui.workspace===0?'我的画册':ui.workspace===1?'创作画册':ui.workspace===6?'运行日志':ui.workspace===4?'AI 写故事':'设置'}


function primaryNavItems(){return [[0,'book','我的画册','1'],[1,'story','创作画册','2'],...(state.settings.studio.visibility.logs?[[6,'terminal','运行日志','3']]:[]),...(state.settings.studio.visibility.llm?[[4,'spark','AI 写故事','4']]:[]),[5,'settings','设置',',']]}


function renderQuietShell(){
  ensureStudioState();const collapsed=innerWidth<760||!!state.settings.studio.shell.collapsed;document.documentElement.dataset.navCollapsed=String(collapsed);
  $('#sidebar').innerHTML=`<a class="brand" href="#books" data-act="v3-nav" data-route="books"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><div class="brand-text"><div class="brand-name">Mio</div><div class="brand-sub">STUDIO <span>v3.0</span></div></div></a><button class="side-search" data-act="command" aria-label="搜索和快捷操作">${icon('search')}<span class="grow">搜索与快速操作</span><kbd class="kbd">⌘ K</kbd></button><nav class="nav-list" aria-label="主要功能">${primaryNavItems().map(([id,ic,label,key])=>`<button class="nav-item ${ui.workspace===id?'active':''} ${id===5?'nav-settings':''}" data-act="v3-nav" data-route="${({0:'books',1:'create',6:'logs',4:'writing',5:'settings'})[id]}" title="${label}" aria-label="${label}" ${ui.workspace===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span><b class="nav-key">${key}</b></button>`).join('')}</nav><div class="spacer"></div><button class="nav-collapse" data-act="v3-collapse-nav" aria-label="${collapsed?'展开':'折叠'}侧栏">${icon(collapsed?'arrow':'list')}<span>折叠侧栏</span></button><div class="profile"><button class="workspace-profile-button" data-act="profile-settings" aria-label="修改工作室名称"><span class="avatar">${esc([...workspaceName()][0])}</span><span class="grow"><strong>${esc(workspaceName())}</strong><p>PRIVATE WORKSPACE</p></span></button></div>`;
  $('#topbar').innerHTML=`<button id="project-switch-button" class="project-switch" data-act="project-toggle" aria-haspopup="menu" aria-expanded="false" aria-controls="project-popover">${icon('folder','sm')}<span class="project-switch-name">${esc(project().title)}</span>${icon('down','sm')}</button><div class="top-separator"></div><div class="breadcrumb"><strong>${routeLabel()}</strong></div><span class="spacer"></span><span class="tiny muted">${state.settings.comfy.mode==='mock'?'本地预览模式':rt.connected?'ComfyUI 已连接':'ComfyUI 待连接'}</span><button class="top-queue" data-act="v3-create-tab" data-tab="queue">${icon('nodes','sm')}队列 <b>${state.queue.filter(q=>['pending','running','paused'].includes(q.status)).length}</b></button>${ibtn('sun','theme','切换界面主题')}${ibtn('help','v3-resources','工具、模板和使用帮助')}`;
  if(detailUI.projectOpen)renderProjectPopover();renderAssistantOrb();applyStudioPreferences();renderStatus();
}

function renderV3Modules(){const p=state.settings.studio;return `<section class="settings-section"><h2>只留下你需要的功能</h2><p>画册与创作是核心功能，始终保留。其他模块可以按需开启，隐藏不会删除历史作品。</p>${settingsRow('我的画册','阅读、精修和导出已生成的画册。','<span class="tiny muted">核心功能</span>','book')}${settingsRow('创作画册','画册计划、分镜、变量素材和生成队列收纳在一个工作区。','<span class="tiny muted">核心功能</span>','story')}${settingsRow('运行日志','独立查看生成、连接、保存与审校的运行过程。',switchControl('visibility.logs','显示运行日志',p.visibility.logs),'terminal')}${settingsRow('AI 写故事','可选功能：把想法写成剧情台词或分镜初稿。默认关闭，不影响普通生成。',switchControl('visibility.llm','启用 AI 写故事',p.visibility.llm),'spark')}</section><section class="settings-section"><h2>辅助工具</h2>${settingsRow('悬浮精修助手','可拖动的小悬浮球；悬停展开说明，点击对话。只修改源分镜模板。',switchControl('features.assistant','显示悬浮助手',p.features.assistant),'spark')}${settingsRow('视觉审校','连接支持图片输入的模型，检查真实画面并给出修改建议。',switchControl('features.visualCritic','启用视觉审校',p.features.visualCritic),'shield')}${settingsRow('模板与扩展市场','从设置中的“工具与资源”进入，不再占用主侧栏。',switchControl('features.marketplace','启用模板市场',p.features.marketplace),'box')}</section>`}


function renderResourceHub(){const items=[['book','画册导出模板','设计 HTML/CSS 阅读版式，不改变源画面与台词。','et-open-library'],['box','模板与插件市场','安装或导入分镜、画册版式与工作流。','market'],['upload','GitHub 托管','上传或安装可复用模板，不上传私有工程。','github-open'],['help','快速开始教程','从创作计划到生成画册，含本地三幕练习。','guide-open'],['disk','工程备份与恢复','下载工程 JSON 或便携目录包。','backup'],['shield','系统自检','检查变量、通用映射、模板和页面边界。','v3-diagnostics']];return `<section class="settings-section"><h2>工具与资源</h2><p>低频工具集中在这里，主侧栏只保留日常创作入口。</p><div class="resources-list">${items.filter(x=>x[3]!=='market'||featureEnabled('marketplace')).map(([ic,title,text,a])=>`<button class="resource-link" data-act="${a}">${icon(ic)}<span class="grow"><strong>${title}</strong><small>${text}</small></span>${icon('arrow','sm')}</button>`).join('')}</div></section>`}


function renderCurrentIdentity(){const identity=state.settings.identity;return `<section class="settings-section"><h2>你的工作室</h2><p>名称显示在工作室侧栏。随时可以修改，不改变已有企划、画册或变量素材。</p>${field('工作室名称',input('workspaceName',identity.workspaceName,'text','id="identity-workspace" maxlength="40"'))}${field('创作者署名',input('creatorName',identity.creatorName||'','text','id="identity-creator" maxlength="60"'))}<label class="row small soft" style="margin-bottom:19px"><input id="identity-sync-signature" type="checkbox" checked>同时更新默认画册签名</label>${btn('保存名称与署名','check','identity-save','','primary')}</section><section class="settings-section"><h2>当前保存方式</h2><p>使用已有 Python 后端时，由服务负责保存与文件夹管理，不需要浏览器目录授权。</p><div class="service-context">${esc(backendStatusText())}</div><div class="row" style="margin-top:17px">${btn('配置服务与保存','disk','v3-settings-tab','data-tab="connections"')}${btn('导出备份','download','backup-export')}</div></section>`}

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


function refreshCreationPreviews(){const p=selectedPlan();if(!p)return;const plan=$('#v3-plan-preview');if(plan)plan.innerHTML=renderPlanPreview(p);const t=currentTemplate(),f=(createUI.sceneScope==='plan'?liveStoryboardTask(p)?.frames[ui.frameIndex]:null)||t?.frames[ui.frameIndex],scene=$('#v3-scene-preview');if(scene&&f)scene.innerHTML=sceneResolvedPreview(p,f);const art=$('#art-prompt-preview');if(art&&f)art.innerHTML=liveStoryboardPreview(p,f)}

/* Source: /js/ui.js */
function installNativeUIModule(){const ns=globalThis.ComfyComic,scenePrevious=renderSceneComposer;renderSceneComposer=function(){const t=currentTemplate();if(t&&!t.frames?.length)return'<div class="empty">'+icon('story')+'<h3>分镜列表为空</h3><p>空模板可以正常保存。添加第一幕后即可编辑和生成，最多支持512幕。</p>'+btn('添加第一幕','plus','add-frame','','primary')+btn('删除模板','trash','delete-storyboard-template',`data-id="${esc(t.id)}"`,'small ghost')+'</div>';return scenePrevious()};const readerPrevious=openReader;openReader=function(id){const b=bookBy(id);if(!b)throw Error('The book no longer exists.');if(!b.totalSteps&&!b.steps?.length){modal(b.title||'空画册','<div class="empty"><h3>还没有分镜</h3><p>这本画册已正常读取，目前没有可阅读的图片。</p></div><div class="modal-footer">'+btn('关闭','','close-modal','','primary')+'</div>');return}return readerPrevious(id)};renderPythonSettings=function(){return'<section class="settings-section"><h2>Python 原生配置同步</h2><p>同源读取和保存已自动配置，无需填写接口路径。</p><div class="service-context"><strong>GET /api/config</strong><br><strong>POST /api/config</strong><br>10 个必填字段顶层平铺，删除时透传 forceWrite。</div><div class="row wrap" style="margin:18px 0">'+btn('重新读取后端','refresh','v3-connect-backend')+btn('立即保存','disk','v3-save-backend','','primary')+'</div><p class="help">'+esc(backendRuntime.error||'新编辑会清除旧网络错误并重新安排保存。未读取成功前不会覆盖后端数据。')+'</p></section><section class="settings-section"><h2>ComfyUI 服务</h2><div class="grid2">'+field('运行模式','<select data-setting="comfy.mode">'+opt('mock','离线预览',state.settings.comfy.mode)+opt('real','真实 ComfyUI',state.settings.comfy.mode)+'</select>')+field('ComfyUI 地址',setting('comfy.baseUrl',state.settings.comfy.baseUrl))+'</div><div class="row">'+btn('测试连接','refresh','test-engine')+btn('智能节点映射','nodes','v3-settings-tab','data-tab="mapping"')+'</div></section>'};const renderPrevious=render;render=function(){const result=renderPrevious();document.querySelectorAll('input[id="story-target"]').forEach(e=>e.max=String(ns.MAX_FRAMES));document.querySelectorAll('[data-v3-binding="allowLink"]').forEach(e=>{e.checked=false;e.disabled=true;e.title='连线禁止被普通文本覆盖，请绑定上游文本节点。'});return result};ns.modules.ui=true}


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

function mergedSettingEntries(plan){const map=new Map();for(const id of plan.variableSetIds||[])for(const e of setBy(id)?.entries||[])map.set(e.key,{...e});for(const e of plan.variables||[])map.set(e.key,{...e});return [...map.values()].filter(e=>!(plan.excludedSettingKeys||[]).includes(e.key))}


function settingLabel(entry){return entry.label||({character_display_name:'角色展示名 / 旁白',character:'角色名 / 提示词',character2:'同行角色',outfit:'服装',style:'画风',scene:'场景与环境',weapon:'道具',mood:'情绪',lora:'LoRA',lora_strength:'LoRA 强度',trigger:'角色特征',tone:'故事基调'})[entry.key]||entry.key}


function characterSettingHelp(key){return key==='character_display_name'?'用于旁白和画册展示，例如「七海」。不会自动加入出图提示词。':key==='character'?'用于出图提示词，填写模型识别的角色名或触发词，例如 nanami。':''}


function updateUnifiedSetting(plan,key,value){let entry=plan.variables.find(e=>e.key===key);if(!entry){const original=mergedSettingEntries(plan).find(e=>e.key===key);entry=original?{...clone(original),id:uid('var')}:variableEntry(key,'');plan.variables.push(entry)}entry.value=entry.type==='boolean'?(value===true||value==='true'):value;plan.excludedSettingKeys=(plan.excludedSettingKeys||[]).filter(k=>k!==key);plan.updatedAt=Date.now();save();return entry}

function renderQuietCreation(){const p=selectedPlan();if(p)createUI.planId=p.id;const tab=createUI.tab==='queue'?'queue':createUI.tab==='variables'||createUI.tab==='settings'?'settings':'story';return `<div class="quiet-create-head"><div class="grow"><h1>创作画册</h1><p>画面由你定义，故事自由发生。</p></div>${p?`<select id="art-book-draft" aria-label="选择要创作的画册">${projectPlans().map(x=>opt(x.id,x.title,p.id)).join('')}</select>`:''}${btn('新画册','plus','new-book','','small')}${p?btn('生成画册','play','v3-generate-plan','','primary'):''}</div><nav class="quiet-tabs" aria-label="创作内容">${[['story','分镜故事'],['settings','角色与画面设定'],['queue','生成队列']].map(([id,title])=>`<button class="${tab===id?'active':''}" data-act="art-create-tab" data-tab="${id}" ${tab===id?'aria-current="page"':''}>${title}</button>`).join('')}</nav>${!p?`<div class="empty"><h3>先给一本新画册起名。</h3><p>再写下分镜，或从十二幕示范开始。</p>${btn('新建画册','plus','new-book','','primary')}</div>`:tab==='settings'?renderUnifiedSettings():tab==='queue'?renderCreationQueue():renderQuietStoryboard(p)}`}

function quietResolvedPrompt(p,f){try{const frame=effectivePlanFrame(p,f);return esc(frame._resolvedImagePrompt)+imageBindingPreviewHTML(frame,frame._scope)}catch(e){return '设定尚未完整：'+esc(e.message)+'。提示词本身不受语法限制。'}}


function addUnifiedSetting(){modal('新增画面属性',`${field('显示名称',input('label','','text','id="art-new-setting-label" placeholder="例如：道具"'))}${field('变量标识符',input('key','','text','id="art-new-setting-key" placeholder="例如：weapon"'))}${field('属性类型',`<select id="art-new-setting-type">${Object.entries(variableTypes).map(([key,label])=>opt(key,label,'text')).join('')}</select>`)}<div class="help">标识符用于 {变量名} 高亮。它只影响属性识别，不会限制你的提示词语法。</div><div class="modal-footer">${btn('取消','','close-modal')}${btn('添加属性','plus','art-setting-confirm','','primary')}</div>`)}

function roomPage(book,step){if(!step)return '<div class="room-page"><div class="room-blank"><span>Fin.</span><small>THIS STORY CONTINUES</small></div></div>';return `<div class="room-page" data-page="${book.id}:${step.stepIndex}">${imgTag(step.image,step.name,`data-page-img="${book.id}:${step.stepIndex}" data-book="${book.id}" data-step="${step.stepIndex}" decoding="async" loading="${artUI.readerMode==='webtoon'?'lazy':'eager'}"`)}<span class="room-page-number">${pad(step.stepIndex+1)}</span></div>`}

function scrollRoomTo(index,smooth=true){const canvas=$('#reader-canvas'),target=$(`[data-scroll-step="${index}"]`,canvas);if(!target)return;artUI.readerAnchorUntil=Date.now()+650;const top=target.getBoundingClientRect().top-canvas.getBoundingClientRect().top+canvas.scrollTop-15;canvas.scrollTo({top,behavior:smooth?'smooth':'instant'})}

function renderRoomInfo(){const book=bookBy(ui.bookId),panel=$('#room-info');if(!book||!panel)return;const step=readerFrame(book,ui.step),img=$(`[data-page-img="${book.id}:${ui.step}"]`,$('#reader-canvas')),size=img?.naturalWidth?img.naturalWidth+' × '+img.naturalHeight:'原始比例';panel.innerHTML=`<div class="row"><h3 class="grow" data-user-content>${esc(step.name)}</h3>${ibtn('close','room-info','收起分镜文字')}</div>${step.caption?`<p class="room-caption" data-user-content>${esc(step.caption)}</p>`:'<p class="room-caption">这一幕，让画面自己说话。</p>'}<div class="room-resolution">${size} · ${pad(ui.step+1)} / ${pad(book.totalSteps)}</div><details><summary>查看画面提示词</summary><pre data-user-content>${esc(step.prompt)}</pre>${btn('复制提示词','copy','room-copy-prompt','','small')}</details>`;panel.hidden=!artUI.showInfo}

function artworkImageFallback(event){const img=event.target;if(img instanceof HTMLImageElement&&img.isConnected)img.replaceWith(missingArtworkElement(img))}


function laboratoryExtensions(){return [
  {key:'critic',icon:'shield',title:'视觉审校',description:'连接视觉模型，检查画面与角色一致性。',enabled:featureEnabled('visualCritic')},
  {key:'refine',icon:'brush',title:'单页精修',description:'基于原画册的工作流快照，原地替换一页。',enabled:!!state.settings.presentation.lab.refine},
  {key:'mask',icon:'edit',title:'局部蒙版',description:'涂抹局部区域，需要对应的图生图工作流。',enabled:!!state.settings.presentation.lab.mask},
  {key:'assistant',icon:'spark',title:'分镜写作助手',description:'用自然语言调整源分镜，不改动已有画册。',enabled:featureEnabled('assistant')}
]}

function renderLaboratory(){const b=selectedLabBook();if(b){artUI.labBookId=b.id;artUI.labIndex=clamp(artUI.labIndex,0,Math.max(0,b.totalSteps-1));ui.bookId=b.id;ui.step=artUI.labIndex}const exts=laboratoryExtensions();return `<div class="lab-heading">${heading('实验室','专业工具留在这里。开启你需要的，其余交给画面。',featureEnabled('marketplace')?btn('扩展与模板市场','box','market'):'','LABORATORY / OPTIONAL TOOLS')}</div><div class="lab-experiments">${exts.map(x=>`<section class="lab-extension">${icon(x.icon)}<div class="grow"><h3>${x.title}</h3><p>${x.description}</p></div><label class="switch"><input type="checkbox" role="switch" data-art-extension="${x.key}" aria-label="${x.enabled?'停用':'启用'}${x.title}" ${x.enabled?'checked':''}><span class="switch-track"></span></label></section>`).join('')}</div>${!exts.some(x=>x.enabled)?'<div class="lab-disabled">所有实验扩展默认关闭。开启一个工具后，选择画册与分镜即可使用。阅读器始终保持简洁。</div>':`<div class="lab-controls"><label for="lab-book-select">工作画册</label><select id="lab-book-select" aria-label="实验室的目标画册">${projectBooks().map(book=>opt(book.id,book.title,b?.id)).join('')||'<option value="">当前画册集没有作品</option>'}</select>${b?`<select id="lab-frame-select" aria-label="目标分镜">${readerSequence(b).map(s=>opt(s.stepIndex,pad(s.stepIndex+1)+' · '+s.name,artUI.labIndex)).join('')}</select>${btn('纯粹阅读','book','read',`data-id="${b.id}"`,'small')}`:''}</div>${b?renderLabWorkbench(b):'<div class="empty"><h3>先创作一本画册。</h3><p>实验工具会在这里处理具体分镜。</p>'+btn('创作画册','plus','new-book','','primary')+'</div>'}`}<div class="lab-footer"><span class="lab-stamp">LOCAL / OPT-IN</span><span class="grow">外部服务只在你主动操作时调用，离线演示会明确标注。</span>${btn('扩展使用说明','help','art-lab-help','','ghost small')}</div>`}


function renderLabWorkbench(book){const s=readerSequence(book)[artUI.labIndex],idx=artUI.labIndex;if(!s)return'<div class="lab-disabled">这本画册没有可处理的分镜。</div>';const refiner=state.settings.presentation.lab.refine,critic=featureEnabled('visualCritic'),mask=state.settings.presentation.lab.mask,assistant=featureEnabled('assistant'),engine=book.sourceSnapshot?.frames?.[idx]?._execution?.bindings||book.sourceSnapshot?.execution?.bindings||state.settings.comfy.bindings||[],hasImage=engine.some(b=>b.enabled&&b.source==='image');return `<div class="lab-workbench"><div class="lab-artwork page-art" data-page="${book.id}:${idx}">${imgTag(s.image,s.name,`id="lab-image" data-page-img="${book.id}:${idx}" data-book="${book.id}" data-step="${idx}"`)}</div><aside class="lab-tools">${critic?`<section><div class="row"><h3 class="grow">视觉审校</h3>${icon('shield','sm')}</div><p class="lab-note">${esc(criticReadyLabel())}</p><div class="row">${btn('审校这张图','eye','art-lab-critique',s.pending?'disabled':'','small primary')}${btn('API 设置','settings','critic-settings','','small')}</div><div id="critique-${idx}">${s.critique?criticReportHTML(s.critique,idx):''}</div></section>`:''}${refiner||mask?`<section><h3>单页精修</h3><label class="label" for="refine-${idx}">想改变什么？</label><textarea id="refine-${idx}" placeholder="自由描述希望调整的细节...">${esc(s.prompt)}</textarea><div class="row small soft" style="margin:15px 0">强度<input id="denoise-${idx}" type="range" min="0" max="1" step=".05" value=".45" aria-label="精修去噪强度"><span id="denoise-value-${idx}">0.45</span></div><div class="row">${btn('重绘这一页','brush','art-lab-redraw','','small primary')}${mask?btn('绘制蒙版','edit','art-lab-mask','','small'):''}</div><p class="lab-note">${state.settings.comfy.mode==='mock'?'当前为离线矢量演示，不会调用 GPU。真实精修需连接 ComfyUI。':hasImage?'已找到图像输入映射，请确认原工作流支持所需的图生图或蒙版节点。':'此画册的工作流没有图像输入映射。当前只能重新文生图，不能原图局部精修。'}</p>${!hasImage?btn('检查节点映射','nodes','v3-settings-tab','data-tab="mapping"','ghost small'):''}</section>`:''}${assistant?`<section><h3>分镜写作助手</h3><p class="lab-note">修改「${esc(book.templateTitle)}」的源分镜。已有图像不会自动改变。</p>${btn('打开助手','spark','art-lab-assistant','','small')}</section>`:''}</aside></div>`}


async function setLaboratoryExtension(key,enabled){if(!enabled&&(rt.redraw.size||visionJobs.size||rt.chatBusy))throw Error('请先等待当前精修、审校或助手任务完成，再停用扩展。');if(key==='critic'){state.settings.studio.features.visualCritic=enabled;if(!enabled)state.settings.autoCritique=false}else if(key==='assistant')state.settings.studio.features.assistant=enabled;else if(key==='refine'){state.settings.presentation.lab.refine=enabled;if(!enabled)state.settings.presentation.lab.mask=false}else if(key==='mask'){state.settings.presentation.lab.mask=enabled;if(enabled)state.settings.presentation.lab.refine=true}save();render()}


function addSettingFromDialog(){const p=selectedPlan();if(!p)throw Error('请先选择一本画册。');const key=$('#art-new-setting-key').value.trim(),label=$('#art-new-setting-label').value.trim(),type=$('#art-new-setting-type').value;checkVariableKey(key);if(mergedSettingEntries(p).some(e=>e.key===key))throw Error('已有同名属性，可直接编辑它。');p.variables=p.variables.filter(e=>e.key!==key);p.variables.push({id:uid('var'),key,label:label||key,type,value:type==='number'?0:type==='boolean'?false:type==='json'?'{}':''});p.excludedSettingKeys=(p.excludedSettingKeys||[]).filter(x=>x!==key);save();closeModal();render()}


function textualInterfaceCopy(text){return String(text).replaceAll('智能节点映射器','工作流配置').replaceAll('智能节点映射','工作流配置').replaceAll('实验室','扩展功能').replaceAll('LABORATORY / OPTIONAL TOOLS','EXTENSIONS / OPTIONAL TOOLS').replaceAll('创作企划','画册集').replaceAll('企划','画册集').replaceAll('画册计划','画册').replaceAll('创作计划','画册创作').replaceAll('角色矩阵','角色与画面设定').replaceAll('可复用素材','画面设定').replaceAll('本册专属变量','角色与画面设定').replaceAll('变量素材','设定预设')}


function refreshInterfaceCopy(root=document.body){
  if(artUI.changingCopy||!root)return;artUI.changingCopy=true;
  try{const userTitles=new Set([...state.projects,...state.books,...state.templates,...(state.creation?.plans||[]),...(state.creation?.variableSets||[])].map(x=>x.title));const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,textarea,pre,code,[data-user-content],.chat-bubble,.prompt-surface,.resolved-preview,.mapping-preview-code,.publish-link,.book-title,.book-desc,.room-caption'))continue;if(userTitles.has(node.textContent.trim()))continue;const next=textualInterfaceCopy(node.textContent);if(next!==node.textContent)node.textContent=next}for(const el of root.querySelectorAll('[placeholder],[aria-label],[title]')){if(el.closest('.prompt-surface,.chat-bubble,[data-user-content],#template-studio'))continue;for(const key of ['placeholder','aria-label','title'])if(el.hasAttribute(key)){const value=el.getAttribute(key),next=textualInterfaceCopy(value);if(next!==value)el.setAttribute(key,next)}}}finally{artUI.changingCopy=false}
}

async function importCuratedDemo(){if(!await confirmAction('载入精选十二幕示范？','会新增一个独立画册集，不覆盖已有画册、设定或模板。','载入示范'))return;const demo=createCuratedDemo(state),suffix=uid('demo'),remap=new Map();for(const x of [...demo.projects,...demo.books,...demo.templates,...demo.rows,...demo.creation.plans,...demo.creation.variableSets])remap.set(x.id,x.id+'_'+suffix);const walk=value=>{if(typeof value==='string'&&remap.has(value))return remap.get(value);if(Array.isArray(value))return value.map(walk);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[remap.get(key)||key,walk(v)]));return value};const assets=walk({projects:demo.projects,books:demo.books,templates:demo.templates,rows:demo.rows,creation:demo.creation});state.projects.push(...assets.projects);state.books.push(...assets.books);state.templates.push(...assets.templates);state.rows.push(...assets.rows);state.creation.plans.push(...assets.creation.plans);state.creation.variableSets.push(...assets.creation.variableSets);state.activeProjectId=assets.projects[0].id;ui.templateId=assets.templates[0].id;createUI.planId=assets.creation.plans[0].id;save();render();toast('示范已载入，可自由修改与离线浏览。')}


/* Domain source: js/ui.js. Cover fitting never crops or stretches the artwork. */

function createWorkspaceChromePolicy(){
  function navigation(visibility={}){return [[0,'book','画册集','1'],[1,'story','创作画册','2'],[3,'nodes','图像引擎','3'],...(visibility.extensions===true?[[7,'nodes','扩展功能','']]:[]),...(visibility.llm===true?[[4,'spark','AI 写故事','4']]:[]),[5,'settings','设置',','],...(visibility.logs===true?[[6,'terminal','运行日志','']]:[])]}
  function ownsDisplayPreferences(tab){return tab==='appearance'}
  function brandFontSize(preferred,availableWidth,measuredWidth){if(![preferred,availableWidth,measuredWidth].every(value=>Number.isFinite(value)&&value>0))return 0;return Math.min(preferred,preferred*Math.max(0,availableWidth-2)/measuredWidth)}
  return Object.freeze({navigation,ownsDisplayPreferences,brandFontSize});
}


function rememberedInterfaceLanguage(){try{const lang=localStorage.getItem('cc-language');return lang==='en'?'en':'zh-CN'}catch(e){return'zh-CN'}}

function responsiveCover(book,mode,index=0){const image=collectionCoverInfo(book),ratio=clamp(image.ratio,.4,2.4);return `<button class="shelf-cover" style="--cover-ratio:${ratio}" data-act="read" data-id="${book.id}" data-cover-mode="${mode}" aria-label="${esc(localeString('阅读'))} ${esc(book.title)}">${imgTag(image.src,book.title,`data-book="${book.id}" data-step="${image.frame?.stepIndex||0}" data-responsive-cover="true" loading="${index<4?'eager':'lazy'}" decoding="async"`)}<span class="cover-paper" aria-hidden="true"></span></button>`}


function updateCoverSizing(img){if(!img?.naturalWidth||!img.naturalHeight)return;const size={width:img.naturalWidth,height:img.naturalHeight};displayUI.dimensions.set(img.currentSrc||img.src,size);displayUI.dimensions.set(img.getAttribute('src'),size);const button=img.closest('.shelf-cover');if(!button)return;const ratio=size.width/size.height;button.dataset.orientation=ratio>1.2?'landscape':ratio<.75?'portrait':'square';if(button.dataset.coverMode==='showcase')button.style.setProperty('--cover-ratio',String(clamp(ratio,.4,2.4)))}


function fitVisibleCovers(){document.querySelectorAll('img[data-responsive-cover]').forEach(img=>{if(img.complete)updateCoverSizing(img)})}

/* Native localization catalog, mirrored in js/ui.js. No translation service is used. */

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

function shelfViewSwitch(){const current=state.settings.presentation.homeLayout;return `<div class="shelf-view-switch" role="group" aria-label="${esc(localeString('首页展示方式'))}">${[['showcase','image','精选展示'],['grid','grid','紧凑网格']].map(([mode,ic,label])=>`<button data-act="shelf-layout" data-layout="${mode}" class="${current===mode?'active':''}" aria-pressed="${current===mode}" title="${esc(localeString(label))}">${icon(ic)}<span>${localeString(label)}</span></button>`).join('')}</div>`}

function displayPreferencesHTML(){const p=state.settings.presentation;return `<section class="display-preferences" id="display-preferences"><h2>${localeString('显示与语言')}</h2><p>${localeString('调整阅读习惯，让工作室更适合你。')}</p><div class="display-preference-row"><div class="grow"><strong>${localeString('语言 / Language')}</strong><p>${localeString('只切换界面文字，不翻译画册名称、提示词或台词。')}</p></div><select id="interface-language" data-no-translate aria-label="Interface language / 界面语言"><option value="zh-CN" ${p.language==='zh-CN'?'selected':''}>简体中文</option><option value="en" ${p.language==='en'?'selected':''}>English</option></select></div><div class="display-preference-row"><div class="grow"><strong>${localeString('首页展示方式')}</strong><p>${localeString('保留大图欣赏，或快速浏览更多画册。')}</p></div><select id="default-shelf-view" aria-label="${esc(localeString('首页展示方式'))}">${opt('showcase',localeString('精选展示'),p.homeLayout)}${opt('grid',localeString('紧凑网格'),p.homeLayout)}</select></div><div class="display-preference-row"><div class="grow"><strong>${localeString('默认阅读模式')}</strong><p>${localeString('默认完整显示图片，也可选择其他阅读方式。')}</p></div><select id="default-room-view" aria-label="${esc(localeString('默认阅读模式'))}">${[['webtoon','卷轴 · 连续阅读'],['spread','对开本 · 双页画册'],['gallery','画廊 · 大图与胶卷']].map(([id,label])=>opt(id,localeString(label),p.readerModeExplicit?p.defaultReaderMode:'gallery')).join('')}</select></div><div class="display-preference-row"><div class="grow"><strong>${localeString('艺术字体风格')}</strong><p>${localeString('只改变界面标题与装饰文字，编辑区保持易读。')}</p></div><select id="display-lettering" aria-label="${esc(localeString('艺术字体风格'))}">${[['editorial','书刊 · 雅致衬线'],['calligraphy','手札 · 东方笔意'],['classic','典藏 · 古典书卷']].map(([id,label])=>opt(id,localeString(label),p.lettering)).join('')}</select></div><div class="font-sample" data-no-translate><span class="sample-cn">海风有信，画面有声。</span><span class="sample-en">A story worth keeping.</span></div><p class="font-status-note" id="collection-font-status">${localeString('丰富字体按需下载；离线时自动使用系统字体。')}</p></section>`}


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

async function verifyDisplayTypeface(){
  if(!document.fonts?.load){displayUI.fontStatus='fallback';updateCollectionFontStatus();return}
  const sequence=(displayUI.fontSequence||0)+1;displayUI.fontSequence=sequence;displayUI.fontStatus='loading';updateCollectionFontStatus();
  const variant=state.settings.presentation.lettering,faces=variant==='calligraphy'?[['Ma Shan Zheng','海风有信'],['Bodoni Moda','Story']]:variant==='classic'?[['Noto Serif SC','海风有信'],['DM Serif Display','Story']]:[['Noto Serif SC','海风有信'],['Cormorant Garamond','Story']];let timer;
  try{const loaded=await Promise.race([Promise.all(faces.map(([name,sample])=>document.fonts.load('400 24px "'+name+'"',sample))),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),10000)})]);if(sequence===displayUI.fontSequence)displayUI.fontStatus=loaded&&loaded.every(list=>list.length>0)?'loaded':'fallback'}catch(e){if(sequence===displayUI.fontSequence)displayUI.fontStatus='fallback'}finally{clearTimeout(timer);updateCollectionFontStatus()}
}

function changeInterfaceLanguage(language){if(!['en','zh-CN'].includes(language))return;state.settings.presentation.language=language;displayUI.languageTouched=true;try{localStorage.setItem('cc-language',language)}catch(e){}applyDisplayAttributes();save();localizeWorkspace();decorateDisplayPreferences();if(ui.workspace===0){$('#main').innerHTML='<div class="art-fade">'+renderResponsiveCollection()+'</div>';fitVisibleCovers()}updateCollectionFontStatus()}


function setShelfLayout(mode){state.settings.presentation.homeLayout=displayModel.mode(mode);displayUI.page=0;try{localStorage.setItem('cc-home-layout',state.settings.presentation.homeLayout)}catch(e){}save();if(ui.workspace===0)render();else decorateDisplayPreferences()}


function requestDemoCleanupSave(){if(!displayUI.cleanupPending||rt.booting||displayUI.cleanupTimer)return;if(!ComfyComic.sync?.runtime.loaded)return;displayUI.cleanupTimer=setTimeout(()=>{displayUI.cleanupTimer=null;if(!displayUI.cleanupPending)return;displayUI.cleanupPending=false;save(true)},300)}

function ensureRoomDefaultChoice(mode){if(!['webtoon','spread','gallery'].includes(mode))return;const p=state.settings.presentation;p.readerModeExplicit=true;p.defaultReaderMode=mode;p.readerMode=mode;state.settings.studio.reader.defaultMode=({webtoon:'webtoon',spread:'manga',gallery:'focus'})[mode];save()}

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

// Shared reader/export presentation layer. Default reading never compiles a template.
const presentationUI={templateId:'mio-fit',panel:false,exportPreview:false,query:'',revision:0,approved:new Set(),previewTimer:null};

const presentationImageCache=new Map();

function imageBindingPreviewHTML(frame,scope){
  const resolved=resolveImageVariables(frame.prompt,scope,false,frame.negative||frame._execution?.globalNegative||'');
  if(!resolved.images.length)return '';
  return `<div class="image-binding-preview" aria-label="按提示词顺序发送的图片">${resolved.images.map(image=>`<div>${image.src?`<img src="${esc(image.src)}" alt="${esc(image.key)}" loading="lazy">`:'<span class="muted">未上传</span>'}<code>@image_${image.index}</code><small>{${esc(image.key)}}</small></div>`).join('')}</div>`;
}

