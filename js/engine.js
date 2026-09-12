/* Mio development module: engine. */
'use strict';

async function request(url,options={},timeout=15000){const ctrl=new AbortController(),signal=options.signal,abort=()=>ctrl.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)ctrl.abort();const t=setTimeout(()=>ctrl.abort(),timeout);try{const r=await fetch(url,{...options,signal:ctrl.signal});if(!r.ok){const text=await r.text();throw Error('HTTP '+r.status+': '+text)}if(r.status===204||r.status===205)return r;const body=await r.arrayBuffer();return new Response(body,{status:r.status,statusText:r.statusText,headers:r.headers})}finally{clearTimeout(t);signal?.removeEventListener('abort',abort)}}


async function testEngine(silent=false){if(state.settings.comfy.mode==='mock'){rt.connected=false;rt.latency=null;rt.vram=null;if(!silent)toast('离线 SVG 引擎已就绪，无需 GPU。');return true}const start=performance.now();try{const data=await(await request(baseURL()+'/system_stats',{},5000)).json();rt.latency=Math.round(performance.now()-start);const gpu=data.devices?.[0];rt.vram=gpu?.vram_total?Math.round((1-gpu.vram_free/gpu.vram_total)*100):null;rt.connected=true;connectWS();renderShell();if($('#connection-result'))$('#connection-result').textContent='已连接 · '+rt.latency+' ms'+(rt.vram!==null?' · VRAM '+rt.vram+'%':'');if(!silent)toast('ComfyUI 连接成功，延迟 '+rt.latency+' ms');return true}catch(e){rt.connected=false;renderShell();if(!silent)toast('连接失败：确认服务地址与 --enable-cors-header。','error');return false}}


function connectWS(){if(state.settings.comfy.mode!=='real'||rt.ws?.readyState===0||rt.ws?.readyState===1)return;try{const u=new URL(baseURL());u.protocol=u.protocol==='https:'?'wss:':'ws:';u.pathname=u.pathname.replace(/\/$/,'')+'/ws';u.searchParams.set('clientId',rt.clientId);const ws=new WebSocket(u);rt.ws=ws;ws.onopen=()=>{rt.connected=true;rt.reconnectAttempts=0;renderShell()};ws.onmessage=e=>{if(typeof e.data!=='string')return;try{const m=JSON.parse(e.data);rt.lastHeartbeat=Date.now();if(m.type==='progress'){rt.frameProgress=m.data.value/m.data.max;if($('#queue-list'))$('#queue-list').innerHTML=queueHTML()}if(m.type==='execution_error')log('GPU 执行错误：'+(m.data.exception_message||'未知错误'),'error')}catch(x){}};ws.onerror=()=>{};ws.onclose=()=>{if(rt.ws!==ws)return;rt.connected=false;rt.ws=null;if(state.settings.comfy.mode==='real'){clearTimeout(rt.reconnect);rt.reconnect=setTimeout(connectWS,Math.min(30000,1000*2**(rt.reconnectAttempts||0)));rt.reconnectAttempts=(rt.reconnectAttempts||0)+1}renderShell()}}catch(e){log('WebSocket 地址无效','error')}}


function resetWS(){clearTimeout(rt.reconnect);const ws=rt.ws;rt.ws=null;ws?.close();rt.connected=false;if(state.settings.comfy.mode==='real')connectWS()}


function validateWorkflow(w){if(!w||Array.isArray(w)||w.nodes||!Object.keys(w).length||Object.values(w).some(n=>!n||typeof n.class_type!=='string'||!n.inputs||Array.isArray(n.inputs)))throw Error('请导入 ComfyUI「导出 API」格式：以 Node ID 为键的扁平节点字典，不是 UI 工作流。');return w}


function randomSeeds(value){if(!value||typeof value!=='object')return;for(const k of Object.keys(value)){if(/(^|_)seed$/i.test(k)&&!Array.isArray(value[k]))value[k]=Math.floor(Math.random()*Number.MAX_SAFE_INTEGER);else if(typeof value[k]==='object')randomSeeds(value[k])}}


async function blobData(blob){return new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result);f.onerror=()=>reject(f.error);f.readAsDataURL(blob)})}


async function imageData(src){if(src.startsWith('data:')&&src.includes(';base64,'))return src;return blobData(await(await request(src,{},15000)).blob())}


async function realFrame(frame,row,signal,sourceImage=null){const c=state.settings.comfy,m=c.mapping,w=clone(validateWorkflow(c.workflow));randomSeeds(w);const bindText=(id,key,value)=>{if(!id||!w[id])throw Error('提示词节点未正确绑定。');const n=w[id],k=key||['text','opt_text','text_g'].find(k=>k in n.inputs);if(!k||!(k in n.inputs))throw Error('节点 #'+id+' 不存在文本字段 '+k);n.inputs[k]=value};bindText(m.positive,m.positiveField,interpolate(frame.prompt,row,frame)+(row.trigger?', '+row.trigger:''));bindText(m.negative,m.negativeField,interpolate(frame.negative||state.settings.negative,row,frame));if(m.sampler&&w[m.sampler])for(const k of ['steps','cfg','denoise'])w[m.sampler].inputs[k]=Number(frame[k]);if(m.sampler&&frame.seed>=0)w[m.sampler].inputs.seed=Number(frame.seed);if(m.size&&w[m.size]){w[m.size].inputs.width=Number(frame.width);w[m.size].inputs.height=Number(frame.height)}for(const node of Object.values(w))if(/LoraLoader/i.test(node.class_type)&&row.lora)node.inputs.lora_name=row.lora;
if(m.image&&w[m.image]&&(sourceImage||row.references?.front)){const src=sourceImage||row.references.front,data=await imageData(src),blob=await(await fetch(data)).blob(),form=new FormData();form.append('image',blob,uid('comfycomic_input')+(blob.type==='image/jpeg'?'.jpg':'.png'));form.append('overwrite','true');const result=await(await request(baseURL()+'/upload/image',{method:'POST',body:form,signal})).json();w[m.image].inputs.image=(result.subfolder?result.subfolder+'/':'')+result.name}
const submitted=await(await request(baseURL()+'/prompt',post({prompt:w,client_id:rt.clientId},signal))).json();if(!submitted.prompt_id)throw Error('工作流提交失败：'+JSON.stringify(submitted.node_errors||submitted.error));log('已提交 GPU 任务 '+submitted.prompt_id.slice(0,12));const until=Date.now()+600000;while(Date.now()<until){await delay(900,signal);const data=await(await request(baseURL()+'/history/'+encodeURIComponent(submitted.prompt_id),{signal})).json(),h=data[submitted.prompt_id];if(!h)continue;if(h.status?.status_str==='error')throw Error('GPU 节点执行失败：'+JSON.stringify(h.status.messages).slice(0,240));const outputs=h.outputs||{},images=outputs[m.output]?.images||Object.values(outputs).flatMap(o=>o.images||[]);if(images.length){const i=images[0],q=new URLSearchParams({filename:i.filename,subfolder:i.subfolder||'',type:i.type||'output'}),url=baseURL()+'/view?'+q;return{image:await blobData(await(await request(url,{signal})).blob()),offlineFallback:false,promptId:submitted.prompt_id}}if(h.status?.completed)throw Error('工作流已完成，但绑定输出节点未返回图片。')}throw Error('GPU 任务等待超过 10 分钟，请检查服务端队列。')}


