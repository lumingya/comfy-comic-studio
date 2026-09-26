#!/usr/bin/env python3
"""Refresh classic-script globals using Acorn (supports comma-separated declarations)."""
import pathlib
import subprocess

if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parent.parent
    raise SystemExit(subprocess.call(["node", "tools/sync-eslint-globals.mjs"], cwd=root))
