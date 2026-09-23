"""Additional ``/api/v1`` routes for external integrations (e.g. the AstrBot plugin).

Everything here sits behind the same Bearer token check as the rest of the
external API (see ``mio_api.handle``). It exposes, read-only, the catalogue a
bot needs to *pick resources by number* — workflows, storyboards, presets
(variable sets), export layouts and image channels — plus album detail,
server-side album export (HTML with a layout / ZIP / PDF) and the production
(assembly) queue that turns「workflow + storyboard + presets」into an album.

Routes (all relative to /api/v1/):
  GET  catalog                       everything below in one response
  GET  resources/workflows           [{id,title,outputNodeId,nodeCount,bindingCount,updatedAt}]
  GET  resources/characters|scenes   variable-set presets of one category
  GET  resources/presets             both categories, each item carries ``category``
  GET  resources/layouts             export templates (without the html body)
  GET  resources/channels            image generation profiles (no credentials)
  GET  resources/collections         projects (id/title) for context
  GET  albums/<id>                   album document with per-step asset endpoints
  POST albums/export                 {albumIds, format: html|zip|pdf, layoutId?, imageProfile?, ...} -> file
  *    production/<route>            forwarded to backend.production.api (assemble/start/tasks/...)
"""

import json
import urllib.parse

from backend.mio_library import LibraryError


def _reply(handler, request_id, status, data=None, error=None):
    payload = {"error": error, "requestId": request_id} if error else {"data": data, "requestId": request_id}
    handler.send_json(status, payload)


def _config(backend):
    store = backend.native_store()
    with backend.CONFIG_LOCK:
        return store, store.read(album_summaries=True)


def _preset_view(item, category=None):
    entries = []
    for entry in item.get("entries", []) if isinstance(item.get("entries"), list) else []:
        if not isinstance(entry, dict):
            continue
        value = entry.get("value")
        if isinstance(value, str) and value.startswith("data:"):
            value = "[image]"
        entries.append({"key": entry.get("key"), "type": entry.get("type", "text"), "value": value if isinstance(value, (str, int, float, bool)) or value is None else str(value)})
    return {
        "id": item.get("id"),
        "title": item.get("title", ""),
        "projectId": item.get("projectId"),
        "category": category or ("scenes" if item.get("category") == "scenes" else "characters"),
        "entries": entries,
        "updatedAt": item.get("updatedAt"),
    }


def workflows(config):
    items = []
    for wf in config.get("comfyWorkflows", []) or []:
        if not isinstance(wf, dict):
            continue
        graph = wf.get("workflow") if isinstance(wf.get("workflow"), dict) else {}
        classes = sorted({str(n.get("class_type")) for n in graph.values() if isinstance(n, dict) and n.get("class_type")})
        items.append(
            {
                "id": wf.get("id"),
                "title": wf.get("title", ""),
                "outputNodeId": wf.get("outputNodeId", ""),
                "nodeCount": len(graph),
                "bindingCount": len(wf.get("bindings") or []),
                "classTypes": classes[:40],
                "updatedAt": wf.get("updatedAt"),
            }
        )
    return items


def storyboards(config):
    items = []
    for sb in config.get("templates", []) or []:
        if not isinstance(sb, dict):
            continue
        frames = sb.get("frames") if isinstance(sb.get("frames"), list) else []
        items.append(
            {
                "id": sb.get("id"),
                "title": sb.get("title", ""),
                "projectId": sb.get("projectId"),
                "outline": sb.get("outline") or sb.get("description") or "",
                "frameCount": len(frames),
                "frames": [{k: f.get(k) for k in ("id", "name", "camera", "prompt", "caption", "width", "height") if k in f} for f in frames if isinstance(f, dict)],
                "updatedAt": sb.get("updatedAt"),
            }
        )
    return items


def presets(config, category=None):
    items = []
    for item in config.get("uiConfig", {}).get("comfyStudio", {}).get("creation", {}).get("variableSets", []) or []:
        if not isinstance(item, dict):
            continue
        cat = "scenes" if item.get("category") == "scenes" else "characters"
        if category and cat != category:
            continue
        items.append(_preset_view(item, cat))
    return items


def layouts(config):
    items = []
    for t in config.get("uiConfig", {}).get("comfyStudio", {}).get("exportTemplates", []) or []:
        if not isinstance(t, dict) or not isinstance(t.get("layout"), str):
            continue
        items.append(
            {
                "id": t.get("id"),
                "title": t.get("title", ""),
                "description": t.get("description", ""),
                "layout": t.get("layout"),
                "author": t.get("author", ""),
                "version": t.get("version", ""),
                "builtin": bool(t.get("builtin")),
                "options": t.get("options") if isinstance(t.get("options"), dict) else {},
                "updatedAt": t.get("updatedAt"),
            }
        )
    return items


def channels(config):
    profiles = config.get("uiConfig", {}).get("comfyStudio", {}).get("settings", {}).get("imageGeneration", {}).get("profiles", []) or []
    out = []
    for p in profiles:
        if not isinstance(p, dict):
            continue
        out.append(
            {
                **{k: p.get(k) for k in ("id", "title", "provider", "model", "protocol", "keyMode", "size", "quality", "sampler") if k in p},
                "usesWorkflow": p.get("provider") == "comfyui",
            }
        )
    return out


