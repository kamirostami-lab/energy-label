// Product settings shared by the renderer and the generator screen: widths, variants and serving
// presets. Nothing regulatory (the rules file holds that), and nothing with a runtime import, so
// the browser can load this module without the renderer or its glyph data.
import type { ColourVariant, EnergyUnits } from './types.ts';

/** Panel widths offered as presets (Build Brief 01 section 8). */
export const PRESET_WIDTHS_MM = [30, 35, 40, 45, 50, 60] as const;
/** Custom widths allowed (Build Brief 01 section 8). */
export const WIDTH_LIMITS_MM = { min: 25, max: 120 } as const;

export const COLOUR_VARIANTS: readonly ColourVariant[] = ['black', 'white', 'spot'];
export const ENERGY_UNITS: readonly EnergyUnits[] = ['kj', 'kj_cal'];
export const PACKAGE_WORD_MAX_LENGTH = 24;

export type BeverageTypeId = 'wine' | 'fortified_wine' | 'beer' | 'cider' | 'spirits' | 'other';

export interface BeverageType {
  id: BeverageTypeId;
  label: string;
  /** Serving presets in mL; the first is the default. */
  servingsMl: readonly number[];
  /** Default word for "Servings per …". */
  packageWord: string;
  /** The type's name in the rules file's list of standardised alcoholic beverages, if listed. */
  standardisedAs: string | null;
}

/**
 * Beverage types on the generator screen. Choosing one sets the serving preset and the package
 * word (Build Brief 01 sections 3 and 4). Serving presets are from the brief; fortified wine's
 * 60 mL is the Department of Health serve cited by the Wine Australia fact sheet (p. 5).
 */
export const BEVERAGE_TYPES: readonly BeverageType[] = [
  {
    id: 'wine',
    label: 'Wine',
    servingsMl: [100, 150],
    packageWord: 'bottle',
    standardisedAs: 'wine',
  },
  {
    id: 'fortified_wine',
    label: 'Fortified wine',
    servingsMl: [60],
    packageWord: 'bottle',
    standardisedAs: null,
  },
  { id: 'beer', label: 'Beer', servingsMl: [375, 330], packageWord: 'can', standardisedAs: 'beer' },
  { id: 'cider', label: 'Cider', servingsMl: [330], packageWord: 'can', standardisedAs: 'cider' },
  {
    id: 'spirits',
    label: 'Spirits',
    servingsMl: [30],
    packageWord: 'bottle',
    standardisedAs: 'spirit',
  },
  { id: 'other', label: 'Other', servingsMl: [], packageWord: 'package', standardisedAs: null },
];

/** Live preview resolution limits: device pixels per mm, and pixels per image. */
export const PREVIEW_LIMITS = { minPxPerMm: 2, maxPxPerMm: 40, maxPixels: 4_000_000 } as const;
