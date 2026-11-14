import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizableSplit } from './ResizableSplit';

let available = 1000;
let resize: () => void;
const key = 'mio.split.test';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

function Layout({ name = 'test' }: { name?: string }) {
  return (
    <ResizableSplit storageKey={name} label="Frames" defaultWidth={240}>
      <nav>Frame list</nav>
      <section>Editor</section>
    </ResizableSplit>
  );
}

beforeEach(() => {
  available = 1000;
  localStorage.clear();
  vi.stubGlobal('innerWidth', 1200);
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('resizable-split') ? available : 0;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ResizableSplit', () => {
  it('drags with a captured mouse pointer, clamps both sides and remembers the committed width', () => {
    render(<Layout />);
    const handle = screen.getByRole('separator');
    const capture = vi.fn();
    Object.assign(handle, { setPointerCapture: capture });
    fireEvent.pointerDown(handle, { pointerId: 3, clientX: 250, button: 0 });
    expect(capture).toHaveBeenCalledWith(3);
    fireEvent.pointerMove(handle, { pointerId: 99, clientX: 900 });
    expect(handle).toHaveAttribute('aria-valuenow', '240');
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 350 });
    expect(handle).toHaveAttribute('aria-valuenow', '340');
    expect(localStorage.getItem(key)).toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 2000 });
    expect(handle).toHaveAttribute('aria-valuenow', '560');
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: -2000 });
    expect(handle).toHaveAttribute('aria-valuenow', '170');
    fireEvent.pointerUp(handle, { pointerId: 3 });
    expect(localStorage.getItem(key)).toBe('170');
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 400 });
    expect(handle).toHaveAttribute('aria-valuenow', '170');
  });

  it('supports touch pointers and restores the preference when a gesture is cancelled', () => {
    localStorage.setItem(key, '300');
    render(<Layout />);
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, { pointerId: 2, pointerType: 'touch', clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 2, pointerType: 'touch', clientX: 440 });
    expect(handle).toHaveAttribute('aria-valuenow', '440');
    fireEvent.pointerCancel(handle, { pointerId: 2 });
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    expect(localStorage.getItem(key)).toBe('300');
    fireEvent.pointerDown(handle, { pointerId: 2, pointerType: 'touch', clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 2, pointerType: 'touch', clientX: 400 });
    fireEvent.pointerUp(handle, { pointerId: 2 });
    expect(localStorage.getItem(key)).toBe('400');
  });

  it('exposes a labelled separator and keyboard limits while reserving editor space', () => {
    available = 800;
    render(<Layout />);
    const handle = screen.getByRole('separator', { name: /Frames/ });
    expect(document.getElementById(handle.getAttribute('aria-controls')!)).toHaveTextContent(
      'Frame list',
    );
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '250');
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(handle).toHaveAttribute('aria-valuenow', '290');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '280');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle).toHaveAttribute('aria-valuenow', '416');
    expect(handle).toHaveAttribute('aria-valuemax', '416');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle).toHaveAttribute('aria-valuenow', '170');
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(handle).toHaveAttribute('aria-valuenow', '240');
  });

  it('restores widths independently per page and resets with a double click', () => {
    const first = render(<Layout />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight', shiftKey: true });
    first.unmount();
    const other = render(<Layout name="other" />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '240');
    other.unmount();
    render(<Layout />);
    const handle = screen.getByRole('separator');
    expect(handle).toHaveAttribute('aria-valuenow', '280');
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '240');
    expect(localStorage.getItem(key)).toBe('240');
  });

  it('adapts to container size, stacks when necessary and restores the saved desktop width', () => {
    localStorage.setItem(key, '500');
    render(<Layout />);
    const handle = screen.getByRole('separator');
    available = 700;
    act(() => resize());
    expect(handle).toHaveAttribute('aria-valuenow', '316');
    expect(localStorage.getItem(key)).toBe('500');
    available = 500;
    act(() => resize());
    expect(screen.queryByRole('separator')).toBeNull();
    expect(handle).toHaveAttribute('tabindex', '-1');
    expect(handle.parentElement).toHaveAttribute('data-stacked', 'true');
    available = 1100;
    act(() => resize());
    expect(handle).toHaveAttribute('aria-valuenow', '500');
    expect(screen.getByRole('separator')).toBe(handle);
    vi.stubGlobal('innerWidth', 750);
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('ignores malformed saved values and works when persistence is unavailable', () => {
    localStorage.setItem(key, 'NaN');
    const first = render(<Layout />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '240');
    first.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    render(<Layout />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '250');
  });
});
