"use strict";

/*
 * Workflow workbench — workspace 3 ("工作流与 API 配置").
 *
 * One flat page:
 *   bar      → compact single line: small title + (?) help, connection status, primary "添加工作流"
 *   library  → left rail that stays collapsed; it slides out when the pointer nears the left edge
 *              and can be pinned open (remembered per browser)
 *   editor   → mapping table | step-by-step inspector (① 写到哪里 ② 填什么 ③ 效果预览)
 *
 * Toolbar policy: only 搜索 / 筛选 / 添加映射 / 一帧试跑 stay visible. Workflow-level utilities live in
 * the ⋯ menu; edit / management actions for a row or a library item live in a dedicated right-click
 * context menu (also reachable from the hover "⋯" button on each row for touch and keyboard users).
 *
 * All rendering is string templates patched through patchMain(); the imperative behaviour (menus,
 * rail hover, live echoes) lives in installWorkflowWorkbench() which wraps handleAction.
 */

const WORKBENCH_PREF_PREFIX = "mio.workflow.";
function workbenchPref(key, fallback) {
  try {
    const raw = localStorage.getItem(WORKBENCH_PREF_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function setWorkbenchPref(key, value) {
  try {
    localStorage.setItem(WORKBENCH_PREF_PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode: the preference simply lives for this session */
  }
}

const mapperUI = {
  selected: "",
  search: "",
  filter: "all",
  tab: "bindings",
  nodes: false,
  selMode: false,
  sel: new Set(),
  libSelMode: false,
  libSel: new Set(),
  libSearch: "",
  healthOpen: false,
  connectionOpen: false,
  // The library is a permanent column unless the user explicitly folds it into the edge tab.
  railPinned: workbenchPref("railPinned", true) !== false,
  showTargets: workbenchPref("showTargets", false) === true,
  railOpen: false,
  customPath: "",
};

/* What a binding source means, in the words the inspector uses. `what` is a noun phrase so it
   can be dropped into "把 <what> 写入 <target>"; `explain` is the single plain sentence shown under
   step ② (it replaces the old 生效时机 / 作用范围 / 来源 fact list). */
const SOURCE_META = {
  positive: { what: "这一幕的正向提示词", when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊里每幕的正向提示词，变量已展开", explain: "每一幕生成前，把分镜工坊里这一幕的正向提示词（变量已展开）写进这个输入框，所以每幕内容都不同。" },
  negative: { what: "这一幕的负向提示词", when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊的负向提示词；留空时使用全局负向", explain: "每一幕生成前，写入这一幕的负向提示词；这一幕没有填写时，改用全局负向提示词。" },
  caption: { what: "这一幕的台词 / 旁白", when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊的台词输入框", explain: "每一幕生成前，写入这一幕在分镜工坊里填写的台词 / 旁白。" },
  sceneName: { what: "分幕名称", when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊当前分幕的名称", explain: "每一幕生成前，写入这一幕的名称。" },
  sceneParameter: { what: "分镜画面参数", when: "仅覆盖时", scope: "逐幕不同", who: "分镜画面参数；未开启覆盖的分幕保持原值", explain: "只有分幕开启了「画面参数覆盖」时才写入；没开启的分幕保持蓝图原值（种子例外：每幕都会写入一个新种子）。" },
  variable: { what: "预设变量", when: "装配时", scope: "随预设", who: "视觉预设工坊里定义的变量", explain: "装配时，从所选视觉预设里读取这个变量的值写入；预设没有这个变量时跳过不写。" },
  bookTitle: { what: "画册标题", when: "任务开始时", scope: "整本一致", who: "装配时填写的画册名称", explain: "任务开始时，把装配时填写的画册名称写入，整本画册一致。" },
  image: { what: "角色立绘或参考图", when: "装配时", scope: "随角色", who: "角色资产中的参考图像", explain: "装配时，把角色资产里的立绘 / 参考图上传到 ComfyUI 后写入；没有图片时跳过不写。" },
  literal: { what: "这里填写的固定值 / 模板", when: "始终写入", scope: "始终生效", who: "在右侧直接填写", explain: "每次生成都写入这里填写的固定内容；可以用 {变量名} 引用预设变量。" },
  random: { what: "新生成的随机种子", when: "每次生成前", scope: "每次不同", who: "按时间戳自动计算", explain: "每次生成前自动换一个随机种子写入。" },
  inherit: { what: "蓝图原值", when: "不写入", scope: "不修改", who: "ComfyUI 原始蓝图", explain: "不写入任何内容，保持蓝图里原来的值——相当于暂时关闭这条映射。" },
};

/* Short tag shown in the table's value column, plus a colour family per origin. */
const SOURCE_TAG = {
  positive: "正向提示词",
  negative: "负向提示词",
  caption: "台词",
  sceneName: "分幕名称",
  sceneParameter: "分镜参数",
  variable: "预设变量",
  bookTitle: "画册标题",
  image: "参考图",
  literal: "固定值",
  random: "随机种子",
  inherit: "保持原值",
};
const SOURCE_GROUP = {
  positive: "scene", negative: "scene", caption: "scene", sceneName: "scene", sceneParameter: "scene",
  variable: "preset", bookTitle: "preset", image: "preset",
  literal: "fixed", random: "fixed", inherit: "inert",
};

const WORKFLOW_ICONS = {
  alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17.2v.3"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4L4 5Z"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  pin: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/><path d="M12 15v6"/>',
  pinned: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z" fill="currentColor"/><path d="M12 15v6"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17v.3"/>',
  rename: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="M13 7l4 4"/>',
  layers: '<path d="M12 4 3 9l9 5 9-5-9-5Z"/><path d="m3 14 9 5 9-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.3"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18Z"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="M11 11 20 2"/><path d="m16 6 3 3M14 8l2 2"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.3M11 10h.3M15 10h.3M7 14h10"/>',
};

/* ------------------------------------------------------------------ data helpers */

function mapperSelectedBinding() {
  const c = state.settings.comfy;
  const list = Array.isArray(c?.bindings) ? c.bindings : [];
  return list.find((b) => b.id === mapperUI.selected) || list[0];
}

function mapperBindingIssues() {
  const c = state.settings.comfy,
    issues = validateMappingTargets(c.workflow, Array.isArray(c?.bindings) ? c.bindings : []);
  if (c.outputNodeId && !Object.hasOwn(c.workflow || {}, c.outputNodeId))
    issues.push({ id: "", kind: "output", message: "指定的结果图片节点 #" + c.outputNodeId + " 不存在。" });
  const plan=c.slots?.plan;
  for(const t of plan?.model.targets||[])if(t.enabled&&!Object.hasOwn(c.workflow[t.nodeId]?.inputs||{},t.path))issues.push({id:'',kind:'slot-model',message:'目标不在蓝图中：'+t.key});
  for(const g of plan?.lora.groups||[])if(g.enabled&&g.sites.some(x=>!Object.hasOwn(c.workflow[x.nodeId]?.inputs||{},x.path)))issues.push({id:'',kind:'slot-lora',message:'应用点不在蓝图中：'+g.key});
  return issues;
}

/* ------------------------------------------------------------------ semantic slots */

const SLOT_MODE_LABEL = { syntax: "语法注入", chain: "节点链", stack: "堆栈节点", off: "关闭" };
const SLOT_KIND_LABEL = { checkpoint: "Checkpoint", unet: "扩散模型 / UNet", model: "模型文件" };

function slotKindLabel(kind) {
  return SLOT_KIND_LABEL[kind] || SLOT_KIND_LABEL.model;
}

/* Detection + stored choice, resolved once per render. */
function slotView(c = state.settings.comfy) {
  const resolved=comfySlotsResolved(c);
  return {resolved,plan:resolved.plan,currentModel:WorkflowSlots.currentModel(c.workflow,resolved),currentLoras:WorkflowSlots.currentLoras(c.workflow,resolved)};
}

function mapperSlotItems(c, issues) {
  const v = slotView(c);
  return ['model', 'lora'].map(kind => {
    const slot = v.resolved[kind], id = `__slot_${kind}__`;
    const enabled = kind === 'model' ? slot.enabled : slot.mode !== 'off';
    const detail = kind === 'model'
      ? (!slot.nodeId ? '尚未识别模型加载节点' : enabled ? '装配时可替换底模' : '保持蓝图里的模型')
      : (!enabled ? '此蓝图没有可用的 LoRA 应用点' : v.currentLoras.length ? `蓝图自带 ${v.currentLoras.length} 个，装配时可追加或解锁` : '装配时可追加 LoRA');
    const current = kind === 'model' ? (v.currentModel ? WorkflowSlots.loraStem(v.currentModel) : '') : v.currentLoras.map(l => WorkflowSlots.loraStem(l.name)).join('、');
    const target = mapperUI.showTargets && slot.nodeId ? `#${slot.nodeId} · ${slot.path}${current ? ' · ' + current : ''}` : '';
    return {id, kind, group: 'model', label: kind === 'model' ? '基础模型' : 'LoRA',
      tag: kind === 'model' ? '模型' : '风格叠加', tone: 'model', detail, target, enabled,
      issue: issues.find(i => i.kind === 'slot-' + kind), search: [slot.nodeId, slot.path, current, detail].join(' ')};
  });
}
function mapperItemMatches(item) {
  return (mapperUI.filter !== 'enabled' || item.enabled) && (mapperUI.filter !== 'disabled' || !item.enabled) &&
    (mapperUI.filter !== 'issues' || item.issue) && (!mapperUI.search.trim() || [item.label,item.tag,item.search].join(' ').toLowerCase().includes(mapperUI.search.trim().toLowerCase()));
}
/* One row component for semantic slots and ordinary bindings: status glyph, name + a one-line summary of what is
   written, a colour-coded purpose tag, the switch and an edit button. Node IDs appear only on demand. */
function renderUnifiedMappingRow(item) {
  const selected = mapperUI.selected === item.id, picked = mapperUI.sel.has(item.id), action = item.kind ? 'wm-select-slot' : 'wm-select', key = item.kind || item.id;
  return `<article class="wm-row wf-row ${item.kind ? 'wf-row-slot' : ''} ${selected ? 'selected' : ''} ${picked ? 'is-picked' : ''} ${item.enabled ? '' : 'is-off'} ${item.issue ? 'has-issue' : ''}" data-binding-row="${esc(item.id)}" ${item.kind ? `data-slot-row="${item.kind}"` : ''}>
    <span class="wf-row-lead"><input type="checkbox" class="sel-cbox" ${picked ? 'checked' : ''} data-act="wm-pick" data-id="${esc(item.id)}" aria-label="选择${esc(item.label)}"><span class="wf-row-glyph ${item.issue ? 'is-bad' : item.enabled ? 'is-on' : 'is-off'}" title="${esc(item.issue?.message || (item.enabled ? '已启用' : '已停用'))}">${icon(item.issue ? 'alert' : item.enabled ? 'check' : 'pause','sm')}</span></span>
    <button type="button" class="wm-row-select wf-row-main" data-act="${action}" data-id="${esc(key)}" aria-pressed="${selected}"><span class="wf-row-name" data-user-content>${esc(item.label)}</span>${item.issue ? `<span class="wf-row-warning">${esc(item.issue.message || '需要检查配置')}</span>` : item.detail ? `<span class="wf-row-sub" data-user-content>${esc(item.detail)}</span>` : ''}</button>
    <span class="wf-row-source"><span class="wf-tag tag-${esc(item.tone || 'fixed')}">${esc(item.tag)}</span>${item.target ? `<span class="wf-row-target mono">${esc(item.target)}</span>` : ''}</span>
    <label class="switch wf-row-switch"><input type="checkbox" role="switch" ${item.kind ? `data-v3-slot="${item.kind}.enabled"` : `data-v3-binding="enabled" data-id="${esc(item.id)}"`} ${item.enabled ? 'checked' : ''} aria-label="启用${esc(item.label)}"><span class="switch-track"></span></label>
    <button type="button" class="ibtn wf-edit-row" data-act="${action}" data-id="${esc(key)}" aria-label="编辑${esc(item.label)}">${icon('edit','sm')}</button>
  </article>`;
}
function renderSlotRows(c, issues) {
  return mapperSlotItems(c, issues).filter(mapperItemMatches).map(renderUnifiedMappingRow).join('');
}

const SLOT_ROLE_LABEL = { primary: '主模型', same: '同名副本', other: '其他模型', 'linked-unwritable': '已连线 · 只读' };
const SLOT_LORA_KIND_LABEL = { chain: '节点链', stack: '堆栈节点', syntax: '语法注入', object: '对象参数', embedded: '内嵌参数' };

function renderSlotInspector(kind, c) {
  const plan = slotView(c).plan,
    label = kind === 'model' ? '基础模型' : 'LoRA',
    tools = `<div class="wf-slot-tools">${btn('重新分析','refresh','wf-slots-analyze','','small')}${btn('手动指定','plus','wf-slots-manual','','small ghost')}</div>`;
  const head = `<header class="wf-detail-head"><span class="context-kicker">语义槽位</span><span class="spacer"></span>${tools}</header><h3 class="wf-detail-static">${label}</h3>`;
  if (!plan) return `<section class="wf-inspector-card wf-slot-inspector">${head}<p class="wf-contract is-todo">尚未取得分析计划。确认 Mio 后端已启动，然后点「重新分析」。</p></section>`;
  const summary = `<p class="wf-contract">${esc(WorkflowSlots.describe({plan}))}</p>`;
  const issues = plan.issues.length
    ? `<details class="wf-advanced wf-slot-issues"><summary>分析提示 <b>${plan.issues.length}</b></summary><ul>${plan.issues.map(i=>`<li><code>${esc(i.code)}</code>${i.nodeId ? ` #${esc(i.nodeId)}` : ''} · ${esc(i.text)}</li>`).join('')}</ul></details>`
    : '';
  if (kind === 'model') {
    const targets = plan.model.targets.map(t => `<label class="wf-slot-card ${t.enabled ? 'is-on' : ''} ${t.role === 'linked-unwritable' ? 'is-locked' : ''}">
        <input type="checkbox" data-slot-plan-kind="model" data-slot-plan-key="${esc(t.key)}" ${t.enabled ? 'checked' : ''} ${t.role === 'linked-unwritable' ? 'disabled' : ''}>
        <span class="wf-slot-card-body">
          <span class="wf-slot-card-head"><b data-user-content>${esc(t.title || ('#' + t.nodeId))}</b><em class="wf-slot-role role-${esc(t.role)}">${esc(SLOT_ROLE_LABEL[t.role] || t.role)}</em>${t.pairedSelector ? '<em class="wf-slot-role">成对模型</em>' : ''}</span>
          ${t.current ? `<span class="wf-slot-file" data-user-content>${esc(WorkflowSlots.loraStem(t.current))}</span>` : ''}
          <code>${esc(t.key)}</code>
          ${t.reason ? `<small>${esc(t.reason)}</small>` : ''}
        </span>
      </label>`).join('');
    return `<section class="wf-inspector-card wf-slot-inspector">${head}${summary}
      <h4 class="wf-section"><span>写入目标</span><small>装配时替换勾选节点里的模型文件</small></h4>
      <div class="wf-slot-list">${targets || '<p class="wf-step-placeholder">没有识别到模型加载节点。可以「手动指定」模型字段。</p>'}</div>${issues}</section>`;
  }
  const groups = plan.lora.groups.map(g => `<article class="wf-slot-card ${g.enabled ? 'is-on' : ''}">
      <label class="wf-slot-card-toggle"><input type="checkbox" data-slot-plan-kind="lora" data-slot-plan-key="${esc(g.key)}" ${g.enabled ? 'checked' : ''}>
        <span class="wf-slot-card-head"><b>${esc(SLOT_LORA_KIND_LABEL[g.kind] || g.kind)}</b><em class="wf-slot-role">${esc(g.series)}</em><em class="wf-slot-role ${g.active ? 'role-primary' : ''}">${g.active ? '活跃' : '不活跃'}</em><em class="wf-slot-role">${g.append ? '追加入口' : '保留原条目'}</em></span></label>
      <div class="wf-slot-card-body">
        <span class="wf-slot-meta">来源 ${esc(g.origin ? '#' + g.origin.nodeId + ' · ' + g.origin.path : '不可写来源，断链直写')}</span>
        <ul class="wf-slot-sites">${g.sites.map(x => `<li><code>#${esc(x.nodeId)} · ${esc(x.path)}</code>${x.reason ? ` <small>${esc(x.reason)}</small>` : ''}</li>`).join('')}</ul>
        ${g.pinned.length ? `<div class="wf-slot-pins">${g.pinned.map(l => `<span data-user-content>${esc(WorkflowSlots.loraStem(l.name))} <b>×${esc(WorkflowSlots.numberText(l.strength ?? 1))}</b></span>`).join('')}</div>` : '<span class="wf-slot-meta">没有蓝图自带的 LoRA</span>'}
        ${g.warn ? `<p class="wf-warning">${icon('alert','sm')}<span>${esc(g.warn)}</span></p>` : ''}
        <code class="wf-slot-key">${esc(g.key)}</code>
      </div>
    </article>`).join('');
  const synth = plan.lora.synth ? `<p class="wf-step-note">没有活跃应用点：提交时在 #${esc(plan.lora.synth.after.nodeId)} 后插入 ${esc(plan.lora.synth.classType)}。</p>` : '';
  const off = !plan.lora.enabled ? `<p class="wf-warning">${icon('alert','sm')}<span>${esc(plan.lora.reason)}</span></p>` : '';
  return `<section class="wf-inspector-card wf-slot-inspector">${head}${summary}
    <h4 class="wf-section"><span>应用组</span><small>装配时在勾选的位置追加或替换 LoRA</small></h4>
    <div class="wf-slot-list">${groups || '<p class="wf-step-placeholder">没有识别到 LoRA 节点。</p>'}</div>${synth}${off}${issues}</section>`;
}
function applySlotControl(key, el) {
  const c=state.settings.comfy,plan=c.slots?.plan,[kind]=key.split('.');
  if(!plan)return;
  for(const entry of plan[kind][kind==='model'?'targets':'groups'])if(entry.role!=='linked-unwritable'){entry.enabled=el.checked;entry.disabled=!el.checked;}
  if(kind==='lora'&&plan.lora.synth)plan.lora.synth.enabled=el.checked;
  storeActiveWorkflow();save();render();
}

/* Bindings that survive the current filter + search. Shared with the bulk "全选" action. */
function mapperVisibleBindings(c = state.settings.comfy, issues = mapperBindingIssues()) {
  const query = mapperUI.search.trim().toLowerCase();
  const list = Array.isArray(c?.bindings) ? c.bindings : [];
  return list.filter((b) => {
    if (mapperUI.filter === "enabled" && !b.enabled) return false;
    if (mapperUI.filter === "disabled" && b.enabled) return false;
    if (mapperUI.filter === "issues" && !issues.some((i) => i.id === b.id)) return false;
    if (!query) return true;
    return [b.label, b.nodeId, b.path, b.value, c.workflow[b.nodeId]?.class_type, c.workflow[b.nodeId]?._meta?.title, SOURCE_TAG[b.source]]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function mapperSourceLabel(b) {
  if (b.source === "variable") return "{" + b.value + "}";
  if (b.source === "literal") return String(b.value ?? "");
  if (b.source === "sceneParameter") return String(b.value || "");
  return SOURCE_META[b.source]?.what || bindingSources[b.source] || b.source;
}

function mapperTimingLabel(b) {
  return SOURCE_META[b.source]?.when || "生成时";
}

function workflowNodeLabel(workflow, id) {
  const n = workflow?.[id];
  return n ? n._meta?.title || n.class_type : "";
}

function workflowReferenced(id) {
  return state.creation.plans.some(
    (pl) => pl.workflowId === id || Object.values(pl.sceneOverrides || {}).some((o) => o.workflowId === id)
  );
}

function workflowDuplicateTitles(presets) {
  const seen = new Map();
  presets.forEach((p) => {
    const key = String(p.title || "").trim().toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/* Connection line: mock → offline demo, live socket → connected, otherwise the last
   explicit check for this address, otherwise "on demand" (never alarming before a check). */
/* ------------------------------------------------------------------ connection & channels */

/* Every explicit probe is remembered per address, so the bar and the panel can show latency, VRAM
   and how long ago the service answered instead of re-parsing a message string. */
const connectionUI = { checking: false, results: new Map() };

const CHANNEL_META = {
  comfyui: { icon: "nodes", label: "ComfyUI", hint: "本地或局域网的工作流引擎" },
  novelai: { icon: "image", label: "NovelAI", hint: "图像 API，无需工作流" },
  openai: { icon: "cloud", label: "OpenAI 兼容", hint: "Images / Chat Completions 接口" },
};

function connectionKey(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function connectionRecord(baseUrl = state.settings.comfy.baseUrl) {
  return connectionUI.results.get(connectionKey(baseUrl)) || null;
}

function relativeTime(at) {
  const diff = Math.max(0, Date.now() - Number(at || 0));
  if (!at) return "";
  if (diff < 45e3) return "刚刚";
  if (diff < 3600e3) return Math.max(1, Math.round(diff / 60e3)) + " 分钟前";
  if (diff < 86400e3) return Math.round(diff / 3600e3) + " 小时前";
  return new Date(at).toLocaleDateString();
}

function connectionBits(rec) {
  const bits = [];
  if (Number.isFinite(rec?.latencyMs)) bits.push(rec.latencyMs + " ms");
  if (Number.isFinite(rec?.vramPercent)) bits.push("VRAM " + rec.vramPercent + "%");
  return bits;
}

/* What the bar says: the run mode first, then whatever the last probe or the live socket knows. */
function workflowConnectionStatus() {
  const c = state.settings.comfy,
    rec = connectionRecord(c.baseUrl);
  if (connectionUI.checking) return { tone: "idle", label: "检查中…", detail: "" };
  if (rt.connected) {
    const bits = connectionBits({ latencyMs: rt.latency ?? rec?.latencyMs, vramPercent: rt.vram ?? rec?.vramPercent });
    return { tone: "ok", label: "已连接", detail: bits.join(" · ") };
  }
  if (rec) {
    if (rec.ok) return { tone: "ok", label: "服务可读", detail: [...connectionBits(rec), relativeTime(rec.at)].filter(Boolean).join(" · "), full: rec.message };
    return { tone: "bad", label: "连接失败", detail: rec.message, full: rec.message };
  }
  return { tone: "idle", label: "按需连接", detail: "尚未检查；开始生成时会自动连接" };
}

/* What the panel's status line says: only the probe result, independent of the run mode. */
function workflowProbeStatus() {
  const c = state.settings.comfy,
    rec = connectionRecord(c.baseUrl);
  if (connectionUI.checking) return { tone: "idle", label: "检查中…", detail: "正在通过 Mio 后端读取 /system_stats" };
  if (!rec) return { tone: "idle", label: "尚未检查", detail: "点「检查连接」只读取服务状态，不会生成图片" };
  if (rec.ok) return { tone: "ok", label: "服务可读", detail: [...connectionBits(rec), rec.device, relativeTime(rec.at)].filter(Boolean).join(" · ") };
  return { tone: "bad", label: "连接失败", detail: rec.message };
}

/* Every probe lands here — boot, the 30 s poll in app.js and the 检查连接 button — so all views read one record. */
function onEngineChecked(rec) {
  if (!rec) return;
  const key = connectionKey(rec.baseUrl);
  connectionUI.results.set(key, rec);
  if (key === connectionKey(state.settings.comfy.baseUrl)) firstRunUI.checks.set(state.settings.comfy.baseUrl, rec.ok ? rec.message : "连接失败：" + rec.message);
  refreshConnectionViews();
}

async function checkWorkflowConnection() {
  if (connectionUI.checking) return null;
  const baseUrl = connectionKey(state.settings.comfy.baseUrl);
  connectionUI.checking = true;
  refreshConnectionViews();
  let rec;
  try {
    rec = await probeComfy(baseUrl);
  } finally {
    connectionUI.checking = false;
  }
  if (typeof hideTip === "function") hideTip();
  applyEngineProbe(rec);
  if (!rec.ok) toast("连接失败：" + rec.message, "error");
  return rec;
}

/* Patch the connection views in place: the 30 s poll must not steal focus from someone typing in the form. */
function refreshConnectionViews() {
  const strip = document.querySelector(".wf-bar .wf-connection");
  if (!strip) return;
  const focused = document.activeElement?.closest?.(".wf-bar .wf-connection [data-act]")?.dataset.act;
  strip.outerHTML = renderConnectionStrip();
  if (focused) document.querySelector(`.wf-bar .wf-connection [data-act="${focused}"]`)?.focus({ preventScroll: true });
  const probe = document.getElementById("setup-comfy-status");
  if (probe) probe.outerHTML = renderProbeLine();
  const check = document.querySelector('#wf-connection-body [data-act="wf-check-connection"]');
  if (check) {
    const hadFocus = document.activeElement === check;
    check.outerHTML = renderCheckButton();
    if (hadFocus) document.querySelector('#wf-connection-body [data-act="wf-check-connection"]')?.focus({ preventScroll: true });
  }
  const card = document.querySelector("#wf-connection-body .wf-status-card");
  if (card && activeImageProfile().provider === "comfyui") card.outerHTML = renderComfyStatusCard();
}

/* ------------------------------------------------------------------ page */

const WORKBENCH_HELP = {
  comfy: "把分镜里的提示词、参数与素材接到 ComfyUI 节点上。映射与原始蓝图分开保存，改动不会影响已入队的任务。",
  cloud: "当前使用云端图像渠道，不需要 ComfyUI 工作流。填好地址、模型与密钥，就可以去编写分镜。",
};

/* Editorial heading shared by every channel: kicker, serif title, one sentence, and at most two global actions. */
function renderWorkbenchTitle(comfy) {
  return `<div class="wf-bar-title">
      <span class="context-kicker">图像生产 · 渠道与工作流</span>
      <div class="wf-bar-heading">
        <h1>工作流与 API 配置</h1>
        <button type="button" class="wf-help" data-act="wf-help" aria-label="这个页面做什么？" title="${esc(comfy ? WORKBENCH_HELP.comfy : WORKBENCH_HELP.cloud)}">${icon("question", "sm")}</button>
      </div>
      <p class="wf-bar-lede">${comfy ? "连接本机 ComfyUI，把分镜里的提示词、模型与参数接到工作流节点上。" : "填写服务地址、模型与密钥；云端渠道不需要 ComfyUI 工作流。"}</p>
    </div>`;
}

/* Compact live status next to the title: one line, click to fold the connection card, ↻ to probe again. */
function renderConnectionStrip() {
  const status = workflowConnectionStatus(),
    c = state.settings.comfy,
    open = mapperUI.connectionOpen,
    checking = connectionUI.checking;
  return `<div class="wf-connection wm-connection tone-${status.tone}" data-wm-connection ${open ? "open" : ""}>
        <button type="button" class="wf-connection-summary" data-act="wf-connection-toggle" aria-expanded="${open}" aria-controls="wf-connection-body" title="${esc(status.full || status.detail || "")}">
          <i class="wf-dot" aria-hidden="true"></i>
          <span class="wf-connection-main"><strong>ComfyUI</strong><span class="wf-connection-url mono">${esc(c.baseUrl || "未填写地址")}</span></span>
          <span class="wf-connection-state"><b>${esc(status.label)}</b>${status.detail ? `<span class="wf-connection-detail">${esc(status.detail)}</span>` : ""}</span>
          <span class="wf-connection-more">${icon(open ? "up" : "down", "sm")}</span>
        </button>
        <button type="button" class="ibtn wf-connection-check ${checking ? "is-busy" : ""}" data-act="wf-check-connection" aria-label="${checking ? "正在检查 ComfyUI 连接" : "重新检查 ComfyUI 连接"}" data-tip="${checking ? "正在检查…" : "重新检查连接"}" ${checking ? "disabled" : ""}>${icon("refresh", "sm")}</button>
      </div>`;
}

function renderProbeLine() {
  const probe = workflowProbeStatus();
  return `<p id="setup-comfy-status" class="wf-probe tone-${probe.tone}" role="status" aria-live="polite"><i class="wf-dot" aria-hidden="true"></i><b>${esc(probe.label)}</b>${probe.detail ? `<span>${esc(probe.detail)}</span>` : ""}</p>`;
}

function renderCheckButton() {
  const checking = connectionUI.checking;
  return btn(checking ? "检查中…" : "检查连接", "refresh", "wf-check-connection", checking ? "disabled" : "", "small" + (checking ? " is-busy" : ""));
}

function renderWorkflowLibrary() {
  const profile = activeImageProfile(),
    comfy = profile.provider === "comfyui";
  if (!comfy) return renderCloudPage(profile);

  const c = state.settings.comfy,
    open = mapperUI.connectionOpen,
    count = (c.presets || []).length;
  return `<section class="wf-page wf-page-comfy">
    <header class="wf-bar">
      ${renderWorkbenchTitle(true)}
      <div class="wf-bar-side">
        <div class="wf-bar-actions">${btn("槽位预设", "layers", "wf-presets", 'title="常用槽位与写入规则，配置一次，应用到任意工作流"', "small")}${btn("添加工作流", "plus", "ws-open-unified-import", 'aria-label="添加工作流（导入 API 工作流或映射包）"', "primary small")}</div>
        ${renderConnectionStrip()}
      </div>
    </header>
    ${renderChannelNavigation()}
    <div class="wf-connection-body" id="wf-connection-body" ${open ? "" : "hidden"}>${renderConnectionPanel(profile)}</div>
    <div class="workflow-library wf-body ${mapperUI.railPinned ? "rail-pinned" : "rail-floating"} ${mapperUI.railOpen && !mapperUI.railPinned ? "rail-open" : ""} ${mapperUI.railSticky && !mapperUI.railPinned ? "rail-sticky" : ""}">
      <div class="wf-rail-dock" id="wf-rail-dock" data-no-tip>
        <button type="button" class="wf-rail-handle" data-act="wf-rail-toggle" aria-expanded="${mapperUI.railOpen || mapperUI.railPinned}" aria-controls="wf-rail" aria-label="工作流库，${count} 份">
          ${icon("sidebar", "sm")}<span class="wf-rail-handle-label">工作流库</span><b class="mono">${count}</b>
        </button>
        ${renderWorkflowRail(c)}
      </div>
      <div class="wf-main">${renderSmartMapper()}</div>
    </div>
  </section>`;
}

/* Cloud channels have no blueprint: the page is the channel form plus a readiness card. */
function renderCloudPage(profile) {
  const issues = providerSetupIssues(profile),
    meta = CHANNEL_META[profile.provider] || CHANNEL_META.openai;
  let host = "";
  try {
    host = new URL(profile.baseUrl).host;
  } catch {
    host = profile.baseUrl ? "地址无效" : "未填写地址";
  }
  return `<section class="wf-page wf-page-cloud">
    <header class="wf-bar">
      ${renderWorkbenchTitle(false)}
      <div class="wf-bar-side">
        <div class="wf-bar-actions">${btn("编写分镜", "arrow", "first-run-continue", "", issues.length ? "small" : "primary small")}</div>
        <div class="wf-connection wm-connection tone-${issues.length ? "idle" : "ok"}" data-wm-connection>
          <span class="wf-connection-summary is-static">
            <i class="wf-dot" aria-hidden="true"></i>
            <span class="wf-connection-main"><strong data-user-content>${esc(profile.title || meta.label)}</strong><span class="wf-connection-url mono">${esc(host)}</span></span>
            <span class="wf-connection-state"><b>${issues.length ? "还差几步" : "渠道就绪"}</b><span class="wf-connection-detail">${esc(meta.label)} · ${issues.length ? issues.length + " 项待填写" : "可以开始生成"}</span></span>
          </span>
        </div>
      </div>
    </header>
    ${renderChannelNavigation()}
    <div class="wf-provider">${renderConnectionPanel(profile)}</div>
  </section>`;
}

/* ------------------------------------------------------------------ connection panel */

/* One line of state under each channel name, so switching is informed instead of blind. */
function channelTabState(p) {
  if (p.provider === "comfyui") {
    const status = workflowConnectionStatus();
    return { tone: status.tone, text: status.tone === "ok" ? "已连接" : status.tone === "bad" ? "连接失败" : "本机工作流" };
  }
  const issues = providerSetupIssues(p);
  return issues.length ? { tone: "idle", text: issues.length + " 项待填写" } : { tone: "ok", text: "渠道就绪" };
}

function renderChannelNavigation() {
  const g = ensureImageProviders();
  const tab = (p) => {
    const on = p.id === g.active,
      meta = CHANNEL_META[p.provider] || CHANNEL_META.openai,
      st = channelTabState(p);
    return `<button type="button" class="wf-channel-tab ${on ? "active" : ""}" data-act="wf-channel-switch" data-id="${esc(p.id)}" aria-pressed="${on}" title="${esc(meta.hint)}">
        <span class="wf-channel-glyph">${icon(meta.icon || "cloud", "sm")}</span>
        <span class="wf-channel-text"><span class="wf-channel-name" data-user-content>${esc(p.title)}</span><small class="tone-${st.tone}"><i class="wf-dot" aria-hidden="true"></i>${esc(st.text)}</small></span>
        ${on ? `<span class="wf-channel-check">${icon("check", "sm")}</span>` : ""}
      </button>`;
  };
  return `<nav class="wf-channel-nav" aria-label="图像渠道"><div class="wf-channel-nav-label"><span class="context-kicker">生成服务</span><strong>切换渠道</strong></div><div class="wf-channel-tabs">${g.profiles.map(tab).join("")}</div><div class="wf-channel-nav-actions">${btn("新增渠道", "plus", "image-provider-new", "", "small ghost")}${activeImageProfile().provider !== "comfyui" ? btn("管理渠道", "more", "wf-channel-menu", "", "small ghost") : ""}</div></nav>`;
}

function renderConnectionPanel(profile = activeImageProfile()) {
  const comfy = profile.provider === "comfyui";
  return `<div class="wf-conn image-provider-panel ${comfy ? "is-comfy" : "is-cloud"}">
    <div class="wf-conn-grid">
      <div class="wf-conn-form">${comfy ? renderComfyChannelForm() : renderCloudChannelForm(profile)}</div>
      <aside class="wf-conn-aside">${comfy ? renderComfyStatusCard() : renderCloudReadiness(profile)}</aside>
    </div>
  </div>`;
}

function renderComfyChannelForm() {
  const c = state.settings.comfy;
  return `<div class="wf-conn-field">
      <label class="wf-section-label" for="setup-comfy-url">ComfyUI 服务地址</label>
      <div class="wf-url-line">
        <input id="setup-comfy-url" type="url" value="${esc(c.baseUrl || "")}" placeholder="http://127.0.0.1:8188" spellcheck="false" autocomplete="off" inputmode="url">
        ${renderCheckButton()}
      </div>
      ${renderProbeLine()}
    </div>
    <ul class="wf-conn-notes">
      <li>${icon("shield", "xs")}<span>连通性由 Mio 后端检查，浏览器不会直接访问 ComfyUI，无需 <code>--enable-cors-header</code>。</span></li>
      <li>${icon("info", "xs")}<span>地址只填到端口，不含路径、密钥或查询参数；局域网主机填写其 IP。</span></li>
      <li>${icon("refresh", "xs")}<span>「同步节点定义」读取 <code>/object_info</code>：字段类型、模型与 LoRA 目录。结果缓存在本机，可随时重新同步。</span></li>
    </ul>`;
}

function renderComfyStatusCard() {
  const c = state.settings.comfy,
    status = workflowConnectionStatus(),
    rec = connectionRecord(c.baseUrl),
    catalog = comfyModelCatalog(),
    synced = catalog.nodeClasses > 0,
    fact = (label, value, cls = "") => `<div class="wf-fact ${cls}"><dt>${label}</dt><dd>${value}</dd></div>`,
    metric = (n, label) => `<span class="wf-metric"><b class="mono">${n}</b><small>${label}</small></span>`;
  return `<div class="wf-status-card tone-${status.tone}">
    <div class="wf-status-head">
      <h3 class="wf-section-label">服务状态</h3>
      <span class="wf-probe tone-${status.tone}"><i class="wf-dot" aria-hidden="true"></i><b>${esc(status.label)}</b></span>
    </div>
    ${status.detail && status.tone !== "bad" ? `<p class="wf-status-detail">${esc(status.detail)}</p>` : status.tone === "bad" ? `<p class="wf-status-detail">检查地址与服务后点「检查连接」；未连接时仍可编辑映射。</p>` : ""}
    <dl class="wf-facts">
      ${rec?.ok && rec.device ? fact("GPU", `<span data-user-content>${esc(rec.device)}</span>`) : ""}
      ${rec?.ok && rec.version ? fact("ComfyUI 版本", `<span data-user-content>${esc(rec.version)}</span>`) : ""}
      ${fact("节点定义", synced ? `${catalog.nodeClasses} 个<small>${esc(relativeTime(catalog.fetchedAt))}同步</small>` : `<span class="muted">尚未同步</span><small>同步后字段列表和类型更准确</small>`)}
    </dl>
    ${synced ? `<div class="wf-metrics" aria-label="本机模型">${metric(catalog.checkpoints.length, "Checkpoint")}${metric(catalog.unets.length, "扩散模型")}${metric(catalog.loras.length, "LoRA")}</div>` : ""}
    <div class="wf-status-actions">
      ${btn(synced ? "重新同步节点定义" : "同步节点定义", "refresh", "v3-read-object-info", 'title="读取 /object_info：字段列表、类型与本机模型目录"', "small")}
      ${btn("编写分镜", "arrow", "first-run-continue", 'title="连接与映射就绪后，去创作工坊写分镜"', "small ghost")}
    </div>
  </div>`;
}

function renderCloudChannelForm(p) {
  const openai = p.provider === "openai",
    images = p.protocol !== "chat",
    busy = imageProviderUI.busy.has(p.id);
  const text = (label, key, extra = "") => `<div class="wf-conn-field">
      <label class="wf-section-label" for="wf-pf-${key}">${label}</label>
      <input id="wf-pf-${key}" type="text" data-image-config="${key}" value="${esc(p[key] || "")}" autocomplete="off" spellcheck="false" ${extra}>
    </div>`;
  const optional = (label, key, flag, placeholder) => `<div class="wf-optional ${p[flag] && images ? "is-on" : ""}">
      <label class="wf-check"><input type="checkbox" data-image-config="${flag}" ${p[flag] ? "checked" : ""} ${!images ? "disabled" : ""}><span>${label}</span></label>
      <input type="text" data-image-config="${key}" value="${esc(p[key] || "")}" placeholder="${placeholder}" aria-label="${label}" ${!p[flag] || !images ? "disabled" : ""}>
    </div>`;
  const model = openai
    ? `<div class="wf-conn-field">
      <label class="wf-section-label" for="image-provider-model-input">模型 ID</label>
      <div class="wf-url-line">
        <div class="provider-model-combobox">
          <input id="image-provider-model-input" type="text" data-image-config="model" value="${esc(p.model || "")}" role="combobox" aria-label="模型 ID" aria-autocomplete="list" aria-expanded="false" aria-controls="image-provider-model-results" autocomplete="off" spellcheck="false">
          <div id="image-provider-model-results" class="provider-model-results" role="listbox" aria-label="匹配模型" hidden></div>
        </div>
        ${btn(busy ? "正在获取…" : "获取模型", "refresh", "image-provider-models", busy ? "disabled" : "", "small")}
      </div>
      <p class="help" id="provider-model-status" role="status"></p>
    </div>`
    : text("模型 ID", "model");
  return `<div class="wf-conn-two">
      ${text("渠道名称", "title", 'data-user-content')}
      ${text(p.provider === "novelai" ? "NovelAI 图像服务地址" : "API 基础地址", "baseUrl", 'inputmode="url" placeholder="https://…/v1"')}
    </div>
    <div class="wf-conn-two">
      ${model}
      ${openai ? `<div class="wf-conn-field"><label class="wf-section-label" for="wf-pf-protocol">接口协议</label><select id="wf-pf-protocol" data-image-config="protocol">${opt("images", "Images API", p.protocol)}${opt("chat", "Chat Completions", p.protocol)}</select></div>` : text("采样器", "sampler")}
    </div>
    <div class="wf-conn-field wf-conn-keys">${imageProviderKeyFields(p)}</div>
    ${openai ? `<div class="wf-conn-field">
      <span class="wf-section-label">请求参数</span>
      ${images
        ? `<div class="wf-conn-two">${optional("输出尺寸", "size", "sendSize", "1024x1024 / auto")}${optional("质量", "quality", "sendQuality", "auto / high")}</div>`
        : `<label class="wf-check"><input type="checkbox" data-image-config="sendAspectHint" ${p.sendAspectHint !== false ? "checked" : ""}><span>把分镜画幅比写进提示词</span></label>
           <p class="help">Chat 协议没有尺寸字段。开启后，每一幕会在提示词末尾追加一句画幅说明，例如 “Output a single portrait image with aspect ratio 13:19 (832x1216).”，让模型按分镜的宽高比出图。</p>`}
    </div>` : ""}
    <details class="quiet-advanced wf-advanced-json">
      <summary>高级请求参数 · JSON</summary>
      <textarea id="provider-extra-params" spellcheck="false" aria-label="高级请求参数">${esc(JSON.stringify(p.extraParams || {}, null, 2))}</textarea>
      <p class="help">会原样合并进每次请求体，用于服务商特有字段。</p>
    </details>`;
}

function renderCloudReadiness(p) {
  const issues = providerSetupIssues(p),
    keys = p.keyMode === "stored" ? (p.keyIds || [p.keyId]).filter(Boolean).length : 0,
    ready = !issues.length;
  let url = null;
  try {
    url = new URL(p.baseUrl);
  } catch {
    url = null;
  }
  const addressIssue = issues.find((i) => /地址|HTTPS/.test(i)),
    items = [
      { ok: !!url && !addressIssue, label: "服务地址", detail: addressIssue || (url ? url.host : "未填写") },
      { ok: !!String(p.model || "").trim(), label: "模型", detail: String(p.model || "").trim() || "未填写模型 ID" },
      { ok: keys > 0, soft: true, label: "API Key", detail: keys ? `已保存 ${keys} 个，请求时轮流使用` : "未保存；本机或局域网服务可留空" },
    ];
  return `<div class="wf-status-card">
    <h3 class="wf-section-label">${ready ? "渠道就绪" : "还差几步"}</h3>
    <ul class="wf-checklist">${items
      .map((i) => `<li class="${i.ok ? "is-ok" : i.soft ? "is-soft" : "is-todo"}">${icon(i.ok ? "check" : i.soft ? "info" : "alert", "xs")}<span><strong>${i.label}</strong><small ${i.ok && i.label !== "API Key" ? "data-user-content" : ""}>${esc(i.detail)}</small></span></li>`)
      .join("")}</ul>
    <p class="help">${ready ? "配置只在你明确开始生成时才会被使用；费用由所选渠道决定。" : "填好后就可以去编写分镜；生成前 Mio 还会再核对一次。"}</p>
    ${p.provider === "openai" ? `<div class="wf-status-actions">${btn("获取模型列表", "refresh", "image-provider-models", 'title="用当前地址和密钥请求 /models，也是最简单的连通性测试"', "small ghost")}</div>` : ""}
  </div>`;
}

/* ------------------------------------------------------------------ library rail */

function workflowRailPresets(c = state.settings.comfy) {
  const query = String(mapperUI.libSearch || "").trim().toLowerCase();
  return (c.presets || []).filter((p) => !query || String(p.title || "").toLowerCase().includes(query));
}

function renderWorkflowRail(c) {
  const presets = c.presets || [],
    filtered = workflowRailPresets(c),
    allPicked = filtered.length > 0 && filtered.every((p) => mapperUI.libSel.has(p.id)),
    searchable = presets.length >= 6 || !!mapperUI.libSearch,
    pinned = mapperUI.railPinned;
  return `<aside class="wf-rail ${mapperUI.libSelMode ? "is-selmode" : ""}" id="wf-rail" aria-label="工作流库">
    <div class="wf-rail-head">
      <span class="context-kicker">工作流库</span>
      <span class="wf-count mono">${presets.length}</span>
      <span class="spacer"></span>
      ${presets.length > 1 ? btn(mapperUI.libSelMode ? "完成" : "选择", "", "ws-lib-sel-toggle", "", "small ghost") : ""}
      ${ibtn(pinned ? "pinned" : "pin", "wf-rail-pin", pinned ? "取消固定：收起为左侧标签" : "固定显示工作流库", `aria-pressed="${pinned}"`)}
    </div>
    ${searchable ? `<label class="wf-search">${icon("search", "sm")}${searchInput({ id: "ws-library-search-input", value: mapperUI.libSearch, placeholder: "查找工作流…", label: "查找工作流", controls: "wf-rail-list" })}</label>` : ""}
    ${selectionBarHTML({ count: mapperUI.libSel.size, unit: "份", allPicked, allAct: "ws-lib-pick-all", deleteAct: "ws-lib-delete-bulk", exitAct: "ws-lib-sel-toggle" })}
    <span id="wf-sr-pick" hidden>选择</span>
    <div class="wf-rail-list" id="wf-rail-list" role="list">${renderWorkflowRailItems(c)}</div>
    <label class="wf-rail-select">
      <span class="context-kicker">当前工作流</span>
      <select id="ws-library-select" aria-label="切换工作流">${presets.map((p) => opt(p.id, p.title || "未命名工作流", c.activeWorkflowId)).join("")}</select>
    </label>
    <div class="wf-rail-foot">
      ${btn("添加", "plus", "ws-open-unified-import", "", "small ghost")}
      ${btn("导出全部", "download", "ws-export-all", "", "small ghost")}
    </div>
    <p class="wf-rail-hint">右键工作流可重命名、复制、导出或删除</p>
  </aside>`;
}

/* A library card says what the blueprint is before you open it: size, mapped inputs, and whether prompts are wired. */
function renderWorkflowRailItems(c = state.settings.comfy) {
  const filtered = workflowRailPresets(c),
    dupes = workflowDuplicateTitles(c.presets || []);
  if (!filtered.length)
    return `<div class="wf-rail-empty"><p>没有匹配的工作流</p>${btn("清除搜索", "", "wf-clear-library-search", "", "small ghost")}</div>`;
  return filtered
    .map((p) => {
      const isCurrent = p.id === c.activeWorkflowId,
        isPicked = mapperUI.libSel.has(p.id),
        title = p.title || "未命名工作流",
        nodes = Object.keys(p.workflow || {}).length,
        bindings = (p.bindings || []).filter((b) => b.enabled).length,
        prompts = (p.bindings || []).some((b) => b.enabled && b.source === "positive"),
        referenced = workflowReferenced(p.id),
        dup = dupes.has(String(p.title || "").trim().toLowerCase());
      return `<div class="workflow-library-item wf-item ${isCurrent ? "active" : ""} ${isPicked ? "is-picked" : ""}" role="listitem" data-workflow-id="${esc(p.id)}">
        <input type="checkbox" class="sel-cbox" ${isPicked ? "checked" : ""} data-act="ws-lib-pick" data-id="${esc(p.id)}" aria-labelledby="wf-sr-pick wf-item-title-${esc(p.id)}">
        <button type="button" class="wf-item-body" data-act="ws-select" data-id="${esc(p.id)}" aria-current="${isCurrent ? "true" : "false"}" title="${esc(title)}">
          <span class="wf-item-glyph" aria-hidden="true">${icon("nodes", "sm")}</span>
          <span class="wf-item-text">
            <strong class="wf-item-title" id="wf-item-title-${esc(p.id)}" data-user-content>${esc(title)}</strong>
            <span class="wf-item-meta"><span>${nodes} 节点 · ${bindings} 映射</span>${prompts ? "" : '<em class="wf-badge warn">未接提示词</em>'}${referenced ? '<em class="wf-badge ref">画册在用</em>' : ""}${dup ? '<em class="wf-badge dup">重名</em>' : ""}</span>
          </span>
        </button>
        ${ibtn("more", "wf-row-menu", "管理此工作流", `data-kind="workflow" data-id="${esc(p.id)}" aria-haspopup="menu"`)}
      </div>`;
    })
    .join("");
}

/* ------------------------------------------------------------------ editor */

/* Advisory findings: nothing is broken, but the workflow would behave in a way a first-time user
   rarely wants. They sit under the blocking issues in the same list and never colour the chip amber. */
function mapperAdvice(c = state.settings.comfy) {
  const w = c.workflow || {},
    tips = [];
  if (!Object.keys(w).length) return tips;
  const on = (c.bindings || []).filter((b) => b.enabled);
  if (!on.some((b) => b.source === "positive"))
    tips.push({ id: "advice-positive", act: "v3-auto-bind", label: "正向提示词", message: "还没有启用正向提示词映射，每一幕都会用蓝图里写死的提示词出图。", action: "识别提示词节点" });
  const seedVaries = c.randomizeSeeds || on.some((b) => b.source === "random" || (b.source === "sceneParameter" && String(b.value || "").trim() === "seed"));
  if (!seedVaries)
    tips.push({ id: "advice-seed", act: "wm-select-output", label: "随机种子", message: "种子固定不变：同样的提示词每次都会得到同一张画面。可在蓝图选项里开启“每次任务随机化种子”。", action: "打开蓝图选项" });
  const hasOutput = c.outputNodeId ? Object.hasOwn(w, c.outputNodeId) : Object.values(w).some((n) => /SaveImage|PreviewImage/.test(n?.class_type || ""));
  if (!hasOutput)
    tips.push({ id: "advice-output", act: "wm-select-output", label: "结果图片节点", message: "没有找到 SaveImage / PreviewImage 节点，生成结束后拿不到图片。", action: "指定结果节点" });
  return tips;
}

/* Mapping groups, in the order data flows through a workflow. Each row joins exactly one group. */
const MAPPING_GROUPS = [
  { id: "prompt", label: "提示词与文本", hint: "每一幕的正负提示词、台词与名称", icon: "edit" },
  { id: "model", label: "模型与风格", hint: "底模与 LoRA，装配时可替换或追加", icon: "layers" },
  { id: "scene", label: "画面参数", hint: "尺寸、步数、CFG、种子", icon: "sliders" },
  { id: "asset", label: "预设与素材", hint: "预设变量、画册标题、参考图", icon: "user" },
  { id: "fixed", label: "固定值与其他", hint: "固定写入或保持原值", icon: "pin" },
];
const SOURCE_MAPPING_GROUP = {
  positive: "prompt", negative: "prompt", caption: "prompt", sceneName: "prompt",
  sceneParameter: "scene", random: "scene",
  variable: "asset", bookTitle: "asset", image: "asset",
  literal: "fixed", inherit: "fixed",
};
const SOURCE_TONE = {
  positive: "scene", negative: "scene", caption: "scene", sceneName: "scene", sceneParameter: "param", random: "param",
  variable: "preset", bookTitle: "preset", image: "preset", literal: "fixed", inherit: "inert",
};

function mapperBindingItem(b, c, issues) {
  const node = c.workflow?.[b.nodeId];
  let detail = "";
  if (b.source === "variable") detail = "{" + (b.value || "…") + "}";
  else if (b.source === "sceneParameter") detail = ({ width: "画面宽度", height: "画面高度", steps: "采样步数", cfg: "CFG", denoise: "去噪强度", seed: "种子" })[String(b.value || "").trim()] || String(b.value || "未填写参数");
  else if (b.source === "literal") detail = String(b.value ?? "").trim() ? String(b.value).replace(/\s+/g, " ").slice(0, 60) : "未填写固定值";
  else detail = SOURCE_META[b.source]?.what || "";
  return {
    id: b.id, label: b.label || "未命名映射", tag: SOURCE_TAG[b.source] || b.source, tone: SOURCE_TONE[b.source] || "fixed",
    group: SOURCE_MAPPING_GROUP[b.source] || "fixed", enabled: b.enabled, issue: issues.find((i) => i.id === b.id), detail,
    target: mapperUI.showTargets && b.nodeId ? `#${b.nodeId} · ${b.path}${node ? " · " + (node._meta?.title || node.class_type) : ""}` : "",
  };
}

/* The five stages a scene passes through, as clickable summary cards: what is wired, what is missing. */
function renderMapperPipeline(c, issues, slots) {
  const on = (c.bindings || []).filter((b) => b.enabled),
    has = (src) => on.some((b) => b.source === src),
    v = slotView(c),
    params = on.filter((b) => b.source === "sceneParameter" || b.source === "random"),
    outputId = c.outputNodeId || Object.keys(c.workflow || {}).find((k) => /SaveImage|PreviewImage/.test(c.workflow[k]?.class_type || "")) || "",
    outputMissing = c.outputNodeId && !Object.hasOwn(c.workflow || {}, c.outputNodeId);
  const model = slots.find((x) => x.kind === "model"), lora = slots.find((x) => x.kind === "lora");
  const stages = [
    { key: "prompt", label: "提示词", icon: "edit", tone: has("positive") ? "ok" : "warn",
      value: has("positive") ? (has("negative") ? "正向 + 负向" : "仅正向") : "未接入",
      note: has("positive") ? "每幕写入分镜提示词" : "识别提示词节点", act: has("positive") ? 'data-act="wf-group-focus" data-group="prompt"' : 'data-act="v3-auto-bind"' },
    { key: "model", label: "模型", icon: "box", tone: model?.issue ? "warn" : model?.enabled ? "ok" : "idle",
      value: v.currentModel ? WorkflowSlots.loraStem(v.currentModel) : model?.enabled ? "已识别" : "保持蓝图",
      note: model?.enabled ? "装配时可替换" : "未启用模型槽", act: 'data-act="wm-select-slot" data-id="model"' },
    { key: "lora", label: "LoRA", icon: "layers", tone: lora?.issue ? "warn" : lora?.enabled ? "ok" : "idle",
      value: v.currentLoras.length ? v.currentLoras.length + " 个自带" : lora?.enabled ? "可追加" : "不可用",
      note: lora?.enabled ? "装配时追加或解锁" : "无应用点", act: 'data-act="wm-select-slot" data-id="lora"' },
    { key: "scene", label: "画面参数", icon: "sliders", tone: params.length ? "ok" : "idle",
      value: params.length ? params.length + " 项" : "保持蓝图",
      note: params.length ? params.map((b) => String(b.source === "random" ? "种子" : ({ width: "宽", height: "高", steps: "步数", cfg: "CFG", denoise: "去噪", seed: "种子" })[b.value] || b.value)).slice(0, 4).join(" · ") : "添加分镜参数映射",
      act: params.length ? 'data-act="wf-group-focus" data-group="scene"' : 'data-act="v3-add-render-mappings"' },
    { key: "output", label: "结果输出", icon: "image", tone: outputMissing || !outputId ? "warn" : "ok",
      value: outputMissing ? "节点不存在" : outputId ? "#" + outputId : "未找到",
      note: outputId && !outputMissing ? (c.outputNodeId ? "已指定" : "自动探测") + " · " + (workflowNodeLabel(c.workflow, outputId) || "") : "指定 SaveImage 节点",
      act: 'data-act="wm-select-output"' },
  ];
  return `<ol class="wf-pipeline" aria-label="出图流程概览">${stages
    .map((st, i) => `<li class="wf-stage tone-${st.tone}"><button type="button" class="wf-stage-card" ${st.act}>
        <span class="wf-stage-top"><span class="wf-stage-icon">${icon(st.icon, "sm")}</span><span class="wf-stage-step mono">${pad(i + 1)}</span><i class="wf-stage-dot" aria-hidden="true"></i></span>
        <strong>${esc(st.label)}</strong>
        <span class="wf-stage-value" data-user-content>${esc(st.value)}</span>
        <small data-user-content>${esc(st.note)}</small>
      </button></li>`)
    .join("")}</ol>`;
}

function renderSmartMapper() {
  const c = state.settings.comfy;
  if (!Array.isArray(c.bindings)) c.bindings = [];
  const issues = mapperBindingIssues(),
    advice = mapperAdvice(c),
    visible = mapperVisibleBindings(c, issues),
    slots = mapperSlotItems(c, issues),
    total = c.bindings.length + slots.length,
    enabled = c.bindings.filter((b) => b.enabled).length + slots.filter(s => s.enabled).length,
    flagged = c.bindings.filter((b) => issues.some((i) => i.id === b.id)).length + slots.filter(s => s.issue).length,
    allPicked = [...visible, ...slots.filter(mapperItemMatches)].length > 0 && [...visible, ...slots.filter(mapperItemMatches)].every((b) => mapperUI.sel.has(b.id)),
    nodeCount = Object.keys(c.workflow || {}).length,
    filters = [
      ["all", "全部映射", total],
      ["enabled", "已启用", enabled],
      ["issues", "待检查", flagged],
      ["disabled", "已停用", total - enabled],
    ];

  const head = `<header class="wf-editor-head">
      <div class="wf-editor-title">
        <span class="context-kicker">当前工作流</span>
        <input class="wm-title" aria-label="工作流名称" data-setting="comfy.workflowTitle" value="${esc(c.workflowTitle)}" placeholder="未命名工作流" spellcheck="false" autocomplete="off">
        <p class="wf-editor-meta">
          <span>${nodeCount ? nodeCount + " 个节点" : "空蓝图"}</span>
          <span>${enabled} / ${total} 项映射启用</span>
          ${renderMapperHealthChip(issues, advice)}
        </p>
      </div>
      <div class="wf-editor-tools" role="toolbar" aria-label="工作流操作">
        ${btn("<span>一帧试跑</span>", "play", "v3-mapping-dry", 'title="用当前分镜的第 1 幕试跑一次，验证映射是否正确"' + (nodeCount ? "" : " disabled"), "small primary")}
        ${ibtn("more", "wf-menu", "更多操作", 'id="wf-menu-button" aria-haspopup="menu" aria-expanded="false"')}
      </div>
    </header>`;

  if (!nodeCount)
    return `<section class="mapping-page wm-workbench wf-editor is-blank">${head}${renderBlankBlueprint()}</section>`;

  return `<section class="mapping-page wm-workbench wf-editor ${mapperUI.selMode ? "is-selmode" : ""} ${mapperUI.showTargets ? "shows-targets" : ""}">
    ${head}

    ${(issues.length || advice.length) && mapperUI.healthOpen ? renderMapperHealthList(issues, advice) : ""}

    ${renderMapperPipeline(c, issues, slots)}

    <div class="wf-toolbar">
      <div class="wf-toolbar-left">
        <label class="wf-filter" title="筛选映射">${icon("filter", "sm")}<select id="wm-filter-select" aria-label="筛选映射">${filters
          .map(([key, label, n]) => opt(key, `${label} (${n})`, mapperUI.filter))
          .join("")}</select></label>
        <label class="wf-search">${icon("search", "sm")}${searchInput({ id: "wm-binding-search", value: mapperUI.search, placeholder: "搜索名称 / 节点 / 字段", label: "搜索映射", controls: "wm-binding-rows" })}</label>
      </div>
      <div class="wf-toolbar-actions">
        <label class="wf-toggle" title="在每行显示节点 ID 与输入字段"><input type="checkbox" id="wm-show-targets" ${mapperUI.showTargets ? "checked" : ""}><span>显示写入位置</span></label>
        ${mapperUI.selMode ? btn("完成", "check", "wm-sel-toggle", "", "small active") : ""}
        ${btn("添加映射", "plus", "wm-nodes", 'aria-expanded="' + mapperUI.nodes + '" title="从蓝图节点里挑一个输入字段建立映射"', mapperUI.nodes ? "small active" : "small primary")}
      </div>
    </div>

    ${selectionBarHTML({
      count: mapperUI.sel.size,
      unit: "项",
      allPicked,
      allAct: "wm-pick-all",
      deleteAct: "wm-delete-bulk",
      exitAct: "wm-sel-toggle",
      smart: [
        { label: "选非提示词", icon: "filter", act: "wm-pick-noncore" },
        { label: "选已停用", icon: "pause", act: "wm-pick-disabled" },
      ],
    })}

    <div class="wf-split">
      <section class="wf-table" aria-label="映射列表" aria-description="右键任意一行可编辑与管理；↑↓ 在行间移动，Enter 打开">
        <div class="wf-columns" aria-hidden="true">
          <span></span>
          <span>映射</span>
          <span>用途</span>
          <span>启用</span>
          <span></span>
        </div>
        <span id="wf-sr-enable" hidden>启用映射</span>
        <div id="wm-binding-rows" class="wf-rows">${renderMapperRows()}</div>
        <details class="wm-preview wf-dry ${rt.preview ? "has-result" : ""}" ${rt.preview ? "open" : ""}>
          <summary>${icon("play", "sm")} 试跑结果</summary>
          <div id="dry-preview" class="preview-box">${rt.preview ? imgTag(rt.preview, "试跑结果") : "尚未试跑。一帧试跑会用当前分镜的第一幕验证工作流；真实生成需先连接 ComfyUI。"}</div>
        </details>
      </section>
      ${renderMapperInspector() ? `<div class="wf-inspector-wrap">${btn("收起详情", "close", "wf-detail-close", "", "small ghost")}${renderMapperInspector()}</div>` : ""}
    </div>

    <datalist id="v3-node-ids">${Object.entries(c.workflow || {})
      .filter(([id, n]) => n && typeof n === "object")
      .map(([id, n]) => `<option value="${esc(id)}">${esc(n?._meta?.title || n?.class_type || id)}</option>`)
      .join("")}</datalist>
    <datalist id="v3-render-parameters">${["width", "height", "steps", "cfg", "denoise", "seed"].map((k) => `<option value="${k}"></option>`).join("")}</datalist>
  </section>`;
}

/* A workflow without a blueprint gets one calm call to action instead of an empty table. */
function renderBlankBlueprint() {
  return `<div class="wf-blank">
    <div class="wf-blank-art" aria-hidden="true">${icon("nodes")}</div>
    <h2>这份工作流还没有蓝图</h2>
    <p>在 ComfyUI 里把工作流导出成 <strong>API 格式</strong> 的 JSON，再导入到这里。Mio 会自动识别正负提示词与结果图片节点，然后你只需要核对映射。</p>
    <div class="wf-blank-actions">
      ${btn("导入 API 工作流", "upload", "ws-open-unified-import", 'data-mode="replace"', "primary")}
      ${btn("粘贴 JSON", "edit", "edit-workflow", "", "")}
    </div>
    <ol class="wf-blank-steps">
      <li><b>1</b><span>ComfyUI 设置里开启「开发者模式」（Dev mode）。</span></li>
      <li><b>2</b><span>菜单 → <em>导出 (API)</em>，得到一份 <code>*_api.json</code>；普通「保存」得到的编辑器格式无法使用。</span></li>
      <li><b>3</b><span>导入后核对映射，用「一帧试跑」验证。</span></li>
    </ol>
  </div>`;
}

/* Health lives inline in the meta line: a quiet "通过" chip, an amber button when something blocks
   generation, or a neutral one when there are only suggestions. */
function renderMapperHealthChip(issues, advice = []) {
  const c = state.settings.comfy;
  if (!c.bindings.length && !issues.length && !advice.length) return "";
  const open = mapperUI.healthOpen;
  if (issues.length)
    return `<button type="button" class="wf-health-chip is-bad" data-act="wm-health-toggle" aria-expanded="${open}">${icon("alert", "xs")} <b>${issues.length}</b> 项待检查 ${icon(open ? "up" : "down", "xs")}</button>`;
  if (advice.length)
    return `<button type="button" class="wf-health-chip is-advice" data-act="wm-health-toggle" aria-expanded="${open}">${icon("info", "xs")} <b>${advice.length}</b> 条建议 ${icon(open ? "up" : "down", "xs")}</button>`;
  return `<span class="wf-health-chip is-ok" title="路径、连线、重复与父子覆盖已核对">${icon("check", "xs")} 检查通过</span>`;
}

function renderMapperHealthList(issues, advice = []) {
  const c = state.settings.comfy;
  const blocking = issues.map((i) => {
    const b = c.bindings.find((x) => x.id === i.id);
    const label = i.kind === "output" ? "结果图片节点" : i.kind === "slot-model" ? "模型槽" : i.kind === "slot-lora" ? "LoRA 槽" : b?.label || "未命名映射";
    const act = i.kind === "output" ? 'data-act="wm-select-output"' : i.kind === "slot-model" || i.kind === "slot-lora" ? `data-act="wm-select-slot" data-id="${i.kind.slice(5)}"` : `data-act="wm-select" data-id="${esc(i.id)}"`;
    return `<button type="button" class="wm-issue" role="listitem" ${act}>${icon("alert", "xs")}<strong ${b?.label ? "data-user-content" : ""}>${esc(label)}</strong><em>${esc(i.message)}</em>${icon("arrow", "xs")}</button>`;
  });
  const soft = advice.map(
    (a) => `<button type="button" class="wm-advice" role="listitem" data-act="${a.act}">${icon("info", "xs")}<strong>${esc(a.label)}</strong><em>${esc(a.message)}</em><span class="wm-advice-action">${esc(a.action)} ${icon("arrow", "xs")}</span></button>`
  );
  return `<div class="wf-health-list" role="list">${blocking.join("")}${soft.join("")}</div>`;
}

/* ------------------------------------------------------------------ rows */

function renderMapperRows() {
  const c = state.settings.comfy,
    issues = mapperBindingIssues(),
    rows = mapperVisibleBindings(c, issues),
    filtered = mapperUI.filter !== "all" || !!mapperUI.search.trim(),
    slots = mapperSlotItems(c, issues).filter(mapperItemMatches);
  if (!rows.length && !slots.length)
    return `<div class="wf-empty is-filter">
      <strong>没有匹配的映射</strong>
      <p>换个关键词，或清除筛选查看全部 <b>${c.bindings.length}</b> 项。</p>
      <div class="row">${btn("清除筛选", "close", "wf-clear-filter", "", "small")}</div>
    </div>`;
  const items = [...slots, ...rows.map((b) => mapperBindingItem(b, c, issues))];
  const groups = MAPPING_GROUPS.map((g) => ({ ...g, items: items.filter((x) => x.group === g.id) })).filter((g) => g.items.length);
  return (
    groups
      .map((g) => {
        const on = g.items.filter((x) => x.enabled).length;
        return `<div class="wf-group-head" data-mapping-group="${g.id}" role="presentation"><span class="wf-group-icon">${icon(g.icon, "sm")}</span><b>${esc(g.label)}</b><small>${esc(g.hint)}</small><span class="spacer"></span><span class="wf-group-count mono">${on}/${g.items.length}</span></div>` +
          g.items.map(renderUnifiedMappingRow).join("");
      })
      .join("") + (filtered ? "" : renderOutputNodeRow(c))
  );
}

function renderMapperRow(b, c, issues) {
  return renderUnifiedMappingRow(mapperBindingItem(b, c, issues));
}

/* The result-image node is not a binding, but it belongs in the same table so every node
   relationship is visible in one place. */
function renderOutputNodeRow(c) {
  const w = c.workflow,
    id = c.outputNodeId,
    missing = id && !Object.hasOwn(w, id),
    auto = !id && Object.keys(w).find((k) => /SaveImage|PreviewImage/.test(w[k]?.class_type || "")),
    isSel = mapperUI.selected === "__output__",
    shown = id || auto;
  const glyph = missing || !shown
    ? `<span class="wf-row-glyph is-bad" title="${missing ? "节点不存在" : "未找到结果节点"}">${icon("alert", "sm")}</span>`
    : `<span class="wf-row-glyph is-out">${icon("image", "sm")}</span>`;
  const sub = missing
    ? "指定的节点已不在蓝图中"
    : id
      ? `已指定 · ${workflowNodeLabel(w, id)}`
      : auto
        ? `自动探测 · ${workflowNodeLabel(w, auto)}`
        : "蓝图里没有 SaveImage / PreviewImage 节点";
  return `<div class="wf-group-head" data-mapping-group="output" role="presentation"><span class="wf-group-icon">${icon("image", "sm")}</span><b>结果输出</b><small>生成完成后从哪个节点取回图片</small></div><article class="wf-row wf-row-output ${isSel ? "selected" : ""} ${missing || !shown ? "has-issue" : ""}" data-output-row>
    <span class="wf-row-lead">${glyph}</span>
    <button type="button" class="wm-row-select wf-row-main" data-act="wm-select-output" aria-pressed="${isSel}">
      <span class="wf-row-name">结果图片回传节点</span>
      <span class="${missing || !shown ? "wf-row-warning" : "wf-row-sub"}" ${missing ? "" : "data-user-content"}>${esc(sub)}</span>
    </button>
    <span class="wf-row-source">
      <span class="wf-tag tag-output">输出</span>
      ${mapperUI.showTargets && shown ? `<span class="wf-row-target mono">#${esc(shown)}</span>` : ""}
    </span>
    <span class="wf-row-switch" aria-hidden="true"></span>
    ${ibtn("more", "wf-row-menu", "管理结果输出", 'data-kind="output" aria-haspopup="menu"')}
  </article>`;
}

/* ------------------------------------------------------------------ inspector */

function renderMapperInspector() {
  const c = state.settings.comfy;
  if (!mapperUI.selected && !mapperUI.nodes) return "";
  if (mapperUI.nodes) return renderNodeBrowser();
  if (mapperUI.selected === "__output__") return `<aside class="wf-inspector wm-inspector" aria-label="映射详情">${renderOutputInspector(c)}</aside>`;
  if (mapperUI.selected === "__slot_model__" || mapperUI.selected === "__slot_lora__")
    return `<aside class="wf-inspector wm-inspector" aria-label="语义槽详情">${renderSlotInspector(mapperUI.selected === "__slot_model__" ? "model" : "lora", c)}</aside>`;
  const b = mapperSelectedBinding();
  if (!b)
    return `<aside class="wf-inspector wm-inspector" aria-label="映射详情">
      <div class="wf-inspector-empty">
        ${icon("target")}
        <strong>还没有可编辑的映射</strong>
        <p>点「添加映射」从节点里挑一个输入字段，然后在这里按三步设置：写到哪里、填什么、看效果。</p>
      </div>
    </aside>`;
  return `<aside class="wf-inspector wm-inspector" aria-label="映射详情">${renderMappingRule(b, c.bindings.indexOf(b), c.bindings.length)}</aside>`;
}

/* Source options in plain words, grouped by where the value comes from. */
function mappingSourceOptions(current) {
  return `<optgroup label="来自分镜（每一幕不同）">
      ${opt("positive", "这一幕的正向提示词", current)}
      ${opt("negative", "这一幕的负向提示词", current)}
      ${opt("caption", "这一幕的台词 / 旁白", current)}
      ${opt("sceneName", "这一幕的名称", current)}
      ${opt("sceneParameter", "这一幕的画面参数（宽高 / 步数 / CFG / 种子）", current)}
    </optgroup>
    <optgroup label="来自预设与装配">
      ${opt("variable", "视觉预设里的变量 {变量名}", current)}
      ${opt("bookTitle", "画册标题", current)}
      ${opt("image", "角色立绘 / 参考图", current)}
    </optgroup>
    <optgroup label="固定内容">
      ${opt("literal", "我自己填一个固定值 / 模板", current)}
      ${opt("random", "每次都换的随机种子", current)}
      ${opt("inherit", "保持蓝图原值（不写入）", current)}
    </optgroup>`;
}

/* The preview value for step ③, resolved against the first scene of the first storyboard. */
function mappingPreviewValue(binding, original, firstFrame, meta) {
  if (binding.source === "literal") return String(binding.value ?? "");
  if (binding.source === "variable") return `{${binding.value}}`;
  if (binding.source === "random") return "随机整数（每次生成都不同）";
  if (binding.source === "inherit") return original;
  if (!firstFrame) return "（还没有分镜，无法预览）";
  if (binding.source === "positive") return firstFrame.prompt || "（本幕未填正向提示词）";
  if (binding.source === "negative") return firstFrame.negative || "（使用全局负向提示词）";
  if (binding.source === "caption") return firstFrame.caption || "（本幕未填台词）";
  if (binding.source === "sceneName") return firstFrame.name || "第 1 幕";
  if (binding.source === "sceneParameter") {
    // Mirrors buildMappedWorkflow: a seed is fresh for every scene unless that scene locks one via render override.
    if (binding.value === "seed" && (!firstFrame.renderOverride || Number(firstFrame.seed) < 0)) return "随机整数（本幕未锁定种子）";
    return firstFrame[binding.value] !== undefined ? String(firstFrame[binding.value]) : "（保持蓝图原值）";
  }
  if (binding.source === "bookTitle") return state.creation.plans[0]?.title || "（装配时填写）";
  return meta.what;
}

function renderMappingRule(binding, index, total = state.settings.comfy.bindings.length) {
  const w = state.settings.comfy.workflow,
    n = Object.hasOwn(w, binding.nodeId) ? w[binding.nodeId] : null,
    valid = bindingRowValidity(binding),
    attr = (k) => `data-v3-binding="${k}" data-id="${esc(binding.id)}"`,
    meta = SOURCE_META[binding.source] || SOURCE_META.literal,
    nodeTitle = n ? n._meta?.title || n.class_type : "",
    fields = n ? workflowInputEntries(n, w) : [],
    writable = fields.filter((f) => !f.link),
    known = fields.find((f) => WorkflowMapping.samePath(f.path, binding.path)),
    hasTarget = !!(binding.nodeId && binding.path),
    fieldExists = valid.original !== undefined,
    original = fieldExists ? JSON.stringify(valid.original, null, 2) : "（蓝图里还没有这个字段）",
    typed = mapperUI.customPath === binding.id || (!!binding.path && !known && !!n) || !n,
    story = projectTemplates()[0],
    firstFrame = story?.frames?.[0],
    previewValue = mappingPreviewValue(binding, original, firstFrame, meta),
    perScene = ["positive", "negative", "caption", "sceneName", "sceneParameter", "bookTitle", "image"].includes(binding.source),
    target = hasTarget ? `<code>#${esc(binding.nodeId)} · ${esc(binding.path)}</code>${nodeTitle ? ` <small>${esc(nodeTitle)}</small>` : ""}` : "";

  let what = `<em>${esc(meta.what)}</em>`;
  if (binding.source === "variable") what = `<em>${esc(meta.what)} <code>{${esc(binding.value || "…")}}</code></em>`;
  if (binding.source === "sceneParameter") what = `<em>${esc(meta.what)} <code>${esc(binding.value || "…")}</code></em>`;
  const contract = !hasTarget
    ? `<span>还没有指定写入位置。</span> <span>先在第 ① 步选择节点和输入字段。</span>`
    : binding.source === "inherit"
      ? `${target} <span>保持蓝图原值，不写入。</span>`
      : `<span>${binding.source === "literal" ? "每次生成都把" : "生成时把"}</span> ${what} <span>写入</span> ${target}`;

  const nodeOptions = Object.entries(w || {})
    .filter(([id, node]) => node && typeof node === "object")
    .sort(([a], [b]) => Number(a) - Number(b) || String(a).localeCompare(String(b)))
    .map(([id, node]) => opt(id, `#${id} · ${node?._meta?.title || node?.class_type || id}`, binding.nodeId).replace("<option ", "<option data-user-content "))
    .join("");
  const nodeSelect = `<select ${attr("nodeId")} aria-label="节点" class="wf-node-select">
      ${opt("", "选择节点…", binding.nodeId)}
      ${binding.nodeId && !n ? `<option value="${esc(binding.nodeId)}" selected>#${esc(binding.nodeId)}（蓝图里没有这个节点）</option>` : ""}
      ${nodeOptions}
    </select>`;
  const fieldControl = typed
    ? input("path", binding.path, "text", attr("path") + ` list="field-${esc(binding.id)}" aria-label="输入字段" placeholder="例如 text、steps 或 /a/b" spellcheck="false" autocomplete="off"`) +
      `<datalist id="field-${esc(binding.id)}">${writable.map((f) => `<option value="${esc(f.path)}">${esc(localeString(bindingTypes[f.type] || f.type))}</option>`).join("")}</datalist>`
    : `<select ${attr("path")} aria-label="输入字段" class="wf-field-select">
        ${binding.path ? "" : opt("", "选择输入字段…", "")}
        ${writable.map((f) => `<option data-user-content value="${esc(f.path)}" ${known && known.path === f.path ? "selected" : ""}>${esc(f.label)} · ${esc(localeString(bindingTypes[f.type] || f.type))}${f.optional ? esc(localeString("（可选输入）")) : ""}</option>`).join("")}
        ${fields.filter((f) => f.link).length ? `<optgroup label="已连线，不能写入">${fields.filter((f) => f.link).map((f) => `<option data-user-content value="${esc(f.path)}" ${known && known.path === f.path ? "selected" : ""} disabled>${esc(f.label)} · ${esc(localeString("已连线（只读）"))}</option>`).join("")}</optgroup>` : ""}
      </select>`;
  const fieldNote = !n
    ? binding.nodeId ? "蓝图里没有这个节点，请重新选择。" : "先选节点；找不到时用「在节点列表里找」浏览整张蓝图。"
    : typed
      ? "直接写节点上的输入名，例如 text、steps；嵌套字段用 /a/b。"
      : "字段名就是 ComfyUI 节点上输入框的名字，已连线的输入不会出现在列表里。";

  const valueField = ["literal", "variable", "sceneParameter"].includes(binding.source)
    ? field(
        binding.source === "variable" ? "变量名" : binding.source === "sceneParameter" ? "参数名" : "固定值 / 模板文本",
        binding.source === "literal"
          ? `<textarea ${attr("value")} aria-label="映射值" spellcheck="false" placeholder="固定值，或含 {变量名} 的模板">${esc(binding.value)}</textarea>`
          : input("value", binding.value, "text", attr("value") + ` aria-label="映射值" spellcheck="false" autocomplete="off" ${binding.source === "sceneParameter" ? 'list="v3-render-parameters"' : ""} placeholder="${binding.source === "variable" ? "例如 lora_strength" : "例如 width / steps / seed"}"`)
      )
    : "";

  return `<article class="mapping-rule wf-detail">
    <header class="wf-detail-head">
      <span class="context-kicker">映射详情</span>
      <span class="wf-detail-index mono">${pad(index + 1)} / ${pad(total)}</span>
      <span class="spacer"></span>
      ${ibtn("copy", "v3-copy-binding", "复制此映射", `data-id="${esc(binding.id)}"`)}
      ${ibtn("trash", "v3-remove-binding", "删除此映射", `data-id="${esc(binding.id)}"`)}
    </header>
    <input class="wf-detail-title" name="label" type="text" value="${esc(binding.label)}" ${attr("label")} aria-label="映射名称" placeholder="映射名称" spellcheck="false" autocomplete="off">

    <p class="wf-contract ${binding.enabled ? "" : "is-inert"} ${hasTarget ? "" : "is-todo"}">${contract}</p>
    ${binding.enabled ? "" : `<p class="wf-inert-note">${icon("pause", "xs")} 这条映射已停用，生成时不会写入。</p>`}

    <ol class="wf-steps">
      <li class="wf-step ${hasTarget && n ? "is-done" : ""}">
        <div class="wf-step-head"><i>1</i><div><strong>写到哪里</strong><small>ComfyUI 里的哪个节点、哪个输入框</small></div></div>
        <div class="wf-step-body">
          <div class="wf-grid2">
            ${field("节点", nodeSelect)}
            ${field("输入字段", fieldControl)}
          </div>
          <p class="wf-step-note">${esc(fieldNote)}</p>
          <p class="wf-step-links">
            ${n && !typed ? `<button type="button" class="wf-link" data-act="wf-field-custom" data-id="${esc(binding.id)}">字段不在列表里？手动输入</button>` : ""}
            ${n && typed && writable.length ? `<button type="button" class="wf-link" data-act="wf-field-list" data-id="${esc(binding.id)}">改为从列表选择</button>` : ""}
            <button type="button" class="wf-link" data-act="wf-binding-locate" data-id="${esc(binding.id)}">在节点列表里找</button>
          </p>
        </div>
      </li>
      <li class="wf-step ${binding.source && (!["literal", "variable", "sceneParameter"].includes(binding.source) || String(binding.value ?? "").trim()) ? "is-done" : ""}">
        <div class="wf-step-head"><i>2</i><div><strong>填什么</strong><small>生成时，这个输入框的值从哪里来</small></div></div>
        <div class="wf-step-body">
          ${field("取值来源", `<select ${attr("source")} aria-label="映射值来源">${mappingSourceOptions(binding.source)}</select>`)}
          ${valueField}
          <p class="wf-step-note">${esc(meta.explain)}</p>
        </div>
      </li>
      <li class="wf-step ${hasTarget && valid.ok ? "is-done" : ""}">
        <div class="wf-step-head"><i>3</i><div><strong>效果预览</strong><small>${!hasTarget ? "选好写入位置后显示" : perScene ? (firstFrame ? "按当前分镜的第 1 幕" : "还没有分镜") : "固定内容"}</small></div></div>
        <div class="wf-step-body">
          ${hasTarget
            ? `<div class="wf-preview" aria-label="效果预览">
                <div class="wf-preview-row is-old"><i>蓝图里现在是</i><pre>${esc(original)}</pre></div>
                <div class="wf-preview-row is-new"><i>生成时会写成</i><pre data-wf-preview-new>${esc(previewValue || "（空）")}</pre></div>
              </div>
              <p class="wf-validity ${valid.ok ? "is-ok" : "is-bad"}">${icon(valid.ok ? "check" : "alert", "sm")}<span>${esc(valid.ok ? (fieldExists ? "可以写入：" + valid.text.replace(/^已定位 /, "") : "字段目前不存在，生成时会新建（见高级选项）") : valid.text)}</span></p>`
            : `<p class="wf-step-placeholder">这里会对比「蓝图里现在是什么」和「生成时会写成什么」。</p>`}
          ${binding.warning ? `<p class="wf-warning">${icon("alert", "sm")}<span>${esc(binding.warning)}</span></p>` : ""}
        </div>
      </li>
    </ol>

    <details class="advanced-details wf-advanced">
      <summary>高级选项</summary>
      ${field("写入格式", `<select ${attr("type")} aria-label="映射数据类型">${Object.entries(bindingTypes).map((x) => opt(...x, binding.type)).join("")}</select>`, "一般保持自动；当 ComfyUI 字段要求数字或开关时可以强制转换。")}
      <label class="row tiny"><input type="checkbox" ${attr("allowCreate")} ${binding.allowCreate ? "checked" : ""}>允许新增不存在的字段</label>
      <p class="help">不会覆盖已有标量或节点连线。嵌套数组需在蓝图中预先存在。</p>
      ${["positive", "negative"].includes(binding.source) ? btn("重新识别文本字段", "refresh", "v3-infer-field", `data-id="${esc(binding.id)}"`, "small") : ""}
    </details>
  </article>`;
}

function renderOutputInspector(c) {
  const w = c.workflow || {},
    candidates = Object.entries(w).filter(([, n]) => n && typeof n === "object" && /SaveImage|PreviewImage|Save|Preview/.test(n.class_type || "")),
    others = Object.entries(w).filter(([id, n]) => n && typeof n === "object" && !candidates.some(([cid]) => cid === id)),
    missing = c.outputNodeId && (!w[c.outputNodeId] || typeof w[c.outputNodeId] !== "object"),
    option = ([id, n]) => opt(id, `#${id} · ${n?._meta?.title || n?.class_type || id}`, c.outputNodeId);
  return `<article class="mapping-rule wf-detail wf-detail-output">
    <header class="wf-detail-head">
      <span class="context-kicker">结果输出</span>
      <span class="spacer"></span>
    </header>
    <h3 class="wf-detail-static">结果图片回传节点</h3>
    <p class="wf-contract"><span>生成完成后，从</span> <code>${c.outputNodeId ? "#" + esc(c.outputNodeId) : "自动探测的节点"}</code>${c.outputNodeId ? ` <small>${esc(workflowNodeLabel(w, c.outputNodeId) || "节点不存在")}</small>` : ""} <span>取回图片。</span></p>
    ${field(
      "结果图片节点",
      `<select id="v3-output-node-select" data-v3-output="1" aria-label="结果图片节点">
        ${opt("", "自动探测 SaveImage / PreviewImage", c.outputNodeId)}
        ${candidates.length ? `<optgroup label="保存 / 预览节点">${candidates.map(option).join("")}</optgroup>` : ""}
        ${others.length ? `<optgroup label="其他节点">${others.map(option).join("")}</optgroup>` : ""}
      </select>`,
      "蓝图里有多个保存节点时请明确指定；否则自动探测即可。"
    )}
    ${missing ? `<p class="wf-warning">${icon("alert", "sm")}<span>指定的节点 #${esc(c.outputNodeId)} 已不在蓝图中，生成时将找不到输出。</span></p>` : ""}

    <h4 class="wf-section"><span>蓝图选项</span></h4>
    <label class="wf-switch-row">
      <span><strong>每次任务随机化种子</strong><small>提交前把蓝图里所有 seed 字段换成新随机数；已映射的种子字段不受影响。</small></span>
      <span class="switch"><input type="checkbox" role="switch" id="v3-randomize-seeds" ${c.randomizeSeeds ? "checked" : ""} aria-label="每次任务随机化种子"><span class="switch-track"></span></span>
    </label>
    <div class="wf-detail-actions">
      ${btn("同步节点定义", "refresh", "v3-read-object-info", 'title="从 ComfyUI 读取节点字段与类型，改进识别与校验"', "small")}
      ${btn("添加分镜参数映射", "sliders", "v3-add-render-mappings", 'title="为宽高、步数、CFG 与种子建立映射"', "small")}
    </div>
  </article>`;
}

/* ------------------------------------------------------------------ node picker */

function renderNodeBrowser() {
  const workflow = state.settings.comfy.workflow || {},
    search = createUI.nodeSearch.toLowerCase();
  return `<aside class="wf-inspector wm-inspector is-picker" aria-label="添加映射">
    <header class="wf-detail-head">
      <span class="context-kicker">添加映射</span>
      <span class="wf-detail-index mono">${Object.keys(workflow).length} 节点</span>
      <span class="spacer"></span>
      ${btn("手动添加", "edit", "v3-add-binding", 'title="新建一条空映射，手动填写节点与字段"', "small ghost")}
      ${ibtn("close", "wm-nodes", "关闭节点浏览器")}
    </header>
    <p class="wf-picker-help">点击字段右侧的 + 建立映射；已连线的输入只读。</p>
    <label class="wf-search">${icon("search", "sm")}${searchInput({ id: "v3-node-search", value: createUI.nodeSearch, placeholder: "搜索节点 / LoRA / 字段…", label: "搜索工作流节点", controls: "v3-node-results" })}</label>
    <div id="v3-node-results" class="wf-node-results">${nodeBrowserItems(workflow, search)}</div>
  </aside>`;
}

function nodeBrowserItems(workflow, search) {
  const bindings = state.settings.comfy.bindings;
  return (
    Object.entries(workflow || {})
      .filter(([id, n]) => n && typeof n === "object" && (n.inputs || state.settings.comfy.objectInfo?.[n.class_type]))
      .filter(([id, n]) =>
        (id + " " + (n.class_type || "") + " " + (n?._meta?.title || "") + " " + workflowInputEntries(n, workflow).map((e) => e.path).join(" "))
          .toLowerCase()
          .includes(search)
      )
      .map(([id, n]) => {
        const entries = workflowInputEntries(n, workflow),
          mapped = entries.filter((e) => bindings.some((b) => b.nodeId === id && WorkflowMapping.samePath(b.path, e.path))).length;
        return `<details class="node-group" ${search ? "open" : ""}>
          <summary><b>#${esc(id)}</b><span class="wf-node-title" data-user-content>${esc(n?._meta?.title || n?.class_type || id)}</span>${n?._meta?.title && n._meta.title !== n.class_type ? `<small>${esc(n.class_type)}</small>` : ""}${mapped ? `<em class="wf-node-mapped" title="已映射字段数">${mapped}</em>` : ""}</summary>
          ${entries
            .map((entry) => {
              const existing = bindings.find((b) => b.nodeId === id && WorkflowMapping.samePath(b.path, entry.path));
              return `<div class="node-input-item ${entry.link ? "is-linked" : ""} ${existing ? "is-mapped" : ""}">
                <span class="grow ${entry.link ? "linked" : ""}" title="${esc(JSON.stringify(entry.value))}">${esc(entry.label)}<span class="wm-field-type">${entry.link ? "连线 · 只读" : esc(entry.type)}</span></span>
                ${entry.link ? icon("shield", "sm") : existing ? ibtn("check", "wm-select", "编辑已有映射", `data-id="${esc(existing.id)}"`) : ibtn("plus", "v3-expose-input", "添加此字段", `data-node="${esc(id)}" data-path="${esc(entry.path)}"`)}
              </div>`;
            })
            .join("")}
        </details>`;
      })
      .join("") || '<div class="mapping-list-empty">未找到匹配节点。试试节点 ID 或字段名。</div>'
  );
}

/* ------------------------------------------------------------------ menus */

/* ⋯ menu: workflow-level utilities that are not needed every minute. */
function workflowMenuItems() {
  const c = state.settings.comfy,
    presets = c.presets || [],
    only = presets.length <= 1,
    referenced = workflowReferenced(c.activeWorkflowId);
  return [
    { act: "v3-auto-bind", icon: "spark", label: "识别提示词节点", hint: "自动找到正负提示词并建立映射" },
    { act: "v3-add-render-mappings", icon: "sliders", label: "添加分镜参数映射", hint: "宽高 / 步数 / CFG / 种子" },
    { act: "wm-sel-toggle", icon: "list", label: mapperUI.selMode ? "退出批量管理" : "批量管理映射…", hint: "多选后一起启用、停用或删除", disabled: !c.bindings.length },
    "sep",
    { act: "edit-workflow", icon: "edit", label: "编辑蓝图 JSON", hint: "直接修改 ComfyUI API 蓝图" },
    { act: "v3-preview-workflow", icon: "eye", label: "预览提交 JSON", hint: "查看映射后实际发送的内容" },
    { act: "ws-open-unified-import", extra: 'data-mode="replace"', icon: "upload", label: "替换蓝图…", hint: "保留名称与映射，只更换节点图" },
    { act: "v3-read-object-info", icon: "refresh", label: "同步节点定义", hint: "从 ComfyUI 读取字段与类型" },
    "sep",
    { act: "v3-import-mapping", icon: "upload", label: "导入映射包" },
    { act: "v3-export-mapping", icon: "download", label: "导出映射包" },
    "sep",
    { act: "ws-copy", icon: "copy", label: "复制副本" },
    { act: "ws-delete", icon: "trash", label: "删除工作流", danger: true, disabled: only || referenced, hint: only ? "至少保留一份工作流" : referenced ? "有画册正在引用，无法删除" : "" },
  ];
}

/* Right-click menu for a mapping row: everything that edits or manages that one mapping. */
function bindingContextItems(id) {
  const c = state.settings.comfy;
  if (id === "__slot_model__" || id === "__slot_lora__") {
    const kind = id === "__slot_model__" ? "model" : "lora";
    const v = slotView(c).resolved[kind];
    const enabled = kind === "model" ? v.enabled : v.mode !== "off";
    const label = kind === "model" ? "基础模型" : "LoRA";
    const ref = `data-id="${esc(kind)}"`;
    return [
      { act: "wm-select-slot", extra: ref, icon: "edit", label: "编辑" + label, hint: "在右侧检查与配置槽位" },
      { act: "wf-slot-toggle", extra: `data-slot="${kind}"`, icon: enabled ? "pause" : "play", label: enabled ? "停用" + label : "启用" + label },
      "sep",
      { act: mapperUI.selMode ? "wm-pick" : "wf-binding-multi", extra: `data-id="${esc(id)}"`, icon: "list", label: mapperUI.selMode ? (mapperUI.sel.has(id) ? "取消勾选" : "勾选此项") : "批量管理…", hint: mapperUI.selMode ? "" : "多选后一起启用、停用或管理" },
    ];
  }
  const b = c.bindings.find((x) => x.id === id);
  if (!b) return null;
  const ref = `data-id="${esc(id)}"`,
    node = Object.hasOwn(c.workflow, b.nodeId);
  return [
    { act: "wm-select", extra: ref, icon: "edit", label: "编辑此映射", hint: "在右侧按三步设置" },
    { act: "wf-binding-toggle", extra: ref, icon: b.enabled ? "pause" : "play", label: b.enabled ? "停用" : "启用", hint: b.enabled ? "保留设置，生成时不写入" : "生成时重新写入" },
    { act: "wf-binding-rename", extra: ref, icon: "rename", label: "重命名" },
    { act: "v3-copy-binding", extra: ref, icon: "copy", label: "复制此映射", hint: "副本默认停用" },
    "sep",
    { act: "wf-binding-locate", extra: ref, icon: "nodes", label: "在节点列表里查看", hint: node ? `#${b.nodeId} 的全部输入字段` : "节点不在蓝图中", disabled: !node },
    { act: mapperUI.selMode ? "wm-pick" : "wf-binding-multi", extra: ref, icon: "list", label: mapperUI.selMode ? (mapperUI.sel.has(id) ? "取消勾选" : "勾选此项") : "批量管理…", hint: mapperUI.selMode ? "" : "多选后一起启用、停用或删除" },
    "sep",
    { act: "v3-remove-binding", extra: ref, icon: "trash", label: "删除映射", danger: true, hint: "蓝图节点不会被删除" },
  ];
}

function outputContextItems() {
  return [
    { act: "wm-select-output", icon: "image", label: "更改结果图片节点" },
    { act: "v3-read-object-info", icon: "refresh", label: "同步节点定义", hint: "从 ComfyUI 读取字段与类型" },
  ];
}

/* Right-click menu for a workflow in the library rail. */
function workflowContextItems(id) {
  const c = state.settings.comfy,
    p = (c.presets || []).find((x) => x.id === id);
  if (!p) return [];
  const ref = `data-id="${esc(id)}"`,
    current = id === c.activeWorkflowId,
    only = (c.presets || []).length <= 1,
    referenced = workflowReferenced(id);
  return [
    { act: "ws-select", extra: ref, icon: "arrow", label: current ? "当前正在编辑" : "切换到此工作流", disabled: current },
    { act: "wf-ws-rename", extra: ref, icon: "rename", label: "重命名" },
    { act: "wf-ws-copy", extra: ref, icon: "copy", label: "复制副本" },
    { act: "wf-ws-export", extra: ref, icon: "download", label: "导出映射包", hint: "蓝图 + 映射，一个 JSON" },
    "sep",
    { act: "ws-lib-sel-toggle", icon: "list", label: mapperUI.libSelMode ? "退出批量选择" : "批量选择…", disabled: only },
    "sep",
    { act: "wf-ws-delete", extra: ref, icon: "trash", label: "删除工作流", danger: true, disabled: only || referenced, hint: only ? "至少保留一份工作流" : referenced ? "有画册正在引用，无法删除" : "" },
  ];
}

function closeWorkflowMenu() {
  const menu = document.getElementById("wf-menu");
  if (!menu) return;
  const opener = menu._opener;
  menu.remove();
  if (opener?.isConnected) opener.setAttribute("aria-expanded", "false");
}

/* One popover for every menu on the page: anchored below a button, or at the pointer for context menus. */
function openWorkbenchMenu(items, { anchor = null, x = 0, y = 0, label = "操作" } = {}) {
  closeWorkflowMenu();
  const list = (items || []).filter((item, i, all) => item !== "sep" || (i > 0 && i < all.length - 1 && all[i - 1] !== "sep"));
  if (!list.some((item) => item !== "sep")) return null;
  const menu = document.createElement("div");
  menu.id = "wf-menu";
  menu.className = "wf-menu" + (anchor ? "" : " is-context");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  menu.dataset.noTip = ""; // items carry their own hint line; the global tooltip would cover the menu
  if (typeof hideTip === "function") hideTip();
  menu.innerHTML = list
    .map((item) =>
      item === "sep"
        ? '<hr class="wf-menu-sep">'
        : `<button type="button" role="menuitem" class="${item.danger ? "is-danger" : ""}" data-act="${item.act}" ${item.extra || ""} ${item.disabled ? "disabled" : ""}>${icon(item.icon, "sm")}<span><strong>${item.label}</strong>${item.hint ? `<small>${item.hint}</small>` : ""}</span></button>`
    )
    .join("");
  document.body.append(menu);
  const width = menu.offsetWidth,
    height = menu.offsetHeight;
  let left, top;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    left = r.right - width;
    top = r.bottom + 6;
    if (top + height > innerHeight - 8) top = Math.max(8, r.top - height - 6);
    anchor.setAttribute("aria-expanded", "true");
    menu._opener = anchor;
  } else {
    left = x;
    top = y;
    if (top + height > innerHeight - 8) top = Math.max(8, innerHeight - height - 8);
  }
  if (left + width > innerWidth - 8) left = Math.max(8, innerWidth - width - 8);
  if (left < 8) left = 8;
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.querySelector('[role="menuitem"]:not([disabled])')?.focus();
  return menu;
}

function openWorkflowMenu(anchor) {
  return openWorkbenchMenu(workflowMenuItems(), { anchor, label: "更多操作" });
}

function contextItemsFor(kind, id) {
  if (kind === "binding") return bindingContextItems(id);
  if (kind === "workflow") return workflowContextItems(id);
  if (kind === "output") return outputContextItems();
  return [];
}

/* ------------------------------------------------------------------ import sheet */

const IMPORT_FILE_LIMIT = 10 * 1024 * 1024;

/* Reads one dropped file far enough to say what it is before anything touches the library. */
async function inspectWorkflowFile(file) {
  const base = { file, name: file.name, size: file.size, ok: false, kind: "", detail: "" };
  if (file.size > IMPORT_FILE_LIMIT) return { ...base, detail: "超过 10 MB" };
  if (!/\.json$/i.test(file.name) && !/json/.test(file.type || "")) return { ...base, detail: "不是 JSON 文件" };
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { ...base, detail: "JSON 无法解析" };
  }
  if (!data || typeof data !== "object") return { ...base, detail: "不是工作流 JSON" };
  if (data.kind === "comfycomic.workflow-mappings") {
    const nodes = Object.values(data.workflow || {}).filter((n) => n && typeof n === "object").length;
    return { ...base, ok: nodes > 0, kind: "映射包", detail: nodes ? `${nodes} 个节点 · ${(data.bindings || []).length} 项映射` : "映射包里没有节点" };
  }
  const list = Array.isArray(data) ? data : Array.isArray(data.workflows) ? data.workflows : null;
  if (list) return { ...base, ok: list.length > 0 && list.length <= 200, kind: "工作流合集", detail: list.length ? `${list.length} 份工作流` : "合集为空" };
  const wf = data.workflow || data.prompt || data;
  if (Array.isArray(wf.nodes)) return { ...base, detail: "编辑器格式，请在 ComfyUI 里用「导出 API 格式」重新导出" };
  const entries = Object.values(wf).filter((n) => n && typeof n === "object" && typeof n.class_type === "string"),
    prompts = entries.filter((n) => /TextEncode|Prompt/i.test(n.class_type)).length,
    saves = entries.filter((n) => /SaveImage|PreviewImage/.test(n.class_type)).length;
  if (!entries.length) return { ...base, detail: "没有找到 ComfyUI 节点" };
  return { ...base, ok: true, kind: "API 工作流", detail: `${entries.length} 个节点 · ${prompts} 个提示词节点${saves ? "" : " · 没有 SaveImage 节点"}` };
}

function openUnifiedWorkflowImportModal(mode = "new") {
  const c = state.settings.comfy,
    currentTitle = c.workflowTitle || "当前工作流",
    blank = !Object.keys(c.workflow || {}).length;
  modal(
    "添加工作流",
    `<div class="wf-import-sheet">
      <div class="drop" id="wf-unified-dropzone" role="button" tabindex="0" aria-label="选择或拖入工作流文件">
        ${icon("upload")}
        <b>点击选择文件，或将 .json 拖到此处</b>
        <span>ComfyUI API 格式工作流 · Mio 映射包 · 可多选 · 单文件 ≤ 10 MB</span>
      </div>
      <input type="file" id="wf-unified-file-input" accept=".json,application/json" multiple style="display:none">
      <div id="wf-import-filelist" class="filelist" hidden aria-live="polite"></div>
      <div class="radios">
        <label>
          <input type="radio" name="wf-import-mode" value="new" ${mode === "replace" ? "" : "checked"}>
          <div><b>新建工作流</b><small>作为独立条目加入工作流库，当前编辑的工作流完全不受影响。</small></div>
        </label>
        <label>
          <input type="radio" name="wf-import-mode" value="replace" ${mode === "replace" ? "checked" : ""}>
          <div><b>替换「<span data-user-content>${esc(currentTitle)}</span>」的蓝图</b><small>保留现有名称与映射，只更换底层节点图。指向已不存在节点 ID 的映射会进入“待检查”。</small>${blank ? "" : '<span class="risk">替换前会自动把当前映射包下载一份备份，方便回滚。</span>'}</div>
        </label>
      </div>
      <p class="help" id="wf-import-note"></p>
      <p class="help wf-import-howto">${icon("info", "xs")} 在 ComfyUI 里开启开发者模式后，用「导出 (API)」得到的 JSON 才能导入；普通保存得到的编辑器格式（含 nodes / links）会被拒绝。</p>
      <div class="modal-footer">
        ${btn("取消", "", "close-modal")}
        ${btn("确认导入", "check", "ws-do-unified-import", 'id="wf-unified-submit-btn" aria-disabled="true"', "primary disabled")}
      </div>
    </div>`,
    "统一工作流资产导入"
  );

  let inspected = [];
  const dropzone = $("#wf-unified-dropzone"),
    fileInput = $("#wf-unified-file-input"),
    submitBtn = $("#wf-unified-submit-btn"),
    fileListEl = $("#wf-import-filelist"),
    noteEl = $("#wf-import-note");

  const valid = () => inspected.filter((x) => x.ok);
  function refreshNote() {
    const modeNow = document.querySelector('input[name="wf-import-mode"]:checked')?.value || "new",
      good = valid().length,
      bad = inspected.length - good;
    const parts = [];
    if (bad) parts.push(`${bad} 份无法导入，会被跳过`);
    if (modeNow === "replace" && good > 1) parts.push("替换模式只使用第一份可导入的文件");
    if (noteEl) noteEl.textContent = parts.join("；");
  }
  async function handleFiles(files) {
    if (!files || !files.length) return;
    inspected = await Promise.all([...files].map(inspectWorkflowFile));
    fileListEl.hidden = false;
    fileListEl.innerHTML = inspected
      .map(
        (f, i) => `<div class="filerow ${f.ok ? "is-ok" : "is-bad"}"><span class="mono muted">${i + 1}</span><span class="nm" data-user-content title="${esc(f.name)}">${esc(f.name)}</span><span class="kind mono muted">${(f.size / 1024).toFixed(1)} KB</span><span class="res">${f.ok ? `${icon("check", "xs")}${esc(f.kind)} · ${esc(f.detail)}` : `${icon("alert", "xs")}${esc(f.detail)}`}</span></div>`
      )
      .join("");
    const good = valid().length;
    submitBtn.classList.toggle("disabled", !good);
    if (good) submitBtn.removeAttribute("aria-disabled");
    else submitBtn.setAttribute("aria-disabled", "true");
    submitBtn.innerHTML = icon("check") + esc(good ? localeString("导入 {n} 份", { n: good }) : "确认导入");
    refreshNote();
  }

  dropzone.onclick = () => fileInput.click();
  dropzone.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  };
  fileInput.onchange = () => handleFiles(fileInput.files);
  dropzone.ondragover = (e) => {
    e.preventDefault();
    dropzone.classList.add("is-over");
  };
  dropzone.ondragleave = () => dropzone.classList.remove("is-over");
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-over");
    handleFiles(e.dataTransfer.files);
  };
  document.querySelectorAll('input[name="wf-import-mode"]').forEach((r) => (r.onchange = refreshNote));
  window._pendingImportFiles = () => valid().map((x) => x.file);
}

/* ------------------------------------------------------------------ rail drawer */

function applyRailState() {
  const body = document.querySelector(".wf-body");
  if (!body) return;
  body.classList.toggle("rail-pinned", mapperUI.railPinned);
  body.classList.toggle("rail-floating", !mapperUI.railPinned);
  body.classList.toggle("rail-open", mapperUI.railOpen && !mapperUI.railPinned);
  body.classList.toggle("rail-sticky", !!mapperUI.railSticky && !mapperUI.railPinned);
  body.querySelector(".wf-rail-handle")?.setAttribute("aria-expanded", String(mapperUI.railOpen || mapperUI.railPinned));
}

/* Open / close the floating drawer. `sticky` marks an explicit request (click, keyboard, unpin) that must not be
   undone by the pointer wandering off; a hover-open drawer never downgrades a sticky one. */
function setRailOpen(open, { sticky = false } = {}) {
  clearTimeout(mapperUI.railTimer);
  clearTimeout(mapperUI.railHoverTimer);
  mapperUI.railHoverTimer = 0;
  if (mapperUI.railPinned) return;
  mapperUI.railSticky = open ? mapperUI.railSticky || sticky : false;
  mapperUI.railOpen = open;
  applyRailState();
}

/* Hover-opened drawers close a moment after the pointer leaves, unless the pointer came back, keyboard focus
   is inside the drawer, or one of its context menus is showing. Sticky and pinned drawers never auto-close. */
function scheduleRailClose(delay = 320) {
  clearTimeout(mapperUI.railTimer);
  if (mapperUI.railPinned || mapperUI.railSticky || !mapperUI.railOpen) return;
  mapperUI.railTimer = setTimeout(() => {
    const dock = document.getElementById("wf-rail-dock"),
      rail = document.getElementById("wf-rail");
    if (dock && (dock.matches(":hover") || (rail && rail.contains(document.activeElement)) || document.getElementById("wf-menu"))) return scheduleRailClose(delay);
    setRailOpen(false);
  }, delay);
}

/* Hover intent: only the visible handle opens the drawer, and only after the pointer rests on it briefly, so a
   trip across the left edge (for instance towards the main navigation) never flashes the library open. */
function armRailHover(handle) {
  if (mapperUI.railPinned || mapperUI.railOpen || mapperUI.railHoverTimer) return;
  mapperUI.railHoverTimer = setTimeout(() => {
    mapperUI.railHoverTimer = 0;
    if (handle.isConnected && handle.matches(":hover")) setRailOpen(true);
  }, 170);
}

function disarmRailHover() {
  clearTimeout(mapperUI.railHoverTimer);
  mapperUI.railHoverTimer = 0;
}

/* ------------------------------------------------------------------ install */

function installWorkflowWorkbench() {
  if (typeof MioIcons !== "undefined") MioIcons.mount("core:workflow", WORKFLOW_ICONS);
  const previous = handleAction;
  handleAction = async function (action, d = {}, el) {
    if (action === 'wf-channel-menu') {openWorkbenchMenu([{act:'image-provider-copy',icon:'copy',label:'复制渠道'},{act:'image-provider-delete',icon:'trash',label:'删除渠道'}],{anchor:el,label:'管理渠道'});return;}
    if (action === 'wf-detail-close') {mapperUI.selected='';mapperUI.nodes=false;render();return;}
    if (action === 'wf-group-focus') {
      if (mapperUI.filter !== 'all' || mapperUI.search) { mapperUI.filter = 'all'; mapperUI.search = ''; render(); }
      const head = document.querySelector(`.wf-group-head[data-mapping-group="${CSS.escape(String(d.group || ''))}"]`);
      head?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      head?.nextElementSibling?.querySelector('.wf-row-main')?.focus({ preventScroll: true });
      return;
    }
    if (action === 'wm-pick-noncore' || action === 'wm-pick-disabled') {
      const c=state.settings.comfy;mapperUI.sel.clear();
      mapperVisibleBindings(c).forEach(b=>{if(action==='wm-pick-disabled'?!b.enabled:!['positive','negative','caption'].includes(b.source))mapperUI.sel.add(b.id);});
      mapperSlotItems(c,mapperBindingIssues()).filter(mapperItemMatches).forEach(b=>{if(action!=='wm-pick-disabled'||!b.enabled)mapperUI.sel.add(b.id);});render();return;
    }
    if (action === "wf-channel-switch") {
      const g = ensureImageProviders();
      if (!g.profiles.some(p => p.id === d.id)) return;
      g.active = d.id; save(); render(); return;
    }
    if (action.startsWith('wf-preset')) { await handleSlotPresetAction(action, d); return; }
    if (action === 'wm-pick-all') {
      const c = state.settings.comfy, ids = [...mapperVisibleBindings(c).map(b=>b.id), ...mapperSlotItems(c,mapperBindingIssues()).filter(mapperItemMatches).map(b=>b.id)];
      const all = ids.every(id=>mapperUI.sel.has(id)); ids.forEach(id=> all ? mapperUI.sel.delete(id) : mapperUI.sel.add(id)); render(); return;
    }
    if (action === 'wm-delete-bulk' && [...mapperUI.sel].some(id=>id.startsWith('__slot_'))) {
      if (!await confirmAction('移除所选槽位？','普通映射将删除，模型与 LoRA 槽将停用；蓝图不会改变。','移除')) return;
      const c=state.settings.comfy; c.slots ||= {};
      if(mapperUI.sel.has('__slot_model__'))for(const t of c.slots.plan?.model.targets||[])t.enabled=false;
      if(mapperUI.sel.has('__slot_lora__'))for(const g of c.slots.plan?.lora.groups||[])g.enabled=false;
      c.bindings=c.bindings.filter(b=>!mapperUI.sel.has(b.id)); mapperUI.sel.clear();
      mapperUI.selMode = false;
      if (!c.bindings.some(b => b.id === mapperUI.selected) && !['__slot_model__', '__slot_lora__'].includes(mapperUI.selected)) {
        mapperUI.selected = c.bindings[0]?.id || '__slot_model__';
      }
      save(); render(); return;
    }
    if (action === "wf-menu") {
      if (document.getElementById("wf-menu")?._opener === el) closeWorkflowMenu();
      else openWorkflowMenu(el);
      return;
    }
    if (action === "wf-row-menu") {
      if (document.getElementById("wf-menu")?._opener === el) closeWorkflowMenu();
      else openWorkbenchMenu(contextItemsFor(d.kind, d.id), { anchor: el, label: d.kind === "workflow" ? "管理工作流" : "编辑与管理映射" });
      return;
    }
    if (action === "wf-help") {
      const comfy = activeImageProfile().provider === "comfyui";
      modal(
        "这个页面做什么？",
        `<div class="prose wf-help-sheet"><p>${esc(comfy ? WORKBENCH_HELP.comfy : WORKBENCH_HELP.cloud)}</p>${comfy ? `<ul>
          <li><strong>工作流库</strong>默认固定在左侧；点图钉可收起为边缘标签（点击或悬停展开，Esc 收起），再次固定即可常驻。</li>
          <li>顶部的<strong>出图流程</strong>卡片概括提示词 → 模型 → LoRA → 画面参数 → 结果输出的接入状态，点击直接跳到对应设置。</li>
          <li>每条<strong>映射</strong>分三步设置：① 写到哪里（节点与输入字段）② 填什么（取值来源）③ 效果预览。</li>
          <li><strong>右键</strong>任意映射或工作流，可以启用 / 停用、重命名、复制、导出或删除；行尾的 ⋯ 按钮是同一份菜单。</li>
          <li>映射与原始蓝图分开保存，节点连线受保护，改动自动保存且不影响已入队的任务。</li>
        </ul>` : ""}</div><div class="modal-footer">${btn("知道了", "check", "close-modal", "", "primary")}</div>`
      );
      return;
    }
    if (action === "wf-connection-toggle") {
      mapperUI.connectionOpen = !mapperUI.connectionOpen;
      render();
      if (mapperUI.connectionOpen) document.getElementById("wf-connection-body")?.querySelector("input:not([type=radio]):not([disabled]),select")?.focus({ preventScroll: true });
      else document.querySelector('[data-act="wf-connection-toggle"]')?.focus({ preventScroll: true });
      return;
    }
    if (action === "wf-check-connection") {
      await checkWorkflowConnection();
      return;
    }
    if (action === "wf-rail-toggle") {
      if (mapperUI.railPinned) return;
      // A click on the handle is an explicit request: it turns a hover-open drawer sticky instead of closing it,
      // and only a second click (or Esc / clicking elsewhere) closes it again.
      if (mapperUI.railOpen && mapperUI.railSticky) { setRailOpen(false); return; }
      const keyboard = !!el?.matches?.(":focus-visible");
      setRailOpen(true, { sticky: true });
      if (keyboard) document.querySelector("#wf-rail .wf-item.active .wf-item-body, #wf-rail .wf-item-body")?.focus();
      return;
    }
    if (action === "wf-rail-pin") {
      mapperUI.railPinned = !mapperUI.railPinned;
      // Unpinning keeps the drawer out (sticky) so the click is not jarring; it closes on the next outside click or Esc.
      mapperUI.railOpen = !mapperUI.railPinned;
      mapperUI.railSticky = !mapperUI.railPinned;
      disarmRailHover();
      setWorkbenchPref("railPinned", mapperUI.railPinned);
      render();
      toast(mapperUI.railPinned ? "工作流库已固定显示" : "工作流库已收起；点击左侧「工作流库」标签可再次展开");
      return;
    }
    if (action === "wf-clear-filter") {
      mapperUI.search = "";
      mapperUI.filter = "all";
      render();
      $("#wm-binding-search")?.focus();
      return;
    }
    if (action === "wf-clear-library-search") {
      mapperUI.libSearch = "";
      render();
      $("#ws-library-search-input")?.focus();
      return;
    }
    if (action === "wm-select" || action === "wm-select-slot") {
      const fromRow = !!document.activeElement?.closest?.(".wf-row-main");
      mapperUI.selected = action === "wm-select" ? d.id : d.id === "lora" ? "__slot_lora__" : "__slot_model__";
      mapperUI.nodes = false;
      render();
      // Keyboard users keep their place in the list; the inspector follows on the side.
      if (fromRow) document.querySelector(".wf-row.selected .wf-row-main")?.focus({ preventScroll: true });
      if (innerWidth <= 1024) document.querySelector(".wm-inspector")?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    if (action === "wf-field-custom" || action === "wf-field-list") {
      mapperUI.customPath = action === "wf-field-custom" ? d.id : "";
      render();
      document.querySelector('[data-v3-binding="path"]')?.focus();
      return;
    }
    if (action === "wf-binding-toggle") {
      const b = state.settings.comfy.bindings.find((x) => x.id === d.id);
      if (!b) return;
      b.enabled = !b.enabled;
      save();
      render();
      toast(b.enabled ? "映射已启用" : "映射已停用，生成时不再写入");
      return;
    }
    if(action==='wf-slots-analyze'){await ensureWorkflowSlotPlan(state.settings.comfy,{force:true});toast('槽位计划已更新');return;}
    if(action==='wf-slots-manual'){
      const c=state.settings.comfy;
      modal('手动指定槽位',`<p>只指定节点和字段，形态由后端判断。仍受活跃过滤和写入校验约束。</p>${field('节点与字段',`<select id="slot-manual-field">${Object.entries(c.workflow||{}).flatMap(([nodeId,n])=>Object.keys(n.inputs||{}).map(path=>`<option value="${esc(JSON.stringify({nodeId,path}))}">#${esc(nodeId)} · ${esc(path)}</option>`)).join('')}</select>`)}<footer class="modal-footer">${btn('加入计划','check','wf-slots-manual-save','','primary')}</footer>`);return;
    }
    if(action==='wf-slots-manual-save'){
      const c=state.settings.comfy,entry=JSON.parse(document.getElementById('slot-manual-field').value);
      await ensureWorkflowSlotPlan(c,{force:true,manual:[...(c.slots?.plan?.manual||[]),entry]});closeModal();render();return;
    }
    if (action === "wf-slot-toggle") {
      const kind = d.slot;
      const v = slotView().resolved[kind];
      const next = kind === 'model' ? !v.enabled : v.mode === 'off';
      applySlotControl(kind + ".enabled", { checked: next });
      toast((kind === 'model' ? '基础模型' : 'LoRA') + (next ? '已启用' : '已停用'));
      return;
    }
    if (action === "wf-binding-rename") {
      mapperUI.selected = d.id;
      mapperUI.nodes = false;
      render();
      const title = document.querySelector(".wf-detail-title");
      if (title) { title.focus(); title.select(); }
      return;
    }
    if (action === "wf-binding-locate") {
      const b = state.settings.comfy.bindings.find((x) => x.id === d.id);
      if (!b) return;
      mapperUI.selected = d.id;
      mapperUI.nodes = true;
      createUI.nodeSearch = b.nodeId ? String(b.nodeId) : "";
      render();
      $("#v3-node-search")?.focus();
      return;
    }
    if (action === "wf-binding-multi") {
      mapperUI.selMode = true;
      mapperUI.sel.add(d.id);
      render();
      return;
    }
    if (action === "wf-ws-rename") {
      const c = state.settings.comfy,
        p = (c.presets || []).find((x) => x.id === d.id);
      if (!p) return;
      textModal("重命名工作流", "工作流名称", p.id === c.activeWorkflowId ? c.workflowTitle : p.title || "", (value) => {
        const title = String(value || "").trim();
        if (!title) throw Error("请填写名称");
        p.title = title;
        if (p.id === c.activeWorkflowId) c.workflowTitle = title;
        p.updatedAt = Date.now();
        save();
        closeModal();
        render();
        toast("已重命名");
      });
      return;
    }
    if (action === "wf-ws-copy") {
      storeActiveWorkflow();
      const c = state.settings.comfy,
        source = (c.presets || []).find((x) => x.id === d.id);
      if (!source) return;
      const copy = clone(source);
      copy.id = uid("wf");
      copy.title = (source.title || "未命名工作流") + " · 副本";
      copy.updatedAt = Date.now();
      c.presets.push(copy);
      selectLibraryWorkflow(copy.id);
      toast("已复制为独立副本");
      return;
    }
    if (action === "wf-ws-export") {
      storeActiveWorkflow();
      const p = (state.settings.comfy.presets || []).find((x) => x.id === d.id);
      if (!p) return;
      download(
        safeFolderName(p.title || "workflow") + ".mappings.json",
        JSON.stringify({ kind: "comfycomic.workflow-mappings", formatVersion: 1, title: p.title, workflow: p.workflow, bindings: p.bindings || [], outputNodeId: p.outputNodeId || "", randomizeSeeds: !!p.randomizeSeeds }, null, 2)
      );
      return;
    }
    if (action === "wf-ws-delete") {
      const c = state.settings.comfy;
      if (d.id === c.activeWorkflowId) return previous("ws-delete", d, el);
      const p = (c.presets || []).find((x) => x.id === d.id);
      if (!p) return;
      if (c.presets.length === 1) throw Error("至少保留一份工作流。");
      if (workflowReferenced(p.id)) throw Error("有画册或分镜正在引用此工作流，请先更换选择。");
      if (!(await confirmAction(`删除「${p.title || "未命名工作流"}」？`, "已入队的工作流快照不会删除。建议先导出备份。", "删除"))) return;
      c.presets = c.presets.filter((x) => x.id !== p.id);
      mapperUI.libSel.delete(p.id);
      save(true);
      render();
      toast("工作流已删除");
      return;
    }
    if (action === "ws-open-unified-import") {
      openUnifiedWorkflowImportModal(d.mode || "new");
      return;
    }
    if (action === "first-run-provider" || action === "image-provider-settings" || action === "first-run-config") mapperUI.connectionOpen = true;
    return previous(action, d, el);
  };

  /* Filter lives in a select now; a committed address change drops the old socket so the bar cannot claim 已连接 for the wrong server. */
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el?.id === "wm-filter-select") {
      mapperUI.filter = el.value;
      render();
    }
    if (el?.id === "wm-show-targets") {
      mapperUI.showTargets = el.checked;
      setWorkbenchPref("showTargets", mapperUI.showTargets);
      render();
    }
    if (el?.id === "setup-comfy-url") {
      state.settings.comfy.baseUrl = el.value.trim();
      save();
      if (typeof resetWS === "function") resetWS();
      renderShell();
      refreshConnectionViews();
    }
    if(el?.dataset?.slotPlanKey){
      const c=state.settings.comfy,kind=el.dataset.slotPlanKind;
      const entry=c.slots.plan[kind][kind==='model'?'targets':'groups'].find(x=>x.key===el.dataset.slotPlanKey);
      if(entry){entry.enabled=el.checked;entry.disabled=!el.checked;}
      storeActiveWorkflow();save();render();return;
    }
    if (el?.dataset?.v3Slot) {
      try { applySlotControl(el.dataset.v3Slot, el); } catch (error) { toast(error.message, "error"); }
    }
  });

  /* Rail drawer. Click on the handle = open (sticky) / close. Resting the pointer on the handle also opens it,
     and that hover-open drawer closes shortly after the pointer leaves; a sticky one waits for a click elsewhere,
     the handle, or Esc. Keyboard focus inside the drawer keeps it open. */
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const handle = e.target.closest?.(".wf-rail-handle");
    if (handle) armRailHover(handle);
    if (mapperUI.railOpen && e.target.closest?.("#wf-rail-dock")) clearTimeout(mapperUI.railTimer);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    const handle = e.target.closest?.(".wf-rail-handle");
    if (handle && !(e.relatedTarget && handle.contains(e.relatedTarget))) disarmRailHover();
    const dock = e.target.closest?.("#wf-rail-dock");
    if (dock && !(e.relatedTarget && dock.contains(e.relatedTarget))) scheduleRailClose();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!mapperUI.railOpen || mapperUI.railPinned) return;
    if (e.target.closest?.("#wf-rail-dock, #wf-menu, dialog, .ctx-menu")) return;
    setRailOpen(false);
  });
  document.addEventListener("focusin", (e) => {
    if (e.target.closest?.("#wf-rail")) clearTimeout(mapperUI.railTimer);
  });
  document.addEventListener("focusout", (e) => {
    const dock = e.target.closest?.("#wf-rail-dock");
    if (dock && !(e.relatedTarget && dock.contains(e.relatedTarget))) scheduleRailClose(200);
  });

  /* Dedicated right-click menus for rows and library items; text controls keep the native menu. */
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest?.(".wf-page")) return;
    if (e.target.closest("input,textarea,select,[contenteditable]")) return;
    const row = e.target.closest("[data-binding-row]"),
      item = e.target.closest("[data-workflow-id]"),
      output = e.target.closest("[data-output-row]");
    let items = null,
      label = "";
    if (row) { items = bindingContextItems(row.dataset.bindingRow); label = "编辑与管理映射"; }
    else if (item) { items = workflowContextItems(item.dataset.workflowId); label = "管理工作流"; }
    else if (output) { items = outputContextItems(); label = "结果输出"; }
    if (!items || !items.length) return;
    e.preventDefault();
    openWorkbenchMenu(items, { x: e.clientX, y: e.clientY, label });
  });

  /* Light-DOM echoes that do not deserve a full render. */
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el || !el.matches) return;
    if (el.id === "setup-comfy-url") {
      // first-run.js already stores the address; here the bar and the status line follow the typing.
      const url = document.querySelector(".wf-connection-url");
      if (url) url.textContent = el.value.trim() || "未填写地址";
      const status = document.getElementById("setup-comfy-status");
      if (status && !connectionRecord(el.value)) {
        status.className = "wf-probe tone-idle";
        status.innerHTML = '<i class="wf-dot" aria-hidden="true"></i><b>地址已更改</b><span>尚未检查</span>';
      }
      return;
    }
    if (el.matches(".wm-title")) {
      const title = el.value.trim() || "未命名工作流";
      const item = document.querySelector(".wf-item.active .wf-item-title");
      if (item) { item.textContent = title; item.closest(".wf-item-body")?.setAttribute("title", title); }
      const option = document.querySelector("#ws-library-select option[selected], #ws-library-select option:checked");
      if (option) option.textContent = title;
      return;
    }
    if (el.id === "ws-library-search-input") {
      mapperUI.libSearch = el.value;
      const list = document.getElementById("wf-rail-list");
      if (list) list.innerHTML = renderWorkflowRailItems();
      return;
    }
    if (el.dataset.v3Binding === "value") {
      const b = state.settings.comfy.bindings.find((x) => x.id === el.dataset.id);
      const pre = document.querySelector("[data-wf-preview-new]");
      if (b && pre && b.source === "literal") pre.textContent = el.value || "（空）";
      if (b && pre && b.source === "variable") pre.textContent = "{" + el.value + "}";
    }
  });

  /* Menu lifecycle: outside click, Escape, arrow keys, and any action closes it. */
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("wf-menu");
    if (!menu) return;
    if (menu._opener && e.target.closest('[data-act="wf-menu"],[data-act="wf-row-menu"]') === menu._opener) return;
    closeWorkflowMenu();
  });
  document.addEventListener("keydown", (e) => {
    const menu = document.getElementById("wf-menu");
    if (!menu) {
      if (e.key === "Escape" && mapperUI.railOpen && !mapperUI.railPinned && !document.querySelector("dialog[open],.ctx-menu") && !(typeof contextMenuOpen === "function" && contextMenuOpen()) && !e.target.closest?.("#assistant")) {
        const inside = !!document.activeElement?.closest?.("#wf-rail-dock");
        setRailOpen(false);
        if (inside) document.querySelector(".wf-rail-handle")?.focus();
      }
      /* Roving focus in the mapping list: ↑↓ Home End move between rows, Enter / Space open (native button). */
      const rowButton = e.target.closest?.(".wf-rows .wf-row-main");
      if (rowButton && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const buttons = [...document.querySelectorAll(".wf-rows .wf-row-main")],
          i = buttons.indexOf(rowButton);
        if (i < 0) return;
        e.preventDefault();
        const next = e.key === "ArrowDown" ? Math.min(buttons.length - 1, i + 1) : e.key === "ArrowUp" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : buttons.length - 1;
        buttons[next]?.focus();
        buttons[next]?.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    const items = [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); const opener = menu._opener; closeWorkflowMenu(); (opener?.isConnected ? opener : document.getElementById("wf-menu-button"))?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Tab") closeWorkflowMenu();
  });
  addEventListener("resize", closeWorkflowMenu);
  addEventListener("scroll", closeWorkflowMenu, true);
}

/* Portable, node-independent slot recipes. No workflow, credentials or node IDs are exported. */
const SLOT_PRESET_KEY = 'slot-presets.v1';
const SLOT_PRESET_TYPES = {...SOURCE_TAG, model:'模型', lora:'LoRA'};
const SLOT_PRESET_DEFAULT = {id:'starter', title:'常用出图槽位', rows:[
  {label:'正向提示词',source:'positive',path:'text',value:''},
  {label:'负向提示词',source:'negative',path:'text',value:''},
  {label:'基础模型',source:'model',path:'ckpt_name',value:''},
  {label:'LoRA',source:'lora',path:'lora_name',value:'',mode:'chain'},
]};
let slotPresetDraft = null;
function validateSlotPreset(raw) {
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 100 || !Array.isArray(raw.rows) || !raw.rows.length || raw.rows.length > 64) throw Error('预设需要名称与 1–64 个槽位。');
  const semantic = new Set();
  const rows = raw.rows.map(r => {
    if (!r || !Object.hasOwn(SLOT_PRESET_TYPES,r.source) || typeof r.label !== 'string' || !r.label.trim() || r.label.length > 100 || typeof r.path !== 'string' || !r.path.trim() || r.path.length > 200) throw Error('请填写槽位名称、有效用途与输入字段。');
    if (['model','lora'].includes(r.source)) {
      if (semantic.has(r.source)) throw Error('每个预设最多包含一个模型槽和一个 LoRA 槽。');
      semantic.add(r.source);
    }
    WorkflowMapping.inputPathParts(r.path.trim());
    if (r.source === 'lora' && !['syntax','chain','stack'].includes(r.mode)) throw Error('请选择 LoRA 写入方式。');
    return {label:r.label.trim(),source:r.source,path:r.path.trim(),value:String(r.value ?? '').slice(0,4000), ...(r.source === 'lora' ? {mode:r.mode} : {})};
  });
  return {id:typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(raw.id) ? raw.id : uid('slots'),title:raw.title.trim(),rows};
}
/* Slot presets are workspace data (settings/comfy.json → slotPresets), so they travel with backups and every
   browser sees the same list. Presets saved by older builds in this browser's localStorage are adopted once. */
