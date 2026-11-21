(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const { request, release, onAppearance } = panelBridge;
  const copy = {
    zh: {
      eyebrow: "创作工具 · 变体",
      title: "批量变体矩阵",
      lead: "从角色与画风预设组合版本。生成前会展示幕数、候选数与预计工作量；候选需明确采用。",
      load: "读取作品",
      deriveTitle: "派生版本",
      prefix: "名称前缀",
      prefixPlaceholder: "本轮",
      target: "替换外观的角色",
      stylesLegend: "画风预设（不选则沿用）",
      charactersLegend: "角色外观预设（不选则沿用）",
      derive: "保存派生版本",
      generateTitle: "生成与进度",
      panelsToRender: "要生成的分幕",
      selectAll: "全选",
      clear: "清除",
      candidates: "每幕候选",
      render: "生成所选版本",
      refresh: "刷新进度",
      compareTitle: "跨版本对比与采用",
      panel: "分幕",
      version: "版本",
      dimension: "对比维度",
      dimensionAll: "所有版本",
      dimensionStyle: "画风",
      dimensionAppearance: "角色外观",
      show: "读取候选",
      compareHint: "可同时打开两张原图并排比较。采用只影响此分幕与此版本。",
      exportTitle: "导出当前版本",
      exportHint: "只有已采用的分幕会进入导出成品。",
      format: "格式",
      export: "准备下载",
      connecting: "正在连接面板…",
      openEpisode: "请从具体话的扩展菜单打开。",
      loaded: "已读取。选择预设保存版本，或查看已有版本。",
      savedVariants: (n) => `已保存 ${n} 个版本，尚未开始生成。`,
      noPreset: "设定集中尚无此类预设。",
      original: "原版",
      noTarget: "不替换",
      chooseTarget: "先选择要替换外观的角色。",
      noStyle: "不选画风",
      noCharacter: "不选角色",
      noPanel: "尚无分幕。",
      noVariant: "尚无可生成版本，请先派生版本或勾选原版。",
      noPanelSelected: "先选择要生成的分幕。",
      estimate: (variants, panels, pairs, images) =>
        `${variants} 个版本 × ${panels} 幕 = ${pairs} 个分幕任务 · ${images} 张候选图`,
      matrixEstimate: (styles, characters, total, names, more) =>
        `将派生 ${styles} 种画风 × ${characters} 组角色外观，共 ${total} 个版本（每次最多 24 个）。${names}${more ? ` 等 ${more} 个组合` : ""}`,
      candidateLimit: "每幕候选须为 1–16 张。",
      deriveLimit: "组合超过 24 个版本，请减少预设。",
      chooseVersions: "先勾选要生成的版本。",
      submitted: "已提交。刷新查看进度；候选需明确采用。",
      job: (id, state, done, total, failed) =>
        `任务 ${id} · ${state} · 完成 ${done}/${total} · 失败 ${failed}`,
      noJob: "尚未提交任务。",
      refreshed: "已刷新进度。",
      readCompare: "最多同时读取两张原图，请先取消一张。",
      adopted: "已采用此候选；其他版本保留。",
      take: (variant, id, status) => `${variant} · ${status} · ${id}`,
      takeStatus: { adopted: "已采用", rejected: "已弃用", candidate: "候选" },
      adopt: "采用此图",
      noTakes: "该分幕、该版本还没有候选图。",
      originalCompare: "原版",
      versionName: (name) => name,
      imageAlt: (id) => `候选 ${id}`,
      exportOriginal: "原版",
      allVersions: "全部版本（跨版本对比）",
      versionExportOne: "请选择单个版本后导出。",
      downloadReady: (filename) => `已准备 ${filename}。点击面板外的下载按钮保存。`,
      noAdopted: "该版本还没有采用的分幕。",
      error: "操作失败。请重新读取数据后再试。",
      notLoaded: "请先读取作品。",
    },
    en: {
      eyebrow: "CREATION TOOL · VARIANTS",
      title: "Variant matrix",
      lead: "Combine character and style presets into variants. Review panel and candidate totals before rendering; candidates are adopted explicitly.",
      load: "Load work",
      deriveTitle: "Create variants",
      prefix: "Name prefix",
      prefixPlaceholder: "Batch",
      target: "Character to replace",
      stylesLegend: "Style presets (none keeps current style)",
      charactersLegend: "Character appearance presets (none keeps current appearance)",
      derive: "Save variants",
      generateTitle: "Render and progress",
      panelsToRender: "Panels to render",
      selectAll: "Select all",
      clear: "Clear",
      candidates: "Candidates per panel",
      render: "Render selected variants",
      refresh: "Refresh progress",
      compareTitle: "Compare and adopt variants",
      panel: "Panel",
      version: "Variant",
      dimension: "Compare dimension",
      dimensionAll: "All variants",
      dimensionStyle: "Style",
      dimensionAppearance: "Character appearance",
      show: "Load candidates",
      compareHint: "Load up to two source images side by side. Adoption affects only this panel and variant.",
      exportTitle: "Export this variant",
      exportHint: "Only adopted panels are included in the exported album.",
      format: "Format",
      export: "Prepare download",
      connecting: "Connecting panel…",
      openEpisode: "Open this panel from an episode’s Extensions menu.",
      loaded: "Loaded. Choose presets to save variants or review existing candidates.",
      savedVariants: (n) => `Saved ${n} variants. Rendering has not started.`,
      noPreset: "No presets of this type are available in the work bible.",
      original: "Original",
      noTarget: "No replacement",
      chooseTarget: "Choose the character whose appearance will be replaced.",
      noStyle: "No style preset",
      noCharacter: "No character preset",
      noPanel: "No panels are available.",
      noVariant: "No variants to render. Create variants or select the original.",
      noPanelSelected: "Select the panels to render first.",
      estimate: (variants, panels, pairs, images) =>
        `${variants} variants × ${panels} panels = ${pairs} panel jobs · ${images} candidate images`,
      matrixEstimate: (styles, characters, total, names, more) =>
        `Creates ${styles} styles × ${characters} character looks = ${total} variants (limit 24 per batch). ${names}${more ? ` and ${more} more` : ""}`,
      candidateLimit: "Candidates per panel must be 1–16.",
      deriveLimit: "This creates more than 24 variants. Reduce the preset selection.",
      chooseVersions: "Select the variants to render first.",
      submitted: "Submitted. Refresh to check progress; candidates are not adopted automatically.",
      job: (id, state, done, total, failed) =>
        `Job ${id} · ${state} · complete ${done}/${total} · failed ${failed}`,
      noJob: "No render job has been submitted.",
      refreshed: "Progress refreshed.",
      readCompare: "Load at most two source images. Deselect one before loading another.",
      adopted: "Candidate adopted. Other variants are unchanged.",
      take: (variant, id, status) => `${variant} · ${status} · ${id}`,
      takeStatus: { adopted: "Adopted", rejected: "Rejected", candidate: "Candidate" },
      adopt: "Adopt image",
      noTakes: "No candidates for this panel and variant yet.",
      originalCompare: "Original",
      versionName: (name) => name,
      imageAlt: (id) => `Candidate ${id}`,
      exportOriginal: "Original",
      allVersions: "All variants",
      versionExportOne: "Choose one variant to export.",
      downloadReady: (filename) => `Prepared ${filename}. Use the download button outside this panel.`,
      noAdopted: "This variant has no adopted panels yet.",
      error: "The operation failed. Reload the work and try again.",
      notLoaded: "Load the work first.",
    },
  };

  let context = null;
  let episode = null;
  let series = null;
  let currentJob = null;
  let renderIntent = null;
  let deriveIntent = null;
  let busy = false;
  const media = new Map();
  const lang = () => (context?.appearance?.locale === "en" ? "en" : "zh");
  const t = (key, ...values) => {
    const value = copy[lang()][key];
    return typeof value === "function" ? value(...values) : value ?? key;
  };
  const selected = (id) => [...$(id).querySelectorAll("input:checked")].map((input) => input.value);
  const paths = () => ({ episode_id: context.episode_id });
  const notify = (text, error = false) => {
    $("status").textContent = text;
    $("status").dataset.state = error ? "error" : "ok";
  };
  const option = (value, label) => new Option(label, value);
  const variantById = (id) => series.variants.find((variant) => variant.id === id);
  const variantName = (take) => (take.variant_id ? variantById(take.variant_id)?.name ?? take.variant_id : t("original"));
  const applyAppearance = (appearance = {}) => {
    const root = document.documentElement;
    const theme = typeof appearance.theme === "string" ? appearance.theme : "";
    if (theme) root.dataset.theme = theme;
    if (theme === "light" || theme === "dark") root.style.colorScheme = theme;
    const allowed = new Set([
      "bg", "bg-deep", "panel", "panel-2", "line", "text", "soft", "muted",
      "accent", "accent-strong", "on-accent", "red", "button-border", "control-surface",
      "control-border", "control-focus", "surface-panel", "surface-raised", "radius-control",
      "radius-card", "space-panel",
    ]);
    for (const [name, value] of Object.entries(appearance.tokens ?? {})) {
      const key = name.replace(/^--/, "");
      if (allowed.has(key) && typeof value === "string" && value.length <= 512)
        root.style.setProperty(`--${key}`, value);
      if (key === "radius-card" && typeof value === "string" && value.length <= 512)
        root.style.setProperty("--radius", value);
    }
    if (appearance.locale === "en" || appearance.locale === "zh-CN") {
      if (context) context.appearance = appearance;
      document.documentElement.lang = appearance.locale;
      document.querySelectorAll("[data-i18n]").forEach((node) => {
        const value = t(node.dataset.i18n);
        if (value) node.textContent = value;
      });
      document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
        const value = t(node.dataset.i18nPlaceholder);
        if (value) node.setAttribute("placeholder", value);
      });
      $("format").setAttribute("aria-label", t("format"));
      if (series && episode) {
        const versionIds = chosen("versions");
        const panelIds = selectedPanelIds();
        const selectedPanel = $("panel").value;
        const selectedVersion = $("version").value;
        $("target").replaceChildren(option("", t("noTarget")), ...series.bible.characters.map((character) => option(character.id, character.name)));
        buildChoices("styles", series.bible.styles, chosen("styles"));
        buildChoices("characters", series.bible.characters, chosen("characters"));
        buildVersions(versionIds);
        buildPanels(panelIds);
        if ([...$("panel").options].some((item) => item.value === selectedPanel)) $("panel").value = selectedPanel;
        if ([...$("version").options].some((item) => item.value === selectedVersion)) $("version").value = selectedVersion;
      }
      updateMatrixEstimate();
      updateRenderEstimate();
    }
  };
  const clearMedia = () => {
    for (const image of media.values()) release(image.media_id);
    media.clear();
    $("comparison").replaceChildren();
  };
  const run = async (action) => {
    if (busy) return;
    busy = true;
    const controls = [...document.querySelectorAll("button,input,select")].map((item) => [item, item.disabled]);
    for (const [item] of controls) item.disabled = true;
    try {
      await action();
    } catch (error) {
      notify(error?.message || t("error"), true);
    } finally {
      busy = false;
      for (const [item, disabled] of controls) if (item.isConnected) item.disabled = disabled;
      updateRenderEstimate();
    }
  };
  const chosen = (id) => selected(id);
  const buildChoices = (id, items, selectedIds = []) => {
    $(id).replaceChildren();
    if (!items.length) {
      $(id).textContent = t("noPreset");
      return;
    }
    for (const item of items) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item.id;
      input.checked = selectedIds.includes(item.id);
      input.addEventListener("change", () => {
        if (id === "versions") renderIntent = null;
        updateMatrixEstimate();
        updateRenderEstimate();
      });
      const name = document.createElement("span");
      name.textContent = item.name;
      label.append(input, name);
      $(id).append(label);
    }
  };
  const buildVersions = (selectedIds = chosen("versions")) => {
    const all = [{ id: "__base__", name: t("original") }, ...(series.variants ?? [])];
    $("versions").replaceChildren();
    for (const item of all) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item.id;
      input.checked = selectedIds.includes(item.id);
      input.addEventListener("change", () => {
        renderIntent = null;
        updateRenderEstimate();
      });
      const name = document.createElement("span");
      name.textContent = item.name;
      label.append(input, name);
      $("versions").append(label);
    }
    const previous = $("version").value;
    $("version").replaceChildren(
      option("", t("original")),
      option("*", t("allVersions")),
      ...(series.variants ?? []).map((variant) => option(variant.id, variant.name)),
    );
    if (previous === "*" || (series.variants ?? []).some((variant) => variant.id === previous))
      $("version").value = previous;
  };
  const buildPanels = (selectedIds) => {
    const panels = [...episode.panels].sort((a, b) => a.order - b.order);
    $("panel").replaceChildren(...panels.map((panel, index) => option(panel.id, `${index + 1} · ${panel.description || t("noPanel")}`)));
    $("render-panels").replaceChildren();
    if (!panels.length) {
      $("render-panels").textContent = t("noPanel");
      return;
    }
    for (const [index, panel] of panels.entries()) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = panel.id;
      input.checked = selectedIds ? selectedIds.includes(panel.id) : true;
      input.addEventListener("change", () => {
        renderIntent = null;
        updateRenderEstimate();
      });
      const name = document.createElement("span");
      name.textContent = `${index + 1} · ${panel.description || t("noPanel")}`;
      label.append(input, name);
      $("render-panels").append(label);
    }
  };
  const selectedVariantIds = () => chosen("versions").map((id) => id === "__base__" ? null : id);
  const selectedPanelIds = () => chosen("render-panels");
  const updateMatrixEstimate = () => {
    if (!series) return;
    const styleIds = chosen("styles");
    const characterIds = chosen("characters");
    const styles = Math.max(1, styleIds.length);
    const characters = Math.max(1, characterIds.length);
    const count = styles * characters;
    const missingTarget = characterIds.length > 0 && !$("target").value;
    const combinations = missingTarget || count > 24 ? [] : variantModel.derive(
      series,
      styleIds,
      characterIds,
      $("target").value,
      $("prefix").value,
      (index) => `preview-${index}`,
    );
    const preview = combinations.slice(0, 6).map((variant) => variant.name).filter(Boolean).join(" · ");
    const more = Math.max(0, combinations.length - 6);
    $("matrix-preview").textContent = missingTarget
      ? t("chooseTarget")
      : t("matrixEstimate", styles, characters, count, preview, more);
    $("derive").disabled = count > 24 || missingTarget;
    $("matrix-preview").dataset.overflow = String(count > 24);
  };
  const updateRenderEstimate = () => {
    if (!episode || !series) return;
    const variants = selectedVariantIds().length;
    const panels = selectedPanelIds().length;
    const candidates = Number($("candidates").value);
    if (!variants) {
      $("render-estimate").textContent = t("noVariant");
      $("render").disabled = true;
      return;
    }
    if (!panels) {
      $("render-estimate").textContent = t("noPanelSelected");
      $("render").disabled = true;
      return;
    }
    if (!Number.isInteger(candidates) || candidates < 1 || candidates > 16) {
      $("render-estimate").textContent = t("candidateLimit");
      $("render").disabled = true;
      return;
    }
    const pairs = variantModel.estimate(panels, variants, 1);
    const images = variantModel.estimate(panels, variants, candidates);
    $("render-estimate").textContent = t("estimate", variants, panels, pairs, images);
    $("render").disabled = false;
  };
  const readEpisode = async () => {
    episode = await request("episode", { path_params: paths() });
    series = await request("series", { path_params: { series_id: episode.series_id } });
  };
  const readWork = () => run(async () => {
    clearMedia();
    await readEpisode();
    deriveIntent = null;
    $("target").replaceChildren(option("", t("noTarget")), ...series.bible.characters.map((character) => option(character.id, character.name)));
    buildChoices("styles", series.bible.styles);
    buildChoices("characters", series.bible.characters);
    buildVersions([]);
    buildPanels();
    $("workspace").hidden = false;
    notify(t("loaded"));
    updateMatrixEstimate();
    updateRenderEstimate();
  });
  const derive = () => run(async () => {
    const styleIds = chosen("styles");
    const characterIds = chosen("characters");
    const targetId = $("target").value;
    const prefix = $("prefix").value;
    const signature = JSON.stringify([styleIds, characterIds, targetId, prefix]);
    if (deriveIntent?.signature !== signature)
      deriveIntent = {
        signature,
        additions: variantModel.derive(series, styleIds, characterIds, targetId, prefix),
      };
    const additions = deriveIntent.additions;
    series = await request("variants", { path_params: { series_id: series.id }, body: { variants: additions } });
    buildVersions(additions.map((variant) => variant.id));
    renderIntent = null;
    notify(t("savedVariants", additions.length));
    updateRenderEstimate();
  });
  const renderSelected = () => run(async () => {
    if (!series || !episode) throw new Error(t("notLoaded"));
    const variantIds = selectedVariantIds();
    const panelIds = selectedPanelIds();
    const count = Number($("candidates").value);
    if (!variantIds.length) throw new Error(t("chooseVersions"));
    if (!panelIds.length) throw new Error(t("noPanelSelected"));
    if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error(t("candidateLimit"));
    renderIntent ??= {
      panel_ids: panelIds,
      variant_ids: variantIds,
      candidates: count,
      adopt_first: false,
      adopt_replace: false,
      idempotency_key: `variant-workshop-${crypto.randomUUID()}`,
    };
    currentJob = await request("render", { path_params: paths(), body: renderIntent });
    $("job").textContent = t("job", currentJob.id, currentJob.state, 0, currentJob.total ?? 0, 0);
    notify(t("submitted"));
  });
  const refresh = () => run(async () => {
    if (!currentJob) { $("job").textContent = t("noJob"); return; }
    currentJob = await request("job", { path_params: { job_id: currentJob.id } });
    const items = currentJob.items ?? [];
    const done = items.filter((item) => ["complete", "skipped"].includes(item.state)).length;
    const failed = items.filter((item) => ["failed", "uncertain"].includes(item.state)).length;
    $("job").textContent = t("job", currentJob.id, currentJob.state, done, items.length || currentJob.total || 0, failed);
    await readEpisode();
    notify(t("refreshed"));
  });
  const compare = async (take, checked, input) => {
    if (!checked) {
      const image = media.get(take.id);
      if (image) release(image.media_id);
      media.delete(take.id);
      $("comparison").querySelector(`[data-take="${CSS.escape(take.id)}"]`)?.remove();
      return;
    }
    if (media.size >= 2) { input.checked = false; throw new Error(t("readCompare")); }
    const image = await request("take-image", { path_params: { ...paths(), take_id: take.id } });
    media.set(take.id, image);
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    const caption = document.createElement("figcaption");
    figure.dataset.take = take.id;
    img.src = image.url;
    img.alt = t("imageAlt", take.id);
    caption.textContent = `${variantName(take)} · ${take.id} · ${t("takeStatus")[take.status] ?? t("takeStatus").candidate}`;
    figure.append(img, caption);
    $("comparison").append(figure);
  };
  const candidatesForSelection = () => {
    const version = $("version").value;
    const dimension = $("dimension").value;
    if (version !== "*") return variantModel.candidates(episode, $("panel").value, version || null);
    let allowedVariants = series.variants ?? [];
    if (dimension !== "all") allowedVariants = variantModel.variantsForDimension(allowedVariants, dimension);
    const allowed = new Set(allowedVariants.map((variant) => variant.id));
    return (episode.takes ?? []).filter((take) => take.panel_id === $("panel").value && (!take.variant_id || allowed.has(take.variant_id)));
  };
  const show = () => {
    clearMedia();
    $("takes").replaceChildren();
    const takes = candidatesForSelection();
    for (const take of takes) {
      const row = document.createElement("div");
      row.className = "take";
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      const description = document.createElement("span");
      const state = t("takeStatus")[take.status] ?? t("takeStatus").candidate;
      description.textContent = t("take", variantName(take), take.id, state);
      label.append(input, description);
      input.addEventListener("change", () => run(async () => {
        try { await compare(take, input.checked, input); }
        catch (error) { input.checked = false; throw error; }
      }));
      const adopt = document.createElement("button");
      adopt.type = "button";
      adopt.textContent = t("adopt");
      adopt.disabled = take.status === "adopted";
      adopt.addEventListener("click", () => run(async () => {
        episode = await request("adopt", { path_params: { ...paths(), take_id: take.id } });
        show();
        notify(t("adopted"));
      }));
      row.append(label, adopt);
      $("takes").append(row);
    }
    if (!takes.length) $("takes").textContent = t("noTakes");
  };
  const exportCurrent = () => run(async () => {
    const variant_id = $("version").value || null;
    if (variant_id === "*") throw new Error(t("versionExportOne"));
    const body = { episode_ids: [episode.id], variant_id, lettered: true };
    const pdf = $("format").value === "pdf";
    const file = await request(pdf ? "export-pdf" : "export-album", {
      body: { ...body, ...(pdf ? { format: "pdf" } : { template_id: "export-monograph" }) },
    });
    notify(t("downloadReady", file.filename));
  });

  $("load").addEventListener("click", readWork);
  $("derive").addEventListener("click", derive);
  $("styles").addEventListener("change", updateMatrixEstimate);
  $("characters").addEventListener("change", updateMatrixEstimate);
  $("target").addEventListener("change", updateMatrixEstimate);
  $("prefix").addEventListener("input", updateMatrixEstimate);
  $("render").addEventListener("click", renderSelected);
  $("refresh").addEventListener("click", refresh);
  $("show").addEventListener("click", () => run(async () => { await readEpisode(); show(); }));
  $("select-panels").addEventListener("click", () => {
    $("render-panels").querySelectorAll("input[type=checkbox]").forEach((input) => { input.checked = true; });
    renderIntent = null;
    updateRenderEstimate();
  });
  $("clear-panels").addEventListener("click", () => {
    $("render-panels").querySelectorAll("input[type=checkbox]").forEach((input) => { input.checked = false; });
    renderIntent = null;
    updateRenderEstimate();
  });
  $("candidates").addEventListener("input", () => { renderIntent = null; updateRenderEstimate(); });
  $("version").addEventListener("change", () => { clearMedia(); $("takes").replaceChildren(); });
  $("dimension").addEventListener("change", () => { clearMedia(); $("takes").replaceChildren(); });
  $("panel").addEventListener("change", () => { clearMedia(); $("takes").replaceChildren(); });
  $("export").addEventListener("click", exportCurrent);
  addEventListener("pagehide", clearMedia);
  onAppearance(applyAppearance);
  panelBridge.initialized.then((value) => {
    context = value;
    applyAppearance(value.appearance ?? {});
    $("load").disabled = !context?.episode_id;
    notify(context?.episode_id ? t("loaded") : t("openEpisode"));
  });
})();
