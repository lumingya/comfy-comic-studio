import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAllEpisodes, useSeriesList } from '../../api/series';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkflows } from '../../api/system';
import { useComfyHealth } from '../../app/comfy';
import { Icon, type IconName } from '../../app/icons';
import { usePageTitle } from '../../app/title';
import { useUI } from '../../app/ui-store';
import { useHelp } from '../../components/HelpDrawer';

/** The legacy hero illustration: a sage comic page over a tilted card. */
function HomeArt() {
  return (
    <div className="home-art" aria-hidden>
      <svg viewBox="0 0 420 320" fill="none">
        <defs>
          <linearGradient
            id="home-paper"
            x1="100"
            y1="20"
            x2="320"
            y2="300"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--home-paper)" />
            <stop offset="1" stopColor="var(--home-paper-shade)" />
          </linearGradient>
        </defs>
        <ellipse cx="220" cy="280" rx="150" ry="18" fill="currentColor" opacity=".07" />
        <path d="M39 243 348 69M63 57 375 254" stroke="currentColor" strokeOpacity=".14" />
        <rect
          x="105"
          y="35"
          width="224"
          height="242"
          rx="9"
          transform="rotate(10 105 35)"
          fill="var(--home-sage)"
          stroke="currentColor"
          strokeOpacity=".2"
        />
        <rect
          x="80"
          y="36"
          width="230"
          height="248"
          rx="9"
          transform="rotate(-7 80 36)"
          fill="url(#home-paper)"
          stroke="currentColor"
          strokeOpacity=".24"
        />
        <g transform="rotate(-7 80 36)">
          <path d="M101 59H289M101 262H289" stroke="#405642" strokeOpacity=".3" />
          <rect x="101" y="76" width="188" height="103" rx="4" fill="#4c6856" />
          <circle cx="247" cy="104" r="13" fill="#d0d6ad" />
          <path d="m101 153 49-43 52 45 37-24 50 36v12H101Z" fill="#84997a" />
          <path d="m101 167 50-22 44 25 51-25 43 17v17H101Z" fill="#304c40" />
          <rect x="101" y="190" width="88" height="55" rx="4" fill="#a7b697" />
          <circle cx="145" cy="209" r="9" fill="#40584a" />
          <path d="M123 245c2-13 10-19 22-19s20 6 22 19Z" fill="#40584a" />
          <rect x="201" y="190" width="88" height="55" rx="4" fill="#c3b993" />
          <path
            d="M215 197h60a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6h-41l-12 9v-9h-7a6 6 0 0 1-6-6v-20a6 6 0 0 1 6-6Z"
            fill="#f4f2e1"
            stroke="#776f50"
            strokeOpacity=".55"
          />
          <path
            d="M220 209h48m-48 9h32"
            stroke="#776f50"
            strokeOpacity=".7"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </g>
        <path d="m353 38 5 13 13 5-13 5-5 13-5-13-13-5 13-5Z" fill="var(--home-sage)" />
        <circle cx="47" cy="203" r="7" stroke="var(--home-sage)" strokeWidth="3" />
        <circle cx="365" cy="224" r="3" fill="currentColor" opacity=".45" />
      </svg>
      <span>STORY → FRAMES → ALBUM</span>
    </div>
  );
}

interface Check {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action?: { label: string; run: () => void };
}

/** 开箱检查: service, workflow, storyboard, first render. */
function useChecks(): Check[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const comfy = useComfyHealth();
  const workflows = useWorkflows();
  const series = useSeriesList();
  const qc = useQueryClient();
  const books = series.data ?? [];
  const panels = books.reduce((n, s) => n + (s.panel_count ?? 0), 0);
  const adopted = books.reduce((n, s) => n + (s.adopted_count ?? 0), 0);
  const wf = workflows.data?.length ?? 0;
  return [
    {
      id: 'service',
      title: t('legacy.home.checks.service'),
      done: comfy.state === 'online',
      detail:
        comfy.state === 'online'
          ? t('legacy.home.checks.serviceOk', { name: comfy.name })
          : comfy.state === 'unset'
            ? t('legacy.home.checks.serviceUnset')
            : t('legacy.home.checks.serviceBad', { url: comfy.detail || 'http://127.0.0.1:8188' }),
      action:
        comfy.state === 'unset'
          ? { label: t('legacy.nav.engine'), run: () => navigate('/engine?tab=instances') }
          : {
              label: t('legacy.home.checks.test'),
              run: () => void qc.invalidateQueries({ queryKey: ['comfy-health'] }),
            },
    },
    {
      id: 'workflow',
      title: t('legacy.home.checks.workflow'),
      done: wf > 0,
      detail: wf
        ? t('legacy.home.checks.workflowOk', { count: wf })
        : t('legacy.home.checks.workflowNone'),
      action: wf
        ? undefined
        : {
            label: t('legacy.home.checks.importWorkflow'),
            run: () => navigate('/engine?tab=workflows'),
          },
    },
    {
      id: 'material',
      title: t('legacy.home.checks.material'),
      done: panels > 0,
      detail: panels
        ? t('legacy.home.checks.materialOk', { stories: books.length, panels })
        : t('legacy.home.checks.materialNone'),
      action: panels
        ? undefined
        : { label: t('legacy.home.checks.write'), run: () => navigate('/workshop') },
    },
    {
      id: 'trial',
      title: t('legacy.home.checks.trial'),
      done: adopted > 0,
      detail: adopted
        ? t('legacy.home.checks.trialOk', { count: adopted })
        : t('legacy.home.checks.trialNone'),
      action: adopted
        ? undefined
        : { label: t('legacy.home.checks.run'), run: () => navigate('/workshop?tab=board') },
    },
  ];
}

