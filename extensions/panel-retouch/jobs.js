(() => {
  const api = window.MioRetouch;
  const $ = (id) => document.getElementById(id);
  let timer = 0;
  let count = 0;
  let busy = false;
  let completion = async () => {};
  let state = "";
  const terminal = (value) => ["completed", "failed", "canceled"].includes(value);
  const stop = () => { clearTimeout(timer); timer = 0; };
  const show = async (job) => {
    state = job.state;
    $("job-id").value = job.id;
    const items = job.items || [];
    const done = items.filter((item) => ["complete", "skipped"].includes(item.state)).length;
    $("job-progress").max = Math.max(1, items.length);
    $("job-progress").value = done;
    const stateText = api.text(({ running: "running", queued: "queued", completed: "completedState", failed: "failedState", canceled: "canceledState", paused: "paused", uncertain: "uncertain" })[job.state] || job.state);
    $("job-state").textContent = api.text("done", { state: stateText, done, total: items.length }) + (job.error ? ` · ${typeof job.error === "string" ? job.error : JSON.stringify(job.error)}` : "");
    $("job-items").replaceChildren(...items.map((item) => {
      const row = document.createElement("li");
      const label = item.label || api.text("task", { number: (item.idx || 0) + 1 });
      row.textContent = `${label} · ${item.state}${item.error ? ` · ${typeof item.error === "string" ? item.error : JSON.stringify(item.error)}` : ""}`;
      return row;
    }));
    $("job-cancel").disabled = terminal(job.state);
    stop();
    if (terminal(job.state)) {
      if (job.id !== window.MioRetouchCompletedJob) {
        window.MioRetouchCompletedJob = job.id;
        await completion(job);
      }
      return;
    }
    if ($("watch").checked && count < 100) {
      count += 1;
      timer = setTimeout(() => void refresh().catch(() => {}), 5000);
    } else if (count >= 100) $("job-state").textContent = api.text("watchingLimit");
  };
  const refresh = async () => {
    if (busy || !$("job-id").value.trim()) return;
    stop();
    busy = true;
    try { await show(await api.get(`jobs/${encodeURIComponent($("job-id").value.trim())}`)); }
    finally { busy = false; }
  };
  const recent = async (episodeId) => {
    const jobs = await api.get(`jobs?owner=${encodeURIComponent(episodeId)}&limit=16`);
    const matches = jobs.filter((job) => job.snapshot?.purpose === "edit");
    const select = $("recent-jobs");
    select.replaceChildren(new Option(api.text("recent"), ""));
    for (const job of matches) select.add(new Option(`${job.title} · ${job.state}`, job.id));
  };
  const cancel = async () => {
    const id = $("job-id").value.trim();
    if (!id) return;
    stop();
    await show(await api.post(`jobs/${encodeURIComponent(id)}/cancel`));
  };
  window.MioJobTracker = Object.freeze({
    get state() { return state; },
    onComplete(callback) { completion = callback; },
    async show(job) { count = 0; window.MioRetouchCompletedJob = ""; await show(job); },
    recent,
    refresh,
    cancel,
    stop
  });
  addEventListener("pagehide", stop);
  window.addEventListener("DOMContentLoaded", () => {
    $("recent-jobs").replaceChildren(new Option(api.text("recent"), ""));
    $("job-refresh").addEventListener("click", () => void refresh().catch((error) => window.MioRetouchApp?.status("jobError", { error: error.message }, "error")));
  }, { once: true });
})();
