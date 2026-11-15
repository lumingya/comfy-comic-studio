# 可选 QA 评审扩展示例

本例为已存在的候选图注册一个显式提交入口。安装、启用、读取页面都不会自动发起 QA；只有
调用 `POST /api/ext/qa-review/queue` 才会创建 `qa.check` 任务。任务使用配置中的 VLM，可能消耗
模型额度。结果写回候选的 QA 记录，`auto_adopt` 固定为 `false`，不会自动采用或淘汰候选。

进入本示例目录后打包（只需标准库 Python，明确列出文件以排除运行缓存）：

```bash
python -m zipfile -c qa-review.zip mio-extension.json main.py cli.py panel.html README.md
```

在「设置 → 扩展」安装 zip，审阅 Python 代码并确认摘要后启用，然后重启 Mio 以挂载路由。
扩展在 `activate` 中只注册路由，没有自动运行的钩子。启用后，具体话的扩展标签提供
「候选评审」面板：先点击「读取候选」，勾选图片，再点击「评审所选候选」。进入面板不会
自动读取或提交任务；重复提交同一选择复用幂等键。失败时先检查队列，不会自动重试。

服务运行后，在仓库根目录使用标准库 CLI 显式提交：

```bash
python examples/extensions/qa-review/cli.py queue --episode episode_x --takes take_a take_b --key qa-review-001
```

使用其他本机端口时，把 `--url http://127.0.0.1:8790` 放在 `queue` 前面。CLI 只接受回环地址，
不跟随重定向，也不使用代理。输出是任务 JSON；可通过本机 `GET /api/jobs/{id}` 查看状态。
请求体为：

```json
{
  "episode_id": "episode_x",
  "take_ids": ["take_a", "take_b"],
  "idempotency_key": "qa-review-001"
}
```

三个字段都必须显式提供，`take_ids` 不能为空。同一幂等键和同一任务快照返回原任务，防止重复
提交；如果源分镜、参考图或参数已改变，使用旧键会返回 409，需先核对原任务后决定是否用新键。
幂等键与其他任务共享命名空间，建议使用 `qa-review-` 前缀。

停用后该扩展的新请求立即返回 404；已提交的任务仍由任务引擎管理，需要停止时明确调用任务
cancel。重新启用或重新确认变更的代码后，需要重启服务才能挂载新路由，旧路由不会复活。

示例使用 `mio.internal.qa.submit`，`mio.internal` 是**不稳定 API**，升级后应重新审查和测试。
远程程序使用正式开放 API `POST /api/v2/episodes/{episode_id}/qa`，带 `render` 权限令牌，
并在请求体中明确传 `take_ids`、`idempotency_key` 和 `auto_adopt:false`。本扩展也提供
`POST /api/v2/ext/qa-review/queue`，同样要求 `render`，使用上面的三个字段并固定不自动采用。

扩展 HTML 面板仍受 `sandbox="allow-scripts"` 与 `connect-src 'none'` 限制。清单只声明读取当前话
与提交本扩展 QA 两个请求，分别要求 `read`、`render`。面板通过 Mio 的受限操作桥调用，不能传任意
URL、令牌或请求头；后端重新检查清单、启用摘要、真实路由权限及请求类型。外部程序可调用
`POST /api/v2/extension-panels/qa-review/review/requests`，桥入口需要 `read`，提交 QA 还必须拥有
`render`。读取面板目录取得 `activation` 和 `digest`；停用、重新启用或代码改变会拒绝旧面板请求。
