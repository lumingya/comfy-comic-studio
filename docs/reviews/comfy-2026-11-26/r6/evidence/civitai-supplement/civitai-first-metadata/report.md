# Chrome 单来源有界流元数据阶段

固定公开来源 `https://civitai.com/api/v1/models/1215102`，本阶段单独记录，不改旧 34 次 Python 失败或上次 Chrome 连通产物。UTC 2026-11-26T07:40:56.106778+00:00 至 2026-11-26T07:41:17.465241+00:00。

结果 `bounded_public_metadata_recorded`；HTTP 状态 200；goto 次数 1。正文实际收集字节 15510，完整 EOF True，正文 SHA256 `c0f8ff8ef85b5a112b76c660dcaa4f90ff8de106f4d580359458d2b3f00d00c5`。

使用本机已安装 CDP 声明核对的 Fetch.takeResponseBodyAsStream + 无 offset 的 IO.read；每次 size≤16384，累计≤524288，无 Content-Length 前提。读取前核对 exact URL/origin、自有 frame/session 和请求关联，必须 HTTP200/application-json。超限、非 JSON 或超时即停止、关闭流并取消导航；不先整体读取再截断。实际分块计数在 results.json。

这是响应级验证，不宣称页面提交：page_commit_claimed=False、final_page_origin=null。取得流后按协议不能原样继续导航，本阶段关闭流后主动 abort；goto 异常不自动推翻已完成的响应级元数据观察，也不冒称页面加载成功。流已关闭 True，原导航已取消 True，自身 context 已关闭 True，原 Chrome PID46124 前后仍活且身份一致 True。

公开 id/type、versions 数量、Workflow(s)/JSON 文件元数据声明仅列于 results.json 白名单；没有图内容，不能确认实际静态 API 图或恢复原工作流字节。当前有限计数如下（若空则未核，不补零）：

| 元数据计数键 | 当前数值 |
|---|---:|
| thumbsUpCount | 964 |
| thumbsDownCount | 2 |
| downloadCount | 35440 |
| commentCount | 21 |

本次返回 id=1215102 与指定资源相符，资源 type 为 Workflows，versions 数量为 2。白名单识别未发现明确 JSON 文件媒体声明（json_workflow_file_declared=False）；这不证明不存在工作流 JSON，也没有读取任何图，静态工作流实际内容仍未核。实际允许远端请求 1 次、取流 1 次、IO.read 2 次，最大解码块 15510 字节、累计 15510 字节并已 EOF，完整响应正文 SHA256 为 `c0f8ff8ef85b5a112b76c660dcaa4f90ff8de106f4d580359458d2b3f00d00c5`。512 KiB 约束的是脚本收集/解码字节，不是对 Chrome/TCP 取消前预接收流量的测量或保证。

所有计数仅代表本次 2026-11-26 公开 model 资源元数据，不是 image likes，不代表历史采集时高赞、阈值、排名或排序。没有扩展到其他来源，也不重新选择样本。

CPU0x1/BelowNormal16384 读回后执行；监听 owner、Chrome 进程和精确任务 profile 前后守卫。仅新建自己的 context/page，不枚举既有状态，不 browser.close、不登录、不交互挑战、不截图、不下载资产/模型/工作流，无 Mio/产品/测试。8 个白名单旧来源/协议文件前后哈希一致：True。正文只在内存中解析并投影，没有全文、作者账户、prompt、文件名或下载 URL 产物。

- results.json SHA256：5584f3f9205090870e02fde0e7b909cb82707d6611434a8d807d0d6e1db945ff
- provenance-safe.json SHA256：53f67ba84fc825fa4a4eebce1a35d934d19c479fec7677240ff05dee37d3258e
