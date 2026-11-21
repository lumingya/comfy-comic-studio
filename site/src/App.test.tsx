import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
vi.mock('./sections/hero/HeroTheater', () => ({ HeroTheater: () => <h1>Mio</h1> }));
vi.mock('./sections/sandbox/LiveSandbox', () => ({ LiveSandbox: () => null }));
vi.mock('./sections/workflow/WorkflowShowcase', () => ({ WorkflowShowcase: () => null }));
vi.mock('./sections/ecosystem/EcosystemBento', () => ({ EcosystemBento: () => null }));
vi.mock('./sections/quickstart/QuickStartFooter', () => ({ QuickStartFooter: () => null }));
describe('site language', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it('switches language and remembers the preference', () => {
    localStorage.setItem('mio-site-locale', 'zh-CN');
    const view = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('mio-site-locale')).toBe('en');
    expect(screen.getByRole('navigation')).toHaveAccessibleName('Main navigation');
    view.unmount();
    render(<App />);
    expect(screen.getByRole('button', { name: '切换为中文' })).toBeInTheDocument();
  });
  it('works when browser persistence is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    render(<App />);
    const before = document.documentElement.lang;
    fireEvent.click(screen.getByRole('button', { name: /切换为中文|Switch to English/ }));
    expect(document.documentElement.lang).not.toBe(before);
  });
});
