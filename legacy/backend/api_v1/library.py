"""Generic CRUD over the file library: every document kind the studio stores on disk.

All writes go through ``NativeStore.apply`` -- the same transaction the browser uses --
so image URLs / data URLs are localised into owned assets, documents are validated,
deletions leave a recycle-bin receipt and the workspace revision advances.
"""

import base64
import copy
import time
import uuid

from backend import mio_foundation, mio_lifecycle, mio_pictures
from backend.api_v1.common import ORDERING_FIELDS, PROJECT_SCOPED, WRITABLE_KINDS, active_project_id, \
    mutate_settings, ordering, write_lock
from backend.api_v1.core import ROUTER, ApiError, Raw, Reply, emit, merge_patch, quoted_etag
from backend.api_v1.spec import BOOLEAN, INTEGER, STRING, array, obj, qp, schema
from backend.mio_library import ID, KINDS, LibraryError

KIND_DESCRIPTIONS = {
    "storyboards": "分镜", "characters": "角色预设", "scenes": "场景预设", "collections": "画册集",
    "plans": "创作计划", "albums": "画册", "layouts": "导出版式", "workflows": "ComfyUI 工作流",
    "rows": "角色行（批量矩阵）", "conversations": "LLM 会话", "tasks": "浏览器队列任务（只读）",
}
KIND = {"schema": {"enum": list(KINDS)}, "description": "Resource kind: " + ", ".join(KINDS)}
ENTITY = {"kind": KIND, "id": {"description": "Resource ID ([A-Za-z0-9_-]{1,150})"}}
IF_MATCH_QUERY = qp("expectedEtag", description="Alternative to the If-Match header")
DOCUMENT = schema("LibraryDocument", {
    "type": "object", "additionalProperties": True,
    "description": "A full resource document. `id` is optional on create; `title` is required (1..500 chars). "
                   "Image fields accept /images/... URLs or data:image/... URLs; they are stored as owned assets."})
ENTITY_RESULT = schema("LibraryEntity", obj({
    "kind": STRING, "id": STRING, "etag": STRING, "revision": INTEGER, "document": DOCUMENT},
    ["kind", "id", "etag", "document"]))
SUMMARY = schema("LibrarySummary", obj({
    "kind": STRING, "id": STRING, "title": STRING, "projectId": STRING, "etag": STRING,
    "createdAt": {"type": "number"}, "updatedAt": {"type": "number"}, "document": DOCUMENT},
    ["kind", "id", "etag"], description="Index summary; `document` only with ?full=true"))


# ------------------------------------------------------------------ helpers

def check_kind(kind, write=False):
    if kind not in KINDS:
        raise ApiError(404, "unknown_kind", "Unknown library kind; use one of: " + ", ".join(KINDS))
    if write and kind not in WRITABLE_KINDS:
        raise ApiError(405, "read_only_kind", "tasks are managed by the production and jobs queues")
    return kind


def check_id(id):
    if not isinstance(id, str) or not ID.fullmatch(id) or id in ("__proto__", "prototype", "constructor"):
        raise ApiError(400, "invalid_id", "IDs must match [A-Za-z0-9_-]{1,150}")
    return id


def now_ms():
    return int(time.time() * 1000)


def new_id(kind):
    return KINDS[kind][1] + "_" + uuid.uuid4().hex


def deleted_albums(host):
    return set(mio_lifecycle.deleted_album_ids(host.DATA_DIR))


def read_entity(host, kind, id):
    check_id(id)
    if kind == "albums":
        if id in deleted_albums(host):
            raise ApiError(404, "not_found", "Album was deleted (see /recycle)")
        mio_foundation.materialize_album(host, id)
    return host.native_store().entity(kind, id)


def entity_payload(kind, id, etag, document, revision=None):
    payload = {"kind": kind, "id": id, "etag": etag, "document": document}
    if revision is not None:
        payload["revision"] = revision
    return payload


def collection_ids(host):
    return {row["id"] for row in host.native_store().records("collections")}


