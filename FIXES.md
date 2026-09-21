# 分幕生成交互与缺陷修复

## 版本与范围

- 上游：https://github.com/lumingya/comfy-comic-studio
- 基于提交：`e2bbcbe8878f5dd4c6e94317a4bb1fcc6d2e9dfe`
- 本次交付为本地修复源码，没有向上游推送或创建 PR。
- 检查重点：装配队列、逐幕生成与重试、图片查看、配置保存及分发校验。不是全项目无缺陷保证。

## 用户提出的两项交互

### 直接查看单幕图片

生成后的分幕缩略图现在是可点击按钮，直接弹窗显示该幕原图，不必打开画册。弹窗标题包含任务名和幕次；支持键盘 Tab / Enter 操作和移动端。右键菜单同步增加「查看图片」。即使批次运行中、重跑失败但仍保留旧图，也可以查看已有图片。查看不会请求生成服务。

### 区分首次生成与重跑

- 没有生成历史、没有结果的幕次：显示「单幕生成」，使用播放图标。
- 已尝试生成或已有结果的幕次：显示「单幕重跑」。
- 后续范围完全没有生成历史：显示「从此幕往后生成」。
- 后续范围包含已尝试或已有结果的幕次：仍提示「从此幕往后重跑」，避免隐瞒已有图片会被替换。
- 同步更新按钮、右键菜单、确认弹窗和英文翻译。
- 仍使用原有生成 API；没有改变成功后替换图片、失败保留原图的语义，也没有取消费用/未确认结果提示。

## 额外修复

### 1. 拒绝启动请求时不应清空暂停批次

`backend/production/queue.py` 原先在校验 indices 和未确认结果之前，就将暂停批次中的任务改为待命并清空批次。非法请求虽然返回错误，原队列却已被修改，且内存与持久化的控制状态可能不一致。

将释放旧批次的步骤移到全部输入与未确认结果校验通过之后。新增测试覆盖空范围、越界、重复索引、布尔索引、顺次/范围冲突及未确认结果；验证被拒绝后内存和 JSON 文件均不变化，并可继续原批次。此测试在原代码上复现失败，修复后通过。

### 2. 重复模板校验函数阻断配置保存

`js/ui-export.js` 重复声明 `validateExportTemplate`，覆盖 `js/ui-templates.js` 的正式校验器，并要求实际模板并不使用的 `MIO_PANELS` 注释锚点。项目自带模板使用 `{{#books}}` / `{{#frames}}`，因此全部被拒绝，工作区保存和图像渠道保存也被连带阻断。

删除重复定义，保留正式校验器及其 HTML、安全、循环、媒体、元数据检查。浏览器回归确认全部随包模板通过，脚本、内联事件和损坏循环仍被拒绝。

### 3. 随包数据校验清单过期

确认工作区文件与 git 基线一致后，使用项目自带 `tools/build_distribution.py` 更新两条过期校验和：

- `data/settings/workspace.json`
- `data/storyboards/远行与归来 · 十二幕--ry_journey12.json`

未改变这两份资源的内容，没有关闭完整性校验。59 份随包资源全部校验通过。

### 测试维护

旧发布默认值测试写死原示例工作流的 4/6/9 号节点，已不适用于当前随包工作流。改为验证实际配置的输出节点和图内引用，不改变业务工作流。

新增 `npm run test:production-scenes`，并将其及分发校验接入 `test:current`。

## 验证记录

通过：

| 检查 | 结果 |
| --- | --- |
| `npm run lint` | JS 和 HTML 校验通过 |
| `npm run test:contracts` | 86/86 |
| `python -u -m unittest discover -s tests -q` | 508 项：504 通过，4 项 Windows 专属测试跳过 |
| `npm run test:production-scenes` | 24 项通过；最后连续运行三次均通过 |
| `npm run test:assembly` | 39 项通过 |
| `npm run test:album-live` | 13 项通过 |
| `npm run test:distribution` | 59 份资源通过 |
| `git diff --check` | 通过 |

测试使用隔离临时工作区和受控图片提供方，没有连接真实 ComfyUI / NovelAI / OpenAI 生成服务，没有进行付费生成。

### 完整回归的限制与未解决项

不能将本交付表述为完整测试套件全部通过：

- `npm run test:current` 在 Python 的全部断言完成后，曾因遗留后台 daemon 线程在解释器退出时写 stdout 而 abort；使用无缓冲 `python -u` 单独运行全部 Python 测试正常退出。这不是对后台线程清理问题的修复。
- 单独继续执行 UI 套件时，`test:architecture` 在 “optional tools master enabled by default” 断言失败；当前随包配置的 extensions 默认值为 false。未擅自改变产品默认开关来满足旧断言。
- `test:presentation` 在 “invalid remote media and oversized scripts are rejected” 断言失败；该断言仍按 64,001 字符应超限测试脚本，与近期放宽的容量边界不一致。其前面的图片阅读、离线导出、媒体/脚本往返等检查通过。本次没有改变容量策略。
- `test:locale` 在不可见的 `#image-provider-select` 上执行 selectOption 超时，未完成整套语言审计。
- 后续其他整套 UI 脚本没有宣称通过。真实生成服务、Windows 启动器及 WebKit 尚未验证。

## 使用

建议解压到新目录，先备份原工作区，不要直接用随包 `data/` 覆盖个人数据。可通过 `MIO_DATA_DIR` 指向需要使用的工作区。

```bash
python -m pip install -r packaging/requirements.txt
python server.py
```

浏览器打开 `http://127.0.0.1:8777`。Windows 也可使用原有 `start.bat`。

复现针对性测试：

```bash
npm ci
npx playwright install --with-deps chromium
npm run test:production-scenes
python -u -m unittest tests.test_production_queue -v
npm run test:assembly
npm run test:album-live
```

补丁应用（需处于上述基线或兼容版本，先检查冲突）：

```bash
git apply --check ../comfy-comic-studio-fixes.patch
git apply ../comfy-comic-studio-fixes.patch
```
