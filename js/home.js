/* Home is a navigation-only workspace. Never probes providers or starts generation. */
'use strict';

function homeArtwork() {
  return `<div class="home-art" aria-hidden="true"><svg viewBox="0 0 420 320" fill="none"><defs><linearGradient id="home-paper" x1="100" y1="20" x2="320" y2="300" gradientUnits="userSpaceOnUse"><stop stop-color="var(--home-paper)"/><stop offset="1" stop-color="var(--home-paper-shade)"/></linearGradient></defs><ellipse cx="220" cy="280" rx="150" ry="18" fill="currentColor" opacity=".07"/><path d="M39 243 348 69M63 57 375 254" stroke="currentColor" stroke-opacity=".14"/><rect x="105" y="35" width="224" height="242" rx="9" transform="rotate(10 105 35)" fill="var(--home-sage)" stroke="currentColor" stroke-opacity=".2"/><rect x="80" y="36" width="230" height="248" rx="9" transform="rotate(-7 80 36)" fill="url(#home-paper)" stroke="currentColor" stroke-opacity=".24"/><g transform="rotate(-7 80 36)"><path d="M101 59H289M101 262H289" stroke="#405642" stroke-opacity=".3"/><rect x="101" y="76" width="188" height="103" rx="4" fill="#4c6856"/><circle cx="247" cy="104" r="13" fill="#d0d6ad"/><path d="m101 153 49-43 52 45 37-24 50 36v12H101Z" fill="#84997a"/><path d="m101 167 50-22 44 25 51-25 43 17v17H101Z" fill="#304c40"/><rect x="101" y="190" width="88" height="55" rx="4" fill="#a7b697"/><circle cx="145" cy="209" r="9" fill="#40584a"/><path d="M123 245c2-13 10-19 22-19s20 6 22 19Z" fill="#40584a"/><rect x="201" y="190" width="88" height="55" rx="4" fill="#c3b993"/><path d="M215 197h60a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6h-41l-12 9v-9h-7a6 6 0 0 1-6-6v-20a6 6 0 0 1 6-6Z" fill="#f4f2e1" stroke="#776f50" stroke-opacity=".55"/><path d="M220 209h48m-48 9h32" stroke="#776f50" stroke-opacity=".7" stroke-linecap="round" stroke-width="2"/></g><path d="m353 38 5 13 13 5-13 5-5 13-5-13-13-5 13-5Z" fill="var(--home-sage)"/><circle cx="47" cy="203" r="7" stroke="var(--home-sage)" stroke-width="3"/><circle cx="365" cy="224" r="3" fill="currentColor" opacity=".45"/></svg><span>STORY → FRAMES → ALBUM</span></div>`;
}

/* Home keeps only the hero, the three-step overview, GET STARTED and the footer; the module grids were removed to reduce clutter — every workspace is one click away in the sidebar. */
function renderHome() {
  return `<section id="mio-home" aria-labelledby="home-title">
    <header class="home-hero"><div class="home-intro"><div class="home-eyebrow"><span></span>MIO / A LOCAL-FIRST COMIC STUDIO</div><h1 id="home-title"><span>让故事成帧，</span><span class="home-title-accent">让灵感成册。</span></h1><p class="home-lead">Mio 是一间运行在你电脑上的漫画工作室：写下分镜与角色，接入 ComfyUI、NovelAI 或 OpenAI 兼容服务，一次生成整本画册，再逐页阅读、导出与分享。</p><div class="home-hero-actions">${btn('从一幕开始','plus','home-open','data-route="1" data-view="stories"','primary')}${btn('浏览我的画册','arrow','home-open','data-route="0"','ghost')}</div><p class="home-reassurance">无需先连接模型，也可以编辑分镜与阅读画册。</p></div>${homeArtwork()}</header>
    <ol class="home-steps" aria-label="创作流程">${[['写分镜','一幕一句话，角色与画风交给预设。'],['连服务','ComfyUI、NovelAI 或 OpenAI 兼容，任选其一。'],['出画册','整本一次生成，逐页阅读、导出与分享。']].map(([title,text],i)=>`<li><b>0${i+1}</b><span><strong>${title}</strong><small>${text}</small></span></li>`).join('')}</ol>
    <section class="home-section home-get-started" aria-label="首次使用与教程"><div class="home-kicker">GET STARTED</div>${firstRunHome()}<a class="home-learning" href="${state.settings.presentation.language==='en'?'/docs/en/GUIDE.html':'/docs/index.html'}" target="_blank" rel="noopener">${icon('book')}<span><strong>使用教程 · 从这里开始</strong><small>首次生成、图片变量、手机访问与常见问题</small></span><b>打开教程 ↗</b></a></section>
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
