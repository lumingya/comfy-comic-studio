import { useTranslation } from 'react-i18next';
import {
  useUI,
  DENSITY_OPTS,
  FONT_SCALE_OPTS,
  LETTERING_OPTS,
  WALLPAPER_IDLE_TIMEOUTS,
} from '../../app/ui-store';
import { Icon, type IconName } from '../../app/icons';
import { Select } from '../../components/ui';
import type { ReactNode } from 'react';
import './AppearanceSection.css';

function SettingsRow(props: { icon: IconName; title: string; body?: string; control: ReactNode }) {
  return (
    <div className="settings-row appearance-row">
      <Icon name={props.icon} />
      <div className="grow">
        <h3>{props.title}</h3>
        {props.body ? <p>{props.body}</p> : null}
      </div>
      {props.control}
    </div>
  );
}

function SettingSelect<K extends string | number>(props: {
  label: string;
  value: K;
  options: readonly K[];
  labels: Record<K, string>;
  onChange: (v: K) => void;
}) {
  const values = new Map(props.options.map((value) => [String(value), value]));
  return (
    <Select
      aria-label={props.label}
      className="appearance-setting"
      value={String(props.value)}
      onChange={(value) => {
        const selected = values.get(value);
        if (selected !== undefined) props.onChange(selected);
      }}
      options={props.options.map((value) => ({ value: String(value), label: props.labels[value] }))}
    />
  );
}

function SettingSwitch(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={props.label}
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

/**
 * 外观与阅读 (legacy appearance tab): interface language, lettering style, display density,
 * font scale, reduce motion, and default reading mode — grouped like the legacy
 * preferences-workbench (语言与常规, 字体与界面显示, 阅读与翻页).
 */
export function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const setLocale = (lang: string) => {
    try {
      localStorage.setItem('mio.locale', lang);
    } catch {
      /* ignore */
    }
    i18n.changeLanguage(lang);
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  };
  const {
    setDensity,
    setFontScale,
    setReduceMotion,
    setLettering,
    setDefaultReaderMode,
    setPauseWallpaperWhenUnfocused,
    setWallpaperIdleTimeout,
    setThemeBackgroundPaused,
  } = useUI.getState();
  const density = useUI((s) => s.density);
  const fontScale = useUI((s) => s.fontScale);
  const reduceMotion = useUI((s) => s.reduceMotion);
  const pauseWallpaperWhenUnfocused = useUI((s) => s.pauseWallpaperWhenUnfocused);
  const wallpaperIdleTimeout = useUI((s) => s.wallpaperIdleTimeout);
  const staticWallpaper = useUI((s) => s.themeBackgroundPaused);
  const lettering = useUI((s) => s.lettering);
  const defaultReaderMode = useUI((s) => s.defaultReaderMode);
  return (
    <>
      <section className="settings-section">
        <h2>{t('legacy.settings.preferences.displayTitle')}</h2>
        <SettingsRow
          icon="list"
          title={t('legacy.settings.preferences.lettering')}
          body={t('legacy.settings.preferences.letteringHint')}
          control={
            <SettingSelect
              label={t('legacy.settings.preferences.lettering')}
              value={lettering}
              options={LETTERING_OPTS}
              labels={{
                editorial: t('legacy.settings.preferences.letteringEditorial'),
                calligraphy: t('legacy.settings.preferences.letteringCalligraphy'),
                classic: t('legacy.settings.preferences.letteringClassic'),
              }}
              onChange={setLettering}
            />
          }
        />
        <SettingsRow
          icon="expand"
          title={t('legacy.settings.preferences.fontScale')}
          control={
            <SettingSelect
              label={t('legacy.settings.preferences.fontScale')}
              value={fontScale}
              options={FONT_SCALE_OPTS}
              labels={{
                standard: t('legacy.settings.preferences.fontScaleStandard'),
                large: t('legacy.settings.preferences.fontScaleLarge'),
                xlarge: t('legacy.settings.preferences.fontScaleXlarge'),
              }}
              onChange={setFontScale}
            />
          }
        />
        <SettingsRow
          icon="list"
          title={t('legacy.settings.preferences.density')}
          control={
            <SettingSelect
              label={t('legacy.settings.preferences.density')}
              value={density}
              options={DENSITY_OPTS}
              labels={{
                comfortable: t('legacy.settings.preferences.densityComfortable'),
                compact: t('legacy.settings.preferences.densityCompact'),
              }}
              onChange={setDensity}
            />
          }
        />
        <SettingsRow
          icon="book"
          title={t('legacy.settings.preferences.reduceMotion')}
          control={
            <SettingSwitch
              label={t('legacy.settings.preferences.reduceMotion')}
              checked={reduceMotion}
              onChange={setReduceMotion}
            />
          }
        />
      </section>
      <section className="settings-section">
        <h2>{t('settings.themes.wallpaperMotion')}</h2>
        <SettingsRow
          icon="image"
          title={t('settings.themes.wallpaperIdleTimeout')}
          control={
            <SettingSelect
              label={t('settings.themes.wallpaperIdleTimeout')}
              value={wallpaperIdleTimeout}
              options={WALLPAPER_IDLE_TIMEOUTS}
              labels={{
                0: t('settings.themes.wallpaperIdleOff'),
                30: t('settings.themes.wallpaperIdle30Seconds'),
                60: t('settings.themes.wallpaperIdle1Minute'),
                180: t('settings.themes.wallpaperIdle3Minutes'),
              }}
              onChange={setWallpaperIdleTimeout}
            />
          }
        />
        <SettingsRow
          icon="image"
          title={t('settings.themes.pauseWallpaperWhenUnfocused')}
          control={
            <SettingSwitch
              label={t('settings.themes.pauseWallpaperWhenUnfocused')}
              checked={pauseWallpaperWhenUnfocused}
              onChange={setPauseWallpaperWhenUnfocused}
            />
          }
        />
        <SettingsRow
          icon="image"
          title={t('settings.themes.staticWallpaper')}
          body={t('settings.themes.staticWallpaperHint')}
          control={
            <SettingSwitch
              label={t('settings.themes.staticWallpaper')}
              checked={staticWallpaper}
              onChange={setThemeBackgroundPaused}
            />
          }
        />
      </section>
      <section className="settings-section">
        <h2>{t('legacy.settings.preferences.readerTitle')}</h2>
        <SettingsRow
          icon="book"
          title={t('legacy.settings.preferences.defaultReaderMode')}
          control={
            <SettingSelect
              label={t('legacy.settings.preferences.defaultReaderMode')}
              value={defaultReaderMode}
              options={['webtoon', 'spread', 'gallery']}
              labels={{
                webtoon: t('legacy.settings.preferences.readerModeWebtoon'),
                spread: t('legacy.settings.preferences.readerModeSpread'),
                gallery: t('legacy.settings.preferences.readerModeGallery'),
              }}
              onChange={setDefaultReaderMode}
            />
          }
        />
      </section>
      <section className="settings-section">
        <h2>{t('legacy.settings.preferences.languageTitle')}</h2>
        <div className="field">
          <label className="label" htmlFor="ui-language">
            {t('legacy.settings.language')}
          </label>
          <Select
            id="ui-language"
            value={i18n.language === 'en' ? 'en' : 'zh-CN'}
            onChange={setLocale}
            options={[
              { value: 'zh-CN', label: '简体中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>
      </section>
    </>
  );
}
