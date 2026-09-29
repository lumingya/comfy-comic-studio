export const interactionZh = {
  saveFailedStay: '保存失败，输入仍在；可以重试或取消离开。',
  expiryRange: '有效天数须为 0–36500 的整数；0 或留空表示永久。',
  selected: '已选择 {{count}} 项',
  list: '项目列表',
  cancelTasks: '取消所选的 {{count}} 个任务？',
  copyFailed: '浏览器无法写入剪贴板，请选中文本后手动复制。',
};
export const interactionEn: Record<keyof typeof interactionZh, string> = {
  saveFailedStay: 'Save failed. Your input is retained; retry or cancel leaving.',
  expiryRange: 'Use a whole number from 0 to 36500 days; 0 or blank means no expiry.',
  selected: '{{count}} items selected',
  list: 'Item list',
  cancelTasks: 'Cancel the {{count}} selected tasks?',
  copyFailed: 'Clipboard access is unavailable. Select the text and copy it manually.',
};
