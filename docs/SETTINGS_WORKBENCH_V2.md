# 第二轮：角色与画面设定工作台

基准：GitHub `main` 的 `9ee1a0b`。本轮使用重新克隆的完整仓库，不依赖第一轮演示。

## 交互

- 分组是用户数据，不再通过角色 / 画风等变量名推断。官方示范包含两组，可随意改名、删除。
- 分组默认折叠，展开状态只保存在当前页面会话；刷新重新折叠。切换组不会清空输入。
- “新建分组”常驻顶部。“编辑分组”开启原地改名与删除，完成编辑后保存；名称不能为空或重复。
- 删除分组需确认；属性移至“未分组”，文字值、图片、变量标识与生成语义不变。
- 新增属性可指定分组；属性右上角铅笔可编辑名称与归属，变量标识保持不变。
- 顶部操作栏统一提供新增属性、新建分组、编辑分组、导入、导出、存为公共预设。公共库还在同一位置提供“更新预设”。
- 导入复用原资源导入流程：先检查 ZIP/JSON，再确认导入为公共库的新副本，不自动替换本册。
- 标题本身是原生画册选择器，支持键盘、触屏、草稿与实际生成版本。设定页移除重复的右上角选择器；其他页保留自己的上下文入口。
- 右栏使用中文与系统衬线字体。独立副本机制采用可点击、可键盘展开的帮助面板，不依赖 hover。
- 深色 / 浅色跟随工作室主题。手机上预设入口移至表单上方，工具栏换行，属性单列。

## 数据模型

```json
{
  "settingsGroups": [
    { "id": "group-lighting", "title": "镜头与光影" }
  ],
  "variables": [
    {
      "id": "var-light",
      "key": "light",
      "type": "text",
      "value": "soft backlighting",
      "groupId": "group-lighting"
    }
  ]
}
```

预设使用 `entries` 替代 `variables`；分组结构相同。

- 分组最多 128 个，名称 1–60 字；后端验证定义、重复名称与标识。
- `groupId` 仅影响编辑器呈现，不参与提示词解析。
- 本册、版本快照、预设草稿分别持有自己的分组。更新、另存、应用、ZIP 导出 / 导入、画册附带源设定都会携带分组结构。
- 应用预设是**替换本册全局设定的独立复制**，不改公共源、不改其他画册、不改本册单幕覆盖。
- 改名编辑态与展开态在 `settingsGroupUI`，不写入业务文档。

## 工程结构

```text
server.py                  # 5 行启动入口；python server.py
backend/
  __main__.py              # python -m backend
  server.py                # HTTP 路由、服务启动
  mio_library*.py          # 文件资源、配置与工作区存储
  mio_*                    # 生成任务、画册生命周期与资源分享等模块
  settings_schema.py       # 分组数据校验
  providers/               # 内置模型供应商适配器
js/
  settings-workbench.js    # 分组模型、操作、折叠渲染与工具栏
  ui-settings.js           # 设定页面、属性控件与预设侧栏
  creative-context.js      # 画册上下文、预设库
packaging/mio.spec          # 单一 PyInstaller 配置，使用项目相对路径
scripts remain in tools/   # 构建、校验、性能与离线工具
```

根目录保留启动器、包管理配置、主页 / 样式及 README。安全文档、英文 README 和历史重构说明移至 `docs/`；示例模板移至 `examples/`。删除旧数据备份目录、过时交互演示、重复且含开发者绝对路径的打包配置。

后端使用明确的 `backend.*` 包导入；没有通过向 `sys.path` 注入后端目录来伪装旧模块。更新了 Python 测试导入、JS 测试临时工作区复制列表、打包必需文件清单、文档链接与生成入口。

发布 ZIP 不包含历史 acceptance 截图集、Git 历史、依赖缓存、测试工作区、私有密钥或运行时数据库；源码与官方 59 文件种子清单完整保留。历史截图仍可在 Git 源码中查阅。

## 顺带修复

- 官方 `workspace.json` 中混入了不再存在的测试预设草稿，其引用缺失图片导致保存返回 422。清除随包草稿并重算分发校验值，保留正式预设与画册。
- 删除属性确认期间，自动保存可能重建草稿对象。删除目标现在通过所有者、项目和稳定属性 ID 重新校验，不因对象实例变化误判，也不会误删同名新建属性。
- 移除未使用的 Tailwind 浏览器 CDN 脚本；页面使用已有本地 CSS，不需要这个网络依赖。

## 运行与测试

```bash
python server.py
# 或
python -m backend

npm ci
npx playwright install chromium
npm run build
npm run lint
npm run test:workbench
python -m unittest discover -s tests -v
python tools/check_distribution.py
python tools/package_project.py --output releases
node tests/packaged_runtime.mjs releases/mio-2.3.0-source.zip
```

`test:workbench` 默认启动独立临时数据目录和 8883 端口，退出清理，不修改开发工作区数据。可通过 `MIO_TEST_URL` 显式指定服务（会修改该服务的测试数据）。测试截图在 `docs/acceptance-round2/`。

本轮验证范围：

| 验证 | 结果 |
|---|---|
| JavaScript 构建与 JS / HTML lint | 通过 |
| Python 单元测试 | 330 项执行，4 项既有条件跳过，其余通过 |
| 前端数据契约 | 56 项通过 |
| 真实浏览器冒烟 | 102 项通过 |
| 预设隔离、失败重试、延迟上传 | 40 项通过 |
| 预设删除回归 | 23 项通过 |
| 实际画册版本、重启、在途输入隔离 | 19 项通过（本地受控生成服务） |
| 本轮分组与导入导出 UI | 24 项通过 |
| ZIP 解包后的独立运行 | 15 项通过 |
| 官方随包资源 | 59 个文件校验通过 |

没有宣称执行全部 `npm test` 子套件，也没有调用付费云模型。PyInstaller 配置已迁移，但没有在此 Linux 环境构建 Windows EXE；已验证的交付物是完整 Python 源码运行包。
