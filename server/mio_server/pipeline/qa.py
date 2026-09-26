"""VLM quality check, voting and auto-pick (ROADMAP P3 "VLM 质检与自动挑选").

* Identity per on-stage character against its bible reference (the spike's judge prompt).
* Script compliance: shot, cast count (``extra_people``), scene match.
* ``votes`` independent calls; per-character identity uses the median, feature verdicts a
  majority, so one flaky answer cannot flip a take.  The human has the final word: auto-pick
  never touches locked panels or panels whose adoption was set by hand.
"""

from __future__ import annotations

import statistics

from ..jobs import LOCAL, ExecError, ItemContext, ItemSpec
from ..models import Episode, Face, IdentityCheck, QAResult, TakeStatus
from . import judge as J
from .refs import pick_character_ref
from .story import to_story

PASS_SCORE = 0.7


def aggregate(story: dict, panel: dict, runs: list[dict], model: str = "") -> QAResult:
    """Combine several judge runs into one verdict (pure)."""
    chars = [c["id"] for c in panel.get("characters") or []]
    identity, issues = [], []
    all_ok = True
    for cid in chars:
        verdicts = [v for r in runs for v in r["verdicts"] if v["character"] == cid]
        if not verdicts:
            identity.append(IdentityCheck(character_id=cid, score=0, missing=["未评审"]))
            all_ok = False
            continue
        score = int(statistics.median_low([v["identity"] for v in verdicts]))
        present = sum(v["present"] for v in verdicts) * 2 > len(verdicts)
        wrong: dict[str, int] = {}
        for v in verdicts:
            for f in v["features_wrong"]:
                wrong[f] = wrong.get(f, 0) + 1
        missing = sorted(f for f, n in wrong.items() if n * 2 > len(verdicts))
        if not present:
            missing = ["未出场"] + missing
        ok = present and score >= J.PASS_IDENTITY and not [m for m in missing if m != "未出场"]
        all_ok &= ok
        identity.append(
            IdentityCheck(character_id=cid, score=score if present else 0, missing=missing)
        )
        if not ok:
            issues.append(
                f"{cid}: 一致性 {score}/5" + (f"，缺 {', '.join(missing)}" if missing else "")
            )

    def med(key):
        vals = [r[key] for r in runs if isinstance(r.get(key), int)]
        return statistics.median_low(vals) if vals else None

    extra, scene, quality = med("extra_people"), med("scene"), med("quality")
    characters_ok = extra == 0 if extra is not None else None
    shot_ok = scene >= 3 if scene is not None else None
    if characters_ok is False:
        issues.append(f"多出 {extra} 个无关人物")
    if shot_ok is False:
        issues.append(f"镜头 / 场景不符（{scene}/5）")
    if quality is not None and quality <= 2:
        issues.append(f"画面质量差（{quality}/5）")
    parts = [c.score / 5 for c in identity] or [1.0]
    score = sum(parts) / len(parts) * 0.6
    score += (scene or 3) / 5 * 0.2 + (quality or 3) / 5 * 0.2
    if characters_ok is False:
        score *= 0.8
    score = round(max(0.0, min(1.0, score)), 3)
    passed = all_ok and characters_ok is not False and shot_ok is not False and score >= PASS_SCORE
    return QAResult(
        passed=passed,
        score=score,
        identity=identity,
        shot_ok=shot_ok,
        characters_ok=characters_ok,
        issues=issues,
        votes=len(runs),
        model=model,
    )


def auto_pick(episode: Episode, panel_id: str, variant_id: str | None = None) -> str | None:
    """Adopt the best passing candidate unless the panel is locked or already adopted by hand."""
    panel = episode.panel(panel_id)
    if panel is None or panel.locked:
        return None
    current = episode.adopted(panel_id, variant_id)
    if current is not None and (
        current.qa is None or current.parameter_snapshot.get("adopted_by") == "user"
    ):
        return None
    pool = [
        t
        for t in episode.takes
        if t.panel_id == panel_id
        and t.variant_id == variant_id
        and t.status != TakeStatus.rejected
        and t.qa is not None
        and t.qa.passed
    ]
    if not pool:
        return None
    best = max(pool, key=lambda t: (t.qa.score, t.created_at))
    if current is best:
        return None
    for t in episode.takes:
        if t.panel_id == panel_id and t.variant_id == variant_id and t.status == TakeStatus.adopted:
            t.status = TakeStatus.candidate
    best.status = TakeStatus.adopted
    best.parameter_snapshot = {**best.parameter_snapshot, "adopted_by": "auto"}
    return best.id


