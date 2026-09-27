import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Toaster, toast, useToasts } from './toast';
import { topDialog } from './topLayer';

/** jsdom has no top layer: make a dialog opened via the attribute count as `showModal()`-ed. */
function modal(): HTMLDialogElement {
  const d = document.createElement('dialog');
  const matches = d.matches.bind(d);
  d.matches = (sel: string) => (sel === ':modal' ? d.hasAttribute('open') : matches(sel));
  return d;
}

afterEach(() => {
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  useToasts.setState({ items: [] });
});

describe('top layer', () => {
  it('finds the last open dialog', () => {
    expect(topDialog()).toBeUndefined();
    const a = modal();
    const b = modal();
    a.setAttribute('open', '');
    document.body.append(a, b);
    expect(topDialog()).toBe(a);
    b.setAttribute('open', '');
    expect(topDialog()).toBe(b);
  });

  it('renders toasts inside an open modal dialog so they are not hidden behind it', async () => {
    const dialog = modal();
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    render(<Toaster />);
    act(() => {
      toast('saved inside the reader');
    });
    const item = await screen.findByText('saved inside the reader');
    expect(dialog.contains(item)).toBe(true);
    dialog.remove();
    act(() => {
      toast('after closing');
    });
    const later = await screen.findByText('after closing');
    expect(document.querySelector('dialog')).toBeNull();
    expect(later.isConnected).toBe(true);
  });
});
