import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../app/icons';
import type { PresentationDrawerProps } from './exportTypes';

export function AlbumTemplatePicker(
  props: Pick<
    PresentationDrawerProps,
    'templates' | 'infos' | 'look' | 'draft' | 'onLook' | 'episodeId'
  > & {
    accent: string;
    onPreview: () => void;
  },
) {
  const { t } = useTranslation();
  const { draft: d, accent } = props;
  return (
    <section className="export-template-picker">
      <div className="export-template-picker-head">
        <span className="label">{t('exportUi.layout')}</span>
        <button
          type="button"
          className="btn ghost sm"
          disabled={!props.episodeId}
          onClick={() => props.onPreview()}
        >
          <Icon name="eye" sm />
          {t('reader.templatePreview.open')}
        </button>
      </div>
      <div className="export-template-cards" role="group" aria-label={t('exportUi.layout')}>
        {props.templates.map((template) => {
          const info = props.infos.find((item) => item.id === template.id);
          const layout = info?.layout ?? template.layout ?? 'webtoon';
          const selected = props.look === template.id;
          const palette = {
            ...(info?.options ?? {
              accent: template.accent ?? accent,
              background: '#ece9e3',
              paper: '#fffdf7',
              text: '#292827',
            }),
            accent:
              selected && d.themeColor
                ? d.themeColor
                : (info?.options.accent ?? template.accent ?? accent),
          };
          const layoutName =
            info?.layout_name ?? template.layoutName ?? t(`reader.studio.layouts.${layout}`);
          return (
            <button
              type="button"
              key={template.id}
              className={`export-template-card${selected ? ' selected' : ''}`}
              aria-label={template.title}
              aria-pressed={selected}
              onClick={() => props.onLook(template.id)}
            >
              <span
                className={`export-template-thumb layout-${layout}`}
                aria-hidden="true"
                style={
                  {
                    '--thumb-bg': palette.background,
                    '--thumb-paper': palette.paper,
                    '--thumb-accent': palette.accent,
                    '--thumb-text': palette.text,
                  } as CSSProperties
                }
              >
                <i />
                <i />
                <i />
              </span>
              <span className="export-template-card-copy">
                <strong>{template.title}</strong>
                <small className="export-template-layout">{layoutName}</small>
              </span>
              <span className="export-template-swatches" aria-hidden="true">
                <i style={{ backgroundColor: palette.accent }} />
                <i style={{ backgroundColor: palette.paper }} />
                <i style={{ backgroundColor: palette.background }} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
