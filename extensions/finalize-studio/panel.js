(() => {
  const api = window.MioPanel,
    jobs = window.MioJobs,
    logic = window.MioFinalizeLogic;
  const $ = (id) => document.getElementById(id);
  const t = (key, values) => window.MioFinalizeView.t(key, values);
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
    const source = episode && logic.rollbackSource(episode, $("result").value);
    $("rollback").disabled = busy || !source;
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
        title.textContent = `${stage.kind} · ${stage.workflow_id}${stage.enabled === false ? ` (${t("disabled")})` : ""}`;
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
      ? t(take.status === "adopted" ? "resultAdopted" : "resultCandidate")
      : t("resultDefault");
    await Promise.all([
      api.image($("before-image"), take?.parent_take_id),
      api.image($("after-image"), take?.id),
    ]);
    $("compare-empty").hidden =
      !!take &&
      !!$("before-image").getAttribute("src") &&
      !!$("after-image").getAttribute("src");
  };
  const updateSplit = () =>
    $("compare-view").style.setProperty("--split", `${$("compare-range").value}%`);
  const displayEpisode = async (value, keepSelection = true) => {
    const previous = keepSelection ? new Set(selected()) : new Set();
    const source = $("source").value,
      result = $("result").value;
    episode = value;
    $("takes").replaceChildren();
    $("source").replaceChildren(new Option(t("chooseSource"), ""));
    const eligible = logic.eligible(episode);
    for (const take of eligible) {
      const panel = episode.panels.find((p) => p.id === take.panel_id);
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.value = take.id;
      input.checked = previous.has(take.id);
      input.addEventListener("change", update);
      const text = t("selectedFrame", {
        n: (panel?.order ?? 0) + 1,
        width: take.width ?? "?",
        height: take.height ?? "?",
        id: take.id,
      });
      label.append(input, document.createTextNode(text));
      $("takes").append(label);
      $("source").add(new Option(text, take.id));
    }
    if (!eligible.length) {
      const text = document.createElement("p");
      text.textContent = t("emptyDrafts");
      $("takes").append(text);
    }
    $("source").value = eligible.some((t) => t.id === source)
      ? source
      : (eligible[0]?.id ?? "");
    const results = logic.comparisons(episode);
    $("result").replaceChildren(new Option(t("chooseResult"), ""));
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
        ? t("jobComplete")
        : t("jobPartial"),
    );
  });
  $("load").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    update();
    api.status(t("loading"));
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
          ? t("reviewBeforeRun")
          : t("noProfile"),
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
  $("compare-range").addEventListener("input", updateSplit);
  $("rollback").addEventListener("click", async () => {
    if (busy) return;
    const source = episode && logic.rollbackSource(episode, $("result").value);
    if (!source) return;
    busy = true;
    update();
    try {
      api.status(t("restoring"));
      const updated = await api.request("adopt", {
        path_params: {
          episode_id: api.context.episode_id,
          take_id: source.id,
        },
      });
      try {
        await displayEpisode(updated);
        api.status(t("restored"));
      } catch (error) {
        api.status(t("restorePreviewFailed", { message: error.message }));
      }
    } catch (error) {
      api.status(t("restoreFailed", { message: error.message }));
    } finally {
      busy = false;
      update();
    }
  });
  $("new-intent").addEventListener("click", () => {
    intent = null;
    api.status(t("newTaskHint"));
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
      api.status(t("submitting"));
      const job = await api.request("finalize", {
        path_params: { episode_id: api.context.episode_id },
        body: intent.body,
      });
      api.status(t("submitted", { id: job.id }));
      await jobs.show(job);
    } catch (error) {
      api.status(
        `${error.message}\n${t("retryHint")}`,
      );
    } finally {
      busy = false;
      update();
    }
  });
  api.onAppearance?.((appearance) => {
    window.MioFinalizeView?.apply(appearance);
    jobs.refreshLocale?.();
  });
  api.connect((context) => {
    update();
    api.status(
      context.episode_id
        ? t("openLoad")
        : t("noEpisode"),
    );
  });
})();
