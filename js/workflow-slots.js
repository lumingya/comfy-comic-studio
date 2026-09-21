/* Semantic model / LoRA slots for ComfyUI API workflows.
   Pure module: no DOM, state or transport. Mirrors backend/ecosystem/workflow_slots.py and shares
   regression fixtures in tests/fixtures/workflow_slots_contract.json.

   A slot is a *meaning* ("the base model", "the LoRA set") rather than a node type. Detection works
   from input names, values and links, so it needs no per-plugin tables:
     model slot  → a string input that names a weights file and whose node feeds a `model` input.
     LoRA slot   → one of three adaptive modes, chosen from what the blueprint actually contains:
        syntax   inject "<lora:name:strength>" tags into a text field (LoRA Manager, prompt-control…)
        chain    fill LoraLoader-style nodes wired in series; the chain grows or shrinks to fit
        stack    fill numbered slots of a stacker node (CR LoRA Stack, rgthree Power Lora Loader…)
   apply() never mutates its input and produces a plain API payload. */
"use strict";
const WorkflowSlots = (() => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|pkl)$/i;
  const STRONG_MODEL_KEYS = /^(ckpt_name|unet_name)$/i;
  const WEAK_MODEL_KEYS = /^(checkpoint|ckpt|model_name|model|model_path|diffusion_model|base_model|unet|transformer)$/i;
  const NOT_MODEL = /lora|vae|clip|control|upscale|ipadapter|adapter|embedding|face|detect|bbox|segm|sam\b|encoder|tokenizer|scheduler|style|instantid|photomaker|pulid|insight|onnx|preprocessor|depth|pose|animatediff|motion|gligen|hypernet|audio|llm|florence|vision|refiner_|interpolation|vfi|rife|ifrnet|film|esrgan|realesrgan|gfpgan|codeformer|rembg|segmentation|matting|depthanything|midas|zoe|openpose|dwpose|lama|inpaint_model|facerestore/i;
  const NOT_MODEL_FILE = /\bamt[-_.]|[-_]amt[-_.]|\bamt.*?gopro|ifrnet|ifunet|rife|vimeo|film_net|_vfi\b|flavr|gmflow|\bm2m\b|cain|sepconv|stmfnet|flownet|raft_|spynet|esrgan|realesrgan|gfpgan|codeformer|depth_anything|openpose|dwpose|insightface/i;
  const MODEL_CLASS = /checkpoint|unet|diffusion|model.?loader|dit.?loader/i;
  const STACK_KEY = /^(lora|lora_name)_?(\d+)$/i;
  const CHAIN_NAME_KEYS = ["lora_name", "lora"];
  const CHAIN_STRENGTH_KEYS = ["strength_model", "strength", "lora_strength", "model_strength", "lora_model_strength", "model_weight", "lora_wt", "weight"];
  const CHAIN_CLIP_KEYS = ["strength_clip", "clip_strength", "lora_clip_strength", "clip_weight"];
  const STACK_STRENGTH_PREFIXES = ["strength", "lora_wt", "model_weight", "model_str", "strength_model", "lora_strength", "weight"];
  const STACK_CLIP_PREFIXES = ["clip_weight", "clip_str", "strength_clip", "clip_strength"];
  const STACK_SWITCH_PREFIXES = ["switch", "enabled", "on"];
  const PASSTHROUGH_KEYS = ["model", "clip", "prev_lora", "lora_stack"];
  const SYNTAX_TEXT_KEYS = /text|prompt/i;
  const LORA_TAG = /<lora:([^<>:]+?)(?::(-?\d*\.?\d+))?(?::(-?\d*\.?\d+))?\s*>/g;
  const MAX_LORAS = 16;

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
  function title(node) {
    return String(node?._meta?.title || node?.class_type || "");
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

  function modelCandidates(workflow, objectInfo = {}) {
    const consumers = consumerIndex(workflow), catalog = catalogFromObjectInfo(objectInfo), found = [];
    const checkpoints = new Set(catalog.checkpoints), unets = new Set(catalog.unets);
    for (const id of nodeIds(workflow)) {
      const node = workflow[id], classType = String(node.class_type || "");
      for (const [key, value] of Object.entries(node.inputs)) {
        if (typeof value !== "string") continue;
        let score = 0, kind = "model";
        if (STRONG_MODEL_KEYS.test(key)) {
          score = 3;
          kind = /^unet/i.test(key) ? "unet" : "checkpoint";
        } else if (WEAK_MODEL_KEYS.test(key)) {
          if (NOT_MODEL.test(classType)) continue;
          score = 2;
        } else if (MODEL_EXT.test(value)) {
          if (NOT_MODEL.test(key) || NOT_MODEL.test(classType)) continue;
          score = 1;
        } else continue;
        if (MODEL_EXT.test(value)) score += 1;
        if (MODEL_CLASS.test(classType)) score += 1;
        if ((consumers[id] || []).some((c) => c.key === "model")) score += 2;
        const options = fieldEnum(node, key, objectInfo);
        if (options) {
          const hits = options.filter((o) => checkpoints.has(o) || unets.has(o)).length;
          if (hits && options.every((o) => checkpoints.has(o))) { kind = "checkpoint"; score += 1; }
          else if (hits && options.every((o) => unets.has(o))) { kind = "unet"; score += 1; }
          else if (!hits && (checkpoints.size || unets.size)) score -= 2;
        }
        if (score <= 0) continue;
        found.push({ nodeId: id, path: key, classType, title: title(node), value, kind, score });
      }
    }
    return found.sort((a, b) => b.score - a.score || compareIds(a.nodeId, b.nodeId));
  }

  /* ---- LoRA slot ----------------------------------------------------------------------------- */
  function firstKey(inputs, keys) {
    return keys.find((k) => Object.hasOwn(inputs, k)) || "";
  }
  function stackSlots(node, workflow) {
    const slots = [];
    for (const [key, value] of Object.entries(node.inputs)) {
      const match = STACK_KEY.exec(key);
      if (!match || isLink(value, workflow)) continue;
      const token = match[2], objectStyle = value && typeof value === "object" && !Array.isArray(value);
      if (!objectStyle && typeof value !== "string") continue;
      const siblings = (prefixes) => (objectStyle ? [] : prefixes.map((p) => p + "_" + token).filter((k) => Object.hasOwn(node.inputs, k)));
      const strengthPaths = siblings(STACK_STRENGTH_PREFIXES), clipPaths = siblings(STACK_CLIP_PREFIXES), switchPaths = siblings(STACK_SWITCH_PREFIXES);
      slots.push({ index: Number(token), token, namePath: key, objectStyle, strengthPaths, clipPaths, strengthPath: strengthPaths[0] || "", clipPath: clipPaths[0] || "", switchPath: switchPaths[0] || "" });
    }
    return slots.sort((a, b) => a.index - b.index);
  }
  function chainDescriptor(id, workflow) {
    const node = workflow[id], inputs = node.inputs;
    if (stackSlots(node, workflow).length) return null;
    const namePath = CHAIN_NAME_KEYS.find((k) => Object.hasOwn(inputs, k) && !isLink(inputs[k], workflow) && (typeof inputs[k] === "string" || inputs[k] === null));
    if (!namePath) return null;
    const strengthPath = firstKey(inputs, CHAIN_STRENGTH_KEYS), clipPath = firstKey(inputs, CHAIN_CLIP_KEYS);
    if (!strengthPath && !/lora/i.test(String(node.class_type))) return null;
    let passthrough = PASSTHROUGH_KEYS.filter((k) => Object.hasOwn(inputs, k));
    if (!passthrough.length && /wan.*lora|loraselect/i.test(String(node.class_type || ""))) {
      passthrough = ["prev_lora"];
    }
    return { nodeId: id, classType: String(node.class_type || ""), title: title(node), namePath, strengthPath, clipPath, passthrough, value: inputs[namePath], strength: strengthPath ? inputs[strengthPath] : null, clip: clipPath ? inputs[clipPath] : null };
  }
  function chainParent(descriptor, workflow, chainIds) {
    /* Walk pass-through links upstream until another chain node appears. */
    let node = workflow[descriptor.nodeId], guard = 0;
    while (node && guard++ < 64) {
      const key = PASSTHROUGH_KEYS.find((k) => isLink(node.inputs[k], workflow));
      if (!key) return "";
      const source = String(node.inputs[key][0]);
      if (chainIds.has(source)) return source;
      node = workflow[source];
    }
    return "";
  }
  function orderedChain(workflow, anchor) {
    const all = {};
    for (const id of nodeIds(workflow)) { const d = chainDescriptor(id, workflow); if (d) all[id] = d; }
    const ids = new Set(Object.keys(all));
    if (!ids.size) return [];
    const children = {};
    for (const id of ids) { const parent = chainParent(all[id], workflow, ids); if (parent) (children[parent] ||= []).push(id); }
    let start = anchor && ids.has(String(anchor)) ? String(anchor) : "";
    if (!start) {
      const roots = [...ids].filter((id) => !chainParent(all[id], workflow, ids)).sort(compareIds);
      const depth = (id) => 1 + Math.max(0, ...(children[id] || []).map(depth));
      start = roots.sort((a, b) => depth(b) - depth(a) || compareIds(a, b))[0] || [...ids].sort(compareIds)[0];
    }
    const chain = [];
    let current = start;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current); chain.push(all[current]);
      current = (children[current] || []).sort(compareIds)[0] || "";
    }
    return chain;
  }
  function syntaxCandidates(workflow) {
    const consumers = consumerIndex(workflow), found = [];
    for (const id of nodeIds(workflow)) {
      const node = workflow[id], classType = String(node.class_type || "");
      if (!consumers[id]?.length) continue;
      for (const [key, value] of Object.entries(node.inputs)) {
        if (typeof value !== "string") continue;
        let score = 0;
        if (SYNTAX_TEXT_KEYS.test(key) && /<lora:/i.test(value)) score = 3;
        else if (/lora/i.test(classType) && key === "text") score = 2;
        if (score) found.push({ nodeId: id, path: key, classType, title: title(node), value, score, mirrorPath: mirrorPathFor(node, workflow) });
      }
    }
    return found.sort((a, b) => b.score - a.score || compareIds(a.nodeId, b.nodeId));
  }
  function mirrorPathFor(node, workflow) {
    if (!node?.inputs || typeof node.inputs !== "object") return "";
    for (const [key, value] of Object.entries(node.inputs)) {
      if (isLink(value, workflow)) continue;
      const list = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray(value.__value__) ? value.__value__ : null;
      if (!list) continue;
      if (!list.length && key === "loras") return key;
      if (list.length && list.every((e) => e && typeof e === "object" && (Object.hasOwn(e, "name") || Object.hasOwn(e, "lora")) && Object.hasOwn(e, "strength"))) return key;
    }
    return "";
  }
  function stackCandidates(workflow) {
    const found = [];
    for (const id of nodeIds(workflow)) {
      const slots = stackSlots(workflow[id], workflow);
      if (slots.length) found.push({ nodeId: id, classType: String(workflow[id].class_type || ""), title: title(workflow[id]), slots });
    }
    return found;
  }

  function detect(workflow, { objectInfo = {}, positive = null } = {}) {
    workflow = workflow && typeof workflow === "object" ? workflow : {};
    const model = modelCandidates(workflow, objectInfo);
    const syntax = syntaxCandidates(workflow), chain = orderedChain(workflow, ""), stack = stackCandidates(workflow);
    let recommended;
    if (chain.length) recommended = { mode: "chain", nodeId: chain[0].nodeId, path: chain[0].namePath, assumed: false };
    else if (stack.length) recommended = { mode: "stack", nodeId: stack[0].nodeId, path: stack[0].slots[0].namePath, assumed: false };
    else if (syntax.length && syntax[0].score >= 2) recommended = { mode: "syntax", nodeId: syntax[0].nodeId, path: syntax[0].path, assumed: false };
    else if (positive && positive.nodeId && Object.hasOwn(workflow, String(positive.nodeId)) && !/\//.test(String(positive.path || "").slice(1))) recommended = { mode: "syntax", nodeId: String(positive.nodeId), path: String(positive.path || "text").replace(/^\//, ""), assumed: true };
    else recommended = { mode: "off", nodeId: "", path: "", assumed: true };
    return { model: { candidates: model, primary: model[0] || null }, lora: { syntax, chain, stack, recommended } };
  }

  /* Stored slot configuration → fully resolved configuration (auto entries follow detection). */
  function normalize(slots, workflow, options = {}) {
    const stored = slots && typeof slots === "object" ? slots : {};
    const detected = detect(workflow, options);
    const modelStored = stored.model && typeof stored.model === "object" ? stored.model : {};
    const modelAuto = modelStored.auto !== false;
    const primary = detected.model.primary;
    const model = modelAuto
      ? { enabled: modelStored.enabled !== false && !!primary, auto: true, nodeId: primary ? primary.nodeId : "", path: primary ? primary.path : "", kind: primary ? primary.kind : "model" }
      : { enabled: modelStored.enabled !== false && !!modelStored.nodeId, auto: false, nodeId: String(modelStored.nodeId || ""), path: String(modelStored.path || ""), kind: ["checkpoint", "unet", "model"].includes(modelStored.kind) ? modelStored.kind : "model" };
    if (!model.auto && model.enabled) {
      const node = workflow?.[model.nodeId];
      const candidate = detected.model.candidates.find((c) => c.nodeId === model.nodeId && c.path === model.path);
      if (candidate && model.kind === "model") model.kind = candidate.kind;
      if (!node || !Object.hasOwn(node.inputs || {}, model.path)) model.enabled = false;
    }
    const loraStored = stored.lora && typeof stored.lora === "object" ? stored.lora : {};
    const loraAuto = loraStored.auto !== false;
    const rec = detected.lora.recommended;
    const lora = loraAuto
      ? { mode: rec.mode, auto: true, nodeId: rec.nodeId, path: rec.path, assumed: rec.assumed }
      : { mode: ["syntax", "chain", "stack", "off"].includes(loraStored.mode) ? loraStored.mode : "off", auto: false, nodeId: String(loraStored.nodeId || ""), path: String(loraStored.path || ""), assumed: false };
    if (loraStored.mode === "off" && loraAuto) { lora.mode = "off"; lora.nodeId = ""; lora.path = ""; }
    lora.placement = loraStored.placement === "prepend" ? "prepend" : "append";
    lora.nameFormat = ["stem", "path", "file"].includes(loraStored.nameFormat) ? loraStored.nameFormat : "stem";
    lora.mirror = loraStored.mirror !== false;
    if (lora.mode !== "off" && (!lora.nodeId || !workflow?.[lora.nodeId])) { lora.mode = "off"; lora.nodeId = ""; lora.path = ""; }
    if (lora.mode === "syntax" && lora.nodeId && !lora.path) lora.path = "text";
    return { model, lora };
  }

  /* ---- reading the blueprint's current values ------------------------------------------------ */
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
  function isEmptyName(name) {
    return name === null || name === undefined || String(name).trim() === "" || String(name) === "None";
  }
  function currentModel(workflow, slots) {
    const model = slots?.model;
    if (!model?.enabled) return null;
    const value = workflow?.[model.nodeId]?.inputs?.[model.path];
    return typeof value === "string" ? value : null;
  }
  function currentLoras(workflow, slots) {
    const lora = slots?.lora;
    if (!lora || lora.mode === "off") return [];
    if (lora.mode === "syntax") {
      const value = workflow?.[lora.nodeId]?.inputs?.[lora.path];
      const parsed = typeof value === "string" ? parseLoraSyntax(value).loras : [];
      const node = workflow?.[lora.nodeId];
      if (node && typeof node === "object") {
        const mirrorPath = mirrorPathFor(node, workflow);
        if (mirrorPath) {
          const container = node.inputs?.[mirrorPath];
          const entries = Array.isArray(container) ? container : Array.isArray(container?.__value__) ? container.__value__ : null;
          if (Array.isArray(entries)) {
            const activeMap = new Map();
            for (const e of entries) {
              if (e && typeof e === "object") {
                const n = String(e.name ?? e.lora ?? "").trim();
                if (n) {
                  const key = loraStem(n).toLowerCase();
                  const isActive = e.active !== false && e.on !== false;
                  activeMap.set(key, (activeMap.get(key) || false) || isActive);
                }
              }
            }
            return parsed.filter((l) => activeMap.get(loraStem(l.name).toLowerCase()) !== false);
          }
        }
      }
      return parsed;
    }
    if (lora.mode === "chain") {
      return orderedChain(workflow, lora.nodeId).filter((d) => !isEmptyName(d.value)).map((d) => ({ name: String(d.value), strength: typeof d.strength === "number" ? d.strength : 1, ...(typeof d.clip === "number" ? { clip: d.clip } : {}) }));
    }
    const node = workflow?.[lora.nodeId];
    if (!node) return [];
    const list = [];
    for (const slot of stackSlots(node, workflow)) {
      const raw = node.inputs[slot.namePath];
      if (slot.objectStyle) {
        if (raw.on === false || isEmptyName(raw.lora ?? raw.name)) continue;
        list.push({ name: String(raw.lora ?? raw.name), strength: typeof raw.strength === "number" ? raw.strength : 1, ...(typeof raw.strengthTwo === "number" ? { clip: raw.strengthTwo } : {}) });
      } else {
        if (isEmptyName(raw)) continue;
        const sw = slot.switchPath ? node.inputs[slot.switchPath] : true;
        if (sw === false || sw === "Off") continue;
        const strength = slot.strengthPath ? node.inputs[slot.strengthPath] : 1, clip = slot.clipPath ? node.inputs[slot.clipPath] : null;
        list.push({ name: String(raw), strength: typeof strength === "number" ? strength : 1, ...(typeof clip === "number" ? { clip } : {}) });
      }
    }
    return list;
  }

  /* ---- overrides ----------------------------------------------------------------------------- */
  function normalizeLoras(list) {
    if (!Array.isArray(list)) fail("LoRA 覆盖必须是数组");
    if (list.length > MAX_LORAS) fail("一次最多叠加 " + MAX_LORAS + " 个 LoRA");
    const out = [], seen = new Set();
    for (const raw of list) {
      if (!raw || typeof raw !== "object") fail("LoRA 条目格式无效");
      const name = String(raw.name ?? "").trim();
      if (!name || name.length > 300 || /[<>\u0000-\u001f]/.test(name)) fail("LoRA 名称无效");
      const strength = Number(raw.strength ?? 1);
      if (!Number.isFinite(strength) || Math.abs(strength) > 10) fail("LoRA 强度必须是 -10 到 10 之间的数字");
      const entry = { name, strength: Math.round(strength * 100) / 100 };
      if (raw.clip !== undefined && raw.clip !== null && raw.clip !== "") {
        const clip = Number(raw.clip);
        if (!Number.isFinite(clip) || Math.abs(clip) > 10) fail("LoRA CLIP 强度必须是 -10 到 10 之间的数字");
        entry.clip = Math.round(clip * 100) / 100;
      }
      if (seen.has(name)) continue;
      seen.add(name); out.push(entry);
    }
    return out;
  }
  function normalizeOverrides(overrides) {
    const raw = overrides && typeof overrides === "object" ? overrides : {};
    const out = {};
    if (raw.model !== undefined && raw.model !== null && raw.model !== "") {
      if (typeof raw.model !== "string" || !raw.model.trim() || raw.model.length > 300 || /[\u0000-\u001f]/.test(raw.model)) fail("模型名称无效");
      out.model = raw.model.trim();
    }
    if (Array.isArray(raw.loras)) out.loras = normalizeLoras(raw.loras);
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
  function applySyntax(workflow, lora, loras, notices) {
    const node = workflow[lora.nodeId];
    if (!node) fail("LoRA 语法目标节点不存在");
    const current = node.inputs[lora.path];
    if (isLink(current, workflow)) fail("LoRA 语法目标字段已连线，不能写入");
    if (current !== undefined && typeof current !== "string") fail("LoRA 语法目标字段不是文本");
    const base = parseLoraSyntax(current ?? "").text;
    const tags = loras.map((l) => formatTag(l, lora.nameFormat)).join(" ");
    let text;
    if (!tags) text = base;
    else if (!base) text = tags;
    else if (lora.placement === "prepend") text = tags + (/^[,\n]/.test(base) ? "" : " ") + base;
    else text = base + (/[,\n]$/.test(base) ? " " : /\n/.test(base) ? "\n" : " ") + tags;
    node.inputs[lora.path] = text;
    if (lora.assumed && loras.length) notices.push("工作流里没有解析 <lora:> 语法的节点，LoRA 标签已写入正向提示词；需要 LoRA Manager、Prompt Control 等插件才会生效。");
    const mirrorPath = lora.mirror === false ? "" : mirrorPathFor(node, workflow);
    if (mirrorPath) {
      const container = node.inputs[mirrorPath];
      const wrapped = !Array.isArray(container);
      const existing = wrapped ? container.__value__ : container;
      const template = existing.length ? existing[0] : { name: "", strength: 1, active: true, clipStrength: 1 };
      const entries = loras.map((l) => {
        const entry = clone(template);
        if (Object.hasOwn(entry, "lora") && !Object.hasOwn(entry, "name")) entry.lora = loraDisplayName(l.name, lora.nameFormat);
        else entry.name = loraDisplayName(l.name, lora.nameFormat);
        entry.strength = l.strength;
        if (Object.hasOwn(entry, "clipStrength")) entry.clipStrength = l.clip !== undefined ? l.clip : l.strength;
        if (Object.hasOwn(entry, "active")) entry.active = true;
        if (Object.hasOwn(entry, "on")) entry.on = true;
        return entry;
      });
      if (wrapped) node.inputs[mirrorPath] = { ...container, __value__: entries };
      else node.inputs[mirrorPath] = entries;
    }
  }
  function outputIndexFor(descriptor, key) {
    return descriptor.passthrough.indexOf(key);
  }
  function applyChain(workflow, lora, loras, notices) {
    let chain = orderedChain(workflow, lora.nodeId);
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
      chain = orderedChain(workflow, lora.nodeId);
      if (chain[chain.length - 1].nodeId !== id) fail("LoRA 链扩展失败");
    }
    chain.forEach((d, i) => {
      const node = workflow[d.nodeId];
      if (i < loras.length) {
        const l = loras[i];
        node.inputs[d.namePath] = loraDisplayName(l.name, "file");
        if (d.strengthPath) node.inputs[d.strengthPath] = l.strength;
        if (d.clipPath) node.inputs[d.clipPath] = l.clip !== undefined ? l.clip : l.strength;
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
    let slots = stackSlots(node, workflow);
    if (!slots.length) fail("节点没有可识别的 LoRA 槽位");
    const objectStyle = slots[0].objectStyle;
    if (loras.length > slots.length) {
      if (!objectStyle) fail("LoRA 堆栈只有 " + slots.length + " 个槽位，无法放下 " + loras.length + " 个 LoRA");
      const template = node.inputs[slots[0].namePath], base = slots[0].namePath.slice(0, slots[0].namePath.length - slots[0].token.length);
      for (let i = slots.length; i < loras.length; i++) node.inputs[base + String(i + 1).padStart(slots[0].token.length, "0")] = clone(template);
      slots = stackSlots(node, workflow);
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
        node.inputs[slot.namePath] = loraDisplayName(l.name, "file");
        for (const key of slot.strengthPaths) node.inputs[key] = l.strength;
        for (const key of slot.clipPaths) node.inputs[key] = l.clip !== undefined ? l.clip : l.strength;
        if (slot.switchPath) node.inputs[slot.switchPath] = on;
      } else if (slot.switchPath) node.inputs[slot.switchPath] = off;
      else { node.inputs[slot.namePath] = "None"; for (const key of slot.strengthPaths) node.inputs[key] = 0; for (const key of slot.clipPaths) node.inputs[key] = 0; }
    });
    if (Object.hasOwn(node.inputs, "lora_count") && typeof node.inputs.lora_count === "number") node.inputs.lora_count = loras.length;
  }

  function apply(workflow, slots, overrides, options = {}) {
    const resolved = normalize(slots, workflow, options), notices = [];
    const clean = normalizeOverrides(overrides);
    const result = clone(workflow || {});
    if (clean.model !== undefined) {
      if (!resolved.model.enabled) fail("当前工作流没有可写入的模型槽");
      writeField(result, resolved.model.nodeId, resolved.model.path, clean.model);
    }
    if (clean.loras !== undefined) {
      const lora = resolved.lora;
      if (lora.mode === "off") { if (clean.loras.length) fail("当前工作流没有可写入的 LoRA 槽"); }
      else if (lora.mode === "syntax") applySyntax(result, lora, clean.loras, notices);
      else if (lora.mode === "chain") applyChain(result, lora, clean.loras, notices);
      else applyStack(result, lora, clean.loras);
    }
    return { workflow: result, notices, slots: resolved, overrides: clean };
  }

  function describe(slots) {
    const parts = [];
    if (slots?.model?.enabled) parts.push("模型槽 → #" + slots.model.nodeId + " · " + slots.model.path);
    const lora = slots?.lora;
    if (lora && lora.mode !== "off") parts.push("LoRA 槽 → " + ({ syntax: "语法注入", chain: "节点链", stack: "堆栈" })[lora.mode] + " #" + lora.nodeId + (lora.path ? " · " + lora.path : ""));
    return parts.join(" · ");
  }

  return { MAX_LORAS, MODEL_EXT, NOT_MODEL_FILE, catalogFromObjectInfo, modelCandidates, syntaxCandidates, stackCandidates, orderedChain, detect, normalize, parseLoraSyntax, formatTag, loraStem, loraDisplayName, currentModel, currentLoras, normalizeOverrides, apply, describe, numberText };
})();
