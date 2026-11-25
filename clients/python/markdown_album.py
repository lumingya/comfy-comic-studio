"""Turn a Markdown storyboard into a rendered album using the standard Mio SDK.

No text model is called: # is the title, ## starts a panel, > is spoken dialogue,
and each panel's remaining text is its raw image prompt (including {preset variables}).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import tempfile
import urllib.parse
from pathlib import Path

from mio_client import MioClient, MioError


class CreationPendingError(ValueError):
    """Creation may have reached the server; only explicit resource reconciliation may resume."""

    def __init__(self, storyboard_id: str | None = None):
        super().__init__(
            "storyboard creation is uncertain; inspect Mio and bind the existing storyboard"
        )
        self.storyboard_id = storyboard_id


def parse_markdown(markdown: str) -> dict:
    """Parse a deliberately small, deterministic authoring format without an LLM."""
    if not isinstance(markdown, str) or len(markdown) > 1_000_000:
        raise ValueError("Markdown must be text with at most 1,000,000 characters")
    title, synopsis, panels, prompt = "", [], [], []

    def finish():
        if not panels:
            return
        text = "\n".join(prompt).strip()
        if not text:
            raise ValueError("each ## panel needs a nonempty image prompt")
        panels[-1]["overrides"] = {"raw_prompt": text}
        prompt.clear()

    for line in markdown.lstrip("\ufeff").splitlines():
        if line.startswith("```") or line.startswith("~~~"):
            raise ValueError("fenced blocks are unsupported; use plain panel prompt text")
        if line.startswith("# "):
            if title or panels:
                raise ValueError("use exactly one # title before all panels")
            title = line[2:].strip()
        elif line.startswith("## "):
            finish()
            name = line[3:].strip()
            if not name:
                raise ValueError("each ## panel needs a name")
            panels.append({"order": len(panels), "description": name, "dialogues": []})
        elif line.startswith(">"):
            if not panels:
                raise ValueError("dialogue belongs below a ## panel heading")
            text = line[1:].strip()
            if text:
                panels[-1]["dialogues"].append({"text": text, "kind": "speech"})
        elif panels:
            prompt.append(line)
        else:
            synopsis.append(line)
    finish()
    if not title or len(title) > 120 or not 1 <= len(panels) <= 512:
        raise ValueError("use a # title (1–120 characters) and between 1 and 512 ## panels")
    return {"title": title, "synopsis": "\n".join(synopsis).strip(), "panels": panels}


def save_receipt(path: Path, receipt: dict) -> None:
    """Replace only this command's small, credential-free resume receipt."""
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".mio-receipt-")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def file_sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


# Mirror the service's Episode, Panel, Dialogue, PanelOverrides and Strip defaults.
# Keep unknown fields: a newer service's extra business settings must fail closed.
SUBMISSION_DEFAULTS = {
    "episode": {
        "synopsis": "",
        "base_prompt": "",
        "panels": [],
        "takes": [],
        "strip": {},
        "album_source": None,
        "deleted_at": None,
    },
    "panel": {
        "shot": "",
        "angle": "",
        "characters": [],
        "location_id": None,
        "props": [],
        "time": "",
        "lighting": "",
        "description": "",
        "tags": [],
        "dialogues": [],
        "width_mode": "full",
        "inset_align": "center",
        "inset_scale": 0.78,
        "aspect_ratio": "2:3",
        "gap_after": 48,
        "transition_background": "transparent",
        "reference_mode": "auto",
        "references": [],
        "controls": [],
        "regional": False,
        "locked": False,
        "overrides": {},
        "motion": None,
        "album_source": None,
    },
    "dialogue": {"speaker_id": None, "kind": "speech", "bridge": False},
    "overrides": {
        "raw_prompt": None,
        "raw_negative": None,
        "append_prompt": "",
        "negative_prompt": "",
        "seed": None,
        "width": None,
        "height": None,
        "values": {},
        "node_overrides": {},
        "slot_overrides": {},
        "profile_id": None,
    },
    "strip": {
        "width": 800,
        "background": "#ffffff",
        "margin": 24,
        "text_direction": "horizontal",
        "panel_boxes": {},
        "crops": {},
        "lettering": [],
        "height": 0,
        "manual": False,
        "rasterized": False,
    },
}
SUBMISSION_METADATA = {
    "episode": {"id", "series_id", "order", "created_at", "updated_at", "revision"},
    "panel": {"id"},
}


