import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { assetUrl } from '../api/client';
import { useCreateEpisode, useEpisodes, useSeriesList } from '../api/series';
import { useWorkflows } from '../api/system';
import { useBoardVariables, useWorkshop } from '../api/workshop';
import { toastError } from '../components/toast';
import { useRenderRoute } from './renderRoute';
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
 * The legacy 开箱检查: image service, workflow, storyboards & presets, trial run.
 * Read a connection snapshot here; submitting work always requires a user action.
 */
export function useSetupChecks(): SetupCheck[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workflows = useWorkflows();
  const ws = useWorkshop();
  const route = useRenderRoute(undefined, ws.data?.default_profile_id, ws.isPending);
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
  const stages =
    (route.kind === 'hybrid'
      ? route.profile?.final.length
        ? route.profile.final
        : route.profile?.draft.slice(1)
      : route.profile?.draft
    )?.filter((stage) => stage.enabled) ?? [];
  const validWorkflows =
    stages.length > 0 &&
    stages.every((stage) => workflows.data?.some((workflow) => workflow.id === stage.workflow_id));
  const made = [...(books.data ?? [])]
    .filter((b) => (b.adopted_count ?? 0) > 0)
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];
  const c = 'guide.checks';

  const serviceDone = route.state === 'online' || route.state === 'configured';
  const service: SetupCheck = {
    id: 'service',
    title: t(`${c}.service`),
    state: serviceDone ? 'done' : route.state === 'checking' ? 'checking' : 'todo',
    detail: `${route.summary} · ${route.detail}`,
    fix: serviceDone
      ? undefined
      : {
          label: t('route.configure'),
          run: () => navigate(route.to),
        },
  };
  const workflow: SetupCheck = {
    id: 'workflow',
    title: t('route.workflowTitle'),
    state: !route.profile
      ? route.state === 'checking'
        ? 'checking'
        : 'todo'
      : route.kind === 'cloud'
        ? 'done'
        : workflows.isPending
          ? 'checking'
          : validWorkflows
            ? 'done'
            : 'todo',
    detail: !route.profile
      ? route.detail
      : route.kind === 'cloud'
        ? t('route.cloudWorkflow')
        : workflows.isPending
          ? t('route.workflowChecking')
          : t(validWorkflows ? 'route.workflowReady' : 'route.workflowMissing', {
              name: route.profile.name,
            }),
    fix:
      route.profile && (route.kind === 'cloud' || validWorkflows)
        ? undefined
        : {
            label: t('route.configure'),
            run: () => navigate('/engine?tab=profiles'),
          },
  };
  return [
    service,
    workflow,
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
