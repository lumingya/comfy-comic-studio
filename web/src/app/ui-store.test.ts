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
      layout: useStudio('layout'),
      script: useStudio('script'),
    }));
    expect(tool.result.current).toEqual({ mode: false, layout: false, script: false });
    act(() => useUI.getState().setStudioMode(true));
    expect(tool.result.current).toEqual({ mode: true, layout: true, script: true });
    act(() => useUI.getState().setStudioFeature('layout', false));
    expect(tool.result.current).toEqual({ mode: true, layout: false, script: true });
    // Leaving Studio mode keeps the per-tool choice for next time.
    act(() => useUI.getState().setStudioMode(false));
    expect(tool.result.current.layout).toBe(false);
    act(() => useUI.getState().setStudioMode(true));
    expect(useUI.getState().studioOff).toEqual(['layout']);
    act(() => useUI.getState().setStudioFeature('layout', true));
    expect(tool.result.current.layout).toBe(true);
  });
});
