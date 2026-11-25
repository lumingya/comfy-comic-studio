(() => {
  const session = new URLSearchParams(location.hash.slice(1)).get("mio-session");
  const english = ["en", "en-us", "en-gb"].includes((document.documentElement.lang || "").toLowerCase());
  const messages = {
    zh: {
      cancelAdopt: "取消", confirmAdopt: "确认采用",
      eyebrow: "独立扩展工作区", title: "单格精修", subtitle: "局部修补、扩展画面或提交指令编辑。每次生成都会保留为新候选。",
      series: "作品", episode: "话", load: "读取候选与配置", connect: "正在连接工作区…", emptyTitle: "选择一话开始", emptyBody: "选择作品和话，再读取候选与出图配置。此工作台不会自动发起生成。", takeAdopted: "已采用", takeCandidate: "候选",
      source: "原图与蒙版", candidate: "候选图", imagePlaceholder: "选择候选图后显示原图", brush: "画笔", rectangle: "矩形", eraser: "橡皮擦", undo: "撤销", redo: "重做", clear: "清空", brushSize: "笔刷大小", feather: "边缘羽化", invert: "反选蒙版区域", maskHint: "浅色区域将重绘。拖动画笔或矩形；橡皮擦可擦除区域。Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做。",
      editTitle: "本次编辑", kind: "方式", inpaint: "局部重绘", outpaint: "扩展画布", instructionEdit: "指令编辑", profile: "出图配置", inpaintOptions: "局部重绘选项", inpaintHint: "先绘制蒙版；反选与羽化会在本地栅格化后随任务上传。", outpaintOptions: "画布外扩", direction: "外扩方向", left: "向左", right: "向右", top: "向上", bottom: "向下", horizontal: "左右两侧", vertical: "上下两侧", all: "四周", padding: "扩展像素", instructionOptions: "指令编辑", instruction: "修改指令", channel: "云端渠道 ID（可选）", prompt: "本次正向提示词（留空沿用原图）", advanced: "负向词、重绘强度与种子", negative: "负向提示词", denoise: "重绘强度", seed: "种子", submit: "提交精修并新增候选", newIntent: "开始新的编辑请求", submissionHint: "提交前请核对候选、配置和参数。相同参数重复点击只提交同一个幂等任务。",
      jobs: "任务进度", recent: "近期精修任务", jobId: "任务 ID", refresh: "刷新任务", cancelJob: "停止任务", autoRefresh: "每 5 秒跟踪状态", noJob: "尚未选择任务", compare: "原图 / 精修候选对比", result: "精修结果", compareSlider: "原图与候选对比滑杆", adopt: "采用此候选", adoptHint: "采用会更新该格阅读中的画面，原候选仍保留。", sourceImageAlt: "当前编辑的原图", maskCanvasAlt: "蒙版绘制画布", beforeImageAlt: "精修前原图", afterImageAlt: "精修候选",
      chooseEpisode: "请选择一话。", noSeries: "工作区中没有可用作品。", noEpisodes: "此作品还没有话。", noTakes: "本话还没有候选图，请先生成候选。", loaded: "已读取候选与配置。选择原图和编辑方式，核对参数后再提交。", loading: "正在读取候选与配置…", submitting: "正在提交精修任务…", noProfile: "没有支持此编辑方式的已绑定配置，请先设置出图配置。", loadError: "读取失败：{error}", imageError: "无法读取这张候选图：{error}", emptyMask: "请画出至少一个需要重绘的区域。", unfinishedStroke: "请完成或撤回当前蒙版笔画。", submitted: "精修任务已提交。原候选保持不变。", completed: "精修已完成。结果已作为新候选回流。", failed: "任务{state}，请查看逐项状态。不会自动重试。", submitError: "提交失败：{error}。未自动重试；可先刷新任务列表确认是否已创建。", jobError: "任务读取失败：{error}", adoptConfirm: "采用这张精修候选？这会替换该格当前采用图，旧图仍保留为候选。", adopted: "候选已采用。", adoptError: "采用失败：{error}", drawFirst: "先选择一张原图。", profileWorkflow: "工作流：{workflow} · {kind}", cloudFallback: "指令编辑将使用所选云端渠道。", noSupportedProfiles: "没有可用于此编辑方式的配置。", seriesLoadError: "读取作品失败：{error}", episodeLoadError: "读取话失败：{error}", job: "任务", task: "第 {number} 格", requestNew: "下一次提交将创建新的编辑任务。", watchingLimit: "自动刷新已达到会话上限，可手动刷新任务。", running: "处理中", queued: "排队中", completedState: "已完成", failedState: "失败", canceledState: "已停止", paused: "已暂停", uncertain: "待核对", cancelError: "停止任务失败：{error}", cancelled: "已请求停止任务。", done: "{state} · {done}/{total} 项", adoptUnavailable: "此候选已采用。", loadingImage: "正在读取图片…", profileRequired: "请先读取话并选择出图配置。"
    },
    en: {
      cancelAdopt: "Cancel", confirmAdopt: "Confirm adoption",
      eyebrow: "OPTIONAL EXTENSION", title: "Panel retouch", subtitle: "Repair a region, extend the frame, or edit from instructions. Every result stays as a new candidate.",
      series: "Series", episode: "Episode", load: "Load takes and profiles", connect: "Connecting to workspace…", emptyTitle: "Choose an episode", emptyBody: "Select a series and episode, then load candidates and render profiles. This workspace never generates automatically.", takeAdopted: "Adopted", takeCandidate: "Candidate",
      source: "Source and mask", candidate: "Source take", imagePlaceholder: "Choose a take to view its image", brush: "Brush", rectangle: "Rectangle", eraser: "Eraser", undo: "Undo", redo: "Redo", clear: "Clear", brushSize: "Brush size", feather: "Feather", invert: "Invert mask", maskHint: "Painted areas will be regenerated. Drag to paint or draw rectangles; erase to remove mask. Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo.",
      editTitle: "Edit request", kind: "Mode", inpaint: "Inpaint", outpaint: "Outpaint", instructionEdit: "Instruction edit", profile: "Render profile", inpaintOptions: "Inpaint options", inpaintHint: "Draw a mask first. Inversion and feathering are rasterized locally and uploaded with the task.", outpaintOptions: "Extend canvas", direction: "Direction", left: "Left", right: "Right", top: "Up", bottom: "Down", horizontal: "Both sides", vertical: "Top and bottom", all: "All sides", padding: "Pixels to extend", instructionOptions: "Instruction edit", instruction: "Edit instruction", channel: "Cloud channel ID (optional)", prompt: "Positive prompt (leave blank to keep the source)", advanced: "Negative prompt, strength, and seed", negative: "Negative prompt", denoise: "Denoise", seed: "Seed", submit: "Submit and create candidate", newIntent: "Start a new edit request", submissionHint: "Review the source, profile, and parameters before submission. Repeated clicks with identical settings reuse the same idempotent job.",
      jobs: "Job progress", recent: "Recent retouch jobs", jobId: "Job ID", refresh: "Refresh job", cancelJob: "Cancel job", autoRefresh: "Poll every 5 seconds", noJob: "No job selected", compare: "Source / result comparison", result: "Retouch result", compareSlider: "Source/result comparison slider", adopt: "Adopt this candidate", adoptHint: "Adopting replaces the image currently used for this panel; the previous take remains available.", sourceImageAlt: "Source image", maskCanvasAlt: "Mask drawing canvas", beforeImageAlt: "Image before retouch", afterImageAlt: "Retouched candidate",
      chooseEpisode: "Choose an episode.", noSeries: "No available series in this workspace.", noEpisodes: "This series has no episodes yet.", noTakes: "No candidate images in this episode yet. Generate a take first.", loaded: "Takes and profiles loaded. Select a source and edit mode, then review the request.", loading: "Loading takes and profiles…", submitting: "Submitting retouch job…", noProfile: "No enabled, bound profile supports this edit mode.", loadError: "Could not load: {error}", imageError: "Could not read the take image: {error}", emptyMask: "Draw at least one region to repaint.", unfinishedStroke: "Finish or undo the current mask stroke.", submitted: "Retouch job submitted. The source take is unchanged.", completed: "Retouch finished. Its result is available as a new candidate.", failed: "Job {state}. Review each item; no retry was submitted.", submitError: "Submission failed: {error}. Nothing was retried automatically; refresh jobs to check whether one was created.", jobError: "Could not read job: {error}", adoptConfirm: "Adopt this result? It replaces the image currently used for this panel; the previous image remains a candidate.", adopted: "Candidate adopted.", adoptError: "Could not adopt candidate: {error}", drawFirst: "Choose a source image first.", profileWorkflow: "Workflow: {workflow} · {kind}", cloudFallback: "Instruction edit will use the selected cloud channel.", noSupportedProfiles: "No profile supports this edit mode.", seriesLoadError: "Could not load series: {error}", episodeLoadError: "Could not load episodes: {error}", job: "Job", task: "Panel {number}", requestNew: "The next submission will create a new edit job.", watchingLimit: "Automatic polling reached this session's limit. Refresh the job manually.", running: "Running", queued: "Queued", completedState: "Completed", failedState: "Failed", canceledState: "Canceled", paused: "Paused", uncertain: "Needs review", cancelError: "Could not cancel job: {error}", cancelled: "Job cancellation requested.", done: "{state} · {done}/{total} items", adoptUnavailable: "This take is already adopted.", loadingImage: "Loading image…", profileRequired: "Load the episode and select a render profile first."
    }
  };
  let locale = english ? "en" : "zh";
  const text = (key, values = {}) => {
    const source = messages[locale][key] ?? messages.zh[key] ?? key;
    return source.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  };
  const localize = () => {
    for (const node of document.querySelectorAll("[data-i18n]")) {
      const key = node.dataset.i18n;
      if (node instanceof HTMLInputElement && node.placeholder) node.placeholder = text(key);
      else if (node instanceof HTMLTextAreaElement && node.placeholder) node.placeholder = text(key);
      else node.textContent = text(key);
    }
    for (const node of document.querySelectorAll("[data-i18n-alt]")) node.alt = text(node.dataset.i18nAlt);
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
    const slider = document.getElementById("compare-slider");
    if (slider) slider.setAttribute("aria-label", text("compareSlider"));
    const series = document.getElementById("series");
    const episode = document.getElementById("episode");
    if (series) series.setAttribute("aria-label", text("series"));
    if (episode) episode.setAttribute("aria-label", text("episode"));
    const canvas = document.getElementById("mask-canvas");
    if (canvas) canvas.setAttribute("aria-label", text("maskCanvasAlt"));
  };
  const applyTheme = (context) => {
    const root = document.documentElement;
    const tokens = context.tokens && typeof context.tokens === "object" ? context.tokens : {};
    const aliases = {
      "--surface": ["--surface-panel", "--panel", "--control-surface"],
      "--surface-2": ["--surface-raised", "--panel-2", "--hover"],
      "--canvas": ["--bg", "--bg-deep"],
      "--ink": ["--text"],
      "--muted": ["--muted", "--soft"],
      "--line": ["--line", "--line-strong", "--control-border"],
      "--accent": ["--accent", "--button-primary", "--focus"],
      "--accent-ink": ["--on-accent", "--button-primary-text"],
      "--danger": ["--red", "--button-danger"]
    };
    for (const [target, names] of Object.entries(aliases)) {
      const found = names.map((name) => tokens[name] ?? tokens[name.slice(2)]).find((value) => typeof value === "string" && value.trim());
      if (found) root.style.setProperty(target, found.trim());
    }
    if (context.theme === "light" || context.theme === "dark") root.dataset.theme = context.theme;
    else delete root.dataset.theme;
    root.style.colorScheme = context.theme === "dark" ? "dark" : context.theme === "light" ? "light" : "light dark";
  };
  const channel = new MessageChannel();
  const transport = channel.port1;
  const pending = new Map();
  const media = new Map();
  let ready = false;
  let disposed = false;
  const envelope = { version: 2, session };
  const send = (message) => transport.postMessage({ ...envelope, ...message });
  const release = (idOrUrl) => {
    const id = media.has(idOrUrl) ? idOrUrl : [...media].find(([, value]) => value.url === idOrUrl)?.[0];
    const value = media.get(id);
    if (!value) return;
    if (value.url) {
      for (const image of document.images ?? []) if (image.src === value.url) image.removeAttribute("src");
      URL.revokeObjectURL(value.url);
    }
    value.port.close();
    media.delete(id);
    if (!disposed) send({ type: "mio:panel:release", media_id: id });
  };
  const failure = (rid, error) => {
    const value = pending.get(rid);
    if (!value) return;
    pending.delete(rid);
    clearTimeout(value.timer);
    if (value.mediaId) release(value.mediaId);
    value.reject(error);
  };
  const dispatch = (value) => {
    if (!ready || disposed || value.sent) return;
    value.sent = true;
    send(value.message);
  };
  const call = (message) => new Promise((resolve, reject) => {
    if (disposed || !session) { reject(new Error("Panel session is unavailable.")); return; }
    const rid = crypto.randomUUID();
    const timer = setTimeout(() => failure(rid, new Error(text("submitError", { error: "timeout" }))), 30000);
    const value = { resolve, reject, timer, sent: false, message: { ...message, rid } };
    pending.set(rid, value);
    dispatch(value);
  });
  const routes = [
    ["series", "GET", /^series$/, []],
    ["episodes", "GET", /^series\/([^/]+)\/episodes$/, ["series_id"]],
    ["episode", "GET", /^episodes\/([^/]+)$/, ["episode_id"]],
    ["profiles", "GET", /^profiles$/, []],
    ["image", "GET", /^episodes\/([^/]+)\/takes\/([^/]+)\/image$/, ["episode_id", "take_id"]],
    ["edit", "POST", /^episodes\/([^/]+)\/edit$/, ["episode_id"]],
    ["jobs", "GET", /^jobs$/, []],
    ["job", "GET", /^jobs\/([^/]+)$/, ["job_id"]],
    ["cancel", "POST", /^jobs\/([^/]+)\/cancel$/, ["job_id"]],
    ["adopt", "POST", /^episodes\/([^/]+)\/takes\/([^/]+)\/adopt$/, ["episode_id", "take_id"]]
  ];
  const request = async (path, init = {}) => {
    if (typeof path !== "string" || !path.startsWith("/api/") || path.includes("#")) throw new Error("Only declared panel requests are allowed.");
    const [pathname, search = ""] = path.slice(5).split("?");
    const method = (init.method || "GET").toUpperCase();
    const route = routes.find(([, expected, pattern]) => expected === method && pattern.test(pathname));
    if (!route) throw new Error("Only declared panel requests are allowed.");
    const [request_id, , pattern, names] = route;
    const matches = pathname.match(pattern);
    const path_params = Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(matches[index + 1])]));
    const query = Object.fromEntries(new URLSearchParams(search));
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const value = await call({ type: "mio:panel:request", request_id, path_params, query, ...(body === undefined ? {} : { body }) });
    return {
      ok: true, status: value.status,
      json: async () => value.data,
      blob: async () => value.media?.blob ?? new Blob([JSON.stringify(value.data)], { type: "application/json" }),
      url: value.media?.url
    };
  };
  const json = async (path, init) => (await request(path, init)).json();
  const get = (path) => json(`/api/${path.replace(/^\/+/, "")}`);
  const post = (path, body) => json(`/api/${path.replace(/^\/+/, "")}`, {
    method: "POST",
    body: JSON.stringify(body ?? {})
  });
  const upload = async (blob, filename) => {
    if (!(blob instanceof Blob) || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(blob.type) || !blob.size || blob.size > 32 * 1024 * 1024) throw new Error("Mask upload exceeds the image allowance.");
    if (typeof filename !== "string" || !filename || new TextEncoder().encode(JSON.stringify({ ...envelope, type: "mio:panel:upload", rid: "0".repeat(36), filename, request_id: "upload-mask" })).byteLength > 65536) throw new Error("Mask upload metadata exceeds 64 KiB.");
    if (typeof createImageBitmap === "function") {
      const image = await createImageBitmap(blob);
      try {
        if (!image.width || !image.height || image.width * image.height > 16 * 1024 * 1024) throw new Error("Mask upload exceeds the pixel allowance.");
      } finally { image.close(); }
    }
    const value = await call({ type: "mio:panel:upload", request_id: "upload-mask", filename, blob });
    return value.data;
  };
  window.MioRetouch = Object.freeze({ text, localize, applyTheme, request, json, get, post, upload, release, session });
  transport.addEventListener("message", (event) => {
    const message = event.data;
    if (disposed || !message || message.version !== 2 || message.session !== session) return;
    if (message.type === "mio:panel:init" || message.type === "mio:panel:appearance") {
      const appearance = message.appearance ?? {};
      locale = typeof appearance.locale === "string" && appearance.locale.toLowerCase().startsWith("en") ? "en" : "zh";
      applyTheme(appearance);
      localize();
      document.dispatchEvent(new CustomEvent("mio-context", { detail: { locale, theme: appearance.theme } }));
      if (message.type === "mio:panel:init") {
        ready = true;
        for (const value of pending.values()) dispatch(value);
      }
      return;
    }
    const waiting = pending.get(message.rid);
    if (message.type === "mio:panel:media") {
      const port = event.ports?.[0];
      if (!port || !waiting || waiting.message.request_id !== "image" || waiting.mediaId || media.has(message.media_id)) {
        port?.close();
        if (typeof message.media_id === "string") send({ type: "mio:panel:release", media_id: message.media_id });
        return;
      }
      const value = { port, url: "", blob: null };
      media.set(message.media_id, value);
      waiting.mediaId = message.media_id;
      port.addEventListener("message", (received) => {
        if (received.data?.type === "revoke") {
          failure(message.rid, new Error("Panel image was revoked."));
          release(message.media_id);
          return;
        }
        const blob = received.data?.blob;
        if (received.data?.type !== "image" || value.url) return;
        if (disposed || !pending.has(message.rid)) { release(message.media_id); return; }
        if (!(blob instanceof Blob) || blob.type !== message.mime || blob.size !== message.bytes) { failure(message.rid, new Error("Invalid panel image.")); return; }
        try {
          value.url = URL.createObjectURL(blob);
          value.blob = blob;
        } catch (error) { failure(message.rid, error); return; }
        pending.delete(message.rid);
        clearTimeout(waiting.timer);
        waiting.resolve({ status: 200, media: value });
      });
      port.addEventListener("messageerror", () => { failure(message.rid, new Error("Panel image could not be decoded.")); release(message.media_id); });
      port.start();
      return;
    }
    if (message.type !== "mio:panel:response" || !waiting) return;
    if (!message.ok) {
      const error = new Error(typeof message.data?.detail === "string" ? message.data.detail : `HTTP ${message.status}`);
      error.status = message.status;
      failure(message.rid, error);
      return;
    }
    pending.delete(message.rid);
    clearTimeout(waiting.timer);
    waiting.resolve({ status: message.status, data: message.data });
  });
  addEventListener("pagehide", () => {
    disposed = true;
    for (const rid of pending.keys()) failure(rid, new Error("Panel session ended."));
    for (const id of media.keys()) release(id);
    transport.close();
  });
  transport.start();
  if (session) parent.postMessage({ type: "mio:panel:ready", ...envelope }, "*", [channel.port2]);
  else document.addEventListener("DOMContentLoaded", () => {
    const status = document.getElementById("status");
    if (status) status.textContent = messages[locale].connect;
  }, { once: true });
})();
