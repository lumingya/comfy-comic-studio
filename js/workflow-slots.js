/* V3 plan executor. Analysis and migration live exclusively in Python. */
"use strict";
const WorkflowSlots = (() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const MAX_LORAS = 16;
  const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|pkl)$/i;
  const NOT_MODEL = /lora|vae|clip|control|upscale|ipadapter|adapter|embedding|face|detect|bbox|segm|sam\b|encoder|tokenizer|scheduler|style|instantid|photomaker|pulid|insight|onnx|preprocessor|depth|pose|animatediff|motion|gligen|hypernet|audio|llm|florence|vision|refiner_|interpolation|vfi|rife|ifrnet|film|esrgan|realesrgan|gfpgan|codeformer|rembg|segmentation|matting|depthanything|midas|zoe|openpose|dwpose|lama|inpaint_model|facerestore/i;
  const NOT_MODEL_FILE = /\bamt[-_.]|[-_]amt[-_.]|\bamt.*?gopro|ifrnet|ifunet|rife|vimeo|film_net|_vfi\b|flavr|gmflow|\bm2m\b|cain|sepconv|stmfnet|flownet|raft_|spynet|esrgan|realesrgan|gfpgan|codeformer|depth_anything|openpose|dwpose|insightface/i;
  const LORA_TAG = /<lora:([^<>:]+?)(?::(-?\d*\.?\d+))?(?::(-?\d*\.?\d+))?\s*>/g;
  function fail(message) {
    throw Error(message);
  }

  function isLink(value, workflow) {
    return Array.isArray(value) && value.length === 2 && (typeof value[0] === "string" || (typeof value[0] === "number" && Object.hasOwn(workflow, String(value[0])))) && Number.isInteger(value[1]);
  }

  function nodeIds(workflow) {
    return Object.keys(workflow || {}).filter((id) => workflow[id] && typeof workflow[id] === "object" && !Array.isArray(workflow[id]) && workflow[id].inputs && typeof workflow[id].inputs === "object").sort(compareIds);
  }

  function compareIds(a, b) {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function numberText(value) {
    return String(Math.round(Number(value) * 100) / 100);
  }

  function stripExtension(name) {
    return String(name).replace(MODEL_EXT, "");
  }

  function loraStem(name) {
    return stripExtension(String(name).replace(/\\/g, "/").split("/").pop());
  }

  function loraDisplayName(name, format) {
    if (format === "file") return String(name);
    if (format === "path") return stripExtension(String(name).replace(/\\/g, "/"));
    return loraStem(name);
  }

  /* Consumers of every node output: { nodeId: [{consumer, key, index}] } */

  function consumerIndex(workflow) {
    const index = {};
    for (const id of nodeIds(workflow)) {
      for (const [key, value] of Object.entries(workflow[id].inputs)) {
        if (!isLink(value, workflow)) continue;
        const source = String(value[0]);
        (index[source] ||= []).push({ consumer: id, key, index: value[1] });
      }
    }
    return index;
  }

  /* ---- model slot ---------------------------------------------------------------------------- */

  function catalogFromObjectInfo(objectInfo) {
    const lists = { checkpoints: new Set(), unets: new Set(), loras: new Set(), vaes: new Set() };
    const fieldKinds = { ckpt_name: "checkpoints", unet_name: "unets", lora_name: "loras", vae_name: "vaes" };
    for (const [classType, definition] of Object.entries(objectInfo || {})) {
      if (!definition || typeof definition !== "object") continue;
      const input = definition.input || {};
      const outputs = definition.output;
      const hasModelOutput = Array.isArray(outputs) && outputs.some((o) => String(o).toUpperCase() === "MODEL");
      for (const group of [input.required || {}, input.optional || {}]) {
        for (const [field, rule] of Object.entries(group)) {
          const kind = fieldKinds[field];
          if (!kind || !Array.isArray(rule) || !Array.isArray(rule[0])) continue;
          if (kind === "checkpoints" || kind === "unets") {
            if (NOT_MODEL.test(classType)) continue;
            if (Array.isArray(outputs) && !hasModelOutput) continue;
          }
          for (const option of rule[0]) {
            if (typeof option === "string" && option && option !== "None") {
              if (kind === "checkpoints" || kind === "unets" || kind === "loras") {
                if (NOT_MODEL_FILE.test(option) || !MODEL_EXT.test(option)) continue;
              }
              lists[kind].add(option);
            }
          }
        }
      }
    }
    const sorted = (set) => [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return { checkpoints: sorted(lists.checkpoints), unets: sorted(lists.unets), loras: sorted(lists.loras), vaes: sorted(lists.vaes) };
  }

  function fieldEnum(node, key, objectInfo) {
    const input = objectInfo?.[node.class_type]?.input || {};
    const rule = { ...(input.required || {}), ...(input.optional || {}) }[key];
    return Array.isArray(rule) && Array.isArray(rule[0]) ? rule[0] : null;
  }

  function parseLoraSyntax(text) {
    const loras = [];
    const rest = String(text ?? "").replace(LORA_TAG, (m, name, strength, clip) => {
      const entry = { name: name.trim(), strength: strength === undefined ? 1 : Number(strength) };
      if (clip !== undefined) entry.clip = Number(clip);
      loras.push(entry);
      return " ";
    });
    return { loras, text: tidy(rest) };
  }

  function tidy(text) {
    return String(text).replace(/[ \t]+/g, " ").replace(/ ?(,) ?(?=,)/g, "$1").replace(/^[ ,]+|[ ,]+$/gm, "").replace(/ +\n/g, "\n").trim();
  }

  function normalizeLoras(list) {
    if (!Array.isArray(list)) fail("LoRA 覆盖必须是数组");
    if (list.length > MAX_LORAS) fail("一次最多叠加 " + MAX_LORAS + " 个 LoRA");
    const out = [], seen = new Set();
    for (const raw of list) {
      if (!raw || typeof raw !== "object") fail("LoRA 条目格式无效");
      const name = String(raw.name ?? "").trim();
      if (!name || name.length > 300 || /[<>\u0000-\u001f]/.test(name)) fail("LoRA 名称无效");
      const strength = Number(raw.strength ?? 1);
      if (!Number.isFinite(strength)) fail("LoRA 强度必须是有限数字");
      const entry = { name, strength: Math.round(strength * 100) / 100 };
      if (raw.clip !== undefined && raw.clip !== null && raw.clip !== "") {
        const clip = Number(raw.clip);
        if (!Number.isFinite(clip)) fail("LoRA CLIP 强度必须是有限数字");
        entry.clip = Math.round(clip * 100) / 100;
      }
      if (seen.has(name)) {out[out.findIndex(l=>l.name===name)]=entry;continue;}
      seen.add(name); out.push(entry);
    }
    return out;
  }

  function writeField(workflow, nodeId, key, value) {
    const node = workflow[nodeId];
    if (!node || !node.inputs || typeof node.inputs !== "object") fail("工作流里没有节点 " + nodeId);
    if (isLink(node.inputs[key], workflow)) fail("节点 " + nodeId + " 的 " + key + " 已连线，不能写入");
    node.inputs[key] = value;
  }

  function formatTag(lora, nameFormat) {
    const clip = lora.clip !== undefined && lora.clip !== lora.strength ? ":" + numberText(lora.clip) : "";
    const name = loraDisplayName(lora.name, nameFormat).replace(/:/g, "_");
    return "<lora:" + name + ":" + numberText(lora.strength) + clip + ">";
  }

  function applyChain(workflow, lora, loras, notices) {
    const chain = clone(lora.chain);
    if (!chain.length) fail("工作流里没有可用的 LoRA 加载节点");
    const consumers = () => consumerIndex(workflow);
    /* Grow the chain by cloning its tail. */
    while (chain.length < loras.length) {
      const tail = chain[chain.length - 1], tailNode = workflow[tail.nodeId];
      const base = tail.nodeId.replace(/:lora\d+$/, "");
      let n = 1, id = base + ":lora" + n;
      while (Object.hasOwn(workflow, id)) { n += 1; id = base + ":lora" + n; }
      const copy = clone(tailNode);
      if (copy._meta && copy._meta.title) copy._meta.title = String(copy._meta.title) + " · " + (chain.length + 1);
      const index = consumers();
      for (const entry of index[tail.nodeId] || []) {
        const consumer = workflow[entry.consumer];
        if (entry.index < tail.passthrough.length) consumer.inputs[entry.key] = [id, entry.index];
      }
      tail.passthrough.forEach((key, i) => { copy.inputs[key] = [tail.nodeId, i]; });
      workflow[id] = copy;
      chain.push({...tail,nodeId:id});
    }
    chain.forEach((d, i) => {
      const node = workflow[d.nodeId];
      if (i < loras.length) {
        const l = loras[i];
        writeField(workflow,d.nodeId,d.namePath,loraDisplayName(l.name, "file"));
        if (d.strengthPath) writeField(workflow,d.nodeId,d.strengthPath,l.strength);
        if (d.clipPath) writeField(workflow,d.nodeId,d.clipPath,l.clip??l.strength);
        return;
      }
      /* Surplus node: bypass it (rewire consumers to its inputs) or neutralise it when that is impossible. */
      const index = consumers();
      const users = index[d.nodeId] || [];
      const bypassable = d.passthrough.length && users.every((u) => u.index < d.passthrough.length && isLink(node.inputs[d.passthrough[u.index]], workflow));
      if (bypassable) {
        for (const u of users) workflow[u.consumer].inputs[u.key] = clone(node.inputs[d.passthrough[u.index]]);
        delete workflow[d.nodeId];
      } else {
        if (d.strengthPath) node.inputs[d.strengthPath] = 0;
        if (d.clipPath) node.inputs[d.clipPath] = 0;
        notices.push("LoRA 节点 " + d.nodeId + " 无法绕过，已将其强度设为 0。");
      }
    });
  }

  function applyStack(workflow, lora, loras) {
    const node = workflow[lora.nodeId];
    if (!node) fail("LoRA 堆栈节点不存在");
    const slots = clone(lora.slots);
    if (!slots.length) fail("节点没有可识别的 LoRA 槽位");
    const objectStyle = slots[0].objectStyle;
    if (loras.length > slots.length) {
      if (!objectStyle) fail("LoRA 堆栈只有 " + slots.length + " 个槽位，无法放下 " + loras.length + " 个 LoRA");
      const template=node.inputs[slots[0].namePath],base=slots[0].namePrefix,suffix=slots[0].nameSuffix;
      let nextIndex=Math.max(...slots.map(s=>s.index))+1;
      while(slots.length<loras.length){
        const slotToken=String(nextIndex).padStart(slots[0].slotToken.length,'0'),namePath=base+slotToken+suffix;
        node.inputs[namePath]=clone(template);slots.push({...slots[0],index:nextIndex,slotToken,namePath});nextIndex++;
      }
    }
    slots.forEach((slot, i) => {
      const l = loras[i];
      if (slot.objectStyle) {
        if (!l) { delete node.inputs[slot.namePath]; return; }
        const entry = node.inputs[slot.namePath];
        if (Object.hasOwn(entry, "lora") || !Object.hasOwn(entry, "name")) entry.lora = loraDisplayName(l.name, "file"); else entry.name = loraDisplayName(l.name, "file");
        entry.on = true; entry.strength = l.strength;
        if (Object.hasOwn(entry, "strengthTwo")) entry.strengthTwo = l.clip !== undefined ? l.clip : null;
        return;
      }
      const switchValue = slot.switchPath ? node.inputs[slot.switchPath] : undefined;
      const on = typeof switchValue === "boolean" ? true : "On", off = typeof switchValue === "boolean" ? false : "Off";
      if (l) {
        writeField(workflow,lora.nodeId,slot.namePath,loraDisplayName(l.name,"file"));
        for (const key of slot.strengthPaths) writeField(workflow,lora.nodeId,key,l.strength);
        for (const key of slot.clipPaths) writeField(workflow,lora.nodeId,key,l.clip??l.strength);
        if (slot.switchPath) writeField(workflow,lora.nodeId,slot.switchPath,on);
      } else if (slot.switchPath) writeField(workflow,lora.nodeId,slot.switchPath,off);
      else { writeField(workflow,lora.nodeId,slot.namePath,"None"); for (const key of slot.strengthPaths) writeField(workflow,lora.nodeId,key,0); for (const key of slot.clipPaths) writeField(workflow,lora.nodeId,key,0); }
    });
    for(const key of ["lora_count","num_loras"]) if(Object.hasOwn(node.inputs,key)) writeField(workflow,lora.nodeId,key,loras.length);
  }
  function planOf(slots) { return slots?.plan || (slots?.version===3 ? slots : null); }
  function view(slots) {
    const plan=planOf(slots);
    if (!plan && slots && typeof slots==='object') {
      const legacyModel = slots.model && typeof slots.model==='object' ? slots.model : null;
      const legacyLora = slots.lora && typeof slots.lora==='object' ? slots.lora : null;
      return {
        plan: null,
        model: legacyModel ? { enabled: legacyModel.enabled !== false && !!legacyModel.nodeId, nodeId: legacyModel.nodeId||'', path: legacyModel.path||'', kind: legacyModel.kind||'model' } : { enabled: false, nodeId: '', path: '', kind: 'model' },
        lora: legacyLora ? { mode: legacyLora.mode||'off', nodeId: legacyLora.nodeId||'', path: legacyLora.path||'' } : { mode: 'off', nodeId: '', path: '' }
      };
    }
    const targets=plan?.model.targets||[], groups=plan?.lora.groups||[];
    const m=targets.find(t=>t.role==='primary')||targets[0]||{}, l=groups.find(g=>g.enabled)||groups[0]||{};
    return {plan,model:{...plan?.model,enabled:targets.some(t=>t.enabled),nodeId:m.nodeId||'',path:m.path||'',kind:m.kind||'model'},
      lora:{...plan?.lora,mode:(groups.some(g=>g.enabled)||(plan?.lora.synth&&plan.lora.synth.enabled!==false))?(l.kind||'chain'):'off',nodeId:l.writer?.nodeId||'',path:l.writer?.path||''}};
  }
  function currentModel(workflow, slots) {return planOf(slots)?.model.targets.find(t=>t.role==='primary')?.current||'';}
  function currentLoras(workflow, slots) {return merged((planOf(slots)?.lora.groups||[]).flatMap(g=>g.pinned),[],[]);}
  function merged(pinned, additions, unpin) {
    const map=new Map(), unpinKeys=new Set((unpin||[]).map(u=>stripExtension(String(u).replace(/\\/g,'/').toLowerCase())));
    for(const l of pinned) if(!unpinKeys.has(stripExtension(String(l.name).replace(/\\/g,'/').toLowerCase()))) map.set(stripExtension(String(l.name).replace(/\\/g,'/').toLowerCase()),clone(l));
    for(const l of additions) map.set(stripExtension(String(l.name).replace(/\\/g,'/').toLowerCase()),clone(l));
    return [...map.values()];
  }
  function normalizeOverrides(raw={}) {
    const clean={};
    const name=v=>{if(typeof v!=='string'||!v.trim()||v.length>300||/[<>\x00-\x1f]/.test(v))fail('模型名称无效');return v.trim();};
    if(raw.model&&typeof raw.model==='object'&&!Array.isArray(raw.model))clean.model=Object.fromEntries(Object.entries(raw.model).map(([k,v])=>[k,name(v)]));
    else if(raw.model!=null&&raw.model!=='')clean.model=name(raw.model);
    if(Object.hasOwn(raw,'loras'))clean.loras=normalizeLoras(raw.loras);
    for(const k of ['unpin','disabled'])if(Object.hasOwn(raw,k)){
      if(!Array.isArray(raw[k])||!raw[k].every(v=>typeof v==='string'&&v.length<=500))fail(k+' 必须是字符串数组');
      clean[k]=[...new Set(raw[k])];
    }
    return clean;
  }
  function writeObject(wf,w,loras) {
    const inputs=wf[w.nodeId].inputs,raw=inputs[w.path],wrapped=!Array.isArray(raw),entries=wrapped?raw.__value__:raw;
    if(isLink(raw,wf)||!Array.isArray(entries))fail('LoRA 对象字段已连线或形态已变化，请重新分析');
    if(entries.some(e=>!e||typeof e!=='object'||Array.isArray(e)))fail('LoRA 对象条目无效，请重新分析');
    const template=entries[0]||{name:'',strength:1,active:true,clipStrength:1};
    const values=loras.map(l=>{const e=clone(template);e[Object.hasOwn(e,'lora')&&!Object.hasOwn(e,'name')?'lora':'name']=l.name;e.strength=l.strength;e.active=true;
      if(Object.hasOwn(e,'on'))e.on=true;if(Object.hasOwn(e,'clipStrength'))e.clipStrength=l.clip??l.strength;return e;});
    inputs[w.path]=wrapped?{...raw,__value__:values}:values;
    for(const path of w.textPaths||[])inputs[path]=loras.map(l=>formatTag(l,'path')).join(' ');
  }
  function writeSyntax(wf,site,loras) {
    const inputs=wf[site.nodeId]?.inputs;if(!inputs)fail('LoRA 语法目标节点不存在');
    const old=inputs[site.path];if(old!==undefined&&typeof old!=='string'&&!isLink(old,wf))fail('LoRA 语法目标字段不是文本');
    const base=parseLoraSyntax(typeof old==='string'?old:'').text,tags=loras.map(l=>formatTag(l,'path')).join(' ');
    inputs[site.path]=!tags?base:!base?tags:base+(/[ ,\n]$/.test(base)?' ':base.includes('\n')?'\n':' ')+tags;
  }
  function applyPlan(workflow, slots, overrides, {objectInfo={}}={}) {
    const plan=planOf(slots);if(!plan)fail('槽位计划尚未生成，请在工作台重新分析');
    const clean=normalizeOverrides(overrides),result=clone(workflow||{}),notices=[],writes=[],disabled=new Set(clean.disabled||[]),model=clean.model;
    if(model&&typeof model==='object'&&Object.keys(model).some(k=>!plan.model.targets.some(t=>t.key===k)))fail('模型目标不在蓝图中');
    for(const t of plan.model.targets){
      const selected=t.enabled??['primary','same'].includes(t.role), keyed=model&&typeof model==='object',value=keyed?model[t.key]:model;
      if(!value)continue;
      if(disabled.has(t.key)||t.disabled||(!selected&&!(keyed&&Object.hasOwn(model,t.key)))||t.role==='linked-unwritable'){notices.push('跳过模型 '+t.key+'：'+(t.reason||'未勾选'));continue;}
      const options=fieldEnum(result[t.sourceNodeId||t.nodeId]||{},t.sourcePath||t.path,objectInfo);
      if(options&&!options.some(o=>String(o).replace(/\\/g,'/').toLowerCase()===String(value).replace(/\\/g,'/').toLowerCase()))fail('模型 '+value+' 不在 '+t.key+' 的枚举列表中');
      writeField(result,t.nodeId,t.path,value);writes.push({kind:'model',key:t.key,nodeId:t.nodeId,path:t.path,value});notices.push('写入模型 '+t.key+' → '+value);
    }
    if(model&&Object.keys(model).length&&!writes.some(w=>w.kind==='model'))fail('当前工作流没有可写入的模型槽（全部跳过）');
    if(Object.hasOwn(clean,'loras')||clean.unpin?.length){
      const groups=clone(plan.lora.groups);
      if(clean.loras?.length&&plan.lora.synth&&plan.lora.synth.enabled!==false&&!disabled.has('synth:'+plan.lora.synth.after.nodeId)&&!groups.some(g=>(g.enabled??g.active)&&!disabled.has(g.key))){
        const s=plan.lora.synth,a=s.after,src=a.nodeId;
        let n=1,nid=src+':lora';
        while(result[nid]){nid=`${src}:lora${n}`;n++;}
        const inputs={model:[src,a.modelSlot],lora_name:'',strength_model:1},passthrough=['model'];
        if(a.clipSlot!==null){inputs.clip=[src,a.clipSlot];inputs.strength_clip=1;passthrough.push('clip');}
        for(const u of consumerIndex(result)[src]||[]){if(u.index===a.modelSlot)result[u.consumer].inputs[u.key]=[nid,0];else if(a.clipSlot!==null&&u.index===a.clipSlot)result[u.consumer].inputs[u.key]=[nid,1];}
        result[nid]={class_type:s.classType,inputs};
        const d={nodeId:nid,namePath:'lora_name',strengthPath:'strength_model',clipPath:passthrough.length===2?'strength_clip':'',passthrough};
        groups.push({key:'synth:'+src,kind:'chain',writer:{nodeId:nid,chain:[d],range:s.range||{min:-5,max:5}},active:true,enabled:true,append:true,pinned:[],sites:[{nodeId:nid,path:'lora_name'}]});
      }
      let wrote=false;
      for(const g of groups){
        if(disabled.has(g.key)||!(g.enabled??g.active)){notices.push('跳过 LoRA '+g.key+'：'+(g.warn||'未勾选'));continue;}
        const nameKey=n=>stripExtension(n.replace(/\\/g,'/').toLowerCase()),local=new Set(g.pinned.map(l=>nameKey(l.name)));
        const unpinKeys=new Set((clean.unpin||[]).map(u=>nameKey(u)));
        const upstream=new Set(groups.filter(o=>(g.upstreamKeys||[]).includes(o.key)).flatMap(o=>o.pinned).filter(l=>!unpinKeys.has(nameKey(l.name))).map(l=>nameKey(l.name)));
        const additions=(clean.loras||[]).filter(l=>local.has(nameKey(l.name))||(g.append!==false&&!upstream.has(nameKey(l.name))));
        const final=merged(g.pinned,additions,clean.unpin||[]);
        if(JSON.stringify(final)===JSON.stringify(g.pinned)){wrote=true;continue;}
        const w=g.writer,bounds=w.range||{min:-5,max:5};
        for(const l of final)for(const value of [l.strength,...(Object.hasOwn(l,'clip')?[l.clip]:[])])if(typeof value!=='number'||!Number.isFinite(value)||value<bounds.min||value>bounds.max)fail('LoRA 强度必须在 '+bounds.min+' 到 '+bounds.max+' 之间');
        for(const site of g.sites)if(site.active===false&&g.active)notices.push('跳过 LoRA 站点 '+site.nodeId+':'+site.path+'：'+(site.reason||'不活跃'));
        if(g.kind==='chain')applyChain(result,w,final,notices);
        else if(g.kind==='stack')applyStack(result,w,final);
        else if(g.kind==='object')writeObject(result,w,final);
        else if(g.kind==='syntax')for(const site of g.origin?[g.origin]:g.sites){if(site.active===false&&g.active)continue;writeSyntax(result,site,final);}
        else if(g.kind==='embedded'){
          if(final.length>1)fail('此蓝图的加载器最多 1 个 LoRA');const d=w.chain[0];
          if(!final.length&&!d.strengthPath)fail('内嵌 LoRA 没有强度字段，无法安全禁用');
          if(final.length)writeField(result,w.nodeId,w.path,final[0].name);
          if(d.strengthPath)writeField(result,w.nodeId,d.strengthPath,final[0]?.strength??0);
          if(d.clipPath)writeField(result,w.nodeId,d.clipPath,final[0]?.clip??final[0]?.strength??0);
        }else fail('未知 LoRA 写入形态：'+g.kind);
        wrote=true;if(!g.active)notices.push('手动启用不活跃 LoRA 组 '+g.key);
        writes.push({kind:'lora',key:g.key,origin:g.origin??null,sites:g.sites.filter(s=>s.active!==false||!g.active),loras:final});
        notices.push('写入 LoRA '+g.key+' → '+g.sites.filter(s=>s.active!==false||!g.active).map(s=>s.nodeId+':'+s.path).join(', '));
      }
      if(clean.loras?.length&&!wrote)fail(plan.lora.reason||'没有启用的 LoRA 应用点');
    }
    return {workflow:result,notices,writes,slots:{plan},plan,overrides:clean};
  }
  function describe(slots) {
    const p=planOf(slots);if(!p)return '槽位尚未分析';
    const count=p.model.targets.filter(t=>t.enabled).length,groups=p.lora.groups;
    const sites=groups.filter(g=>g.enabled&&g.append).flatMap(g=>g.sites),skipped=groups.flatMap(g=>g.sites).filter(s=>s.active===false).length;
    return `将写入 ${count} 个底模 · LoRA 追加到 ${sites.filter(s=>s.active!==false).length+(p.lora.synth?1:0)} 处${skipped?`（${skipped} 处未启用，已跳过）`:''}`;
  }
  return {MAX_LORAS,MODEL_EXT,NOT_MODEL_FILE,catalogFromObjectInfo,parseLoraSyntax,formatTag,loraStem,loraDisplayName,currentModel,currentLoras,normalizeOverrides,applyPlan,apply:applyPlan,view,planOf,describe,numberText};
})();
