# 工作流工作台重构与架构审查

日期：2026-09-19  
基线：`lumingya/comfy-comic-studio` / `1cfc6d714d4a42fd487cd4692e2a8541a55f539c`

## 结论

原实现的数据模型已经具备通用输入映射的基础：任意节点 ID、嵌套路径、类型化值、变量和任务快照。因此不需要退回到“固定 KSampler / CLIP / LoRA 节点”的专用方案。

真正的问题是职责分散和执行规则不一致：界面允许覆盖连线，浏览器后加的封装层却禁止；运行时可能悄悄把正负提示词改投到另一个字段；路径检查和 Python 写入行为不同。这些行为已经重构，而不是仅在外面增加一层兼容补丁。

**现在适合用作 ComfyUI API 工作流的通用输入映射器，但不是任意 DAG 编辑器。** 不支持直接编辑节点拓扑、不猜测 ComfyUI 可视化编辑器 JSON 的控件顺序，也没有扩大到音频/视频多结果编排。

## 界面

- 石墨灰 / 鼠尾草绿视觉，保留项目主题变量；浅色主题同样可用。
- 左侧工作流库：搜索、切换、复制、删除、批量导入与导出。
- 中间紧凑映射表：名称、节点/路径、来源、启用状态和问题标记。
- 右侧只编辑当前项，避免每条映射展开成整页表单。
- 节点浏览器按需打开，支持节点名、ID、自定义标题及嵌套字段搜索。
- 已有映射可直接跳转；连线输入只读。
- 「输入映射 / 蓝图设置 / 配置检查」分开，低频设置不占主工作区。
- 提交预览展示“原值 → 本次值”及完整 JSON；缺少变量而保留原值的项目会显式列出。
- 桌面列表与详情各自滚动，试跑和预览入口位于固定面板底部；小屏改为上下布局和下拉切换。
- 编辑仍使用项目原有自动保存链路。底部工作区状态栏才是后端保存成功与否的依据。
- 一帧试跑时自动展开预览区。

导入工作流 / 映射包会**作为新工作流加入库**，不覆盖当前工作流。删除映射不删除节点。复制/切换/重载持久化均已实际测试。

## 新职责划分

```text
workflow-workbench.js + workflow-workbench.css
  展示、筛选、临时选择状态，不承担编译
            │
engine.js
  分镜 / 变量 / 图片来源解析，服务调用，快照
            │
workflow-mapping.js
  纯函数：路径 → 校验 → 类型转换 → schema 校验 → 克隆写入
  返回 workflow / changes / skipped

backend/ecosystem/workflow.py
  Python 服务端编译路径（生产队列与前置资产）
            │
共享 tests/fixtures/workflow_mapping_contract.json
  同一组 45 个合同用例，分别在 JS 和 Python 验证
```

UI 和浏览器提交使用同一套目标校验。Python 仍是独立实现，通过共享用例约束路径、冲突、连线保护、类型及 schema 等公共语义，而不是声称两端所有来源解析完全相同。图片上传、分镜作用域和种子策略仍由各自执行上下文提供。

新增主文件：

- `js/workflow-mapping.js`：无 DOM、无应用状态、无网络依赖的编译核心。
- `js/workflow-workbench.js`：集中收拢原先散在多个 UI 文件中的映射页面。
- `js/workflow-workbench.css`：作用域样式，构建器同时支持开发资源和 bundle。

## 行为变更（有意破坏旧语义）

1. **不再运行时静默改写目标。** 自动识别只在用户点击识别/重新识别时发生；切换来源、同步节点定义不会偷偷改路径。
2. **已有连线不可写。** 即使旧包带有 `allowLink: true`，也不能覆盖连线、修改连线内部或整体替换含连线的容器。
3. **重复、父子路径同时写入直接报错。** 不依赖数组顺序来决定谁覆盖谁。
4. **不能通过 allowCreate 覆盖已有标量。** 允许创建对象字段；现有数组只能修改有效索引，不制造稀疏数组、不猜测缺失的数组容器。
5. 非法 JSON Pointer 转义、危险属性、空白数字、非有限数值、错误 JSON 等在本地拦截。
6. 指定的结果节点不存在时，在提交前拦截，而不是浪费一次 GPU 生成。
7. 文本/数值/布尔/枚举的已知节点 schema 在编译阶段验证；生产队列会传入快照里的 `objectInfo`。
8. 编译不修改原蓝图；Python 图片列表也在完整成功后才提交，失败不留下部分上传引用。

