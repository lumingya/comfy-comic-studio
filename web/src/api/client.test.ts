import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/utils';
import { api, ApiError, assetUrl, data, download, downloadFile, downloadPost, raw } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('returns data for 2xx', async () => {
    mockFetch({ 'GET /api/series': [{ id: 's1', title: 'A' }] });
    const list = data(await api.GET('/api/series', {}));
    expect(list).toEqual([{ id: 's1', title: 'A' }]);
  });

  it('turns the server error envelope into ApiError', async () => {
    mockFetch({
      'GET /api/series/nope': new Response(
        JSON.stringify({ detail: '作品不存在', kind: 'not_found' }),
        { status: 404 },
      ),
    });
    const err = await api
      .GET('/api/series/{series_id}', { params: { path: { series_id: 'nope' } } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, kind: 'not_found', message: '作品不存在' });
  });

  it('flattens FastAPI validation errors', async () => {
    mockFetch({
      'POST /api/series': new Response(
        JSON.stringify({ detail: [{ loc: ['body', 'title'], msg: 'Field required' }] }),
        { status: 422 },
      ),
    });
    const err = await api.POST('/api/series', { body: { title: '' } }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 422, kind: 'invalid', message: 'title: Field required' });
  });

  it('falls back to the status text for non-JSON errors', async () => {
    mockFetch({ 'GET /api/x': new Response('boom', { status: 502, statusText: 'Bad Gateway' }) });
    await expect(raw('/api/x')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
  });

  it('builds asset URLs with optional thumbnails', () => {
    expect(assetUrl('a1')).toBe('/api/assets/a1');
    expect(assetUrl('a1', 240)).toBe('/api/assets/a1?thumb=240');
  });

  it('hands completed files to the native downloader and cancels the header probe without buffering', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('雨后书店.pdf')}`,
        'X-Mio-Export': '{"profile":"publish"}',
      },
    });
    const blob = vi.spyOn(response, 'blob');
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download });
    });
    const calls = mockFetch({ 'GET /api/export/jobs/job_1/file': response });
    const result = await downloadFile('/api/export/jobs/job_1/file', 'fallback.pdf');
    expect(result.headers.get('X-Mio-Export')).toBe('{"profile":"publish"}');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(blob).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(clicks).toEqual([
      { href: `${window.location.origin}/api/export/jobs/job_1/file`, download: '雨后书店.pdf' },
    ]);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('does not start a native download when the export file is missing', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    mockFetch({
      'GET /api/export/jobs/job_missing/file': new Response(
        JSON.stringify({ detail: '导出文件不存在' }),
        { status: 404 },
      ),
    });
    await expect(
      downloadFile('/api/export/jobs/job_missing/file', 'album.pdf'),
    ).rejects.toMatchObject({ status: 404, message: '导出文件不存在' });
    expect(click).not.toHaveBeenCalled();
  });

  it('does not start the native transfer if the caller closes while checking the file', async () => {
    const controller = new AbortController();
    const response = new Response(
      new ReadableStream({
        cancel() {
          controller.abort();
        },
      }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    mockFetch({ 'GET /api/export/jobs/job_1/file': response });
    await expect(
      downloadFile('/api/export/jobs/job_1/file', 'album.pdf', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(click).not.toHaveBeenCalled();
  });

  it('propagates cancellation signals through buffered GET and POST downloads', async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:download'),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return new Response(new Blob(['archive']), {
        headers: { 'Content-Disposition': 'attachment; filename="archive.zip"' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await download('/api/source', 'source.zip', controller.signal);
    await downloadPost('/api/kit', { title: 'kit' }, 'kit.zip', controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals).toEqual([controller.signal, controller.signal]);
  });

  it('does not save a buffered file when cancellation happens during body reading', async () => {
    const controller = new AbortController();
    let finishBlob!: (blob: Blob) => void;
    const response = new Response();
    vi.spyOn(response, 'blob').mockReturnValue(
      new Promise((resolve) => {
        finishBlob = resolve;
      }),
    );
    const createObjectURL = vi.fn(() => 'blob:download');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );

    const pending = downloadPost('/api/kit', {}, 'kit.zip', controller.signal);
    await vi.waitFor(() => expect(finishBlob).toBeDefined());
    controller.abort();
    finishBlob(new Blob(['archive']));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
