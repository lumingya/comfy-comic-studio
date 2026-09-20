# 样式工坊与主题包

设置 → **样式工坊** 是 Mio 外观的总控台。它由五个页签组成：

| 页签 | 做什么 |
|---|---|
| **主题包** | 安装、叠加、排序、调节主题；链接本地文件夹开发主题；把自己的样式导出成主题包 |
| **快速样式** | 直接写 CSS，边写边看；元素拾取器帮你找选择器；模板一键插入 |
| **设计令牌** | 从运行中的样式表里发现所有 CSS 变量（官方 + 主题），按"通用 / 仅浅色 / 仅深色"覆盖 |
| **资源** | 上传字体、图片、SVG、视频…… 用 `/style-assets/文件名` 引用；一键生成 @font-face |
| **帮助** | 常用选择器速查、层叠顺序、恢复方法 |

CSS **不做任何过滤**：`@import`、远程字体、`!important`、动画、`::before`、`:has()`…… 浏览器认识的都可以用。唯一的限制是大小（主题单文件 16 MiB、快速样式单段 1 MiB、资源单个 64 MiB）。

## 层叠顺序

```
官方 styles.css
  → 主题包（按叠加顺序，上层覆盖下层）
    → 主题的设置项（颜色、圆角……编译成 CSS 变量）
      → 扩展注入的样式（ctx.styles）
        → 你的设计令牌覆盖
          → 你的快速样式
```

`<head>` 里对应五个 `<style data-mio-layer="themes | theme-settings | extensions | user-tokens | user-snippets">`，扩展样式插在 `extensions` 与 `user-tokens` 之间。越靠后越优先，所以你写的快速样式永远能赢；赢不了的极端情况再加 `!important`。

## 快速样式：怎么用

1. 点"新建"，给这段样式起名。
2. 点**拾取元素**，鼠标划过界面会高亮元素并显示选择器；点一下即插入 `选择器 { }`，同时复制到剪贴板。按住 Shift 可以照常点按钮、切页面；Esc 退出。
3. 在编辑器里写 CSS。每次停顿 150ms 界面就会更新（尚未保存，状态行会提醒）。
4. `⌘/Ctrl + S` 或点"保存"。停用某段样式只需取消勾选，顺序用 ▲▼ 调整（越下面优先级越高）。
5. "插入模板"里有隐藏状态栏、窄侧栏、换强调色、整站字体、背景图片、毛玻璃顶栏、减少动效、细滚动条等现成片段。

## 设计令牌

官方样式把颜色、字体、间距都定义成 `--变量`（`:root` 为深色基线，`[data-theme=light]` 为浅色）。令牌页把它们全部列出来：带色块的可以直接取色，其他的填任意合法值，例如 `--sans: "LXGW WenKai", sans-serif` 或 `--bg: color-mix(in srgb, #111 90%, blue)`。

- **通用**：写进 `:root,:root[data-theme]`，两种模式都生效。
- **仅浅色 / 仅深色**：写进 `:root[data-theme=light|dark]`。
- 留空 = 不覆盖；"×"恢复单项，"全部恢复"清空。修改自动保存。

## 资源

上传后出现在列表里，地址形如 `/style-assets/MyFont.woff2`。字体文件旁的"用作字体"会生成一段包含 `@font-face` 与 `--sans` 覆盖的草稿；图片旁的"用作背景"同理。导出主题包时资源会一起打包并把地址改写成包内相对路径。

## 主题包格式（`mio.theme.json`，apiVersion 3）

```json
{
  "id": "paper-atelier",
  "name": "纸间 · 手作工坊",
  "version": "3.0.0",
  "apiVersion": 3,
  "description": "……",
  "css": ["theme.css", "components.css"],
  "variants": { "dark": "dark.css", "light": "light.css", "sepia": "sepia.css" },
  "variantLabels": { "sepia": "泛黄旧稿" },
  "tokens": {
    "shared": { "--radius": "3px" },
    "dark":   { "--bg": "#1a1611" },
    "light":  { "--bg": "#f4eee2" },
    "sepia":  { "--bg": "#efe1c4" }
  },
  "icons": "icons.json",
  "script": "theme.js",
  "settings": [
    { "key": "accent",  "label": "强调色", "type": "color", "var": "--accent", "default": "" },
    { "key": "radius",  "label": "圆角",   "type": "range", "var": "--paper-radius", "min": 0, "max": 16, "unit": "px", "default": 3 },
    { "key": "font",    "label": "标题字体", "type": "font",  "var": "--art-serif" },
    { "key": "stamp",   "label": "角落印章", "type": "toggle", "default": true }
  ],
  "colorScheme": "auto"
}
```

