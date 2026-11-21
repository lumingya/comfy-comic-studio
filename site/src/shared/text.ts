import type { Locale } from './types';

export function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh-CN' ? zh : en;
}
