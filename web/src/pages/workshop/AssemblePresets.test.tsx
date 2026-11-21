import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preset, PresetEntry } from '../../api/workshop';
import { AssemblePresets } from './AssemblePresets';

function entry(key: string, value: string): PresetEntry {
  return { id: key, key, value, label: '', hint: '', group_id: null };
}
const presets: Preset[] = [
  {
    id: 'paper',
    title: 'Paper',
    groups: [],
    bindings: [],
    entries: [
      entry('paper', 'Textured paper'),
      entry('ink', 'Black ink'),
      entry('light', 'Soft light'),
      entry('tone', 'Grayscale'),
      entry('detail', 'Line one\nLine two'),
    ],
  },
  {
    id: 'wash',
    title: 'Wash',
    groups: [],
    bindings: [],
    entries: [entry('ink', ''), entry('tone', 'Muted blue')],
  },
];

function mount() {
  const close = vi.fn();
  function TestDialog() {
    const [host, setHost] = useState<HTMLDialogElement | null>(null);
    const [ordered, setOrdered] = useState<Preset[]>([]);
    return (
      <dialog ref={setHost} open onCancel={close} aria-label="Wizard">
        <AssemblePresets
          host={host}
          presets={presets}
          ordered={ordered}
          onToggle={(id) =>
            setOrdered((current) =>
              current.some((preset) => preset.id === id)
                ? current.filter((preset) => preset.id !== id)
                : [...current, presets.find((preset) => preset.id === id)!],
            )
          }
          onMove={(id, direction) => {
            const next = [...ordered];
            const index = next.findIndex((preset) => preset.id === id);
            [next[index], next[index + direction]] = [next[index + direction], next[index]];
            setOrdered(next);
          }}
        />
      </dialog>
    );
  }
  render(<TestDialog />);
  return { user: userEvent.setup(), close };
}

describe('assembly preset previews', () => {
  beforeEach(() => {
    // jsdom gives anchors and viewports zero area; Floating UI flags them as detached.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(36, 36, 400, 200),
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  });
  afterEach(() => vi.restoreAllMocks());

  it('previews every entry on hover and on keyboard activation without toggling the card', async () => {
    const { user, close } = mount();
    const wizard = screen.getByRole('dialog', { name: 'Wizard' });
    const card = screen.getByRole('checkbox', { name: /Paper/ });
    const trigger = screen.getByRole('button', { name: '预览 Paper' });
    expect(screen.queryByText('Textured paper')).not.toBeInTheDocument();
    expect(screen.queryByText('{detail}')).not.toBeInTheDocument();
    await user.hover(trigger);
    const preview = await within(wizard).findByRole('dialog', { name: 'Paper' });
    expect(within(preview).getByText('{detail}')).toBeInTheDocument();
    expect(within(preview).getByText('Line one Line two').textContent).toBe('Line one\nLine two');
    expect(card).not.toBeChecked();
    await user.click(trigger);
    await waitFor(() => expect(preview).toHaveFocus());
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => preview.dispatchEvent(escape));
    await waitFor(() => expect(preview).not.toBeInTheDocument());
    expect(escape.defaultPrevented).toBe(true);
    expect(close).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard('{Enter}');
    const reopened = await within(wizard).findByRole('dialog', { name: 'Paper' });
    await waitFor(() => expect(reopened).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(card).not.toBeChecked();
    await user.click(card);
    expect(card).toBeChecked();
  });

  it('shows effective values and sources in selection order, including empty overrides', async () => {
    const { user } = mount();
    await user.click(screen.getByRole('checkbox', { name: /Paper/ }));
    await user.click(screen.getByRole('checkbox', { name: /Wash/ }));
    const trigger = screen.getByRole('button', { name: '查看合并结果' });
    await user.click(trigger);
    const preview = await screen.findByRole('dialog', { name: '查看合并结果' });
    const ink = within(preview).getByText('{ink}').closest<HTMLDivElement>('dl > div')!;
    expect(ink.querySelector('dd')).toHaveTextContent('2. Wash（空值）');
    expect(within(ink).getByText('1. Paper · 已覆盖')).toBeInTheDocument();
    expect(ink.querySelector('del')).toHaveTextContent('Black ink');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: '上移 Wash' }));
    await user.click(trigger);
    const reordered = await screen.findByRole('dialog', { name: '查看合并结果' });
    const reorderedInk = within(reordered).getByText('{ink}').closest('dl > div')!;
    expect(reorderedInk.querySelector('dd')).toHaveTextContent('2. PaperBlack ink');
    expect(reorderedInk.querySelector('del')).toHaveTextContent('（空值）');
  });
});
