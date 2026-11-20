"""Subscribe, inspect and receive Mio webhooks without platform-specific dependencies.

The listener binds loopback by default. It prints only delivery IDs/event names and uses a
    SQLite replay store; no signing secret, bearer token or event payload is printed.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from mio_client import MioClient, WebhookError, verify_webhook


class SQLiteReplayStore:
    """Cross-process atomic ReplayStore implementation, retaining only ID/digest/expiry.

    Consumed IDs are never automatically deleted: signature expiry does not expire a delivery
    because a recorded retry may carry a later signature timestamp.
    Put the database in an application-owned directory. Processing side effects belong in
    a durable inbox/outbox transaction: a replay claim alone is not an exactly-once handler.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS deliveries ("
                "id TEXT PRIMARY KEY, digest TEXT NOT NULL, expires_at REAL NOT NULL)"
            )

    def claim(self, delivery_id: str, digest: str, expires_at: float, now: float) -> bool:
        with closing(sqlite3.connect(self.path, timeout=5)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "INSERT OR IGNORE INTO deliveries (id,digest,expires_at) VALUES (?,?,?)",
                (delivery_id, digest, expires_at),
            )
            return cursor.rowcount == 1


def read_secret(path: Path | None) -> str:
    secret = (
        json.loads(path.read_text(encoding="utf-8")).get("secret")
        if path
        else os.environ.get("MIO_WEBHOOK_SECRET")
    )
    if not isinstance(secret, str) or not secret:
        raise ValueError("use --secret-file from subscribe or set MIO_WEBHOOK_SECRET")
    return secret


def subscribe(client: MioClient, url: str, events: list[str], secret_file: Path) -> dict:
    """Write the server-generated secret exclusively; never expose it in returned output."""
    descriptor = os.open(secret_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    hook = None
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            hook = client.create_webhook(
                {"name": "Automation receiver", "url": url, "events": events}
            )
            json.dump({"hook_id": hook["id"], "secret": hook["secret"]}, stream)
            stream.write("\n")
        return {key: hook[key] for key in ("id", "events", "enabled")}
    except BaseException:
        secret_file.unlink(missing_ok=True)
        if hook:
            # Avoid leaving an enabled subscription whose signing key could not be saved.
            client.delete_webhook(hook["id"])
        raise


def receiver_handler(secret: str, replay_store: SQLiteReplayStore, *, clock=None):
    class Receiver(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            if self.path != "/mio-webhook":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if self.headers.get("Transfer-Encoding") or not 0 < length <= 1_048_576:
                self.send_error(413)
                return
            self.connection.settimeout(10)
            try:
                options = {"clock": clock} if clock else {}
                envelope = verify_webhook(
                    self.rfile.read(length),
                    self.headers,
                    secret,
                    replay_store=replay_store,
                    **options,
                )
            except WebhookError as error:
                # Authenticated duplicates are acknowledged, but never dispatched again.
                self.send_response(200 if error.replayed else 401)
                self.end_headers()
                return
            except Exception:
                # Storage failure must not dispatch an unrecorded delivery.
                self.send_response(503)
                self.end_headers()
                return
            print(
                json.dumps({"id": envelope["id"], "event": envelope["event"], "accepted": True}),
                flush=True,
            )
            self.send_response(202)
            self.end_headers()

    return Receiver


def debug_subscription(client: MioClient, command: str, hook_id: str | None = None):
    """Keep debug output restricted to non-secret subscription and delivery summaries."""
    if command == "list":
        result = client.list_webhooks()
        return {
            "events": list(result["events"]),
            "items": [
                {key: item.get(key) for key in ("id", "name", "events", "enabled")}
                for item in result["items"]
            ],
        }
    if command == "test":
        item = client.test_webhook(hook_id)
        return {key: item.get(key) for key in ("id", "event", "status", "attempts")}
    if command == "deliveries":
        return [
            {key: item.get(key) for key in ("id", "event", "status", "attempts")}
            for item in client.webhook_deliveries(hook_id)
        ]
    raise ValueError("unsupported debug command")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8788")
    commands = parser.add_subparsers(dest="command", required=True)
    listen = commands.add_parser("listen")
    listen.add_argument("--host", default="127.0.0.1")
    listen.add_argument("--port", type=int, default=8791)
    listen.add_argument("--secret-file", type=Path)
    listen.add_argument("--replay-db", type=Path, required=True)
    subscribe_command = commands.add_parser("subscribe")
    subscribe_command.add_argument("url")
    subscribe_command.add_argument("--events", nargs="+", default=["job.completed", "job.failed"])
    subscribe_command.add_argument("--secret-file", type=Path, required=True)
    commands.add_parser("list")
    for name in ("test", "deliveries"):
        commands.add_parser(name).add_argument("hook_id")
    args = parser.parse_args(argv)
    try:
        if args.command == "listen":
            handler = receiver_handler(
                read_secret(args.secret_file), SQLiteReplayStore(args.replay_db)
            )
            with ThreadingHTTPServer((args.host, args.port), handler) as server:
                print(
                    json.dumps({"listening": server.server_port, "path": "/mio-webhook"}),
                    flush=True,
                )
                server.serve_forever()
            return 0
        token = os.environ.get("MIO_TOKEN", "")
        if not token:
            parser.error("set an admin-scoped MIO_TOKEN in the environment")
        client = MioClient(args.base_url, token=token)
        result = (
            subscribe(client, args.url, args.events, args.secret_file)
            if args.command == "subscribe"
            else debug_subscription(client, args.command, getattr(args, "hook_id", None))
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        # Upstream response text may contain secrets; don't echo it in a diagnostics tool.
        print(json.dumps({"error": type(error).__name__, "status": "refused"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
