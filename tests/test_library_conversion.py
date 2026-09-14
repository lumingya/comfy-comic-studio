"""One-time conversion acceptance: source read-only, actual JSON/images/SQLite,
WAL recovery, protected publication, exact Chinese prompts, and no job dispatch.
"""
import base64
from contextlib import closing
import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import mio_library_conversion as conversion
from mio_library import FileLibrary, LibraryError, digest, encode, image_refs, image_type
from mio_library_settings import FileSettings
from mio_library_workspace import WorkspaceRepository
from mio_jobs import Jobs

ROOT = Path(__file__).resolve().parents[1]
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><defs><linearGradient id="sun"><stop stop-color="#ffa"/></linearGradient></defs><rect width="20" height="30" fill="url(#sun)"/></svg>'


def hashes(root):
    return {p.relative_to(root).as_posix(): digest(p.read_bytes()) for p in root.rglob('*') if p.is_file()}


def config_fixture():
    story = json.loads((ROOT / 'examples/storyboards/晴天借阅室_分镜导入.json').read_text('utf-8'))
    story['projectId'] = 'p_sunny'
    for i, frame in enumerate(story['frames']):
        frame['id'] = 'frame_' + str(i)
    reference = {'kind': 'mio-image', 'src': '/images/ref.png', 'name': '主角参考图'}
    presets = [{'id': 'nanami', 'title': '七海', 'projectId': 'p_sunny', 'entries': [
        {'id': 'var_reference', 'key': '主角参考图', 'type': 'image', 'value': reference},
        {'id': 'var_text', 'key': '外观', 'type': 'text', 'value': '灰蓝色外套'}]},
        {'id': 'beach', 'title': '夏日海岸', 'category': 'scenes', 'entries': []}]
    frames = [{**copy.deepcopy(f), '_scope': {'主角参考图': reference}, '_imageInputs': [{**reference, 'key': '主角参考图', 'index': 1}], '_resolvedImagePrompt': f['prompt'].replace('{主角参考图}', '@image_1')} for f in story['frames']]
    book = {'id': 'book_sunny', 'title': '晴天借阅室', 'projectId': 'p_sunny', 'templateId': story['id'],
            'rowId': 'row_nanami', 'planId': 'plan_sunny', 'totalSteps': 12, 'generatedSteps': 1,
            'status': 'partial', 'createdAt': 1700000000000, 'inProgress': False,
            'steps': [{'stepIndex': 0, 'name': frames[0]['name'], 'prompt': frames[0]['prompt'], 'caption': frames[0]['caption'],
                       'image': '/images/original.png', 'offlineImage': 'data:image/svg+xml;base64,' + base64.b64encode(SVG).decode()}],
            'sourceSnapshot': {'frames': frames, 'row': {'主角参考图': reference},
                               'execution': {'config': {'provider': 'openai', 'baseUrl': 'https://example.test/v1', 'key': 'SNAPSHOT_SECRET_FOR_TEST'}}}}
    graph = {'6': {'class_type': 'CLIPTextEncode', 'inputs': {'text': '{主角参考图} 的晴天'}}}
    return {'templates': [story], 'savedGalleries': [book], 'comfyWorkflows': [],
            'batchMatrix': {'columns': ['character'], 'rows': [{'id': 'row_nanami', 'character': '七海', 'projectId': 'p_sunny', 'references': {'main': reference}, 'storyVersions': {}}]},
            'comfyConfig': {'baseUrl': 'http://127.0.0.1:8188', 'workflow': graph},
            'llmConfig': {'baseUrl': 'https://example.test/v1', 'key': 'LLM_SECRET_FOR_TEST', 'model': 'test-model'},
            'xmlConfig': {'separate': False, 'systemPrompt': '中文指令'},
            'chatConfig': {'activeChatId': 'chat_sunny', 'sessions': [{'id': 'chat_sunny', 'title': '创作讨论', 'messages': [{'role': 'user', 'content': '不要替换原有分镜。'}]}]},
            'batchRunState': {'queue': []}, 'updatedAt': 1700000000001,
            'uiConfig': {'comfyStudio': {'workspaceId': 'workspace_sunny', 'activeProjectId': 'p_sunny',
                'projects': [{'id': 'p_sunny', 'title': '晴天企划'}],
                'creation': {'version': 1, 'variableSets': presets, 'plans': [{'id': 'plan_sunny', 'title': '晴天计划', 'projectId': 'p_sunny', 'rowId': 'row_nanami', 'templateId': story['id'], 'variableSetIds': ['nanami', 'beach'], 'variables': [], 'sceneOverrides': {}}]},
                'settings': {'critic': {'baseUrl': 'https://example.test/v1', 'key': 'CRITIC_SECRET_FOR_TEST'}},
                'exportTemplates': [{'id': 'layout_custom', 'title': '我的版式', 'html': '<main>{{title}}</main>', 'kind': 'custom'}]}}}


