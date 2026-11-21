(() => {
  const api = window.MioRetouch;
  const logic = window.MioRetouchLogic;
  const $ = (id) => document.getElementById(id);
  const elements = {
    status: $("status"), series: $("series"), episodeSelect: $("episode"), load: $("load"), empty: $("empty"), take: $("take"),
    image: $("source-image"), stage: $("source-stage"), canvas: $("mask-canvas"), kind: $("kind"), profile: $("profile"), profileInfo: $("profile-info"),
    inpaint: $("inpaint-fields"), outpaint: $("outpaint-fields"), instructionFields: $("instruction-fields"), direction: $("direction"), padding: $("padding"),
    instruction: $("instruction"), channel: $("channel"), prompt: $("prompt"), negative: $("negative"), denoise: $("denoise"), seed: $("seed"), feather: $("feather"), invert: $("invert"),
    brushSize: $("brush-size"), brushSizeValue: $("brush-size-value"), featherValue: $("feather-value"), undo: $("undo"), redo: $("redo"), clear: $("clear-mask"),
    submit: $("submit"), newIntent: $("new-intent"), recent: $("recent-jobs"), jobId: $("job-id"), jobRefresh: $("job-refresh"), jobCancel: $("job-cancel"), watch: $("watch"),
    jobProgress: $("job-progress"), jobState: $("job-state"), jobItems: $("job-items"), result: $("result"), compare: $("compare-stage"), before: $("before-image"), after: $("after-image"),
    slider: $("compare-slider"), divider: $("compare-divider"), adopt: $("adopt")
  };
  let seriesItems = [];
  let episodeItems = [];
  let episode = null;
  let profiles = [];
  let busy = false;
  let intent = null;
  let sourceUrl = "";
  let previewUrls = [];
  const maskUploads = new Map();
  const stateLabel = (state) => api.text(({ running: "running", queued: "queued", completed: "completedState", failed: "failedState", canceled: "canceledState", paused: "paused", uncertain: "uncertain" })[state] || state);
  const status = (key, vars = {}, kind = "") => {
    elements.status.textContent = api.text(key, vars);
    elements.status.dataset.kind = kind;
  };
  const option = (select, label, value = "") => select.add(new Option(label, value));
  const selectedProfile = () => profiles.find((profile) => profile.id === elements.profile.value);
  const selectedTake = () => episode?.takes.find((take) => take.id === elements.take.value);
  const update = () => {
    const enabled = Boolean(api.session);
    const imageReady = elements.stage.classList.contains("ready") && !busy;
    elements.series.disabled = busy || !seriesItems.length;
    elements.episodeSelect.disabled = busy || !episodeItems.length;
    elements.load.disabled = busy || !elements.episodeSelect.value || !enabled;
    elements.take.disabled = busy || !episode?.takes.length;
    elements.profile.disabled = busy || !elements.profile.options.length;
    elements.brushSize.disabled = !imageReady;
    elements.feather.disabled = busy || !episode;
    elements.invert.disabled = busy || !episode;
    document.querySelectorAll("[data-tool]").forEach((button) => { button.disabled = !imageReady; });
    elements.submit.disabled = busy || !selectedTake() || !selectedProfile();
    elements.newIntent.disabled = busy || !episode;
    elements.recent.disabled = busy || !episode;
    elements.result.disabled = busy || !logic.results(episode || { takes: [] }).length;
    const result = episode?.takes.find((take) => take.id === elements.result.value);
    elements.adopt.disabled = busy || !result || result.status === "adopted";
    elements.jobCancel.disabled = busy || !elements.jobId.value || ["completed", "failed", "canceled"].includes(window.MioJobTracker?.state);
  };
  const revoke = (value) => { if (value) URL.revokeObjectURL(value); };
  const clearSource = () => {
    revoke(sourceUrl);
    sourceUrl = "";
    elements.image.removeAttribute("src");
    elements.stage.classList.remove("ready");
    elements.canvas.width = 1;
    elements.canvas.height = 1;
    maskEditor.reset();
  };
  const loadImage = async (takeId, target = elements.image) => {
    if (!takeId) return;
    const path = `/api/episodes/${encodeURIComponent(episode.id)}/takes/${encodeURIComponent(takeId)}/image`;
    const response = await api.request(path);
    const url = URL.createObjectURL(await response.blob());
    if (target === elements.image) {
      revoke(sourceUrl);
      sourceUrl = url;
      target.onload = () => {
        elements.stage.classList.add("ready");
        maskEditor.reset();
        maskEditor.resize();
        update();
      };
      target.src = url;
    } else {
      previewUrls.push(url);
      target.src = url;
    }
  };
  const maskEditor = new window.MioMaskEditor(elements.image, elements.canvas, elements.stage, {
    undo: elements.undo, redo: elements.redo, clear: elements.clear, invert: elements.invert
  });
  const fillSeries = () => {
    const previous = elements.series.value;
    elements.series.replaceChildren();
    for (const item of seriesItems) option(elements.series, item.title || item.id, item.id);
    if (seriesItems.some((item) => item.id === previous)) elements.series.value = previous;
  };
  const fillEpisodes = () => {
    const previous = elements.episodeSelect.value;
    elements.episodeSelect.replaceChildren();
    for (const item of episodeItems) option(elements.episodeSelect, item.title || item.id, item.id);
    if (episodeItems.some((item) => item.id === previous)) elements.episodeSelect.value = previous;
    update();
  };
  const refreshEpisodes = async () => {
    const seriesId = elements.series.value;
    episode = null;
    elements.empty.hidden = false;
    clearSource();
    episodeItems = [];
    fillEpisodes();
    if (!seriesId) return;
    try {
      const result = await api.get(`series/${encodeURIComponent(seriesId)}/episodes?limit=200`);
      episodeItems = result.items || [];
      fillEpisodes();
      status(episodeItems.length ? "chooseEpisode" : "noEpisodes");
    } catch (error) { status("episodeLoadError", { error: error.message }, "error"); }
  };
  const chooseKind = () => {
    const previous = elements.profile.value;
    const kind = elements.kind.value;
    elements.inpaint.hidden = kind !== "inpaint";
    elements.outpaint.hidden = kind !== "outpaint";
    elements.instructionFields.hidden = kind !== "edit";
    elements.profile.replaceChildren();
    for (const profile of profiles.filter((item) => logic.workflow(item, kind))) option(elements.profile, profile.name, profile.id);
    if ([...elements.profile.options].some((item) => item.value === previous)) elements.profile.value = previous;
    const stage = selectedProfile()?.edits?.[kind];
    elements.profileInfo.textContent = stage ? api.text("profileWorkflow", { workflow: stage.workflow_id, kind: stage.kind }) : api.text("cloudFallback");
    if (!elements.profile.options.length) elements.profileInfo.textContent = api.text("noSupportedProfiles");
    update();
  };
  const fillTakes = (value) => {
    const previous = elements.take.value;
    elements.take.replaceChildren();
    for (const take of value.takes) {
      const panel = value.panels.find((item) => item.id === take.panel_id);
      const count = (panel?.order ?? 0) + 1;
      const label = api.text("task", { number: count }) + ` · ${api.text(take.status === "adopted" ? "takeAdopted" : "takeCandidate")} · ${take.id}`;
      option(elements.take, label, take.id);
    }
    if (value.takes.some((take) => take.id === previous)) elements.take.value = previous;
    else if (value.takes.length) elements.take.value = value.takes[0].id;
    const resultId = elements.result.value;
    const results = logic.results(value);
    elements.result.replaceChildren();
    for (const take of results) option(elements.result, `${take.id} · ${take.status}`, take.id);
    if (results.some((take) => take.id === resultId)) elements.result.value = resultId;
    else if (results.length) elements.result.value = results.at(-1).id;
  };
  const refreshPreview = async () => {
    for (const url of previewUrls) revoke(url);
    previewUrls = [];
    const result = episode?.takes.find((take) => take.id === elements.result.value);
    elements.compare.hidden = !result;
    if (!result) return;
    await Promise.all([loadImage(result.parent_take_id, elements.before), loadImage(result.id, elements.after)]);
    setSlider();
  };
  const setSlider = () => {
    const value = Math.max(0, Math.min(100, Number(elements.slider.value)));
    elements.compare.style.setProperty("--split", `${value}%`);
    elements.divider.style.left = `${value}%`;
  };
  const loadEpisode = async () => {
    if (busy || !elements.episodeSelect.value) return;
    busy = true;
    update();
    status("loading");
    elements.empty.hidden = true;
    try {
      const [value, configs] = await Promise.all([api.get(`episodes/${encodeURIComponent(elements.episodeSelect.value)}`), api.get("profiles")]);
      episode = value;
      profiles = configs;
      fillTakes(value);
      chooseKind();
      if (elements.take.value) await loadImage(elements.take.value);
      else clearSource();
      await refreshPreview();
      await window.MioJobTracker.recent(value.id);
      elements.empty.hidden = Boolean(value.takes.length);
      status(!value.takes.length ? "noTakes" : !elements.profile.value ? "noProfile" : "loaded", {}, !value.takes.length ? "" : "success");
    } catch (error) { status("loadError", { error: error.message }, "error"); elements.empty.hidden = false; }
    finally { busy = false; update(); }
  };
  const createJob = async () => {
    if (busy) return;
    busy = true;
    update();
    try {
      const kind = elements.kind.value;
      if (kind === "inpaint" && maskEditor.drawing) throw new Error("unfinishedStroke");
      let maskAssetId = "";
      if (kind === "inpaint") {
        const maskKey = JSON.stringify([elements.take.value, maskEditor.revision, Number(elements.feather.value), elements.invert.checked]);
        maskAssetId = maskUploads.get(maskKey) || "";
        if (!maskAssetId) {
          const png = await maskEditor.blob(Number(elements.feather.value), elements.invert.checked);
          const asset = await api.upload(png, `retouch-mask-${Date.now()}.png`);
          maskAssetId = asset.id;
          maskUploads.clear();
          maskUploads.set(maskKey, maskAssetId);
        }
      }
      const body = logic.body({ take_id: elements.take.value, profile_id: elements.profile.value, kind,
        mask_asset_id: maskAssetId, feather: elements.feather.value, invert: elements.invert.checked,
        direction: elements.direction.value, padding: elements.padding.value, instruction: elements.instruction.value,
        channel: elements.channel.value || selectedProfile()?.cloud_channel, prompt: elements.prompt.value,
        negative: elements.negative.value, denoise: elements.denoise.value, seed: elements.seed.value });
      const fingerprint = JSON.stringify(body);
      if (!intent || intent.fingerprint !== fingerprint) intent = { fingerprint, id: `retouch-${crypto.randomUUID()}` };
      status("submitting");
      const job = await api.post(`episodes/${encodeURIComponent(episode.id)}/edit`, { ...body, idempotency_key: intent.id });
      status("submitted", {}, "success");
      await window.MioJobTracker.show(job);
      await window.MioJobTracker.recent(episode.id);
    } catch (error) {
      status(error.message === "emptyMask" ? "emptyMask" : error.message === "unfinishedStroke" ? "unfinishedStroke" : "submitError", { error: error.message }, "error");
    } finally { busy = false; update(); }
  };
  const onJobComplete = async (job) => {
    if (job.state === "completed") {
      episode = await api.get(`episodes/${encodeURIComponent(episode.id)}`);
      fillTakes(episode);
      await refreshPreview();
      status("completed", {}, "success");
    } else status("failed", { state: stateLabel(job.state) }, "error");
    update();
  };
  window.MioJobTracker.onComplete(onJobComplete);
  const init = async () => {
    api.localize();
    if (!api.session) { status("connect", {}, "error"); return; }
    try {
      seriesItems = await api.get("series");
      fillSeries();
      if (seriesItems.length) await refreshEpisodes();
      else status("noSeries");
    } catch (error) { status("seriesLoadError", { error: error.message }, "error"); }
    update();
  };
  elements.series.addEventListener("change", refreshEpisodes);
  elements.load.addEventListener("click", loadEpisode);
  elements.episodeSelect.addEventListener("change", update);
  elements.take.addEventListener("change", async () => {
    intent = null;
    maskUploads.clear();
    clearSource();
    try { await loadImage(elements.take.value); }
    catch (error) { status("imageError", { error: error.message }, "error"); }
    update();
  });
  elements.kind.addEventListener("change", chooseKind);
  elements.profile.addEventListener("change", update);
  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => {
    maskEditor.mode = button.dataset.tool;
    document.querySelectorAll("[data-tool]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    elements.canvas.style.cursor = maskEditor.mode === "eraser" ? "cell" : maskEditor.mode === "brush" ? "crosshair" : "crosshair";
  }));
  elements.brushSize.addEventListener("input", () => {
    maskEditor.brushSize = Number(elements.brushSize.value);
    elements.brushSizeValue.value = `${maskEditor.brushSize} px`;
    elements.brushSizeValue.textContent = `${maskEditor.brushSize} px`;
  });
  elements.feather.addEventListener("input", () => {
    elements.featherValue.value = `${elements.feather.value} px`;
    elements.featherValue.textContent = `${elements.feather.value} px`;
    intent = null;
  });
  elements.invert.addEventListener("change", () => { intent = null; maskEditor.render(); });
  elements.undo.addEventListener("click", () => maskEditor.undo());
  elements.redo.addEventListener("click", () => maskEditor.redo());
  elements.clear.addEventListener("click", () => maskEditor.clear());
  elements.submit.addEventListener("click", createJob);
  elements.newIntent.addEventListener("click", () => { intent = null; status("requestNew"); });
  elements.result.addEventListener("change", () => refreshPreview().catch((error) => status("imageError", { error: error.message }, "error")));
  elements.slider.addEventListener("input", setSlider);
  elements.adopt.addEventListener("click", async () => {
    const take = episode?.takes.find((item) => item.id === elements.result.value);
    if (!take || take.status === "adopted") return;
    if (!confirm(api.text("adoptConfirm"))) return;
    busy = true; update();
    try {
      episode = await api.post(`episodes/${encodeURIComponent(episode.id)}/takes/${encodeURIComponent(take.id)}/adopt`);
      fillTakes(episode);
      await refreshPreview();
      status("adopted", {}, "success");
    } catch (error) { status("adoptError", { error: error.message }, "error"); }
    finally { busy = false; update(); }
  });
  elements.jobRefresh.addEventListener("click", () => window.MioJobTracker.refresh().catch((error) => status("jobError", { error: error.message }, "error")));
  elements.jobId.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    window.MioJobTracker.refresh().catch((error) => status("jobError", { error: error.message }, "error"));
  });
  elements.jobId.addEventListener("change", () => update());
  elements.jobCancel.addEventListener("click", async () => {
    busy = true; update();
    try { await window.MioJobTracker.cancel(); status("cancelled", {}, "success"); }
    catch (error) { status("cancelError", { error: error.message }, "error"); }
    finally { busy = false; update(); }
  });
  elements.recent.addEventListener("change", () => {
    if (!elements.recent.value) return;
    elements.jobId.value = elements.recent.value;
    window.MioJobTracker.refresh().catch((error) => status("jobError", { error: error.message }, "error"));
  });
  elements.watch.addEventListener("change", () => {
    if (!elements.watch.checked) window.MioJobTracker.stop();
    else window.MioJobTracker.refresh().catch(() => {});
  });
  document.addEventListener("mio-context", () => { api.localize(); status("chooseEpisode"); });
  addEventListener("pagehide", () => { window.MioJobTracker.stop(); revoke(sourceUrl); for (const url of previewUrls) revoke(url); });
  window.MioJobApp = Object.freeze({ init, loadEpisode, createJob, status, onJobComplete });
  init();
})();
