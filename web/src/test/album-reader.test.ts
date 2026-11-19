import { afterEach, describe, expect, it, vi } from 'vitest';
import runtime from '../../../server/mio_server/album/runtime.js?raw';

function mount(layout = 'webtoon') {
  document.body.setAttribute('data-layout', layout);
  document.body.innerHTML = `
    <article data-cc-book>
      <main data-cc-pages>
        <figure data-cc-frame><img src="data:image/png;base64,first" alt="第一幕">
          <figcaption data-cc-caption>雨夜</figcaption>
        </figure>
        <figure data-cc-frame><img src="data:image/png;base64,second" alt="第二幕">
          <figcaption data-cc-caption>便利店</figcaption>
        </figure>
      </main>
    </article>`;
  new Function(runtime)();
}

afterEach(() => {
  document.body.replaceChildren();
  document.body.removeAttribute('data-layout');
  vi.restoreAllMocks();
});

describe('offline album reader', () => {
  it('opens a focused accessible lightbox, changes images, then restores focus', () => {
    mount();
    const images = [...document.querySelectorAll<HTMLImageElement>('[data-cc-frame] img')];
    images[0].click();

    const dialog = document.querySelector('.cc-lightbox') as HTMLDivElement;
    const preview = dialog.querySelector('img') as HTMLImageElement;
    const next = dialog.querySelector('.cc-lightbox-next') as HTMLButtonElement;
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.hidden).toBe(false);
    expect(preview.alt).toBe('第一幕');
    expect(dialog.querySelector('figcaption')?.textContent).toBe('雨夜');
    expect(document.activeElement).toBe(dialog.querySelector('.cc-lightbox-close'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(preview.alt).toBe('第二幕');
    expect(dialog.querySelector('figcaption')?.textContent).toBe('便利店');
    next.click(); // the final frame is disabled and cannot advance beyond the book
    expect(preview.alt).toBe('第二幕');
    const previous = dialog.querySelector('.cc-lightbox-previous') as HTMLButtonElement;
    previous.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(dialog.querySelector('.cc-lightbox-close'));
    (dialog.querySelector('.cc-lightbox-close') as HTMLButtonElement).focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(previous);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(images[0]);
  });

  it('opens from the keyboard and skips the transition for reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    mount('flip');
    const image = document.querySelector('[data-cc-frame] img') as HTMLImageElement;
    expect(image).toHaveAttribute('role', 'button');
    image.focus();
    image.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const dialog = document.querySelector('.cc-lightbox') as HTMLDivElement;
    expect(dialog.hidden).toBe(false);
    expect(dialog.style.transition).toBe('none');
  });
});
