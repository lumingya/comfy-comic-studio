"""File-native workspace DTO reader.

This is an adapter for the application's domain objects, not an old-file reader.
There is no aggregate content/albums file and no automatic data migration here.
The GUI/worker transport integration remains a separate step.
"""
import copy
from mio_library_settings import FileSettings

GROUPS = {'templates': 'storyboards', 'savedGalleries': 'albums',
          'rows': 'rows', 'projects': 'collections', 'plans': 'plans',
          'characters': 'characters', 'scenes': 'scenes',
          'exportTemplates': 'layouts', 'comfyWorkflows': 'workflows',
          'sessions': 'conversations', 'queue': 'tasks'}


def unwrap(document):
    result = copy.deepcopy(document)
    saved = result.pop('_sourceFormat', {})
    for key in ('schema', 'kind', '_position'):
        result.pop(key, None)
    for key in saved.get('added', []):
        result.pop(key, None)
    result.update(saved.get('replaced', {}))
    return result


def map_images(value, prefix):
    if isinstance(value, str) and value.startswith('images/'):
        return prefix + '/' + value
    if isinstance(value, dict):
        return {k: map_images(v, prefix) for k, v in value.items()}
    if isinstance(value, list):
        return [map_images(v, prefix) for v in value]
    return value


class WorkspaceRepository:
    def __init__(self, library):
        self.library = library
        self.settings = FileSettings(library)

    def records(self, kind):
        result = []
        offset = 0
        while True:
            page = self.library.catalog(kind, limit=200, offset=offset)
            result.extend(page['items'])
            offset += len(page['items'])
            if offset >= page['total'] or not page['items']:
                return result

    def entity(self, kind, id, urls=True):
        record = self.library.get(kind, id)
        document = unwrap(record['document'])
        if urls:
            document = map_images(document, '/images/library/' + kind + '/' + id)
        return {**record, 'document': document}

    def read(self, album_summaries=False):
        """Full domain DTO for conversion verification and offline operations.

        album_summaries is explicit: summaries are tagged, never empty full albums.
        Do not feed them to the old GUI normalization/save pipeline unchanged.
        """
        settings = {name: map_images(self.settings.get(name)['document'], '/images/library/settings/' + name) for name in ('workspace', 'comfy', 'llm', 'xml')}
        native = settings['workspace']
        result = copy.deepcopy(native.get('globals', {}))
        result['uiConfig'] = copy.deepcopy(native.get('ui', {}))
        meta = result['uiConfig'].setdefault('comfyStudio', {})
        creation = meta.setdefault('creation', {})
        ordering = native.get('ordering', {})
        groups = {}
        for field, kind in GROUPS.items():
            rows = self.records(kind)
            order = {id: i for i, id in enumerate(ordering.get(field, []))}
            rows.sort(key=lambda r: (order.get(r['id'], len(order)), r['id']))
            if kind == 'albums' and album_summaries:
                groups[field] = [{**r, '_lazy': True} for r in rows]
            else:
                groups[field] = [self.entity(kind, row['id'])['document'] for row in rows]
        result.update(templates=groups['templates'], savedGalleries=groups['savedGalleries'], comfyWorkflows=groups['comfyWorkflows'])
        meta['projects'] = groups['projects']
        creation['plans'] = groups['plans']
        presets = groups['characters'] + groups['scenes']
        preset_order = {id: i for i, id in enumerate(ordering.get('variableSets', []))}
        creation['variableSets'] = sorted(presets, key=lambda p: (preset_order.get(p['id'], len(preset_order)), p['id']))
        meta['exportTemplates'] = groups['exportTemplates']
        result['batchMatrix'] = {**copy.deepcopy(native.get('matrix', {})), 'rows': groups['rows']}
        result['chatConfig'] = {**copy.deepcopy(native.get('chats', {})), 'sessions': groups['sessions']}
        result['batchRunState'] = {**copy.deepcopy(native.get('queue', {})), 'queue': groups['queue']}
        for key, name in (('comfyConfig', 'comfy'), ('llmConfig', 'llm'), ('xmlConfig', 'xml')):
            result[key] = settings[name]
        def expand_graphs(value):
            if isinstance(value, dict):
                result = {k: expand_graphs(v) for k, v in value.items() if k != '_workflowRef'}
                if value.get('_workflowRef'):
                    graph = self.entity('workflows', value['_workflowRef'], urls=False)['document']
                    result['workflow'] = graph['workflow']
                return result
            if isinstance(value, list):
                return [expand_graphs(v) for v in value]
            return value
        result = expand_graphs(result)
        for alias in native.get('aliases', []):
            if alias == 'creation':
                result['uiConfig']['creation'] = copy.deepcopy(result['uiConfig']['comfyStudio']['creation'])
            elif alias == 'projects':
                result['uiConfig']['projects'] = copy.deepcopy(result['uiConfig']['comfyStudio']['projects'])
        result['_fileWorkspace'] = {'schema': 'mio.workspace.v2', 'albumSummaries': album_summaries,
                                    'executionStartPolicy': 'manual'}
        return result
