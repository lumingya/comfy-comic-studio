/* Single-owner workspace policy and two-mode, standby-only assembly design. */
'use strict';
const assemblyDesign={mode:'wizard',step:0,storyId:'',channelId:'',workflowId:'',workflowQuery:'',seedEnabled:false,seed:1,concurrency:null,presets:new Set(),title:'',projectId:'',stories:[],visuals:[],edges:[],requestId:'',busy:false,drag:null,overrides:{model:'',loras:[]},overrideDefaults:{model:null,loras:[]},overrideUI:{modelQuery:'',loraQuery:''}};
function designerChannel(){return ensureImageProviders().profiles.find(p=>p.id===assemblyDesign.channelId)}
function designerWorkflow(){return state.settings.comfy.presets.find(p=>p.id===assemblyDesign.workflowId)}
/* Target collection (画册集) for the assembled book. The last choice is remembered in settings.productionAssembly and
   restored on the next assembly; a remembered collection that no longer exists falls back to the one in view. */
function designerProjectId(){const d=assemblyDesign;return state.projects.some(p=>p.id===d.projectId)?d.projectId:state.activeProjectId}
function designerProject(){return state.projects.find(p=>p.id===designerProjectId())}
function rememberDesignerProject(id){if(!state.projects.some(p=>p.id===id))return;assemblyDesign.projectId=id;state.settings.productionAssembly={...(state.settings.productionAssembly||{}),projectId:id};save()}
function designerProjectField(){const current=designerProjectId(),active=state.activeProjectId,target=designerProject(),elsewhere=current!==active;
 const help=elsewhere?`生成的画册会归入「${esc(target?.title||'')}」，而不是当前浏览的「${esc(project()?.title||'')}」；完成后请切换画册集查看。`:'生成的画册会归入这个画册集。下次装配时会记住这里的选择。';
 return field('画册集',`<select id="designer-project">${state.projects.map(p=>opt(p.id,p.title+(p.id===active?' · 当前':''),current)).join('')}</select>`,help)}
/* C1: mirrors backend/production/api.py seed_binding_ready — a `random` source or a scene-parameter mapping of `seed` (what「添加分镜参数映射」and the shipped workflow create) both drive the per-frame seed. */
function isSeedBinding(b){return !!b&&b.enabled!==false&&(b.source==='random'||(b.source==='sceneParameter'&&String(b.value||'').trim()==='seed'))}
function designerSeedReady(){const w=designerWorkflow();return !!w?.bindings?.some(b=>{if(!b.enabled||!isSeedBinding(b))return false;try{let v=w.workflow[String(b.nodeId)].inputs;for(const part of (b.path.startsWith('/')?b.path.slice(1).split('/'):b.path.split('.')))v=v[part.replace(/~1/g,'/').replace(/~0/g,'~')];return typeof v==='number'&&Number.isFinite(v)}catch{return false}})}
function designerChannelNotice(){const d=assemblyDesign,current=designerChannel(),previous=ensureImageProviders().profiles.find(p=>p.id===d.previousChannelId);if(!current||!previous||previous.id===current.id||current.id!==ensureImageProviders().active)return '';return `<p class="notice designer-channel-notice" role="status">已按设置中当前启用的图像服务预选「${esc(current.title)}」；上次装配使用的是「${esc(previous.title)}」。请确认后再入队，避免发送到非预期的付费图像服务。</p>`}
/* Card chrome shared by every wizard step: a numbered kicker, a short title and the body. */
function designerCard(kicker,title,body,cls=''){return `<section class="designer-card ${cls}"><header class="designer-card-head"><span class="designer-kicker">${esc(kicker)}</span><h4>${esc(title)}</h4></header>${body}</section>`}
function designerSeedHTML(){const d=assemblyDesign,ready=designerSeedReady(),on=d.seedEnabled&&ready;return `<div class="seed-setting ${ready?'':'is-unmapped'}"><div class="seed-setting-row"><label class="row seed-setting-switch"><span class="switch"><input id="designer-seed-enable" type="checkbox" role="switch" aria-label="启用可复现种子" ${on?'checked':''} ${ready?'':'disabled'}><span class="switch-track"></span></span><span class="seed-setting-label">可复现种子<small>${ready?(on?'按固定种子 + 幕序号生成':'关闭时每幕使用新的随机种子'):'当前工作流没有种子映射'}</small></span></label><input id="designer-seed" type="number" min="0" max="4294967295" value="${d.seed}" ${on?'':'disabled'} aria-label="可复现种子"></div>${ready?'<p class="help">已找到有效种子映射。关闭时每幕、每次重跑都使用新的随机种子；开启后按固定种子 + 幕序号生成，可复现。</p>':designerSeedAlertHTML()}</div>`}
/* S6: without a seed mapping every scene reuses the blueprint's literal seed; say so plainly and offer the fix in place. */
function designerSeedAlertHTML(){const w=designerWorkflow(),frames=templateBy(assemblyDesign.storyId)?.frames.length||0,target=w?findSeedInput(w.workflow):null;
 return `<p class="seed-setting-alert" role="alert">${icon('alert','sm')}<span>${frames>1?`这 ${frames} 幕会使用同一个种子，画面可能几乎一样。`:'每一幕都会使用工作流里的同一个种子，画面可能几乎一样。'}</span>${target?'':'<small>没有找到采样器的种子输入，请在「工作流与 API 配置」里手动映射。</small>'}${target?btn('一键添加种子映射','plus','designer-add-seed-mapping','','small'):''}</p>`}
function addWorkflowSeedMapping(id){
 const c=state.settings.comfy,active=id===c.activeWorkflowId;if(active)storeActiveWorkflow();
 const p=c.presets.find(x=>x.id===id);if(!p)throw Error('工作流不存在。');
 const target=findSeedInput(p.workflow);if(!target)throw Error('没有找到采样器的种子输入（seed / noise_seed），请在「工作流与 API 配置」里手动映射。');
 const [nodeId,path]=target;p.bindings=p.bindings||initialWorkflowBindings({...c,...p});
 const existing=p.bindings.find(b=>String(b.nodeId)===nodeId&&WorkflowMapping.samePath(b.path,path));
 if(existing)Object.assign(existing,{source:'sceneParameter',value:'seed',type:'number',enabled:true});
 else p.bindings.push({id:uid('bind'),label:'种子',nodeId,path,type:'number',source:'sceneParameter',value:'seed',enabled:true,autoField:false,warning:'',allowCreate:false,allowLink:false});
 p.updatedAt=Date.now();if(active)c.bindings=clone(p.bindings);save();
}
/* S6: model problems this task would actually hit; a chosen override replaces the blueprint's primary model. */
function designerModelProblems(){
 const w=designerWorkflow();if(!w||designerChannel()?.provider!=='comfyui')return [];
 const d=assemblyDesign,slots=designerSlots(),plan=slots?.plan,covered=new Set(),usable=v=>!!v&&!placeholderModelName(v);
 if(plan&&slots.model.enabled)for(const t of plan.model.targets)if(t.enabled&&((usable(d.overrides.model)&&(t.role==='primary'||t.role==='same'))||usable(d.overrides.models?.[t.key])))covered.add(t.key);
 return workflowModelProblems(w.workflow).filter(p=>!covered.has(p.key));
}
function designerModelAlertHTML(){const problems=designerModelProblems();if(!problems.length)return '';
 return `<p class="designer-model-alert" role="alert">${icon('alert','sm')}<span>${esc(modelProblemText(problems[0]))}请在「模型与 LoRA」里选一个已安装的模型。</span></p>`}
function refreshDesignerModelAlert(){const slot=$('#designer-model-alert'),note=$('#designer-model-note');if(slot)slot.innerHTML=designerModelAlertHTML();if(note)note.textContent=designerModelProblems().length?'需要选择模型':'可选覆写'}
/* Cloud channels have no workflow to pick; show what the request will go to instead of an empty card. */
function designerChannelFactsHTML(p){if(!p)return '';const issues=providerSetupIssues(p),labels={novelai:'NovelAI 云端服务',openai:'OpenAI 兼容图像接口'};let host='';try{host=p.baseUrl?new URL(p.baseUrl).host:''}catch{host=String(p.baseUrl||'')}
 const fact=(label,value,cls='')=>`<div class="designer-fact ${cls}"><small>${label}</small><span>${value}</span></div>`;
 return `<div class="designer-facts">${fact('类型',esc(labels[p.provider]||p.provider||'—'))}${p.model?fact('模型',esc(p.model)):''}${host?fact('服务地址',esc(host)):''}${fact('状态',issues.length?'⚠️ '+esc(issues[0]):'✅ 已就绪',issues.length?'is-warn':'is-ok')}</div><p class="help">云端服务不需要选择工作流；模型与参数在「工作流与 API 配置」中设置。</p>`}
