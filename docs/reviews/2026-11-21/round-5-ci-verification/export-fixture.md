# R5-TEST-EXPORT-01：导出夹具独立窄复审

结论：**支持关闭，未发现新问题**。复审对象是固定基线 `0bf22c2` 上
`server/tests/test_export_jobs.py` 的未提交补修；只在隔离 worktree 执行。
先审差异形成反证，再阅读[作者证据](../fixes/export-test-timeout.md)，没有复跑作者的全部 30 项。

## 独立反证与实际结果

独立 TEMP 脚本仅装载三个自建测试，**3 项通过，8.948 秒**：

| 反证 | 已执行的护栏与断言 |
| --- | --- |
| 去掉生成是否也去掉了真实素材或采用 | 同时禁止 `ComfyRenderExecutor.execute`、`on_complete` 和夹具的 `ApiCase.drain`；新 `setUp` 仍成功，三者均未调用。真实 AssetStore 中有两张可解码的 64×96 PNG，像素分别为 `(40,0,0)`、`(80,0,0)`；持久化 Episode 有两格、两条已采用 Take，每条有 `adopted_by=user`。对生产 `_set_status` 的透明包装记录到两次真实 HTTP 采用调用。 |
| 新旧夹具是否产生不同或不完整的版面 | 对旧 `ApiCase` + `adopt_two_frames` 和新夹具分别调用真实 `render_snapshot`，两者的条漫宽高、两格 `panel_boxes` 和整图尺寸完全相同；新夹具派生布局中只包含这两格。两者都通过真实 `freeze` / `write` 生成 PDF，各有两个 `/Type /Page` 对象。旧 helper 的引擎确实存在一个 `comfy.render` 作业，新夹具准备完成时作业列表为空。 |
| 原失败用例是否仅因没有执行正文而通过 | 保持 Comfy 两条入口禁止，执行原 `test_write_cancellation_cleans_output`，只透明包装其真实 `ExportService.write` 和传入的 checkpoint。记录到 writer 一次、checkpoint 五次、`Canceled` 传播一次，原断言通过且 `cancel.pdf` 不存在。没有替换 writer 结果、模拟取消成功或吞掉异常。 |

独立命令在隔离 worktree 的 `server/` 执行：

```powershell
python -X utf8 "$env:TEMP\mio-export-fixture-independent.py" <隔离worktree绝对路径>
# Ran 3 tests in 8.948s
# OK
```

探针采用真实临时 AppContext、SQLite、AssetStore、生产采用路由、布局和导出器。
辅助脚本验证完即删除；没有写入仓库测试、生产代码或共享台账。

## Standards

没有确认规范违规。差异只调整导出测试的素材准备，并复用现有 `png()` 中性图片助手；
没有修改通用 `drain`、生产调度、等待预算、重试或跳过条件。素材和 Take 均真实持久化，
采用仍走生产 API；不是把成功结果直接塞给导出器。

## Spec

没有确认行为或覆盖缺口。导出作业测试从“已有两格采用素材”开始，仍包含多页、冻结、
权限、下载、重试、恢复和取消清理等原有断言；代码差异没有改动这些测试正文。
原 `test_album.AlbumApiTests` 及其 `adopt_two_frames` 未改变，保留真实生成、结果保存、
采用到导出的集成链；本复审还独立实际运行旧 helper，确认其仍建立真实离线生成作业。
布局是在真实导出渲染时派生，本复审没有把“调用采用路由”单独说成已经验证了布局。

## 边界

- 本机是 Windows / Python 3.13；这些结果不代称 Windows Python 3.11 或最终 CI 已通过。
- 作者的每项 2.7 秒慢保存探针证明正常推进也能撞上旧夹具的 5 秒截止；本复审没有自然重现
  CI 的原始慢源，也不将其认定为已确证的生产死锁。本次关闭的是导出测试对无关异步生成截止的依赖。
- 原测试正文的静态保留与上述三个动态探针共同支持窄范围关闭；没有重跑作者 30 项或全量 1,576 项。
- 未访问默认 legacy 根、用户运行数据、真实 ComfyUI、付费 API、网络共享或并行主工作区。
  只新增本报告；准确最终提交的跨平台 CI 仍由主控确认。
