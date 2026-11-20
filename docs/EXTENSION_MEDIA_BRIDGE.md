# 沙箱面板的图片与下载桥

普通扩展面板继续使用 `sandbox="allow-scripts"`，没有同源权限、任意网络请求或浏览器下载权限。
图片和文件走审阅过的清单操作，宿主负责请求、大小校验和生命周期；二进制不进入 JSON 或 base64 消息。
本协议沿用面板消息版本 `1`，新增字段均为可选能力；旧 JSON 请求保持原语义。

## 声明

在 `mio-extension.json` 的 `contributes.panels[].requests` 中声明：

```json
[
  {
    "id": "take-image",
    "method": "GET",
    "path": "/episodes/{episode_id}/takes/{take_id}/image",
    "scope": "read",
    "response": "image"
  },
  {
    "id": "export-motion",
    "method": "POST",
    "path": "/export/motion",
    "scope": "write",
    "response": "download"
  }
]
```

`response` 可为 `json`、`image`、`download`，默认 `json`。路径为正式 API 的逻辑路径，不加 `/api` 或 `/api/v2`。
图片只允许 `GET` + `read`；下载允许 `GET` 或 `POST`，scope 必须与原操作一致。
请求声明不能降低权限：开放 API 调用者的 Bearer 令牌仍须同时拥有面板入口和原操作的权限。
跨扩展路由、任意 URL、调用者提供的 HTTP header、重定向和桥递归均拒绝。

## 最小图片调用

下例直接放在面板自己的脚本中；界面按钮只在收到初始化消息后启用。

```js
const session = new URLSearchParams(location.hash.slice(1)).get('mio-session');
const pending = new Map();
const media = new Map();
let context = null;

function releaseImage(id) {
  const item = media.get(id);
  if (!item) return;
  URL.revokeObjectURL(item.url);
  item.port.close();
  for (const image of document.querySelectorAll('img'))
    if (image.src === item.url) image.removeAttribute('src');
  media.delete(id);
  parent.postMessage({
    type: 'mio:panel:release', version: 1, session, media_id: id,
  }, '*');
}

function request(request_id, payload = {}) {
  return new Promise((resolve, reject) => {
    const rid = crypto.randomUUID();
    pending.set(rid, { resolve, reject });
    parent.postMessage({
      type: 'mio:panel:request', version: 1, session,
      rid, request_id, ...payload,
    }, '*');
  });
}

addEventListener('message', (event) => {
  const message = event.data;
  if (event.source !== parent || !message ||
      message.version !== 1 || message.session !== session) return;
  if (message.type === 'mio:panel:init') context = message.context;
  if (message.type === 'mio:panel:media') {
    const port = event.ports[0];
    const waiting = pending.get(message.rid);
    if (!port || !waiting) {
      port?.close();
      parent.postMessage({
        type: 'mio:panel:release', version: 1, session, media_id: message.media_id,
      }, '*');
      return;
    }
    port.onmessage = ({ data }) => {
      if (data?.type === 'revoke') {
        releaseImage(message.media_id);
        return;
      }
      if (data?.type !== 'image' || !(data.blob instanceof Blob) ||
          media.has(message.media_id)) return;
      const url = URL.createObjectURL(data.blob);
      media.set(message.media_id, { url, port });
      pending.delete(message.rid);
      waiting.resolve({
        media_id: message.media_id, url, mime: message.mime, bytes: message.bytes,
      });
    };
    port.start();
    return;
  }
  if (message.type !== 'mio:panel:response') return;
  const waiting = pending.get(message.rid);
  if (!waiting) return;
  pending.delete(message.rid);
  if (message.ok) waiting.resolve(message.data);
  else waiting.reject(new Error(message.data?.detail || `HTTP ${message.status}`));
});
parent.postMessage({ type: 'mio:panel:ready', version: 1, session }, '*');

let shown = null;
async function showTake(takeId, imageElement) {
  const next = await request('take-image', {
    path_params: { episode_id: context.episode_id, take_id: takeId },
  });
  imageElement.src = next.url;
  if (shown) releaseImage(shown.media_id);
  shown = next;
}
```

图片成功只发送 `mio:panel:media`，不再额外发送普通成功 `response`；错误仍走普通 `response`。
媒体消息的 JSON 仅有 `{type, version, session, rid, media_id, mime, bytes}`，通过 `event.ports[0]`
转移一个原生 `MessagePort`。该端口以 structured clone 交付 `{type:'image', blob:Blob}`，二进制不进 JSON。
上面的客户端在自己的 opaque origin 中创建 URL，最终向调用方返回 `{media_id, url, mime, bytes}`。
不能使用宿主创建的 Blob URL 字符串：真实 Chrome 会拒绝 opaque iframe 读取该 URL。

`url` 只用于本面板的 `<img src>`，不能持久化或分享。移除或替换图片时调用 `releaseImage()`；
宿主在释放和会话终止时发送 `{type:'revoke'}` 并关闭端口，面板应撤销 URL 和清除引用。
同会话最多保留 8 张、合计 64 MiB；超额要求先释放，不会暗中回收仍在显示的图片。
面板卸载、切换激活、导航或上下文切换会撤销未完成请求、关闭所有端口；停用同时移除整个 iframe。
已经交付的像素可被面板复制，端口撤销不是已公开数据的追溯删除或 DRM 保证。

单图最多 32 MiB、16,777,216 像素，只接受经过真实格式校验的静态 PNG/JPEG/WebP/GIF。
SVG、伪装成图片的 HTML、动画和解压炸弹拒绝。图片保持原始内容，不在桥中缩放或重编码。

## 下载

```js
const ready = await request('export-motion', {
  body: { episode_id: context.episode_id, aspect: 'portrait' },
});
// ready: {download_ready:true, filename, mime, bytes}
// 提示用户点击面板外宿主显示的“下载”按钮保存文件。
```

宿主只保留当前会话的一份待下载文件；新的显式请求替换旧文件。下载动作由宿主自己的按钮触发，
面板无法静默连续保存文件。取消、会话失效和卸载会立即移除待下载按钮及文件引用。
下载上限 128 MiB，允许 PDF、ZIP、HTML、JSON、纯文本、二进制、上述图片与 MP4/WebM。
HTML 始终作为附件保存，不在宿主文档中插入、预览或执行。下载的离线 HTML 由用户独立打开后运行其自身内容。

服务端按实际分块字节数限制响应，并验证声明的长度；缺少或伪造 `Content-Length` 无法绕过上限。
临时文件只在宿主临时目录存在，失败、取消及流结束会关闭并清除。不转发上游 Cookie 或任意响应 header。
文件名清理控制字符、路径、Windows 保留字符和设备名，并按已允许的 MIME 加安全后缀。
请求失败不自动重试生成操作；先读取任务状态或复用该操作的幂等键，再由用户决定重试。

实现入口：[`panel_bridge.py`](../server/mio_server/extensions/panel_bridge.py)、
[`panel_media.py`](../server/mio_server/extensions/panel_media.py)、
[`extensionBridge.ts`](../web/src/components/extensionBridge.ts)、
[`extensionMedia.ts`](../web/src/components/extensionMedia.ts)。
