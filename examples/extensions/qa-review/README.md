# 智能质检与辅助挑图

独立、按需启用的沙箱面板。读取本话候选，勾选待评审图片，明确点击后才调用已配置的 VLM。
逐幕显示实际记录的综合评分、角色一致性、人数和镜头检查、模型、票数与问题清单；点击问题即可
定位到对应分幕。未评审或零票跳过的候选明确标记，不把缺失数据当作满分。

提交固定带 `auto_adopt:false`，不会自动采用、淘汰或覆盖候选。进度和报告由「刷新任务进度」读取；
不会自动重试。相同选择重试保留原幂等键；修改选择开始新意图。VLM 可能计费，进入面板与读取报告不调用模型。

## 安装与移除

在「扩展 → 已安装」导入本目录，或进入目录后打包：

```bash
python -m zipfile -c qa-review.zip mio-extension.json panel.html panel.js cli.py README.md
```

安装后审阅摘要并启用；在具体话「挑图 / 分镜」旁的「扩展」菜单打开「候选评审」。停用立即撤销面板和旧激活会话；
重新启用后须重新打开。卸载不会删除作品、候选或已经写入的 QA 记录。已提交的核心任务仍由队列管理。

## 稳定契约与开放 API

此包没有 Python 激活入口，不访问宿主私有对象。只通过 `panels.requests` 声明三项正式操作：

| 请求                             | 权限     | 用途                     |
| -------------------------------- | -------- | ------------------------ |
| `GET /episodes/{episode_id}`     | `read`   | 候选与 QA 记录           |
| `POST /episodes/{episode_id}/qa` | `render` | 显式提交，固定不自动采用 |
| `GET /jobs/{job_id}`             | `read`   | 显式刷新进度             |

远程程序用同路径的 `/api/v2` 前缀与令牌；通过面板桥调用还需 `read` 权限、当前 `activation` 与
`digest`。沙箱保持 `connect-src 'none'`，没有网络、任意 URL、令牌或请求头入口。

标准库 CLI 只允许本机回环来源，不跟随重定向，也不用代理：

```bash
python examples/extensions/qa-review/cli.py queue --episode episode_x --takes take_a take_b --key review-001
```

CLI 调用核心 `/api/episodes/{id}/qa`，同样显式传 `auto_adopt:false`。这不限制正式核心 API 供其他调用者
选择自动采用；本包只负责自己的操作意图。

## 离线验证

```bash
python tools/check_extension_package.py examples/extensions/qa-review
python -m unittest discover -s server/tests -t server -p test_extension_qa.py -q
python -m unittest discover -s server/tests -t server -p test_professional_review.py -q
node server/tests/professional_review_panels.cjs
```

测试使用隔离工作区和模拟 VLM；不代表真实模型效果或付费渠道已验收。
