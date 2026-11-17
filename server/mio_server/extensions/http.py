"""Bounded HTTP helpers for standalone extensions."""


async def read_body(request, limit, message="Request body too large"):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise ValueError(message)
        chunks.append(chunk)
    if not size:
        raise ValueError("请求体为空")
    return b"".join(chunks)
