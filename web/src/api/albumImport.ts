import { raw } from './client';
import type { components } from './schema';

/** Matches the bounded streaming upload accepted by the album HTML importer. */
export const MAX_ALBUM_HTML_BYTES = 1024 ** 3;

export type AlbumHtmlImportResult = components['schemas']['AlbumImportResult'];

/** Upload the original file directly; never read or execute its HTML in the browser. */
export async function importAlbumHtml(
  file: File,
  signal: AbortSignal,
): Promise<AlbumHtmlImportResult> {
  signal.throwIfAborted();
  const response = await raw('/api/imports/album-html', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
    signal,
  });
  return response.json() as Promise<AlbumHtmlImportResult>;
}
