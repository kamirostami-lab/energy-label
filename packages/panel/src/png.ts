// A minimal PNG encoder for the preview: 8-bit greyscale, the "Up" filter, zlib from pako (which
// pdf-lib already bundles), and a pHYs chunk so a saved preview opens at its physical size.
import pako from 'pako';
import type { GreyImage } from './raster.ts';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** zlib's Z_RLE strategy. */
const Z_RLE = 3;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encodes a grey image; `pxPerMm` records its physical resolution. */
export function encodeGreyPng(image: GreyImage, pxPerMm: number): Uint8Array {
  const { width, height, pixels } = image;
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 0, 0, 0, 0], 8); // bit depth 8, greyscale, deflate, adaptive filtering, no interlace

  const physical = new Uint8Array(9);
  const physicalView = new DataView(physical.buffer);
  const perMetre = Math.round(pxPerMm * 1000);
  physicalView.setUint32(0, perMetre);
  physicalView.setUint32(4, perMetre);
  physical[8] = 1; // unit: metre

  // Filter "Up" (2): each byte minus the one above, so repeated rows compress to runs of zero.
  const filtered = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const out = y * (width + 1);
    const row = y * width;
    filtered[out] = y === 0 ? 0 : 2;
    for (let x = 0; x < width; x++) {
      const above = y === 0 ? 0 : pixels[row - width + x]!;
      filtered[out + 1 + x] = (pixels[row + x]! - above) & 0xff;
    }
  }

  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('pHYs', physical),
    // Run-length matching suits filtered greyscale: faster than the default and no larger.
    chunk('IDAT', pako.deflate(filtered, { level: 1, strategy: Z_RLE })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}
