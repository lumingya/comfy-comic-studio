import { afterEach, expect, it } from 'vitest';
import i18n, { setLocale } from './index';

afterEach(async () => {
  localStorage.removeItem('mio.locale');
  await i18n.changeLanguage('zh-CN');
});

it('initializes the document language before extension frames read their appearance', () => {
  expect(document.documentElement.lang).toBe(i18n.language);
});

it('synchronizes programmatic and saved locale changes to the document', async () => {
  await i18n.changeLanguage('en');
  expect(document.documentElement.lang).toBe('en');
  setLocale('zh-CN');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(localStorage.getItem('mio.locale')).toBe('zh-CN');
});
