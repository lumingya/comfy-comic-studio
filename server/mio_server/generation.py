"""Resolve and freeze one task's source without adding user-visible render profiles."""

from __future__ import annotations

from . import llm as L
from . import settings as SET
from .models import GenerationOptions, GenerationSnapshot, Series
from .pipeline.cloud_request import DEFAULT_MODELS, OPTION_KEYS
from .render_models import RenderProfile, RenderStage
from .storage import NotFound


def preference_key(options: GenerationOptions) -> str:
    if options.workflow_id is not None:
        return f"workflow:{options.workflow_id}"
    if options.cloud_channel_id is not None:
        return f"channel:{options.cloud_channel_id}"
    return f"profile:{options.profile_id}"


def freeze(store, series: Series, options: GenerationOptions | None = None) -> GenerationSnapshot:
    options = options or GenerationOptions()
    explicit_profile = bool(options.profile_id or series.default_profile_id)
    app = SET.load(store)
    if options.workflow_id is not None:
        doc = store.get_doc("workflow", options.workflow_id)
        profile = RenderProfile(
            id=f"task:{doc.id}",
            name=doc.name,
            draft=[RenderStage(id="generate", workflow_id=doc.id)],
            candidates=1,
            quality_tags=[],
            negative_tags=[],
        )
    elif options.cloud_channel_id is not None:
        channel_id = options.cloud_channel_id
        channel = next((c for c in app.image_channels if c.id == channel_id), None)
        if channel_id and channel is None:
            raise NotFound(f"image channel not found: {channel_id}")
        profile = RenderProfile(
            id=f"task:channel:{channel_id or 'default'}",
            name=(channel.label or channel.id) if channel else "云端出图",
            dialect="natural",
            cloud_shape=True,
            cloud_channel=channel_id,
            candidates=1,
            quality_tags=[],
            negative_tags=[],
        )
    else:
        profile = store.get_doc(
            "profile", options.profile_id or series.default_profile_id or "profile_default"
        )
        options = options.model_copy(update={"profile_id": profile.id})
    remembered = app.generation_defaults.get(preference_key(options))
    remembered = remembered.model_dump() if remembered else {}
    changes = {
        "candidates": options.candidates
        or remembered.get("candidates")
        or (profile.candidates if explicit_profile else 1),
        **{
            name: getattr(options, name)
            if name in options.model_fields_set
            else remembered.get(name)
            for name in ("width", "height")
        },
    }
    profile = profile.model_copy(update={"candidates": changes["candidates"]}, deep=True)
    profiles = {profile.id: profile.model_dump()}
    for variant in series.variants:
        if variant.profile_id and variant.profile_id not in profiles:
            profiles[variant.profile_id] = store.get_doc("profile", variant.profile_id).model_dump()
    frozen = GenerationSnapshot(
        **{**options.model_dump(), **changes}, profile=profile.model_dump(), profiles=profiles
    )
    capture_channels(app, frozen)
    capture_workflows(store, frozen)
    return frozen


def capture_channels(app, snapshot: GenerationSnapshot) -> None:
    for pid, data in snapshot.profiles.items():
        if not data.get("cloud_shape"):
            continue
        channel_id = data.get("cloud_channel") or app.image_channel
        channel = next((c for c in app.image_channels if c.id == channel_id), None)
        if channel_id and channel is None:
            raise NotFound(f"image channel not found: {channel_id}")
        kind = channel.kind if channel else "chat_image"
        model = (channel.model if channel else "") or DEFAULT_MODELS.get(kind, "")
        if not model and kind == "chat_image":
            model = next(iter(app.llm.image_models), L.IMAGE_SINGLE[0])
        snapshot.channels[channel_id] = {
            "kind": kind,
            "model": model,
            "options": {key: getattr(channel, key) for key in OPTION_KEYS} if channel else {},
        }
        data["cloud_channel"] = channel_id
        if pid == snapshot.profile.get("id"):
            snapshot.profile["cloud_channel"] = channel_id


def capture_workflows(store, snapshot: GenerationSnapshot) -> None:
    for data in snapshot.profiles.values():
        profile = RenderProfile.model_validate(data)
        active = (
            profile.draft
            if not profile.cloud_shape
            else (profile.final or profile.draft[1:])
            if profile.cloud_refine
            else []
        )
        required = {stage.workflow_id for stage in active if stage.enabled and stage.workflow_id}
        for stage in [*profile.draft, *profile.final, *profile.edits.values()]:
            if (
                not stage.enabled
                or not stage.workflow_id
                or stage.workflow_id in snapshot.workflows
            ):
                continue
            try:
                snapshot.workflows[stage.workflow_id] = store.get_doc(
                    "workflow", stage.workflow_id
                ).model_dump()
            except NotFound:
                if stage.workflow_id in required:
                    raise


def attach(store, series: Series, episode, options: GenerationOptions | None = None) -> None:
    snapshot = freeze(store, series, options)
    for panel in episode.panels:
        pid = panel.overrides.profile_id
        if pid and pid not in snapshot.profiles:
            snapshot.profiles[pid] = store.get_doc("profile", pid).model_dump()
    capture_workflows(store, snapshot)
    capture_channels(SET.load(store), snapshot)
    series.generation = snapshot


def profile_for(store, series: Series, profile_id: str | None = None) -> RenderProfile:
    frozen = series.generation
    if frozen:
        data = frozen.profile if profile_id is None else frozen.profiles.get(profile_id)
        if data:
            return RenderProfile.model_validate(data)
    return store.get_doc("profile", profile_id or series.default_profile_id or "profile_default")


def remember(store, snapshot: GenerationSnapshot | None) -> None:
    if snapshot is None:
        return
    app = SET.load(store)
    app.generation_defaults[preference_key(snapshot)] = SET.GenerationDefaults(
        candidates=snapshot.candidates, width=snapshot.width, height=snapshot.height
    )
    store.put_doc(app)
