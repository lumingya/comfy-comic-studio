/** Storyboard-level actions shared by the 分镜工坊 head buttons and its context menu. */
import type { QueryClient } from '@tanstack/react-query';
import { api, data } from '../../api/client';
import { keys } from '../../api/keys';
import type { useCreateEpisode } from '../../api/series';
import type { Episode, EpisodeSummary } from '../../api/types';
import { flushEditors } from '../../app/useAutoDraft';
import { promptText } from '../../components/confirm';
import { downloadJson, pickJsonFiles, storyboardFromFile, storyboardToFile } from './files';

type T = (key: string, options?: Record<string, unknown>) => string;
type CreateEpisode = ReturnType<typeof useCreateEpisode>;

/** Legacy workshop-new: ask for the name, then start the storyboard with its first frame. */
export async function createStoryboard(create: CreateEpisode, t: T): Promise<Episode | null> {
  const title = await promptText({
    title: t('ws.story.new'),
    label: t('ws.assetName'),
    confirmLabel: t('common.create'),
    required: true,
  });
  if (title === null) return null;
  const e = await create.mutateAsync({ title });
  const first = await api.POST('/api/episodes/{episode_id}/panels', {
    params: { path: { episode_id: e.id! } },
    body: { panel: { description: t('ws.story.frameN', { n: 1 }) }, after: null },
  });
  return first.data ?? e;
}

/** Legacy workshop-rename (textModal): returns the new title, or null when unchanged / cancelled. */
export async function askAssetTitle(current: string, t: T): Promise<string | null> {
  const title = await promptText({
    title: t('ws.rename'),
    label: t('ws.assetName'),
    value: current,
    confirmLabel: t('common.confirm'),
    required: true,
  });
  if (title === null) return null;
  const next = title.trim();
  return next && next !== current ? next : null;
}

/** Legacy workshop-import: every picked file becomes a storyboard; resolves to the last id. */
export async function importStoryboards(
  create: CreateEpisode,
): Promise<{ last: string; count: number }> {
  const files = await pickJsonFiles();
  let last = '';
  for (const f of files) {
    const board = storyboardFromFile(f);
    const e = await create.mutateAsync({
      title: board.title,
      synopsis: board.synopsis,
      base_prompt: board.base_prompt,
    });
    if (board.panels.length)
      await api.POST('/api/episodes/{episode_id}/panels/import', {
        params: { path: { episode_id: e.id! } },
        body: { panels: board.panels, after: null },
      });
    last = e.id!;
  }
  return { last, count: files.length };
}

/** Legacy workshop-export: flush the open editors, then download the storyboard as JSON. */
export async function exportStoryboard(qc: QueryClient, ep: Episode) {
  await flushEditors();
  const current = qc.getQueryData<Episode>(keys.episode(ep.id!)) ?? ep;
  downloadJson(`${current.title}.json`, storyboardToFile(current));
}

/** Every storyboard of the workshop (the list is paged by 200). */
export async function listStoryboards(workshopId: string): Promise<EpisodeSummary[]> {
  const out: EpisodeSummary[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = data(
      await api.GET('/api/series/{series_id}/episodes', {
        params: { path: { series_id: workshopId }, query: { offset, limit: 200 } },
      }),
    ) as unknown as { items: EpisodeSummary[]; total: number };
    out.push(...page.items);
    if (!page.items.length || out.length >= page.total) return out;
  }
}

/** 导出…: one storyboard → its own file; several → one list file that 「导入」 reads back. */
export async function exportStoryboards(ids: string[], bundleName: string) {
  await flushEditors();
  const boards = [];
  for (const id of ids)
    boards.push(
      storyboardToFile(
        data(
          await api.GET('/api/episodes/{episode_id}', { params: { path: { episode_id: id } } }),
        ) as Episode,
      ),
    );
  if (boards.length === 1) downloadJson(`${boards[0].title}.json`, boards[0]);
  else downloadJson(`${bundleName}.json`, boards);
}
