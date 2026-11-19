import { QueryError } from '../../app/errors';
import { Check, Download, FolderOpen, Monitor, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { download } from '../../api/client';
import {
  useDeleteTheme,
  useImportThemeFolder,
  useImportTheme,
  useImportThemePackage,
  useThemes,
  type ThemeInfo,
} from '../../api/open';
import { SYSTEM } from '../../app/theme';
import { themeScriptKey } from '../../app/themeScript';
import { useUI } from '../../app/ui-store';
import { ContextMenu, useContextMenu } from '../../components/ContextMenu';
import { toast, toastError } from '../../components/toast';
import { Loading } from '../../components/ui';
import './ThemesSection.css';

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
  onExport: () => void;
  exporting: boolean;
  opacity: number;
  onOpacityChange: (value: number) => void;
  scriptEnabled: boolean;
  onScriptEnabledChange: (enabled: boolean) => void;
  backgroundPaused: boolean;
  onBackgroundPausedChange: (paused: boolean) => void;
  allowVideoWithReducedMotion: boolean;
  onAllowVideoWithReducedMotionChange: (allow: boolean) => void;
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
          {theme.source !== 'builtin'
            ? ` · ${t(
                theme.source === 'user'
                  ? 'settings.themes.custom'
                  : theme.source === 'theme-package'
                    ? 'settings.themes.package'
                    : 'settings.themes.extension',
              )}`
            : ''}
        </span>
      </button>
      <div className="theme-card-actions">
        {theme.background?.kind === 'video' && props.active ? (
          <button
            className="btn sm"
            aria-label={t(
              props.backgroundPaused
                ? 'settings.themes.resumeBackground'
                : 'settings.themes.pauseBackground',
            )}
            onClick={() => props.onBackgroundPausedChange(!props.backgroundPaused)}
          >
            {t(
              props.backgroundPaused
                ? 'settings.themes.resumeBackground'
                : 'settings.themes.pauseBackground',
            )}
          </button>
        ) : null}
        <button className="btn sm" disabled={props.exporting} onClick={props.onExport}>
          <Download size={13} /> {t('common.export')}
        </button>
        {props.onDelete ? (
          <button
            className="btn ghost icon sm danger"
            aria-label={t('common.delete')}
            onClick={props.onDelete}
          >
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>
      {theme.background ? (
        <label className="theme-opacity">
          <span>{t('settings.themes.backgroundOpacity')}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            aria-label={t('settings.themes.backgroundOpacity')}
            value={props.opacity}
            onChange={(event) => props.onOpacityChange(Number(event.currentTarget.value))}
          />
          <span className="small muted">{Math.round(props.opacity * 100)}%</span>
        </label>
      ) : null}
      {theme.background?.kind === 'video' && props.active ? (
        <label className="theme-motion-override">
          <input
            type="checkbox"
            checked={props.allowVideoWithReducedMotion}
            onChange={(event) =>
              props.onAllowVideoWithReducedMotionChange(event.currentTarget.checked)
            }
          />
          <span>
            {t('settings.themes.playWithReducedMotion')}
            <small>{t('settings.themes.playWithReducedMotionHint')}</small>
          </span>
        </label>
      ) : null}
      {theme.script_url ? (
        <label className="theme-script-toggle">
          <input
            type="checkbox"
            checked={props.scriptEnabled}
            onChange={(event) => props.onScriptEnabledChange(event.currentTarget.checked)}
          />
          <span>{t('settings.themes.enableScript')}</span>
        </label>
      ) : null}
    </div>
  );
}

export function ThemesSection() {
  const { t } = useTranslation();
  const themes = useThemes();
  const choice = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const themeOpacity = useUI((s) => s.themeOpacity);
  const setThemeOpacity = useUI((s) => s.setThemeOpacity);
  const enabledThemeScripts = useUI((s) => s.enabledThemeScripts);
  const setThemeScriptEnabled = useUI((s) => s.setThemeScriptEnabled);
  const backgroundPaused = useUI((s) => s.themeBackgroundPaused);
  const setBackgroundPaused = useUI((s) => s.setThemeBackgroundPaused);
  const allowVideoWithReducedMotion = useUI((s) => s.allowThemeVideoWithReducedMotion);
  const setAllowVideoWithReducedMotion = useUI(
    (s) => s.setAllowThemeVideoWithReducedMotion,
  );
  const importTheme = useImportTheme();
  const importPackage = useImportThemePackage();
  const importFolder = useImportThemeFolder();
  const deleteTheme = useDeleteTheme();
  const [exporting, setExporting] = useState<string | null>(null);
  const importMenu = useContextMenu<null>();
  const importButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const onExport = async (theme: ThemeInfo) => {
    setExporting(theme.id);
    try {
      await download(`/api/themes/${encodeURIComponent(theme.id)}/package`, `${theme.id}.zip`);
    } catch (error) {
      toastError(error);
    } finally {
      setExporting(null);
    }
  };

  const onFile = async (file: File) => {
    if (file.name.toLowerCase().endsWith('.zip')) {
      importPackage.mutate(file, {
        onSuccess: () => toast(t('settings.themes.imported')),
        onError: toastError,
      });
      return;
    }
    try {
      const body = JSON.parse(await file.text());
      importTheme.mutate(body, {
        onSuccess: () => toast(t('settings.themes.imported')),
        onError: toastError,
      });
    } catch {
      toastError(new Error(t('settings.themes.badFile')));
    }
  };

  const onFolder = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    importFolder.mutate(files, {
      onSuccess: () => toast(t('settings.themes.imported')),
      onError: toastError,
    });
  };

  if (themes.isError) return <QueryError error={themes.error} onRetry={themes.refetch} />;
  if (themes.isLoading) return <Loading />;
  const list = themes.data ?? [];
  const known = choice === SYSTEM || list.some((th) => th.id === choice);

  return (
    <section className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          ref={importButton}
          className="btn"
          aria-haspopup="menu"
          aria-expanded={!!importMenu.state}
          disabled={importFolder.isPending || importTheme.isPending || importPackage.isPending}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            importMenu.openAt(rect.left, rect.bottom + 4, null);
          }}
        >
          <Upload size={15} /> {t('settings.themes.import')}
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".json,.zip"
          disabled={importTheme.isPending || importPackage.isPending || importFolder.isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void onFile(file);
          }}
        />
        <input
          ref={(node) => {
            folderInput.current = node;
            node?.setAttribute('webkitdirectory', '');
          }}
          type="file"
          hidden
          multiple
          onChange={onFolder}
        />
      </div>
      {importMenu.state ? (
        <ContextMenu
          x={importMenu.state.x}
          y={importMenu.state.y}
          title={t('settings.themes.import')}
          groups={[
            {
              items: [
                {
                  label: t('settings.themes.importFiles'),
                  icon: <Upload size={15} />,
                  onSelect: () => fileInput.current?.click(),
                },
                {
                  label: t('settings.themes.importFolder'),
                  icon: <FolderOpen size={15} />,
                  onSelect: () => folderInput.current?.click(),
                },
              ],
            },
          ]}
          onClose={importMenu.close}
          returnFocus={importButton.current}
        />
      ) : null}
      <p className="small muted">{t('settings.themes.resetShortcut')}</p>
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
          </button>
        </div>
        {list.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            active={choice === theme.id}
            onPick={() => setTheme(theme.id, theme.mode)}
            opacity={themeOpacity[theme.id] ?? theme.background?.opacity ?? 0}
            onOpacityChange={(value) => setThemeOpacity(theme.id, value)}
            scriptEnabled={enabledThemeScripts.includes(themeScriptKey(theme) ?? '')}
            onScriptEnabledChange={(enabled) => {
              const key = themeScriptKey(theme);
              if (key) setThemeScriptEnabled(key, enabled);
            }}
            backgroundPaused={backgroundPaused}
            onBackgroundPausedChange={setBackgroundPaused}
            allowVideoWithReducedMotion={allowVideoWithReducedMotion}
            onAllowVideoWithReducedMotionChange={setAllowVideoWithReducedMotion}
            onExport={() => void onExport(theme)}
            exporting={exporting !== null}
            onDelete={
              ['user', 'theme-package'].includes(theme.source)
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