def split_fixture(config):
    c = copy.deepcopy(config); ui = c['uiConfig']; meta = ui['comfyStudio']
    projects = meta.pop('projects'); creation = meta.pop('creation'); plans = creation.pop('plans'); presets = creation.pop('variableSets')
    return {'content': {'templates': c['templates']}, 'galleries': {'savedGalleries': c['savedGalleries']},
            'matrix': {'batchMatrix': c['batchMatrix']}, 'workflows': {'comfyWorkflows': c['comfyWorkflows']},
            'comfy': {'comfyConfig': c['comfyConfig']}, 'llm': {'llmConfig': c['llmConfig']},
            'xml_template': {'xmlConfig': c['xmlConfig']}, 'chat': {'chatConfig': c['chatConfig']},
            'ui': {'uiConfig': ui, 'updatedAt': c['updatedAt']}, 'queue': {'batchRunState': c['batchRunState']},
            'projects': {'_studioProjects': projects, '_hasStudioMetadata': True},
            'plans': {'_studioPlans': plans, '_studioCreation': creation}, 'presets': {'_studioPresets': presets}}


class ConversionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name); self.old = self.root / 'old'; self.data = self.old / 'data'
        (self.data / 'assets/images').mkdir(parents=True)
        for name, raw in [('ref.png', PNG), ('original.png', PNG + b'original'), ('late.png', PNG + b'late'), ('unused.png', PNG + b'unused')]:
            (self.data / 'assets/images' / name).write_bytes(raw)
        self.config = config_fixture(); self.output = self.root / 'converted'
        self.write_config()

    def tearDown(self):
        self.temp.cleanup()

    def write_config(self):
        for name, document in split_fixture(self.config).items():
            path = self.data / conversion.SPLIT[name]; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(encode(document))

    def convert(self, **kwargs):
        return conversion.convert(self.old, self.output, source_stopped=True, **kwargs)

    def test_real_split_files_become_independent_resources_without_source_writes(self):
        before = hashes(self.old)
        with patch('urllib.request.urlopen', side_effect=AssertionError('No network allowed')):
            report = self.convert()
        self.assertEqual(hashes(self.old), before)
        self.assertTrue(report['published']); self.assertTrue(report['guiRuntimeIntegrated'])
        self.assertEqual(report['counts']['storyboards'], 1)
        self.assertEqual(report['counts']['characters'], 1); self.assertEqual(report['counts']['scenes'], 1)
        self.assertEqual(report['counts']['plans'], 1); self.assertEqual(report['counts']['conversations'], 1)
        self.assertFalse((self.output / 'albums/index.json').exists())
        store = FileLibrary(self.output)
        try:
            dto = WorkspaceRepository(store).read()
            self.assertEqual(dto['templates'][0]['frames'], self.config['templates'][0]['frames'])
            self.assertEqual(dto['uiConfig']['comfyStudio']['creation']['plans'], self.config['uiConfig']['comfyStudio']['creation']['plans'])
            self.assertEqual(dto['chatConfig'], self.config['chatConfig'])
            self.assertEqual(dto['uiConfig']['comfyStudio']['exportTemplates'][0]['kind'], 'custom')
            self.assertEqual(dto['comfyConfig']['workflow'], self.config['comfyConfig']['workflow'])
            book = store.get('albums', 'book_sunny')['document']
            self.assertEqual([f['prompt'] for f in book['sourceSnapshot']['frames']], [f['prompt'] for f in self.config['templates'][0]['frames']])
            self.assertEqual(store.asset('albums', 'book_sunny', book['steps'][0]['offlineImage'])[0], SVG)
            self.assertEqual(book['sourceSnapshot']['frames'][0]['_scope']['主角参考图']['src'].split('/')[0], 'images')
            self.assertTrue(all(frame['_imageInputs'][0]['key'] == '主角参考图' and frame['_imageInputs'][0]['index'] == 1 for frame in book['sourceSnapshot']['frames']))
            for record in report['resourceFiles']:
                doc = store.get(record['kind'], record['id'])['document']
                for ref in set(image_refs(doc)):
                    store.asset(record['kind'], record['id'], ref)
            # Only explicitly typed preset keys retain their Chinese name.
            self.assertEqual(store.get('characters', 'nanami')['document']['entries'][0]['key'], '主角参考图')
            self.assertEqual(FileSettings(store).resolve('llm')['key'], 'LLM_SECRET_FOR_TEST')
            recovered = FileSettings(store).resolve_document('albums:book_sunny', book)
            self.assertEqual(recovered['sourceSnapshot']['execution']['config']['key'], 'SNAPSHOT_SECRET_FOR_TEST')
            with self.assertRaises(LibraryError):
                FileSettings(store).resolve_document('albums:other_book', book)
            self.assertTrue(dto['savedGalleries'][0]['steps'][0]['image'].startswith('/images/library/albums/book_sunny/'))
        finally:
            store.close()
        for path in self.output.rglob('*'):
            if path.is_file() and path.relative_to(self.output).as_posix() != 'settings/secrets.json':
                for secret in (b'SNAPSHOT_SECRET_FOR_TEST', b'LLM_SECRET_FOR_TEST', b'CRITIC_SECRET_FOR_TEST'):
                    self.assertNotIn(secret, path.read_bytes(), path.name)
        self.assertGreaterEqual(len(report['unassignedAssets']), 2)

    def test_dry_run_verifies_but_publishes_no_directory(self):
        before = hashes(self.old); result = self.convert(dry_run=True)
        self.assertFalse(result['published']); self.assertFalse(self.output.exists())
        self.assertEqual(before, hashes(self.old))
        self.assertFalse(list(self.root.glob('.converted.converting-*')))

    def test_missing_reference_aborts_all_output_and_leaves_source_intact(self):
        (self.data / 'assets/images/ref.png').unlink(); before = hashes(self.old)
        with self.assertRaises(LibraryError) as err:
            self.convert()
        self.assertEqual(err.exception.code, 'missing_asset')
        self.assertFalse(self.output.exists()); self.assertEqual(before, hashes(self.old))
        self.assertFalse(list(self.root.glob('.converted.converting-*')))

    def test_remote_reference_never_fetches_or_falls_back_to_text(self):
        self.config['savedGalleries'][0]['steps'][0]['image'] = 'https://example.test/private.png'
        self.write_config()
        with patch('urllib.request.urlopen', side_effect=AssertionError('No network allowed')) as fetch, self.assertRaises(LibraryError) as err:
            self.convert()
        self.assertEqual(err.exception.code, 'remote_asset'); fetch.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_duplicate_source_ids_do_not_replace_the_first_resource(self):
        self.config['templates'].append(copy.deepcopy(self.config['templates'][0])); self.write_config()
        before = hashes(self.old)
        with self.assertRaises(LibraryError) as err:
            self.convert()
        self.assertEqual(err.exception.code, 'duplicate_id')
        self.assertFalse(self.output.exists()); self.assertEqual(before, hashes(self.old))

    def test_preset_identity_cannot_collide_across_categories(self):
        presets = self.config['uiConfig']['comfyStudio']['creation']['variableSets']
        presets[1]['id'] = presets[0]['id']; self.write_config()
        with self.assertRaises(LibraryError) as err:
            self.convert()
        self.assertEqual(err.exception.code, 'duplicate_id'); self.assertFalse(self.output.exists())

    def test_existing_output_even_when_empty_is_never_replaced(self):
        self.output.mkdir()
        with self.assertRaises(LibraryError) as err:
            self.convert()
        self.assertEqual(err.exception.code, 'output_exists'); self.assertEqual(list(self.output.iterdir()), [])

    def test_output_race_uses_atomic_no_replace(self):
        real = conversion.publish_new_directory
        def race(src, dst):
            dst.mkdir()  # Another actor creates an empty destination at the last moment.
            return real(src, dst)
        with patch.object(conversion, 'publish_new_directory', side_effect=race), self.assertRaises(OSError):
            self.convert()
        self.assertTrue(self.output.is_dir()); self.assertEqual(list(self.output.iterdir()), [])

    def test_source_change_during_conversion_aborts_publication(self):
        real = conversion.Builder.record; changed = False
        def mutate(builder, *args):
            nonlocal changed
            result = real(builder, *args)
            if not changed:
                changed = True
                (self.data / conversion.SPLIT['content']).write_text('{"templates": []}')
            return result
        with patch.object(conversion.Builder, 'record', mutate), self.assertRaises(LibraryError) as err:
            self.convert()
        self.assertEqual(err.exception.code, 'source_changed'); self.assertFalse(self.output.exists())

    def test_config_journal_is_applied_only_to_the_new_directory(self):
        committed = copy.deepcopy(self.config); committed['templates'][0]['title'] = '已提交但未写完的分镜'
        journal = self.data / '.config-transaction.json'; journal.write_bytes(encode(split_fixture(committed)))
        (self.data / conversion.SPLIT['content']).unlink()
        before = hashes(self.old); report = self.convert()
        self.assertTrue(report['configJournalReadWithoutModifyingSource']); self.assertEqual(before, hashes(self.old))
        store = FileLibrary(self.output)
        try:
            self.assertEqual(store.get('storyboards', committed['templates'][0]['id'])['document']['title'], committed['templates'][0]['title'])
        finally:
            store.close()

    def add_execution(self):
        execute = Mock(side_effect=AssertionError('Conversion must not execute a provider'))
        jobs = Jobs(str(self.data / 'execution'), execute)
        try:
            with jobs.connect() as db:
                db.execute("UPDATE settings SET value='true' WHERE key='paused'")
            frames = [{'config': {'provider': 'openai', 'baseUrl': 'https://example.test/v1', 'model': 'test-model', 'keyMode': 'none'}, 'prompt': '第'+str(i)+'幕', 'frameIndex': i, 'albumId': 'book_sunny', 'images': ['/images/ref.png']} for i in range(12)]
            task = jobs.submit({'owner': 'task_sunny', 'albumId': 'book_sunny', 'label': '晴天', 'frames': frames, 'hold': True}, 'workspace_sunny:task_sunny')
            id = task['id']
        finally:
            jobs.close()
        execute.assert_not_called()
        self.config['batchRunState']['queue'] = [{'id': 'task_sunny', 'bookId': 'book_sunny', 'serverId': id, 'indices': list(range(12)), 'serverIndices': list(range(12)), 'status': 'running', 'frames': copy.deepcopy(self.config['templates'][0]['frames'])}]
        self.write_config()
        db = sqlite3.connect(self.data / 'execution/jobs.sqlite3')
        with db:
            results = [{'index': 0, 'image': '/images/late.png', 'prompt': '迟到结果，不应盖过原图'}, {'index': 7, 'image': '/images/late.png', 'prompt': '离线期间已完成的第八幕'}]
            db.execute("UPDATE jobs SET state='running',enabled=1,results=?,cursor=2 WHERE id=?", (json.dumps(results, ensure_ascii=False), id))
            for result in results:
                db.execute("UPDATE job_frames SET state='complete',result=? WHERE job=? AND idx=?", (json.dumps(result, ensure_ascii=False), id, result['index']))
            db.execute("UPDATE job_frames SET state='running',attempts=1 WHERE job=? AND idx=11", (id,))
            edit = {'image': '', 'removed': True, 'originalImage': '/images/original.png', 'recipe': {'version': 1, 'layers': [{'type': 'text', 'text': '保留我的气泡'}]}}
            db.execute('INSERT INTO picture_edits(album,idx,revision,record) VALUES(?,?,?,?)', ('book_sunny', 0, 3, json.dumps(edit, ensure_ascii=False)))
            request = {'config': {'provider': 'openai', 'baseUrl': 'https://example.test/v1', 'key': 'HISTORY_KEY_FOR_TEST'}, 'images': ['/images/ref.png'], 'prompt': '历史原始提示词'}
            db.execute('INSERT INTO request_inputs VALUES(?,?,?,?,?)', (id, 11, 1, 1700000000, json.dumps(request, ensure_ascii=False)))
            db.execute('INSERT INTO deleted_albums VALUES(?,?)', ('book_deleted', 1700000000))
        db.close()
        deleted = copy.deepcopy(self.config['savedGalleries'][0]); deleted['id'] = 'book_deleted'
        self.config['savedGalleries'].append(deleted); self.write_config()
        return id, execute

    def test_durable_results_picture_removal_originals_and_tombstones_survive(self):
        id, execute = self.add_execution(); before = hashes(self.old)
        report = self.convert(); self.assertEqual(before, hashes(self.old))
        self.assertEqual(report['excludedDeletedAlbumIds'], ['book_deleted'])
        self.assertEqual(report['runtimeChanges'][0]['after'], 'unknown')
        store = FileLibrary(self.output)
        try:
            book = store.get('albums', 'book_sunny')['document']
            self.assertEqual(next(s for s in book['steps'] if s['stepIndex'] == 0)['image'], '')
            self.assertEqual(next(s for s in book['steps'] if s['stepIndex'] == 7)['prompt'], '离线期间已完成的第八幕')
            self.assertEqual(book['pictureEdits']['0']['recipe']['layers'][0]['text'], '保留我的气泡')
            self.assertEqual(store.asset('albums', 'book_sunny', book['pictureEdits']['0']['originalImage'])[0], PNG + b'original')
            self.assertEqual(store.get('tasks', 'task_sunny')['document']['status'], 'paused')
        finally:
            store.close()
        dbpath = self.output / 'runtime/execution/jobs.sqlite3'
        with closing(sqlite3.connect(dbpath)) as db:
            self.assertEqual(db.execute('SELECT token FROM jobs WHERE id=?', (id,)).fetchone()[0], 'workspace_sunny:task_sunny')
            self.assertEqual(db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()[0], 'true')
            self.assertEqual(db.execute('SELECT state,enabled FROM jobs WHERE id=?', (id,)).fetchone(), ('unknown', 0))
            self.assertEqual(db.execute('SELECT state FROM job_frames WHERE job=? AND idx=11', (id,)).fetchone()[0], 'unknown')
            payload, hashed = db.execute('SELECT payload,digest FROM jobs WHERE id=?', (id,)).fetchone()
            self.assertEqual(hashed, digest(json.dumps(json.loads(payload), sort_keys=True, ensure_ascii=False, allow_nan=False).encode()))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM request_inputs').fetchone()[0], 1)
            request = json.loads(db.execute('SELECT input FROM request_inputs').fetchone()[0])
            self.assertEqual(request['prompt'], '历史原始提示词'); self.assertEqual(request['config']['key'], '')
            self.assertTrue(request['images'][0].startswith('/images/runtime/images/'))
            self.assertEqual(db.execute('SELECT id FROM deleted_albums').fetchone()[0], 'book_deleted')
        self.assertNotIn(b'HISTORY_KEY_FOR_TEST', dbpath.read_bytes())
        # Real worker startup against the converted durable DB stays held and makes no request.
        worker = Jobs(str(self.output / 'runtime/execution'), execute)
        try:
            self.assertFalse(worker.step())
            self.assertEqual(worker.get(id)['state'], 'unknown')
            execute.assert_not_called()
        finally:
            worker.close()

    def test_uncheckpointed_wal_is_read_from_a_private_copy(self):
        id, _ = self.add_execution()
        source = self.data / 'execution/jobs.sqlite3'
        writer = sqlite3.connect(source)
        try:
            writer.execute('PRAGMA journal_mode=WAL'); writer.execute('PRAGMA wal_autocheckpoint=0')
            writer.execute("INSERT INTO settings(key,value) VALUES('wal-proof','only-in-wal')"); writer.commit()
            self.assertGreater(source.with_name(source.name+'-wal').stat().st_size, 0)
            before = hashes(self.old)
            self.convert()
            self.assertEqual(before, hashes(self.old))
            with closing(sqlite3.connect(self.output / 'runtime/execution/jobs.sqlite3')) as copied:
                self.assertEqual(copied.execute("SELECT value FROM settings WHERE key='wal-proof'").fetchone()[0], 'only-in-wal')
        finally:
            writer.close()

    def test_running_worker_lease_blocks_conversion_without_output(self):
        worker = Jobs(str(self.data / 'execution'), Mock())
        try:
            with self.assertRaises(LibraryError) as err:
                self.convert()
            self.assertEqual(err.exception.code, 'source_running'); self.assertFalse(self.output.exists())
        finally:
            worker.close()

    def test_unsafe_source_id_cannot_escape_the_staging_directory(self):
        self.config['templates'][0]['id'] = '../../outside'; self.write_config()
        with self.assertRaises(LibraryError):
            self.convert()
        self.assertFalse(self.output.exists()); self.assertFalse((self.root / 'outside').exists())

    def test_cli_requires_explicit_stopped_source_and_dry_run_is_usable(self):
        command = [sys.executable, str(ROOT / 'tools/convert_file_library.py'), '--source', str(self.old), '--output', str(self.output)]
        refused = subprocess.run(command, capture_output=True, text=True, timeout=15)
        self.assertEqual(refused.returncode, 2); self.assertFalse(self.output.exists())
        checked = subprocess.run(command + ['--source-stopped', '--dry-run'], capture_output=True, text=True, timeout=15)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertFalse(json.loads(checked.stdout)['published']); self.assertFalse(self.output.exists())


