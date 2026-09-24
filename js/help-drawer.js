/* T5 · C9: the “?” in the top bar opens a help drawer for the page in front of you: what the page is for and its
   everyday actions, the words it uses, the matching tutorials, the setup checklist (C1), keyboard shortcuts and a
   diagnostics summary for bug reports. Pressing “?” opens it at the shortcuts. */
'use strict';
const helpUI={opener:null,leaving:false};

/* One sentence per term, with where to find it (B4). Pages list the terms they use. */
const HELP_GLOSSARY={
  '画册集':'一组相关的画册、分镜和预设，相当于一个项目。在顶栏左侧切换。',
  '画册':'生成好的一本漫画，可以阅读、导出和分享。在「画册集」页。',
  '分镜':'一本画册的脚本，由若干分幕组成。在「创作工坊 → 分镜工坊」。',
  '分幕':'分镜里的一格画面，写提示词、台词和画面参数。',
  '预设':'一组变量的取值，例如角色外貌或场景。在「创作工坊 → 预设工坊」。',
  '变量':'写在提示词或台词里的 {名字}，生成时换成预设里的值。',
  '装配':'选定分镜、预设、图像服务和工作流，得到生成任务。',
  '生成任务':'装配好、等待生成的一本画册；点「开始」后逐幕请求图像服务。在「创作工坊 → 装配与队列」。',
  '图像服务':'实际出图的服务：ComfyUI、NovelAI 或 OpenAI 兼容接口。在「工作流与 API 配置」。',
  '工作流':'ComfyUI 的节点图（API 格式 JSON），决定模型和出图流程。',
  '参数映射':'指定提示词、种子等写进工作流里哪个节点的哪个输入。'
};

/* [label, Chinese page under docs/, English page under docs/ when one exists] */
const HELP_DOCS={
  quickstart:['快速开始','guide/QUICKSTART.html','en/GUIDE.html#start'],
  services:['图像服务与密钥','guide/CHANNELS_AND_KEYS.html','en/GUIDE.html#connect-a-provider'],
  workflow:['ComfyUI 工作流','guide/WORKFLOW.html',''],
  variables:['图片变量','guide/IMAGE_VARIABLES.html',''],
  tasks:['生成任务','guide/FOUNDATION.html','en/FOUNDATION.html'],
  presentation:['阅读与导出','guide/PRESENTATION.html','en/GUIDE.html#read-and-share'],
  sharing:['内容与分享','guide/CONTENT_AND_SHARING.html','en/CONTENT_AND_SHARING.html'],
  backup:['备份与恢复','guide/BACKUP.html',''],
  files:['文件与保存','guide/FILE_LIBRARY.html','en/FILE_LIBRARY.html'],
  mobile:['手机访问','guide/MOBILE.html','en/MOBILE.html'],
  troubleshooting:['常见问题','guide/TROUBLESHOOTING.html','']
};

