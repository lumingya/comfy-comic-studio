import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../../components/ui';
import { BoardZoomDialog } from './BoardZoomDialog';

const showDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
let rootStyleBefore: string;
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
  const matches = this.matches.bind(this);
  vi.spyOn(this, 'matches').mockImplementation((selector) =>
    selector === ':modal' ? this.open : matches(selector),
  );
  this.querySelector<HTMLButtonElement>('button')?.focus();
});

beforeEach(() => {
  rootStyleBefore = document.documentElement.style.cssText;
  showModal.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: showModal,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.cssText = rootStyleBefore;
  if (showDescriptor)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (closeDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'close', closeDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

function Harness() {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>View candidate</button>
      <BoardZoomDialog
        open={open}
        onOpenChange={setOpen}
        title="Candidate"
        footer={<button>Adopt</button>}
      >
        <input aria-label="Reference" type="file" />
        <button onClick={() => setNested(true)}>Details</button>
        <Modal open={nested} onOpenChange={setNested} title="Nested details">
          <p>Request metadata</p>
        </Modal>
      </BoardZoomDialog>
    </>
  );
}

function open() {
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'View candidate' });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: 'Candidate' }) };
}

describe('native candidate zoom dialog', () => {
  it('uses the browser modal layer without changing body pointer events or scroll styles', () => {
    const before = document.body.style.cssText;
    const { trigger, dialog } = open();
    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute('open');
    expect(document.body.style.cssText).toBe(before);
    expect(document.body).not.toHaveAttribute('data-scroll-locked');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.documentElement.style.scrollbarGutter).toBe('stable');
    expect(within(dialog).getByRole('button', { name: '关闭' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.documentElement.style.scrollbarGutter).toBe('');
  });

  it('restores prior root overflow axes, gutter and priorities on unmount', () => {
    const style = document.documentElement.style;
    style.setProperty('overflow-x', 'clip', 'important');
    style.setProperty('overflow-y', 'scroll');
    style.setProperty('scrollbar-gutter', 'stable both-edges', 'important');
    style.setProperty('scroll-behavior', 'smooth');
    const properties = ['overflow', 'overflow-x', 'overflow-y', 'scrollbar-gutter'];
    const previous = properties.map((property) => [
      property,
      style.getPropertyValue(property),
      style.getPropertyPriority(property),
    ]);
    const view = render(
      <BoardZoomDialog open onOpenChange={() => {}} title="Candidate" footer={null}>
        Image
      </BoardZoomDialog>,
    );
    expect(style.overflow).toBe('hidden');
    expect(style.scrollbarGutter).toBe('stable both-edges');
    // Changes made by other owners while open are not rolled back with our scroll lock.
    style.setProperty('color', 'red');
    view.unmount();
    expect(
      properties.map((property) => [
        property,
        style.getPropertyValue(property),
        style.getPropertyPriority(property),
      ]),
    ).toEqual(previous);
    expect(style.scrollBehavior).toBe('smooth');
    expect(style.color).toBe('red');
  });

  it('handles native Escape and ignores a file-picker cancel inside the dialog', () => {
    const { trigger, dialog } = open();
    fireEvent(screen.getByLabelText('Reference'), new Event('cancel', { bubbles: true }));
    expect(dialog).toHaveAttribute('open');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('dismisses only a press and release on the backdrop, preserving inside-to-outside drags', () => {
    const { dialog, trigger } = open();
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      right: 500,
      bottom: 500,
    } as DOMRect);
    const pointer = (x: number) => {
      const event = new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: 200,
      });
      fireEvent(dialog, event);
    };
    pointer(200);
    fireEvent.click(dialog, { clientX: 20, clientY: 200 });
    expect(dialog).toHaveAttribute('open');
    pointer(20);
    fireEvent.click(dialog, { clientX: 20, clientY: 200 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('hosts nested Radix dialogs above the image and keeps the outer reader open', async () => {
    const { dialog } = open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Details' }));
    const nested = await screen.findByRole('dialog', { name: 'Nested details' });
    expect(dialog.contains(nested)).toBe(true);
    fireEvent.keyDown(nested, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Nested details' })).not.toBeInTheDocument();
    expect(dialog).toHaveAttribute('open');
    expect(document.documentElement.style.overflow).toBe('hidden');
    // React also forwards native dialog close events from nested descendants.
    const child = document.createElement('dialog');
    dialog.append(child);
    act(() => child.dispatchEvent(new Event('close', { bubbles: true })));
    expect(dialog).toHaveAttribute('open');
    child.remove();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(document.documentElement.style.overflow).toBe('');
  });
});
