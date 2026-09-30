import { describe, expect, it } from 'vitest';
import { buildStatement, exportArtwork, exportFileName, slug } from '../src/index.ts';
import { fsanzInputs, rules } from './helpers.ts';

const base = {
  issuedOn: '2026-09-30',
  org: 'Komms-Haus',
  sku: 'Shiraz 2024',
  widthMm: 35,
  ext: 'pdf',
};

describe('file names (Build Brief 01 section 11)', () => {
  it('follows YYYYMMDD-<org>-<sku>-energy-panel-<width>mm.<ext>', () => {
    expect(exportFileName(base)).toBe('20260930-komms-haus-shiraz-2024-energy-panel-35mm.pdf');
    expect(exportFileName({ ...base, widthMm: 37.5, ext: 'svg' })).toBe(
      '20260930-komms-haus-shiraz-2024-energy-panel-37.5mm.svg',
    );
  });

  it('appends suffixes only where the convention alone would collide', () => {
    expect(exportFileName({ ...base, suffixes: ['white', null, 'proof'] })).toBe(
      '20260930-komms-haus-shiraz-2024-energy-panel-35mm-white-proof.pdf',
    );
  });

  it('turns names into lower-case ASCII slugs', () => {
    expect(slug('Château Lune (Batch 7)')).toBe('chateau-lune-batch-7');
    expect(slug('Ōtaki Brewing Co.')).toBe('otaki-brewing-co');
    expect(() => slug('!!!')).toThrow(RangeError);
  });

  it('names each export after its format and colour', async () => {
    const names = [];
    for (const [format, colour] of [
      ['svg', 'black'],
      ['pdf', 'black'],
      ['pdf14', 'black'],
      ['pdf', 'spot'],
    ] as const) {
      const file = await exportArtwork(fsanzInputs, { width_mm: 35, colour }, rules, {
        format,
        issuedOn: '2026-09-30',
        org: 'Komms-Haus',
        sku: 'Shiraz 2024',
      });
      names.push([file.fileName, file.mediaType]);
    }
    expect(names).toEqual([
      ['20260930-komms-haus-shiraz-2024-energy-panel-35mm.svg', 'image/svg+xml'],
      ['20260930-komms-haus-shiraz-2024-energy-panel-35mm.pdf', 'application/pdf'],
      ['20260930-komms-haus-shiraz-2024-energy-panel-35mm-pdf14.pdf', 'application/pdf'],
      ['20260930-komms-haus-shiraz-2024-energy-panel-35mm-spot.pdf', 'application/pdf'],
    ]);
  });
});

describe('SVG export', () => {
  it('is the buildStatement artwork as UTF-8', async () => {
    const file = await exportArtwork(fsanzInputs, { width_mm: 35 }, rules, {
      format: 'svg',
      issuedOn: '2026-09-30',
      org: 'Komms-Haus',
      sku: 'Shiraz 2024',
    });
    expect(new TextDecoder().decode(file.bytes)).toBe(
      buildStatement(fsanzInputs, { width_mm: 35 }, rules).svg,
    );
  });
});
