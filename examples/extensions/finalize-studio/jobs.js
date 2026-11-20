/* Job reads are bounded; submitting or retrying is always an explicit user action. */
(() => {
  const api = window.MioPanel;
  const $ = (id) => document.getElementById(id);
  const labels = {
    queued: "排队中",
    running: "处理中",
    paused: "已暂停",
    blocked: "等待处理",
    completed: "已完成",
    failed: "失败",
    canceled: "已取消",
    uncertain: "结果待核对",
    pending: "等待",
    sent: "已发送",
    complete: "完成",
    skipped: "跳过",
  };
  let timer,
    count = 0,
    busy = false,
    callback = () => {};
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
  const show = async (job) => {
    $("job-id").value = job.id;
    const items = job.items ?? [];
    const done = items.filter((item) =>
      ["complete", "skipped"].includes(item.state),
    ).length;
    $("job-progress").max = Math.max(1, items.length);
    $("job-progress").value = done;
    $("job-state").textContent =
      `${labels[job.state] ?? job.state} · ${done}/${items.length} 格${job.error ? ` · ${errorText(job.error)}` : ""}`;
    $("job-items").replaceChildren(
      ...items.map((item) => {
        const row = document.createElement("li");
        row.textContent = `${item.label || `第 ${item.idx + 1} 项`} · ${labels[item.state] ?? item.state}${item.error ? ` · ${errorText(item.error)}` : ""}`;
        return row;
      }),
    );
    $("job-cancel").disabled = terminal(job.state);
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
        "自动刷新已达到本次会话上限。可手动刷新；重新打开面板可继续跟踪任务。",
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
      list.replaceChildren(new Option("选择近期任务继续查看", ""));
      for (const job of matches)
        list.add(
          new Option(
            `${job.title} · ${labels[job.state] ?? job.state}`,
            job.id,
          ),
        );
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
