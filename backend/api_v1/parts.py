"""Fine-grained edits inside one document: storyboard frames, preset entries, album steps.

Every operation is a read-modify-write of the parent document with the parent's ETag,
so concurrent edits are detected (409 revision_conflict) instead of lost.
"""

import copy
import re
import uuid

from backend.api_v1.core import ROUTER, ApiError, Reply, asset_endpoint, merge_patch, quoted_etag
from backend.api_v1.library import check_id, check_kind, normalize, normalize_entry, normalize_frame, put_document, \
    read_entity, remove_document, save
from backend.api_v1.spec import INTEGER, STRING, array, obj, qp

STORY = {"id": {"description": "Storyboard ID"}}
FRAME_REF = {"description": "Frame ID, or a zero-based index when no frame has that ID"}
PRESET = {"kind": {"schema": {"enum": ["characters", "scenes"]}}, "id": {"description": "Preset ID"}}
ALBUM = {"albumId": {"description": "Album ID"}}
IF_MATCH = qp("expectedEtag", description="Alternative to the If-Match header (ETag of the parent document)")
FRAME = obj({"id": STRING, "name": STRING, "prompt": STRING, "negative": STRING, "caption": STRING, "camera": STRING,
             "width": INTEGER, "height": INTEGER, "steps": INTEGER, "cfg": {"type": "number"}, "seed": INTEGER},
            description="A storyboard frame; any additional fields are kept")
MAX_FRAMES = 512


def mutate(ctx, kind, id, change):
    """Apply ``change(document)`` to one document and save it with the parent ETag."""
    check_kind(kind, write=True)
    current = read_entity(ctx.host, kind, check_id(id))
    expected = ctx.if_match()
    if expected and expected != current["etag"]:
        raise ApiError(409, "revision_conflict", "The document changed since it was read")
    document = copy.deepcopy(current["document"])
    result = change(document)
    normalize(ctx.host, kind, document, creating=False)
    payload = save(ctx.host, kind, document, current["etag"])
    return payload, result


def reply(payload, data):
    return Reply({**data, "etag": payload["etag"], "revision": payload.get("revision")},
                 headers={"ETag": quoted_etag(payload["etag"])})


# ------------------------------------------------------------------ storyboard frames

def find_frame(frames, ref):
    for index, frame in enumerate(frames):
        if isinstance(frame, dict) and frame.get("id") == ref:
            return index
    if re.fullmatch(r"\d{1,4}", ref) and int(ref) < len(frames):
        return int(ref)
    raise ApiError(404, "frame_not_found", "No frame with this ID or index")


def frames_of(document):
    frames = document.setdefault("frames", [])
    if not isinstance(frames, list):
        raise ApiError(409, "invalid_document", "The storyboard has no frame list")
    return frames


@ROUTER.get("/library/storyboards/{id}/frames", summary="分镜的全部分幕（带序号）", tags=["storyboards"], params=STORY,
            response=obj({"storyboardId": STRING, "etag": STRING, "frames": array(FRAME)}))
def list_frames(ctx):
    record = read_entity(ctx.host, "storyboards", ctx.params["id"])
    frames = [{**f, "index": i} for i, f in enumerate(frames_of(record["document"])) if isinstance(f, dict)]
    return Reply({"storyboardId": ctx.params["id"], "etag": record["etag"], "frames": frames},
                 headers={"ETag": quoted_etag(record["etag"])})


@ROUTER.post("/library/storyboards/{id}/frames", summary="新增分幕：单个对象、frames 数组，或 count 批量生成空白分幕",
             tags=["storyboards"], params=STORY, status=201,
             query=[qp("index", "integer", "Insert position (default: append)", minimum=0), IF_MATCH],
             body=obj({"frames": array(FRAME), "count": {"type": "integer", "minimum": 1, "maximum": MAX_FRAMES},
                       "namePattern": {"type": "string", "description": "Batch names; {n} = 1-based position"},
                       "basePrompt": STRING, "negative": STRING},
                      description="Either a single frame object, {frames: [...]}, or {count, namePattern?, basePrompt?, negative?}"))
