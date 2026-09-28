import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';
const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (originalCommand) Object.defineProperty(document, 'execCommand', originalCommand);
  else Reflect.deleteProperty(document, 'execCommand');
  vi.restoreAllMocks();
  document.querySelectorAll('[data-copy-fixture]').forEach((e) => e.remove());
});
describe('clipboard feedback and modal ownership', () => {
  it('falls back inside the current dialog without losing the original button focus', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-copy-fixture', '');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    button.focus();
    const command = vi.fn(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toHaveValue('fixture text');
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
    await copyText('fixture text');
    expect(command).toHaveBeenCalledWith('copy');
    expect(button).toHaveFocus();
    expect(dialog.querySelector('textarea')).toBeNull();
  });
  it('rejects instead of claiming success when both clipboard methods fail', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    await expect(copyText('fixture text')).rejects.toThrow('剪贴板');
  });
});
