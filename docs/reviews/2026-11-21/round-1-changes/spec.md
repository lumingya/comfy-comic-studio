# 第一轮 Spec 审查

固定范围：`git diff 6aa0f8f...125e07f`；提交列表已按 `git log 6aa0f8f..125e07f --oneline` 核对。复现时 HEAD 为 `125e07f1600464b93736392c04f7d0ae8412c63d`。原需求为用户提供的 `ai_studio_code (1).txt`，交付声明为 `docs/WAVE_0_4_ACCEPTANCE_2026-11-21.md`。仅本报告写入仓库，实验只使用 TEMP、中性色素材、假 fetch 或临时 AppContext；没有访问个人 data、真实模型或付费服务。

## 主结论（少于 400 词）

- **P1 / SPEC-01：画布脏草稿刷新后借用新修订号，绕过 CAS。** 本地旧草稿保留，`useSaveStrip` 却跟随最新 `episode.revision`；随后保存可静默覆盖另一窗口已保存的排版。离线组件探针确认 rev3 草稿以 rev4 提交，仍含旧背景。此项已得到其他审查者交叉支持，主控统一修复。
- **P1 / SPEC-02：跨格式一致性未实现，留白正文会丢失。** 长图保存完整画布；HTML/PDF 仍逐格裁出图片，格间留白与其中无所属格的文字被遗漏。临时 API 复现两个导出均返回 200，却只留下两张纯色格图。此为既有策略未满足 Wave 1 新要求，不能称本次新增回归。
- **P2 / SPEC-03：逐句 Diff 可看、不能逐句接受。** 同一幕的多句对白修改被合成一个 operation；面板仅给整幕 operation 一个勾选框。作者不能接受第一句、拒绝第二句。按原文“逐幕/逐句 diff，支持逐条勾选”判为部分交付；若维护者明确将“逐条”限定为整幕 operation，需记录该需求解释。

未发现有证据支持的实质性范围扩张。未把离线契约测试冒充真实渠道认证，也未据交付报告推定未检查部分正确。以下为有限覆盖与证据，不是全仓零缺陷证明。

## SPEC-01：旧排版草稿使用刷新后的修订号

- **级别：P1；状态：已确认，已通知主控；与并发审查发现合并。** 报告时尚未看到本轮修复闭合。
- **原需求：** Wave 1.1：“围绕真实创作者的高频痛点……打磨流畅度”；“确保保存后的裁切与留白在长图、平台切片、PDF 与离线画册中像素级一致”。交付报告另外明确声称“另一窗口的保存不会被旧草稿覆盖”。
- **位置：** `web/src/pages/canvas/CanvasTab.tsx:45–60,63–69`；`web/src/api/production.ts:86–95`；`web/src/pages/canvas/useStripHistory.ts:59–62`。
- **触发：** 窗口 A 修改排版且未保存；窗口 B 保存不同排版；A 在保存前 refetch 到 B 的新版 episode（如窗口重新聚焦）。
- **预期 / 实际：** A 应保留其草稿对应的旧修订号并收到 409，允许核对冲突。实际 `history.receive()` 在 dirty 时保留旧 strip，但 `useSaveStrip(episode.id, episode.revision)` 接收新修订号；A 把旧 strip 以最新修订号 PUT，后端无法发现冲突。
- **最短离线复现：** 用现有 `CanvasTab.test.tsx` 的 fixture、mockFetch 和 StripStage mock，令 `useEpisodeContext` 返回可变 context；初始 `episode.revision=3, strip.background='#ffffff'`。把画布 width 改为 900；将 context 替换为 revision 4、background `#123456` 的 episode，`rerender()` 后点击保存。TEMP Vitest 探针实际结果：

```text
1 test passed（断言的是缺陷存在）
{"revision":3,"newRevision":4,
 "url":"/api/episodes/ep_1/strip?base_revision=4",
 "savedBackground":"#ffffff","remoteBackground":"#123456"}
```

  该探针仅 mock 路由离开保护、图片和 Konva Stage；保留实际 CanvasTab、useStripHistory、useSaveStrip 与 fetch 请求构造。既有“收到 409 保留草稿”测试没有覆盖“先刷新、后保存”。
- **影响：** 另一窗口已保存的裁切、文字、留白可被悄悄覆盖，恰好绕过本次添加的冲突保护。
- **建议：** 草稿与其基准 revision 一起进入 history；dirty 时接收新 episode 不推进草稿基准。成功保存/明确重载后再推进；补真实 rerender 场景回归，而不是只 mock 409。

## SPEC-02：格间留白与正文在 HTML/PDF 导出中消失

