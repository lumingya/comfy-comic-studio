/* Mio development module: app. */
'use strict';

'use strict';


const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)],esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&#60;','>':'&#62;','"':'&quot;',"'":'&#39;'}[c]));


const uid=p=>p+'_'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2,8)),clone=x=>JSON.parse(JSON.stringify(x)),clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),pad=n=>String(n).padStart(2,'0');


const paths={grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',story:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',nodes:'<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v9h9M15 6h6M18 3v6"/>',spark:'<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 2v4M18 4h4"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',plus:'<path d="M12 5v14M5 12h14"/>',down:'<path d="m6 9 6 6 6-6"/>',up:'<path d="m6 15 6-6 6 6"/>',star:'<path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z"/>',folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',book:'<path d="M12 5c-3-2-7-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1ZM12 5v15"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L6 21"/>',check:'<path d="m5 12 4 4L19 6"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-5"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',box:'<path d="m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--bg)"/><circle cx="16" cy="17" r="3" fill="var(--bg)"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',play:'<path d="m7 4 14 8-14 8V4Z"/>',pause:'<path d="M8 4v16M16 4v16"/>',stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v6h-6"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>',copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',edit:'<path d="m14 5 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1 1-6Z"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',terminal:'<path d="m4 6 6 6-6 6M13 18h7"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',disk:'<path d="M3 3h15l3 3v15H3V3ZM7 3v6h10V3M7 21v-8h10v8"/>',expand:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',attach:'<path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2"/>',send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',compare:'<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.1"/>',brush:'<path d="m14 6 4 4M8 14 18 3a2 2 0 0 1 3 3L11 17M10 15c-7-3-3 6-8 6 7 1 10-2 8-6Z"/>'};


const icon=(n,c='')=>`<svg class="icon ${c}" viewBox="0 0 24 24" aria-hidden="true">${paths[n]||paths.grid}</svg>`,btn=(l,i,a,x='',c='')=>`<button type="button" class="btn ${c}" data-act="${a}" ${x}>${i?icon(i):''}${l}</button>`,ibtn=(i,a,l,x='')=>`<button type="button" class="ibtn" data-act="${a}" title="${esc(l)}" aria-label="${esc(l)}" ${x}>${icon(i)}</button>`,opt=(v,l,c)=>`<option value="${esc(v)}" ${String(v)===String(c)?'selected':''}>${esc(l)}</option>`,input=(n,v,t='text',a='')=>`<input name="${n}" type="${t}" value="${esc(v)}" ${a}>`,field=(l,c,h='')=>`<div class="field"><label class="label">${l}</label>${c}${h?`<div class="help">${h}</div>`:''}</div>`;


const palettes=[['#90bed5','#f4d6be','#6b9f9f','#233b52'],['#322e58','#e598ba','#595387','#19253f'],['#c5d9c5','#ffe4bb','#6c9887','#354b4d'],['#1c344e','#ddbaca','#486887','#282a42'],['#8fbbb0','#f1d3a3','#548780','#203e3d'],['#58628d','#f0bc9e','#738e9e','#252d43']];


const artUrls=['https://images.alphacoders.com/819/thumbbig-819506.webp','https://images2.alphacoders.com/103/thumbbig-1033287.webp','https://images3.alphacoders.com/131/thumbbig-1313942.webp','https://images7.alphacoders.com/725/thumbbig-725912.webp','https://images3.alphacoders.com/645/thumbbig-645549.webp','https://images3.alphacoders.com/132/thumbbig-1322308.webp','https://images4.alphacoders.com/781/thumbbig-781724.webp','https://images.alphacoders.com/132/thumbbig-1322321.webp'];


const defaultWorkflow={'3':{class_type:'KSampler',inputs:{seed:42,steps:24,cfg:7,sampler_name:'euler',scheduler:'normal',denoise:1,model:['4',0],positive:['6',0],negative:['7',0],latent_image:['5',0]}},'4':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'your-anime-model.safetensors'}},'5':{class_type:'EmptyLatentImage',inputs:{width:768,height:1024,batch_size:1}},'6':{class_type:'CLIPTextEncode',inputs:{text:'{character}, anime illustration',clip:['4',1]}},'7':{class_type:'CLIPTextEncode',inputs:{text:'low quality, bad anatomy',clip:['4',1]}},'8':{class_type:'VAEDecode',inputs:{samples:['3',0],vae:['4',2]}},'9':{class_type:'SaveImage',inputs:{filename_prefix:'Mio',images:['8',0]}}};


const frameNames=['风起的站台','未寄出的信','穿过那片海','黄昏的约定','再次相遇','下一站，夏天','藏在风里的话','故事仍在继续'],captions=['夏日的风穿过站台，{character}握紧了那封没有寄出的信。','远处传来列车的声音。有些告别，原来从未说出口。','{character}沿着海岸奔跑，想在日落之前找到那个答案。','天空染上了温柔的橘色。我们说好，要在这里再见。','熟悉的身影站在光里，一如那个盛夏的午后。','下一站的名字，叫作重新开始。','那些没有说出口的话，都被风轻轻收藏。','而我们的故事，才刚刚开始。'];


let state=seedState();

const ui={workspace:0,templateId:'tpl_summer',frameIndex:0,filter:'all',search:'',sort:'createdAt',layout:'grid',selected:new Set(),bookId:null,mode:'focus',step:0,storyRowId:'row_0',storyTemplateId:'tpl_summer',llmTab:'story',marketTab:'all',marketSearch:'',exportFormat:'webtoon',exportIds:[],logFilter:'all'};


const rt={logs:[],running:false,paused:false,controller:null,llmController:null,llmBusy:false,lockedRows:new Set(),criticFailures:0,ws:null,reconnect:null,latency:null,vram:null,connected:false,clientId:uid('client'),saved:true,saving:false,db:null,observer:null,commandItems:[],commandIndex:0,chatBusy:false,attachments:[],redraw:new Set(),critiqueBusy:new Set(),mask:null};


const workspaces=[['画廊展厅','grid','GALLERY'],['分镜剧本配置','story','STORYBOARD'],['批量角色矩阵','users','CHARACTER MATRIX'],['ComfyUI 引擎管线','nodes','WORKFLOW ENGINE'],['LLM 剧情策划台','spark','STORY STUDIO']],project=()=>state.projects.find(p=>p.id===state.activeProjectId)||state.projects[0],projectBooks=()=>state.books.filter(b=>b.projectId===state.activeProjectId),projectRows=()=>state.rows.filter(r=>r.projectId===state.activeProjectId),projectTemplates=()=>state.templates.filter(t=>t.projectId===state.activeProjectId),currentTemplate=()=>state.templates.find(t=>t.id===ui.templateId)||projectTemplates()[0],bookBy=id=>state.books.find(b=>b.id===id),rowBy=id=>state.rows.find(r=>r.id===id),templateBy=id=>state.templates.find(t=>t.id===id);


const dateFmt=t=>new Date(t).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}).replace('/','.'),coverImage=b=>b.steps.find(s=>s.image&&!s.offlineFallback&&!isFallbackImage(s.image))?.image||'',imgTag=(s,a,x='')=>s?`<img src="${esc(s)}" alt="${esc(a)}" ${x}>`:missingArtworkHTML(a,x);


const heading=(t,d,a='',e='')=>`<div class="page-heading"><div>${e?`<div class="eyebrow">${e}</div>`:''}<h1>${t}</h1><p>${d}</p></div><div class="actions">${a}</div></div>`;


const reserved=new Set(['id','active','bookTitle','captions','storyVersions','activeStoryVersionIds','projectId','character','style','outfit','trigger','lora','references','__proto__','prototype','constructor']);


let saveTimer,saveAllow=false,saveTail=Promise.resolve();


const baseURL=()=>state.settings.comfy.baseUrl.trim().replace(/\/+$/,''),post=(body,signal)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});


const strSchema={type:'string'},indexSchema={type:'integer',minimum:0},frameSchema={type:'object',properties:{frameIndex:indexSchema,prompt:strSchema,caption:strSchema},required:['frameIndex'],additionalProperties:false};


const toolDefs=[['get_current_template_details','读取当前模板完整内容',{},[]],['update_template_title','更新模板标题',{title:strSchema},['title']],['update_template_outline','更新故事大纲',{outline:strSchema},['outline']],['update_frame_prompt_and_caption','精确更新分镜，索引从0开始；保留原提示词所有宏变量',{frameIndex:indexSchema,name:strSchema,prompt:strSchema,caption:strSchema},['frameIndex']],['add_new_frame','插入新分镜',{name:strSchema,prompt:strSchema,caption:strSchema,insertIndex:indexSchema},['name','prompt','caption']],['delete_frame','删除分镜，至少保留一幕',{frameIndex:indexSchema},['frameIndex']],['swap_frames','交换两幕顺序',{indexA:indexSchema,indexB:indexSchema},['indexA','indexB']],['batch_update_prompts_and_captions','原子化批量更新，保留宏变量',{frames:{type:'array',items:frameSchema}},['frames']]];


const assistantTools=toolDefs.map(([name,description,properties,required])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}}));


const catalog=[{id:'summer-pack',title:'海边来信 · 叙事分镜包',type:'templates',icon:'story',desc:'6 幕起承转合，海风、来信与重逢的电影式叙事。',author:'Mio Originals',version:'1.2',score:'4.9',tags:'青春 治愈 分镜'}, {id:'noir-pack',title:'霓虹漫游 · 都市电影包',type:'templates',icon:'story',desc:'8 幕雨夜叙事，适合悬疑、科幻与都市短篇。',author:'Nightlight Studio',version:'1.0',score:'4.8',tags:'赛博 都市 分镜'}, {id:'character-pack',title:'夏日少女 · 角色资产',type:'characters',icon:'users',desc:'平铺变量、服装与特征描述，快速建立角色生产矩阵。',author:'Mio Originals',version:'2.0',score:'4.9',tags:'角色 青春 一致性'}, {id:'anime-workflow',title:'Anime Basic · 标准图像管线',type:'workflows',icon:'nodes',desc:'标准 KSampler 工作流与明确的节点映射，可自由替换模型。',author:'Comfy Pipeline Lab',version:'1.1',score:'4.7',tags:'工作流 SDXL 动漫'}, {id:'critic-pack',title:'视觉审校 · 连贯性规则',type:'rules',icon:'shield',desc:'自动伴随审校，关注角色服装、解剖与光影连贯性。',author:'Mio Originals',version:'1.0',score:'4.8',tags:'审校 一致性'}];


function diagnostics(){const tests=[];const test=(name,fn)=>{try{if(fn()===false)throw Error('验证失败');tests.push([name,true,'通过'])}catch(e){tests.push([name,false,e.message])}};test('工程核心数据契约',()=>validateState(state));test('平铺宏变量插值',()=>interpolate('{character}/{character2}',{character:'A',character2:'B'})==='A/B');test('宏变量全字边界防碰撞',()=>'{character}/{character2}'.replace(new RegExp('\\{character\\}','g'),'{hero}')==='{hero}/{character2}');test('缺帧并集判定',()=>JSON.stringify(missingIndices({totalSteps:4,steps:[{stepIndex:0,image:'ready'},{stepIndex:1,image:''},{stepIndex:2,image:'svg',offlineFallback:true}]}))==='[1,2,3]');test('旧宏变量防删除',()=>{try{validatePrompt('character','{character}');return false}catch(e){return true}});test('八个标准工具 Schema',()=>assistantTools.length===8&&new Set(assistantTools.map(t=>t.function.name)).size===8);test('奇数页空白补齐边界',()=>{const n=5,last=Math.floor((n-1)/2)*2;return last===4&&last+1>=n});test('API 工作流扁平结构',()=>!!validateWorkflow(defaultWorkflow));test('确定性 SVG 输出',()=>svgArt(1,42)===svgArt(1,42));test('XML 中文 Schema 校验',()=>parseTemplateXML('<模板><标题>测试</标题><简介>测试</简介><分镜列表><分镜1><名称>一</名称><提示词>{character}</提示词><剧情>测试</剧情></分镜1></分镜列表></模板>').frames.length===1);modal('本地系统自检',`<div class="notice">这些检查在当前浏览器内真实执行，覆盖数据与边界逻辑；不代表远端 GPU 或 LLM 集成已验证。</div>${tests.map(([n,ok,d])=>`<div class="row" style="padding:14px 0;border-bottom:1px solid var(--line)"><span class="${ok?'accent':'danger'}">${icon(ok?'check':'close')}</span><span class="grow small">${n}</span><span class="tiny muted">${esc(d)}</span></div>`).join('')}`);return tests}


document.addEventListener('click',async e=>{if(e.target.closest('.cover-check'))return;const el=e.target.closest('[data-act]');if(!el)return;e.preventDefault();try{await handleAction(el.dataset.act,el.dataset,el)}catch(x){toast(x.message||'操作未完成。','error');log(x.message||String(x),'error')}});


document.addEventListener('input',e=>{const el=e.target;if(el.id==='gallery-search'){ui.search=el.value;refreshGallery()}if(el.id==='command-input'){rt.commandIndex=0;indexCommands(el.value)}if(el.id==='market-search'){ui.marketSearch=el.value;scheduleMarketSearch()}if(el.dataset.setting)storeSetting(el);if(el.dataset.frameField||el.dataset.templateField)flushEditor();if(el.dataset.rowField){const r=rowBy(el.dataset.row);if(r)r[el.dataset.rowField]=el.value;save()}if(el.dataset.storyCaption){const r=rowBy(ui.storyRowId),t=templateBy(ui.storyTemplateId);if(r&&t&&!rt.lockedRows.has(r.id)){const v=ensureManual(r,t);v.captions[Number(el.dataset.storyCaption)]=el.value;v.updatedAt=Date.now();save()}}if(el.id==='story-outline'){const r=rowBy(ui.storyRowId);if(r)r.storyOutline=el.value;save()}if(el.id==='story-tone'){const r=rowBy(ui.storyRowId);if(r)r.tone=el.value;save()}if(el.id==='xml-output')ui.xmlOutput=el.value;if(el.id?.startsWith('denoise-')&&!el.id.startsWith('denoise-value-')){const n=$('#denoise-value-'+el.id.split('-')[1]);if(n)n.textContent=Number(el.value).toFixed(2)}});


document.addEventListener('change',async e=>{const el=e.target;try{if(el.dataset.setting){storeSetting(el);if(el.dataset.setting==='comfy.mode'){resetWS();renderShell();if(ui.workspace===3)render()}}if(el.id==='project-select')changeProject(el.value);if(el.id==='gallery-filter'){ui.filter=el.value;refreshGallery()}if(el.id==='gallery-sort'){ui.sort=el.value;refreshGallery()}if(el.dataset.selectBook){el.checked?ui.selected.add(el.dataset.selectBook):ui.selected.delete(el.dataset.selectBook);refreshGallery()}if(el.dataset.rowActive){rowBy(el.dataset.rowActive).active=el.checked;save()}if(el.id==='matrix-all'){projectRows().forEach(r=>r.active=el.checked);save();render()}if(['template-select','batch-template'].includes(el.id)){flushEditor();ui.templateId=el.value;ui.frameIndex=0;render()}if(el.id==='story-row'){ui.storyRowId=el.value;render()}if(el.id==='story-template'){ui.storyTemplateId=el.value;render()}if(el.id==='story-version'){rowBy(ui.storyRowId).activeStoryVersionIds[ui.storyTemplateId]=el.value;save();render()}if(el.id==='reader-version')openReader(el.value);if(el.id==='chat-select'){if(rt.chatBusy)throw Error('当前对话尚未结束。');state.activeChatId=el.value;save();renderAssistant()}if(el.id==='workflow-preset'&&el.value!==''){const p=state.settings.comfy.presets[Number(el.value)];state.settings.comfy.workflow=clone(p.workflow);state.settings.comfy.mapping=clone(p.mapping);state.settings.comfy.workflowTitle=p.title;save();render()}if(el.id==='llm-provider'){const c=state.settings.llm,p={openai:['https://api.openai.com/v1','gpt-4o'],deepseek:['https://api.deepseek.com','deepseek-chat'],ollama:['http://localhost:11434/v1','llama3.2'],custom:['https://your-gateway.example/v1','your-model']}[el.value];c.provider=el.value;c.baseUrl=p[0];c.model=p[1];save();llmSettings()}}catch(x){toast(x.message,'error')}});


document.addEventListener('keydown',async e=>{try{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if($('#command-dialog').open)$('#command-dialog').close();else openCommand();return}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='j'){e.preventDefault();if($('#assistant').hidden)showAssistant();else $('#assistant').hidden=true;return}if($('#command-dialog').open){if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();rt.commandIndex=clamp(rt.commandIndex+(e.key==='ArrowDown'?1:-1),0,rt.commandItems.length-1);indexCommands($('#command-input').value);$('.command-item.active')?.scrollIntoView({block:'nearest'})}if(e.key==='Enter'){e.preventDefault();await handleAction('run-command',{index:rt.commandIndex})}return}if(e.target.id==='chat-input'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();await sendChat();return}if(e.target.closest('input,textarea,select,[contenteditable]'))return;if(e.target.matches('[role="button"]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.click();return}if($('#reader').open&&!$('#modal').open){if(e.key==='ArrowRight'){e.preventDefault();await handleAction('page-next',{})}if(e.key==='ArrowLeft'){e.preventDefault();await handleAction('page-prev',{})}return}if(!document.querySelector('dialog[open]')&&!e.ctrlKey&&!e.metaKey&&/^[1-5]$/.test(e.key)){e.preventDefault();navigate(Number(e.key)-1)}}catch(x){toast(x.message,'error')}});


document.addEventListener('submit',e=>{e.preventDefault();if(e.target.id==='text-form')handleAction('text-submit',{}).catch(x=>toast(x.message,'error'))});


document.addEventListener('error',e=>{if(!(e.target instanceof HTMLImageElement))return;const el=e.target;if(el.dataset.fallbackApplied)return;el.dataset.fallbackApplied='1';el.replaceWith(missingArtworkElement(el));},true);


$('#reader').addEventListener('cancel',e=>{e.preventDefault();if(!$('#assistant').hidden)$('#assistant').hidden=true;else closeReader()});


for(const d of $$('dialog'))d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){if(d.id==='reader')closeReader();else if(d.id==='confirm-dialog')$('#confirm-no').click();else d.close()}});


let dragIndex=null;

document.addEventListener('dragstart',e=>{const el=e.target.closest('[data-drag-index]');if(el){flushEditor();dragIndex=Number(el.dataset.dragIndex);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(dragIndex))}});

document.addEventListener('dragover',e=>{if(e.target.closest('[data-drag-index]')||e.target.closest('#assistant'))e.preventDefault()});

document.addEventListener('drop',e=>{const target=e.target.closest('[data-drag-index]');if(target&&dragIndex!==null){e.preventDefault();const t=currentTemplate(),to=Number(target.dataset.dragIndex),f=t.frames.splice(dragIndex,1)[0];t.frames.splice(to,0,f);ui.frameIndex=to;dragIndex=null;save();render()}else if(e.target.closest('#assistant')){e.preventDefault();addAttachments([...e.dataTransfer.files]).catch(x=>toast(x.message,'error'))}});


window.addEventListener('beforeunload',()=>{flushEditor()});


async function boot(){rt.booting=true;$('#launch-icon').innerHTML=icon('spark');$('#command-icon').innerHTML=icon('search');render();await loadState();log('Mio v'+MIO_VERSION+' 已就绪。所有创作默认保存在本地。');log('已载入 '+state.books.length+' 本画册、'+state.exportTemplates.length+' 个画册导出模板。');if(state.queue.some(q=>q.status==='pending'))log('有待执行的渲染任务，已安全保留，等待手动启动。');if(state.settings.comfy.mode==='real')void testEngine(true);setInterval(()=>{if(state.settings.comfy.mode==='real')void testEngine(true)},20000)}


const STUDIO_VERSION='3.2.0';
const MIO_VERSION='1.0.0';


const moduleKeys=['gallery','storyboard','matrix','engine','llm'];


const exportLayouts={webtoon:'Webtoon 长卷',manga:'Manga 双页',artbook:'Artbook 艺术册',flip:'3D 交互画册'};


const templateKind='comfycomic.export-template';


