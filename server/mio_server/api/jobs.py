"""Job engine API and the live event WebSocket (``/api/ws/jobs``)."""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any, Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .deps import Ctx

router = APIRouter(tags=["jobs"])
QUEUE_LIMIT = 500


class RetryRequest(BaseModel):
    indexes: list[int] | None = None
    from_index: int | None = None
    confirm_uncertain: bool = False
    include_complete: bool = False


class ResolveRequest(BaseModel):
    action: Literal["reconcile", "failed", "resubmit"]
    result: dict[str, Any] | None = None


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
    ctx.engine.delete(job_id)


@router.websocket("/ws/jobs")
async def job_socket(ws: WebSocket, job_id: str | None = None, previews: bool = True) -> None:
    """Pushes every engine event (``submitted``, ``sent``, ``progress``, ``complete`` …)."""
    ctx = ws.app.state.ctx
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
    try:
        await ws.send_json({"type": "hello", "active": ctx.engine.list(active_only=True)})
        while True:
            getter = asyncio.ensure_future(queue.get())
            receiver = asyncio.ensure_future(ws.receive_text())
            done, pending = await asyncio.wait(
                {getter, receiver}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            if receiver in done:
                receiver.result()  # raises WebSocketDisconnect when the client leaves
                continue
            await ws.send_json(getter.result())
    except WebSocketDisconnect:
        pass
    finally:
        unsubscribe()


def _offer(queue: asyncio.Queue, event: dict) -> None:
    if queue.full():  # slow client: drop the oldest event, keep the newest state
        with contextlib.suppress(asyncio.QueueEmpty):
            queue.get_nowait()
    queue.put_nowait(event)
