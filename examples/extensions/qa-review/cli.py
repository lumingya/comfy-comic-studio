"""Explicit local QA submission using only the Python standard library."""

import argparse
import ipaddress
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


def local_base(value: str) -> str:
    parts = urllib.parse.urlsplit(value)
    host = parts.hostname or ""
    try:
        loopback = host == "localhost" or ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = False
    if (
        parts.scheme not in ("http", "https")
        or not loopback
        or parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        raise argparse.ArgumentTypeError("--url must be a loopback HTTP(S) origin")
    return value.rstrip("/")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("redirect refused; use the local Mio server URL")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--url", type=local_base, default="http://127.0.0.1:8788")
    commands = root.add_subparsers(dest="command", required=True)
    queue = commands.add_parser("queue", help="explicitly submit QA for selected takes")
    queue.add_argument("--episode", required=True)
    queue.add_argument("--takes", nargs="+", required=True)
    queue.add_argument("--key", required=True, help="reuse this key only for the identical request")
    return root


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    body = {
        "episode_id": args.episode,
        "take_ids": args.takes,
        "idempotency_key": args.key,
    }
    request = urllib.request.Request(
        args.url + "/api/ext/qa-review/queue",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code}: {exc.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        return 1
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
