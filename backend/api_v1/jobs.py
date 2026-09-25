"""Durable generation jobs (shared with the browser queue) and album page edits."""

from backend import mio_foundation
from backend.api_v1.core import ROUTER, ApiError, Raw, require
from backend.api_v1.spec import INTEGER, STRING, array, obj, qp, ref

JOB_ACTIONS = ["pause", "resume", "cancel", "remove", "reconcile", "abandon", "archive", "retry", "policy",
               "continue", "runtime", "hold", "amend", "start", "defer"]


def _store(ctx):
    return mio_foundation.jobs(ctx.host)


@ROUTER.get("/jobs", summary="活动任务与最近历史（最多 2000 条，列表不含结果明细）", tags=["jobs"],
            response=obj({"jobs": array(ref("Job"))}))
def list_jobs(ctx):
    return mio_foundation.annotate_jobs(ctx.host, _store(ctx).list())


@ROUTER.post("/jobs", summary="幂等提交一个持久任务（idempotencyKey 相同则返回同一任务）", tags=["jobs"],
             body=ref("SubmitJob"), response=ref("Job"), status=201, body_limit=90 * 1024 * 1024)
def submit_job(ctx):
    body = ctx.json(limit=ctx.host.MAX_IMAGE_BYTES * 4 // 3 + 65536)
    return mio_foundation.annotate_jobs(ctx.host, mio_foundation.submit_job(ctx.host, body))


@ROUTER.get("/jobs/activity", summary="最近 200 条持久执行记录（after 之后）", tags=["jobs"],
            query=[qp("after", "integer", "Only records after this event ID", minimum=0)])
def job_activity(ctx):
    return _store(ctx).activity(ctx.q_int("after", 0, 0))


@ROUTER.get("/jobs/events", summary="SSE 事件回放；用 Last-Event-ID 或 after 续读", tags=["jobs"],
            query=[qp("after", "integer", "Replay events after this ID", minimum=0)],
            produces={"text/event-stream": {"schema": STRING}})
def job_events(ctx):
    after = ctx.q_int("after", None, 0)
    if after is None:
        try:
            after = max(0, int(ctx.header("Last-Event-ID", "0") or 0))
        except ValueError:
            raise ApiError(400, "invalid_request", "Last-Event-ID must be an integer") from None
    return Raw(mio_foundation.event_stream(_store(ctx), after), mime="text/event-stream",
               headers={"Cache-Control": "no-cache"})


@ROUTER.post("/jobs/reorder", summary="调整尚未开始的等待任务顺序", tags=["jobs"],
             body=obj({"ids": array(STRING, uniqueItems=True)}, ["ids"]))
def reorder_jobs(ctx):
    return _store(ctx).reorder(ctx.json().get("ids"))


@ROUTER.get("/jobs/{jobId}", summary="任务详情：状态、上游 ID、产物、逐帧状态", tags=["jobs"], response=ref("Job"),
            params={"jobId": {"description": "Job ID"}})
def get_job(ctx):
    try:
        return mio_foundation.annotate_jobs(ctx.host, _store(ctx).get(ctx.params["jobId"]))
    except KeyError:
        raise ApiError(404, "job_not_found", "Job not found") from None


@ROUTER.post("/jobs/{jobId}", summary="控制任务或调度器（action：pause/resume/cancel/retry/policy/runtime/amend …）",
             tags=["jobs"], response=ref("Job"),
             params={"jobId": {"description": "Job ID, or `scheduler` for global pause/resume, policy or runtime"}},
             body=obj({"action": {"enum": JOB_ACTIONS}, "policy": ref("FailurePolicy"), "runtime": ref("Runtime"),
                       "recovery": ref("Recovery"),
                       "edits": array(obj({"index": {"type": "integer", "minimum": 0}, "prompt": STRING, "negative": STRING},
                                          ["index"], extra=False))}, ["action"]))
def control_job(ctx):
    body = ctx.json()
    require(body, "action", message="action is required")
    try:
        data = mio_foundation.control_job(ctx.host, ctx.params["jobId"], body)
    except KeyError:
        raise ApiError(404, "job_not_found", "Job not found") from None
    return mio_foundation.annotate_jobs(ctx.host, data)


# ------------------------------------------------------------------ album pages (shared with the UI)


@ROUTER.post("/albums/page", summary="保存 / 移除 / 恢复画册某一页的图片（非破坏式编辑记录）", tags=["albums"],
             body=obj({"albumId": STRING, "index": INTEGER, "action": {"enum": ["save", "remove", "restore"]},
                       "expectedRevision": INTEGER, "expectedImage": STRING, "image": STRING,
                       "sourceImage": STRING, "recipe": {"type": "object"}}, ["albumId", "index", "action"], extra=False),
             body_limit=2 * 1024 * 1024)
def page_mutation(ctx):
    return mio_foundation.mutate_page(ctx.host, ctx.json())


@ROUTER.get("/albums/page-edits", summary="页面编辑记录（after 之后，按序号）", tags=["albums"],
            query=[qp("after", "integer", "Only edits after this sequence number", minimum=0)])
def page_edits(ctx):
    return mio_foundation.page_edits(ctx.host, ctx.q_int("after", 0, 0))


@ROUTER.post("/albums/delete", summary="批量删除画册，同时停止并删除相关任务（进入回收站）", tags=["albums"],
             body=obj({"ids": array({"type": "string", "minLength": 1, "maxLength": 250}, minItems=1, maxItems=10000)}, ["ids"]),
             response=obj({"deletedAlbumIds": array(STRING), "warning": STRING}))
def delete_albums(ctx):
    return mio_foundation.delete_albums(ctx.host, ctx.json().get("ids"))


# ------------------------------------------------------------------ legacy revision-checked writers

@ROUTER.get("/resources/storyboards", summary="分镜可编辑 DTO 与工作区修订号（旧接口，请改用 /library/storyboards）",
            tags=["catalog"], deprecated=True, operation_id="getResourcesStoryboards")
def legacy_storyboards(ctx):
    return mio_foundation.resources(ctx.host, "storyboards")


@ROUTER.post("/resources/storyboards", summary="按工作区修订号 upsert 分镜（旧接口，请改用 /library/storyboards）",
             tags=["catalog"], deprecated=True, operation_id="postResourcesStoryboards",
             body=obj({"expectedRevision": {"type": ["integer", "null"]}, "item": {"type": "object"}}, ["expectedRevision", "item"]))
def legacy_storyboards_write(ctx):
    return mio_foundation.resources(ctx.host, "storyboards", ctx.json(limit=20 * 1024 * 1024))


@ROUTER.get("/resources/plans", summary="创作计划 DTO 与工作区修订号（旧接口，请改用 /library/plans）",
            tags=["catalog"], deprecated=True, operation_id="getResourcesPlans")
def legacy_plans(ctx):
    return mio_foundation.resources(ctx.host, "plans")


@ROUTER.post("/resources/plans", summary="按工作区修订号 upsert 创作计划（旧接口，请改用 /library/plans）",
             tags=["catalog"], deprecated=True, operation_id="postResourcesPlans",
             body=obj({"expectedRevision": {"type": ["integer", "null"]}, "item": {"type": "object"}}, ["expectedRevision", "item"]))
def legacy_plans_write(ctx):
    return mio_foundation.resources(ctx.host, "plans", ctx.json(limit=20 * 1024 * 1024))

