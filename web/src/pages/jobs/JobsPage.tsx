import { Ban, ListTodo, Pause, Play, RotateCcw } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useJobControl, useJobs, useRetryJob, type JobControl } from '../../api/jobs';
import type { Job } from '../../api/types';
import { QueryError } from '../../app/errors';
import { shortDateTime } from '../../app/format';
import { useSelection } from '../../app/selection';
import { usePageTitle } from '../../app/title';
import { ContextMenu, useContextMenu, type ContextGroup } from '../../components/ContextMenu';
import { toast, toastError } from '../../components/toast';
import { Empty, Loading, Switch } from '../../components/ui';
import { JobDetail } from './JobDetail';

const ACTIVE = new Set(['queued', 'running', 'paused', 'blocked']);

export default function JobsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const activeOnly = params.get('active') === '1';
  const jobs = useJobs(undefined, activeOnly);
  const selected = params.get('job') ?? jobs.data?.[0]?.id ?? null;
  const ids = useMemo(() => (jobs.data ?? []).map((j) => j.id), [jobs.data]);
  const selection = useSelection(ids);
  const menu = useContextMenu<string[]>();
  const control = useJobControl();
  const retry = useRetryJob();
  const jobOf = (id: string) => jobs.data?.find((j) => j.id === id);

  // Batch controls run one by one; jobs that cannot take the action are skipped, not failed.
  const controlMany = async (list: string[], action: JobControl) => {
    const can = (j: Job) =>
      action === 'cancel'
        ? ACTIVE.has(j.state)
        : action === 'pause'
          ? j.state === 'running' || j.state === 'queued'
          : j.state === 'paused';
    const targets = list.map(jobOf).filter((j): j is Job => !!j && can(j));
    try {
      for (const j of targets) await control.mutateAsync({ id: j.id, action });
      toast(t(`jobs.batch.${action}`, { count: targets.length }));
    } catch (error) {
      toastError(error);
    }
  };
  const retryMany = async (list: string[]) => {
    const targets = list.map(jobOf).filter((j): j is Job => !!j && (j.failed ?? 0) > 0);
    try {
      for (const j of targets) await retry.mutateAsync({ id: j.id });
      toast(t('jobs.batch.retry', { count: targets.length }));
    } catch (error) {
      toastError(error);
    }
  };
  const menuGroups = (list: string[]): ContextGroup[] => [
    {
      heading: list.length > 1 ? t('jobs.batch.selected', { count: list.length }) : undefined,
      items: [
        {
          label: t('jobs.pause'),
          icon: <Pause size={14} />,
          onSelect: () => void controlMany(list, 'pause'),
        },
        {
          label: t('jobs.resume'),
          icon: <Play size={14} />,
          onSelect: () => void controlMany(list, 'resume'),
        },
        {
          label: t('jobs.retryFailed'),
          icon: <RotateCcw size={14} />,
          onSelect: () => void retryMany(list),
          disabled: !list.some((id) => (jobOf(id)?.failed ?? 0) > 0),
        },
      ],
    },
    {
      items: [
        {
          label: t('jobs.cancel'),
          icon: <Ban size={14} />,
          danger: true,
          onSelect: () => void controlMany(list, 'cancel'),
          disabled: !list.some((id) => ACTIVE.has(jobOf(id)?.state ?? '')),
        },
      ],
    },
  ];
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  usePageTitle(t('jobs.heading'));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('jobs.heading')}</h1>
          <p>{t('jobs.sub')}</p>
        </div>
        <Switch
          checked={activeOnly}
          onChange={(v) => set({ active: v ? '1' : null, job: null })}
          label={t('jobs.activeOnly')}
        />
      </header>
      {jobs.error ? <QueryError error={jobs.error} onRetry={jobs.refetch} /> : null}
      {jobs.isLoading ? <Loading /> : null}
      {jobs.data && !jobs.data.length ? (
        <Empty icon={<ListTodo size={24} />} title={t('jobs.none')} />
      ) : null}
      {jobs.data?.length ? (
        <div className="split">
          <nav
            className="split-rail"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                selection.all();
              } else if (e.key === 'Escape') selection.clear();
            }}
          >
            {selection.ids.length > 1 ? (
              <div className="selection-bar" role="status">
                <span className="count">
                  {t('jobs.batch.selected', { count: selection.ids.length })}
                </span>
                <span className="grow" />
                <button
                  className="btn ghost sm"
                  onClick={() => void controlMany(selection.ids, 'pause')}
                >
                  <Pause size={13} /> {t('jobs.pause')}
                </button>
                <button
                  className="btn ghost sm"
                  onClick={() => void controlMany(selection.ids, 'resume')}
                >
                  <Play size={13} /> {t('jobs.resume')}
                </button>
                <button className="btn ghost sm" onClick={() => void retryMany(selection.ids)}>
                  <RotateCcw size={13} /> {t('jobs.retryFailed')}
                </button>
                <button
                  className="btn ghost sm danger"
                  onClick={() => void controlMany(selection.ids, 'cancel')}
                >
                  <Ban size={13} /> {t('jobs.cancel')}
                </button>
                <button className="btn ghost sm" onClick={selection.clear} title="Esc">
                  {t('common.cancel')}
                </button>
              </div>
            ) : null}
            {jobs.data.map((j) => (
              <button
                key={j.id}
                className={`rail-item job-item ${j.id === selected ? 'active' : ''} ${selection.has(j.id) ? 'checked' : ''}`}
                aria-selected={selection.has(j.id) || undefined}
                onClick={(e) => {
                  selection.click(j.id, e);
                  if (!(e.ctrlKey || e.metaKey || e.shiftKey)) set({ job: j.id });
                }}
                onContextMenu={(e) => menu.open(e, selection.contextTarget(j.id))}
              >
                <span className={`dot state-${j.state}`} />
                <span className="grow ellipsis">
                  {j.title}
                  {j.total ? (
                    <span
                      className="job-progress"
                      style={
                        {
                          '--p': `${Math.round((100 * (j.done ?? 0)) / j.total)}%`,
                        } as CSSProperties
                      }
                    />
                  ) : null}
                </span>
                {j.total ? (
                  <span className={`small mono ${j.failed ? 'bad' : 'muted'}`}>
                    {j.done ?? 0}/{j.total}
                  </span>
                ) : null}
                <span className="small muted mono">{shortDateTime(j.updated, i18n.language)}</span>
              </button>
            ))}
          </nav>
          <section className="split-main">
            {selected ? <JobDetail key={selected} id={selected} /> : null}
          </section>
        </div>
      ) : null}
      {menu.state ? (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          groups={menuGroups(menu.state.payload)}
          onClose={menu.close}
        />
      ) : null}
    </div>
  );
}
