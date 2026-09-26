"""Command line for the ComfyUI runner.

    python -m mio_next.comfy inspect  WORKFLOW [--config run.json]
    python -m mio_next.comfy snapshot WORKFLOW --out state.json
    python -m mio_next.comfy run      WORKFLOW [--config run.json] [--variant draft|final]
                                      [--prompt ...] [--negative ...] [--seed N] [--width W --height H]
                                      [--set /node/inputs/field=value ...] [--guard a,b] [--dry-run]

WORKFLOW is a ComfyUI API-format export. The optional run config (JSON) holds what should not
be typed every time::

    {"server": "http://127.0.0.1:8188",
     "mapping":   {"seed": ["/3/inputs/seed"]},              # manual JSON Pointer bindings
     "values":    {"negative": "lowres, bad anatomy"},       # default bound values
     "overrides": {"/2295/inputs/loras/__value__/*/active": false},
     "guard":     ["term", ...],                             # refuse to submit if found
     "state":     "state.json",                              # from `snapshot`
     "frontend":  {"3837": {"步数": 20}},                     # stateful-node changes for this run
     "variants":  {"draft": {"frontend": {...}, "overrides": {...}}}}
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

from . import adapters
from . import bindings as B
from .client import ComfyClient, ComfyError

VALUE_FLAGS = ("prompt", "negative", "seed", "width", "height", "steps", "cfg", "denoise", "sampler", "scheduler", "batch", "checkpoint")


def load_workflow(path) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and "nodes" in data and "links" in data:
        raise SystemExit("这是 ComfyUI 界面格式的工作流。请在 ComfyUI 里用「导出（API）」另存为 API 格式。")
    if isinstance(data, dict) and isinstance(data.get("prompt"), dict):
        data = data["prompt"]
    if not isinstance(data, dict) or not data or not all(isinstance(n, dict) and "class_type" in n for n in data.values()):
        raise SystemExit("不是 ComfyUI API 格式的工作流（节点缺少 class_type）。")
    return data


def deep_merge(base: dict, extra: dict) -> dict:
    out = dict(base)
    for key, value in (extra or {}).items():
        out[key] = deep_merge(out[key], value) if isinstance(value, dict) and isinstance(out.get(key), dict) else value
    return out


def load_config(path, variant: str | None) -> dict:
    if not path:
        return {}
    config = json.loads(Path(path).read_text(encoding="utf-8"))
    merged = deep_merge({k: v for k, v in config.items() if k != "variants"},
                        (config.get("variants") or {}).get(variant or "", {}))
    state = merged.get("state")
    if isinstance(state, str):  # path relative to the config file
        merged["state"] = json.loads((Path(path).parent / state).read_text(encoding="utf-8"))
    return merged


def parse_sets(items) -> dict:
    out = {}
    for item in items or []:
        pointer, sep, raw = item.partition("=")
        if not sep or not pointer.startswith("/"):
            raise SystemExit(f"--set 需要「/节点/inputs/字段=值」格式：{item}")
        try:
            out[pointer] = json.loads(raw)
        except ValueError:
            out[pointer] = raw
    return out


def variants_of(bindings) -> list[str]:
    return sorted({b.qualifier for b in bindings if b.kind == "output" and b.qualifier})


def build(graph: dict, config: dict, variant: str | None, values: dict, extra_overrides: dict | None = None):
    """Resolve bindings, prune to the variant, write values, apply overrides."""
    bindings, problems = B.resolve(graph, config.get("mapping"))
    if variant is None and variants_of(bindings) and not any(b.kind == "output" and not b.qualifier for b in bindings):
        raise SystemExit(f"工作流按变体标记了输出，请用 --variant 选择：{', '.join(variants_of(bindings))}")
    pruned, outputs = B.select_variant(graph, bindings, variant)
    filled = B.apply_values(pruned, bindings, values)
    final = B.apply_overrides(filled, {**(config.get("overrides") or {}), **(extra_overrides or {})})
    inspect_nodes = sorted(b.node for b in bindings if b.kind == "inspect" and b.node in final)
    return final, outputs, inspect_nodes, bindings, problems


def cmd_inspect(args) -> int:
    graph = load_workflow(args.workflow)
    config = load_config(args.config, None)
    bindings, problems = B.resolve(graph, config.get("mapping"))
    print(f"工作流：{len(graph)} 个节点（API 格式）")
    print("绑定：")
    for kind, targets in B.summary(bindings).items():
        print(f"  {kind:<10} ← {', '.join(targets)}")
    names = variants_of(bindings) or [None]
    for name in names:
        try:
            pruned, outputs = B.select_variant(graph, bindings, name)
        except B.BindingError as exc:
            print(f"变体 {name or '(默认)'}：{exc}")
            continue
        print(f"变体 {name or '(默认)'}：输出 {', '.join(outputs)}，保留 {len(pruned)}/{len(graph)} 个节点")
        for warning in B.lint_outputs(B.apply_overrides(pruned, config.get("overrides")), outputs):
            print(f"  提示：{warning}")
    stateful = adapters.stateful_nodes(graph)
    if stateful:
        print("前端状态节点（参数不在 API JSON 里，运行前需同步）：" + ", ".join(f"{k} {v}" for k, v in stateful.items()))
    sources = B.text_sources(B.apply_overrides(graph, config.get("overrides")))
    print(f"文本来源：{len(sources)} 处（会进入文本编码器的字面量字符串）")
    for problem in problems:
        print(f"问题：{problem}")
    return 1 if problems else 0


def cmd_snapshot(args) -> int:
    graph = load_workflow(args.workflow)
    client = ComfyClient(args.server)
    state = adapters.capture(client, graph)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    for node_id, item in state.items():
        described = adapters.ADAPTERS[item["class_type"]].describe(item["state"])
        print(f"{node_id} {item['class_type']}：{len(item['state'])} 项 {described}")
    empty = [k for k, v in state.items() if not v["state"]]
    if empty:
        print(f"注意：节点 {', '.join(empty)} 在服务器上没有状态，请先在 ComfyUI 界面打开一次工作流。")
    print(f"已保存 → {args.out}")
    return 1 if empty else 0


def _printer(graph):
    last = {"node": None}

    def on_event(event):
        kind = event.get("type")
        if kind == "executing" and event.get("node"):
            node = event["node"]
            last["node"] = node
            print(f"  · {node} {graph.get(node, {}).get('class_type', '')}", flush=True)
        elif kind == "progress":
            value, maximum = event.get("value") or 0, event.get("max") or 0
            if maximum and (value == maximum or value % max(1, maximum // 4) == 0):
                print(f"    {value}/{maximum}", flush=True)
        elif kind == "warning":
            print(f"  ! {event.get('message')}", flush=True)

    return on_event


def cmd_run(args) -> int:
    graph = load_workflow(args.workflow)
    config = load_config(args.config, args.variant)
    values = dict(config.get("values") or {})
    for flag in VALUE_FLAGS:
        value = getattr(args, flag, None)
        if value is not None:
            values[flag] = value
    if values.get("seed") is None:
        values["seed"] = random.randint(0, 2**32 - 1)
    final, outputs, inspect_nodes, bindings, problems = build(graph, config, args.variant, values, parse_sets(args.set))
    for problem in problems:
        print(f"问题：{problem}")
    for warning in B.lint_outputs(final, outputs):
        print(f"提示：{warning}")
    terms = list(config.get("guard") or []) + [t for t in (args.guard or "").split(",") if t.strip()]
    hits = B.guard_terms(final, terms)
    if hits:
        print("内容检查未通过，已停止提交：")
        for node_id, path, term in hits:
            print(f"  节点 {node_id} 的 {path} 含有「{term}」")
        return 2
    name = f"{args.variant or 'run'}-{values['seed']}"
    out_dir = Path(args.out)
    if args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{name}.api.json").write_text(json.dumps(final, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"试运行：{len(final)} 个节点，输出 {', '.join(outputs)}，检查节点 {', '.join(inspect_nodes) or '无'}")
        print(f"已写出将要提交的 API JSON → {out_dir / (name + '.api.json')}")
        return 0
    client = ComfyClient(args.server or config.get("server") or os.environ.get("MIO_COMFY_URL", "http://127.0.0.1:8188"))
    undo = adapters.prepare(client, final, config.get("state"), config.get("frontend"))
    print(f"提交 {name}：{len(final)} 个节点，输出 {', '.join(outputs)}", flush=True)
    try:
        result = client.run(final, output_nodes=outputs, on_event=_printer(final), timeout=args.timeout)
    finally:
        adapters.restore(client, undo)
    inspect = {node: result.texts.get(node, []) for node in inspect_nodes}
    flagged = {node: B.guard_text(" ".join(texts), terms) for node, texts in inspect.items()}
    flagged = {node: found for node, found in flagged.items() if found}
    metrics = {
        "variant": args.variant, "seed": values["seed"], "prompt_id": result.prompt_id,
        "elapsed": round(result.elapsed, 2), "live": result.live, "previews": result.previews,
        "cached": result.cached, "nodes": len(final), "outputs": outputs,
        "node_seconds": {k: round(v, 2) for k, v in sorted(result.node_seconds.items(), key=lambda kv: -kv[1])},
        "inspect": inspect, "images": [], "guard_after_run": flagged,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    if flagged:
        print("最终提示词含有被拦截的词，图片不保存：" + json.dumps(flagged, ensure_ascii=False))
    else:
        for i, image in enumerate(result.images):
            path = out_dir / f"{name}-{i}{Path(image.filename).suffix or '.png'}"
            path.write_bytes(image.data)
            metrics["images"].append(str(path))
    (out_dir / f"{name}.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    top = ", ".join(f"{k} {final.get(k, {}).get('class_type', '')} {v:.1f}s" for k, v in list(metrics["node_seconds"].items())[:4])
    print(f"完成：{result.elapsed:.1f}s，{len(result.images)} 张图，缓存 {len(result.cached)} 个节点，预览帧 {result.previews}")
    print(f"  最慢节点：{top or '—'}")
    for node, texts in inspect.items():
        print(f"  检查 {node}：{' | '.join(texts)[:400]}")
    for path in metrics["images"]:
        print(f"  → {path}")
    if not result.images:
        print("  注意：输出节点没有回报图片（见上面的提示）。")
    return 3 if flagged else (0 if result.images else 4)


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass
    default_server = os.environ.get("MIO_COMFY_URL", "http://127.0.0.1:8188")
    parser = argparse.ArgumentParser(prog="python -m mio_next.comfy", description="Mio ComfyUI runner (Spike)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("inspect", help="列出绑定、变体、前端状态节点")
    p.add_argument("workflow")
    p.add_argument("--config")
    p.set_defaults(func=cmd_inspect)
    p = sub.add_parser("snapshot", help="保存前端状态节点的当前参数")
    p.add_argument("workflow")
    p.add_argument("--out", required=True)
    p.add_argument("--server", default=default_server)
    p.set_defaults(func=cmd_snapshot)
    p = sub.add_parser("run", help="出图")
    p.add_argument("workflow")
    p.add_argument("--config")
    p.add_argument("--variant")
    for flag in VALUE_FLAGS:
        p.add_argument(f"--{flag}", type=int if flag in ("seed", "width", "height", "steps", "batch") else
                       float if flag in ("cfg", "denoise") else str)
    p.add_argument("--set", action="append", help="/节点/inputs/字段=值（值按 JSON 解析，失败则当字符串）")
    p.add_argument("--guard", help="逗号分隔的拦截词")
    p.add_argument("--out", default="out")
    p.add_argument("--server")
    p.add_argument("--timeout", type=float, default=900)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_run)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (ComfyError, B.BindingError) as exc:
        print(f"错误：{exc}")
        detail = getattr(exc, "detail", None)
        if detail:
            print(json.dumps(detail, ensure_ascii=False)[:1500])
        return 1
