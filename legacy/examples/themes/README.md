# 主题示例

| 目录 / 文件 | 说明 |
|---|---|
| `paper-atelier/` | SDK v3 完整示例：共享规则 + 深/浅色令牌 + 自定义外观 `sepia`（泛黄旧稿）+ 五个可调设置项 + 手绘图标包 + `theme.js` 脚本（右下角朱印）。相对路径引用的 `paper.png` 由宿主改写为 `/theme-assets/...`。 |
| `orbital-night.css` | 单文件主题：一个 `.css` 就能拖进样式工坊安装，与其他主题叠加。 |

推荐的开发方式：设置 → 样式工坊 → 主题包 → **链接本地文件夹**，填入 `examples/themes/paper-atelier` 的绝对路径。之后改任何文件（包括 `mio.theme.json`）都会热重载。

格式说明见 [docs/STYLE_STUDIO.md](../../docs/STYLE_STUDIO.md)。
