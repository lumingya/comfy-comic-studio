# SDK receipt 修复：阶段键与 pending 绑定

范围：`R1-SDK-01` 及第一轮 Ecosystem/SDK 报告第 3 项。只修改
`clients/python/markdown_album.py`、`clients/python/AUTOMATION.md`，新增
`server/tests/test_review_sdk_receipts.py`；生成客户端与 `_runtime.py` 未改。

## 修复前短红证据

先新增两条 API 回归，然后运行：

```text
.venv\Scripts\python.exe -m unittest discover -s server/tests -t server -p test_review_sdk_receipts.py -q
```

原实现结果：2 个测试，`FAILED (failures=4, errors=2)`。

- 155 字符键通过；156 与 180 字符键在真实 SDK 编码、FastAPI 路由和模拟生成完成后，
  HTML 导出均返回 `422`，错误为 `idempotency_key` 超过 160 字符。
- 额外 `overrides.raw_negative` 的 pending 分镜绑定，CLI 实际返回 0 并完成生成，预期返回 1。
  该首个错误绑定会改变 receipt，因此初版同一 receipt 后续三个子用例产生连带失败；最终回归已
  改为每种额外设置使用独立 pending receipt，分别验证 `raw_negative`、`seed`、`profile_id`、
  `node_overrides` 均在任何 POST 前被拒绝。

## 修复策略

新 receipt 写 `version: 2`，生成、HTML、PDF 三阶段键均为阶段名前缀加 SHA256，摘要输入是
完整意图指纹和阶段名。原指纹包含完整用户键、Markdown 解析内容、来源、预设顺序、采用策略、
候选数和工作室地址；不截断用户键，因此相同长前缀、不同后缀的意图不会被合并。

保留 v1 receipt 的已有身份，不就地升级版本：

- 生成始终沿用用户原键，避免生成请求已提交、资源 ID 尚未持久化时创建第二个任务。
- 旧导出键 `原键.html`／`原键.pdf` 长度不超过 160 时原样保留，包括任务已创建但响应丢失的情况。
- 仅超限旧导出键换成稳定派生键；这类请求会在 API 入参校验阶段被拒绝，尚未创建导出任务。
- 不支持的 receipt 版本在发出资源请求前停止；不创建补偿资源，也不自动重试上游。

pending 绑定将请求及读取的 Episode 按真实服务模型的 Episode、Panel、Dialogue、
PanelOverrides、Strip 默认值补齐后完整比较。仅忽略 Episode 的 `id`、`series_id`、工坊
`order`、`created_at`、`updated_at`、`revision`，以及 Panel 的生成 `id`。
其他业务字段保留：负向词、种子、配置、节点／槽位覆盖、角色、控制图、对白说话人、排版、删除状态、
候选记录和未知新增字段等均不能被子集比较忽略。普通服务默认值与明确填入相同默认值均可绑定。
新增默认值如果未被客户端识别会保守拒绝，而不是静默接受；真实 API 默认响应的成功绑定回归会
暴露需要同步的默认值契约变化。

## 绿回归与范围

首轮修复集中执行（工作目录为 `server/`）：

```text
..\.venv\Scripts\python.exe -m unittest tests.test_review_sdk_receipts tests.test_sdk_automation tests.test_sdk_workshop_flow -q
```

结果：`Ran 31 tests in 45.433s`，`OK`。其中新增 6 条测试覆盖：

1. 155／156／180 字符键的真实 SDK→API→模拟生成→HTML/PDF 导出、原命令续跑及任务数不增长。
2. 四类额外生成设置的独立 pending CLI 绑定拒绝；只允许一次 GET，receipt 原字节不变、无任务，
   输出不含正文、额外私有内容或令牌。
3. 真实 API 返回全部默认字段时正确绑定成功；允许资源元数据变化，续跑任务数不增长。
4. 顶层与嵌套业务字段差异，以及 Episode／Panel／Overrides／Dialogue／Strip 未知字段均拒绝。
5. 同一意图阶段键稳定且有界，跨阶段、相同 179 字符长前缀但末字符不同的意图均不同。
6. v1 的 155／156／180 边界恢复：模拟生成已提交、receipt 缺任务 ID，以及合法导出已提交但
   未记录；保留原生成 job ID 和已有导出任务，只创建原先不存在的导出任务，第二次续跑无新增。

另已通过定向 `ruff check`、`ruff format --check`、UTF-8/BOM 检查和 `git diff --check`。
所有执行均使用临时 AppContext、真实 SDK 和 FastAPI、假 Comfy 执行器；未访问个人运行数据、
真实外部生成服务、付费 API 或浏览器。未提交或推送，留给主控集中提交与新代理独立复审。

## 集成补修：Strip.rasterized 默认值

导出修复并行加入服务端 `Strip.rasterized=False` 后，独立复审发现完全相同的 pending 分镜
误拒。新增的真实服务模型对照测试先红：Episode 和 Strip 两个子用例均只差
`rasterized: false`，`Ran 1 test`、`FAILED (failures=2)`。

SDK 明确同步该默认值，不改变未知字段的保守拒绝策略。新增测试直接构造真实服务模型
Episode、Panel、Dialogue、PanelOverrides、Strip，把最小输入的 SDK 归一结果与真实模型
`model_dump(mode="json")` 结果对照，以在后续模型增加默认业务字段时更直接定位镜像漂移。
既有真实 API 默认响应与正确绑定测试另明确断言 `rasterized is False`。

另新增 CLI 回归：把临时工作区已有分镜分别保存为 `rasterized=True` 或不同背景，绑定均只发送
一次 GET、不提交 POST、不创建任务、保留 pending receipt 原字节，输出不含正文或令牌。
普通 `False` 则继续允许正确绑定并完成原意图。其他生成差异与各层未知字段仍保留原拒绝回归。

用上面同一集中命令重新执行：`Ran 33 tests in 50.034s`，`OK`。定向 ruff 检查／格式检查、
UTF-8 检查及 `git diff --check` 同时通过。补修仍仅限原 owner 文件和新增测试／本报告，未提交推送。
