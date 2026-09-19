/* Home is a navigation-only workspace. Never probes providers or starts generation. */
'use strict';

function homeModuleItems() {
  const visible = new Set(primaryNavItems().map(item => item[0]));
  return [
    {route:0, icon:'book', title:'画册集', description:'让完成的画面，有一个好好收藏的地方。阅读、整理、导入与导出你的画册。', label:'打开画册集', tone:'paper', tag:'COLLECT', detail:'阅读 · 收藏 · 导出'},
    {route:1, icon:'story', title:'创作工坊', description:'从一幕分镜开始，搭配角色与画风预设，再把故事装配成待命任务。', label:'打开创作工坊', tone:'sage', tag:'CREATE', detail:'分镜 · 预设 · 装配'},
    {route:3, icon:'nodes', title:'工作流与 API 配置', description:'连接 ComfyUI、NovelAI 或 OpenAI 兼容服务。选好渠道，再开始创作。', label:'打开渠道配置', tone:'ink', tag:'CONNECT', detail:'地址 · 模型 · 密钥'},
    {route:7, icon:'toolbox', title:'可选功能', description:'按需使用创作助手、视觉审校与扩展工具，不打扰主要创作流程。', label:'打开可选功能'},
    {route:4, icon:'spark', title:'AI 写故事', description:'借助文字模型构思情节、整理大纲，把想法逐步写成故事。', label:'打开 AI 写故事'},
    {route:8, icon:'box', title:'模板与扩展市场', description:'寻找可复用的分镜、视觉资源和扩展，按需装进自己的工作室。', label:'打开模板与扩展市场'},
    {route:6, icon:'terminal', title:'运行日志', description:'查看运行记录与错误线索。遇到问题，先了解发生了什么。', label:'打开运行日志'}
  ].map(item => ({...item, enabled:visible.has(item.route)}));
}

function homeArtwork() {
  return `<div class="home-art" aria-hidden="true"><svg viewBox="0 0 420 320" fill="none"><defs><linearGradient id="home-paper" x1="100" y1="20" x2="320" y2="300" gradientUnits="userSpaceOnUse"><stop stop-color="var(--home-paper)"/><stop offset="1" stop-color="var(--home-paper-shade)"/></linearGradient></defs><ellipse cx="220" cy="280" rx="150" ry="18" fill="currentColor" opacity=".07"/><path d="M39 243 348 69M63 57 375 254" stroke="currentColor" stroke-opacity=".14"/><rect x="105" y="35" width="224" height="242" rx="9" transform="rotate(10 105 35)" fill="var(--home-sage)" stroke="currentColor" stroke-opacity=".2"/><rect x="80" y="36" width="230" height="248" rx="9" transform="rotate(-7 80 36)" fill="url(#home-paper)" stroke="currentColor" stroke-opacity=".24"/><g transform="rotate(-7 80 36)"><path d="M101 59H289M101 262H289" stroke="#405642" stroke-opacity=".3"/><rect x="101" y="76" width="188" height="103" rx="4" fill="#4c6856"/><circle cx="247" cy="104" r="13" fill="#d0d6ad"/><path d="m101 153 49-43 52 45 37-24 50 36v12H101Z" fill="#84997a"/><path d="m101 167 50-22 44 25 51-25 43 17v17H101Z" fill="#304c40"/><rect x="101" y="190" width="88" height="55" rx="4" fill="#a7b697"/><circle cx="145" cy="209" r="9" fill="#40584a"/><path d="M123 245c2-13 10-19 22-19s20 6 22 19Z" fill="#40584a"/><rect x="201" y="190" width="88" height="55" rx="4" fill="#c3b993"/><path d="M215 197h60a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6h-41l-12 9v-9h-7a6 6 0 0 1-6-6v-20a6 6 0 0 1 6-6Z" fill="#f4f2e1" stroke="#776f50" stroke-opacity=".55"/><path d="M220 209h48m-48 9h32" stroke="#776f50" stroke-opacity=".7" stroke-linecap="round" stroke-width="2"/></g><path d="m353 38 5 13 13 5-13 5-5 13-5-13-13-5 13-5Z" fill="var(--home-sage)"/><circle cx="47" cy="203" r="7" stroke="var(--home-sage)" stroke-width="3"/><circle cx="365" cy="224" r="3" fill="currentColor" opacity=".45"/></svg><span>STORY → FRAMES → ALBUM</span></div>`;
}

