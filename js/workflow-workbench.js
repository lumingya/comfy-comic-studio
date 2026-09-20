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
  railPinned: workbenchPref("railPinned", false) === true,
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
};

/* ------------------------------------------------------------------ data helpers */

function mapperSelectedBinding() {
  const c = state.settings.comfy;
  return c.bindings.find((b) => b.id === mapperUI.selected) || c.bindings[0];
}

function mapperBindingIssues() {
  const c = state.settings.comfy,
    issues = validateMappingTargets(c.workflow, c.bindings);
  if (c.outputNodeId && !Object.hasOwn(c.workflow, c.outputNodeId))
    issues.push({ id: "", kind: "output", message: "指定的结果图片节点 #" + c.outputNodeId + " 不存在。" });
  return issues;
}

/* Bindings that survive the current filter + search. Shared with the bulk "全选" action. */
function mapperVisibleBindings(c = state.settings.comfy, issues = mapperBindingIssues()) {
  const query = mapperUI.search.trim().toLowerCase();
  return c.bindings.filter((b) => {
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
function workflowConnectionStatus() {
  const c = state.settings.comfy;
  if (c.mode === "mock") return { tone: "demo", label: "离线演示", detail: "不调用 GPU，用本地 SVG 出图" };
  if (rt.connected) {
    const bits = [];
    if (rt.latency != null) bits.push(rt.latency + " ms");
    if (rt.vram != null) bits.push("VRAM " + rt.vram + "%");
    return { tone: "ok", label: "已连接", detail: bits.join(" · ") };
  }
  if (firstRunUI.checking) return { tone: "idle", label: "检查中…", detail: "" };
  const last = firstRunUI.checks.get(c.baseUrl);
  if (last) {
    const failed = last.startsWith("连接失败");
    return { tone: failed ? "bad" : "ok", label: failed ? "连接失败" : "服务可读", detail: last.replace(/^连接失败：/, ""), full: last };
  }
  return { tone: "idle", label: "按需连接", detail: "尚未检查；开始生成时会自动连接" };
}

/* ------------------------------------------------------------------ page */

const WORKBENCH_HELP = {
  comfy: "把分镜里的提示词、参数与素材接到 ComfyUI 节点上。映射与原始蓝图分开保存，改动不会影响已入队的任务。",
  cloud: "当前使用云端图像渠道，不需要 ComfyUI 工作流。填好地址、模型与密钥，就可以去编写分镜。",
};

function renderWorkflowLibrary() {
  const profile = activeImageProfile();
  const comfy = profile.provider === "comfyui";
  const title = `<div class="wf-bar-title">
      <span class="context-kicker">图像生产</span>
      <h1>工作流与 API 配置</h1>
      <button type="button" class="wf-help" data-act="wf-help" aria-label="这个页面做什么？" title="${esc(comfy ? WORKBENCH_HELP.comfy : WORKBENCH_HELP.cloud)}">${icon("question", "sm")}</button>
    </div>`;

  if (!comfy) {
    return `<section class="wf-page wf-page-cloud">
      <header class="wf-bar">${title}</header>
      <div class="wf-provider">${imageProviderPanel()}</div>
    </section>`;
  }

  const status = workflowConnectionStatus(),
    c = state.settings.comfy,
    open = mapperUI.connectionOpen;
  return `<section class="wf-page">
    <header class="wf-bar">
      ${title}
      <div class="wf-connection wm-connection tone-${status.tone}" data-wm-connection ${open ? "open" : ""}>
        <button type="button" class="wf-connection-summary" data-act="wf-connection-toggle" aria-expanded="${open}" aria-controls="wf-connection-body" title="${esc(status.full || status.detail || "")}">
          <i class="wf-dot" aria-hidden="true"></i>
          <strong>ComfyUI</strong>
          <span class="wf-connection-url mono">${esc(c.baseUrl || "未填写地址")}</span>
          <span class="wf-connection-state"><b>${esc(status.label)}</b>${status.detail ? `<span class="wf-connection-detail">${esc(status.detail)}</span>` : ""}</span>
          <span class="wf-connection-more">连接设置 ${icon("down", "sm")}</span>
        </button>
        ${c.mode === "mock" ? "" : btn(firstRunUI.checking ? "检查中…" : "测试连接", "refresh", "first-run-check-comfy", firstRunUI.checking ? "disabled" : "", "small ghost")}
      </div>
      <span class="spacer"></span>
      <div class="wf-bar-actions">${btn("添加工作流", "plus", "ws-open-unified-import", 'aria-label="添加工作流（导入 API 工作流或映射包）"', "primary small")}</div>
    </header>
    <div class="wf-connection-body" id="wf-connection-body" ${open ? "" : "hidden"}>${imageProviderPanel()}</div>
    <div class="workflow-library wf-body ${mapperUI.railPinned ? "rail-pinned" : "rail-floating"} ${mapperUI.railOpen && !mapperUI.railPinned ? "rail-open" : ""}">
      <div class="wf-rail-dock" id="wf-rail-dock">
        <button type="button" class="wf-rail-handle" data-act="wf-rail-toggle" aria-expanded="${mapperUI.railOpen || mapperUI.railPinned}" aria-controls="wf-rail" title="工作流库 · 点击图钉可固定显示">
          ${icon("sidebar", "sm")}<span class="wf-rail-handle-label">工作流库</span><b class="mono">${(c.presets || []).length}</b>
        </button>
        ${renderWorkflowRail(c)}
      </div>
      <div class="wf-main">${renderSmartMapper()}</div>
    </div>
  </section>`;
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
      ${ibtn(pinned ? "pinned" : "pin", "wf-rail-pin", pinned ? "取消固定：鼠标离开后自动收起" : "固定显示工作流库", `aria-pressed="${pinned}"`)}
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
        bindings = (p.bindings || []).length,
        referenced = workflowReferenced(p.id),
        dup = dupes.has(String(p.title || "").trim().toLowerCase());
      return `<div class="workflow-library-item wf-item ${isCurrent ? "active" : ""} ${isPicked ? "is-picked" : ""}" role="listitem" data-workflow-id="${esc(p.id)}">
        <input type="checkbox" class="sel-cbox" ${isPicked ? "checked" : ""} data-act="ws-lib-pick" data-id="${esc(p.id)}" aria-labelledby="wf-sr-pick wf-item-title-${esc(p.id)}">
        <button type="button" class="wf-item-body" data-act="${mapperUI.libSelMode ? "ws-lib-pick" : "ws-select"}" data-id="${esc(p.id)}" aria-current="${isCurrent ? "true" : "false"}" title="${esc(title)}">
          <strong class="wf-item-title" id="wf-item-title-${esc(p.id)}" data-user-content>${esc(title)}</strong>
          <span class="wf-item-meta"><span>${nodes} 个节点 · ${bindings} 项映射</span>${referenced ? '<em class="wf-badge ref">画册在用</em>' : ""}${dup ? '<em class="wf-badge dup">重名</em>' : ""}</span>
        </button>
        ${ibtn("more", "wf-row-menu", "管理此工作流", `data-kind="workflow" data-id="${esc(p.id)}" aria-haspopup="menu"`)}
      </div>`;
    })
    .join("");
}

/* ------------------------------------------------------------------ editor */

function renderSmartMapper() {
  const c = state.settings.comfy,
    issues = mapperBindingIssues(),
    visible = mapperVisibleBindings(c, issues),
    total = c.bindings.length,
    enabled = c.bindings.filter((b) => b.enabled).length,
    flagged = c.bindings.filter((b) => issues.some((i) => i.id === b.id)).length,
    allPicked = visible.length > 0 && visible.every((b) => mapperUI.sel.has(b.id)),
    nodeCount = Object.keys(c.workflow).length,
    filters = [
      ["all", "全部映射", total],
      ["enabled", "已启用", enabled],
      ["issues", "待检查", flagged],
      ["disabled", "已停用", total - enabled],
    ];

  return `<section class="mapping-page wm-workbench wf-editor ${mapperUI.selMode ? "is-selmode" : ""}">
    <header class="wf-editor-head">
      <div class="wf-editor-title">
        <input class="wm-title" aria-label="工作流名称" data-setting="comfy.workflowTitle" value="${esc(c.workflowTitle)}" placeholder="未命名工作流" spellcheck="false" autocomplete="off">
        <p class="wf-editor-meta">
          <span>${nodeCount} 个节点</span>
          <span>${enabled} / ${total} 项映射启用</span>
          ${renderMapperHealthChip(issues)}
        </p>
      </div>
      <div class="wf-editor-tools" role="toolbar" aria-label="工作流操作">
        ${btn("<span>一帧试跑</span>", "play", "v3-mapping-dry", 'title="用当前分镜的第 1 幕试跑一次，验证映射是否正确"', "small primary")}
        ${ibtn("more", "wf-menu", "更多操作", 'id="wf-menu-button" aria-haspopup="menu" aria-expanded="false"')}
      </div>
    </header>

    ${issues.length && mapperUI.healthOpen ? renderMapperHealthList(issues) : ""}

    <div class="wf-toolbar">
      <div class="wf-toolbar-left">
        <label class="wf-filter" title="筛选映射">${icon("filter", "sm")}<select id="wm-filter-select" aria-label="筛选映射">${filters
          .map(([key, label, n]) => opt(key, `${label} (${n})`, mapperUI.filter))
          .join("")}</select></label>
        <label class="wf-search">${icon("search", "sm")}${searchInput({ id: "wm-binding-search", value: mapperUI.search, placeholder: "搜索名称 / 节点 / 字段", label: "搜索映射", controls: "wm-binding-rows" })}</label>
      </div>
      <div class="wf-toolbar-actions">
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
      <section class="wf-table" aria-label="映射列表" aria-description="右键任意一行可编辑与管理">
        <div class="wf-columns" aria-hidden="true">
          <span></span>
          <span>映射 · 写入位置</span>
          <span>取值</span>
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
      ${renderMapperInspector()}
    </div>

    <datalist id="v3-node-ids">${Object.entries(c.workflow)
      .map(([id, n]) => `<option value="${esc(id)}">${esc(n._meta?.title || n.class_type)}</option>`)
      .join("")}</datalist>
    <datalist id="v3-render-parameters">${["width", "height", "steps", "cfg", "denoise", "seed"].map((k) => `<option value="${k}"></option>`).join("")}</datalist>
  </section>`;
}

/* Health lives inline in the meta line: a quiet "通过" chip, or an amber button that unfolds the list. */
function renderMapperHealthChip(issues) {
  const c = state.settings.comfy;
  if (!c.bindings.length && !issues.length) return "";
  if (!issues.length) return `<span class="wf-health-chip is-ok" title="路径、连线、重复与父子覆盖已核对">${icon("check", "xs")} 检查通过</span>`;
  const open = mapperUI.healthOpen;
  return `<button type="button" class="wf-health-chip is-bad" data-act="wm-health-toggle" aria-expanded="${open}">${icon("alert", "xs")} <b>${issues.length}</b> 项待检查 ${icon(open ? "up" : "down", "xs")}</button>`;
}

function renderMapperHealthList(issues) {
  const c = state.settings.comfy;
  return `<div class="wf-health-list" role="list">${issues
    .map((i) => {
      const b = c.bindings.find((x) => x.id === i.id);
      const label = i.kind === "output" ? "结果图片节点" : b?.label || "未命名映射";
      const act = i.kind === "output" ? 'data-act="wm-select-output"' : `data-act="wm-select" data-id="${esc(i.id)}"`;
      return `<button type="button" class="wm-issue" role="listitem" ${act}><strong ${b?.label ? "data-user-content" : ""}>${esc(label)}</strong><em>${esc(i.message)}</em>${icon("arrow", "xs")}</button>`;
    })
    .join("")}</div>`;
}

/* Kept for callers outside this file; the banner is now the chip + list above. */
function renderMapperHealth(issues) {
  return renderMapperHealthChip(issues) + (issues.length && mapperUI.healthOpen ? renderMapperHealthList(issues) : "");
}

/* ------------------------------------------------------------------ rows */

function renderMapperRows() {
  const c = state.settings.comfy,
    issues = mapperBindingIssues(),
    rows = mapperVisibleBindings(c, issues),
    filtered = mapperUI.filter !== "all" || !!mapperUI.search.trim(),
    selected = mapperSelectedBinding();
  if (!c.bindings.length)
    return `<div class="wf-empty">
      <strong>还没有映射</strong>
      <p>映射告诉 Mio 把分镜里的哪一项写到哪个节点。先让系统识别正负提示词节点，或者从节点里挑字段。</p>
      <div class="row">${btn("识别提示词", "spark", "v3-auto-bind", "", "small primary")}${btn("从节点中添加", "plus", "wm-nodes", "", "small")}</div>
    </div>${renderOutputNodeRow(c)}`;
  if (!rows.length)
    return `<div class="wf-empty is-filter">
      <strong>没有匹配的映射</strong>
      <p>换个关键词，或清除筛选查看全部 <b>${c.bindings.length}</b> 项。</p>
      <div class="row">${btn("清除筛选", "close", "wf-clear-filter", "", "small")}</div>
    </div>`;
  return rows.map((b) => renderMapperRow(b, c, issues, selected)).join("") + (filtered ? "" : renderOutputNodeRow(c));
}

function renderMapperRow(b, c, issues, selected) {
  const node = c.workflow[b.nodeId],
    issue = issues.find((i) => i.id === b.id),
    isSel = selected?.id === b.id && mapperUI.selected !== "__output__",
    picked = mapperUI.sel.has(b.id),
    group = SOURCE_GROUP[b.source] || "fixed",
    meta = SOURCE_META[b.source] || SOURCE_META.literal,
    tag = SOURCE_TAG[b.source] || bindingSources[b.source] || b.source;
  let detail = "";
  if (b.source === "literal") {
    const v = String(b.value ?? "").trim();
    detail = v ? `<span class="wm-value" data-user-content title="${esc(b.value)}">${esc(b.value)}</span>` : '<span class="wm-value is-blank">未填写</span>';
  } else if (b.source === "variable") {
    detail = `<span class="wm-value mono" data-user-content>{${esc(b.value || "…")}}</span>`;
  } else if (b.source === "sceneParameter") {
    const key = String(b.value || "").trim();
    detail = `<span class="wm-value mono">${esc(key || "…")}</span><span>${key === "seed" ? "每幕自动写入" : "仅覆盖时写入"}</span>`;
  } else {
    detail = `<span class="wm-value">${esc(meta.when)}</span><span>${esc(meta.scope)}</span>`;
  }
  const glyph = issue
    ? `<span class="wf-row-glyph is-bad" title="${esc(issue.message)}">${icon("alert", "sm")}</span>`
    : b.enabled
      ? `<span class="wf-row-glyph is-on" title="已启用">${icon("check", "sm")}</span>`
      : `<span class="wf-row-glyph is-off" title="已停用">${icon("pause", "sm")}</span>`;
  return `<article class="wm-row wf-row ${isSel ? "selected" : ""} ${b.enabled ? "" : "is-off"} ${picked ? "is-picked" : ""} ${issue ? "has-issue" : ""}" data-binding-row="${esc(b.id)}">
    <span class="wf-row-lead">
      <input type="checkbox" class="sel-cbox" ${picked ? "checked" : ""} data-act="wm-pick" data-id="${esc(b.id)}" aria-labelledby="wf-sr-pick wm-name-${esc(b.id)}">
      ${glyph}
    </span>
    <button type="button" class="wm-row-select wf-row-main" data-act="${mapperUI.selMode ? "wm-pick" : "wm-select"}" data-id="${esc(b.id)}" aria-pressed="${isSel}">
      <span class="wf-row-name" id="wm-name-${esc(b.id)}" ${b.label ? "data-user-content" : ""}>${esc(b.label || "未命名映射")}</span>
      <span class="wf-row-target mono">${b.nodeId ? `<b>#${esc(b.nodeId)}</b><span class="wf-node" data-user-content>${esc(node ? workflowNodeLabel(c.workflow, b.nodeId) : "节点不存在")}</span>` : "<b>未指定节点</b>"}<i>·</i><code>${esc(b.path || "未指定字段")}</code></span>
    </button>
    <span class="wf-row-source">
      <span class="wf-tag tag-${group}">${esc(tag)}</span>
      <span class="wf-row-detail">${detail}</span>
    </span>
    <label class="switch wf-row-switch" title="${b.enabled ? "已启用，点击停用" : "已停用，点击启用"}">
      <input type="checkbox" role="switch" data-v3-binding="enabled" data-id="${esc(b.id)}" ${b.enabled ? "checked" : ""} aria-labelledby="wf-sr-enable wm-name-${esc(b.id)}">
      <span class="switch-track"></span>
    </label>
    ${ibtn("more", "wf-row-menu", "编辑与管理此映射", `data-kind="binding" data-id="${esc(b.id)}" aria-haspopup="menu"`)}
  </article>`;
}

/* The result-image node is not a binding, but it belongs in the same table so every node
   relationship is visible in one place. */
function renderOutputNodeRow(c) {
  const w = c.workflow,
    id = c.outputNodeId,
    missing = id && !Object.hasOwn(w, id),
    auto = !id && Object.keys(w).find((k) => /SaveImage|PreviewImage/.test(w[k]?.class_type || "")),
    isSel = mapperUI.selected === "__output__";
  const glyph = missing
    ? `<span class="wf-row-glyph is-bad" title="节点不存在">${icon("alert", "sm")}</span>`
    : `<span class="wf-row-glyph is-out">${icon("image", "sm")}</span>`;
  const target = id
    ? `<b>#${esc(id)}</b><span class="wf-node" ${missing ? "" : "data-user-content"}>${esc(missing ? "节点不存在" : workflowNodeLabel(w, id))}</span>`
    : auto
      ? `<b>#${esc(auto)}</b><span class="wf-node" data-user-content>${esc(workflowNodeLabel(w, auto))}</span><i>·</i><span>自动探测</span>`
      : `<b>自动探测</b><span>未找到 SaveImage 节点</span>`;
  return `<article class="wf-row wf-row-output ${isSel ? "selected" : ""} ${missing ? "has-issue" : ""}" data-output-row>
    <span class="wf-row-lead">${glyph}</span>
    <button type="button" class="wm-row-select wf-row-main" data-act="wm-select-output" aria-pressed="${isSel}">
      <span class="wf-row-name">结果图片回传节点</span>
      <span class="wf-row-target mono">${target}</span>
    </button>
    <span class="wf-row-source">
      <span class="wf-tag tag-output">输出</span>
      <span class="wf-row-detail"><span>生成完成后取回图片</span></span>
    </span>
    <span class="wf-row-switch" aria-hidden="true"></span>
    ${ibtn("more", "wf-row-menu", "管理结果输出", 'data-kind="output" aria-haspopup="menu"')}
  </article>`;
}

/* ------------------------------------------------------------------ inspector */

function renderMapperInspector() {
  const c = state.settings.comfy;
  if (mapperUI.nodes) return renderNodeBrowser();
  if (mapperUI.selected === "__output__") return `<aside class="wf-inspector wm-inspector" aria-label="映射详情">${renderOutputInspector(c)}</aside>`;
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
  if (binding.source === "random") return "128491028491";
  if (binding.source === "inherit") return original;
  if (!firstFrame) return "（还没有分镜，无法预览）";
  if (binding.source === "positive") return firstFrame.prompt || "（本幕未填正向提示词）";
  if (binding.source === "negative") return firstFrame.negative || "（使用全局负向提示词）";
  if (binding.source === "caption") return firstFrame.caption || "（本幕未填台词）";
  if (binding.source === "sceneName") return firstFrame.name || "第 1 幕";
  if (binding.source === "sceneParameter") return firstFrame[binding.value] !== undefined ? String(firstFrame[binding.value]) : "（保持蓝图原值）";
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

  const nodeOptions = Object.entries(w)
    .sort(([a], [b]) => Number(a) - Number(b) || String(a).localeCompare(String(b)))
    .map(([id, node]) => opt(id, `#${id} · ${node._meta?.title || node.class_type}`, binding.nodeId))
    .join("");
  const nodeSelect = `<select ${attr("nodeId")} aria-label="节点" class="wf-node-select">
      ${opt("", "选择节点…", binding.nodeId)}
      ${binding.nodeId && !n ? `<option value="${esc(binding.nodeId)}" selected>#${esc(binding.nodeId)}（蓝图里没有这个节点）</option>` : ""}
      ${nodeOptions}
    </select>`;
  const fieldControl = typed
    ? input("path", binding.path, "text", attr("path") + ` list="field-${esc(binding.id)}" aria-label="输入字段" placeholder="例如 text、steps 或 /a/b" spellcheck="false" autocomplete="off"`) +
      `<datalist id="field-${esc(binding.id)}">${writable.map((f) => `<option value="${esc(f.path)}">${esc(bindingTypes[f.type] || f.type)}</option>`).join("")}</datalist>`
    : `<select ${attr("path")} aria-label="输入字段" class="wf-field-select">
        ${binding.path ? "" : opt("", "选择输入字段…", "")}
        ${writable.map((f) => `<option value="${esc(f.path)}" ${known && known.path === f.path ? "selected" : ""}>${esc(f.label)} · ${esc(bindingTypes[f.type] || f.type)}${f.optional ? "（可选输入）" : ""}</option>`).join("")}
        ${fields.filter((f) => f.link).length ? `<optgroup label="已连线，不能写入">${fields.filter((f) => f.link).map((f) => `<option value="${esc(f.path)}" ${known && known.path === f.path ? "selected" : ""} disabled>${esc(f.label)} · 已连线（只读）</option>`).join("")}</optgroup>` : ""}
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
  const w = c.workflow,
    candidates = Object.entries(w).filter(([, n]) => /SaveImage|PreviewImage|Save|Preview/.test(n.class_type || "")),
    others = Object.entries(w).filter(([id]) => !candidates.some(([cid]) => cid === id)),
    missing = c.outputNodeId && !Object.hasOwn(w, c.outputNodeId),
    option = ([id, n]) => opt(id, `#${id} · ${n._meta?.title || n.class_type}`, c.outputNodeId);
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
  const workflow = state.settings.comfy.workflow,
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
    Object.entries(workflow)
      .filter(([id, n]) =>
        (id + " " + n.class_type + " " + (n._meta?.title || "") + " " + workflowInputEntries(n, workflow).map((e) => e.path).join(" "))
          .toLowerCase()
          .includes(search)
      )
      .map(([id, n]) => {
        const entries = workflowInputEntries(n, workflow),
          mapped = entries.filter((e) => bindings.some((b) => b.nodeId === id && WorkflowMapping.samePath(b.path, e.path))).length;
        return `<details class="node-group" ${search ? "open" : ""}>
          <summary><b>#${esc(id)}</b><span class="wf-node-title" data-user-content>${esc(n._meta?.title || n.class_type)}</span>${n._meta?.title && n._meta.title !== n.class_type ? `<small>${esc(n.class_type)}</small>` : ""}${mapped ? `<em class="wf-node-mapped" title="已映射字段数">${mapped}</em>` : ""}</summary>
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
  const c = state.settings.comfy,
    b = c.bindings.find((x) => x.id === id);
  if (!b) return [];
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

function openUnifiedWorkflowImportModal(mode = "new") {
  const currentTitle = state.settings.comfy.workflowTitle || "当前工作流";
  modal(
    "添加工作流",
    `<div class="wf-import-sheet">
      <p class="help" style="margin-top:0">支持 ComfyUI API 格式 JSON 与 Mio 映射包，可多选或拖入。</p>
      <div class="drop" id="wf-unified-dropzone" role="button" tabindex="0" aria-label="选择或拖入工作流文件">
        ${icon("upload")}
        <b>点击选择文件，或将 .json 拖到此处</b>
        <span>支持多文件批量添加 · 单文件 ≤ 10 MB</span>
      </div>
      <input type="file" id="wf-unified-file-input" accept=".json,application/json" multiple style="display:none">
      <div id="wf-import-filelist" class="filelist" style="display:none"></div>
      <div class="radios">
        <label>
          <input type="radio" name="wf-import-mode" value="new" ${mode === "replace" ? "" : "checked"}>
          <div><b>新建工作流</b><small>作为独立条目加入工作流库，当前编辑的工作流完全不受影响。</small></div>
        </label>
        <label>
          <input type="radio" name="wf-import-mode" value="replace" ${mode === "replace" ? "checked" : ""}>
          <div><b>替换「${esc(currentTitle)}」的蓝图</b><small>保留现有名称与映射，只更换底层节点图。指向已不存在节点 ID 的映射会进入“待检查”。</small><span class="risk">替换前会自动把当前映射包下载一份备份，方便回滚。</span></div>
        </label>
      </div>
      <div class="modal-footer" style="margin-top:20px">
        ${btn("取消", "", "close-modal")}
        ${btn("确认导入", "check", "ws-do-unified-import", 'id="wf-unified-submit-btn" aria-disabled="true"', "primary disabled")}
      </div>
    </div>`,
    "统一工作流资产导入"
  );

  let selectedFiles = [];
  const dropzone = $("#wf-unified-dropzone"),
    fileInput = $("#wf-unified-file-input"),
    submitBtn = $("#wf-unified-submit-btn"),
    fileListEl = $("#wf-import-filelist");

  function handleFiles(files) {
    if (!files || !files.length) return;
    selectedFiles = [...files];
    fileListEl.style.display = "block";
    fileListEl.innerHTML = selectedFiles
      .map(
        (f, i) => `<div class="filerow"><span class="mono muted">${i + 1}</span><span class="nm">${esc(f.name)}</span><span class="kind mono muted">${(f.size / 1024).toFixed(1)} KB</span><span class="res">准备就绪</span></div>`
      )
      .join("");
    submitBtn.classList.remove("disabled");
    submitBtn.removeAttribute("aria-disabled");
    submitBtn.innerHTML = icon("check") + esc(localeString("导入 {n} 份", { n: selectedFiles.length }));
  }

  dropzone.onclick = () => fileInput.click();
  dropzone.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
  fileInput.onchange = () => handleFiles(fileInput.files);
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("is-over"); };
  dropzone.ondragleave = () => dropzone.classList.remove("is-over");
  dropzone.ondrop = (e) => { e.preventDefault(); dropzone.classList.remove("is-over"); handleFiles(e.dataTransfer.files); };
  window._pendingImportFiles = () => selectedFiles;
}

/* ------------------------------------------------------------------ install */

/* ------------------------------------------------------------------ rail drawer */

function applyRailState() {
  const body = document.querySelector(".wf-body");
  if (!body) return;
  body.classList.toggle("rail-pinned", mapperUI.railPinned);
  body.classList.toggle("rail-floating", !mapperUI.railPinned);
  body.classList.toggle("rail-open", mapperUI.railOpen && !mapperUI.railPinned);
  body.querySelector(".wf-rail-handle")?.setAttribute("aria-expanded", String(mapperUI.railOpen || mapperUI.railPinned));
}

function setRailOpen(open) {
  clearTimeout(mapperUI.railTimer);
  if (mapperUI.railPinned || mapperUI.railOpen === open) return;
  mapperUI.railOpen = open;
  applyRailState();
}

function scheduleRailClose(delay = 320) {
  clearTimeout(mapperUI.railTimer);
  mapperUI.railTimer = setTimeout(() => {
    const dock = document.getElementById("wf-rail-dock");
    if (dock && (dock.matches(":hover") || dock.contains(document.activeElement) || document.getElementById("wf-menu"))) return scheduleRailClose(delay);
    setRailOpen(false);
  }, delay);
}

/* ------------------------------------------------------------------ install */

function installWorkflowWorkbench() {
  if (typeof MioIcons !== "undefined") MioIcons.mount("core:workflow", WORKFLOW_ICONS);
  const previous = handleAction;
  handleAction = async function (action, d = {}, el) {
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
          <li><strong>工作流库</strong>在左侧边缘：鼠标靠近即可展开，点图钉可以固定显示。</li>
          <li>每条<strong>映射</strong>分三步设置：① 写到哪里（节点与输入字段）② 填什么（取值来源）③ 效果预览。</li>
          <li><strong>右键</strong>任意映射或工作流，可以启用 / 停用、重命名、复制、导出或删除；行尾的 ⋯ 按钮是同一份菜单。</li>
          <li>映射与原始蓝图分开保存，节点连线受保护，改动自动保存且不影响已入队的任务。</li>
        </ul>` : ""}</div><div class="modal-footer">${btn("知道了", "check", "close-modal", "", "primary")}</div>`
      );
      return;
    }
    if (action === "wf-connection-toggle") {
      mapperUI.connectionOpen = !mapperUI.connectionOpen;
      const box = document.querySelector("[data-wm-connection]"),
        body = document.getElementById("wf-connection-body");
      if (box) box.toggleAttribute("open", mapperUI.connectionOpen);
      if (body) body.hidden = !mapperUI.connectionOpen;
      el?.setAttribute("aria-expanded", String(mapperUI.connectionOpen));
      return;
    }
    if (action === "wf-rail-toggle") {
      if (mapperUI.railPinned) return;
      mapperUI.railOpen = !mapperUI.railOpen;
      applyRailState();
      if (mapperUI.railOpen) document.querySelector("#wf-rail .wf-item.active .wf-item-body, #wf-rail .wf-item-body")?.focus();
      return;
    }
    if (action === "wf-rail-pin") {
      mapperUI.railPinned = !mapperUI.railPinned;
      // Unpinning keeps the drawer out until the pointer leaves it, so the click is not jarring.
      mapperUI.railOpen = !mapperUI.railPinned;
      setWorkbenchPref("railPinned", mapperUI.railPinned);
      render();
      if (!mapperUI.railPinned) scheduleRailClose(900);
      toast(mapperUI.railPinned ? "工作流库已固定显示" : "工作流库已收起，鼠标离开后自动隐藏，靠近左侧边缘即可再次展开");
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
    if (action === "wm-select") {
      mapperUI.selected = d.id;
      mapperUI.nodes = false;
      render();
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

  /* Filter lives in a select now. */
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el?.id === "wm-filter-select") {
      mapperUI.filter = el.value;
      render();
    }
  });

  /* Rail drawer: open when the pointer nears the left edge, close a moment after it leaves.
     Keyboard users get the same via the handle button and focus. */
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const dock = e.target.closest?.("#wf-rail-dock");
    if (dock) setRailOpen(true);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    const dock = e.target.closest?.("#wf-rail-dock");
    if (dock && !(e.relatedTarget && dock.contains(e.relatedTarget))) scheduleRailClose();
  });
  document.addEventListener("focusin", (e) => {
    if (e.target.closest?.("#wf-rail-dock")) setRailOpen(true);
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
    if (!items) return;
    e.preventDefault();
    openWorkbenchMenu(items, { x: e.clientX, y: e.clientY, label });
  });

  /* Light-DOM echoes that do not deserve a full render. */
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el || !el.matches) return;
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
      if (e.key === "Escape" && mapperUI.railOpen && !mapperUI.railPinned && document.activeElement?.closest?.("#wf-rail-dock")) { setRailOpen(false); document.querySelector(".wf-rail-handle")?.focus(); }
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