def add_frames(ctx):
    body = ctx.json()
    at = ctx.q_int("index", None, 0, MAX_FRAMES)

    def change(document):
        frames = frames_of(document)
        position = len(frames) if at is None else min(at, len(frames))
        if "count" in body:
            count = body["count"]
            if type(count) is not int or not 1 <= count <= MAX_FRAMES:
                raise ApiError(400, "invalid_field", "count must be 1..512")
            pattern = str(body.get("namePattern") or "第 {n} 幕")
            new = [{"id": "frame_" + uuid.uuid4().hex[:12], "name": pattern.replace("{n}", str(position + i + 1)),
                    "prompt": str(body.get("basePrompt") or ""), "negative": str(body.get("negative") or ""), "caption": ""}
                   for i in range(count)]
        elif "frames" in body:
            new = body["frames"]
            if not isinstance(new, list) or not new or any(not isinstance(f, dict) for f in new):
                raise ApiError(400, "invalid_field", "frames must be a non-empty array of objects")
            new = copy.deepcopy(new)
        else:
            new = [copy.deepcopy(body)]
        if len(frames) + len(new) > MAX_FRAMES:
            raise ApiError(400, "too_many_frames", "A storyboard holds at most 512 frames")
        taken = {f.get("id") for f in frames if isinstance(f, dict)}
        for offset, frame in enumerate(new):
            if frame.get("id") in taken:
                raise ApiError(409, "duplicate_frame", "Frame ID already exists: " + str(frame["id"]))
            normalize_frame(frame, position + offset)
            taken.add(frame["id"])
        frames[position:position] = new
        return {"index": position, "frames": new}

    payload, result = mutate(ctx, "storyboards", ctx.params["id"], change)
    return Reply({**result, "storyboardId": ctx.params["id"], "etag": payload["etag"], "revision": payload["revision"]},
                 status=201, headers={"ETag": quoted_etag(payload["etag"])})


@ROUTER.get("/library/storyboards/{id}/frames/{frame}", summary="读取一幕", tags=["storyboards"],
            params={**STORY, "frame": FRAME_REF}, response=FRAME)
def get_frame(ctx):
    record = read_entity(ctx.host, "storyboards", ctx.params["id"])
    frames = frames_of(record["document"])
    index = find_frame(frames, ctx.params["frame"])
    return Reply({**frames[index], "index": index}, headers={"ETag": quoted_etag(record["etag"])})


@ROUTER.patch("/library/storyboards/{id}/frames/{frame}", summary="合并补丁修改一幕（提示词、台词、镜头、尺寸…）",
              tags=["storyboards"], params={**STORY, "frame": FRAME_REF}, query=[IF_MATCH], body=FRAME)
def patch_frame(ctx):
    patch = ctx.json()

    def change(document):
        frames = frames_of(document)
        index = find_frame(frames, ctx.params["frame"])
        if "id" in patch and patch["id"] != frames[index].get("id") and any(
                isinstance(f, dict) and f.get("id") == patch["id"] for f in frames):
            raise ApiError(409, "duplicate_frame", "Frame ID already exists")
        frames[index] = normalize_frame(merge_patch(frames[index], patch), index)
        return {"index": index, "frame": frames[index]}

    payload, result = mutate(ctx, "storyboards", ctx.params["id"], change)
    return reply(payload, result)


@ROUTER.delete("/library/storyboards/{id}/frames/{frame}", summary="删除一幕", tags=["storyboards"],
               params={**STORY, "frame": FRAME_REF}, query=[IF_MATCH])
def delete_frame(ctx):
    def change(document):
        frames = frames_of(document)
        index = find_frame(frames, ctx.params["frame"])
        removed = frames.pop(index)
        return {"index": index, "removed": removed, "remaining": len(frames)}

    payload, result = mutate(ctx, "storyboards", ctx.params["id"], change)
    return reply(payload, result)


@ROUTER.post("/library/storyboards/{id}/frames/reorder", summary="调整分幕顺序（列出的分幕排在最前）", tags=["storyboards"],
             params=STORY, query=[IF_MATCH], body=obj({"ids": array(STRING, minItems=1)}, ["ids"]))
