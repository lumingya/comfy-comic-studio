import { afterEach, describe, expect, it, vi } from 'vitest';
import lightbox from '../../../server/mio_server/album/runtime_lightbox.js?raw';
import runtime from '../../../server/mio_server/album/runtime.js?raw';

function mountWrappedArtwork() {
  const host = document.createElement('iframe');
  document.body.append(host);
  const child = host.contentWindow!;
  Object.defineProperty(child, 'parent', { value: child });
  Object.defineProperty(child, 'matchMedia', { value: () => ({ matches: false }) });
  child.scrollTo = vi.fn();
  const doc = child.document;
  doc.body.dataset.layout = 'gallery';
  doc.body.style.overflow = 'clip';
  doc.body.innerHTML =
    '<aside inert>Already unavailable</aside>' +
    '<article data-cc-book><main data-cc-pages><figure data-cc-frame>' +
    '<button type="button" data-ag-view><img src="data:image/png;base64,AA==" alt="Art"></button>' +
    '<figcaption data-cc-caption>Caption</figcaption></figure></main></article>';
  new Function('window', 'document', lightbox + '\n' + runtime)(child, doc);
  const get = <T extends HTMLElement>(selector: string) => doc.querySelector<T>(selector)!;
  return { doc, get };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('offline lightbox wrapping artwork triggers', () => {
  it.each(['button', 'Escape'])('restores the reader after closing with %s', (closeWith) => {
    const { doc, get } = mountWrappedArtwork();
    const image = get<HTMLImageElement>('[data-cc-frame] img');
    const trigger = get<HTMLButtonElement>('[data-ag-view]');
    const dialog = get('.cc-lightbox');
    const close = get<HTMLButtonElement>('.cc-lightbox-close');

    // The actual image click bubbles through its explicit trigger, calling both listeners.
    image.click();
    expect(dialog.hidden).toBe(false);
    expect(get('article')).toHaveAttribute('inert');
    expect(get('.mio-controls')).toHaveAttribute('inert');
    expect(doc.body.style.overflow).toBe('hidden');
    expect(doc.activeElement).toBe(close);

    if (closeWith === 'button') close.click();
    else close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(dialog.hidden).toBe(true);
    expect(get('article')).not.toHaveAttribute('inert');
    expect(get('.mio-controls')).not.toHaveAttribute('inert');
    expect(get('aside')).toHaveAttribute('inert');
    expect(doc.body.style.overflow).toBe('clip');
    expect(doc.activeElement).toBe(trigger);

    trigger.click();
    expect(dialog.hidden).toBe(false);
    close.click();
    expect(get('article')).not.toHaveAttribute('inert');
    expect(doc.body.style.overflow).toBe('clip');
    expect(doc.activeElement).toBe(trigger);
  });
});
