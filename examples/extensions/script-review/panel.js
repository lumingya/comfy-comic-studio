"use strict";

const session = new URLSearchParams(location.hash.slice(1)).get("mio-session");
const pending = new Map();
const $ = (id) => document.getElementById(id);
let context = null;
let proposal = null;
let current = null;
let running = false;
let stale = false;
let applied = false;
let uncertain = false;

function request(request_id, payload = {}) {
  return new Promise((resolve, reject) => {
    const rid = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(rid);
      const error = new Error(
        "请求超时。请先检查作品状态；不会自动重试或再次调用模型。",
      );
      error.status = 504;
      reject(error);
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
  return [...$("ops").querySelectorAll("input:checked")].map(
    (input) => input.value,
  );
}

function update() {
  $("propose").disabled =
    running || !context?.episode_id || !$("instruction").value.trim();
  const reviewable = proposal && !applied && !stale && !uncertain;
  $("accept-all").disabled = running || !reviewable;
  $("reject-all").disabled = running || !reviewable;
  $("apply").disabled = running || !reviewable || !selected().length;
  for (const input of $("ops").querySelectorAll("input"))
    input.disabled = running || !reviewable || input.dataset.blocked === "true";
}

function element(tag, text, parentNode) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (parentNode) parentNode.append(node);
  return node;
}

function printable(value) {
  if (value === undefined || value === null) return "（无）";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function difference(parentNode, title, before, after) {
  element("h3", title, parentNode);
  const row = element("div", undefined, parentNode);
  row.className = "diff";
  for (const [name, value, css] of [
    ["修改前", before, "before"],
    ["修改后", after, "after"],
  ]) {
    const block = element("section", undefined, row);
    block.className = css;
    element("small", name, block);
    element("pre", printable(value), block);
  }
}

function renderProposal() {
  $("ops").replaceChildren();
  $("revision").textContent =
    `提案基于版本 ${proposal.base_revision} · 当前已读版本 ${current.revision}`;
  for (const op of proposal.ops ?? []) {
    const article = element("article", undefined, $("ops"));
    const label = element("label", undefined, article);
    const input = element("input", undefined, label);
    input.type = "checkbox";
    input.value = op.id;
    input.dataset.blocked = String(Boolean(op.blocked));
    input.addEventListener("change", update);
    const panel = current.panels?.find((item) => item.id === op.target);
    const prefix = panel ? `第 ${panel.order + 1} 幕 · ` : "";
    element("strong", `${prefix}${op.summary || op.op}`, label);
    element("small", `${op.target} · ${op.id}`, article);
    if (op.blocked) element("p", `不可应用：${op.blocked}`, article);
    if (op.changes) {
      for (const [field, pair] of Object.entries(op.changes)) {
        if (field === "dialogue") {
          const [before, after] = pair;
          for (
            let index = 0;
            index < Math.max(before?.length ?? 0, after?.length ?? 0);
            index++
          ) {
            difference(
              article,
              `对白 · 第 ${index + 1} 句`,
              before?.[index],
              after?.[index],
            );
          }
        } else difference(article, field, pair[0], pair[1]);
      }
    } else
      difference(
        article,
        op.op === "reorder" ? "分幕顺序" : "内容",
        op.before ??
          (op.op === "reorder"
            ? current.panels.map((panel) => panel.id)
            : undefined),
        op.after ?? op.order,
      );
  }
  if (!proposal.ops?.length) element("p", "没有需要修改的内容。", $("ops"));
  update();
}

async function act(action) {
  if (running) return;
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

$("instruction").addEventListener("input", update);
$("propose").addEventListener("click", () =>
  act(async () => {
    $("status").textContent = "正在生成建议，仅生成提案，不写入作品…";
    proposal = null;
    $("ops").replaceChildren();
    $("revision").textContent = "";
    const params = { episode_id: context.episode_id };
    current = await request("episode", { path_params: params });
    proposal = await request("propose", {
      path_params: params,
      body: { instruction: $("instruction").value.trim() },
    });
    stale = applied = uncertain = false;
    renderProposal();
    $("status").textContent =
      "逐条勾选要接受的建议；未勾选即拒绝。锁定分幕的建议不能应用。";
  }),
);

for (const [id, checked] of [
  ["accept-all", true],
  ["reject-all", false],
]) {
  $(id).addEventListener("click", () => {
    for (const input of $("ops").querySelectorAll("input:not(:disabled)"))
      input.checked = checked;
    update();
  });
}

$("apply").addEventListener("click", () =>
  act(async () => {
    const accepted = selected();
    if (!accepted.length || stale || applied || uncertain) return;
    const params = { episode_id: context.episode_id };
    current = await request("episode", { path_params: params });
    $("revision").textContent =
      `提案基于版本 ${proposal.base_revision} · 当前已读版本 ${current.revision}`;
    if (current.revision !== proposal.base_revision) {
      stale = true;
      $("status").textContent =
        `作品已变更（提案版本 ${proposal.base_revision}，当前 ${current.revision}）。请核对作品后重新生成建议；旧提案不会应用。`;
      return;
    }
    try {
      const result = await request("apply", {
        path_params: params,
        body: {
          ops: proposal.ops,
          accepted,
          base_revision: proposal.base_revision,
        },
      });
      applied = true;
      $("revision").textContent = `已保存版本 ${result.revision}`;
      $("status").textContent =
        `已应用 ${result.applied.length} 条修改；其余建议已拒绝。`;
    } catch (error) {
      if (error.status === 409) {
        stale = true;
        throw new Error(
          "作品在审阅期间已改变。旧提案已停用，请重新生成建议；不会自动重试。",
        );
      }
      uncertain = true;
      throw new Error(
        `${error.message}\n应用状态需要核对。请检查作品，再重新生成建议；旧提案不会重复提交。`,
      );
    }
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
      ? "填写修改要求后生成建议。"
      : "请从具体话的扩展菜单打开面板。";
    update();
  }
  if (message.type === "mio:panel:response") {
    const waiting = pending.get(message.rid);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.delete(message.rid);
    if (message.ok) waiting.resolve(message.data);
    else {
      const error = new Error(
        typeof message.data?.detail === "string"
          ? message.data.detail
          : `请求失败（${message.status}）`,
      );
      error.status = message.status;
      waiting.reject(error);
    }
  }
});
parent.postMessage({ type: "mio:panel:ready", version: 1, session }, "*");
