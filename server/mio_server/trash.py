"""回收站: soft delete, restore, purge and expiry for series and episodes.

Deleting only sets ``deleted_at``; nothing is lost until the item is purged by hand or it has
been in the trash longer than ``AppSettings.trash_days``.  Restoring an episode whose order slot
was reused moves it to the end of the series instead of failing.
"""

from __future__ import annotations

from contextlib import contextmanager, nullcontext
from datetime import datetime, timedelta, timezone

from .jobs.types import JobConflict
from .models import now_iso
from .storage import Conflict, NotFound


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


class Trash:
    def __init__(self, store, engine=None):
        self.store = store
        self.engine = engine

    @contextmanager
    def _guard(self, kind: str, item_id: str):
        if self.engine is None:
            yield
            return
        with self.engine.hold_operation():
            owners = {item_id}
            if kind == "series":
                episodes = self.store._rows(
                    "SELECT id FROM episodes WHERE series_id = ?", (item_id,)
                )
                owners.update(episode["id"] for episode in episodes)
            elif kind == "episode":
                owners.add(self.store.get_episode(item_id, include_deleted=True).series_id)
            with self.engine.operation_guard(owners):
                yield

    # ----------------------------------------------------------------- series
    def delete_series(self, series_id: str) -> None:
        def mark(series):
            series.deleted_at = now_iso()

        with self._guard("series", series_id):
            self.store.update_series(series_id, mark)

    def restore_series(self, series_id: str) -> None:
        with self._restore_guard():
            self._restore_series(series_id)

    @contextmanager
    def _restore_guard(self):
        operation = self.engine.hold_operation() if self.engine is not None else nullcontext()
        with operation, self.store.tx():
            yield

    def _restore_series(self, series_id: str) -> None:
        series = self.store.get_series(series_id, include_deleted=True)
        if not series.deleted_at:
            return
        series.deleted_at = None
        self.store.save_series(series)

    # ---------------------------------------------------------------- episode
    def delete_episode(self, episode_id: str) -> None:
        def mark(ep):
            ep.deleted_at = now_iso()

        with self._guard("episode", episode_id):
            self.store.update_episode(episode_id, mark)

    def restore_episode(self, episode_id: str) -> dict:
        with self._restore_guard():
            return self._restore_episode(episode_id)

    def _restore_episode(self, episode_id: str) -> dict:
        ep = self.store.get_episode(episode_id, include_deleted=True)
        self.store.get_series(ep.series_id)  # a trashed series must be restored first
        moved = False

        def unmark(e):
            nonlocal moved
            e.deleted_at = None

        try:
            self.store.update_episode(episode_id, unmark, include_deleted=True)
        except Conflict:
            order = self.store.next_episode_order(ep.series_id)

            def unmark_moved(e):
                e.deleted_at = None
                e.order = order

            self.store.update_episode(episode_id, unmark_moved, include_deleted=True)
            moved = True
        return {"id": episode_id, "moved_to_end": moved}

    # ------------------------------------------------------------------ views
    def list(self) -> dict:
        series = [
            {"kind": "series", "id": s.id, "title": s.title, "deleted_at": s.deleted_at}
            for s in self.store.list_series(deleted=True)
        ]
        episodes = []
        for s in self.store.list_series() + self.store.list_series(deleted=True):
            for e in self.store.list_episodes(s.id, deleted=True):
                episodes.append(
                    {
                        "kind": "episode",
                        "id": e.id,
                        "title": e.title,
                        "series_id": s.id,
                        "series_title": s.title,
                        "deleted_at": e.deleted_at,
                        "panels": len(e.panels),
                    }
                )
        items = series + episodes
        items.sort(key=lambda x: x["deleted_at"] or "", reverse=True)
        return {"items": items}

    def purge(self, kind: str, item_id: str) -> None:
        with self._guard(kind, item_id):
            with self.store.tx():
                self._purge(kind, item_id)

    def _purge(self, kind: str, item_id: str) -> None:
        if kind == "series":
            series = self.store.get_series(item_id, include_deleted=True)
            if not series.deleted_at:
                raise Conflict("只能彻底删除回收站里的作品")
            self.store.delete_series(item_id)
        elif kind == "episode":
            ep = self.store.get_episode(item_id, include_deleted=True)
            if not ep.deleted_at:
                raise Conflict("只能彻底删除回收站里的分话")
            self.store.delete_episode(item_id)
        else:
            raise NotFound(f"unknown trash kind: {kind}")

    def expire(self, days: int, now: datetime | None = None) -> int:
        """Purge everything deleted more than ``days`` ago; returns the number of items."""
        limit = (now or datetime.now(timezone.utc)) - timedelta(days=days)
        purged = 0
        for item in self.list()["items"]:
            if item["deleted_at"] and _parse(item["deleted_at"]) < limit:
                try:
                    self.purge(item["kind"], item["id"])
                    purged += 1
                except (NotFound, JobConflict):
                    pass  # Missing or busy work is retried by a later expiry pass.
        return purged