def default_project_id(host):
    """Target collection when a request names none: the active one, else the first existing one."""
    return active_project_id(host) or next(iter(sorted(collection_ids(host))), None)


def normalize(host, kind, doc, creating, touch=True):
    """Fill the fields the studio UI expects so API-created resources are first-class."""
    if not isinstance(doc, dict):
        raise ApiError(400, "invalid_body", "The document must be a JSON object")
    for key in ("etag", "file", "_lazy", "_cover", "_missingIndices", "_score", "schema", "kind", "_sourceFormat"):
        doc.pop(key, None)
    stamp = now_ms()
    if creating:
        doc.setdefault("createdAt", stamp)
    if touch:
        doc["updatedAt"] = stamp
    if kind in PROJECT_SCOPED:
        if not doc.get("projectId"):
            doc["projectId"] = default_project_id(host)
        if not doc.get("projectId"):
            raise ApiError(400, "collection_required", "Create a collection first (POST /library/collections)")
        if doc["projectId"] not in collection_ids(host):
            raise ApiError(400, "unknown_collection", "projectId does not name an existing collection")
    if kind == "storyboards":
        frames = doc.setdefault("frames", [])
        if not isinstance(frames, list):
            raise ApiError(400, "invalid_field", "frames must be an array")
        for index, frame in enumerate(frames):
            if isinstance(frame, dict):
                normalize_frame(frame, index)
        doc.setdefault("outline", "")
    elif kind in ("characters", "scenes"):
        doc["category"] = kind
        entries = doc.setdefault("entries", [])
        if not isinstance(entries, list):
            raise ApiError(400, "invalid_field", "entries must be an array")
        for entry in entries:
            if isinstance(entry, dict):
                normalize_entry(entry)
    elif kind == "albums":
        steps = doc.setdefault("steps", [])
        if not isinstance(steps, list):
            raise ApiError(400, "invalid_field", "steps must be an array")
        for index, step in enumerate(steps):
            if isinstance(step, dict):
                step.setdefault("stepIndex", index)
        from backend.mio_native_store import NativeStore

        NativeStore.album_defaults(doc)
        if doc.get("createdAt") == 0:
            doc["createdAt"] = stamp
        generated = sum(1 for s in steps if isinstance(s, dict) and s.get("image"))
        doc["generatedSteps"] = generated
        doc.setdefault("inProgress", False)
        if creating and doc.get("status") in (None, "partial"):
            doc["status"] = "complete" if generated >= doc.get("totalSteps", len(steps)) and steps else "partial"
    elif kind == "collections":
        doc.setdefault("description", "")
    return doc


def normalize_frame(frame, index):
    frame.setdefault("id", "frame_" + uuid.uuid4().hex[:12])
    frame.setdefault("name", "第 %d 幕" % (index + 1))
    for key in ("prompt", "negative", "caption"):
        frame.setdefault(key, "")
    return frame


def normalize_entry(entry):
    entry.setdefault("id", "var_" + str(uuid.uuid4()))
    entry.setdefault("type", "text")
    entry.setdefault("value", "")
    return entry


def save(host, kind, doc, expected, notify=True):
    """Write one document atomically; returns the stored entity payload."""
    id = check_id(doc.get("id"))
    with write_lock(host, (kind,)):
        if kind == "albums":
            if id in deleted_albums(host):
                raise ApiError(409, "album_deleted", "This album ID was deleted; restore it from /recycle or use a new ID")
            doc = mio_pictures.project({"savedGalleries": [doc]}, host.DATA_DIR)["savedGalleries"][0]
        result = host.native_store().apply([{"kind": kind, "id": id, "document": doc, "expected": expected}])
    key = kind + ":" + id
    if notify:
        emit(host, "library.saved", {"kind": kind, "id": id})
    return entity_payload(kind, id, result["revisions"][key], result["entities"][key], result["revision"])


