/* Creative assets and production are separate domains. No generated book edits a source. */
'use strict';
const workshop={renderPending:false,onlyUncertain:false,taskPage:0,syncedAlbums:new Map(),openTasks:new Set(),view:'stories',storyId:null,presetId:null,frame:0,queue:{tasks:[],batch:[],paused:true,active:null},loading:false,requestId:null,etag:null,serverEpochMs:null,receivedAt:null,selMode:false,pickedFrames:new Set(),frameSearch:'',mobileEditor:false,mobileStepDir:0,mobileField:null,mobileBlurAt:0};

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
function workshopHeader(){return `<header class="workshop-heading"><div><span class="context-kicker">创作资产 · 独立保存与复用</span><h1>${{stories:'分镜工坊',presets:'预设工坊',production:'装配与生成'}[workshop.view]}</h1><p>${{stories:'先把故事写好。不绑定角色，也不绑定一本画册。',presets:'让人物、画风与视觉设定，成为可反复使用的资产。',production:'选择故事，搭配预设。准备妥当后，再开始生成。'}[workshop.view]}</p></div>${workshop.view==='production'?btn('新建生成任务','plus','assembly-new','','primary'):btn(workshop.view==='stories'?'新建分镜':'新建预设','plus','workshop-new','','primary')}</header><nav class="quiet-tabs workshop-tabs" aria-label="资产与生产">${[['stories','分镜工坊'],['presets','预设工坊'],['production','装配与队列']].map(([id,label])=>`<button data-act="workshop-tab" data-view="${id}" class="${workshop.view===id?'active':''}" ${workshop.view===id?'aria-current="page"':''}>${label}</button>`).join('')}</nav>`}
/* B8: the same five fields mean different things per channel; say so where they are edited. */
function workshopFrameParameterNotice(frame){
 const provider=activeImageProfile()?.provider||'comfyui',on=frame.renderOverride===true;
 const text=provider==='comfyui'
  ?(on?'ComfyUI：已开启覆盖，这些参数会通过工作流映射中的「分镜参数」写入对应节点。':'ComfyUI：默认保持工作流蓝图原值。开启下方开关后，这些参数才会写入已映射「分镜参数」的节点。')
  :provider==='novelai'?'NovelAI：宽度、高度、步数、CFG 与种子在生成时直接生效（宽高需为 64 的倍数）。'
  :'OpenAI 兼容：尺寸与质量由渠道设置决定；Chat 协议会把宽高比写入提示词。步数、CFG、种子不会发送。';
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
   ${btn(last?'保存并新增一幕':'保存并下一幕','check','workshop-mobile-save-next','','primary')}
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
 return `<div class="workshop-asset-head wm-asset-head"><label>当前分镜资产<select id="workshop-story-select">${stories.map(t=>opt(t.id,t.title,story.id)).join('')}</select></label><div class="wm-asset-actions">${btn('去装配此分镜','arrow','first-run-assemble-story','','primary')}${btn('重命名','edit','workshop-rename')}${btn('导入','file-import','workshop-import')}${btn('导出分镜','file-export','workshop-export')}${btn('保存分镜','disk','workshop-save','','ghost')}</div></div>
  <details class="story-synopsis"><summary>故事梗概 / 起手模板（可选）</summary>${field('作品简介',`<textarea data-workshop-story="outline" class="workshop-outline" placeholder="可选：为作品补充一段简介。">${esc(story.outline||'')}</textarea>`)}<div class="field"><label class="label" for="workshop-base-prompt">起手模板</label>${promptEditorHTML({attrs:'id="workshop-base-prompt" data-workshop-story="basePrompt" class="workshop-base-prompt"',value:storyBasePrompt(story),placeholder:'可选：新分幕的起手提示词，例如 {character}, {outfit}, {style}, {scene}, ',context:'workshop'})}</div></details>
  <section class="wm-stream ${workshop.selMode?'is-selmode':''}" aria-label="分幕列表">
   <header class="wm-stream-head"><div><strong>${localeString('共 {total} 幕',{total:story.frames.length})}</strong><small>轻点卡片进入全屏编辑，左右滑动切换分幕</small></div><div class="wm-stream-tools">${btn('新增分幕','plus','workshop-add-frame','','small')}${btn('批量新增…','copy','workshop-add-frames','','small ghost')}${btn(workshop.selMode?'退出管理':'批量管理','check','workshop-frame-sel-toggle','',workshop.selMode?'small active':'small ghost')}</div></header>
   ${workshop.selMode?`<div class="workshop-frames-selbar">${selectionBarHTML({count:workshop.pickedFrames.size,unit:'幕',allPicked,allAct:'workshop-frame-pick-all',smart:[{label:'选空幕',act:'workshop-frame-pick-empty'}],deleteAct:'workshop-frame-delete-bulk',exitAct:'workshop-frame-sel-toggle'})}</div>`:''}
   <div class="wm-cards">${cards||'<div class="eco-empty"><h3>从第一个镜头开始。</h3></div>'}</div>
  </section>${workshop.mobileEditor?workshopMobileEditorHTML(story):''}`}
