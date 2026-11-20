/* Camera edits use the host's Panel.motion model and revision checks. */
(() => {
  "use strict";
  const bridge = window.MotionBridge;
  const $ = (id) => document.getElementById(id);
  const labels = {
    auto: "按分镜自动",
    still: "静止",
    push_in: "推近",
    pull_out: "拉远",
    pan_left: "向左摇移",
    pan_right: "向右摇移",
    pan_up: "向上摇移",
    pan_down: "向下摇移",
    shake: "轻震",
  };
  const frames = {
    still: ["scale(1)", "scale(1.02)"],
    push_in: ["scale(1)", "scale(1.16)"],
    pull_out: ["scale(1.16)", "scale(1)"],
    pan_left: ["scale(1.18) translateX(-6%)", "scale(1.18) translateX(6%)"],
    pan_right: ["scale(1.18) translateX(6%)", "scale(1.18) translateX(-6%)"],
    pan_up: ["scale(1.18) translateY(-6%)", "scale(1.18) translateY(6%)"],
    pan_down: ["scale(1.18) translateY(6%)", "scale(1.18) translateY(-6%)"],
  };
  let context, episode, plan, current, media, animation;
  let busy = false;
  let unsafeWrite = false;
  let invalidHold = false;
  let imageRequest = 0;
  const drafts = new Map();
  const message = (text) => {
    $("status").textContent = text;
  };
  const path = () => ({ episode_id: context.episode_id });
  const panel = () => episode?.panels.find((item) => item.id === current);
  const shot = () => plan?.shots.find((item) => item.panel_id === current);
  const values = () =>
    drafts.get(current) ?? panel()?.motion ?? { move: "auto", hold: null };
  const hold = () => values().hold ?? shot()?.auto_hold ?? 2;
  const move = () =>
    values().move === "auto" ? shot()?.auto_move : values().move;
  const adopted = () =>
    episode?.takes.find(
      (take) =>
        take.panel_id === current &&
        take.status === "adopted" &&
        !take.variant_id,
    );
  function update() {
    $("load").disabled = busy || !context?.episode_id;
    [
      "move",
      "hold",
      "automatic-reset",
      "save",
      "aspect",
      "lettered",
      "subtitles",
      "voice",
    ].forEach((id) => {
      $(id).disabled =
        busy || !current || (unsafeWrite && ["save"].includes(id));
    });
    $("save").disabled ||= !drafts.has(current) || invalidHold;
    $("export").disabled =
      busy ||
      unsafeWrite ||
      invalidHold ||
      drafts.size > 0 ||
      !plan?.shots.some((item) => item.has_image);
    $("play").disabled = busy || !media;
    $("dirty").textContent = drafts.size
      ? `${drafts.size} 个镜头尚未保存`
      : "镜头设置已与作品同步";
    document.querySelectorAll(".shot").forEach((button) => {
      button.disabled = busy;
    });
  }
  function stop() {
    animation?.cancel();
    animation = null;
    $("camera").style.transform = "";
    $("scrub").value = "0";
    $("play").textContent = "预览本镜";
  }
  function keyframes() {
    if (move() === "shake")
      return [
        { transform: "scale(1.06) translate(0,0)", offset: 0 },
        { transform: "scale(1.06) translate(-1.6%,1%)", offset: 0.03 },
        { transform: "scale(1.06) translate(1.4%,-1.2%)", offset: 0.06 },
        { transform: "scale(1.06) translate(-1%,-.6%)", offset: 0.09 },
        { transform: "scale(1.06) translate(.8%,1%)", offset: 0.12 },
        { transform: "scale(1.06) translate(0,0)", offset: 0.16 },
        { transform: "scale(1.1) translate(0,0)", offset: 1 },
      ];
    return (frames[move()] ?? frames.still).map((transform) => ({ transform }));
  }
  function animate(play) {
    stop();
    if (!media) return;
    animation = $("camera").animate(keyframes(), {
      duration: hold() * 1000,
      fill: "both",
      easing: "linear",
    });
    if (!play || matchMedia("(prefers-reduced-motion: reduce)").matches)
      animation.pause();
    else $("play").textContent = "重新预览";
  }
  function release() {
    $("image").removeAttribute("src");
    $("image").hidden = true;
    bridge.release(media?.media_id);
    media = null;
  }
  function drawTimeline() {
    $("shots").replaceChildren();
    plan.shots.forEach((item) => {
      const button = document.createElement("button");
      button.className = "shot";
      button.dataset.id = item.panel_id;
      button.setAttribute("aria-pressed", String(current === item.panel_id));
      const title = document.createElement("strong");
      title.textContent = `第 ${item.index + 1} 镜${drafts.has(item.panel_id) ? " · 未保存" : ""}`;
      const detail = document.createElement("span");
      detail.textContent = `${labels[item.move] ?? item.move} · ${item.hold} 秒${item.has_image ? "" : " · 未采用图"}`;
      button.append(title, detail);
      button.addEventListener("click", () => select(item.panel_id));
      $("shots").append(button);
    });
    $("total").textContent =
      `共 ${plan.shots.length} 镜 · 已采用图 ${plan.total_seconds} 秒`;
  }
  function showFields() {
    invalidHold = false;
    $("hold").setCustomValidity("");
    const value = values();
    $("move").value = value.move;
    $("hold").value = value.hold ?? "";
    $("automatic").textContent =
      `自动建议：${labels[shot().auto_move]} · 按台词 ${shot().auto_hold} 秒；手动可设 0.5–30 秒。`;
    $("shot-title").textContent = `第 ${shot().index + 1} 镜`;
    $("shot-description").textContent = shot().description || "未填写画面说明";
    $("subtitle").textContent = shot()
      .lines.map(
        (line) => `${line.speaker ? `${line.speaker}：` : ""}${line.text}`,
      )
      .join("\n");
    drawTimeline();
    update();
  }
  async function select(id) {
    if (busy) return;
    stop();
    release();
    current = id;
    const token = ++imageRequest;
    showFields();
    const take = adopted();
    $("blank").hidden = false;
    $("blank").textContent = take
      ? "正在读取采用图…"
      : "本镜尚未采用图片，仍可保存镜头设置";
    if (!take) return;
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
      $("image").alt = `第 ${shot().index + 1} 镜采用图`;
      $("image").hidden = false;
      $("blank").hidden = true;
      animate(false);
    } catch (error) {
      if (token === imageRequest) $("blank").textContent = error.message;
    } finally {
      update();
    }
  }
  async function load(discard = false) {
    if (busy) return;
    if (drafts.size && !discard) {
      $("discard-confirm").hidden = false;
      return;
    }
    $("discard-confirm").hidden = true;
    busy = true;
    $("editor").hidden = true;
    update();
    stop();
    release();
    ++imageRequest;
    let loaded = false;
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
      ["auto", ...plan.moves].forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = labels[value] ?? value;
        $("move").append(option);
      });
      $("editor").hidden = !plan.shots.length;
      loaded = true;
      message(
        plan.shots.length
          ? "选择镜头调整运动与时长，保存后再导出。"
          : "本话还没有分镜。",
      );
    } catch (error) {
      message(error.message);
    } finally {
      busy = false;
      update();
    }
    if (loaded && plan.shots.length)
      await select(
        plan.shots.some((item) => item.panel_id === current)
          ? current
          : plan.shots[0].panel_id,
      );
  }
  function edit() {
    const raw = $("hold").value.trim();
    const seconds = raw === "" ? null : Number(raw);
    invalidHold =
      $("hold").validity.badInput ||
      (seconds !== null &&
        (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 30));
    if (invalidHold) {
      $("hold").setCustomValidity("请输入 0.5–30 秒，或留空按台词自动。");
      $("hold").reportValidity();
      update();
      return false;
    }
    $("hold").setCustomValidity("");
    const next = { move: $("move").value, hold: seconds };
    const original = panel()?.motion ?? { move: "auto", hold: null };
    if (next.move === original.move && next.hold === original.hold)
      drafts.delete(current);
    else drafts.set(current, next);
    stop();
    drawTimeline();
    update();
    return true;
  }
  $("load").addEventListener("click", () => load());
  $("discard").addEventListener("click", () => load(true));
  $("keep").addEventListener("click", () => {
    $("discard-confirm").hidden = true;
  });
  $("move").addEventListener("change", edit);
  $("hold").addEventListener("input", edit);
  $("automatic-reset").addEventListener("click", () => {
    invalidHold = false;
    $("hold").setCustomValidity("");
    drafts.set(current, { move: "auto", hold: null });
    showFields();
    animate(false);
  });
  $("play").addEventListener("click", () => {
    if (edit()) animate(true);
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
  $("save").addEventListener("click", async () => {
    if (!edit() || busy || unsafeWrite) return;
    if (!drafts.has(current)) return;
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
      message("镜头已保存。尚未采用的图片不会因镜头编辑被替换。");
    } catch (error) {
      unsafeWrite = true;
      message(
        `${error.message}\n请先重新读取核对作品状态，再继续保存；不会自动重试。`,
      );
    } finally {
      busy = false;
      update();
    }
  });
  $("export").addEventListener("click", async () => {
    if (busy || unsafeWrite || drafts.size) return;
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
          lang: "zh-CN",
          max_width: 1280,
        },
      });
      message(
        result.download_ready
          ? `已准备 ${result.filename}。请点击宿主面板的下载按钮保存，再独立打开预览。`
          : "宿主未准备下载，请重新打开面板核对。",
      );
    } catch (error) {
      message(error.message);
    } finally {
      busy = false;
      update();
    }
  });
  bridge.ready((value) => {
    context = value;
    message(
      context.episode_id
        ? "点击“读取本话镜头”开始。"
        : "请从具体话的扩展菜单打开面板。",
    );
    update();
  });
  addEventListener("pagehide", () => {
    stop();
    release();
  });
})();
