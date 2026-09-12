/* Mio export: feature-owned UI functions. Loaded before ui.js; initialization remains in app.js. */
'use strict';

function exportModal(ids){ui.exportIds=ids.filter(id=>bookBy(id));if(!ui.exportIds.length)throw Error('请选择至少一本画册。');modal('导出你的故事',`<p class="soft small" style="margin:0 0 20px">${ui.exportIds.length===1?esc(bookBy(ids[0]).title):ui.exportIds.length+' 本画册合集'} · 独立 HTML，断网也能阅读</p><div class="export-options">${[['webtoon','list','Webtoon 长卷','流式纵向阅读，适合移动端'],['manga','compare','Manga 双页','经典对开排版，可直接打印'],['artbook','image','Artbook 艺术册','留白展台、色卡与创作者签名'],['flip','book','3D 交互翻页','带纸张光影的独立翻页画册']].map(([v,ic,l,h])=>`<button class="export-option ${v===ui.exportFormat?'active':''}" data-act="export-format" data-format="${v}">${icon(ic)}<span><strong>${l}</strong><small>${h}</small></span></button>`).join('')}</div><div class="divider"></div><div class="grid2">${field('画册主题色','<input id="export-color" type="color" value="#43634b">')}${field('分镜框线 / px','<input id="export-border" type="number" min="0" max="8" value="0">')}${field('创作者签名',input('signature',state.settings.signature,'text','id="export-signature"'))}</div><label class="row small soft"><input type="checkbox" id="export-prompts">附带提示词水印</label><div class="help">分镜严格按 stepIndex 升序编译。所有图片和脚本均内联。在线示例参考图若受跨域限制，将使用对应的内置矢量画面，并在画册中注明。</div><div class="modal-footer"><span class="grow tiny muted" id="export-status">OFFLINE · SELF-CONTAINED</span>${btn('生成并下载画册','download','compile-export','','primary')}</div>`,'每一帧都将被妥善保存',true)}

