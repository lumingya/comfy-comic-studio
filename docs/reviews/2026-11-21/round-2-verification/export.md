# 第二轮独立复审：完整构图导出

## 结论

**R1-EXP-01 通过，可关闭。** 本复审者未参与原审、规划或实现；审查对象为 `HEAD=125e07f1600464b93736392c04f7d0ae8412c63d` 上的当前 working tree，而非仅检查 HEAD。已读 AGENTS、README、ROADMAP、共享台账、原 SPEC-02、导出规划及作者收口报告。

实际反证中发现的普通气泡半像素取整、极薄尾段缩放为零高度，以及最终补核中发现的伪造源带比例例外，均已交作者修复，并由本复审者使用原输入窄复验通过。作者另行发现并修复了 1 行尾段的旧目录导入比例限制；全量门禁随后捕获的普通导入回归也已收紧并独立补核，详见下文最终复验。当前没有遗留的已确认导出缺陷。

范围内只写本报告；没有修改生产代码、测试或其他报告，没有提交、推送或委派。实验均为 TEMP 中性色块和临时 AppContext，没有访问个人运行数据、模型、真实云端或付费 API。

## 独立反证及修复闭合

### 半像素气泡遇到奇数分带起点

- 位置：`pipeline/regions.py:183–200`、`pipeline/lettering.py:250–310`。
- 原输入：`400 × 3500`，文字 `Neutral phase`，框 `(20.5,1490.5,380.5,1680.5)`，字号 24，尾点 `(280.5,1801.5)`；对比完整画布与 `y=1551` 两段拼接。
- 修前实际：横排 speech 有 1883 个差异像素，thought 1802 个，caption 1241 个；竖排相应为 1759、1678、1241 个。原因是框和尾点先减去奇数原点，再用 Python 的偶数舍入，不能保持全局取整结果。SFX 的此组接缝为零差异。
- 修后证据：同一脚本、同一原输入，speech / thought / caption / SFX × 横 / 竖八组均为 **0 个差异像素**。又给 SFX 保留无效尾点并对照原完整 `strip.render`，八组仍为零；sprite 原点与保守尾线边界已分开保存。
- 当前修法在全局坐标取整框和尾点后平移，并保持原浮点宽度用于折行；FreeType 字形小数相位与 SFX 的全局 sprite 取整也保留。新增回归还覆盖了真实 512 行 PNG、实际奇数 album 分带，以及 HTML/PDF 拼回，不仅断言辅助函数。

### 1 行尾段缩窄预览后变成零高度

- 位置：`album/media.py:167–172`。
- 原输入：保存 `800 × 3201` 画布，实际完整分带 `[0,1600)`、`[1600,3200)`、`[3200,3201)`；`profile='preview'`，`max_width=320` 或 400。
- 修前实际：前两段正常，最后 `800 × 1` 调整为宽 320/400 时，高度舍入为 0，抛出 `ValueError: height and width must be > 0`；clean 与默认 1400 宽预览正常。这是合法请求导致整个导出失败，并非字节相等的误用。
- 修后同输入：320 宽输出 `320×640 / 320×640 / 320×1`；400 宽输出 `400×800 / 400×800 / 400×1`。尾段 `sourceRegion` 始终为 `[0,3200,800,3201]`。
- 又走真实 HTML API：clean 和 preview320 均返回 200；解析产物 v1 图片、落入真实旧目录、导入并再导出，均保留 `rasterized=true`、总高 3201 和最后 1 行。clean 的完整重建与原画布逐像素相同。
- 作者自查的导入比例缺陷也独立确认已闭合：普通 `importer.ratio_of` 保持原拒绝语义；只有完整分区、图像声明与实际尺寸相同、且匹配源区域缩放关系的 `rasterized_band` 才可使用有效逻辑默认比例。实际 Take 尺寸、完整 `sourceRegion` 和布局盒不变，末行没有被合并或丢弃。此处最终收紧经过下文补核。

## 完整构图与跨格式像素证据

独立 TEMP 探针使用 `400 × 3500` 保存画布：逻辑先格在较下方，两个格重叠并越过左右画布边缘；全局 caption 在留白中；speech / thought 带半像素框和跨区尾线；SFX 旋转 31°。最上方保留标题区，底部保留尾标和留白。补充对白 `SUPPLEMENT ONLY ONCE` 用于核对归属次数。

基准直接调用原完整 `pipeline.strip.render`，不是只让两个采用同一分带策略的输出互相比。其结果先与完整 `RenderSnapshot.render_region` 对照，再做以下实际编码与解析：

