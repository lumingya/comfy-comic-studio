# Mio 开放 API v2 与客户端

`/api/v2` 是给机器人、脚本和其他程序用的开放接口。它和网页界面用的 `/api` 是**同一套领域接口**：同样的路由、模型和错误格式 `{detail, kind}`，由领域模型自动生成，所以界面上能做的事都能通过 API 做。两者的区别：

- `/api/v2` 的每个请求都要带令牌：`Authorization: Bearer mio_…`；
- 令牌管理和扩展管理不对外开放；
- 它有自己的 OpenAPI 文档 `/api/v2/openapi.json`（仓库里的快照是 [`openapi-v2.json`](openapi-v2.json)），客户端就是从这份文档生成的。

本机网页用的 `/api` 不需要令牌，只应该在本机或可信的局域网里访问。

## 令牌与权限

在「设置 → API 与 Webhook」里生成令牌。明文令牌只显示一次，服务端只保存它的 sha256。

| 权限 | 能做什么 |
| --- | --- |
| `read` | 所有 GET 请求，以及订阅任务事件的 WebSocket |
| `write` | 编辑作品、剧本、画布，采用或淘汰出图结果，导出 |
| `render` | 会消耗算力或额度的操作：一句话生成剧本、出图、定稿、修图、质检、剧本助手、重跑任务 |
| `admin` | 设置、ComfyUI 实例、Webhook、旧版导入、更新 |

权限之间**不互相包含**，例如出图的机器人通常需要 `read + write + render`。令牌可以设置过期时间，也可以随时吊销。

浏览器里的 WebSocket 不能设置请求头，这时可以把令牌放在查询参数里：`?access_token=mio_…`。

## Python 客户端

[`python/mio_client.py`](python/mio_client.py) 是一个单文件客户端，只依赖 `httpx`。每个接口操作对应一个方法，方法名就是 OpenAPI 的 operationId：

```python
from mio_client import MioClient, MioError

mio = MioClient("http://127.0.0.1:8788", token="mio_…")
print(mio.whoami())
series = mio.list_series()
job = mio.render_episode(episode_id, body={"candidates": 1})  # 不传 panel_ids = 全部分格
mio.wait_job(job["id"])  # 轮询到完成 / 失败 / 取消
```

出错时抛出 `MioError`，带 `status`、`kind` 和 `detail`。

改了服务端接口之后要重新生成客户端：

```bash
python clients/python/generate.py          # 重写 openapi-v2.json 和两份 mio_client.py
python clients/python/generate.py --check  # CI 用：不一致时失败
```

生成器从服务端应用直接读 OpenAPI，不需要先启动服务。

## AstrBot 插件

[`astrbot_mio/`](astrbot_mio/) 是 AstrBot 插件，把整个目录复制到 AstrBot 的 `data/plugins/` 下面即可。插件自带一份客户端副本，不需要再装别的包。

| 指令 | 作用 |
| --- | --- |
| `/mio 帮助` | 显示用法 |
| `/mio 画 <一句话>` | 写剧本、出图、自动采用、嵌字，然后把整条漫画发回来 |
| `/mio 任务` | 查看进行中的任务 |
| `/mio 作品` | 列出作品 |

插件配置项：`base_url`、`token`、`allowed_ids`（允许出图的用户，留空表示所有人）、`series_title`、`candidates`、`strip_width`、`timeout`、`render_timeout`。令牌需要 `read + write + render` 权限。

## Webhook

在「设置 → API 与 Webhook」里添加 Webhook 后，事件发生时服务端会向指定 URL 发送 JSON POST 请求。可订阅的事件有：

| 事件 | 触发时机 |
| --- | --- |
| `job.completed` / `job.failed` / `job.canceled` | 任务结束 |
| `take.created` | 出图结果入库 |
| `take.status` | 采用或淘汰某张图 |
| `episode.exported` | 导出完成（包括画册） |

`*` 表示订阅全部事件。请求体格式是 `{"id", "event", "at", "data"}`，请求头包括：

```
X-Mio-Event: job.completed
X-Mio-Delivery: dlv_…
X-Mio-Timestamp: 1790000000
X-Mio-Signature: sha256=<hex>
```

签名是 `HMAC-SHA256(secret, timestamp + "." + body)`。接收方要校验签名，还要拒绝时间戳太旧的请求：

```python
import hashlib, hmac, time


def verify(secret: str, headers, body: bytes, tolerance: int = 300) -> bool:
    stamp = headers["X-Mio-Timestamp"]
    if abs(time.time() - int(stamp)) > tolerance:
        return False
    mac = hmac.new(secret.encode(), stamp.encode() + b"." + body, hashlib.sha256)
    return hmac.compare_digest("sha256=" + mac.hexdigest(), headers["X-Mio-Signature"])
```

投递失败（网络错误或 5xx）时会重试两次，间隔分别是 2 秒和 10 秒。设置页的「测试」按钮会立刻发一个 `ping` 事件，「投递记录」里能看到最近的结果。

签名密钥只在创建 Webhook 时显示一次。以后要换密钥，可以 `PATCH /api/webhooks/{id}`，请求体带 `{"rotate_secret": true}`。
