# 独立主题包

独立主题是纯数据包，不属于扩展，也不进入扩展的代码信任、启用或停用生命周期。随包主题放在仓库根目录 `themes/<id>/`；导入的主题放在 `<数据目录>/themes/<id>/`。

一个主题目录包含：

```text
theme-linen/
├── mio-theme.json
├── theme.json
└── README.md
```

`mio-theme.json` 声明 `id`、`name`、`version`、`author`、`description` 和 `theme_file`。主题文件目前固定为 `theme.json`，其 ID 必须与清单一致。文件只定义经过校验的颜色、尺寸、圆角、间距和阴影令牌，不接受任意 CSS、脚本或远程资源。

可在「设置 → 外观与阅读」导入 JSON、ZIP 或文件夹，也可从主题卡导出独立 ZIP。导入的主题会立即出现在主题列表中，可在那里选择或删除。随包主题不可删除。

扩展仍可在 `mio-extension.json` 的 `contributes.themes` 中附带主题；此类主题只在对应扩展启用时注册，随扩展停用而移除。需要单独分发和管理的主题应放在 `themes/<id>`。

## API

本机界面使用 `/api`；开放 API 使用 `/api/v2`，需要相应作用域：

- `GET /themes`：列出内置、独立包、用户导入和扩展贡献的主题。
- `POST /themes`：导入单个主题 JSON。
- `POST /themes/package`：导入独立主题 ZIP。
- `POST /themes/folder`：以 multipart 字段 `files` 导入主题文件夹。
- `GET /themes/{theme_id}/package`：导出独立主题 ZIP。
- `DELETE /themes/{theme_id}`：删除用户 JSON 或独立导入的主题包；内置主题和扩展贡献不可删除。

主题 ZIP 与文件夹导入只接受清单、主题 JSON 和可选说明文件。路径、重复项、压缩后大小、清单身份和主题令牌都会校验；安装写入独立主题目录，不会执行包内代码。

Python 客户端可直接上传文件夹中的文件：

```python
from pathlib import Path

folder = Path("themes/my-theme")
mio.import_theme_folder(
    files=[("files", (f"{folder.name}/{path.name}", path.read_bytes())) for path in folder.iterdir()]
)
```
