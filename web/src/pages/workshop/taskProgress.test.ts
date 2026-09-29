import { describe, expect, it } from 'vitest';
import type { Episode, Job, JobItem } from '../../api/types';
import { errorCategory, failureSummary, pageProgress } from './taskProgress';

const episode = (adopted: string[] = []) =>
  ({
    id: 'ep',
    panels: ['a', 'b', 'c'].map((id, order) => ({ id, order })),
    takes: adopted.map((panel_id) => ({
      id: `t-${panel_id}`,
      panel_id,
      asset_id: `asset-${panel_id}`,
      status: 'adopted',
      variant_id: null,
    })),
  }) as unknown as Episode;

const item = (idx: number, panel: string, state: JobItem['state'], message = ''): JobItem => ({
  idx,
  state,
  label: '',
  attempts: 1,
  instance_id: null,
  error: message ? { kind: 'unreachable', message } : null,
  result: null,
  input: { meta: { panel_id: panel, variant_id: null } },
  started: null,
  finished: null,
});

const job = (id: string, state: Job['state'], items: JobItem[], extra: Partial<Job> = {}): Job => ({
  id,
  kind: 'comfy.render',
  title: '',
  state,
  paused: state === 'paused',
  blocked: false,
  canceled: false,
  owner: 'ep',
  error: null,
  created: 0,
  updated: 0,
  items,
  ...extra,
});

describe('pageProgress', () => {
  it('uses the adopted takes when no job knows better', () => {
    const pages = pageProgress(episode(['a']), []);
    expect(pages.get('a')).toEqual({ state: 'done', asset: 'asset-a' });
    expect(pages.get('b')?.state).toBe('standby');
  });

  it('reads running, queued and paused scenes from active jobs', () => {
    const running = job('j', 'running', [item(0, 'a', 'running'), item(1, 'b', 'pending')]);
    let pages = pageProgress(episode(), [running]);
    expect(pages.get('a')?.state).toBe('running');
    expect(pages.get('b')?.state).toBe('queued');
    pages = pageProgress(episode(), [{ ...running, state: 'paused', paused: true }]);
    expect(pages.get('b')?.state).toBe('paused');
    // A pending item of a finished (canceled) job is not waiting for anything.
    pages = pageProgress(episode(), [{ ...running, state: 'canceled' }]);
    expect(pages.get('b')?.state).toBe('standby');
  });

  it('shows failures, but keeps an adopted image after a failed rerun', () => {
    const failed = job('j', 'failed', [item(0, 'a', 'failed', 'no'), item(1, 'b', 'failed', 'no')]);
    const pages = pageProgress(episode(['b']), [failed]);
    expect(pages.get('a')).toMatchObject({ state: 'failed', jobId: 'j', idx: 0 });
    expect(pages.get('b')).toMatchObject({
      state: 'done',
      asset: 'asset-b',
      error: { message: 'no' },
    });
  });

  it('lets the newest job that holds a scene decide', () => {
    const old = job('old', 'failed', [item(0, 'a', 'failed', 'old')]);
    const fresh = job('new', 'running', [item(0, 'a', 'running')]);
    expect(pageProgress(episode(), [fresh, old]).get('a')?.state).toBe('running');
  });
});

describe('failureSummary', () => {
  it('summarises failed scenes and the job that paused itself', () => {
    const held = job(
      'j',
      'paused',
      [
        item(0, 'a', 'failed', 'refused'),
        item(1, 'b', 'failed', 'refused'),
        item(2, 'c', 'pending'),
      ],
      { error: '连续失败 3 项，已暂停。' },
    );
    const pages = pageProgress(episode(), [held]);
    expect(failureSummary(pages, [held])).toEqual({
      count: 2,
      kind: 'unreachable',
      message: 'refused',
      jobId: 'j',
      indexes: [0, 1],
      held: true,
      note: '连续失败 3 项，已暂停。',
    });
  });

  it('is null when nothing needs attention', () => {
    const ok = job('j', 'completed', [item(0, 'a', 'complete')]);
    expect(failureSummary(pageProgress(episode(['a']), [ok]), [ok])).toBeNull();
  });
});

describe('errorCategory', () => {
  it('maps engine error kinds to the settings that fix them', () => {
    expect(errorCategory('unreachable')).toBe('connection');
    expect(errorCategory('rejected')).toBe('workflow');
    expect(errorCategory('cloud_error')).toBe('channel');
    expect(errorCategory('rate_limited')).toBe('rate');
    expect(errorCategory('guard')).toBe('other');
  });
});
