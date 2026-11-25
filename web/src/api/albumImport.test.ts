import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { importAlbumHtml } from './albumImport';

afterEach(() => vi.unstubAllGlobals());

it('streams the original HTML file as an octet-stream with the caller abort signal', async () => {
  const report = {
    series_ids: ['book'],
    episode_ids: ['episode'],
    imported_books: 1,
    imported_frames: 2,
    imported_assets: 2,
    source_data_used: true,
    warnings: [],
  };
  const fetch = vi.fn().mockResolvedValue(Response.json(report));
  vi.stubGlobal('fetch', fetch);
  const file = new File(['<html>reading album</html>'], 'album.html');
  const controller = new AbortController();
  expect(await importAlbumHtml(file, controller.signal)).toEqual(report);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/imports/album-html'), {
    method: 'POST',
    body: file,
    signal: controller.signal,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
});

it('reports server validation errors through the shared API error envelope', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ detail: 'invalid album' }, { status: 422 })),
  );
  await expect(
    importAlbumHtml(new File(['invalid'], 'album.html'), new AbortController().signal),
  ).rejects.toEqual(new ApiError('invalid album', 422, 'invalid'));
});

it('does not start a request after cancellation', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  controller.abort();
  await expect(importAlbumHtml(new File([], 'album.html'), controller.signal)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
