import { useEffect, useRef, useState } from 'react';
import type { Locale, SectionProps } from '../../shared/types';
import './quickstart.css';

const repository = 'https://github.com/lumingya/comfy-comic-studio';
const releases = `${repository}/releases`;

type InstallMode = 'windows' | 'unix' | 'comfy';
type CopyState = 'idle' | 'pending' | 'copied' | 'failed';

type InstallStep = {
  title: string;
  text: string;
  download?: boolean;
  commands?: { label: string; command: string }[];
  localAddress?: boolean;
};

const copy = {
  'zh-CN': {
    eyebrow: '05 / THE NEXT CHAPTER',
    title: ['下一页，', '由你落笔。'],
    introduction: '把工作室留在自己的电脑里。带上一个故事，从这三步开始。',
    download: '下载 Mio',
    releaseNote: '免费开源 · 前往 GitHub Releases',
    modeLabel: '选择你的上手方式',
    modes: {
      windows: 'Windows 发布包',
      unix: 'macOS / Linux 发布包',
      comfy: '已有 ComfyUI',
    },
    requirement: '需 Python 3.11+。首次启动需联网安装依赖；发布包已带界面，无需 Node.js。',
    guideLabel: '安装步骤',
    downloadStep: '打开发布下载页',
    studio: '打开本机工作室',
    sourceTitle: '更习惯从源码开始？',
    sourceDescription: '另需 Node.js 20+。在仓库根目录先安装和构建界面，再运行对应系统的启动脚本。',
    sourceLink: '查看源码运行说明',
    sourceCommands: '源码构建命令',
    copy: '复制',
    copying: '正在复制…',
    copied: '已复制',
    failed: '复制失败',
    copyLabel: '复制命令：',
    copySuccess: '命令已复制。',
    copyFailure: '未能访问剪贴板。请选中上方命令，手动复制。',
    faqEyebrow: 'A FEW NOTES / 开篇前的小问题',
    faqTitle: '先回答几个，\n你可能在想的问题。',
    faqs: [
      {
        question: '在线试玩，会真的生成图片吗？',
        answer:
          '不会。官网试玩使用预置的示例素材，在浏览器里演示创作过程，不会连接生图服务。下载后的工作室，需连接可用的 ComfyUI 或云端服务才能生成新图。',
      },
      {
        question: 'Mio 免费吗？会产生什么费用？',
        answer:
          'Mio 以 MIT 许可证开源，可免费使用。自行选择的云端生图或 AI 服务可能按其规则计费；使用前请查看服务商的价格与条款。',
      },
      {
        question: '需要什么显卡？普通电脑可以用吗？',
        answer:
          '使用云端生图，无需本地 GPU。本地 ComfyUI 的需求取决于模型、工作流和图片尺寸；8 GB 显存是项目的参考档位，并不保证所有工作流都能运行。',
      },
      {
        question: '我的作品和提示词会去哪里？',
        answer:
          '作品与素材保存在自己的电脑上。选择云端服务时，生成所需的提示词与参考图会发送给所选服务商；请按自己的隐私需要选择服务。',
      },
      {
        question: '离线 HTML 和可编辑备份，有什么区别？',
        answer:
          '离线 HTML 是送给读者的作品，可独立打开阅读与分享。要保留可继续编辑的内容，请另存源文件或创作套装；完整工作区可在「设置 → 数据与备份」中备份。',
      },
    ],
    footerTagline: '从一个故事，到你的作品。',
    source: 'GitHub 源码',
    release: '发布下载',
    manual: '使用教程',
    roadmap: '路线图',
    footerNav: '项目与帮助',
    colophon: '独立创作工具 / 本地优先 / 开源',
    closing: '故事的下一页，交给你。',
  },
  en: {
    eyebrow: '05 / THE NEXT CHAPTER',
    title: ['Your next page', 'starts here.'],
    introduction: 'A studio on your own computer. Bring a story, and start with these three steps.',
    download: 'Download Mio',
    releaseNote: 'Free & open source · GitHub Releases',
    modeLabel: 'Choose your starting point',
    modes: {
      windows: 'Windows release',
      unix: 'macOS / Linux release',
      comfy: 'I have ComfyUI',
    },
    requirement:
      'Python 3.11+ required. First launch needs internet to install dependencies. Releases include the interface; no Node.js needed.',
    guideLabel: 'Installation steps',
    downloadStep: 'Open release downloads',
    studio: 'Open your local studio',
    sourceTitle: 'Prefer to run from source?',
    sourceDescription:
      'You will also need Node.js 20+. Install and build the interface from the repository root, then run your operating system’s startup script.',
    sourceLink: 'Read the source setup guide',
    sourceCommands: 'Source build commands',
    copy: 'Copy',
    copying: 'Copying…',
    copied: 'Copied',
    failed: 'Copy failed',
    copyLabel: 'Copy command: ',
    copySuccess: 'Command copied.',
    copyFailure: 'Clipboard access failed. Select the command above and copy it manually.',
    faqEyebrow: 'A FEW NOTES / BEFORE YOU BEGIN',
    faqTitle: 'A few things\nyou may be wondering.',
    faqs: [
      {
        question: 'Does the online playground generate real images?',
        answer:
          'No. The website uses prepared example artwork to demonstrate the creative process in your browser. It does not connect to a generation service. To make new images in the downloaded studio, connect a working ComfyUI instance or cloud service.',
      },
      {
        question: 'Is Mio free? What might cost money?',
        answer:
          'Mio is free to use and open source under the MIT license. Cloud image or AI services you choose may charge for usage. Check your provider’s pricing and terms before using them.',
      },
      {
        question: 'What graphics card do I need?',
        answer:
          'Cloud generation needs no local GPU. Local ComfyUI requirements depend on the model, workflow, and image size. An 8 GB GPU is a project reference point, not a guarantee that every workflow will run.',
      },
      {
        question: 'Where do my work and prompts go?',
        answer:
          'Your work and assets are stored on your own computer. If you choose a cloud service, prompts and reference images needed for generation are sent to that provider. Choose a service that fits your privacy needs.',
      },
      {
        question: 'Is an offline HTML album an editable backup?',
        answer:
          'An offline HTML album is a finished work to read and share independently. Save a source file or creative bundle to keep editing. Back up the whole workspace in Settings → Data & backups.',
      },
    ],
    footerTagline: 'From a story to a work of your own.',
    source: 'Source on GitHub',
    release: 'Releases',
    manual: 'User guide',
    roadmap: 'Roadmap',
    footerNav: 'Project and help',
    colophon: 'INDEPENDENT CREATION / LOCAL FIRST / OPEN SOURCE',
    closing: 'The next page belongs to you.',
  },
} as const;

