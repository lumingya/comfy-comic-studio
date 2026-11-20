# 用脚本完成一部画册

这里的工具只用 Python 3.11 标准库，调用通用开放 API v2，不依赖聊天平台。
先在 Mio 设置中签发 `read + write + render` 令牌，把它放进 `MIO_TOKEN` 环境变量。
令牌不作为命令行参数，也不会写进续跑记录。

## Markdown → 分镜 → 生成 → 画册

保存 `story.md`（UTF-8）：

```markdown
# 雨后的车站
一封信，两段安静的等待。

## 站台
{subject} waiting at a quiet railway platform after rain, watercolor
> 雨停了。

## 归途
{subject} carrying a letter along a tree-lined street, soft evening light
> 明天再见。
```

`#` 是作品名，`##` 是分幕，`>` 是台词，其余分幕正文原样成为提示词。标题前后的简介、
段落与 `{变量}` 都会保留；不调用文本模型，不执行 Markdown 中的代码或链接。
不支持代码围栏，每幕必须有非空提示词。作品名上限 120 字，单次最多 512 幕。

在仓库根目录运行（将两个 ID 换成工作流、预设列表中的真实 ID）：

```text
python clients/python/markdown_album.py story.md --out ../my-album --workflow WORKFLOW_ID --preset PRESET_ID --idempotency-key rain-story-001 --adopt-first
```

一条命令创建分镜、按参数顺序选用已有预设、提交幂等生成任务、轮询完成、采用每幕首个结果，
再导出 `album.html`（典藏画集 Monograph）和 `album.pdf`。`--preset` 可以重复；
`--workflow`、`--profile`、`--channel` 三选一，保持图像来源可替换。
`--base-url` 可指定另一台受信任的 Mio，`--candidates` 设置每幕候选数。

**自动采用必须显式传 `--adopt-first`。** 省略时，命令仍提交生成任务，但在生成完成后停在
`awaiting_adoption`（退出码 2），供人在 Mio 中逐幕挑图。挑好后用完全相同的命令续跑导出。
已采用的作品不需要再调用模型。

输出目录中的 `mio-automation.json` 只保存协议版本、请求指纹、资源 ID、阶段状态和输出 SHA256，用于续跑。
同一目录只对应同一次创作意图，不要并发写它；改变正文、来源、预设顺序或采用策略时使用新目录和新键。
重跑同一命令沿用分镜与幂等键，不重复提交生成意图；已完成文件核对 SHA256 后直接保留。
已有文件不会被覆盖，丢失或改动过的输出会被拒绝，留给使用者检查。
若进程刚写完文件、尚未来得及记录就中断，也会保守地保留该文件并停止。

`--idempotency-key` 接受 1–180 字符。新记录（`version: 2`）用完整创作意图的指纹与
`generation`、`html`、`pdf` 阶段名派生固定长度的 SHA256 键，各阶段有独立身份，长键不会因追加
后缀而超过服务端限制。旧版 `version: 1` 记录继续沿用原生成键及未超限的旧导出键；只有超过
160 字符、服务端必然在创建导出任务前拒绝的旧导出键才改用派生键。因此已有未完成记录仍可用
原命令续跑，不重新创建分镜，也不会因升级键协议重复生成或重复提交已有导出任务。

超时、失败、取消和不确定结果均不会自动重试上游或生成新键。先在 Mio 核对任务；解决问题后用原键续跑。
默认 `--timeout 1800` 是每个生成／导出等待阶段的上限。

分镜创建也有独立保护：发出创建请求前先持久写入 `creation: pending`。
若服务器已创建但响应丢失，或本地保存资源 ID 失败，重启后不会再盲目创建。
这时退出码为 1、状态为 `creation_pending`，请在分镜工坊核对已建资源；找到对应 ID 后显式续跑：

```text
python clients/python/markdown_album.py story.md --out ../my-album --workflow WORKFLOW_ID --preset PRESET_ID --idempotency-key rain-story-001 --adopt-first --bind-storyboard EXISTING_ID
```

