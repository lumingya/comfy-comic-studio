"""SQLite persistence for the v3 domain model.

Series / episodes are canonical JSON documents with a few indexed columns; workflows, render
profiles and ComfyUI instances share a typed ``documents`` table; binary assets are content
addressed on disk (see :mod:`mio_server.assets`) with metadata here.

Every write goes through one re-entrant lock so API threads and job-engine threads can share a
store.  ``update_episode`` is the only way background work mutates an episode: it re-reads the
latest document inside the lock, so a finishing job never overwrites a concurrent user edit.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, TypeVar

from pydantic import BaseModel

from .models import Episode, Series, now_iso
from .render_models import Asset, ComfyInstance, RenderProfile, WorkflowDoc
from .settings import AppSettings

SCHEMA_VERSION = 2
DOC_KINDS: dict[str, type[BaseModel]] = {
    "workflow": WorkflowDoc,
    "profile": RenderProfile,
    "instance": ComfyInstance,
    "settings": AppSettings,
}
T = TypeVar("T", bound=BaseModel)


class StoreError(RuntimeError):
    pass


class NotFound(StoreError):
    pass


class Conflict(StoreError):
    pass


SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS series (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, payload_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_series_updated ON series(updated_at DESC);
CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    title TEXT NOT NULL, episode_order INTEGER NOT NULL, panel_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, payload_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id, episode_order);
CREATE TABLE IF NOT EXISTS documents (
    kind TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL, PRIMARY KEY(kind, id));
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER, height INTEGER,
    source TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
"""


class SQLiteStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.lock = threading.RLock()
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        if str(self.path) != ":memory:":
            self._conn.execute("PRAGMA journal_mode = WAL")
        self.migrate()

    def close(self) -> None:
        with self.lock:
            self._conn.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self.lock, self._conn:
            yield self._conn

    def _rows(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self._conn.execute(sql, args).fetchall()

    def migrate(self) -> None:
        with self.tx() as db:
            db.executescript(SCHEMA)
            for table, column, ddl in (
                ("series", "deleted_at", "TEXT"),
                ("episodes", "deleted_at", "TEXT"),
                ("episodes", "panel_count", "INTEGER NOT NULL DEFAULT 0"),
            ):
                existing = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
                if column not in existing:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
            # v1 had UNIQUE(series_id, episode_order); ordering is now validated in code so that
            # soft-deleted episodes do not block reuse of their slot.
            ddl = db.execute("SELECT sql FROM sqlite_master WHERE name = 'episodes'").fetchone()[0]
            if "UNIQUE(series_id, episode_order)" in ddl.replace("\n", " ").replace("  ", " "):
                db.execute("ALTER TABLE episodes RENAME TO episodes_v1")
                db.executescript(SCHEMA)
                db.execute("""INSERT INTO episodes(id, series_id, title, episode_order, panel_count, created_at,
                              updated_at, deleted_at, payload_json)
                              SELECT id, series_id, title, episode_order, panel_count, created_at, updated_at,
                              deleted_at, payload_json FROM episodes_v1""")
                db.execute("DROP TABLE episodes_v1")
            db.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )

    # ------------------------------------------------------------------ series
    def create_series(self, series: Series) -> Series:
        with self.tx() as db:
            db.execute(
                """INSERT INTO series(id, title, subtitle, status, created_at, updated_at, deleted_at, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    series.id,
                    series.title,
                    series.subtitle,
                    series.status.value,
                    series.created_at,
                    series.updated_at,
                    series.deleted_at,
                    series.model_dump_json(),
                ),
            )
        return series

    def get_series(self, series_id: str, include_deleted: bool = False) -> Series:
        rows = self._rows("SELECT payload_json FROM series WHERE id = ?", (series_id,))
        if not rows:
            raise NotFound(f"series not found: {series_id}")
        series = Series.model_validate_json(rows[0]["payload_json"])
        if series.deleted_at and not include_deleted:
            raise NotFound(f"series is in the trash: {series_id}")
        return series

    def list_series(self, deleted: bool = False) -> list[Series]:
        cond = "deleted_at IS NOT NULL" if deleted else "deleted_at IS NULL"
        rows = self._rows(
            f"SELECT payload_json FROM series WHERE {cond} ORDER BY updated_at DESC, id"
        )
        return [Series.model_validate_json(row["payload_json"]) for row in rows]

    def save_series(self, series: Series) -> Series:
        series.updated_at = now_iso()
        with self.tx() as db:
            cur = db.execute(
                """UPDATE series SET title = ?, subtitle = ?, status = ?, updated_at = ?, deleted_at = ?,
                   payload_json = ? WHERE id = ?""",
                (
                    series.title,
                    series.subtitle,
                    series.status.value,
                    series.updated_at,
                    series.deleted_at,
                    series.model_dump_json(),
                    series.id,
                ),
            )
        if cur.rowcount != 1:
            raise NotFound(f"series not found: {series.id}")
        return series

    def update_series(self, series_id: str, fn: Callable[[Series], None]) -> Series:
        with self.lock:
            series = self.get_series(series_id)
            fn(series)
            return self.save_series(Series.model_validate(series.model_dump()))

    def delete_series(self, series_id: str) -> None:
        """Hard delete (purge).  The API moves things to the trash first, see :mod:`trash`."""
        with self.tx() as db:
            cur = db.execute("DELETE FROM series WHERE id = ?", (series_id,))
        if cur.rowcount != 1:
            raise NotFound(f"series not found: {series_id}")

    # ---------------------------------------------------------------- episodes
    def _check_order(self, db, episode: Episode) -> None:
        clash = db.execute(
            "SELECT id FROM episodes WHERE series_id = ? AND episode_order = ? AND id != ? AND deleted_at IS NULL",
            (episode.series_id, episode.order, episode.id),
        ).fetchone()
        if clash and not episode.deleted_at:
            raise Conflict(f"episode order {episode.order} already used by {clash['id']}")

    def create_episode(self, episode: Episode) -> Episode:
        with self.tx() as db:
            self.get_series(episode.series_id)
            self._check_order(db, episode)
            db.execute(
                """INSERT INTO episodes(id, series_id, title, episode_order, panel_count, created_at, updated_at,
                   deleted_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    episode.id,
                    episode.series_id,
                    episode.title,
                    episode.order,
                    len(episode.panels),
                    episode.created_at,
                    episode.updated_at,
                    episode.deleted_at,
                    episode.model_dump_json(),
                ),
            )
        return episode

    def next_episode_order(self, series_id: str) -> int:
        rows = self._rows(
            "SELECT MAX(episode_order) AS m FROM episodes WHERE series_id = ? AND deleted_at IS NULL",
            (series_id,),
        )
        return 0 if rows[0]["m"] is None else rows[0]["m"] + 1

    def get_episode(self, episode_id: str, include_deleted: bool = False) -> Episode:
        rows = self._rows("SELECT payload_json FROM episodes WHERE id = ?", (episode_id,))
        if not rows:
            raise NotFound(f"episode not found: {episode_id}")
        episode = Episode.model_validate_json(rows[0]["payload_json"])
        if episode.deleted_at and not include_deleted:
            raise NotFound(f"episode is in the trash: {episode_id}")
        return episode

    def list_episodes(self, series_id: str, deleted: bool = False) -> list[Episode]:
        self.get_series(series_id, include_deleted=deleted)
        cond = "deleted_at IS NOT NULL" if deleted else "deleted_at IS NULL"
        rows = self._rows(
            f"SELECT payload_json FROM episodes WHERE series_id = ? AND {cond} "
            "ORDER BY episode_order, id",
            (series_id,),
        )
        return [Episode.model_validate_json(row["payload_json"]) for row in rows]

    def episode_summaries(
        self, series_id: str, offset: int = 0, limit: int = 50
    ) -> tuple[list[dict], int]:
        """Paged, payload-free listing: a series can hold any number of episodes."""
        self.get_series(series_id)
        total = self._rows(
            "SELECT COUNT(*) AS n FROM episodes WHERE series_id = ? AND deleted_at IS NULL",
            (series_id,),
        )[0]["n"]
        rows = self._rows(
            """SELECT id, series_id, title, episode_order, panel_count, created_at, updated_at FROM episodes
               WHERE series_id = ? AND deleted_at IS NULL ORDER BY episode_order, id LIMIT ? OFFSET ?""",
            (series_id, limit, offset),
        )
        items = [
            {
                "id": r["id"],
                "series_id": r["series_id"],
                "title": r["title"],
                "order": r["episode_order"],
                "panel_count": r["panel_count"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
        return items, total

    def save_episode(self, episode: Episode, expected_revision: int | None = None) -> Episode:
        with self.tx() as db:
            row = db.execute(
                "SELECT payload_json FROM episodes WHERE id = ?", (episode.id,)
            ).fetchone()
            if not row:
                raise NotFound(f"episode not found: {episode.id}")
            if expected_revision is not None:
                current = Episode.model_validate_json(row["payload_json"]).revision
                if current != expected_revision:
                    raise Conflict(
                        f"episode changed (revision {current}, expected {expected_revision})"
                    )
            self._check_order(db, episode)
            episode.updated_at = now_iso()
            episode.revision += 1
            db.execute(
                """UPDATE episodes SET title = ?, episode_order = ?, panel_count = ?, updated_at = ?, deleted_at = ?,
                   payload_json = ? WHERE id = ?""",
                (
                    episode.title,
                    episode.order,
                    len(episode.panels),
                    episode.updated_at,
                    episode.deleted_at,
                    episode.model_dump_json(),
                    episode.id,
                ),
            )
        return episode

    def update_episode(
        self,
        episode_id: str,
        fn: Callable[[Episode], object],
        expected_revision: int | None = None,
        include_deleted: bool = False,
    ) -> Episode:
        """Atomic read-modify-write.  ``fn`` mutates the episode in place; the result is re-validated."""
        with self.lock:
            episode = self.get_episode(episode_id, include_deleted=include_deleted)
            fn(episode)
            episode = Episode.model_validate(episode.model_dump())
            return self.save_episode(episode, expected_revision)

    def delete_episode(self, episode_id: str) -> None:
        with self.tx() as db:
            cur = db.execute("DELETE FROM episodes WHERE id = ?", (episode_id,))
        if cur.rowcount != 1:
            raise NotFound(f"episode not found: {episode_id}")

    # --------------------------------------------------------------- documents
    def put_doc(self, doc: T) -> T:
        kind = next(k for k, cls in DOC_KINDS.items() if isinstance(doc, cls))
        if hasattr(doc, "updated_at"):
            doc.updated_at = now_iso()
        name = getattr(doc, "name", "")
        with self.tx() as db:
            db.execute(
                """INSERT INTO documents(kind, id, name, updated_at, payload_json) VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(kind, id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at,
                   payload_json = excluded.payload_json""",
                (kind, doc.id, name, now_iso(), doc.model_dump_json()),
            )
        return doc

    def get_doc(self, kind: str, doc_id: str) -> BaseModel:
        rows = self._rows(
            "SELECT payload_json FROM documents WHERE kind = ? AND id = ?", (kind, doc_id)
        )
        if not rows:
            raise NotFound(f"{kind} not found: {doc_id}")
        return DOC_KINDS[kind].model_validate_json(rows[0]["payload_json"])

    def list_docs(self, kind: str) -> list[BaseModel]:
        rows = self._rows(
            "SELECT payload_json FROM documents WHERE kind = ? ORDER BY name, id", (kind,)
        )
        docs = [DOC_KINDS[kind].model_validate_json(r["payload_json"]) for r in rows]
        return [d for d in docs if not getattr(d, "deleted_at", None)]

    def delete_doc(self, kind: str, doc_id: str) -> None:
        with self.tx() as db:
            cur = db.execute("DELETE FROM documents WHERE kind = ? AND id = ?", (kind, doc_id))
        if cur.rowcount != 1:
            raise NotFound(f"{kind} not found: {doc_id}")

    # ------------------------------------------------------------------ assets
    def put_asset(self, asset: Asset) -> Asset:
        with self.tx() as db:
            db.execute(
                """INSERT OR IGNORE INTO assets(id, mime, size, width, height, source, filename, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    asset.id,
                    asset.mime,
                    asset.size,
                    asset.width,
                    asset.height,
                    asset.source,
                    asset.filename,
                    asset.created_at,
                ),
            )
        return self.get_asset(asset.id)

    def get_asset(self, asset_id: str) -> Asset:
        rows = self._rows("SELECT * FROM assets WHERE id = ?", (asset_id,))
        if not rows:
            raise NotFound(f"asset not found: {asset_id}")
        return Asset(**dict(rows[0]))

    def asset_ids(self) -> set[str]:
        return {r["id"] for r in self._rows("SELECT id FROM assets")}

    def forget_asset(self, asset_id: str) -> None:
        with self.tx() as db:
            db.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