function fitSVG(src,width,height){const xml=atob(src.split(',')[1]).replace('width="600" height="800"',`width="${Math.round(width)}" height="${Math.round(height)}" preserveAspectRatio="xMidYMid slice"`);return'data:image/svg+xml;base64,'+btoa(xml)}


async function generateFrame(frame,row,signal,theme=0,source=null){validatePrompt(frame.prompt);for(const[k,min,max]of[['width',256,4096],['height',256,4096],['steps',1,150],['cfg',0,30],['denoise',0,1]])if(!Number.isFinite(Number(frame[k]))||frame[k]<min||frame[k]>max)throw Error(k+' 超出允许范围 '+min+' 至 '+max);if(state.settings.comfy.mode==='real')return realFrame(frame,row,signal,source);await delay(1200,signal);const seed=frame.seed>=0?frame.seed:hash(row.id+frame.id);return{image:fitSVG(svgArt(theme,hash(interpolate(frame.prompt,row,frame)+frame.camera+seed)),frame.width,frame.height),offlineFallback:false}}


async function rasterJPEG(src,max=1280){const img=new Image();img.crossOrigin='anonymous';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{img.onload=null;img.onerror=null;img.src='';reject(Error('图像读取超时，请使用本地图片。'))},10000);img.onload=()=>{clearTimeout(timer);resolve()};img.onerror=()=>{clearTimeout(timer);reject(Error('图像跨域访问失败，请上传本地图片或允许 CORS。'))};img.src=src});const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=c.getContext('2d');ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.85)}


function autoBindWorkflow(){const c=state.settings.comfy,entries=Object.entries(c.workflow),find=pattern=>entries.find(([,n])=>pattern.test(n.class_type))?.[0]||'',texts=entries.filter(([,n])=>Object.keys(n.inputs).some(k=>['text','opt_text','text_g'].includes(k)));c.mapping={...c.mapping,positive:texts[0]?.[0]||'',negative:texts[1]?.[0]||texts[0]?.[0]||'',positiveField:texts[0]?Object.keys(texts[0][1].inputs).find(k=>['text','opt_text','text_g'].includes(k)):'text',negativeField:texts[1]?Object.keys(texts[1][1].inputs).find(k=>['text','opt_text','text_g'].includes(k)):'text',sampler:find(/KSampler/),size:find(/EmptyLatent/),output:find(/SaveImage|PreviewImage/),image:find(/^LoadImage$/)}}


function isWorkflowLink(value,workflow){return Array.isArray(value)&&value.length===2&&['string','number'].includes(typeof value[0])&&Number.isInteger(value[1])&&Object.hasOwn(workflow,String(value[0]))}


function inputPathParts(path){if(typeof path!=='string'||!path.trim())throw Error('请填写节点输入字段。');const parts=path.startsWith('/')?path.slice(1).split('/').map(x=>x.replace(/~1/g,'/').replace(/~0/g,'~')):path.split('.');if(parts.some(p=>!p||systemVariableKeys.has(p)))throw Error('输入路径含非法属性。');return parts}


function inputAt(node,path){let value=node.inputs;for(const p of inputPathParts(path)){if(value===null||typeof value!=='object'||!Object.hasOwn(value,p))return {exists:false};value=value[p]}return {exists:true,value}}


function writeInputAt(node,path,value,allowCreate=false){const parts=inputPathParts(path);let obj=node.inputs;for(const key of parts.slice(0,-1)){if(!obj[key]||typeof obj[key]!=='object'){if(!allowCreate)throw Error('输入路径不存在：'+path);obj[key]={}}obj=obj[key]}const key=parts.at(-1);if(!Object.hasOwn(obj,key)&&!allowCreate)throw Error('输入字段不存在：'+path);obj[key]=value}


function guessValueType(value){return typeof value==='number'?'number':typeof value==='boolean'?'boolean':value&&typeof value==='object'?'json':'text'}


function workflowInputEntries(node,workflow,prefix='',value=node.inputs,depth=0){if(depth>12)return[];const list=[];for(const [key,v]of Object.entries(value||{})){const path=prefix+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1');const link=isWorkflowLink(v,workflow);list.push({path,label:path.slice(1).replaceAll('/','.'),value:v,type:guessValueType(v),link});if(v&&typeof v==='object'&&!link)list.push(...workflowInputEntries(node,workflow,path,v,depth+1))}if(depth===0){const info=state.settings.comfy.objectInfo?.[node.class_type],declared={...(info?.input?.required||{}),...(info?.input?.optional||{})};for(const[key,schema]of Object.entries(declared)){if(Object.hasOwn(node.inputs,key)||!Array.isArray(schema))continue;const declaredType=schema[0],defaultValue=schema[1]?.default??(Array.isArray(declaredType)?declaredType[0]:declaredType==='BOOLEAN'?false:['INT','FLOAT'].includes(declaredType)?0:'');list.push({path:'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),label:key+' · 可选输入',value:defaultValue,type:guessValueType(defaultValue),link:false,optional:true})}}return list}


function nodeInputSchema(nodeId){const node=state.settings.comfy.workflow[nodeId],schema=state.settings.comfy.objectInfo?.[node?.class_type];return {...(schema?.input?.required||{}),...(schema?.input?.optional||{})}}


function inferTextInput(nodeId,comfy=state.settings.comfy){const node=comfy.workflow&&Object.hasOwn(comfy.workflow,nodeId)?comfy.workflow[nodeId]:null;if(!node?.inputs)return {field:'text',warning:'未找到节点 #'+nodeId+'，暂用 text。请导入蓝图或手动填写真实字段。'};const schema=comfy.objectInfo?.[node.class_type],fields=Object.keys(node.inputs).filter(k=>typeof node.inputs[k]==='string'&&!/^(ckpt_name|lora_name|filename_prefix|image|sampler_name|scheduler)$/i.test(k));const fromSchema=Object.entries({...schema?.input?.required,...schema?.input?.optional}).filter(([,v])=>Array.isArray(v)&&v[0]==='STRING').map(([k])=>k),candidates=[...new Set([...fields,...fromSchema])];if(candidates.includes('text'))return{field:'text',warning:''};if(candidates.length===1)return{field:candidates[0],warning:''};return {field:'text',warning:candidates.length?'有多个文本候选（'+candidates.join(', ')+'），无法确定，暂回退 text。请明确填写目标字段。':'没有可靠文本字段，暂回退 text。请检查自定义节点输入。'}}


function initialWorkflowBindings(comfy){const m=comfy.mapping||{},rules=[];for(const [source,label,id]of[['positive','正向提示词',m.positive],['negative','负向提示词',m.negative]])if(id){const inferred=inferTextInput(String(id),comfy);rules.push({id:uid('bind'),label,nodeId:String(id),path:inferred.field,type:'text',source,value:'',enabled:true,allowCreate:false,allowLink:false,autoField:true,warning:inferred.warning})}return rules}


function bindingRowValidity(binding){const w=state.settings.comfy.workflow,node=Object.hasOwn(w,binding.nodeId)?w[binding.nodeId]:null;if(!node)return {ok:false,text:'蓝图中不存在节点 #'+binding.nodeId+'。'};let found;try{found=inputAt(node,binding.path)}catch(e){return{ok:false,text:e.message}}if(!found.exists&&!binding.allowCreate)return{ok:false,text:'字段 '+binding.path+' 不存在；请手动更正或明确允许创建可选字段。'};if(found.exists&&isWorkflowLink(found.value,w)&&!binding.allowLink)return{ok:false,text:'这是节点连线，不是普通控件。默认不覆盖；如确需修改请在高级项明确允许。'};return {ok:true,text:'已定位 '+node.class_type+' → '+binding.path,original:found.value}}


