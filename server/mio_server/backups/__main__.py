"""Local recovery CLI. No network calls, extension loading or generation execution."""

import argparse
import json
import shutil
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

from ..assets import AssetStore
from ..jobs import JobEngine
from ..storage import SQLiteStore
from .models import BackupOptions, RestoreApply
from .service import Backups
from .startup import prepare_workspace


@contextmanager
def offline_context(path: Path):
    startup = prepare_workspace(path)
    store = engine = None
    try:
        store = SQLiteStore(path / "mio.sqlite3")
        engine = JobEngine(path / "jobs.sqlite3", autostart=False)
        yield SimpleNamespace(
            data_dir=path, store=store, engine=engine, assets=AssetStore(path / "assets", store)
        )
    finally:
        if engine:
            engine.close()
        if store:
            store.close()
        # The full application must still suppress first-start seeding and expiry after install.
        startup.release()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Verify and restore Mio workspace backups")
    sub = parser.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect")
    inspect.add_argument("archive", type=Path)
    export = sub.add_parser("export")
    export.add_argument("--data", required=True, type=Path)
    export.add_argument("--output", required=True, type=Path)
    export.add_argument("--include-credentials", action="store_true")
    stage = sub.add_parser("stage")
    stage.add_argument("--data", required=True, type=Path)
    stage.add_argument("archive", type=Path)
    apply = sub.add_parser("apply")
    apply.add_argument("--data", required=True, type=Path)
    apply.add_argument("plan")
    apply.add_argument("--expected-head", required=True)
    apply.add_argument("--expected-archive-sha256", required=True)
    install = sub.add_parser("install")
    install.add_argument("--data", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "inspect":
        result = Backups.inspect(args.archive).model_dump(mode="json")
    elif args.command == "install":
        startup = prepare_workspace(args.data)
        try:
            result = {"restored": startup.restored}
        finally:
            startup.release()
    else:
        with offline_context(args.data.resolve()) as ctx:
            service = Backups(ctx)
            if args.command == "export":
                if args.output.exists():
                    parser.error("output already exists")
                created = service.export(
                    BackupOptions(include_credentials=args.include_credentials)
                )
                shutil.copyfile(service.download(created.id), args.output)
                result = created.model_dump(mode="json")
            elif args.command == "stage":
                result = service.stage(args.archive).model_dump(mode="json")
            else:
                result = service.apply(
                    args.plan,
                    RestoreApply(
                        expected_head=args.expected_head,
                        expected_archive_sha256=args.expected_archive_sha256,
                    ),
                ).model_dump(mode="json")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
