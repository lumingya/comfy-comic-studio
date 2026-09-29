"""装配队列 on the server (legacy production queue).

The workshop queue lists every draft album as a task card.  This module keeps what the legacy
server kept so it survives reloads and does not depend on an open page:

* ``order`` — the card order (drag to reorder); albums not listed follow, oldest first;
* ``lane`` — 「按顺序开始生成」: albums started one after another.  When the job of the album the
  lane started ends (finished, failed, stopped, held for review, or auto-paused after repeated
  failures) the next album starts; a manual pause holds the lane like 全局暂停;
* ``concurrency`` — the default number of panels an album renders at once.  Albums may set their
  own (``Series.concurrency``); a change reaches running jobs from their next panel.

The lane never invents work: an album with every panel already in the album is skipped, and an
album that cannot start (deleted, no panels, a render error) gets a notice and is skipped.
"""

from __future__ import annotations

import logging
import shutil
import threading
from pathlib import Path

from .jobs import JobNotFound
from .models import Series, WorkshopQueue
from .storage import NotFound

log = logging.getLogger("mio.queue")

RENDER_KIND = "comfy.render"
ACTIVE = ("queued", "running", "paused", "blocked")
# Free disk space below which the queue warns, and below which the lane stops starting albums.
LOW_DISK = 500 * 1024 * 1024
CRITICAL_DISK = 200 * 1024 * 1024


def load_queue(store) -> WorkshopQueue:
    try:
        doc = store.get_doc("workshop_queue", "queue")
    except NotFound:
        return WorkshopQueue()
    assert isinstance(doc, WorkshopQueue)
    return doc


def default_window(store, series: Series) -> int | None:
    """The panel concurrency for a render of ``series``: its own, else the queue default for
    albums waiting in the queue (drafts); None = the engine's automatic window."""
    if series.concurrency:
        return series.concurrency
    if series.status == "draft":
        return load_queue(store).concurrency
    return None


def lane_finished(job: dict | None) -> bool:
    """The lane moves on once the job needs nothing more from the scheduler."""
    if job is None:
        return True
    if job["state"] in ("completed", "failed", "canceled", "blocked"):
        return True
    # Auto-paused after the failure limit (error set) ≠ a pause the user asked for.
    return job["state"] == "paused" and bool(job.get("error"))


