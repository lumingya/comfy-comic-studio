# 动态漫工作台 · Motion Studio

为已有漫画安排镜头运动与阅读时长，导出可独立打开的动态漫播放器。启用后从具体话的「扩展」菜单进入，不增加主导航，也不调用生图、VLM 或付费服务。

## 安装与使用

在本目录打包，使用明确文件清单排除缓存：

```bash
python -m zipfile -c motion-studio.zip mio-extension.json panel.html panel.css bridge.js panel.js README.md
```

在「扩展市场 / 已安装」中导入 ZIP 或本文件夹，审阅文件及摘要后启用；在具体话「挑图 / 分镜」旁的「扩展」菜单打开「动态漫」。

1. 点击「读取本话镜头」。列表显示已有采用图、自动镜头与按台词估算的时长；进入面板不会自动读取或修改作品。
2. 选择镜头。采用图通过宿主媒体桥显示；「预览本镜」及进度滑块可以查看推近、拉远、左右／上下摇移、静止或轻震效果。预览原图完整放入画幅，再按运动变换；不是最终排版的像素校样。
3. 选择运动、填写 0.5–30 秒，或留空按台词自动。「按分镜与台词自动」将草稿设为 `move:auto`、`hold:null`，随后仍需点击「保存当前镜头」。草稿未保存时不能导出。
4. 选择竖屏或横屏、是否使用已有排版与嵌字、字幕与本机语音，点击「导出离线预览 HTML」。宿主准备下载后，在面板外提供真正的下载按钮；点击保存后独立打开文件即可播放。没有采用图的镜头不会导出。

本工作台编辑默认版本，变体的图片和采用状态保持原状。镜头设置属于同一份 `Panel.motion`，其他导出接口也会读取它。字幕使用现有台词，自动时长来自核心 `motion-plan`；没有复制另一套时长模型。导出时语音只使用浏览器与系统已有语音，离线可用性取决于设备，不承诺每台设备都有中文语音。

保存携带读取到的 `episode.revision`。如果发生冲突或传输中断，面板保留草稿并停止继续写入，需先重新读取核对；不会自动重试。重新读取会明确询问是否放弃尚未保存的草稿。生成任务、候选采用状态和图片素材均不被镜头编辑修改。

## 声明式契约

包内没有 Python 入口、依赖或 `ctx.internal` 调用。所有业务请求都由 `mio-extension.json` 的 `panel.requests` 白名单声明：

| 请求                                               | 权限  | 用途                                    |
| -------------------------------------------------- | ----- | --------------------------------------- |
| `GET /episodes/{episode_id}`                       | read  | 分镜、修订号和采用图 ID                 |
| `GET /episodes/{episode_id}/motion-plan`           | read  | 核心解析的镜头、台词与自动时长          |
| `PATCH /episodes/{episode_id}/panels/{panel_id}`   | write | 显式保存 `changes.motion` 与 revision   |
| `GET /episodes/{episode_id}/takes/{take_id}/image` | read  | `response:image`，宿主提供受控 blob URL |
| `POST /export/motion`                              | write | `response:download`，生成离线 HTML      |

面板运行在 `sandbox="allow-scripts"`、`connect-src 'none'` 下，通过版本 1 的受限消息桥工作，不使用 `fetch`、令牌、任意 URL 或直连 API。切换图片、关闭面板时释放媒体句柄；宿主同时管理会话额度与清理。开放 API v2 可调用同一套操作，桥入口需要 `read`，写入及导出还需 `write`。

停用立即撤下新面板与后续桥请求；已保存的镜头属于作品，继续保留。卸载删除此包，默认保留扩展私有数据；本包不写任何扩展私有文件。重新安装同 ID 包后可继续编辑作品中原有的镜头设置。

## 离线检查

在仓库根目录运行：

```bash
python tools/check_extension_package.py examples/extensions/motion-studio
node --check examples/extensions/motion-studio/bridge.js
node --check examples/extensions/motion-studio/panel.js
```

静态 CTK 不等于浏览器验收。媒体桥、安装启停、修订冲突、相机保存与导出内容应在独立测试中验证；本包不需要真实模型或云端凭据。
