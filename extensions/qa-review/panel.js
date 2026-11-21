"use strict";

const session = new URLSearchParams(location.hash.slice(1)).get("mio-session");
const pending = new Map();
const media = new Map();
const $ = (id) => document.getElementById(id);
const messages = {
  zh: {
    eyebrow: "候选工作台",
    title: "智能质检与辅助挑图",
    intro:
      "评审使用已配置的视觉模型，可能消耗额度。审查本身不会更改采用状态；采纳与拒绝均需明确操作。",
    load: "读取候选",
    reviewSelected: "评审所选",
    reviewEpisode: "评审整话",
    refresh: "刷新任务",
    adoptTop: "采纳每幕最高分",
    filterLabel: "严重度筛选",
    filterAll: "全部",
    filterHigh: "高",
    filterMedium: "中",
    filterLow: "低",
    filterNote:
      "严重度由本地按通过状态和分数归类；后端问题记录没有严重度字段。",
    connecting: "正在连接面板…",
    openFirst: "点击读取候选和报告。",
    openEpisode: "请从具体话页面打开面板。",
    reading: "正在读取候选…",
    loaded: "评审报告已更新。",
    panelsNone: "本话还没有分幕。",
    takesNone: "本幕还没有候选图。",
    noMatches: "没有符合当前筛选条件的候选。",
    noReport: "尚未评审",
    noVotes: "评审跳过了角色一致性；无综合评分。",
    passed: "通过",
    failed: "待复核",
    adopted: "已采用",
    rejected: "已拒绝",
    candidate: "候选",
    locked: "已锁定",
    severityHigh: "高 · 推算",
    severityMedium: "中 · 推算",
    severityLow: "低 · 推算",
    severityUnknown: "未评审",
    score: "综合评分",
    votes: "票",
    model: "模型",
    checked: "时间",
    adopt: "采纳",
    reject: "拒绝",
    preview: "预览图片",
    hidePreview: "收起预览",
    locating: "点击问题定位",
    reviewConfirm: (count) =>
      `将提交 ${count} 张候选给已配置的视觉模型。此操作可能消耗额度，且不会自动采纳。继续？`,
    batchConfirm: (count) =>
      `将逐幕采纳 ${count} 张当前最高分候选。无法一次撤销；继续？`,
    reviewing: "正在提交评审；失败时不会自动重试。",
    queued: "任务已提交；刷新可查看进度。相同选择重试会沿用幂等键。",
    batchDone: (done, skipped) =>
      `已采纳 ${done} 张。${skipped ? `跳过 ${skipped} 幕（没有已评分候选或已锁定）。` : ""}`,
    actionDone: "状态已更新。",
    partial: (done, error) => `已完成 ${done} 项；随后失败：${error}`,
    timeout: "请求超时。请先刷新任务状态，再明确决定是否重试。",
    job: (id, state, done, total) => `任务 ${id} · ${state} · ${done}/${total}`,
    failures: "部分任务失败：",
    noIssues: "当前结果没有符合筛选条件的问题。",
    loadError: "读取失败：",
    character: (id, score, missing) =>
      `角色 ${id}：一致性 ${score}/5${missing.length ? `；缺失：${missing.join("、")}` : ""}`,
    metric: (title, result) =>
      `${title}：${result === true ? "通过" : result === false ? "待复核" : "未评估"}`,
    shot: "镜头 / 场景",
    people: "出场人物",
    action: "动作",
    emptySelection: "请先选择候选。",
    counts: (panels, takes) => `${panels} 幕 · ${takes} 张候选`,
    lockedSkip: "已锁定，跳过人工批量采纳。",
    loadingImage: "正在读取图片…",
    imageError: "图片预览不可用。",
    removeSelection: "清除所选",
  },
  en: {
    eyebrow: "Take review",
    title: "Quality review",
    intro:
      "Reviews use your configured vision model and may incur usage. Reviewing never changes adoption; adopt or reject explicitly.",
    load: "Load takes",
    reviewSelected: "Review selected",
    reviewEpisode: "Review episode",
    refresh: "Refresh job",
    adoptTop: "Adopt top score per panel",
    filterLabel: "Severity filter",
    filterAll: "All",
    filterHigh: "High",
    filterMedium: "Medium",
    filterLow: "Low",
    filterNote:
      "Severity is inferred locally from pass status and score; the backend does not provide a severity field.",
    connecting: "Connecting panel…",
    openFirst: "Load candidates and reports to begin.",
    openEpisode: "Open this panel from an episode page.",
    reading: "Loading candidates…",
    loaded: "Review report updated.",
    panelsNone: "This episode has no panels.",
    takesNone: "No candidate images for this panel.",
    noMatches: "No candidates match this filter.",
    noReport: "Not reviewed",
    noVotes: "Character review was skipped; no overall score.",
    passed: "Pass",
    failed: "Review",
    adopted: "Adopted",
    rejected: "Rejected",
    candidate: "Candidate",
    locked: "Locked",
    severityHigh: "High · inferred",
    severityMedium: "Medium · inferred",
    severityLow: "Low · inferred",
    severityUnknown: "Unreviewed",
    score: "Score",
    votes: "votes",
    model: "Model",
    checked: "Checked",
    adopt: "Adopt",
    reject: "Reject",
    preview: "Preview image",
    hidePreview: "Hide preview",
    locating: "Click an issue to locate",
    reviewConfirm: (count) =>
      `Submit ${count} take(s) to your configured vision model? This may incur usage and will not auto-adopt.`,
    batchConfirm: (count) =>
      `Adopt the current highest-scoring take in ${count} panel(s)? This batch cannot be undone in one step.`,
    reviewing:
      "Submitting review; failed requests are not retried automatically.",
    queued:
      "Review queued. Refresh to check progress. Retrying the same selection reuses its idempotency key.",
    batchDone: (done, skipped) =>
      `Adopted ${done} take(s).${skipped ? ` Skipped ${skipped} panel(s) with no scored candidate or locked panels.` : ""}`,
    actionDone: "Take status updated.",
    partial: (done, error) =>
      `Completed ${done} action(s), then failed: ${error}`,
    timeout:
      "Request timed out. Refresh job status before deciding whether to retry.",
    job: (id, state, done, total) => `Job ${id} · ${state} · ${done}/${total}`,
    failures: "Some job items failed: ",
    noIssues: "No issues match this filter.",
    loadError: "Could not load: ",
    character: (id, score, missing) =>
      `Character ${id}: consistency ${score}/5${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    metric: (title, result) =>
      `${title}: ${result === true ? "Pass" : result === false ? "Review" : "Not assessed"}`,
    shot: "Shot / scene",
    people: "Cast",
    action: "Action",
    emptySelection: "Select at least one candidate.",
    counts: (panels, takes) => `${panels} panel(s) · ${takes} take(s)`,
    lockedSkip: "Locked; skipped from batch adoption.",
    loadingImage: "Loading image…",
    imageError: "Image preview is unavailable.",
    removeSelection: "Clear selection",
  },
};

let context = null;
let attempt = null;
let jobId = null;
let episode = null;
let running = false;
const selectedIds = new Set();
let locale = navigator.language?.toLowerCase().startsWith("en") ? "en" : "zh";
let t = messages[locale];

function request(requestId, payload = {}, kind = "json") {
  return new Promise((resolve, reject) => {
    const rid = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(rid);
      reject(new Error(t.timeout));
    }, 32000);
    pending.set(rid, { resolve, reject, timer, kind });
    parent.postMessage(
      {
        type: "mio:panel:request",
        version: 1,
        session,
        rid,
        request_id: requestId,
        ...payload,
      },
      "*",
    );
  });
}

function selected() {
  return [...selectedIds];
}

function update() {
  const validEpisode = !!context?.episode_id;
  $("load").disabled = running || !validEpisode;
  $("review-selected").disabled = running || selected().length === 0;
  $("review-episode").disabled =
    running ||
    !episode ||
    !(episode.takes ?? []).some((take) => take.status !== "rejected");
  $("refresh-job").disabled = running || !jobId;
  $("adopt-top").disabled = running || !episode || !rankedTakes().length;
}

function element(tag, text, parentNode, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  if (parentNode) parentNode.append(node);
  return node;
}

function severityOf(qa) {
  if (!qa || !qa.votes) return "high";
  if (!qa.passed && qa.score < 0.5) return "high";
  if (!qa.passed || qa.score < 0.75) return "medium";
  return "low";
}

function rankedTakes() {
  if (!episode) return [];
  return (episode.panels ?? []).flatMap((panel) => {
    if (panel.locked) return [];
    const candidates = (episode.takes ?? []).filter(
      (take) =>
        take.panel_id === panel.id &&
        take.status !== "rejected" &&
        take.qa &&
        take.qa.votes > 0,
    );
    const best = candidates.sort(
      (a, b) =>
        b.qa.score - a.qa.score ||
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0];
    return best ? [{ panel, take: best }] : [];
  });
}

function makeAttempt(ids) {
  if (
    !attempt ||
    JSON.stringify([...attempt.take_ids].sort()) !==
      JSON.stringify([...ids].sort())
  ) {
    attempt = {
      take_ids: ids,
      votes: 3,
      auto_adopt: false,
      idempotency_key: `qa-review-${crypto.randomUUID()}`,
    };
  }
  return attempt;
}

function clearImages() {
  for (const [mediaId, value] of media) {
    if (value.url) URL.revokeObjectURL(value.url);
    value.port?.close();
    parent.postMessage(
      { type: "mio:panel:release", version: 1, session, media_id: mediaId },
      "*",
    );
  }
  media.clear();
}

function applyAppearance(value) {
  const colors = value?.tokens;
  if (colors && typeof colors === "object") {
    for (const [key, color] of Object.entries(colors)) {
      const cssKey = key.startsWith("--") ? key : `--${key}`;
      if (
        /^--[a-z0-9-]+$/.test(cssKey) &&
        typeof color === "string" &&
        color.length < 160
      ) {
        document.documentElement.style.setProperty(cssKey, color);
      }
    }
  }
  if (value?.theme === "light" || value?.theme === "dark")
    document.documentElement.dataset.theme = value.theme;
  else if (value?.theme) delete document.documentElement.dataset.theme;
  if (typeof value?.locale === "string") {
    locale = value.locale.toLowerCase().startsWith("en") ? "en" : "zh";
    t = messages[locale];
  }
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const text = t[node.dataset.i18n];
    if (typeof text === "string") node.textContent = text;
  }
}

function renderScore(qa, target) {
  if (!qa) {
    element("p", t.noReport, target, "muted");
    return;
  }
  if (!qa.votes) {
    element("p", t.noVotes, target, "muted");
    return;
  }
  element(
    "p",
    `${qa.passed ? t.passed : t.failed} · ${t.score} ${Math.round(qa.score * 100)}/100 · ${qa.votes} ${t.votes}`,
    target,
    "score",
  );
  const list = element("ul", undefined, target);
  for (const identity of qa.identity ?? []) {
    element(
      "li",
      t.character(
        identity.character_id,
        identity.score,
        identity.missing ?? [],
      ),
      list,
    );
  }
  for (const [field, title] of [
    ["shot_ok", t.shot],
    ["characters_ok", t.people],
    ["action_ok", t.action],
  ]) {
    if (field in qa) element("li", t.metric(title, qa[field]), list);
  }
  for (const issue of qa.issues ?? []) element("li", issue, list);
  const meta = [
    qa.model ? `${t.model}: ${qa.model}` : "",
    qa.checked_at ? `${t.checked}: ${qa.checked_at}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (meta) element("small", meta, target);
}

async function loadImage(image, assetId, button) {
  if (!assetId) {
    image.alt = t.imageError;
    return;
  }
  button.disabled = true;
  button.textContent = t.loadingImage;
  try {
    const value = await request(
      "image",
      { path_params: { asset_id: assetId } },
      "image",
    );
    media.set(value.media_id, value);
    image.dataset.url = value.url;
    image.src = value.url;
    image.alt = t.preview;
    button.textContent = t.hidePreview;
    button.dataset.open = "true";
  } catch {
    image.alt = t.imageError;
    image.dataset.error = "true";
    button.textContent = t.preview;
    button.setAttribute("aria-label", t.imageError);
  } finally {
    button.disabled = false;
  }
}

function renderEpisode(value) {
  const chosen = new Set(selectedIds);
  episode = value;
  const existingIds = new Set((value.takes ?? []).map((take) => take.id));
  for (const id of selectedIds)
    if (!existingIds.has(id)) selectedIds.delete(id);
  clearImages();
  $("takes").replaceChildren();
  $("issues").replaceChildren();
  const panels = [...(value.panels ?? [])].sort((a, b) => a.order - b.order);
  const takes = value.takes ?? [];
  $("episode-count").textContent = t.counts(panels.length, takes.length);
  if (!panels.length) {
    element("p", t.panelsNone, $("takes"), "empty");
    update();
    return;
  }
  const issues = [];
  let shown = 0;
  const filter = $("severity-filter").value;
  for (const panel of panels) {
    const candidates = takes.filter((take) => take.panel_id === panel.id);
    const card = element("article", undefined, $("takes"), "panel-card");
    card.id = `panel-${panel.id}`;
    card.tabIndex = -1;
    const header = element("header", undefined, card);
    element(
      "h2",
      `${locale === "en" ? "Panel" : "第"} ${panel.order + 1}${locale === "en" ? "" : "幕"}${panel.locked ? ` · ${t.locked}` : ""}`,
      header,
    );
    element(
      "span",
      `${candidates.length} ${locale === "en" ? "take(s)" : "张候选"}`,
      header,
      "panel-meta",
    );
    if (panel.description)
      element("p", panel.description, card, "panel-description");
    if (!candidates.length) {
      element("p", t.takesNone, card, "empty");
      continue;
    }
    const grid = element("div", undefined, card, "candidate-list");
    for (const take of candidates) {
      const severity = severityOf(take.qa);
      if (filter !== "all" && severity !== filter) continue;
      shown++;
      const candidate = element("section", undefined, grid, "candidate");
      candidate.dataset.severity = severity;
      const row = element("div", undefined, candidate, "candidate-head");
      const label = element("label", undefined, row, "candidate-select");
      const input = element("input", undefined, label);
      input.type = "checkbox";
      input.value = take.id;
      input.dataset.takeId = take.id;
      input.checked = chosen.has(take.id);
      input.disabled = take.status === "rejected";
      input.addEventListener("change", () => {
        if (input.checked) selectedIds.add(take.id);
        else selectedIds.delete(take.id);
        attempt = null;
        update();
      });
      const status =
        take.status === "adopted"
          ? t.adopted
          : take.status === "rejected"
            ? t.rejected
            : t.candidate;
      element("span", `${take.stage ?? "draft"} · ${status}`, label);
      const severityTitle =
        !take.qa || !take.qa.votes
          ? t.severityUnknown
          : t[`severity${severity[0].toUpperCase()}${severity.slice(1)}`];
      element("span", severityTitle, row, "severity");
      renderScore(take.qa, candidate);
      if (take.qa?.issues?.length) {
        for (const issue of take.qa.issues)
          issues.push({ panel, issue, card, severity });
      } else if (!take.qa || !take.qa.votes || take.qa.passed === false) {
        issues.push({
          panel,
          issue: !take.qa || !take.qa.votes ? t.noReport : t.failed,
          card,
          severity,
        });
      }
      const actions = element("div", undefined, candidate, "candidate-actions");
      const previewButton = element("button", t.preview, actions);
      previewButton.type = "button";
      previewButton.setAttribute("aria-label", t.preview);
      previewButton.setAttribute("aria-expanded", "false");
      const image = element("img", undefined, candidate, "preview");
      image.hidden = true;
      previewButton.addEventListener("click", () => {
        if (previewButton.dataset.open === "true") {
          image.hidden = true;
          image.removeAttribute("src");
          previewButton.dataset.open = "false";
          previewButton.setAttribute("aria-expanded", "false");
          previewButton.textContent = t.preview;
          previewButton.setAttribute("aria-label", t.preview);
          return;
        }
        image.hidden = false;
        previewButton.setAttribute("aria-expanded", "true");
        if (image.dataset.url) {
          image.src = image.dataset.url;
          previewButton.dataset.open = "true";
          previewButton.textContent = t.hidePreview;
          previewButton.setAttribute("aria-label", t.hidePreview);
          return;
        }
        void loadImage(image, take.asset_id, previewButton);
      });
      if (take.status !== "adopted") {
        const adopt = element("button", t.adopt, actions, "adopt");
        adopt.type = "button";
        adopt.setAttribute("aria-label", `${t.adopt}: ${take.id}`);
        adopt.addEventListener(
          "click",
          () => void mutateTake("adopt", take.id),
        );
      }
      if (take.status !== "rejected") {
        const reject = element("button", t.reject, actions, "reject");
        reject.type = "button";
        reject.setAttribute("aria-label", `${t.reject}: ${take.id}`);
        reject.addEventListener(
          "click",
          () => void mutateTake("reject", take.id),
        );
      }
    }
    if (!grid.children.length) card.remove();
  }
  if (!shown) element("p", t.noMatches, $("takes"), "empty");
  const matchedIssues = issues.filter(
    (item) => filter === "all" || item.severity === filter,
  );
  if (matchedIssues.length) {
    element("h2", t.locating, $("issues"));
    const list = element("ul", undefined, $("issues"), "issue-list");
    for (const item of matchedIssues) {
      const li = element("li", undefined, list);
      const button = element(
        "button",
        `${locale === "en" ? "Panel" : "第"} ${item.panel.order + 1}${locale === "en" ? "" : "幕"}: ${item.issue}`,
        li,
      );
      button.type = "button";
      button.addEventListener("click", () => {
        item.card.scrollIntoView({ block: "start" });
        item.card.focus({ preventScroll: true });
      });
    }
  }
  update();
}

async function readEpisode() {
  if (!context?.episode_id) throw new Error(t.openEpisode);
  const value = await request("episode", {
    path_params: { episode_id: context.episode_id },
  });
  renderEpisode(value);
}

async function act(action) {
  if (running) return;
  running = true;
  update();
  $("status").classList.remove("error");
  try {
    await action();
  } catch (error) {
    $("status").textContent = `${t.loadError}${error?.message ?? error}`;
    $("status").classList.add("error");
  } finally {
    running = false;
    update();
  }
}

async function mutateTake(action, takeId) {
  await act(async () => {
    const requestId = action === "adopt" ? "adopt" : "reject";
    await request(requestId, {
      path_params: { episode_id: context.episode_id, take_id: takeId },
    });
    await readEpisode();
    $("status").textContent = t.actionDone;
  });
}

$("load").addEventListener(
  "click",
  () =>
    void act(async () => {
      $("status").textContent = t.reading;
      await readEpisode();
      $("status").textContent = t.loaded;
    }),
);

$("review-selected").addEventListener(
  "click",
  () =>
    void act(async () => {
      const ids = selected();
      if (!ids.length) {
        $("status").textContent = t.emptySelection;
        return;
      }
      if (!window.confirm(t.reviewConfirm(ids.length))) return;
      makeAttempt(ids);
      $("status").textContent = t.reviewing;
      const job = await request("review", {
        path_params: { episode_id: context.episode_id },
        body: attempt,
      });
      jobId = job.id;
      $("job").textContent =
        `${t.job(job.id, job.state, 0, job.items?.length ?? ids.length)}`;
      $("status").textContent = t.queued;
    }),
);

$("review-episode").addEventListener(
  "click",
  () =>
    void act(async () => {
      const ids = (episode?.takes ?? [])
        .filter((take) => take.status !== "rejected")
        .map((take) => take.id);
      if (!ids.length) return;
      if (!window.confirm(t.reviewConfirm(ids.length))) return;
      makeAttempt(ids);
      $("status").textContent = t.reviewing;
      const job = await request("review", {
        path_params: { episode_id: context.episode_id },
        body: attempt,
      });
      jobId = job.id;
      $("job").textContent = t.job(
        job.id,
        job.state,
        0,
        job.items?.length ?? ids.length,
      );
      $("status").textContent = t.queued;
    }),
);

$("refresh-job").addEventListener(
  "click",
  () =>
    void act(async () => {
      const job = await request("job", { path_params: { job_id: jobId } });
      const items = job.items ?? [];
      const done = items.filter((item) => item.state === "complete").length;
      $("job").textContent = t.job(job.id, job.state, done, items.length);
      const failures = items
        .filter((item) => item.error)
        .map((item) =>
          typeof item.error === "string"
            ? item.error
            : JSON.stringify(item.error),
        );
      await readEpisode();
      $("status").textContent = failures.length
        ? `${t.failures}${failures.join("\n")}`
        : t.loaded;
    }),
);

$("severity-filter").addEventListener("change", () => {
  if (episode) renderEpisode(episode);
});

$("adopt-top").addEventListener(
  "click",
  () =>
    void act(async () => {
      const selectedTakes = rankedTakes();
      if (
        !selectedTakes.length ||
        !window.confirm(t.batchConfirm(selectedTakes.length))
      )
        return;
      let done = 0;
      try {
        for (const { panel, take } of selectedTakes) {
          await request("adopt", {
            path_params: { episode_id: context.episode_id, take_id: take.id },
          });
          done++;
        }
      } catch (error) {
        await readEpisode();
        $("status").textContent = t.partial(done, error?.message ?? error);
        $("status").classList.add("error");
        return;
      }
      await readEpisode();
      const skipped = (episode?.panels ?? []).length - selectedTakes.length;
      $("status").textContent = t.batchDone(done, skipped);
    }),
);

addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== parent ||
    !message ||
    message.version !== 1 ||
    message.session !== session
  )
    return;
  if (message.type === "mio:panel:init") {
    context = message.context;
    applyAppearance(message.appearance ?? message.context);
    $("status").textContent = context?.episode_id ? t.openFirst : t.openEpisode;
    update();
  }
  if (message.type === "mio:panel:appearance") {
    applyAppearance(message.appearance);
    if (episode) renderEpisode(episode);
  }
  if (message.type === "mio:panel:response") {
    const waiting = pending.get(message.rid);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.delete(message.rid);
    if (message.ok) waiting.resolve(message.data);
    else
      waiting.reject(
        new Error(
          typeof message.data?.detail === "string"
            ? `${message.status}: ${message.data.detail}`
            : `HTTP ${message.status}`,
        ),
      );
  }
  if (message.type === "mio:panel:media") {
    const port = event.ports?.[0];
    const waiting = pending.get(message.rid);
    if (!port || !waiting || waiting.kind !== "image") {
      port?.close();
      return;
    }
    const value = { port, url: null, media_id: message.media_id };
    media.set(message.media_id, value);
    port.onmessage = (mediaEvent) => {
      if (mediaEvent.data?.type === "revoke") {
        pending.delete(message.rid);
        clearTimeout(waiting.timer);
        waiting.reject(new Error(t.imageError));
        return;
      }
      if (
        mediaEvent.data?.type !== "image" ||
        !(mediaEvent.data.blob instanceof Blob)
      )
        return;
      clearTimeout(waiting.timer);
      pending.delete(message.rid);
      value.url = URL.createObjectURL(mediaEvent.data.blob);
      waiting.resolve(value);
    };
    port.start();
  }
});

addEventListener("pagehide", () => {
  clearImages();
  for (const value of pending.values()) {
    clearTimeout(value.timer);
    value.reject(new Error(t.imageError));
  }
  pending.clear();
});
parent.postMessage({ type: "mio:panel:ready", version: 1, session }, "*");
