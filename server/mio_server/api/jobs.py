"""Job engine API and the live event WebSocket (``/api/ws/jobs``)."""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any, Literal

import anyio
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..auth import AuthError
from ..jobs.executors import ExecutorInfo, RebindExecutor
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["jobs"])
QUEUE_LIMIT = 500
AUTH_RECHECK_SECONDS = 1.0


class RetryRequest(BaseModel):
    indexes: list[int] | None = None
    from_index: int | None = None
    confirm_uncertain: bool = False
    include_complete: bool = False


class ResolveRequest(BaseModel):
    action: Literal["reconcile", "failed", "resubmit"]
    result: dict[str, Any] | None = None


class RestoreStateRequest(BaseModel):
    confirm_stopped: bool = False
    discard_result: bool = False


@router.get("/job-executors", response_model=list[ExecutorInfo])
def list_job_executors(ctx: Ctx):
    return ctx.engine.executor_catalog()


@router.post("/jobs/{job_id}/rebind-executor")
def rebind_job_executor(ctx: Ctx, job_id: str, body: RebindExecutor) -> dict:
    return ctx.engine.rebind_executor(job_id, body)


@router.get("/jobs")
def list_jobs(
    ctx: Ctx, owner: str | None = None, active: bool = False, limit: int = 100
) -> list[dict]:
    return ctx.engine.list(owner=owner, limit=min(max(limit, 1), 500), active_only=active)


@router.get("/jobs/{job_id}")
def get_job(ctx: Ctx, job_id: str) -> dict:
    return ctx.engine.get(job_id)


@router.get("/jobs/{job_id}/events")
def job_events(ctx: Ctx, job_id: str, after: int = 0, limit: int = 200) -> list[dict]:
    return ctx.engine.events(job_id, after, min(max(limit, 1), 1000))


@router.get("/jobs/{job_id}/deliveries")
def job_result_deliveries(ctx: Ctx, job_id: str) -> list[dict]:
    """Persisted results awaiting local application, including previous attempts."""
    return ctx.engine.deliveries(job_id)


@router.post("/jobs/{job_id}/items/{idx}/replay-result")
def replay_job_result(ctx: Ctx, job_id: str, idx: int) -> dict:
    """Apply a received result without sending another generation request."""
    return ctx.engine.replay_result(job_id, idx)


@router.get("/jobs/{job_id}/state-recovery")
def get_job_state_recovery(ctx: Ctx, job_id: str) -> list[dict]:
    """Saved frontend-state restoration records, including canceled tasks."""
    ctx.engine.get(job_id, items=False)
    return ctx.engine.state_leases.list(job_id)


@router.post("/jobs/{job_id}/items/{idx}/restore-state")
def restore_job_item_state(ctx: Ctx, job_id: str, idx: int, body: RestoreStateRequest) -> dict:
    """Restore state after upstream completion; confirm_stopped explicitly attests an unknown run ended."""
    return ctx.engine.restore_state(
        job_id, idx, body.confirm_stopped, discard_result=body.discard_result
    )


@router.post("/jobs/{job_id}/pause")
def pause(ctx: Ctx, job_id: str) -> dict:
    return ctx.engine.pause(job_id)


@router.post("/jobs/{job_id}/resume")
def resume(ctx: Ctx, job_id: str) -> dict:
    return ctx.engine.resume(job_id)


@router.post("/jobs/{job_id}/cancel")
def cancel(ctx: Ctx, job_id: str) -> dict:
    return ctx.engine.cancel(job_id)


@router.post("/jobs/{job_id}/retry")
def retry(ctx: Ctx, job_id: str, body: RetryRequest) -> dict:
    """Per-panel (``indexes``) or suffix (``from_index``) rerun; never implicit."""
    return ctx.engine.retry(
        job_id, body.indexes, body.from_index, body.confirm_uncertain, body.include_complete
    )


@router.post("/jobs/{job_id}/items/{idx}/resolve")
def resolve(ctx: Ctx, job_id: str, idx: int, body: ResolveRequest) -> dict:
    """Settle an ``uncertain`` item: reconcile from upstream records, mark failed, or resubmit."""
    return ctx.engine.resolve(job_id, idx, body.action, body.result)


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(ctx: Ctx, job_id: str) -> None:
    kind = ctx.engine.get(job_id, items=False)["kind"]
    ctx.engine.delete(job_id)
    if kind == "export.render":
        ctx.exports.remove(job_id)


@router.websocket("/ws/jobs")
async def job_socket(ws: WebSocket, job_id: str | None = None, previews: bool = True) -> None:
    """Pushes every engine event (``submitted``, ``sent``, ``progress``, ``complete`` …)."""
    ctx = ws.app.state.ctx
    token = getattr(ws.state, "api_token", None)
    await ws.accept()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_LIMIT)

    def push(event: dict) -> None:
        if job_id and event.get("job_id") != job_id:
            return
        if not previews and (event.get("data") or {}).get("type") == "preview":
            return
        with contextlib.suppress(RuntimeError):  # loop already closed
            loop.call_soon_threadsafe(_offer, queue, event)

    unsubscribe = ctx.engine.subscribe(push)
    getter = receiver = None

    def revalidate() -> None:
        if token is not None:
            ctx.tokens.revalidate(token, scope="read")

    async def send(event: dict) -> None:
        revalidate()
        await ws.send_json(event)

    try:
        await send({"type": "hello", "active": ctx.engine.list(active_only=True)})
        getter = asyncio.create_task(queue.get())
        receiver = asyncio.create_task(ws.receive_text())
        while True:
            done, _ = await asyncio.wait(
                {getter, receiver},
                timeout=AUTH_RECHECK_SECONDS if token is not None else None,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if receiver in done:
                receiver.result()  # raises WebSocketDisconnect when the client leaves
                receiver = asyncio.create_task(ws.receive_text())
            if getter in done:
                await send(getter.result())
                getter = asyncio.create_task(queue.get())
            else:
                # Idle timeouts/client messages must also release expired credentials.
                revalidate()
    except AuthError as exc:
        await ws.close(code=1008, reason=str(exc))
    except WebSocketDisconnect:
        pass
    finally:
        unsubscribe()
        tasks = [task for task in (getter, receiver) if task is not None]
        for task in tasks:
            task.cancel()
        # The ASGI request may already be inside a canceled scope on disconnect.
        with anyio.CancelScope(shield=True):
            await asyncio.gather(*tasks, return_exceptions=True)
        # Release queued preview payloads rather than retaining them until later GC.
        while not queue.empty():
            queue.get_nowait()


def _offer(queue: asyncio.Queue, event: dict) -> None:
    if queue.full():  # slow client: drop the oldest event, keep the newest state
        with contextlib.suppress(asyncio.QueueEmpty):
            queue.get_nowait()
    queue.put_nowait(event)
