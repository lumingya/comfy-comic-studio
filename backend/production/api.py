"""Same-origin assembly boundary. Source references are resolved and copied here."""

import copy
import hashlib
import json
from pathlib import Path
import re
import secrets
import threading
import time
from backend.mio_library import LibraryError, atomic_write, image_type
from backend.ecosystem import api as ecosystem_api
from backend.ecosystem.workflow import compile_workflow
from backend.ecosystem import workflow_slots
from backend.mio_channels import resolve_channel, config_fields, workflow_provider
from backend.providers.registry import PROVIDERS


def capability(provider, name):
    try:
        return PROVIDERS.spec(provider)["capabilities"].get(name)
    except LibraryError:
        return False
from .queue import ProductionQueue

LOCK = threading.RLock()


def durable_assets(host, value):
    if isinstance(value, str) and value.startswith("/images/"):
        from backend.mio_media import link_asset, immutable_name

        source = host.native_store().image_path(value)
        name = immutable_name(source)
        link_asset(source, Path(host.DATA_DIR) / "assets/images" / name)
        return "/images/assets/" + name
    if isinstance(value, dict):
        return {k: durable_assets(host, v) for k, v in value.items()}
    if isinstance(value, list):
        return [durable_assets(host, v) for v in value]
    return value


def typed(entry):
    value = entry.get("value", "")
    kind = entry.get("type", "text")
    if kind == "number":
        return float(value or 0)
    if kind == "boolean":
        return value is True or value == "true"
    if kind == "json":
        return json.loads(value) if isinstance(value, str) and value else value or {}
    if kind not in ("text", "image"):
        raise LibraryError("生产端不接受未解析的插件类型，请使用标准类型保存预设")
    return value


def interpolate(text, values, images=None, *, literal_unknown=True, known=None, missing=None):
    blanks = []
    raw = str(text or "")

    def record(key):
        blanks.append(key)
        if missing is not None and key not in missing:
            missing.append(key)
        return ""

    def replace(match):
        start, end = match.span()
        # Skip double/nested braces like {{...}}
        if (start > 0 and raw[start - 1] == "{") or (end < len(raw) and raw[end] == "}"):
            return match.group(0)
        # Skip odd number of escaping backslashes like \{...\}
        slashes = 0
        k = start - 1
        while k >= 0 and raw[k] == "\\":
            slashes += 1
            k -= 1
        if slashes % 2 == 1:
            return match.group(0)
        key = match.group(1)
        if key not in values:
            if known is not None:
                if key in known:
                    return record(key)
                return match.group(0)
            if literal_unknown:
                return match.group(0)
            if missing is not None:
                return record(key)
            raise LibraryError("缺少变量：" + key)
        value = values[key]
        if isinstance(value, dict) and value.get("kind") == "mio-image":
            if images is None:
                blanks.append(key)
                return ""
            if not value.get("src"):
                raise LibraryError("图片变量为空：" + key)
            if value["src"] not in images:
                images.append(value["src"])
            return "@image_" + str(images.index(value["src"]) + 1)
        rendered = (
            json.dumps(value, ensure_ascii=False)
            if isinstance(value, (dict, list))
            else str(value if value is not None else "")
        )
        if not rendered.strip():
            blanks.append(key)
        return rendered

    result = re.sub(r"\{([\w]+)\}", replace, raw)
    # Only texts that actually lost a variable get tidied, so prompts without
    # blanks stay byte-identical to what the author wrote.
    return tidy_separators(result) if blanks else result


def tidy_separators(text):
    """Collapse the ", ," and leading/trailing commas that blank variables leave."""
    if not text:
        return text
    cleaned = re.sub(r"[ \t]*,(?:[ \t]*,)+", ",", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return re.sub(r"^[ \t,]+|[ \t,]+$", "", cleaned, flags=re.M)


def frame_seed(snapshot, index, explicit=-1):
    """Seed for one frame: explicit > reproducible base+index > fresh random.

    Without the reproducible switch every frame (and every rerun) gets its own
    seed, so a book never collapses into near-identical pages.
    """
    if isinstance(explicit, (int, float)) and explicit >= 0:
        return int(explicit) % 2**32
    if snapshot.get("seedEnabled"):
        return (int(snapshot.get("seed", 1)) + index) % 2**32
    return secrets.randbelow(2**32)


IMAGE_TOKEN = re.compile(r"^mio-image://(\d+)$")


def _image_slots(workflow):
    """1-based slots referenced by mio-image:// tokens anywhere in a compiled graph."""
    found = set()

    def walk(value):
        if isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, str):
            match = IMAGE_TOKEN.match(value)
            if match:
                found.add(int(match[1]))

    walk(workflow)
    return found


