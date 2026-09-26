"""Durable deletion projection and the shared task-operation contract.

A tombstone is a final local deletion, NOT consent to resubmit an upstream request.
Never remove execution/jobs.sqlite3 when upgrading an existing workspace.
"""
import os
from contextlib import closing
import sqlite3


def deleted_album_ids(root):
    path = os.path.join(root, 'runtime', 'execution', 'jobs.sqlite3')
    if not os.path.isfile(path):
        return set()
    with closing(sqlite3.connect(path, timeout=30)) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='deleted_albums'").fetchone():
            return set()
        return {row[0] for row in db.execute('SELECT id FROM deleted_albums')}


def filter_deleted(config, root):
    """Apply on raw reads AND writes, including recovery of old config journals."""
    deleted = deleted_album_ids(root)
    if not deleted:
        return config
    config['_deletedAlbumIds'] = sorted(deleted)
    config['savedGalleries'] = [b for b in config.get('savedGalleries', []) if b.get('id') not in deleted]
    run = config.get('batchRunState', {})
    if isinstance(run.get('queue'), list):
        run['queue'] = [q for q in run['queue'] if q.get('bookId') not in deleted]
    return config


def task_operations(state, frames, blocked=False, enabled=False, corrupt=False):
    active = any(f['state'] == 'running' for f in frames)
    unfinished = [f for f in frames if f['state'] != 'complete']
    uncertain = any(f['state'] == 'unknown' or (f.get('error') or {}).get('kind') in
                    ('result_unconfirmed', 'persistence_unconfirmed') for f in unfinished)
    if state == 'archived':
        return [], uncertain
    actions = ['remove']  # deletion never requires a known upstream outcome
    if state != 'complete':
        actions += ['cancel', 'hold']
    if not active:
        actions.append('archive')
        if state == 'paused' and not uncertain:
            actions.append('resume')
        if unfinished and not corrupt and (state in ('failed', 'unknown', 'canceled', 'paused') or state == 'pending' and any(f.get('ready_at', 0) or f['state'] in ('failed','unknown','canceled','skipped') for f in frames)):
            actions.append('continue')
        if state in ('pending', 'paused') and not enabled and not uncertain and not corrupt and not any(
                f['state'] in ('failed', 'canceled', 'skipped') for f in frames):
            actions.append('start')
    if any(f['state'] == 'unknown' and f.get('upstream') and f.get('provider') == 'comfyui' for f in frames):
        actions.append('reconcile')
    return actions, uncertain
