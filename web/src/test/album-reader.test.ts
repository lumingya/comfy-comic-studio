import { afterEach, describe, expect, it, vi } from 'vitest';
import lightbox from '../../../server/mio_server/album/runtime_lightbox.js?raw';
import runtime from '../../../server/mio_server/album/runtime.js?raw';

const panels = Array.from(
  { length: 4 },
  (_, index) =>
    '<figure data-cc-frame><img src="data:image/png;base64,i' +
    index +
    '" alt="画作 ' +
    (index + 1) +
    '"><figcaption data-cc-caption>台词 ' +
    (index + 1) +
    '<div class="palette"><i style="background:#123456"></i></div></figcaption></figure>',
);

function mount(layout = 'webtoon', { mobile = false, reduced = false, embedded = false } = {}) {
  const host = document.createElement('iframe');
  document.body.append(host);
  const child = host.contentWindow!;
  if (!embedded) Object.defineProperty(child, 'parent', { value: child });
  Object.defineProperty(child, 'matchMedia', {
    value: (query: string) => ({ matches: query.includes('reduce') ? reduced : mobile }),
  });
  const scroll = vi.fn();
  child.scrollTo = scroll;
  const doc = child.document;
  doc.body.dataset.layout = layout;
  doc.body.innerHTML = [panels.slice(0, 3), panels.slice(3)]
    .map(
      (items) =>
        '<article data-cc-book><main data-cc-pages>' + items.join('') + '</main></article>',
    )
    .join('');
  new Function('window', 'document', lightbox + '\n' + runtime)(child, doc);
  const key = (value: string, options?: KeyboardEventInit) =>
    doc.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, ...options }),
    );
  const get = <T extends HTMLElement>(selector: string) => doc.querySelector<T>(selector)!;
  const visible = () =>
    [...doc.querySelectorAll<HTMLElement>('[data-cc-frame]')]
      .filter((panel) => !panel.hidden)
      .map((panel) => panel.querySelector('img')?.alt);
  return { key, get, child, doc, visible, scroll };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('offline album reader', () => {
  it('opens a focused accessible lightbox, changes images, then restores focus', () => {
    const { doc, get, key } = mount();
    const first = get<HTMLImageElement>('[data-cc-frame] img');
    first.click();

    const dialog = get<HTMLDivElement>('.cc-lightbox');
    const preview = get<HTMLImageElement>('.cc-lightbox img');
    const next = get<HTMLButtonElement>('.cc-lightbox-next');
    const close = get<HTMLButtonElement>('.cc-lightbox-close');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.hidden).toBe(false);
    expect(preview.alt).toBe('画作 1');
    expect(dialog.querySelector('figcaption')?.textContent).toBe('台词 1');
    expect(doc.activeElement).toBe(close);
    expect(first.closest('article')).toHaveAttribute('inert');

    const zoom = get<HTMLButtonElement>('.cc-lightbox-zoom');
    zoom.click();
    expect(zoom).toHaveAttribute('aria-pressed', 'true');
    expect(get('.cc-lightbox-viewport')).toHaveAttribute('data-zoomed');
    key('ArrowRight');
    expect(preview.alt).toBe('画作 2');
    expect(dialog.querySelector('figcaption')?.textContent).toBe('台词 2');
    expect(zoom).toHaveAttribute('aria-pressed', 'false');
    next.click();
    next.click();
    expect(next).toBeDisabled();
    next.click();
    expect(preview.alt).toBe('画作 4');
    const previous = get<HTMLButtonElement>('.cc-lightbox-previous');
    previous.focus();
    key('Tab');
    expect(doc.activeElement).toBe(close);
    key('Tab', { shiftKey: true });
    expect(doc.activeElement).toBe(previous);

    key('Escape');
    expect(dialog.hidden).toBe(true);
    expect(first.closest('article')).not.toHaveAttribute('inert');
    expect(doc.activeElement).toBe(first);
  });

  it('opens from the keyboard and skips transitions with reduced motion', () => {
    const { get, key, visible } = mount('flip', { mobile: true, reduced: true });
    expect(visible()).toEqual(['画作 1']);
    key('ArrowRight');
    expect(visible()).toEqual(['画作 2']);
    expect(get('[data-mio-enter]')).toBeNull();
    const image = get<HTMLImageElement>('[data-cc-frame]:not([hidden]) img');
    expect(image).toHaveAttribute('role', 'button');
    image.focus();
    key('Enter');
    const dialog = get<HTMLDivElement>('.cc-lightbox');
    expect(dialog.hidden).toBe(false);
    expect(dialog.style.transition).toBe('none');
  });

  it('jumps between chapters with the directory, keeps progress and switches spreads', () => {
    const { get, key, visible } = mount('folio');
    const progress = get<HTMLProgressElement>('progress');
    expect(visible()).toEqual(['画作 1', '画作 2']);
    key(' ');
    expect(visible()).toEqual(['画作 3']);
    expect(get('.cc-blank:not([hidden])')).toBeTruthy();
    expect(progress.value).toBe(3);
    expect(get('.mio-ambient [data-visible]')).toBeTruthy();
    key(' ');
    expect(visible()).toEqual(['画作 4']);
    expect(progress.value).toBe(4);
    key('Home');
    expect(progress.value).toBe(1);
    key('g');
    const directory = get<HTMLButtonElement>('[aria-controls=mio-reader-directory]');
    expect(directory).toHaveAttribute('aria-expanded', 'true');
    expect(get('.mio-thumbnails button[aria-current]')).toHaveTextContent('画作 1');
    get<HTMLButtonElement>('.mio-thumbnails button:nth-child(2)').click();
    expect(directory).toHaveAttribute('aria-expanded', 'false');
    expect(progress.value).toBe(2);
    const view = get<HTMLButtonElement>('[aria-label^=切换版式]');
    view.click();
    expect(visible()).toEqual(['画作 2']);
    view.click();
    expect(visible()).toEqual(['画作 1', '画作 2']);
    key('End');
    expect(visible()).toEqual(['画作 4']);
    const immerse = get<HTMLButtonElement>('.mio-controls button[aria-pressed=false]');
    immerse.click();
    expect(immerse).toHaveAttribute('aria-pressed', 'true');
    expect(get('body')).toHaveAttribute('data-mio-immersive');
    key('g');
    key('Escape');
    expect(directory).toHaveAttribute('aria-expanded', 'false');
  });

  it('handles fullscreen through the browser and leaves text inputs alone', () => {
    const { doc, key, get } = mount('cinema');
    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(doc.documentElement, 'requestFullscreen', { value: request });
    key('f');
    expect(request).toHaveBeenCalledOnce();
    const input = doc.createElement('input');
    doc.body.append(input);
    input.focus();
    key('f');
    key('ArrowRight');
    expect(request).toHaveBeenCalledOnce();
    expect(get<HTMLProgressElement>('progress').value).toBe(1);
  });

  it('turns with a horizontal touch and leaves vertical gestures to scrolling', () => {
    const { doc, visible } = mount('folio', { mobile: true });
    function touch(type: string, x: number, y: number) {
      const event = new Event(type, { bubbles: true });
      const point = [{ clientX: x, clientY: y }];
      Object.defineProperties(event, {
        touches: { value: type === 'touchstart' ? point : [] },
        changedTouches: { value: point },
      });
      doc.body.dispatchEvent(event);
    }
    touch('touchstart', 120, 120);
    touch('touchend', 100, 20);
    expect(visible()).toEqual(['画作 1']);
    touch('touchstart', 120, 20);
    touch('touchend', 30, 22);
    expect(visible()).toEqual(['画作 2']);
  });

  it('restores the legacy parent spread and the active frame and mode after refresh', () => {
    const { child, visible, scroll, get } = mount('flip', { embedded: true });
    const parent = child.parent;
    const post = vi.spyOn(parent, 'postMessage').mockImplementation(() => {});
    const run = vi.fn();
    vi.spyOn(child, 'setTimeout').mockImplementation((handler, wait) => {
      if (wait === 120 && typeof handler === 'function') run.mockImplementation(() => handler());
      return 0;
    });
    const from = (source: Window, data: object) =>
      child.dispatchEvent(new MessageEvent('message', { source, data }));

    from(parent, { type: 'mio-reader-restore', y: 84, spread: 1 });
    expect(visible()).toEqual(['画作 3']);
    expect(scroll).toHaveBeenLastCalledWith({ top: 84, behavior: 'instant' });
    from(child, { type: 'mio-reader-turn', direction: -1 });
    expect(visible()).toEqual(['画作 3']);
    from(parent, { type: 'mio-reader-turn', direction: 1 });
    expect(visible()).toEqual(['画作 4']);
    run();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'mio-reader-state', spread: 0, frame: 3, mode: 'template' }),
      '*',
    );
    from(parent, { type: 'mio-reader-restore', y: 7, spread: 0, frame: 1, mode: 'single' });
    expect(visible()).toEqual(['画作 2']);
    expect(get('[aria-label^=切换版式]')).toHaveTextContent('单页');
    expect(scroll).toHaveBeenLastCalledWith({ top: 7, behavior: 'instant' });
  });
});