def reorder_frames(ctx):
    ids = ctx.json().get("ids")
    if not isinstance(ids, list) or not ids or len(set(map(str, ids))) != len(ids):
        raise ApiError(400, "invalid_field", "ids must be a non-empty array of unique frame IDs")

    def change(document):
        frames = frames_of(document)
        by_id = {f.get("id"): f for f in frames if isinstance(f, dict)}
        missing = [i for i in ids if i not in by_id]
        if missing:
            raise ApiError(404, "frame_not_found", "Unknown frame IDs: " + ", ".join(map(str, missing[:10])))
        head = [by_id[i] for i in ids]
        frames[:] = head + [f for f in frames if not (isinstance(f, dict) and f.get("id") in set(ids))]
        return {"order": [f.get("id") for f in frames]}

    payload, result = mutate(ctx, "storyboards", ctx.params["id"], change)
    return reply(payload, result)


# ------------------------------------------------------------------ preset entries (variables)

KEY = re.compile(r"^[^\W]\w{0,127}$", re.UNICODE)


def entries_of(document):
    entries = document.setdefault("entries", [])
    if not isinstance(entries, list):
        raise ApiError(409, "invalid_document", "The preset has no entry list")
    return entries


def preset_kind(ctx):
    kind = ctx.params["kind"]
    if kind not in ("characters", "scenes"):
        raise ApiError(404, "not_found", "Entries exist on characters and scenes presets only")
    return kind


@ROUTER.get("/library/{kind}/{id}/entries", summary="预设的全部变量条目", tags=["presets"], params=PRESET)
def list_entries(ctx):
    record = read_entity(ctx.host, preset_kind(ctx), ctx.params["id"])
    return Reply({"presetId": ctx.params["id"], "etag": record["etag"], "entries": entries_of(record["document"])},
                 headers={"ETag": quoted_etag(record["etag"])})


@ROUTER.put("/library/{kind}/{id}/entries/{key}", summary="写入一个变量（按变量名新增或覆盖）", tags=["presets"],
            params={**PRESET, "key": {"description": "Variable name (letters, digits, underscore)"}}, query=[IF_MATCH],
            body=obj({"value": {}, "type": {"type": "string", "description": "text | number | boolean | json | image | plugin:*"},
                      "groupId": STRING}, ["value"]))
def put_entry(ctx):
    key = ctx.params["key"]
    if not KEY.fullmatch(key) or key in ("__proto__", "constructor", "prototype"):
        raise ApiError(400, "invalid_key", "Variable names use letters, digits and underscores")
    body = ctx.json()
    if "value" not in body:
        raise ApiError(400, "invalid_field", "value is required")

    def change(document):
        entries = entries_of(document)
        existing = next((e for e in entries if isinstance(e, dict) and e.get("key") == key), None)
        created = existing is None
        if created:
            existing = normalize_entry({"key": key})
            entries.append(existing)
        existing.update({k: copy.deepcopy(v) for k, v in body.items() if k in ("value", "type", "groupId", "label", "description")})
        return {"entry": existing, "created": created}

    payload, result = mutate(ctx, preset_kind(ctx), ctx.params["id"], change)
    return reply(payload, result)


@ROUTER.delete("/library/{kind}/{id}/entries/{key}", summary="删除一个变量", tags=["presets"],
               params={**PRESET, "key": {"description": "Variable name"}}, query=[IF_MATCH])
def delete_entry(ctx):
    key = ctx.params["key"]

    def change(document):
        entries = entries_of(document)
        index = next((i for i, e in enumerate(entries) if isinstance(e, dict) and e.get("key") == key), None)
        if index is None:
            raise ApiError(404, "entry_not_found", "No variable with this name")
        return {"removed": entries.pop(index)}

    payload, result = mutate(ctx, preset_kind(ctx), ctx.params["id"], change)
    return reply(payload, result)


# ------------------------------------------------------------------ albums: document edits and steps

@ROUTER.patch("/albums/{albumId}", summary="合并补丁修改画册（标题、简介、标签、喜欢、封面…；同 /library/albums/{id}）",
              tags=["albums"], params=ALBUM, query=[IF_MATCH], body={"type": "object"})
def patch_album(ctx):
    patch = ctx.json()
    if patch.get("id", ctx.params["albumId"]) != ctx.params["albumId"]:
        raise ApiError(400, "id_mismatch", "The id cannot be changed")
    def change(document):
        merged = merge_patch(document, patch)
        document.clear()
        document.update(merged)

    payload, _ = mutate(ctx, "albums", ctx.params["albumId"], change)
    return Reply(payload, headers={"ETag": quoted_etag(payload["etag"])})