def put_document(host, kind, document, expected=None, create=None, notify=True):
    """Create (no/unknown id) or replace one document. Shared by the API and the extension host.

    ``create=True`` refuses to overwrite; ``expected`` is the ETag the caller last read.
    """
    check_kind(kind, write=True)
    if not isinstance(document, dict):
        raise ApiError(400, "invalid_body", "document must be an object")
    doc = copy.deepcopy(document)
    doc["id"] = check_id(doc.get("id") or new_id(kind))
    current = current_or_none(host, kind, doc["id"])
    if create and current is not None:
        raise ApiError(409, "already_exists", "A resource with this ID already exists; use PUT to replace it")
    if current is None and expected:
        raise ApiError(409, "revision_conflict", "The resource does not exist (an expected ETag was given)")
    if current is not None:
        doc.setdefault("createdAt", current["document"].get("createdAt"))
    normalize(host, kind, doc, creating=current is None)
    payload = save(host, kind, doc, expected or (current["etag"] if current else None), notify)
    payload["created"] = current is None
    return payload


def remove_document(host, kind, id, expected=None, cascade=False, notify=True):
    """Move one resource (and, for collections with ``cascade``, its members) to the recycle bin."""
    check_kind(kind, write=True)
    store = host.native_store()
    current = read_entity(host, kind, id)
    if expected and expected != current["etag"]:
        raise ApiError(409, "revision_conflict", "The resource changed since it was read")
    if kind == "albums":
        data = mio_foundation.delete_albums(host, [id])
        if notify:
            emit(host, "library.deleted", {"kind": kind, "id": id})
        result = {"deleted": [{"kind": "albums", "id": album} for album in data.get("deletedAlbumIds", [id])],
                  "revision": store.revision()}
        if data.get("warning"):
            result["warning"] = data["warning"]
        return result
    members = []
    if kind == "collections":
        for member_kind in PROJECT_SCOPED:
            members += [(member_kind, row["id"]) for row in store.records(member_kind) if row.get("projectId") == id]
        if members and not cascade:
            counts = {}
            for member_kind, _ in members:
                counts[member_kind] = counts.get(member_kind, 0) + 1
            raise ApiError(409, "collection_not_empty",
                           "The collection still contains resources; pass cascade=true to delete them too", details=counts)
    deleted = []
    albums = [member_id for member_kind, member_id in members if member_kind == "albums"]
    if albums:
        mio_foundation.delete_albums(host, albums)
        deleted += [{"kind": "albums", "id": album} for album in albums]
    removals = [{"kind": kind, "id": id, "expected": current["etag"]}]
    for member_kind, member_id in members:
        if member_kind != "albums":
            removals.append({"kind": member_kind, "id": member_id, "expected": store.entity(member_kind, member_id)["etag"]})
    with write_lock(host, (kind,)):
        result = store.apply([], removals)
    for op in removals:
        deleted.append({"kind": op["kind"], "id": op["id"]})
        if notify:
            emit(host, "library.deleted", {"kind": op["kind"], "id": op["id"]})
    return {"deleted": deleted, "revision": result["revision"]}


def current_or_none(host, kind, id):
    try:
        return read_entity(host, kind, id)
    except LibraryError as exc:
        if exc.status == 404:
            return None
        raise
    except ApiError as exc:
        if exc.status == 404:
            return None
        raise


def entity_reply(payload, status=200):
    return Reply(payload, status=status, headers={"ETag": quoted_etag(payload["etag"])})


def summary_view(host, kind, row):
    item = {key: value for key, value in row.items() if key not in ("file",)}
    for key in ("_missingIndices", "_score"):
        if key in item:
            item[key[1:]] = item.pop(key)
    if kind == "albums" and row.get("cover"):
        item["cover"] = "/images/library/albums/" + row["id"] + "/" + row["cover"]
    item["kind"] = kind
    return item


