/* Mio presentation: feature-owned UI functions. Loaded before ui.js; initialization remains in app.js. */
'use strict';

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

function fitPresentationTemplate(){
  const t=makeExportTemplate('mio-fit','留白 · 完整画面','webtoon',{background:'#101719',paper:'#101719',text:'#dce5df',accent:'#a9c4ac',width:1200},'保持原始比例，完整显示每张图片。无背景媒体，无自定义脚本。');
  t.html='<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{title}}</title><style>*{box-sizing:border-box}body{margin:0;background:{{background}};color:{{textColor}};font:14px/1.8 system-ui}header,footer{text-align:center;padding:22px}header h1{font-size:20px;font-weight:400}figure{margin:0 auto 24px;max-width:{{contentWidth}}px;padding:12px;break-inside:avoid}img{display:block;width:100%;height:calc(100svh - 110px);object-fit:contain;border-radius:{{imageRadius}}px;border:{{frameBorder}}px solid {{themeColor}}}figcaption{text-align:center;font-size:12px;opacity:.75;padding:12px}pre{white-space:pre-wrap}footer{font-size:11px;opacity:.6}@media print{img{height:auto;max-height:90vh}figure{break-after:page}}</style></head><body>{{#books}}<article data-cc-book><header><h1>{{title}}</h1></header><main data-cc-pages>{{#frames}}<figure data-cc-frame><img src="{{image}}" alt="{{name}}" loading="lazy" decoding="async"><figcaption data-cc-caption>{{caption}}</figcaption><pre data-cc-prompt>{{prompt}}</pre></figure>{{/frames}}</main></article>{{/books}}<footer>{{signature}}</footer></body></html>';
  return t;
}

function validatePresentationAssets(t){
  if(t.runtimeScript!==undefined&&(typeof t.runtimeScript!=='string'||t.runtimeScript.length>64000||/<\/script/i.test(t.runtimeScript)))throw Error('模板脚本应为不超过 64 KB 的 JavaScript，不能包含 script 结束标签。');
  if(t.scriptEnabled!==undefined&&typeof t.scriptEnabled!=='boolean')throw Error('脚本开关必须为布尔值。');
  if(t.assets!==undefined&&(!t.assets||typeof t.assets!=='object'||Array.isArray(t.assets)))throw Error('媒体库必须为对象。');
  let total=0;const entries=Object.entries(t.assets||{});if(entries.length>24)throw Error('每个模板最多 24 个媒体资源。');
  for(const [key,asset]of entries){if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(key)||!asset||typeof asset.data!=='string'||!/^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm));base64,[a-zA-Z0-9+/]*={0,2}$/.test(asset.data))throw Error('媒体只支持内嵌 PNG/JPEG/WebP/GIF、MP4/WebM。');total+=asset.data.length}
  if(total>6*1024*1024)throw Error('模板媒体总量上限为 6 MiB（Base64 后），请压缩图片或视频。');
  for(const m of (t.html||'').matchAll(/\{\{asset:([a-zA-Z][a-zA-Z0-9_-]*)\}\}/g))if(!Object.hasOwn(t.assets||{},m[1]))throw Error('缺少模板媒体：'+m[1]);
}

function presentationScriptKey(t){return t.scriptEnabled&&t.runtimeScript?t.id+'\n'+t.runtimeScript:''}

async function approvePresentationScript(t){const key=presentationScriptKey(t);if(!key||presentationUI.approved.has(key))return true;if(!await confirmAction('运行此模板的自定义脚本？','脚本只能操作自己的预览文档，不能读取 Mio 的密钥或工程。只运行可信来源的模板；复杂动画可能影响性能。关闭预览或切回默认模板可停止。','允许本次运行'))return false;presentationUI.approved.add(key);return true}

function presentationRuntime(){
  // No bridge to parent state. Scripts see only the rendered presentation DOM.
  Object.defineProperty(window,'MioTemplate',{value:Object.freeze({version:1,getFrames:()=>Object.freeze([...document.querySelectorAll('[data-cc-frame]')]),onReady:fn=>{if(typeof fn==='function')fn(document)}}),writable:false});
  const videos=[...document.querySelectorAll('video')];for(const video of videos){video.muted=true;video.playsInline=true;video.preload='metadata';if(matchMedia('(prefers-reduced-motion: reduce)').matches){video.autoplay=false;video.pause();video.controls=true}}
  document.addEventListener('visibilitychange',()=>{for(const v of videos)if(document.hidden)v.pause();else if(v.autoplay&&!matchMedia('(prefers-reduced-motion: reduce)').matches)v.play().catch(()=>{})});
  if(window.IntersectionObserver){const observer=new IntersectionObserver(entries=>{for(const e of entries){const v=e.target;if(!e.isIntersecting)v.pause();else if(v.autoplay&&!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches)v.play().catch(()=>{})}});videos.forEach(v=>observer.observe(v))}
}

