# 批量变体矩阵

独立的可选沙箱面板，用角色外观与画风预设组合原生 `VariantSet`，选择部分分幕和版本生成候选，跨版本查看并分别采用，再按版本导出。启用前需在扩展管理中检查并信任当前内容摘要；停用后，作品中已保存的版本、候选与导出不会删除。

## 使用

将此目录作为扩展导入，在扩展管理中确认来源与文件摘要后启用。在分镜工坊具体话的「扩展」菜单打开面板。

1. 点击「读取作品」。面板只在用户点击后读取当前话和作品；本体不会自动请求或生成。
2. 选择角色外观、画风预设与替换目标，确认预览后保存派生版本。两类预设按矩阵组合，最多一次追加 24 个版本。不选择某类预设表示沿用原设置。
3. 勾选要生成的版本、分幕和每幕候选数。提交前可看到具体版本数 × 分幕数、分幕任务数与候选图片总数。最多 16 张候选/幕，生成不会自动采用。
4. 按话、版本或画风/外观维度筛选候选，最多读取两张原图并排比较。采用仅影响同一话、分幕和版本。
5. 选择单个版本后导出 HTML 或 PDF；只有已采用的图像进入成品。下载由宿主提供的按钮触发。

重复提交相同渲染意图会复用幂等键；改变勾选、候选数或刷新版本后才会创建新的生成意图。失败、断网或请求超时会显示错误，不会静默重试或自动采纳。

## API 与权限

面板只通过 `mio-extension.json` 声明的请求调用当前真实 API：

| 能力 | API | 权限 |
| --- | --- | --- |
| 读取作品和分镜 | `GET /series/{series_id}`、`GET /episodes/{episode_id}` | read |
| 原子追加版本 | `POST /series/{series_id}/variants` | write |
| 选择版本/分幕并生成候选 | `POST /episodes/{episode_id}/render` | render |
| 读取进度与候选原图 | `GET /jobs/{job_id}`、`GET /episodes/{episode_id}/takes/{take_id}/image` | read |
| 明确采用 | `POST /episodes/{episode_id}/takes/{take_id}/adopt` | write |
| 按变体下载成品 | `POST /export/album`、`POST /export/portable` | write |

没有自建后端、私有数据模型、额外依赖或凭据读取。图片通过宿主的限额媒体通道传输，切换候选/话或关闭面板时释放。主题颜色、明暗和语言跟随宿主实时更新。

## 验证

在仓库根目录运行：

```powershell
python tools/check_extension_package.py extensions/variant-workshop
node --test extensions/variant-workshop/model.test.cjs
node extensions/variant-workshop/panel.test.cjs
```
