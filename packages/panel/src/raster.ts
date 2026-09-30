// The live preview as pixels: the panel drawn to 8-bit grey with the PREVIEW mark burned in, so
// the generator page never holds vector artwork (decision recorded for session 3). Coverage is the
// exact area under each edge, accumulated per row (the signed-area method of font-rs), which gives
// anti-aliasing with the non-zero winding rule the SVG and PDF use.
import { FONT, rectCommands, type PanelLayout } from './layout.ts';
import { PREVIEW_LIMITS } from './settings.ts';
import { outlineCommands, type PathCommand } from './text.ts';
import type { ColourVariant } from './types.ts';
import { WATERMARK_TINT, watermarkCommands } from './watermark.ts';

export interface GreyImage {
  width: number;
  height: number;
  /** Row-major 8-bit grey, 0 black to 255 white. */
  pixels: Uint8Array;
}

/** Grey levels of the paper, the mark and the artwork. White artwork is shown on a dark ground. */
const TONES: Readonly<Record<ColourVariant, { paper: number; ink: number }>> = {
  black: { paper: 255, ink: 0 },
  spot: { paper: 255, ink: 0 },
  // 0.8 K, the backdrop the proof sheet uses for white panels.
  white: { paper: 51, ink: 255 },
};

/** Maximum distance, in pixels, between a curve and the lines that approximate it. */
const FLATNESS = 0.1;

class Coverage {
  readonly width: number;
  readonly height: number;
  /** Row length in the accumulator: two spare columns take the area right of the last pixel. */
  readonly stride: number;
  /** Signed area per cell; a running sum along a row gives the pixel's coverage. */
  readonly acc: Float32Array;
  private startX = 0;
  private startY = 0;
  private x = 0;
  private y = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.stride = width + 2;
    this.acc = new Float32Array(this.stride * height);
  }

  private line(ax: number, ay: number, bx: number, by: number): void {
    if (ay === by) return;
    let dir = 1;
    let x0 = ax;
    let y0 = ay;
    let x1 = bx;
    let y1 = by;
    if (ay > by) {
      dir = -1;
      x0 = bx;
      y0 = by;
      x1 = ax;
      y1 = ay;
    }
    const acc = this.acc;
    const maxX = this.width;
    const dxdy = (x1 - x0) / (y1 - y0);
    let x = y0 < 0 ? x0 - y0 * dxdy : x0;
    const last = Math.min(this.height, Math.ceil(y1));
    for (let y = Math.max(0, Math.floor(y0)); y < last; y++) {
      const row = y * this.stride;
      const dy = Math.min(y + 1, y1) - Math.max(y, y0);
      const xNext = x + dxdy * dy;
      const d = dy * dir;
      // Clamp to the image; the artwork never leaves the panel, so this only absorbs rounding.
      const xa = Math.min(Math.max(x, 0), maxX);
      const xb = Math.min(Math.max(xNext, 0), maxX);
      const left = xa < xb ? xa : xb;
      const right = xa < xb ? xb : xa;
      const leftI = Math.floor(left);
      const rightI = Math.ceil(right);
      if (rightI <= leftI + 1) {
        const mid = 0.5 * (xa + xb) - leftI;
        acc[row + leftI]! += d - d * mid;
        acc[row + leftI + 1]! += d * mid;
      } else {
        const s = 1 / (right - left);
        const leftFrac = left - leftI;
        const a0 = 0.5 * s * (1 - leftFrac) * (1 - leftFrac);
        const rightFrac = right - rightI + 1;
        const am = 0.5 * s * rightFrac * rightFrac;
        acc[row + leftI]! += d * a0;
        if (rightI === leftI + 2) {
          acc[row + leftI + 1]! += d * (1 - a0 - am);
        } else {
          const a1 = s * (1.5 - leftFrac);
          acc[row + leftI + 1]! += d * (a1 - a0);
          for (let xi = leftI + 2; xi < rightI - 1; xi++) acc[row + xi]! += d * s;
          const a2 = a1 + (rightI - leftI - 3) * s;
          acc[row + rightI - 1]! += d * (1 - a2 - am);
        }
        acc[row + rightI]! += d * am;
      }
      x = xNext;
    }
  }

  private to(nx: number, ny: number): void {
    this.line(this.x, this.y, nx, ny);
    this.x = nx;
    this.y = ny;
  }

  /** Adds a path in millimetres; every subpath is closed, as a fill closes it. */
  path(commands: readonly PathCommand[], scale: number): void {
    for (const c of commands) {
      if (c[0] === 'M') {
        this.to(this.startX, this.startY);
        this.startX = this.x = c[1] * scale;
        this.startY = this.y = c[2] * scale;
      } else if (c[0] === 'L') {
        this.to(c[1] * scale, c[2] * scale);
      } else if (c[0] === 'C') {
        const x0 = this.x;
        const y0 = this.y;
        const x1 = c[1] * scale;
        const y1 = c[2] * scale;
        const x2 = c[3] * scale;
        const y2 = c[4] * scale;
        const x3 = c[5] * scale;
        const y3 = c[6] * scale;
        // Wang's formula: segments needed to keep a cubic within FLATNESS of its chords.
        const ddx = Math.max(Math.abs(x0 - 2 * x1 + x2), Math.abs(x1 - 2 * x2 + x3));
        const ddy = Math.max(Math.abs(y0 - 2 * y1 + y2), Math.abs(y1 - 2 * y2 + y3));
        const n = Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.hypot(ddx, ddy)) / FLATNESS)));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const e = 3 * u * t * t;
          const f = t * t * t;
          this.to(a * x0 + b * x1 + e * x2 + f * x3, a * y0 + b * y1 + e * y2 + f * y3);
        }
      } else {
        this.to(this.startX, this.startY);
      }
    }
    this.to(this.startX, this.startY);
  }
}