def collections(config):
    return [
        {"id": c.get("id"), "title": c.get("title", ""), "description": c.get("description", "")}
        for c in config.get("uiConfig", {}).get("comfyStudio", {}).get("projects", []) or []
        if isinstance(c, dict)
    ]


def catalog(config):
    return {
        "workflows": workflows(config),
        "storyboards": storyboards(config),
        "presets": presets(config),
        "layouts": layouts(config),
        "channels": channels(config),
        "collections": collections(config),
        "comfyBaseUrl": (config.get("comfyConfig") or {}).get("baseUrl", ""),
        "revision": config.get("updatedAt"),
    }


def album_detail(store, album_id):
    document = store.entity("albums", album_id)["document"]
    steps = []
    for step in document.get("steps", []) if isinstance(document.get("steps"), list) else []:
        if not isinstance(step, dict):
            continue
        image = step.get("image") if isinstance(step.get("image"), str) else ""
        steps.append(
            {
                **{k: step.get(k) for k in ("stepIndex", "name", "caption", "prompt", "width", "height", "seed") if k in step},
                "image": image,
                "assetEndpoint": "/api/v1/assets?" + urllib.parse.urlencode({"path": image}) if image.startswith("/images/") else "",
            }
        )
    return {
        **{k: document.get(k) for k in ("id", "projectId", "title", "characterName", "templateId", "templateTitle", "synopsis", "tags", "totalSteps", "generatedSteps", "status", "createdAt", "updatedAt", "completedAt") if k in document},
        "steps": steps,
    }


def dispatch(handler, backend, route, query, request_id):
    """Return True when the route was handled (response already sent)."""
    method = handler.command
    is_production = route.startswith("production/")
    is_resource = route == "catalog" or (
        route.startswith("resources/")
        and route.split("/")[1] in ("workflows", "characters", "scenes", "presets", "layouts", "channels", "collections")
    )
    is_album = route.startswith("albums/") and route not in ("albums/delete", "albums/page", "albums/page-edits")
    if not (is_production or is_resource or is_album):
        return False
    try:
        if is_production:
            from backend.production import api as production_api

            rest = route[len("production/") :]
            if not production_api.dispatch(handler, backend, "/api/production/" + rest):
                _reply(handler, request_id, 404, error={"code": "not_found", "message": "Unknown production endpoint"})
            return True
        if is_resource:
            if method != "GET":
                _reply(handler, request_id, 405, error={"code": "method_not_allowed", "message": "Read-only endpoint"})
                return True
            _, config = _config(backend)
            if route == "catalog":
                data = catalog(config)
            else:
                kind = route.split("/")[1]
                if kind == "workflows":
                    items = workflows(config)
                elif kind in ("characters", "scenes"):
                    items = presets(config, kind)
                elif kind == "presets":
                    items = presets(config)
                elif kind == "layouts":
                    items = layouts(config)
                elif kind == "channels":
                    items = channels(config)
                else:
                    items = collections(config)
                data = {"items": items, "total": len(items), "revision": config.get("updatedAt")}
            _reply(handler, request_id, 200, data)
            return True
        # albums/<id> and albums/export
        store, config = _config(backend)
        rest = route[len("albums/") :]
        if rest == "export":
            if method != "POST":
                _reply(handler, request_id, 405, error={"code": "method_not_allowed", "message": "POST a JSON body"})
                return True
            body = handler.read_json_body(max_bytes=256 * 1024)
            if not isinstance(body, dict):
                raise LibraryError("导出请求必须是 JSON 对象")
            fmt = body.get("format", "html")
            if fmt == "html":
                from backend import mio_layout_export

                mio_layout_export.stream_html_export(handler, store, config, body)
            elif fmt in ("zip", "pdf"):
                from backend import mio_export

                mio_export.stream_export(handler, store, body)
            else:
                raise LibraryError("format 只支持 html、zip 或 pdf")
            return True
        if method != "GET" or "/" in rest or not rest:
            _reply(handler, request_id, 404, error={"code": "not_found", "message": "Unknown album endpoint"})
            return True
        _reply(handler, request_id, 200, album_detail(store, urllib.parse.unquote(rest)))
        return True
    except LibraryError as exc:
        status = getattr(exc, "status", 400) or 400
        _reply(handler, request_id, status, error={"code": "not_found" if status == 404 else "invalid_request", "message": str(exc)})
    except KeyError:
        _reply(handler, request_id, 404, error={"code": "not_found", "message": "Not found"})
    except backend.PayloadTooLargeError:
        _reply(handler, request_id, 413, error={"code": "payload_too_large", "message": "Request exceeds the body size limit"})
    except (ValueError, TypeError) as exc:
        _reply(handler, request_id, 400, error={"code": "invalid_request", "message": str(exc)[:300]})
    except Exception:
        _reply(handler, request_id, 500, error={"code": "internal_error", "message": "The request could not be completed"})
    return True