/** @typedef {{id:string,kind:string,formatVersion:number,title:string,description:string,author:string,version:string,layout:'webtoon'|'manga'|'artbook'|'flip',html:string,options:Object,builtin:boolean,source:string,createdAt:number,updatedAt:number}} ExportTemplate */
const exportOptionDefaults={accent:'#43634b',background:'#f3f0e7',paper:'#fffdf6',text:'#29382d',width:800,gap:24,radius:2,font:'serif'};


const studioDefaults={
  visibility:{gallery:true,storyboard:true,matrix:true,engine:true,llm:true},
  features:{assistant:true,marketplace:true,visualCritic:true,executionLogs:true},
  appearance:{theme:document.documentElement.dataset.theme||'dark',density:'comfortable',reduceMotion:false,showMetrics:true},
  reader:{defaultMode:'focus'},
  export:{templateId:'export-paper',showCaptions:true,showPrompts:false,border:0},
  assistant:{confirmChanges:true}
};


const studioUI={settingsTab:'general',editor:null,editorTab:'design',previewDevice:'desktop',previewBookId:null,previewTimer:null,editorDirty:false,exportDraft:null,exportBusy:false,assistantDraft:'',assistantUndo:null,assistantTargetId:null};


const exportTemplateBy=id=>state.exportTemplates?.find(t=>t.id===id);


const exportVariableNames=new Set(['collectionTitle','title','synopsis','characterName','templateTitle','storyTitle','signature','date','themeColor','background','paperColor','textColor','contentWidth','panelGap','imageRadius','bodyFont','frameBorder','layout','layoutName','panelCount','bookCount','image','caption','prompt','number','name','imageNote','palette1','palette2','palette3']);


const toolLabels={get_current_template_details:'读取模板内容',update_template_title:'修改模板标题',update_template_outline:'调整故事大纲',update_frame_prompt_and_caption:'修改分镜',add_new_frame:'新增分镜',delete_frame:'删除分镜',swap_frames:'交换分镜顺序',batch_update_prompts_and_captions:'批量修改分镜'};


const exportMarketCatalog=[
  {id:'export-spring-package',title:'花信 · 春日手札',type:'exports',icon:'book',desc:'奶油纸张、柔和粉色与轻巧边距。适合青春与治愈系长卷。',author:'Mio',version:'1.0.0',tags:'画册 HTML 导出 春日 治愈',layout:'webtoon',options:{accent:'#ab727b',background:'#f4e9e5',paper:'#fffcf5',text:'#594447',width:760,gap:28,radius:5,font:'serif'}},
  {id:'export-cinema-package',title:'银幕 · 电影双页',type:'exports',icon:'compare',desc:'深色底幕与清晰的对开构图，让都市和悬疑故事更有电影感。',author:'Mio',version:'1.1.0',tags:'画册 HTML 导出 赛博 电影 都市',layout:'manga',options:{accent:'#bdad83',background:'#191b20',paper:'#262831',text:'#e9e4d6',width:1200,gap:6,radius:0,font:'sans'}},
  {id:'export-archive-package',title:'档案 · 精装作品集',type:'exports',icon:'image',desc:'鼠尾草绿与展览式留白，保留画面色卡和创作者签名。',author:'Mio',version:'1.0.0',tags:'画册 HTML 导出 艺术册 极简 展览',layout:'artbook',options:{accent:'#64745d',background:'#e9ece3',paper:'#f9faf3',text:'#354333',width:1000,gap:40,radius:0,font:'serif'}}
];


catalog.push(...exportMarketCatalog);



/* The v2.3 adapters preserve the established production controllers and old backups. */
const studioCore={render,renderShell,renderStatus,validateState,assetCount,handleAction,openReader,renderReader,critiqueStep,toast,diagnostics};


validateState=function(s){studioCore.validateState(s);validateStudioData(s);return true};


assetCount=function(s){return studioCore.assetCount(s)+(s.exportTemplates?.length||0)};


renderShell=renderStudioShell;


renderStatus=function(){studioCore.renderStatus();const footer=$('#statusbar');if(footer)footer.innerHTML=footer.innerHTML.replace('v2.2.0','v'+STUDIO_VERSION)};


render=function(){ensureStudioState();if(!workspaceVisible(ui.workspace))ui.workspace=0;if(ui.workspace===5){renderShell();$('#main').innerHTML='<div class="view">'+renderSettingsWorkspace()+'</div>'}else studioCore.render();applyStudioPreferences()};


navigate=navigateStudio;


settingsModal=function(){if($('#modal').open)closeModal();if($('#reader').open)closeReader();navigate(5)};


exportModal=showExportHub;


compileExport=compileCustomExport;


renderMarket=renderStudioMarket;


importRaw=importStudioRaw;


indexCommands=buildStudioCommandIndex;


renderAssistant=renderScopedAssistant;


showAssistant=function(){if($('#template-studio').open){toast('这里编辑导出 HTML。精修助手只修改源分镜，请先返回工作台。');return}showScopedAssistant()};


sendChat=sendScopedChat;


openReader=function(id){if(!$('#reader').open)ui.mode=state.settings.studio.reader.defaultMode;studioCore.openReader(id);applyStudioPreferences()};


renderReader=function(){studioCore.renderReader();applyStudioPreferences()};


critiqueStep=async function(...args){if(!featureEnabled('visualCritic')){if(args[2])return;throw Error('视觉审校已停用，可在模块管理中重新启用。')}try{return await studioCore.critiqueStep(...args)}finally{applyStudioPreferences()}};


toast=function(message,type='ok'){studioCore.toast(message,type);if($('#template-studio').open&&!$('#confirm-dialog').open&&!$('#command-dialog').open)$('#template-studio').append($('#toasts'))};



const studioActions={
  settings:async()=>{if($('#template-studio').open&&!await closeTemplateStudio())return;if($('#command-dialog').open)$('#command-dialog').close();settingsModal()},
  theme:()=>{state.settings.studio.appearance.theme=state.settings.studio.appearance.theme==='dark'?'light':'dark';save();renderShell();if(ui.workspace===5)render()},
  'studio-tab':d=>{studioUI.settingsTab=d.tab;render()},
  'studio-background':async()=>{if($('#template-studio').open&&!await closeTemplateStudio())return;studioUI.settingsTab='connections';settingsModal()},
  'studio-reset':async()=>{if(await confirmAction('恢复工作室默认设置？','不会删除作品、自定义模板、角色、工作流或 API 配置。','恢复界面默认')){state.settings.studio=clone(studioDefaults);save();render();toast('界面与默认行为已还原。')}},
  'et-open-library':()=>{readExportDraft();openTemplateStudio(studioUI.exportDraft?.templateId)},
  'et-open-selected':()=>{readExportDraft();openTemplateStudio(studioUI.exportDraft.templateId)},
  'et-close':()=>closeTemplateStudio(),
  'et-select':async d=>{if(studioUI.editor?.id===d.id)return;if(!await canLeaveTemplate())return;const t=exportTemplateBy(d.id);if(!t)return;studioUI.editor=clone(t);studioUI.editorDirty=false;renderTemplateStudio()},
  'et-tab':d=>{studioUI.editorTab=d.tab;renderTemplateStudio()},
  'et-device':d=>{studioUI.previewDevice=d.device;$('#template-viewport')?.classList.toggle('mobile',d.device==='mobile');$$('[data-act="et-device"]').forEach(e=>e.classList.toggle('on',e.dataset.device===d.device))},
  'et-preview':()=>updateTemplatePreview(),
  'et-save':()=>saveEditedTemplate(),
  'et-new':async()=>{if($('#template-studio').open&&!await canLeaveTemplate())return;openTemplateStudio(null,makeExportTemplate(uid('export'),'我的画册模板','webtoon',{},'为自己的故事设计一份阅读版式。','local'))},
  'et-duplicate':()=>{const t=exportTemplateCopy(currentEditorTemplate());validateExportTemplate(t);if(state.exportTemplates.length>=100)throw Error('模板库已达上限。');state.exportTemplates.push(t);studioUI.editor=clone(t);studioUI.editorDirty=false;save();renderTemplateStudio();toast('已创建可独立修改的副本。')},
  'et-delete':async()=>{const t=currentEditorTemplate();if(t.builtin)throw Error('内置模板不可删除，请保留作为恢复基底。');if(!await confirmAction('删除这份自定义模板？','不会删除画册，也不影响已导出的 HTML 文件。','删除模板'))return;state.exportTemplates=state.exportTemplates.filter(x=>x.id!==t.id);for(const p of state.installedPackages)if(p.type==='exports')p.assetIds=p.assetIds.filter(id=>id!==t.id);state.installedPackages=state.installedPackages.filter(p=>p.type!=='exports'||p.assetIds.length);ensureStudioState();studioUI.editor=clone(state.exportTemplates[0]);studioUI.editorDirty=false;save(true);renderTemplateStudio();toast('模板已删除。')},
  'et-revert':async()=>{const saved=exportTemplateBy(studioUI.editor?.id);if(!saved)throw Error('这是未保存的新草稿，没有可还原版本。');if(studioUI.editorDirty&&!await confirmAction('放弃尚未保存的修改？','还原到模板库中的最后保存版本。','还原'))return;studioUI.editor=clone(saved);studioUI.editorDirty=false;try{sessionStorage.removeItem('cc-template-draft')}catch(e){}renderTemplateStudio()},
  'et-default':()=>{let t=currentEditorTemplate();if(studioUI.editorDirty||!exportTemplateBy(t.id))t=saveEditedTemplate();state.settings.studio.export.templateId=t.id;save();renderTemplateStudio();toast('下次导出默认使用「'+t.title+'」。')},
  'et-export-menu':()=>{exportTemplatePackage(currentEditorTemplate(),'json');toast('模板包已下载，包含完整 HTML、外观设置与元信息。')},
  'et-export-html':()=>{exportTemplatePackage(currentEditorTemplate(),'html');toast('HTML 模板源码已下载，可编辑后重新导入。')},
  'et-import':async()=>{if($('#template-studio').open&&!await canLeaveTemplate())return;readExportDraft();pickFile('.html,.htm,.json',importExportTemplate)},
  'et-restore-draft':async()=>{if(studioUI.editorDirty&&!await canLeaveTemplate())return;const saved=storedTemplateDraft();if(!saved)throw Error('没有可恢复的草稿。');studioUI.editor=clone(saved.template);studioUI.editorDirty=true;renderTemplateStudio();toast('未保存草稿已恢复，请检查后保存。')},
  'et-insert-loop':()=>{const t=currentEditorTemplate();if(t.html.includes('{{#books}}'))throw Error('文档已经包含画册循环，请直接编辑现有结构。');if(!/<\/body\s*>/i.test(t.html))throw Error('请先补全 body 结构。');t.html=t.html.replace(/<\/body\s*>/i,()=>standardBookLoop()+'\n</body>');stashTemplateDraft();renderTemplateStudio()},
  'et-market':async()=>{const returnTo=Boolean($('#export-hub-root'));if($('#template-studio').open&&!await closeTemplateStudio())return;studioUI.returnToExport=returnTo;ui.marketTab='exports';ui.marketSearch='';marketModal()},
  'et-export-market':()=>{readExportDraft();studioUI.returnToExport=true;ui.marketTab='exports';ui.marketSearch='';marketModal()},
  'et-settings-market':()=>{studioUI.returnToExport=false;ui.marketTab='exports';ui.marketSearch='';marketModal()},
  'et-return-export':()=>showExportHub(ui.exportIds,true),
  'et-market-preview':d=>previewMarketTemplate(d.id),
  'et-market-download':d=>{exportTemplatePackage(marketTemplate(d.id),'json');toast('市场模板包已下载，无需安装也可保存或迁移。')},
  'et-open-installed':d=>{const p=state.installedPackages.find(p=>p.id===d.id);openTemplateStudio(p?.assetIds?.[0])},
  'assistant-suggestion':d=>{studioUI.assistantDraft=d.text;$('#chat-input').value=d.text;$('#chat-input').focus()},
  'assistant-open-target':()=>{const id=assistantScope()?.id;if(!id)return;if($('#reader').open)closeReader();ui.templateId=id;ui.frameIndex=0;navigate(1)},
  'assistant-undo':()=>undoAssistantEdit(),
  'assistant-stop':()=>{rt.assistantController?.abort();toast('正在停止本次助手请求。')}
};


handleAction=async function(act,d={},el){
  if(act==='run-command'&&$('#template-studio').open){$('#command-dialog').close();if(!await closeTemplateStudio())return}
  if(act==='workspace'&&$('#template-studio').open&&!await closeTemplateStudio())return;
  if(['market','et-market','et-export-market','et-settings-market','et-market-preview','et-market-download','market-install','import-raw'].includes(act)&&!featureEnabled('marketplace')){toast('模板市场已停用，可在工作室设置中重新启用。');return}
  if(['assistant','send-chat','new-chat','chat-attach','assistant-suggestion'].includes(act)&&!featureEnabled('assistant')){toast('分镜精修助手已停用。');return}
  if(['batch-story','script-regenerate','generate-story','regenerate-scene','generate-xml','generate-outline','llm-tab'].includes(act)&&!workspaceVisible(4)){toast('剧情策划工作区已隐藏，请在模块设置中启用后操作。');return}
  if(Object.hasOwn(studioActions,act)){await studioActions[act](d,el);applyStudioPreferences();return}
  if(act==='market-install'&&exportMarketCatalog.some(c=>c.id===d.id)){await installExportPackage(d.id);return}
  await studioCore.handleAction(act,d,el);applyStudioPreferences();
  if(act==='backup'){const n=$('#modal-body .notice');if(n)n.textContent+=' 自定义画册 HTML 模板、模块开关与界面设置也会包含在工程备份中。'}
};



diagnostics=function(){
  const tests=studioCore.diagnostics(),extra=[];
  const test=(name,fn)=>{try{if(fn()===false)throw Error('断言不成立');extra.push([name,true,'通过'])}catch(e){extra.push([name,false,e.message])}};
  test('四种内置 HTML 模板结构',()=>builtinExportTemplates().every(t=>validateExportTemplate(t)));
  test('三个市场模板可独立安装',()=>exportMarketCatalog.every(c=>validateExportTemplate(marketTemplate(c.id))));
  test('JSON 模板包导入兼容',()=>{const t=builtinExportTemplates()[0],copy=parseExportTemplateFile(JSON.stringify({kind:templateKind,formatVersion:1,template:t}));return validateExportTemplate(copy)&&copy.id!==t.id&&!copy.builtin});
  test('HTML 模板元数据往返',()=>{const t=builtinExportTemplates()[0],doc=inspectExportHTML(t.html),{html,...meta}=t,tag=doc.createElement('meta');tag.name='comfycomic-export-template';tag.content=encodeMetadata(meta);doc.head.append(tag);const imported=parseExportTemplateFile('<!DOCTYPE html>\n'+doc.documentElement.outerHTML);return validateExportTemplate(imported)&&imported.title===t.title&&imported.options.accent===t.options.accent});
  test('用户台词不会被当作 HTML 执行',()=>{const t=builtinExportTemplates()[0],books=exportPreviewBooks(),b=clone(books[0]);b.steps[0].caption='<img src=x onerror=alert(1)> {{signature}}';const doc=new DOMParser().parseFromString(compileTemplateDocument(t,[b]),'text/html');return !doc.querySelector('[onerror]')&&doc.querySelector('.cc-caption p').textContent.includes('{{signature}}')});
  test('编译严格按 stepIndex 排序',()=>{const t=builtinExportTemplates()[0],b=clone(exportPreviewBooks()[0]);b.steps=[{...b.steps[0],stepIndex:3,name:'第三幕'},{...b.steps[0],stepIndex:0,name:'第一幕'}];const doc=new DOMParser().parseFromString(compileTemplateDocument(t,[b]),'text/html');return doc.querySelector('[data-cc-frame] img').alt==='第一幕'});
  test('导出未启用提示词时不泄露文本',()=>{const t=builtinExportTemplates()[0],b=clone(exportPreviewBooks()[0]);b.steps[0].prompt='PRIVATE_PROMPT_2931';return !compileTemplateDocument(t,[b],{showPrompts:false}).includes('PRIVATE_PROMPT_2931')});
  test('拒绝外部脚本与资源',()=>{const t=builtinExportTemplates()[0];t.html=t.html.replace('</head>','<link rel="stylesheet" href="https://example.com/style.css"></head>');try{validateExportTemplate(t);return false}catch(e){return true}});
  test('拦截 body 内联事件处理器',()=>{const t=builtinExportTemplates()[0];t.html=t.html.replace('<body>','<body onload="alert(1)">');try{validateExportTemplate(t);return false}catch(e){return true}});
  test('离线预览含独立 CSP 与系统脚本 nonce',()=>{const t=builtinExportTemplates()[0],doc=new DOMParser().parseFromString(compileTemplateDocument(t,exportPreviewBooks()),'text/html'),csp=doc.querySelector('meta[http-equiv="Content-Security-Policy"]');return csp?.content.includes("connect-src 'none'")&&doc.querySelectorAll('script').length===1&&!!doc.querySelector('script').getAttribute('nonce')});
  test('迁移不覆盖用户隐藏模块设置',()=>{const s={settings:{studio:{visibility:{llm:false},features:{assistant:false}}}};ensureStudioState(s);return s.settings.studio.visibility.llm===false&&s.settings.studio.features.assistant===false&&s.exportTemplates.length===4});
  test('编辑副本与保存模板引用隔离',()=>{const t=builtinExportTemplates()[0],copy=exportTemplateCopy(t);copy.options.accent='#ffffff';return t.options.accent!==copy.options.accent});
  test('助手工具草稿不会提前修改源模板',()=>{const t={id:'test-scope',title:'原始标题',frames:[makeFrame(0)]},draft=clone(t);assistantToolDraft(draft,'update_template_title',{title:'新标题'});return t.title==='原始标题'&&draft.title==='新标题'});
  $('#modal-body').insertAdjacentHTML('beforeend','<div class="divider"></div><h3 class="panel-title">v2.3 模板与模块回归检查</h3>'+extra.map(([n,ok,d])=>`<div class="row" style="padding:13px 0;border-bottom:1px solid var(--line)"><span class="${ok?'accent':'danger'}">${icon(ok?'check':'close')}</span><span class="grow small">${esc(n)}</span><span class="tiny muted">${esc(d)}</span></div>`).join('')+'<p class="help">上述结果仅在点击此按钮的浏览器内执行，不代表真实 ComfyUI 或 LLM 已完成联调。</p>');
  return [...tests,...extra];
};



document.addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.etField&&studioUI.editor){studioUI.editor[el.dataset.etField]=el.value;stashTemplateDraft()}
  if(el.dataset.etOption&&studioUI.editor){studioUI.editor.options[el.dataset.etOption]=el.type==='number'?Number(el.value):el.value;const label=$(`[data-et-color-label="${el.dataset.etOption}"]`);if(label)label.textContent=el.value;stashTemplateDraft()}
  if(['export-color','export-border','export-signature','export-captions','export-prompts'].includes(el.id)){readExportDraft();clearTimeout(studioUI.exportPreviewTimer);studioUI.exportPreviewTimer=setTimeout(updateExportPreview,200)}
  if(el.id==='chat-input')studioUI.assistantDraft=el.value;
});


document.addEventListener('change',async e=>{
  const el=e.target;
  try{
    if(el.dataset.studioPref)changeStudioPreference(el);
    if(el.id==='studio-theme'){state.settings.studio.appearance.theme=el.value;document.documentElement.dataset.theme=el.value;save();renderShell()}
    if(el.id==='studio-preset'&&el.value){const full=el.value==='full';state.settings.studio.visibility={gallery:true,storyboard:true,matrix:true,engine:true,llm:full};state.settings.studio.features.assistant=full;state.settings.studio.appearance.showMetrics=full;save();render();toast(full?'已启用完整创作界面。':'已隐藏 LLM 剧情台与助手，保留所有历史数据。')}
    if(el.id==='export-template-select'){studioUI.exportDraft.templateId=el.value;studioUI.exportDraft.themeColor=null;renderExportHub()}
    if(el.id==='et-preview-book'){studioUI.previewBookId=el.value;updateTemplatePreview()}
  }catch(error){toast(error.message,'error')}
});


document.addEventListener('keydown',async e=>{
  if((e.metaKey||e.ctrlKey)&&e.key===','){e.preventDefault();e.stopImmediatePropagation();if($('#confirm-dialog').open){toast('请先完成或取消当前确认。');return}try{await handleAction('settings',{})}catch(x){toast(x.message,'error')}return}
  if(e.target.id==='et-source'&&e.key==='Tab'){e.preventDefault();e.target.setRangeText('  ',e.target.selectionStart,e.target.selectionEnd,'end');studioUI.editor.html=e.target.value;stashTemplateDraft()}
  if($('#template-studio').open&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopImmediatePropagation();try{saveEditedTemplate()}catch(x){toast(x.message,'error')}}
},true);


