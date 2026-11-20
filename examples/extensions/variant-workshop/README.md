# 批量变体工坊

可选的独立沙箱面板：把当前作品设定集中的**画风与角色外观预设**组合成原生 `VariantSet`，
批量生成同一剧本的不同版本，比较两张候选原图，明确采用，再分别导出典藏画集 HTML 或 PDF。
主界面没有新增固定入口，没有 Python 入口、额外依赖、私有后端或第二套版本数据。

## 安装与使用

在「扩展市场」导入本目录，或在此目录按明确文件清单打包后导入 ZIP：

```bash
python -m zipfile -c variant-workshop.zip mio-extension.json panel.html panel.css model.js bridge.js panel.js README.md model.test.cjs
```

审阅摘要后启用，在具体话「挑图 / 分镜」旁的「扩展」菜单打开「变体工坊」。面板初始化不会请求数据或开始生成。

1. 点击「读取作品」。先在作品设定集中准备角色和画风；角色可以作为外观来源，但不会覆盖目标角色的 ID、名字和年龄。
2. 勾选画风及外观来源，选择要替换外观的目标角色，点击「保存派生版本」。两组选择按笛卡尔积派生，每次最多 24 个；不选的一组沿用原设定。此时只保存版本，尚未生成。
3. 勾选已保存版本和每幕候选数，点击「生成勾选版本」。这会调用已配置的图像服务，可能计费。采用开关固定为关闭；点击刷新查看任务进度。
4. 选择分幕、版本，点击「读取候选」，最多勾选两张对比原图。选「全部版本」可跨版本对比。点击「采用此图」只更换该分幕该版本的采用图，原版与其他版本不变。
5. 选择版本和 HTML/PDF，点击「准备下载」，再点宿主提供的原生下载按钮保存。成品使用该版本已采用的图与保存的排版；未采用图不会自动成为成品。

这里的预设来自 `Series.bible` 的结构化角色/画风；分镜工坊的任意文本变量预设没有隐式转换为角色。
生成失败不自动重试；相同勾选和候选数的再次提交复用幂等键，修改选择后才开始新一轮。
派生使用上次明确读取的设定集快照，每次只提交新增版本，由服务端在锁内原子追加；其他窗口保存的版本不会被旧清单覆盖。
保存失败后再次点击会保留本次版本 ID；同 ID、同内容重试不会重复创建，同 ID 内容冲突返回 409，整批不写入。
重新读取作品或修改选择会建立新的派生意图。该追加接口不修改旧版本；编辑或删除旧版本仍需显式的作品编辑操作。

## 稳定契约与权限

面板只通过清单 `panels[].requests` 和版本 1 消息桥访问现有 API：

| 操作               | 接口                                                                                                         | 权限   |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | ------ |
| 读取作品、话、任务 | `GET /series/{series_id}`、`/episodes/{episode_id}`、`/jobs/{job_id}`                                        | read   |
| 追加原生版本       | `POST /series/{series_id}/variants`，传 `{variants:[VariantSet,…]}`，每批 1–24 个                            | write  |
| 批量生成           | `POST /episodes/{episode_id}/render`，明确 `variant_ids`、`adopt_first:false`、`adopt_replace:false`、幂等键 | render |
| 明确采用           | `POST /episodes/{episode_id}/takes/{take_id}/adopt`                                                          | write  |
| 对比原图           | `GET /episodes/{episode_id}/takes/{take_id}/image`，`response:image`                                         | read   |
| 成品下载           | `POST /export/album`、`POST /export/portable`，`variant_id`                                                  | write  |

远程程序使用同一路径的 `/api/v2` 前缀和对应权限令牌；面板桥本身还需要 `read`。
HTML 图片只接收宿主校验后的临时媒体 URL，移除时释放；下载由宿主用户手势完成。
没有 `fetch`、任意 URL、令牌或 `ctx.internal`。停用或代码改变立即撤销旧面板会话；卸载不删除作品中已保存的版本、候选与导出文件。

## 离线验收

```bash
python tools/check_extension_package.py examples/extensions/variant-workshop
node --test examples/extensions/variant-workshop/model.test.cjs
python -m unittest discover -s server/tests -t server -p test_professional_variants_motion.py -q
```

测试使用临时工作区与模拟 ComfyUI，不调用付费模型。覆盖 ZIP 安装、摘要启用、声明桥、版本冻结生成、明确采用、原图对比、离线导出、停用与卸载。
