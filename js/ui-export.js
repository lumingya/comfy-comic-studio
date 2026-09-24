/* Mio export: feature-owned UI functions. Loaded before ui.js; initialization remains in app.js. */
'use strict';

function exportModal(ids){ui.exportIds=ids.filter(id=>bookBy(id));if(!ui.exportIds.length)throw Error('请选择至少一本画册。');modal('导出你的故事',`<p class="soft small" style="margin:0 0 20px">${ui.exportIds.length===1?esc(bookBy(ids[0]).title):ui.exportIds.length+' 本画册合集'} · 独立 HTML，断网也能阅读</p><div class="export-options">${[['webtoon','list','Webtoon 长卷','流式纵向阅读，适合移动端'],['manga','compare','Manga 双页','经典对开排版，可直接打印'],['artbook','image','Artbook 艺术册','留白展台、色卡与创作者签名'],['flip','book','3D 交互翻页','带纸张光影的独立翻页画册']].map(([v,ic,l,h])=>`<button class="export-option ${v===ui.exportFormat?'active':''}" data-act="export-format" data-format="${v}">${icon(ic)}<span><strong>${l}</strong><small>${h}</small></span></button>`).join('')}</div><div class="divider"></div><div class="grid2">${field('画册主题色','<input id="export-color" type="color" value="#43634b">')}${field('分镜框线 / px','<input id="export-border" type="number" min="0" max="8" value="0">')}${field('创作者签名',input('signature',state.settings.signature,'text','id="export-signature"'))}</div><label class="row small soft"><input type="checkbox" id="export-prompts">附带提示词水印</label><div class="help">分镜严格按 stepIndex 升序编译。所有图片和脚本均内联。在线示例参考图若受跨域限制，将使用对应的内置矢量画面，并在画册中注明。</div><div class="modal-footer"><span class="grow tiny muted" id="export-status">OFFLINE · SELF-CONTAINED</span>${btn('生成并下载画册','download','compile-export','','primary')}</div>`,'每一帧都将被妥善保存',true)}

async function compileExport(){const theme=$('#export-color').value,watermark=$('#export-prompts').checked,border=clamp(Number($('#export-border').value),0,8),signature=$('#export-signature').value,format=ui.exportFormat,books=ui.exportIds.map(bookBy),sections=[];let fallbackCount=0,done=0;const total=books.reduce((n,b)=>n+b.totalSteps,0);const button=$('[data-act="compile-export"]');button.disabled=true;try{for(const b of books){const pages=[];for(const s of slots(b).sort((a,b)=>a.stepIndex-b.stepIndex)){let data,notice='';try{data=await imageData(s.image)}catch(e){if(!s.offlineImage)throw Error('分镜 '+(s.stepIndex+1)+' 无法内联，请先上传本地图片。');data=s.offlineImage;fallbackCount++;notice='内置矢量版本 · 在线参考图不可离线读取'}if(!data.startsWith('data:'))throw Error('图片未能内联。');let colors='';if(format==='artbook'){try{const jpg=await rasterJPEG(data,64),im=new Image();im.src=jpg;await im.decode();const cv=document.createElement('canvas');cv.width=cv.height=32;const cx=cv.getContext('2d');cx.drawImage(im,0,0,32,32);colors=Array.from({length:5},(_,i)=>{const p=cx.getImageData(4+i*5,12+i*2,1,1).data;return`<i style="background:rgb(${p[0]},${p[1]},${p[2]})"></i>`}).join('')}catch(e){}}pages.push(`<article class="sheet"><img src="${esc(data)}" alt="${esc(s.name)}"><div class="caption"><small>${pad(s.stepIndex+1)} / ${esc(s.name)}</small><p>${esc(s.caption)}</p>${watermark?`<pre>${esc(s.prompt)}</pre>`:''}${notice?`<small>${notice}</small>`:''}${format==='artbook'?`<div class="palette">${colors}</div><div class="signature">${esc(signature)}</div>`:''}</div></article>`);done++;if($('#export-status'))$('#export-status').textContent='正在内联图片 '+done+' / '+total}if((format==='manga'||format==='flip')&&pages.length%2)pages.push('<article class="sheet blank"><span>THIS STORY CONTINUES</span></article>');const cover=`<header><small>MIO / ${esc(format.toUpperCase())}</small><h1>${esc(b.title)}</h1><p>${esc(b.synopsis)}</p><span>${esc(b.characterName)} · ${b.totalSteps} 幕</span></header>`;sections.push(`<section class="collection ${format==='flip'?'flipbook':''}">${cover}<div class="sheets">${pages.join('')}</div>${format==='flip'?'<nav><button class="prev">上一跨页</button><span class="counter"></span><button class="next">下一跨页</button></nav>':''}</section>`)}const html=`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(books.length===1?books[0].title:'Mio 画册合集')}</title><style>*{box-sizing:border-box}body{margin:0;background:${format==='artbook'?'#f0eee7':'#101614'};color:${format==='artbook'?'#273229':'#e4e9df'};font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{text-align:center;padding:64px 24px 45px}header small{font-size:9px;letter-spacing:3px;color:${theme}}h1{font:38px Georgia,serif;letter-spacing:2px}header p{opacity:.6;line-height:1.9}header>span{font-size:10px;opacity:.5}.sheets{max-width:${format==='webtoon'?'720px':'1140px'};margin:auto;${format==='manga'||format==='flip'?'display:grid;grid-template-columns:1fr 1fr;gap:4px;':''}${format==='flip'?'perspective:1800px;':''}}.sheet{margin:0;min-width:0;${format==='artbook'?'padding:70px 120px;background:#f8f7f2;margin-bottom:30px;':''}border:${border}px solid ${theme};break-inside:avoid}.sheet img{display:block;width:100%;height:auto;${format==='flip'?'height:60vh;object-fit:contain;background:#eee9dc;':''}}.caption{padding:22px 28px;background:${format==='artbook'?'#f8f7f2':'#ece9de'};color:#333e33;line-height:1.9}.caption small{font-size:10px;color:${theme};letter-spacing:1px}.caption p{margin:9px 0}.caption pre{font-size:9px;white-space:pre-wrap;opacity:.5}.blank{min-height:65vh;background:#ece9de;color:#a6a294;display:grid;place-items:center;font:11px Georgia;letter-spacing:3px}.palette{display:flex;gap:5px;margin-top:22px}.palette i{width:22px;height:22px;display:block}.signature{font:italic 24px Georgia;color:${theme};text-align:right;margin-top:15px}.collection{margin-bottom:80px}nav{display:flex;justify-content:center;align-items:center;gap:24px;padding:25px}nav button{background:${theme};color:white;border:0;padding:12px 20px;border-radius:4px;cursor:pointer}.counter{font-size:11px}.turn .sheet:nth-child(even){transform-origin:left;animation:turn .65s ease-out}footer{text-align:center;font-size:10px;padding:35px;opacity:.5}[hidden]{display:none!important}@keyframes turn{from{transform:rotateY(-155deg);filter:brightness(.5)}to{transform:rotateY(0);filter:brightness(1)}}@media(max-width:700px){.sheet{padding:${format==='artbook'?'24px':'0'}}h1{font-size:29px}.caption{padding:14px;font-size:11px}.sheet img{height:auto}.blank{min-height:40vh}}@media print{body{background:white;color:black}nav,footer{display:none}header{break-after:page}.sheet{break-inside:avoid}.sheet[hidden]{display:block!important}.collection{margin:0}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style></head><body>${sections.join('')}<footer>${esc(signature)} · Mio · 完全内联离线画册${fallbackCount?' · '+fallbackCount+' 张参考封面使用内置矢量版本':''}</footer>${format==='flip'?'<script>('+standaloneFlip.toString()+')();<'+ '/script>':''}</body></html>`;download((books.length===1?books[0].title:'Mio 合集')+'_'+format+'.html',html,'text/html');toast('离线画册已生成'+(fallbackCount?'，含 '+fallbackCount+' 张矢量替代封面。':'。'));closeModal()}finally{if(button.isConnected)button.disabled=false}}

