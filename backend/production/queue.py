"""Explicit, durable assembly queue. No network operation occurs during assembly.

Every task the creator starts runs in its own runner, so several books can render
at the same time; inside a book, up to ``concurrency`` pages are in flight at once
(per task, defaulting to the queue-wide value, adjustable while the book runs).
「按顺序开始生成」puts books into a *lane* that executes them one after another.

A pause (global or per task) drains the calls already in flight and dispatches
nothing new; a cancel discards late results. Neither operation pretends to undo
provider billing. Restart never silently resumes provider calls.
"""

import copy
import hashlib
import json
import os
import re
from pathlib import Path
import threading
import time
import uuid
from backend.ecosystem.storage import Storage, owned
from backend.mio_jobs import acquire_lease
from backend.providers.reliability import (
    failure_summary,
    fatal_page_failure,
    result_unconfirmed,
)
from backend.providers.request_evidence import safe_error_text
from .store import TaskStore
from backend.mio_library import LibraryError

TERMINAL = {"complete", "failed", "cancelled", "interrupted"}
# Consecutive page failures that turn a page-local problem into a stopped book.
FAILURE_STREAK_LIMIT = 3
# Technical guard rails only: the creator decides how much load the hardware
# and the provider can take. One in-flight page costs one waiting thread.
MAX_PAGE_CONCURRENCY = 128
MAX_TASKS = 1000
# Source kinds a task may follow live instead of keeping its assembly-time
# snapshot. Every switch is independent and off by default: an untouched
# queue behaves exactly as before (frozen books).
LIVE_SYNC_KEYS = ("story", "presets", "workflow")
# Authoring fields of one scene the creator may rewrite inside a task.
FRAME_FIELDS = ("name", "prompt", "negative", "caption")
DEFAULT_CONTROL = {
    "order": [], "paused": True, "lane": [], "concurrency": 1,
    "liveSync": {key: False for key in LIVE_SYNC_KEYS},
}


def normalize_live_sync(value):
    """Three independent booleans; anything malformed falls back to「frozen」."""
    raw = value if isinstance(value, dict) else {}
    return {key: raw.get(key) is True for key in LIVE_SYNC_KEYS}


def clamp_concurrency(value, *, allow_none=False):
    """Validate a page-concurrency value: 1..MAX, or None meaning「跟随全局」."""
    if value is None and allow_none:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if type(value) is not int or isinstance(value, bool) or not 1 <= value <= MAX_PAGE_CONCURRENCY:
        raise LibraryError("分幕并发需为 1–" + str(MAX_PAGE_CONCURRENCY) + " 的整数")
    return value