function castBoundValue(value,type,original){let target=type==='auto'?guessValueType(original):type;if(target==='text')return value!==null&&typeof value==='object'?JSON.stringify(value):String(value??'');if(target==='number'){if(value===''||!Number.isFinite(Number(value)))throw Error('映射值不是有效数字。');return Number(value)}if(target==='boolean'){if(typeof value==='boolean')return value;if(value==='true'||value==='1'||value===1)return true;if(value==='false'||value==='0'||value===0)return false;throw Error('开关映射只接受 true / false 或 1 / 0。')}if(target==='json'){if(typeof value==='string'){try{return JSON.parse(value)}catch(e){throw Error('映射值不是有效 JSON。')}}return clone(value)}throw Error('映射类型不受支持。')}


function interpolateBoundValue(text,scope={}){if(typeof text!=='string')return text;return scopeText(text,scope)}


function buildMappedWorkflow(frame,row,options={}){
  const execution=options.execution||frame._execution||{},comfy=state.settings.comfy,workflow=clone(execution.workflow||comfy.workflow),bindings=execution.bindings||comfy.bindings,scope=frame._scope||row._scope||row,changes=[],seen=new Set();validateWorkflow(workflow);
  if(execution.randomizeSeeds??comfy.randomizeSeeds)randomSeeds(workflow);
  for(const binding of bindings){if(!binding.enabled||binding.source==='inherit'||binding.source==='sceneParameter'&&!frame.renderOverride)continue;const node=Object.hasOwn(workflow,String(binding.nodeId))?workflow[String(binding.nodeId)]:null;if(!node)throw Error('映射「'+binding.label+'」的节点 #'+binding.nodeId+' 不存在。');const info=inputAt(node,binding.path),target=String(binding.nodeId)+':'+inputPathParts(binding.path).join('/');if(seen.has(target))throw Error('同一输入存在重复启用映射：'+target);seen.add(target);
    if(!info.exists&&!binding.allowCreate)throw Error('映射「'+binding.label+'」的字段 '+binding.path+' 不存在。');
    if(info.exists&&isWorkflowLink(info.value,workflow)&&!binding.allowLink)throw Error('映射「'+binding.label+'」目标是节点连线；请保留它，或明确开启连线覆盖。');
    let value;
    switch(binding.source){
      case'positive':value=frame._resolvedImagePrompt??scopeText(frame.prompt,scope,true);break;
      case'negative':value=frame._resolvedImageNegative??resolveImageVariables(frame.prompt,scope,false,frame.negative||(execution.globalNegative??state.settings.negative)).negative;break;
      case'caption':value=scopeText(frame.caption,scope,true);break;
      case'bookTitle':value=row.bookTitle;break;
      case'sceneName':value=scopeText(frame.name,scope,true);break;
      case'variable':{const key=String(binding.value||'').replace(/^\{|\}$/g,'');checkVariableKey(key);if(!Object.hasOwn(scope,key)||scope[key]===undefined||scope[key]===null||scope[key]==='')continue;value=scope[key];if(isImageVariable(value)){value=options.uploadedImages?.[key];if(!value){if(options.preview)value='[图片变量 '+key+' 待上传]';else throw Error('图片变量 {'+key+'} 未在提示词中引用或尚未上传。')}}break}
      case'literal':value=interpolateBoundValue(binding.value,scope);break;
      case'random':value=options.preview?123456789:Math.floor(Math.random()*Number.MAX_SAFE_INTEGER);break;
      case'sceneParameter':value=frame[binding.value];if(value===undefined)throw Error('分镜参数 '+binding.value+' 不存在。');if(binding.value==='seed'&&Number(value)<0)value=options.preview?123456789:Math.floor(Math.random()*Number.MAX_SAFE_INTEGER);break;
      case'image':if(!options.uploadedImage){if(options.preview)value='[待上传的图像文件]';else continue}else value=options.uploadedImage;break;
      default:throw Error('未知映射来源 '+binding.source);
    }
    if(frame.nodeOverrides&&Object.hasOwn(frame.nodeOverrides,binding.id))value=frame.nodeOverrides[binding.id];
    value=castBoundValue(value,binding.type,info.exists?info.value:undefined);if(inputPathParts(binding.path).length===1){const schema=(execution.objectInfo||comfy.objectInfo)?.[node.class_type],rule={...(schema?.input?.required||{}),...(schema?.input?.optional||{})}[inputPathParts(binding.path)[0]];if(Array.isArray(rule)){if(rule[0]==='INT'&&!Number.isInteger(value))throw Error(binding.label+' 需要整数。');if(typeof value==='number'&&((Number.isFinite(rule[1]?.min)&&value<rule[1].min)||(Number.isFinite(rule[1]?.max)&&value>rule[1].max)))throw Error(binding.label+' 超出节点声明的数值范围。');if(Array.isArray(rule[0])&&!rule[0].includes(value))throw Error(binding.label+' 不在节点的可选值列表中。')}}writeInputAt(node,binding.path,value,binding.allowCreate);changes.push({label:binding.label,nodeId:binding.nodeId,path:binding.path,from:info.value,to:value});
  }
  return {workflow,changes};
}


function addInputBinding(nodeId='',path='',source='literal'){
  const c=state.settings.comfy,node=Object.hasOwn(c.workflow,nodeId)?c.workflow[nodeId]:null,info=node&&path?inputAt(node,path):null;const existing=c.bindings.find(b=>b.nodeId===nodeId&&b.path===path&&path);if(existing){toast('该字段已有映射，可直接编辑。');return existing}
  let warning='',autoField=false;if(['positive','negative'].includes(source)){const inferred=inferTextInput(nodeId);path=inferred.field;warning=inferred.warning;autoField=true}
  const optional=node&&path?workflowInputEntries(node,c.workflow).find(e=>e.path===path&&e.optional):null;
  const initial=info?.exists?info.value:optional?.value;const rule={id:uid('bind'),label:source==='positive'?'正向提示词':source==='negative'?'负向提示词':node?node.class_type+' · '+(path||'输入'):'自定义输入',nodeId:String(nodeId),path:path||'',type:initial!==undefined?guessValueType(initial):'auto',source,value:initial!==undefined?(typeof initial==='object'?JSON.stringify(initial,null,2):String(initial)):'',enabled:true,autoField,warning,allowCreate:!!optional,allowLink:false};c.bindings.push(rule);save();return rule;
}


async function readComfyObjectInfo(){const json=await(await request(baseURL()+'/object_info',{},15000)).json();if(!json||typeof json!=='object'||Array.isArray(json))throw Error('ComfyUI 未返回合法节点定义。');state.settings.comfy.objectInfo=json;for(const b of state.settings.comfy.bindings)if(b.autoField&&['positive','negative'].includes(b.source)){const inf=inferTextInput(b.nodeId);b.path=inf.field;b.warning=inf.warning}save();render();toast('节点定义已读取，文本字段与插件输入已更新。')}


function mappedExecutionSnapshot(){const c=state.settings.comfy,classes=[...new Set(Object.values(c.workflow).map(n=>n.class_type))],objectInfo={};for(const key of classes)if(c.objectInfo?.[key])objectInfo[key]=clone(c.objectInfo[key]);return {baseUrl:c.baseUrl,mode:c.mode,autoFallback:c.autoFallback,workflow:clone(c.workflow),bindings:clone(c.bindings),outputNodeId:c.outputNodeId||'',randomizeSeeds:!!c.randomizeSeeds,workflowTitle:c.workflowTitle,globalNegative:state.settings.negative,objectInfo}}


