"""Frozen registry dependencies shared by built-in and extension jobs."""

import json


def references(value):
    """Inspect only documented execution envelopes, never story data or node options."""
    if not isinstance(value, dict):
        return
    for ref in value.get("dependencies", []):
        if isinstance(ref, dict) and {"point", "id", "source", "digest", "contract"} <= ref.keys():
            yield ref
    for stage in value.get("stages", []):
        if not isinstance(stage, dict):
            continue
        for key in ("output_adapters", "frontend_state"):
            for plan in (stage.get(key) or {}).values():
                if isinstance(plan, dict) and isinstance(plan.get("adapter"), dict):
                    yield plan["adapter"]
    # A cloud request freezes its later local chain under this explicit field.
    yield from references(value.get("refinement"))


def job_references(engine, job_id):
    row = engine.db.execute("SELECT snapshot_json FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row:
        yield from references(json.loads(row[0]))
    for row in engine.db.execute("SELECT input_json FROM job_items WHERE job_id = ?", (job_id,)):
        yield from references(json.loads(row[0]))


def available(registry, ref):
    if ref["point"] in ("comfy_output_adapter", "comfy_state_adapter"):
        from ..comfy.contracts import builtin, builtin_ref

        if builtin(ref["point"], ref["id"]) and ref == builtin_ref(ref["point"], ref["id"]):
            return True
    return any(
        (item.source, item.meta.get("digest", ""), item.meta.get("contract", 1))
        == (ref["source"], ref["digest"], ref["contract"])
        for item in registry.layers(ref["point"], ref["id"])
    )


def missing(engine, job_id):
    return [ref for ref in job_references(engine, job_id) if not available(engine.registry, ref)]
