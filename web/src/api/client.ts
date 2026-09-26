import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

/** Error thrown for every non-2xx response; `kind` mirrors the server's error envelope. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: string = 'error',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';

// Resolve fetch per request (not at import time) so tests and polyfills can replace it.
export const api = createClient<paths>({
  baseUrl: origin,
  fetch: (request) => globalThis.fetch(request),
});

async function toError(response: Response): Promise<ApiError> {
  let detail: unknown = response.statusText;
  let kind = 'error';
  try {
    const body = await response.clone().json();
    detail = body?.detail ?? detail;
    kind = body?.kind ?? (response.status === 422 ? 'invalid' : kind);
  } catch {
    /* not JSON */
  }
  if (Array.isArray(detail)) {
    detail = detail.map((d) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`).join('；');
  }
  return new ApiError(String(detail || `HTTP ${response.status}`), response.status, kind);
}

const throwOnError: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) throw await toError(response);
    return undefined;
  },
};
api.use(throwOnError);

/** openapi-fetch returns `{ data, error }`; errors already threw in the middleware. */
export function data<T>(result: { data?: T }): T {
  return result.data as T;
}

/** For endpoints outside the typed surface (binary uploads / downloads). */
export async function raw(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${origin}${path}`, init);
  if (!response.ok) throw await toError(response);
  return response;
}

export function assetUrl(assetId: string, thumb = 0): string {
  return `/api/assets/${assetId}${thumb ? `?thumb=${thumb}` : ''}`;
}

export async function uploadAsset(file: Blob, filename = ''): Promise<{ id: string }> {
  const q = filename ? `?filename=${encodeURIComponent(filename)}` : '';
  const response = await raw(`/api/assets${q}`, { method: 'POST', body: file });
  return response.json();
}

/** Trigger a browser download for a GET endpoint that answers with an attachment. */
export async function download(path: string, fallbackName: string): Promise<void> {
  await saveResponse(await raw(path), fallbackName);
}

/** Same as {@link download} for endpoints that take a JSON body (e.g. album export). */
export async function downloadPost(path: string, body: unknown, fallbackName: string) {
  const response = await raw(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  await saveResponse(response, fallbackName);
}

async function saveResponse(response: Response, fallbackName: string): Promise<void> {
  const blob = await response.blob();
  const header = response.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
