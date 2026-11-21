import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { asset } from '../../shared/artwork';
import type { SectionProps } from '../../shared/types';
import './hero.css';

const RELEASES = 'https://github.com/lumingya/comfy-comic-studio/releases';

const copy = {
  'zh-CN': {
    kicker: 'MIO · 绘页 / 一间本地优先的漫画工作室',
    title: ['让故事', '跃然纸上。'],
    subtitle: '从第一幕，到一本自己的作品。',
    intro: '写下分镜，挑选心动的画面，留出恰好的空白。把脑海里的故事，一页页做成可以珍藏的作品。',
    try: '立即在线试玩',
    download: '下载到自己的电脑',
    tags: ['本地创作', '开放源代码', '不必先懂节点'],
    coverTitle: ['雨停以后，', '信会抵达。'],
    coverNote: '一段故事，几张画，和你。',
    coverLabel: '示例插画 / AFTER THE RAIN',
    scroll: '往下，看看故事如何成形',
    edition: '为灵感，留一页。',
    theaterKicker: '01 / 从一个念头开始',
    theaterTitle: ['故事会', '慢慢成形。'],
    theaterIntro: '不必一开始就知道答案。先写一幕，再让每一步，向心里的样子靠近。',
    stageNav: '查看创作步骤',
    specimen: '流程示意',
    specimenNote: '使用预置插画演示，不会调用生图服务。',
    generationNote: '实际出图需连接可用的 ComfyUI 或云端服务；每次生成与采用，都由你决定。',
    storyFile: '创作手记',
    sceneLabel: '第一幕 / 初到小镇',
    storyLine: '雨后的街道慢慢苏醒。初到小镇的女邮差，正要开始今天的行程。',
    storyNote: '先记下画面，故事就有了起点。',
    routeLabel: '让熟悉的工具，各就各位',
    routeItems: ['分镜与变量', '角色 · 画风预设', 'ComfyUI / 云端'],
    routeFoot: '看过设置，再明确开始。',
    compareLabel: '把选择留给创作者',
    candidateA: '候选 A',
    candidateB: '候选 B',
    adopted: '已采用',
    compareFoot: '重画保留旧图，采用之后才进入作品。',
    exportLabel: '一本可以带走的作品',
    exportTitle: '雨停以后，信会抵达。',
    exportCaption: '写给每一个，愿意等待的人。',
    exportFoot: '离线画册、PDF、长图，还有可编辑的源文件。',
    stages: [
      {
        title: '灵感分镜',
        headline: '从一句话，写到第一幕。',
        description:
          '把故事拆成一幕一幕，写下场景、动作与对白。用变量留出角色和画风的位置，让好分镜可以反复开篇。',
        detail: '分镜模板 / 角色预设 / 逐幕编辑',
      },
      {
        title: '工作流装配',
        headline: '你的创作方式，由你挑选。',
        description:
          '选择预设，检查展开后的提示词，再连接本机 ComfyUI 或云端图像渠道。熟悉节点的人可以深入，初次创作的人也有清晰的下一步。',
        detail: '本机 ComfyUI / 云端渠道 / 显式开始',
      },
      {
        title: '候选挑选',
        headline: '好画面，值得慢慢选。',
        description:
          '留住每次尝试，比较新的候选，选中真正贴近故事的那一张。重画不会悄悄换掉已经采用的画面。',
        detail: '保留候选 / 比较画面 / 明确采用',
      },
      {
        title: '排版导出',
        headline: '让留白，也成为叙事。',
        description:
          '调整画面、文字和呼吸的间距。试读，再导出成独立打开的离线画册，把作品送给读者，也留给未来的自己。',
        detail: '留白排版 / 全屏试阅 / 多种格式',
      },
    ],
    alts: [
      '水彩示例分镜：女邮差初到雨后的小镇街道',
      '水彩示例分镜：女邮差在长椅上拾起一封信',
      '水彩示例分镜：女邮差把信递给年长的花店主人',
      '水彩示例分镜：女邮差走向小镇远方，踏上归途',
    ],
  },
  en: {
    kicker: 'MIO / A LOCAL-FIRST COMIC STUDIO',
    title: ['Your story.', 'Your pages.'],
    subtitle: 'From the first scene to a work of your own.',
    intro:
      'Write a scene. Find the image that feels right. Give it room to breathe. Make the story in your head into something worth keeping.',
    try: 'Try the online playground',
    download: 'Download for your computer',
    tags: ['Create locally', 'Open source', 'No node expertise needed'],
    coverTitle: ['After the rain,', 'a letter arrives.'],
    coverNote: 'A story, a few pictures, and you.',
    coverLabel: 'SAMPLE ART / AFTER THE RAIN',
    scroll: 'Scroll to see a story take shape',
    edition: 'A page for every possibility.',
    theaterKicker: '01 / IT BEGINS WITH A THOUGHT',
    theaterTitle: ['A story takes', 'shape, slowly.'],
    theaterIntro:
      'You do not need every answer at the start. Begin with one scene, then bring each step a little closer to what you imagined.',
    stageNav: 'Explore the creative process',
    specimen: 'Workflow illustration',
    specimenNote: 'Uses prepared artwork. No image generation is running.',
    generationNote:
      'Creating new images requires a working ComfyUI or cloud service. You choose when to generate and what to adopt.',
    storyFile: 'STORY NOTES',
    sceneLabel: 'SCENE ONE / ARRIVING IN TOWN',
    storyLine:
      'The streets wake after the rain. New to the town, a mail carrier begins her rounds.',
    storyNote: 'Put a picture into words. Give your story a place to begin.',
    routeLabel: 'Familiar tools, in their right places',
    routeItems: ['Scenes & variables', 'Character & style presets', 'ComfyUI / cloud'],
    routeFoot: 'Review the settings. Then choose to begin.',
    compareLabel: 'The creative choice stays yours',
    candidateA: 'Candidate A',
    candidateB: 'Candidate B',
    adopted: 'Adopted',
    compareFoot: 'New attempts keep earlier images. Only your choice enters the story.',
    exportLabel: 'A work you can take with you',
    exportTitle: 'After the rain, a letter arrives.',
    exportCaption: 'For everyone who chooses to wait.',
    exportFoot: 'Offline albums, PDFs, long images, and editable source files.',
    stages: [
      {
        title: 'Shape a scene',
        headline: 'One line becomes a first scene.',
        description:
          'Break your story into scenes, actions, and dialogue. Leave room for characters and styles with variables, so a good storyboard can begin again.',
        detail: 'Story templates / Character presets / Scene editing',
      },
      {
        title: 'Assemble your tools',
        headline: 'Choose how you want to create.',
        description:
          'Pick your presets, review the expanded prompts, and connect local ComfyUI or a cloud image service. Explore the nodes, or follow a clear next step.',
        detail: 'Local ComfyUI / Cloud services / Explicit start',
      },
      {
        title: 'Choose an image',
        headline: 'Take your time with a good picture.',
        description:
          'Keep your attempts, compare new candidates, and choose the one that belongs in your story. Generating again never quietly replaces an adopted image.',
        detail: 'Keep candidates / Compare images / Choose to adopt',
      },
      {
        title: 'Compose & export',
        headline: 'Let the space tell a story, too.',
        description:
          'Arrange pictures, words, and room to breathe. Preview, then export an album that opens on its own. Share it with readers. Keep it for your future self.',
        detail: 'Page composition / Reading preview / Multiple formats',
      },
    ],
    alts: [
      'Sample watercolor panel of a mail carrier arriving in a small town after the rain',
      'Sample watercolor panel of a mail carrier finding a letter on a bench',
      'Sample watercolor panel of a mail carrier handing a letter to an older florist',
      'Sample watercolor panel of a mail carrier heading through the town on her way home',
    ],
  },
};