function defaultExportHTML(){return MioContent.baseHTML.html}

function inspectExportHTML(raw){
  if(typeof raw!=='string'||raw.length>5000000)throw Error('模板 HTML 必须为文本，且不超过 5 MB。');
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
  if(!b){const preview=clone(MioContent.previewBook);preview.steps.forEach((f,i)=>f.image=svgArt(i));return [preview]}
  return [{...b,steps:slots(b).slice(0,3).map(s=>({...s,image:s.pending?missingArtworkDataURL():s.image,imageNote:s.pending?'尚未生成':''}))}];
}

/* Template validation is owned by ui-templates.js; do not shadow its structure and safety checks. */

async function imagePalette(data){
  const jpg=await rasterJPEG(data,40),im=new Image();im.crossOrigin='anonymous';im.src=jpg;await im.decode();const c=document.createElement('canvas');c.width=c.height=24;const ctx=c.getContext('2d');ctx.drawImage(im,0,0,24,24);
  return [5,12,19].map((x,i)=>{const rgb=ctx.getImageData(x,8+i*4,1,1).data;return '#'+[...rgb].slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('')});
}

/* ---- Export image profiles. Same vocabulary as backend/mio_export_images.py so HTML, ZIP and PDF behave alike. ---- */
const EXPORT_INLINE_BUDGET=512*1024*1024;
const EXPORT_PUBLISH={maxEdge:2560,webpQuality:.86,jpegQuality:.9};
const exportImageProfiles={
  auto:{label:'自动 · 优先无损，超预算时自动压缩',help:'先按「无损清洗」处理；整册内联超过 512 MiB 时自动改用「轻量发布」，完成后会说明。'},
  clean:{label:'无损清洗 · 移除工作流与提示词元数据',help:'像素、分辨率与格式与原图一致，仅移除 PNG / JPEG / WebP 内嵌的工作流、提示词与 EXIF。'},
  publish:{label:'轻量发布 · 高画质 WebP，适合分享',help:'移除元数据后重新编码为高画质 WebP（长边不超过 2560 px），体积通常缩小十倍以上。'},
  archive:{label:'无损归档 · 原样保留内嵌工作流',help:'原文件逐字节写入，包含 ComfyUI 工作流与提示词；只适合本地备份，不要直接分发。'}
};
function exportImageProfile(value){return Object.hasOwn(exportImageProfiles,value)?value:'auto'}
function exportImageProfileControl(d=studioUI.exportDraft||{}){const current=exportImageProfile(d.imageProfile);return field('图片处理',`<select id="export-image-profile" aria-label="导出图片处理方式">${Object.entries(exportImageProfiles).map(([id,p])=>opt(id,p.label,current)).join('')}</select>`,`<span id="export-image-profile-help">${esc(exportImageProfiles[current].help)}</span>`)}
function syncExportImageProfileHelp(){const help=$('#export-image-profile-help'),d=studioUI.exportDraft;if(help&&d)help.textContent=exportImageProfiles[exportImageProfile(d.imageProfile)].help}
function exportBudgetMessage(profile){return profile==='publish'?'整册超出 512 MiB 单文件内联建议预算。单文件 HTML 体积过大可能导致低内存设备打开时较慢，建议拆分画册分别导出，或改用 ZIP 资源包。':'完整原图超出 512 MiB 单文件内联建议预算。建议将「图片处理」改为「轻量发布」（高画质 WebP，清洗元数据），或选择 ZIP 资源包；ZIP 不受预算限制，也不会降低原图分辨率。'}
function exportSize(bytes){if(!(bytes>0))return '0 B';const units=['B','KB','MB','GB'];let size=bytes,i=0;while(size>=1024&&i<units.length-1){size/=1024;i++}return (i?size.toFixed(1):String(size))+' '+units[i]}
function exportProgressText(done,total,s){const phase=!s||s.profile==='archive'?'正在读取完整原图 ':s.profile==='publish'?(s.autoCompressed?'原图超出单文件预算，正在按轻量发布重新处理 ':'正在压缩并内联图片 '):'正在清洗并内联原图 ';return phase+done+' / '+total}
function exportImageSummary(s){if(!s)return '';if(s.profile==='archive')return '图片按无损归档原样内联，包含内嵌工作流与提示词元数据。'+(s.overBudget?`（注意：整册内联体积 ${exportSize(s.inlineBytes)} 已超出 512 MiB 建议上限，部分设备打开可能较慢）`:'');const parts=[];if(s.scrubbed)parts.push('已移除 '+s.scrubbed+' 张图片的工作流 / 提示词元数据');if(s.profile==='publish')parts.push((s.autoCompressed?'原图超出 512 MiB 单文件预算，已自动改用轻量发布：':'轻量发布：')+s.recompressed+' 张重新编码为 WebP，图片 '+exportSize(s.originalBytes)+' → '+exportSize(Math.round(s.inlineBytes*3/4)));else parts.push('原图分辨率与编码未改动');if(s.overBudget)parts.push(`整册内联体积 ${exportSize(s.inlineBytes)} 已超出 512 MiB 建议上限，部分设备打开可能较慢`);return parts.join('；')+'。'}

