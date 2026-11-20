"use strict";

const session = new URLSearchParams(location.hash.slice(1)).get("mio-session");
const pending = new Map();
const $ = (id) => document.getElementById(id);
let context = null;
let attempt = null;
let jobId = null;
let episode = null;
let running = false;

function request(request_id, payload = {}) {
  return new Promise((resolve, reject) => {
    const rid = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(rid);
      reject(new Error("请求超时，请先检查任务状态，再决定是否重试。"));
    }, 32000);
    pending.set(rid, { resolve, reject, timer });
    parent.postMessage(
      {
        type: "mio:panel:request",
        version: 1,
        session,
        rid,
        request_id,
        ...payload,
      },
      "*",
    );
  });
}

function selected() {
  return [...$("takes").querySelectorAll("input:checked")].map(
    (input) => input.value,
  );
}

function update() {
  $("load").disabled = running || !context?.episode_id;
  $("review").disabled = running || selected().length === 0;
  $("refresh-job").disabled = running || !jobId;
}

function element(tag, text, parentNode) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (parentNode) parentNode.append(node);
  return node;
}

function checklist(qa, target) {
  const list = element("ul", undefined, target);
  for (const identity of qa.identity ?? []) {
    const passed = identity.score >= 4 && !identity.missing?.length;
    element(
      "li",
      `${passed ? "通过" : "待修正"} · ${identity.character_id}：一致性 ${identity.score}/5${identity.missing?.length ? `；缺失：${identity.missing.join("、")}` : ""}`,
      list,
    );
  }
  for (const [field, title] of [
    ["shot_ok", "镜头 / 场景"],
    ["characters_ok", "出场人数"],
    ["action_ok", "动作"],
  ]) {
    const result = qa[field];
    element(
      "li",
      `${title}：${result === true ? "通过" : result === false ? "待修正" : "未评估"}`,
      list,
    );
  }
}

function renderEpisode(value) {
  const chosen = new Set(selected());
  episode = value;
  $("takes").replaceChildren();
  $("issues").replaceChildren();
  const problems = [];
  for (const panel of [...(value.panels ?? [])].sort(
    (a, b) => a.order - b.order,
  )) {
    const candidates = (value.takes ?? []).filter(
      (take) => take.panel_id === panel.id,
    );
    const hasProblem =
      !candidates.length ||
      candidates.some((take) => !take.qa?.passed || !take.qa?.votes);
    if ($("problems-only").checked && !hasProblem) continue;
    const article = element("article", undefined, $("takes"));
    article.id = `panel-${panel.id}`;
    article.tabIndex = -1;
    element(
      "h2",
      `第 ${panel.order + 1} 幕${panel.locked ? " · 已锁定" : ""}`,
      article,
    );
    if (panel.description) element("p", panel.description, article);
    if (!candidates.length) element("p", "本幕还没有候选图。", article);
    for (const take of candidates) {
      const card = element("section", undefined, article);
      card.className = "candidate";
      const label = element("label", undefined, card);
      const input = element("input", undefined, label);
      input.type = "checkbox";
      input.value = take.id;
      input.checked = chosen.has(take.id);
      input.addEventListener("change", () => {
        attempt = null;
        update();
      });
      element(
        "strong",
        `${take.stage} · ${take.status === "adopted" ? "已采用" : take.status === "rejected" ? "已弃用" : "候选"}`,
        label,
      );
      element("small", take.id, card);
      const qa = take.qa;
      if (!qa) {
        element("p", "尚未评审；没有可用评分。", card);
        problems.push([panel, "尚未评审", article]);
        continue;
      }
      if (!qa.votes) {
        element("p", "未实际执行角色一致性评审；不展示综合评分。", card);
      } else {
        element(
          "p",
          `${qa.passed ? "通过" : "待修正"} · 综合评分 ${Math.round(qa.score * 100)}/100 · ${qa.votes} 票`,
          card,
        );
        checklist(qa, card);
      }
      element(
        "small",
        `模型：${qa.model || "未记录"} · ${qa.checked_at || "未记录时间"}`,
        card,
      );
      const list = element("ul", undefined, card);
      for (const issue of qa.issues ?? []) {
        element("li", issue, list);
        problems.push([panel, issue, article]);
      }
    }
  }
  if (!value.panels?.length) element("p", "本话还没有分幕。", $("takes"));
  if (problems.length) {
    element("h2", "问题清单 · 点击定位", $("issues"));
    const list = element("ul", undefined, $("issues"));
    for (const [panel, issue, article] of problems) {
      const item = element("li", undefined, list);
      const locate = element(
        "button",
        `第 ${panel.order + 1} 幕：${issue}`,
        item,
      );
      locate.type = "button";
      locate.addEventListener("click", () => {
        article.scrollIntoView({ block: "start" });
        article.focus({ preventScroll: true });
      });
    }
  }
  update();
}

async function readEpisode() {
  const value = await request("episode", {
    path_params: { episode_id: context.episode_id },
  });
  renderEpisode(value);
}

async function act(action) {
  running = true;
  update();
  try {
    await action();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    running = false;
    update();
  }
}

$("load").addEventListener("click", () =>
  act(async () => {
    $("status").textContent = "正在读取…";
    await readEpisode();
    $("status").textContent = "报告已刷新。选择候选后，再显式提交评审。";
  }),
);

$("problems-only").addEventListener("change", () => {
  if (episode) renderEpisode(episode);
});

$("review").addEventListener("click", () =>
  act(async () => {
    const ids = selected();
    if (!ids.length) return;
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
    $("status").textContent = "正在提交；失败时不会自动重试。";
    const job = await request("review", {
      path_params: { episode_id: context.episode_id },
      body: attempt,
    });
    jobId = job.id;
    $("job").textContent = `任务 ${job.id} · ${job.state}`;
    $("status").textContent =
      "已提交。点击刷新任务进度查看结果；相同选择重试复用原幂等键。";
  }),
);

$("refresh-job").addEventListener("click", () =>
  act(async () => {
    const job = await request("job", { path_params: { job_id: jobId } });
    const items = job.items ?? [];
    const done = items.filter((item) => item.state === "complete").length;
    $("job").textContent =
      `任务 ${job.id} · ${job.state} · ${done}/${items.length}`;
    const failures = items
      .filter((item) => item.error)
      .map((item) =>
        typeof item.error === "string"
          ? item.error
          : JSON.stringify(item.error),
      );
    await readEpisode();
    $("status").textContent = failures.length
      ? failures.join("\n")
      : "进度和逐幕报告已刷新。";
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
    $("status").textContent = context?.episode_id
      ? "点击读取候选与报告开始。"
      : "请从具体话的扩展菜单打开面板。";
    update();
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
            ? message.data.detail
            : `请求失败（${message.status}）`,
        ),
      );
  }
});
parent.postMessage({ type: "mio:panel:ready", version: 1, session }, "*");
