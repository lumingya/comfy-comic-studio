import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { downloadFile, raw } from './client';
import { continueExport, submitExport, waitForExport } from './exportTasks';

vi.mock('./client', () => ({ raw: vi.fn(), downloadFile: vi.fn() }));

const job = (state: string) => ({ id: 'job_export', state, items: [] });
const response = (state: string) => new Response(JSON.stringify(job(state)));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(downloadFile).mockResolvedValue(new Response('file'));
});
afterEach(() => vi.useRealTimers());

it('polls one job until complete, then downloads its file once', async () => {
  vi.useFakeTimers();
  vi.mocked(raw)
    .mockResolvedValueOnce(response('running'))
    .mockResolvedValueOnce(response('completed'));
  const onState = vi.fn();
  const pending = waitForExport('job_export', 'album.pdf', onState);
  await vi.advanceTimersByTimeAsync(600);
  await pending;
  expect(onState.mock.calls.map(([value]) => value.state)).toEqual(['running', 'completed']);
  expect(raw).toHaveBeenCalledTimes(2);
  expect(downloadFile).toHaveBeenCalledExactlyOnceWith(
    '/api/export/jobs/job_export/file',
    'album.pdf',
    undefined,
  );
});

it('aborts the poll timer immediately without canceling the server task or downloading', async () => {
  vi.useFakeTimers();
  vi.mocked(raw).mockResolvedValue(response('running'));
  const controller = new AbortController();
  const pending = waitForExport('job_export', 'album.pdf', vi.fn(), controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(2000);
  expect(raw).toHaveBeenCalledTimes(1);
  expect(downloadFile).not.toHaveBeenCalled();
});

it.each(['failed', 'canceled'])('retries the existing %s job', async (state) => {
  vi.mocked(raw).mockResolvedValueOnce(response(state)).mockResolvedValueOnce(response('queued'));
  expect(await continueExport('job_export')).toMatchObject({ state: 'queued' });
  expect(raw).toHaveBeenLastCalledWith(
    '/api/jobs/job_export/retry',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  );
});

it.each(['paused', 'blocked'])('resumes the existing %s job', async (state) => {
  vi.mocked(raw).mockResolvedValueOnce(response(state)).mockResolvedValueOnce(response('queued'));
  await continueExport('job_export');
  expect(raw).toHaveBeenLastCalledWith(
    '/api/jobs/job_export/resume',
    expect.objectContaining({ method: 'POST' }),
  );
});

it.each(['running', 'completed'])('does not mutate an already %s job', async (state) => {
  vi.mocked(raw).mockResolvedValue(response(state));
  expect(await continueExport('job_export')).toMatchObject({ state });
  expect(raw).toHaveBeenCalledTimes(1);
});

it('passes the caller-held idempotency key unchanged', async () => {
  vi.mocked(raw).mockResolvedValue(response('queued'));
  await submitExport('portable', { episode_ids: ['ep_1'], format: 'pdf' }, 'stable-key');
  expect(raw).toHaveBeenCalledExactlyOnceWith(
    '/api/export/jobs/portable',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ episode_ids: ['ep_1'], format: 'pdf', idempotency_key: 'stable-key' }),
    }),
  );
});