def submission_content(value, kind):
    """Normalize only documented defaults; retain all non-metadata content for equality."""
    if not isinstance(value, dict):
        raise ValueError("invalid storyboard content")
    result = {**SUBMISSION_DEFAULTS[kind], **value}
    for key in SUBMISSION_METADATA.get(kind, ()):
        result.pop(key, None)
    if kind == "episode":
        result["panels"] = [submission_content(panel, "panel") for panel in result["panels"]]
        result["strip"] = submission_content(result["strip"], "strip")
    elif kind == "panel":
        result["overrides"] = submission_content(result["overrides"], "overrides")
        result["dialogues"] = [submission_content(row, "dialogue") for row in result["dialogues"]]
    return result


def matches_submission(expected, actual) -> bool:
    try:
        return submission_content(expected, "episode") == submission_content(actual, "episode")
    except (TypeError, ValueError):
        return False


def stage_key(receipt: dict, original_key: str, stage: str) -> str:
    """Preserve possibly submitted v1 keys; hash the full intent and stage for new keys."""
    if receipt["version"] == 1:
        if stage == "generation":
            return original_key
        legacy = f"{original_key}.{stage}"
        if len(legacy) <= 160:
            return legacy
        # An overlong v1 export key was rejected before submission, so it is safe to replace.
    digest = hashlib.sha256(
        json.dumps([receipt["fingerprint"], stage], ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return f"mio.markdown.v2.{stage}.{digest}"


def create_or_reconcile(client, board, receipt, path, bind_storyboard):
    if receipt.get("storyboard_id"):
        if bind_storyboard and bind_storyboard != receipt["storyboard_id"]:
            raise ValueError("the receipt already refers to another storyboard")
        return
    if bind_storyboard:
        if receipt.get("creation") != "pending":
            raise ValueError("explicit binding requires a pending creation receipt")
        existing = client.get_storyboard(bind_storyboard)
        if not matches_submission(board, existing):
            raise ValueError("the chosen storyboard does not match this Markdown submission")
        receipt.update(storyboard_id=bind_storyboard, creation="bound")
        save_receipt(path, receipt)
        return
    if receipt.get("creation") == "pending":
        raise CreationPendingError()
    # The pending marker must be durable before the first request that can create a resource.
    receipt["creation"] = "pending"
    save_receipt(path, receipt)
    try:
        created = client.create_storyboard(board)
    except (MioError, TimeoutError, OSError):
        raise CreationPendingError() from None
    identifier = created.get("id")
    if not isinstance(identifier, str) or not identifier:
        raise CreationPendingError()
    receipt.update(storyboard_id=identifier, creation="created")
    try:
        save_receipt(path, receipt)
    except OSError:
        raise CreationPendingError(identifier) from None


def run_album(
    client: MioClient,
    markdown: str,
    destination: str | Path,
    *,
    source: dict[str, str],
    idempotency_key: str,
    preset_ids: list[str] | None = None,
    adopt_first: bool = False,
    candidates: int = 1,
    timeout: float = 1800,
    poll: float = 2,
    bind_storyboard: str | None = None,
) -> dict:
    """Resume an identical intent; leave unadopted results for explicit human selection.

    The destination is dedicated to one command and must not be used by concurrent writers.
    Output files are created exclusively; subsequent runs verify their saved SHA256 values.
    Planning errors/timeouts never cause an automatic retry or a new idempotency key.
    """
    board = parse_markdown(markdown)
    if (
        len(source) != 1
        or not set(source) <= {"workflow_id", "profile_id", "cloud_channel"}
        or not all(isinstance(value, str) and value for value in source.values())
    ):
        raise ValueError("choose exactly one workflow, profile or cloud channel")
    if not isinstance(idempotency_key, str) or not 1 <= len(idempotency_key) <= 180:
        raise ValueError("idempotency_key must contain 1–180 characters")
    if not isinstance(candidates, int) or isinstance(candidates, bool) or not 1 <= candidates <= 16:
        raise ValueError("candidates must be between 1 and 16")
    if not math.isfinite(timeout) or timeout <= 0 or not math.isfinite(poll) or poll <= 0:
        raise ValueError("timeout and poll must be finite and positive")
    target = urllib.parse.urlsplit(client.base)
    if (
        target.scheme not in {"http", "https"}
        or not target.netloc
        or target.username
        or target.password
        or target.query
        or target.fragment
    ):
        raise ValueError(
            "the studio URL must not contain credentials, query parameters or fragments"
        )
    intent = {
        "board": board,
        "source": source,
        "preset_ids": list(preset_ids or []),
        "adopt_first": bool(adopt_first),
        "candidates": candidates,
        "studio": client.base,
        "idempotency_key": idempotency_key,
    }
    fingerprint = hashlib.sha256(
        json.dumps(intent, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    folder = Path(destination)
    folder.mkdir(parents=True, exist_ok=True)
    receipt_path = folder / "mio-automation.json"
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if receipt.get("fingerprint") != fingerprint:
            raise ValueError(
                "this destination belongs to another intent; use a new destination and key"
            )
        if receipt.get("version") not in (1, 2):
            raise ValueError("unsupported automation receipt version")
    else:
        if any((folder / f"album.{extension}").exists() for extension in ("html", "pdf")):
            raise FileExistsError("destination already contains an untracked album")
        receipt = {"version": 2, "fingerprint": fingerprint, "exports": {}}
    create_or_reconcile(client, board, receipt, receipt_path, bind_storyboard)
    task = client.generate_workshop_task(
        {
            "storyboard_id": receipt["storyboard_id"],
            **source,
            "title": board["title"],
            "preset_ids": list(preset_ids or []),
            "generation": {"candidates": candidates},
            "adopt_first": bool(adopt_first),
        },
        idempotency_key=stage_key(receipt, idempotency_key, "generation"),
        timeout=timeout,
        poll=poll,
    )
    receipt.update(
        episode_id=task["episode"]["id"], series_id=task["series"]["id"], job_id=task.get("job_id")
    )
    job = task.get("job")
    if task.get("start_error") or not job or job["state"] != "completed":
        receipt["status"] = "generation_incomplete"
        save_receipt(receipt_path, receipt)
        return receipt
    if not client.get_episode_deliverables(receipt["episode_id"])["ready"]:
        receipt["status"] = "awaiting_adoption"
        save_receipt(receipt_path, receipt)
        return receipt
    for extension in ("html", "pdf"):
        output = folder / f"album.{extension}"
        recorded = receipt["exports"].get(extension)
        if recorded:
            if not output.is_file() or file_sha256(output) != recorded:
                raise FileExistsError(
                    "a recorded export is missing or changed; existing files were preserved"
                )
            continue
        client.save_episode_deliverable(
            receipt["episode_id"],
            output,
            format=extension,
            template_id="export-monograph" if extension == "html" else None,
            idempotency_key=stage_key(receipt, idempotency_key, extension),
            timeout=timeout,
            poll=poll,
        )
        receipt["exports"][extension] = file_sha256(output)
        save_receipt(receipt_path, receipt)
    receipt["status"] = "completed"
    save_receipt(receipt_path, receipt)
    return receipt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("markdown", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--idempotency-key", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8788")
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--workflow")
    choice.add_argument("--profile")
    choice.add_argument("--channel")
    parser.add_argument("--preset", action="append", default=[])
    parser.add_argument("--adopt-first", action="store_true")
    parser.add_argument("--candidates", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=1800)
    parser.add_argument(
        "--bind-storyboard",
        help="Explicitly reconcile an uncertain creation with its existing storyboard ID",
    )
    args = parser.parse_args(argv)
    token = os.environ.get("MIO_TOKEN", "")
    if not token:
        parser.error("set MIO_TOKEN in the environment; tokens are never command-line arguments")
    source = next(
        {field: value}
        for field, value in (
            ("workflow_id", args.workflow),
            ("profile_id", args.profile),
            ("cloud_channel", args.channel),
        )
        if value is not None
    )
    try:
        result = run_album(
            MioClient(args.base_url, token=token),
            args.markdown.read_text(encoding="utf-8"),
            args.out,
            source=source,
            idempotency_key=args.idempotency_key,
            preset_ids=args.preset,
            adopt_first=args.adopt_first,
            candidates=args.candidates,
            timeout=args.timeout,
            bind_storyboard=args.bind_storyboard,
        )
    except CreationPendingError as exc:
        print(
            json.dumps(
                {
                    "status": "creation_pending",
                    "storyboard_id": exc.storyboard_id,
                    "action": "inspect the studio; resume with --bind-storyboard EXISTING_ID after checking the source",
                }
            )
        )
        return 1
    except (MioError, TimeoutError, ValueError, OSError) as exc:
        print(
            json.dumps(
                {
                    "status": "stopped",
                    "error": type(exc).__name__,
                    "retry": "review the saved receipt and studio job; reuse the same key after resolving",
                }
            )
        )
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return (
        0
        if result["status"] == "completed"
        else 2
        if result["status"] == "awaiting_adoption"
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