function renderHome() {
  const modules=homeModuleItems();
  return `<section id="mio-home" aria-labelledby="home-title">
    <header class="home-hero"><div class="home-intro"><div class="home-eyebrow"><span></span>MIO / A LOCAL-FIRST COMIC STUDIO</div><h1 id="home-title"><span>让故事成帧，</span><span class="home-title-accent">让灵感成册。</span></h1><p class="home-lead">Mio 是一间运行在你电脑上的漫画工作室：写下分镜与角色，接入 ComfyUI、NovelAI 或 OpenAI 兼容服务，一次生成整本画册，再逐页阅读、导出与分享。</p><div class="home-hero-actions">${btn('从一幕开始','plus','home-open','data-route="1" data-view="stories"','primary')}${btn('浏览我的画册','arrow','home-open','data-route="0"','ghost')}</div><p class="home-reassurance">无需先连接模型，也可以编辑分镜与阅读画册。</p></div>${homeArtwork()}</header>
    <ol class="home-steps" aria-label="创作流程">${[['写分镜','一幕一句话，角色与画风交给预设。'],['连服务','ComfyUI、NovelAI 或 OpenAI 兼容，任选其一。'],['出画册','整本一次生成，逐页阅读、导出与分享。']].map(([title,text],i)=>`<li><b>0${i+1}</b><span><strong>${title}</strong><small>${text}</small></span></li>`).join('')}</ol>
    <section class="home-section" aria-labelledby="home-start-title"><header class="home-section-head"><div><div class="home-kicker">01 / YOUR WORKSPACE</div><h2 id="home-start-title">从这里，进入创作。</h2></div><p>三个主要工作区，沿着你的创作节奏展开。</p></header><div class="home-primary-grid">${modules.slice(0,3).map((m,i)=>`<button class="home-module home-module-${m.tone}" data-act="home-open" data-route="${m.route}" aria-label="${m.label}"><span class="home-card-top"><span class="home-module-icon">${icon(m.icon)}</span><span class="home-card-index">0${i+1} / ${m.tag}</span></span><h3>${m.title}</h3><p>${m.description}</p><span class="home-card-foot"><span>${m.detail}</span>${icon('arrow')}</span></button>`).join('')}</div></section>
    <section class="home-section home-get-started" aria-label="首次使用与教程"><div class="home-kicker">02 / GET STARTED</div>${firstRunHome()}<a class="home-learning" href="${state.settings.presentation.language==='en'?'/docs/en/GUIDE.html':'/docs/index.html'}" target="_blank" rel="noopener">${icon('book')}<span><strong>使用教程 · 从这里开始</strong><small>首次生成、图片变量、手机访问与常见问题</small></span><b>打开教程 ↗</b></a></section>
    <section class="home-section" aria-labelledby="home-more-title"><header class="home-section-head"><div><div class="home-kicker">03 / MAKE IT YOURS</div><h2 id="home-more-title">需要时，再多一点可能。</h2></div><p>可选模块按需开启，保持工作台清爽。</p></header><div class="home-secondary-grid">${modules.slice(3).map(m=>`<button class="home-secondary" data-act="home-open" data-route="${m.route}" aria-label="${m.enabled?m.label:'前往设置启用'+m.title}"><span class="home-secondary-icon">${icon(m.icon)}</span><span class="home-secondary-body"><span class="home-secondary-title"><strong>${m.title}</strong><small class="${m.enabled?'is-enabled':''}">${m.enabled?'已开启':'按需开启'}</small></span><span class="home-secondary-description">${m.description}</span><span class="home-secondary-link">${m.enabled?'进入模块':'前往设置启用'} ↗</span></span></button>`).join('')}</div>
    <button class="home-settings" data-act="home-open" data-route="5" aria-label="打开设置">${icon('settings')}<span><strong>把工作室调成喜欢的样子</strong><small>外观与语言、文件与保存、功能开关，都在设置里。</small></span><b>工作室设置 →</b></button></section>
    <footer class="home-footer"><span>MIO / MADE FOR YOUR STORIES</span><p>故事由你书写，开始由你决定。</p></footer>
  </section>`;
}

function installHome() {
  paths.home='<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z"/>';
  const previousRender=render;
  render=function(...args){
    if(ui.workspace!==9)return previousRender(...args);
    ensureStudioState();artUI.editorObserver?.disconnect();renderShell();patchMain(renderHome());
    delete $('#main').dataset.editorTemplateId;delete $('#main').dataset.editorFrameIndex;
    applyStudioPreferences();localizeWorkspace();
  };
  const previousNavigate=navigate;
  navigate=function(index){
    if(Number(index)!==9)return previousNavigate(index);
    flushEditor();ui.workspace=9;render();window.scrollTo({top:0,behavior:'instant'});
  };
  const previousAction=handleAction;
  handleAction=async function(action,data={},element){
    if(action==='home-return'){navigate(9);return}
    if(action!=='home-open')return previousAction(action,data,element);
    const route=Number(data.route);
    if(![0,1,3,4,5,6,7,8].includes(route))return;
    if(!primaryNavItems().some(item=>item[0]===route)){studioUI.settingsTab='modules';navigate(5);return}
    if(route===1)workshop.view=data.view||'stories';
    if(route===5)studioUI.settingsTab='appearance';
    navigate(route);
  };
  const previousShell=renderShell;
  renderShell=function(...args){const result=previousShell(...args);const brand=$('#sidebar .brand');if(brand){brand.dataset.act='home-return';delete brand.dataset.route;brand.setAttribute('href','#home')}const nav=$('#sidebar nav');
    if(nav&&nav.dataset.homeRoute!==String(ui.workspace)){
      nav.dataset.homeRoute=String(ui.workspace);
      if(matchMedia('(max-width:760px), (max-width:950px) and (hover:none) and (pointer:coarse)').matches){const active=nav.querySelector('[aria-current="page"]');if(active)nav.scrollLeft=Math.max(0,active.offsetLeft-nav.offsetLeft-(nav.clientWidth-active.offsetWidth)/2)}
    }
    return result;
  };
}