function installationSteps(locale: Locale, mode: InstallMode): InstallStep[] {
  if (locale === 'en') {
    const steps: InstallStep[] = [
      {
        title: mode === 'comfy' ? 'Download Mio as well.' : 'Make room for your studio.',
        text:
          mode === 'comfy'
            ? 'ComfyUI creates the images; Mio brings your story, selection, and pages together. Download and extract a Mio release, and install Python 3.11+.'
            : 'Download a Mio release ZIP and extract it to a folder of your own. Install Python 3.11 or newer before continuing.',
        download: true,
      },
      {
        title: 'Start the studio.',
        text:
          mode === 'windows'
            ? 'Double-click start.bat, or run it in a terminal from the extracted folder. First launch downloads dependencies; keep the terminal open while using Mio.'
            : mode === 'unix'
              ? 'Run ./start.sh in a terminal from the extracted folder. First launch downloads dependencies; keep that terminal open while using Mio.'
              : 'Start Mio from its extracted folder with the script for your system. First launch installs dependencies over the internet. Keep the terminal open.',
        commands:
          mode === 'windows'
            ? [{ label: 'Windows', command: '.\\start.bat' }]
            : mode === 'unix'
              ? [{ label: 'macOS / Linux', command: './start.sh' }]
              : [
                  { label: 'Windows', command: '.\\start.bat' },
                  { label: 'macOS / Linux', command: './start.sh' },
                ],
      },
      {
        title: mode === 'comfy' ? 'Connect your ComfyUI.' : 'Open your first page.',
        text:
          mode === 'comfy'
            ? 'Open Mio at 127.0.0.1:8788 and configure your ComfyUI address, usually http://127.0.0.1:8188. First make sure your models, custom nodes, and workflow run in ComfyUI.'
            : 'Open 127.0.0.1:8788 in your browser and explore the included story. Connect ComfyUI or a cloud image service when you are ready to generate. Closing the browser does not stop the studio.',
        localAddress: true,
      },
    ];
    return steps;
  }

  return [
    {
      title: mode === 'comfy' ? '也为 Mio 留一个位置。' : '为工作室留一个位置。',
      text:
        mode === 'comfy'
          ? 'ComfyUI 负责出图，Mio 串起故事、挑图和排版。仍需下载并解压 Mio 发布包，同时安装 Python 3.11 或更新版本。'
          : '下载 Mio 发布 ZIP，解压到自己的目录。继续之前，请先安装 Python 3.11 或更新版本。',
      download: true,
    },
    {
      title: '让工作室亮起灯。',
      text:
        mode === 'windows'
          ? '双击 start.bat，或在解压目录的终端中运行。首次启动会联网安装依赖；使用 Mio 期间，请保留这个终端。'
          : mode === 'unix'
            ? '在解压目录的终端中运行 ./start.sh。首次启动会联网安装依赖；使用 Mio 期间，请保留这个终端。'
            : '在 Mio 解压目录运行对应系统的启动脚本。首次启动会联网安装依赖，使用期间请保留终端。',
      commands:
        mode === 'windows'
          ? [{ label: 'Windows', command: '.\\start.bat' }]
          : mode === 'unix'
            ? [{ label: 'macOS / Linux', command: './start.sh' }]
            : [
                { label: 'Windows', command: '.\\start.bat' },
                { label: 'macOS / Linux', command: './start.sh' },
              ],
    },
    {
      title: mode === 'comfy' ? '接上熟悉的 ComfyUI。' : '打开自己的第一幕。',
      text:
        mode === 'comfy'
          ? '在浏览器打开 127.0.0.1:8788，在 Mio 中配置 ComfyUI 地址，通常为 http://127.0.0.1:8188。先确认模型、自定义节点和工作流已在 ComfyUI 中正常运行。'
          : '在浏览器打开 127.0.0.1:8788，先读随包故事。想生成新图时，再连接 ComfyUI 或云端生图服务。只关闭浏览器，不会停止工作室。',
      localAddress: true,
    },
  ];
}

