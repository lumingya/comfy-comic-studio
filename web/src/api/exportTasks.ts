import { downloadFile, raw } from './client';
import type { Job } from './types';

export type ExportKind = 'album' | 'portable' | 'strip';

function pollDelay(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 600);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** A failed download can be repeated without rendering the document again. */
export async function waitForExport(
  id: string,
  name: string,
  onState: (job: Job) => void,
  signal?: AbortSignal,
): Promise<Response> {
  for (;;) {
    signal?.throwIfAborted();
    const job = (await (await raw(`/api/jobs/${id}`, { signal })).json()) as Job;
    signal?.throwIfAborted();
    onState(job);
    signal?.throwIfAborted();
    if (job.state === 'completed') return downloadFile(`/api/export/jobs/${id}/file`, name, signal);
    if (['failed', 'canceled', 'blocked', 'paused'].includes(job.state)) {
      throw new Error(
        job.items?.find((item) => item.error)?.error?.message || job.error || job.state,
      );
    }
    await pollDelay(signal);
  }
}

export async function submitExport(
  kind: ExportKind,
  body: unknown,
  key: string,
  signal?: AbortSignal,
): Promise<Job> {
  return (
    await raw(`/api/export/jobs/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(body as object), idempotency_key: key }),
      signal,
    })
  ).json();
}

export async function continueExport(id: string, signal?: AbortSignal): Promise<Job> {
  const job = (await (await raw(`/api/jobs/${id}`, { signal })).json()) as Job;
  signal?.throwIfAborted();
  if (job.state === 'failed' || job.state === 'canceled') {
    return (
      await raw(`/api/jobs/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal,
      })
    ).json();
  }
  if (job.state === 'paused' || job.state === 'blocked') {
    return (await raw(`/api/jobs/${id}/resume`, { method: 'POST', signal })).json();
  }
  return job;
}
