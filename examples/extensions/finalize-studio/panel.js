(() => {
  const api = window.MioPanel,
    jobs = window.MioJobs,
    logic = window.MioFinalizeLogic;
  const $ = (id) => document.getElementById(id);
  let episode,
    profiles = [],
    intent = null,
    busy = false;
  const selected = () =>
    [...$("takes").querySelectorAll("input:checked")].map(
      (input) => input.value,
    );
  const profile = () => profiles.find((p) => p.id === $("profile").value);
  const update = () => {
    $("load").disabled = busy || !api.context?.episode_id;
    $("submit").disabled =
      busy || !selected().length || !profile() || !$("consent").checked;
    $("profile").disabled = busy || !$("profile").options.length;
    $("all").disabled = busy || !episode || !logic.eligible(episode).length;
    $("none").disabled = busy || !selected().length;
    $("new-intent").disabled = busy || !episode;
    $("takes")
      .querySelectorAll("input")
      .forEach((input) => {
        input.disabled = busy;
      });
  };
  const showStages = () => {
    const stages = profile()?.final ?? [];
    $("stages").replaceChildren(
      ...stages.map((stage) => {
        const li = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = `${stage.kind} · ${stage.workflow_id}${stage.enabled === false ? "（停用）" : ""}`;
        const details = document.createElement("pre");
        details.style.whiteSpace = "pre-wrap";
        details.style.overflowWrap = "anywhere";
        details.textContent = JSON.stringify(
          { values: stage.values ?? {}, feed: stage.feed ?? "previous" },
          null,
          2,
        );
        li.append(title, details);
        return li;
      }),
    );
    update();
  };
  const previewSource = () => api.image($("source-image"), $("source").value);
  const previewResult = async () => {
    const take = episode?.takes.find((t) => t.id === $("result").value);
    $("result-status").textContent = take
      ? `成品 · ${take.status === "adopted" ? "当前已采用" : "候选保留"}`
      : "成品";
    await Promise.all([
      api.image($("before-image"), take?.parent_take_id),
      api.image($("after-image"), take?.id),
    ]);
  };
  const displayEpisode = async (value, keepSelection = true) => {
    const previous = keepSelection ? new Set(selected()) : new Set();
    const source = $("source").value,
      result = $("result").value;
    episode = value;
    $("takes").replaceChildren();
    $("source").replaceChildren(new Option("选择一格查看原图", ""));
    const eligible = logic.eligible(episode);
    for (const take of eligible) {
      const panel = episode.panels.find((p) => p.id === take.panel_id);
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.value = take.id;
      input.checked = previous.has(take.id);
      input.addEventListener("change", update);
      const text = `第 ${(panel?.order ?? 0) + 1} 格 · ${take.width ?? "?"}×${take.height ?? "?"} · ${take.id}`;
      label.append(input, document.createTextNode(text));
      $("takes").append(label);
      $("source").add(new Option(text, take.id));
    }
    if (!eligible.length) {
      const text = document.createElement("p");
      text.textContent =
        "当前没有已采用的草稿。请先挑选采用，或在下方查看已有成品。";
      $("takes").append(text);
    }
    $("source").value = eligible.some((t) => t.id === source)
      ? source
      : (eligible[0]?.id ?? "");
    const results = logic.comparisons(episode);
    $("result").replaceChildren(new Option("选择成品对比原图", ""));
    for (const take of results)
      $("result").add(new Option(`${take.id} · ${take.status}`, take.id));
    $("result").value = results.some((t) => t.id === result)
      ? result
      : (results.at(-1)?.id ?? "");
    await Promise.all([previewSource(), previewResult()]);
    update();
  };
  jobs.onComplete(async (job) => {
    await displayEpisode(await api.episode());
    api.status(
      job.state === "completed"
        ? "成品已完成。请在下方逐格对比；原草稿继续保留。"
        : "任务未全部完成，请查看逐项状态。已有成功结果保留，不会自动重新出图。",
    );
  });
  $("load").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    update();
    api.status("正在读取已采用草稿与管线…");
    try {
      const [value, configs] = await Promise.all([
        api.episode(),
        api.request("profiles"),
      ]);
      const oldProfile = $("profile").value;
      profiles = configs.filter(
        (p) => !p.binding_required && p.final?.some((s) => s.enabled !== false),
      );
      $("profile").replaceChildren(
        ...profiles.map((p) => new Option(p.name, p.id)),
      );
      if (profiles.some((p) => p.id === oldProfile))
        $("profile").value = oldProfile;
      showStages();
      await displayEpisode(value);
      await jobs.recent("final");
      api.status(
        profiles.length
          ? "选择需要精修的已采用草稿，核对阶段和采用行为后再提交。"
          : "没有可运行的成品配置。请先在高级出图方案中配置成品阶段并绑定服务，再重新读取。",
      );
    } catch (error) {
      api.status(error.message);
    } finally {
      busy = false;
      update();
    }
  });
  $("all").addEventListener("click", () => {
    $("takes")
      .querySelectorAll("input")
      .forEach((input) => {
        input.checked = true;
      });
    update();
  });
  $("none").addEventListener("click", () => {
    $("takes")
      .querySelectorAll("input")
      .forEach((input) => {
        input.checked = false;
      });
    update();
  });
  $("profile").addEventListener("change", showStages);
  $("consent").addEventListener("change", update);
  $("source").addEventListener("change", () =>
    previewSource().catch((error) => api.status(error.message)),
  );
  $("result").addEventListener("change", () =>
    previewResult().catch((error) => api.status(error.message)),
  );
  $("new-intent").addEventListener("click", () => {
    intent = null;
    api.status("下一次提交会创建新任务。请重新检查所选草稿与阶段。");
  });
  $("submit").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    update();
    try {
      // Refresh immediately before submission: never rely on an old selection of adopted takes.
      const current = await api.episode();
      const body = logic.body(
        current,
        selected(),
        profile(),
        $("consent").checked,
      );
      const fingerprint = JSON.stringify(body);
      if (!intent || intent.fingerprint !== fingerprint)
        intent = {
          fingerprint,
          body: { ...body, idempotency_key: `finalize-${crypto.randomUUID()}` },
        };
      busy = true;
      update();
      api.status("正在提交成品管线…");
      const job = await api.request("finalize", {
        path_params: { episode_id: api.context.episode_id },
        body: intent.body,
      });
      api.status(`已提交成品任务 ${job.id}，每格依次执行配置中的有效阶段。`);
      await jobs.show(job);
    } catch (error) {
      api.status(
        `${error.message}\n未自动重试。可先读取近期任务，检查是否已创建后再按相同选择重试。`,
      );
    } finally {
      busy = false;
      update();
    }
  });
  api.connect((context) => {
    update();
    api.status(
      context.episode_id
        ? "点击「读取已采用草稿与配置」开始。"
        : "请从具体话的扩展菜单打开。",
    );
  });
})();
