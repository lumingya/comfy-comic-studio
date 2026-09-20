/* Workflow editor: presentation, filtering, readable contract and unified bulk management. */
"use strict";

// Ephemeral selection/filter state; workflow data continues to use the v1 contract.
const mapperUI = {
  selected: "",
  search: "",
  filter: "all",          // all | enabled | issues | disabled
  tab: "bindings",        // Keep compatibility
  nodes: false,
  selMode: false,
  sel: new Set(),         // 映射多选
  libSelMode: false,
  libSel: new Set(),      // 工作流库多选
  libSearch: "",
  healthOpen: false,
  previewFrame: 0,
};

/* SOURCE_META —— 结构即说明，自然语言契约元数据 */
const SOURCE_META = {
  positive: {
    verb: "取这一幕的正向提示词",
    when: "每一幕生成前",
    scope: "逐幕不同",
    who: "分镜工坊逐幕正向提示词（变量已展开）",
  },
  negative: {
    verb: "取这一幕的负向提示词（留空则用全局负向）",
    when: "每一幕生成前",
    scope: "逐幕不同",
    who: "分镜工坊负向提示词或全局负向",
  },
  caption: {
    verb: "取这一幕的台词 / 旁白",
    when: "每一幕生成前",
    scope: "逐幕不同",
    who: "分镜工坊台词输入框",
  },
  bookTitle: {
    verb: "取画册标题",
    when: "任务开始时",
    scope: "整本一致",
    who: "装配时填写的画册名称",
  },
  sceneName: {
    verb: "取分幕名称",
    when: "每一幕生成前",
    scope: "逐幕不同",
    who: "分镜工坊当前分幕名称",
  },
  random: {
    verb: "自动生成随机种子",
    when: "每次生成前",
    scope: "每次不同",
    who: "根据当前时间戳自动计算",
  },
  image: {
    verb: "取角色立绘或参考图",
    when: "装配时",
    scope: "随角色",
    who: "角色资产中的参考图像",
  },
  literal: {
    verb: "写入固定值或模板",
    when: "固定",
    scope: "始终生效",
    who: "在此处直接填写的固定值",
  },
  variable: {
    verb: "读取视觉预设变量",
    when: "装配时",
    scope: "随预设",
    who: "预设工坊中的变量",
  },
  sceneParameter: {
    verb: "取分镜画面参数",
    when: "仅覆盖时",
    scope: "逐幕不同",
    who: "分镜画面参数（未开启覆盖时保持原值）",
  },
  inherit: {
    verb: "保持蓝图原值",
    when: "不写入",
    scope: "不修改",
    who: "ComfyUI 原始蓝图设定",
  },
};

function mapperSelectedBinding() {
  const c = state.settings.comfy;
  return c.bindings.find((b) => b.id === mapperUI.selected) || c.bindings[0];
}

function mapperBindingIssues() {
  const c = state.settings.comfy,
    issues = validateMappingTargets(c.workflow, c.bindings);
  if (c.outputNodeId && !Object.hasOwn(c.workflow, c.outputNodeId))
    issues.push({
      id: "",
      kind: "output",
      message: "指定的结果图片节点 #" + c.outputNodeId + " 不存在。",
    });
  return issues;
}

function mapperSourceLabel(b) {
  if (b.source === "variable") return "{" + b.value + "}";
  if (b.source === "literal") return String(b.value ?? "未填写");
  if (b.source === "sceneParameter") {
    return b.value + (String(b.value || "").trim() === "seed" ? " · 每幕自动写入" : " · 仅覆盖时写入");
  }
  const meta = SOURCE_META[b.source];
  return meta ? meta.verb : (bindingSources[b.source] || b.source);
}

function mapperTimingLabel(b) {
  const meta = SOURCE_META[b.source];
  if (meta) return meta.when;
  return "生成时";
}

