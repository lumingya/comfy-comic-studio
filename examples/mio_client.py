#!/usr/bin/env python3
"""Mio stdlib client for the public API (contract 2.0). No automatic retries: generation can incur charges.

  export MIO_API_TOKEN=...                 # same token as the Mio server
  python examples/mio_client.py            # non-billable: capabilities
  python examples/mio_client.py routes     # every operation
  python examples/mio_client.py workspace  # status and active selections
  python examples/mio_client.py list storyboards
  python examples/mio_client.py generate --channel-id openai --prompt "A quiet bookshop" --output page.png

Library use::

    from mio_client import MioClient
    mio = MioClient()
    if not mio.list("collections")["items"]:          # an empty workspace needs a collection first
        mio.create("collections", {"title": "默认画册集"})
    story = mio.create("storyboards", {"title": "海边的信", "frames": [{"prompt": "seaside"}]})
    mio.patch("storyboards", story["id"], {"outline": "夏天的告别"}, etag=story["etag"])
    task = mio.assemble(story["id"], channel_id="comfyui")  # free: the album title defaults to the storyboard title
    mio.start_task(task["id"], trusted=True)                # starting always needs trusted=True (may be billed)
    print(mio.wait_task(task["id"])["status"])              # complete / partial / failed / ...
"""
import argparse
import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


# Production task states that are still going to change (see GET /production/tasks/{taskId}).
ACTIVE_TASK_STATES = ("ready", "preparing", "running")