/** The panel at `pxPerMm` device pixels per millimetre, with the PREVIEW mark behind it. */
export function rasterizePanel(
  layout: PanelLayout,
  colour: ColourVariant,
  pxPerMm: number,
): GreyImage {
  const width = Math.max(1, Math.ceil(layout.width * pxPerMm - 1e-9));
  const height = Math.max(1, Math.ceil(layout.height * pxPerMm - 1e-9));

  const art = new Coverage(width, height);
  for (const r of layout.rects) art.path(rectCommands(r), pxPerMm);
  for (const t of layout.texts) {
    art.path(outlineCommands(FONT, t.text, t.sizeMm, t.x, t.baseline), pxPerMm);
  }
  const mark = new Coverage(width, height);
  mark.path(watermarkCommands(layout), pxPerMm);

  // Composite row by row: paper, then the mark, then the artwork, each weighted by its coverage.
  const { paper, ink } = TONES[colour];
  const markTone = 255 * (1 - WATERMARK_TINT[colour]);
  const pixels = new Uint8Array(width * height);
  const artAcc = art.acc;
  const markAcc = mark.acc;
  for (let y = 0; y < height; y++) {
    const row = y * art.stride;
    const out = y * width;
    let artSum = 0;
    let markSum = 0;
    for (let x = 0; x < width; x++) {
      artSum += artAcc[row + x]!;
      markSum += markAcc[row + x]!;
      const artCover = Math.min(1, Math.abs(artSum));
      const markCover = Math.min(1, Math.abs(markSum));
      const ground = paper + (markTone - paper) * markCover;
      pixels[out + x] = (ground + (ink - ground) * artCover + 0.5) | 0;
    }
  }
  return { width, height, pixels };
}

/**
 * The preview resolution for a requested density: clamped to the preview limits, and lowered for
 * large panels so an image never exceeds the pixel budget.
 */
export function previewScale(layout: PanelLayout, requestedPxPerMm: number): number {
  const { minPxPerMm, maxPxPerMm, maxPixels } = PREVIEW_LIMITS;
  const wanted = Number.isFinite(requestedPxPerMm) ? requestedPxPerMm : minPxPerMm;
  const budget = Math.sqrt(maxPixels / (layout.width * layout.height));
  const scale = Math.min(Math.max(wanted, minPxPerMm), maxPxPerMm, budget);
  // Two decimals keep repeated requests at the same zoom byte-identical.
  return Math.floor(scale * 100) / 100;
}
