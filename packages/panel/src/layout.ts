// Fixed layout for the prescribed table. Every dimension is proportional to the panel width, so
// a panel looks the same at any size; only the rule weight has a floor (the rules file minimum).
import { SANS_BOLD } from './font/sans-bold.generated.ts';
import { SANS_REGULAR } from './font/sans-regular.generated.ts';
import type { FontData } from './font/types.ts';
import { measureText } from './text.ts';
import type { PanelMetrics } from './types.ts';

/** Product widths from Build Brief 01 section 8. Not regulatory, so they live in code. */
export const PRESET_WIDTHS_MM = [30, 35, 40, 45, 50, 60] as const;
export const WIDTH_LIMITS_MM = { min: 25, max: 120 } as const;

/** Proportions in ems of the body type, unless noted. */
export const LAYOUT = {
  /** Panel width in ems: body size = width / 22 (2.27 mm, about 6.4 pt, at 50 mm). */
  widthEm: 22,
  titleScale: 1.15,
  /** Cell padding, left and right. */
  padX: 0.45,
  /** From the rule above a cell to the cap height of its first line. */
  padTop: 0.4,
  /** From the last baseline in a cell to the rule below it. */
  padBottom: 0.4,
  /** Baseline to baseline. */
  leading: 1.2,
  /** Rule weight at a 50 mm width, scaled with width, never below the rules file minimum. */
  rulePtAt50mm: 0.5,
} as const;

export const MM_PER_PT = 25.4 / 72;

export type Face = 'regular' | 'bold';
export const FACES: Readonly<Record<Face, FontData>> = { regular: SANS_REGULAR, bold: SANS_BOLD };

export interface PanelContent {
  title: string;
  /** Lines above the table, e.g. "Servings per package: 12". */
  info: string[];
  /** Column headings for per serving and per 100 mL. */
  headings: readonly [string, string];
  energyLabel: string;
  /** Lines of the per-serving cell: kJ, then Cal when shown. */
  perServing: string[];
  per100ml: string[];
}

export interface TextRun {
  text: string;
  face: Face;
  sizeMm: number;
  x: number;
  baseline: number;
  /** Width available in the cell. */
  maxWidth: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelLayout {
  width: number;
  height: number;
  /** Frame and cell rules, drawn as filled rectangles so they scale with the artwork. */
  rects: Rect[];
  texts: TextRun[];
  metrics: PanelMetrics;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const ceil3 = (value: number) => Math.ceil(Math.round(value * 1e6) / 1000) / 1000;

/** Keeps numbers with their units ("60 mL", "355 kJ") on one line. */
export function bindUnits(text: string): string {
  return text.replace(/(\d) (mL|kJ|Cal|%)/g, '$1 $2');
}

/** Greedy line breaking at ordinary spaces; no-break spaces hold words together. */
export function wrapText(font: FontData, text: string, sizeMm: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter((w) => w !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (line !== '' && measureText(font, candidate, sizeMm) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

export function layoutPanel(
  content: PanelContent,
  widthMm: number,
  minRulePt: number,
): PanelLayout {
  const W = widthMm;
  const f = W / LAYOUT.widthEm;
  const titleSize = f * LAYOUT.titleScale;
  const padX = LAYOUT.padX * f;
  const leading = LAYOUT.leading * f;
  // Round rule weight up to the micrometre so rounding can never take it below the minimum.
  const r = ceil3(Math.max(minRulePt, (LAYOUT.rulePtAt50mm * W) / 50) * MM_PER_PT);
  const cap = (font: FontData, size: number) => (font.capHeight / font.unitsPerEm) * size;

  const texts: TextRun[] = [];
  const rects: Rect[] = [];
  const hRule = (y: number) => rects.push({ x: 0, y, width: W, height: r });

  /** Places lines in a cell starting at `top`; returns the y of the rule below the cell. */
  const cell = (
    lines: string[],
    face: Face,
    size: number,
    x: number,
    maxWidth: number,
    top: number,
  ) => {
    const first = top + LAYOUT.padTop * f + cap(FACES[face], size);
    lines.forEach((text, i) =>
      texts.push({
        text,
        face,
        sizeMm: size,
        x,
        baseline: first + i * LAYOUT.leading * size,
        maxWidth,
      }),
    );
    return first + (Math.max(lines.length, 1) - 1) * LAYOUT.leading * size + LAYOUT.padBottom * f;
  };

  const fullX = r + padX;
  const fullWidth = W - 2 * r - 2 * padX;

  // Title row
  let y = r;
  y = cell(
    wrapText(SANS_BOLD, bindUnits(content.title), titleSize, fullWidth),
    'bold',
    titleSize,
    fullX,
    fullWidth,
    y,
  );
  hRule(y);
  y += r;

  // Servings, serving size and standard drinks
  const info = content.info.flatMap((line) =>
    wrapText(SANS_REGULAR, bindUnits(line), f, fullWidth),
  );
  y = cell(info, 'regular', f, fullX, fullWidth, y);
  hRule(y);
  y += r;
  const tableTop = y;

  // Table columns: row label, per serving, per 100 mL
  const energyLabel = bindUnits(content.energyLabel);
  const c1 = measureText(SANS_REGULAR, energyLabel, f) + 2 * padX;
  const c2 = (W - 4 * r - c1) / 2;
  const x2 = r + c1 + r;
  const x3 = x2 + c2 + r;
  const inner = c2 - 2 * padX;

  // Heading row
  const [perServingHeading, per100mlHeading] = content.headings.map((h) =>
    wrapText(SANS_REGULAR, bindUnits(h), f, inner),
  );
  y = Math.max(
    cell(perServingHeading!, 'regular', f, x2 + padX, inner, y),
    cell(per100mlHeading!, 'regular', f, x3 + padX, inner, y),
  );
  hRule(y);
  y += r;

  // Energy row
  y = Math.max(
    cell([energyLabel], 'regular', f, r + padX, c1 - 2 * padX, y),
    cell(content.perServing.map(bindUnits), 'regular', f, x2 + padX, inner, y),
    cell(content.per100ml.map(bindUnits), 'regular', f, x3 + padX, inner, y),
  );

  const H = round3(y + r);
  rects.push(
    { x: 0, y: 0, width: W, height: r },
    { x: 0, y: H - r, width: W, height: r },
    { x: 0, y: 0, width: r, height: H },
    { x: W - r, y: 0, width: r, height: H },
    { x: r + c1, y: tableTop, width: r, height: H - r - tableTop },
    { x: x2 + c2, y: tableTop, width: r, height: H - r - tableTop },
  );

  return {
    width: W,
    height: H,
    rects,
    texts,
    metrics: {
      widthMm: W,
      heightMm: H,
      bodySizeMm: round3(f),
      bodySizePt: round3(f / MM_PER_PT),
      titleSizeMm: round3(titleSize),
      capHeightMm: round3(cap(SANS_REGULAR, f)),
      xHeightMm: round3((SANS_REGULAR.xHeight / SANS_REGULAR.unitsPerEm) * f),
      ruleWeightMm: r,
      ruleWeightPt: round3(r / MM_PER_PT),
    },
  };
}

/** Text runs wider than their cell. The layout wraps at spaces, so this only catches long words. */
export function overflowingText(layout: PanelLayout): TextRun[] {
  return layout.texts.filter(
    (t) => measureText(FACES[t.face], t.text, t.sizeMm) > t.maxWidth + 1e-9,
  );
}
