/** UTF-8 bytes of a string. (TextEncoder is not in the ES2022 library this package targets.) */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return Uint8Array.from(out);
}

/**
 * A stable 128-bit fingerprint (four seeded FNV-1a hashes) as 32 hex digits. Used for PDF document
 * IDs so identical exports stay byte-identical. Not a cryptographic hash.
 */
export function fingerprint(text: string): string {
  const bytes = utf8(text);
  return [0x811c9dc5, 0x5bd1e995, 0x9e3779b9, 0x85ebca6b]
    .map((seed) => {
      let h = seed >>> 0;
      for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
      return h.toString(16).padStart(8, '0');
    })
    .join('');
}
