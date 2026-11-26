# 原 Civitai 剩余 33 个已知来源的有界元数据阶段

本阶段固定原清单 35 行对应的 34 个唯一来源，排除已完整采集的 1215102，仅对剩余 33 个按数值 ID 顺序串行读取；不是按点赞排序，不新搜索、不换样。1215102 仅引用上一阶段结果 SHA `5584f3f9205090870e02fde0e7b909cb82707d6611434a8d807d0d6e1db945ff`，其时间与计数保留为旧观测，不重取。

UTC 起止 2026-11-26T07:51:48.509320+00:00 至 2026-11-26T07:52:34.343983+00:00。33 项终态摘要：

```json
{
  "source_count": 33,
  "terminal_count": 33,
  "goto_attempt_count": 33,
  "permitted_remote_get_count": 33,
  "outcome_counts": {
    "http_non_200": 2,
    "metadata_recorded": 31
  },
  "http_status_counts": {
    "200": 31,
    "403": 2
  },
  "metadata_recorded_count": 31,
  "workflow_type_declared_count": 31,
  "json_file_declared_count": 3,
  "body_eof_count": 31,
  "own_context_created_count": 33,
  "own_context_closed_count": 33,
  "stream_opened_count": 31,
  "stream_closed_count": 31,
  "collected_bytes_total": 751781,
  "maximum_collected_bytes_one_source": 120214,
  "maximum_decoded_chunk_bytes": 16384,
  "workflow_graph_bytes_verified_count": 0,
  "historical_popularity_proven_count": 0,
  "original_bytes_recovered": 0
}
```

| 来源 ID | HTTP | 终态 | 完整正文字节 | type | 版本数 | 本次 thumbsUpCount |
|---|---:|---|---:|---|---:|---:|
| 21100 | 403 | http_non_200 | None | None | None | None |
| 128556 | 200 | metadata_recorded | 39589 | Workflows | 18 | 1075 |
| 143018 | 200 | metadata_recorded | 7218 | Workflows | 1 | 310 |
| 160207 | 200 | metadata_recorded | 4745 | Workflows | 1 | 475 |
| 304986 | 200 | metadata_recorded | 5594 | Workflows | 1 | 424 |
| 333060 | 200 | metadata_recorded | 3213 | Workflows | 1 | 286 |
| 364115 | 200 | metadata_recorded | 5810 | Workflows | 2 | 138 |
| 617060 | 200 | metadata_recorded | 13017 | Workflows | 2 | 300 |
| 617451 | 200 | metadata_recorded | 18755 | Workflows | 4 | 477 |
| 618578 | 200 | metadata_recorded | 85611 | Workflows | 20 | 2336 |
| 664292 | 200 | metadata_recorded | 28821 | Workflows | 10 | 294 |
| 688735 | 200 | metadata_recorded | 11587 | Workflows | 4 | 307 |
| 698637 | 200 | metadata_recorded | 12996 | Workflows | 4 | 276 |
| 709352 | 200 | metadata_recorded | 4778 | Workflows | 1 | 322 |
| 830300 | 200 | metadata_recorded | 120214 | Workflows | 20 | 457 |
| 871897 | 200 | metadata_recorded | 16078 | Workflows | 5 | 209 |
| 892447 | 200 | metadata_recorded | 5497 | Workflows | 2 | 294 |
| 912123 | 200 | metadata_recorded | 32669 | Workflows | 6 | 447 |
| 933018 | 200 | metadata_recorded | 55735 | Workflows | 16 | 642 |
| 1403746 | 200 | metadata_recorded | 32632 | Workflows | 9 | 366 |
| 1459738 | 200 | metadata_recorded | 8507 | Workflows | 2 | 58 |
| 1466666 | 403 | http_non_200 | None | None | None | None |
| 1513601 | 200 | metadata_recorded | 75882 | Workflows | 11 | 803 |
| 1598938 | 200 | metadata_recorded | 49499 | Workflows | 5 | 1283 |
| 1621455 | 200 | metadata_recorded | 32090 | Workflows | 6 | 77 |
| 1720275 | 200 | metadata_recorded | 2311 | Workflows | 1 | 57 |
| 1722123 | 200 | metadata_recorded | 19400 | Workflows | 2 | 202 |
| 1804319 | 200 | metadata_recorded | 23042 | Workflows | 5 | 40 |
| 1910487 | 200 | metadata_recorded | 5164 | Workflows | 1 | 89 |
| 2060113 | 200 | metadata_recorded | 7397 | Workflows | 2 | 18 |
| 2203669 | 200 | metadata_recorded | 5660 | Workflows | 1 | 19 |
| 2503119 | 200 | metadata_recorded | 11609 | Workflows | 4 | 637 |
| 2539304 | 200 | metadata_recorded | 6661 | Workflows | 2 | 22 |

每项 exact URL/origin、自有 frame/session、GET/Document 与请求关联核对后，仅 HTTP200/application-json 响应允许取流。每块 IO.read 最多16KiB、累计收集/解码最多512KiB，无 Content-Length 依赖；非200/nonJSON、达到上限、超时或异常停止该源且不重试。EOF 后仅内存算正文 SHA/解析并选择白名单字段，随后清空缓冲、IO.close、取消原导航并关闭该源独立 context。32秒单源外层截止包含工作和清理余量；没有并行来源。512KiB不是 Chrome/TCP 可能预接收流量的证明上限。

结果是响应级观测，未声称页面提交。文件计数仅是所有可见版本下 file entries 的 extension/type 计数：不输出文件名或 download URL，未知名称归类，不代表文件可下载。type=Workflows 或 JSON 扩展名声明也不等于已验证静态 API 图；工作流图 bytes 全部未读、原字节恢复为0。本日有限 stats 是 model 资源公开计数，不是 image likes，不证明历史高赞、阈值、排名或采集时排序。

CPU0x1/BelowNormal16384 读回；Chrome PID46124、59871 loopback owner 和精确任务 profile 前后核对，原 Chrome 仍活且身份一致 True。只创建并关闭自己的 context，不枚举既有 contexts/pages/profile/cookies，不 browser.close、不登录、不交互挑战、不下载资产/模型/图，无 Mio/产品/测试/源码改动。11个白名单旧来源/协议文件 SHA 前后相同 True。逐项时间、异常类型（无异常正文）、HTTP分类、正文 hash/bytes、有限 stats、版本与扩展名/类型计数详见 results.json。

- results.json SHA256：79ef8f1f36fa85672308de516dfa2d626160a130d4d7b320376a4a485955367a
- provenance-safe.json SHA256：1d74877ac4e439d9c5bf4a7616049b89b8c08ae67b2160ba73701bc58cd496fe
