import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip';

/** Reads a stored ZIP back through its central directory. */
function unzip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    const size = view.getUint32(at + 20, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const bytes = zip.subarray(start, start + size);
    expect(crc32(bytes)).toBe(view.getUint32(at + 16, true));
    files.push({ name, bytes });
    at += 46 + nameLength;
  }
  return files;
}

describe('zipStore', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('stores files that read back byte for byte, names in UTF-8', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const pdf = new TextEncoder().encode('%PDF-1.6 château');
    const files = unzip(
      zipStore([
        { name: 'a-preview.png', bytes: png },
        { name: 'château-proof.pdf', bytes: pdf },
      ]),
    );
    expect(files.map((f) => f.name)).toEqual(['a-preview.png', 'château-proof.pdf']);
    expect(Buffer.from(files[0]!.bytes).equals(Buffer.from(png))).toBe(true);
    expect(Buffer.from(files[1]!.bytes).equals(Buffer.from(pdf))).toBe(true);
  });

  it('writes an empty archive as just the end record', () => {
    expect(zipStore([])).toHaveLength(22);
  });
});
