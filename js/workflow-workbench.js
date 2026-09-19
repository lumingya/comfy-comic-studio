/* Workflow editor: presentation, filtering and ephemeral selection. */
"use strict";
// Ephemeral selection/filter state; workflow data continues to use the v1 contract.
const mapperUI = {
  selected: "",
  search: "",
  filter: "all",
  tab: "bindings",
  nodes: false,
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
  return b.source === "variable"
    ? "{" + b.value + "}"
    : b.source === "literal"
      ? String(b.value ?? "未填写")
      : b.source === "sceneParameter"
        ? b.value + (String(b.value || "").trim() === "seed" ? " · 每幕自动写入" : " · 仅高级覆盖")
        : {
            positive: "frame.prompt",
            negative: "frame.negative",
            caption: "frame.caption",
            bookTitle: "book.title",
            sceneName: "frame.name",
            random: "每次生成新种子",
            image: "上传后的文件名",
            inherit: "不覆盖蓝图",
          }[b.source] || b.source;
}
function renderMapperRows() {
  const c = state.settings.comfy,
    issues = mapperBindingIssues(),
    selected = mapperSelectedBinding(),
    query = mapperUI.search.trim().toLowerCase();
  const rows = c.bindings.filter(
    (b) =>
      (mapperUI.filter === "all" ||
        (mapperUI.filter === "enabled" && b.enabled) ||
        (mapperUI.filter === "issues" && issues.some((i) => i.id === b.id))) &&
      [b.label, b.nodeId, b.path, b.value, c.workflow[b.nodeId]?.class_type]
        .join(" ")
        .toLowerCase()
        .includes(query),
  );
  return (
    rows
      .map((b) => {
        const bad = issues.find((i) => i.id === b.id);
        return `<article class="wm-row ${selected?.id === b.id ? "selected" : ""} ${!b.enabled ? "is-off" : ""}"><input type="checkbox" data-v3-binding="enabled" data-id="${esc(b.id)}" ${b.enabled ? "checked" : ""} aria-label="启用 ${esc(b.label)}"><button class="wm-row-select" data-act="wm-select" data-id="${esc(b.id)}" aria-pressed="${selected?.id === b.id}"><span class="wm-row-main"><strong>${esc(b.label)}</strong><span class="wm-target"><b>#${esc(b.nodeId || "?")}</b><code>${esc(b.path || "未选择字段")}</code></span></span><span class="wm-row-source"><span class="wm-source-tag ${b.source}">${esc(bindingSources[b.source] || b.source)}</span><span class="wm-value">${esc(mapperSourceLabel(b))}</span></span><span class="wm-row-state ${bad ? "has-error" : ""}" title="${esc(bad?.message || (!b.enabled ? "已停用" : "目标有效"))}">${icon(bad ? "help" : !b.enabled ? "pause" : "check", "sm")}</span></button></article>`;
      })
      .join("") ||
    `<div class="wm-empty">${icon("nodes")}<h3>${c.bindings.length ? "没有匹配的映射" : "把工作流连接到你的创作"}</h3><p>${c.bindings.length ? "试试其他关键词，或切换筛选条件。" : "从节点中选择一个输入字段，再指定它的值从哪里来。"}</p>${btn("浏览节点字段", "plus", "wm-nodes", "", "small")}</div>`
  );
}
function renderMapperInspector() {
  const b = mapperSelectedBinding();
  return `<aside class="wm-inspector"><div class="wm-section-heading"><span>${icon("settings", "sm")} 映射详情</span><span class="wm-eyebrow">INSPECTOR</span></div>${b ? renderMappingRule(b, state.settings.comfy.bindings.indexOf(b)) : '<div class="wm-empty"><p>选择一项映射，在这里编辑。</p></div>'}</aside>`;
}
function renderSmartMapper() {
  const c = state.settings.comfy,
    issues = mapperBindingIssues(),
    enabled = c.bindings.filter((b) => b.enabled).length;
  return `<section class="mapping-page wm-workbench"><div class="wm-workflow-head"><div class="wm-workflow-icon">${icon("nodes")}</div><div class="grow"><span class="wm-eyebrow">COMFYUI WORKFLOW</span><input class="wm-title" aria-label="工作流名称" data-setting="comfy.workflowTitle" value="${esc(c.workflowTitle)}"><p>${Object.keys(c.workflow).length} 个节点<span>·</span>${enabled} 项启用映射<span>·</span>原始节点与连接完整保留</p></div>${btn("导出映射包", "download", "v3-export-mapping", "", "small")}</div>
 <div class="wm-tabs" role="tablist" aria-label="工作流编辑视图">${[
   ["bindings", "输入映射", c.bindings.length],
   ["settings", "蓝图设置", ""],
   ["check", "配置检查", issues.length || "✓"],
 ]
   .map(
     ([id, label, n]) =>
       `<button role="tab" aria-selected="${mapperUI.tab === id}" data-act="wm-tab" data-tab="${id}" class="${mapperUI.tab === id ? "active" : ""}">${label}<span>${n}</span></button>`,
   )
   .join(
     "",
   )}<span class="spacer"></span><span class="wm-safe">${icon("shield", "sm")} 保护节点连线</span></div>
 <datalist id="v3-node-ids">${Object.entries(c.workflow)
   .map(
     ([id, n]) =>
       `<option value="${esc(id)}">${esc(n._meta?.title || n.class_type)}</option>`,
   )
   .join(
     "",
   )}</datalist><datalist id="v3-render-parameters">${["width", "height", "steps", "cfg", "denoise", "seed"].map((k) => `<option value="${k}"></option>`).join("")}</datalist>
 ${
   mapperUI.tab === "bindings"
     ? `<div class="wm-filterbar"><label class="wm-search">${icon("search", "sm")}<input id="wm-binding-search" aria-label="搜索映射" placeholder="搜索名称、节点或字段…" value="${esc(mapperUI.search)}"></label><div class="wm-segments" aria-label="筛选映射">${[
         ["all", "全部"],
         ["enabled", "已启用"],
         ["issues", "待检查" + (issues.length ? " " + issues.length : "")],
       ]
         .map(
           ([id, label]) =>
             `<button data-act="wm-filter" data-filter="${id}" aria-pressed="${mapperUI.filter === id}" class="${mapperUI.filter === id ? "active" : ""}">${label}</button>`,
         )
         .join(
           "",
         )}</div><div class="row wm-filter-actions">${btn("识别提示词", "spark", "v3-auto-bind", "", "small")}${btn("添加映射", "plus", "wm-nodes", "", "small primary")}</div></div>
 ${mapperUI.nodes ? `<section class="wm-node-picker"><div class="row between"><div><h3>选择节点输入</h3><p class="help">点击字段右侧的 + 添加映射，连线输入只读。</p></div>${btn("手动添加", "edit", "v3-add-binding", "", "small")}${ibtn("close", "wm-nodes", "关闭节点浏览器")}</div>${renderNodeBrowser()}</section>` : ""}
 <div class="wm-split"><section class="wm-list"><div class="wm-columns"><span>映射名称 / 目标字段</span><span>值的来源</span><span>状态</span></div><div id="wm-binding-rows">${renderMapperRows()}</div><button class="wm-add-row" data-act="wm-nodes">${icon("plus", "sm")} 从节点中添加输入字段</button><div class="wm-list-tip">${icon("help", "sm")} 同一个变量可以传入多个节点；未映射的字段保留蓝图原值。</div></section>${renderMapperInspector()}</div>`
     : mapperUI.tab === "settings"
       ? `<div class="wm-settings"><h3>蓝图与输出</h3><p class="help">导入 ComfyUI API 格式 JSON 或映射包，作为新工作流加入库，不覆盖当前蓝图。</p><div class="row wrap">${btn("导入工作流 JSON", "upload", "v3-import-workflow")}${btn("导入映射包", "upload", "v3-import-mapping")}${btn("编辑完整蓝图", "edit", "edit-workflow")}</div>${field("结果图片节点 · 留空自动查找", input("outputNodeId", c.outputNodeId || "", "text", 'data-v3-output="true" list="v3-node-ids" placeholder="例如 9"'))}<label class="row"><input type="checkbox" id="v3-randomize-seeds" ${c.randomizeSeeds ? "checked" : ""}>每次任务随机化蓝图中的种子</label><div class="divider"></div><h3>节点定义与高级参数</h3><p class="help">从已连接的 ComfyUI 读取自定义节点字段。分镜参数中的种子会为每一幕自动写入（可复现或随机）；宽高、步数、CFG 等只在单幕开启渲染覆盖时写入。</p><div class="row wrap">${btn("同步节点定义", "refresh", "v3-read-object-info")}${btn("添加分镜参数映射", "settings", "v3-add-render-mappings")}</div></div>`
       : `<div class="wm-settings"><div class="wm-check-summary ${issues.length ? "has-error" : ""}">${icon(issues.length ? "help" : "check")}<div><h3>${issues.length ? "发现 " + issues.length + " 个配置问题" : "映射目标检查通过"}</h3><p>检查路径、连线保护、重复与父子覆盖；不代替实际 GPU 试跑。</p></div></div>${issues.map((i) => `<button class="wm-issue" data-act="${i.kind === "output" ? "wm-tab" : "wm-select"}" data-tab="settings" data-id="${esc(i.id)}"><strong>${esc(c.bindings.find((b) => b.id === i.id)?.label || (i.kind === "output" ? "结果图片节点" : "映射"))}</strong><span>${esc(i.message)}</span>${icon("arrow", "sm")}</button>`).join("")}<p class="help">未启用和“保持原值”的映射不参与检查。变量值、节点数值约束及服务可用性将在提交预览或试跑时检查。</p></div>`
 }
 <footer class="wm-footer"><span class="wm-check-label ${issues.length ? "has-error" : ""}">${icon(issues.length ? "help" : "check", "sm")}${issues.length ? issues.length + " 项待检查" : "映射目标有效"}<span class="wm-footer-note">· 更改随工作区自动保存</span></span><div class="row">${btn("预览提交 JSON", "eye", "v3-preview-workflow", "", "small")}${btn("一帧试跑", "play", "v3-mapping-dry", "", "small primary")}</div></footer><details class="wm-preview" ${rt.preview ? "open" : ""}><summary>试跑预览</summary><div id="dry-preview" class="preview-box">${rt.preview ? imgTag(rt.preview, "试跑结果") : "尚未试跑。使用当前分镜验证工作流；真实生成需先连接 ComfyUI。"}</div></details></section>`;
}

