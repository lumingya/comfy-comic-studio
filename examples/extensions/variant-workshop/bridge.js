/* Standalone version-2 sandbox-panel bridge. It never fetches or receives credentials. */
(() => {
  "use strict";
  const session = new URLSearchParams(location.hash.slice(1)).get(
    "mio-session",
  );
  const channel = new MessageChannel();
  const transport = channel.port1;
  const pending = new Map();
  const media = new Map();
  let initialized;
  const initialization = new Promise((resolve) => {
    initialized = resolve;
  });
  let context = null;
  const send = (message) =>
    transport.postMessage({ version: 2, session, ...message });
  const forgetMedia = (id) => {
    const owned = media.get(id);
    if (!owned) return;
    if (owned.url) {
      for (const image of document.images)
        if (image.src === owned.url) image.removeAttribute("src");
      URL.revokeObjectURL(owned.url);
    }
    owned.port.close();
    media.delete(id);
  };
  window.panelBridge = {
    initialized: initialization,
    request(request_id, payload = {}) {
      if (!context)
        return Promise.reject(new Error("尚未连接宿主，请重新打开面板。"));
      return new Promise((resolve, reject) => {
        const rid = crypto.randomUUID();
        const timeout = setTimeout(() => {
          const waiting = pending.get(rid);
          pending.delete(rid);
          if (waiting?.media_id) window.panelBridge.release(waiting.media_id);
          reject(
            new Error("请求超时。写入可能已完成；请先重新读取，再决定下一步。"),
          );
        }, 30000);
        pending.set(rid, { resolve, reject, timeout });
        send({ type: "mio:panel:request", rid, request_id, ...payload });
      });
    },
    release(media_id) {
      if (!media_id) return;
      forgetMedia(media_id);
      send({ type: "mio:panel:release", media_id });
    },
  };
  transport.addEventListener("message", (event) => {
    const message = event.data;
    if (
      !message ||
      message.version !== 2 ||
      message.session !== session
    )
      return;
    if (message.type === "mio:panel:init") {
      context = message.context;
      initialized(context);
    }
    if (message.type === "mio:panel:media") {
      const waiting = pending.get(message.rid);
      const port = event.ports[0];
      if (!port || !waiting || media.has(message.media_id)) {
        port?.close();
        window.panelBridge.release(message.media_id);
        return;
      }
      const owned = { port, url: null };
      media.set(message.media_id, owned);
      waiting.media_id = message.media_id;
      const revoked = () => {
        forgetMedia(message.media_id);
        const current = pending.get(message.rid);
        if (!current) return;
        clearTimeout(current.timeout);
        pending.delete(message.rid);
        current.reject(new Error("图片已由宿主撤销，请重新读取。"));
      };
      port.onmessage = (received) => {
        if (received.data?.type === "revoke") {
          revoked();
          return;
        }
        if (received.data?.type !== "image" || owned.url) return;
        const blob = received.data.blob;
        if (
          !(blob instanceof Blob) ||
          blob.size !== message.bytes ||
          blob.type !== message.mime
        ) {
          revoked();
          send({ type: "mio:panel:release", media_id: message.media_id });
          return;
        }
        try {
          owned.url = URL.createObjectURL(blob);
          clearTimeout(waiting.timeout);
          pending.delete(message.rid);
          waiting.resolve({
            media_id: message.media_id,
            url: owned.url,
            mime: message.mime,
            bytes: message.bytes,
          });
        } catch {
          revoked();
          send({ type: "mio:panel:release", media_id: message.media_id });
        }
      };
      port.onmessageerror = () => {
        revoked();
        send({ type: "mio:panel:release", media_id: message.media_id });
      };
      port.start();
      return;
    }
    if (message.type !== "mio:panel:response") return;
    const waiting = pending.get(message.rid);
    if (!waiting) {
      if (
        message.ok &&
        message.data?.media_id &&
        !media.has(message.data.media_id)
      )
        window.panelBridge.release(message.data.media_id);
      return;
    }
    if (message.ok && waiting.media_id) return;
    if (!message.ok && waiting.media_id)
      window.panelBridge.release(waiting.media_id);
    clearTimeout(waiting.timeout);
    pending.delete(message.rid);
    if (message.ok) waiting.resolve(message.data);
    else {
      const detail = message.data?.detail;
      const error = new Error(
        typeof detail === "string" ? detail : `请求失败（${message.status}）`,
      );
      error.status = message.status;
      waiting.reject(error);
    }
  });
  addEventListener("pagehide", () => {
    pending.forEach(({ timeout, reject }) => {
      clearTimeout(timeout);
      reject(new Error("面板已关闭。"));
    });
    pending.clear();
    for (const id of media.keys()) window.panelBridge.release(id);
    transport.close();
  });
  transport.start();
  parent.postMessage(
    { type: "mio:panel:ready", version: 2, session },
    "*",
    [channel.port2],
  );
})();