function designerEnvironment(kicker='02 · 生成环境'){const d=assemblyDesign,channel=designerChannel(),comfy=channel?.provider==='comfyui';return designerCard(kicker,comfy?'图像服务与工作流':'图像服务',`${designerChannelNotice()}${field('图像服务',`<select id="designer-channel">${ensureImageProviders().profiles.map(p=>opt(p.id,p.title,d.channelId)).join('')}</select>`)}${comfy?`<div class="designer-workflow">${designerWorkflowPickerHTML()}<div id="designer-model-alert">${designerModelAlertHTML()}</div>${designerSeedHTML()}</div>`:designerChannelFactsHTML(channel)}`,'designer-environment')}
function designerStoryCard(){const d=assemblyDesign,stories=projectTemplates();return designerCard('01 · 故事','要生成哪个分镜',field('分镜',`<select id="designer-story">${stories.map(t=>opt(t.id,t.title+' · '+t.frames.length+' 幕',d.storyId)).join('')}</select>`,stories.length?'':'当前画册集还没有分镜，请先在「分镜工坊」中新建。'))}
/* Workflow picker: a search box that filters a multi-row list box. The list only ever contains matches; the current selection is
   explained by a status line instead of being pinned into the results, and the query survives wizard re-renders. */
function designerWorkflowChoices(){return filterChoices(state.settings.comfy.presets,assemblyDesign.workflowQuery,assemblyDesign.workflowId)}
function designerWorkflowListSize(total){return Math.min(8,Math.max(3,total))}
function designerWorkflowOptionsHTML(result){return result.empty?`<option value="" disabled>${esc(localeString(result.total?'没有匹配「{query}」的工作流':'还没有保存的工作流',{query:result.query}))}</option>`:result.options.map(o=>opt(o.id,o.label,assemblyDesign.workflowId)).join('')}
function designerWorkflowStatusHTML(result){
 const text=!result.total?localeString('还没有保存的工作流；请先在「工作流与 API 配置」中保存。'):!result.query?localeString('共 {total} 个工作流',{total:result.total}):result.empty?localeString('没有匹配「{query}」的工作流',{query:result.query}):localeString('匹配 {matched} / {total} 个工作流',{matched:result.matched,total:result.total});
 const selection=result.query&&result.selectedLabel&&!result.selectedVisible?` <span class="choice-selection">${esc(localeString('当前选择「{title}」不在筛选结果中，仍然有效。',{title:result.selectedLabel}))}</span>`:'';
 const clear=result.query?` <button type="button" class="link-button" data-act="designer-workflow-clear">${esc(localeString('清除搜索'))}</button>`:'';
 return `<span>${esc(text)}</span>${selection}${clear}`;
}
function designerWorkflowPickerHTML(){const d=assemblyDesign,result=designerWorkflowChoices();return `${field('搜索已保存的工作流',searchInput({id:'designer-workflow-search',value:d.workflowQuery||'',placeholder:'输入工作流名称',label:'搜索已保存的工作流',controls:'designer-workflow'}))}${field('工作流',`<select id="designer-workflow" class="choice-list" size="${designerWorkflowListSize(result.total)}">${designerWorkflowOptionsHTML(result)}</select>`)}<p class="help choice-status" id="designer-workflow-status" role="status" aria-live="polite">${designerWorkflowStatusHTML(result)}</p>`}
function refreshDesignerWorkflowPicker(){const list=$('#designer-workflow'),status=$('#designer-workflow-status');if(!list)return;const result=designerWorkflowChoices();list.size=designerWorkflowListSize(result.total);list.innerHTML=designerWorkflowOptionsHTML(result);if(!result.selectedVisible)list.selectedIndex=-1;if(status)status.innerHTML=designerWorkflowStatusHTML(result);if(typeof localizeWorkspace==='function')localizeWorkspace(list.closest('.designer-workflow')||list.parentElement)}
/* ---- task-level model / LoRA overrides -------------------------------------------------------------------
   The chosen workflow's semantic slots decide what can be overridden; the pickers are built from the catalog that
   「同步模型列表」reads through the backend. Untouched selections send nothing, so the blueprint stays authoritative. */
