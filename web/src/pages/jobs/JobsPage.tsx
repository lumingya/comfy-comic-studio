import type { CSSProperties } from 'react';
import { ListTodo } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useJobs } from '../../api/jobs';
import { QueryError } from '../../app/errors';
import { shortDateTime } from '../../app/format';
import { usePageTitle } from '../../app/title';
import { Empty, Loading, Switch } from '../../components/ui';
import { JobDetail } from './JobDetail';

export default function JobsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const activeOnly = params.get('active') === '1';
  const jobs = useJobs(undefined, activeOnly);
  const selected = params.get('job') ?? jobs.data?.[0]?.id ?? null;
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
          <nav className="split-rail">
            {jobs.data.map((j) => (
              <button
                key={j.id}
                className={`rail-item job-item ${j.id === selected ? 'active' : ''}`}
                onClick={() => set({ job: j.id })}
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
    </div>
  );
}
