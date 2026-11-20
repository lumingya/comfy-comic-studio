"""Core schema validation and deterministic workspace heads, without executing imported SQL."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path

from ..assets import MIME_EXT
from ..checkpoints.models import Checkpoint
from ..checkpoints.service import head_of
from ..checkpoints.validation import assets_for
from ..jobs.executors import ExecutorRef
from ..jobs.types import ITEM_STATES
from ..jobs.types import SCHEMA as JOB_SCHEMA
from ..models import Episode, Series
from ..render_models import Asset
from ..storage import DOC_KINDS, SCHEMA, SCHEMA_VERSION

STORE_COLUMNS = {
    "meta": "key value",
    "series": "id title subtitle status created_at updated_at deleted_at payload_json",
    "episodes": "id series_id title episode_order panel_count created_at updated_at deleted_at payload_json",
    "documents": "kind id name updated_at payload_json",
    "assets": "id mime size width height source filename created_at",
    "episode_snapshots": "episode_id revision created_at payload_json",
    "assembly_receipts": "idempotency_key request_sha series_id episode_id",
    "workshop_launch_receipts": "episode_id job_id",
    "delivery_receipts": "delivery_id episode_id result_sha value_json created_at",
    "work_checkpoints": "id series_id created_at summary_json payload_json",
    "kit_receipts": "key sha result_json",
}
JOB_COLUMNS = {
    "job_executor_bindings": "job_id kind source digest",
    "jobs": "id kind title state idempotency_key snapshot_json snapshot_sha window priority failure_limit paused blocked canceled owner error created updated",
    "job_items": "job_id idx state resource group_key instances label input_json updated epoch attempts sent upstream instance_id started finished error_json result_json",
    "job_events": "seq job_id idx type data_json at",
    "job_deliveries": "job_id idx attempt state result_sha result_json created updated error",
    "state_leases": "endpoint token job_id idx epoch base_url data_json",
}
OPTIONAL = {"work_checkpoints", "kit_receipts", "workshop_launch_receipts", "sqlite_sequence"}


def readonly(path: Path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA trusted_schema = OFF")
    return db


def tables(db) -> set[str]:
    return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def validate_schema(db, expected) -> None:
    if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise ValueError("backup database integrity check failed")
    reference = sqlite3.connect(":memory:")
    try:
        reference.executescript(SCHEMA if expected is STORE_COLUMNS else JOB_SCHEMA)
        if expected is STORE_COLUMNS:
            reference.executescript(
                "CREATE TABLE work_checkpoints (id TEXT PRIMARY KEY, series_id TEXT NOT NULL, "
                "created_at TEXT NOT NULL, summary_json TEXT NOT NULL, payload_json TEXT NOT NULL);"
                "CREATE INDEX idx_work_checkpoints_series ON work_checkpoints(series_id, created_at DESC);"
                "CREATE TABLE kit_receipts (key TEXT PRIMARY KEY, sha TEXT NOT NULL, result_json TEXT NOT NULL);"
            )
        known = {
            (row[0], row[1]): re.sub(r"\s+", "", row[2] or "").lower()
            for row in reference.execute("SELECT type, name, sql FROM sqlite_master")
        }
    finally:
        reference.close()
    for kind, name, sql in db.execute("SELECT type, name, sql FROM sqlite_master"):
        if (kind, name) not in known or known[kind, name] != re.sub(r"\s+", "", sql or "").lower():
            raise ValueError("backup database contains executable or unsupported schema")
    actual = tables(db)
    if actual - set(expected) - OPTIONAL or set(expected) - OPTIONAL - actual:
        raise ValueError("backup database schema is not supported by this version")
    for table in actual - {"sqlite_sequence"}:
        if table not in expected:
            raise ValueError("backup database contains an unsupported table")
        columns = {row[1] for row in db.execute(f'PRAGMA table_info("{table}")')}
        if columns != set(expected[table].split()):
            raise ValueError(f"backup database has unsupported columns: {table}")
    if db.execute("PRAGMA foreign_key_check").fetchone():
        raise ValueError("backup database contains broken foreign keys")


def logical_head(store_db, jobs_db) -> str:
    digest = hashlib.sha256()
    for label, db in (("store", store_db), ("jobs", jobs_db)):
        for table in sorted(tables(db) - {"sqlite_sequence"}):
            if table not in (STORE_COLUMNS if label == "store" else JOB_COLUMNS):
                raise ValueError("workspace contains tables not supported by workspace backup")
            encoded = []
            cursor = db.execute(f'SELECT * FROM "{table}"')
            columns = [item[0] for item in cursor.description]
            for row in cursor:
                value = dict(zip(columns, row))
                for column in columns:
                    if column.endswith("_json") and value[column] is not None:
                        value[column] = json.loads(value[column])
                if table == "documents" and value["kind"] in {"api_token", "workshop_queue"}:
                    value.pop("updated_at", None)
                    value["payload_json"].pop("updated_at", None)
                    value["payload_json"].pop("last_used_at", None)
                encoded.append(
                    json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                )
            if encoded or table not in OPTIONAL:
                digest.update(f"{label}:{table}\n".encode())
                for value in sorted(encoded):
                    digest.update(value.encode())
                    digest.update(b"\n")
    return digest.hexdigest()


def validate_databases(store_db, jobs_db) -> tuple[dict, dict[str, Asset]]:
    validate_schema(store_db, STORE_COLUMNS)
    validate_schema(jobs_db, JOB_COLUMNS)
    version = store_db.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    if not version or int(version[0]) != SCHEMA_VERSION:
        raise ValueError("backup was made for a different workspace schema")
    references: set[str] = set()

    def walk(value, key=""):
        if isinstance(value, dict):
            for child_key, child in value.items():
                walk(child, child_key)
        elif isinstance(value, list):
            for child in value:
                walk(child, key)
        elif (
            isinstance(value, str)
            and value
            and key
            in {
                "asset_id",
                "cover_asset_id",
                "mask_asset_id",
                "$asset",
                "asset_ids",
            }
        ):
            if key != "$asset" or value not in {"__previous__", "__cloud_source__"}:
                references.add(value)

    for table, model in (("series", Series), ("episodes", Episode), ("episode_snapshots", Episode)):
        for row in store_db.execute(f"SELECT * FROM {table}"):
            raw = row["payload_json"]
            value = model.model_validate_json(raw)
            if table == "series" and (
                value.id != row["id"]
                or value.title != row["title"]
                or value.deleted_at != row["deleted_at"]
            ):
                raise ValueError("backup series indexes do not match their document")
            if table == "episodes" and (
                value.id != row["id"]
                or value.series_id != row["series_id"]
                or value.order != row["episode_order"]
                or value.deleted_at != row["deleted_at"]
            ):
                raise ValueError("backup episode indexes do not match their document")
            if table == "episode_snapshots" and (
                value.id != row["episode_id"] or value.revision != row["revision"]
            ):
                raise ValueError("backup history indexes do not match their document")
            walk(value.model_dump(mode="json"))
    for kind, identifier, raw in store_db.execute("SELECT kind, id, payload_json FROM documents"):
        if kind not in DOC_KINDS:
            raise ValueError("backup contains an unsupported document kind")
        value = DOC_KINDS[kind].model_validate_json(raw)
        if value.id != identifier:
            raise ValueError("backup document ID does not match its index")
        data = value.model_dump(mode="json")
        walk(data)
        if kind == "settings" and any(state.enabled for state in value.extensions.values()):
            raise ValueError("restored extensions must be disabled")
        if kind in {"instance", "webhook"} and value.enabled:
            raise ValueError("restored external connections must be disabled")
        if kind == "workshop_queue" and (not value.paused or value.active or value.active_job):
            raise ValueError("restored workshop queue must be paused")
    count = 0
    if "work_checkpoints" in tables(store_db):
        for (raw,) in store_db.execute("SELECT payload_json FROM work_checkpoints"):
            checkpoint = Checkpoint.model_validate_json(raw)
            if checkpoint.head != head_of(checkpoint.snapshot) or set(
                checkpoint.asset_ids
            ) != assets_for(checkpoint.snapshot):
                raise ValueError("backup contains a corrupt checkpoint")
            references.update(checkpoint.asset_ids)
            count += 1
    if jobs_db.execute(
        "SELECT 1 FROM job_items WHERE state IN ('pending','running','uncertain')"
    ).fetchone():
        raise ValueError("backup contains active or uncertain jobs")
    if (
        jobs_db.execute("SELECT 1 FROM job_deliveries WHERE state = 'pending'").fetchone()
        or jobs_db.execute("SELECT 1 FROM state_leases").fetchone()
    ):
        raise ValueError("backup contains unresolved results or endpoint state")
    if store_db.execute(
        "SELECT 1 FROM episodes WHERE deleted_at IS NULL GROUP BY series_id, episode_order HAVING COUNT(*) > 1"
    ).fetchone():
        raise ValueError("backup contains duplicate live episode orders")
    for (state,) in jobs_db.execute("SELECT DISTINCT state FROM job_items"):
        if state not in ITEM_STATES:
            raise ValueError("backup contains unknown job states")
    for row in jobs_db.execute(
        "SELECT b.kind, b.source, b.digest, j.kind AS job_kind "
        "FROM job_executor_bindings b JOIN jobs j ON j.id = b.job_id"
    ):
        ExecutorRef(kind=row["kind"], source=row["source"], digest=row["digest"])
        if row["kind"] != row["job_kind"]:
            raise ValueError("backup executor identity does not match its task kind")
    for table in ("jobs", "job_items", "job_deliveries"):
        columns = [
            col[1]
            for col in jobs_db.execute(f'PRAGMA table_info("{table}")')
            if col[1].endswith("_json")
        ]
        for column in columns:
            for (raw,) in jobs_db.execute(
                f'SELECT "{column}" FROM "{table}" WHERE "{column}" IS NOT NULL'
            ):
                walk(json.loads(raw))
    assets = {}
    for row in store_db.execute("SELECT * FROM assets"):
        asset = Asset.model_validate(dict(row))
        if not re.fullmatch(r"[0-9a-f]{64}", asset.id) or asset.size < 0:
            raise ValueError("backup contains an invalid asset")
        assets[f"assets/{asset.id[:2]}/{asset.id}.{MIME_EXT.get(asset.mime, 'bin')}"] = asset
    if not references <= {asset.id for asset in assets.values()}:
        raise ValueError("backup references missing asset metadata")
    return {
        "series_count": store_db.execute("SELECT COUNT(*) FROM series").fetchone()[0],
        "episode_count": store_db.execute("SELECT COUNT(*) FROM episodes").fetchone()[0],
        "asset_count": len(assets),
        "checkpoint_count": count,
        "job_count": jobs_db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0],
    }, assets
