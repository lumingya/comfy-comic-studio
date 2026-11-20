"""Owner-aware local artifact publication in the existing result-delivery journal."""

from __future__ import annotations

import hashlib
import json
import time

from .types import JobConflict, canonical

FORMAT = "mio.result-publication.v1"


def result_sha(result):
    return hashlib.sha256(canonical(result).encode()).hexdigest()


class PublicationRuntime:
    def _artifact_store(self, job_id):
        binding = self.job_executor(job_id)
        return self.artifact_store or (
            getattr(binding.executor, "artifact_store", None) if binding else None
        )

    def publish_result(self, ctx, result, artifacts, *, stage=0, terminal=True):
        """Record ownership before bytes; only this active attempt may advance a stage."""
        if type(stage) is not int or stage < 0 or type(terminal) is not bool:
            raise JobConflict("invalid result publication stage")
        artifacts = list(artifacts)
        store = self._artifact_store(ctx.job_id)
        if artifacts and store is None:
            raise JobConflict("no artifact store is configured for this task")
        manifests = [store.manifest(asset).model_dump(mode="json") for asset, _ in artifacts]
        if store:
            store.retained_results = self.retained_result_assets
        with self._job_guard(ctx.job_id, command=True):
            ctx.raise_if_cancelled()
            if not self._prepare_publication(ctx, result, manifests, stage, terminal):
                return result
            for asset, data in artifacts:
                store.publish(asset, data)
            self._restore_publication(ctx.job_id, ctx.idx, recovering=False)
        return result

    @staticmethod
    def _artifact_views(manifests):
        return [
            {key: value for key, value in asset.items() if key != "created_at"}
            for asset in manifests
        ]

    def _prepare_publication(self, ctx, result, manifests, stage, terminal):
        sha, now = result_sha(result), time.time()
        with self.lock, self.db:
            row = self._item_row(ctx.job_id, ctx.idx)
            job = self._require(ctx.job_id)
            binding = self.job_executor(ctx.job_id, required=True)
            if (
                job["canceled"]
                or row["state"] not in ("running", "uncertain")
                or row["epoch"] != ctx.epoch
                or row["attempts"] != ctx.attempt
                or (ctx.executor_binding and ctx.executor_binding.ref != binding.ref)
            ):
                raise JobConflict("stale or canceled result publication")
            owner = {
                "job_id": ctx.job_id,
                "idx": ctx.idx,
                "attempt": ctx.attempt,
                "epoch": ctx.epoch,
                "executor": binding.ref.model_dump(mode="json"),
            }
            existing = self.db.execute(
                "SELECT * FROM job_deliveries WHERE job_id = ? AND idx = ? AND attempt = ?",
                (ctx.job_id, ctx.idx, ctx.attempt),
            ).fetchone()
            known, checkpoints = {}, []
            if existing:
                if existing["state"] != "publishing":
                    if existing["state"] == "pending" and existing["result_sha"] == sha:
                        previous = self._publication(existing)
                        if (
                            previous["stage"] != stage
                            or previous["terminal"] != terminal
                            or previous["checkpoints"][-1]["artifacts"]
                            != self._artifact_views(manifests)
                        ):
                            raise JobConflict(
                                "a pending publication cannot change its stage or artifacts"
                            )
                        return False
                    raise JobConflict("a result is already retained for this attempt")
                previous = self._publication(existing)
                if any(previous["owner"].get(key) != owner[key] for key in owner if key != "epoch"):
                    raise JobConflict("publication owner or epoch changed")
                if stage == previous["stage"]:
                    if sha != existing["result_sha"] or terminal != previous["terminal"]:
                        raise JobConflict("a publication stage cannot change its result")
                elif stage != previous["stage"] + 1 or previous["terminal"]:
                    raise JobConflict("publication stages must advance in order")
                known = {asset["id"]: asset for asset in previous["artifacts"]}
                checkpoints = previous["checkpoints"]
            for asset in manifests:
                old = known.get(asset["id"])
                if old and any(
                    old[key] != asset[key] for key in ("mime", "size", "width", "height")
                ):
                    raise JobConflict("an artifact manifest cannot change")
                known.setdefault(asset["id"], asset)
            artifact_views = self._artifact_views(manifests)
            checkpoint = {
                "stage": stage,
                "result_sha": sha,
                "result": result,
                "artifacts": artifact_views,
            }
            if checkpoints and checkpoints[-1]["stage"] == stage:
                if checkpoints[-1]["artifacts"] != artifact_views:
                    raise JobConflict("a publication stage cannot change its artifacts")
                checkpoint = checkpoints.pop()
            checkpoints = [*checkpoints, checkpoint]
            envelope = {
                "format": FORMAT,
                "owner": owner,
                "stage": stage,
                "terminal": terminal,
                "result": result,
                "artifacts": list(known.values()),
                "checkpoints": checkpoints,
            }
            envelope["publication_sha"] = result_sha(envelope)
            self.db.execute(
                "INSERT INTO job_deliveries "
                "(job_id, idx, attempt, state, result_sha, result_json, created, updated) "
                "VALUES (?, ?, ?, 'publishing', ?, ?, ?, ?) "
                "ON CONFLICT(job_id, idx, attempt) DO UPDATE SET "
                "result_sha=excluded.result_sha, result_json=excluded.result_json, updated=excluded.updated",
                (ctx.job_id, ctx.idx, ctx.attempt, sha, canonical(envelope), now, now),
            )
            self.db.execute(
                "UPDATE job_items SET result_json = ? WHERE job_id = ? AND idx = ?",
                (canonical(result), ctx.job_id, ctx.idx),
            )
        return True

    def _publication(self, delivery):
        envelope = json.loads(delivery["result_json"])
        owner = envelope.get("owner", {})
        ref = self.executor_ref(delivery["job_id"])
        if (
            envelope.get("format") != FORMAT
            or envelope.get("publication_sha")
            != result_sha(
                {key: value for key, value in envelope.items() if key != "publication_sha"}
            )
            or owner.get("job_id") != delivery["job_id"]
            or owner.get("idx") != delivery["idx"]
            or owner.get("attempt") != delivery["attempt"]
            or not ref
            or owner.get("executor") != ref.model_dump(mode="json")
            or type(envelope.get("terminal")) is not bool
            or type(owner.get("epoch")) is not int
            or owner["epoch"] > self._item_row(delivery["job_id"], delivery["idx"])["epoch"]
            or type(envelope.get("stage")) is not int
            or not envelope.get("checkpoints")
            or envelope["checkpoints"][-1]["stage"] != envelope["stage"]
            or envelope["checkpoints"][-1]["result"] != envelope["result"]
            or result_sha(envelope["result"]) != delivery["result_sha"]
            or any(result_sha(c["result"]) != c["result_sha"] for c in envelope["checkpoints"])
        ):
            raise JobConflict("result publication identity or payload is invalid")
        return envelope

    def _restore_publication(self, job_id, idx, *, recovering=True):
        """Repair local metadata only; incomplete/staged results never reach a callback."""
        with self.lock:
            delivery = self._pending_delivery(job_id, idx)
            if delivery is None:
                return False
            if (
                delivery["state"] == "pending"
                and result_sha(json.loads(delivery["result_json"])) == delivery["result_sha"]
            ):
                return True  # Legacy JSON has no publication manifest to revalidate.
            row = self._item_row(job_id, idx)
            if row["attempts"] != delivery["attempt"]:
                raise JobConflict("result publication belongs to another attempt")
            envelope = self._publication(delivery)
        store = self._artifact_store(job_id)
        available, missing, errors, statuses = [], [], [], []
        for asset in envelope["artifacts"]:
            try:
                if store and store.restore(asset):
                    available.append(asset["id"])
                else:
                    missing.append(asset["id"])
                if store:
                    statuses.append(store.publication_status(asset))
            except (OSError, ValueError) as exc:
                missing.append(asset.get("id"))
                errors.append(str(exc))
        ready = not missing and envelope["terminal"]
        error = {
            "kind": "result_publication_incomplete" if missing else "pipeline_interrupted",
            "message": "本地结果尚未完整发布；已保存素材保留，未重新请求上游。"
            if missing
            else "中间阶段结果已保存；后续阶段未自动执行。",
            "detail": {
                "stage": envelope["stage"],
                "terminal": envelope["terminal"],
                "available_assets": available,
                "missing_assets": missing,
                "errors": errors,
                "artifacts": statuses,
            },
        }
        with self.lock, self.db:
            current = self._pending_delivery(job_id, idx)
            if current is None or current["result_json"] != delivery["result_json"]:
                raise JobConflict("publication changed while restoring local artifacts")
            if ready and (delivery["state"] != "pending" or delivery["error"]):
                self.db.execute(
                    "UPDATE job_deliveries SET state = 'pending', updated = ?, "
                    "error = NULL WHERE job_id = ? AND idx = ? AND attempt = ?",
                    (time.time(), job_id, idx, delivery["attempt"]),
                )
            elif not ready and (recovering or missing):
                self.db.execute(
                    "UPDATE job_items SET state = 'uncertain', error_json = ? WHERE job_id = ? AND idx = ?",
                    (canonical(error), job_id, idx),
                )
                self.db.execute(
                    "UPDATE job_deliveries SET state = 'publishing', error = ?, updated = ? "
                    "WHERE job_id = ? AND idx = ? AND attempt = ?",
                    (error["message"], time.time(), job_id, idx, delivery["attempt"]),
                )
                self._aggregate(job_id)
        return ready

    def publication_intent(self, job_id, idx):
        with self.lock:
            row = self._pending_delivery(job_id, idx)
            return self._publication(row) if row and row["state"] == "publishing" else None

    def restore_checkpoint(self, ctx, publication_sha, stage, artifacts):
        """Refill an existing checkpoint without changing its owner, stage or manifest."""
        store = self._artifact_store(ctx.job_id)
        if store is None:
            raise JobConflict("no artifact store is configured for this task")
        artifacts = list(artifacts)
        manifests = [store.manifest(asset).model_dump(mode="json") for asset, _ in artifacts]
        with self._job_guard(ctx.job_id, command=True):
            ctx.raise_if_cancelled()
            with self.lock:
                row = self._item_row(ctx.job_id, ctx.idx)
                job = self._require(ctx.job_id)
                delivery = self._pending_delivery(ctx.job_id, ctx.idx)
                binding = self.job_executor(ctx.job_id, required=True)
                if (
                    job["canceled"]
                    or row["state"] not in ("running", "uncertain")
                    or row["epoch"] != ctx.epoch
                    or row["attempts"] != ctx.attempt
                    or delivery is None
                    or delivery["attempt"] != ctx.attempt
                    or (ctx.executor_binding and ctx.executor_binding.ref != binding.ref)
                ):
                    raise JobConflict("stale or canceled checkpoint restoration")
                envelope = self._publication(delivery)
                checkpoint = next((c for c in envelope["checkpoints"] if c["stage"] == stage), None)
                if (
                    envelope["publication_sha"] != publication_sha
                    or checkpoint is None
                    or checkpoint["artifacts"] != self._artifact_views(manifests)
                ):
                    raise JobConflict("recovered artifacts do not match the retained checkpoint")
                known = {asset["id"]: asset for asset in envelope["artifacts"]}
            for expected, (_, data) in zip(checkpoint["artifacts"], artifacts):
                store.publish(known[expected["id"]], data)
            self._restore_publication(ctx.job_id, ctx.idx, recovering=False)

    def _delivery_result(self, row):
        raw = json.loads(row["result_json"])
        if result_sha(raw) == row["result_sha"]:
            return raw  # Legacy executors return arbitrary JSON, including a format field.
        return self._publication(row)["result"]

    def discard_state_result(self, ctx, token, state_data):
        """Atomically abandon this attempt's delivery and its lease's pending result."""
        with self._job_guard(ctx.job_id, command=True), self.lock, self.db:
            row = self._item_row(ctx.job_id, ctx.idx)
            lease = self.state_leases.get(ctx.job_id, ctx.idx)
            if (
                row["attempts"] != ctx.attempt
                or row["epoch"] != ctx.epoch
                or lease is None
                or lease["token"] != token
            ):
                raise JobConflict("state result ownership changed while discarding")
            self.db.execute(
                "UPDATE job_deliveries SET state = 'discarded', updated = ?, error = NULL "
                "WHERE job_id = ? AND idx = ? AND attempt = ? "
                "AND state IN ('pending', 'publishing')",
                (time.time(), ctx.job_id, ctx.idx, ctx.attempt),
            )
            self.db.execute(
                "UPDATE state_leases SET data_json = ? WHERE token = ?",
                (canonical(state_data), token),
            )
            self._event(ctx.job_id, ctx.idx, "result_discarded", {"attempt": ctx.attempt})

    def local_result(self, job_id, idx):
        """Inspect complete local artifacts without executing or looking up an upstream."""
        with self._job_guard(job_id):
            with self.lock:
                row = self._pending_delivery(job_id, idx)
            if row is None:
                return None
            ready = self._restore_publication(job_id, idx)
            if not ready:
                error = json.loads(self._item_row(job_id, idx)["error_json"] or "{}")
                if error.get("detail", {}).get("missing_assets"):
                    return None
            if (
                row["state"] == "pending"
                and ready
                and result_sha(json.loads(row["result_json"])) == row["result_sha"]
            ):
                return {"result": self._delivery_result(row), "terminal": True}
            envelope = self._publication(row)
            return {
                "result": envelope["result"],
                "terminal": envelope["terminal"],
                "stage": envelope["stage"],
                "owner": envelope["owner"],
            }

    def retained_result_assets(self):
        """Keep journal-owned artifacts through GC, including staged and canceled results."""
        with self.lock:
            rows = self.db.execute("SELECT result_json FROM job_deliveries").fetchall()
        result = set()

        def collect(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key == "asset_id" and isinstance(child, str):
                        result.add(child)
                    else:
                        collect(child)
            elif isinstance(value, list):
                for child in value:
                    collect(child)

        for row in rows:
            document = json.loads(row["result_json"])
            if (
                isinstance(document, dict)
                and document.get("format") == FORMAT
                and isinstance(document.get("artifacts"), list)
            ):
                for asset in document["artifacts"]:
                    if isinstance(asset, dict) and isinstance(asset.get("id"), str):
                        result.add(asset["id"])
            collect(document)
        return result
