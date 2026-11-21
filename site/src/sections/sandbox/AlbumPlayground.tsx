import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { artworks } from '../../shared/artwork';
import type { SectionProps } from '../../shared/types';

const templates = [
  { id: 'monograph', name: 'Monograph', 'zh-CN': '典藏画集', en: 'Gallery edition' },
  { id: 'nocturne', name: 'Nocturne', 'zh-CN': '暗房放映', en: 'After dark' },
  { id: 'folio', name: 'Folio', 'zh-CN': '精装对页', en: 'A bound volume' },
  { id: 'zine', name: 'Zine', 'zh-CN': '独立志', en: 'Small-press stories' },
  { id: 'contact', name: 'Contact Sheet', 'zh-CN': '分镜联系表', en: 'On the light table' },
] as const;

const themes = [
  { id: 'paper', 'zh-CN': '暖纸', en: 'Warm paper' },
  { id: 'sage', 'zh-CN': '鼠尾草', en: 'Sage' },
  { id: 'rose', 'zh-CN': '陶土', en: 'Terracotta' },
] as const;

const copy = {
  'zh-CN': {
    title: '给送信的人',
    edition: '一本作品，五种阅读气质',
    templates: '画册模板',
    selected: '从七个内置模板里，精选五种在这里试阅。',
    theme: '纸面色调',
    view: '阅读方式',
    single: '单页',
    double: '双页',
    responsive: '窄屏会自然转为单页。',
    previous: '上一页',
    next: '下一页',
    contents: '目录',
    reader: '画册试阅，可使用左右方向键翻页',
    keyboard: '点选画册后，可用 ← → 翻页',
    page: '页',
    static: '静态风格演示；这里不提供导出。完整工作室支持离线 HTML 画册等导出格式。',
    caption: '给送信的人 / 示例短篇',
  },
  en: {
    title: 'For the one who brings letters',
    edition: 'One story, five ways to read',
    templates: 'Album templates',
    selected: 'Try five selections from the seven built-in templates.',
    theme: 'Paper palette',
    view: 'Reading view',
    single: 'Single',
    double: 'Spread',
    responsive: 'Small screens naturally show one page.',
    previous: 'Previous page',
    next: 'Next page',
    contents: 'Contents',
    reader: 'Album preview, use left and right arrow keys to turn pages',
    keyboard: 'Focus the album, then use ← → to turn pages',
    page: 'Page',
    static:
      'A static style preview; no export here. The full studio can export offline HTML albums and other formats.',
    caption: 'For the one who brings letters / A sample story',
  },
};

function useWideReader() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 700px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 700px)');
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}

