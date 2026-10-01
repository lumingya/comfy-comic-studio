import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useJobs } from '../../api/jobs';
import { useRenderEpisode } from '../../api/production';
import { episodePageQuery, episodeQuery } from '../../api/series';
import type { SeriesCard } from '../../api/types';
import type { ShelfSort } from '../../app/ui-store';
import { ACTIVE_JOB } from '../workshop/taskProgress';

export { SHELF_SORTS, type ShelfSort } from '../../app/ui-store';

/** Legacy 画册状态 filter (ui-gallery renderResponsiveCollection). */
export const SHELF_FILTERS = ['all', 'complete', 'generating', 'failed', 'starred'] as const;
export type ShelfFilter = (typeof SHELF_FILTERS)[number];

/** Legacy shelfStatus: 生成中, 待补齐 (scenes without an album image) or 已完成. */
export type ShelfState = 'generating' | 'failed' | 'complete' | 'blank';

export const missingOf = (s: SeriesCard) =>
  Math.max(0, (s.panel_count ?? 0) - (s.adopted_count ?? 0));

export function shelfState(s: SeriesCard, generating: boolean): ShelfState {
  if (generating) return 'generating';
  if (!(s.panel_count ?? 0)) return 'blank';
  return missingOf(s) ? 'failed' : 'complete';
}

export interface ShelfQuery {
  q: string;
  filter: ShelfFilter;
  sort: ShelfSort;
}

export interface ShelfFacts {
  starred: readonly string[];
  generating: ReadonlySet<string>;
  /** 手动排序: album ids in the dragged order (albums not in it follow, newest first). */
  order: readonly string[];
}

const newestFirst = (a: SeriesCard, b: SeriesCard) =>
  (b.created_at ?? '').localeCompare(a.created_at ?? '');

/** Every album id in 手动排序 order (legacy manualBookIds). */
export function manualIds(items: SeriesCard[], order: readonly string[]): string[] {
  const live = new Set(items.map((s) => s.id!));
  const rest = [...items].sort(newestFirst).map((s) => s.id!);
  return [...new Set([...order.filter((id) => live.has(id)), ...rest])];
}

/** Legacy moveOrderedId: `source` lands before (or after) `target`. */
export function moveId(order: readonly string[], source: string, target: string, after = false) {
  const out = order.filter((id) => id !== source);
  const i = out.indexOf(target);
  if (i < 0) return [...order];
  out.splice(after ? i + 1 : i, 0, source);
  return out;
}

/**
 * Drop `source` before or after `target` (legacy reorderCollectionBook).  Outside 手动排序 the
 * shelf as displayed becomes the new manual order first, so the drop lands where it was seen;
 * albums hidden by the filter keep their slots.
 */
export function reorderShelf(
  items: SeriesCard[],
  displayed: readonly string[],
  order: readonly string[],
  sort: ShelfSort,
  source: string,
  target: string,
  after = false,
): string[] {
  let next = manualIds(items, order);
  if (sort !== 'manual') {
    const shown = new Set(displayed);
    let i = 0;
    next = next.map((id) => (shown.has(id) ? displayed[i++] : id));
  }
  return moveId(next, source, target, after);
}

/** Search (title / subtitle / 简介 / cast), the legacy status filter and sort; exported for tests. */
export function filterShelf(
  items: SeriesCard[],
  f: ShelfQuery,
  facts: ShelfFacts,
  locale: string,
): SeriesCard[] {
  const q = f.q.trim().toLocaleLowerCase(locale);
  const out = items.filter((s) => {
    const id = s.id!;
    if (f.filter === 'starred' && !facts.starred.includes(id)) return false;
    if (f.filter === 'generating' && !facts.generating.has(id)) return false;
    // Legacy 待补齐 lists every album with scenes still missing, generating or not.
    if (f.filter === 'failed' && !missingOf(s)) return false;
    if (f.filter === 'complete' && shelfState(s, facts.generating.has(id)) !== 'complete')
      return false;
    if (!q) return true;
    const cast = (s.bible?.characters ?? []).map((c) => c.name);
    return [s.title, s.subtitle ?? '', s.synopsis ?? '', ...cast]
      .join('\n')
      .toLocaleLowerCase(locale)
      .includes(q);
  });
  if (f.sort === 'manual') {
    const rank = new Map(manualIds(items, facts.order).map((id, i) => [id, i]));
    return out.sort((a, b) => (rank.get(a.id!) ?? 0) - (rank.get(b.id!) ?? 0));
  }
  return out.sort((a, b) => {
    if (f.sort === 'totalSteps')
      return (b.panel_count ?? 0) - (a.panel_count ?? 0) || newestFirst(a, b);
    if (f.sort === 'updatedAt') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
    return newestFirst(a, b);
  });
}

/** Legacy dateFmt: the local month and day, "09.13". */
export function shelfDay(iso: string | undefined, language: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date
    .toLocaleDateString(language.startsWith('en') ? 'en-US' : 'zh-CN', {
      month: '2-digit',
      day: '2-digit',
    })
    .replace('/', '.');
}

/** Albums with a render job queued or running (legacy book.inProgress). */
export function useGeneratingSeries(items: SeriesCard[]): Set<string> {
  const jobs = useJobs(undefined, true);
  const owners = useMemo(
    () =>
      new Set(
        (jobs.data ?? [])
          .filter((j) => ACTIVE_JOB.includes(j.state) && j.owner)
          .map((j) => j.owner!),
      ),
    [jobs.data],
  );
  // Job owners are episodes; their series are only looked up while something is running.
  const pages = useQueries({
    queries: items.map((s) => ({ ...episodePageQuery(s.id!), enabled: owners.size > 0 })),
  });
  const out = new Set<string>();
  if (!owners.size) return out;
  items.forEach((s, i) => {
    if ((pages[i]?.data?.items ?? []).some((e) => owners.has(e.id!))) out.add(s.id!);
  });
  return out;
}

/**
 * 补齐缺失分幕: render only the scenes without an album image, one candidate each, adopted as they
 * finish (the 装配队列 「开始生成」 flow). Resolves to the number of scenes queued.
 */
export function useResumeSeries() {
  const qc = useQueryClient();
  const render = useRenderEpisode();
  return async (series: SeriesCard): Promise<number> => {
    const page = await qc.fetchQuery(episodePageQuery(series.id!));
    let queued = 0;
    for (const summary of page.items) {
      const ep = await qc.fetchQuery(episodeQuery(summary.id!));
      const adopted = new Set(
        (ep.takes ?? [])
          .filter((t) => t.status === 'adopted' && !t.variant_id)
          .map((t) => t.panel_id),
      );
      const missing = (ep.panels ?? []).filter((p) => !adopted.has(p.id!)).map((p) => p.id!);
      if (!missing.length) continue;
      await render.mutateAsync({
        episodeId: ep.id!,
        panel_ids: missing,
        candidates: 1,
        adopt_first: true,
      });
      queued += missing.length;
    }
    return queued;
  };
}
