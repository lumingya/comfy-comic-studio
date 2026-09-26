"""SQLite persistence for the v3 domain model."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from .models import Episode, Series, now_iso

SCHEMA_VERSION = 2


class StoreError(RuntimeError):
    pass


class NotFound(StoreError):
    pass


class SQLiteStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        if self.path != Path(":memory:"):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self.migrate()

    def close(self) -> None:
        self._conn.close()

    def migrate(self) -> None:
        with self._conn:
            self._conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS series (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    subtitle TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT,
                    payload_json TEXT NOT NULL
                )"""
            )
            cols = {row[1] for row in self._conn.execute("PRAGMA table_info(series)").fetchall()}
            if "deleted_at" not in cols:
                self._conn.execute("ALTER TABLE series ADD COLUMN deleted_at TEXT")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_series_updated ON series(updated_at DESC)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_series_deleted ON series(deleted_at)")
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS episodes (
                    id TEXT PRIMARY KEY,
                    series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    episode_order INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    UNIQUE(series_id, episode_order)
                )"""
            )
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id, episode_order)")
            self._conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))

    def create_series(self, series: Series) -> Series:
        payload = series.model_dump_json()
        with self._conn:
            self._conn.execute(
                """INSERT INTO series(id, title, subtitle, status, created_at, updated_at, deleted_at, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?, NULL, ?)""",
                (series.id, series.title, series.subtitle, series.status.value, series.created_at, series.updated_at, payload),
            )
        return series

    def get_series(self, series_id: str, include_deleted: bool = False) -> Series:
        sql = "SELECT payload_json FROM series WHERE id = ?" + ("" if include_deleted else " AND deleted_at IS NULL")
        row = self._conn.execute(sql, (series_id,)).fetchone()
        if not row:
            raise NotFound(f"series not found: {series_id}")
        return Series.model_validate_json(row["payload_json"])

    def list_series(self, include_deleted: bool = False) -> list[Series]:
        sql = "SELECT payload_json FROM series" + ("" if include_deleted else " WHERE deleted_at IS NULL") + " ORDER BY updated_at DESC, id"
        return [Series.model_validate_json(row["payload_json"]) for row in self._conn.execute(sql).fetchall()]

    def list_deleted_series(self) -> list[Series]:
        rows = self._conn.execute("SELECT payload_json FROM series WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").fetchall()
        return [Series.model_validate_json(row["payload_json"]) for row in rows]

    def save_series(self, series: Series) -> Series:
        series.updated_at = now_iso()
        payload = series.model_dump_json()
        with self._conn:
            cur = self._conn.execute(
                """UPDATE series SET title = ?, subtitle = ?, status = ?, updated_at = ?, payload_json = ?
                   WHERE id = ? AND deleted_at IS NULL""",
                (series.title, series.subtitle, series.status.value, series.updated_at, payload, series.id),
            )
        if cur.rowcount != 1:
            raise NotFound(f"series not found: {series.id}")
        return series

    def delete_series(self, series_id: str, soft: bool = True) -> None:
        with self._conn:
            if soft:
                cur = self._conn.execute("UPDATE series SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL",
                                         (now_iso(), now_iso(), series_id))
            else:
                cur = self._conn.execute("DELETE FROM series WHERE id = ?", (series_id,))
        if cur.rowcount != 1:
            raise NotFound(f"series not found: {series_id}")

    def restore_series(self, series_id: str) -> Series:
        with self._conn:
            cur = self._conn.execute("UPDATE series SET deleted_at=NULL, updated_at=? WHERE id=? AND deleted_at IS NOT NULL",
                                     (now_iso(), series_id))
        if cur.rowcount != 1:
            raise NotFound(f"series not in trash: {series_id}")
        return self.get_series(series_id)

    def create_episode(self, episode: Episode) -> Episode:
        self.get_series(episode.series_id)
        payload = episode.model_dump_json()
        with self._conn:
            self._conn.execute(
                """INSERT INTO episodes(id, series_id, title, episode_order, created_at, updated_at, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (episode.id, episode.series_id, episode.title, episode.order, episode.created_at, episode.updated_at, payload),
            )
        return episode

    def get_episode(self, episode_id: str) -> Episode:
        row = self._conn.execute("SELECT payload_json FROM episodes WHERE id = ?", (episode_id,)).fetchone()
        if not row:
            raise NotFound(f"episode not found: {episode_id}")
        return Episode.model_validate_json(row["payload_json"])

    def list_episodes(self, series_id: str) -> list[Episode]:
        self.get_series(series_id)
        rows = self._conn.execute("SELECT payload_json FROM episodes WHERE series_id = ? ORDER BY episode_order, id", (series_id,)).fetchall()
        return [Episode.model_validate_json(row["payload_json"]) for row in rows]

    def save_episode(self, episode: Episode) -> Episode:
        episode.updated_at = now_iso()
        payload = episode.model_dump_json()
        with self._conn:
            cur = self._conn.execute(
                """UPDATE episodes SET title = ?, episode_order = ?, updated_at = ?, payload_json = ? WHERE id = ?""",
                (episode.title, episode.order, episode.updated_at, payload, episode.id),
            )
        if cur.rowcount != 1:
            raise NotFound(f"episode not found: {episode.id}")
        return episode
