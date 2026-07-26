#!/usr/bin/env python3
"""重新生成 .eslintrc.json 里的 globals 列表。

js/*.js 是一组经典脚本（非 ES module），它们共享同一个全局词法作用域：
一个文件里的顶层 let/const/function 对其余文件直接可见。ESLint 默认看不到
这层跨文件关系，所以需要把这些顶层声明显式列成 globals，否则 no-undef 会
对每一处跨文件调用误报。

新增或删除模块、改动顶层声明之后运行：

    python tools/sync_eslint_globals.py
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DECLARATION = re.compile(r"^(?:async\s+)?(function|let|const|class)\s+([A-Za-z_$][\w$]*)")
# 浏览器/第三方注入的全局，不是我们自己声明的，需要手工维护。
EXTERNAL_GLOBALS = {"lucide": "readonly"}


def collect_top_level_declarations():
    found = {}
    for path in sorted((ROOT / "js").glob("*.js")):
        for line in path.read_text(encoding="utf-8").splitlines():
            match = DECLARATION.match(line)
            if match:
                kind, name = match.group(1), match.group(2)
                found[name] = "writable" if kind == "let" else "readonly"
    return found


def main():
    config_path = ROOT / ".eslintrc.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))

    merged = dict(EXTERNAL_GLOBALS)
    merged.update(collect_top_level_declarations())
    new_globals = {name: merged[name] for name in sorted(merged)}

    if config.get("globals") == new_globals:
        print("globals already up to date")
        return 0

    config["globals"] = new_globals
    config_path.write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(new_globals)} globals to .eslintrc.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
