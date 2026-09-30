// The PREVIEW mark on the live preview and on free preview exports (decision D3): one word set
// behind the panel content, light enough to read the statement through. It is drawn from the
// same outlines as the artwork, so previews need no fonts either.
import { FONT, type PanelLayout } from './layout.ts';
import { measureText, outlineCommands, type PathCommand } from './text.ts';
import type { ColourVariant } from './types.ts';

export const WATERMARK_TEXT = 'PREVIEW';

/**
 * Tint of the mark as a fraction of black: light grey behind black or spot artwork, mid grey
 * behind white artwork, which is seen against a dark background.
 */
export const WATERMARK_TINT: Readonly<Record<ColourVariant, number>> = {
  black: 0.12,
  spot: 0.12,
  white: 0.5,
};

/** The mark centred on the panel: at most 84% of its width and 62% of its height (cap height). */
export function watermarkCommands(layout: PanelLayout): PathCommand[] {
  const widthPerMm = measureText(FONT, WATERMARK_TEXT, 1);
  const capPerMm = FONT.capHeight / FONT.unitsPerEm;
  const size = Math.min((0.84 * layout.width) / widthPerMm, (0.62 * layout.height) / capPerMm);
  const x = (layout.width - widthPerMm * size) / 2;
  const baseline = (layout.height + capPerMm * size) / 2;
  return outlineCommands(FONT, WATERMARK_TEXT, size, x, baseline);
}

/** The tint as an sRGB grey, e.g. "#E0E0E0". */
export function watermarkHex(colour: ColourVariant): string {
  const level = Math.round(255 * (1 - WATERMARK_TINT[colour]))
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
  return `#${level}${level}${level}`;
}