/* Byte-level metadata scrubbing. Containers are rewritten, pixels are never decoded, so「无损清洗」is exactly lossless. */
function asciiAt(bytes,start,length){let text='';for(let i=start;i<start+length&&i<bytes.length;i++)text+=String.fromCharCode(bytes[i]);return text}
function asciiBytes(text){return new Uint8Array([...text].map(ch=>ch.charCodeAt(0)&255))}
function concatBytes(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length}return out}
function readU32BE(b,i){return((b[i]<<24)>>>0)+(b[i+1]<<16)+(b[i+2]<<8)+b[i+3]}
function readU32LE(b,i){return b[i]+(b[i+1]<<8)+(b[i+2]<<16)+((b[i+3]<<24)>>>0)}
function u32BE(v){return new Uint8Array([(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255])}
function u32LE(v){return new Uint8Array([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255])}
let pngCRCTable=null;
function pngCRC(bytes){if(!pngCRCTable){pngCRCTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;pngCRCTable[n]=c>>>0}}let c=0xffffffff;for(const b of bytes)c=pngCRCTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function imageBytesKind(bytes){if(bytes.length>=8&&bytes[0]===0x89&&asciiAt(bytes,1,3)==='PNG'&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a)return 'png';if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpeg';if(bytes.length>=12&&asciiAt(bytes,0,4)==='RIFF'&&asciiAt(bytes,8,4)==='WEBP')return 'webp';return ''}
function exifOrientation(tiff){try{const o=asciiAt(tiff,0,4)==='Exif'?6:0,le=asciiAt(tiff,o,2)==='II';if(!le&&asciiAt(tiff,o,2)!=='MM')return 1;const u16=i=>le?tiff[i]+(tiff[i+1]<<8):(tiff[i]<<8)+tiff[i+1],u32=i=>le?readU32LE(tiff,i):readU32BE(tiff,i);if(u16(o+2)!==42)return 1;const ifd=o+u32(o+4),count=u16(ifd);for(let n=0;n<count;n++){const e=ifd+2+n*12;if(u16(e)===0x0112&&u16(e+2)===3){const v=u16(e+8);return v>=1&&v<=8?v:1}}}catch(e){/* malformed EXIF: treat as upright */}return 1}
function minimalExif(orientation){return new Uint8Array([0x4d,0x4d,0,0x2a,0,0,0,8,0,1,0x01,0x12,0,3,0,0,0,1,0,orientation,0,0,0,0,0,0])}
function isMinimalExif(tiff){const o=asciiAt(tiff,0,4)==='Exif'?6:0;if(tiff.length-o!==26||tiff[o+19]<2||tiff[o+19]>8)return false;const m=minimalExif(tiff[o+19]);for(let i=0;i<26;i++)if(tiff[o+i]!==m[i])return false;return true}
function pngChunks(bytes){const chunks=[];let p=8;while(p+8<=bytes.length){const length=readU32BE(bytes,p),type=asciiAt(bytes,p+4,4),end=p+12+length;if(end>bytes.length)break;chunks.push({type,data:bytes.subarray(p+8,p+8+length),raw:bytes.subarray(p,end)});p=end;if(type==='IEND')break}return chunks}
function pngChunk(type,data){const name=asciiBytes(type);return concatBytes([u32BE(data.length),name,data,u32BE(pngCRC(concatBytes([name,data])))])}
function pngMetadataKeys(bytes){const keys=[];for(const c of pngChunks(bytes)){if(c.type==='tEXt'||c.type==='zTXt'||c.type==='iTXt'){let end=0;while(end<c.data.length&&c.data[end]!==0)end++;keys.push(c.type+':'+asciiAt(c.data,0,end))}else if(c.type==='eXIf'&&!isMinimalExif(c.data))keys.push('eXIf')}return keys}
function stripPNG(bytes){const removed=pngMetadataKeys(bytes);if(!removed.length)return{bytes,removed};const parts=[bytes.subarray(0,8)];let orientation=1,complete=false;for(const c of pngChunks(bytes)){if(c.type==='eXIf'){orientation=exifOrientation(c.data);continue}if(c.type==='tEXt'||c.type==='zTXt'||c.type==='iTXt')continue;if(c.type==='IDAT'&&orientation!==1){parts.push(pngChunk('eXIf',minimalExif(orientation)));orientation=1}parts.push(c.raw);if(c.type==='IEND')complete=true}if(!complete)parts.push(pngChunk('IEND',new Uint8Array(0)));return{bytes:concatBytes(parts),removed}}
function jpegSegments(bytes){const segments=[],total=bytes.length;let p=2;while(p<total){if(bytes[p]!==0xff){let end=p;while(end<total&&bytes[end]!==0xff)end++;segments.push({marker:-1,raw:bytes.subarray(p,end)});p=end;continue}while(p<total&&bytes[p]===0xff)p++;if(p>=total)break;const marker=bytes[p],start=p-1;p++;if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7)){segments.push({marker,raw:bytes.subarray(start,p)});continue}if(marker===0xd9){segments.push({marker,raw:bytes.subarray(start,p)});break}if(p+2>total){segments.push({marker,raw:bytes.subarray(start)});break}const length=(bytes[p]<<8)+bytes[p+1],end=Math.min(total,p+Math.max(length,2));if(marker===0xda){let cursor=end;while(cursor+1<total){if(bytes[cursor]===0xff&&bytes[cursor+1]!==0&&!(bytes[cursor+1]>=0xd0&&bytes[cursor+1]<=0xd7))break;cursor++}if(cursor+1>=total)cursor=total;segments.push({marker,raw:bytes.subarray(start,cursor)});p=cursor;continue}segments.push({marker,raw:bytes.subarray(start,end)});p=end}return segments}
function jpegPayload(segment){return segment.raw.subarray(4)}
function jpegKeep(segment){const m=segment.marker;if(m===0xe1||m===0xfe||(m>=0xe2&&m<=0xef)){const payload=jpegPayload(segment);if(m===0xe2&&asciiAt(payload,0,12)==='ICC_PROFILE\0')return true;if(m===0xee&&asciiAt(payload,0,5)==='Adobe')return true;if(m===0xe1&&asciiAt(payload,0,6)==='Exif\0\0'&&isMinimalExif(payload))return true;return false}return true}
function jpegMetadataKeys(bytes){const keys=[];for(const segment of jpegSegments(bytes)){if(segment.marker<0||jpegKeep(segment))continue;const payload=jpegPayload(segment);if(segment.marker===0xfe)keys.push('COM');else if(segment.marker===0xe1&&asciiAt(payload,0,5)==='Exif\0')keys.push('EXIF');else if(segment.marker===0xe1&&asciiAt(payload,0,28)==='http://ns.adobe.com/xap/1.0/')keys.push('XMP');else keys.push('APP'+(segment.marker-0xe0))}return keys}
function stripJPEG(bytes){const removed=jpegMetadataKeys(bytes);if(!removed.length)return{bytes,removed};const parts=[bytes.subarray(0,2)];let orientation=1,inserted=false;for(const segment of jpegSegments(bytes)){if(segment.marker<0)continue;if(!jpegKeep(segment)){const payload=jpegPayload(segment);if(segment.marker===0xe1&&asciiAt(payload,0,5)==='Exif\0')orientation=exifOrientation(payload);continue}if(segment.marker!==0xd8&&segment.marker!==0xe0&&orientation!==1&&!inserted){const payload=concatBytes([asciiBytes('Exif\0\0'),minimalExif(orientation)]),length=payload.length+2;parts.push(new Uint8Array([0xff,0xe1,(length>>8)&255,length&255]),payload);inserted=true}parts.push(segment.raw);if(segment.marker===0xd9)break}return{bytes:concatBytes(parts),removed}}
const WEBP_KNOWN_CHUNKS=new Set(['VP8 ','VP8L','VP8X','ALPH','ANIM','ANMF','ICCP']);
function webpChunks(bytes){const chunks=[];let p=12;while(p+8<=bytes.length){const fourcc=asciiAt(bytes,p,4),size=readU32LE(bytes,p+4),end=p+8+size;if(end>bytes.length)break;chunks.push({fourcc,data:bytes.subarray(p+8,end)});p=end+(size&1)}return chunks}
function webpMetadataKeys(bytes){if(asciiAt(bytes,12,4)!=='VP8X')return[];const keys=[];for(const c of webpChunks(bytes)){if(c.fourcc==='EXIF'){if(!isMinimalExif(c.data))keys.push('EXIF')}else if(c.fourcc==='XMP ')keys.push('XMP');else if(!WEBP_KNOWN_CHUNKS.has(c.fourcc))keys.push(c.fourcc.trim())}return keys}
function stripWebP(bytes){const removed=webpMetadataKeys(bytes);if(!removed.length)return{bytes,removed};const chunks=[];let orientation=1;for(const c of webpChunks(bytes)){if(c.fourcc==='EXIF'){orientation=exifOrientation(c.data);continue}if(!WEBP_KNOWN_CHUNKS.has(c.fourcc))continue;let data=c.data;if(c.fourcc==='VP8X'&&data.length){data=new Uint8Array(data);data[0]&=~0x0c}chunks.push({fourcc:c.fourcc,data})}if(orientation!==1){chunks.push({fourcc:'EXIF',data:minimalExif(orientation)});if(chunks[0]?.fourcc==='VP8X'&&chunks[0].data?.length)chunks[0].data[0]|=0x08}const body=concatBytes(chunks.flatMap(c=>{const head=concatBytes([asciiBytes(c.fourcc),u32LE(c.data.length)]);return c.data.length&1?[head,c.data,new Uint8Array(1)]:[head,c.data]}));return{bytes:concatBytes([asciiBytes('RIFF'),u32LE(body.length+4),asciiBytes('WEBP'),body]),removed}}
function imageMetadataKeys(bytes){const kind=imageBytesKind(bytes);return kind==='png'?pngMetadataKeys(bytes):kind==='jpeg'?jpegMetadataKeys(bytes):kind==='webp'?webpMetadataKeys(bytes):[]}
function stripImageMetadata(bytes){const kind=imageBytesKind(bytes);return kind==='png'?stripPNG(bytes):kind==='jpeg'?stripJPEG(bytes):kind==='webp'?stripWebP(bytes):{bytes,removed:[]}}
function dataURLBytes(data){const comma=data.indexOf(',');if(!data.startsWith('data:')||comma<0)return{mime:'',bytes:null};const header=data.slice(5,comma),mime=header.split(';')[0].toLowerCase();if(!/;base64$/i.test(header))return{mime,bytes:null};const binary=atob(data.slice(comma+1)),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return{mime,bytes}}

