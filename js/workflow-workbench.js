"use strict";

/*
 * Workflow workbench — workspace 3 ("工作流与 API 配置").
 *
 * One flat page, three columns, no nested cards:
 *   heading  → page title, subtitle, primary "添加工作流"
 *   engine   → folded connection bar (status + test) that expands into the provider panel
 *   body     → library rail | mapping table | inspector (binding / output / node picker)
 *
 * All rendering is string templates patched through patchMain(); the small amount of
 * imperative behaviour (the ⋯ menu, live title / value echoes, rail search) lives in
 * installWorkflowWorkbench() which wraps handleAction like the other feature modules.
 */

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
};

/* What a binding source means, in the words the inspector uses. `what` is a noun phrase so it
   can be dropped into "把 <what> 写入 <target>". */
const SOURCE_META = {
  positive: { what: "这一幕的正向提示词", when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊里每幕的正向提示词，变量已展开" },
  negative: { what: "这一幕的负向提示词", when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊的负向提示词；留空时使用全局负向" },
  caption: { what: "这一幕的台词 / 旁白", when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊的台词输入框" },
  sceneName: { what: "分幕名称", when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊当前分幕的名称" },
  sceneParameter: { what: "分镜画面参数", when: "仅覆盖时", scope: "逐幕不同", who: "分镜画面参数；未开启覆盖的分幕保持原值" },
  variable: { what: "预设变量", when: "装配时", scope: "随预设", who: "视觉预设工坊里定义的变量" },
  bookTitle: { what: "画册标题", when: "任务开始时", scope: "整本一致", who: "装配时填写的画册名称" },
  image: { what: "角色立绘或参考图", when: "装配时", scope: "随角色", who: "角色资产中的参考图像" },
  literal: { what: "这里填写的固定值 / 模板", when: "始终写入", scope: "始终生效", who: "在右侧直接填写" },
  random: { what: "新生成的随机种子", when: "每次生成前", scope: "每次不同", who: "按时间戳自动计算" },
  inherit: { what: "蓝图原值", when: "不写入", scope: "不修改", who: "ComfyUI 原始蓝图" },
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

function renderWorkflowLibrary() {
  const profile = activeImageProfile();
  const comfy = profile.provider === "comfyui";
  const heading = `<header class="wf-heading">
    <div class="wf-heading-text">
      <span class="context-kicker">图像生产 · IMAGE PIPELINE</span>
      <h1>工作流与 API 配置</h1>
      <p>${comfy ? "把分镜里的提示词、参数与素材接到 ComfyUI 节点上。映射与原始蓝图分开保存，改动不会影响已入队的任务。" : "当前使用云端图像渠道，不需要 ComfyUI 工作流。填好地址、模型与密钥，就可以去编写分镜。"}</p>
    </div>
    ${comfy ? `<div class="wf-heading-actions">${btn("添加工作流", "plus", "ws-open-unified-import", 'aria-label="添加工作流（导入 API 工作流或映射包）"', "primary")}</div>` : ""}
  </header>`;

  if (!comfy) {
    return `<section class="wf-page wf-page-cloud">${heading}<div class="wf-provider">${imageProviderPanel()}</div></section>`;
  }

  const status = workflowConnectionStatus(),
    c = state.settings.comfy;
  return `<section class="wf-page">
    ${heading}
    <details class="wf-connection wm-connection tone-${status.tone}" data-wm-connection ${mapperUI.connectionOpen ? "open" : ""}>
      <summary title="${esc(status.full || status.detail || "")}">
        <i class="wf-dot" aria-hidden="true"></i>
        <strong>ComfyUI</strong>
        <span class="wf-connection-url mono">${esc(c.baseUrl || "未填写地址")}</span>
        <span class="wf-connection-state"><b>${esc(status.label)}</b>${status.detail ? `<span class="wf-connection-detail">${esc(status.detail)}</span>` : ""}</span>
        <span class="spacer"></span>
        ${c.mode === "mock" ? "" : btn(firstRunUI.checking ? "检查中…" : "测试连接", "refresh", "first-run-check-comfy", firstRunUI.checking ? "disabled" : "", "small ghost")}
        <span class="wf-connection-more">连接设置 ${icon("down", "sm")}</span>
      </summary>
      <div class="wf-connection-body">${imageProviderPanel()}</div>
    </details>
    <div class="workflow-library wf-body">
      ${renderWorkflowRail(c)}
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
    searchable = presets.length >= 6 || !!mapperUI.libSearch;
  return `<aside class="wf-rail ${mapperUI.libSelMode ? "is-selmode" : ""}" aria-label="工作流库">
    <div class="wf-rail-head">
      <span class="context-kicker">工作流库</span>
      <span class="wf-count mono">${presets.length}</span>
      <span class="spacer"></span>
      ${presets.length > 1 ? btn(mapperUI.libSelMode ? "完成" : "选择", "", "ws-lib-sel-toggle", "", "small ghost") : ""}
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
      ${btn("复制当前", "copy", "ws-copy", "", "small ghost")}
      ${btn("导出全部", "download", "ws-export-all", "", "small ghost")}
    </div>
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
      ["all", "全部", total],
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
          <span class="wf-safe">${icon("shield", "xs")} 保护节点连线</span>
          <span>自动保存</span>
        </p>
      </div>
      <div class="wf-editor-tools" role="toolbar" aria-label="工作流操作">
        ${btn("<span>编辑蓝图</span>", "edit", "edit-workflow", 'title="编辑蓝图"', "small")}
        ${btn("<span>预览提交 JSON</span>", "eye", "v3-preview-workflow", 'title="预览提交 JSON"', "small")}
        ${btn("<span>一帧试跑</span>", "play", "v3-mapping-dry", 'title="一帧试跑"', "small primary")}
        ${ibtn("more", "wf-menu", "更多操作", 'id="wf-menu-button" aria-haspopup="menu" aria-expanded="false"')}
      </div>
    </header>

    ${renderMapperHealth(issues)}

    <div class="wf-toolbar">
      <nav class="wf-filters" aria-label="筛选映射">
        ${filters
          .map(
            ([key, label, n]) =>
              `<button type="button" data-act="wm-filter" data-filter="${key}" class="${mapperUI.filter === key ? "active" : ""}" aria-pressed="${mapperUI.filter === key}" ${key === "issues" && n ? 'data-tone="bad"' : ""}>${label}<b>${n}</b></button>`
          )
          .join("")}
      </nav>
      <div class="wf-toolbar-actions">
        <label class="wf-search">${icon("search", "sm")}${searchInput({ id: "wm-binding-search", value: mapperUI.search, placeholder: "搜索名称 / 节点 / 字段", label: "搜索映射", controls: "wm-binding-rows" })}</label>
        ${btn("识别提示词", "spark", "v3-auto-bind", 'title="自动找到正负提示词节点并建立映射"', "small ghost")}
        ${total ? btn(mapperUI.selMode ? "完成" : "批量管理", "", "wm-sel-toggle", "", mapperUI.selMode ? "small active" : "small ghost") : ""}
        ${btn("添加映射", "plus", "wm-nodes", 'aria-expanded="' + mapperUI.nodes + '"', mapperUI.nodes ? "small active" : "small primary")}
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
      <section class="wf-table" aria-label="映射列表">
        <div class="wf-columns" aria-hidden="true">
          <span></span>
          <span>映射 · 写入位置</span>
          <span>取值</span>
          <span>启用</span>
        </div>
        <span id="wf-sr-enable" hidden>启用映射</span>
        <div id="wm-binding-rows" class="wf-rows">${renderMapperRows()}</div>
        <button type="button" class="wf-add-row" data-act="wm-nodes">${icon("plus", "sm")} 从节点中添加输入字段</button>
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

function renderMapperHealth(issues) {
  const c = state.settings.comfy;
  if (!c.bindings.length && !issues.length) return "";
  if (!issues.length)
    return `<div class="wf-health is-ok">${icon("check", "sm")}<strong>配置检查全部通过</strong><span>路径、连线、重复与父子覆盖已核对</span></div>`;
  const open = mapperUI.healthOpen;
  return `<button type="button" class="wf-health is-bad" data-act="wm-health-toggle" aria-expanded="${open}">
      ${icon("alert", "sm")}<strong>发现 <b>${issues.length}</b> 项待检查</strong><span>${open ? "收起" : "查看受影响的映射与原因"}</span>${icon(open ? "up" : "down", "sm")}
    </button>
    ${open ? `<div class="wf-health-list" role="list">${issues
      .map((i) => {
        const b = c.bindings.find((x) => x.id === i.id);
        const label = i.kind === "output" ? "结果图片节点" : b?.label || "未命名映射";
        const act = i.kind === "output" ? 'data-act="wm-select-output"' : `data-act="wm-select" data-id="${esc(i.id)}"`;
        return `<button type="button" class="wm-issue" role="listitem" ${act}><strong ${b?.label ? "data-user-content" : ""}>${esc(label)}</strong><em>${esc(i.message)}</em>${icon("arrow", "xs")}</button>`;
      })
      .join("")}</div>` : ""}`;
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
  return `<article class="wf-row wf-row-output ${isSel ? "selected" : ""} ${missing ? "has-issue" : ""}">
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
        <p>从左侧添加映射后，在这里设置写入位置与取值来源。</p>
      </div>
    </aside>`;
  return `<aside class="wf-inspector wm-inspector" aria-label="映射详情">${renderMappingRule(b, c.bindings.indexOf(b), c.bindings.length)}</aside>`;
}

function renderMappingRule(binding, index, total = state.settings.comfy.bindings.length) {
  const w = state.settings.comfy.workflow,
    n = w[binding.nodeId],
    valid = bindingRowValidity(binding),
    fieldId = "field-" + binding.id,
    fields = n ? workflowInputEntries(n, w) : [],
    attr = (k) => `data-v3-binding="${k}" data-id="${esc(binding.id)}"`,
    meta = SOURCE_META[binding.source] || SOURCE_META.literal,
    nodeTitle = n ? n._meta?.title || n.class_type : "",
    original = valid.original === undefined ? "字段尚不存在" : JSON.stringify(valid.original, null, 2),
    target = `<code>#${esc(binding.nodeId || "?")} · ${esc(binding.path || "?")}</code>`;

  const story = projectTemplates()[0],
    firstFrame = story?.frames?.[0];
  let previewValue = "";
  if (binding.source === "literal") previewValue = String(binding.value ?? "");
  else if (binding.source === "variable") previewValue = `{${binding.value}}`;
  else if (binding.source === "random") previewValue = "128491028491";
  else if (binding.source === "inherit") previewValue = original;
  else if (firstFrame) {
    if (binding.source === "positive") previewValue = firstFrame.prompt || "（本幕未填正向提示词）";
    else if (binding.source === "negative") previewValue = firstFrame.negative || "（使用全局负向提示词）";
    else if (binding.source === "caption") previewValue = firstFrame.caption || "（本幕未填台词）";
    else if (binding.source === "sceneName") previewValue = firstFrame.name || "第 1 幕";
    else if (binding.source === "sceneParameter") previewValue = firstFrame[binding.value] !== undefined ? String(firstFrame[binding.value]) : "（保持蓝图原值）";
    else if (binding.source === "bookTitle") previewValue = state.creation.plans[0]?.title || "（装配时填写）";
    else previewValue = meta.what;
  } else previewValue = "（还没有分镜，无法预览）";

  let what = `<em>${esc(meta.what)}</em>`;
  if (binding.source === "variable") what = `<em>${esc(meta.what)} <code>{${esc(binding.value || "…")}}</code></em>`;
  if (binding.source === "sceneParameter") what = `<em>${esc(meta.what)} <code>${esc(binding.value || "…")}</code></em>`;
  const contract =
    binding.source === "inherit"
      ? `${target} <span>保持蓝图原值，不写入</span>`
      : `<span>把</span> ${what} <span>写入</span> ${target}${nodeTitle ? ` <small>${esc(nodeTitle)}</small>` : ""}`;

  return `<article class="mapping-rule wf-detail">
    <header class="wf-detail-head">
      <span class="context-kicker">映射详情</span>
      <span class="wf-detail-index mono">${pad(index + 1)} / ${pad(total)}</span>
      <span class="spacer"></span>
      ${ibtn("copy", "v3-copy-binding", "复制此映射", `data-id="${esc(binding.id)}"`)}
      ${ibtn("trash", "v3-remove-binding", "删除此映射", `data-id="${esc(binding.id)}"`)}
    </header>
    <input class="wf-detail-title" name="label" type="text" value="${esc(binding.label)}" ${attr("label")} aria-label="映射名称" placeholder="映射名称" spellcheck="false" autocomplete="off">

    <p class="wf-contract ${binding.enabled ? "" : "is-inert"}">${contract}</p>
    <dl class="wf-facts">
      <div><dt>生效时机</dt><dd>${esc(meta.when)}</dd></div>
      <div><dt>作用范围</dt><dd>${esc(meta.scope)}</dd></div>
      <div><dt>来源</dt><dd>${esc(meta.who)}</dd></div>
    </dl>

    <h4 class="wf-section"><span>写入位置</span><small>ComfyUI 节点与字段</small></h4>
    <div class="wf-grid2">
      ${field("节点 ID", input("nodeId", binding.nodeId, "text", attr("nodeId") + ' list="v3-node-ids" aria-label="节点 ID" placeholder="选择或输入" spellcheck="false" autocomplete="off"'), nodeTitle ? esc(nodeTitle) : binding.nodeId ? "蓝图中没有这个节点" : "")}
      ${field("字段 / JSON Pointer", input("path", binding.path, "text", attr("path") + ` list="${fieldId}" aria-label="目标字段" placeholder="text 或 strength_model" spellcheck="false" autocomplete="off"`))}
    </div>
    <datalist id="${fieldId}">${fields.filter((f) => !f.link).map((f) => `<option value="${esc(f.path)}">${esc(f.type)}</option>`).join("")}</datalist>

    <h4 class="wf-section"><span>取值来源</span></h4>
    ${field(
      "来源",
      `<select ${attr("source")} aria-label="映射值来源">
        <optgroup label="来自分镜">
          ${opt("positive", "本幕正向提示词", binding.source)}
          ${opt("negative", "本幕负向提示词", binding.source)}
          ${opt("caption", "本幕台词 / 旁白", binding.source)}
          ${opt("sceneName", "分幕名称", binding.source)}
          ${opt("sceneParameter", "分镜画面参数（宽高 / 步数 / CFG / 种子）", binding.source)}
        </optgroup>
        <optgroup label="来自装配与预设">
          ${opt("variable", "视觉预设变量 {变量名}", binding.source)}
          ${opt("bookTitle", "画册标题", binding.source)}
          ${opt("image", "角色正面立绘或参考图", binding.source)}
        </optgroup>
        <optgroup label="固定值与算法">
          ${opt("literal", "固定值 / 模板文本", binding.source)}
          ${opt("random", "自动随机种子", binding.source)}
          ${opt("inherit", "保持蓝图原值（不写入）", binding.source)}
        </optgroup>
      </select>`
    )}
    ${["literal", "variable", "sceneParameter"].includes(binding.source)
      ? field(
          binding.source === "variable" ? "变量名" : binding.source === "sceneParameter" ? "分镜参数名" : "固定值 / 模板文本",
          binding.source === "literal"
            ? `<textarea ${attr("value")} aria-label="映射值" spellcheck="false" placeholder="固定值，或含 {变量名} 的模板">${esc(binding.value)}</textarea>`
            : input("value", binding.value, "text", attr("value") + ` aria-label="映射值" spellcheck="false" autocomplete="off" ${binding.source === "sceneParameter" ? 'list="v3-render-parameters"' : ""} placeholder="${binding.source === "variable" ? "例如 lora_strength" : "例如 width / steps / seed"}"`)
        )
      : ""}
    ${field("数据类型", `<select ${attr("type")} aria-label="映射数据类型">${Object.entries(bindingTypes).map((x) => opt(...x, binding.type)).join("")}</select>`)}

    <div class="wf-preview" aria-label="取值预览">
      <div class="wf-preview-head"><span>取值预览</span><span class="mono">${binding.source === "literal" || binding.source === "variable" || binding.source === "random" || binding.source === "inherit" ? "" : firstFrame ? "按第 1 幕" : "无分镜"}</span></div>
      <div class="wf-preview-row is-old"><i>蓝图原值</i><pre>${esc(original)}</pre></div>
      <div class="wf-preview-row is-new"><i>本次写入</i><pre data-wf-preview-new>${esc(previewValue || "（空）")}</pre></div>
    </div>
    <p class="wf-validity ${valid.ok ? "is-ok" : "is-bad"}">${icon(valid.ok ? "check" : "alert", "sm")}<span>${esc(valid.text)}</span></p>
    ${binding.warning ? `<p class="wf-warning">${icon("alert", "sm")}<span>${esc(binding.warning)}</span></p>` : ""}

    <details class="advanced-details wf-advanced">
      <summary>高级选项</summary>
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
    <p class="wf-contract"><span>结果图片来自</span> <code>${c.outputNodeId ? "#" + esc(c.outputNodeId) : "自动探测的节点"}</code>${c.outputNodeId ? ` <small>${esc(workflowNodeLabel(w, c.outputNodeId) || "节点不存在")}</small>` : ""}</p>
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

/* ------------------------------------------------------------------ ⋯ menu */

function workflowMenuItems() {
  const c = state.settings.comfy,
    presets = c.presets || [],
    only = presets.length <= 1,
    referenced = workflowReferenced(c.activeWorkflowId);
  return [
    { act: "edit-workflow", icon: "edit", label: "编辑蓝图 JSON", hint: "直接修改 ComfyUI API 蓝图" },
    { act: "ws-open-unified-import", extra: 'data-mode="replace"', icon: "upload", label: "替换蓝图…", hint: "保留名称与映射，只更换节点图" },
    { act: "v3-read-object-info", icon: "refresh", label: "同步节点定义", hint: "从 ComfyUI 读取字段与类型" },
    { act: "v3-add-render-mappings", icon: "sliders", label: "添加分镜参数映射", hint: "宽高 / 步数 / CFG / 种子" },
    "sep",
    { act: "v3-import-mapping", icon: "upload", label: "导入映射包" },
    { act: "v3-export-mapping", icon: "download", label: "导出映射包" },
    "sep",
    { act: "ws-copy", icon: "copy", label: "复制副本" },
    { act: "ws-delete", icon: "trash", label: "删除工作流", danger: true, disabled: only || referenced, hint: only ? "至少保留一份工作流" : referenced ? "有画册正在引用，无法删除" : "" },
  ];
}

function closeWorkflowMenu() {
  const menu = document.getElementById("wf-menu");
  if (!menu) return;
  menu.remove();
  document.getElementById("wf-menu-button")?.setAttribute("aria-expanded", "false");
}

function openWorkflowMenu(anchor) {
  closeWorkflowMenu();
  const menu = document.createElement("div");
  menu.id = "wf-menu";
  menu.className = "wf-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "更多操作");
  menu.innerHTML = workflowMenuItems()
    .map((item) =>
      item === "sep"
        ? '<hr class="wf-menu-sep">'
        : `<button type="button" role="menuitem" class="${item.danger ? "is-danger" : ""}" data-act="${item.act}" ${item.extra || ""} ${item.disabled ? "disabled" : ""}>${icon(item.icon, "sm")}<span><strong>${item.label}</strong>${item.hint ? `<small>${item.hint}</small>` : ""}</span></button>`
    )
    .join("");
  document.body.append(menu);
  const r = anchor.getBoundingClientRect(),
    width = menu.offsetWidth,
    height = menu.offsetHeight;
  let left = r.right - width,
    top = r.bottom + 6;
  if (left < 8) left = 8;
  if (top + height > innerHeight - 8) top = Math.max(8, r.top - height - 6);
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  anchor.setAttribute("aria-expanded", "true");
  menu.querySelector('[role="menuitem"]:not([disabled])')?.focus();
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

function installWorkflowWorkbench() {
  if (typeof MioIcons !== "undefined") MioIcons.mount("core:workflow", WORKFLOW_ICONS);
  const previous = handleAction;
  handleAction = async function (action, d = {}, el) {
    if (action === "wf-menu") {
      if (document.getElementById("wf-menu")) closeWorkflowMenu();
      else openWorkflowMenu(el);
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
    if (action === "ws-open-unified-import") {
      openUnifiedWorkflowImportModal(d.mode || "new");
      return;
    }
    if (action === "first-run-provider" || action === "image-provider-settings" || action === "first-run-config") mapperUI.connectionOpen = true;
    return previous(action, d, el);
  };

  /* The connection bar remembers its fold across re-renders. */
  document.addEventListener("toggle", (e) => { if (e.target.matches?.("[data-wm-connection]")) mapperUI.connectionOpen = e.target.open; }, true);

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
    if (e.target.closest("#wf-menu-button")) return;
    closeWorkflowMenu();
  });
  document.addEventListener("keydown", (e) => {
    const menu = document.getElementById("wf-menu");
    if (!menu) return;
    const items = [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeWorkflowMenu(); document.getElementById("wf-menu-button")?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Tab") closeWorkflowMenu();
  });
  addEventListener("resize", closeWorkflowMenu);
  addEventListener("scroll", closeWorkflowMenu, true);
}
