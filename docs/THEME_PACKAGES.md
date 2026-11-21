# 独立主题包

独立主题是纯可视化数据包，不属于扩展，也不进入扩展业务权限与启停生命周期。随包主题放在仓库根目录 `themes/<id>/`；导入主题放在 `<数据目录>/themes/<id>/`。扩展可以附带主题，但主题机制本身不依赖扩展。

一个主题目录可以只包含主题配置，也可以附带完整样式和媒体：

```text
theme-linen/
├── mio-theme.json
├── theme.json
├── theme.css              # 可选：覆盖现有界面的视觉样式
├── theme.js               # 可选：隔离运行的视觉令牌脚本
├── assets/
│   ├── backgrounds/linen.mp4
│   └── fonts/linen.woff2
└── README.md
```

`mio-theme.json` 声明 `id`、`name`、`version`、`author`、`description` 和 `theme_file`。`theme.json` 的 ID 必须与清单一致；可用 `style_file: "theme.css"` 与 `script_file: "theme.js"` 显式启用可选文件。主题配置可定义颜色、尺寸、圆角、间距、阴影及背景，例如：

```json
{
  "id": "theme-linen",
  "name": "亚麻纸",
  "mode": "light",
  "tokens": { "accent": "#675b48" },
  "style_file": "theme.css",
  "background": {
    "kind": "video",
    "file": "assets/backgrounds/linen.mp4",
    "opacity": 0.3
  }
}
```

`theme.css` 可自由重绘、重排或隐藏 Mio 已有界面，无需修改宿主源代码；主题仍不能新增业务功能或调用 Mio 业务 API。CSS 的 `url()` 只能引用包内 `assets/` 文件，不接受 `@import`、外链或未声明资源。支持嵌套资源目录、图片、视频与字体；资源随文件夹、ZIP 导入导出并进入主题备份。

启用背景媒体时，`bg`、`bg-deep`、`panel`、`panel-2`、`hover` 与侧栏表面会自动以半透明方式混合，令背景可透出；关闭背景后会恢复主题原始令牌。主题 CSS 若自行覆盖表面背景，则以该 CSS 样式为准。

`theme.js` 在不带同源权限的 sandbox iframe/Worker 中运行，桥接接口仅提供 `theme.setColor()` 与 `theme.resetColors()` 两项视觉令牌操作；不能访问 Mio DOM、业务 API 或网络。脚本默认关闭，启用授权绑定脚本 SHA-256，脚本内容变化后需重新启用；系统或用户减少动态效果时暂停脚本与动态图片。视频背景默认遵循系统偏好；用户可在当前视频主题卡选择“系统减少动态效果时仍播放”覆盖系统偏好，但 Mio 自身的减少动态效果选项和省电静帧模式仍优先生效。脚本运行有时限，切换主题会移除旧脚本、样式和媒体。

「设置 → 外观与阅读 → 动态壁纸」可设置失焦暂停（默认开启）与省电静帧。页面隐藏或进入阅读室、条漫画布、全屏试阅时，播放自动暂停，返回后按用户设置恢复。视频保留当前画面，动图显示首帧；宿主在动态壁纸上用微透色替代实时背景模糊。

可在“设置 → 外观与阅读”导入 JSON、ZIP 或文件夹，也可从主题卡导出独立 ZIP。导入后主题立即出现在列表中，可在那里选择、调整背景透明度或删除。随包主题不可删除。若自定义 CSS 意外隐藏界面，按 `Ctrl/Cmd + Shift + 0` 可恢复系统主题。

主题 ZIP 与文件夹导入只接受清单、主题 JSON、可选说明、已声明脚本/样式和被引用的 `assets/` 资源。路径、重复项、压缩后大小、资源签名、CSS 外链、清单身份和主题令牌都会校验；安装写入独立主题目录。CSS 仅在选中主题时装载，脚本仅在用户明确开启后隔离运行。

### 主题私有设置与卡片样式

主题可在 `theme.json` 声明 `settings_schema`，由设置页的「更多设置」面板渲染 `slider`、`switch`、`select` 与 `file_upload` 字段。动态壁纸选择使用 `options_source: "wallpapers"`；文件上传字段将媒体写入本机的 `<数据目录>/theme_data/<id>/wallpapers/`，与主题包物理分离，也不会进入主题 ZIP 导出。`GET` / `PUT /api/themes/{id}/preferences` 独立读写同一所有权目录下的 `preferences.json`。旧 `themes/<id>/user_wallpapers/` 仅作为已知旧来源读取和备份，绝不自动删除；同名媒体以新位置优先。壁纸清单、上传、媒体读取和删除接口分别为 `/api/themes/{id}/wallpapers` 及其 `{wallpaper_id}` 子路径；上传字段名为 `file`。后端校验文件类型、签名和大小。

