import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import zh from './zh';

export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

function initial(): Locale {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('mio.locale') : null;
  if (saved === 'en' || saved === 'zh-CN') return saved;
  return typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh-CN' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zh }, en: { translation: en } },
  lng: initial(),
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLocale(locale: Locale): void {
  localStorage.setItem('mio.locale', locale);
  void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
}

export default i18n;
