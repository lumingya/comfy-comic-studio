"""Shared helpers: workspace settings document, channels, ordering, album locks."""

import contextlib

from backend.mio_library import KINDS, LibraryError

# Library kind -> key of ``workspace.ordering`` (the browser's display order).
ORDERING_FIELDS = {
    "storyboards": "templates", "albums": "savedGalleries", "rows": "rows", "collections": "projects",
    "plans": "plans", "characters": "characters", "scenes": "scenes", "layouts": "exportTemplates",
    "workflows": "comfyWorkflows", "conversations": "sessions", "tasks": "queue",
}
# Kinds that belong to one collection (画册集) through ``projectId``.
PROJECT_SCOPED = ("storyboards", "albums", "plans", "characters", "scenes", "rows")
WRITABLE_KINDS = tuple(kind for kind in KINDS if kind != "tasks")


def settings_doc(host, name="workspace"):
    current = host.native_store().settings.get(name)
    return current["document"], current["etag"]


def studio(document):
    ui = document.setdefault("ui", {}) if isinstance(document, dict) else {}
    return ui.setdefault("comfyStudio", {})


def image_generation(document):
    settings = studio(document).setdefault("settings", {})
    generation = settings.setdefault("imageGeneration", {})
    if not isinstance(generation.get("profiles"), list):
        generation["profiles"] = []
    return generation


def read_path(document, *keys, default=None):
    value = document
    for key in keys:
        if not isinstance(value, dict):
            return default
        value = value.get(key)
    return default if value is None else value


def channel_state(host):
    """(profiles, active id) of the saved image channels."""
    document, _ = settings_doc(host)
    generation = read_path(document, "ui", "comfyStudio", "settings", "imageGeneration", default={})
    profiles = [p for p in generation.get("profiles", []) if isinstance(p, dict)] if isinstance(generation, dict) else []
    return profiles, (generation.get("active") if isinstance(generation, dict) else None)


def active_project_id(host):
    document, _ = settings_doc(host)
    value = read_path(document, "ui", "comfyStudio", "activeProjectId")
    return value if isinstance(value, str) and value else None


def ordering(host, kind):
    document, _ = settings_doc(host)
    field = ORDERING_FIELDS.get(kind)
    values = read_path(document, "ordering", field, default=[]) if field else []
    return [v for v in values if isinstance(v, str)] if isinstance(values, list) else []


def save_settings(host, name, document, expected, clear=()):
    operation = {"name": name, "document": document, "expected": expected}
    if clear:
        operation["clearSecrets"] = list(clear)
    return host.native_store().apply([], settings_changes=[operation])


def mutate_settings(host, name, change, expected=None):
    """Atomic read-modify-write of one settings document.

    ``change(document)`` edits the document in place and returns the value to report.
    With ``expected`` the write fails with 409 when the stored ETag differs.
    """
    with host.CONFIG_LOCK:
        document, etag = settings_doc(host, name)
        if expected is not None and expected != etag:
            raise LibraryError("设置已被其他编辑者修改：" + name, 409, "revision_conflict")
        result = change(document)
        outcome = save_settings(host, name, document, etag)
        return result, outcome


@contextlib.contextmanager
def write_lock(host, kinds=()):
    """The lock order used by the browser save path: foundation jobs, then CONFIG_LOCK."""
    if "albums" in kinds or "tasks" in kinds:
        from backend import mio_foundation

        service = mio_foundation.jobs(host)
        with service.lock, host.CONFIG_LOCK:
            yield service
    else:
        with host.CONFIG_LOCK:
            yield None
