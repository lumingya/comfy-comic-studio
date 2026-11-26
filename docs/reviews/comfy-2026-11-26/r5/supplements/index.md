# R5 补充材料安全发布准备索引

本目录仅组包八份明确白名单最终文件，状态为 **RESULTS_RECORDED_REVIEW_REQUIRED**。这是纯文件安全归档准备，不是新产品复测、CI 查询、五位审查或验收签名。原件、既有发布准备目录与仓库均未修改。

| 分组 | 发布文件 | 保留的证据边界 |
|---|---|---|
| Civitai 来源限制 | [报告](civitai-source-limitations/report.md)、[结果](civitai-source-limitations/results.json)、[安全来源证明](civitai-source-limitations/provenance-safe.json) | 固定历史 35 样本对应 34 个公开资源；34 次单次匿名请求均无 HTTP 响应，当前计数与身份核对均未取得。不能改称 403/404、服务不可用、原件恢复或历史高赞已证明。 |
| R4 图片绑定归因 | [报告](r4-reference-attribution/report.md)、[结果](r4-reference-attribution/results.json)、[安全来源证明](r4-reference-attribution/provenance-safe.json) | 对 ed45509 既有三项图片异常及组合 mapping 结果的静态归因；原自动期望与 47 分母不变，不是三次新 image-only mapping 复测，也不据异常认定 safe boundary。 |
| 原任务覆盖映射 | [覆盖表](coverage/coverage-map.md)、[结构化索引](coverage/coverage-map.json) | 连接已存结构、原子请求与永久测试文本；静态方法/断言存在不代表执行通过，结构存在不代表整链兼容，各队列与重叠类别不得相加。 |
| 出版完整性 | [来源与发布双哈希清单](manifest.json) | 逐项记录输入 SHA256、输出 SHA256、计算 Git blob SHA1、机械规范化与安全/链接检查。 |

## 时间与身份

三组文件保留各自生成时身份。覆盖映射仍写明实测产品版本为 ed45509、6e 有已知 CI 回归、下一候选在其上次交接时尚未提交、R5 未开始；这是原文件的历史快照，不用于断言当前 Git/CI 状态。本次没有读取仓库、查询 CI 或把旧证据改标为后续候选的执行结果。

## 不得扩大解释的结果

- Civitai：当前有限计数可得来源 0/34、关联样本 0/35，历史高赞选择仍缺证 0/35；没有下载工作流、图片或模型。历史 12 位 hash 前缀不是完整 SHA256。
- R4：三项自动图片请求缺相应 kind 绑定；已有组合 mapping 的 placeholder 接受与目标值吻合，不是资产上传、真实出图或三次隔离图片复测。自动异常没有 Compiled，warning、完整 delta 与 effective targets 的缺失仍保留 unknown/null；可选未来计划仍未授权、未执行。
- 覆盖映射：current75 226/230、R1 66/70、R2 原严格 104/130、fixed 122/138、R4 自动 36/47 按原队列保留。Scheduler、Batch 等没有保存逐请求结果的行继续未测；原件缺失、R3 advanced 源连接缺失、真实整链与最终 Chrome/全门禁/新审查/清理缺口均不补造。
- 三组补充不新增成功分母，不修改旧 oracle，不把静态测试文本、旧结果归因、保守回退或明确 mapping 直接计为新的自动 PASS。

## 发布处理与安全检查

仅复制白名单安全文本/JSON，不包含 private provenance、其他 draft/history、脚本、日志、原图、原提示词、资产文件名或账户。公开 Civitai 数字资源 URL、脱敏 case 标识、值哈希、JSON 指针字符串与中性证据/测试文件名保留用于追溯；未读取它们指向的文件或访问 URL。

发布副本统一 UTF-8 无 BOM、LF、末尾单换行。覆盖映射 JSON 的原样本图片文件名仅在发布副本替换为稳定中性来源 ID，所有键、source_ref 与必要 JSON 指针同步替换，保持对应关系；原名映射不落入发布包，manifest 只记录匿名化类别和数量。除此之外不改内容。代码相对路径与中性证据文件名保留。

原文件 SHA 与发布 SHA 分别记录，原有报告内的输入/证据 SHA 继续指向其原始来源字节。递归检查仅将五类危险名称作为实际字典键判禁，JSON 指针字符串与说明文字不视为键。Markdown 相对链接仅在本十文件包内核验；外部公开链接不联网验证。最终 manifest 自身 SHA 由交接消息单独给出。