def prune_unbound_images(workflow, images):
    """Keep only the staged images some node actually consumes (C2).

    Image variables referenced from a prompt are staged for cloud providers,
    but a text-to-image ComfyUI graph has no LoadImage binding for them. Rather
    than failing the frame with "Unbound image N", drop those images and
    renumber the remaining tokens so slot numbers stay contiguous.

    Returns (workflow, images, dropped).
    """
    used = _image_slots(workflow)
    keep = [slot for slot in range(1, len(images) + 1) if slot in used]
    if len(keep) == len(images):
        return workflow, list(images), []
    remap = {old: new for new, old in enumerate(keep, start=1)}

    def walk(value):
        if isinstance(value, dict):
            return {k: walk(v) for k, v in value.items()}
        if isinstance(value, list):
            return [walk(v) for v in value]
        if isinstance(value, str):
            match = IMAGE_TOKEN.match(value)
            if match and int(match[1]) in remap:
                return "mio-image://" + str(remap[int(match[1])])
        return value

    dropped = [images[slot - 1] for slot in range(1, len(images) + 1) if slot not in used]
    return walk(workflow), [images[slot - 1] for slot in keep], dropped


def positive_binding_target(workflow):
    """The node/field that receives the positive prompt; the LoRA syntax fallback writes there."""
    for binding in workflow.get("bindings", []):
        if binding.get("enabled") and binding.get("source") == "positive" and binding.get("nodeId"):
            return {"nodeId": str(binding["nodeId"]), "path": str(binding.get("path") or "text")}
    return None


def slot_overrides(body, workflow, uses_workflow):
    """Validate the task-level model / LoRA overrides against the frozen workflow's slots.

    ``None`` means the assembly keeps the blueprint untouched. Anything else is normalised
    (names, strengths, duplicates) and dry-run against the blueprint so an impossible request
    (no model slot, stack overflow, linked field) fails at assembly time instead of in the queue.
    """
    raw = body.get("overrides")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise LibraryError("模型 / LoRA 覆盖必须是对象")
    if not uses_workflow:
        if raw.get("model") or raw.get("loras"):
            raise LibraryError("只有 ComfyUI 工作流渠道支持模型 / LoRA 覆盖")
        return None
    clean = workflow_slots.normalize_overrides(raw)
    if not clean:
        return None
    graph = workflow.get("workflow") if isinstance(workflow.get("workflow"), dict) else {}
    workflow_slots.apply(graph, workflow.get("slots"), clean, workflow.get("objectInfo"), positive_binding_target(workflow))
    return clean


def seed_binding_ready(workflow):
    """True when an enabled binding writes this frame's seed into a numeric input.

    Mirrors ``designerSeedReady`` in js/architecture.js: a ``random`` source or
    a scene-parameter mapping of ``seed`` both qualify (C1).
    """
    from backend.ecosystem.workflow import is_seed_binding

    for binding in workflow.get("bindings", []):
        if not binding.get("enabled") or not is_seed_binding(binding):
            continue
        try:
            graph = workflow.get("workflow", {})
            node = graph[str(binding["nodeId"])]["inputs"]
            path = str(binding["path"])
            parts = path[1:].split("/") if path.startswith("/") else path.split(".")
            for part in parts:
                node = (
                    node[int(part)]
                    if isinstance(node, list)
                    else node[part.replace("~1", "/").replace("~0", "~")]
                )
            if type(node) in (int, float):
                return True
        except (KeyError, ValueError, IndexError, TypeError):
            continue
    return False


