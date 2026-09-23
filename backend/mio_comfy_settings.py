"""ComfyUI settings: one lean public file, workflows as their own resources, a disposable cache.

On disk the ComfyUI configuration used to be a single ``settings/comfy.json`` of
100+ KB: the connection, an inlined copy of whichever workflow happened to be
selected (graph, bindings, slot plan …) and two machine caches fetched from
``/object_info``. The copy duplicated ``workflows/<title>--<id>.json`` and had
to be kept in sync by hand; every catalogue sync rewrote the whole file.

The stored layout is now normalised:

``settings/comfy.json``            user intent only ``{schema, baseUrl, activeWorkflowId, slotPresets}``
``workflows/<title>--<id>.json``   the single source of truth for a blueprint and its mappings
``.cache/comfy/object-info.json``  node definitions + model catalogue; safe to delete, re-synced on demand

The application still works with a flat ``comfyConfig`` DTO in memory.
``hydrate`` builds it from the three sources; ``split`` reverses it on save.
Legacy flat files are read transparently and rewritten lean on the next save.
"""
import copy
import json
from pathlib import Path

from backend.mio_library import LibraryError, atomic_write, decode, owned_path

SCHEMA = 'mio.comfy-settings.v2'
CACHE_SCHEMA = 'mio.comfy-cache.v1'
CACHE_FILE = '.cache/comfy/object-info.json'

# Settings kept in settings/comfy.json, in the order they are written.
STORED = ('baseUrl', 'activeWorkflowId', 'slotPresets')
# Fields that belong to the selected workflow resource; the DTO mirrors them.
WORKFLOW_FIELDS = ('workflow', 'workflowTitle', 'mapping', 'bindings', 'outputNodeId', 'randomizeSeeds', 'slots')
# Machine caches: persisted beside the catalogue index, never in user settings.
CACHE_FIELDS = ('objectInfo', 'modelCatalog')
# Values that are constant (real generation only) or retired flat-era aliases.
DERIVED = ('schema', 'mode', 'autoFallback', 'bindingVersion', 'workflowId', 'isMockMode',
           'nodePositive', 'nodeNegative', 'nodeOutput', 'positiveNodeId', 'negativeNodeId', 'presets')
DEFAULT_BASE_URL = 'http://127.0.0.1:8188'
MAX_SLOT_PRESETS = 100


def _object(value):
    return value if isinstance(value, dict) else {}


def clean_slot_presets(value):
    """Keep portable slot recipes as plain data; the browser validates their shape."""
    if not isinstance(value, list):
        return []
    result = []
    for item in value[:MAX_SLOT_PRESETS]:
        if isinstance(item, dict) and isinstance(item.get('title'), str) and isinstance(item.get('rows'), list):
            result.append(copy.deepcopy(item))
    return result


def needs_inline(document, workflow_ids):
    """Keep the inlined graph only while no workflow resource can provide it.

    The browser always stores the active blueprint as ``workflows/<id>.json``, so
    this is a safety net for hand-written or partially converted directories:
    a graph that exists nowhere else is never dropped.
    """
    doc = _object(document)
    graph = doc.get('workflow')
    if not isinstance(graph, dict) or not graph:
        return False
    return str(doc.get('activeWorkflowId') or '') not in set(workflow_ids or ())


def split(document, keep_workflow=False):
    """Split a flat comfyConfig DTO into ``(stored settings, cache or None)``.

    Workflow fields are dropped unless ``keep_workflow``: the active workflow
    resource is saved as its own entity by the same transaction. Unknown keys are
    preserved so an extension that keeps a small preference here does not lose it.
    """
    source = _object(document)
    stored = {'schema': SCHEMA}
    stored['baseUrl'] = str(source.get('baseUrl', DEFAULT_BASE_URL) or '')
    stored['activeWorkflowId'] = str(source.get('activeWorkflowId') or '')
    stored['slotPresets'] = clean_slot_presets(source.get('slotPresets'))
    skipped = set(STORED) | set(CACHE_FIELDS) | set(DERIVED)
    if not keep_workflow:
        skipped |= set(WORKFLOW_FIELDS)
    for key, value in source.items():
        if key not in skipped and not key.startswith('_'):
            stored[key] = copy.deepcopy(value)
    if '_secretRefs' in source:
        stored['_secretRefs'] = copy.deepcopy(source['_secretRefs'])
    cache = None
    info = _object(source.get('objectInfo'))
    catalog = _object(source.get('modelCatalog'))
    if info or catalog:
        cache = {
            'objectInfo': copy.deepcopy(info),
            'modelCatalog': copy.deepcopy(catalog),
        }
    return stored, cache


def is_lean(document):
    """True when a stored document carries no inlined workflow or cache."""
    doc = _object(document)
    return not any(key in doc for key in WORKFLOW_FIELDS + CACHE_FIELDS)


def cache_path(root):
    return owned_path(Path(root), CACHE_FILE)


def read_cache(root):
    """Return the cached node definitions; a missing or damaged cache is simply empty."""
    empty = {'objectInfo': {}, 'modelCatalog': {}}
    try:
        path = cache_path(root)
        if not path.is_file():
            return empty
        value = decode(path.read_bytes())
    except (OSError, ValueError, LibraryError):
        return empty
    if not isinstance(value, dict) or value.get('schema') != CACHE_SCHEMA:
        return empty
    return {'objectInfo': _object(value.get('objectInfo')), 'modelCatalog': _object(value.get('modelCatalog'))}


