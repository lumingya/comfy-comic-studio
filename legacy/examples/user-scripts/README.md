# 用户脚本示例

用户脚本 = 不用打包的扩展。在 **设置 → 扩展中心 → 用户脚本 → 导入 .js** 导入，或新建后把内容粘进去，“保存并重载”即生效。

每个文件都是一个 ES 模块：`export default function (ctx) { … }`，`ctx` 与扩展完全相同（见 `docs/SDK_REFERENCE.md`）。返回的函数会在停用时执行清理；通过 `ctx` 注册的一切（挂载、快捷键、样式、事件、around 包装）会自动撤销。

| 文件 | 做什么 |
| --- | --- |
| `word-count.js` | 状态栏实时显示当前分镜提示词字数 |
| `reader-keys.js` | 阅读器里用 J / K 翻页，`mod+shift+r` 打开最近画册 |
| `autosave-nudge.js` | 用 `ctx.around('save')` 统计保存次数，长时间未保存时提醒 |
