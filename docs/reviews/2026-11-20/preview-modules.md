# 导出与模板预览模块拆分

本次只拆分组件。导出请求、幂等回执、取消与重试、模板保存逻辑、HTML 沙箱权限和现有文案均沿用拆分前实现。

| 模块                                            | 复审入口与职责                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `web/src/pages/works/ExportDrawer.tsx`          | 抽屉、创作套装选择、后台导出生命周期与唯一导出按钮。                                                                       |
| `web/src/pages/works/exportTypes.ts`            | 抽屉输入契约与格式枚举。                                                                                                   |
| `web/src/pages/works/ExportOptions.tsx`         | HTML/PDF/ZIP 设置、模板导入和平台输出设置。两个设置组件始终挂载，保持查询与导入状态的生命周期。                            |
| `web/src/pages/works/AlbumTemplatePicker.tsx`   | 模板卡片、版式徽标、当前主题色与试读入口。                                                                                 |
| `web/src/pages/works/ExportPreviewDialog.tsx`   | 当前导出设置的试读请求与弹窗。保留 `staleTime: 0`，重新打开会获取最新采用图；保留 `sandbox="allow-scripts allow-popups"`。 |
| `web/src/pages/works/TemplateStudio.tsx`        | 模板库、编辑草稿、复制/删除/保存、离开确认与预览请求。                                                                     |
| `web/src/pages/works/TemplateEditorFields.tsx`  | 外观、颜色、尺寸与 HTML 编辑字段。完整草稿通过原有状态 setter 返回工作室。                                                 |
| `web/src/pages/works/TemplateStudioPreview.tsx` | 桌面/手机预览与全屏试读；持续挂载并保留设备选择及弹窗状态。所有 iframe 沿用原有沙箱。                                      |

复审重点：检查设置组件持续挂载、传入草稿与回调未改变，以及试读缓存即时刷新修复未被覆盖。样式、生成文件、i18n 与既有测试文件未改动。

验证：`ExportDrawer.test.tsx` 20 项与 `ExportPreviewFreshness.test.tsx` 1 项通过，TypeScript、Prettier、UTF-8 与差异空白检查通过。当前项目没有独立的 `TemplateStudio.test.tsx`，工作室拆分通过类型检查及既有预览路径验证。本轮未重复完整测试集，由主 agent 统一验收。拆分后的 `ExportDrawer.tsx` 为 360 行，`TemplateStudio.tsx` 为 367 行；其余新增生产模块为 33–232 行。
