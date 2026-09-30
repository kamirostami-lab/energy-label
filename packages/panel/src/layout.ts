// Layout of the prescribed format (Standard 2.7.1—4B(3)): a bordered box with the heading centred
// above the servings and serving-size lines, a rule, the column headings, a rule, then the Energy
// row. There is no rule under the heading and none between columns. Every dimension is
// proportional to the panel width, so a panel looks the same at any size; only the rule weight has
// a floor (the rules file minimum).
import { SANS_REGULAR } from './font/sans-regular.generated.ts';
import type { FontData } from './font/types.ts';
import { measureText, type PathCommand } from './text.ts';
import type { PanelMetrics } from './types.ts';

export { PRESET_WIDTHS_MM, WIDTH_LIMITS_MM } from './settings.ts';

/** The face every word of the panel is set in (decision D4: IBM Plex Sans, outlined). */
export const FONT: FontData = SANS_REGULAR;

/** Proportions in ems of the type, unless noted. */
export const LAYOUT = {
  /** Panel width in ems: type size = width / 22 (2.27 mm, about 6.4 pt, at 50 mm). */
  widthEm: 22,
  /** Space between the border and the text, and between columns. */
  padX: 0.4,
  /** From the rule above a block to the cap height of its first line. */
  padTop: 0.4,
  /** From the last baseline in a block to the rule below it. */
  padBottom: 0.4,
  /** Baseline to baseline. */
  leading: 1.2,
  /** Rule weight at a 50 mm width, scaled with width, never below the rules file minimum. */
  rulePtAt50mm: 0.5,
} as const;

export const MM_PER_PT = 25.4 / 72;

/** One energy cell: the kJ value, then the Cal value in brackets when shown. */
export interface EnergyCell {
  kj: string;
  cal: string | null;
}

export interface PanelContent {
  title: string;
  /** Lines under the heading: servings per package, then serving size with standard drinks. */
  info: string[];
  /** Column headings for per serving and per 100 mL. */
  headings: readonly [string, string];
  energyLabel: string;
  perServing: EnergyCell;
  per100ml: EnergyCell;
}

export interface TextRun {
  text: string;
  sizeMm: number;
  x: number;
  baseline: number;
  /** Width available to the line. */
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
  /** Border and rules, drawn as filled rectangles so they scale with the artwork. */
  rects: Rect[];
  texts: TextRun[];
  metrics: PanelMetrics;
}

/** A rectangle as path commands: the same corners, in the same order, as the SVG's M/H/V/H/Z. */
export function rectCommands(r: Rect): PathCommand[] {
  return [
    ['M', r.x, r.y],
    ['L', r.x + r.width, r.y],
    ['L', r.x + r.width, r.y + r.height],
    ['L', r.x, r.y + r.height],
    ['Z'],
  ];
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const ceil3 = (value: number) => Math.ceil(Math.round(value * 1e6) / 1000) / 1000;

/** "355 kJ (84.9 Cal)": kJ and Cal on one line, as the prescribed format sets them out. */
export function energyText(cell: EnergyCell): string {
  return cell.cal === null ? cell.kj : `${cell.kj} ${cell.cal}`;
}

/**
 * Marks where a line may not break: between a number and its unit ("60 mL", "355 kJ") and
 * anywhere inside brackets ("(1 standard drink)").
 */
export function bindPhrases(text: string): string {
  return text
    .replace(/(\d) (mL|kJ|Cal|%)/g, '$1 $2')
    .replace(/\([^)]*\)/g, (group) => group.replace(/ /g, ' '));
}

/** Greedy line breaking at ordinary spaces; no-break spaces hold words together. */
export function wrapText(text: string, sizeMm: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter((w) => w !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (line !== '' && measureText(FONT, candidate, sizeMm) > maxWidth) {
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
  const padX = LAYOUT.padX * f;
  // Round rule weight up to the micrometre so rounding can never take it below the minimum.
  const r = ceil3(Math.max(minRulePt, (LAYOUT.rulePtAt50mm * W) / 50) * MM_PER_PT);
  const capHeight = (FONT.capHeight / FONT.unitsPerEm) * f;

  const texts: TextRun[] = [];
  const rects: Rect[] = [];
  const rule = (y: number) => rects.push({ x: 0, y, width: W, height: r });
  const wrap = (text: string, maxWidth: number) => wrapText(bindPhrases(text), f, maxWidth);

  /** Sets lines from `top` at the x each one is given; returns the y of the rule below. */
  const block = (lines: Array<{ text: string; x: number }>, maxWidth: number, top: number) => {
    const first = top + LAYOUT.padTop * f + capHeight;
    lines.forEach(({ text, x }, i) =>
      texts.push({ text, sizeMm: f, x, baseline: first + i * LAYOUT.leading * f, maxWidth }),
    );
    return first + (Math.max(lines.length, 1) - 1) * LAYOUT.leading * f + LAYOUT.padBottom * f;
  };

  // Heading, centred, then the servings and serving-size lines in the same block.
  const fullWidth = W - 2 * r - 2 * padX;
  let y = block(
    [
      ...wrap(content.title, fullWidth).map((text) => ({
        text,
        x: (W - measureText(FONT, text, f)) / 2,
      })),
      ...content.info.flatMap((line) =>
        wrap(line, fullWidth).map((text) => ({ text, x: r + padX })),
      ),
    ],
    fullWidth,
    r,
  );
  rule(y);
  y += r;

  // Columns: row label, per serving, per 100 mL, separated by space alone.
  const label = bindPhrases(content.energyLabel);
  const c1 = measureText(FONT, label, f) + 2 * padX;
  const c2 = (W - 2 * r - c1) / 2;
  const x2 = r + c1 + padX;
  const x3 = r + c1 + c2 + padX;
  const inner = c2 - 2 * padX;
  const column = (lines: string[], x: number) => lines.map((text) => ({ text, x }));

  // Column headings
  y = Math.max(
    block(column(wrap(content.headings[0], inner), x2), inner, y),
    block(column(wrap(content.headings[1], inner), x3), inner, y),
  );
  rule(y);
  y += r;

  // Energy row: "kJ (Cal)" on one line where both cells fit, otherwise Cal under kJ in both.
  const cells = [content.perServing, content.per100ml];
  const inline = cells.every(
    (cell) => measureText(FONT, bindPhrases(energyText(cell)), f) <= inner,
  );
  const energyLines = (cell: EnergyCell) =>
    (inline ? [energyText(cell)] : [cell.kj, ...(cell.cal === null ? [] : [cell.cal])]).map(
      bindPhrases,
    );
  y = Math.max(
    block([{ text: label, x: r + padX }], c1 - 2 * padX, y),
    block(column(energyLines(content.perServing), x2), inner, y),
    block(column(energyLines(content.per100ml), x3), inner, y),
  );

  const H = round3(y + r);
  rects.push(
    { x: 0, y: 0, width: W, height: r },
    { x: 0, y: H - r, width: W, height: r },
    { x: 0, y: 0, width: r, height: H },
    { x: W - r, y: 0, width: r, height: H },
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
      capHeightMm: round3(capHeight),
      xHeightMm: round3((FONT.xHeight / FONT.unitsPerEm) * f),
      ruleWeightMm: r,
      ruleWeightPt: round3(r / MM_PER_PT),
    },
  };
}

/** Text runs wider than their space. The layout wraps at spaces, so this only catches long words. */
export function overflowingText(layout: PanelLayout): TextRun[] {
  return layout.texts.filter((t) => measureText(FONT, t.text, t.sizeMm) > t.maxWidth + 1e-9);
}