- **级别：P1；状态：已确认，已通知主控。**
- **原需求：** Wave 1.1.3：“支持多选文字/气泡对齐与批量样式同步，确保保存后的裁切与留白在长图、平台切片、PDF 与离线画册中像素级一致。”路线图 §2.1 也要求“保存后的取景与留白必须在阅读、导出中保留”。
- **位置：** 本次画布入口/提取模块 `web/src/pages/canvas/canvasTools.ts:87–101`（新增文字 `panel_id:null`）；既有导出链 `web/src/pages/works/ExportDrawer.tsx:160–173` → `server/mio_server/exporting.py:435–455` → `server/mio_server/album/build.py:167–176`；漏收规则 `server/mio_server/pipeline/episode_strip.py:60–74`。
- **基线归属：** `album/build.py`、`episode_strip.py`、`ExportDrawer.tsx` 在固定 diff 中未变；`exporting.py` 的相关改动只是默认模板。问题是本轮明确要求补齐一致性，但交付仍沿用丢弃完整画布间隙的逐格输出策略，并非声称这轮重构新引入。
- **触发：** 手工排版两格之间留白，在留白中添加跨格旁白/拟声字（画布允许），保存后从现有导出入口选择 HTML 或 PDF。
- **预期 / 实际：** 文字与留白节奏应保留。实际 HTML/PDF 逐个调用 `render_panel()`；`panel_lettering()` 只收本格所属文字或中心落在本格内的无主文字。空隙文字不属于任何输出，空隙本身也没有输出记录。
- **最短复现：** 以下独立脚本从仓库根目录执行，`PYTHONPATH` 指向 `server`。所有运行数据自动在 TEMP 清理；不调用生成服务。

```python
import io
import re
import tempfile

from fastapi.testclient import TestClient
from PIL import Image

from mio_server.api import create_app
from mio_server.album.build import episode_pages
from mio_server.context import AppContext
from mio_server.models import Episode, LetteringLayer, Panel, Series, Strip, Take
from mio_server.pipeline.regions import prepare_snapshot

with tempfile.TemporaryDirectory(prefix="mio-spec-export-") as temp:
    ctx = AppContext.create(temp, autostart=False, seed_instance=False)
    try:
        series = ctx.store.create_series(Series(title="Spec"))
        buf = io.BytesIO()
        Image.new("RGB", (200, 200), "#7799bb").save(buf, "PNG")
        asset = ctx.assets.put(buf.getvalue(), source="review:neutral")
        episode = ctx.store.create_episode(Episode(
            series_id=series.id, title="Neutral", order=0,
            panels=[Panel(id="p1", order=0), Panel(id="p2", order=1)],
            takes=[Take(panel_id=pid, asset_id=asset.id, status="adopted",
                        width=200, height=200) for pid in ("p1", "p2")],
            strip=Strip(
                width=400, height=1500, manual=True, margin=0,
                panel_boxes={"p1": (100, 100, 300, 300),
                             "p2": (100, 1000, 300, 1200)},
                lettering=[LetteringLayer(
                    id="gap-caption", kind="caption", text="INTERLUDE",
                    box=(40, 600, 350, 650), panel_id=None, locked=True)],
            ),
        ))
        with prepare_snapshot(ctx, series, episode) as plan:
            with plan.render_region((0, 0, 400, 1500)) as full:
                print("strip", full.size, "gap pixel", full.getpixel((50, 610)))
        _, _, pages = episode_pages(ctx, episode.id, lettered=True, profile="clean")
        for page in pages:
            with Image.open(io.BytesIO(page.data)) as image:
                print("album", image.size, "colors", len(image.getcolors(1_000_000)))
        client = TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1")
        common = {"episode_ids": [episode.id], "lettered": True, "image_profile": "clean"}
        html = client.post("/api/export/album", json={
            **common, "template_id": "export-monograph"})
        pdf = client.post("/api/export/portable", json={**common, "format": "pdf"})
        print("HTML", html.status_code, "INTERLUDE" in html.text)
        print("PDF", pdf.status_code, re.findall(rb"/MediaBox\s*\[(.*?)\]", pdf.content))
    finally:
        ctx.close()
```

实际输出：

```text
strip (400, 1500) gap pixel (20, 20, 20)
album (200, 200) colors 1
album (200, 200) colors 1
HTML 200 False
PDF 200 [b'0 0 150.000000 150.000000', b'0 0 150.000000 150.000000']
```

  两幅 album 图片均为单色，证明正文未被栅格化进任何输出图；PDF 也只收到这两张格图。保存的 700px 格间留白消失。该证据不依赖“HTML 中搜索不到栅格文字”单一断言。
- **影响：** 创作者可以成功保存并成功导出一个缺少叙事正文、改变节奏的成品；没有错误提示。
- **建议：** 对已保存画布提供所有成品格式共用的完整 composition 输出计划，保留空白区域、跨格/无主嵌字与原坐标，再按目标格式分页/切片；原图展示仍用于未排版模式。不能只把文档改成“不保证一致”。

## SPEC-03：同幕多句修改只能整体接受

