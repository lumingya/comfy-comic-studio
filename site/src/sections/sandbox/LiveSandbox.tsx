import { useState } from 'react';
import type { SectionProps } from '../../shared/types';
import { AlbumPlayground } from './AlbumPlayground';
import { ComparisonPlayground } from './ComparisonPlayground';
import { PromptPlayground } from './PromptPlayground';
import './sandbox.css';

const copy = {
  'zh-CN': {
    eyebrow: '02 / 一间可以动手的工作室',
    title: '先翻一页，\n再想一个故事。',
    intro: '不必安装，先感受作品在手里的样子。换一种装帧，装配一组预设，或拉开两张候选之间的分界。',
    tabs: ['翻阅作品', '装配预设', '比较候选'],
    nav: '选择互动演示',
    note: '浏览器里的轻量演示 · 使用静态示例图片 · 不连接生成服务，也不产生费用。',
    boundary: '在自己的工作室生成新图，需要连接 ComfyUI 或云端服务；云端调用可能计费。',
  },
  en: {
    eyebrow: '02 / A studio to try',
    title: 'Turn a page.\nImagine a story.',
    intro:
      'Get a feel for the work before installing anything. Try a different binding, assemble a preset, or slide between two candidate treatments.',
    tabs: ['Read the work', 'Assemble a preset', 'Compare candidates'],
    nav: 'Choose an interactive demo',
    note: 'A lightweight browser demo · Static sample artwork · No generation services or charges.',
    boundary:
      'Generating new images in your own studio requires ComfyUI or a cloud service. Cloud usage may incur charges.',
  },
};

export function LiveSandbox({ locale }: SectionProps) {
  const text = copy[locale];
  const [active, setActive] = useState(0);

  return (
    <section id="playground" className="sandbox" aria-labelledby="sandbox-title">
      <div className="section-shell">
        <div className="sandbox-heading">
          <div>
            <p className="eyebrow">{text.eyebrow}</p>
            <h2 id="sandbox-title" className="section-title">
              {text.title.split('\n').map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h2>
          </div>
          <p className="sandbox-intro">{text.intro}</p>
        </div>

        <div className="sandbox-navigation" role="group" aria-label={text.nav}>
          {text.tabs.map((label, index) => (
            <button
              type="button"
              key={label}
              aria-pressed={active === index}
              aria-controls={`sandbox-panel-${index}`}
              onClick={() => setActive(index)}
            >
              <span aria-hidden="true">0{index + 1}</span>
              {label}
              <span className="sandbox-nav-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>

        <div id="sandbox-panel-0" className="sandbox-panel" hidden={active !== 0}>
          <AlbumPlayground locale={locale} />
        </div>
        <div id="sandbox-panel-1" className="sandbox-panel" hidden={active !== 1}>
          <PromptPlayground locale={locale} />
        </div>
        <div id="sandbox-panel-2" className="sandbox-panel" hidden={active !== 2}>
          <ComparisonPlayground locale={locale} />
        </div>
        <div className="sandbox-footnote">
          <p>
            <span aria-hidden="true">○</span> {text.note}
          </p>
          <p>{text.boundary}</p>
        </div>
      </div>
    </section>
  );
}