function renderStoryWorkshop(){
 const stories=projectTemplates(),story=workshopStory();if(!story)return '<div class="eco-empty"><h3>给故事留一张白纸。</h3><p>新建分镜资产，或导入可复用的故事。</p>'+btn('导入分镜','file-import','workshop-import')+'</div>';
 workshop.storyId=story.id;workshop.frame=clamp(workshop.frame,0,Math.max(0,story.frames.length-1));const frame=story.frames[workshop.frame];
 if(workshopIsMobile()){if(!story.frames.length)workshop.mobileEditor=false;return renderStoryWorkshopMobile(stories,story)}
 workshop.mobileEditor=false;
 return `<div class="workshop-asset-head"><label>当前分镜资产<select id="workshop-story-select">${stories.map(t=>opt(t.id,t.title,story.id)).join('')}</select></label><div>${btn('重命名','edit','workshop-rename')}${btn('导入','file-import','workshop-import')}${btn('导出分镜','file-export','workshop-export')}${btn('保存分镜','disk','workshop-save','','ghost')}${btn('去装配此分镜','arrow','first-run-assemble-story','','primary')}</div></div><details class="story-synopsis"><summary>故事梗概 / 起手模板（可选）</summary>${field('作品简介',`<textarea data-workshop-story="outline" class="workshop-outline" placeholder="可选：为作品补充一段简介。">${esc(story.outline||'')}</textarea>`)}<div class="field"><label class="label" for="workshop-base-prompt">起手模板</label>${promptEditorHTML({attrs:'id="workshop-base-prompt" data-workshop-story="basePrompt" class="workshop-base-prompt"',value:storyBasePrompt(story),placeholder:'可选：新分幕的起手提示词，例如 {character}, {outfit}, {style}, {scene}, ',context:'workshop'})}<p class="help">批量新增的分幕以它开头；单击「新增分幕」仍是空白分幕，可随时一键插入。</p></div></details><div class="workshop-editor ${workshop.selMode?'is-selmode':''}"><nav class="workshop-frames" aria-label="分幕列表"><div class="workshop-frames-list ${workshop.pickedFrames.size?'has-selection':''}" aria-multiselectable="true">${story.frames.map((f,i)=>{const picked=workshop.pickedFrames.has(i);return `<button data-act="workshop-frame" data-index="${i}" class="${i===workshop.frame?'active':''} ${picked?'is-picked desktop-selected':''}" aria-selected="${picked}"><small>${pad(i+1)}</small><span>${esc(f.name||'未命名分幕')}</span></button>`}).join('')}</div><p class="workshop-frames-status" role="status" aria-live="polite" ${workshop.pickedFrames.size?'':'hidden'}>${workshop.pickedFrames.size?localeString('已选 {n} 幕 · 右键操作',{n:workshop.pickedFrames.size}):''}</p><div class="workshop-frames-actions">${btn('新增分幕','plus','workshop-add-frame','','small')}${btn('批量新增…','copy','workshop-add-frames','','small')}</div></nav><section class="workshop-page" data-editor-key="${esc(frame?.id||story.id)}">${frame?`<div class="workshop-page-title"><input data-workshop-frame="name" value="${esc(frame.name)}" aria-label="分幕名称">${ibtn('up','workshop-move-frame','分幕前移','data-dir="-1"')}${ibtn('down','workshop-move-frame','分幕后移','data-dir="1"')}${ibtn('copy','workshop-copy-frame','复制分幕')}${ibtn('trash','workshop-delete-frame','删除分幕')}</div><div class="negative-heading prompt-heading"><label for="workshop-frame-prompt">正向提示词</label>${!frame.prompt.trim()&&storyBasePrompt(story)?btn('插入起手模板','plus','workshop-apply-base','','small ghost'):''}</div>${promptEditorHTML({attrs:'id="workshop-frame-prompt" data-workshop-frame="prompt" class="workshop-prompt"',value:frame.prompt,placeholder:'描述画面、镜头与人物动作；使用 {变量} 引用装配时的视觉设定。',context:'workshop'})}<div class="negative-heading"><label>负向提示词</label>${btn('应用到所有分幕','copy','workshop-negative-all','','small ghost')}</div>${promptEditorHTML({attrs:'aria-label="负向提示词" data-workshop-frame="negative" class="workshop-negative"',value:frame.negative||'',placeholder:'排除不需要的内容，也可引用 {画风负向} 或 {角色负向}。',context:'workshop'})}${field('台词 / 旁白',promptEditorHTML({attrs:'aria-label="分镜台词" data-workshop-frame="caption" class="workshop-caption"',value:frame.caption||'',context:'workshop',className:'prose'}))}<details class="quiet-advanced"><summary>此幕画面参数</summary>${workshopFrameParameterNotice(frame)}<div class="grid2">${['width','height','steps','cfg','seed'].map(k=>field(({width:'宽度',height:'高度',steps:'步数',cfg:'CFG',seed:'随机种子'})[k],input(k,frame[k],'number',`data-workshop-frame="${k}"`))).join('')}</div></details>`:'<div class="eco-empty"><h3>从第一个镜头开始。</h3></div>'}</section></div>`;
}
function renderPresetWorkshop(){
 const sets=projectVariableSets(),p=workshopPreset(),draft=workshopDraft();if(!p)return '<div class="eco-empty"><h3>建立你的视觉资产库。</h3><p>人物、画风、场景，可以分别保存为预设。</p>'+btn('导入预设','file-import','workshop-import')+'</div>';
 return `<div class="workshop-asset-head"><label>当前视觉预设<select id="workshop-preset-select">${sets.map(s=>opt(s.id,s.title,p.id)).join('')}</select></label><div>${btn('重命名','edit','workshop-rename')}${btn('导入','file-import','workshop-import')}${btn('导出预设','file-export','workshop-export')}${btn('独立试绘','brush','workshop-preview')}${btn('保存预设','disk','workshop-save','','primary')}</div></div><div class="workshop-preset-preview">${workshop.queue.tasks.filter(t=>t.purpose==='preview'&&t.previewPresetId===p.id&&t.pages[0]?.result?.image).slice(-3).map(t=>{const a=productionTaskAccess(t,workshop.queue);return `<figure class="workshop-preview-figure" data-production-task="${esc(t.id)}">${imgTag(t.pages[0].result.image,'预设试绘')}<figcaption>${esc(t.title)}</figcaption>${ibtn('trash','workshop-preview-remove',a.canRemove?'删除这张试绘':'试绘任务仍在批次中，请先取消批次。',`data-id="${esc(t.id)}" ${a.canRemove?'':'disabled'}`)}</figure>`}).join('')}${draft.variables.filter(e=>e.type==='image'&&e.value?.src).map(e=>`<figure>${imgTag(e.value.src,settingLabel(e))}<figcaption>${esc(settingLabel(e))}</figcaption></figure>`).join('')}</div><div class="settings-form-toolbar"><div class="settings-toolbar-label">视觉属性 <span>${draft.variables.length}</span></div><div class="settings-toolbar-actions">${btn('新增属性','plus','art-setting-add')}${btn('新建分组','plus','settings-group-new',`data-owner="${esc(draft.id)}"`)}${btn('编辑分组','edit','settings-group-edit',`data-owner="${esc(draft.id)}"`)}</div></div>${renderSettingsGroups(draft)}<details class="quiet-advanced"><summary>LoRA / 节点输入绑定</summary><div class="row wrap" style="margin:20px 0">${btn('添加节点绑定','plus','workshop-binding-new')}</div>${draft.bindings.map((b,i)=>`<div class="settings-row"><div class="grow"><strong>${esc(b.nodeId)} · ${esc(b.path)}</strong><p>${esc(b.source)} → ${esc(b.value??'')} · ${esc(b.type||'auto')}</p></div>${ibtn('edit','workshop-binding-new','编辑绑定',`data-index="${i}"`)}${ibtn('trash','workshop-binding-delete','删除绑定',`data-index="${i}"`)}</div>`).join('')}<p class="help">按需将视觉变量连接到工作流节点。未配置时保留工作流原值；同一输入不能重复启用。</p></details>`;
}
function productionStatus(value){return ({standby:'待命',ready:'批次待命',preparing:'前置准备',running:'生成中',complete:'完成',partial:'部分完成',failed:'异常',cancelled:'已取消',interrupted:'中断待核对',uncertain:'结果未确认'})[value]||value}
const PRODUCTION_PAGE_SIZE=6;
function productionVisibleTasks(){return workshop.queue.tasks.filter(t=>!workshop.onlyUncertain||(t.pages||[]).some(p=>p.state==='uncertain'))}
/* The queue is FIFO and sequential runs follow it, so pages slice the queue in that order; taskPage=Infinity means "the newest page". */
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
 const task=workshop.queue.tasks.find(t=>t.id===d.id),page=task?.pages?.find(p=>p.index===Number(d.index));
 if(!page?.result?.image){toast('此幕暂无可查看的图片');return}
 const title=localeString('第 {n} 幕',{n:page.index+1});
 modal(task.title+' · '+title,imgTag(page.result.image,title,'class="production-page-full-image"'),'',true);
}
function renderProductionPage(t,p,a=productionTaskAccess(t)){const labels=productionPageLabels(t,p),last=p.attempts.at(-1),lock=a.reason?`disabled title="${esc(a.reason)}"`:'';return `<div class="production-page" data-page-index="${p.index}"><div class="production-page-number">${pad(p.index+1)}</div>${p.result?.image?`<button type="button" class="production-page-preview" data-act="production-page-preview" data-id="${esc(t.id)}" data-index="${p.index}" aria-label="${esc(localeString('查看第 {n} 幕图片',{n:p.index+1}))}" title="${esc(localeString('查看图片'))}">${imgTag(thumbnailURL(p.result.image),'第 '+(p.index+1)+' 幕','loading="lazy"')}</button>`:'<span class="production-page-blank"></span>'}<div class="grow"><strong class="page-${esc(p.state)}">${productionStatus(p.state)}</strong><small>${p.attemptCount} 次尝试${last?.upstream?' · 上游任务 '+esc(last.upstream):''}${p.result&&p.state!=='complete'?' · 原图已保留':''}</small>${last?.error?`<p>${esc(last.error)}</p>`:''}${last?.notices?.length?`<details class="production-slot-notices"><summary>本次写入与跳过原因</summary>${last.notices.map(n=>`<p>${esc(n)}</p>`).join('')}</details>`:''}</div><div>${p.state!=='complete'&&p.attempts.at(-1)?.phase==='publish'?btn('恢复已生成结果','disk','production-recover',`data-id="${esc(t.id)}" data-index="${p.index}" ${a.canRecover?'':'disabled title="请先结束或取消当前批次。"'}`,'small'):''}${btn(labels.single,labels.icon,'production-rerun',`data-id="${esc(t.id)}" data-index="${p.index}" ${a.canStart?'':lock}`,'small')}${btn(labels.tail,'list','production-rerun-tail',`data-id="${esc(t.id)}" data-index="${p.index}" ${a.canStart?'':lock}`,'small ghost')}</div></div>`}
function productionOverridesSummary(o){
 if(!o||typeof o!=='object')return '';const parts=[];
 const models=typeof o.model==='string'?[['',o.model]]:Object.entries(o.model||{});
 for(const [key,name] of models)if(name)parts.push(`<span title="${esc(key?key+' → '+name:name)}"><i>模型${key?' #'+esc(key):''}</i>${esc(WorkflowSlots.loraStem(name))}</span>`);
 if(Array.isArray(o.loras))parts.push(o.loras.length?o.loras.filter(l=>l?.name).map(l=>`<span title="${esc(l.name)}"><i>追加 LoRA</i>${esc(WorkflowSlots.loraStem(l.name))}<b>×${esc(WorkflowSlots.numberText(l.strength??1))}</b></span>`).join(''):'<span><i>LoRA</i>无用户追加</span>');
 if(o.unpin?.length)parts.push(`<span><i>解锁移除</i>${o.unpin.map(n=>esc(WorkflowSlots.loraStem(n))).join('、')}</span>`);
 return parts.length?`<p class="production-overrides">${parts.join('')}</p>`:'';
}
function productionTaskAccess(t,q=workshop.queue){
  const batch=q.batch||[],active=q.active===t.id,inBatch=active||batch.includes(t.id),paused=!!q.paused;
  const heldByOther=q.active?!active:(batch.length>0&&!paused);
  const canStart=!inBatch&&!heldByOther,resumable=inBatch&&paused;
  const reason=inBatch?(paused?'此任务已暂停：可继续生成，或取消当前批次。':'此任务正在当前批次中运行。'):heldByOther?(paused?'另一本画册暂停在半途，请先继续或取消当前批次。':'有任务正在运行，请等待完成或先取消当前批次。'):(t.status==='complete'?'已全部完成':'');
  const canBatch=canStart&&t.status!=='complete';
  const batchReason=!canStart?reason:(t.status==='complete'?'已全部完成':'');
  const canRemove=!inBatch;
  const removeReason=inBatch?'任务在当前批次中，请先取消批次。':'';
  return {active,inBatch,paused,heldByOther,canStart,canBatch,batchReason,resumable,reason,canRemove,removeReason,canRecover:!q.active&&!batch.length};
}
function productionCollectionMeta(projectId){if(!projectId||projectId===state.activeProjectId)return '';const project=state.projects.find(p=>p.id===projectId);return `<span class="production-collection" title="生成的画册会归入这个画册集，而不是当前浏览的画册集">画册集 · ${esc(project?.title||'已删除的画册集')}</span>`}
function renderProductionCard(t,q=workshop.queue){const done=(t.pages||[]).filter(p=>p.state==='complete').length,a=productionTaskAccess(t,q),lock=a.reason?`disabled title="${esc(a.reason)}"`:'';return `<article class="production-card" data-production-task="${esc(t.id)}"><header><div class="production-card-title"><span class="production-state state-${esc(t.status)}">${productionStatus(t.status)}</span><h2>${esc(t.title)}</h2></div><div class="production-count"><b>${done}</b><span>/ ${(t.pages||[]).length} 幕</span></div></header><p class="production-meta"><span>分镜 · ${esc(t.sources.story)}</span><span>预设 · ${esc(t.sources.presets.join(' + ')||'未选预设')}</span><span>渠道 · ${esc(t.sources.channel)}</span>${productionCollectionMeta(t.sources.projectId)}</p>${productionOverridesSummary(t.sources.overrides)}${productionStrip(t)}${t.rateLimit?`<p class="production-rate" role="status" data-rate-task="${esc(t.id)}">服务限流，等待 ${productionRetrySeconds(t.rateLimit)} 秒后重试；不计入连续故障。</p>`:''}${t.cancelReport?`<p class="production-error">${esc(t.cancelReport.message||(t.cancelReport.state==='cancel_dispatched'?'ComfyUI 已接受本任务的定向取消请求。':'ComfyUI 本任务已结束或不在队列中。'))}</p>`:''}${t.error?`<p class="production-error">${esc(t.error)}</p>`:''}${(t.notices||[]).map(n=>`<p class="production-notice" role="status">${esc(n)}</p>`).join('')}<div class="production-card-actions">${a.resumable?btn('继续生成','play','production-resume',`data-id="${esc(t.id)}" title="从暂停处继续当前批次"`,'primary'):btn('开始生成','play','production-start',`data-id="${esc(t.id)}" ${a.canStart?(t.status==='complete'?'disabled title="已全部完成"':''):lock}`,'primary')}${btn('从此处顺次生成','list','production-batch',`data-id="${esc(t.id)}" ${a.canStart?'':lock}`)}${btn('重算前置并继续','refresh','production-reprepare',`data-id="${esc(t.id)}" ${a.canStart?'':lock}`,'ghost small')}${btn(t.purpose==='preview'?'查看试绘':'查看画册','book',t.purpose==='preview'?'production-preview':'production-read',`data-id="${esc(t.albumId)}" ${!(t.pages||[]).some(p=>p.result)?'disabled':''}`,'ghost small')}${btn('诊断详情','help','production-details',`data-id="${esc(t.id)}"`,'ghost small')}${btn('移除任务','trash','production-remove',`data-id="${esc(t.id)}" ${a.canRemove?'':'disabled title="任务在当前批次中，请先取消批次。"'}`,'ghost small production-remove')}</div><details class="production-pages" data-task-details="${esc(t.id)}" ${workshop.openTasks.has(t.id)?'open':''}><summary>展开分幕进度与局部重跑</summary><div class="production-page-list">${(t.pages||[]).map(p=>renderProductionPage(t,p,a)).join('')}</div></details></article>`}
function productionQueueControls(q=workshop.queue){const pending=!!q.active||q.batch.length>0;return {pending,running:!!q.active&&!q.paused,pausedBatch:pending&&!!q.paused,canPause:pending&&!q.paused,canResume:pending&&!!q.paused,canCancel:pending}}
function renderProductionWorkshop(){const q=workshop.queue,visible=productionVisibleTasks(),paging=productionPaging(visible.length),c=productionQueueControls(q);return `<div class="production-controls"><div><strong>${c.running?'正在运行一本画册':c.pausedBatch?'批次已暂停':'等待你的安排'}</strong><small>${c.pending?`${q.paused?'调度已暂停':'调度已就绪'} · ${q.batch.length} 本在当前批次中`:'没有进行中的批次'}</small></div><div>${btn(workshop.onlyUncertain?'显示全部任务':'只看未确认结果','eye','production-uncertain-filter','','ghost')}${btn('导出核对清单','file-export','production-uncertain-export','','ghost')}${btn('全局暂停','pause','production-pause',c.canPause?'':`disabled title="${q.paused?'调度已暂停':'没有正在运行的任务'}"`,'ghost')}${btn('恢复当前批次','play','production-resume',c.canResume?'':'disabled title="只有暂停中的批次可以恢复"','ghost')}${btn('取消运行与批次','stop','production-cancel',c.canCancel?'':'disabled title="没有进行中的批次"','danger')}</div></div>${q.fault?`<div class="eco-safety danger">存储异常：${esc(q.fault)}。已阻止后续调度，请检查磁盘后重启。</div>`:''}<div class="production-cards">${visible.slice(paging.start,paging.end).map(t=>renderProductionCard(t,q)).join('')||`<div class="eco-empty"><h3>${workshop.onlyUncertain&&q.tasks.length?'没有需要核对的结果。':'先装配，再生成。'}</h3></div>`}</div>${renderProductionPager(paging,visible.length)}`}
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
  if(response.status!==304){const result=await response.json();if(result.error)throw Error(result.error);const next=result.data;workshop.serverEpochMs=next.serverEpochMs;workshop.receivedAt=performance.now();delete next.serverEpochMs;changed=!nativeEqual(next,workshop.queue);workshop.queue=next;workshop.etag=response.headers.get('ETag')}
  await syncProducedAlbums();
  workshop.renderPending=workshop.renderPending||changed;
  if(workshop.renderPending&&ui.workspace===1&&workshop.view==='production'&&!$('#modal').open){render();workshop.renderPending=false}
 }finally{workshop.loading=false}
}
function productionRetrySeconds(rate){
 const now=workshop.serverEpochMs==null?Date.now():workshop.serverEpochMs+(performance.now()-workshop.receivedAt);
 return Math.max(0,Math.ceil(((rate.untilEpochMs??rate.until*1000)-now)/1000));
}