def sorted_rows(host, kind, rows, sort):
    if sort == "id":
        return sorted(rows, key=lambda r: r["id"])
    if sort == "title":
        return sorted(rows, key=lambda r: (str(r.get("title", "")).lower(), r["id"]))
    if sort in ("updated", "created"):
        field = "updatedAt" if sort == "updated" else "createdAt"
        return sorted(rows, key=lambda r: (-(r.get(field) or 0) if isinstance(r.get(field), (int, float)) else 0, r["id"]))
    # Presets of both categories share one display order in the studio (`variableSets`).
    ids = display_order(host, kind)
    order = {id: index for index, id in enumerate(ids)}
    return sorted(rows, key=lambda r: (order.get(r["id"], len(order)), r["id"]))


def display_order(host, kind):
    if kind in ("characters", "scenes"):
        from backend.api_v1.common import read_path, settings_doc

        document, _ = settings_doc(host)
        values = read_path(document, "ordering", "variableSets", default=[])
        return [v for v in values if isinstance(v, str)] if isinstance(values, list) else []
    return ordering(host, kind)


# ------------------------------------------------------------------ overview and maintenance

@ROUTER.get("/library", summary="文件库概览：各类资源数量、是否可写、目录修订号与索引状态", tags=["library"])
def overview(ctx):
    store = ctx.store
    store.wait_index()
    hidden = deleted_albums(ctx.host)
    kinds = []
    for kind in KINDS:
        rows = store.records(kind)
        if kind == "albums":
            rows = [r for r in rows if r["id"] not in hidden]
        kinds.append({"kind": kind, "label": KIND_DESCRIPTIONS[kind], "count": len(rows), "writable": kind in WRITABLE_KINDS})
    return {"revision": store.revision(), "activeProjectId": active_project_id(ctx.host), "kinds": kinds,
            "problems": len(store.library.problems()), "index": dict(store.library.scan_state)}


@ROUTER.get("/library/problems", summary="文件问题：无法解析的文件、重复 ID", tags=["library", "workspace"])
def problems(ctx):
    return {"problems": ctx.store.library.problems()}


@ROUTER.post("/library/rescan", summary="重新扫描文件夹（手工复制文件后），返回问题列表", tags=["library", "workspace"])
def rescan(ctx):
    store = ctx.store
    store.library.scan()
    return {"ok": True, "revision": store.revision(), "problems": store.library.problems()}


# ------------------------------------------------------------------ collections of one kind

LIST_QUERY = [
    qp("limit", "integer", "1..200, default 50", minimum=1, maximum=200), qp("offset", "integer", minimum=0),
    qp("q", description="Case-insensitive match on title, ID and description"),
    qp("projectId", description="Only resources of this collection"),
    qp("status", description="Albums: complete / partial / generating / failed …"),
    qp("sort", {"enum": ["order", "id", "title", "updated", "created"]}, "Default: the studio's display order"),
    qp("full", "boolean", "Include each full document (max limit 50)")]


@ROUTER.get("/library/{kind}", summary="列出一类资源（分页、搜索、按画册集过滤、排序）", tags=["library"],
            params={"kind": KIND}, query=LIST_QUERY,
            response=obj({"items": array(SUMMARY), "total": INTEGER, "limit": INTEGER, "offset": INTEGER, "revision": INTEGER}))
def list_kind(ctx):
    kind = check_kind(ctx.params["kind"])
    full = ctx.q_bool("full")
    limit, offset = ctx.page(50, 50 if full else 200)
    store = ctx.store
    store.wait_index()
    rows = store.records(kind)
    if kind == "albums":
        hidden = deleted_albums(ctx.host)
        rows = [r for r in rows if r["id"] not in hidden]
    project, status = ctx.q("projectId"), ctx.q("status")
    query = (ctx.q("q") or "").strip().lower()
    if project:
        rows = [r for r in rows if r.get("projectId") == project]
    if status:
        rows = [r for r in rows if r.get("status") == status]
    if query:
        rows = [r for r in rows if any(query in str(r.get(k, "")).lower() for k in ("title", "id", "description"))]
    rows = sorted_rows(ctx.host, kind, rows, ctx.q("sort", "order"))
    items = []
    for row in rows[offset:offset + limit]:
        item = summary_view(ctx.host, kind, row)
        if full:
            item["document"] = read_entity(ctx.host, kind, row["id"])["document"]
        items.append(item)
    return {"items": items, "total": len(rows), "limit": limit, "offset": offset, "revision": store.revision()}


