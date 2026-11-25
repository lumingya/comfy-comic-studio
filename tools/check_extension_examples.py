"""Check published views of bundled/example packages, or run offline panel tests."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from mio_server.extensions.ctk import check_package  # noqa: E402
from mio_server.private_store import regular_path  # noqa: E402

from build_release import include_release_file  # noqa: E402


def check_published_package(folder: Path, kind: str):
    """Validate a disposable publication view, never relaxing CTK or runtime trust checks."""
    regular_path(folder, directory=True, missing=False)
    entry = "extensions" if kind == "extension" else "themes"
    with tempfile.TemporaryDirectory(prefix="mio-published-package-") as temporary:
        staged = Path(temporary) / folder.name
        staged.mkdir()
        for source in sorted(folder.rglob("*")):
            relative = source.relative_to(folder)
            if not source.is_file() or not include_release_file(
                Path(entry) / folder.name / relative, entry=entry
            ):
                continue
            # Reject package links/junctions before copying can hide their redirected origin.
            regular_path(source, directory=False, missing=False, root=folder)
            target = staged / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        return check_package(staged, kind)


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
            report = check_published_package(folder, kind)
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
    for directory in (ROOT / "extensions", ROOT / "examples/extensions"):
        for folder in sorted(directory.iterdir()):
            if folder.is_dir() and (folder / "mio-extension.json").is_file():
                scripts.extend(sorted(folder.glob("*.test.cjs")))
                scripts.extend(sorted((folder / "tests").glob("*.test.cjs")))
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