def cache_bytes(cache):
    """Compact JSON: the cache is machine data and can be several MiB."""
    payload = {'schema': CACHE_SCHEMA, 'objectInfo': _object(cache.get('objectInfo')),
               'modelCatalog': _object(cache.get('modelCatalog'))}
    return (json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def write_cache(root, cache):
    """Persist the cache outside the transaction journal; it is disposable by design.

    Returns True when bytes were written. An unchanged cache is not rewritten, so
    ordinary saves (renaming a mapping, toggling a slot) never touch it.
    """
    if cache is None:
        return False
    wanted = {'objectInfo': _object(cache.get('objectInfo')), 'modelCatalog': _object(cache.get('modelCatalog'))}
    path = cache_path(root)
    if not wanted['objectInfo'] and not wanted['modelCatalog']:
        if not path.exists():
            return False
        remove_cache(root)
        return True
    raw = cache_bytes(wanted)
    try:
        if path.is_file() and path.read_bytes() == raw:
            return False
    except OSError:
        pass
    atomic_write(path, raw)
    return True


def remove_cache(root):
    try:
        cache_path(root).unlink(missing_ok=True)
    except (OSError, LibraryError):
        pass


def workflow_view(resource):
    """The DTO fields a workflow resource provides to comfyConfig."""
    wf = _object(resource)
    return {
        'workflow': copy.deepcopy(_object(wf.get('workflow'))),
        'workflowTitle': str(wf.get('title') or ''),
        'mapping': copy.deepcopy(_object(wf.get('mapping'))),
        'bindings': copy.deepcopy(wf.get('bindings') if isinstance(wf.get('bindings'), list) else []),
        'outputNodeId': str(wf.get('outputNodeId') or ''),
        'randomizeSeeds': bool(wf.get('randomizeSeeds')),
        'slots': copy.deepcopy(_object(wf.get('slots'))),
    }


def hydrate(stored, workflows, cache):
    """Build the flat comfyConfig DTO the application consumes.

    ``workflows`` holds workflow documents (at least the active one). Two stored
    layouts are understood:

    * lean (``mio.comfy-settings.v2``): every workflow field comes from the
      active workflow resource, falling back to the first workflow;
    * flat (anything that still inlines workflow fields): the file itself is the
      view, exactly as before. A graph detached by the offline converter
      (``_workflowRef``) is re-attached from its resource.
    """
    doc = copy.deepcopy(_object(stored))
    flat = isinstance(doc.get('workflow'), dict) and bool(doc['workflow'])
    result = {'mode': 'real', 'autoFallback': False, 'baseUrl': DEFAULT_BASE_URL}
    for key, value in doc.items():
        if key != 'schema':
            result[key] = value
    result['mode'] = 'real'
    result['autoFallback'] = False
    result['slotPresets'] = clean_slot_presets(doc.get('slotPresets'))
    items = [w for w in (workflows or []) if isinstance(w, dict) and w.get('id')]
    by_id = {w['id']: w for w in items}
    if flat:
        ref = result.pop('_workflowRef', None)
        if 'workflow' not in doc and ref in by_id:
            result['workflow'] = copy.deepcopy(_object(by_id[ref].get('workflow')))
    else:
        active = by_id.get(doc.get('activeWorkflowId')) or by_id.get(doc.get('_workflowRef')) or (items[0] if items else None)
        if active is not None:
            result.pop('_workflowRef', None)
            result['activeWorkflowId'] = active['id']
            result.update(workflow_view(active))
        else:
            result.setdefault('activeWorkflowId', '')
            for k, v in workflow_view({}).items():
                result.setdefault(k, v)
    cached = _object(cache)
    if not isinstance(result.get('objectInfo'), dict) or not result.get('objectInfo'):
        result['objectInfo'] = copy.deepcopy(_object(cached.get('objectInfo')))
    if not isinstance(result.get('modelCatalog'), dict) or not result.get('modelCatalog'):
        result['modelCatalog'] = copy.deepcopy(_object(cached.get('modelCatalog')))
    result.setdefault('bindingVersion', 1)
    return result


def view_workflow_ids(stored):
    """Workflow IDs whose resources ``hydrate`` may need for this stored document."""
    doc = _object(stored)
    return [x for x in (doc.get('activeWorkflowId'), doc.get('_workflowRef')) if isinstance(x, str) and x]


def normalize_directory(root, stored, workflow_ids):
    """Rewrite a legacy flat ``settings/comfy.json`` as the lean layout (offline tool helper).

    Returns ``(lean document, cache or None, changed)``; nothing is written here.
    """
    doc = _object(stored)
    lean, cache = split(doc, keep_workflow=needs_inline(doc, workflow_ids))
    return lean, cache, lean != doc


__all__ = ['SCHEMA', 'CACHE_FILE', 'split', 'hydrate', 'view_workflow_ids', 'needs_inline', 'read_cache', 'write_cache',
           'cache_bytes', 'is_lean', 'workflow_view', 'clean_slot_presets', 'remove_cache', 'normalize_directory']