function presentationDrawer(){
  const t=exportTemplateBy(presentationUI.templateId)||fitPresentationTemplate(),d=studioUI.exportDraft;
  return `<aside class="presentation-drawer" id="presentation-drawer" ${presentationUI.panel?'':'hidden'} aria-label="展示模板与导出"><header><div><small>PRESENTATION STUDIO</small><h2>给画册一种表达</h2></div>${ibtn('close','presentation-panel','收起模板与导出')}</header><label class="presentation-search">${icon('search','sm')}<input id="presentation-search" value="${esc(presentationUI.query)}" placeholder="搜索展示模板…" aria-label="搜索展示模板"></label><div id="presentation-template-list"></div><div class="presentation-tools">${btn('自定义','edit','presentation-edit','','small')}${btn('导入','upload','et-import','','small')}${featureEnabled('marketplace')?btn('市场','box','et-market','','small'):''}</div><details class="presentation-options"><summary>本次展示与导出设置</summary>${t.id==='mio-fit'?field('阅读方式',`<select id="presentation-native-mode">${[['gallery','完整画面 · 默认'],['spread','双页阅读'],['webtoon','连续卷轴']].map(([id,label])=>opt(id,label,artUI.readerMode)).join('')}</select>`):''}${field('主题色',`<input id="export-color" type="color" value="${esc(d.themeColor||t.options.accent)}">`)}${field('分镜框线 / px',`<input id="export-border" type="number" min="0" max="8" value="${Number(d.border)||0}">`)}${field('创作者签名',`<input id="export-signature" value="${esc(d.signature||'')}">`)}<label><input id="export-captions" type="checkbox" ${d.showCaptions?'checked':''}> 显示剧情台词</label><label><input id="export-prompts" type="checkbox" ${d.showPrompts?'checked':''}> 附带提示词</label></details><div class="presentation-export"><p>预览与导出使用同一份模板。<br>导出样张优先展示前 3 张已生成图片；缺页不伪装成成功。</p>${btn('导出完整 HTML','download','presentation-export','','primary')}<div id="export-status" role="status"></div></div></aside>`;
}

function renderPresentationList(){const root=$('#presentation-template-list');if(!root)return;const items=state.exportTemplates.filter(t=>(t.title+' '+t.description).toLowerCase().includes(presentationUI.query.toLowerCase()));root.innerHTML=items.map(t=>`<button class="presentation-choice ${t.id===presentationUI.templateId?'selected':''}" data-act="presentation-select" data-id="${esc(t.id)}" aria-pressed="${t.id===presentationUI.templateId}"><span class="presentation-swatch" style="--swatch:${t.options.accent}">${icon(t.id==='mio-fit'?'image':'book')}</span><span><strong data-user-content>${esc(t.title)}</strong><small>${t.id==='mio-fit'?'默认 · 完整画面':t.scriptEnabled?'沙盒交互模板':Object.keys(t.assets||{}).length?'含本地媒体':'HTML / CSS'}</small></span>${t.id===presentationUI.templateId?icon('check','sm'):''}</button>`).join('')||'<p class="help">没有匹配的模板。</p>'}

function beginExportPreview(){
  presentationUI.panel=true;presentationUI.exportPreview=true;
  const book=bookBy(ui.bookId);if(book&&presentationUI.templateId==='mio-fit'&&readerFrame(book,ui.step)?.pending){const first=slots(book).findIndex(s=>!s.pending&&s.image);if(first>=0)ui.step=first}
}