const PATHS: { id: 'comfy' | 'novelai' | 'openai'; icon: IconName; to: string }[] = [
  { id: 'comfy', icon: 'nodes', to: '/engine?tab=instances' },
  { id: 'novelai', icon: 'image', to: '/engine?tab=channels' },
  { id: 'openai', icon: 'link', to: '/engine?tab=channels' },
];

function FirstRun() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const checks = useChecks();
  const hidden = useUI((s) => s.homeGuideHidden);
  const setHidden = useUI((s) => s.setHomeGuideHidden);
  const done = checks.filter((c) => c.done).length;
  if (hidden)
    return (
      <button type="button" className="btn ghost small" onClick={() => setHidden(false)}>
        <Icon name="down" />
        {t('legacy.home.show')}
      </button>
    );
  return (
    <section className="first-run" aria-labelledby="first-run-title">
      <header>
        <div>
          <h2 id="first-run-title">{t('legacy.home.firstTitle')}</h2>
          <p>{t('legacy.home.firstBody')}</p>
        </div>
        <button type="button" className="btn ghost small" onClick={() => setHidden(true)}>
          <Icon name="close" />
          {t('legacy.home.hide')}
        </button>
      </header>
      <div className="first-run-paths">
        {PATHS.map((p) => (
          <button key={p.id} className="first-run-path" onClick={() => navigate(p.to)}>
            <Icon name={p.icon} />
            <span>
              <strong>{t(`legacy.home.paths.${p.id}`)}</strong>
              <small>{t(`legacy.home.paths.${p.id}d`)}</small>
            </span>
            <span aria-hidden>↗</span>
          </button>
        ))}
      </div>
      <section
        className="home-checklist"
        id="home-checklist"
        aria-labelledby="home-checklist-title"
      >
        <header className="help-section-head">
          <h3 id="home-checklist-title" tabIndex={-1}>
            {t('legacy.home.checklist')}
          </h3>
          <span className="checklist-progress">
            {t('legacy.home.progress', { done, total: checks.length })}
          </span>
        </header>
        <ol className="help-checks">
          {checks.map((c) => (
            <li
              key={c.id}
              className={`help-check ${c.done ? 'is-done' : 'is-todo'}`}
              data-check={c.id}
            >
              <span className="help-check-mark" aria-hidden>
                {c.done ? '✓' : '!'}
              </span>
              <span className="help-check-body">
                <strong>
                  {c.title}
                  <span className="visually-hidden">
                    {' · '}
                    {c.done ? t('legacy.home.done') : t('legacy.home.todo')}
                  </span>
                </strong>
                <small>{c.detail}</small>
              </span>
              {!c.done && c.action ? (
                <button type="button" className="btn small" onClick={c.action.run}>
                  {c.action.label}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

/** 首页 — the legacy landing: hero, three steps, GET STARTED, footer. */
export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openHelp = useHelp((s) => s.set);
  const { groups } = useAllEpisodes();
  usePageTitle(t('legacy.nav.home'));
  const first = groups.find((g) => g.episodes.length);
  const sample =
    groups
      .find((g) => g.episodes.some((e) => e.adopted_count > 0))
      ?.episodes.find((e) => e.adopted_count > 0) ?? first?.episodes[0];

  return (
    <section id="mio-home" aria-labelledby="home-title">
      <header className="home-hero">
        <div className="home-intro">
          <div className="home-eyebrow">
            <span />
            {t('legacy.home.eyebrow')}
          </div>
          <h1 id="home-title">
            <span>{t('legacy.home.title1')}</span>
            <span className="home-title-accent">{t('legacy.home.title2')}</span>
          </h1>
          <p className="home-lead">{t('legacy.home.lead')}</p>
          <div className="home-hero-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => navigate(first ? '/workshop' : '/gallery?new=1')}
            >
              <Icon name="plus" />
              {t('legacy.home.start')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!sample}
              onClick={() => sample && navigate(`/workshop/${sample.id}/read`)}
            >
              <Icon name="play" />
              {t('legacy.home.sample')}
            </button>
            <button type="button" className="btn ghost" onClick={() => navigate('/gallery')}>
              <Icon name="arrow" />
              {t('legacy.home.browse')}
            </button>
          </div>
          <p className="home-reassurance">{t('legacy.home.reassurance')}</p>
        </div>
        <HomeArt />
      </header>
      <ol className="home-steps" aria-label={t('legacy.home.flow')}>
        {(['s1', 's2', 's3'] as const).map((s, i) => (
          <li key={s}>
            <b>0{i + 1}</b>
            <span>
              <strong>{t(`legacy.home.steps.${s}`)}</strong>
              <small>{t(`legacy.home.steps.${s}d`)}</small>
            </span>
          </li>
        ))}
      </ol>
      <section className="home-section home-get-started" aria-label={t('legacy.home.guide')}>
        <div className="home-kicker">{t('legacy.home.kicker')}</div>
        <FirstRun />
        <a
          className="home-learning"
          href="#help"
          onClick={(e) => {
            e.preventDefault();
            openHelp(true);
          }}
        >
          <Icon name="book" />
          <span>
            <strong>{t('legacy.home.learnTitle')}</strong>
            <small>{t('legacy.home.learnBody')}</small>
          </span>
          <b>{t('legacy.home.learnOpen')}</b>
        </a>
      </section>
      <footer className="home-footer">
        <span>{t('legacy.home.footerKicker')}</span>
        <p>{t('legacy.home.footer')}</p>
      </footer>
    </section>
  );
}
