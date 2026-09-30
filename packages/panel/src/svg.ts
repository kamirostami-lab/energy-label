// Serialises a laid-out panel as SVG artwork: 1 user unit = 1 mm, viewBox equal to the panel
// bounds, every glyph converted to outlines. Output is byte-stable for the same layout.
import { FONT, type PanelLayout } from './layout.ts';
import { fmt, outlineText } from './text.ts';
import type { ColourVariant } from './types.ts';

/** Name of the separation the spot variant is printed on (Build Brief 01 section 8). */
export const SPOT_COLOUR_NAME = 'Panel';

const FILL: Readonly<Record<ColourVariant, string>> = {
  black: '#000000',
  white: '#FFFFFF',
  // SVG cannot carry a separation; the spot variant previews in black and is tagged for prepress.
  spot: '#000000',
};

export interface SvgMeta {
  /** Accessible name, e.g. the panel title. */
  title: string;
  /** The full statement as plain text, for screen readers and asset search. */
  description: string;
  rulesVersion: string;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderSvg(layout: PanelLayout, colour: ColourVariant, meta: SvgMeta): string {
  const width = fmt(layout.width);
  const height = fmt(layout.height);
  const rules = layout.rects
    .map(
      (r) => `M${fmt(r.x)} ${fmt(r.y)}H${fmt(r.x + r.width)}V${fmt(r.y + r.height)}H${fmt(r.x)}Z`,
    )
    .join('');
  const spot = colour === 'spot' ? ` data-spot-colour="${SPOT_COLOUR_NAME}"` : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Energy Panel artwork. Text is outlined: no fonts required. 1 user unit = 1 mm. -->',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" data-rules-version="${escapeXml(meta.rulesVersion)}">`,
    `<title>${escapeXml(meta.title)}</title>`,
    `<desc>${escapeXml(meta.description)}</desc>`,
    `<g id="energy-panel" fill="${FILL[colour]}"${spot}>`,
    `<path d="${rules}"/>`,
    ...layout.texts.map(
      (t) => `<path d="${outlineText(FONT, t.text, t.sizeMm, t.x, t.baseline)}"/>`,
    ),
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
