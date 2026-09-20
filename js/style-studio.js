/* 样式工坊 (Style Studio) — the 设置 → 样式工坊 screen.
   Theme stack management, live CSS snippets with an element picker, design-token overrides
   discovered from the running stylesheets, style assets (fonts/images) and "export as theme".
   Persistence goes through /api/ecosystem/styles* (backend/ecosystem/styles.py); the four
   <style data-mio-layer> elements in <head> are owned by platform.js. */
'use strict';
const styleStudio={tab:'themes',loaded:false,loading:null,snippets:[],tokens:{shared:{},dark:{},light:{}},assets:[],draft:null,previewing:false,previewTimer:null,saveTimer:null,tokenTimer:null,themeTimer:null,tokenMode:'shared',tokenQuery:'',picking:false,pickHandlers:null,openTheme:''};
const SS_RECIPES=[
  {id:'hide-statusbar',name:'隐藏底部状态栏',css:'.statusbar{display:none}\n.app{padding-bottom:0}'},
  {id:'compact-sidebar',name:'更窄的侧栏',css:':root{--nav-width:168px}\n.sidebar .nav-item{padding:10px 12px}\n.sidebar .brand{height:70px}'},
  {id:'soft-cards',name:'柔和卡片：更大圆角与阴影',css:'.panel,.setting-group,.eco-package,.home-module,.studio-card{border-radius:14px;box-shadow:0 10px 30px rgb(var(--shadow-rgb)/.12)}\n.btn{border-radius:10px}'},
  {id:'accent',name:'换一个强调色',css:':root,:root[data-theme]{--accent:#e8a33d;--accent2:#c9862a;--on-accent:#1c1207;--tint:#3a2d18}\n:root[data-theme=light]{--accent:#b8661a;--accent2:#d48a3a;--on-accent:#fff7ec;--tint:#f5e3cc}'},
  {id:'font',name:'整站字体（先在“资源”里上传字体文件）',css:'@font-face{font-family:"MyFont";src:url(/style-assets/MyFont.woff2) format("woff2");font-display:swap}\n:root,:root[data-theme]{--sans:"MyFont","PingFang SC","Microsoft YaHei",sans-serif}'},
  {id:'background',name:'背景图片（先在“资源”里上传图片）',css:'body{background:var(--bg) url(/style-assets/background.jpg) center/cover fixed no-repeat}\n.main{background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(2px)}'},
  {id:'glass-topbar',name:'毛玻璃顶栏',css:'.topbar{background:color-mix(in srgb,var(--bg) 70%,transparent);backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2)}'},
  {id:'reader-dark',name:'阅读室：纯黑舞台',css:':root,:root[data-theme]{--reader-bg:#000;--reader-surface:#0a0a0a;--reader-line:#222}'},
  {id:'no-motion',name:'减少动效',css:'*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'},
  {id:'scrollbar',name:'细滚动条',css:'*{scrollbar-width:thin;scrollbar-color:var(--line) transparent}\n::-webkit-scrollbar{width:8px;height:8px}\n::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}'},
  {id:'hide-element',name:'隐藏某个元素（配合“拾取元素”）',css:'/* 点击“拾取元素”，把生成的选择器粘到下面 */\n.selector-here{display:none!important}'},
  {id:'bigger-text',name:'放大界面文字',css:'html{font-size:15px}\nbody{font-size:14px}\n.nav-item,.btn{font-size:13px}'}
];
/* ------------------------------------------------------------------ data */
function ssLoad(force=false){
  if(styleStudio.loaded&&!force)return Promise.resolve();
  if(styleStudio.loading)return styleStudio.loading;
  styleStudio.loading=ecoRequest('styles').then(data=>{styleStudio.snippets=data.snippets||[];styleStudio.tokens={shared:{},dark:{},light:{},...(data.tokens||{})};styleStudio.assets=data.assets||[];styleStudio.loaded=true;if(styleStudio.draft){const fresh=styleStudio.snippets.find(s=>s.id===styleStudio.draft.id);if(!fresh&&!styleStudio.draft.isNew)styleStudio.draft=null}}).catch(e=>{ecoState.errors.push('样式工坊：'+e.message)}).finally(()=>{styleStudio.loading=null});
  return styleStudio.loading;
}
function ssTokensCss(tokens){
  const selector={shared:':root,:root[data-theme]',dark:':root[data-theme=dark]',light:':root[data-theme=light]'};
  return Object.entries(tokens||{}).filter(([mode,values])=>selector[mode]&&values&&Object.keys(values).length).map(([mode,values])=>selector[mode]+'{'+Object.entries(values).filter(([,v])=>String(v).trim()).map(([k,v])=>k+':'+v).join(';')+'}').join('\n');
}
function ssSnippetsCss(snippets,draft){
  return snippets.map(s=>{const css=draft&&draft.id===s.id?draft.css:s.css;const enabled=draft&&draft.id===s.id?true:s.enabled!==false;return enabled&&String(css||'').trim()?'/* == 快速样式：'+String(s.name||'').replace(/\*\//g,'')+' == */\n'+css:''}).filter(Boolean).concat(draft&&draft.isNew&&draft.css.trim()?['/* == 草稿 == */\n'+draft.css]:[]).join('\n\n');
}
function ssApplyPreview(){
  styleStudio.previewing=true;
  MioPlatform.layer('user-tokens').textContent=ssTokensCss(styleStudio.tokens);
  MioPlatform.layer('user-snippets').textContent=ssSnippetsCss(styleStudio.snippets,styleStudio.draft);
  const status=$('#ss-status');if(status)status.textContent=styleStudio.draft?.dirty?'实时预览中 · 尚未保存（⌘/Ctrl+S）':'已保存 · 实时生效';
}
function ssSchedulePreview(){clearTimeout(styleStudio.previewTimer);styleStudio.previewTimer=setTimeout(ssApplyPreview,150)}
async function ssPersistSnippets(){const out=await ecoRequest('styles/snippets',{snippets:styleStudio.snippets.map(s=>({id:s.id,name:s.name,css:s.css,enabled:s.enabled!==false}))});styleStudio.snippets=out;MioPlatform.emit('styles.changed',{kind:'snippets'},{relay:false})}
async function ssSaveDraft(){
  const d=styleStudio.draft;if(!d)return;const name=$('#ss-name')?.value.trim()||d.name||'未命名样式';const css=$('#ss-css')?.value??d.css;
  const saved=await ecoRequest('styles/snippet',{snippet:{...(d.isNew?{}:{id:d.id}),name,css,enabled:true}});
  const index=styleStudio.snippets.findIndex(s=>s.id===saved.id);if(index>=0)styleStudio.snippets[index]=saved;else styleStudio.snippets.push(saved);
  styleStudio.draft={id:saved.id,name:saved.name,css:saved.css,dirty:false,isNew:false};styleStudio.previewing=false;
  await applyEcosystemTheme();MioPlatform.emit('styles.changed',{kind:'snippet',id:saved.id},{relay:false});render();toast('样式已保存并生效。');
}
function ssScheduleTokenSave(){clearTimeout(styleStudio.tokenTimer);styleStudio.tokenTimer=setTimeout(async()=>{try{styleStudio.tokens={shared:{},dark:{},light:{},...await ecoRequest('styles/tokens',{tokens:styleStudio.tokens})};styleStudio.previewing=!!styleStudio.draft?.dirty;if(!styleStudio.previewing)await applyEcosystemTheme();const status=$('#ss-token-status');if(status)status.textContent='已保存';MioPlatform.emit('styles.changed',{kind:'tokens'},{relay:false})}catch(e){toast(e.message,'error')}},600)}
/* ------------------------------------------------------------- discovery */
function ssDiscoverTokens(){
  const names=new Map();const add=(name,mode,value)=>{const row=names.get(name)||{name,modes:new Set(),values:{}};row.modes.add(mode);row.values[mode]=value;names.set(name,row)};
  for(const sheet of document.styleSheets){const node=sheet.ownerNode;if(node?.dataset?.mioLayer||node?.dataset?.mioStyle)continue;let rules;try{rules=sheet.cssRules}catch{continue}
    for(const rule of rules){if(!rule.selectorText||!rule.style)continue;const sel=rule.selectorText;const mode=sel===':root'||sel==='html'?'shared':/\[data-theme=["']?light["']?\]/.test(sel)&&!/\s/.test(sel.replace(/\[.*?\]/g,''))?'light':/\[data-theme=["']?dark["']?\]/.test(sel)&&!/\s/.test(sel.replace(/\[.*?\]/g,''))?'dark':null;if(!mode)continue;for(let i=0;i<rule.style.length;i++){const name=rule.style[i];if(name.startsWith('--'))add(name,mode,rule.style.getPropertyValue(name).trim())}}}
  for(const mode of ['shared','dark','light'])for(const name of Object.keys(styleStudio.tokens[mode]||{}))add(name,mode,styleStudio.tokens[mode][name]);
  return [...names.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function ssToHex(value){
  value=String(value||'').trim();let m=/^#([0-9a-f]{3})$/i.exec(value);if(m)return '#'+[...m[1]].map(c=>c+c).join('').toLowerCase();m=/^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);if(m)return '#'+m[1].toLowerCase();
  m=/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);if(m)return '#'+[m[1],m[2],m[3]].map(n=>Number(n).toString(16).padStart(2,'0')).join('');return null;
}
function ssComputed(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim()}
/* ----------------------------------------------------------- selectors */
function ssSelectorFor(el){
  const parts=[];let node=el;
  while(node&&node!==document.body&&node!==document.documentElement&&parts.length<5){
    if(node.id&&!/\d{3,}/.test(node.id)&&!/^(main|modal)$/.test(node.id)){parts.unshift('#'+CSS.escape(node.id));break}
    let sel=node.tagName.toLowerCase();const act=node.dataset.act,route=node.dataset.route||node.dataset.tab;
    if(act)sel+=`[data-act="${act}"]`+(route?`[data-${node.dataset.route?'route':'tab'}="${route}"]`:'');
    else{const classes=[...node.classList].filter(c=>!/^(active|is-|mio-|art-fade|grow|spacer$)/.test(c)&&!/\d/.test(c)).slice(0,2);if(classes.length)sel=(['div','span','section','article'].includes(sel)?'':sel)+'.'+classes.map(c=>CSS.escape(c)).join('.')}
    parts.unshift(sel);
    let unique=false;try{unique=document.querySelectorAll(parts.join(' ')).length===1}catch{unique=false}
    if(unique||act)break;node=node.parentElement;
  }
  return parts.join(' ')||'body';
}
function ssStartPick(){
  if(styleStudio.picking)return;styleStudio.picking=true;
  const box=document.createElement('div');box.id='mio-pick-box';box.innerHTML='<span></span>';document.body.append(box);document.documentElement.classList.add('mio-picking');
  const label=box.firstChild;
  const move=e=>{const t=e.target;if(!(t instanceof Element)||t.closest('#mio-pick-box'))return;const r=t.getBoundingClientRect();box.style.left=r.left+'px';box.style.top=r.top+'px';box.style.width=r.width+'px';box.style.height=r.height+'px';label.textContent=ssSelectorFor(t)};
  const down=e=>{if(e.shiftKey)return;e.preventDefault();e.stopPropagation()};
  const click=e=>{if(e.shiftKey)return;e.preventDefault();e.stopPropagation();const t=e.target instanceof Element?e.target:null;ssStopPick();if(t)ssInsertSelector(ssSelectorFor(t))};
  const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();ssStopPick();toast('已退出拾取模式。')}};
  styleStudio.pickHandlers={move,down,click,key};
  document.addEventListener('mousemove',move,true);document.addEventListener('mousedown',down,true);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true);
  toast('拾取模式：点击任意元素生成选择器；Shift+点击可照常操作界面；Esc 退出。');
}
function ssStopPick(){
  if(!styleStudio.picking)return;styleStudio.picking=false;const h=styleStudio.pickHandlers;styleStudio.pickHandlers=null;
  document.removeEventListener('mousemove',h.move,true);document.removeEventListener('mousedown',h.down,true);document.removeEventListener('click',h.click,true);document.removeEventListener('keydown',h.key,true);
  $('#mio-pick-box')?.remove();document.documentElement.classList.remove('mio-picking');
}
function ssInsertSelector(selector){
  const block='\n'+selector+' {\n  \n}\n';
  if(!styleStudio.draft)styleStudio.draft={id:uid('css'),name:'拾取样式',css:'',dirty:true,isNew:true};
  const area=$('#ss-css');
  if(area){const focused=document.activeElement===area;const start=focused?area.selectionStart:area.value.length;area.setRangeText(block,start,focused?area.selectionEnd:start,'end');styleStudio.draft.css=area.value;area.focus();const caret=start+block.indexOf('  \n')+2;area.setSelectionRange(caret,caret)}
  else styleStudio.draft.css=(styleStudio.draft.css||'')+block;
  styleStudio.draft.dirty=true;styleStudio.tab='snippets';navigator.clipboard?.writeText(selector).catch(()=>{});ssSchedulePreview();
  if(!area||ui.workspace!==5||studioUI.settingsTab!=='themes'){studioUI.settingsTab='themes';navigate(5)}
  toast('已插入选择器：'+selector);
}
/* ---------------------------------------------------------------- render */
function renderStyleStudio(){
  if(!styleStudio.loaded){ssLoad().then(()=>{if(ui.workspace===5&&studioUI.settingsTab==='themes')render()})}
  const tab=styleStudio.tab,tabs=[['themes','sun','主题包'],['snippets','edit','快速样式'],['tokens','settings','设计令牌'],['assets','folder','资源'],['help','help','帮助']];
  const body=!styleStudio.loaded?'<p class="soft">正在读取样式…</p>':tab==='snippets'?ssRenderSnippets():tab==='tokens'?ssRenderTokens():tab==='assets'?ssRenderAssets():tab==='help'?ssRenderHelp():ssRenderThemes();
  return `<section class="eco-settings style-studio"><header class="eco-heading"><span class="context-kicker">样式工坊 · 让工作室长成你的样子</span><h2>主题可叠加，CSS 随手写，改完立刻看到。</h2><p>主题包负责整体气质；快速样式解决“这个按钮我想换个颜色”；设计令牌一处改全站变；上传字体和图片当作资源引用。随时可以用 <a href="?safe_mode=1">安全模式</a> 回到官方外观。</p></header><nav class="quiet-tabs ss-tabs" aria-label="样式工坊分类">${tabs.map(([id,ic,label])=>`<button type="button" class="${id===tab?'active':''}" data-act="ss-tab" data-tab="${id}">${icon(ic,'sm')}<span>${label}</span></button>`).join('')}</nav>${body}${ecoState.errors.length?`<details class="quiet-advanced" open><summary>加载诊断</summary>${ecoState.errors.map(e=>`<p class="danger">${esc(e)}</p>`).join('')}${btn('清空诊断','trash','eco-clear-errors','','small ghost')}</details>`:''}</section>`;
}
function ssThemeBadges(t){const parts=[];const variants=Object.keys(t.variants||{});if(variants.includes('dark')&&variants.includes('light'))parts.push('深/浅色');const looks=variants.filter(v=>v!=='dark'&&v!=='light');if(looks.length)parts.push('外观 ×'+looks.length);if(t.tokens&&Object.keys(t.tokens).length)parts.push('令牌');if(t.icons)parts.push('图标包');if(t.script)parts.push('脚本');if(t.settings?.length)parts.push('可调 '+t.settings.length+' 项');if(t.colorScheme&&t.colorScheme!=='auto')parts.push('固定'+(t.colorScheme==='dark'?'深色':'浅色'));parts.push('SDK '+(t.apiVersion||1));return parts.join(' · ')}
function ssThemeSettingsPanel(t){
  const looks=Object.keys(t.variants||{}).filter(v=>v!=='dark'&&v!=='light'),values=t.values||{};
  if(!looks.length&&!t.settings?.length)return '';
  const variantField=looks.length?field('外观',`<select data-ss-theme-variant="${esc(t.id)}">${opt('','默认',values.__variant||'')}${looks.map(v=>opt(v,(t.variantLabels||{})[v]||v,values.__variant||'')).join('')}</select>`):'';
  return `<details class="ss-theme-settings" data-ss-theme-settings="${esc(t.id)}" ${styleStudio.openTheme===t.id?'open':''}><summary>${icon('settings','sm')}调整这个主题</summary><div class="ss-theme-fields">${variantField}${(t.settings||[]).map(f=>ecoSettingsField(f,values[f.key])).join('')}<div class="row">${btn('恢复默认','refresh','ss-theme-reset',`data-id="${esc(t.id)}"`,'small ghost')}</div></div></details>`;
}
function ssRenderThemes(){
  const themes=ecoState.status.themes,stack=themes.stack||[],items=themes.items||[];
  const enabled=[...stack].reverse().map(id=>items.find(t=>t.id===id)).filter(Boolean),disabled=items.filter(t=>!stack.includes(t.id));
  const card=(t,index)=>`<article class="eco-package ss-theme ${t.enabled?'is-active':''} ${t.source==='link'?'is-linked':''}" data-id="${esc(t.id)}"><div class="eco-package-label"><label class="row ss-toggle"><input type="checkbox" data-ss-theme-toggle="${esc(t.id)}" ${t.enabled?'checked':''} aria-label="启用 ${esc(t.name)}"><span>${t.enabled?(index===0?'最上层':'第 '+(index+1)+' 层'):'未启用'}</span></label><small>v${esc(t.version)}${t.source==='link'?' · 本地文件夹':''}</small></div><h3>${esc(t.name)}</h3><code>${esc(t.id)}</code>${t.description?`<p>${esc(t.description)}</p>`:''}<p class="soft small">${ssThemeBadges(t)}</p>${t.source==='link'?`<p class="soft small"><code class="eco-path">${esc(t.path||'')}</code></p>`:''}${t.enabled?ssThemeSettingsPanel(t):''}<div class="eco-package-actions">${t.enabled?ibtn('up','ss-theme-move','上移一层',`data-id="${esc(t.id)}" data-dir="up" ${index===0?'disabled':''}`)+ibtn('down','ss-theme-move','下移一层',`data-id="${esc(t.id)}" data-dir="down" ${index===enabled.length-1?'disabled':''}`):btn('启用','check','ss-theme-enable',`data-id="${esc(t.id)}"`,'small')}${t.enabled&&stack.length>1?btn('只用这个','star','ss-theme-solo',`data-id="${esc(t.id)}"`,'small ghost'):''}${btn('重新加载','refresh','ss-theme-reload',`data-id="${esc(t.id)}"`,'small ghost')}${btn(t.source==='link'?'取消链接':'卸载','trash','ss-theme-remove',`data-id="${esc(t.id)}"`,'small ghost')}</div></article>`;
  return `<div class="eco-management-actions">${btn('导入主题包','upload','eco-theme-import','','primary')}${btn('链接本地文件夹','folder','eco-theme-link','','ghost')}${btn('把我的样式导出为主题包','download','ss-export','','ghost')}${stack.length?btn('关闭全部主题','refresh','ss-theme-clear','','ghost'):''}${btn('刷新','refresh','eco-refresh','','ghost')}</div><div class="eco-dropzone" data-eco-drop="theme" tabindex="0" role="button" data-act="eco-theme-import" aria-label="导入主题文件">${icon('upload')}<strong>拖放 .css 或 .zip 主题包到这里</strong><span class="soft small">一个纯 CSS 文件也是一个主题；ZIP 里放 mio.theme.json 可以声明深浅色、外观、设置项、图标和脚本。</span></div>${enabled.length?`<h3 class="ss-section-title">正在叠加（上层覆盖下层）</h3><div class="eco-package-grid ss-stack">${enabled.map(card).join('')}</div>`:''}<h3 class="ss-section-title">${enabled.length?'未启用':'已安装的主题'}</h3><div class="eco-package-grid">${disabled.map(t=>card(t,-1)).join('')}${!items.length?'<div class="eco-empty"><h3>还没有主题包</h3><p>试试链接 examples/themes/paper-atelier：它演示了深浅色令牌、自定义外观、可调设置项、图标包与主题脚本。</p></div>':''}${!enabled.length&&items.length?'<p class="soft small">官方外观正在使用。勾选任意主题即可叠加。</p>':''}</div>`;
}
function ssRenderSnippets(){
  const d=styleStudio.draft,list=styleStudio.snippets;
  const editor=d?`<div class="ss-editor-head"><input id="ss-name" class="ss-name" type="text" value="${esc(d.name)}" placeholder="给这段样式起个名字" aria-label="样式名称"><div class="row ss-editor-tools"><select data-ss-recipe aria-label="插入模板"><option value="">插入模板…</option>${SS_RECIPES.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>${btn('拾取元素','search','ss-pick','','small ghost')}${btn('撤销更改','refresh','ss-snippet-revert',d.dirty?'':'disabled','small ghost')}${d.isNew?'':btn('删除','trash','ss-snippet-delete','','small ghost')}${btn('保存','check','ss-snippet-save','','small primary')}</div></div><textarea id="ss-css" class="eco-code ss-css" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder=".nav-item { border-radius: 12px; }" aria-label="CSS 代码">${esc(d.css)}</textarea><p class="soft small" id="ss-status">${d.dirty?'实时预览中 · 尚未保存（⌘/Ctrl+S）':'已保存 · 实时生效'}</p>`:`<div class="ss-editor-empty">${icon('edit')}<h3>写一段 CSS，立刻看到效果</h3><p>左侧新建一段样式，或点击“拾取元素”直接从界面上选一个目标。任何合法的 CSS 都可以用：变量、@font-face、@import、@media、动画……不做过滤。</p><div class="row">${btn('新建样式','plus','ss-snippet-new','','primary')}${btn('拾取元素','search','ss-pick','','ghost')}</div></div>`;
  return `<div class="ss-split"><aside class="ss-list"><div class="row between"><strong>快速样式 ${list.length?'· '+list.length:''}</strong>${ibtn('plus','ss-snippet-new','新建样式')}</div>${list.map((s,i)=>`<div class="ss-item ${d&&d.id===s.id?'active':''} ${s.enabled===false?'is-off':''}" data-id="${esc(s.id)}"><input type="checkbox" data-ss-enable="${esc(s.id)}" ${s.enabled===false?'':'checked'} aria-label="启用 ${esc(s.name)}" title="启用 / 停用"><button type="button" class="ss-item-name" data-act="ss-snippet-select" data-id="${esc(s.id)}"><span>${esc(s.name)}</span><small>${(s.css||'').length} 字符</small></button><span class="ss-item-tools">${ibtn('up','ss-snippet-move','上移',`data-id="${esc(s.id)}" data-dir="up" ${i===0?'disabled':''}`)}${ibtn('down','ss-snippet-move','下移',`data-id="${esc(s.id)}" data-dir="down" ${i===list.length-1?'disabled':''}`)}</span></div>`).join('')||'<p class="soft small">还没有快速样式。</p>'}<p class="soft small">顺序即优先级：下面的覆盖上面的。停用的样式不参与渲染但会保留。</p></aside><div class="ss-editor">${editor}</div></div>`;
}
function ssRenderTokens(){
  const mode=styleStudio.tokenMode,query=styleStudio.tokenQuery.trim().toLowerCase(),rows=ssDiscoverTokens().filter(r=>!query||r.name.includes(query)),over=styleStudio.tokens[mode]||{};
  const count=['shared','dark','light'].reduce((n,m)=>n+Object.keys(styleStudio.tokens[m]||{}).length,0);
  const row=r=>{const value=over[r.name]??'',computed=ssComputed(r.name)||r.values[mode]||r.values.shared||'',hex=ssToHex(value||computed);return `<div class="ss-token ${value?'is-set':''}" data-name="${esc(r.name)}"><code title="${esc([...r.modes].join(' / '))}">${esc(r.name)}</code><span class="ss-swatch" style="background:${hex?esc(hex):'transparent'}" aria-hidden="true"></span>${hex?`<input type="color" value="${esc(hex)}" data-ss-token-color="${esc(r.name)}" aria-label="${esc(r.name)} 取色">`:'<span class="ss-swatch-gap"></span>'}<input type="text" data-ss-token="${esc(r.name)}" value="${esc(value)}" placeholder="${esc(computed)}" aria-label="${esc(r.name)} 的值">${value?ibtn('close','ss-token-reset','恢复默认',`data-name="${esc(r.name)}"`):'<span class="ss-swatch-gap"></span>'}</div>`};
  return `<div class="ss-token-bar"><div class="quiet-tabs ss-mode-tabs">${[['shared','通用（两种模式）'],['light','仅浅色'],['dark','仅深色']].map(([id,label])=>`<button type="button" class="${mode===id?'active':''}" data-act="ss-token-mode" data-mode="${id}">${label}</button>`).join('')}</div>${searchInput({id:'ss-token-search',value:styleStudio.tokenQuery,placeholder:'搜索变量，例如 accent / bg / reader',label:'搜索设计令牌'})}<span class="soft small" id="ss-token-status">${count?'已覆盖 '+count+' 项':'自动保存'}</span>${count?btn('全部恢复','refresh','ss-token-reset-all','','small ghost'):''}</div><p class="soft small">这些是当前样式表里发现的 CSS 变量（官方 + 主题包）。留空表示不覆盖；输入任何合法的值：颜色、字体列表、尺寸、甚至 <code>color-mix()</code>。当前预览模式：${document.documentElement.dataset.theme==='light'?'浅色':'深色'}（顶栏 ☀ 可切换）。</p><div class="ss-token-grid">${rows.map(row).join('')||'<p class="soft">没有匹配的变量。</p>'}</div>`;
}
function ssRenderAssets(){
  const kb=n=>n>=1048576?(n/1048576).toFixed(1)+' MiB':n>=1024?Math.round(n/1024)+' KiB':n+' B';
  return `<div class="eco-management-actions">${btn('上传文件','upload','ss-asset-upload','','primary')}<span class="soft small">字体（woff2 / ttf / otf）、图片、SVG、视频……单个最大 64 MiB。上传后用 <code>/style-assets/文件名</code> 引用。</span></div><div class="ss-assets">${styleStudio.assets.map(a=>`<div class="ss-asset"><div class="ss-asset-preview">${/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(a.name)?`<img src="${esc(a.url)}" alt="">`:icon(/\.(woff2?|ttf|otf)$/i.test(a.name)?'edit':'folder')}</div><div class="grow"><strong>${esc(a.name)}</strong><br><code>${esc(a.url)}</code> <small class="soft">${kb(a.size)}</small></div><div class="row">${btn('复制地址','copy','ss-asset-copy',`data-url="${esc(a.url)}"`,'small ghost')}${/\.(woff2?|ttf|otf)$/i.test(a.name)?btn('用作字体','plus','ss-asset-font',`data-name="${esc(a.name)}"`,'small ghost'):''}${/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(a.name)?btn('用作背景','plus','ss-asset-background',`data-name="${esc(a.name)}"`,'small ghost'):''}${btn('删除','trash','ss-asset-delete',`data-name="${esc(a.name)}"`,'small ghost')}</div></div>`).join('')||'<div class="eco-empty"><h3>还没有资源</h3><p>上传一个字体文件，然后点“用作字体”，工坊会为你写好 @font-face 片段。</p></div>'}</div>`;
}
function ssRenderHelp(){
  return `<div class="ss-help"><section class="settings-section"><h3>三分钟上手</h3><ol><li><strong>快速样式</strong>：新建 → 点“拾取元素” → 在界面上点你想改的东西 → 写几行 CSS → ⌘/Ctrl+S。写的时候界面就在变。</li><li><strong>设计令牌</strong>：想整体换色、换字体，改 <code>--accent</code>、<code>--sans</code> 这类变量比写选择器省事。</li><li><strong>主题包</strong>：把喜欢的样式导出成主题包分享；别人的主题拖进来即用，多个主题可以叠加，勾选顺序决定谁覆盖谁。</li><li><strong>做主题的人</strong>：把文件夹“链接”进来，改一下文件浏览器就热重载，不用反复打包。</li></ol></section><section class="settings-section"><h3>常用选择器</h3><div class="ss-cheatsheet">${[['.sidebar','左侧栏'],['.topbar','顶栏'],['.statusbar','底部状态栏'],['.main','主内容区'],['.nav-item','侧栏导航按钮'],['.btn.primary','主要按钮'],['.panel / .settings-section','卡片、设置分组'],['.quiet-scene','分镜卡'],['#reader / .room-stage','阅读室'],['dialog','所有弹窗'],['[data-theme=light] …','只在浅色模式生效'],['[data-theme-variant~=sepia] …','某个主题外观生效时']].map(([s,l])=>`<p><code>${esc(s)}</code><span>${esc(l)}</span></p>`).join('')}</div></section><section class="settings-section"><h3>层叠顺序</h3><p>官方样式 → 主题包（按叠加顺序） → 主题的设置项 → 扩展注入的样式 → 你的设计令牌 → 你的快速样式。越靠后优先级越高，所以快速样式永远能赢；实在赢不了再加 <code>!important</code>。</p><p><a href="/docs/STYLE_STUDIO.html" target="_blank" rel="noopener">完整说明：样式工坊与主题包格式 ↗</a> · <a href="/docs/ECOSYSTEM_GUIDE.html" target="_blank" rel="noopener">扩展 SDK v3 指南 ↗</a></p></section><section class="settings-section"><h3>出了问题？</h3><p>访问 <code>?safe_mode=1</code> 会跳过所有主题、用户样式与扩展；那里有“一键重置”按钮。</p><div class="row">${btn('停用全部快速样式','pause','ss-disable-all','','small ghost')}${btn('清空全部令牌覆盖','trash','ss-token-reset-all','','small ghost')}</div></section></div>`;
}
/* ------------------------------------------------------------- actions */
async function ssThemeStack(op,body){await ecoRequest(op,body);await refreshEcosystem();render()}
function ssThemeRecord(id){return (ecoState.status.themes.items||[]).find(t=>t.id===id)}
function ssReadThemeForm(container,theme){
  const values={};for(const f of theme.settings||[]){const el=container.querySelector(`[data-eco-setting="${CSS.escape(f.key)}"]`);if(!el)continue;values[f.key]=f.type==='toggle'?el.checked:f.type==='number'||f.type==='range'?Number(el.value):f.type==='json'?(()=>{try{return JSON.parse(el.value||'null')}catch{return el.value}})():el.value}
  const variant=container.querySelector('[data-ss-theme-variant]');if(variant)values.__variant=variant.value;return values;
}
function ssLiveThemeSettings(container){
  const id=container.dataset.ssThemeSettings,theme=ssThemeRecord(id);if(!theme)return;const values=ssReadThemeForm(container,theme);theme.values=values;
  const compiled=ecoState.themeCompiled?.stack?.find(t=>t.id===id);if(compiled)compiled.values=values;
  ecoApplyThemeSettings(ecoState.themeCompiled?.stack||[]);
  clearTimeout(styleStudio.themeTimer);styleStudio.themeTimer=setTimeout(()=>ecoRequest('themes/settings',{id,values}).catch(e=>toast(e.message,'error')),400);
}
function installStyleStudio(){
  Object.assign(v3Actions,{
    'ss-tab':d=>{styleStudio.tab=d.tab;if(d.tab==='themes')styleStudio.openTheme='';if(d.tab==='assets')ssLoad(true).then(render);render()},
    'ss-theme-enable':d=>ssThemeStack('themes/enable',{id:d.id,enabled:true}),
    'ss-theme-solo':d=>ssThemeStack('themes/select',{id:d.id}),
    'ss-theme-clear':()=>ssThemeStack('themes/select',{id:''}),
    'ss-theme-move':async d=>{const stack=[...(ecoState.status.themes.stack||[])],i=stack.indexOf(d.id);if(i<0)return;const j=d.dir==='up'?i+1:i-1;if(j<0||j>=stack.length)return;[stack[i],stack[j]]=[stack[j],stack[i]];await ssThemeStack('themes/order',{ids:stack})},
    'ss-theme-reload':async d=>{await ecoRequest('themes/reload',{id:d.id});await refreshEcosystem();render();toast('主题已重新加载。')},
    'ss-theme-remove':async d=>{const t=ssThemeRecord(d.id);if(await confirmAction(t?.source==='link'?'取消链接主题？':'卸载主题？',t?.source==='link'?'链接将移除，你的文件夹原样保留。':'主题样式、图标包和随包资源将删除，作品不受影响。',t?.source==='link'?'取消链接':'卸载')){await ecoRequest('themes/uninstall',{id:d.id});await refreshEcosystem();render()}},
    'ss-theme-reset':async d=>{await ecoRequest('themes/settings',{id:d.id,values:{}});styleStudio.openTheme=d.id;await refreshEcosystem();render()},
    'ss-export':()=>textModal('导出为主题包','主题名称','我的工作室样式',async name=>{const response=await ecoRequest('styles/export',{name});const disposition=response.headers.get('Content-Disposition')||'',match=/filename\*=UTF-8''([^;]+)/.exec(disposition);download(match?decodeURIComponent(match[1]):'theme.mio-theme.zip',await response.blob(),'application/zip');closeModal();toast('主题包已导出，可以分享或再导入。')},'快速样式、令牌覆盖与资源会打包成 mio.theme.json + theme.css，任何一台 Mio 都能安装。'),
    'ss-snippet-new':()=>{styleStudio.draft={id:uid('css'),name:'新样式 '+(styleStudio.snippets.length+1),css:'',dirty:false,isNew:true};styleStudio.tab='snippets';render();$('#ss-css')?.focus()},
    'ss-snippet-select':d=>{const s=styleStudio.snippets.find(x=>x.id===d.id);if(!s)return;if(styleStudio.draft?.dirty&&styleStudio.draft.id!==d.id&&!confirm('当前样式有未保存的修改，放弃吗？'))return;styleStudio.draft={id:s.id,name:s.name,css:s.css,dirty:false,isNew:false};styleStudio.previewing=false;applyEcosystemTheme();render()},
    'ss-snippet-save':()=>ssSaveDraft(),
    'ss-snippet-revert':async()=>{const d=styleStudio.draft;if(!d)return;const s=styleStudio.snippets.find(x=>x.id===d.id);styleStudio.draft=s?{id:s.id,name:s.name,css:s.css,dirty:false,isNew:false}:null;styleStudio.previewing=false;await applyEcosystemTheme();render()},
    'ss-snippet-delete':async()=>{const d=styleStudio.draft;if(!d||d.isNew)return;if(!await confirmAction('删除这段样式？','“'+d.name+'”将被移除，不可恢复。','删除'))return;styleStudio.snippets=await ecoRequest('styles/snippet/delete',{id:d.id});styleStudio.draft=null;styleStudio.previewing=false;await applyEcosystemTheme();render()},
    'ss-snippet-move':async d=>{const list=styleStudio.snippets,i=list.findIndex(s=>s.id===d.id),j=d.dir==='up'?i-1:i+1;if(i<0||j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];await ssPersistSnippets();if(!styleStudio.previewing)await applyEcosystemTheme();else ssApplyPreview();render()},
    'ss-pick':()=>ssStartPick(),
    'ss-token-mode':d=>{styleStudio.tokenMode=d.mode;render()},
    'ss-token-reset':d=>{delete (styleStudio.tokens[styleStudio.tokenMode]||{})[d.name];ssApplyPreview();ssScheduleTokenSave();render()},
    'ss-token-reset-all':async()=>{if(!await confirmAction('清空全部令牌覆盖？','三种模式下的所有变量覆盖都会移除，主题包与快速样式不受影响。','清空'))return;styleStudio.tokens={shared:{},dark:{},light:{}};ssApplyPreview();ssScheduleTokenSave();render()},
    'ss-disable-all':async()=>{styleStudio.snippets.forEach(s=>{s.enabled=false});await ssPersistSnippets();styleStudio.previewing=false;await applyEcosystemTheme();render();toast('已停用全部快速样式（未删除）。')},
    'ss-asset-upload':()=>pickFile('*/*',async files=>{for(const file of files){if(file.size>64*1024*1024)throw Error('单个资源最大 64 MiB：'+file.name);const data=(await blobData(file)).split(',')[1];await ecoRequest('styles/assets/upload',{name:file.name,data})}styleStudio.assets=await ecoRequest('styles').then(s=>s.assets);styleStudio.tab='assets';render();toast('已上传 '+files.length+' 个文件。')},true),
    'ss-asset-copy':d=>{navigator.clipboard?.writeText(d.url).then(()=>toast('已复制：'+d.url)).catch(()=>toast(d.url))},
    'ss-asset-delete':async d=>{if(!await confirmAction('删除资源？','引用了它的样式会失效。','删除'))return;styleStudio.assets=await ecoRequest('styles/assets/delete',{name:d.name});render()},
    'ss-asset-font':d=>{const family=d.name.replace(/\.[^.]+$/,'').replace(/[^\w\u4e00-\u9fff -]+/g,' ').trim()||'MyFont';const format=/\.woff2$/i.test(d.name)?'woff2':/\.woff$/i.test(d.name)?'woff':/\.otf$/i.test(d.name)?'opentype':'truetype';styleStudio.draft={id:uid('css'),name:'字体 · '+family,css:`@font-face{font-family:"${family}";src:url(/style-assets/${encodeURIComponent(d.name)}) format("${format}");font-display:swap}\n:root,:root[data-theme]{--sans:"${family}","PingFang SC","Microsoft YaHei",sans-serif}\n/* 只想用于标题？改成 .brand-name,h1,h2{font-family:"${family}"} */`,dirty:true,isNew:true};styleStudio.tab='snippets';ssApplyPreview();render()},
    'ss-asset-background':d=>{styleStudio.draft={id:uid('css'),name:'背景 · '+d.name,css:`body{background:var(--bg) url(/style-assets/${encodeURIComponent(d.name)}) center/cover fixed no-repeat}\n.main{background:color-mix(in srgb,var(--bg) 78%,transparent)}\n.sidebar,.topbar{background:color-mix(in srgb,var(--side) 82%,transparent);backdrop-filter:blur(10px)}`,dirty:true,isNew:true};styleStudio.tab='snippets';ssApplyPreview();render()}
  });
  document.addEventListener('input',e=>{
    const t=e.target;if(!(t instanceof Element))return;
    if(t.id==='ss-css'&&styleStudio.draft){styleStudio.draft.css=t.value;styleStudio.draft.dirty=true;ssSchedulePreview();return}
    if(t.id==='ss-name'&&styleStudio.draft){styleStudio.draft.name=t.value;styleStudio.draft.dirty=true;const status=$('#ss-status');if(status)status.textContent='实时预览中 · 尚未保存（⌘/Ctrl+S）';return}
    if(t.id==='ss-token-search'){styleStudio.tokenQuery=t.value;clearTimeout(styleStudio.searchTimer);styleStudio.searchTimer=setTimeout(render,120);return}
    if(t.dataset.ssTokenColor){const text=t.parentElement.querySelector(`[data-ss-token="${CSS.escape(t.dataset.ssTokenColor)}"]`);if(text){text.value=t.value;text.dispatchEvent(new Event('input',{bubbles:true}))}return}
    if(t.dataset.ssToken){const mode=styleStudio.tokenMode,map=styleStudio.tokens[mode]=styleStudio.tokens[mode]||{};const value=t.value.trim();if(value)map[t.dataset.ssToken]=value;else delete map[t.dataset.ssToken];const row=t.closest('.ss-token');if(row){row.classList.toggle('is-set',!!value);const swatch=row.querySelector('.ss-swatch'),hex=ssToHex(value||t.placeholder);if(swatch)swatch.style.background=hex||'transparent'}const status=$('#ss-token-status');if(status)status.textContent='正在保存…';ssApplyPreview();ssScheduleTokenSave();return}
    const settings=t.closest('[data-ss-theme-settings]');if(settings){ssLiveThemeSettings(settings);return}
  });
  document.addEventListener('change',async e=>{
    const t=e.target;if(!(t instanceof Element))return;
    if(t.dataset.ssThemeToggle){const id=t.dataset.ssThemeToggle;try{await ssThemeStack('themes/enable',{id,enabled:t.checked})}catch(err){toast(err.message,'error');render()}return}
    if(t.dataset.ssEnable){const s=styleStudio.snippets.find(x=>x.id===t.dataset.ssEnable);if(!s)return;s.enabled=t.checked;try{await ssPersistSnippets();if(styleStudio.previewing)ssApplyPreview();else await applyEcosystemTheme()}catch(err){toast(err.message,'error')}render();return}
    if(t.matches('[data-ss-recipe]')){const recipe=SS_RECIPES.find(r=>r.id===t.value);t.value='';if(!recipe||!styleStudio.draft)return;const area=$('#ss-css');const block=(styleStudio.draft.css.trim()?'\n\n':'')+'/* '+recipe.name+' */\n'+recipe.css+'\n';if(area){area.setRangeText(block,area.value.length,area.value.length,'end');styleStudio.draft.css=area.value;area.focus()}else styleStudio.draft.css+=block;styleStudio.draft.dirty=true;ssApplyPreview();const status=$('#ss-status');if(status)status.textContent='实时预览中 · 尚未保存（⌘/Ctrl+S）';return}
    const settings=t.closest('[data-ss-theme-settings]');if(settings&&(t.matches('select,input[type="checkbox"]')))ssLiveThemeSettings(settings);
  });
  window.addEventListener('keydown',e=>{
    if(e.target?.id==='ss-css'){
      if(e.key==='Tab'){e.preventDefault();const area=e.target,start=area.selectionStart;area.setRangeText('  ',start,area.selectionEnd,'end');area.dispatchEvent(new Event('input',{bubbles:true}))}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopPropagation();ssSaveDraft().catch(err=>toast(err.message,'error'))}
      return;
    }
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&styleStudio.draft?.dirty&&ui.workspace===5&&studioUI.settingsTab==='themes'&&styleStudio.tab==='snippets'){e.preventDefault();e.stopPropagation();ssSaveDraft().catch(err=>toast(err.message,'error'))}
  },true);
  document.addEventListener('toggle',e=>{const details=e.target;if(details?.dataset?.ssThemeSettings)styleStudio.openTheme=details.open?details.dataset.ssThemeSettings:''},true);
  MioPlatform.on('styles.changed',(payload,meta)=>{if(meta.source==='backend'&&styleStudio.loaded)ssLoad(true)},{owner:'core'});
}
