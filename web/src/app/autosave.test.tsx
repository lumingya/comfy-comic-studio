import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './autosave';

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces edits and never runs two saves at once', async () => {
    let finishFirst = () => {};
    let value = 1;
    const seen: number[] = [];
    const save = vi.fn(() => {
      seen.push(value);
      return seen.length === 1 ? new Promise<void>((r) => (finishFirst = r)) : Promise.resolve();
    });
    const { result } = renderHook(() => useAutosave(save, 500));

    act(() => result.current.touch());
    act(() => result.current.touch());
    expect(result.current.state).toBe('pending');
    await act(async () => vi.advanceTimersByTime(499));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('saving');

    value = 2; // edited while the first save is still running
    act(() => result.current.touch());
    await act(async () => vi.advanceTimersByTime(500));
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirst();
      await settle();
    });
    expect(seen).toEqual([1, 2]);
    expect(result.current.state).toBe('saved');
    expect(result.current.busy()).toBe(false);
  });

  it('keeps a failed save dirty so it is retried', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, 100));
    act(() => result.current.touch());
    await act(async () => {
      await result.current.flush().catch(() => undefined);
    });
    expect(result.current.state).toBe('error');
    expect(result.current.busy()).toBe(true);
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('saved');
  });

  it('flushes a pending edit on unmount and can discard one', async () => {
    const save = vi.fn(() => Promise.resolve());
    const first = renderHook(() => useAutosave(save, 500));
    act(() => first.result.current.touch());
    first.unmount();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useAutosave(save, 500));
    act(() => second.result.current.touch());
    act(() => second.result.current.discard());
    second.unmount();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