@ROUTER.delete("/albums/{albumId}", summary="删除画册（同时删除相关任务，进入回收站）", tags=["albums"], params=ALBUM,
               query=[IF_MATCH])
def delete_album(ctx):
    return remove_document(ctx.host, "albums", check_id(ctx.params["albumId"]), ctx.if_match())


@ROUTER.post("/albums", summary="新建画册（同 POST /library/albums；steps 的 image 可用 data URL）", tags=["albums"],
             body={"type": "object"}, status=201, body_limit=96 * 1024 * 1024, operation_id="createAlbum")
def create_album(ctx):
    payload = put_document(ctx.host, "albums", ctx.json(), create=True)
    payload.pop("created", None)
    return Reply(payload, status=201, headers={"ETag": quoted_etag(payload["etag"])})


def step_index(ctx):
    raw = ctx.params["index"]
    if not re.fullmatch(r"\d{1,3}", raw) or int(raw) >= 512:
        raise ApiError(400, "invalid_index", "index must be 0..511")
    return int(raw)


@ROUTER.get("/albums/{albumId}/steps/{index}", summary="读取画册的一页", tags=["albums"],
            params={**ALBUM, "index": {"schema": {"type": "integer", "minimum": 0, "maximum": 511}}})
def get_step(ctx):
    index = step_index(ctx)
    record = read_entity(ctx.host, "albums", ctx.params["albumId"])
    step = next((s for s in record["document"].get("steps", []) if isinstance(s, dict) and s.get("stepIndex") == index), None)
    if step is None:
        raise ApiError(404, "step_not_found", "This page has no content yet")
    return Reply({**step, "assetEndpoint": asset_endpoint(step.get("image"))}, headers={"ETag": quoted_etag(record["etag"])})


@ROUTER.patch("/albums/{albumId}/steps/{index}", summary="合并补丁修改一页（台词、提示词、名称、图片 URL/data URL）；页不存在时创建",
              tags=["albums"], params={**ALBUM, "index": {"schema": {"type": "integer", "minimum": 0, "maximum": 511}}},
              query=[IF_MATCH], body=obj({"caption": STRING, "prompt": STRING, "name": STRING,
                                          "image": {"type": "string", "description": "/images/... or data:image/... ('' clears)"}}),
              body_limit=64 * 1024 * 1024)
def patch_step(ctx):
    index = step_index(ctx)
    patch = {k: v for k, v in ctx.json().items() if k != "stepIndex"}

    def change(document):
        steps = document.setdefault("steps", [])
        step = next((s for s in steps if isinstance(s, dict) and s.get("stepIndex") == index), None)
        if step is None:
            step = {"stepIndex": index, "name": "", "caption": "", "prompt": "", "image": ""}
            steps.append(step)
            steps.sort(key=lambda s: s.get("stepIndex", 0) if isinstance(s, dict) else 0)
            document["totalSteps"] = max(int(document.get("totalSteps") or 0), index + 1)
        merged = merge_patch(step, patch)
        step.clear()
        step.update(merged)
        step["stepIndex"] = index
        return index

    payload, _ = mutate(ctx, "albums", ctx.params["albumId"], change)
    step = next(s for s in payload["document"]["steps"] if s.get("stepIndex") == index)
    return reply(payload, {"albumId": ctx.params["albumId"], "step": step})


@ROUTER.delete("/albums/{albumId}/steps/{index}", summary="删除一页的内容（图片、台词、提示词）", tags=["albums"],
               params={**ALBUM, "index": {"schema": {"type": "integer", "minimum": 0, "maximum": 511}}}, query=[IF_MATCH])
def delete_step(ctx):
    index = step_index(ctx)

    def change(document):
        steps = document.setdefault("steps", [])
        position = next((i for i, s in enumerate(steps) if isinstance(s, dict) and s.get("stepIndex") == index), None)
        if position is None:
            raise ApiError(404, "step_not_found", "This page has no content")
        return steps.pop(position)

    payload, removed = mutate(ctx, "albums", ctx.params["albumId"], change)
    return reply(payload, {"albumId": ctx.params["albumId"], "removed": removed})
