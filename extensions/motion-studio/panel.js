(() => {
  "use strict";
  const bridge = window.MotionBridge;
  const model = window.MotionModel;
  const $ = (id) => document.getElementById(id);
  const MOVES = [
    "auto",
    "still",
    "push_in",
    "pull_out",
    "pan_left",
    "pan_right",
    "pan_up",
    "pan_down",
    "shake",
  ];
  const transitions = ["fade", "cut", "slide"];
  const keyframes = {
    still: [{ transform: "scale(1)" }, { transform: "scale(1.02)" }],
    push_in: [{ transform: "scale(1)" }, { transform: "scale(1.16)" }],
    pull_out: [{ transform: "scale(1.16)" }, { transform: "scale(1)" }],
    pan_left: [
      { transform: "scale(1.18) translateX(-6%)" },
      { transform: "scale(1.18) translateX(6%)" },
    ],
    pan_right: [
      { transform: "scale(1.18) translateX(6%)" },
      { transform: "scale(1.18) translateX(-6%)" },
    ],
    pan_up: [
      { transform: "scale(1.18) translateY(-6%)" },
      { transform: "scale(1.18) translateY(6%)" },
    ],
    pan_down: [
      { transform: "scale(1.18) translateY(6%)" },
      { transform: "scale(1.18) translateY(-6%)" },
    ],
  };
  const THEME_KEYS = [
    "--bg",
    "--bg-deep",
    "--panel",
    "--panel-2",
    "--text",
    "--soft",
    "--muted",
    "--line",
    "--accent",
    "--control-surface",
    "--control-border",
    "--control-focus",
    "--button-primary",
    "--button-primary-text",
    "--button-hover",
    "--surface-panel",
    "--surface-raised",
    "--radius-control",
  ];
  let context, episode, plan, current, media, animation, voiceTimer;
  let busy = false,
    unsafeWrite = false,
    invalidHold = false,
    previewing = false,
    imageRequest = 0;
  let playTimer = null,
    wakePlayback = null,
    speechToken = 0,
    finishSpeech = null;
  const drafts = new Map();
  const t = (key, vars) => model.text(context?.locale, key, vars);
  const text = (id, value) => {
    $(id).textContent = value;
  };
  const message = (key, vars) => text("status", t(key, vars));
  const panel = (id = current) =>
    episode?.panels.find((item) => item.id === id);
  const shot = (id = current) =>
    plan?.shots.find((item) => item.panel_id === id);
  const adopted = (id = current) =>
    episode?.takes.find(
      (take) =>
        take.panel_id === id && take.status === "adopted" && !take.variant_id,
    );
  const path = () => ({ episode_id: context.episode_id });
  const values = (id = current) =>
    drafts.get(id) ??
    panel(id)?.motion ?? { move: "auto", hold: null, transition: "fade" };
  const hold = (id = current) => values(id).hold ?? shot(id)?.auto_hold ?? 2;

  function setTheme(localeContext) {
    context = localeContext;
    const appearance = context?.appearance ?? context ?? {};
    const locale = appearance.locale ?? context?.locale;
    const tokens = appearance.tokens ?? context?.tokens ?? {};
    context = {
      ...context,
      locale,
      theme: appearance.theme ?? context?.theme,
      tokens,
    };
    document.documentElement.lang =
      model.language(locale) === "en" ? "en" : "zh-CN";
    document.documentElement.style.colorScheme =
      appearance.theme === "dark"
        ? "dark"
        : appearance.theme === "light"
          ? "light"
          : "light dark";
    for (const key of THEME_KEYS) {
      const value = tokens[key] ?? tokens[key.replace(/^--/, "")];
      if (
        typeof value === "string" &&
        value.length < 160 &&
        !/url\s*\(/i.test(value)
      )
        document.documentElement.style.setProperty(key, value);
    }
    document.querySelectorAll("[data-copy]").forEach((node) => {
      node.textContent = t(node.dataset.copy);
    });
    $("hold").placeholder = t("holdPlaceholder");
    $("voice-preview").title = window.speechSynthesis
      ? t("voicePreview")
      : t("voiceUnsupported");
    if (!window.speechSynthesis)
      $("voice-preview").textContent = t("voiceUnsupported");
    $("shots").dataset.empty = t("emptyTimeline");
  }

  function release() {
    $("image").removeAttribute("src");
    $("image").hidden = true;
    bridge.release(media?.media_id);
    media = null;
  }
  function stopAnimation() {
    animation?.cancel();
    animation = null;
    $("camera").style.transform = "";
    $("scrub").value = "0";
    $("play").textContent = previewing ? t("stopPreview") : t("previewShot");
  }
  function stopVoice() {
    speechToken += 1;
    clearTimeout(voiceTimer);
    voiceTimer = null;
    window.speechSynthesis?.cancel();
    text("preview-subtitle", "");
    const resolve = finishSpeech;
    finishSpeech = null;
    resolve?.(false);
  }
  function delay(ms) {
    return new Promise((resolve) => {
      wakePlayback = resolve;
      playTimer = setTimeout(() => {
        playTimer = null;
        wakePlayback = null;
        resolve();
      }, ms);
    });
  }
  function stopPreview() {
    previewing = false;
    clearTimeout(playTimer);
    playTimer = null;
    const wake = wakePlayback;
    wakePlayback = null;
    wake?.();
    stopAnimation();
    stopVoice();
    $("play").textContent = t("previewShot");
  }
  function update() {
    const hasCurrent = Boolean(current && shot());
    $("load").disabled = busy || !context?.episode_id;
    [
      "move",
      "hold",
      "transition",
      "automatic-reset",
      "save",
      "aspect",
      "lettered",
      "subtitles",
      "voice",
    ].forEach((id) => {
      $(id).disabled = busy || !hasCurrent || (unsafeWrite && id === "save");
    });
    $("save").disabled ||= !drafts.has(current) || invalidHold;
    $("export").disabled =
      busy ||
      unsafeWrite ||
      invalidHold ||
      drafts.size > 0 ||
      !plan?.shots.some((item) => item.has_image);
    $("play").disabled = busy || !plan?.shots.some((item) => item.has_image);
    $("voice-preview").disabled =
      busy || !hasCurrent || !shot().lines.length || !window.speechSynthesis;
    $("fullscreen").disabled = !plan?.shots.length;
    text(
      "dirty",
      drafts.size ? t("dirty", { count: drafts.size }) : t("clean"),
    );
    document.querySelectorAll(".shot").forEach((button) => {
      button.disabled = busy;
    });
  }

  function drawTimeline() {
    $("shots").replaceChildren();
    (plan?.shots ?? []).forEach((item) => {
      const button = document.createElement("button");
      button.className = "shot";
      button.type = "button";
      button.dataset.id = item.panel_id;
      button.setAttribute("aria-pressed", String(current === item.panel_id));
      const title = document.createElement("strong");
      title.textContent = `${t("shotNumber", { n: item.index + 1 })}${drafts.has(item.panel_id) ? " · " + t("unsaved") : ""}`;
      const detail = document.createElement("span");
      const motion = values(item.panel_id);
      const actualMove = motion.move === "auto" ? item.auto_move : motion.move;
      detail.textContent = `${model.movement(context?.locale, actualMove)} · ${t("duration", { value: hold(item.panel_id) })}${item.has_image ? "" : " · " + t("noAdoptedLabel")}`;
      button.append(title, detail);
      button.addEventListener("click", () => void select(item.panel_id));
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = plan.shots.findIndex(
          (candidate) => candidate.panel_id === item.panel_id,
        );
        const next =
          plan.shots[
            Math.max(
              0,
              Math.min(
                plan.shots.length - 1,
                index + (event.key === "ArrowRight" ? 1 : -1),
              ),
            )
          ];
        $("shots")
          .querySelector(`[data-id="${CSS.escape(next.panel_id)}"]`)
          ?.focus();
      });
      $("shots").append(button);
    });
    const playable = plan?.shots.filter((item) => item.has_image).length ?? 0;
    text(
      "total",
      t("timelineTotal", {
        shots: plan?.shots.length ?? 0,
        playable,
        seconds: plan?.total_seconds ?? 0,
      }),
    );
  }

  function showFields() {
    const selected = shot();
    if (!selected) return;
    invalidHold = false;
    $("hold").setCustomValidity("");
    const value = values();
    $("move").value = MOVES.includes(value.move) ? value.move : "auto";
    $("hold").value = value.hold ?? "";
    $("transition").value = transitions.includes(value.transition)
      ? value.transition
      : "fade";
    text(
      "automatic",
      t("autoSuggested", {
        move: model.movement(context?.locale, selected.auto_move),
        seconds: selected.auto_hold,
      }),
    );
    text("shot-title", t("shotNumber", { n: selected.index + 1 }));
    text("shot-description", selected.description || t("noDescription"));
    text(
      "subtitle",
      selected.lines
        .map((line) => `${line.speaker ? `${line.speaker}: ` : ""}${line.text}`)
        .join("\n"),
    );
    $("stage").dataset.transition = $("transition").value;
    drawTimeline();
    update();
  }

  async function select(id, fromPlayback = false) {
    if (busy) return;
    if (!fromPlayback) stopPreview();
    else stopAnimation();
    release();
    current = id;
    const token = ++imageRequest;
    showFields();
    const take = adopted();
    $("blank").hidden = false;
    $("blank").textContent = take ? t("imageLoading") : t("noAdopted");
    if (!take) {
      update();
      return;
    }
    try {
      const result = await bridge.request("take-image", {
        path_params: { ...path(), take_id: take.id },
      });
      if (token !== imageRequest) {
        bridge.release(result.media_id);
        return;
      }
      media = result;
      $("image").src = result.url;
      $("image").alt = `${t("selectShot")} ${shot().index + 1}`;
      $("image").hidden = false;
      $("blank").hidden = true;
      update();
    } catch (error) {
      if (token === imageRequest) {
        $("blank").textContent = error?.message || t("imageError");
        update();
      }
    }
  }

  async function load(discard = false) {
    if (busy) return;
    if (drafts.size && !discard) {
      $("discard-confirm").hidden = false;
      $("discard").focus();
      return;
    }
    $("discard-confirm").hidden = true;
    busy = true;
    $("editor").hidden = true;
    update();
    stopPreview();
    release();
    ++imageRequest;
    let nextCurrent = null;
    try {
      const [nextEpisode, nextPlan] = await Promise.all([
        bridge.request("episode", { path_params: path() }),
        bridge.request("motion-plan", { path_params: path() }),
      ]);
      episode = nextEpisode;
      plan = nextPlan;
      unsafeWrite = false;
      invalidHold = false;
      drafts.clear();
      $("move").replaceChildren();
      MOVES.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = model.movement(context?.locale, value);
        $("move").append(option);
      });
      $("editor").hidden = !plan.shots.length;
      drawTimeline();
      message(plan.shots.length ? "loaded" : "emptyShots");
      if (plan.shots.length)
        nextCurrent = plan.shots.some((item) => item.panel_id === current)
          ? current
          : plan.shots[0].panel_id;
    } catch (error) {
      message("requestError", { message: error?.message ?? "unknown error" });
    } finally {
      busy = false;
      update();
    }
    if (nextCurrent) await select(nextCurrent);
  }

  function edit() {
    const raw = $("hold").value.trim();
    const seconds = raw === "" ? null : Number(raw);
    invalidHold =
      $("hold").validity.badInput ||
      (seconds !== null &&
        (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 30));
    if (invalidHold) {
      $("hold").setCustomValidity(t("holdInvalid"));
      $("hold").reportValidity();
      update();
      return false;
    }
    $("hold").setCustomValidity("");
    const next = {
      move: $("move").value,
      hold: seconds,
      transition: $("transition").value,
    };
    const original = panel()?.motion ?? {
      move: "auto",
      hold: null,
      transition: "fade",
    };
    const equivalent =
      next.move === original.move &&
      next.hold === (original.hold ?? null) &&
      next.transition === (original.transition ?? "fade");
    if (equivalent) drafts.delete(current);
    else drafts.set(current, next);
    $("stage").dataset.transition = next.transition;
    stopAnimation();
    drawTimeline();
    update();
    return true;
  }

  function animate(play = true) {
    stopAnimation();
    if (!media || typeof $("camera").animate !== "function") return;
    const chosen = values().move === "auto" ? shot().auto_move : values().move;
    const frames =
      chosen === "shake"
        ? [
            { transform: "scale(1.06) translate(0,0)", offset: 0 },
            { transform: "scale(1.06) translate(-1.6%,1%)", offset: 0.03 },
            { transform: "scale(1.06) translate(1.4%,-1.2%)", offset: 0.06 },
            { transform: "scale(1.06) translate(0,0)", offset: 0.16 },
            { transform: "scale(1.1)", offset: 1 },
          ]
        : (keyframes[chosen] ?? keyframes.still);
    animation = $("camera").animate(frames, {
      duration: hold() * 1000,
      fill: "both",
      easing: "linear",
    });
    if (!play || matchMedia("(prefers-reduced-motion: reduce)").matches)
      animation.pause();
  }

  function speechVoice(line) {
    const voices = window.speechSynthesis.getVoices();
    const wanted = String(context?.locale || "zh-CN").toLowerCase();
    return (
      voices.find((voice) => voice.lang.toLowerCase() === wanted) ??
      voices.find((voice) =>
        voice.lang.toLowerCase().startsWith(wanted.slice(0, 2)),
      ) ??
      voices[0] ??
      null
    );
  }
  function speak(lines) {
    stopVoice();
    const utterances = model.speakable(lines);
    if (!utterances.length || !window.speechSynthesis)
      return Promise.resolve(false);
    if (!window.speechSynthesis.getVoices().length) {
      message("noVoices");
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      let index = 0,
        done = false;
      const token = speechToken;
      finishSpeech = resolve;
      const finish = (success) => {
        if (done || token !== speechToken) return;
        done = true;
        clearTimeout(voiceTimer);
        text("preview-subtitle", "");
        finishSpeech = null;
        resolve(success);
      };
      const next = () => {
        if (done || token !== speechToken) return;
        clearTimeout(voiceTimer);
        if (index >= utterances.length) {
          finish(true);
          return;
        }
        const line = utterances[index++];
        text(
          "preview-subtitle",
          `${line.speaker ? line.speaker + " · " : ""}${line.text}`,
        );
        const utterance = new SpeechSynthesisUtterance(line.text);
        utterance.lang = context?.locale || "zh-CN";
        utterance.pitch = Math.max(0.1, Math.min(2, line.voice?.pitch || 1));
        utterance.rate = Math.max(0.5, Math.min(2, line.voice?.rate || 1));
        utterance.voice = speechVoice(line);
        utterance.onend = () => {
          if (!done && token === speechToken) next();
        };
        utterance.onerror = () => {
          if (!done && token === speechToken) next();
        };
        window.speechSynthesis.speak(utterance);
        voiceTimer = setTimeout(
          () => {
            if (!done) next();
          },
          Math.max(3500, model.speechSeconds([line]) * 2500 + 2500),
        );
      };
      next();
    });
  }

  async function playEpisode() {
    if (previewing) {
      stopPreview();
      message("previewStopped");
      return;
    }
    if (!plan?.shots.length) return;
    let incomingTransition = "cut";
    previewing = true;
    text(
      "play",
      t("stopPreview"),
    );
    message("previewStarted");
    for (const item of plan.shots) {
      if (!previewing) break;
      await select(item.panel_id, true);
      if (!previewing) break;
      if (!media) continue;
      if (incomingTransition === "fade")
        $("stage").animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 450,
        });
      else if (incomingTransition === "slide")
        $("camera").animate(
          [{ transform: "translateX(7%)" }, { transform: "translateX(0)" }],
          { duration: 350 },
        );
      animate(true);
      text(
        "play",
        t("stopPreview"),
      );
      const minimum = delay(hold(item.panel_id) * 1000);
      const voice = $("voice").checked
        ? speak(item.lines)
        : Promise.resolve(false);
      if ($("voice").checked && item.lines.length)
        await Promise.all([minimum, voice]);
      else await minimum;
      if (!previewing) break;
      incomingTransition = values(item.panel_id).transition || "fade";
      if (incomingTransition !== "cut") await delay(350);
    }
    const completed = previewing;
    previewing = false;
    stopAnimation();
    stopVoice();
    $("play").textContent = t("previewShot");
    if (completed) message("previewDone");
  }

  $("load").addEventListener("click", () => void load());
  $("discard").addEventListener("click", () => void load(true));
  function keepDrafts() {
    $("discard-confirm").hidden = true;
    $("load").focus();
  }
  $("keep").addEventListener("click", keepDrafts);
  $("discard-confirm").addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    keepDrafts();
  });
  $("move").addEventListener("change", edit);
  $("hold").addEventListener("input", edit);
  $("transition").addEventListener("change", edit);
  $("automatic-reset").addEventListener("click", () => {
    invalidHold = false;
    $("hold").setCustomValidity("");
    drafts.set(current, {
      move: "auto",
      hold: null,
      transition: $("transition").value || "fade",
    });
    showFields();
    animate(false);
  });
  $("play").addEventListener("click", () => {
    if (drafts.size && drafts.has(current)) {
      if (!edit()) return;
    }
    void playEpisode();
  });
  $("voice-preview").addEventListener("click", async () => {
    if (!edit()) return;
    message("previewVoiceStarted");
    const ok = await speak(shot().lines);
    message(ok ? "previewVoiceDone" : "noVoices");
  });
  $("scrub").addEventListener("input", () => {
    const percent = Number($("scrub").value);
    if (!animation) animate(false);
    if (animation) {
      animation.pause();
      animation.currentTime = hold() * 10 * percent;
    }
    $("scrub").value = String(percent);
  });
  $("aspect").addEventListener("change", () => {
    $("stage").dataset.aspect = $("aspect").value;
  });
  $("fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("stage").requestFullscreen?.();
    } catch {
      message("fullScreenError");
    }
  });
  $("save").addEventListener("click", async () => {
    if (!edit() || busy || unsafeWrite || !drafts.has(current)) return;
    busy = true;
    update();
    try {
      episode = await bridge.request("patch-panel", {
        path_params: { ...path(), panel_id: current },
        body: {
          changes: { motion: drafts.get(current) },
          revision: episode.revision,
        },
      });
      drafts.delete(current);
      plan = await bridge.request("motion-plan", { path_params: path() });
      showFields();
      message("saveSuccess");
    } catch (error) {
      unsafeWrite = true;
      message("readAgain");
      $("status").setAttribute("aria-label", error?.message || "save failed");
    } finally {
      busy = false;
      update();
    }
  });
  $("export").addEventListener("click", async () => {
    if (busy || unsafeWrite || drafts.size) {
      if (drafts.size) message("draftNotice");
      return;
    }
    busy = true;
    update();
    try {
      const result = await bridge.request("export-motion", {
        body: {
          episode_id: context.episode_id,
          aspect: $("aspect").value,
          lettered: $("lettered").checked,
          subtitles: $("subtitles").checked,
          voice: $("voice").checked,
          lang: document.documentElement.lang,
          max_width: 1280,
        },
      });
      if (result.download_ready)
        message("exportReady", { filename: result.filename });
      else message("downloadError");
    } catch (error) {
      message("requestError", { message: error?.message ?? "unknown error" });
    } finally {
      busy = false;
      update();
    }
  });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (previewing) {
        stopPreview();
        message("previewStopped");
      }
      if (document.fullscreenElement) void document.exitFullscreen();
    }
  });
  addEventListener("pagehide", () => {
    stopPreview();
    release();
  });
  bridge.ready((value) => {
    setTheme(value);
    message(context?.episode_id ? "clickLoad" : "openFromEpisode");
    update();
  });
})();
