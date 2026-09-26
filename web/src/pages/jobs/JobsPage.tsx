import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useJobs } from '../../api/jobs';
import { QueryError } from '../../app/errors';
import { Empty, Loading, Switch } from '../../components/ui';
import { JobDetail } from './JobDetail';

function when(seconds: number) {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function JobsPage() {
  const { t } = useTranslation();
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

  return (
    <div className="page wide">
      <header className="page-head">
        <div>
          <div className="overline">{t('nav.jobs')}</div>
          <h1>{t('jobs.heading')}</h1>
          <p className="muted">{t('jobs.sub')}</p>
        </div>
        <Switch
          checked={activeOnly}
          onChange={(v) => set({ active: v ? '1' : null, job: null })}
          label={t('jobs.activeOnly')}
        />
      </header>
      {jobs.error ? <QueryError error={jobs.error} /> : null}
      {jobs.isLoading ? <Loading /> : null}
      {jobs.data && !jobs.data.length ? <Empty>{t('jobs.none')}</Empty> : null}
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
                <span className="grow ellipsis">{j.title}</span>
                <span className="small muted mono">{when(j.updated)}</span>
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
