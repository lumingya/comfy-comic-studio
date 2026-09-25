#!/usr/bin/env python3
"""Regenerate docs/api/openapi.json and docs/api/ROUTES.md from the route table.

    python tools/build_api_docs.py          # write both files
    python tools/build_api_docs.py --check  # exit 1 when they are stale
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def outputs():
    from backend import mio_api

    return {
        ROOT / "docs/api/openapi.json": json.dumps(mio_api.openapi(), ensure_ascii=False, indent=2) + "\n",
        ROOT / "docs/api/ROUTES.md": mio_api.route_table(),
    }


def main(argv):
    stale = []
    for path, text in outputs().items():
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current != text:
            stale.append(path.relative_to(ROOT).as_posix())
            if "--check" not in argv:
                path.write_text(text, encoding="utf-8", newline="\n")
    if "--check" in argv and stale:
        print("Stale API docs: " + ", ".join(stale) + " (run python tools/build_api_docs.py)")
        return 1
    print(("Updated: " + ", ".join(stale)) if stale else "API docs are up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
