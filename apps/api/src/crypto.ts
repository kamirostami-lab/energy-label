// Random tokens and SHA-256, from the Web Crypto API the Workers runtime provides.

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An unguessable token: 32 random bytes, base64url. */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  // Never a SharedArrayBuffer here; the DOM typings want the narrower buffer type.
  const bytes = (
    typeof data === 'string' ? new TextEncoder().encode(data) : data
  ) as Uint8Array<ArrayBuffer>;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return btoa(binary);
}