const HELP_PAGES={
  home:{title:'首页',text:'从这里开始：选择你使用的图像服务，写下第一个分镜，再装配成生成任务。下方的开箱检查会逐项核对这些步骤。',
    terms:['画册集','图像服务','生成任务'],docs:['quickstart','services','troubleshooting'],
    actions:[['新建分镜','plus','help-new-story'],['新建生成任务','play','assembly-new']]},
  gallery:{title:'画册集',text:'当前画册集里生成好的画册都在这里。点封面阅读；框选或 Ctrl / ⌘ 点击可多选，右键批量导出或删除；拖动封面左上角的 ⠿ 调整顺序。',
    terms:['画册集','画册'],docs:['presentation','sharing','backup'],
    actions:[['新建画册集','folder','new-project']]},
  stories:{title:'分镜工坊',text:'分镜是一本画册的脚本，每一幕写提示词、台词和画面参数。在提示词或台词里写 {变量名}，装配时换成预设里的值。修改会自动保存。',
    terms:['分镜','分幕','变量'],docs:['quickstart','variables'],
    actions:[['新建分镜','plus','help-new-story'],['去装配此分镜','arrow','first-run-assemble-story']]},
  presets:{title:'预设工坊',text:'预设是一组变量的取值，例如角色外貌或场景设定。装配时可以同时选多个预设，分镜里的 {变量名} 换成对应的值。',
    terms:['预设','变量'],docs:['variables'],
    actions:[['新建预设','plus','help-new-preset']]},
  production:{title:'装配与队列',text:'装配把分镜、预设、图像服务和工作流组合成生成任务。任务加入后处于待命状态，点「开始」才会请求图像服务。',
    terms:['装配','生成任务'],docs:['tasks','troubleshooting'],
    actions:[['新建生成任务','play','assembly-new']]},
  workflow:{title:'工作流与 API 配置',text:'在这里添加和切换图像服务。使用 ComfyUI 时，导入 API 格式的工作流，再用参数映射指定提示词、种子等写进哪个节点。',
    terms:['图像服务','工作流','参数映射'],docs:['workflow','services'],actions:[]},
  writer:{title:'AI 写故事',text:'把故事想法整理成台词与分镜初稿；不负责生成图片。',terms:['分镜'],docs:[],actions:[]},
  settings:{title:'设置',text:'常用：工作室、通用偏好（外观、语言、字号）、数据与备份、关于与更新。高级：功能开关、样式工坊、扩展中心、工具与资源。开发者选项默认隐藏，在功能开关里打开。',terms:[],docs:['files','backup','mobile'],
    actions:[['导出完整备份（ZIP）','download','disk-archive']]},
  logs:{title:'运行日志',text:'按时间查看生成、连接、保存和审校的真实运行记录。',terms:[],docs:['troubleshooting'],actions:[]},
  optional:{title:'可选功能',text:'按需启用，在工具卡片旁配置专属服务。',terms:[],docs:[],actions:[]},
  market:{title:'模板与扩展市场',text:'安装或导入分镜、画册版式与工作流。',terms:[],docs:['sharing'],actions:[]}
};

/* Actions that keep the drawer open: they report back into the checklist. Everything else closes it first. */
const HELP_STAY_ACTS=new Set(['help-drawer-close','help-copy-diagnostics','help-test-engine','help-add-seed','help-sync-models']);

function helpPageKey(){
  if(ui.workspace===1)return ({presets:'presets',production:'production'})[workshop.view]||'stories';
  return ({0:'gallery',3:'workflow',4:'writer',5:'settings',6:'logs',7:'optional',8:'market'})[ui.workspace]||'home';
}
function helpMac(){return /Mac|iPhone|iPad|iPod/.test(navigator.platform||navigator.userAgent||'')}
function helpDocHref(key){const [,zh,en]=HELP_DOCS[key];return '/docs/'+(state.settings.presentation.language==='en'&&en?en:zh)}
function helpActiveWorkflow(){const c=state.settings.comfy;return c.presets.find(p=>p.id===c.activeWorkflowId)||null}

/* Model problems the next task would hit: a model remembered from the wizard for this workflow replaces the blueprint's. */
function helpModelProblems(w){
  const usable=v=>typeof v==='string'&&!!v.trim()&&!placeholderModelName(v),remembered=state.settings.productionAssembly?.overrides?.[w.id]||{};
  if(usable(remembered.model))return [];
  return workflowModelProblems(w.workflow).filter(p=>!usable(remembered.models?.[p.key]));
}