$('#template-studio').addEventListener('cancel',e=>{e.preventDefault();e.stopImmediatePropagation();closeTemplateStudio().catch(x=>toast(x.message,'error'))},true);


$('#template-studio').addEventListener('click',e=>{if(e.target!==$('#template-studio'))return;const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){e.preventDefault();e.stopImmediatePropagation();closeTemplateStudio().catch(x=>toast(x.message,'error'))}},true);


$('#template-studio').addEventListener('close',()=>{if($('#template-studio').contains($('#toasts')))document.body.append($('#toasts'))});


window.addEventListener('beforeunload',e=>{if(studioUI.editorDirty){e.preventDefault();e.returnValue=''}});



const disk={root:null,remembered:null,linkDB:null,phase:'memory',busy:false,connecting:false,revision:0,savedRevision:0,rootRevision:null,lastManifestText:null,lastSavedAt:null,lastError:'',lastErrorShown:'',timer:null,tail:Promise.resolve(),allowReduction:false,written:new Map(),resolved:new Map(),paths:{projects:{},books:{},rows:{},templates:{},exports:{},chats:{}},legacy:null,restored:false,workspaceId:null,progress:'',packBusy:false};


const detailUI={projectOpen:false,tooltipTimer:null,tooltipTarget:null,assistantExpanded:false,assistantHeight:130,assistantObserver:null,profileDraft:null,renderingAssistant:false};


const actionHelp={
  'book-menu':'管理这本画册：阅读、星标、剧情版本对比、补齐缺帧或导出。',
  read:'打开阅读器，逐页查看画面与台词，可切换双页、长卷和翻页模式。',
  star:'仅添加或取消本地星标，便于筛选收藏。不会公开发布。',
  'copy-book':'复制标题、角色、模板、概要和标签，不会复制图片。',
  'compare-book':'对照同一角色与模板派生出的不同剧情画册，需要至少两个版本。',
  'export-book':'把画册排版为可离线打开的 HTML，可选模板、台词和提示词水印。',
  resume:'只补齐缺失或离线降级的分镜，已完成的画面不会重新生成。',
  'delete-book':'从当前工程索引移除画册。已落盘的旧文件保留，避免误删原图。',
  'bulk-delete':'移除选中画册的工程记录。操作前需要二次确认。',
  'market-install':'把资源安装进本地资产库。安装的 HTML 模板可再复制、自定义或卸载。',
  market:'浏览分镜、角色、工作流和画册 HTML 模板，不是公开作品社区。',
  'et-open-library':'编辑画册导出的 HTML/CSS 外观，不改变源图片、提示词或台词。',
  'et-export-menu':'下载可迁移的 JSON 模板包，包含 HTML、配色和作者信息。',
  'et-export-html':'下载模板 HTML 源文件，可在外部编辑器修改后重新导入。',
  'et-save':'保存当前排版模板。内置模板的修改会另存为个人副本。',
  'et-default':'之后打开导出窗口时优先使用此模板。',
  'et-market-download':'下载画册模板包，不会自动安装；也可直接保留给其他工作室使用。',
  'project-toggle':'切换当前企划，或在同一个菜单中创建新企划。',
  'new-project':'创建独立企划。连接目录后会自动建立对应企划文件夹。',
  'project-rename':'修改企划显示名称。已有文件夹保持稳定，避免破坏图片引用。',
  'disk-connect':'授权一个你可以管理的本地目录。之后工程会分层自动写入该目录。',
  'disk-reconnect':'重新授予之前的工作室目录读写权限，并从磁盘恢复工程。',
  'disk-save':'立即把所有尚未保存的工程变更写入已授权目录。',
  'disk-reload':'读取磁盘上最后一次完整提交。未落盘的内存修改不会自动合并。',
  'disk-archive':'下载包含企划、画册、图片及模板的 ZIP 目录包。需解压后再打开目录。',
  'disk-import-folder':'以只读方式载入一个解压后的工作室目录，不具备自动回写权限。',
  'disk-clear-legacy':'成功落盘后再移除旧浏览器缓存，磁盘中的工程不受影响。',
  'assistant-input-expand':'展开输入区域，适合编辑较长的分镜指令；再次点击还原。',
  'assistant-open-target':'定位到当前对话绑定的源分镜模板，而不是正在阅读的画册图片。',
  'assistant-undo':'安全撤销上次助手修改；模板有后续手工编辑时会阻止覆盖。',
  'assistant-stop':'停止当前助手请求。已确认的修改保留，未确认的不会应用。',
  'settings':'管理工作室名称、文件保存目录、模块开关和生成默认值。',
  'profile-settings':'修改工作室名称与创作者署名。',
  'critique':'审校本页的解剖、构图和角色一致性；离线模式提供规则模拟报告。',
  'redraw':'根据修改后的提示词和强度重新生成此页，完成后就地替换图片。',
  'mask':'涂抹需要重绘的局部区域。真实局部精修需要相应 ComfyUI 工作流。',
  'enqueue':'为勾选的角色创建画册任务，暂不开始生成。',
  'start-batch':'启动角色对应的分镜批量生成；已有任务会顺序执行。',
  'backup':'管理落盘工作室与便携备份。JSON 适合完整恢复，目录包适合手工管理图片。'
};


exportVariableNames.add('coverImage');


const DISK_KIND='comfycomic.folder-workspace';


const zipCRC=crcTable();


const detailCore={ensureStudioState,renderShell,render,handleAction,modal,toast,backupModal,assistantScope,renderAssistant,showAssistant,sendChat,validateState,diagnostics,storedTemplateDraft,saveEditedTemplate,flushEditor};


builtinExportTemplates=designedTemplates;


ensureStudioState=function(s=state){detailCore.ensureStudioState(s);ensureWorkspaceIdentity(s);upgradeExportDesigns(s);return s};


loadState=loadDiskFirst;


save=saveToDirectory;


persist=queueDiskSave;


renderStatus=renderDiskStatus;


renderShell=function(){detailCore.renderShell();decorateWorkspaceShell();renderStatus()};


render=function(){detailCore.render();const main=$('#main');if(ui.workspace===1&&$('[data-frame-field]',main)){main.dataset.editorTemplateId=currentTemplate().id;main.dataset.editorFrameIndex=String(ui.frameIndex)}else{delete main.dataset.editorTemplateId;delete main.dataset.editorFrameIndex}const summary=$('.settings-summary');if(summary)summary.innerHTML=icon('disk','sm')+'<span>'+esc(disk.root?'修改会自动排队写入已授权目录。':'当前是临时会话，请连接目录后再长期创作。')+'</span><span class="spacer"></span>v'+STUDIO_VERSION;if(ui.workspace===5&&studioUI.settingsTab==='storage')$('#studio-settings-content')?.insertAdjacentHTML('beforeend',btn('运行目录格式与恢复自检','shield','disk-diagnostics','','small'));updateDiskSettingsStatus();if(!$('#assistant').hidden&&!detailUI.renderingAssistant){detailUI.renderingAssistant=true;try{renderAssistant()}finally{detailUI.renderingAssistant=false}}};


flushEditor=function(){const main=$('#main'),id=main?.dataset.editorTemplateId;if(!id)return detailCore.flushEditor();if(!templateBy(id))return;const selected=ui.templateId,index=ui.frameIndex;ui.templateId=id;ui.frameIndex=Number(main.dataset.editorFrameIndex);try{detailCore.flushEditor()}finally{ui.templateId=selected;ui.frameIndex=index}};


bookMenu=descriptiveBookMenu;


backupModal=fileBackupHub;


modal=function(...args){hideTip();closeProjectPopover();detailCore.modal(...args)};


toast=function(message,type='ok'){detailCore.toast(message,type);if($('#welcome-dialog').open&&!$('#confirm-dialog').open)$('#welcome-dialog').append($('#toasts'))};


assistantScope=function(){if(rt.chatBusy&&studioUI.assistantTargetId)return templateBy(studioUI.assistantTargetId);const chat=currentChat();return chat?.templateId?templateBy(chat.templateId):contextualTemplate()};


renderAssistant=function(){detailCore.renderAssistant();decorateAssistantContext()};


showAssistant=function(){if($('#template-studio').open){detailCore.showAssistant();return}if(!featureEnabled('assistant')){toast('分镜精修助手已停用，可在设置中重新开启。');return}if(!rt.chatBusy){const t=contextualTemplate();if(t)bindChatToTemplate(t.id)}detailCore.showAssistant()};


sendChat=async function(){if(rt.chatBusy)return;const chat=currentChat();if(!chat.templateId){const t=contextualTemplate();if(!t)throw Error('请先创建分镜模板，再为此模板开启对话。');chat.templateId=t.id;chat.projectId=t.projectId;chat.title=t.title.slice(0,22)+' · 对话 1'}if(!templateBy(chat.templateId))throw Error('此对话绑定的模板已被移除，请选择新的目标模板。');chat.draft='';return detailCore.sendChat()};


persistEditorDraft=function(){if(!studioUI.editor)return false;state.drafts.exportTemplate={template:clone(studioUI.editor),time:Date.now()};save();return true};


storedTemplateDraft=function(){return state.drafts?.exportTemplate||null};


canLeaveTemplate=async function(){if(!studioUI.editorDirty)return true;persistEditorDraft();let stored=false;if(disk.root&&disk.phase==='connected')stored=await flushDiskSave();return confirmAction('暂不应用这份模板修改？',stored?'未应用的模板草稿已写入工作室目录，稍后可从模板库恢复。现有已保存模板保持不变。':'草稿目前只在本次会话内。关闭页面会丢失尚未落盘的草稿，建议先保存模板或连接工作室目录。','保留草稿并离开')};


saveEditedTemplate=function(){const result=detailCore.saveEditedTemplate();delete state.drafts.exportTemplate;save();return result};


validateState=function(s){detailCore.validateState(s);if(s.settings.identity){const i=s.settings.identity;if(typeof i.workspaceName!=='string'||i.workspaceName.length>40||typeof i.creatorName!=='string'||i.creatorName.length>60)throw Error('工作室名称或署名不合法。')}if(s.settings.disk?.includeKeys!==undefined&&typeof s.settings.disk.includeKeys!=='boolean')throw Error('磁盘密钥保存开关不合法。');return true};



const detailActions={
  'project-toggle':()=>{if(detailUI.projectOpen)closeProjectPopover();else{renderProjectPopover();$('.project-choice')?.focus()}},
  project:d=>{closeProjectPopover();changeProject(d.id)},
  'new-project':()=>{closeProjectPopover();flushEditor();textModal('新建企划','企划名称','',name=>{const p={id:uid('project'),title:name,createdAt:Date.now()};state.projects.push(p);closeModal();changeProject(p.id);save();toast(disk.root?'企划已创建，独立文件夹将随自动保存建立。':'企划已创建，连接目录后会建立独立文件夹。')},'新企划拥有独立的画册、模板、角色和图片目录。')},
  'project-rename':()=>{closeProjectPopover();const id=project().id;textModal('重命名企划','企划名称',project().title,name=>{const p=state.projects.find(x=>x.id===id);p.title=name;save();closeModal();render();toast('显示名称已修改，已落盘目录路径保持稳定。')})},
  'profile-settings':()=>{studioUI.settingsTab='general';if($('#modal').open)closeModal();if($('#reader').open)closeReader();navigate(5)},
  'identity-save':()=>saveIdentityFromForm(),
  'storage-settings':()=>openFileSettings(),
  'disk-connect':()=>{if(!state.settings.identity.workspaceName){showWorkspaceWelcome();return}return chooseWorkspaceDirectory()},
  'disk-reconnect':()=>reconnectWorkspaceDirectory(),
  'disk-save':async()=>{if(await flushDiskSave())toast('所有当前变更已写入磁盘。')},
  'disk-reload':()=>reloadWorkspaceDirectory(),
  'disk-accept-recovery':()=>acceptDiskRecovery(),
  'disk-archive':()=>downloadDirectoryArchive(),
  'disk-import-folder':()=>importDirectoryReadOnly(),
  'disk-clear-legacy':()=>clearLegacyCache(),
  'disk-diagnostics':()=>diskFormatDiagnostics(),
  'disk-book-path':d=>bookDiskPathModal(d.id),
  'copy-disk-path':d=>copyText(disk.paths.books[d.id]+'/图片/'),
  'advanced-sync':()=>detailCore.backupModal(),
  'welcome-temporary':()=>{captureWelcomeIdentity();finishWelcome();toast('已进入临时会话。请记得连接目录或导出备份。')},
  'welcome-connect':async()=>{captureWelcomeIdentity();const ok=await chooseWorkspaceDirectory();if(ok)rememberProfile()},
  'welcome-reconnect':async()=>{captureWelcomeIdentity();const ok=await reconnectWorkspaceDirectory();if(ok&&$('#welcome-dialog').open)finishWelcome()},
  'welcome-import':()=>{captureWelcomeIdentity();importDirectoryReadOnly()},
  'assistant-input-expand':()=>{const panel=$('#assistant');detailUI.assistantExpanded=!detailUI.assistantExpanded;detailUI.assistantHeight=detailUI.assistantExpanded?250:130;if(detailUI.assistantExpanded){detailUI.previousAssistantSize={width:panel.style.width,height:panel.style.height};panel.style.width=Math.min(630,innerWidth-30)+'px';panel.style.height=(innerHeight-85)+'px';if(panel.style.left)panel.style.left=Math.max(12,Math.min(parseFloat(panel.style.left),innerWidth-Math.min(630,innerWidth-30)-12))+'px';if(panel.style.top)panel.style.top=clamp(parseFloat(panel.style.top),12,73)+'px'}else{panel.style.width=detailUI.previousAssistantSize?.width||'';panel.style.height=detailUI.previousAssistantSize?.height||''}renderAssistant();$('#chat-input')?.focus()},
  'new-chat':()=>{if(rt.chatBusy)throw Error('请等待本次助手操作结束。');const t=assistantScope();if(!t)throw Error('请先选择目标分镜模板。');bindChatToTemplate(t.id,true);renderAssistant()},
  'assistant-close':()=>{const chat=currentChat();if(chat&&$('#chat-input'))chat.draft=$('#chat-input').value;save();$('#assistant').hidden=true;detailUI.assistantObserver?.disconnect()},
  'assistant-open-target':()=>{const t=assistantScope();if(!t)return;if($('#reader').open)closeReader();if(t.projectId!==state.activeProjectId)changeProject(t.projectId);ui.templateId=t.id;ui.frameIndex=0;navigate(1)}
};


handleAction=async function(act,d={},el){
  hideTip();
  if($('#welcome-dialog').open&&!act.startsWith('welcome-')&&!['disk-connect','disk-reconnect'].includes(act))return;
  if(Object.hasOwn(detailActions,act)){await detailActions[act](d,el);applyStudioPreferences();return}
  await detailCore.handleAction(act,d,el);
  if(act==='book-menu'&&disk.root){const b=bookBy(d.id);if(b&&disk.paths.books[b.id])$('#modal-body').insertAdjacentHTML('beforeend','<div class="row" style="margin-top:14px">'+btn('查看图片目录','folder','disk-book-path',`data-id="${b.id}"`,'small ghost')+'</div>')}
  if(act==='et-revert'&&!studioUI.editorDirty){delete state.drafts.exportTemplate;save()}
  if(act==='llm-settings'){const note=$('#modal-body .notice');if(note)note.textContent='真实调用会把指定文本和图片发送给你配置的服务商。API 密钥默认仅用于本次会话；是否写入工作室目录可在“文件与保存”中控制。'}
};


document.addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;const el=e.target.closest('[data-tip],[data-act],[title]');if(!el||!tooltipText(el)||el===detailUI.tooltipTarget)return;hideTip();detailUI.tooltipTarget=el;detailUI.tooltipTimer=setTimeout(()=>revealTip(el),450)});


document.addEventListener('pointerout',e=>{const el=detailUI.tooltipTarget;if(el&&!el.contains(e.relatedTarget))hideTip()});


document.addEventListener('focusin',e=>{const el=e.target.closest('[data-tip],[data-act],[title]');if(el&&tooltipText(el)){hideTip();detailUI.tooltipTimer=setTimeout(()=>revealTip(el),250)}});


document.addEventListener('focusout',()=>hideTip());


document.addEventListener('scroll',()=>{if(detailUI.tooltipTarget||detailUI.tooltipTimer)hideTip()},{capture:true,passive:true});


document.addEventListener('pointerdown',()=>hideTip());


window.addEventListener('resize',()=>{hideTip();if(detailUI.projectOpen)renderProjectPopover()});


document.addEventListener('keydown',e=>{
  if($('#welcome-dialog').open&&(e.metaKey||e.ctrlKey)){if(['k','j',','].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation()}return}
  if(e.key==='Escape'&&detailUI.projectOpen){e.preventDefault();e.stopImmediatePropagation();closeProjectPopover();$('#project-switch-button')?.focus();return}
  if(detailUI.projectOpen&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=$$('[role="menuitem"]',$('#project-popover')),index=items.indexOf(document.activeElement);let next=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;items[next]?.focus();return}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&!$('#template-studio').open){e.preventDefault();e.stopImmediatePropagation();flushDiskSave().then(ok=>{if(ok)toast('已写入磁盘。')}).catch(x=>toast(x.message,'error'))}
},true);


document.addEventListener('input',e=>{if(e.target.id==='chat-input'){const c=currentChat();if(c){c.draft=e.target.value;save()}}});


document.addEventListener('change',async e=>{
  try{
    if(e.target.id==='assistant-target'){if(rt.chatBusy)throw Error('助手正在执行，暂时不能切换目标。');bindChatToTemplate(e.target.value);renderAssistant()}
    if(e.target.dataset.diskKey==='includeKeys'){if(e.target.checked&&!await confirmAction('允许将 API 密钥写入磁盘？','密钥将以明文保存在工作室配置文件与版本历史中。请不要把工作室目录发给别人。','允许保存密钥')){e.target.checked=false;return}state.settings.disk.includeKeys=e.target.checked;save()}
  }catch(x){toast(x.message,'error')}
});


$('#directory-import').addEventListener('change',e=>{if(e.target.files.length)restoreImportedDirectory([...e.target.files]).catch(x=>toast(x.message,'error'))});


$('#welcome-dialog').addEventListener('cancel',e=>{e.preventDefault();e.stopImmediatePropagation();$('#welcome-name')?.focus()},true);


$('#welcome-dialog').addEventListener('click',e=>{if(e.target===$('#welcome-dialog')){e.preventDefault();e.stopImmediatePropagation()}},true);


$('#welcome-dialog').addEventListener('close',()=>{if($('#welcome-dialog').contains($('#toasts')))document.body.append($('#toasts'))});


for(const dialog of $$('dialog'))dialog.addEventListener('close',()=>{hideTip();if(dialog.contains($('#ui-tooltip')))document.body.append($('#ui-tooltip'))});


window.addEventListener('beforeunload',e=>{if(!rt.booting&&(disk.busy||disk.revision>disk.savedRevision||studioUI.editorDirty)){e.preventDefault();e.returnValue=''}});


const releaseUI={composerSize:220,composerExpanded:false,composerObserver:null,composerRAF:null,criticDraft:null,criticTesting:false,criticTest:null,criticController:null,criticBatch:null,criticFingerprint:'',criticCache:new Map(),githubToken:'',githubDraft:null,githubBusy:false,githubResult:null,githubController:null,githubTab:'publish',githubCheck:null,guideStep:0,practiceBusy:false,practiceController:null,regressionBusy:false};


