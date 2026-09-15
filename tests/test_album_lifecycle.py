"""Regressions for the actual stop -> 409 deletion dead end and stale writers."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

from backend.mio_jobs import Jobs, Conflict
from backend.mio_lifecycle import filter_deleted
from backend import mio_foundation
from backend import server


class AlbumDeletionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        library=__import__('backend.mio_library',fromlist=['*']).FileLibrary(self.temp.name);self.addCleanup(library.close)
        self.calls = []
        self.store = Jobs(str(Path(self.temp.name) / 'runtime' / 'execution'), self.execute)
        self.store.close()  # deterministic explicit claim/execute, no sleeps
        self.addCleanup(self.store.close)

    def execute(self, frame):
        self.calls.append(frame['prompt'])
        return {'image': '/images/test.png'}

    def submit(self, album, count=2, token=None):
        payload = {'albumId': album, 'owner': 'owner-' + album, 'frames': [
            {'config': {'provider': 'openai', 'model': 'test'}, 'albumId': album,
             'prompt': str(i)} for i in range(count)]}
        return self.store.submit(payload, token or album), payload

    def test_stopped_with_unknown_result_removes_without_consent(self):
        job, payload = self.submit('stopped')
        self.store.claim()  # request considered in-flight; stop leaves unknown charge evidence
        self.store.control(job['id'], 'cancel')
        stopped = self.store.get(job['id'])
        self.assertEqual(stopped['state'], 'canceled')
        self.assertTrue(stopped['requiresRecoveryConsent'])
        self.assertIn('remove', stopped['allowedActions'])
        # This was the concrete HTTP 409 source, not a synthesized UI state.
        removed = self.store.control(job['id'], 'remove')
        self.assertEqual(removed['state'], 'archived')
        self.assertEqual(self.store.list()['jobs'], [])
        self.assertEqual(self.calls, [])
        self.assertTrue(removed['error'])  # diagnostics remain durable
        with self.assertRaises(Conflict):
            self.store.submit(payload, 'fresh-key-cannot-resurrect')

    def test_batch_mixed_states_is_one_commit_and_includes_unmapped_jobs(self):
        names = ['waiting', 'paused', 'running', 'failed', 'timeout', 'stopped', 'complete']
        ids = []
        for name in names:
            job, _ = self.submit(name)
            ids.append(job['id'])
            with self.store.connect() as db:
                state = {'waiting': 'pending', 'paused': 'pending', 'timeout': 'unknown', 'stopped': 'canceled'}.get(name, name)
                result = json.dumps({'index': 0, 'image': '/images/test.png'}) if state == 'complete' else None
                db.execute('UPDATE job_frames SET state=?,result=? WHERE job=?', (state, result, job['id']))
                db.execute('UPDATE jobs SET blocked=? WHERE id=?', (int(name == 'paused'), job['id']))
                self.store.aggregate(db, job['id'])
        extra, _ = self.submit('stopped', token='unmapped-task')
        ids.append(extra['id'])
        result = self.store.delete_albums(names)
        self.assertEqual(set(result['removedJobIds']), set(ids))
        self.assertEqual(set(result['deletedAlbumIds']), set(names))
        self.assertEqual(self.store.list()['jobs'], [])
        self.assertEqual(self.store.delete_albums(names)['removedJobIds'], [])
        self.assertFalse(self.store.step())
        self.assertEqual(self.calls, [])

    def test_late_response_cannot_restore_deleted_or_block_next_album(self):
        first, _ = self.submit('late')
        row = self.store.claim()
        next_job, _ = self.submit('next', count=1)
        def late(frame):
            self.calls.append('late-request')
            self.store.delete_albums(['late'])
            frame['_checkpoint']('late-upstream-id')
            return {'image': '/images/late-paid.png'}
        self.store.execute = late
        self.store.execute_row(row)
        old = self.store.get(first['id'])
        self.assertEqual(old['results'], [])
        self.assertFalse(old['running_count'])
        self.assertIsNone(old['upstream'])
        self.assertTrue(any(e['state'] == 'late_result_discarded' for e in self.store.events()))
        self.store.execute = self.execute
        self.assertTrue(self.store.step())
        self.assertEqual(self.store.get(next_job['id'])['state'], 'complete')
        self.assertEqual(self.calls, ['late-request', '0'])

    def test_invalid_batch_does_not_partially_delete(self):
        job, _ = self.submit('retain')
        with self.assertRaises(ValueError):
            self.store.delete_albums(['retain', None])
        self.assertEqual(self.store.get(job['id'])['state'], 'pending')
        self.assertEqual(self.store.list()['deletedAlbumIds'], [])

    def test_storage_failure_rolls_back_whole_batch(self):
        a, _ = self.submit('a')
        b, _ = self.submit('b')
        with patch.object(self.store, 'event', side_effect=OSError('controlled disk failure')):
            with self.assertRaises(OSError):
                self.store.delete_albums(['a', 'b'])
        self.assertEqual(self.store.list()['deletedAlbumIds'], [])
        self.assertEqual(self.store.get(a['id'])['state'], 'pending')
        self.assertEqual(self.store.get(b['id'])['state'], 'pending')

    def test_deleted_ids_survive_restart_and_stale_full_config(self):
        job, payload = self.submit('gone')
        stale = {'savedGalleries': [{'id': 'gone'}, {'id': 'keep'}],
                 'batchRunState': {'queue': [{'bookId': 'gone', 'serverId': job['id']}, {'bookId': 'keep'}]}}
        self.store.delete_albums(['gone'])
        self.store = Jobs(str(Path(self.temp.name) / 'runtime' / 'execution'), self.execute)
        self.store.close()
        self.assertEqual(self.store.list()['deletedAlbumIds'], ['gone'])
        self.assertEqual(self.store.list()['jobs'], [])
        with self.assertRaises(Conflict):
            self.store.submit(payload, 'gone')
        filtered = filter_deleted(copy.deepcopy(stale), self.temp.name)
        self.assertEqual(filtered['savedGalleries'], [{'id': 'keep'}])
        projected = mio_foundation.project_execution(SimpleNamespace(DATA_DIR=self.temp.name), copy.deepcopy(stale))
        self.assertEqual(projected, filtered)
        # Exercise real split JSON writer/read path, not just the filtering helper.
        files = {key: str(Path(self.temp.name) / key / 'state.json') for key in server.CONFIG_FILES}
        with patch.multiple(server, DATA_DIR=self.temp.name, CONFIG_FILES=files,
                            LEGACY_CONFIG_FILES={}, LEGACY_DATA_FILE=str(Path(self.temp.name)/'no-legacy')):
            full = {key: kind() for key, kind in server.REQUIRED_CONFIG_FIELDS.items()}
            full.update(copy.deepcopy(stale))
            for b in full['savedGalleries']:b['steps']=[]
            for i,q in enumerate(full['batchRunState']['queue']):q['id']='test_task_'+str(i)
            server.write_split_config(full)
            loaded = server.read_merged_config()
            self.assertEqual([b['id'] for b in loaded['savedGalleries']], ['keep'])
            self.assertEqual([q['bookId'] for q in loaded['batchRunState']['queue']], ['keep'])

    def test_removal_does_not_authorize_unknown_retry_in_other_album(self):
        gone, _ = self.submit('gone')
        keep, _ = self.submit('keep')
        with self.store.connect() as db:
            db.execute("UPDATE job_frames SET state='unknown',error=? WHERE job=?", (json.dumps({'kind':'result_unconfirmed'}),keep['id']))
            self.store.aggregate(db, keep['id'])
        self.store.delete_albums(['gone'])
        current = self.store.get(keep['id'])
        with self.assertRaises(Conflict):
            self.store.control(keep['id'], 'continue', recovery={'expectedCursor':0,'expectedUpdated':current['updated']})
        self.assertEqual(self.store.get(keep['id'])['attempts'], 0)

    def test_capabilities_match_server_for_stopped_unknown_and_paused(self):
        job, _ = self.submit('capabilities')
        self.store.claim()
        current = self.store.get(job['id'])
        self.assertIn('remove', current['allowedActions'])
        self.assertNotIn('continue', current['allowedActions'])
        self.store.control(job['id'], 'cancel')
        current = self.store.get(job['id'])
        self.assertIn('continue', current['allowedActions'])
        self.assertNotIn('start', current['allowedActions'])
        self.assertNotIn('resume', current['allowedActions'])
        # Hiding the task also must not confuse deletion with a paid retry.
        self.store.control(job['id'], 'archive')
        self.assertEqual(self.store.get(job['id'])['allowedActions'], [])

    def test_diagnostics_keep_error_not_echoed_auth_or_image_binary(self):
        from backend.providers.request_evidence import safe_error_text
        encoded='A'*4000
        text='HTTP 503: '+json.dumps({'error':{'message':'upstream unavailable'},'Authorization':'Bearer private-token','api_key':'private-key','b64_json':encoded})
        clean=safe_error_text(text)
        self.assertIn('HTTP 503',clean)
        self.assertIn('upstream unavailable',clean)
        for secret in ['private-token','private-key',encoded]:self.assertNotIn(secret,clean)
        self.assertNotIn('token123',safe_error_text('Authorization: Bearer token123'))
