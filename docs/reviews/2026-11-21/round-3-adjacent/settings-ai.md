# 第三轮：设置与 AI 辅助相邻路径审查

基线：`ddf8d81f5a8d3b624da9618718599374de2f61f6`。本报告由设置／AI 辅助审查者独立完成，仅新增本文件；没有修改生产代码、生产测试、共享台账，也没有提交或推送。

已读 `AGENTS.md`、`README.md`、`docs/ROADMAP.md`、CI、当日审查 README／FINDINGS。下列主缺陷源文件均不在 `git diff --name-only 6aa0f8f...ddf8d81` 的原改动列表中；没有重复前两轮已闭项。架构异味、附件保留疑问与确认缺陷分开记录。

## 结果

确认 5 项：4 项 P2、1 项 P3。其中第 5 项为按主控追加要求完成的恢复 UI 边界证据，已交生命周期审查协调，集中台账不要重复计数。

| 本报告编号 | 优先级 | 可触发结果 |
| --- | --- | --- |
| SET-AI-01 | P2 | 正常上传 AI 图片后，工作区 head／备份创建返回 400 |
| SET-AI-02 | P2 | 已收到远端刷新后，保存旧设置草稿仍回退未编辑的安全项／其他渠道 |
| SET-AI-03 | P2 | 待确认发送的对话被另一窗口删除后，新对话也被旧 pending 卡死 |
| SET-AI-04 | P3 | AI 设置保存过程中仍允许继续编辑，响应成功关闭时丢弃后续修改 |
| SET-AI-05 | P2 | 恢复 UI 仍限制 2 GiB，拒绝后端 12 GiB 范围内的备份 |

### SET-AI-01 — 正常附件生产者与备份校验者使用不同 URL

- **位置**：`extensions/ai-assist/core/service.py:153-162`，特别是 158；`extensions/ai-assist/core/backup.py:134-143`，特别是 141。现有 `extensions/ai-assist/tests/test_backup.py:61` 手工写入旧 URL，未经过真实上传接口。
- **触发**：开启 AI 扩展，通过聊天上传任意有效图片；无需发送给模型，也无需创建对话。
- **最短离线复现**：临时 `AppContext.create(temp, autostart=False, seed_instance=False)`；通过 `TestClient` 开启随包 AI 扩展；用 Pillow 在内存生成 1×1 中性 PNG；`POST /api/ext/ai-assist/attachments` 上传；随后 `GET /api/backups/head` 和 `POST /api/backups`，请求体为 `{"include_credentials": false}`。
- **实际输出**：

  ```text
  initial_head 200
  upload 201
  url_prefix /api/ext/ai-assist/attachments
  attachment_read 200
  head_after_upload 400 {"detail":"AI assistant attachment metadata does not match its image","kind":"invalid"}
  backup_after_upload 400 {"detail":"AI assistant attachment metadata does not match its image","kind":"invalid"}
  ```

- **预期**：由受支持上传接口生成的附件可以参与工作区 head 计算与完整备份。
- **原因与影响**：生产者写 `/api/ext/ai-assist/attachments/{id}`，校验者要求 `/api/ai-assist/attachments/{id}`。一次普通上传即阻断整个工作区的备份，而非只影响 AI 图片导出。删除对应对话后附件仍保留，不能靠删除聊天解除该失败。
- **建议**：让生产与校验共用规范 URL 生成逻辑；添加真实上传 → head → export → inspect 的集成回归，不再由夹具手写附件元数据。若兼容旧数据属于明确产品选择，再独立处理；本报告不要求兼容层。

### SET-AI-02 — 旧设置草稿会回退后台刷新带来的新字段

