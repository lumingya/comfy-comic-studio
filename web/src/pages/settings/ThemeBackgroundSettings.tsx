import { useTranslation } from 'react-i18next';
import type { ThemeInfo } from '../../api/open';
import { useUI } from '../../app/ui-store';

export function ThemeBackgroundSettings({
  themeId,
  background,
}: {
  themeId: string;
  background: ThemeInfo['background'];
}) {
  const { t } = useTranslation();
  const active = useUI((s) => s.theme === themeId);
  const savedOpacity = useUI((s) => s.themeOpacity[themeId]);
  const setThemeOpacity = useUI((s) => s.setThemeOpacity);
  const allowVideoWithReducedMotion = useUI((s) => s.allowThemeVideoWithReducedMotion);
  const setAllowVideoWithReducedMotion = useUI((s) => s.setAllowThemeVideoWithReducedMotion);
  if (!background) return null;
  const opacity = savedOpacity ?? background.opacity;

  return (
    <>
      <label className="theme-setting-field">
        <span className="theme-setting-label">{t('settings.themes.backgroundOpacity')}</span>
        <div className="theme-setting-slider">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            aria-label={t('settings.themes.backgroundOpacity')}
            value={opacity}
            onChange={(event) => setThemeOpacity(themeId, Number(event.currentTarget.value))}
          />
          <output>{Math.round(opacity * 100)}%</output>
        </div>
      </label>
      {background.kind === 'video' && active ? (
        <label className="theme-setting-toggle">
          <input
            type="checkbox"
            checked={allowVideoWithReducedMotion}
            onChange={(event) => setAllowVideoWithReducedMotion(event.currentTarget.checked)}
          />
          <span className="theme-setting-field">
            <span className="theme-setting-label">
              {t('settings.themes.playWithReducedMotion')}
            </span>
            <small>{t('settings.themes.playWithReducedMotionHint')}</small>
          </span>
        </label>
      ) : null}
    </>
  );
}
