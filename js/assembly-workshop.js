/* Creative assets and production are separate domains. No generated book edits a source. */
'use strict';
const workshop={renderPending:false,taskPage:0,syncedAlbums:new Map(),openTasks:new Set(),pickedTasks:new Set(),reorderDrag:false,view:'stories',storyId:null,presetId:null,frame:0,queue:{tasks:[],lane:[],batch:[],active:[],paused:true,concurrency:1,maxConcurrency:128,fault:null,uncleanShutdown:false},loading:false,requestId:null,etag:null,serverEpochMs:null,receivedAt:null,selMode:false,pickedFrames:new Set(),frameSearch:'',mobileEditor:false,mobileStepDir:0,mobileField:null,mobileBlurAt:0};

function applyViewportLock() {
  /* The page always flows; the attribute stays for extensions that styled against it. */
  document.documentElement.dataset.viewport = 'flow';
}

const RAIL_SEL = '.workshop-frames-list';

function captureRailScroll() {
  return document.querySelector(RAIL_SEL)?.scrollTop ?? null;
}

function restoreRailScroll(top) {
  if (top == null) return;
  const rail = document.querySelector(RAIL_SEL);
  if (rail) rail.scrollTop = top;
}

function selectWorkshopFrame(index) {
  if (workshopIsMobile()) { openWorkshopMobileEditor(index); return; }
  const railTop = captureRailScroll();
  workshop.frame = Number(index);
  render();
  restoreRailScroll(railTop);
  const editor = document.querySelector('.workshop-editor');
  if (editor) {
    const rect = editor.getBoundingClientRect();
    if (rect.top < 0) {
      editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
  document
    .querySelector(`.workshop-frames [data-index="${CSS.escape(String(index))}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}

function installWorkshopKeys() {
  document.addEventListener('keydown', event => {
    if (ui.workspace !== 1 || workshop.view !== 'stories') return;
    if (document.querySelector('dialog[open]')) return;

    const mod = event.metaKey || event.ctrlKey;
    const story = workshopStory();
    if (!story) return;

    if (mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const next = clamp(
        workshop.frame + (event.key === 'ArrowDown' ? 1 : -1),
        0,
        story.frames.length - 1,
      );
      if (next !== workshop.frame) selectWorkshopFrame(next);
      return;
    }

    if (mod && event.key === 'Enter') {
      event.preventDefault();
      save();
      if (workshop.frame < story.frames.length - 1) {
        selectWorkshopFrame(workshop.frame + 1);
        document.querySelector('[data-workshop-frame="prompt"]')?.focus();
      }
      return;
    }

    if (event.key === 'Escape' && (workshop.selMode || workshop.pickedFrames.size)) {
      workshop.selMode = false;
      workshop.pickedFrames.clear();
      render();
    }
  });
}

async function productionRequest(route,body){if(body!==undefined)workshop.etag=null;const response=await request('/api/production/'+route,body===undefined?{}:post(body));const result=await response.json();if(!response.ok||result.error)throw Error(typeof result.error==='string'?result.error:'生产操作失败');if(body!==undefined)scheduleProductionPoll(1000);if(route==='assemble'||route==='assemble-batch')workshop.taskPage=Infinity;return result.data}
/* B15: poll quickly while anything runs and right after every queue action, so cards never lag 15 s behind the server. */
function scheduleProductionPoll(delay){clearTimeout(workshop.pollTimer);workshop.pollTimer=setTimeout(()=>workshop.poll?.(),delay)}
function productionIsLocal(task){const provider=task?.sources?.provider||(workshop.queue.tasks.length?'':activeImageProfile()?.provider);return provider==='comfyui'}
function workshopStory(){return projectTemplates().find(t=>t.id===workshop.storyId)||projectTemplates()[0]}
function workshopPreset(){return projectVariableSets().find(p=>p.id===workshop.presetId)||projectVariableSets()[0]}
/* Highlight and completion context for the story workshop. A story is not bound to presets, so the context is the union of every
   preset in the collection, remembering where each key comes from: the backend merges presets in assembly order and the later
   preset wins for a repeated key, so `sources` keeps the presets per key in collection order. Computed entries count as set. */
function workshopPromptEntryIsEmpty(entry){if(entry?.compute)return false;const value=entry?.value;if(entry?.type==='image')return !(value&&(typeof value==='string'||value.src));return value===undefined||value===null||value===''}
function workshopPromptContext(story=workshopStory()){
 const sources=new Map(),definitions=new Set(),emptyKeys=new Set(),used=new Map();
 for(const set of projectVariableSets())for(const entry of set.entries||[]){
  if(!entry?.key)continue;definitions.add(entry.key);const list=sources.get(entry.key)||[];
  list.push({presetId:set.id,title:set.title||'',category:set.category||'characters',type:entry.type||'text',label:entry.label||'',value:entry.value,empty:workshopPromptEntryIsEmpty(entry)});sources.set(entry.key,list);
 }
 for(const [key,list] of sources)if(list.every(item=>item.empty))emptyKeys.add(key);
 for(const frame of story?.frames||[])for(const field of ['prompt','negative','caption'])for(const match of String(frame?.[field]||'').matchAll(/\{([\p{L}\p{N}_]+)\}/gu))used.set(match[1],(used.get(match[1])||0)+1);
 return {kind:'workshop',definitions,emptyKeys,sources,used};
}
/* Batch frames and the story's optional opening template (story.basePrompt). The template is plain frame text: it is copied
   into new frames when they are created and never resolved at render time, so a storyboard stays a flat list of frames for
   every consumer (assembly, export, import validation). Older stories simply have no basePrompt. */
function storyBasePrompt(story){return typeof story?.basePrompt==='string'?story.basePrompt:''}
/* The comma-separated segments every existing prompt starts with, e.g. "{character}, {outfit}, {style}, {scene}, ". */
function suggestStoryBasePrompt(story){
 const prompts=(story?.frames||[]).map(frame=>String(frame?.prompt||'').trim()).filter(Boolean);if(prompts.length<2)return '';
 const split=text=>text.split(/,\s*/),first=split(prompts[0]);let common=first.length;
 for(const prompt of prompts.slice(1)){const parts=split(prompt);let i=0;while(i<common&&i<parts.length&&parts[i]===first[i])i++;common=i;if(!common)return ''}
 return first.slice(0,common).join(', ')+', ';
}
function createFramesBatch({count=1,start=0,namePattern='第 {n} 幕',basePrompt='',negative='',template}={}){
 const total=Math.max(0,Math.min(Math.floor(Number(count)||0),512)),make=typeof template==='function'?template:index=>makeFrame(index);
 return Array.from({length:total},(_,offset)=>{const index=start+offset;return {...make(index),id:uid('frame'),name:String(namePattern||'第 {n} 幕').replace(/\{n\}/g,String(index+1)),prompt:String(basePrompt||''),negative:String(negative||''),caption:''}});
}
function batchFramesModal(){
 const story=workshopStory();if(!story)return;const remaining=512-story.frames.length;if(remaining<=0)throw Error('最多 512 幕');
 const remembered=storyBasePrompt(story),base=remembered||suggestStoryBasePrompt(story);
 modal('批量新增分幕',`<div class="batch-frames"><div class="grid2">${field('数量',input('count',Math.min(4,remaining),'number',`id="batch-frames-count" min="1" max="${remaining}" step="1" required autocomplete="off"`))}${field('命名（{n} 为序号）',input('pattern','第 {n} 幕','text','id="batch-frames-pattern" maxlength="60" autocomplete="off"'))}</div><div class="field"><label class="label" for="batch-frames-base">起手模板（可选）</label>${promptEditorHTML({attrs:'id="batch-frames-base" class="workshop-base-prompt"',value:base,placeholder:'例如 {character}, {outfit}, {style}, {scene}, ',context:'workshop'})}<p class="help">${!remembered&&base?'已按现有分幕的共同开头预填。':''}每个新分幕的正向提示词都以它开头；留空则新建空白分幕。</p></div><label class="row"><input type="checkbox" id="batch-frames-remember" ${base?'checked':''}>保存为本故事的起手模板，之后空白分幕可一键插入</label><div class="modal-footer">${btn('取消','','close-modal')}${btn('新增分幕','plus','workshop-add-frames-confirm','','primary')}</div></div>`,localeString('最多还可新增 {n} 幕。',{n:remaining}));
 attachPromptEditors();setTimeout(()=>$('#batch-frames-count')?.focus(),40);
}
function workshopDraft(){const p=workshopPreset();if(!p)return null;workshop.presetId=p.id;const draft=settingPresetDraft(p.id);draft.bindings??=clone(p.bindings||[]);return draft}
/* Library-level actions sit in the page header: importing adds new assets and exporting may pack several, so neither
   belongs to the toolbar of the one asset being edited (that toolbar keeps rename / save / next step). */
function workshopHeaderActions(){
 if(workshop.view==='production')return btn('新建生成任务','plus','assembly-new','','primary');
 const stories=workshop.view==='stories',count=(stories?projectTemplates():projectVariableSets()).length,noun=stories?'分镜':'预设';
 return `<div class="workshop-heading-actions" role="group" aria-label="${noun}库操作">${btn('导入','file-import','workshop-import',`title="导入 ${noun}（.json / .mio.zip，可多选）"`)}${btn('导出…','file-export','workshop-export-pick',`title="选择要导出的${noun}" ${count?'':'disabled'}`)}${btn(stories?'新建分镜':'新建预设','plus','workshop-new','','primary')}</div>`;
}
function workshopHeader(){return `<header class="workshop-heading"><div><span class="context-kicker">创作资产 · 独立保存与复用</span><h1>${{stories:'分镜工坊',presets:'预设工坊',production:'装配与生成'}[workshop.view]}</h1><p>${{stories:'先把故事写好。不绑定角色，也不绑定一本画册。',presets:'让人物、画风与视觉设定，成为可反复使用的资产。',production:'选择故事，搭配预设。准备妥当后，再开始生成。'}[workshop.view]}</p></div>${workshopHeaderActions()}</header><nav class="quiet-tabs workshop-tabs" aria-label="资产与生产">${[['stories','分镜工坊'],['presets','预设工坊'],['production','装配与队列']].map(([id,label])=>`<button data-act="workshop-tab" data-view="${id}" class="${workshop.view===id?'active':''}" ${workshop.view===id?'aria-current="page"':''}>${label}</button>`).join('')}</nav>`}
/* B8: the same five fields mean different things per channel; say so where they are edited. */
function workshopFrameParameterNotice(frame){
 const provider=activeImageProfile()?.provider||'comfyui',on=frame.renderOverride===true;
 const text=provider==='comfyui'
  ?(on?'ComfyUI：已开启覆盖，这些参数会通过工作流映射中的「分镜参数」写入对应节点。':'ComfyUI：默认保持工作流原值。开启下方开关后，这些参数才会写入已映射「分镜参数」的节点。')
  :provider==='novelai'?'NovelAI：宽度、高度、步数、CFG 与种子在生成时直接生效（宽高需为 64 的倍数）。'
  :'OpenAI 兼容：尺寸与质量由图像服务设置决定；Chat 协议会把宽高比写入提示词。步数、CFG、种子不会发送。';
 return `<p class="help workshop-parameter-notice" data-provider="${esc(provider)}">${text}</p>${provider==='comfyui'?`<label class="row workshop-render-override"><span class="switch"><input type="checkbox" role="switch" data-workshop-frame="renderOverride" aria-label="启用此幕渲染规格覆盖" ${on?'checked':''}><span class="switch-track"></span></span><span>启用此幕渲染规格覆盖（写入 ComfyUI 已映射节点）</span></label>`:''}`;
}
/* ---- mobile scene editor ------------------------------------------------------------------------------------------
   On phones the storyboard is a vertical stream of scene cards. Tapping a card slides in a full-screen focus editor that
   lives inside the normal view markup (no dialog stacking): a thin header with「第 N 幕 / 共 M 幕」and large prev / next
   buttons, roomy 16px editors, a variable-chip strip that rides on top of the keyboard, and a thumb-height action bar. The
   layer sizes itself to the visual viewport (see installMobileLayout) so the keyboard never covers the focused field. */
const workshopMobileMedia=typeof matchMedia==='function'?matchMedia('(max-width:760px), (max-width:950px) and (hover:none) and (pointer:coarse)'):{matches:false,addEventListener(){}};
function workshopIsMobile(){return !!workshopMobileMedia.matches}
function workshopFrameSummary(frame){const prompt=String(frame.prompt||'').replace(/\s+/g,' ').trim(),caption=String(frame.caption||'').replace(/\s+/g,' ').trim(),vars=[...prompt.matchAll(/\{([\p{L}\p{N}_]+)\}/gu)].length;return {prompt,caption,vars,empty:!prompt}}
function workshopVariableChips(story){const seen=new Set(),chips=[];const add=(key)=>{if(key&&!seen.has(key)&&chips.length<14){seen.add(key);chips.push(key)}};
 ['character','outfit','style','scene'].forEach(add);for(const set of projectVariableSets())for(const entry of set.entries||[])add(entry?.key);
 for(const frame of story?.frames||[])for(const match of String(frame.prompt||'').matchAll(/\{([\p{L}\p{N}_]+)\}/gu))add(match[1]);
 return chips}
function insertTextAtCaret(field,text){if(!field)return;const start=field.selectionStart??field.value.length,end=field.selectionEnd??start;const before=field.value.slice(0,start);const glue=/^\{/.test(text)&&before&&!/[\s,，(（\n]$/.test(before)?', ':'';
 if(typeof field.setRangeText==='function')field.setRangeText(glue+text,start,end,'end');else field.value=before+glue+text+field.value.slice(end);
 field.dispatchEvent(new Event('input',{bubbles:true}))}
function openWorkshopMobileEditor(index){const story=workshopStory();if(!story?.frames.length)return;const next=clamp(Number(index)||0,0,story.frames.length-1);workshop.mobileStepDir=workshop.mobileEditor?Math.sign(next-workshop.frame):0;workshop.frame=next;workshop.mobileEditor=true;workshop.selMode=false;workshop.pickedFrames.clear();render();
 const layer=document.querySelector('.wm-focus');if(layer&&workshop.mobileStepDir===0)layer.classList.add('is-entering')}
function closeWorkshopMobileEditor(){if(!workshop.mobileEditor)return;const layer=document.querySelector('.wm-focus');workshop.mobileEditor=false;workshop.mobileField=null;
 const finish=()=>{render();document.querySelector(`.wm-card[data-index="${workshop.frame}"]`)?.scrollIntoView({block:'center'})};
 if(layer&&!matchMedia('(prefers-reduced-motion: reduce)').matches){layer.classList.add('is-leaving');setTimeout(finish,170)}else finish()}
function workshopMobileEditorHTML(story){const frame=story.frames[workshop.frame];if(!frame)return '';const total=story.frames.length,index=workshop.frame,last=index===total-1,dir=workshop.mobileStepDir;workshop.mobileStepDir=0;
 const chips=workshopVariableChips(story).map(key=>`<button type="button" class="wm-chip" data-wm-insert="{${esc(key)}}"><span>{${esc(key)}}</span></button>`).join('')+`<button type="button" class="wm-chip is-punct" data-wm-insert=", ">，</button><button type="button" class="wm-chip is-punct" data-wm-insert="\n">↵</button>`;
 return `<div class="wm-focus ${dir>0?'is-step-next':dir<0?'is-step-prev':''}" data-editor-key="${esc(frame.id||story.id)}" role="region" aria-label="分幕编辑">
  <header class="wm-focus-head">
   ${ibtn('arrow-back','workshop-mobile-close','返回分幕列表')}
   <div class="wm-focus-title"><strong>${localeString('第 {n} 幕 / 共 {total} 幕',{n:index+1,total})}</strong><small>${esc(frame.name||'未命名分幕')}</small></div>
   <div class="wm-focus-nav">${ibtn('chevron-left','workshop-mobile-step','上一幕',`data-dir="-1" ${index===0?'disabled':''}`)}${ibtn('chevron-right','workshop-mobile-step','下一幕',`data-dir="1" ${last?'disabled':''}`)}</div>
  </header>
  <div class="wm-focus-body" data-wm-swipe>
   <label class="wm-field"><span class="wm-field-label">分幕名称</span><input data-workshop-frame="name" value="${esc(frame.name)}" placeholder="例如：雨夜重逢" aria-label="分幕名称" enterkeyhint="next"></label>
   <div class="wm-field"><div class="wm-field-head"><span class="wm-field-label">正向提示词</span>${!frame.prompt.trim()&&storyBasePrompt(story)?btn('插入起手模板','plus','workshop-apply-base','','small ghost'):''}</div>${promptEditorHTML({attrs:'data-workshop-frame="prompt" class="workshop-prompt wm-prompt"',value:frame.prompt,placeholder:'描述画面、镜头与人物动作；点下方标签可插入 {变量}。',context:'workshop'})}</div>
   <div class="wm-field"><div class="wm-field-head"><span class="wm-field-label">负向提示词</span>${btn('应用到所有分幕','copy','workshop-negative-all','','small ghost')}</div>${promptEditorHTML({attrs:'aria-label="负向提示词" data-workshop-frame="negative" class="workshop-negative wm-negative"',value:frame.negative||'',placeholder:'排除不需要的内容，也可引用 {画风负向}。',context:'workshop'})}</div>
   <div class="wm-field"><div class="wm-field-head"><span class="wm-field-label">台词 / 旁白</span></div>${promptEditorHTML({attrs:'aria-label="分镜台词" data-workshop-frame="caption" class="workshop-caption wm-caption"',value:frame.caption||'',placeholder:'这一幕的台词或旁白，留空则不显示。',context:'workshop',className:'prose'})}</div>
   <details class="quiet-advanced wm-params"><summary>此幕画面参数</summary>${workshopFrameParameterNotice(frame)}<div class="grid2">${['width','height','steps','cfg','seed'].map(k=>field(({width:'宽度',height:'高度',steps:'步数',cfg:'CFG',seed:'随机种子'})[k],input(k,frame[k],'number',`data-workshop-frame="${k}"`))).join('')}</div></details>
   <div class="wm-focus-spacer" aria-hidden="true"></div>
  </div>
  <div class="wm-chips" role="toolbar" aria-label="快捷变量">${chips}</div>
  <footer class="wm-focus-actions">
   ${btn(last?'新增一幕':'下一幕','check','workshop-mobile-save-next','','primary')}
   ${btn('复制此幕','copy','workshop-copy-frame','','ghost')}
   ${btn('删除','trash','workshop-delete-frame','','ghost danger')}
  </footer>
 </div>`}
function renderStoryWorkshopMobile(stories,story){const allPicked=story.frames.length>0&&story.frames.every((_,i)=>workshop.pickedFrames.has(i));
 const cards=story.frames.map((f,i)=>{const picked=workshop.pickedFrames.has(i),sum=workshopFrameSummary(f);return `<article class="wm-card ${picked?'is-picked':''} ${i===workshop.frame?'is-current':''}" data-act="${workshop.selMode?'workshop-frame-pick':'workshop-mobile-open'}" data-index="${i}" role="button" tabindex="0" aria-label="${esc(localeString('第 {n} 幕',{n:i+1}))} · ${esc(f.name||'未命名分幕')}">
   ${workshop.selMode?`<input type="checkbox" class="sel-cbox" ${picked?'checked':''} aria-label="选择此幕" tabindex="-1">`:`<span class="wm-card-index mono">${pad(i+1)}</span>`}
   <div class="wm-card-body"><header><strong data-user-content>${esc(f.name||'未命名分幕')}</strong>${sum.empty?'<em class="wm-card-flag">缺提示词</em>':sum.vars?`<em class="wm-card-vars">${sum.vars} 变量</em>`:''}</header>
   <p class="wm-card-prompt ${sum.empty?'is-blank':''}" data-user-content>${esc(sum.empty?'轻点填写这一幕的画面描述':sum.prompt)}</p>${sum.caption?`<p class="wm-card-caption" data-user-content>${esc(sum.caption)}</p>`:''}</div>
   ${workshop.selMode?'':icon('arrow','sm')}
  </article>`}).join('');
 return `<div class="workshop-asset-head wm-asset-head"><label>当前分镜<select id="workshop-story-select">${stories.map(t=>opt(t.id,t.title,story.id)).join('')}</select></label>${workshopAutosaveHTML()}<div class="wm-asset-actions">${btn('去装配此分镜','arrow','first-run-assemble-story','','primary')}${btn('重命名','edit','workshop-rename')}</div></div>
  <details class="story-synopsis"><summary>故事梗概 / 起手模板（可选）</summary>${field('作品简介',`<textarea data-workshop-story="outline" class="workshop-outline" placeholder="可选：为作品补充一段简介。">${esc(story.outline||'')}</textarea>`)}<div class="field"><label class="label" for="workshop-base-prompt">起手模板</label>${promptEditorHTML({attrs:'id="workshop-base-prompt" data-workshop-story="basePrompt" class="workshop-base-prompt"',value:storyBasePrompt(story),placeholder:'可选：新分幕的起手提示词，例如 {character}, {outfit}, {style}, {scene}, ',context:'workshop'})}</div></details>
  <section class="wm-stream ${workshop.selMode?'is-selmode':''}" aria-label="分幕列表">
   <header class="wm-stream-head"><div><strong>${localeString('共 {total} 幕',{total:story.frames.length})}</strong><small>轻点卡片进入全屏编辑，左右滑动切换分幕</small></div><div class="wm-stream-tools">${btn('新增分幕','plus','workshop-add-frame','','small')}${btn('批量新增…','copy','workshop-add-frames','','small ghost')}${btn(workshop.selMode?'退出管理':'批量管理','check','workshop-frame-sel-toggle','',workshop.selMode?'small active':'small ghost')}</div></header>
   ${workshop.selMode?`<div class="workshop-frames-selbar">${selectionBarHTML({count:workshop.pickedFrames.size,unit:'幕',allPicked,allAct:'workshop-frame-pick-all',smart:[{label:'选空幕',act:'workshop-frame-pick-empty'}],deleteAct:'workshop-frame-delete-bulk',exitAct:'workshop-frame-sel-toggle'})}</div>`:''}
   <div class="wm-cards">${cards||'<div class="eco-empty"><h3>从第一个镜头开始。</h3></div>'}</div>
  </section>${workshop.mobileEditor?workshopMobileEditorHTML(story):''}`}
function renderStoryWorkshop(){
 const stories=projectTemplates(),story=workshopStory();if(!story)return '<div class="eco-empty"><h3>给故事留一张白纸。</h3><p>新建分镜，或导入可复用的故事。</p>'+btn('导入分镜','file-import','workshop-import')+'</div>';
 workshop.storyId=story.id;workshop.frame=clamp(workshop.frame,0,Math.max(0,story.frames.length-1));const frame=story.frames[workshop.frame];
 if(workshopIsMobile()){if(!story.frames.length)workshop.mobileEditor=false;return renderStoryWorkshopMobile(stories,story)}
 workshop.mobileEditor=false;
 return `<div class="workshop-asset-head"><label>当前分镜<select id="workshop-story-select">${stories.map(t=>opt(t.id,t.title,story.id)).join('')}</select></label>${workshopAutosaveHTML()}<div>${btn('重命名','edit','workshop-rename')}${btn('去装配此分镜','arrow','first-run-assemble-story','','primary')}</div></div><details class="story-synopsis"><summary>故事梗概 / 起手模板（可选）</summary>${field('作品简介',`<textarea data-workshop-story="outline" class="workshop-outline" placeholder="可选：为作品补充一段简介。">${esc(story.outline||'')}</textarea>`)}<div class="field"><label class="label" for="workshop-base-prompt">起手模板</label>${promptEditorHTML({attrs:'id="workshop-base-prompt" data-workshop-story="basePrompt" class="workshop-base-prompt"',value:storyBasePrompt(story),placeholder:'可选：新分幕的起手提示词，例如 {character}, {outfit}, {style}, {scene}, ',context:'workshop'})}<p class="help">批量新增的分幕以它开头；单击「新增分幕」仍是空白分幕。</p></div></details><div class="workshop-editor ${workshop.selMode?'is-selmode':''}"><nav class="workshop-frames" aria-label="分幕列表"><div class="workshop-frames-list ${workshop.pickedFrames.size?'has-selection':''}" aria-multiselectable="true">${story.frames.map((f,i)=>{const picked=workshop.pickedFrames.has(i);return `<button data-act="workshop-frame" data-index="${i}" class="${i===workshop.frame?'active':''} ${picked?'is-picked desktop-selected':''}" aria-selected="${picked}"><small>${pad(i+1)}</small><span>${esc(f.name||'未命名分幕')}</span></button>`}).join('')}</div><p class="workshop-frames-status" role="status" aria-live="polite" ${workshop.pickedFrames.size?'':'hidden'}>${workshop.pickedFrames.size?localeString('已选 {n} 幕 · 右键操作',{n:workshop.pickedFrames.size}):''}</p><div class="workshop-frames-actions">${btn('新增分幕','plus','workshop-add-frame','','small')}${btn('批量新增…','copy','workshop-add-frames','','small')}</div></nav><section class="workshop-page" data-editor-key="${esc(frame?.id||story.id)}">${frame?`<div class="workshop-page-title"><input data-workshop-frame="name" value="${esc(frame.name)}" aria-label="分幕名称">${ibtn('up','workshop-move-frame','分幕前移','data-dir="-1"')}${ibtn('down','workshop-move-frame','分幕后移','data-dir="1"')}${ibtn('copy','workshop-copy-frame','复制分幕')}${ibtn('trash','workshop-delete-frame','删除分幕')}</div><div class="negative-heading prompt-heading"><label for="workshop-frame-prompt">正向提示词</label>${!frame.prompt.trim()&&storyBasePrompt(story)?btn('插入起手模板','plus','workshop-apply-base','','small ghost'):''}</div>${promptEditorHTML({attrs:'id="workshop-frame-prompt" data-workshop-frame="prompt" class="workshop-prompt"',value:frame.prompt,placeholder:'描述画面、镜头与人物动作；使用 {变量} 引用装配时的视觉设定。',context:'workshop'})}<div class="negative-heading"><label>负向提示词</label>${btn('应用到所有分幕','copy','workshop-negative-all','','small ghost')}</div>${promptEditorHTML({attrs:'aria-label="负向提示词" data-workshop-frame="negative" class="workshop-negative"',value:frame.negative||'',placeholder:'排除不需要的内容，也可引用 {画风负向} 或 {角色负向}。',context:'workshop'})}${field('台词 / 旁白',promptEditorHTML({attrs:'aria-label="分镜台词" data-workshop-frame="caption" class="workshop-caption"',value:frame.caption||'',context:'workshop',className:'prose'}))}<details class="quiet-advanced"><summary>此幕画面参数</summary>${workshopFrameParameterNotice(frame)}<div class="grid2">${['width','height','steps','cfg','seed'].map(k=>field(({width:'宽度',height:'高度',steps:'步数',cfg:'CFG',seed:'随机种子'})[k],input(k,frame[k],'number',`data-workshop-frame="${k}"`))).join('')}</div></details>`:'<div class="eco-empty"><h3>从第一个镜头开始。</h3></div>'}</section></div>`;
}
function renderPresetWorkshop(){
 const sets=projectVariableSets(),p=workshopPreset(),draft=workshopDraft();if(!p)return '<div class="eco-empty"><h3>建立你的视觉资产库。</h3><p>人物、画风、场景，可以分别保存为预设。</p>'+btn('导入预设','file-import','workshop-import')+'</div>';
 return `<div class="workshop-asset-head"><label>当前预设<select id="workshop-preset-select">${sets.map(s=>opt(s.id,s.title,p.id)).join('')}</select></label>${workshopAutosaveHTML()}<div>${btn('重命名','edit','workshop-rename')}${btn('独立试绘','brush','workshop-preview')}</div></div><div class="workshop-preset-preview">${workshop.queue.tasks.filter(t=>t.purpose==='preview'&&t.previewPresetId===p.id&&t.pages[0]?.result?.image).slice(-3).map(t=>{const a=productionTaskAccess(t,workshop.queue);return `<figure class="workshop-preview-figure" data-production-task="${esc(t.id)}">${imgTag(t.pages[0].result.image,'预设试绘')}<figcaption>${esc(t.title)}</figcaption>${ibtn('trash','workshop-preview-remove',a.canRemove?'删除这张试绘':'试绘任务正在运行或排队中，请先停止它。',`data-id="${esc(t.id)}" ${a.canRemove?'':'disabled'}`)}</figure>`}).join('')}${draft.variables.filter(e=>e.type==='image'&&e.value?.src).map(e=>`<figure>${imgTag(e.value.src,settingLabel(e))}<figcaption>${esc(settingLabel(e))}</figcaption></figure>`).join('')}</div><div class="settings-form-toolbar"><div class="settings-toolbar-label">变量 <span>${draft.variables.length}</span></div><div class="settings-toolbar-actions">${btn('新增变量','plus','art-setting-add')}${btn('新建分组','plus','settings-group-new',`data-owner="${esc(draft.id)}"`)}${btn('编辑分组','edit','settings-group-edit',`data-owner="${esc(draft.id)}"`)}</div></div>${renderSettingsGroups(draft)}<details class="quiet-advanced"><summary>LoRA / 节点输入绑定</summary><div class="row wrap" style="margin:20px 0">${btn('添加节点绑定','plus','workshop-binding-new')}</div>${draft.bindings.map((b,i)=>`<div class="settings-row"><div class="grow"><strong>${esc(b.nodeId)} · ${esc(b.path)}</strong><p>${esc(b.source)} → ${esc(b.value??'')} · ${esc(b.type||'auto')}</p></div>${ibtn('edit','workshop-binding-new','编辑绑定',`data-index="${i}"`)}${ibtn('trash','workshop-binding-delete','删除绑定',`data-index="${i}"`)}</div>`).join('')}<p class="help">按需将变量连接到工作流节点。未配置时保留工作流原值；同一输入不能重复启用。</p></details>`;
}
function productionStatus(value){return ({standby:'待命',ready:'排队待命',preparing:'前置准备',running:'生成中',complete:'完成',partial:'部分完成',failed:'异常',cancelled:'已取消',interrupted:'中断待核对',uncertain:'结果未确认'})[value]||value}
const PRODUCTION_PAGE_SIZE=6;
/* The queue payload is normalised once so every renderer can rely on the same shape: `active` and `lane` are arrays
   (older fixtures still send a single `active` id and a `batch`), tasks carry `running` / `queued` / `paused` flags,
   and the page-concurrency defaults are numbers. Nothing here invents state the server did not report. */
function normalizeProductionQueue(raw){
 const q=raw&&typeof raw==='object'?raw:{},tasks=Array.isArray(q.tasks)?q.tasks:[];
 const active=Array.isArray(q.active)?q.active.filter(Boolean):q.active?[q.active]:[];
 const lane=(Array.isArray(q.lane)?q.lane:Array.isArray(q.batch)?q.batch:[]).filter(id=>!active.includes(id));
 const concurrency=Number.isInteger(q.concurrency)&&q.concurrency>0?q.concurrency:1,maxConcurrency=Number.isInteger(q.maxConcurrency)&&q.maxConcurrency>0?q.maxConcurrency:128;
 return {...q,tasks:tasks.map(t=>{const running=active.includes(t.id)||t.running===true,queued=!running&&(lane.includes(t.id)||t.queued===true);const own=Number.isInteger(t.concurrency)&&t.concurrency>0?t.concurrency:null;return {...t,pages:Array.isArray(t.pages)?t.pages:[],sources:t.sources||{story:'',presets:[],channel:'',provider:''},running,queued,paused:!!t.paused,concurrency:own,effectiveConcurrency:Number.isInteger(t.effectiveConcurrency)?t.effectiveConcurrency:(own||concurrency),queuePosition:queued?(lane.indexOf(t.id)+1||t.queuePosition||null):null}}),active,lane,batch:[...active,...lane],paused:!!q.paused,concurrency,maxConcurrency,liveSync:q.liveSync&&typeof q.liveSync==='object'?{story:q.liveSync.story===true,presets:q.liveSync.presets===true,workflow:q.liveSync.workflow===true}:undefined,fault:q.fault||null,uncleanShutdown:!!q.uncleanShutdown};
}
function adoptProductionQueue(raw){workshop.queue=normalizeProductionQueue(raw);const ids=new Set(workshop.queue.tasks.map(t=>t.id));for(const id of workshop.pickedTasks)if(!ids.has(id))workshop.pickedTasks.delete(id);return workshop.queue}
function productionTask(id){return workshop.queue.tasks.find(t=>t.id===id)}
/* Task cards are paged in queue order; taskPage=Infinity means "the newest page". */
function productionPaging(total){const pages=Math.max(1,Math.ceil(total/PRODUCTION_PAGE_SIZE)),index=Math.min(pages-1,Math.max(0,Number.isFinite(workshop.taskPage)?workshop.taskPage:pages-1));workshop.taskPage=index;return {index,pages,start:index*PRODUCTION_PAGE_SIZE,end:Math.min(total,(index+1)*PRODUCTION_PAGE_SIZE)}}
function productionPageNumbers(index,pages){if(pages<=7)return Array.from({length:pages},(_,i)=>i);const wanted=new Set([0,pages-1,index-1,index,index+1]);if(index<3)[1,2,3].forEach(i=>wanted.add(i));if(index>pages-4)[pages-4,pages-3,pages-2].forEach(i=>wanted.add(i));const list=[...wanted].filter(i=>i>=0&&i<pages).sort((a,b)=>a-b);return list.flatMap((i,k)=>k&&i-list[k-1]>1?[null,i]:[i])}
function renderProductionPager(paging,total){if(paging.pages<=1)return '';const label=localeString('第 {current} / {total} 页',{current:paging.index+1,total:paging.pages});return `<nav class="production-pager" aria-label="${esc(label)}">${btn('上一页','arrow-back','production-page',`data-page="${paging.index-1}" ${paging.index===0?'disabled':''}`,'ghost small')}<div class="production-pager-numbers">${productionPageNumbers(paging.index,paging.pages).map(i=>i===null?'<span class="production-pager-gap">…</span>':`<button type="button" class="production-pager-number${i===paging.index?' active':''}" data-act="production-page" data-page="${i}" ${i===paging.index?'aria-current="page"':''}>${i+1}</button>`).join('')}</div>${btn('下一页','arrow','production-page',`data-page="${paging.index+1}" ${paging.index===paging.pages-1?'disabled':''}`,'ghost small')}<span class="production-pager-summary">${esc(label)} · ${paging.end-paging.start>1?paging.start+1+'–'+paging.end:paging.end} / ${total}</span></nav>`}
function productionStrip(t){return `<div class="production-strip${(t.pages||[]).length>48?' dense':''}" aria-hidden="true">${(t.pages||[]).map(p=>`<i class="seg-${esc(p.state)}"></i>`).join('')}</div>`}
/* Attempts/results survive retries and cancellation; state alone does not identify a first run. */
function productionPageHasRun(p){return !!(p.result||p.attemptCount>0||p.attempts?.length||['running','complete','failed','uncertain'].includes(p.state))}
function productionPageLabels(t,p){
 const rerun=productionPageHasRun(p),tailRerun=(t.pages||[]).some(next=>next.index>=p.index&&productionPageHasRun(next));
 return {single:rerun?'单幕重跑':'单幕生成',icon:rerun?'refresh':'play',tail:tailRerun?'从此幕往后重跑':'从此幕往后生成'};
}
function previewProductionPage(d){
 const task=productionTask(d.id),page=task?.pages?.find(p=>p.index===Number(d.index));
 if(!page?.result?.image){toast('此幕暂无可查看的图片');return}
 const title=localeString('第 {n} 幕',{n:page.index+1});
 modal(task.title+' · '+title,imgTag(page.result.image,title,'class="production-page-full-image"'),'',true);
}
/* The scene row's body is the editor entry: one click opens this scene's prompt as the task holds it (no extra button).
   A scene with the provider right now is shown but not clickable; the server refuses that edit too. */
function productionPageBodyHTML(t,p,last){
 const frame=p.frame&&typeof p.frame==='object'?p.frame:null,name=frame?.name||'',excerpt=frame?.prompt||'',busy=p.state==='running';
 const status=`<span class="production-page-status"><strong class="page-${esc(p.state)}">${productionStatus(p.state)}</strong><small>${p.attemptCount} 次尝试${last?.upstream?' · 上游任务 '+esc(last.upstream):''}${p.result&&p.state!=='complete'?' · 原图已保留':''}</small></span>`;
 const excerptHTML=`<span class="production-page-excerpt">${name?`<b>${esc(name)}</b>`:''}<span class="production-page-prompt">${esc(frame?(excerpt||'（这一幕还没有提示词）'):'点击查看并编辑这一幕的提示词')}</span>${icon('edit','sm')}</span>`;
 return `<button type="button" class="production-page-body" data-act="production-page-edit" data-id="${esc(t.id)}" data-index="${p.index}" ${busy?'disabled':''} title="${esc(busy?'这一幕正在生成中，结束后再编辑':'点击编辑这一幕的提示词；可覆写保存回源分镜')}" aria-label="${esc(localeString('编辑第 {n} 幕提示词',{n:p.index+1}))}">${status}${excerptHTML}</button>`;
}
function renderProductionPage(t,p,a=productionTaskAccess(t)){const labels=productionPageLabels(t,p),last=p.attempts.at(-1),lock=a.reason?`disabled title="${esc(a.reason)}"`:'';return `<div class="production-page" data-page-index="${p.index}"><div class="production-page-number">${pad(p.index+1)}</div>${p.result?.image?`<button type="button" class="production-page-preview" data-act="production-page-preview" data-id="${esc(t.id)}" data-index="${p.index}" aria-label="${esc(localeString('查看第 {n} 幕图片',{n:p.index+1}))}" title="${esc(localeString('查看图片'))}">${imgTag(thumbnailURL(p.result.image),'第 '+(p.index+1)+' 幕','loading="lazy"')}</button>`:'<span class="production-page-blank"></span>'}<div class="grow production-page-main">${productionPageBodyHTML(t,p,last)}${last?.error?`<p>${esc(last.error)}</p>`:''}${last?.notices?.length?`<details class="production-slot-notices"><summary>本次写入与跳过原因</summary>${last.notices.map(n=>`<p>${esc(n)}</p>`).join('')}</details>`:''}</div><div>${p.state!=='complete'&&p.attempts.at(-1)?.phase==='publish'?btn('恢复已生成结果','disk','production-recover',`data-id="${esc(t.id)}" data-index="${p.index}" ${a.canRecover?'':'disabled title="请先停止这本画册。"'}`,'small'):''}${btn(labels.single,labels.icon,'production-rerun',`data-id="${esc(t.id)}" data-index="${p.index}" ${a.canRerun?'':lock}`,'small')}${btn(labels.tail,'list','production-rerun-tail',`data-id="${esc(t.id)}" data-index="${p.index}" ${a.canRerun?'':lock}`,'small ghost')}</div></div>`}
function productionOverridesSummary(o){
 if(!o||typeof o!=='object')return '';const parts=[];
 const models=typeof o.model==='string'?[['',o.model]]:Object.entries(o.model||{});
 for(const [key,name] of models)if(name)parts.push(`<span title="${esc(key?key+' → '+name:name)}"><i>模型${key?' #'+esc(key):''}</i>${esc(WorkflowSlots.loraStem(name))}</span>`);
 if(Array.isArray(o.loras))parts.push(o.loras.length?o.loras.filter(l=>l?.name).map(l=>`<span title="${esc(l.name)}"><i>追加 LoRA</i>${esc(WorkflowSlots.loraStem(l.name))}<b>×${esc(WorkflowSlots.numberText(l.strength??1))}</b></span>`).join(''):'<span><i>LoRA</i>无用户追加</span>');
  if(o.unpin?.length){
    const loraKeys=new Set((o.loras||[]).filter(l=>l?.name).map(l=>WorkflowSlots.loraStem(l.name).toLowerCase()));
    const unpinOnly=o.unpin.filter(n=>typeof n==='string'&&!loraKeys.has(WorkflowSlots.loraStem(n).toLowerCase()));
    if(unpinOnly.length)parts.push(`<span><i>解锁移除</i>${unpinOnly.map(n=>esc(WorkflowSlots.loraStem(n))).join('、')}</span>`);
  }
 return parts.length?`<p class="production-overrides">${parts.join('')}</p>`:'';
}
/* What one task card may do right now. Every book is independent: another book running never locks this one.
   `q` may be a fixture without `active` / `lane` arrays, so the flags are derived defensively. */
function productionTaskAccess(t,q=workshop.queue){
  const activeIds=Array.isArray(q.active)?q.active:q.active?[q.active]:[],lane=Array.isArray(q.lane)?q.lane:Array.isArray(q.batch)?q.batch:[];
  const running=activeIds.includes(t.id)||t.running===true,queued=!running&&(lane.includes(t.id)||t.queued===true),paused=!!t.paused,busy=running||queued;
  const complete=t.status==='complete',position=queued?(lane.indexOf(t.id)+1||t.queuePosition||null):null;
  const reason=running?(paused?'此任务已暂停：可继续生成，或停止它。':'此任务正在生成中。'):queued?'此任务正在排队等待顺次生成；可先将它移出队列。':'';
  return {running,queued,paused,busy,position,reason,
    canStart:!busy&&!complete,startReason:busy?reason:(complete?'已全部完成；可在分幕进度中重跑单幕。':''),
    canRerun:!busy,canQueue:!busy&&!complete,
    canPause:running&&!paused,canResume:running&&paused,canStop:busy,
    canClone:true,canRemove:!busy,removeReason:busy?'任务正在运行或排队中，请先停止它。':'',
    canRecover:!busy};
}
function productionCollectionMeta(projectId){if(!projectId||projectId===state.activeProjectId)return '';const project=state.projects.find(p=>p.id===projectId);return `<span class="production-collection" title="生成的画册会归入这个画册集，而不是当前浏览的画册集">画册集 · ${esc(project?.title||'已删除的画册集')}</span>`}
function productionConcurrencyField(t,q=workshop.queue){const max=q.maxConcurrency||128,hint=localeString('分幕并发：这本画册同时生成的分幕数。留空跟随全局默认（{n}）；运行中修改，下一幕开始生效。',{n:q.concurrency||1});return `<label class="production-concurrency" title="${esc(hint)}"><span>并发</span><input type="number" inputmode="numeric" min="1" max="${max}" step="1" value="${t.concurrency??''}" placeholder="${esc(localeString('全局 {n}',{n:q.concurrency||1}))}" data-production-concurrency="${esc(t.id)}" aria-label="${esc(localeString('「{title}」的分幕并发',{title:t.title}))}"></label>`}
/* A failed task says what went wrong, why in one line, and offers the one or two things that fix it;
   the raw record stays one click away. task.error = "<n>/<total> 幕失败：<类别>：<说明>" plus optional extra lines. */
function productionErrorParts(text){
 const [first='',...rest]=String(text||'').split('\n');let count='',body=first,title='';
 const counted=first.match(/^(\d+\/\d+ 幕失败)：([\s\S]*)$/);if(counted){count=counted[1];body=counted[2]}
 const kind=body.match(/^([^：。]{2,18})：([\s\S]+)$/);if(kind){title=kind[1];body=kind[2]}
 return {count,title:title||'生成失败',reason:body,tail:rest.map(s=>s.trim()).filter(Boolean)};
}
function productionErrorKind(text){
 const s=String(text||'');
 if(/连接被拒绝|找不到服务器|网络不通|连接超时|安全连接失败|连接在发送请求时中断|无法读取 ComfyUI/.test(s))return 'connection';
 if(/拒绝了密钥|余额或额度不足|服务拒绝访问|API 密钥/.test(s))return 'credentials';
 if(/工作流节点|缺少模型文件|种子节点|所选工作流/.test(s))return 'workflow';
 if(/内容安全审核/.test(s))return 'moderation';
 return 'other';
}
function productionErrorHTML(t){
 const parts=productionErrorParts(t.error),kind=productionErrorKind(t.error),id=esc(t.id),comfy=(t.sources?.provider||'comfyui')==='comfyui';
 const actions={
  connection:[comfy?btn('测试连接','refresh','production-test-connection','','small'):'',btn('图像服务设置','settings','image-provider-settings','','small ghost')],
  credentials:[btn('图像服务设置','settings','image-provider-settings','','small')],
  workflow:[btn('打开工作流','nodes','image-provider-settings','','small')],
  moderation:[btn('查看分幕','list','production-toggle-pages',`data-id="${id}"`,'small')],
  other:[]
 }[kind];
 return `<div class="production-error-panel" role="alert" data-error-kind="${kind}"><p class="production-error-head"><strong>${esc(parts.title)}</strong>${parts.count?`<span>${esc(parts.count)}</span>`:''}</p><p class="production-error">${esc(parts.reason)}</p>${parts.tail.map(line=>`<p class="production-error-tail">${esc(line)}</p>`).join('')}<div class="production-error-actions">${actions.join('')}${btn('技术详情','help','production-details',`data-id="${id}"`,'small ghost')}</div></div>`;
}
function renderProductionCard(t,q=workshop.queue){
 const pages=t.pages||[],src=t.sources||{},done=pages.filter(p=>p.state==='complete').length,a=productionTaskAccess(t,q),id=esc(t.id),picked=workshop.pickedTasks.has(t.id);
 const badges=[a.queued?`<span class="production-flag flag-queued">${esc(a.position?localeString('排队 · 第 {n} 位',{n:a.position}):'排队中')}</span>`:'',a.paused&&a.busy?'<span class="production-flag flag-paused">已暂停</span>':''].join('');
 const primary=a.running?(a.paused?btn('继续生成','play','production-resume',`data-id="${id}" title="只继续这本画册的后续分幕"`,'primary'):btn('暂停','pause','production-pause',`data-id="${id}" title="只暂停这本画册：已发出的分幕会返回，之后不再派发新分幕"`))+btn('停止','stop','production-cancel',`data-id="${id}" title="停止这本画册的后续分幕；已生成的图片保留"`,'ghost')
  :a.queued?btn('移出队列','close','production-cancel',`data-id="${id}" title="不再顺次生成这本画册；已生成的图片保留"`)
  :btn('开始生成','play','production-start',`data-id="${id}" ${a.canStart?'':`disabled title="${esc(a.startReason)}"`}`,'primary');
 return `<article class="production-card${a.running?' is-running':''}${a.queued?' is-queued':''}${a.paused&&a.busy?' is-held':''}${picked?' desktop-selected is-picked':''}" data-production-task="${id}" aria-selected="${picked}"><header><div class="production-card-title"><span class="production-grip" aria-hidden="true" title="拖动调整顺序">⠿</span><span class="production-state state-${esc(t.status)}">${productionStatus(t.status)}</span>${badges}<h2>${esc(t.title)}</h2><button type="button" class="ibtn production-rename" data-act="production-rename" data-id="${id}" title="${esc(localeString('重命名任务'))}" aria-label="${esc(localeString('重命名任务「{title}」',{title:t.title}))}">${icon('edit','sm')}</button></div><div class="production-count"><b>${done}</b><span>/ ${pages.length} 幕</span></div></header><p class="production-meta"><span>分镜 · ${esc(src.story||'')}</span><span>预设 · ${esc((src.presets||[]).join(' + ')||'未选预设')}</span><span>图像服务 · ${esc(src.channel||'')}</span>${productionCollectionMeta(src.projectId)}</p>${productionOverridesSummary(src.overrides)}${productionStrip(t)}${t.rateLimit?`<p class="production-rate" role="status" data-rate-task="${id}">服务限流，等待 ${productionRetrySeconds(t.rateLimit)} 秒后重试；不计入连续故障。</p>`:''}${t.cancelReport?`<p class="production-error">${esc(t.cancelReport.message||(t.cancelReport.state==='cancel_dispatched'?'ComfyUI 已接受本任务的定向取消请求。':'ComfyUI 本任务已结束或不在队列中。'))}</p>`:''}${t.error?productionErrorHTML(t):''}${(t.notices||[]).map(n=>`<p class="production-notice" role="status">${esc(n)}</p>`).join('')}<div class="production-card-actions">${primary}${btn('克隆','copy','production-clone-adjust',`data-id="${id}" title="克隆并微调分镜提示词、参数与并发，得到一个新的待命生成任务"`,'ghost small')}${btn(t.purpose==='preview'?'查看试绘':'查看画册','book',t.purpose==='preview'?'production-preview':'production-read',`data-id="${esc(t.albumId)}" ${!pages.some(p=>p.result)?'disabled':''}`,'ghost small')}${productionConcurrencyField(t,q)}${btn('移除','trash','production-remove',`data-id="${id}" ${a.canRemove?'':`disabled title="${esc(a.removeReason)}"`}`,'ghost small production-remove')}</div><details class="production-pages" data-task-details="${id}" ${workshop.openTasks.has(t.id)?'open':''}><summary>展开分幕进度与局部重跑</summary><div class="production-page-list">${pages.map(p=>renderProductionPage(t,p,a)).join('')}</div></details></article>`;
}
/* Queue-wide state for the toolbar and the global context menu. A hold is anything「继续生成」would release:
   a book paused on its own, or the sequential lane being held while books wait in it. */
function productionQueueControls(q=workshop.queue){
 const tasks=q.tasks||[],active=Array.isArray(q.active)?q.active:q.active?[q.active]:[],lane=Array.isArray(q.lane)?q.lane:Array.isArray(q.batch)?q.batch:[];
 const running=tasks.filter(t=>active.includes(t.id)||t.running),queued=tasks.filter(t=>!active.includes(t.id)&&(lane.includes(t.id)||t.queued));
 const heldBooks=running.filter(t=>t.paused),held=heldBooks.length>0||(queued.length>0&&!!q.paused);
 const pending=running.length+queued.length>0,sequence=tasks.filter(t=>!t.running&&!t.queued&&t.status!=='complete');
 const finished=tasks.filter(t=>t.status==='complete'&&!t.running&&!t.queued);
 return {running:running.length,queued:queued.length,heldBooks:heldBooks.length,held,pending,
  canPause:running.some(t=>!t.paused)||(queued.length>0&&!q.paused),canResume:held,canCancel:pending,
  canSequence:sequence.length>0,sequenceCount:sequence.length,canClear:finished.length>0,finishedCount:finished.length};
}
function productionHeadline(c,q=workshop.queue){
 const parts=[];if(c.running)parts.push(localeString('{n} 本生成中',{n:c.running}));if(c.queued)parts.push(localeString('{n} 本排队中',{n:c.queued}));if(c.heldBooks)parts.push(localeString('{n} 本已暂停',{n:c.heldBooks}));
 const title=!c.pending?'等待你的安排':c.held&&!c.running?'队列已暂停':c.running>1?localeString('正在同时生成 {n} 本画册',{n:c.running}):c.running?'正在生成一本画册':'队列待命';
 const liveKinds=PRODUCTION_LIVE_SYNC_ROWS.filter(([key])=>q.liveSync?.[key]).map(([,title])=>title.replace('实时读取',''));
 const detail=(parts.length?parts.join(' · ')+(q.paused&&c.queued&&!c.running?' · 顺次队列已暂停':''):localeString('{n} 个生成任务 · 默认每本画册 {c} 幕并行',{n:(q.tasks||[]).length,c:q.concurrency||1}))+(liveKinds.length?' · '+localeString('实时读取：{kinds}',{kinds:liveKinds.join(' / ')}):'');
 return {title,detail};
}
function renderProductionWorkshop(){
 const q=workshop.queue,tasks=q.tasks||[],paging=productionPaging(tasks.length),c=productionQueueControls(q),head=productionHeadline(c,q),picked=workshop.pickedTasks.size;
 const disabled=(ok,why)=>ok?'':`disabled title="${esc(why)}"`;
 return `<div class="production-controls"><div><strong>${esc(head.title)}</strong><small>${esc(head.detail)}</small></div><div class="production-toolbar">${btn('按顺序开始生成','list','production-sequence',disabled(c.canSequence,'没有可以顺次生成的任务：请先装配'))}${btn('全局暂停','pause','production-pause',disabled(c.canPause,'没有正在运行或排队的任务'),'ghost')}${btn('继续生成','play','production-resume',disabled(c.canResume,'没有暂停中的任务'),'ghost')}${btn('停止全部','stop','production-cancel',disabled(c.canCancel,'没有进行中的任务'),'danger')}${btn('清空已完成','broom','production-clear-finished',disabled(c.canClear,'没有已完成的任务记录'),'ghost')}<label class="production-concurrency production-concurrency-global" title="${esc('全局默认分幕并发：每本画册同时生成的分幕数（未单独设置的任务跟随它）。修改后从下一幕开始生效。')}"><span>默认并发</span><input type="number" inputmode="numeric" min="1" max="${q.maxConcurrency||128}" step="1" value="${q.concurrency||1}" data-production-concurrency="*" aria-label="全局默认分幕并发"></label></div></div>${q.fault?`<div class="eco-safety danger">存储异常：${esc(q.fault)}。已阻止后续调度，请检查磁盘后重启。</div>`:''}<p class="production-selection-status" role="status" aria-live="polite" ${picked?'':'hidden'}>${picked?localeString('已选 {n} 个生成任务 · 右键批量操作，Esc 取消',{n:picked}):''}</p><div class="production-cards ${picked?'has-selection':''}" aria-multiselectable="true">${tasks.slice(paging.start,paging.end).map(t=>renderProductionCard(t,q)).join('')||'<div class="eco-empty"><h3>先装配，再生成。</h3></div>'}</div>${renderProductionPager(paging,tasks.length)}`;
}
function renderAssemblyWorkshop(){return `<div class="assembly-workshop">${workshopHeader()}${workshop.view==='stories'?renderStoryWorkshop():workshop.view==='presets'?renderPresetWorkshop():renderProductionWorkshop()}</div>`}
/* Live album sync (B16): every page the queue publishes is folded into the open shelf and reader as soon as the
   task list reports it — no full workspace reload, no need to press 查看画册, and the reader keeps its position. */
const ALBUM_SETTLED=new Set(['complete','partial','failed','cancelled','interrupted']);
function albumSyncSignature(t){return t.status+'|'+(t.pages||[]).filter(Boolean).map(p=>(p.index??'') + ':' + (p.result?.image||'')).join(',')}
async function syncProducedAlbums(){
 const library=ComfyComic.fileLibrary;if(!library?.refreshAlbum||!ComfyComic.sync?.runtime?.loaded||workshop.albumSyncBusy)return;
 if(workshop.albumSyncRetryAt&&Date.now()<workshop.albumSyncRetryAt)return;
 const tasks=workshop.queue.tasks.filter(t=>t.purpose!=='preview'&&t.albumId);
 if(!workshop.albumSyncSeeded){for(const t of tasks)if(ALBUM_SETTLED.has(t.status))workshop.syncedAlbums.set(t.id,albumSyncSignature(t));workshop.albumSyncSeeded=true}
 const due=tasks.filter(t=>(t.pages||[]).some(p=>p?.result)&&workshop.syncedAlbums.get(t.id)!==albumSyncSignature(t));
 if(!due.length)return;workshop.albumSyncBusy=true;
 try{for(const t of due){const signature=albumSyncSignature(t);const report=await library.refreshAlbum(t.albumId);workshop.syncedAlbums.set(t.id,signature);applyAlbumRefresh(report)}workshop.albumSyncRetryAt=0}
 catch(error){workshop.albumSyncRetryAt=Date.now()+8000;console.warn('画册实时同步暂时失败，稍后重试：',error)}
 finally{workshop.albumSyncBusy=false}
}
function applyAlbumRefresh(report){
 const book=report?.book;if(!book||report.status==='unchanged'||report.status==='missing')return;
 if(report.status==='created')toast(`画册「${book.title}」已加入画册集，页面会随生成实时更新`);
 if($('#reader').open&&ui.bookId===book.id){refreshArtReaderPages(book,report.changed,report.structure);return}
 if(ui.workspace===0&&!$('#reader').open)refreshGallery();
}
async function refreshProduction(){
 if(workshop.loading)return;workshop.loading=true;
 try{
  const response=await request('/api/production/tasks',{headers:workshop.etag?{'If-None-Match':workshop.etag}:{}});
  let changed=false;
  if(response.status!==304){const result=await response.json();if(result.error)throw Error(result.error);const raw=result.data;workshop.serverEpochMs=raw.serverEpochMs;workshop.receivedAt=performance.now();delete raw.serverEpochMs;const next=normalizeProductionQueue(raw);changed=!nativeEqual(next,workshop.queue);adoptProductionQueue(next);workshop.etag=response.headers.get('ETag')}
  await syncProducedAlbums();
  workshop.renderPending=workshop.renderPending||changed;
  if(workshop.renderPending&&ui.workspace===1&&workshop.view==='production'&&!$('#modal').open&&!productionGestureActive()){render();workshop.renderPending=false}
 }finally{workshop.loading=false}
}
function productionRetrySeconds(rate){
 const now=workshop.serverEpochMs==null?Date.now():workshop.serverEpochMs+(performance.now()-workshop.receivedAt);
 return Math.max(0,Math.ceil(((rate.untilEpochMs??rate.until*1000)-now)/1000));
}

function showAssemblyDialog(){return openAssemblyDesigner()}
async function saveWorkshop(){
 if(workshop.view==='presets'&&workshopPreset()){if($('[data-workshop-preset=bindings]')?.validationMessage)throw Error('LoRA 绑定 JSON 无效，请先修正');commitWorkshopPresetDraft()}
 if(workshop.view==='stories'&&workshopStory())delete workshopStory().ownerPlanId;
 save();if(!await savePythonWorkspace())throw Error('保存尚未确认，请检查冲突或服务状态');refreshSettingsSaveStatus();
}
/* T2 / C5: storyboards and presets save themselves. Preset edits live in a draft (so a half-typed JSON never reaches a
   shared preset); the draft is committed a moment after the last edit instead of waiting for a save button. */
function workshopAutosaveHTML(){return '<span class="workshop-autosave" data-autosave-status></span>'}
function commitWorkshopPresetDraft(){
 clearTimeout(workshop.presetCommitTimer);workshop.presetCommitTimer=null;
 const p=workshopPreset(),d=p&&settingPresetDraft(p.id,false);if(!d?.dirty)return false;
 if($('[data-workshop-preset=bindings]')?.validationMessage){workshop.presetCommitBlocked=true;refreshSettingsSaveStatus();return false}
 workshop.presetCommitBlocked=false;commitSettingsGroupNames(d);
 p.entries=clone(mergedSettingEntries(d));p.settingsGroups=clone(d.settingsGroups);delete p.negative;p.bindings=clone(d.bindings);d.base=presetContentSignature(p);d.dirty=false;
 save();return true}
function scheduleWorkshopPresetCommit(){
 if(ui.workspace!==1||workshop.view!=='presets')return;const p=workshopPreset(),d=p&&settingPresetDraft(p.id,false);if(!d?.dirty)return;
 clearTimeout(workshop.presetCommitTimer);workshop.presetCommitTimer=setTimeout(commitWorkshopPresetDraft,500)}
/* ---- library import / export ------------------------------------------------------------------------------------
   Import takes any number of .json documents, .mio.zip resource packages or a bundle of packages produced by
   「导出…」; every item is inspected first and imported as a NEW asset (never overwriting). Export packs one asset as
   <title>.mio.zip, or several as one .zip that contains one .mio.zip per asset. */
const WORKSHOP_IMPORT_LIMIT=64;
async function workshopImportEntries(files){
 const entries=[];
 for(const file of files){
  const name=String(file.name||'资产');
  if(/\.zip$/i.test(name)){
   const bytes=new Uint8Array(await file.arrayBuffer()),inner=await workshopZipEntries(bytes).catch(()=>null);
   const packages=inner?inner.filter(e=>/\.mio\.zip$/i.test(e.name)):[];
   if(packages.length&&!inner.some(e=>e.name==='manifest.json'))for(const p of packages)entries.push({name:p.name,zip:p.bytes});
   else entries.push({name,zip:bytes});
  }else entries.push({name,text:await file.text()});
  if(entries.length>WORKSHOP_IMPORT_LIMIT)throw Error('一次最多导入 '+WORKSHOP_IMPORT_LIMIT+' 份资产');
 }
 return entries;
}
function workshopBase64(bytes){let out='';for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(out)}
/* Read a STORED/DEFLATE zip in the browser (only used to open a bundle of .mio.zip packages). */
async function workshopZipEntries(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){eocd=p;break}
 if(eocd<0)throw Error('ZIP 目录损坏');
 const count=v.getUint16(eocd+10,true);let p=v.getUint32(eocd+16,true);const entries=[];
 for(let i=0;i<count;i++){
  if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw Error('ZIP 结构无效');
  const method=v.getUint16(p+10,true),size=v.getUint32(p+20,true),nl=v.getUint16(p+28,true),xl=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),off=v.getUint32(p+42,true),name=new TextDecoder().decode(bytes.slice(p+46,p+46+nl));
  const start=off+30+v.getUint16(off+26,true)+v.getUint16(off+28,true);let data=bytes.slice(start,start+size);
  if(method===8){if(!globalThis.DecompressionStream)throw Error('此浏览器不支持解压 ZIP');data=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())}
  else if(method!==0)throw Error('不支持的 ZIP 压缩方式');
  if(!name.endsWith('/'))entries.push({name:name.split('/').pop(),bytes:data});
  p+=46+nl+xl+cl;
 }
 return entries;
}
async function importWorkshop(files){
 const list=(Array.isArray(files)?files:[files]).filter(Boolean);if(!list.length)return;await saveWorkshop();
 const expected=workshop.view==='presets'?'variables':'storyboards',noun=expected==='storyboards'?'分镜':'预设';
 const entries=await workshopImportEntries(list),checked=[];
 for(const entry of entries){
  const body={projectId:state.activeProjectId,expectedKind:expected};
  try{if(entry.zip)body.zip=workshopBase64(entry.zip);else body.document=JSON.parse(entry.text);const response=await request('/api/library/inspect',post(body));checked.push({entry,body,info:await response.json()})}
  catch(error){checked.push({entry,error:error.message||String(error)})}
 }
 const good=checked.filter(x=>!x.error),bad=checked.filter(x=>x.error);
 if(!good.length)throw Error(bad.length===1?bad[0].entry.name+'：'+bad[0].error:'没有可导入的'+noun+'：'+bad.map(x=>x.entry.name).join('、'));
 const summary=good.map(x=>'「'+(x.info.title||x.entry.name)+'」').join('、')+(bad.length?'；跳过 '+bad.length+' 个无法识别的文件':'');
 if(!await confirmAction(good.length>1?'导入 '+good.length+' 份'+noun+'？':'导入独立资产？',summary+'。导入的'+noun+'会作为新副本加入。','导入'))return;
 let last=null;const failed=[];
 for(const item of good){try{last=await(await request('/api/library/import',post(item.body))).json()}catch(error){failed.push((item.info.title||item.entry.name)+'：'+error.message)}}
 await connectPythonBackend();
 if(last){if(expected==='storyboards')workshop.storyId=last.id;else workshop.presetId=last.id}
 render();
 const done=good.length-failed.length;
 if(failed.length)toast('已导入 '+done+' 份；'+failed.length+' 份失败：'+failed.join('；'),'warn');else toast(done>1?'已导入 '+done+' 份'+noun:'已导入「'+(good[0].info.title||good[0].entry.name)+'」');
}
async function workshopExportDocument(kindView,asset){
 const stories=kindView==='stories';
 const document=stories?clone(asset):{...clone(asset),entries:clone(asset.id===workshopPreset()?.id&&workshopDraft()?mergedSettingEntries(workshopDraft()):asset.entries||[])};
 const response=await request('/api/library/export-document',post({kind:stories?'storyboards':document.category==='scenes'?'scenes':'characters',document}));
 return {name:safeFolderName(document.title||(stories?'分镜':'预设'))+'.mio.zip',blob:await response.blob()};
}
function openWorkshopExportDialog(){
 const stories=workshop.view==='stories',noun=stories?'分镜':'预设',items=stories?projectTemplates():projectVariableSets(),current=(stories?workshopStory():workshopPreset())?.id;
 if(!items.length)throw Error('还没有可导出的'+noun);
 const meta=a=>stories?localeString('{n} 幕',{n:(a.frames||[]).length}):localeString('{n} 个变量',{n:(a.entries||[]).length})+(a.category==='scenes'?' · 场景 / 画风':' · 角色');
 modal('导出'+noun,`<div class="workshop-export-sheet"><div class="workshop-export-tools"><span class="workshop-export-count" id="workshop-export-count"></span><span class="spacer"></span>${btn('全选','check','workshop-pick-all-assets','','small ghost')}${btn('只选当前','edit','workshop-pick-current-asset','','small ghost')}</div><div class="workshop-export-list" role="group" aria-label="选择要导出的${noun}">${items.map(a=>`<label class="workshop-export-item ${a.id===current?'is-current':''}"><input type="checkbox" data-workshop-export="${esc(a.id)}" ${a.id===current?'checked':''}><span class="grow"><strong data-user-content>${esc(a.title||'未命名')}</strong><small>${esc(meta(a))}</small></span>${a.id===current?'<em>当前</em>':''}</label>`).join('')}</div><p class="help">单份导出为 <code>.mio.zip</code> 资源包（含参考图）；多份会打包成一个 <code>.zip</code>，可在「导入」中整包导入。</p><div class="modal-footer">${btn('取消','','close-modal')}${btn('导出','file-export','workshop-export-confirm','id="workshop-export-confirm"','primary')}</div></div>`,'选择要带走的'+noun+'。',false);
 updateWorkshopExportCount();
}
function updateWorkshopExportCount(){
 const boxes=[...document.querySelectorAll('[data-workshop-export]')],n=boxes.filter(b=>b.checked).length,label=$('#workshop-export-count'),button=$('#workshop-export-confirm');
 if(label)label.textContent=localeString('已选 {n} / {total}',{n,total:boxes.length});
 if(button){button.disabled=!n;button.lastChild.textContent=n>1?localeString('导出 {n} 份',{n}):'导出'}
}
async function confirmWorkshopExport(){
 const stories=workshop.view==='stories',noun=stories?'分镜':'预设',ids=[...document.querySelectorAll('[data-workshop-export]:checked')].map(b=>b.dataset.workshopExport);
 if(!ids.length)throw Error('请至少选择一份'+noun);
 const button=$('#workshop-export-confirm');if(button)button.disabled=true;
 try{
  await saveWorkshop();
  const assets=ids.map(id=>(stories?projectTemplates():projectVariableSets()).find(a=>a.id===id)).filter(Boolean),files=[];
  for(const asset of assets)files.push(await workshopExportDocument(workshop.view,asset));
  closeModal();
  if(files.length===1){download(files[0].name,files[0].blob,'application/zip');return}
  const used=new Map(),entries=new Map();
  for(const f of files){const base=f.name.replace(/\.mio\.zip$/i,''),n=used.get(base)||0;used.set(base,n+1);entries.set(n?base+' ('+(n+1)+').mio.zip':f.name,f.blob)}
  download(noun+'库 · '+files.length+' 份.zip',await zipDirectory(entries),'application/zip');toast('已导出 '+files.length+' 份'+noun);
 }finally{if(button?.isConnected)button.disabled=false}
}
/* Confirmations name the real cost: a local ComfyUI run occupies the GPU, a cloud channel may bill. */
function productionCostNote(tasks,{forcePrepare=false,indices=false}={}){
 const local=tasks.length?tasks.every(productionIsLocal):productionIsLocal(null);
 if(forcePrepare)return local?'重新执行前置脚本，忽略缓存和未确认标记；会重新占用显卡。':'重新执行前置脚本，忽略缓存和未确认标记，可能重复计费。';
 if(indices)return local?'只处理指定幕次。成功后替换该页，失败保留原图。':'只处理指定幕次。成功后替换该页，失败保留原图；已经发出的请求可能计费。';
 return local?'将通过本地 ComfyUI 开始生成。':'将开始生成，云端服务可能产生费用。';
}
/* Uncertain pages were submitted upstream and never confirmed; rerunning them needs its own consent. */
async function confirmUncertainRerun(tasks,indices=null){
 const uncertain=tasks.some(t=>(t.pages||[]).some(p=>p.state==='uncertain'&&(!indices||indices.includes(p.index))));if(!uncertain)return true;
 const local=tasks.every(productionIsLocal);
 return confirmAction(local?'存在未确认的结果':'未确认结果可能已计费',local?'上一次的结果尚未确认，重跑会覆盖它；请先在 ComfyUI 历史中核对。':'重跑可能重复计费。','我已核对，仍要重跑');
}
function productionGestureActive(){return !!workshop.reorderDrag||!!window.desktopSelection?.busy?.()}
function productionScope(d={}){if(typeof d.ids==='string'&&d.ids){try{const ids=JSON.parse(d.ids);if(Array.isArray(ids))return {ids}}catch(_){}}if(Array.isArray(d.ids))return {ids:d.ids};return d.id?{id:d.id}:{}}
function productionScopeTasks(scope){return scope.ids?scope.ids.map(productionTask).filter(Boolean):scope.id?[productionTask(scope.id)].filter(Boolean):[]}
async function startProduction(id,options={}){
 const current=productionTask(id);if(!current)return;const rerun=options.indices&&current.pages.some(p=>options.indices.includes(p.index)&&productionPageHasRun(p));
 const title=options.indices?(rerun?'确认局部重跑？':'确认局部生成？'):'开始生成这本画册？';
 if(!await confirmAction(title,productionCostNote([current],{indices:!!options.indices,forcePrepare:!!options.forcePrepare}),'确认开始'))return;
 if(!await confirmUncertainRerun([current],options.indices||null))return;
 adoptProductionQueue(await productionRequest('start',{id,...options,trusted:true,confirmUncertain:true}));render();
}
async function startProductionMany(ids){
 const tasks=ids.map(productionTask).filter(t=>t&&productionTaskAccess(t).canStart);if(!tasks.length){toast('所选任务没有可以开始的分幕');return}
 if(!await confirmAction(localeString('同时开始生成 {n} 本画册？',{n:tasks.length}),productionCostNote(tasks)+' 每本画册独立运行，互不等待。','确认开始'))return;
 if(!await confirmUncertainRerun(tasks))return;
 adoptProductionQueue(await productionRequest('start-many',{ids:tasks.map(t=>t.id),trusted:true,confirmUncertain:true}));render();
}
async function startProductionSequence(ids=null){
 const pool=ids?ids.map(productionTask).filter(Boolean):workshop.queue.tasks,tasks=pool.filter(t=>productionTaskAccess(t).canQueue);
 if(!tasks.length){toast('没有可以顺次生成的任务：请先装配，或等待运行中的任务结束');return}
 if(!await confirmAction(localeString('按顺序生成 {n} 本画册？',{n:tasks.length}),productionCostNote(tasks)+' 任务按列表顺序一本接一本生成。','确认开始'))return;
 if(!await confirmUncertainRerun(tasks))return;
 adoptProductionQueue(await productionRequest('start-sequence',{ids:tasks.map(t=>t.id),trusted:true,confirmUncertain:true}));render();
}
function workshopFrameIndex(d){const index=Number(d?.index);return Number.isInteger(index)&&index>=0?index:workshop.frame}

/* ------------------------------------------------------------ context menu
   One right-click menu per workshop view, ordered the way a comic is made: write frames → shape presets → assemble → generate.
   Everything is a data-act the toolbar already exposes, plus keyboard hints; extension entries (kind=frame) are merged in. */
function workshopViewSwitchItems(){
  return {label:'切换到',icon:'grid',children:[['stories','分镜工坊','story'],['presets','预设工坊','brush'],['production','装配与队列','play']].filter(([view])=>view!==workshop.view).map(([view,label,iconName])=>({label,icon:iconName,act:'workshop-tab',data:{view}}))};
}
function workshopFrameContextItems(story,index){
  const frame=story.frames[index],last=story.frames.length-1,base=storyBasePrompt(story),extension=typeof contextMenuExtensionItems==='function'?contextMenuExtensionItems('frame',{index,story}):[];
  const data={index},picked=workshop.pickedFrames;
  if(picked.has(index)&&picked.size>1)return workshopFramesSelectionContextItems(story,index);
  return [
    {label:index===workshop.frame?'正在编辑这一幕':'编辑这一幕',icon:'edit',act:'workshop-frame',data,primary:true,disabled:index===workshop.frame,shortcut:'Ctrl/⌘ ↑↓'},
    {label:'插入起手模板',icon:'spark',act:'workshop-apply-base',data,disabled:!base||!!frame.prompt.trim(),hint:!base?'先在「故事梗概 / 起手模板」里写好模板':frame.prompt.trim()?'这一幕已有提示词':'把起手模板填入空白提示词'},
    '-',
    {label:'在此后插入空白分幕',icon:'plus',act:'workshop-insert-frame',data},
    {label:'复制这一幕',icon:'copy',act:'workshop-copy-frame',data,hint:'副本紧随其后，台词版本一并复制'},
    {label:'前移',icon:'up',act:'workshop-move-frame',data:{index,dir:-1},disabled:index===0},
    {label:'后移',icon:'down',act:'workshop-move-frame',data:{index,dir:1},disabled:index>=last},
    '-',
    {label:'选择',icon:'check',children:[
      {label:'全选分幕',icon:'list',act:'workshop-frame-pick-all',shortcut:'Ctrl/⌘ A'},
      {label:'只选空白分幕',icon:'search',act:'workshop-frame-pick-empty',hint:'没有提示词也没有台词的分幕'},
      {type:'label',label:'拖动框选 · Ctrl / ⌘ 加选 · Shift 连选'}
    ]},
    extension.length?'-':null,
    ...extension,
    '-',
    {label:'删除这一幕…',icon:'trash',act:'workshop-delete-frame',data,danger:true,disabled:story.frames.length<=1,title:story.frames.length<=1?'分镜至少保留一幕。':''}
  ];
}
/* Menu for a multi-selection of frames: only actions that make sense for the whole set. */
function workshopFramesSelectionContextItems(story,index){
  const picked=[...workshop.pickedFrames].filter(i=>story.frames[i]).sort((a,b)=>a-b),n=picked.length;
  const blank=picked.filter(i=>!String(story.frames[i].prompt||'').trim()).length,base=storyBasePrompt(story);
  return [
    {type:'label',label:`对选中的 ${n} 幕`},
    {label:'编辑这一幕',icon:'edit',act:'workshop-frame',data:{index},hint:story.frames[index]?.name||'',disabled:index===workshop.frame},
    {label:blank?`为 ${blank} 幕空白提示词插入起手模板`:'插入起手模板',icon:'spark',act:'workshop-frames-apply-base',disabled:!base||!blank,hint:!base?'先写好起手模板':blank?'':'所选分幕都已有提示词'},
    {label:'复制所选分幕',icon:'copy',act:'workshop-frames-copy',hint:'副本紧随最后一幕之后'},
    '-',
    {label:'全选分幕',icon:'list',act:'workshop-frame-pick-all',shortcut:'Ctrl/⌘ A'},
    {label:'只选空白分幕',icon:'search',act:'workshop-frame-pick-empty'},
    {label:'取消选择',icon:'close',act:'workshop-frame-pick-clear',shortcut:'Esc'},
    '-',
    {label:`删除选中的 ${n} 幕…`,icon:'trash',act:'workshop-frame-delete-bulk',danger:true,shortcut:'Delete',disabled:n>=story.frames.length,title:n>=story.frames.length?'分镜至少保留一幕。':''}
  ];
}
function workshopStoryContextItems(story){
  return [
    {label:'新增分幕',icon:'plus',act:'workshop-add-frame',primary:true,disabled:story.frames.length>=512},
    {label:'批量新增分幕…',icon:'copy',act:'workshop-add-frames',hint:'按起手模板一次生成多幕'},
    {label:'全选分幕',icon:'list',act:'workshop-frame-pick-all',shortcut:'Ctrl/⌘ A',hint:'拖动框选或 Ctrl / ⌘ 点击也可多选'},
    '-',
    {label:'去装配此分镜',icon:'arrow',act:'first-run-assemble-story',hint:'下一步：搭配预设，生成画册'},
    '-',
    {label:'分镜',icon:'story',children:[
      {label:'重命名…',icon:'edit',act:'workshop-rename'},
      {label:'新建分镜…',icon:'plus',act:'workshop-new'},
      '-',
      {label:'导出此分镜',icon:'download',act:'workshop-export'}
    ]},
    {label:'分镜库',icon:'folder',children:[
      {label:'导入分镜…',icon:'upload',act:'workshop-import',hint:'.json / .mio.zip，可多选'},
      {label:'选择并导出…',icon:'download',act:'workshop-export-pick',hint:'一次导出多份分镜'}
    ]},
    workshopViewSwitchItems()
  ];
}
function workshopPresetContextItems(draft){
  const owner={owner:draft.id};
  return [
    {label:'新增变量',icon:'plus',act:'art-setting-add',primary:true,hint:'人物、服装、画风……都能成为变量'},
    {label:'新建分组',icon:'folder',act:'settings-group-new',data:owner},
    {label:'编辑分组…',icon:'edit',act:'settings-group-edit',data:owner},
    '-',
    {label:'独立试绘',icon:'brush',act:'workshop-preview',hint:'只用这套预设画一张，检验效果'},
    {label:'新建生成任务…',icon:'play',act:'assembly-new',hint:'下一步：选择分镜与预设，装配任务'},
    '-',
    {label:'预设资产',icon:'brush',children:[
      {label:'重命名…',icon:'edit',act:'workshop-rename'},
      {label:'新建预设…',icon:'plus',act:'workshop-new'},
      {label:'添加节点绑定…',icon:'nodes',act:'workshop-binding-new'},
      '-',
      {label:'导出此预设',icon:'download',act:'workshop-export'}
    ]},
    {label:'预设库',icon:'folder',children:[
      {label:'导入预设…',icon:'upload',act:'workshop-import',hint:'.json / .mio.zip，可多选'},
      {label:'选择并导出…',icon:'download',act:'workshop-export-pick',hint:'一次导出多份预设'}
    ]},
    workshopViewSwitchItems()
  ];
}
function productionTaskContextItems(task,a=productionTaskAccess(task)){
  const data={id:task.id},hasResult=(task.pages||[]).some(p=>p.result),open=workshop.openTasks.has(task.id),troubled=!!task.error||(task.pages||[]).some(p=>['failed','uncertain'].includes(p.state));
  const order=workshop.queue.tasks.map(t=>t.id),index=order.indexOf(task.id),total=order.length;
  return [
    a.running
      ?(a.paused?{label:'继续生成',icon:'play',act:'production-resume',data,primary:true,hint:'只继续这本画册的后续分幕'}:{label:'暂停这本画册',icon:'pause',act:'production-pause',data,primary:true,hint:'已发出的分幕会返回，之后不再派发新分幕'})
      :a.queued?{label:'移出顺次队列',icon:'close',act:'production-cancel',data,primary:true,hint:a.position?localeString('排队 · 第 {n} 位',{n:a.position}):''}
      :{label:'开始生成',icon:'play',act:'production-start',data,primary:true,disabled:!a.canStart,hint:a.startReason},
    a.running?{label:'停止这本画册',icon:'stop',act:'production-cancel',data,hint:'停止后续分幕；已生成的图片保留'}:null,
    a.canQueue?{label:'加入顺次队列',icon:'list',act:'production-sequence',data,hint:'排在其他顺次任务之后，一本接一本生成'}:null,
    '-',
    {label:'快速克隆',icon:'copy',act:'production-clone',data,hint:'直接复制为新的待命任务'},
    {label:'克隆并微调…',icon:'sliders',act:'production-clone-adjust',data,hint:'微调分镜提示词、参数与并发后克隆'},
    {label:'调整顺序',icon:'list',children:[
      {label:'上移一位',icon:'up',act:'production-move',data:{id:task.id,dir:-1},disabled:index<=0},
      {label:'下移一位',icon:'down',act:'production-move',data:{id:task.id,dir:1},disabled:index<0||index>=total-1},
      {label:'移到最前',icon:'up',act:'production-move',data:{id:task.id,to:'start'},disabled:index<=0},
      {label:'移到最后',icon:'down',act:'production-move',data:{id:task.id,to:'end'},disabled:index<0||index>=total-1}
    ],hint:'也可直接拖动生成任务'},
    {label:task.purpose==='preview'?'查看试绘':'查看画册',icon:'book',act:task.purpose==='preview'?'production-preview':'production-read',data:{id:task.albumId},disabled:!hasResult},
    {label:open?'收起分幕进度':'展开分幕进度',icon:'expand',act:'production-toggle-pages',data,checked:open},
    troubled?{label:'诊断详情',icon:'help',act:'production-details',data,hint:'每一幕的原始错误与上游记录'}:null,
    '-',
    {label:'移除任务记录…',icon:'trash',act:'production-remove',data,danger:true,disabled:!a.canRemove,hint:a.removeReason}
  ];
}
/* Batch menu for a multi-selection of task cards. Each entry names how many cards it really applies to. */
function productionSelectionContextItems(ids){
  const tasks=ids.map(productionTask).filter(Boolean),access=tasks.map(t=>[t,productionTaskAccess(t)]),pick=test=>access.filter(([t,a])=>test(t,a)).map(([t])=>t.id);
  const startable=pick((t,a)=>a.canStart),queueable=pick((t,a)=>a.canQueue),pausable=pick((t,a)=>a.canPause),resumable=pick((t,a)=>a.canResume),stoppable=pick((t,a)=>a.canStop),removable=pick((t,a)=>a.canRemove);
  // Entries that apply to none of the selected cards are left out; the menu describes what the selection can do now.
  const entry=(label,icon,act,list,extra={})=>list.length?{label:localeString(label,{n:list.length}),icon,act,data:{ids:JSON.stringify(list)},...extra}:null;
  return [
    entry('同时开始生成 {n} 本','play','production-start-selected',startable,{primary:true,hint:'每本画册独立运行，互不等待'}),
    entry('顺次生成 {n} 本','list','production-sequence',queueable,{hint:'按卡片顺序一本接一本'}),
    '-',
    entry('暂停 {n} 本','pause','production-pause',pausable),
    entry('继续 {n} 本','play','production-resume',resumable),
    entry('停止 {n} 本','stop','production-cancel',stoppable),
    '-',
    {label:localeString('克隆 {n} 本',{n:tasks.length}),icon:'copy',act:'production-clone',data:{ids:JSON.stringify(tasks.map(t=>t.id))},disabled:!tasks.length},
    {label:'全选生成任务',icon:'check',act:'production-select-all'},
    {label:'取消选择',icon:'close',act:'production-select-none'},
    '-',
    {label:localeString('移除 {n} 条任务记录…',{n:removable.length}),icon:'trash',act:'production-remove',data:{ids:JSON.stringify(removable)},danger:true,disabled:!removable.length,hint:removable.length<tasks.length?'运行或排队中的任务会被跳过':''}
  ];
}
function productionPageContextItems(task,page,a=productionTaskAccess(task)){
  const labels=productionPageLabels(task,page),data={id:task.id,index:page.index},publishFailed=page.state!=='complete'&&page.attempts?.at(-1)?.phase==='publish';
  return [
    page.result?.image?{label:'查看图片',icon:'eye',act:'production-page-preview',data}:null,
    {label:labels.single,icon:labels.icon,act:'production-rerun',data,primary:true,disabled:!a.canRerun,hint:a.reason},
    {label:labels.tail,icon:'list',act:'production-rerun-tail',data,disabled:!a.canRerun,hint:a.reason},
    publishFailed?{label:'恢复已生成结果',icon:'disk',act:'production-recover',data,disabled:!a.canRecover,hint:'只重试本地发布，不再请求模型'}:null,
    '-',
    {label:'整本任务',icon:'box',children:productionTaskContextItems(task,a)}
  ];
}
function productionContextItems(){
  const q=workshop.queue,c=productionQueueControls(q);
  return [
    {label:'新建生成任务…',icon:'plus',act:'assembly-new',primary:true,hint:'选择分镜与预设，装配后再明确开始'},
    {label:'按顺序开始生成',icon:'list',act:'production-sequence',disabled:!c.canSequence,hint:c.canSequence?localeString('{n} 本待命任务将一本接一本生成',{n:c.sequenceCount}):'没有可以顺次生成的任务'},
    '-',
    {label:'全局暂停',icon:'pause',act:'production-pause',disabled:!c.canPause,hint:'暂停所有画册的后续分幕与顺次队列'},
    {label:'继续生成',icon:'play',act:'production-resume',disabled:!c.canResume,hint:'释放所有暂停'},
    {label:'停止全部…',icon:'stop',act:'production-cancel',danger:true,disabled:!c.canCancel},
    '-',
    {label:'清空已完成',icon:'broom',act:'production-clear-finished',disabled:!c.canClear,hint:c.canClear?localeString('移除 {n} 条已完成记录，画册保留',{n:c.finishedCount}):'没有已完成的任务记录'},
    {label:'全选生成任务',icon:'check',act:'production-select-all',disabled:!(q.tasks||[]).length,hint:'也可拖动框选，Ctrl / ⌘ 加选'},
    workshopViewSwitchItems()
  ];
}
/* Resolve what was right-clicked into {el, title, subtitle, items}. Returns null when the browser menu should stay (text fields, dialogs). */
function workshopContextSpec(target){
  if(ui.workspace!==1||window.MioSafeMode||!(target instanceof Element))return null;
  if(target.closest('input,textarea,select,[contenteditable="true"],a[href],.ctx-menu,dialog,#assistant,#sidebar,#topbar,.statusbar'))return null;
  if(document.querySelector('dialog[open]')||!target.closest('#main'))return null;
  if(workshop.view==='stories'){
    const story=workshopStory();if(!story)return null;
    const frameEl=target.closest('.workshop-frames [data-index],.wm-card[data-index]');
    const index=frameEl?Number(frameEl.dataset.index):target.closest('.workshop-page')?workshop.frame:-1;
    if(story.frames[index]){const frame=story.frames[index];return {el:frameEl||target.closest('.workshop-page'),label:'分幕右键菜单',title:`${pad(index+1)} · ${frame.name||'未命名分幕'}`,subtitle:frame.prompt.trim()?frame.prompt.trim().slice(0,60):'提示词为空',items:workshopFrameContextItems(story,index)}}
    return {el:null,label:'分镜工坊右键菜单',title:story.title,subtitle:`${story.frames.length} 幕 · 分镜`,items:workshopStoryContextItems(story)};
  }
  if(workshop.view==='presets'){
    const draft=workshopDraft();if(!draft)return null;
    return {el:null,label:'预设工坊右键菜单',title:workshopPreset()?.title||'预设',subtitle:`${draft.variables.length} 个变量`,items:workshopPresetContextItems(draft)};
  }
  const card=target.closest('article.production-card[data-production-task]'),task=card&&productionTask(card.dataset.productionTask);
  if(task){
    const access=productionTaskAccess(task),pageEl=target.closest('.production-page[data-page-index]'),page=pageEl&&(task.pages||[]).find(p=>p.index===Number(pageEl.dataset.pageIndex));
    if(page)return {el:pageEl,label:'分幕进度右键菜单',title:`${task.title} · 第 ${page.index+1} 幕`,subtitle:`${productionStatus(page.state)} · ${page.attemptCount} 次尝试`,items:productionPageContextItems(task,page,access)};
    const picked=workshop.pickedTasks;
    if(picked.size>1&&picked.has(task.id)){const ids=workshop.queue.tasks.filter(t=>picked.has(t.id)).map(t=>t.id);return {el:card,label:'生成任务批量操作菜单',title:localeString('已选 {n} 个生成任务',{n:ids.length}),subtitle:'批量操作只作用于所选任务',items:productionSelectionContextItems(ids)}}
    const done=(task.pages||[]).filter(p=>p.state==='complete').length;
    return {el:card,label:'生成任务右键菜单',title:task.title,subtitle:`${productionStatus(task.status)} · ${done} / ${(task.pages||[]).length} 幕${access.queued&&access.position?` · ${localeString('排队 · 第 {n} 位',{n:access.position})}`:''}`,items:productionTaskContextItems(task,access)};
  }
  const head=productionHeadline(productionQueueControls());
  return {el:null,label:'装配与队列右键菜单',title:'装配与生成',subtitle:head.title,items:productionContextItems()};
}
function openWorkshopContextMenu(spec,x,y){
  if(!spec||typeof openContextMenu!=='function')return false;
  spec.el?.classList.add('is-context');
  return !!openContextMenu({x,y,label:spec.label,title:spec.title,subtitle:spec.subtitle,items:spec.items,focusEl:spec.el||document.activeElement,onClose:()=>spec.el?.classList.remove('is-context')});
}
/* Page concurrency edits commit on change; an invalid value is reverted to what the server reported. */
async function commitProductionConcurrency(el){
 const key=el.dataset.productionConcurrency,global=key==='*',q=workshop.queue,max=q.maxConcurrency||128,raw=String(el.value).trim(),value=raw===''?null:Number(raw);
 const revert=()=>{el.value=global?String(q.concurrency||1):(productionTask(key)?.concurrency??'')};
 if(value!==null&&(!Number.isInteger(value)||value<1||value>max)){toast(localeString('分幕并发需为 1–{max} 的整数',{max}),'error');revert();return}
 if(global&&value===null){revert();return}
 if(global?value===q.concurrency:value===(productionTask(key)?.concurrency??null))return;
 try{adoptProductionQueue(await productionRequest('concurrency',global?{value}:{value,id:key}));render()}catch(error){toast(error.message||'并发设置未保存','error');revert()}
}
/* ---- Scene editing inside a task ------------------------------------------------------------------------------------
   The task keeps its own copy of every scene. Editing rewrites that copy on the server; the source storyboard in the
   workshop is only overwritten when the creator ticks the write-back box (the frame is matched by id, else by position
   when the source still has the same number of scenes). */
function productionFrameSourceTarget(view){
 if(!view?.sourceStoryId||view.preview)return null;
 const story=(state.templates||[]).find(t=>t.id===view.sourceStoryId);if(!story||!Array.isArray(story.frames))return null;
 let frame=view.sourceFrameId?story.frames.find(f=>f.id===view.sourceFrameId):null;
 if(!frame&&story.frames.length===view.frameCount)frame=story.frames[view.index]||null;
 return frame?{story,frame}:null;
}
async function openProductionFrameEditor(id,index){
 const task=productionTask(id);if(!task)return;
 const view=await productionRequest('tasks/'+id+'/frames/'+index),target=productionFrameSourceTarget(view),live=!!workshop.queue.liveSync?.story,access=productionTaskAccess(task);
 workshop.frameDraft={id,index,view};
 const writeback=target
  ?`<label class="row small soft production-frame-writeback"><input type="checkbox" id="production-frame-writeback" ${live?'checked':''}>${localeString('同步写回源分镜「{title}」的这一幕',{title:target.story.title||view.storyTitle||''})}</label>${live?`<p class="help">${esc('已开启“分镜实时读取”：若不写回源分镜，源分镜下次改动时会以源为准覆盖这里的修改。')}</p>`:''}`
  :`<p class="help">${esc(view.preview?'试绘任务没有源分镜，修改只保存到这条任务。':'源分镜已不在当前工作区，或幕数已变化：本次修改只保存到任务快照。')}</p>`;
 modal(localeString('第 {n} 幕 · 编辑提示词',{n:index+1}),`<p class="help" style="margin-bottom:12px">${esc('修改会覆写这个生成任务自己的分镜快照。')}</p>
  ${field('分幕名称',input('name',view.name,'text','id="production-frame-name" maxlength="120"'))}
  ${field('画面提示词',promptEditorHTML({attrs:'id="production-frame-prompt" rows="6"',value:view.prompt,placeholder:'描述这一幕的画面...',context:'plan'}))}
  <details class="quiet-advanced" ${view.negative||view.caption?'open':''}><summary>负向提示词与台词</summary>
   ${field('负向提示词（留空时使用全局负向）',`<textarea id="production-frame-negative" rows="2">${esc(view.negative)}</textarea>`,view.globalNegative?esc('当前全局负向：'+view.globalNegative.slice(0,120)):'')}
   ${field('台词 / 旁白',`<textarea id="production-frame-caption" class="caption-editor" rows="2">${esc(view.caption)}</textarea>`)}
  </details>
  ${writeback}
  <div class="modal-footer">${btn('取消','','close-modal')}${btn('保存并重跑此幕','play','production-frame-save',`data-rerun="1" ${access.canRerun?'':`disabled title="${esc(access.reason)}"`}`)}${btn('覆写保存','disk','production-frame-save','','primary')}</div>`,
  task.title);
 attachPromptEditors();setTimeout(()=>$('#production-frame-prompt')?.focus(),40);
}
async function saveProductionFrame(rerun){
 const draft=workshop.frameDraft;if(!draft)return;
 const fields={name:$('#production-frame-name')?.value??draft.view.name,prompt:$('#production-frame-prompt')?.value??draft.view.prompt,negative:$('#production-frame-negative')?.value??draft.view.negative,caption:$('#production-frame-caption')?.value??draft.view.caption};
 if(!fields.prompt.trim()&&!await confirmAction('提示词为空','这一幕将没有画面提示词，仍要保存吗？','仍要保存'))return;
 adoptProductionQueue(await productionRequest('update-frame',{id:draft.id,index:draft.index,...fields}));
 let wroteBack=false;
 if($('#production-frame-writeback')?.checked){
  const target=productionFrameSourceTarget(draft.view);
  if(target){Object.assign(target.frame,{name:fields.name.trim()||target.frame.name,prompt:fields.prompt,negative:fields.negative,caption:fields.caption});delete target.story.ownerPlanId;target.story.updatedAt=Date.now();save();wroteBack=await savePythonWorkspace();if(!wroteBack)toast('源分镜的写回尚未确认，请检查服务状态或冲突','warn')}
 }
 closeModal();workshop.frameDraft=null;render();
 toast(wroteBack?localeString('第 {n} 幕已保存，并已写回源分镜',{n:draft.index+1}):localeString('第 {n} 幕已保存到任务快照',{n:draft.index+1}));
 if(rerun)await startProduction(draft.id,{indices:[draft.index]});
}
/* ---- Live reading of sources (设置 · 功能开关) ------------------------------------------------------------------------
   Three independent switches kept by the queue itself: while one is on, every scene re-reads that source kind right before
   it renders and adopts the newest content; off keeps the snapshot frozen at assembly time, exactly as before. */
const PRODUCTION_LIVE_SYNC_ROWS=[
 ['story','分镜实时读取','每一幕生成前核对源分镜；有改动即用最新分镜内容替换任务快照后再生成。幕数变化时保留快照并提示，需重新装配。','story'],
 ['presets','预设实时读取','每一幕生成前核对所选角色 / 场景预设；有改动即替换并重新计算变量值。','brush'],
 ['workflow','工作流实时读取','每一幕生成前核对 ComfyUI 设置与所选工作流、节点映射；有改动即替换。仅对 ComfyUI 图像服务生效。','nodes'],
];
/* The settings page is not polled; fetch the queue once when the section first shows and re-render when it lands. */
async function loadProductionLiveSync(){
 if(workshop.liveSyncRequested)return;workshop.liveSyncRequested=true;
 try{const raw=await productionRequest('tasks');delete raw.serverEpochMs;adoptProductionQueue(raw);workshop.liveSyncError=null}
 catch(error){workshop.liveSyncError=error.message||'生产服务不可用'}
 if(ui.workspace===5&&$('[data-production-live-settings]'))render();
}
function productionLiveSyncSettingsHTML(){
 const live=workshop.queue.liveSync;
 if(!live)void loadProductionLiveSync();
 const rows=PRODUCTION_LIVE_SYNC_ROWS.map(([key,title,desc,ic])=>settingsRow(title,desc,`<label class="switch"><input role="switch" type="checkbox" data-production-live="${key}" aria-label="${esc(title)}" ${live?.[key]?'checked':''} ${live?'':'disabled'}><span class="switch-track" aria-hidden="true"></span></label>`,ic)).join('');
 const pending=live?'':`<p class="help production-live-pending">${esc(workshop.liveSyncError?'无法读取生成队列设置：'+workshop.liveSyncError:'正在读取当前设置…')}${workshop.liveSyncError?' '+btn('重试','refresh','production-live-retry','','small ghost'):''}</p>`;
 return `<section class="settings-section production-live-settings" data-production-live-settings><h2>生成任务 · 源内容实时读取</h2><p>默认全部关闭：装配时会把分镜、预设与工作流固化成任务快照，之后修改源内容只对新任务生效。开启某一项后，对应内容会在每一幕生成前与最新源内容比对，有差异即替换后再生成；三项各自独立，修改后从下一幕开始生效。</p>${rows}${pending}</section>`;
}
async function commitProductionLiveSync(el){
 const key=el.dataset.productionLive,value=el.checked,row=PRODUCTION_LIVE_SYNC_ROWS.find(r=>r[0]===key);
 try{adoptProductionQueue(await productionRequest('live-sync',{[key]:value}));toast(localeString(value?'已开启{title}：从下一幕开始生效':'已关闭{title}：任务沿用各自的快照',{title:row?.[1]||key}))}
 catch(error){el.checked=!value;toast(error.message||'实时读取设置未保存','error')}
}
/* Persist a new card order. The visible list moves first so the drop feels instant; the server answer is authoritative. */
async function reorderProduction(order){
 const byId=new Map(workshop.queue.tasks.map(t=>[t.id,t]));if(order.length!==byId.size||order.some(id=>!byId.has(id)))return;
 workshop.queue={...workshop.queue,tasks:order.map(id=>byId.get(id))};render();
 try{adoptProductionQueue(await productionRequest('reorder',{order}));render()}catch(error){toast(error.message||'排序未保存','error');await refreshProduction();render()}
}
/* Pointer drag reorders task cards (8px activation, like the shelf). It steps aside whenever a multi-selection exists,
   a modifier is held or the pointer starts on a control, so clicks, marquee selection and the page list keep working. */
function installProductionReorderDrag(){
 const THRESHOLD=8,SEL='.production-cards article.production-card[data-production-task]';let gesture=null,ghost=null,raf=0,suppressClick=false;
 const clearTargets=()=>document.querySelectorAll('.production-card.is-drop-target').forEach(el=>el.classList.remove('is-drop-target','is-drop-after'));
 function finish(){cancelAnimationFrame(raf);raf=0;ghost?.remove();ghost=null;clearTargets();document.querySelectorAll('.production-card.is-dragging').forEach(el=>el.classList.remove('is-dragging'));document.body.classList.remove('production-reordering');const wasActive=gesture?.active;gesture=null;workshop.reorderDrag=false;if(wasActive&&workshop.renderPending&&ui.workspace===1&&workshop.view==='production'&&!$('#modal').open){workshop.renderPending=false;render()}}
 function hitTest(x,y){if(ghost)ghost.style.visibility='hidden';const el=document.elementFromPoint(x,y);if(ghost)ghost.style.visibility='';const card=el?.closest?.(SEL);if(!card||card.dataset.productionTask===gesture.id)return null;const r=card.getBoundingClientRect();return {card,after:y>r.top+r.height/2}}
 function track(x,y){gesture.x=x;gesture.y=y;if(ghost)ghost.style.transform=`translate(${x+14}px,${y+12}px)`;const hit=hitTest(x,y);clearTargets();gesture.target=hit?.card.dataset.productionTask||null;gesture.after=!!hit?.after;if(hit){hit.card.classList.add('is-drop-target');hit.card.classList.toggle('is-drop-after',hit.after)}}
 function tick(){if(!gesture?.active)return;const top=($('#topbar')?.getBoundingClientRect().bottom||0)+40,bottom=innerHeight-64,y=gesture.y;const dy=y<top?-Math.min(18,(top-y)/3):y>bottom?Math.min(18,(y-bottom)/3):0;if(dy){window.scrollBy({top:dy,behavior:'instant'});track(gesture.x,gesture.y)}raf=requestAnimationFrame(tick)}
 window.addEventListener('pointerdown',e=>{
  suppressClick=false;if(gesture)finish();
  if(e.button!==0||e.pointerType==='touch'||ui.workspace!==1||workshop.view!=='production'||workshop.pickedTasks.size||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||document.querySelector('dialog[open]'))return;
  const card=e.target.closest(SEL);if(!card||e.target.closest('[data-act],button,input,textarea,select,label,a,summary,.production-pages'))return;
  gesture={id:card.dataset.productionTask,title:card.querySelector('h2')?.textContent||'',pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,card,active:false,target:null,after:false};
 },true);
 window.addEventListener('pointermove',e=>{
  if(!gesture||e.pointerId!==gesture.pointerId)return;
  if(!(e.buttons&1)){finish();return}
  if(!gesture.active){if(Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)<THRESHOLD)return;gesture.active=true;workshop.reorderDrag=true;if(typeof closeContextMenu==='function')closeContextMenu();gesture.card.classList.add('is-dragging');document.body.classList.add('production-reordering');ghost=document.createElement('div');ghost.className='production-drag-ghost';ghost.setAttribute('aria-hidden','true');ghost.textContent='⠿ '+gesture.title;document.body.append(ghost);raf=requestAnimationFrame(tick)}
  e.preventDefault();track(e.clientX,e.clientY);
 },true);
 window.addEventListener('pointerup',e=>{
  if(!gesture||e.pointerId!==gesture.pointerId)return;
  const g=gesture;if(!g.active){finish();return}
  suppressClick=true;finish();
  if(!g.target)return;
  const order=workshop.queue.tasks.map(t=>t.id),from=order.indexOf(g.id);if(from<0)return;order.splice(from,1);let to=order.indexOf(g.target);if(to<0)return;if(g.after)to+=1;order.splice(to,0,g.id);
  if(order.join()!==workshop.queue.tasks.map(t=>t.id).join())void reorderProduction(order);
 },true);
 window.addEventListener('pointercancel',()=>finish(),true);
 window.addEventListener('click',e=>{if(suppressClick){suppressClick=false;e.preventDefault();e.stopImmediatePropagation()}},true);
 window.addEventListener('blur',()=>finish());
 paths.broom??='<path d="M19.5 3.5 11 12"/><path d="m9.2 10.2 4.6 4.6"/><path d="M4 20c.4-3.6 2.2-6.4 5.4-8.2l2.8 2.8C10.4 17.8 7.6 19.6 4 20Z"/>';
}
function installWorkshopContextMenu(){
  document.addEventListener('contextmenu',event=>{
    const spec=workshopContextSpec(event.target);if(!spec)return;
    if(openWorkshopContextMenu(spec,event.clientX,event.clientY))event.preventDefault();
  });
  document.addEventListener('keydown',event=>{
    if(!(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'))return;
    if(typeof contextMenuOpen==='function'&&contextMenuOpen())return;
    const anchor=event.target.closest?.('.workshop-frames [data-index],.wm-card[data-index],.workshop-page,article.production-card,.production-page');
    const spec=anchor?workshopContextSpec(anchor):null;if(!spec)return;
    const rect=anchor.getBoundingClientRect();if(openWorkshopContextMenu(spec,rect.left+Math.min(24,rect.width/2),rect.top+Math.min(24,rect.height/2)))event.preventDefault();
  });
}

function installWorkshopMobileEditor(){
 paths['chevron-left']??='<path d="m15 5-7 7 7 7"/>';paths['chevron-right']??='<path d="m9 5 7 7-7 7"/>';
 const layerOf=el=>el?.closest?.('.wm-focus');
  /* Which editor the chips insert into; the timestamp lets「下一幕」keep the keyboard when it was open. */
  document.addEventListener('focusin',e=>{const layer=layerOf(e.target);if(!layer)return;if(e.target.matches('.wm-focus-body textarea,.wm-focus-body input:not([type="number"]):not([type="checkbox"]):not([type="radio"])')){workshop.mobileField=e.target;layer.classList.add('is-editing');setTimeout(()=>{if(document.activeElement===e.target)e.target.scrollIntoView({block:'center',behavior:'smooth'})},320)}});
  document.addEventListener('focusout',e=>{const layer=layerOf(e.target);if(!layer)return;workshop.mobileBlurAt=performance.now();setTimeout(()=>{if(!layer.isConnected)return;const active=document.activeElement;if(!active||!layer.contains(active)||!active.matches('.wm-focus-body textarea,.wm-focus-body input'))layer.classList.remove('is-editing')},0)});
  /* Chips: pointerdown + preventDefault keeps focus (and the keyboard) in the textarea while the text is inserted. */
  document.addEventListener('pointerdown',e=>{const chip=e.target.closest?.('.wm-chips [data-wm-insert]');if(!chip)return;e.preventDefault();let field=workshop.mobileField&&workshop.mobileField.isConnected?workshop.mobileField:null;if(field&&(field.type==='number'||field.type==='checkbox'||field.type==='radio'))field=null;if(!field)field=document.querySelector('.wm-focus [data-workshop-frame="prompt"]');if(!field)return;if(document.activeElement!==field)field.focus();try{insertTextAtCaret(field,chip.dataset.wmInsert.replace(/\\n/g,'\n'))}catch(_){}});
  document.addEventListener('click',e=>{if(e.target.closest?.('.wm-chips [data-wm-insert]'))e.preventDefault()});
  /* Horizontal swipe on the editor body steps between scenes; swipes that start in a text field are left to the field. */
  let swipe=null;
  document.addEventListener('touchstart',e=>{const body=e.target.closest?.('[data-wm-swipe]');if(!body||e.touches.length!==1||e.target.closest('textarea,input,select,button')){swipe=null;return}const t=e.touches[0];swipe={x:t.clientX,y:t.clientY,at:performance.now(),scroll:body.scrollTop}},{passive:true});
  document.addEventListener('touchcancel',()=>swipe=null,{passive:true});
  document.addEventListener('touchend',e=>{if(!swipe)return;const start=swipe;swipe=null;const t=e.changedTouches[0];if(!t)return;const dx=t.clientX-start.x,dy=t.clientY-start.y,body=e.target.closest?.('[data-wm-swipe]');if(Math.abs(dx)<70||Math.abs(dy)>50||performance.now()-start.at>600||(body&&Math.abs(body.scrollTop-start.scroll)>8))return;const s=workshopStory();if(!s)return;const next=clamp(workshop.frame+(dx<0?1:-1),0,s.frames.length-1);if(next!==workshop.frame){save();openWorkshopMobileEditor(next)}},{passive:true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229&&workshop.mobileEditor&&!document.querySelector('dialog[open]')&&!e.target.closest?.('textarea')){e.preventDefault();closeWorkshopMobileEditor()}});
  /* Enter in the name field moves on to the prompt instead of submitting anything. */
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229&&e.target.matches?.('.wm-focus [data-workshop-frame="name"]')){e.preventDefault();document.querySelector('.wm-focus [data-workshop-frame="prompt"]')?.focus()}});
 /* When the keyboard finishes opening (visual viewport resize) re-centre the field being edited inside the shrunken layer. */
 let reveal=0;const revealField=()=>{clearTimeout(reveal);reveal=setTimeout(()=>{const active=document.activeElement;if(active&&active.matches?.('.wm-focus-body textarea,.wm-focus-body input'))active.scrollIntoView({block:'center',behavior:'smooth'})},80)};
 window.addEventListener('resize',revealField);window.visualViewport?.addEventListener('resize',revealField);
 workshopMobileMedia.addEventListener('change',()=>{if(ui.workspace===1&&workshop.view==='stories')render()});
 const syncBodyClass=()=>document.documentElement.classList.toggle('wm-focus-open',!!document.querySelector('.wm-focus'));
 new MutationObserver(syncBodyClass).observe(document.body,{childList:true,subtree:true});
}
function installAssemblyWorkshop(){
 renderQuietCreation=renderAssemblyWorkshop;renderCreationWorkspace=renderAssemblyWorkshop;
 const priorShell=renderShell;renderShell=function(...args){priorShell(...args);const queue=$('.top-queue');if(queue){queue.dataset.act='workshop-open-production';queue.removeAttribute('data-tab');queue.querySelector('b').textContent=workshop.queue.tasks.filter(t=>!['complete','cancelled'].includes(t.status)).length}if(ui.workspace===1){const crumb=$('.breadcrumb strong');if(crumb)crumb.textContent=({stories:'分镜工坊',presets:'预设工坊',production:'装配与生成'})[workshop.view]}};
 const previousRender=render;render=function(...args){const result=previousRender(...args);applyViewportLock();if(ui.workspace===1){const crumb=$('.breadcrumb strong');if(crumb)crumb.textContent=({stories:'分镜工坊',presets:'预设工坊',production:'装配与生成'})[workshop.view]}return result};
 const saveBeforeAutosave=save;save=function(...args){const result=saveBeforeAutosave.apply(this,args);scheduleWorkshopPresetCommit();return result};
 /* Every page switch and most actions call flushEditor first; a pending preset edit is committed there too. */
 const flushBeforeAutosave=flushEditor;flushEditor=function(...args){const result=flushBeforeAutosave.apply(this,args);commitWorkshopPresetDraft();return result};
 /* Ctrl/⌘ S out of habit: flush now instead of opening the browser's save-page dialog. */
 document.addEventListener('keydown',e=>{if(!(e.metaKey||e.ctrlKey)||e.altKey||e.key.toLowerCase()!=='s'||ui.workspace!==1||!['stories','presets'].includes(workshop.view)||document.querySelector('dialog[open]'))return;e.preventDefault();saveWorkshop().catch(err=>toast(err.message,'error'))});
 setInterval(()=>{if(document.querySelector('[data-autosave-status]'))refreshSettingsSaveStatus()},30000);
 installWorkshopKeys();
 installWorkshopContextMenu();
 installWorkshopMobileEditor();
 installProductionReorderDrag();
  const previousAction=handleAction;const retired=new Set(['v3-generate-plan','v3-generate-selected','v3-run-queue','start-batch','enqueue','create-book']);
  handleAction=async function(action,d={},element){
    if(action==='resume'){
      const b=bookBy(d.id);if(!b)return;
      const missing=missingIndices(b);
      if(!missing.length){toast('所有分镜已齐备，无需补齐');return}
      await refreshProduction();
      const task=workshop.queue.tasks.find(t=>t.albumId===b.id);
      if(task){await startProduction(task.id,{indices:missing});return}
      closeModal();ui.workspace=1;workshop.view='production';render();
      toast('这本画册没有可恢复的生产任务。请用原分镜重新装配，并核对缺帧范围后明确开始。');return;
    }
    if(action==='bulk-resume'){
      closeModal();ui.workspace=1;workshop.view='production';await refreshProduction();render();
      toast('已添加补齐任务。');return;
    }
    if(retired.has(action)){ui.workspace=1;workshop.view='production';render();await refreshProduction();toast('请在装配队列选择明确的任务或重跑范围；旧全局启动入口已停用。');return}
    if(['v3-create-tab','art-create-tab'].includes(action)){ui.workspace=1;workshop.view=d.tab==='queue'?'production':d.tab==='settings'||d.tab==='variables'?'presets':'stories';render();if(workshop.view==='production')await refreshProduction();return}
    return previousAction(action,d,element)
  };
 runQueue=async()=>{ui.workspace=1;workshop.view='production';render();await refreshProduction();toast('请点生成任务上的「开始」。')};
 const previousTarget=settingsEditorTarget;settingsEditorTarget=function(){return ui.workspace===1&&workshop.view==='presets'?workshopDraft():previousTarget()};
 const priorLibrary=openPresetLibrary;openPresetLibrary=function(id){if(ui.workspace===1&&workshop.view==='presets'){if(id)workshop.presetId=id;render();return}return priorLibrary(id)};
 Object.assign(v3Actions,{
  'production-page':d=>{workshop.taskPage=Number(d.page);render();$('.production-cards')?.scrollIntoView({block:'start'})},
  'workshop-open-production':async()=>{ui.workspace=1;workshop.view='production';render();await refreshProduction()},
  'workshop-tab':async d=>{
    if(workshop.view==='presets'&&workshopPreset())commitWorkshopPresetDraft();
    if(workshop.view==='stories'&&workshopStory())delete workshopStory().ownerPlanId;
    save();
    workshop.view=d.view;
    render();
    if(d.view==='production')await refreshProduction();
  },
  'workshop-binding-new':d=>{const index=d.index===undefined?-1:Number(d.index),b=workshopDraft().bindings[index]||{nodeId:'',path:'lora_name',source:'literal',type:'text',value:'',enabled:true};workshop.bindingIndex=index;modal('节点输入绑定',`${field('节点 ID',input('node',b.nodeId,'text','id="preset-binding-node"'))}${field('输入路径',input('path',b.path,'text','id="preset-binding-path" placeholder="lora_name 或 strength_model"'))}${field('值来源',`<select id="preset-binding-source">${[['literal','固定值'],['variable','预设变量']].map(([k,v])=>opt(k,v,b.source)).join('')}</select>`)}${field('数据类型',`<select id="preset-binding-type">${[['text','文本'],['number','数字'],['boolean','布尔'],['json','JSON']].map(([k,v])=>opt(k,v,b.type)).join('')}</select>`)}${field('值 / 变量标识符',input('value',b.value??'','text','id="preset-binding-value"'))}<label class="row"><span>启用此绑定</span><span class="switch"><input role="switch" type="checkbox" id="preset-binding-enabled" ${b.enabled?'checked':''}><span class="switch-track"></span></span></label><div class="modal-footer">${btn('取消','','close-modal')}${btn('保存绑定','disk','workshop-binding-save','','primary')}</div>`,'预设独立持有绑定；装配时与工作流映射合并。',true)},
  'workshop-binding-save':()=>{const d=workshopDraft(),nodeId=$('#preset-binding-node').value.trim(),path=$('#preset-binding-path').value.trim();if(!nodeId||!path)throw Error('节点 ID 与输入路径不能为空');const source=$('#preset-binding-source').value,valueType=$('#preset-binding-type').value,value=$('#preset-binding-value').value;if(source==='literal'&&valueType==='number'&&!Number.isFinite(Number(value)))throw Error('请输入有限数字');if(source==='literal'&&valueType==='json')JSON.parse(value);const b={nodeId,path,source,type:valueType,value,enabled:$('#preset-binding-enabled').checked};if(d.bindings.some((x,i)=>i!==workshop.bindingIndex&&x.enabled&&b.enabled&&x.nodeId===nodeId&&x.path===path))throw Error('此输入已有启用的绑定');if(workshop.bindingIndex<0)d.bindings.push(b);else d.bindings[workshop.bindingIndex]=b;d.dirty=true;save();closeModal();render()},
  'workshop-binding-delete':async d=>{if(await confirmAction('删除此绑定？','','删除')){workshopDraft().bindings.splice(Number(d.index),1);workshopDraft().dirty=true;save();render()}},
  'workshop-save':saveWorkshop,
  'workshop-preview':async()=>{await saveWorkshop();const p=workshopPreset();workshop.previewPresetId=p.id;workshop.requestId=uid('preview');modal('预设独立试绘',`${field('画面描述',`<textarea id="preset-preview-prompt">${esc(p.entries.filter(e=>e.type==='text'||e.type==='image').map(e=>'{'+e.key+'}').join(', '))}</textarea>`)}${field('图像服务',`<select id="preset-preview-channel">${ensureImageProviders().profiles.map(c=>opt(c.id,c.title,ensureImageProviders().active)).join('')}</select>`)}<div class="modal-footer">${btn('取消','','close-modal')}${btn('添加待命试绘','plus','workshop-preview-confirm','','primary')}</div>`,'用一张图片验证视觉设定。',true)},
  'workshop-preview-confirm':async()=>{const p=setBy(workshop.previewPresetId);if(!p)throw Error('预设已不存在');await productionRequest('assemble',{requestId:workshop.requestId,preview:true,previewPrompt:$('#preset-preview-prompt').value,presets:[{kind:p.category==='scenes'?'scenes':'characters',id:p.id}],projectId:p.projectId,title:p.title+' · 试绘',channelId:$('#preset-preview-channel').value,seed:1});closeModal();ui.workspace=1;workshop.view='production';await refreshProduction()},
  'production-test-connection':async()=>{await testEngine(false)},
  'production-details-copy':async()=>{await copyText(workshop.diagnosticsText||'')},
  'production-details':async d=>{const task=await productionRequest('tasks/'+d.id);modal('生成诊断 · '+task.title,'<div class="production-diagnostics"><div class="production-diagnostics-tools">'+btn('复制全部','copy','production-details-copy','','small')+'</div>'+task.pages.map(p=>`<section><h3>第 ${p.index+1} 幕</h3>${p.attempts.map(a=>`<details><summary>${esc(productionStatus(a.status))} · ${esc(a.error||a.upstream||'执行记录')}</summary>${(a.notices||[]).map(n=>`<p class="notice" role="status">${esc(n)}</p>`).join('')}<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(a.rawError||JSON.stringify({upstream:a.upstream,cancelReport:a.cancelReport,rateLimit:a.rateLimit},null,2))}</pre></details>`).join('')||'<p>尚未请求图像服务。</p>'}</section>`).join('')+'</div>','摘要用于排障，原始响应已去除可识别的私密凭据。',true);workshop.diagnosticsText=['生成诊断 · '+task.title,...task.pages.map(p=>'第 '+(p.index+1)+' 幕\n'+(p.attempts.map(a=>productionStatus(a.status)+' · '+(a.error||a.upstream||'执行记录')+'\n'+(a.rawError||JSON.stringify({upstream:a.upstream,cancelReport:a.cancelReport,rateLimit:a.rateLimit},null,2))).join('\n\n')||'尚未请求图像服务。'))].join('\n\n')},
  'production-preview':d=>{const t=workshop.queue.tasks.find(t=>t.albumId===d.id);if(t?.pages[0]?.result?.image)modal('预设试绘',imgTag(t.pages[0].result.image,t.title,'style="width:100%;max-height:70vh;object-fit:contain"'),'独立试绘结果；没有创建或修改画册。',true)},
  'workshop-new':()=>textModal(workshop.view==='stories'?'新建分镜':'新建预设','资产名称','',async title=>{if(!title.trim())throw Error('名称不能为空');const asset={id:uid(workshop.view==='stories'?'story':'preset'),projectId:state.activeProjectId,title:title.trim(),createdAt:Date.now()};if(workshop.view==='stories'){Object.assign(asset,{outline:'',frames:[{...makeFrame(0),name:'第一幕',prompt:'',negative:'',caption:''}]});state.templates.push(asset);workshop.storyId=asset.id;workshop.frame=0}else{Object.assign(asset,{entries:[],settingsGroups:[],bindings:[]});state.creation.variableSets.push(asset);workshop.presetId=asset.id}save();closeModal();render();if(!await savePythonWorkspace())throw Error('新资产保存未确认，请勿重复创建')}),
  'workshop-rename':()=>{const asset=workshop.view==='stories'?workshopStory():workshopPreset();textModal('重命名资产','资产名称',asset.title,async title=>{if(!title.trim())throw Error('名称不能为空');asset.title=title.trim();if(workshop.view==='presets')workshopDraft().title=asset.title;save();closeModal();await saveWorkshop();render()})},
  'workshop-frame':d=>selectWorkshopFrame(d.index),
  'workshop-mobile-open':d=>openWorkshopMobileEditor(d.index),
  'workshop-mobile-close':()=>closeWorkshopMobileEditor(),
  'workshop-mobile-step':d=>{const s=workshopStory();if(!s)return;const next=clamp(workshop.frame+Number(d.dir),0,s.frames.length-1);if(next!==workshop.frame){save();openWorkshopMobileEditor(next)}},
  'workshop-mobile-save-next':()=>{const s=workshopStory();if(!s)return;const keepTyping=workshop.mobileField&&(document.activeElement===workshop.mobileField||performance.now()-workshop.mobileBlurAt<500);save();
   if(workshop.frame>=s.frames.length-1){if(s.frames.length>=512)throw Error('最多 512 幕');s.frames.push({...makeFrame(s.frames.length),name:'第 '+(s.frames.length+1)+' 幕',prompt:storyBasePrompt(s)||'',negative:'',caption:''});delete s.ownerPlanId;s.updatedAt=Date.now();save();toast(localeString('已保存，新增第 {n} 幕',{n:s.frames.length}))}
   openWorkshopMobileEditor(workshop.frame+1);
   if(keepTyping){const prompt=document.querySelector('.wm-focus [data-workshop-frame="prompt"]');if(prompt){prompt.focus();prompt.setSelectionRange(prompt.value.length,prompt.value.length)}}},
  'workshop-frame-sel-toggle':()=>{workshop.selMode=!workshop.selMode;if(!workshop.selMode)workshop.pickedFrames.clear();render()},
  'workshop-frame-pick':d=>{const i=Number(d.index);if(workshop.pickedFrames.has(i))workshop.pickedFrames.delete(i);else workshop.pickedFrames.add(i);render()},
  'workshop-frame-pick-clear':()=>{workshop.pickedFrames.clear();render()},
  'workshop-frames-apply-base':()=>{const s=workshopStory(),base=storyBasePrompt(s);if(!s||!base)return;let n=0;for(const i of workshop.pickedFrames){const f=s.frames[i];if(f&&!String(f.prompt||'').trim()){f.prompt=base;n++}}if(!n)return;delete s.ownerPlanId;s.updatedAt=Date.now();save();render();toast(localeString('已为 {n} 幕插入起手模板',{n}))},
  'workshop-frames-copy':()=>{const s=workshopStory();if(!s)return;const picked=[...workshop.pickedFrames].filter(i=>s.frames[i]).sort((a,b)=>a-b);if(!picked.length)return;if(s.frames.length+picked.length>512)throw Error('最多 512 幕');const copies=picked.map(i=>{const f=clone(s.frames[i]);f.id=uid('frame');return f});const at=picked[picked.length-1]+1;s.frames.splice(at,0,...copies);workshop.pickedFrames=new Set(copies.map((_,k)=>at+k));workshop.frame=at;delete s.ownerPlanId;s.updatedAt=Date.now();save();render();toast(localeString('已复制 {n} 幕',{n:copies.length}))},
  'workshop-frame-pick-all':()=>{
    const s=workshopStory();if(!s)return;
    const q=String(workshop.frameSearch||'').trim().toLowerCase();
    const visibleIndices=s.frames.map((f,i)=>({f,i})).filter(({f,i})=>!q||(f.name||'').toLowerCase().includes(q)||String(i+1).includes(q)).map(x=>x.i);
    const allPicked=visibleIndices.length>0&&visibleIndices.every(i=>workshop.pickedFrames.has(i));
    if(allPicked)visibleIndices.forEach(i=>workshop.pickedFrames.delete(i));
    else visibleIndices.forEach(i=>workshop.pickedFrames.add(i));
    render();
  },
  'workshop-frame-pick-empty':()=>{
    const s=workshopStory();if(!s)return;
    workshop.pickedFrames.clear();
    s.frames.forEach((f,i)=>{
      if(!String(f.prompt||'').trim()&&!String(f.caption||'').trim())workshop.pickedFrames.add(i);
    });
    render();
  },
  'workshop-frame-delete-bulk':async()=>{
    const s=workshopStory();if(!s||!workshop.pickedFrames.size)return;
    const sortedIndices=[...workshop.pickedFrames].filter(idx=>Number.isInteger(idx)&&idx>=0&&idx<s.frames.length).sort((a,b)=>a-b);
    if(!sortedIndices.length)return;
    const count=sortedIndices.length;
    if(s.frames.length<=count)throw Error('不能删除所有分幕，至少保留一幕');
    if(!await confirmAction(localeString('删除选中的 {n} 幕？',{n:count}),'删除后可撤销。','删除'))return;
    const deletedEntries=sortedIndices.map(idx=>({idx,frame:clone(s.frames[idx])}));
    const originalFrameIndex=workshop.frame;
    for(const idx of [...sortedIndices].reverse())s.frames.splice(idx,1);
    workshop.pickedFrames.clear();workshop.selMode=false;
    workshop.frame=clamp(workshop.frame,0,s.frames.length-1);
    delete s.ownerPlanId;s.updatedAt=Date.now();
    save();render();
    undoToast(localeString('已删除 {n} 幕分镜',{n:count}),()=>{
      for(const entry of deletedEntries){
        s.frames.splice(Math.min(entry.idx,s.frames.length),0,entry.frame);
      }
      workshop.frame=originalFrameIndex;
      delete s.ownerPlanId;s.updatedAt=Date.now();
      save();render();
    });
  },
  'workshop-add-frame':()=>{const s=workshopStory();if(s.frames.length>=512)throw Error('最多 512 幕');s.frames.push({...makeFrame(s.frames.length),name:'第 '+(s.frames.length+1)+' 幕',prompt:'',negative:'',caption:''});workshop.frame=s.frames.length-1;workshop.pickedFrames.clear();delete s.ownerPlanId;s.updatedAt=Date.now();save();render()},
  'workshop-add-frames':()=>batchFramesModal(),
  'workshop-add-frames-confirm':()=>{
   const story=workshopStory();if(!story)return;const remaining=512-story.frames.length,count=Math.floor(Number($('#batch-frames-count')?.value));
   if(!(count>=1))throw Error('请输入 1 以上的数量');if(count>remaining)throw Error(localeString('最多还可新增 {n} 幕。',{n:remaining}));
   const base=$('#batch-frames-base')?.value||'',frames=createFramesBatch({count,start:story.frames.length,namePattern:$('#batch-frames-pattern')?.value||'第 {n} 幕',basePrompt:base});
   story.frames.push(...frames);if($('#batch-frames-remember')?.checked){if(base)story.basePrompt=base;else delete story.basePrompt}
   delete story.ownerPlanId;story.updatedAt=Date.now();workshop.frame=story.frames.length-frames.length;workshop.pickedFrames.clear();closeModal();save();render();toast(localeString('已新增 {n} 个分幕',{n:frames.length}));
  },
  'workshop-apply-base':d=>{
   const story=workshopStory(),index=workshopFrameIndex(d),frame=story?.frames[index],base=storyBasePrompt(story);if(!frame||!base||frame.prompt.trim())return;
   frame.prompt=base;workshop.frame=index;delete story.ownerPlanId;story.updatedAt=Date.now();save();render();const editor=$('[data-workshop-frame="prompt"]');if(editor){editor.focus();editor.setSelectionRange(editor.value.length,editor.value.length)}
  },
  /* Frame actions accept an explicit data-index (context menu) and fall back to the frame open in the editor. */
  'workshop-copy-frame':d=>{const s=workshopStory(),index=workshopFrameIndex(d),sourceFrame=s.frames[index];if(!sourceFrame)return;const f=clone(sourceFrame);f.id=uid('frame');s.frames.splice(index+1,0,f);workshop.frame=index+1;workshop.pickedFrames.clear();for(const r of state.rows){for(const versions of Object.values(r.storyVersions||{})){for(const v of versions){if(v.captions&&sourceFrame?.id&&sourceFrame.id in v.captions)v.captions[f.id]=v.captions[sourceFrame.id]}}}delete s.ownerPlanId;s.updatedAt=Date.now();save();render()},
  'workshop-insert-frame':d=>{const s=workshopStory();if(!s)return;if(s.frames.length>=512)throw Error('最多 512 幕');const index=Math.min(workshopFrameIndex(d),s.frames.length-1),frame={...makeFrame(index+1),name:'第 '+(index+2)+' 幕',prompt:'',negative:'',caption:''};s.frames.splice(index+1,0,frame);workshop.frame=index+1;workshop.pickedFrames.clear();delete s.ownerPlanId;s.updatedAt=Date.now();save();render();$('[data-workshop-frame="name"]')?.focus()},
  'workshop-delete-frame':async d=>{const s=workshopStory(),index=workshopFrameIndex(d),frame=s?.frames[index];if(!frame)return;if(await confirmAction('删除「'+(frame.name||'第 '+(index+1)+' 幕')+'」？','','删除')){s.frames.splice(index,1);if(workshop.frame>index)workshop.frame--;else if(workshop.frame>=s.frames.length)workshop.frame=Math.max(0,s.frames.length-1);workshop.pickedFrames.clear();if(!s.frames.length)workshop.mobileEditor=false;delete s.ownerPlanId;s.updatedAt=Date.now();save();render()}},
  'workshop-move-frame':d=>{const s=workshopStory(),frames=s.frames,i=workshopFrameIndex(d),j=i+Number(d.dir);if(!frames[i]||j<0||j>=frames.length)return;[frames[j],frames[i]]=[frames[i],frames[j]];workshop.frame=j;workshop.pickedFrames.clear();delete s.ownerPlanId;s.updatedAt=Date.now();save();render()},
  'production-toggle-pages':d=>{if(workshop.openTasks.has(d.id))workshop.openTasks.delete(d.id);else workshop.openTasks.add(d.id);render();document.querySelector(`[data-task-details="${CSS.escape(d.id)}"]`)?.scrollIntoView({block:'nearest'})},
  'workshop-import':()=>pickFile('.json,.zip',importWorkshop,true),
  'workshop-export':async()=>{await saveWorkshop();const asset=workshop.view==='stories'?workshopStory():workshopPreset();if(!asset)return;const file=await workshopExportDocument(workshop.view,asset);download(file.name,file.blob,'application/zip')},
  'workshop-export-pick':()=>openWorkshopExportDialog(),
  'workshop-pick-all-assets':()=>{const boxes=[...document.querySelectorAll('[data-workshop-export]')],all=boxes.every(b=>b.checked);boxes.forEach(b=>{b.checked=!all});updateWorkshopExportCount()},
  'workshop-pick-current-asset':()=>{const current=(workshop.view==='stories'?workshopStory():workshopPreset())?.id;document.querySelectorAll('[data-workshop-export]').forEach(b=>{b.checked=b.dataset.workshopExport===current});updateWorkshopExportCount()},
  'workshop-export-confirm':confirmWorkshopExport,
  'assembly-new':showAssemblyDialog,
  'assembly-confirm':async()=>{const button=$('[data-act="assembly-confirm"]');if(button.disabled)return;const title=$('#assembly-title').value.trim();if(!title)throw Error('请为生成画册命名');button.disabled=true;try{save();try{await savePythonWorkspace()}catch(_){}const presets=$$('[data-assembly-preset]:checked').map(el=>{const p=setBy(el.dataset.assemblyPreset);return {id:p.id,kind:p.category==='scenes'?'scenes':'characters'}});await productionRequest('assemble',{requestId:workshop.requestId,title,projectId:state.activeProjectId,storyId:$('#assembly-story').value,presets,channelId:$('#assembly-channel').value,seed:Number($('#assembly-seed').value)});closeModal();workshop.view='production';await refreshProduction();toast('已添加待命任务，尚未调用模型')}finally{button.disabled=false}},
  'production-start':d=>startProduction(d.id),
  'production-start-selected':d=>startProductionMany(productionScope(d).ids||[]),
  'production-sequence':d=>{const scope=productionScope(d);return startProductionSequence(scope.ids||(scope.id?[scope.id]:null))},
  'production-recover':async d=>{if(await confirmAction('恢复已生成的结果？','仅重试本地发布，不再次请求模型。','恢复发布')){adoptProductionQueue(await productionRequest('recover-publication',{id:d.id,index:Number(d.index)}));render()}},
  'production-clone':async d=>{const scope=productionScope(d),ids=scope.ids||(scope.id?[scope.id]:[]);if(!ids.length)return;closeModal();let last=null;for(const id of ids)last=await productionRequest('clone',{id});await refreshProduction();render();toast(ids.length>1?localeString('已克隆 {n} 本为新的待命任务',{n:ids.length}):localeString('已克隆为「{title}」，尚未开始生成',{title:last?.title||''}))},
  'production-clone-adjust':async d=>{
    const t=workshop.queue.tasks.find(x=>x.id===d.id);if(!t)return;
    const source=await productionRequest('tasks/'+d.id+'/clone-source');
    workshop.cloneDraft={id:t.id,source};
    modal('克隆并微调任务',`<p class="help" style="margin-bottom:12px">复制原任务冻结的分镜、预设与参数，可在下方微调副本内容。</p>
      ${field('新画册名称',`<input id="queue-clone-title" value="${esc((t.title+' 副本').slice(0,150))}" maxlength="150" required>`)}
      ${field('分幕并发',`<input id="queue-clone-concurrency" type="number" min="1" max="${workshop.queue.maxConcurrency||128}" step="1" value="${t.concurrency??''}" placeholder="${esc(localeString('全局默认 {n}',{n:workshop.queue.concurrency||1}))}">`)}
      <details class="quiet-advanced" open style="margin-top:12px">
        <summary>微调分镜提示词（${source.frames.length} 幕）</summary>
        <div class="queue-clone-frames" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;margin-top:8px">
          ${source.frames.map((f,i)=>`<fieldset style="border:1px solid var(--border,#333);border-radius:6px;padding:8px 12px">
            <legend style="font-weight:bold;font-size:12px">第 ${i+1} 幕 · ${esc(f.name||'分幕')}</legend>
            <label style="display:block;margin-top:4px;font-size:12px">提示词<textarea data-clone-frame="${i}" data-clone-field="prompt" rows="2" style="width:100%">${esc(f.prompt||'')}</textarea></label>
            <label style="display:block;margin-top:4px;font-size:12px">负向提示词<textarea data-clone-frame="${i}" data-clone-field="negative" rows="1" style="width:100%">${esc(f.negative||'')}</textarea></label>
            <label style="display:block;margin-top:4px;font-size:12px">台词 / 旁白<textarea data-clone-frame="${i}" data-clone-field="caption" rows="1" style="width:100%">${esc(f.caption||'')}</textarea></label>
          </fieldset>`).join('')}
        </div>
      </details>
      <details class="quiet-advanced" style="margin-top:12px">
        <summary>微调生成参数</summary>
        <div style="margin-top:8px">
          <label style="display:block;font-size:12px">全局负向提示词<textarea id="queue-clone-negative" rows="2" style="width:100%">${esc(source.globalNegative||'')}</textarea></label>
          ${source.canSeed?`<label class="row small soft" style="margin-top:8px"><input type="checkbox" id="queue-clone-fixed-seed" ${source.seedEnabled?'checked':''}>固定种子</label><input type="number" min="0" max="4294967295" step="1" id="queue-clone-seed" value="${source.seed??1}">`:''}
        </div>
      </details>
      <div class="modal-footer"><button type="button" class="btn ghost" data-act="close-modal">取消</button><button type="button" class="btn ghost" data-act="production-clone" data-id="${esc(t.id)}">直接快速克隆</button><button type="button" class="btn primary" data-act="production-clone-confirm">确认创建微调副本</button></div>`,
      t.title);
  },
  'production-clone-confirm':async()=>{
    const titleEl=$('#queue-clone-title'),concEl=$('#queue-clone-concurrency');
    if(!titleEl?.reportValidity()||!concEl?.reportValidity())return;
    const draft=workshop.cloneDraft;if(!draft)return;
    const adjustments={frames:clone(draft.source.frames),globalNegative:$('#queue-clone-negative')?.value||''};
    for(const el of $$('[data-clone-frame]')){adjustments.frames[Number(el.dataset.cloneFrame)][el.dataset.cloneField]=el.value;}
    const seedEl=$('#queue-clone-seed'),fixedSeedEl=$('#queue-clone-fixed-seed');
    if(seedEl&&draft.source.canSeed){
      if(fixedSeedEl?.checked){
        const s=Number(seedEl.value);
        if(!Number.isInteger(s)||s<0||s>4294967295)throw Error('随机种子需为 0–4294967295 的整数');
        adjustments.seed=s;adjustments.seedEnabled=true;
      }else{
        adjustments.seedEnabled=false;
      }
    }
    const concVal=concEl?.value?.trim();const concurrency=concVal?Number(concVal):null;
    const res=await productionRequest('clone',{id:draft.id,title:titleEl.value.trim(),concurrency,adjustments});
    closeModal();await refreshProduction();render();
    toast(localeString('已创建微调副本「{title}」，尚未开始生成',{title:res?.title||''}));
  },
  'production-clear-finished':async()=>{const c=productionQueueControls();if(!c.canClear){toast('没有已完成的任务记录');return}if(!await confirmAction(localeString('清空 {n} 条已完成的任务记录？',{n:c.finishedCount}),'','清空'))return;const result=await productionRequest('clear-finished',{});adoptProductionQueue(result);render();toast(localeString('已移除 {n} 条已完成记录',{n:result.removed??c.finishedCount}))},
  'production-select-all':()=>{workshop.pickedTasks=new Set(workshop.queue.tasks.map(t=>t.id));render()},
  'production-select-none':()=>{workshop.pickedTasks.clear();render()},
  'production-move':async d=>{const order=workshop.queue.tasks.map(t=>t.id),from=order.indexOf(d.id);if(from<0)return;const to=d.to==='start'?0:d.to==='end'?order.length-1:Math.max(0,Math.min(order.length-1,from+Number(d.dir||0)));if(to===from)return;order.splice(to,0,...order.splice(from,1));await reorderProduction(order)},
  'production-page-preview':previewProductionPage,

  'production-rerun':d=>startProduction(d.id,{indices:[Number(d.index)]}),
  'production-page-edit':d=>openProductionFrameEditor(d.id,Number(d.index)),
  'production-live-retry':()=>{workshop.liveSyncRequested=false;return loadProductionLiveSync()},
  'production-frame-save':d=>saveProductionFrame(d.rerun==='1'),
  'production-rename':d=>{const t=productionTask(d.id);if(!t)return;textModal('重命名任务','任务名称',t.title,async title=>{const next=String(title||'').trim();if(!next)throw Error('名称不能为空');if(next.length>150)throw Error('名称最多 150 字');if(next!==t.title)adoptProductionQueue(await productionRequest('rename',{id:d.id,title:next}));closeModal();render()},'只修改这个生成任务的名称；已生成的画册保留原名，可在画册集中单独重命名。')},
  'production-rerun-tail': d => {
    const task = workshop.queue.tasks.find(t => t.id === d.id);
    if (!task) return;
    const indices = (task.pages || []).filter(p => p.index >= Number(d.index)).map(p => p.index);
    startProduction(d.id, { indices });
  },
  'production-pause':async d=>{const scope=productionScope(d);adoptProductionQueue(await productionRequest('pause',scope));render();toast(scope.id||scope.ids?'已暂停所选画册的后续分幕；已发出的分幕可能仍返回':'已暂停所有后续调度；已发出的分幕可能仍返回')},
  'production-resume':async d=>{adoptProductionQueue(await productionRequest('resume',productionScope(d)));render()},
  'production-cancel':async d=>{
    const scope=productionScope(d),targets=scope.id||scope.ids?productionScopeTasks(scope):workshop.queue.tasks.filter(t=>productionTaskAccess(t).busy);
    const running=targets.filter(t=>productionTaskAccess(t).running);
    if(running.length){const local=running.every(productionIsLocal),title=scope.id?'停止这本画册？':scope.ids?localeString('停止所选的 {n} 本画册？',{n:running.length}):localeString('停止全部 {n} 本正在生成的画册？',{n:running.length});
      if(!await confirmAction(title,(local?'阻止后续分幕，迟到结果不覆盖原图。ComfyUI 中已在执行的任务会收到取消请求。':'阻止后续分幕，迟到结果不覆盖原图。已提交到提供商的请求可能仍计费。')+(scope.id?'':' 排队中的任务会退回待命。'),'停止'))return}
    adoptProductionQueue(await productionRequest('cancel',scope));render();if(!running.length&&targets.length)toast(targets.length>1?'已将所选任务移出顺次队列':'已移出顺次队列')},
  'production-remove':async d=>{const scope=productionScope(d),targets=productionScopeTasks(scope),removable=targets.filter(t=>productionTaskAccess(t).canRemove);if(!removable.length){toast('所选任务都在运行或排队中，请先停止它们');return}
    const defaultMsg='只移除装配记录。'+(removable.length<targets.length?' 运行或排队中的任务会被跳过。':'');
    const deleteMsg=(removable.length>1?localeString('将同时删除这 {n} 本对应的画册及其生成内容，此操作不可撤销。',{n:removable.length}):localeString('将同时删除对应的画册及其生成内容，此操作不可撤销。'))+(removable.length<targets.length?' 运行或排队中的任务会被跳过。':'');
    const conf=await confirmAction(
      removable.length>1?localeString('移除 {n} 条任务记录？',{n:removable.length}):'移除任务记录？',
      defaultMsg,
      '移除',
      {
        checkbox:{
          label:localeString('同时删除对应的画册'),
          checked:false,
          onChange:checked=>{
            const msgEl=$('#confirm-message');
            if(msgEl){msgEl.textContent=checked?deleteMsg:defaultMsg;msgEl.hidden=!msgEl.textContent.trim()}
          }
        }
      }
    );
    if(!conf)return;
    const deleteAlbums=typeof conf==='object'?!!conf.checked:false;
    const removePayload=removable.length===1&&!scope.ids?{id:removable[0].id}:{ids:removable.map(t=>t.id)};
    if(deleteAlbums)removePayload.delete_albums=true;
    const result=await productionRequest('remove',removePayload);
    adoptProductionQueue(result);
    if(result?.deletedAlbumIds?.length){
      applyDeletedAlbums(result.deletedAlbumIds);
      save(true);
      if(typeof refreshGallery==='function')refreshGallery();
    }
    render();
    if(deleteAlbums&&result?.deletedAlbumIds?.length){
      toast(removable.length>1?localeString('已移除 {n} 条任务记录及对应画册',{n:removable.length}):localeString('已移除任务记录及对应画册'));
    }else{
      toast(removable.length>1?localeString('已移除 {n} 条任务记录',{n:removable.length}):localeString('已移除任务记录'));
    }
  },
  'workshop-preview-remove':async d=>{if(await confirmAction('删除这张试绘？','会移除这条试绘任务记录及其缩略图。','删除试绘')){adoptProductionQueue(await productionRequest('remove',{id:d.id}));render();toast('已删除试绘。')}},

  'production-read':async d=>{const report=await ComfyComic.fileLibrary?.refreshAlbum?.(d.id).catch(()=>null);if(!bookBy(d.id))throw Error(report?.status==='missing'?'这本画册还没有写入文件库，请等第一页生成完成后再看。':'画册不存在。');if(report?.status==='created'&&ui.workspace===0)refreshGallery();await openReader(d.id)}
 });
 document.addEventListener('toggle',e=>{if(e.target.matches('[data-task-details]')){if(e.target.open)workshop.openTasks.add(e.target.dataset.taskDetails);else workshop.openTasks.delete(e.target.dataset.taskDetails)}},true);
 document.addEventListener('input',e=>{const el=e.target;if(el.dataset.workshopFrame){const s=workshopStory(),f=s?.frames[workshop.frame];if(f){f[el.dataset.workshopFrame]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;delete s.ownerPlanId;s.updatedAt=Date.now();save();if(el.type==='checkbox')render()}}if(el.dataset.workshopStory){workshopStory()[el.dataset.workshopStory]=el.value;save()}if(el.dataset.workshopPreset){const d=workshopDraft();if(el.dataset.workshopPreset==='bindings'){try{const value=JSON.parse(el.value);if(!Array.isArray(value))throw Error();d.bindings=value;el.setCustomValidity('')}catch{el.setCustomValidity('请输入绑定数组 JSON');return}}else d[el.dataset.workshopPreset]=el.value;d.dirty=true;save()}});
 document.addEventListener('change',e=>{if(e.target.id==='workshop-story-select'){workshop.storyId=e.target.value;workshop.frame=0;workshop.pickedFrames.clear();workshop.selMode=false;workshop.mobileEditor=false;render()}if(e.target.id==='workshop-preset-select'){commitWorkshopPresetDraft();workshop.presetId=e.target.value;render()}if(e.target.dataset?.productionConcurrency!==undefined)void commitProductionConcurrency(e.target);if(e.target.dataset?.productionLive!==undefined)void commitProductionLiveSync(e.target)});
 const queueBusy=()=>workshop.queue.active?.length||workshop.queue.lane?.length;
 async function poll(){try{if(!document.hidden&&(ui.workspace===0||ui.workspace===1||$('#reader')?.open||queueBusy()))await refreshProduction()}catch(e){workshop.queue.fault=e.message}finally{clearTimeout(workshop.pollTimer);workshop.pollTimer=setTimeout(poll,queueBusy()?2000:15000)}}
 workshop.poll=poll;
 /* Entering the shelf or opening a reader should show the newest pages at once rather than after the next poll tick. */
 const navigateBefore=navigate;navigate=function(index,...rest){const result=navigateBefore(index,...rest);if([0,1].includes(Number(index)))scheduleProductionPoll(60);return result};
 const openArtReaderBefore=openArtReader;openArtReader=function(...args){const result=openArtReaderBefore(...args);scheduleProductionPoll(60);return result};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearTimeout(workshop.pollTimer);void poll()}});
 workshop.pollTimer=setTimeout(poll,2000);
 setInterval(()=>{if(document.hidden)return;for(const el of document.querySelectorAll('[data-rate-task]')){const task=workshop.queue.tasks.find(t=>t.id===el.dataset.rateTask);if(task?.rateLimit)el.textContent='服务限流，等待 '+productionRetrySeconds(task.rateLimit)+' 秒后重试；不计入连续故障。'}},1000);
}
