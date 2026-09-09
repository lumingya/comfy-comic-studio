# 画册预览、展示模板与导出

Mio 的画册阅读与单册 HTML 导出共用一个工作台。打开画册后，右上角「版式」打开模板侧栏；模板数量再多，也不会在顶栏平铺。

## 默认：先看见完整画面

「留白 · 完整画面」按原始比例适配可用空间，不裁切、不拉伸。默认每次只显示一幕，翻页时只处理当前图片；缺失画面仍显示缺失状态。

侧栏提供模板搜索、选择、自定义、导入和导出。设置可调整框线、主题色、台词、提示词和导出签名。默认模板的阅读方式还可临时切换双页或连续卷轴；这只是浏览方式，不会重写模板 HTML。

选择的展示模板按画册保存。没有明确选择模板的画册使用完整画面模板。批量导出仍有合集配置入口，并使用同一套编译器。

## 预览与导出的区别

- 默认完整画面使用原生轻量阅读器，不创建模板 iframe，不在每次翻页时编译 HTML。
- 自定义模板使用隔离 iframe，按当前页起最多 **3 幕**预览。翻页可查看后续内容；**导出包含整册**，不受三幕限制。
- HTML/CSS、媒体占位符、外观设置和已授权脚本使用同一套模板编译器。
- 当前实际图片或缺失标记用于预览；不会用示范图冒充尚未生成的页面。
- 开始编辑模板、切回默认模板或关闭阅读器时，移除正在运行的自定义预览文档。

## HTML 内容与画面占位符

模板是完整 HTML 文档，可自由组织布局、文字、装饰与背景。分镜图片只是其中的占位符，不强制某种固定卡片结构：

```html
{{#books}}
<article data-cc-book>
  <h1>{{title}}</h1>
  <div data-cc-pages>
    {{#frames}}
    <figure data-cc-frame>
      <img src="{{image}}" alt="{{name}}" loading="lazy" decoding="async">
      <figcaption data-cc-caption>{{caption}}</figcaption>
    </figure>
    {{/frames}}
  </div>
</article>
{{/books}}
```

保留一组 books 循环和嵌套的 frames 循环，以及示例中的 data-cc 属性。变量值会转义；用户提示词或台词不能作为 HTML 注入。`{{prompt}}`、`{{number}}`、`{{signature}}`、`{{themeColor}}` 等变量可按需使用。

## 本地图片、GIF 和视频背景

进入「自定义 → HTML / CSS 源码 → 模板媒体与交互」：

1. 添加 PNG、JPEG、WebP、GIF、MP4 或 WebM。
2. 点击「设为背景」，会插入固定铺满背景及对应 CSS；默认不透明度 0.35，可自行修改。
3. 也可在任意 HTML/CSS 位置手工使用资源占位符，例如 `{{asset:media_xxx}}`。实际 ID 以媒体列表显示的值为准。
4. 删除媒体前，先移除其在源码中的引用，避免保存一个缺失资源的模板。

视频示例（`background` 需替换为媒体库里真实存在的 ID）：

```html
<video autoplay muted loop playsinline preload="metadata">
  <source src="{{asset:background}}" type="video/webm">
</video>
```

媒体存储在模板的 `assets` 对象中，资源项具有 `name` 和 Base64 `data`。JSON 模板包和带元数据的 HTML 模板包均可携带媒体，导出的画册也完全内嵌媒体。

**当前容量边界：**每模板最多 24 项媒体；Base64 后总量最多 6 MiB；界面单文件上传最多 4.4 MiB，模板包导入最多 9 MiB。整个工程仍受后端配置体积限制，因此不能在大量模板中无限堆积视频。请使用压缩后的短循环视频；独立的大型媒体仓库和远程视频流不在当前实现范围内。

视频强制静音、移动端内联播放；离开可见区域或文档隐藏时暂停。系统开启减少动态效果时，不自动播放，并提供视频控件。GIF 动画由浏览器解码，不提供逐帧暂停控制。

## 可选自定义 JavaScript

HTML 中不能直接嵌入 script 标签或 onclick 等事件属性。请使用编辑器中的独立 JavaScript 字段：

- `runtimeScript`：脚本文本，上限 64 KB。
- `scriptEnabled`：显式启用开关。
- 保存后，在画册侧栏选择该模板，确认本次运行授权。脚本代码改变后需要重新授权。
- 未获授权时只编译静态内容，不运行脚本；模板编辑器不会因导入文件而自动授权脚本。

```javascript
MioTemplate.onReady(() => {
  for (const frame of MioTemplate.getFrames()) {
    frame.addEventListener('click', () => {
      frame.classList.toggle('is-expanded');
    });
  }
});
```

`MioTemplate.version` 当前为 1，`getFrames()` 返回当前文档内的分镜元素，`onReady()` 在模板 DOM 就绪后执行回调。它不提供父页面、工程状态、供应商密钥、文件系统或执行队列接口。复杂交互可直接使用模板自己的 DOM 与浏览器 API。

## 安全边界与性能约定

预览 iframe 仅使用 `sandbox="allow-scripts"`，不授予同源、弹窗、表单或顶层导航权限。CSP 禁止 fetch/XHR 和外部资源加载，只允许内嵌图片、媒体和经编译器授权的脚本。不接受外部视频 URL、CDN 脚本或远程 CSS。

脚本沙盒是权限隔离，不是 CPU/内存配额。恶意或过重脚本仍可能消耗浏览器资源；只运行可信模板。不要把它当作对任意代码“绝不卡顿”或“完全不可联网”的承诺：浏览器导航行为和下载后自行修改的 HTML 不等同于受控资源请求。

建议模板作者：使用 `object-fit: contain` 作为通用默认；动画按需开启；不用逐帧全页面重排；不要循环复制大图片；视频使用 metadata 预载；尊重减少动态效果设置。默认模板本身没有视频或用户脚本。

## 验证

`npm run test:presentation` 使用独立临时工程测试完整图片、模板搜索、真实 WebM 媒体、脚本授权与父页面隔离、单册统一导出、模板包往返和手机布局。

512 幕合成负载中，默认路径翻页只挂载一张图片，HTML 模板编译次数为 0。测试记录的同步渲染耗时不包含所有设备上的图片解码和 GPU 绘制，不应解读为用户设备帧率保证。