async function presentationImage(src){
  if(presentationImageCache.has(src))return presentationImageCache.get(src);
  const promise=(async()=>{const blob=await(await request(src,{},15000)).blob();if(!globalThis.createImageBitmap)return blobData(blob);const bitmap=await createImageBitmap(blob);try{const ratio=Math.min(1,1440/Math.max(bitmap.width,bitmap.height));if(ratio===1)return blobData(blob);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/webp',.85)}finally{bitmap.close()}})();
  presentationImageCache.set(src,promise);if(presentationImageCache.size>6)presentationImageCache.delete(presentationImageCache.keys().next().value);try{return await promise}catch(e){presentationImageCache.delete(src);throw e}
}

async function renderPresentationPreview(){
  const frame=$('#presentation-preview'),t=exportTemplateBy(presentationUI.templateId),book=bookBy(ui.bookId),revision=++presentationUI.revision;
  if(!frame||!t||!book)return;
  const status=$('#presentation-preview-status'),sample=presentationUI.panel&&presentationUI.exportPreview;
  try{
    const sequence=slots(book),available=sequence.filter(s=>!s.pending&&s.image),selected=sample?available.slice(0,3):sequence,frames=new Array(selected.length);let done=0;
    const label=sample?'导出样张 · 前 '+selected.length+' 张已生成图片（导出包含全册）':'整册阅读 · 已生成 '+available.length+' / '+sequence.length+' 幕';
    if(!selected.length){if(status)status.textContent='暂无已生成图片，请先生成或上传。';return}
    // Bounded preparation pool; never serially rebuild overlapping three-frame windows.
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{
      while(cursor<selected.length){const i=cursor++,s=selected[i];if(revision!==presentationUI.revision||!frame.isConnected)return;
        frames[i]={...s,image:s.pending?missingArtworkDataURL():await presentationImage(s.image)};done++;
        if(status&&revision===presentationUI.revision)status.textContent=label+' · 载入 '+done+' / '+selected.length;
      }
    }));
    if(revision!==presentationUI.revision||!frame.isConnected)return;
    frame.srcdoc=compileTemplateDocument(t,[{...book,steps:frames}],{...studioUI.exportDraft,sample});
    if(status)status.textContent=label+(presentationScriptKey(t)&&!presentationUI.approved.has(presentationScriptKey(t))?' · 自定义脚本未授权':'');
  }catch(e){if(revision===presentationUI.revision&&frame.isConnected&&status)status.textContent='画册载入失败：'+e.message}
}

function presentationMediaEditor(t){return `<section class="presentation-media-editor"><h3>模板媒体与交互</h3><p class="help">本地图片、GIF、MP4 / WebM；总量不超过 6 MiB。资源随模板包和离线画册携带，不访问外部地址。</p>${btn('添加媒体','upload','presentation-media-add','','small')}<div>${Object.entries(t.assets||{}).map(([key,a])=>`<div class="presentation-media-row"><span data-user-content>${esc(a.name||key)}</span><code>{{asset:${esc(key)}}}</code>${btn('设为背景','','presentation-media-background',`data-id="${esc(key)}"`,'small')}${ibtn('trash','presentation-media-delete','删除媒体',`data-id="${esc(key)}"`)}</div>`).join('')}</div><label class="row"><input id="presentation-script-enabled" type="checkbox" ${t.scriptEnabled?'checked':''}>启用自定义沙盒脚本</label><textarea id="presentation-script" spellcheck="false" aria-label="模板自定义 JavaScript" placeholder="MioTemplate.onReady(() => { /* 仅操作模板自己的 DOM */ });">${esc(t.runtimeScript||'')}</textarea><p class="help">不会获得父页面、密钥或工程权限。HTML 内不能直接放 script；脚本须在这里显式启用。修改后先保存，再在画册预览中授权运行。</p></section>`}

function installPresentationStudio(){
  document.addEventListener('keydown',e=>{
    if(!$('#reader').open||presentationUI.templateId==='mio-fit'||!['ArrowLeft','ArrowRight'].includes(e.key)||e.target.closest('input,textarea,select,[contenteditable]'))return;
    e.preventDefault();e.stopImmediatePropagation();$('#presentation-preview')?.contentWindow.postMessage({type:'mio-reader-turn',direction:e.key==='ArrowRight'?1:-1},'*');
  },true);

  const ensure=ensureStudioState;ensureStudioState=function(s=state){ensure(s);if(!s.exportTemplates.some(t=>t.id==='mio-fit'))s.exportTemplates.unshift(fitPresentationTemplate());return s};
  const compile=compileTemplateDocument;compileTemplateDocument=function(t,books,options={}){
    let html=compile(t,books,options);html=html.replace(/\{\{asset:([a-zA-Z][a-zA-Z0-9_-]*)\}\}/g,(_,key)=>t.assets[key].data);
    const doc=new DOMParser().parseFromString(html,'text/html'),csp=doc.querySelector('meta[http-equiv="Content-Security-Policy"]'),nonce=doc.querySelector('script[nonce]')?.getAttribute('nonce');csp.content+=' media-src data:;';
    const script=doc.createElement('script');script.setAttribute('nonce',nonce);script.textContent='('+presentationRuntime.toString()+')();'+(presentationUI.approved.has(presentationScriptKey(t))?'\n'+t.runtimeScript:'');doc.body.append(script);
    return '<!DOCTYPE html>\n'+doc.documentElement.outerHTML;
  };
  const open=openArtReader;openArtReader=function(id){ensureStudioState();presentationUI.templateId=exportTemplateBy(bookBy(id)?.presentationTemplateId)?.id||'mio-fit';presentationUI.panel=false;presentationUI.exportPreview=false;presentationUI.query='';ui.exportIds=[id];studioUI.exportDraft={...clone(state.settings.studio.export),templateId:presentationUI.templateId,signature:state.settings.signature,themeColor:null};open(id)};
  const baseReader=renderArtReader;renderArtReader=function(){baseReader();const reader=$('#reader');if(!bookBy(ui.bookId))return;reader.classList.add('presentation-reader');reader.classList.toggle('presentation-panel-open',presentationUI.panel);const modes=$('.room-controls',reader);if(modes)modes.outerHTML=btn('版式 · '+(exportTemplateBy(presentationUI.templateId)?.title||'完整画面'),'book','presentation-panel','','small presentation-trigger');const exportButton=$('.room-export',reader);if(exportButton)exportButton.dataset.act='presentation-open-export';reader.insertAdjacentHTML('beforeend',presentationDrawer());renderPresentationList();};
  const canvas=renderArtCanvas;renderArtCanvas=function(animate=false){$('#reader').classList.toggle('whole-book-reading',presentationUI.templateId!=='mio-fit');for(const el of $$('#reader [data-act="page-prev"],#reader [data-act="page-next"]'))el.disabled=false;presentationUI.revision++;if(presentationUI.templateId==='mio-fit'){canvas(animate);const focus=$('.room-focus'),d=studioUI.exportDraft,frame=readerFrame(bookBy(ui.bookId),ui.step);if(focus&&d){const img=$('img',focus);if(img)img.style.border=`${clamp(Number(d.border)||0,0,8)}px solid ${d.themeColor||'#a9c4ac'}`;if(d.showCaptions&&frame?.caption)focus.insertAdjacentHTML('beforeend',`<div class="presentation-native-caption" data-user-content>${esc(frame.caption)}</div>`);if(d.showPrompts&&frame?.prompt)focus.insertAdjacentHTML('beforeend',`<details class="presentation-native-caption"><summary>提示词</summary><p data-user-content>${esc(frame.prompt)}</p></details>`)}return}artUI.readerObserver?.disconnect();$('#reader-canvas').innerHTML='<div class="presentation-preview-wrap"><div id="presentation-preview-status" role="status">正在载入整册…</div><iframe id="presentation-preview" sandbox="allow-scripts" referrerpolicy="no-referrer" title="整册画册阅读器"></iframe></div>';syncArtReader();void renderPresentationPreview()};
  const close=closeArtReader;closeArtReader=function(){presentationUI.revision++;clearTimeout(presentationUI.previewTimer);$('#presentation-preview')?.remove();close()};
  openReader=id=>openArtReader(id);closeReader=()=>closeArtReader();renderReader=()=>renderArtReader();renderReaderCanvas=animate=>renderArtCanvas(animate);
  $('#reader').addEventListener('close',()=>{if($('#reader').open)return;presentationImageCache.clear();presentationUI.panel=false;$('#presentation-drawer')?.remove();presentationUI.revision++;$('#presentation-preview')?.remove();clearTimeout(presentationUI.previewTimer)});
  const exportHub=showExportHub;showExportHub=function(ids,preserve=false){if(ids.length===1){if(ui.bookId!==ids[0]||!$('#reader').open)openArtReader(ids[0]);beginExportPreview();renderArtReader();return}const result=exportHub(ids,preserve);if(!preserve){studioUI.exportDraft.templateId='mio-fit';renderExportHub()}return result};
  exportModal=(ids)=>showExportHub(ids);
  const exportAll=compileCustomExport;compileCustomExport=async function(){if(!await approvePresentationScript(exportTemplateBy(studioUI.exportDraft.templateId)))return;return exportAll()};compileExport=compileCustomExport;
  const source=templateSourceFields;templateSourceFields=t=>source(t)+presentationMediaEditor(t);
  const editor=openTemplateStudio;openTemplateStudio=function(...args){presentationUI.revision++;$('#presentation-preview')?.remove();return editor(...args)};
  const action=handleAction;handleAction=async function(act,d={},el){
    if(act==='presentation-panel'){presentationUI.exportPreview=false;presentationUI.panel=!presentationUI.panel;const drawer=$('#presentation-drawer');if(drawer)drawer.hidden=!presentationUI.panel;$('#reader').classList.toggle('presentation-panel-open',presentationUI.panel);renderArtCanvas(false);return}
    if(act==='presentation-select'){const t=exportTemplateBy(d.id);if(!t||!await approvePresentationScript(t))return;readExportDraft();presentationUI.templateId=t.id;studioUI.exportDraft.templateId=t.id;bookBy(ui.bookId).presentationTemplateId=t.id;save();artUI.readerMode='gallery';artUI.filmstrip=false;renderArtReader();return}
    if(act==='presentation-edit'){openTemplateStudio(presentationUI.templateId);return}
    if(act==='presentation-open-export'){beginExportPreview();$('#presentation-drawer').hidden=false;$('#reader').classList.add('presentation-panel-open');renderArtCanvas(false);return}
    if(act==='presentation-export'){const t=exportTemplateBy(presentationUI.templateId);if(!await approvePresentationScript(t))return;ui.exportIds=[ui.bookId];studioUI.exportDraft.templateId=t.id;presentationUI.panel=true;$('#presentation-drawer').hidden=false;$('#reader').classList.add('presentation-panel-open');return compileCustomExport()}
    if(act==='room-thumbnails'){artUI.filmstrip=!artUI.filmstrip;renderArtReader();return}
    if(act==='presentation-media-add'){pickFile('image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm',async file=>{if(file.size>4.4*1024*1024)throw Error('请将媒体压缩到 4.4 MiB 以内。');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('媒体读取失败'));reader.readAsDataURL(file)}),t=currentEditorTemplate(),next=clone(t),id=uid('media');next.assets??={};next.assets[id]={name:file.name,data};validatePresentationAssets(next);t.assets=next.assets;studioUI.editorDirty=true;renderTemplateStudio()});return}
    if(act==='presentation-media-background'){const t=currentEditorTemplate(),a=t.assets?.[d.id];if(!a)return;const media=a.data.startsWith('data:video/')?`<video autoplay muted loop playsinline preload="metadata"><source src="{{asset:${d.id}}}" type="${a.data.slice(5,a.data.indexOf(';'))}"></video>`:`<img src="{{asset:${d.id}}}" alt="">`;t.html=t.html.replace('</head>','<style>body{isolation:isolate}.mio-media-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.35}.mio-media-bg img,.mio-media-bg video{width:100%;height:100%;object-fit:cover}</style></head>').replace(/<body([^>]*)>/,`<body$1><div class="mio-media-bg">${media}</div>`);studioUI.editorDirty=true;renderTemplateStudio();return}
    if(act==='presentation-media-delete'){const t=currentEditorTemplate();if(t.html.includes('{{asset:'+d.id+'}}'))throw Error('请先从 HTML/CSS 移除此媒体的占位符，再删除资源。');delete t.assets[d.id];studioUI.editorDirty=true;renderTemplateStudio();return}
    const result=await action(act,d,el);if(['et-close','et-save','et-import'].includes(act)&&$('#presentation-template-list'))renderPresentationList();return result;
  };
  $('#template-studio').addEventListener('close',()=>{$('#template-preview')?.removeAttribute('srcdoc');if($('#reader').open&&presentationUI.templateId!=='mio-fit'&&!$('#presentation-preview'))renderArtCanvas(false)});
  document.addEventListener('input',e=>{if(e.target.id==='presentation-search'){presentationUI.query=e.target.value;renderPresentationList()}if(e.target.id==='presentation-script'){currentEditorTemplate().runtimeScript=e.target.value;studioUI.editorDirty=true}},true);
  document.addEventListener('change',e=>{if(e.target.id==='presentation-native-mode'){readExportDraft();artUI.readerMode=e.target.value;renderArtReader();return}if(e.target.id==='presentation-script-enabled'){currentEditorTemplate().scriptEnabled=e.target.checked;studioUI.editorDirty=true}if(e.target.closest('#presentation-drawer')&&e.target.id.startsWith('export-')){e.stopImmediatePropagation();readExportDraft();clearTimeout(presentationUI.previewTimer);presentationUI.previewTimer=setTimeout(()=>{if(presentationUI.templateId!=='mio-fit')void renderPresentationPreview();else renderArtCanvas(false)},160)}},true);
}
