import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, useContextMenu } from './ContextMenu';

function Fixture({ onSelect = () => {} }: { onSelect?: () => void }) {
  const menu = useContextMenu<null>();
  const target = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={target} onContextMenu={(event) => menu.open(event, null)}>
        菜单目标
      </button>
      {menu.state ? (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          onClose={menu.close}
          returnFocus={target.current}
          groups={[
            {
              items: [
                { label: '第一项', onSelect },
                { label: '不可用', disabled: true, onSelect },
                { label: '末项', onSelect },
              ],
            },
          ]}
        />
      ) : null}
    </>
  );
}
const open = () => fireEvent.contextMenu(screen.getByRole('button', { name: '菜单目标' }));
afterEach(() => vi.useRealTimers());

describe('context menu keyboard and focus', () => {
  it('Escape is consumed (including the native dialog default), then returns focus', () => {
    render(<Fixture />);
    open();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(document.activeElement!, event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: '菜单目标' })).toHaveFocus();
  });

  it('arrows, Home and End stay in the menu, skip disabled items and activate only once', async () => {
    const onSelect = vi.fn(),
      outside = vi.fn();
    render(<Fixture onSelect={onSelect} />);
    open();
    window.addEventListener('keydown', outside);
    try {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      expect(screen.getByRole('menuitem', { name: '末项' })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      expect(screen.getByRole('menuitem', { name: '第一项' })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'End' });
      expect(screen.getByRole('menuitem', { name: '末项' })).toHaveFocus();
      expect(outside).not.toHaveBeenCalled();
      await userEvent.keyboard('{Enter}');
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      window.removeEventListener('keydown', outside);
    }
  });

  it('ignores opening/layout scrolls and menu-internal scrolling, but closes on a later page scroll', () => {
    vi.useFakeTimers();
    render(<Fixture />);
    open();
    fireEvent.scroll(window);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    vi.advanceTimersByTime(300);
    fireEvent.scroll(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
