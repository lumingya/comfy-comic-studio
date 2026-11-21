import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeroTheater } from './HeroTheater';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockDesktopObserver() {
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

  return {
    observe,
    disconnect,
    removeEventListener,
    emit(
      entries: Array<
        Pick<IntersectionObserverEntry, 'target' | 'isIntersecting' | 'intersectionRatio'>
      >,
    ) {
      act(() => callback?.(entries as IntersectionObserverEntry[], {} as IntersectionObserver));
    },
  };
}

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
    const observer = mockDesktopObserver();
    const { container, unmount } = render(<HeroTheater locale="en" />);
    expect(observer.observe).toHaveBeenCalledTimes(4);
    const thirdStage = container.querySelector('[data-stage="2"]')!;
    // The observer only changes the selected stage; it never scrolls the document.
    observer.emit([{ target: thirdStage, isIntersecting: true, intersectionRatio: 0.6 }]);
    expect(screen.getByRole('tabpanel', { name: 'Choose an image' })).toBeInTheDocument();
    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(observer.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('keeps observing the same narrative nodes after changing language', () => {
    const observer = mockDesktopObserver();
    const { container, rerender } = render(<HeroTheater locale="zh-CN" />);
    const originalStages = Array.from(container.querySelectorAll('[data-stage]'));
    observer.emit([{ target: originalStages[2], isIntersecting: true, intersectionRatio: 0.9 }]);
    expect(screen.getByRole('tabpanel', { name: '候选挑选' })).toBeInTheDocument();

    rerender(<HeroTheater locale="en" />);
    const translatedStages = Array.from(container.querySelectorAll('[data-stage]'));
    translatedStages.forEach((stage, index) => expect(stage).toBe(originalStages[index]));
    expect(observer.observe).toHaveBeenCalledTimes(4);
    observer.emit([
      { target: originalStages[2], isIntersecting: false, intersectionRatio: 0 },
      { target: originalStages[3], isIntersecting: true, intersectionRatio: 0.8 },
    ]);
    expect(screen.getByRole('tabpanel', { name: 'Compose & export' })).toBeInTheDocument();
  });

  it('compares all stages across observer batches instead of following only changed entries', () => {
    const observer = mockDesktopObserver();
    const { container } = render(<HeroTheater locale="en" />);
    const stages = Array.from(container.querySelectorAll('[data-stage]'));
    observer.emit([
      { target: stages[0], isIntersecting: true, intersectionRatio: 0.8 },
      { target: stages[1], isIntersecting: true, intersectionRatio: 0.1 },
    ]);
    observer.emit([{ target: stages[1], isIntersecting: true, intersectionRatio: 0.35 }]);
    expect(screen.getByRole('tabpanel', { name: 'Shape a scene' })).toBeInTheDocument();

    observer.emit([
      { target: stages[0], isIntersecting: true, intersectionRatio: 0.25 },
      { target: stages[1], isIntersecting: true, intersectionRatio: 1 },
    ]);
    observer.emit([
      { target: stages[0], isIntersecting: true, intersectionRatio: 0.15 },
      { target: stages[2], isIntersecting: true, intersectionRatio: 0.2 },
    ]);
    expect(screen.getByRole('tabpanel', { name: 'Assemble your tools' })).toBeInTheDocument();

    observer.emit([
      { target: stages[1], isIntersecting: true, intersectionRatio: 0.4 },
      { target: stages[2], isIntersecting: true, intersectionRatio: 0.85 },
    ]);
    expect(screen.getByRole('tabpanel', { name: 'Choose an image' })).toBeInTheDocument();
    observer.emit([{ target: stages[2], isIntersecting: false, intersectionRatio: 0 }]);
    expect(screen.getByRole('tabpanel', { name: 'Assemble your tools' })).toBeInTheDocument();
    observer.emit([{ target: stages[0], isIntersecting: true, intersectionRatio: 0.4 }]);
    expect(screen.getByRole('tabpanel', { name: 'Assemble your tools' })).toBeInTheDocument();
  });
});
