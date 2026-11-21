import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { artworks } from '../../shared/artwork';
import type { SectionProps } from '../../shared/types';

const copy = {
  'zh-CN': {
    eyebrow: '同一幅画面，把选择看清楚',
    title: '决定采用之前，拉近一点。',
    intro:
      '拖动分界，体验候选图的并排比较。左侧只是将同一张图调暗，右侧保留原图；这是 CSS 处理示意，非真实重绘。',
    before: '灰暗示意',
    after: '正常原图',
    slider: '比较分界位置',
    hint: '拖动画面中的分界，或聚焦画面后使用方向键。',
    image: '送信人的同一幅画面，左侧为灰暗处理，右侧为正常原图',
    demonstration: '同一幅图片 · CSS 示意，非真实重绘',
    strip: '让故事向下流动。',
    stripLabel: '条漫预览',
    stripNote: '四幕，留一点呼吸的空白。向下滚动试读。',
    ending: '未完，留给你的故事。',
  },
  en: {
    eyebrow: 'One image, a closer look at the choice',
    title: 'Look closer before you adopt.',
    intro:
      'Drag the divider to try a candidate comparison. The left side darkens the same image; the right keeps the original. This is a CSS illustration, not a real redraw.',
    before: 'Darkened example',
    after: 'Original image',
    slider: 'Comparison divider position',
    hint: 'Drag the divider in the image, or focus it and use the arrow keys.',
    image: 'The same letter-carrier illustration, darkened on the left and original on the right',
    demonstration: 'One image · CSS illustration, not a real redraw',
    strip: 'Let the story flow down.',
    stripLabel: 'Vertical comic preview',
    stripNote: 'Four scenes, with room to breathe. Scroll to read.',
    ending: 'The next chapter is yours.',
  },
};

export function ComparisonPlayground({ locale }: SectionProps) {
  const text = copy[locale];
  const id = useId();
  const [position, setPosition] = useState(50);
  return (
    <div className="sandbox-comparison">
      <div className="sandbox-demo-heading">
        <p className="eyebrow">{text.eyebrow}</p>
        <h3>{text.title}</h3>
        <p>{text.intro}</p>
      </div>
      <div className="sandbox-comparison-grid">
        <div className="sandbox-compare-main">
          <div
            className="sandbox-compare-image"
            data-testid="sandbox-comparison-image"
            style={{ '--sandbox-divider': `${position}%` } as CSSProperties}
          >
            <img src={artworks[0].src} alt={text.image} loading="lazy" />
            <img
              className="sandbox-compare-before"
              src={artworks[0].src}
              alt=""
              aria-hidden="true"
              loading="lazy"
            />
            <span className="sandbox-compare-line" aria-hidden="true">
              <span>↔</span>
            </span>
            <div className="sandbox-compare-labels" aria-hidden="true">
              <span>{text.before}</span>
              <span>{text.after}</span>
            </div>
            <input
              className="sandbox-image-slider"
              id={`${id}-range`}
              type="range"
              min="0"
              max="100"
              step="1"
              value={position}
              onChange={(event) => setPosition(Number(event.target.value))}
              aria-describedby={`${id}-range-hint ${id}-comparison-note`}
            />
          </div>
          <div className="sandbox-comparison-control">
            <div>
              <label htmlFor={`${id}-range`}>{text.slider}</label>
              <output htmlFor={`${id}-range`}>{position}%</output>
            </div>
            <p id={`${id}-range-hint`}>{text.hint}</p>
          </div>
          <p className="sandbox-comparison-note" id={`${id}-comparison-note`}>
            {text.demonstration}
          </p>
        </div>
        <aside className="sandbox-strip-wrap">
          <p className="eyebrow">{text.stripLabel}</p>
          <h4>{text.strip}</h4>
          <p className="sandbox-strip-note">{text.stripNote}</p>
          <div className="sandbox-strip" role="region" aria-label={text.stripLabel} tabIndex={0}>
            <div className="sandbox-strip-title">
              <span>MIO / 001</span>
              <p>{locale === 'zh-CN' ? '给送信的人' : 'For the one who brings letters'}</p>
            </div>
            {artworks.map((art, index) => (
              <figure key={art.id}>
                <img src={art.src} alt={art.alt[locale]} loading="lazy" />
                <figcaption>
                  <span>0{index + 1}</span>
                  {art.caption[locale]}
                </figcaption>
              </figure>
            ))}
            <p className="sandbox-strip-ending">{text.ending}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
