"""New architecture tests; deliberately independent of the legacy config adapter.
No provider calls, paid requests, server imports, or existing data writes.
"""
import copy
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

from backend import mio_library as lib

PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')


class FileLibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'new-data'
        self.store = lib.FileLibrary(self.root)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def story(self, **values):
        return self.store.put('storyboards', {'title': '晴天借阅室', 'frames': [
            {'name': '借来阳光', 'prompt': '保持{主角参考图}的人物身份。', 'caption': '明天再见。', 'negative': '水印'}], **values}, create=True)

    def test_individual_chinese_files_and_owned_album_images(self):
        a = self.story(); b = self.story()
        self.assertNotEqual(a['document']['id'], b['document']['id'])
        self.assertNotEqual(a['file'], b['file'])
        self.assertIn('晴天借阅室', a['file'])
        album = self.store.put('albums', {'title': '晴天', 'steps': [{'stepIndex': 0, 'image': 'images/sun.png', 'prompt': '完整提示词', 'caption': '完整台词'}], 'sourceSnapshot': {'prompts': ['尚未生成的提示词']}}, create=True, assets={'images/sun.png': PNG})
        self.assertEqual((self.root / album['file']).name, 'album.json')
        self.assertEqual((self.root / album['file']).parent.joinpath('images/sun.png').read_bytes(), PNG)
        self.assertEqual(self.store.get('albums', album['document']['id'])['document'], album['document'])
        self.assertFalse((self.root / 'albums/index.json').exists())

    def test_two_editors_conflict_without_losing_either_content(self):
        a = self.story(); stale = copy.deepcopy(a['document'])
        doc = copy.deepcopy(a['document']); doc['frames'][0]['prompt'] = '新提示词'
        saved = self.store.put('storyboards', doc, expected=a['etag'])
        stale['title'] = '旧标签页'
        with self.assertRaises(lib.LibraryError) as err:
            self.store.put('storyboards', stale, expected=a['etag'])
        self.assertEqual(err.exception.code, 'revision_conflict')
        self.assertEqual(self.store.get('storyboards', doc['id']), saved)
        self.assertEqual(stale['title'], '旧标签页')

    def test_external_edit_uses_actual_file_hash_not_cached_etag(self):
        a = self.story(); raw = copy.deepcopy(a['document']); raw['title'] = '外部编辑'
        (self.root / a['file']).write_bytes(lib.encode(raw))
        with self.assertRaises(lib.LibraryError):
            self.store.put('storyboards', a['document'], expected=a['etag'])
        self.assertEqual(self.store.get('storyboards', raw['id'])['document']['title'], '外部编辑')

    def test_editing_one_resource_does_not_rewrite_others(self):
        a = self.story(); b = self.story()
        stamp = (self.root / b['file']).stat().st_mtime_ns
        doc = copy.deepcopy(a['document']); doc['title'] = '另一个标题'
        self.store.put('storyboards', doc, expected=a['etag'])
        self.assertEqual((self.root / b['file']).stat().st_mtime_ns, stamp)
        path = self.root / a['file']; stamp = path.stat().st_mtime_ns
        current = self.store.get('storyboards', doc['id'])
        self.store.put('storyboards', current['document'], expected=current['etag'])
        self.assertEqual(path.stat().st_mtime_ns, stamp)

    def test_plain_copy_and_rename_are_discovered_incrementally(self):
        a = self.story()
        renamed = self.root / 'storyboards/直接复制的中文分镜.json'
        (self.root / a['file']).rename(renamed)
        scanned = self.store.scan()
        self.assertEqual(scanned['changed'], 1)
        self.assertEqual(self.store.get('storyboards', a['document']['id'])['file'], 'storyboards/直接复制的中文分镜.json')
        self.assertEqual(self.store.scan()['changed'], 0)

    def test_duplicate_ids_are_reported_and_neither_copy_is_chosen(self):
        a = self.story(); duplicate = self.root / 'storyboards/同ID副本.json'
        shutil.copyfile(self.root / a['file'], duplicate)
        self.store.scan()
        self.assertEqual(self.store.catalog('storyboards')['total'], 0)
        self.assertIn('Duplicate ID', self.store.problems()[0]['message'])
        with self.assertRaises(lib.LibraryError) as err:
            self.store.get('storyboards', a['document']['id'])
        self.assertEqual(err.exception.code, 'duplicate_id')
        self.assertEqual(duplicate.read_bytes(), (self.root / a['file']).read_bytes())

    def test_missing_corrupt_file_does_not_erase_other_resources(self):
        a = self.story(); bad = self.root / 'storyboards/坏文件.json'
        bad.write_text('{not json', 'utf-8'); self.store.scan()
        self.assertEqual(self.store.catalog('storyboards')['total'], 1)
        self.assertEqual(len(self.store.problems()), 1)
        self.assertEqual(self.store.get('storyboards', a['document']['id'])['document'], a['document'])

    def test_cache_deleted_or_corrupted_is_rebuildable(self):
        a = self.story(); original = (self.root / a['file']).read_bytes()
        self.store.close()
        shutil.rmtree(self.root / '.cache')
        self.store = lib.FileLibrary(self.root)
        self.assertEqual(self.store.catalog('storyboards')['total'], 0)
        self.store.scan(); self.assertEqual(self.store.catalog('storyboards')['total'], 1)
        self.store.close()
        (self.root / '.cache/catalog.sqlite3').write_bytes(b'not a database')
        self.store = lib.FileLibrary(self.root); self.store.scan()
        self.assertEqual(self.store.get('storyboards', a['document']['id'])['document'], a['document'])
        self.assertEqual((self.root / a['file']).read_bytes(), original)

    def test_warm_catalogue_does_not_open_entity_json_or_images(self):
        a = self.story(); self.store.scan()
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('Unexpected entity read')), patch.object(lib, 'image_type', side_effect=AssertionError('Unexpected image decoding')):
            result = self.store.catalog('storyboards')
            scan = self.store.scan()
        self.assertEqual(result['items'][0]['id'], a['document']['id'])
        self.assertEqual(scan['changed'], 0)

    def test_catalogue_is_bounded_and_has_no_full_prompts_or_snapshots(self):
        for n in range(4):
            self.store.put('albums', {'title': '书' + str(n), 'description': '长介绍'*1000, 'steps': [{'stepIndex': 0, 'image': 'images/a.png', 'prompt': '绝不出现在索引' * 1000}], 'sourceSnapshot': {'frames': [{'prompt': 'hidden'}]}, 'totalSteps': 12}, create=True, assets={'images/a.png': PNG})
        page = self.store.catalog('albums', limit=2)
        self.assertEqual(page['total'], 4); self.assertEqual(len(page['items']), 2)
        self.assertNotIn('绝不出现在索引', json.dumps(page, ensure_ascii=False))
        self.assertNotIn('sourceSnapshot', json.dumps(page))
        self.assertEqual(page['items'][0]['generatedSteps'], 1)
        self.assertEqual(page['items'][0]['totalSteps'], 12)
        self.assertLess(len(lib.encode(page)), 8000)

    def test_share_round_trip_into_unrelated_directory(self):
        preset = self.store.put('characters', {'title': '七海', 'entries': [{'key': '主角参考图', 'type': 'image', 'value': {'src': 'images/nanami.png'}}]}, create=True, assets={'images/nanami.png': PNG})
        bundle = self.store.export_bundle('characters', preset['document']['id'])
        with tempfile.TemporaryDirectory() as dest:
            other = lib.FileLibrary(dest)
            try:
                imported = other.import_bundle(bundle)
                self.assertNotEqual(imported['document']['id'], preset['document']['id'])
                self.assertEqual(imported['document']['entries'], preset['document']['entries'])
                self.assertEqual(other.asset('characters', imported['document']['id'], 'images/nanami.png')[0], PNG)
                again = other.import_bundle(bundle)
                self.assertNotEqual(again['document']['id'], imported['document']['id'])
            finally:
                other.close()

    def test_sharing_excludes_settings_keys_jobs_and_nested_credentials(self):
        doc = {'id': 'story_private', 'title': '测试', 'frames': [{'prompt': '绘制一个晴天', 'extension': {'authorization': 'TOP_SECRET', 'config': {'key': 'TOP_SECRET'}}}], 'sourceSnapshot': {'config': {'key': 'TOP_SECRET'}}, 'execution': {'raw': 'TOP_SECRET'}, 'apiKey': 'TOP_SECRET'}
        with self.assertRaises(lib.LibraryError) as err:
            self.store.put('storyboards', doc, create=True)
        self.assertEqual(err.exception.code, 'unprotected_secret')
        # A defensive share DTO also strips secret fields from an untrusted in-memory document.
        sanitized = lib.share_document('storyboards', doc)
        self.assertNotIn('TOP_SECRET', json.dumps(sanitized))
        a = self.store.put('storyboards', sanitized, create=True)
        with zipfile.ZipFile(io.BytesIO(self.store.export_bundle('storyboards', a['document']['id']))) as z:
            self.assertEqual(set(z.namelist()), {'manifest.json', 'resource.json'})
            self.assertNotIn('TOP_SECRET', z.read('resource.json').decode())

    def test_images_cannot_be_overwritten_in_place(self):
        a = self.store.put('characters', {'title': '七海', 'entries': [{'key': '图', 'type': 'image', 'value': {'src': 'images/a.png'}}]}, create=True, assets={'images/a.png': PNG})
        with self.assertRaises(lib.LibraryError):
            self.store.put('characters', a['document'], expected=a['etag'], assets={'images/a.png': PNG + b'changed'})
        self.assertEqual(self.store.asset('characters', a['document']['id'], 'images/a.png')[0], PNG)

    def test_partial_write_rolls_forward_after_restart(self):
        real = lib.atomic_write
        failed = False
        def fault(path, raw, private=False):
            nonlocal failed
            if str(path).endswith('album.json') and not failed:
                failed = True
                raise OSError('controlled disk write failure')
            return real(path, raw, private)
        with patch.object(lib, 'atomic_write', side_effect=fault):
            with self.assertRaises(OSError):
                self.store.put('albums', {'title': '恢复册', 'steps': [{'stepIndex': 0, 'image': 'images/a.png'}]}, create=True, assets={'images/a.png': PNG})
        self.assertTrue(list((self.root / '.transactions').glob('*/commit.json')))
        self.store.close(); self.store = lib.FileLibrary(self.root); self.store.scan()
        book = self.store.catalog('albums')['items'][0]
        self.assertEqual(self.store.asset('albums', book['id'], 'images/a.png')[0], PNG)
        self.assertFalse(list((self.root / '.transactions').iterdir()))

    def test_failure_before_commit_never_changes_source(self):
        a = self.story(); raw = (self.root / a['file']).read_bytes()
        doc = copy.deepcopy(a['document']); doc['title'] = '不应提交'
        real = lib.atomic_write
        def fault(path, content, private=False):
            if str(path).endswith('commit.json'):
                raise OSError('journal cannot be persisted')
            return real(path, content, private)
        with patch.object(lib, 'atomic_write', side_effect=fault), self.assertRaises(OSError):
            self.store.put('storyboards', doc, expected=a['etag'])
        self.assertEqual((self.root / a['file']).read_bytes(), raw)
        self.assertFalse(list((self.root / '.transactions').iterdir()))

    def test_delete_keeps_owned_images_and_json_together_in_trash(self):
        a = self.store.put('albums', {'title': '待删画册', 'steps': [{'stepIndex': 0, 'image': 'images/a.png'}]}, create=True, assets={'images/a.png': PNG})
        deleted = self.store.delete('albums', a['document']['id'], a['etag'])
        self.assertEqual(self.store.catalog('albums')['total'], 0)
        trash = self.root / deleted['trash']
        self.assertEqual(len(list(trash.glob('*/album.json'))), 1)
        self.assertEqual(next(trash.glob('*/images/a.png')).read_bytes(), PNG)

    def test_interrupted_preset_deletion_recovers_both_moves(self):
        a = self.store.put('characters', {'title': '七海', 'entries': [{'key': '图', 'type': 'image', 'value': {'src': 'images/a.png'}}]}, create=True, assets={'images/a.png': PNG})
        real = lib.os.replace
        def fault(src, dst):
            if str(src).endswith('.assets'):
                raise OSError('controlled interrupted move')
            return real(src, dst)
        with patch.object(lib.os, 'replace', side_effect=fault), self.assertRaises(OSError):
            self.store.delete('characters', a['document']['id'], a['etag'])
        self.store.close(); self.store = lib.FileLibrary(self.root); self.store.scan()
        self.assertEqual(self.store.catalog('characters')['total'], 0)
        self.assertEqual(len(list((self.root / '.trash').glob('*/*.json'))), 2)
        self.assertEqual(next((self.root / '.trash').glob('*/*.assets/images/a.png')).read_bytes(), PNG)

    def test_symlink_and_traversal_rejected(self):
        a = self.story()
        for path in ('../settings/secrets.json', '/tmp/file', 'images/../../secrets.json', 'images\\x.png', 'C:/file'):
            with self.assertRaises(lib.LibraryError):
                lib.owned_path(self.root, path)
        target = self.root / 'storyboards/linked.json'
        target.symlink_to(self.root / a['file'])
        self.store.scan()
        self.assertEqual(self.store.catalog('storyboards')['total'], 1)
        with self.assertRaises(lib.LibraryError):
            lib.owned_path(self.root, 'storyboards/linked.json')

    def test_zip_slip_duplicate_entries_and_changed_checksums_rejected(self):
        for entries in ([('../secrets.json', b'x')], [('resource.json', b'{}'), ('resource.json', b'{}')]):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w') as z:
                for path, raw in entries:
                    z.writestr(path, raw)
            with self.assertRaises(lib.LibraryError):
                self.store.import_bundle(buf.getvalue())
        a = self.story(); bundle = self.store.export_bundle('storyboards', a['document']['id'])
        with zipfile.ZipFile(io.BytesIO(bundle)) as z:
            files = {name: z.read(name) for name in z.namelist()}
        files['resource.json'] += b' '
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            for path, raw in files.items():
                z.writestr(path, raw)
        with self.assertRaises(lib.LibraryError):
            self.store.import_bundle(buf.getvalue())
        self.assertEqual(self.store.catalog('storyboards')['total'], 1)

    def test_duplicate_json_members_and_nan_rejected(self):
        for raw in ('{"id":"first","id":"second"}', '{"number": NaN}'):
            with self.assertRaises(lib.LibraryError):
                lib.decode(raw)

    def test_existing_old_directory_is_untouched(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / 'albums/index.json'; file.parent.mkdir()
            file.write_text('{"savedGalleries":[]}', 'utf-8')
            before = file.read_bytes()
            with self.assertRaises(lib.LibraryError) as err:
                lib.FileLibrary(root)
            self.assertEqual(err.exception.code, 'conversion_required')
            self.assertEqual(file.read_bytes(), before)
            self.assertFalse((Path(root) / 'workspace.json').exists())

    def test_malformed_scene_indices_do_not_stop_the_indexer(self):
        self.story()
        folder = self.root / 'albums/bad'; folder.mkdir()
        (folder / 'album.json').write_bytes(lib.encode({'id': 'bad', 'title': '坏索引', 'steps': [{'stepIndex': []}]}))
        self.store.scan()
        self.assertEqual(self.store.catalog('storyboards')['total'], 1)
        self.assertEqual(len(self.store.problems()), 1)

    def test_source_snapshots_are_not_silently_shared_without_consent(self):
        doc = {'title': '未完成的故事', 'steps': [], 'totalSteps': 2,
               'sourceSnapshot': {'frames': [{'name': '第二幕', 'prompt': '{地点}的一束光', 'caption': '坐一会儿吧。', '_scope': {'地点': '庭院'}, '_execution': {'baseUrl': 'https://private.test'}}], 'execution': {'workflow': 'NOT_SHARED'}}}
        a = self.store.put('albums', doc, create=True)
        imported = self.store.import_bundle(self.store.export_bundle('albums', a['document']['id']))['document']
        self.assertNotIn('promptSnapshots', imported)
        self.assertNotIn('sourceSnapshot', imported)
        self.assertNotIn('庭院', json.dumps(imported,ensure_ascii=False))
        self.assertNotIn('NOT_SHARED', json.dumps(imported))
        self.assertNotIn('private.test', json.dumps(imported))

    def test_case_colliding_asset_paths_are_rejected_for_windows_portability(self):
        with self.assertRaises(lib.LibraryError):
            self.store.put('albums', {'title': '冲突', 'steps': [{'stepIndex': 0, 'image': 'images/a.png'}, {'stepIndex': 1, 'image': 'images/A.png'}]}, create=True, assets={'images/a.png': PNG, 'images/A.png': PNG})
        for path in ('images//a.png', 'images/./a.png', 'images/NUL.png', 'images/a. /b.png'):
            with self.assertRaises(lib.LibraryError):
                lib.owned_path(self.root, path)

    def test_abrupt_process_exit_recovers_durable_intent(self):
        code = """
import os, sys
from backend import mio_library as lib
store = lib.FileLibrary(sys.argv[1])
real = lib.atomic_write
def abrupt(path, raw, private=False):
    if str(path).endswith('album.json'):
        os._exit(73)
    return real(path, raw, private)
lib.atomic_write = abrupt
store.put('albums', {'title': '进程退出恢复', 'steps': []}, create=True)
"""
        child = subprocess.run([sys.executable, '-c', code, str(self.root)], cwd=Path(lib.__file__).resolve().parents[1], capture_output=True, timeout=10)
        self.assertEqual(child.returncode, 73, child.stderr.decode())
        self.store.close(); self.store = lib.FileLibrary(self.root); self.store.scan()
        self.assertEqual(self.store.catalog('albums')['items'][0]['title'], '进程退出恢复')
        self.assertFalse(list((self.root / '.transactions').iterdir()))

    def test_separate_processes_use_the_filesystem_writer_lock(self):
        a = self.story()
        code = """
import sys
from backend.mio_library import FileLibrary, LibraryError
store = FileLibrary(sys.argv[1])
doc = store.get('storyboards', sys.argv[2])['document']
print('ready', flush=True)
input()
doc['title'] = sys.argv[4]
try:
    store.put('storyboards', doc, expected=sys.argv[3])
    print('ok', flush=True)
except LibraryError as e:
    print(e.code, flush=True)
store.close()
"""
        children = [subprocess.Popen([sys.executable, '-c', code, str(self.root), a['document']['id'], a['etag'], str(n)], cwd=Path(lib.__file__).resolve().parents[1], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for n in range(2)]
        try:
            for child in children:
                self.assertEqual(child.stdout.readline().strip(), 'ready')
            for child in children:
                child.stdin.write('go\n'); child.stdin.flush()
            outcomes = []
            for child in children:
                stdout, stderr = child.communicate(timeout=10)
                self.assertEqual(child.returncode, 0, stderr)
                outcomes.append(stdout.strip())
            self.assertCountEqual(outcomes, ['ok', 'revision_conflict'])
        finally:
            for child in children:
                if child.poll() is None: child.kill(); child.wait()

    def test_simultaneous_writers_have_one_winner(self):
        a = self.story(); gate = threading.Barrier(2); outcomes = []
        def write(title):
            document = copy.deepcopy(a['document']); document['title'] = title
            gate.wait()
            try:
                self.store.put('storyboards', document, expected=a['etag']); outcomes.append('ok')
            except lib.LibraryError as e:
                outcomes.append(e.code)
        threads = [threading.Thread(target=write, args=(str(n),)) for n in range(2)]
        for t in threads: t.start()
        for t in threads: t.join(timeout=3); self.assertFalse(t.is_alive())
        self.assertCountEqual(outcomes, ['ok', 'revision_conflict'])


if __name__ == '__main__':
    unittest.main()
