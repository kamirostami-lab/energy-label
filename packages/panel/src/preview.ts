// The generator's live preview: the panel as a watermarked PNG at the screen's density.
import type { PanelLayout } from './layout.ts';
import { encodeGreyPng } from './png.ts';
import { previewScale, rasterizePanel } from './raster.ts';
import type { ColourVariant } from './types.ts';

export interface PreviewImage {
  png: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** The density actually rendered, after the preview limits. */
  pxPerMm: number;
}

export function renderPreviewPng(
  layout: PanelLayout,
  colour: ColourVariant,
  requestedPxPerMm: number,
): PreviewImage {
  const pxPerMm = previewScale(layout, requestedPxPerMm);
  const image = rasterizePanel(layout, colour, pxPerMm);
  return {
    png: encodeGreyPng(image, pxPerMm),
    widthPx: image.width,
    heightPx: image.height,
    pxPerMm,
  };
}
