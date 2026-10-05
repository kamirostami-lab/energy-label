import pako from 'pako';
import { describe, expect, it } from 'vitest';
import {
  BEVERAGE_TYPES,
  PREVIEW_EXPORT_PX_PER_MM,
  PREVIEW_LIMITS,
  buildProofSheet,
  buildStatement,
  crc32,
  encodeGreyPng,
  exportArtwork,
  exportPreviewImage,
  planStatement,
  previewScale,
  rasterizePanel,
  renderPreviewPng,
  watermarkCommands,
  type GreyImage,
} from '../src/index.ts';
import type { PanelLayout } from '../src/layout.ts';
import { fsanzInputs, rules } from './helpers.ts';
import { inspectPdf } from './pdf-helpers.ts';

const layoutFor = (options: object = {}) => {
  const { layout } = planStatement(fsanzInputs, { width_mm: 50, ...options }, rules);
  if (!layout) throw new Error('expected a layout');
  return layout;
};

/** A layout with only the given rectangles: the mark sits in the middle 84%, clear of x < 8%. */
const rectsOnly = (width: number, height: number, rects: PanelLayout['rects']): PanelLayout => ({
  width,
  height,
  rects,
  texts: [],
  metrics: layoutFor().metrics,
});

const pixel = (image: GreyImage, x: number, y: number) => image.pixels[y * image.width + x];

