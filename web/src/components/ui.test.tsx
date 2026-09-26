import { act, fireEvent, render, screen } from '@testing-library/react';
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
