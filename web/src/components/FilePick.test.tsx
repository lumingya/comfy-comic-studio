import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FilePick } from './ui';

describe('FilePick', () => {
  it('opens the file chooser from the visible control with Enter, Space and a pointer', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const { container } = render(
      <form onSubmit={onSubmit}>
        <FilePick accept=".json,.png,.webp" onFile={vi.fn()}>
          Import workflow
        </FilePick>
        <input aria-label="Search workflows" />
      </form>,
    );
    const trigger = screen.getByRole('button', { name: 'Import workflow' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    // JSDOM cannot display the native chooser; its click is the browser handoff.
    const openChooser = vi.spyOn(input, 'click');

    await user.tab();
    expect(trigger).toBeVisible();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(openChooser).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(openChooser).toHaveBeenCalledTimes(2);
    await user.click(trigger);
    expect(openChooser).toHaveBeenCalledTimes(3);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Search workflows' })).toHaveFocus();
  });

  it('delivers accepted files, clears the selection for retries and ignores cancellation', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    const file = new File(['{}'], 'workflow.json', { type: 'application/json' });
    const { container } = render(
      <FilePick accept=".json,.png,.webp" onFile={onFile}>
        Import workflow
      </FilePick>,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    await user.upload(input, file);
    expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
    expect(input).toHaveValue('');
    await user.upload(input, file);
    expect(onFile).toHaveBeenCalledTimes(2);
    expect(onFile).toHaveBeenLastCalledWith(file);
    expect(input).toHaveValue('');

    await user.upload(input, new File(['text'], 'notes.txt', { type: 'text/plain' }));
    fireEvent.change(input, { target: { files: [] } });
    expect(onFile).toHaveBeenCalledTimes(2);
  });

  it('skips a disabled import and cannot open or select files until it is enabled', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    const picker = (disabled: boolean) => (
      <>
        <FilePick className="ref-add" accept="image/*" disabled={disabled} onFile={onFile}>
          Upload reference
        </FilePick>
        <input aria-label="Reference title" />
      </>
    );
    const { container, rerender } = render(picker(true));
    const trigger = screen.getByRole('button', { name: 'Upload reference' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openChooser = vi.spyOn(input, 'click');
    const file = new File(['image'], 'reference.png', { type: 'image/png' });

    expect(trigger).toBeDisabled();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Reference title' })).toHaveFocus();
    await user.click(trigger);
    expect(openChooser).not.toHaveBeenCalled();
    await user.upload(input, file);
    expect(onFile).not.toHaveBeenCalled();

    await user.click(screen.getByRole('textbox', { name: 'Reference title' }));
    rerender(picker(false));
    await user.tab({ shift: true });
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(openChooser).toHaveBeenCalledOnce();
    await user.upload(input, file);
    expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
  });
});
