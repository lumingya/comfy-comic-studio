import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { confirm, ConfirmHost } from './confirm';
import { toast, Toaster } from './toast';
import { InlineTitle } from './ui';

describe('InlineTitle', () => {
  it('saves trimmed text, reverts on Escape and on an emptied field', () => {
    const onSave = vi.fn();
    render(<InlineTitle value="雨夜" label="title" onSave={onSave} />);
    const input = screen.getByLabelText('title') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(input.value).toBe('雨夜');

    fireEvent.change(input, { target: { value: '不要这个' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(input.value).toBe('雨夜');
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  晴天  ' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith('晴天');
    expect(input.value).toBe('晴天');
  });

  it('lets Enter finish an IME composition instead of committing', () => {
    const onSave = vi.fn();
    render(<InlineTitle value="雨夜" label="title" onSave={onSave} />);
    const input = screen.getByLabelText('title') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'yu' } });
    // Composing: the keydown carries isComposing=true and must not blur/commit.
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(document.activeElement).toBe(input);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '雨天' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith('雨天');
  });
});

describe('confirm', () => {
  it('resolves with the button the user picked', async () => {
    render(<ConfirmHost />);
    let answer: Promise<boolean>;
    act(() => {
      answer = confirm({ title: '删除这一格？', confirmLabel: '删除', danger: true });
    });
    fireEvent.click(await screen.findByText('删除'));
    await expect(answer!).resolves.toBe(true);

    act(() => {
      answer = confirm({ title: '再来一次？' });
    });
    fireEvent.click(await screen.findByText('取消'));
    await expect(answer!).resolves.toBe(false);
  });

  it('starts destructive dialogs on Cancel so Enter cannot delete', async () => {
    render(<ConfirmHost />);
    act(() => {
      void confirm({ title: '彻底删除？', confirmLabel: '删除', danger: true });
    });
    const cancel = await screen.findByText('取消');
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.click(cancel);

    act(() => {
      void confirm({ title: '保存？' });
    });
    const ok = await screen.findByText('确定');
    await waitFor(() => expect(document.activeElement).toBe(ok));
    fireEvent.click(ok);
  });
});

describe('toast', () => {
  it('runs the action and closes', () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      toast('已删除第 3 格', { action: { label: '撤销', onClick: undo } });
    });
    fireEvent.click(screen.getByText('撤销'));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText('已删除第 3 格')).toBeNull();
  });
});
