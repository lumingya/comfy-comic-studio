"""Benchmark: render the golden story two ways, judge consistency, lay out strips, report.

    python -m mio_next bench fixtures/golden_story.json --out out/bench \
        [--steps sheets,baseline,hybrid,judge,faces,layout,report] [--approaches baseline,hybrid] [--panels p01,p02]

Every artifact is written next to a JSON sidecar (timing, model, fallbacks); steps skip work
whose output already exists, so an interrupted run resumes where it stopped (--force redoes).
"""
from __future__ import annotations

import json
import os
import statistics
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import imaging
from . import judge as J
from . import layout as LY
from . import prompts as P
from . import script as S

STEPS = ("sheets", "baseline", "cloud", "hybrid", "judge", "faces", "layout", "report", "contact")
APPROACHES = ("baseline", "hybrid", "cloud")
# where each approach keeps its panels and the character sheets it is judged against
DIRS = {"baseline": (("baseline", "panels"), ("baseline", "sheets")),
        "hybrid": (("hybrid", "panels"), ("hybrid", "sheets")),
        "cloud": (("hybrid", "cloud"), ("hybrid", "cloud", "sheets"))}
LABELS = {"baseline": "基线（旧管线：只用标签）", "hybrid": "混合（云端定形 + 本地画风）", "cloud": "云端直出（混合的第一步）"}


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


