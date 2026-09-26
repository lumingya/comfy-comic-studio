"""python -m mio_next <command>

    script  "一句话"  --out story.json      one sentence -> validated story JSON (LLM via proxy)
    compile story.json [--panel p03]         print both prompt dialects for review
    bench   story.json --out out/bench ...   rendering, judging, layout, report (see bench.py)

The ComfyUI runner has its own entry point: python -m mio_next.comfy
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import prompts as P
from . import script as S


def cmd_script(args) -> int:
    from .llm import Client, LLMError

    client = Client(args.llm)
    started = time.monotonic()
    try:
        story, reply = S.generate_script(args.sentence, client, args.min_panels, args.max_panels,
                                         models=tuple(args.model) if args.model else None)
    except LLMError as exc:
        print(f"错误：{exc}")
        return 1
    story["source"] = {"sentence": args.sentence, "model": reply.model,
                       "seconds": round(time.monotonic() - started, 1), "fallbacks": reply.attempts}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(story, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"《{story['title']}》 {json.dumps(S.stats(story), ensure_ascii=False)}")
    print(f"模型 {reply.model}，{story['source']['seconds']} s → {args.out}")
    return 0


def cmd_compile(args) -> int:
    story = S.normalize_story(json.loads(Path(args.story).read_text(encoding="utf-8")))
    problems = S.validate_story(story, 1, 99)
    for problem in problems:
        print(f"问题：{problem}")
    for panel in story.get("panels") or []:
        if args.panel and panel["id"] != args.panel:
            continue
        pos, neg = P.danbooru(story, panel)
        text, refs = P.natural(story, panel)
        print(f"== {panel['id']} [{panel['shot']}/{panel['angle']}] {P.panel_size(panel)}")
        print(f"  danbooru: {pos}")
        print(f"  negative: {neg}")
        print(f"  natural : {text}")
        print(f"  refs    : {refs}")
    return 1 if problems else 0


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass
    from .llm import DEFAULT_BASE

    parser = argparse.ArgumentParser(prog="python -m mio_next")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("script", help="一句话生成结构化剧本")
    p.add_argument("sentence")
    p.add_argument("--out", required=True)
    p.add_argument("--min-panels", type=int, default=12)
    p.add_argument("--max-panels", type=int, default=16)
    p.add_argument("--model", action="append", help="可重复，按顺序回退")
    p.add_argument("--llm", default=DEFAULT_BASE)
    p.set_defaults(func=cmd_script)
    p = sub.add_parser("compile", help="打印两种方言的提示词")
    p.add_argument("story")
    p.add_argument("--panel")
    p.set_defaults(func=cmd_compile)
    try:
        from . import bench
        bench.add_parser(sub)
    except ImportError:
        pass
    args = parser.parse_args(argv)
    return args.func(args)
