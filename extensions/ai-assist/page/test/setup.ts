import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  resources: {
    'zh-CN': { translation: { common: { close: '关闭', cancel: '取消', save: '保存' } } },
  },
});
configure({ asyncUtilTimeout: 3000 });
afterEach(() => cleanup());
