// A4 proof sheet (Build Brief 01 section 8): the panel at true size and enlarged for inspection,
// the values it was built from, rules version, date, producer, printer branding when there is one,
// and the statement that the producer remains responsible for compliance. Text is outlined, like
// the artwork, so the proof needs no fonts either.
import type { EnergyStatementRules } from '@energy-panel/rules';
import { planStatement } from './build-statement.ts';
import { formatUpTo } from './decimal.ts';
import {
  ExportBlockedError,
  exportFileName,
  variantSuffixes,
  type ExportedFile,
} from './export.ts';
import { FONT, wrapText, type PanelLayout } from './layout.ts';
import { colourOps, issueDate, panelPaths, pdfPathOps, watermarkOps, writePdf } from './pdf.ts';
import { fmt, measureText, outlineCommands, unsupportedCharacters } from './text.ts';
import type { ColourVariant, StatementInputs, StatementOptions, StatementResult } from './types.ts';

export interface ProofDetails {
  /** Producer (organisation) name. */
  producer: string;
  /** Product (SKU) name. */
  sku: string;
  vintageOrBatch?: string;
  /** Issue date as YYYY-MM-DD. */
  issuedOn: string;
  /** White-label branding; the logo arrives with printer profiles in session 6. */
  printer?: { name: string; footer?: string };
}

export interface ProofOptions {
  /** A free preview proof (decision D3): the panels carry the PREVIEW mark. */
  watermark?: boolean;
}

/** Thrown when proof details contain text the proof typeface cannot set. */
export class ProofInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofInputError';
  }
}

const PAGE = { width: 210, height: 297, margin: 15 } as const;
/** Type sizes in mm: about 16, 11, 9 and 7.5 pt. */
const SIZE = { title: 5.6, heading: 3.9, body: 3.2, small: 2.65 } as const;
const LEADING = 1.35;
const LABEL_WIDTH = 62;
const GAP = 6;
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;
const BLACK = '0 0 0 1 k';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const COLOUR_LABEL: Record<ColourVariant, string> = {
  black: 'Black, CMYK 0/0/0/100',
  white: 'White on transparent, CMYK 0/0/0/0 (shown on a dark backdrop)',
  spot: 'Single spot colour, separation “Panel” (shown in black)',
};

