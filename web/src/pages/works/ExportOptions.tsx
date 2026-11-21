import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useImportAlbumTemplate } from '../../api/open';
import { useExportPresets } from '../../api/production';
import { Icon } from '../../app/icons';
import { QueryError } from '../../app/errors';
import { ConceptHint } from '../../components/ConceptHint';
import { toast, toastError } from '../../components/toast';
import { Field, Select, TextInput, NumberInput } from '../../components/ui';
import { PROFILES, QUALITIES, type ExportDraft, type Profile, type Quality } from './presentation';
import { NATIVE_LAYOUTS, nativeLayout } from './readingStage';
import type { Format, PresentationDrawerProps } from './exportTypes';
import { AlbumTemplatePicker } from './AlbumTemplatePicker';
import { parseTemplateFile } from './templateFile';

export function AlbumExportOptions(
  props: PresentationDrawerProps & {
    format: Format;
    onStudio: () => void;
    onPreview: () => void;
  },
) {
  const { t } = useTranslation();
  const { draft: d, onDraft, format } = props;
  const native = props.look === props.native;
  const rendered = ['html', 'pdf', 'zip'].includes(format);
  const selectedInfo = props.infos.find((x) => x.id === props.look);
  const accent =
    selectedInfo?.options.accent ??
    props.templates.find((x) => x.id === props.look)?.accent ??
    '#8fae8b';
  const theme = d.themeColor || accent;
  const importTpl = useImportAlbumTemplate();
  const file = useRef<HTMLInputElement>(null);
  const importFile = async (f: File) => {
    try {
      const body = parseTemplateFile(await f.text(), f.name, {
        invalid: t('reader.badTemplate'),
        notTemplate: t('reader.notTemplate'),
        badMeta: t('reader.badTemplateMeta'),
        fromHtml: t('reader.templateFromHtml'),
      });
      const template = await importTpl.mutateAsync(body);
      props.onLook(template.id);
      toast(t('reader.imported', { title: template.title }));
    } catch (error) {
      toastError(error);
    }
  };
  return (
    <>
      {format === 'html' ? (
        <>
          <AlbumTemplatePicker {...props} accent={accent} />
          {native ? (
            <Field label={t('reader.readMode')}>
              <Select
                value={props.layout}
                onChange={(value) => props.onLayout(nativeLayout(value))}
                options={NATIVE_LAYOUTS.map((value) => ({
                  value,
                  label: t(`reader.layouts.${value}`),
                }))}
              />
            </Field>
          ) : null}
        </>
      ) : null}
      {rendered ? (
        <>
          {format !== 'pdf' ? (
            <label className="export-check">
              <input
                type="checkbox"
                checked={d.captions}
                onChange={(e) => onDraft({ captions: e.target.checked })}
              />
              {t('exportUi.captions')}
            </label>
          ) : null}
          <div className="concept-hint-field">
            <Field label={t('reader.profile')}>
              <Select
                value={d.profile}
                onChange={(profile) => onDraft({ profile: profile as Profile })}
                options={PROFILES.map((value) => ({
                  value,
                  label: t(`reader.profiles.${value}.label`),
                }))}
              />
            </Field>
            <ConceptHint concept="imageProfiles" />
          </div>
        </>
      ) : null}
      {format === 'html' && !native ? (
        <details className="export-advanced">
          <summary>{t('exportUi.more')}</summary>
          <div className="export-grid">
            <Field label={t('reader.themeColor')}>
              <span className="export-color-row">
                <input
                  type="color"
                  value={theme}
                  onChange={(e) => onDraft({ themeColor: e.target.value })}
                />
                {d.themeColor ? (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => onDraft({ themeColor: '' })}
                  >
                    {t('reader.themeReset')}
                  </button>
                ) : null}
              </span>
            </Field>
            <Field label={t('reader.border')}>
              <NumberInput
                value={d.border}
                min={0}
                max={8}
                onChange={(border) => onDraft({ border: Math.max(0, Math.min(8, border ?? 0)) })}
              />
            </Field>
          </div>
          <Field label={t('reader.signature')}>
            <TextInput
              value={d.signature}
              maxLength={120}
              onChange={(signature) => onDraft({ signature })}
            />
          </Field>
          <label className="export-check">
            <input
              type="checkbox"
              checked={d.prompts}
              onChange={(e) => onDraft({ prompts: e.target.checked })}
            />
            {t('reader.prompts')}
          </label>
        </details>
      ) : null}
      {format === 'html' ? (
        <details className="export-advanced">
          <summary>{t('exportUi.templateTools')}</summary>
          <div className="presentation-tools">
            <button
              type="button"
              className="btn sm"
              disabled={!props.infos.length}
              onClick={() => props.onStudio()}
            >
              <Icon name="edit" sm />
              {t('reader.customize')}
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={importTpl.isPending}
              onClick={() => file.current?.click()}
            >
              <Icon name="upload" sm />
              {t('reader.importTemplate')}
            </button>
            <input
              hidden
              type="file"
              ref={file}
              accept=".html,.htm,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void importFile(f);
              }}
            />
          </div>
        </details>
      ) : null}
    </>
  );
}

export function PlatformExportOptions(props: {
  format: Format;
  draft: ExportDraft;
  onDraft: (patch: Partial<ExportDraft>) => void;
}) {
  const { t } = useTranslation();
  const { format, draft: d, onDraft } = props;
  const presets = useExportPresets();
  const slices = format === 'slices';
  const platform = slices || format === 'long';
  const preset = presets.data?.find((p) => p.id === d.preset);
  return (
    <>
      {platform ? (
        <>
          {slices ? (
            <Field label={t('reader.platform.preset')}>
              <Select
                value={d.preset}
                onChange={(preset) => onDraft({ preset })}
                options={(presets.data ?? [])
                  .filter((p) => p.width > 0)
                  .map((p) => ({ value: p.id, label: p.label }))}
              />
            </Field>
          ) : null}
          <Field label={t('reader.platform.quality')}>
            <Select
              value={d.quality}
              onChange={(quality) => onDraft({ quality: quality as Quality })}
              options={(Object.keys(QUALITIES) as Quality[]).map((value) => ({
                value,
                label: t(`reader.platform.qualities.${value}`),
              }))}
            />
          </Field>
          {slices && preset ? (
            <p className="help">
              {t('reader.platform.spec', {
                width: preset.width,
                height: preset.max_height,
                format: d.quality === 'lossless' ? 'PNG' : preset.format,
              })}
            </p>
          ) : null}
          {slices && presets.isError ? (
            <QueryError error={presets.error} onRetry={presets.refetch} />
          ) : null}
        </>
      ) : null}
    </>
  );
}
