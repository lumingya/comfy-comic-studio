import { useId, useState } from 'react';
import type { SectionProps } from '../../shared/types';
import './ecosystem.css';

const REPOSITORY = 'https://github.com/lumingya/comfy-comic-studio';

const extensions = [
  { id: 'panel-retouch', label: 'RETOUCH' },
  { id: 'qa-review', label: 'REVIEW' },
  { id: 'finalize-studio', label: 'REFINE' },
  { id: 'variant-workshop', label: 'VARIATIONS' },
  { id: 'script-assistant', label: 'SCRIPT' },
  { id: 'motion-studio', label: 'MOTION' },
] as const;

const commands = ['works', 'draw', 'tasks', 'help'] as const;

const copy = {
  'zh-CN': {
    eyebrow: '04 / 一间小工作室，一个开放的世界',
    marginNote: 'THE STUDIO IS YOURS.',
    title: ['作品，', '留在自己', '手里。'],
    manifesto: '素材、作品与创作的选择，都有自己的位置。日常轻一点，需要时，再把工具箱打开。',
    localLabel: '本地优先',
    localTitle: '自己的文件，自己的节奏。',
    localCopy:
      '作品与素材保存在自己的电脑。可连接本机 ComfyUI，也可选择云端图像服务。选择云端时，提示词与所选参考图会发送给相应服务。',
    openLabel: '开放源代码',
    openCopy:
      'Mio 以 MIT 许可免费开放。模型、硬件与所选云服务，按各自的条件使用；云端调用可能计费。',
    source: '翻阅源代码',
    catalogueEyebrow: '按需展开 / OPTIONAL TOOLS',
    catalogueTitle: ['让专业的事，', '在需要时展开。'],
    catalogueCopy:
      '六种随包专业工作台，默认关闭。先审阅来源与内容摘要，再明确启用。它们辅助处理具体环节，创作和审阅仍由你完成。',
    catalogueLabel: '专业扩展目录',
    closedLabel: '默认关闭 · 审阅后启用',
    entryLabel: '启用后的入口',
    documentation: '使用说明与源码',
    items: [
      {
        name: '单格精修',
        short: '把一个画面，再靠近一点。',
        detail:
          '画蒙版、向外扩展，或用文字指令编辑。需要相应工作流或图像渠道；结果先留下为新候选，确认采用后才进入作品。',
        entry: '扩展工作区 → 单格精修',
      },
      {
        name: '质检与挑图',
        short: '多一双眼睛，选择仍是你的。',
        detail:
          '调用已配置的视觉模型，查看一致性、镜头与人物问题，逐格复核候选。评审可能消耗服务额度，不会自动替你采纳。',
        entry: '话页 → 扩展 → 质检与挑图',
      },
      {
        name: '成品精修',
        short: '给已经选中的草稿，细细收尾。',
        detail:
          '选择已采用草稿，按配置中的成品工作流逐格处理。提交前确认采用行为，完成后对比原图，也能恢复来源草稿；效果取决于工作流。',
        entry: '话页 → 扩展 → 成品精修',
      },
      {
        name: '变体工坊',
        short: '同一段故事，试几种可能。',
        detail:
          '预览角色外观与画风的组合矩阵，选择版本和分幕后再生成。跨版本比较、分别采用，保留每一次创作判断。',
        entry: '话页 → 扩展 → 变体工坊',
      },
      {
        name: '剧本助手',
        short: '讨论故事，而不是替你定稿。',
        detail:
          '生成剧本建议，逐项审阅对白与节奏。只应用明确选中的修改，应用前留下检查点；生成建议可能调用已配置的付费文本模型。',
        entry: '话页 → 扩展 → 剧本助手',
      },
      {
        name: '动态漫工作台',
        short: '给静止的画面，一点时间。',
        detail:
          '为已采用画面安排镜头、时长与转场，试听可用的浏览器语音，导出离线 HTML 动态漫。当前交付的是 HTML 播放器，不是原生 MP4 视频。',
        entry: '话页 → 扩展 → 动态漫工作台',
      },
    ],
    extraCopy: '想聊聊创作？另有可选的 AI 辅助扩展。',
    extraLink: '了解 AI 辅助',
    bridgeEyebrow: '继续向外 / CONNECT YOUR OWN WAY',
    bridgeTitle: '让熟悉的工具，接着做。',
    bridgeCopy: '脚本、机器人与自动化工具，都可以接入同一套作品流程。',
    apiKicker: '01 / 给程序的入口',
    apiTitle: '开放 API v2',
    apiCopy: '用带作用域的 Bearer 令牌，读取作品、编排任务，或保存交付物。',
    apiExample: '请求写法示例 · 不连接本机服务',
    apiCodeComment: '# 示例：列出作品，需要 read 权限',
    apiScopes: '按操作分配 read / write / render 等作用域；示例令牌只是占位符。',
    apiLink: '阅读 API 与 Python 客户端文档',
    chatKicker: '02 / 一个联动示例',
    chatTitle: 'Mio × AstrBot',
    chatCopy: '随包的 AstrBot 插件，是开放接口的一个消费者。把同一套能力，接到对话里。',
    commandLabel: '查看 AstrBot 指令示例',
    commandNames: {
      works: '/mio 作品',
      draw: '/mio 画',
      tasks: '/mio 任务',
      help: '/mio 帮助',
    },
    commandInput: {
      works: '/mio 作品',
      draw: '/mio 画 雨后的街角，一家刚开门的书店',
      tasks: '/mio 任务',
      help: '/mio 帮助',
    },
    commandResponse: {
      works: '把作品带回对话。\n查看工作室里的作品列表。',
      draw: '从一句话，开始创作。\n通过已配置的服务，写剧本、出图并返回漫画。',
      tasks: '等候，也心里有数。\n查看正在进行的创作任务。',
      help: '先认识这间小工作室。\n查看指令用法与创作入口。',
    },
    you: '你',
    exampleReply: '回复示意',
    sampleLabel: '静态对话示例，不会发送消息或运行任务。',
    chatScopes: '实际使用需配置服务与访问权限；创作指令需要 read + write + render 令牌。',
    chatLink: '查看 AstrBot 插件',
  },
  en: {
    eyebrow: '04 / A LITTLE STUDIO, AN OPEN WORLD',
    marginNote: 'THE STUDIO IS YOURS.',
    title: ['Your work.', 'In your', 'hands.'],
    manifesto:
      'A place for your materials, your stories, and your choices. Keep the everyday simple. Open the toolbox when you need more.',
    localLabel: 'LOCAL FIRST',
    localTitle: 'Your files. Your own pace.',
    localCopy:
      'Your work and materials live on your computer. Connect local ComfyUI or choose a cloud image service. With a cloud service, prompts and selected reference images are sent to that service.',
    openLabel: 'OPEN SOURCE',
    openCopy:
      'Mio is free software under the MIT license. Models, hardware, and cloud services have their own terms; cloud calls may incur charges.',
    source: 'Explore the source',
    catalogueEyebrow: 'OPTIONAL TOOLS / OPEN AS NEEDED',
    catalogueTitle: ['Go deeper,', 'when you choose.'],
    catalogueCopy:
      'Six bundled professional workspaces, off by default. Review their source and content digest, then explicitly enable them. They assist specific steps; the creative review stays with you.',
    catalogueLabel: 'Professional extension directory',
    closedLabel: 'Off by default · Review to enable',
    entryLabel: 'Where to open after enabling',
    documentation: 'Guide & source',
    items: [
      {
        name: 'Panel Retouch',
        short: 'Bring one picture a little closer.',
        detail:
          'Paint a mask, extend an image, or edit with instructions. A suitable workflow or image service is required. Results become new candidates; adopt one explicitly to use it in your work.',
        entry: 'Extension workspace → Panel Retouch',
      },
      {
        name: 'Review & Selection',
        short: 'Another pair of eyes. Your choice.',
        detail:
          'Use a configured vision model to inspect consistency, framing, and character issues, then review candidates panel by panel. Reviews may use paid credits and do not adopt images automatically.',
        entry: 'Episode → Extensions → Review & Selection',
      },
      {
        name: 'Final Refinement',
        short: 'A careful finish for chosen drafts.',
        detail:
          'Run selected adopted drafts through your configured final-stage workflows. Confirm adoption behavior before submitting, compare results, or restore the source draft. Quality depends on the workflow.',
        entry: 'Episode → Extensions → Final Refinement',
      },
      {
        name: 'Variant Workshop',
        short: 'One story. A few more possibilities.',
        detail:
          'Preview a matrix of character appearances and styles. Choose the variants and scenes to generate, then compare and adopt separately for each version.',
        entry: 'Episode → Extensions → Variant Workshop',
      },
      {
        name: 'Script Assistant',
        short: 'A conversation, before a final draft.',
        detail:
          'Review script proposals and pacing suggestions one at a time. Apply only selected edits, with a checkpoint saved first. Generating a proposal may call your configured paid text model.',
        entry: 'Episode → Extensions → Script Assistant',
      },
      {
        name: 'Motion Studio',
        short: 'Give a still picture a little time.',
        detail:
          'Arrange camera moves, timing, and transitions for adopted images, preview available browser voices, and export an offline HTML motion comic. The current output is an HTML player, not a native MP4 video.',
        entry: 'Episode → Extensions → Motion Studio',
      },
    ],
    extraCopy: 'Want to talk through an idea? AI Assist is available separately.',
    extraLink: 'Explore AI Assist',
    bridgeEyebrow: 'CONNECT YOUR OWN WAY / BEYOND THE STUDIO',
    bridgeTitle: 'Let your familiar tools take it further.',
    bridgeCopy: 'Scripts, bots, and automation tools can use the same creative workflow.',
    apiKicker: '01 / FOR YOUR PROGRAMS',
    apiTitle: 'Open API v2',
    apiCopy: 'Read your work, orchestrate tasks, and save deliverables with a scoped Bearer token.',
    apiExample: 'Illustrative request · No connection to a local service',
    apiCodeComment: '# Example: list works; requires the read scope',
    apiScopes:
      'Assign read / write / render and other scopes per operation. The token is a placeholder.',
    apiLink: 'Read the API & Python client guide',
    chatKicker: '02 / ONE WAY TO CONNECT',
    chatTitle: 'Mio × AstrBot',
    chatCopy:
      'The bundled AstrBot plugin is one consumer of the open API. Bring the same capabilities into a conversation.',
    commandLabel: 'Explore AstrBot command examples',
    commandNames: {
      works: '/mio 作品',
      draw: '/mio 画',
      tasks: '/mio 任务',
      help: '/mio 帮助',
    },
    commandInput: {
      works: '/mio 作品',
      draw: '/mio 画 A bookshop opening on a street after rain',
      tasks: '/mio 任务',
      help: '/mio 帮助',
    },
    commandResponse: {
      works: 'Bring your work into the conversation.\nBrowse the works in your studio.',
      draw: 'Begin with a single sentence.\nUse configured services to write, generate, and return a comic.',
      tasks: 'Know where your story stands.\nCheck creative tasks that are in progress.',
      help: 'Get to know your little studio.\nSee command usage and where to begin.',
    },
    you: 'YOU',
    exampleReply: 'ILLUSTRATIVE REPLY',
    sampleLabel: 'Static conversation example. No messages are sent or tasks run.',
    chatScopes:
      'Services and access must be configured. Creation commands require a read + write + render token.',
    chatLink: 'Explore the AstrBot plugin',
  },
};

