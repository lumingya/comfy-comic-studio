# 导出任务

普通导出地址仍可直接下载。长篇或外部程序推荐创建导出任务，随后查询、取消、重试和下载。下面的路径在本机以 `/api` 为前缀，在开放接口以 `/api/v2` 为前缀；后者使用令牌。

| 操作 | 接口 |
| --- | --- |
| 导出条漫切片、长图、PDF、HTML | `POST /export/jobs/strip` |
| 导出带模板的画册 | `POST /export/jobs/album` |
| 导出每格一页的 PDF 或图片 ZIP | `POST /export/jobs/portable` |
| 查询状态 | `GET /jobs/{id}` |
| 实时进度 | `/ws/jobs?job_id={id}`，`progress` 事件的 `value/max` |
| 取消 | `POST /jobs/{id}/cancel` |
| 失败后重新导出 | `POST /jobs/{id}/retry`，请求体 `{}` |
| 下载完成文件 | `GET /export/jobs/{id}/file` |
| 删除任务和导出文件 | `DELETE /export/jobs/{id}`，普通任务删除入口也清理文件 |

提交体沿用相应同步导出选项，增加可选 `idempotency_key`。条漫请求用 `episode_id`、`fmt`、`preset`、`variant_id`、`quality`；画册和图片包用 `episode_ids`。任务冻结文档、版式贡献、导出器和选项，后续编辑不会改动这次导出的内容。同一幂等键用于找回丢失响应的原任务；要导出新编辑的内容，使用新键。

```python
from pathlib import Path

job = mio.submit_portable_export({
    "episode_ids": [episode_id],
    "format": "pdf",
    "image_profile": "publish",
    "idempotency_key": "review-2026-11-16-v1",
})
done = mio.wait_job(job["id"])
if done["state"] == "completed":
    Path("review.pdf").write_bytes(mio.download_export(job["id"]))
```

下载不会重新渲染。浏览器使用原生下载，不把整个文件转换成 JavaScript Blob。Python 客户端普通下载方法仍读取完整响应；大文件可使用令牌和标准 HTTP 流式下载保存。

## 文件导出扩展

原 `exporter` 契约不变。条漫导出器可用 `file_writer` 元数据显式加入文件写入接口：

```python
def write(plan, fmt, preset_id, path, *, title, subtitle, quality, checkpoint, progress):
    checkpoint()
    with plan.render_panel(next(iter(plan.strip.panel_boxes))) as image:
        image.save(path, "PNG")
    progress(1, 1)
    return "image/png", "first-panel.png"

def activate(mio):
    mio.contribute("exporter", "first-panel", legacy_export,
                   title="首格", interface="strip", file_writer=write)
```

`plan` 提供冻结的 `series`、`episode`、`strip`，以及 `render_region((x0,y0,x1,y1))` 和 `render_panel(panel_id)`。调用者应关闭返回的 Pillow 图片。`checkpoint()` 在取消时抛出异常；不要吞掉它。写入器只写指定 `path`，返回 MIME 和下载文件名。任务保存文件引用、大小和 SHA256，图片数据不写入任务数据库。

扩展来源与内容摘要在提交时冻结。缺少对应实现时任务等待，恢复原版本后继续；运行中的依赖不能被停用。旧式导出器仍收到完整 PIL 图片，旧式布局仍可返回全部缩放图片，这两类扩展保留原内存特性。

内置长 PNG、切片、PDF、条漫 HTML 和图片包逐区域或逐页处理。像素内存仍受单张源图、单格、单个字层与当前区域大小影响；文档元数据和文件索引随篇幅增长。长 JPEG 最多 32 百万像素，超限使用 PNG 或切片。带模板的画册保留完整字符串契约，虽然像素逐格生成，编码图片和 HTML 字符串仍随作品大小增长。