工具会读取该分镜，按服务模型补齐默认值后，核对标题、简介及全部业务内容，再保存绑定并继续
原幂等生成意图。只忽略服务端产生的资源 ID、分镜在工坊内的排序、创建／更新时间及修订号；
普通默认字段不会误拒，额外的负向词、种子、出图配置、节点／槽位覆盖等生成设置均会拒绝。
未识别的新业务字段也会停止绑定，错误输出不包含分镜正文或凭据。
若确定请求从未创建资源，可以在人工核对后使用新的输出目录和新键；不要直接删除 pending 标记后盲重发。
这是一种保守的本地恢复协议，不把缺乏幂等契约的“创建分镜”伪装成可自动重试操作。

## Webhook 接收与订阅排查

订阅管理需要独立的 `admin` 令牌。下面的签名文件和 SQLite 文件都应放在仓库外、仅自己可访问的目录，
不要提交到 Git。服务端签名密钥在创建订阅时生成，工具直接写入指定的新文件，不在终端回显：

```text
python clients/python/webhook_debug.py subscribe http://127.0.0.1:8791/mio-webhook --events job.completed job.failed take.status --secret-file ../private-mio-hook.json
python clients/python/webhook_debug.py listen --secret-file ../private-mio-hook.json --replay-db ../private-mio-replays.sqlite3
```

监听器默认只绑定 `127.0.0.1`，服务端必须能访问该地址。另一终端可运行：

```text
python clients/python/webhook_debug.py list
python clients/python/webhook_debug.py test HOOK_ID
python clients/python/webhook_debug.py deliveries HOOK_ID
```

`list` 给出可订阅事件；`test` 发送签名 `ping`；`deliveries` 查看状态码与尝试次数。
监听端仅打印经过校验的事件名与投递 ID，不打印图片、剧本、原始响应、签名密钥或访问令牌。
也可通过 `MIO_WEBHOOK_SECRET` 提供接收端已知密钥，无需签名文件。

## 在自己的程序中校验

```python
from mio_client import verify_webhook
from webhook_debug import SQLiteReplayStore

store = SQLiteReplayStore("/private/mio/replays.sqlite3")
event = verify_webhook(raw_body_bytes, request_headers, signing_secret, replay_store=store)
handle_event(event)  # 只能放在校验之后
```

必须传收到的原始字节，不能先解析 JSON 再序列化。SDK 使用常量时间 HMAC 比较；默认接受正负 300 秒，
可用 `tolerance=` 调整，并用 `clock=` 注入测试时钟。签名通过后，继续核对签名正文内的 `id`、`event`
与请求头一致，最后才占用投递 ID。无效签名、格式错误、头部替换都不会污染重放存储。
同一已消费 ID 即便换正文或时间戳，也会被拒绝。签名时间窗仅用于鉴权，不会释放已消费的投递身份：
服务端重试可以重新签发时间戳，因此不能在首个签名过期后删除 ID。

自定义持久实现只需满足生成客户端内的 `ReplayStore`：

```python
claim(delivery_id, digest, expires_at, now) -> bool
```

该方法必须原子地检查并占用 ID，重复返回 `False`，不论正文摘要是否变化。
`expires_at` 仅记录首次签名的时间窗元数据，不能用于自动删除已消费 ID。
存储或容量失败必须抛出异常、拒绝处理事件，不能把新事件当作重复成功确认。
`SQLiteReplayStore` 使用跨线程／跨进程事务永久保留已消费 ID；归档业务收件箱时也应保留去重身份。
`MemoryReplayStore` 仅适用于同一进程的临时接收，默认上限 100,000 条，容量满后拒绝新事件，
可显式指定 `max_entries`。它不会为腾出空间提前删除 ID，进程重启后的保护需要持久存储。
`WebhookError.replayed` 只会在完成鉴权且发现重复时为真，调试监听器对它返回成功确认，避免重复打印。

这份示例是订阅调试器。生产业务应把接收记录与待处理工作持久化为同一事务，再异步执行业务动作；
单独占用重放 ID 不等于业务动作恰好执行一次，进程崩溃后的恢复也应由业务收件箱负责。
