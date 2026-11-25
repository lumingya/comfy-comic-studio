import { afterEach, describe, expect, it, vi } from 'vitest';
import lightbox from '../../../server/mio_server/album/runtime_lightbox.js?raw';
import runtime from '../../../server/mio_server/album/runtime.js?raw';

function mount(layout = 'contact') {
  const host = document.createElement('iframe');
  document.body.append(host);
  const child = host.contentWindow!;
  Object.defineProperty(child, 'parent', { value: child });
  Object.defineProperty(child, 'matchMedia', { value: () => ({ matches: false }) });
  child.scrollTo = vi.fn();
  const doc = child.document;
  doc.body.dataset.layout = layout;
  doc.body.style.overflow = 'clip';
  doc.body.innerHTML =
    '<aside inert>Existing inert content</aside><article data-cc-book><main data-cc-pages>' +
    Array.from(
      { length: 3 },
      (_, index) =>
        '<figure data-cc-frame><div class="film-stamp"><span>FRAME ' +
        (index + 1) +
        '</span></div><div class="art"><img src="data:image/png;base64,AA==" alt="画作 ' +
        (index + 1) +
        '"></div><figcaption data-cc-caption>台词 ' +
        (index + 1) +
        '</figcaption><button type="button" data-secondary>Other action</button></figure>',
    ).join('') +
    '</main></article>';
  new Function('window', 'document', lightbox + '\n' + runtime)(child, doc);
  const get = <T extends HTMLElement>(selector: string) => doc.querySelector<T>(selector)!;
  const frames = [...doc.querySelectorAll<HTMLElement>('[data-cc-frame]')];
  const key = (value: string, target = doc.activeElement!) => {
    const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  return { doc, get, frames, key };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('contact-sheet preview targets', () => {
  it.each(['.film-stamp span', '.art img', 'figcaption', null])(
    'opens frame two from %s and restores focus to that frame',
    (selector) => {
      const { doc, get, frames, key } = mount();
      const frame = frames[1];
      const target = selector ? frame.querySelector<HTMLElement>(selector)! : frame;
      target.click();

      expect(get('.cc-lightbox').hidden).toBe(false);
      expect(get('.cc-lightbox')).toHaveAttribute('aria-label', '画作 2，2 / 3');
      expect(doc.activeElement).toBe(get('.cc-lightbox-close'));
      expect(get('article')).toHaveAttribute('inert');
      expect(doc.body.style.overflow).toBe('hidden');

      key('Escape');
      expect(get('.cc-lightbox').hidden).toBe(true);
      expect(doc.activeElement).toBe(frame);
      expect(get('article')).not.toHaveAttribute('inert');
      expect(get('aside')).toHaveAttribute('inert');
      expect(doc.body.style.overflow).toBe('clip');
    },
  );

  it.each(['Enter', ' '])('opens the focused frame with %s and closes back to it', (value) => {
    const { doc, get, frames, key } = mount();
    const frame = frames[2];
    frame.focus();
    expect(key(value).defaultPrevented).toBe(true);
    expect(get('.cc-lightbox').hidden).toBe(false);
    expect(get('.cc-lightbox')).toHaveAttribute('aria-label', '画作 3，3 / 3');
    get('.cc-lightbox-close').click();
    expect(get('.cc-lightbox').hidden).toBe(true);
    expect(doc.activeElement).toBe(frame);
  });

  it('exposes one frame preview tab stop and preserves separate nested actions', () => {
    const { get, frames, key } = mount();
    for (const frame of frames) {
      expect(frame).toHaveAttribute('role', 'button');
      expect(frame).toHaveAttribute('tabindex', '0');
      expect(frame).toHaveAttribute('aria-label', expect.stringContaining('打开画作预览：画作'));
      expect(frame.querySelector('img')).toHaveAttribute('tabindex', '-1');
      expect(frame.querySelector('img')).not.toHaveAttribute('role');
    }
    const action = frames[1].querySelector<HTMLButtonElement>('[data-secondary]')!;
    const listener = vi.fn();
    action.addEventListener('click', listener);
    action.click();
    action.focus();
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(get('.cc-lightbox').hidden).toBe(true);
  });

  it.each(['gallery', 'cinema', 'folio', 'editorial'])(
    'keeps the image preview trigger for %s',
    (layout) => {
      const { doc, get, frames, key } = mount(layout);
      const frame = frames[0];
      const image = frame.querySelector<HTMLImageElement>('img')!;
      expect(frame).not.toHaveAttribute('role', 'button');
      expect(image).toHaveAttribute('role', 'button');
      expect(image).toHaveAttribute('tabindex', '0');
      frame.click();
      expect(get('.cc-lightbox').hidden).toBe(true);
      image.focus();
      key('Enter');
      expect(get('.cc-lightbox').hidden).toBe(false);
      key('Escape');
      expect(doc.activeElement).toBe(image);
    },
  );

  it('mirrors horizontal lightbox keys and glyphs only for an explicit RTL reader', () => {
    const { doc, get, frames, key } = mount('editorial');
    doc.body.dataset.mioDirection = 'rtl';
    frames[0].querySelector<HTMLImageElement>('img')!.click();
    expect(get('.cc-lightbox-previous')).toHaveTextContent('›');
    expect(get('.cc-lightbox-next')).toHaveTextContent('‹');
    key('ArrowLeft');
    expect(get('.cc-lightbox')).toHaveAttribute('aria-label', '画作 2，2 / 3');
    key('ArrowRight');
    expect(get('.cc-lightbox')).toHaveAttribute('aria-label', '画作 1，1 / 3');
    get('.cc-lightbox-next').click();
    expect(get('.cc-lightbox')).toHaveAttribute('aria-label', '画作 2，2 / 3');
    get('.cc-lightbox-zoom').click();
    get('.cc-lightbox-viewport').focus();
    key('ArrowLeft');
    expect(get('.cc-lightbox')).toHaveAttribute('aria-label', '画作 2，2 / 3');
    key('Escape');
    delete doc.body.dataset.mioDirection;
    frames[0].querySelector<HTMLImageElement>('img')!.click();
    expect(get('.cc-lightbox-previous')).toHaveTextContent('‹');
    expect(get('.cc-lightbox-next')).toHaveTextContent('›');
    key('ArrowRight');
    expect(get('.cc-lightbox')).toHaveAttribute('aria-label', '画作 2，2 / 3');
  });
});
