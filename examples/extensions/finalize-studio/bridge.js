/* Vendored standard v2 sandbox client; this package has no host-internal dependency. */
(() => {
  const session = new URLSearchParams(location.hash.slice(1)).get(
    "mio-session",
  );
  const channel = new MessageChannel();
  const transport = channel.port1;
  let connected = false;
  const initListeners = new Set();
  const pending = new Map();
  const media = new Map();
  const ports = new Map();
  let context;
  const send = (type, payload = {}) =>
    transport.postMessage({ type, version: 2, session, ...payload });
  const release = (value) => {
    if (!value?.media_id) return;
    const resource = ports.get(value.media_id);
    if (resource?.url) URL.revokeObjectURL(resource.url);
    for (const [element, item] of media) {
      if (item.media_id !== value.media_id) continue;
      element.removeAttribute("src");
      media.delete(element);
    }
    resource?.port.close();
    ports.delete(value.media_id);
    send("mio:panel:release", { media_id: value.media_id });
  };
  const api = {
    get context() {
      return context;
    },
    status(text) {
      document.getElementById("status").textContent = text;
    },
    request(request_id, payload = {}) {
      return new Promise((resolve, reject) => {
        const rid = crypto.randomUUID();
        const timeout = setTimeout(() => {
          pending.delete(rid);
          reject(
            new Error("等待宿主超时。请先刷新任务状态，再明确重试同一请求。"),
          );
        }, 35000);
        pending.set(rid, { resolve, reject, timeout });
        send("mio:panel:request", { rid, request_id, ...payload });
      });
    },
    episode() {
      return api.request("episode", {
        path_params: { episode_id: context.episode_id },
      });
    },
    async image(element, takeId) {
      const generation = (element.dataset.generation ?? "") + ".";
      element.dataset.generation = generation;
      const old = media.get(element);
      media.delete(element);
      element.removeAttribute("src");
      release(old);
      if (!takeId) return;
      const value = await api.request("image", {
        path_params: { episode_id: context.episode_id, take_id: takeId },
      });
      if (element.dataset.generation !== generation) {
        release(value);
        return;
      }
      media.set(element, value);
      element.src = value.url;
    },
    connect(onInit) {
      initListeners.add(onInit);
      if (connected) {
        if (context) onInit(context);
        return;
      }
      connected = true;
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
          for (const listener of initListeners) listener(context);
        }
        if (message.type === "mio:panel:media") {
          const port = event.ports?.[0];
          const waiting = pending.get(message.rid);
          if (!port || !waiting) {
            port?.close();
            release(message);
            return;
          }
          const resource = { port, url: null };
          ports.set(message.media_id, resource);
          port.onmessage = (event) => {
            const data = event.data;
            if (data?.type === "revoke") {
              if (pending.has(message.rid)) {
                pending.delete(message.rid);
                clearTimeout(waiting.timeout);
                waiting.reject(new Error("图片已由宿主释放，请重新读取。"));
              }
              release(message);
              return;
            }
            if (data?.type !== "image") return;
            if (!pending.has(message.rid)) {
              release(message);
              return;
            }
            pending.delete(message.rid);
            clearTimeout(waiting.timeout);
            if (!(data.blob instanceof Blob)) {
              release(message);
              waiting.reject(new Error("图片桥没有返回有效图片。"));
              return;
            }
            resource.url = URL.createObjectURL(data.blob);
            waiting.resolve({
              media_id: message.media_id,
              url: resource.url,
              mime: message.mime,
              bytes: message.bytes,
            });
          };
          port.start();
          return;
        }
        if (message.type !== "mio:panel:response") return;
        const waiting = pending.get(message.rid);
        if (!waiting) {
          release(message.data);
          return;
        }
        pending.delete(message.rid);
        clearTimeout(waiting.timeout);
        if (message.ok) waiting.resolve(message.data);
        else
          waiting.reject(
            new Error(
              typeof message.data?.detail === "string"
                ? message.data.detail
                : `请求失败（${message.status}）`,
            ),
          );
      });
      addEventListener("pagehide", () => {
        for (const value of media.values()) release(value);
        media.clear();
        for (const media_id of ports.keys()) release({ media_id });
        for (const value of pending.values()) clearTimeout(value.timeout);
        pending.clear();
        transport.close();
      });
      transport.start();
      if (session)
        parent.postMessage(
          { type: "mio:panel:ready", version: 2, session },
          "*",
          [channel.port2],
        );
      else
        api.status("请在 Mio 的话页面从扩展菜单打开。独立打开不会提交任务。");
    },
  };
  window.MioPanel = api;
})();