/** "30 September 2026" */
export function longDate(issuedOn: string): string {
  const date = issueDate(issuedOn);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

const yesNo = (value: boolean | null | undefined) =>
  value === true ? 'Yes' : value === false ? 'No' : 'Not stated';

/** The values table: what was entered, the options chosen and what was calculated. */
function valueRows(inputs: StatementInputs, result: StatementResult): Array<[string, string]> {
  const o = result.options!;
  const v = result.values!;
  const d = v.display;
  const m = result.metrics!;
  const rows: Array<[string, string]> = [
    ['Alcohol by volume', `${formatUpTo(inputs.abv, 2)}%`],
    ['Standardised alcoholic beverage', yesNo(inputs.standardised_beverage)],
    ['Package volume', `${formatUpTo(inputs.package_ml, 1)} mL`],
    ['Serving size', `${d.servingSizeMl} mL`],
    [
      'Servings per package',
      `${d.servingsPerPackage} (${inputs.servings === undefined || inputs.servings === null ? 'package volume ÷ serving size' : 'entered'})`,
    ],
    ['Average energy entered', `${formatUpTo(inputs.kj_per_100ml ?? 0, 3)} kJ per 100 mL`],
  ];
  if (typeof inputs.cal_per_100ml === 'number') {
    rows.push([
      'Average energy entered in Cal',
      `${formatUpTo(inputs.cal_per_100ml, 3)} Cal per 100 mL`,
    ]);
  }
  rows.push(
    ['Nutrition information panel on the label', yesNo(inputs.nip_displayed)],
    [
      'Package surface area',
      typeof inputs.package_surface_area_cm2 === 'number'
        ? `${formatUpTo(inputs.package_surface_area_cm2, 1)} cm²`
        : 'Not stated',
    ],
    [
      'Panel',
      `${formatUpTo(o.width_mm, 1)} × ${formatUpTo(m.heightMm, 1)} mm; type ${formatUpTo(m.bodySizePt, 1)} pt (cap height ${formatUpTo(m.capHeightMm, 2)} mm); rules ${formatUpTo(m.ruleWeightPt, 2)} pt`,
    ],
    ['Colour', COLOUR_LABEL[o.colour]],
    ['Energy units', o.energy_units === 'kj' ? 'kJ' : 'kJ and Cal'],
    ['Package word', o.package_word],
    [
      'Standard drinks per serving',
      `${d.standardDrinksPerServing} (calculated ${formatUpTo(v.standardDrinksPerServing, 3)})`,
    ],
    [
      'Energy per serving',
      `${d.energyPerServingKj} kJ (calculated ${formatUpTo(v.energyPerServingKj, 2)} kJ)`,
    ],
    ['Energy per 100 mL', `${d.energyPer100mlKj} kJ`],
  );
  if (d.energyPerServingCal !== null && d.energyPer100mlCal !== null) {
    rows.push(
      [
        'Energy per serving in Cal',
        `${d.energyPerServingCal} Cal (calculated ${formatUpTo(v.energyPerServingCal!, 2)} Cal)`,
      ],
      [
        'Energy per 100 mL in Cal',
        `${d.energyPer100mlCal} Cal (calculated ${formatUpTo(v.energyPer100mlCal!, 2)} Cal)`,
      ],
    );
  }
  rows.push([
    'Standard drinks in the package',
    `${d.totalStandardDrinks} (state this separately on the label, not in the energy statement)`,
  ]);
  return rows;
}

/** Collects outlined text and panels in page millimetres, y down. */
class Sheet {
  readonly ops: string[] = [BLACK];
  y: number = PAGE.margin;

  text(text: string, size: number, x: number, baseline: number): void {
    this.ops.push(pdfPathOps(outlineCommands(FONT, text, size, x, baseline)), 'f');
  }

  /** Sets text from the current line down, wrapped to `width`; advances past it. */
  lines(text: string, size: number, x: number = PAGE.margin, width: number = CONTENT_WIDTH): void {
    for (const line of wrapText(text, size, width)) {
      this.text(line, size, x, this.y + 0.8 * size);
      this.y += LEADING * size;
    }
  }

  panel(layout: PanelLayout, colour: ColourVariant, scale: number, watermark: boolean): void {
    const x = PAGE.margin + (colour === 'white' ? 2 : 0);
    const y = this.y + (colour === 'white' ? 2 : 0);
    if (colour === 'white') {
      const w = layout.width * scale + 4;
      const h = layout.height * scale + 4;
      this.ops.push(
        `0 0 0 0.8 k\n${fmt(PAGE.margin)} ${fmt(this.y)} ${fmt(w)} ${fmt(h)} re\nf\n${BLACK}`,
      );
    }
    this.ops.push(
      `q\n${fmt(scale)} 0 0 ${fmt(scale)} ${fmt(x)} ${fmt(y)} cm\n${watermark ? `${watermarkOps(layout, colour)}\n` : ''}${colourOps(colour)}\n${panelPaths(layout)}\nQ`,
    );
    this.y = y + layout.height * scale + (colour === 'white' ? 2 : 0);
  }
}

const linesHeight = (text: string, size: number, width: number) =>
  wrapText(text, size, width).length * LEADING * size;

/**
 * Builds the proof sheet for a statement. Throws ExportBlockedError when a finding blocks export,
 * and ProofInputError when a name uses characters the proof typeface cannot set.
 */
export async function buildProofSheet(
  inputs: StatementInputs,
  options: StatementOptions,
  rules: EnergyStatementRules,
  details: ProofDetails,
  proofOptions: ProofOptions = {},
): Promise<ExportedFile> {
  const watermark = proofOptions.watermark === true;
  const { result, layout } = planStatement(inputs, options, rules);
  if (!result.exportable || !layout || !result.options || !result.values) {
    throw new ExportBlockedError(result.warnings.filter((w) => w.severity === 'block'));
  }
  const named: Array<[string, string | undefined]> = [
    ['producer', details.producer],
    ['sku', details.sku],
    ['vintageOrBatch', details.vintageOrBatch],
    ['printer name', details.printer?.name],
    ['printer footer', details.printer?.footer],
  ];
  for (const [field, value] of named) {
    const missing = value === undefined ? [] : unsupportedCharacters(FONT, value);
    if (missing.length > 0) {
      throw new ProofInputError(
        `The ${field} uses characters the proof typeface cannot set: ${missing.join(' ')}`,
      );
    }
  }

  const { colour, width_mm } = result.options;
  const product = details.vintageOrBatch
    ? `${details.sku} · ${details.vintageOrBatch}`
    : details.sku;
  const rows = valueRows(inputs, result);
  const notes = result.warnings.map((w) => `• ${w.message}`);
  const footer = [
    'Energy Panel formats the energy statement from the values supplied. The producer remains responsible for the label complying with the Australia New Zealand Food Standards Code.',
    ...(details.printer?.footer ? [details.printer.footer] : []),
  ];

  // Heights of everything below the panels, to fit the enlarged panel into what is left.
  const valueWidth = CONTENT_WIDTH - LABEL_WIDTH;
  const tableHeight =
    LEADING * SIZE.heading +
    rows.reduce((sum, [, value]) => sum + linesHeight(value, SIZE.body, valueWidth), 0);
  const notesHeight =
    notes.length === 0
      ? 0
      : GAP +
        LEADING * SIZE.heading +
        notes.reduce((sum, n) => sum + linesHeight(n, SIZE.small, CONTENT_WIDTH), 0);
  const footerHeight = footer.reduce(
    (sum, f) => sum + linesHeight(f, SIZE.small, CONTENT_WIDTH),
    0,
  );
  const footerTop = PAGE.height - PAGE.margin - footerHeight;

  const sheet = new Sheet();
  sheet.text('Energy statement proof', SIZE.title, PAGE.margin, sheet.y + 0.8 * SIZE.title);
  if (details.printer) {
    const width = measureText(FONT, details.printer.name, SIZE.body);
    sheet.text(
      details.printer.name,
      SIZE.body,
      PAGE.width - PAGE.margin - width,
      sheet.y + 0.8 * SIZE.title,
    );
  }
  sheet.y += LEADING * SIZE.title;
  sheet.lines(product, SIZE.heading);
  sheet.lines(
    `${details.producer} · Issued ${longDate(details.issuedOn)} · Rules version ${rules.version}`,
    SIZE.body,
  );
  if (watermark) sheet.lines('Watermarked preview: not for print.', SIZE.body);

  sheet.y += GAP;
  sheet.lines(`Actual size: ${formatUpTo(width_mm, 1)} mm wide`, SIZE.small);
  sheet.panel(layout, colour, 1, watermark);

  // Enlarged view at 2× where it fits, else 1.5×; a panel too big for either is large enough to read.
  const labelHeight = LEADING * SIZE.small;
  const backdrop = colour === 'white' ? 4 : 0;
  const available =
    footerTop - GAP - notesHeight - tableHeight - GAP - (sheet.y + GAP) - labelHeight - backdrop;
  const fit = Math.min((CONTENT_WIDTH - backdrop) / layout.width, available / layout.height);
  const enlarged = fit >= 2 ? 2 : fit >= 1.5 ? 1.5 : null;
  if (enlarged !== null) {
    sheet.y += GAP;
    sheet.lines(`Enlarged ${formatUpTo(enlarged, 1)}× for inspection`, SIZE.small);
    sheet.panel(layout, colour, enlarged, watermark);
  }

  sheet.y += GAP;
  sheet.lines('Values', SIZE.heading);
  for (const [label, value] of rows) {
    const top = sheet.y;
    sheet.text(label, SIZE.body, PAGE.margin, top + 0.8 * SIZE.body);
    sheet.lines(value, SIZE.body, PAGE.margin + LABEL_WIDTH, valueWidth);
    sheet.y = Math.max(sheet.y, top + LEADING * SIZE.body);
  }
  if (notes.length > 0) {
    sheet.y += GAP;
    sheet.lines('Notes', SIZE.heading);
    for (const note of notes) sheet.lines(note, SIZE.small);
  }
  if (sheet.y > footerTop) throw new Error('Proof content does not fit on one A4 page');

  sheet.y = footerTop;
  for (const line of footer) sheet.lines(line, SIZE.small);

  const bytes = await writePdf(
    {
      widthMm: PAGE.width,
      heightMm: PAGE.height,
      content: sheet.ops.join('\n'),
      spot: colour === 'spot',
    },
    {
      version: '1.6',
      title: `${watermark ? 'Energy statement proof (preview)' : 'Energy statement proof'}: ${product}`,
      subject: `FSANZ energy statement, rules ${rules.version}`,
      issuedOn: details.issuedOn,
    },
  );
  const fileName = exportFileName({
    issuedOn: details.issuedOn,
    org: details.producer,
    sku: details.sku,
    widthMm: width_mm,
    ext: 'pdf',
    suffixes: [...variantSuffixes(colour, 'pdf'), 'proof', ...(watermark ? ['preview'] : [])],
  });
  return { fileName, mediaType: 'application/pdf', bytes };
}
