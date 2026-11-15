import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUI } from './ui-store';
import { ThemeProvider, useThemeToggle } from './useTheme';

vi.mock('../api/open', () => ({
  useThemes: () => ({
    data: [
      { id: 'ink', mode: 'dark', tokens: { bg: '#131517' } },
      { id: 'paper', mode: 'light', tokens: { bg: '#f3f5f0' } },
      { id: 'custom', mode: 'dark', tokens: { 'radius-control': '12px' } },
    ],
  }),
}));

function Toggle({ name }: { name: string }) {
  const theme = useThemeToggle();
  return (
    <button onClick={theme.toggle}>
      {name}: {theme.mode}
    </button>
  );
}

describe('theme ownership', () => {
  const listeners = new Set<() => void>();
  let dark = true;

  beforeEach(() => {
    dark = true;
    listeners.clear();
    useUI.setState({ theme: 'system', recentThemes: {} });
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return dark;
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shares system changes and one subscription across all toggle entry points', () => {
    const view = render(
      <ThemeProvider>
        <Toggle name="toolbar" />
        <Toggle name="palette" />
      </ThemeProvider>,
    );
    expect(listeners.size).toBe(1);
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => {
      dark = false;
      listeners.forEach((listener) => listener());
    });
    expect(screen.getByRole('button', { name: 'toolbar: light' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'palette: light' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'palette: light' }));
    expect(useUI.getState().theme).toBe('ink');
    expect(screen.getByRole('button', { name: 'toolbar: dark' })).toBeInTheDocument();
    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it('clears custom control overrides when switching to an ordinary theme', () => {
    useUI.setState({ theme: 'custom' });
    render(
      <ThemeProvider>
        <Toggle name="toolbar" />
      </ThemeProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--radius-control')).toBe('12px');
    fireEvent.click(screen.getByRole('button', { name: 'toolbar: dark' }));
    expect(document.documentElement.style.getPropertyValue('--radius-control')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#f3f5f0');
  });
});
