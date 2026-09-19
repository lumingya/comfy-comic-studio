"""Explicit, durable assembly queue. No network operation occurs during assembly.

One book and one page are dispatched at a time. A batch freezes its task IDs at
start; new assemblies do not join it. A pause drains the current call, a cancel
discards its late result. Neither operation pretends to undo provider billing.
"""

import copy
import hashlib
import json
import os
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


class ProductionQueue:
    def __init__(self, root, prepare, render, publish=lambda *_: None, finalize=lambda *_: None):
        self.tasks = TaskStore(Path(root) / "production/tasks")
        self.state = Storage(Path(root) / "production/control")
        self.prepare = prepare
        self.render = render
        self.publish = publish
        # Called once with the finished task (any terminal status) so the
        # adapter can settle album status without another render.
        self.finalize = finalize
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.closed = False
        self.cancel_event = threading.Event()
        self.active = None
        self.active_task = None
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
            self.control = self.state.get(
                "queue", {"order": [], "batch": [], "paused": True}
            )
            # Restart never silently resumes provider calls, even when a batch was saved.
            saved_batch = list(self.control.get("batch", []))
            safe_batch = []
            self.control["paused"] = True
            for id in saved_batch:
                if id in self.control["order"]:
                    task = self.tasks.get(id)
                    if (
                        task
                        and task["status"] == "ready"
                        and not any(
                            p["state"] in ("running", "uncertain") for p in task["pages"]
                        )
                    ):
                        if id not in safe_batch:
                            safe_batch.append(id)
            for id in self.control["order"]:
                if id in safe_batch:
                    continue
                task = self.tasks.get(id)
                if not task:
                    continue
                if task["status"] in ("preparing", "running", "ready"):
                    if (
                        id not in saved_batch
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
            self.control["batch"] = safe_batch
            self._save_control()
            self.worker = threading.Thread(
                target=self._loop, daemon=True, name="mio-production"
            )
            self.worker.start()
        except Exception:
            self.lease.close()
            raise

    def _storage_fault(self, exc):
        with self.lock:
            self.fault = str(exc)[:500]
            self.control.update(paused=True, batch=[])
            self.wake.set()

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

    def get(self, id):
        with self.lock:
            task = self.tasks.get(id)
            if not task:
                raise LibraryError("生成任务不存在", 404)
            return task

    def list(self):
        with self.lock:
            tasks = [self.tasks.get(id, summary=True) for id in self.control["order"]]
            return {
                "tasks": [
                    {
                        **{
                            k: v
                            for k, v in t.items()
                            if k
                            not in ("snapshot", "prepared", "requestId", "fingerprint")
                        },
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
                "batch": list(self.control["batch"]),
                "paused": self.control["paused"],
                "active": self.active,
                "fault": self.fault,
                "uncleanShutdown": self.unclean_shutdown,
            }

    def assemble(self, snapshot, title, request_id, commit=True):
        if not isinstance(title, str) or not title.strip() or len(title) > 150:
            raise LibraryError("请填写 1–150 字的画册名称")
        if not isinstance(snapshot, dict) or not isinstance(
            snapshot.get("story"), dict
        ):
            raise LibraryError("请选择分镜资产")
        frames = snapshot["story"].get("frames")
        if not isinstance(frames, list) or not 1 <= len(frames) <= 512:
            raise LibraryError("分镜需包含 1–512 幕")
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 120:
            raise LibraryError("缺少装配操作标识")
        encoded = json.dumps(snapshot, ensure_ascii=False, allow_nan=False)
        if len(encoded.encode()) > 1024 * 1024:
            raise LibraryError("装配快照超过 1 MiB")
        fingerprint = hashlib.sha256((title + encoded).encode()).hexdigest()
        with self.lock:
            if self.closed:
                raise LibraryError("调度器正在关闭，不再接受新任务", 503)
            for id in self.control["order"]:
                prior = self.tasks.get(id)
                if prior and prior["requestId"] == request_id:
                    if prior["fingerprint"] != fingerprint:
                        raise LibraryError("操作标识已用于不同装配，请刷新后重试", 409)
                    return prior
            if len(self.control["order"]) >= 200:
                raise LibraryError("请先移除不再需要的任务记录（最多 200 项）")
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
            self.control["order"].append(id)
            try:
                if commit:
                    self._save_control()
            except Exception:
                self.control["order"].remove(id)
                self.tasks.delete(id)
                raise
            return copy.deepcopy(task)

    def assemble_many(self, items):
        if not isinstance(items, list) or not 1 <= len(items) <= 100:
            raise LibraryError("一次装配最多 100 项")
        with self.lock:
            before = copy.deepcopy(self.control)
            try:
                tasks = [self.assemble(*item, commit=False) for item in items]
                self._save_control()
                return tasks
            except Exception:
                # Retain uncommitted objects for diagnostics; they are not schedulable.
                self.control = before
                if self.fault:
                    self.control.update(paused=True, batch=[])
                raise

    def start(
        self, id, sequential=False, indices=None, trusted=False, force_prepare=False, confirm_uncertain=False
    ):
        if trusted is not True:
            raise LibraryError("请确认启动生成与可能产生的费用", 403)
        with self.lock:
            if self.closed:
                raise LibraryError("调度器正在关闭，不再接受新任务", 503)
            if self.active or self.control["batch"]:
                raise LibraryError("请先暂停并取消当前批次，再启动新的运行范围", 409)
            if self.fault:
                raise LibraryError("存储故障未恢复，请检查磁盘后重启服务", 503)
            task = self.get(id)
            if id not in self.control["order"]:
                raise LibraryError("任务不在队列中", 404)
            ids = (
                self.control["order"][self.control["order"].index(id) :]
                if sequential
                else [id]
            )
            if sequential:
                ids = [i for i in ids if self.get(i)["status"] != "complete"]
            if indices is not None:
                if (
                    sequential
                    or not isinstance(indices, list)
                    or not indices
                    or any(
                        type(i) is not int or i < 0 or i >= len(task["pages"])
                        for i in indices
                    )
                    or len(set(indices)) != len(indices)
                ):
                    raise LibraryError("重跑范围无效")
            # Validate the entire batch before mutating any task.
            for selected in ids:
                item = self.get(selected)
                selection = indices if indices is not None else [p["index"] for p in item["pages"] if p["state"] != "complete"]
                if any(item["pages"][i]["state"] in ("running", "uncertain") for i in selection) and confirm_uncertain is not True:
                    raise LibraryError("MIO-PROD-UNCERTAIN: 存在未确认结果，请先核对上游，并明确确认可能重复计费后再重跑", 409)
            for selected in ids:
                item = self.get(selected)
                selection = (
                    list(indices)
                    if indices is not None
                    else [p["index"] for p in item["pages"] if p["state"] != "complete"]
                )
                if not selection:
                    continue
                item["selection"] = selection
                item["status"] = "ready"
                item["forcePrepare"] = force_prepare is True
                if force_prepare:
                    item["prepared"] = None
                item.pop("error", None)
                for i in selection:
                    item["pages"][i]["state"] = "standby"
                self._save(item)
            ids = [i for i in ids if self.get(i)["status"] == "ready"]
            self.control.update(batch=ids, paused=False)
            self.cancel_event = threading.Event()
            self._save_control()
            self.wake.set()
            return self.list()

    def pause(self):
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            self.control["paused"] = True
            self._save_control()
            return self.list()

    def resume(self):
        with self.lock:
            if self.closed:
                raise LibraryError("调度器正在关闭，不再接受新任务", 503)
            if self.fault:
                raise LibraryError("存储故障，请检查磁盘后重启服务", 503)
            self.control["paused"] = False
            self._save_control()
            self.wake.set()
            return self.list()

    def cancel(self):
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            self.cancel_event.set()
            for id in self.control["batch"]:
                if id == self.active:
                    continue
                task = self.get(id)
                task["status"] = "standby"
                task["selection"] = []
                self._save(task)
            self.control.update(batch=[], paused=True)
            self._save_control()
            self.wake.set()
            return self.list()

    def remove(self, id):
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            if id == self.active or id in self.control["batch"]:
                raise LibraryError("请先取消任务所在批次", 409)
            self.control["order"] = [i for i in self.control["order"] if i != id]
            self._save_control()
            self.tasks.delete(id)
            return self.list()

    def recover_publication(self, id, index):
        """Retry a durable result without another provider call. Publisher is idempotent."""
        with self.lock:
            if self.closed:
                raise LibraryError("MIO-PROD-CLOSED: 调度器已关闭，不再接受修改", 503)
            if self.active or self.control["batch"] or self.fault:
                raise LibraryError("请先停止当前批次并处理存储故障", 409)
            task = self.get(id)
            if type(index) is not int or not 0 <= index < len(task["pages"]):
                raise LibraryError("分幕索引无效")
            page = task["pages"][index]
            attempt = page["attempts"][-1] if page["attempts"] else {}
            if attempt.get("phase") != "publish" or not attempt.get("result"):
                raise LibraryError("没有可恢复的已生成结果")
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
            return self.list()

    def _await_dispatch(self, cancel):
        while not self.closed and not cancel.is_set():
            with self.lock:
                if not self.control["paused"]:
                    return True
            self.wake.wait(0.1)
            self.wake.clear()
        return False

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
        while not self.closed:
            self.wake.wait(0.2)
            self.wake.clear()
            with self.lock:
                if (
                    self.closed
                    or self.fault
                    or self.control["paused"]
                    or not self.control["batch"]
                ):
                    continue
                id = self.control["batch"][0]
                self.active = id
                cancel = self.cancel_event
            try:
                self._execute(id, cancel)
            except Exception as exc:
                with self.lock:
                    # Disk errors are not converted into implicit retries.
                    self.fault = str(exc)[:500]
                    self.control.update(paused=True, batch=[])
            finally:
                with self.lock:
                    self.active = None
                    if id in self.control["batch"]:
                        self.control["batch"].remove(id)
                    try:
                        self._save_control()
                    except Exception as exc:
                        self.fault = str(exc)[:500]
                        self.control["paused"] = True
                    self.wake.set()

    def report_attempt(self, id, index, fields):
        """Provider progress updates the same in-memory attempt that will be committed."""
        with self.lock:
            task = self.active_task
            if not task or task["id"] != id or not task["pages"][index]["attempts"]:
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

    def _execute(self, id, cancel):
        task = self.get(id)
        self.active_task = task
        failures = []
        streak = 0
        fatal = None
        try:
            if task["prepared"] is None:
                task["status"] = "preparing"
                self._save(task)
                prepared = self.prepare(copy.deepcopy(task), cancel)
                if cancel.is_set():
                    raise InterruptedError("已取消；上游已收到的请求可能仍计费")
                task["prepared"] = prepared
                self._save(task)
            task["status"] = "running"
            task.pop("error", None)
            self._save(task)
            for index in list(task["selection"]):
                if not self._await_dispatch(cancel):
                    raise InterruptedError("已取消后续分幕，原有图片保留")
                page = task["pages"][index]
                attempt = {
                    "id": uuid.uuid4().hex,
                    "startedAt": time.time(),
                    "status": "running",
                }
                page["attempts"].append(attempt)
                page["state"] = "running"
                self._save(task)
                try:
                    result = self.render(copy.deepcopy(task), index, cancel)
                    if cancel.is_set():
                        raise InterruptedError(
                            "结果返回前已取消；未替换原图，可能已计费"
                        )
                    # Preserve result before publishing; a failed publication is not a reason to re-render.
                    attempt.update(
                        status="rendered",
                        phase="publish",
                        result=result,
                        finishedAt=time.time(),
                    )
                    self._save(task)
                    self.publish(copy.deepcopy(task), index, result)
                    if cancel.is_set():
                        raise InterruptedError(
                            "发布阶段收到取消，请核对画册；不会自动重发"
                        )
                    page["result"] = result
                    page["state"] = "complete"
                    attempt["status"] = "complete"
                    streak = 0
                    self._save(task)
                except Exception as exc:
                    uncertain = cancel.is_set() or isinstance(exc, InterruptedError) or (
                        attempt.get("phase") != "publish"
                        and result_unconfirmed(exc, attempt.get("upstream"))
                    )
                    attempt.update(
                        status=(
                            "uncertain"
                            if uncertain
                            else "failed"
                        ),
                        error=failure_summary(safe_error_text(str(exc)), terminal=True),
                        rawError=safe_error_text(str(exc))[:16384],
                        finishedAt=time.time(),
                    )
                    page["state"] = (
                        "uncertain"
                        if uncertain
                        else "failed"
                    )
                    if cancel.is_set() or isinstance(exc, InterruptedError):
                        raise
                    # One rejected page (moderation, bad parameters, exhausted
                    # rate limit) is page-local: record it and keep going so the
                    # rest of the book still gets rendered.
                    failures.append((index, attempt["error"]))
                    streak += 1
                    self._save(task)
                    # Publication failures are local storage problems: rendering
                    # more pages that cannot be saved would only pay twice.
                    if (
                        attempt.get("phase") == "publish"
                        or fatal_page_failure(exc)
                        or streak >= FAILURE_STREAK_LIMIT
                    ):
                        fatal = exc
                        break
            task["status"] = (
                "complete"
                if all(p["state"] == "complete" for p in task["pages"])
                else "partial"
            )
            if failures:
                if not any(p["state"] == "complete" for p in task["pages"]):
                    task["status"] = "failed"
                task["error"] = self._failure_report(task, failures, fatal)
            if fatal is not None:
                # A systemic failure stops a sequential batch rather than
                # skipping into another paid book with the same broken setup.
                self._halt_batch(id)
        except Exception as exc:
            task["status"] = (
                "cancelled"
                if cancel.is_set()
                else ("interrupted" if isinstance(exc, InterruptedError) else "failed")
            )
            task["error"] = failure_summary(safe_error_text(str(exc)), terminal=True)
            # Failure stops a sequential batch rather than skipping into another paid book.
            self._halt_batch(id)
        finally:
            try:
                self._save(task)
                try:
                    self.finalize(copy.deepcopy(task))
                except Exception:
                    pass
            finally:
                self.active_task = None

    def _halt_batch(self, id):
        with self.lock:
            for other in self.control["batch"]:
                if other != id:
                    waiting = self.get(other)
                    waiting["status"] = "standby"
                    waiting["selection"] = []
                    self._save(waiting)
            self.control.update(batch=[], paused=True)

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
            text += "；连续失败或凭据错误，已停止剩余 " + str(len(remaining)) + " 幕"
        return text

    def close(self, timeout=30):
        """Stop dispatch, cancel cooperatively, and wait without unlocking a live worker.

        False means shutdown is still draining; the worker owns and releases the
        lease in _loop's finally block. Repeated close calls can wait again.
        """
        with self.lock:
            self.closed = True
            self.cancel_event.set()
            self.control["paused"] = True
            self.wake.set()
        if threading.current_thread() is not self.worker:
            self.worker.join(timeout=timeout)
        self.unclean_shutdown = self.worker.is_alive()
        return not self.unclean_shutdown
