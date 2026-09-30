/** UTF-8 bytes of a string. (TextEncoder is not in the ES2022 library this package targets.) */
export function utf8(text: string): Uint8Array {
  // At most three bytes per UTF-16 code unit; content streams are ASCII, so this is one pass.
  const out = new Uint8Array(text.length * 3);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp < 0x80) {
      out[n++] = cp;
      continue;
    }
    if (cp >= 0xd800 && cp < 0xdc00 && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (cp < 0x800) {
      out[n++] = 0xc0 | (cp >> 6);
      out[n++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      out[n++] = 0xe0 | (cp >> 12);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    } else {
      out[n++] = 0xf0 | (cp >> 18);
      out[n++] = 0x80 | ((cp >> 12) & 0x3f);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    }
  }
  return out.slice(0, n);
}

/**
 * A stable 128-bit fingerprint (four seeded FNV-1a hashes) as 32 hex digits. Used for PDF document
 * IDs so identical exports stay byte-identical. Not a cryptographic hash.
 */
export function fingerprint(text: string): string {
  const bytes = utf8(text);
  let a = 0x811c9dc5;
  let b = 0x5bd1e995;
  let c = 0x9e3779b9;
  let d = 0x85ebca6b;
  for (let i = 0; i < bytes.length; i++) {
    const x = bytes[i]!;
    a = Math.imul(a ^ x, 0x01000193);
    b = Math.imul(b ^ x, 0x01000193);
    c = Math.imul(c ^ x, 0x01000193);
    d = Math.imul(d ^ x, 0x01000193);
  }
  return [a, b, c, d].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}
