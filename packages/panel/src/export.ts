// Export functions: artwork as SVG, PDF (PDF/X-4 rules) or EPS-compatible PDF 1.4, named by the
// studio convention YYYYMMDD-<org>-<sku>-energy-panel-<width>mm.<ext>.
import type { EnergyStatementRules } from '@energy-panel/rules';
import { planStatement } from './build-statement.ts';
import { utf8 } from './bytes.ts';
import { formatUpTo } from './decimal.ts';
import { issueDate, renderPanelPdf, type OutputIntent } from './pdf.ts';
import type { ColourVariant, Finding, StatementInputs, StatementOptions } from './types.ts';

/** svg; pdf (PDF 1.6 to PDF/X-4 rules); pdf14 (the EPS-compatible PDF 1.4). */
export type ArtworkFormat = 'svg' | 'pdf' | 'pdf14';

export interface ExportRequest {
  format: ArtworkFormat;
  /** Issue date as YYYY-MM-DD: names the file and dates the PDF. */
  issuedOn: string;
  /** Organisation and product names, for the file name. */
  org: string;
  sku: string;
  /** pdf only: the printing condition to declare, making the file PDF/X-4. */
  outputIntent?: OutputIntent;
}

export interface ExportedFile {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}

/** Thrown when a statement with blocking findings is asked for artwork. */
export class ExportBlockedError extends Error {
  readonly findings: Finding[];

  constructor(findings: Finding[]) {
    super(`Export blocked: ${findings.map((f) => f.code).join(', ')}`);
    this.name = 'ExportBlockedError';
    this.findings = findings;
  }
}

/** Lower-case ASCII words joined by hyphens: "Château Test (2024)" → "chateau-test-2024". */
export function slug(text: string): string {
  const out = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (out === '') throw new RangeError(`"${text}" has no letters or digits to use in a file name`);
  return out;
}

export interface FileNameParts {
  issuedOn: string;
  org: string;
  sku: string;
  widthMm: number;
  ext: string;
  /** Distinguish files the convention alone would give the same name, e.g. "white", "proof". */
  suffixes?: ReadonlyArray<string | null | undefined>;
}

/** YYYYMMDD-<org>-<sku>-energy-panel-<width>mm[-suffix].<ext> (Build Brief 01 section 11). */
export function exportFileName(parts: FileNameParts): string {
  issueDate(parts.issuedOn);
  const tail = (parts.suffixes ?? []).filter((s): s is string => Boolean(s)).map(slug);
  return `${[
    parts.issuedOn.replace(/-/g, ''),
    slug(parts.org),
    slug(parts.sku),
    'energy-panel',
    `${formatUpTo(parts.widthMm, 1)}mm`,
    ...tail,
  ].join('-')}.${parts.ext}`;
}

/** Suffixes for everything but the default black artwork. */
export function variantSuffixes(colour: ColourVariant, format: ArtworkFormat): string[] {
  return [...(colour === 'black' ? [] : [colour]), ...(format === 'pdf14' ? ['pdf14'] : [])];
}

/** Builds the statement and exports it; throws ExportBlockedError if any finding blocks export. */
export async function exportArtwork(
  inputs: StatementInputs,
  options: StatementOptions,
  rules: EnergyStatementRules,
  request: ExportRequest,
): Promise<ExportedFile> {
  const { result, layout } = planStatement(inputs, options, rules);
  if (!result.exportable || !result.svg || !layout || !result.options) {
    throw new ExportBlockedError(result.warnings.filter((w) => w.severity === 'block'));
  }
  const { colour, width_mm } = result.options;
  const fileName = exportFileName({
    issuedOn: request.issuedOn,
    org: request.org,
    sku: request.sku,
    widthMm: width_mm,
    ext: request.format === 'svg' ? 'svg' : 'pdf',
    suffixes: variantSuffixes(colour, request.format),
  });
  if (request.format === 'svg') {
    return { fileName, mediaType: 'image/svg+xml', bytes: utf8(result.svg) };
  }
  const bytes = await renderPanelPdf(
    layout,
    colour,
    request.format === 'pdf14' ? 'pdf14' : 'pdfx4',
    {
      title: `Energy statement: ${request.sku}`,
      rulesVersion: rules.version,
      issuedOn: request.issuedOn,
      ...(request.outputIntent ? { outputIntent: request.outputIntent } : {}),
    },
  );
  return { fileName, mediaType: 'application/pdf', bytes };
}
