import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShelfReorder } from './useShelfReorder';

type DragOptions = Parameters<typeof useShelfReorder>[0];
type Controller = ReturnType<typeof useShelfReorder>;
type Props = Partial<Omit<DragOptions, 'root' | 'targetsRoot'>> & {
  withTargetsRoot?: boolean;
  onOpen?: () => void;
  controller?: (value: Controller) => void;
};

function Shelf({ withTargetsRoot = true, onOpen, controller, ...options }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const targets = useRef<HTMLDivElement>(null);
  const drag = useShelfReorder({
    root,
    targetsRoot: withTargetsRoot ? targets : undefined,
    enabled: true,
    sortable: true,
    onDrop: vi.fn(),
    ...options,
  });
  controller?.(drag);
  return (
    <main>
      <div ref={targets}>
        <nav>
          <button>All</button>
          <button data-shelf-collection="">Unfiled</button>
          <button data-shelf-collection="stories">
            <span>Stories</span>
          </button>
          <button data-shelf-collection="disabled" disabled>
            Disabled
          </button>
        </nav>
        <div
          ref={root}
          data-testid="shelf"
          onPointerDownCapture={drag.onPointerDownCapture}
          onClickCapture={drag.onClickCapture}
          onKeyDown={drag.onKeyDown}
          onBlurCapture={drag.onBlurCapture}
        >
          {['a', 'b', 'c'].map((id) => (
            <article key={id} data-shelf-id={id} tabIndex={0} onPointerDown={drag.onPointerDown}>
              <button className="shelf-cover" data-shelf-open onClick={onOpen}>
                <img src={`/${id}.png`} alt={`Cover ${id}`} />
              </button>
              <button>Menu {id}</button>
              <h2>{id}</h2>
            </article>
          ))}
          <button data-shelf-collection="inline">Inline collection</button>
        </div>
      </div>
      <button data-shelf-collection="outside">Outside</button>
    </main>
  );
}

class Pointer extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 };
const card = (id = 'a') => document.querySelector<HTMLElement>(`[data-shelf-id="${id}"]`)!;
const cover = (id = 'a') => screen.getByRole('img', { name: `Cover ${id}` });
const ghost = () => document.querySelector('.shelf-drag-ghost');
const start = (init: PointerEventInit = {}, target: HTMLElement = cover()) =>
  fireEvent.pointerDown(target, { ...pointer, clientX: 30, clientY: 100, ...init });
const move = (x = 60, init: PointerEventInit = {}) =>
  fireEvent.pointerMove(window, { ...pointer, buttons: 1, clientX: x, clientY: 100, ...init });
const finish = (init: PointerEventInit = {}) =>
  fireEvent.pointerUp(window, { ...pointer, ...init });
const elementFromPoint = vi.fn<() => Element | null>();
const hit = (name: string) => elementFromPoint.mockReturnValue(screen.getByText(name));

