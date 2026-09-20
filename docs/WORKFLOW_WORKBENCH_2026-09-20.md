# 画册集实时同步 + 工作流页面减负

日期：2026-09-20  
基线：`lumingya/comfy-comic-studio` / `1c4734dfc967ae95b188bdc833b54b9ee1bfc135`

本轮解决三件事：生成任务与画册集不同步；工作流页面过于拥挤；映射详情让新用户看不懂。全部改动只落在前端（`js/`），后端接口未变。

## 1. 画册集跟着生成任务实时长

### 原因

`refreshProduction()` 里的画册分支只在「工作区 0、没有弹窗、没有打开阅读器、任务状态已结束」时才触发，而且触发的是整个工作区的全量重载（`connectPythonBackend()`）。于是：任务卡片上的图片先出现，画册要等用户点「查看画册」（`production-read`，同样强制全量重载）才补齐；阅读器打开时根本不会更新。后端其实每生成一页就已经把画册写盘（`publish()`），`/api/library/entity/albums/<id>` 能随时取到最新文档。

### 现在的行为

- `assembly-workshop.js` 为每个任务计算签名（状态 + 结果图列表）。签名变化时调用 `ComfyComic.fileLibrary.refreshAlbum(id)`，只拉这一本画册的实体文档，不重载工作区。
- `file-library.js` 的 `refreshAlbum(id)`：新画册直接插入；未加载完整正文（`_lazy`）的整本替换；已加载的用 `nativeReconcile` 三方合并，保留本地未保存的编辑，同步 etag 与 `runtime.previous`，重新套用 `pictureEdits`。返回 `{status, book, changed, structure}`。
- 阅读器正打开这本画册时，`ui-reader.js` 的 `refreshArtReaderPages(book, changed, structure)` 只追加 / 替换变化的页面（条漫模式原地插入 `article`，结构变化时重画画布并恢复滚动锚点）；否则在工作区 0 时刷新画册墙。新画册首次出现时提示一次。
- 轮询条件放宽：队列有活动任务、批次进行中、或阅读器打开时都会轮询；切到工作区 0 / 1 或打开阅读器时立即安排一次轮询。
- `production-read` 不再强制全量重载。

验收：`node tests/album_live_sync.mjs`（13 条断言，截图在 `docs/acceptance-album-live/`）。

## 2. 工作流页面：一行顶栏、可隐藏的工作流库、菜单分层

### 顶栏

原来的英雄区（大标题 + 一段说明 + 独立连接栏，约 200px）压成一行：小标题 · `?`（页面说明改为弹出说明）· 连接状态（渠道 / 地址 / 状态 / 一句说明）· 「连接设置」原地展开渠道面板 · 测试连接 · 添加工作流。

### 工作流库（左栏）

默认收起成左侧边缘一条 22px 的把手；鼠标靠近或键盘聚焦时滑出 272px 的抽屉，离开后自动收起；抽屉里的图钉可固定为普通侧栏，选择记在 `localStorage` 的 `mio.workflow.railPinned`。取消固定时抽屉先留在原地，等指针离开再收起。≤1180px 时按老规则退化为下拉切换。

### 工具栏与菜单

| 位置 | 内容 |
| --- | --- |
| 常驻 | 筛选（全部 / 已启用 / 待检查 / 已停用，带计数）、搜索、添加映射、一帧试跑 |
| ⋯ 菜单 | 识别提示词节点、添加画面参数映射、批量管理、编辑蓝图 JSON、提交预览、导入工作流、同步节点定义、导入 / 导出映射包 |
| 映射右键（或行尾 ⋯） | 编辑、停用 / 启用、重命名、复制、在节点列表里查看、批量管理、删除 |
| 结果输出行右键 | 更改结果图片节点、同步节点定义 |
| 工作流右键（抽屉 / 侧栏 / 行尾 ⋯） | 切换、重命名、复制副本、导出映射包、批量选择、删除 |

右键菜单是同一份 `openWorkbenchMenu()`，支持键盘、Esc、点击外部与滚动关闭。

### 映射详情：三步引导

`renderMappingRule` 改成一句话契约 + 三步表单：

1. **写到哪里** — 节点下拉 + 输入字段下拉（来自 `workflowInputEntries`，已连线的输入放在禁用分组）；字段不在列表里时切换为手动输入（保留 JSON Pointer 语义），可跳到节点浏览器。
2. **填什么** — 取值来源按「来自分镜 / 来自预设与装配 / 固定内容」分组，每种来源下面一句说明「什么时候、写什么」（合并了原先的生效时机 / 作用范围 / 来源三行）。
3. **效果预览** — 「蓝图里现在是」与「生成时会写成」两行对照，再加校验结果；值变化时实时更新。

数据类型、允许新增字段等低频项收进「高级选项」。

## 文件

| 文件 | 改动 |
| --- | --- |
| `js/assembly-workshop.js` | 任务签名、`syncProducedAlbums`、轮询条件、`navigate` / `openArtReader` 挂钩 |
| `js/file-library.js` | `refreshAlbum(id)` |
| `js/ui-reader.js` | `refreshArtReaderPages()` |
| `js/workflow-workbench.js` | 页面结构、抽屉、菜单、三步详情（数据辅助与导入表单未改） |
| `js/workflow-workbench.css` | 对应样式重写，保留主题变量 |
| `js/ui-locale.js` | 新文案的英文条目 |
| `tests/album_live_sync.mjs` | 新增 |
| `tests/workflow_workbench.mjs` | 按新界面重写，并自带七节点示例工作流，不再依赖随包 `data/` |

## 验证

```bash
npm run lint
npm run test:contracts          # 86/86
npm run test:workflow           # 48 fixtures + python + 55 条浏览器断言
npm run test:album-live         # 13 条断言
npm run test:assembly           # 39 条断言
```

注意：当前仓库里 `data/settings/comfy.json`、`data/settings/workspace.json`、`data/storyboards/远行与归来…json`、`data/workflows/Anime…json` 与 `data/distribution.json` 的校验值不一致（上一次提交修改了这些随包文件但没有重新生成清单）。凡是用独立 `MIO_DATA_DIR` 起服务的测试（smoke、mobile、home、first-use、locale、architecture、`test_storage.ReleaseDefaultsTests`）在基线提交上就已经失败，原因与本轮改动无关；重新运行 `python tools/build_distribution.py`（或撤回这些数据文件）后即可恢复。
