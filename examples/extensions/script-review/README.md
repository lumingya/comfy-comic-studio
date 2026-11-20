# 剧本审阅与 Diff 助手

把修改建议留在审阅台上，再由作者逐条决定。此独立沙箱面板不添加主导航，也不自动修改剧本。

在具体话中打开「剧本审阅」，填写要求并点击「生成审阅建议」。模型返回的结构化提案按目标分幕显示，
每个字段分别展示修改前/修改后，对白按句展开。每项初始均不勾选；作者可逐条接受或拒绝，也可
勾选全部可用建议或全部拒绝。锁定分幕的 `blocked` 建议不能选择。

点击「应用勾选的修改」才写入作品。面板展示 `base_revision`，应用前重读当前版本；已知陈旧提案
直接停用，后端的并发 `409` 同样要求重新审阅。应用超时或其他不确定响应后封存旧提案，先检查作品，
再重新生成建议，避免重复提交。生成建议可能使用付费模型；进入面板不会调用模型。

## 安装与移除

在「扩展 → 已安装」导入本目录，审阅内容摘要并启用。也可在此目录中打包：

```bash
python -m zipfile -c script-review.zip mio-extension.json panel.html panel.js README.md
```

启用后在具体话「挑图 / 分镜」旁的「扩展」菜单选择「剧本审阅」，进入独立工具页。停用会撤销面板及旧会话，重新启用后从菜单重新打开；卸载不会撤销已接受的修改。
尚未应用的建议只在当前面板内存中，关闭即丢弃。

## 稳定契约与开放 API

没有 Python 入口或宿主私有访问。清单只声明以下正式操作，沙箱保持 `connect-src 'none'`：

| 请求                                            | 权限     | 用途                 |
| ----------------------------------------------- | -------- | -------------------- |
| `GET /episodes/{episode_id}`                    | `read`   | 基线与应用前版本核对 |
| `POST /episodes/{episode_id}/assistant/propose` | `render` | 生成可审阅提案       |
| `POST /episodes/{episode_id}/assistant/apply`   | `write`  | 应用明确接受的操作   |

远程调用使用 `/api/v2` 前缀与相应作用域令牌。面板桥还要求 `read` 权限，以及目录返回的当前
`activation`、`digest`。应用请求原样保留 `ops`、`accepted`、`base_revision`；拒绝的操作不会写入。

核心 Diff 的选择单位是一条结构化操作（例如本幕对白的修改），面板把对白逐句展开以便审阅；不把
模型一次返回的内容静默拆写为另一套协议。跨字段依赖仍需作者检查，新增角色和使用它的分幕应一并接受。

## 离线验证

```bash
python tools/check_extension_package.py examples/extensions/script-review
python -m unittest discover -s server/tests -t server -p test_professional_review.py -q
node server/tests/professional_review_panels.cjs
```

集成测试使用隔离工作区与模拟文本模型，不会访问真实收费服务。