/* C1 · setup checklist. Each item: {id, title, state:'done'|'todo'|'checking', detail, fix?, image?}. */
function setupChecklist(){
  const items=[],add=(id,title,status,detail,fix=null,extra={})=>items.push({id,title,state:status,detail,fix,...extra});
  const p=activeImageProfile(),comfy=p?.provider==='comfyui',issues=p?providerSetupIssues(p):[localeString('请选择图像服务。')];
  if(!p||issues.length)add('service','图像服务','todo',localeString(issues[0]),{act:'image-provider-settings',label:'图像服务设置'});
  else if(comfy&&state.settings.comfy.mode==='mock')add('service','图像服务','done',localeString('本地预览模式'));
  else if(comfy&&rt.engineOk)add('service','图像服务','done',localeString('ComfyUI 已连接 · {url}',{url:baseURL()}));
  else if(comfy&&rt.engineChecked)add('service','图像服务','todo',localeString('连不上 ComfyUI：确认它已启动，地址 {url} 可以访问。',{url:baseURL()}),{act:'help-test-engine',label:'测试连接'});
  else if(comfy)add('service','图像服务','checking',localeString('正在检测 ComfyUI…'),{act:'help-test-engine',label:'测试连接'});
  else add('service','图像服务','done',localeString('「{title}」已配置',{title:p.title}));
  if(comfy){
    const w=helpActiveWorkflow();
    if(!w)add('workflow','工作流','todo',localeString('还没有保存的工作流。'),{act:'wf-focus-library',label:'导入工作流'});
    else{
      const bindings=Array.isArray(w.bindings)?w.bindings:initialWorkflowBindings({...state.settings.comfy,...w});
      if(!comfyPositiveTarget(bindings))add('workflow','工作流','todo',localeString('「{title}」没有映射正向提示词，分镜里的提示词不会写进工作流。',{title:w.title}),{act:'wf-focus-library',label:'打开工作流'});
      else if(!workflowSeedReady(w))add('workflow','工作流','todo',localeString('「{title}」没有种子映射，每一幕会沿用同一个种子，画面可能几乎一样。',{title:w.title}),findSeedInput(w.workflow)?{act:'help-add-seed',label:'一键添加种子映射'}:{act:'wf-focus-library',label:'打开工作流'});
      else add('workflow','工作流','done',localeString('「{title}」 · 提示词与种子已映射',{title:w.title}));
      const problems=helpModelProblems(w),synced=!!comfyModelCatalog().fetchedAt,reachable=rt.engineOk&&state.settings.comfy.mode==='real';
      if(problems.length)add('model','模型','todo',localeString(modelProblemText(problems[0])),{act:'assembly-new',label:'选择模型'});
      else if(synced)add('model','模型','done',localeString('工作流用到的模型都在 ComfyUI 的模型列表里'));
      else add('model','模型','checking',localeString('同步模型列表后，核对工作流用到的模型是否已安装。'),reachable?{act:'help-sync-models',label:'同步模型列表'}:null);
    }
  }
  const stories=projectTemplates(),presets=projectVariableSets(),current=workshopStory(),story=stories.find(t=>t.id===current?.id)||stories[0];
  if(!story)add('material','分镜与预设','todo',localeString('当前画册集还没有分镜。'),{act:'help-new-story',label:'新建分镜'});
  else{
    const missing=assemblyMissingVariables(story.id,presets.map(s=>s.id)).map(m=>'{'+m.key+'}');
    if(missing.length)add('material','分镜与预设','todo',localeString('「{story}」用到的变量 {names} 还没有预设定义。',{story:story.title,names:missing.slice(0,4).join(' ')+(missing.length>4?' …':'')}),{act:'help-new-preset',label:'新建预设'});
    else add('material','分镜与预设','done',localeString('{stories} 个分镜 · {presets} 个预设',{stories:stories.length,presets:presets.length}));
  }
  const made=state.books.filter(b=>!b.curatedDemo&&(b.generatedSteps||0)>0).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
  if(made){const src=coverImage(made);add('trial','试跑','done',localeString('已生成「{title}」',{title:made.title}),null,{image:src?thumbnailURL(src):''})}
  else add('trial','试跑','todo',localeString('还没有生成过画面。先装配一个只有一两幕的生成任务试一试。'),{act:'assembly-new',label:'新建生成任务'});
  return items;
}

function helpChecklistHTML(){
  const items=setupChecklist(),done=items.filter(i=>i.state==='done').length,marks={done:'✓',todo:'!',checking:'…'},said={done:'已完成',todo:'待处理',checking:'未核对'};
  return `<section class="help-section help-checklist" id="help-checklist" aria-labelledby="help-checklist-title"><header class="help-section-head"><h3 id="help-checklist-title" tabindex="-1">开箱检查</h3><span class="help-progress ${done===items.length?'is-done':''}">${esc(localeString('已完成 {done} / {total}',{done,total:items.length}))}</span></header>
  <ol class="help-checks">${items.map(i=>`<li class="help-check is-${i.state}" data-check="${i.id}"><span class="help-check-mark" aria-hidden="true">${marks[i.state]}</span><span class="help-check-body"><strong>${esc(localeString(i.title))}<span class="visually-hidden"> · ${esc(localeString(said[i.state]))}</span></strong><small>${esc(i.detail)}</small>${i.image?`<img class="help-check-thumb" src="${esc(i.image)}" alt="" loading="lazy">`:''}</span>${i.fix?`<button type="button" class="btn small" data-act="${esc(i.fix.act)}">${esc(localeString(i.fix.label))}</button>`:''}</li>`).join('')}</ol></section>`;
}

