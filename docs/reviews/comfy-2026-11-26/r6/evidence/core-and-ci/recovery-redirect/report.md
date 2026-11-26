# 固定两来源静态工作流恢复：最后一次跳转合同修正阶段

先核原 action-plan SHA `a9dba5c76af313d428d75b3780af6d94035e4a86e308cd397f609b62e3a83edc` 并写入 execution-plan.json 封存后，固定按 2503119 → 2539304 执行；只允许原已选 tuple 3123550/3007440 与2894060/2772685，不改选。根部纠正其前阶段误写的仅302条件，本阶段允许首个301/302/303/307/308保持GET，至多跟随一次实际Location的白名单HTTPS跳转，第二跳再3xx即停。所有signed URL/query/Location/header/Cookie仅内存使用，未输出或落盘。

首轮r6-civitai-static-recovery的0HTTP/DNS预查及listener清理KeyError证据、随后transportfix的4GET/两文件307证据均保持。307未跟随是根部当时仅302范围要求，不是站点不可下载证明。本阶段明确重新读取每源metadata与原文件端点，属于新策略阶段，不能声称没有重取；旧4GET加本轮最多6GET，累计上限10。私网/IP禁令针对URL/IP目标，拒绝全部IP literal；不把系统resolver地址冒作Chrome实际远端，只使用精确可信HTTPS域、正常Chrome及Context TLS检查，不改代理或证书设置。

UTC：2026-11-26T08:45:25.539581+00:00 至 2026-11-26T08:45:29.371953+00:00。PID 41384，CPU affinity读回0x1、PriorityClass读回16384。

| 来源 ID | metadata/文件/跳转 HTTP | 终态 | 完整文件 bytes | 静态图 |
|---|---|---|---:|---|
| 2503119 | 200/307/None | selected_file_not_obtained_no_fallback | None | 未确认静态图 |
| 2539304 | 200/307/200 | independent_static_graph_supplement_cached | 52217 | ui:26nodes/44edges |

2539304 的完整文件 SHA 与本次 metadata 文件 SHA 相符；私有缓存落盘后只读复核为52,217 bytes、SHA `b73671d5ccd413fcd7241e7e1e8c7dcf37711038d44edb1cc8f675e09a187d61`，与接收正文一致。其静态 UI 图为26节点、44条端口边；这里只验证静态结构与身份，未调用产品编译或执行。

2503119 的 follow 在发GET前被URL守卫拒绝，原观测仅保存 `url_guard_rejected_no_get`、通用合同错误和ValueError，未细分哪个URL条件触发；不能据此推断登录要求、站点不可下载或图无效。Location已按约定仅内存使用后丢弃，本阶段不再重取补证。

终态计数：

```json
{
  "fixed_source_count": 2,
  "terminal_source_count": 2,
  "outcome_counts": {
    "independent_static_graph_supplement_cached": 1,
    "selected_file_not_obtained_no_fallback": 1
  },
  "get_reservations_by_kind": {
    "metadata": 2,
    "file_initial": 2,
    "file_redirect": 1
  },
  "total_get_reservations": 5,
  "permitted_remote_get_count": 5,
  "prior_stages_actual_remote_get_count": 4,
  "cumulative_two_source_recovery_actual_remote_get_count": 9,
  "http_status_counts": {
    "200": 3,
    "307": 2,
    "no_status": 1
  },
  "context_created_count": 2,
  "context_closed_count": 2,
  "streams_opened": 3,
  "streams_closed": 3,
  "maximum_decoded_chunk_bytes": 16384,
  "static_supplement_cached_count": 1,
  "historical_original_raw_bytes_recovered_count": 0,
  "main75_or_original_truth_replaced_count": 0
}
```

每源只从单次metadata重新核对原已选type Config、.json及固定正数version/file ID；失败不选第二文件。metadata cap512KiB、文件cap2MiB，IO.read每块≤16KiB；exact URL、自有frame/session、请求关联、状态/MIME通过后才取流，非200/nonJSON/超限立即停止该次响应。服务器跳转不自动跟随，只对首个允许3xx的实际Location做HTTPS/host/443/无userinfo/无IP literal/无交互或模型路径检查，允许域仅civitai.com、cloudflarestorage.com、amazonaws.com及其子域，最多一跳。未声称浏览器远端IP已验证公有或DNS pinning。

文件只用标准库验证 JSON magic/UTF-8/有限数值完整解析，并抽取静态API/UI图；不导入Mio、不执行插件或模型。有效图才存新 owned/raw 私有缓存；public文件不含原图、作者文本、模型/LoRA文件名、下载URL或私有路径。正文为响应级观测，不声称页面提交。

canonical与WL32直接抽取SHA固定 `74b0f79370cb03bb434a6c58fe3e6e6697db02aa0d74ef57ac3cce5240739ae3` 源中5个纯函数，未运行整个旧脚本/main；算法分别 json-sorted-utf8-finite-v1 与 directed-port-wl32-v1。seen-increment.json给出来源、raw、API/UI canonical、WL32及十层增量索引，不修改既有R6 ledger。

原missing仅有12hex历史身份前缀且原canonical序列化算法不可得，故每源 historical_canonical_prefix_match=null；不把短前缀升级成历史全SHA或同一字节证明。即使新图有效，也只计独立同来源补充，历史原字节恢复与main75/原truth替换均为0，所有历史分母保留。

旧白名单 29 个来源/协议/算法文件SHA前后相同：True。原Chrome PID46124身份/监听/profile前后一致仍活：True。只关闭自己创建的context与stream，未枚举existing tabs/contexts/profile/cookies，未browser.close。

- execution-plan.json SHA256：6fa91db32fdeea96b1660904e0478615190fef53ee0536c84208af51750af821
- results.json SHA256：99deb60decb5a6726924abd8a54a143080da8bf0349164662e8c2c8165119d6a
- provenance-safe.json SHA256：41195d0b1810c4ba240779be26b2b3abea60086922e4f84b4108f72e8cf8d44f
- seen-increment.json SHA256：fbc00ba3a7a6a005fecd7ac119c7f2fc73e3459de055dae0a7bbabfcd518870d
