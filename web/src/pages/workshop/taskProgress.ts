import type { Episode, Job, JobItem } from '../../api/types';

/** Legacy productionStatus per scene, derived from the album's takes and its latest render jobs. */
export type PageState =
  'done' | 'running' | 'queued' | 'paused' | 'failed' | 'uncertain' | 'standby';

export interface PageProgress {
  state: PageState;
  /** The image in the album (the adopted take), when there is one. */
  asset?: string;
  /** The last attempt failed; for a `done` scene the original image was kept (legacy 原图已保留). */
  error?: { kind: string; message: string };
  /** The job item that owns the newest attempt, for retries and technical details. */
  jobId?: string;
  idx?: number;
}

export interface FailureSummary {
  count: number;
  kind: string;
  message: string;
  /** The job to retry / inspect: an active job paused after repeated failures, else the newest. */
  jobId: string;
  /** Items of `jobId` that failed and can be retried in place. */
  indexes: number[];
  /** The engine paused the job by itself (连续失败 N 项，已暂停). */
  held: boolean;
  note: string | null;
}

export const ACTIVE_JOB = ['queued', 'running', 'paused', 'blocked'];
const isPaused = (job: Job) => job.paused || job.state === 'paused';

function newestItem(jobs: Job[], panelId: string): { job: Job; item: JobItem } | null {
  for (const job of jobs) {
    let best: JobItem | null = null;
    for (const item of job.items ?? []) {
      const meta = item.input?.meta as {
        panel_id?: string;
        variant_id?: string | null;
        candidate?: number;
      };
      if (meta?.panel_id !== panelId || meta.variant_id) continue;
      // Several candidates of one scene: the least settled one tells the story.
      if (!best || rank(item.state) > rank(best.state)) best = item;
    }
    if (best) return { job, item: best };
  }
  return null;
}

const RANK: Record<string, number> = {
  running: 6,
  pending: 5,
  uncertain: 4,
  failed: 3,
  complete: 2,
  canceled: 1,
  skipped: 0,
};
const rank = (state: string) => RANK[state] ?? 0;

/**
 * One entry per panel. `jobs` are the album's render jobs **with items**, newest first; jobs whose
 * items were not loaded are ignored (their scenes fall back to the takes).
 */
export function pageProgress(episode: Episode | undefined, jobs: Job[]): Map<string, PageProgress> {
  const out = new Map<string, PageProgress>();
  if (!episode) return out;
  const adopted = new Map<string, string>();
  for (const take of episode.takes ?? [])
    if (take.status === 'adopted' && !take.variant_id) adopted.set(take.panel_id, take.asset_id);
  for (const panel of episode.panels) {
    const id = panel.id!;
    const asset = adopted.get(id);
    const hit = newestItem(jobs, id);
    const base: PageProgress = { state: asset ? 'done' : 'standby', asset };
    if (!hit) {
      out.set(id, base);
      continue;
    }
    const { job, item } = hit;
    const ref = { jobId: job.id, idx: item.idx };
    const active = ACTIVE_JOB.includes(job.state);
    if (item.state === 'running') out.set(id, { ...base, ...ref, state: 'running' });
    else if (item.state === 'pending' && active)
      out.set(id, { ...base, ...ref, state: isPaused(job) ? 'paused' : 'queued' });
    else if (item.state === 'failed' || item.state === 'uncertain') {
      const error = item.error ?? {
        kind: item.state,
        message: item.state === 'uncertain' ? '' : (job.error ?? ''),
      };
      out.set(id, { ...base, ...ref, error, state: asset ? 'done' : item.state });
    } else out.set(id, base);
  }
  return out;
}

/** The task-level failure panel (legacy productionErrorHTML), or null when nothing needs attention. */
export function failureSummary(
  pages: Map<string, PageProgress>,
  jobs: Job[],
): FailureSummary | null {
  const failed = [...pages.values()].filter((p) => p.state === 'failed' || p.state === 'uncertain');
  const held = jobs.find((j) => ACTIVE_JOB.includes(j.state) && isPaused(j) && j.error);
  if (!failed.length && !held) return null;
  const first = failed.find((p) => p.error?.message) ?? failed[0];
  const jobId = held?.id ?? first?.jobId ?? jobs[0]?.id ?? '';
  return {
    count: failed.length,
    kind: first?.error?.kind ?? 'other',
    message: first?.error?.message || held?.error || '',
    jobId,
    indexes: failed
      .filter((p) => p.jobId === jobId && p.state === 'failed' && p.idx !== undefined)
      .map((p) => p.idx!),
    held: !!held,
    note: held?.error && held.error !== first?.error?.message ? held.error : null,
  };
}

/** Legacy productionErrorKind: which settings fix this error. */
export function errorCategory(
  kind: string,
): 'connection' | 'workflow' | 'channel' | 'rate' | 'other' {
  if (['unreachable', 'no_instance', 'connection_lost', 'timeout'].includes(kind))
    return 'connection';
  if (['rejected', 'execution_error', 'no_image', 'bad_input', 'upload_failed'].includes(kind))
    return 'workflow';
  if (kind === 'cloud_error') return 'channel';
  // Legacy 服务限流: the channel said 429 on every attempt; it is not a broken setting.
  if (kind === 'rate_limited') return 'rate';
  return 'other';
}