| 路径 | 本复审实际操作 | 结果 |
| --- | --- | --- |
| HTML clean / archive | 真实 `/api/export/album`，解析 `mio-album-data`、解引用 `$mioImage`，按源区域拼回 | 全宽、连续覆盖 `[0,3500)`，逐像素等于完整基准；每格补充对白只出现一次 |
| PDF clean / archive | 真实 portable API，读取每个 image XObject，确认 Flate 并解压 RGB 后拼接 | 与完整基准逐像素相同；未重新 JPEG 化 |
| ZIP clean / archive | 真实 portable API，读取 manifest 和各图拼接 | `composition=400×3500`，与基准逐像素相同 |
| 连续 PNG | 调用实际文件 writer 并重新打开 PNG | 与同一基准逐像素相同 |
| 同宽无损切片 | 实际 PNG 切片 ZIP，读取 manifest 及每张切片拼回 | 与同一基准逐像素相同 |
| v1 往返 | 实际 HTML 图片→旧画册目录→`LegacyImporter`→完整 strip→再导出 | 栅格构图无缝、尺寸不变、标题及尾部不重复 |
| 栅格导入后新增文字 | 在导入 strip 添加 `NEW OVERLAY`；以原基准副本直接绘制该层作预期 | 完整画布与再次导出的 clean 分带都等于预期；新增文字确实绘出 |

代码审查确认：`export_composition.band_regions`（18 行起）生成按 y 增长的全宽非重叠区间；logical panel order 只用于既有绘制顺序，不再决定裁切覆盖。首尾、格间和纯空白带保留；保护范围包括字形溢出、尾点与旋转 SFX，无法避开时以 1600 行硬限分带。`iter_episode_pages` 在有保存几何/文字时采用该 composition；没有保存构图或明确 `lettered=false` 时读取完整采用原图，不再附加比例裁切。相关测试确实检查了原图字节与真实尺寸。

## 有界内存、取消与相关回归

独立执行：

```text
PYTHONPATH=server python -m unittest tests.test_review_export_integrity -q
Ran 12 tests in 18.661s — OK
```

这是两项薄尾段测试加入之前的十二项。其后只补跑新增的 `test_one_pixel_tail_band_survives_directory_round_trip` 与 `test_preview_narrow_one_pixel_tail_keeps_nonzero_height_and_source_region`：**2 项 / 2.685 秒，OK**。此外上面的八组取整、canonical 跨格式和真实薄尾段往返均为独立 TEMP 脚本，不以作者测试通过代替这些反证。

上述十二项实际覆盖了纯文字画布、原图 fallback、100000 行 HTML、sourceRegion 完整分区、重叠倒序、跨边、SFX、无损 profile 和取消。100000 行用例检查 Frame 只持文件 token、单源/带图像分配不超过 `400×1600` 带上界、spool 确实落盘；正常完成及 base64 编码阶段取消后临时文件均不存在，取消产物也被删除。静态核对 `album.render.write_album` 为 48 KiB 原始块 base64 写入，PDF Flate 为逐 64 行压缩到临时文件，未积累所有图片 bytes / base64。

未重复作者整批 123 项及全仓门禁；这些属于作者/主控证据，不计作本复审亲自运行结果。

## 真实三模板浏览器检查

使用已安装 **Chrome 157.0.8103.50** 与 Python Playwright，以真实 `export-monograph.html`、`export-nocturne.html`、`export-folio.html` 为输入。每套分别在 1440×1000、390×900 及浅/深色偏好运行，共 **12 组，全部通过**；没有安装浏览器或访问在线服务。

每组都检查三段真实图片可解码、目录条目数、目录进入时焦点、选中末段与 Escape 关闭的焦点恢复、显式单页可见 1 段/双页可见 2 段、灯箱 Enter 打开、Shift+Tab/Tab 焦点约束、方向键换图、放大、Escape 关闭后恢复原触发器及移除背景 inert。默认、双页和弹窗关闭后均无 document 横向溢出；每组 pageerror 与 console error 均为零。

保存过 12 组默认阅读截图及三模板手机深色灯箱截图；通过实际 `view_image` 查看桌面/手机联络图与三张灯箱原图，不以 DOM 断言冒充视觉检查。画布内容完整 contain，显式放大时允许在灯箱 viewport 内滚动。全部截图、联络图和初始检查图均按确切路径删除，并确认本复审 TEMP 目录已无 PNG；没有把截图写入仓库。作者提供的三份 HTML 属于共享输入，未擅自删除。

## 全量门禁后的最终薄带导入复验

