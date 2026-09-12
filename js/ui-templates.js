/* Mio templates: feature-owned UI functions. Loaded before ui.js; initialization remains in app.js. */
'use strict';

function templateSelect(id,cur){return`<select id="${id}" aria-label="选择模板">${projectTemplates().map(t=>opt(t.id,t.title,cur)).join('')}</select>`}

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

function validateExportTemplate(t){
  if(!t||t.kind!==templateKind||t.formatVersion!==1||typeof t.title!=='string'||!t.title.trim()||t.title.length>120||!exportLayouts[t.layout])throw Error('不是合法的 Mio 画册导出模板（formatVersion: 1）。');
  if(!t.options||typeof t.author!=='string'||typeof t.version!=='string')throw Error('模板缺少作者、版本或外观选项。');
  for(const k of ['accent','background','paper','text'])if(!/^#[0-9a-f]{6}$/i.test(t.options[k]))throw Error('模板颜色必须为六位十六进制色值。');
  for(const [k,min,max] of [['width',400,1800],['gap',0,100],['radius',0,40]])if(!Number.isFinite(t.options[k])||t.options[k]<min||t.options[k]>max)throw Error(k+' 应在 '+min+' 至 '+max+' 之间。');
  if(!['sans','serif'].includes(t.options.font))throw Error('字体设置不合法。');
  validatePresentationAssets(t);
  inspectExportHTML(t.html);
  return true;
}

function escapedTemplateValue(value){return esc(value).replace(/\{/g,'&#123;').replace(/\}/g,'&#125;');}

function fillExportVariables(html,values){return html.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g,(_,key)=>escapedTemplateValue(values[key]??''));}

