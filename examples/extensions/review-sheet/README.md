# 审稿联系表

把当前画布导出为一份带缩略图、编号和手写备注区的离线 HTML，适合检查镜头衔接、打印批注。
保留已保存的画格取景和比例，不会为排成网格再裁一次图。没有 JavaScript、外链、网络调用或模型请求。

本扩展只注册一个 `exporter`，不增加主界面面板或新路由，不访问 `mio.internal`，无需重启。
安装与启停需要 `admin` 令牌；导出仅需 `read` 令牌。Python 扩展仍是与主程序同权限的受信任代码，
安装前应检查本目录中的 `main.py`。`read` 是调用者的 API 权限，不是 Python 沙箱。

## 安装与使用

把本目录的 `mio-extension.json` 和 `main.py` 打成 ZIP，在设置的扩展页安装并启用；或使用
仓库自带的 [Python 客户端](../../../clients/python/mio_client.py)：

```python
import io
import os
import zipfile
from pathlib import Path
from mio_client import MioClient

# PYTHONPATH 指向 clients/python；令牌来自本机设置，不写进脚本。
admin = MioClient(token=os.environ["MIO_ADMIN_TOKEN"])
folder = Path("examples/extensions/review-sheet")
package = io.BytesIO()
with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in ("mio-extension.json", "main.py"):
        archive.write(folder / name, name)
installed = admin.install_extension(package.getvalue())  # 初始未启用
# digest 应来自你已检查的文件对应的安装结果。
admin.enable_extension("review-sheet", {"digest": installed["digest"]})

reader = MioClient(token=os.environ["MIO_READ_TOKEN"])
assert any(item["id"] == "review-sheet" for item in reader.export_formats())
Path("review-sheet.html").write_bytes(
    reader.export_episode("episode_ID", fmt="review-sheet")
)
# 完成后可停用、卸载；已导出的 HTML 仍可离线打开。
admin.disable_extension("review-sheet")
admin.remove_extension("review-sheet")
```

打开 HTML 后使用浏览器「打印」，可以打印纸稿或保存为 PDF。每张缩略图最长边为 480 px；
适合看整体构图，最终分辨率和跨格气泡应在原画册中检查。编号按当前画布从上到下、从左到右排列，
对应的原画格 ID 保存在每张卡片的 `data-panel-id` 中。

联系表使用核心已有的画布合成结果，因此包含保存的裁切和画格内部文字；未采用画面的分格沿用
核心占位显示，不把占位误判为生成成功。没有分格时导出空态。手工移到画布外的分格会明确标出。
长篇仍受核心长图合成的内存限制；本扩展不绕过该限制，也不替代原作品导出。