/* 结果图片节点行（原蓝图设置中的结果输出，降级为映射表的特殊行，打通所有节点关系） */
function renderOutputNodeRow(c) {
  const workflow = c.workflow || {};
  const imageNodes = Object.entries(workflow).filter(([, n]) =>
    /SaveImage|PreviewImage/i.test(n.class_type)
  );
  const currentOutput = c.outputNodeId;
  const isSelected = mapperUI.selected === "__output__";

  return `<article class="wm-row wm-row-output ${isSelected ? "selected" : ""}">
    <div class="wm-row-lead">
      <span class="wm-source-tag output">输出</span>
    </div>
    <div class="wm-row-select" style="cursor:default">
      <span class="wm-row-main">
        <strong>结果图片回传节点</strong>
        <span class="wm-target">
          <select id="v3-output-node-select" aria-label="结果图片节点" style="height:24px;font-size:11px;padding:1px 6px">
            <option value="">自动寻找 SaveImage 节点</option>
            ${imageNodes.map(([id, n]) => opt(id, `#${id} · ${n._meta?.title || n.class_type}`, currentOutput)).join("")}
          </select>
        </span>
      </span>
      <span class="wm-row-source">
        <span class="wm-value muted">从该节点接收最终渲染图片</span>
      </span>
      <span class="wm-when">每一幕</span>
      <span class="wm-row-state">${icon(currentOutput && !workflow[currentOutput] ? "help" : "check", "sm")}</span>
    </div>
  </article>`;
}

function renderMapperRows() {
  const c = state.settings.comfy,
    issues = mapperBindingIssues(),
    selected = mapperSelectedBinding(),
    query = mapperUI.search.trim().toLowerCase();

  const rows = c.bindings.filter((b) => {
    if (mapperUI.filter === "enabled" && !b.enabled) return false;
    if (mapperUI.filter === "disabled" && b.enabled) return false;
    if (mapperUI.filter === "issues" && !issues.some((i) => i.id === b.id)) return false;
    if (!query) return true;
    return [b.label, b.nodeId, b.path, b.value, c.workflow[b.nodeId]?.class_type]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  return (
    rows
      .map((b) => {
        const bad = issues.find((i) => i.id === b.id);
        const isPicked = mapperUI.sel.has(b.id);
        const isSelected = selected?.id === b.id && !mapperUI.selMode;
        const timing = mapperTimingLabel(b);

        return `<article class="wm-row ${isSelected ? "selected" : ""} ${!b.enabled ? "is-off" : ""} ${isPicked ? "is-picked" : ""}">
          <div class="wm-row-lead">
            <input type="checkbox" class="sel-cbox" ${isPicked ? "checked" : ""} data-act="wm-pick" data-id="${esc(b.id)}" aria-label="选择 ${esc(b.label)}">
            <span class="sel-glyph ${bad ? "has-error" : ""}" title="${esc(bad?.message || (!b.enabled ? "已停用" : "目标有效"))}">
              ${icon(bad ? "alert" : !b.enabled ? "pause" : "check", "sm")}
            </span>
          </div>
          <div role="button" tabindex="0" class="wm-row-select" data-act="${mapperUI.selMode ? "wm-pick" : "wm-select"}" data-id="${esc(b.id)}" aria-pressed="${isSelected}">
            <span class="wm-row-main">
              <strong>${esc(b.label)}</strong>
              <span class="wm-target"><b>#${esc(b.nodeId || "?")}</b><code>${esc(b.path || "未选择字段")}</code></span>
            </span>
            <span class="wm-row-source">
              <span class="wm-source-tag ${b.source}">${esc(bindingSources[b.source] || b.source)}</span>
              <span class="wm-value">${esc(mapperSourceLabel(b))}</span>
            </span>
            <span class="wm-when">${esc(timing)}</span>
            <span class="wm-row-state" style="justify-content:center" onclick="event.stopPropagation()">
              <input type="checkbox" data-v3-binding="enabled" data-id="${esc(b.id)}" ${b.enabled ? "checked" : ""} aria-label="启用 ${esc(b.label)}" style="margin:0">
            </span>
          </div>
        </article>`;
      })
      .join("") +
    (query && !rows.length ? `<div class="wm-empty">${icon("nodes")}<h3>没有匹配的映射</h3><p>试试其他关键词，或从节点中添加新的输入字段。</p>${btn("浏览节点字段", "plus", "wm-nodes", "", "small")}</div>` : "") +
    renderOutputNodeRow(c)
  );
}

function renderMapperInspector() {
  if (mapperUI.selected === "__output__") {
    return `<aside class="wm-inspector">
      <div class="wm-section-heading"><span>${icon("image", "sm")} 结果图片回传节点</span><span class="wm-eyebrow">OUTPUT</span></div>
      <article class="wm-detail">
        <div class="wm-contract">
          <p>生成完成后，从 <u>#${esc(state.settings.comfy.outputNodeId || "自动寻找")}</u> 接收渲染结果图片。</p>
          <div class="wm-contract-facts">
            <span>${icon("clock", "xs")} 生效时机：每幕完成后</span>
            <span>${icon("box", "xs")} 作用范围：整部画册</span>
          </div>
        </div>
        <p class="help">默认自动探测工作流中类型为 <code>SaveImage</code> 或 <code>PreviewImage</code> 的节点；如蓝图包含多个保存节点，请在列表下拉框中精确指定。</p>
      </article>
    </aside>`;
  }
  const b = mapperSelectedBinding();
  return `<aside class="wm-inspector"><div class="wm-section-heading"><span>${icon("settings", "sm")} 映射详情</span><span class="wm-eyebrow">INSPECTOR</span></div>${b ? renderMappingRule(b, state.settings.comfy.bindings.indexOf(b)) : '<div class="wm-empty"><p>选择一项映射，在这里编辑。</p></div>'}</aside>`;
}

function renderMappingRule(binding, index) {
  const w = state.settings.comfy.workflow,
    n = w[binding.nodeId],
    valid = bindingRowValidity(binding),
    fieldId = "field-" + binding.id,
    fields = n ? workflowInputEntries(n, w) : [],
    attr = (k) => `data-v3-binding="${k}" data-id="${esc(binding.id)}"`,
    meta = SOURCE_META[binding.source] || SOURCE_META.literal,
    nodeTitle = n ? (n._meta?.title || n.class_type) : "未指定节点",
    original =
      valid.original === undefined
        ? "字段尚不存在"
        : JSON.stringify(valid.original, null, 2);

  // 尝试为第一幕做实时 Before / After 取值预览
  const story = projectTemplates()[0];
  const firstFrame = story?.frames?.[0];
  let previewValue = "";
  if (firstFrame) {
    try {
      if (binding.source === "positive") previewValue = firstFrame.prompt || "（本幕未填正向提示词）";
      else if (binding.source === "negative") previewValue = firstFrame.negative || "（使用全局负向提示词）";
      else if (binding.source === "caption") previewValue = firstFrame.caption || "（本幕未填台词）";
      else if (binding.source === "sceneName") previewValue = firstFrame.name || "第 1 幕";
      else if (binding.source === "random") previewValue = "128491028491 (每幕新随机数)";
      else if (binding.source === "literal") previewValue = String(binding.value ?? "");
      else if (binding.source === "variable") previewValue = `{${binding.value}} (装配时替换)`;
      else if (binding.source === "sceneParameter") previewValue = firstFrame[binding.value] !== undefined ? String(firstFrame[binding.value]) : "（保持蓝图原值）";
      else previewValue = meta.verb;
    } catch {
      previewValue = "—";
    }
  }

  return `<article class="mapping-rule wm-detail">
    <div class="wm-detail-title" style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <span class="wm-type-icon">${icon(binding.source === "variable" ? "box" : "nodes", "sm")}</span>
      <div class="grow" style="min-width:0">
        <span class="wm-eyebrow">MAPPING ${pad(index + 1)}</span>
        <h3 style="margin:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(binding.label)}</h3>
      </div>
      ${ibtn("copy", "v3-copy-binding", "复制此映射", `data-id="${esc(binding.id)}"`)}
      ${ibtn("trash", "v3-remove-binding", "删除此映射", `data-id="${esc(binding.id)}"`)}
    </div>

    <!-- 可读自然语言契约卡片 -->
    <div class="wm-contract ${!binding.enabled ? "is-inert" : ""}">
      <p>每一幕生成时，把 <em>${esc(meta.verb)}</em> 写入 <u>#${esc(binding.nodeId || "?")} · ${esc(binding.path || "?")}</u>（${esc(nodeTitle)}）。</p>
      <div class="wm-contract-facts">
        <span>${icon("clock", "xs")} 生效时机：${esc(meta.when)}</span>
        <span>${icon("box", "xs")} 作用范围：${esc(meta.scope)}</span>
        <span>${icon("user", "xs")} 来源：${esc(meta.who)}</span>
      </div>
    </div>

    ${field("映射名称", input("label", binding.label, "text", attr("label") + ' aria-label="映射名称"'))}

    <div class="wm-detail-section">01 <span>写入位置（ComfyUI 节点与字段）</span></div>
    <div class="mapping-target">
      ${field("节点 ID", input("nodeId", binding.nodeId, "text", attr("nodeId") + ' list="v3-node-ids" aria-label="节点 ID" placeholder="选择或输入节点 ID"'))}
      <p class="wm-node-class">${esc(nodeTitle)}</p>
      ${field("字段 / JSON Pointer", input("path", binding.path, "text", attr("path") + ` list="${fieldId}" aria-label="目标字段" placeholder="text 或 strength_model"`))}
    </div>
    <datalist id="${fieldId}">${fields
      .filter((f) => !f.link)
      .map((f) => `<option value="${esc(f.path)}">${esc(f.type)}</option>`)
      .join("")}</datalist>

    <div class="wm-detail-section">02 <span>取值来源与配置</span></div>
    ${field(
      "来源",
      `<select ${attr("source")} aria-label="映射值来源">
        <optgroup label="来自分镜（推荐）">
          <option value="positive" ${binding.source === "positive" ? "selected" : ""}>本幕正向提示词</option>
          <option value="negative" ${binding.source === "negative" ? "selected" : ""}>本幕负向提示词</option>
          <option value="caption" ${binding.source === "caption" ? "selected" : ""}>本幕台词 / 旁白</option>
          <option value="sceneName" ${binding.source === "sceneName" ? "selected" : ""}>分幕名称</option>
          <option value="sceneParameter" ${binding.source === "sceneParameter" ? "selected" : ""}>分镜画面参数（宽高/步数/CFG/种子）</option>
        </optgroup>
        <optgroup label="来自装配与预设">
          <option value="variable" ${binding.source === "variable" ? "selected" : ""}>视觉预设变量 {变量名}</option>
          <option value="bookTitle" ${binding.source === "bookTitle" ? "selected" : ""}>画册标题</option>
          <option value="image" ${binding.source === "image" ? "selected" : ""}>角色正面立绘或参考图</option>
        </optgroup>
        <optgroup label="固定值与算法">
          <option value="literal" ${binding.source === "literal" ? "selected" : ""}>固定值 / 模板文本</option>
          <option value="random" ${binding.source === "random" ? "selected" : ""}>自动随机种子</option>
          <option value="inherit" ${binding.source === "inherit" ? "selected" : ""}>保持蓝图原值（不写入）</option>
        </optgroup>
      </select>`
    )}

    ${["literal", "variable", "sceneParameter"].includes(binding.source)
      ? field(
          binding.source === "variable" ? "变量名" : binding.source === "sceneParameter" ? "分镜参数名" : "固定值 / 模板文本",
          binding.source === "literal"
            ? `<textarea ${attr("value")} aria-label="映射值" spellcheck="false" placeholder="固定值或 {变量名}">${esc(binding.value)}</textarea>`
            : input(
                "value",
                binding.value,
                "text",
                attr("value") +
                  ` aria-label="映射值" ${binding.source === "sceneParameter" ? 'list="v3-render-parameters"' : ""} placeholder="${binding.source === "variable" ? "例如 lora_strength" : "例如 width / steps / seed"}"`
              )
        )
      : ""}

    ${field(
      "数据类型",
      `<select ${attr("type")} aria-label="映射数据类型">${Object.entries(
        bindingTypes
      )
        .map((x) => opt(...x, binding.type))
        .join("")}</select>`
    )}

    <!-- 实时 Before / After 效果预览卡片 -->
    <div class="wm-preview-card">
      <div class="wm-preview-head">
        <span>实时取值预览</span>
        <span class="mono">${firstFrame ? "按第 1 幕测试" : "无分镜"}</span>
      </div>
      <div class="wm-preview-row is-old">
        <i>蓝图原值</i>
        <pre>${esc(original)}</pre>
      </div>
      <div class="wm-preview-row is-new">
        <i>本次写入</i>
        <pre>${esc(previewValue || "（空）")}</pre>
      </div>
    </div>

    <div class="mapping-resolved ${valid.ok ? "" : "danger"}" style="margin-top:12px">
      ${icon(valid.ok ? "check" : "help", "sm")} ${esc(valid.text)}
    </div>
    ${binding.warning ? `<div class="mapping-warning">${esc(binding.warning)}</div>` : ""}

    <details class="advanced-details" style="margin-top:12px">
      <summary>高级选项</summary>
      <label class="row tiny" style="margin:8px 0"><input type="checkbox" ${attr("allowCreate")} ${binding.allowCreate ? "checked" : ""}>允许新增不存在的字段</label>
      <p class="help">不会覆盖已有标量或节点连线。嵌套数组需在蓝图中预先存在。</p>
      ${["positive", "negative"].includes(binding.source) ? btn("重新识别文本字段", "refresh", "v3-infer-field", `data-id="${esc(binding.id)}"`, "small") : ""}
    </details>
  </article>`;
}

/* 全新单一工作面（0 个 Tab，彻底消灭输入映射/蓝图设置/配置检查三分割） */
function renderSmartMapper() {
  const c = state.settings.comfy,
    issues = mapperBindingIssues(),
    enabled = c.bindings.filter((b) => b.enabled).length;
  const query = mapperUI.search.trim().toLowerCase();
  const visibleBindings = c.bindings.filter((b) => {
    if (mapperUI.filter === "enabled" && !b.enabled) return false;
    if (mapperUI.filter === "disabled" && b.enabled) return false;
    if (mapperUI.filter === "issues" && !issues.some((i) => i.id === b.id)) return false;
    if (!query) return true;
    return [b.label, b.nodeId, b.path, b.value, c.workflow[b.nodeId]?.class_type]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const allPicked = visibleBindings.length > 0 && visibleBindings.every((b) => mapperUI.sel.has(b.id));

  return `<section class="mapping-page wm-workbench wm-surface ${mapperUI.selMode ? "is-selmode" : ""}">
    <!-- 头部：信息 + 导入/导出成组归位 + 更多操作 -->
    <div class="wm-workflow-head" style="display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid var(--line)">
      <div class="wm-workflow-icon">${icon("nodes")}</div>
      <div class="grow" style="min-width:0">
        <div style="display:flex;align-items:center;gap:8px">
          <input class="wm-title" aria-label="工作流名称" data-setting="comfy.workflowTitle" value="${esc(c.workflowTitle)}" style="font-size:16px;font-weight:600;background:transparent;border:1px solid transparent;padding:2px 6px;border-radius:6px;max-width:320px">
          <span class="wm-safe" style="font-size:10.5px;color:var(--muted)">${icon("shield", "xs")} 保护节点连线</span>
        </div>
        <p style="margin:2px 0 0;font-size:11px;color:var(--muted)">
          ${Object.keys(c.workflow).length} 节点<span>·</span>${enabled} 映射启用<span>·</span>自动保存
        </p>
      </div>

      <!-- 成组归位的导入/导出映射包，终结天各一方 -->
      <div class="wm-pairgroup" role="group" aria-label="映射包操作">
        <span class="wm-pairgroup-tag">映射包</span>
        <button type="button" data-act="v3-import-mapping" title="将映射包套用至当前工作流">${icon("upload", "sm")} 导入</button>
        <span class="wm-pairgroup-sep"></span>
        <button type="button" data-act="v3-export-mapping" title="下载当前工作流的完整映射包">${icon("download", "sm")} 导出</button>
      </div>

      <div class="row" style="gap:6px">
        ${btn("复制副本", "copy", "ws-copy", "", "small ghost")}
        ${btn("编辑蓝图", "edit", "edit-workflow", "", "small ghost")}
      </div>
    </div>

    <!-- 常驻健康条（替代假 Tab 配置检查）：点击展开问题列表 -->
    <button type="button" class="wm-health ${issues.length ? "is-bad" : ""}" data-act="wm-health-toggle" aria-expanded="${mapperUI.healthOpen}">
      ${icon(issues.length ? "alert" : "check", "sm")}
      <span>${issues.length ? `发现 ${issues.length} 项待检查` : "配置检查全部通过"}</span>
      <span class="grow">${issues.length ? "点击查看受影响的映射及原因" : "路径、连线、重复与父子覆盖已全部核对"}</span>
      ${icon(mapperUI.healthOpen ? "up" : "down", "xs")}
    </button>
    ${mapperUI.healthOpen ? `
      <div class="wm-health-list">
        ${issues.map((i) => `
          <button type="button" data-act="${i.kind === "output" ? "wm-select-output" : "wm-select"}" data-id="${esc(i.id)}">
            <strong>${esc(c.bindings.find((b) => b.id === i.id)?.label || (i.kind === "output" ? "结果图片节点" : "映射"))}</strong>
            <em>${esc(i.message)}</em>
            ${icon("arrow", "xs")}
          </button>
        `).join("")}
      </div>
    ` : ""}

    <!-- 工具栏与筛选 -->
    <div class="wm-filterbar" style="padding:10px 20px">
      <label class="wm-search">
        ${icon("search", "sm")}
        ${searchInput({ id: 'wm-binding-search', value: mapperUI.search, placeholder: '搜索名称、节点或字段…', label: '搜索映射', controls: 'wm-binding-rows' })}
      </label>
      <div class="wm-segments" aria-label="筛选映射">
        ${[
          ["all", "全部 " + c.bindings.length],
          ["enabled", "已启用 " + enabled],
          ["issues", "待检查" + (issues.length ? " " + issues.length : "")],
          ["disabled", "已停用 " + (c.bindings.length - enabled)],
        ]
          .map(
            ([id, label]) =>
              `<button data-act="wm-filter" data-filter="${id}" aria-pressed="${mapperUI.filter === id}" class="${mapperUI.filter === id ? "active" : ""}">${label}</button>`
          )
          .join("")}
      </div>
      <div class="row wm-filter-actions">
        ${btn("✦ 识别提示词", "spark", "v3-auto-bind", "", "small")}
        ${btn(mapperUI.selMode ? "退出" : "批量管理", "check", "wm-sel-toggle", "", mapperUI.selMode ? "small active" : "small ghost")}
        ${btn("添加映射", "plus", "wm-nodes", "", "small primary")}
      </div>
    </div>

    <!-- 映射表批量操作条 -->
    ${selectionBarHTML({
      count: mapperUI.sel.size,
      unit: "项映射",
      allPicked,
      allAct: "wm-pick-all",
      smart: [
        { label: "选非核心", act: "wm-pick-noncore" },
        { label: "选停用项", act: "wm-pick-disabled" },
      ],
      deleteAct: "wm-delete-bulk",
      exitAct: "wm-sel-toggle",
    })}

    <!-- 节点浏览器（覆盖展开） -->
    ${mapperUI.nodes ? `<section class="wm-node-picker"><div class="row between" style="padding:12px 18px;border-bottom:1px solid var(--line)"><div><h3 style="margin:0;font-size:14px">选择节点输入</h3><p class="help" style="margin:2px 0 0">点击字段右侧的 + 添加映射，连线输入只读。</p></div>${btn("手动添加", "edit", "v3-add-binding", "", "small")}${ibtn("close", "wm-nodes", "关闭节点浏览器")}</div>${renderNodeBrowser()}</section>` : ""}

    <!-- 主双栏工作面（Grid 骨架自适应填满，彻底消灭 clamp 魔数） -->
    <div class="wm-split ${mapperUI.selMode ? "is-selmode" : ""}">
      <section class="wm-list">
        <div class="wm-columns">
          <span>选择</span>
          <span>映射名称 / 写入位置</span>
          <span>取值内容</span>
          <span>生效时机</span>
          <span style="text-align:center">启用</span>
        </div>
        <div id="wm-binding-rows" class="wm-rows">
          ${renderMapperRows()}
        </div>
        <button type="button" class="wm-add-row" data-act="wm-nodes">
          ${icon("plus", "sm")} 从节点中添加输入字段…
        </button>
      </section>

      ${renderMapperInspector()}
    </div>

    <!-- 底栏 -->
    <footer class="wm-footer">
      <span class="wm-check-label ${issues.length ? "has-error" : ""}">
        ${icon(issues.length ? "help" : "check", "sm")}
        ${issues.length ? issues.length + " 项配置待检查" : "全部映射目标有效"}
        <span class="wm-footer-note">· 更改随工作区自动保存</span>
      </span>
      <div class="row">
        ${btn("预览提交 JSON", "eye", "v3-preview-workflow", "", "small")}
        ${btn("一帧试跑", "play", "v3-mapping-dry", "", "small primary")}
      </div>
    </footer>

    <details class="wm-preview" ${rt.preview ? "open" : ""}>
      <summary>试跑预览</summary>
      <div id="dry-preview" class="preview-box">
        ${rt.preview ? imgTag(rt.preview, "试跑结果") : "尚未试跑。使用当前分镜验证工作流；真实生成需先连接 ComfyUI。"}
      </div>
    </details>

    <datalist id="v3-node-ids">${Object.entries(c.workflow)
      .map(([id, n]) => `<option value="${esc(id)}">${esc(n._meta?.title || n.class_type)}</option>`)
      .join("")}</datalist>
    <datalist id="v3-render-parameters">${["width", "height", "steps", "cfg", "denoise", "seed"].map((k) => `<option value="${k}"></option>`).join("")}</datalist>
  </section>`;
}

/* 全新工作流库侧边栏：顶部唯一导入入口、批量多选、引用保护 */
function renderWorkflowLibrary() {
  const c = state.settings.comfy;
  const presets = c.presets || [];
  const query = String(mapperUI.libSearch || "").trim().toLowerCase();
  const filtered = presets.filter((p) => {
    if (!query) return true;
    return (p.title || "").toLowerCase().includes(query);
  });
  const allPicked = filtered.length > 0 && filtered.every((p) => mapperUI.libSel.has(p.id));

  return `<div class="workflow-library wm-library">
    <aside class="workflow-library-list wm-library-rail ${mapperUI.libSelMode ? "is-selmode" : ""}">
      <div class="wm-section-heading" style="display:flex;align-items:center;justify-content:space-between">
        <span>工作流库</span>
        <span class="wm-count">${presets.length}</span>
      </div>

      <!-- 库顶部唯一的导入入口！消灭三处导入的混乱 -->
      <div style="padding:10px 14px 4px">
        ${btn("添加工作流", "plus", "ws-open-unified-import", "", "small primary", 'style="width:100%;justify-content:center"')}
      </div>

      <div style="padding:6px 14px 8px;display:flex;gap:6px;align-items:center">
        <label class="wm-search" style="flex:1;min-width:0">
          ${icon("search", "sm")}
          <input type="search" id="ws-library-search-input" placeholder="查找工作流…" value="${esc(mapperUI.libSearch || "")}" style="font-size:11px" autocomplete="off">
        </label>
        ${btn(mapperUI.libSelMode ? "退出" : "选择", "check", "ws-lib-sel-toggle", "", mapperUI.libSelMode ? "small active" : "small ghost")}
      </div>

      <!-- 库批量选择条 -->
      ${selectionBarHTML({
        count: mapperUI.libSel.size,
        unit: "份",
        allPicked,
        allAct: "ws-lib-pick-all",
        deleteAct: "ws-lib-delete-bulk",
        exitAct: "ws-lib-sel-toggle",
      })}

      <div class="workflow-items">
        ${filtered.map((p) => {
          const isCurrent = p.id === c.activeWorkflowId;
          const isPicked = mapperUI.libSel.has(p.id);
          const isReferenced = state.creation.plans.some(
            (pl) => pl.workflowId === p.id || Object.values(pl.sceneOverrides || {}).some((o) => o.workflowId === p.id)
          );

          return `<div class="workflow-library-item wf-card ${isCurrent && !mapperUI.libSelMode ? "active" : ""} ${isPicked ? "is-picked" : ""}" style="display:flex;align-items:center;gap:8px">
            <div class="wf-card-lead">
              <input type="checkbox" class="sel-cbox" ${isPicked ? "checked" : ""} data-act="ws-lib-pick" data-id="${esc(p.id)}" aria-label="选择 ${esc(p.title)}">
              <span class="sel-glyph">${icon("nodes", "sm")}</span>
            </div>
            <button type="button" class="wf-card-body" data-act="${mapperUI.libSelMode ? "ws-lib-pick" : "ws-select"}" data-id="${esc(p.id)}" style="flex:1;min-width:0">
              <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</strong>
              <div class="wf-badges">
                <span>${Object.keys(p.workflow || {}).length} 节点 · ${(p.bindings || []).length} 映射</span>
                ${isReferenced ? '<em class="ref">画册在用</em>' : ""}
              </div>
            </button>
            ${isCurrent && !mapperUI.libSelMode ? '<i class="wm-active-dot"></i>' : ""}
          </div>`;
        }).join("")}
        ${!filtered.length ? '<p class="muted small" style="padding:16px;text-align:center">没有找到工作流</p>' : ""}
      </div>

      <div class="wm-library-actions" style="display:flex;gap:6px;padding:10px 14px;border-top:1px solid var(--line)">
        ${btn("复制当前", "copy", "ws-copy", "", "small ghost")}
        ${btn("导出全部", "download", "ws-export-all", "", "small ghost")}
      </div>

      <div class="wm-library-note">
        ${icon("shield", "sm")}
        <strong>放心编辑，自由探索</strong>
        <p>映射与原始蓝图分开保存。<br>编辑不会改变已入队任务。</p>
      </div>
    </aside>

    <div class="workflow-library-editor wm-editor">
      ${renderSmartMapper()}
    </div>
  </div>`;
}

function renderNodeBrowser() {
  const workflow = state.settings.comfy.workflow,
    search = createUI.nodeSearch.toLowerCase();
  return `<aside class="mapping-browser">${searchInput({ id: 'v3-node-search', value: createUI.nodeSearch, placeholder: '搜索节点 / LoRA / 字段...', label: '搜索工作流节点', controls: 'v3-node-results' })}<div id="v3-node-results">${nodeBrowserItems(workflow, search)}</div></aside>`;
}

function nodeBrowserItems(workflow, search) {
  return (
    Object.entries(workflow)
      .filter(([id, n]) =>
        (
          id +
          " " +
          n.class_type +
          " " +
          (n._meta?.title || "") +
          " " +
          workflowInputEntries(n, workflow)
            .map((e) => e.path)
            .join(" ")
        )
          .toLowerCase()
          .includes(search)
      )
      .map(
        ([id, n]) =>
          `<details class="node-group" ${search ? "open" : ""}><summary><b>#${esc(id)}</b> ${esc(n._meta?.title || n.class_type)}<small>${esc(n.class_type)}</small></summary>${workflowInputEntries(
            n,
            workflow
          )
            .map((entry) => {
              const existing = state.settings.comfy.bindings.find(
                (b) =>
                  b.nodeId === id &&
                  WorkflowMapping.samePath(b.path, entry.path)
              );
              return `<div class="node-input-item"><span class="grow ${entry.link ? "linked" : ""}" title="${esc(JSON.stringify(entry.value))}">${esc(entry.label)} <span class="wm-field-type">${entry.link ? "连线 · 只读" : entry.type}</span></span>${entry.link ? icon("shield", "sm") : existing ? ibtn("check", "wm-select", "编辑已有映射", `data-id="${esc(existing.id)}"`) : ibtn("plus", "v3-expose-input", "添加此字段", `data-node="${esc(id)}" data-path="${esc(entry.path)}"`)}</div>`;
            })
            .join("")}</details>`
      )
      .join("") ||
    '<div class="mapping-list-empty">未找到匹配节点。试试节点 ID 或字段名。</div>'
  );
}

/* 统一导入面板（支持多选、拖拽、显式单选：新建 vs 替换当前蓝图） */
function openUnifiedWorkflowImportModal() {
  const currentTitle = state.settings.comfy.workflowTitle || "当前工作流";

  modal(
    "添加工作流",
    `<div class="wf-import-sheet">
      <p class="help" style="margin-top:0">支持 ComfyUI API 格式 JSON 与 Mio 映射包，可多选拖入。</p>
      <div class="drop" id="wf-unified-dropzone" onclick="document.querySelector('#wf-unified-file-input').click()">
        ${icon("upload")}
        <b>点击选择文件，或将 .json 拖到此处</b>
        <span>支持多文件批量添加 · 单文件 ≤ 10 MB</span>
      </div>
      <input type="file" id="wf-unified-file-input" accept=".json,application/json" multiple style="display:none">

      <div id="wf-import-filelist" class="filelist" style="display:none"></div>

      <div class="radios">
        <label>
          <input type="radio" name="wf-import-mode" value="new" checked>
          <div>
            <b>新建工作流（推荐）</b>
            <small>作为独立条目加入工作流库，当前编辑的工作流完全不受影响。</small>
          </div>
        </label>
        <label>
          <input type="radio" name="wf-import-mode" value="replace">
          <div>
            <b>替换「${esc(currentTitle)}」的蓝图</b>
            <small>保留现有名称与映射，只更换底层节点图。指向已不存在节点 ID 的映射将自动进入“待检查”。</small>
            <span class="risk">⚠ 替换前系统会自动将当前映射包备份并下载一份，以便随时回滚。</span>
          </div>
        </label>
      </div>

      <div class="modal-footer" style="margin-top:20px">
        ${btn("取消", "", "close-modal")}
        ${btn("确认导入", "check", "ws-do-unified-import", "", "primary disabled", 'id="wf-unified-submit-btn"')}
      </div>
    </div>`,
    "统一工作流资产导入"
  );

  let selectedFiles = [];

  const dropzone = $("#wf-unified-dropzone");
  const fileInput = $("#wf-unified-file-input");
  const submitBtn = $("#wf-unified-submit-btn");
  const fileListEl = $("#wf-import-filelist");

  async function handleFiles(files) {
    if (!files || !files.length) return;
    selectedFiles = [...files];
    fileListEl.style.display = "block";
    fileListEl.innerHTML = selectedFiles.map((f, i) => `
      <div class="filerow">
        <span class="mono muted">${i + 1}</span>
        <span class="nm">${esc(f.name)}</span>
        <span class="kind mono muted">${(f.size / 1024).toFixed(1)} KB</span>
        <span class="res">准备就绪</span>
      </div>
    `).join("");
    submitBtn.classList.remove("disabled");
    submitBtn.textContent = `导入 ${selectedFiles.length} 份`;
  }

  fileInput.onchange = () => handleFiles(fileInput.files);

  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("is-over"); };
  dropzone.ondragleave = () => dropzone.classList.remove("is-over");
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-over");
    handleFiles(e.dataTransfer.files);
  };

  window._pendingImportFiles = () => selectedFiles;
}
