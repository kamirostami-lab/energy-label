import { describe, expect, it } from 'vitest';
import {
  ExportBlockedError,
  PT_PER_MM,
  exportArtwork,
  type ExportRequest,
  type OutputIntent,
} from '../src/index.ts';
import { fsanzInputs, rules } from './helpers.ts';
import { inspectPdf, pathNumbers } from './pdf-helpers.ts';

const request = (
  format: ExportRequest['format'],
  extra: Partial<ExportRequest> = {},
): ExportRequest => ({
  format,
  issuedOn: '2026-09-30',
  org: 'Komms-Haus',
  sku: 'FSANZ guidance example',
  ...extra,
});
const pdf = (
  width_mm = 50,
  extra: object = {},
  format: ExportRequest['format'] = 'pdf',
  req = {},
) => exportArtwork(fsanzInputs, { width_mm, ...extra }, rules, request(format, req));

/** A stand-in profile to test the plumbing; real exports need a licensed CMYK ICC profile. */
const intent: OutputIntent = {
  identifier: 'FOGRA39',
  info: 'Coated FOGRA39 (ISO 12647-2:2004)',
  registry: 'http://www.color.org',
  iccProfile: Uint8Array.from([0, 1, 2, 3]),
};

describe('PDF export (Build Brief 01 section 8)', () => {
  it('writes PDF 1.6 for the PDF/X-4 flavour and PDF 1.4 for the EPS-compatible one', async () => {
    expect((await inspectPdf((await pdf()).bytes)).header).toBe('%PDF-1.6');
    expect((await inspectPdf((await pdf(50, {}, 'pdf14')).bytes)).header).toBe('%PDF-1.4');
  });

  it.each([30, 35, 50, 120])(
    'sizes the page to the %s mm panel in all three boxes',
    async (width) => {
      const file = await pdf(width);
      const { mediaBox, trimBox, bleedBox, page } = await inspectPdf(file.bytes);
      expect(mediaBox.width).toBeCloseTo(width * PT_PER_MM, 3);
      expect(trimBox).toEqual(mediaBox);
      expect(bleedBox).toEqual(mediaBox);
      expect(page.getHeight()).toBeGreaterThan(0);
    },
  );

  it('carries no fonts: text is outlined and the page has no font resources', async () => {
    for (const colour of ['black', 'white', 'spot'] as const) {
      const { raw, content } = await inspectPdf(
        (await pdf(50, { colour, energy_units: 'kj_cal' })).bytes,
      );
      expect(raw).not.toMatch(/\/Font|\/FontFile|\/FontDescriptor/);
      expect(content).not.toMatch(/\bBT\b|\bTj\b|\bTJ\b|\bTf\b/);
    }
  });

  it('fills in CMYK black, CMYK white or the "Panel" separation', async () => {
    expect((await inspectPdf((await pdf()).bytes)).content).toContain('0 0 0 1 k');
    expect((await inspectPdf((await pdf(50, { colour: 'white' })).bytes)).content).toContain(
      '0 0 0 0 k',
    );
    const spot = await inspectPdf((await pdf(50, { colour: 'spot' })).bytes);
    expect(spot.content).toContain('/Panel cs 1 scn');
    expect(spot.raw).toMatch(/\/Separation \/Panel \/DeviceCMYK/);
  });

  it('draws exactly the SVG geometry', async () => {
    const svg = (
      await exportArtwork(
        fsanzInputs,
        { width_mm: 45, energy_units: 'kj_cal' },
        rules,
        request('svg'),
      )
    ).bytes;
    const svgText = new TextDecoder().decode(svg);
    const svgGlyphNumbers = [...svgText.matchAll(/<path d="([^"]+)"\/>/g)]
      .slice(1) // the first path holds the border and rules, drawn as rectangles
      .flatMap(([, d]) => d!.match(/-?\d+(\.\d+)?/g)!);
    const { content } = await inspectPdf((await pdf(45, { energy_units: 'kj_cal' })).bytes);
    const numbers = pathNumbers(content);
    expect(numbers.slice(numbers.length - svgGlyphNumbers.length)).toEqual(svgGlyphNumbers);
  });

  it('maps millimetres to points once, flipping the y axis at the top of the page', async () => {
    const { content, mediaBox } = await inspectPdf((await pdf(35)).bytes);
    const [, height] = /2\.834645669 0 0 -2\.834645669 0 ([\d.]+) cm/.exec(content)!;
    expect(Number(height)).toBeCloseTo(mediaBox.height, 4);
  });

  it('is byte-identical for the same inputs and date', async () => {
    const a = await pdf(40, { colour: 'spot' });
    const b = await pdf(40, { colour: 'spot' });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    const later = await pdf(40, { colour: 'spot' }, 'pdf', { issuedOn: '2026-10-01' });
    expect(Buffer.from(a.bytes).equals(Buffer.from(later.bytes))).toBe(false);
  });

  it('records title, dates, a stable document ID and Trapped in XMP and the Info dictionary', async () => {
    const { xmp, raw, doc } = await inspectPdf((await pdf()).bytes);
    expect(doc.getTitle()).toBe('Energy statement: FSANZ guidance example');
    expect(doc.getSubject()).toBe('FSANZ energy statement, rules 1.0.0');
    expect(doc.getCreationDate()?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(xmp).toContain(
      '<rdf:li xml:lang="x-default">Energy statement: FSANZ guidance example</rdf:li>',
    );
    expect(xmp).toContain('<xmp:CreateDate>2026-09-30T00:00:00Z</xmp:CreateDate>');
    expect(xmp).toContain('<pdf:Trapped>False</pdf:Trapped>');
    const [, uuid] = /<xmpMM:DocumentID>uuid:([0-9a-f-]{36})<\/xmpMM:DocumentID>/.exec(xmp)!;
    const [, id] = /\/ID \[ <([0-9A-Fa-f]{32})> <\1> \]/.exec(raw)!;
    expect(uuid!.replace(/-/g, '')).toBe(id!.toLowerCase());
    expect(raw).toMatch(/\/Trapped \/False/);
  });

  it('claims PDF/X-4 only when given an output intent to declare', async () => {
    const plain = await inspectPdf((await pdf()).bytes);
    expect(plain.xmp).not.toContain('GTS_PDFXVersion');
    expect(plain.raw).not.toContain('/OutputIntents');

    const x4 = await inspectPdf((await pdf(50, {}, 'pdf', { outputIntent: intent })).bytes);
    expect(x4.xmp).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>');
    expect(x4.raw).toMatch(/\/OutputIntents \[/);
    expect(x4.raw).toMatch(/\/S \/GTS_PDFX/);
    expect(x4.raw).toMatch(/\/N 4/);
  });

  it('ignores an output intent on the EPS-compatible PDF 1.4', async () => {
    const eps = await inspectPdf((await pdf(50, {}, 'pdf14', { outputIntent: intent })).bytes);
    expect(eps.raw).not.toContain('/OutputIntents');
    expect(eps.xmp).not.toContain('GTS_PDFXVersion');
  });

  it('refuses to export a blocked statement', async () => {
    await expect(
      exportArtwork(
        { ...fsanzInputs, abv: 0.4, standardised_beverage: false },
        { width_mm: 50 },
        rules,
        request('pdf'),
      ),
    ).rejects.toBeInstanceOf(ExportBlockedError);
  });

  it('rejects an invalid issue date', async () => {
    await expect(pdf(50, {}, 'pdf', { issuedOn: '2026-02-30' })).rejects.toThrow(/YYYY-MM-DD/);
  });
});
