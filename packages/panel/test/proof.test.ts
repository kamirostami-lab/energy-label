import { describe, expect, it } from 'vitest';
import {
  ExportBlockedError,
  ProofInputError,
  buildProofSheet,
  longDate,
  type ProofDetails,
} from '../src/index.ts';
import { fsanzInputs, rules } from './helpers.ts';
import { inspectPdf } from './pdf-helpers.ts';

const details: ProofDetails = {
  producer: 'Komms-Haus',
  sku: 'FSANZ guidance example',
  issuedOn: '2026-09-30',
};
const proof = (width_mm = 50, extra: object = {}, more: Partial<ProofDetails> = {}) =>
  buildProofSheet(fsanzInputs, { width_mm, ...extra }, rules, { ...details, ...more });

describe('proof sheet (Build Brief 01 section 8)', () => {
  it('is one A4 page with no fonts', async () => {
    const { mediaBox, raw, content, doc } = await inspectPdf((await proof()).bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(mediaBox.width).toBeCloseTo(595.2756, 3);
    expect(mediaBox.height).toBeCloseTo(841.8898, 3);
    expect(raw).not.toMatch(/\/Font/);
    expect(content).not.toMatch(/\bBT\b|\bTj\b/);
  });

  it('shows the panel at true size and enlarged 2× for inspection', async () => {
    const { content } = await inspectPdf((await proof(50)).bytes);
    expect(content).toMatch(/^1 0 0 1 15 [\d.]+ cm$/m);
    expect(content).toMatch(/^2 0 0 2 15 [\d.]+ cm$/m);
  });

  it('enlarges wide panels 1.5× where 2× cannot fit, and not at all when neither fits', async () => {
    // 180 mm of content width: 100 mm fits 1.5× but not 2×.
    const at100 = await inspectPdf((await proof(100)).bytes);
    expect(at100.content).toMatch(/^1\.5 0 0 1\.5 15 [\d.]+ cm$/m);
    // A white panel adds a 2 mm backdrop each side: 120 × 1.5 + 4 > 180.
    const at120 = await inspectPdf((await proof(120, { colour: 'white' })).bytes);
    expect(at120.content).toMatch(/^1 0 0 1 17 [\d.]+ cm$/m);
    expect(at120.content).not.toMatch(/^(2|1\.5) 0 0 (2|1\.5) /m);
  });

  it('sets white artwork on a dark backdrop and spot artwork through the "Panel" separation', async () => {
    expect((await inspectPdf((await proof(50, { colour: 'white' })).bytes)).content).toContain(
      '0 0 0 0.8 k',
    );
    const spot = await inspectPdf((await proof(50, { colour: 'spot' })).bytes);
    expect(spot.content).toContain('/Panel cs 1 scn');
    expect(spot.raw).toMatch(/\/Separation \/Panel \/DeviceCMYK/);
  });

  it('is named and titled for the product, and byte-identical on repeat', async () => {
    const a = await proof(50, {}, { vintageOrBatch: '2024' });
    const b = await proof(50, {}, { vintageOrBatch: '2024' });
    expect(a.fileName).toBe(
      '20260930-komms-haus-fsanz-guidance-example-energy-panel-50mm-proof.pdf',
    );
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect((await inspectPdf(a.bytes)).doc.getTitle()).toBe(
      'Energy statement proof: FSANZ guidance example · 2024',
    );
  });

  it('fits a tall, wide panel with notes and printer branding on the page', async () => {
    const file = await buildProofSheet(
      { abv: 40, package_ml: 700, serving_ml: 30, kj_per_100ml: 924.6, cal_per_100ml: 300 },
      {
        width_mm: 120,
        energy_units: 'kj_cal',
        colour: 'white',
        package_word: 'magnum presentation case',
      },
      rules,
      {
        ...details,
        printer: { name: 'Mediapoint Labels', footer: 'Proof issued by Mediapoint Labels.' },
      },
    );
    expect(file.bytes.length).toBeGreaterThan(0);
  });

  it('rejects names the proof typeface cannot set', async () => {
    await expect(proof(50, {}, { producer: '酒造' })).rejects.toBeInstanceOf(ProofInputError);
  });

  it('refuses a blocked statement', async () => {
    await expect(
      buildProofSheet({ ...fsanzInputs, kj_per_100ml: null }, { width_mm: 50 }, rules, details),
    ).rejects.toBeInstanceOf(ExportBlockedError);
  });

  it('writes dates the Australian way', () => {
    expect(longDate('2026-09-30')).toBe('30 September 2026');
    expect(longDate('2027-01-05')).toBe('5 January 2027');
  });
});