async function executeMappedGPU(frame,row,signal,sourceImage=null){
  const snapshot=frame._execution||mappedExecutionSnapshot(),endpoint=String(snapshot.baseUrl||baseURL()).replace(/\/+$/,''),needsImage=snapshot.bindings.some(b=>b.enabled&&b.source==='image');let uploadedImage=null;
  if(needsImage&&sourceImage){const data=await imageData(sourceImage),blob=await(await fetch(data)).blob(),form=new FormData();form.append('image',blob,uid('input')+(blob.type==='image/jpeg'?'.jpg':'.png'));form.append('overwrite','true');const response=await(await request(endpoint+'/upload/image',{method:'POST',body:form,signal})).json();if(!response.name)throw Error('ComfyUI 未返回上传的图像文件名。');uploadedImage=(response.subfolder?response.subfolder+'/':'')+response.name}
  const resolved=Array.isArray(frame._imageInputs)?{images:frame._imageInputs}:resolveImageVariables(frame.prompt,frame._scope||row._scope||row,true,frame.negative||snapshot.globalNegative||''),references=frame._imageInputs||resolved.images,uploadedImages=Object.create(null);
  for(const image of references){if(!snapshot.bindings.some(b=>b.enabled&&b.source==='variable'&&String(b.value).replace(/^\{|\}$/g,'')===image.key))throw Error('工作流尚未将图片变量 {'+image.key+'} 绑定到图片加载节点的 image 字段。');const data=await imageData(image.src),blob=await(await fetch(data)).blob(),form=new FormData();form.append('image',blob,uid('variable')+(blob.type==='image/jpeg'?'.jpg':blob.type==='image/webp'?'.webp':'.png'));form.append('overwrite','false');const response=await(await request(endpoint+'/upload/image',{method:'POST',body:form,signal})).json();if(!response.name)throw Error(JSON.stringify(response));uploadedImages[image.key]=(response.subfolder?response.subfolder+'/':'')+response.name}
  const compiled=buildMappedWorkflow(frame,row,{execution:snapshot,uploadedImage,uploadedImages});
  const submitted=await(await request(endpoint+'/prompt',post({prompt:compiled.workflow,client_id:rt.clientId},signal))).json();if(!submitted.prompt_id)throw Error('ComfyUI 拒绝蓝图：'+JSON.stringify(submitted.node_errors||submitted.error||submitted));log('提交工作流 '+snapshot.workflowTitle+' · '+submitted.prompt_id.slice(0,12));
  const limit=Date.now()+600000;while(Date.now()<limit){await delay(900,signal);const result=await(await request(endpoint+'/history/'+encodeURIComponent(submitted.prompt_id),{signal})).json(),history=result[submitted.prompt_id];if(!history)continue;if(history.status?.status_str==='error')throw Error('工作流执行失败：'+JSON.stringify(history.status.messages));const outputs=history.outputs||{},images=snapshot.outputNodeId?outputs[snapshot.outputNodeId]?.images:Object.values(outputs).flatMap(x=>x.images||[]);if(images?.length){const image=images[0],query=new URLSearchParams({filename:image.filename,subfolder:image.subfolder||'',type:image.type||'output'});return {image:await persistRasterAsset(await blobData(await(await request(endpoint+'/view?'+query,{signal})).blob()),frame._assetBookId,signal),offlineFallback:false,promptId:submitted.prompt_id}}if(history.status?.completed)throw Error('工作流结束但指定节点没有图片，请检查“结果图片节点”。')}
  throw Error('生成等待超时，请查看 ComfyUI 服务日志。');
}


async function generateMappedFrame(frame,row,signal,theme=0,source=null){
  validatePrompt(frame.prompt);const compiled=buildMappedWorkflow(frame,row,{preview:true});
  // A real GPU failure stays a failure: never manufacture successful-looking artwork.
  if((frame._execution?.mode??state.settings.comfy.mode)==='real')return executeMappedGPU(frame,row,signal,source);
  await delay(1050,signal);const scope=frame._scope||row._scope||row,seed=hash(scopeText(frame.prompt,scope,true)+JSON.stringify(compiled.workflow));const size=Object.values(compiled.workflow).map(n=>n.inputs).find(v=>Number.isFinite(v.width)&&Number.isFinite(v.height));return {image:fitSVG(svgArt(theme,seed),clamp(size?.width||768,256,4096),clamp(size?.height||1024,256,4096)),offlineFallback:false};
}


function validateBindings(bindings){if(!Array.isArray(bindings)||bindings.length>500)throw Error('映射必须是最多 500 项的数组。');const ids=new Set();for(const b of bindings){if(!b||typeof b.id!=='string'||!/^[a-zA-Z0-9_-]{1,150}$/.test(b.id)||ids.has(b.id)||typeof b.nodeId!=='string'||typeof b.path!=='string'||typeof b.label!=='string'||!Object.hasOwn(bindingSources,b.source)||!Object.hasOwn(bindingTypes,b.type)||typeof b.enabled!=='boolean')throw Error('映射项缺少合法的 ID、来源、类型或启用状态。');if(b.path)inputPathParts(b.path);if(systemVariableKeys.has(b.nodeId))throw Error('节点 ID 不合法。');for(const k of ['allowCreate','allowLink','autoField'])if(b[k]!==undefined&&typeof b[k]!=='boolean')throw Error('映射开关必须是布尔值。');ids.add(b.id)}return true}


function autoIdentifyBindings(){const c=state.settings.comfy,entries=Object.entries(c.workflow),textNodes=entries.filter(([id,n])=>Object.values(n.inputs).some(v=>typeof v==='string')&&(/CLIPTextEncode|TextEncode|Prompt/i.test(n.class_type)||Object.keys(n.inputs).some(k=>['text','opt_text','text_g'].includes(k)))),neg=textNodes.find(([,n])=>/negative|负向/i.test(n._meta?.title||''))||textNodes[1],pos=textNodes.find(([,n])=>/positive|正向/i.test(n._meta?.title||''))||textNodes.find(x=>x!==neg)||textNodes[0];for(const[source,label,node]of[['positive','正向提示词',pos],['negative','负向提示词',neg]]){if(!node)continue;const info=inferTextInput(node[0]),existing=c.bindings.find(b=>b.source===source);if(existing){existing.nodeId=node[0];existing.path=info.field;existing.warning=info.warning;existing.autoField=true}else addInputBinding(node[0],info.field,source)}if(!c.outputNodeId)c.outputNodeId=entries.find(([,n])=>/SaveImage|PreviewImage/.test(n.class_type))?.[0]||'';save();render();toast(textNodes.length?'已识别文本候选节点，请核对正负语义与字段。':'未识别到文本节点，可手动添加任意节点映射。')}


function addRenderBindings(){const c=state.settings.comfy;let count=0;for(const[key,label]of[['width','画面宽度'],['height','画面高度'],['steps','采样步数'],['cfg','CFG'],['denoise','去噪强度'],['seed','种子']]){const found=Object.entries(c.workflow).find(([,n])=>Object.hasOwn(n.inputs,key));if(!found)continue;if(c.bindings.some(b=>b.nodeId===found[0]&&inputPathParts(b.path).join('/')===key))continue;const b=addInputBinding(found[0],key,'sceneParameter');b.label=label;b.value=key;b.type='number';count++}save();render();toast('已添加 '+count+' 个分镜参数映射。只有单幕主动启用高级覆盖时才会写入。')}


