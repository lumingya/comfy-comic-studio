import { useTranslation } from 'react-i18next';
import { useUI, DENSITY_OPTS, FONT_SCALE_OPTS, LETTERING_OPTS } from '../../app/ui-store';
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

function SettingSelect<K extends string>(props: {
  label: string;
  value: K;
  options: readonly K[];
  labels: Record<K, string>;
  onChange: (v: K) => void;
}) {
  return (
    <Select
      aria-label={props.label}
      className="appearance-setting"
      value={props.value}
      onChange={props.onChange}
      options={props.options.map((value) => ({ value, label: props.labels[value] }))}
    />
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
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={t('legacy.settings.preferences.reduceMotion')}
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