function helpShortcutGroups(){
  const mod=helpMac()?'⌘':'Ctrl',nav=[['Alt 0','首页'],['Alt 1','画册集'],['Alt 2','创作工坊'],['Alt 3','工作流与 API 配置']];
  if(workspaceVisible(4))nav.push(['Alt 4','AI 写故事']);
  nav.push(['Alt 5','设置']);
  return [
    ['通用',[[mod+' K','搜索与快速操作'],[mod+' J','创作助手'],[mod+' ,','设置'],['?','帮助与快捷键'],['Esc','关闭弹窗或取消选择'],[mod+' S','立即保存']]],
    ['切换页面',nav],
    ['分镜工坊',[[mod+' ↑ / ↓','上一幕 / 下一幕'],[mod+' Enter','保存并编辑下一幕']]],
    ['多选（画册、分幕、生成任务）',[['拖动空白处','框选'],[mod+' 点击','加选或取消'],['Shift 点击','连续选择'],[mod+' A','全选'],['Delete','删除所选'],['Shift F10','打开右键菜单']]],
    ['阅读',[['← / →','翻页']]]
  ];
}
function helpKeysHTML(){
  const key=/^(?:Ctrl|Alt|Shift|Esc|Enter|Delete|F10|⌘|[A-Z0-9,?↑↓←→])$/,kbd=combo=>combo.split(' ').map(part=>key.test(part)?`<kbd>${esc(part)}</kbd>`:`<span>${esc(localeString(part))}</span>`).join('');
  return `<section class="help-section help-keys" id="help-keys" aria-labelledby="help-keys-title"><header class="help-section-head"><h3 id="help-keys-title" tabindex="-1">快捷键</h3></header><p class="help-note">侧栏名称右侧的数字就是 Alt + 数字。</p>
  ${helpShortcutGroups().map(([group,rows])=>`<h4>${esc(localeString(group))}</h4><dl class="help-key-list">${rows.map(([combo,what])=>`<div><dt>${kbd(combo)}</dt><dd>${esc(localeString(what))}</dd></div>`).join('')}</dl>`).join('')}</section>`;
}

function helpDiagnosticsText(){
  const L=s=>localeString(s),line=(label,value)=>L(label)+'：'+value,p=activeImageProfile(),comfy=p?.provider==='comfyui',c=state.settings.comfy;
  const address=raw=>{try{const u=new URL(raw);return u.origin+u.pathname.replace(/\/$/,'')}catch{return String(raw||'—')}};
  const service=!p?'—':comfy?['ComfyUI',address(c.baseUrl),c.mode==='mock'?L('本地预览模式'):rt.engineOk?L('已连接')+(rt.latency!=null?' '+rt.latency+' ms':''):rt.engineChecked?L('未连接'):L('检测中')].join(' · '):[p.title,p.provider,address(p.baseUrl),p.model||'—',providerSetupIssues(p).length?L('待配置'):L('就绪')].join(' · ');
  const lines=['Mio '+MIO_VERSION+' · '+new Date().toISOString(),line('页面',L(HELP_PAGES[helpPageKey()].title)),
    line('界面',[state.settings.presentation.language||'zh-CN',document.documentElement.dataset.theme||'dark',innerWidth+'×'+innerHeight,matchMedia('(pointer:coarse)').matches?L('触屏'):L('鼠标')].join(' · ')),
    line('浏览器',navigator.userAgent),line('保存',L(backendStatusText())),line('图像服务',service)];
  if(comfy){const w=helpActiveWorkflow();if(w){const problems=helpModelProblems(w);lines.push(line('工作流',[w.title,localeString('映射 {n} 项',{n:(w.bindings||[]).filter(b=>b.enabled!==false).length}),workflowSeedReady(w)?L('种子已映射'):L('种子未映射')].join(' · ')));if(problems.length)lines.push(line('模型',problems.map(x=>WorkflowSlots.loraStem(x.value)+(x.placeholder?' ('+L('占位名')+')':'')).join('、')))}else lines.push(line('工作流','—'))}
  const tasks=workshop.queue?.tasks||[],counts={};for(const t of tasks)counts[t.status]=(counts[t.status]||0)+1;
  lines.push(line('画册集',[project()?.title||'—',localeString('{books} 本画册 · {stories} 个分镜 · {presets} 个预设',{books:state.books.filter(b=>b.projectId===state.activeProjectId).length,stories:projectTemplates().length,presets:projectVariableSets().length})].join(' · ')));
  lines.push(line('生成任务',tasks.length?Object.entries(counts).map(([s,n])=>L(productionStatus(s))+' '+n).join(' · '):'0'));
  const checks=setupChecklist(),open=checks.filter(i=>i.state!=='done');
  lines.push(line('开箱检查',checks.length-open.length+' / '+checks.length+(open.length?' · '+L('未完成')+'：'+open.map(i=>L(i.title)).join('、'):'')));
  const failures=tasks.filter(t=>t.error).slice(-3).map(t=>'  · '+t.title+'：'+String(t.error).split('\n')[0].slice(0,240));
  const errors=rt.logs.filter(x=>x.level==='error').slice(-5).map(x=>'  · '+new Date(x.time).toLocaleTimeString('zh-CN',{hour12:false})+' '+String(x.message).split('\n')[0].slice(0,240));
  lines.push(line('最近错误',failures.length||errors.length?'':L('无')),...failures,...errors);
  return lines.join('\n');
}