- **位置**：`web/src/pages/settings/GeneralSection.tsx:17-27,33-50`；`web/src/pages/settings/ChannelsSection.tsx:53-62,83-95`。依赖写边界：`web/src/api/system.ts:24-30`，`server/mio_server/api/system.py:44-55`，`server/mio_server/settings.py:104-132`。
- **触发 A**：窗口 A 打开常规设置，仅修改共享图像服务 URL；窗口 B／API 修改回收天数、拦截词及超时；A 切回触发查询刷新，然后保存自己的 URL 草稿。
- **离线 DOM 例**：基于现有 `configSettings`、真实 `GeneralSection` 与 QueryClient，mock GET／PATCH。输入 URL 后将远端状态改为 `trash_days=180`、`guard_terms=['remote-safety-term']`、`llm.timeout=600`，显式 invalidate `['settings']` 并确认第二次 GET 完成，再点击保存。
- **实际**：PATCH 仍携带草稿创建时的整份 `editable(d)`，最终为：

  ```text
  GENERAL_REMOTE_REVERSION {"trash_days":30,"guard_terms":[],"timeout":240}
  ```

  URL 成功更新为 A 的新值，其他字段却回到旧值；无冲突提示。
- **真实 HTTP 补证**：同一临时 AppContext 下，保留旧 GET 的 `{llm, guard_terms, trash_days}`，先 PATCH 远端三项，再 GET 确认 180，然后提交 UI 相同形状的旧草稿；实际响应 200，`guard_terms=[]`、`trash_days=30`、`timeout=240.0`。因此不是 mock 人工引入的后端行为。
- **触发 B**：渠道 A 仅改名称；远端更新渠道 B 的 model；后台 GET 已返回更新；保存 A。真实 `ChannelsSection` 的 DOM 例中，B 的 `new-remote-model` 被提交成旧的空字符串。全列表提交也可能覆盖新增／删除渠道和默认选择。
- **预期**：保存用户实际改动的字段；或者检测草稿基线冲突并要求处理，而不是把已观察到的外部更新当作自己的编辑撤销。
- **影响**：无需同时发送请求，只要用户编辑期间发生另一窗口／API 更新即可。安全拦截词、回收保留时间、模型路由等会被静默回退。
- **建议**：保存基线和字段级 dirty intent；提交最小改动，遇到同字段冲突显式处理。若继续整块／列表替换，需在服务端提供并验证 revision。不能仅把草稿的 revision 换成刷新后的新 revision。该项不要求重用私有 preference 接口，但可参考其 CAS／intent 原则。

### SET-AI-03 — 404 回退没有恢复新草稿，旧 pending 污染新对话

- **位置**：`extensions/ai-assist/page/AssistChat.tsx:192-215`，特别是 207-214；发送只读／disabled 条件位于同文件 composer 下半部分。
- **触发**：A 的发送响应丢失，已持久化 `pending={id:chat_old,key:old-key,...}`；实际请求结束后，B 删除该对话；A 刷新。此时旧对话 GET 返回 404，且没有其他历史对话可切换。
- **离线 DOM 例**：在 sessionStorage 放入与真实断网流程相同形状的 `mio.assist.draft.chat_deleted`（文字、空附件、带原始 payload 的 pending）；localStorage 选中 `chat_deleted`；mock 对话 GET／回执 GET 为 404，目录为空，渠道有效；渲染真实 `AssistChat`，等待 localStorage 选中项被清除，再点击「新对话」。
- **实际**：

  ```text
  DELETED_PENDING_BLOCKS_NEW {"text":"pending-old","attachments":[],"pending":{"id":"chat_deleted","key":"old-key","payload":{"content":"pending-old","attachment_ids":[]}}}
  ```

  上述对象被写进 `mio.assist.draft.new`；输入框仍 readonly，「发送」disabled。查询原请求永远 404；点击新对话再次读取已污染的新草稿，所以不能通过界面恢复新的发送。手工清理 sessionStorage 可解除，但普通用户没有对应入口。
- **预期**：旧会话 404 时保留其原 key 的未知结果记录，同时切到独立的新草稿；新会话能继续编辑／发送。
- **原因**：404 effect 仅 `select(null)`，没有像 `choose(null)` 那样恢复 `draft/attachments/unknown/pendingSend`。随后保存 effect 以 selected=null 将旧会话状态写入新草稿键。
- **建议**：集中使用完整选择／草稿切换状态转换；对“会话确实不存在”的 pending 给出明确的保留／解除路径。保留原 key 的审计语义，不要自动重发未知结果请求。

