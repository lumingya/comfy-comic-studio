"""Check every bundled/example package, or run the companion offline panel tests."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from mio_server.extensions.ctk import check_package  # noqa: E402


def packages() -> int:
    for required in (
        "extensions/ai-assist/mio-extension.json",
        "themes/theme-wallpaper/mio-theme.json",
    ):
        if not (ROOT / required).is_file():
            raise RuntimeError(f"Required baseline package is missing: {required}")
    checked = 0
    invalid = []
    for relative, kind, manifest in (
        ("extensions", "extension", "mio-extension.json"),
        ("examples/extensions", "extension", "mio-extension.json"),
        ("themes", "theme", "mio-theme.json"),
    ):
        for folder in sorted((ROOT / relative).iterdir()):
            if not folder.is_dir() or not (folder / manifest).is_file():
                continue
            report = check_package(folder, kind)
            checked += 1
            label = folder.relative_to(ROOT).as_posix()
            print(f"{'PASS' if report.valid else 'FAIL'} {label}")
            if not report.valid:
                invalid.append(label)
                for finding in report.findings:
                    print(f"  {finding.code}")
    if not checked:
        raise RuntimeError("No extension or theme packages were checked")
    print(f"Checked {checked} extension/theme packages; {len(invalid)} invalid")
    return bool(invalid)


def panel_tests() -> int:
    scripts = [ROOT / "server/tests/professional_review_panels.cjs"]
    for folder in sorted((ROOT / "examples/extensions").iterdir()):
        if folder.is_dir() and (folder / "mio-extension.json").is_file():
            scripts.extend(sorted(folder.glob("*.test.cjs")))
    for script in scripts:
        print(f"Testing {script.relative_to(ROOT).as_posix()}", flush=True)
        subprocess.run(["node", str(script)], cwd=ROOT, check=True)
    print(f"Passed {len(scripts)} offline panel test scripts")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--panel-tests", action="store_true", help="Run only panel tests, after installing web deps"
    )
    args = parser.parse_args()
    return panel_tests() if args.panel_tests else packages()


if __name__ == "__main__":
    raise SystemExit(main())
