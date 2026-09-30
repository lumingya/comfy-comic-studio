import { copyText } from '../app/clipboard';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { useJobs } from '../api/jobs';
import { useEpisodes, useSeriesList } from '../api/series';
import { useSettings, useWorkflows } from '../api/system';
import { useWorkshop } from '../api/workshop';
import { useComfyHealth } from '../app/comfy';
import { Icon, type IconName } from '../app/icons';
import { useSetupChecks, useNewStory, type SetupCheck } from '../app/setup';
import { useUI } from '../app/ui-store';
import { toast, toastError } from './toast';
import { ownCancel } from './topLayer';

type Section = '' | 'checklist' | 'keys';

export const useHelp = create<{
  open: boolean;
  section: Section;
  set: (open: boolean, section?: Section) => void;
}>((set) => ({
  open: false,
  section: '',
  set: (open, section = '') => set({ open, section }),
}));

/** 快速开始 (legacy #guide-dialog). */
export const useQuickStart = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({
  open: false,
  set: (open) => set({ open }),
}));

/** The legacy pages of the help drawer; Studio pages fall back to their own help text. */
type LegacyPage =
  'home' | 'gallery' | 'stories' | 'presets' | 'production' | 'workflow' | 'settings' | 'jobs';
type StudioPage = 'script' | 'board' | 'canvas' | 'bible';
export type HelpPage = LegacyPage | StudioPage;

/** Which help page applies to a route. */
export function helpPageFor(pathname: string, studio = false): HelpPage {
  if (/^\/gallery\/[^/]+\/layout/.test(pathname)) return 'canvas';
  if (pathname.startsWith('/gallery') || pathname.startsWith('/series/'))
    return /\/bible/.test(pathname) ? 'bible' : 'gallery';
  if (/^\/workshop\/assembly\/[^/]+\/script/.test(pathname)) return 'script';
  if (/^\/workshop\/assembly\/[^/]+/.test(pathname)) return 'board';
  if (pathname.startsWith('/workshop/assembly')) return 'production';
  if (pathname.startsWith('/workshop/presets')) return 'presets';
  if (/^\/workshop\/story\/[^/]+/.test(pathname) && studio) return 'script';
  if (pathname.startsWith('/workshop')) return 'stories';
  if (pathname.startsWith('/engine')) return 'workflow';
  if (pathname.startsWith('/settings') || pathname.startsWith('/trash')) return 'settings';
  if (pathname.startsWith('/jobs')) return 'jobs';
  return 'home';
}

const STUDIO_ITEMS: Record<StudioPage, string[]> = {
  script: [
    'prompt',
    'description',
    'camera',
    'select',
    'menu',
    'batch',
    'io',
    'render',
    'history',
    'preview',
  ],
  board: ['render', 'adopt', 'candidates', 'edit', 'qa'],
  canvas: ['layout', 'lettering', 'export'],
  bible: ['characters', 'refs', 'variables', 'styles'],
};

type Doc =
  | 'quickstart'
  | 'services'
  | 'workflow'
  | 'variables'
  | 'tasks'
  | 'presentation'
  | 'sharing'
  | 'backup'
  | 'files'
  | 'mobile'
  | 'troubleshooting'
  | 'glossary';

/** [Chinese page under legacy/docs, English page when one exists] (legacy HELP_DOCS). */
const DOCS: Record<Doc, [string, string]> = {
  quickstart: ['guide/QUICKSTART.html', 'en/GUIDE.html#start'],
  services: ['guide/CHANNELS_AND_KEYS.html', 'en/GUIDE.html#connect-a-provider'],
  workflow: ['guide/WORKFLOW.html', ''],
  variables: ['guide/IMAGE_VARIABLES.html', ''],
  tasks: ['guide/FOUNDATION.html', 'en/FOUNDATION.html'],
  presentation: ['guide/PRESENTATION.html', 'en/GUIDE.html#read-and-share'],
  sharing: ['guide/CONTENT_AND_SHARING.html', 'en/CONTENT_AND_SHARING.html'],
  backup: ['guide/BACKUP.html', ''],
  files: ['guide/FILE_LIBRARY.html', 'en/FILE_LIBRARY.html'],
  mobile: ['guide/MOBILE.html', 'en/MOBILE.html'],
  troubleshooting: ['guide/TROUBLESHOOTING.html', ''],
  glossary: ['guide/GLOSSARY.html', ''],
};

/** The legacy handbook, served by the backend under /manual. */
export const manualHref = (page: string, en = false) =>
  `/manual/docs/${page || (en ? 'en/GUIDE.html' : 'index.html')}`;