function helpDrawerHTML(){
  const key=helpPageKey(),page=HELP_PAGES[key],comfy=activeImageProfile()?.provider==='comfyui';
  const actions=[...page.actions];if(key==='workflow'&&comfy)actions.push(['测试 ComfyUI 连接','refresh','help-test-engine']);
  if(key==='stories'&&!workshopStory())actions.splice(1);
  const terms=page.terms.filter(t=>HELP_GLOSSARY[t]),docs=[...new Set([...page.docs,'quickstart','troubleshooting'])];
  const center=state.settings.presentation.language==='en'?'/docs/en/GUIDE.html':'/docs/index.html';
  return `<header class="help-drawer-head"><div class="grow"><p class="help-kicker">HELP</p><h2 id="help-drawer-title" tabindex="-1" autofocus>${esc(localeString(page.title))}</h2></div>${ibtn('close','help-drawer-close','关闭帮助')}</header>
  <div class="help-drawer-body">
  <section class="help-section help-context" id="help-context" aria-label="${esc(localeString('本页说明'))}"><p class="help-lead">${esc(localeString(page.text))}</p>${actions.length?`<div class="help-actions">${actions.map(([label,ic,act])=>btn(label,ic,act,'','small')).join('')}</div>`:''}${terms.length?`<dl class="help-terms">${terms.map(t=>`<div><dt>${esc(localeString(t))}</dt><dd>${esc(localeString(HELP_GLOSSARY[t]))}</dd></div>`).join('')}</dl>`:''}</section>
  ${helpChecklistHTML()}
  <section class="help-section help-docs" id="help-docs" aria-labelledby="help-docs-title"><header class="help-section-head"><h3 id="help-docs-title" tabindex="-1">教程</h3></header><ul class="help-doc-list">${docs.map(k=>`<li><a href="${esc(helpDocHref(k))}" target="_blank" rel="noopener">${esc(localeString(HELP_DOCS[k][0]))}<span aria-hidden="true">↗</span></a></li>`).join('')}<li><a href="${center}" target="_blank" rel="noopener">${esc(localeString('教程中心'))}<span aria-hidden="true">↗</span></a></li></ul><div class="help-actions">${btn('快速开始教程','help','help-quickstart','','small ghost')}${btn('工具与资源','grid','v3-resources','','small ghost')}</div></section>
  ${helpKeysHTML()}
  <section class="help-section help-diagnostics" id="help-diagnostics" aria-labelledby="help-diagnostics-title"><header class="help-section-head"><h3 id="help-diagnostics-title" tabindex="-1">诊断信息</h3>${btn('复制诊断信息','copy','help-copy-diagnostics','','small')}</header><p class="help-note">报告问题时附上这段信息，便于定位原因。</p><details class="help-diagnostics-view"><summary>查看内容</summary><pre id="help-diagnostics-text" data-user-content>${esc(helpDiagnosticsText())}</pre></details></section>
  </div>`;
}

