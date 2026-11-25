import { describe, expect, it, vi } from 'vitest';
import { IMAGE_HEADER_LIMIT, readImageDimensions } from './imageHeader';

function text(bytes: Uint8Array, offset: number, value: string) {
  bytes.set(
    [...value].map((char) => char.charCodeAt(0)),
    offset,
  );
}

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  text(bytes, 0, '\x89PNG\r\n\x1a\n');
  const data = new DataView(bytes.buffer);
  data.setUint32(8, 13);
  text(bytes, 12, 'IHDR');
  data.setUint32(16, width);
  data.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function gif(width: number, height: number, version = '89a'): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(13);
  text(bytes, 0, `GIF${version}`);
  const data = new DataView(bytes.buffer);
  data.setUint16(6, width, true);
  data.setUint16(8, height, true);
  return bytes;
}

function jpeg(width: number, height: number, marker = 0xc0): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    0,
    4,
    0x12,
    0x34,
    0xff,
    0xff,
    marker,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
  ]);
}

function webp(
  width: number,
  height: number,
  chunk: 'VP8X' | 'VP8L' | 'VP8 ',
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(chunk === 'VP8L' ? 26 : 30);
  text(bytes, 0, 'RIFF');
  const data = new DataView(bytes.buffer);
  data.setUint32(4, bytes.length - 8, true);
  text(bytes, 8, 'WEBP');
  text(bytes, 12, chunk);
  data.setUint32(16, chunk === 'VP8L' ? 5 : 10, true);
  if (chunk === 'VP8X') {
    const uint24 = (offset: number, value: number) => {
      bytes[offset] = value & 255;
      bytes[offset + 1] = (value >> 8) & 255;
      bytes[offset + 2] = (value >> 16) & 255;
    };
    uint24(24, width - 1);
    uint24(27, height - 1);
  } else if (chunk === 'VP8L') {
    bytes[20] = 0x2f;
    data.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  } else {
    text(bytes, 23, '\x9d\x01\x2a');
    data.setUint16(26, width, true);
    data.setUint16(28, height, true);
  }
  return bytes;
}

function read(bytes: Uint8Array<ArrayBuffer>, mime: string) {
  return readImageDimensions(new Blob([bytes], { type: mime }), new AbortController().signal);
}

describe('bounded image header preflight', () => {
  it.each([
    ['PNG', 'image/png', png(123, 456)],
    ['GIF87a', 'image/gif', gif(123, 456, '87a')],
    ['GIF89a', 'image/gif', gif(123, 456)],
    ['baseline JPEG', 'image/jpeg', jpeg(123, 456)],
    ['progressive JPEG', 'image/jpeg', jpeg(123, 456, 0xc2)],
    ['extended WebP', 'image/webp', webp(123, 456, 'VP8X')],
    ['lossless WebP', 'image/webp', webp(123, 456, 'VP8L')],
    ['lossy WebP', 'image/webp', webp(123, 456, 'VP8 ')],
  ] as const)('reads %s dimensions without decoding the pixels', async (_name, mime, bytes) => {
    await expect(read(bytes, mime)).resolves.toEqual({ width: 123, height: 456 });
  });

  it.each([
    ['unknown MIME', 'image/svg+xml', png(1, 1)],
    ['mismatched MIME', 'image/jpeg', png(1, 1)],
    ['zero PNG width', 'image/png', png(0, 1)],
    ['zero GIF height', 'image/gif', gif(1, 0)],
    ['zero JPEG width', 'image/jpeg', jpeg(0, 1)],
    ['zero lossy WebP width', 'image/webp', webp(0, 1, 'VP8 ')],
    ['truncated PNG', 'image/png', png(1, 1).slice(0, 24)],
    ['truncated GIF', 'image/gif', gif(1, 1).slice(0, 10)],
    ['truncated JPEG', 'image/jpeg', jpeg(1, 1).slice(0, 20)],
    ['truncated WebP', 'image/webp', webp(1, 1, 'VP8X').slice(0, 29)],
    ['JPEG without SOF', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xda])],
    ['JPEG EOI before SOF', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    ['invalid JPEG segment', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 1])],
  ] as const)('rejects %s', async (_name, mime, bytes) => {
    await expect(read(bytes, mime)).resolves.toBeNull();
  });

  it('rejects malformed PNG and WebP header fields', async () => {
    const badPng = png(1, 1);
    badPng[25] = 5;
    const badRiff = webp(1, 1, 'VP8X');
    badRiff[4]++;
    const badLossless = webp(1, 1, 'VP8L');
    badLossless[24] |= 0x20;
    const badLossy = webp(1, 1, 'VP8 ');
    badLossy[23] = 0;
    const badExtended = webp(1, 1, 'VP8X');
    badExtended[20] = 0x80;
    for (const [bytes, mime] of [
      [badPng, 'image/png'],
      [badRiff, 'image/webp'],
      [badLossless, 'image/webp'],
      [badLossy, 'image/webp'],
      [badExtended, 'image/webp'],
    ] as const)
      await expect(read(bytes, mime)).resolves.toBeNull();
  });

  it('reads only a native Blob slice of at most 1 MiB', async () => {
    const blob = new Blob([png(2, 3), new Uint8Array(2 * IMAGE_HEADER_LIMIT)], {
      type: 'image/png',
    });
    const slice = vi.spyOn(Blob.prototype, 'slice');
    const readHeader = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    // Instance overrides must not cause the host to read an entire upload.
    Object.defineProperty(blob, 'slice', { value: vi.fn(() => blob) });
    try {
      await expect(readImageDimensions(blob, new AbortController().signal)).resolves.toEqual({
        width: 2,
        height: 3,
      });
      expect(slice).toHaveBeenCalledExactlyOnceWith(0, IMAGE_HEADER_LIMIT);
      expect(readHeader).toHaveBeenCalledOnce();
      expect(readHeader.mock.calls[0][0].size).toBe(IMAGE_HEADER_LIMIT);
    } finally {
      slice.mockRestore();
      readHeader.mockRestore();
    }
  });

  it('gracefully rejects JPEG frame headers beyond the bounded prefix', async () => {
    const segment = new Uint8Array(65537);
    segment.set([0xff, 0xe1, 0xff, 0xff]);
    const blob = new Blob(
      [
        new Uint8Array([0xff, 0xd8]),
        ...Array.from({ length: 16 }, () => segment),
        jpeg(2, 3).slice(8),
      ],
      { type: 'image/jpeg' },
    );
    await expect(readImageDimensions(blob, new AbortController().signal)).resolves.toBeNull();
  });

  it('cancels a pending bounded header read and never starts one after abort', async () => {
    const controller = new AbortController();
    const abort = vi.spyOn(FileReader.prototype, 'abort');
    const readHeader = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    const blob = new Blob([png(2, 3)], { type: 'image/png' });
    try {
      const pending = readImageDimensions(blob, controller.signal);
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(abort).toHaveBeenCalledOnce();
      await expect(readImageDimensions(blob, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(readHeader).toHaveBeenCalledOnce();
    } finally {
      abort.mockRestore();
      readHeader.mockRestore();
    }
  });
});
