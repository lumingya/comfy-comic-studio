import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StoryImportDialog } from './StoryImportDialog';

function Harness(props: { onImport: (panels: Record<string, unknown>[]) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Import story
      </button>
      <StoryImportDialog
        open={open}
        busy={false}
        characters={[]}
        returnFocusRef={trigger}
        onOpenChange={setOpen}
        onImport={(panels) => {
          props.onImport(panels);
          setOpen(false);
        }}
      />
    </>
  );
}

describe('story text import focus', () => {
  it.each(['Escape', '关闭', '取消'])('returns focus to the trigger after %s', async (action) => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(<Harness onImport={onImport} />);
    const trigger = screen.getByRole('button', { name: 'Import story' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    if (action === 'Escape') await user.keyboard('{Escape}');
    else await user.click(within(dialog).getByRole('button', { name: action }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onImport).not.toHaveBeenCalled();
  });

  it('returns focus after importing the previewed story', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(<Harness onImport={onImport} />);
    const trigger = screen.getByRole('button', { name: 'Import story' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'A quiet opening.');
    await user.click(within(dialog).getByRole('button', { name: /导入/ }));

    expect(onImport).toHaveBeenCalledOnce();
    expect(onImport).toHaveBeenCalledWith([
      expect.objectContaining({ description: 'A quiet opening.' }),
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
