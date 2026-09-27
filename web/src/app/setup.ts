import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { assetUrl } from '../api/client';
import { useCreateEpisode, useEpisodes, useSeriesList } from '../api/series';
import { useWorkflows } from '../api/system';
import { useBoardVariables, useWorkshop } from '../api/workshop';
import { toastError } from '../components/toast';
import { useComfyHealth } from './comfy';
import { useRecents } from './recents';

export type CheckState = 'done' | 'todo' | 'checking';

/** One 开箱检查 row (legacy setupChecklist): shared by Home, the help drawer and 快速开始. */
export interface SetupCheck {
  id: 'service' | 'workflow' | 'material' | 'trial';
  title: string;
  state: CheckState;
  detail: string;
  /** `stay`: acts in place (a connection test), so the drawer / quick start stays open. */
  fix?: { label: string; run: () => void; stay?: boolean };
  image?: string;
}

/** 新建分镜: a blank storyboard in 创作工坊, opened right away. */
export function useNewStory() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ws = useWorkshop();
  const create = useCreateEpisode(ws.data?.id ?? '');
  return () => {
    if (!ws.data) return navigate('/workshop/story');
    create.mutate(
      { title: t('ws.story.untitled') },
      { onSuccess: (e) => navigate(`/workshop/story/${e.id}`), onError: toastError },
    );
  };
}

/**
 * The legacy 开箱检查: image service, workflow, storyboards & presets, trial run. Rendering never
 * probes a service beyond the quiet health poll; only the buttons act.
 */
export function useSetupChecks(): SetupCheck[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const comfy = useComfyHealth();
  const workflows = useWorkflows();
  const ws = useWorkshop();
  const boards = useEpisodes(ws.data?.id);
  const books = useSeriesList();
  const recents = useRecents((s) => s.items);
  const newStory = useNewStory();
  const stories = boards.data?.items ?? [];
  const story = stories.find((b) => recents.some((r) => r.id === b.id)) ?? stories[0];
  const { vars } = useBoardVariables(story?.id);
  const presets = ws.data?.presets ?? [];
  const defined = new Set([
    ...Object.keys(ws.data?.variables ?? {}),
    ...presets.flatMap((p) => p.entries.map((e) => e.key)),
  ]);
  const missing = vars.filter((v) => !defined.has(v)).map((v) => `{${v}}`);
  const wf = workflows.data ?? [];
  const made = [...(books.data ?? [])]
    .filter((b) => (b.adopted_count ?? 0) > 0)
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];
  const c = 'guide.checks';

  const service: SetupCheck =
    comfy.state === 'online'
      ? {
          id: 'service',
          title: t(`${c}.service`),
          state: 'done',
          detail: t(`${c}.serviceOk`, { url: comfy.url }),
        }
      : comfy.state === 'unset'
        ? {
            id: 'service',
            title: t(`${c}.service`),
            state: 'todo',
            detail: t(`${c}.serviceUnset`),
            fix: {
              label: t(`${c}.serviceSettings`),
              run: () => navigate('/engine?tab=instances'),
            },
          }
        : {
            id: 'service',
            title: t(`${c}.service`),
            state: comfy.state === 'checking' ? 'checking' : 'todo',
            detail:
              comfy.state === 'checking'
                ? t(`${c}.serviceChecking`)
                : t(`${c}.serviceBad`, { url: comfy.url || 'http://127.0.0.1:8188' }),
            fix: {
              label: t(`${c}.test`),
              run: () => void qc.invalidateQueries({ queryKey: ['comfy-health'] }),
              stay: true,
            },
          };
  return [
    service,
    wf.length
      ? {
          id: 'workflow',
          title: t(`${c}.workflow`),
          state: 'done',
          detail: t(`${c}.workflowOk`, { title: wf[0].name, count: wf.length }),
        }
      : {
          id: 'workflow',
          title: t(`${c}.workflow`),
          state: workflows.isLoading ? 'checking' : 'todo',
          detail: t(`${c}.workflowNone`),
          fix: {
            label: t(`${c}.importWorkflow`),
            run: () => navigate('/engine?tab=workflows'),
          },
        },
    !story
      ? {
          id: 'material',
          title: t(`${c}.material`),
          state: ws.isLoading || boards.isLoading ? 'checking' : 'todo',
          detail: t(`${c}.materialNone`),
          fix: { label: t('guide.act.newStory'), run: newStory },
        }
      : missing.length
        ? {
            id: 'material',
            title: t(`${c}.material`),
            state: 'todo',
            detail: t(`${c}.materialMissing`, {
              story: story.title,
              names: missing.slice(0, 4).join(' ') + (missing.length > 4 ? ' …' : ''),
            }),
            fix: {
              label: t('guide.act.newPreset'),
              run: () => navigate('/workshop/presets?new=1'),
            },
          }
        : {
            id: 'material',
            title: t(`${c}.material`),
            state: 'done',
            detail: t(`${c}.materialOk`, { stories: stories.length, presets: presets.length }),
          },
    made
      ? {
          id: 'trial',
          title: t(`${c}.trial`),
          state: 'done',
          detail: t(`${c}.trialOk`, { title: made.title }),
          image: made.cover_asset_id ? assetUrl(made.cover_asset_id, 256) : undefined,
        }
      : {
          id: 'trial',
          title: t(`${c}.trial`),
          state: books.isLoading ? 'checking' : 'todo',
          detail: t(`${c}.trialNone`),
          fix: { label: t('guide.act.newTask'), run: () => navigate('/workshop/assembly?new=1') },
        },
  ];
}