也可声明 `settings_page: "settings.html"`。页面通过 `/api/themes/{id}/settings-page` 在无同源权限的 sandbox iframe 中提供；注入的 `window.theme` 只暴露异步 `getSettings()` 与 `updateSettings(settings)`，CSP 禁止网络连接与宿主 API。内联脚本使用每次响应生成的 nonce。若同时声明两种设置模式，设置页优先打开自定义页面。

浏览器边界（2026-11-19 实测并由维护者明确接受）：这里的网络限制阻断 fetch、资源加载等指定通道，**不能保证作者 DOM 脚本绝对断网**。Chrome 不支持 `navigate-to`，设置页仍能通过自身导航向目标地址发出请求，且可能将其已知设置放入地址。设置页继续保留，只应导入可信作者的页面；它仍没有宿主同源权限或业务 API 桥。不能以 `connect-src 'none'` 声称消除此限制。真实测试与只读诊断见[平台 CTK](EXTENSION_PLATFORM_CTK.md)。

私有设置与上传壁纸会随完整工作区备份和重启恢复，并参与恢复前的内容版本检查；这与主题 ZIP 的公开分发范围不同。壁纸列表和上传结果包含 `animated` 标记，用户上传的动画图片与包内背景遵循同一减少动态效果策略。

主题 `theme.css` 可额外声明严格以 `.theme-card[data-theme-id="self"]` 为根的选择器，供列表中的该主题卡片单独展示；宿主在完整样式与卡片样式端点按当前真实 ID 绑定逻辑根。旧显式 ID 根在导出时仅于选择器语法位置规范为 `self`，声明值、注释与 URL 不变。其他规则不会通过卡片样式端点暴露；该样式不要求主题被选中，重新导入改变 ID 后仍可使用。

主题包总大小和单个文件上限均为 10 GiB，最多 64 个文件。导入、文件夹安装、ZIP 导出与工作区备份通过临时文件和分块复制处理媒体，不会把视频或完整 ZIP 一次性载入内存；较大文件仍需要足够的临时磁盘空间。工作区备份上限为压缩后 12 GiB、解压后 16 GiB。

扩展仍可在 `mio-extension.json` 的 `contributes.themes` 中附带主题；此类主题只在对应扩展启用时注册，随扩展停用而移除。需要单独分发和管理的主题应放在 `themes/<id>`。

## API

本机界面使用 `/api`；开放 API 使用 `/api/v2`，需要相应作用域：

- `GET /themes`：列出内置、独立包、用户导入和扩展贡献的主题。
- `POST /themes`：导入单个令牌主题 JSON。
- `POST /themes/package`：导入独立主题 ZIP。
- `POST /themes/folder`：以 multipart 字段 `files` 导入主题文件夹。
- `GET /themes/{theme_id}/package`：导出独立主题 ZIP。
- `DELETE /themes/{theme_id}`：删除用户 JSON 或独立导入的主题包；内置主题和扩展贡献不可删除。
- `GET` / `PUT /themes/{theme_id}/preferences`：读取或替换该主题的私有 JSON 偏好。
- `PATCH /themes/{theme_id}/preferences`：`{expected_revision, path, value}` 对一个对象子树进行条件替换；响应为完整对象，GET/PUT/PATCH 均返回强 ETag。revision 是去除 ETag 双引号的 64 位摘要。空 path 为整个对象；最多 16 个对象键，不能穿越数组/标量或使用 prototype 相关键；null 表示写入 null。冲突返回 409，应重新读取后由调用方决定是否重放明确子树意图。PUT 可带一个强 `If-Match`；未提供时仍表示明确的无条件整对象替换。
- `GET /themes/{theme_id}/wallpapers`：列出该主题的本地壁纸。
- `POST /themes/{theme_id}/wallpapers`：上传本地壁纸；multipart 字段为 `file`。
- `GET /themes/{theme_id}/wallpapers/{wallpaper_id}/file`：读取已上传的媒体文件。
- `DELETE /themes/{theme_id}/wallpapers/{wallpaper_id}`：删除用户壁纸。

Python 客户端可递归上传文件夹中的文件：

```python
from pathlib import Path

folder = Path("themes/my-theme")
mio.import_theme_folder(
    files=[
        ("files", (f"{folder.name}/{path.relative_to(folder).as_posix()}", path.read_bytes()))
        for path in folder.rglob("*")
        if path.is_file()
    ]
)
```
