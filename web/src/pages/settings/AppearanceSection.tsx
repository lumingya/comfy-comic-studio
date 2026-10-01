import { useTranslation } from 'react-i18next';
import { useUI, DENSITY_OPTS, FONT_SCALE_OPTS, LETTERING_OPTS } from '../../app/ui-store';
import { Icon, type IconName } from '../../app/icons';
import type { ReactNode } from 'react';

function SettingsRow(props: { icon: IconName; title: string; body: string; control: ReactNode }) {
  return (
    <div className="settings-row">
      <Icon name={props.icon} />
      <div className="grow">
        <h3>{props.title}</h3>
        <p>{props.body}</p>
      </div>
      {props.control}
    </div>
  );
}

function Select<K extends string>(props: {
  id?: string;
  value: K;
  options: readonly K[];
  labels: Record<K, string>;
  onChange: (v: K) => void;
}) {
  return (
    <select
      id={props.id}
      className="inline-setting"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as K)}
    >
      {props.options.map((v) => (
        <option key={v} value={v}>
          {props.labels[v]}
        </option>
      ))}
    </select>
  );
}

/**
 * 通用偏好 (legacy appearance tab): interface language, lettering style, display density,
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
  const { setDensity, setFontScale, setReduceMotion, setLettering, setDefaultReaderMode } =
    useUI.getState();
  const density = useUI((s) => s.density);
  const fontScale = useUI((s) => s.fontScale);
  const reduceMotion = useUI((s) => s.reduceMotion);
  const lettering = useUI((s) => s.lettering);
  const defaultReaderMode = useUI((s) => s.defaultReaderMode);
  return (
    <>
      <section className="settings-section">
        <h2>{t('legacy.settings.preferences.displayTitle')}</h2>
        <p>{t('legacy.settings.preferences.displayHint')}</p>
        <SettingsRow
          icon="list"
          title={t('legacy.settings.preferences.lettering')}
          body={t('legacy.settings.preferences.letteringHint')}
          control={
            <Select
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
          body={t('legacy.settings.preferences.fontScaleHint')}
          control={
            <Select
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
          body={t('legacy.settings.preferences.densityHint')}
          control={
            <Select
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
          body={t('legacy.settings.preferences.reduceMotionHint')}
          control={
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                checked={reduceMotion}
                onChange={(e) => setReduceMotion(e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
            </label>
          }
        />
      </section>
      <section className="settings-section">
        <h2>{t('legacy.settings.preferences.readerTitle')}</h2>
        <p>{t('legacy.settings.preferences.readerHint')}</p>
        <SettingsRow
          icon="book"
          title={t('legacy.settings.preferences.defaultReaderMode')}
          body={t('legacy.settings.preferences.defaultReaderModeHint')}
          control={
            <Select
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
          <select
            id="ui-language"
            className="input"
            value={i18n.language === 'en' ? 'en' : 'zh-CN'}
            onChange={(e) => setLocale(e.target.value)}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>
    </>
  );
}