const docHref = (doc: Doc, en: boolean) =>
  manualHref(en && DOCS[doc][1] ? DOCS[doc][1] : DOCS[doc][0]);

const PAGE: Record<
  HelpPage,
  {
    terms: string[];
    docs: Doc[];
    actions: ('newStory' | 'newTask' | 'assembleStory' | 'newPreset' | 'testComfy')[];
  }
> = {
  home: {
    terms: ['画册集', '图像服务', '生成任务'],
    docs: ['quickstart', 'services', 'troubleshooting'],
    actions: ['newStory', 'newTask'],
  },
  gallery: { terms: ['画册集', '画册'], docs: ['presentation', 'sharing', 'backup'], actions: [] },
  stories: {
    terms: ['分镜', '分幕', '变量'],
    docs: ['quickstart', 'variables'],
    actions: ['newStory', 'assembleStory'],
  },
  presets: { terms: ['预设', '变量'], docs: ['variables'], actions: ['newPreset'] },
  production: {
    terms: ['装配', '生成任务'],
    docs: ['tasks', 'troubleshooting'],
    actions: ['newTask'],
  },
  workflow: {
    terms: ['图像服务', '工作流', '参数映射'],
    docs: ['workflow', 'services'],
    actions: ['testComfy'],
  },
  settings: { terms: [], docs: ['files', 'backup', 'mobile'], actions: [] },
  jobs: { terms: [], docs: ['troubleshooting'], actions: [] },
  script: { terms: ['分幕', '变量'], docs: ['variables'], actions: [] },
  board: { terms: ['生成任务'], docs: ['tasks'], actions: [] },
  canvas: { terms: ['画册'], docs: ['presentation'], actions: [] },
  bible: { terms: ['预设', '变量'], docs: ['variables'], actions: [] },
};
const ACTION_ICONS = {
  newStory: 'plus',
  newTask: 'play',
  assembleStory: 'arrow',
  newPreset: 'plus',
  testComfy: 'refresh',
} as const satisfies Record<string, IconName>;

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable=true]');
const isMac = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

/** `?` anywhere (outside text fields) opens the help for the current page. */
export function useHelpShortcut() {
  const set = useHelp((s) => s.set);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !isEditable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        set(!useHelp.getState().open, 'keys');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [set]);
}

/** A native modal <dialog> that is mounted while open (the legacy dialogs). */
function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }, []);
  const props = {
    ref,
    onClose,
    onCancel: (e: React.SyntheticEvent) => {
      if (!ownCancel(e)) return;
      e.preventDefault();
      onClose();
    },
    // The backdrop closes it: it holds nothing to lose.
    onPointerDown: (e: React.PointerEvent<HTMLDialogElement>) => {
      if (e.target !== e.currentTarget) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        onClose();
    },
  };
  return props;
}

/** One 开箱检查 row (legacy setupCheckItemHTML). */
export function CheckItem({
  check,
  intro,
  primary,
  onAct,
}: {
  check: SetupCheck;
  intro?: string;
  primary?: boolean;
  onAct?: () => void;
}) {
  const { t } = useTranslation();
  const mark = { done: '✓', todo: '!', checking: '…' }[check.state];
  return (
    <li className={`help-check is-${check.state}`} data-check={check.id}>
      <span className="help-check-mark" aria-hidden>
        {mark}
      </span>
      <span className="help-check-body">
        <strong>
          {check.title}
          <span className="visually-hidden"> · {t(`guide.said.${check.state}`)}</span>
        </strong>
        {intro ? <span className="help-check-intro">{intro}</span> : null}
        <small>{check.detail}</small>
        {check.image ? (
          <img className="help-check-thumb" src={check.image} alt="" loading="lazy" />
        ) : null}
      </span>
      {check.fix && check.state !== 'done' ? (
        <button
          type="button"
          className={`btn small${primary ? ' primary' : ''}`}
          onClick={() => {
            onAct?.();
            check.fix!.run();
          }}
        >
          {check.fix.label}
        </button>
      ) : null}
    </li>
  );
}

/** 装配与队列: 「开箱检查还差 N 项」 next to the start buttons. */
export function SetupRemaining() {
  const { t } = useTranslation();
  const set = useHelp((s) => s.set);
  const left = useSetupChecks().filter((c) => c.state !== 'done').length;
  if (!left) return null;
  return (
    <button type="button" className="setup-remaining" onClick={() => set(true, 'checklist')}>
      <Icon name="help" />
      <span>{t('guide.remaining', { n: left })}</span>
    </button>
  );
}