class PassiveSvgTests(unittest.TestCase):
    def test_vector_originals_are_kept_byte_for_byte(self):
        self.assertEqual(image_type(SVG), ('image/svg+xml', '.svg'))
        store = None
        with tempfile.TemporaryDirectory() as root:
            store = FileLibrary(root)
            try:
                result = store.put('albums', {'title': '矢量原图', 'steps': [{'stepIndex': 0, 'image': 'images/vector.svg'}]}, create=True, assets={'images/vector.svg': SVG})
                copied = store.import_bundle(store.export_bundle('albums', result['document']['id']))
                self.assertEqual(store.asset('albums', copied['document']['id'], 'images/vector.svg')[0], SVG)
            finally:
                store.close()

    def test_active_external_and_entity_svg_rejected(self):
        bodies = ['<script>alert(1)</script>', '<foreignObject><iframe/></foreignObject>', '<image href="https://example.test/a.png"/>',
                  '<rect onclick="alert(1)"/>', '<animate attributeName="href"/>', '<style>@import url(https://example.test/a.css)</style>',
                  '<use href="//example.test/a.svg"/>', '<rect fill="url(//example.test/a.svg)"/>']
        for body in bodies:
            with self.subTest(body=body), self.assertRaises(LibraryError):
                image_type(('<svg xmlns="http://www.w3.org/2000/svg">'+body+'</svg>').encode())
        with self.assertRaises(LibraryError):
            image_type(b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg>&x;</svg>')


if __name__ == '__main__':
    unittest.main()