function renderMappingRule(binding, index) {
  const w = state.settings.comfy.workflow,
    n = w[binding.nodeId],
    valid = bindingRowValidity(binding),
    fieldId = "field-" + binding.id,
    fields = n ? workflowInputEntries(n, w) : [],
    attr = (k) => `data-v3-binding="${k}" data-id="${esc(binding.id)}"`,
    original =
      valid.original === undefined
        ? "字段尚不存在"
        : JSON.stringify(valid.original, null, 2);
  return `<article class="mapping-rule wm-detail"><div class="wm-detail-title"><span class="wm-type-icon">${icon(binding.source === "variable" ? "box" : "nodes", "sm")}</span><div><span class="wm-eyebrow">MAPPING ${pad(index + 1)}</span><h3>${esc(binding.label)}</h3></div>${ibtn("trash", "v3-remove-binding", "仅删除此映射", `data-id="${esc(binding.id)}"`)}</div>${field("映射名称", input("label", binding.label, "text", attr("label") + ' aria-label="映射名称"'))}<div class="wm-detail-section">01 <span>目标输入</span></div><div class="mapping-target">${field("节点 ID", input("nodeId", binding.nodeId, "text", attr("nodeId") + ' list="v3-node-ids" aria-label="节点 ID" placeholder="选择或输入节点 ID"'))}<p class="wm-node-class">${esc(n ? n._meta?.title || n.class_type : "尚未选择节点")}</p>${field("字段 / JSON Pointer", input("path", binding.path, "text", attr("path") + ` list="${fieldId}" aria-label="目标字段" placeholder="/loras/0/strength"`))}</div><datalist id="${fieldId}">${fields
    .filter((f) => !f.link)
    .map((f) => `<option value="${esc(f.path)}">${esc(f.type)}</option>`)
    .join(
      "",
    )}</datalist><div class="wm-detail-section">02 <span>值的来源</span></div>${field(
    "来源",
    `<select ${attr("source")} aria-label="映射值来源">${Object.entries(
      bindingSources,
    )
      .map((x) => opt(...x, binding.source))
      .join("")}</select>`,
  )}${["literal", "variable", "sceneParameter"].includes(binding.source) ? field(binding.source === "variable" ? "变量名" : binding.source === "sceneParameter" ? "分镜参数名" : "值 / 模板文本", binding.source === "literal" ? `<textarea ${attr("value")} aria-label="映射值" spellcheck="false" placeholder="固定值或 {变量名}">${esc(binding.value)}</textarea>` : input("value", binding.value, "text", attr("value") + ` aria-label="映射值" ${binding.source === "sceneParameter" ? 'list="v3-render-parameters"' : ""} placeholder="${binding.source === "variable" ? "例如 lora_strength" : "例如 width / steps"}"`)) : `<p class="wm-source-help">${binding.source === "inherit" ? "保留蓝图原值，不写入此字段。" : "生成时按当前分镜自动传入。"}</p>`}${field(
    "数据类型",
    `<select ${attr("type")} aria-label="映射数据类型">${Object.entries(
      bindingTypes,
    )
      .map((x) => opt(...x, binding.type))
      .join("")}</select>`,
  )}<div class="wm-original"><span>蓝图原值</span><pre>${esc(original)}</pre></div><div class="mapping-resolved ${valid.ok ? "" : "danger"}">${icon(valid.ok ? "check" : "help", "sm")} ${esc(valid.text)}</div>${binding.warning ? `<div class="mapping-warning">${esc(binding.warning)}</div>` : ""}<details class="advanced-details"><summary>高级选项</summary><label class="row tiny"><input type="checkbox" ${attr("allowCreate")} ${binding.allowCreate ? "checked" : ""}>允许新增不存在的字段</label><p class="help">不会覆盖已有标量或节点连线。嵌套数组需在蓝图中预先存在。</p>${["positive", "negative"].includes(binding.source) ? btn("重新识别文本字段", "refresh", "v3-infer-field", `data-id="${esc(binding.id)}"`, "small") : ""}</details></article>`;
}