/* Source: /js/engine.js */
function createTextNodeContract(){
  const fields=Object.freeze(['positive','positive_prompt','negative','negative_prompt','prompt','text','opt_text','text_g','text_l']),own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  function isLink(v){return Array.isArray(v)&&v.length===2&&['string','number'].includes(typeof v[0])&&Number.isInteger(v[1])}
  function detect(node,role='positive'){const inputs=node?.inputs||{},ordered=role==='negative'?['negative','negative_prompt',...fields.filter(k=>!['negative','negative_prompt'].includes(k))]:fields,field=ordered.find(k=>own(inputs,k)&&typeof inputs[k]==='string');if(field)return{field,resolved:true,warning:'',candidates:ordered.filter(k=>typeof inputs[k]==='string')};const strings=Object.keys(inputs).filter(k=>typeof inputs[k]==='string'&&!['ckpt_name','lora_name','filename_prefix','image','sampler_name','scheduler'].includes(k));if(strings.length===1)return{field:strings[0],resolved:true,warning:'Using the only actual string input: '+strings[0],candidates:strings};return{field:'text',resolved:false,warning:'未找到可确定的实际字符串输入。text 仅为候选，原连线不会被覆盖。',candidates:strings}}
  function pathParts(path){if(typeof path!=='string'||!path)throw Error('A node input path is required.');const parts=path.startsWith('/')?path.slice(1).split('/').map(p=>p.replace(/~1/g,'/').replace(/~0/g,'~')):path.split('.');if(parts.some(p=>!p||['__proto__','constructor','prototype'].includes(p)))throw Error('Unsafe node input path.');return parts}
  function inspectPath(node,path){let value=node?.inputs;for(const part of pathParts(path)){if(isLink(value))return{linked:true,exists:true,value};if(value===null||typeof value!=='object'||!own(value,part))return{linked:false,exists:false};value=value[part]}return{linked:isLink(value),exists:true,value}}
  function healBinding(binding,workflow){const next={...binding};if(!next.enabled||next.source==='inherit')return next;const node=own(workflow,next.nodeId)?workflow[next.nodeId]:null;if(!node)throw Error('Node #'+next.nodeId+' does not exist.');const textSource=next.source==='positive'||next.source==='negative';let target;try{target=inspectPath(node,next.path)}catch(e){target={exists:false,linked:false}}if(textSource&&(target.linked||!target.exists||typeof target.value!=='string')){const inferred=detect(node,next.source);if(!inferred.resolved)throw Error('Node #'+next.nodeId+' has no safe string input. Its upstream connections are preserved.');next.path=inferred.field;next.warning='Self-healed node #'+next.nodeId+': '+binding.path+' -> '+inferred.field+'. Upstream links were preserved.';target=inspectPath(node,next.path)}if(target.linked)throw Error('Refusing to overwrite a topology link at #'+next.nodeId+'/'+next.path+'. Bind the upstream text node instead.');next.allowLink=false;return next}
  return Object.freeze({fields,isLink,detect,inspectPath,healBinding});
}


function detectTextField(nodeOrInputs,role='positive'){const node=nodeOrInputs?.inputs?nodeOrInputs:{inputs:nodeOrInputs||{}};return globalThis.ComfyComic.textNodes.detect(node,role).field}


function installNativeEngineModule(){const ns=globalThis.ComfyComic;ns.textNodes=createTextNodeContract();const previous=buildMappedWorkflow;inferTextInput=function(nodeId,config=state.settings.comfy,role='positive'){return ns.textNodes.detect(config.workflow?.[String(nodeId)],role)};initialWorkflowBindings=function(config){const mapping=config.mapping||{},rules=[];for(const source of ['positive','negative']){const id=mapping[source];if(id===undefined||id===null||id==='')continue;const inferred=inferTextInput(String(id),config,source);rules.push({id:uid('binding'),nodeId:String(id),path:inferred.field,label:source,source,type:'text',value:'',enabled:true,autoField:true,warning:inferred.warning,allowCreate:false,allowLink:false})}return rules};buildMappedWorkflow=function(frame,row,options={}){const execution=options.execution||frame._execution||{},workflow=execution.workflow||state.settings.comfy.workflow,original=execution.bindings||state.settings.comfy.bindings||[],bindings=original.map(b=>b.source==='sceneParameter'&&!frame.renderOverride?{...b,enabled:false}:ns.textNodes.healBinding(b,workflow));const result=previous(frame,row,{...options,execution:{...execution,workflow,bindings}});result.healedBindings=bindings.filter((b,i)=>b.path!==original[i]?.path);return result};ns.modules.engine=true}

