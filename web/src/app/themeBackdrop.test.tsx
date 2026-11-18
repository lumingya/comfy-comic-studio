import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeBackdrop } from './themeBackdrop';

describe('theme image motion', () => {
  it('pauses animated images while preserving static image backgrounds', () => {
    const { rerender } = render(
      <ThemeBackdrop
        background={{
          kind: 'image',
          url: '/animated.gif',
          opacity: 0.4,
          animated: true,
        }}
        opacity={0.4}
        paused
      />,
    );
    expect(document.body.querySelector('.theme-backdrop img')).toBeNull();

    rerender(
      <ThemeBackdrop
        background={{
          kind: 'image',
          url: '/static.png',
          opacity: 0.4,
          animated: false,
        }}
        opacity={0.4}
        paused
      />,
    );
    expect(document.body.querySelector('.theme-backdrop img')).toHaveAttribute(
      'src',
      '/static.png',
    );
  });
});