function compiledBookRuntime(){
  const layout=document.body.dataset.layout;
  for(const book of document.querySelectorAll('[data-cc-book]')){
    const pages=book.querySelector('[data-cc-pages]');if(!pages)continue;
    let frames=[...pages.querySelectorAll('[data-cc-frame]')];const realCount=frames.length;
    if(['manga','flip'].includes(layout)&&frames.length%2){const blank=document.createElement('div');blank.className='cc-frame cc-blank';blank.setAttribute('data-cc-frame','');blank.setAttribute('aria-label','空白衬纸');blank.textContent='留白';pages.append(blank);frames.push(blank)}
    if(layout!=='flip')continue;
    const nav=document.createElement('nav');nav.className='cc-controls';nav.setAttribute('aria-label','翻页控制');const prev=document.createElement('button'),next=document.createElement('button'),counter=document.createElement('span');prev.type=next.type='button';prev.textContent='上一跨页';next.textContent='下一跨页';counter.setAttribute('aria-live','polite');nav.append(prev,counter,next);pages.after(nav);let current=0;const mobile=window.matchMedia('(max-width:640px)');let perPage=mobile.matches?1:2;
    function show(animate=true){book.querySelectorAll('.edition-cover,.edition-opening,.edition-chapter,.cc-cover').forEach(el=>el.hidden=current>0);prev.textContent=perPage===1?'上一幕':'上一跨页';next.textContent=perPage===1?'下一幕':'下一跨页';book.querySelectorAll('.edition-end').forEach(el=>el.hidden=current<Math.ceil(realCount/perPage)-1);frames.forEach((f,i)=>{f.hidden=Math.floor(i/perPage)!==current||(perPage===1&&i>=realCount);f.classList.remove('cc-turn')});counter.textContent=(current+1)+' / '+Math.ceil(realCount/perPage);prev.disabled=current===0;next.disabled=current>=Math.ceil(realCount/perPage)-1;if(animate){window.scrollTo({top:pages.getBoundingClientRect().top+window.scrollY,behavior:'instant'});const right=frames[current*perPage+perPage-1];if(right){void right.offsetWidth;right.classList.add('cc-turn')}}}
    mobile.addEventListener('change',()=>{const first=current*perPage;perPage=mobile.matches?1:2;current=Math.floor(first/perPage);show(false)});prev.onclick=()=>{current=Math.max(0,current-1);show()};next.onclick=()=>{current=Math.min(Math.ceil(realCount/perPage)-1,current+1);show()};window.addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='mio-reader-turn')(e.data.direction>0?next:prev).click()});book.tabIndex=0;book.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();next.click()}if(e.key==='ArrowLeft'){e.preventDefault();prev.click()}});show(false);
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
  doc.body.dataset.layout=t.layout;if(options.sample)doc.querySelectorAll('.edition-end').forEach(el=>el.remove());
  const nonce=uid('cc').replace(/[^a-zA-Z0-9]/g,'');
  const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-"+nonce+"'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';";
  doc.head.prepend(csp);
  const baseStyle=doc.createElement('style');baseStyle.textContent='[hidden]{display:none!important}[data-cc-prompt]:empty{display:none!important}'+(!opts.showCaptions?'[data-cc-caption]{display:none!important}':'')+'@media(max-width:640px){[data-layout=flip] .cc-pages{grid-template-columns:1fr!important}[data-layout=flip] .cc-image{height:auto!important;max-height:65svh;object-fit:contain}[data-layout=flip] .cc-caption{min-height:0!important}}@media print{.edition-cover[hidden],.edition-opening[hidden],.edition-chapter[hidden],.cc-cover[hidden],.edition-end[hidden]{display:block!important}[data-cc-frame][hidden]{display:block!important}.cc-controls{display:none!important}}';doc.head.append(baseStyle);
  const script=doc.createElement('script');script.setAttribute('nonce',nonce);script.textContent='('+compiledBookRuntime.toString()+')();';doc.body.append(script);
  return '<!DOCTYPE html>\n'+doc.documentElement.outerHTML;
}

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
  if(!/^\s*[\[{]/.test(text)){const doc=new DOMParser().parseFromString(t.html,'text/html');doc.querySelectorAll('meta[name="comfycomic-export-template"]').forEach(node=>node.remove());t.html='<!DOCTYPE html>\n'+doc.documentElement.outerHTML}t.id=uid('export');t.builtin=false;t.source='import';t.createdAt=t.updatedAt=Date.now();t.options={...exportOptionDefaults,...t.options};return t;
}

function templateListItem(t){const selected=studioUI.editor?.id===t.id;return `<button class="template-library-item ${selected?'active':''}" data-act="et-select" data-id="${esc(t.id)}"><span class="template-glyph"><i></i><i></i></span><span class="grow"><strong>${esc(t.title)}</strong><small>${t.builtin?'内置':t.source==='market'?'市场安装':'自定义'} · ${exportLayouts[t.layout]}</small></span>${state.settings.studio.export.templateId===t.id?icon('check','sm'):''}</button>`;}

function currentEditorTemplate(){if(!studioUI.editor)throw Error('请先选择画册导出模板。');return studioUI.editor;}

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

function templateSourceFields(t){return `<div class="row between" style="margin-bottom:12px"><h3 style="margin:0">完整 HTML / CSS 文档</h3>${btn('插入分镜循环','plus','et-insert-loop','','ghost small')}</div><p class="template-source-info">阅读预览与导出共用 HTML/CSS；图片通过占位符注入。媒体与可选沙盒脚本在下方管理。</p><textarea id="et-source" class="template-source" data-et-field="html" spellcheck="false" aria-label="自定义画册 HTML 源码">${esc(t.html)}</textarea><details class="source-guide"><summary>模板变量与安全规则</summary><p><code>{{#books}}...{{/books}}</code> 遍历画册。<br><code>{{#frames}}...{{/frames}}</code> 必须嵌套其中，遍历按序排列的分镜。</p><p><code>{{title}} {{synopsis}} {{characterName}}</code><br><code>{{image}} {{name}} {{caption}} {{prompt}} {{number}}</code><br><code>{{signature}} {{themeColor}} {{background}} {{paperColor}}</code><br><code>{{contentWidth}} {{panelGap}} {{imageRadius}} {{bodyFont}}</code></p><p>保留 <code>data-cc-book</code>、<code>data-cc-pages</code>、<code>data-cc-frame</code> 以启用翻页与奇数页保护。预览隔离于主应用，不允许外部资源和 HTML 事件属性。可选脚本须通过独立脚本字段启用，并仅在沙盒内运行。</p></details>`;}

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
  if(file.size>9*1024*1024)throw Error('模板包不能超过 9 MiB。');
  const t=parseExportTemplateFile(await file.text(),file.name);
  let error;try{validateExportTemplate(t)}catch(e){error=e.message}
  if(error){if(!await confirmAction('在编辑器中修复这份 HTML？',error+'\n文件尚未安装，也不会执行任何脚本。可补全占位符后保存。','打开为草稿'))return;openTemplateStudio(null,t);return}
  if(!await confirmAction('导入「'+t.title+'」？','将建立独立画册模板副本，不覆盖现有模板或作品。','导入模板'))return;
  if(state.exportTemplates.length>=100)throw Error('模板库已达上限。');state.exportTemplates.push(t);save();openTemplateStudio(t.id);toast('画册模板已导入，可以继续自定义。');
}

function marketTemplate(packageId){const c=exportMarketCatalog.find(c=>c.id===packageId);if(!c)throw Error('画册模板包不存在。');return {...makeExportTemplate(uid('export'),c.title,c.layout,c.options,c.desc,'market'),version:c.version,packageId:c.id};}