class QAService:
    """Submits ``qa.check`` jobs and applies their verdicts."""

    def __init__(self, store, assets, engine, llm_factory):
        self.store, self.assets, self.engine, self.llm_factory = store, assets, engine, llm_factory

    def submit(
        self,
        episode_id: str,
        take_ids: list[str] | None = None,
        votes: int = 3,
        faces: bool = True,
        auto_adopt: bool = True,
        idempotency_key: str | None = None,
    ) -> dict:
        episode = self.store.get_episode(episode_id)
        series = self.store.get_series(episode.series_id)
        takes = [
            t
            for t in episode.takes
            if (take_ids is None and t.qa is None and t.status != TakeStatus.rejected)
            or (take_ids is not None and t.id in take_ids)
        ]
        if not takes:
            raise ValueError("没有需要质检的候选")
        specs = []
        for take in takes:
            variant = next((v for v in series.variants if v.id == take.variant_id), None)
            story = to_story(series, episode, variant)
            pv = next((p for p in story["panels"] if p["id"] == take.panel_id), None)
            panel = episode.panel(take.panel_id)
            if pv is None or panel is None:
                continue
            anchors = {}
            for pc in panel.characters:
                ch = series.bible.character(pc.character_id)
                pick = (
                    pick_character_ref(ch.references, panel, pc.outfit, pc.expression)
                    if ch
                    else None
                )
                if pick:
                    anchors[pc.character_id] = pick[0].asset_id
            pv = {**pv, "characters": [c for c in pv["characters"] if c["id"] in anchors]}
            specs.append(
                ItemSpec(
                    input={
                        "episode_id": episode.id,
                        "take_id": take.id,
                        "story": story,
                        "panel": pv,
                        "anchors": anchors,
                        "votes": votes,
                        "faces": faces,
                        "size": [take.width or 0, take.height or 0],
                    },
                    resource=LOCAL,
                    label=f"质检 · 第 {panel.order + 1} 格",
                )
            )
        return self.engine.submit(
            "qa.check",
            specs,
            {"episode_id": episode.id, "auto_adopt": auto_adopt},
            title=f"{episode.title} · VLM 质检 {len(specs)} 张",
            window=2,
            idempotency_key=idempotency_key,
            failure_limit=5,
            owner=episode.id,
        )

    # executor protocol ---------------------------------------------------
    def execute(self, ctx: ItemContext) -> dict:
        inp = ctx.input
        llm = self.llm_factory()
        image = self.assets.read(
            self.store.get_episode(inp["episode_id"]).take(inp["take_id"]).asset_id
        )
        anchors = {cid: self.assets.read(aid) for cid, aid in inp["anchors"].items()}
        runs, model = [], ""
        try:
            for _ in range(max(1, inp["votes"])):
                ctx.raise_if_cancelled()
                if inp["panel"]["characters"]:
                    run = J.judge_panel(llm, inp["story"], inp["panel"], anchors, image)
                    model = run.get("model") or model
                    runs.append(run)
            faces = []
            if inp.get("faces"):
                size = tuple(inp["size"]) if all(inp["size"]) else (1, 1)
                faces = J.locate_faces(llm, inp["story"], inp["panel"], image, size)
        except Exception as exc:  # VLM calls are read-only and cheap to repeat: a plain failure
            raise ExecError(f"VLM 质检失败：{exc}", kind="vlm_error", sent=False) from None
        qa = (
            aggregate(inp["story"], inp["panel"], runs, model)
            if inp["panel"]["characters"]
            else QAResult(
                passed=True, score=1.0, issues=["无角色格：跳过一致性检查"], votes=0, model=model
            )
        )
        return {"qa": qa.model_dump(), "faces": faces}

    def on_complete(self, job: dict, item: dict, result: dict) -> None:
        take_id = item["input"]["take_id"]
        auto = job["snapshot"].get("auto_adopt")

        def mutate(ep: Episode) -> None:
            take = ep.take(take_id)
            if take is None:
                return
            take.qa = QAResult.model_validate(result["qa"])
            take.score = take.qa.score
            take.faces = [
                Face(box=tuple(f["box"]), character_id=f.get("character"))
                for f in result.get("faces") or []
            ]
            if auto:
                auto_pick(ep, take.panel_id, take.variant_id)

        self.store.update_episode(item["input"]["episode_id"], mutate)
