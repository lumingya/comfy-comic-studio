"""Bot flows on top of the generated client, kept free of AstrBot imports so they can be tested."""

from __future__ import annotations

try:  # inside the AstrBot plugin package
    from .mio_client import MioClient, MioError
except ImportError:  # tests / plain scripts
    from mio_client import MioClient, MioError  # type: ignore[no-redef]

__all__ = ["MioClient", "MioError", "draw", "job_summary", "series_list"]


def find_or_create_series(mio: MioClient, title: str) -> dict:
    for item in mio.list_series():
        if item.get("title") == title:
            return item
    return mio.create_series({"title": title})


def adopt_missing(mio: MioClient, episode: dict) -> dict:
    """Adopt the best-scoring candidate for every panel that has no adopted take yet."""
    adopted = {t["panel_id"] for t in episode["takes"] if t["status"] == "adopted"}
    best: dict[str, dict] = {}
    for take in episode["takes"]:
        if take["status"] != "candidate" or take["panel_id"] in adopted:
            continue
        current = best.get(take["panel_id"])
        if current is None or (take.get("score") or 0) > (current.get("score") or 0):
            best[take["panel_id"]] = take
    for take in best.values():
        episode = mio.adopt_take(episode["id"], take["id"])
    return episode


def draw(
    mio: MioClient,
    sentence: str,
    *,
    series_title: str = "机器人作品",
    candidates: int = 1,
    width: int = 720,
    timeout: float = 1800,
    progress=None,
) -> tuple[dict, bytes]:
    """One sentence → script → render → adopt → strip PNG.  Needs ``write`` + ``render`` scopes."""
    say = progress or (lambda text: None)
    series = find_or_create_series(mio, series_title)
    episode = mio.generate_episode(series["id"], {"sentence": sentence})
    say(f"剧本完成：《{episode['title']}》，共 {len(episode['panels'])} 格，开始出图…")
    job = mio.render_episode(episode["id"], {"candidates": candidates})
    job = mio.wait_job(job["id"], timeout=timeout)
    if job["state"] != "completed":
        raise MioError(500, "job_" + job["state"], f"出图任务{job['state']}")
    episode = adopt_missing(mio, mio.get_episode(episode["id"]))
    return episode, mio.strip_png(episode["id"], width=width)


def job_summary(mio: MioClient) -> str:
    active = mio.list_jobs(active=True)
    if not active:
        return "当前没有进行中的任务。"
    lines = []
    for j in active[:10]:
        counts = j.get("counts") or {}
        done = counts.get("complete", 0)
        total = sum(counts.values()) or len(j.get("items") or [])
        lines.append(f"· {j.get('title') or j['kind']}：{j['state']} {done}/{total}")
    return "进行中的任务：\n" + "\n".join(lines)


def series_list(mio: MioClient) -> str:
    items = mio.list_series()
    if not items:
        return "还没有作品。"
    return "作品：\n" + "\n".join(f"· {s['title']}（{s['id']}）" for s in items[:20])