### SET-AI-04 — 保存中的新编辑被成功回调丢弃

- **位置**：`extensions/ai-assist/page/AssistSettings.tsx:65-88,98-110` 以及后续输入控件。只有页脚保存／取消按钮和弹窗关闭被禁用，表单字段、标签、权限控件仍可交互。
- **最短离线 DOM 例**：有效渠道 `model=mock-only`；将名称改成 first-label，点击保存；mock PUT 的 Promise 保持未完成；随后在仍 enabled 的模型输入框填 `last-user-intent`；再 resolve PUT。
- **实际**：输入框确实接受并显示 `last-user-intent`，但只有最初一次 PUT，body 中 model 仍是 `mock-only`；完成时 `onClose` 调用一次，真实父组件卸载弹窗，后续修改丢失，用户只看到“已保存”。

  ```text
  AI_PENDING_SAVE_DISCARD {"submittedModel":"mock-only","onClose":1}
  ```

- **预期**：保存期间禁止输入；或保留新一轮草稿并允许继续保存，不能关闭并暗示最新可见值已保存。
- **影响／分级**：慢磁盘、网络延迟或保存后查询刷新期间可触发的局部修改丢失，通常重新编辑可恢复，列 P3。
- **建议**：将全部可变控件置于 disabled fieldset／等效 pending 保护；或者对提交版本打序号，只在最新草稿仍等于提交快照时关闭。主设置页已有 pending fieldset 可作为邻近行为参考。

### SET-AI-05 — 恢复 UI 的 2 GiB 上限落后于服务端 12 GiB

- **位置**：`web/src/api/backups.ts:12`：`MAX_WORKSPACE_BACKUP_BYTES = 2 * 1024 ** 3`；`web/src/pages/settings/BackupsSection.tsx:331-334` 直接拒绝所选文件；对照 `server/mio_server/backups/archive.py:24`：`MAX_ARCHIVE = 12 * 1024**3`。
- **触发**：用户选择一个大于 2 GiB、小于等于 12 GiB 的合法工作区备份。后端目前能创建／处理这一压缩大小范围，README／路线图也记录 12 GiB。
- **最短离线 DOM 例**（没有创建 GB 文件）：

  ```ts
  const file = new File(['metadata-only'], 'synthetic-three-gib.mio-workspace.zip', {
    type: 'application/zip',
  });
  Object.defineProperty(file, 'size', { value: 3 * 1024 ** 3 });
  // 渲染真实 BackupsSection，打开“从备份恢复…”，将 file 上传给其 input[type=file]。
  ```

- **实际**：选择时立即显示“工作区备份不能超过 2 GiB。”；「检查文件」按钮不存在；POST 请求数为 0。

  ```text
  THREE_GIB_UI_REJECTED_BEFORE_POST {
    metadataSize: 3221225472,
    actualContentBytes: 13,
    error: '工作区备份不能超过 2 GiB。'
  }
  ```

- **预期**：前后端共享一致的公开上限，支持范围内的文件可以进入后端预检。此探针仅证明 UI 大小门槛错误，不声称 13 字节伪 ZIP 可以通过真实内容检验。
- **建议**：同步限制与中英文提示，最好由公开能力／契约驱动；补 2 GiB+1 与 12 GiB／12 GiB+1 的元数据边界用例。已通知主控与生命周期审查者协调归属。

## 未升级为缺陷的观察

