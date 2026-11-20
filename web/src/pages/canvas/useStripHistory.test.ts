import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { episode } from '../../test/fixtures';
import { useStripHistory } from './useStripHistory';

describe('canvas edit history', () => {
  it('retains unsaved edits on refresh, branches after undo, and caps history', () => {
    const { result } = renderHook(() => useStripHistory(episode.strip, 3));
    for (let i = 1; i <= 105; i++)
      act(() => result.current.change({ ...episode.strip, width: 800 + i }));
    act(() => result.current.receive({ ...episode.strip, width: 2000 }, 4));
    expect(result.current.strip.width).toBe(905);
    expect(result.current.snapshot().baseRevision).toBe(3);
    for (let i = 0; i < 101; i++) act(() => result.current.undo());
    expect(result.current.strip.width).toBe(805);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.strip.width).toBe(806);
    act(() => result.current.change({ ...episode.strip, width: 950 }));
    expect(result.current.canRedo).toBe(false);
  });

  it('undoing while a save runs stays dirty against the newly stored checkpoint', () => {
    const { result } = renderHook(() => useStripHistory(episode.strip, 3));
    const snapshot = { ...episode.strip, width: 900 };
    act(() => result.current.change(snapshot));
    act(() => result.current.undo());
    expect(result.current.dirty).toBe(false);
    act(() =>
      result.current.acknowledge(
        { strip: snapshot, baseRevision: 3 },
        { ...snapshot, height: 1600 },
      ),
    );
    expect(result.current.dirty).toBe(true);
    expect(result.current.strip.width).toBe(800);
    expect(result.current.snapshot().baseRevision).toBe(4);
    act(() => result.current.redo());
    expect(result.current.strip.height).toBe(1600);
    expect(result.current.dirty).toBe(false);
  });

  it('does not discard history on equivalent server refresh, but accepts a new clean layout', () => {
    const { result } = renderHook(() => useStripHistory(episode.strip, 3));
    const saved = { ...episode.strip, width: 900 };
    act(() => result.current.change(saved));
    act(() => result.current.acknowledge({ strip: saved, baseRevision: 3 }, saved));
    act(() => result.current.receive(structuredClone(saved), 4));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.receive({ ...saved, width: 1000 }, 5));
    expect(result.current.strip.width).toBe(1000);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.snapshot().baseRevision).toBe(5);
  });

  it('updates a clean baseline with identical content and ignores an obsolete receipt', () => {
    const { result } = renderHook(() => useStripHistory(episode.strip, 3));
    const pending = result.current.snapshot();
    act(() => result.current.receive(structuredClone(episode.strip), 4));
    expect(result.current.snapshot().baseRevision).toBe(4);
    act(() => result.current.acknowledge(pending, { ...episode.strip, width: 1500 }));
    expect(result.current.strip.width).toBe(800);
    expect(result.current.snapshot().baseRevision).toBe(4);
    act(() => result.current.receive({ ...episode.strip, width: 1600 }, 3));
    expect(result.current.strip.width).toBe(800);
    expect(result.current.snapshot().baseRevision).toBe(4);
  });
});
