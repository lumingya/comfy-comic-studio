# 原 Civitai 35 样本公开元数据补证

固定读取原清单 initial75 的 35 行，不换样、不读取旧 oracle 或审查结论。35 个样本对应 34 个不同的公开 model 资源页，均有资源 ID；10 行另保存版本/文件 ID，来源 URL 均非 image 页。已保存格式全部为 JSON，35 行有旧 node_count，9 行另有旧 actual_node_count；这些均为清单历史字段，不是本次重新测得节点数。

本次观察日期为 **2026-11-26（Asia/Shanghai）**；UTC 起止 2026-11-26T06:30:21.533890+00:00 至 2026-11-26T06:30:43.755969+00:00。向每个已知资源的公开 REST 元数据接口串行读取一次，共 34 次；未重试、未跟随跳转、未登录、未用 Cookie/Profile，未下载图、图片、模型或工作流文件。仅在内存选择有限数值计数，原始响应不落盘也不输出。[官方 REST 文档入口](https://developer.civitai.com/docs/api/rest)。

| HTTP 结果 | 不同公开来源数 |
|---|---:|
| 未取得 HTTP 响应（null） | 34 |

34 项均记录为 `network_or_tls_error_no_retry`，没有收到可核验的 HTTP 状态码或 JSON 正文；因此不是 403/404 结论，也不能据此判断 Civitai 服务本身是否可用。这里只证明本客户端在上述时段的单次匿名读取未成功，全部计数与文件身份核对保持 unknown/未核；未换代理、改认证或重复访问。

当前有限计数可得来源 **0/34**，可关联原样本 **0/35**；其余来源保持 unknown/null。每项公共来源、样本身份哈希、已保存节点数、HTTP 状态、当前有限计数及采核时间在 results.json 内。model 资源的 thumbsUp 等不能改称 image likes，也不能假定等于某个已保存 workflow 版本的计数；未获取当前工作流节点数。

同一响应还做有限文件身份核对：仅资源 type 明确 Workflow(s)、文件明确 JSON 时，核对原存 version/file ID（存在时均须一致）；无原存 ID 时须 full SHA256 唯一匹配旧 12 位前缀。仅导出候选计数、ID 匹配布尔与满足条件的公开完整文件 SHA，不输出文件名或下载 URL。已核对来源 0，取得合格公开 hash 线索的样本 0；全部标为 metadata-only，实际原字节恢复为 0，HTTP 失败者未核，不追加请求。

**历史“高赞选取”仍缺证：0/35。** 原清单未保存采集时 likes/reactions、排序位置、明确阈值或排序查询。本次即使取得当前计数，也只能证明本日可见的中性计数，不能证明原采集时“高赞”或按高赞排序；本报告不设阈值、不重排、不补选。35 个 original_hash 均是 12 位历史前缀，单列为短身份，不冒充完整 SHA256。

原清单 SHA256 前后相同：e42c7e492ff7de997ce462cf3a60e4352cb974923a2744a8fdd8cd5f997d6021。资源 guard 已读回 CPU 0x1、BelowNormal 16384，PID 50156；无 Mio import、产品请求、测试或子进程。仅本新目录产物被写入，既有语料、preflight 与仓库均未修改。安全输出通过递归五键、私有路径与公开 URL 白名单检查。

- results.json SHA256：c74ca21a8023766c3fde5d665c451c6d9290033f626d424c52273df5d3fd4ba6
- provenance-safe.json SHA256：5fe1958dd40f4dde3428a0874389740ec9070e3ce87df6ec9a9e5b4e0a36cdf0