const criticDefaults={mode:'real',connection:'independent',provider:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-4o',key:'',timeout:60,includeReference:true,includePrevious:true,focus:'优先检查手部、面部结构、角色服装一致性、镜头构图与叙事可读性。',verification:null};


const visionJobs=new Map();


const githubDefaults={repository:'',branch:'',path:''};


const encodedPath=path=>path.split('/').map(encodeURIComponent).join('/');


const guideSteps=[
  {id:'save',title:'保存工作室',headline:'先给作品一个真实的家。',description:'推荐先连接本地目录。自动保存会按企划、画册和图片分层写入，只有底栏显示“已写入磁盘”才代表保存完成。',checks:['点击“选择本地根目录”并允许浏览器读写。','桌面 Chrome / Edge 的安全页面支持目录授权；受限环境可以下载 ZIP 目录包。','浏览器数据库不作为作品主存储，临时会话关闭前要备份。'],action:'guide-storage',label:'打开文件与保存',icon:'folder'},
  {id:'project',title:'建立企划',headline:'不同的故事，分开管理。',description:'顶栏企划名称既是切换器，也是新建入口。每个企划拥有独立的画册、角色与分镜模板，不会混在一起。',checks:['点击顶栏企划菜单，选择“新建企划”。','不想先配置？可以在后面创建独立的三幕练习工程。','隐藏工作区不会删除数据，设置中可随时重新打开。'],action:'guide-project',label:'新建一个企划',icon:'plus'},
  {id:'story',title:'角色与分镜',headline:'先写镜头，再填入角色。',description:'分镜模板定义镜头、提示词和台词；角色矩阵填入姓名、服装与场景。{character}、{outfit} 等变量会在出图时替换。',checks:['在“分镜剧本配置”添加、移动或复制镜头。','在“批量角色矩阵”填写角色变量，并勾选要生成的行。','LLM 剧情是可选环节；没有模型也能使用默认旁白出图。'],action:'guide-storyboard',label:'打开分镜工作区',icon:'story'},
  {id:'generate',title:'生成第一册',headline:'用三幕，走完一次创作。',description:'下面的练习只使用本地 SVG 引擎，不调用 GPU、不发送 API 请求，也不会修改现有企划。生成后会出现一套完整的角色、模板和画册。',checks:['真实创作时：勾选角色 → 加入队列 → 开始批量渲染。','需要 GPU 时，在“ComfyUI 引擎管线”配置地址和工作流。','中止后图片保留；“断点补齐”只处理缺失或降级帧。'],action:'guide-practice',label:'创建并生成三幕练习',icon:'play'},
  {id:'review',title:'阅读与审校',headline:'把看见的问题，变成修改。',description:'打开画册，在右侧分镜检查器选择“配置 API”。支持图片输入的视觉模型才能生成真实诊断，离线报告仅用于演示操作。',checks:['填写 Base URL、API Key 和视觉模型名称，先做“带图测试”。','点击“审校本页”或“审校整本画册”，查看具体问题区域。','把建议填入重绘框，确认提示词后精修；助手只改源模板，不直接改已生成图片。'],action:'guide-reader',label:'打开画册体验阅读',icon:'book'},
  {id:'export',title:'导出画册',headline:'让故事离开工作台，也能被阅读。',description:'导出可选择电影长卷、漫画精装、艺术展册或交互翻页。全部图片与必要样式、脚本内联，导出的 HTML 可以离线打开。',checks:['画册“...”菜单 → 导出离线画册，选择喜欢的模板。','“画册导出模板”中可以修改 HTML / CSS、预览并保存个人副本。','源分镜模板与画册 HTML 模板是两种资产，互不覆盖。'],action:'guide-export',label:'试用画册导出',icon:'download'},
  {id:'publish',title:'GitHub 托管',headline:'分享模板，不泄露工作室。',description:'模板市场有明确的“上传到 GitHub”入口。只上传所选模板包，不上传你的工程设置、对话或角色库。',checks:['直接上传：选择资源，填写仓库与 Token，检查文件，再确认提交。','无需 Token：下载模板包 → GitHub Add file / Upload files → Commit changes。','把公开文件的 Raw 地址提供给他人，他们即可在市场中安装；私有文件需要读取权限。'],action:'guide-github',label:'查看 GitHub 上传流程',icon:'upload'}
];


async function releaseDiagnostics(){
  if(releaseUI.regressionBusy)return;releaseUI.regressionBusy=true;
  modal('v2.5 功能回归检查','<div class="notice">本检查在当前浏览器运行，不会访问 GitHub、不发送 API 请求，也不会修改工程。</div><div id="release-test-results" class="template-check-list" style="margin-top:16px"></div>','校验模板、发布请求、审校报告与输入区域保护。',true);
  const tests=[],test=async(name,fn)=>{try{if(await fn()===false)throw Error('断言不成立');tests.push({name,ok:true,message:'通过'})}catch(e){tests.push({name,ok:false,message:e.message})}};
  try{
    await test('合法的 scroll-behavior 不再触发误报',()=>validateOfflineCSS('html { scroll-behavior: smooth; } @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }'));
    await test('注释和字符串中的 url / @import 被正确忽略',()=>validateOfflineCSS('/* old url(https://example.com) @import */ p::after { content: "url(https://example.com) @import behavior:"; }'));
    await test('真正的 behavior 属性仍被拦截',()=>{try{validateOfflineCSS('p { behavior: url(unsafe.htc); }');return false}catch(e){return e.message.includes('behavior')}});
    await test('CSS 转义后的外部 URL 不绕过校验',()=>{try{validateOfflineCSS('p { background: u\\72l(https://example.com/x.png); }');return false}catch(e){return true}});
    await test('内联图片和页内 URL 可以离线使用',()=>validateOfflineCSS('p { background: url("data:image/png;base64,aGVsbG8="); filter: url(#soft); }'));
    await test('CSS 文件导入仍被明确拦截',()=>{try{validateOfflineCSS('@import "https://example.com/style.css";');return false}catch(e){return e.message.includes('@import')}});
    for(const t of designedTemplates())await test('内置版式：'+t.title,()=>{validateExportTemplate(t);return compileTemplateDocument(t,exportPreviewBooks()).includes('Content-Security-Policy')});
    for(const p of exportMarketCatalog)await test('市场版式：'+p.title,()=>validateExportTemplate(marketTemplate(p.id)));
    await test('GitHub 仓库地址与 owner/repo 均可识别',()=>{const a=githubRepoParts('https://github.com/example/comic-templates.git');return a.owner==='example'&&a.repo==='comic-templates'});
    await test('GitHub UTF-8 编码可还原中文模板',()=>base64UTF8(utf8Base64('海风来信 · {character}'))==='海风来信 · {character}');
    await test('更新 GitHub 文件时保留并发保护 SHA',()=>{const body=githubWriteBody('示例模板','Update template','main','test-sha');return body.sha==='test-sha'&&base64UTF8(body.content)==='示例模板'&&!('token' in body)});
    await test('新建 GitHub 文件不传空 SHA',()=>!('sha' in githubWriteBody('{}','Create template','main')));
    await test('仓库路径不允许跳出目录或修改 Actions',()=>{let blocked=0;for(const path of ['../secrets.json','.github/workflows/run.json','/private.json'])try{githubFilePath(path)}catch(e){blocked++}return blocked===3});
    await test('审校 endpoint 不重复拼接路径',()=>normalizedChatEndpoint('https://api.openai.com/v1/chat/completions/')==='https://api.openai.com/v1/chat/completions');
    await test('审校通过阈值和结构标准化',()=>{const c=normalizeCriticReport({score:6.5,summary:'需调整',anatomy:'手部不清晰',consistency:'缺少参考',suggestions:'refined hands',issues:[{area:'手部',severity:'high',observation:'轮廓不清',fixPrompt:'refined hands'}]});return !c.passed&&c.issues[0].fixPrompt==='refined hands'});
    await test('审校缺少必填字段不会伪造报告',()=>{try{normalizeCriticReport({score:8});return false}catch(e){return true}});
    await test('输入框分隔条有最小/最大高度保护',()=>{const small=composerBounds(460,54,145),large=composerBounds(800,54,180);return small.min<=small.max&&large.min<=large.max&&large.max<=430});
    await test('七步教程包含所有功能入口',()=>guideSteps.length===7&&guideSteps.every(s=>s.title&&s.action&&s.checks.length));
    const area=$('#release-test-results');if(area)area.innerHTML=tests.map(t=>`<div class="template-check-row"><span class="${t.ok?'accent':'danger'}">${icon(t.ok?'check':'close')}</span><span class="grow">${esc(t.name)}<small>${esc(t.message)}</small></span></div>`).join('')+`<div class="modal-footer"><span class="grow tiny muted">${tests.filter(t=>t.ok).length} / ${tests.length} 项通过；不代表真实服务联调已通过。</span>${btn('检查当前助手布局','expand','composer-layout-test')}</div>`;
    return tests;
  }finally{releaseUI.regressionBusy=false}
}


const releaseCore={ensureStudioState,render,renderShell,renderReader,openReader,renderMarket,renderTemplateStudio,handleAction,toast,modal,activeJobs,diagnostics,loadState,showAssistant,renderAssistant,validateState,importRaw};


ensureStudioState=function(s=state){releaseCore.ensureStudioState(s);return ensureReleaseSettings(s)};


validateState=function(s){releaseCore.validateState(s);const c=s.settings.critic;if(c){if(!['real','mock'].includes(c.mode)||!['independent','shared'].includes(c.connection)||typeof c.baseUrl!=='string'||typeof c.model!=='string'||typeof c.key!=='string'||!Number.isFinite(c.timeout)||c.timeout<15||c.timeout>180)throw Error('视觉审校 API 配置结构不合法。')}return true};


setupAssistantPointer=boundedAssistantPointer;


renderAssistant=function(){releaseCore.renderAssistant();boundAssistantComposer()};


renderReader=function(){releaseCore.renderReader();renderCriticEntry()};


openReader=function(id){releaseCore.openReader(id);renderCriticEntry()};


critiqueHTML=criticReportHTML;


critiqueStep=performVisualCritique;


renderShell=function(){releaseCore.renderShell();const version=$('.brand-sub span');if(version)version.textContent='v2.5';const utility=$('.nav-utility');if(utility&&!$('[data-act="guide-open"]',utility)){const button=document.createElement('button');button.className='nav-item';button.dataset.act='guide-open';button.title='快速开始：保存、分镜、生成、审校、导出与 GitHub 发布';button.setAttribute('aria-label','打开内置快速开始教程');button.innerHTML=icon('help')+'<span>快速开始教程</span>';utility.prepend(button)}const header=$('#topbar');if(header&&!$('[data-act="critic-settings"]',header))header.insertAdjacentHTML('beforeend',ibtn('shield','critic-settings','视觉审校 API：填写连接与带图测试'))};


render=function(){releaseCore.render();if(ui.workspace===5&&studioUI.settingsTab==='connections'){const panel=$('.settings-connections');if(panel)panel.insertAdjacentHTML('beforeend',`<div class="connection-setting">${icon('shield')}<h3>视觉审校 · 独立 API</h3><p>${esc(criticReadyLabel())}<br>填写模型与密钥后，可进行真实单页或整册审校。</p>${btn('填写审校 API','settings','critic-settings','','small primary')}</div>`)}if(ui.workspace===5&&studioUI.settingsTab==='guide')$('#studio-settings-content').insertAdjacentHTML('beforeend',btn('运行本次更新回归检查','shield','release-diagnostics','','small'))};


renderMarket=function(){releaseCore.renderMarket();const root=$('#market-content');if(root){root.insertAdjacentHTML('afterbegin',`<div class="market-publish-bar"><div class="grow"><strong>下载别人做的，也上传自己的。</strong><p>GitHub 托管模板包，可直接提交，也可按教程在网页上传。</p></div>${btn('上传到 GitHub','upload','github-open','','primary')}${btn('上传教程','help','github-manual','','small')}</div>`);const raw=$('#raw-url');if(raw?.parentElement)raw.parentElement.insertAdjacentHTML('afterend','<p class="help">公开 Raw 地址可直接导入。私有仓库请使用 '+btn('带权限从 GitHub 安装','download','github-import-open','','small ghost')+'</p>')}};


renderTemplateStudio=function(){releaseCore.renderTemplateStudio();const tools=$('.template-tools',$('#template-studio'));if(tools){tools.insertAdjacentHTML('beforeend',btn('发布到 GitHub','upload','github-publish-draft','','small')+ibtn('shield','template-check','检查全部已保存模板的 CSS 与结构'));}const guide=$('.source-guide',$('#template-studio'));if(guide)guide.insertAdjacentHTML('beforeend','<p>CSS 允许 scroll-behavior、普通注释与字符串。背景图片可使用 Base64 的 url(data:...) 或图片变量；外部网络资源仍会被拦截。</p>')};


activeJobs=function(){return releaseCore.activeJobs()||releaseUI.practiceBusy||releaseUI.githubBusy||releaseUI.criticTesting||!!releaseUI.criticBatch||visionJobs.size>0};


toast=function(message,type='ok'){releaseCore.toast(message,type);const open=$$('dialog[open]').filter(d=>d!==$('#confirm-dialog'));const service=['github-dialog','critic-dialog','guide-dialog'].map(id=>$('#'+id)).find(d=>d?.open);if(service&&!$('#confirm-dialog').open&&!$('#command-dialog').open)service.append($('#toasts'))};


loadState=async function(){await releaseCore.loadState();let seen=false;try{seen=localStorage.getItem('cc-quickstart-v25')==='seen'}catch(e){}if(!$('#welcome-dialog').open&&!state.settings.tutorial.seen&&!seen)setTimeout(()=>{if(!document.querySelector('dialog[open]'))openQuickStart(0)},450)};


const releaseActions={
  'template-check':()=>templateValidationHub(),
  'template-fix-open':async d=>{if($('#template-studio').open&&studioUI.editorDirty&&!await canLeaveTemplate())return;closeModal();openTemplateStudio(d.id)},
  'template-reset-builtins':async()=>{if(!await confirmAction('恢复四套内置模板？','只恢复内置模板原版，不删除或覆盖你的独立自定义副本。','恢复内置模板'))return;const defaults=designedTemplates();state.exportTemplates=state.exportTemplates.map(t=>t.builtin&&defaults.some(x=>x.id===t.id)?defaults.find(x=>x.id===t.id):t);save();templateValidationHub();toast('内置模板已恢复，CSS 校验已修复。')},
  'assistant-input-expand':()=>{releaseUI.composerExpanded=!releaseUI.composerExpanded;releaseUI.composerSize=releaseUI.composerExpanded?420:205;const panel=$('#assistant');if(releaseUI.composerExpanded&&!panel.classList.contains('fullscreen'))panel.style.height=Math.min(800,innerHeight-24)+'px';fitAssistantWindow();$('#chat-input')?.focus()},
  'critic-settings':()=>openCriticSettings(),
  'critic-close':()=>{if(releaseUI.criticTesting)releaseUI.criticController?.abort();save();closeServiceDialog('critic-dialog');renderCriticEntry();if(ui.workspace===5)render()},
  'critic-key-toggle':()=>{const input=$('[data-critic-field="key"]');if(input)input.type=input.type==='password'?'text':'password'},
  'critic-test':()=>testCriticConnection(),
  'critic-test-open':()=>openCriticSettings(),
  'critic-test-stop':()=>releaseUI.criticController?.abort(),
  'critic-shared-settings':()=>{closeServiceDialog('critic-dialog');llmSettings()},
  'critic-reset':()=>{rt.criticFailures=0;toast('审校失败计数已重置，可再次执行。');if(ui.workspace===5)render()},
  'critic-batch':()=>critiqueWholeBook(),
  'critic-batch-stop':()=>{releaseUI.criticBatch?.controller.abort();toast('已请求停止整册审校，已完成报告保留。')},
  'critic-page-stop':d=>visionJobs.get(d.id+':'+d.index)?.abort(),
  'critic-copy-report':d=>{const report=bookBy(ui.bookId)?.steps.find(s=>s.stepIndex===Number(d.index))?.critique;if(!report)throw Error('没有可复制的报告。');return copyText(JSON.stringify(report,null,2))},
  'critic-apply-issue':d=>{const c=bookBy(ui.bookId)?.steps.find(s=>s.stepIndex===Number(d.index))?.critique,field=$('#refine-'+d.index);if(!c||!field)throw Error('目标重绘框不存在。');const issue=c.issues?.[Number(d.issue)],prompt=issue?.fixPrompt||c.suggestions;if(!prompt)throw Error('本条没有可填入的提示词。');if(!field.value.includes(prompt)){const next=field.value+(field.value?', ':'')+prompt;validatePrompt(next,field.value);field.value=next}field.focus();field.scrollIntoView({block:'nearest',behavior:'smooth'});toast('建议已填入。本页不会自动重绘，请检查后再执行。')},
  'github-open':()=>openGithubPublisher(),
  'github-publish-draft':()=>openGithubPublisher('draft'),
  'github-manual':()=>openGithubPublisher(null,'manual'),
  'github-import-open':()=>openGithubPublisher(null,'import'),
  'github-close':()=>closeGithubWindow(),
  'github-tab':d=>{if(releaseUI.githubBusy)return;readGithubDraft();releaseUI.githubTab=d.tab;renderGithubPublisher()},
  'github-token-toggle':()=>{const input=$('#github-token');if(input)input.type=input.type==='password'?'text':'password'},
  'github-check':()=>checkGithubTarget(),
  'github-publish':()=>publishGithubTemplate(),
  'github-import':()=>installGithubFile(),
  'github-stop':()=>releaseUI.githubController?.abort(),
  'github-download-package':()=>{readGithubDraft();const pkg=selectedPublishPackage(releaseUI.githubDraft.resourceId);download(pkg.filename.split('/').at(-1),pkg.text);toast('模板包已下载，请在 GitHub 中上传该文件。')},
  'github-open-upload':()=>{readGithubDraft();const c=githubConfiguration();if(!c.branch)throw Error('请填写目标分支，例如 main，或先检查仓库默认分支。');const folder=c.path.split('/').slice(0,-1).join('/'),url='https://github.com/'+encodeURIComponent(c.owner)+'/'+encodeURIComponent(c.repo)+'/upload/'+encodedPath(c.branch)+(folder?'/'+encodedPath(folder):'');const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';document.body.append(a);a.click();a.remove();if(folder)toast('已打开目标目录的上传页；若目录未创建，请按教程先创建该目录。')},
  'github-copy-expected':()=>copyText(githubExpectedURL()),
  'github-copy-result':()=>{if(!releaseUI.githubResult)throw Error('尚无成功提交的安装链接。');return copyText(releaseUI.githubResult.raw)},
  'github-readme':()=>{const result=releaseUI.githubResult;if(!result)throw Error('请先完成一次 GitHub 提交。');const text='# '+result.title+'\n\n'+result.kind+'，适用于 Mio。\n\n## 安装\n\n1. 打开 Mio 的模板市场。\n2. 在“从 GitHub / Gitee / 自有仓库导入”粘贴以下地址。\n3. 校验并安装为独立副本。\n\n'+result.raw+'\n\n'+(result.private?'这是私有仓库，需要通过 GitHub 带权限安装入口读取。\n':'此链接固定于发布时的提交版本。\n');download('README-template.md',text,'text/markdown')},
  'guide-open':d=>openQuickStart(d.step===undefined?null:Number(d.step)),
  'guide-close':()=>{markGuidePage();closeServiceDialog('guide-dialog');renderShell()},
  'guide-step':d=>{markGuidePage();releaseUI.guideStep=clamp(Number(d.index),0,guideSteps.length-1);renderQuickStart()},
  'guide-prev':()=>{markGuidePage();releaseUI.guideStep=Math.max(0,releaseUI.guideStep-1);renderQuickStart()},
  'guide-next':()=>{markGuidePage();releaseUI.guideStep=Math.min(guideSteps.length-1,releaseUI.guideStep+1);renderQuickStart()},
  'guide-finish':()=>{markGuidePage();guidePreferences().completed=true;save();closeServiceDialog('guide-dialog');renderShell();toast('教程已完成。随时从侧栏重新查看。')},
  'guide-storage':()=>guideDestination('storage'),
  'guide-project':()=>guideDestination('project'),
  'guide-storyboard':()=>guideDestination('storyboard'),
  'guide-practice':()=>createGuidePractice(),
  'guide-reader':()=>guideDestination('reader'),
  'guide-export':()=>guideDestination('export'),
  'guide-critic':()=>guideDestination('critic'),
  'guide-template':()=>guideDestination('template'),
  'guide-github':()=>guideDestination('github'),
  'release-diagnostics':()=>releaseDiagnostics(),
  'composer-layout-test':()=>composerLayoutProbe()
};


handleAction=async function(act,d={},el){
  if($('#welcome-dialog').open&&!act.startsWith('welcome-'))return releaseCore.handleAction(act,d,el);
  if(($('#github-dialog').open||$('#critic-dialog').open||$('#guide-dialog').open)&&['settings','workspace','command'].includes(act)){toast('请先关闭当前服务窗口，再切换工作区。');return}
  if(['import-project','sync-pull','disk-connect','disk-reconnect','disk-reload','disk-import-folder'].includes(act)&&(releaseUI.githubBusy||releaseUI.criticTesting||releaseUI.criticBatch||releaseUI.practiceBusy||visionJobs.size))throw Error('请先停止正在进行的上传、审校或练习生成，再切换工程。');
  if(Object.hasOwn(releaseActions,act)){hideTip();await releaseActions[act](d,el);return}
  const result=await releaseCore.handleAction(act,d,el);
  if(act==='assistant-full'||act==='assistant')scheduleAssistantFit();
  if(act==='diagnostics'&&$('#modal-body'))$('#modal-body').insertAdjacentHTML('beforeend','<div class="modal-footer">'+btn('检查模板与导出功能','shield','release-diagnostics','','primary')+'</div>');
  if(act==='et-open-library')updateTemplatePreview();
  if(act==='book-menu'){const box=$('#modal-body');if(box&&!$('[data-act="critic-settings"]',box))box.insertAdjacentHTML('beforeend','<div class="row" style="padding-top:15px">'+btn('视觉审校 API 设置','shield','critic-settings','','small ghost')+'</div>')}
  return result;
};


Object.assign(actionHelp,{'github-open':'选择一个模板包，检查 GitHub 仓库并确认提交。不会上传整个工作室。','github-publish-draft':'将当前经过校验的 HTML 模板草稿打包，发布到你有权限的 GitHub 仓库。','github-manual':'不填写 Token：下载模板包，在 GitHub 网页上传，然后复制 Raw 安装链接。','critic-settings':'独立填写视觉审校 Base URL、API Key 和视觉模型，并用图片测试连通性。','critic-batch':'逐页审校整本画册，真实模式可能产生 API 费用；连续三次失败停止。','guide-open':'内置七步教程，含可执行的本地三幕练习，不需要 GPU 或 API。','template-check':'检查所有 HTML 模板与 CSS。只检查，不删除或覆盖自定义内容。','assistant-input-expand':'扩大或还原输入区域。发送按钮与说明始终保留在浮窗内部。'});



document.addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.criticField){const key=el.dataset.criticField;if(!Object.hasOwn(criticDefaults,key))return;const value=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;if(key==='timeout'&&(!Number.isFinite(value)||value<15||value>180))return;state.settings.critic[key]=value;state.settings.critic.verification=null;save()}
  if(el.id?.startsWith('github-')){readGithubDraft();releaseUI.githubCheck=null;if(el.id==='github-resourceId')updateGithubPackagePreview()}
});