async function compactExportImage(bytes,mime){
  if(typeof createImageBitmap!=='function'||typeof document==='undefined')return null;
  const bitmap=await createImageBitmap(new Blob([bytes],{type:mime}));
  try{
    const scale=Math.min(1,EXPORT_PUBLISH.maxEdge/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const encode=(c,type,quality)=>new Promise(resolve=>c.toBlob(resolve,type,quality));
    let blob=await encode(canvas,'image/webp',EXPORT_PUBLISH.webpQuality);
    if(!blob||blob.type!=='image/webp'){/* No WebP encoder (e.g. Safari): high-quality JPEG on white. */const flat=document.createElement('canvas');flat.width=canvas.width;flat.height=canvas.height;const context=flat.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,flat.width,flat.height);context.drawImage(canvas,0,0);blob=await encode(flat,'image/jpeg',EXPORT_PUBLISH.jpegQuality)}
    return blob?await blobData(blob):null;
  }finally{bitmap.close()}
}

/* One frame through the chosen profile. Returns the Data URL to inline plus what happened to it. */
async function exportFrameImage(src,profile,signal){
  const original=await imageData(src,signal),result={image:original,originalBytes:0,removed:[],recompressed:false};
  if(profile==='archive'||!/^data:image\//i.test(original))return result;
  const {mime,bytes}=dataURLBytes(original);if(!bytes)return result;
  result.originalBytes=bytes.length;
  if(!imageBytesKind(bytes))return result;/* SVG and friends carry no binary metadata blocks */
  const cleaned=stripImageMetadata(bytes);result.removed=cleaned.removed;
  let image=cleaned.removed.length?await blobData(new Blob([cleaned.bytes],{type:mime})):original;
  if(profile==='publish'){if(signal?.aborted)throw new DOMException('已取消','AbortError');const compact=await compactExportImage(cleaned.bytes,mime).catch(()=>null);if(compact&&compact.length<image.length){image=compact;result.recompressed=true}}
  result.image=image;return result;
}

async function prepareExportBooks(ids,t,onProgress,signal,options={}){
  const requested=exportImageProfile(options.imageProfile),budget=options.inlineBudget>0?options.inlineBudget:EXPORT_INLINE_BUDGET,total=ids.map(bookBy).filter(Boolean).reduce((n,b)=>n+b.totalSteps,0);
  const attempt=async profile=>{
    const selected=ids.map(bookBy).filter(Boolean).map(clone),stats={requested,profile,autoCompressed:requested==='auto'&&profile==='publish',frames:0,scrubbed:0,recompressed:0,originalBytes:0,inlineBytes:0};let done=0,fallbacks=0,bytes=0;onProgress?.(0,total,stats);
    for(const b of selected){const frames=[];for(const s of slots(b).sort((a,b)=>a.stepIndex-b.stepIndex)){
      if(signal?.aborted)throw new DOMException('已取消','AbortError');
      let image,note=s.pending?'尚未生成':'';
      if(s.pending)image=missingArtworkDataURL();else {let prepared;try{prepared=await exportFrameImage(s.image,profile,signal)}catch(e){if(signal?.aborted)throw new DOMException('已取消','AbortError');throw Error('第 '+(s.stepIndex+1)+' 幕原图无法读取，请修复图片后再导出。')}image=prepared.image;stats.frames++;stats.originalBytes+=prepared.originalBytes;if(prepared.removed.length)stats.scrubbed++;if(prepared.recompressed)stats.recompressed++}
      bytes+=image.length;stats.inlineBytes=bytes;
      /* Reader-safety ceiling for one HTML file. 「自动」retries the whole book as「轻量发布」instead of failing. 超出不阻断，而是警告。 */
      if(bytes>budget){
        if(requested==='auto'&&profile!=='publish')return null;
        stats.overBudget=true;
        stats.budgetWarning=exportBudgetMessage(profile);
      }
      if(!/^data:image\//i.test(image))throw Error('导出图片格式不合法。');
      let palette;if(t.layout==='artbook'){try{palette=await imagePalette(image)}catch(e){palette=[t.options.accent,t.options.background,t.options.paper]}}
      frames.push({...s,...await measureArtwork(image,signal),image,imageNote:note,palette});done++;onProgress?.(done,total,stats);await new Promise(resolve=>setTimeout(resolve,0));
    }b.steps=frames}
    return {books:selected,fallbacks,stats};
  };
  return await attempt(requested==='auto'?'clean':requested)||attempt('publish');
}

function readExportDraft(){
  const d=studioUI.exportDraft;if(!d)return;
  if($('#export-template-select'))d.templateId=$('#export-template-select').value;
  if($('#export-color'))d.themeColor=$('#export-color').value;
  if($('#export-border'))d.border=Number($('#export-border').value);
  if($('#export-signature'))d.signature=$('#export-signature').value;
  if($('#export-captions'))d.showCaptions=$('#export-captions').checked;
  if($('#export-prompts'))d.showPrompts=$('#export-prompts').checked;
  if($('#export-embed-storyboard'))d.embedStoryboard=$('#export-embed-storyboard').checked;
  if($('#export-embed-variables'))d.embedVariables=$('#export-embed-variables').checked;
  if($('#export-image-profile')){d.imageProfile=exportImageProfile($('#export-image-profile').value);syncExportImageProfileHelp()}
}

function showExportHub(ids,preserve=false){
  ensureStudioState();ui.exportIds=ids.filter(id=>bookBy(id));if(!ui.exportIds.length)throw Error('请选择至少一本画册。');
  if(!preserve||!studioUI.exportDraft)studioUI.exportDraft={...clone(state.settings.studio.export),signature:state.settings.signature,themeColor:null};
  studioUI.returnToExport=false;
  modal('导出你的故事','<div id="export-hub-root"></div>','用自己的 HTML 模板，为每一个故事设计阅读体验。',true);renderExportHub();
}

function renderExportHub(){
  if(!$('#export-hub-root'))return;
  let d=studioUI.exportDraft,t=exportTemplateBy(d.templateId)||state.exportTemplates[0];if(!t){$('#export-hub-root').innerHTML='<p class="help">没有展示模板，请导入独立模板后再导出。</p>'+btn('导入模板','upload','et-import')+portableExportButtons();return}d.templateId=t.id;
  const b=bookBy(ui.exportIds[0]);
  $('#export-hub-root').innerHTML=`<div class="export-hub"><section><div class="export-identity">${imgTag(coverImage(b),b.title,`data-book="${b.id}" data-step="0"`)}<div class="grow"><strong>${ui.exportIds.length===1?esc(b.title):ui.exportIds.length+' 本画册合集'}</strong><p>${ui.exportIds.reduce((n,id)=>n+bookBy(id).totalSteps,0)} 幕分镜 · 全内联离线 HTML</p></div></div>${field('画册导出模板',`<select id="export-template-select" aria-label="选择画册导出 HTML 模板">${state.exportTemplates.map(x=>opt(x.id,x.title+(x.builtin?' · 内置':''),t.id)).join('')}</select>`)}<p class="export-template-description">${esc(t.description||'自定义画册 HTML 模板')}<br><span class="tiny">${exportLayouts[t.layout]} · ${esc(t.author)} · v${esc(t.version)}</span></p><div class="export-mobile-actions">${btn('自定义此模板','edit','et-open-selected','','small')}${btn('导入模板','upload','et-import','','small')}${featureEnabled('marketplace')?btn('从市场下载','box','et-export-market','','small'):''}</div><div class="divider"></div><div class="grid2">${field('本次主题色',`<input id="export-color" type="color" value="${esc(d.themeColor||t.options.accent)}" aria-label="导出主题色">`)}${field('分镜框线 / px',input('border',d.border,'number','id="export-border" min="0" max="8"'))}</div>${field('创作者签名',input('signature',d.signature,'text','id="export-signature"'))}<label class="row small soft" style="margin-bottom:12px"><input type="checkbox" id="export-captions" ${d.showCaptions?'checked':''}>显示剧情台词</label><label class="row small soft"><input type="checkbox" id="export-prompts" ${d.showPrompts?'checked':''}>附带提示词水印</label>${exportImageProfileControl(d)}<div class="help" style="margin-top:14px">单文件 HTML 使用所选模板；ZIP 提供简洁阅读版与图片文件；PDF 为逐页图片画册。三者都按「图片处理」输出图片；后两者不附带源素材或提示词。</div>${albumEmbeddingControls()}</section><section class="export-hub-preview"><div class="preview-toolbar">${icon('eye','sm')}效果预览 · 首本画册前 3 幕<span class="spacer"></span>${icon('shield','sm')}</div><iframe id="export-preview" sandbox="allow-scripts" referrerpolicy="no-referrer" title="离线画册导出预览"></iframe><div class="preview-toolbar"><span>图片 / 样式 / 翻页脚本全部内联</span></div></section></div><div class="modal-footer"><span id="export-status" class="grow validation-result">按分镜顺序导出；未生成画面显示问号，原图读取失败时停止导出。</span>${portableExportButtons()}${btn('管理模板库','book','et-open-library','','small')}${btn('取消导出','close','export-cancel','hidden','small')}${btn('生成并下载画册','download','compile-export',studioUI.exportBusy?'disabled':'','primary')}</div>`;
  updateExportPreview();
}

function updateExportPreview(){
  const iframe=$('#export-preview');if(!iframe)return;
  try{const d=studioUI.exportDraft,t=exportTemplateBy(d.templateId);iframe.srcdoc=compileTemplateDocument(t,exportPreviewBooks(ui.exportIds[0]),d)}catch(e){const status=$('#export-status');if(status){status.className='grow validation-result error';status.textContent=e.message}}
}

async function compileCustomExport(){
  if(studioUI.exportBusy)return;readExportDraft();
  const d=clone(studioUI.exportDraft),t=clone(exportTemplateBy(d.templateId));validateExportTemplate(t);
  const ids=[...ui.exportIds],controller=new AbortController();studioUI.exportController=controller;studioUI.exportBusy=true;
  const buttons=$$('[data-act="compile-export"],[data-act="presentation-export"]');buttons.forEach(b=>b.disabled=true);
  const cancel=$('[data-act="export-cancel"]');if(cancel)cancel.hidden=false;
  try{const {books,stats}=await prepareExportBooks(ids,t,(done,total,s)=>{const el=$('#export-status');if(el)el.textContent=exportProgressText(done,total,s);},controller.signal,{imageProfile:d.imageProfile});
    if(controller.signal.aborted)throw new DOMException('已取消','AbortError');
    if(ids.some(id=>!bookBy(id)))throw Error('画册已删除，导出已停止。');
    d.effectiveImageProfile=stats.profile;/* shared reference images inside the metadata block follow the frames */
    let html;
    try{
      html=await attachAlbumMetadata(compileTemplateDocument(t,books,d),books,d,controller.signal);
    }catch(e){
      if(e instanceof RangeError||e?.message?.includes('string length'))throw Error('画册体积已超出浏览器单字符串 512 MiB 极限，请使用离线 ZIP 格式分发。');
      throw e;
    }
    await new Promise(resolve=>setTimeout(resolve,0));
    if(controller.signal.aborted)throw new DOMException('已取消','AbortError');
    const destination=await deliverExportHTML(html,t,books);
    const status=$('#export-status');if(status){status.className='grow validation-result ok';status.textContent=(destination?'已保存到 '+destination:'完整画册已下载，可离线打开。')+' '+exportImageSummary(stats)}
    const baseToast=destination?'离线画册已写入「画册 / 导出」文件夹。':stats.profile==='publish'?'离线画册已下载，图片已按轻量发布压缩并清洗元数据。':'离线画册已下载，原图分辨率保留。';
    if(stats.overBudget)toast(`${baseToast}（提示：画册内联体积超过 512 MiB，在部分低内存设备打开可能较慢）`,'warn');
    else toast(baseToast);
  }catch(error){const status=$('#export-status');if(status){status.className='grow validation-result'+(controller.signal.aborted?'':' error');status.textContent=controller.signal.aborted?'导出已取消，原画册未改变。':'导出失败：'+error.message}if(!controller.signal.aborted)throw error}
  finally{studioUI.exportBusy=false;studioUI.exportController=null;buttons.forEach(b=>{if(b.isConnected)b.disabled=false});if(cancel?.isConnected)cancel.hidden=true}
}

async function installExportPackage(id){
  const c=exportMarketCatalog.find(c=>c.id===id),installed=state.installedPackages.find(p=>p.id===id);
  if(!c)return false;
  if(installed){
    if(!await confirmAction('卸载「'+c.title+'」？','将移除该市场包安装的模板。如果你直接编辑过安装模板，请先复制或导出备份。','卸载模板包'))return true;
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

function designedExportHTML(kind){const id=kind==='night'?'export-flip':'export-'+kind;return fileLayout(id).html}

function upgradeExportDesigns(s){return s}

async function deliverExportHTML(html,t,books){
  const filename=safeFolderName(books.length===1?books[0].title:'画册合集')+'_'+safeFolderName(t.title)+'_'+Date.now()+'.html';
  if(!disk.root||disk.phase!=='connected'){download(filename,html,'text/html');return null}
  const saved=await flushDiskSave();if(!saved){download(filename,html,'text/html');toast('目录未能保存，已改为下载 HTML，避免丢失导出结果。','error');return null}
  const base=books.length===1?disk.paths.books[books[0].id]+'/导出':'导出合集',path=base+'/'+filename;
  try{await writeDiskFile(disk.root,path,html);if(books.length===1){const b=bookBy(books[0].id);b.exports||=[];b.exports.push({path,createdAt:Date.now(),templateId:t.id,format:t.layout});save()}return path}
  catch(e){download(filename,html,'text/html');toast('写入导出目录失败，已改为下载文件：'+e.message,'error');return null}
}

async function measureArtwork(src,signal){if(signal?.aborted)throw new DOMException('已取消','AbortError');const image=new Image();image.src=src;await image.decode();if(signal?.aborted)throw new DOMException('已取消','AbortError');return {width:image.naturalWidth,height:image.naturalHeight}}


async function exportPortable(format){
 if(studioUI.exportBusy)return;
 studioUI.exportBusy=true;const status=$('#export-status');
 try{readExportDraft();const imageProfile=exportImageProfile(studioUI.exportDraft?.imageProfile);if(status)status.textContent='正在准备 '+format.toUpperCase()+'；资源包不受 HTML 内联预算限制。';if(!await savePythonWorkspace())throw Error('请先完成保存，再导出。');
 /* C7: the export slot is exclusive; a 409 means another export is still streaming, so back off and retry instead of surfacing it as a failure. */
 let response;for(let attempt=0;attempt<4;attempt++){response=await fetch('/api/export/portable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format,albumIds:ui.exportIds,imageProfile,validateOnly:true})});if(response.status!==409||attempt===3)break;if(status)status.textContent='另一份导出仍在传输，'+(1.5*(attempt+1))+' 秒后自动重试…';await new Promise(r=>setTimeout(r,1500*(attempt+1)))}
 if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||'导出失败')}
 const frame=document.createElement('iframe');frame.name=uid('export');frame.hidden=true;frame.onload=()=>{try{const text=frame.contentDocument.body.textContent;if(text.trim().startsWith('{')){const result=JSON.parse(text);if(result.error){toast(result.error,'error');if(status)status.textContent=result.error}}}catch{}};document.body.append(frame);
 const form=document.createElement('form');form.method='POST';form.action='/api/export/portable';form.target=frame.name;form.hidden=true;for(const [name,value] of Object.entries({format,albumIds:JSON.stringify(ui.exportIds),imageProfile,_csrf:document.querySelector('meta[name="mio-csrf"]')?.content||''})){const input=document.createElement('input');input.name=name;input.value=value;form.append(input)}document.body.append(form);form.submit();form.remove();setTimeout(()=>frame.remove(),600000);
 const treatment=imageProfile==='archive'?'图片原样写入，含内嵌工作流元数据。':imageProfile==='publish'?'图片已按轻量发布压缩并清洗元数据。':'图片保持原分辨率，已清洗工作流元数据。';
 if(status)status.textContent=(format==='zip'?'已交给浏览器下载管理器，准备完成后开始下载。请解压整个资源包，打开 index.html。':'已交给浏览器下载管理器。PDF 为逐页图片，非 JPEG 图片以高质量 JPEG 嵌入。')+treatment;
 setTimeout(()=>{studioUI.exportBusy=false},3000)
 }catch(error){studioUI.exportBusy=false;toast(error.message,'error');if(status)status.textContent=error.message}
}

function portableExportButtons(){return `${btn('ZIP 图片资源包','download','portable-export','data-format="zip"','small')}${btn('PDF 图片画册','download','portable-export','data-format="pdf"','small')}<p class="help">ZIP：简洁阅读版＋图片文件；PDF：逐页图片。两者不受单文件内联预算限制，图片同样按「图片处理」输出。</p>`}
