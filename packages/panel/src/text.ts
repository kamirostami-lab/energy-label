// Measures and outlines text from the generated glyph data. Output is absolute path data in mm
// with the y axis pointing down, ready for SVG (1 user unit = 1 mm).
import type { FontData } from './font/types.ts';

type Command =
  | readonly ['M' | 'L', number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];

interface Glyph {
  readonly advance: number;
  readonly commands: readonly Command[];
}

const cache = new WeakMap<FontData, Map<string, Glyph>>();

function parsePath(path: string): Command[] {
  const commands: Command[] = [];
  for (const [, op, args] of path.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const n = args!.trim() === '' ? [] : args!.trim().split(' ').map(Number);
    if (op === 'Z') commands.push(['Z']);
    else if (op === 'C') commands.push(['C', n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!]);
    else commands.push([op as 'M' | 'L', n[0]!, n[1]!]);
  }
  return commands;
}

function glyph(font: FontData, char: string): Glyph | undefined {
  let glyphs = cache.get(font);
  if (!glyphs) {
    glyphs = new Map();
    cache.set(font, glyphs);
  }
  let parsed = glyphs.get(char);
  if (!parsed) {
    const data = font.glyphs[char];
    if (!data) return undefined;
    parsed = { advance: data[0], commands: parsePath(data[1]) };
    glyphs.set(char, parsed);
  }
  return parsed;
}

/** Characters in `text` that the face cannot typeset, without duplicates. */
export function unsupportedCharacters(font: FontData, text: string): string[] {
  return [...new Set([...text].filter((char) => font.glyphs[char] === undefined))];
}

/** Advance width of `text` in mm at `sizeMm`, with pair kerning. */
export function measureText(font: FontData, text: string, sizeMm: number): number {
  const chars = [...text];
  let units = 0;
  chars.forEach((char, i) => {
    units += requireGlyph(font, char).advance;
    const next = chars[i + 1];
    if (next !== undefined) units += font.kerning[char + next] ?? 0;
  });
  return (units * sizeMm) / font.unitsPerEm;
}

/** Formats a coordinate in mm to at most three decimals (1 µm); deterministic across platforms. */
export function fmt(value: number): string {
  const text = value.toFixed(3).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}

/** An absolute path command in mm, y axis down: the shared geometry of the SVG and PDF exports. */
export type PathCommand =
  | readonly ['M' | 'L', number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];

/** Outline of `text` set at `sizeMm` with its left edge at `x` and baseline at `baseline`. */
export function outlineCommands(
  font: FontData,
  text: string,
  sizeMm: number,
  x: number,
  baseline: number,
): PathCommand[] {
  const scale = sizeMm / font.unitsPerEm;
  const chars = [...text];
  const out: PathCommand[] = [];
  let pen = 0;
  chars.forEach((char, i) => {
    const g = requireGlyph(font, char);
    const px = (u: number) => x + (pen + u) * scale;
    const py = (u: number) => baseline - u * scale;
    for (const c of g.commands) {
      if (c[0] === 'Z') out.push(['Z']);
      else if (c[0] === 'C')
        out.push(['C', px(c[1]), py(c[2]), px(c[3]), py(c[4]), px(c[5]), py(c[6])]);
      else out.push([c[0], px(c[1]), py(c[2])]);
    }
    pen += g.advance;
    const next = chars[i + 1];
    if (next !== undefined) pen += font.kerning[char + next] ?? 0;
  });
  return out;
}

/** SVG path data for outline commands, numbers formatted by `fmt`. */
export function svgPathData(commands: readonly PathCommand[]): string {
  let d = '';
  for (const c of commands) {
    if (c[0] === 'Z') d += 'Z';
    else if (c[0] === 'C')
      d += `C${fmt(c[1])} ${fmt(c[2])} ${fmt(c[3])} ${fmt(c[4])} ${fmt(c[5])} ${fmt(c[6])}`;
    else d += `${c[0]}${fmt(c[1])} ${fmt(c[2])}`;
  }
  return d;
}

/** SVG path data for `text` set at `sizeMm` with its left edge at `x` and baseline at `baseline`. */
export function outlineText(
  font: FontData,
  text: string,
  sizeMm: number,
  x: number,
  baseline: number,
): string {
  return svgPathData(outlineCommands(font, text, sizeMm, x, baseline));
}

function requireGlyph(font: FontData, char: string): Glyph {
  const g = glyph(font, char);
  if (!g) {
    const code = char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0');
    throw new RangeError(`${font.name} has no glyph for U+${code}`);
  }
  return g;
}