beforeEach(() => {
  vi.stubGlobal('PointerEvent', Pointer);
  elementFromPoint.mockReset().mockReturnValue(null);
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: elementFromPoint,
  });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useShelfReorder', () => {
  it('keeps a short press clickable, then lifts at exactly 6px and suppresses only the release click', () => {
    const onOpen = vi.fn();
    const onDrop = vi.fn();
    render(<Shelf onOpen={onOpen} onDrop={onDrop} />);
    start();
    move(35);
    expect(ghost()).toBeNull();
    expect(elementFromPoint).not.toHaveBeenCalled();
    finish();
    fireEvent.click(cover(), { detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(1);

    elementFromPoint.mockReturnValue(cover('b'));
    start();
    move(36);
    expect(ghost()).toBeInTheDocument();
    expect(card()).toHaveClass('is-dragging');
    expect(card('b')).toHaveClass('is-drop-target');
    finish();
    expect(onDrop).toHaveBeenCalledWith('a', 'b', true, ['a']);
    fireEvent.click(cover('b'), { detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(ghost()).toBeNull();
    expect(card('b')).not.toHaveClass('is-drop-target');
    fireEvent.click(cover('b'), { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('can file a single album without enabling reordering, including a nested target label', () => {
    const onDrop = vi.fn();
    const onCollectionDrop = vi.fn();
    render(<Shelf sortable={false} onDrop={onDrop} onCollectionDrop={onCollectionDrop} />);
    hit('Stories');
    start();
    move();
    expect(ghost()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stories' })).toHaveClass(
      'is-collection-drop-target',
    );
    expect(card('b')).not.toHaveClass('is-drop-target');
    finish();
    expect(onCollectionDrop).toHaveBeenCalledWith(['a'], 'stories');
    expect(onDrop).not.toHaveBeenCalled();
    expect(document.querySelector('.is-collection-drop-target')).toBeNull();
  });

  it('keeps the caller selection order and shows a count while moving a selected group', () => {
    const onCollectionDrop = vi.fn();
    render(<Shelf selectedIds={['b', 'a']} onCollectionDrop={onCollectionDrop} />);
    hit('Stories');
    start();
    move();
    expect(ghost()).toHaveAttribute('data-count', '2');
    expect(card('a')).toHaveClass('is-dragging');
    expect(card('b')).toHaveClass('is-dragging');
    expect(card('c')).not.toHaveClass('is-dragging');
    finish();
    expect(onCollectionDrop).toHaveBeenCalledWith(['b', 'a'], 'stories');
    expect(document.querySelector('.is-dragging')).toBeNull();
    expect(document.body).not.toHaveClass('shelf-reordering');
  });

  it('sizes a showcase ghost from its cover rather than the full exhibit', () => {
    const onCollectionDrop = vi.fn();
    render(<Shelf sortable={false} onCollectionDrop={onCollectionDrop} />);
    const link = cover().closest('button')!;
    link.className = 'exhibit-cover-link';
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue({
      width: 110,
      height: 160,
    } as DOMRect);
    vi.spyOn(card(), 'getBoundingClientRect').mockReturnValue({
      width: 600,
      height: 300,
    } as DOMRect);
    hit('Stories');
    start();
    move();
    expect(ghost()).toHaveStyle({ width: '110px', height: '160px' });
    expect(ghost()?.querySelector('img')).toBeInTheDocument();
    finish();
    expect(onCollectionDrop).toHaveBeenCalledWith(['a'], 'stories');
  });

  it('files only the dragged album when it is outside the selection, and supports unfiled', () => {
    const onCollectionDrop = vi.fn();
    render(<Shelf selectedIds={['b', 'c']} onCollectionDrop={onCollectionDrop} />);
    hit('Unfiled');
    start();
    move();
    expect(ghost()).not.toHaveAttribute('data-count');
    finish();
    expect(onCollectionDrop).toHaveBeenCalledWith(['a'], null);
  });

  it('rejects the All tab, disabled collection targets and targets outside the registered root', () => {
    const onDrop = vi.fn();
    const onCollectionDrop = vi.fn();
    render(<Shelf onDrop={onDrop} onCollectionDrop={onCollectionDrop} />);
    for (const label of ['All', 'Disabled', 'Outside']) {
      hit(label);
      start();
      move();
      expect(document.querySelector('.is-collection-drop-target')).toBeNull();
      finish();
    }
    expect(onDrop).not.toHaveBeenCalled();
    expect(onCollectionDrop).not.toHaveBeenCalled();
  });

  it('defaults collection targets to the shelf root and ignores collection markup without a callback', () => {
    const onCollectionDrop = vi.fn();
    const { rerender } = render(
      <Shelf withTargetsRoot={false} onCollectionDrop={onCollectionDrop} />,
    );
    hit('Stories');
    start();
    move();
    finish();
    expect(onCollectionDrop).not.toHaveBeenCalled();
    hit('Inline collection');
    start();
    move();
    finish();
    expect(onCollectionDrop).toHaveBeenCalledWith(['a'], 'inline');
    rerender(<Shelf />);
    start();
    move();
    expect(document.querySelector('.is-collection-drop-target')).toBeNull();
    finish();
    expect(onCollectionDrop).toHaveBeenCalledTimes(1);
  });

  it('leaves touch scrolling, non-primary presses and card controls alone', () => {
    const onCollectionDrop = vi.fn();
    render(<Shelf onCollectionDrop={onCollectionDrop} />);
    hit('Stories');
    expect(start({ pointerType: 'touch' })).toBe(true);
    move(60, { pointerType: 'touch' });
    finish({ pointerType: 'touch' });
    expect(start({ button: 2 })).toBe(true);
    expect(start({}, screen.getByRole('button', { name: 'Menu a' }))).toBe(true);
    move();
    finish();
    expect(ghost()).toBeNull();
    expect(elementFromPoint).not.toHaveBeenCalled();
    expect(onCollectionDrop).not.toHaveBeenCalled();
  });

  it('cancels with the first Escape and leaves the next Escape to selection handling', () => {
    const onCollectionDrop = vi.fn();
    const selectionEscape = vi.fn();
    render(<Shelf selectedIds={['a', 'b']} onCollectionDrop={onCollectionDrop} />);
    window.addEventListener('keydown', selectionEscape);
    try {
      hit('Stories');
      start();
      move();
      expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false);
      expect(selectionEscape).not.toHaveBeenCalled();
      expect(ghost()).toBeNull();
      expect(document.querySelector('.is-collection-drop-target')).toBeNull();
      finish();
      expect(onCollectionDrop).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(selectionEscape).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', selectionEscape);
    }
  });

  it('reorders with Space and arrow keys while preserving focus on the grabbed card', () => {
    const onDrop = vi.fn();
    render(<Shelf onDrop={onDrop} />);
    card().focus();

    fireEvent.keyDown(card(), { key: ' ', shiftKey: true });
    expect(card()).toHaveAttribute('aria-grabbed', 'true');
    expect(card()).toHaveClass('is-dragging');
    expect(card('b')).toHaveClass('is-drop-target');
    expect(document.querySelector('[data-shelf-reorder-status]')).toHaveAttribute('role', 'status');
    expect(card()).toHaveFocus();

    fireEvent.keyDown(card(), { key: 'ArrowDown' });
    expect(card('b')).not.toHaveClass('is-drop-target');
    expect(card('c')).toHaveClass('is-drop-target');
    fireEvent.keyDown(card(), { key: ' ', shiftKey: true });

    expect(onDrop).toHaveBeenCalledWith('a', 'c', false, ['a']);
    expect(card()).toHaveFocus();
    expect(card()).not.toHaveAttribute('aria-grabbed');
    expect(card()).not.toHaveClass('is-dragging');
    expect(document.querySelector('[data-shelf-reorder-status]')).toBeNull();
  });

  it('announces reorder shortcuts only on the focused card without scanning the shelf', () => {
    const { rerender } = render(<Shelf />);
    expect(card()).not.toHaveAttribute('aria-keyshortcuts');
    expect(card('b')).not.toHaveAttribute('aria-keyshortcuts');

    card().focus();
    expect(card()).toHaveAttribute(
      'aria-keyshortcuts',
      'Shift+Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape',
    );
    expect(card('b')).not.toHaveAttribute('aria-keyshortcuts');

    screen.getByRole('button', { name: 'Menu a' }).focus();
    expect(card()).toHaveAttribute('aria-keyshortcuts');
    screen.getByRole('button', { name: 'Outside' }).focus();
    expect(card()).not.toHaveAttribute('aria-keyshortcuts');

    card('b').focus();
    rerender(<Shelf enabled={false} />);
    expect(card('b')).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('cancels a keyboard reorder with Escape without dropping and keeps focus', () => {
    const onDrop = vi.fn();
    render(<Shelf onDrop={onDrop} />);
    card().focus();
    fireEvent.keyDown(card(), { key: ' ', shiftKey: true });
    fireEvent.keyDown(card(), { key: 'ArrowRight' });
    expect(card('c')).toHaveClass('is-drop-target');
    expect(fireEvent.keyDown(card(), { key: 'Escape' })).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    expect(card()).toHaveFocus();
    expect(card()).not.toHaveAttribute('aria-grabbed');
    expect(card()).not.toHaveClass('is-dragging');
    expect(document.querySelector('[data-shelf-reorder-status]')).toBeNull();
  });

  it('handles keys from card controls and cancels if focus leaves the shelf', () => {
    const onDrop = vi.fn();
    let controller: Controller;
    render(<Shelf onDrop={onDrop} controller={(value) => (controller = value)} />);
    card().focus();
    fireEvent.keyDown(card(), { key: ' ', shiftKey: true });
    screen.getByRole('button', { name: 'Menu a' }).focus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Menu a' }), { key: 'ArrowDown' });
    expect(card('c')).toHaveClass('is-drop-target');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Menu a' }), { key: 'Escape' });
    expect(controller!.isDragging()).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();

    card().focus();
    fireEvent.keyDown(card(), { key: ' ', shiftKey: true });
    fireEvent.blur(card(), { relatedTarget: screen.getByRole('button', { name: 'Outside' }) });
    expect(controller!.isDragging()).toBe(false);
    expect(document.querySelector('[data-shelf-reorder-status]')).toBeNull();
  });

  it('cancels when Tab moves focus to another card', () => {
    const onDrop = vi.fn();
    let controller: Controller;
    render(<Shelf onDrop={onDrop} controller={(value) => (controller = value)} />);
    card().focus();
    fireEvent.keyDown(card(), { key: ' ', shiftKey: true });
    expect(controller!.isDragging()).toBe(true);

    card('b').focus();

    expect(controller!.isDragging()).toBe(false);
    expect(card()).not.toHaveAttribute('aria-grabbed');
    expect(document.querySelector('[data-shelf-reorder-status]')).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('supports a pen, ignores other pointers, and cleans up pointer cancellation and blur', () => {
    const onCollectionDrop = vi.fn();
    render(<Shelf onCollectionDrop={onCollectionDrop} />);
    hit('Stories');
    start({ pointerType: 'pen' });
    move(60, { pointerId: 2 });
    expect(ghost()).toBeNull();
    move(60, { pointerType: 'pen' });
    expect(ghost()).toBeInTheDocument();
    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(ghost()).toBeInTheDocument();
    fireEvent.pointerCancel(window, pointer);
    expect(ghost()).toBeNull();
    expect(document.querySelector('.is-collection-drop-target')).toBeNull();
    start();
    move();
    fireEvent.blur(window);
    expect(ghost()).toBeNull();
    finish();
    expect(onCollectionDrop).not.toHaveBeenCalled();
  });

  it('honors changing canDrag/enabled and exposes cancellation without leaking after unmount', () => {
    const onCollectionDrop = vi.fn();
    let controller: Controller;
    const props = { onCollectionDrop, controller: (value: Controller) => (controller = value) };
    const { rerender, unmount } = render(<Shelf {...props} canDrag={false} />);
    hit('Stories');
    expect(start()).toBe(true);
    move();
    expect(ghost()).toBeNull();
    rerender(<Shelf {...props} />);
    start();
    move();
    expect(controller!.isDragging()).toBe(true);
    expect(controller!.cancel()).toBe(true);
    expect(controller!.cancel()).toBe(false);
    expect(controller!.isDragging()).toBe(false);
    start();
    move();
    rerender(<Shelf {...props} enabled={false} />);
    finish();
    expect(onCollectionDrop).not.toHaveBeenCalled();
    rerender(<Shelf {...props} />);
    start();
    move();
    unmount();
    expect(ghost()).toBeNull();
    expect(document.body).not.toHaveClass('shelf-reordering');
    move();
    finish();
    expect(onCollectionDrop).not.toHaveBeenCalled();
  });
});
