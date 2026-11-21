(() => {
  "use strict";

  const copy = {
    zh: {
      eyebrow: "MOTION STUDIO · 动态漫",
      title: "动态漫工作台",
      load: "读取本话镜头",
      connecting: "正在连接面板…",
      discardHint: "重新读取会放弃尚未保存的镜头草稿。",
      discard: "放弃草稿并重新读取",
      keep: "保留草稿",
      noImage: "尚未读取采用图",
      previewShot: "预览本镜",
      stopPreview: "停止预览",
      unsaved: "未保存",
      noAdoptedLabel: "未采用图",
      timelineTotal: "{{shots}} 镜 · {{playable}} 格有采用图 · {{seconds}} 秒",
      duration: "{{value}} 秒",
      voicePreview: "试听台词",
      voiceUnsupported: "此浏览器不支持语音合成",
      fullscreen: "全屏预览",
      progress: "进度",
      previewNote: "预览使用采用原图；导出可选已保存的排版与嵌字。",
      selectShot: "选择镜头",
      shotNumber: "第 {{n}} 镜",
      cameraMove: "镜头运动",
      holdDuration: "停留秒数",
      holdPlaceholder: "按台词自动",
      transition: "转场",
      fade: "柔和淡化",
      cut: "直接切换",
      slide: "横向推入",
      automaticReset: "按分镜与台词自动",
      saveShot: "保存当前镜头",
      offlinePlayer: "离线播放器",
      aspect: "画幅",
      portrait: "竖屏 · 9:16",
      landscape: "横屏 · 16:9",
      lettered: "使用保存的排版与嵌字",
      subtitles: "默认显示字幕",
      voice: "播放器默认朗读（需本机语音）",
      export: "导出离线动态漫",
      exportNote:
        "导出完成后，点击宿主面板的下载按钮保存；文件可独立打开，无需联网。",
      timeline: "镜头列表",
      emptyTimeline: "本话还没有分镜。",
      openFromEpisode: "请从具体话的扩展菜单打开面板。",
      clickLoad: "点击“读取本话镜头”开始。",
      loading: "正在读取本话镜头…",
      loaded: "选择镜头调整运动与时长，保存后再导出。",
      emptyShots: "本话还没有分镜。",
      imageLoading: "正在读取采用图…",
      noAdopted: "本镜尚未采用图片，仍可保存镜头设置",
      imageError: "读取采用图失败。",
      noDescription: "未填写画面说明",
      autoSuggested:
        "自动建议：{{move}} · 按台词 {{seconds}} 秒；可手动设为 0.5–30 秒。",
      dirty: "{{count}} 个镜头尚未保存",
      clean: "镜头设置已与作品同步",
      resetSaved: "镜头设置已保存。",
      saveSuccess: "镜头已保存。尚未采用的图片不会因镜头编辑被替换。",
      readAgain: "请先重新读取核对作品状态，再继续保存；不会自动重试。",
      holdInvalid: "请输入 0.5–30 秒，或留空按台词自动。",
      noVoices: "系统暂时没有可用语音。",
      previewVoiceStarted: "正在试听本镜台词…",
      previewVoiceDone: "台词试听完成。",
      previewStarted: "正在播放本话动态预览。",
      previewDone: "本话预览结束。",
      previewStopped: "已停止预览。",
      fullScreenError: "当前浏览器未允许全屏显示。",
      noPlayable: "还没有采用图，无法生成可播放的动态漫。",
      exportReady: "已准备 {{filename}}。请点击宿主面板的下载按钮保存。",
      downloadError: "宿主未准备下载，请重新打开面板核对。",
      requestError: "请求失败：{{message}}",
      draftNotice: "保存未完成的镜头设置后即可导出。",
      move: {
        auto: "按分镜自动",
        still: "静止",
        push_in: "推近",
        pull_out: "拉远",
        pan_left: "向左摇移",
        pan_right: "向右摇移",
        pan_up: "向上摇移",
        pan_down: "向下摇移",
        shake: "轻震",
      },
    },
    en: {
      eyebrow: "MOTION STUDIO",
      title: "Motion studio",
      load: "Load episode shots",
      connecting: "Connecting to the extension host…",
      discardHint: "Reloading will discard unsaved shot edits.",
      discard: "Discard edits and reload",
      keep: "Keep edits",
      noImage: "No adopted image loaded",
      previewShot: "Preview this shot",
      stopPreview: "Stop preview",
      unsaved: "unsaved",
      noAdoptedLabel: "no adopted image",
      timelineTotal: "{{shots}} shots · {{playable}} playable · {{seconds}} seconds",
      duration: "{{value}} s",
      voicePreview: "Audition dialogue",
      voiceUnsupported: "Speech synthesis is not supported in this browser",
      fullscreen: "Full-screen preview",
      progress: "Progress",
      previewNote:
        "Preview uses adopted source images; export can include saved layout and lettering.",
      selectShot: "Select a shot",
      shotNumber: "Shot {{n}}",
      cameraMove: "Camera move",
      holdDuration: "Hold (seconds)",
      holdPlaceholder: "Automatic from dialogue",
      transition: "Transition",
      fade: "Soft fade",
      cut: "Cut",
      slide: "Slide in",
      automaticReset: "Use storyboard and dialogue timing",
      saveShot: "Save this shot",
      offlinePlayer: "Offline player",
      aspect: "Aspect ratio",
      portrait: "Portrait · 9:16",
      landscape: "Landscape · 16:9",
      lettered: "Use saved layout and lettering",
      subtitles: "Show subtitles by default",
      voice: "Read dialogue by default (system voice required)",
      export: "Export offline motion comic",
      exportNote:
        "When ready, use the host download button to save the self-contained HTML file.",
      timeline: "Shot list",
      emptyTimeline: "This episode has no storyboard panels yet.",
      openFromEpisode: "Open this panel from an episode's extension menu.",
      clickLoad: "Select “Load episode shots” to begin.",
      loading: "Loading episode shots…",
      loaded:
        "Choose shots, adjust movement and timing, then save before export.",
      emptyShots: "This episode has no storyboard panels yet.",
      imageLoading: "Loading adopted image…",
      noAdopted:
        "No image adopted for this shot yet. Motion settings can still be saved.",
      imageError: "Could not load the adopted image.",
      noDescription: "No visual description",
      autoSuggested:
        "Automatic: {{move}} · {{seconds}} seconds from dialogue; manual range 0.5–30 seconds.",
      dirty: "{{count}} unsaved shot edits",
      clean: "Shot settings are up to date",
      resetSaved: "Shot settings saved.",
      saveSuccess:
        "Shot saved. Editing camera settings does not replace adopted artwork.",
      readAgain:
        "Reload and verify the episode before saving again. The write was not retried.",
      holdInvalid:
        "Enter 0.5–30 seconds, or leave blank to use dialogue timing.",
      noVoices: "No system speech voices are currently available.",
      previewVoiceStarted: "Auditioning this shot's dialogue…",
      previewVoiceDone: "Dialogue audition complete.",
      previewStarted: "Playing the episode preview.",
      previewDone: "Episode preview finished.",
      previewStopped: "Preview stopped.",
      fullScreenError: "The browser did not allow full-screen mode.",
      noPlayable:
        "Adopt at least one image before exporting a playable motion comic.",
      exportReady:
        "{{filename}} is ready. Use the host download button to save it.",
      downloadError:
        "The host did not prepare a download. Reopen the panel and check again.",
      requestError: "Request failed: {{message}}",
      draftNotice: "Save pending shot edits before exporting.",
      move: {
        auto: "From storyboard",
        still: "Still",
        push_in: "Push in",
        pull_out: "Pull out",
        pan_left: "Pan left",
        pan_right: "Pan right",
        pan_up: "Pan up",
        pan_down: "Pan down",
        shake: "Shake",
      },
    },
  };
  const template = (value, vars = {}) =>
    value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ""));
  const api = {
    copy,
    language(locale) {
      return String(locale || "")
        .toLowerCase()
        .startsWith("en")
        ? "en"
        : "zh";
    },
    text(locale, key, vars) {
      const lang = this.language(locale);
      const value = key
        .split(".")
        .reduce((node, part) => node?.[part], copy[lang]);
      return typeof value === "string" ? template(value, vars) : key;
    },
    movement(locale, key) {
      return this.text(locale, `move.${key}`);
    },
    spokenText(lines) {
      return (lines || [])
        .map((line) => line.text || "")
        .filter(Boolean)
        .join(" ");
    },
    speechSeconds(lines) {
      const text = this.spokenText(lines);
      const cjk = (
        text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/gu) || []
      ).length;
      return Math.round((cjk / 6 + (text.length - cjk) / 15) * 10) / 10;
    },
    speakable(lines) {
      return (lines || []).filter((line) => line.text && line.text.trim());
    },
  };
  window.MotionModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