function helpDrawerElement(){
  let d=document.getElementById('help-drawer');if(d)return d;
  d=document.createElement('dialog');d.id='help-drawer';d.className='help-drawer';d.setAttribute('aria-labelledby','help-drawer-title');
  /* The backdrop closes the drawer (it holds nothing to lose). The app swallows clicks on dialog elements, so this listens
     for the press; the click that follows lands on <body> and triggers nothing. */
  d.addEventListener('pointerdown',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeHelpDrawer()});
  d.addEventListener('click',e=>{const el=e.target.closest?.('[data-act]');if(!el||HELP_STAY_ACTS.has(el.dataset.act))return;helpUI.leaving=true;d.close()},true);
  /* Focus goes back to whatever opened the drawer; the top bar may have been redrawn meanwhile, so its “?” is looked up again. */
  d.addEventListener('close',()=>{const o=helpUI.opener,back=helpUI.leaving||!o?null:o.isConnected?o:o.dataset?.act==='help-drawer'?document.querySelector('#topbar [data-act="help-drawer"]'):null;helpUI.leaving=false;helpUI.opener=null;back?.focus()});
  document.body.append(d);return d;
}
function openHelpDrawer(section=''){
  const d=helpDrawerElement();
  if(!d.open)helpUI.opener=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:null;
  d.innerHTML=helpDrawerHTML();
  if(!d.open)d.showModal();
  const target=section?d.querySelector('#help-'+section):null;
  if(target){target.scrollIntoView({block:'start'});target.querySelector('h3')?.focus({preventScroll:true})}
}
function closeHelpDrawer(){const d=document.getElementById('help-drawer');if(d?.open)d.close()}
function refreshHelpChecklist(){
  const d=document.getElementById('help-drawer'),old=d?.open?d.querySelector('#help-checklist'):null;if(!old)return;
  const focused=old.contains(document.activeElement)?(document.activeElement.closest('[data-check]')?.dataset.check||''):null;
  const box=document.createElement('div');box.innerHTML=helpChecklistHTML();const next=box.firstElementChild;old.replaceWith(next);
  if(focused!==null)(next.querySelector(`[data-check="${focused}"] button`)||next.querySelector('h3'))?.focus({preventScroll:true});
  const pre=d.querySelector('#help-diagnostics-text');if(pre)pre.textContent=helpDiagnosticsText();
}

function installHelpDrawer(){
  const previous=handleAction;handleAction=async function(action,d={},el){
    switch(action){
      case 'help-drawer':openHelpDrawer();return;
      case 'help-drawer-close':closeHelpDrawer();return;
      case 'help-copy-diagnostics':await copyText(helpDiagnosticsText());return;
      case 'help-test-engine':await testEngine(false);refreshHelpChecklist();return;
      case 'help-add-seed':addWorkflowSeedMapping(state.settings.comfy.activeWorkflowId);if(ui.workspace===3)render();toast('已添加种子映射：每一幕都会写入自己的种子。');refreshHelpChecklist();return;
      case 'help-sync-models':await readComfyObjectInfo();refreshHelpChecklist();return;
      case 'help-new-story':case 'help-new-preset':workshop.view=action==='help-new-story'?'stories':'presets';navigate(1);await handleAction('workshop-new',{});return;
      case 'help-quickstart':openQuickStart();return;
    }
    return previous(action,d,el);
  };
  /* “?” opens the drawer at the shortcuts (and closes it again); typing a question mark in a field is left alone. */
  document.addEventListener('keydown',e=>{
    if(e.key!=='?'||e.ctrlKey||e.metaKey||e.altKey||e.isComposing||e.target?.closest?.('input,textarea,select,[contenteditable]'))return;
    const open=document.querySelector('dialog[open]');
    if(open&&open.id!=='help-drawer')return;
    e.preventDefault();if(open)closeHelpDrawer();else openHelpDrawer('keys');
  });
  if(typeof onEngineChecked==='function'){const engineChecked=onEngineChecked;onEngineChecked=function(rec){engineChecked(rec);refreshHelpChecklist()}}
}