async function compileExport(){const theme=$('#export-color').value,watermark=$('#export-prompts').checked,border=clamp(Number($('#export-border').value),0,8),signature=$('#export-signature').value,format=ui.exportFormat,books=ui.exportIds.map(bookBy),sections=[];let fallbackCount=0,done=0;const total=books.reduce((n,b)=>n+b.totalSteps,0);const button=$('[data-act="compile-export"]');button.disabled=true;try{for(const b of books){const pages=[];for(const s of slots(b).sort((a,b)=>a.stepIndex-b.stepIndex)){let data,notice='';try{data=await imageData(s.image)}catch(e){if(!s.offlineImage)throw Error('分镜 '+(s.stepIndex+1)+' 无法内联，请先上传本地图片。');data=s.offlineImage;fallbackCount++;notice='内置矢量版本 · 在线参考图不可离线读取'}if(!data.startsWith('data:'))throw Error('图片未能内联。');let colors='';if(format==='artbook'){try{const jpg=await rasterJPEG(data,64),im=new Image();im.src=jpg;await im.decode();const cv=document.createElement('canvas');cv.width=cv.height=32;const cx=cv.getContext('2d');cx.drawImage(im,0,0,32,32);colors=Array.from({length:5},(_,i)=>{const p=cx.getImageData(4+i*5,12+i*2,1,1).data;return`<i style="background:rgb(${p[0]},${p[1]},${p[2]})"></i>`}).join('')}catch(e){}}pages.push(`<article class="sheet"><img src="${esc(data)}" alt="${esc(s.name)}"><div class="caption"><small>${pad(s.stepIndex+1)} / ${esc(s.name)}</small><p>${esc(s.caption)}</p>${watermark?`<pre>${esc(s.prompt)}</pre>`:''}${notice?`<small>${notice}</small>`:''}${format==='artbook'?`<div class="palette">${colors}</div><div class="signature">${esc(signature)}</div>`:''}</div></article>`);done++;if($('#export-status'))$('#export-status').textContent='正在内联图片 '+done+' / '+total}if((format==='manga'||format==='flip')&&pages.length%2)pages.push('<article class="sheet blank"><span>THIS STORY CONTINUES</span></article>');const cover=`<header><small>MIO / ${esc(format.toUpperCase())}</small><h1>${esc(b.title)}</h1><p>${esc(b.synopsis)}</p><span>${esc(b.characterName)} · ${b.totalSteps} 幕</span></header>`;sections.push(`<section class="collection ${format==='flip'?'flipbook':''}">${cover}<div class="sheets">${pages.join('')}</div>${format==='flip'?'<nav><button class="prev">上一跨页</button><span class="counter"></span><button class="next">下一跨页</button></nav>':''}</section>`)}const html=`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(books.length===1?books[0].title:'Mio 画册合集')}</title><style>*{box-sizing:border-box}body{margin:0;background:${format==='artbook'?'#f0eee7':'#101614'};color:${format==='artbook'?'#273229':'#e4e9df'};font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{text-align:center;padding:64px 24px 45px}header small{font-size:9px;letter-spacing:3px;color:${theme}}h1{font:38px Georgia,serif;letter-spacing:2px}header p{opacity:.6;line-height:1.9}header>span{font-size:10px;opacity:.5}.sheets{max-width:${format==='webtoon'?'720px':'1140px'};margin:auto;${format==='manga'||format==='flip'?'display:grid;grid-template-columns:1fr 1fr;gap:4px;':''}${format==='flip'?'perspective:1800px;':''}}.sheet{margin:0;min-width:0;${format==='artbook'?'padding:70px 120px;background:#f8f7f2;margin-bottom:30px;':''}border:${border}px solid ${theme};break-inside:avoid}.sheet img{display:block;width:100%;height:auto;${format==='flip'?'height:60vh;object-fit:contain;background:#eee9dc;':''}}.caption{padding:22px 28px;background:${format==='artbook'?'#f8f7f2':'#ece9de'};color:#333e33;line-height:1.9}.caption small{font-size:10px;color:${theme};letter-spacing:1px}.caption p{margin:9px 0}.caption pre{font-size:9px;white-space:pre-wrap;opacity:.5}.blank{min-height:65vh;background:#ece9de;color:#a6a294;display:grid;place-items:center;font:11px Georgia;letter-spacing:3px}.palette{display:flex;gap:5px;margin-top:22px}.palette i{width:22px;height:22px;display:block}.signature{font:italic 24px Georgia;color:${theme};text-align:right;margin-top:15px}.collection{margin-bottom:80px}nav{display:flex;justify-content:center;align-items:center;gap:24px;padding:25px}nav button{background:${theme};color:white;border:0;padding:12px 20px;border-radius:4px;cursor:pointer}.counter{font-size:11px}.turn .sheet:nth-child(even){transform-origin:left;animation:turn .65s ease-out}footer{text-align:center;font-size:10px;padding:35px;opacity:.5}[hidden]{display:none!important}@keyframes turn{from{transform:rotateY(-155deg);filter:brightness(.5)}to{transform:rotateY(0);filter:brightness(1)}}@media(max-width:700px){.sheet{padding:${format==='artbook'?'24px':'0'}}h1{font-size:29px}.caption{padding:14px;font-size:11px}.sheet img{height:auto}.blank{min-height:40vh}}@media print{body{background:white;color:black}nav,footer{display:none}header{break-after:page}.sheet{break-inside:avoid}.sheet[hidden]{display:block!important}.collection{margin:0}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style></head><body>${sections.join('')}<footer>${esc(signature)} · Mio · 完全内联离线画册${fallbackCount?' · '+fallbackCount+' 张参考封面使用内置矢量版本':''}</footer>${format==='flip'?'<script>('+standaloneFlip.toString()+')();<'+ '/script>':''}</body></html>`;download((books.length===1?books[0].title:'Mio 合集')+'_'+format+'.html',html,'text/html');toast('离线画册已生成'+(fallbackCount?'，含 '+fallbackCount+' 张矢量替代封面。':'。'));closeModal()}finally{if(button.isConnected)button.disabled=false}}

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

