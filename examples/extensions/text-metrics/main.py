"""No network, filesystem mutation or model calls: count text through the job API."""

from mio_server.jobs import ItemSpec
from pydantic import BaseModel, Field


class MetricsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    idempotency_key: str = Field(min_length=1, max_length=160)


class MetricsJob(BaseModel):
    job_id: str
    state: str


class MetricsExecutor:
    # Results live in job_items.result. There are no side effects to repeat on delivery.
    replay_safe = True

    def execute(self, ctx):
        ctx.raise_if_cancelled()
        text = ctx.input["text"]
        return {"characters": len(text), "words": len(text.split())}


def activate(mio):
    mio.contribute(
        "job_executor", "text-metrics.count", MetricsExecutor(), resources=("local",)
    )

    @mio.route(
        "POST", "/count", scope="render", response_model=MetricsJob, status_code=202
    )
    def count(body: MetricsRequest):
        job = mio.submit_job(
            "text-metrics.count",
            [ItemSpec({"text": body.text})],
            title="Text metrics",
            idempotency_key=f"text-metrics:{body.idempotency_key}",
        )
        return MetricsJob(job_id=job["id"], state=job["state"])
