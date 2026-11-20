(() => {
  const api = window.MioPanel,
    jobs = window.MioJobs;
  const $ = (id) => document.getElementById(id);
  const editor = new window.MioMaskEditor(
    $("source-image"),
    $("mask"),
    $("mask-json"),
  );
  let episode,
    profiles = [],
    busy = false,
    intent = null;
  const selectedProfile = () =>
    profiles.find((p) => p.id === $("profile").value);
  const update = () => {
    $("load").disabled = busy || !api.context?.episode_id;
    $("submit").disabled = busy || !$("take").value || !$("profile").value;
    $("new-intent").disabled = busy || !episode;
    $("take").disabled = busy || !episode?.takes.length;
    $("profile").disabled = busy || !$("profile").options.length;
  };
  const stageInfo = () => {
    const profile = selectedProfile(),
      stage = profile?.edits?.[$("kind").value];
    $("profile-stages").textContent = stage
      ? `工作流：${stage.workflow_id} · ${stage.kind}`
      : "指令编辑将使用云端渠道；需要已配置图像编辑服务。";
  };
  const chooseKind = () => {
    const kind = $("kind").value,
      previous = $("profile").value;
    for (const mode of ["inpaint", "outpaint", "edit"])
      $(mode + "-fields").hidden = mode !== kind;
    $("mask-tools").hidden = kind !== "inpaint";
    $("mask").toggleAttribute("hidden", kind !== "inpaint");
    $("profile").replaceChildren();
    for (const p of profiles.filter((p) => {
      const stage = p.edits?.[kind];
      return (
        !p.binding_required &&
        (stage ? stage.enabled !== false : kind === "edit")
      );
    }))
      $("profile").add(new Option(p.name, p.id));
    if ([...$("profile").options].some((o) => o.value === previous))
      $("profile").value = previous;
    stageInfo();
    update();
  };
  const preview = async () => {
    const result = episode?.takes.find((take) => take.id === $("result").value);
    await Promise.all([
      api.image($("before-image"), result?.parent_take_id),
      api.image($("after-image"), result?.id),
    ]);
  };
  const displayEpisode = async (value, loadImage = false) => {
    const old = $("take").value,
      resultId = $("result").value;
    episode = value;
    $("take").replaceChildren();
    for (const take of episode.takes) {
      const panel = episode.panels.find((p) => p.id === take.panel_id);
      $("take").add(
        new Option(
          `第 ${(panel?.order ?? 0) + 1} 格 · ${take.status === "adopted" ? "已采用" : "候选"} · ${take.id}`,
          take.id,
        ),
      );
    }
    if (episode.takes.some((t) => t.id === old)) $("take").value = old;
    $("result").replaceChildren(new Option("选择精修候选对比原图", ""));
    const results = episode.takes.filter(
      (t) =>
        t.parent_take_id &&
        t.edits?.some((edit) =>
          ["inpaint", "outpaint", "edit"].includes(edit.kind),
        ),
    );
    for (const result of results)
      $("result").add(new Option(`${result.id} · ${result.status}`, result.id));
    if (results.some((t) => t.id === resultId)) $("result").value = resultId;
    else if (results.length) $("result").value = results.at(-1).id;
    if (loadImage) {
      editor.clear();
      await api.image($("source-image"), $("take").value);
    }
    await preview();
    update();
  };
  jobs.onComplete(async (job) => {
    await displayEpisode(await api.episode());
    api.status(
      job.state === "completed"
        ? "精修已完成。结果已作为新候选回流，可在下方对比或返回挑图页采用。"
        : `任务${job.state === "failed" ? "失败" : "已停止"}，请查看逐项状态。不会自动重试。`,
    );
  });
  $("load").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    update();
    api.status("正在读取候选与配置…");
    try {
      const [value, configs] = await Promise.all([
        api.episode(),
        api.request("profiles"),
      ]);
      profiles = configs;
      chooseKind();
      await displayEpisode(value, true);
      await jobs.recent("edit");
      api.status(
        !episode.takes.length
          ? "本话还没有候选图。请先生成候选。"
          : !$("profile").value
            ? "没有支持此编辑方式的已绑定配置，请在工作流配置中设置后重新读取。"
            : "选择原图和编辑方式，检查参数后明确提交。",
      );
    } catch (error) {
      api.status(error.message);
    } finally {
      busy = false;
      update();
    }
  });
  $("take").addEventListener("change", async () => {
    intent = null;
    editor.clear();
    try {
      await api.image($("source-image"), $("take").value);
    } catch (error) {
      api.status(error.message);
    }
  });
  $("kind").addEventListener("change", chooseKind);
  $("profile").addEventListener("change", stageInfo);
  $("new-intent").addEventListener("click", () => {
    intent = null;
    api.status("下一次提交将创建新的编辑任务。请检查当前参数后再提交。");
  });
  $("mask-mode").addEventListener("change", () => {
    editor.mode = $("mask-mode").value;
  });
  for (const [id, action] of [
    ["finish", () => editor.finish()],
    ["undo", () => editor.undo()],
    ["clear", () => editor.clear()],
    ["apply-mask", () => editor.applyText()],
  ])
    $(id).addEventListener("click", () => {
      try {
        action();
      } catch (error) {
        api.status(error.message);
      }
    });
  $("result").addEventListener("change", () =>
    preview().catch((error) => api.status(error.message)),
  );
  $("submit").addEventListener("click", async () => {
    if (busy) return;
    try {
      if ($("kind").value === "inpaint" && editor.points.length)
        throw new Error("请先完成或撤回正在绘制的多边形。");
      const body = window.MioRetouchLogic.body({
        take_id: $("take").value,
        profile_id: $("profile").value,
        kind: $("kind").value,
        mask: $("kind").value === "inpaint" ? editor.read() : null,
        feather: $("feather").value,
        pads: ["left", "top", "right", "bottom"].map(
          (side) => $("pad-" + side).value,
        ),
        instruction: $("instruction").value,
        channel: $("channel").value || selectedProfile()?.cloud_channel,
        prompt: $("prompt").value,
        negative: $("negative").value,
        denoise: $("denoise").value,
        seed: $("seed").value,
      });
      const fingerprint = JSON.stringify(body);
      if (!intent || intent.fingerprint !== fingerprint)
        intent = {
          fingerprint,
          body: { ...body, idempotency_key: `retouch-${crypto.randomUUID()}` },
        };
      busy = true;
      update();
      api.status("正在提交精修…");
      const job = await api.request("edit", {
        path_params: { episode_id: api.context.episode_id },
        body: intent.body,
      });
      api.status(
        `已提交精修任务 ${job.id}。原采用图保持，任务完成后新增候选。`,
      );
      await jobs.show(job);
    } catch (error) {
      api.status(
        `${error.message}\n未自动重试。可先刷新任务列表检查是否已创建，再按原参数重试。`,
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
        ? "点击「读取候选与配置」开始。"
        : "请从具体话的扩展菜单打开。",
    );
  });
})();