function renderWorkflowLibrary() {
  const c = state.settings.comfy;
  return `<div class="wm-page-heading"><div><span class="wm-eyebrow">WORKFLOW STUDIO</span><h1>工作流配置<span class="wm-heading-dot"></span></h1><p>连接创作与生成，让每一个参数各就其位。</p></div><div class="row">${btn("批量导入", "upload", "ws-import", "", "small")}${btn("导出全部", "download", "ws-export-all", "", "small")}</div></div><div class="workflow-library wm-library"><aside class="workflow-library-list wm-library-rail"><div class="wm-section-heading"><span>工作流库</span><span class="wm-count">${c.presets.length}</span></div><label class="wm-search">${icon("search", "sm")}<input id="wm-library-search" placeholder="查找工作流…" aria-label="查找工作流"></label><label class="wm-mobile-select">切换工作流<select id="ws-library-select">${c.presets.map((p) => opt(p.id, p.title, c.activeWorkflowId)).join("")}</select></label><div class="workflow-items">${c.presets.map((p) => `<button class="workflow-library-item ${p.id === c.activeWorkflowId ? "active" : ""}" data-act="ws-select" data-id="${esc(p.id)}" aria-current="${p.id === c.activeWorkflowId ? "true" : "false"}"><span class="wm-library-symbol">${icon("nodes", "sm")}</span><strong>${esc(p.title)}</strong><span>${Object.keys(p.workflow || {}).length} 节点 <b>·</b> ${(p.bindings || []).length} 映射</span>${p.id === c.activeWorkflowId ? '<i class="wm-active-dot"></i>' : ""}</button>`).join("")}</div><div class="wm-library-actions">${btn("复制", "copy", "ws-copy", "", "small ghost")}${btn("删除", "trash", "ws-delete", "", "small ghost")}</div><div class="wm-library-note">${icon("shield", "sm")}<strong>放心编辑，自由探索</strong><p>映射与原始蓝图分开保存。<br>编辑不会改变已入队任务。</p></div></aside><div class="workflow-library-editor wm-editor">${renderSmartMapper()}</div></div>`;
}

