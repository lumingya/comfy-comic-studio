import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSelection } from './selection';
import { useDesktopSelection } from './useDesktopSelection';

const ORDER = ['a'];

function List({ onOpen }: { onOpen: (id: string) => void }) {
  const selection = useSelection(ORDER);
  const desktop = useDesktopSelection({
    itemAttribute: 'data-selection-id',
    selection,
    enabled: true,
    pinned: false,
    contextOpen: false,
    onExit: selection.clear,
    onOpen,
    onDelete: () => {},
    onContext: () => {},
    onCloseContext: () => {},
  });
  return (
    <div ref={desktop.ref} onClickCapture={desktop.onClickCapture}>
      <article data-selection-id="a">
        <h2>Card</h2>
        <details data-testid="details">
          <summary>展开分幕进度与局部重跑</summary>
          <p>pages</p>
        </details>
        <label>
          <input type="checkbox" /> 勾选
        </label>
      </article>
    </div>
  );
}

describe('useDesktopSelection', () => {
  it('lets <summary> and <label> inside a selectable card keep their own click', () => {
    const onOpen = vi.fn();
    render(<List onOpen={onOpen} />);
    // fireEvent returns false when a handler called preventDefault (the toggle would not happen).
    expect(fireEvent.click(screen.getByText('展开分幕进度与局部重跑'))).toBe(true);
    expect(fireEvent.click(screen.getByText('勾选'))).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
    // A click on the card body itself is still the card's.
    expect(fireEvent.click(screen.getByText('Card'))).toBe(false);
    expect(onOpen).toHaveBeenCalledWith('a');
  });
});
