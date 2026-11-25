import { afterEach, describe, expect, it, vi } from 'vitest';
import lightbox from '../../../server/mio_server/album/runtime_lightbox.js?raw';
import runtime from '../../../server/mio_server/album/runtime.js?raw';

function mount({ zine = true, layout = 'editorial', mobile = false } = {}) {
  const host = document.createElement('iframe');
  document.body.append(host);
  const child = host.contentWindow!;
  const doc = child.document;
  Object.defineProperty(child, 'parent', { value: child });
  Object.defineProperty(child, 'matchMedia', {
    value: (query: string) => ({ matches: query.includes('reduce') ? false : mobile }),
  });
  Object.defineProperty(child, 'setTimeout', { value: () => 0 });
  Object.defineProperty(child, 'clearTimeout', { value: () => {} });
  let y = 0;
  let animation: FrameRequestCallback | undefined;
  Object.defineProperty(child, 'scrollY', { get: () => y });
  child.scrollTo = vi.fn((options: ScrollToOptions | number = {}) => {
    y = Math.min(100, Math.max(0, typeof options === 'number' ? options : (options.top ?? 0)));
  });
  child.requestAnimationFrame = (callback) => {
    animation = callback;
    return 1;
  };
  doc.body.dataset.layout = layout;
  doc.body.innerHTML =
    `<article class="${zine ? 'zine' : ''}" data-cc-book><main data-cc-pages>` +
    Array.from(
      { length: 4 },
      (_, index) =>
        `<figure data-cc-frame><img alt="Art ${index + 1}" src="data:image/png;base64,AA==">` +
        `<figcaption data-cc-caption>Caption ${index + 1}</figcaption></figure>`,
    ).join('') +
    '</main></article>';
  [...doc.querySelectorAll<HTMLElement>('[data-cc-frame]')].forEach((frame, index) => {
    frame.getBoundingClientRect = () => ({
      x: 0,
      y: 100 + index * 100 - y,
      top: 100 + index * 100 - y,
      bottom: 190 + index * 100 - y,
      left: 0,
      right: 100,
      width: 100,
      height: 90,
      toJSON: () => ({}),
    });
  });
  new Function('window', 'document', lightbox + '\n' + runtime)(child, doc);
  const get = <T extends HTMLElement>(selector: string) => doc.querySelector<T>(selector)!;
  const key = (key: string) =>
    doc.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  const direction = (value: string) => {
    const control = get<HTMLSelectElement>('.mio-reading-direction');
    control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const visible = () =>
    [...doc.querySelectorAll<HTMLElement>('[data-cc-frame]')]
      .filter((frame) => !frame.hidden)
      .map((frame) => frame.querySelector('img')!.alt);
  const scroll = (position = y) => {
    y = position;
    child.dispatchEvent(new Event('scroll'));
    const callback = animation;
    animation = undefined;
    callback?.(0);
  };
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true });
    const point = { clientX: x, clientY: 200 };
    Object.defineProperties(event, {
      touches: { value: type === 'touchstart' ? [point] : [] },
      changedTouches: { value: [point] },
    });
    doc.body.dispatchEvent(event);
  };
  return { child, doc, get, key, direction, visible, scroll, touch };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('offline Zine reading direction and explicit navigation', () => {
  it.each(['gallery', 'contact', 'editorial'])(
    '%s keeps an explicit last-frame selection at a clamped scroll position and still follows manual scrolling',
    (layout) => {
      const { get, key, scroll } = mount({ zine: false, layout });
      key('End');
      expect(get<HTMLProgressElement>('progress').value).toBe(4);
      scroll();
      expect(get<HTMLProgressElement>('progress').value).toBe(4);
      scroll(0);
      expect(get<HTMLProgressElement>('progress').value).toBe(2);
    },
  );

  it.each(['gallery', 'contact', 'editorial', 'folio'])(
    '%s does not acquire a Zine direction control',
    (layout) => {
      const { doc } = mount({ zine: false, layout });
      expect(doc.querySelector('.mio-reading-direction')).toBeNull();
      expect(doc.body).not.toHaveAttribute('data-mio-direction');
    },
  );

  it('switches between a long strip, LTR and RTL spreads without changing logical frame order', () => {
    const { doc, get, key, direction, visible } = mount();
    expect(get<HTMLSelectElement>('.mio-reading-direction').value).toBe('webtoon');
    expect(visible()).toHaveLength(4);
    direction('ltr');
    expect(visible()).toEqual(['Art 1', 'Art 2']);
    key('ArrowRight');
    expect(visible()).toEqual(['Art 3', 'Art 4']);
    expect(get('[data-mio-enter]')).toHaveAttribute('data-mio-turn', 'left');
    key('Home');
    direction('rtl');
    expect(doc.body).toHaveAttribute('data-mio-direction', 'rtl');
    expect(get('[data-cc-frame]')).toHaveAttribute('data-mio-leaf', 'right');
    key('ArrowLeft');
    expect(visible()).toEqual(['Art 3', 'Art 4']);
    expect(get('[data-mio-enter]')).toHaveAttribute('data-mio-turn', 'right');
    key('ArrowRight');
    expect(visible()).toEqual(['Art 1', 'Art 2']);
    expect(get('[data-mio-enter]')).toHaveAttribute('data-mio-turn', 'left');
    direction('webtoon');
    expect(doc.body).not.toHaveAttribute('data-mio-paged');
    expect(doc.body).toHaveAttribute('data-mio-direction', 'webtoon');
    expect(visible()).toHaveLength(4);
  });

  it('uses a rightward swipe to advance RTL single pages and keeps lightbox arrows consistent', () => {
    const { doc, get, direction, visible, touch, key } = mount({ mobile: true });
    direction('rtl');
    expect(visible()).toEqual(['Art 1']);
    touch('touchstart', 80);
    touch('touchend', 300);
    expect(visible()).toEqual(['Art 2']);
    const image = get<HTMLImageElement>('[data-cc-frame]:not([hidden]) img');
    image.focus();
    key('Enter');
    expect(get('.cc-lightbox')).not.toHaveAttribute('hidden');
    key('ArrowLeft');
    expect(get<HTMLImageElement>('.cc-lightbox img').alt).toBe('Art 3');
    key('ArrowRight');
    expect(get<HTMLImageElement>('.cc-lightbox img').alt).toBe('Art 2');
    key('Escape');
    expect(doc.activeElement).toBe(image);
  });
});