/** Reads a PNG back: chunks, CRC checks and the unfiltered pixels. */
function decodePng(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Record<string, Uint8Array> = {};
  const order: string[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    expect(view.getUint32(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    chunks[type] = data;
    order.push(type);
    at += 12 + length;
  }
  const header = new DataView(chunks.IHDR!.buffer, chunks.IHDR!.byteOffset, 13);
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  const raw = pako.inflate(chunks.IDAT!);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    for (let x = 0; x < width; x++) {
      const value = raw[y * (width + 1) + 1 + x]!;
      const above = y > 0 && filter === 2 ? pixels[(y - 1) * width + x]! : 0;
      pixels[y * width + x] = (value + above) & 0xff;
    }
  }
  return { order, chunks, width, height, header: [...chunks.IHDR!.subarray(8)], pixels };
}

describe('raster preview', () => {
  it('covers each pixel by the exact area of the shape', () => {
    // 10 px/mm: a bar from 0.25 px to 2.75 px across, and from 0.5 px to 9.5 px down.
    const image = rasterizePanel(
      rectsOnly(10, 1, [{ x: 0.025, y: 0.05, width: 0.25, height: 0.9 }]),
      'black',
      10,
    );
    expect([image.width, image.height]).toEqual([100, 10]);
    const row = [0, 1, 2, 3].map((x) => pixel(image, x, 5));
    expect(row).toEqual([64, 0, 64, 255]); // 255 × (1 − 0.75) rounds to 64
    expect(pixel(image, 1, 0)).toBe(128); // half the first row
    expect(pixel(image, 1, 9)).toBe(128);
  });

  it('draws the panel in ink on paper with the mark behind it', () => {
    const layout = layoutFor();
    const image = rasterizePanel(layout, 'black', 8);
    expect(image.width).toBe(Math.ceil(layout.width * 8));
    expect(image.height).toBe(Math.ceil(layout.height * 8));
    expect(pixel(image, 0, 0)).toBe(0); // the border
    const counts = new Map<number, number>();
    for (const value of image.pixels) counts.set(value, (counts.get(value) ?? 0) + 1);
    expect(counts.get(255)).toBeGreaterThan(image.pixels.length / 3);
    expect(counts.get(224)).toBeGreaterThan(1000); // the mark: 12% grey
  });

  it('shows white artwork on a dark ground', () => {
    const image = rasterizePanel(layoutFor({ colour: 'white' }), 'white', 8);
    expect(pixel(image, 0, 0)).toBe(255);
    expect(image.pixels).toContain(51);
    expect(image.pixels).toContain(128); // the mark: 50% grey
  });

  it('limits the density and the pixel count', () => {
    const small = layoutFor();
    expect(previewScale(small, 1)).toBe(PREVIEW_LIMITS.minPxPerMm);
    expect(previewScale(small, 100)).toBe(PREVIEW_LIMITS.maxPxPerMm);
    expect(previewScale(small, Number.NaN)).toBe(PREVIEW_LIMITS.minPxPerMm);
    expect(previewScale(small, 7.5591)).toBe(7.55);
    const wide = layoutFor({ width_mm: 120, energy_units: 'kj_cal' });
    const scale = previewScale(wide, 40);
    expect(scale).toBeLessThan(40);
    expect(Math.ceil(wide.width * scale) * Math.ceil(wide.height * scale)).toBeLessThanOrEqual(
      PREVIEW_LIMITS.maxPixels,
    );
  });
});

describe('PNG encoding', () => {
  it('writes a valid greyscale PNG with its physical size', () => {
    const image = rasterizePanel(layoutFor(), 'black', 7.56);
    const png = encodeGreyPng(image, 7.56);
    const decoded = decodePng(png);
    expect(decoded.order).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect([decoded.width, decoded.height]).toEqual([image.width, image.height]);
    expect(decoded.header).toEqual([8, 0, 0, 0, 0]);
    const phys = new DataView(decoded.chunks.pHYs!.buffer, decoded.chunks.pHYs!.byteOffset, 9);
    expect([phys.getUint32(0), phys.getUint32(4), phys.getUint8(8)]).toEqual([7560, 7560, 1]);
    expect(Buffer.from(decoded.pixels).equals(Buffer.from(image.pixels))).toBe(true);
  });

  it('renders the same preview bytes for the same request', () => {
    const a = renderPreviewPng(layoutFor(), 'black', 15.12);
    const b = renderPreviewPng(layoutFor(), 'black', 15.12);
    expect(a.pxPerMm).toBe(15.12);
    expect(Buffer.from(a.png).equals(Buffer.from(b.png))).toBe(true);
    expect(decodePng(a.png).width).toBe(a.widthPx);
  });
});

describe('PREVIEW watermark', () => {
  it('fits inside the panel, centred', () => {
    const layout = layoutFor();
    const xs: number[] = [];
    const ys: number[] = [];
    for (const c of watermarkCommands(layout)) {
      for (let i = 1; i < c.length; i += 2) {
        xs.push(c[i] as number);
        ys.push(c[i + 1] as number);
      }
    }
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(layout.width);
    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThan(layout.height);
    expect(Math.abs(Math.min(...xs) + Math.max(...xs) - layout.width)).toBeLessThan(1);
  });

  const request = { issuedOn: '2026-09-30', org: 'Komms-Haus', sku: 'Test' };

  it('exports the free preview as a 300 dpi PNG with the mark burned in, named "-preview"', () => {
    const file = exportPreviewImage(fsanzInputs, { width_mm: 50 }, rules, request);
    expect(file.fileName).toBe('20260930-komms-haus-test-energy-panel-50mm-preview.png');
    expect(file.mediaType).toBe('image/png');
    const decoded = decodePng(file.bytes);
    const image = rasterizePanel(
      layoutFor(),
      'black',
      previewScale(layoutFor(), PREVIEW_EXPORT_PX_PER_MM),
    );
    expect([decoded.width, decoded.height]).toEqual([image.width, image.height]);
    expect(decoded.width).toBe(Math.ceil(50 * PREVIEW_EXPORT_PX_PER_MM - 1e-9));
    expect(Buffer.from(decoded.pixels).equals(Buffer.from(image.pixels))).toBe(true);
    expect(decoded.pixels).toContain(224); // the mark, in the pixels themselves
    const white = exportPreviewImage(
      fsanzInputs,
      { width_mm: 50, colour: 'white' },
      rules,
      request,
    );
    expect(white.fileName).toBe('20260930-komms-haus-test-energy-panel-50mm-white-preview.png');
  });

  it('refuses a blocked statement, as the artwork export does', () => {
    expect(() =>
      exportPreviewImage({ ...fsanzInputs, kj_per_100ml: null }, { width_mm: 50 }, rules, request),
    ).toThrow(/KJ_MISSING/);
  });

  it('leaves paid exports untouched', async () => {
    const svg = await exportArtwork(fsanzInputs, { width_mm: 50 }, rules, {
      format: 'svg',
      ...request,
    });
    expect(Buffer.from(svg.bytes).toString('utf8')).toBe(
      buildStatement(fsanzInputs, { width_mm: 50 }, rules).svg,
    );
  });

  it('marks both panels on a preview proof sheet', async () => {
    const proof = await buildProofSheet(
      fsanzInputs,
      { width_mm: 50 },
      rules,
      { producer: 'Komms-Haus', sku: 'Test', issuedOn: '2026-09-30' },
      { watermark: true },
    );
    expect(proof.fileName).toBe('20260930-komms-haus-test-energy-panel-50mm-proof-preview.pdf');
    const { content, doc, raw } = await inspectPdf(proof.bytes);
    // Both panels are images with the mark burned in: no vector panel to lift out of the file.
    expect(content.match(/^\/Im\d Do$/gm)).toEqual(['/Im0 Do', '/Im1 Do']);
    expect(raw.match(/\/Subtype \/Image/g)).toHaveLength(2);
    expect(raw).toContain('/ColorSpace /DeviceGray');
    expect(raw).not.toMatch(/\/Font/);
    expect(doc.getTitle()).toBe('Energy statement proof (preview): Test');

    const paid = await buildProofSheet(fsanzInputs, { width_mm: 50 }, rules, {
      producer: 'Komms-Haus',
      sku: 'Test',
      issuedOn: '2026-09-30',
    });
    expect(Buffer.from(paid.bytes).toString('latin1')).not.toMatch(/\/Subtype \/Image/);
  });

  it('keeps a spot preview proof free of the separation, its panels being images', async () => {
    const proof = await buildProofSheet(
      fsanzInputs,
      { width_mm: 50, colour: 'spot' },
      rules,
      { producer: 'Komms-Haus', sku: 'Test', issuedOn: '2026-09-30' },
      { watermark: true },
    );
    expect(Buffer.from(proof.bytes).toString('latin1')).not.toContain('/Separation');
  });
});

describe('beverage presets', () => {
  it('name only standardised beverages and package words the rules file lists', () => {
    const { standardised_alcoholic_beverages: listed, package_word } = rules.values;
    const words = [package_word.default, ...package_word.alternatives];
    for (const type of BEVERAGE_TYPES) {
      if (type.standardisedAs !== null) expect(listed).toContain(type.standardisedAs);
      expect(words).toContain(type.packageWord);
      for (const ml of type.servingsMl) expect(Number.isInteger(ml * 10)).toBe(true);
    }
  });
});