class MioError(RuntimeError):
    def __init__(self, status, code, message, request_id="", details=None):
        super().__init__(f"Mio HTTP {status} {code}: {message} ({request_id})")
        self.status, self.code, self.message, self.request_id, self.details = status, code, message, request_id, details


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # Protect the token from accidental redirects to a different service.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class MioClient:
    def __init__(self, base_url=None, token=None, timeout=360):
        self.base_url = (base_url or os.environ.get("MIO_URL", "http://127.0.0.1:8777")).rstrip("/")
        self.token = token or os.environ.get("MIO_API_TOKEN", "")
        self.timeout = timeout
        if not self.token:
            raise ValueError("Set MIO_API_TOKEN")
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError("Use an HTTP(S) Mio server URL")
        if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("Use HTTPS for non-loopback connections")

    # ------------------------------------------------------------ transport
    def call(self, method, path, body=None, *, raw=None, content_type="application/json", etag=None, query=None):
        """One request. Returns ``data`` for JSON envelopes and bytes for files."""
        if not path.startswith("/") or ".." in path:
            raise ValueError("Use a path relative to /api/v1, e.g. /library/storyboards")
        url = self.base_url + "/api/v1" + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        headers = {"Authorization": "Bearer " + self.token}
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
        if data is not None:
            headers["Content-Type"] = content_type
        if etag:
            headers["If-Match"] = '"%s"' % etag.strip('"')
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.build_opener(_NoRedirect).open(request, timeout=self.timeout) as response:
                payload = response.read()
                if response.headers.get("Content-Type", "").startswith("application/json"):
                    value = json.loads(payload or b"null")
                    return value["data"] if isinstance(value, dict) and "data" in value and "requestId" in value else value
                return payload
        except urllib.error.HTTPError as exc:
            try:
                value = json.load(exc)
                error = value.get("error", {})
                raise MioError(exc.code, error.get("code", "unknown"), error.get("message", ""), value.get("requestId", ""),
                               error.get("details")) from None
            except (ValueError, AttributeError):
                raise MioError(exc.code, "unknown", "Non-JSON error response") from None

    def get(self, path, **query):
        return self.call("GET", path, query=query or None)

    # ------------------------------------------------------------ discovery
    def capabilities(self):
        return self.get("/capabilities")

    def routes(self):
        return self.get("/routes")

    def workspace(self):
        return self.get("/workspace")

    # ------------------------------------------------------------ library
    def list(self, kind, **query):
        return self.get("/library/" + kind, **query)

    def read(self, kind, id):
        return self.get("/library/%s/%s" % (kind, id))

    def create(self, kind, document):
        return self.call("POST", "/library/" + kind, document)

    def replace(self, kind, id, document, etag=None):
        return self.call("PUT", "/library/%s/%s" % (kind, id), document, etag=etag)

    def patch(self, kind, id, changes, etag=None):
        return self.call("PATCH", "/library/%s/%s" % (kind, id), changes, etag=etag)

    def delete(self, kind, id, etag=None, cascade=False):
        return self.call("DELETE", "/library/%s/%s" % (kind, id), etag=etag, query={"cascade": "true"} if cascade else None)

    def add_frames(self, storyboard_id, frames, index=None):
        return self.call("POST", "/library/storyboards/%s/frames" % storyboard_id, {"frames": frames},
                         query={"index": index} if index is not None else None)

    def set_variable(self, kind, preset_id, key, value, type_=None):
        body = {"value": value, **({"type": type_} if type_ else {})}
        return self.call("PUT", "/library/%s/%s/entries/%s" % (kind, preset_id, urllib.parse.quote(key)), body)

    def export_bundle(self, kind, id, output):
        return _write_new(output, self.call("GET", "/library/%s/%s/bundle" % (kind, id)))

    def import_bundle(self, path, project_id=None):
        return self.call("POST", "/library/import", raw=Path(path).read_bytes(), content_type="application/zip",
                         query={"projectId": project_id})

    # ------------------------------------------------------------ channels and settings
    def channels(self):
        return self.get("/channels")

    def create_channel(self, provider, title, base_url, model, api_key=None, activate=False, **fields):
        body = {"provider": provider, "title": title, "baseUrl": base_url, "model": model, "activate": activate, **fields}
        if api_key:
            body["apiKey"] = api_key
        return self.call("POST", "/channels", body)

    def settings(self, name):
        return self.get("/settings/" + name)

    def patch_settings(self, name, changes, etag=None):
        return self.call("PATCH", "/settings/" + name, changes, etag=etag)

    # ------------------------------------------------------------ generation
    def generate(self, channel_id, prompt, api_key="", **extra):
        body = {"channelId": channel_id, "prompt": prompt, **extra}
        if api_key:
            body["apiKey"] = api_key
        return self.call("POST", "/images/generations", body)

    def assemble(self, story_id, channel_id, presets=(), title=None, workflow_id=None, request_id=None):
        body = {"storyId": story_id, "channelId": channel_id, "presets": list(presets)}
        for key, value in (("title", title), ("workflowId", workflow_id), ("requestId", request_id)):
            if value:
                body[key] = value
        return self.call("POST", "/production/tasks", body)

    def start_task(self, task_id, trusted=False):
        return self.call("POST", "/production/tasks/%s/start" % task_id, {"trusted": trusted})

    def task(self, task_id):
        return self.get("/production/tasks/" + task_id)

    def wait_task(self, task_id, interval=5, timeout=3600):
        """Poll while the task is queued or running (never resubmits anything).

        Returns the task in its final state (complete / partial / failed / cancelled / interrupted),
        as soon as it is paused, or in standby when it was never started.
        """
        deadline = time.monotonic() + timeout
        while True:
            task = self.task(task_id)
            if task.get("status") not in ACTIVE_TASK_STATES or task.get("paused") or time.monotonic() > deadline:
                return task
            time.sleep(interval)

    # ------------------------------------------------------------ albums and assets
    def album(self, album_id):
        return self.get("/albums/" + album_id)

    def export_albums(self, album_ids, output, format="html", **options):
        return _write_new(output, self.call("POST", "/albums/export", {"albumIds": list(album_ids), "format": format, **options}))

    def save_asset(self, path_or_endpoint, output):
        path = path_or_endpoint
        if path.startswith("/api/v1/assets?"):
            path = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)["path"][0]
        return _write_new(output, self.call("GET", "/assets/raw", query={"path": path}))

    def upload_image(self, file_path):
        return self.call("POST", "/assets/upload", raw=Path(file_path).read_bytes(), content_type="application/octet-stream",
                         query={"name": Path(file_path).name})

    # ------------------------------------------------------------ LLM
    def chat(self, messages, scope="llm", **options):
        return self.call("POST", "/llm/chat", {"scope": scope, "messages": messages, **options})


def _write_new(output, raw):
    path = Path(output)
    # Never silently overwrite an existing file.
    with path.open("xb") as handle:
        handle.write(raw if isinstance(raw, (bytes, bytearray)) else base64.b64decode(raw))
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default=os.environ.get("MIO_URL", "http://127.0.0.1:8777"))
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("capabilities")
    sub.add_parser("routes")
    sub.add_parser("workspace")
    sub.add_parser("channels")
    listing = sub.add_parser("list")
    listing.add_argument("kind")
    listing.add_argument("--project-id")
    generate = sub.add_parser("generate", help="paid: one synchronous image")
    generate.add_argument("--channel-id", required=True)
    generate.add_argument("--prompt", required=True)
    generate.add_argument("--output", default="mio-image.png")
    args = parser.parse_args()
    client = MioClient(args.base_url)
    if args.command == "generate":
        if Path(args.output).exists():
            parser.error("Output exists; choose another filename before generating")
        result = client.generate(args.channel_id, args.prompt, os.environ.get("MIO_PROVIDER_KEY", ""))
        print(client.save_asset(result["image"], args.output))
        return
    if args.command == "list":
        value = client.list(args.kind, projectId=args.project_id)
    elif args.command in ("routes", "workspace", "channels"):
        value = getattr(client, args.command)()
    else:
        value = client.capabilities()
    print(json.dumps(value, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