class ProductionQueue:
    def __init__(self, store, engine, render, data_dir: str | Path, autostart: bool = True):
        self.store = store
        self.engine = engine
        self.render = render
        self.data_dir = Path(data_dir)
        self.lock = threading.RLock()
        self.kick = threading.Event()
        self.closed = False
        self._active_job = load_queue(store).active_job
        self._unsubscribe = engine.subscribe(self._on_event)
        self.thread = threading.Thread(target=self._loop, name="mio-queue", daemon=True)
        if autostart:
            self.thread.start()

    # ------------------------------------------------------------------ lifecycle
    def close(self) -> None:
        self.closed = True
        self.kick.set()
        self._unsubscribe()
        if self.thread.is_alive():
            self.thread.join(timeout=2)

    def _on_event(self, event: dict) -> None:
        if event.get("job_id") == self._active_job and event.get("idx") is None:
            self.kick.set()

    def _loop(self) -> None:
        while not self.closed:
            self.kick.wait(5)
            self.kick.clear()
            if self.closed:
                break
            try:
                self.advance()
            except Exception:  # never let the lane thread die
                log.exception("queue advance failed")

    # ------------------------------------------------------------------ state
    def state(self) -> WorkshopQueue:
        return load_queue(self.store)

    def _save(self, q: WorkshopQueue) -> WorkshopQueue:
        self._active_job = q.active_job
        return self.store.put_doc(q)

    def fault(self) -> str | None:
        """A storage warning for the queue page (legacy 存储异常横幅)."""
        try:
            free = shutil.disk_usage(self.data_dir).free
        except OSError as exc:
            return f"无法读取数据目录：{exc}"
        if free < LOW_DISK:
            mb = free // (1024 * 1024)
            held = "，已暂停启动后续任务" if free < CRITICAL_DISK else ""
            return f"数据目录所在磁盘只剩 {mb} MB{held}。请清理磁盘后继续。"
        return None

    def _disk_critical(self) -> bool:
        try:
            return shutil.disk_usage(self.data_dir).free < CRITICAL_DISK
        except OSError:
            return True

    # ------------------------------------------------------------------ commands
    def start(self, album_ids: list[str]) -> WorkshopQueue:
        """Queue albums behind the lane (in the given order) and release a held lane."""
        with self.lock:
            q = self.state()
            for album_id in album_ids:
                if album_id not in q.lane and album_id != q.active:
                    q.lane.append(album_id)
                q.notices.pop(album_id, None)
            q.paused = False
            self._save(q)
        return self.advance()

    def remove(self, album_id: str) -> WorkshopQueue:
        """移出队列: the album no longer waits in the lane (a started job is not touched)."""
        with self.lock:
            q = self.state()
            q.lane = [a for a in q.lane if a != album_id]
            return self._save(q)

    def hold(self, paused: bool) -> WorkshopQueue:
        with self.lock:
            q = self.state()
            q.paused = paused
            self._save(q)
        return self.advance() if not paused else self.state()

    def clear(self) -> WorkshopQueue:
        """停止全部: the lane is emptied (the caller stops the jobs themselves)."""
        with self.lock:
            q = self.state()
            q.lane, q.active, q.active_job, q.paused = [], None, None, False
            return self._save(q)

    def set_order(self, album_ids: list[str]) -> WorkshopQueue:
        with self.lock:
            q = self.state()
            seen: set[str] = set()
            q.order = [a for a in album_ids if not (a in seen or seen.add(a))]
            # The lane follows the card order, as it did in the legacy queue.
            rank = {a: i for i, a in enumerate(q.order)}
            q.lane.sort(key=lambda a: rank.get(a, len(rank)))
            return self._save(q)

    def set_concurrency(self, value: int | None) -> WorkshopQueue:
        with self.lock:
            q = self.state()
            q.concurrency = value
            q = self._save(q)
        for series in self.store.list_series():
            if series.kind == "album" and series.status == "draft" and not series.concurrency:
                self.retune(series)
        return q

    def retune(self, series: Series) -> None:
        """Apply the album's concurrency to its running render jobs (from their next panel)."""
        window = default_window(self.store, series) or self.render.auto_window()
        for episode in self.store.list_episodes(series.id):
            for job in self.engine.list(owner=episode.id, active_only=True):
                if job["kind"] == RENDER_KIND and job["window"] != window:
                    self.engine.set_window(job["id"], window)

    def track(self, album_id: str) -> None:
        """A new album (assembled, cloned, 试绘) takes the last card.  Albums the order does not
        know yet (made before the queue kept one) are listed first, oldest first."""
        with self.lock:
            q = self.state()
            if album_id in q.order:
                return
            known = set(q.order) | {album_id}
            older = sorted(
                (
                    s
                    for s in self.store.list_series()
                    if s.kind == "album" and s.status == "draft" and s.id not in known
                ),
                key=lambda s: (s.created_at, s.id),
            )
            q.order = [*q.order, *(s.id for s in older), album_id]
            self._save(q)

    def forget(self, album_id: str) -> None:
        """An album left the queue (trashed, moved to the shelf)."""
        with self.lock:
            q = self.state()
            if album_id in q.lane or album_id in q.order or album_id in q.notices:
                q.lane = [a for a in q.lane if a != album_id]
                q.order = [a for a in q.order if a != album_id]
                q.notices.pop(album_id, None)
                self._save(q)

    # ------------------------------------------------------------------ the lane
    def advance(self) -> WorkshopQueue:
        with self.lock:
            q = self.state()
            if q.active_job:
                try:
                    job = self.engine.get(q.active_job, items=False)
                except JobNotFound:
                    job = None
                if not lane_finished(job):
                    return q
                q.active, q.active_job = None, None
            if q.paused or not q.lane or self._disk_critical():
                return self._save(q)
            while q.lane:
                album_id = q.lane.pop(0)
                try:
                    job = self._start_album(album_id)
                except Exception as exc:  # the album is skipped; the card says why
                    log.info("queue: %s not started: %s", album_id, exc)
                    q.notices[album_id] = str(exc) or exc.__class__.__name__
                    continue
                if job is None:
                    continue
                q.active, q.active_job = album_id, job["id"]
                break
            return self._save(q)

    def _start_album(self, album_id: str) -> dict | None:
        series = self.store.get_series(album_id)
        if series.deleted_at or series.kind != "album":
            return None
        episodes = self.store.list_episodes(album_id)
        if not episodes:
            raise ValueError("这本画册没有分幕")
        episode = episodes[0]
        adopted = {t.panel_id for t in episode.takes if t.status == "adopted" and not t.variant_id}
        missing = [p.id for p in episode.ordered_panels() if p.id not in adopted]
        if not missing:
            return None
        return self.render.render(episode.id, missing, None, 1, None, adopt_first=True)