class ProductionQueue:
    def __init__(self, root, prepare, render, publish=lambda *_: None, finalize=lambda *_: None,
                 emit=lambda *_: None, retry_policy=lambda *_: None, refresh=None):
        self.tasks = TaskStore(Path(root) / "production/tasks")
        self.state = Storage(Path(root) / "production/control")
        self.prepare = prepare
        self.render = render
        self.publish = publish
        # Live sync (opt-in per source kind): called right before a page renders
        # with (book, index, enabled_kinds, cancel); returns None when the book
        # still matches its sources, else {"snapshot", "prepared"?, "notices"?}.
        self.refresh = refresh
        # Platform notifications (queue.*, task.*, page.failed). Never raises.
        self.emit = emit
        # Page-failure intervention: returns {"retry": True, "delay": s} to re-run
        # the same page (bounded), or None to record the failure.
        self.retry_policy = retry_policy
        # Called once with the finished task (any terminal status) so the
        # adapter can settle album status without another render.
        self.finalize = finalize
        self.lock = threading.RLock()
        # Runners and page workers sleep on this condition; every state change
        # that may unblock a dispatch notifies it.
        self.cond = threading.Condition(self.lock)
        # Album publication reads and writes a revisioned document; concurrent
        # pages of one book must not race on it.
        self.publish_lock = threading.Lock()
        self.wake = threading.Event()
        self.closed = False
        # id -> {"thread", "cancel", "task", "lane"} for every running book.
        self.runners = {}
        self.lane_active = None
        self.fault = None
        self.unclean_shutdown = False
        folder = owned(Path(root), "production")
        folder.mkdir(parents=True, exist_ok=True)
        try:
            self.lease = acquire_lease(folder)
        except OSError as exc:
            raise LibraryError(
                "此数据目录已有生产调度器，请关闭另一个实例", 409
            ) from exc
        try:
            self.control = self.state.get("queue", copy.deepcopy(DEFAULT_CONTROL))
            self._migrate_control()
            # Restart never silently resumes provider calls, even when a lane was saved.
            saved_lane = list(self.control.get("lane", []))
            safe_lane = []
            self.control["paused"] = True
            for id in saved_lane:
                if id in self.control["order"]:
                    task = self.tasks.get(id)
                    if (
                        task
                        and task["status"] == "ready"
                        and not any(
                            p["state"] in ("running", "uncertain") for p in task["pages"]
                        )
                    ):
                        if id not in safe_lane:
                            safe_lane.append(id)
            for id in self.control["order"]:
                if id in safe_lane:
                    continue
                task = self.tasks.get(id)
                if not task:
                    continue
                if task["status"] in ("preparing", "running", "ready"):
                    if (
                        id not in saved_lane
                        and task["status"] == "ready"
                        and not any(
                            p["state"] in ("running", "uncertain") for p in task["pages"]
                        )
                    ):
                        task["status"] = "standby"
                        task.pop("error", None)
                        self.tasks.set(id, task)
                    else:
                        task["status"] = "interrupted"
                        task["error"] = "服务中断。请先核对上游结果，再明确恢复。"
                        for frame in task["pages"]:
                            if frame["state"] == "running":
                                frame["state"] = "uncertain"
                        self.tasks.set(id, task)
            self.control["lane"] = safe_lane
            self._save_control()
            self.worker = threading.Thread(
                target=self._loop, daemon=True, name="mio-production"
            )
            self.worker.start()
        except Exception:
            self.lease.close()
            raise

    # ------------------------------------------------------------------ state
    def _migrate_control(self):
        """Older control files carried a single sequential ``batch``; it becomes the lane."""
        control = self.control
        legacy = control.pop("batch", None) or []
        control["lane"] = list(dict.fromkeys([*legacy, *control.get("lane", [])]))
        control.setdefault("order", [])
        control.setdefault("paused", True)
        try:
            control["concurrency"] = clamp_concurrency(control.get("concurrency", 1))
        except LibraryError:
            control["concurrency"] = 1
        control["liveSync"] = normalize_live_sync(control.get("liveSync"))

    def _storage_fault(self, exc):
        with self.lock:
            self.fault = str(exc)[:500]
            self.control.update(paused=True, lane=[])
            self._wake()

    def _wake(self):
        self.wake.set()
        with self.cond:
            self.cond.notify_all()

    def _save_control(self):
        try:
            self.state.set("queue", self.control)
        except Exception as exc:
            self._storage_fault(exc)
            raise

    def _save(self, task):
        task["updatedAt"] = time.time()
        try:
            self.tasks.set(task["id"], task)
        except Exception as exc:
            self._storage_fault(exc)
            raise

    @property
    def active(self):
        """IDs of the books currently running (any runner, lane or direct)."""
        with self.lock:
            return [id for id in self.control["order"] if id in self.runners]

    def busy(self):
        with self.lock:
            return bool(self.runners or self.control["lane"])

    def _live(self, id):
        """The in-memory copy a runner mutates, or the stored task when idle."""
        runner = self.runners.get(id)
        return runner["task"] if runner else None

    def get(self, id):
        with self.lock:
            task = self.tasks.get(id)
            if not task:
                raise LibraryError("生成任务不存在", 404)
            return task

    def effective_concurrency(self, task):
        own = task.get("concurrency")
        value = own if type(own) is int and 1 <= own <= MAX_PAGE_CONCURRENCY else self.control.get("concurrency", 1)
        return max(1, min(MAX_PAGE_CONCURRENCY, int(value or 1)))

    def list(self):
        with self.lock:
            tasks = [self.tasks.get(id, summary=True) for id in self.control["order"]]
            lane = list(self.control["lane"])
            running = [id for id in self.control["order"] if id in self.runners]
            return {
                "tasks": [
                    {
                        **{
                            k: v
                            for k, v in t.items()
                            if k
                            not in ("snapshot", "prepared", "requestId", "fingerprint")
                        },
                        "paused": bool(t.get("paused")),
                        "concurrency": t.get("concurrency"),
                        "effectiveConcurrency": self.effective_concurrency(t),
                        "running": t["id"] in self.runners,
                        "queued": t["id"] in lane,
                        "queuePosition": lane.index(t["id"]) + 1 if t["id"] in lane else None,
                        "sources": {
                            "story": t["snapshot"]["story"].get("title", ""),
                            "presets": [
                                p.get("title", "")
                                for p in t["snapshot"].get("presets", [])
                            ],
                            "channel": t["snapshot"]
                            .get("channel", {})
                            .get("title", ""),
                            "provider": t["snapshot"]
                            .get("channel", {})
                            .get("provider", ""),
                            "overrides": t["snapshot"].get("overrides") or None,
                            "projectId": t["snapshot"].get("projectId"),
                        },
                        "pages": [
                            {
                                **p,
                                "attempts": p["attempts"][-3:],
                                "attemptCount": p.get(
                                    "attemptCount", len(p["attempts"])
                                ),
                            }
                            for p in t["pages"]
                        ],
                    }
                    for t in tasks
                    if t
                ],
                "active": running,
                "lane": lane,
                # Compatibility with consumers of the former single-batch shape.
                "batch": [id for id in running if self.runners[id]["lane"]] + lane,
                "paused": self.control["paused"],
                "concurrency": self.control.get("concurrency", 1),
                "maxConcurrency": MAX_PAGE_CONCURRENCY,
                "liveSync": normalize_live_sync(self.control.get("liveSync")),
                "fault": self.fault,
                "uncleanShutdown": self.unclean_shutdown,
            }

    # --------------------------------------------------------------- assembly
    def assemble(self, snapshot, title, request_id, commit=True, concurrency=None, after=None):
        if not isinstance(title, str) or not title.strip() or len(title) > 150:
            raise LibraryError("请填写 1–150 字的画册名称")
        if not isinstance(snapshot, dict) or not isinstance(
            snapshot.get("story"), dict
        ):
            raise LibraryError("请选择分镜")
        frames = snapshot["story"].get("frames")
        if not isinstance(frames, list) or not 1 <= len(frames) <= 512:
            raise LibraryError("分镜需包含 1–512 幕")
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 120:
            raise LibraryError("缺少装配操作标识")
        concurrency = clamp_concurrency(concurrency, allow_none=True)
        encoded = json.dumps(snapshot, ensure_ascii=False, allow_nan=False)
        if len(encoded.encode()) > 16 * 1024 * 1024:
            raise LibraryError("装配快照超过 16 MiB")
        fingerprint = hashlib.sha256((title + encoded).encode()).hexdigest()
        with self.lock:
            if self.closed:
                raise LibraryError("调度器正在关闭，不再接受新任务", 503)
            for id in self.control["order"]:
                prior = self.tasks.get(id, summary=True)
                if prior and prior.get("requestId") == request_id:
                    if prior.get("fingerprint") != fingerprint:
                        raise LibraryError("操作标识已用于不同装配，请刷新后重试", 409)
                    return self.tasks.get(id)
            if len(self.control["order"]) >= MAX_TASKS:
                raise LibraryError("请先移除不再需要的任务记录（最多 " + str(MAX_TASKS) + " 项）")
            id = "assembly-" + uuid.uuid4().hex
            task = {
                "id": id,
                "albumId": "album_" + uuid.uuid4().hex,
                "title": title.strip(),
                "purpose": "preview" if snapshot.get("preview") else "album",
                "previewPresetId": snapshot.get("previewPresetId"),
                "requestId": request_id,
                "fingerprint": fingerprint,
                "snapshot": copy.deepcopy(snapshot),
                "status": "standby",
                "paused": False,
                "concurrency": concurrency,
                "pages": [
                    {"index": i, "state": "standby", "result": None, "attempts": []}
                    for i in range(len(frames))
                ],
                "selection": [],
                "prepared": None,
                "createdAt": time.time(),
                "updatedAt": time.time(),
            }
            self.tasks.set(id, task)
            if after in self.control["order"]:
                self.control["order"].insert(self.control["order"].index(after) + 1, id)
            else:
                self.control["order"].append(id)
            try:
                if commit:
                    self._save_control()
            except Exception:
                self.control["order"].remove(id)
                self.tasks.delete(id)
                raise
            self._notify("task.assembled", {"id": id, "title": task["title"], "albumId": task["albumId"], "pages": len(frames), "preview": task["purpose"] == "preview"})
            return copy.deepcopy(task)

    def _notify(self, name, payload):
        try:
            self.emit(name, payload)
        except Exception:
            pass

    def assemble_many(self, items):
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_TASKS:
            raise LibraryError("一次装配最多 " + str(MAX_TASKS) + " 项")
        with self.lock:
            before = copy.deepcopy(self.control)
            try:
                tasks = [
                    self.assemble(
                        item[0], item[1], item[2], commit=False,
                        concurrency=item[3] if len(item) > 3 else None,
                    )
                    for item in items
                ]
                self._save_control()
                return tasks
            except Exception:
                # Retain uncommitted objects for diagnostics; they are not schedulable.
                self.control = before
                if self.fault:
                    self.control.update(paused=True, lane=[])
                raise

    def clone(self, id, title=None, concurrency="source", transform=None):
        """A fresh standby copy of a task (same frozen snapshot, new album), placed right after it."""
        with self.lock:
            source = self.get(id)
            if not title:
                base = re.sub(r"\s*副本(?:\s*\d+)?$", "", source["title"]).strip() or source["title"]
                existing = 0
                for other in self.control["order"]:
                    record = self.tasks.get(other, summary=True)
                    if record and re.fullmatch(re.escape(base) + r"\s*副本(?:\s*\d+)?", record["title"]):
                        existing += 1
                title = base + " 副本" + ("" if existing == 0 else " " + str(existing + 1))
            snapshot = copy.deepcopy(source["snapshot"])
            if transform is not None:
                snapshot = transform(snapshot)
            task_concurrency = source.get("concurrency") if concurrency == "source" else concurrency
            task = self.assemble(
                snapshot,
                title,
                "clone-" + uuid.uuid4().hex,
                concurrency=task_concurrency,
                after=id,
            )
            self._notify("task.cloned", {"id": task["id"], "source": id, "title": task["title"]})
            return task

    # ------------------------------------------------------------- scheduling
    def _check_open(self):
        if self.closed:
            raise LibraryError("调度器正在关闭，不再接受新任务", 503)
        if self.fault:
            raise LibraryError("存储故障未恢复，请检查磁盘后重启服务", 503)

    def _selection(self, task, indices):
        if indices is None:
            return [p["index"] for p in task["pages"] if p["state"] != "complete"]
        if (
            not isinstance(indices, list)
            or not indices
            or any(
                type(i) is not int or i < 0 or i >= len(task["pages"])
                for i in indices
            )
            or len(set(indices)) != len(indices)
        ):
            raise LibraryError("重跑范围无效")
        return list(indices)

    def _assert_confirmed(self, task, selection, confirm_uncertain):
        if any(task["pages"][i]["state"] in ("running", "uncertain") for i in selection) and confirm_uncertain is not True:
            raise LibraryError("MIO-PROD-UNCERTAIN: 存在未确认结果，请先核对上游，并明确确认可能重复计费后再重跑", 409)

    def _arm(self, task, selection, *, force_prepare=False, lane=False, concurrency=None):
        """Mutate a validated task into the ready state for the given pages."""
        task["selection"] = selection
        task["status"] = "ready"
        task["paused"] = False
        task["runMode"] = "lane" if lane else "direct"
        task["forcePrepare"] = force_prepare is True
        if concurrency is not None:
            task["concurrency"] = concurrency
        if force_prepare:
            task["prepared"] = None
        task.pop("error", None)
        for i in selection:
            task["pages"][i]["state"] = "standby"
        self._save(task)

    def start(
        self, id, sequential=False, indices=None, trusted=False, force_prepare=False,
        confirm_uncertain=False, concurrency=None
    ):
        """Run one book now, in parallel with whatever else is running.

        ``sequential`` keeps the historic meaning for external callers: this book
        and every later unfinished book join the lane instead (see start_sequence).
        """
        if trusted is not True:
            raise LibraryError("请确认启动生成与可能产生的费用", 403)
        if sequential and indices is not None:
            raise LibraryError("重跑范围无效")
        with self.lock:
            self._check_open()
            if id not in self.control["order"]:
                raise LibraryError("任务不在队列中", 404)
            if sequential:
                start = self.control["order"].index(id)
                return self.start_sequence(self.control["order"][start:], trusted=True, confirm_uncertain=confirm_uncertain)
            if id in self.runners:
                raise LibraryError("此任务正在运行；可先暂停或停止它", 409)
            concurrency = clamp_concurrency(concurrency, allow_none=True)
            task = self.get(id)
            # Validate everything before mutating anything.
            selection = self._selection(task, indices)
            if not selection:
                raise LibraryError("该任务已全部完成，没有需要生成的分幕")
            self._assert_confirmed(task, selection, confirm_uncertain)
            if id in self.control["lane"]:
                self.control["lane"].remove(id)
            self._arm(task, selection, force_prepare=force_prepare, concurrency=concurrency)
            self._save_control()
            self._spawn(id, lane=False)
            self._notify("queue.started", {"batch": [id], "sequential": False, "indices": indices})
            return self.list()

    def start_many(self, ids, trusted=False, confirm_uncertain=False):
        """Start several books at once, each in its own runner."""
        if trusted is not True:
            raise LibraryError("请确认启动生成与可能产生的费用", 403)
        if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
            raise LibraryError("请选择要开始的任务")
        with self.lock:
            self._check_open()
            plan = []
            for id in dict.fromkeys(ids):
                if id not in self.control["order"] or id in self.runners:
                    continue
                task = self.get(id)
                selection = self._selection(task, None)
                if not selection:
                    continue
                self._assert_confirmed(task, selection, confirm_uncertain)
                plan.append((task, selection))
            if not plan:
                raise LibraryError("所选任务没有可以开始的分幕")
            for task, selection in plan:
                if task["id"] in self.control["lane"]:
                    self.control["lane"].remove(task["id"])
                self._arm(task, selection)
            self._save_control()
            for task, _ in plan:
                self._spawn(task["id"], lane=False)
            self._notify("queue.started", {"batch": [t["id"] for t, _ in plan], "sequential": False, "indices": None})
            return self.list()

    def start_sequence(self, ids=None, trusted=False, confirm_uncertain=False):
        """Queue books into the lane: they run one after another, top to bottom."""
        if trusted is not True:
            raise LibraryError("请确认启动生成与可能产生的费用", 403)
        if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, str) for i in ids)):
            raise LibraryError("请选择要顺次生成的任务")
        with self.lock:
            self._check_open()
            wanted = list(dict.fromkeys(ids)) if ids is not None else list(self.control["order"])
            plan = []
            for id in wanted:
                if id not in self.control["order"] or id in self.runners or id in self.control["lane"]:
                    continue
                task = self.get(id)
                if task["status"] == "complete":
                    continue
                selection = self._selection(task, None)
                if not selection:
                    continue
                self._assert_confirmed(task, selection, confirm_uncertain)
                plan.append((task, selection))
            if not plan:
                raise LibraryError("没有可以顺次生成的任务：请先装配，或等待运行中的任务结束")
            for task, selection in plan:
                self._arm(task, selection, lane=True)
            # The lane follows the visible order of the queue.
            self.control["lane"] = self._ordered([*self.control["lane"], *(t["id"] for t, _ in plan)])
            self.control["paused"] = False
            self._save_control()
            self._wake()
            self._notify("queue.started", {"batch": list(self.control["lane"]), "sequential": True, "indices": None})
            return self.list()

    def _ordered(self, ids):
        position = {id: i for i, id in enumerate(self.control["order"])}
        return sorted(dict.fromkeys(ids), key=lambda id: position.get(id, len(position)))

    def _spawn(self, id, lane):
        task = self.get(id)
        cancel = threading.Event()
        # ``sync`` serialises live-sync refreshes of one book so concurrent pages
        # never re-read (or re-prepare) the same change twice.
        runner = {"cancel": cancel, "task": task, "lane": lane, "thread": None, "sync": threading.Lock()}
        self.runners[id] = runner
        if lane:
            self.lane_active = id
        thread = threading.Thread(target=self._run, args=(id, cancel, lane), daemon=True, name="mio-production-" + id[-8:])
        runner["thread"] = thread
        thread.start()

    def pause(self, id=None, ids=None):
        """Global: hold every running or queued book and the lane itself.
        Per task: hold only that book's next pages. Calls already in flight finish."""
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            targets = self._targets(id, ids)
            if targets is None:
                self.control["paused"] = True
                for other in list(self.runners) + list(self.control["lane"]):
                    self._set_paused(other, True)
                self._save_control()
                self._notify("queue.paused", {"active": self.active})
            else:
                for target in targets:
                    self._set_paused(target, True)
                self._notify("task.paused", {"ids": targets})
            self._wake()
            return self.list()

    def resume(self, id=None, ids=None):
        """Global: release the lane and every held book. Per task: release that book only."""
        with self.lock:
            self._check_open()
            targets = self._targets(id, ids)
            if targets is None:
                self.control["paused"] = False
                for other in self.control["order"]:
                    self._set_paused(other, False, only_if_paused=True)
                self._save_control()
                self._notify("queue.resumed", {"batch": list(self.control["lane"])})
            else:
                for target in targets:
                    self._set_paused(target, False)
                self._notify("task.resumed", {"ids": targets})
            self._wake()
            return self.list()

    def _targets(self, id, ids):
        if ids is not None:
            if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
                raise LibraryError("请选择任务")
            return [i for i in dict.fromkeys(ids) if i in self.control["order"]]
        if id is not None:
            if id not in self.control["order"]:
                raise LibraryError("生成任务不存在", 404)
            return [id]
        return None

    def _set_paused(self, id, value, only_if_paused=False):
        task = self._live(id)
        if task is None:
            summary = self.tasks.get(id, summary=True)
            if not summary or bool(summary.get("paused")) == bool(value):
                return
            if value and id not in self.control["lane"]:
                # Only a running or queued book can be held; standby books have nothing to hold.
                return
            task = self.tasks.get(id)
        if not task or bool(task.get("paused")) == bool(value):
            return
        task["paused"] = bool(value)
        self._save(task)

    def cancel(self, id=None, ids=None):
        """Global: stop every runner and empty the lane. Per task: stop or de-queue that book only."""
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            targets = self._targets(id, ids)
            if targets is None:
                targets = list(dict.fromkeys(list(self.runners) + list(self.control["lane"])))
            for target in targets:
                runner = self.runners.get(target)
                if runner:
                    runner["cancel"].set()
                if target in self.control["lane"]:
                    self.control["lane"].remove(target)
                    waiting = self.get(target)
                    waiting["status"] = "standby"
                    waiting["selection"] = []
                    waiting["paused"] = False
                    self._save(waiting)
            self._save_control()
            self._wake()
            self._notify("queue.cancelled", {"active": self.active, "targets": targets})
            return self.list()

    def remove(self, id=None, ids=None, on_remove=None):
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            targets = self._targets(id, ids)
            if targets is None:
                raise LibraryError("请选择要移除的任务")
            if len(targets) == 1 and (targets[0] in self.runners or targets[0] in self.control["lane"]):
                raise LibraryError("任务正在运行或排队中，请先停止它", 409)
            removable = [t for t in targets if t not in self.runners and t not in self.control["lane"]]
            if not removable:
                raise LibraryError("所选任务都在运行或排队中，请先停止它们", 409)
            removed_tasks = []
            for target in removable:
                t = self.tasks.get(target, summary=True)
                if t:
                    removed_tasks.append(t)
            self.control["order"] = [i for i in self.control["order"] if i not in removable]
            self._save_control()
            for target in removable:
                self.tasks.delete(target)
            result = self.list()
            result["removedTaskIds"] = removable
            if on_remove and removed_tasks:
                extra = on_remove(removed_tasks)
                if isinstance(extra, dict):
                    result.update(extra)
            return result

    def clear_finished(self):
        """Drop every fully completed task record; albums are untouched."""
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            done = []
            for id in self.control["order"]:
                if id in self.runners or id in self.control["lane"]:
                    continue
                task = self.tasks.get(id, summary=True)
                if task and task["status"] == "complete":
                    done.append(id)
            if done:
                self.control["order"] = [i for i in self.control["order"] if i not in done]
                self._save_control()
                for id in done:
                    self.tasks.delete(id)
            result = self.list()
            result["removed"] = len(done)
            return result

    def reorder(self, order):
        """Persist a new display order; the lane follows it."""
        if not isinstance(order, list) or not all(isinstance(i, str) for i in order):
            raise LibraryError("排序无效")
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            if len(set(order)) != len(order) or set(order) != set(self.control["order"]):
                raise LibraryError("排序与当前队列不一致，请刷新后重试", 409)
            self.control["order"] = list(order)
            self.control["lane"] = self._ordered(self.control["lane"])
            self._save_control()
            return self.list()

    def set_concurrency(self, value, id=None):
        """Queue-wide default (id None) or one task's own limit (value None → follow default)."""
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            if id is None:
                self.control["concurrency"] = clamp_concurrency(value)
                self._save_control()
            else:
                if id not in self.control["order"]:
                    raise LibraryError("生成任务不存在", 404)
                task = self._live(id) or self.get(id)
                task["concurrency"] = clamp_concurrency(value, allow_none=True)
                self._save(task)
            self._wake()
            return self.list()

    def set_live_sync(self, values):
        """Switch live reading of storyboard / presets / workflow on or off, each on its own.

        Applies from the next page that starts, running books included; nothing in flight
        is interrupted and a switched-off kind simply keeps whatever snapshot the task holds.
        """
        if not isinstance(values, dict) or not values or set(values) - set(LIVE_SYNC_KEYS):
            raise LibraryError("实时读取设置无效：只能设置 story、presets、workflow")
        if any(not isinstance(v, bool) for v in values.values()):
            raise LibraryError("实时读取设置需为布尔值")
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            current = normalize_live_sync(self.control.get("liveSync"))
            current.update(values)
            self.control["liveSync"] = current
            self._save_control()
            self._notify("queue.liveSync", dict(current))
            return self.list()

    def rename(self, id, title):
        """Rename a task card. An album already published under the old name keeps it."""
        if not isinstance(title, str) or not title.strip() or len(title) > 150:
            raise LibraryError("请填写 1–150 字的任务名称")
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            if id not in self.control["order"]:
                raise LibraryError("生成任务不存在", 404)
            task = self._live(id) or self.get(id)
            previous = task["title"]
            task["title"] = title.strip()
            runner = self.runners.get(id)
            if runner and runner.get("frozen"):
                runner["frozen"]["title"] = task["title"]
            self._save(task)
            self._notify("task.renamed", {"id": id, "title": task["title"], "previous": previous})
            return self.list()

    def update_frame(self, id, index, fields):
        """Rewrite one scene's authoring text inside the task's own snapshot.

        Allowed while the book runs: the change reaches every page that has not started
        yet (each page copies the book when it begins). The page being rendered right now
        is refused instead of silently racing the provider call.
        """
        if not isinstance(fields, dict) or not fields or set(fields) - set(FRAME_FIELDS):
            raise LibraryError("分幕字段无效：只能修改名称、提示词、负向提示词与台词")
        for key, value in fields.items():
            if value is not None and (not isinstance(value, str) or len(value) > 100000):
                raise LibraryError("分幕文本格式无效或超过 100,000 字")
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            if id not in self.control["order"]:
                raise LibraryError("生成任务不存在", 404)
            task = self._live(id) or self.get(id)
            frames = task["snapshot"]["story"].get("frames") or []
            if type(index) is not int or isinstance(index, bool) or not 0 <= index < len(frames):
                raise LibraryError("分幕索引无效")
            if task["pages"][index]["state"] == "running":
                raise LibraryError("这一幕正在生成中，请等它结束后再修改", 409)
            runner = self.runners.get(id)
            targets = [frames[index]]
            if runner and runner.get("frozen"):
                shadow = runner["frozen"]["snapshot"]["story"].get("frames") or []
                if index < len(shadow):
                    targets.append(shadow[index])
            for frame in targets:
                for key, value in fields.items():
                    if key == "name":
                        cleaned = value.strip() if isinstance(value, str) else ""
                        frame["name"] = cleaned or frame.get("name") or "第 " + str(index + 1) + " 幕"
                    else:
                        frame[key] = value or ""
            self._save(task)
            self._notify("task.frameEdited", {"id": id, "index": index, "fields": sorted(fields)})
            return self.list()

    def recover_publication(self, id, index):
        """Retry a durable result without another provider call. Publisher is idempotent."""
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            if self.fault:
                raise LibraryError("请先处理存储故障", 409)
            if id in self.runners or id in self.control["lane"]:
                raise LibraryError("任务正在运行或排队中，请先停止它", 409)
            task = self.get(id)
            if type(index) is not int or not 0 <= index < len(task["pages"]):
                raise LibraryError("分幕索引无效")
            page = task["pages"][index]
            attempt = page["attempts"][-1] if page["attempts"] else {}
            if attempt.get("phase") != "publish" or not attempt.get("result"):
                raise LibraryError("没有可恢复的已生成结果")
            with self.publish_lock:
                self.publish(copy.deepcopy(task), index, attempt["result"])
            page["result"] = attempt["result"]
            page["state"] = "complete"
            attempt["status"] = "complete"
            attempt.pop("error", None)
            task["status"] = (
                "complete"
                if all(p["state"] == "complete" for p in task["pages"])
                else "partial"
            )
            task.pop("error", None)
            self._save(task)
            try:
                self.finalize(copy.deepcopy(task))
            except Exception:
                pass
            return self.list()

    # ------------------------------------------------------------- execution
    def _loop(self):
        try:
            self._run_loop()
        finally:
            if hasattr(self, "lease") and self.lease and not self.lease.closed:
                try:
                    if os.name == "nt":
                        import msvcrt

                        self.lease.seek(0)
                        msvcrt.locking(self.lease.fileno(), msvcrt.LK_UNLCK, 1)
                except Exception:
                    pass
                finally:
                    self.lease.close()

    def _run_loop(self):
        """The lane dispatcher: one lane book at a time, only while nothing holds the lane.

        On shutdown it outlives every runner, so the directory lease is held until
        the last provider call has really returned (see close()).
        """
        try:
            self._dispatch_lane()
        finally:
            while True:
                with self.lock:
                    threads = [r["thread"] for r in self.runners.values() if r["thread"]]
                if not threads:
                    break
                for thread in threads:
                    thread.join()

    def _dispatch_lane(self):
        while not self.closed:
            self.wake.wait(0.2)
            self.wake.clear()
            with self.lock:
                if (
                    self.closed
                    or self.fault
                    or self.control["paused"]
                    or self.lane_active is not None
                    or not self.control["lane"]
                ):
                    continue
                candidate_id = None
                i = 0
                while i < len(self.control["lane"]):
                    id = self.control["lane"][i]
                    try:
                        task = self.tasks.get(id)
                    except Exception:
                        task = None
                    if not task or id in self.runners or task["status"] != "ready":
                        self.control["lane"].pop(i)
                        try:
                            self._save_control()
                        except Exception:
                            pass
                        continue
                    if not task.get("paused"):
                        candidate_id = self.control["lane"].pop(i)
                        try:
                            self._save_control()
                        except Exception:
                            pass
                        break
                    i += 1
                if candidate_id is not None:
                    self._spawn(candidate_id, lane=True)

    def report_attempt(self, id, index, fields):
        """Provider progress updates the same in-memory attempt that will be committed."""
        with self.lock:
            task = self._live(id)
            if not task or not task["pages"][index]["attempts"]:
                return
            attempt = task["pages"][index]["attempts"][-1]
            for key in ("upstream", "cancelReport", "rateLimit"):
                if key in fields:
                    attempt[key] = copy.deepcopy(fields[key])
                    if key != "upstream":
                        task[key] = copy.deepcopy(fields[key])
            # Non-fatal, page-local advisories (e.g. reference images a
            # text-to-image workflow cannot consume) stay with the attempt.
            if isinstance(fields.get("notice"), str) and fields["notice"].strip():
                notices = attempt.setdefault("notices", [])
                if fields["notice"] not in notices:
                    notices.append(fields["notice"][:500])
            self._save(task)

    def _run(self, id, cancel, lane):
        try:
            self._execute(id, cancel, lane)
        except Exception as exc:
            with self.lock:
                # Disk errors are not converted into implicit retries.
                self.fault = str(exc)[:500]
                self.control.update(paused=True, lane=[])
            self._notify("queue.fault", {"error": self.fault})
        finally:
            with self.lock:
                self.runners.pop(id, None)
                if self.lane_active == id:
                    self.lane_active = None
                try:
                    self._save_control()
                except Exception as exc:
                    self.fault = str(exc)[:500]
                    self.control["paused"] = True
                self._wake()

    def _may_dispatch(self, task, cancel):
        # The queue-wide hold is expressed through each book's own ``paused``
        # flag (see pause()); the control flag itself only holds the lane, so a
        # book the creator starts explicitly during a hold really runs.
        return not (self.closed or self.fault or cancel.is_set() or task.get("paused"))

    def _execute(self, id, cancel, lane):
        with self.lock:
            task = self.runners[id]["task"]
        failures = []
        fatal = None
        try:
            if task["prepared"] is None:
                with self.lock:
                    task["status"] = "preparing"
                    self._save(task)
                with self.lock:
                    request = copy.deepcopy(task)
                prepared = self.prepare(request, cancel)
                if cancel.is_set():
                    raise InterruptedError("已取消；上游已收到的请求可能仍计费")
                with self.lock:
                    task["prepared"] = prepared
                    # Preparation notices (e.g. blanked variables) belong on the card, not only in the prepared blob.
                    notices = prepared.get("notices") if isinstance(prepared, dict) else None
                    if notices:
                        task["notices"] = list(notices)
                    else:
                        task.pop("notices", None)
                    self._save(task)
            with self.lock:
                task["status"] = "running"
                task.pop("error", None)
                self._save(task)
                # Render and publish see a frozen book; page bookkeeping lives on ``task``.
                # The freeze is only ever read or amended under the queue lock (see
                # _page_request, update_frame, rename).
                frozen = copy.deepcopy(task)
                self.runners[id]["frozen"] = frozen
            self._notify("task.started", {"id": id, "title": task["title"], "albumId": task["albumId"], "selection": list(task["selection"])})
            failures, fatal = self._run_pages(task, frozen, cancel)
            with self.lock:
                task["status"] = (
                    "complete"
                    if all(p["state"] == "complete" for p in task["pages"])
                    else "partial"
                )
                if failures:
                    if not any(p["state"] == "complete" for p in task["pages"]):
                        task["status"] = "failed"
                    task["error"] = self._failure_report(task, failures, fatal)
            if fatal is not None and lane:
                # A systemic failure stops the sequence rather than skipping
                # into another paid book with the same broken setup.
                self._halt_lane()
        except Exception as exc:
            with self.lock:
                task["status"] = (
                    "cancelled"
                    if cancel.is_set()
                    else ("interrupted" if isinstance(exc, InterruptedError) else "failed")
                )
                task["error"] = failure_summary(safe_error_text(str(exc)), terminal=True)
            # A book that could not even start (preparation failed) stops the sequence;
            # stopping one book by hand leaves the rest of the lane alone.
            if lane and not cancel.is_set():
                self._halt_lane()
        finally:
            with self.lock:
                task["paused"] = False
                task.pop("runMode", None)
                self._save(task)
                settled = copy.deepcopy(task)
            try:
                self.finalize(settled)
            except Exception:
                pass
            self._notify("task.finished", {"id": id, "title": task["title"], "albumId": task["albumId"], "status": task["status"], "error": task.get("error")})

    def _run_pages(self, task, frozen, cancel):
        """Dispatch the selected pages with a live, per-task concurrency limit.

        Returns (failures, fatal). Raises InterruptedError once a cancel, an
        unconfirmed result or a shutdown stops the book; pages still in flight
        are always drained first so their outcome is recorded (never re-billed
        silently). Extension hooks run without holding the queue lock.
        """
        pending = list(task["selection"])
        retry_at = {}
        retries = {}
        in_flight = {}
        outbox = []
        failures = []
        streak = 0
        fatal = None
        interrupt = None
        while True:
            with self.cond:
                now = time.time()
                if interrupt is None and fatal is None:
                    to_start = []
                    while pending and (len(in_flight) + len(to_start)) < self.effective_concurrency(task) and self._may_dispatch(task, cancel):
                        index = next((i for i in pending if retry_at.get(i, 0) <= now), None)
                        if index is None:
                            break
                        pending.remove(index)
                        page = task["pages"][index]
                        attempt = {
                            "id": uuid.uuid4().hex,
                            "startedAt": time.time(),
                            "status": "running",
                        }
                        page["attempts"].append(attempt)
                        page["state"] = "running"
                        worker = threading.Thread(
                            target=self._run_page,
                            args=(task, frozen, index, attempt, cancel, outbox),
                            daemon=True,
                            name="mio-page-" + str(index),
                        )
                        to_start.append((index, worker))
                    if to_start:
                        self._save(task)
                        for index, worker in to_start:
                            in_flight[index] = worker
                            worker.start()
                if interrupt is None and (cancel.is_set() or self.closed):
                    interrupt = InterruptedError(
                        "已取消后续分幕，原有图片保留" if cancel.is_set() else "服务正在关闭，已停止后续分幕，原有图片保留"
                    )
                done = outbox.pop(0) if outbox else None
                if done is not None:
                    in_flight.pop(done[0], None)
                elif in_flight:
                    self.cond.wait(0.1)
                    continue
                elif interrupt is not None:
                    raise interrupt
                elif fatal is not None or not pending:
                    return failures, fatal
                elif self.fault:
                    raise RuntimeError(self.fault)
                else:
                    # Held (paused) or waiting for a retry delay: nothing in flight, nothing dispatchable yet.
                    delays = [retry_at[i] - now for i in pending if retry_at.get(i, 0) > now]
                    if delays and len(delays) == len(pending) and self._may_dispatch(task, cancel):
                        self.cond.wait(max(0.01, min(min(delays), 0.5)))
                    else:
                        self.cond.wait(0.1)
                    continue
            index, attempt, exc = done
            if exc is None:
                streak = 0
                continue
            if isinstance(exc, InterruptedError) or cancel.is_set():
                # A cancel, or a result the provider could not confirm: stop the
                # book here; the creator reconciles upstream before anything reruns.
                # The page's own error stays the book's error: it says more than「已取消」.
                if interrupt is None or not isinstance(exc, InterruptedError):
                    interrupt = exc
                continue
            decision = self._retry_decision(task, index, attempt, retries.get(index, 0), fatal_page_failure(exc) or attempt.get("phase") == "publish")
            with self.lock:
                if decision:
                    retries[index] = retries.get(index, 0) + 1
                    task["pages"][index]["state"] = "standby"
                    self._save(task)
                    retry_at[index] = time.time() + decision["delay"]
                    pending.insert(0, index)
                    continue
                failures.append((index, attempt["error"]))
                streak += 1
                # Publication failures are local storage problems: rendering
                # more pages that cannot be saved would only pay twice.
                if (
                    attempt.get("phase") == "publish"
                    or fatal_page_failure(exc)
                    or streak >= FAILURE_STREAK_LIMIT
                ):
                    fatal = exc

    def _page_request(self, task, frozen, index, cancel):
        """The book this page renders against.

        Frozen kinds come from the start-time copy; kinds the creator switched to live
        reading are re-read against the current sources first. A replaced snapshot
        becomes the new baseline for the pages that follow and for later starts.
        """
        with self.lock:
            enabled = {k: v for k, v in normalize_live_sync(self.control.get("liveSync")).items() if v}
            if not enabled or self.refresh is None or frozen["snapshot"].get("preview"):
                return copy.deepcopy(frozen)
            runner = self.runners.get(task["id"])
            gate = runner["sync"] if runner else threading.Lock()
        with gate:
            with self.lock:
                book = copy.deepcopy(frozen)
            outcome = self.refresh(book, index, enabled, cancel)
            if cancel.is_set():
                raise InterruptedError("分幕提交前已取消")
            if not isinstance(outcome, dict):
                return book
            with self.lock:
                for key in ("snapshot", "prepared"):
                    if key in outcome:
                        book[key] = outcome[key]
                        frozen[key] = copy.deepcopy(outcome[key])
                        task[key] = copy.deepcopy(outcome[key])
                notices = [n for n in outcome.get("notices") or [] if isinstance(n, str) and n.strip()]
                if notices:
                    existing = task.setdefault("notices", [])
                    for notice in notices:
                        if notice not in existing:
                            existing.append(notice[:500])
                    del existing[:-6]
                self._save(task)
        return book

    def _run_page(self, task, frozen, index, attempt, cancel, outbox):
        page = task["pages"][index]
        exc_out = None
        try:
            book = self._page_request(task, frozen, index, cancel)
            result = self.render(copy.deepcopy(book), index, cancel)
            if cancel.is_set():
                raise InterruptedError(
                    "结果返回前已取消；未替换原图，可能已计费"
                )
            # Preserve result before publishing; a failed publication is not a reason to re-render.
            with self.lock:
                attempt.update(
                    status="rendered",
                    phase="publish",
                    result=result,
                    finishedAt=time.time(),
                )
                self._save(task)
            with self.publish_lock:
                self.publish(copy.deepcopy(book), index, result)
            if cancel.is_set():
                raise InterruptedError(
                    "发布阶段收到取消，请核对画册；不会自动重发"
                )
            with self.lock:
                page["result"] = result
                page["state"] = "complete"
                attempt["status"] = "complete"
                self._save(task)
        except Exception as exc:
            exc_out = exc
            uncertain = cancel.is_set() or isinstance(exc, InterruptedError) or (
                attempt.get("phase") != "publish"
                and result_unconfirmed(exc, attempt.get("upstream"))
            )
            with self.lock:
                attempt.update(
                    status="uncertain" if uncertain else "failed",
                    error=failure_summary(safe_error_text(str(exc)), terminal=True),
                    rawError=safe_error_text(str(exc))[:16384],
                    finishedAt=time.time(),
                )
                page["state"] = "uncertain" if uncertain else "failed"
                try:
                    self._save(task)
                except Exception:
                    pass
        finally:
            with self.cond:
                outbox.append((index, attempt, exc_out))
                self.cond.notify_all()

    def _retry_decision(self, task, index, attempt, done, fatal):
        """Ask the platform whether a page-local failure should be retried (max 3)."""
        payload = {"task": {"id": task["id"], "title": task["title"], "albumId": task["albumId"]}, "index": index,
                   "error": attempt.get("error"), "attempt": done + 1, "fatal": bool(fatal)}
        self._notify("page.failed", payload)
        if done >= 3 or fatal:
            return None
        try:
            decision = self.retry_policy(payload)
        except Exception:
            return None
        if not isinstance(decision, dict) or decision.get("retry") is not True:
            return None
        delay = decision.get("delay", 0)
        return {"delay": max(0.0, min(600.0, float(delay if isinstance(delay, (int, float)) else 0)))}

    def _halt_lane(self):
        with self.lock:
            for other in self.control["lane"]:
                waiting = self.tasks.get(other)
                if not waiting:
                    continue
                waiting["status"] = "standby"
                waiting["selection"] = []
                waiting["paused"] = False
                self._save(waiting)
            self.control["lane"] = []

    @staticmethod
    def _failure_report(task, failures, fatal):
        total = len(task["selection"])
        remaining = [
            i for i in task["selection"]
            if task["pages"][i]["state"] not in ("complete", "failed", "uncertain")
        ]
        first = failures[0][1]
        text = str(len(failures)) + "/" + str(total) + " 幕失败：" + first
        if fatal is not None and remaining:
            # The first error says why; the tail says what happened to the rest and how to go on.
            text += "\n已停止：其余 " + str(len(remaining)) + " 幕没有发出。修好后点“开始生成”，会接着生成未完成的分幕。"
        return text

    def close(self, timeout=30):
        """Stop dispatch, cancel cooperatively, and wait without unlocking a live worker.

        False means shutdown is still draining; the worker owns and releases the
        lease in _loop's finally block. Repeated close calls can wait again.
        """
        with self.lock:
            self.closed = True
            runners = list(self.runners.values())
            for runner in runners:
                runner["cancel"].set()
            self.control["paused"] = True
            self._wake()
        deadline = time.monotonic() + timeout
        for runner in runners:
            thread = runner["thread"]
            if thread and thread is not threading.current_thread():
                thread.join(timeout=max(0.0, deadline - time.monotonic()))
        if threading.current_thread() is not self.worker:
            self.worker.join(timeout=max(0.0, deadline - time.monotonic()))
        self.unclean_shutdown = self.worker.is_alive() or any(
            r["thread"] and r["thread"].is_alive() for r in runners
        )
        return not self.unclean_shutdown