function inspectExportHTML(raw){
  if(typeof raw!=='string'||raw.length>600000)throw Error('模板 HTML 必须为文本，且不超过 600 KB。');
  if(!/<!doctype\s+html\s*>/i.test(raw)||!/<html[\s>]/i.test(raw)||!/<head[\s>]/i.test(raw)||!/<body[\s>]/i.test(raw))throw Error('请提供包含 DOCTYPE、html、head 和 body 的完整 HTML 文档。');
  for(const loop of ['books','frames']){
    if((raw.match(new RegExp('\\{\\{#'+loop+'\\}\\}','g'))||[]).length!==1||(raw.match(new RegExp('\\{\\{/'+loop+'\\}\\}','g'))||[]).length!==1)throw Error('需要且只能有一组 {{#'+loop+'}} 与 {{/'+loop+'}} 循环。');
  }
  const bookStart=raw.indexOf('{{#books}}'),bookEnd=raw.indexOf('{{/books}}'),frameStart=raw.indexOf('{{#frames}}'),frameEnd=raw.indexOf('{{/frames}}');
  if(!(bookStart<frameStart&&frameStart<frameEnd&&frameEnd<bookEnd))throw Error('frames 分镜循环必须完整嵌套在 books 画册循环内。');
  if(!raw.slice(frameStart,frameEnd).includes('{{image}}'))throw Error('分镜循环中缺少图片占位符 {{image}}。');
  for(const match of raw.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))if(!['#books','/books','#frames','/frames'].includes(match[1])&&!exportVariableNames.has(match[1])&&!/^asset:[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(match[1]))throw Error('不支持的模板变量：{{'+match[1]+'}}');
  // Inspect in inert template content before creating a document or any preview.
  const inert=document.createElement('template');inert.innerHTML=raw;
  const probe=inert.content;
  const allowed=new Set('html head body title meta style main section article header footer div span p a h1 h2 h3 h4 h5 h6 ul ol li figure figcaption img hr br strong em b i small pre code blockquote table thead tbody tfoot tr th td caption col colgroup button nav details summary video source'.split(' '));
  for(const node of probe.querySelectorAll('*')){
    if(!allowed.has(node.localName))throw Error('安全限制：不支持 <'+node.localName+'>。自定义 HTML / CSS 可用；翻页脚本由系统提供。');
    if(node.localName==='meta'&&node.hasAttribute('http-equiv'))throw Error('请移除 http-equiv 元信息；离线安全策略由系统注入。');
    for(const attr of [...node.attributes]){
      const k=attr.name.toLowerCase(),v=attr.value.trim();
      if(k.startsWith('on')||['srcdoc','srcset','ping','formaction','action','is','nonce','autofocus'].includes(k))throw Error('安全限制：不能使用 '+k+' 属性。');
      if(k==='href'&&v&&!v.startsWith('#'))throw Error('模板链接仅允许页内锚点，不能跳转到外部网站。');
      if(['src','poster'].includes(k)&&!/^\{\{asset:[a-zA-Z][a-zA-Z0-9_-]{0,47}\}\}$/.test(v)&&!['{{image}}','{{coverImage}}'].includes(v)&&!/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(v))throw Error('图片须使用 {{image}}、{{coverImage}} 或 Base64 Data URL；不能依赖外部图片。');
    }
  }
  const styles=[...probe.querySelectorAll('style')].map(n=>n.textContent).concat([...probe.querySelectorAll('[style]')].map(n=>n.getAttribute('style'))).join('\n');
  validateOfflineCSS(styles.replace(/\{\{asset:[a-zA-Z][a-zA-Z0-9_-]{0,47}\}\}/g,'data:image/png;base64,AAAA'));
  const block=raw.slice(bookStart,bookEnd),frameBlock=raw.slice(frameStart,frameEnd);
  if(!/data-cc-book(?:\s|[=>])/.test(block)||!/data-cc-pages(?:\s|[=>])/.test(block)||!/data-cc-frame(?:\s|[=>])/.test(frameBlock))throw Error('请保留 data-cc-book、data-cc-pages 与 data-cc-frame 属性，以支持翻页、打印和奇数页兜底。');
  const doc=new DOMParser().parseFromString(raw,'text/html');
  for(const root of [doc.documentElement,doc.head,doc.body])for(const attr of [...root.attributes]){
    if(attr.name.toLowerCase().startsWith('on')||['src','background','nonce','is'].includes(attr.name.toLowerCase()))throw Error('文档根节点不能包含脚本事件或外部资源属性。');
    if(attr.name==='style')validateOfflineCSS(attr.value);
  }
  return doc;
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

function upgradeExportDesigns(s){
  if(!Array.isArray(s.exportTemplates))return;
  if(s.exportTemplates.some(t=>t.builtin&&['export-paper','export-ink','export-gallery','export-flip'].includes(t.id)&&t.designRevision!==2)){
    const replacements=designedTemplates();s.exportTemplates=s.exportTemplates.map(t=>{const replacement=replacements.find(x=>x.id===t.id);return replacement&&t.builtin&&t.designRevision!==2?{...replacement,createdAt:t.createdAt}:t});
  }
}

async function deliverExportHTML(html,t,books){
  const filename=safeFolderName(books.length===1?books[0].title:'画册合集')+'_'+safeFolderName(t.title)+'_'+Date.now()+'.html';
  if(!disk.root||disk.phase!=='connected'){download(filename,html,'text/html');return null}
  const saved=await flushDiskSave();if(!saved){download(filename,html,'text/html');toast('目录未能保存，已改为下载 HTML，避免丢失导出结果。','error');return null}
  const base=books.length===1?disk.paths.books[books[0].id]+'/导出':'导出合集',path=base+'/'+filename;
  try{await writeDiskFile(disk.root,path,html);if(books.length===1){const b=bookBy(books[0].id);b.exports||=[];b.exports.push({path,createdAt:Date.now(),templateId:t.id,format:t.layout});save()}return path}
  catch(e){download(filename,html,'text/html');toast('写入导出目录失败，已改为下载文件：'+e.message,'error');return null}
}
