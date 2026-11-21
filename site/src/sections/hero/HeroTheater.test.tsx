import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeroTheater } from './HeroTheater';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HeroTheater', () => {
  it('opens the playground and clearly labels prepared artwork', () => {
    render(<HeroTheater locale="zh-CN" />);

    expect(screen.getByRole('link', { name: '立即在线试玩' })).toHaveAttribute(
      'href',
      '#playground',
    );
    expect(screen.getByRole('link', { name: '下载到自己的电脑' })).toHaveAttribute(
      'href',
      'https://github.com/lumingya/comfy-comic-studio/releases',
    );
    expect(screen.getByText('使用预置插画演示，不会调用生图服务。')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: '灵感分镜' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches the demonstration when a stage is selected', () => {
    render(<HeroTheater locale="zh-CN" />);

    fireEvent.click(screen.getByRole('tab', { name: '候选挑选' }));

    expect(screen.getByRole('tab', { name: '候选挑选' })).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: '候选挑选' });
    expect(within(panel).getByText('已采用')).toBeInTheDocument();
    expect(within(panel).getByText('重画保留旧图，采用之后才进入作品。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '排版导出' }));
    expect(
      within(screen.getByRole('tabpanel')).getByText('一本可以带走的作品'),
    ).toBeInTheDocument();
  });

  it('supports arrow, home, and end keys with focus following the active tab', () => {
    render(<HeroTheater locale="en" />);
    const first = screen.getByRole('tab', { name: 'Shape a scene' });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = screen.getByRole('tab', { name: 'Assemble your tools' });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Assemble your tools' })).toBeInTheDocument();

    fireEvent.keyDown(second, { key: 'End' });
    const last = screen.getByRole('tab', { name: 'Compose & export' });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Home' });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('tabindex', '0');
    expect(last).toHaveAttribute('tabindex', '-1');
  });

  it('uses the visible narrative stage on desktop and disconnects when unmounted', () => {
    let callback: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener,
      })),
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(handler: IntersectionObserverCallback) {
          callback = handler;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );

    const { container, unmount } = render(<HeroTheater locale="en" />);
    expect(observe).toHaveBeenCalledTimes(4);
    const thirdStage = container.querySelector('[data-stage="2"]');
    expect(thirdStage).not.toBeNull();
    // The observer only changes the selected stage; it never scrolls the document.
    const entries = [{ target: thirdStage, isIntersecting: true, intersectionRatio: 0.6 }];
    act(() => callback?.(entries as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(screen.getByRole('tabpanel', { name: 'Choose an image' })).toBeInTheDocument();
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