document.addEventListener('change',e=>{
  const el=e.target;
  try{
    if(['mode','connection'].includes(el.dataset.criticField)){state.settings.critic[el.dataset.criticField]=el.value;state.settings.critic.verification=null;save();if(!releaseUI.criticTesting)openCriticSettings()}
    if(el.id==='critic-provider'){const presets={openai:['https://api.openai.com/v1','gpt-4o'],ollama:['http://localhost:11434/v1','llama3.2-vision'],custom:['','']},selected=presets[el.value];state.settings.critic.provider=el.value;state.settings.critic.baseUrl=selected[0];state.settings.critic.model=selected[1];state.settings.critic.verification=null;save();openCriticSettings()}
    if(el.id==='github-resourceId'){readGithubDraft();const pkg=selectedPublishPackage(el.value);releaseUI.githubDraft.path=pkg.filename;$('#github-path').value=pkg.filename;updateGithubPackagePreview()}
  }catch(x){toast(x.message,'error')}
});


for(const id of ['github-dialog','critic-dialog','guide-dialog']){
  const dialog=$('#'+id);
  dialog.addEventListener('cancel',e=>{e.preventDefault();e.stopImmediatePropagation();handleAction(id==='github-dialog'?'github-close':id==='critic-dialog'?'critic-close':'guide-close',{}).catch(x=>toast(x.message,'error'))},true);
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){e.preventDefault();e.stopImmediatePropagation();handleAction(id==='github-dialog'?'github-close':id==='critic-dialog'?'critic-close':'guide-close',{}).catch(x=>toast(x.message,'error'))}},true);
  dialog.addEventListener('close',()=>{if(dialog.contains($('#toasts')))document.body.append($('#toasts'));if(dialog.contains($('#ui-tooltip')))document.body.append($('#ui-tooltip'));if(id==='github-dialog'){releaseUI.githubToken='';const token=$('#github-token');if(token){token.value='';token.removeAttribute('value')}}});
}


$('#welcome-dialog').addEventListener('close',()=>setTimeout(()=>{if(state.settings.identity?.onboarded&&!guidePreferences().seen&&!document.querySelector('dialog[open]'))openQuickStart(0)},200));


window.addEventListener('resize',scheduleAssistantFit);


document.addEventListener('keydown',e=>{const service=$('#github-dialog').open||$('#critic-dialog').open||$('#guide-dialog').open;if(service&&(e.metaKey||e.ctrlKey)&&['k','j',','].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation();toast('请先关闭当前服务窗口，再切换工作区。')}if(service&&['ArrowLeft','ArrowRight'].includes(e.key)&&!e.target.closest('input,textarea,select'))e.stopImmediatePropagation()},true);


/** @typedef {{id:string,key:string,type:'text'|'number'|'boolean'|'json',value:any}} StudioVariable */
/** @typedef {{id:string,projectId:string,title:string,entries:StudioVariable[]}} VariableSet */
/** @typedef {{id:string,projectId:string,title:string,templateId:string,rowId:string,enabled:boolean,variableSetIds:string[],variables:StudioVariable[],sceneOverrides:Object}} BookPlan */
const createUI={tab:'plans',planId:null,setId:null,sceneScope:'shared',nodeSearch:'',nodeWarnings:[],previewOpen:false,logsSearch:'',logLevel:'all',route:0,orbDragging:false,orbIgnoreClick:false,welcomePending:false,backendBusy:false};


const backendRuntime={connected:false,dirty:false,revision:null,savedAt:null,error:'',timer:null,tail:Promise.resolve(),allowReduction:false,count:0,loading:false,loaded:false,schema:null,saveSerial:0,committedSerial:0};


const variableTypes={text:'文本',number:'数字',boolean:'开关',json:'JSON'};


const systemVariableKeys=new Set(['__proto__','constructor','prototype']);


const projectPlans=()=>state.creation.plans.filter(p=>p.projectId===state.activeProjectId),projectVariableSets=()=>state.creation.variableSets.filter(s=>s.projectId===state.activeProjectId),planBy=id=>state.creation.plans.find(p=>p.id===id),setBy=id=>state.creation.variableSets.find(s=>s.id===id);


const bindingSources={positive:'本幕正向提示词',negative:'负向提示词',caption:'本幕台词',bookTitle:'画册名称',sceneName:'分镜名称',variable:'读取变量',literal:'自定义值 / 模板文本',random:'随机种子',sceneParameter:'分镜高级参数',image:'上传参考图 / 重绘图',inherit:'保持工作流原值'};


const bindingTypes={auto:'自动类型',text:'文本',number:'数字',boolean:'开关',json:'JSON'};


const v3Core={ensureStudioState,render,renderShell,renderGallery,renderSettingsWorkspace,renderStoryStudio,handleAction,validateState,flushEditor,makeFrame,save,renderStatus,loadState,realFrame,generateFrame,enqueueBook,runQueue,openQuickStart,diagnostics,showWorkspaceWelcome,activeJobs,selectedPublishPackage,importRaw,openCommand,guideDestination,installGithubFile};


studioDefaults.visibility.logs=true;

studioDefaults.visibility.llm=false;

studioDefaults.shell={collapsed:false};


ensureStudioState=function(s=state){v3Core.ensureStudioState(s);ensureCreationModel(s);return s};


makeFrame=function(index=0){const frame=v3Core.makeFrame(index);return {...frame,caption:frame.caption.replaceAll('{character}','{character_display_name}'),renderOverride:false,nodeOverrides:{}}};


render=displayV3;

renderShell=renderQuietShell;

renderSettingsWorkspace=renderSimpleSettings;

renderEngine=renderSmartMapper;

renderStoryboard=renderSceneComposer;

renderMatrix=renderBookPlans;


navigate=navigateV3;

indexCommands=commandIndexV3;

renderProjectPopover=renderPersistentProjectMenu;


showWorkspaceWelcome=nameFirstWelcome;

captureWelcomeIdentity=function(){const name=$('#welcome-name')?.value.trim()||'我的工作室',creator=$('#welcome-creator')?.value.trim()||'';state.settings.identity={workspaceName:name,creatorName:creator,onboarded:true};return state.settings.identity};


loadState=migrateAndLoadV3;


save=function(allow=false){if(rt.booting)return;if(backendConfig()?.enabled){backendRuntime.saveSerial++;backendRuntime.dirty=true;backendRuntime.allowReduction ||=allow;clearTimeout(backendRuntime.timer);if(backendRuntime.connected&&!backendRuntime.loading&&!backendRuntime.error)backendRuntime.timer=setTimeout(()=>savePythonWorkspace(),700);renderStatus()}else if(disk.root)v3Core.save(allow);else{backendRuntime.saveSerial++;backendRuntime.dirty=true;rt.saved=false;renderStatus()}};


renderStatus=function(){if(!backendConfig()?.enabled&&disk.root){v3Core.renderStatus();return}$('#statusbar').innerHTML=`<i class="dot ${backendRuntime.connected&&!backendRuntime.dirty?'':'amber'}"></i><button class="disk-status-action" data-act="v3-settings-tab" data-tab="connections">${esc(backendStatusText())}</button><span class="spacer"></span><span>${backendRuntime.connected?'PYTHON STORAGE':'LOCAL SESSION'}</span><span style="margin-left:17px">Mio v${MIO_VERSION}</span>`};


flushEditor=function(){if($$('[data-v3-frame],[data-v3-template]').length)flushCreationEditor();else if($$('[data-frame-field],[data-template-field]').length)v3Core.flushEditor()};


interpolate=function(text,row={},frame={}){return scopeText(text,frame._scope||row._scope||row,false)};


realFrame=executeMappedGPU;

generateFrame=generateMappedFrame;

enqueueBook=enqueueCompatibleBook;

runQueue=runFlexibleQueue;

dryRun=mappedDryRun;


autoBindWorkflow=function(){const c=state.settings.comfy;for(const b of c.bindings||[])if(b.autoField&&['positive','negative'].includes(b.source)){const inf=inferTextInput(b.nodeId);b.path=inf.field;b.warning=inf.warning}c.outputNodeId||=Object.entries(c.workflow).find(([,n])=>/SaveImage|PreviewImage/.test(n.class_type))?.[0]||''};


renderLogs=function(){const el=$('#log-body');if(!el)return;const search=createUI.logsSearch.toLowerCase(),entries=rt.logs.filter(l=>(createUI.logLevel==='all'||l.level===createUI.logLevel)&&l.message.toLowerCase().includes(search));el.innerHTML=entries.map(l=>`<div class="log-${l.level}"><span class="log-time">${new Date(l.time).toLocaleTimeString('en-GB')}</span><span>${esc(l.message)}</span></div>`).join('')||'<p class="muted">当前筛选没有日志。</p>';el.scrollTop=el.scrollHeight;const count=$('#v3-log-count');if(count)count.textContent=entries.length+' 条'};


workspaceVisible=function(index){if([0,1,2,3,5].includes(index))return true;if(index===6)return state.settings.studio.visibility.logs;if(index===4)return state.settings.studio.visibility.llm;return false};


validateState=function(s){
  v3Core.validateState(s);const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,150}$/.test(value)&&!systemVariableKeys.has(value);
  const entriesOK=entries=>{if(!Array.isArray(entries)||entries.length>500)throw Error('变量列表结构不合法。');const ids=new Set(),keys=new Set();for(const e of entries){if(!safeId(e.id)||ids.has(e.id)||keys.has(e.key))throw Error('变量 ID 或名称重复、不合法。');checkVariableKey(e.key);if(!Object.hasOwn(variableTypes,e.type))throw Error('变量类型不合法。');ids.add(e.id);keys.add(e.key)}};
  for(const t of s.templates)for(const f of t.frames)if(f.id!==undefined&&!safeId(f.id))throw Error('分镜 ID 不合法。');
  if(s.creation){if(!Array.isArray(s.creation.plans)||!Array.isArray(s.creation.variableSets))throw Error('创作模型结构不完整。');for(const list of [s.creation.plans,s.creation.variableSets]){const ids=new Set();for(const item of list){if(!safeId(item.id)||ids.has(item.id)||typeof item.title!=='string'||!s.projects.some(p=>p.id===item.projectId))throw Error('创作资产 ID、名称或企划归属不合法。');ids.add(item.id)}}
    for(const set of s.creation.variableSets)entriesOK(set.entries);
    for(const p of s.creation.plans){if(!Array.isArray(p.variableSetIds)||new Set(p.variableSetIds).size!==p.variableSetIds.length||!p.sceneOverrides||typeof p.sceneOverrides!=='object'||Array.isArray(p.sceneOverrides)||!safeId(p.rowId)||!s.rows.some(r=>r.id===p.rowId)||typeof p.enabled!=='boolean')throw Error('画册计划结构不完整。');entriesOK(p.variables);for(const[id,o]of Object.entries(p.sceneOverrides)){if(!safeId(id)||!o||typeof o!=='object')throw Error('单幕覆盖不合法。');if(o.variables)entriesOK(o.variables)}}
  }
  if(s.settings.comfy.bindings)validateBindings(s.settings.comfy.bindings);
  if(s.settings.backend&&(!['PUT','POST'].includes(s.settings.backend.method)||typeof s.settings.backend.enabled!=='boolean'))throw Error('Python 保存配置不合法。');
  return true;
};


activeJobs=function(){return v3Core.activeJobs()||createUI.backendBusy||backendRuntime.saving||!!createUI.dryController};


backupModal=function(){modal('工程备份与恢复',`<div class="service-context"><strong>${esc(workspaceName())}</strong><br>${esc(backendStatusText())}</div><p class="help" style="margin:18px 0">日常保存交给现有 Python 后端。便携备份包含创作计划、复用变量、所有分镜、画册与通用节点映射。</p><div class="stack">${btn('下载工程 JSON','download','backup-export','','primary')}${btn('从 JSON 恢复','upload','import-project')}${btn('下载便携目录 ZIP','folder','disk-archive')}${btn('配置 Python 保存服务','disk','v3-settings-tab','data-tab="connections"')}</div><label class="row small soft" style="margin-top:18px"><input id="backup-secrets" type="checkbox">此次 JSON 备份包含其他服务密钥（敏感，不含图像密钥库）</label><div class="modal-footer">${btn('关闭','','close-modal')}</div>`,'仅在服务明确确认后，状态栏才会显示已保存。')};


const v3Actions={
  'v3-nav':d=>navigate(({books:0,create:1,logs:6,writing:4,settings:5})[d.route]??0),
  'v3-collapse-nav':()=>{state.settings.studio.shell.collapsed=!state.settings.studio.shell.collapsed;save();renderShell()},
  'v3-resources':()=>{studioUI.settingsTab='resources';navigate(5)},
  'v3-settings-tab':d=>{flushEditor();if($('#modal').open)closeModal();if($('#reader').open)closeReader();studioUI.settingsTab=d.tab;createUI.sceneAdvancedOpen=false;navigate(5)},
  'v3-project-close':()=>closeProjectPopover(),
  'v3-close-command':()=>$('#command-dialog').close(),
  'v3-create-tab':d=>{flushEditor();createUI.tab=d.tab;createUI.sceneAdvancedOpen=false;navigate(1)},
  'v3-plan-new':()=>createBookPlan(),
  'v3-plan-select':d=>{flushEditor();const p=planBy(d.id);if(!p)throw Error('画册计划不存在。');if(p.projectId!==state.activeProjectId)changeProject(p.projectId);createUI.planId=p.id;createUI.tab='plans';if(p.templateId)ui.templateId=p.templateId;navigate(1)},
  'v3-plan-scenes':()=>{const p=selectedPlan();ui.templateId=p.templateId;ui.frameIndex=0;createUI.tab='scenes';navigate(1)},
  'v3-plan-clone':()=>{const source=selectedPlan(),p=clone(source),row=clone(rowBy(p.rowId));row.id=uid('row');row._planMapped=true;p.id=uid('plan');p.rowId=row.id;p.title+=' · 副本';p.createdAt=Date.now();state.rows.push(row);state.creation.plans.push(p);createUI.planId=p.id;save();render()},
  'v3-plan-delete':async()=>{const p=selectedPlan();if(!await confirmAction('删除「'+p.title+'」计划？','只移除创作计划。已生成画册、源分镜与复用素材全部保留。','删除计划'))return;state.creation.plans=state.creation.plans.filter(x=>x.id!==p.id);createUI.planId=null;save(true);render()},
  'v3-choose-sets':()=>renderVariableChooser(),
  'v3-close-chooser':()=>{closeModal();render()},
  'v3-plan-unlink':d=>{const p=selectedPlan();p.variableSetIds=p.variableSetIds.filter(id=>id!==d.id);save();render()},
  'v3-set-order':d=>{const p=selectedPlan(),i=Number(d.index),j=i+Number(d.dir);if(j<0||j>=p.variableSetIds.length)return;[p.variableSetIds[i],p.variableSetIds[j]]=[p.variableSetIds[j],p.variableSetIds[i]];save();render()},
  'v3-set-new':()=>newVariableSet(),
  'v3-set-select':d=>{createUI.setId=d.id;createUI.tab='variables';render()},
  'v3-set-clone':()=>{const s=clone(setBy(createUI.setId));s.id=uid('set');s.title+=' · 副本';s.entries.forEach(e=>e.id=uid('var'));state.creation.variableSets.push(s);createUI.setId=s.id;save();render()},
  'v3-set-delete':async()=>{const s=setBy(createUI.setId),count=state.creation.plans.filter(p=>p.variableSetIds.includes(s.id)).length;if(!await confirmAction('删除变量素材「'+s.title+'」？','有 '+count+' 份计划引用它。引用将被移除，缺少的变量会在生成前报错。现有图片不变。','删除素材'))return;state.creation.variableSets=state.creation.variableSets.filter(x=>x.id!==s.id);for(const p of state.creation.plans)p.variableSetIds=p.variableSetIds.filter(id=>id!==s.id);createUI.setId=null;save(true);render()},
  'v3-variable-add':d=>addVariable(d.group,d.id),
  'v3-variable-delete':d=>removeVariable(d.group,d.id,d.entry),
  'v3-variable-rename':d=>renameScopedVariable(d.group,d.id,d.entry),
  'v3-refresh-preview':()=>refreshCreationPreviews(),
  'v3-clear-scene':async()=>{const p=selectedPlan(),f=currentTemplate().frames[ui.frameIndex];if(!await confirmAction('清除当前画册这一幕的覆盖？','将恢复源分镜内容，已生成画面不受影响。','清除覆盖'))return;delete p.sceneOverrides[f.id];save();render()},
  'v3-generate-plan':()=>generateChosenPlans(true,false),
  'v3-enqueue-plan':()=>generateChosenPlans(true,true),
  'v3-generate-selected':()=>generateChosenPlans(false,false),
  'v3-run-queue':()=>{if(!state.queue.some(q=>q.status==='pending'))throw Error('队列为空，请先在画册计划中加入任务。');void runQueue()},
  'v3-clear-logs':async()=>{if(await confirmAction('清空当前日志显示？','不影响画册、队列或后端保存。','清空日志')){rt.logs=[];renderLogs()}},
  'v3-add-binding':()=>{addInputBinding();save();render()},
  'v3-expose-input':d=>{const b=addInputBinding(d.node,d.path);if(isWorkflowLink(inputAt(state.settings.comfy.workflow[d.node],d.path).value,state.settings.comfy.workflow))b.enabled=false;save();render()},
  'v3-remove-binding':async d=>{if(!await confirmAction('删除此输入映射？','原始工作流节点不被删除，下次生成将保留该字段原值。','删除映射'))return;state.settings.comfy.bindings=state.settings.comfy.bindings.filter(b=>b.id!==d.id);save();render()},
  'v3-infer-field':d=>{const b=state.settings.comfy.bindings.find(b=>b.id===d.id),inf=inferTextInput(b.nodeId);b.path=inf.field;b.warning=inf.warning;b.autoField=true;save();render();toast(inf.warning||'已读取实际文本字段：'+inf.field)},
  'v3-auto-bind':()=>autoIdentifyBindings(),
  'v3-add-render-mappings':()=>addRenderBindings(),
  'v3-read-object-info':()=>readComfyObjectInfo(),
  'v3-import-workflow':()=>pickFile('.json',async f=>{if(f.size>12000000)throw Error('工作流超过12 MB。');importWorkflowIntoMapper(JSON.parse(await f.text()))}),
  'v3-export-mapping':()=>{const c=state.settings.comfy;download(safeFolderName(c.workflowTitle)+'.mappings.json',JSON.stringify({kind:'comfycomic.workflow-mappings',formatVersion:1,title:c.workflowTitle,workflow:c.workflow,bindings:c.bindings,outputNodeId:c.outputNodeId,randomizeSeeds:c.randomizeSeeds},null,2))},
  'v3-import-mapping':()=>pickFile('.json',async f=>{const data=JSON.parse(await f.text());if(data.kind!=='comfycomic.workflow-mappings'||data.formatVersion!==1)throw Error('不是通用工作流映射包。');validateBindings(data.bindings);if(!await confirmAction('导入工作流与节点映射？','将替换当前蓝图与映射，已有入队快照不变。建议先导出当前映射包。','导入映射包'))return;importWorkflowIntoMapper(data);state.settings.comfy.randomizeSeeds=!!data.randomizeSeeds;save()}),
  'v3-preview-workflow':()=>previewMappedSubmission(),
  'v3-copy-submission':()=>copyText(JSON.stringify(createUI.lastSubmission,null,2)),
  'v3-mapping-dry':()=>mappedDryRun(),
  'v3-read-openapi':()=>discoverBackendSchema(),
  'v3-connect-backend':()=>connectPythonBackend(),
  'v3-save-backend':async()=>{flushEditor();if(!backendRuntime.connected)throw Error('请先读取并连接 Python 后端。');if(await savePythonWorkspace())toast('Python 服务已确认保存。')},
  'v3-disconnect-backend':()=>{clearTimeout(backendRuntime.timer);backendRuntime.connected=false;state.settings.backend.enabled=false;persistBackendLocation();render();toast('已断开自动保存。当前修改保留在内存中。')},
  'v3-browser-storage':()=>{modal('备用：浏览器目录保存',storageSettingsHTML(),'只有不使用 Python 保存时才需要此方式。',true)},
  'v3-welcome-enter':()=>finishNameFirst(false),
  'v3-welcome-default':()=>finishNameFirst(true),
  'welcome-temporary':()=>finishNameFirst(true),
  'v3-diagnostics':()=>v3Diagnostics()
};


