import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSelection } from './selection';

const order = ['a', 'b', 'c', 'd', 'e'];

describe('useSelection', () => {
  it('plain click selects one, ctrl toggles, shift ranges from the anchor', () => {
    const { result } = renderHook(() => useSelection(order));
    act(() => result.current.click('b'));
    expect(result.current.ids).toEqual(['b']);
    act(() => result.current.click('d', { ctrlKey: true }));
    expect(result.current.ids).toEqual(['b', 'd']);
    act(() => result.current.click('a', { shiftKey: true })); // anchor is d
    expect(result.current.ids).toEqual(['a', 'b', 'c', 'd']);
    act(() => result.current.click('e', { shiftKey: true, ctrlKey: true })); // adds d..e
    expect(result.current.ids).toEqual(['a', 'b', 'c', 'd', 'e']);
    act(() => result.current.click('b', { metaKey: true }));
    expect(result.current.ids).toEqual(['a', 'c', 'd', 'e']);
  });

  it('select all / clear, and forgets ids that leave the list', () => {
    let ids = order;
    const { result, rerender } = renderHook(() => useSelection(ids));
    act(() => result.current.all());
    expect(result.current.ids).toEqual(order);
    ids = ['a', 'c'];
    rerender();
    expect(result.current.ids).toEqual(['a', 'c']);
    act(() => result.current.clear());
    expect(result.current.ids).toEqual([]);
  });

  it('right-click keeps a multi-selection that contains the target, otherwise retargets', () => {
    const { result } = renderHook(() => useSelection(order));
    act(() => result.current.click('a'));
    act(() => result.current.click('c', { shiftKey: true }));
    let target: string[] = [];
    act(() => {
      target = result.current.contextTarget('b');
    });
    expect(target).toEqual(['a', 'b', 'c']);
    act(() => {
      target = result.current.contextTarget('e');
    });
    expect(target).toEqual(['e']);
    expect(result.current.ids).toEqual(['e']);
  });
});
