"""Mutable workspace data must not be held to a release package checksum."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from tests.data_support import copy_shipped_data
from unittest.mock import patch

from backend.mio_content import bootstrap, distribution, initialize
from backend.mio_library import LibraryError, decode, encode
from backend.mio_native_store import NativeStore
from tools.check_distribution import require_verified_distribution, verify

ROOT = Path(__file__).resolve().parents[1]


class DistributionPolicyTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.project = Path(temp.name) / 'program'
        self.source = self.project / 'data'
        self.workspace = Path(temp.name) / 'workspace'
        copy_shipped_data(self.source)
        self.manifest_path = self.source / 'distribution.json'
        self.original_manifest = self.manifest_path.read_bytes()
        manifest = decode(self.original_manifest)
        story_rel = next(k for k in manifest['files'] if k.startswith('storyboards/'))
        self.story = self.source / story_rel
        self.story_content = self.story.read_bytes()

    def store(self, root=None):
        store = NativeStore(root or self.workspace, self.project)
        self.addCleanup(store.library.close)
        store.wait_index()
        return store

    def edit(self, path, change):
        doc = decode(path.read_bytes())
        change(doc)
        path.write_bytes(encode(doc))

    def test_distribution_reads_edited_data_without_hashing(self):
        self.edit(self.story, lambda doc: doc.update(title='日常编辑'))
        with patch('backend.mio_library.digest', side_effect=AssertionError('runtime hash check')):
            manifest = distribution(self.source)
        self.assertIn(self.story.relative_to(self.source).as_posix(), manifest['files'])
        self.assertEqual(self.manifest_path.read_bytes(), self.original_manifest)

    def test_fresh_external_workspace_imports_edited_story_and_settings(self):
        self.edit(self.story, lambda doc: doc.update(title='已编辑分镜'))
        settings = self.source / 'settings/workspace.json'
        self.edit(settings, lambda doc: doc['ui']['comfyStudio']['studio']['appearance'].update(theme='light'))
        with patch('tools.check_distribution.verify', side_effect=AssertionError('runtime release check')):
            store = self.store()
            self.assertTrue(initialize(store, self.project))
            content = bootstrap(store)
        self.assertEqual(content['config']['templates'][0]['title'], '已编辑分镜')
        self.assertEqual(content['config']['uiConfig']['comfyStudio']['studio']['appearance']['theme'], 'light')
        self.assertEqual(content['contentProblems'], [])
        self.assertEqual(self.manifest_path.read_bytes(), self.original_manifest)

    def test_in_place_save_and_restart_preserves_changes_without_rehash(self):
        store = self.store(self.source)
        initialize(store, self.project)
        config = store.read()
        config['templates'][0]['title'] = '保存后的分镜'
        config['uiConfig']['comfyStudio']['studio']['appearance']['theme'] = 'light'
        store.write(config)
        store.library.close()
        store = self.store(self.source)
        self.assertFalse(initialize(store, self.project))
        content = bootstrap(store)
        self.assertEqual(content['config']['templates'][0]['title'], '保存后的分镜')
        self.assertEqual(content['config']['uiConfig']['comfyStudio']['studio']['appearance']['theme'], 'light')
        self.assertEqual(content['contentProblems'], [])
        self.assertEqual(self.manifest_path.read_bytes(), self.original_manifest)
        self.assertTrue(verify(self.source)[1], 'release check remains independent')

    def test_external_restart_never_overwrites_settings_or_resurrects_story(self):
        store = self.store()
        initialize(store, self.project)
        config = store.read()
        story = store.library.get('storyboards', config['templates'][0]['id'])
        config['uiConfig']['comfyStudio']['studio']['appearance']['theme'] = 'light'
        store.write(config)
        store.library.delete('storyboards', story['document']['id'], story['etag'])
        identity = (self.workspace / 'workspace.json').read_bytes()
        settings = (self.workspace / 'settings/workspace.json').read_bytes()
        store.library.close()
        self.edit(self.story, lambda doc: doc.update(title='程序内的新分镜'))
        (self.source / 'catalog/captions.json').write_bytes(encode({'development': True}))
        store = self.store()
        self.assertFalse(initialize(store, self.project))
        self.assertEqual(bootstrap(store)['config']['templates'], [])
        self.assertEqual((self.workspace / 'workspace.json').read_bytes(), identity)
        self.assertEqual((self.workspace / 'settings/workspace.json').read_bytes(), settings)
        self.assertEqual(store.content_problems, [])
        self.assertTrue(decode((self.workspace / 'catalog/captions.json').read_bytes())['development'])

    def test_unlisted_drafts_and_secrets_are_not_imported(self):
        (self.source / 'settings/secrets.json').write_text('{"token":"private"}')
        (self.source / 'storyboards/private.json').write_text('{"id":"private"}')
        store = self.store()
        initialize(store, self.project)
        self.assertFalse((self.workspace / 'settings/secrets.json').exists())
        self.assertFalse((self.workspace / 'storyboards/private.json').exists())

    def test_missing_seed_is_reported_without_blocking_other_content(self):
        relative = self.story.relative_to(self.source).as_posix()
        self.story.unlink()
        store = self.store()
        initialize(store, self.project)
        content = bootstrap(store)
        self.assertNotIn(decode(self.story_content)['id'], [t['id'] for t in content['config']['templates']])
        self.assertEqual(content['contentProblems'], [{'file': relative, 'reason': 'missing'}])
        self.assertEqual(store.library.catalog('albums')['total'], 1)

    def test_missing_catalog_retains_existing_copy_and_repair_clears_warning(self):
        store = self.store()
        initialize(store, self.project)
        captions = self.source / 'catalog/captions.json'
        original = captions.read_bytes()
        captions.unlink()
        initialize(store, self.project)
        self.assertEqual((self.workspace / 'catalog/captions.json').read_bytes(), original)
        self.assertEqual(bootstrap(store)['contentProblems'], [{'file': 'catalog/captions.json', 'reason': 'missing'}])
        captions.write_bytes(encode({'fixed': True}))  # No checksum update.
        initialize(store, self.project)
        self.assertEqual(bootstrap(store)['contentProblems'], [])
        self.assertEqual((self.workspace / 'catalog/captions.json').read_bytes(), captions.read_bytes())

    def test_invalid_or_stale_install_marker_never_reseeds_or_replays_warnings(self):
        store = self.store()
        initialize(store, self.project)
        for album in (self.workspace / 'albums').iterdir():
            shutil.rmtree(album)
        marker = self.workspace / 'runtime/content-installed.json'
        for raw in (b'{broken', b'[]', b'{"problems":null}',
                    encode({'problems': [{'file': 'storyboards/old.json', 'reason': 'changed'}]})):
            with self.subTest(marker=raw):
                marker.write_bytes(raw)
                self.assertFalse(initialize(store, self.project))
                self.assertEqual(bootstrap(store)['contentProblems'], [])
                self.assertFalse(any((self.workspace / 'albums').rglob('album.json')))
                self.assertEqual(decode(marker.read_bytes()), {'version': distribution(self.source)['version']})

    def test_malformed_manifest_is_a_readable_library_error(self):
        valid = decode(self.original_manifest)
        for value in ([], None, {}, {**valid, 'files': []}, {**valid, 'version': 1}):
            with self.subTest(value=value):
                self.manifest_path.write_bytes(encode(value))
                with self.assertRaisesRegex(LibraryError, 'Invalid distribution manifest'):
                    distribution(self.source)

    def test_unsafe_paths_are_rejected_before_any_seed_copy(self):
        for relative in ('../outside.json', '/tmp/outside.json', 'catalog/../../escape.json', 'catalog\\escape.json'):
            with self.subTest(path=relative):
                manifest = decode(self.original_manifest)
                manifest['files'][relative] = '0' * 64
                self.manifest_path.write_bytes(encode(manifest))
                store = self.store()
                with self.assertRaisesRegex(LibraryError, 'Unsafe resource path'):
                    initialize(store, self.project)
                self.assertFalse((self.workspace / 'catalog/index.json').exists())
                store.library.close()

    def test_symlinks_are_still_rejected(self):
        original = self.story.read_bytes()
        outside = self.project / 'outside.json'
        outside.write_bytes(original)
        self.story.unlink()
        try:
            self.story.symlink_to(outside)
        except OSError:
            self.skipTest('Symlinks unavailable')
        with self.assertRaisesRegex(LibraryError, 'Symbolic links'):
            distribution(self.source)

    def test_release_check_still_reports_changed_and_missing_files(self):
        self.edit(self.story, lambda doc: doc.update(title='Edited'))
        (self.source / 'catalog/captions.json').unlink()
        _, problems = verify(self.source)
        self.assertIn({'file': self.story.relative_to(self.source).as_posix(), 'reason': 'changed'}, problems)
        self.assertIn({'file': 'catalog/captions.json', 'reason': 'missing'}, problems)
        with self.assertRaisesRegex(LibraryError, 'MIO-DATA-001: Release data differs'):
            require_verified_distribution(self.source)

    def test_release_packaging_refuses_stale_hashes(self):
        from tools import package_project
        self.edit(self.story, lambda doc: doc.update(title='Edited'))
        with patch.object(package_project, 'ROOT', self.project):
            with self.assertRaisesRegex(LibraryError, 'MIO-DATA-001'):
                list(package_project.source_files())

    def test_conversion_test_adapter_does_not_gate_on_release_checksums(self):
        from tools import build_release
        self.edit(self.story, lambda doc: doc.update(title='Edited'))
        with patch.object(build_release, 'ROOT_DIR', str(self.project)):
            content, *_ = build_release.get_v9_pure_default_data()
        self.assertEqual(content['templates'][0]['title'], 'Edited')

    def test_normal_test_entrypoint_does_not_run_release_hash_check(self):
        scripts = json.loads((ROOT / 'package.json').read_text())['scripts']
        self.assertNotIn('test:distribution', scripts['test:current'])
        self.assertEqual(scripts['test:distribution'], 'python tools/check_distribution.py')