class ProductionAdapter:
    def __init__(self, host, eco):
        self.report = lambda *_: None
        self.host = host
        self.eco = eco

    def snapshot(self, body):
        store = self.host.native_store()
        presets = []
        preview = body.get("preview") is True
        if preview:
            prompt = body.get("previewPrompt", "")
            if (
                not isinstance(prompt, str)
                or not prompt.strip()
                or len(prompt) > 100000
            ):
                raise LibraryError("请填写有效试绘描述")
            story = {
                "title": "预设独立试绘",
                "frames": [
                    {"name": "独立试绘", "prompt": prompt, "caption": "", "seed": -1}
                ],
            }
        else:
            story = store.entity("storyboards", body["storyId"])["document"]
        if len(body.get("presets", [])) > 20:
            raise LibraryError("一次装配最多 20 份预设")
        for reference in body.get("presets", []):
            if reference.get("kind") not in ("characters", "scenes"):
                raise LibraryError("只能装配角色或场景预设")
            presets.append(store.entity(reference["kind"], reference["id"])["document"])
        config = store.read(include_baseline=False)
        channels = (
            config.get("uiConfig", {})
            .get("comfyStudio", {})
            .get("settings", {})
            .get("imageGeneration", {})
        )
        profile = next(
            (
                p
                for p in channels.get("profiles", [])
                if p.get("id") == body.get("channelId")
            ),
            None,
        )
        if not profile:
            raise LibraryError("请选择并保存有效图像渠道")
        profile = copy.deepcopy(profile)
        if not PROVIDERS.has(profile.get("provider")):
            raise LibraryError("渠道使用的图像提供方「" + str(profile.get("provider")) + "」未注册；请启用对应扩展或更换渠道")
        uses_workflow = workflow_provider(profile.get("provider"))
        if uses_workflow:
            profile["baseUrl"] = config.get("comfyConfig", {}).get("baseUrl", "")
        workflow = copy.deepcopy(config.get("comfyConfig", {}))
        if uses_workflow and body.get("workflowId"):
            selected = next(
                (
                    w
                    for w in config.get("comfyWorkflows", [])
                    if w.get("id") == body["workflowId"]
                ),
                None,
            )
            if not selected:
                raise LibraryError("所选工作流不存在，请重新选择")
            if (
                not isinstance(selected.get("workflow"), dict)
                or not selected["workflow"]
            ):
                raise LibraryError("所选工作流为空，请先导入有效节点图")
            workflow.update(
                {
                    "id": selected["id"],
                    "title": selected.get("title", ""),
                    "workflow": copy.deepcopy(selected["workflow"]),
                    "bindings": copy.deepcopy(selected.get("bindings", [])),
                    "outputNodeId": selected.get("outputNodeId", ""),
                    "slots": copy.deepcopy(selected.get("slots") or {}),
                }
            )
        # Freeze only what rendering needs: node definitions for the classes in
        # this graph (a full /object_info can run to tens of MiB) and no catalog.
        graph = workflow.get("workflow") if isinstance(workflow.get("workflow"), dict) else {}
        classes = {n.get("class_type") for n in graph.values() if isinstance(n, dict)}
        info = workflow.get("objectInfo") if isinstance(workflow.get("objectInfo"), dict) else {}
        workflow["objectInfo"] = {k: v for k, v in info.items() if k in classes}
        workflow.pop("modelCatalog", None)
        overrides = slot_overrides(body, workflow, uses_workflow)
        seed_enabled = body.get("seedEnabled") is True and uses_workflow
        if seed_enabled and not seed_binding_ready(workflow):
            raise LibraryError("请先配置所选工作流中的有效种子节点映射")
        global_negative = (
            config.get("uiConfig", {})
            .get("comfyStudio", {})
            .get("settings", {})
            .get("negative", "")
        )
        seed = body.get("seed", 1)
        if type(seed) is not int or not 0 <= seed < 2**32:
            raise LibraryError("种子必须为 uint32 整数")
        project_id = body.get("projectId") or story.get("projectId")
        snapshot = durable_assets(
            self.host,
            {
                "story": story,
                "presets": presets,
                "knownVariables": self.collection_variable_names(store, config, project_id, presets),
                "channel": {
                    k: copy.deepcopy(profile[k]) for k in config_fields(profile["provider"]) if k in profile
                },
                "workflow": workflow,
                "globalNegative": global_negative if isinstance(global_negative, str) else "",
                "overrides": overrides,
                "seedEnabled": seed_enabled,
                "projectId": project_id,
                "seed": seed,
                "preview": preview,
                "previewPresetId": (
                    presets[0]["id"] if preview and len(presets) == 1 else None
                ),
            },
        )
        # Extensions may rewrite the whole book before it enters the queue
        # (translate prompts, inject style presets, pick another channel).
        return self.eco.hooks.apply(
            "assemble.before", snapshot, {"title": body.get("title"), "preview": preview}
        )

    @staticmethod
    def collection_variable_names(store, config, project_id, presets):
        """Every variable key the collection defines (all presets, book settings and
        scene overrides), so a {token} can be told apart from authored braces even
        when the selected presets do not provide it."""
        names = set()
        for preset in presets:
            for entry in preset.get("entries", []) or []:
                if isinstance(entry, dict) and entry.get("key"):
                    names.add(str(entry["key"]))
        creation = config.get("uiConfig", {}).get("comfyStudio", {}).get("creation", {})
        if not isinstance(creation, dict):
            return sorted(names)
        for item in creation.get("variableSets", []) or []:
            if not isinstance(item, dict) or (project_id and item.get("projectId") not in (None, project_id)):
                continue
            entries = item.get("entries")
            if item.get("_lazy") or entries is None:
                try:
                    kind = "scenes" if item.get("category") == "scenes" else "characters"
                    entries = store.entity(kind, item.get("id"))["document"].get("entries", [])
                except Exception:
                    entries = []
            for entry in entries or []:
                if isinstance(entry, dict) and entry.get("key"):
                    names.add(str(entry["key"]))
        for plan in creation.get("plans", []) or []:
            if not isinstance(plan, dict) or (project_id and plan.get("projectId") not in (None, project_id)):
                continue
            for entry in plan.get("variables", []) or []:
                if isinstance(entry, dict) and entry.get("key"):
                    names.add(str(entry["key"]))
            for override in (plan.get("sceneOverrides") or {}).values():
                for entry in (override or {}).get("variables", []) or []:
                    if isinstance(entry, dict) and entry.get("key"):
                        names.add(str(entry["key"]))
        return sorted(names)

    def prepare(self, task, cancel):
        entries = {}
        for preset in task["snapshot"]["presets"]:
            for entry in preset.get("entries", []):
                value = copy.deepcopy(entry)
                if not value.get("compute"):
                    value["value"] = typed(value)
                entries[value["key"]] = value
        # Syntax/dependency validation and all model calls occur only on explicit start.
        id = self.eco.macros.start(
            {
                "owner": task["id"],
                "seed": task["snapshot"]["seed"],
                "entries": list(entries.values()),
                "trusted": True,
                "force": task.get("forcePrepare", False),
            }
        )["id"]
        while True:
            if cancel.is_set():
                self.eco.macros.cancel(id)
                raise InterruptedError("前置准备已取消")
            record = self.eco.macros.get(id)
            if record["status"] == "complete":
                values = durable_assets(self.host, record["values"])
                values = self.eco.hooks.apply("prepare.after", values, {"task": task_context(task)})
                notices = self.validate_frames(task, values)
                self.eco.events.emit("task.prepared", task_context(task))
                return {"values": values, "preparationId": id, "notices": notices}
            if record["status"] in ("failed", "cancelled", "interrupted"):
                raise LibraryError(record.get("error", "前置准备未完成"))
            cancel.wait(0.1)

    @staticmethod
    def known_variables(snap, values):
        """Variable names the collection defines; unknown braces outside this set are authored text."""
        return set(snap.get("knownVariables") or []) | set(values or {})

    def validate_frames(self, task, values):
        """Report template variables no selected preset provides.

        Missing variables no longer block the run: they are rendered blank and
        the notice travels with the task so the creator sees it on the card.
        """
        snap = task["snapshot"]
        known = self.known_variables(snap, values)
        by_key = {}
        for index, frame in enumerate(snap["story"]["frames"]):
            missing = []
            interpolate(frame.get("prompt", ""), values, [], literal_unknown=True, known=known, missing=missing)
            interpolate(frame.get("caption", ""), values, literal_unknown=False, known=known, missing=missing)
            negative = frame.get("negative", "")
            if not str(negative or "").strip():
                negative = snap.get("globalNegative", "")
            interpolate(negative, values, [], literal_unknown=True, known=known, missing=missing)
            for key in missing:
                by_key.setdefault(key, []).append(index + 1)
        if not by_key:
            return []
        keys = "、".join("{" + key + "}" for key in by_key)
        scenes = sorted({index for indices in by_key.values() for index in indices})
        return [
            "存在变量 " + keys + " 未定义（第 " + "、".join(str(i) for i in scenes) + " 幕），已替换为空。"
        ]

    def render(self, task, index, cancel):
        snap = task["snapshot"]
        frame = snap["story"]["frames"][index]
        values = task["prepared"]["values"]
        known = self.known_variables(snap, values)
        images = []
        prompt = interpolate(frame.get("prompt", ""), values, images, literal_unknown=True, known=known)
        caption = interpolate(frame.get("caption", ""), values, literal_unknown=False, known=known, missing=[])
        negative_source = frame.get("negative", "")
        if not str(negative_source or "").strip():
            # Scenes without their own negative inherit the studio-wide one,
            # matching the legacy browser path and the reader's expectation.
            negative_source = snap.get("globalNegative", "")
        negative = interpolate(negative_source, values, images, literal_unknown=True, known=known)
        config = self.host.native_store().read(include_baseline=False)
        live = resolve_channel(
            config, snap["channel"]["id"], snap["channel"]["provider"]
        )
        channel = copy.deepcopy(snap["channel"])
        for key in ("keyId", "keyIds", "keyMode"):
            channel.pop(key, None)
        channel.update({k: live[k] for k in ("keyId", "keyIds", "keyMode") if k in live})
        uses_workflow = workflow_provider(channel["provider"])
        if uses_workflow:
            channel["baseUrl"] = channel.get("baseUrl") or live["baseUrl"]
        params = {
            k: frame[k]
            for k in ("width", "height", "steps", "cfg", "denoise", "seed")
            if k in frame
        }
        # A scene's own seed is a render override like its size or steps; a
        # scene that never opted in gets the book seed (base + index) or a
        # fresh random one, never a stale value left in the editor.
        explicit = params.get("seed", -1) if frame.get("renderOverride") else -1
        params["seed"] = frame_seed(snap, index, explicit)
        payload = {
            "config": channel,
            "prompt": prompt,
            "negative": negative,
            "images": images,
            "frame": params,
            "_requestTimeout": self.request_timeout(channel["provider"]),
        }
        if uses_workflow:
            wf = snap["workflow"]
            rules = copy.deepcopy(wf.get("bindings", []))
            for p in snap["presets"]:
                rules.extend(p.get("bindings", []))
            # A mapped seed node always receives this frame's seed: reproducible
            # (base + index) when enabled, fresh per attempt otherwise. Only a
            # workflow without a seed mapping keeps its literal value.
            payload["workflow"] = compile_workflow(
                wf.get("workflow", {}),
                rules,
                prompt,
                {
                    **params,
                    "negative": negative,
                    "variables": values,
                    "renderOverride": frame.get("renderOverride", False),
                    "objectInfo": wf.get("objectInfo", {}),
                    "outputNodeId": wf.get("outputNodeId", ""),
                    "title": task["title"],
                    "sceneName": frame.get("name", ""),
                    "caption": caption,
                },
                images,
            )
            channel["outputNodeId"] = wf.get("outputNodeId", "")
            # Task-level model / LoRA overrides land after the bindings so a
            # syntax-mode LoRA tag is appended to the prompt the binding just
            # wrote, and the chosen checkpoint replaces the blueprint's default.
            if snap.get("overrides"):
                applied = workflow_slots.apply(
                    payload["workflow"], wf.get("slots"), snap["overrides"], wf.get("objectInfo", {}), positive_binding_target(wf)
                )
                payload["workflow"] = applied["workflow"]
                for notice in applied["notices"]:
                    self.report(task["id"], index, {"notice": notice})
            # C2: a text-to-image workflow has no LoadImage binding, so image
            # variables referenced from the prompt never reach a node. Drop them
            # here instead of letting the provider fail with "Unbound image N";
            # the prompt text already lost its @image_N tokens.
            payload["workflow"], payload["images"], dropped = prune_unbound_images(
                payload["workflow"], images
            )
            if dropped:
                self.report(
                    task["id"],
                    index,
                    {
                        "notice": "当前工作流没有可接收参考图的节点映射，已忽略 "
                        + str(len(dropped))
                        + " 张立绘参考图；提示词中的其它内容照常生成。需要参考图时，请在工作流映射中为 LoadImage 节点绑定图片变量。"
                    },
                )
        previous = None
        try:
            previous = next(
                (
                    p.get("image")
                    for p in self.host.native_store()
                    .entity("albums", task["albumId"])["document"]
                    .get("steps", [])
                    if p.get("stepIndex") == index
                ),
                None,
            )
        except LibraryError as exc:
            if exc.status != 404:
                raise
        if cancel.is_set():
            raise InterruptedError("分幕提交前已取消")
        # render.before: extensions may rewrite prompt/negative/frame/images/config
        # (prompt translation, LoRA injection, size policy ...) for this page.
        context = {"task": task_context(task), "index": index, "frame": {"name": frame.get("name", ""), "caption": caption}}
        payload = self.eco.hooks.apply("render.before", payload, context)
        prompt, negative = payload.get("prompt", prompt), payload.get("negative", negative)
        self.eco.events.emit("page.started", {**context, "provider": channel["provider"]})
        payload["_task"] = {"id": task["id"], "index": index, "title": task["title"]}
        payload["_isCanceled"] = lambda: cancel.is_set()
        payload["_checkpoint"] = lambda prompt_id: self.report(
            task["id"], index, {"upstream": str(prompt_id)}
        )
        payload["_onCancelResult"] = lambda report: self.report(
            task["id"], index, {"cancelReport": report}
        )
        payload["_onRateLimit"] = lambda report: self.report(
            task["id"], index, {"rateLimit": report}
        )
        from backend.providers.reliability import retry_delay

        for attempt in range(6):
            self.report(task["id"], index, {"rateLimit": None})
            if cancel.is_set():
                raise InterruptedError("等待期间已取消")
            try:
                result = self.host.generate_provider_image(payload)
                break
            except Exception as exc:
                if (
                    isinstance(exc, InterruptedError)
                    or getattr(exc, "status", None) != 429
                    or attempt == 5
                ):
                    raise
                delay = retry_delay(getattr(exc, "headers", {}), attempt + 1)
                self.report(
                    task["id"],
                    index,
                    {
                        "rateLimit": {
                            "until": time.time() + delay,
                            "untilEpochMs": round((time.time() + delay) * 1000),
                            "attempt": attempt + 1,
                        }
                    },
                )
                if cancel.wait(delay):
                    raise InterruptedError("限流等待期间已取消")
        # render.after: post-processing (upscale, face restore, watermark,
        # mirroring to an image host). Handlers return a result with a new image.
        result = self.eco.hooks.apply(
            "render.after",
            {"image": result["image"], "artifacts": result.get("artifacts", []), "provider": channel["provider"], "meta": result.get("meta")},
            {**context, "prompt": prompt, "negative": negative, "frame": params},
        )
        image = result.get("image")
        if isinstance(image, dict):
            image = image.get("localUrl") or image.get("url")
        if not isinstance(image, str) or not image.startswith("/images/"):
            raise LibraryError("render.after 必须返回本地 /images/ 地址")
        self.eco.events.emit("page.rendered", {**context, "image": image, "provider": channel["provider"]})
        return {
            "image": durable_assets(self.host, image),
            "prompt": prompt,
            "caption": caption,
            "previousImage": previous,
            "name": frame.get("name", "第 " + str(index + 1) + " 幕"),
        }

    def request_timeout(self, provider):
        """Per-request timeout from the shared queue runtime settings (30–7200 s)."""
        default = 600 if workflow_provider(provider) else 300
        try:
            from backend import mio_foundation

            value = mio_foundation.jobs(self.host).runtime().get("requestTimeoutSeconds")
            if type(value) is int:
                return max(30, min(7200, value))
        except Exception:
            pass
        return default

    def finalize(self, task):
        """Settle album status once a book stops: complete, partial or failed.

        No render happens here; a book whose pages were skipped or rejected must
        not stay 'generating' forever in the reader.
        """
        if task["snapshot"].get("preview") or task.get("status") not in (
            "complete", "partial", "failed", "cancelled", "interrupted"
        ):
            return
        store = self.host.native_store()
        try:
            record = store.entity("albums", task["albumId"])
        except LibraryError as exc:
            if exc.status == 404:
                return
            raise
        album = record["document"]
        total = album.get("totalSteps") or len(task["pages"])
        done = len([p for p in album.get("steps", []) if p.get("image")])
        status = "complete" if done >= total else ("partial" if done else "failed")
        if task.get("status") in ("cancelled", "interrupted") and done < total:
            status = "partial" if done else "failed"
        if album.get("status") == status and not task.get("error"):
            return
        album["status"] = status
        album["generatedSteps"] = done
        if task.get("error"):
            album["lastError"] = str(task["error"])[:500]
        else:
            album.pop("lastError", None)
        album["updatedAt"] = int(time.time() * 1000)
        store.apply(
            [{"kind": "albums", "id": album["id"], "document": album, "expected": record["etag"]}],
            internal=True,
        )
        self.eco.events.emit("album.saved", {"id": album["id"], "status": status, "source": "production"})

    def publish(self, task, index, result):
        if task["snapshot"].get("preview"):
            return
        from backend.mio_lifecycle import deleted_album_ids

        if task["albumId"] in deleted_album_ids(self.host.DATA_DIR):
            raise LibraryError("画册已被删除，生成结果保留在任务记录，未重新创建")
        store = self.host.native_store()
        try:
            record = store.entity("albums", task["albumId"])
            album = record["document"]
            revision = record["etag"]
        except LibraryError as exc:
            if exc.status != 404:
                raise
            revision = None
            # The browser album contract requires rowId/templateId; assembled books
            # have no legacy character row or template, so use the stable sentinels.
            album = {
                "id": task["albumId"],
                "projectId": task["snapshot"]["projectId"],
                "title": task["title"],
                "totalSteps": len(task["pages"]),
                "generatedSteps": 0,
                "steps": [],
                "status": "generating",
                "createdAt": int(task["createdAt"] * 1000),
                "updatedAt": int(task["createdAt"] * 1000),
                "assemblyId": task["id"],
                "rowId": "unassigned",
                "templateId": "unassigned",
                "synopsis": task["snapshot"]["story"].get("outline", ""),
                "tags": ["装配作品"],
                "characterName": ", ".join(
                    p.get("title", "") for p in task["snapshot"].get("presets", []) if p.get("title")
                ),
                "templateTitle": task["snapshot"]["story"].get("title", ""),
                "storyTitle": task["snapshot"]["story"].get("title", ""),
            }
        old = next((p for p in album["steps"] if p.get("stepIndex") == index), None)
        if (
            old
            and old.get("image")
            and Path(old["image"]).name == Path(result["image"]).name
            and old.get("caption") == result.get("caption")
            and old.get("prompt") == result.get("prompt")
        ):
            return
        if (old or {}).get("image") != result.get("previousImage"):
            raise LibraryError(
                "该页在生成期间已被修改。新结果保留在任务记录，未覆盖当前图片。"
            )
        page = {
            "stepIndex": index,
            **{k: result[k] for k in ("image", "prompt", "caption", "name")},
        }
        page = self.eco.hooks.apply("publish.before", page, {"task": task_context(task), "index": index, "albumId": album["id"]})
        if not str(page.get("image", "")).startswith("/images/"):
            raise LibraryError("publish.before 必须保留本地 /images/ 页面地址")
        album["steps"] = [p for p in album["steps"] if p.get("stepIndex") != index] + [
            page
        ]
        album["steps"].sort(key=lambda p: p["stepIndex"])
        album["generatedSteps"] = len(album["steps"])
        album["status"] = (
            "complete" if len(album["steps"]) == album["totalSteps"] else "generating"
        )
        album["updatedAt"] = int(time.time() * 1000)
        store.apply(
            [
                {
                    "kind": "albums",
                    "id": album["id"],
                    "document": album,
                    "expected": revision,
                }
            ],
            internal=True,
        )
        if revision is None:
            self.eco.events.emit("album.created", {"id": album["id"], "title": album["title"], "source": "production"})
        self.eco.events.emit("page.published", {"task": task_context(task), "index": index, "albumId": album["id"], "image": page["image"], "complete": album["status"] == "complete"})
        if album["status"] == "complete":
            self.eco.events.emit("album.published", {"id": album["id"], "title": album["title"], "pages": len(album["steps"])})


