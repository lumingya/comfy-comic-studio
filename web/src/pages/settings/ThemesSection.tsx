import { Check, Monitor, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDeleteTheme, useImportTheme, useThemes, type ThemeInfo } from '../../api/open';
import { SYSTEM } from '../../app/theme';
import { useUI } from '../../app/ui-store';
import { toast, toastError } from '../../components/toast';
import { FilePick, Loading } from '../../components/ui';

/** A miniature app window painted with the theme's own tokens. */
function Preview({ tokens }: { tokens: Record<string, string> }) {
  return (
    <div className="theme-preview" style={{ background: tokens.bg, borderColor: tokens.line }}>
      <div className="theme-preview-rail" style={{ background: tokens['bg-deep'] }}>
        <i style={{ background: tokens.accent }} />
        <i style={{ background: tokens.muted }} />
        <i style={{ background: tokens.muted }} />
      </div>
      <div className="theme-preview-body">
        <div
          className="theme-preview-card"
          style={{ background: tokens.panel, borderColor: tokens.line }}
        >
          <b style={{ background: tokens.text }} />
          <s style={{ background: tokens.soft }} />
          <span style={{ background: tokens.accent }} />
        </div>
        <div className="theme-preview-dots">
          {['amber', 'red', 'blue'].map((k) => (
            <i key={k} style={{ background: tokens[k] }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard(props: {
  theme: ThemeInfo;
  active: boolean;
  onPick: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = props;
  return (
    <div className={`theme-card ${props.active ? 'active' : ''}`}>
      <button className="theme-card-main" aria-pressed={props.active} onClick={props.onPick}>
        <Preview tokens={theme.tokens} />
        <div className="row" style={{ gap: 6 }}>
          <strong className="grow">{theme.name}</strong>
          {props.active ? <Check size={14} className="accent-text" /> : null}
        </div>
        <span className="small muted">
          {t(`settings.themes.mode.${theme.mode}`)}
          {theme.author ? ` · ${theme.author}` : ''}
          {theme.source !== 'builtin' ? ` · ${theme.source}` : ''}
        </span>
      </button>
      {props.onDelete ? (
        <button
          className="btn ghost icon sm danger theme-card-delete"
          aria-label={t('common.delete')}
          onClick={props.onDelete}
        >
          <Trash2 size={13} />
        </button>
      ) : null}
    </div>
  );
}

export function ThemesSection() {
  const { t } = useTranslation();
  const themes = useThemes();
  const choice = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const importTheme = useImportTheme();
  const deleteTheme = useDeleteTheme();

  const onFile = async (file: File) => {
    try {
      const body = JSON.parse(await file.text());
      importTheme.mutate(body, {
        onSuccess: (theme) => (
          toast(t('settings.themes.imported')),
          setTheme(theme.id, theme.mode)
        ),
        onError: toastError,
      });
    } catch {
      toastError(new Error(t('settings.themes.badFile')));
    }
  };

  if (themes.isLoading) return <Loading />;
  const list = themes.data ?? [];
  const known = choice === SYSTEM || list.some((th) => th.id === choice);

  return (
    <section className="col" style={{ gap: 14 }}>
      <div className="row">
        <p className="small muted grow" style={{ margin: 0 }}>
          {t('settings.themes.hint')}
        </p>
        <FilePick accept=".json,application/json" onFile={onFile}>
          <Upload size={15} /> {t('settings.themes.import')}
        </FilePick>
      </div>
      <div className="theme-grid">
        <div className={`theme-card ${choice === SYSTEM ? 'active' : ''}`}>
          <button
            className="theme-card-main"
            aria-pressed={choice === SYSTEM}
            onClick={() => setTheme(SYSTEM)}
          >
            <div className="theme-preview theme-preview-system">
              <Monitor size={28} />
            </div>
            <div className="row" style={{ gap: 6 }}>
              <strong className="grow">{t('settings.themes.system')}</strong>
              {choice === SYSTEM ? <Check size={14} className="accent-text" /> : null}
            </div>
            <span className="small muted">{t('settings.themes.systemHint')}</span>
          </button>
        </div>
        {list.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            active={choice === theme.id}
            onPick={() => setTheme(theme.id, theme.mode)}
            onDelete={
              theme.source === 'user'
                ? () =>
                    deleteTheme.mutate(theme.id, {
                      onSuccess: () => choice === theme.id && setTheme(SYSTEM),
                      onError: toastError,
                    })
                : undefined
            }
          />
        ))}
      </div>
      {!known ? <p className="small warn-text">{t('settings.themes.missing')}</p> : null}
    </section>
  );
}