function showAssemblyDialog(){return openAssemblyDesigner()}
async function saveWorkshop(){
 if(workshop.view==='presets'&&workshopPreset()){const p=workshopPreset(),d=workshopDraft();if($('[data-workshop-preset=bindings]')?.validationMessage)throw Error('LoRA 绑定 JSON 无效，请先修正');commitSettingsGroupNames(d);p.entries=clone(mergedSettingEntries(d));p.settingsGroups=clone(d.settingsGroups);delete p.negative;p.bindings=clone(d.bindings);d.base=presetContentSignature(p);d.dirty=false}
 if(workshop.view==='stories'&&workshopStory())delete workshopStory().ownerPlanId;
 save();if(!await savePythonWorkspace())throw Error('保存尚未确认，请检查冲突或服务状态');toast('独立资产已保存');
}
async function importWorkshop(file){if(!file)return;await saveWorkshop();const expected=workshop.view==='presets'?'variables':'storyboards',body={projectId:state.activeProjectId,expectedKind:expected};if(file.name.endsWith('.zip'))body.zip=(await blobData(file)).split(',')[1];else body.document=JSON.parse(await file.text());const info=await(await request('/api/library/inspect',post(body))).json();if(!await confirmAction('导入独立资产？',info.title+'','导入'))return;const result=await(await request('/api/library/import',post(body))).json();await connectPythonBackend();if(expected==='storyboards')workshop.storyId=result.id;else workshop.presetId=result.id;render()}
async function startProduction(id,options={}){const current=workshop.queue.tasks.find(t=>t.id===id),local=productionIsLocal(current),rerun=options.indices&&current?.pages.some(p=>options.indices.includes(p.index)&&productionPageHasRun(p));
 /* B23: a local ComfyUI run costs GPU time, not money; only cloud channels get the billing warning. */
 const detail=options.forcePrepare?(local?'重新执行前置脚本，忽略缓存和未确认标记；本地 ComfyUI 不产生费用，但会重新占用显卡。':'重新执行前置脚本，忽略缓存和未确认标记，可能重复计费。'):options.indices?(local?'只处理指定幕次。成功后替换该页，失败保留原图；本地 ComfyUI 生成不产生费用。':'只处理指定幕次。成功后替换该页，失败保留原图；已经发出的请求可能计费。'):(local?'将通过本地 ComfyUI 开始生成，占用显卡但不产生费用。':'将开始生成，云端渠道可能产生费用。');
 if(!await confirmAction(options.indices?(rerun?'确认局部重跑？':'确认局部生成？'):options.sequential?'从此任务开始顺次生成？':'开始生成这本画册？',detail,'确认开始'))return;const task=workshop.queue.tasks.find(t=>t.id===id),uncertain=options.sequential?workshop.queue.tasks.slice(workshop.queue.tasks.indexOf(task)).some(t=>t.pages.some(p=>p.state==='uncertain')):task?.pages.some(p=>p.state==='uncertain'&&(!options.indices||options.indices.includes(p.index)));if(uncertain&&!await confirmAction(local?'存在未确认的结果':'未确认结果可能已计费',local?'上一次的结果尚未确认，重跑会覆盖它；请先在 ComfyUI 历史中核对。':'重跑可能重复计费。','我已核对，仍要重跑'))return;workshop.queue=await productionRequest('start',{id,...options,trusted:true,confirmUncertain:!!uncertain});render()}
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
    {label:'保存分镜',icon:'disk',act:'workshop-save',shortcut:'Ctrl/⌘ ↵ 下一幕'},
    {label:'去装配此分镜',icon:'arrow',act:'first-run-assemble-story',hint:'下一步：搭配预设，生成画册'},
    '-',
    {label:'分镜资产',icon:'story',children:[
      {label:'重命名…',icon:'edit',act:'workshop-rename'},
      {label:'新建分镜…',icon:'plus',act:'workshop-new'},
      '-',
      {label:'导入分镜 / 预设…',icon:'upload',act:'workshop-import'},
      {label:'导出此分镜',icon:'download',act:'workshop-export'}
    ]},
    workshopViewSwitchItems()
  ];
}
function workshopPresetContextItems(draft){
  const owner={owner:draft.id};
  return [
    {label:'新增属性',icon:'plus',act:'art-setting-add',primary:true,hint:'人物、服装、画风……都能成为变量'},
    {label:'新建分组',icon:'folder',act:'settings-group-new',data:owner},
    {label:'编辑分组…',icon:'edit',act:'settings-group-edit',data:owner},
    '-',
    {label:'独立试绘',icon:'brush',act:'workshop-preview',hint:'只用这套预设画一张，检验效果'},
    {label:'保存预设',icon:'disk',act:'workshop-save'},
    {label:'新建生成任务…',icon:'play',act:'assembly-new',hint:'下一步：选择分镜与预设，装配任务'},
    '-',
    {label:'预设资产',icon:'brush',children:[
      {label:'重命名…',icon:'edit',act:'workshop-rename'},
      {label:'新建预设…',icon:'plus',act:'workshop-new'},
      {label:'添加节点绑定…',icon:'nodes',act:'workshop-binding-new'},
      '-',
      {label:'导入分镜 / 预设…',icon:'upload',act:'workshop-import'},
      {label:'导出此预设',icon:'download',act:'workshop-export'}
    ]},
    workshopViewSwitchItems()
  ];
}
function productionTaskContextItems(task,a=productionTaskAccess(task)){
  const data={id:task.id},hasResult=(task.pages||[]).some(p=>p.result),open=workshop.openTasks.has(task.id);
  return [
    a.resumable
      ?{label:'继续生成',icon:'play',act:'production-resume',data,primary:true,hint:'从暂停处继续当前批次'}
      :{label:a.active?'此任务正在运行':'开始生成',icon:'play',act:'production-start',data,primary:true,disabled:!a.canStart||task.status==='complete',hint:a.reason},
    {label:'从此处顺次生成',icon:'list',act:'production-batch',data,disabled:!a.canBatch,hint:a.batchReason},
    {label:'重算前置并继续',icon:'refresh',act:'production-reprepare',data,disabled:!a.canStart,hint:a.reason},
    '-',
    {label:task.purpose==='preview'?'查看试绘':'查看画册',icon:'book',act:task.purpose==='preview'?'production-preview':'production-read',data:{id:task.albumId},disabled:!hasResult},
    {label:open?'收起分幕进度':'展开分幕进度',icon:'expand',act:'production-toggle-pages',data,checked:open},
    {label:'诊断详情',icon:'help',act:'production-details',data},
    '-',
    {label:'移除任务记录…',icon:'trash',act:'production-remove',data,danger:true,disabled:!a.canRemove,hint:a.removeReason}
  ];
}
function productionPageContextItems(task,page,a=productionTaskAccess(task)){
  const labels=productionPageLabels(task,page),data={id:task.id,index:page.index},publishFailed=page.state!=='complete'&&page.attempts?.at(-1)?.phase==='publish';
  return [
    page.result?.image?{label:'查看图片',icon:'eye',act:'production-page-preview',data}:null,
    {label:labels.single,icon:labels.icon,act:'production-rerun',data,primary:true,disabled:!a.canStart,hint:a.reason},
    {label:labels.tail,icon:'list',act:'production-rerun-tail',data,disabled:!a.canStart,hint:a.reason},
    publishFailed?{label:'恢复已生成结果',icon:'disk',act:'production-recover',data,disabled:!a.canRecover,hint:'只重试本地发布，不再请求模型'}:null,
    '-',
    {label:'整本任务',icon:'box',children:productionTaskContextItems(task,a)}
  ];
}
function productionContextItems(){
  const q=workshop.queue;
  return [
    {label:'新建生成任务…',icon:'plus',act:'assembly-new',primary:true,hint:'选择分镜与预设，装配后再明确开始'},
    '-',
    {label:'全局暂停',icon:'pause',act:'production-pause',disabled:!productionQueueControls(q).canPause,hint:q.paused?'调度已暂停':''},
    {label:'恢复当前批次',icon:'play',act:'production-resume',disabled:!productionQueueControls(q).canResume,hint:'只有暂停中的批次可以恢复'},
    {label:'取消运行与批次…',icon:'stop',act:'production-cancel',danger:true,disabled:!productionQueueControls(q).canCancel},
    '-',
    {label:'只看未确认结果',icon:'eye',act:'production-uncertain-filter',checked:workshop.onlyUncertain},
    {label:'导出核对清单',icon:'download',act:'production-uncertain-export'},
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
    return {el:null,label:'分镜工坊右键菜单',title:story.title,subtitle:`${story.frames.length} 幕 · 分镜资产`,items:workshopStoryContextItems(story)};
  }
  if(workshop.view==='presets'){
    const draft=workshopDraft();if(!draft)return null;
    return {el:null,label:'预设工坊右键菜单',title:workshopPreset()?.title||'视觉预设',subtitle:`${draft.variables.length} 个视觉属性`,items:workshopPresetContextItems(draft)};
  }
  const card=target.closest('article.production-card[data-production-task]'),task=card&&workshop.queue.tasks.find(t=>t.id===card.dataset.productionTask);
  if(task){
    const access=productionTaskAccess(task),pageEl=target.closest('.production-page[data-page-index]'),page=pageEl&&(task.pages||[]).find(p=>p.index===Number(pageEl.dataset.pageIndex));
    if(page)return {el:pageEl,label:'分幕进度右键菜单',title:`${task.title} · 第 ${page.index+1} 幕`,subtitle:`${productionStatus(page.state)} · ${page.attemptCount} 次尝试`,items:productionPageContextItems(task,page,access)};
    const done=(task.pages||[]).filter(p=>p.state==='complete').length;
    return {el:card,label:'生成任务右键菜单',title:task.title,subtitle:`${productionStatus(task.status)} · ${done} / ${(task.pages||[]).length} 幕`,items:productionTaskContextItems(task,access)};
  }
  return {el:null,label:'装配与队列右键菜单',title:'装配与生成',subtitle:workshop.queue.active?'正在运行一本画册':workshop.queue.paused?'调度已暂停':'调度已就绪',items:productionContextItems()};
}
function openWorkshopContextMenu(spec,x,y){
  if(!spec||typeof openContextMenu!=='function')return false;
  spec.el?.classList.add('is-context');
  return !!openContextMenu({x,y,label:spec.label,title:spec.title,subtitle:spec.subtitle,items:spec.items,focusEl:spec.el||document.activeElement,onClose:()=>spec.el?.classList.remove('is-context')});
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
  /* Which editor the chips insert into; the timestamp lets「保存并下一幕」keep the keyboard when it was open. */
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
 installWorkshopKeys();
 installWorkshopContextMenu();
 installWorkshopMobileEditor();
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
 runQueue=async()=>{ui.workspace=1;workshop.view='production';render();await refreshProduction();toast('请选择任务卡上的开始按钮。')};
 const previousTarget=settingsEditorTarget;settingsEditorTarget=function(){return ui.workspace===1&&workshop.view==='presets'?workshopDraft():previousTarget()};
 const priorLibrary=openPresetLibrary;openPresetLibrary=function(id){if(ui.workspace===1&&workshop.view==='presets'){if(id)workshop.presetId=id;render();return}return priorLibrary(id)};
 Object.assign(v3Actions,{
  'production-uncertain-filter':()=>{workshop.onlyUncertain=!workshop.onlyUncertain;workshop.taskPage=0;render()},
  'production-page':d=>{workshop.taskPage=Number(d.page);render();$('.production-cards')?.scrollIntoView({block:'start'})},
  'production-uncertain-export':async()=>{const tasks=[];for(const t of workshop.queue.tasks.filter(t=>t.pages.some(p=>p.state==='uncertain'))){const detail=await productionRequest('tasks/'+t.id);tasks.push({id:t.id,title:t.title,pages:detail.pages.filter(p=>p.state==='uncertain').map(p=>({index:p.index,state:p.state,attempts:p.attempts.map(a=>({status:a.status,upstream:a.upstream,startedAt:a.startedAt,finishedAt:a.finishedAt,error:a.error}))}))})}download('mio-uncertain-checklist.json',JSON.stringify({generatedAt:new Date().toISOString(),notice:'先核对上游；本操作不发起生成或重试。',tasks},null,2),'application/json')},
  'workshop-open-production':async()=>{ui.workspace=1;workshop.view='production';render();await refreshProduction()},
  'workshop-tab':async d=>{
    if(workshop.view==='presets'&&workshopPreset()){
      const p=workshopPreset(),draft=workshopDraft();
      if(!$('[data-workshop-preset=bindings]')?.validationMessage){
        commitSettingsGroupNames(draft);
        p.entries=clone(mergedSettingEntries(draft));
        p.settingsGroups=clone(draft.settingsGroups);
        delete p.negative;
        p.bindings=clone(draft.bindings);
        draft.base=presetContentSignature(p);
        draft.dirty=false;
      }
    }
    if(workshop.view==='stories'&&workshopStory())delete workshopStory().ownerPlanId;
    save();
    workshop.view=d.view;
    render();
    if(d.view==='production')await refreshProduction();
  },
  'workshop-binding-new':d=>{const index=d.index===undefined?-1:Number(d.index),b=workshopDraft().bindings[index]||{nodeId:'',path:'lora_name',source:'literal',type:'text',value:'',enabled:true};workshop.bindingIndex=index;modal('节点输入绑定',`${field('节点 ID',input('node',b.nodeId,'text','id="preset-binding-node"'))}${field('输入路径',input('path',b.path,'text','id="preset-binding-path" placeholder="lora_name 或 strength_model"'))}${field('值来源',`<select id="preset-binding-source">${[['literal','固定值'],['variable','预设变量']].map(([k,v])=>opt(k,v,b.source)).join('')}</select>`)}${field('数据类型',`<select id="preset-binding-type">${[['text','文本'],['number','数字'],['boolean','布尔'],['json','JSON']].map(([k,v])=>opt(k,v,b.type)).join('')}</select>`)}${field('值 / 变量标识符',input('value',b.value??'','text','id="preset-binding-value"'))}<label class="row"><span>启用此绑定</span><span class="switch"><input role="switch" type="checkbox" id="preset-binding-enabled" ${b.enabled?'checked':''}><span class="switch-track"></span></span></label><div class="modal-footer">${btn('取消','','close-modal')}${btn('保存绑定','disk','workshop-binding-save','','primary')}</div>`,'预设独立持有绑定；装配时与工作流映射合并。',true)},
  'workshop-binding-save':()=>{const d=workshopDraft(),nodeId=$('#preset-binding-node').value.trim(),path=$('#preset-binding-path').value.trim();if(!nodeId||!path)throw Error('节点 ID 与输入路径不能为空');const source=$('#preset-binding-source').value,valueType=$('#preset-binding-type').value,value=$('#preset-binding-value').value;if(source==='literal'&&valueType==='number'&&!Number.isFinite(Number(value)))throw Error('请输入有限数字');if(source==='literal'&&valueType==='json')JSON.parse(value);const b={nodeId,path,source,type:valueType,value,enabled:$('#preset-binding-enabled').checked};if(d.bindings.some((x,i)=>i!==workshop.bindingIndex&&x.enabled&&b.enabled&&x.nodeId===nodeId&&x.path===path))throw Error('此输入已有启用的绑定');if(workshop.bindingIndex<0)d.bindings.push(b);else d.bindings[workshop.bindingIndex]=b;d.dirty=true;save();closeModal();render()},
  'workshop-binding-delete':async d=>{if(await confirmAction('删除此绑定？','只修改当前预设草稿，已经装配的任务不变。','删除')){workshopDraft().bindings.splice(Number(d.index),1);workshopDraft().dirty=true;save();render()}},
  'workshop-save':saveWorkshop,
  'workshop-preview':async()=>{await saveWorkshop();const p=workshopPreset();workshop.previewPresetId=p.id;workshop.requestId=uid('preview');modal('预设独立试绘',`${field('画面描述',`<textarea id="preset-preview-prompt">${esc(p.entries.filter(e=>e.type==='text'||e.type==='image').map(e=>'{'+e.key+'}').join(', '))}</textarea>`)}${field('图像渠道',`<select id="preset-preview-channel">${ensureImageProviders().profiles.map(c=>opt(c.id,c.title,ensureImageProviders().active)).join('')}</select>`)}<div class="modal-footer">${btn('取消','','close-modal')}${btn('添加待命试绘','plus','workshop-preview-confirm','','primary')}</div>`,'用一张图片验证视觉设定。',true)},
  'workshop-preview-confirm':async()=>{const p=setBy(workshop.previewPresetId);if(!p)throw Error('预设已不存在');await productionRequest('assemble',{requestId:workshop.requestId,preview:true,previewPrompt:$('#preset-preview-prompt').value,presets:[{kind:p.category==='scenes'?'scenes':'characters',id:p.id}],projectId:p.projectId,title:p.title+' · 试绘',channelId:$('#preset-preview-channel').value,seed:1});closeModal();ui.workspace=1;workshop.view='production';await refreshProduction()},
  'production-details':async d=>{const task=await productionRequest('tasks/'+d.id);modal('生成诊断 · '+task.title,task.pages.map(p=>`<section><h3>第 ${p.index+1} 幕</h3>${p.attempts.map(a=>`<details><summary>${esc(productionStatus(a.status))} · ${esc(a.error||a.upstream||'执行记录')}</summary>${(a.notices||[]).map(n=>`<p class="notice" role="status">${esc(n)}</p>`).join('')}<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(a.rawError||JSON.stringify({upstream:a.upstream,cancelReport:a.cancelReport,rateLimit:a.rateLimit},null,2))}</pre></details>`).join('')||'<p>尚未请求生成服务。</p>'}</section>`).join(''),'摘要用于排障，原始响应已去除可识别的私密凭据。',true)},
  'production-preview':d=>{const t=workshop.queue.tasks.find(t=>t.albumId===d.id);if(t?.pages[0]?.result?.image)modal('预设试绘',imgTag(t.pages[0].result.image,t.title,'style="width:100%;max-height:70vh;object-fit:contain"'),'独立试绘结果；没有创建或修改画册。',true)},
  'workshop-new':()=>textModal(workshop.view==='stories'?'新建分镜资产':'新建视觉预设','资产名称','',async title=>{if(!title.trim())throw Error('名称不能为空');const asset={id:uid(workshop.view==='stories'?'story':'preset'),projectId:state.activeProjectId,title:title.trim(),createdAt:Date.now()};if(workshop.view==='stories'){Object.assign(asset,{outline:'',frames:[{...makeFrame(0),name:'第一幕',prompt:'',negative:'',caption:''}]});state.templates.push(asset);workshop.storyId=asset.id;workshop.frame=0}else{Object.assign(asset,{entries:[],settingsGroups:[],bindings:[]});state.creation.variableSets.push(asset);workshop.presetId=asset.id}save();closeModal();render();if(!await savePythonWorkspace())throw Error('新资产保存未确认，请勿重复创建')}),
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
    if(!await confirmAction(localeString('删除选中的 {n} 幕？',{n:count}),'只修改分镜资产，不影响已装配的任务；删除后可撤销。','删除'))return;
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
  'workshop-delete-frame':async d=>{const s=workshopStory(),index=workshopFrameIndex(d),frame=s?.frames[index];if(!frame)return;if(await confirmAction('删除「'+(frame.name||'第 '+(index+1)+' 幕')+'」？','只修改分镜资产，不影响已装配的任务。','删除')){s.frames.splice(index,1);if(workshop.frame>index)workshop.frame--;else if(workshop.frame>=s.frames.length)workshop.frame=Math.max(0,s.frames.length-1);workshop.pickedFrames.clear();if(!s.frames.length)workshop.mobileEditor=false;delete s.ownerPlanId;s.updatedAt=Date.now();save();render()}},
  'workshop-move-frame':d=>{const s=workshopStory(),frames=s.frames,i=workshopFrameIndex(d),j=i+Number(d.dir);if(!frames[i]||j<0||j>=frames.length)return;[frames[j],frames[i]]=[frames[i],frames[j]];workshop.frame=j;workshop.pickedFrames.clear();delete s.ownerPlanId;s.updatedAt=Date.now();save();render()},
  'production-toggle-pages':d=>{if(workshop.openTasks.has(d.id))workshop.openTasks.delete(d.id);else workshop.openTasks.add(d.id);render();document.querySelector(`[data-task-details="${CSS.escape(d.id)}"]`)?.scrollIntoView({block:'nearest'})},
  'workshop-import':()=>pickFile('.json,.zip',importWorkshop),
  'workshop-export':async()=>{await saveWorkshop();const document=workshop.view==='stories'?clone(workshopStory()):{...clone(workshopPreset()),entries:clone(mergedSettingEntries(workshopDraft()))};const response=await request('/api/library/export-document',post({kind:workshop.view==='stories'?'storyboards':document.category==='scenes'?'scenes':'characters',document}));download(document.title+'.mio.zip',await response.blob(),'application/zip')},
  'assembly-new':showAssemblyDialog,
  'assembly-confirm':async()=>{const button=$('[data-act="assembly-confirm"]');if(button.disabled)return;const title=$('#assembly-title').value.trim();if(!title)throw Error('请为生成画册命名');button.disabled=true;try{save();try{await savePythonWorkspace()}catch(_){}const presets=$$('[data-assembly-preset]:checked').map(el=>{const p=setBy(el.dataset.assemblyPreset);return {id:p.id,kind:p.category==='scenes'?'scenes':'characters'}});await productionRequest('assemble',{requestId:workshop.requestId,title,projectId:state.activeProjectId,storyId:$('#assembly-story').value,presets,channelId:$('#assembly-channel').value,seed:Number($('#assembly-seed').value)});closeModal();workshop.view='production';await refreshProduction();toast('已添加待命任务，尚未调用模型')}finally{button.disabled=false}},
  'production-start':d=>startProduction(d.id),
  'production-recover':async d=>{if(await confirmAction('恢复已生成的结果？','仅重试本地发布，不再次请求模型。不覆盖生成期间被另外编辑的页面。','恢复发布')){workshop.queue=await productionRequest('recover-publication',{id:d.id,index:Number(d.index)});render()}},
  'production-batch':d=>startProduction(d.id,{sequential:true}),
  'production-reprepare':d=>startProduction(d.id,{forcePrepare:true}),
  'production-page-preview':previewProductionPage,
  'production-rerun':d=>startProduction(d.id,{indices:[Number(d.index)]}),
  'production-rerun-tail': d => {
    const task = workshop.queue.tasks.find(t => t.id === d.id);
    if (!task) return;
    const indices = (task.pages || []).filter(p => p.index >= Number(d.index)).map(p => p.index);
    startProduction(d.id, { indices });
  },
  'production-pause':async()=>{workshop.queue=await productionRequest('pause',{});render();toast('已暂停后续调度；已提交的分幕可能仍返回')},
  'production-resume':async()=>{workshop.queue=await productionRequest('resume',{});render()},
  'production-cancel':async()=>{const local=workshop.queue.active&&productionIsLocal(workshop.queue.tasks.find(t=>t.id===workshop.queue.active));if(await confirmAction('取消运行与当前批次？',local?'阻止后续请求，迟到结果不覆盖原图。ComfyUI 中已在执行的任务会收到取消请求。':'阻止后续请求，迟到结果不覆盖原图。已提交到提供商的请求可能仍计费。','取消运行')){workshop.queue=await productionRequest('cancel',{});render()}},
  'production-remove':async d=>{if(await confirmAction('移除任务记录？','只移除装配记录，不删除已生成的画册。','移除')){workshop.queue=await productionRequest('remove',{id:d.id});render()}},
  'workshop-preview-remove':async d=>{if(await confirmAction('删除这张试绘？','会移除这条试绘任务记录及其缩略图；预设本身不受影响。','删除试绘')){workshop.queue=await productionRequest('remove',{id:d.id});render();toast('已删除试绘。')}},
  'production-read':async d=>{const report=await ComfyComic.fileLibrary?.refreshAlbum?.(d.id).catch(()=>null);if(!bookBy(d.id))throw Error(report?.status==='missing'?'这本画册还没有写入文件库，请等第一页生成完成后再看。':'画册不存在。');if(report?.status==='created'&&ui.workspace===0)refreshGallery();await openReader(d.id)}
 });
 document.addEventListener('toggle',e=>{if(e.target.matches('[data-task-details]')){if(e.target.open)workshop.openTasks.add(e.target.dataset.taskDetails);else workshop.openTasks.delete(e.target.dataset.taskDetails)}},true);
 document.addEventListener('input',e=>{const el=e.target;if(el.dataset.workshopFrame){const s=workshopStory(),f=s?.frames[workshop.frame];if(f){f[el.dataset.workshopFrame]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;delete s.ownerPlanId;s.updatedAt=Date.now();save();if(el.type==='checkbox')render()}}if(el.dataset.workshopStory){workshopStory()[el.dataset.workshopStory]=el.value;save()}if(el.dataset.workshopPreset){const d=workshopDraft();if(el.dataset.workshopPreset==='bindings'){try{const value=JSON.parse(el.value);if(!Array.isArray(value))throw Error();d.bindings=value;el.setCustomValidity('')}catch{el.setCustomValidity('请输入绑定数组 JSON');return}}else d[el.dataset.workshopPreset]=el.value;d.dirty=true;save()}});
 document.addEventListener('change',e=>{if(e.target.id==='workshop-story-select'){workshop.storyId=e.target.value;workshop.frame=0;workshop.pickedFrames.clear();workshop.selMode=false;workshop.mobileEditor=false;render()}if(e.target.id==='workshop-preset-select'){workshop.presetId=e.target.value;render()}});
 async function poll(){try{if(!document.hidden&&(ui.workspace===0||ui.workspace===1||$('#reader')?.open||workshop.queue.active||workshop.queue.batch.length))await refreshProduction()}catch(e){workshop.queue.fault=e.message}finally{clearTimeout(workshop.pollTimer);workshop.pollTimer=setTimeout(poll,workshop.queue.active||workshop.queue.batch.length?2000:15000)}}
 workshop.poll=poll;
 /* Entering the shelf or opening a reader should show the newest pages at once rather than after the next poll tick. */
 const navigateBefore=navigate;navigate=function(index,...rest){const result=navigateBefore(index,...rest);if([0,1].includes(Number(index)))scheduleProductionPoll(60);return result};
 const openArtReaderBefore=openArtReader;openArtReader=function(...args){const result=openArtReaderBefore(...args);scheduleProductionPoll(60);return result};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearTimeout(workshop.pollTimer);void poll()}});
 workshop.pollTimer=setTimeout(poll,2000);
 setInterval(()=>{if(document.hidden)return;for(const el of document.querySelectorAll('[data-rate-task]')){const task=workshop.queue.tasks.find(t=>t.id===el.dataset.rateTask);if(task?.rateLimit)el.textContent='服务限流，等待 '+productionRetrySeconds(task.rateLimit)+' 秒后重试；不计入连续故障。'}},1000);
}