1. **附件保留契约未明确**：真实上传成功；创建引用该附件的对话后删除对话得到 204，附件 GET 仍 200，临时目录仍有 `.json/.bin` 两个文件。`core/service.py:120-125` 只删除对话文件；附件可被多个消息／对话通过 ID 引用，项目没有本轮已确认的“删除最后一处引用必须清除”契约。因此这里只记录实际保留行为，**不把 200 当隐私漏洞，也不要求级联删除**。若将来要求清理，须处理共享引用和未发送草稿，不可简单按单个对话删除附件。它在 SET-AI-01 中的作用仅为说明删聊天不会解除备份阻塞。
2. **主设置改变目的地址时的 retained key 策略**：模型目录草稿接口会拒绝跨地址沿用 MASK；主设置 PATCH 则按既有配置约定保留被回传的遮蔽密钥。是否允许用户显式保存新地址即授权复用，是产品安全策略问题；本轮没有将其判为凭据外泄，也没有向任何真实地址发送请求。

## 实际验证与安全边界

- Python 探针使用临时 AppContext／TestClient、内存 1×1 中性 PNG、自动清理临时运行数据。模型始终替换为固定回复函数；上游网络、真实付费模型、ComfyUI 均未调用。
- 定向 UI 探针使用真实源文件的临时副本、已安装 Vitest／jsdom／Testing Library 和 mock fetch。外部临时目录直接引用 Windows 中文仓库路径时 Vite 模块解析失败，于是复制 `web/src` 和 AI 页面源码到该临时目录；没有改原文件。复制时 HEAD 为固定基线，且没有生产工作区修改。
- 第一批 4 个 DOM 探针一次运行全部通过：常规旧草稿回退、渠道旧草稿回退、AI pending 保存丢失、404 pending 污染新草稿。这里“通过”指观察到报告中的缺陷行为，不代表产品验证通过。
- 第 5 个大小探针单独运行 1 passed，既有 4 项 skipped，没有无故重跑通过项；真实内容 13 字节，未创建大文件。
- 权限／凭据反证也使用真实本地接口：本扩展 `PUT /settings` 被 OperationBridge 标为 restricted 且 allowed=false；读取 AI 设置不含合成测试密钥原文；改变目的地址且保留 MASK 的 AI PUT 返回 400；使用仅 read/write/render 的临时 v2 token 启动聊天，即使扩展权限已授予 admin，mock 模型请求 `POST /instances` 仍 failed，实例创建数为 0。没有发现此路径突破 token 权限上限。
- 未安装／调用浏览器、没有 E2E、没有截图；没有接触个人运行配置、令牌、Cookie 或真实外部服务。临时探针及源码副本在报告完成后精确删除。

## 覆盖清单与未验证边界

**重点读与执行路径**：

- 设置草稿和显示：`GeneralSection.tsx`、`ChannelsSection.tsx`、`ChannelFields.tsx`、`ChannelExtensionOptions.tsx`、`ConfigurationParts.tsx`、`ModelCatalog.tsx`；对照现有 Configuration／AssistSettings／AssistChat／Backups 用例与 mock 工具。
- 保存／缓存调用：`web/src/api/preferenceWrites.ts`、`system.ts`、`client.ts`、`backups.ts`、`update.ts`、`workshop.ts`。`preferenceWrites` 的序列化、CAS 重放、remote epoch 等仅作代码阅读与既有用例对照；本轮没有声称重新穷尽全部竞态。
- AI：`core/models.py`、`storage.py`、`service.py`、`operations.py`、`api.py`、`backup.py`、页面 `api.ts`、`runtime.tsx`、`AssistChat.tsx`、`AssistSettings.tsx` 与 README；运行真实上传／备份和权限上限路径，运行页面草稿／pending 路径。
- 依赖定位：主设置 API／模型目录、备份 participant／archive、设置路由与主题面板、权限页面／实例和 profile 页面部分路径。接口依赖阅读不代表这些模块逐行全覆盖。

**明确未验证**：真实 OpenAI／DeepSeek／Gemini 计费调用、各供应商网络超时与限流；真实 ComfyUI；跨浏览器／隐私模式存储；真实多进程磁盘竞争；附件共享引用的完整垃圾回收策略；完整升级、市场安装、主题导入和备份恢复重启生命周期；workshop 调度全矩阵。没有跑全量门禁，也没有把抽样无发现的路径说成全仓零缺陷证明。