type TheaterCopy = (typeof copy)['zh-CN'] | (typeof copy)['en'];

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function StageArtwork({ active, text }: { active: number; text: TheaterCopy }) {
  if (active === 0) {
    return (
      <div className="theater-scene theater-scene--story">
        <div className="theater-story-paper">
          <span className="theater-sheet-label">{text.sceneLabel}</span>
          <p>{text.storyLine}</p>
          <span className="theater-pencil-mark" aria-hidden="true" />
          <small>{text.storyNote}</small>
        </div>
        <figure className="theater-story-image">
          <img
            src={asset('scene-01.webp')}
            alt={text.alts[0]}
            width="768"
            height="1024"
            loading="lazy"
          />
          <figcaption>01 / AFTER THE RAIN</figcaption>
        </figure>
        <span className="theater-corner-number" aria-hidden="true">
          01
        </span>
      </div>
    );
  }

  if (active === 1) {
    return (
      <div className="theater-scene theater-scene--workflow">
        <p className="theater-art-heading">{text.routeLabel}</p>
        <ol className="theater-workflow">
          {text.routeItems.map((item, index) => (
            <li key={item}>
              <span className="theater-workflow-number">0{index + 1}</span>
              <span>{item}</span>
              {index < text.routeItems.length - 1 && (
                <span className="theater-connector" aria-hidden="true">
                  ↓
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="theater-art-foot">{text.routeFoot}</p>
        <span className="theater-corner-number" aria-hidden="true">
          02
        </span>
      </div>
    );
  }

  if (active === 2) {
    return (
      <div className="theater-scene theater-scene--candidates">
        <p className="theater-art-heading">{text.compareLabel}</p>
        <div className="theater-candidate-grid">
          <figure className="theater-candidate theater-candidate--alternative">
            <img src={asset('scene-03.webp')} alt="" width="768" height="1024" loading="lazy" />
            <figcaption>{text.candidateA}</figcaption>
          </figure>
          <figure className="theater-candidate theater-candidate--adopted">
            <img
              src={asset('scene-03.webp')}
              alt={text.alts[2]}
              width="768"
              height="1024"
              loading="lazy"
            />
            <figcaption>
              <span>{text.candidateB}</span>
              <span className="theater-adopted-label">
                <span aria-hidden="true">✓ </span>
                {text.adopted}
              </span>
            </figcaption>
          </figure>
        </div>
        <p className="theater-art-foot">{text.compareFoot}</p>
        <span className="theater-corner-number" aria-hidden="true">
          03
        </span>
      </div>
    );
  }

  return (
    <div className="theater-scene theater-scene--export">
      <div className="theater-book">
        <div className="theater-book-page theater-book-page--left">
          <span className="theater-sheet-label">AFTER THE RAIN</span>
          <img
            src={asset('scene-04.webp')}
            alt={text.alts[3]}
            width="768"
            height="1024"
            loading="lazy"
          />
          <span className="theater-book-folio" aria-hidden="true">
            04
          </span>
        </div>
        <div className="theater-book-page theater-book-page--right">
          <span className="theater-sheet-label">{text.exportLabel}</span>
          <p className="theater-book-title">{text.exportTitle}</p>
          <p className="theater-book-caption">{text.exportCaption}</p>
          <span className="theater-book-folio" aria-hidden="true">
            05
          </span>
        </div>
      </div>
      <p className="theater-art-foot">{text.exportFoot}</p>
      <span className="theater-corner-number" aria-hidden="true">
        04
      </span>
    </div>
  );
}

export function HeroTheater({ locale }: SectionProps) {
  const text = copy[locale];
  const [active, setActive] = useState(0);
  const id = useId();
  const stageRefs = useRef<Array<HTMLElement | null>>([]);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!window.IntersectionObserver || !window.matchMedia) return;
    const wideScreen = window.matchMedia('(min-width: 901px)');
    let observer: IntersectionObserver | undefined;

    const observeStages = () => {
      observer?.disconnect();
      if (!wideScreen.matches) return;
      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (visible) setActive(Number((visible.target as HTMLElement).dataset.stage));
        },
        { rootMargin: '-130px 0px -130px 0px', threshold: [0, 0.3, 0.6] },
      );
      stageRefs.current.forEach((stage) => {
        if (stage) observer?.observe(stage);
      });
    };

    observeStages();
    wideScreen.addEventListener('change', observeStages);
    return () => {
      observer?.disconnect();
      wideScreen.removeEventListener('change', observeStages);
    };
  }, []);

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % text.stages.length;
    else if (event.key === 'ArrowLeft')
      next = (index - 1 + text.stages.length) % text.stages.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = text.stages.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <section className={`mio-hero mio-hero--${locale}`} aria-labelledby={`${id}-hero-title`}>
        <div className="section-shell">
          <div className="hero-edition-line">
            <span>{text.kicker}</span>
            <span aria-hidden="true">STORIES, KEPT CLOSE.</span>
          </div>
          <div className="hero-layout">
            <div className="hero-copy">
              <p className="hero-overline">
                <span aria-hidden="true" /> A LITTLE STUDIO, AN OPEN WORLD.
              </p>
              <h1 id={`${id}-hero-title`} className="hero-title">
                <span>{text.title[0]}</span>
                <span>{text.title[1]}</span>
              </h1>
              <p className="hero-subtitle">{text.subtitle}</p>
              <p className="hero-description">{text.intro}</p>
              <div className="hero-actions">
                <a className="button button--accent hero-primary" href="#playground">
                  {text.try}
                  <Arrow />
                </a>
                <a
                  className="text-link hero-download"
                  href={RELEASES}
                  target="_blank"
                  rel="noreferrer"
                >
                  {text.download}
                  <Arrow />
                </a>
              </div>
              <ul
                className="hero-principles"
                aria-label={
                  locale === 'en' ? 'Made for your creative practice' : '为创作留下的坚持'
                }
              >
                {text.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            </div>
            <div
              className="hero-art"
              aria-label={
                locale === 'en' ? 'Sample comic: After the rain' : '示例漫画：雨停以后，信会抵达'
              }
            >
              <div className="hero-art-axis" aria-hidden="true">
                <span>AN IDEA, GIVEN FORM.</span>
                <i />
              </div>
              <figure className="hero-panel hero-panel--arrival">
                <img
                  src={asset('scene-01.webp')}
                  alt={text.alts[0]}
                  width="768"
                  height="1024"
                  fetchPriority="high"
                />
                <figcaption>
                  <span>SCENE 01</span>
                  <span>TOWN ARRIVAL</span>
                </figcaption>
              </figure>
              <figure className="hero-panel hero-panel--letter">
                <img src={asset('scene-02.webp')} alt={text.alts[1]} width="768" height="1024" />
                <figcaption>
                  <span>02</span>
                  <span>A LETTER FOUND</span>
                </figcaption>
              </figure>
              <figure className="hero-panel hero-panel--home">
                <img src={asset('scene-04.webp')} alt={text.alts[3]} width="768" height="1024" />
                <figcaption>
                  <span>04</span>
                  <span>THE WAY HOME</span>
                </figcaption>
              </figure>
              <div className="hero-cover-title">
                <span>{text.coverTitle[0]}</span>
                <span>{text.coverTitle[1]}</span>
                <small>{text.coverNote}</small>
              </div>
              <span className="hero-art-annotation">{text.coverLabel}</span>
              <div className="hero-issue-mark" aria-hidden="true">
                <span>MIO</span>
                <span>STORY</span>
                <b>001</b>
              </div>
            </div>
          </div>
          <div className="hero-footer">
            <span className="hero-footer-note">{text.edition}</span>
            <a href="#the-making">
              {text.scroll}
              <span aria-hidden="true">↓</span>
            </a>
            <span className="hero-page-number" aria-hidden="true">
              001 — ∞
            </span>
          </div>
        </div>
      </section>

      <section
        id="the-making"
        className={`mio-theater mio-theater--${locale} section-shell`}
        aria-labelledby={`${id}-theater-title`}
      >
        <header className="theater-heading">
          <div>
            <p className="eyebrow">{text.theaterKicker}</p>
            <h2 id={`${id}-theater-title`} className="section-title theater-title">
              <span>{text.theaterTitle[0]}</span>
              <span>{text.theaterTitle[1]}</span>
            </h2>
          </div>
          <p className="section-copy theater-intro">{text.theaterIntro}</p>
        </header>
        <div className="theater-tabs" role="tablist" aria-label={text.stageNav}>
          {text.stages.map((stage, index) => (
            <button
              key={stage.title}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${id}-tab-${index}`}
              className="theater-tab"
              type="button"
              role="tab"
              aria-selected={active === index}
              aria-controls={`${id}-panel`}
              tabIndex={active === index ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => handleTabKey(event, index)}
            >
              <span className="theater-tab-number" aria-hidden="true">
                0{index + 1}
              </span>
              <span>{stage.title}</span>
              <span className="theater-tab-dot" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="theater-body">
          <div className="theater-narrative">
            {text.stages.map((stage, index) => (
              <article
                className={`theater-step${active === index ? ' is-active' : ''}`}
                key={stage.title}
                ref={(node) => {
                  stageRefs.current[index] = node;
                }}
                data-stage={index}
              >
                <span className="theater-step-number" aria-hidden="true">
                  0{index + 1}
                </span>
                <div>
                  <p className="theater-step-label">{stage.title}</p>
                  <h3>{stage.headline}</h3>
                  <p className="theater-step-description">{stage.description}</p>
                  <p className="theater-step-detail">{stage.detail}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="theater-stage-column">
            <div className="theater-stage-sticky">
              <div className="theater-stage-topline">
                <span>{text.storyFile}</span>
                <span aria-hidden="true">MIO / 0{active + 1}</span>
              </div>
              <div
                id={`${id}-panel`}
                className="theater-stage"
                role="tabpanel"
                aria-labelledby={`${id}-tab-${active}`}
                tabIndex={0}
                data-active-stage={active}
              >
                <StageArtwork active={active} text={text} />
              </div>
              <p className="theater-disclosure">
                <span>{text.specimen}</span>
                {text.specimenNote}
              </p>
            </div>
          </div>
        </div>
        <p className="theater-generation-note">
          <span aria-hidden="true">✳</span>
          {text.generationNote}
        </p>
      </section>
    </>
  );
}
