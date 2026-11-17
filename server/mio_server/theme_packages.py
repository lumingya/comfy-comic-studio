"""Portable, inert theme extensions; no host source files or executable entry point."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

from .themes import Theme, resolved


def package_theme(theme: Theme) -> tuple[str, bytes]:
    """Return an independently installable package with a stable, collision-resistant ID."""
    document = {
        "name": theme.name,
        "mode": theme.mode,
        "author": theme.author,
        "tokens": resolved(theme),
    }
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    package_id = "theme-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    manifest = {
        "id": package_id,
        "name": theme.name,
        "version": "1.0.0",
        "author": theme.author,
        "contributes": {"themes": ["theme.json"]},
    }
    readme = (
        f"# {theme.name}\n\n"
        "在 Mio 的「扩展 → 已安装」导入此文件夹或 ZIP，然后启用；"
        "在「外观与阅读」选择主题。停用或卸载扩展即可移除。\n\n"
        "Import this folder or ZIP in Extensions → Installed, enable it, then select the theme "
        "in Appearance. Disabling or uninstalling the extension removes its theme.\n\n"
        "配色与控件令牌都保存在 theme.json，可编辑后重新导入。此主题不包含代码、"
        "密钥或个人数据，也不需要其他扩展。\n"
    )
    files = {
        "mio-extension.json": json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        "theme.json": json.dumps({"id": package_id, **document}, ensure_ascii=False, indent=2)
        + "\n",
        "README.md": readme,
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(f"{package_id}/{name}", content.encode("utf-8"))
    return package_id, output.getvalue()