@ROUTER.post("/library/{kind}", summary="新建资源（请求体即文档；缺省 id 自动分配、projectId 默认当前画册集）",
             tags=["library"], params={"kind": KIND}, body=DOCUMENT, response=ENTITY_RESULT, status=201,
             body_limit=96 * 1024 * 1024)
def create(ctx):
    kind = check_kind(ctx.params["kind"], write=True)
    payload = put_document(ctx.host, kind, ctx.json(), create=True)
    payload.pop("created", None)
    return entity_reply(payload, 201)


@ROUTER.post("/library/{kind}/reorder", summary="调整界面中的显示顺序（列出的 ID 排在最前，其余保持原顺序）",
             tags=["library"], params={"kind": KIND}, body=obj({"ids": array(STRING, minItems=1)}, ["ids"]),
             response=obj({"kind": STRING, "order": array(STRING)}))
def reorder(ctx):
    kind = check_kind(ctx.params["kind"])
    ids = ctx.json().get("ids")
    if not isinstance(ids, list) or not ids or any(not isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
        raise ApiError(400, "invalid_field", "ids must be a non-empty array of unique IDs")
    existing = {row["id"] for row in ctx.store.records(kind)}
    unknown = [i for i in ids if i not in existing]
    if unknown:
        raise ApiError(404, "not_found", "Unknown IDs: " + ", ".join(unknown[:10]))
    field = ORDERING_FIELDS[kind]

    def change(document):
        order = document.setdefault("ordering", {})
        previous = [i for i in order.get(field, []) if isinstance(i, str)]
        rest = [i for i in previous if i not in ids] + sorted(existing - set(ids) - set(previous))
        order[field] = list(ids) + rest
        if kind in ("characters", "scenes"):
            # The studio lists both preset categories together in `variableSets`.
            combined = [i for i in order.get("variableSets", []) if isinstance(i, str)]
            slots = [n for n, i in enumerate(combined) if i in existing]
            mine = [i for i in order[field] if i in set(combined)] + [i for i in order[field] if i not in set(combined)]
            for slot, value in zip(slots, mine):
                combined[slot] = value
            combined += [i for i in mine[len(slots):] if i not in combined]
            order["variableSets"] = combined
        return order[field]

    result, _ = mutate_settings(ctx.host, "workspace", change)
    return {"kind": kind, "order": result}


# ------------------------------------------------------------------ one resource

@ROUTER.get("/library/{kind}/{id}", summary="读取完整文档（响应头带 ETag）", tags=["library"], params=ENTITY,
            response=ENTITY_RESULT)
def get_entity(ctx):
    kind = check_kind(ctx.params["kind"])
    record = read_entity(ctx.host, kind, ctx.params["id"])
    return entity_reply(entity_payload(kind, ctx.params["id"], record["etag"], record["document"]))


@ROUTER.put("/library/{kind}/{id}", summary="替换整个文档；不存在时创建（If-Match 做并发保护，If-None-Match: * 只创建）",
            tags=["library"], params=ENTITY, query=[IF_MATCH_QUERY], body=DOCUMENT, response=ENTITY_RESULT,
            body_limit=96 * 1024 * 1024)
def replace(ctx):
    kind = check_kind(ctx.params["kind"], write=True)
    id = check_id(ctx.params["id"])
    doc = copy.deepcopy(ctx.json())
    if doc.get("id", id) != id:
        raise ApiError(400, "id_mismatch", "The document id must match the URL")
    doc["id"] = id
    current = current_or_none(ctx.host, kind, id)
    if current is not None and ctx.header("If-None-Match").strip() == "*":
        raise ApiError(409, "already_exists", "The resource already exists")
    expected = ctx.if_match()
    if current is None and expected:
        raise ApiError(409, "revision_conflict", "The resource does not exist (If-Match was given)")
    if current is not None:
        doc.setdefault("createdAt", current["document"].get("createdAt"))
    normalize(ctx.host, kind, doc, creating=current is None)
    payload = save(ctx.host, kind, doc, expected if expected else (current["etag"] if current else None))
    return entity_reply(payload, 200 if current is not None else 201)


@ROUTER.patch("/library/{kind}/{id}", summary="合并补丁（RFC 7396：null 删除字段，对象递归合并，数组整体替换）",
              tags=["library"], params=ENTITY, query=[IF_MATCH_QUERY], body=DOCUMENT, response=ENTITY_RESULT,
              body_limit=96 * 1024 * 1024)
def patch_entity(ctx):
    kind = check_kind(ctx.params["kind"], write=True)
    id = check_id(ctx.params["id"])
    patch = ctx.json()
    if patch.get("id", id) != id:
        raise ApiError(400, "id_mismatch", "The id cannot be changed; duplicate the resource instead")
    current = read_entity(ctx.host, kind, id)
    expected = ctx.if_match()
    if expected and expected != current["etag"]:
        raise ApiError(409, "revision_conflict", "The resource changed since it was read")
    doc = merge_patch(current["document"], patch)
    doc["id"] = id
    normalize(ctx.host, kind, doc, creating=False, touch="updatedAt" not in patch)
    return entity_reply(save(ctx.host, kind, doc, current["etag"]))


@ROUTER.delete("/library/{kind}/{id}", summary="删除（移入回收站，可用 /recycle 恢复）；画册集默认拒绝删除非空集合",
               tags=["library"], params=ENTITY,
               query=[IF_MATCH_QUERY, qp("cascade", "boolean", "Collections: also delete every member resource")],
               response=obj({"deleted": array(obj({"kind": STRING, "id": STRING})), "revision": INTEGER}))
def delete_entity(ctx):
    kind = check_kind(ctx.params["kind"], write=True)
    return remove_document(ctx.host, kind, check_id(ctx.params["id"]), ctx.if_match(), ctx.q_bool("cascade"))


@ROUTER.post("/library/{kind}/{id}/duplicate", summary="复制资源（新 ID，标题加「副本」，图片一并复制）",
             tags=["library"], params=ENTITY, status=201, response=ENTITY_RESULT,
             body=obj({"id": STRING, "title": STRING, "projectId": STRING}), body_required=False)
def duplicate(ctx):
    kind = check_kind(ctx.params["kind"], write=True)
    body = ctx.json(required=False)
    source = read_entity(ctx.host, kind, ctx.params["id"])["document"]
    doc = copy.deepcopy(source)
    doc["id"] = check_id(body.get("id") or new_id(kind))
    if current_or_none(ctx.host, kind, doc["id"]) is not None:
        raise ApiError(409, "already_exists", "A resource with this ID already exists")
    doc["title"] = body.get("title") or (str(source.get("title") or source["id"]) + " 副本")[:500]
    if body.get("projectId"):
        doc["projectId"] = body["projectId"]
    doc.pop("createdAt", None)
    for field in ("frames", "entries"):
        for item in doc.get(field, []) if isinstance(doc.get(field), list) else []:
            if isinstance(item, dict):
                item.pop("id", None)
    if kind == "albums":
        # Steps already show the edited pictures; the edit history belongs to the source album.
        doc.pop("pictureEdits", None)
    normalize(ctx.host, kind, doc, creating=True)
    return entity_reply(save(ctx.host, kind, doc, None), 201)


@ROUTER.get("/library/{kind}/{id}/bundle", summary="导出为 .mio.zip 分享包（含图片，可再导入）", tags=["library"],
            params=ENTITY, produces={"application/zip": {"schema": {"type": "string", "format": "binary"}}})
def export_bundle(ctx):
    kind = check_kind(ctx.params["kind"])
    id = check_id(ctx.params["id"])
    read_entity(ctx.host, kind, id)
    raw = ctx.store.library.export_bundle(kind, id)
    return Raw(raw, mime="application/zip", filename=id + ".mio.zip")


# ------------------------------------------------------------------ import / inspect / export an unsaved document

IMPORT_BODY = obj({
    "zip": {"type": "string", "contentEncoding": "base64", "description": ".mio.zip share package (base64)"},
    "document": {"type": "object", "description": "A standalone resource JSON without images"},
    "html": {"type": "string", "description": "An exported Mio HTML album (albums only)"},
    "expectedKind": {"enum": ["albums", "storyboards", "characters", "scenes", "layouts", "workflows", "variables"]},
    "projectId": {"type": "string", "description": "Target collection; default: the active collection"},
    "include": obj({"storyboards": BOOLEAN, "variables": BOOLEAN}, description="HTML albums: also import embedded sources"),
})
IMPORT_QUERY = [qp("kind", description="Binary uploads: expected kind"), qp("projectId", description="Binary uploads: target collection")]


def _import_body(ctx):
    if ctx.is_binary():
        raw = ctx.raw_body()
        body = {"zip": base64.b64encode(raw).decode()}
        if ctx.q("kind"):
            body["expectedKind"] = ctx.q("kind")
        if ctx.q("projectId"):
            body["projectId"] = ctx.q("projectId")
    else:
        body = dict(ctx.json())
    if not any(key in body for key in ("zip", "document", "html")):
        raise ApiError(400, "invalid_body", "Send a .mio.zip (binary or base64 `zip`), a `document` or an `html` album")
    return body


@ROUTER.post("/library/inspect", summary="预览待导入的分享包 / JSON / HTML 画册（只读）", tags=["library"],
             body=IMPORT_BODY, binary_body=["application/zip"], query=IMPORT_QUERY, body_limit=860 * 1024 * 1024)
def inspect(ctx):
    from backend import mio_resource_sharing as sharing

    body = _import_body(ctx)
    store = ctx.store
    if "html" in body:
        from backend import mio_album_html

        return mio_album_html.inspect(store, body)
    kind, doc, assets = sharing.inspect_resource(store, body)
    return {"ok": True, "kind": kind, "title": doc["title"],
            "count": len(doc.get("steps", doc.get("frames", doc.get("entries", [])))), "images": len(assets),
            "storyboards": int(bool(doc.get("sharedSources", {}).get("storyboard"))),
            "variables": int(bool(doc.get("sharedSources", {}).get("variables")))}


@ROUTER.post("/library/import", summary="导入分享包 / JSON / HTML 画册为新资源（总是分配新 ID）", tags=["library"],
             body=IMPORT_BODY, binary_body=["application/zip"], query=IMPORT_QUERY, status=201,
             body_limit=860 * 1024 * 1024)
def import_resource(ctx):
    from backend import mio_resource_sharing as sharing

    body = _import_body(ctx)
    if not body.get("projectId"):
        body["projectId"] = default_project_id(ctx.host)
    store = ctx.store
    with write_lock(ctx.host, ("albums",)):
        if "html" in body:
            from backend import mio_album_html

            body.setdefault("expectedKind", "albums")
            result = mio_album_html.import_html(store, body)
        else:
            result = sharing.import_resource(store, body)
    emit(ctx.host, "import.finished", {"source": "api", **{k: v for k, v in result.items() if k in ("kind", "id", "ids")}})
    return result


@ROUTER.post("/library/export", summary="把一份（未保存的）文档打包成 .mio.zip", tags=["library"],
             body=obj({"kind": {"enum": ["albums", "storyboards", "characters", "scenes", "layouts", "workflows"]},
                       "document": {"type": "object"}}, ["kind", "document"]),
             produces={"application/zip": {"schema": {"type": "string", "format": "binary"}}}, body_limit=96 * 1024 * 1024)
def export_document(ctx):
    from backend import mio_resource_sharing as sharing

    body = ctx.json()
    raw = sharing.export_document(ctx.store, body.get("kind"), body.get("document"))
    name = (body.get("document") or {}).get("id") or "resource"
    return Raw(raw, mime="application/zip", filename=str(name) + ".mio.zip")