function CommandLine({
  label,
  command,
  locale,
}: {
  label: string;
  command: string;
  locale: Locale;
}) {
  const text = copy[locale];
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, []);

  async function copyCommand() {
    if (timer.current !== undefined) clearTimeout(timer.current);
    setState('pending');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(command);
      if (!mounted.current) return;
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), 3000);
    } catch {
      if (mounted.current) setState('failed');
    }
  }

  const buttonText =
    state === 'copied'
      ? text.copied
      : state === 'failed'
        ? text.failed
        : state === 'pending'
          ? text.copying
          : text.copy;

  return (
    <div className="qs-command">
      <div className="qs-command__label">{label}</div>
      <div className="qs-command__line">
        <pre>
          <code>{command}</code>
        </pre>
        <button
          type="button"
          onClick={copyCommand}
          disabled={state === 'pending'}
          aria-label={`${text.copyLabel}${label}`}
          className="qs-command__copy"
        >
          {buttonText}
        </button>
      </div>
      <p className="qs-command__status" role="status" aria-live="polite">
        {state === 'copied' ? text.copySuccess : state === 'failed' ? text.copyFailure : ''}
      </p>
    </div>
  );
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      {diagonal ? (
        <path d="M5 19 19 5M5 5h14v14" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <path d="M3 12h17m-7-7 7 7-7 7" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

export function QuickStartFooter({ locale }: SectionProps) {
  const text = copy[locale];
  const [mode, setMode] = useState<InstallMode>('windows');
  const modes: InstallMode[] = ['windows', 'unix', 'comfy'];
  const steps = installationSteps(locale, mode);

  return (
    <>
      <section id="start" className="qs-start" aria-labelledby="qs-title">
        <div className="section-shell">
          <div className="qs-start__masthead">
            <p className="eyebrow">{text.eyebrow}</p>
            <span className="qs-start__edition" aria-hidden="true">
              MIO / FIELD GUIDE
            </span>
          </div>
          <div className="qs-start__opening">
            <div>
              <h2 id="qs-title" className="qs-start__title">
                {text.title.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </h2>
              <p className="qs-start__introduction">{text.introduction}</p>
            </div>
            <a className="qs-download" href={releases} target="_blank" rel="noreferrer">
              <span className="qs-download__mark" aria-hidden="true">
                ↓
              </span>
              <span className="qs-download__label">
                {text.download}
                <Arrow diagonal />
              </span>
              <span className="qs-download__note">{text.releaseNote}</span>
            </a>
          </div>

          <div className="qs-guide">
            <div className="qs-guide__aside">
              <p className="qs-guide__label">{text.modeLabel}</p>
              <div className="qs-modes" role="group" aria-label={text.modeLabel}>
                {modes.map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={mode === value}
                    aria-controls="qs-installation"
                    onClick={() => setMode(value)}
                  >
                    <span>{text.modes[value]}</span>
                    <span aria-hidden="true">{mode === value ? '●' : '○'}</span>
                  </button>
                ))}
              </div>
              <p className="qs-guide__requirement">{text.requirement}</p>
              <span className="qs-guide__annotation" aria-hidden="true">
                A SMALL BEGINNING.
                <br />A WORLD OF YOUR OWN.
              </span>
            </div>

            <ol
              id="qs-installation"
              key={mode}
              className="qs-steps"
              aria-label={`${text.guideLabel} · ${text.modes[mode]}`}
            >
              {steps.map((step, index) => (
                <li className="qs-step" key={step.title}>
                  <span className="qs-step__number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="qs-step__content">
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                    {step.download && (
                      <a
                        className="text-link qs-step__link"
                        href={releases}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {text.downloadStep} <Arrow diagonal />
                      </a>
                    )}
                    {step.commands?.map(({ label, command }) => (
                      <CommandLine key={label} label={label} command={command} locale={locale} />
                    ))}
                    {step.localAddress && (
                      <a
                        className="qs-local-link"
                        href="http://127.0.0.1:8788"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span>
                          <small>{text.studio}</small>
                          <span>127.0.0.1:8788</span>
                        </span>
                        <Arrow diagonal />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <details className="qs-source">
            <summary>
              <span>{text.sourceTitle}</span>
              <span className="qs-expand" aria-hidden="true" />
            </summary>
            <div className="qs-source__body">
              <div>
                <p>{text.sourceDescription}</p>
                <a
                  href={`${repository}#从源码运行`}
                  className="text-link qs-step__link"
                  target="_blank"
                  rel="noreferrer"
                >
                  {text.sourceLink} <Arrow diagonal />
                </a>
              </div>
              <CommandLine
                label={text.sourceCommands}
                command={'npm ci --prefix web\nnpm --prefix web run build'}
                locale={locale}
              />
            </div>
          </details>
        </div>
      </section>

      <section className="qs-faq section-shell" aria-labelledby="qs-faq-title">
        <div className="qs-faq__heading">
          <p className="eyebrow">{text.faqEyebrow}</p>
          <h2 id="qs-faq-title" className="section-title">
            {text.faqTitle.split('\n').map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h2>
        </div>
        <div className="qs-faq__list">
          {text.faqs.map(({ question, answer }, index) => (
            <details className="qs-faq__item" key={index}>
              <summary>
                <span className="qs-faq__number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{question}</span>
                <span className="qs-expand" aria-hidden="true" />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="qs-footer">
        <div className="section-shell">
          <div className="qs-footer__topline">
            <p className="qs-footer__tagline">{text.footerTagline}</p>
            <nav className="qs-footer__nav" aria-label={text.footerNav}>
              <a href={repository} target="_blank" rel="noreferrer">
                {text.source}
              </a>
              <a href={releases} target="_blank" rel="noreferrer">
                {text.release}
              </a>
              <a href={`${repository}#随时翻阅的教程`} target="_blank" rel="noreferrer">
                {text.manual}
              </a>
              <a href={`${repository}/blob/main/docs/ROADMAP.md`} target="_blank" rel="noreferrer">
                {text.roadmap}
              </a>
              <a href={`${repository}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
                MIT License
              </a>
            </nav>
          </div>
          <div className="qs-footer__imprint">
            <span className="qs-footer__wordmark" aria-label="Mio · 绘页">
              Mio<span aria-hidden="true">.</span>
            </span>
            <div className="qs-footer__signature">
              <span className="qs-footer__issue">NO. 01 / AN OPEN STUDIO</span>
              <span className="qs-footer__motto">
                From story
                <br />
                to yours.
              </span>
            </div>
          </div>
          <div className="qs-footer__bottomline">
            <span>{text.colophon}</span>
            <span>{text.closing}</span>
            <a href="#top" aria-label={locale === 'zh-CN' ? '返回顶部' : 'Back to top'}>
              ↑
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