function designerSlots(){const w=designerWorkflow();return w?comfySlotsResolved(w):null}
function designerLoraKey(name){return WorkflowSlots.loraStem(name).toLowerCase()}
function designerRememberedOverrides(id){
  const remembered=state.settings.productionAssembly?.overrides?.[id];
  if(!remembered||typeof remembered!=='object')return null;
  return {
    model:typeof remembered.model==='string'?remembered.model:'',
    models:remembered.models&&typeof remembered.models==='object'?clone(remembered.models):{},
    loras:Array.isArray(remembered.loras)?remembered.loras.filter(l=>l&&typeof l.name==='string').map(l=>({name:l.name,strength:Number.isFinite(Number(l.strength))?Number(l.strength):1})):[],
    unpin:Array.isArray(remembered.unpin)?remembered.unpin.filter(n=>typeof n==='string'):[],
    loraStrengths:remembered.loraStrengths&&typeof remembered.loraStrengths==='object'?clone(remembered.loraStrengths):{}
  };
}
function designerInitialLoraStrength(name){
  const d=assemblyDesign,key=designerLoraKey(name);
  if(d.overrideMemory?.sessionModified?.[key]!==undefined&&Number.isFinite(Number(d.overrideMemory.sessionModified[key]))){
    return Number(d.overrideMemory.sessionModified[key]);
  }
  const blueprintLora=d.overrideDefaults?.loras?.find(l=>designerLoraKey(l.name)===key);
  if(blueprintLora&&Number.isFinite(Number(blueprintLora.strength))){
    return Number(blueprintLora.strength);
  }
  const remembered=designerRememberedOverrides(d.workflowId);
  const rememberedLora=remembered?.loras?.find(l=>designerLoraKey(l.name)===key);
  if(rememberedLora&&Number.isFinite(Number(rememberedLora.strength))){
    return Number(rememberedLora.strength);
  }
  if(remembered?.loraStrengths?.[key]!==undefined&&Number.isFinite(Number(remembered.loraStrengths[key]))){
    return Number(remembered.loraStrengths[key]);
  }
  if(d.overrideMemory?.loraStrengths?.[key]!==undefined&&Number.isFinite(Number(d.overrideMemory.loraStrengths[key]))){
    return Number(d.overrideMemory.loraStrengths[key]);
  }
  return 1;
}
function initDesignerOverrides(){
 const d=assemblyDesign,w=designerWorkflow(),slots=w?designerSlots():null;d.overrideUI={modelQuery:'',loraQuery:''};
 d.overrideDefaults={model:w?WorkflowSlots.currentModel(w.workflow,slots):'',loras:w?WorkflowSlots.currentLoras(w.workflow,slots):[]};
 const remembered=w?designerRememberedOverrides(w.id):null;
 d.overrides={
   model:remembered?.model||'',
   models:remembered?.models?clone(remembered.models):{},
   loras:remembered?.loras?clone(remembered.loras):[],
   unpin:remembered?.unpin?clone(remembered.unpin):[]
 };
 d.overrideMemory={
   loraStrengths:remembered?.loraStrengths?clone(remembered.loraStrengths):{},
   sessionModified:{}
 };
 for(const l of d.overrideDefaults.loras){
   const key=designerLoraKey(l.name);
   if(d.overrideMemory.loraStrengths[key]===undefined&&Number.isFinite(Number(l.strength))){
     d.overrideMemory.loraStrengths[key]=Number(l.strength);
   }
 }
 if(slots?.plan?.model.paired)for(const t of slots.plan.model.targets.filter(t=>t.role==='primary'||t.pairedSelector)){
   if(!d.overrides.models[t.key])d.overrides.models[t.key]=t.current;
 }
 if(w&&!slots?.plan)ensureWorkflowSlotPlan(w).then(plan=>{if(plan&&designerWorkflow()?.id===w.id&&designerChannel()?.provider==='comfyui'&&assemblyDesign.step===0&&document.querySelector('#modal')?.open){initDesignerOverrides();renderAssemblyDesigner();}}).catch(error=>toast(error.message,'error'));
}
function designerOverrides(){
 const d=assemblyDesign,slots=designerSlots();if(!slots||designerChannel()?.provider!=='comfyui')return undefined;const out={};
 if(slots.plan?.model.paired){
   out.model=Object.fromEntries(Object.entries(d.overrides.models).filter(([key])=>!slots.plan.model.targets.find(t=>t.key===key)?.disabled));
   const primary=slots.plan.model.targets.find(t=>t.role==='primary');
   for(const t of slots.plan.model.targets.filter(t=>t.role==='same'&&t.enabled))out.model[t.key]=out.model[primary?.key]||t.current;
 }else{const model=String(d.overrides.model||'').trim();if(slots.model.enabled&&model&&model!==d.overrideDefaults.model)out.model=model;}
 if(d.overrides.loras.length)out.loras=d.overrides.loras.map(l=>({...l,strength:Math.round(l.strength*100)/100}));
 const activeLoraKeys=new Set(d.overrides.loras.map(l=>designerLoraKey(l.name)));
 const realUnpin=d.overrides.unpin.filter(u=>!activeLoraKeys.has(designerLoraKey(u)));
 if(realUnpin.length){out.unpin=[...realUnpin];out.loras||=[];}
 return Object.keys(out).length?out:undefined;
}
function designerStrengthRange(){const groups=designerSlots()?.plan?.lora.groups.filter(g=>g.enabled&&g.append)||[];return groups.length?{min:Math.max(...groups.map(g=>g.writer.range?.min??-5)),max:Math.min(...groups.map(g=>g.writer.range?.max??5))}:designerSlots()?.plan?.lora.synth?.range||{min:-5,max:5};}
function designerModelChoices(slots){const catalog=comfyModelCatalog(),kind=slots.model.kind,list=kind==='checkpoint'?catalog.checkpoints:kind==='unet'?catalog.unets:[...catalog.checkpoints,...catalog.unets],query=assemblyDesign.overrideUI.modelQuery.trim().toLowerCase();return {total:list.length,options:(query?list.filter(m=>m.toLowerCase().includes(query)):list).slice(0,80)}}
function designerModelResultsHTML(slots){const d=assemblyDesign,{options,total}=designerModelChoices(slots),current=String(d.overrides.model||''),fallback=d.overrideDefaults.model,query=d.overrideUI.modelQuery.trim();
 let html=`<div class="designer-model-option ${!current?'is-on':''}" data-designer-model-pick=""><span data-user-content>${fallback?`工作流默认 · ${WorkflowSlots.loraStem(fallback)}`:'工作流默认（未填模型）'}</span><small>${placeholderModelName(fallback)?'占位名，请换一个':'沿用工作流'}</small></div>`;
 for(const m of options){if(m===fallback)continue;const on=current===m;html+=`<div class="designer-model-option ${on?'is-on':''}" data-designer-model-pick="${esc(m)}"><span data-user-content title="${esc(m)}">${esc(WorkflowSlots.loraStem(m))}</span><small>${esc(m.includes('/')||m.includes('\\')?m.replace(/\\/g,'/').split('/').slice(0,-1).join('/'):m)}</small></div>`}
 if(current&&!options.includes(current)&&current!==fallback){html+=`<div class="designer-model-option is-on" data-designer-model-pick="${esc(current)}"><span data-user-content>${esc(WorkflowSlots.loraStem(current))}</span><small>手动指定</small></div>`}
 if(query&&!options.some(m=>m.toLowerCase()===query.toLowerCase())&&query!==current){html+=`<button type="button" class="designer-model-option is-free" data-designer-model-pick="${esc(query)}"><span data-user-content>使用「${esc(query)}」作为文件名</span><small>${total?'自定义':'未同步列表'}</small></button>`}
 return html}
function designerLoraResultsHTML(slots){const d=assemblyDesign,catalog=comfyModelCatalog(),query=d.overrideUI.loraQuery.trim().toLowerCase(),picked=new Set(d.overrides.loras.map(l=>designerLoraKey(l.name)));
 const list=(query?catalog.loras.filter(m=>m.toLowerCase().includes(query)):catalog.loras).slice(0,60);
 const rows=list.map(l=>{const on=picked.has(designerLoraKey(l));return `<label class="designer-lora-option ${on?'is-on':''}"><input type="checkbox" data-designer-lora-toggle="${esc(l)}" ${on?'checked':''}><span data-user-content title="${esc(l)}">${esc(WorkflowSlots.loraStem(l))}</span><small>${esc(l.includes('/')||l.includes('\\')?l.replace(/\\/g,'/').split('/').slice(0,-1).join('/'):l)}</small></label>`}).join('');
 const free=query&&!list.some(m=>designerLoraKey(m)===designerLoraKey(query))&&!picked.has(designerLoraKey(query))?`<button type="button" class="designer-lora-free" data-act="designer-lora-add-free" data-name="${esc(d.overrideUI.loraQuery.trim())}">${icon('plus','sm')}<span>添加「${esc(d.overrideUI.loraQuery.trim())}」${catalog.loras.length?'（不在列表中）':'（未同步列表，按文件名写入）'}</span></button>`:'';
 const empty=!rows&&!free?`<p class="designer-lora-empty">${catalog.loras.length?`没有匹配「${esc(query)}」的 LoRA。`:'还没有同步 LoRA 列表；点右上角「同步模型列表」，或直接输入文件名添加。'}</p>`:'';
 return rows+free+empty}
