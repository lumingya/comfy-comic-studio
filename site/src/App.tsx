import { useEffect, useState } from 'react';
import type { Locale } from './shared/types';
import { HeroTheater } from './sections/hero/HeroTheater';
import { LiveSandbox } from './sections/sandbox/LiveSandbox';
import { WorkflowShowcase } from './sections/workflow/WorkflowShowcase';
import { EcosystemBento } from './sections/ecosystem/EcosystemBento';
import { QuickStartFooter } from './sections/quickstart/QuickStartFooter';
import './styles/shell.css';

const LANGUAGE_KEY = 'mio-site-locale';
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'en' || saved === 'zh-CN') return saved;
  } catch {
    // The playground also works when browser storage is disabled.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const en = locale === 'en';
  useEffect(() => {
    document.documentElement.lang = locale;
    const title = en ? 'Mio — Your story. Your pages.' : 'Mio · 绘页 — 从一个故事，到一部作品';
    const description = en
      ? 'A local-first comic studio. Move from storyboard to images, selections, layout, and sharing. Try the browser playground with no installation.'
      : 'Mio · 绘页，一间本地优先的漫画工作室。从分镜、出图、挑图，到留白排版与分享。免安装体验示例画册、预设与工作流。';
    document.title = title;
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
      document.querySelector(selector)?.setAttribute('content', title);
    }
    for (const selector of [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]) {
      document.querySelector(selector)?.setAttribute('content', description);
    }
    try {
      localStorage.setItem(LANGUAGE_KEY, locale);
    } catch {
      /* Private browsing may deny persistence. */
    }
  }, [en, locale]);
  return (
    <>
      <a className="skip-link" href="#main-content">
        {en ? 'Skip to content' : '跳到正文'}
      </a>
      <header className="site-header" id="top">
        <div className="site-header__inner section-shell">
          <a className="site-wordmark" href="#" aria-label={en ? 'Mio home' : 'Mio 绘页首页'}>
            mio<span className="site-wordmark__dot">.</span>
            <span className="site-wordmark__caption">{en ? 'COMIC STUDIO' : '绘 页'}</span>
          </a>
          <nav className="site-nav" aria-label={en ? 'Main navigation' : '主导航'}>
            <a href="#playground">{en ? 'Playground' : '在线试玩'}</a>
            <a href="#workflow">{en ? 'Workflow' : '创作方式'}</a>
            <a href="#ecosystem">{en ? 'Ecosystem' : '按需生长'}</a>
          </nav>
          <div className="site-header__actions">
            <button
              className="site-language"
              type="button"
              onClick={() => setLocale(en ? 'zh-CN' : 'en')}
              aria-label={en ? '切换为中文' : 'Switch to English'}
            >
              <span aria-hidden="true">◎</span> {en ? '中文' : 'EN'}
            </button>
            <a className="site-get" href="#start">
              {en ? 'Get Mio' : '开始创作'} <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </header>
      <main id="main-content">
        <HeroTheater locale={locale} />
        <LiveSandbox locale={locale} />
        <WorkflowShowcase locale={locale} />
        <EcosystemBento locale={locale} />
        <QuickStartFooter locale={locale} />
      </main>
    </>
  );
}
