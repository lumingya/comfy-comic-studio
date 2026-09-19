/* User style workbench: draft != preview != saved. No arbitrary CSS rewriting. */
'use strict';
const customization={record:null,draft:null,selected:'',preview:null,timer:null,recovery:null,dirty:false,loaded:false};
const customizationTokens=[['--accent','强调色','color'],['--bg','背景色','color'],['--panel','面板色','color'],['--text','文字色','color'],['--muted','次要文字','color'],['--line','边线色','color'],['--sans','界面字体','text'],['--nav-width','侧栏宽度','text'],['--mio-control-radius','控件圆角','text']];
function customizationDefault(){return {version:1,enabled:false,tokens:{},snippets:[]}}
function customizationDirty(){customization.dirty=true;try{localStorage.setItem('mio-style-draft',JSON.stringify(customization.draft))}catch{}const status=$('#custom-save-state');if(status)status.textContent='草稿未保存 · 不影响已保存样式'}
async function loadCustomization(){
  try{customization.record=await ecoRequest('customization');customization.loaded=true;if(!customization.dirty)customization.draft=clone(customization.record.document);applyCustomization()}catch(e){ecoState.errors.push('样式工作台：'+e.message)}
}
function applyCustomization(){
  document.querySelectorAll('[data-mio-custom-style]').forEach(el=>el.remove());
  if(window.MioSafeMode||ecoState.status.safeMode)return;
  const value=customization.preview||customization.record?.document;if(!value?.enabled)return;
  const add=(css,id)=>{const style=document.createElement('style');style.dataset.mioCustomStyle=id;style.textContent=css;document.head.append(style)};
  // CSSOM serializes token values; tokens cannot break out into another rule.
  const tokens=document.createElement('div');for(const [key,tokenValue] of Object.entries(value.tokens))tokens.style.setProperty(key,tokenValue,'important');
  add(':root:root{'+tokens.style.cssText+'}','tokens');
  for(const snippet of value.snippets)if(snippet.enabled&&(snippet.scope==='global'||snippet.scope==='workspace:'+extensionWorkspace()))add(snippet.css,snippet.id);
}
function customizationStopPreview(){clearTimeout(customization.timer);customization.timer=null;customization.preview=null;customization.recovery?.remove();customization.recovery=null;applyCustomization()}
function customizationRecovery(){
  customization.recovery?.remove();const host=document.createElement('div');host.id='mio-style-preview-recovery';host.style.cssText='position:fixed!important;bottom:20px!important;right:20px!important;z-index:2147483647!important;display:block!important';
  const root=host.attachShadow({mode:'closed'});root.innerHTML='<style>:host{all:initial}section{font:14px system-ui;padding:16px;background:#fff;color:#17261c;border:2px solid #497155;border-radius:12px;box-shadow:0 5px 30px #0004;max-width:310px}button{font:inherit;background:#254d35;color:#fff;border:0;padding:9px 14px;border-radius:6px;cursor:pointer}p{line-height:1.6}</style><section><b>样式试用 · 30 秒自动恢复</b><p>按 Esc 或点击按钮立即恢复。试用不会自动保存。</p><button>立即恢复</button></section>';
  root.querySelector('button').onclick=customizationStopPreview;(topDialog()||document.body).append(host);customization.recovery=host;
}
async function customizationValidate(){const result=await ecoRequest('customization/validate',{document:customization.draft});return result}
async function customizationPreview(){
  if(!$('#custom-trust')?.checked)throw Error('请先勾选下方的 CSS 信任说明。');
  const value=await customizationValidate();customizationStopPreview();customization.preview={...value,enabled:true};applyCustomization();customizationRecovery();customization.timer=setTimeout(customizationStopPreview,30000);
}
function customizationSnippet(){return customization.draft?.snippets.find(s=>s.id===customization.selected)}
function customizationEditorHTML(){
  const draft=customization.draft,selected=customizationSnippet(),history=customization.record?.history||[];
  return `<section class="customization-workbench" data-mio-part="style-workbench"><header class="customization-heading"><span class="context-kicker">STYLE LAB / 样式工作台</span><h2>让界面听你的。</h2><p>无需编程即可调整常用外观；需要更多时，直接写完整 CSS。草稿、试用和保存彼此独立。</p><p id="custom-save-state" role="status">${customization.dirty?'草稿未保存':'已保存版本 '+(customization.record?.revision||0)}</p></header>
  <div class="customization-actions">${btn('新建 CSS 片段','plus','custom-add','','primary')}${btn('导入 CSS / JSON','upload','custom-import')}${btn('导出草稿','download','custom-export')}${btn('恢复浏览器草稿','refresh','custom-draft','','ghost')}${btn('重新读取已保存','refresh','custom-reload','','ghost')}</div>
  <div class="customization-layout"><aside class="customization-inspector"><h3>设计变量</h3><p class="help">留空跟随当前主题。宽度可填 240px，圆角可填 12px。</p>${customizationTokens.map(([key,label,type])=>`<label class="custom-token">${label}<span>${type==='color'?`<input type="color" data-custom-color="${key}" value="${/^#[0-9a-f]{6}$/i.test(draft.tokens[key])?draft.tokens[key]:'#638b70'}" aria-label="${label}取色器">`:''}<input data-custom-token="${key}" value="${esc(draft.tokens[key]||'')}" placeholder="跟随主题" aria-label="${label}"></span></label>`).join('')}<div class="row wrap">${btn('纸页配色','','custom-preset','data-id="paper"','small')}${btn('深海配色','','custom-preset','data-id="ocean"','small')}${btn('清除变量','','custom-preset','data-id="clear"','small ghost')}</div><h3>CSS 片段 · 从上到下加载</h3><div class="custom-snippet-list">${draft.snippets.map((s,i)=>`<div class="custom-snippet ${s.id===customization.selected?'selected':''}"><input type="checkbox" data-custom-enabled="${s.id}" ${s.enabled?'checked':''} aria-label="启用 ${esc(s.name)}"><button data-act="custom-select" data-id="${s.id}">${esc(s.name)}</button><button data-act="custom-move" data-id="${s.id}" data-direction="-1" aria-label="上移 ${esc(s.name)}" ${i===0?'disabled':''}>↑</button><button data-act="custom-move" data-id="${s.id}" data-direction="1" aria-label="下移 ${esc(s.name)}" ${i===draft.snippets.length-1?'disabled':''}>↓</button></div>`).join('')||'<p class="help">点击「新建 CSS 片段」开始。</p>'}</div></aside>
  <div class="customization-code">${selected?`<div class="custom-code-meta"><label>片段名称<input id="custom-name" value="${esc(selected.name)}" maxlength="120"></label><label>启用范围<select id="custom-scope">${opt('global','所有工作区',selected.scope)}${Object.values(extensionWorkspaceNames).map(name=>opt('workspace:'+name,name,selected.scope)).join('')}${extensionRuntime().list('workspaces').map(w=>opt('workspace:'+w.key,w.title||w.id,selected.scope)).join('')}${selected.scope!=='global'&&!Object.values(extensionWorkspaceNames).includes(selected.scope.slice(10))&&!extensionRuntime().list('workspaces').some(w=>'workspace:'+w.key===selected.scope)?opt(selected.scope,selected.scope,selected.scope):''}</select></label>${btn('删除片段','trash','custom-delete','','ghost')}</div><textarea id="custom-css" class="custom-css" spellcheck="false" aria-label="CSS 源码">${esc(selected.css)}</textarea><p class="help">支持 @import、@font-face、@media、嵌套、动画与远程 URL（以当前浏览器支持为准）。范围控制整段样式何时加载，并非 CSS 隔离沙箱。</p>`:'<div class="custom-code-empty"><h3>从一个小变化开始</h3><p>在左侧调整颜色，或新增 CSS 自由改变布局、字体和动效。</p><code>[data-mio-part="sidebar"] { … }</code></div>'}
  <details><summary>稳定选择器与进阶变量</summary><pre>:root { --accent: #7bbfa0; }
[data-mio-part="sidebar"] { /* 侧栏 */ }
[data-mio-part="topbar"] { /* 顶栏 */ }
[data-mio-part="workspace"] { /* 主工作区 */ }
[data-workspace="creation"] .workshop-prompt { min-height: 280px; }
[data-mio-slot="workspace.after"] { /* 扩展插槽 */ }
[data-extension-owner="studio-toolkit"] { /* 扩展内容 */ }</pre><p>导出的 JSON 支持添加任意 --自定义变量。CSS 错误按浏览器规则忽略，不会自动纠正；可在开发者工具中检查。</p></details>
  <details><summary>历史版本（保留最近 10 次保存前的状态）</summary>${history.slice().reverse().map(h=>`<div class="custom-history"><span>版本 ${h.revision} · ${new Date(h.savedAt*1000).toLocaleString()}</span>${btn('载入为草稿','refresh','custom-history',`data-revision="${h.revision}"`,'small ghost')}</div>`).join('')||'<p>保存后会在这里留下历史记录。</p>'}</details></div></div>
  <footer class="customization-footer"><label class="row"><input id="custom-enabled" type="checkbox" ${draft.enabled?'checked':''}>启用已保存的自定义样式</label><label class="custom-trust"><input id="custom-trust" type="checkbox">我信任这些 CSS：它们可以改变或隐藏整个界面，并通过远程字体、图片或 @import 发起网络请求。</label><div class="row wrap">${btn('试用 30 秒','eye','custom-preview','','ghost')}${btn('结束试用','','custom-stop','','ghost')}${btn('保存设置','disk','custom-save','','primary')}${btn('仅停用样式','','custom-disable','','ghost')}<a class="btn ghost" href="?safe_mode=1">安全模式 ↗</a></div><p class="help">Esc 立即结束试用。预览中的效果不会自动保存。启动失败时在网址末尾添加 ?safe_mode=1。</p></footer></section>`;
}
function customizationRender(){const root=$('#customization-root');if(root){const trust=$('#custom-trust')?.checked;root.innerHTML=customizationEditorHTML();if($('#custom-trust'))$('#custom-trust').checked=!!trust}}
async function customizationOpen(){
  if(!customization.loaded)await loadCustomization();if(!customization.loaded)throw Error('样式设置未能读取，请检查服务连接。');
  customization.draft||=clone(customization.record.document);customization.selected||=customization.draft.snippets[0]?.id||'';
  modal('样式工作台','<div id="customization-root"></div>','',true);$('#modal').classList.add('customization-dialog');customizationRender();
}
function installCustomization(){
  Object.assign(v3Actions,{
    'custom-open':customizationOpen,
    'custom-add':()=>{const item={id:uid('css').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,64),name:'新样式片段',scope:'global',enabled:true,css:'/* 写下你的 CSS。先试用，再保存。 */\n[data-mio-part="workspace"] {\n  /* padding: 32px; */\n}\n'};customization.draft.snippets.push(item);customization.selected=item.id;customizationDirty();customizationRender()},
    'custom-select':d=>{customization.selected=d.id;customizationRender()},
    'custom-move':d=>{const list=customization.draft.snippets,i=list.findIndex(s=>s.id===d.id),j=i+Number(d.direction);if(i>=0&&j>=0&&j<list.length){[list[i],list[j]]=[list[j],list[i]];customizationDirty();customizationRender()}},
    'custom-delete':async()=>{if(await confirmAction('删除此 CSS 片段？','仅修改草稿；保存前可重新读取已保存设置。','删除')){customization.draft.snippets=customization.draft.snippets.filter(s=>s.id!==customization.selected);customization.selected=customization.draft.snippets[0]?.id||'';customizationDirty();customizationRender()}},
    'custom-preview':customizationPreview,'custom-stop':customizationStopPreview,
    'custom-save':async()=>{if(customization.draft.enabled&&!$('#custom-trust')?.checked)throw Error('请先确认信任 CSS。');const result=await ecoRequest('customization',{revision:customization.record.revision,document:customization.draft,trusted:$('#custom-trust')?.checked===true});customization.record=result;customization.draft=clone(result.document);customization.dirty=false;try{localStorage.removeItem('mio-style-draft')}catch{}customizationStopPreview();customizationRender();toast('样式设置已保存。')},
    'custom-disable':async()=>{const latest=await ecoRequest('customization');latest.document.enabled=false;customization.record=await ecoRequest('customization',{revision:latest.revision,document:latest.document});customization.draft.enabled=false;customizationStopPreview();customizationRender();toast('已停用自定义样式，CSS 内容仍保留。')},
    'custom-export':()=>download('my-studio.mio-style.json',JSON.stringify(customization.draft,null,2),'application/json'),
    'custom-reload':async()=>{if(customization.dirty&&!await confirmAction('放弃当前草稿？','重新读取最后保存的版本；未保存的编辑会丢失。','重新读取'))return;customizationStopPreview();customization.dirty=false;await loadCustomization();customization.selected=customization.draft.snippets[0]?.id||'';customizationRender()},
    'custom-draft':()=>{let draft;try{draft=JSON.parse(localStorage.getItem('mio-style-draft'))}catch{}if(!draft||draft.version!==1)throw Error('没有可恢复的浏览器草稿。');return ecoRequest('customization/validate',{document:draft}).then(value=>{customization.draft=value;customization.selected=value.snippets[0]?.id||'';customizationDirty();customizationRender()})},
    'custom-history':async d=>{const entry=customization.record.history.find(h=>h.revision===Number(d.revision));if(entry&&(!customization.dirty||await confirmAction('替换当前草稿？','历史版本只会载入草稿，不会立即启用。','载入'))){customization.draft=clone(entry.document);customization.selected=customization.draft.snippets[0]?.id||'';customizationDirty();customizationRender()}},
    'custom-import':()=>pickFile('.css,.json',async file=>{if(!file)return;if(file.size>128*1024)throw Error('文件最大 128 KiB');const text=await file.text();if(file.name.toLowerCase().endsWith('.css')){const draft=clone(customization.draft),item={id:'css-'+Date.now().toString(36),name:file.name.slice(0,120),css:text,scope:'global',enabled:true};draft.snippets.push(item);customization.draft=await ecoRequest('customization/validate',{document:draft});customization.selected=item.id}else{const value=await ecoRequest('customization/validate',{document:JSON.parse(text)});if(!await confirmAction('导入样式配置到草稿？','将替换当前草稿，不会自动执行 CSS。','导入'))return;customization.draft=value;customization.selected=value.snippets[0]?.id||''}customizationDirty();customizationRender()}),
    'custom-preset':d=>{customization.draft.tokens=d.id==='clear'?{}:d.id==='paper'?{'--bg':'#f3efe6','--panel':'#fffdf6','--text':'#352f28','--accent':'#7a563b','--line':'#d8cebe','--muted':'#756b5b'}:{'--bg':'#101d2c','--panel':'#192c40','--text':'#e3edf6','--accent':'#7dcfd1','--line':'#30485e','--muted':'#a1b7c9'};customizationDirty();customizationRender()}
  });
  document.addEventListener('input',e=>{
    const el=e.target;if(!el.closest('#customization-root'))return;
    if(el.dataset.customToken){if(el.value)customization.draft.tokens[el.dataset.customToken]=el.value;else delete customization.draft.tokens[el.dataset.customToken]}
    else if(el.dataset.customColor){customization.draft.tokens[el.dataset.customColor]=el.value;document.querySelector(`[data-custom-token="${el.dataset.customColor}"]`).value=el.value}
    else if(el.id==='custom-css')customizationSnippet().css=el.value;
    else if(el.id==='custom-name')customizationSnippet().name=el.value;
    else return;customizationDirty();
  });
  document.addEventListener('change',e=>{const el=e.target;if(el.dataset.customEnabled)customization.draft.snippets.find(s=>s.id===el.dataset.customEnabled).enabled=el.checked;else if(el.id==='custom-enabled')customization.draft.enabled=el.checked;else if(el.id==='custom-scope')customizationSnippet().scope=el.value;else return;customizationDirty()});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&customization.preview){e.preventDefault();e.stopImmediatePropagation();customizationStopPreview()}},true);
  document.addEventListener('keydown',e=>{if(e.target.id==='custom-css'&&e.key==='Tab'){e.preventDefault();const el=e.target;el.setRangeText('  ',el.selectionStart,el.selectionEnd,'end');el.dispatchEvent(new Event('input',{bubbles:true}))}},true);
  $('#modal').addEventListener('close',()=>{$('#modal').classList.remove('customization-dialog');customizationStopPreview()});
  window.addEventListener('beforeunload',e=>{if(customization.dirty){e.preventDefault();e.returnValue=''}});
}