def task_context(task):
    return {"id": task["id"], "title": task.get("title", ""), "albumId": task.get("albumId"), "preview": bool(task["snapshot"].get("preview"))}


def service(host):
    eco = ecosystem_api.service(host)
    with LOCK:
        if not hasattr(eco, "production"):
            adapter = ProductionAdapter(host, eco)
            eco.production = ProductionQueue(
                host.DATA_DIR,
                adapter.prepare,
                adapter.render,
                adapter.publish,
                adapter.finalize,
                emit=lambda name, payload: eco.events.emit(name, payload, source="production"),
                retry_policy=lambda payload: eco.hooks.apply("page.retry", None, payload, expect=dict),
            )
            adapter.report = eco.production.report_attempt
            eco.production_adapter = adapter
        return eco


def dispatch(handler, host, path):
    if not path.startswith("/api/production/"):
        return False
    try:
        eco = service(host)
        queue = eco.production
        route = path[len("/api/production/") :]
        if handler.command == "GET" and route == "tasks":
            result = queue.list()
            import hashlib, json
            etag = '"' + hashlib.sha256(json.dumps(result, sort_keys=True, ensure_ascii=False).encode()).hexdigest() + '"'
            if handler.headers.get("If-None-Match") == etag:
                handler.send_response(304)
                handler.send_header("ETag", etag)
                handler.send_header("Content-Length", "0")
                handler.end_headers()
                return True
            result["serverEpochMs"] = round(time.time() * 1000)
            handler.send_response(200)
            encoded = json.dumps({"data": result}, ensure_ascii=False).encode()
            handler.send_header("ETag", etag)
            handler.send_header("Content-Type", "application/json; charset=utf-8")
            handler.send_header("Content-Length", str(len(encoded)))
            handler.end_headers()
            handler.wfile.write(encoded)
            return True
        elif handler.command == "GET" and route.startswith("tasks/"):
            task = queue.get(route[len("tasks/") :])
            result = {
                key: task.get(key)
                for key in (
                    "id",
                    "title",
                    "status",
                    "error",
                    "pages",
                    "cancelReport",
                    "rateLimit",
                )
            }
        elif handler.command == "POST":
            body = handler.read_json_body(max_bytes=2 * 1024 * 1024)
            if route == "assemble":
                result = queue.assemble(
                    eco.production_adapter.snapshot(body),
                    body.get("title"),
                    body.get("requestId"),
                )
            elif route == "assemble-batch":
                items = body.get("items")
                if not isinstance(items, list) or not 1 <= len(items) <= 100:
                    raise LibraryError("批量装配需包含 1–100 项")
                result = queue.assemble_many(
                    [
                        (
                            eco.production_adapter.snapshot(item),
                            item.get("title"),
                            item.get("requestId"),
                        )
                        for item in items
                    ]
                )
            elif route == "start":
                result = queue.start(
                    body["id"],
                    body.get("sequential") is True,
                    body.get("indices"),
                    body.get("trusted") is True,
                    body.get("forcePrepare") is True,
                    body.get("confirmUncertain") is True,
                )
            elif route == "recover-publication":
                result = queue.recover_publication(body["id"], body["index"])
            elif route == "pause":
                result = queue.pause()
            elif route == "resume":
                result = queue.resume()
            elif route == "cancel":
                result = queue.cancel()
            elif route == "remove":
                result = queue.remove(body["id"])
            else:
                raise LibraryError("未知生产操作", 404)
        else:
            raise LibraryError("未知生产接口", 404)
        handler.send_json(200, {"data": result})
    except LibraryError as exc:
        handler.send_json(exc.status, {"error": str(exc)})
    except Exception as exc:
        handler.send_json(400, {"error": str(exc)[:500]})
    return True
