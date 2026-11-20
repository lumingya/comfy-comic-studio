import { useTranslation } from 'react-i18next';
import type { AlbumTemplateDoc } from '../../api/open';
import { Icon } from '../../app/icons';

const LAYOUTS = [
  'webtoon',
  'manga',
  'artbook',
  'flip',
  'gallery',
  'folio',
  'cinema',
  'editorial',
  'contact',
  'chromatic',
] as const;
const COLORS = ['accent', 'background', 'paper', 'text'] as const;
const SIZES = [
  ['width', 400, 1800],
  ['gap', 0, 100],
  ['radius', 0, 40],
] as const;
export function TemplateEditorFields(props: {
  tpl: AlbumTemplateDoc | null;
  tab: 'design' | 'source';
  builtin: boolean;
  onChange: (template: AlbumTemplateDoc) => void;
}) {
  const { t } = useTranslation();
  const { tpl, tab, builtin } = props;
  const change = (patch: Partial<AlbumTemplateDoc>) => tpl && props.onChange({ ...tpl, ...patch });
  const option = (patch: Partial<AlbumTemplateDoc['options']>) =>
    tpl && props.onChange({ ...tpl, options: { ...tpl.options, ...patch } });
  const hasLoop = !!tpl?.html.includes('{{#books}}');
  const insertLoop = () => {
    if (!tpl || hasLoop) return;
    change({
      html: `${tpl.html}\n{{#books}}\n<section>\n  {{#frames}}<figure><img src="{{image}}" alt=""><figcaption>{{caption}}</figcaption></figure>{{/frames}}\n</section>\n{{/books}}`,
    });
  };

  return (
    <section className="template-edit-fields">
      {!tpl ? (
        <p className="help">{t('reader.studio.loading')}</p>
      ) : tab === 'design' ? (
        <>
          <h3>{t('reader.studio.designHead')}</h3>
          <div className="field">
            <label className="label" htmlFor="et-title">
              {t('reader.studio.name')}
            </label>
            <input
              id="et-title"
              value={tpl.title}
              maxLength={80}
              onChange={(e) => change({ title: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="et-layout">
              {t('reader.studio.layout')}
            </label>
            <select
              id="et-layout"
              value={tpl.layout}
              onChange={(e) => change({ layout: e.target.value as AlbumTemplateDoc['layout'] })}
            >
              {LAYOUTS.map((l) => (
                <option key={l} value={l}>
                  {t(`reader.studio.layouts.${l}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="et-description">
              {t('reader.studio.description')}
            </label>
            <textarea
              id="et-description"
              style={{ minHeight: 64 }}
              value={tpl.description}
              onChange={(e) => change({ description: e.target.value })}
            />
          </div>
          <div className="grid2">
            <div className="field">
              <label className="label" htmlFor="et-author">
                {t('reader.studio.author')}
              </label>
              <input
                id="et-author"
                value={tpl.author}
                onChange={(e) => change({ author: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="et-version">
                {t('reader.studio.version')}
              </label>
              <input
                id="et-version"
                value={tpl.version}
                onChange={(e) => change({ version: e.target.value })}
              />
            </div>
          </div>
          <div className="divider" />
          <h3>{t('reader.studio.paperHead')}</h3>
          <div className="template-colors">
            {COLORS.map((k) => (
              <div className="field" key={k}>
                <span className="label">{t(`reader.studio.colors.${k}`)}</span>
                <div className="color-setting">
                  <input
                    type="color"
                    value={tpl.options[k]}
                    aria-label={t(`reader.studio.colors.${k}`)}
                    onChange={(e) => option({ [k]: e.target.value })}
                  />
                  <span>{tpl.options[k]}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="field">
            <label className="label" htmlFor="et-font">
              {t('reader.studio.font')}
            </label>
            <select
              id="et-font"
              value={tpl.options.font}
              onChange={(e) => option({ font: e.target.value as 'serif' | 'sans' })}
            >
              <option value="serif">{t('reader.studio.fonts.serif')}</option>
              <option value="sans">{t('reader.studio.fonts.sans')}</option>
            </select>
          </div>
          <div className="grid3">
            {SIZES.map(([k, min, max]) => (
              <div className="field" key={k}>
                <label className="label" htmlFor={`et-${k}`}>
                  {t(`reader.studio.sizes.${k}`)}
                </label>
                <input
                  id={`et-${k}`}
                  type="number"
                  min={min}
                  max={max}
                  value={tpl.options[k]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v))
                      option({ [k]: Math.max(min, Math.min(max, Math.round(v))) });
                  }}
                />
              </div>
            ))}
          </div>
          <p className="help">
            {t('reader.studio.variablesHelp', {
              v1: '{{themeColor}}',
              v2: '{{contentWidth}}',
            })}
          </p>
          {builtin ? <p className="help">{t('reader.studio.builtinHelp')}</p> : null}
        </>
      ) : (
        <>
          <div className="row between" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{t('reader.studio.sourceHead')}</h3>
            <button
              type="button"
              className="btn ghost small"
              disabled={hasLoop}
              title={hasLoop ? t('reader.studio.hasLoop') : undefined}
              onClick={insertLoop}
            >
              <Icon name="plus" sm />
              {t('reader.studio.insertLoop')}
            </button>
          </div>
          <p className="template-source-info">
            {t('reader.studio.sourceInfo', { img: '{{image}}' })}
          </p>
          <textarea
            id="et-source"
            className="template-source"
            spellCheck={false}
            aria-label={t('reader.studio.sourceLabel')}
            value={tpl.html}
            onChange={(e) => change({ html: e.target.value })}
          />
          <details className="source-guide">
            <summary>{t('reader.studio.guideTitle')}</summary>
            <p>
              <code>
                {'{{#books}} … {{#frames}} <img src="{{image}}"> {{/frames}} … {{/books}}'}
              </code>
            </p>
            <p>{t('reader.studio.guideLoops', { img: '{{image}}' })}</p>
            <p>
              <code>
                {
                  '{{title}} {{signature}} {{date}} {{themeColor}} {{background}} {{paperColor}} {{textColor}} {{contentWidth}} {{panelGap}} {{imageRadius}} {{bodyFont}} · {{number}} {{name}} {{caption}}'
                }
              </code>
            </p>
            <p>{t('reader.studio.guideSafety')}</p>
          </details>
        </>
      )}
    </section>
  );
}
