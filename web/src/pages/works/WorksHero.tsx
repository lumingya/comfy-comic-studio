import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Three floating book covers on a lit table — drawn with theme colours, no external assets. */
function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 320 240" aria-hidden>
      <defs>
        <linearGradient id="hero-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--paper)" />
          <stop offset="1" stopColor="var(--paper-shade)" />
        </linearGradient>
        <linearGradient id="hero-cover" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity=".9" />
          <stop offset="1" stopColor="var(--accent-2, var(--accent))" stopOpacity=".55" />
        </linearGradient>
        <radialGradient id="hero-glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="var(--accent)" stopOpacity=".28" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="206" rx="130" ry="18" fill="url(#hero-glow)" />
      <g className="hero-book b1" transform="rotate(-9 92 120)">
        <rect x="52" y="54" width="84" height="112" rx="5" fill="url(#hero-paper)" />
        <rect x="62" y="68" width="64" height="40" rx="2" className="hero-frame" />
        <rect x="62" y="114" width="30" height="36" rx="2" className="hero-frame" />
        <rect x="96" y="114" width="30" height="36" rx="2" className="hero-frame" />
      </g>
      <g className="hero-book b3" transform="rotate(8 232 124)">
        <rect x="188" y="60" width="84" height="112" rx="5" fill="url(#hero-paper)" />
        <rect x="198" y="74" width="64" height="26" rx="2" className="hero-frame" />
        <rect x="198" y="106" width="64" height="50" rx="2" className="hero-frame" />
      </g>
      <g className="hero-book b2">
        <rect x="112" y="30" width="96" height="128" rx="6" fill="url(#hero-cover)" />
        <rect x="112" y="30" width="9" height="128" rx="3" fill="#000" opacity=".18" />
        <rect x="132" y="52" width="58" height="3" rx="1.5" fill="var(--paper)" opacity=".85" />
        <rect x="132" y="61" width="36" height="2" rx="1" fill="var(--paper)" opacity=".55" />
        <circle cx="161" cy="112" r="17" fill="none" stroke="var(--paper)" strokeOpacity=".7" />
        <path
          d="M161 99 l3.4 9.6 10 .4 -7.9 6.2 2.8 9.8 -8.3 -5.7 -8.3 5.7 2.8 -9.8 -7.9 -6.2 10 -.4z"
          fill="var(--paper)"
          opacity=".85"
        />
      </g>
      <circle className="hero-spark s1" cx="236" cy="40" r="2.5" />
      <circle className="hero-spark s2" cx="70" cy="36" r="2" />
      <circle className="hero-spark s3" cx="280" cy="150" r="1.8" />
    </svg>
  );
}

/** First run: what this is, one big "start" button, and the three steps it takes. */
export function WorksHero(props: { onCreate: () => void; importAction?: ReactNode }) {
  const { t } = useTranslation();
  const steps = ['one', 'two', 'three'] as const;
  return (
    <section className="works-hero">
      <div className="works-hero-main">
        <div className="hero-copy">
          <div className="eyebrow">{t('classic.hero.eyebrow')}</div>
          <h2>{t('classic.hero.title')}</h2>
          <p>{t('classic.hero.body')}</p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn primary lg glow" onClick={props.onCreate}>
              <Sparkles size={16} /> {t('classic.hero.start')}
            </button>
            {props.importAction}
          </div>
        </div>
        <HeroArt />
      </div>
      <ol className="hero-steps">
        {steps.map((k, i) => (
          <li key={k} style={{ animationDelay: `${120 + i * 60}ms` }}>
            <span className="hero-step-no mono">{String(i + 1).padStart(2, '0')}</span>
            <span>
              <strong>{t(`classic.hero.steps.${k}.title`)}</strong>
              <small>{t(`classic.hero.steps.${k}.body`)}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
