/* Job reads are bounded; submitting or retrying is always an explicit user action. */
(() => {
  const api = window.MioPanel;
  const t = (key, values) => window.MioFinalizeView.t(key, values);
  const $ = (id) => document.getElementById(id);
  const labels = {
    queued: "finalQueued",
    running: "finalRunning",
    paused: "finalPaused",
    blocked: "finalBlocked",
    completed: "finalCompleted",
    failed: "finalFailed",
    canceled: "finalCanceled",
    uncertain: "finalUncertain",
    pending: "finalPending",
    sent: "finalSent",
    complete: "finalComplete",
    skipped: "finalSkipped",
  };
  let timer,
    count = 0,
    busy = false,
    callback = () => {},
    lastJob = null;
  let completedId = null;
  const errorText = (value) =>
    typeof value === "string"
      ? value
      : (value?.message ?? value?.detail ?? JSON.stringify(value));
  const terminal = (state) =>
    ["completed", "failed", "canceled"].includes(state);
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const paint = (job) => {
    const items = job.items ?? [];
    const done = items.filter((item) => ["complete", "skipped"].includes(item.state)).length;
    $("job-id").value = job.id;
    $("job-progress").max = Math.max(1, items.length);
    $("job-progress").value = done;
    $("job-state").textContent =
      `${t("progressValue", { state: labels[job.state] ? t(labels[job.state]) : job.state, done, total: items.length })}${job.error ? ` · ${errorText(job.error)}` : ""}`;
    $("job-items").replaceChildren(
      ...items.map((item) => {
        const row = document.createElement("li");
        row.textContent = `${item.label || t("progressItem", { n: item.idx + 1 })} · ${labels[item.state] ? t(labels[item.state]) : item.state}${item.error ? ` · ${errorText(item.error)}` : ""}`;
        return row;
      }),
    );
    $("job-cancel").disabled = terminal(job.state);
  };
  const show = async (job) => {
    lastJob = job;
    paint(job);
    if (terminal(job.state) && completedId !== job.id) {
      completedId = job.id;
      await callback(job);
    }
    stop();
    if (!terminal(job.state) && $("watch").checked && count < 100) {
      count += 1;
      timer = setTimeout(refresh, 5000);
    } else if (!terminal(job.state) && count >= 100) {
      api.status(
        t("autoRefreshLimit"),
      );
    }
  };
  const refresh = async () => {
    if (busy || !$("job-id").value.trim()) return;
    stop();
    busy = true;
    try {
      await show(
        await api.request("job", {
          path_params: { job_id: $("job-id").value.trim() },
        }),
      );
    } catch (error) {
      api.status(error.message);
    } finally {
      busy = false;
    }
  };
  $("job-refresh").addEventListener("click", refresh);
  $("watch").addEventListener("change", () => {
    stop();
    if ($("watch").checked) refresh();
  });
  $("job-cancel").addEventListener("click", async () => {
    if (busy || !$("job-id").value.trim()) return;
    busy = true;
    stop();
    try {
      await show(
        await api.request("cancel", {
          path_params: { job_id: $("job-id").value.trim() },
        }),
      );
    } catch (error) {
      api.status(error.message);
    } finally {
      busy = false;
    }
  });
  addEventListener("pagehide", stop);
  window.MioJobs = {
    onComplete(fn) {
      callback = fn;
    },
    async show(job) {
      count = 0;
      completedId = null;
      await show(job);
    },
    async recent(purpose) {
      const jobs = await api.request("jobs", {
        query: { owner: api.context.episode_id, limit: 16 },
      });
      const matches = jobs.filter((job) => job.snapshot?.purpose === purpose);
      const list = $("recent-jobs");
      list.replaceChildren(new Option(t("continueJobs"), ""));
      for (const job of matches)
        list.add(
          new Option(
            `${job.title} · ${labels[job.state] ?? job.state}`,
            job.id,
          ),
        );
    },
    refreshLocale() {
      if (lastJob) paint(lastJob);
    },
  };
  $("recent-jobs").addEventListener("change", () => {
    if (!$("recent-jobs").value) return;
    $("job-id").value = $("recent-jobs").value;
    count = 0;
    completedId = null;
    refresh();
  });
})();