function previewMarketTemplate(id){
  const c=exportMarketCatalog.find(c=>c.id===id),t=marketTemplate(id),installed=state.installedPackages.some(p=>p.id===id);
  modal(c.title,`<p class="export-template-description">${esc(c.desc)}<br>${esc(c.author)} · v${esc(c.version)} · ${exportLayouts[c.layout]}</p><iframe id="market-template-preview" sandbox="allow-scripts" referrerpolicy="no-referrer" title="市场画册 HTML 模板预览" style="width:100%;height:470px;border:1px solid var(--line);border-radius:5px"></iframe><div class="modal-footer">${btn('返回市场','','market')}${btn('下载模板包','download','et-market-download',`data-id="${id}"`)}${btn(installed?'在模板库编辑':'安装到模板库',installed?'edit':'plus',installed?'et-open-installed':'market-install',`data-id="${id}"`,'primary')}</div>`,'预览使用本地矢量示例画面，不发送任何数据。',true);
  $('#market-template-preview').srcdoc=compileTemplateDocument(t,exportPreviewBooks(ui.exportIds?.[0]));
}

function contextualTemplate(){if($('#reader').open)return templateBy(bookBy(ui.bookId)?.templateId);if(ui.workspace===4)return templateBy(ui.storyTemplateId);return currentTemplate()}

function bindChatToTemplate(id,newBranch=false){
  const template=templateBy(id);if(!template)return null;
  const old=currentChat();if(old&&$('#chat-input'))old.draft=$('#chat-input').value;
  let chat=!newBranch?state.chats.find(c=>c.templateId===id):null;
  if(!chat){const reusable=!newBranch?state.chats.find(c=>!c.templateId&&!c.messages.some(m=>m.role==='user')):null;chat=reusable||{id:uid('chat'),messages:[]};if(!reusable)state.chats.push(chat);chat.templateId=id;chat.projectId=template.projectId;const count=state.chats.filter(c=>c.templateId===id).length;chat.title=template.title.slice(0,22)+' · 对话 '+count;chat.draft=''}
  state.activeChatId=chat.id;studioUI.assistantDraft=chat.draft||'';if($('#chat-input'))$('#chat-input').value=studioUI.assistantDraft;save();return chat;
}

function designedTemplates(){return[
  {...makeExportTemplate('export-paper','海风来信 · 电影长卷','webtoon',{accent:'#55756e',background:'#eae7df',paper:'#fffcf4',text:'#293e38',width:860,gap:32,radius:0},'整幅封面、开篇题记与温柔的纸张留白，让每个画面像一封长信。'),html:designedExportHTML('paper'),version:'2.0.0',designRevision:2},
  {...makeExportTemplate('export-ink','墨与叙事 · 漫画精装','manga',{accent:'#9b453c',background:'#e4e2d9',paper:'#fffdf6',text:'#262624',width:1200,gap:8,radius:0,font:'sans'},'复古漫画刊物封面、朱红卷号与经典对开排版，完整保留分镜节奏。'),html:designedExportHTML('ink'),version:'2.0.0',designRevision:2},
  {...makeExportTemplate('export-gallery','白昼美术馆 · 典藏展册','artbook',{accent:'#786b4e',background:'#eae7de',paper:'#fcfaf4',text:'#3a3931',width:1100,gap:30,radius:0},'美术馆式标题页、交错展台、作品说明与色卡，为每一幅画留出呼吸。'),html:designedExportHTML('gallery'),version:'2.0.0',designRevision:2},
  {...makeExportTemplate('export-flip','深夜放映室 · 交互画册','flip',{accent:'#c9b98d',background:'#10191f',paper:'#ece7d9',text:'#333b38',width:1220,gap:3,radius:0,font:'serif'},'电影海报封面、演职署名、暖纸双页与纸张翻动，像一场私人放映。'),html:designedExportHTML('night'),version:'2.0.0',designRevision:2}
]}

function templateValidationHub(){
  const results=state.exportTemplates.map(t=>{try{validateExportTemplate(t);compileTemplateDocument(t,exportPreviewBooks());return {t,ok:true,message:'结构、CSS 与示例编译通过'}}catch(e){return {t,ok:false,message:e.message}}});
  modal('模板检查与修复',`<div class="notice">已修复对 scroll-behavior 的误拦截。注释、字符串里的 @import / url 文本不再被当作实际资源指令；真正的外部依赖仍会明确指出位置。</div><div class="template-check-list">${results.map(({t,ok,message})=>`<div class="template-check-row"><span class="${ok?'accent':'danger'}">${icon(ok?'check':'help')}</span><div class="grow">${esc(t.title)}<small>${esc(message)}</small></div>${btn('编辑','edit','template-fix-open',`data-id="${t.id}"`,'small')}</div>`).join('')}</div><div class="modal-footer">${btn('恢复内置模板原版','refresh','template-reset-builtins')}${btn('关闭','','close-modal','','primary')}</div>`,'检查不会改动任何自定义模板。',true);
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