function designerLoraChipsHTML(){
 const d=assemblyDesign,bounds=designerStrengthRange();
 const activeKeys=new Set(d.overrides.loras.map(l=>designerLoraKey(l.name)));
 const unpinKeys=new Set(d.overrides.unpin.map(u=>designerLoraKey(u)));
 const pinned=d.overrideDefaults.loras.filter(l=>!unpinKeys.has(designerLoraKey(l.name))&&!activeKeys.has(designerLoraKey(l.name))).map(l=>`<div class="designer-lora-chip is-pinned" title="工作流自带条目"><span aria-label="锁定">🔒</span><span class="designer-lora-name" data-user-content>${esc(WorkflowSlots.loraStem(l.name))}</span><output>×${esc(l.strength)}</output>${ibtn('close','designer-lora-unpin','解锁并移除此工作流条目',`data-name="${esc(l.name)}"`)}</div>`).join('');
 const added=d.overrides.loras.map((l,i)=>`<div class="designer-lora-chip" data-designer-lora-chip="${i}"><span class="designer-lora-name" data-user-content title="${esc(l.name)}">${esc(WorkflowSlots.loraStem(l.name))}</span><input type="number" min="${bounds.min}" max="${bounds.max}" step="0.05" value="${l.strength}" data-designer-lora-strength="${i}" aria-label="${esc(WorkflowSlots.loraStem(l.name))} 强度"><output class="mono" data-designer-lora-output="${i}">${WorkflowSlots.numberText(l.strength)}</output>${ibtn('close','designer-lora-remove','移除此 LoRA',`data-index="${i}"`)}</div>`).join('');
 return pinned+added||'<p class="designer-lora-none">不额外叠加 LoRA</p>';
}
function designerOverridesPanel(){const d=assemblyDesign,w=designerWorkflow(),slots=w?designerSlots():null;if(!w||!slots)return '';const catalog=comfyModelCatalog(),modelOn=slots.model.enabled,loraOn=slots.lora.mode!=='off',synced=catalog.fetchedAt?`已同步 ${catalog.checkpoints.length+catalog.unets.length} 个模型 · ${catalog.loras.length} 个 LoRA`:'尚未同步模型列表';
 if(!modelOn&&!loraOn)return `<section class="designer-slots is-inert" aria-label="模型与 LoRA"><header><div class="designer-slots-title"><span class="designer-kicker">03 · 模型</span><h4>模型与 LoRA</h4></div><p class="help">此工作流未识别出模型或 LoRA 映射，将按工作流原样提交；可在「工作流与 API 配置」里手动指定。</p></header></section>`;
 const paired=slots.plan?.model.paired;
 const modelBody=paired?`<div class="designer-slot-field">${slots.plan.model.targets.filter(t=>t.role==='primary'||t.pairedSelector).map(t=>field(t.title||t.nodeId,`<input data-designer-paired-model="${esc(t.key)}" value="${esc(d.overrides.models[t.key]??t.current)}" list="designer-paired-model-options" aria-label="${esc(t.title||t.nodeId)}">`)).join('')}<datalist id="designer-paired-model-options">${[...catalog.checkpoints,...catalog.unets].map(m=>`<option value="${esc(m)}"></option>`).join('')}</datalist></div>`:modelOn?`<div class="designer-slot-field"><label class="designer-slot-label" for="designer-model-search">基础模型 <small>写入 #${esc(slots.model.nodeId)} · ${esc(slots.model.path)}</small></label>${searchInput({id:'designer-model-search',value:d.overrideUI.modelQuery,placeholder:catalog.fetchedAt?`搜索 ${designerModelChoices(slots).total} 个模型，或输入文件名`:'未同步列表：输入模型文件名',label:'搜索模型',controls:'designer-model-results'})}<div id="designer-model-results" class="designer-model-results" role="listbox" aria-label="基础模型">${designerModelResultsHTML(slots)}</div></div>`:`<p class="designer-slot-off">模型映射未启用，沿用工作流模型。</p>`;
 const loraBody=loraOn?`<div class="designer-slot-field"><label class="designer-slot-label" for="designer-lora-search">LoRA 叠加 <small>工作流条目锁定保留，用户条目追加${d.overrideDefaults.loras.length?` · 工作流自带 ${d.overrideDefaults.loras.length} 个（默认生效）`:''}</small></label><div class="designer-lora-chips" id="designer-lora-chips">${designerLoraChipsHTML()}</div>${searchInput({id:'designer-lora-search',value:d.overrideUI.loraQuery,placeholder:catalog.loras.length?`搜索 ${catalog.loras.length} 个 LoRA`:'未同步列表：输入 LoRA 文件名后添加',label:'搜索 LoRA',controls:'designer-lora-results'})}<div id="designer-lora-results" class="designer-lora-results" role="group" aria-label="可选 LoRA">${designerLoraResultsHTML(slots)}</div></div>`:`<p class="designer-slot-off">${esc(slots.plan?.lora.reason||'LoRA 映射未启用')}</p>`;
 return `<section class="designer-slots" aria-label="模型与 LoRA"><header><div class="designer-slots-title"><span class="designer-kicker">03 · 模型</span><h4>模型与 LoRA</h4></div>${btn('同步模型列表','refresh','designer-sync-catalog','','ghost small')}<p class="help">${esc(synced)} · 只影响本次任务，不改动工作流</p></header>${modelBody}${loraBody}<p class="help" role="status">${esc(WorkflowSlots.describe(slots))}</p></section>`}
function refreshDesignerOverrides(part){const slots=designerSlots();if(!slots)return;if(part!=='lora'){const results=$('#designer-model-results');if(results)results.innerHTML=designerModelResultsHTML(slots)}if(part!=='model'){const chips=$('#designer-lora-chips'),results=$('#designer-lora-results');if(chips)chips.innerHTML=designerLoraChipsHTML();if(results)results.innerHTML=designerLoraResultsHTML(slots)}}
function designerAddLora(name){
 const d=assemblyDesign,key=designerLoraKey(name);
 if(!name||d.overrides.loras.some(l=>designerLoraKey(l.name)===key))return;
 if(d.overrides.loras.length>=WorkflowSlots.MAX_LORAS)throw Error('一次最多叠加 '+WorkflowSlots.MAX_LORAS+' 个 LoRA');
 d.overrides.unpin=d.overrides.unpin.filter(u=>designerLoraKey(u)!==key);
 const strength=designerInitialLoraStrength(name);
 d.overrides.loras.push({name,strength});
}
function openAssemblyDesigner(){
 const d=assemblyDesign,prefs=state.settings.productionAssembly||{},providers=ensureImageProviders(),lastUsed=providers.profiles.find(p=>p.id===prefs.channelId)?.id||'';
 /* B10: the wizard follows the channel enabled in Settings, never silently the last one billed; a differing history is only a notice. */
 Object.assign(d,{mode:'wizard',step:0,storyId:workshopStory()?.id||'',channelId:providers.active||lastUsed,previousChannelId:lastUsed&&lastUsed!==providers.active?lastUsed:'',workflowId:(prefs.channelId===providers.active?prefs.workflowId:'')||state.settings.comfy.activeWorkflowId,workflowQuery:'',seedEnabled:false,seed:1,concurrency:null,presets:new Set(),title:'',projectId:state.projects.some(p=>p.id===prefs.projectId)?prefs.projectId:state.activeProjectId,stories:[],visuals:[],edges:[],requestId:uid('assembly'),busy:false,drag:null});
 if(!designerChannel())d.channelId=ensureImageProviders().profiles[0]?.id||'';if(!designerWorkflow())d.workflowId=state.settings.comfy.presets[0]?.id||'';
 initDesignerOverrides();
 renderAssemblyDesigner();
}
function designerPresetKeys(p){const keys=(p.entries||[]).map(e=>e.key).filter(Boolean);return keys.length?`<span class="designer-preset-keys">${keys.slice(0,4).map(k=>`<code>{${esc(k)}}</code>`).join('')}${keys.length>4?`<code>+${keys.length-4}</code>`:''}</span>`:''}
/* Every {placeholder} the chosen story references, so step 2 can say which ones the ticked presets cover. NovelAI braces are
   weight syntax, so no coverage is claimed for that channel. */
function designerStoryVariables(){const story=templateBy(assemblyDesign.storyId),keys=[];for(const f of story?.frames||[])for(const key of [...promptPlaceholders(f.prompt),...promptPlaceholders(f.negative),...promptPlaceholders(f.caption)])if(!keys.includes(key))keys.push(key);return keys}
function designerPresetsStatus(){const d=assemblyDesign,n=d.presets.size;if(!projectVariableSets().length)return '';const vars=designerChannel()?.provider==='novelai'?[]:designerStoryVariables();
 if(!vars.length)return n?`已选 ${n} 个预设 · 同名变量按预设顺序覆盖`:'尚未选择预设 · 也可以不使用预设，直接生成不含变量的分镜';
 const defined=new Set([...d.presets].flatMap(id=>(setBy(id)?.entries||[]).map(e=>e.key))),missing=vars.filter(k=>!defined.has(k));
 return `分镜引用 ${vars.length} 个变量${n?` · 已选 ${n} 个预设，覆盖 ${vars.length-missing.length} 个`:' · 尚未选择预设'}${missing.length?` · 未定义：${missing.map(k=>'{'+k+'}').join('、')}`:' · 全部已定义 ✓'}`}