- **级别：P2；状态：部分实现已实测，需求粒度解释待主控核定。**
- **原需求：** Wave 2.5：“可视化展示结构化剧本提案的逐幕/逐句 diff，支持逐条勾选接受或拒绝。”
- **位置：** 新扩展 `examples/extensions/script-review/panel.js:88–95,101–117`；底层操作粒度 `server/mio_server/pipeline/assistant.py:156–164`。
- **触发：** 一幕两句对白均有建议，作者想只采用其中一句。
- **预期 / 实际：** 两个逐句 diff 应可独立接受/拒绝。实际一幕只有一个 `input.value=op.id`；对白虽然分行展示，循环没有创建句级 checkbox；所有对白和该幕其他变化共享同一项接受结果。
- **最短离线复现：** 在 TEMP AppContext 创建单幕、两句 `Old first.` / `Old second.`；取 `assistant.normalized_view()` 并把两句分别改为 `New first.` / `New second.`，调用真实 `assistant.diff()` 后，只产生一个 `op1`；`assistant.apply(..., accepted=['op1'])` 同时保存两句：

```text
{"op_count":1,"op_ids":["op1"],"changed_dialogue_lines":2,
 "accepted_ids":["op1"],"saved_lines":["New first.","New second."]}
```

- **基线与影响：** 后端整幕 operation 粒度早于本轮；新扩展未补齐句级接受能力。用户只能整幕接受后再人工撤回不需要的修改，不能完成需求描述的精细审阅。
- **建议：** 用稳定句标识/明确下标与基准内容构建句级操作，支持选中子变更且原子 CAS 应用；增加同幕混合接受/拒绝及插入删除句子的离线回归。若保留整幕选择，必须由需求方明确认可该粒度。

## 有限覆盖清单与边界

| 波次 / 需求 | 本审查实际覆盖 | 结论或边界 |
| --- | --- | --- |
| 前置红线与交付范围 | 阅读 AGENTS、README、ROADMAP、CI、原需求全文、交付声明、共享审查约定/台账；核对固定提交列表与 diff 统计 | 目标与基线已锁定；未改生产代码或其他审查者文件 |
| 0.1 三模板、默认值、nonce/原图/v1 | 查看新模板/删除清单、runtime.css、默认值改动、templateFile 与对应 album 测试的契约断言；沿 HTML 导出构图链检查 | 三套模板和默认替换确实存在；未进行真实浏览器视觉复验；保存画布的完整输出缺口见 SPEC-02。模板 CSS 的 contain 不等价于证明所有上游构图完整 |
| 0.2 README | 阅读完整重写首页及其入口结构；核对 CI 的本地链接检查步骤 | 未发现可证实的需求缺项；未重复执行全仓链接门禁 |
| 1.1 盲选/对比 | 查看 BoardReview 的左右/A/X/C、同幕固定比较、原尺寸细节路径与相关改动 | 代码路径具备需求入口；未把静态阅读当作真实浏览器验收 |
| 1.1 Bible 联动 | 查看 PanelEditor、BibleAssist、CastPicker、biblePrompts、ReferencePreview、PanelVariableFix、FrameVariablePreview | 确有变量补全、补值、角色搜索与显式参考图读取路径；未调用真实 LLM/ComfyUI |
| 1.1 画布 | 查看 CanvasTab/StripStage/Letter/LetterTools/canvasTools、PacingDialog、canvas_assist 与导出链；TEMP 组件与 API 定向探针 | 确认 SPEC-01/02；不重复全量已通过测试 |
| 1.2 零回归拆分 | 对三个后端目标做定义级 AST 对照；工作流槽位原 53 个顶级定义均找到去向，其中 52 个 AST 相同；主题/渲染按职责提取及 facade 抽查 | 未发现可证明的纯提取行为回归；没有把此抽样扩大为八个入口零回归证明，前端拆分未穷举 |
| 2 六包 | 阅读专业扩展说明，抽查 motion/variant/script/QA 面板和剧本/QA 生命周期/闭环测试 | 确认 SPEC-03；未重复六包浏览器矩阵；修图/成品深测与隔离安全由其他领域审查负责 |
| 3 通用生态 | 对照需求、交付范围、目录/接口变动与平台无关命名 | 未独立深测渠道/SDK；不因仅离线验证就报告服务商认证缺陷；细节交生态审查 |
| 4 持久化、文档与门禁 | 查看声明与 CI 范围；确认交付报告明确真实服务、断电、签名发布边界 | 持久发布交专审；未运行付费调用、物理断电、重复全量门禁或新装浏览器。最终 CI 结论由主控核实 |

## 实验纪律

TEMP 实验文件和临时工作区均由 TemporaryDirectory 清理。组件探针初次加载曾因临时目录的依赖解析与路由保护 mock 不全而失败，修正纯探针后成功捕获上述请求；这些 harness 失败未记作产品缺陷。三个有效探针分别验证 CAS 请求构造、实际 HTML/PDF 输出和真实 assistant diff/apply；没有把新增缺陷断言通过误写为产品回归通过。
