# 固定两来源静态工作流恢复：传输合同修正后的独立补充阶段

先核原 action-plan SHA `a9dba5c76af313d428d75b3780af6d94035e4a86e308cd397f609b62e3a83edc` 并写入 execution-plan.json 封存后，固定按 2503119 → 2539304 执行。源与文件规则不变；本阶段按根部追加授权，每文件至多跟随一次实际 Location 的白名单 HTTPS 跳转。所有 signed URL/query/Location/header/Cookie 仅内存使用，未输出或落盘。

首轮 r6-civitai-static-recovery 的 0 HTTP 失败证据完整保留：系统resolver在本机任务代理环境给出非global地址，新增预查先行阻止了请求；随后未注册listener的清理产生KeyError。本轮单独目录按根部澄清，私网/IP禁令针对URL/IP目标，拒绝所有IP literal，不把系统resolver地址冒作Chrome实际远端；只使用精确可信HTTPS域、正常Chrome及Context TLS检查，不改代理或证书设置。首轮实际GET为0，本轮不是重复已HTTP请求。

UTC：2026-11-26T08:35:02.149675+00:00 至 2026-11-26T08:35:05.138681+00:00。PID 24456，CPU affinity读回0x1、PriorityClass读回16384。

| 来源 ID | metadata/文件/跳转 HTTP | 终态 | 完整文件 bytes | 静态图 |
|---|---|---|---:|---|
| 2503119 | 200/307 | non302_server_redirect_stopped_no_retry | None | 未确认静态图 |
| 2539304 | 200/307 | non302_server_redirect_stopped_no_retry | None | 未确认静态图 |

终态计数：

```json
{
  "fixed_source_count": 2,
  "terminal_source_count": 2,
  "outcome_counts": {
    "non302_server_redirect_stopped_no_retry": 2
  },
  "get_reservations_by_kind": {
    "metadata": 2,
    "file_initial": 2,
    "file_redirect": 0
  },
  "total_get_reservations": 4,
  "permitted_remote_get_count": 4,
  "http_status_counts": {
    "200": 2,
    "307": 2
  },
  "context_created_count": 2,
  "context_closed_count": 2,
  "streams_opened": 2,
  "streams_closed": 2,
  "maximum_decoded_chunk_bytes": 11609,
  "static_supplement_cached_count": 0,
  "historical_original_raw_bytes_recovered_count": 0,
  "main75_or_original_truth_replaced_count": 0
}
```

每源只从单次 metadata 中选择 type Config、.json、正数公共 version/file ID 的最小数值二元组；失败不选第二文件。metadata cap512KiB、文件cap2MiB，IO.read每块≤16KiB；exact URL、自有 frame/session、请求关联、状态/MIME通过后才取流，非200/nonJSON/超限立即停止该次响应。服务器跳转不自动跟随，只对首个302实际 Location 做 HTTPS/host/443/无userinfo/无IP literal/无交互或模型路径检查，允许域仅 civitai.com、cloudflarestorage.com、amazonaws.com 及其子域；最多一跳。未声称浏览器远端IP已验证公有或DNS pinning。

文件只用标准库验证 JSON magic/UTF-8/有限数值完整解析，并抽取静态API/UI图；不导入Mio、不执行插件或模型。有效图才存新 owned/raw 私有缓存；public文件不含原图、作者文本、模型/LoRA文件名、下载URL或私有路径。正文为响应级观测，不声称页面提交。

canonical与WL32直接抽取SHA固定 `74b0f79370cb03bb434a6c58fe3e6e6697db02aa0d74ef57ac3cce5240739ae3` 源中5个纯函数，未运行整个旧脚本/main；算法分别 json-sorted-utf8-finite-v1 与 directed-port-wl32-v1。seen-increment.json给出来源、raw、API/UI canonical、WL32及十层增量索引，不修改既有R6 ledger。

原missing仅有12hex历史身份前缀且原canonical序列化算法不可得，故每源 historical_canonical_prefix_match=null；不把短前缀升级成历史全SHA或同一字节证明。即使新图有效，也只计独立同来源补充，历史原字节恢复与main75/原truth替换均为0，所有历史分母保留。

旧白名单 23 个来源/协议/算法文件SHA前后相同：True。原Chrome PID46124身份/监听/profile前后一致仍活：True。只关闭自己创建的context与stream，未枚举existing tabs/contexts/profile/cookies，未browser.close。

- execution-plan.json SHA256：cc42e5844bbc555184750e01b1e868a0c4e3e0e29e67b32046fcba9878f058be
- results.json SHA256：e6130b3602d7ddef0c524d6bf60d02cd67990f679e28ea113a5e2e821f22b501
- provenance-safe.json SHA256：cf0e18173bd8106d794e94b0cde173909b496ef2ee6a0452e429f21505b7bf51
- seen-increment.json SHA256：e40736594511747c5e8f6b23fe53d94b6c832eb2c77ee8a41d1f40850b3f59d8