function designerPresets(){const d=assemblyDesign,sets=projectVariableSets();return `<div class="designer-presets" role="group" aria-label="预设">${sets.map(p=>{const on=d.presets.has(p.id),kind=p.category==='scenes'?'场景 / 画风':'角色';return `<label class="designer-preset ${on?'selected':''}"><input type="checkbox" data-designer-preset="${esc(p.id)}" ${on?'checked':''}><span class="designer-preset-mark" aria-hidden="true">${icon('check','sm')}</span><span class="designer-preset-icon">${icon('box')}</span><span class="designer-preset-body"><strong data-user-content>${esc(p.title)}</strong><small>${esc(kind)} · ${p.entries.length} 个变量</small>${designerPresetKeys(p)}</span></label>`}).join('')||'<div class="designer-empty"><strong>这个画册集还没有预设</strong><p>可以不使用预设，直接生成不含变量的分镜；也可以先到「预设工坊」建立角色、服装或画风预设。</p></div>'}</div><p class="help designer-presets-status" id="designer-presets-status" role="status" aria-live="polite">${designerPresetsStatus()}</p>`}
/* Step 3 summary: everything the task card will freeze, so nothing has to be scrolled back to. */
function designerSummaryHTML(){const d=assemblyDesign,story=templateBy(d.storyId),channel=designerChannel(),comfy=channel?.provider==='comfyui',w=comfy?designerWorkflow():null,slots=w?designerSlots():null,presets=[...d.presets].map(id=>setBy(id)).filter(Boolean);
 const row=(label,value,cls='')=>`<div class="designer-summary-row ${cls}"><dt>${label}</dt><dd>${value}</dd></div>`,chip=(text,tail='',title='')=>`<span class="designer-summary-chip" ${title?`title="${esc(title)}"`:''}><span data-user-content>${esc(text)}</span>${tail?`<b>${esc(tail)}</b>`:''}</span>`;
 const rows=[row('分镜',`<span data-user-content>${esc(story?.title||'—')}</span><small>${story?.frames.length||0} 幕</small>`),row('画册集',`<span data-user-content>${esc(designerProject()?.title||'—')}</span>${designerProjectId()!==state.activeProjectId?'<small>非当前画册集</small>':''}`),row('图像服务',esc(channel?.title||'—'))];
 if(comfy){rows.push(row('工作流',`<span data-user-content>${esc(w?.title||'—')}</span>`));
  if(slots?.model.enabled){const m=String(d.overrides.model||'').trim();rows.push(row('基础模型',m?`<span data-user-content>${esc(WorkflowSlots.loraStem(m))}</span><small>本次覆写</small>`:`<span data-user-content>${esc(d.overrideDefaults.model?WorkflowSlots.loraStem(d.overrideDefaults.model):'未填模型')}</span><small>工作流默认</small>`))}
   if(slots&&slots.lora.mode!=='off'){const unpinKeys=new Set(d.overrides.unpin.map(u=>designerLoraKey(u)));rows.push(row('LoRA',d.overrides.loras.length?d.overrides.loras.map(l=>chip(WorkflowSlots.loraStem(l.name),'×'+WorkflowSlots.numberText(l.strength),l.name)).join(''):`<small>${d.overrideDefaults.loras.filter(l=>!unpinKeys.has(designerLoraKey(l.name))).length?'保留工作流 LoRA':'不叠加 LoRA'}</small>`,'is-chips'));}
  rows.push(row('种子',designerSeedReady()?(d.seedEnabled?`固定 ${Number(d.seed)||0}<small>按幕序号递增 · 可复现</small>`:'每幕随机<small>重跑时会变化</small>'):'沿用工作流固定种子<small>未映射</small>'))}
 rows.push(row('预设',presets.length?presets.map(p=>chip(p.title,p.entries.length+' 项')).join(''):'<small>不使用预设</small>','is-chips'));
 rows.push(row('分幕并发',d.concurrency?`${d.concurrency} 幕并行<small>本任务</small>`:`${workshop.queue.concurrency||1} 幕并行<small>跟随全局</small>`));
 return `<dl class="designer-summary">${rows.join('')}</dl>`}