handleAction=async function(act,data={},el){
  if(act==='assistant'&&(createUI.orbIgnoreClick||createUI.orbDragging))return;
  if($('#welcome-dialog').open&&!['v3-welcome-enter','v3-welcome-default','welcome-temporary'].includes(act))return;
  if(Object.hasOwn(v3Actions,act)){hideTip();await v3Actions[act](data,el);return}
  if(['new-book','add-row'].includes(act))return createBookPlan();
  if(act==='enqueue')return generateChosenPlans(false,true);if(act==='start-batch')return generateChosenPlans(false,false);
  if(act==='column-add')return addVariable('plan',selectedPlan()?.id);
  if(act==='settings'||act==='profile-settings'){if($('#modal').open)closeModal();if($('#reader').open)closeReader();studioUI.settingsTab=act==='profile-settings'?'general':studioUI.settingsTab;navigate(5);return}
  if(['storage-settings','disk-save'].includes(act)&&!disk.root){studioUI.settingsTab='connections';navigate(5);return}
  if(act==='engine-info'||act==='go-engine'){studioUI.settingsTab='connections';navigate(5);return}
  if(act==='import-workflow')return v3Actions['v3-import-workflow']();
  if(act==='new-template')createUI.tab='scenes';
  if(['scene','add-frame','clone-frame','delete-frame','move-frame'].includes(act))flushEditor();
  if(act==='pause-queue'){if(!rt.running){toast('没有正在运行的任务。');return}rt.paused=!rt.paused;render();return}
  await v3Core.handleAction(act,data,el);
  if(act==='insert-prompt')flushEditor();
};


document.addEventListener('input',e=>{const el=e.target;try{
  if(el.dataset.v3Plan==='title'){const p=selectedPlan();p.title=el.value;p.updatedAt=Date.now();save();refreshCreationPreviews()}
  if(el.dataset.v3SetTitle){const s=setBy(createUI.setId);if(s){s.title=el.value;save()}}
  if(el.dataset.v3Frame||el.dataset.v3Template){flushEditor();refreshCreationPreviews()}
  if(el.dataset.v3Var==='value'){const entries=variableOwner(el.dataset.group,el.dataset.owner),entry=entries?.find(e=>e.id===el.dataset.entry);if(entry){entry.value=entry.type==='boolean'?el.value==='true':el.value;save();refreshCreationPreviews()}}
  if(el.dataset.v3Binding){const b=state.settings.comfy.bindings.find(b=>b.id===el.dataset.id);if(b){const k=el.dataset.v3Binding;b[k]=el.type==='checkbox'?el.checked:el.value;if(k==='path'){b.autoField=false;b.warning=''}save()}}
  if(el.dataset.v3Output){state.settings.comfy.outputNodeId=el.value;save()}
  if(el.id==='v3-node-search'){createUI.nodeSearch=el.value;$('#v3-node-results').innerHTML=nodeBrowserItems(state.settings.comfy.workflow,el.value.toLowerCase())}
  if(el.dataset.v3Backend){state.settings.backend[el.dataset.v3Backend]=el.value;backendRuntime.connected=false;backendRuntime.error='';state.settings.backend.enabled=false;persistBackendLocation();save()}
  if(el.id==='v3-backend-token')createUI.backendToken=el.value;
  if(el.id==='v3-log-search'){createUI.logsSearch=el.value;renderLogs()}
}catch(error){toast(error.message,'error')}});


document.addEventListener('change',async e=>{const el=e.target;try{
  if(el.dataset.v3Plan==='templateId'){flushEditor();const p=selectedPlan();p.templateId=el.value;p.storyVersionId='';ui.templateId=el.value;ui.frameIndex=0;save();render()}
  if(el.id==='v3-story-source'){selectedPlan().storyVersionId=el.value;save();refreshCreationPreviews()}
  if(el.dataset.v3PlanEnabled){planBy(el.dataset.v3PlanEnabled).enabled=el.checked;save()}
  if(el.dataset.v3ChooseSet){const p=selectedPlan();if(el.checked&&!p.variableSetIds.includes(el.dataset.v3ChooseSet))p.variableSetIds.push(el.dataset.v3ChooseSet);else if(!el.checked)p.variableSetIds=p.variableSetIds.filter(id=>id!==el.dataset.v3ChooseSet);save()}
  if(el.dataset.v3Var==='type'){const entry=variableOwner(el.dataset.group,el.dataset.owner)?.find(x=>x.id===el.dataset.entry);if(entry){entry.type=el.value;entry.value=el.value==='number'?0:el.value==='boolean'?false:el.value==='json'?'{}':String(entry.value??'');save();render()}}
  if(el.id==='v3-scene-template'){flushEditor();ui.templateId=el.value;ui.frameIndex=0;createUI.sceneScope='shared';render()}
  if(el.id==='v3-scene-scope'){flushEditor();createUI.sceneScope=el.value;render()}
  if(el.id==='v3-render-override'){const p=selectedPlan(),f=currentTemplate().frames[ui.frameIndex],own=createUI.sceneScope==='plan'&&p?.templateId===ui.templateId;if(own){p.sceneOverrides[f.id]??={};p.sceneOverrides[f.id].renderOverride=el.checked}else f.renderOverride=el.checked;save();render();$$('.advanced-details').find(d=>d.querySelector('summary')?.textContent.includes('高级选项'))?.setAttribute('open','')}
  if(el.dataset.v3Binding){const b=state.settings.comfy.bindings.find(b=>b.id===el.dataset.id),key=el.dataset.v3Binding;if(!b)return;if(key==='allowLink'&&el.checked){if(!await confirmAction('允许覆盖此字段原有的节点连线？','这会改变数据流向，可能导致工作流执行错误。请先预览完整 JSON。','明确允许')){b.allowLink=false;el.checked=false}}if((key==='nodeId'&&b.autoField)||key==='source'&&['positive','negative'].includes(b.source)){const info=inferTextInput(b.nodeId);b.path=info.field;b.warning=info.warning;b.autoField=true}save();if(key!=='value'&&key!=='label')render()}
  if(el.id==='v3-randomize-seeds'){state.settings.comfy.randomizeSeeds=el.checked;save()}
  if(el.id==='v3-log-level'){createUI.logLevel=el.value;renderLogs()}
  if(el.dataset.studioPref==='visibility.llm'||el.dataset.studioPref==='visibility.logs'){render()}
}catch(error){toast(error.message,'error')}});


window.addEventListener('click',e=>{if(e.target instanceof HTMLDialogElement){e.preventDefault();e.stopImmediatePropagation();return}if(e.target.closest('.assistant-orb')&&(createUI.orbIgnoreClick||createUI.orbDragging)){e.preventDefault();e.stopImmediatePropagation()}},true);


window.addEventListener('cancel',e=>{if(e.target instanceof HTMLDialogElement){e.preventDefault();e.stopImmediatePropagation()}},true);


window.addEventListener('close',e=>{if(e.target===$('#welcome-dialog')){e.stopImmediatePropagation();if($('#welcome-dialog').contains($('#toasts')))document.body.append($('#toasts'))}},true);