export function EcosystemBento({ locale }: SectionProps) {
  const text = copy[locale];
  const id = useId();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [command, setCommand] = useState<(typeof commands)[number]>('works');
  const sample = `${text.apiCodeComment}\ncurl "http://127.0.0.1:8788/api/v2/series" \\\n  -H "Authorization: Bearer <YOUR_READ_TOKEN>"`;

  return (
    <section
      id="ecosystem"
      className={`ecosystem ecosystem--${locale}`}
      aria-labelledby={`${id}-title`}
      lang={locale}
    >
      <div className="section-shell">
        <div className="ecosystem-edition">
          <p className="eyebrow">{text.eyebrow}</p>
          <span aria-hidden="true">{text.marginNote}</span>
        </div>

        <div className="ecosystem-main-spread">
          <div className="ecosystem-manifesto">
            <div className="ecosystem-ownership-mark" aria-hidden="true">
              <svg viewBox="0 0 70 60" fill="none">
                <path d="M7 16h22l6 7h28v30H7V16Z" />
                <path d="M15 16V7h39v16M23 34h24M23 41h16" />
              </svg>
              <span>LOCAL / FIRST</span>
            </div>
            <h2 id={`${id}-title`} className="ecosystem-manifesto-title">
              {text.title.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h2>
            <p className="ecosystem-manifesto-intro">{text.manifesto}</p>
            <div className="ecosystem-local-note">
              <p className="eyebrow">{text.localLabel}</p>
              <h3>{text.localTitle}</h3>
              <p>{text.localCopy}</p>
            </div>
            <div className="ecosystem-open-note">
              <p className="eyebrow">{text.openLabel}</p>
              <p>{text.openCopy}</p>
              <a className="text-link" href={REPOSITORY} target="_blank" rel="noreferrer">
                {text.source} <span aria-hidden="true">↗</span>
              </a>
            </div>
            <span className="ecosystem-manifesto-folio" aria-hidden="true">
              MIO / A WORK OF YOUR OWN
            </span>
          </div>

          <div className="ecosystem-catalogue">
            <p className="eyebrow">{text.catalogueEyebrow}</p>
            <h3 className="ecosystem-catalogue-title">
              {text.catalogueTitle.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h3>
            <p className="section-copy ecosystem-catalogue-copy">{text.catalogueCopy}</p>
            <p className="ecosystem-default-note">
              <span aria-hidden="true" /> {text.closedLabel}
            </p>

            <ol className="ecosystem-extension-list" aria-label={text.catalogueLabel}>
              {extensions.map((extension, index) => {
                const item = text.items[index];
                const isExpanded = expanded === extension.id;
                const panelId = `${id}-${extension.id}`;
                return (
                  <li className="ecosystem-extension" key={extension.id}>
                    <h4>
                      <button
                        className="ecosystem-extension-toggle"
                        id={`${panelId}-toggle`}
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        onClick={() => setExpanded(isExpanded ? null : extension.id)}
                      >
                        <span className="ecosystem-extension-number" aria-hidden="true">
                          0{index + 1}
                        </span>
                        <span className="ecosystem-extension-name">
                          <span>{item.name}</span>
                          <small>{item.short}</small>
                        </span>
                        <span className="ecosystem-extension-symbol" aria-hidden="true">
                          {isExpanded ? '−' : '+'}
                        </span>
                      </button>
                    </h4>
                    <div
                      id={panelId}
                      className="ecosystem-extension-detail"
                      role="region"
                      aria-labelledby={`${panelId}-toggle`}
                      hidden={!isExpanded}
                    >
                      <span className="ecosystem-extension-category" aria-hidden="true">
                        {extension.label}
                      </span>
                      <p>{item.detail}</p>
                      <p className="ecosystem-extension-entry">
                        <span>{text.entryLabel}</span>
                        {item.entry}
                      </p>
                      <a
                        className="text-link"
                        href={`${REPOSITORY}/blob/main/extensions/${extension.id}/README.md`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {text.documentation} <span aria-hidden="true">↗</span>
                      </a>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="ecosystem-extra">
              <span>{text.extraCopy}</span>
              <a href={`${REPOSITORY}/blob/main/extensions/ai-assist/README.md`}>
                {text.extraLink} <span aria-hidden="true">↗</span>
              </a>
            </p>
          </div>
        </div>

        <div className="ecosystem-bridge-heading">
          <p className="eyebrow">{text.bridgeEyebrow}</p>
          <h3>{text.bridgeTitle}</h3>
          <p className="section-copy">{text.bridgeCopy}</p>
        </div>
        <div className="ecosystem-connection-spread">
          <article className="ecosystem-api" aria-labelledby={`${id}-api-title`}>
            <p className="eyebrow">{text.apiKicker}</p>
            <h4 id={`${id}-api-title`}>{text.apiTitle}</h4>
            <p className="ecosystem-api-copy">{text.apiCopy}</p>
            <figure className="ecosystem-code">
              <figcaption>
                <span aria-hidden="true">HTTP / GET</span>
                <span>{text.apiExample}</span>
              </figcaption>
              <pre>
                <code>{sample}</code>
              </pre>
            </figure>
            <p className="ecosystem-api-scopes">{text.apiScopes}</p>
            <a
              className="text-link"
              href={`${REPOSITORY}/blob/main/clients/README.md`}
              target="_blank"
              rel="noreferrer"
            >
              {text.apiLink} <span aria-hidden="true">↗</span>
            </a>
          </article>

          <article className="ecosystem-astrbot" aria-labelledby={`${id}-chat-title`}>
            <p className="eyebrow">{text.chatKicker}</p>
            <h4 id={`${id}-chat-title`}>{text.chatTitle}</h4>
            <p className="ecosystem-chat-copy">{text.chatCopy}</p>
            <div className="ecosystem-command-picker" role="group" aria-label={text.commandLabel}>
              {commands.map((item) => (
                <button
                  type="button"
                  key={item}
                  aria-pressed={command === item}
                  onClick={() => setCommand(item)}
                >
                  {text.commandNames[item]}
                </button>
              ))}
            </div>
            <figure className="ecosystem-conversation">
              <div className="ecosystem-message ecosystem-message--you">
                <span>{text.you}</span>
                <p>{text.commandInput[command]}</p>
              </div>
              <div className="ecosystem-message ecosystem-message--mio" aria-live="polite">
                <span>MIO / {text.exampleReply}</span>
                <p>{text.commandResponse[command]}</p>
              </div>
              <figcaption>{text.sampleLabel}</figcaption>
            </figure>
            <p className="ecosystem-chat-scopes">{text.chatScopes}</p>
            <a
              className="text-link"
              href={`${REPOSITORY}/tree/main/clients/astrbot_mio`}
              target="_blank"
              rel="noreferrer"
            >
              {text.chatLink} <span aria-hidden="true">↗</span>
            </a>
          </article>
        </div>
      </div>
    </section>
  );
}