/* Page concurrency for the new task: blank follows the queue-wide default and stays adjustable on the card. */
function designerConcurrencyField(){const d=assemblyDesign,q=workshop.queue,base=q.concurrency||1,max=q.maxConcurrency||128;return field('分幕并发',input('concurrency',d.concurrency??'','number',`id="designer-concurrency" class="designer-concurrency" inputmode="numeric" min="1" max="${max}" step="1" placeholder="${esc(localeString('跟随全局 · {n}',{n:base}))}" autocomplete="off"`),esc(localeString('这本画册同时生成的分幕数（1–{max}）。留空跟随队列的全局默认，入队后仍可在生成任务上调整。',{max})))}
function designerNaming(){const d=assemblyDesign;return `${assemblyPreflightHTML()}<div class="designer-columns designer-naming"><div class="designer-main">${designerCard('01 · 命名','这本画册叫什么',`${field('画册名称',input('title',d.title,'text','id="designer-title" maxlength="150" placeholder="例如：雨夜里的第二次相遇" autocomplete="off"'))}${designerProjectField()}${designerConcurrencyField()}`)}</div><aside class="designer-side">${designerCard('02 · 核对','任务摘要',designerSummaryHTML(),'designer-summary-card')}</aside></div>`}
function designerCanvas(){const d=assemblyDesign,height=Math.max(700,Math.max(d.stories.length,d.visuals.length)*180+70);return `<div class="canvas-toolbar"><label>分镜<select id="canvas-story-choice">${projectTemplates().map(t=>opt(t.id,t.title,'')).join('')}</select></label>${btn('调入分镜','plus','designer-add-story')}<label>预设<select id="canvas-preset-choice">${projectVariableSets().map(p=>opt(p.id,p.title,'')).join('')}</select></label>${btn('调入预设','plus','designer-add-preset')}</div><p class="help">拖动卡片标题调整位置；从分镜的右侧圆点拖到预设的左侧圆点建立连线。也可点击两个端口，或使用下方的键盘关联选项。点击连线可删除。</p><div class="link-board"><div class="link-world" style="height:${height}px"><svg class="link-lines" width="1180" height="${height}" aria-label="分镜与预设关联"></svg>${d.stories.map(n=>`<section class="link-node story-node" data-node="${n.id}" style="left:${n.x}px;top:${n.y}px"><header data-drag-node="${n.id}">${icon('story')}<strong>${esc(templateBy(n.assetId)?.title||'分镜')}</strong>${ibtn('close','designer-remove-node','移除分镜节点',`data-id="${n.id}"`)}</header><label>输出画册名称<input data-node-title="${n.id}" value="${esc(n.title)}" maxlength="150"></label><button class="node-port output" data-port-story="${n.id}" aria-label="连接 ${esc(n.title)} 的预设"></button></section>`).join('')}${d.visuals.map(n=>`<section class="link-node preset-node" data-node="${n.id}" style="left:${n.x}px;top:${n.y}px"><header data-drag-node="${n.id}">${icon('box')}<strong>${esc(setBy(n.assetId)?.title||'预设')}</strong>${ibtn('close','designer-remove-node','移除预设节点',`data-id="${n.id}"`)}</header><p>${setBy(n.assetId)?.entries.length||0} 个变量 · 可连接多个分镜</p><button class="node-port input" data-port-preset="${n.id}" aria-label="使用 ${esc(setBy(n.assetId)?.title)}"></button></section>`).join('')}</div></div><details class="canvas-accessible"><summary>关联清单 · 键盘操作与核对</summary>${d.stories.map(s=>`<fieldset><legend>${esc(s.title)}</legend>${d.visuals.map(p=>`<label><input type="checkbox" data-edge-story="${s.id}" data-edge-preset="${p.id}" ${d.edges.some(e=>e.story===s.id&&e.preset===p.id)?'checked':''}>${esc(setBy(p.assetId)?.title)}</label>`).join('')}</fieldset>`).join('')}</details><p class="help">${d.stories.length} 个分镜任务节点 · ${d.edges.length} 条关联。每个分镜节点产生一个生成任务，合并它连接的全部预设；不展开为笛卡尔积。同名变量按预设卡片调入顺序覆盖。</p>`}
function designerStepperHTML(steps){const d=assemblyDesign;return `<ol class="assembly-stepper" aria-label="装配步骤">${steps.map((s,i)=>`<li class="${d.step===i?'active':d.step>i?'done':''}" ${d.step===i?'aria-current="step"':''}><b>${d.step>i?icon('check','sm'):i+1}</b><span>${s}</span></li>`).join('')}</ol>`}
function renderAssemblyDesigner(){const d=assemblyDesign;const steps=['分镜与图像服务','预设','命名与入队'],comfy=designerChannel()?.provider==='comfyui';let content;
 const environment=()=>`<div class="designer-columns"><div class="designer-main">${designerStoryCard()}${designerEnvironment()}</div><aside class="designer-side">${comfy?`<details class="designer-advanced" ${designerModelProblems().length?'open':''}><summary>模型与 LoRA <span id="designer-model-note">${designerModelProblems().length?'需要选择模型':'可选覆写'}</span></summary>${designerOverridesPanel()}</details>`:''}</aside></div>`;
 if(d.mode==='canvas')content=`<div class="canvas-environment"><div class="designer-columns"><div class="designer-main">${designerEnvironment('01 · 生成环境')}${designerCard('02 · 归档','生成结果放到哪里',designerProjectField()+designerConcurrencyField())}</div><aside class="designer-side">${comfy?designerOverridesPanel():''}</aside></div></div>${designerCanvas()}`;
 else{const titles=['选择故事与生成环境','为故事搭配视觉资产','让这次创作有自己的名字'],notes=['选择要生成的分镜与图像服务；使用 ComfyUI 时，再选择工作流，并可只为这次任务替换模型与 LoRA。','拖动框选预设，Ctrl / ⌘ 加选，Shift 连选。同名变量按预设顺序覆盖。','为画册命名、选择归入的画册集，确认摘要后加入待命队列。任务不会自动开始，仍需在生成任务上点击开始。'];
  content=`${`<div class="designer-workbench"><aside class="designer-navigation"><div class="designer-brand">MIO <span>PRODUCTION STUDIO</span></div><h2>从故事，<br>到画面。</h2><p>一次专注一件事。<br>让创作自然发生。</p>${designerStepperHTML(steps)}<div class="designer-safety">${icon('clock','sm')} 先准备，再生成<small>入队后由你决定何时开始。</small></div></aside>`}<section class="designer-step" data-step="${d.step}"><header class="designer-step-head"><h3>${titles[d.step]}</h3><p>${notes[d.step]}</p></header>${d.step===0?environment():d.step===1?designerPresets():designerNaming()}</section></div>`}
 const footHint=d.mode==='canvas'?`${d.stories.length} 个分镜节点 · ${d.edges.length} 条关联 · 每个分镜节点生成一个待命的生成任务`:d.step<2?`第 ${d.step+1} / ${steps.length} 步`:'加入待命队列后不会自动开始生成';
 modal('新建生成任务',`<div class="designer-head"><div class="designer-modes" role="group" aria-label="装配模式">${[['wizard','分步向导'],['canvas','画布连线']].map(([id,label])=>btn(label,id==='wizard'?'list':'nodes','designer-mode',`data-mode="${id}" aria-pressed="${d.mode===id}"`,d.mode===id?'active':'ghost')).join('')}</div><p class="designer-head-note">${d.mode==='canvas'?'把多个分镜与预设连线，一次装配多个生成任务。':'创作配置 / NEW GENERATION'}</p></div>${content}<div class="modal-footer designer-footer"><span class="designer-footer-hint">${footHint}</span><span class="grow"></span>${btn('取消','','close-modal','','ghost')}${d.mode==='wizard'&&d.step>0?btn('上一步','arrow-back','designer-back'):''}${d.mode==='wizard'&&d.step<2?btn('下一步','arrow','designer-next','','primary'):btn(d.mode==='canvas'?'批量生成 · 加入待命':'添加待命任务','plus','designer-submit',d.busy?'disabled':'','primary')}</div>`,'',true);
 $('#modal').classList.add('assembly-designer');if(d.mode==='canvas')updateDesignerLines();
}
function updateDesignerLines(point=null){const svg=$('.link-lines');if(!svg)return;const d=assemblyDesign;
 const curve=(a,b)=>`M ${a.x} ${a.y} C ${a.x+110} ${a.y}, ${b.x-110} ${b.y}, ${b.x} ${b.y}`;
 svg.innerHTML=d.edges.map((e,i)=>{const a=d.stories.find(n=>n.id===e.story),b=d.visuals.find(n=>n.id===e.preset);return a&&b?`<path tabindex="0" role="button" aria-label="删除关联 ${i+1}" data-edge-delete="${i}" d="${curve({x:a.x+244,y:a.y+64},{x:b.x,y:b.y+64})}"/>`:''}).join('');
 if(point&&d.drag?.kind==='link'){const a=d.stories.find(n=>n.id===d.drag.id);if(a)svg.insertAdjacentHTML('beforeend',`<path class="pending" d="${curve({x:a.x+244,y:a.y+64},point)}"/>`)}
}
function linkDesigner(story,preset){const d=assemblyDesign;if(!d.edges.some(e=>e.story===story&&e.preset===preset))d.edges.push({story,preset});d.drag=null;renderAssemblyDesigner()}
function designerItem(storyId,presetIds,title,index){const d=assemblyDesign;return {storyId,presets:presetIds.map(id=>({id,kind:setBy(id)?.category==='scenes'?'scenes':'characters'})),title:title.trim(),projectId:designerProjectId(),channelId:d.channelId,workflowId:designerChannel()?.provider==='comfyui'?d.workflowId:undefined,seedEnabled:designerChannel()?.provider==='comfyui'&&d.seedEnabled&&designerSeedReady(),seed:d.seed,concurrency:d.concurrency,overrides:designerOverrides(),requestId:d.requestId+'-'+index}}
function validateDesignerEnvironment(){if(!designerChannel())throw Error('请选择图像服务');const issues=providerSetupIssues(designerChannel());if(issues.length)throw Error(issues[0]);if(designerChannel().provider==='comfyui'&&!designerWorkflow())throw Error('请先保存并选择工作流');if(assemblyDesign.seedEnabled&&(!designerSeedReady()||!Number.isInteger(assemblyDesign.seed)||assemblyDesign.seed<0||assemblyDesign.seed>4294967295))throw Error('请配置有效种子映射并填写 uint32 种子');const max=workshop.queue.maxConcurrency||128;if(assemblyDesign.concurrency!==null&&(!Number.isInteger(assemblyDesign.concurrency)||assemblyDesign.concurrency<1||assemblyDesign.concurrency>max))throw Error(localeString('分幕并发需为 1–{max} 的整数，或留空跟随全局',{max}))}
async function submitAssemblyDesigner(){const d=assemblyDesign;if(d.busy)return;validateDesignerEnvironment();if(designerChannel()?.provider==='comfyui')await ensureWorkflowSlotPlan(designerWorkflow());let items;
 if(d.mode==='wizard')items=[designerItem(d.storyId,[...d.presets],d.title,0)];
 else {if(!d.stories.length)throw Error('请至少调入一个分镜');items=d.stories.map((s,i)=>{const ids=d.visuals.filter(p=>d.edges.some(e=>e.story===s.id&&e.preset===p.id)).map(p=>p.assetId);if(!ids.length)throw Error('请连接〈'+s.title+'〉的预设，或移除该节点');return designerItem(s.assetId,ids,s.title,i)})}
 const inputIssues=items.flatMap(i=>assemblyInputIssues(i.storyId,i.presets.map(p=>p.id),designerChannel()));if(inputIssues.length)throw Error(inputIssues[0]);
 if(items.some(i=>!i.title||!templateBy(i.storyId)?.frames.length))throw Error('每张任务都需要名称和非空分镜');
 const missingKeys=[...new Set(items.flatMap(i=>assemblyMissingVariables(i.storyId,i.presets.map(p=>p.id)).map(m=>m.key)))];
 if(d.mode==='canvas'&&!await confirmAction('确认批量装配？',`将创建 ${items.length} 个待命的生成任务。`,'添加待命'))return;
 d.busy=true;const button=$('[data-act="designer-submit"]');if(button)button.disabled=true;
  try{
    const remembered={...(state.settings.productionAssembly?.overrides||{})};
    if(d.workflowId&&designerChannel()?.provider==='comfyui'){
      const activeKeys=new Set(d.overrides.loras.map(l=>designerLoraKey(l.name)));
      remembered[d.workflowId]={
        model:String(d.overrides.model||''),
        models:d.overrides.models?clone(d.overrides.models):{},
        loras:d.overrides.loras.map(l=>({name:l.name,strength:l.strength})),
        unpin:d.overrides.unpin.filter(u=>!activeKeys.has(designerLoraKey(u))),
        loraStrengths:d.overrideMemory?.loraStrengths?clone(d.overrideMemory.loraStrengths):{}
      };
      for(const key of Object.keys(remembered).slice(0,-24))delete remembered[key];
    }
    state.settings.productionAssembly={channelId:d.channelId,workflowId:d.workflowId,projectId:designerProjectId(),overrides:remembered};
    save();try{await savePythonWorkspace()}catch(_){}await productionRequest('assemble-batch',{items});closeModal();ui.workspace=1;workshop.view='production';await refreshProduction();toast(`已添加 ${items.length} 个待命的生成任务`);if(missingKeys.length)toast(missingVariablesNotice(missingKeys),'warn');
  }finally{d.busy=false;if(button?.isConnected)button.disabled=false}
}
function optionalModulesHTML(){const p=state.settings.studio,on=p.visibility.extensions!==false;return `<section class="settings-section"><h2>只留下你需要的功能</h2><p>核心创作始终保留，其余工作区由你选择。</p>${settingsRow('画册集与创作工坊','管理作品、独立分镜、预设与生产任务。','<span class="tiny muted">核心功能</span>','book')}${settingsRow('模板与扩展市场','独立全屏资源工作区。',switchControl('visibility.marketplace','显示模板与扩展市场',p.visibility.marketplace===true),'box')}${settingsRow('运行日志','查看运行记录与错误。',switchControl('visibility.logs','显示运行日志',p.visibility.logs),'terminal')}${settingsRow('AI 写故事','按需启用故事辅助工作区。',switchControl('visibility.llm','启用 AI 写故事',p.visibility.llm),'spark')}</section><section class="settings-section optional-settings"><header><div><h2>可选功能</h2></div><label class="switch"><input id="ws-extensions" role="switch" type="checkbox" aria-label="启用可选功能" ${on?'checked':''}><span class="switch-track"></span></label></header>${on?`<div class="optional-children">${laboratoryExtensions().map(x=>settingsRow(x.title,x.description,`<label class="switch"><input role="switch" type="checkbox" data-art-extension="${x.key}" aria-label="启用${x.title}" ${x.enabled?'checked':''}><span class="switch-track"></span></label>`,x.icon)).join('')}</div>`:''}</section>${typeof productionLiveSyncSettingsHTML==='function'?productionLiveSyncSettingsHTML():''}`}
function installArchitecture(){
 paths['arrow-back']='<path d="M19 12H5m6-6-6 6 6 6"/>';
 studioDefaults.visibility.extensions=true;studioDefaults.visibility.marketplace=false;studioDefaults.features.assistant??=true;
 renderV3Modules=optionalModulesHTML;
 const enabled=featureEnabled;featureEnabled=function(key){if(key==='marketplace')return state.settings.studio.visibility.marketplace===true;if(['assistant','visualCritic'].includes(key)&&state.settings.studio.visibility.extensions===false)return false;return enabled(key)};
 const visible=workspaceVisible;workspaceVisible=function(index){if(index===8)return featureEnabled('marketplace');if(index===7)return state.settings.studio.visibility.extensions!==false;return visible(index)};
 const assistant=showAssistant;showAssistant=function(...args){if(!featureEnabled('assistant'))return toast('请先在设置的可选功能中启用助手');return assistant(...args)};
 marketModal=function(){if(!featureEnabled('marketplace')){ui.workspace=5;studioUI.settingsTab='modules';render();toast('请先开启模板与扩展市场');return}closeModal();ui.workspace=8;render()};
 renderMarket=function(){if($('#market-content')){const raw=$('#raw-url')?.value;renderStudioMarket();if(raw!==undefined&&$('#raw-url'))$('#raw-url').value=raw;localizeWorkspace($('#market-content'))}};
 const renderPrevious=render;render=function(...args){if(ui.workspace===8){if(!featureEnabled('marketplace'))ui.workspace=0;else{ensureStudioState();renderShell();patchMain('<section class="market-workspace">'+heading('模板与扩展市场','探索可复用的分镜、视觉资源与扩展。','','')+'<div id="market-content"></div></section>');renderMarket();$('.breadcrumb strong').textContent='模板与扩展市场';return}}if(ui.workspace===5&&studioUI.settingsTab==='critic'){ui.workspace=7}const result=renderPrevious(...args);if(ui.workspace===3){const crumb=$('.breadcrumb strong');if(crumb)crumb.textContent='工作流与 API 配置'}if(state.settings.studio.visibility.extensions===false){if($('#assistant'))$('#assistant').hidden=true}return result};
 const navigatePrevious=navigate;navigate=function(index){if(Number(index)===8){marketModal();return}const result=navigatePrevious(index);if(Number(index)===7){const book=selectedLabBook();if(book?._lazy)globalThis.Mio.fileLibrary.hydrate(book.id).then(()=>{if(ui.workspace===7)render()}).catch(e=>toast(e.message,'error'))}return result};
 const actionPrevious=handleAction;handleAction=async function(action,d={},el){if(action.startsWith('art-lab-')&&state.settings.studio.visibility.extensions===false)throw Error('可选功能已关闭');return actionPrevious(action,d,el)};
 Object.assign(v3Actions,{
  'local-critic-api':()=>{if(ui.workspace!==7||state.settings.studio.visibility.extensions===false)throw Error('请在可选功能工作台配置');openCriticSettings()},
  'workshop-negative-all':async()=>{const s=workshopStory(),value=s.frames[workshop.frame]?.negative||'';if(await confirmAction('覆盖所有分幕的负向提示词？',`将更新「${s.title}」的 ${s.frames.length} 幕；已装配任务不受影响。`,'应用到所有分幕')){s.frames.forEach(f=>f.negative=value);save();render()}},
  'designer-mode':d=>{assemblyDesign.drag=null;assemblyDesign.mode=d.mode;renderAssemblyDesigner()},
  'designer-workflow-clear':()=>{assemblyDesign.workflowQuery='';const box=$('#designer-workflow-search');if(box){box.value='';box.focus()}refreshDesignerWorkflowPicker()},
  'designer-next':()=>{if(assemblyDesign.step===0){validateDesignerEnvironment();if(!templateBy(assemblyDesign.storyId)?.frames.length)throw Error('请选择非空分镜')}assemblyDesign.step++;renderAssemblyDesigner()},
  'designer-back':()=>{assemblyDesign.step--;renderAssemblyDesigner()},
  'designer-submit':submitAssemblyDesigner,
  'designer-add-story':()=>{const id=$('#canvas-story-choice').value,t=templateBy(id);if(!t)return;const d=assemblyDesign;d.stories.push({id:uid('node'),assetId:id,title:t.title+' · 新画册',x:35,y:30+d.stories.length*180});renderAssemblyDesigner()},
  'designer-add-preset':()=>{const id=$('#canvas-preset-choice').value;if(!id)return;const d=assemblyDesign;if(d.visuals.some(p=>p.assetId===id))return;d.visuals.push({id:uid('node'),assetId:id,x:760,y:30+d.visuals.length*180});renderAssemblyDesigner()},
  'designer-remove-node':d=>{const a=assemblyDesign;a.stories=a.stories.filter(n=>n.id!==d.id);a.visuals=a.visuals.filter(n=>n.id!==d.id);a.edges=a.edges.filter(e=>e.story!==d.id&&e.preset!==d.id);renderAssemblyDesigner()},
    'designer-lora-unpin':d=>{
      const key=designerLoraKey(d.name);
      const blueprintLora=assemblyDesign.overrideDefaults?.loras?.find(l=>designerLoraKey(l.name)===key);
      if(blueprintLora&&Number.isFinite(Number(blueprintLora.strength))){
        assemblyDesign.overrideMemory=assemblyDesign.overrideMemory||{loraStrengths:{},sessionModified:{}};
        assemblyDesign.overrideMemory.loraStrengths=assemblyDesign.overrideMemory.loraStrengths||{};
        if(assemblyDesign.overrideMemory.loraStrengths[key]===undefined){
          assemblyDesign.overrideMemory.loraStrengths[key]=Number(blueprintLora.strength);
        }
      }
      if(!assemblyDesign.overrides.unpin.some(u=>designerLoraKey(u)===key)){
        assemblyDesign.overrides.unpin.push(d.name);
      }
      refreshDesignerOverrides('lora');
    },
    'designer-lora-remove':d=>{
      const index=Number(d.index),l=assemblyDesign.overrides.loras[index];
      if(l){
        const key=designerLoraKey(l.name);
        assemblyDesign.overrideMemory=assemblyDesign.overrideMemory||{loraStrengths:{},sessionModified:{}};
        assemblyDesign.overrideMemory.loraStrengths=assemblyDesign.overrideMemory.loraStrengths||{};
        assemblyDesign.overrideMemory.loraStrengths[key]=l.strength;
        assemblyDesign.overrideMemory.sessionModified=assemblyDesign.overrideMemory.sessionModified||{};
        assemblyDesign.overrideMemory.sessionModified[key]=l.strength;
        assemblyDesign.overrides.loras.splice(index,1);
        const defaultLora=assemblyDesign.overrideDefaults?.loras?.find(x=>designerLoraKey(x.name)===key);
        if(defaultLora&&!assemblyDesign.overrides.unpin.some(u=>designerLoraKey(u)===key)){
          assemblyDesign.overrides.unpin.push(defaultLora.name||l.name);
        }
        refreshDesignerOverrides('lora');
      }
    },
    'designer-lora-add-free':d=>{designerAddLora(String(d.name||'').trim());assemblyDesign.overrideUI.loraQuery='';const search=$('#designer-lora-search');if(search)search.value='';refreshDesignerOverrides('lora')},
    'designer-add-seed-mapping':()=>{addWorkflowSeedMapping(assemblyDesign.workflowId);renderAssemblyDesigner();toast('已添加种子映射：每一幕都会写入自己的种子。')},
    'designer-sync-catalog':async()=>{await readComfyObjectInfo();const query=assemblyDesign.overrideUI;initDesignerOverrides();assemblyDesign.overrideUI=query;renderAssemblyDesigner()}
   });
   document.addEventListener('change',e=>{const el=e.target,d=assemblyDesign;if(el.id==='designer-story')d.storyId=el.value;if(el.id==='designer-project'){rememberDesignerProject(el.value);renderAssemblyDesigner();return}if(el.dataset.designerPreset){el.checked?d.presets.add(el.dataset.designerPreset):d.presets.delete(el.dataset.designerPreset);el.closest('label').classList.toggle('selected',el.checked);const status=$('#designer-presets-status');if(status)status.textContent=designerPresetsStatus()}if(el.id==='designer-channel'||el.id==='designer-workflow'){if(el.id==='designer-channel')d.channelId=el.value;else d.workflowId=el.value;d.seedEnabled=false;state.settings.productionAssembly={...(state.settings.productionAssembly||{}),channelId:d.channelId,workflowId:d.workflowId};save();initDesignerOverrides();renderAssemblyDesigner()}if(el.dataset.designerPairedModel){d.overrides.models[el.dataset.designerPairedModel]=el.value;refreshDesignerModelAlert()}if(el.id==='designer-model-list'){d.overrides.model=el.value;refreshDesignerOverrides('model');refreshDesignerModelAlert()}if(el.dataset.designerLoraToggle!==undefined){try{if(el.checked)designerAddLora(el.dataset.designerLoraToggle);else{const key=designerLoraKey(el.dataset.designerLoraToggle);const l=d.overrides.loras.find(x=>designerLoraKey(x.name)===key);if(l){d.overrideMemory=d.overrideMemory||{loraStrengths:{},sessionModified:{}};d.overrideMemory.loraStrengths=d.overrideMemory.loraStrengths||{};d.overrideMemory.loraStrengths[key]=l.strength;d.overrideMemory.sessionModified=d.overrideMemory.sessionModified||{};d.overrideMemory.sessionModified[key]=l.strength}d.overrides.loras=d.overrides.loras.filter(l=>designerLoraKey(l.name)!==key);const defaultLora=d.overrideDefaults?.loras?.find(x=>designerLoraKey(x.name)===key);if(defaultLora&&!d.overrides.unpin.some(u=>designerLoraKey(u)===key)){d.overrides.unpin.push(defaultLora.name||el.dataset.designerLoraToggle)}}}catch(error){el.checked=false;toast(error.message,'error')}refreshDesignerOverrides('lora')}if(el.id==='designer-seed-enable'){d.seedEnabled=el.checked;renderAssemblyDesigner()}if(el.dataset.edgeStory){const {edgeStory:story,edgePreset:preset}=el.dataset;if(el.checked)linkDesigner(story,preset);else{d.edges=d.edges.filter(e=>e.story!==story||e.preset!==preset);updateDesignerLines()}}if(el.dataset.studioPref==='visibility.marketplace')render()});
   document.addEventListener('input',e=>{const el=e.target,d=assemblyDesign;if(el.id==='designer-title')d.title=el.value;if(el.id==='designer-seed')d.seed=Number(el.value);if(el.id==='designer-concurrency'){const raw=el.value.trim();d.concurrency=raw===''?null:Number(raw)}if(el.dataset.nodeTitle){const n=d.stories.find(n=>n.id===el.dataset.nodeTitle);if(n)n.title=el.value}if(el.id==='designer-workflow-search'){d.workflowQuery=el.value;refreshDesignerWorkflowPicker()}if(el.id==='designer-model-search'){d.overrideUI.modelQuery=el.value;refreshDesignerOverrides('model')}if(el.id==='designer-lora-search'){d.overrideUI.loraQuery=el.value;const results=$('#designer-lora-results'),slots=designerSlots();if(results&&slots)results.innerHTML=designerLoraResultsHTML(slots)}if(el.dataset.designerLoraStrength!==undefined){const l=d.overrides.loras[Number(el.dataset.designerLoraStrength)];if(l){l.strength=Number(el.value);const key=designerLoraKey(l.name);d.overrideMemory=d.overrideMemory||{loraStrengths:{},sessionModified:{}};d.overrideMemory.loraStrengths=d.overrideMemory.loraStrengths||{};d.overrideMemory.loraStrengths[key]=l.strength;d.overrideMemory.sessionModified=d.overrideMemory.sessionModified||{};d.overrideMemory.sessionModified[key]=l.strength;const out=$(`[data-designer-lora-output="${el.dataset.designerLoraStrength}"]`);if(out)out.textContent=WorkflowSlots.numberText(l.strength)}}});
 document.addEventListener('pointerdown',e=>{const d=assemblyDesign,port=e.target.closest('[data-port-story]'),header=e.target.closest('[data-drag-node]');if(port){d.drag={kind:'link',id:port.dataset.portStory};e.preventDefault()}else if(header&&!e.target.closest('button')){const n=[...d.stories,...d.visuals].find(n=>n.id===header.dataset.dragNode);d.drag={kind:'move',id:n.id,x:e.clientX,y:e.clientY,ox:n.x,oy:n.y};e.preventDefault()}});
 document.addEventListener('pointermove',e=>{const d=assemblyDesign;if(!d.drag)return;const world=$('.link-world');if(!world)return;const r=world.getBoundingClientRect();if(d.drag.kind==='link')updateDesignerLines({x:e.clientX-r.left,y:e.clientY-r.top});else{const n=[...d.stories,...d.visuals].find(n=>n.id===d.drag.id);if(!n)return;n.x=clamp(d.drag.ox+e.clientX-d.drag.x,12,920);n.y=clamp(d.drag.oy+e.clientY-d.drag.y,12,world.offsetHeight-165);const node=$(`[data-node="${n.id}"]`);node.style.left=n.x+'px';node.style.top=n.y+'px';updateDesignerLines()}});
 document.addEventListener('pointerup',e=>{const d=assemblyDesign;if(!d.drag)return;if(d.drag.kind==='link'){const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-port-preset]');if(target)linkDesigner(d.drag.id,target.dataset.portPreset)}else d.drag=null});
  document.addEventListener('click',e=>{
   const modelPick=e.target.closest?.('[data-designer-model-pick]');
   if(modelPick){
    const val=modelPick.dataset.designerModelPick;
    assemblyDesign.overrides.model=val;
    $$('#designer-model-results .designer-model-option').forEach(el=>el.classList.toggle('is-on',el.dataset.designerModelPick===val));
    refreshDesignerModelAlert();
    return;
   }
   const target=e.target.closest('[data-port-preset]'),line=e.target.closest('[data-edge-delete]');
   if(target&&assemblyDesign.drag?.kind==='link')linkDesigner(assemblyDesign.drag.id,target.dataset.portPreset);
   if(line){assemblyDesign.edges.splice(Number(line.dataset.edgeDelete),1);renderAssemblyDesigner()}
  });
 document.addEventListener('keydown',e=>{if(e.target.id==='designer-workflow-search'&&!e.isComposing){const list=$('#designer-workflow');if(e.key==='ArrowDown'&&list){e.preventDefault();list.focus();return}if(e.key==='Enter'){e.preventDefault();const result=designerWorkflowChoices();if(result.matched===1&&String(result.options[0].id)!==String(assemblyDesign.workflowId)&&list){list.value=result.options[0].id;list.dispatchEvent(new Event('change',{bubbles:true}))}return}}if(e.key==='Escape'){assemblyDesign.drag=null;updateDesignerLines()}if(['Enter','Delete','Backspace'].includes(e.key)&&e.target.matches('[data-edge-delete]')){e.preventDefault();assemblyDesign.edges.splice(Number(e.target.dataset.edgeDelete),1);renderAssemblyDesigner()}});
 $('#modal').addEventListener('close',()=>{$('#modal').classList.remove('assembly-designer');assemblyDesign.drag=null});
}