async function persistRasterAsset(dataUrl,albumId='unassigned',signal){
  if(!/^https?:$/.test(location.protocol)||!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(dataUrl))return dataUrl;
  const response=await fetch('/api/store-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataUrl,albumId}),signal});
  if(!response.ok)throw Error('图片落盘失败：HTTP '+response.status+'。请检查磁盘空间后重试。');
  const result=await response.json();if(!result.localUrl?.startsWith('/images/'))throw Error('图片保存接口未返回有效本地路径。');return result.localUrl;
}

// Provider configs contain references, never secret values. Keys live in the local server vault.
const imageProviderUI={models:new Map(),busy:new Set(),modelIndex:-1};
function ensureImageProviders(s=state){
  s.settings.imageGeneration??={active:'comfyui',profiles:[
    {id:'comfyui',title:'ComfyUI',provider:'comfyui'},
    {id:'novelai',title:'NovelAI',provider:'novelai',baseUrl:'https://image.novelai.net',model:'nai-diffusion-4-5-full',sampler:'k_euler_ancestral',keyMode:'none'},
    {id:'openai',title:'OpenAI 兼容',provider:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-image-1',protocol:'images',size:'1024x1024',quality:'auto',sendSize:false,sendQuality:false,keyMode:'none'}]};
  const g=s.settings.imageGeneration;
  if(!Array.isArray(g.profiles))g.profiles=[];
  if(!g.profiles.some(p=>p.provider==='comfyui'))g.profiles.unshift({id:'comfyui',title:'ComfyUI',provider:'comfyui'});
  for(const p of g.profiles){p.keyMode??='none';if(p.provider==='openai'){p.sendSize??=!!p.size;p.sendQuality??=!!p.quality}}
  if(!g.profiles.some(p=>p.id===g.active))g.active=g.profiles[0]?.id||'comfyui';
  return g;
}
function activeImageProfile(){const g=ensureImageProviders();return g.profiles.find(p=>p.id===g.active)||g.profiles[0]}
function imageConfigSnapshot(p=activeImageProfile()){
  return Object.fromEntries(['id','title','provider','baseUrl','model','protocol','sampler','size','quality','sendSize','sendQuality','keyMode','keyId','extraParams'].filter(k=>p[k]!==undefined).map(k=>[k,clone(p[k])]));
}
function imageProviderSnapshot(){const p=activeImageProfile();return {provider:p.provider,profileId:p.id,config:imageConfigSnapshot(p),mode:'real',workflowTitle:p.title+' / '+(p.model||''),globalNegative:state.settings.negative}}
function imageProviderSelect(){const g=ensureImageProviders();return `<label class="label" for="image-provider-select">图像生产渠道</label><select id="image-provider-select">${g.profiles.map(p=>opt(p.id,p.title,g.active)).join('')}</select>`}
function imageModelsCacheKey(p){return JSON.stringify([p.id,p.baseUrl,p.keyMode,p.keyId])}
function imageProviderPanel(){
  const p=activeImageProfile(),input=(label,key)=>field(label,`<input type="text" data-image-config="${key}" value="${esc(p[key]||'')}" autocomplete="off">`),models=imageProviderUI.models.get(imageModelsCacheKey(p))||[],images=p.protocol!=='chat',optional=(label,key,flag,placeholder)=>`<div class="provider-optional"><label class="row"><input type="checkbox" data-image-config="${flag}" ${p[flag]?'checked':''} ${!images?'disabled':''}><span>${label}<small class="muted"> · 可选</small></span></label><input type="text" data-image-config="${key}" value="${esc(p[key]||'')}" placeholder="${placeholder}" ${!p[flag]||!images?'disabled':''}><p class="help">${images?'关闭或留空：不向接口发送 '+key:'Chat 协议不发送此参数'}</p></div>`;
  return `<section class="panel image-provider-panel"><div class="row between wrap"><h2>图像引擎</h2><div class="row wrap"><a class="btn small" href="/docs/index.html" target="_blank" rel="noopener">教程 / Docs ↗</a>${btn('新增渠道','plus','image-provider-new','','small')}${p.provider!=='comfyui'?btn('复制','copy','image-provider-copy','','small')+btn('删除渠道','trash','image-provider-delete','','small danger'):''}</div></div><p class="help">共用分镜与队列；任务关联渠道；保存后的模型、地址和参数从下一次请求生效，在途请求不变。密钥单独保存在本地后端，任务与普通工程导出仅包含引用。</p>${imageProviderSelect()}${p.provider==='comfyui'?'<p class="help">ComfyUI 是内置工作流入口；工作流库可独立管理，API 渠道可新增、复制与删除。</p>':`<div class="grid2">${input('渠道名称','title')}${input('API Base URL（OpenAI 通常含 /v1）','baseUrl')}<div class="provider-model-field">${p.provider==='openai'?`${field('模型 ID（输入搜索，也可手动填写）',`<div class="provider-model-combobox"><input id="image-provider-model-input" type="text" data-image-config="model" value="${esc(p.model||'')}" role="combobox" aria-label="模型 ID，输入搜索或手动填写" aria-autocomplete="list" aria-expanded="false" aria-controls="image-provider-model-results" autocomplete="off" spellcheck="false" placeholder="输入模型名称，如 gpt / flux"><div id="image-provider-model-results" class="provider-model-results" role="listbox" aria-label="匹配模型" hidden></div></div>`)}<div class="row">${btn(imageProviderUI.busy.has(p.id)?'正在获取…':'获取模型列表','refresh','image-provider-models',imageProviderUI.busy.has(p.id)?'disabled':'','small')}<span class="help">${models.length?'已载入 '+models.length+' 个模型 · 输入即可搜索':'获取后可搜索，也可直接填写模型 ID'}</span></div><p class="help" id="provider-model-status">调用基础 URL 下的 GET /models；列表不保证全部支持图像生成，获取失败仍可手填。</p>`:input('模型 ID（可手动填写）','model')}</div><div class="provider-auth">${field('API 鉴权（允许为空）',`<select id="image-provider-auth">${opt('none','无密钥 · 不发送 Authorization',p.keyMode)}${opt('environment','使用服务端环境变量',p.keyMode)}${p.keyId?opt('stored','已保存 · '+(p.keyLabel||'本地密钥'),p.keyMode):''}</select>`)}<div class="row">${btn('管理密钥','key','image-provider-keys','','small')}<span class="help">${p.keyMode==='stored'?'已保存到本地 · 原文不回显':p.keyMode==='environment'?'使用对应的服务端 API_KEY':'可连接不需要鉴权的本地或兼容服务'}</span></div></div>${p.provider==='openai'?field('接口协议',`<select data-image-config="protocol">${opt('images','Images API · GPT Image / 兼容渠道',p.protocol)}${opt('chat','Chat Completions · 返回图片的兼容渠道',p.protocol)}</select>`):input('采样器','sampler')}</div>${p.provider==='openai'?`<section class="provider-options"><h3>可选请求参数</h3><div class="grid2">${optional('输出尺寸','size','sendSize','如 1024x1024 / auto')}${optional('质量','quality','sendQuality','如 auto / high')}</div></section>`:''}<details class="quiet-advanced"><summary>高级请求参数 · JSON</summary><textarea id="provider-extra-params" spellcheck="false" aria-label="高级请求参数">${esc(JSON.stringify(p.extraParams||{},null,2))}</textarea><p class="help">只扩展额外协议字段，不能覆盖已绑定的提示词、图片、标准参数或鉴权；保存后从下一次请求生效。不兼容时保留接口错误。</p></details><p class="help">密钥按渠道与基础 URL 绑定，换地址后需重新选择或保存。复制渠道不复制密钥。仅在本机可信环境使用；本地密钥文件不是加密保险库。生成不自动重试，停止等待不保证上游停止计费。</p>`}</section>`;
}
async function imageCredentialRequest(action,p,extra={}){return(await request('/api/image/credentials',post({action,config:imageConfigSnapshot(p),...extra}),15000)).json()}
async function openImageKeyManager(p){
  const binding=imageModelsCacheKey(p),result=await imageCredentialRequest('list',p);
  if(!ensureImageProviders().profiles.includes(p)||p.id!==activeImageProfile().id||binding!==imageModelsCacheKey(p))return;
  modal('本地密钥 · '+p.title,`<p class="help">可保存多条并手动选择。保存后原文不再返回浏览器；无需鉴权时在渠道中选择“无密钥”。删除不可撤销，引用它的旧任务需要重新选择配置。</p><div class="provider-key-list">${result.keys.length?result.keys.map(k=>`<div class="provider-key-row"><div class="grow"><strong>${esc(k.label)}</strong><p class="help">密钥已保存 · ${esc(new Date(k.createdAt).toLocaleString())}${p.keyId===k.id&&p.keyMode==='stored'?' · 当前使用':''}</p></div>${btn('使用','check','image-key-use',`data-id="${esc(p.id)}" data-key="${esc(k.id)}" data-label="${esc(k.label)}"`,'small')}${btn('删除','trash','image-key-delete',`data-id="${esc(p.id)}" data-key="${esc(k.id)}"`,'small danger')}</div>`).join(''):'<p class="help">此渠道与地址尚未保存密钥。</p>'}</div><div class="divider"></div>${field('密钥名称（可选）','<input id="image-key-label" type="text" maxlength="80" autocomplete="off" placeholder="例如：主账号 / 备用账号">')}${field('新增 API Key','<input id="image-provider-key" type="password" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" spellcheck="false" autocapitalize="none" placeholder="粘贴密钥，保存后输入框会清空" aria-label="新增 API Key">')}<p class="help">只用于 API 认证，不是网站登录密码。留空无需保存，直接选择“无密钥”。</p><div class="modal-footer">${btn('关闭','','close-modal')}${btn('保存并使用','disk','image-key-save',`data-id="${esc(p.id)}"`,'primary')}</div>`);
}
function providerHasPendingTasks(id){return state.queue.some(q=>['pending','running','paused'].includes(q.status)&&[q.execution,...(q.frames||[]).map(f=>f?._execution)].some(ex=>ex?.profileId===id||ex?.config?.id===id))}
async function handleImageProviderAction(action,d={},el){
  const p=activeImageProfile(),g=ensureImageProviders();
  if(action==='image-provider-pick-model'){chooseImageModel(d.model);return true}
  if(action==='image-provider-settings'){navigate(3);return true}
  if(action==='image-provider-new'){modal('新增图像渠道',field('接口类型',`<select id="image-new-type"><option value="openai">OpenAI 兼容</option><option value="novelai">NovelAI</option></select>`)+field('渠道名称','<input id="image-new-title" autocomplete="off" placeholder="自定义渠道">')+'<div class="modal-footer">'+btn('取消','','close-modal')+btn('创建','plus','image-provider-create','','primary')+'</div>');return true}
  if(action==='image-provider-create'){const type=$('#image-new-type').value,newProfile={id:uid('provider'),title:$('#image-new-title').value.trim()||(type==='novelai'?'NovelAI':'OpenAI 兼容'),provider:type,keyMode:'none',...(type==='novelai'?{baseUrl:'https://image.novelai.net',model:'nai-diffusion-4-5-full',sampler:'k_euler_ancestral'}:{baseUrl:'https://api.openai.com/v1',model:'gpt-image-1',protocol:'images',sendSize:false,sendQuality:false,size:'1024x1024',quality:'auto'})};g.profiles.push(newProfile);g.active=newProfile.id;closeModal();save();render();return true}
  if(action==='image-provider-copy'){if(p.provider==='comfyui')throw Error('ComfyUI 请在工作流库复制。');const copy={...clone(p),id:uid('provider'),title:p.title+' 副本',keyMode:'none'};delete copy.keyId;delete copy.keyLabel;delete copy.key;g.profiles.push(copy);g.active=copy.id;save();render();return true}
  if(action==='image-provider-delete'){
    if(p.provider==='comfyui')throw Error('内置 ComfyUI 入口无需删除；可以切换到其他渠道。');
    if(providerHasPendingTasks(p.id))throw Error('有未完成任务引用此渠道，请先停止并移除相关队列任务。');
    if(!await confirmAction('删除渠道「'+p.title+'」？','将删除渠道及其本地密钥；已生成画册和图片保留。旧画册的精修快照若引用这些密钥会失效。','删除渠道'))return true;
    if(providerHasPendingTasks(p.id))throw Error('渠道已被新的任务引用，未删除。');
    await imageCredentialRequest('purge',p);g.profiles=g.profiles.filter(x=>x.id!==p.id);g.active=g.profiles[0].id;save();render();return true;
  }
  if(action==='image-provider-models'){
    if(imageProviderUI.busy.has(p.id))return true;const binding=imageModelsCacheKey(p);imageProviderUI.busy.add(p.id);if(el){el.disabled=true;el.textContent='正在获取…'}
    try{const result=await(await request('/api/image/models',post({config:imageConfigSnapshot(p)}),30000)).json();imageProviderUI.models.set(binding,result.models);if(activeImageProfile()===p&&binding===imageModelsCacheKey(p)){imageProviderUI.busy.delete(p.id);render();$('#image-provider-model-input')?.focus();toast('获取到 '+result.models.length+' 个模型，请选择适合图像生成的模型。')}}catch(e){if(activeImageProfile()===p&&binding===imageModelsCacheKey(p)){const status=$('#provider-model-status');if(status)status.textContent='获取失败，可继续手动填写。'+e.message}throw e}finally{imageProviderUI.busy.delete(p.id);if(el?.isConnected){el.disabled=false;el.textContent='获取模型列表'}}return true;
  }
  if(action==='image-provider-keys'){await openImageKeyManager(p);return true}
  if(action.startsWith('image-key-')){
    const target=g.profiles.find(x=>x.id===d.id);if(!target)throw Error('渠道已删除。');
    if(action==='image-key-save'){
      const input=$('#image-provider-key'),key=input.value.trim(),label=$('#image-key-label').value.trim();if(!key){toast('未填写密钥。需要空密钥时请选择“无密钥”。');return true}
      if(el?.disabled)return true;if(el)el.disabled=true;
      try{const result=await imageCredentialRequest('add',target,{key,label});input.value='';target.keyMode='stored';target.keyId=result.key.id;target.keyLabel=result.key.label;save();closeModal();render();toast('密钥已保存到本地，下次打开无需重填。')}finally{if(el?.isConnected)el.disabled=false}return true;
    }
    if(action==='image-key-use'){target.keyMode='stored';target.keyId=d.key;target.keyLabel=d.label;save();closeModal();render();return true}
    if(action==='image-key-delete'){if(!await confirmAction('删除这条本地密钥？','不可撤销。使用它的任务将报错，不会自动换用其他密钥。','删除密钥'))return true;await imageCredentialRequest('delete',target,{keyId:d.key});if(target.keyId===d.key){delete target.keyId;delete target.keyLabel;target.keyMode='none'}save();render();await openImageKeyManager(target);return true}
  }
  return false;
}
async function generateProviderFrame(frame,row,signal,source=null){
  const ex=frame._execution||imageProviderSnapshot(),p=ex.config;
  if(!p||!['novelai','openai'].includes(ex.provider))throw Error('图像渠道快照无效，请重新入队。');
  const scope=frame._scope||row._scope||row,resolved=Array.isArray(frame._imageInputs)&&typeof frame._resolvedImagePrompt==='string'?{prompt:frame._resolvedImagePrompt,negative:frame._resolvedImageNegative||'',images:frame._imageInputs}:resolveImageVariables(frame.prompt,scope,true,frame.negative||ex.globalNegative||''),prompt=frame._resolvedImagePrompt||resolved.prompt;validatePrompt(prompt);
  const images=(frame._imageInputs||resolved.images).map(image=>{if(!image.src)throw Error('图片变量 {'+image.key+'} 尚未上传图片。');return image.src});
  const reference=source;
  const response=await request('/api/image/generate',post({config:p,prompt,negative:frame._resolvedImageNegative??resolved.negative,frame:{width:frame.width,height:frame.height,steps:frame.steps,cfg:frame.cfg,seed:frame.seed,denoise:frame.denoise},source:reference?await imageData(reference):null,images,albumId:frame._assetBookId||'unassigned'},signal),330000);
  const result=await response.json();if(!result.image)throw Error('渠道未返回图片。');return result;
}
function installImageProviders(){
  paths.key='<circle cx="15" cy="8" r="5"/><path d="m11.5 11.5-8.5 8.5v-4h4v-4h4"/>';
  const oldEnsure=ensureStudioState;ensureStudioState=function(s=state){oldEnsure(s);ensureImageProviders(s);return s};
  const oldSnapshot=mappedExecutionSnapshot;mappedExecutionSnapshot=function(){return activeImageProfile().provider==='comfyui'?{...oldSnapshot(),provider:'comfyui'}:imageProviderSnapshot()};
  const oldExecution=workflowExecutionFor;workflowExecutionFor=function(plan,frame){return activeImageProfile().provider==='comfyui'?{...oldExecution(plan,frame),provider:'comfyui'}:imageProviderSnapshot()};
  const oldBuild=buildMappedWorkflow;buildMappedWorkflow=function(frame,row,options={}){const ex=options.execution||frame._execution;if(ex?.provider&&ex.provider!=='comfyui'){validatePrompt(scopeText(frame.prompt,frame._scope||row._scope||row,true));if(!ex.config?.model||!ex.config?.baseUrl)throw Error('请先填写图像渠道地址和模型。');return {workflow:{},changes:[]}}return oldBuild(frame,row,options)};
  const oldGenerate=generateFrame;generateFrame=async function(frame,row,signal,theme=0,source=null){const ex=frame._execution,provider=ex?(ex.provider||'comfyui'):activeImageProfile().provider;return provider==='comfyui'?oldGenerate(frame,row,signal,theme,source):generateProviderFrame(frame,row,signal,source)};
  const oldShell=renderShell;renderShell=function(){oldShell();const p=activeImageProfile(),status=$('#topbar > .tiny.muted');if(status&&p.provider!=='comfyui'){status.textContent=p.title+' · API';status.title='按需调用；未声称已验证连接'}};
  const oldLibrary=renderWorkflowLibrary;renderWorkflowLibrary=()=>imageProviderPanel()+(activeImageProfile().provider==='comfyui'?oldLibrary():'');
  const oldComposer=queueComposerHTML;queueComposerHTML=function(){const html=oldComposer();return '<div class="queue-provider-picker">'+imageProviderSelect()+btn('配置渠道','settings','image-provider-settings','','small')+'</div>'+html};
  const oldRender=render;render=function(){oldRender();const nonComfy=activeImageProfile().provider!=='comfyui';document.querySelectorAll('[data-act="ws-edit-scene-workflow"]').forEach(el=>el.hidden=nonComfy);if(ui.workspace===3){const crumb=$('.breadcrumb strong');if(crumb)crumb.textContent='图像引擎'}};
  const oldAction=handleAction;handleAction=async function(action,d={},el){if(action.startsWith('image-provider-')||action.startsWith('image-key-')){if(await handleImageProviderAction(action,d,el))return}return oldAction(action,d,el)};
  $('#modal').addEventListener('close',()=>{const key=$('#image-provider-key');if(key)key.value=''});
  document.addEventListener('input',e=>{const el=e.target;if(el.dataset.imageConfig&&el.type!=='checkbox'&&el.tagName==='INPUT'){activeImageProfile()[el.dataset.imageConfig]=el.value.trim();save();if(el.id==='image-provider-model-input')showImageModelResults()}});
  document.addEventListener('focusin',e=>{if(e.target.id==='image-provider-model-input')showImageModelResults()});
  document.addEventListener('focusout',e=>{if(e.target.id==='image-provider-model-input')closeImageModelResults()});
  let modelTouch=null;
  document.addEventListener('pointerdown',e=>{const option=e.target.closest('[data-act="image-provider-pick-model"]');if(option){e.preventDefault();if(e.pointerType!=='mouse')modelTouch={id:e.pointerId,x:e.clientX,y:e.clientY,model:option.dataset.model}}else if(!e.target.closest('.provider-model-combobox'))closeImageModelResults()});
  document.addEventListener('pointermove',e=>{if(modelTouch&&modelTouch.id===e.pointerId&&Math.hypot(e.clientX-modelTouch.x,e.clientY-modelTouch.y)>10)modelTouch=null});
  document.addEventListener('pointercancel',()=>{modelTouch=null});
  document.addEventListener('pointerup',e=>{if(modelTouch&&modelTouch.id===e.pointerId){const picked=modelTouch;modelTouch=null;if(Math.hypot(e.clientX-picked.x,e.clientY-picked.y)<=10)chooseImageModel(picked.model)}});

  document.addEventListener('keydown',e=>{
    if(e.target.id!=='image-provider-model-input'||e.isComposing)return;
    const list=$('#image-provider-model-results');if(!list)return;
    if(e.key==='Escape'){closeImageModelResults();e.preventDefault();e.stopImmediatePropagation();return}
    if(!['ArrowDown','ArrowUp','Enter'].includes(e.key))return;
    if(e.key==='Enter'&&list.hidden)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(list.hidden)showImageModelResults();
    const options=[...list.querySelectorAll('[role="option"]')];if(!options.length)return;
    if(e.key==='Enter'){chooseImageModel(options[Math.max(0,imageProviderUI.modelIndex)].dataset.model);return}
    imageProviderUI.modelIndex=(imageProviderUI.modelIndex+(e.key==='ArrowDown'?1:imageProviderUI.modelIndex<0?0:-1)+options.length)%options.length;
    options.forEach((option,i)=>option.setAttribute('aria-selected',String(i===imageProviderUI.modelIndex)));
    const active=options[imageProviderUI.modelIndex];e.target.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});
  },true);
  document.addEventListener('change',e=>{
    const el=e.target,p=activeImageProfile();
    if(el.id==='image-provider-select'){ensureImageProviders().active=el.value;save();render();return}
    if(el.id==='image-provider-auth'){p.keyMode=el.value;save();render();return}
    if(el.dataset.imageConfig){p[el.dataset.imageConfig]=el.type==='checkbox'?el.checked:el.value.trim();save();if(['sendSize','sendQuality','protocol','baseUrl'].includes(el.dataset.imageConfig))render()}
  });
}

function filterImageModels(models,query){const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);return models.filter(id=>words.every(word=>id.toLowerCase().includes(word)))}
function closeImageModelResults(){const input=$('#image-provider-model-input'),list=$('#image-provider-model-results');if(list)list.hidden=true;if(input){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant')}imageProviderUI.modelIndex=-1}
function showImageModelResults(){
  const input=$('#image-provider-model-input'),list=$('#image-provider-model-results');if(!input||!list)return;
  const models=imageProviderUI.models.get(imageModelsCacheKey(activeImageProfile()))||[],matches=filterImageModels(models,input.value);
  imageProviderUI.modelIndex=-1;input.removeAttribute('aria-activedescendant');input.setAttribute('aria-expanded','true');list.hidden=false;
  list.innerHTML=`<div class="provider-model-hint">${models.length?(matches.length?'匹配 '+matches.length+' / '+models.length+' 个 · ↑↓ 选择，Enter 确认':'无匹配模型，仍可使用手动填写的 ID'):'尚未获取模型列表，可直接填写 ID 或点击获取'}</div>`+matches.map((id,i)=>`<button type="button" role="option" tabindex="-1" aria-selected="false" id="provider-model-option-${i}" data-act="image-provider-pick-model" data-model="${esc(id)}">${esc(id)}</button>`).join('');fitImageModelResults();
}
function chooseImageModel(model){
  const input=$('#image-provider-model-input'),models=imageProviderUI.models.get(imageModelsCacheKey(activeImageProfile()))||[];
  if(!input||!models.includes(model))return;
  activeImageProfile().model=model;input.value=model;save();input.focus();closeImageModelResults();
}
function fitImageModelResults(){
  const input=$('#image-provider-model-input'),list=$('#image-provider-model-results');if(!input||!list||list.hidden)return;
  if(!matchMedia('(max-width:760px), (max-width:950px) and (hover:none) and (pointer:coarse)').matches){list.style.top='';list.style.bottom='';list.style.maxHeight='';return}
  const view=window.visualViewport,top=view?.offsetTop||0,height=view?.height||innerHeight,rect=input.getBoundingClientRect(),keyboard=innerHeight-height>140;
  const below=top+height-rect.bottom-(keyboard?12:100),above=rect.top-top-12,up=below<160&&above>below;
  list.style.top=up?'auto':'calc(100% + 6px)';list.style.bottom=up?'calc(100% + 6px)':'auto';list.style.maxHeight=Math.max(70,Math.min(280,up?above:below))+'px';
}