### 保留的实用数据格式

包仍使用 `comfycomic.workflow-mappings` / `formatVersion: 1`：本次没有为了改版本而改版本。保留 `text`、`a.b` 等旧字段路径输入；含点、斜杠、波浪线的字面键请用 JSON Pointer。

| 需求 | 例子 |
|---|---|
| 普通文本 | `/text` |
| LoRA 数组 | `/loras/0/strength` |
| 字面键 `a.b` | `/a.b` |
| 键中含 `/` | `/a~1b` |
| 键中含 `~` | `/x~0y` |
| 同一变量写多个节点 | 多条不同目标的 `source: variable` 映射 |
| 保留原参数 | 停用、`inherit`，或未提供的可选变量 |

数组与连线有固有歧义：ComfyUI 的 `["nodeId", outputIndex]` 字符串二元组按连线保守保护，包括悬空节点 ID；数值二元组仅在引用节点存在时按连线处理。普通 JSON 恰好具有该形状时，应调整数据表示，而不是绕过连线保护。

`sceneParameter` 仅在单幕开启 `renderOverride` 时执行。编辑器会检查所有启用目标以尽早发现问题；编译器按本次分镜的门控条件检查实际启用的集合。

## 上游启动问题

原始 Git 提交中的以下四个文件与 `data/distribution.json` 中的哈希不符：

- `records/conversations/海风来信 · 分镜对话--chat_letter.json`
- `settings/comfy.json`
- `settings/workspace.json`
- `workflows/Anime · 基础图像管线--9399e1242916.json`

已逐一确认工作树字节与 `git show HEAD:<path>` 相同，仅更新这四条校验值，没有关闭完整性校验，也没有更改这些随包数据。`python tools/check_distribution.py` 现在通过，验证 59 个独立数据文件。

## 验证

| 命令 | 结果 |
|---|---|
| `node js/build.js dev` | 语法及组装检查通过 |
| `npm run lint` | JS / HTML 均通过 |
| `npm run test:contracts` | 63 / 63 |
| `node tests/workflow_mapping_contract.mjs` | 45 个共享用例 + schema 检查通过 |
| `python -m unittest tests.test_workflow_mapping -v` | 共享用例与失败原子性检查通过 |
| `node tests/workflow_workbench.mjs` | 32 条浏览器断言通过 |
| `python -m unittest discover -s tests -q` | 439 项运行，4 项跳过，无失败 |
| `npm run test:smoke` | 42 条桌面审计通过 |
| `npm run test:mobile` | 59 条移动端审计通过 |
| `npm run test:architecture` | 37 条架构/装配断言通过 |
| `python tools/check_distribution.py` | 59 个数据文件验证通过 |

浏览器测试使用隔离临时工作区，覆盖搜索、筛选、启用/停用、添加/修改/删除、错误修复、后端保存确认、重载、真实文件导出和导入、复制/切换、JSON 预览、移动端及浅色主题。

**未连接用户的 ComfyUI/GPU，也未执行真实模型生成。未宣称整个 `npm run test:current` 聚合套件已通过。** 新增页面中文文案尚未逐项补全英文翻译。真实插件节点仍应同步本机 `/object_info` 并试跑验证。

## 运行与复验

```bash
python -m pip install -r packaging/requirements.txt
python server.py
# http://127.0.0.1:8777 → 工作流与 API 配置
```

开发测试：

```bash
npm ci
npx playwright install chromium
# Linux 缺少浏览器依赖时：npx playwright install-deps chromium
node js/build.js dev
npm run test:workflow
```

测试截图在 `docs/acceptance-workflow/`。实时预览使用独立的 `MIO_DATA_DIR`，没有把测试编辑写入随包数据。
