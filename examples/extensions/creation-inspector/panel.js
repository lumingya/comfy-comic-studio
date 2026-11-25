/* Versioned, read-only host-context consumer. No custom events or direct HTTP. */
(() => {
  "use strict";
  const session = new URLSearchParams(location.hash.slice(1)).get(
    "mio-session",
  );
  const channel = new MessageChannel();
  const transport = channel.port1;
  const events = new Set(["creation.context.changed", "selection.changed"]);
  const $ = (id) => document.getElementById(id);
  const post = (message) =>
    transport.postMessage({
      version: message.type.startsWith("mio:creation:") ? 1 : 2,
      session,
      ...message,
    });
  const say = (text) => {
    $("status").textContent = text;
  };
  const display = (value) => value ?? "—";
  let initial = null;
  let snapshot = null;
  let identity = null;
  let seq = -1;
  let subscribed = false;
  let pending = null;
  let closed = false;
  const episodeId = () =>
    snapshot ? snapshot.episode_id : initial?.episode_id;
  function update() {
    $("read").disabled = closed || !episodeId() || !!pending;
  }
  function subscribe(enabled) {
    for (const event of events)
      post({ type: "mio:creation:subscribe", event, enabled });
    subscribed = enabled;
  }
  function valid(value) {
    return (
      value &&
      value.version === 1 &&
      Number.isSafeInteger(value.seq) &&
      value.seq >= 0 &&
      typeof value.context_id === "string" &&
      ["script", "canvas", "other"].includes(value.route) &&
      [value.series_id, value.episode_id].every(
        (id) => id === null || typeof id === "string",
      ) &&
      value.selection &&
      ["none", "panels"].includes(value.selection.kind) &&
      Array.isArray(value.selection.ids) &&
      value.selection.ids.every((id) => typeof id === "string") &&
      typeof value.selection.truncated === "boolean" &&
      value.revisions &&
      (value.revisions.episode === null ||
        Number.isSafeInteger(value.revisions.episode))
    );
  }
  function receiveContext(message) {
    const value = message.context;
    if (
      !subscribed ||
      !events.has(message.event) ||
      !valid(value) ||
      value.seq < seq
    )
      return;
    if (
      typeof message.activation !== "string" ||
      !/^[0-9a-f]{64}$/.test(message.digest)
    )
      return;
    const nextIdentity = `${message.activation}:${message.digest}`;
    if (identity && identity !== nextIdentity) {
      say("扩展会话已变化，请重新打开面板。");
      return;
    }
    identity = nextIdentity;
    if (episodeId() !== value.episode_id)
      $("read-result").textContent = "话已切换，可显式核对新话的服务端版本。";
    snapshot = value;
    seq = value.seq;
    $("route").textContent = value.route;
    $("series").textContent = display(value.series_id);
    $("episode").textContent = display(value.episode_id);
    $("revision").textContent = display(value.revisions.episode);
    $("seq").textContent = value.seq;
    $("context").textContent = value.context_id;
    $("event").textContent = message.event;
    $("selection-count").textContent = value.selection.ids.length;
    $("selection-state").textContent =
      value.selection.kind === "none"
        ? "无选区"
        : value.selection.truncated
          ? "选区已按宿主上限截断，仅显示收到的 ID。"
          : "当前选中的分格 ID";
    $("selection").replaceChildren();
    for (const id of value.selection.ids) {
      const item = document.createElement("li");
      item.textContent = id;
      $("selection").append(item);
    }
    say("已接收宿主只读上下文。");
    update();
  }
  function receiveResponse(message) {
    if (!pending || message.rid !== pending.rid) return;
    const request = pending;
    clearTimeout(request.timeout);
    pending = null;
    if (request.episode !== episodeId()) {
      say("话已切换，已丢弃旧话的读取结果。");
    } else if (!message.ok) {
      const detail = message.data?.detail;
      say(
        typeof detail === "string"
          ? detail
          : `读取失败（${message.status}），可显式重试。`,
      );
    } else if (
      message.data?.id !== request.episode ||
      !Number.isSafeInteger(message.data?.revision)
    ) {
      say("服务端版本响应不完整，请重新打开面板核对。");
    } else {
      $("read-result").textContent =
        `话 ID：${message.data.id}；服务端修订号：${message.data.revision}`;
      say("只读核对完成，未修改作品。");
    }
    update();
  }
  function onMessage(event) {
    const message = event.data;
    if (
      closed ||
      !message ||
      message.version !== (message.type === "mio:creation:event" ? 1 : 2) ||
      message.session !== session
    )
      return;
    if (message.type === "mio:panel:init") {
      initial = message.context;
      if (!snapshot) {
        $("series").textContent = display(initial?.series_id);
        $("episode").textContent = display(initial?.episode_id);
      }
      if (!subscribed) subscribe(true);
      say("正在等待宿主上下文事件。");
      update();
    } else if (message.type === "mio:creation:event") receiveContext(message);
    else if (message.type === "mio:panel:response") receiveResponse(message);
  }
  function read() {
    if (!initial || pending || closed || !episodeId()) return;
    const rid = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pending = null;
      say("读取超时，没有自动重试。");
      update();
    }, 30000);
    pending = { rid, timeout, episode: episodeId() };
    update();
    post({
      type: "mio:panel:request",
      rid,
      request_id: "episode",
      path_params: { episode_id: pending.episode },
    });
  }
  function close() {
    if (closed) return;
    if (subscribed) subscribe(false);
    closed = true;
    if (pending) clearTimeout(pending.timeout);
    pending = null;
    transport.removeEventListener("message", onMessage);
    transport.close();
    $("read").removeEventListener("click", read);
    removeEventListener("pagehide", close);
    update();
  }
  transport.addEventListener("message", onMessage);
  addEventListener("pagehide", close);
  $("read").addEventListener("click", read);
  transport.start();
  parent.postMessage(
    { type: "mio:panel:ready", version: 2, session },
    "*",
    [channel.port2],
  );
})();
