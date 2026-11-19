import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ThemeInfo } from '../api/open';
import { ThemeStylesheet } from './themeStylesheet';
import { readThemeDiagnostics } from './themeDiagnostics';

afterEach(() => {
  cleanup();
  sessionStorage.removeItem('mio.diagnostics');
  readThemeDiagnostics();
});

const theme = (id: string, styleUrl: string): ThemeInfo => ({
  id,
  name: id,
  mode: 'dark',
  author: '',
  source: 'theme-package',
  tokens: {},
  style_url: styleUrl,
});

it('reports stylesheet load failures only when enabled and removes diagnostic listeners on cleanup', () => {
  sessionStorage.setItem('mio.diagnostics', 'true');
  const view = render(<ThemeStylesheet theme={theme('linen', '/api/themes/linen/style')} />);
  const link = document.querySelector('link[data-mio-theme]')!;
  fireEvent.error(link);
  expect(readThemeDiagnostics().map((entry) => entry.code)).toEqual([
    'style-loading',
    'style-load-error',
  ]);
  view.unmount();
  fireEvent.error(link);
  expect(readThemeDiagnostics().map((entry) => entry.code)).toEqual([
    'style-loading',
    'style-load-error',
    'style-cleaned',
  ]);
});

it('records successful stylesheet loading and opt-out removes runtime history', () => {
  sessionStorage.setItem('mio.diagnostics', 'true');
  render(<ThemeStylesheet theme={theme('linen', '/api/themes/linen/style')} />);
  fireEvent.load(document.querySelector('link[data-mio-theme]')!);
  expect(readThemeDiagnostics().map((entry) => entry.code)).toEqual([
    'style-loading',
    'style-loaded',
  ]);
  sessionStorage.removeItem('mio.diagnostics');
  expect(window.mioThemeDiagnostics).toEqual([]);
});

it('replaces and removes the previous theme stylesheet', () => {
  const view = render(<ThemeStylesheet theme={theme('linen', '/api/themes/linen/style')} />);
  expect(document.head.querySelectorAll('link[data-mio-theme]')).toHaveLength(1);
  expect(document.head.querySelector('link[data-mio-theme="linen"]')?.getAttribute('href')).toBe(
    '/api/themes/linen/style',
  );

  view.rerender(<ThemeStylesheet theme={theme('night', '/api/themes/night/style')} />);
  expect(document.head.querySelector('link[data-mio-theme="linen"]')).toBeNull();
  expect(document.head.querySelector('link[data-mio-theme="night"]')?.getAttribute('href')).toBe(
    '/api/themes/night/style',
  );

  view.unmount();
  expect(document.head.querySelector('link[data-mio-theme]')).toBeNull();
});
