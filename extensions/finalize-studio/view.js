(() => {
  const zh = {
    documentTitle: "成品档精修管线",
    heading: "成品精修",
    intro: "让选好的画面走完已配置的放大、细节与高清处理阶段。开始前可核对顺序，完成后逐格对比。",
    load: "读取已采用草稿与配置",
    newIntent: "开始新的成品请求",
    connecting: "正在连接面板…",
    selectHeading: "选择需要精修的画面",
    all: "全选已采用草稿",
    none: "清空选择",
    takesHint: "读取后显示当前已采用的草稿。候选与已有成品不会混入。",
    sourceLabel: "原图预览",
    sourceOption: "选择一格查看",
    sourceEmpty: "选择候选后显示原图",
    sourceAlt: "所选已采用草稿",
    pipelineHeading: "本次成品管线",
    profileLabel: "出图配置",
    stageNote: "阶段来自高级出图配置，顺序与参数由服务端冻结。本面板不改动全局配置。",
    consent: "我确认：成品成功时会替换仍被采用的原草稿；原图作为候选保留。如果期间换了采用图，不追改新的选择。",
    cost: "提交会运行选定服务，可能消耗显存或云端额度。失败与停止均不自动重试。",
    submit: "提交所选画面的成品精修",
    progressHeading: "任务进度",
    recentLabel: "近期成品任务",
    recentOption: "读取后显示",
    jobIdLabel: "任务 ID",
    jobPlaceholder: "也可粘贴已有任务 ID 继续查看",
    refresh: "刷新任务",
    stop: "停止任务",
    watch: "每 5 秒跟踪状态",
    compareHeading: "原图 / 成品对比",
    resultLabel: "成品结果",
    resultOption: "完成任务后可查看",
    beforeAlt: "成品处理前的原图",
    afterAlt: "成品管线处理后的画面",
    beforeLabel: "原草稿",
    afterLabel: "成品",
    divider: "分割位置",
    rollback: "恢复此成品的原草稿",
    resultHint: "成品图会在任务完成后显示。",
    noJob: "尚未选择任务",
    noComparison: "选择成品后显示原图与精修结果",
    chooseSource: "选择一格查看原图",
    selectedFrame: "第 {{n}} 格 · {{width}}×{{height}} · {{id}}",
    emptyDrafts: "当前没有已采用的草稿。请先挑选采用，或在下方查看已有成品。",
    chooseResult: "选择成品对比原图",
    resultAdopted: "成品 · 当前已采用",
    resultCandidate: "成品 · 候选保留",
    resultDefault: "成品",
    jobComplete: "成品已完成。请在下方逐格对比；原草稿继续保留。",
    jobPartial: "任务未全部完成，请查看逐项状态。已有成功结果保留，不会自动重新出图。",
    loading: "正在读取已采用草稿与管线…",
    reviewBeforeRun: "选择需要精修的已采用草稿，核对阶段和采用行为后再提交。",
    noProfile: "没有可运行的成品配置。请先在高级出图方案中配置成品阶段并绑定服务，再重新读取。",
    restoring: "正在恢复原草稿…",
    restored: "已恢复原草稿为当前采用画面，精修结果仍保留为候选。",
    restoreFailed: "恢复失败：{{message}}",
    restorePreviewFailed: "已恢复原草稿，但图片预览失败：{{message}}",
    newTaskHint: "下一次提交会创建新任务。请重新检查所选草稿与阶段。",
    submitting: "正在提交成品管线…",
    submitted: "已提交成品任务 {{id}}，每格依次执行配置中的有效阶段。",
    retryHint: "未自动重试。可先读取近期任务，检查是否已创建后再按相同选择重试。",
    noEpisode: "请从具体话的扩展菜单打开。",
    openLoad: "点击「读取已采用草稿与配置」开始。",
    finalQueued: "排队中",
    finalRunning: "处理中",
    finalPaused: "已暂停",
    finalBlocked: "等待处理",
    finalCompleted: "已完成",
    finalFailed: "失败",
    finalCanceled: "已取消",
    finalUncertain: "结果待核对",
    finalPending: "等待",
    finalSent: "已发送",
    finalComplete: "完成",
    finalSkipped: "跳过",
    progressValue: "{{state}} · {{done}}/{{total}} 格",
    progressItem: "第 {{n}} 项",
    continueJobs: "选择近期任务继续查看",
    autoRefreshLimit: "自动刷新已达到本次会话上限。可手动刷新；重新打开面板可继续跟踪任务。",
    disabled: "停用",
  };
  const en = {
    documentTitle: "Finalize Studio",
    heading: "Finalize selected drafts",
    intro: "Run selected adopted images through the configured upscale and detail stages. Review the frozen order, then compare each result.",
    load: "Load adopted drafts and profiles",
    newIntent: "Start a new finalize request",
    connecting: "Connecting to the panel…",
    selectHeading: "Choose images to finalize",
    all: "Select all adopted drafts",
    none: "Clear selection",
    takesHint: "Current adopted drafts appear here. Candidates and existing final images are excluded.",
    sourceLabel: "Draft preview",
    sourceOption: "Choose a frame",
    sourceEmpty: "Select a draft to preview the original",
    sourceAlt: "Selected adopted draft",
    pipelineHeading: "Finalize pipeline",
    profileLabel: "Render profile",
    stageNote: "Stages come from the advanced render profile; order and parameters are frozen by the server. This panel does not change global settings.",
    consent: "I understand: a successful result replaces the original only while it remains adopted. The original stays as a candidate; a newer selection will not be overwritten.",
    cost: "Submitting runs the selected service and may use GPU memory or cloud credits. Failures and stops are never retried automatically.",
    submit: "Finalize selected images",
    progressHeading: "Job progress",
    recentLabel: "Recent finalize jobs",
    recentOption: "Load to see recent jobs",
    jobIdLabel: "Job ID",
    jobPlaceholder: "Paste an existing job ID to resume tracking",
    refresh: "Refresh job",
    stop: "Stop job",
    watch: "Refresh every 5 seconds",
    compareHeading: "Draft / final comparison",
    resultLabel: "Final result",
    resultOption: "Available after a job completes",
    beforeAlt: "Original draft before finalization",
    afterAlt: "Image after the finalization pipeline",
    beforeLabel: "Draft",
    afterLabel: "Final",
    divider: "Split position",
    rollback: "Restore the original draft for this result",
    resultHint: "Final images appear after a job completes.",
    noJob: "No job selected",
    noComparison: "Choose a final image to compare it with the original draft",
    chooseSource: "Choose a frame to preview its draft",
    selectedFrame: "Frame {{n}} · {{width}}×{{height}} · {{id}}",
    emptyDrafts: "No adopted drafts are available. Adopt a draft first, or compare an existing final below.",
    chooseResult: "Choose a final image to compare",
    resultAdopted: "Final · currently adopted",
    resultCandidate: "Final · retained as a candidate",
    resultDefault: "Final image",
    jobComplete: "Finalization is complete. Compare each result below; the original drafts remain available.",
    jobPartial: "The job did not complete every item. Review each status; successful results remain and are not rerun automatically.",
    loading: "Loading adopted drafts and pipeline…",
    reviewBeforeRun: "Choose adopted drafts, review the stages and adoption behavior, then submit.",
    noProfile: "No runnable finalize profile. Configure enabled final stages and bind a service in Advanced render plans, then reload.",
    restoring: "Restoring the original draft…",
    restored: "The original draft is adopted again. The finalized image remains a candidate.",
    restoreFailed: "Could not restore the draft: {{message}}",
    restorePreviewFailed: "The original draft was restored, but its image preview failed: {{message}}",
    newTaskHint: "The next submission will create a new task. Review the selected drafts and stages first.",
    submitting: "Submitting the finalize pipeline…",
    submitted: "Finalize job {{id}} was submitted. Each frame runs the enabled stages in order.",
    retryHint: "Not retried automatically. Check recent jobs first, then explicitly retry with the same selection if needed.",
    noEpisode: "Open this panel from an episode’s extension menu.",
    openLoad: "Select Load adopted drafts and profiles to begin.",
    finalQueued: "Queued",
    finalRunning: "Running",
    finalPaused: "Paused",
    finalBlocked: "Waiting for action",
    finalCompleted: "Completed",
    finalFailed: "Failed",
    finalCanceled: "Canceled",
    finalUncertain: "Needs reconciliation",
    finalPending: "Pending",
    finalSent: "Sent",
    finalComplete: "Complete",
    finalSkipped: "Skipped",
    progressValue: "{{state}} · {{done}}/{{total}} frames",
    progressItem: "Item {{n}}",
    continueJobs: "Choose a recent job to continue",
    autoRefreshLimit: "Automatic refresh reached this session’s limit. Refresh manually or reopen the panel to continue tracking.",
    disabled: "disabled",
  };
  let strings = zh;
  const translate = (key, values = {}) => {
    let text = strings[key] ?? zh[key] ?? key;
    for (const [name, value] of Object.entries(values))
      text = text.replaceAll(`{{${name}}}`, String(value));
    return text;
  };
  const appliedTokens = new Set();
  const apply = (appearance = {}) => {
    const root = document.documentElement;
    const locale = typeof appearance.locale === "string" ? appearance.locale : "zh-CN";
    const language = locale.toLowerCase().startsWith("en") ? "en" : "zh";
    strings = language === "en" ? en : zh;
    root.lang = language === "en" ? "en" : "zh-CN";
    const theme = appearance.theme;
    if (theme === "dark" || theme === "light") root.style.colorScheme = theme;
    for (const token of appliedTokens) root.style.removeProperty(token);
    appliedTokens.clear();
    if (appearance.tokens && typeof appearance.tokens === "object") {
      for (const [name, value] of Object.entries(appearance.tokens)) {
        const token = name.startsWith("--") ? name : `--${name}`;
        if (/^--[a-z0-9-]{1,64}$/i.test(token) && typeof value === "string" && value.length < 512) {
          root.style.setProperty(token, value);
          appliedTokens.add(token);
        }
      }
    }
    for (const element of document.querySelectorAll("[data-i18n]")) {
      const value = strings[element.dataset.i18n];
      if (value !== undefined) element.textContent = value;
    }
    for (const element of document.querySelectorAll("[data-i18n-alt]")) {
      const value = strings[element.dataset.i18nAlt];
      if (value !== undefined) element.alt = value;
    }
    for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
      const value = strings[element.dataset.i18nPlaceholder];
      if (value !== undefined) element.placeholder = value;
    }
  };
  window.MioFinalizeView = Object.freeze({ apply, t: translate });
})();
