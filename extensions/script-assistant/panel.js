(() => {
  "use strict";

  const session = new URLSearchParams(location.hash.slice(1)).get("mio-session");
  const channel = new MessageChannel();
  const transport = channel.port1;
  const pending = new Map();
  const $ = (id) => document.getElementById(id);
  const strings = {
    zh: {
      title: "剧本助手 · Mio", intro: "先生成建议，再逐条审阅。只有明确应用才会修改作品。",
      scriptHeading: "剧本修改", instruction: "修改意图", instructionPlaceholder: "例如：节奏更紧凑，强化第三幕反转。",
      propose: "生成提案", acceptAll: "全部接受", rejectAll: "全部拒绝", checkpoint: "创建检查点",
      apply: "创建检查点并应用所选修改", cost: "生成提案会调用已配置的文本模型；进入面板不会调用模型。",
      pacingHeading: "节奏调整", preset: "方案", presets: { auto: "自动", compact: "紧凑", lyrical: "舒展", cinematic: "电影感" },
      suggestPacing: "生成节奏建议", acceptPacingAll: "全部勾选", rejectPacingAll: "全部取消", applyPacing: "应用勾选项",
      connected: "请从具体话的扩展菜单打开面板。", writeInstruction: "填写修改意图后生成提案。",
      working: "正在处理…", proposing: "正在生成建议；这一步只生成提案，不写入作品…",
      proposalReady: "逐条勾选要接受的修改；未勾选项会保持原样。锁定分幕不可应用。",
      noChanges: "没有可审阅的修改建议。", baseRevision: "提案版本 {{base}} · 当前版本 {{current}}",
      before: "修改前", after: "修改后", blocked: "不可应用：{{reason}}", noValue: "（无）",
      opTarget: "第 {{n}} 幕 · {{id}}", notLoaded: "读取分镜后可生成建议。", loadFirst: "先打开具体话并重新进入此扩展。",
      stale: "作品已变更（提案版本 {{base}}，当前 {{current}}）。旧提案已停用，请重新生成建议。",
      checkpointBusy: "正在创建原稿检查点…", checkpointCreated: "原稿检查点已创建：{{name}}。",
      checkpointFailed: "未能创建检查点，修改没有应用。{{message}}", applyBusy: "正在应用所选修改…",
      applied: "已应用 {{count}} 条修改；其他建议保持原样。",
      conflict: "作品在审阅期间已改变。旧提案已停用，请重新生成建议。",
      uncertain: "应用状态需要核对。检查点已保留；请检查作品，再重新读取和生成建议，不要重复提交旧提案。\n{{message}}",
      requestFailed: "请求失败（{{status}}）", requestTimeout: "请求超时；请检查操作结果后再决定下一步。",
      failedProposal: "无法生成提案。检查模型配置与网络后再试。{{message}}",
      pacingNotLoaded: "尚未读取分镜。", pacingBusy: "正在分析节奏…", pacingReady: "生成 {{count}} 项建议；逐项勾选后再应用。",
      pacingEmpty: "当前分镜无需调整节奏。", pacingFailure: "无法生成节奏建议。{{message}}", pacingNoSelection: "请先选择要应用的建议。",
      pacingApplying: "正在应用节奏修改…", pacingApplied: "已应用 {{count}} 项节奏修改。", pacingStale: "分镜版本已变化；请重新生成节奏建议。",
      pacingUnknown: "节奏应用结果需要检查；已停用这批建议，请重新读取后再生成。{{message}}",
      panelMissing: "当前没有可用的分镜。", createCheckpointTitle: "剧本助手 · 应用前",
      fields: { description: "画面描述", shot: "景别", angle: "角度", characters: "角色", scene: "场景", time: "时间", lighting: "光线", tags: "标签", dialogue: "对白", signature: "角色设定", order: "分幕顺序", width_mode: "画格宽度", aspect_ratio: "画幅比例", gap_after: "下方留白", transition_background: "转场背景", inset_align: "内嵌位置" },
      reason: "原因", pacingPanel: "第 {{n}} 幕 · {{title}}",
    },
    en: {
      title: "Script assistant · Mio", intro: "Generate a proposal, then review every change. Nothing is written until you apply it.",
      scriptHeading: "Script edits", instruction: "Change request", instructionPlaceholder: "For example: tighten the pacing and strengthen the turn in scene three.",
      propose: "Generate proposal", acceptAll: "Accept all", rejectAll: "Reject all", checkpoint: "Create checkpoint",
      apply: "Create checkpoint and apply selected changes", cost: "Generating a proposal uses the configured text model. Opening this panel does not call it.",
      pacingHeading: "Pacing", preset: "Style", presets: { auto: "Automatic", compact: "Compact", lyrical: "Lyrical", cinematic: "Cinematic" },
      suggestPacing: "Suggest pacing", acceptPacingAll: "Select all", rejectPacingAll: "Clear selection", applyPacing: "Apply selected",
      connected: "Open this panel from the extension menu in a specific episode.", writeInstruction: "Enter a change request to generate a proposal.",
      working: "Working…", proposing: "Generating suggestions. This creates a proposal only; the script is unchanged…",
      proposalReady: "Select each change you want to accept. Unchecked changes stay as they are. Locked scenes cannot be changed.",
      noChanges: "There are no changes to review.", baseRevision: "Proposal revision {{base}} · current revision {{current}}",
      before: "Before", after: "After", blocked: "Cannot apply: {{reason}}", noValue: "(empty)",
      opTarget: "Scene {{n}} · {{id}}", notLoaded: "Read the storyboard before generating suggestions.", loadFirst: "Open an episode and reopen this extension.",
      stale: "The work changed (proposal {{base}}, current {{current}}). The old proposal is disabled; generate a new one.",
      checkpointBusy: "Creating a checkpoint of the original…", checkpointCreated: "Original checkpoint created: {{name}}.",
      checkpointFailed: "Could not create a checkpoint; no edits were applied. {{message}}", applyBusy: "Applying selected changes…",
      applied: "Applied {{count}} changes. Other suggestions were left as they were.",
      conflict: "The work changed during review. The old proposal is disabled; generate a new one.",
      uncertain: "Check the result before continuing. The checkpoint is saved; inspect the work, then reload and generate a new proposal. Do not resubmit the old one.\n{{message}}",
      requestFailed: "Request failed ({{status}})", requestTimeout: "Request timed out; check the result before deciding what to do next.",
      failedProposal: "Could not generate a proposal. Check model settings and network, then try again. {{message}}",
      pacingNotLoaded: "No storyboard loaded.", pacingBusy: "Reviewing pacing…", pacingReady: "{{count}} suggestions. Select the changes to apply.",
      pacingEmpty: "This storyboard does not need pacing changes.", pacingFailure: "Could not generate pacing suggestions. {{message}}", pacingNoSelection: "Select at least one suggestion to apply.",
      pacingApplying: "Applying pacing changes…", pacingApplied: "Applied {{count}} pacing changes.", pacingStale: "The storyboard changed; generate fresh pacing suggestions.",
      pacingUnknown: "Check the result. This suggestion set is disabled; reload the storyboard before generating another. {{message}}",
      panelMissing: "No storyboard is available in this panel.", createCheckpointTitle: "Script assistant · before apply",
      fields: { description: "Visual description", shot: "Shot", angle: "Angle", characters: "Characters", scene: "Scene", time: "Time", lighting: "Lighting", tags: "Tags", dialogue: "Dialogue", signature: "Character notes", order: "Scene order", width_mode: "Panel width", aspect_ratio: "Aspect ratio", gap_after: "Space after", transition_background: "Transition", inset_align: "Inset position" },
      reason: "Reason", pacingPanel: "Scene {{n}} · {{title}}",
    },
  };
  let context = null;
  let appearance = {};
  let language = "zh";
  let proposal = null;
  let episode = null;
  let checkpoint = null;
  let pacingPreview = null;
  let running = false;
  let scriptStale = false;
  let scriptApplied = false;
  let scriptUncertain = false;
  let pacingStale = false;
  let pacingApplied = false;
  let pacingUncertain = false;

  const t = (key, values = {}) => {
    let value = key.split(".").reduce((item, part) => item?.[part], strings[language]);
    if (typeof value !== "string") value = key;
    return value.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name] ?? ""));
  };
  const status = (text) => { $("status").textContent = text; };
  const errorText = (error) => error?.message || String(error || "");
  const pathEpisode = () => ({ episode_id: context.episode_id });
  const pathSeries = () => ({ series_id: episode?.series_id || context.series_id });

  function applyAppearance(next) {
    if (!next || typeof next !== "object") return;
    appearance = { ...appearance, ...next };
    const locale = String(appearance.locale || navigator.language || "zh-CN").toLowerCase();
    language = locale.startsWith("en") ? "en" : "zh";
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    const theme = String(appearance.theme || "").toLowerCase();
    if (theme.includes("dark") || theme === "墨") {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.style.colorScheme = "dark";
    }
    else if (theme.includes("light") || theme === "纸") {
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
    }
    else {
      delete document.documentElement.dataset.theme;
      document.documentElement.style.colorScheme = "light dark";
    }
    const tokens = appearance.tokens && typeof appearance.tokens === "object" ? appearance.tokens : {};
    const aliases = { bg: "bg", panel: "panel", line: "line", text: "text", muted: "muted", accent: "accent", tint: "accent-soft", red: "bad", blue: "good" };
    const color = /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.% ,/+-]+\)|[a-z]{3,20})$/iu;
    for (const [source, target] of Object.entries(aliases)) {
      const value = tokens[source] ?? tokens[`--${source}`];
      if (typeof value === "string" && value.length <= 64 && color.test(value.trim()))
        document.documentElement.style.setProperty(`--${target}`, value.trim());
    }
    renderStatic();
    if (proposal) renderProposal();
    if (pacingPreview) renderPacing();
  }

  function renderStatic() {
    const labels = {
      title: "title", intro: "intro", "script-heading": "scriptHeading", "instruction-label": "instruction",
      propose: "propose", "accept-all": "acceptAll", "reject-all": "rejectAll", checkpoint: "checkpoint", apply: "apply",
      "cost-note": "cost", "pacing-heading": "pacingHeading", "preset-label": "preset", "suggest-pacing": "suggestPacing",
      "accept-pacing-all": "acceptPacingAll", "reject-pacing-all": "rejectPacingAll", "apply-pacing": "applyPacing",
    };
    for (const [id, key] of Object.entries(labels)) {
      const node = $(id);
      if (node) node.textContent = t(key);
    }
    $("instruction").placeholder = t("instructionPlaceholder");
    $("pacing-preset").setAttribute("aria-label", t("preset"));
    for (const option of $("pacing-preset").options) option.textContent = t(`presets.${option.value}`);
    $("language").textContent = language === "en" ? "中文" : "English";
    if (!context?.episode_id) {
      $("ops").replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: t("connected") }));
      $("pacing-status").textContent = t("pacingNotLoaded");
    }
    update();
  }

  function request(requestId, payload = {}) {
    return new Promise((resolve, reject) => {
      const rid = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(rid);
        const error = new Error(t("requestTimeout"));
        error.status = 504;
        reject(error);
      }, 29000);
      pending.set(rid, { resolve, reject, timer });
      transport.postMessage({
        type: "mio:panel:request", version: 2, session, rid, request_id: requestId,
        ...(payload.path_params ? { path_params: payload.path_params } : {}),
        ...(payload.query ? { query: payload.query } : {}),
        ...(payload.body !== undefined ? { body: payload.body } : {}),
      });
    });
  }

  function printable(value) {
    if (value === undefined || value === null || value === "") return t("noValue");
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  function element(tag, text, parentNode, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    if (parentNode) parentNode.append(node);
    return node;
  }

  function difference(parentNode, title, before, after) {
    element("h3", t(`fields.${title}`), parentNode);
    const row = element("div", undefined, parentNode, "diff");
    for (const [label, value, css] of [[t("before"), before, "diff-before"], [t("after"), after, "diff-after"]]) {
      const block = element("section", undefined, row, `diff-block ${css}`);
      element("small", label, block, "diff-label");
      element("pre", printable(value), block);
    }
  }

  function selectedIds(container) {
    return [...container.querySelectorAll("input[type=checkbox]:checked")].map((input) => input.value);
  }

  function update() {
    const hasEpisode = Boolean(context?.episode_id);
    $("propose").disabled = running || !hasEpisode || !$("instruction").value.trim();
    const reviewable = Boolean(proposal?.ops?.length) && !scriptStale && !scriptApplied && !scriptUncertain;
    $("accept-all").disabled = running || !reviewable;
    $("reject-all").disabled = running || !reviewable;
    $("checkpoint").disabled = running || !reviewable;
    $("apply").disabled = running || !reviewable || !selectedIds($("ops")).length;
    for (const input of $("ops").querySelectorAll("input[type=checkbox]"))
      input.disabled = running || !reviewable || input.dataset.blocked === "true";
    $("suggest-pacing").disabled = running || !hasEpisode;
    const pacingReviewable = Boolean(pacingPreview?.suggestions?.length) && !pacingStale && !pacingApplied && !pacingUncertain;
    $("accept-pacing-all").disabled = running || !pacingReviewable;
    $("reject-pacing-all").disabled = running || !pacingReviewable;
    $("apply-pacing").disabled = running || !pacingReviewable || !selectedIds($("pacing-ops")).length;
    for (const input of $("pacing-ops").querySelectorAll("input[type=checkbox]")) input.disabled = running || !pacingReviewable;
    $("pacing-preset").disabled = running;
  }

  function renderProposal() {
    const list = $("ops");
    const checked = new Set(selectedIds(list));
    list.replaceChildren();
    $("revision").textContent = t("baseRevision", { base: proposal.base_revision, current: episode.revision });
    for (const op of proposal.ops || []) {
      const article = element("article", undefined, list);
      const label = element("label", undefined, article);
      const input = element("input", undefined, label);
      input.type = "checkbox";
      input.value = op.id;
      input.checked = checked.has(op.id);
      input.dataset.blocked = String(Boolean(op.blocked));
      input.addEventListener("change", update);
      const panel = episode.panels?.find((item) => item.id === op.target);
      const prefix = panel ? t("opTarget", { n: panel.order + 1, id: op.target }) : op.target;
      element("strong", `${prefix} · ${op.summary || op.op}`, label);
      element("small", `${op.target} · ${op.id}`, article, "op-meta");
      if (op.blocked) element("p", t("blocked", { reason: op.blocked }), article, "op-blocked");
      if (op.changes) {
        for (const [field, pair] of Object.entries(op.changes)) {
          if (field === "dialogue") {
            const [before, after] = pair;
            for (let index = 0; index < Math.max(before?.length ?? 0, after?.length ?? 0); index++)
              difference(article, "dialogue", before?.[index], after?.[index]);
          } else difference(article, field, pair?.[0], pair?.[1]);
        }
      } else {
        const oldOrder = op.before ?? (op.op === "reorder" ? episode.panels.map((panel) => panel.id) : undefined);
        difference(article, op.op === "reorder" ? "order" : op.op, oldOrder, op.after ?? op.order);
      }
    }
    if (!proposal.ops?.length) element("p", t("noChanges"), list, "empty");
    update();
  }

  async function act(action) {
    if (running) return;
    running = true;
    update();
    try { await action(); }
    catch (error) { status(errorText(error)); }
    finally { running = false; update(); }
  }

  async function createCheckpointForProposal() {
    const fresh = await request("episode", { path_params: pathEpisode() });
    episode = fresh;
    $("revision").textContent = t("baseRevision", { base: proposal.base_revision, current: fresh.revision });
    if (fresh.revision !== proposal.base_revision) {
      scriptStale = true;
      throw new Error(t("stale", { base: proposal.base_revision, current: fresh.revision }));
    }
    const head = await request("work-head", { path_params: pathSeries() });
    const created = await request("checkpoint", {
      path_params: pathSeries(),
      body: { name: t("createCheckpointTitle"), expected_head: head.head },
    });
    checkpoint = { id: created.id, name: created.name, revision: fresh.revision, head: created.head };
    $("checkpoint-state").textContent = t("checkpointCreated", { name: created.name });
    const verify = await request("episode", { path_params: pathEpisode() });
    episode = verify;
    if (verify.revision !== proposal.base_revision) {
      scriptStale = true;
      throw new Error(t("stale", { base: proposal.base_revision, current: verify.revision }));
    }
    return checkpoint;
  }

  $("language").addEventListener("click", () => applyAppearance({ locale: language === "en" ? "zh-CN" : "en" }));
  $("instruction").addEventListener("input", update);
  $("propose").addEventListener("click", () => act(async () => {
    proposal = checkpoint = null;
    scriptStale = scriptApplied = scriptUncertain = false;
    $("checkpoint-state").textContent = "";
    $("ops").replaceChildren();
    $("revision").textContent = "";
    status(t("proposing"));
    try {
      episode = await request("episode", { path_params: pathEpisode() });
      if (!episode.panels?.length) {
        proposal = { base_revision: episode.revision, ops: [] };
        renderProposal();
        status(t("panelMissing"));
        return;
      }
      proposal = await request("propose", { path_params: pathEpisode(), body: { instruction: $("instruction").value.trim() } });
      renderProposal();
      status(t("proposalReady"));
    } catch (error) {
      proposal = null;
      $("ops").replaceChildren();
      status(t("failedProposal", { message: errorText(error) }));
    }
  }));

  for (const [id, checked] of [["accept-all", true], ["reject-all", false]])
    $(id).addEventListener("click", () => {
      for (const input of $("ops").querySelectorAll("input:not(:disabled)")) input.checked = checked;
      update();
    });

  $("checkpoint").addEventListener("click", () => act(async () => {
    status(t("checkpointBusy"));
    try { await createCheckpointForProposal(); status(t("checkpointCreated", { name: checkpoint.name })); }
    catch (error) {
      if (error.status !== 409 && !scriptStale) $("checkpoint-state").textContent = t("checkpointFailed", { message: errorText(error) });
      throw error;
    }
  }));

  $("apply").addEventListener("click", () => act(async () => {
    const accepted = selectedIds($("ops"));
    if (!accepted.length || scriptStale || scriptApplied || scriptUncertain) return;
    status(t("applyBusy"));
    let cp;
    try { cp = checkpoint?.revision === proposal.base_revision ? checkpoint : await createCheckpointForProposal(); }
    catch (error) {
      if (error.status !== 409 && !scriptStale) $("checkpoint-state").textContent = t("checkpointFailed", { message: errorText(error) });
      throw error;
    }
    // Recheck the episode CAS after the checkpoint is safely stored. Apply itself also checks
    // the revision transactionally, so a race here can never write against a stale proposal.
    const fresh = await request("episode", { path_params: pathEpisode() });
    episode = fresh;
    $("revision").textContent = t("baseRevision", { base: proposal.base_revision, current: fresh.revision });
    if (fresh.revision !== proposal.base_revision) {
      scriptStale = true;
      status(t("stale", { base: proposal.base_revision, current: fresh.revision }));
      update();
      return;
    }
    try {
      const result = await request("apply", {
        path_params: pathEpisode(),
        body: { ops: proposal.ops, accepted, base_revision: proposal.base_revision },
      });
      scriptApplied = true;
      $("revision").textContent = t("baseRevision", { base: proposal.base_revision, current: result.revision });
      $("checkpoint-state").textContent = t("checkpointCreated", { name: cp.name });
      status(t("applied", { count: result.applied.length }));
    } catch (error) {
      if (error.status === 409) {
        scriptStale = true;
        status(t("conflict"));
      } else {
        scriptUncertain = true;
        status(t("uncertain", { message: errorText(error) }));
      }
    }
  }));

  function renderPacing() {
    const list = $("pacing-ops");
    const checked = new Set(selectedIds(list));
    list.replaceChildren();
    for (const [index, suggestion] of (pacingPreview.suggestions || []).entries()) {
      const panel = episode.panels?.find((item) => item.id === suggestion.panel_id);
      const wrapper = element("div", undefined, list, "pacing-item");
      const check = element("input", undefined, wrapper);
      check.type = "checkbox";
      check.value = suggestion.panel_id;
      check.checked = checked.has(suggestion.panel_id);
      check.addEventListener("change", update);
      const content = element("div", undefined, wrapper);
      const title = element("strong", t("pacingPanel", { n: (panel?.order ?? suggestion.order) + 1, title: panel?.description || suggestion.panel_id }), content);
      title.id = `pacing-title-${index}`;
      check.setAttribute("aria-labelledby", title.id);
      if (suggestion.reasons?.length) element("p", `${t("reason")}: ${suggestion.reasons.join(" · ")}`, content, "subtle");
      const changes = element("div", undefined, content, "pacing-changes");
      for (const [field, after] of Object.entries(suggestion.changes || {})) {
        const block = element("div", undefined, changes, "pacing-change");
        element("strong", t(`fields.${field}`), block);
        element("div", `${t("before")}: ${printable(panel?.[field])}`, block);
        element("div", `${t("after")}: ${printable(after)}`, block);
      }
    }
    if (!pacingPreview.suggestions?.length) element("p", t("pacingEmpty"), list, "empty");
    update();
  }

  $("suggest-pacing").addEventListener("click", () => act(async () => {
    pacingPreview = null;
    pacingStale = pacingApplied = pacingUncertain = false;
    $("pacing-ops").replaceChildren();
    $("pacing-status").textContent = t("pacingBusy");
    try {
      episode = await request("episode", { path_params: pathEpisode() });
      if (!episode.panels?.length) {
        pacingPreview = { revision: episode.revision, suggestions: [] };
        renderPacing();
        $("pacing-status").textContent = t("panelMissing");
        return;
      }
      pacingPreview = await request("pacing-suggest", { path_params: pathEpisode(), query: { preset: $("pacing-preset").value } });
      renderPacing();
      $("pacing-status").textContent = t(pacingPreview.suggestions?.length ? "pacingReady" : "pacingEmpty", { count: pacingPreview.suggestions?.length ?? 0 });
    } catch (error) {
      pacingPreview = null;
      $("pacing-ops").replaceChildren();
      $("pacing-status").textContent = t("pacingFailure", { message: errorText(error) });
    }
  }));

  for (const [id, checked] of [["accept-pacing-all", true], ["reject-pacing-all", false]])
    $(id).addEventListener("click", () => {
      for (const input of $("pacing-ops").querySelectorAll("input:not(:disabled)")) input.checked = checked;
      update();
    });

  $("apply-pacing").addEventListener("click", () => act(async () => {
    const accepted = new Set(selectedIds($("pacing-ops")));
    if (!accepted.size || pacingStale || pacingApplied || pacingUncertain) {
      $("pacing-status").textContent = t("pacingNoSelection");
      return;
    }
    $("pacing-status").textContent = t("pacingApplying");
    const patches = pacingPreview.suggestions.filter((item) => accepted.has(item.panel_id)).map(({ panel_id, changes }) => ({ panel_id, changes }));
    try {
      episode = await request("pacing-apply", { path_params: pathEpisode(), body: { base_revision: pacingPreview.revision, patches } });
      pacingApplied = true;
      $("pacing-status").textContent = t("pacingApplied", { count: patches.length });
    } catch (error) {
      if (error.status === 409) {
        pacingStale = true;
        $("pacing-status").textContent = t("pacingStale");
      } else {
        pacingUncertain = true;
        $("pacing-status").textContent = t("pacingUnknown", { message: errorText(error) });
      }
    }
  }));

  $("pacing-preset").addEventListener("change", () => {
    pacingPreview = null;
    $("pacing-ops").replaceChildren();
    $("pacing-status").textContent = t("pacingNotLoaded");
    update();
  });

  transport.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.version !== 2 || message.session !== session) return;
    if (message.type === "mio:panel:init") {
      context = message.context || {};
      applyAppearance(message.appearance || {});
      status(context.episode_id ? t("writeInstruction") : t("panelMissing"));
      update();
    }
    if (message.type === "mio:panel:appearance") applyAppearance(message.appearance || {});
    if (message.type === "mio:panel:response") {
      const waiting = pending.get(message.rid);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.delete(message.rid);
      if (message.ok) waiting.resolve(message.data);
      else {
        const error = new Error(typeof message.data?.detail === "string" ? message.data.detail : t("requestFailed", { status: message.status }));
        error.status = message.status;
        waiting.reject(error);
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && running) event.preventDefault();
  });
  addEventListener("pagehide", () => {
    for (const value of pending.values()) clearTimeout(value.timer);
    pending.clear();
    transport.close();
  });
  transport.start();
  parent.postMessage(
    { type: "mio:panel:ready", version: 2, session },
    "*",
    [channel.port2],
  );
  applyAppearance({ locale: navigator.language || "zh-CN" });
})();
