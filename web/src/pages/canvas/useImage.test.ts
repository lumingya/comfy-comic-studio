import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useImage } from './useImage';

afterEach(() => vi.unstubAllGlobals());

it('does not use the previously selected artwork while another image is loading', () => {
  const images: { src: string; onload: (() => void) | null }[] = [];
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      onload: (() => void) | null = null;
      constructor() {
        images.push(this);
      }
    },
  );
  const { result, rerender } = renderHook(({ src }) => useImage(src), {
    initialProps: { src: 'first' },
  });
  act(() => images[0].onload?.());
  expect(result.current?.src).toBe('first');
  rerender({ src: 'second' });
  expect(result.current).toBeNull();
  expect(images[0].onload).toBeNull();
  act(() => images[1].onload?.());
  expect(result.current?.src).toBe('second');
});
