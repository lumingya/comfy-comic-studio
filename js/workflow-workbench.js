/* Workflow workbench — library rail, mapping table and inspector.
 * Rebuilt for visual parity with the rest of Mio: one editorial heading, quiet
 * chrome, a single accent, and generous rhythm. Data still follows the v1
 * bindings contract; only presentation and ephemeral UI state live here. */
"use strict";

// Ephemeral selection/filter state; workflow data continues to use the v1 contract.
const mapperUI = {
  selected: "",
  search: "",
  filter: "all",          // all | enabled | issues | disabled
  tab: "bindings",        // legacy, kept for callers
  nodes: false,
  selMode: false,
  sel: new Set(),         // 映射多选
  libSelMode: false,
  libSel: new Set(),      // 工作流库多选
  libSearch: "",
  healthOpen: false,
  previewFrame: 0,
};

/* ------------------------------------------------------------------ meta */

/* SOURCE_META — 每种取值来源的自然语言描述。
 * noun：写入的是什么；when：何时写；scope：作用范围；who：数据从哪来；badge：表格里的短标签 */
const SOURCE_META = {
  positive:       { noun: "这一幕的正向提示词",            when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊逐幕正向提示词（变量已展开）",   badge: "逐幕" },
  negative:       { noun: "这一幕的负向提示词",            when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊负向提示词，留空则用全局负向", badge: "逐幕" },
  caption:        { noun: "这一幕的台词 / 旁白",           when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊台词输入框",                     badge: "逐幕" },
  sceneName:      { noun: "分幕名称",                      when: "每一幕生成前", scope: "逐幕不同", who: "分镜工坊当前分幕名称",                   badge: "逐幕" },
  sceneParameter: { noun: "分镜画面参数",                  when: "仅开启覆盖时", scope: "逐幕不同", who: "分镜画面参数（未开启覆盖时保持原值）",   badge: "仅覆盖" },
  bookTitle:      { noun: "画册标题",                      when: "任务开始时",   scope: "整本一致", who: "装配时填写的画册名称",                   badge: "整本" },
  variable:       { noun: "视觉预设变量",                  when: "装配时",       scope: "随预设",   who: "预设工坊中的变量",                       badge: "装配" },
  image:          { noun: "角色立绘或参考图",              when: "装配时",       scope: "随角色",   who: "角色资产中的参考图像",                   badge: "装配" },
  literal:        { noun: "固定值或模板文本",              when: "每次生成",     scope: "始终生效", who: "在此处直接填写的固定值",                 badge: "固定" },
  random:         { noun: "自动生成的随机种子",            when: "每次生成前",   scope: "每次不同", who: "根据当前时间戳自动计算",                 badge: "随机" },
  inherit:        { noun: "蓝图原值",                      when: "不写入",       scope: "不修改",   who: "ComfyUI 原始蓝图设定",                   badge: "不写入" },
};

const SOURCE_GROUPS = [
  ["来自分镜（推荐）", ["positive", "negative", "caption", "sceneName", "sceneParameter"]],
  ["来自装配与预设", ["variable", "bookTitle", "image"]],
  ["固定值与算法", ["literal", "random", "inherit"]],
];

const SOURCE_OPTION_LABEL = {
  positive: "本幕正向提示词",
  negative: "本幕负向提示词",
  caption: "本幕台词 / 旁白",
  sceneName: "分幕名称",
  sceneParameter: "分镜画面参数（宽高 / 步数 / CFG / 种子）",
  variable: "视觉预设变量 {变量名}",
  bookTitle: "画册标题",
  image: "角色正面立绘或参考图",
  literal: "固定值 / 模板文本",
  random: "自动随机种子",
  inherit: "保持蓝图原值（不写入）",
};

const RENDER_PARAMETERS = ["width", "height", "steps", "cfg", "denoise", "seed"];

/* Local glyphs that the core icon set lacks. Same 24px stroke grammar as `paths`. */
const WM_GLYPHS = {
  alert: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5M12 18h.01"/>',
  hash: '<path d="M5 9h14M4 15h14M10 4 8 20M16 4l-2 16"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4L4 5Z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  output: '<path d="M4 4h10l6 6v10H4z"/><path d="M14 4v6h6"/><path d="m9 15 3 3 3-3M12 11v7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};

function wmi(name, cls = "") {
  if (Object.hasOwn(WM_GLYPHS, name)) {
    return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${WM_GLYPHS[name]}</svg>`;
  }
  return icon(name, cls);
}

/* --------------------------------------------------------------- helpers */

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

function mapperVisibleBindings(c = state.settings.comfy, issues = mapperBindingIssues()) {
  const query = mapperUI.search.trim().toLowerCase();
  return c.bindings.filter((b) => {
    if (mapperUI.filter === "enabled" && !b.enabled) return false;
    if (mapperUI.filter === "disabled" && b.enabled) return false;
    if (mapperUI.filter === "issues" && !issues.some((i) => i.id === b.id)) return false;
    if (!query) return true;
    return [b.label, b.nodeId, b.path, b.value, c.workflow[b.nodeId]?.class_type, c.workflow[b.nodeId]?._meta?.title]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function mapperSourceLabel(b) {
  if (b.source === "variable") return b.value ? "{" + b.value + "}" : "未填写变量名";
  if (b.source === "literal") {
    const v = String(b.value ?? "").trim();
    return v ? v.replace(/\s+/g, " ") : "未填写";
  }
  if (b.source === "sceneParameter") {
    const key = String(b.value || "").trim();
    if (!key) return "未选择参数";
    return key === "seed" ? key + " · 每幕自动写入" : key + " · 仅覆盖时写入";
  }
  const meta = SOURCE_META[b.source];
  return meta ? meta.noun : (bindingSources[b.source] || b.source);
}

function mapperTimingLabel(b) {
  if (b.source === "sceneParameter" && String(b.value || "").trim() === "seed") return "逐幕";
  return SOURCE_META[b.source]?.badge || "生成时";
}

function mapperNodeTitle(c, id) {
  const n = c.workflow?.[id];
  return n ? (n._meta?.title || n.class_type) : "";
}

function wmSourceTag(source) {
  const label = bindingSources[source] || source;
  return `<span class="wm-tag wm-tag-${esc(source)}" title="${esc(label)}">${esc(label)}</span>`;
}

function wmSwitch(binding) {
  return `<label class="switch wm-switch" onclick="event.stopPropagation()" title="${binding.enabled ? "已启用，点击停用" : "已停用，点击启用"}">
    <input type="checkbox" role="switch" data-v3-binding="enabled" data-id="${esc(binding.id)}" ${binding.enabled ? "checked" : ""} aria-label="启用 ${esc(binding.label)}">
    <span class="switch-track"></span>
  </label>`;
}

/* -------------------------------------------------------------- the rows */

function renderOutputNodeRow(c) {
  const workflow = c.workflow || {};
  const imageNodes = Object.entries(workflow).filter(([, n]) => /SaveImage|PreviewImage/i.test(n.class_type));
  const currentOutput = c.outputNodeId;
  const missing = currentOutput && !workflow[currentOutput];
  const isSelected = mapperUI.selected === "__output__";
  const autoHit = !currentOutput && imageNodes[0];

  return `<article class="wm-row wm-row-output ${isSelected ? "selected" : ""}" data-act="wm-select-output" role="button" tabindex="0" aria-pressed="${isSelected}">
    <div class="wm-cell wm-cell-lead">
      <span class="wm-glyph ${missing ? "is-warn" : "is-ok"}" title="${missing ? "输出节点不存在" : "输出节点有效"}">${wmi(missing ? "alert" : "output", "sm")}</span>
    </div>
    <div class="wm-cell wm-cell-main">
      <strong>结果图片回传节点</strong>
      <span class="wm-target">
        ${currentOutput ? `<b>#${esc(currentOutput)}</b><code>${esc(mapperNodeTitle(c, currentOutput) || "节点不存在")}</code>` : autoHit ? `<b>#${esc(autoHit[0])}</b><code>自动 · ${esc(autoHit[1]._meta?.title || autoHit[1].class_type)}</code>` : `<code class="is-warn">蓝图中没有 SaveImage / PreviewImage 节点</code>`}
      </span>
    </div>
    <div class="wm-cell wm-cell-source" onclick="event.stopPropagation()">
      <select id="v3-output-node-select" class="wm-inline-select" aria-label="结果图片节点">
        <option value="">自动寻找 SaveImage 节点</option>
        ${imageNodes.map(([id, n]) => opt(id, `#${id} · ${n._meta?.title || n.class_type}`, currentOutput)).join("")}
      </select>
    </div>
    <div class="wm-cell wm-cell-when"><span class="wm-when">每幕完成后</span></div>
    <div class="wm-cell wm-cell-toggle"><span class="wm-muted-dash">—</span></div>
  </article>`;
}

function renderMapperRows() {
  const c = state.settings.comfy,
    issues = mapperBindingIssues(),
    selected = mapperSelectedBinding(),
    rows = mapperVisibleBindings(c, issues),
    query = mapperUI.search.trim();

  let body = rows
    .map((b, i) => {
      const bad = issues.find((x) => x.id === b.id);
      const isPicked = mapperUI.sel.has(b.id);
      const isSelected = selected?.id === b.id && mapperUI.selected !== "__output__";
      const nodeTitle = mapperNodeTitle(c, b.nodeId);
      const state_ = bad ? "warn" : !b.enabled ? "off" : "ok";
      const stateTitle = bad ? bad.message : !b.enabled ? "已停用，生成时保持蓝图原值" : "目标有效";
      const valueText = mapperSourceLabel(b);
      return `<article class="wm-row ${isSelected ? "selected" : ""} ${!b.enabled ? "is-off" : ""} ${isPicked ? "is-picked" : ""} ${bad ? "has-issue" : ""}"
          role="button" tabindex="0" data-act="${mapperUI.selMode ? "wm-pick" : "wm-select"}" data-id="${esc(b.id)}" data-index="${i}" aria-pressed="${isSelected}">
        <div class="wm-cell wm-cell-lead">
          <input type="checkbox" class="sel-cbox" ${isPicked ? "checked" : ""} data-act="wm-pick" data-id="${esc(b.id)}" aria-label="选择 ${esc(b.label)}">
          <span class="wm-glyph sel-glyph is-${state_}" title="${esc(stateTitle)}">${wmi(bad ? "alert" : !b.enabled ? "pause" : "check", "sm")}</span>
        </div>
        <div class="wm-cell wm-cell-main">
          <strong title="${esc(b.label)}">${esc(b.label || "未命名映射")}</strong>
          <span class="wm-target" title="#${esc(b.nodeId)} ${esc(nodeTitle)} · ${esc(b.path)}">
            <b>#${esc(b.nodeId || "?")}</b><code>${esc(b.path || "未选择字段")}</code>${nodeTitle ? `<i>${esc(nodeTitle)}</i>` : ""}
          </span>
        </div>
        <div class="wm-cell wm-cell-source">
          ${wmSourceTag(b.source)}
          <span class="wm-value" title="${esc(valueText)}">${esc(valueText)}</span>
        </div>
        <div class="wm-cell wm-cell-when"><span class="wm-when">${esc(mapperTimingLabel(b))}</span></div>
        <div class="wm-cell wm-cell-toggle">${wmSwitch(b)}</div>
      </article>`;
    })
    .join("");

  if (!rows.length) {
    if (!c.bindings.length) {
      body = `<div class="wm-empty">
        ${wmi("layers")}
        <h3>还没有任何映射</h3>
        <p>映射决定分镜里的哪些内容写进 ComfyUI 的哪个节点字段。<br>先让 Mio 识别提示词节点，或者从节点里手动挑选字段。</p>
        <div class="row">${btn("识别提示词节点", "spark", "v3-auto-bind", "", "small primary")}${btn("从节点中添加", "plus", "wm-nodes", "", "small")}</div>
      </div>`;
    } else if (query) {
      body = `<div class="wm-empty">
        ${wmi("search")}
        <h3>没有匹配「${esc(query)}」的映射</h3>
        <p>试试节点编号、字段名或映射名称。</p>
        ${btn("清空搜索", "close", "wm-clear-search", "", "small")}
      </div>`;
    } else {
      const label = { enabled: "已启用", issues: "待检查", disabled: "已停用" }[mapperUI.filter] || "";
      body = `<div class="wm-empty is-quiet">
        ${wmi(mapperUI.filter === "issues" ? "check" : "filter")}
        <h3>${mapperUI.filter === "issues" ? "没有待检查的映射" : `没有${label}的映射`}</h3>
        <p>${mapperUI.filter === "issues" ? "路径、连线、重复与父子覆盖已全部核对。" : "换个筛选条件看看。"}</p>
        ${btn("查看全部", "list", "wm-filter", 'data-filter="all"', "small")}
      </div>`;
    }
  }

  return body + `<div class="wm-rows-divider"><span>输出</span></div>` + renderOutputNodeRow(c);
}

/* ------------------------------------------------------------ inspector */

function renderMapperInspector() {
  const c = state.settings.comfy;
  if (mapperUI.selected === "__output__") {
    const id = c.outputNodeId;
    const auto = Object.entries(c.workflow || {}).find(([, n]) => /SaveImage|PreviewImage/i.test(n.class_type));
    return `<aside class="wm-inspector">
      <header class="wm-inspector-head"><span class="wm-eyebrow">OUTPUT</span><h3>结果图片回传节点</h3></header>
      <div class="wm-inspector-body">
        <div class="wm-contract">
          <p>每幕生成完成后，从 <u>${id ? `#${esc(id)} · ${esc(mapperNodeTitle(c, id) || "节点不存在")}` : auto ? `#${esc(auto[0])} · ${esc(auto[1]._meta?.title || auto[1].class_type)}（自动）` : "自动寻找"}</u> 接收渲染结果。</p>
          <dl class="wm-facts">
            <div><dt>${icon("clock", "sm")}生效时机</dt><dd>每幕完成后</dd></div>
            <div><dt>${icon("box", "sm")}作用范围</dt><dd>整部画册</dd></div>
          </dl>
        </div>
        <p class="wm-note">默认自动探测蓝图中类型为 <code>SaveImage</code> 或 <code>PreviewImage</code> 的节点；如蓝图包含多个保存节点，请在列表里精确指定。</p>
      </div>
    </aside>`;
  }
  const b = mapperSelectedBinding();
  const index = b ? c.bindings.indexOf(b) : -1;
  return `<aside class="wm-inspector">${
    b
      ? renderMappingRule(b, index)
      : `<div class="wm-empty is-quiet">${wmi("target")}<h3>选择一项映射</h3><p>在左侧点击任意映射，即可在这里编辑它的写入位置与取值来源。</p></div>`
  }</aside>`;
}

function mapperPreviewValue(binding, meta) {
  const story = projectTemplates()[0];
  const frame = story?.frames?.[0];
  if (!frame) return { text: "", frameLabel: "无分镜" };
  try {
    let value = "";
    switch (binding.source) {
      case "positive": value = frame.prompt || "（本幕未填正向提示词）"; break;
      case "negative": value = frame.negative || "（使用全局负向提示词）"; break;
      case "caption": value = frame.caption || "（本幕未填台词）"; break;
      case "sceneName": value = frame.name || "第 1 幕"; break;
      case "bookTitle": value = "（装配时填写的画册名称）"; break;
      case "random": value = "128491028491（每幕新随机数）"; break;
      case "literal": value = String(binding.value ?? ""); break;
      case "variable": value = binding.value ? `{${binding.value}}（装配时替换）` : "（未填写变量名）"; break;
      case "image": value = "（角色参考图，上传后替换为文件名）"; break;
      case "inherit": value = "（不写入）"; break;
      case "sceneParameter": {
        const key = String(binding.value || "").trim();
        value = key && frame[key] !== undefined ? String(frame[key]) : "（保持蓝图原值）";
        break;
      }
      default: value = meta.noun;
    }
    return { text: value, frameLabel: "按第 1 幕 · " + (frame.name || story.title || "分镜") };
  } catch {
    return { text: "—", frameLabel: "按第 1 幕" };
  }
}

function renderMappingRule(binding, index) {
  const c = state.settings.comfy,
    w = c.workflow,
    n = Object.hasOwn(w, binding.nodeId) ? w[binding.nodeId] : null,
    valid = bindingRowValidity(binding),
    fieldId = "field-" + binding.id,
    fields = n ? workflowInputEntries(n, w) : [],
    attr = (k) => `data-v3-binding="${k}" data-id="${esc(binding.id)}"`,
    meta = SOURCE_META[binding.source] || SOURCE_META.literal,
    nodeTitle = n ? (n._meta?.title || n.class_type) : "",
    original = valid.original === undefined ? "（字段尚不存在）" : JSON.stringify(valid.original, null, 2),
    preview = mapperPreviewValue(binding, meta),
    target = `<u class="${n && binding.path ? "" : "pending"}">#${esc(binding.nodeId || "?")} · ${esc(binding.path || "未选择字段")}</u>${nodeTitle ? `（${esc(nodeTitle)}）` : ""}`;

  let sentence;
  if (binding.source === "inherit") sentence = `不写入 ${target}，保持蓝图原值。`;
  else if (binding.source === "literal") sentence = `每次生成时，把固定值写入 ${target}。`;
  else if (binding.source === "sceneParameter") sentence = `当分镜开启参数覆盖时，把 <em>${esc(String(binding.value || "").trim() || "分镜参数")}</em> 写入 ${target}。`;
  else sentence = `${esc(meta.when)}，把 <em>${esc(meta.noun)}</em> 写入 ${target}。`;

  const valueField = ["literal", "variable", "sceneParameter"].includes(binding.source)
    ? field(
        binding.source === "variable" ? "变量名" : binding.source === "sceneParameter" ? "分镜参数" : "固定值 / 模板文本",
        binding.source === "literal"
          ? `<textarea ${attr("value")} aria-label="映射值" spellcheck="false" placeholder="固定值，可含 {变量名}">${esc(binding.value)}</textarea>`
          : binding.source === "sceneParameter"
            ? `<select ${attr("value")} aria-label="分镜参数">${opt("", "选择参数…", binding.value)}${RENDER_PARAMETERS.map((k) => opt(k, k, binding.value)).join("")}</select>`
            : input("value", binding.value, "text", attr("value") + ' aria-label="映射值" placeholder="例如 lora_strength" spellcheck="false"')
      )
    : "";

  return `<article class="mapping-rule wm-rule">
    <header class="wm-inspector-head">
      <div class="grow">
        <span class="wm-eyebrow">MAPPING ${pad(index + 1)}</span>
        <h3 title="${esc(binding.label)}">${esc(binding.label || "未命名映射")}</h3>
      </div>
      <div class="wm-inspector-tools">
        ${ibtn("copy", "v3-copy-binding", "复制此映射", `data-id="${esc(binding.id)}"`)}
        ${ibtn("trash", "v3-remove-binding", "删除此映射", `data-id="${esc(binding.id)}"`)}
      </div>
    </header>

    <div class="wm-inspector-body">
      <div class="wm-contract ${!binding.enabled ? "is-inert" : ""} ${valid.ok ? "" : "is-bad"}">
        <p>${sentence}</p>
        <dl class="wm-facts">
          <div><dt>${icon("clock", "sm")}生效时机</dt><dd>${esc(meta.when)}</dd></div>
          <div><dt>${icon("box", "sm")}作用范围</dt><dd>${esc(meta.scope)}</dd></div>
          <div><dt>${wmi("link", "sm")}来源</dt><dd>${esc(meta.who)}</dd></div>
        </dl>
        ${!binding.enabled ? `<span class="wm-contract-flag">已停用 · 生成时保持原值</span>` : ""}
      </div>

      <div class="wm-status ${valid.ok ? "is-ok" : "is-bad"}">${wmi(valid.ok ? "check" : "alert", "sm")}<span>${esc(valid.text)}</span></div>
      ${binding.warning ? `<div class="wm-status is-warn">${wmi("alert", "sm")}<span>${esc(binding.warning)}</span></div>` : ""}

      ${field("映射名称", input("label", binding.label, "text", attr("label") + ' aria-label="映射名称" maxlength="80" placeholder="给这条映射起个名字"'))}

      <h4 class="wm-section"><span>01</span>写入位置</h4>
      <div class="wm-grid-2">
        ${field("节点 ID", input("nodeId", binding.nodeId, "text", attr("nodeId") + ' list="v3-node-ids" aria-label="节点 ID" placeholder="节点编号" spellcheck="false"'))}
        ${field("字段 / JSON Pointer", input("path", binding.path, "text", attr("path") + ` list="${fieldId}" aria-label="目标字段" placeholder="text 或 strength_model" spellcheck="false"`))}
      </div>
      <p class="wm-node-class">${n ? `${esc(n.class_type)}${n._meta?.title && n._meta.title !== n.class_type ? ` · ${esc(n._meta.title)}` : ""}` : binding.nodeId ? `<span class="is-warn">节点 #${esc(binding.nodeId)} 不在当前蓝图中</span>` : "先填写节点编号，可从下拉列表选取"}</p>
      <datalist id="${fieldId}">${fields.filter((f) => !f.link).map((f) => `<option value="${esc(f.path)}">${esc(f.type)}</option>`).join("")}</datalist>

      <h4 class="wm-section"><span>02</span>取值来源</h4>
      ${field(
        "来源",
        `<select ${attr("source")} aria-label="映射值来源">${SOURCE_GROUPS.map(
          ([group, keys]) => `<optgroup label="${group}">${keys.map((k) => opt(k, SOURCE_OPTION_LABEL[k], binding.source)).join("")}</optgroup>`
        ).join("")}</select>`
      )}
      ${valueField}
      ${field("数据类型", `<select ${attr("type")} aria-label="映射数据类型">${Object.entries(bindingTypes).map((x) => opt(...x, binding.type)).join("")}</select>`)}

      <h4 class="wm-section"><span>03</span>实时取值预览 <em>${esc(preview.frameLabel)}</em></h4>
      <div class="wm-diff">
        <div class="wm-diff-row is-old"><i>蓝图原值</i><pre>${esc(original)}</pre></div>
        <div class="wm-diff-row is-new"><i>本次写入</i><pre>${esc(binding.source === "inherit" ? "（不写入）" : preview.text || "（空）")}</pre></div>
      </div>

      <details class="wm-advanced">
        <summary>${wmi("chevron", "sm")}高级选项</summary>
        <label class="wm-check"><input type="checkbox" ${attr("allowCreate")} ${binding.allowCreate ? "checked" : ""}><span>允许新增蓝图中不存在的字段<small>不会覆盖已有标量或节点连线；嵌套数组需在蓝图中预先存在。</small></span></label>
        ${["positive", "negative"].includes(binding.source) ? btn("重新识别文本字段", "refresh", "v3-infer-field", `data-id="${esc(binding.id)}"`, "small") : ""}
      </details>
    </div>
  </article>`;
}

/* --------------------------------------------------------------- editor */

function renderSmartMapper() {
  const c = state.settings.comfy,
    issues = mapperBindingIssues(),
    total = c.bindings.length,
    enabled = c.bindings.filter((b) => b.enabled).length,
    nodeCount = Object.keys(c.workflow || {}).length,
    visible = mapperVisibleBindings(c, issues),
    allPicked = visible.length > 0 && visible.every((b) => mapperUI.sel.has(b.id));

  if (!nodeCount) {
    return `<section class="mapping-page wm-workbench wm-surface is-blank">
      <div class="wm-empty">
        ${wmi("layers")}
        <h3>这份工作流还没有蓝图</h3>
        <p>导入 ComfyUI 的 API 格式 JSON，Mio 会列出所有节点与字段，供你建立映射。</p>
        <div class="row">${btn("添加工作流", "upload", "ws-open-unified-import", "", "small primary")}${btn("编辑蓝图 JSON", "edit", "edit-workflow", "", "small")}</div>
      </div>
    </section>`;
  }

  const filters = [
    ["all", "全部", total],
    ["enabled", "已启用", enabled],
    ["issues", "待检查", issues.length],
    ["disabled", "已停用", total - enabled],
  ];

  return `<section class="mapping-page wm-workbench wm-surface ${mapperUI.selMode ? "is-selmode" : ""}">
    <header class="wm-head">
      <div class="wm-head-title">
        <input class="wm-title" aria-label="工作流名称" data-setting="comfy.workflowTitle" value="${esc(c.workflowTitle)}" placeholder="未命名工作流" spellcheck="false">
        <p class="wm-meta">
          <span>${nodeCount} 节点</span><span>${enabled} / ${total} 映射启用</span>
          <span class="wm-meta-safe" title="映射永远不会改写节点之间的连线">${icon("shield", "sm")}保护节点连线</span>
          <span class="wm-meta-save">自动保存</span>
        </p>
      </div>
      <div class="wm-head-actions">
        <div class="wm-group" role="group" aria-label="映射包">
          <span class="wm-group-label">映射包</span>
          <button type="button" data-act="v3-import-mapping" title="将映射包套用至当前工作流">${icon("upload", "sm")}导入</button>
          <button type="button" data-act="v3-export-mapping" title="下载当前工作流的完整映射包">${icon("download", "sm")}导出</button>
        </div>
        ${btn("复制副本", "copy", "ws-copy", "", "small ghost")}
        ${btn("编辑蓝图", "edit", "edit-workflow", "", "small ghost")}
      </div>
    </header>

    <button type="button" class="wm-health ${issues.length ? "is-bad" : "is-ok"}" data-act="wm-health-toggle" aria-expanded="${mapperUI.healthOpen}" ${issues.length ? "" : "disabled"}>
      ${wmi(issues.length ? "alert" : "check", "sm")}
      <strong>${issues.length ? `发现 ${issues.length} 项待检查` : "配置检查全部通过"}</strong>
      <span>${issues.length ? "点击查看受影响的映射及原因" : "路径、连线、重复与父子覆盖已全部核对"}</span>
      ${issues.length ? icon(mapperUI.healthOpen ? "up" : "down", "sm") : ""}
    </button>
    ${mapperUI.healthOpen && issues.length ? `<div class="wm-health-list">${issues
      .map((i) => `<button type="button" data-act="${i.kind === "output" ? "wm-select-output" : "wm-select"}" data-id="${esc(i.id)}">
          <strong>${esc(c.bindings.find((b) => b.id === i.id)?.label || (i.kind === "output" ? "结果图片节点" : "映射"))}</strong>
          <em>${esc(i.message)}</em>${icon("arrow", "sm")}
        </button>`)
      .join("")}</div>` : ""}

    <div class="wm-toolbar">
      <label class="wm-search">
        ${icon("search", "sm")}
        ${searchInput({ id: "wm-binding-search", value: mapperUI.search, placeholder: "搜索名称、节点或字段", label: "搜索映射", controls: "wm-binding-rows" })}
      </label>
      <div class="wm-segments" role="tablist" aria-label="筛选映射">
        ${filters
          .map(([id, label, count]) => `<button type="button" role="tab" data-act="wm-filter" data-filter="${id}" aria-selected="${mapperUI.filter === id}" class="${mapperUI.filter === id ? "active" : ""} ${id === "issues" && count ? "has-issue" : ""}">${label}<b>${count}</b></button>`)
          .join("")}
      </div>
      <div class="wm-toolbar-actions">
        ${btn("识别提示词", "spark", "v3-auto-bind", 'title="自动找出正向 / 负向提示词节点"', "small ghost")}
        ${btn(mapperUI.selMode ? "完成" : "批量管理", "check", "wm-sel-toggle", "", mapperUI.selMode ? "small active" : "small ghost")}
        ${btn("添加映射", "plus", "wm-nodes", 'aria-expanded="' + mapperUI.nodes + '"', "small primary")}
      </div>
    </div>

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

    ${mapperUI.nodes ? `<section class="wm-node-picker">
      <div class="wm-node-picker-head">
        <div><h3>从节点中选择输入字段</h3><p>点击字段右侧的 + 建立映射；带连线的输入是只读的。</p></div>
        ${btn("手动添加空白映射", "edit", "v3-add-binding", "", "small ghost")}
        ${ibtn("close", "wm-nodes", "关闭节点浏览器")}
      </div>
      ${renderNodeBrowser()}
    </section>` : ""}

    <div class="wm-split">
      <section class="wm-list" aria-label="映射列表">
        <div class="wm-columns" aria-hidden="true">
          <span></span><span>映射 · 写入位置</span><span>取值来源</span><span>时机</span><span>启用</span>
        </div>
        <div id="wm-binding-rows" class="wm-rows">${renderMapperRows()}</div>
        <button type="button" class="wm-add-row" data-act="wm-nodes">${icon("plus", "sm")}从节点中添加输入字段</button>
      </section>
      ${renderMapperInspector()}
    </div>

    <footer class="wm-footer">
      <span class="wm-footer-status ${issues.length ? "is-bad" : "is-ok"}">
        ${wmi(issues.length ? "alert" : "check", "sm")}
        ${issues.length ? issues.length + " 项配置待检查" : "全部映射目标有效"}
        <em>· 更改随工作区自动保存</em>
      </span>
      <div class="row">
        ${btn("预览提交 JSON", "eye", "v3-preview-workflow", "", "small")}
        ${btn("一帧试跑", "play", "v3-mapping-dry", "", "small primary")}
      </div>
    </footer>

    <details class="wm-preview" ${rt.preview ? "open" : ""}>
      <summary>${wmi("chevron", "sm")}试跑预览</summary>
      <div id="dry-preview" class="preview-box">${rt.preview ? imgTag(rt.preview, "试跑结果") : "尚未试跑。使用当前分镜验证工作流；真实生成需先连接 ComfyUI。"}</div>
    </details>

    <datalist id="v3-node-ids">${Object.entries(c.workflow).map(([id, n]) => `<option value="${esc(id)}">${esc(n._meta?.title || n.class_type)}</option>`).join("")}</datalist>
    <datalist id="v3-render-parameters">${RENDER_PARAMETERS.map((k) => `<option value="${k}"></option>`).join("")}</datalist>
  </section>`;
}

/* -------------------------------------------------------------- library */

function workflowIsReferenced(id) {
  return state.creation.plans.some(
    (pl) => pl.workflowId === id || Object.values(pl.sceneOverrides || {}).some((o) => o.workflowId === id)
  );
}

/* Editorial page heading, shared with the other studio views. */
function renderWorkflowPageHeading() {
  const c = state.settings.comfy;
  const issues = mapperBindingIssues();
  const total = (c.presets || []).length;
  return `<div class="page-heading wm-page-heading">
    <div>
      <div class="eyebrow">工作流与 API 配置 · 节点映射</div>
      <h1>工作流配置</h1>
      <p>决定分镜里的哪些内容写进 ComfyUI 的哪个节点字段。蓝图连线始终受保护，映射可随时停用。</p>
    </div>
    <div class="actions wm-page-stats">
      <span><b>${total}</b>份工作流</span>
      <span><b>${c.bindings.filter((b) => b.enabled).length}</b>映射启用</span>
      <span class="${issues.length ? "is-bad" : ""}"><b>${issues.length}</b>待检查</span>
    </div>
  </div>`;
}

function renderWorkflowLibrary() {
  const c = state.settings.comfy;
  const presets = c.presets || [];
  const query = String(mapperUI.libSearch || "").trim().toLowerCase();
  const filtered = presets.filter((p) => !query || (p.title || "").toLowerCase().includes(query));
  const allPicked = filtered.length > 0 && filtered.every((p) => mapperUI.libSel.has(p.id));
  const current = presets.find((p) => p.id === c.activeWorkflowId);

  const items = filtered
    .map((p) => {
      const isCurrent = p.id === c.activeWorkflowId;
      const isPicked = mapperUI.libSel.has(p.id);
      const referenced = workflowIsReferenced(p.id);
      const nodes = Object.keys(p.workflow || {}).length;
      const maps = (p.bindings || []).length;
      return `<div class="wm-lib-item ${isCurrent && !mapperUI.libSelMode ? "active" : ""} ${isPicked ? "is-picked" : ""}">
        <input type="checkbox" class="sel-cbox" ${isPicked ? "checked" : ""} data-act="ws-lib-pick" data-id="${esc(p.id)}" aria-label="选择 ${esc(p.title)}">
        <button type="button" class="wm-lib-body" data-act="${mapperUI.libSelMode ? "ws-lib-pick" : "ws-select"}" data-id="${esc(p.id)}" aria-current="${isCurrent ? "true" : "false"}" title="${esc(p.title)}">
          <strong>${esc(p.title || "未命名工作流")}</strong>
          <span class="wm-lib-meta">${nodes ? `${nodes} 节点 · ${maps} 映射` : "空白蓝图"}${referenced ? `<em class="wm-lib-ref" title="有画册或分镜正在使用">在用</em>` : ""}</span>
        </button>
      </div>`;
    })
    .join("");

  return `<div class="workflow-library wm-library">
    <aside class="workflow-library-list wm-rail ${mapperUI.libSelMode ? "is-selmode" : ""}" aria-label="工作流库">
      <div class="wm-rail-head">
        <span class="wm-rail-title">工作流库<b>${presets.length}</b></span>
        ${presets.length > 1 || mapperUI.libSelMode ? btn(mapperUI.libSelMode ? "完成" : "选择", "", "ws-lib-sel-toggle", "", mapperUI.libSelMode ? "small active" : "small ghost") : ""}
      </div>

      ${btn("添加工作流", "plus", "ws-open-unified-import", "", "primary wm-rail-cta")}

      <label class="wm-search wm-rail-search">
        ${icon("search", "sm")}
        <input type="search" id="ws-library-search-input" placeholder="查找工作流" value="${esc(mapperUI.libSearch || "")}" aria-label="查找工作流" autocomplete="off" spellcheck="false">
      </label>

      <label class="wm-mobile-select">
        <span>当前工作流</span>
        <select id="ws-library-select" aria-label="选择工作流">${presets.map((p) => opt(p.id, p.title, c.activeWorkflowId)).join("")}</select>
      </label>

      ${selectionBarHTML({ count: mapperUI.libSel.size, unit: "份", allPicked, allAct: "ws-lib-pick-all", deleteAct: "ws-lib-delete-bulk", exitAct: "ws-lib-sel-toggle" })}

      <div class="workflow-items wm-lib-items">
        ${items || `<p class="wm-lib-empty">${query ? "没有找到匹配的工作流" : "还没有工作流"}</p>`}
      </div>

      <div class="wm-rail-foot">
        <div class="wm-rail-tools">
          ${btn("复制当前", "copy", "ws-copy", current ? "" : "disabled", "small ghost")}
          ${btn("导出全部", "download", "ws-export-all", "", "small ghost")}
        </div>
        <p class="wm-rail-note">${icon("shield", "sm")}映射与原始蓝图分开保存，编辑不会改变已入队的任务。</p>
      </div>
    </aside>

    <div class="workflow-library-editor wm-editor">${renderSmartMapper()}</div>
  </div>`;
}

/* --------------------------------------------------------- node browser */

function renderNodeBrowser() {
  const workflow = state.settings.comfy.workflow,
    search = createUI.nodeSearch.toLowerCase();
  return `<div class="mapping-browser wm-browser">
    <label class="wm-search">${icon("search", "sm")}${searchInput({ id: "v3-node-search", value: createUI.nodeSearch, placeholder: "搜索节点、LoRA 或字段", label: "搜索工作流节点", controls: "v3-node-results" })}</label>
    <div id="v3-node-results" class="wm-node-results">${nodeBrowserItems(workflow, search)}</div>
  </div>`;
}

function nodeBrowserItems(workflow, search) {
  const groups = Object.entries(workflow)
    .filter(([id, n]) =>
      (id + " " + n.class_type + " " + (n._meta?.title || "") + " " + workflowInputEntries(n, workflow).map((e) => e.path).join(" "))
        .toLowerCase()
        .includes(search)
    )
    .map(([id, n]) => {
      const entries = workflowInputEntries(n, workflow);
      const mapped = entries.filter((e) => state.settings.comfy.bindings.some((b) => b.nodeId === id && WorkflowMapping.samePath(b.path, e.path))).length;
      return `<details class="node-group wm-node-group" ${search ? "open" : ""}>
        <summary><b>#${esc(id)}</b><span>${esc(n._meta?.title || n.class_type)}</span><small>${esc(n.class_type)}${mapped ? ` · 已映射 ${mapped}` : ""}</small></summary>
        <div class="wm-node-fields">${entries
          .map((entry) => {
            const existing = state.settings.comfy.bindings.find((b) => b.nodeId === id && WorkflowMapping.samePath(b.path, entry.path));
            return `<div class="node-input-item wm-node-field ${entry.link ? "is-linked" : ""} ${existing ? "is-mapped" : ""}">
              <span class="grow" title="${esc(JSON.stringify(entry.value))}">${esc(entry.label)}<small>${entry.link ? "连线 · 只读" : esc(entry.type)}</small></span>
              ${entry.link ? icon("shield", "sm") : existing ? ibtn("check", "wm-select", "编辑已有映射", `data-id="${esc(existing.id)}"`) : ibtn("plus", "v3-expose-input", "添加此字段", `data-node="${esc(id)}" data-path="${esc(entry.path)}"`)}
            </div>`;
          })
          .join("")}</div>
      </details>`;
    });
  return groups.join("") || `<div class="mapping-list-empty wm-lib-empty">未找到匹配节点。试试节点 ID 或字段名。</div>`;
}

/* ------------------------------------------------------------ importer */

/* 统一导入面板（支持多选、拖拽、显式单选：新建 vs 替换当前蓝图） */
function openUnifiedWorkflowImportModal() {
  const currentTitle = state.settings.comfy.workflowTitle || "当前工作流";

  modal(
    "添加工作流",
    `<div class="wf-import-sheet">
      <p class="help" style="margin-top:0">支持 ComfyUI API 格式 JSON 与 Mio 映射包，可多选拖入。</p>
      <div class="drop" id="wf-unified-dropzone" role="button" tabindex="0" aria-label="选择或拖入 JSON 文件">
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
  const LIMIT = 10 * 1024 * 1024;

  const dropzone = $("#wf-unified-dropzone");
  const fileInput = $("#wf-unified-file-input");
  const submitBtn = $("#wf-unified-submit-btn");
  const fileListEl = $("#wf-import-filelist");

  function handleFiles(files) {
    if (!files || !files.length) return;
    selectedFiles = [...files].filter((f) => /\.json$/i.test(f.name) || f.type === "application/json");
    const rejected = files.length - selectedFiles.length;
    fileListEl.style.display = "block";
    fileListEl.innerHTML = selectedFiles
      .map((f, i) => {
        const tooBig = f.size > LIMIT;
        return `<div class="filerow ${tooBig ? "bad" : ""}">
          <span class="mono muted">${i + 1}</span>
          <span class="nm">${esc(f.name)}</span>
          <span class="kind mono muted">${(f.size / 1024).toFixed(1)} KB</span>
          <span class="res">${tooBig ? "超过 10 MB" : "准备就绪"}</span>
        </div>`;
      })
      .join("") + (rejected ? `<div class="filerow bad"><span></span><span class="nm">已忽略 ${rejected} 个非 JSON 文件</span><span></span><span class="res">跳过</span></div>` : "");
    selectedFiles = selectedFiles.filter((f) => f.size <= LIMIT);
    submitBtn.classList.toggle("disabled", !selectedFiles.length);
    submitBtn.textContent = selectedFiles.length ? `导入 ${selectedFiles.length} 份` : "确认导入";
  }

  fileInput.onchange = () => handleFiles(fileInput.files);
  dropzone.onclick = () => fileInput.click();
  dropzone.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("is-over"); };
  dropzone.ondragleave = () => dropzone.classList.remove("is-over");
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-over");
    handleFiles(e.dataTransfer.files);
  };

  window._pendingImportFiles = () => selectedFiles;
}

/* ---------------------------------------------------- keyboard & wiring */

/* Arrow keys walk the mapping list; Escape leaves selection mode. Registered once. */
(function installWorkflowWorkbenchKeys() {
  if (typeof document === "undefined") return;
  document.addEventListener("keydown", (e) => {
    const row = e.target.closest?.(".wm-rows .wm-row");
    if (row && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const rows = [...row.parentElement.querySelectorAll(".wm-row")];
      const next = rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); }
      return;
    }
    if (e.key === "Escape" && (mapperUI.selMode || mapperUI.libSelMode) && !document.querySelector("dialog[open]") && document.querySelector(".wm-workbench") && typeof handleAction === "function") {
      if (e.target.matches?.("input, textarea, select") && e.target.value) return;
      e.preventDefault();
      handleAction(mapperUI.selMode ? "wm-sel-toggle" : "ws-lib-sel-toggle", {});
    }
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.('[data-act="wm-clear-search"]');
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    mapperUI.search = "";
    const input = $("#wm-binding-search");
    if (input) { input.value = ""; input.focus(); }
    if (typeof render === "function") render();
  }, true);
})();