主控全量 1559 项捕获了旧导入四项事务断言回归：早期薄带修复曾把普通 `ratio_of(1,100)` 一并降为默认比例，使普通 album/project 的坏比例不再报错。最终复验对象为 `HEAD=66d98b663e672918e3b2cee14ee189ed92f15522` 上的 importer working tree；未重跑整批 123 项、全仓门禁或 Chrome 十二组。

当前代码把例外限制在 album 分支。`_composition_regions` 先验证全部 sourceRegion 为连续、全宽、无重叠且完整的分区；随后逐张读取图像，核对 step 声明尺寸与实际资产尺寸，不保留整套编码图片。普通 project 调用的 `convert_frame` 不授予 `rasterized_band`。普通 album 缺少有效依据时同样继续使用原比例验证。

独立追加探针在已有合法画册上执行覆盖导入，逐项比较 `series`、`episodes`、`documents`、`assets`、`episode_snapshots` 五张表：

| 反例 | 最终结果 |
| --- | --- |
| 普通画册含一张可入库新图，随后遇到 `width=1,height=100` | 抛 ValidationError；五表与旧作品完全不变，新资产元数据未发布 |
| 薄带缺 sourceRegion | 拒绝；五表不变 |
| composition 总高比完整源带多 1 行 | 拒绝；五表不变 |
| 两段 sourceRegion 重叠 | 拒绝；五表不变 |
| sourceRegion 完整但图片缺失 | 拒绝；五表不变 |
| step 声明尺寸不等于真实图片 | 拒绝；五表不变 |
| 真实图 `1×100`、step 也声明 `1×100`，却伪造 `composition=400×1` / `sourceRegion=[0,0,400,1]` | 最终拒绝；五表不变 |

最后一项是本次独立补核发现的新缺陷：第一次收紧仅核对声明尺寸与实际图片，仍允许该伪造输入取得 `rasterized=true` 并覆盖旧作。已通知作者修复，再用同一探针原样重跑。当前还要求编码图高满足 `actual_h == max(1, round(source_region_h × actual_w / composition_w))`，使纵向长图不能冒充横向薄带；最终七个反例均抛 ValidationError 且五表完全不变。该规则保留合法预览的 1 行高度下限，没有重新放宽全局比例验证。

正例为独立真实 API 矩阵：源宽 400 / 800、总高 3201，分别执行 clean1400、preview320、preview400，共六组。每组均从实际 HTML 解引用 v1 图片并写入真实旧目录，随后导入、读取 strip 和 Take、再导出；全部返回 200 并保留 `rasterized=true`、总高 3201 与源尾区间 `[0,3200,源宽,3201]`。clean 尾图分别为 `400×1`、`800×1`，preview 尾图为 `320×1` / `400×1`；clean 全图重建与原画布仍为零像素差异。

在最后的缩放关系校验落地后，独立集中运行以下九项，**9 项 / 6.529 秒，OK**：

- `test_other_engine_review.LegacyOverwriteReviewTests` 两项：普通 project / album 的 `1×100` 覆盖拒绝与旧内容保护。
- `test_other_final_recheck.OtherFinalImporterTests.test_run_late_failure_rolls_back_album_recipe_and_asset_batch`。
- `test_other_fresh_recheck.OtherFreshImporterTests.test_failed_album_overwrite_does_not_publish_asset_metadata`。
- `test_review_export_integrity` 的五项：1 行尾带往返、preview320/400 真实 HTML→目录导入、严格完整分区例外、伪造源带覆盖拒绝、正常 v1 无缝往返。

此前七项窄测通过并未阻止继续验证伪造路径；最终结论依据上述原输入反证、修复后重跑与最终九项，不以作者的 32 项结果代替独立证据。自有 TEMP 探针与临时素材均已清理，本次只更新本报告。

## 结论的适用边界

- 像素相等针对同宽 clean/archive。preview/publish 的采样/编码是显式有损行为，只要求源覆盖与真实尺寸正确；本复审没有宣称其字节相等。
- HTML auto 仍可在既有 512 MiB 内联预算后降为 publish，并通过统计报告；没有把此路径称为无损档。
- 有界结论针对内建 layout 与原生文件 writer；仍允许一个源图/缩放格和一个文字层的内存开销，未把旧式整 HTML exporter 或第三方整图 layout 扩大为有界保证。
- v1 目录往返保留构图、源坐标和栅格像素；没有恢复原文字编辑层，也没有宣称能逆转有损压缩。
- 这是聚焦 R1-EXP-01 及其修复边界的独立复审，不是全仓零缺陷证明；真实渠道、物理断电、付费服务和发布 CI 均不在此报告的亲自验证范围。