function renderNodeBrowser() {
  const workflow = state.settings.comfy.workflow,
    search = createUI.nodeSearch.toLowerCase();
  return `<aside class="mapping-browser"><input id="v3-node-search" value="${esc(createUI.nodeSearch)}" placeholder="搜索节点 / LoRA / 字段..." aria-label="搜索工作流节点"><div id="v3-node-results">${nodeBrowserItems(workflow, search)}</div></aside>`;
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
          .includes(search),
      )
      .map(
        ([id, n]) =>
          `<details class="node-group" ${search ? "open" : ""}><summary><b>#${esc(id)}</b> ${esc(n._meta?.title || n.class_type)}<small>${esc(n.class_type)}</small></summary>${workflowInputEntries(
            n,
            workflow,
          )
            .map((entry) => {
              const existing = state.settings.comfy.bindings.find(
                (b) =>
                  b.nodeId === id &&
                  WorkflowMapping.samePath(b.path, entry.path),
              );
              return `<div class="node-input-item"><span class="grow ${entry.link ? "linked" : ""}" title="${esc(JSON.stringify(entry.value))}">${esc(entry.label)} <span class="wm-field-type">${entry.link ? "连线 · 只读" : entry.type}</span></span>${entry.link ? icon("shield", "sm") : existing ? ibtn("check", "wm-select", "编辑已有映射", `data-id="${esc(existing.id)}"`) : ibtn("plus", "v3-expose-input", "添加此字段", `data-node="${esc(id)}" data-path="${esc(entry.path)}"`)}</div>`;
            })
            .join("")}</details>`,
      )
      .join("") ||
    '<div class="mapping-list-empty">未找到匹配节点。试试节点 ID 或字段名。</div>'
  );
}
