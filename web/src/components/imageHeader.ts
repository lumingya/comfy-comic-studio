export const IMAGE_HEADER_LIMIT = 1024 * 1024;

type ImageDimensions = { width: number; height: number };

function matches(bytes: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

function dimensions(width: number, height: number): ImageDimensions | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function parseHeader(bytes: Uint8Array, mime: string, fileSize: number): ImageDimensions | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') {
    if (
      bytes.length < 33 ||
      !matches(bytes, 0, '\x89PNG\r\n\x1a\n') ||
      data.getUint32(8) !== 13 ||
      !matches(bytes, 12, 'IHDR') ||
      data.getUint32(16) > 0x7fffffff ||
      data.getUint32(20) > 0x7fffffff ||
      !(
        { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] } as Record<
          number,
          number[]
        >
      )[bytes[25]]?.includes(bytes[24]) ||
      bytes[26] !== 0 ||
      bytes[27] !== 0 ||
      bytes[28] > 1
    )
      return null;
    return dimensions(data.getUint32(16), data.getUint32(20));
  }
  if (mime === 'image/gif') {
    if (bytes.length < 13 || (!matches(bytes, 0, 'GIF87a') && !matches(bytes, 0, 'GIF89a')))
      return null;
    return dimensions(data.getUint16(6, true), data.getUint16(8, true));
  }
  if (mime === 'image/jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      // Stop before scan data; a missing or out-of-budget frame header is not safe to infer.
      if (!marker || marker === 0xd8 || marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (frame) {
        if (
          length < 8 ||
          !bytes[offset + 2] ||
          bytes[offset + 2] > 16 ||
          !bytes[offset + 7] ||
          length !== 8 + 3 * bytes[offset + 7]
        )
          return null;
        return dimensions(data.getUint16(offset + 5), data.getUint16(offset + 3));
      }
      offset += length;
    }
    return null;
  }
  if (mime === 'image/webp') {
    if (
      bytes.length < 20 ||
      !matches(bytes, 0, 'RIFF') ||
      !matches(bytes, 8, 'WEBP') ||
      data.getUint32(4, true) + 8 !== fileSize
    )
      return null;
    const chunkSize = data.getUint32(16, true);
    if (20 + chunkSize + (chunkSize % 2) > fileSize) return null;
    if (matches(bytes, 12, 'VP8X')) {
      if (
        chunkSize !== 10 ||
        bytes.length < 30 ||
        (bytes[20] & 0xc1) !== 0 ||
        bytes[21] !== 0 ||
        bytes[22] !== 0 ||
        bytes[23] !== 0
      )
        return null;
      const uint24 = (offset: number) =>
        bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
      return dimensions(uint24(24) + 1, uint24(27) + 1);
    }
    if (matches(bytes, 12, 'VP8L')) {
      if (chunkSize < 5 || bytes.length < 25 || bytes[20] !== 0x2f || bytes[24] >> 5) return null;
      const bits = data.getUint32(21, true);
      return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (matches(bytes, 12, 'VP8 ')) {
      if (
        chunkSize < 10 ||
        bytes.length < 30 ||
        (bytes[20] & 1) !== 0 ||
        !matches(bytes, 23, '\x9d\x01\x2a')
      )
        return null;
      return dimensions(data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff);
    }
  }
  return null;
}

/** Header-only preflight. The server remains responsible for verifying the complete image. */
export async function readImageDimensions(
  blob: Blob,
  signal: AbortSignal,
): Promise<ImageDimensions | null> {
  signal.throwIfAborted();
  // Use the native Blob operation and never read or decode the full untrusted image here.
  const header = Blob.prototype.slice.call(blob, 0, IMAGE_HEADER_LIMIT);
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => reader.abort();
    reader.onload = () => {
      cleanup();
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('Image header could not be read.'));
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error ?? new Error('Image header could not be read.'));
    };
    reader.onabort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException('Image header read aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    reader.readAsArrayBuffer(header);
  });
  signal.throwIfAborted();
  return parseHeader(new Uint8Array(buffer), blob.type, blob.size);
}
