import { afterEach, describe, expect, it, vi } from 'vitest';
import lightbox from '../../../server/mio_server/album/runtime_lightbox.js?raw';
import runtime from '../../../server/mio_server/album/runtime.js?raw';

type Options = { mobile?: boolean; reduced?: boolean; embedded?: boolean; lengths?: number[] };

function mount(layout: string, options: Options = {}) {
  const host = document.createElement('iframe');
  document.body.append(host);
  const child = host.contentWindow!;
  const doc = child.document;
  if (!options.embedded) Object.defineProperty(child, 'parent', { value: child });
  let mobile = options.mobile ?? false;
  const changes: (() => void)[] = [];
  Object.defineProperty(child, 'matchMedia', {
    value: (query: string) => ({
      get matches() {
        return query.includes('reduce') ? !!options.reduced : mobile;
      },
      addEventListener: (_: string, callback: () => void) => changes.push(callback),
    }),
  });
  let sequence = 0;
  const timers = new Map<number, { handler: () => void; wait?: number }>();
  Object.defineProperty(child, 'setTimeout', {
    value: (handler: () => void, wait?: number) => {
      timers.set(++sequence, { handler, wait });
      return sequence;
    },
  });
  Object.defineProperty(child, 'clearTimeout', { value: (id: number) => timers.delete(id) });
  child.scrollTo = vi.fn();
  const fullscreen = vi.fn().mockResolvedValue(undefined);
  const exit = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(doc.documentElement, 'requestFullscreen', { value: fullscreen });
  Object.defineProperty(doc, 'exitFullscreen', { value: exit });
  doc.body.dataset.layout = layout;
  let frame = 0;
  doc.body.innerHTML = (options.lengths ?? [3, 2])
    .map(
      (length, chapter) =>
        `<article data-cc-book><h1>Chapter ${chapter + 1}</h1><main data-cc-pages>` +
        Array.from({ length }, () => {
          const n = ++frame;
          return (
            `<figure data-cc-frame><img src="data:image/png;base64,${n}" alt="Art ${n}">` +
            `<figcaption data-cc-caption>Caption ${n}</figcaption>` +
            `<span class="palette"><i style="background:${n % 2 ? '#204060' : '#a03c58'}">` +
            '</i></span></figure>'
          );
        }).join('') +
        '</main></article>',
    )
    .join('');
  new Function('window', 'document', lightbox + '\n' + runtime)(child, doc);
  const get = <T extends HTMLElement>(selector: string) => doc.querySelector<T>(selector)!;
  const key = (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    doc.activeElement!.dispatchEvent(event);
    return event;
  };
  const visible = () =>
    [...doc.querySelectorAll<HTMLElement>('[data-cc-frame]')]
      .filter((frame) => !frame.hidden)
      .map((frame) => frame.querySelector('img')!.alt);
  const flush = (delay: number) => {
    const pending = [...timers].filter(([, timer]) => timer.wait === delay);
    pending.forEach(([id]) => timers.delete(id));
    pending.forEach(([, timer]) => timer.handler());
  };
  const from = (source: Window, data: object) =>
    child.dispatchEvent(new MessageEvent('message', { source, data }));
  const touch = (type: string, x: number, y: number, target = doc.body, fingers = 1) => {
    const event = new Event(type, { bubbles: true });
    const point = { clientX: x, clientY: y };
    Object.defineProperties(event, {
      touches: { value: type === 'touchstart' ? Array(fingers).fill(point) : [] },
      changedTouches: { value: [point] },
    });
    target.dispatchEvent(event);
  };
  return {
    child,
    doc,
    get,
    key,
    visible,
    flush,
    from,
    touch,
    fullscreen,
    exit,
    setMobile(value: boolean) {
      mobile = value;
      changes.forEach((callback) => callback());
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('album reader boundary matrix', () => {
  it.each(['flip', 'folio'])(
    '%s keeps odd chapters separate and survives a viewport change',
    (layout) => {
      const { visible, get, key, setMobile } = mount(layout);
      expect(visible()).toEqual(['Art 1', 'Art 2']);
      expect(key('ArrowLeft').defaultPrevented).toBe(true);
      expect(visible()).toEqual(['Art 1', 'Art 2']);
      key('ArrowRight');
      expect(visible()).toEqual(['Art 3']);
      expect(get('.cc-blank:not([hidden])')).toBeTruthy();
      key('ArrowRight');
      expect(visible()).toEqual(['Art 4', 'Art 5']);
      key('ArrowLeft');
      expect(visible()).toEqual(['Art 3']);
      setMobile(true);
      expect(visible()).toEqual(['Art 3']);
      key('ArrowLeft');
      expect(visible()).toEqual(['Art 2']);
      setMobile(false);
      expect(visible()).toEqual(['Art 1', 'Art 2']);
      key('End');
      expect(visible()).toEqual(['Art 4', 'Art 5']);
      expect(get<HTMLButtonElement>('[aria-label="下一页"]')).toBeDisabled();
      key('ArrowRight');
      expect(visible()).toEqual(['Art 4', 'Art 5']);
      key('Home');
      expect(get<HTMLButtonElement>('[aria-label="上一页"]')).toBeDisabled();
    },
  );

  it.each(['webtoon', 'manga', 'artbook', 'gallery', 'editorial', 'contact', 'chromatic'])(
    '%s preserves all frames until the reader explicitly chooses paging',
    (layout) => {
      const { visible, get, key } = mount(layout);
      expect(visible()).toHaveLength(5);
      key('End');
      expect(get<HTMLProgressElement>('progress').value).toBe(5);
      expect(visible()).toHaveLength(5);
      const mode = get<HTMLButtonElement>('[aria-label^="切换版式"]');
      mode.click();
      expect(visible()).toEqual(['Art 5']);
      mode.click();
      expect(visible()).toEqual(['Art 4', 'Art 5']);
      mode.click();
      expect(visible()).toHaveLength(5);
      expect(get<HTMLProgressElement>('progress').value).toBe(5);
    },
  );

  it('cinema defaults to one frame and never leaks chapter neighbours', () => {
    const { visible, key, get } = mount('cinema');
    expect(visible()).toEqual(['Art 1']);
    key(' ');
    expect(visible()).toEqual(['Art 2']);
    key(' ', { shiftKey: true });
    expect(visible()).toEqual(['Art 1']);
    key('End');
    expect(visible()).toEqual(['Art 5']);
    expect(get<HTMLProgressElement>('progress').max).toBe(5);
  });

  it('does not consume modified shortcuts, text editing or Space on controls', () => {
    const { doc, get, key } = mount('cinema');
    expect(key('ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key('ArrowRight', { metaKey: true }).defaultPrevented).toBe(false);
    expect(key('ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
    for (const tag of ['input', 'textarea', 'select', 'div']) {
      const field = doc.createElement(tag);
      if (tag === 'div') {
        field.contentEditable = 'true';
        field.setAttribute('contenteditable', 'true');
        field.tabIndex = 0;
      }
      doc.body.append(field);
      field.focus();
      expect(key('ArrowRight').defaultPrevented).toBe(false);
      expect(key('g').defaultPrevented).toBe(false);
      expect(key('f').defaultPrevented).toBe(false);
    }
    get<HTMLButtonElement>('[aria-label="下一页"]').focus();
    expect(key(' ').defaultPrevented).toBe(false);
    expect(get<HTMLProgressElement>('progress').value).toBe(1);
  });

  it('keeps the directory focused, lazy, bounded and reversible with Escape', () => {
    const { doc, get, key, visible } = mount('folio');
    expect(get('.mio-thumbnails').childElementCount).toBe(0);
    key('g');
    const thumbs = get('.mio-thumbnails');
    expect(thumbs.childElementCount).toBe(5);
    expect(doc.activeElement).toBe(thumbs.children[0]);
    expect([...thumbs.querySelectorAll('img')].map((image) => image.loading)).toEqual(
      Array(5).fill('lazy'),
    );
    expect(thumbs.children[3]).toHaveAttribute('aria-label', 'Chapter 2 · 4 · Art 4');
    key('ArrowRight');
    key('End');
    expect(visible()).toEqual(['Art 1', 'Art 2']);
    key('Escape');
    expect(get('.mio-tray').hidden).toBe(true);
    expect(doc.activeElement).toBe(get('[aria-controls=mio-reader-directory]'));
    key('g');
    expect(thumbs.childElementCount).toBe(5);
    (thumbs.children[4] as HTMLButtonElement).click();
    expect(visible()).toEqual(['Art 4', 'Art 5']);
    expect(thumbs.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(thumbs.children[4]).toHaveAttribute('aria-current', 'true');
  });

  it('auto hides controls and wakes them on interaction without hiding an open directory', () => {
    const { doc, get, key, flush } = mount('cinema');
    flush(3500);
    expect(get('.mio-controls')).toHaveAttribute('data-idle');
    doc.dispatchEvent(new Event('pointermove'));
    expect(get('.mio-controls')).not.toHaveAttribute('data-idle');
    key('g');
    flush(3500);
    expect(get('.mio-controls')).not.toHaveAttribute('data-idle');
    key('Escape');
    flush(3500);
    expect(get('.mio-controls')).toHaveAttribute('data-idle');
  });

  it('enters and exits fullscreen and tolerates an embed denial', async () => {
    const { doc, key, fullscreen, exit } = mount('cinema');
    key('f');
    expect(fullscreen).toHaveBeenCalledOnce();
    Object.defineProperty(doc, 'fullscreenElement', {
      value: doc.documentElement,
      configurable: true,
    });
    key('f');
    expect(exit).toHaveBeenCalledOnce();
    Object.defineProperty(doc, 'fullscreenElement', { value: null });
    fullscreen.mockRejectedValueOnce(new Error('Fullscreen denied by embedding policy'));
    key('f');
    await Promise.resolve();
    expect(fullscreen).toHaveBeenCalledTimes(2);
  });

  it('distinguishes swipes from taps, multitouch, vertical scroll and controls', () => {
    const { get, visible, touch } = mount('cinema');
    const art = get<HTMLImageElement>('[data-cc-frame] img');
    touch('touchstart', 140, 30, art);
    touch('touchend', 120, 31, art);
    expect(visible()).toEqual(['Art 1']);
    touch('touchstart', 140, 30, art, 2);
    touch('touchend', 20, 31, art);
    expect(visible()).toEqual(['Art 1']);
    touch('touchstart', 140, 30, art);
    touch('touchend', 20, 200, art);
    expect(visible()).toEqual(['Art 1']);
    const next = get<HTMLButtonElement>('[aria-label="下一页"]');
    touch('touchstart', 140, 30, next);
    touch('touchend', 20, 31, next);
    expect(visible()).toEqual(['Art 1']);
    touch('touchstart', 140, 30, art);
    touch('touchcancel', 20, 31, art);
    touch('touchend', 20, 31, art);
    expect(visible()).toEqual(['Art 1']);
    touch('touchstart', 140, 30, art);
    touch('touchend', 20, 31, art);
    expect(visible()).toEqual(['Art 2']);
    art.click();
    expect(get('.cc-lightbox').hidden).toBe(true);
  });

  it('keeps lightbox gestures separate, disables swipe while zoomed and restores inert state', () => {
    const { doc, get, key, touch } = mount('cinema', { reduced: true });
    const existing = doc.createElement('div');
    existing.setAttribute('inert', '');
    doc.body.append(existing);
    const image = get<HTMLImageElement>('[data-cc-frame] img');
    image.focus();
    image.click();
    const preview = get<HTMLImageElement>('.cc-lightbox img');
    const viewport = get('.cc-lightbox-viewport');
    get<HTMLButtonElement>('.cc-lightbox-zoom').click();
    expect(viewport).toHaveAttribute('tabindex', '0');
    touch('touchstart', 140, 30, preview);
    touch('touchend', 20, 31, preview);
    expect(preview.alt).toBe('Art 1');
    viewport.focus();
    expect(key('ArrowRight').defaultPrevented).toBe(false);
    expect(preview.alt).toBe('Art 1');
    get<HTMLButtonElement>('.cc-lightbox-zoom').click();
    touch('touchstart', 140, 30, preview);
    touch('touchend', 20, 31, preview);
    expect(preview.alt).toBe('Art 2');
    expect(get<HTMLProgressElement>('progress').value).toBe(1);
    key('Escape');
    expect(doc.activeElement).toBe(image);
    expect(existing).toHaveAttribute('inert');
    expect(image.closest('article')).not.toHaveAttribute('inert');
    expect(doc.body.style.overflow).toBe('');
  });

  it('hides captions in immersive lightbox while preserving artwork alt text', () => {
    const { get } = mount('cinema');
    get<HTMLButtonElement>('.mio-controls [aria-pressed=false]').click();
    get<HTMLImageElement>('[data-cc-frame] img').click();
    expect(get('.cc-lightbox figcaption').textContent).toBe('');
    expect(get<HTMLImageElement>('.cc-lightbox img').alt).toBe('Art 1');
  });

  it('accepts only parent commands and clamps restored position without trusting malformed values', () => {
    const { child, get, from, key, flush, visible } = mount('folio', { embedded: true });
    const parent = child.parent;
    const post = vi.spyOn(parent, 'postMessage').mockImplementation(() => {});
    from(child, { type: 'mio-reader-restore', frame: 4, mode: 'single' });
    from(parent, { type: 'mio-reader-turn', direction: '1' });
    from(parent, { type: 'mio-reader-turn', direction: 0 });
    expect(visible()).toEqual(['Art 1', 'Art 2']);
    from(parent, { type: 'mio-reader-restore', frame: 999, mode: 'single', y: -40 });
    expect(visible()).toEqual(['Art 5']);
    expect(child.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    from(parent, { type: 'mio-reader-restore', frame: -99, mode: 'invalid', y: Infinity });
    expect(visible()).toEqual(['Art 1']);
    expect(get('[aria-label^="切换版式"]')).toHaveTextContent('单页');
    key('ArrowRight');
    flush(120);
    expect(post).toHaveBeenLastCalledWith(
      { type: 'mio-reader-state', y: 0, spread: 1, frame: 1, mode: 'single' },
      '*',
    );
    expect(post).toHaveBeenCalledOnce();
  });

  it('suppresses both page and lightbox transitions with reduced motion', () => {
    const { get, key } = mount('folio', { reduced: true });
    key('ArrowRight');
    expect(get('[data-mio-enter]')).toBeNull();
    get<HTMLImageElement>('[data-cc-frame]:not([hidden]) img').click();
    expect(get('.cc-lightbox').style.transition).toBe('none');
  });
});
