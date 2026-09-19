"""Preview or run orphan-asset collection for a Mio data directory.

    python tools/gc_assets.py --data data            # preview
    python tools/gc_assets.py --data data --apply    # move orphans to .trash/assets/<batch>
    python tools/gc_assets.py --data data --restore <batch>

Only unreferenced pool images older than --grace-hours are touched; album folders never are.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import mio_assets  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default="data")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--grace-hours", type=float, default=mio_assets.GRACE_HOURS)
    parser.add_argument("--restore", metavar="BATCH")
    args = parser.parse_args()
    if args.restore:
        print(json.dumps(mio_assets.restore(args.data, args.restore), ensure_ascii=False, indent=2))
        return
    report = mio_assets.inventory(args.data, args.grace_hours)
    if args.apply:
        report = mio_assets.collect(args.data, report["token"], args.grace_hours)
    summary = {k: report[k] for k in ("pools", "totalBytes", "referenced", "inGrace", "orphanBytes", "graceHours", "trash")}
    summary["orphans"] = len(report["orphans"])
    if args.apply:
        summary["moved"] = len(report.get("moved", []))
        summary["batch"] = report.get("batch")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
