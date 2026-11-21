export type Locale = 'zh-CN' | 'en';

export type SectionProps = {
  locale: Locale;
};

export type LocalizedText = Record<Locale, string>;
