import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionsIndex } from '../../api/collections';
import { confirm } from '../../components/confirm';
import { useToasts } from '../../components/toast';
import { CollectionMoveMenu } from './CollectionMoveMenu';
import { CollectionTabs } from './CollectionTabs';

vi.mock('../../components/confirm', () => ({ confirm: vi.fn().mockResolvedValue(false) }));

const index: CollectionsIndex = {
  collections: [
    { id: 'c_1', name: '短篇', created_at: '', updated_at: '', album_count: 2 },
    { id: 'c_2', name: '长篇', created_at: '', updated_at: '', album_count: 1 },
  ],
  memberships: {},
  total_count: 5,
  unfiled_count: 2,
};

function mount(
  options: {
    value?: string;
    onCreate?: (name: string) => Promise<unknown>;
    onRename?: (id: string, name: string) => Promise<unknown>;
    onDelete?: (id: string) => Promise<unknown>;
    onDialogChange?: (open: boolean) => void;
  } = {},
) {
  const onChange = vi.fn();
  function Fixture() {
    const [value, setValue] = useState(options.value ?? '');
    return (
      <CollectionTabs
        index={index}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        onCreate={options.onCreate ?? vi.fn().mockResolvedValue({})}
        onRename={options.onRename ?? vi.fn().mockResolvedValue({})}
        onDelete={options.onDelete ?? vi.fn().mockResolvedValue({})}
        onDialogChange={options.onDialogChange}
      />
    );
  }
  render(<Fixture />);
  return onChange;
}

async function openManage() {
  const trigger = screen.getByRole('button', { name: '管理合集' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
}

beforeEach(() => vi.mocked(confirm).mockReset().mockResolvedValue(false));
afterEach(() => {
  useToasts.getState().items.forEach((item) => useToasts.getState().dismiss(item.id));
});

describe('collection tabs', () => {
  it('shows counts and makes only unfiled and named collections drop targets', () => {
    mount();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['全部5', '未归类2', '短篇2', '长篇1']);
    expect(tabs[0]).not.toHaveAttribute('data-shelf-collection');
    expect(tabs[1]).toHaveAttribute('data-shelf-collection', '');
    expect(tabs[2]).toHaveAttribute('data-shelf-collection', 'c_1');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('supports arrows, Home and End with one tab stop', () => {
    const onChange = mount();
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(tabs[3]).toHaveFocus();
    expect(tabs[3]).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenLastCalledWith('c_2');
    fireEvent.keyDown(tabs[3], { key: 'Home' });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(tabs[3]).toHaveFocus();
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([tabs[3]]);
  });

  it('creates a trimmed name on Enter and closes only after it is saved', async () => {
    const onCreate = vi.fn().mockResolvedValue({});
    const onDialogChange = vi.fn();
    mount({ onCreate, onDialogChange });
    fireEvent.click(screen.getByRole('button', { name: '新建合集' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: '合集名称' }), {
      target: { value: '  练习集  ' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('练习集'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDialogChange.mock.calls.map(([open]) => open)).toEqual([true, false]);
  });

  it('preserves the draft after a save error', async () => {
    mount({ onCreate: vi.fn().mockRejectedValue(new Error('合集名称已存在')) });
    fireEvent.click(screen.getByRole('button', { name: '新建合集' }));
    const field = screen.getByRole('textbox', { name: '合集名称' });
    fireEvent.change(field, { target: { value: '短篇' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(useToasts.getState().items.at(-1)?.text).toBe('合集名称已存在'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(field).toHaveValue('短篇');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('renames the selected collection without switching the tab', async () => {
    const onRename = vi.fn().mockResolvedValue({});
    const onChange = mount({ value: 'c_1', onRename });
    const menu = await openManage();
    fireEvent.click(within(menu).getByRole('menuitem', { name: '重命名合集' }));
    const input = screen.getByRole('textbox', { name: '合集名称' });
    expect(input).toHaveValue('短篇');
    fireEvent.change(input, { target: { value: '短篇精选' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('c_1', '短篇精选'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('confirms deletion and keeps the active filter on failure', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const onDelete = vi.fn().mockRejectedValue(new Error('保存失败'));
    const onChange = mount({ value: 'c_1', onDelete });
    const menu = await openManage();
    fireEvent.click(within(menu).getByRole('menuitem', { name: '删除合集' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('c_1'));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: '画册将保留在未归类中。', danger: true }),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: '短篇 2' })).toHaveAttribute('aria-selected', 'true');
  });

  it('returns to all only when deleting the active collection succeeds', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const onDelete = vi.fn().mockResolvedValue({});
    const onChange = mount({ value: 'c_1', onDelete });
    const menu = await openManage();
    fireEvent.click(within(menu).getByRole('menuitem', { name: '删除合集' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });
});

describe('move to collection menu', () => {
  it('can move with keyboard and restores the trigger after selection', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<CollectionMoveMenu index={index} onMove={onMove} />);
    const trigger = screen.getByRole('button', { name: '移至合集' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['未归类', '短篇', '长篇']);
    await user.keyboard('{End}{Enter}');
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledWith('c_2');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('uses null for unfiled and disables the trigger while unavailable', async () => {
    const onMove = vi.fn();
    const { rerender } = render(<CollectionMoveMenu index={undefined} onMove={onMove} />);
    expect(screen.getByRole('button', { name: '移至合集' })).toBeDisabled();
    rerender(<CollectionMoveMenu index={index} disabled onMove={onMove} />);
    expect(screen.getByRole('button', { name: '移至合集' })).toBeDisabled();
    rerender(<CollectionMoveMenu index={index} onMove={onMove} />);
    screen.getByRole('button', { name: '移至合集' }).focus();
    await userEvent.keyboard('{Enter}');
    fireEvent.click(await screen.findByRole('menuitem', { name: '未归类' }));
    expect(onMove).toHaveBeenCalledWith(null);
  });
});
