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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('context menu keyboard and focus', () => {
  it('keeps the full-sized menu inside the viewport while its entrance is still scaled', () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(242);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(712);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 242 * 0.96,
      height: 712 * 0.96,
    } as DOMRect);
    render(<Fixture />);
    fireEvent.contextMenu(screen.getByRole('button', { name: '菜单目标' }), {
      clientX: 1200,
      clientY: 600,
    });
    const menu = screen.getByRole('menu');
    expect(Number.parseFloat(menu.style.left) + menu.offsetWidth).toBeLessThanOrEqual(1276);
    expect(Number.parseFloat(menu.style.top) + menu.offsetHeight).toBeLessThanOrEqual(716);
  });

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

  it('scrolls inside the menu and contains boundary wheel gestures without dismissing it', () => {
    vi.useFakeTimers();
    render(<Fixture />);
    open();
    vi.advanceTimersByTime(300);
    const menu = screen.getByRole('menu');
    const item = screen.getByRole('menuitem', { name: '末项' });
    Object.defineProperties(menu, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 600 },
    });
    const wheel = (deltaY: number) => {
      const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
      fireEvent(item, event);
      return event;
    };
    menu.scrollTop = 100;
    expect(wheel(50).defaultPrevented).toBe(false);
    menu.scrollTop = 150;
    fireEvent.scroll(menu);
    fireEvent.touchMove(item);
    expect(screen.getByRole('menu')).toBe(menu);
    menu.scrollTop = 400;
    expect(wheel(50).defaultPrevented).toBe(true);
    expect(screen.getByRole('menu')).toBe(menu);
    menu.scrollTop = 0;
    expect(wheel(-50).defaultPrevented).toBe(true);
    expect(screen.getByRole('menu')).toBe(menu);
    fireEvent.wheel(screen.getByRole('button', { name: '菜单目标' }), { deltaY: 50 });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('still closes on an outside click', () => {
    render(<Fixture />);
    open();
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: '第一项' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: '菜单目标' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
