import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { AutoSaveGuard, useAutoDraft } from './useAutoDraft';
import { useAutosave } from './autosave';
import { confirm } from '../components/confirm';
vi.mock('../components/confirm', () => ({ confirm: vi.fn().mockResolvedValue(false) }));
beforeEach(() => vi.mocked(confirm).mockReset().mockResolvedValue(false));
afterEach(() => vi.useRealTimers());

describe('recoverable automatic drafts', () => {
  it('captures synchronous validation errors as dirty failures and allows a retry', async () => {
    const save = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('invalid');
      })
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));
    act(() => result.current.touch());
    await act(async () => {
      await expect(result.current.flush()).rejects.toThrow('invalid');
    });
    expect(result.current.state).toBe('error');
    expect(result.current.busy()).toBe(true);
    await act(() => result.current.flush());
    expect(result.current.state).toBe('saved');
    expect(result.current.busy()).toBe(false);
  });
  it('merges consecutive field edits, serializes requests and keeps newer input after an older response', async () => {
    let resolve!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoDraft({ prompt: '', negative: '' }, save));
    act(() => {
      result.current.change((p) => ({ ...p, prompt: 'new prompt' }));
      result.current.change((p) => ({ ...p, negative: 'new negative' }));
    });
    let done!: Promise<void>;
    act(() => {
      done = result.current.flushAll();
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual({ prompt: 'new prompt', negative: 'new negative' });
    act(() => result.current.change((p) => ({ ...p, prompt: 'latest prompt' })));
    await act(async () => {
      resolve();
      await done;
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ prompt: 'latest prompt', negative: 'new negative' });
  });
  it('preserves a failed draft through background refresh, then flushes it on retry', async () => {
    let initial = { value: 'server' };
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(() => useAutoDraft(initial, save));
    act(() => result.current.change({ value: 'typed locally' }));
    await act(async () => {
      await result.current.flushAll().catch(() => {});
    });
    initial = { value: 'background update' };
    rerender();
    expect(result.current.value.value).toBe('typed locally');
    await act(() => result.current.flushAll());
    expect(save).toHaveBeenLastCalledWith({ value: 'typed locally' });
  });
  it('flushes a pending synchronous-ref update even when unmounting immediately', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutoDraft({ value: '' }, save));
    act(() => result.current.change({ value: 'last keystroke' }));
    unmount();
    await waitFor(() => expect(save).toHaveBeenCalledWith({ value: 'last keystroke' }));
  });
  it('keeps the editor and input when a route-change save fails and discard is declined', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    function Editor() {
      const draft = useAutoDraft<string>('', save);
      return (
        <>
          <AutoSaveGuard save={draft} includeSearch />
          <input
            aria-label="draft"
            value={draft.value}
            onChange={(e) => draft.change(e.target.value)}
          />
          <Link to="/done">离开</Link>
        </>
      );
    }
    const router = createMemoryRouter([
      { path: '/', element: <Editor /> },
      { path: '/done', element: <p>done</p> },
    ]);
    render(<RouterProvider router={router} />);
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'do not lose me' } });
    fireEvent.click(screen.getByText('离开'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByLabelText('draft')).toHaveValue('do not lose me');
  });
});
