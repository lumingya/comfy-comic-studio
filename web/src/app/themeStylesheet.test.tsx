import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ThemeInfo } from '../api/open';
import { ThemeStylesheet } from './themeStylesheet';

const theme = (id: string, styleUrl: string): ThemeInfo => ({
  id,
  name: id,
  mode: 'dark',
  author: '',
  source: 'theme-package',
  tokens: {},
  style_url: styleUrl,
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