| 字段 | 说明 |
|---|---|
| `css` | 字符串或数组，共享规则。包内相对的 `url()` / `@import` 会被改写为 `/theme-assets/<id>/<revision>/…`，所以字体、图片、视频直接放包里即可 |
| `variants` | `dark` / `light` 跟随宿主的明暗切换（编译到 `[data-theme=…]` 下）；**其他任意名字**成为可选"外观"，用户在主题设置里选择，编译到 `[data-theme-variant~=名字]` 下 |
| `tokens` | 各模式的 CSS 变量；`shared` 两种模式都用 |
| `icons` | JSON：图标名 → SVG 内部标记（`<path d="…"/>` 等）。覆盖官方图标；图标里禁止脚本/外链 |
| `script` | ES module，`export default function (ctx)`，启用时运行、停用时清理。`ctx` 含：`settings`（当前值）、`onSettings(fn)`、`core`（与扩展相同的核心直达）、`styles.add()`、`mount()`、`anchors.register()`、`events`、`patch`、`keys`、`icons.mount()`、`mode()`、`assetURL()`、`log()`。返回函数即清理函数 |
| `settings` | 出现在主题卡片"调整这个主题"里。带 `var` 的项实时写成 CSS 变量（`unit` 会自动追加）；`selector` 可改写作用选择器；`toggle`/无 `var` 的项交给 `script` 处理。类型同扩展设置，另有 `color` `range` `font` `image` |
| `colorScheme` | `auto`（默认）或强制 `dark` / `light` |

一个单独的 `.css` 文件也是合法主题（拖进来即可）；标注 apiVersion 1/2 的主题包同样可以加载。

### 叠加

勾选多个主题即叠加，上层覆盖下层；▲▼ 调整顺序，"只用这个"退回单主题，"关闭全部主题"回到官方外观。每个主题的设置与外观选择独立保存。

### 开发主题

"链接本地文件夹"后，保存文件即热重载（含清单变化：新增设置项、外观、图标都会立刻出现）。`/theme-assets/<id>/<revision>/` 里的 revision 随文件变动更新，不用担心缓存。

### 分享

"把我的样式导出为主题包"会把当前的快速样式、令牌覆盖与资源打成 `xxx.mio-theme.zip`（含 `mio.theme.json` + `theme.css` + `assets/`），别人拖进主题包页即可安装。

## 出问题了

- `?safe_mode=1`：跳过所有主题、用户样式、主题脚本与扩展，并提供一键重置。
- 帮助页里有"停用全部快速样式""清空全部令牌覆盖"。
- 主题编译错误会显示在样式工坊的"加载诊断"里，其他主题不受影响。

## 常用选择器

| 选择器 | 位置 |
|---|---|
| `.sidebar` / `.nav-item` / `.brand` | 左侧栏及导航按钮 |
| `.topbar` / `.breadcrumb` | 顶栏 |
| `.statusbar` | 底部状态栏 |
| `.main` / `#main .view` | 主内容区 |
| `.btn` / `.btn.primary` / `.ibtn` | 按钮 |
| `.panel` / `.settings-section` / `.eco-package` | 卡片 |
| `.workshop-frames` / `.workshop-page` | 分镜工坊的幕列表与编辑区 |
| `#reader` / `.room-stage` / `.room-page` | 阅读室 |
| `dialog` / `.toast` | 弹窗与提示 |
| `[data-theme=light] …` / `[data-theme=dark] …` | 只在某种模式下 |
| `[data-theme-variant~=sepia] …` | 某个主题外观被选中时 |
| `[data-mio-anchor=topbar]` | 扩展锚点容器 |