export function AlbumPlayground({ locale }: SectionProps) {
  const text = copy[locale];
  const [template, setTemplate] = useState<string>('monograph');
  const [theme, setTheme] = useState('paper');
  const [mode, setMode] = useState('double');
  const [page, setPage] = useState(0);
  const [showContents, setShowContents] = useState(false);
  const wide = useWideReader();
  const count = mode === 'double' && wide ? 2 : 1;
  const lastPage = artworks.length - count;
  const currentPage = Math.min(page, lastPage);
  const visible = artworks.slice(currentPage, currentPage + count);
  const turn = (direction: number) =>
    setPage(Math.max(0, Math.min(lastPage, currentPage + direction * count)));

  function onReaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      turn(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  return (
    <div className="sandbox-album">
      <div className="sandbox-template-picker" role="group" aria-label={text.templates}>
        {templates.map((item, index) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={template === item.id}
            onClick={() => setTemplate(item.id)}
          >
            <span className="sandbox-template-number">0{index + 1}</span>
            <span>
              <strong>{item.name}</strong>
              <small>{item[locale]}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="sandbox-album-layout">
        <div className="sandbox-theatre">
          <div className="sandbox-theatre-heading">
            <p>{text.title}</p>
            <span>{text.edition}</span>
          </div>
          <div
            className={`sandbox-reader sandbox-template--${template}`}
            data-theme={theme}
            data-view={count === 2 ? 'double' : 'single'}
            data-testid="sandbox-reader"
            role="group"
            tabIndex={0}
            aria-label={text.reader}
            aria-keyshortcuts="ArrowLeft ArrowRight"
            onKeyDown={onReaderKeyDown}
          >
            <div className="sandbox-book">
              {visible.map((art, index) => (
                <figure className="sandbox-leaf" key={art.id}>
                  <div className="sandbox-leaf-running" aria-hidden="true">
                    <span>MIO / {templates.find((item) => item.id === template)?.name}</span>
                    <span>0{currentPage + index + 1}</span>
                  </div>
                  <div className="sandbox-leaf-image">
                    <img src={art.src} alt={art.alt[locale]} loading="lazy" />
                  </div>
                  <figcaption className="sandbox-leaf-caption">
                    <span className="sandbox-leaf-number">0{currentPage + index + 1}</span>
                    <div>
                      <h3>{art.title[locale]}</h3>
                      <p>{art.caption[locale]}</p>
                    </div>
                  </figcaption>
                  <p className="sandbox-leaf-colophon">{text.caption}</p>
                </figure>
              ))}
            </div>
          </div>
          <div className="sandbox-reader-toolbar">
            <button
              type="button"
              onClick={() => turn(-1)}
              disabled={currentPage === 0}
              aria-label={text.previous}
            >
              ←
            </button>
            <output className="sandbox-page-count" aria-live="polite" aria-atomic="true">
              {String(currentPage + 1).padStart(2, '0')}
              {count === 2 ? `–${String(currentPage + 2).padStart(2, '0')}` : ''} /{' '}
              {String(artworks.length).padStart(2, '0')}
            </output>
            <button
              type="button"
              onClick={() => turn(1)}
              disabled={currentPage === lastPage}
              aria-label={text.next}
            >
              →
            </button>
            <button
              type="button"
              className="sandbox-contents-toggle"
              aria-expanded={showContents}
              aria-controls="sandbox-contents"
              onClick={() => setShowContents(!showContents)}
            >
              {text.contents} <span aria-hidden="true">{showContents ? '−' : '+'}</span>
            </button>
          </div>
          {showContents && (
            <div
              id="sandbox-contents"
              className="sandbox-contents"
              role="group"
              aria-label={text.contents}
            >
              {artworks.map((art, index) => (
                <button
                  key={art.id}
                  type="button"
                  aria-current={
                    index >= currentPage && index < currentPage + count ? 'page' : undefined
                  }
                  onClick={() => setPage(Math.min(index, lastPage))}
                >
                  <span>0{index + 1}</span>
                  {art.title[locale]}
                </button>
              ))}
            </div>
          )}
          <p className="sandbox-keyboard-hint">{text.keyboard}</p>
        </div>
        <aside className="sandbox-album-settings" aria-label={text.view}>
          <p className="sandbox-small-note">{text.selected}</p>
          <fieldset>
            <legend>{text.theme}</legend>
            <div className="sandbox-swatches">
              {themes.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`sandbox-swatch sandbox-swatch--${item.id}`}
                  aria-label={item[locale]}
                  aria-pressed={theme === item.id}
                  onClick={() => setTheme(item.id)}
                >
                  <span aria-hidden="true">{theme === item.id ? '✓' : ''}</span>
                </button>
              ))}
            </div>
            <p className="sandbox-setting-value">
              {themes.find((item) => item.id === theme)?.[locale]}
            </p>
          </fieldset>
          <fieldset>
            <legend>{text.view}</legend>
            <div className="sandbox-mode-buttons">
              <button
                type="button"
                aria-pressed={mode === 'single'}
                onClick={() => {
                  setMode('single');
                  setPage(currentPage);
                }}
              >
                {text.single}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'double'}
                onClick={() => {
                  setMode('double');
                  setPage(Math.min(currentPage, artworks.length - (wide ? 2 : 1)));
                }}
              >
                {text.double}
              </button>
            </div>
            <p className="sandbox-small-note">{text.responsive}</p>
          </fieldset>
          <p className="sandbox-album-disclaimer">{text.static}</p>
        </aside>
      </div>
    </div>
  );
}
