(() => {
  const $ = (id) => document.getElementById(id);
  const { request, release } = panelBridge;
  let context, episode, series, renderIntent, currentJob, deriveIntent;
  let busy = false;
  const media = new Map();
  const chosen = (id) =>
    [...$(id).querySelectorAll("input:checked")].map((input) => input.value);
  const paths = () => ({ episode_id: context.episode_id });
  const notify = (text) => {
    $("status").textContent = text;
  };
  const option = (value, label) => new Option(label, value);
  const variantName = (take) =>
    take.variant_id
      ? (series.variants.find((variant) => variant.id === take.variant_id)
          ?.name ?? take.variant_id)
      : "原版";
  const clearMedia = () => {
    for (const item of media.values()) release(item.media_id);
    media.clear();
    $("comparison").replaceChildren();
  };
  const run = async (action) => {
    if (busy) return;
    busy = true;
    const controls = [...document.querySelectorAll("button,input,select")].map(
      (control) => [control, control.disabled],
    );
    for (const [control] of controls) control.disabled = true;
    try {
      await action();
    } catch (error) {
      notify(error.message);
    } finally {
      busy = false;
      for (const [control, disabled] of controls)
        if (control.isConnected) control.disabled = disabled;
    }
  };
  const choices = (id, items, selected = []) => {
    $(id).replaceChildren();
    for (const item of items) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.value = item.id;
      input.checked = selected.includes(item.id);
      input.addEventListener("change", () => {
        if (id === "versions") renderIntent = null;
      });
      label.append(input, document.createTextNode(item.name));
      $(id).append(label);
    }
    if (!items.length) $(id).textContent = "设定集中尚无此类预设。";
  };
  const versions = (selected = chosen("versions")) => {
    const previous = $("version").value;
    choices("versions", series.variants ?? [], selected);
    $("version").replaceChildren(
      option("", "原版"),
      option("*", "全部版本（跨版本对比）"),
      ...series.variants.map((variant) => option(variant.id, variant.name)),
    );
    if (
      previous === "*" ||
      series.variants.some((variant) => variant.id === previous)
    )
      $("version").value = previous;
  };
  const readEpisode = async () => {
    episode = await request("episode", { path_params: paths() });
  };
  $("load").addEventListener("click", () =>
    run(async () => {
      clearMedia();
      await readEpisode();
      series = await request("series", {
        path_params: { series_id: episode.series_id },
      });
      deriveIntent = null;
      $("target").replaceChildren(
        option("", "不替换"),
        ...series.bible.characters.map((character) =>
          option(character.id, character.name),
        ),
      );
      choices("styles", series.bible.styles);
      choices("characters", series.bible.characters);
      versions();
      $("panel").replaceChildren(
        ...[...episode.panels]
          .sort((a, b) => a.order - b.order)
          .map((panel, i) =>
            option(panel.id, `${i + 1} · ${panel.description || "未命名分幕"}`),
          ),
      );
      $("workspace").hidden = false;
      notify("已读取。选择预设保存版本，或查看已有版本。");
    }),
  );
  $("derive").addEventListener("click", () =>
    run(async () => {
      const signature = JSON.stringify([
        chosen("styles"),
        chosen("characters"),
        $("target").value,
        $("prefix").value,
      ]);
      if (deriveIntent?.signature !== signature)
        deriveIntent = {
          signature,
          additions: variantModel.derive(
            series,
            chosen("styles"),
            chosen("characters"),
            $("target").value,
            $("prefix").value,
          ),
        };
      const additions = deriveIntent.additions;
      series = await request("variants", {
        path_params: { series_id: series.id },
        body: { variants: additions },
      });
      versions(additions.map((variant) => variant.id));
      renderIntent = null;
      notify(`已保存 ${additions.length} 个版本，尚未开始生成。`);
    }),
  );
  $("candidates").addEventListener("input", () => {
    renderIntent = null;
  });
  $("render").addEventListener("click", () =>
    run(async () => {
      const ids = chosen("versions"),
        count = Number($("candidates").value);
      if (!ids.length) throw new Error("先勾选要生成的版本。");
      if (!Number.isInteger(count) || count < 1 || count > 16)
        throw new Error("每幕候选须为 1–16 张。");
      renderIntent ??= {
        variant_ids: ids,
        candidates: count,
        adopt_first: false,
        adopt_replace: false,
        idempotency_key: `variant-workshop-${crypto.randomUUID()}`,
      };
      currentJob = await request("render", {
        path_params: paths(),
        body: renderIntent,
      });
      $("job").textContent = `任务 ${currentJob.id} · ${currentJob.state}`;
      notify("已提交。点击刷新查看进度；成功后保留候选，需明确采用。");
    }),
  );
  $("refresh").addEventListener("click", () =>
    run(async () => {
      await readEpisode();
      if (currentJob) {
        currentJob = await request("job", {
          path_params: { job_id: currentJob.id },
        });
        const items = currentJob.items ?? [];
        const done = items.filter((item) =>
          ["complete", "skipped"].includes(item.state),
        ).length;
        const failed = items.filter((item) =>
          ["failed", "uncertain"].includes(item.state),
        ).length;
        $("job").textContent =
          `任务 ${currentJob.id} · ${currentJob.state} · 完成 ${done}/${items.length} · 失败 ${failed}`;
      }
      notify(
        "已刷新。生成请求重试会复用原幂等键；修改勾选或候选数才开始新一轮。",
      );
    }),
  );
  const compare = async (take, checked, input) => {
    if (!checked) {
      const image = media.get(take.id);
      if (image) release(image.media_id);
      media.delete(take.id);
      $("comparison")
        .querySelector(`[data-take="${CSS.escape(take.id)}"]`)
        ?.remove();
      return;
    }
    if (media.size >= 2) {
      input.checked = false;
      throw new Error("请先取消一张，再读取其他原图。");
    }
    const image = await request("take-image", {
      path_params: { ...paths(), take_id: take.id },
    });
    media.set(take.id, image);
    const figure = document.createElement("figure"),
      img = document.createElement("img"),
      caption = document.createElement("figcaption");
    figure.dataset.take = take.id;
    img.src = image.url;
    img.alt = `候选 ${take.id}`;
    caption.textContent = `${variantName(take)} · ${take.id} · ${take.status === "adopted" ? "已采用" : "候选"}`;
    figure.append(img, caption);
    $("comparison").append(figure);
  };
  const show = () => {
    clearMedia();
    $("takes").replaceChildren();
    const takes = variantModel.candidates(
      episode,
      $("panel").value,
      $("version").value || null,
    );
    for (const take of takes) {
      const row = document.createElement("div"),
        label = document.createElement("label"),
        input = document.createElement("input"),
        adopt = document.createElement("button");
      row.className = "take";
      input.type = "checkbox";
      label.append(
        input,
        document.createTextNode(
          `${variantName(take)} · ${take.status === "adopted" ? "已采用" : take.status === "rejected" ? "已弃用" : "候选"} · ${take.id}`,
        ),
      );
      input.addEventListener("change", () =>
        run(async () => {
          try {
            await compare(take, input.checked, input);
          } catch (error) {
            input.checked = false;
            throw error;
          }
        }),
      );
      adopt.textContent = "采用此图";
      adopt.disabled = take.status === "adopted";
      adopt.addEventListener("click", () =>
        run(async () => {
          episode = await request("adopt", {
            path_params: { ...paths(), take_id: take.id },
          });
          show();
          notify("已采用此版本的候选；其他版本保留。");
        }),
      );
      row.append(label, adopt);
      $("takes").append(row);
    }
    if (!takes.length) $("takes").textContent = "该分幕、该版本还没有候选图。";
  };
  $("show").addEventListener("click", () =>
    run(async () => {
      await readEpisode();
      show();
    }),
  );
  $("version").addEventListener("change", () => {
    clearMedia();
    $("takes").replaceChildren();
  });
  $("panel").addEventListener("change", () => {
    clearMedia();
    $("takes").replaceChildren();
  });
  $("export").addEventListener("click", () =>
    run(async () => {
      const variant_id = $("version").value || null;
      if (variant_id === "*") throw new Error("请先选择要导出的单个版本。");
      const body = { episode_ids: [episode.id], variant_id, lettered: true };
      const pdf = $("format").value === "pdf";
      const file = await request(pdf ? "export-pdf" : "export-album", {
        body: {
          ...body,
          ...(pdf ? { format: "pdf" } : { template_id: "export-monograph" }),
        },
      });
      notify(
        `已准备 ${file.filename}。点击面板外宿主提供的下载按钮保存，离线打开即可阅读。`,
      );
    }),
  );
  addEventListener("pagehide", clearMedia);
  panelBridge.initialized.then((value) => {
    context = value;
    $("load").disabled = !context?.episode_id;
    notify(
      context?.episode_id ? "点击读取作品开始。" : "请从具体话的扩展菜单打开。",
    );
  });
})();
