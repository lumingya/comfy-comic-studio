import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStudio, useUI } from './ui-store';

afterEach(() => {
  act(() => useUI.setState({ studioMode: false, studioOff: [] }));
});

describe('功能开关', () => {
  it('shows a Studio tool only while Studio mode is on and the tool is not switched off', () => {
    const tool = renderHook(() => ({
      mode: useStudio(),
      variants: useStudio('variants'),
      script: useStudio('script'),
    }));
    expect(tool.result.current).toEqual({ mode: false, variants: false, script: false });
    act(() => useUI.getState().setStudioMode(true));
    expect(tool.result.current).toEqual({ mode: true, variants: true, script: true });
    act(() => useUI.getState().setStudioFeature('variants', false));
    expect(tool.result.current).toEqual({ mode: true, variants: false, script: true });
    // Leaving Studio mode keeps the per-tool choice for next time.
    act(() => useUI.getState().setStudioMode(false));
    expect(tool.result.current.variants).toBe(false);
    act(() => useUI.getState().setStudioMode(true));
    expect(useUI.getState().studioOff).toEqual(['variants']);
    act(() => useUI.getState().setStudioFeature('variants', true));
    expect(tool.result.current.variants).toBe(true);
  });
});