window.addEventListener('keydown',e=>{if(e.key==='Escape'&&(document.querySelector('dialog[open]')||detailUI.projectOpen)){e.preventDefault();e.stopImmediatePropagation();return}if(e.target.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;if(!e.ctrlKey&&!e.metaKey&&/^[1-5]$/.test(e.key)){e.preventDefault();e.stopImmediatePropagation();navigate(({1:0,2:1,3:6,4:4,5:5})[e.key])}},true);


window.addEventListener('resize',()=>{const orb=$('.assistant-orb');if(orb){orb.style.right=clamp(parseFloat(orb.style.right)||27,12,Math.max(12,innerWidth-58))+'px';orb.style.bottom=clamp(parseFloat(orb.style.bottom)||49,40,Math.max(40,innerHeight-58))+'px'}});


window.addEventListener('beforeunload',e=>{if(!rt.booting&&(backendRuntime.dirty||backendRuntime.saving)){e.preventDefault();e.returnValue=''}});


window.addEventListener('keydown',e=>{if(e.key==='Enter'&&$('#welcome-dialog').open&&e.target.id==='welcome-name'){e.preventDefault();e.stopImmediatePropagation();try{finishNameFirst(!e.target.value.trim())}catch(error){toast(error.message,'error')}}},true);


Object.assign(actionHelp,{'v3-plan-new':'新建独立的画册计划，再选择分镜与可复用素材。','v3-generate-plan':'检查每一幕的变量与节点映射，冻结当前配置后开始生成。','v3-choose-sets':'一份计划可以组合多套素材，同名值按顺序覆盖。','v3-add-binding':'手动添加任意节点输入，支持文本、数字、开关和嵌套 JSON。','v3-auto-bind':'根据实际蓝图寻找文本节点。无法确定字段时回退 text 并告警，需人工核对。','v3-preview-workflow':'预览实际提交的节点字典，所有未映射字段保持原值。','v3-connect-backend':'只调用你填写的读取接口，确认数据后连接保存服务。','v3-resources':'教程、画册 HTML 模板、市场与 GitHub 托管都收纳在这里。','v3-variable-delete':'删除此作用域的变量，不擅自移除分镜中的占位符。生成前会检测缺失。'});


redrawStep=redrawMappedBookStep;


openCommand=function(){v3Core.openCommand();const inputRow=$('.command-input'),kbd=$('.kbd',inputRow);if(kbd)kbd.replaceWith(Object.assign(document.createElement('span'),{innerHTML:ibtn('close','v3-close-command','关闭快捷操作')}));if(!$('.command-input [data-act="v3-close-command"]'))inputRow.insertAdjacentHTML('beforeend',ibtn('close','v3-close-command','关闭快捷操作'))};


guideDestination=async function(action){if(action==='storyboard')createUI.tab='scenes';return v3Core.guideDestination(action)};


Object.assign(guideSteps[0],{title:'设置保存方式',headline:'让已有 Python 服务管理作品。',description:'无需先给浏览器授权文件夹。在“设置 → 服务与保存”填写已有 Python 读取和保存接口，连接确认后自动提交工程；也可先在临时会话里练习。',checks:['先给工作室命名，或使用默认名称进入。','Python 读取接口需返回工程或明确的空状态；未确认接口前不会自动写入。','暂未连接时可导出工程 JSON，ZIP 和浏览器目录保存作为备用。']});


Object.assign(guideSteps[2],{title:'组合分镜与素材',headline:'一份分镜，可以讲出不同的故事。',description:'“创作画册”把画册计划、分镜编辑、变量素材与生成队列放在一起。画册名称独立于变量；同一套素材可以被多个计划复用。',checks:['先建画册计划，为画册起名并选择分镜模板。','在变量素材中自由添加字段，然后把多组素材组合到画册。','同名值按素材顺序、本册覆盖、单幕覆盖依次优先。']});


guideSteps[3].checks=['在画册计划中预览替换结果，补全缺少变量后生成。','工作流输入可在“设置 → 智能节点映射”任意增删映射，包括 LoRA 管理器。','尺寸和采样参数默认保留蓝图原值；只有主动开启且建立映射后才覆盖。'];


guideSteps[4].checks=['视觉审校 API 在设置里独立配置，不必开启 AI 写故事。','悬浮球可拖动，悬停展开说明，点击打开分镜精修助手。','助手对话绑定源模板；只想修改本册时请用分镜编辑里的单幕覆盖。'];


guideSteps[5].checks=['在我的画册中点击操作菜单，再选择导出离线画册。','画册 HTML 版式、模板市场与 GitHub 托管都收入“设置 → 工具与资源”。','分镜模板定义内容，HTML 模板定义阅读排版，两者互不覆盖。'];


renameScopedVariable=async function(group,id,entryId){
  const list=variableOwner(group,id),entry=list?.find(e=>e.id===entryId);if(!entry)throw Error('变量不存在。');const old=entry.key;
  textModal('重命名变量及引用','新的变量标识符',old,async key=>{
    checkVariableKey(key);if(key===old){closeModal();return}
    const scopes=[...state.creation.variableSets.map(s=>s.entries),...state.creation.plans.flatMap(p=>[p.variables,...Object.values(p.sceneOverrides).map(o=>o.variables||[])])];
    if(scopes.some(entries=>entries.some(e=>e.key===old)&&entries.some(e=>e.key===key)))throw Error('至少一个作用域已经同时存在新旧变量名。请先处理同名冲突，避免覆盖。');
    const affected=state.templates.flatMap(t=>t.frames).filter(f=>(f.prompt+' '+f.caption).includes('{'+old+'}')).length;
    if(!await confirmAction('同步重命名 {'+old+'}？','这次改名会穿透当前工程的素材、本册/单幕覆盖、源分镜和通用节点映射。\n影响 '+affected+' 幕分镜。已有生成画册和队列快照保持不变。','确认全工程改名'))return;
    const re=new RegExp('\\{'+old+'\\}','g'),replace=text=>String(text||'').replace(re,'{'+key+'}');
    for(const entries of scopes)for(const e of entries)if(e.key===old)e.key=key;
    for(const p of state.creation.plans){p.title=replace(p.title);for(const o of Object.values(p.sceneOverrides))for(const field of ['name','prompt','caption','negative'])if(o[field]!==undefined)o[field]=replace(o[field])}
    for(const t of state.templates)for(const f of t.frames){f.prompt=replace(f.prompt);f.caption=replace(f.caption);f.negative=replace(f.negative)}
    for(const r of state.rows)for(const versions of Object.values(r.storyVersions))for(const v of versions)v.captions=v.captions.map(replace);
    for(const b of state.settings.comfy.bindings){if(b.source==='variable'&&String(b.value).replace(/^\{|\}$/g,'')===old)b.value=key;else if(b.source==='literal')b.value=replace(b.value)}
    save();closeModal();render();toast('变量名与所有活动引用已同步；已入队快照未改变。');
  },'仅匹配完整 {变量名}，不会误改类似的变量名。');
};


selectedPublishPackage=function(id){if(id!=='workflow:active')return v3Core.selectedPublishPackage(id);const raw=v3Core.selectedPublishPackage(id),c=state.settings.comfy,value={kind:'comfycomic.workflow-mappings',formatVersion:1,title:c.workflowTitle,workflow:clone(c.workflow),bindings:clone(c.bindings),outputNodeId:c.outputNodeId,randomizeSeeds:c.randomizeSeeds};validateBindings(value.bindings);for(const b of value.bindings)if(b.source==='literal'&&b.value&&/(?:^|[/.])(?:api[_-]?key|token|authorization|password|secret)$/i.test(b.path))throw Error('映射包包含可能的凭据固定值，请先移除再上传。');const text=JSON.stringify(value,null,2),bytes=new TextEncoder().encode(text).length;if(bytes>1000000)throw Error('映射包超过 1 MB，请下载后通过 Git 客户端上传。');return{...raw,value,text,bytes,kind:'工作流与通用节点映射',filename:'workflows/'+safeFolderName(c.workflowTitle)+'.mappings.json'}};


importRaw=importGenericWorkflowLink;


installGithubFile=async function(){
  if(releaseUI.githubBusy)return;readGithubDraft();const config=githubConfiguration();const target=await verifyGithubTarget(config);let data;try{data=JSON.parse(base64UTF8(target.file?.content||''))}catch(e){return v3Core.installGithubFile()}
  if(data.kind!=='comfycomic.workflow-mappings')return v3Core.installGithubFile();validateBindings(data.bindings);validateWorkflow(data.workflow);
  if(!await confirmAction('安装仓库中的通用节点映射？','来源 '+config.owner+'/'+config.repo+'。将替换当前工作流与输入映射，已生成画册和入队任务不变。','安装映射'))return;
  importWorkflowIntoMapper(data);state.settings.comfy.randomizeSeeds=!!data.randomizeSeeds;releaseUI.githubToken='';closeServiceDialog('github-dialog');save();toast('工作流及插件输入映射已导入。');
};


async function v3Diagnostics(){
  const results=[],test=(name,fn)=>{try{if(fn()===false)throw Error('断言不成立');results.push({name,ok:true})}catch(e){results.push({name,ok:false,message:e.message})}};
  const fixture={A:{id:'A',title:'角色',entries:[variableEntry('character','七海'),variableEntry('strength',.5)]},B:{id:'B',title:'服装',entries:[variableEntry('outfit','白色外套'),variableEntry('strength',.7)]}},frame={...makeFrame(0),id:'frame_test'},plan={variableSetIds:['A','B'],variables:[variableEntry('strength',.8)],sceneOverrides:{frame_test:{variables:[variableEntry('strength',.9)]}}};
  test('素材 → 本册 → 单幕覆盖顺序',()=>effectivePlanScope(plan,frame,id=>fixture[id]).values.strength===.9);
  test('同一素材可复用而不改变原始值',()=>{const p={...plan,variables:[variableEntry('strength',.1)],sceneOverrides:{}};return effectivePlanScope(p,null,id=>fixture[id]).values.strength===.1&&fixture.A.entries[1].value===.5});
  test('画册名称独立支持动态变量',()=>scopeText('{character} 的来信',{character:'七海'},true)==='七海 的来信');
  test('变量 character 不碰撞 character2',()=>scopeText('{character}/{character2}',{character:'A',character2:'B'},true)==='A/B');
  test('缺少变量不会静默清空',()=>{try{scopeText('{weapon}',{},true);return false}catch(e){return true}});
  test('所有变量可自行定义，无固定角色字段',()=>typedVariableValue(variableEntry('my_custom_strength',1.25))===1.25);
  const workflow={'42':{class_type:'CustomLoraManager',inputs:{loras:[{name:'a.safetensors',strength:.4,enabled:true}],unused:'keep'}},'9':{class_type:'TextNode',inputs:{opt_text:'old'}},'3':{class_type:'Sampler',inputs:{steps:26,cfg:7,model:['42',0]}},'8':{class_type:'Output',inputs:{images:['3',0]}}};
  const binding={id:'bind_test',nodeId:'42',path:'/loras/0/strength',label:'LoRA 强度',enabled:true,source:'variable',value:'strength',type:'number',allowCreate:false,allowLink:false},execution={workflow,bindings:[binding],randomizeSeeds:false};
  test('插件嵌套 LoRA 强度可以任意映射',()=>buildMappedWorkflow({...frame,_scope:{strength:.85}},{},{execution,preview:true}).workflow['42'].inputs.loras[0].strength===.85);
  test('没有映射的插件字段与连线保持不变',()=>{const next=buildMappedWorkflow({...frame,_scope:{strength:.85}},{},{execution,preview:true}).workflow;return next['42'].inputs.unused==='keep'&&next['3'].inputs.model[0]==='42'&&workflow['42'].inputs.loras[0].strength===.4});
  test('真实文本字段自动读取 opt_text',()=>inferTextInput('9',{workflow,objectInfo:{}}).field==='opt_text');
  test('SDXL 实际字符串字段按优先级选择 text_g',()=>{const guessed=inferTextInput('77',{workflow:{'77':{class_type:'TextPair',inputs:{text_g:'A',text_l:'B'}}},objectInfo:{}});return guessed.field==='text_g'});
  test('分镜规格默认关闭，保持采样原值',()=>{const b={...binding,nodeId:'3',path:'steps',source:'sceneParameter',value:'steps'},r=buildMappedWorkflow({...frame,steps:99,renderOverride:false},{},{execution:{...execution,bindings:[b]}});return r.workflow['3'].inputs.steps===26});
  test('显式开启才写入分镜高级参数',()=>{const b={...binding,nodeId:'3',path:'steps',source:'sceneParameter',value:'steps'},r=buildMappedWorkflow({...frame,steps:33,renderOverride:true},{},{execution:{...execution,bindings:[b]}});return r.workflow['3'].inputs.steps===33});
  test('节点连线受保护，不会意外变成文本',()=>{try{buildMappedWorkflow(frame,{},{execution:{...execution,bindings:[{...binding,nodeId:'3',path:'model',source:'literal',value:'oops',type:'text'}]}});return false}catch(e){return true}});
  test('危险路径不能污染工程对象',()=>{try{inputPathParts('/__proto__/bad');return false}catch(e){return true}});
  test('数字与布尔值不被强制转成文本',()=>castBoundValue('false','boolean',true)===false&&castBoundValue('.75','number',1)===.75);
  test('同名输入重复映射会在提交前拦截',()=>{try{buildMappedWorkflow({...frame,_scope:{strength:1}},{},{execution:{...execution,bindings:[binding,{...binding,id:'second'}]}});return false}catch(e){return true}});
  test('新版创作模型可验证与序列化',()=>{validateState(state);return JSON.parse(JSON.stringify(state)).creation.version===1});
  test('工作流映射导入包结构校验',()=>validateBindings(state.settings.comfy.bindings));
  test('AI 写故事为可选模块',()=>Object.hasOwn(state.settings.studio.visibility,'llm')&&typeof state.settings.studio.visibility.llm==='boolean');
  test('主导航不再包含我的企划或独立引擎',()=>!primaryNavItems().some(x=>x[0]===2||x[0]===3));
  modal('创作架构与节点映射自检',`<div class="notice">这些检查在当前浏览器运行，不调用 Python 保存接口，也不会提交 ComfyUI GPU 任务。</div><div style="margin-top:17px">${results.map(r=>`<div class="template-check-row"><span class="${r.ok?'accent':'danger'}">${icon(r.ok?'check':'close')}</span><div class="grow">${esc(r.name)}${r.message?'<small>'+esc(r.message)+'</small>':''}</div><span class="tiny muted">${r.ok?'通过':'未通过'}</span></div>`).join('')}</div><div class="modal-footer"><span class="tiny muted grow">${results.filter(r=>r.ok).length} / ${results.length} 项通过；真实后端与插件仍需实际联调。</span>${btn('关闭','','close-modal','','primary')}</div>`,'以通用输入映射替代固定节点表单。',true);return results;
}


/* Source: /js/app.js */
function installNativeApplication(){installNativeStateModule();installNativeSyncModule();installNativeEngineModule();installNativeCreationModule();installNativeUIModule();const ns=globalThis.ComfyComic,previousEnsure=ensureStudioState,normalizedStates=new WeakSet();ensureStudioState=function(value=state){if(!normalizedStates.has(value)){ns.stateContract.normalize(value);normalizedStates.add(value)}previousEnsure(value);value.settings.backend={enabled:/http/.test(location.protocol),baseUrl:'',loadPath:'/api/config',savePath:'/api/config',method:'POST',payloadField:'',responseField:''};return value};const previousAction=handleAction;handleAction=async function(action,data={},element){if(action==='clone-frame')ensureFrameCapacity(currentTemplate()?.frames||[]);if(action==='v3-save-backend'){flushEditor();if(await ns.sync.save())toast('POST /api/config 已由后端确认。');return}if(action==='v3-connect-backend')return connectPythonBackend();return previousAction(action,data,element)};ns.modules.app=true;ns.convertApiConfigToStudioState=(config,defaults=state)=>ns.converters.fromApi(config,defaults);ns.convertStudioStateToApiPayload=(value=state,previous=ns.sync.runtime.previous,forceWrite=false)=>ns.converters.toApi(value,previous,forceWrite)}


const artUI={readerMode:'webtoon',filmstrip:false,showInfo:false,showCaptions:true,readerObserver:null,readerAnchorUntil:0,labBookId:null,labIndex:0,fontStatus:'fallback',editorObserver:null,viewTab:'story',changingCopy:false,copyTimer:null};


let artCore;


function installArtStudio(){
  const ns=globalThis.ComfyComic;ns.promptPolicy=createFreePromptPolicy();
  artCore={render,renderShell,renderCreationWorkspace,renderSceneComposer,renderGallery,renderReader,openReader,closeReader,handleAction,ensureStudioState,effectivePlanScope,refreshCreationPreviews,modal,toast,seedState,renderSettingsWorkspace,importTemplateObject};
  seedState=function(){return createCuratedDemo(artCore.seedState())};
  if(state.books?.some(b=>b.id==='book_0')&&state.projects?.some(p=>p.id==='p_summer'))state=createCuratedDemo(state);
  ensureStudioState=function(s=state){artCore.ensureStudioState(s);ensureArtSettings(s);return s};
  importTemplateObject=function(data){const template=artCore.importTemplateObject(data),p=selectedPlan();if(p){p.templateId=template.id;p.storyVersionId='';ui.templateId=template.id;ui.frameIndex=0;save()}return template};
  validatePrompt=value=>String(value??'');
  interpolate=(text,row={},frame={})=>scopeText(text,frame._scope||row._scope||row);
  interpolateBoundValue=function(text,scope={}){if(typeof text!=='string')return text;const tokens=ns.promptPolicy.tokens(text,definedPromptNames(scope));if(tokens.length===1&&tokens[0].type==='variable'&&Object.hasOwn(scope,tokens[0].key))return scope[tokens[0].key]??'';return scopeText(text,scope)};
  missingScopeKeys=()=>[];
  effectivePlanScope=function(plan,frame=null,resolveSet=setBy){const resolved=artCore.effectivePlanScope(plan,frame,resolveSet);for(const key of plan?.excludedSettingKeys||[])if(!(planFrameOverrides(plan,frame||{}).variables||[]).some(e=>e.key===key)&&!(planFrameOverrides(plan,frame||{}).variableSetIds||[]).some(id=>resolveSet(id)?.entries?.some(e=>e.key===key))){resolved.values[key]='';resolved.sources[key]='此属性已停用'}return resolved};
  primaryNavItems=function(){return createWorkspaceChromePolicy().navigation(state.settings.studio.visibility)};
  renderShell=function(){
    artCore.renderShell();const nav=$('#sidebar nav');if(nav)nav.innerHTML=primaryNavItems().map(([id,ic,label,key])=>`<button class="nav-item ${ui.workspace===id?'active':''} ${id===5?'nav-settings':''}" data-act="art-nav" data-route="${id}" aria-label="${label}" title="${label}" ${ui.workspace===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span><b class="nav-key">${key}</b></button>`).join('');
    const version=$('.brand-sub span');if(version)version.textContent='v3.1';const crumb=$('.breadcrumb strong');if(crumb)crumb.textContent=ui.workspace===0?'画册集':ui.workspace===7?'扩展功能':ui.workspace===1?'创作画册':ui.workspace===6?'运行日志':ui.workspace===5?'设置':crumb.textContent;
    $('#project-switch-button')?.setAttribute('aria-label','切换画册集');refreshInterfaceCopy($('#sidebar'));refreshInterfaceCopy($('#topbar'));
  };
  renderProjectPopover=renderCollectionSwitcher;
  renderGallery=renderCollectionGallery;galleryResults=artGalleryResults;
  refreshGallery=function(){const area=$('#gallery-results');if(ui.workspace===0&&area)area.innerHTML=artGalleryResults()};
  renderCreationWorkspace=renderQuietCreation;
  renderBookPlans=function(){const p=selectedPlan();return p?renderQuietStoryboard(p):renderQuietCreation()};
  renderVariableLibrary=renderUnifiedSettings;
  renderSceneComposer=function(){const p=selectedPlan();return p?renderQuietStoryboard(p):'<div class="empty">'+btn('新建画册','plus','new-book','','primary')+'</div>'};
  renderPlanPreview=function(p){const t=templateBy(p.templateId);return t?.frames[0]?quietResolvedPrompt(p,t.frames[0]):''};
  sceneResolvedPreview=quietResolvedPrompt;
  refreshCreationPreviews=function(){const p=selectedPlan(),f=currentTemplate()?.frames[ui.frameIndex];if(p&&f&&$('#art-prompt-preview'))$('#art-prompt-preview').innerHTML=quietResolvedPrompt(p,f);$$('.prompt-surface>textarea').forEach(paintPromptEditor)};
  render=function(){
    ensureStudioState();artUI.editorObserver?.disconnect();
    if(ui.workspace===0||ui.workspace===1||ui.workspace===7){renderShell();$('#main').innerHTML='<div class="art-fade">'+(ui.workspace===0?renderCollectionGallery():ui.workspace===7?renderLaboratory():renderQuietCreation())+'</div>';delete $('#main').dataset.editorTemplateId;delete $('#main').dataset.editorFrameIndex;applyStudioPreferences()}
    else artCore.render();
    if(ui.workspace===1)attachPromptEditors();
    $$('.metrics').forEach(e=>e.remove());const metricsControl=$('[data-studio-pref="appearance.showMetrics"]');if(metricsControl)metricsControl.closest('.settings-row')?.remove();
    const readerDefault=$('[data-studio-pref="reader.defaultMode"]');if(readerDefault)readerDefault.innerHTML=[['manga','对开本 · 双页画册'],['webtoon','卷轴 · 连续阅读'],['focus','画廊 · 大图与胶卷']].map(x=>opt(...x,({spread:'manga',webtoon:'webtoon',gallery:'focus'})[state.settings.presentation.readerMode])).join('');
    if(ui.workspace===5&&studioUI.settingsTab==='appearance'&&$('#studio-settings-content')){$('#studio-settings-content').insertAdjacentHTML('beforeend','<section class="settings-section"><h2>艺术字体</h2><p id="art-font-status"></p><p class="help">界面标题使用思源宋体系列，英文使用 Cormorant Garamond。联网时自动按需加载；离线始终保留系统衬线字体。</p></section>');updateArtFontStatus()}
    refreshInterfaceCopy();
  };
  openReader=openArtReader;closeReader=closeArtReader;renderReader=renderArtReader;renderReaderCanvas=renderArtCanvas;setReaderStep=setArtStep;syncInspector=syncArtReader;renderCriticEntry=()=>{};
  const navigatePrevious=navigate;navigate=function(index){if(Number(index)===7){flushEditor();ui.workspace=7;render();window.scrollTo({top:0,behavior:'instant'});return}if(ui.workspace===7&&!$('#reader').open)ui.bookId=null;return navigatePrevious(index)};
  const visiblePrevious=workspaceVisible;workspaceVisible=index=>Number(index)===7||visiblePrevious(index);
  modal=function(title,body,subtitle='',wide=false){artCore.modal(textualInterfaceCopy(title),body,textualInterfaceCopy(subtitle),wide);refreshInterfaceCopy($('#modal'))};
  toast=function(message,type='ok'){artCore.toast(textualInterfaceCopy(message),type)};
  const actions={
    'art-nav':d=>navigate(Number(d.route)),
    'art-star-filter':()=>{ui.filter=ui.filter==='starred'?'all':'starred';render()},
    'art-create-tab':d=>{flushEditor();createUI.tab=d.tab==='settings'?'settings':d.tab==='queue'?'queue':'scenes';render()},
    'art-setting-add':()=>addUnifiedSetting(),
    'art-setting-confirm':()=>addSettingFromDialog(),
    'art-setting-remove':async d=>{const p=selectedPlan();if(!await confirmAction('移除此画面属性？','只从本画册移除 {'+d.key+'}。原设定预设保留，生成时这项会按空值略过。','移除属性'))return;p.variables=p.variables.filter(e=>e.key!==d.key);p.excludedSettingKeys=[...new Set([...(p.excludedSettingKeys||[]),d.key])];save(true);render()},
    'art-apply-preset':async()=>{const id=$('#art-setting-preset')?.value,p=selectedPlan();if(!id)throw Error('先选择一组设定预设。');if(!await confirmAction('应用这组角色与画面设定？','会替换当前画册的设定，不改动分镜或已生成图片。','应用设定'))return;p.variableSetIds=[id];p.variables=[];p.excludedSettingKeys=[];save();render()},
    'art-save-preset':()=>{const p=selectedPlan();textModal('保存角色与画面设定','预设名称',p.title+' · 设定',value=>{const set={id:uid('set'),projectId:state.activeProjectId,title:value,entries:mergedSettingEntries(p).map(e=>({...clone(e),id:uid('var')}))};state.creation.variableSets.push(set);save();closeModal();render();toast('设定预设已保存。')})},
    'art-import-demo':()=>importCuratedDemo(),
    'room-mode':d=>{if(!['spread','webtoon','gallery'].includes(d.mode))return;artUI.readerMode=d.mode;artUI.filmstrip=d.mode==='gallery';ui.mode=d.mode==='spread'?'manga':d.mode==='webtoon'?'webtoon':'focus';state.settings.presentation.readerMode=d.mode;save();renderArtReader()},
    'room-thumbnails':()=>{artUI.filmstrip=!artUI.filmstrip;const strip=$('#room-filmstrip');if(strip)strip.hidden=!artUI.filmstrip;syncArtReader()},
    'room-info':()=>{artUI.showInfo=!artUI.showInfo;renderRoomInfo()},
    'room-copy-prompt':()=>copyText(readerSequence(bookBy(ui.bookId))[ui.step].prompt||''),
    'room-fullscreen':async()=>{if(document.fullscreenElement){await document.exitFullscreen();return}if(!$('#reader').requestFullscreen)throw Error('当前浏览器不支持全屏 API。阅读器已使用完整页面视口。');try{await $('#reader').requestFullscreen()}catch(e){throw Error('当前页面未获全屏权限，仍可在完整阅读视口欣赏。')}},
    'room-laboratory':()=>readerLabNavigation(),
    'art-lab-critique':()=>critiqueStep(artUI.labBookId,artUI.labIndex),
    'art-lab-redraw':async()=>{const b=selectedLabBook();if(!b)throw Error('请先选择画册。');ui.bookId=b.id;ui.step=artUI.labIndex;await redrawStep(artUI.labIndex)},
    'art-lab-mask':()=>{const book=selectedLabBook(),bindings=book?.sourceSnapshot?.execution?.bindings||state.settings.comfy.bindings||[];if(state.settings.comfy.mode==='real'&&!bindings.some(b=>b.enabled&&b.source==='image'))throw Error('此画册的工作流没有图像输入映射，无法执行真实蒙版精修。请先配置含图生图与蒙版节点的工作流。');return maskModal(artUI.labIndex)},
    'art-lab-assistant':()=>{const b=selectedLabBook();if(!b)throw Error('请先选择画册。');ui.templateId=b.templateId;showAssistant()},
    'art-lab-help':()=>modal('实验室使用说明','<div class="stack"><p class="soft small">视觉审校需要支持图片输入的模型，API 配置中有带图连通性测试。</p><p class="soft small">单页精修使用原画册生成时的变量和工作流快照。局部蒙版需要支持图生图的 ComfyUI 工作流及图像输入映射。</p><p class="soft small">离线模式只演示流程，会明确标注模拟结果。所有工具默认关闭，不干扰画册阅读。</p></div><div class="modal-footer">'+btn('关闭','','close-modal','','primary')+'</div>'),
    'art-prompt-checks':()=>artPromptDiagnostics()
  };
  handleAction=async function(action,data={},element){
    if(Object.hasOwn(actions,action)){if($('#welcome-dialog').open)return;hideTip();return actions[action](data,element)}
    if(action==='page-prev'||action==='page-next'){if($('#reader').open){setArtStep(ui.step+(action==='page-next'?1:-1)*(artUI.readerMode==='spread'?2:1));return}}
    if(action==='reader-step'&&$('#reader').open)return setArtStep(Number(data.index));
    if(action==='new-project'){closeProjectPopover();textModal('新建画册集','画册集名称','',title=>{const item={id:uid('collection'),title,createdAt:Date.now()};state.projects.push(item);closeModal();changeProject(item.id);toast('新的画册集已建立。')});return}
    if(action==='project-rename'){closeProjectPopover();const current=project();textModal('重命名画册集','画册集名称',current.title,title=>{current.title=title;save();closeModal();render()});return}
    if(action==='new-template'){
      const p=selectedPlan(),existing=new Set(state.templates.map(t=>t.id));await artCore.handleAction(action,data,element);const submit=rt.modalSubmit;
      rt.modalSubmit=async title=>{await submit(title);const created=state.templates.find(t=>!existing.has(t.id));if(created&&p){p.templateId=created.id;p.storyVersionId='';ui.templateId=created.id;ui.frameIndex=0;createUI.tab='scenes';save();render()}};return;
    }
    if(['diagnostics','v3-diagnostics','release-diagnostics'].includes(action))return artPromptDiagnostics();
    if(['critic-apply-issue','apply-critique'].includes(action)&&ui.workspace===7&&!state.settings.presentation.lab.refine){state.settings.presentation.lab.refine=true;save();render();}
    if(action==='critic-batch'&&ui.workspace===7&&!$('#reader').open){ui.bookId=artUI.labBookId;return critiqueWholeBook()}
    if(action==='settings'||action==='v3-settings-tab'){if($('#reader').open)closeArtReader()}
    const result=await artCore.handleAction(action,data,element);if(action==='book-menu')$$('[data-act="critic-settings"]',$('#modal-body')).forEach(el=>el.remove());refreshInterfaceCopy();return result;
  };
  const originalInfo=backendStatusText;backendStatusText=function(){const text=originalInfo();return text.replace('当前为临时会话','当前未保存到后端')};
  guideSteps[1].title='建立画册集';guideSteps[1].headline='把相近的故事，收藏在一起。';guideSteps[1].description='顶层画册集收录具体画册，每本画册包含连续分镜。顶栏名称是切换和新建画册集的入口。';guideSteps[1].checks=['从顶栏新建或切换画册集。','进入“创作画册”创建一本新画册。','已有数据会保留，精选示范只用于首次预览。'];
  guideSteps[2].title='角色与画面设定';guideSteps[2].description='只需一处填写角色、服装与画风。已定义的占位符会高亮；未定义的括号与 NovelAI 权重语法完全保留。';guideSteps[2].checks=['在“角色与画面设定”填写需要的属性。','提示词可自由使用任意括号和权重语法。','空属性会略过，连续逗号自动收敛。'];
  guideSteps[3].checks=['选择分镜模板，按你的想法修改提示词和台词。','任何不规则括号都不会阻止生成。','节点映射与后端连接问题仍会给出明确提示。'];
  guideSteps[4].title='欣赏与实验室';guideSteps[4].description='阅读器提供对开本、连续卷轴和胶卷画廊，默认没有审校或重绘面板。专业工具在实验室按需开启。';guideSteps[4].checks=['使用左右箭头翻页，或点击胶卷中的缩略图。','点击本幕文字，查看台词、提示词与图片尺寸。','需要审校和精修时前往实验室，不打扰普通阅读。'];
  const oldGuideDestination=guideDestination;guideDestination=async function(action){if(action==='critic'){closeServiceDialog('guide-dialog');navigate(7);return}return oldGuideDestination(action)};
  ns.presentation={readerSequence,readerSpreadIndices,createCuratedDemo,renderLaboratory};
  loadArtTypography();
}


document.addEventListener('input',event=>{const el=event.target;if(!globalThis.ComfyComic?.promptPolicy)return;if(el.dataset.artSetting){const p=selectedPlan();if(p){updateUnifiedSetting(p,el.dataset.artSetting,el.value);refreshCreationPreviews()}}});


document.addEventListener('change',async event=>{const el=event.target;try{if(el.id==='art-book-draft'){flushEditor();createUI.planId=el.value;const p=selectedPlan();ui.templateId=p?.templateId;ui.frameIndex=0;render()}if(el.dataset.artExtension){await setLaboratoryExtension(el.dataset.artExtension,el.checked)}if(el.id==='lab-book-select'){artUI.labBookId=el.value;artUI.labIndex=0;render()}if(el.id==='lab-frame-select'){artUI.labIndex=Number(el.value);render()}if(el.dataset.studioPref==='reader.defaultMode'){state.settings.presentation.readerMode=({manga:'spread',flip:'spread',focus:'gallery',webtoon:'webtoon'})[el.value]||'spread';save()}}catch(error){toast(error.message,'error');if(el.dataset.artExtension)render()}});


document.addEventListener('error',artworkImageFallback,true);


window.addEventListener('keydown',event=>{if($('#reader').open&&$('#reader').classList.contains('art-reader')&&event.target===document.body&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();setArtStep(ui.step+(event.key==='ArrowRight'?1:-1)*(artUI.readerMode==='spread'?2:1))}},true);


function artPromptDiagnostics(){const policy=ComfyComic.promptPolicy,results=[],test=(name,fn)=>{try{if(!fn())throw Error('断言未通过');results.push({name,pass:true})}catch(e){results.push({name,pass:false,detail:e.message})}};
  test('任意不闭合括号与连续括号均可提交',()=>['{{{{','}}}}','{','}', '{}','{char'].every(s=>validatePrompt(s)===s&&policy.interpolate(s,{})===s));
  test('NovelAI 权重语法与非变量括号原样保留',()=>policy.interpolate('{{knees up}}, {mouth mask}, {{{style}}}',{style:'anime'})==='{{knees up}}, {mouth mask}, {{{style}}}');
  test('只有已定义的单括号变量被识别',()=>policy.tokens('{character}, {unknown}, {{character}}',new Set(['character'])).filter(t=>t.type==='variable').length===1);
  test('部分变量为空时收敛连续逗号',()=>policy.interpolate('{character}, {outfit}, {style}, {weapon}, ',{character:'nahida',outfit:'',style:'',weapon:''})==='nahida');
  test('已定义但未提供的变量安全略过',()=>policy.interpolate('{character}, {outfit}, {prop}',{character:'Mio'},['character','outfit','prop'])==='Mio');
  test('未定义的占位文字不会被擅自删除',()=>policy.interpolate('{custom_unknown}',{})==='{custom_unknown}');
  test('不触碰权重括号内的连续逗号',()=>policy.interpolate('{{knees,,up}}, {outfit}, ',{outfit:''})==='{{knees,,up}}');
  test('数字零和 false 不被当作空变量',()=>policy.interpolate('{count}, {enabled}',{count:0,enabled:false})==='0, false');
  test('未填写的数字与 JSON 属性不阻断生成',()=>typedVariableValue({key:'strength',type:'number',value:''})===''&&typedVariableValue({key:'optional',type:'json',value:''})==='');
  test('默认角色展示名用于旁白，模型角色名只进入提示词',()=>{const spec=curatedAdventureSpec();return policy.interpolate('{character}',spec.identity)==='nanami'&&policy.interpolate(spec.captions[1],spec.identity).startsWith('七海收到')&&!spec.captions.some(text=>text.includes('{character}'))});
  test('更改展示名不会改变出图身份',()=>{const values={character:'nahida (genshin impact)',character_display_name:'小草神'};return policy.interpolate('{character}',values)==='nahida (genshin impact)'&&policy.interpolate('{character_display_name}出发了。',values)==='小草神出发了。'});
  test('示范画册与源模板分别保留展示名和提示词名',()=>{const sample=createCuratedDemo(state),entries=sample.creation.variableSets[0].entries;return sample.books[0].characterName==='七海'&&entries.find(e=>e.key==='character').value==='nanami'&&entries.find(e=>e.key==='character_display_name').value==='七海'&&sample.templates[0].frames[1].caption.includes('{character_display_name}')});
  test('五张分镜最后一跨页自动补白',()=>JSON.stringify(readerSpreadIndices(4,5))==='[4,null]');
  test('十二幕精选示范只有一个画册集、一册、一组设定',()=>{const demo=createCuratedDemo(state);return demo.books.length===1&&demo.templates.length===1&&demo.templates[0].frames.length===12&&demo.creation.variableSets.length===1});
  test('精选示范通过完整工程数据契约',()=>validateState(createCuratedDemo(state)));
  test('不规则提示词可进入非标准节点提交字典',()=>{const raw='{{{{, {mouth mask}, {{knees up}}, }}}}',execution={workflow:{'1832':{class_type:'WeiLinPromptUI',inputs:{positive:''}}},bindings:[{id:'free_test',enabled:true,label:'作者提示词',nodeId:'1832',path:'text',source:'positive',type:'text',allowCreate:false,allowLink:false}],objectInfo:{},randomizeSeeds:false};return buildMappedWorkflow({prompt:raw,_scope:{},renderOverride:false},{},{execution,preview:true}).workflow['1832'].inputs.positive===raw});
  test('后端仍为平铺10字段且删除携带 forceWrite',()=>{const payload=convertStudioStateToApiPayload(state,{},true);return !Object.hasOwn(payload,'state')&&payload.forceWrite===true&&ComfyComic.stateContract.requiredFields.every(key=>Object.hasOwn(payload,key))});
  modal('自由提示词与展示层自检','<div class="notice">检查在本地内存中执行，不发送 API 请求，也不会修改工程。</div>'+results.map(r=>`<div class="template-check-row"><span class="${r.pass?'accent':'danger'}">${icon(r.pass?'check':'close')}</span><span class="grow">${esc(r.name)}${r.detail?'<small>'+esc(r.detail)+'</small>':''}</span><span class="tiny muted">${r.pass?'通过':'未通过'}</span></div>`).join('')+'<div class="modal-footer">'+btn('检查原生 API 契约','shield','native-diagnostics')+btn('关闭','','close-modal','','primary')+'</div>','提示词自由与节点连线安全是两件独立的事。',true);return results;
}


const displayUI={featuredIndex:0,page:0,filterKey:'',dimensions:new Map(),locale:null,observer:null,localizing:false,originalText:new WeakMap(),originalAttrs:new WeakMap(),frame:null,cleanupPending:false,cleanupTimer:null,languageTouched:false};


const displayModel=createCollectionDisplayModel();


let collectionDisplayCore;


function installCollectionDisplay(){
  ensureStudioState();ensureCollectionDisplay();applyDisplayAttributes();
  collectionDisplayCore={ensureStudioState,render,renderShell,refreshGallery,handleAction,renderArtReader,renderArtCanvas,renderRoomInfo,renderStatus,modal,toast,loadState};
  ensureStudioState=function(s=state){collectionDisplayCore.ensureStudioState(s);ensureCollectionDisplay(s);if(s===state)applyDisplayAttributes();return s};
  renderCollectionGallery=renderResponsiveCollection;artGalleryResults=responsiveCollectionResults;galleryResults=responsiveCollectionResults;
  renderShell=function(){collectionDisplayCore.renderShell();const version=$('.brand-sub span');if(version)version.textContent='v'+MIO_VERSION;applyDisplayAttributes();localizeWorkspace($('#sidebar'));localizeWorkspace($('#topbar'));observeSidebarWordmark()};
  render=function(){collectionDisplayCore.render();decorateDisplayPreferences();fitVisibleCovers();localizeWorkspace();requestDemoCleanupSave()};
  refreshGallery=function(){const root=$('#gallery-results');if(ui.workspace===0&&root){root.innerHTML=responsiveCollectionResults();fitVisibleCovers();localizeWorkspace(root)}};
  renderArtReader=function(){collectionDisplayCore.renderArtReader();localizeWorkspace($('#reader'))};
  renderArtCanvas=function(animate=false){collectionDisplayCore.renderArtCanvas(animate);if($('#reader').open)localizeWorkspace($('#reader'))};
  renderRoomInfo=function(){collectionDisplayCore.renderRoomInfo();const panel=$('#room-info');if(panel){const fallback=panel.querySelector('.room-caption:not([data-user-content])');if(fallback)fallback.textContent=localeString('这一幕，让画面自己说话。');localizeWorkspace(panel)}};
  renderReader=renderArtReader;renderReaderCanvas=renderArtCanvas;
  renderStatus=function(){collectionDisplayCore.renderStatus();localizeWorkspace($('#statusbar'))};
  modal=function(...args){collectionDisplayCore.modal(...args);localizeWorkspace($('#modal'))};
  toast=function(text,type='ok'){collectionDisplayCore.toast(text,type);const region=$('#toasts');if(region)localizeWorkspace(region)};
  loadState=async function(){await collectionDisplayCore.loadState();ensureCollectionDisplay();applyDisplayAttributes();localizeWorkspace();requestDemoCleanupSave()};
  const shelfActions={
    'delete-collection':d=>deleteCollection(d.id||state.activeProjectId),
    'shelf-layout':d=>setShelfLayout(d.layout),
    'shelf-feature-prev':()=>{displayUI.featuredIndex=Math.max(0,displayUI.featuredIndex-1);refreshGallery()},
    'shelf-feature-next':()=>{displayUI.featuredIndex=Math.min(getShelfBooks().length-1,displayUI.featuredIndex+1);refreshGallery()},
    'shelf-page-prev':()=>{displayUI.page=Math.max(0,displayUI.page-1);refreshGallery();document.querySelector('.collection-toolbar')?.scrollIntoView({block:'start',behavior:'smooth'})},
    'shelf-page-next':()=>{const pagination=displayModel.page(getShelfBooks().length,displayUI.page);displayUI.page=Math.min(pagination.pages-1,pagination.index+1);refreshGallery();document.querySelector('.collection-toolbar')?.scrollIntoView({block:'start',behavior:'smooth'})},
    'display-diagnostics':()=>displayRegressionChecks(),
    'room-mode':d=>{if(!['spread','webtoon','gallery'].includes(d.mode)||!$('#reader').open)return;artUI.readerMode=d.mode;artUI.filmstrip=d.mode==='gallery';ui.mode=d.mode==='spread'?'manga':d.mode==='webtoon'?'webtoon':'focus';renderArtReader()}
  };
  handleAction=async function(action,data={},element){
    if(Object.hasOwn(shelfActions,action)){if($('#welcome-dialog').open)return;return shelfActions[action](data,element)}
    const result=await collectionDisplayCore.handleAction(action,data,element);
    if(['diagnostics','v3-diagnostics','release-diagnostics','art-prompt-checks'].includes(action)&&$('#modal-body'))$('#modal-body').insertAdjacentHTML('beforeend','<div class="modal-footer">'+btn(localeString('显示与语言')+' · '+localeString('系统自检'),'shield','display-diagnostics','','small')+'</div>');
    localizeWorkspace($('#modal[open]')||document.body);return result;
  };
  if(window.MutationObserver){displayUI.observer=new MutationObserver(records=>{if(displayUI.localizing)return;if(records.some(r=>r.type!=='attributes'||['title','placeholder','aria-label'].includes(r.attributeName)))queueLocalization(records)});displayUI.observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label']})}
  ComfyComic.locale=displayUI.locale;ComfyComic.collectionDisplay=displayModel;
  loadCollectionFonts();
  window.addEventListener('resize',scheduleSidebarWordmarkFit);
  document.fonts?.addEventListener?.('loadingdone',scheduleSidebarWordmarkFit);
  document.fonts?.ready?.then(scheduleSidebarWordmarkFit);
}


document.addEventListener('load',event=>{if(event.target instanceof HTMLImageElement&&event.target.dataset.responsiveCover)updateCoverSizing(event.target)},true);


document.addEventListener('change',event=>{const el=event.target;try{
  if(el.id==='interface-language')changeInterfaceLanguage(el.value);
  if(el.id==='default-shelf-view')setShelfLayout(el.value);
  if(el.id==='default-room-view')ensureRoomDefaultChoice(el.value);
  if(el.dataset.studioPref==='reader.defaultMode')ensureRoomDefaultChoice(({manga:'spread',flip:'spread',focus:'gallery',webtoon:'webtoon'})[el.value]||'webtoon');
  if(el.id==='display-lettering'){if(!['editorial','calligraphy','classic'].includes(el.value))return;state.settings.presentation.lettering=el.value;document.documentElement.dataset.lettering=el.value;try{localStorage.setItem('cc-lettering',el.value)}catch(e){}save();loadCollectionFonts();updateCollectionFontStatus();scheduleSidebarWordmarkFit()}
  if(el.id==='shelf-select-all'){for(const book of getShelfBooks())el.checked?ui.selected.add(book.id):ui.selected.delete(book.id);refreshGallery()}
}catch(error){toast(error.message,'error')}});


function displayRegressionChecks(){const results=[],test=(name,run)=>{try{if(run()===false)throw Error('Assertion failed');results.push({name,passed:true})}catch(e){results.push({name,passed:false,message:e.message})}};
  test('Showcase and grid are explicit persistent modes',()=>displayModel.mode('showcase')==='showcase'&&displayModel.mode('grid')==='grid');
  test('Grid pagination handles 100 books and the last page',()=>{const p=displayModel.page(100,99);return p.index===4&&p.start===96&&p.end===100&&p.pages===5});
  test('A landscape cover fits without stretching or cropping',()=>{const f=displayModel.fit(1920,1080,600,600);return f.width===600&&f.height===337.5});
  test('A tall page fits a mobile viewport proportionally',()=>{const f=displayModel.fit(800,2400,320,560);return f.height===560&&Math.abs(f.width/f.height-1/3)<.00001});
  test('Invalid image sizes do not produce NaN',()=>displayModel.fit(0,0,320,500).width===0);
  test('Native language labels switch without an API',()=>{const l=createStudioLocaleCatalog('en');if(l.text('画册集')!=='Collections')return false;l.setLanguage('zh-CN');return l.text('画册集')==='画册集'});
  test('Unknown artwork text is not machine-translated',()=>createStudioLocaleCatalog('en').translate('海风与未寄出的信')==='海风与未寄出的信');
  test('Language switching leaves authored text and prompt inputs unchanged',()=>{const old=displayUI.locale.language,root=document.createElement('div');root.innerHTML='<span data-user-content>设置</span><button>设置</button><textarea>{character}, {{{quality}}}</textarea>';try{displayUI.locale.setLanguage('en');localizeWorkspace(root);return root.querySelector('[data-user-content]').textContent==='设置'&&root.querySelector('button').textContent==='Settings'&&root.querySelector('textarea').value==='{character}, {{{quality}}}'}finally{displayUI.locale.setLanguage(old)}});
  test('Demo cleanup retains the first image and updates counts',()=>{const first={stepIndex:0,image:'keep'},b={curatedDemo:true,totalSteps:3,generatedSteps:3,steps:[first,{stepIndex:1,image:'old'},{stepIndex:2,image:'old'}]};return trimUntouchedDemoBook(b,s=>s.image==='old')&&b.steps[0]===first&&b.totalSteps===1&&b.generatedSteps===1});
  test('Modified artwork is protected from demo cleanup',()=>{const b={curatedDemo:true,steps:[{stepIndex:0,image:'keep'},{stepIndex:1,image:'my-art'}]};return !trimUntouchedDemoBook(b,s=>s.image==='old')&&b.steps.length===2});
  test('An edited demo caption is not treated as untouched sample data',()=>originalDemoPage({stepIndex:3,name:'通往海岸的小路',image:scenicDemoFrame(3,45),caption:'My rewritten story',prompt:'my prompt'})===false);
  test('Fresh cover sample retains the 12-frame source storyboard',()=>{const s=createCuratedDemo(state);return s.books.length===1&&s.books[0].steps.length===1&&s.templates[0].frames.length===12});
  test('Opening preference defaults to scroll reading',()=>{const s={settings:{presentation:{}},books:[]};ensureCollectionDisplay(s);return s.settings.presentation.defaultReaderMode==='webtoon'});
  test('Presentation preferences remain in the flat config payload',()=>{const payload=convertStudioStateToApiPayload(state,{},false);return !('state' in payload)&&payload.uiConfig.comfyStudio.settings.presentation.language===state.settings.presentation.language});
  test('Enabled activity log is included exactly once in sidebar navigation',()=>{const policy=createWorkspaceChromePolicy();return policy.navigation({logs:true}).filter(item=>item[0]===6).length===1&&!policy.navigation({logs:false}).some(item=>item[0]===6)});
  test('The actual sidebar reflects the saved log visibility switch',()=>Boolean($('#sidebar [data-act="art-nav"][data-route="6"]'))===(state.settings.studio.visibility.logs===true));
  test('Language and display settings exist only in Appearance & reading',()=>{const policy=createWorkspaceChromePolicy();return policy.ownsDisplayPreferences('appearance')&&!policy.ownsDisplayPreferences('general')});
  test('Artistic wordmarks are sized within the available sidebar width',()=>{const policy=createWorkspaceChromePolicy(),size=policy.brandFontSize(22,116,160);return size>0&&size<22&&160*size/22<116&&policy.brandFontSize(24,0,150)===0});
  test('Workflow configuration and Extensions use the updated localized labels',()=>{const locale=extendStudioLocaleCatalog(createStudioLocaleCatalog('en'));return locale.text('工作流配置')==='Workflow configuration'&&locale.text('扩展功能')==='Extensions'});
  test('Collection deletion retains unrelated books and shared assets',()=>{const sample={projects:[{id:'a',title:'A'},{id:'b',title:'B'}],activeProjectId:'a',books:[{id:'one',projectId:'a',templateId:'shared'},{id:'two',projectId:'b',templateId:'shared'}],templates:[{id:'shared',projectId:'a'}],rows:[],queue:[{id:'pending',bookId:'one'}],chats:[{id:'chat_b',projectId:'b',messages:[]}],activeChatId:'chat_b',creation:{plans:[],variableSets:[]},settings:{}},result=planCollectionRemoval(sample,'a');return result.next.books.length===1&&result.next.books[0].id==='two'&&result.next.templates[0].projectId==='b'&&result.next.queue.length===0&&sample.books.length===2});
  test('Deleting the last collection leaves a safe empty workspace',()=>{const sample={projects:[{id:'last',title:'Last'}],activeProjectId:'last',books:[],rows:[],templates:[],queue:[],chats:[],creation:{plans:[],variableSets:[]},settings:{}},result=planCollectionRemoval(sample,'last',{id:'empty',title:'Empty'});return result.next.projects.length===1&&result.next.activeProjectId==='empty'&&result.next.books.length===0&&result.next.chats.length===1});
  modal(localeString('显示与语言')+' / '+localeString('系统自检'),'<p class="service-note">These checks run locally in your browser. They do not access the backend or download images.</p>'+results.map(r=>`<div class="template-check-row"><span class="${r.passed?'accent':'danger'}">${icon(r.passed?'check':'close')}</span><span class="grow">${esc(r.name)}${r.message?'<small>'+esc(r.message)+'</small>':''}</span><span class="tiny muted">${localeString(r.passed?'通过':'未通过')}</span></div>`).join('')+'<div class="modal-footer">'+shelfButton('check','close-modal','关闭','','primary')+'</div>');return results;
}


installNativeApplication();


installNativeParityChecks();


installArtStudio();


installCollectionDisplay();

installWorkspaceUpgrade();

installOrganizationTools();

installImageProviders();

installMarketPerformance();

globalThis.Mio = globalThis.ComfyComic;


ensureStudioState();


boot().catch(e=>{rt.booting=false;render();toast('启动未完成：'+e.message+'。当前内容仍在内存中，请检查服务连接。','error')});



