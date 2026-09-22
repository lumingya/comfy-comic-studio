# 工作流配置界面更新

## 本次改动

- **常驻渠道栏**：ComfyUI、NovelAI、OpenAI 兼容及自定义渠道直接展示，选中项有明确状态。不需要展开连接设置才能切换。云端渠道仍支持复制、删除。
- **移除离线入口**：移除页面中演示／模拟模式选项及自动离线降级开关。旧工程加载时将生成、LLM、审校设置转为真实服务模式，关闭自动回退。保留历史演示图片与旧任务快照兼容逻辑，不删除用户资产。
- **简洁列表**：模型、LoRA、提示词和参数采用同一个行组件。统一名称、用途、复选框、启用开关和编辑按钮；默认不显示节点 ID、字段名、模型文件名、写入时机等细节。详情按需打开并可收起。
- **一致的筛选和计数**：模型及 LoRA 槽加入启用／停用／待检查筛选、搜索和批量选择。批量移除时，普通映射删除，内置语义槽停用，确认框明确说明。
- **移动端**：渠道横向滚动；工作流库改为选择框；槽位详情转为下方编辑区；表单单列；编辑按钮保持可见。
- **槽位预设**：ComfyUI 页右上方常驻入口。内置常用四槽模板，支持新建、编辑、从当前工作流提取、删除、JSON 导入导出。预设不包含节点 ID、蓝图或密钥。

## 使用槽位预设

1. 打开「工作流与 API 配置」，选择 ComfyUI。
2. 点击右上角「槽位预设」，编辑内置模板或创建自己的模板。
3. 为每个槽位设置名称、用途、字段名；分镜参数或固定值可填写对应值。
4. LoRA 根据蓝图选择「节点链」「语法注入」「堆栈节点」方式。
5. 保存预设；新建／导入工作流后再次打开预设并点击「应用」。
6. 集中填写每个槽位的节点 ID；必要时调整字段，或取消勾选不需要的槽位。
7. 点击「校验并应用」。不存在的节点、不可写字段与冲突会显示错误，不会部分写入。

普通映射采用追加策略，不静默覆盖原映射。模型／LoRA 为工作流级语义槽，应用会替换其目标配置，应用对话框中已作提示。相同输入已有普通映射时，请先调整或停用已有映射。

### 存储与兼容性

槽位预设保存在当前浏览器的 localStorage（`mio.workflow.slot-presets.v1`）。跨浏览器、跨机器请使用 JSON 导出／导入；不自动随工程文件同步。写入存储失败时会报错，不显示保存成功。

沿用原有 ComfyUI 模型与 LoRA 执行适配器。统一的是展示、筛选、选择和预设配置方式，不把 LoRA 节点链强行当作普通文本映射，以免破坏执行逻辑。自定义节点仍需其实际输入字段和对应插件支持。

## 运行

保持原项目启动方式：Windows 使用 `start.bat`；macOS / Linux 使用 `start.sh` 或 `python server.py`。在本机配置 ComfyUI 服务地址。

## 已执行验证

- `npm run lint`：JavaScript 与 HTML 检查通过。
- `npm run test:contracts`：86/86 通过。
- `node tests/workflow_mapping_contract.mjs`：48 个映射共享用例及 schema 检查通过。
- `node tests/workflow_slots_contract.mjs`：27 个槽位共享用例及 catalog 检查通过。
- `python -m unittest tests.test_workflow_mapping tests.test_workflow_slots -q`：6 项测试通过。
- 新增 `tests/slot_presets_ui.mjs`：真实 Chromium 验证保存、JSON 导入导出、应用成功、错误拦截、原子性、重复写入保护、渠道切换、统一筛选、手机编辑及无横向页面溢出；无前端 JS 异常。

浏览器测试需先启动独立测试服务（避免改变日常工程）：

```sh
MIO_HOST=0.0.0.0 MIO_PORT=8000 MIO_DATA_DIR=/path/to/test-data python server.py
# 另一终端
npm ci
npx playwright install --with-deps chromium
npm run test:slot-presets
# 非默认端口可设置 MIO_TEST_URL=http://127.0.0.1:端口
```

截图位于 `docs/acceptance-slot-presets/`。原仓库的旧版 UI 验收脚本含旧行数、折叠入口等断言，需要按新版交互更新，未宣称全量测试通过。未连接真实 ComfyUI GPU 服务，实际生成、第三方节点插件兼容性和外部图像 API 需在用户环境验证。