function Keys() {
  const { t } = useTranslation();
  const mod = isMac() ? '⌘' : 'Ctrl';
  const k = (s: string) => t(`guide.keyNames.${s}`);
  const groups: [string, [string, string][]][] = [
    [
      'general',
      [
        [`${mod} K`, k('search')],
        ['Alt ,', k('settings')],
        ['?', k('help')],
        ['Esc', k('esc')],
        [`${mod} S`, k('save')],
      ],
    ],
    [
      'pages',
      [
        ['Alt 0', k('home')],
        ['Alt 1', k('gallery')],
        ['Alt 2', k('workshop')],
        ['Alt 3', k('engine')],
      ],
    ],
    [
      'select',
      [
        [`${mod} 点击`, k('toggle')],
        ['Shift 点击', k('range')],
        [`${mod} A`, k('all')],
        ['Delete', k('delete')],
        ['Shift F10', k('menu')],
      ],
    ],
    ['reading', [['← / →', k('turn')]]],
  ];
  const key = /^(?:Ctrl|Alt|Shift|Esc|Enter|Delete|F10|⌘|[A-Z0-9,?↑↓←→])$/;
  const kbd = (combo: string) =>
    combo
      .split(' ')
      .map((part, i) => (key.test(part) ? <kbd key={i}>{part}</kbd> : <span key={i}>{part}</span>));
  return (
    <section className="help-section help-keys" id="help-keys" aria-labelledby="help-keys-title">
      <header className="help-section-head">
        <h3 id="help-keys-title" tabIndex={-1}>
          {t('guide.keys')}
        </h3>
      </header>
      <p className="help-note">{t('guide.keysNote')}</p>
      {groups.map(([group, rows]) => (
        <Fragment key={group}>
          <h4>{t(`guide.keyGroups.${group}`)}</h4>
          <dl className="help-key-list">
            {rows.map(([combo, what]) => (
              <div key={combo}>
                <dt>{kbd(combo)}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </Fragment>
      ))}
    </section>
  );
}

function useDiagnostics(page: HelpPage, checks: SetupCheck[]) {
  const { t, i18n } = useTranslation();
  const comfy = useComfyHealth();
  const workflows = useWorkflows();
  const books = useSeriesList();
  const ws = useWorkshop();
  const boards = useEpisodes(ws.data?.id);
  const settings = useSettings();
  const jobs = useJobs(undefined, true);
  const studio = useUI((s) => s.studioMode);
  const d = (s: string) => t(`guide.diag.${s}`);
  const title = PAGE_TITLE(page, t);
  const open = checks.filter((c) => c.state !== 'done');
  const version = document.querySelector('.brand-sub span')?.textContent ?? '';
  return [
    `Mio ${version} · ${new Date().toISOString()}`,
    `${d('page')}：${title}`,
    `${d('ui')}：${[
      i18n.language,
      document.documentElement.dataset.theme || document.documentElement.dataset.mode || '—',
      `${innerWidth}×${innerHeight}`,
      matchMedia?.('(pointer:coarse)')?.matches ? d('touch') : d('mouse'),
    ].join(' · ')}`,
    `${d('studio')}：${studio ? d('on') : d('off')}`,
    `${d('browser')}：${navigator.userAgent}`,
    `${d('service')}：ComfyUI · ${comfy.url || '—'} · ${t(`classic.comfy.${comfy.state}`)}${
      comfy.state === 'offline' && comfy.detail !== comfy.url ? ` · ${comfy.detail}` : ''
    }`,
    `${d('workflows')}：${(workflows.data ?? []).map((w) => w.name).join('、') || '—'}`,
    `${d('shelf')}：${settings.data?.collection_title || '—'} · ${t('guide.diag.shelfValue', {
      books: books.data?.length ?? 0,
      stories: boards.data?.items.length ?? 0,
      presets: ws.data?.presets.length ?? 0,
    })}`,
    `${d('jobs')}：${jobs.data?.length ?? 0}`,
    `${d('checks')}：${checks.length - open.length} / ${checks.length}${
      open.length ? ` · ${d('open')}：${open.map((c) => c.title).join('、')}` : ''
    }`,
  ].join('\n');
}

const PAGE_TITLE = (page: HelpPage, t: (k: string) => string) =>
  page in STUDIO_ITEMS ? t(`help.pages.${page}.title`) : t(`guide.pages.${page}.title`);

/** The legacy help drawer: this page, 开箱检查, 教程, 快捷键 and 诊断信息. */
export function HelpDrawer() {
  const open = useHelp((s) => s.open);
  return open ? <HelpDrawerBody /> : null;
}

function HelpDrawerBody() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const studio = useUI((s) => s.studioMode);
  const section = useHelp((s) => s.section);
  const set = useHelp((s) => s.set);
  const openQuick = useQuickStart((s) => s.set);
  const checks = useSetupChecks();
  const newStory = useNewStory();
  const page = helpPageFor(pathname, studio);
  const spec = PAGE[page];
  const en = i18n.language === 'en';
  const diagnostics = useDiagnostics(page, checks);
  const close = () => set(false);
  const modal = useModal(close);
  const done = checks.filter((c) => c.state === 'done').length;
  const storyId = /^\/workshop\/story\/([^/]+)/.exec(pathname)?.[1];

  useEffect(() => {
    if (!section) return;
    const el = document.getElementById(`help-${section}`);
    el?.scrollIntoView?.({ block: 'start' });
    el?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  }, [section]);

  const run = (a: (typeof spec.actions)[number]) => {
    if (a === 'testComfy') {
      const service = checks.find((c) => c.id === 'service');
      service?.fix?.run();
      toast(service?.detail ?? '');
      return;
    }
    close();
    if (a === 'newStory') newStory();
    else if (a === 'newTask') navigate('/workshop/assembly?new=1');
    else if (a === 'assembleStory')
      navigate(storyId ? `/workshop/assembly?story=${storyId}` : '/workshop/assembly?new=1');
    else if (a === 'newPreset') navigate('/workshop/presets?new=1');
  };
  const actions = spec.actions.filter((a) => a !== 'assembleStory' || storyId);
  const docs = [...new Set<Doc>([...spec.docs, 'quickstart', 'troubleshooting', 'glossary'])];
  const studioPage = page in STUDIO_ITEMS ? (page as StudioPage) : null;

  let context: ReactNode;
  if (studioPage)
    context = (
      <>
        <p className="help-lead">{t(`help.pages.${studioPage}.intro`)}</p>
        <dl className="help-terms">
          {STUDIO_ITEMS[studioPage].map((key) => (
            <div key={key}>
              <dt>{t(`help.pages.${studioPage}.items.${key}.q`)}</dt>
              <dd>{t(`help.pages.${studioPage}.items.${key}.a`)}</dd>
            </div>
          ))}
        </dl>
      </>
    );
  else context = <p className="help-lead">{t(`guide.pages.${page}.text`)}</p>;

  return (
    <dialog id="help-drawer" className="help-drawer" aria-labelledby="help-drawer-title" {...modal}>
      <header className="help-drawer-head">
        <div className="grow">
          <p className="help-kicker">{t('guide.kicker')}</p>
          <h2 id="help-drawer-title" tabIndex={-1}>
            {PAGE_TITLE(page, t)}
          </h2>
        </div>
        <button
          type="button"
          className="ibtn"
          title={t('guide.close')}
          aria-label={t('guide.close')}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="help-drawer-body">
        <section
          className="help-section help-context"
          id="help-context"
          aria-label={t('guide.context')}
        >
          {context}
          {actions.length ? (
            <div className="help-actions">
              {actions.map((a) => (
                <button key={a} type="button" className="btn small" onClick={() => run(a)}>
                  <Icon name={ACTION_ICONS[a]} />
                  {t(`guide.act.${a}`)}
                </button>
              ))}
            </div>
          ) : null}
          {spec.terms.length ? (
            <dl className="help-terms">
              {spec.terms.map((term) => (
                <div key={term}>
                  <dt>{t(`guide.termNames.${term}`)}</dt>
                  <dd>{t(`guide.terms.${term}`)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
        <section
          className="help-section help-checklist"
          id="help-checklist"
          aria-labelledby="help-checklist-title"
        >
          <header className="help-section-head">
            <h3 id="help-checklist-title" tabIndex={-1}>
              {t('guide.checklist')}
            </h3>
            <span className={`help-progress ${done === checks.length ? 'is-done' : ''}`}>
              {t('guide.progress', { done, total: checks.length })}
            </span>
          </header>
          <ol className="help-checks">
            {checks.map((c) => (
              <CheckItem key={c.id} check={c} onAct={c.fix?.stay ? undefined : close} />
            ))}
          </ol>
        </section>
        <section
          className="help-section help-docs"
          id="help-docs"
          aria-labelledby="help-docs-title"
        >
          <header className="help-section-head">
            <h3 id="help-docs-title" tabIndex={-1}>
              {t('guide.docs')}
            </h3>
          </header>
          <ul className="help-doc-list">
            {docs.map((doc) => (
              <li key={doc}>
                <a href={docHref(doc, en)} target="_blank" rel="noopener">
                  {t(`guide.doc.${doc}`)}
                  <span aria-hidden>↗</span>
                </a>
              </li>
            ))}
            <li>
              <a href={manualHref('', en)} target="_blank" rel="noopener">
                {t('guide.centre')}
                <span aria-hidden>↗</span>
              </a>
            </li>
          </ul>
          <div className="help-actions">
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                close();
                openQuick(true);
              }}
            >
              <Icon name="help" />
              {t('guide.quickstart')}
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                close();
                navigate('/settings?tab=resources');
              }}
            >
              <Icon name="grid" />
              {t('guide.resources')}
            </button>
          </div>
        </section>
        <Keys />
        <section
          className="help-section help-diagnostics"
          id="help-diagnostics"
          aria-labelledby="help-diagnostics-title"
        >
          <header className="help-section-head">
            <h3 id="help-diagnostics-title" tabIndex={-1}>
              {t('guide.diagnostics')}
            </h3>
            <button
              type="button"
              className="btn small"
              onClick={() => copyText(diagnostics).then(() => toast(t('guide.copied')), toastError)}
            >
              <Icon name="copy" />
              {t('guide.copy')}
            </button>
          </header>
          <p className="help-note">{t('guide.diagNote')}</p>
          <details className="help-diagnostics-view">
            <summary>{t('guide.diagView')}</summary>
            <pre id="help-diagnostics-text">{diagnostics}</pre>
          </details>
        </section>
      </div>
    </dialog>
  );
}

/** 快速开始 · 从灵感到一本画册: the checklist with what each step is, then 进阶. */
export function QuickStart() {
  const open = useQuickStart((s) => s.open);
  return open ? <QuickStartBody /> : null;
}

function QuickStartBody() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const set = useQuickStart((s) => s.set);
  const checks = useSetupChecks();
  const books = useSeriesList();
  const close = () => set(false);
  const modal = useModal(close);
  const done = checks.filter((c) => c.state === 'done').length;
  const next = checks.find((c) => c.fix && c.state !== 'done');
  const book = (books.data ?? []).find((b) => (b.adopted_count ?? 0) > 0);
  const more: { id: 'reader' | 'export' | 'handbook'; icon: IconName; run: () => void }[] = [
    { id: 'reader', icon: 'book', run: () => navigate(book ? `/gallery/${book.id}` : '/gallery') },
    {
      id: 'export',
      icon: 'download',
      run: () => navigate(book ? `/gallery/${book.id}/export` : '/gallery'),
    },
    {
      id: 'handbook',
      icon: 'help',
      run: () => window.open(manualHref('', i18n.language === 'en'), '_blank', 'noopener'),
    },
  ];
  return (
    <dialog id="guide-dialog" className="guide-dialog" aria-labelledby="guide-title" {...modal}>
      <header className="modal-head">
        <Icon name="help" />
        <div className="grow">
          <h2 id="guide-title" tabIndex={-1}>
            {t('guide.quick.title')}
          </h2>
          <p>{t('guide.quick.sub')}</p>
        </div>
        <button
          type="button"
          className="ibtn"
          title={t('guide.quick.close')}
          aria-label={t('guide.quick.close')}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="guide-progress">
        <i style={{ width: `${checks.length ? (done / checks.length) * 100 : 0}%` }} />
      </div>
      <div className="quickstart-body">
        <ol className="help-checks quickstart-steps" aria-label={t('guide.quick.steps')}>
          {checks.map((c) => (
            <CheckItem
              key={c.id}
              check={c}
              intro={t(`guide.quick.intro.${c.id}`)}
              primary={c === next}
              onAct={c.fix?.stay ? undefined : close}
            />
          ))}
        </ol>
        <section className="quickstart-more" aria-labelledby="quickstart-more-title">
          <h3 id="quickstart-more-title">{t('guide.quick.more')}</h3>
          <div className="quickstart-more-list">
            {more.map((m) => (
              <button
                key={m.id}
                type="button"
                className="quickstart-more-item"
                onClick={() => {
                  if (m.id !== 'handbook') close();
                  m.run();
                }}
              >
                <Icon name={m.icon} />
                <span>
                  <strong>{t(`guide.quick.items.${m.id}.title`)}</strong>
                  <small>{t(`guide.quick.items.${m.id}.intro`)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <footer className="service-footer">
        <span className="grow service-status">
          {t('guide.progress', { done, total: checks.length })}
        </span>
        <button type="button" className="btn ghost" onClick={close}>
          {t('guide.quick.done')}
        </button>
      </footer>
    </dialog>
  );
}
