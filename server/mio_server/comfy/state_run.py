"""Durable frontend-state transactions around a single ComfyUI item.

The endpoint lease outlives the worker. Unknown upstream execution and failed restoration
keep it reserved until an explicit reconciliation can prove that restoring state is safe.
"""

from __future__ import annotations

import copy

from ..jobs import ExecError
from . import adapters


class StateSession:
    def __init__(self, ctx, client, record=None):
        self.ctx, self.client = ctx, client
        self.record = record or ctx.state_lease
        self.data = copy.deepcopy(self.record["data"])

    def save(self, **changes):
        self.data.update(changes)
        self.ctx.engine.state_leases.update(self.record["token"], self.data)

    def entries(self, entries):
        self.save(entries=entries)

    def idle(self):
        queue = self.client.queue_status()
        if queue["queue_running"] or queue["queue_pending"]:
            raise ExecError(
                "参数面板任务需要独占 ComfyUI；服务还有其他运行或排队任务",
                kind="state_service_busy",
                sent=False,
            )

    def prepare(self, index, plan):
        self.save(
            stage=index,
            phase="preparing",
            entries=[],
            prompt_id=None,
            terminal=False,
            terminal_state=None,
            result_pending=False,
            result=None,
            stage_result=None,
            failure=None,
        )
        self.idle()
        if plan:
            adapters.prepare_plan(self.client, plan, self.entries)
        self.save(phase="prepared")

    def submitting(self):
        self.ctx.raise_if_cancelled()
        self.idle()
        self.save(phase="submitting")

    def queued(self, prompt_id):
        self.save(prompt_id=prompt_id, phase="executing")

    def ended(self, *, failure=None, success=False):
        self.save(
            terminal=True,
            phase="ended",
            failure=failure,
            terminal_state="terminal_success" if success else "terminal_error" if failure else None,
            result_pending=success,
        )

    def restore(self):
        issues = adapters.restore_plan(self.client, self.data.get("entries", []), self.entries)
        self.save(phase="restore_failed" if issues else "restored", issues=issues)
        if issues:
            raise ExecError(
                "参数面板状态尚未恢复，服务保持隔离；请核对后重试恢复",
                kind="state_restore_failed",
                sent=True,
                detail=issues,
            )

    def cleanup(self):
        """On worker exit restore only when no request could still be executing."""
        if self.data.get("phase") in ("submitting", "executing") and not self.data.get("terminal"):
            return False
        if self.data.get("phase") == "restore_failed":
            return False
        if self.data.get("result_pending"):
            return False
        if self.data.get("phase") != "restored":
            self.restore()
        # The engine releases a successful result only after committing the job result.
        if self.data.get("result") is None:
            self.ctx.engine.state_leases.release(self.record["token"])
        return True

    def settle(self, *, confirm_stopped=False):
        """Prove termination without restoring state before the result has been saved."""
        phase = self.data.get("phase")
        state, entry = self.data.get("terminal_state") or "unknown", {}
        if phase in ("submitting", "executing") and not self.data.get("terminal"):
            prompt = self.data.get("prompt_id")
            if prompt:
                state, entry = self.client.execution_state(prompt)
            else:
                self.idle()
            if state == "active":
                return {"settled": False, "status": "upstream_active"}, entry
            if state == "unknown" and not confirm_stopped:
                return {"settled": False, "status": "upstream_unknown"}, entry
            if state == "unknown":
                self.idle()
                self.save(confirmed_stopped=True)
            self.ended(
                failure={"kind": "execution_error"} if state == "terminal_error" else None,
                success=state == "terminal_success",
            )
        return {"settled": True, "upstream_state": state}, entry
