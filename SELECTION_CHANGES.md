# 画册与分幕：桌面多选优化

## 操作方式

- **普通单击**：打开画册 / 切换分幕。已有多选时也一样，单击会清空选择并打开目标。
- **拖动框选**：从卡片、分幕行或列表空白处开始拖动；松手后保留选中高亮，不误触打开。
- **Ctrl / ⌘ + 单击**：加选或取消单项。
- **Shift + 单击**：从上次点击的目标连续选择。
- **Ctrl / ⌘ + 框选**：对原有选择进行增减；Shift + 框选追加选择。
- **Ctrl / ⌘ + A**：选择当前列表中的项目。
- **右键选中项或列表空白**：显示批量菜单；右键未选中项显示该项的菜单，不把单项编辑与批量删除混用。
- **Esc**：菜单打开时先关闭菜单，再按一次清空选择；点击列表空白也可清空。

## 界面变化

移除了画册、分幕中的手动“进入多选 / 批量管理”按钮、复选框和选中后的批量工具栏。选择仅使用原有主题的浅色背景和边框，不新增占位元素、不改变卡片排列。批量操作统一放在右键菜单中。

画册拖动统一为框选（从封面上开始拖也一样），不再与拖动排序争用同一手势。调整顺序时，把鼠标移到画册上，按住左上角的 ⠿ 把手拖动；也可以用右键菜单中的“整理 → 向前移动 / 向后移动”。移动端保留轻点打开和原生滚动，不把触摸拖动当框选。

## 修改范围

主要涉及 `js/desktop-selection.js`、`js/organize.js`、`js/ui-gallery.js`、`js/assembly-workshop.js`、`js/ui.js`、`js/app.js`、`styles.css`；重新生成 `index.html` 资源版本号，避免旧缓存。

此次优化针对画册和分幕。工作流 / 映射编辑器保留既有打开方式，未改动图像渠道配置与生成后端。

## 已执行的验证

- `npm run lint`：JavaScript 和 HTML 检查通过。
- `npm run test:contracts`：86 / 86 通过。
- `npm run test:selection`：28 项浏览器交互断言通过，包括菜单区分、取消框选恢复、无复选框 / 工具栏、移动端单击及无横向溢出。
- `npm run test:desktop-refresh`：原有桌面交互回归通过（更新为画册与分幕单击打开）。

没有执行完整 `npm test`，也没有连接真实 ComfyUI / NovelAI 生成服务。

## 本地运行与复测

照项目原有说明运行 `start.bat`（Windows）或 `start.sh`（macOS / Linux），也可运行 `python server.py`，默认地址为 `http://127.0.0.1:8777`。

开发验证：

```sh
npm ci
npx playwright install --with-deps chromium
npm run lint
npm run test:contracts
# 先启动 Python 服务，再在另一终端运行：
npm run test:selection
# desktop-refresh 的原默认端口为 8000，请指定当前服务地址：
MIO_TEST_URL=http://127.0.0.1:8777 npm run test:desktop-refresh
```

浏览器测试会构造测试用画册和预设，建议在独立测试数据目录中运行服务（通过 `MIO_DATA_DIR` 指向原 data 目录的副本），不要对重要生产数据直接执行测试。`MIO_ARTIFACT_DIR` 可指定截图输出目录。