function slotPresetStore() {
  const c = state.settings.comfy;
  if (!Array.isArray(c.slotPresets)) c.slotPresets = [];
  const legacyKey = WORKBENCH_PREF_PREFIX + SLOT_PRESET_KEY;
  let legacy = null;
  try { legacy = localStorage.getItem(legacyKey); } catch { legacy = null; }
  if (legacy) {
    const known = new Set(c.slotPresets.map(p => p?.id));
    let adopted = 0;
    try {
      for (const raw of JSON.parse(legacy) || []) {
        try { const p = validateSlotPreset(raw); if (!known.has(p.id)) { c.slotPresets.push(p); known.add(p.id); adopted++; } } catch { /* skip invalid legacy entries */ }
      }
    } catch { /* unreadable legacy value */ }
    try { localStorage.removeItem(legacyKey); } catch { /* private mode */ }
    if (adopted) save();
  }
  return c.slotPresets;
}
function slotPresetLibrary() {
  const saved = slotPresetStore();
  return [clone(SLOT_PRESET_DEFAULT), ...saved.flatMap(p=>{try{return [validateSlotPreset(p)];}catch{return [];}})];
}
function persistSlotPresets(items) {
  state.settings.comfy.slotPresets = items.map(p => validateSlotPreset(p));
  save();
}
function openSlotPresets() {
  modal('槽位预设', `<div class="wf-preset-intro"><span class="wf-preset-symbol">${icon('layers')}</span><div><h3>配置一次，重复使用</h3><p>保存常用槽位与写入规则。应用到新工作流时，只需对应节点 ID。</p></div></div><div class="wf-preset-library">${slotPresetLibrary().map(p=>`<article class="wf-preset-card"><div><strong data-user-content>${esc(p.title)}</strong><p>${p.rows.length} 个槽位 · ${p.rows.map(r=>esc(r.label)).join(' / ')}</p></div><div class="row wrap">${btn('应用','arrow','wf-preset-apply',`data-id="${esc(p.id)}"`,'small primary')}${btn('编辑','edit','wf-preset-edit',`data-id="${esc(p.id)}"`,'small')}${btn('导出','download','wf-preset-export',`data-id="${esc(p.id)}"`,'small ghost')}${p.id==='starter'?'':btn('删除','trash','wf-preset-delete',`data-id="${esc(p.id)}"`,'small ghost')}</div></article>`).join('')}</div><footer class="modal-footer">${btn('导入 JSON','upload','wf-preset-import')}${btn('从当前工作流创建','copy','wf-preset-capture')}${btn('新建预设','plus','wf-preset-new','','primary')}</footer>`, '独立于节点插件；预设随工作室保存，也可导出 JSON 分享。', true);
}
function readSlotPresetDraft() {
  slotPresetDraft.title = document.getElementById('slot-preset-title').value;
  slotPresetDraft.rows = [...document.querySelectorAll('[data-preset-row]')].map(el=>Object.fromEntries([...el.querySelectorAll('[data-recipe-field]')].map(input=>[input.dataset.recipeField,input.value])));
}
function renderSlotPresetEditor() {
  const p=slotPresetDraft;
  modal('编辑槽位预设', `${field('预设名称',`<input id="slot-preset-title" maxlength="100" value="${esc(p.title)}">`)}<p class="help">这里不绑定节点。字段名与规则会复用；LoRA 方式只对 LoRA 槽生效。</p><div class="wf-recipe-list">${p.rows.map((r,i)=>`<fieldset class="wf-recipe-row" data-preset-row><legend>槽位 ${i+1}</legend>${field('名称',`<input data-recipe-field="label" value="${esc(r.label)}" maxlength="100">`)}${field('用途',`<select data-recipe-field="source">${Object.entries(SLOT_PRESET_TYPES).map(([v,label])=>opt(v,label,r.source)).join('')}</select>`)}${field('输入字段',`<input data-recipe-field="path" value="${esc(r.path)}" placeholder="text / ckpt_name" maxlength="200">`)}${field('固定值 / 参数名',`<input data-recipe-field="value" value="${esc(r.value || '')}" placeholder="仅固定值、变量或分镜参数需要">`)}${field('LoRA 方式',`<select data-recipe-field="mode">${['chain','syntax','stack'].map(v=>opt(v,SLOT_MODE_LABEL[v],r.mode || 'chain')).join('')}</select>`)}${btn('移除此槽','trash','wf-preset-remove',`data-index="${i}"`,'small ghost')}</fieldset>`).join('')}</div><footer class="modal-footer">${btn('返回','','wf-presets')}${btn('添加槽位','plus','wf-preset-add')}${btn('保存预设','check','wf-preset-save','','primary')}</footer>`, '所有槽位使用相同的名称、用途与写入字段结构。', true);
}
function openSlotPresetApply(p) {
  const c=state.settings.comfy;
  if (!Object.keys(c.workflow || {}).length) throw Error('请先导入 ComfyUI API 工作流，再应用预设。');
  slotPresetDraft=clone(p);
  modal('应用 · '+p.title, `<p class="help">只添加新映射，不覆盖已有映射。模型与 LoRA 槽会替换对应的槽位设置。取消勾选可跳过暂不需要的槽位。</p><div class="wf-recipe-list">${p.rows.map((r,i)=>`<fieldset class="wf-apply-row" data-apply-row="${i}"><legend><label><input type="checkbox" data-recipe-use checked> ${esc(r.label)}</label></legend>${field('节点 ID',`<input data-recipe-node list="preset-node-ids" placeholder="填写节点 ID" autocomplete="off">`)}${field('输入字段',`<input data-recipe-path value="${esc(r.path)}">`)}<span class="help">${esc(SLOT_PRESET_TYPES[r.source])}${r.source==='lora'?' · '+esc(SLOT_MODE_LABEL[r.mode]):''}</span></fieldset>`).join('')}</div><datalist id="preset-node-ids">${Object.entries(c.workflow).map(([id,n])=>`<option value="${esc(id)}">${esc(n._meta?.title || n.class_type)}</option>`).join('')}</datalist><p id="slot-preset-error" class="wf-row-warning" role="alert"></p><footer class="modal-footer">${btn('返回','','wf-presets')}${btn('校验并应用','check','wf-preset-confirm','','primary')}</footer>`, '先对应节点，再一次应用。字段不匹配时可在这里调整。', true);
}
function applySlotPresetTargets(p, targets, c) {
  const bindings=clone(c.bindings), slots=clone(c.slots || {}), added=[];
  if (!targets.length) throw Error('请至少选择一个槽位。');
  for(const t of targets) {
    const r=p.rows[t.index];
    if(!r) throw Error('槽位不存在。');
    const nodeId=String(t.nodeId).trim(), path=String(t.path).trim(), node=Object.hasOwn(c.workflow,nodeId)?c.workflow[nodeId]:null;
    if(!node) throw Error(`${r.label}：节点 #${nodeId || '（未填）'} 不存在。`);
    const input=WorkflowMapping.inputAt(node,path,c.workflow);
    if(!input.exists || input.blocked || WorkflowMapping.isWorkflowLink(input.value,c.workflow)) throw Error(`${r.label}：字段 ${path} 不存在或是连线，请选择实际输入。`);
    if(r.source==='model') { if(typeof input.value!=='string') throw Error('模型槽需要模型文件名字段。'); slots.model={enabled:true,auto:false,nodeId,path}; continue; }
    if(r.source==='lora') {
      slots.lora={auto:false,mode:r.mode,nodeId,path}; continue;
    }
    const b={id:uid('bind'),label:r.label,source:r.source,nodeId,path,value:r.value || '',type:'auto',enabled:true,autoField:false,allowCreate:false,allowLink:false,warning:''};
    bindings.push(b); added.push(b.id);
  }
  const conflicts=validateMappingTargets(c.workflow,bindings).filter(i=>added.includes(i.id));
  if(conflicts.length) throw Error(conflicts[0].message);
  // Check cross-kind collisions too: semantic slots and ordinary mappings must not share an input.
  const vSlots=slotView({...c,slots}).resolved, semantic=[];
  const mNode = slots.model?.nodeId || vSlots.model?.nodeId, mPath = slots.model?.path || vSlots.model?.path;
  if((slots.model?.enabled || vSlots.model?.enabled) && mNode && mPath) semantic.push({id:'slot-model',nodeId:mNode,path:mPath,enabled:true,source:'literal'});
  const lMode = slots.lora?.mode || vSlots.lora?.mode, lNode = slots.lora?.nodeId || vSlots.lora?.nodeId, lPath = slots.lora?.path || vSlots.lora?.path;
  if(lMode && !['off','syntax'].includes(lMode) && lNode && lPath) semantic.push({id:'slot-lora',nodeId:lNode,path:lPath,enabled:true,source:'literal'});
  const relevantIds=new Set([...added, ...semantic.map(s=>s.id)]);
  const cross=validateMappingTargets(c.workflow,[...bindings,...semantic]).filter(i=>relevantIds.has(i.id) && i.message.includes('映射'));
  if(cross.length) throw Error('槽位写入位置冲突：'+cross[0].message);
  return {bindings,slots};
}
async function handleSlotPresetAction(action,d) {
  const p=slotPresetLibrary().find(p=>p.id===d.id);
  if(['wf-preset-edit','wf-preset-export','wf-preset-apply'].includes(action) && !p){
    toast('预设不存在或已被删除，请刷新后重试。','error');
    return;
  }
  if(action==='wf-presets') return openSlotPresets();
  if(action==='wf-preset-new'){slotPresetDraft={id:uid('slots'),title:'',rows:[]};return renderSlotPresetEditor();}
  if(action==='wf-preset-edit'){slotPresetDraft=clone(p);if(p.id==='starter')slotPresetDraft.id=uid('slots');return renderSlotPresetEditor();}
  if(action==='wf-preset-add'){readSlotPresetDraft();slotPresetDraft.rows.push({label:'',source:'positive',path:'text',value:''});return renderSlotPresetEditor();}
  if(action==='wf-preset-remove'){readSlotPresetDraft();slotPresetDraft.rows.splice(Number(d.index),1);return renderSlotPresetEditor();}
  if(action==='wf-preset-save'){
    readSlotPresetDraft();const validated=validateSlotPreset(slotPresetDraft),items=slotPresetLibrary().filter(p=>p.id!=='starter' && p.id!==validated.id);items.push(validated);persistSlotPresets(items);toast('槽位预设已保存');return openSlotPresets();
  }
  if(action==='wf-preset-delete'){
    if(p && p.id!=='starter' && await confirmAction('删除预设？','已应用的工作流不会改变。','删除')){persistSlotPresets(slotPresetLibrary().filter(x=>x.id!=='starter'&&x.id!==p.id));openSlotPresets();}return;
  }
  if(action==='wf-preset-export')return download(safeFolderName(p.title)+'.slots.json',JSON.stringify({kind:'mio.slot-preset',version:1,preset:validateSlotPreset(p)},null,2));
  if(action==='wf-preset-import'){
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{try{const f=input.files[0];if(!f)return;if(f.size>256*1024)throw Error('预设文件不能超过 256 KB。');const data=JSON.parse(await f.text());if(!data||typeof data!=='object'||data.kind!=='mio.slot-preset'||data.version!==1)throw Error('不支持的槽位预设格式。');slotPresetDraft=validateSlotPreset(data.preset);slotPresetDraft.id=uid('slots');renderSlotPresetEditor();}catch(e){toast(e.message,'error');}};input.click();return;
  }
  if(action==='wf-preset-capture'){
    const c=state.settings.comfy,v=slotView(c);slotPresetDraft={id:uid('slots'),title:String(c.workflowTitle||'工作流').slice(0,100)+' · 槽位',rows:(c.bindings||[]).map(b=>({label:String(b.label||SOURCE_TAG[b.source]||'槽位').slice(0,100),source:b.source,path:String(b.path||'').slice(0,200),value:String(b.value||'').slice(0,4000)}))};
    if(v.resolved.model.enabled)slotPresetDraft.rows.push({label:'基础模型',source:'model',path:String(v.resolved.model.path||'ckpt_name').slice(0,200),value:''});
    if(v.resolved.lora.mode!=='off')slotPresetDraft.rows.push({label:'LoRA',source:'lora',path:String(v.resolved.lora.path||'lora_name').slice(0,200),mode:v.resolved.lora.mode,value:''});
    return renderSlotPresetEditor();
  }
  if(action==='wf-preset-apply')return openSlotPresetApply(p);
  if(action==='wf-preset-confirm'){
    try{
      const targets=[...document.querySelectorAll('[data-apply-row]')].filter(el=>el.querySelector('[data-recipe-use]').checked).map(el=>({index:Number(el.dataset.applyRow),nodeId:el.querySelector('[data-recipe-node]').value,path:el.querySelector('[data-recipe-path]').value}));
      const c=state.settings.comfy,result=applySlotPresetTargets(slotPresetDraft,targets,c);Object.assign(c,result);await ensureWorkflowSlotPlan(c,{force:true,manual:[...(c.slots?.plan?.manual||[]),...targets.filter(t=>['model','lora'].includes(slotPresetDraft.rows[t.index]?.source)).map(t=>({nodeId:t.nodeId,path:t.path}))]});storeActiveWorkflow();save();closeModal();render();toast('槽位预设已应用，原始蓝图保持不变');
    }catch(e){document.getElementById('slot-preset-error').textContent=e.message;}
  }
}
