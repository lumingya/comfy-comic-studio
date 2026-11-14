"""Opt-in QA route; activating the extension never submits work."""

from pydantic import BaseModel, ConfigDict, Field


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_id: str = Field(min_length=1)
    take_ids: list[str] = Field(min_length=1)
    idempotency_key: str = Field(min_length=1, max_length=200)


def activate(mio):
    @mio.router.post("/queue")
    def queue_review(body: ReviewRequest) -> dict:
        # internal is intentionally an unstable extension API; see the example README.
        return mio.internal.qa.submit(
            body.episode_id,
            take_ids=body.take_ids,
            auto_adopt=False,
            idempotency_key=body.idempotency_key,
        )