class Bench:
    def __init__(self, args):
        self.args = args
        self.out = Path(args.out)
        self.story = S.normalize_story(json.loads(Path(args.story).read_text(encoding="utf-8")))
        wanted = set(args.panels.split(",")) if args.panels else None
        self.panels = [p for p in self.story["panels"] if not wanted or p["id"] in wanted]
        self.chars = self.story["characters"]
        self._local = self._llm = None

    # -------------------------------------------------------------- services
    @property
    def local(self):
        if self._local is None:
            from .comfy.client import ComfyClient
            from .render import LocalRenderer
            self._local = LocalRenderer(ComfyClient(self.args.server), checkpoint=self.args.checkpoint,
                                        steps=self.args.sampling_steps)
        return self._local

    @property
    def llm(self):
        if self._llm is None:
            from .llm import Client
            self._llm = Client(self.args.llm, pace=self.args.pace)
        return self._llm

    # -------------------------------------------------------------- files
    def path(self, *parts) -> Path:
        return self.out.joinpath(*parts)

    def save(self, path: Path, data: bytes, meta: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    def todo(self, path: Path) -> bool:
        return self.args.force or not path.exists()

    def meta(self, path: Path) -> dict:
        side = path.with_suffix(".json")
        return json.loads(side.read_text(encoding="utf-8")) if side.exists() else {}

    def panel_path(self, approach: str, pid: str) -> Path:
        return self.path(*DIRS[approach][0], f"{pid}.png")

    def sheet_path(self, approach: str, cid: str) -> Path:
        return self.path(*DIRS[approach][1], f"{cid}.png")

    def seed(self, panel_index: int) -> int:
        return self.args.seed + panel_index * 7

    # -------------------------------------------------------------- steps
    def step_sheets(self) -> None:
        if "baseline" in self.approaches:
            for i, ch in enumerate(self.chars):
                target = self.path("baseline", "sheets", f"{ch['id']}.png")
                if self.todo(target):
                    pos, neg = P.sheet_danbooru(ch)
                    data, meta = self.local.t2i(pos, neg, self.args.seed + 900 + i, (832, 1216))
                    self.save(target, data, {**meta, "prompt": pos})
                    log(f"baseline sheet {ch['id']} {meta['seconds']}s")
        if "hybrid" in self.approaches:
            jobs = [ch for ch in self.chars if self.todo(self.path("hybrid", "cloud", "sheets", f"{ch['id']}.png"))]
            with ThreadPoolExecutor(max(1, self.args.cloud_workers)) as pool:
                for ch, (data, meta) in zip(jobs, pool.map(self._cloud_sheet, jobs)):
                    self.save(self.path("hybrid", "cloud", "sheets", f"{ch['id']}.png"), data, meta)
                    log(f"cloud sheet {ch['id']} {meta['model']} {meta['seconds']}s")
            for i, ch in enumerate(self.chars):
                target = self.path("hybrid", "sheets", f"{ch['id']}.png")
                if self.todo(target):
                    pos, neg = P.sheet_danbooru(ch)
                    src = self.path("hybrid", "cloud", "sheets", f"{ch['id']}.png").read_bytes()
                    data, meta = self.local.i2i(src, pos, neg, self.args.seed + 900 + i, (832, 1216),
                                                self.args.denoise, self.args.strength, self.args.i2i_steps)
                    self.save(target, data, {**meta, "prompt": pos})
                    log(f"hybrid sheet {ch['id']} restyled {meta['seconds']}s")

    def _cloud_sheet(self, ch):
        from .render import CloudRenderer
        return CloudRenderer(self.llm).sheet(ch)

    def step_baseline(self) -> None:
        for i, panel in enumerate(self.story["panels"]):
            if panel not in self.panels:
                continue
            target = self.path("baseline", "panels", f"{panel['id']}.png")
            if not self.todo(target):
                continue
            pos, neg = P.danbooru(self.story, panel)
            try:
                data, meta = self.local.t2i(pos, neg, self.seed(i), P.panel_size(panel))
            except Exception as exc:  # keep going; the report counts failures
                log(f"baseline {panel['id']} 失败：{exc}")
                continue
            self.save(target, data, {**meta, "prompt": pos, "negative": neg, "seed": self.seed(i)})
            log(f"baseline {panel['id']} {meta['seconds']}s")

    def step_cloud(self) -> None:
        """Cloud drafts only (no ComfyUI), so it can run while the baseline renders locally."""
        from .render import CloudRenderer
        sheets = {ch["id"]: self.path("hybrid", "cloud", "sheets", f"{ch['id']}.png").read_bytes() for ch in self.chars}
        cloud = CloudRenderer(self.llm)
        jobs = [p for p in self.panels if self.todo(self.path("hybrid", "cloud", f"{p['id']}.png"))]

        def work(panel):
            try:
                return panel, cloud.panel(self.story, panel, sheets), None
            except Exception as exc:
                return panel, None, str(exc)

        with ThreadPoolExecutor(max(1, self.args.cloud_workers)) as pool:
            for panel, result, error in pool.map(work, jobs):
                if error:
                    log(f"hybrid cloud {panel['id']} 失败：{error[:200]}")
                    continue
                data, meta = result
                self.save(self.path("hybrid", "cloud", f"{panel['id']}.png"), data, meta)
                log(f"hybrid cloud {panel['id']} {meta['model']} {meta['mode']} {meta['seconds']}s refs={meta['refs']}")

    def step_hybrid(self) -> None:
        """Local img2img + tile over the cloud drafts (style unification)."""
        for i, panel in enumerate(self.story["panels"]):
            if panel not in self.panels:
                continue
            src, target = self.path("hybrid", "cloud", f"{panel['id']}.png"), self.path("hybrid", "panels", f"{panel['id']}.png")
            if not src.exists() or not self.todo(target):
                continue
            pos, neg = P.danbooru(self.story, panel)
            try:
                data, meta = self.local.i2i(src.read_bytes(), pos, neg, self.seed(i), P.panel_size(panel),
                                            self.args.denoise, self.args.strength, self.args.i2i_steps)
            except Exception as exc:
                log(f"hybrid local {panel['id']} 失败：{exc}")
                continue
            self.save(target, data, {**meta, "prompt": pos, "seed": self.seed(i), "denoise": self.args.denoise,
                                     "strength": self.args.strength})
            log(f"hybrid local {panel['id']} {meta['seconds']}s")

    def step_judge(self) -> None:
        for approach in self.approaches:
            target = self.path("judge", f"{approach}.json")
            if not self.todo(target):
                continue
            anchors = {ch["id"]: self.sheet_path(approach, ch["id"]).read_bytes() for ch in self.chars}
            panels = [p for p in self.panels if self.panel_path(approach, p["id"]).exists()]

            def work(panel):
                image = self.panel_path(approach, panel["id"]).read_bytes()
                for attempt in range(2):
                    try:
                        return J.judge_panel(self.llm, self.story, panel, anchors, image)
                    except Exception as exc:
                        error = str(exc)
                return {"panel": panel["id"], "error": error, "verdicts": J.score(self.story, panel, {})}

            with ThreadPoolExecutor(max(1, self.args.workers + 1)) as pool:
                results = list(pool.map(work, panels))
            summary = J.summarize(results)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps({"summary": summary, "panels": results}, ensure_ascii=False, indent=1), encoding="utf-8")
            log(f"judge {approach}: pass {summary['passed']}/{summary['appearances']} identity {summary['identity_mean']}")

    def step_faces(self) -> None:
        for approach in self.approaches:
            target = self.path("faces", f"{approach}.json")
            if not self.todo(target):
                continue
            panels = [p for p in self.panels if p["characters"] and self.panel_path(approach, p["id"]).exists()]

            def work(panel):
                data = self.panel_path(approach, panel["id"]).read_bytes()
                size = imaging.open_image(data).size
                try:
                    return panel["id"], J.locate_faces(self.llm, self.story, panel, data, size)
                except Exception as exc:
                    log(f"faces {approach} {panel['id']} 失败：{exc}")
                    return panel["id"], []

            with ThreadPoolExecutor(max(1, self.args.workers + 1)) as pool:
                faces = dict(pool.map(work, panels))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(faces, ensure_ascii=False, indent=1), encoding="utf-8")
            log(f"faces {approach}: {sum(len(v) for v in faces.values())} 张脸 / {len(faces)} 格")

    def step_layout(self) -> None:
        for approach in self.approaches:
            folder = self.path("strip", approach)
            if not self.args.force and (folder / "layout.json").exists():
                continue
            images = {}
            for p in self.panels:
                path = self.panel_path(approach, p["id"])
                if path.exists():
                    images[p["id"]] = imaging.open_image(path.read_bytes())
            faces_path = self.path("faces", f"{approach}.json")
            faces = json.loads(faces_path.read_text(encoding="utf-8")) if faces_path.exists() else {}
            started = time.monotonic()
            result = LY.layout_strip(self.story, images, faces)
            parts = LY.slices(result, 1280)
            folder.mkdir(parents=True, exist_ok=True)
            for old in folder.glob("*.jpg"):
                old.unlink()
            sizes = []
            for i, part in enumerate(parts, 1):
                path = folder / f"{i:03d}.jpg"
                part.save(path, "JPEG", quality=90)
                sizes.append(path.stat().st_size)
            report = {**result.report, "slices": len(parts), "slice_heights": [p.height for p in parts],
                      "total_bytes": sum(sizes), "seconds": round(time.monotonic() - started, 2),
                      "placements": [{"panel": q.panel, "kind": q.kind, "text": q.text, "box": q.box,
                                      "face_overlap": q.face_overlap} for q in result.placements]}
            (folder / "layout.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
            log(f"layout {approach}: {len(parts)} 片，{report['height']} px，{report['bubbles']} 个气泡，压脸 {report['bubbles_on_faces']}")

    def step_report(self) -> None:
        metrics = {"story": {"title": self.story["title"], **S.stats(self.story)},
                   "settings": {"checkpoint": self.args.checkpoint, "steps": self.args.sampling_steps,
                                "i2i_steps": self.args.i2i_steps,
                                "denoise": self.args.denoise, "strength": self.args.strength, "seed": self.args.seed},
                   "approaches": {}}
        for approach in self.approaches:
            entry = {"timing": self._timing(approach)}
            judge_path = self.path("judge", f"{approach}.json")
            if judge_path.exists():
                judged = json.loads(judge_path.read_text(encoding="utf-8"))
                entry["consistency"] = judged["summary"]
                entry["panels"] = {j["panel"]: {"verdicts": j.get("verdicts"), "scene": j.get("scene"),
                                                "quality": j.get("quality"), "extra_people": j.get("extra_people"),
                                                "error": j.get("error")} for j in judged["panels"]}
            layout_path = self.path("strip", approach, "layout.json")
            if layout_path.exists():
                lay = json.loads(layout_path.read_text(encoding="utf-8"))
                entry["layout"] = {k: lay[k] for k in ("slices", "height", "bubbles", "bubbles_on_faces", "total_bytes", "font")}
            metrics["approaches"][approach] = entry
        self.path("metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=1), encoding="utf-8")
        self.path("REPORT.md").write_text(render_report(metrics, self.story), encoding="utf-8")
        log(f"report → {self.path('REPORT.md')}")

    def step_contact(self, cell: int = 200, per_sheet: int = 5) -> None:
        """Side-by-side thumbnails (baseline | cloud draft | hybrid) in small JPEG pages for review."""
        from PIL import Image, ImageDraw
        font = LY.load_font(LY.find_font(LY.FONT_CANDIDATES), 16)
        columns = [("baseline", ("baseline", "panels")), ("cloud", ("hybrid", "cloud")), ("hybrid", ("hybrid", "panels"))]
        rows = [("sheets", [self.path(a, "sheets", f"{c['id']}.png") for a in ("baseline", "hybrid") for c in self.chars])]
        rows += [(p["id"], [self.path(*folder, f"{p['id']}.png") for _, folder in columns]) for p in self.panels]
        pages = [rows[:per_sheet + 1]] + [rows[i:i + per_sheet] for i in range(per_sheet + 1, len(rows), per_sheet)]
        for n, page in enumerate(pages, 1):
            width = cell * max(len(r[1]) for r in page) + 70
            sheet = Image.new("RGB", (width, len(page) * (cell + 8) + 8), "white")
            draw = ImageDraw.Draw(sheet)
            for r, (label, paths) in enumerate(page):
                y = 8 + r * (cell + 8)
                draw.text((6, y + cell // 2 - 8), label, fill="black", font=font)
                for c, path in enumerate(paths):
                    if path.exists():
                        im = imaging.open_image(path.read_bytes())
                        im.thumbnail((cell, cell))
                        sheet.paste(im, (70 + c * cell + (cell - im.width) // 2, y + (cell - im.height) // 2))
            sheet.save(self.path(f"contact_{n}.jpg"), "JPEG", quality=70)
        log(f"contact: {len(pages)} 页 → {self.path('contact_1.jpg')}")

    def _timing(self, approach: str) -> dict:
        def collect(folder):
            vals = []
            for side in sorted(self.path(*folder).glob("*.json")):
                meta = json.loads(side.read_text(encoding="utf-8"))
                if isinstance(meta.get("seconds"), (int, float)):
                    vals.append(meta["seconds"])
            return vals

        def stat(vals):
            return {"n": len(vals), "median": round(statistics.median(vals), 1), "mean": round(statistics.mean(vals), 1),
                    "total": round(sum(vals), 1)} if vals else {"n": 0}

        if approach == "baseline":
            local = collect(("baseline", "panels"))
            return {"per_panel": stat(local), "local": stat(local), "sheets": stat(collect(("baseline", "sheets")))}
        if approach == "cloud":
            cloud = collect(("hybrid", "cloud"))
            return {"per_panel": stat(cloud), "cloud": stat(cloud)}
        cloud, local = collect(("hybrid", "cloud")), collect(("hybrid", "panels"))
        models = {}
        for side in self.path("hybrid", "cloud").glob("*.json"):
            m = json.loads(side.read_text(encoding="utf-8")).get("model")
            models[m] = models.get(m, 0) + 1
        per_panel = [c + l for c, l in zip(cloud, local)] if len(cloud) == len(local) else []
        return {"per_panel": stat(per_panel), "cloud": stat(cloud), "local": stat(local), "cloud_models": models,
                "sheets_cloud": stat(collect(("hybrid", "cloud", "sheets"))), "sheets_local": stat(collect(("hybrid", "sheets")))}

    # -------------------------------------------------------------- run
    def run(self, steps) -> int:
        self.approaches = [a for a in self.args.approaches.split(",") if a in APPROACHES]
        for step in steps:
            log(f"== {step}")
            try:
                getattr(self, f"step_{step}")()
            except Exception as exc:
                log(f"步骤 {step} 出错：{exc}")
                traceback.print_exc()
                return 1
        return 0


def _pct(v):
    return "—" if v is None else f"{v * 100:.0f}%"


def render_report(metrics: dict, story: dict) -> str:
    st, cfg = metrics["story"], metrics["settings"]
    names = {c["id"]: c["name"] for c in story["characters"]}
    out = [f"# 效果基准：《{st['title']}》", "",
           f"- 黄金故事：{st['panels']} 格、{st['scenes']} 个场景、{st['characters']} 个角色、{st['lines']} 句对白；双人同框 {st['two_shots']} 格。",
           f"- 本地：`{cfg['checkpoint']}`，文生图 {cfg['steps']} 步，种子 {cfg['seed']}；混合策略的图生图 {cfg.get('i2i_steps')} 步、去噪 {cfg['denoise']}、tile 强度 {cfg['strength']}。", ""]
    out += ["## 一致性（VLM 评审）", "",
            "| 策略 | 出场次数 | 通过 | 通过率 | 身份均分（1–5） | 特征准确率 | 缺人 | 多余人物 | 场景符合（1–5） | 画面质量（1–5） |",
            "|---|---|---|---|---|---|---|---|---|---|"]
    for name, entry in metrics["approaches"].items():
        c = entry.get("consistency")
        if c:
            out.append(f"| {LABELS.get(name, name)} | {c['appearances']} | {c['passed']} | {_pct(c['pass_rate'])} | {c['identity_mean']} | "
                       f"{_pct(c['feature_accuracy'])} | {c['missing']} | {c['extra_people']} | {c['scene_mean']} | {c['quality_mean']} |")
    out += ["", "分角色通过率：", ""]
    for name, entry in metrics["approaches"].items():
        c = entry.get("consistency")
        if c:
            parts = [f"{names.get(cid, cid)} {v['passed']}/{v['appearances']}" for cid, v in c["by_character"].items()]
            out.append(f"- {LABELS.get(name, name)}：" + "，".join(parts))
    out += ["", "## 耗时", "", "| 策略 | 每格中位数 | 每格平均 | 云端中位数 | 本地中位数 | 格数 |", "|---|---|---|---|---|---|"]
    for name, entry in metrics["approaches"].items():
        t = entry["timing"]
        pp, cl, lo = t.get("per_panel", {}), t.get("cloud", {}), t.get("local", {})
        out.append(f"| {LABELS.get(name, name)} | {pp.get('median', '—')} s | {pp.get('mean', '—')} s | "
                   f"{(str(cl.get('median', '—')) + ' s') if cl else '—'} | {(str(lo.get('median', '—')) + ' s') if lo else '—'} | {pp.get('n', 0)} |")
    hy = metrics["approaches"].get("hybrid", {}).get("timing", {})
    if hy.get("cloud_models"):
        out.append("")
        out.append("云端模型实际使用：" + "，".join(f"{m} × {n}" for m, n in hy["cloud_models"].items()))
    out += ["", "## 排版", "", "| 策略 | 切片 | 总高度 | 气泡 | 压到脸的气泡 | 体积 |", "|---|---|---|---|---|---|"]
    for name, entry in metrics["approaches"].items():
        lay = entry.get("layout")
        if lay:
            out.append(f"| {LABELS.get(name, name)} | {lay['slices']} | {lay['height']} px | {lay['bubbles']} | {lay['bubbles_on_faces']} | "
                       f"{lay['total_bytes'] / 1e6:.1f} MB |")
    out += ["", "## 逐格明细", "", "| 分格 | 景别 | 出场 | " + " | ".join(LABELS.get(a, a).split("（")[0] for a in metrics["approaches"]) + " |",
            "|---|---|---|" + "---|" * len(metrics["approaches"])]
    for panel in story["panels"]:
        cells = []
        for entry in metrics["approaches"].values():
            info = (entry.get("panels") or {}).get(panel["id"])
            if not info:
                cells.append("—")
                continue
            if info.get("error"):
                cells.append("评审失败")
                continue
            vs = info.get("verdicts") or []
            text = " ".join(f"{names.get(v['character'], v['character'])}{'✓' if v['pass'] else '✗'}{v['identity']}" for v in vs) or "空镜"
            if info.get("extra_people"):
                text += f" 多{info['extra_people']}人"
            cells.append(text)
        cast = "、".join(names.get(c["id"], c["id"]) for c in panel["characters"]) or "—"
        out.append(f"| {panel['id']} | {panel['shot']} | {cast} | " + " | ".join(cells) + " |")
    out += ["", "✓/✗ 后的数字是身份分：在场、身份分 ≥ 4、标志特征没有判错，才算通过。", ""]
    return "\n".join(out)


def add_parser(sub) -> None:
    from .llm import DEFAULT_BASE

    p = sub.add_parser("bench", help="效果基准：两种策略出图、VLM 一致性评审、排版、报告")
    p.add_argument("story")
    p.add_argument("--out", default="out/bench")
    p.add_argument("--steps", default=",".join(STEPS))
    p.add_argument("--approaches", default=",".join(APPROACHES))
    p.add_argument("--panels", help="只跑这些分格，逗号分隔")
    p.add_argument("--checkpoint", default="anikawaxl_v4.safetensors")
    p.add_argument("--sampling-steps", type=int, default=24)
    p.add_argument("--i2i-steps", type=int, default=14, help="混合策略本地图生图的步数")
    p.add_argument("--denoise", type=float, default=0.5)
    p.add_argument("--strength", type=float, default=0.75)
    p.add_argument("--seed", type=int, default=20260926)
    p.add_argument("--workers", type=int, default=2, help="视觉评审并发")
    p.add_argument("--cloud-workers", type=int, default=1, help="云端出图并发（反代账号会限流，默认串行）")
    p.add_argument("--pace", type=float, default=3.0, help="反代请求之间的最小间隔（秒）")
    p.add_argument("--server", default=os.environ.get("MIO_COMFY_URL", "http://127.0.0.1:8188"))
    p.add_argument("--llm", default=DEFAULT_BASE)
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=lambda args: Bench(args).run([s for s in args.steps.split(",") if s in STEPS]))
